import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { decodeWorkbenchResult } from "../src/service/contracts/workbench.ts";
import { ConversationRecords } from "../src/service/conversation-records.ts";
import { LiveCapture, type LiveTurn } from "../src/service/conversations.ts";
import type { ServiceCoordination } from "../src/service/coordination.ts";
import { sessionDirectory } from "../src/service/pi-sessions.ts";
import { PrivateFiles } from "../src/service/private-files.ts";
import { BROWSER_COMMAND_ENTRY } from "../src/session-entries.mjs";
import { seedPiSessions } from "./helpers/retained-conversations.ts";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "conversation-records-"));
  const cwd = join(root, "project"),
    agentDir = join(root, "agent");
  mkdirSync(cwd);
  mkdirSync(agentDir);
  const coordination = {
    directory: join(root, "service-v1"),
    files: new PrivateFiles(root),
    store: { root: cwd },
  } as unknown as ServiceCoordination;
  let secrets: string[] = [];
  const active = new Map<string, LiveTurn>();
  const records = new ConversationRecords({
    coordination,
    cwd,
    agentDir,
    active,
    assertCurrent() {},
    secrets: () => secrets,
  });
  const write = (path: string, value: unknown) =>
    coordination.files.create(path, JSON.stringify(value));
  const command = (
    id: string,
    status: string,
    user: string | null,
    text = "Question",
    notice = "",
    parent: string | null = null,
    omitted = { thinking: false, media: false, other: false },
  ) => {
    const commandId = randomUUID();
    write(records.path(commandId, "accepted.json"), {
      command: {
        kind: "send",
        commandId,
        conversationId: id,
        head: parent,
        text,
        model: {
          epoch: randomUUID(),
          accessGeneration: 1,
          configRev: 1,
          catalogId: randomUUID(),
        },
      },
      at: 1,
      session: id,
      parent,
      offset: 0,
    });
    write(records.path(commandId, "state.json"), {
      status,
      notice,
      user,
      omitted,
    });
    write(records.indexPath(id), {
      schema: "cadence-session-commands/1",
      id,
      commands: [commandId],
    });
    return commandId;
  };
  return {
    records,
    active,
    cwd,
    agentDir,
    command,
    secrets(value: string[]) {
      secrets = value;
    },
  };
}
it("failed attempts reapply current read redaction without changing the stored admission", () => {
  const f = fixture(),
    id = randomUUID(),
    secret = "fabricated-new-credential";
  const command = f.command(
    id,
    "failed",
    null,
    `Remember ${secret}`,
    `Failure ${secret}`,
  );
  const path = f.records.path(command, "accepted.json"),
    before = readFileSync(path);
  f.secrets([secret]);
  const view = f.records.conversation(id, null, null);
  expect(JSON.stringify(view)).not.toContain(secret);
  expect(view).toMatchObject({
    attempt: { text: "Remember [redacted]", notice: "Failure [redacted]" },
  });
  expect(readFileSync(path)).toEqual(before);
});
it.each(["failed", "unknown", "timeout", "canceled"])(
  "summary and turn both retain the owner's %s outcome",
  (status) => {
    const f = fixture();
    const session = seedPiSessions(
      sessionDirectory(f.cwd, f.agentDir),
      f.cwd,
      1,
    );
    f.command(session.ids[0], status, "00000001", "Terminal question 000.0");
    expect(f.records.conversation(session.ids[0], null, null)).toMatchObject({
      summary: { status },
    });
    expect(
      f.records.turnSteps(session.ids[0], session.longLeaf, 0, null),
    ).toMatchObject({ turn: { status } });
  },
);
it("a failed attempt from the current leaf is not masked by its previous completed Pi reply", () => {
  const f = fixture(),
    seed = seedPiSessions(sessionDirectory(f.cwd, f.agentDir), f.cwd, 1);
  f.command(
    seed.ids[0],
    "failed",
    null,
    "Never reached Pi",
    "auth-unavailable",
    seed.longLeaf,
  );
  expect(f.records.conversation(seed.ids[0], null, null)).toMatchObject({
    summary: { status: "failed" },
    attempt: { status: "failed" },
  });
});

