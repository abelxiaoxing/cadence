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

const STORE = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const T0 = 1_700_000_000_000;
const ok = (value: unknown) => ({ kind: "ok", value });
const refused = { kind: "error", error: { code: "unavailable" } };
function connection(client: unknown) {
  return {
    attach: vi.fn(async () => client),
    refresh: vi.fn(async () => ({})),
    compatible: vi.fn(() => true),
    detach: vi.fn(async () => {}),
    forgetSuperseded: vi.fn((_cwd: string) => false),
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
  const context = {
    cwd: "/work/project",
    mode: "tui",
    hasUI: true,
    sessionManager: { getSessionId: () => SESSION },
    ...ctx,
  };
  return {
    events,
    context,
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

const WF = "66666666-6666-4666-8666-666666666666",
  W1 = "77777777-7777-4777-8777-777777777777",
  W2 = "88888888-8888-4888-8888-888888888888";
const step = (
  id: string,
  kind: string,
  status: string,
  childRunId?: string,
) => ({
  id,
  ...(childRunId ? { childRunId } : {}),
  kind,
  status,
  text: "",
  exitCode: null,
  truncated: false,
});
const item = (
  id: string,
  role: string,
  text: string,
  name = "",
  args = "",
) => ({ id, role, text, name, args, error: false });
function workflowOwner() {
  const w = {
    live: [WF],
    links: [{ runId: WF, conversationId: SESSION }] as
      | { runId: string; conversationId: string }[]
      | undefined,
    run: {
      id: WF,
      execution: {
        version: { conversation: { id: SESSION, cwd: "/work/project" } },
      } as
        | { version: { conversation: { id: string; cwd: string } } }
        | undefined,
      epoch: STORE,
      goal: "goal",
      status: "running",
      phase: "implementing",
      steps: [
        step("inspect", "research", "completed", W1),
        step("impl-a", "implementation", "running", W2),
        step("outputs", "check", "running"),
      ],
      notice: "",
      mergedCommit: null,
      humanReviewed: false,
    },
    turns: {} as Record<string, object>,
  };
  const turn = (status: string, items: object[]) => ({
    id: W2,
    epoch: STORE,
    status,
    items,
    notice: "",
    omitted: { thinking: false, media: false, other: false },
  });
  const reader = vi.fn(async (r: any) => {
    if (r.kind === "workflow-active")
      return ok({
        kind: "workflow-active",
        links: w.links,
        runs: w.live.map((id) => ({ ...w.run, id, steps: [] })),
      });
    if (r.kind === "workflow")
      return ok({
        kind: "workflow",
        commandId: null,
        response: { type: "run", run: w.run },
      });
    if (r.kind === "workflow-transcript")
      return ok({
        kind: "workflow-transcript",
        runId: r.id,
        stepId: r.stepId,
        turn: w.turns[r.stepId] ?? null,
      });
    return refused;
  });
  return { client: { workbenchRead: reader }, w, turn };
}
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

  it("drops an attachment whose owner the registry proves replaced instead of awaiting its detach", async () => {
    const conn = {
      ...connection(undefined),
      attach: vi.fn(async () => {
        throw new Error("forbidden");
      }),
      forgetSuperseded: vi.fn((_cwd: string) => true),
    };
    const h = host(conn);
    await h.emit("session_start");
    await advance(FEED_TIMING.firstMs);
    expect(conn.forgetSuperseded).toHaveBeenCalledWith("/work/project");
    expect(conn.detach).not.toHaveBeenCalled();
  });

  it("stays off outside the TUI and with CADENCE_AGENT_PANEL=off", async () => {
    for (const ctx of [
      { mode: "rpc" },
      { hasUI: false },
      { sessionManager: { getSessionId: () => "" } },
    ]) {
      const conn = connection(workflowOwner().client);
      await host(conn, ctx).emit("session_start");
      await advance(FEED_TIMING.retryMs);
      expect(conn.attach).not.toHaveBeenCalled();
    }
    vi.stubEnv("CADENCE_AGENT_PANEL", "off");
    const conn = connection(workflowOwner().client);
    await host(conn).emit("session_start");
    await advance(FEED_TIMING.retryMs);
    expect(conn.attach).not.toHaveBeenCalled();
  });

  it("an incompatible owner is detached without reads", async () => {
    const { client } = workflowOwner();
    const conn = { ...connection(client), compatible: vi.fn(() => false) };
    const h = host(conn);
    await h.emit("session_start");
    await advance(FEED_TIMING.firstMs);
    expect(conn.detach).toHaveBeenCalled();
    expect(client.workbenchRead).not.toHaveBeenCalled();
    expect(h.published()).toEqual([]);
  });

  it("announces workflow subagents with kinds, activity, a viewed transcript and outcomes", async () => {
    const { client, w, turn } = workflowOwner();
    w.turns["impl-a"] = turn("running", [
      item("m1", "assistant", "Editing a.txt"),
      item("k1", "tool", "", "edit", '{"path":"a.txt"}'),
    ]);
    const h = host(connection(client));
    await h.emit("session_start");
    h.at(T0 + 500);
    await advance(FEED_TIMING.firstMs);
    expect(h.published(E.start)).toEqual([
      { id: W2, label: "impl-a", kind: "Implementation", startedAt: T0 + 500 },
    ]);
    expect(h.published(E.end)).toEqual([]);
    expect(h.published(E.activity)).toContainEqual({
      id: W2,
      activity: "impl-a · Running edit",
    });
    h.events.emit(SUBAGENT_VIEW, { id: W2 });
    await advance(0);
    expect(h.published(E.message)).toEqual([
      {
        id: W2,
        streaming: true,
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Editing a.txt" },
            {
              type: "toolCall",
              id: "k1",
              name: "edit",
              arguments: { path: "a.txt" },
            },
          ],
        },
      },
    ]);
    w.turns["impl-a"] = turn("completed", [
      item("m1", "assistant", "Editing a.txt"),
      item("k1", "tool", "ok", "edit", '{"path":"a.txt"}'),
      item("m2", "assistant", "Done"),
    ]);
    w.run = {
      ...w.run,
      status: "completed",
      phase: "finished",
      steps: [
        step("inspect", "research", "completed", W1),
        step("impl-a", "implementation", "completed", W2),
      ],
    };
    w.live = [];
    w.links = [];
    h.at(T0 + 9000);
    await advance(FEED_TIMING.activeMs);
    const messages = h.published(E.message) as any[];
    expect(messages.slice(1).map((m) => m.message.role)).toEqual([
      "assistant",
      "toolResult",
      "assistant",
    ]);
    expect(messages.at(-1).message.content).toEqual([
      { type: "text", text: "Done" },
    ]);
    expect(h.published(E.end)).toEqual([
      { id: W2, status: "done", endedAt: T0 + 9000 },
    ]);
    // A finished workflow is no longer read.
    const reads = client.workbenchRead.mock.calls.length;
    await advance(FEED_TIMING.idleMs);
    expect(
      client.workbenchRead.mock.calls
        .slice(reads)
        .every(([r]: any) => r.kind === "workflow-active"),
    ).toBe(true);
  });
  it.each([
    ["diagnosis", "Diagnosis"],
    ["knowledge", "Knowledge"],
  ])(
    "keeps adaptive %s agents scoped to their conversation",
    async (kind, label) => {
      const { client, w } = workflowOwner();
      w.run.steps = [step("adaptive", kind, "running", W2)];
      const own = host(connection(client));
      const other = host(connection(client), {
        sessionManager: { getSessionId: () => OTHER },
      });
      await own.emit("session_start");
      await other.emit("session_start");
      await advance(FEED_TIMING.firstMs);
      expect(own.published(E.start)).toEqual([
        { id: W2, label: "adaptive", kind: label, startedAt: T0 },
      ]);
      expect(other.published()).toEqual([]);
      w.run.steps[0].status = "completed";
      await advance(FEED_TIMING.activeMs);
      expect(own.published(E.end)).toEqual([
        { id: W2, status: "done", endedAt: T0 },
      ]);
      expect(other.published()).toEqual([]);
    },
  );

  it("announces review rejection without an agent error", async () => {
    const { client, w } = workflowOwner();
    w.run.steps = [step("review", "review", "running", W2)];
    const h = host(connection(client));
    await h.emit("session_start");
    await advance(FEED_TIMING.firstMs);
    w.run.steps = [step("review", "review", "rejected", W2)];
    await advance(FEED_TIMING.activeMs);
    expect(h.published(E.end)).toEqual([
      { id: W2, status: "rejected", endedAt: expect.any(Number) },
    ]);
    expect(h.published(E.activity)).toContainEqual({
      id: W2,
      activity: "review · rejected",
    });
  });

  it("a workflow that stays unreadable ends its subagents as not observed", async () => {
    const { client, w } = workflowOwner();
    const h = host(connection(client));
    await h.emit("session_start");
    await advance(FEED_TIMING.firstMs);
    w.live = [];
    w.links = [];
    client.workbenchRead.mockImplementation(async () => refused as never);
    for (let look = 0; look < 5; look++) await advance(FEED_TIMING.activeMs);
    expect(h.published(E.end)).toContainEqual(
      expect.objectContaining({ id: W2, status: "error" }),
    );
  });
  it("shutdown waits for the observer's detach, but never longer than its bound", async () => {
    const { client } = workflowOwner();
    const conn = connection(client);
    const h = host(conn);
    await h.emit("session_start");
    await advance(FEED_TIMING.firstMs);
    let detached = false;
    conn.detach.mockImplementation(
      () =>
        new Promise<void>((resolve) =>
          setImmediate(() => {
            detached = true;
            resolve();
          }),
        ),
    );
    // Pi exits right after this; an unsent detach would hold an owner slot.
    await h.emit("session_shutdown");
    expect(detached).toBe(true);
    const stuck = connection(client);
    const g = host(stuck);
    await g.emit("session_start");
    await advance(FEED_TIMING.firstMs);
    stuck.detach.mockReturnValue(new Promise<void>(() => {}));
    let settled = false;
    void g.emit("session_shutdown").then(() => {
      settled = true;
    });
    await advance(1499);
    expect(settled).toBe(false);
    await advance(1);
    expect(settled).toBe(true);
  });

  it("a shutdown during a roster read sends no session request after its detach", async () => {
    const { client } = workflowOwner();
    const conn = connection(client);
    const h = host(conn);
    await h.emit("session_start");
    await advance(FEED_TIMING.firstMs);
    let release!: (value: unknown) => void;
    client.workbenchRead.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }) as never,
    );
    await advance(FEED_TIMING.activeMs);
    await h.emit("session_shutdown");
    release(refused);
    await advance(0);
    expect(conn.refresh).not.toHaveBeenCalled();
  });
});

