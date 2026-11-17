import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { expect, it, vi } from "vitest";
import { canonicalJson, LIMITS } from "../src/service/contracts/core.ts";
import {
  chatStep,
  decodeWorkbenchResult,
  STEP_READ,
  TREE_NODES,
} from "../src/service/contracts/workbench.ts";
import { LiveCapture } from "../src/service/conversations.ts";
import {
  checkoutSessions,
  itemParts,
  listTurn,
  PiSessions,
  sessionDirectory,
  summaryTitle,
  turnItems,
  turnSpans,
  USAGE_WALK,
} from "../src/service/pi-sessions.ts";
import {
  BROWSER_COMMAND_ENTRY,
  CADENCE_MODE_ENTRY,
  WEBUI_SESSION_ENTRY,
} from "../src/session-entries.mjs";
import { CaptureEmitter, SdkCapture } from "../src/worker-capture.mjs";
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

it("the last name record names a session, an empty one clears it, and a childless one is not a branch", () => {
  const cwd = project();
  const dir = mkdtempSync(join(tmpdir(), "pi-sessions-"));
  const u1 = user(null, "First question");
  const a1 = assistant(u1.id, [{ type: "text", text: "answer" }]);
  const { id, path } = write(dir, cwd, [u1, a1]);
  const sessions = new PiSessions(dir, cwd);
  const title = () => {
    const summary = sessions.find(id)?.summary;
    if (!summary) throw Error("session");
    return [summary.name, summaryTitle(summary)];
  };
  const leaves = () => sessions.session(id)?.leaves();
  expect(title()).toEqual([null, "First question"]);
  expect(leaves()).toBe(1);
  // A name appended at the session's end: still one branch, and its leaf.
  const named = entry("session_info", a1.id, {
    name: "Named from the browser",
  });
  appendFileSync(path, line(named));
  expect(title()).toEqual(["Named from the browser", "Named from the browser"]);
  expect(sessions.session(id)?.current()).toBe(named.id);
  expect(leaves()).toBe(1);
  // A terminal that held the session continues from where it was: the name
  // record is left beside its message, which does not make a second branch.
  const u2 = user(a1.id, "Terminal continues");
  const renamed = entry("session_info", named.id, { name: "Again" });
  appendFileSync(path, line(u2) + line(renamed));
  expect(title()).toEqual(["Again", "Again"]);
  expect(leaves()).toBe(1);
  // A real second branch is still counted, and a continued name record is an
  // ordinary link of its branch.
  const u3 = user(renamed.id, "Continues the named branch");
  appendFileSync(path, line(u3));
  expect(leaves()).toBe(2);
  // An empty name clears the title, as in Pi.
  appendFileSync(path, line(entry("session_info", u3.id, { name: "" })));
  expect(title()).toEqual([null, "First question"]);
  expect(leaves()).toBe(2);
});

it("splits a branch into turns of chat items, redacted, with Pi's failure status", () => {
  const cwd = project();
  const dir = mkdtempSync(join(tmpdir(), "pi-sessions-"));
  const u1 = user(null, "Read the config");
  const call = assistant(
    u1.id,
    [
      {
        type: "thinking",
        thinking: "Weighing SECRET-VALUE first",
        thinkingSignature: "opaque-signature",
      },
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
  // Thinking Pi stored unreadable stays a flag: redacted, or only a signature.
  const answer = assistant(result.id, [
    {
      type: "thinking",
      thinking: "[Reasoning redacted]",
      thinkingSignature: "encrypted-payload",
      redacted: true,
    },
    {
      type: "thinking",
      thinking: " \n",
      thinkingSignature: "sealed-reasoning",
    },
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
    ["thinking", "", "Weighing [redacted] first"],
    ["assistant", "", "Reading it."],
    ["tool", "read", "token=[redacted]"],
    ["assistant", "", "It holds [redacted]."],
    ["tool", "bash", "x"],
    ["tool", "compaction", "Earlier work"],
    ["tool", "cadence-workflow-result", "Workflow done"],
  ]);
  expect(first.items[1].id).toBe(`${call.id}:0`);
  expect(first.items[3].args).toBe('{"path":"a.json"}');
  expect(first.items[5].error).toBe(true);
  expect(first.omitted).toEqual({ thinking: true, media: true, other: false });
  for (const hidden of ["signature", "payload", "sealed", "Reasoning redacted"])
    expect(JSON.stringify(first)).not.toContain(hidden);
  expect(first).toMatchObject({
    id: u1.id,
    entry: hidden.id,
    parent: null,
    status: "completed",
  });
  const second = turnItems(turns[1], ["SECRET-VALUE"]);
  // A turn names the entry its user message continues, shown or not.
  expect(second).toMatchObject({
    parent: hidden.id,
    status: "failed",
    notice: "provider [redacted] failed",
  });
  const listed = listTurn(first);
  expect(listed.steps[3]).toMatchObject({
    role: "tool",
    text: "",
    target: "a.json",
    parts: 1,
  });
  expect(listed.steps[0].parts).toBe(0);
  // Thinking is listed without its text, which a step read returns.
  expect(listed.steps[1]).toEqual({
    id: `${call.id}:0`,
    renderId: `pi:${call.id}:0`,
    version: expect.stringMatching(/^[a-f0-9]{64}$/),
    state: "completed",
    role: "thinking",
    text: "",
    clipped: false,
    name: "",
    target: "",
    error: false,
    parts: 1,
  });
  expect(listed.parts[1][0].text).toBe("Weighing [redacted] first");
  // Readable thinking alone leaves nothing flagged as omitted.
  const mixed = assistant(u2.id, [
    { type: "text", text: "First." },
    { type: "thinking", thinking: "Then this." },
    { type: "text", text: "Last." },
  ]);
  expect(
    turnItems(
      [u2, mixed].map((raw) => ({
        type: "message",
        id: raw.id,
        parentId: null,
        timestamp: "",
        pos: 0,
        raw,
      })),
      [],
    ),
  ).toMatchObject({
    omitted: { thinking: false, media: false, other: false },
    items: [
      { role: "user" },
      { role: "assistant", text: "First." },
      { role: "thinking", text: "Then this." },
      { role: "assistant", text: "Last." },
    ],
  });
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
      renderId: escaped(160),
      version: "a".repeat(64),
      state: "completed",
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
      renderId: escaped(160),
      version: "a".repeat(64),
      state: "completed",
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
      activity: {
        kind: "tool",
        name: escaped(128),
        sequence: Number.MAX_SAFE_INTEGER,
      },
      status: "completed",
      notice: escaped(1024),
      omitted: { thinking: true, media: true, other: true },
      steps: Number.MAX_SAFE_INTEGER,
      stable: Number.MAX_SAFE_INTEGER,
      entry: "w".repeat(64),
      parent: "v".repeat(64),
      at: Number.MAX_SAFE_INTEGER,
    },
    start: Number.MAX_SAFE_INTEGER - STEP_READ,
    steps: Array.from({ length: STEP_READ }, (_, i) =>
      i % 2 ? tool : message,
    ),
  };
  expect(decodeWorkbenchResult(value)).toEqual(value);
  canonicalJson({ kind: "ok", value }, LIMITS.pageBytes);
  // Thinking is listed like a tool: its text is read per step, never listed.
  const thinking = chatStep(
    {
      id: escaped(160),
      renderId: escaped(160),
      version: "a".repeat(64),
      state: "completed",
      role: "thinking",
      text: escaped(100000),
      name: "",
      args: "",
      error: false,
    },
    1,
  );
  expect(thinking).toMatchObject({ text: "", clipped: false, parts: 1 });
  const thoughts = {
    ...value,
    steps: Array.from({ length: STEP_READ }, () => thinking),
  };
  expect(decodeWorkbenchResult(thoughts)).toEqual(thoughts);
  for (const refused of [
    { ...thinking, text: "listed" },
    { ...thinking, clipped: true },
    {
      id: "legacy",
      role: "thinking",
      text: "",
      clipped: false,
      name: "",
      target: "",
      error: false,
      parts: 0,
    },
    { ...thinking, state: "unavailable" },
    { ...thinking, parts: 0, state: "running" },
    { ...thinking, version: "not-a-version" },
    { ...thinking, signature: "no" },
  ])
    expect(() => decodeWorkbenchResult({ ...value, steps: [refused] })).toThrow(
      "invalid",
    );
  const placeholder = { ...thinking, parts: 0, state: "streaming" };
  expect(
    decodeWorkbenchResult({ ...value, steps: [placeholder] }),
  ).toMatchObject({ steps: [placeholder] });
  for (const activity of [
    { kind: "thinking", sequence: -1 },
    { kind: "thinking", sequence: 1, text: "private" },
    { kind: "thinking", sequence: 1, name: "tool-only" },
    { kind: "success", sequence: 1 },
  ])
    expect(() =>
      decodeWorkbenchResult({ ...value, turn: { ...value.turn, activity } }),
    ).toThrow();
});

