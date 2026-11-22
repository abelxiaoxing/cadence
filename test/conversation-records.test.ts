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
import { Writable } from "node:stream";
import { expect, it, vi } from "vitest";
import { ContractError } from "../src/service/contracts/core.ts";
import { decodeWorkbenchResult } from "../src/service/contracts/workbench.ts";
import {
  ConversationRecords,
  observedFile,
} from "../src/service/conversation-records.ts";
import {
  Conversations,
  LiveCapture,
  type LiveTurn,
} from "../src/service/conversations.ts";
import type { ServiceCoordination } from "../src/service/coordination.ts";
import { sessionDirectory } from "../src/service/pi-sessions.ts";
import { PrivateFiles } from "../src/service/private-files.ts";
import { BROWSER_COMMAND_ENTRY } from "../src/session-entries.mjs";
import { CaptureEmitter, SdkCapture } from "../src/worker-capture.mjs";
import type { CaptureFrame } from "../src/worker-public.mjs";
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
  let secrets: string[] | Error = [];
  const active = new Map<string, LiveTurn>();
  const options = {
    coordination,
    cwd,
    agentDir,
    active,
    assertCurrent() {},
    secrets: () => {
      if (secrets instanceof Error) throw secrets;
      return secrets;
    },
  };
  const records = new ConversationRecords(options);
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
    reconnect: () => new ConversationRecords({ ...options, active: new Map() }),
    active,
    files: coordination.files,
    cwd,
    agentDir,
    command,
    secrets(value: string[] | Error) {
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
  const commandId = f.command(id, "queued", null, `Question ${secret}`);
  const capture = new LiveCapture(() => [secret]);
  goLive(f, commandId, capture, "queued");
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
  status: "queued" | "running" = "running",
) {
  const accepted = f.records.accepted(commandId);
  if (accepted?.command.kind !== "send") throw Error("admission");
  const live: LiveTurn = {
    coordinator: false,
    inputs: [],
    worker: null,
    ready: false,
    ended: false,
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
      status,
      notice: "",
      user: null,
      omitted: { thinking: false, media: false, other: false },
    },
    stateFile: null,
    capture,
    abort: new AbortController(),
    original: new Promise(() => {}),
  };
  f.active.set(commandId, live);
  return live;
}
it("live tool activity reapplies current secrets on every read without changing capture or retained files", () => {
  const f = fixture(),
    saved = writeSession(f, [
      { role: "user", content: [{ type: "text", text: "Earlier" }] },
      {
        role: "assistant",
        content: [{ type: "text", text: "Reply" }],
        stopReason: "stop",
      },
    ]),
    secret = "fabricated-activity-credential",
    name = `inspect-${secret}`,
    commandId = f.command(
      saved.id,
      "running",
      null,
      "Next",
      "",
      saved.entries[1],
    ),
    capture = new LiveCapture(() => []),
    live = goLive(f, commandId, capture),
    admission = structuredClone(live.accepted);
  const originals = [
    saved.path,
    f.records.path(commandId, "accepted.json"),
    f.records.path(commandId, "state.json"),
    f.records.indexPath(saved.id),
  ].map((path) => ({
    path,
    bytes: readFileSync(path),
    identity: observedFile(path),
  }));
  const read = () => {
    const raw = f.records.turnSteps(saved.id, saved.entries[1], 1, null);
    const decoded = decodeWorkbenchResult(raw);
    if (
      raw.kind !== "conversation-turn" ||
      decoded.kind !== "conversation-turn"
    )
      throw Error("turn");
    return { raw, decoded };
  };
  expect(read().decoded.turn.activity).toEqual({
    kind: "waiting",
    sequence: 0,
  });
  const frame = {
      protocol: 2 as const,
      childRunId: randomUUID(),
      observedMs: 0,
    },
    callId = randomUUID(),
    start = {
      kind: "tool-start" as const,
      callId,
      source: { disposition: "unavailable" as const, value: null },
      declaration: null,
      name,
      argsDetailId: randomUUID(),
    };
  capture.accept({ ...frame, workerSeq: 1, event: start });
  expect(read().decoded.turn.activity).toEqual({
    kind: "tool",
    sequence: 1,
    name,
  });
  // Only the reader's secret source changes. No new capture event is needed.
  f.secrets([secret]);
  for (const sequence of [1, 2]) {
    if (sequence === 2)
      capture.accept({
        ...frame,
        workerSeq: sequence,
        event: {
          kind: "tool-update",
          callId,
          detailId: randomUUID(),
          semantics: "snapshot",
        },
      });
    const activity = capture.activity,
      before = structuredClone({ activity, preview: capture.extend([]) });
    expect(activity).toEqual({ kind: "tool", sequence, name });
    for (let repeat = 0; repeat < 2; repeat++) {
      const { raw, decoded } = read();
      expect(JSON.stringify([raw, decoded])).not.toContain(secret);
      expect(decoded.turn.activity).toEqual({
        kind: "tool",
        sequence,
        name: "inspect-[redacted]",
      });
      expect(raw.turn.activity).not.toBe(activity);
      expect(capture.activity).toBe(activity);
      expect({
        activity: capture.activity,
        preview: capture.extend([]),
      }).toEqual(before);
      expect(() =>
        decodeWorkbenchResult({
          ...raw,
          turn: {
            ...raw.turn,
            activity: { ...raw.turn.activity, text: "not-allowed" },
          },
        }),
      ).toThrow();
    }
  }
  capture.accept({
    ...frame,
    workerSeq: 3,
    event: { ...start, callId: randomUUID(), name: "read" },
  });
  expect(read().decoded.turn.activity).toEqual({
    kind: "tool",
    sequence: 3,
    name: "read",
  });
  capture.accept({
    ...frame,
    workerSeq: 4,
    event: { kind: "model-retry", progress: null },
  });
  const waiting = read();
  expect(waiting.decoded.turn.activity).toEqual({
    kind: "waiting",
    sequence: 4,
  });
  expect(waiting.raw.turn.activity).not.toBe(capture.activity);
  expect(waiting.raw.turn.activity).not.toHaveProperty("name");
  expect(capture.activity).toEqual({ kind: "waiting", sequence: 4 });
  expect(live.accepted).toEqual(admission);
  for (const { path, bytes, identity } of originals) {
    expect(readFileSync(path)).toEqual(bytes);
    expect(observedFile(path)).toBe(identity);
  }
});

it.each([
  { name: "~xy~".repeat(30), expected: `${"[redacted]".repeat(12)}[redac` },
  {
    name: `${"a".repeat(115)}~xy~🔧end`,
    expected: `${"a".repeat(115)}[redacted]`,
  },
])(
  "activity names are safely bounded after read redaction: $name",
  ({ name, expected }) => {
    const f = fixture(),
      id = randomUUID(),
      commandId = f.command(id, "running", null),
      capture = new LiveCapture(() => []);
    goLive(f, commandId, capture);
    capture.accept({
      protocol: 2,
      childRunId: randomUUID(),
      workerSeq: 1,
      observedMs: 0,
      event: {
        kind: "tool-start",
        callId: randomUUID(),
        source: { disposition: "unavailable", value: null },
        declaration: null,
        name,
        argsDetailId: randomUUID(),
      },
    });
    f.secrets(["~xy~"]);
    // Activity is also returned with an earlier page, independently of tool rows.
    const raw = f.records.turnSteps(id, null, 0, 1),
      decoded = decodeWorkbenchResult(raw);
    expect(JSON.stringify([raw, decoded])).not.toContain("~xy~");
    expect(decoded).toMatchObject({
      turn: { activity: { kind: "tool", sequence: 1, name: expected } },
    });
    expect(Buffer.byteLength(expected)).toBeLessThanOrEqual(128);
    expect(capture.activity).toEqual({ kind: "tool", sequence: 1, name });
  },
);

