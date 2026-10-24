/** Cadence owner feed for the background-agent panel: fake typed reads, real bus. */
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FEED_TIMING,
  type FeedConnection,
  registerCadenceAgentFeed,
} from "../src/agent-panel-cadence.ts";
import {
  SUBAGENT_EVENTS as E,
  SUBAGENT_VIEW,
} from "../src/agent-panel-model.ts";

const injected = vi.hoisted(() => ({
  instances: [] as any[],
  attach: null as null | ((cwd: string) => Promise<unknown>),
}));
vi.mock("../src/native-client.ts", async (original) => ({
  ...(await original<typeof import("../src/native-client.ts")>()),
  NativeConnection: class {
    attach = vi.fn((cwd: string) =>
      injected.attach
        ? injected.attach(cwd)
        : Promise.reject(new Error("unavailable")),
    );
    detach = vi.fn(async () => {});
    refresh = vi.fn(async () => ({}));
    compatible = vi.fn(() => true);
    client = undefined;
    session = undefined;
    constructor() {
      injected.instances.push(this);
    }
  },
}));

const STORE = "11111111-1111-4111-8111-111111111111",
  TASK = "22222222-2222-4222-8222-222222222222",
  RUN = "33333333-3333-4333-8333-333333333333",
  C1 = "44444444-4444-4444-8444-444444444444",
  C2 = "55555555-5555-4555-8555-555555555555",
  GRAPH = { recordId: RUN, revision: 1, sha256: "a".repeat(64) };
const T0 = 1_700_000_000_000;

const ok = (value: unknown) => ({ kind: "ok", value });
const refused = { kind: "error", error: { code: "unavailable" } };
const row = (
  childRunId: string | null,
  assignmentId: string | null,
  lifecycle: string,
  outcome: string | null = null,
  reason: string | null = null,
) => ({
  runId: RUN,
  taskId: TASK,
  childRunId,
  assignmentId,
  admission: { kind: "start", graph: GRAPH },
  lifecycle,
  outcome,
  reason,
});
const ref = (recordId: string, field = "final-text") => ({
  recordId,
  version: 1,
  field,
  bytes: 1,
  sha256: "b".repeat(64),
});
const msg = (
  id: string,
  role: string,
  state: string,
  finalText: object | null,
  resultCallId: string | null = null,
) => ({
  kind: "message",
  owner: { entity: { kind: "message", id } },
  role,
  state,
  finalText,
  resultCallId,
});
const tool = (
  callId: string,
  name: string,
  messageId: string,
  done = true,
) => ({
  kind: "tool",
  owner: { entity: { kind: "tool", id: callId } },
  name,
  declaration: { messageId, blockId: "b0" },
  result: done ? { kind: "tool-end", isError: false } : null,
});
const content = (owner: object, recordId: string) => ({
  kind: "content",
  descriptor: { owner },
  content: ref(recordId, "tool-args"),
});

