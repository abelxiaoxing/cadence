import { afterEach, describe, expect, it, vi } from "vitest";
import register, { DISPATCH_TOOL } from "../src/index";
import { Runtime } from "../src/runtime";
import { ACTIVITY_DETAILS_KEY } from "../src/subagent-activity";

const request = {
  stage: "abel-implement",
  role: "implementation-worker",
  id: "integration-request",
  phase: "green",
  objective: "Inspect a bounded task",
  roots: ["."],
  context: { agents: "root", contract: "approved" },
  declared: {
    read: ["src"],
    write: [],
    conflicts: [],
    resources: [],
  },
  output: "evidence",
};

const evidence = {
  id: "integration-request",
  role: "implementation-worker",
  kind: "evidence",
  conclusions: ["one conclusion"],
  citations: [{ path: "private.txt", lines: "1" }],
  constraints: [],
  dependencies: [],
  risks: [],
  blockingQuestions: [],
  hints: { writeSet: [], verification: "none", agentsImpact: "none" },
};

function event(
  state:
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "cancelled"
    | "timed-out",
) {
  return {
    state,
    requestId: request.id,
    role: request.role,
    phase: request.phase,
    objective: request.objective,
    sequence: 1,
  } as const;
}

class FakePi {
  tool?: any;
  handlers = new Map<string, (...args: any[]) => unknown>();
  active = [DISPATCH_TOOL];

  registerTool(tool: any) {
    this.tool = tool;
  }

  on(name: string, handler: (...args: any[]) => unknown) {
    this.handlers.set(name, handler);
  }

  getActiveTools() {
    return [...this.active];
  }

  setActiveTools(names: string[]) {
    this.active = [...names];
  }
}

