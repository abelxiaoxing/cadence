// P-006 Red (R-09.30): fixed-seed drain property tests against the CURRENT
// runtime. A drain must be a single idempotent step that closes admission,
// erases retained results and Worker metadata, and leaves the dispatcher
// inactive. The current runtime fails only by leaking active state
// (Activation steps to "draining" instead of "inactive" on one drain call);
// retained-result erasure, cancel, tool restoration, and worker identity are
// asserted to pin down exactly where the drain gap is.

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
import { afterEach, describe, expect, it } from "vitest";
import { Activation, activateTool, deactivateTool } from "../src/activation";
import { snapshotFiles } from "../src/file-snapshot";
import { Runtime } from "../src/runtime";
import { taskRecordKey, WorkerRegistry, workerIdentity } from "../src/worker";
import {
  admitGraph,
  assertCandidateOutcome,
  graphAdmissionFor,
  type ImplementTaskFixture,
  taskAttemptFor,
} from "./helpers/implement-graph-fixture.ts";
import { PassthroughParentPayloadBridge } from "./helpers/passthrough-parent-payload-bridge.ts";

let parentProvider: typeof import("../src/parent-provider") | null = null;
try {
  parentProvider = await import("../src/parent-provider");
} catch {
  parentProvider = null;
}

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

const notReady = (name: string): never =>
  expect.fail(`not_ready: ${name} is not implemented`);

const DIFF = "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n";

function makeRoot(tag: string): string {
  const cwd = mkdtempSync(join(tmpdir(), `abel-drain-${tag}-`));
  roots.push(cwd);
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], {
    cwd,
  });
  execFileSync("git", ["config", "user.name", "Abel Drain"], { cwd });
  writeFileSync(join(cwd, "a.txt"), "old\n");
  mkdirSync(join(cwd, "node_modules/.bin"), { recursive: true });
  mkdirSync(join(cwd, "test"));
  writeFileSync(
    join(cwd, "package.json"),
    `${JSON.stringify({
      private: true,
      scripts: {
        check: 'node -e ""',
        "test:target": "node test/red-runner.mjs",
      },
    })}\n`,
  );
  writeFileSync(join(cwd, "bun.lock"), "# fixture lock\n");
  writeFileSync(
    join(cwd, "test/expected-red.test.mjs"),
    "// Fixture identity consumed by red-runner.mjs.\n",
  );
  writeFileSync(
    join(cwd, "test/red-runner.mjs"),
    [
      'import { writeFileSync } from "node:fs";',
      'const output = process.argv.find((arg) => arg.startsWith("--outputFile="));',
      'if (output) writeFileSync(output.slice("--outputFile=".length), JSON.stringify({',
      "  numTotalTests: 1,",
      "  numFailedTests: 1,",
      "  success: false,",
      '  testResults: [{ message: "", assertionResults: [{',
      '    status: "failed", fullName: "[DRAIN:expected-red]",',
      '    title: "[DRAIN:expected-red]", failureMessages: ["expected Red"],',
      "  }] }],",
      "}));",
      'console.error("[DRAIN:expected-red]");',
      "process.exit(1);",
      "",
    ].join("\n"),
  );
  writeFileSync(join(cwd, "node_modules/.bin/vitest"), "#!/bin/sh\n");
  chmodSync(join(cwd, "node_modules/.bin/vitest"), 0o755);
  execFileSync("git", ["add", "a.txt", "package.json", "bun.lock", "test"], {
    cwd,
  });
  execFileSync("git", ["commit", "-qm", "base"], { cwd });
  return cwd;
}

const submitResponse = (submitted: unknown) =>
  fauxAssistantMessage(
    fauxToolCall("abel_submit_result", submitted as Record<string, any>),
    { stopReason: "toolUse" },
  );

type OpenTaskRequest = ImplementTaskFixture;