/** Typed-read fake: only the readonly operations the feed may use exist. */
function owner() {
  const s = {
    roster: [{ taskId: TASK, runId: RUN }] as object[],
    seq: "10",
    rows: [] as object[],
    records: {} as Record<string, Record<string, object[]>>,
    details: {} as Record<string, string>,
  };
  const page = (reader: string) =>
    vi.fn(async (request: any) =>
      ok({
        request,
        records: s.records[request.scope.id]?.[reader] ?? [],
        next: null,
      }),
    );
  const client = {
    activeRuns: vi.fn(async () => ok({ status: "complete", runs: s.roster })),
    snapshot: vi.fn(async (scope: any) =>
      ok({ storeId: STORE, scope, committedSeq: s.seq, runs: s.rows }),
    ),
    // The first graph read reports proof progress; the feed continues it.
    graph: vi.fn(async (request: any) =>
      request.navigation
        ? ok({
            request,
            graph: {
              assignments: [
                { id: "inspect-api", purpose: "research" },
                { id: "write-fix", purpose: "edit" },
              ],
            },
          })
        : ok({
            kind: "progress",
            request,
            next: { ...request, navigation: "n" },
          }),
    ),
    messages: page("messages"),
    tools: page("tools"),
    contents: page("contents"),
    detail: vi.fn(async (cursor: any) =>
      cursor.recordId in s.details
        ? ok({ cursor, text: s.details[cursor.recordId], next: null })
        : refused,
    ),
  };
  return { s, client };
}
function connection(client: unknown) {
  return {
    attach: vi.fn(async () => client),
    refresh: vi.fn(async () => ({})),
    compatible: vi.fn(() => true),
    detach: vi.fn(async () => {}),
  } satisfies Record<keyof FeedConnection, unknown>;
}
function bus() {
  const handlers = new Map<string, Set<(data: unknown) => void>>();
  const sent: [string, any][] = [];
  return {
    sent,
    on(channel: string, fn: (data: unknown) => void) {
      handlers.set(channel, (handlers.get(channel) ?? new Set()).add(fn));
      return () => handlers.get(channel)?.delete(fn);
    },
    emit(channel: string, data: unknown) {
      sent.push([channel, data]);
      for (const fn of handlers.get(channel) ?? []) fn(data);
    },
  };
}
function host(conn: unknown, ctx: object = {}) {
  const events = bus();
  const handlers = new Map<string, ((...args: any[]) => unknown)[]>();
  const pi = {
    events,
    on(name: string, fn: (...args: any[]) => unknown) {
      handlers.set(name, [...(handlers.get(name) ?? []), fn]);
    },
  };
  let clock = T0;
  registerCadenceAgentFeed(pi as never, {
    connection: () => conn as FeedConnection,
    now: () => clock,
  });
  const context = { cwd: "/work/project", mode: "tui", hasUI: true, ...ctx };
  return {
    events,
    at: (t: number) => {
      clock = t;
    },
    async emit(name: string) {
      for (const fn of handlers.get(name) ?? []) await fn({}, context);
    },
    published: (channel?: string) =>
      events.sent
        .filter(([c]) => c !== SUBAGENT_VIEW && (!channel || c === channel))
        .map(([c, d]) => (channel ? d : [c, d])),
  };
}
/** Fake setTimeout only; the feed's awaited reads settle on real ticks. */
async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  injected.instances = [];
  injected.attach = null;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("Cadence owner feed", () => {
  it("never starts an owner: an absent one leaves the bus quiet and is looked up again later", async () => {
    const conn = {
      ...connection(undefined),
      attach: vi.fn(async () => {
        throw new Error("unavailable");
      }),
    };
    const h = host(conn);
    await h.emit("session_start");
    expect(conn.attach).not.toHaveBeenCalled();
    await advance(FEED_TIMING.firstMs);
    expect(conn.attach).toHaveBeenCalledWith("/work/project");
    expect(conn.detach).toHaveBeenCalled();
    await advance(FEED_TIMING.retryMs - 1);
    expect(conn.attach).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(conn.attach).toHaveBeenCalledTimes(2);
    expect(h.published()).toEqual([]);
  });

  it("stays off outside the TUI and with CADENCE_AGENT_PANEL=off", async () => {
    for (const ctx of [{ mode: "rpc" }, { hasUI: false }]) {
      const conn = connection(owner().client);
      await host(conn, ctx).emit("session_start");
      await advance(FEED_TIMING.retryMs);
      expect(conn.attach).not.toHaveBeenCalled();
    }
    vi.stubEnv("CADENCE_AGENT_PANEL", "off");
    const conn = connection(owner().client);
    await host(conn).emit("session_start");
    await advance(FEED_TIMING.retryMs);
    expect(conn.attach).not.toHaveBeenCalled();
  });

  it("an incompatible owner is detached without reads", async () => {
    const { client } = owner();
    const conn = { ...connection(client), compatible: vi.fn(() => false) };
    const h = host(conn);
    await h.emit("session_start");
    await advance(FEED_TIMING.firstMs);
    expect(conn.detach).toHaveBeenCalled();
    expect(client.activeRuns).not.toHaveBeenCalled();
    expect(h.published()).toEqual([]);
  });

  it("announces an active episode's children with purpose kinds, lifecycle activity and outcomes", async () => {
    const { s, client } = owner();
    s.rows = [
      row(null, null, "running"),
      row(C1, "inspect-api", "running"),
      row(C2, "write-fix", "queued", null, "dependency"),
    ];
    s.records[C1] = { tools: [tool("k1", "bash", "m1", false)] };
    const conn = connection(client);
    const h = host(conn);
    await h.emit("session_start");
    h.at(T0 + 500);
    await advance(FEED_TIMING.firstMs);
    expect(h.published(E.start)).toEqual([
      { id: C1, label: "inspect-api", kind: "Research", startedAt: T0 + 500 },
      { id: C2, label: "write-fix", kind: "Edit", startedAt: T0 + 500 },
    ]);
    expect(h.published(E.activity)).toEqual([
      { id: C1, activity: "inspect-api · Working" },
      { id: C2, activity: "write-fix · Queued · dependency" },
      { id: C1, activity: "inspect-api · Running bash" },
    ]);
    // The graph is read once per episode; tools only for the running child.
    await advance(FEED_TIMING.activeMs);
    expect(client.graph).toHaveBeenCalledTimes(2);
    expect(client.tools.mock.calls.map(([r]) => r.scope.id)).toEqual([C1]);

    // The episode drains: one more snapshot settles both children, then idle.
    s.roster = [];
    s.seq = "12";
    s.rows = [
      row(null, null, "settled", "failed"),
      row(C1, "inspect-api", "settled", "completed"),
      row(C2, "write-fix", "settled", "blocked", "dependency"),
    ];
    h.at(T0 + 9000);
    await advance(FEED_TIMING.activeMs);
    expect(h.published(E.end)).toEqual([
      { id: C1, status: "done", endedAt: T0 + 9000 },
      {
        id: C2,
        status: "error",
        endedAt: T0 + 9000,
        error: "write-fix · blocked (dependency)",
      },
    ]);
    const snapshots = client.snapshot.mock.calls.length;
    await advance(FEED_TIMING.idleMs * 2);
    expect(client.snapshot).toHaveBeenCalledTimes(snapshots);
    expect(client.activeRuns.mock.calls.length).toBeGreaterThan(3);
    expect(h.published(E.start)).toHaveLength(2);
  });

  it("a child first seen settled is announced untimed, and canceled maps to cancelled", async () => {
    const { s, client } = owner();
    s.rows = [
      row(null, null, "running"),
      row(C1, "inspect-api", "settled", "canceled"),
    ];
    const h = host(connection(client));
    await h.emit("session_start");
    await advance(FEED_TIMING.firstMs);
    expect(h.published()).toEqual([
      [
        E.start,
        { id: C1, label: "inspect-api", kind: "Research", startedAt: null },
      ],
      [E.activity, { id: C1, activity: "inspect-api · canceled" }],
      [E.end, { id: C1, status: "cancelled", endedAt: T0 }],
    ]);
  });

  it("loads only the viewed child's transcript, incrementally, replacing its streaming message before the end", async () => {
    const { s, client } = owner();
    s.rows = [row(null, null, "running"), row(C1, "inspect-api", "running")];
    s.records[C1] = {
      messages: [
        // A user prompt has no derived final text, only final blocks.
        msg("m1", "user", "final", null),
        msg("m2", "assistant", "final", ref("t2")),
        msg("m3", "tool-result", "final", null, "k1"),
        msg("m4", "assistant", "partial", null),
      ],
      tools: [tool("k1", "read", "m2")],
      contents: [
        content(
          { kind: "message", messageId: "m1", stage: "final", index: 0 },
          "p1",
        ),
        content(
          { kind: "tool", callId: "k1", stage: "arguments-final", index: 0 },
          "a1",
        ),
        content(
          {
            kind: "tool",
            callId: "k1",
            stage: "execution-arguments",
            index: 0,
          },
          "a1x",
        ),
        content(
          { kind: "tool", callId: "k1", stage: "result", index: 0 },
          "r1",
        ),
        content(
          { kind: "message", messageId: "m4", stage: "stream", index: 0 },
          "s4",
        ),
      ],
    };
    s.details = {
      p1: "Inspect the API",
      t2: "Reading the router",
      a1: '{"path":"src/api.ts"}',
      a1x: '{"path":"/work/project/src/api.ts"}',
      r1: "export const api = 1",
      s4: "Draft",
    };
    const h = host(connection(client));
    await h.emit("session_start");
    await advance(FEED_TIMING.firstMs);
    expect(client.messages).not.toHaveBeenCalled();
    expect(h.published(E.message)).toEqual([]);

    h.events.emit(SUBAGENT_VIEW, { id: C1 });
    await advance(0);
    expect(h.published(E.message)).toEqual([
      {
        id: C1,
        message: {
          role: "user",
          content: [{ type: "text", text: "Inspect the API" }],
        },
      },
      {
        id: C1,
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Reading the router" },
            {
              type: "toolCall",
              id: "k1",
              name: "read",
              arguments: { path: "/work/project/src/api.ts" },
            },
          ],
        },
      },
      {
        id: C1,
        message: {
          role: "toolResult",
          toolCallId: "k1",
          toolName: "read",
          content: [{ type: "text", text: "export const api = 1" }],
          isError: false,
        },
      },
      {
        id: C1,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Draft" }],
        },
        streaming: true,
      },
    ]);
    expect(h.published(E.activity).at(-1)).toEqual({
      id: C1,
      activity: "inspect-api · Working · 1 tool call (last: read)",
    });
    // An unchanged watermark is not reread.
    const reads = client.detail.mock.calls.length;
    await advance(FEED_TIMING.activeMs);
    expect(client.messages).toHaveBeenCalledTimes(1);

    // The draft becomes final as the child settles: only it is announced,
    // cached fields are not reread, and the end follows the final message.
    s.seq = "11";
    s.rows = [
      row(null, null, "running"),
      row(C1, "inspect-api", "settled", "completed"),
    ];
    s.records[C1].messages[3] = msg("m4", "assistant", "final", ref("t4"));
    s.details.t4 = "Done drafting";
    h.events.sent.length = 0;
    await advance(FEED_TIMING.activeMs);
    expect(h.published()).toEqual([
      [E.activity, { id: C1, activity: "inspect-api · completed" }],
      [
        E.message,
        {
          id: C1,
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Done drafting" }],
          },
        },
      ],
      [E.end, { id: C1, status: "done", endedAt: T0 }],
    ]);
    expect(client.detail.mock.calls.length - reads).toBe(1);
    expect(
      [client.messages, client.tools, client.contents].flatMap((fn) =>
        fn.mock.calls.map(([r]: any[]) => r.scope),
      ),
    ).toSatisfy((scopes: any[]) =>
      scopes.every((scope) => scope.kind === "child" && scope.id === C1),
    );
  });

  it("a session change or shutdown only detaches the observer", async () => {
    const { s, client } = owner();
    s.rows = [row(null, null, "running"), row(C1, "inspect-api", "running")];
    const conn = connection(client);
    const h = host(conn);
    await h.emit("session_start");
    await advance(FEED_TIMING.firstMs);
    await h.emit("session_shutdown");
    expect(conn.detach).toHaveBeenCalledTimes(1);
    const polls = client.activeRuns.mock.calls.length;
    await advance(FEED_TIMING.retryMs * 2);
    expect(client.activeRuns).toHaveBeenCalledTimes(polls);
    expect(h.published(E.end)).toEqual([]);
    // The fake has no command, preflight or cancel; nothing tried to call one.
    expect(Object.keys(client).sort()).toEqual([
      "activeRuns",
      "contents",
      "detail",
      "graph",
      "messages",
      "snapshot",
      "tools",
    ]);
  });

  it("a gone owner is detached and attached again on a later look", async () => {
    const { s, client } = owner();
    s.rows = [row(null, null, "running"), row(C1, "inspect-api", "running")];
    const conn = connection(client);
    const h = host(conn);
    await h.emit("session_start");
    await advance(FEED_TIMING.firstMs);
    client.activeRuns.mockResolvedValue(refused as never);
    conn.refresh.mockRejectedValue(new Error("stale"));
    await advance(FEED_TIMING.activeMs);
    expect(conn.detach).toHaveBeenCalledTimes(1);
    expect(conn.attach).toHaveBeenCalledTimes(1);
    await advance(FEED_TIMING.retryMs);
    expect(conn.attach).toHaveBeenCalledTimes(2);
    // The same child is never announced twice.
    expect(h.published(E.start)).toHaveLength(1);
  });
});

