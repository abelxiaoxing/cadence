import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Activation } from "../src/activation";
import { runChildSession } from "../src/child-session";
import { snapshotFiles } from "../src/file-snapshot";
import { runtimeForProvider } from "../src/parent-provider";
import { Runtime } from "../src/runtime";
import { PassthroughParentPayloadBridge } from "./helpers/passthrough-parent-payload-bridge.ts";

const roots: string[] = [];
let providerSequence = 0;

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function request(id: string, root: string) {
  return {
    stage: "abel-implement",
    kind: "open-task",
    boundary: {
      changeId: "runtime-activity-fixture",
      taskId: id,
      objective: `Complete ${id}`,
      roots: ["."],
      context: { agents: "root", contract: "approved" },
      phases: {
        red: {
          read: ["a.txt"],
          write: ["a.txt"],
          verification: {
            id: `verify-${id}-red`,
            argv: ["bun", "run", "test:target", "test/expected-red.mjs"],
            classification: "expected-red",
            expectedFailure: "[RUNTIME-ACTIVITY:expected-red]",
            minTests: 1,
          },
        },
        green: {
          read: ["a.txt"],
          write: ["a.txt"],
          verification: {
            id: `verify-${id}-green`,
            argv: ["bun", "run", "check"],
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
      changeId: "runtime-activity-fixture",
      taskId: id,
      requestId: id,
      phase: "red",
      snapshot: snapshotFiles(root, ["a.txt"]),
    },
  };
}

function evidence(id: string) {
  return {
    id,
    role: "implementation-worker",
    kind: "diff",
    taskId: id,
    phase: "red",
    summary: "update activity fixture",
    diff: "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n",
    expectedVerification: "fixed fixture verification",
    risks: [],
    contractCompliant: true,
  };
}

async function runtimeFixture() {
  const cwd = mkdtempSync(join(tmpdir(), "abel-runtime-activity-"));
  roots.push(cwd);
  writeFileSync(join(cwd, "a.txt"), "old\n");
  mkdirSync(join(cwd, "node_modules/.bin"), { recursive: true });
  mkdirSync(join(cwd, "test"));
  writeFileSync(
    join(cwd, "test/expected-red.mjs"),
    "// fixture expected Red\n",
  );
  writeFileSync(
    join(cwd, "package.json"),
    `${JSON.stringify({
      private: true,
      scripts: { check: 'node -e ""', "test:target": "node" },
    })}\n`,
  );
  writeFileSync(join(cwd, "bun.lock"), "# fixture lock\n");
  writeFileSync(join(cwd, "node_modules/.bin/vitest"), "#!/bin/sh\n");
  chmodSync(join(cwd, "node_modules/.bin/vitest"), 0o755);
  const faux = fauxProvider({
    provider: `abel-runtime-activity-${providerSequence++}`,
    api: "faux",
  });
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall("abel_submit_result", evidence("activity")),
      { stopReason: "toolUse" },
    ),
  ]);
  const modelRuntime = await runtimeForProvider(faux.provider);
  const activation = new Activation();
  activation.request();
  activation.activate();
  return {
    runtime: new Runtime({
      activation,
      parentPayloadBridge: new PassthroughParentPayloadBridge(),
    }),
    context: {
      cwd,
      model: faux.getModel(),
      modelRegistry: new ModelRegistry(modelRuntime),
    },
  };
}