it("an unwritten live Send preserves read redaction and recovery across readonly refreshes", () => {
  const f = fixture(),
    id = randomUUID(),
    secret = "new-live-credential";
  const commandId = f.command(id, "queued", null, `Question ${secret}`),
    accepted = f.records.accepted(commandId);
  if (!accepted) throw Error("admission");
  const capture = new LiveCapture(() => [secret]);
  f.active.set(commandId, {
    commandId,
    accepted,
    epoch: randomUUID(),
    title: `Question ${secret}`,
    execution: {
      cwd: f.cwd,
      checkoutRoot: f.cwd,
      model: null,
      version: accepted.command.model,
    },
    state: {
      status: "queued",
      notice: "",
      user: null,
      omitted: { thinking: false, media: false, other: false },
    },
    stateFile: null,
    capture,
    abort: new AbortController(),
    original: new Promise(() => {}),
  });
  f.secrets([secret]);
  const head = f.records.conversation(id, null, null),
    turn = f.records.turnSteps(id, null, 0, null);
  expect(JSON.stringify([head, turn])).not.toContain(secret);
  expect(turn).toMatchObject({
    steps: [{ text: "Question [redacted]" }],
  });
  const live = f.active.get(commandId)!;
  live.state.status = "running";
  const progress = {
    phase: "waiting" as const,
    attempt: 2,
    maxAttempts: 6,
    delayMs: 10000,
  };
  const observed = {
    protocol: 2 as const,
    childRunId: randomUUID(),
    workerSeq: 1,
    observedMs: 0,
    event: { kind: "model-retry" as const, progress },
  };
  capture.accept(observed);
  for (let i = 0; i < 2; i++) {
    expect(
      decodeWorkbenchResult(f.records.turnSteps(id, null, 0, null)),
    ).toMatchObject({ turn: { status: "running", retry: progress } });
    expect(f.active.size).toBe(1);
  }
  capture.accept({
    ...observed,
    event: { kind: "model-retry", progress: null },
  });
  expect(f.records.turnSteps(id, null, 0, null)).not.toHaveProperty(
    "turn.retry",
  );
});

