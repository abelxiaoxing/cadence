import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { canonicalJson, LIMITS } from "../src/service/contracts/core.ts";
import {
  chatStep,
  decodeWorkbenchResult,
  STEP_READ,
  TREE_NODES,
} from "../src/service/contracts/workbench.ts";
import { LiveCapture } from "../src/service/conversations.ts";
import {
  itemParts,
  listTurn,
  PiSessions,
  sessionDirectory,
  turnItems,
  turnSpans,
} from "../src/service/pi-sessions.ts";
import {
  CADENCE_MODE_ENTRY,
  WEBUI_SESSION_ENTRY,
} from "../src/session-entries.mjs";
import type { CaptureFrame } from "../src/worker-public.mjs";

const project = () => realpathSync(mkdtempSync(join(tmpdir(), "pi-project-")));
let clock = 1_800_000_000_000;
let serial = 0;
type Entry = Record<string, unknown> & { id: string };
function entry(
  type: string,
  parentId: string | null,
  extra: Record<string, unknown> = {},
): Entry {
  clock += 1000;
  return {
    type,
    id: (serial++).toString(16).padStart(8, "0"),
    parentId,
    timestamp: new Date(clock).toISOString(),
    ...extra,
  };
}
const user = (parentId: string | null, text: string) =>
  entry("message", parentId, {
    message: {
      role: "user",
      content: [{ type: "text", text }],
      timestamp: clock,
    },
  });
const assistant = (
  parentId: string | null,
  content: unknown[],
  stopReason = "stop",
  errorMessage?: string,
) =>
  entry("message", parentId, {
    message: {
      role: "assistant",
      content,
      stopReason,
      ...(errorMessage ? { errorMessage } : {}),
      timestamp: clock,
    },
  });
const line = (value: unknown) => `${JSON.stringify(value)}\n`;
function write(
  dir: string,
  cwd: string,
  entries: Entry[],
  id = randomUUID(),
): { id: string; path: string } {
  const path = join(dir, `2026-11-02T00-00-00-000Z_${id}.jsonl`);
  writeFileSync(
    path,
    [
      line({
        type: "session",
        version: 3,
        id,
        timestamp: new Date(clock).toISOString(),
        cwd,
      }),
      ...entries.map(line),
    ].join(""),
  );
  return { id, path };
}

it("finds the sessions where Pi keeps them, with Pi's precedence", () => {
  const cwd = project();
  const agent = mkdtempSync(join(tmpdir(), "pi-agent-"));
  expect(sessionDirectory(cwd, agent, {})).toBe(
    join(agent, "sessions", `--${cwd.slice(1).replaceAll("/", "-")}--`),
  );
  writeFileSync(
    join(agent, "settings.json"),
    JSON.stringify({ sessionDir: "~/pi-sessions" }),
  );
  expect(sessionDirectory(cwd, agent, {})).toBe(join(homedir(), "pi-sessions"));
  mkdirSync(join(cwd, ".pi"));
  writeFileSync(
    join(cwd, ".pi", "settings.json"),
    JSON.stringify({ sessionDir: ".pi/sessions" }),
  );
  expect(sessionDirectory(cwd, agent, {})).toBe(join(cwd, ".pi", "sessions"));
  expect(
    sessionDirectory(cwd, agent, { PI_CODING_AGENT_SESSION_DIR: "/srv/pi" }),
  ).toBe("/srv/pi");
  writeFileSync(join(cwd, ".pi", "settings.json"), "{broken");
  expect(sessionDirectory(cwd, agent, {})).toBe(join(homedir(), "pi-sessions"));
});