describe("request-scoped runtime activity", () => {
  it("emits one ordered lifecycle trace and ignores observer failures", async () => {
    const { runtime, context } = await runtimeFixture();
    const events: { state: string; requestId: string; sequence: number }[] = [];

    const result = await (runtime.execute as any)(
      "run",
      { request: request("activity", context.cwd) },
      context,
      undefined,
      (event: (typeof events)[number]) => {
        events.push(event);
        throw new Error("display failed");
      },
    );

    expect(result).toMatchObject({
      kind: "candidate",
      requestId: "activity",
      taskId: "activity",
      phase: "red",
    });
    expect(events.map((event) => event.state)).toEqual([
      "queued",
      "running",
      "completed",
    ]);
    expect(events.every((event) => event.requestId === "activity")).toBe(true);
    expect(events.map((event) => event.sequence)).toEqual([1, 1, 1]);
  });

  it("keeps invalid requests silent", async () => {
    const { runtime, context } = await runtimeFixture();
    const events: unknown[] = [];

    await expect(
      (runtime.execute as any)(
        "run",
        { request: { stage: "abel-implement", id: "invalid" } },
        context,
        undefined,
        (event: unknown) => events.push(event),
      ),
    ).rejects.toThrow(/Implement protocol error/i);
    expect(events).toEqual([]);
  });

  it("keeps timeout redispatch semantics and emits only the final terminal state", async () => {
    const { runtime, context } = await runtimeFixture();
    const dispatchChild = (runtime as any).dispatchChild.bind(runtime);
    const dispatch = vi
      .spyOn(runtime as any, "dispatchChild")
      .mockResolvedValueOnce({
        ok: false,
        error: "anthropic claude-sonnet-4 timed out at /private/model.log",
        failureKind: "timed-out",
      })
      .mockImplementation(dispatchChild);
    const events: { state: string }[] = [];

    const result = await (runtime.execute as any)(
      "run",
      { request: request("activity", context.cwd) },
      context,
      undefined,
      (event: { state: string }) => events.push(event),
    );

    expect(result).toMatchObject({
      kind: "candidate",
      requestId: "activity",
      taskId: "activity",
      phase: "red",
    });
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(events.map((event) => event.state)).toEqual([
      "queued",
      "running",
      "completed",
    ]);
  });

  it("reports one completed activity after bounded timeout attempts block the task", async () => {
    const { runtime, context } = await runtimeFixture();
    const dispatch = vi
      .spyOn(runtime as any, "dispatchChild")
      .mockResolvedValue({
        ok: false,
        error: "openai/gpt-5.4 timed out at /private/model.log",
        failureKind: "timed-out",
      });
    const events: Array<{ state: string; failureReason?: string }> = [];

    const result = await (runtime.execute as any)(
      "run",
      { request: request("activity", context.cwd) },
      context,
      undefined,
      (event: { state: string; failureReason?: string }) => events.push(event),
    );

    expect(result).toMatchObject({
      kind: "blocked",
      requestId: "activity",
      taskId: "activity",
      phase: "red",
      failure: { kind: "attempts-exhausted", cause: "transport" },
    });
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(events).toEqual([
      expect.objectContaining({ state: "queued" }),
      expect.objectContaining({ state: "running" }),
      expect.objectContaining({ state: "completed" }),
    ]);
    expect(JSON.stringify(events)).not.toMatch(/openai|gpt|private/i);
  });

  it("emits one cancelled terminal state for caller cancellation", async () => {
    const { runtime, context } = await runtimeFixture();
    const controller = new AbortController();
    vi.spyOn(runtime as any, "dispatchChild").mockImplementation(
      async (...args: unknown[]) => {
        const signal = args[3] as AbortSignal;
        return new Promise((resolve) => {
          signal.addEventListener(
            "abort",
            () =>
              resolve({
                ok: false,
                error: "cancelled by caller",
                failureKind: "cancelled",
              }),
            { once: true },
          );
        });
      },
    );
    const states: string[] = [];
    const run = (runtime.execute as any)(
      "run",
      { request: request("activity", context.cwd) },
      context,
      controller.signal,
      (event: { state: string }) => states.push(event.state),
    );
    await vi.waitFor(() => expect(states).toContain("running"));

    controller.abort(new Error("caller cancelled"));
    const result = await run;

    expect(result).toEqual({
      kind: "cancelled",
      requestId: "activity",
      taskId: "activity",
      phase: "red",
    });
    expect(states).toEqual(["queued", "running", "cancelled"]);
  });

  it("[SLICE-3:terminal-replay] preserves correction state when its child launch is cancelled", async () => {
    const { runtime, context } = await runtimeFixture();
    const initial = request("activity", context.cwd);
    const dispatch = vi
      .spyOn(runtime as any, "dispatchChild")
      .mockResolvedValueOnce({
        ok: false,
        error: "generated artifact rejected",
        failureKind: "failed",
        failureClass: "artifact",
      })
      .mockImplementation(async (...args: unknown[]) => {
        const signal = args[3] as AbortSignal;
        return new Promise((resolve) => {
          signal.addEventListener(
            "abort",
            () =>
              resolve({
                ok: false,
                error: "cancelled by caller",
                failureKind: "cancelled",
              }),
            { once: true },
          );
        });
      });

    await (runtime.execute as any)("run", { request: initial }, context);
    const stateBeforeCancellation = structuredClone(
      (runtime as any).registry.values()[0].state,
    );
    expect(stateBeforeCancellation).toEqual({
      kind: "ready",
      phase: "red",
      launchIndex: 1,
      correction: { kind: "artifact", code: "invalid-diff" },
    });

    const controller = new AbortController();
    const states: string[] = [];
    const correction = {
      stage: "abel-implement",
      kind: "phase-attempt",
      attempt: {
        ...structuredClone(initial.attempt),
        requestId: "activity:artifact-correction",
      },
    };
    const run = (runtime.execute as any)(
      "run",
      { request: correction },
      context,
      controller.signal,
      (event: { state: string }) => states.push(event.state),
    );
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(2));

    controller.abort(new Error("caller cancelled correction"));
    const result = await run;

    expect(result).toEqual({
      kind: "cancelled",
      requestId: "activity:artifact-correction",
      taskId: "activity",
      phase: "red",
    });
    expect(states).toEqual(["queued", "running", "cancelled"]);
    expect((runtime as any).registry.values()[0].state).toEqual(
      stateBeforeCancellation,
    );
  });

  it("classifies caller cancellation and phase timeout below the display layer", async () => {
    const cancelled = new AbortController();
    cancelled.abort(new Error("caller cancelled"));
    const cancelledProvider = fauxProvider({
      provider: `abel-child-cancel-${providerSequence++}`,
      api: "faux",
    });
    const cancelledRuntime = await runtimeForProvider(
      cancelledProvider.provider,
    );
    const cancelledResult = await runChildSession({
      cwd: process.cwd(),
      modelRuntime: cancelledRuntime,
      model: cancelledProvider.getModel(),
      systemPrompt: "submit",
      requestId: "cancelled",
      role: "design-explorer",
      output: "evidence",
      roots: ["."],
      timeoutMs: 100,
      signal: cancelled.signal,
    });
    expect(cancelledResult.ok).toBe(false);
    if (!cancelledResult.ok)
      expect(cancelledResult.failureKind).toBe("cancelled");

    const timeoutProvider = fauxProvider({
      provider: `abel-child-timeout-${providerSequence++}`,
      api: "faux",
      tokensPerSecond: 0.01,
    });
    timeoutProvider.setResponses([fauxAssistantMessage("never finish")]);
    const timeoutRuntime = await runtimeForProvider(timeoutProvider.provider);
    const timeoutResult = await runChildSession({
      cwd: process.cwd(),
      modelRuntime: timeoutRuntime,
      model: timeoutProvider.getModel(),
      systemPrompt: "wait",
      requestId: "timed-out",
      role: "design-explorer",
      output: "evidence",
      roots: ["."],
      timeoutMs: 5,
    });
    expect(timeoutResult.ok).toBe(false);
    if (!timeoutResult.ok) expect(timeoutResult.failureKind).toBe("timed-out");
  });
});
