import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Activation } from "../src/activation.ts";
import {
  type ChildFailure,
  validateRequestEnvelope,
} from "../src/contracts.ts";
import { snapshotFiles } from "../src/file-snapshot.ts";
import { ParentPayloadBridge } from "../src/parent-payload-bridge.ts";
import { Runtime } from "../src/runtime.ts";
import { createSubmitTool } from "../src/submit-tool.ts";
import { WorkerRegistry, workerIdentity } from "../src/worker.ts";
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
  const read = input.read ?? ["src/runtime.ts"];
  const write = input.write ?? ["src/runtime.ts"];
  const verification = (current: "red" | "green" | "refactor") => ({
    id: `verify-${input.requestId}-${current}`,
    argv: [
      "bun",
      "run",
      "test:target",
      "test/runtime-recovery.property.test.ts",
    ],
    classification:
      current === "red"
        ? "expected-red"
        : current === "green"
          ? "expected-green"
          : "expected-refactor",
    ...(current === "red"
      ? { expectedFailure: "[RUNTIME-RECOVERY:approved-red]" }
      : {}),
    minTests: 1,
  });
  const snapshot = Object.fromEntries(
    [...new Set([...read, ...write])].map((path) => [
      path,
      { kind: "file", sha256: SNAPSHOT_SHA, bytes: 1 },
    ]),
  );
  return {
    stage: "abel-implement",
    kind: "open-task",
    boundary: {
      changeId: "runtime-recovery",
      taskId: input.taskId ?? TASK_ID,
      objective: input.objective ?? "Implement the approved recovery contract",
      roots: ["."],
      context: {
        agents: "bounded package context",
        contract: "approved immutable task contract",
      },
      phases: {
        red: {
          read,
          write,
          verification: verification("red"),
          verificationLock: "runtime-recovery-suite",
        },
        green: {
          read,
          write,
          verification: verification("green"),
          verificationLock: "runtime-recovery-suite",
        },
        ...(phase === "refactor"
          ? {
              refactor: {
                read,
                write,
                verification: verification("refactor"),
                verificationLock: "runtime-recovery-suite",
              },
            }
          : {}),
      },
      scheduling: {
        conflicts: [],
        resources: ["runtime-recovery"],
      },
      agents: { impact: "none", managedOnly: true },
      approvedDependencies: [] as string[],
      impactClosure: {
        changedSurfaces: ["none"],
        searchEvidence: [],
        relatedTests: [],
        affectedSuite: [],
      },
    },
    attempt: {
      changeId: "runtime-recovery",
      taskId: input.taskId ?? TASK_ID,
      requestId: input.requestId,
      phase,
      snapshot,
    },
  };
}

function phaseAttempt(
  request: ReturnType<typeof phaseRequest>,
  overrides: {
    requestId?: string;
    phase?: "red" | "green" | "refactor";
    snapshot?: unknown;
  } = {},
) {
  return {
    stage: "abel-implement",
    kind: "phase-attempt",
    attempt: {
      ...structuredClone(request.attempt),
      ...(overrides.requestId === undefined
        ? {}
        : { requestId: overrides.requestId }),
      ...(overrides.phase === undefined ? {} : { phase: overrides.phase }),
      ...(overrides.snapshot === undefined
        ? {}
        : { snapshot: overrides.snapshot }),
    },
  };
}

function taskRecord(runtime: Runtime) {
  return (runtime as any).registry.values()[0];
}

function taskBoundary() {
  const target = [
    "bun",
    "run",
    "test:target",
    "test/runtime-recovery.property.test.ts",
  ];
  return {
    changeId: "remove-implement-design-loop",
    taskId: "S1",
    objective: "Register one immutable Implement task boundary",
    context: {
      agents: "bounded package context",
      contract: "approved immutable task contract",
    },
    roots: ["."],
    phases: {
      red: {
        read: ["src/runtime.ts", "test/runtime-recovery.property.test.ts"],
        write: ["test/runtime-recovery.property.test.ts"],
        verification: {
          id: "verify-s1-red",
          argv: target,
          classification: "expected-red",
          expectedFailure: "[SLICE-1:boundary-once]",
          minTests: 1,
        },
        verificationLock: "vitest-implement-runtime",
      },
      green: {
        read: ["src/runtime.ts", "test/runtime-recovery.property.test.ts"],
        write: ["src/runtime.ts"],
        verification: {
          id: "verify-s1-green",
          argv: target,
          classification: "expected-green",
          minTests: 1,
        },
        verificationLock: "vitest-implement-runtime",
      },
    },
    scheduling: {
      conflicts: ["S2"],
      resources: ["implement-runtime-core"],
    },
    agents: { impact: "none", managedOnly: true },
    approvedDependencies: [],
    impactClosure: {
      changedSurfaces: ["none"],
      searchEvidence: [],
      relatedTests: [
        {
          path: "test/runtime-recovery.property.test.ts",
          disposition: "current-task",
          evidence: "S1 Red owns task-boundary admission.",
        },
      ],
      affectedSuite: ["test/runtime-recovery.property.test.ts"],
    },
  };
}

function taskAttempt(
  phase: "red" | "green" = "red",
  requestId = `S1:${phase}:0`,
) {
  return {
    changeId: "remove-implement-design-loop",
    taskId: "S1",
    requestId,
    phase,
    snapshot: Object.fromEntries(
      ["src/runtime.ts", "test/runtime-recovery.property.test.ts"].map(
        (path) => [path, { kind: "file", sha256: SNAPSHOT_SHA, bytes: 1 }],
      ),
    ),
  };
}

function taskOpen() {
  return {
    stage: "abel-implement",
    kind: "open-task",
    boundary: taskBoundary(),
    attempt: taskAttempt(),
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

function phaseChildEnvelope() {
  return {
    stage: "abel-implement",
    role: "implementation-worker",
    taskId: TASK_ID,
    id: RED_REQUEST_ID,
    phase: "red",
    objective: "Exercise the phase runtime boundary",
    roots: ["."],
    context: { agents: "none", contract: "approved" },
    declared: {
      read: ["src/runtime.ts"],
      write: ["src/runtime.ts"],
      conflicts: [],
      resources: [],
    },
    output: "diff",
  };
}

function expectImplementOutcome(
  result: unknown,
  expected: Record<string, unknown>,
  forbidden: RegExp[] = [],
): void {
  const serialized = JSON.stringify(result);
  for (const pattern of forbidden) expect(serialized).not.toMatch(pattern);
  expect(result).toMatchObject(expected);
  expect(result).not.toHaveProperty("ok");
  expect(result).not.toHaveProperty("recovery");
}

function candidateDispatch(
  runtime: Runtime,
  envelope: any,
  root: string,
  resultId?: string,
) {
  const retainedId =
    resultId ??
    runtime.results.retain({
      diff: diffCandidate(envelope.id, envelope.taskId).diff,
      writeSet: [...envelope.declared.write],
      approvedDependencies: [...(envelope.approvedDependencies ?? [])],
      root,
      snapshot: structuredClone(envelope.snapshot),
    });
  return {
    ok: true,
    action: "run",
    result: diffCandidate(envelope.id, envelope.taskId),
    resultId: retainedId,
  };
}

const firstUsage = {
  input: 1,
  output: 2,
  cacheRead: 3,
  cacheWrite: 4,
  cacheWrite1h: 2,
  reasoning: 1,
  totalTokens: 10,
  cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 },
};

const secondUsage = {
  input: 10,
  output: 20,
  cacheRead: 30,
  cacheWrite: 40,
  cacheWrite1h: 20,
  reasoning: 10,
  totalTokens: 100,
  cost: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40, total: 100 },
};