it("lists this project's sessions newest first, extends them as Pi appends and never trusts a torn line", () => {
  const cwd = project();
  const dir = mkdtempSync(join(tmpdir(), "pi-sessions-"));
  const u1 = user(null, "First question\nsecond line");
  const terminal = write(dir, cwd, [
    entry("model_change", null, { provider: "p", modelId: "m" }),
    u1,
    assistant(u1.id, [{ type: "text", text: "answer" }]),
    entry("custom", u1.id, {
      customType: CADENCE_MODE_ENTRY,
      data: { enabled: true, runId: "11111111-1111-4111-8111-111111111111" },
    }),
  ]);
  const u2 = user(null, "Browser question");
  const browser = write(dir, cwd, [
    entry("custom", null, { customType: WEBUI_SESSION_ENTRY, data: {} }),
    u2,
    entry("session_info", u2.id, { name: "Named in Pi" }),
  ]);
  write(dir, "/elsewhere", [user(null, "other project")]);
  writeFileSync(join(dir, "notes.txt"), "not a session");
  utimesSync(terminal.path, 1000, 1000);
  utimesSync(browser.path, 2000, 2000);
  const sessions = new PiSessions(dir, cwd);
  let listed = sessions.list();
  expect(listed.map((l) => l.summary.id)).toEqual([browser.id, terminal.id]);
  expect(listed[0].summary).toMatchObject({ webui: true, name: "Named in Pi" });
  expect(listed[1].summary).toMatchObject({
    webui: false,
    firstUser: "First question",
    cadence: true,
    runs: ["11111111-1111-4111-8111-111111111111"],
    stop: { status: "completed", notice: "" },
  });
  // Pi appends: the listing reads only the new lines; a torn line waits.
  const failed = assistant(u1.id, [], "error", "429 rate limited");
  appendFileSync(terminal.path, `${line(failed)}{"type":"message","id":"torn`);
  utimesSync(terminal.path, 3000, 3000);
  listed = sessions.list();
  expect(listed[0].summary).toMatchObject({
    id: terminal.id,
    leaf: failed.id,
    stop: { status: "failed", notice: "429 rate limited" },
  });
  const parsed = sessions.session(terminal.id);
  expect(parsed?.current()).toBe(failed.id);
  expect(parsed?.entries).toHaveLength(5);
  // A replaced file is read again from its start.
  const replacement = `${terminal.path}.new`;
  writeFileSync(
    replacement,
    line({ type: "session", version: 3, id: terminal.id, timestamp: "", cwd }) +
      line(user(null, "Rewritten")),
  );
  renameSync(replacement, terminal.path);
  expect(sessions.find(terminal.id)?.summary.firstUser).toBe("Rewritten");
  expect(sessions.session(terminal.id)?.entries).toHaveLength(1);
});

it("splits a branch into turns of chat items, redacted, with Pi's failure status", () => {
  const cwd = project();
  const dir = mkdtempSync(join(tmpdir(), "pi-sessions-"));
  const u1 = user(null, "Read the config");
  const call = assistant(
    u1.id,
    [
      { type: "thinking", thinking: "hidden" },
      { type: "text", text: "Reading it." },
      {
        type: "toolCall",
        id: "call_1",
        name: "read",
        arguments: { path: "a.json" },
      },
    ],
    "toolUse",
  );
  const result = entry("message", call.id, {
    message: {
      role: "toolResult",
      toolCallId: "call_1",
      toolName: "read",
      content: [
        { type: "text", text: "token=SECRET-VALUE" },
        { type: "image", data: "" },
      ],
      isError: false,
    },
  });
  const answer = assistant(result.id, [
    { type: "text", text: "It holds SECRET-VALUE." },
  ]);
  const bash = entry("message", answer.id, {
    message: {
      role: "bashExecution",
      command: "ls",
      output: "x",
      exitCode: 2,
      cancelled: false,
      truncated: false,
      timestamp: clock,
    },
  });
  const compaction = entry("compaction", bash.id, {
    summary: "Earlier work",
    firstKeptEntryId: u1.id,
    tokensBefore: 1,
  });
  const note = entry("custom_message", compaction.id, {
    customType: "cadence-workflow-result",
    content: "Workflow done",
    display: true,
  });
  const hidden = entry("custom_message", note.id, {
    customType: "x",
    content: "hidden",
    display: false,
  });
  const u2 = user(hidden.id, "Again");
  const failed = assistant(u2.id, [], "error", "provider SECRET-VALUE failed");
  const { id } = write(dir, cwd, [
    entry("model_change", null, { provider: "p", modelId: "m" }),
    { ...u1, parentId: null },
    call,
    result,
    answer,
    bash,
    compaction,
    note,
    hidden,
    u2,
    failed,
  ]);
  const session = new PiSessions(dir, cwd).session(id);
  if (!session) throw Error("session");
  const turns = turnSpans(session.branch(session.current()));
  expect(turns.map((t) => t[0].id)).toEqual([u1.id, u2.id]);
  const first = turnItems(turns[0], ["SECRET-VALUE"]);
  expect(first.items.map((i) => [i.role, i.name, i.text])).toEqual([
    ["user", "", "Read the config"],
    ["assistant", "", "Reading it."],
    ["tool", "read", "token=[redacted]"],
    ["assistant", "", "It holds [redacted]."],
    ["tool", "bash", "x"],
    ["tool", "compaction", "Earlier work"],
    ["tool", "cadence-workflow-result", "Workflow done"],
  ]);
  expect(first.items[2].args).toBe('{"path":"a.json"}');
  expect(first.items[4].error).toBe(true);
  expect(first.omitted).toEqual({ thinking: true, media: true, other: false });
  expect(first).toMatchObject({
    id: u1.id,
    entry: hidden.id,
    status: "completed",
  });
  const second = turnItems(turns[1], ["SECRET-VALUE"]);
  expect(second).toMatchObject({
    status: "failed",
    notice: "provider [redacted] failed",
  });
  const listed = listTurn(first);
  expect(listed.steps[2]).toMatchObject({
    role: "tool",
    text: "",
    target: "a.json",
    parts: 1,
  });
  expect(listed.steps[0].parts).toBe(0);
});