it("finds a browser turn's own entries, not a terminal message sent from the same point", () => {
  const cwd = project();
  const dir = mkdtempSync(join(tmpdir(), "pi-sessions-"));
  const u1 = user(null, "start");
  const a1 = assistant(u1.id, [{ type: "text", text: "ok" }]);
  const { id, path } = write(dir, cwd, [u1, a1]);
  const sessions = new PiSessions(dir, cwd);
  const offset = sessions.session(id)?.read?.size ?? 0;
  const commandId = randomUUID();
  const terminal = user(a1.id, "continue");
  const model = entry("model_change", a1.id, { provider: "p", modelId: "n" });
  const browser = user(model.id, "continue");
  const marker = entry("custom", browser.id, {
    customType: BROWSER_COMMAND_ENTRY,
    data: { commandId, userId: browser.id },
  });
  const reply = assistant(marker.id, [{ type: "text", text: "browser reply" }]);
  const final = entry("custom", reply.id, {
    customType: BROWSER_COMMAND_ENTRY,
    data: { commandId, userId: browser.id },
  });
  const later = assistant(terminal.id, [
    { type: "text", text: "terminal reply" },
  ]);
  appendFileSync(
    path,
    [terminal, model, browser, marker, reply, final, later].map(line).join(""),
  );
  const session = sessions.session(id);
  if (!session) throw Error("session");
  expect(
    session.commandEntries(commandId, a1.id, offset).map((e) => e.id),
  ).toEqual([browser.id, marker.id, reply.id, final.id]);
  expect(session.commandEntries(randomUUID(), a1.id, offset)).toEqual([]);
  expect(session.current()).toBe(later.id);
  expect(session.leaves()).toBe(2);
  expect(session.contains(reply.id, a1.id)).toBe(true);
  expect(session.contains(reply.id, terminal.id)).toBe(false);
  const tree = session.tree(reply.id, []);
  expect(tree.nodes.map((n) => [n.text, n.parent, n.leaf, n.current])).toEqual([
    ["start", null, later.id, true],
    ["continue", u1.id, later.id, false],
    ["continue", u1.id, final.id, true],
  ]);
  // Extensions can append context/replies without a new user message. Those
  // descendants still must not become this browser command's own output.
  const foreign = entry("custom_message", final.id, {
    customType: "native-extension",
    display: true,
    content: "Native continuation",
  });
  const foreignReply = assistant(foreign.id, [
    { type: "text", text: "Native reply" },
  ]);
  appendFileSync(path, [foreign, foreignReply].map(line).join(""));
  session.refresh();
  expect(
    session.commandEntries(commandId, a1.id, offset).map((entry) => entry.id),
  ).toEqual([browser.id, marker.id, reply.id, final.id]);
});

it("a run's entries are split where each message sent into it began, in the order Pi wrote them", () => {
  const cwd = project();
  const dir = mkdtempSync(join(tmpdir(), "pi-sessions-"));
  const u1 = user(null, "start");
  const a1 = assistant(u1.id, [{ type: "text", text: "ok" }]);
  const { id, path } = write(dir, cwd, [u1, a1]);
  const sessions = new PiSessions(dir, cwd);
  const read = () => {
    const session = sessions.session(id);
    if (!session) throw Error("session");
    return session;
  };
  const offset = read().read?.size ?? 0;
  const run = randomUUID(),
    steer = randomUUID(),
    queued = randomUUID(),
    waiting = randomUUID();
  let leaf = a1.id;
  const add = (...entries: Entry[]) => {
    appendFileSync(path, entries.map(line).join(""));
    leaf = entries.at(-1)?.id ?? leaf;
    return entries;
  };
  /** Pi writes a message and its reply; the worker marks each. */
  const turn = (commandId: string, text: string, of?: string) => {
    const mark = (userId: string, parentId: string) =>
      entry("custom", parentId, {
        customType: BROWSER_COMMAND_ENTRY,
        data: { commandId, userId, ...(of ? { run: of } : {}) },
      });
    const message = user(leaf, text);
    const first = mark(message.id, message.id);
    const reply = assistant(first.id, [{ type: "text", text: `re: ${text}` }]);
    return add(message, first, reply, mark(message.id, reply.id)).map(
      (e) => e.id,
    );
  };
  const own = turn(run, "Start");
  const parts = (inputs: string[], from = offset) =>
    read()
      .runEntries(
        { commandId: run, parent: a1.id, offset },
        inputs.map((commandId) => ({ commandId, offset: from })),
      )
      .map((part) => [part.commandId, part.entries.map((e) => e.id)]);
  // Admitted in another order than Pi was given them; one never delivered.
  const sent = [queued, waiting, steer];
  expect(parts(sent)).toEqual([[run, own]]);
  expect(read().delivered(steer)).toBe(false);
  // Pi compacts between two messages: that entry stays with the earlier one.
  const compaction = add(entry("compaction", leaf, { summary: "so far" }))[0];
  const steered = turn(steer, "Steer", run);
  // The terminal sends from inside the run meanwhile: a branch of its own.
  appendFileSync(path, line(user(own[1], "from the terminal")));
  const later = turn(queued, "Queued", run);
  expect(parts(sent)).toEqual([
    [run, [...own, compaction.id]],
    [steer, steered],
    [queued, later],
  ]);
  expect(sent.map((commandId) => read().delivered(commandId))).toEqual([
    true,
    false,
    true,
  ]);
  // Read alone, the run's own entries end at its newest boundary.
  expect(
    read()
      .commandEntries(run, a1.id, offset)
      .map((e) => e.id),
  ).toEqual(own);
  // A boundary cannot claim a message Pi wrote before its command existed,
  // nor one of another run, nor stand without the run's own message.
  expect(() => parts(sent, read().read?.size ?? 0)).toThrow("corrupt-selected");
  turn(waiting, "Another run's", randomUUID());
  expect(() => parts(sent)).toThrow("corrupt-selected");
  expect(() =>
    read().runEntries({ commandId: randomUUID(), parent: a1.id, offset }, [
      { commandId: steer, offset },
    ]),
  ).toThrow("corrupt-selected");
  expect(() =>
    read().runEntries({ commandId: run, parent: u1.id, offset }, []),
  ).toThrow("stale");
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

it("a live preview joins tools by explicit call source, not visible message or result counts", () => {
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
  const source = { disposition: "observed", value: "call" } as const;
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
      renderId: "call:t1",
      state: "pending" as const,
      role: "tool" as const,
      text: "",
      name: "bash",
      args: "{}",
      error: false,
    },
  ];
  const { items, stable } = capture.extend(written, [], ["a1"]);
  expect(items.map((i) => [i.id, i.text])).toEqual([
    ["u", "q"],
    ["w1", "first"],
    ["call", "partial [redacted] output"],
  ]);
  expect(stable).toBe(2);
  expect(written[2].text).toBe("");
  // Explicit identities from earlier turns prevent their tools reappearing.
  const earlier = [written[0], written[1], { ...written[2], text: "done" }];
  const next = {
    id: "u2",
    role: "user" as const,
    text: "steer",
    name: "",
    args: "",
    error: false,
  };
  expect(capture.extend([next], earlier, ["a1"])).toEqual({
    items: [next],
    stable: 1,
  });
});

