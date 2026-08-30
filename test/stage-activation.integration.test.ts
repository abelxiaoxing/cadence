import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  DISPATCH_TOOL,
  registerWorkflowControl,
  type WorkflowControlEngine,
} from "../src/index.ts";

const packageDir = path.resolve(import.meta.dirname, "..");

function harness(
  prompt: "abel-design" | "abel-implement" | "abel-diagnose",
  engine: WorkflowControlEngine,
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
  registerWorkflowControl(pi as never, async () => engine);
  const invoke = (name: typeof prompt) => {
    handlers.get("input")?.({ text: `/${name} verified` });
    handlers.get("before_agent_start")?.(
      {
        prompt: `<abel-request>verified</abel-request> <!-- ABEL:PROMPT:${name} -->`,
      },
      { model: undefined, modelRegistry: {} },
    );
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

describe("semantic stage activation teardown", () => {
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
    (destination) => {
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

      item.invoke(destination);

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
