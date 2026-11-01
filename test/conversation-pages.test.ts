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
import { canonicalJson } from "../src/service/contracts/core.ts";
import {
  type ChatTurn,
  decodeWorkbenchRead,
  decodeWorkbenchResult,
} from "../src/service/contracts/workbench.ts";
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
  for (const p of pages) {
    const reply = {
      kind: "conversation-transcript",
      conversationId: randomUUID(),
      page: p.page,
      turn: { ...current, items: p.items },
    };
    expect(decodeWorkbenchResult(reply)).toEqual(reply);
  }
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
  expect(() =>
    decodeWorkbenchRead({
      kind: "conversation-transcript",
      id: current.id,
      turnId: current.id,
      page: -1,
    }),
  ).toThrow();
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
