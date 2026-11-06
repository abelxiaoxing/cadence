import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { registerActivity } from "../src/activity.ts";
import { ACTIVITY_RENEW_MS } from "../src/service/activity-files.ts";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("CADENCE_SUBAGENT_CHILD", "");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
function fixture(mode = "tui") {
  const handlers = new Map<string, any>();
  const pi = {
    on: (event: string, handler: any) => handlers.set(event, handler),
  };
  const reports: any[] = [];
  const store = {
    scope: "f".repeat(64),
    publish: vi.fn((record) => {
      reports.push(structuredClone(record));
      return { identity: "saved" };
    }),
    withdraw: vi.fn(),
    retireDead: vi.fn(),
  };
  const create = vi.fn(() => store);
  const sessionId = randomUUID();
  const ctx = {
    mode,
    hasUI: mode === "tui",
    cwd: "/project",
    sessionManager: {
      getSessionId: () => sessionId,
      getSessionDir: () => "/pi/sessions/project",
      getLeafId: () => "abcdef12",
    },
  };
  registerActivity(pi as any, {
    store: create as any,
    canonical: (cwd) => cwd,
  });
  const emit = (event: string, context = ctx) =>
    handlers.get(event)?.({}, context);
  return { emit, store, reports, create, ctx, handlers };
}
it("idle startup, mode entry and tree navigation create no files or renewal timers; panel-off does not disable real reports", () => {
  vi.stubEnv("CADENCE_AGENT_PANEL", "off");
  const f = fixture();
  for (const e of ["session_start", "session_tree", "before_agent_start"])
    f.emit(e);
  vi.advanceTimersByTime(60000);
  expect(f.create).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  f.emit("agent_start");
  vi.advanceTimersByTime(0);
  expect(f.reports).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(1);
});
it("reports first real work before any JSONL exists, with no content or file path, until fully settled", () => {
  const f = fixture();
  f.emit("agent_start");
  vi.advanceTimersByTime(0);
  expect(f.reports[0]).toMatchObject({
    cwd: "/project",
    sessionId: f.ctx.sessionManager.getSessionId(),
    leaf: "abcdef12",
  });
  expect(f.reports[0].instance).not.toBe(f.reports[0].activity);
  expect(f.reports[0]).not.toHaveProperty("prompt");
  expect(f.reports[0]).not.toHaveProperty("sessionFile");
  f.emit("agent_settled");
  expect(f.store.withdraw).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(ACTIVITY_RENEW_MS * 3);
  expect(f.reports).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});
it("agent_end, retry, compaction and queued continuation retain one activity until agent_settled", () => {
  const f = fixture();
  f.emit("agent_start");
  vi.advanceTimersByTime(0);
  for (const event of [
    "agent_end",
    "session_compact",
    "agent_start",
    "agent_end",
    "agent_start",
  ])
    f.emit(event);
  vi.advanceTimersByTime(ACTIVITY_RENEW_MS);
  expect(new Set(f.reports.map((r) => r.activity)).size).toBe(1);
  expect(f.store.withdraw).not.toHaveBeenCalled();
  f.emit("agent_settled");
  expect(vi.getTimerCount()).toBe(0);
});
it.each(["new", "resume", "fork", "reload", "quit"])(
  "%s departure fences pending publication and old callbacks",
  (reason) => {
    const f = fixture();
    f.emit("agent_start");
    f.handlers.get("session_shutdown")({ reason }, f.ctx);
    f.emit("agent_start");
    vi.advanceTimersByTime(60000);
    expect(f.reports).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  },
);
it("same session in two terminal instances and same cwd in a fork never overwrite each other", () => {
  const a = fixture(),
    b = fixture();
  b.ctx.sessionManager.getSessionId = a.ctx.sessionManager.getSessionId;
  a.emit("agent_start");
  b.emit("agent_start");
  vi.advanceTimersByTime(0);
  expect(a.reports[0].instance).not.toBe(b.reports[0].instance);
  const c = fixture();
  c.emit("agent_start");
  vi.advanceTimersByTime(0);
  a.emit("agent_settled", c.ctx);
  expect(a.store.withdraw).not.toHaveBeenCalled();
  a.emit("agent_settled");
  expect(b.store.withdraw).not.toHaveBeenCalled();
});
it.each(["rpc", "print", "json"])(
  "%s is not an interactive terminal publisher",
  (mode) => {
    const f = fixture(mode);
    f.emit("agent_start");
    vi.advanceTimersByTime(0);
    expect(f.create).not.toHaveBeenCalled();
  },
);
it("Cadence SDK/subagent children do not register publishers", () => {
  vi.stubEnv("CADENCE_SUBAGENT_CHILD", "1");
  expect(fixture().handlers.size).toBe(0);
});
it("publication/withdraw failures never escape or schedule an idle retry", () => {
  const f = fixture();
  f.store.publish.mockImplementationOnce(() => {
    throw new Error("disk full");
  });
  expect(() => {
    f.emit("agent_start");
    vi.advanceTimersByTime(0);
    f.emit("agent_settled");
  }).not.toThrow();
  expect(vi.getTimerCount()).toBe(0);
  f.emit("agent_start");
  vi.advanceTimersByTime(0);
  f.store.withdraw.mockImplementationOnce(() => {
    throw new Error("unsafe replacement");
  });
  expect(() => f.emit("agent_settled")).not.toThrow();
  expect(vi.getTimerCount()).toBe(0);
});
it("late async cwd resolution cannot publish after settlement or move into a resumed context", async () => {
  const handlers = new Map<string, any>();
  let resolve!: (cwd: string) => void;
  const publish = vi.fn();
  registerActivity(
    {
      on: (event: string, handler: any) => handlers.set(event, handler),
    } as any,
    {
      store: () => ({
        scope: "f".repeat(64),
        publish,
        withdraw: vi.fn(),
        retireDead: vi.fn(),
      }),
      canonical: () =>
        new Promise((r) => {
          resolve = r;
        }),
    },
  );
  const f = fixture();
  handlers.get("agent_start")({}, f.ctx);
  await vi.advanceTimersByTimeAsync(0);
  handlers.get("agent_settled")({}, f.ctx);
  resolve("/project");
  await vi.advanceTimersByTimeAsync(0);
  expect(publish).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it("R5: an invalidated settled context cannot fail Pi or renew an idle report", () => {
  const f = fixture();
  f.emit("agent_start");
  vi.advanceTimersByTime(0);
  f.ctx.sessionManager.getSessionId = () => {
    throw new Error("old runtime");
  };
  expect(() => f.emit("agent_settled")).not.toThrow();
  vi.advanceTimersByTime(60000);
  expect(f.reports).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});