it.each(
  [
    {
      label: "reader redaction expansion",
      name: "~xy~".repeat(30),
      expected: `${"[redacted]".repeat(12)}[redac`,
      ownerLearns: false,
    },
    {
      label: "owner redaction at a surrogate boundary",
      name: `${"a".repeat(117)}~xy~🔧`,
      expected: `${"a".repeat(117)}[redacted`,
      ownerLearns: true,
    },
  ].flatMap((scenario) =>
    ["final-first", "marker-first"].flatMap((order) =>
      [false, true].map((isError) => ({ ...scenario, order, isError })),
    ),
  ),
)(
  "$label/$order/isError=$isError: full tool pages and lazy details share the current encoded name budget",
  async ({ name, expected, ownerLearns, order, isError }) => {
    const f = fixture(),
      secret = "~xy~",
      saved = writeSession(f, [
        { role: "user", content: [{ type: "text", text: "Question" }] },
      ]),
      commandId = f.command(saved.id, "running", saved.entries[0]);
    let leaf = saved.entries[0],
      serial = 2;
    const append = (type: string, fields: Record<string, unknown>) => {
      const id = (serial++).toString(16).padStart(8, "0");
      appendFileSync(
        saved.path,
        `${JSON.stringify({ type, id, parentId: leaf, timestamp: new Date(1_800_000_000_000).toISOString(), ...fields })}\n`,
      );
      leaf = id;
    };
    const mark = (captureMessageId?: string) =>
      append("custom", {
        customType: BROWSER_COMMAND_ENTRY,
        data: {
          commandId,
          userId: saved.entries[0],
          ...(captureMessageId ? { captureMessageId } : {}),
        },
      });
    mark();
    let ownerSecrets: string[] = [];
    const capture = new LiveCapture(() => ownerSecrets),
      frames: CaptureFrame[] = [],
      emitter = new CaptureEmitter(
        randomUUID(),
        new Writable({
          write(chunk, _encoding, done) {
            const frame = JSON.parse(String(chunk)) as CaptureFrame;
            frames.push(frame);
            capture.accept(frame);
            done();
          },
        }),
        () => {
          throw new Error("capture failed");
        },
      ),
      // The SDK never knows this fabricated secret; its private name/ID join
      // must survive the owner's and reader's independent display redaction.
      sdk = new SdkCapture(emitter),
      live = goLive(f, commandId, capture);
    await emitter.emit({ kind: "ready", requestProtocol: 2 });
    const declaration = {
      role: "assistant",
      stopReason: "toolUse",
      content: [
        { type: "text", text: "Before" },
        {
          type: "toolCall",
          id: "source-call",
          name,
          arguments: { path: "file.ts" },
        },
        { type: "text", text: "After" },
      ],
    };
    await sdk.event({ type: "message_start", message: declaration });
    const declarationId = sdk.messageId!;
    if (ownerLearns) ownerSecrets = [secret];
    for (const contentIndex of [0, 1, 2]) {
      await sdk.event({
        type: "message_update",
        assistantMessageEvent:
          contentIndex === 1
            ? { type: "toolcall_start", contentIndex, partial: declaration }
            : {
                type: "text_delta",
                contentIndex,
                delta: declaration.content[contentIndex].text,
              },
      });
    }
    await sdk.event({ type: "message_end", message: declaration });
    const paths = [
      saved.path,
      f.records.path(commandId, "accepted.json"),
      f.records.path(commandId, "state.json"),
      f.records.indexPath(saved.id),
    ];
    const captureSnapshot = () => ({
      activity: capture.activity,
      preview: capture.extend([]),
      omitted: capture.omitted,
      retry: capture.retry,
      notice: capture.notice,
      frames: frames.length,
      admission: live.accepted,
      state: live.state,
    });
    const filesSnapshot = () =>
      paths.map((path) => ({
        bytes: readFileSync(path),
        identity: observedFile(path),
      }));
    let viewLeaf: string | null = null,
      displayName = ownerLearns ? expected : name;
    const read = (
      state: string,
      output: string,
      reader = f.records,
      before: number | null = null,
    ) => {
      const files = filesSnapshot(),
        snapshot = structuredClone(captureSnapshot()),
        activity = capture.activity;
      if (ownerLearns)
        expect(
          snapshot.preview.items.find((item) => item.role === "tool")?.name,
        ).toBe(expected);
      const raw = reader.turnSteps(saved.id, viewLeaf, 0, before),
        value = decodeWorkbenchResult(raw);
      if (value.kind !== "conversation-turn") throw Error("turn");
      expect(value.start).toBe(0);
      expect(value.turn.steps).toBe(4);
      expect(value.steps.map((step) => step.role)).toEqual(
        ["user", "assistant", "tool", "assistant"].slice(0, before ?? 4),
      );
      expect(value.steps.slice(1).map((step) => step.renderId)).toEqual(
        [0, 1, 2]
          .slice(0, value.steps.length - 1)
          .map((index) => `capture:${declarationId}:${index}`),
      );
      expect(value.steps[1].text).toBe("Before");
      if (before === null) expect(value.steps[3].text).toBe("After");
      const tool = value.steps[2];
      expect(tool).toMatchObject({
        name: displayName,
        state,
        error: state === "failed",
        parts: 1,
        text: "",
      });
      const rawDetail = reader.step(saved.id, viewLeaf, value.turn.id, 2, 0),
        detail = decodeWorkbenchResult(rawDetail);
      if (detail.kind !== "conversation-step") throw Error("step");
      expect(detail.item).toMatchObject({
        name: displayName,
        renderId: tool.renderId,
        version: tool.version,
        state: tool.state,
        error: tool.error,
        args: '{"path":"file.ts"}',
        text: output,
      });
      const names = [tool.name, detail.item.name];
      if (value.turn.activity?.kind === "tool") {
        expect(value.turn.activity).toEqual({ ...activity, name: displayName });
        names.push(value.turn.activity.name!);
      }
      for (const projected of names) {
        expect(
          Buffer.byteLength(JSON.stringify(projected)),
        ).toBeLessThanOrEqual(128);
        expect(projected).not.toMatch(/[\uD800-\uDFFF]/u);
        if (displayName === expected) expect(projected).not.toContain(secret);
      }
      if (displayName === expected)
        expect(JSON.stringify([raw, value, rawDetail, detail])).not.toContain(
          secret,
        );
      expect(capture.activity).toBe(activity);
      expect(captureSnapshot()).toEqual(snapshot);
      expect(filesSnapshot()).toEqual(files);
      return { raw, value, tool, rawDetail, detail };
    };
    read("pending", "");
    const execution = { toolCallId: "source-call", toolName: name };
    await sdk.event({
      type: "tool_execution_start",
      ...execution,
      args: { path: "file.ts" },
    });
    const started = read("running", ""),
      sequence = capture.activity.sequence;
    expect(started.value.turn.activity).toEqual({
      kind: "tool",
      sequence,
      name: displayName,
    });
    // No capture event or durable append accompanies the reader's new secrets.
    f.secrets([secret]);
    displayName = expected;
    for (let repeat = 0; repeat < 2; repeat++) {
      const current = read("running", "");
      expect(current.value.turn.activity).toEqual({
        kind: "tool",
        sequence,
        name: expected,
      });
      expect(current.tool.renderId).toBe(started.tool.renderId);
      expect(current.tool.parts).toBe(started.tool.parts);
      // Display-name redaction does not change the arguments/output version.
      expect(current.tool.version).toBe(started.tool.version);
    }
    const current = read("running", "");
    // Neither display clipping nor the fixture may relax the public decoder.
    for (const changes of [{ name: "n".repeat(129) }, { unknown: true }]) {
      expect(() =>
        decodeWorkbenchResult({
          ...current.raw,
          steps: current.value.steps.map((step, index) =>
            index === 2 ? { ...step, ...changes } : step,
          ),
        }),
      ).toThrow();
      expect(() =>
        decodeWorkbenchResult({
          ...current.rawDetail,
          item: { ...current.detail.item, ...changes },
        }),
      ).toThrow();
      expect(() =>
        decodeWorkbenchResult({
          ...current.raw,
          turn: {
            ...current.value.turn,
            activity: { ...current.value.turn.activity, ...changes },
          },
        }),
      ).toThrow();
    }
    for (const text of ["First snapshot", "Second snapshot"]) {
      await sdk.event({
        type: "tool_execution_update",
        ...execution,
        partialResult: { content: [{ type: "text", text }] },
      });
      const updated = read("running", text);
      expect(updated.tool.parts).toBe(current.tool.parts);
      expect(updated.tool.version).not.toBe(current.tool.version);
      current.tool = updated.tool;
    }
    // The finalized declaration is still a preview. An unmarked Pi append
    // cannot replace it or duplicate it, including after read-time redaction.
    const preview = read("running", "Second snapshot");
    append("message", { message: declaration });
    expect(read("running", "Second snapshot").value.steps).toEqual(
      preview.value.steps,
    );
    const declarationEntry = leaf;
    mark(declarationId);
    const durable = read("running", "Second snapshot");
    // Pi replaces read coordinates, not render identities or displayed data.
    expect(durable.value.steps.map((step) => step.id)).toEqual([
      saved.entries[0],
      `${declarationEntry}:0`,
      "source-call",
      `${declarationEntry}:2`,
    ]);
    expect(durable.value.steps).toMatchObject(
      preview.value.steps.map(({ id: _id, ...step }) => step),
    );
    const result = { content: [{ type: "text", text: "Final output" }] };
    await sdk.event({
      type: "tool_execution_end",
      ...execution,
      isError,
      result,
    });
    const state = isError ? "failed" : "completed",
      ended = read(state, "Final output");
    expect(ended.tool.parts).toBe(current.tool.parts);
    expect(ended.tool.version).not.toBe(current.tool.version);
    // All owner-ingress name assignments, not just the read projection, use
    // scalar-safe encoded clipping after the owner learns the secret.
    if (ownerLearns) {
      const tool = capture
        .extend([])
        .items.find((item) => item.role === "tool")!;
      expect(tool.name).toBe(expected);
      expect(tool.name).not.toMatch(/[\uD800-\uDFFF]/u);
    }
    const calls = frames
      .map((frame) => frame.event)
      .filter(
        (event) =>
          event.kind === "call-declaration" ||
          event.kind === "tool-start" ||
          event.kind === "tool-end",
      );
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls.every((event) => event.name === name)).toBe(true);
    expect(new Set(calls.map((event) => event.callId)).size).toBe(1);
    const resultMessage = {
      role: "toolResult",
      ...execution,
      isError,
      ...result,
    };
    await sdk.event({ type: "message_start", message: resultMessage });
    const resultId = sdk.messageId!,
      finish = () => sdk.event({ type: "message_end", message: resultMessage });
    if (order === "final-first") await finish();
    const beforePi = read(state, "Final output");
    append("message", { message: resultMessage });
    expect(read(state, "Final output").value.steps).toEqual(
      beforePi.value.steps,
    );
    mark(resultId);
    const handed = read(state, "Final output");
    if (order === "marker-first") await finish();
    expect(read(state, "Final output").value.steps).toEqual(handed.value.steps);
    expect(handed.value.steps).toEqual(ended.value.steps);
    live.state.status = "completed";
    const terminal = read(state, "Final output");
    expect(terminal.value.turn.status).toBe("completed");
    expect(terminal.value.steps).toEqual(handed.value.steps);
    f.active.delete(commandId);
    writeFileSync(
      f.records.path(commandId, "state.json"),
      JSON.stringify({ ...live.state, user: saved.entries[0] }),
    );
    const cold = f.reconnect(),
      files = filesSnapshot(),
      snapshot = structuredClone(captureSnapshot()),
      reconnected = decodeWorkbenchResult(
        cold.conversation(saved.id, null, null),
      );
    expect(filesSnapshot()).toEqual(files);
    expect(captureSnapshot()).toEqual(snapshot);
    if (reconnected.kind !== "conversation") throw Error("conversation");
    viewLeaf = reconnected.leaf;
    const final = read(state, "Final output", cold);
    expect(final.value.turn).toMatchObject({ status: "completed", stable: 4 });
    expect(final.value.turn).not.toHaveProperty("activity");
    expect(final.value.steps).toEqual(terminal.value.steps);
    expect(read(state, "Final output", cold, 3).value.steps).toEqual(
      final.value.steps.slice(0, 3),
    );
  },
);