it("a capture keeps what it did not keep apart for each message of the run, and admitted images belong to the first", () => {
  const capture = new LiveCapture(() => [], true);
  let seq = 0;
  const frame = (event: Record<string, unknown>) =>
    capture.accept({
      protocol: 2,
      childRunId: "c",
      workerSeq: ++seq,
      observedMs: 0,
      event,
    } as unknown as CaptureFrame);
  const start = (messageId: string) =>
    frame({ kind: "message-start", messageId, role: "user" });
  const omitted = (messageId: string, sourceType: string, reason: string) =>
    frame({
      kind: "omitted-block",
      block: {
        owner: { kind: "message", messageId, blockId: "b", index: 0 },
        sourceType,
        mimeType: null,
        reason,
      },
    });
  start("u1");
  // The admitted images are shown from the Send itself, not flagged.
  omitted("u1", "image", "binary");
  omitted("a1", "unsupported", "unsupported");
  start("u2");
  expect(capture.omitted).toEqual({
    thinking: false,
    media: false,
    other: false,
  });
  // A later user message carries no admitted image: its media is omitted.
  omitted("u2", "image", "binary");
  expect([0, 1, 2].map((index) => capture.omittedFor(index))).toEqual([
    { thinking: false, media: false, other: true },
    { thinking: false, media: true, other: false },
    { thinking: false, media: false, other: false },
  ]);
  expect(capture.omitted).toBe(capture.omittedFor(1));
});

it("a branch's context size is its last valid model response's, unknown after a compaction and bounded", () => {
  const cwd = project();
  const dir = mkdtempSync(join(tmpdir(), "pi-sessions-"));
  const reply = (
    parentId: string,
    usage: Record<string, unknown> | undefined,
    stopReason = "stop",
    model = "fixed",
  ) =>
    entry("message", parentId, {
      message: {
        role: "assistant",
        content: [{ type: "text", text: "reply" }],
        provider: "fixture",
        model,
        ...(usage ? { usage } : {}),
        stopReason,
      },
    });
  const total = (totalTokens: number) => ({
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens,
  });
  const u1 = user(null, "first");
  const a1 = reply(u1.id, total(1200));
  const u2 = user(a1.id, "second");
  // None of these is a valid usage as Pi counts one.
  const failed = reply(u2.id, total(5000), "error");
  const aborted = reply(failed.id, total(6000), "aborted");
  const empty = reply(aborted.id, { ...total(0), input: 0, output: 0 });
  const partial = reply(empty.id, { totalTokens: 0, input: 9 });
  const unreported = reply(partial.id, undefined);
  const result = entry("message", unreported.id, {
    message: { role: "toolResult", toolCallId: "c", content: [] },
  });
  // Without a provider total the four parts are summed.
  const parts = reply(
    result.id,
    { input: 10, output: 5, cacheRead: 100, cacheWrite: 7, totalTokens: 0 },
    "toolUse",
    "other",
  );
  const compaction = entry("compaction", parts.id, { summary: "Earlier" });
  const kept = user(compaction.id, "third");
  const after = reply(kept.id, total(300));
  const tail: Entry[] = [];
  let parent = after.id;
  for (let n = 0; n < USAGE_WALK; n++) {
    const next = entry("custom", parent, { customType: "note", data: {} });
    tail.push(next);
    parent = next.id;
  }
  // A second branch from the first reply holds no response of its own.
  const side = user(a1.id, "side");
  const { id, path } = write(dir, cwd, [
    u1,
    a1,
    u2,
    failed,
    aborted,
    empty,
    partial,
    unreported,
    result,
    parts,
    compaction,
    kept,
    after,
    ...tail,
    side,
  ]);
  const sessions = new PiSessions(dir, cwd);
  const session = sessions.session(id);
  if (!session) throw Error("session");
  const first = { tokens: 1200, provider: "fixture", model: "fixed" };
  expect(session.usage(null)).toBeNull();
  expect(session.usage(u1.id)).toBeNull();
  expect(session.usage(a1.id)).toEqual(first);
  expect(session.usage(result.id)).toEqual(first);
  expect(session.usage(side.id)).toEqual(first);
  expect(session.usage(parts.id)).toEqual({
    tokens: 122,
    provider: "fixture",
    model: "other",
  });
  // The response before a compaction no longer measures the context.
  const unknown = { tokens: null, provider: "fixture", model: "other" };
  expect(session.usage(compaction.id)).toEqual(unknown);
  expect(session.usage(kept.id)).toEqual(unknown);
  expect(session.usage(kept.id)).toBe(session.usage(kept.id));
  expect(session.usage(after.id)).toMatchObject({ tokens: 300 });
  // The walk visits USAGE_WALK entries from the branch end and no more.
  expect(session.usage(tail[USAGE_WALK - 2].id)).toMatchObject({ tokens: 300 });
  expect(session.usage(tail[USAGE_WALK - 1].id)).toBeNull();
  // A replaced file is measured again, never answered from the old one.
  const replacement = `${path}.new`;
  writeFileSync(
    replacement,
    line({ type: "session", version: 3, id, timestamp: "", cwd }) +
      line({ ...u1, parentId: null }) +
      line({
        ...a1,
        message: { ...(a1.message as object), usage: total(77) },
      }),
  );
  renameSync(replacement, path);
  expect(sessions.session(id)?.usage(a1.id)).toMatchObject({ tokens: 77 });
});

it("a session's cache totals sum every usage record of the file as Pi's statistics do, on every branch", () => {
  const cwd = project();
  const dir = mkdtempSync(join(tmpdir(), "pi-sessions-"));
  const used = (input: unknown, cacheRead: unknown, cacheWrite: unknown) => ({
    input,
    output: 5,
    cacheRead,
    cacheWrite,
    totalTokens: 0,
  });
  const reply = (parentId: string, usage: object, stopReason = "stop") =>
    entry("message", parentId, {
      message: { role: "assistant", content: [], usage, stopReason },
    });
  const u1 = user(null, "first");
  const a1 = reply(u1.id, used(100, 0, 900));
  // Pi's statistics count a failed or aborted reply's usage too.
  const failed = reply(a1.id, used(20, 1000, 0), "error");
  const result = entry("message", failed.id, {
    message: { role: "toolResult", content: [], usage: used(3, 30, 300) },
  });
  const compaction = entry("compaction", result.id, {
    summary: "Earlier",
    usage: used(40, 0, 0),
  });
  const recorded = entry("usage", compaction.id, { usage: used(1, 2, 3) });
  // Nothing Pi could have recorded as a count adds anything.
  const malformed = reply(recorded.id, used("7", -4, Number.NaN));
  const said = entry("message", malformed.id, {
    message: { role: "user", content: [], usage: used(9000, 9000, 9000) },
  });
  // Another branch's records belong to the same session file.
  const side = reply(u1.id, used(5, 5000, 0));
  const { id, path } = write(dir, cwd, [
    u1,
    a1,
    failed,
    result,
    compaction,
    recorded,
    malformed,
    said,
    side,
  ]);
  const sessions = new PiSessions(dir, cwd);
  expect(sessions.session(id)?.cache).toEqual({
    input: 169,
    read: 6032,
    write: 1203,
  });
  // Appended lines are added once; a later read counts nothing twice.
  appendFileSync(path, line(reply(side.id, used(1, 8, 0))));
  expect(sessions.session(id)?.cache).toEqual({
    input: 170,
    read: 6040,
    write: 1203,
  });
  expect(sessions.session(id)?.cache.read).toBe(6040);
  // A replaced file is summed again from its start.
  const replacement = `${path}.new`;
  writeFileSync(
    replacement,
    line({ type: "session", version: 3, id, timestamp: "", cwd }) +
      line({ ...u1, parentId: null }),
  );
  renameSync(replacement, path);
  expect(sessions.session(id)?.cache).toEqual({ input: 0, read: 0, write: 0 });
});

it("an old unlinked item never acquires a capture identity by text or position", async () => {
  const f = streamingFixture();
  const first = await f.start();
  await f.end([{ type: "text", text: "Same" }]);
  const second = await f.start();
  await f.end([{ type: "text", text: "Same" }]);
  const old = {
    id: "old:0",
    role: "assistant" as const,
    text: "Same",
    name: "",
    args: "",
    error: false,
  };
  // Only the first explicit occurrence is written, regardless of the old item's content.
  const read = f.live.extend([old], [], [first]);
  expect(read.items.map((item) => item.id)).toEqual(["old:0", `${second}:0`]);
  expect(read.items[0].renderId).toBeUndefined();
  expect(read.items[1].renderId).toBe(`capture:${second}:0`);
  expect(f.live.extend([old], [], [first, second]).items).toEqual([old]);
});