describe("Cadence owner feed bounds", () => {
  it("a drained check with no children is followed only until its own row settles", async () => {
    const { s, client } = owner();
    s.rows = [row(null, null, "running")];
    const h = host(connection(client));
    await h.emit("session_start");
    await advance(FEED_TIMING.firstMs);
    s.roster = [];
    s.rows = [row(null, null, "settled", "completed")];
    await advance(FEED_TIMING.activeMs);
    const snapshots = client.snapshot.mock.calls.length;
    await advance(FEED_TIMING.idleMs * 3);
    expect(client.snapshot).toHaveBeenCalledTimes(snapshots);
    expect(h.published()).toEqual([]);
  });

  it("a failed transcript read waits for a new watermark or a reopened view", async () => {
    const { s, client } = owner();
    s.rows = [row(null, null, "running"), row(C1, "inspect-api", "running")];
    const h = host(connection(client));
    await h.emit("session_start");
    await advance(FEED_TIMING.firstMs);
    client.messages.mockResolvedValue(refused as never);
    h.events.emit(SUBAGENT_VIEW, { id: C1 });
    await advance(0);
    await advance(FEED_TIMING.activeMs * 3);
    expect(client.messages).toHaveBeenCalledTimes(1);
    h.events.emit(SUBAGENT_VIEW, { id: null });
    h.events.emit(SUBAGENT_VIEW, { id: C1 });
    await advance(0);
    expect(client.messages).toHaveBeenCalledTimes(2);
    s.seq = "11";
    await advance(FEED_TIMING.activeMs);
    expect(client.messages).toHaveBeenCalledTimes(3);
  });
});