it.each([
  { error: new Error("unreadable fixture secrets"), code: "unavailable" },
  { error: new ContractError("corrupt-selected"), code: "corrupt-selected" },
])(
  "activity reads retain secret-source refusal and last-known behavior: $code",
  ({ error, code }) => {
    const f = fixture(),
      id = randomUUID(),
      commandId = f.command(id, "running", null),
      capture = new LiveCapture(() => []);
    goLive(f, commandId, capture);
    capture.accept({
      protocol: 2,
      childRunId: randomUUID(),
      workerSeq: 1,
      observedMs: 0,
      event: {
        kind: "tool-start",
        callId: randomUUID(),
        source: { disposition: "unavailable", value: null },
        declaration: null,
        name: "inspect-fabricated-activity-credential",
        argsDetailId: randomUUID(),
      },
    });
    const read = () =>
      decodeWorkbenchResult(f.records.turnSteps(id, null, 0, null));
    f.secrets(error);
    expect(read).toThrow(code);
    f.secrets(["fabricated-activity-credential"]);
    const known = read();
    expect(known).toMatchObject({
      turn: {
        activity: { kind: "tool", sequence: 1, name: "inspect-[redacted]" },
      },
    });
    f.secrets(error);
    expect(read()).toEqual(known);
    expect(capture.activity.name).toBe(
      "inspect-fabricated-activity-credential",
    );
  },
);

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
    cache: { input: 1, read: 0, write: 0 },
  });
  // A branch end no model response precedes claims no figure; the cache
  // totals are the whole session's, whichever branch is read.
  const earlier = f.records.conversation(session.id, question, null);
  expect(earlier).not.toHaveProperty("context");
  expect(earlier).toMatchObject({ cache: { input: 1, read: 0, write: 0 } });
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
    cache: { input: 2, read: 0, write: 0 },
  });
  // A session whose file records no usage states no totals.
  const silent = writeSession(f, [
    { role: "user", content: [{ type: "text", text: "Unanswered" }] },
  ]);
  expect(f.records.conversation(silent.id, null, null)).not.toHaveProperty(
    "cache",
  );
});
it("a turn names the entry its user message continues; a live one its admitted head until Pi writes the message", () => {
  const f = fixture();
  const said = (role: string, text: string) => ({
    role,
    content: [{ type: "text", text }],
    ...(role === "assistant" ? { stopReason: "stop" } : {}),
  });
  const session = writeSession(f, [
    said("user", "Earlier"),
    said("assistant", "Reply"),
    said("user", "Again"),
    said("assistant", "Second"),
  ]);
  const [first, reply, again, second] = session.entries;
  const header = (leaf: string, ordinal: number) => {
    const read = decodeWorkbenchResult(
      f.records.turnSteps(session.id, leaf, ordinal, null),
    );
    if (read.kind !== "conversation-turn") throw Error("turn");
    return read.turn;
  };
  expect(header(second, 0)).toMatchObject({ id: first, parent: null });
  expect(header(second, 1)).toMatchObject({ id: again, parent: reply });
  // An edited message is sent from the entry the original continued.
  const commandId = f.command(session.id, "running", null, "Edited", "", reply);
  goLive(f, commandId);
  expect(header(reply, 1)).toMatchObject({
    id: commandId,
    parent: reply,
    entry: null,
  });
  // Pi records a model change between that head and the message it writes.
  const row = (id: string, parentId: string, body: object) =>
    `${JSON.stringify({ id, parentId, timestamp: "", ...body })}\n`;
  appendFileSync(
    session.path,
    row("0000000a", reply, {
      type: "model_change",
      provider: "fixture",
      modelId: "next",
    }) +
      row("0000000b", "0000000a", {
        type: "message",
        message: said("user", "Edited"),
      }) +
      row("0000000c", "0000000b", {
        type: "custom",
        customType: BROWSER_COMMAND_ENTRY,
        data: { commandId, userId: "0000000b" },
      }),
  );
  expect(header(reply, 1)).toMatchObject({
    id: "0000000b",
    parent: "0000000a",
  });
});
it("archived sessions leave the history and its pages, and are listed alone on request", () => {
  const f = fixture(),
    seeded = seedPiSessions(sessionDirectory(f.cwd, f.agentDir), f.cwd, 120);
  // Newest first; archive one row of the first page and one of the last.
  const newest = [...seeded.ids].reverse(),
    hidden = [newest[10], newest[115]];
  const record = (id: string) => f.records.archivePath(id);
  for (const id of hidden)
    f.files.create(
      record(id),
      JSON.stringify({ schema: "cadence-conversation-archive/1", id, at: 1 }),
    );
  const pages = (archived: boolean) => {
    const rows: { id: string; archived?: true }[] = [],
      sizes: number[] = [];
    let after: Parameters<typeof f.records.list>[0] = null;
    for (;;) {
      const page = f.records.list(after, archived);
      if (page.kind !== "conversations") throw Error("listing");
      decodeWorkbenchResult(page);
      rows.push(...page.entries);
      sizes.push(page.entries.length);
      if (!page.next) return { rows, sizes };
      after = page.next;
    }
  };
  const shown = pages(false);
  expect(shown.rows.map((row) => row.id)).toEqual(
    newest.filter((id) => !hidden.includes(id)),
  );
  // Filtered before paging: full pages, nothing skipped or repeated.
  expect(shown.sizes).toEqual([50, 50, 18]);
  expect(shown.rows.some((row) => "archived" in row)).toBe(false);
  expect(pages(true).rows).toMatchObject(
    hidden.map((id) => ({ id, archived: true })),
  );
  // A link to an archived conversation still reads, and says what it is.
  expect(f.records.conversation(hidden[0], null, null)).toMatchObject({
    summary: { id: hidden[0], archived: true },
    turns: 1,
  });
  expect(f.records.conversation(newest[0], null, null)).not.toHaveProperty(
    "summary.archived",
  );
  // Listed again once its record is gone.
  const kept = f.files.read(record(hidden[0]));
  if (!kept) throw Error("record");
  f.files.remove(record(hidden[0]), kept);
  expect(pages(true).rows.map((row) => row.id)).toEqual([hidden[1]]);
  expect(pages(false).rows).toHaveLength(119);
  // Private state is closed: a stray name is refused, never skipped.
  f.files.create(join(record(hidden[1]), "..", "notes.txt"), "stray");
  expect(() => f.records.list()).toThrow("corrupt-selected");
});
it("a reply the previous owner's death interrupted does not refuse the next start; a recorded unknown closure still does", () => {
  const f = fixture();
  const owner = (g: ReturnType<typeof fixture>) =>
    Object.assign(Object.create(Conversations.prototype), {
      o: {
        owner: { lease: { assert() {} } },
        coordination: { files: g.files },
      },
      records: g.records,
    }) as Conversations;
  // Nothing was ever sent: nothing to settle.
  expect(() => owner(f).assertSettled()).not.toThrow();
  for (const [persisted, refuses] of [
    ["completed", false],
    ["failed", false],
    // Cut short by the owner's death: startup healing stopped its worker.
    ["starting", false],
    ["queued", false],
    ["running", false],
    // An owner recorded that it could not establish closure itself.
    ["unknown", true],
  ] as const) {
    const g = fixture(),
      id = randomUUID();
    const command = g.command(id, persisted, null);
    const path = g.records.path(command, "state.json");
    const before = readFileSync(path);
    const start = () => owner(g).assertSettled();
    if (refuses) expect(start, persisted).toThrow("quarantine");
    else expect(start, persisted).not.toThrow();
    if (["starting", "queued", "running"].includes(persisted)) {
      const observed = {
        status: "unknown",
        notice: expect.stringContaining("Interrupted"),
      };
      expect(g.records.state(command)).toMatchObject(observed);
      expect(
        decodeWorkbenchResult(g.records.conversation(id, null, null)),
      ).toMatchObject({
        attempt: { commandId: command, ...observed },
        turns: 0,
      });
      expect(g.records.activeConversations().entries).toEqual([]);
    }
    expect(readFileSync(path)).toEqual(before);
  }
});