it.skipIf(typeof process.getuid !== "function")(
  "a cached session never becomes another account's readable history",
  () => {
    const cwd = project(),
      dir = mkdtempSync(join(tmpdir(), "pi-owner-"));
    const saved = write(dir, cwd, [user(null, "Private session")]);
    const sessions = new PiSessions(dir, cwd);
    expect(sessions.find(saved.id)).toBeDefined();
    const uid = process.getuid!();
    const identity = vi.spyOn(process, "getuid").mockReturnValue(uid + 1);
    try {
      expect(() => sessions.find(saved.id)).toThrow("forbidden");
      expect(() => sessions.session(saved.id)).toThrow("forbidden");
    } finally {
      identity.mockRestore();
    }
  },
);

it("duplicate Pi IDs across checkout directories are refused, never merged into one conversation", () => {
  const cwd = project(),
    agent = mkdtempSync(join(tmpdir(), "pi-shared-id-"));
  const a = join(cwd, "a"),
    b = join(cwd, "b"),
    id = randomUUID();
  for (const path of [a, b]) {
    mkdirSync(path);
    const directory = sessionDirectory(path, agent);
    mkdirSync(directory, { recursive: true });
    write(directory, path, [user(null, `Only ${path}`)], id);
  }
  const sessions = checkoutSessions(cwd, a, agent);
  expect(() => sessions.list()).toThrow("conflict");
  // A failed list must not leave one of its cached matches usable afterward.
  expect(() => sessions.find(id)).toThrow("conflict");
});

it.skipIf(process.platform === "win32")(
  "a configured parent alias and a default Pi group are one physical source",
  () => {
    const cwd = project(),
      parent = mkdtempSync(join(tmpdir(), "pi-alias-")),
      agent = join(parent, "agent"),
      alias = join(parent, "alias");
    mkdirSync(agent);
    symlinkSync(agent, alias, "dir");
    const directory = sessionDirectory(cwd, agent);
    mkdirSync(directory, { recursive: true });
    const saved = write(directory, cwd, [user(null, "One physical session")]);
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(
      join(cwd, ".pi", "settings.json"),
      JSON.stringify({ sessionDir: directory }),
    );
    const sessions = checkoutSessions(cwd, cwd, alias);
    expect(sessions.list().map((row) => row.summary.id)).toEqual([saved.id]);
    expect(sessions.find(saved.id)?.path).toBe(saved.path);
  },
);

it("sessions past the former 64MiB ceiling remain readable without changing their bytes", () => {
  const cwd = project(),
    dir = mkdtempSync(join(tmpdir(), "pi-too-large-"));
  const saved = write(dir, cwd, [user(null, "Existing history")]);
  const sessions = new PiSessions(dir, cwd);
  expect(sessions.find(saved.id)).toBeDefined();
  const original = readFileSync(saved.path, "utf8"),
    parsed = sessions.session(saved.id);
  if (!parsed) throw Error("session");
  sessions.turn(parsed, parsed.branch(parsed.current()), []);
  const fd = openSync(saved.path, "r+");
  try {
    // Many small lines, not one artificial 64MiB JSON value. Original history
    // remains at the same offsets; padding models retained historical volume.
    const page = Buffer.alloc(64 * 1024, 32);
    page[page.length - 1] = 10;
    for (let i = 0; i < 1025; i++)
      writeSync(
        fd,
        page,
        0,
        page.length,
        Buffer.byteLength(original) + i * page.length,
      );
  } finally {
    closeSync(fd);
  }
  for (const reader of [sessions, new PiSessions(dir, cwd)]) {
    expect(reader.list().map((row) => row.summary.id)).toEqual([saved.id]);
    expect(reader.find(saved.id)?.path).toBe(saved.path);
    expect(reader.session(saved.id)?.current()).toBe(parsed.current());
  }
  // An explicit external replacement is readable again, including when its
  // entry IDs and byte length match the old cached transcript.
  writeFileSync(
    saved.path,
    original.replace("Existing history", "Adjusted history"),
  );
  const restored = sessions.session(saved.id);
  if (!restored) throw Error("restored session");
  expect(
    sessions.turn(restored, restored.branch(restored.current()), []).items[0]
      .text,
  ).toBe("Adjusted history");
});
it("an unreadable session identity cannot prove a requested ID absent", () => {
  const cwd = project(),
    dir = mkdtempSync(join(tmpdir(), "pi-unreadable-"));
  const saved = write(dir, cwd, [user(null, "Existing history")]);
  const sessions = new PiSessions(dir, cwd);
  expect(sessions.find(saved.id)).toBeDefined();
  writeFileSync(saved.path, "{damaged header}\n");
  for (const reader of [sessions, new PiSessions(dir, cwd)])
    expect(() => reader.find(saved.id)).toThrow();
});

it("an unsupported Pi format is not absence and never authorizes a new same-ID session", () => {
  const cwd = project(),
    dir = mkdtempSync(join(tmpdir(), "pi-format-"));
  const saved = write(dir, cwd, [user(null, "Older Pi history")]);
  const current = readFileSync(saved.path, "utf8"),
    old = current.replace('"version":3', '"version":2');
  expect(old).not.toBe(current);
  writeFileSync(saved.path, old);
  const cold = new PiSessions(dir, cwd),
    warm = new PiSessions(dir, cwd);
  expect(warm.list()).toEqual([]);
  for (const reader of [cold, warm]) {
    expect(() => reader.find(saved.id)).toThrow("unsupported-context");
    expect(() => reader.session(saved.id)).toThrow("unsupported-context");
    expect(readFileSync(saved.path, "utf8")).toBe(old);
  }
  // Only an external writer can upgrade it; Cadence does not do so on read.
  writeFileSync(saved.path, current);
  expect(cold.session(saved.id)?.entries).toHaveLength(1);
});

it("user images are small descriptors; exact-branch lazy reads preserve Pi bytes and omitted unsupported media", async () => {
  const { PNG } = await import("./helpers/images.ts");
  const { sessionImage } = await import("../src/service/pi-sessions.ts");
  const cwd = project(),
    directory = join(cwd, "sessions");
  const id = randomUUID();
  const content = [
    { type: "text", text: "a screenshot" },
    ...Array.from({ length: 5 }, () => ({
      type: "image",
      data: PNG,
      mimeType: "image/png",
    })),
    { type: "image", data: "unsupported", mimeType: "image/svg+xml" },
  ];
  mkdirSync(directory);
  const { path } = write(
    directory,
    cwd,
    [
      entry("message", null, {
        id: "picture",
        message: { role: "user", content },
      }),
      entry("message", null, {
        id: "other",
        message: { role: "user", content: "another branch" },
      }),
    ],
    id,
  );
  const original = readFileSync(path);
  const sessions = new PiSessions(directory, cwd);
  const parsed = sessions.session(id)!;
  const view = listTurn(turnItems(parsed.branch("picture"), []));
  expect(view.steps[0].images).toEqual(
    Array.from({ length: 5 }, (_, index) => ({
      entry: "picture",
      index: index + 1,
      mimeType: "image/png",
    })),
  );
  expect(
    decodeWorkbenchResult({
      kind: "conversation-image",
      mimeType: "image/png",
      data: PNG,
      next: 8 * 1024 * 1024,
    }),
  ).toMatchObject({ next: 8 * 1024 * 1024 });
  expect(sessionImage(parsed, "picture", "picture", 5, 0)).toMatchObject({
    data: PNG,
  });
  expect(view.omitted.media).toBe(true);
  expect(JSON.stringify(view.steps)).not.toContain(PNG);
  expect(sessionImage(parsed, "picture", "picture", 1, 0)).toEqual({
    kind: "conversation-image",
    data: PNG,
    next: null,
    mimeType: "image/png",
  });
  expect(() => sessionImage(parsed, "other", "picture", 1, 0)).toThrow();
  expect(() => sessionImage(parsed, "picture", "picture", 6, 0)).toThrow();
  expect(() => sessionImage(parsed, "picture", "picture", 1, 4)).toThrow();
  expect(readFileSync(path)).toEqual(original);
});

