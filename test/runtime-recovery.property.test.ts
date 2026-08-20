import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Activation } from "../src/activation.ts";
import { validateRequestEnvelope } from "../src/contracts.ts";
import { ParentPayloadBridge } from "../src/parent-payload-bridge.ts";
import { Runtime } from "../src/runtime.ts";
import { createSubmitTool } from "../src/submit-tool.ts";
import {
  contractOf,
  sameContract,
  WorkerRegistry,
  workerIdentity,
} from "../src/worker.ts";
import { PassthroughParentPayloadBridge } from "./helpers/passthrough-parent-payload-bridge.ts";

const TASK_ID = "approved-task-4.1";
const RED_REQUEST_ID = "approved-task-4.1:red:0";
const GREEN_REQUEST_ID = "approved-task-4.1:green:0";
const SNAPSHOT_SHA = "a".repeat(64);

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function activeRuntime(): Runtime {
  const activation = new Activation();
  activation.request();
  activation.activate();
  return new Runtime({
    activation,
    parentPayloadBridge: new PassthroughParentPayloadBridge(),
  });
}

function phaseRequest(input: {
  requestId: string;
  phase?: "red" | "green" | "refactor";
  taskId?: string;
  objective?: string;
  read?: string[];
  write?: string[];
}) {
  const phase = input.phase ?? "red";
  const write = input.write ?? ["src/runtime.ts"];
  return {
    stage: "abel-implement",
    role: "implementation-worker",
    taskId: input.taskId ?? TASK_ID,
    id: input.requestId,
    phase,
    objective: input.objective ?? "Implement the approved recovery contract",
    roots: ["."],
    context: {
      agents: "bounded package context",
      contract: "approved immutable task contract",
    },
    declared: {
      read: input.read ?? ["src/runtime.ts"],
      write,
      conflicts: [],
      resources: ["runtime-recovery"],
      verificationLock: "runtime-recovery-suite",
    },
    output: "diff",
    snapshot: Object.fromEntries(
      write.map((path) => [
        path,
        { kind: "file", sha256: SNAPSHOT_SHA, bytes: 1 },
      ]),
    ),
    verification: {
      id: `verify-${input.requestId}`,
      argv: [
        "bun",
        "run",
        "test:target",
        "test/runtime-recovery.property.test.ts",
      ],
      classification:
        phase === "red"
          ? "expected-red"
          : phase === "green"
            ? "expected-green"
            : "expected-refactor",
      ...(phase === "red"
        ? { expectedFailure: "[RUNTIME-RECOVERY:approved-red]" }
        : {}),
      minTests: 1,
    },
  };
}

function diffCandidate(requestId: string, taskId = TASK_ID) {
  return {
    id: requestId,
    role: "implementation-worker",
    kind: "diff" as const,
    taskId,
    phase: "red",
    summary: "Bind stable task identity independently of the phase request",
    diff: "--- a/src/runtime.ts\n+++ b/src/runtime.ts\n@@ -1 +1 @@\n-old\n+new\n",
    expectedVerification:
      "bun run test:target test/runtime-recovery.property.test.ts",
    risks: [],
    nextStep: "parent-owned preflight",
    contractCompliant: true as const,
  };
}

function context(root = process.cwd(), withModel = true) {
  return {
    cwd: root,
    model: withModel
      ? {
          provider: "test-provider",
          id: "test-model",
          api: "faux",
          name: "test-model",
        }
      : undefined,
    modelRegistry: {},
  };
}