it.each(["final-first", "marker-first"])(
  "identity handoff %s: unmarked Pi tail never duplicates or clears the visible reply",
  async (order) => {
    const f = fixture(),
      saved = writeSession(f, [
        { role: "user", content: [{ type: "text", text: "Question" }] },
      ]);
    const commandId = f.command(saved.id, "running", saved.entries[0]);
    let leaf = saved.entries[0],
      serial = 2;
    const append = (type: string, fields: Record<string, unknown>) => {
      const id = (serial++).toString(16).padStart(8, "0");
      appendFileSync(
        saved.path,
        `${JSON.stringify({ type, id, parentId: leaf, timestamp: new Date(1_800_000_000_000).toISOString(), ...fields })}\n`,
      );
      leaf = id;
    };
    const mark = (captureMessageId?: string) =>
      append("custom", {
        customType: BROWSER_COMMAND_ENTRY,
        data: {
          commandId,
          userId: saved.entries[0],
          ...(captureMessageId ? { captureMessageId } : {}),
        },
      });
    mark();
    const live = new LiveCapture(() => []);
    const emitter = new CaptureEmitter(
      randomUUID(),
      new Writable({
        write(chunk, _encoding, done) {
          live.accept(JSON.parse(String(chunk)));
          done();
        },
      }),
      () => {
        throw new Error("capture failed");
      },
    );
    const sdk = new SdkCapture(emitter);
    goLive(f, commandId, live);
    await emitter.emit({ kind: "ready", requestProtocol: 2 });
    await sdk.event({ type: "message_start", message: { role: "assistant" } });
    const captureMessageId = sdk.messageId!;
    const text = "Already visible answer. ".repeat(12);
    await sdk.event({
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: 0,
        delta: text,
      },
    });
    await sdk.event({
      type: "message_update",
      assistantMessageEvent: { type: "thinking_start", contentIndex: 1 },
    });
    let viewLeaf: string | null = null;
    const read = (before: number | null = null) => {
      const value = decodeWorkbenchResult(
        f.records.turnSteps(saved.id, viewLeaf, 0, before),
      );
      if (value.kind !== "conversation-turn") throw new Error("turn");
      return value;
    };
    const initial = read();
    expect(initial.steps.map((s) => s.role)).toEqual([
      "user",
      "assistant",
      "thinking",
    ]);
    expect(initial.steps[1].text.length).toBeGreaterThan(0);
    expect(initial.steps[2]).toMatchObject({
      parts: 0,
      state: "streaming",
      text: "",
    });
    expect(initial.turn.activity).toMatchObject({ kind: "thinking" });
    const message = {
      role: "assistant",
      stopReason: "stop",
      content: [
        { type: "text", text },
        {
          type: "thinking",
          thinking: "Pi-only readable reasoning",
          thinkingSignature: "never-public",
        },
        { type: "text", text: "Last" },
      ],
    };
    const finish = () => sdk.event({ type: "message_end", message });
    if (order === "final-first") await finish();
    const beforePi = read();
    append("message", { message });
    // Pi writes before the SDK subscriber's marker and before final capture.
    expect(read().steps).toEqual(beforePi.steps);
    mark(captureMessageId);
    const handed = read();
    expect(handed.steps.map((s) => s.role)).toEqual([
      "user",
      "assistant",
      "thinking",
      "assistant",
    ]);
    expect(handed.steps[1]).toMatchObject({
      text,
      renderId: initial.steps[1].renderId,
    });
    expect(handed.steps[2]).toMatchObject({
      text: "",
      parts: 1,
      renderId: initial.steps[2].renderId,
      state: "completed",
    });
    expect(JSON.stringify(handed)).not.toContain("Pi-only");
    expect(JSON.stringify(handed)).not.toContain("never-public");
    if (order === "marker-first") await finish();
    expect(read().steps).toEqual(handed.steps);
    expect(read(2).steps).toEqual(handed.steps.slice(0, 2));
    // Reconnect/cold observation retains the exact same presentation identities.
    f.active.delete(commandId);
    writeFileSync(
      f.records.path(commandId, "state.json"),
      JSON.stringify({
        status: "completed",
        notice: "",
        user: saved.entries[0],
        omitted: { thinking: true, media: false, other: false },
      }),
    );
    f.records.closeReads();
    const reconnected = f.records.conversation(saved.id, null, null);
    if (reconnected.kind !== "conversation") throw new Error("conversation");
    viewLeaf = reconnected.leaf;
    expect(read().steps).toEqual(handed.steps);
    expect(
      decodeWorkbenchResult(
        f.records.step(saved.id, viewLeaf, saved.entries[0], 2, 0),
      ),
    ).toMatchObject({
      item: {
        text: "Pi-only readable reasoning",
        renderId: initial.steps[2].renderId,
      },
    });
  },
);