it("retained descriptors include large images even beyond the old content-index ceiling", async () => {
  const { pngBytes } = await import("./helpers/images.ts");
  const data = Buffer.concat([
    pngBytes(),
    Buffer.alloc(5 * 1024 * 1024),
  ]).toString("base64");
  const view = listTurn(
    turnItems(
      [
        {
          type: "message",
          id: "picture",
          parentId: null,
          timestamp: "",
          pos: 0,
          raw: {
            message: {
              role: "user",
              content: [
                ...Array.from({ length: 1025 }, () => ({
                  type: "text",
                  text: "",
                })),
                ...Array.from({ length: 5 }, () => ({
                  type: "image",
                  data,
                  mimeType: "image/png",
                })),
              ],
            },
          },
        },
      ],
      [],
    ),
  );
  expect(view.steps[0].images).toEqual(
    Array.from({ length: 5 }, (_, i) => ({
      entry: "picture",
      index: 1025 + i,
      mimeType: "image/png",
    })),
  );
  expect(view.omitted.media).toBe(false);
  expect(JSON.stringify(view)).not.toContain(data);
});

/** No service or provider: the genuine capture codec feeds the live reader. */
function streamingFixture() {
  const live = new LiveCapture(() => []);
  const events: CaptureFrame[] = [];
  const emitter = new CaptureEmitter(
    randomUUID(),
    new Writable({
      write(chunk, _encoding, done) {
        const frame = JSON.parse(String(chunk)) as CaptureFrame;
        events.push(frame);
        live.accept(frame);
        done();
      },
    }),
    () => {
      throw new Error("capture failed");
    },
  );
  const sdk = new SdkCapture(emitter);
  let ready = false;
  const start = async () => {
    if (!ready) {
      await emitter.emit({ kind: "ready", requestProtocol: 2 });
      ready = true;
    }
    await sdk.event({ type: "message_start", message: { role: "assistant" } });
    const e = events.at(-1)!.event;
    if (e.kind !== "message-start") throw new Error("missing start");
    return e.messageId;
  };
  const end = (content: unknown[], stopReason = "stop") =>
    sdk.event({
      type: "message_end",
      message: { role: "assistant", content, stopReason },
    });
  return { live, sdk, start, end };
}
it("stream identity: batches retain empty/thinking/tool messages and legitimate repeated text", async () => {
  const f = streamingFixture(),
    cwd = project(),
    commandId = randomUUID();
  const dir = mkdtempSync(join(tmpdir(), "identity-batch-"));
  const u = user(null, "question");
  const entries = [
    u,
    entry("custom", u.id, {
      customType: BROWSER_COMMAND_ENTRY,
      data: { commandId, userId: u.id },
    }),
  ];
  const ids: string[] = [];
  for (const content of [
    [{ type: "text", text: "Repeated" }],
    [{ type: "thinking", thinking: "stored only" }],
    [{ type: "toolCall", id: "call", name: "read", arguments: {} }],
    [],
    [{ type: "text", text: "Repeated" }],
  ]) {
    const captureMessageId = await f.start();
    ids.push(captureMessageId);
    await f.end(content);
    const a = assistant(entries.at(-1)!.id, content);
    entries.push(
      a,
      entry("custom", a.id, {
        customType: BROWSER_COMMAND_ENTRY,
        data: { commandId, userId: u.id, captureMessageId },
      }),
    );
  }
  const saved = write(dir, cwd, entries),
    sessions = new PiSessions(dir, cwd);
  const session = sessions.session(saved.id)!;
  const durable = turnItems(session.branch(session.current()), []);
  expect(durable.captureMessages).toEqual(ids);
  const merged = f.live.extend(durable.items, [], durable.captureMessages);
  expect(
    merged.items.filter((i) => i.role === "assistant").map((i) => i.text),
  ).toEqual(["Repeated", "Repeated"]);
  expect(merged.items.map((i) => i.role)).toEqual([
    "user",
    "assistant",
    "thinking",
    "tool",
    "assistant",
  ]);
});
it("stream identity: text-thinking-tool-text keeps real content indices before and after durable handoff", async () => {
  const f = streamingFixture(),
    id = await f.start();
  const content = [
    { type: "text", text: "First" },
    { type: "thinking", thinking: "private" },
    { type: "toolCall", id: "call", name: "read", arguments: {} },
    { type: "text", text: "Last" },
  ];
  await f.end(content);
  const preview = f.live.extend([]).items;
  expect(preview.map((i) => i.role)).toEqual([
    "assistant",
    "thinking",
    "tool",
    "assistant",
  ]);
  expect(preview.map((i) => i.renderId)).toEqual(
    content.map((_, index) => `capture:${id}:${index}`),
  );
  expect(
    preview.filter((i) => i.role === "assistant").map((i) => i.text),
  ).toEqual(["First", "Last"]);
  expect(JSON.stringify(preview)).not.toContain("private");
});

