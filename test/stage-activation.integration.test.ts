import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DesignFinalizationError } from "../src/design-control.ts";
import {
  DISPATCH_TOOL,
  registerWorkflowControl,
  type WorkflowControlEngine,
} from "../src/index.ts";
import { OpenSpecCliError } from "../src/openspec-cli.ts";

const packageDir = path.resolve(import.meta.dirname, "..");

function harness(
  prompt: "abel-design" | "abel-implement" | "abel-diagnose",
  engine:
    | WorkflowControlEngine
    | (() => WorkflowControlEngine | Promise<WorkflowControlEngine>),
  initialActive: string[] = ["read", "bash"],
) {
  let tool: any;
  let active = [...initialActive];
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const pi = {
    registerTool(definition: unknown) {
      tool = definition;
    },
    on(name: string, handler: (...args: any[]) => unknown) {
      handlers.set(name, handler);
    },
    getCommands: () =>
      (["abel-design", "abel-implement", "abel-diagnose"] as const).map(
        (name) => ({
          name,
          source: "prompt",
          sourceInfo: {
            origin: "package",
            baseDir: packageDir,
            path: path.join(packageDir, "prompts", `${name}.md`),
          },
        }),
      ),
    getActiveTools: () => [...active],
    setActiveTools(next: string[]) {
      active = [...next];
    },
  };
  registerWorkflowControl(pi as never, async () =>
    typeof engine === "function" ? engine() : engine,
  );
  const invoke = (name: typeof prompt) => {
    const input = handlers.get("input")?.({
      source: "interactive",
      text: `/${name} verified`,
    });
    const before = () =>
      handlers.get("before_agent_start")?.(
        {
          prompt: `<abel-request>verified</abel-request> <!-- ABEL:PROMPT:${name} -->`,
        },
        { model: undefined, modelRegistry: {} },
      );
    if (input instanceof Promise) return input.then(before);
    return before();
  };
  invoke(prompt);
  const context = {
    cwd: process.cwd(),
    mode: "print",
    model: undefined,
    modelRegistry: {},
  };
  return {
    tool,
    context,
    active: () => [...active],
    handlers,
    invoke,
  };
}

function baseEngine(
  execute: WorkflowControlEngine["execute"] = async () => ({
    state: "paused",
    completed: false,
  }),
): WorkflowControlEngine {
  return { execute, async close() {} };
}

async function capturedDesignFailure(
  item: ReturnType<typeof harness>,
  toolCallId: string,
  input: Record<string, unknown>,
  code: string,
) {
  await expect(
    item.tool.execute(toolCallId, input, undefined, undefined, item.context),
  ).rejects.toMatchObject({ name: "DesignControlError", message: code });
  return item.handlers.get("tool_result")?.({
    type: "tool_result",
    toolName: DISPATCH_TOOL,
    toolCallId,
    input,
    content: [{ type: "text", text: code }],
    details: undefined,
    isError: true,
  });
}