function expectStableRecovery(
  result: unknown,
  expected: {
    code:
      | "mechanical-redispatch-exhausted"
      | "implementation-artifact-delivery-blocked"
      | "environment-blocked"
      | "design-required";
    taskId: string;
    requestId: string;
    phase: string;
    next:
      | "finish-unaffected"
      | "correct-artifact"
      | "repair-environment"
      | "return-to-design";
  },
  forbidden: RegExp[] = [],
): void {
  const failure = result as {
    ok: boolean;
    error?: string;
    recovery?: Record<string, unknown>;
  };
  const serialized = JSON.stringify(result);
  for (const pattern of forbidden) expect(serialized).not.toMatch(pattern);
  expect(failure.ok).toBe(false);
  expect(failure.error).toContain(expected.code);
  expect(failure.recovery).toMatchObject({
    code: expected.code,
    taskId: expected.taskId,
    requestId: expected.requestId,
    phase: expected.phase,
    branchBlocked: true,
    dependentsBlocked: true,
    partialResultUsable: false,
    independentResultsPreserved: true,
    next: expected.next,
  });
}

function artifactFixture(runtime: Runtime) {
  const root = mkdtempSync(join(tmpdir(), "cadence-runtime-recovery-"));
  roots.push(root);
  execFileSync("git", ["init", "-q"], { cwd: root });
  const target = "private-provider-token.txt";
  writeFileSync(join(root, target), "actual-private-value\n");
  const resultId = runtime.results.retain({
    diff: [
      `--- a/${target}`,
      `+++ b/${target}`,
      "@@ -1 +1 @@",
      "-expected-private-value",
      "+replacement",
      "",
    ].join("\n"),
    writeSet: [target],
    root,
  });
  return { root, target, resultId };
}

describe("stable task and phase identity", () => {
  it("requires a stable task id independently of the phase request id", () => {
    const request = phaseRequest({ requestId: RED_REQUEST_ID });
    const validation = validateRequestEnvelope(request);
    expect(validation.ok).toBe(true);
    if (validation.ok) expect((validation.value as any).taskId).toBe(TASK_ID);

    const withoutTaskId = structuredClone(request) as Record<string, unknown>;
    delete withoutTaskId.taskId;
    expect(validateRequestEnvelope(withoutTaskId).ok).toBe(false);
  });

  it("rejects implementation requests without a snapshot", () => {
    const request = phaseRequest({ requestId: RED_REQUEST_ID });
    const withoutSnapshot = structuredClone(request) as Record<string, unknown>;
    delete withoutSnapshot.snapshot;

    const validation = validateRequestEnvelope(withoutSnapshot);
    expect(validation.ok).toBe(false);
    expect((validation as { ok: false; reason: string }).reason).toMatch(
      /snapshot/i,
    );
  });

  it("rejects implementation requests with an incomplete read snapshot", () => {
    const request = phaseRequest({ requestId: RED_REQUEST_ID });
    const incompleteSnapshot = structuredClone(request) as Record<
      string,
      unknown
    >;
    (incompleteSnapshot.declared as { read: string[] }).read.push(
      "src/contracts.ts",
    );

    const validation = validateRequestEnvelope(incompleteSnapshot);
    expect(validation.ok).toBe(false);
    expect((validation as { ok: false; reason: string }).reason).toMatch(
      /snapshot/i,
    );
  });

  it("accepts distinct request and task identities at structural submit", async () => {
    const submit = createSubmitTool({
      requestId: RED_REQUEST_ID,
      taskId: TASK_ID,
      role: "implementation-worker",
      phase: "red",
      output: "diff",
    } as Parameters<typeof createSubmitTool>[0] & { taskId: string });

    const execution = (submit.tool.execute as any)(
      "submit-distinct-identities",
      diffCandidate(RED_REQUEST_ID),
    );

    await expect(execution).resolves.toMatchObject({
      details: { accepted: true },
      terminate: true,
    });
    expect(submit.getResult()).toMatchObject({
      id: RED_REQUEST_ID,
      taskId: TASK_ID,
    });
    expect(submit.getIdentity()).toEqual({
      request: true,
      role: true,
      task: true,
      phase: true,
    });
  });

  it("keys one logical Worker by stable task id, not request id", () => {
    const registry = new WorkerRegistry();
    const request = phaseRequest({ requestId: RED_REQUEST_ID });
    const worker = registry.pin(
      contractOf(request as any),
      workerIdentity({ provider: "test", id: "model" }),
    );

    expect(registry.get(TASK_ID)).toBe(worker);
    expect(registry.get(RED_REQUEST_ID)).toBeUndefined();
  });

  it("keeps phase-local ids, writes, snapshots, and verification out of task equality", () => {
    const phases = [
      phaseRequest({ requestId: RED_REQUEST_ID }),
      phaseRequest({
        requestId: GREEN_REQUEST_ID,
        phase: "green",
        write: ["src/worker.ts"],
      }),
      phaseRequest({
        requestId: "approved-task-4.1:refactor:0",
        phase: "refactor",
        write: ["src/contracts.ts", "src/submit-tool.ts"],
      }),
    ];

    for (let left = 0; left < phases.length; left++) {
      for (let right = left + 1; right < phases.length; right++) {
        expect(
          sameContract(
            contractOf(phases[left] as any),
            contractOf(phases[right] as any),
          ),
        ).toBe(true);
      }
    }
  });

  it("pins the complete current phase and its independent correction budget", () => {
    const request = phaseRequest({ requestId: RED_REQUEST_ID });
    const registry = new WorkerRegistry();
    const worker = registry.pin(
      contractOf(request as any),
      workerIdentity({ provider: "test", id: "model" }),
    ) as any;
    const task = worker.taskContract;
    const phase = worker.currentPhase;

    expect({
      taskId: task?.taskId ?? task?.id,
      requestId: phase?.requestId ?? phase?.id,
      phase: phase?.phase,
      write: phase?.writeSet ?? phase?.write,
      snapshot: phase?.snapshot,
      verification: phase?.verification,
      correctionIndex: phase?.correctionIndex,
    }).toEqual({
      taskId: TASK_ID,
      requestId: RED_REQUEST_ID,
      phase: "red",
      write: request.declared.write,
      snapshot: request.snapshot,
      verification: request.verification,
      correctionIndex: 0,
    });
  });
});