it("tool snapshots replace output and change the detail version with the same parts count; empty final output still settles", async () => {
  const f = streamingFixture();
  await f.start();
  await f.end(
    [
      {
        type: "toolCall",
        id: "execute",
        name: "bash",
        arguments: { command: "controlled" },
      },
    ],
    "toolUse",
  );
  const steps = () =>
    listTurn({ ...turnItems([], []), items: f.live.extend([]).items });
  const pending = steps().steps[0];
  expect(pending.state).toBe("pending");
  await f.sdk.event({
    type: "tool_execution_start",
    toolCallId: "execute",
    toolName: "bash",
    args: { command: "controlled" },
  });
  const running = steps().steps[0];
  expect(running).toMatchObject({
    state: "running",
    renderId: pending.renderId,
    version: pending.version,
  });
  for (const text of ["First snapshot", "Other snapshot"]) {
    await f.sdk.event({
      type: "tool_execution_update",
      toolCallId: "execute",
      toolName: "bash",
      partialResult: { content: [{ type: "text", text }] },
    });
    const current = steps();
    expect(current.parts[0][0].text).toBe(text);
    expect(current.steps[0]).toMatchObject({
      renderId: pending.renderId,
      state: "running",
      parts: running.parts,
    });
    expect(current.steps[0].version).not.toBe(running.version);
    if (text.startsWith("First")) running.version = current.steps[0].version;
  }
  await f.sdk.event({
    type: "tool_execution_end",
    toolCallId: "execute",
    toolName: "bash",
    isError: false,
    result: { content: [] },
  });
  expect(steps().steps[0]).toMatchObject({
    state: "completed",
    parts: running.parts,
    renderId: pending.renderId,
  });
  expect(steps().parts[0][0].text).toBe("");
});
it.each(["error", "aborted"])(
  "%s ends thinking and partial tool activity without inventing output, then a retry keeps a new identity",
  async (stopReason) => {
    const f = streamingFixture(),
      first = await f.start();
    await f.sdk.event({
      type: "message_update",
      assistantMessageEvent: { type: "thinking_start", contentIndex: 0 },
    });
    await f.end(
      [
        { type: "thinking", thinking: "not streamed" },
        { type: "text", text: "Repeated" },
        { type: "toolCall", id: "not-executed", name: "read", arguments: {} },
      ],
      stopReason,
    );
    const failed = f.live.extend([]).items;
    expect(failed[0]).toMatchObject({ state: "unavailable", text: "" });
    expect(failed[1].state).toBe(
      stopReason === "aborted" ? "canceled" : "failed",
    );
    expect(failed[2].state).toBe(
      stopReason === "aborted" ? "canceled" : "unavailable",
    );
    const second = await f.start();
    await f.end([{ type: "text", text: "Repeated" }]);
    expect(second).not.toBe(first);
    expect(
      f.live
        .extend([])
        .items.filter((i) => i.role === "assistant")
        .map((i) => i.text),
    ).toEqual(["Repeated", "Repeated"]);
  },
);
it.each(["error", "length", "aborted", "toolUse"])(
  "%s keeps an unexecuted declaration neutral in capture and linked or legacy Pi history",
  async (stopReason) => {
    const f = streamingFixture(),
      captureMessageId = await f.start();
    const content = [
      { type: "text", text: "Before" },
      {
        type: "toolCall",
        id: "not-executed",
        name: "read",
        arguments: { path: "file.ts" },
      },
      { type: "text", text: "After" },
    ];
    await f.end(content, stopReason);
    const preview = f.live.extend([]).items;
    const toolState =
      stopReason === "aborted"
        ? "canceled"
        : stopReason === "toolUse"
          ? "pending"
          : "unavailable";
    const assistantState =
      stopReason === "aborted"
        ? "canceled"
        : stopReason === "toolUse"
          ? "completed"
          : "failed";
    expect(preview.map((item) => item.state)).toEqual([
      assistantState,
      toolState,
      assistantState,
    ]);
    expect(preview[1]).toMatchObject({ error: false, text: "" });
    for (const linked of [true, false]) {
      const cwd = project(),
        dir = mkdtempSync(join(tmpdir(), "declaration-state-")),
        commandId = randomUUID(),
        u = user(null, "Question"),
        entries = [u];
      const mark = (parentId: string, captureMessageId?: string) =>
        entry("custom", parentId, {
          customType: BROWSER_COMMAND_ENTRY,
          data: {
            commandId,
            userId: u.id,
            ...(captureMessageId ? { captureMessageId } : {}),
          },
        });
      if (linked) entries.push(mark(u.id));
      const reply = assistant(
        entries.at(-1)!.id,
        content,
        stopReason,
        "Model request failed",
      );
      entries.push(reply);
      if (linked) entries.push(mark(reply.id, captureMessageId));
      const saved = write(dir, cwd, entries),
        original = readFileSync(saved.path);
      // Separate readers exercise cold observations; no marker means no guessed link.
      for (let observation = 0; observation < 2; observation++) {
        const sessions = new PiSessions(dir, cwd),
          session = sessions.session(saved.id)!,
          durable = sessions.turn(
            session,
            session.branch(session.current()),
            [],
          );
        expect(
          durable.items
            .slice(1)
            .map((item) => [item.role, item.state, item.error]),
        ).toEqual(preview.map((item) => [item.role, item.state, item.error]));
        expect(durable.steps.slice(1).map((step) => step.renderId)).toEqual(
          content.map((_, index) =>
            linked
              ? `capture:${captureMessageId}:${index}`
              : `pi:${reply.id}:${index}`,
          ),
        );
        expect(durable.steps[2]).toMatchObject({
          state: toolState,
          error: false,
          parts: 1,
          text: "",
        });
        expect(durable.parts[2][0]).toMatchObject({
          state: toolState,
          error: false,
          text: "",
          args: '{"path":"file.ts"}',
        });
        // Preserve Pi's existing reply-level status/notice, including length's status.
        expect(durable).toMatchObject({
          status:
            stopReason === "error"
              ? "failed"
              : stopReason === "aborted"
                ? "canceled"
                : "completed",
          notice: stopReason === "error" ? "Model request failed" : "",
        });
        if (linked)
          expect(
            f.live.extend(durable.items, [], durable.captureMessages).items,
          ).toEqual(durable.items);
        else expect(durable.captureMessages).toEqual([]);
        expect(readFileSync(saved.path)).toEqual(original);
      }
    }
  },
);
it.each([
  "duplicate",
  "foreign-user",
  "foreign-run",
  "non-message-parent",
  "extra-field",
  "invalid-id",
  "foreign-branch",
])("capture bridge refuses %s without guessing a replacement", (problem) => {
  const cwd = project(),
    dir = mkdtempSync(join(tmpdir(), "identity-invalid-")),
    commandId = randomUUID(),
    captureMessageId = randomUUID();
  const u = user(null, "q"),
    start = entry("custom", u.id, {
      customType: BROWSER_COMMAND_ENTRY,
      data: { commandId, userId: u.id, captureMessageId: randomUUID() },
    });
  const a = assistant(start.id, [{ type: "text", text: "same" }]);
  const marker = entry("custom", a.id, {
    customType: BROWSER_COMMAND_ENTRY,
    data: { commandId, userId: u.id, captureMessageId },
  });
  const data = marker.data as Record<string, unknown>;
  const entries = [u, start, a, marker];
  if (problem === "duplicate")
    entries.push(
      entry("custom", marker.id, { customType: BROWSER_COMMAND_ENTRY, data }),
    );
  if (problem === "foreign-user") data.userId = "another";
  if (problem === "foreign-run") data.run = randomUUID();
  if (problem === "non-message-parent") marker.parentId = start.id;
  if (problem === "extra-field") data.body = "forbidden";
  if (problem === "invalid-id") data.captureMessageId = "not-a-uuid";
  if (problem === "foreign-branch") {
    const other = assistant(start.id, []);
    entries.push(
      other,
      entry("custom", other.id, {
        customType: BROWSER_COMMAND_ENTRY,
        data: { commandId: randomUUID(), userId: u.id, captureMessageId },
      }),
    );
  }
  const saved = write(dir, cwd, entries),
    sessions = new PiSessions(dir, cwd),
    session = sessions.session(saved.id)!;
  expect(() => session.commandEntries(commandId, null, 0)).toThrow();
  expect(() => sessions.turn(session, session.branch(marker.id), [])).toThrow();
});

it("tool results keep source order and can reuse a call ID only after its previous result settled", () => {
  const cwd = project(),
    dir = mkdtempSync(join(tmpdir(), "identity-tools-"));
  const u = user(null, "q"),
    entries = [u];
  for (const text of ["first", "second"]) {
    const a = assistant(
      entries.at(-1)!.id,
      [
        { type: "text", text: "Before" },
        { type: "toolCall", id: "same-call", name: "read", arguments: {} },
        { type: "text", text: "After" },
      ],
      "toolUse",
    );
    entries.push(
      a,
      entry("message", a.id, {
        message: {
          role: "toolResult",
          toolCallId: "same-call",
          toolName: "read",
          content: [{ type: "text", text }],
          isError: text === "second",
        },
      }),
    );
  }
  const saved = write(dir, cwd, entries),
    sessions = new PiSessions(dir, cwd),
    session = sessions.session(saved.id)!;
  const built = sessions.turn(session, session.branch(session.current()), []);
  expect(built.items.map((item) => item.role)).toEqual([
    "user",
    "assistant",
    "tool",
    "assistant",
    "assistant",
    "tool",
    "assistant",
  ]);
  expect(
    built.items
      .filter((item) => item.role === "tool")
      .map((item) => [item.text, item.state]),
  ).toEqual([
    ["first", "completed"],
    ["second", "failed"],
  ]);
  expect(new Set(built.steps.map((step) => step.renderId)).size).toBe(
    built.steps.length,
  );
});

/** Controlled Pi bytes, never SDK input: old names may exceed capture's limits. */
function toolNameHistory(linked: boolean, messages: Record<string, unknown>[]) {
  const cwd = project(),
    dir = mkdtempSync(join(tmpdir(), "tool-name-history-")),
    commandId = randomUUID(),
    u = user(null, "Question"),
    entries = [u];
  const mark = (captureMessageId?: string) =>
    entries.push(
      entry("custom", entries.at(-1)!.id, {
        customType: BROWSER_COMMAND_ENTRY,
        data: {
          commandId,
          userId: u.id,
          ...(captureMessageId ? { captureMessageId } : {}),
        },
      }),
    );
  if (linked) mark();
  const identities = messages.map((message) => {
    const source = entry("message", entries.at(-1)!.id, { message }),
      captureMessageId = randomUUID();
    entries.push(source);
    if (linked) mark(captureMessageId);
    return linked ? `capture:${captureMessageId}` : `pi:${source.id}`;
  });
  const saved = write(dir, cwd, entries),
    original = readFileSync(saved.path);
  return {
    renderId: (message: number, index = 0) => `${identities[message]}:${index}`,
    read(secrets: readonly string[] = []) {
      const sessions = new PiSessions(dir, cwd),
        session = sessions.session(saved.id)!,
        built = sessions.turn(
          session,
          session.branch(session.current()),
          secrets,
        );
      expect(built.captureMessages).toHaveLength(linked ? messages.length : 0);
      for (const [step, parts] of built.parts.entries()) {
        for (const [part, item] of parts.entries()) {
          // Closed public decoding rejects any accidentally exposed raw identity.
          expect(
            decodeWorkbenchResult({
              kind: "conversation-step",
              conversationId: saved.id,
              leaf: session.current(),
              turnId: u.id,
              step,
              part,
              item,
            }),
          ).toMatchObject({ item });
          expect(
            Buffer.byteLength(JSON.stringify(item.name)),
          ).toBeLessThanOrEqual(128);
          expect(item.name).not.toMatch(/\p{Surrogate}/u);
        }
      }
      for (const secret of secrets)
        expect(JSON.stringify(built)).not.toContain(secret);
      expect(readFileSync(saved.path)).toEqual(original);
      return built;
    },
  };
}

