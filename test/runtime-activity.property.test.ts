import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
import { runtimeForProvider } from "../src/parent-provider";
import { Runtime } from "../src/runtime";

const roots: string[] = [];
let providerSequence = 0;

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function request(id: string) {
  return {
    stage: "abel-implement",
    role: "implementation-worker",
    id,
    phase: "green",
    objective: `Complete ${id}`,
    roots: ["."],
    context: { agents: "root", contract: "approved" },
    declared: {
      read: ["a.txt"],
      write: [],
      conflicts: [],
      resources: [],
    },
    output: "evidence",
  };
}

function evidence(id: string) {
  return {
    id,
    role: "implementation-worker",
    kind: "evidence",
    conclusions: ["done"],
    citations: [{ path: "a.txt", lines: "1" }],
    constraints: [],
    dependencies: [],
    risks: [],
    blockingQuestions: [],
    hints: { writeSet: [], verification: "none", agentsImpact: "none" },
  };
}

async function runtimeFixture() {
  const cwd = mkdtempSync(join(tmpdir(), "abel-runtime-activity-"));
  roots.push(cwd);
  writeFileSync(join(cwd, "a.txt"), "old\n");
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
    runtime: new Runtime({ activation }),
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
      { request: request("activity") },
      context,
      undefined,
      (event: (typeof events)[number]) => {
        events.push(event);
        throw new Error("display failed");
      },
    );

    expect(result.ok).toBe(true);
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

    const result = await (runtime.execute as any)(
      "run",
      { request: { id: "invalid" } },
      context,
      undefined,
      (event: unknown) => events.push(event),
    );

    expect(result.ok).toBe(false);
    expect(events).toEqual([]);
  });

  it("keeps timeout redispatch semantics and emits only the final terminal state", async () => {
    const { runtime, context } = await runtimeFixture();
    const dispatch = vi
      .spyOn(runtime as any, "dispatchChild")
      .mockResolvedValueOnce({
        ok: false,
        error: "anthropic claude-sonnet-4 timed out at /private/model.log",
        failureKind: "timed-out",
      })
      .mockResolvedValueOnce({
        ok: true,
        action: "run",
        result: evidence("activity"),
      });
    const events: { state: string }[] = [];

    const result = await (runtime.execute as any)(
      "run",
      { request: request("activity") },
      context,
      undefined,
      (event: { state: string }) => events.push(event),
    );

    expect(result.ok).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(events.map((event) => event.state)).toEqual([
      "queued",
      "running",
      "completed",
    ]);
  });

  it("reports timed-out only after the one allowed redispatch also times out", async () => {
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
      { request: request("activity") },
      context,
      undefined,
      (event: { state: string; failureReason?: string }) => events.push(event),
    );

    expect(result.ok).toBe(false);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(events).toEqual([
      expect.objectContaining({ state: "queued" }),
      expect.objectContaining({ state: "running" }),
      expect.objectContaining({
        state: "timed-out",
        failureReason: "phase timed out",
      }),
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
      { request: request("activity") },
      context,
      controller.signal,
      (event: { state: string }) => states.push(event.state),
    );
    await vi.waitFor(() => expect(states).toContain("running"));

    controller.abort(new Error("caller cancelled"));
    const result = await run;

    expect(result.ok).toBe(false);
    expect(states).toEqual(["queued", "running", "cancelled"]);
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
