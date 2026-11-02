import { randomUUID } from "node:crypto";
import {
  linkSync,
  mkdtempSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  conversationContextRecords,
  encodeConversationContext,
  readConversationContext,
} from "../src/conversation-context.mjs";
import { canonicalJson, LIMITS } from "../src/service/contracts/core.ts";
import {
  type ChatTurn,
  chatStep,
  decodeWorkbenchRead,
  decodeWorkbenchResult,
  STEP_READ,
  STEP_TEXT_BYTES,
} from "../src/service/contracts/workbench.ts";
import { ConversationSteps } from "../src/service/conversation-steps.ts";
import {
  ConversationTranscript,
  TRANSCRIPT_PAGE_BYTES,
  type TranscriptPage,
} from "../src/service/conversation-transcript.ts";
import { ConversationCapture } from "../src/service/conversations.ts";
import { hash, PrivateFiles } from "../src/service/private-files.ts";
import { runProcess } from "../src/subagent-process.ts";
import type { CaptureFrame } from "../src/worker-public.mjs";

const turn = (): ChatTurn => ({
  id: randomUUID(),
  epoch: randomUUID(),
  status: "running",
  notice: "",
  omitted: { thinking: false, media: false, other: false },
  items: [
    {
      id: "user",
      role: "user",
      text: "keep every step",
      name: "",
      args: "",
      error: false,
    },
  ],
});
it("hundreds of tool exchanges retain every byte in finite pages, not a fatal turn cap", () => {
  const current = turn(),
    pages: TranscriptPage[] = [];
  const transcript = new ConversationTranscript(current, (page) => {
    canonicalJson(page, TRANSCRIPT_PAGE_BYTES);
    pages.push(structuredClone(page));
  });
  const capture = new ConversationCapture(
    current,
    () => {},
    () => ["private-literal"],
    transcript,
  );
  let sequence = 0;
  const emit = (event: CaptureFrame["event"]) =>
    capture.accept({
      protocol: 2,
      childRunId: "child",
      workerSeq: ++sequence,
      observedMs: 0,
      event,
    });
  for (let call = 0; call < 300; call++) {
    const id = `tool-${call}`;
    emit({
      kind: "tool-start",
      callId: id,
      name: "read",
      declaration: null,
      source: { disposition: "unavailable", value: null },
      argsDetailId: null,
    });
    emit({
      kind: "detail-begin",
      detailId: id,
      descriptor: {
        owner: {
          kind: "tool",
          callId: id,
          blockId: id,
          index: 0,
          stage: "result",
        },
        encoding: "utf8",
        field: "tool-result",
      },
    });
    emit({
      kind: "detail-chunk",
      detailId: id,
      offset: 0,
      text: `${call}: ${'文😀\\"'.repeat(500)} private-lit`,
    });
    emit({ kind: "detail-chunk", detailId: id, offset: 1, text: "eral END" });
    emit({
      kind: "detail-end",
      detailId: id,
      bytes: 1,
      sha256: "a".repeat(64),
      coverage: {
        observed: "complete",
        source: "complete",
        redacted: false,
        omissions: [],
      },
    });
    emit({
      kind: "tool-end",
      callId: id,
      name: "read",
      isError: false,
      declaration: null,
      source: { disposition: "unavailable", value: null },
      resultDetailId: id,
      association: "orphan",
      startObserved: true,
    });
    if (call % 50 === 0) canonicalJson(current, TRANSCRIPT_PAGE_BYTES);
  }
  transcript.finish();
  expect(current.notice).toBe("");
  expect(
    pages.flatMap((p) => p.items).filter((i) => i.role === "tool"),
  ).toHaveLength(300);
  expect(JSON.stringify(pages)).not.toContain("private-lit");
  expect(JSON.stringify(pages).length).toBeGreaterThan(384 * 1024);
  expect(current.items.at(-1)?.id).toBe("tool-299");
  // Listing reads every page once; later reads extend the cached index.
  let reads = 0;
  const steps = new ConversationSteps((turnId, page) => {
    expect(turnId).toBe(current.id);
    reads++;
    return pages[page].items[0];
  });
  const listed = steps.list({ ...current, status: "completed" });
  expect(listed.steps).toHaveLength(301);
  expect(listed.stable).toBe(301);
  expect(reads).toBe(pages.length);
  steps.list({ ...current, status: "completed" });
  expect(reads).toBe(pages.length);
  const tool = listed.steps[300].step;
  expect(tool).toMatchObject({
    id: "tool-299",
    role: "tool",
    text: "",
    parts: 1,
  });
  expect(steps.detail(current, 300, 0).text).toContain("299: ");
  expect(() => steps.detail(current, 300, 1)).toThrow();
  // A full read of the latest steps decodes inside one reply.
  const reply = {
    kind: "conversation-turn",
    conversationId: randomUUID(),
    ordinal: 0,
    turn: {
      id: current.id,
      epoch: current.epoch,
      status: "completed",
      notice: "",
      omitted: current.omitted,
      steps: 301,
      stable: 301,
    },
    start: 301 - STEP_READ,
    steps: listed.steps.slice(-STEP_READ).map((row) => row.step),
  };
  expect(decodeWorkbenchResult(reply)).toEqual(reply);
});
it("a long streamed answer is captured in linear work, never rescanned per chunk", () => {
  const current = turn();
  const transcript = new ConversationTranscript(current, () => {});
  const capture = new ConversationCapture(
    current,
    () => {},
    () => [],
    transcript,
  );
  let sequence = 0;
  const emit = (event: CaptureFrame["event"]) =>
    capture.accept({
      protocol: 2,
      childRunId: "child",
      workerSeq: ++sequence,
      observedMs: 0,
      event,
    });
  const full = "streamed answer 文字 ".repeat(60000);
  emit({
    kind: "message-start",
    messageId: "m",
    role: "assistant",
    source: { disposition: "unavailable", value: null },
    resultCallId: null,
  });
  emit({
    kind: "detail-begin",
    detailId: "d",
    descriptor: {
      owner: {
        kind: "message",
        messageId: "m",
        blockId: "b",
        index: 0,
        stage: "stream",
      },
      encoding: "utf8",
      field: "message",
    },
  });
  const measure = Buffer.byteLength;
  let scanned = 0;
  Buffer.byteLength = ((value: string) => {
    scanned += value.length;
    return measure(value);
  }) as typeof Buffer.byteLength;
  try {
    for (let at = 0, n = 0; at < full.length; at += 4096)
      emit({
        kind: "detail-chunk",
        detailId: "d",
        offset: n++,
        text: full.slice(at, at + 4096),
      });
    emit({
      kind: "detail-end",
      detailId: "d",
      bytes: 1,
      sha256: "a".repeat(64),
      coverage: {
        observed: "complete",
        source: "complete",
        redacted: false,
        omissions: [],
      },
    });
  } finally {
    Buffer.byteLength = measure;
  }
  // Each chunk measures only itself and the bounded preview (~5x here); the
  // former per-chunk rescans of the whole answer measured ~580x.
  expect(scanned).toBeLessThan(10 * full.length);
  expect(transcript.find("m")?.text).toBe(full);
  expect(current.items.at(-1)?.text).toContain("Preview only");
});
it("a large individual item is losslessly split, including JSON escapes and surrogate pairs", () => {
  const current = turn(),
    pages: TranscriptPage[] = [];
  const transcript = new ConversationTranscript(current, (p) => {
    canonicalJson(p, TRANSCRIPT_PAGE_BYTES);
    pages.push(p);
  });
  const item = transcript.item("large", "tool");
  item.text = "😀\u0001\n".repeat(160000);
  item.args = '文\\"'.repeat(160000);
  transcript.preview(item);
  transcript.complete(item.id);
  const retained = pages
    .flatMap((p) => p.items)
    .filter((i) => i.id === "large");
  expect(retained.map((i) => i.text).join("")).toBe(item.text);
  expect(retained.map((i) => i.args).join("")).toBe(item.args);
  expect(current.items.at(-1)?.text).toContain("Preview only");
  // A step lists its preview while it runs, then its pages; its parts join
  // back into the whole item and a listing keeps only a bounded text prefix.
  const answer = transcript.item("answer", "assistant");
  answer.text = `${"长😀".repeat(200000)} END`;
  transcript.preview(answer);
  const steps = new ConversationSteps((_, page) => pages[page].items[0]);
  const running = steps.list(current);
  expect(running.steps.map((row) => row.step.id)).toEqual([
    "user",
    "large",
    "answer",
  ]);
  expect(running.stable).toBe(2);
  expect(running.steps[1].step).toMatchObject({
    role: "tool",
    text: "",
    target: "",
    parts: retained.length,
  });
  expect(running.steps[2].step).toMatchObject({ clipped: true, parts: 1 });
  const joined = (step: number, parts: number) =>
    Array.from({ length: parts }, (_, part) =>
      steps.detail(current, step, part),
    );
  expect(
    joined(1, retained.length)
      .map((i) => i.args)
      .join(""),
  ).toBe(item.args);
  transcript.complete("answer");
  const done = steps.list({ ...current, status: "completed" });
  expect(done.stable).toBe(3);
  const listed = done.steps[2].step;
  expect(listed.clipped).toBe(true);
  expect(listed.parts).toBeGreaterThan(1);
  expect(Buffer.byteLength(JSON.stringify(listed.text))).toBeLessThanOrEqual(
    STEP_TEXT_BYTES,
  );
  expect(answer.text.startsWith(listed.text)).toBe(true);
  expect(
    joined(2, listed.parts)
      .map((i) => i.text)
      .join(""),
  ).toBe(answer.text);
  expect(() =>
    decodeWorkbenchRead({
      kind: "conversation-step",
      id: current.id,
      turnId: current.id,
      step: 0,
      part: -1,
    }),
  ).toThrow();
});
it("a full step listing at every field's encoded worst case fits one read reply", () => {
  const escaped = (bytes: number) => "\u0001".repeat(bytes);
  const message = chatStep(
    {
      id: escaped(160),
      role: "assistant",
      text: escaped(100000),
      name: escaped(128),
      args: "",
      error: true,
    },
    Number.MAX_SAFE_INTEGER,
  );
  const tool = chatStep(
    {
      id: escaped(160),
      role: "tool",
      text: escaped(100000),
      name: escaped(128),
      args: JSON.stringify({ command: escaped(100000) }),
      error: true,
    },
    1,
  );
  expect(message.clipped).toBe(true);
  expect(tool.text).toBe("");
  expect(tool.target.length).toBeGreaterThan(0);
  const value = {
    kind: "conversation-turn",
    conversationId: randomUUID(),
    ordinal: Number.MAX_SAFE_INTEGER,
    turn: {
      id: randomUUID(),
      epoch: randomUUID(),
      status: "completed",
      notice: escaped(1024),
      omitted: { thinking: true, media: true, other: true },
      steps: Number.MAX_SAFE_INTEGER,
      stable: Number.MAX_SAFE_INTEGER,
    },
    start: Number.MAX_SAFE_INTEGER - STEP_READ,
    steps: Array.from({ length: STEP_READ }, (_, i) =>
      i % 2 ? tool : message,
    ),
  };
  expect(decodeWorkbenchResult(value)).toEqual(value);
  canonicalJson({ kind: "ok", value }, LIMITS.pageBytes);
});
it("context messages have no aggregate 2 MiB cap; the chain detects changed, missing and unsafe records", () => {
  const root = mkdtempSync(join(tmpdir(), "chat-context-")),
    files = new PrivateFiles(root);
  const messages = Array.from({ length: 300 }, (_, timestamp) => ({
    role: "user",
    timestamp,
    content: "abc private-literal ".repeat(500),
  }));
  let head: string | null = null,
    count = 0;
  for (const source of conversationContextRecords(messages, [
    "private-literal",
  ])) {
    const record = JSON.parse(source);
    if (record.schema.endsWith("-end/1")) {
      expect(record.count).toBe(count);
      continue;
    }
    const body = canonicalJson({
      schema: "cadence-conversation-message/1",
      index: count,
      previous: head,
      message: record.message,
    });
    files.create(join(root, `context-${count++}.json`), body, 32 * 1024 * 1024);
    head = hash(body);
  }
  const path = join(root, "context.json");
  files.create(
    path,
    canonicalJson({
      schema: "cadence-conversation-context/2",
      messages: count,
      head,
    }),
  );
  const restored = readConversationContext(path);
  expect(restored).toHaveLength(messages.length);
  expect(JSON.stringify(restored).length).toBeGreaterThan(2 * 1024 * 1024);
  expect(JSON.stringify(restored)).not.toContain("private-literal");
  const changed = join(root, "context-12.json");
  writeFileSync(changed, readFileSync(changed, "utf8").replace("abc", "xyz"));
  expect(() => readConversationContext(path)).toThrow("Invalid context chain");
  writeFileSync(changed, readFileSync(changed, "utf8").replace("xyz", "abc"));
  const last = join(root, "context-299.json");
  const lastBytes = readFileSync(last);
  writeFileSync(last, "{torn");
  expect(() => readConversationContext(path)).toThrow();
  writeFileSync(last, lastBytes);
  unlinkSync(last);
  expect(() => readConversationContext(path)).toThrow();
  writeFileSync(last, lastBytes, { mode: 0o600 });
  linkSync(last, join(root, "alias.json"));
  expect(() => readConversationContext(path)).toThrow("Invalid context file");
  const legacy = join(root, "old.json");
  files.create(legacy, encodeConversationContext([messages[0]], []));
  expect(readConversationContext(legacy)).toHaveLength(1);
});
it("checkpoint pipe is incremental across many records and refuses torn EOF before completion", async () => {
  for (const torn of [false, true]) {
    let bytes = 0,
      ended = false;
    const result = await runProcess({
      command: process.execPath,
      args: [
        "-e",
        `const fs=require('node:fs'); for(let i=0;i<160;i++) fs.writeSync(3, 'x'.repeat(16384)+'\\n'); ${torn ? "fs.writeSync(3,'torn');" : ""}`,
      ],
      cwd: process.cwd(),
      timeoutMs: 5000,
      signal: new AbortController().signal,
      onContext: (source) => {
        bytes += source.length;
      },
      onContextEnd: () => {
        ended = true;
      },
    });
    expect(bytes).toBe(160 * 16384);
    expect(ended).toBe(!torn);
    expect(result.outcome).toBe(torn ? "failed" : "completed");
    expect(result.exitCode).toBe(0);
  }
});
