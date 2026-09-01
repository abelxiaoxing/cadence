import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { DISPATCH_TOOL, registerWorkflowControl } from "../src/index.ts";
import { RunStoreFormatError } from "../src/run-store.ts";
import {
  ACTIVITY_DETAILS_KEY,
  ActivityInlineComponent,
  projectWorkflowActivity,
  WORKFLOW_ACTIVITY_STATES,
  type WorkflowActivityUpdate,
} from "../src/subagent-activity.ts";

const packageRoot = path.resolve(import.meta.dirname, "..");

function packageText(relative: string): string {
  return readFileSync(path.join(packageRoot, relative), "utf8");
}

function workflowHarness(
  execute?: (
    command: Record<string, unknown>,
    onActivity?: (event: WorkflowActivityUpdate) => void,
  ) => Promise<Record<string, unknown>>,
) {
  let tool: any;
  let activeTools = ["read"];
  const handlers = new Map<string, (...args: any[]) => any>();
  const pi = {
    registerTool(definition: unknown) {
      tool = definition;
    },
    on(name: string, handler: (...args: any[]) => any) {
      handlers.set(name, handler);
    },
    getCommands: () =>
      ["abel-design", "abel-implement", "abel-diagnose"].map((name) => ({
        name,
        source: "prompt",
        sourceInfo: {
          origin: "package",
          baseDir: packageRoot,
          path: path.join(packageRoot, "prompts", `${name}.md`),
        },
      })),
    getActiveTools: () => [...activeTools],
    setActiveTools(next: string[]) {
      activeTools = [...next];
    },
  };
  registerWorkflowControl(
    pi as never,
    () =>
      ({
        async execute(
          command: Record<string, unknown>,
          _context: unknown,
          _signal: unknown,
          onActivity?: (event: WorkflowActivityUpdate) => void,
        ) {
          if (execute) return execute(command, onActivity);
          return typeof command.operationId === "string" &&
            command.operationId.includes("approval")
            ? {
                state: "approval-needed",
                completed: false,
                pause: { code: "repair-boundary-expansion" },
              }
            : {
                state: "paused",
                completed: false,
                pause: { code: "transport-failure" },
              };
        },
        async close() {},
      }) as never,
  );
  return {
    handlers,
    tool: () => tool,
    activeTools: () => [...activeTools],
  };
}

function invokePrompt(
  harness: ReturnType<typeof workflowHarness>,
  name: string,
  argument = "smooth-workflow",
) {
  harness.handlers.get("input")?.({ text: `/${name} ${argument}` });
  harness.handlers.get("before_agent_start")?.(
    {
      prompt: `<abel-request>${argument}</abel-request> <!-- ABEL:PROMPT:${name} -->`,
    },
    { cwd: packageRoot },
  );
}

