import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import { CheckoutGate } from "../src/service/checkout-gate.ts";
import {
  investigationId,
  type WorkflowRun,
} from "../src/service/contracts/workflow.ts";
import { ServiceCoordination } from "../src/service/coordination.ts";
import { Workflows } from "../src/service/workflows.ts";
import type { RunResult } from "../src/task-types.ts";
import { UNATTENDED_RETRY } from "../src/worker-model.mjs";
import { message } from "./helpers/capture-frames.ts";
import { fixtureRuntime } from "./helpers/worker-runtime.ts";

const worker = vi.hoisted(() => vi.fn());
vi.mock("../src/subagent-process.ts", async (original) => ({
  ...(await original<typeof import("../src/subagent-process.ts")>()),
  launchWorkflowWorker: worker,
}));
beforeEach(() => worker.mockReset());

// Owner-side research semantics against a stand-in worker launch: which
// questions are asked again, what is recorded and how the run settles. No SDK
// worker, provider or real process runs here.
type Launch = Parameters<
  typeof import("../src/subagent-process.ts").launchWorkflowWorker
>;
const native = (outcome: RunResult["outcome"], exitCode: number | null) => ({
  outcome,
  closure: "direct-child-closed",
  exitCode,
  signal: null,
  durationMs: 1,
  stdin: "delivered",
  final: outcome === "completed" ? "selected" : "missing",
  cleanup: "settled",
  capture: {
    observed: "complete",
    source: "sdk",
    redacted: false,
    omissions: [],
  },
});
/** A worker that answered: its final message is what the step records. */
const answer =
  (text: string) =>
  async (...[, , , options]: Launch): Promise<RunResult> => {
    const id = randomUUID();
    for (const f of message(id, [text])) options?.onFrame?.(f, []);
    options?.onNative?.(native("completed", 0) as never, id);
    return {
      outcome: "completed",
      closed: true,
      exitCode: 0,
      signal: null,
      durationMs: 1,
      text: "",
      output: "",
      truncated: false,
    };
  };
/** A worker whose model request failed for good, as its diagnostic line says. */
const refusedByProvider = async (
  ...[, , , options]: Launch
): Promise<RunResult> => {
  options?.onNative?.(native("failed", 1) as never, undefined);
  return {
    outcome: "failed",
    closed: true,
    exitCode: 1,
    signal: null,
    durationMs: 1,
    text: "failed; direct child closed",
    output: `${JSON.stringify({
      stage: "assistant-final",
      class: "model-request-failed",
      outcome: "failed",
      terminalStopReason: "error",
      actualResponseStatus: "UNKNOWN",
      retryAttempts: 12,
      error: "429 Too Many Requests: concurrency limit reached",
      cleanupFailures: 0,
      cleanupSettled: true,
    })}\nSDK worker failed or returned an incomplete result.\n`,
    truncated: false,
  };
};
function fixture(parallel?: number) {
  const home = mkdtempSync(join(tmpdir(), "workflow-research-"));
  const cwd = join(home, "project");
  mkdirSync(cwd, { mode: 0o700 });
  // An answer is reused only while a project file it cites reads the same.
  writeFileSync(join(cwd, "notes.md"), "# Notes\n");
  const coordination = new ServiceCoordination(cwd, join(home, "state"));
  coordination.files.directory(coordination.directory, true);
  const epoch = randomUUID();
  const version = {
    epoch,
    accessGeneration: 1,
    configRev: 1,
    catalogId: randomUUID(),
  };
  const owner = {
    state: "idle" as "idle" | "quarantined",
    lease: { assert() {}, registration: { epoch } },
    quarantine() {
      owner.state = "quarantined";
    },
    trackConversation(p: Promise<unknown>) {
      void p.catch(() => {});
    },
    trackConversationProcess(p: Promise<unknown>) {
      void p.catch(() => {});
    },
  };
  const runtimes: unknown[] = [];
  const workflows = new Workflows({
    coordination,
    owner,
    gate: new CheckoutGate(owner),
    cwd,
    secrets: () => [],
    ...(parallel ? { parallel } : {}),
    models: {
      workerSettings: () => fixtureRuntime(),
      assertCurrent() {},
      prepareTracked: (input: { runtime: unknown }) => {
        runtimes.push(input.runtime);
        return {
          result: Promise.resolve({ status: "prepared", prepared: {} }),
          settled: Promise.resolve(),
        };
      },
    },
    choice: {
      snapshot: () => ({
        version,
        selected: {
          sourceSelectionId: randomUUID(),
          provider: "fixture",
          model: "fixed",
          api: "openai-completions",
          thinking: "off",
        },
      }),
    },
  } as unknown as ConstructorParameters<typeof Workflows>[0]);
  const research = async (questions: string[]): Promise<WorkflowRun> => {
    const id = randomUUID();
    workflows.command(id, epoch, {
      action: "research",
      goal: "Map the project",
      questions,
      model: version,
    });
    await workflows.join(id);
    const view = workflows.view(id);
    if (view.kind !== "workflow" || view.response.type !== "run")
      throw Error("run");
    return view.response.run;
  };
  return { workflows, research, owner, runtimes };
}
it("a question whose worker failed is asked once more, alone, and every answer is recorded as it settles", async () => {
  const f = fixture(2);
  const inFlight = { now: 0, most: 0, second: [] as number[] };
  let failures = 0;
  worker.mockImplementation(async (...call: Launch) => {
    inFlight.now++;
    inFlight.most = Math.max(inFlight.most, inFlight.now);
    try {
      await new Promise((resolve) => setImmediate(resolve));
      // The first question fails the first time it is asked, as the
      // reported provider did while its siblings were running.
      if (worker.mock.calls.length <= 3 && failures++ === 0)
        return await refusedByProvider(...call);
      if (worker.mock.calls.length > 3) inFlight.second.push(inFlight.now);
      return await answer(`Answer ${worker.mock.calls.length}`)(...call);
    } finally {
      inFlight.now--;
    }
  });
  try {
    const run = await f.research(["one", "two", "three"]);
    expect(worker).toHaveBeenCalledTimes(4);
    expect(inFlight.most).toBe(2);
    // The second asking runs by itself.
    expect(inFlight.second).toEqual([1]);
    expect(run.status).toBe("completed");
    expect(run.notice).toBe("");
    expect(run.steps.map((s) => [s.id.slice(0, 10), s.status])).toEqual([
      ["research-1", "failed"],
      ["research-2", "completed"],
      ["research-3", "completed"],
      ["research-1", "completed"],
    ]);
    // A failed step says why in the provider's words, not only that it closed.
    expect(run.steps[0].text).toBe(
      "The model request failed and automatic retries did not recover it.\nProvider: 429 Too Many Requests: concurrency limit reached (12 automatic retries)",
    );
    for (const step of run.steps.slice(1)) {
      expect(step.text).toMatch(/^Answer \d$/u);
      // Named by the step's investigation identity or by the step's own id.
      expect(f.workflows.investigated(step.childRunId as string)).toBe(true);
      expect(f.workflows.investigated(investigationId(step.id) as string)).toBe(
        true,
      );
    }
    expect(f.workflows.investigated(run.steps[0].childRunId as string)).toBe(
      false,
    );
    // Unattended workers are given the patient retry floor.
    expect(f.runtimes).toHaveLength(4);
    for (const runtime of f.runtimes)
      expect(runtime).toMatchObject({
        settings: { retry: { enabled: true, ...UNATTENDED_RETRY } },
      });
  } finally {
    f.workflows.closeHistory();
  }
});