describe("semantic stage activation teardown", () => {
  it("waits for safe engine exit before restoring tools and rejects concurrent or stale dispatch", async () => {
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const close = vi.fn(() => settled);
    const executeDesign = vi.fn(async () => ({ state: "active" }));
    const item = harness("abel-design", {
      ...baseEngine(),
      executeDesign,
      close,
    });
    await item.tool.execute(
      "open",
      {
        action: "design",
        request: {
          operation: "start",
          requirement: "example",
          operationId: "open",
        },
      },
      undefined,
      undefined,
      item.context,
    );
    const finished = item.tool.execute(
      "exit",
      { action: "finish" },
      undefined,
      undefined,
      item.context,
    );
    expect(item.active()).toEqual(["read", DISPATCH_TOOL]);
    await expect(
      item.tool.execute(
        "during-exit",
        {
          action: "design",
          request: {
            operation: "start",
            requirement: "example",
            operationId: "other",
          },
        },
        undefined,
        undefined,
        item.context,
      ),
    ).rejects.toThrow("stage-control-mismatch");
    settle();
    await finished;
    expect(close).toHaveBeenCalledOnce();
    expect(executeDesign).toHaveBeenCalledOnce();
    expect(item.active()).toEqual(["read", "bash"]);
    await expect(
      item.tool.execute(
        "stale",
        { command: "status", stage: "abel-implement", change: "example" },
        undefined,
        undefined,
        item.context,
      ),
    ).rejects.toThrow("stage-control-mismatch");
  });

  it("preserves a paused Implement run on exit without sending cancel or discard", async () => {
    const execute = vi.fn(async () => ({ state: "paused", completed: false }));
    const close = vi.fn(async () => {});
    const item = harness("abel-implement", { execute, close });
    await item.tool.execute(
      "status",
      { command: "status", stage: "abel-implement", change: "retained" },
      undefined,
      undefined,
      item.context,
    );
    await expect(
      item.tool.execute(
        "bad-finish",
        {
          action: "finish",
          command: "discard",
          stage: "abel-implement",
          change: "retained",
        },
        undefined,
        undefined,
        item.context,
      ),
    ).rejects.toThrow("control-envelope-ambiguous");
    await item.tool.execute(
      "finish",
      { action: "finish" },
      undefined,
      undefined,
      item.context,
    );
    expect(close).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
    expect(item.active()).toEqual(["read", "bash"]);
  });

  it("keeps Design restricted when engine settlement fails and allows exit retry", async () => {
    const close = vi
      .fn()
      .mockRejectedValueOnce(new Error("settlement-failed"))
      .mockResolvedValueOnce(undefined);
    const item = harness("abel-design", {
      ...baseEngine(),
      executeDesign: async () => ({ state: "active" }),
      close,
    });
    await item.tool.execute(
      "open",
      {
        action: "design",
        request: {
          operation: "start",
          requirement: "example",
          operationId: "open",
        },
      },
      undefined,
      undefined,
      item.context,
    );
    await expect(
      item.tool.execute(
        "exit",
        { action: "finish" },
        undefined,
        undefined,
        item.context,
      ),
    ).rejects.toThrow("settlement-failed");
    expect(item.active()).toEqual(["read", DISPATCH_TOOL]);
    await item.tool.execute(
      "retry-exit",
      { action: "finish" },
      undefined,
      undefined,
      item.context,
    );
    expect(close).toHaveBeenCalledTimes(2);
    expect(item.active()).toEqual(["read", "bash"]);
  });

  it("reports a result serialization failure and keeps Design tools restricted", async () => {
    let attempts = 0;
    const engine: WorkflowControlEngine = {
      ...baseEngine(),
      executeDesign: vi.fn(async () => {
        attempts += 1;
        return attempts === 1
          ? ({ runId: "durable-run", state: "paused", invalid: 1n } as any)
          : { runId: "durable-run", state: "paused" };
      }),
    };
    const item = harness("abel-design", engine);
    const input = {
      action: "design",
      request: {
        operation: "start",
        operationId: "serialization-start",
        requirement: "safe requirement",
      },
    };
    const patch = await capturedDesignFailure(
      item,
      "serialization-call",
      input,
      "design-receipt-serialization-failed",
    );
    expect(patch).toMatchObject({
      details: {
        designFailure: {
          code: "design-receipt-serialization-failed",
          diagnostics: [
            {
              code: "design-receipt-serialization-failed",
              category: "control",
              retryable: false,
            },
          ],
        },
      },
    });
    await expect(
      item.tool.execute(
        "serialization-retry",
        input,
        undefined,
        undefined,
        item.context,
      ),
    ).resolves.toMatchObject({ details: { runId: "durable-run" } });
    expect(item.active()).toEqual(["read", DISPATCH_TOOL]);
  });

  it("classifies SQLite contention as a retryable Design store lock", async () => {
    const locked = Object.assign(new Error("database is locked"), {
      code: "ERR_SQLITE_ERROR",
      errcode: 5,
      errstr: "database is locked",
    });
    const engine: WorkflowControlEngine = {
      ...baseEngine(),
      executeDesign: vi.fn(async () => {
        throw locked;
      }),
    };
    const item = harness("abel-design", engine);
    const input = {
      action: "design",
      request: {
        operation: "start",
        operationId: "locked-start",
        requirement: "safe requirement",
      },
    };
    const patch = await capturedDesignFailure(
      item,
      "locked-call",
      input,
      "design-store-locked",
    );
    expect(patch).toMatchObject({
      details: {
        designFailure: {
          code: "design-store-locked",
          diagnostics: [
            {
              code: "design-store-locked",
              category: "storage",
              retryable: true,
            },
          ],
        },
      },
    });
    expect(item.active()).toEqual(["read", DISPATCH_TOOL]);
  });

  it("publishes safe structured finalization diagnostics while preserving tool failure", async () => {
    const engine: WorkflowControlEngine = {
      ...baseEngine(),
      executeDesign: vi.fn(async () => {
        throw new DesignFinalizationError([
          "traceability-task-unmapped",
          "design-openspec-incomplete",
        ]);
      }),
    };
    const item = harness("abel-design", engine);
    const input = {
      action: "design",
      request: {
        operation: "finalize-delivery",
        runId: "design-run-1",
        operationId: "finalize-v1",
      },
    };
    await expect(
      item.tool.execute(
        "finalize-error-call",
        input,
        undefined,
        undefined,
        item.context,
      ),
    ).rejects.toThrow(/design-finalization-invalid/u);

    const patch = await item.handlers.get("tool_result")?.({
      type: "tool_result",
      toolName: DISPATCH_TOOL,
      toolCallId: "finalize-error-call",
      input,
      content: [{ type: "text", text: "design-finalization-invalid" }],
      details: undefined,
      isError: true,
    });
    expect(patch).toMatchObject({
      content: [
        {
          type: "text",
          text: expect.stringContaining('"code":"design-finalization-invalid"'),
        },
      ],
      details: {
        designFailure: {
          kind: "design-control-failure",
          operation: "finalize-delivery",
          code: "design-finalization-invalid",
          diagnostics: [
            { code: "design-openspec-incomplete" },
            { code: "traceability-task-unmapped" },
          ],
        },
      },
    });
    expect(patch).not.toHaveProperty("isError");
    expect(item.active()).toContain(DISPATCH_TOOL);
  });

  it("publishes allowlisted OpenSpec launch detail without a duplicate root diagnostic", async () => {
    const diagnostic = new OpenSpecCliError(
      "status",
      "spawn",
      "launch-failed",
      { systemCode: "EINVAL" },
    ).diagnostic;
    const engine: WorkflowControlEngine = {
      ...baseEngine(),
      executeDesign: vi.fn(async () => {
        throw new DesignFinalizationError(
          ["design-openspec-unavailable"],
          diagnostic,
        );
      }),
    };
    const item = harness("abel-design", engine);
    const failure = await capturedDesignFailure(
      item,
      "launch-call",
      {
        action: "design",
        request: {
          operation: "finalize-delivery",
          runId: "design-run-1",
          operationId: "launch-failure",
        },
      },
      "design-finalization-invalid",
    );
    expect(failure).toMatchObject({
      details: { designFailure: { diagnostics: [diagnostic] } },
    });
  });

  it("deactivates after successful Design finalization but not at a Gate wait", async () => {
    const engine: WorkflowControlEngine = {
      ...baseEngine(),
      executeDesign: vi.fn(async (request: any) =>
        request.operation === "finalize-delivery"
          ? { state: "completed", completed: true, deliveryRevision: 1 }
          : { state: "paused", completed: false },
      ),
    };
    const item = harness("abel-design", engine);
    expect(item.active()).toEqual(["read", DISPATCH_TOOL]);

    await item.tool.execute(
      "approve-call",
      {
        action: "design",
        request: {
          operation: "approve-gate",
          runId: "design-run-1",
          operationId: "approve-a",
          gate: "gate-a",
          contract: "Approved activation behavior contract",
        },
      },
      undefined,
      undefined,
      item.context,
    );
    expect(item.active()).toContain(DISPATCH_TOOL);

    await item.tool.execute(
      "finalize-call",
      {
        action: "design",
        request: {
          operation: "finalize-delivery",
          runId: "design-run-1",
          operationId: "finalize-v1",
        },
      },
      undefined,
      undefined,
      item.context,
    );
    expect(item.active()).toEqual(["read", "bash"]);
  });

  it.each(["abel-implement", "abel-diagnose"] as const)(
    "restores the exact pre-Design tools before switching to %s",
    async (destination) => {
      const original = [
        "write",
        "read",
        "custom-tool",
        "grep",
        "bash",
        "find",
        "ls",
        "edit",
      ];
      const item = harness("abel-design", baseEngine(), original);
      expect(item.active()).toEqual([
        "read",
        "grep",
        "find",
        "ls",
        DISPATCH_TOOL,
      ]);

      await item.invoke(destination);

      expect(item.active()).toEqual([...original, DISPATCH_TOOL]);
    },
  );

  it.each(["session_start", "session_shutdown"] as const)(
    "restores the exact pre-Design tools on %s",
    async (event) => {
      const original = ["read", "unknown", "grep", "bash"];
      const item = harness("abel-design", baseEngine(), original);
      expect(item.active()).toEqual(["read", "grep", DISPATCH_TOOL]);

      await item.handlers.get(event)?.(
        { type: event },
        {
          mode: "print",
          model: undefined,
          modelRegistry: {},
        },
      );

      expect(item.active()).toEqual(original);
    },
  );

  it("keeps an Implement pause active and deactivates terminal settlement", async () => {
    let terminal = false;
    const engine = baseEngine(async () =>
      terminal
        ? { state: "discarded", completed: false, terminal: "discarded" }
        : { state: "approval-needed", completed: false },
    );
    const item = harness("abel-implement", engine);
    const command = {
      command: "status",
      stage: "abel-implement",
      change: "activation-lifecycle",
    };
    await item.tool.execute(
      "pause-call",
      command,
      undefined,
      undefined,
      item.context,
    );
    expect(item.active()).toContain(DISPATCH_TOOL);

    terminal = true;
    await item.tool.execute(
      "terminal-call",
      command,
      undefined,
      undefined,
      item.context,
    );
    expect(item.active()).toEqual(["read", "bash"]);
  });

  it("canonicalizes strict-provider padding before Implement validation", async () => {
    const execute = vi.fn(async (_command: unknown) => ({
      state: "paused",
      completed: false,
    }));
    const item = harness("abel-implement", baseEngine(execute));

    await item.tool.execute(
      "strict-start-call",
      {
        command: "start",
        stage: "abel-implement",
        change: "strict-provider-padding",
        operationId: "strict-start",
        deliveryRevision: 1,
        receiptHash: "",
        routeId: "",
      },
      undefined,
      undefined,
      item.context,
    );
    expect(execute.mock.calls[0]?.[0]).toEqual({
      command: "start",
      stage: "abel-implement",
      change: "strict-provider-padding",
      operationId: "strict-start",
    });

    await item.tool.execute(
      "strict-resume-call",
      {
        command: "resume",
        stage: "abel-implement",
        change: "strict-provider-padding",
        operationId: "strict-resume",
        deliveryRevision: null,
        receiptHash: null,
        routeId: null,
      },
      undefined,
      undefined,
      item.context,
    );
    expect(execute.mock.calls[1]?.[0]).toEqual({
      command: "resume",
      stage: "abel-implement",
      change: "strict-provider-padding",
      operationId: "strict-resume",
    });

    await expect(
      item.tool.execute(
        "unknown-field-call",
        {
          command: "start",
          stage: "abel-implement",
          change: "strict-provider-padding",
          operationId: "strict-unknown",
          deliveryRevision: null,
          receiptHash: null,
          routeId: null,
          graphHash: "must-remain-rejected",
        },
        undefined,
        undefined,
        item.context,
      ),
    ).rejects.toThrow(/invalid-control-command/u);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("deactivates Diagnose on explicit finish and preserves unrelated tools", async () => {
    const item = harness("abel-diagnose", baseEngine());
    await item.tool.execute(
      "finish-call",
      { action: "finish" },
      undefined,
      undefined,
      item.context,
    );
    expect(item.active()).toEqual(["read", "bash"]);
  });

  it("deactivates Design only through top-level finish and rejects a request body", async () => {
    const item = harness("abel-design", baseEngine());
    await expect(
      item.tool.execute(
        "ambiguous-finish-call",
        { action: "finish", request: { operation: "finish" } },
        undefined,
        undefined,
        item.context,
      ),
    ).rejects.toThrow(/control-envelope-ambiguous/u);
    expect(item.active()).toContain(DISPATCH_TOOL);

    await item.tool.execute(
      "design-finish-call",
      { action: "finish" },
      undefined,
      undefined,
      item.context,
    );
    expect(item.active()).toEqual(["read", "bash"]);
  });

  it("rejects an unbound Design packet before child execution", async () => {
    const assertDesignRun = vi.fn(() => {
      throw new Error("design-run-invalid");
    });
    const item = harness("abel-design", {
      ...baseEngine(),
      assertDesignRun,
      recordDesignEvidence: vi.fn(),
    });
    await expect(
      item.tool.execute(
        "invalid-run-call",
        {
          action: "run",
          request: {
            stage: "abel-design",
            role: "design-explorer",
            runId: "foreign-run",
            id: "evidence-one",
            phase: "evidence",
            objective: "Inspect bounded evidence",
            roots: ["."],
            context: { agents: "root", contract: "read-only" },
            declared: {
              read: ["src"],
              write: [],
              conflicts: [],
              resources: [],
            },
            output: "evidence",
          },
        },
        undefined,
        undefined,
        item.context,
      ),
    ).rejects.toThrow(/design-run-invalid/u);
    expect(assertDesignRun).toHaveBeenCalledWith("foreign-run");
  });
});