describe("shipped entrypoint", () => {
  it("publishes a running owner's children to the panel after startup, without a command or Start", async () => {
    const { default: register } = await import("../src/index.ts");
    const { s, client } = owner();
    s.rows = [row(null, null, "running"), row(C1, "inspect-api", "running")];
    s.records[C1] = { tools: [tool("k1", "bash", "m1", false)] };
    injected.attach = async () => client;
    const events = bus();
    const handlers = new Map<string, ((...args: any[]) => unknown)[]>();
    const pi = {
      events,
      on(name: string, fn: (...args: any[]) => unknown) {
        handlers.set(name, [...(handlers.get(name) ?? []), fn]);
      },
      registerCommand: vi.fn(),
    };
    register(pi as never);
    const widgets = new Map<string, any>();
    const ctx = {
      cwd: "/work/project",
      mode: "tui",
      hasUI: true,
      isProjectTrusted: () => false,
      ui: {
        onTerminalInput: () => () => {},
        getEditorText: () => "",
        notify: vi.fn(),
        setWidget: (key: string, factory: any) => widgets.set(key, factory),
      },
    };
    for (const fn of handlers.get("session_start") ?? []) await fn({}, ctx);
    expect(widgets.size).toBe(0);
    await advance(FEED_TIMING.firstMs);
    const feed = injected.instances.at(-1);
    expect(feed.attach).toHaveBeenCalledWith("/work/project");
    // The shell's own connection stays unattached outside `/cadence`.
    expect(injected.instances[0].attach).not.toHaveBeenCalled();
    const theme = {
      fg: (_r: string, t: string) => t,
      inverse: (t: string) => t,
    };
    const tui = {
      requestRender() {},
      terminal: { rows: 24 },
      hasOverlay: () => false,
    };
    const panel = widgets.get("cadence-agents")(tui, theme).render(60);
    expect(panel[0]).toBe("● main");
    expect(panel[1]).toMatch(/^⠋ Research {2}inspect-api · Running bash +0s$/);
    expect(panel.every((line: string) => visibleWidth(line) <= 60)).toBe(true);
    expect(
      widgets.get("cadence-agents-summary")(tui, theme).render(60)[1],
    ).toContain("inspect-api");
    for (const fn of handlers.get("session_shutdown") ?? []) await fn({}, ctx);
    expect(feed.detach).toHaveBeenCalled();
  });
});