it("an answered question survives its sibling failing twice; the run completes and says what is missing", async () => {
  const f = fixture();
  worker.mockImplementation(async (...call: Launch) =>
    (worker.mock.calls.length === 2
      ? answer("The second answer, from notes.md")
      : refusedByProvider)(...call),
  );
  try {
    const run = await f.research(["first", "second"]);
    // Asked twice, never a third time.
    expect(worker).toHaveBeenCalledTimes(3);
    expect(run.status).toBe("completed");
    expect(run.notice).toBe(
      "1 of 2 questions were answered; an unanswered one was asked a second time first.\nQuestion 1 was not answered: The model request failed and automatic retries did not recover it. Provider: 429 Too Many Requests: concurrency limit reached (12 automatic retries)",
    );
    const answered = run.steps.filter((s) => s.status === "completed");
    expect(answered).toHaveLength(1);
    expect(f.workflows.investigated(answered[0].childRunId as string)).toBe(
      true,
    );
    // The same question is now answered from its record: no worker.
    worker.mockClear();
    worker.mockImplementation(answer("unused"));
    const again = await f.research(["second"]);
    expect(worker).not.toHaveBeenCalled();
    expect(again.status).toBe("completed");
    expect(again.steps[0].text).toContain("The second answer");
    expect(
      f.workflows.investigated(investigationId(again.steps[0].id) as string),
    ).toBe(true);
  } finally {
    f.workflows.closeHistory();
  }
});

it("a run with no answer at all fails, and an unknown or timed-out worker is never asked again", async () => {
  const f = fixture();
  worker.mockImplementation(refusedByProvider);
  try {
    const failed = await f.research(["first", "second"]);
    expect(worker).toHaveBeenCalledTimes(4);
    expect(failed.status).toBe("failed");
    expect(failed.notice).toContain("Question 1 was not answered");
    expect(failed.notice).toContain("Question 2 was not answered");
    worker.mockReset();
    worker.mockImplementation(async (...[, , , options]: Launch) => {
      options?.onNative?.(native("timeout", null) as never, undefined);
      return {
        outcome: "timeout",
        closed: true,
        exitCode: null,
        signal: "SIGTERM",
        durationMs: 1,
        text: "fixture timeout",
        output: "",
        truncated: false,
      } as RunResult;
    });
    const timedOut = await f.research(["third"]);
    expect(worker).toHaveBeenCalledTimes(1);
    expect(timedOut.status).toBe("timeout");
  } finally {
    f.workflows.closeHistory();
  }
});