it("splits a large item into parts losslessly, each fitting one step reply", () => {
  const text = `${'"\\\u0001文😀'.repeat(120000)}end`;
  const args = JSON.stringify({ command: "x".repeat(300000) });
  const item = {
    id: "i",
    role: "tool" as const,
    name: "bash",
    text,
    args,
    error: false,
  };
  const parts = itemParts(item);
  expect(parts.length).toBeGreaterThan(5);
  expect(parts.map((p) => p.text).join("")).toBe(text);
  expect(parts.map((p) => p.args).join("")).toBe(args);
  for (const [part, value] of parts.entries()) {
    const reply = decodeWorkbenchResult({
      kind: "conversation-step",
      conversationId: "01a18b9d-bbbb-72ad-9486-b15306897929",
      leaf: "abcdef12",
      turnId: "abcdef12",
      step: 0,
      part,
      item: value,
    });
    canonicalJson({ kind: "ok", value: reply }, LIMITS.pageBytes);
  }
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
  const value = {
    kind: "conversation-turn",
    conversationId: "x".repeat(128),
    leaf: "y".repeat(64),
    ordinal: Number.MAX_SAFE_INTEGER,
    turn: {
      id: "z".repeat(64),
      status: "completed",
      notice: escaped(1024),
      omitted: { thinking: true, media: true, other: true },
      steps: Number.MAX_SAFE_INTEGER,
      stable: Number.MAX_SAFE_INTEGER,
      entry: "w".repeat(64),
      at: Number.MAX_SAFE_INTEGER,
    },
    start: Number.MAX_SAFE_INTEGER - STEP_READ,
    steps: Array.from({ length: STEP_READ }, (_, i) =>
      i % 2 ? tool : message,
    ),
  };
  expect(decodeWorkbenchResult(value)).toEqual(value);
  canonicalJson({ kind: "ok", value }, LIMITS.pageBytes);
});

