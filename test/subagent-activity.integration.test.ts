import {
  initTheme,
  ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import register, { DISPATCH_TOOL } from "../src/index";
import { Runtime } from "../src/runtime";
import { ACTIVITY_DETAILS_KEY } from "../src/subagent-activity";

const request = {
  stage: "abel-implement",
  kind: "open-task",
  boundary: {
    changeId: "subagent-activity-fixture",
    taskId: "integration-task",
    objective: "Inspect a bounded task",
    roots: ["."],
    context: { agents: "root", contract: "approved" },
    phases: {
      red: {
        read: ["test/subagent-activity.integration.test.ts"],
        write: [],
        verification: {
          id: "verify-subagent-activity-red",
          argv: [
            "bun",
            "run",
            "test:target",
            "test/subagent-activity.integration.test.ts",
          ],
          classification: "expected-red",
          expectedFailure: "[SUBAGENT-ACTIVITY:expected-red]",
          minTests: 1,
        },
      },
      green: {
        read: ["test/subagent-activity.integration.test.ts"],
        write: [],
        verification: {
          id: "verify-subagent-activity-green",
          argv: [
            "bun",
            "run",
            "test:target",
            "test/subagent-activity.integration.test.ts",
          ],
          classification: "expected-green",
          minTests: 1,
        },
      },
    },
    scheduling: { conflicts: [], resources: [] },
    agents: { impact: "none", managedOnly: true },
    approvedDependencies: [],
    impactClosure: {
      changedSurfaces: ["none"],
      searchEvidence: [],
      relatedTests: [],
      affectedSuite: [],
    },
  },
  attempt: {
    changeId: "subagent-activity-fixture",
    taskId: "integration-task",
    requestId: "integration-request",
    phase: "red",
    snapshot: {
      "test/subagent-activity.integration.test.ts": {
        kind: "file",
        sha256: "a".repeat(64),
        bytes: 1,
      },
    },
  },
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

const candidateOutcome = {
  kind: "candidate",
  requestId: request.attempt.requestId,
  taskId: request.attempt.taskId,
  phase: request.attempt.phase,
  resultId: "integration-candidate",
  result: {
    id: request.attempt.requestId,
    role: "implementation-worker",
    kind: "diff",
    taskId: request.attempt.taskId,
    phase: request.attempt.phase,
    summary: "changed one file",
    diff: "diff bytes stay outside presentation",
    expectedVerification: "target passes",
    risks: [],
    contractCompliant: true,
  },
} as const;

const completedOutcome = {
  kind: "completed",
  requestId: request.attempt.requestId,
  taskId: request.attempt.taskId,
  finalPhase: "green",
} as const;

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
    requestId: request.attempt.requestId,
    role: "implementation-worker",
    phase: request.attempt.phase,
    objective: request.boundary.objective,
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
  it("[SLICE-5:pi-tool-error] renders a candidate without next-step metadata", async () => {
    const ui = {
      setWidget: vi.fn(),
      setStatus: vi.fn(),
    };
    vi.spyOn(Runtime.prototype, "execute").mockImplementation(
      async (_action, _params, _ctx, _signal, observer) => {
        observer?.(event("queued"));
        observer?.(event("running"));
        observer?.(event("completed"));
        return candidateOutcome as never;
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
      requestId: request.attempt.requestId,
      summary: {
        kind: "diff",
        summary: "changed one file",
        riskCount: 0,
        retained: true,
      },
    });
    expect(result.details[ACTIVITY_DETAILS_KEY].summary).not.toHaveProperty(
      "nextStep",
    );
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
    const fg = vi.fn((_color: string, text: string) => text);
    const resultComponent = pi.tool.renderResult(
      result,
      { expanded: true, isPartial: false },
      { fg },
      {},
    );
    const rendered = resultComponent.render(120).join("\n");
    expect(rendered).toContain("changed one file");
    expect(rendered).not.toContain("next:");
    expect(rendered).not.toContain("diff bytes stay outside presentation");
    expect(fg.mock.calls[0]?.[0]).toBe("success");

    await pi.handlers.get("session_shutdown")?.({}, tuiContext(ui));
    expect(ui.setWidget).toHaveBeenLastCalledWith("abel-subagents", undefined);
  });

  it("[SLICE-5:pi-tool-error] preserves thrown errors and safe terminal presentation", async () => {
    const ui = { setWidget: vi.fn(), setStatus: vi.fn() };
    vi.spyOn(Runtime.prototype, "execute").mockImplementation(
      async (_action, _params, _ctx, _signal, observer) => {
        observer?.(event("queued"));
        observer?.(event("running"));
        observer?.({
          ...event("failed"),
          failureReason: "subagent failed",
        });
        throw new Error(
          "anthropic claude-sonnet-4 failed at /private/model.log",
        );
      },
    );
    const pi = new FakePi();
    register(pi as never);
    await pi.handlers.get("session_start")?.({}, tuiContext(ui));

    const updates: any[] = [];
    await expect(
      pi.tool.execute(
        "failed-call",
        { action: "run", request },
        undefined,
        (partial: unknown) => updates.push(partial),
        tuiContext(ui),
      ),
    ).rejects.toThrow("anthropic claude-sonnet-4 failed at /private/model.log");
    const display = updates.at(-1)?.details[ACTIVITY_DETAILS_KEY];

    expect(display).toMatchObject({
      state: "failed",
      reason: "subagent failed",
    });
    expect(JSON.stringify(display)).not.toMatch(
      /anthropic|claude|private|model\.log/i,
    );
  });

  it("[SLICE-5:pi-tool-error] keeps non-TUI domain outcomes structurally unchanged", async () => {
    const ui = { setWidget: vi.fn(), setStatus: vi.fn() };
    const execute = vi.spyOn(Runtime.prototype, "execute").mockResolvedValue({
      ...completedOutcome,
      usage: { totalTokens: 3 },
    } as never);
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
      { request: { id: "invalid" } },
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
      content: [{ type: "text", text: JSON.stringify(completedOutcome) }],
      details: completedOutcome,
      usage: { totalTokens: 3 },
    });
    expect(print.details).not.toHaveProperty("usage");
    expect(print).not.toHaveProperty("isError");
    expect(ui.setWidget).not.toHaveBeenCalled();
    expect(ui.setStatus).not.toHaveBeenCalled();
  });

  it("forwards exact Implement apply and discard operation payloads", async () => {
    const rejection = {
      kind: "artifact",
      code: "parent-review-rejected",
      evidence: ["bounded rejection"],
    } as const;
    const execute = vi
      .spyOn(Runtime.prototype, "execute")
      .mockResolvedValue(completedOutcome as never);
    const pi = new FakePi();
    register(pi as never);
    const ctx = { mode: "print" } as any;

    await pi.tool.execute(
      "apply-call",
      {
        action: "apply",
        resultId: "candidate-1",
        requestId: "apply-request",
      },
      undefined,
      vi.fn(),
      ctx,
    );
    await pi.tool.execute(
      "discard-call",
      {
        action: "discard",
        resultId: "candidate-2",
        requestId: "discard-request",
        rejection,
      },
      undefined,
      vi.fn(),
      ctx,
    );

    expect(execute).toHaveBeenNthCalledWith(
      1,
      "apply",
      { resultId: "candidate-1", requestId: "apply-request" },
      ctx,
      undefined,
    );
    expect(execute).toHaveBeenNthCalledWith(
      2,
      "discard",
      {
        resultId: "candidate-2",
        requestId: "discard-request",
        rejection,
      },
      ctx,
      undefined,
    );
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
    "[SLICE-5:pi-tool-error] keeps %s mode free of presentation effects",
    async (mode) => {
      const ui = { setWidget: vi.fn(), setStatus: vi.fn() };
      const onUpdate = vi.fn();
      vi.spyOn(Runtime.prototype, "execute").mockResolvedValue(
        completedOutcome as never,
      );
      const pi = new FakePi();
      register(pi as never);

      const result = await pi.tool.execute(
        `${mode}-call`,
        { action: "run", request },
        undefined,
        onUpdate,
        { mode, ui } as any,
      );

      expect(result.details).toEqual(completedOutcome);
      expect(result.details).not.toHaveProperty(ACTIVITY_DETAILS_KEY);
      expect(result.details).not.toHaveProperty("presentation");
      expect(result.details).not.toHaveProperty("tone");
      expect(result).not.toHaveProperty("isError");
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
    expect(drain).toHaveBeenCalledOnce();
    drain.mockClear();
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

  it("renders one Implement identity row through the real ToolExecutionComponent", async () => {
    initTheme("dark", false);
    const ui = { setWidget: vi.fn(), setStatus: vi.fn() };
    vi.spyOn(Runtime.prototype, "execute").mockImplementation(
      async (_action, _params, _ctx, _signal, observer) => {
        observer?.(event("queued"));
        observer?.(event("running"));
        observer?.(event("completed"));
        return candidateOutcome as never;
      },
    );
    const pi = new FakePi();
    register(pi as never);
    await pi.handlers.get("session_start")?.({}, tuiContext(ui));

    const component = new ToolExecutionComponent(
      DISPATCH_TOOL,
      "tool-call-live",
      { action: "run", request },
      {},
      pi.tool,
      { requestRender: vi.fn() } as never,
      process.cwd(),
    );
    component.markExecutionStarted();
    const updates: unknown[] = [];
    let running = "";
    const result = await pi.tool.execute(
      "tool-call-live",
      { action: "run", request },
      undefined,
      (partial: { content?: unknown; details?: unknown }) => {
        updates.push(partial);
        component.updateResult(
          {
            content: partial.content as never,
            details: partial.details,
            isError: false,
          },
          true,
        );
        const snapshot = stripAnsi(component.render(120).join("\n"));
        if (
          snapshot.includes(" running ") ||
          snapshot.includes(" · running ·")
        ) {
          running = snapshot;
        }
      },
      tuiContext(ui),
    );
    expect(running).toContain("implementation-worker");
    expect(running).toContain("#integration-request");
    expect(running).toContain("Inspect a bounded task");
    expect(running).not.toMatch(/unknown · #unknown · unknown · queued/);
    expect(running.match(/Subagent/g)).toHaveLength(1);
    expect(running).toMatch(/running/);

    component.updateResult(
      {
        content: result.content,
        details: result.details,
        isError: false,
      },
      false,
    );
    const completed = stripAnsi(component.render(120).join("\n"));
    expect(completed).toContain("completed");
    expect(completed).not.toMatch(/unknown · #unknown · unknown · queued/);
    expect(completed.match(/Subagent/g)).toHaveLength(1);
    expect(updates.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps thrown ToolExecutionComponent results sanitized", async () => {
    initTheme("dark", false);
    const ui = { setWidget: vi.fn(), setStatus: vi.fn() };
    vi.spyOn(Runtime.prototype, "execute").mockImplementation(
      async (_action, _params, _ctx, _signal, observer) => {
        observer?.(event("queued"));
        observer?.(event("running"));
        observer?.({ ...event("failed"), failureReason: "subagent failed" });
        throw new Error(
          "anthropic claude-sonnet-4 failed at /private/model.log",
        );
      },
    );
    const pi = new FakePi();
    register(pi as never);
    await pi.handlers.get("session_start")?.({}, tuiContext(ui));

    const component = new ToolExecutionComponent(
      DISPATCH_TOOL,
      "failed-live",
      { action: "run", request },
      {},
      pi.tool,
      { requestRender: vi.fn() } as never,
      process.cwd(),
    );
    component.markExecutionStarted();
    await expect(
      pi.tool.execute(
        "failed-live",
        { action: "run", request },
        undefined,
        (partial: { content?: unknown; details?: unknown }) => {
          component.updateResult(
            {
              content: partial.content as never,
              details: partial.details,
              isError: false,
            },
            true,
          );
        },
        tuiContext(ui),
      ),
    ).rejects.toThrow("anthropic claude-sonnet-4 failed at /private/model.log");
    component.updateResult(
      {
        content: [
          {
            type: "text",
            text: "anthropic claude-sonnet-4 failed at /private/model.log",
          },
        ],
        isError: true,
      },
      false,
    );
    const rendered = stripAnsi(component.render(120).join("\n"));
    expect(rendered).toMatch(/failed|subagent failed/);
    expect(rendered).not.toMatch(
      /anthropic|claude-sonnet-4|\/private\/model\.log/i,
    );
  });

  it("renders non-run Tool errors as one sanitized Dispatch row", () => {
    initTheme("dark", false);
    const pi = new FakePi();
    register(pi as never);
    const component = new ToolExecutionComponent(
      DISPATCH_TOOL,
      "failed-apply",
      { action: "apply", resultId: "missing-result" },
      {},
      pi.tool,
      { requestRender: vi.fn() } as never,
      process.cwd(),
    );
    component.markExecutionStarted();
    component.updateResult(
      {
        content: [
          {
            type: "text",
            text: "anthropic failed at /private/apply.log",
          },
        ],
        isError: true,
      },
      false,
    );

    const rendered = stripAnsi(component.render(120).join("\n"));
    expect(rendered).toContain("Abel Dispatch apply failed");
    expect(rendered.match(/Abel Dispatch/g)).toHaveLength(1);
    expect(rendered).not.toMatch(/Subagent|unknown|anthropic|\/private/i);
  });
});

function stripAnsi(value: string): string {
  return value.replace(
    new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"),
    "",
  );
}