describe("shipped entrypoint", () => {
  it("publishes only this conversation's running children to the panel after startup, without a command or Start", {
    tags: ["slow"],
  }, async () => {
    // This is an external-Pi startup, not a child invocation of the entrypoint.
    vi.stubEnv("CADENCE_SUBAGENT_CHILD", undefined);
    const { default: register } = await import("../src/index.ts");
    const { client } = workflowOwner();
    injected.attach = async () => client;
    const events = bus();
    const handlers = new Map<string, ((...args: any[]) => unknown)[]>();
    const pi = {
      events,
      on(name: string, fn: (...args: any[]) => unknown) {
        handlers.set(name, [...(handlers.get(name) ?? []), fn]);
      },
      registerCommand: vi.fn(),
      registerTool: vi.fn(),
      registerEntryRenderer: vi.fn(),
      getActiveTools: () => [],
      setActiveTools() {},
    };
    register(pi as never);
    const widgets = new Map<string, any>();
    const ctx = {
      cwd: "/work/project",
      sessionManager: { getBranch: () => [], getSessionId: () => SESSION },
      mode: "tui",
      hasUI: true,
      isProjectTrusted: () => false,
      ui: {
        onTerminalInput: () => () => {},
        getEditorText: () => "",
        setStatus() {},
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
    const live = widgets.get("cadence-agents")(tui, theme).render(60);
    expect(live).toEqual(["⠋ 1 Implementation agent running (↓ to view)"]);
    expect(live.every((line: string) => visibleWidth(line) <= 60)).toBe(true);
    for (const fn of handlers.get("session_shutdown") ?? []) await fn({}, ctx);
    expect(feed.detach).toHaveBeenCalled();
  });
});

describe("conversation isolation and live-only observation", () => {
  it("isolates two Pi sessions in the same cwd before detail/transcript reads", async () => {
    const { client, w } = workflowOwner();
    w.links = [{ runId: WF, conversationId: OTHER }];
    const own = host(connection(client));
    const unrelated = host(connection(client), {
      sessionManager: { getSessionId: () => OTHER },
    });
    await own.emit("session_start");
    await advance(FEED_TIMING.firstMs);
    expect(own.published(E.start)).toEqual([
      { id: W2, label: "impl-a", kind: "Implementation", startedAt: T0 },
    ]);
    client.workbenchRead.mockClear();
    await unrelated.emit("session_start");
    await advance(FEED_TIMING.firstMs);
    expect(unrelated.published()).toEqual([]);
    expect(client.workbenchRead.mock.calls.map(([r]) => r.kind)).toEqual([
      "workflow-active",
    ]);
    await own.emit("session_shutdown");
    client.workbenchRead.mockClear();
    await advance(FEED_TIMING.idleMs);
    expect(client.workbenchRead.mock.calls.map(([r]) => r.kind)).toEqual([
      "workflow-active",
    ]);
  });
  it("does not broadcast runs without pinned attribution, even with a history link", async () => {
    const { client, w } = workflowOwner();
    const execution = w.run.execution;
    w.run.execution = undefined;
    const h = host(connection(client));
    await h.emit("session_start");
    await advance(FEED_TIMING.firstMs);
    expect(h.published()).toEqual([]);
    expect(client.workbenchRead.mock.calls.map(([r]) => r.kind)).toEqual([
      "workflow-active",
    ]);
    w.run.execution = execution;
    await advance(FEED_TIMING.idleMs);
    expect(h.published(E.start)).toHaveLength(1);
  });
  it("skips first-seen settled steps, including failures and cancellations", async () => {
    const { client, w } = workflowOwner();
    w.run.steps = [
      step("old-done", "research", "completed", W1),
      step("old-error", "review", "failed", W2),
      step("old-canceled", "implementation", "canceled", OTHER),
    ];
    const h = host(connection(client));
    await h.emit("session_start");
    await advance(FEED_TIMING.firstMs);
    expect(h.published()).toEqual([]);
    expect(
      client.workbenchRead.mock.calls.some(
        ([r]) => r.kind === "workflow-transcript",
      ),
    ).toBe(false);
  });
  it("never rereads ended children even if the workflow stays active or a view asks for them", async () => {
    const { client, w } = workflowOwner();
    const h = host(connection(client));
    await h.emit("session_start");
    await advance(FEED_TIMING.firstMs);
    client.workbenchRead.mockClear();
    w.run.steps[1].status = "completed";
    await advance(FEED_TIMING.activeMs);
    h.events.emit(SUBAGENT_VIEW, { id: W2 });
    await advance(FEED_TIMING.activeMs * 10);
    expect(h.published(E.start)).toHaveLength(1);
    expect(h.published(E.end)).toHaveLength(1);
    expect(
      client.workbenchRead.mock.calls.some(
        ([r]) => r.kind === "workflow-transcript",
      ),
    ).toBe(false);
  });
  it.each([
    ["canceled", "cancelled"],
    ["failed", "error"],
    ["partial", "partial"],
    ["blocked", "blocked"],
    ["running", "error"],
  ])(
    "preserves %s outcomes, not fabricated success",
    async (status, expected) => {
      const { client, w } = workflowOwner();
      const h = host(connection(client));
      await h.emit("session_start");
      await advance(FEED_TIMING.firstMs);
      w.run.status = "failed";
      w.run.steps[1].status = status;
      w.live = [];
      await advance(FEED_TIMING.activeMs);
      expect(h.published(E.end)).toEqual([
        expect.objectContaining({ id: W2, status: expected }),
      ]);
    },
  );
  it("throttles background activity and retries a failed viewed read only on reopening", async () => {
    const { client } = workflowOwner();
    const read = client.workbenchRead.getMockImplementation()!;
    const transcripts = () =>
      client.workbenchRead.mock.calls.filter(
        ([r]) => r.kind === "workflow-transcript",
      ).length;
    const h = host(connection(client));
    await h.emit("session_start");
    await advance(FEED_TIMING.firstMs);
    await advance(FEED_TIMING.activeMs * 3);
    expect(transcripts()).toBe(1);
    h.at(T0 + 10000);
    await advance(FEED_TIMING.activeMs);
    expect(transcripts()).toBe(2);
    client.workbenchRead.mockImplementation(async (r) =>
      r.kind === "workflow-transcript" ? (refused as never) : read(r),
    );
    h.events.emit(SUBAGENT_VIEW, { id: W2 });
    await advance(0);
    await advance(FEED_TIMING.activeMs * 3);
    expect(transcripts()).toBe(3);
    h.events.emit(SUBAGENT_VIEW, { id: null });
    h.events.emit(SUBAGENT_VIEW, { id: W2 });
    await advance(0);
    expect(transcripts()).toBe(4);
  });
  it("does not repeatedly fetch a failed final transcript", async () => {
    const { client, w } = workflowOwner();
    const read = client.workbenchRead.getMockImplementation()!;
    const h = host(connection(client));
    await h.emit("session_start");
    await advance(FEED_TIMING.firstMs);
    h.events.emit(SUBAGENT_VIEW, { id: W2 });
    await advance(0);
    w.run.steps[1].status = "completed";
    client.workbenchRead.mockImplementation(async (r) =>
      r.kind === "workflow-transcript" ? (refused as never) : read(r),
    );
    await advance(FEED_TIMING.activeMs);
    client.workbenchRead.mockClear();
    h.events.emit(SUBAGENT_VIEW, { id: W2 });
    await advance(FEED_TIMING.activeMs * 3);
    expect(
      client.workbenchRead.mock.calls.some(
        ([r]) => r.kind === "workflow-transcript",
      ),
    ).toBe(false);
  });
  it("reconnects without duplicate starts, then marks a lost outcome honestly", async () => {
    const { client } = workflowOwner();
    const read = client.workbenchRead.getMockImplementation()!;
    const conn = connection(client);
    const h = host(conn);
    await h.emit("session_start");
    await advance(FEED_TIMING.firstMs);
    client.workbenchRead.mockResolvedValue(refused as never);
    conn.refresh.mockRejectedValue(new Error("stale"));
    await advance(FEED_TIMING.activeMs);
    expect(h.published(E.end)).toEqual([]);
    client.workbenchRead.mockImplementation(read);
    await advance(FEED_TIMING.retryMs);
    expect(conn.attach).toHaveBeenCalledTimes(2);
    expect(h.published(E.start)).toHaveLength(1);
    client.workbenchRead.mockResolvedValue(refused as never);
    await advance(FEED_TIMING.activeMs);
    conn.attach.mockRejectedValue(new Error("gone"));
    await advance(FEED_TIMING.retryMs);
    expect(h.published(E.end)).toEqual([
      expect.objectContaining({
        status: "error",
        error: expect.stringContaining("owner unavailable"),
      }),
    ]);
  });
  it("switches without carrying agents, then resumes the original running work", async () => {
    const { client } = workflowOwner();
    const h = host(connection(client));
    await h.emit("session_start");
    await advance(FEED_TIMING.firstMs);
    await h.emit("session_shutdown");
    expect(h.published(E.end)).toEqual([]);
    h.context.sessionManager = { getSessionId: () => OTHER };
    h.events.sent.length = 0;
    await h.emit("session_start");
    await advance(FEED_TIMING.firstMs);
    expect(h.published()).toEqual([]);
    await h.emit("session_shutdown");
    h.context.sessionManager = { getSessionId: () => SESSION };
    await h.emit("session_start");
    await advance(FEED_TIMING.firstMs);
    expect(h.published(E.start)).toHaveLength(1);
    expect(Object.keys(client)).toEqual(["workbenchRead"]);
  });
  it.each(["workflow-active", "workflow", "workflow-transcript"])(
    "ignores a late %s read after switching",
    async (kind) => {
      const { client, w } = workflowOwner();
      const read = client.workbenchRead.getMockImplementation()!;
      let release!: (value: any) => void;
      client.workbenchRead.mockImplementation(async (r) =>
        r.kind === kind
          ? new Promise((resolve) => {
              release = resolve;
            })
          : read(r),
      );
      const conn = connection(client);
      const h = host(conn);
      await h.emit("session_start");
      await advance(FEED_TIMING.firstMs);
      await h.emit("session_shutdown");
      h.context.sessionManager = { getSessionId: () => OTHER };
      h.events.sent.length = 0;
      client.workbenchRead.mockImplementation(read);
      await h.emit("session_start");
      release(
        kind === "workflow-active"
          ? refused
          : kind === "workflow"
            ? ok({ kind, response: { type: "run", run: w.run } })
            : ok({ kind, runId: WF, stepId: "impl-a", turn: null }),
      );
      await advance(FEED_TIMING.firstMs);
      expect(h.published()).toEqual([]);
      expect(conn.refresh).not.toHaveBeenCalled();
    },
  );
  it("detaches an attachment that completes after departure", async () => {
    const { client } = workflowOwner();
    const conn = connection(client);
    let release!: (value: unknown) => void;
    conn.attach.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const h = host(conn);
    await h.emit("session_start");
    await advance(FEED_TIMING.firstMs);
    await h.emit("session_shutdown");
    release(client);
    await advance(0);
    expect(conn.detach).toHaveBeenCalledTimes(2);
    expect(client.workbenchRead).not.toHaveBeenCalled();
  });
});

it("keeps the observed outcome even if the final transcript request throws", async () => {
  const { client, w } = workflowOwner();
  const read = client.workbenchRead.getMockImplementation()!;
  const h = host(connection(client));
  await h.emit("session_start");
  await advance(FEED_TIMING.firstMs);
  h.events.emit(SUBAGENT_VIEW, { id: W2 });
  await advance(0);
  w.run.steps[1].status = "completed";
  client.workbenchRead.mockImplementation(async (r) => {
    if (r.kind === "workflow-transcript") throw new Error("connection lost");
    return read(r);
  });
  await advance(FEED_TIMING.activeMs);
  expect(h.published(E.end)).toEqual([{ id: W2, status: "done", endedAt: T0 }]);
  client.workbenchRead.mockClear();
  await advance(FEED_TIMING.retryMs);
  expect(
    client.workbenchRead.mock.calls.some(
      ([r]) => r.kind === "workflow-transcript",
    ),
  ).toBe(false);
});

it("caps viewed message fields and keeps invalid tool arguments inert", async () => {
  const { client, w, turn } = workflowOwner();
  w.turns["impl-a"] = turn("running", [
    item("u1", "user", "x".repeat(70 * 1024)),
    item("a1", "assistant", "Inspecting"),
    item("k1", "tool", "", "read", "not-json"),
  ]);
  const h = host(connection(client));
  await h.emit("session_start");
  await advance(FEED_TIMING.firstMs);
  h.events.emit(SUBAGENT_VIEW, { id: W2 });
  await advance(0);
  const messages = h.published(E.message) as any[];
  expect(messages[0].message.content[0].text).toMatch(
    /^x{65536}\n… \(truncated/,
  );
  expect(messages[1].message.content[1].arguments).toEqual({});
});

it("takes the final viewed snapshot even after an earlier transcript read failed", async () => {
  const { client, w, turn } = workflowOwner();
  const read = client.workbenchRead.getMockImplementation()!;
  const h = host(connection(client));
  await h.emit("session_start");
  await advance(FEED_TIMING.firstMs);
  client.workbenchRead.mockImplementation(async (r) =>
    r.kind === "workflow-transcript" ? (refused as never) : read(r),
  );
  h.events.emit(SUBAGENT_VIEW, { id: W2 });
  await advance(0);
  w.run.steps[1].status = "completed";
  w.turns["impl-a"] = turn("completed", [
    item("a1", "assistant", "Final result"),
  ]);
  client.workbenchRead.mockImplementation(read);
  client.workbenchRead.mockClear();
  await advance(FEED_TIMING.activeMs);
  expect(h.published(E.message)).toEqual([
    {
      id: W2,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Final result" }],
      },
    },
  ]);
  expect(h.published().at(-1)).toEqual([
    E.end,
    { id: W2, status: "done", endedAt: T0 },
  ]);
  await advance(FEED_TIMING.activeMs * 3);
  expect(
    client.workbenchRead.mock.calls.filter(
      ([r]) => r.kind === "workflow-transcript",
    ),
  ).toHaveLength(1);
});

it("does not readmit an abandoned run from the same live roster or repeat its agents", async () => {
  const { client } = workflowOwner();
  const read = client.workbenchRead.getMockImplementation()!;
  const h = host(connection(client));
  await h.emit("session_start");
  await advance(FEED_TIMING.firstMs);
  client.workbenchRead.mockImplementation(async (r) =>
    r.kind === "workflow" ? (refused as never) : read(r),
  );
  for (let look = 0; look < 5; look++) await advance(FEED_TIMING.activeMs);
  expect(h.published(E.end)).toHaveLength(1);
  client.workbenchRead.mockClear();
  await advance(FEED_TIMING.idleMs * 2);
  expect(client.workbenchRead.mock.calls.map(([r]) => r.kind)).toEqual([
    "workflow-active",
    "workflow-active",
  ]);
  // A transient failure must not turn the same agent into a second batch/card.
  client.workbenchRead.mockImplementation(read);
  await advance(FEED_TIMING.idleMs);
  expect(h.published(E.start)).toHaveLength(1);
  // Explicit reattachment to the same conversation can observe work anew.
  await h.emit("session_shutdown");
  await h.emit("session_start");
  await advance(FEED_TIMING.firstMs);
  expect(h.published(E.start)).toHaveLength(2);
});