const combinedUsage = {
  input: 11,
  output: 22,
  cacheRead: 33,
  cacheWrite: 44,
  cacheWrite1h: 22,
  reasoning: 11,
  totalTokens: 110,
  cost: { input: 11, output: 22, cacheRead: 33, cacheWrite: 44, total: 110 },
};

function mockCandidateDelivery(runtime: Runtime) {
  return vi
    .spyOn(runtime as any, "dispatchChild")
    .mockImplementation(async (_agent: unknown, envelope: any, ctx: any) =>
      candidateDispatch(runtime, envelope, ctx.cwd),
    );
}

function artifactFixture(runtime: Runtime) {
  const root = mkdtempSync(join(tmpdir(), "cadence-runtime-recovery-"));
  roots.push(root);
  execFileSync("git", ["init", "-q"], { cwd: root });
  const target = "private-provider-token.txt";
  writeFileSync(join(root, target), "actual-private-value\n");
  const snapshot = snapshotFiles(root, [target]);
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
    snapshot,
  });
  return { root, target, resultId, snapshot };
}

function retainedImplementFixture(
  runtime: Runtime,
  requestId = "approved-task-4.1:red:retained-origin",
) {
  const root = mkdtempSync(join(tmpdir(), "cadence-retained-implement-"));
  roots.push(root);
  execFileSync("git", ["init", "-q"], { cwd: root });
  const target = "candidate.txt";
  writeFileSync(join(root, target), "old\n");
  const request = phaseRequest({
    requestId,
    read: [target],
    write: [target],
  });
  request.boundary.approvedDependencies.push("approved-package");
  const resultId = runtime.results.retain({
    diff: [
      `--- a/${target}`,
      `+++ b/${target}`,
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "",
    ].join("\n"),
    root,
    writeSet: request.boundary.phases.red.write,
    approvedDependencies: request.boundary.approvedDependencies,
    snapshot: request.attempt.snapshot,
  } as Parameters<typeof runtime.results.retain>[0]);
  return { root, target, request, resultId };
}

async function deliveredImplementFixture(runtime: Runtime, requestId?: string) {
  const fixture = retainedImplementFixture(runtime, requestId);
  vi.spyOn(runtime as any, "dispatchChild").mockResolvedValue({
    ok: true,
    action: "run",
    result: { kind: "diff" },
    resultId: fixture.resultId,
  });
  const delivered = await (runtime.execute as any)(
    "run",
    { request: fixture.request },
    context(fixture.root),
  );
  expect(delivered).toMatchObject({
    kind: "candidate",
    taskId: fixture.request.attempt.taskId,
    requestId: fixture.request.attempt.requestId,
    phase: "red",
    resultId: fixture.resultId,
  });
  return fixture;
}