function requestFor(
  id: string,
  phase: "red" | "green" | "refactor",
  root: string,
): OpenTaskRequest {
  const attempt = {
    changeId: "drain-fixture",
    taskId: id,
    requestId: id,
    phase,
    snapshot: snapshotFiles(root, ["a.txt", "test/red-runner.mjs"]),
  };
  return {
    boundary: {
      changeId: "drain-fixture",
      taskId: id,
      dependsOn: [],
      objective: "Change a.txt",
      roots: ["."],
      context: { agents: "none", contract: "approved" },
      phases: {
        red: {
          read: ["a.txt", "test/red-runner.mjs"],
          write: ["a.txt"],
          verificationLock: "drain-red",
          verification: {
            kind: "static-check",
            id: `verify-${id}`,
            runner: { kind: "node", script: "test/red-runner.mjs" },
            args: [],
            classification: "expected-red" as const,
            expectedFailure: "[DRAIN:expected-red]",
          },
          verificationInputs: [
            { kind: "workspace", path: "test/red-runner.mjs" },
          ],
        },
        green: {
          read: ["a.txt", "package.json"],
          write: ["a.txt"],
          verificationLock: "drain-green",
          verification: {
            kind: "package-script",
            id: `verify-${id}-green`,
            packageManager: "bun",
            script: "check",
            command: 'node -e ""',
            args: [],
            classification: "expected-green" as const,
          },
          verificationInputs: [{ kind: "workspace", path: "package.json" }],
        },
      },
      scheduling: {
        conflicts: [],
        resources: [],
      },
      agents: { impact: "none", managedOnly: true },
      approvedDependencies: [],
      impactClosure: {
        changedSurfaces: ["none"],
        searchEvidence: [],
        relatedTests: [],
        affectedSuite: [],
      },
    },
    attempt,
  };
}

async function runFixture(
  runtime: Runtime,
  request: ImplementTaskFixture,
  context: Parameters<Runtime["execute"]>[2],
) {
  await admitGraph(runtime, [request], context);
  return runtime.execute("run", { request: taskAttemptFor(request) }, context);
}

function diffSubmit(id: string, phase: string) {
  return {
    id,
    role: "implementation-worker",
    kind: "diff",
    taskId: id,
    phase,
    summary: "change a.txt",
    diff: DIFF,
    expectedVerification: "cat a.txt",
    risks: [],
    contractCompliant: true,
  };
}

async function modelFixture(tag: string) {
  if (!parentProvider) return notReady("parent-provider");
  const faux = fauxProvider({ provider: `abel-drain-${tag}`, api: "faux" });
  const modelRuntime = await parentProvider.runtimeForProvider(faux.provider);
  return { faux, modelRuntime };
}

async function makeActive(
  tag: string,
  parentPayloadBridge = new PassthroughParentPayloadBridge(),
) {
  const cwd = makeRoot(tag);
  const { faux, modelRuntime } = await modelFixture(tag);
  const activation = new Activation();
  activation.request();
  activation.activate();
  const runtime = new Runtime({
    activation,
    parentPayloadBridge,
  });
  return {
    cwd,
    faux,
    runtime,
    parentPayloadBridge,
    context: {
      cwd,
      model: faux.getModel(),
      modelRegistry: new ModelRegistry(modelRuntime),
    } as const,
  };
}

describe("drain property: single idempotent step closes admission", () => {
  it("one active drain lands inactive instead of leaking a half state", () => {
    const activation = new Activation();
    activation.request();
    activation.activate();
    expect(activation.isActive()).toBe(true);
    activation.drain();
    expect(activation.state).toBe("inactive");
    expect(activation.isActive()).toBe(false);
  });

  it("a drained runtime rejects new runs as not ready", async () => {
    const fixture = await makeActive("no-admission");
    fixture.runtime.drain();
    const blocked = await (fixture.runtime as any).execute(
      "run",
      {
        request: graphAdmissionFor([
          requestFor("drain-quiescent", "red", fixture.cwd),
        ]),
      },
      fixture.context,
    );
    expect(blocked.ok).toBe(false);
    expect(blocked.notReady).toBe(true);
  });
});