function tuiContext(ui: any) {
  return { mode: "tui", ui } as any;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Subagent activity extension integration", () => {
  it("wires TUI lifecycle, inline renderers, terminal details, and cleanup", async () => {
    const ui = {
      setWidget: vi.fn(),
      setStatus: vi.fn(),
    };
    vi.spyOn(Runtime.prototype, "execute").mockImplementation(
      async (_action, _params, _ctx, _signal, observer) => {
        observer?.(event("queued"));
        observer?.(event("running"));
        observer?.(event("completed"));
        return { ok: true, action: "run", result: evidence };
      },
    );
    const pi = new FakePi();
    register(pi as never);
    await pi.handlers.get("session_start")?.({}, tuiContext(ui));

    const updates: unknown[] = [];
    const result = await pi.tool.execute(
      "tool-call-1",
      { action: "run", request },
      undefined,
      (partial: unknown) => updates.push(partial),
      tuiContext(ui),
    );

    expect(result.details[ACTIVITY_DETAILS_KEY]).toMatchObject({
      kind: "activityDisplay",
      state: "completed",
      requestId: request.id,
    });
    expect(updates.length).toBeGreaterThanOrEqual(3);
    expect(ui.setWidget).toHaveBeenCalledWith(
      "abel-subagents",
      expect.any(Function),
      { placement: "aboveEditor" },
    );
    expect(ui.setStatus).toHaveBeenCalledWith("abel-subagents", undefined);

    const callComponent = pi.tool.renderCall(
      { action: "run", request },
      { fg: (_color: string, text: string) => text },
      {},
    );
    expect(callComponent.render(120).join("\n")).toContain("Subagent");
    const resultComponent = pi.tool.renderResult(
      result,
      { expanded: true, isPartial: false },
      { fg: (_color: string, text: string) => text },
      {},
    );
    const rendered = resultComponent.render(120).join("\n");
    expect(rendered).toContain("1 conclusions");
    expect(rendered).not.toContain("private.txt");

    await pi.handlers.get("session_shutdown")?.({}, tuiContext(ui));
    expect(ui.setWidget).toHaveBeenLastCalledWith("abel-subagents", undefined);
  });

  it("persists only typed safe terminal failure metadata", async () => {
    const ui = { setWidget: vi.fn(), setStatus: vi.fn() };
    vi.spyOn(Runtime.prototype, "execute").mockImplementation(
      async (_action, _params, _ctx, _signal, observer) => {
        observer?.(event("queued"));
        observer?.(event("running"));
        observer?.({
          ...event("failed"),
          failureReason: "subagent failed",
        });
        return {
          ok: false,
          error: "anthropic claude-sonnet-4 failed at /private/model.log",
        };
      },
    );
    const pi = new FakePi();
    register(pi as never);
    await pi.handlers.get("session_start")?.({}, tuiContext(ui));

    const result = await pi.tool.execute(
      "failed-call",
      { action: "run", request },
      undefined,
      vi.fn(),
      tuiContext(ui),
    );
    const display = result.details[ACTIVITY_DETAILS_KEY];

    expect(display).toMatchObject({
      state: "failed",
      reason: "subagent failed",
    });
    expect(JSON.stringify(display)).not.toMatch(
      /anthropic|claude|private|model\.log/i,
    );
  });

  it("keeps invalid and non-TUI requests structurally unchanged", async () => {
    const ui = { setWidget: vi.fn(), setStatus: vi.fn() };
    const execute = vi.spyOn(Runtime.prototype, "execute").mockResolvedValue({
      ok: true,
      action: "run",
      result: evidence,
      usage: { totalTokens: 3 },
    });
    const pi = new FakePi();
    register(pi as never);

    const invalid = await pi.tool.execute(
      "invalid-call",
      { action: "run", request: { id: "invalid" } },
      undefined,
      vi.fn(),
      tuiContext(ui),
    );
    expect(invalid.details).not.toHaveProperty(ACTIVITY_DETAILS_KEY);
    expect(execute).toHaveBeenLastCalledWith(
      "run",
      { action: "run", request: { id: "invalid" } },
      expect.anything(),
      undefined,
    );

    const print = await pi.tool.execute(
      "print-call",
      { action: "run", request },
      undefined,
      vi.fn(),
      { mode: "print" } as any,
    );
    expect(print).toEqual({
      content: [{ type: "text", text: JSON.stringify({ ...print.details }) }],
      details: expect.not.objectContaining({
        [ACTIVITY_DETAILS_KEY]: expect.anything(),
      }),
      usage: { totalTokens: 3 },
    });
    expect(ui.setWidget).not.toHaveBeenCalled();
    expect(ui.setStatus).not.toHaveBeenCalled();
  });

  it("keeps equal logical request ids in separate tool rows", async () => {
    const ui = { setWidget: vi.fn(), setStatus: vi.fn() };
    const releases: Array<() => void> = [];
    let sequence = 0;
    vi.spyOn(Runtime.prototype, "execute").mockImplementation(
      async (_action, _params, _ctx, _signal, observer) => {
        const current = ++sequence;
        observer?.({ ...event("queued"), sequence: current });
        observer?.({ ...event("running"), sequence: current });
        await new Promise<void>((resolve) => releases.push(resolve));
        observer?.({ ...event("completed"), sequence: current });
        return { ok: true, action: "run", result: evidence };
      },
    );
    const pi = new FakePi();
    register(pi as never);
    await pi.handlers.get("session_start")?.({}, tuiContext(ui));

    const left = pi.tool.execute(
      "tool-call-left",
      { action: "run", request },
      undefined,
      vi.fn(),
      tuiContext(ui),
    );
    const right = pi.tool.execute(
      "tool-call-right",
      { action: "run", request },
      undefined,
      vi.fn(),
      tuiContext(ui),
    );
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    const factory = ui.setWidget.mock.calls.find(
      (call) => typeof call[1] === "function",
    )?.[1];
    const component = factory(
      { requestRender: vi.fn() },
      { fg: (_color: string, text: string) => text },
    );
    const active = component.render(120).join("\n");
    expect(active.match(/#integration-request/g)).toHaveLength(2);

    releases[0]?.();
    await left;
    expect(
      component
        .render(120)
        .join("\n")
        .match(/#integration-request/g),
    ).toHaveLength(1);
    releases[1]?.();
    await right;
  });

  it.each(["print", "json", "rpc"])(
    "keeps %s mode free of presentation effects",
    async (mode) => {
      const ui = { setWidget: vi.fn(), setStatus: vi.fn() };
      const onUpdate = vi.fn();
      vi.spyOn(Runtime.prototype, "execute").mockResolvedValue({
        ok: true,
        action: "run",
        result: evidence,
      });
      const pi = new FakePi();
      register(pi as never);

      const result = await pi.tool.execute(
        `${mode}-call`,
        { action: "run", request },
        undefined,
        onUpdate,
        { mode, ui } as any,
      );

      expect(result.details).not.toHaveProperty(ACTIVITY_DETAILS_KEY);
      expect(onUpdate).not.toHaveBeenCalled();
      expect(ui.setWidget).not.toHaveBeenCalled();
      expect(ui.setStatus).not.toHaveBeenCalled();
    },
  );

  it("clears visible activity before shutdown drain settles", async () => {
    const ui = { setWidget: vi.fn(), setStatus: vi.fn() };
    let release: (() => void) | undefined;
    vi.spyOn(Runtime.prototype, "execute").mockImplementation(
      async (_action, _params, _ctx, _signal, observer) => {
        observer?.(event("queued"));
        observer?.(event("running"));
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        observer?.({ ...event("completed") });
        return { ok: true, action: "run", result: evidence };
      },
    );
    const drain = vi
      .spyOn(Runtime.prototype, "drain")
      .mockImplementation(
        () => new Promise<void>((resolve) => setTimeout(resolve, 20)),
      );
    const pi = new FakePi();
    register(pi as never);
    await pi.handlers.get("session_start")?.({}, tuiContext(ui));
    const run = pi.tool.execute(
      "active-call",
      { action: "run", request },
      undefined,
      vi.fn(),
      tuiContext(ui),
    );
    await vi.waitFor(() =>
      expect(ui.setWidget).toHaveBeenCalledWith(
        "abel-subagents",
        expect.any(Function),
        { placement: "aboveEditor" },
      ),
    );

    const shutdown = pi.handlers.get("session_shutdown")?.({}, tuiContext(ui));
    expect(ui.setWidget).toHaveBeenLastCalledWith("abel-subagents", undefined);
    expect(drain).toHaveBeenCalledOnce();
    release?.();
    await Promise.all([run, shutdown]);
  });
});