/** One session as Pi writes it: a header, then entries chained in order. */
function writeSession(f: ReturnType<typeof fixture>, messages: unknown[]) {
  const id = randomUUID(),
    directory = sessionDirectory(f.cwd, f.agentDir);
  mkdirSync(directory, { recursive: true });
  const at = new Date(1_800_000_000_000).toISOString();
  const entries = messages.map((message, index) => ({
    type: "message",
    id: (index + 1).toString(16).padStart(8, "0"),
    parentId: index ? index.toString(16).padStart(8, "0") : null,
    timestamp: at,
    message,
  }));
  const path = join(directory, `2026-11-02T00-00-00-000Z_${id}.jsonl`);
  writeFileSync(
    path,
    [{ type: "session", version: 3, id, timestamp: at, cwd: f.cwd }, ...entries]
      .map((line) => `${JSON.stringify(line)}\n`)
      .join(""),
  );
  return { id, path, entries: entries.map((entry) => entry.id) };
}
/** Makes an admitted command the owner's live turn. */
function goLive(
  f: ReturnType<typeof fixture>,
  commandId: string,
  capture: LiveCapture | null = null,
) {
  const accepted = f.records.accepted(commandId);
  if (!accepted) throw Error("admission");
  f.active.set(commandId, {
    commandId,
    accepted,
    epoch: randomUUID(),
    title: accepted.command.text,
    execution: {
      cwd: f.cwd,
      checkoutRoot: f.cwd,
      model: null,
      version: accepted.command.model,
    },
    state: {
      status: "running",
      notice: "",
      user: null,
      omitted: { thinking: false, media: false, other: false },
    },
    stateFile: null,
    capture,
    abort: new AbortController(),
    original: new Promise(() => {}),
  });
}
it("thinking Pi wrote is a lazily read step; the capture's recorded thinking flag is not reported beside it", () => {
  const f = fixture(),
    secret = "fabricated-thinking-credential";
  const session = writeSession(f, [
    { role: "user", content: [{ type: "text", text: "Why?" }] },
    {
      role: "assistant",
      content: [
        {
          type: "thinking",
          thinking: `Consider ${secret} carefully`,
          thinkingSignature: "opaque-signature",
        },
        { type: "text", text: "Because." },
      ],
      stopReason: "stop",
    },
  ]);
  // The live capture never carries thinking, so every thinking turn records it.
  f.command(session.id, "completed", session.entries[0], "Why?", "", null, {
    thinking: true,
    media: true,
    other: false,
  });
  f.secrets([secret]);
  const listed = decodeWorkbenchResult(
    f.records.turnSteps(session.id, session.entries[1], 0, null),
  );
  expect(listed).toMatchObject({
    turn: {
      status: "completed",
      // The recorded media flag still applies; shown thinking is not omitted.
      omitted: { thinking: false, media: true, other: false },
      steps: 3,
    },
    steps: [
      { role: "user", text: "Why?" },
      { role: "thinking", text: "", clipped: false, parts: 1 },
      { role: "assistant", text: "Because." },
    ],
  });
  expect(JSON.stringify(listed)).not.toContain("Consider");
  const step = decodeWorkbenchResult(
    f.records.step(session.id, session.entries[1], session.entries[0], 1, 0),
  );
  expect(step).toMatchObject({
    item: { role: "thinking", text: "Consider [redacted] carefully" },
  });
  expect(JSON.stringify(step)).not.toContain("signature");
});
it("a live turn reports thinking as omitted only when Pi stored it unreadable", () => {
  const f = fixture();
  const session = writeSession(f, [
    { role: "user", content: [{ type: "text", text: "Earlier" }] },
    {
      role: "assistant",
      content: [{ type: "text", text: "Reply" }],
      stopReason: "stop",
    },
  ]);
  const commandId = f.command(
    session.id,
    "running",
    null,
    "Next",
    "",
    session.entries[1],
  );
  const capture = new LiveCapture(() => []);
  capture.accept({
    protocol: 2,
    childRunId: randomUUID(),
    workerSeq: 1,
    observedMs: 0,
    event: {
      kind: "omitted-block",
      block: {
        owner: {
          kind: "message",
          messageId: "m",
          blockId: "b",
          index: 0,
          stage: "final",
        },
        sourceType: "hidden-thinking",
        mimeType: null,
        reason: "hidden-thinking",
      },
    },
  });
  expect(capture.omitted.thinking).toBe(true);
  goLive(f, commandId, capture);
  expect(
    f.records.turnSteps(session.id, session.entries[1], 1, null),
  ).toMatchObject({
    turn: {
      status: "running",
      omitted: { thinking: false, media: false, other: false },
    },
  });
});
it("the head carries the branch's context size, redacted, and a live turn's follows what Pi has written", () => {
  const f = fixture(),
    secret = "fabricated-provider-credential";
  const usage = (totalTokens: number) => ({
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens,
  });
  const session = writeSession(f, [
    { role: "user", content: [{ type: "text", text: "Earlier" }] },
    {
      role: "assistant",
      content: [{ type: "text", text: "Reply" }],
      provider: `gateway-${secret}`,
      model: "fixed",
      usage: usage(1200),
      stopReason: "stop",
    },
  ]);
  const [question, reply] = session.entries;
  f.secrets([secret]);
  expect(
    decodeWorkbenchResult(f.records.conversation(session.id, null, null)),
  ).toMatchObject({
    context: { tokens: 1200, provider: "gateway-[redacted]", model: "fixed" },
  });
  // A branch end no model response precedes claims no figure.
  expect(f.records.conversation(session.id, question, null)).not.toHaveProperty(
    "context",
  );
  // A live turn sent from the reply measures that branch until Pi writes more.
  const commandId = f.command(session.id, "running", null, "Next", "", reply);
  goLive(f, commandId);
  expect(f.records.conversation(session.id, null, null)).toMatchObject({
    leaf: reply,
    context: { tokens: 1200 },
  });
  const row = (id: string, parentId: string, body: object) =>
    `${JSON.stringify({ id, parentId, timestamp: "", ...body })}\n`;
  const marker = {
    type: "custom",
    customType: BROWSER_COMMAND_ENTRY,
    data: { commandId, userId: "0000000a" },
  };
  appendFileSync(
    session.path,
    row("0000000a", reply, {
      type: "message",
      message: { role: "user", content: [{ type: "text", text: "Next" }] },
    }) +
      row("0000000b", "0000000a", marker) +
      row("0000000c", "0000000b", {
        type: "message",
        message: {
          role: "assistant",
          content: [],
          provider: "fixture",
          model: "next",
          usage: usage(2500),
          stopReason: "toolUse",
        },
      }) +
      row("0000000d", "0000000c", marker),
  );
  expect(f.records.conversation(session.id, null, null)).toMatchObject({
    leaf: reply,
    context: { tokens: 2500, provider: "fixture", model: "next" },
  });
});