it.each(["completed", "failed", "canceled"])(
  "a settled %s reply never reports a declared tool without a result as successful or still running",
  (status) => {
    const f = fixture(),
      saved = writeSession(f, [
        { role: "user", content: [{ type: "text", text: "q" }] },
        {
          role: "assistant",
          stopReason: "toolUse",
          content: [
            { type: "toolCall", id: "call", name: "read", arguments: {} },
          ],
        },
      ]);
    f.command(saved.id, status, saved.entries[0]);
    const value = decodeWorkbenchResult(
      f.records.turnSteps(saved.id, saved.entries[1], 0, null),
    );
    expect(value).toMatchObject({
      turn: { status },
      steps: [
        { role: "user" },
        {
          role: "tool",
          state: status === "canceled" ? "canceled" : "unavailable",
        },
      ],
    });
  },
);

it.each(
  ["error", "length", "aborted"].flatMap((stopReason) =>
    ["final-first", "marker-first"].map((order) => ({ stopReason, order })),
  ),
)(
  "$stopReason/$order: an unexecuted declaration stays neutral across Pi handoff, retry and cold reads",
  async ({ stopReason, order }) => {
    const f = fixture(),
      saved = writeSession(f, [
        { role: "user", content: [{ type: "text", text: "Question" }] },
      ]),
      commandId = f.command(saved.id, "running", saved.entries[0]);
    let leaf = saved.entries[0],
      serial = 2;
    const append = (type: string, fields: Record<string, unknown>) => {
      const id = (serial++).toString(16).padStart(8, "0");
      appendFileSync(
        saved.path,
        `${JSON.stringify({ type, id, parentId: leaf, timestamp: new Date(1_800_000_000_000).toISOString(), ...fields })}\n`,
      );
      leaf = id;
    };
    const mark = (captureMessageId?: string) =>
      append("custom", {
        customType: BROWSER_COMMAND_ENTRY,
        data: {
          commandId,
          userId: saved.entries[0],
          ...(captureMessageId ? { captureMessageId } : {}),
        },
      });
    mark();
    const capture = new LiveCapture(() => []);
    const events: import("../src/worker-public.mjs").CaptureFrame["event"][] =
      [];
    const emitter = new CaptureEmitter(
      randomUUID(),
      new Writable({
        write(chunk, _encoding, done) {
          const frame = JSON.parse(String(chunk));
          events.push(frame.event);
          capture.accept(frame);
          done();
        },
      }),
      () => {
        throw new Error("capture failed");
      },
    );
    const sdk = new SdkCapture(emitter),
      live = goLive(f, commandId, capture);
    await emitter.emit({ kind: "ready", requestProtocol: 2 });
    const record = async (message: Record<string, unknown>) => {
      await sdk.event({ type: "message_start", message });
      const id = sdk.messageId!;
      await sdk.event({ type: "message_end", message });
      append("message", { message });
      mark(id);
    };
    // Real SDK capture observations and matching Pi results are controls: neither
    // a later failed response nor cancellation can overwrite their tool outcomes.
    await record({
      role: "assistant",
      stopReason: "toolUse",
      content: [
        { type: "toolCall", id: "success", name: "read", arguments: {} },
        { type: "toolCall", id: "failure", name: "read", arguments: {} },
      ],
    });
    for (const [toolCallId, isError] of [
      ["success", false],
      ["failure", true],
    ] as const) {
      await sdk.event({
        type: "tool_execution_start",
        toolCallId,
        toolName: "read",
        args: {},
      });
      const result = {
        content: [{ type: "text", text: `${toolCallId} output` }],
      };
      await sdk.event({
        type: "tool_execution_end",
        toolCallId,
        toolName: "read",
        isError,
        result,
      });
      await record({
        role: "toolResult",
        toolCallId,
        toolName: "read",
        isError,
        ...result,
      });
    }
    const controlsEnd = events.length;
    const message = {
      role: "assistant",
      stopReason,
      errorMessage: "Model request failed",
      content: [
        { type: "text", text: "Before declaration" },
        {
          type: "toolCall",
          id: "not-executed",
          name: "read",
          arguments: { path: "file.ts" },
        },
        { type: "text", text: "After declaration" },
      ],
    };
    await sdk.event({ type: "message_start", message });
    const captureMessageId = sdk.messageId!;
    for (const contentIndex of [0, 1, 2]) {
      await sdk.event({
        type: "message_update",
        assistantMessageEvent:
          contentIndex === 1
            ? { type: "toolcall_start", contentIndex, partial: message }
            : {
                type: "text_delta",
                contentIndex,
                delta: message.content[contentIndex].text,
              },
      });
    }
    let viewLeaf: string | null = null;
    const paths = [
      saved.path,
      f.records.path(commandId, "accepted.json"),
      f.records.path(commandId, "state.json"),
      f.records.indexPath(saved.id),
    ];
    const read = (before: number | null = null, reader = f.records) => {
      const original = paths.map((path) => readFileSync(path));
      const value = decodeWorkbenchResult(
        reader.turnSteps(saved.id, viewLeaf, 0, before),
      );
      if (value.kind !== "conversation-turn") throw Error("turn");
      for (const [index, step] of value.steps.entries()) {
        if (step.role !== "tool") continue;
        // A partial declaration without arguments has no readable detail yet.
        if (step.parts === 0) {
          expect(index).toBe(4);
          expect(step).toMatchObject({ state: "pending", error: false });
          expect(() =>
            reader.step(
              saved.id,
              viewLeaf,
              value.turn.id,
              value.start + index,
              0,
            ),
          ).toThrow("stale");
          continue;
        }
        expect(step.parts).toBe(1);
        expect(step.text).toBe("");
        const detail = decodeWorkbenchResult(
          reader.step(
            saved.id,
            viewLeaf,
            value.turn.id,
            value.start + index,
            0,
          ),
        );
        expect(detail).toMatchObject({
          item: {
            renderId: step.renderId,
            state: step.state,
            error: step.error,
            version: step.version,
          },
        });
        if (detail.kind !== "conversation-step") throw Error("step");
        expect(detail.item.text).toBe(
          index === 1 ? "success output" : index === 2 ? "failure output" : "",
        );
        if (index === 4 && step.state !== "pending")
          expect(detail.item.args).toBe('{"path":"file.ts"}');
      }
      expect(paths.map((path) => readFileSync(path))).toEqual(original);
      return value;
    };
    const initial = read();
    const roles = ["user", "tool", "tool", "assistant", "tool", "assistant"];
    const checkTools = (
      value: ReturnType<typeof read>,
      declarationState: string,
    ) => {
      expect(value.steps.map((step) => step.role)).toEqual(
        roles.slice(0, value.steps.length),
      );
      expect(
        value.steps
          .filter((step) => step.role === "tool")
          .map((step) => [step.state, step.error]),
      ).toEqual([
        ["completed", false],
        ["failed", true],
        [declarationState, false],
      ]);
      expect(value.steps.map((step) => step.renderId)).toEqual(
        initial.steps.slice(0, value.steps.length).map((step) => step.renderId),
      );
      expect(value.steps[4].renderId).toBe(`capture:${captureMessageId}:1`);
    };
    checkTools(initial, "pending");
    const finish = () => sdk.event({ type: "message_end", message });
    if (order === "final-first") await finish();
    const beforePi = read(),
      state = stopReason === "aborted" ? "canceled" : "unavailable";
    checkTools(beforePi, order === "final-first" ? state : "pending");
    append("message", { message });
    // Pi's body exists, but until the marker it cannot replace/duplicate capture.
    expect(read().steps).toEqual(beforePi.steps);
    mark(captureMessageId);
    const handed = read();
    checkTools(handed, state);
    expect(handed.turn.status).toBe("running");
    expect(handed.steps[3]).toMatchObject({
      text: "Before declaration",
      state: stopReason === "aborted" ? "canceled" : "failed",
      error: true,
    });
    expect(handed.steps[5]).toMatchObject({
      text: "After declaration",
      state: handed.steps[3].state,
      error: true,
    });
    if (order === "marker-first") await finish();
    expect(read().steps).toEqual(handed.steps);
    if (stopReason !== "aborted") {
      const progress = {
        phase: "waiting" as const,
        attempt: 2,
        maxAttempts: 6,
        delayMs: 10000,
      };
      await emitter.emit({ kind: "model-retry", progress });
      for (const observation of [read(), read(5)]) {
        checkTools(observation, state);
        expect(observation.turn).toMatchObject({
          status: "running",
          retry: progress,
        });
      }
      await emitter.emit({ kind: "model-retry", progress: null });
    }
    checkTools(read(5), state);
    expect(read(5).steps).toEqual(handed.steps.slice(0, 5));
    // No execution/result event exists for the declaration under test.
    expect(
      events
        .slice(controlsEnd)
        .filter(
          (event) =>
            event.kind === "tool-start" ||
            event.kind === "tool-end" ||
            (event.kind === "message-start" && event.role === "tool-result"),
        ),
    ).toEqual([]);
    live.state.status = stopReason === "aborted" ? "canceled" : "failed";
    checkTools(read(), state);
    expect(read().turn.status).toBe(live.state.status);
    f.active.delete(commandId);
    writeFileSync(
      f.records.path(commandId, "state.json"),
      JSON.stringify({
        ...live.state,
        user: saved.entries[0],
        notice: "Owner settlement",
      }),
    );
    const cold = f.reconnect();
    const original = paths.map((path) => readFileSync(path));
    const reconnected = decodeWorkbenchResult(
      cold.conversation(saved.id, null, null),
    );
    expect(paths.map((path) => readFileSync(path))).toEqual(original);
    if (reconnected.kind !== "conversation") throw Error("conversation");
    viewLeaf = reconnected.leaf;
    expect(reconnected.summary?.status).toBe(live.state.status);
    const final = read(null, cold);
    checkTools(final, state);
    expect(final.steps).toEqual(handed.steps);
    expect(final.turn).toMatchObject({
      status: live.state.status,
      notice:
        stopReason === "error" ? "Model request failed" : "Owner settlement",
    });
    expect(read(5, cold).steps).toEqual(final.steps.slice(0, 5));
  },
);