it("finds a browser turn's own entries, not a terminal message sent from the same point", () => {
  const cwd = project();
  const dir = mkdtempSync(join(tmpdir(), "pi-sessions-"));
  const u1 = user(null, "start");
  const a1 = assistant(u1.id, [{ type: "text", text: "ok" }]);
  const { id, path } = write(dir, cwd, [u1, a1]);
  const sessions = new PiSessions(dir, cwd);
  const offset = sessions.session(id)?.read?.size ?? 0;
  const terminal = user(a1.id, "typed in the terminal");
  const model = entry("model_change", a1.id, { provider: "p", modelId: "n" });
  const browser = user(model.id, "sent from the browser");
  const reply = assistant(browser.id, [
    { type: "text", text: "browser reply" },
  ]);
  const later = assistant(terminal.id, [
    { type: "text", text: "terminal reply" },
  ]);
  appendFileSync(
    path,
    [terminal, model, browser, reply, later].map(line).join(""),
  );
  const session = sessions.session(id);
  if (!session) throw Error("session");
  expect(
    session.chain(a1.id, offset, "sent from the browser").map((e) => e.id),
  ).toEqual([browser.id, reply.id]);
  expect(session.chain(a1.id, offset, "never sent")).toEqual([]);
  expect(session.current()).toBe(later.id);
  expect(session.leaves()).toBe(2);
  expect(session.contains(reply.id, a1.id)).toBe(true);
  expect(session.contains(reply.id, terminal.id)).toBe(false);
  const tree = session.tree(reply.id, []);
  expect(tree.nodes.map((n) => [n.text, n.parent, n.leaf, n.current])).toEqual([
    ["start", null, later.id, true],
    ["typed in the terminal", u1.id, later.id, false],
    ["sent from the browser", u1.id, reply.id, true],
  ]);
});

it("keeps the newest tree nodes when a session has more than one read holds", () => {
  const cwd = project();
  const dir = mkdtempSync(join(tmpdir(), "pi-sessions-"));
  const entries: Entry[] = [];
  let parent: string | null = null;
  for (let i = 0; i < TREE_NODES + 5; i++) {
    const u = user(parent, `m${i}`);
    entries.push(u);
    parent = u.id;
  }
  const { id } = write(dir, cwd, entries);
  const tree = new PiSessions(dir, cwd).session(id)?.tree(null, []);
  expect(tree?.truncated).toBe(true);
  expect(tree?.nodes).toHaveLength(TREE_NODES);
  expect(tree?.nodes[0]).toMatchObject({ text: "m5", parent: null });
});

it("a live preview adds only what Pi has not written yet, by count", () => {
  const capture = new LiveCapture(() => ["SECRET"]);
  let seq = 0;
  const frame = (event: CaptureFrame["event"]) =>
    capture.accept({
      protocol: 2,
      childRunId: "c",
      workerSeq: ++seq,
      observedMs: 0,
      event,
    } as CaptureFrame);
  const source = { kind: "sdk" } as never;
  frame({
    kind: "message-start",
    messageId: "a1",
    role: "assistant",
    source,
    resultCallId: null,
  });
  frame({
    kind: "message-end",
    messageId: "a1",
    finalDetailId: null,
    finalBlockCount: 0,
    stopReason: "toolUse",
  });
  frame({
    kind: "tool-start",
    callId: "t1",
    declaration: null,
    source,
    name: "bash",
    argsDetailId: null,
  });
  frame({
    kind: "detail-begin",
    detailId: "d1",
    descriptor: {
      owner: {
        kind: "tool",
        callId: "t1",
        blockId: "b",
        index: 0,
        stage: "update-snapshot",
      },
      field: "tool-update",
      encoding: "utf8",
    },
  });
  frame({
    kind: "detail-chunk",
    detailId: "d1",
    offset: 0,
    text: "partial SECRET output",
  });
  frame({
    kind: "detail-end",
    detailId: "d1",
    bytes: 21,
    sha256: "0".repeat(64),
    coverage: {} as never,
  });
  frame({
    kind: "message-start",
    messageId: "a2",
    role: "assistant",
    source,
    resultCallId: null,
  });
  const written = [
    {
      id: "u",
      role: "user" as const,
      text: "q",
      name: "",
      args: "",
      error: false,
    },
    {
      id: "w1",
      role: "assistant" as const,
      text: "first",
      name: "",
      args: "",
      error: false,
    },
    {
      id: "call",
      role: "tool" as const,
      text: "",
      name: "bash",
      args: "{}",
      error: false,
    },
  ];
  const { items, stable } = capture.extend(written);
  expect(items.map((i) => [i.id, i.text])).toEqual([
    ["u", "q"],
    ["w1", "first"],
    ["call", "partial [redacted] output"],
    ["a2", ""],
  ]);
  expect(stable).toBe(2);
  expect(written[2].text).toBe("");
});