describe("drain property: finish erases results and worker", () => {
  it("finish clears the retained diff and pinned worker", async () => {
    const fixture = await makeActive("erase");
    fixture.faux.setResponses([
      submitResponse(diffSubmit("drain-erase", "red")),
    ]);
    const run = await runFixture(
      fixture.runtime,
      requestFor("drain-erase", "red", fixture.cwd),
      fixture.context,
    );
    expect(run).toMatchObject({
      kind: "candidate",
      requestId: "drain-erase",
      taskId: "drain-erase",
      phase: "red",
    });
    assertCandidateOutcome(run);
    const resultId = run.resultId as string;
    expect((fixture.runtime as any).results.get(resultId)).toBeDefined();
    const finished = await (fixture.runtime as any).execute(
      "finish",
      {},
      fixture.context,
    );
    expect(finished.ok).toBe(true);
    expect(fixture.runtime.state).toBe("inactive");
    expect((fixture.runtime as any).results.get(resultId)).toBeUndefined();
    expect((fixture.runtime as any).results.size).toBe(0);
  });

  it("[SLICE-4:task-lifetime-conflict] complete drain releases conflict for a later open", async () => {
    const fixture = await makeActive("conflict-release");
    fixture.faux.setResponses([
      submitResponse(diffSubmit("before-drain", "red")),
      submitResponse(diffSubmit("after-drain", "red")),
    ]);
    const registry = (fixture.runtime as any).registry as WorkerRegistry;

    const first = await runFixture(
      fixture.runtime,
      requestFor("before-drain", "red", fixture.cwd),
      fixture.context,
    );
    expect(first).toMatchObject({
      kind: "candidate",
      requestId: "before-drain",
      taskId: "before-drain",
      phase: "red",
    });
    expect(registry.values()).toHaveLength(1);

    await fixture.runtime.drain();
    expect(registry.values()).toHaveLength(0);
    expect(fixture.runtime.activation.request()).toBe(true);
    expect(fixture.runtime.activation.activate()).toBe(true);

    const later = await runFixture(
      fixture.runtime,
      requestFor("after-drain", "red", fixture.cwd),
      fixture.context,
    );

    expect(later).toMatchObject({
      kind: "candidate",
      requestId: "after-drain",
      taskId: "after-drain",
      phase: "red",
    });
    expect(fixture.faux.state.callCount).toBe(2);
    expect(registry.values()).toHaveLength(1);
    expect(registry.find(fixture.cwd, "after-drain")).toBeDefined();
  });

  it("drain is idempotent and repeatable on an inactive runtime", () => {
    const runtime = new Runtime({
      parentPayloadBridge: new PassthroughParentPayloadBridge(),
    });
    runtime.drain();
    runtime.drain();
    expect(runtime.state).toBe("inactive");
  });

  it("[SLICE-3:terminal-replay] settles parent apply before erasing every process-local fact", async () => {
    const bridge = new PassthroughParentPayloadBridge();
    bridge.beginSession("drain-terminal-replay");
    const fixture = await makeActive("terminal-replay", bridge);
    fixture.faux.setResponses([
      submitResponse(diffSubmit("drain-pending", "red")),
    ]);
    const run = await runFixture(
      fixture.runtime,
      requestFor("drain-pending", "red", fixture.cwd),
      fixture.context,
    );
    expect(run).toMatchObject({
      kind: "candidate",
      requestId: "drain-pending",
      taskId: "drain-pending",
      phase: "red",
    });
    assertCandidateOutcome(run);
    const resultId = run.resultId as string;
    const registry = (fixture.runtime as any).registry as WorkerRegistry;
    const candidate = registry.values()[0];
    const identity = workerIdentity(fixture.context.model);
    const blockedRequest = requestFor("drain-blocked", "red", fixture.cwd);
    const blocked = registry.open(
      blockedRequest.boundary,
      identity,
      fixture.cwd,
      blockedRequest.attempt,
    );
    blocked.state = {
      kind: "blocked",
      phase: "red",
      failure: {
        kind: "approval-boundary",
        code: "task-scope-insufficient",
      },
    } as never;
    const completedRequest = requestFor("drain-completed", "red", fixture.cwd);
    const completed = registry.open(
      completedRequest.boundary,
      identity,
      fixture.cwd,
      completedRequest.attempt,
    );
    completed.state = { kind: "completed", finalPhase: "green" } as never;

    expect(fixture.runtime.results.size).toBe(1);
    expect((fixture.runtime.results as any).sealedResults.size).toBe(1);
    expect((fixture.runtime.results as any).sealedCandidateFacts.size).toBe(1);
    expect(registry.values()).toHaveLength(3);
    expect(
      registry
        .values()
        .map((record) => record.state.kind)
        .sort(),
    ).toEqual(["blocked", "candidate-pending", "completed"]);
    expect((bridge as any).state?.active).toBe(true);

    let releaseApply!: () => void;
    (fixture.runtime as any).applyTail = new Promise<void>((resolve) => {
      releaseApply = resolve;
    });
    const order: string[] = [];
    const applying = (fixture.runtime as any)
      .execute(
        "apply",
        { resultId, requestId: "drain-pending:apply" },
        fixture.context,
      )
      .then(
        (result: unknown) => {
          order.push("apply");
          return result;
        },
        (error: unknown) => {
          order.push("apply-rejected");
          throw error;
        },
      );
    let discardSettled = false;
    const discarding = (fixture.runtime as any)
      .execute(
        "discard",
        {
          resultId,
          requestId: "drain-pending:discard",
          rejection: {
            kind: "artifact",
            code: "parent-review-rejected",
            stage: "parent-review",
          },
        },
        fixture.context,
      )
      .then(
        (result: unknown) => {
          discardSettled = true;
          order.push("discard");
          return result;
        },
        (error: unknown) => {
          discardSettled = true;
          order.push("discard-rejected");
          throw error;
        },
      );
    let finishSettled = false;
    const finishing = (fixture.runtime as any)
      .execute("finish", {}, fixture.context)
      .then((result: unknown) => {
        finishSettled = true;
        order.push("finish");
        return result;
      });
    await new Promise((resolve) => setTimeout(resolve, 25));
    const finishSettledBeforeApply = finishSettled;
    expect(discardSettled).toBe(false);
    expect((bridge as any).state?.active).toBe(true);
    releaseApply();
    const [applyOutcome, discardOutcome, finishOutcome] =
      await Promise.allSettled([applying, discarding, finishing]);

    expect(finishSettledBeforeApply).toBe(false);
    expect(applyOutcome).toMatchObject({
      status: "fulfilled",
      value: {
        kind: "applied",
        requestId: "drain-pending:apply",
        taskId: "drain-pending",
        phase: "red",
        readyPhase: "green",
      },
    });
    expect(discardOutcome).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({
        message: expect.stringMatching(/retained Implement result not found/i),
      }),
    });
    expect(finishOutcome).toMatchObject({
      status: "fulfilled",
      value: { ok: true, action: "finish" },
    });
    expect(order).toEqual(["apply", "discard-rejected", "finish"]);
    expect(candidate?.state).toEqual({
      kind: "ready",
      phase: "green",
      launchIndex: 0,
    });
    expect(readFileSync(join(fixture.cwd, "a.txt"), "utf8")).toBe("new\n");
    expect(fixture.runtime.results.size).toBe(0);
    expect((fixture.runtime.results as any).sealedResults.size).toBe(0);
    expect((fixture.runtime.results as any).sealedCandidateFacts.size).toBe(0);
    expect(registry.values()).toHaveLength(0);
    expect((bridge as any).state).toBeUndefined();
    expect(fixture.runtime.state).toBe("inactive");

    await fixture.runtime.drain();
    expect(fixture.runtime.results.size).toBe(0);
    expect(registry.values()).toHaveLength(0);
    expect(fixture.runtime.state).toBe("inactive");
  });
});