it.each(
  [127, 128].flatMap((length) =>
    ["final-first", "marker-first"].flatMap((order) =>
      [false, true].map((isError) => ({ length, order, isError })),
    ),
  ),
)(
  "$length-byte tool name/$order/isError=$isError: durable association survives without the live overlay",
  async ({ length, order, isError }) => {
    const f = fixture(),
      saved = writeSession(f, [
        { role: "user", content: [{ type: "text", text: "Question" }] },
      ]),
      commandId = f.command(saved.id, "running", saved.entries[0]),
      name = "n".repeat(length);
    let leaf = saved.entries[0],
      serial = 2;
    const append = (type: string, fields: Record<string, unknown>) => {
      const id = (serial++).toString(16).padStart(8, "0");
      appendFileSync(
        saved.path,
        `${JSON.stringify({ type, id, parentId: leaf, timestamp: new Date(1_800_000_000_000).toISOString(), ...fields })}\n`,
      );
      leaf = id;
    };
    const mark = (captureMessageId?: string) =>
      append("custom", {
        customType: BROWSER_COMMAND_ENTRY,
        data: {
          commandId,
          userId: saved.entries[0],
          ...(captureMessageId ? { captureMessageId } : {}),
        },
      });
    mark();
    const capture = new LiveCapture(() => []);
    const emitter = new CaptureEmitter(
      randomUUID(),
      new Writable({
        write(chunk, _encoding, done) {
          capture.accept(JSON.parse(String(chunk)));
          done();
        },
      }),
      () => {
        throw new Error("capture failed");
      },
    );
    const sdk = new SdkCapture(emitter),
      live = goLive(f, commandId, capture);
    await emitter.emit({ kind: "ready", requestProtocol: 2 });
    const declaration = {
      role: "assistant",
      stopReason: "toolUse",
      content: [
        { type: "text", text: "Before" },
        {
          type: "toolCall",
          id: "source-call",
          name,
          arguments: { path: "file.ts" },
        },
        { type: "text", text: "After" },
      ],
    };
    await sdk.event({ type: "message_start", message: declaration });
    const declarationId = sdk.messageId!;
    for (const contentIndex of [0, 1, 2]) {
      await sdk.event({
        type: "message_update",
        assistantMessageEvent:
          contentIndex === 1
            ? { type: "toolcall_start", contentIndex, partial: declaration }
            : {
                type: "text_delta",
                contentIndex,
                delta: declaration.content[contentIndex].text,
              },
      });
    }
    let viewLeaf: string | null = null;
    const paths = [
      saved.path,
      f.records.path(commandId, "accepted.json"),
      f.records.path(commandId, "state.json"),
      f.records.indexPath(saved.id),
    ];
    const read = (before: number | null = null, reader = f.records) => {
      const original = paths.map((path) => readFileSync(path));
      const value = decodeWorkbenchResult(
        reader.turnSteps(saved.id, viewLeaf, 0, before),
      );
      if (value.kind !== "conversation-turn") throw Error("turn");
      const tools = value.steps.filter((step) => step.role === "tool");
      expect(tools).toHaveLength(1);
      expect(value.turn.steps).toBe(4);
      expect(value.start).toBe(0);
      expect(value.steps.map((step) => step.role)).toEqual(
        ["user", "assistant", "tool", "assistant"].slice(0, before ?? 4),
      );
      for (const [index, text] of [
        [1, "Before"],
        [3, "After"],
      ] as const) {
        const step = value.steps[index];
        if (step)
          // Genuine capture retains these short deltas in its sanitizer tail
          // until message-end; durable/final text must then be complete.
          expect(step.text).toBe(step.state === "streaming" ? "" : text);
      }
      expect(value.steps.slice(1).map((step) => step.renderId)).toEqual(
        [0, 1, 2]
          .slice(0, value.steps.length - 1)
          .map((index) => `capture:${declarationId}:${index}`),
      );
      const tool = tools[0];
      expect(tool.text).toBe("");
      expect(Buffer.byteLength(tool.name)).toBeLessThanOrEqual(128);
      let output = "";
      if (tool.parts) {
        expect(tool.parts).toBe(1);
        const detail = decodeWorkbenchResult(
          reader.step(saved.id, viewLeaf, value.turn.id, 2, 0),
        );
        if (detail.kind !== "conversation-step") throw Error("step");
        expect(detail.item).toMatchObject({
          name: tool.name,
          renderId: tool.renderId,
          version: tool.version,
          state: tool.state,
          error: tool.error,
          args: '{"path":"file.ts"}',
        });
        output = detail.item.text;
      } else {
        expect(tool.state).toBe("pending");
        expect(() =>
          reader.step(saved.id, viewLeaf, value.turn.id, 2, 0),
        ).toThrow("stale");
      }
      expect(paths.map((path) => readFileSync(path))).toEqual(original);
      return { value, tool, output };
    };
    const check = (
      state: string,
      output: string,
      before: number | null = null,
      reader = f.records,
    ) => {
      const observed = read(before, reader);
      expect(observed.tool).toMatchObject({ state, error: state === "failed" });
      expect(observed.output).toBe(output);
      return observed;
    };
    check("pending", "");
    // Exercise both orders for the declaration AND result message. A raw Pi
    // append must be withheld until its command-owned marker becomes visible.
    const handoff = async (
      message: Record<string, unknown>,
      captureMessageId: string,
      state: string,
      output: string,
    ) => {
      const finish = () => sdk.event({ type: "message_end", message });
      if (order === "final-first") await finish();
      const beforePi = check(state, output);
      append("message", { message });
      expect(check(state, output).value.steps).toEqual(beforePi.value.steps);
      mark(captureMessageId);
      const handed = check(state, output);
      if (order === "marker-first") await finish();
      expect(check(state, output).value.steps).toEqual(handed.value.steps);
      return handed;
    };
    const declared = await handoff(declaration, declarationId, "pending", "");
    expect(declared.tool.name).toBe("n".repeat(126));
    await sdk.event({
      type: "tool_execution_start",
      toolCallId: "source-call",
      toolName: name,
      args: { path: "file.ts" },
    });
    check("running", "");
    await sdk.event({
      type: "tool_execution_update",
      toolCallId: "source-call",
      toolName: name,
      partialResult: { content: [{ type: "text", text: "Partial output" }] },
    });
    const running = check("running", "Partial output");
    const result = { content: [{ type: "text", text: "Recorded output" }] };
    await sdk.event({
      type: "tool_execution_end",
      toolCallId: "source-call",
      toolName: name,
      isError,
      result,
    });
    const state = isError ? "failed" : "completed";
    const ended = check(state, "Recorded output");
    expect(ended.tool.parts).toBe(running.tool.parts);
    expect(ended.tool.version).not.toBe(running.tool.version);
    const resultMessage = {
      role: "toolResult",
      toolCallId: "source-call",
      toolName: name,
      isError,
      ...result,
    };
    await sdk.event({ type: "message_start", message: resultMessage });
    const handed = await handoff(
      resultMessage,
      sdk.messageId!,
      state,
      "Recorded output",
    );
    expect(handed.tool.name).toBe("n".repeat(126));
    expect(handed.value.turn.status).toBe("running");
    expect(check(state, "Recorded output", 3).value.steps).toEqual(
      handed.value.steps.slice(0, 3),
    );
    // Reply completion is independent of the tool result. A new cold reader has
    // no LiveCapture to repair/mask a broken durable association.
    live.state.status = "completed";
    const settled = check(state, "Recorded output");
    expect(settled.value.turn.status).toBe("completed");
    f.active.delete(commandId);
    writeFileSync(
      f.records.path(commandId, "state.json"),
      JSON.stringify({ ...live.state, user: saved.entries[0] }),
    );
    const cold = f.reconnect(),
      original = paths.map((path) => readFileSync(path));
    const reconnected = decodeWorkbenchResult(
      cold.conversation(saved.id, null, null),
    );
    expect(paths.map((path) => readFileSync(path))).toEqual(original);
    if (reconnected.kind !== "conversation") throw Error("conversation");
    viewLeaf = reconnected.leaf;
    expect(reconnected.summary?.status).toBe("completed");
    const final = check(state, "Recorded output", null, cold);
    expect(final.value.turn).toMatchObject({ status: "completed", stable: 4 });
    expect(final.value.steps).toEqual(handed.value.steps);
    expect(check(state, "Recorded output", 3, cold).value.steps).toEqual(
      final.value.steps.slice(0, 3),
    );
  },
);