const toolNameCases = [
  { label: "126-byte ASCII", name: "n".repeat(126), display: "n".repeat(126) },
  { label: "127-byte ASCII", name: "n".repeat(127), display: "n".repeat(126) },
  { label: "128-byte ASCII", name: "n".repeat(128), display: "n".repeat(126) },
  { label: "multibyte", name: "界".repeat(43), display: "界".repeat(42) },
  { label: "surrogate pair", name: "😀".repeat(32), display: "😀".repeat(31) },
  {
    label: "JSON escapes",
    name: '"\\'.repeat(32),
    display: `${'"\\'.repeat(31)}"`,
  },
  {
    label: "read redaction expansion",
    name: `lookup-${"k7X".repeat(14)}`,
    display: `lookup-${"[redacted]".repeat(11)}[redacted`,
    secrets: ["k7X"],
  },
];
it.each(
  toolNameCases.flatMap((test) =>
    [true, false].flatMap((linked) =>
      [false, true].map((isError) => ({ ...test, linked, isError })),
    ),
  ),
)(
  "$label, linked=$linked, isError=$isError: tool results match full source names, not display names",
  ({ name, display, linked, isError, ...test }) => {
    const f = toolNameHistory(linked, [
      {
        role: "assistant",
        stopReason: isError ? "aborted" : "length",
        content: [
          { type: "text", text: "Before" },
          {
            type: "toolCall",
            id: "call",
            name,
            arguments: { path: "file.ts" },
          },
          { type: "text", text: "After" },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "call",
        toolName: name,
        content: [{ type: "text", text: "Recorded output" }],
        isError,
      },
      { role: "assistant", stopReason: "error", content: [] },
    ]);
    // A fresh reader repeats the association without capture/overlay state.
    for (let observation = 0; observation < 2; observation++) {
      const built = f.read("secrets" in test ? test.secrets : []);
      expect(built.items.map((item) => item.role)).toEqual([
        "user",
        "assistant",
        "tool",
        "assistant",
      ]);
      expect(built.items[2]).toMatchObject({
        renderId: f.renderId(0, 1),
        name: display,
        text: "Recorded output",
        args: '{"path":"file.ts"}',
        error: isError,
        state: isError ? "failed" : "completed",
      });
      expect(built.steps[2]).toMatchObject({
        renderId: f.renderId(0, 1),
        name: display,
        text: "",
        parts: 1,
        state: built.items[2].state,
        error: isError,
        version: built.items[2].version,
      });
      expect(built.parts[2]).toEqual([built.items[2]]);
    }
  },
);

it.each(
  [
    {
      label: "same clipped prefix",
      declared: `${"n".repeat(126)}-one`,
      result: `${"n".repeat(126)}-two`,
      secrets: [],
    },
    {
      label: "result equals clipped display",
      declared: "n".repeat(127),
      result: "n".repeat(126),
      secrets: [],
    },
    {
      label: "same redacted display",
      declared: "lookup-secret-one",
      result: "lookup-secret-two",
      secrets: ["secret-one", "secret-two"],
    },
  ].flatMap((test) => [true, false].map((linked) => ({ ...test, linked }))),
)(
  "$label, linked=$linked: a display collision cannot assign a result to the wrong declaration",
  ({ declared, result, secrets, linked }) => {
    const f = toolNameHistory(linked, [
      {
        role: "assistant",
        stopReason: "error",
        content: [
          { type: "toolCall", id: "same-call", name: declared, arguments: {} },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "same-call",
        toolName: result,
        content: [{ type: "text", text: "Orphan output" }],
        isError: true,
      },
    ]);
    const built = f.read(secrets);
    expect(built.items.map((item) => item.role)).toEqual([
      "user",
      "tool",
      "tool",
    ]);
    expect(built.items[1].name).toBe(built.items[2].name);
    expect(built.items[1]).toMatchObject({
      renderId: f.renderId(0),
      state: "unavailable",
      error: false,
      text: "",
    });
    expect(built.items[2]).toMatchObject({
      renderId: f.renderId(1),
      state: "failed",
      error: true,
      text: "Orphan output",
    });
  },
);

it.each([true, false])(
  "linked=%s: unresolved duplicate call IDs remain ambiguous even with different full names",
  (linked) => {
    for (const secondName of ["n".repeat(127), "n".repeat(128)]) {
      const f = toolNameHistory(linked, [
        {
          role: "assistant",
          stopReason: "toolUse",
          content: [
            {
              type: "toolCall",
              id: "duplicate",
              name: "n".repeat(127),
              arguments: {},
            },
            {
              type: "toolCall",
              id: "duplicate",
              name: secondName,
              arguments: {},
            },
          ],
        },
        {
          role: "toolResult",
          toolCallId: "duplicate",
          toolName: secondName,
          content: [{ type: "text", text: "Ambiguous result" }],
          isError: false,
        },
      ]);
      const built = f.read();
      expect(
        built.items
          .slice(1)
          .map((item) => [item.renderId, item.state, item.error, item.text]),
      ).toEqual([
        [f.renderId(0, 0), "pending", false, ""],
        [f.renderId(0, 1), "pending", false, ""],
        [f.renderId(1), "completed", false, "Ambiguous result"],
      ]);
    }
  },
);

it.each([true, false])(
  "linked=%s: a matched result releases the source call ID for legal reuse",
  (linked) => {
    const f = toolNameHistory(
      linked,
      [126, 127, 128].flatMap((length, index) => [
        {
          role: "assistant",
          stopReason: "toolUse",
          content: [
            { type: "text", text: `Before ${index}` },
            {
              type: "toolCall",
              id: "reused",
              name: "n".repeat(length),
              arguments: { index },
            },
            { type: "text", text: `After ${index}` },
          ],
        },
        {
          role: "toolResult",
          toolCallId: "reused",
          toolName: "n".repeat(length),
          content: [{ type: "text", text: `Result ${index}` }],
          isError: index === 1,
        },
      ]),
    );
    const built = f.read();
    expect(built.items.map((item) => item.role)).toEqual([
      "user",
      ...Array(3).fill(["assistant", "tool", "assistant"]).flat(),
    ]);
    expect(
      built.items
        .filter((item) => item.role === "tool")
        .map((item) => [item.renderId, item.text, item.state]),
    ).toEqual([
      [f.renderId(0, 1), "Result 0", "completed"],
      [f.renderId(2, 1), "Result 1", "failed"],
      [f.renderId(4, 1), "Result 2", "completed"],
    ]);
  },
);

it.each([true, false])(
  "linked=%s: missing historical names still default to tool, but missing/wrong IDs never match",
  (linked) => {
    const f = toolNameHistory(linked, [
      {
        role: "assistant",
        stopReason: "toolUse",
        content: [
          { type: "toolCall", id: "missing-name", arguments: {} },
          {
            type: "toolCall",
            id: "explicit-name",
            name: "tool",
            arguments: {},
          },
          { type: "toolCall", name: "tool", arguments: {} },
          { type: "toolCall", id: "unmatched", name: "tool", arguments: {} },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "missing-name",
        content: [{ type: "text", text: "Default" }],
      },
      {
        role: "toolResult",
        toolCallId: "explicit-name",
        content: [{ type: "text", text: "Explicit" }],
      },
      { role: "toolResult", content: [{ type: "text", text: "No ID" }] },
      {
        role: "toolResult",
        toolCallId: "other",
        toolName: "tool",
        content: [{ type: "text", text: "Wrong ID" }],
      },
    ]);
    const built = f.read();
    expect(
      built.items
        .slice(1)
        .map((item) => [item.renderId, item.state, item.text]),
    ).toEqual([
      [f.renderId(0, 0), "completed", "Default"],
      [f.renderId(0, 1), "completed", "Explicit"],
      [f.renderId(0, 2), "pending", ""],
      [f.renderId(0, 3), "pending", ""],
      [f.renderId(3), "completed", "No ID"],
      [f.renderId(4), "completed", "Wrong ID"],
    ]);
    expect(built.items.slice(1).every((item) => item.name === "tool")).toBe(
      true,
    );
  },
);

it.each([
  "extra-field",
  "invalid-id",
  "missing-message-id",
  "assistant-role",
  "user-role",
  "non-message-parent",
  "same-as-message",
  "duplicate-result",
  "duplicate-message",
  "cross-command-result",
  "foreign-command",
  "foreign-user",
  "foreign-run",
  "foreign-branch",
  "pre-admission",
  "wrong-parent",
])(
  "independent result bridge refuses %s without rewriting history",
  (problem) => {
    const cwd = project(),
      dir = mkdtempSync(join(tmpdir(), "result-identity-invalid-")),
      commandId = randomUUID(),
      captureMessageId = randomUUID(),
      captureResultCallId = randomUUID();
    const u = user(null, "Question"),
      start = entry("custom", u.id, {
        customType: BROWSER_COMMAND_ENTRY,
        data: { commandId, userId: u.id },
      });
    const result = entry("message", start.id, {
      message: {
        role: "toolResult",
        toolCallId: "call",
        toolName: "read",
        content: [],
        isError: false,
      },
    });
    const data: Record<string, unknown> = {
      commandId,
      userId: u.id,
      captureMessageId,
      captureResultCallId,
    };
    const marker = entry("custom", result.id, {
      customType: BROWSER_COMMAND_ENTRY,
      data,
    });
    const entries = [u, start, result, marker];
    if (problem === "extra-field") data.resultText = "forbidden";
    if (problem === "invalid-id") data.captureResultCallId = "not-a-uuid";
    if (problem === "missing-message-id") delete data.captureMessageId;
    if (problem === "same-as-message")
      data.captureResultCallId = captureMessageId;
    if (problem === "assistant-role")
      result.message = { role: "assistant", content: [] };
    if (problem === "user-role") {
      (start.data as Record<string, unknown>).captureMessageId =
        captureMessageId;
      (start.data as Record<string, unknown>).captureResultCallId =
        captureResultCallId;
      delete data.captureMessageId;
      delete data.captureResultCallId;
    }
    if (problem === "non-message-parent") marker.parentId = start.id;
    if (problem === "foreign-user") data.userId = "foreign";
    if (problem === "foreign-run") data.run = randomUUID();
    if (problem === "foreign-command") data.commandId = randomUUID();
    if (
      ["duplicate-result", "duplicate-message", "foreign-branch"].includes(
        problem,
      )
    ) {
      const other = entry(
        "message",
        problem === "foreign-branch" ? start.id : marker.id,
        { message: result.message },
      );
      entries.push(
        other,
        entry("custom", other.id, {
          customType: BROWSER_COMMAND_ENTRY,
          data: {
            commandId,
            userId: u.id,
            captureMessageId:
              problem === "duplicate-message"
                ? captureResultCallId
                : randomUUID(),
            ...(problem === "duplicate-message" ? {} : { captureResultCallId }),
          },
        }),
      );
    }
    if (problem === "cross-command-result") {
      const otherCommand = randomUUID(),
        otherUser = user(marker.id, "Other");
      const otherStart = entry("custom", otherUser.id, {
        customType: BROWSER_COMMAND_ENTRY,
        data: { commandId: otherCommand, userId: otherUser.id },
      });
      const otherResult = entry("message", otherStart.id, {
        message: result.message,
      });
      entries.push(
        otherUser,
        otherStart,
        otherResult,
        entry("custom", otherResult.id, {
          customType: BROWSER_COMMAND_ENTRY,
          data: {
            commandId: otherCommand,
            userId: otherUser.id,
            captureMessageId: randomUUID(),
            captureResultCallId,
          },
        }),
      );
    }
    const saved = write(dir, cwd, entries),
      original = readFileSync(saved.path),
      sessions = new PiSessions(dir, cwd),
      session = sessions.session(saved.id)!;
    if (problem === "pre-admission" || problem === "wrong-parent") {
      expect(() =>
        session.commandEntries(
          commandId,
          problem === "wrong-parent" ? "foreign" : null,
          problem === "pre-admission" ? original.length : 0,
        ),
      ).toThrow();
    } else {
      if (problem === "foreign-command") {
        expect(
          session.commandEntries(commandId, null, 0).map((e) => e.id),
        ).toEqual([u.id, start.id]);
        expect(() =>
          session.commandEntries(data.commandId as string, null, 0),
        ).toThrow();
      } else expect(() => session.commandEntries(commandId, null, 0)).toThrow();
      expect(() =>
        sessions.turn(session, session.branch(entries.at(-1)!.id), []),
      ).toThrow();
    }
    expect(readFileSync(saved.path)).toEqual(original);
  },
);

it.each([false, true])(
  "verified result messages suppress earlier independent previews without guessing old links (result bridge=%s)",
  async (linked) => {
    const f = streamingFixture(),
      cwd = project(),
      dir = mkdtempSync(join(tmpdir(), "earlier-result-")),
      commandId = randomUUID();
    await f.start();
    await f.end([]);
    await f.sdk.event({
      type: "tool_execution_end",
      toolCallId: "source",
      toolName: "read",
      isError: false,
      result: { content: [{ type: "text", text: "Output" }] },
    });
    const preview = f.live.extend([]).items;
    expect(preview).toHaveLength(1);
    const message = {
      role: "toolResult",
      toolCallId: "source",
      toolName: "read",
      isError: false,
      content: [{ type: "text", text: "Output" }],
    };
    await f.sdk.event({ type: "message_start", message });
    const captureMessageId = f.sdk.messageId!,
      captureResultCallId = f.sdk.resultCallId!;
    expect(preview[0].renderId).toBe(`call:${captureResultCallId}`);
    await f.sdk.event({ type: "message_end", message });
    const u = user(null, "Question"),
      start = entry("custom", u.id, {
        customType: BROWSER_COMMAND_ENTRY,
        data: { commandId, userId: u.id },
      });
    const result = entry("message", start.id, { message }),
      marker = entry("custom", result.id, {
        customType: BROWSER_COMMAND_ENTRY,
        data: {
          commandId,
          userId: u.id,
          captureMessageId,
          ...(linked ? { captureResultCallId } : {}),
        },
      });
    const next = user(marker.id, "Next");
    const saved = write(dir, cwd, [u, start, result, marker, next]),
      original = readFileSync(saved.path),
      sessions = new PiSessions(dir, cwd),
      session = sessions.session(saved.id)!;
    const earlier = sessions.turn(session, session.branch(marker.id), []);
    expect(earlier.items.at(-1)!.renderId).toBe(
      linked ? preview[0].renderId : `capture:${captureMessageId}:0`,
    );
    const current = turnItems([session.byId.get(next.id)!], []);
    const extended = f.live.extend(
      current.items,
      earlier.items,
      earlier.captureMessages,
    );
    expect(extended.items).toEqual(current.items);
    const publicTurn = listTurn({ ...current, items: extended.items });
    expect(
      decodeWorkbenchResult({
        kind: "conversation-turn",
        conversationId: saved.id,
        leaf: next.id,
        ordinal: 1,
        turn: {
          id: publicTurn.id,
          entry: publicTurn.entry,
          parent: publicTurn.parent,
          at: publicTurn.at,
          status: publicTurn.status,
          notice: publicTurn.notice,
          omitted: publicTurn.omitted,
          steps: publicTurn.steps.length,
          stable: publicTurn.steps.length,
        },
        start: 0,
        steps: publicTurn.steps,
      }),
    ).toMatchObject({ steps: [{ role: "user", text: "Next" }] });
    expect(readFileSync(saved.path)).toEqual(original);
  },
);