describe("drain property: cancel keeps the stage active", () => {
  it("cancel keeps retained results while active", async () => {
    const fixture = await makeActive("cancel");
    fixture.faux.setResponses([
      submitResponse(diffSubmit("drain-cancel", "red")),
    ]);
    const run = await runFixture(
      fixture.runtime,
      requestFor("drain-cancel", "red", fixture.cwd),
      fixture.context,
    );
    expect(run).toMatchObject({
      kind: "candidate",
      requestId: "drain-cancel",
      taskId: "drain-cancel",
      phase: "red",
    });
    assertCandidateOutcome(run);
    const resultId = run.resultId as string;
    const cancelled = await (fixture.runtime as any).execute(
      "cancel",
      {},
      fixture.context,
    );
    expect(cancelled.ok).toBe(true);
    expect(fixture.runtime.state).toBe("active");
    expect((fixture.runtime as any).results.get(resultId)).toBeDefined();
  });
});

describe("drain property: tool restoration keeps other tools", () => {
  it("deactivateTool removes only the dispatcher name", () => {
    const active = activateTool(["read", "grep"], "disp");
    const restored = deactivateTool(active, "disp");
    expect(restored).toEqual(["read", "grep"]);
  });
});

describe("drain property: worker identity is stable", () => {
  it("a worker is pinned by request id and erased on drain", () => {
    const registry = new WorkerRegistry();
    const request = requestFor("drain-identity", "red", process.cwd());
    const worker = registry.open(
      request.boundary,
      workerIdentity({ id: "model-a" }),
      process.cwd(),
      request.attempt,
    );
    expect(worker.state).toMatchObject({
      kind: "ready",
      phase: "red",
      launchIndex: 0,
    });
    const key = taskRecordKey(process.cwd(), "drain-fixture", "drain-identity");
    expect(registry.has(key)).toBe(true);
    registry.clear();
    expect(registry.has(key)).toBe(false);
  });
});