const independentExecutions = [
  { label: "no declaration", names: [], name: "read", start: true },
  { label: "end without start", names: [], name: "read", start: false },
  {
    label: "duplicate declarations",
    names: ["read", "read"],
    name: "read",
    start: true,
  },
  {
    label: "duplicate IDs with different names",
    names: ["read", "write"],
    name: "write",
    start: true,
  },
  {
    label: "unstarted declaration",
    names: ["read"],
    name: "read",
    start: false,
  },
  {
    label: "long-name display collision",
    names: ["n".repeat(127)],
    name: "n".repeat(128),
    start: true,
  },
  {
    label: "redacted display collision",
    names: ["lookup-secret-one"],
    name: "lookup-secret-two",
    start: true,
    secrets: ["secret-one", "secret-two"],
  },
];
it.each(
  independentExecutions.flatMap((test) =>
    ["final-first", "marker-first"].flatMap((order) =>
      [false, true].map((isError) => ({ ...test, order, isError })),
    ),
  ),
)(
  "independent execution $label/$order/isError=$isError keeps its first identity through durable and cold reads",
  async ({ names, name, start, secrets = [], order, isError }) => {
    const f = fixture(),
      saved = writeSession(f, [
        { role: "user", content: [{ type: "text", text: "Question" }] },
      ]),
      commandId = f.command(saved.id, "running", saved.entries[0]);
    f.secrets(secrets);
    let leaf = saved.entries[0],
      serial = 2;
    const append = (type: string, fields: Record<string, unknown>) => {
      const id = (serial++).toString(16).padStart(8, "0");
      appendFileSync(
        saved.path,
        `${JSON.stringify({ type, id, parentId: leaf, timestamp: new Date(1_800_000_000_000).toISOString(), ...fields })}\n`,
      );
      leaf = id;
    };
    const mark = (
      captureMessageId?: string,
      captureResultCallId?: string | null,
    ) =>
      append("custom", {
        customType: BROWSER_COMMAND_ENTRY,
        data: {
          commandId,
          userId: saved.entries[0],
          ...(captureMessageId ? { captureMessageId } : {}),
          ...(captureResultCallId ? { captureResultCallId } : {}),
        },
      });
    mark();
    const capture = new LiveCapture(() => secrets),
      frames: CaptureFrame[] = [];
    const emitter = new CaptureEmitter(
      randomUUID(),
      new Writable({
        write(chunk, _encoding, done) {
          const frame = JSON.parse(String(chunk));
          frames.push(frame);
          capture.accept(frame);
          done();
        },
      }),
      () => {
        throw Error("capture failed");
      },
    );
    const sdk = new SdkCapture(emitter, secrets),
      live = goLive(f, commandId, capture);
    await emitter.emit({ kind: "ready", requestProtocol: 2 });
    const declaration = {
      role: "assistant",
      stopReason: "toolUse",
      content: [
        { type: "text", text: "Before" },
        ...names.map((name) => ({
          type: "toolCall",
          id: "source-call",
          name,
          arguments: {},
        })),
        { type: "text", text: "After" },
      ],
    };
    await sdk.event({ type: "message_start", message: declaration });
    const declarationId = sdk.messageId!;
    await sdk.event({ type: "message_end", message: declaration });
    append("message", { message: declaration });
    mark(declarationId);
    let viewLeaf: string | null = null,
      beforeTail: number | null = null;
    const paths = [
      saved.path,
      f.records.path(commandId, "accepted.json"),
      f.records.path(commandId, "state.json"),
      f.records.indexPath(saved.id),
    ];
    const read = (reader = f.records, before: number | null = null) => {
      const original = paths.map((path) => readFileSync(path));
      const value = decodeWorkbenchResult(
        reader.turnSteps(saved.id, viewLeaf, 0, before ?? beforeTail),
      );
      if (value.kind !== "conversation-turn") throw Error("turn");
      const items = value.steps.map((step, index) => {
        if (!step.parts) return { ...step, args: "" };
        const detail = decodeWorkbenchResult(
          reader.step(saved.id, viewLeaf, value.turn.id, index, 0),
        );
        if (detail.kind !== "conversation-step") throw Error("step");
        expect(detail.item).toMatchObject({
          renderId: step.renderId,
          state: step.state,
          version: step.version,
        });
        return detail.item;
      });
      expect(paths.map((path) => readFileSync(path))).toEqual(original);
      for (const secret of secrets)
        expect(JSON.stringify([value, items])).not.toContain(secret);
      return { value, items };
    };
    const declared = read();
    const check = (state: string, output: string, reader = f.records) => {
      const observed = read(reader);
      expect(observed.items.map((item) => item.role)).toEqual([
        "user",
        "assistant",
        ...names.map(() => "tool"),
        "assistant",
        "tool",
      ]);
      expect(observed.items.slice(1, -1).map((item) => item.renderId)).toEqual(
        declared.items.slice(1).map((item) => item.renderId),
      );
      for (const item of observed.items.slice(2, 2 + names.length)) {
        expect(item).toMatchObject({
          state: live.state.status === "running" ? "pending" : "unavailable",
          error: false,
          text: "",
        });
      }
      expect(observed.items.at(-1)).toMatchObject({
        state,
        error: state === "failed",
        text: output,
      });
      return observed;
    };
    const event = { toolCallId: "source-call", toolName: name };
    let firstRenderId: string | undefined;
    if (start) {
      await sdk.event({ type: "tool_execution_start", ...event, args: {} });
      firstRenderId = check("running", "").items.at(-1)!.renderId;
      for (const text of ["First update", "Other update"]) {
        const previous = read();
        await sdk.event({
          type: "tool_execution_update",
          ...event,
          partialResult: { content: [{ type: "text", text }] },
        });
        const updated = check("running", text);
        expect(updated.value.steps.at(-1)!.parts).toBe(
          previous.value.steps.at(-1)!.parts,
        );
        expect(updated.value.steps.at(-1)!.version).not.toBe(
          previous.value.steps.at(-1)!.version,
        );
      }
    }
    const result = { content: [{ type: "text", text: "Recorded output" }] };
    await sdk.event({ type: "tool_execution_end", ...event, isError, result });
    const end = frames.findLast(
      (frame) => frame.event.kind === "tool-end",
    )!.event;
    if (end.kind !== "tool-end") throw Error("end");
    expect(end.declaration).toBeNull();
    const state = isError ? "failed" : "completed",
      first = check(state, "Recorded output");
    expect(first.items.at(-1)!.renderId).toBe(`call:${end.callId}`);
    if (start) expect(first.items.at(-1)!.renderId).toBe(firstRenderId);
    const resultMessage = { role: "toolResult", ...event, isError, ...result };
    await sdk.event({ type: "message_start", message: resultMessage });
    const captureMessageId = sdk.messageId!,
      captureResultCallId = sdk.resultCallId;
    const finish = () =>
      sdk.event({ type: "message_end", message: resultMessage });
    if (order === "final-first") await finish();
    append("message", { message: resultMessage });
    expect(check(state, "Recorded output").value.steps).toEqual(
      first.value.steps,
    );
    mark(captureMessageId, captureResultCallId);
    const handed = check(state, "Recorded output");
    expect(handed.items.at(-1)!.renderId).toBe(first.items.at(-1)!.renderId);
    expect(captureResultCallId).toBe(end.callId);
    if (order === "marker-first") await finish();
    expect(check(state, "Recorded output").value.steps).toEqual(
      handed.value.steps,
    );
    expect(read(f.records, handed.value.steps.length - 1).value.steps).toEqual(
      handed.value.steps.slice(0, -1),
    );
    // Add a real later message so the independent result is also read on an
    // earlier step page, not merely omitted from a page of declarations.
    const tail = {
      role: "assistant",
      stopReason: "stop",
      content: [{ type: "text", text: "Later answer" }],
    };
    await sdk.event({ type: "message_start", message: tail });
    const tailCaptureId = sdk.messageId!;
    await sdk.event({ type: "message_end", message: tail });
    append("message", { message: tail });
    mark(tailCaptureId);
    expect(read().value.steps.at(-1)).toMatchObject({
      role: "assistant",
      text: "Later answer",
    });
    beforeTail = handed.value.steps.length;
    expect(check(state, "Recorded output").value.steps).toEqual(
      handed.value.steps,
    );
    expect(read().value.turn.steps).toBe(beforeTail + 1);
    if (order === "marker-first") {
      // The next delivered user message makes this result an earlier turn.
      // Its verified result-message identity must suppress the old execution
      // in the current live tail, without matching source/name or body text.
      viewLeaf = leaf;
      const inputId = randomUUID(),
        message = { role: "user", content: [{ type: "text", text: "Next" }] };
      const inputCommand = {
        kind: "conversation-input" as const,
        commandId: inputId,
        conversationId: saved.id,
        turnId: commandId,
        epoch: live.epoch,
        mode: "steer" as const,
        text: "Next",
      };
      const accepted = {
        ...live.accepted,
        command: inputCommand,
        offset: readFileSync(saved.path).length,
      };
      const inputStatePath = f.records.path(inputId, "state.json");
      f.files.create(inputStatePath, JSON.stringify(live.state));
      live.inputs.push({
        commandId: inputId,
        accepted,
        state: { ...live.state },
        stateFile: f.files.read(inputStatePath, 16 * 1024)!,
        sent: true,
        withdrawn: false,
      });
      await sdk.event({ type: "message_start", message });
      const inputCaptureId = sdk.messageId!;
      await sdk.event({ type: "message_end", message });
      append("message", { message });
      append("custom", {
        customType: BROWSER_COMMAND_ENTRY,
        data: {
          commandId: inputId,
          run: commandId,
          userId: leaf,
          captureMessageId: inputCaptureId,
        },
      });
      const current = decodeWorkbenchResult(
        f.records.turnSteps(saved.id, viewLeaf, 1, null),
      );
      expect(current).toMatchObject({
        kind: "conversation-turn",
        steps: [{ role: "user", text: "Next" }],
      });
      if (current.kind !== "conversation-turn") throw Error("turn");
      expect(current.steps).toHaveLength(1);
      expect(check(state, "Recorded output").value.steps).toEqual(
        handed.value.steps,
      );
    }
    live.state.status = "completed";
    if (order === "final-first") check(state, "Recorded output");
    f.active.delete(commandId);
    writeFileSync(
      f.records.path(commandId, "state.json"),
      JSON.stringify({ ...live.state, user: saved.entries[0] }),
    );
    const cold = f.reconnect(),
      head = decodeWorkbenchResult(cold.conversation(saved.id, null, null));
    if (head.kind !== "conversation") throw Error("conversation");
    viewLeaf = head.leaf;
    const final = check(state, "Recorded output", cold);
    expect(final.items.at(-1)!.renderId).toBe(first.items.at(-1)!.renderId);
    expect(read(cold, final.value.steps.length - 1).value.steps).toEqual(
      final.value.steps.slice(0, -1),
    );
  },
);