describe("four-workflow user experience", () => {
  it("does not activate Abel control for ordinary work or Init", () => {
    const harness = workflowHarness();
    harness.handlers.get("input")?.({ text: "please inspect this repository" });
    harness.handlers.get("before_agent_start")?.(
      { prompt: "please inspect this repository" },
      { cwd: packageRoot },
    );
    expect(harness.activeTools()).toEqual(["read"]);

    invokePrompt(harness, "abel-init", ".");
    expect(harness.activeTools()).toEqual(["read"]);

    const skill = packageText("skills/abel-workflow/SKILL.md");
    expect(skill).toMatch(/only after an explicit \/abel-init/i);
    expect(skill).toMatch(/ordinary engineering request/i);
  });

  it("activates workflow control only for a verified package prompt", () => {
    const harness = workflowHarness();
    invokePrompt(harness, "abel-implement");
    expect(harness.activeTools()).toEqual(["read", DISPATCH_TOOL]);
    expect(harness.tool()).toBeDefined();

    const parameters = harness.tool().parameters;
    const commandEnum = parameters.properties.command.enum;
    expect(commandEnum).toEqual([
      "start",
      "status",
      "resume",
      "rebind",
      "cancel",
      "discard",
    ]);
    expect(parameters.required).toEqual(["command", "stage", "change"]);
    expect(parameters.anyOf).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          properties: expect.objectContaining({
            command: { type: "string", enum: ["status"] },
          }),
          required: ["command", "stage", "change"],
        }),
        expect.objectContaining({
          properties: expect.objectContaining({
            command: { type: "string", enum: ["start"] },
          }),
          required: ["command", "stage", "change", "operationId"],
        }),
      ]),
    );
  });

  it("returns structured local diagnostics when the run store cannot open", async () => {
    const databaseRoot = mkdtempSync(
      path.join(tmpdir(), "cadence-store-status-"),
    );
    const databasePath = path.join(databaseRoot, "control.sqlite3");
    const database = new DatabaseSync(databasePath);
    database.exec("CREATE TABLE old_state(value TEXT) STRICT;");
    database.close();
    try {
      let tool: any;
      let activeTools = ["read"];
      const handlers = new Map<string, (...args: any[]) => any>();
      const pi = {
        registerTool(definition: unknown) {
          tool = definition;
        },
        on(name: string, handler: (...args: any[]) => any) {
          handlers.set(name, handler);
        },
        getCommands: () =>
          ["abel-design", "abel-implement", "abel-diagnose"].map((name) => ({
            name,
            source: "prompt",
            sourceInfo: {
              origin: "package",
              baseDir: packageRoot,
              path: path.join(packageRoot, "prompts", `${name}.md`),
            },
          })),
        getActiveTools: () => [...activeTools],
        setActiveTools(next: string[]) {
          activeTools = [...next];
        },
      };
      registerWorkflowControl(pi as never, async () => {
        throw new RunStoreFormatError(databasePath);
      });
      handlers.get("input")?.({ text: "/abel-implement schema-status" });
      handlers.get("before_agent_start")?.(
        {
          prompt:
            "<abel-request>schema-status</abel-request> <!-- ABEL:PROMPT:abel-implement -->",
        },
        { cwd: packageRoot },
      );
      const status = await tool.execute(
        "schema-status-call",
        {
          command: "status",
          stage: "abel-implement",
          change: "schema-status",
        },
        undefined,
        undefined,
        { cwd: packageRoot, mode: "json" },
      );
      const start = await tool.execute(
        "schema-start-call",
        {
          command: "start",
          stage: "abel-implement",
          change: "schema-status",
          operationId: "schema-start",
        },
        undefined,
        undefined,
        { cwd: packageRoot, mode: "json" },
      );
      const expected = {
        stage: "abel-implement",
        change: "schema-status",
        state: "paused",
        durable: false,
        completed: false,
        pause: { code: "run-store-reset-required" },
        legalCommands: ["status", "start"],
        tasks: [],
        queue: [],
        controlStore: {
          code: "run-store-reset-required",
          databasePath,
          recovery: {
            action: "reset-private-run-store",
            requiresBackup: true,
            retryCommand: "status-or-start",
          },
        },
      };
      expect(status.details).toEqual(expected);
      expect(start.details).toEqual(expected);

      handlers.get("input")?.({ text: "/abel-design schema-status" });
      handlers.get("before_agent_start")?.(
        {
          prompt:
            "<abel-request>schema-status</abel-request> <!-- ABEL:PROMPT:abel-design -->",
        },
        { cwd: packageRoot },
      );
      const privateRequirement = "private requirement must not be reflected";
      const designInput = {
        action: "design",
        request: {
          operation: "start",
          operationId: "schema-design-start",
          requirement: privateRequirement,
        },
      };
      let designError: unknown;
      try {
        await tool.execute(
          "schema-design-call",
          designInput,
          undefined,
          undefined,
          { cwd: packageRoot, mode: "json" },
        );
      } catch (error) {
        designError = error;
      }
      expect(designError).toBeInstanceOf(Error);
      expect((designError as Error).name).toBe("DesignControlError");
      expect((designError as Error).message).toBe(
        "design-store-migration-failed",
      );
      const designFailure = await handlers.get("tool_result")?.({
        type: "tool_result",
        toolName: DISPATCH_TOOL,
        toolCallId: "schema-design-call",
        input: designInput,
        content: [{ type: "text", text: "design-store-migration-failed" }],
        details: undefined,
        isError: true,
      });
      expect(designFailure).toMatchObject({
        details: {
          designFailure: {
            code: "design-store-migration-failed",
            diagnostics: [
              {
                code: "design-store-migration-failed",
                category: "storage",
                field: "schemaVersion",
                retryable: false,
              },
            ],
          },
        },
      });
      expect(JSON.stringify(designFailure)).not.toContain(databasePath);
      expect(JSON.stringify(designFailure)).not.toContain(privateRequirement);
    } finally {
      rmSync(databaseRoot, { recursive: true, force: true });
    }
  });

  it("maps every semantic state truthfully and reserves success for completed", () => {
    for (const state of WORKFLOW_ACTIVITY_STATES) {
      const payload = {
        runId: "run-smooth-workflow",
        stage: "abel-implement",
        change: "smooth-workflow",
        state,
        ...(state === "completed" ? { completed: true } : {}),
        ...(state === "paused" || state === "approval-needed"
          ? { pause: { code: "bounded-pause" } }
          : {}),
        legalCommands:
          state === "completed" || state === "discarded" || state === "rejected"
            ? ["status"]
            : ["status", "resume", "cancel", "discard"],
        tasks: [{ taskId: "task-one", state: "phase-running", phase: "green" }],
      };
      const display = projectWorkflowActivity(
        {
          command: "resume",
          stage: "abel-implement",
          change: "smooth-workflow",
          operationId: "activity-projection-operation",
        },
        payload,
        125,
      );
      const rendered = new ActivityInlineComponent(display)
        .render(240)
        .join("\n");
      if (state === "completed") {
        expect(display).toMatchObject({ state: "completed", tone: "success" });
        expect(rendered).toContain("✓");
      } else {
        expect(display.tone).not.toBe("success");
        expect(rendered).not.toContain("✓");
      }
      expect(rendered).not.toMatch(/provider|endpoint|credential|prompt/i);
    }

    expect(
      projectWorkflowActivity(
        { command: "status", stage: "abel-implement" },
        { state: "completed", completed: false, legalCommands: ["status"] },
        0,
      ),
    ).toMatchObject({
      state: "rejected",
      tone: "error",
      code: "completion-state-inconsistent",
    });
  });

  it("streams activity into TUI and preserves a paused final state", async () => {
    const semanticUpdates: WorkflowActivityUpdate[] = [
      { state: "connecting", attempt: 1, maxAttempts: 2, wait: "connection" },
      {
        state: "waiting-first-response",
        attempt: 1,
        maxAttempts: 2,
        wait: "first-response",
      },
      { state: "running", taskId: "task-one", phase: "green" },
      { state: "validating", taskId: "task-one", phase: "green" },
      {
        state: "retrying",
        taskId: "task-one",
        phase: "green",
        attempt: 1,
        maxAttempts: 2,
        code: "transport-failure",
      },
      { state: "verifying", taskId: "task-one", phase: "green" },
      { state: "applying" },
      { state: "recovering", code: "recovery-required" },
    ];
    const harness = workflowHarness(async (_command, onActivity) => {
      for (const update of semanticUpdates) onActivity?.(update);
      return {
        runId: "run-smooth-workflow",
        stage: "abel-implement",
        change: "smooth-workflow",
        state: "paused",
        completed: false,
        pause: { code: "transport-failure" },
        legalCommands: ["status", "resume", "discard"],
        tasks: [{ taskId: "task-one", state: "paused", phase: "green" }],
        queue: [],
      };
    });
    const ui = {
      setWidget: vi.fn(),
      setStatus: vi.fn(),
    };
    await harness.handlers.get("session_start")?.(
      {},
      { cwd: packageRoot, mode: "tui", ui },
    );
    invokePrompt(harness, "abel-implement");
    const command = {
      command: "resume",
      stage: "abel-implement",
      change: "smooth-workflow",
      operationId: "activity-operation-001",
    };
    const updates: any[] = [];
    const result = await harness
      .tool()
      .execute(
        "activity-tool-call",
        command,
        undefined,
        (update: unknown) => updates.push(update),
        { cwd: packageRoot, mode: "tui", ui },
      );

    expect(
      updates.map((update) => update.details?.[ACTIVITY_DETAILS_KEY]?.state),
    ).toEqual([
      "queued",
      ...semanticUpdates.map((update) => update.state),
      "paused",
    ]);
    expect(result.details[ACTIVITY_DETAILS_KEY]).toMatchObject({
      state: "paused",
      tone: "warning",
      code: "transport-failure",
      taskId: "task-one",
      nextAction: "resume",
    });
    const rendered = harness
      .tool()
      .renderResult(result, { expanded: false }, undefined, { args: command })
      .render(240)
      .join("\n");
    expect(rendered).toContain("paused");
    expect(rendered).toContain("next resume");
    expect(rendered).not.toContain("✓");
    expect(ui.setWidget).toHaveBeenCalled();
    expect(ui.setStatus).toHaveBeenCalled();
  });

  it("returns ordinary failure and boundary expansion without stage routing", async () => {
    const harness = workflowHarness();
    invokePrompt(harness, "abel-implement");
    const execute = harness.tool().execute.bind(harness.tool());
    const context = { cwd: packageRoot };

    const paused = await execute(
      "ordinary-call",
      {
        command: "resume",
        stage: "abel-implement",
        change: "smooth-workflow",
        operationId: "ordinary-operation-001",
      },
      undefined,
      undefined,
      context,
    );
    expect(paused.details).toEqual({
      state: "paused",
      completed: false,
      pause: { code: "transport-failure" },
    });

    const approval = await execute(
      "approval-call",
      {
        command: "resume",
        stage: "abel-implement",
        change: "smooth-workflow",
        operationId: "approval-operation-001",
      },
      undefined,
      undefined,
      context,
    );
    expect(approval.details).toEqual({
      state: "approval-needed",
      completed: false,
      pause: { code: "repair-boundary-expansion" },
    });
    expect(JSON.stringify([paused.details, approval.details])).not.toMatch(
      /abel-design|return-to-design|nextStep/i,
    );
  });

  it("keeps Design, Diagnose, and Implement responsibilities disjoint", () => {
    const init = packageText("prompts/abel-init.md");
    const design = packageText("prompts/abel-design.md");
    const diagnose = packageText("prompts/abel-diagnose.md");
    const implement = packageText("prompts/abel-implement.md");

    expect(init).toMatch(/performs no Subagent or `abel_dispatch` work/i);
    expect(design).toMatch(/never launches an implementation Worker/i);
    expect(design).toMatch(
      /collects cited evidence[\s\S]{0,80}compiles one trusted delivery/i,
    );
    expect(diagnose).toMatch(/not an Implement recovery route/i);
    expect(diagnose).toMatch(/reproduce[\s\S]*falsify[\s\S]*regression/i);
    expect(implement).toMatch(
      /Ordinary failures stay inside this Implement run/i,
    );
    expect(implement).toMatch(/\/abel-design --change <change>/i);
    expect(implement).toMatch(/never invoke Design automatically/i);
    expect(implement).not.toMatch(/return-to-design|nextStep/i);
  });
});