describe("typed finite Runtime recovery", () => {
  it("does not launch a repeated or later phase while a candidate awaits apply", async () => {
    const runtime = activeRuntime();
    const dispatch = vi
      .spyOn(runtime as any, "dispatchChild")
      .mockResolvedValue({
        ok: true,
        action: "run",
        result: { kind: "diff" },
        resultId: "pending-result",
      });
    const red = phaseRequest({ requestId: RED_REQUEST_ID });

    const delivered = await (runtime.execute as any)(
      "run",
      { request: red },
      context(),
    );
    const repeated = await (runtime.execute as any)(
      "run",
      { request: red },
      context(),
    );
    const advanced = await (runtime.execute as any)(
      "run",
      {
        request: phaseRequest({
          requestId: GREEN_REQUEST_ID,
          phase: "green",
        }),
      },
      context(),
    );

    expect(delivered.ok).toBe(true);
    expect(repeated).toMatchObject({
      ok: false,
      error: expect.stringMatching(/awaiting parent apply/i),
    });
    expect(advanced).toMatchObject({
      ok: false,
      error: expect.stringMatching(/awaiting parent apply/i),
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("allows a new request for an applied phase only under the same phase contract", async () => {
    const runtime = activeRuntime();
    const dispatch = vi
      .spyOn(runtime as any, "dispatchChild")
      .mockResolvedValue({
        ok: true,
        action: "run",
        result: { kind: "diff" },
      });
    const initial = phaseRequest({ requestId: RED_REQUEST_ID });

    const delivered = await (runtime.execute as any)(
      "run",
      { request: initial },
      context(),
    );
    const worker = (runtime as any).registry.get(TASK_ID);
    worker.state = { kind: "phase-applied" };

    const repeated = await (runtime.execute as any)(
      "run",
      { request: initial },
      context(),
    );
    const expanded = phaseRequest({
      requestId: "approved-task-4.1:red:expanded-correction",
      write: ["src/runtime.ts", "src/worker.ts"],
    });
    expanded.verification = structuredClone(initial.verification);
    const blocked = await (runtime.execute as any)(
      "run",
      { request: expanded },
      context(),
    );
    const correction = phaseRequest({
      requestId: "approved-task-4.1:red:applied-correction",
    });
    correction.verification = structuredClone(initial.verification);
    correction.snapshot = {
      "src/runtime.ts": {
        kind: "file",
        sha256: "b".repeat(64),
        bytes: 1,
      },
    };
    const corrected = await (runtime.execute as any)(
      "run",
      { request: correction },
      context(),
    );

    expect(delivered.ok).toBe(true);
    expect(repeated).toMatchObject({
      ok: false,
      error: expect.stringMatching(/already applied/i),
    });
    expectStableRecovery(blocked, {
      code: "design-required",
      taskId: TASK_ID,
      requestId: expanded.id,
      phase: "red",
      next: "return-to-design",
    });
    expect(corrected.ok).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect((runtime as any).registry.get(TASK_ID)).toMatchObject({
      currentPhase: {
        requestId: correction.id,
        phase: "red",
        correctionIndex: 0,
      },
    });
  });

  it("releases a discarded candidate and consumes its launch", async () => {
    const runtime = activeRuntime();
    const fixture = artifactFixture(runtime);
    const dispatch = vi
      .spyOn(runtime as any, "dispatchChild")
      .mockResolvedValue({
        ok: true,
        action: "run",
        result: { kind: "diff" },
        resultId: fixture.resultId,
      });
    const request = phaseRequest({
      requestId: "approved-task-4.1:green:discard",
      phase: "green",
      read: [fixture.target],
      write: [fixture.target],
    });

    const delivered = await (runtime.execute as any)(
      "run",
      { request },
      context(fixture.root),
    );
    const discarded = await runtime.execute("discard", {
      resultId: fixture.resultId,
    });
    const redispatched = await (runtime.execute as any)(
      "run",
      { request },
      context(fixture.root),
    );

    expect(delivered.ok).toBe(true);
    expect(discarded).toEqual({ ok: true, action: "discard" });
    expect(redispatched.ok).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("rejects an artifact correction that expands its phase write set", async () => {
    const runtime = activeRuntime();
    const fixture = artifactFixture(runtime);
    const dispatch = vi
      .spyOn(runtime as any, "dispatchChild")
      .mockResolvedValue({
        ok: true,
        action: "run",
        result: { kind: "diff" },
        resultId: fixture.resultId,
      });
    const requestId = "approved-task-4.1:green:artifact-scope";
    const initial = phaseRequest({
      requestId,
      phase: "green",
      read: [fixture.target],
      write: [fixture.target],
    });

    const delivered = await (runtime.execute as any)(
      "run",
      { request: initial },
      context(fixture.root),
    );
    const rejected = await (runtime.execute as any)(
      "apply",
      { resultId: fixture.resultId },
      context(fixture.root),
    );
    const correction = phaseRequest({
      requestId: "approved-task-4.1:green:artifact-scope-correction",
      phase: "green",
      read: [fixture.target],
      write: [fixture.target, "expanded-target.txt"],
    });
    correction.verification = structuredClone(initial.verification);
    const blocked = await (runtime.execute as any)(
      "run",
      { request: correction },
      context(fixture.root),
    );

    expect(delivered.ok).toBe(true);
    expect(rejected.ok).toBe(false);
    expectStableRecovery(blocked, {
      code: "design-required",
      taskId: TASK_ID,
      requestId: correction.id,
      phase: "green",
      next: "return-to-design",
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("returns sanitized mechanical exhaustion after exactly two launches", async () => {
    const runtime = activeRuntime();
    const dispatch = vi
      .spyOn(runtime as any, "dispatchChild")
      .mockResolvedValueOnce({
        ok: false,
        error:
          "provider=openai model=gpt-secret path=/home/alice/.config/token",
        failureKind: "failed",
        failureClass: "transport",
      })
      .mockResolvedValueOnce({
        ok: false,
        error: "compat-extension-secret payload=sk-live-secret",
        failureKind: "failed",
        failureClass: "transport",
      });

    const result = await (runtime.execute as any)(
      "run",
      { request: phaseRequest({ requestId: RED_REQUEST_ID }) },
      context(),
    );

    expect(dispatch).toHaveBeenCalledTimes(2);
    expectStableRecovery(
      result,
      {
        code: "mechanical-redispatch-exhausted",
        taskId: TASK_ID,
        requestId: RED_REQUEST_ID,
        phase: "red",
        next: "finish-unaffected",
      },
      [/openai|gpt-secret|alice|compat-extension-secret|sk-live-secret/i],
    );
  });

  it("[RUNTIME-RECOVERY:bridge-redispatch] bounds an unavailable bridge as mechanical redispatch", async () => {
    const activation = new Activation();
    activation.request();
    activation.activate();
    const runtime = new Runtime({
      activation,
      parentPayloadBridge: new ParentPayloadBridge(),
    });
    const getApiKeyAndHeaders = vi.fn().mockResolvedValue({
      ok: true,
      apiKey: "fresh-child-key",
      headers: {},
      env: {},
    });
    const ctx = context() as ReturnType<typeof context> & {
      modelRegistry: Record<string, unknown>;
    };
    ctx.modelRegistry = { getApiKeyAndHeaders };
    const requestId = "approved-task-4.1:red:bridge-unavailable";

    const result = await (runtime.execute as any)(
      "run",
      { request: phaseRequest({ requestId }) },
      ctx,
    );

    expect(getApiKeyAndHeaders).toHaveBeenCalledTimes(2);
    expectStableRecovery(result, {
      code: "mechanical-redispatch-exhausted",
      taskId: TASK_ID,
      requestId,
      phase: "red",
      next: "finish-unaffected",
    });
  });

  it("reserves launch one for a corrected artifact request with rejection evidence", async () => {
    const runtime = activeRuntime();
    const dispatch = vi
      .spyOn(runtime as any, "dispatchChild")
      .mockResolvedValueOnce({
        ok: false,
        error: "malformed diff leaked-provider-secret",
        failureKind: "failed",
        failureClass: "artifact",
      })
      .mockResolvedValueOnce({
        ok: true,
        action: "run",
        result: { kind: "diff" },
      });
    const initial = phaseRequest({ requestId: RED_REQUEST_ID });

    const rejected = await (runtime.execute as any)(
      "run",
      { request: initial },
      context(),
    );

    expectStableRecovery(
      rejected,
      {
        code: "implementation-artifact-delivery-blocked",
        taskId: TASK_ID,
        requestId: RED_REQUEST_ID,
        phase: "red",
        next: "correct-artifact",
      },
      [/leaked-provider-secret/i],
    );
    expect(dispatch).toHaveBeenCalledTimes(1);

    const correction = phaseRequest({
      requestId: "approved-task-4.1:red:artifact-correction",
    });
    correction.verification = structuredClone(initial.verification);
    correction.snapshot = {
      "src/runtime.ts": {
        kind: "file",
        sha256: "b".repeat(64),
        bytes: 1,
      },
    };
    const corrected = await (runtime.execute as any)(
      "run",
      { request: correction },
      context(),
    );

    expect(corrected.ok).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls[1]?.[4]).toBe("generated-artifact-rejection");
  });

  it("classifies an unavailable phase runtime as environment-blocked", async () => {
    const runtime = activeRuntime();
    const requestId = "approved-task-4.1:red:environment";

    const result = await (runtime.execute as any)(
      "run",
      { request: phaseRequest({ requestId }) },
      context(process.cwd(), false),
    );

    expectStableRecovery(result, {
      code: "environment-blocked",
      taskId: TASK_ID,
      requestId,
      phase: "red",
      next: "repair-environment",
    });
  });

  it("caps launches when environment preparation fails after child delivery", async () => {
    const runtime = activeRuntime();
    const dispatch = vi
      .spyOn(runtime as any, "dispatchChild")
      .mockResolvedValue({
        ok: false,
        error: "candidate preflight inputs are unavailable",
        failureKind: "failed",
        failureClass: "environment",
        launchConsumed: true,
      });
    const request = phaseRequest({
      requestId: "approved-task-4.1:green:post-child-environment",
      phase: "green",
    });

    const first = await (runtime.execute as any)("run", { request }, context());
    const second = await (runtime.execute as any)(
      "run",
      { request },
      context(),
    );
    const blocked = await (runtime.execute as any)(
      "run",
      { request },
      context(),
    );

    expect(first.recovery).toMatchObject({
      code: "environment-blocked",
      launchIndex: 0,
    });
    expect(second.recovery).toMatchObject({
      code: "environment-blocked",
      launchIndex: 1,
    });
    expectStableRecovery(blocked, {
      code: "mechanical-redispatch-exhausted",
      taskId: TASK_ID,
      requestId: request.id,
      phase: "green",
      next: "finish-unaffected",
    });
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("classifies a changed immutable task contract as design-required", async () => {
    const runtime = activeRuntime();
    const dispatch = vi
      .spyOn(runtime as any, "dispatchChild")
      .mockResolvedValue({
        ok: true,
        action: "run",
        result: { kind: "diff" },
      });
    const first = phaseRequest({ requestId: RED_REQUEST_ID });
    const changed = phaseRequest({
      requestId: GREEN_REQUEST_ID,
      phase: "green",
      objective: "Change the approved architecture and semantic behavior",
    });

    const accepted = await (runtime.execute as any)(
      "run",
      { request: first },
      context(),
    );
    const blocked = await (runtime.execute as any)(
      "run",
      { request: changed },
      context(),
    );

    expect(accepted.ok).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expectStableRecovery(blocked, {
      code: "design-required",
      taskId: TASK_ID,
      requestId: GREEN_REQUEST_ID,
      phase: "green",
      next: "return-to-design",
    });
  });

  it("classifies and sanitizes a generated artifact rejection", async () => {
    const runtime = activeRuntime();
    const fixture = artifactFixture(runtime);
    vi.spyOn(runtime as any, "dispatchChild").mockResolvedValue({
      ok: true,
      action: "run",
      result: { kind: "diff" },
      resultId: fixture.resultId,
    });
    const requestId = "approved-task-4.1:green:artifact";
    const request = phaseRequest({
      requestId,
      phase: "green",
      read: [fixture.target],
      write: [fixture.target],
    });

    const delivered = await (runtime.execute as any)(
      "run",
      { request },
      context(fixture.root),
    );
    const rejected = await (runtime.execute as any)(
      "apply",
      { resultId: fixture.resultId },
      context(fixture.root),
    );

    expect(delivered.ok).toBe(true);
    expectStableRecovery(
      rejected,
      {
        code: "implementation-artifact-delivery-blocked",
        taskId: TASK_ID,
        requestId,
        phase: "green",
        next: "correct-artifact",
      },
      [/private-provider-token|actual-private|expected-private/i],
    );
    expect(runtime.results.get(fixture.resultId)).toBeUndefined();
  });

  it("routes a passing Red preflight to Design without artifact correction", () => {
    const runtime = activeRuntime();
    const request = phaseRequest({ requestId: RED_REQUEST_ID });
    const worker = (runtime as any).registry.pin(
      contractOf(request as any),
      workerIdentity({
        provider: "test-provider",
        id: "test-model",
        name: "test-model",
      }),
    );
    worker.state = { kind: "candidate-pending" };
    const resultId = runtime.results.retain({
      diff: "--- a/src/runtime.ts\n+++ b/src/runtime.ts\n@@ -1 +1 @@\n-old\n+new\n",
      writeSet: ["src/runtime.ts"],
      root: process.cwd(),
    });

    const result = (runtime as any).presentApplyFailure(
      resultId,
      {
        taskId: TASK_ID,
        requestId: RED_REQUEST_ID,
        phase: "red",
        launchIndex: 0,
      },
      "candidate preflight rejected: design:red-contract-invalid",
    );

    expectStableRecovery(result, {
      code: "design-required",
      taskId: TASK_ID,
      requestId: RED_REQUEST_ID,
      phase: "red",
      next: "return-to-design",
    });
    expect(runtime.results.get(resultId)).toBeUndefined();
    expect(worker.state).toEqual({ kind: "ready" });
  });

  it("preserves preflight stale classification for one snapshot-only redispatch", async () => {
    const runtime = activeRuntime();
    const fixture = artifactFixture(runtime);
    const dispatch = vi
      .spyOn(runtime as any, "dispatchChild")
      .mockResolvedValue({
        ok: true,
        action: "run",
        result: { kind: "diff" },
        resultId: fixture.resultId,
      });
    const requestId = "approved-task-4.1:green:preflight-stale";
    const initial = phaseRequest({
      requestId,
      phase: "green",
      read: [fixture.target],
      write: [fixture.target],
    });

    const delivered = await (runtime.execute as any)(
      "run",
      { request: initial },
      context(fixture.root),
    );
    const stale = (runtime as any).presentApplyFailure(
      fixture.resultId,
      {
        taskId: TASK_ID,
        requestId,
        phase: "green",
        launchIndex: 0,
      },
      "candidate preflight rejected: stale:dependency-changed",
    );
    const refreshed = structuredClone(initial);
    refreshed.snapshot = {
      [fixture.target]: {
        kind: "file",
        sha256: "b".repeat(64),
        bytes: 1,
      },
    };
    const redispatched = await (runtime.execute as any)(
      "run",
      { request: refreshed },
      context(fixture.root),
    );

    expect(delivered.ok).toBe(true);
    expect(stale).toEqual({
      ok: false,
      error: "candidate preflight rejected: stale:dependency-changed",
    });
    expect(runtime.results.get(fixture.resultId)).toBeUndefined();
    expect(redispatched.ok).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("does not stack artifact correction after transport used launch one", async () => {
    const runtime = activeRuntime();
    const fixture = artifactFixture(runtime);
    const dispatch = vi
      .spyOn(runtime as any, "dispatchChild")
      .mockResolvedValueOnce({
        ok: false,
        error: "transport-secret",
        failureKind: "failed",
        failureClass: "transport",
      })
      .mockResolvedValueOnce({
        ok: true,
        action: "run",
        result: { kind: "diff" },
        resultId: fixture.resultId,
      })
      .mockResolvedValueOnce({
        ok: true,
        action: "run",
        result: { kind: "diff" },
      });
    const requestId = "approved-task-4.1:green:transport-then-artifact";
    const initial = phaseRequest({
      requestId,
      phase: "green",
      read: [fixture.target],
      write: [fixture.target],
    });

    const delivered = await (runtime.execute as any)(
      "run",
      { request: initial },
      context(fixture.root),
    );
    const rejected = await (runtime.execute as any)(
      "apply",
      { resultId: fixture.resultId },
      context(fixture.root),
    );
    const correctionRequestId = "approved-task-4.1:green:artifact-correction";
    const correction = await (runtime.execute as any)(
      "run",
      {
        request: phaseRequest({
          requestId: correctionRequestId,
          phase: "green",
          read: [fixture.target],
          write: [fixture.target],
        }),
      },
      context(fixture.root),
    );

    expect(delivered.ok).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expectStableRecovery(
      rejected,
      {
        code: "implementation-artifact-delivery-blocked",
        taskId: TASK_ID,
        requestId,
        phase: "green",
        next: "finish-unaffected",
      },
      [/transport-secret|private-provider-token|expected-private/i],
    );
    expectStableRecovery(correction, {
      code: "implementation-artifact-delivery-blocked",
      taskId: TASK_ID,
      requestId: correctionRequestId,
      phase: "green",
      next: "finish-unaffected",
    });
  });
});