it("reading an unstarted conversation scans Pi sessions only once per request", () => {
  const f = fixture();
  writeSession(f, [
    { role: "user", content: [{ type: "text", text: "Existing" }] },
  ]);
  const listSpy = vi.spyOn(f.records.sessions, "list");
  const findSpy = vi.spyOn(f.records.sessions, "find");
  const freshId = randomUUID();
  const head = decodeWorkbenchResult(
    f.records.conversation(freshId, null, null),
  );
  expect(head).toMatchObject({
    kind: "conversation",
    summary: null,
    leaf: null,
    turns: 0,
    branches: 0,
    runs: [],
    attempt: null,
  });
  expect(findSpy).toHaveBeenCalledTimes(1);
  expect(listSpy).toHaveBeenCalledTimes(1);
});

it("live conversation summaries expose immutable accepted.at as live.startedAt and decode older summaries without it", () => {
  const f = fixture();
  const saved = writeSession(f, [
    { role: "user", content: [{ type: "text", text: "Active check" }] },
  ]);
  const commandId = f.command(saved.id, "running", saved.entries[0]);
  const live = goLive(f, commandId);
  live.accepted.at = 1_760_000_123_456;
  const active = decodeWorkbenchResult(f.records.activeConversations());
  expect(active).toMatchObject({
    kind: "conversation-active",
    entries: [
      {
        id: saved.id,
        live: { commandId, epoch: live.epoch, startedAt: 1_760_000_123_456 },
      },
    ],
  });
  // Older service projections without live.startedAt still decode cleanly.
  const legacy = decodeWorkbenchResult({
    kind: "conversation-active",
    entries: [
      {
        id: saved.id,
        title: "Legacy",
        leaf: saved.entries[0],
        status: "running",
        updatedAt: 1000,
        origin: "webui",
        live: { commandId, epoch: live.epoch },
      },
    ],
  });
  expect(legacy).toMatchObject({
    kind: "conversation-active",
    entries: [{ id: saved.id, live: { commandId, epoch: live.epoch } }],
  });
});

it("list() reads secrets once and caches settled WebUI summary status across polls without thrashing open sessions", () => {
  const f = fixture();
  const sessions: { id: string; commandId: string; user: string }[] = [];
  for (let i = 0; i < 12; i++) {
    const saved = writeSession(f, [
      { role: "user", content: [{ type: "text", text: `Session ${i}` }] },
      {
        role: "assistant",
        content: [{ type: "text", text: `Reply ${i}` }],
        stopReason: "stop",
      },
    ]);
    const commandId = f.command(saved.id, "completed", saved.entries[0]);
    sessions.push({ id: saved.id, commandId, user: saved.entries[0] });
  }
  const secretSpy = vi.spyOn(f.records, "readSecrets");
  const openSpy = vi.spyOn(f.records.sessions, "session");
  const first = decodeWorkbenchResult(f.records.list());
  expect(first.kind).toBe("conversations");
  expect(secretSpy).toHaveBeenCalledTimes(1);
  expect(openSpy).toHaveBeenCalledTimes(12);

  // Repeated list polls reuse cached settled statuses with zero session re-opens
  // and still read secrets once per request so redaction stays fresh.
  secretSpy.mockClear();
  openSpy.mockClear();
  const second = decodeWorkbenchResult(f.records.list());
  expect(second).toEqual(first);
  expect(secretSpy).toHaveBeenCalledTimes(1);
  expect(openSpy).toHaveBeenCalledTimes(0);

  // Changing a recorded command state invalidates only that session's cached status.
  const target = sessions[0];
  const statePath = f.records.path(target.commandId, "state.json");
  const prior = f.files.read(statePath);
  if (!prior) throw Error("missing state");
  f.files.replace(
    statePath,
    prior,
    JSON.stringify({
      status: "failed",
      notice: "boom",
      user: target.user,
      omitted: { thinking: false, media: false, other: false },
    }),
  );
  openSpy.mockClear();
  const third = decodeWorkbenchResult(f.records.list());
  if (third.kind !== "conversations") throw Error("conversations");
  expect(third.entries.find((e) => e.id === target.id)?.status).toBe("failed");
  expect(openSpy).toHaveBeenCalledTimes(1);
});