describe("[SLICE-1:boundary-once] one admitted task boundary", () => {
  it("opens Red once and derives the child scope without the Green-only write", async () => {
    const runtime = activeRuntime();
    const dispatch = mockCandidateDelivery(runtime);
    const request = taskOpen();

    const opened = await (runtime.execute as any)(
      "run",
      { request },
      context(),
    );

    expect(opened, "[SLICE-1:boundary-once] open-task").toMatchObject({
      kind: "candidate",
      taskId: "S1",
      requestId: "S1:red:0",
      phase: "red",
      resultId: expect.any(String),
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    const derived = dispatch.mock.calls[0]?.[1] as any;
    expect(derived).toMatchObject({
      stage: "abel-implement",
      role: "implementation-worker",
      taskId: "S1",
      id: "S1:red:0",
      phase: "red",
      objective: request.boundary.objective,
      roots: ["."],
      declared: {
        read: request.boundary.phases.red.read,
        write: request.boundary.phases.red.write,
        conflicts: request.boundary.scheduling.conflicts,
        resources: request.boundary.scheduling.resources,
        verificationLock: request.boundary.phases.red.verificationLock,
      },
      output: "diff",
      verification: request.boundary.phases.red.verification,
    });
    expect(derived.declared.write).not.toContain("src/runtime.ts");

    await expect(
      (runtime.execute as any)("run", { request: taskOpen() }, context()),
    ).rejects.toThrow(/duplicate|open|protocol/i);
    const cancelledDuplicate = new AbortController();
    cancelledDuplicate.abort(new Error("cancel duplicate open"));
    await expect(
      (runtime.execute as any)(
        "run",
        { request: taskOpen() },
        context(),
        cancelledDuplicate.signal,
      ),
    ).rejects.toThrow(/duplicate|open|protocol/i);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("rejects replayed stable facts and changed task identity before a child launch", async () => {
    const cases: Array<{
      label: string;
      request: Record<string, unknown>;
      nextContext: ReturnType<typeof context>;
    }> = [
      {
        label: "stable evidence replay",
        request: {
          stage: "abel-implement",
          kind: "phase-attempt",
          attempt: {
            ...taskAttempt("green"),
            objective: "replayed stable objective",
          },
        },
        nextContext: context(),
      },
      {
        label: "change identity",
        request: {
          stage: "abel-implement",
          kind: "phase-attempt",
          attempt: {
            ...taskAttempt("green"),
            changeId: "another-change",
          },
        },
        nextContext: context(),
      },
      {
        label: "task identity",
        request: {
          stage: "abel-implement",
          kind: "phase-attempt",
          attempt: {
            ...taskAttempt("green"),
            taskId: "S1-other",
          },
        },
        nextContext: context(),
      },
      {
        label: "provider identity",
        request: {
          stage: "abel-implement",
          kind: "phase-attempt",
          attempt: taskAttempt("green"),
        },
        nextContext: {
          ...context(),
          model: {
            ...context().model!,
            id: "changed-model",
            name: "changed-model",
          },
        },
      },
    ];

    const otherRoot = mkdtempSync(
      join(tmpdir(), "cadence-boundary-root-mismatch-"),
    );
    roots.push(otherRoot);
    cases.push({
      label: "workspace root identity",
      request: {
        stage: "abel-implement",
        kind: "phase-attempt",
        attempt: taskAttempt("green"),
      },
      nextContext: context(otherRoot),
    });

    for (const testCase of cases) {
      const runtime = activeRuntime();
      const dispatch = mockCandidateDelivery(runtime);
      const opened = await (runtime.execute as any)(
        "run",
        { request: taskOpen() },
        context(),
      );
      expect(opened, `${testCase.label}: initial open`).toMatchObject({
        kind: "candidate",
        taskId: "S1",
        requestId: "S1:red:0",
      });

      await expect(
        (runtime.execute as any)(
          "run",
          { request: testCase.request },
          testCase.nextContext,
        ),
        testCase.label,
      ).rejects.toThrow();
      expect(dispatch, testCase.label).toHaveBeenCalledTimes(1);
    }
  });

  it("pins the provider model API before phase transition checks", async () => {
    const runtime = activeRuntime();
    const dispatch = mockCandidateDelivery(runtime);
    const opened = await (runtime.execute as any)(
      "run",
      { request: taskOpen() },
      context(),
    );
    expect(opened).toMatchObject({
      kind: "candidate",
      taskId: "S1",
      requestId: "S1:red:0",
    });

    await expect(
      (runtime.execute as any)(
        "run",
        {
          request: {
            stage: "abel-implement",
            kind: "phase-attempt",
            attempt: taskAttempt("green"),
          },
        },
        {
          ...context(),
          model: { ...context().model!, api: "different-api" },
        },
      ),
      "[SLICE-1:boundary-once] API identity",
    ).rejects.toThrow(/provider\/model identity mismatch/i);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});

describe("stable task and phase identity", () => {
  it("requires a stable task id independently of the phase request id", () => {
    const request = phaseRequest({ requestId: RED_REQUEST_ID });
    const validation = validateRequestEnvelope(request);
    expect(validation.ok).toBe(true);
    if (validation.ok) {
      expect((validation.value as any).attempt.taskId).toBe(TASK_ID);
    }

    const withoutTaskId = structuredClone(request) as Record<string, unknown>;
    delete (withoutTaskId.attempt as Record<string, unknown>).taskId;
    expect(validateRequestEnvelope(withoutTaskId).ok).toBe(false);
  });

  it("rejects implementation requests without a snapshot", () => {
    const request = phaseRequest({ requestId: RED_REQUEST_ID });
    const withoutSnapshot = structuredClone(request) as Record<string, unknown>;
    delete (withoutSnapshot.attempt as Record<string, unknown>).snapshot;

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
    (
      incompleteSnapshot.boundary as {
        phases: { red: { read: string[] } };
      }
    ).phases.red.read.push("src/contracts.ts");

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
    const worker = registry.open(
      request.boundary as any,
      workerIdentity({ provider: "test", id: "model" }),
      process.cwd(),
      request.attempt as any,
    );

    expect(registry.get(worker.key)).toBe(worker);
    expect(registry.find(process.cwd(), TASK_ID)).toBe(worker);
    expect(registry.get(RED_REQUEST_ID)).toBeUndefined();
  });

  it("pins the stable boundary and current phase budget", () => {
    const request = phaseRequest({ requestId: RED_REQUEST_ID });
    const registry = new WorkerRegistry();
    const worker = registry.open(
      request.boundary as any,
      workerIdentity({ provider: "test", id: "model" }),
      process.cwd(),
      request.attempt as any,
    ) as any;
    const task = worker.boundary;
    const phase = worker.state;

    expect({
      taskId: task.taskId,
      phase: phase?.phase,
      write: task.phases.red.write,
      verification: task.phases.red.verification,
      correctionIndex: phase?.launchIndex,
    }).toEqual({
      taskId: TASK_ID,
      phase: "red",
      write: request.boundary.phases.red.write,
      verification: request.boundary.phases.red.verification,
      correctionIndex: 0,
    });
  });
});

describe("[SLICE-2:typed-failure] retained identity and typed control", () => {
  it("binds every Implement candidate to its origin and exact boundary facts", async () => {
    const runtime = activeRuntime();
    const fixture = await deliveredImplementFixture(runtime);
    const retained = runtime.results.get(fixture.resultId);

    expect(retained).toMatchObject({
      stage: "abel-implement",
      canonicalRoot: fixture.root,
      root: fixture.root,
      changeId: fixture.request.boundary.changeId,
      taskId: fixture.request.boundary.taskId,
      originRequestId: fixture.request.attempt.requestId,
      phase: "red",
      launchIndex: 0,
    });
    expect(retained?.writeSet).toEqual(
      fixture.request.boundary.phases.red.write,
    );
    expect(retained?.approvedDependencies).toEqual(
      fixture.request.boundary.approvedDependencies,
    );
    expect(retained?.snapshot).toEqual(fixture.request.attempt.snapshot);
  });

  it.each([
    ["stage", (retained: any) => (retained.stage = "abel-diagnose")],
    [
      "canonical root",
      (retained: any) => (retained.canonicalRoot = process.cwd()),
    ],
    ["change", (retained: any) => (retained.changeId = "foreign-change")],
    ["task", (retained: any) => (retained.taskId = "foreign-task")],
    [
      "origin request",
      (retained: any) => (retained.originRequestId = "foreign-request"),
    ],
    ["phase", (retained: any) => (retained.phase = "green")],
    ["launch", (retained: any) => (retained.launchIndex = 1)],
    ["write set", (retained: any) => (retained.writeSet = [])],
    [
      "approved dependencies",
      (retained: any) => (retained.approvedDependencies = []),
    ],
    [
      "snapshot",
      (retained: any) => {
        retained.snapshot = {
          ...retained.snapshot,
          "candidate.txt": {
            kind: "file",
            sha256: "f".repeat(64),
            bytes: 1,
          },
        };
      },
    ],
  ])(
    "rejects a retained candidate with mismatched %s",
    async (_name, alter) => {
      const runtime = activeRuntime();
      const fixture = retainedImplementFixture(runtime);
      const retained = (runtime.results as any).results.get(fixture.resultId);
      Object.assign(retained, {
        stage: "abel-implement",
        canonicalRoot: fixture.root,
        changeId: fixture.request.boundary.changeId,
        taskId: fixture.request.boundary.taskId,
        originRequestId: fixture.request.attempt.requestId,
        phase: fixture.request.attempt.phase,
        launchIndex: 0,
      });
      alter(retained);
      vi.spyOn(runtime as any, "dispatchChild").mockResolvedValue({
        ok: true,
        action: "run",
        result: { kind: "diff" },
        resultId: fixture.resultId,
      });
      const apply = vi.spyOn(runtime as any, "enqueueParentApply");

      await expect(
        (runtime.execute as any)(
          "run",
          { request: fixture.request },
          context(fixture.root),
        ),
      ).rejects.toThrow(/retained candidate identity mismatch/i);

      expect(apply).not.toHaveBeenCalled();
      expect(taskRecord(runtime).state.kind).toBe("ready");
      expect(runtime.results.get(fixture.resultId)).toBeUndefined();
    },
  );

  it("accepts only resultId plus the current apply operation requestId", async () => {
    const runtime = activeRuntime();
    const fixture = await deliveredImplementFixture(runtime);
    const apply = vi.spyOn(runtime as any, "enqueueApply").mockResolvedValue({
      kind: "applied",
      taskId: TASK_ID,
      requestId: "approved-task-4.1:apply:0",
      phase: "red",
      readyPhase: "green",
      result: { targets: [fixture.target], checkExitCode: 0, applyExitCode: 0 },
    });
    const operationRequestId = "approved-task-4.1:apply:0";
    const invalid = await Promise.allSettled([
      (runtime.execute as any)(
        "apply",
        { resultId: fixture.resultId },
        context(fixture.root),
      ),
      (runtime.execute as any)(
        "apply",
        {
          resultId: fixture.resultId,
          requestId: operationRequestId,
          stage: "abel-implement",
          root: fixture.root,
          changeId: fixture.request.boundary.changeId,
          taskId: fixture.request.boundary.taskId,
          phase: "red",
          launchIndex: 0,
          writeSet: [fixture.target],
          approvedDependencies: fixture.request.boundary.approvedDependencies,
          snapshot: fixture.request.attempt.snapshot,
        },
        context(fixture.root),
      ),
    ]);

    expect(invalid.map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    expect(apply).not.toHaveBeenCalled();

    const applied = await (runtime.execute as any)(
      "apply",
      { resultId: fixture.resultId, requestId: operationRequestId },
      context(fixture.root),
    );
    expect(applied).toMatchObject({
      kind: "applied",
      taskId: TASK_ID,
      requestId: operationRequestId,
      phase: "red",
      readyPhase: "green",
    });
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("does not downgrade a damaged Implement identity to legacy apply", async () => {
    const runtime = activeRuntime();
    const fixture = await deliveredImplementFixture(runtime);
    const retained = (runtime.results as any).results.get(fixture.resultId);
    delete retained.stage;
    const apply = vi.spyOn(runtime as any, "enqueueParentApply");

    await expect(
      (runtime.execute as any)(
        "apply",
        {
          resultId: fixture.resultId,
          requestId: "approved-task-4.1:apply:damaged-identity",
        },
        context(fixture.root),
      ),
    ).rejects.toThrow(/retained candidate identity mismatch/i);

    expect(apply).not.toHaveBeenCalled();
    expect(runtime.results.get(fixture.resultId)).toBeDefined();
  });

  it("rejects retained diff corruption while apply waits in the parent FIFO", async () => {
    const runtime = activeRuntime();
    const fixture = await deliveredImplementFixture(runtime);
    let releaseApply!: () => void;
    (runtime as any).applyTail = new Promise<void>((resolve) => {
      releaseApply = resolve;
    });

    const applying = (runtime.execute as any)(
      "apply",
      {
        resultId: fixture.resultId,
        requestId: "approved-task-4.1:apply:sealed-diff",
      },
      context(fixture.root),
    );
    const retained = (runtime.results as any).results.get(fixture.resultId);
    retained.diff = Buffer.from(
      [
        `--- a/${fixture.target}`,
        `+++ b/${fixture.target}`,
        "@@ -1 +1 @@",
        "-old",
        "+tampered",
        "",
      ].join("\n"),
      "utf8",
    );
    releaseApply();

    await expect(applying).rejects.toThrow(
      /retained candidate integrity mismatch/i,
    );
    expect(readFileSync(join(fixture.root, fixture.target), "utf8")).toBe(
      "old\n",
    );
  });

  it("requires a typed discard rejection and retains invalid requests", async () => {
    const runtime = activeRuntime();
    const fixture = await deliveredImplementFixture(runtime);
    const operationRequestId = "approved-task-4.1:discard:0";
    const rejection = {
      kind: "artifact",
      code: "parent-review-rejected",
      evidence: ["bounded parent review evidence"],
    };
    const invalid = await Promise.allSettled([
      (runtime.execute as any)("discard", {
        resultId: fixture.resultId,
        rejection,
      }),
      (runtime.execute as any)("discard", {
        resultId: fixture.resultId,
        requestId: operationRequestId,
      }),
      (runtime.execute as any)("discard", {
        resultId: fixture.resultId,
        requestId: operationRequestId,
        rejection,
        taskId: fixture.request.boundary.taskId,
        writeSet: [fixture.target],
      }),
    ]);

    expect(invalid.map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
      "rejected",
    ]);
    expect(runtime.results.get(fixture.resultId)).toBeDefined();

    const discarded = await (runtime.execute as any)("discard", {
      resultId: fixture.resultId,
      requestId: operationRequestId,
      rejection,
    });
    expect(discarded).toEqual({
      kind: "retry",
      taskId: TASK_ID,
      requestId: operationRequestId,
      phase: "red",
      scope: "worker",
      cause: "artifact",
      remainingAttempts: 1,
    });
    expect(runtime.results.get(fixture.resultId)).toBeUndefined();
  });

  it("forwards a typed approval-boundary discard decision", async () => {
    const runtime = activeRuntime();
    const fixture = await deliveredImplementFixture(runtime);
    const rejection = {
      kind: "approval-boundary",
      code: "unapproved-dependency-change",
    };

    const discarded = await (runtime.execute as any)("discard", {
      resultId: fixture.resultId,
      requestId: "approved-task-4.1:discard:approval-boundary",
      rejection,
    });

    expect(discarded).toEqual({
      kind: "blocked",
      taskId: TASK_ID,
      requestId: "approved-task-4.1:discard:approval-boundary",
      phase: "red",
      failure: rejection,
    });
  });

  it.each([
    ["artifact", { kind: "artifact", code: "red-not-witnessed" }],
    ["stale", { kind: "stale", code: "stale-snapshot" }],
    [
      "environment",
      { kind: "environment", code: "sandbox-runtime-unavailable" },
    ],
    [
      "approval-boundary",
      {
        kind: "approval-boundary",
        code: "unapproved-dependency-change",
      },
    ],
    ["cancelled", { kind: "cancelled", code: "cancelled" }],
    ["result-limit", { kind: "result-limit", limitBytes: 64 * 1024 }],
  ] as const)(
    "branches on typed %s failure instead of misleading evidence words",
    async (_kind, failure) => {
      const runtime = activeRuntime();
      const fixture = await deliveredImplementFixture(runtime);
      vi.spyOn(runtime as any, "enqueueParentApply").mockResolvedValue({
        ok: false,
        failure,
        error: "candidate preflight rejected: artifact:red-not-witnessed",
      });

      const operationRequestId = `approved-task-4.1:apply:typed-${failure.kind}`;
      const result = await (runtime.execute as any)(
        "apply",
        {
          resultId: fixture.resultId,
          requestId: operationRequestId,
        },
        context(fixture.root),
      );

      const identity = {
        taskId: TASK_ID,
        requestId: operationRequestId,
        phase: "red",
      };
      if (failure.kind === "artifact" || failure.kind === "stale") {
        expectImplementOutcome(result, {
          kind: "retry",
          ...identity,
          scope: "worker",
          cause: failure.kind,
          remainingAttempts: 1,
        });
      } else if (failure.kind === "cancelled") {
        expectImplementOutcome(result, { kind: "cancelled", ...identity });
      } else {
        expectImplementOutcome(result, {
          kind: "blocked",
          ...identity,
          failure,
        });
      }
      expect(readFileSync(join(fixture.root, fixture.target), "utf8")).toBe(
        "old\n",
      );
    },
  );

  it("propagates an unknown apply exception unchanged", async () => {
    const runtime = activeRuntime();
    const fixture = await deliveredImplementFixture(runtime);
    const internalError = new Error("opaque internal apply failure");
    vi.spyOn(runtime as any, "enqueueParentApply").mockRejectedValue(
      internalError,
    );

    await expect(
      (runtime.execute as any)(
        "apply",
        {
          resultId: fixture.resultId,
          requestId: "approved-task-4.1:apply:internal-error",
        },
        context(fixture.root),
      ),
    ).rejects.toBe(internalError);
  });
});

describe("typed finite Runtime recovery", () => {
  it("does not launch a repeated or later phase while a candidate awaits apply", async () => {
    const runtime = activeRuntime();
    const dispatch = mockCandidateDelivery(runtime);
    const red = phaseRequest({ requestId: RED_REQUEST_ID });

    const delivered = await (runtime.execute as any)(
      "run",
      { request: red },
      context(),
    );
    expect(delivered).toMatchObject({
      kind: "candidate",
      taskId: TASK_ID,
      requestId: RED_REQUEST_ID,
      phase: "red",
      resultId: expect.any(String),
    });
    await expect(
      (runtime.execute as any)(
        "run",
        { request: phaseAttempt(red) },
        context(),
      ),
    ).rejects.toThrow(/awaiting parent apply/i);
    await expect(
      (runtime.execute as any)(
        "run",
        {
          request: phaseAttempt(red, {
            requestId: GREEN_REQUEST_ID,
            phase: "green",
          }),
        },
        context(),
      ),
    ).rejects.toThrow(/awaiting parent apply/i);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("allows only the declared adjacent phase after apply", async () => {
    const runtime = activeRuntime();
    const dispatch = mockCandidateDelivery(runtime);
    const initial = phaseRequest({ requestId: RED_REQUEST_ID });

    const delivered = await (runtime.execute as any)(
      "run",
      { request: initial },
      context(),
    );
    const worker = taskRecord(runtime);
    worker.state = {
      kind: "ready",
      phase: "green",
      launchIndex: 0,
    };
    const green = phaseAttempt(initial, {
      requestId: GREEN_REQUEST_ID,
      phase: "green",
    });
    const advanced = await (runtime.execute as any)(
      "run",
      { request: green },
      context(),
    );

    expect(delivered).toMatchObject({
      kind: "candidate",
      requestId: RED_REQUEST_ID,
      phase: "red",
    });
    expect(advanced).toMatchObject({
      kind: "candidate",
      requestId: GREEN_REQUEST_ID,
      phase: "green",
    });
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(taskRecord(runtime)).toMatchObject({
      state: {
        phase: "green",
        launchIndex: 0,
      },
    });
  });

  it("rejects a non-adjacent implementation phase before launch", async () => {
    const runtime = activeRuntime();
    const dispatch = mockCandidateDelivery(runtime);
    const red = phaseRequest({
      requestId: RED_REQUEST_ID,
      phase: "refactor",
    });
    red.attempt.phase = "red";
    const delivered = await (runtime.execute as any)(
      "run",
      { request: red },
      context(),
    );
    const worker = taskRecord(runtime);
    worker.state = {
      kind: "ready",
      phase: "green",
      launchIndex: 0,
    };
    expect(delivered).toMatchObject({
      kind: "candidate",
      requestId: RED_REQUEST_ID,
      phase: "red",
    });
    await expect(
      (runtime.execute as any)(
        "run",
        {
          request: phaseAttempt(red, {
            requestId: "approved-task-4.1:refactor:0",
            phase: "refactor",
          }),
        },
        context(),
      ),
    ).rejects.toThrow(/phase transition/i);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("releases a discarded candidate and consumes its launch", async () => {
    const runtime = activeRuntime();
    const fixture = artifactFixture(runtime);
    const dispatch = vi
      .spyOn(runtime as any, "dispatchChild")
      .mockImplementationOnce(async (_agent, envelope, ctx: any) =>
        candidateDispatch(runtime, envelope, ctx.cwd, fixture.resultId),
      )
      .mockImplementation(async (_agent, envelope, ctx: any) =>
        candidateDispatch(runtime, envelope, ctx.cwd),
      );
    const request = phaseRequest({
      requestId: "approved-task-4.1:red:discard",
      read: [fixture.target],
      write: [fixture.target],
    });
    request.attempt.snapshot =
      fixture.snapshot as unknown as typeof request.attempt.snapshot;

    const delivered = await (runtime.execute as any)(
      "run",
      { request },
      context(fixture.root),
    );
    const discarded = await runtime.execute("discard", {
      resultId: fixture.resultId,
      requestId: "approved-task-4.1:discard:0",
      rejection: {
        kind: "artifact",
        code: "parent-review-rejected",
      },
    });
    const redispatched = await (runtime.execute as any)(
      "run",
      { request: phaseAttempt(request) },
      context(fixture.root),
    );

    expect(delivered).toMatchObject({
      kind: "candidate",
      requestId: "approved-task-4.1:red:discard",
      resultId: fixture.resultId,
    });
    expect(discarded).toEqual({
      kind: "retry",
      taskId: TASK_ID,
      requestId: "approved-task-4.1:discard:0",
      phase: "red",
      scope: "worker",
      cause: "artifact",
      remainingAttempts: 1,
    });
    expect(redispatched).toMatchObject({
      kind: "candidate",
      taskId: TASK_ID,
      requestId: "approved-task-4.1:red:discard",
      phase: "red",
    });
    expect(dispatch).toHaveBeenCalledTimes(2);
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
    expectImplementOutcome(
      result,
      {
        kind: "blocked",
        taskId: TASK_ID,
        requestId: RED_REQUEST_ID,
        phase: "red",
        failure: { kind: "attempts-exhausted", cause: "transport" },
      },
      [/openai|gpt-secret|alice|compat-extension-secret|sk-live-secret/i],
    );
  });

  it("returns failed child usage on a bounded retry outcome", async () => {
    const runtime = activeRuntime();
    vi.spyOn(runtime as any, "dispatchChild").mockResolvedValueOnce({
      ok: false,
      error: "invalid candidate",
      failure: { kind: "artifact", code: "red-not-witnessed" },
      failureKind: "failed",
      usage: firstUsage,
    });

    const result = await (runtime.execute as any)(
      "run",
      { request: phaseRequest({ requestId: RED_REQUEST_ID }) },
      context(),
    );

    expect(result).toMatchObject({
      kind: "retry",
      taskId: TASK_ID,
      requestId: RED_REQUEST_ID,
      phase: "red",
      cause: "artifact",
      usage: firstUsage,
    });
  });

  it("aggregates both transport launches into one successful outcome usage", async () => {
    const runtime = activeRuntime();
    const fixture = retainedImplementFixture(
      runtime,
      "approved-task-4.1:red:usage-success",
    );
    vi.spyOn(runtime as any, "dispatchChild")
      .mockResolvedValueOnce({
        ok: false,
        error: "first transport failed",
        failure: { kind: "transport", code: "transport-failure" },
        failureKind: "failed",
        usage: firstUsage,
      })
      .mockImplementationOnce(async (_agent, envelope, ctx: any) => ({
        ...candidateDispatch(runtime, envelope, ctx.cwd, fixture.resultId),
        usage: secondUsage,
      }));

    const result = await (runtime.execute as any)(
      "run",
      { request: fixture.request },
      context(fixture.root),
    );

    expect(result).toMatchObject({
      kind: "candidate",
      requestId: fixture.request.attempt.requestId,
      usage: combinedUsage,
    });
  });

  it("aggregates both failed transport launches into one blocked outcome usage", async () => {
    const runtime = activeRuntime();
    vi.spyOn(runtime as any, "dispatchChild")
      .mockResolvedValueOnce({
        ok: false,
        error: "first transport failed",
        failure: { kind: "transport", code: "transport-failure" },
        failureKind: "failed",
        usage: firstUsage,
      })
      .mockResolvedValueOnce({
        ok: false,
        error: "second transport failed",
        failure: { kind: "transport", code: "transport-failure" },
        failureKind: "failed",
        usage: secondUsage,
      });

    const result = await (runtime.execute as any)(
      "run",
      { request: phaseRequest({ requestId: RED_REQUEST_ID }) },
      context(),
    );

    expect(result).toMatchObject({
      kind: "blocked",
      taskId: TASK_ID,
      requestId: RED_REQUEST_ID,
      failure: { kind: "attempts-exhausted", cause: "transport" },
      usage: combinedUsage,
    });
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
    expectImplementOutcome(result, {
      kind: "blocked",
      taskId: TASK_ID,
      requestId,
      phase: "red",
      failure: { kind: "attempts-exhausted", cause: "transport" },
    });
  });

  it("propagates an impossible unavailable parent Provider invariant unchanged", async () => {
    const bridge = new ParentPayloadBridge();
    const internalError = new Error("parent Provider is unavailable");
    const capture = {
      generation: 1,
      sessionId: "impossible-provider",
      modelKey: {
        provider: "test-provider",
        id: "test-model",
        api: "faux",
        baseUrl: "",
      },
      get delegate(): never {
        throw internalError;
      },
      onPayload: (payload: unknown) => payload,
    };
    vi.spyOn(bridge, "capture").mockReturnValue(capture as never);
    const activation = new Activation();
    activation.request();
    activation.activate();
    const runtime = new Runtime({ activation, parentPayloadBridge: bridge });
    const ctx = context() as ReturnType<typeof context> & {
      modelRegistry: Record<string, unknown>;
    };
    ctx.modelRegistry = {
      getApiKeyAndHeaders: vi.fn().mockResolvedValue({
        ok: true,
        apiKey: "phase-key",
        headers: {},
        env: {},
      }),
    };
    const envelope = {
      stage: "abel-implement",
      role: "implementation-worker",
      taskId: TASK_ID,
      id: RED_REQUEST_ID,
      phase: "red",
      objective: "Exercise the phase runtime boundary",
      roots: ["."],
      context: { agents: "none", contract: "approved" },
      declared: {
        read: ["src/runtime.ts"],
        write: ["src/runtime.ts"],
        conflicts: [],
        resources: [],
      },
      output: "diff",
    };

    await expect(
      (runtime as any).dispatchChild(
        { role: "implementation-worker", content: "bounded fixture" },
        envelope,
        ctx,
        new AbortController().signal,
      ),
    ).rejects.toBe(internalError);
    expect(runtime.results.size).toBe(0);
  });

  it("propagates an authentication implementation exception unchanged", async () => {
    const internalError = new TypeError("registry invariant");
    const runtime = activeRuntime();
    const ctx = context() as ReturnType<typeof context> & {
      modelRegistry: Record<string, unknown>;
    };
    ctx.modelRegistry = {
      getApiKeyAndHeaders: vi.fn().mockRejectedValue(internalError),
    };

    await expect(
      (runtime as any).dispatchChild(
        { role: "implementation-worker", content: "bounded fixture" },
        phaseChildEnvelope(),
        ctx,
        new AbortController().signal,
      ),
    ).rejects.toBe(internalError);
  });

  it("propagates a phase ModelRuntime creation exception unchanged", async () => {
    const internalError = new Error("phase runtime invariant");
    const bridge = new ParentPayloadBridge();
    const capture = {
      generation: 1,
      sessionId: "runtime-create-failure",
      modelKey: {
        provider: "test-provider",
        id: "test-model",
        api: "faux",
        baseUrl: "",
      },
      delegate: {} as never,
      onPayload: (payload: unknown) => payload,
    };
    vi.spyOn(bridge, "capture").mockReturnValue(capture as never);
    const activation = new Activation();
    activation.request();
    activation.activate();
    const runtime = new Runtime({ activation, parentPayloadBridge: bridge });
    const ctx = context() as ReturnType<typeof context> & {
      modelRegistry: Record<string, unknown>;
    };
    ctx.modelRegistry = {
      getApiKeyAndHeaders: vi.fn().mockResolvedValue({
        ok: true,
        apiKey: "phase-key",
        headers: {},
        env: {},
      }),
    };
    const create = vi
      .spyOn(ModelRuntime, "create")
      .mockRejectedValueOnce(internalError);
    try {
      await expect(
        (runtime as any).dispatchChild(
          { role: "implementation-worker", content: "bounded fixture" },
          phaseChildEnvelope(),
          ctx,
          new AbortController().signal,
        ),
      ).rejects.toBe(internalError);
    } finally {
      create.mockRestore();
    }
  });

  it("propagates a bridge implementation exception even when its message matches a known failure", async () => {
    const internalError = new Error("parent payload bridge is unavailable");
    const bridge = {
      capture(): never {
        throw internalError;
      },
      clear() {},
    };
    const activation = new Activation();
    activation.request();
    activation.activate();
    const runtime = new Runtime({
      activation,
      parentPayloadBridge: bridge as unknown as ParentPayloadBridge,
    });
    const ctx = context() as ReturnType<typeof context> & {
      modelRegistry: Record<string, unknown>;
    };
    ctx.modelRegistry = {
      getApiKeyAndHeaders: vi.fn().mockResolvedValue({
        ok: true,
        apiKey: "fresh-child-key",
        headers: {},
        env: {},
      }),
    };

    await expect(
      (runtime.execute as any)(
        "run",
        { request: phaseRequest({ requestId: RED_REQUEST_ID }) },
        ctx,
      ),
    ).rejects.toThrow(internalError.message);
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
      .mockImplementationOnce(async (_agent, envelope, ctx: any) =>
        candidateDispatch(runtime, envelope, ctx.cwd),
      );
    const initial = phaseRequest({ requestId: RED_REQUEST_ID });

    const rejected = await (runtime.execute as any)(
      "run",
      { request: initial },
      context(),
    );

    expectImplementOutcome(
      rejected,
      {
        kind: "retry",
        taskId: TASK_ID,
        requestId: RED_REQUEST_ID,
        phase: "red",
        scope: "worker",
        cause: "artifact",
        remainingAttempts: 1,
      },
      [/leaked-provider-secret/i],
    );
    expect(dispatch).toHaveBeenCalledTimes(1);

    const correction = phaseAttempt(initial, {
      requestId: "approved-task-4.1:red:artifact-correction",
      snapshot: {
        "src/runtime.ts": {
          kind: "file",
          sha256: "b".repeat(64),
          bytes: 1,
        },
      },
    });
    const corrected = await (runtime.execute as any)(
      "run",
      { request: correction },
      context(),
    );

    expect(corrected).toMatchObject({
      kind: "candidate",
      taskId: TASK_ID,
      requestId: "approved-task-4.1:red:artifact-correction",
      phase: "red",
    });
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls[1]?.[4]).toBe("candidate:invalid-diff");
  });

  it("throws when an open-task model is unavailable without registering or launching", async () => {
    const runtime = activeRuntime();
    const requestId = "approved-task-4.1:red:environment";
    const dispatch = vi.spyOn(runtime as any, "dispatchChild");

    await expect(
      (runtime.execute as any)(
        "run",
        { request: phaseRequest({ requestId }) },
        context(process.cwd(), false),
      ),
    ).rejects.toThrow(/model.*unavailable/i);

    expect(dispatch).not.toHaveBeenCalled();
    expect((runtime as any).registry.values()).toHaveLength(0);
  });

  it("terminally blocks environment preparation failure after child delivery", async () => {
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
      requestId: "approved-task-4.1:red:post-child-environment",
    });
    const retry = phaseAttempt(request);

    const first = await (runtime.execute as any)("run", { request }, context());
    const replay = await (runtime.execute as any)(
      "run",
      { request: retry },
      context(),
    );

    expectImplementOutcome(first, {
      kind: "blocked",
      taskId: TASK_ID,
      requestId: request.attempt.requestId,
      phase: "red",
      failure: { kind: "environment", code: "root-unavailable" },
    });
    expectImplementOutcome(replay, {
      kind: "blocked",
      taskId: TASK_ID,
      requestId: request.attempt.requestId,
      phase: "red",
      failure: { kind: "environment", code: "root-unavailable" },
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
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
    const requestId = "approved-task-4.1:red:artifact";
    const request = phaseRequest({
      requestId,
      read: [fixture.target],
      write: [fixture.target],
    });
    request.attempt.snapshot =
      fixture.snapshot as unknown as typeof request.attempt.snapshot;

    const delivered = await (runtime.execute as any)(
      "run",
      { request },
      context(fixture.root),
    );
    const rejected = await (runtime.execute as any)(
      "apply",
      {
        resultId: fixture.resultId,
        requestId: `${requestId}:apply:0`,
      },
      context(fixture.root),
    );

    expect(delivered).toMatchObject({
      kind: "candidate",
      taskId: TASK_ID,
      requestId,
      phase: "red",
      resultId: fixture.resultId,
    });
    expectImplementOutcome(
      rejected,
      {
        kind: "retry",
        taskId: TASK_ID,
        requestId: `${requestId}:apply:0`,
        phase: "red",
        scope: "worker",
        cause: "artifact",
        remainingAttempts: 1,
      },
      [/private-provider-token|actual-private|expected-private/i],
    );
    expect(runtime.results.get(fixture.resultId)).toBeUndefined();
  });

  it("routes a passing Red candidate to bounded artifact correction", () => {
    const runtime = activeRuntime();
    const request = phaseRequest({ requestId: RED_REQUEST_ID });
    const worker = (runtime as any).registry.open(
      request.boundary,
      workerIdentity({
        provider: "test-provider",
        id: "test-model",
        name: "test-model",
      }),
      process.cwd(),
      request.attempt,
    );
    worker.state = {
      kind: "candidate-pending",
      phase: "red",
      launchIndex: 0,
      originRequestId: RED_REQUEST_ID,
      resultId: "fixture-result",
    };
    const resultId = runtime.results.retain({
      diff: "--- a/src/runtime.ts\n+++ b/src/runtime.ts\n@@ -1 +1 @@\n-old\n+new\n",
      writeSet: ["src/runtime.ts"],
      root: process.cwd(),
    });
    const retained = runtime.results.bindIdentity(resultId, {
      stage: "abel-implement",
      canonicalRoot: process.cwd(),
      root: process.cwd(),
      changeId: request.boundary.changeId,
      taskId: TASK_ID,
      originRequestId: RED_REQUEST_ID,
      phase: "red",
      launchIndex: 0,
    });

    const result = (runtime as any).presentApplyFailure(
      RED_REQUEST_ID,
      resultId,
      retained,
      worker,
      { kind: "artifact", code: "red-not-witnessed" },
    );

    expectImplementOutcome(result, {
      kind: "retry",
      taskId: TASK_ID,
      requestId: RED_REQUEST_ID,
      phase: "red",
      scope: "worker",
      cause: "artifact",
      remainingAttempts: 1,
    });
    expect(runtime.results.get(resultId)).toBeUndefined();
    expect(worker.state).toEqual({
      kind: "ready",
      phase: "red",
      launchIndex: 1,
      correction: { kind: "artifact", code: "red-not-witnessed" },
    });
  });

  it("preserves preflight stale classification for one snapshot-only redispatch", async () => {
    const runtime = activeRuntime();
    const fixture = artifactFixture(runtime);
    const dispatch = vi
      .spyOn(runtime as any, "dispatchChild")
      .mockImplementationOnce(async (_agent, envelope, ctx: any) =>
        candidateDispatch(runtime, envelope, ctx.cwd, fixture.resultId),
      )
      .mockImplementation(async (_agent, envelope, ctx: any) =>
        candidateDispatch(runtime, envelope, ctx.cwd),
      );
    const requestId = "approved-task-4.1:red:preflight-stale";
    const initial = phaseRequest({
      requestId,
      read: [fixture.target],
      write: [fixture.target],
    });
    initial.attempt.snapshot =
      fixture.snapshot as unknown as typeof initial.attempt.snapshot;

    const delivered = await (runtime.execute as any)(
      "run",
      { request: initial },
      context(fixture.root),
    );
    const stale = (runtime as any).presentApplyFailure(
      requestId,
      fixture.resultId,
      runtime.results.get(fixture.resultId),
      taskRecord(runtime),
      { kind: "stale", code: "stale-snapshot" },
    );
    const refreshed = phaseAttempt(initial, {
      snapshot: {
        [fixture.target]: {
          kind: "file",
          sha256: "b".repeat(64),
          bytes: 1,
        },
      },
    });
    const redispatched = await (runtime.execute as any)(
      "run",
      { request: refreshed },
      context(fixture.root),
    );

    expect(delivered).toMatchObject({
      kind: "candidate",
      taskId: TASK_ID,
      requestId,
      phase: "red",
      resultId: fixture.resultId,
    });
    expectImplementOutcome(stale, {
      kind: "retry",
      taskId: TASK_ID,
      requestId,
      phase: "red",
      scope: "worker",
      cause: "stale",
      remainingAttempts: 1,
    });
    expect(runtime.results.get(fixture.resultId)).toBeUndefined();
    expect(redispatched).toMatchObject({
      kind: "candidate",
      taskId: TASK_ID,
      requestId,
      phase: "red",
    });
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
    const requestId = "approved-task-4.1:red:transport-then-artifact";
    const initial = phaseRequest({
      requestId,
      read: [fixture.target],
      write: [fixture.target],
    });
    initial.attempt.snapshot =
      fixture.snapshot as unknown as typeof initial.attempt.snapshot;

    const delivered = await (runtime.execute as any)(
      "run",
      { request: initial },
      context(fixture.root),
    );
    const rejected = await (runtime.execute as any)(
      "apply",
      {
        resultId: fixture.resultId,
        requestId: `${requestId}:apply:0`,
      },
      context(fixture.root),
    );
    const correctionRequestId = "approved-task-4.1:red:artifact-correction";
    const correction = await (runtime.execute as any)(
      "run",
      {
        request: phaseAttempt(initial, {
          requestId: correctionRequestId,
        }),
      },
      context(fixture.root),
    );

    expect(delivered).toMatchObject({
      kind: "candidate",
      taskId: TASK_ID,
      requestId,
      phase: "red",
      resultId: fixture.resultId,
    });
    expect(dispatch).toHaveBeenCalledTimes(2);
    expectImplementOutcome(
      rejected,
      {
        kind: "blocked",
        taskId: TASK_ID,
        requestId: `${requestId}:apply:0`,
        phase: "red",
        failure: { kind: "attempts-exhausted", cause: "artifact" },
      },
      [/transport-secret|private-provider-token|expected-private/i],
    );
    expectImplementOutcome(correction, {
      kind: "blocked",
      taskId: TASK_ID,
      requestId: correctionRequestId,
      phase: "red",
      failure: { kind: "attempts-exhausted", cause: "artifact" },
    });
  });
});

describe("[SLICE-3:terminal-replay] closed task state and replay", () => {
  function mockDeliveredCandidates(runtime: Runtime) {
    return vi
      .spyOn(runtime as any, "dispatchChild")
      .mockImplementation(async (_agent: unknown, envelope: any) => {
        const resultId = runtime.results.retain({
          diff: "--- a/src/runtime.ts\n+++ b/src/runtime.ts\n@@ -1 +1 @@\n-old\n+new\n",
          writeSet: [...envelope.declared.write],
          approvedDependencies: [...(envelope.approvedDependencies ?? [])],
          root: process.cwd(),
          snapshot: structuredClone(envelope.snapshot),
        });
        return {
          ok: true,
          action: "run",
          result: { kind: "diff" },
          resultId,
        };
      });
  }

  function mockSuccessfulApply(runtime: Runtime) {
    return vi.spyOn(runtime as any, "enqueueParentApply").mockResolvedValue({
      ok: true,
      result: {
        targets: ["src/runtime.ts"],
        checkExitCode: 0,
        applyExitCode: 0,
      },
    });
  }

  async function applyDelivered(
    runtime: Runtime,
    delivered: { resultId?: string },
    requestId: string,
  ) {
    expect(delivered.resultId).toEqual(expect.any(String));
    return (runtime.execute as any)(
      "apply",
      { resultId: delivered.resultId, requestId },
      context(),
    );
  }

  it("advances only from Runtime-owned apply facts through Refactor and replays completion", async () => {
    const runtime = activeRuntime();
    const dispatch = mockDeliveredCandidates(runtime);
    const apply = mockSuccessfulApply(runtime);
    const initial = phaseRequest({
      requestId: RED_REQUEST_ID,
      phase: "refactor",
    });
    initial.attempt.phase = "red";

    const red = await (runtime.execute as any)(
      "run",
      { request: initial },
      context(),
    );
    const redApplied = await applyDelivered(
      runtime,
      red,
      "approved-task-4.1:red:apply",
    );
    expect(redApplied).toMatchObject({
      kind: "applied",
      taskId: TASK_ID,
      requestId: "approved-task-4.1:red:apply",
      phase: "red",
      readyPhase: "green",
    });
    expect.soft(taskRecord(runtime).state).toMatchObject({
      kind: "ready",
      phase: "green",
      launchIndex: 0,
    });

    const greenRequest = phaseAttempt(initial, {
      requestId: GREEN_REQUEST_ID,
      phase: "green",
    });
    const green = await (runtime.execute as any)(
      "run",
      { request: greenRequest },
      context(),
    );
    const greenApplied = await applyDelivered(
      runtime,
      green,
      "approved-task-4.1:green:apply",
    );
    expect(greenApplied).toMatchObject({
      kind: "applied",
      taskId: TASK_ID,
      requestId: "approved-task-4.1:green:apply",
      phase: "green",
      readyPhase: "refactor",
    });
    expect.soft(taskRecord(runtime).state).toMatchObject({
      kind: "ready",
      phase: "refactor",
      launchIndex: 0,
    });

    const refactorRequest = phaseAttempt(initial, {
      requestId: "approved-task-4.1:refactor:0",
      phase: "refactor",
    });
    const refactor = await (runtime.execute as any)(
      "run",
      { request: refactorRequest },
      context(),
    );
    const completed = await applyDelivered(
      runtime,
      refactor,
      "approved-task-4.1:refactor:apply",
    );
    expect(completed).toMatchObject({
      kind: "completed",
      taskId: TASK_ID,
      requestId: "approved-task-4.1:refactor:apply",
      finalPhase: "refactor",
    });
    expect.soft(taskRecord(runtime).state).toMatchObject({
      kind: "completed",
      finalPhase: "refactor",
    });

    const replayRequestId = "approved-task-4.1:refactor:replay";
    const replay = await (runtime.execute as any)(
      "run",
      {
        request: phaseAttempt(initial, {
          requestId: replayRequestId,
          phase: "refactor",
          snapshot: {
            "src/runtime.ts": {
              kind: "file",
              sha256: "b".repeat(64),
              bytes: 99,
            },
          },
        }),
      },
      context(),
    );
    expect(replay).toMatchObject({
      kind: "completed",
      taskId: TASK_ID,
      requestId: replayRequestId,
      finalPhase: "refactor",
    });
    await expect(
      (runtime.execute as any)(
        "run",
        {
          request: phaseAttempt(initial, {
            requestId: "approved-task-4.1:green:wrong-terminal-phase",
            phase: "green",
          }),
        },
        context(),
      ),
    ).rejects.toThrow(/phase|terminal/i);
    expect(dispatch).toHaveBeenCalledTimes(3);
    expect(apply).toHaveBeenCalledTimes(3);
  });

  it("keeps a final applied phase checkpoint-pending when AGENTS impact is declared", async () => {
    const runtime = activeRuntime();
    const dispatch = mockDeliveredCandidates(runtime);
    const apply = mockSuccessfulApply(runtime);
    const initial = phaseRequest({ requestId: RED_REQUEST_ID });
    (initial.boundary as any).agents = {
      impact: "update-existing",
      target: "AGENTS.md",
      managedOnly: true,
    };

    const red = await (runtime.execute as any)(
      "run",
      { request: initial },
      context(),
    );
    await applyDelivered(runtime, red, "approved-task-4.1:red:agents-apply");
    const green = await (runtime.execute as any)(
      "run",
      {
        request: phaseAttempt(initial, {
          requestId: GREEN_REQUEST_ID,
          phase: "green",
        }),
      },
      context(),
    );
    const checkpointRequired = await applyDelivered(
      runtime,
      green,
      "approved-task-4.1:green:agents-apply",
    );

    expect(checkpointRequired).toMatchObject({
      kind: "checkpoint-required",
      taskId: TASK_ID,
      requestId: "approved-task-4.1:green:agents-apply",
      finalPhase: "green",
    });

    expect(taskRecord(runtime).state).toMatchObject({
      kind: "agents-checkpoint-pending",
      finalPhase: "green",
      attemptIndex: 0,
    });
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      "environment",
      { kind: "environment", code: "sandbox-runtime-unavailable" },
    ],
    [
      "approval-boundary",
      {
        kind: "approval-boundary",
        code: "verification-contract-insufficient",
      },
    ],
    ["result-limit", { kind: "result-limit", limitBytes: 64 * 1024 }],
  ] as const)(
    "terminally blocks typed %s and replays the exact failure without work",
    async (_name, failure) => {
      const runtime = activeRuntime();
      const dispatch = vi
        .spyOn(runtime as any, "dispatchChild")
        .mockResolvedValue({
          ok: false,
          error: "sanitized typed task failure",
          failure,
          failureKind: "failed",
        });
      const apply = vi.spyOn(runtime as any, "enqueueParentApply");
      const initial = phaseRequest({ requestId: RED_REQUEST_ID });

      const blocked = await (runtime.execute as any)(
        "run",
        { request: initial },
        context(),
      );
      expect.soft(blocked).toMatchObject({
        kind: "blocked",
        taskId: TASK_ID,
        requestId: RED_REQUEST_ID,
        phase: "red",
        failure,
      });
      expect.soft(taskRecord(runtime).state).toMatchObject({
        kind: "blocked",
        phase: "red",
        failure,
      });
      expect.soft(dispatch).toHaveBeenCalledTimes(1);

      const replayRequestId = `approved-task-4.1:red:${failure.kind}:replay`;
      const replay = await (runtime.execute as any)(
        "run",
        {
          request: phaseAttempt(initial, {
            requestId: replayRequestId,
            snapshot: {
              "src/runtime.ts": {
                kind: "file",
                sha256: "c".repeat(64),
                bytes: 123,
              },
            },
          }),
        },
        context(),
      );
      expect.soft(replay).toMatchObject({
        kind: "blocked",
        taskId: TASK_ID,
        requestId: replayRequestId,
        phase: "red",
        failure,
      });

      await expect(
        (runtime.execute as any)(
          "run",
          {
            request: phaseAttempt(initial, {
              requestId: `approved-task-4.1:green:${failure.kind}:wrong`,
              phase: "green",
            }),
          },
          context(),
        ),
      ).rejects.toThrow(/phase|terminal/i);
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(apply).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["artifact", { kind: "artifact", code: "invalid-diff" }],
    ["stale", { kind: "stale", code: "stale-snapshot" }],
    ["transport", { kind: "transport", code: "transport-failure" }],
  ] as const)(
    "shares exactly two non-cancelled launches when %s fails first",
    async (_name, firstFailure) => {
      const runtime = activeRuntime();
      const secondFailure = {
        kind: "transport",
        code: "transport-failure",
      } as const;
      const dispatch = vi
        .spyOn(runtime as any, "dispatchChild")
        .mockResolvedValueOnce({
          ok: false,
          error: "sanitized first failure",
          failure: firstFailure as ChildFailure,
          failureKind: "failed",
        })
        .mockResolvedValueOnce({
          ok: false,
          error: "sanitized second failure",
          failure: secondFailure,
          failureKind: "failed",
        })
        .mockResolvedValue({
          ok: true,
          action: "run",
          result: { kind: "diff" },
        });
      const initial = phaseRequest({ requestId: RED_REQUEST_ID });

      const first = await (runtime.execute as any)(
        "run",
        { request: initial },
        context(),
      );
      let stopped = first;
      if (firstFailure.kind !== "transport") {
        expect.soft(first).toMatchObject({
          kind: "retry",
          taskId: TASK_ID,
          requestId: RED_REQUEST_ID,
          phase: "red",
          scope: "worker",
          cause: firstFailure.kind,
          remainingAttempts: 1,
        });
        expect.soft(dispatch).toHaveBeenCalledTimes(1);
        stopped = await (runtime.execute as any)(
          "run",
          {
            request: phaseAttempt(initial, {
              requestId:
                firstFailure.kind === "artifact"
                  ? "approved-task-4.1:red:artifact-correction"
                  : RED_REQUEST_ID,
              snapshot: {
                "src/runtime.ts": {
                  kind: "file",
                  sha256: "d".repeat(64),
                  bytes: 1,
                },
              },
            }),
          },
          context(),
        );
      }

      expect.soft(stopped).toMatchObject({
        kind: "blocked",
        taskId: TASK_ID,
        phase: "red",
        failure: { kind: "attempts-exhausted", cause: "transport" },
      });
      expect.soft(taskRecord(runtime).state).toMatchObject({ kind: "blocked" });
      expect(dispatch).toHaveBeenCalledTimes(2);

      await (runtime.execute as any)(
        "run",
        {
          request: phaseAttempt(initial, {
            requestId: `approved-task-4.1:red:${firstFailure.kind}:terminal-replay`,
          }),
        },
        context(),
      );
      expect(dispatch).toHaveBeenCalledTimes(2);
    },
  );
});
