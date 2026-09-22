import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { PlanTaskDraft } from "../src/delivery-compiler.ts";
import { recoveryKey, type EngineTaskRow, type EngineRunRow } from "../src/workflow-policy.ts";
import { RunStore } from "../src/run-store.ts";
import { resolveStateRoot } from "../src/state-root.ts";

const RED_IDENTITY = "[CADENCE-V2:T6-workflow-engine]";
const roots: string[] = [];
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

type ModuleRecord = Record<string, unknown>;
type EngineOutcome = Record<string, unknown>;

interface EngineApi {
  amend(change: string, batchId: string, request: unknown, execute: (assertAuthority: () => void) => Promise<Record<string, unknown>>): Promise<Record<string, unknown>>;
  execute(command: unknown, signal?: AbortSignal): Promise<EngineOutcome>;
  prepareBootstrapHandoff(
    input: Record<string, unknown>,
  ): EngineOutcome;
  inspectBootstrapHandoff(receiptHash: string): EngineOutcome;
  close(): void | Promise<void>;
}

interface EngineConstructor {
  open(options: Record<string, unknown>): EngineApi;
}

let workflowEngineModule: ModuleRecord | null = null;

beforeAll(async () => {
  try {
    workflowEngineModule = (await import(
      "../src/workflow-engine.ts"
    )) as ModuleRecord;
  } catch {
    workflowEngineModule = null;
  }
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function temporaryRoot(label: string): string {
  const root = mkdtempSync(path.join(tmpdir(), `cadence-v2-t6-${label}-`));
  roots.push(root);
  return root;
}

function requiredEngine(): EngineConstructor {
  expect(
    workflowEngineModule,
    `${RED_IDENTITY}: workflow-engine module must exist`,
  ).not.toBeNull();
  const constructor = workflowEngineModule?.WorkflowEngine;
  expect(
    constructor,
    `${RED_IDENTITY}: WorkflowEngine must be exported`,
  ).toBeTypeOf("function");
  expect(
    (constructor as Partial<EngineConstructor>).open,
    `${RED_IDENTITY}: WorkflowEngine.open must be exported`,
  ).toBeTypeOf("function");
  return constructor as unknown as EngineConstructor;
}

function verification(id: string, expected: "expected-red" | "expected-green") {
  return {
    kind: "vitest",
    id,
    runner: {
      kind: "package-script",
      packageManager: "bun",
      script: "test:target",
      command: "vitest run",
    },
    testFiles: ["test/fixture.test.ts"],
    args: [] as string[],
    minTests: 1,
    classification: expected,
    ...(expected === "expected-red"
      ? { expectedFailure: "fixture-red-witness" }
      : {}),
  };
}

function task(
  taskId: string,
  options: {
    dependsOn?: string[];
    write?: string;
    resource?: string;
    verificationLock?: string;
  } = {},
) {
  const write = options.write ?? `${taskId}.txt`;
  const phase = (name: "red" | "green") => ({
    read: ["package.json", "test/fixture.test.ts"],
    write: [write],
    delete: [],
    verification: verification(
      `${taskId}-${name}`,
      name === "red" ? "expected-red" : "expected-green",
    ),
    verificationInputs: [{ kind: "workspace", path: "package.json" }],
    verificationLock: options.verificationLock ?? "vitest-cadence-v2",
  });
  return {
    taskId,
    dependsOn: options.dependsOn ?? [],
    objective: `Complete ${taskId}`,
    context: {
      agents: "root AGENTS applies",
      contract: `approved ${taskId} boundary`,
    },
    roots: ["."],
    phases: { red: phase("red"), green: phase("green") },
    scheduling: {
      conflicts: [],
      resources: options.resource ? [options.resource] : [],
    },
    agents: { impact: "none", managedOnly: true },
    approvedDependencies: [],
    impactClosure: {
      changedSurfaces: ["none"],
      searchEvidence: [],
      relatedTests: [
        {
          path: "test/fixture.test.ts",
          disposition: "current-task",
          evidence: `${taskId} fixture`,
        },
      ],
      affectedSuite: ["test/fixture.test.ts"],
    },
  };
}

function plan(change: string, tasks: ReturnType<typeof task>[]) {
  return {
    changeId: change,
    tasks,
    outputs: [],
    verification: { artifactCorrection: { maxAttempts: 2 } },
  };
}

function makeConsumer(label: string): string {
  const root = temporaryRoot(`consumer-${label}`);
  mkdirSync(path.join(root, "test"), { recursive: true });
  writeFileSync(
    path.join(root, "package.json"),
    `${JSON.stringify({ scripts: { "test:target": "vitest run" } })}\n`,
  );
  writeFileSync(path.join(root, "test/fixture.test.ts"), "export {};\n");
  writeFileSync(path.join(root, "sentinel.txt"), "main-workspace\n");
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  return root;
}

function command(
  name: "start" | "status" | "resume" | "rebind" | "cancel" | "discard",
  change: string,
  extra: Record<string, unknown> = {},
) {
  return {
    command: name,
    stage: "abel-implement",
    change,
    ...(name === "status" ? {} : { operationId: `${name}-operation` }),
    ...extra,
  };
}

class DeliverySource {
  calls = 0;
  unavailable = false;
  revision = 1;
  available: { deliveryRevision: number; receiptHash: string } | undefined;
  async discoverLatest() { return this.available; }
  readonly #plans = new Map<string, ReturnType<typeof plan>>();

  set(change: string, value: ReturnType<typeof plan>): void {
    this.#plans.set(change, value);
  }

  async load(input: Record<string, unknown>) {
    this.calls += 1;
    if (this.unavailable) throw new Error("delivery-source-must-not-run");
    const change = String(input.change);
    const value = this.#plans.get(change);
    if (!value) throw new Error("fixture-delivery-missing");
    const revision = Number(input.deliveryRevision ?? this.revision);
    const receiptHash = String(
      input.receiptHash ?? (revision === 1 ? HASH_A : HASH_B),
    );
    return {
      gate: "gate-b",
      revision,
      receiptHash,
      plan: structuredClone(value),
    };
  }
}

type AttemptOutcome =
  | {
      kind: "phase-committed";
      artifactHash: string;
      isolatedRevisionId: string;
      exitCode: number;
      classification: "expected-red" | "expected-green";
    }
  | {
      kind: "paused" | "retryable" | "approval-needed";
      code: string;
      untrustedCandidate?: Uint8Array;
      retryPolicy?: "artifact" | "stale" | "verification" | "checkpoint";
      attemptDiagnostic?: {
        finalCategory?: string;
        submitAttempts?: number;
        schema?: string;
        identityMismatch?: string[];
      };
      contextRequest?: {
        code:
          | "approved-context-needed"
          | "task-split-needed"
          | "boundary-review-needed";
        refs: Array<
          | string
          | { kind: "requested-path"; path: string; access: "read" | "write" }
          | { kind: "source-citation"; path: string; line: number }
          | { kind: "contract-diagnostic"; ref: string }
        >;
      };
    }
  | { kind: "operation-cancelled"; code: "cancelled" };

function committed(phase: string): AttemptOutcome {
  return {
    kind: "phase-committed",
    artifactHash: HASH_A,
    isolatedRevisionId: HASH_B,
    exitCode: phase === "red" ? 1 : 0,
    classification: phase === "red" ? "expected-red" : "expected-green",
  };
}

class ScriptedWorker {
  readonly calls: string[] = [];
  readonly rebinds: string[] = [];
  readonly artifactCorrections: unknown[] = [];
  readonly contextRequests: Array<unknown | undefined> = [];
  readonly recoveryFeedback: unknown[] = [];
  readonly #script = new Map<string, AttemptOutcome[]>();
  unavailable = false;
  #waitingKey: string | undefined;
  #startedResolve: (() => void) | undefined;
  started: Promise<void> = Promise.resolve();

  script(key: string, outcomes: AttemptOutcome[]): void {
    this.#script.set(key, [...outcomes]);
  }

  waitOn(key: string): void {
    this.#waitingKey = key;
    this.started = new Promise((resolve) => {
      this.#startedResolve = resolve;
    });
  }

  async runAttempt(input: Record<string, unknown>): Promise<AttemptOutcome> {
    this.recoveryFeedback.push(input.recoveryFeedback);
    if (this.unavailable) throw new Error("worker-must-not-run");
    this.contextRequests.push(
      input.contextRequest === undefined
        ? undefined
        : structuredClone(input.contextRequest),
    );
    if (input.artifactCorrection) {
      this.artifactCorrections.push(structuredClone(input.artifactCorrection));
    }
    const key = `${String(input.taskId)}:${String(input.phase)}`;
    this.calls.push(
      `${key}:r${String(input.deliveryRevision)}:${String(input.routeId ?? "policy")}`,
    );
    if (key === this.#waitingKey) {
      this.#startedResolve?.();
      const signal = input.signal as AbortSignal;
      return new Promise((resolve) => {
        const cancelled = () =>
          resolve({ kind: "operation-cancelled", code: "cancelled" });
        if (signal.aborted) cancelled();
        else signal.addEventListener("abort", cancelled, { once: true });
      });
    }
    const scripted = this.#script.get(key)?.shift();
    return scripted ?? committed(String(input.phase));
  }

  rebind(input: Record<string, unknown>) {
    this.rebinds.push(`${String(input.runId)}:${String(input.routeId)}`);
    return { ok: true, routeId: String(input.routeId) };
  }
}

class PausingVerifier {
  calls = 0;

  async verify() {
    this.calls += 1;
    return { kind: "paused", code: "full-verification-held" };
  }
}

class PassingVerifier {
  async verify() {
    return { kind: "verified", verificationId: "change-suite" };
  }
}

class RecoveringApplication {
  readonly events: string[] = [];
  readonly started: Promise<void>;
  #startedResolve!: () => void;
  #settleApply!: (value: Record<string, unknown>) => void;
  #intent: "cancel" | "discard" | undefined;

  constructor() {
    this.started = new Promise((resolve) => {
      this.#startedResolve = resolve;
    });
  }

  async begin(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.events.push(`begin:${String(input.transactionId)}`);
    this.#startedResolve();
    return new Promise((resolve) => {
      this.#settleApply = resolve;
    });
  }

  requestControl(transactionId: string, intent: "cancel" | "discard") {
    this.#intent = intent;
    this.events.push(`request:${intent}:${transactionId}`);
    return {
      state: "recovering",
      pendingIntent: intent,
      rollbackRetained: true,
    };
  }

  async recover(transactionId: string) {
    this.events.push(`recover:${transactionId}`);
    const outcome =
      this.#intent === "discard"
        ? { state: "discarded", code: "run-discarded" }
        : { state: "paused", code: "operation-cancelled" };
    this.#settleApply(outcome);
    return outcome;
  }
}

function openEngine(input: {
  consumerRoot: string;
  delivery: DeliverySource;
  worker: ScriptedWorker;
  verifier?: PausingVerifier | PassingVerifier;
  application?: RecoveringApplication;
  xdgStateHome?: string;
  workHardLimit?: number;
}): EngineApi {
  const xdgStateHome = input.xdgStateHome ?? temporaryRoot("state");
  return requiredEngine().open({
    consumerRoot: input.consumerRoot,
    stateRoot: resolveStateRoot({
      consumerRoot: input.consumerRoot,
      xdgStateHome,
      homeDir: temporaryRoot("home"),
    }),
    deliverySource: input.delivery,
    worker: input.worker,
    changeVerifier: input.verifier ?? new PausingVerifier(),
    ...(input.application ? { application: input.application } : {}),
    leaseTtlMs: 10_000,
    workHardLimit: input.workHardLimit,
  });
}

describe("WorkflowEngine command authority", () => {

  it.each([false, true])("recovers thrown storage errors without losing facts (legacy interrupted journal: %s)", async (legacy) => {
    const change = `engine-storage-error-${legacy}`;
    const consumerRoot = makeConsumer(change);
    const xdgStateHome = temporaryRoot(change);
    const delivery = new DeliverySource();
    delivery.set(change, plan(change, [task("paper-download"), ...Array.from({ length: 5 }, (_, i) => task(`remaining-${i}`, { dependsOn: ["paper-download"] }))]));
    class FailingWorker extends ScriptedWorker {
      override async runAttempt(): Promise<AttemptOutcome> {
        throw Object.assign(new Error("EPERM: operation not permitted, fsync"), { code: "EPERM", syscall: "fsync" });
      }
    }
    let engine = openEngine({ consumerRoot, xdgStateHome, delivery, worker: new FailingWorker() });
    await expect(engine.execute(command("start", change, { operationId: "storage-failed-start" }))).rejects.toThrow("EPERM: operation not permitted, fsync");
    const initial = await engine.execute(command("status", change));
    const { DatabaseSync } = await import("node:sqlite");
    const databasePath = resolveStateRoot({ consumerRoot, xdgStateHome }).databasePath;
    const snapshot = () => {
      const db = new DatabaseSync(databasePath);
      try { return Object.fromEntries(["workflow_engine_deliveries", "delivery_bindings", "workflow_work_budget", "workflow_engine_runs", "workflow_recovery_incidents", "workflow_recovery_events", "workflow_recovery_grants"].map(name => [name, db.prepare(`SELECT * FROM ${name}`).all()])); }
      finally { db.close(); }
    };
    const retained = snapshot();
    if (!legacy) {
      expect(initial).toMatchObject({
        state: "paused",
        pause: { code: "operation-interrupted" },
        continuation: {
          owner: "parent",
          automatic: true,
          command: "resume",
          kind: "resume-interrupted-operation",
          reason: "operation-interrupted",
          stage: "abel-implement",
          change,
        },
        tasks: expect.arrayContaining([expect.objectContaining({ taskId: "paper-download", state: "paused", phase: "red" })]),
      });
      expect(initial.legalCommands).toContain("resume");
    }
    await engine.close();
    if (legacy) {
      // Reconstruct exactly the old failure: interrupted operation, active projection/task.
      const { RunStore } = await import("../src/run-store.ts");
      const store = RunStore.open(resolveStateRoot({ consumerRoot, xdgStateHome }));
      if (store.status(String(initial.runId)).state !== "running") store.transition({ runId: String(initial.runId), to: "running", operationId: "legacy-running" });
      store.close();
      const db = new DatabaseSync(databasePath);
      db.prepare("UPDATE workflow_engine_tasks SET state = 'phase-running', pause_code = NULL WHERE task_id = 'paper-download'").run();
      expect(db.prepare("SELECT state FROM workflow_engine_operations WHERE operation_id = 'storage-failed-start'").get()).toMatchObject({ state: "interrupted" });
      db.close();
    }
    const worker = new ScriptedWorker();
    engine = openEngine({ consumerRoot, xdgStateHome, delivery, worker });
    try {
      const recovered = await engine.execute(command("status", change));
      expect(recovered).toMatchObject({
        runId: initial.runId,
        state: "paused",
        pause: { code: "operation-interrupted" },
        continuation: {
          owner: "parent",
          automatic: true,
          command: "resume",
          kind: "resume-interrupted-operation",
          reason: "operation-interrupted",
          stage: "abel-implement",
          change,
        },
        tasks: expect.arrayContaining([expect.objectContaining({ taskId: "paper-download", state: "paused", phase: "red" })]),
      });
      expect(recovered.legalCommands).toContain("resume");
      expect(snapshot()).toEqual(retained);
      expect(retained.workflow_work_budget).toEqual([expect.objectContaining({ used: 1 })]);
      await engine.execute(command("resume", change, { operationId: "storage-recovered-resume" }));
      expect(worker.calls[0]).toMatch(/^paper-download:red:/u);
      expect(worker.calls).toHaveLength(12);
      expect(snapshot().workflow_work_budget).toEqual([expect.objectContaining({ used: 13 })]);
      expect((await engine.execute(command("status", change))).runId).toBe(initial.runId);
    } finally { await engine.close(); }
  });

  it("retains verified tasks and Green checkpoints after a later storage exception", async () => {
    const change = "engine-storage-after-red";
    const consumerRoot = makeConsumer(change);
    const xdgStateHome = temporaryRoot(change);
    const delivery = new DeliverySource();
    delivery.set(change, plan(change, [task("completed-task"), task("interrupted-task", { dependsOn: ["completed-task"] })]));
    class FailingGreen extends ScriptedWorker {
      override async runAttempt(input: Record<string, unknown>): Promise<AttemptOutcome> {
        if (input.taskId === "interrupted-task" && input.phase === "green") throw new Error("EIO: fsync");
        return super.runAttempt(input);
      }
    }
    let engine = openEngine({ consumerRoot, xdgStateHome, delivery, worker: new FailingGreen() });
    try {
      await expect(engine.execute(command("start", change))).rejects.toThrow("EIO");
      expect(await engine.execute(command("status", change))).toMatchObject({
        state: "paused", tasks: [{ taskId: "completed-task", state: "verified" }, { taskId: "interrupted-task", state: "paused", phase: "green" }],
      });
    } finally { await engine.close(); }
    const worker = new ScriptedWorker();
    engine = openEngine({ consumerRoot, xdgStateHome, delivery, worker });
    try {
      await engine.execute(command("resume", change));
      expect(worker.calls).toEqual(["interrupted-task:green:r1:policy"]);
    } finally { await engine.close(); }
  });

  it("recovers an interrupted change verifier even with no phase-running task", async () => {
    const change = "engine-storage-change-verifier";
    const consumerRoot = makeConsumer(change);
    const xdgStateHome = temporaryRoot(change);
    const delivery = new DeliverySource();
    delivery.set(change, plan(change, [task("verified-task")]));
    class FailingVerifier extends PausingVerifier {
      override async verify(): Promise<{ kind: string; code: string }> { throw new Error("EIO: verification evidence"); }
    }
    let engine = openEngine({ consumerRoot, xdgStateHome, delivery, worker: new ScriptedWorker(), verifier: new FailingVerifier() });
    await expect(engine.execute(command("start", change))).rejects.toThrow("EIO");
    const status = await engine.execute(command("status", change));
    expect(status).toMatchObject({ state: "paused", tasks: [{ taskId: "verified-task", state: "verified" }] });
    await engine.close();
    // Legacy exceptions could also strand change verification with all tasks verified.
    const { RunStore } = await import("../src/run-store.ts");
    const store = RunStore.open(resolveStateRoot({ consumerRoot, xdgStateHome }));
    store.transition({ runId: String(status.runId), to: "running", operationId: "legacy-verifier-running" });
    store.transition({ runId: String(status.runId), to: "change-verifying", operationId: "legacy-verifying" });
    store.close();
    const worker = new ScriptedWorker();
    engine = openEngine({ consumerRoot, xdgStateHome, delivery, worker });
    try {
      expect(await engine.execute(command("status", change))).toMatchObject({
        state: "paused",
        pause: { code: "operation-interrupted" },
        continuation: {
          owner: "parent",
          automatic: true,
          command: "resume",
          kind: "resume-interrupted-operation",
          reason: "operation-interrupted",
          stage: "abel-implement",
          change,
        },
      });
      await engine.execute(command("resume", change));
      expect(worker.calls).toEqual([]);
    } finally { await engine.close(); }
  });

  it("waits for restored integrity before admission and discovers the valid revised receipt on resume", async () => {
    const { DeliveryValidationError } = await import("../src/delivery-compiler.ts");
    class InvalidDelivery extends DeliverySource {
      broken = true;
      override async load(input: Record<string, unknown>) {
        if (this.broken) throw new DeliveryValidationError(["artifact-hash-mismatch"]);
        return super.load(input);
      }
    }
    const change = "repair-invalid-admission";
    const consumerRoot = makeConsumer(change);
    const xdgStateHome = temporaryRoot(change);
    const delivery = new InvalidDelivery();
    delivery.available = { deliveryRevision: 1, receiptHash: HASH_A };
    delivery.set(change, plan(change, [task("T1")]));
    const worker = new ScriptedWorker();
    let engine = openEngine({ consumerRoot, xdgStateHome, delivery, worker });
    try {
      const invalid = await engine.execute(command("start", change));
      expect(invalid).toMatchObject({ state: "paused", tasks: [] });
      expect(invalid).not.toHaveProperty("continuation");
      expect(invalid).not.toHaveProperty("decisionBatch");
      expect(worker.calls).toEqual([]);
      expect(invalid.resourceBudget).toBeUndefined();
      await engine.close();
      engine = openEngine({ consumerRoot, xdgStateHome, delivery, worker });
      expect(await engine.execute(command("status", change))).not.toHaveProperty("continuation");
      await expect(engine.amend(change, "unproven", { operation: "finalize-delivery" },
        async () => { throw new Error("integrity failure must not authorize mutation"); })).rejects.toThrow("amendment-batch-stale");
      delivery.broken = false;
      delivery.available = { deliveryRevision: 2, receiptHash: HASH_B };
      const ready = await engine.execute(command("status", change));
      expect(ready).not.toHaveProperty("continuation");
      await engine.execute(command("resume", change));
      expect(worker.calls).toEqual(["T1:red:r2:policy", "T1:green:r2:policy"]);
    } finally { await engine.close(); }
  });

  it("does not automatically amend a cancelled authority wait", async () => {
    const change = "cancel-parent-continuation";
    const consumerRoot = makeConsumer(change);
    const delivery = new DeliverySource();
    delivery.set(change, plan(change, [task("T1")]));
    const worker = new ScriptedWorker();
    worker.script("T1:red", [{ kind: "approval-needed", code: "unapproved-dependency-change" }]);
    const engine = openEngine({ consumerRoot, delivery, worker });
    try {
      const waiting = await engine.execute(command("start", change));
      const cancelled = await engine.execute(command("cancel", change));
      expect(cancelled.continuation).toBeUndefined();
      await expect(engine.amend(change, (waiting.decisionBatch as { id: string }).id,
        { operation: "start" }, async () => ({ unexpected: true }))).rejects.toThrow("amendment-batch-stale");
    } finally { await engine.close(); }
  });

  it.each([
    ["approval-needed", "unapproved-dependency-change"],
    ["paused", "needs-task-split"],
  ] as const)("delegates %s/%s to the parent recommendation and permits an in-stage amendment", async (kind, code) => {
    const change = `autonomous-${code}`;
    const consumerRoot = makeConsumer(change);
    const delivery = new DeliverySource();
    delivery.set(change, plan(change, [task("T1")]));
    const worker = new ScriptedWorker();
    worker.script("T1:red", [{ kind, code }]);
    const engine = openEngine({ consumerRoot, delivery, worker });
    try {
      const outcome = await engine.execute(command("start", change));
      expect(outcome).toMatchObject({
        completed: false,
        continuation: { owner: "parent", automatic: true, action: "amend", change },
        decisionBatch: { resolution: { owner: "parent", strategy: "recommended", requiresUserInput: false } },
      });
      const batch = outcome.decisionBatch as { id: string };
      let mutations = 0;
      const request = { operation: "compile-plan", operationId: "recommendation" };
      const revise = async (assertAuthority: () => void) => { assertAuthority(); mutations++; return { revised: true }; };
      for (const forbidden of [
        { operation: "approve-gate", gate: "gate-a", contract: "weaken acceptance" },
        { operation: "record-decision", category: "behavior", contract: "change the goal" },
        { operation: "write-artifact", path: "proposal.md", content: "replacement goal" },
      ]) await expect(engine.amend(change, batch.id, forbidden, revise)).rejects.toThrow("amendment-changes-accepted-behavior");
      expect(mutations).toBe(0);
      expect(await engine.amend(change, batch.id, request, revise)).toEqual({ revised: true });
      expect(await engine.amend(change, batch.id, request, revise)).toEqual({ revised: true });
      expect(mutations).toBe(1);
      await expect(engine.amend(change, "stale", request, revise)).rejects.toThrow("amendment-batch-stale");
      expect(mutations).toBe(1);
    } finally { await engine.close(); }
  });

  it.each(["delivery-invalid", "input-unsafe", "input-missing", "unclassified-failure"])("does not grant amendment authority from an unproven Worker code: %s", async code => {
    const change = `unproven-${code}`;
    const consumerRoot = makeConsumer(change);
    const delivery = new DeliverySource();
    delivery.set(change, plan(change, [task("T1")]));
    const worker = new ScriptedWorker();
    worker.script("T1:red", [{ kind: "paused", code }]);
    const engine = openEngine({ consumerRoot, delivery, worker });
    try {
      const outcome = await engine.execute(command("start", change));
      expect(outcome).toMatchObject({ state: "paused", completed: false });
      expect(outcome).not.toHaveProperty("continuation");
      expect(outcome).not.toHaveProperty("decisionBatch");
    } finally { await engine.close(); }
  });

  it("retains committed phases and work budget across a baseline-only revision and reopen", async () => {
    const change = "baseline-only-revision";
    const consumerRoot = makeConsumer(change);
    const xdgStateHome = temporaryRoot(change);
    const delivery = new DeliverySource();
    const original = { ...task("T1"), baselineVerification: verification("baseline-old", "expected-green") };
    delivery.set(change, plan(change, [original]));
    const firstWorker = new ScriptedWorker();
    firstWorker.script("T1:green", [{ kind: "paused", code: "external-unavailable" }]);
    let engine = openEngine({ consumerRoot, xdgStateHome, delivery, worker: firstWorker });
    const first = await engine.execute(command("start", change));
    expect(first).toMatchObject({ tasks: [{ taskId: "T1", state: "paused", phase: "green" }] });
    await engine.close();
    const revised = { ...original, baselineVerification: verification("baseline-revised", "expected-green") };
    delivery.set(change, plan(change, [revised]));
    delivery.available = { deliveryRevision: 2, receiptHash: HASH_B };
    const secondWorker = new ScriptedWorker();
    engine = openEngine({ consumerRoot, xdgStateHome, delivery, worker: secondWorker });
    try {
      const resumed = await engine.execute(command("resume", change, { deliveryRevision: 2, receiptHash: HASH_B }));
      expect(secondWorker.calls).toEqual(["T1:green:r1:policy"]);
      expect(resumed.runId).toBe(first.runId);
      expect(resumed.deliveryRevision).toBe(2);
      expect((resumed.resourceBudget as { used: number }).used).toBe((first.resourceBudget as { used: number }).used + 1);
      expect(resumed).toMatchObject({ tasks: [{ taskId: "T1", state: "verified" }] });
    } finally { await engine.close(); }
  });

  it("keeps baseline recovery consumption stable across task renaming and revised deliveries", async () => {
    const change = "baseline-rename-recovery";
    const consumerRoot = makeConsumer(change);
    const xdgStateHome = temporaryRoot(change);
    const delivery = new DeliverySource();
    const original = { ...task("T1"), baselineVerification: verification("baseline", "expected-green") };
    delivery.set(change, plan(change, [original]));
    let environment = HASH_A;
    let available = false;
    class PrerequisiteWorker extends ScriptedWorker {
      async prepareTask(input: Record<string, any>) {
        return available ? { kind: "prepared" as const } : {
          kind: "paused" as const, code: "runner-missing", prerequisite: {
            kind: "verification-prerequisite" as const, scope: "baseline-task-affected" as const, cause: "capability" as const,
            taskId: String(input.taskId), verificationId: input.task.baselineVerification.id,
            contractIdentity: HASH_C, originalRevisionId: HASH_B, environmentIdentity: environment,
          },
        };
      }
    }
    const worker = new PrerequisiteWorker();
    let engine = openEngine({ consumerRoot, xdgStateHome, delivery, worker });
    try {
      const first = await engine.execute(command("start", change));
      expect(first).toMatchObject({ pause: { diagnostic: { recovery: { failures: 1 } } }, resourceBudget: { used: 0 } });
      await engine.close();
      const renamed = structuredClone(original);
      renamed.taskId = "renamed";
      renamed.baselineVerification.id = "renamed-baseline";
      delivery.set(change, plan(change, [renamed]));
      delivery.available = { deliveryRevision: 2, receiptHash: HASH_B };
      engine = openEngine({ consumerRoot, xdgStateHome, delivery, worker });
      const revised = await engine.execute(command("resume", change, { operationId: "renamed-revision", deliveryRevision: 2, receiptHash: HASH_B }));
      expect(revised).toMatchObject({ runId: first.runId, deliveryRevision: 2, tasks: [{ taskId: "renamed" }], pause: { diagnostic: { recovery: { failures: 1 } } }, resourceBudget: { used: 0 } });
      environment = HASH_C;
      const changed = await engine.execute(command("resume", change, { operationId: "changed-prerequisite" }));
      expect(changed).toMatchObject({ recovery: { attempts: 2, exhausted: true }, resourceBudget: { used: 0 } });
      available = true;
      const exhausted = await engine.execute(command("resume", change, { operationId: "capability-after-exhaustion" }));
      expect(exhausted).toMatchObject({ recovery: { attempts: 2, exhausted: true }, resourceBudget: { used: 0 } });
      expect(worker.calls).toEqual([]);
      available = false;
      const grant = (exhausted.recovery as { additionalAttempt: Record<string, unknown> }).additionalAttempt;
      const probed = await engine.execute(command("resume", change, { operationId: "baseline-grant", recovery: grant }));
      const nextGrant = (probed.recovery as { additionalAttempt: Record<string, unknown> }).additionalAttempt;
      expect(nextGrant.failureSequence).not.toBe(grant.failureSequence);
      expect(worker.calls).toEqual([]);
      await expect(engine.execute(command("resume", change, { operationId: "replayed-baseline-grant", recovery: grant }))).rejects.toThrow("recovery-request-stale");
      available = true;
      const recovered = await engine.execute(command("resume", change, { operationId: "restored-baseline-grant", recovery: nextGrant }));
      expect(recovered).toMatchObject({ resourceBudget: { used: 2 }, tasks: [{ taskId: "renamed", state: "verified" }] });
    } finally { await engine.close(); }
  });

  it("does not let one baseline owner exhaust a separate task with the same verifier", async () => {
    const change = "separate-baseline-owners";
    const consumerRoot = makeConsumer(change);
    const delivery = new DeliverySource();
    const firstTask = { ...task("T1"), baselineVerification: verification("baseline", "expected-green") };
    const secondTask = structuredClone(firstTask);
    secondTask.taskId = "T2";
    secondTask.phases.red.write = ["T2.txt"];
    secondTask.phases.green.write = ["T2.txt"];
    delivery.set(change, plan(change, [firstTask, secondTask]));
    let changed = false;
    class OwnerWorker extends ScriptedWorker {
      async prepareTask(input: Record<string, any>) {
        if (changed && input.taskId === "T2") return { kind: "prepared" as const };
        return { kind: "paused" as const, code: "runner-missing", prerequisite: {
          kind: "verification-prerequisite" as const, scope: "baseline-task-affected" as const, cause: "capability" as const,
          taskId: String(input.taskId), verificationId: input.task.baselineVerification.id,
          contractIdentity: HASH_C, originalRevisionId: HASH_B, environmentIdentity: changed ? HASH_C : HASH_A,
        } };
      }
    }
    const worker = new OwnerWorker();
    const engine = openEngine({ consumerRoot, delivery, worker });
    try {
      await engine.execute(command("start", change));
      expect(worker.calls).toEqual([]);
      changed = true;
      const resumed = await engine.execute(command("resume", change));
      expect(worker.calls).toEqual(["T2:red:r1:policy", "T2:green:r1:policy"]);
      expect(resumed).toMatchObject({ state: "paused", completed: false, recovery: { exhausted: true, attempts: 2 }, resourceBudget: { used: 2 }, tasks: [{ taskId: "T1", state: "paused" }, { taskId: "T2", state: "verified" }] });
    } finally { await engine.close(); }
  });

  it("keeps independent work active and does not reserve Worker budget for an unavailable task baseline", async () => {
    const change = "local-baseline-admission";
    const consumerRoot = makeConsumer(change);
    const delivery = new DeliverySource();
    delivery.set(change, plan(change, [
      task("T1", { verificationLock: "one" }),
      task("T2", { verificationLock: "two" }),
      task("T3", { dependsOn: ["T1"], verificationLock: "three" }),
    ]));
    let started!: () => void;
    const active = new Promise<void>(resolve => { started = resolve; });
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    class BaselineWorker extends ScriptedWorker {
      async prepareTask(input: Record<string, unknown>) {
        return input.taskId === "T1"
          ? { kind: "paused" as const, code: "runner-missing" }
          : { kind: "prepared" as const };
      }
      override async runAttempt(input: Record<string, unknown>): Promise<AttemptOutcome> {
        if (input.taskId === "T2" && input.phase === "red") { started(); await held; }
        return super.runAttempt(input);
      }
    }
    const worker = new BaselineWorker();
    const engine = openEngine({ consumerRoot, delivery, worker });
    const running = engine.execute(command("start", change));
    try {
      await active;
      const live = await engine.execute(command("status", change));
      expect(live).toMatchObject({ state: "running", completed: false });
      release();
      const paused = await running;
      expect(paused).toMatchObject({ state: "paused", completed: false, resourceBudget: { used: 2 } });
      expect(worker.calls).toEqual(["T2:red:r1:policy", "T2:green:r1:policy"]);
      const resumed = await engine.execute(command("resume", change));
      expect(resumed).toMatchObject({ state: "paused", completed: false, resourceBudget: { used: 2 } });
      expect(worker.calls).toEqual(["T2:red:r1:policy", "T2:green:r1:policy"]);
    } finally { release(); await running; await engine.close(); }
  });

  it("keeps preparing task conflicts reserved when an earlier dependent becomes runnable", async () => {
    const change = "preparing-conflict-refill";
    const consumerRoot = makeConsumer(change);
    const delivery = new DeliverySource();
    delivery.set(change, plan(change, [
      task("A", { dependsOn: ["C"], write: "shared.txt", verificationLock: "a" }),
      task("C", { write: "producer.txt", verificationLock: "c" }),
      task("B", { write: "shared.txt", verificationLock: "b" }),
    ]));
    let prepared!: () => void;
    const preparing = new Promise<void>(resolve => { prepared = resolve; });
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const preparingTasks: string[] = [];
    class PreparingWorker extends ScriptedWorker {
      async prepareTask(input: Record<string, unknown>) {
        preparingTasks.push(String(input.taskId));
        if (input.taskId === "B" && input.phase === "red") { prepared(); await held; }
        return { kind: "prepared" as const };
      }
    }
    const worker = new PreparingWorker();
    const engine = openEngine({ consumerRoot, delivery, worker });
    const running = engine.execute(command("start", change));
    try {
      await preparing;
      await expect.poll(async () => {
        const status = await engine.execute(command("status", change));
        return (status.tasks as { taskId: string; state: string }[]).find(row => row.taskId === "C")?.state;
      }).toBe("verified");
      expect(preparingTasks).not.toContain("A");
      expect(worker.calls).toEqual(["C:red:r1:policy", "C:green:r1:policy"]);
      release();
      await running;
      expect(worker.calls).toEqual(["C:red:r1:policy", "C:green:r1:policy", "B:red:r1:policy", "B:green:r1:policy", "A:red:r1:policy", "A:green:r1:policy"]);
    } finally { release(); await running; await engine.close(); }
  });

  it.each(["cancel", "close"] as const)("settles parallel preparation before %s without launching or reserving Worker work", async control => {
    const change = `preparation-${control}`;
    const consumerRoot = makeConsumer(change);
    const delivery = new DeliverySource();
    delivery.set(change, plan(change, [task("T1", { verificationLock: "one" }), task("T2", { verificationLock: "two" })]));
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let aborted!: () => void;
    const cancellation = new Promise<void>(resolve => { aborted = resolve; });
    let preparations = 0;
    let settledPreparations = 0;
    class PreparingWorker extends ScriptedWorker {
      async prepareTask(input: Record<string, unknown>) {
        (input.signal as AbortSignal).addEventListener("abort", () => aborted(), { once: true });
        preparations++;
        if (preparations === 2) started();
        await held;
        settledPreparations++;
        return { kind: "prepared" as const };
      }
    }
    const worker = new PreparingWorker();
    const engine = openEngine({ consumerRoot, delivery, worker });
    const running = engine.execute(command("start", change));
    let stopping: Promise<unknown> | undefined;
    try {
      await ready;
      let stopped = false;
      stopping = Promise.resolve(control === "close" ? engine.close() : engine.execute(command("cancel", change))).then(value => { stopped = true; return value; });
      await cancellation;
      expect(stopped).toBe(false);
      expect(settledPreparations).toBe(0);
      release();
      const stoppedResult = await stopping;
      const result = await running;
      if (control === "cancel") expect(stoppedResult).toMatchObject({ tasks: [{ state: "paused" }, { state: "paused" }], resourceBudget: { used: 0 } });
      expect(settledPreparations).toBe(2);
      expect(worker.calls).toEqual([]);
      expect(result).toMatchObject({ state: "paused", completed: false, resourceBudget: { used: 0 } });
    } finally { release(); await stopping; await running; await engine.close(); }
  });

  it("bounds failed automatic amendment work across restart without spending Worker work", async () => {
    const change = "autonomous-amendment-budget";
    const consumerRoot = makeConsumer(change);
    const xdgStateHome = temporaryRoot(change);
    const delivery = new DeliverySource();
    delivery.set(change, plan(change, [task("T1")]));
    const worker = new ScriptedWorker();
    worker.script("T1:red", [{ kind: "approval-needed", code: "unapproved-dependency-change" }]);
    let engine = openEngine({ consumerRoot, xdgStateHome, delivery, worker });
    try {
      const outcome = await engine.execute(command("start", change));
      const batchId = (outcome.decisionBatch as { id: string }).id;
      const maximum = (outcome.amendmentBudget as { maximum: number }).maximum;
      let mutations = 0;
      for (let index = 0; index < maximum; index++) {
        await expect(engine.amend(change, batchId, { operation: "compile-plan", operationId: `broken-${index}` }, async () => {
          mutations++;
          throw new Error("design-plan-validation-invalid");
        })).rejects.toThrow("design-plan-validation-invalid");
      }
      await engine.close();
      engine = openEngine({ consumerRoot, xdgStateHome, delivery, worker });
      const exhausted = await engine.execute(command("status", change));
      expect(exhausted).toMatchObject({ amendmentBudget: { used: maximum, remaining: 0, exhausted: true } });
      expect(exhausted.continuation).toBeUndefined();
      await expect(engine.amend(change, batchId, { operation: "compile-plan", operationId: "one-more" }, async () => { mutations++; return {}; })).rejects.toThrow("amendment-budget-exhausted");
      expect(mutations).toBe(maximum);
      expect(worker.calls).toHaveLength(1);
    } finally { await engine.close(); }
  }, 20_000);

  it.each(["operation-cancelled", "approval-code-invalid"])("does not offer plan rewriting for %s", async code => {
    const change = `no-amend-${code}`;
    const consumerRoot = makeConsumer(change);
    const delivery = new DeliverySource();
    delivery.set(change, plan(change, [task("T1")]));
    const worker = new ScriptedWorker();
    worker.script("T1:red", [{ kind: "paused", code }]);
    const engine = openEngine({ consumerRoot, delivery, worker });
    try {
      const outcome = await engine.execute(command("start", change));
      expect(outcome.decisionBatch).toBeUndefined();
      expect(outcome.continuation).toBeUndefined();
    } finally { await engine.close(); }
  });

  it.each(["cancel", "close"])("fences and settles an amendment before %s returns", async control => {
    const change = `amendment-${control}`;
    const consumerRoot = makeConsumer(change);
    const delivery = new DeliverySource();
    delivery.set(change, plan(change, [task("T1")]));
    const worker = new ScriptedWorker();
    worker.script("T1:red", [{ kind: "approval-needed", code: "unapproved-dependency-change" }]);
    const engine = openEngine({ consumerRoot, delivery, worker });
    const approval = await engine.execute(command("start", change));
    let release!: () => void;
    let entered!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    let wrote = false;
    const amendment = engine.amend(change, String((approval.decisionBatch as { id: string }).id), { operation: "test-amendment" }, async assertAuthority => {
      entered(); await hold; assertAuthority(); wrote = true; return { amended: true };
    });
    const rejected = expect(amendment).rejects.toThrow(/lease-fenced|workflow-engine-closed/u);
    await started;
    await expect(engine.execute(command("resume", change, { operationId: "competing-resume" }))).rejects.toThrow(/operation-already-running/u);
    let settled = false;
    const closing = Promise.resolve(control === "close" ? engine.close() : engine.execute(command("cancel", change))).then(() => { settled = true; });
    await new Promise(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
    release();
    await rejected;
    await closing;
    expect(wrote).toBe(false);
    await engine.close();
  });

  it("reserves a finite work budget before execution and retains it across reopen", async () => {
    const change = "persistent-work-budget";
    const consumerRoot = makeConsumer(change);
    const xdgStateHome = temporaryRoot(change);
    const delivery = new DeliverySource();
    delivery.set(change, plan(change, [task("T1-budget")]));
    const worker = new ScriptedWorker();
    let launches = 0;
    worker.runAttempt = async input => {
      const reserve = input.reserveCandidate as () => boolean;
      while (reserve()) launches += 1;
      return { kind: "paused", code: "change-work-budget-exhausted" };
    };
    let engine = openEngine({ consumerRoot, xdgStateHome, delivery, worker });
    const paused = await engine.execute(command("start", change));
    expect(launches).toBe(30);
    expect(paused).toMatchObject({ recovery: { exhausted: true }, resourceBudget: { used: 30, maximum: 30, remaining: 0 } });
    await engine.close();
    engine = openEngine({ consumerRoot, xdgStateHome, delivery, worker });
    try {
      const resumed = await engine.execute(command("resume", change, { operationId: "budget-reopen" }));
      expect(resumed).toMatchObject({ recovery: { exhausted: true }, resourceBudget: { used: 30 } });
      expect(launches).toBe(30);
    } finally { await engine.close(); }
  });

  it("allows one explicit retry after exhaustion without resetting history or replaying a grant", async () => {
    const change = "explicit-retry";
    const consumerRoot = makeConsumer(change);
    const xdgStateHome = temporaryRoot(change);
    const delivery = new DeliverySource();
    delivery.set(change, plan(change, [task("T1")]));
    const worker = new ScriptedWorker();
    worker.script("T1:red", Array.from({length: 4}, () => ({kind: "retryable" as const, code: "candidate-diff-invalid", retryPolicy: "artifact" as const})));
    let engine = openEngine({consumerRoot, xdgStateHome, delivery, worker});
    const paused = await engine.execute(command("start", change));
    expect(worker.calls).toHaveLength(2);
    const recovery = paused.recovery as { additionalAttempt: Record<string, unknown> };
    expect(recovery.additionalAttempt).toMatchObject({reason: "parent-directed-retry"});
    expect(paused).toMatchObject({
      continuation: {
        owner: "parent",
        automatic: true,
        kind: "inspect-recovery",
        reason: "candidate-diff-invalid",
        metadata: {
          taskId: "T1",
          diagnostic: {
            code: "candidate-diff-invalid",
            strategy: "revise-candidate",
            attempts: 2,
          },
          recommendation: {
            kind: "bounded-additional-attempt",
            resume: { recovery: recovery.additionalAttempt },
          },
        },
      },
      conditionalCommands: [
        {
          command: "resume",
          stage: "abel-implement",
          change,
          requires: { recovery: recovery.additionalAttempt },
        },
      ],
      decisionBatch: {
        requiredGates: ["gate-b"],
        resolution: {
          owner: "parent",
          strategy: "recommended",
          requiresUserInput: false,
        },
      },
    });
    expect(paused.continuation).not.toHaveProperty("action");
    expect(paused.continuation).not.toHaveProperty("command");
    const retry = command("resume", change, {operationId: "explicit-once", recovery: recovery.additionalAttempt});
    const next = await engine.execute(retry);
    expect(next).toMatchObject({state: "paused", recovery: {exhausted: true, attempts: 3}, resourceBudget: {used: 3}});
    expect(worker.calls).toHaveLength(3);
    await engine.execute(retry);
    expect(worker.calls).toHaveLength(3);
    await engine.close();
    engine = openEngine({consumerRoot, xdgStateHome, delivery, worker});
    try {
      await engine.execute(command("resume", change, {operationId: "ordinary-resume"}));
      expect(worker.calls).toHaveLength(3);
      const beforeRejectedGrant = await engine.execute(command("status", change));
      await expect(engine.execute(command("resume", change, {operationId: "stale-grant", recovery: recovery.additionalAttempt}))).rejects.toThrow("recovery-request-stale");
      expect(worker.calls).toHaveLength(3);
      expect(await engine.execute(command("status", change))).toEqual(beforeRejectedGrant);
    } finally {await engine.close();}
  });

  it.each([false, true])("does not launch or report readiness for an invalid recovery grant (revised: %s)", async revised => {
    const change = `rejected-recovery-${revised}`;
    const consumerRoot = makeConsumer(change);
    const delivery = new DeliverySource();
    delivery.set(change, plan(change, [task("T1")]));
    const worker = new ScriptedWorker();
    worker.script("T1:red", [
      {kind: "retryable", code: "invalid-structural-result", retryPolicy: "artifact", attemptDiagnostic: {finalCategory: "mixed", submitAttempts: 2, schema: "invalid"}},
      {kind: "paused", code: "endpoint-unavailable"},
    ]);
    const engine = openEngine({consumerRoot, delivery, worker});
    try {
      const paused = await engine.execute(command("start", change));
      expect(paused).toMatchObject({state: "paused", pause: {code: "endpoint-unavailable", diagnostic: {recovery: {failures: 1, feedback: {maxAttempts: 2}}}}});
      if (revised) delivery.set(change, plan(change, [task("T2")]));
      await expect(engine.execute(command("resume", change, {
        operationId: "invalid-grant",
        recovery: {incidentKey: HASH_A, failureSequence: 1, reason: "parent-directed-retry"},
        ...(revised ? {deliveryRevision: 2, receiptHash: HASH_B} : {}),
      }))).rejects.toThrow("recovery-request-stale");
      expect(worker.calls).toHaveLength(2);
      const after = await engine.execute(command("status", change));
      if (revised) expect(after).toMatchObject({state: "paused", deliveryRevision: 2, pause: {code: "recovery-request-stale"}});
      else expect(after).toEqual(paused);
      const resumed = await engine.execute(command("resume", change, {operationId: "ordinary-after-rejection"}));
      expect(resumed.state).not.toBe("ready");
      expect(worker.calls.length).toBeGreaterThan(2);
    } finally { await engine.close(); }
  });

  it.each([false, true])("preserves captured limits and exhausted history across reopen (legacy: %s)", async legacy => {
    const change = `budget-migration-${legacy}`;
    const consumerRoot = makeConsumer(change);
    const xdgStateHome = temporaryRoot(change);
    const delivery = new DeliverySource();
    delivery.set(change, plan(change, [task("T1")]));
    const worker = new ScriptedWorker();
    worker.script("T1:red", Array.from({length: 2}, () => ({kind: "retryable" as const, code: "candidate-diff-invalid", retryPolicy: "artifact" as const})));
    let engine = openEngine({consumerRoot, xdgStateHome, delivery, worker, workHardLimit: 12});
    await engine.execute(command("start", change));
    await engine.close();
    if (legacy) {
      const database = new DatabaseSync(resolveStateRoot({consumerRoot, xdgStateHome}).databasePath);
      try {
        database.exec("UPDATE workflow_work_budget SET max_work = 700");
        for (const column of ["phase_high_water", "hard_limit", "recovery_policy"])
          database.exec(`ALTER TABLE workflow_work_budget DROP COLUMN ${column}`);
        database.exec("ALTER TABLE workflow_recovery_incidents DROP COLUMN conditions_json");
        database.exec("DROP TABLE workflow_recovery_grants");
      } finally { database.close(); }
    }
    engine = openEngine({consumerRoot, xdgStateHome, delivery, worker, workHardLimit: 4});
    try {
      const preserved = await engine.execute(command("resume", change, {operationId: "reopen"}));
      expect(preserved).toMatchObject({resourceBudget: {used: 2, maximum: legacy ? 700 : 12, hardLimit: legacy ? 700 : 12, phaseHighWater: 2}, recovery: {attempts: 2, exhausted: true}});
      expect(worker.calls).toHaveLength(2);
      worker.runAttempt = async () => ({kind: "paused", code: "endpoint-unavailable"});
      delivery.set(change, plan(change, Array.from({length: 4}, (_, i) => task(`T${i+1}`, {verificationLock: `lock-${i}`}))));
      const expanded = await engine.execute(command("resume", change, {operationId: "expand", deliveryRevision: 2, receiptHash: HASH_B}));
      expect(expanded).toMatchObject({deliveryRevision: 2, resourceBudget: {maximum: legacy ? 700 : 12, hardLimit: legacy ? 700 : 12, phaseHighWater: 8}});
    } finally { await engine.close(); }
  });

  it("grows admitted phase capacity without refunding work or crediting repeated plans", async () => {
    const change = "split-budget";
    const consumerRoot = makeConsumer(change);
    const delivery = new DeliverySource();
    delivery.set(change, plan(change, [task("T1")]));
    const worker = new ScriptedWorker();
    worker.runAttempt = async () => ({kind: "paused", code: "endpoint-unavailable"});
    const engine = openEngine({consumerRoot, delivery, worker});
    try {
      expect(await engine.execute(command("start", change))).toMatchObject({resourceBudget: {used: 1, maximum: 30}});
      delivery.set(change, plan(change, Array.from({length: 16}, (_,i) => task(`T${i+1}`, {verificationLock: `lock-${i}`}))));
      const expanded = await engine.execute(command("resume", change, {operationId: "split", deliveryRevision: 2, receiptHash: HASH_B}));
      expect(expanded).toMatchObject({resourceBudget: {used: 17, maximum: 120, phaseHighWater: 32, hardLimit: 512}});
      const repeated = await engine.execute(command("resume", change, {operationId: "repeat", deliveryRevision: 2, receiptHash: HASH_B}));
      expect(repeated).toMatchObject({resourceBudget: {maximum: 120}});
      expect((repeated.resourceBudget as {used: number}).used).toBeGreaterThanOrEqual(17);
    } finally {await engine.close();}
  });

  it("retains verified sibling facts when only recovery policy changes", async () => {
    const change = "retain-evidence-metadata";
    const consumerRoot = makeConsumer(change);
    const delivery = new DeliverySource();
    const original = plan(change, [task("T1-done"), task("T2-held")]);
    delivery.set(change, original);
    const worker = new ScriptedWorker();
    worker.script("T2-held:red", [{ kind: "paused", code: "endpoint-unavailable" }]);
    const engine = openEngine({ consumerRoot, delivery, worker });
    try {
      await engine.execute(command("start", change));
      const revised = structuredClone(original);
      revised.verification.artifactCorrection.maxAttempts = 3;
      delivery.set(change, revised);
      await engine.execute(command("resume", change, { operationId: "policy-revision", deliveryRevision: 2, receiptHash: HASH_B }));
      expect(worker.calls.filter(call => call.startsWith("T1-done:"))).toHaveLength(2);
      expect(worker.calls.filter(call => call.startsWith("T2-held:"))).toHaveLength(3);
    } finally { await engine.close(); }
  });

  it("reports every concurrent authority gap in one stable decision batch", async () => {
    const change = "batched-authority";
    const consumerRoot = makeConsumer(change);
    const delivery = new DeliverySource();
    delivery.set(change, plan(change, [task("T1", { verificationLock: "v1" }), task("T2", { verificationLock: "v2" })]));
    const worker = new ScriptedWorker();
    worker.script("T1:red", [{ kind: "approval-needed", code: "unapproved-dependency-change" }]);
    worker.script("T2:red", [{ kind: "approval-needed", code: "behavior-contract-insufficient" }]);
    const engine = openEngine({ consumerRoot, delivery, worker });
    try {
      const outcome = await engine.execute(command("start", change));
      expect(outcome).toMatchObject({ blockers: [
        { taskId: "T1", code: "unapproved-dependency-change", category: "dependency" },
        { taskId: "T2", code: "behavior-contract-insufficient", category: "observable-behavior" },
      ], decisionBatch: { requiredGates: ["gate-a", "gate-b"] } });
      const status = await engine.execute(command("status", change));
      expect(status.decisionBatch).toEqual(outcome.decisionBatch);
      expect(worker.calls).toHaveLength(2);
    } finally { await engine.close(); }
  });

  it("discovers revised authority without treating rewording as new recovery budget", async () => {
    const change = "exhausted-new-delivery";
    const consumerRoot = makeConsumer(change);
    const delivery = new DeliverySource();
    delivery.set(change, plan(change, [task("T1-revised")]));
    const worker = new ScriptedWorker();
    worker.script("T1-revised:red", Array.from({ length: 2 }, () => ({ kind: "retryable" as const, code: "candidate-diff-invalid", retryPolicy: "artifact" as const })));
    const engine = openEngine({ consumerRoot, delivery, worker });
    try {
      const first = await engine.execute(command("start", change));
      expect(first).toMatchObject({ recovery: { exhausted: true } });
      const revised = task("T1-revised");
      revised.context.contract = "Revised approved execution context";
      delivery.set(change, plan(change, [revised]));
      delivery.available = { deliveryRevision: 2, receiptHash: HASH_B };
      const status = await engine.execute(command("status", change));
      expect(status).toMatchObject({ runId: first.runId, availableDelivery: delivery.available, legalCommands: ["status", "resume", "rebind", "discard"] });
      await expect(engine.execute(command("resume", change, { operationId: "revised-resume", ...delivery.available }))).resolves.toMatchObject({ runId: first.runId, deliveryRevision: 2, tasks: [{ taskId: "T1-revised", state: "paused" }] });
      expect(worker.calls).toHaveLength(2);
    } finally { await engine.close(); }
  });

  it.each(["red", "green", "refactor"] as const)("identifies %s recovery by its verification contract and input bindings", phase => {
    const original = task("identity-task") as unknown as PlanTaskDraft;
    original.phases.refactor = structuredClone(original.phases.green);
    const key = (value: PlanTaskDraft) => recoveryKey(value, phase, {} as EngineTaskRow, {} as EngineRunRow);
    const initial = key(original);
    const renamed = structuredClone(original);
    renamed.taskId = "renamed-task";
    renamed.objective = "Reworded objective";
    renamed.phases[phase]!.verification.id = "renamed-verifier";
    expect(key(renamed)).toBe(initial);
    const changed = structuredClone(original);
    changed.phases[phase]!.verificationInputs = [{ kind: "output", outputId: "produced-input" }];
    expect(key(changed)).not.toBe(initial);
    const reordered = structuredClone(original);
    reordered.phases[phase]!.verificationInputs.push({ kind: "workspace", path: "test/fixture.test.ts" });
    const orderedKey = key(reordered);
    reordered.phases[phase]!.verificationInputs.reverse();
    expect(key(reordered)).toBe(orderedKey);
  });

  it.each([false, true])("only renews exhausted Green recovery for a material verifier change (%s)", async (materialChange) => {
    const change = `green-verifier-revision-${materialChange}`;
    const consumerRoot = makeConsumer(change);
    const delivery = new DeliverySource();
    const original = plan(change, [task("T1-green-revised")]);
    delivery.set(change, original);
    const worker = new ScriptedWorker();
    worker.script("T1-green-revised:green", Array.from({ length: 2 }, () => ({ kind: "retryable" as const, code: "candidate-diff-invalid", retryPolicy: "artifact" as const })));
    const engine = openEngine({ consumerRoot, delivery, worker });
    try {
      expect(await engine.execute(command("start", change))).toMatchObject({ recovery: { exhausted: true } });
      const revised = structuredClone(original);
      revised.tasks[0].phases.green.verification.id = "renamed-green-verifier";
      if (materialChange) revised.tasks[0].phases.green.verification.args = ["--passWithNoTests"];
      delivery.set(change, revised);
      const before = worker.calls.length;
      const resumed = await engine.execute(command("resume", change, { operationId: "corrected-green-resume", deliveryRevision: 2, receiptHash: HASH_B }));
      expect(resumed).toMatchObject({ tasks: [{ taskId: "T1-green-revised", state: materialChange ? "verified" : "paused" }] });
      expect(worker.calls.filter(call => call.includes(":green:")).length).toBe(materialChange ? 3 : 2);
      if (!materialChange) expect(worker.calls).toHaveLength(before + 1); // Replanning replays Red, but cannot renew Green's budget.
    } finally { await engine.close(); }
  });

  it("bounds one operation even when rejected attempts change workspace identity", async () => {
    const change = "changing-recovery-context";
    const consumerRoot = makeConsumer(change);
    const delivery = new DeliverySource();
    const value = plan(change, [task("T1-changing")]);
    value.verification.artifactCorrection.maxAttempts = 3;
    delivery.set(change, value);
    const worker = new ScriptedWorker();
    let calls = 0;
    worker.runAttempt = async () => {
      calls += 1;
      if (calls > 3) throw new Error("unbounded recovery");
      return { kind: "retryable", code: "workspace-revision-stale", retryPolicy: "stale", baselineRevisionId: HASH_A, currentWorkspaceRevisionId: String(calls).repeat(64) };
    };
    const engine = openEngine({ consumerRoot, delivery, worker });
    try {
      await expect(engine.execute(command("start", change))).resolves.toMatchObject({ state: "paused" });
      expect(calls).toBe(3);
    } finally { await engine.close(); }
  });

  it("automatically refreshes a stale candidate with concrete recovery feedback", async () => {
    const change = "automatic-stale-recovery";
    const consumerRoot = makeConsumer(change);
    const delivery = new DeliverySource();
    delivery.set(change, plan(change, [task("T1-recovery")]));
    const worker = new ScriptedWorker();
    worker.script("T1-recovery:red", [{ kind: "retryable", code: "workspace-revision-stale", retryPolicy: "stale" }]);
    const engine = openEngine({ consumerRoot, delivery, worker });
    try {
      const outcome = await engine.execute(command("start", change));
      expect(outcome).toMatchObject({ tasks: [{ taskId: "T1-recovery", state: "verified" }] });
      expect(worker.calls).toHaveLength(3);
      expect(worker.recoveryFeedback[1]).toMatchObject({ code: "workspace-revision-stale", attempt: 2, strategy: "refresh-candidate" });
    } finally { await engine.close(); }
  });

  it("enforces a reduced recovery limit before launch and retains it across reopen", async () => {
    const change = "reduced-recovery-limit";
    const consumerRoot = makeConsumer(change);
    const xdgStateHome = temporaryRoot(change);
    const delivery = new DeliverySource();
    const original = plan(change, [task("T1-limit")]);
    original.verification.artifactCorrection.maxAttempts = 3;
    delivery.set(change, original);
    const worker = new ScriptedWorker();
    worker.script("T1-limit:red", [
      { kind: "retryable", code: "candidate-diff-invalid", retryPolicy: "artifact" },
      { kind: "retryable", code: "candidate-diff-invalid", retryPolicy: "artifact" },
      { kind: "paused", code: "endpoint-unavailable" },
    ]);
    let engine = openEngine({ consumerRoot, xdgStateHome, delivery, worker });
    try {
      const paused = await engine.execute(command("start", change));
      expect(paused).toMatchObject({ state: "paused", pause: { code: "endpoint-unavailable" } });
      expect(worker.calls).toHaveLength(3);
      const revised = structuredClone(original);
      revised.verification.artifactCorrection.maxAttempts = 2;
      delivery.set(change, revised);
      const resumed = await engine.execute(command("resume", change, { operationId: "lower-limit", deliveryRevision: 2, receiptHash: HASH_B }));
      expect(worker.calls).toHaveLength(3);
      expect(resumed).toMatchObject({ state: "paused", recovery: { exhausted: true }, resourceBudget: paused.resourceBudget });
      await engine.close();
      engine = openEngine({ consumerRoot, xdgStateHome, delivery, worker });
      delivery.set(change, original);
      expect(await engine.execute(command("resume", change, { operationId: "raise-limit", deliveryRevision: 3, receiptHash: HASH_C }))).toMatchObject({ state: "paused", recovery: { exhausted: true } });
      expect(worker.calls).toHaveLength(3);
    } finally { await engine.close(); }
  });

  it("retains exhausted recovery across reopen and route rebind", async () => {
    const change = "durable-recovery-budget";
    const consumerRoot = makeConsumer(change);
    const xdgStateHome = temporaryRoot(change);
    const delivery = new DeliverySource();
    delivery.set(change, plan(change, [task("T1-budget")]));
    const worker = new ScriptedWorker();
    worker.script("T1-budget:red", Array.from({ length: 2 }, () => ({ kind: "retryable" as const, code: "candidate-diff-invalid", retryPolicy: "artifact" as const })));
    let engine = openEngine({ consumerRoot, xdgStateHome, delivery, worker });
    const first = await engine.execute(command("start", change));
    expect(first).toMatchObject({ recovery: { automatic: false, exhausted: true } });
    await engine.close();
    engine = openEngine({ consumerRoot, xdgStateHome, delivery, worker });
    try {
      await engine.execute(command("resume", change, { operationId: "unchanged-resume" }));
      expect(worker.calls).toHaveLength(2);
      await engine.execute(command("rebind", change, { operationId: "new-route", routeId: "recovery-route" }));
      await engine.execute(command("resume", change, { operationId: "changed-resume" }));
      expect(worker.calls).toHaveLength(2);
    } finally { await engine.close(); }
  });

  it.each(["close", "cancel"])("settles delivery loading before %s completes", async (control) => {
    const change = `delivery-loading-${control}`;
    const consumerRoot = makeConsumer(change);
    const state = temporaryRoot("loading-state");
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void;
    const loading = new Promise<void>(resolve => { entered = resolve; });
    let receivedSignal: AbortSignal | undefined;
    class DelayedSource extends DeliverySource {
      override async load(input: Record<string, unknown>) {
        receivedSignal = input.signal as AbortSignal | undefined;
        entered();
        await held;
        return super.load(input);
      }
    }
    const delivery = new DelayedSource();
    delivery.set(change, plan(change, [task("T1")]));
    const worker = new ScriptedWorker();
    const engine = openEngine({ consumerRoot, delivery, worker, xdgStateHome: state });
    let startSettled = false;
    const pending = engine.execute(command("start", change))
      .then(result => result, error => ({ error: String(error) }))
      .finally(() => { startSettled = true; });
    try {
      await loading;
      if (control === "close") await Promise.all([engine.close(), engine.close()]);
      else await engine.execute(command("cancel", change));
      expect(startSettled).toBe(true);
      expect(receivedSignal?.aborted).toBe(true);
      expect(await pending).toMatchObject({ state: "paused" });
      expect(worker.calls).toEqual([]);
    } finally {
      release();
      await pending;
      await engine.close();
    }
    const reopened = openEngine({ consumerRoot, delivery, worker, xdgStateHome: state });
    try {
      expect(await reopened.execute(command("status", change))).toMatchObject({ state: "paused" });
    } finally { await reopened.close(); }
  });

  it("serves local not-started status without loading delivery or contacting a Worker", async () => {
    const change = "engine-not-started-status";
    const consumerRoot = makeConsumer("not-started-status");
    const delivery = new DeliverySource();
    delivery.unavailable = true;
    const worker = new ScriptedWorker();
    worker.unavailable = true;
    const engine = openEngine({ consumerRoot, delivery, worker });

    await expect(engine.execute(command("status", change))).resolves.toEqual({
      stage: "abel-implement",
      change,
      state: "not-started",
      durable: true,
      completed: false,
      legalCommands: ["start"],
      tasks: [],
      queue: [],
    });
    expect(delivery.calls).toBe(0);
    expect(worker.calls).toEqual([]);
    await engine.close();
  });

  it("retains two parallel connect-timeout tasks and resumes their original workspace facts without artifact correction", async () => {
    const change = "parallel-inherited-connect-timeout";
    const consumerRoot = makeConsumer("parallel-connect-timeout");
    const xdgStateHome = temporaryRoot("parallel-connect-timeout-state");
    const stateRoot = resolveStateRoot({
      consumerRoot,
      xdgStateHome,
      homeDir: temporaryRoot("parallel-connect-timeout-home"),
    });
    const delivery = new DeliverySource();
    delivery.set(
      change,
      plan(change, [
        task("T1", { verificationLock: "parallel-connect-t1" }),
        task("T7", { verificationLock: "parallel-connect-t7" }),
        task("T2", {
          dependsOn: ["T1", "T7"],
          verificationLock: "parallel-connect-dependent",
        }),
      ]),
    );
    const retainedRevision = "e".repeat(64);
    const firstInputs: Record<string, unknown>[] = [];
    let engine = requiredEngine().open({
      consumerRoot,
      stateRoot,
      deliverySource: delivery,
      worker: {
        runAttempt: async (input: Record<string, unknown>) => {
          firstInputs.push({
            taskId: input.taskId,
            phase: input.phase,
            artifactCorrection: input.artifactCorrection,
          });
          return {
            kind: "paused" as const,
            code: "connect-timeout",
            baselineRevisionId: retainedRevision,
            currentWorkspaceRevisionId: retainedRevision,
          };
        },
        rebind: () => ({ ok: true as const, routeId: "parent" }),
      },
      changeVerifier: new PausingVerifier(),
      leaseTtlMs: 10_000,
    });

    const paused = await engine.execute(
      command("start", change, {
        operationId: "parallel-connect-timeout-start",
      }),
    );
    expect(paused).toMatchObject({
      state: "paused",
      pause: { code: "connect-timeout" },
      privateData: {
        retained: true,
        baselineRevisionId: retainedRevision,
        currentRevisionId: retainedRevision,
      },
      tasks: expect.arrayContaining([
        { taskId: "T1", state: "paused", phase: "red" },
        { taskId: "T7", state: "paused", phase: "red" },
        { taskId: "T2", state: "pending", phase: "red" },
      ]),
      queue: [],
    });
    expect(firstInputs.map((input) => input.taskId).sort()).toEqual([
      "T1",
      "T7",
    ]);
    expect(firstInputs.every((input) => input.artifactCorrection === undefined))
      .toBe(true);
    expect(readFileSync(path.join(consumerRoot, "sentinel.txt"), "utf8")).toBe(
      "main-workspace\n",
    );
    await engine.close();

    const resumedInputs: Record<string, unknown>[] = [];
    engine = requiredEngine().open({
      consumerRoot,
      stateRoot,
      deliverySource: delivery,
      worker: {
        runAttempt: async (input: Record<string, unknown>) => {
          resumedInputs.push({
            taskId: input.taskId,
            phase: input.phase,
            artifactCorrection: input.artifactCorrection,
            baselineRevisionId: input.baselineRevisionId,
            currentWorkspaceRevisionId: input.currentWorkspaceRevisionId,
          });
          if (input.phase === "red") {
            return {
              kind: "phase-committed" as const,
              artifactHash: HASH_A,
              isolatedRevisionId:
                input.taskId === "T1" ? "1".repeat(64) : "7".repeat(64),
              exitCode: 1,
              classification: "expected-red" as const,
            };
          }
          return { kind: "paused" as const, code: "post-recovery-hold" };
        },
        rebind: () => ({ ok: true as const, routeId: "parent" }),
      },
      changeVerifier: new PausingVerifier(),
      leaseTtlMs: 10_000,
    });
    const resumed = await engine.execute(
      command("resume", change, {
        operationId: "parallel-connect-timeout-resume",
      }),
    );

    expect(resumed).toMatchObject({
      runId: paused.runId,
      state: "paused",
      pause: { code: "post-recovery-hold" },
      queue: [],
    });
    const resumedRed = resumedInputs.filter((input) => input.phase === "red");
    expect(resumedRed).toHaveLength(2);
    expect(
      resumedRed.every(
        (input) =>
          input.baselineRevisionId === retainedRevision &&
          input.currentWorkspaceRevisionId === retainedRevision,
      ),
    ).toBe(true);
    expect(
      resumedInputs.every((input) => input.artifactCorrection === undefined),
    ).toBe(true);
    expect(readFileSync(path.join(consumerRoot, "sentinel.txt"), "utf8")).toBe(
      "main-workspace\n",
    );
    await engine.close();
  });

  it("discards while delivery validation is still pending", async () => {
    const change = "engine-discard-validating-delivery";
    const consumerRoot = makeConsumer("discard-validating-delivery");
    let announceDelivery!: () => void;
    const deliveryStarted = new Promise<void>((resolve) => {
      announceDelivery = resolve;
    });
    let releaseDelivery!: () => void;
    const deliveryHeld = new Promise<void>((resolve) => {
      releaseDelivery = resolve;
    });
    const engine = requiredEngine().open({
      consumerRoot,
      stateRoot: resolveStateRoot({
        consumerRoot,
        xdgStateHome: temporaryRoot("discard-validating-state"),
        homeDir: temporaryRoot("discard-validating-home"),
      }),
      deliverySource: {
        load: async () => {
          announceDelivery();
          await deliveryHeld;
          return {
            gate: "gate-b",
            revision: 1,
            receiptHash: HASH_A,
            plan: plan(change, [task("T1-discard-validating")]),
          };
        },
      },
      worker: new ScriptedWorker(),
      changeVerifier: new PausingVerifier(),
      leaseTtlMs: 10_000,
    });
    const starting = engine.execute(
      command("start", change, { operationId: "discard-validating-start" }),
    );
    await deliveryStarted;
    await expect(engine.execute(command("status", change))).resolves.toMatchObject({
      state: "validating-delivery",
      completed: false,
    });

    const discarded = await engine.execute(
      command("discard", change, {
        operationId: "discard-validating-control",
      }),
    );
    expect(discarded).toMatchObject({
      state: "discarded",
      completed: false,
      terminal: "discarded",
      legalCommands: ["status"],
    });
    releaseDelivery();
    await Promise.allSettled([starting]);
    await expect(engine.execute(command("status", change))).resolves.toMatchObject({
      state: "discarded",
      terminal: "discarded",
    });
    await engine.close();
  });

  it("keeps one run across delivery revisions and serves status without Worker access", async () => {
    const change = "engine-stable-run";
    const consumerRoot = makeConsumer("stable");
    const delivery = new DeliverySource();
    delivery.set(change, plan(change, [task("T1-stable")]));
    const worker = new ScriptedWorker();
    worker.script("T1-stable:red", [
      {
        kind: "paused",
        code: "endpoint-unavailable",
        untrustedCandidate: Buffer.from("must-not-apply\n"),
      },
      { kind: "paused", code: "endpoint-unavailable" },
    ]);
    const engine = openEngine({ consumerRoot, delivery, worker });

    const created = await engine.execute(
      command("start", change, { operationId: "start-stable-001" }),
    );
    expect(created).toMatchObject({
      stage: "abel-implement",
      change,
      state: "paused",
      deliveryRevision: 1,
      completed: false,
      pause: { code: "endpoint-unavailable" },
    });

    const repeatedStart = await engine.execute(
      command("start", change, { operationId: "start-stable-002" }),
    );
    expect(repeatedStart.runId).toBe(created.runId);
    expect(worker.calls).toHaveLength(1);

    const deliveryCalls = delivery.calls;
    delivery.unavailable = true;
    worker.unavailable = true;
    await expect(engine.execute(command("status", change))).resolves.toMatchObject(
      {
        runId: created.runId,
        state: "paused",
        legalCommands: expect.arrayContaining(["resume", "rebind", "discard"]),
      },
    );
    expect(delivery.calls).toBe(deliveryCalls);

    delivery.unavailable = false;
    worker.unavailable = false;
    delivery.revision = 2;
    const resumed = await engine.execute(
      command("resume", change, {
        operationId: "resume-stable-002",
        deliveryRevision: 2,
        receiptHash: HASH_B,
      }),
    );
    expect(resumed).toMatchObject({
      runId: created.runId,
      deliveryRevision: 2,
      state: "paused",
    });
    const callsAfterResume = [...worker.calls];
    await expect(
      engine.execute(
        command("resume", change, {
          operationId: "resume-stable-002",
          deliveryRevision: 2,
          receiptHash: HASH_B,
        }),
      ),
    ).resolves.toEqual(resumed);
    expect(worker.calls).toEqual(callsAfterResume);
    expect(readFileSync(path.join(consumerRoot, "sentinel.txt"), "utf8")).toBe(
      "main-workspace\n",
    );
    await engine.close();
  });

  it("uses the freshly recorded failover route between task phases", async () => {
    const change = "engine-phase-route-refresh";
    const consumerRoot = makeConsumer("phase-route-refresh");
    const delivery = new DeliverySource();
    delivery.set(change, plan(change, [task("T1-phase-route")]))
    const routes: Array<string | undefined> = [];
    let attempts = 0;
    const engine = requiredEngine().open({
      consumerRoot,
      stateRoot: resolveStateRoot({
        consumerRoot,
        xdgStateHome: temporaryRoot("phase-route-state"),
        homeDir: temporaryRoot("phase-route-home"),
      }),
      deliverySource: delivery,
      worker: {
        runAttempt: async (input: Record<string, unknown>) => {
          routes.push(
            typeof input.routeId === "string" ? input.routeId : undefined,
          );
          attempts += 1;
          if (attempts === 1) {
            return {
              kind: "paused",
              code: "seed-route-a",
              routeId: "route-a",
              routeFingerprint: HASH_A,
            };
          }
          if (input.phase === "red") {
            return {
              ...committed("red"),
              routeId: "route-b",
              routeFingerprint: HASH_B,
            };
          }
          return {
            kind: "paused",
            code: "green-on-route-b",
            routeId: "route-b",
            routeFingerprint: HASH_B,
          };
        },
        rebind: () => ({ ok: true, routeId: "route-a" }),
      },
      changeVerifier: new PausingVerifier(),
    });

    await expect(
      engine.execute(
        command("start", change, { operationId: "phase-route-start" }),
      ),
    ).resolves.toMatchObject({
      state: "paused",
      pause: { code: "seed-route-a" },
      routeBinding: { routeId: "route-a" },
    });
    await expect(
      engine.execute(
        command("resume", change, { operationId: "phase-route-resume" }),
      ),
    ).resolves.toMatchObject({
      state: "paused",
      pause: { code: "green-on-route-b" },
      routeBinding: { routeId: "route-b" },
    });
    expect(routes).toEqual([undefined, "route-a", "route-b"]);
    await engine.close();
  });

  it("uses updated repair policy without invalidating unchanged task evidence", async () => {
    const change = "engine-plan-contract-revision";
    const consumerRoot = makeConsumer("plan-contract-revision");
    const plan1 = plan(change, [task("T1-plan-contract")]) as ReturnType<
      typeof plan
    > & {
      verification: {
        artifactCorrection: { maxAttempts: number };
        repair: { maxAttempts: number };
      };
    };
    plan1.verification = {
      artifactCorrection: { maxAttempts: 2 },
      repair: { maxAttempts: 1 },
    };
    const plan2 = structuredClone(plan1);
    plan2.verification.repair.maxAttempts = 4;
    const attempts: Array<{ revision: number; maxAttempts: number }> = [];
    const engine = requiredEngine().open({
      consumerRoot,
      stateRoot: resolveStateRoot({
        consumerRoot,
        xdgStateHome: temporaryRoot("plan-contract-state"),
        homeDir: temporaryRoot("plan-contract-home"),
      }),
      deliverySource: {
        load: async (input: Record<string, unknown>) => {
          const revision = Number(input.deliveryRevision ?? 1);
          return {
            gate: "gate-b",
            revision,
            receiptHash: revision === 1 ? HASH_A : HASH_B,
            plan: revision === 1 ? plan1 : plan2,
          };
        },
      },
      worker: {
        runAttempt: async (input: Record<string, unknown>) => {
          attempts.push({
            revision: Number(input.deliveryRevision),
            maxAttempts: Number(
              (
                (input.plan as { verification: { repair: { maxAttempts: number } } })
                  .verification.repair
              ).maxAttempts,
            ),
          });
          return { kind: "paused", code: "inspect-plan-contract" };
        },
        rebind: () => ({ ok: true, routeId: "fixture-route" }),
      },
      changeVerifier: new PausingVerifier(),
    });

    await engine.execute(
      command("start", change, { operationId: "plan-contract-start" }),
    );
    await engine.execute(
      command("resume", change, {
        operationId: "plan-contract-revision-two",
        deliveryRevision: 2,
        receiptHash: HASH_B,
      }),
    );
    expect(attempts).toEqual([
      { revision: 1, maxAttempts: 1 },
      { revision: 1, maxAttempts: 4 },
    ]);
    await engine.close();
  });

  it("rejects a delivery revision older than the current engine binding", async () => {
    const change = "engine-monotonic-revision";
    const consumerRoot = makeConsumer("monotonic-revision");
    const delivery = new DeliverySource();
    delivery.set(change, plan(change, [task("T1-monotonic")]))
    const worker = new ScriptedWorker();
    worker.script("T1-monotonic:red", [
      { kind: "paused", code: "revision-one" },
      { kind: "paused", code: "revision-two" },
    ]);
    const engine = openEngine({ consumerRoot, delivery, worker });
    await engine.execute(
      command("start", change, { operationId: "monotonic-start" }),
    );
    delivery.revision = 2;
    await engine.execute(
      command("resume", change, {
        operationId: "monotonic-revision-two",
        deliveryRevision: 2,
        receiptHash: HASH_B,
      }),
    );

    await expect(
      engine.execute(
        command("resume", change, {
          operationId: "monotonic-revision-one-replay",
          deliveryRevision: 1,
          receiptHash: HASH_A,
        }),
      ),
    ).rejects.toThrow(/delivery-revision-stale/u);
    await expect(engine.execute(command("status", change))).resolves.toMatchObject(
      { deliveryRevision: 2 },
    );
    expect(worker.calls).toHaveLength(2);
    await engine.close();
  });

  it("reconciles a committed public binding before resuming engine execution", async () => {
    const change = "engine-binding-recovery";
    const consumerRoot = makeConsumer("binding-recovery");
    const xdgStateHome = temporaryRoot("binding-recovery-state");
    const homeDir = temporaryRoot("binding-recovery-home");
    const stateRoot = resolveStateRoot({ consumerRoot, xdgStateHome, homeDir });
    const plan1 = plan(change, [task("T1-binding-recovery")]) as ReturnType<
      typeof plan
    > & { revisionContract: number };
    plan1.revisionContract = 1;
    const plan2 = structuredClone(plan1);
    plan2.revisionContract = 2;
    const loads: number[] = [];
    const deliverySource = {
      load: async (input: Record<string, unknown>) => {
        const revision = Number(input.deliveryRevision ?? 1);
        loads.push(revision);
        return {
          gate: "gate-b",
          revision,
          receiptHash: revision === 1 ? HASH_A : HASH_B,
          plan: revision === 1 ? plan1 : plan2,
        };
      },
    };
    const firstWorker = new ScriptedWorker();
    firstWorker.script("T1-binding-recovery:red", [
      { kind: "paused", code: "revision-one-paused" },
    ]);
    let engine = requiredEngine().open({
      consumerRoot,
      stateRoot,
      deliverySource,
      worker: firstWorker,
      changeVerifier: new PausingVerifier(),
    });
    const started = await engine.execute(
      command("start", change, { operationId: "binding-recovery-start" }),
    );
    await engine.close();

    const store = RunStore.open(stateRoot);
    store.bindDelivery({
      runId: String(started.runId),
      gate: "gate-b",
      revision: 2,
      receiptHash: HASH_B,
      operationId: "simulated-split-binding",
    });
    store.close();

    const replacementWorker = new ScriptedWorker();
    replacementWorker.script("T1-binding-recovery:red", [
      { kind: "paused", code: "revision-two-paused" },
    ]);
    engine = requiredEngine().open({
      consumerRoot,
      stateRoot,
      deliverySource,
      worker: replacementWorker,
      changeVerifier: new PausingVerifier(),
    });
    await expect(
      engine.execute(
        command("resume", change, { operationId: "binding-recovery-resume" }),
      ),
    ).resolves.toMatchObject({
      deliveryRevision: 2,
      pause: { code: "revision-two-paused" },
    });
    expect(loads).toEqual([1, 2]);
    expect(replacementWorker.calls).toEqual([
      "T1-binding-recovery:red:r2:policy",
    ]);
    await engine.close();
  });

  it("recreates a missing engine row before replaying an existing created run", async () => {
    const change = "engine-row-recovery";
    const consumerRoot = makeConsumer("engine-row-recovery");
    const stateRoot = resolveStateRoot({
      consumerRoot,
      xdgStateHome: temporaryRoot("engine-row-state"),
      homeDir: temporaryRoot("engine-row-home"),
    });
    const store = RunStore.open(stateRoot);
    const created = store.startRun({
      stage: "abel-implement",
      change,
      operationId: "engine-row-store-start",
    });
    store.close();
    const worker = new ScriptedWorker();
    worker.script("T1-engine-row:red", [
      { kind: "paused", code: "engine-row-recovered" },
    ]);
    const engine = requiredEngine().open({
      consumerRoot,
      stateRoot,
      deliverySource: {
        load: async () => ({
          gate: "gate-b",
          revision: 1,
          receiptHash: HASH_A,
          plan: plan(change, [task("T1-engine-row")]),
        }),
      },
      worker,
      changeVerifier: new PausingVerifier(),
    });

    await expect(
      engine.execute(
        command("start", change, { operationId: "engine-row-replay-start" }),
      ),
    ).resolves.toMatchObject({
      runId: created.runId,
      state: "paused",
      pause: { code: "engine-row-recovered" },
    });
    expect(worker.calls).toEqual(["T1-engine-row:red:r1:policy"]);
    await engine.close();
  });

  it("rechecks an orphaned running operation when its lease later expires", async () => {
    const change = "engine-orphan-lease-expiry";
    let now = Date.now();
    const consumerRoot = makeConsumer("orphan-lease-expiry");
    const stateRoot = resolveStateRoot({
      consumerRoot,
      xdgStateHome: temporaryRoot("orphan-lease-state"),
      homeDir: temporaryRoot("orphan-lease-home"),
    });
    const deliverySource = new DeliverySource();
    deliverySource.set(change, plan(change, [task("T1-orphan-lease")]));
    const firstWorker = new ScriptedWorker();
    firstWorker.script("T1-orphan-lease:red", [
      { kind: "paused", code: "seed-orphan-lease" },
    ]);
    let engine = requiredEngine().open({
      consumerRoot,
      stateRoot,
      deliverySource,
      worker: firstWorker,
      changeVerifier: new PausingVerifier(),
      leaseTtlMs: 100,
      now: () => now,
    });
    const started = await engine.execute(
      command("start", change, { operationId: "orphan-lease-start" }),
    );
    await engine.close();

    const store = RunStore.open(stateRoot);
    store.transition({
      runId: String(started.runId),
      to: "running",
      operationId: "orphan-lease-running",
    });
    store.close();
    const expiresAt = now + 80;
    const database = new DatabaseSync(stateRoot.databasePath);
    database
      .prepare(
        `UPDATE workflow_engine_operations
         SET state = 'running', outcome_json = NULL, lease_token = ?,
             lease_expires_at = ?
         WHERE run_id = ? AND operation_id = ?`,
      )
      .run(
        "orphan-engine-lease",
        expiresAt,
        String(started.runId),
        "orphan-lease-start",
      );
    database
      .prepare(
        `UPDATE operations
         SET state = 'running', outcome_json = NULL, lease_token = ?,
             lease_expires_at = ?
         WHERE run_id = ? AND operation_id LIKE 'engine-%'`,
      )
      .run("orphan-authoritative-lease", expiresAt, String(started.runId));
    database
      .prepare(
        `UPDATE workflow_engine_tasks
         SET state = 'phase-running', pause_code = NULL
         WHERE run_id = ? AND task_id = ?`,
      )
      .run(String(started.runId), "T1-orphan-lease");
    database.close();

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      engine = requiredEngine().open({
        consumerRoot,
        stateRoot,
        deliverySource,
        worker: new ScriptedWorker(),
        changeVerifier: new PausingVerifier(),
        leaseTtlMs: 100,
        now: () => now,
      });
      await expect(engine.execute(command("status", change))).resolves.toMatchObject(
        { state: "running" },
      );
      // Advance both the lease clock and its scheduled recovery callback.
      now = expiresAt + 1;
      await vi.advanceTimersByTimeAsync(81);
      const status = await engine.execute(command("status", change));
      expect(status).toMatchObject({
        state: "paused",
        pause: { code: "operation-interrupted" },
        tasks: [
          {
            taskId: "T1-orphan-lease",
            state: "paused",
            phase: "red",
          },
        ],
      });
    } finally {
      await engine.close();
      vi.useRealTimers();
    }
  });

  it("limits independent task execution and preserves the capacity queue across restart", async () => {
    const change = "engine-capacity-queue";
    const consumerRoot = makeConsumer("capacity-queue");
    const xdgStateHome = temporaryRoot("capacity-state");
    const delivery = new DeliverySource();
    delivery.set(change, plan(change, Array.from({ length: 8 }, (_, i) => task(`T${i}`, { verificationLock: `lock-${i}` }))));
    let started!: () => void;
    const saturated = new Promise<void>(resolve => { started = resolve; });
    const calls: string[] = [];
    class HeldWorker extends ScriptedWorker {
      override async runAttempt(input: Record<string, unknown>): Promise<AttemptOutcome> {
        calls.push(String(input.taskId));
        if (calls.length === 4) started();
        const signal = input.signal as AbortSignal;
        return new Promise(resolve => {
          const abort = () => resolve({ kind: "operation-cancelled", code: "cancelled" });
          if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
        });
      }
    }
    let engine = openEngine({ consumerRoot, xdgStateHome, delivery, worker: new HeldWorker() });
    const running = engine.execute(command("start", change));
    try {
      await saturated;
      const status = await engine.execute(command("status", change));
      expect(calls).toEqual(["T0", "T1", "T2", "T3"]);
      expect(status.queue).toEqual(["T4", "T5", "T6", "T7"].map((taskId, i) => ({ taskId, position: i + 1, reason: "capacity" })));
    } finally { await engine.close(); await running; }
    let active = 0; let peak = 0;
    class MeasuringWorker extends ScriptedWorker {
      override async runAttempt(input: Record<string, unknown>): Promise<AttemptOutcome> {
        active++; peak = Math.max(peak, active);
        try { await new Promise(resolve => setTimeout(resolve, 5)); return committed(String(input.phase)); }
        finally { active--; }
      }
    }
    engine = openEngine({ consumerRoot, xdgStateHome, delivery, worker: new MeasuringWorker() });
    try {
      const result = await engine.execute(command("resume", change));
      expect(peak).toBe(4);
      expect((result.tasks as { state: string }[]).every(row => row.state === "verified")).toBe(true);
      expect(result.queue).toEqual([]);
    } finally { await engine.close(); }
  });

  it("refills a settled task slot while its original siblings remain active", async () => {
    const change = "continuous-refill";
    const consumerRoot = makeConsumer(change);
    const delivery = new DeliverySource();
    delivery.set(change, plan(change, Array.from({ length: 6 }, (_, i) => task(`T${i}`, { verificationLock: `lock-${i}` }))));
    const barrier = () => {
      let release!: () => void;
      const promise = new Promise<void>(resolve => { release = resolve; });
      return { promise, release };
    };
    const saturated = barrier();
    const fast = barrier();
    const slow = barrier();
    const refilled = barrier();
    const events: string[] = [];
    let active = 0;
    let peak = 0;
    class RefillWorker extends ScriptedWorker {
      override async runAttempt(input: Record<string, unknown>): Promise<AttemptOutcome> {
        const id = String(input.taskId);
        const phase = String(input.phase);
        events.push(`start:${id}:${phase}`);
        active++;
        peak = Math.max(peak, active);
        try {
          if (phase === "red") {
            if (id === "T3") { saturated.release(); await fast.promise; }
            else if (["T0", "T1", "T2"].includes(id)) await slow.promise;
            else if (id === "T4") refilled.release();
          }
          return committed(phase);
        } finally { active--; events.push(`settled:${id}:${phase}`); }
      }
    }
    const engine = openEngine({ consumerRoot, delivery, worker: new RefillWorker() });
    const running = engine.execute(command("start", change));
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await saturated.promise;
      const queued = await engine.execute(command("status", change));
      expect(queued.queue).toEqual([
        { taskId: "T4", position: 1, reason: "capacity" },
        { taskId: "T5", position: 2, reason: "capacity" },
      ]);
      fast.release();
      // The deadline only bounds a deadlock; ordering is proven by held barriers.
      await Promise.race([
        refilled.promise,
        new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("released slot did not refill while siblings were held")), 1500); }),
      ]);
      expect(events).toContain("settled:T3:green");
      expect(events).not.toContain("settled:T0:red");
      expect(events).not.toContain("settled:T1:red");
      expect(events).not.toContain("settled:T2:red");
      expect(peak).toBe(4);
      slow.release();
      const result = await running;
      expect((result.tasks as { state: string }[]).every(row => row.state === "verified")).toBe(true);
      expect(peak).toBe(4);
    } finally {
      if (deadline) clearTimeout(deadline);
      fast.release(); slow.release();
      await running;
      await engine.close();
    }
  });

  it("shares execution capacity across concurrent runs without starving queued work", async () => {
    const consumerRoot = makeConsumer("multi-run-capacity");
    const delivery = new DeliverySource();
    const changes = ["capacity-one", "capacity-two"];
    for (const change of changes) delivery.set(change, plan(change, Array.from({ length: 5 }, (_, i) => task(`T${i}`, { verificationLock: `lock-${i}` }))));
    let active = 0; let peak = 0;
    class MeasuringWorker extends ScriptedWorker {
      override async runAttempt(input: Record<string, unknown>): Promise<AttemptOutcome> {
        active++; peak = Math.max(peak, active);
        try { await new Promise(resolve => setTimeout(resolve, 10)); return committed(String(input.phase)); }
        finally { active--; }
      }
    }
    const engine = openEngine({ consumerRoot, delivery, worker: new MeasuringWorker() });
    try {
      const results = await Promise.all(changes.map(change => engine.execute(command("start", change, { operationId: `start-${change}` }))));
      expect(peak).toBe(4);
      for (const result of results) expect((result.tasks as { state: string }[]).every(row => row.state === "verified")).toBe(true);
    } finally { await engine.close(); }
  });

  it("wakes a run with active siblings when another run releases shared capacity", async () => {
    const consumerRoot = makeConsumer("capacity-events");
    const delivery = new DeliverySource();
    delivery.set("foreign", plan("foreign", ["F0", "F1", "F2"].map(id => task(id, { verificationLock: id }))));
    delivery.set("local", plan("local", ["A0", "A1"].map(id => task(id, { verificationLock: id }))));
    const barrier = () => { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; };
    const foreignStarted = barrier(); const localStarted = barrier(); const refilled = barrier();
    const fast = barrier(); const slow = barrier();
    const events: string[] = [];
    class CapacityWorker extends ScriptedWorker {
      override async runAttempt(input: Record<string, unknown>): Promise<AttemptOutcome> {
        const id = String(input.taskId);
        if (input.phase === "red") {
          events.push(`start:${id}`);
          if (id === "F2") foreignStarted.release();
          if (id === "A0") localStarted.release();
          if (id === "A1") refilled.release();
          await (id === "F0" ? fast.promise : slow.promise);
          events.push(`settled:${id}`);
        }
        return committed(String(input.phase));
      }
    }
    const engine = openEngine({ consumerRoot, delivery, worker: new CapacityWorker() });
    const foreign = engine.execute(command("start", "foreign", { operationId: "start-foreign" }));
    let local: Promise<EngineOutcome> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await foreignStarted.promise;
      local = engine.execute(command("start", "local", { operationId: "start-local" }));
      await localStarted.promise;
      fast.release();
      await Promise.race([refilled.promise, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("shared release did not wake the active run")), 1500); })]);
      expect(events).not.toContain("settled:A0");
      expect(events).not.toContain("settled:F1");
      expect(events).not.toContain("settled:F2");
    } finally {
      if (deadline) clearTimeout(deadline);
      fast.release(); slow.release();
      await Promise.all([foreign, local]);
      await engine.close();
    }
  });

  it("persists FIFO conflicts and committed sibling work across restart", async () => {
    const change = "engine-durable-queue";
    const consumerRoot = makeConsumer("queue");
    const xdgStateHome = temporaryRoot("queue-state");
    const delivery = new DeliverySource();
    delivery.set(
      change,
      plan(change, [
        task("T1-owner", { resource: "shared-resource" }),
        task("T2-waiter", { resource: "shared-resource" }),
        task("T3-sibling", {
          resource: "independent-resource",
          verificationLock: "independent-vitest-cadence-v2",
        }),
      ]),
    );
    const firstWorker = new ScriptedWorker();
    firstWorker.script("T1-owner:red", [
      { kind: "paused", code: "transport-exhausted" },
    ]);
    let engine = openEngine({
      consumerRoot,
      xdgStateHome,
      delivery,
      worker: firstWorker,
    });

    const paused = await engine.execute(
      command("start", change, { operationId: "start-queue-001" }),
    );
    expect(paused).toMatchObject({
      state: "paused",
      completed: false,
      tasks: expect.arrayContaining([
        { taskId: "T1-owner", state: "paused", phase: "red" },
        { taskId: "T2-waiter", state: "queued", phase: "red" },
        { taskId: "T3-sibling", state: "verified" },
      ]),
      queue: [
        { taskId: "T2-waiter", position: 1, reason: "conflict" },
      ],
    });
    await engine.close();

    const replacementWorker = new ScriptedWorker();
    const verifier = new PausingVerifier();
    engine = openEngine({
      consumerRoot,
      xdgStateHome,
      delivery,
      worker: replacementWorker,
      verifier,
    });
    const resumed = await engine.execute(
      command("resume", change, { operationId: "resume-queue-001" }),
    );
    expect(resumed).toMatchObject({
      runId: paused.runId,
      state: "paused",
      completed: false,
      pause: { code: "full-verification-held" },
      queue: [],
      tasks: expect.arrayContaining([
        { taskId: "T1-owner", state: "verified" },
        { taskId: "T2-waiter", state: "verified" },
        { taskId: "T3-sibling", state: "verified" },
      ]),
    });
    expect(replacementWorker.calls.some((entry) => entry.startsWith("T3"))).toBe(
      false,
    );
    expect(replacementWorker.calls.findIndex((entry) => entry.startsWith("T1-owner:green"))).toBeLessThan(
      replacementWorker.calls.findIndex((entry) => entry.startsWith("T2-waiter:red")),
    );
    expect(verifier.calls).toBe(1);
    await engine.close();
  });

  it("keeps later queued conflicts behind the FIFO head", async () => {
    const change = "engine-queued-peer-fifo";
    const consumerRoot = makeConsumer("queued-peer-fifo");
    const delivery = new DeliverySource();
    delivery.set(
      change,
      plan(change, [
        task("T1-owner"),
        task("T2-first-waiter"),
        task("T3-second-waiter"),
      ]),
    );
    const worker = new ScriptedWorker();
    worker.waitOn("T2-first-waiter:red");
    const engine = openEngine({ consumerRoot, delivery, worker });
    const controller = new AbortController();

    const running = engine.execute(
      command("start", change, { operationId: "start-queued-peer-fifo" }),
      controller.signal,
    );
    await worker.started;

    await expect(engine.execute(command("status", change))).resolves.toMatchObject({
      state: "running",
      tasks: expect.arrayContaining([
        { taskId: "T1-owner", state: "verified" },
        {
          taskId: "T2-first-waiter",
          state: "phase-running",
          phase: "red",
        },
        {
          taskId: "T3-second-waiter",
          state: "queued",
          phase: "red",
        },
      ]),
      queue: [
        { taskId: "T3-second-waiter", position: 1, reason: "conflict" },
      ],
    });
    expect(
      worker.calls.some((entry) => entry.startsWith("T3-second-waiter:")),
    ).toBe(false);

    controller.abort(new Error("cancel queued peer fixture"));
    await expect(running).resolves.toMatchObject({
      state: "paused",
      pause: { code: "operation-cancelled" },
    });
    await engine.close();
  });

  it("rebinds a paused task and cancels only the active operation", async () => {
    const change = "engine-rebind-cancel";
    const consumerRoot = makeConsumer("rebind");
    const delivery = new DeliverySource();
    delivery.set(change, plan(change, [task("T1-rebind")]));
    const worker = new ScriptedWorker();
    worker.script("T1-rebind:red", [
      { kind: "paused", code: "endpoint-unavailable" },
    ]);
    const engine = openEngine({ consumerRoot, delivery, worker });
    const paused = await engine.execute(
      command("start", change, { operationId: "start-rebind-001" }),
    );

    const rebound = await engine.execute(
      command("rebind", change, {
        operationId: "rebind-route-001",
        routeId: "implementation-secondary",
      }),
    );
    expect(rebound).toMatchObject({
      runId: paused.runId,
      state: "paused",
      routeBinding: { routeId: "implementation-secondary" },
      operation: { kind: "route-rebound" },
    });
    await expect(
      engine.execute(
        command("rebind", change, {
          operationId: "rebind-route-001",
          routeId: "implementation-secondary",
        }),
      ),
    ).resolves.toEqual(rebound);
    expect(worker.rebinds).toHaveLength(1);

    worker.waitOn("T1-rebind:red");
    const resuming = engine.execute(
      command("resume", change, { operationId: "resume-cancel-001" }),
    );
    await worker.started;
    await expect(engine.execute(command("status", change))).resolves.toMatchObject({
      state: "running",
      completed: false,
    });
    const cancelled = await engine.execute(
      command("cancel", change, { operationId: "cancel-active-001" }),
    );
    expect(cancelled).toMatchObject({
      runId: paused.runId,
      state: "paused",
      completed: false,
      pause: { code: "operation-cancelled" },
      operation: { kind: "operation-cancelled" },
    });
    await expect(resuming).resolves.toMatchObject({
      runId: paused.runId,
      state: "paused",
      completed: false,
    });

    const discarded = await engine.execute(
      command("discard", change, { operationId: "discard-after-cancel-001" }),
    );
    expect(discarded).toMatchObject({
      state: "discarded",
      completed: false,
      terminal: "discarded",
      legalCommands: ["status"],
    });
    await expect(
      engine.execute(
        command("discard", change, {
          operationId: "discard-after-cancel-001",
        }),
      ),
    ).resolves.toEqual(discarded);
    await engine.close();
  });

  it.each(["cancel", "discard"] as const)(
    "settles %s when an aborted change verifier rejects",
    async (intent) => {
      const change = `engine-${intent}-rejecting-verifier`;
      const consumerRoot = makeConsumer(`${intent}-rejecting-verifier`);
      const delivery = new DeliverySource();
      delivery.set(change, plan(change, [task(`T1-${intent}-verifier`)]));
      let verifierStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        verifierStarted = resolve;
      });
      const engine = requiredEngine().open({
        consumerRoot,
        stateRoot: resolveStateRoot({
          consumerRoot,
          xdgStateHome: temporaryRoot(`${intent}-verifier-state`),
          homeDir: temporaryRoot(`${intent}-verifier-home`),
        }),
        deliverySource: delivery,
        worker: new ScriptedWorker(),
        changeVerifier: {
          verify: async (input: Record<string, unknown>) => {
            verifierStarted();
            const signal = input.signal as AbortSignal;
            return new Promise((_resolve, reject) => {
              const abort = () => reject(signal.reason);
              if (signal.aborted) abort();
              else signal.addEventListener("abort", abort, { once: true });
            });
          },
        },
        leaseTtlMs: 10_000,
      });
      const starting = engine.execute(
        command("start", change, { operationId: `${intent}-verifier-start` }),
      );
      await started;

      const controlled = await engine.execute(
        command(intent, change, { operationId: `${intent}-verifier-control` }),
      );
      expect(controlled).toMatchObject(
        intent === "cancel"
          ? {
              state: "paused",
              pause: { code: "operation-cancelled" },
              operation: { kind: "operation-cancelled" },
            }
          : {
              state: "discarded",
              terminal: "discarded",
            },
      );
      await Promise.allSettled([starting]);
      await engine.close();
    },
  );

  it.each(["cancel", "discard"] as const)(
    "fences an active driver before a second host issues %s",
    async (intent) => {
      const change = `engine-cross-host-${intent}-fence`;
      const consumerRoot = makeConsumer(`cross-host-${intent}-fence`);
      const stateRoot = resolveStateRoot({
        consumerRoot,
        xdgStateHome: temporaryRoot(`cross-host-${intent}-fence-state`),
        homeDir: temporaryRoot(`cross-host-${intent}-fence-home`),
      });
      const delivery = new DeliverySource();
      delivery.set(change, plan(change, [task("T1-cross-host-fence")]));
      let workerStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        workerStarted = resolve;
      });
      let releaseWorker!: () => void;
      const release = new Promise<void>((resolve) => {
        releaseWorker = resolve;
      });
      const staleWorker = {
        runAttempt: async () => {
          workerStarted();
          await release;
          return { kind: "paused" as const, code: "stale-worker-result" };
        },
        rebind: () => ({ ok: true as const, routeId: "fixture-route" }),
      };
      const services = {
        consumerRoot,
        stateRoot,
        deliverySource: delivery,
        changeVerifier: new PausingVerifier(),
        leaseTtlMs: 10_000,
      };
      const owner = requiredEngine().open({ ...services, worker: staleWorker });
      const running = owner.execute(
        command("start", change, { operationId: "cross-host-owner" }),
      );
      await started;
      const controller = requiredEngine().open({
        ...services,
        worker: new ScriptedWorker(),
      });

      const controlled = await controller.execute(
        command(intent, change, { operationId: `cross-host-${intent}` }),
      );
      const expected =
        intent === "cancel"
          ? {
              state: "paused",
              pause: { code: "operation-cancelled" },
            }
          : {
              state: "discarded",
              terminal: "discarded",
            };
      expect(controlled).toMatchObject(expected);
      releaseWorker();
      await expect(running).rejects.toThrow(/lease-fenced/u);
      await expect(
        controller.execute(command("status", change)),
      ).resolves.toMatchObject(expected);
      await owner.close();
      await controller.close();
    },
  );

  it("rejects operation id reuse for a different command", async () => {
    const change = "engine-operation-command-binding";
    const consumerRoot = makeConsumer("operation-command-binding");
    const delivery = new DeliverySource();
    delivery.set(change, plan(change, [task("T1-command-binding")]));
    const worker = new ScriptedWorker();
    worker.script("T1-command-binding:red", [
      { kind: "paused", code: "command-binding-paused" },
    ]);
    const engine = openEngine({ consumerRoot, delivery, worker });
    await engine.execute(
      command("start", change, { operationId: "shared-command-id" }),
    );

    await expect(
      engine.execute(
        command("discard", change, { operationId: "shared-command-id" }),
      ),
    ).rejects.toThrow(/operation-command-mismatch/u);
    await expect(engine.execute(command("status", change))).resolves.toMatchObject(
      {
        state: "paused",
        pause: { code: "command-binding-paused" },
      },
    );
    await engine.close();
  });

  it("persists bounded context request refs in task status", async () => {
    const change = "engine-context-request-status";
    const consumerRoot = makeConsumer("context-request-status");
    const delivery = new DeliverySource();
    delivery.set(change, plan(change, [task("T1-context-request")]));
    const engine = requiredEngine().open({
      consumerRoot,
      stateRoot: resolveStateRoot({
        consumerRoot,
        xdgStateHome: temporaryRoot("context-request-state"),
        homeDir: temporaryRoot("context-request-home"),
      }),
      deliverySource: delivery,
      worker: {
        runAttempt: async () => ({
          kind: "paused" as const,
          code: "approved-context-needed",
          contextRequest: {
            code: "approved-context-needed",
            refs: [
              {
                kind: "requested-path",
                path: "src/approved.ts",
                access: "read",
              },
            ],
          },
        }),
        rebind: () => ({ ok: true as const, routeId: "fixture-route" }),
      },
      changeVerifier: new PausingVerifier(),
    });

    await expect(
      engine.execute(command("start", change)),
    ).resolves.toMatchObject({
      state: "paused",
      tasks: [
        {
          taskId: "T1-context-request",
          state: "paused",
          contextRequest: {
            code: "approved-context-needed",
            refs: [
              {
                kind: "requested-path",
                path: "src/approved.ts",
                access: "read",
              },
            ],
          },
        },
      ],
    });
    await engine.close();
  });

  it("retains context evidence without relaunching an exhausted incident after rebind", async () => {
    const change = "engine-context-request-resume";
    const consumerRoot = makeConsumer("context-request-resume");
    const xdgStateHome = temporaryRoot("context-request-resume-state");
    const delivery = new DeliverySource();
    delivery.set(change, plan(change, [task("T1-context-resume")]));
    const contextRequest = {
      code: "approved-context-needed" as const,
      refs: [
        {
          kind: "source-citation" as const,
          path: "test/fixture.test.ts",
          line: 1,
        },
        { kind: "contract-diagnostic" as const, ref: "phase-contract.readSet" },
      ],
    };
    const firstWorker = new ScriptedWorker();
    firstWorker.script("T1-context-resume:red", [
      {
        kind: "retryable",
        code: "approved-context-needed",
        retryPolicy: "artifact",
        contextRequest,
      },
      {
        kind: "retryable",
        code: "approved-context-needed",
        retryPolicy: "artifact",
        contextRequest,
      },
    ]);
    let engine = openEngine({
      consumerRoot,
      xdgStateHome,
      delivery,
      worker: firstWorker,
    });
    const paused = await engine.execute(
      command("start", change, { operationId: "context-request-start" }),
    );
    expect(paused).toMatchObject({
      state: "paused",
      tasks: [
        {
          taskId: "T1-context-resume",
          state: "retryable",
          contextRequest,
        },
      ],
    });
    await engine.close();

    const recoveryWorker = new ScriptedWorker();
    recoveryWorker.script("T1-context-resume:red", [
      { kind: "paused", code: "context-request-replayed" },
    ]);
    engine = openEngine({
      consumerRoot,
      xdgStateHome,
      delivery,
      worker: recoveryWorker,
    });
    await engine.execute(command("rebind", change, { operationId: "context-request-rebind", routeId: "context-recovery-route" }));
    const resumed = await engine.execute(
      command("resume", change, { operationId: "context-request-resume" }),
    );

    expect(resumed).toMatchObject({
      runId: paused.runId,
      state: "paused",
      pause: { code: "approved-context-needed" },
      recovery: { exhausted: true },
    });
    expect(recoveryWorker.contextRequests).toEqual([]);
    expect(resumed.tasks).toMatchObject([{ contextRequest }]);
    expect(recoveryWorker.artifactCorrections).toEqual([]);
    await engine.close();
  });

  it("does not classify a different failure code as a repeated attempt", async () => {
    const change = "engine-attempt-diagnostic-code";
    const consumerRoot = makeConsumer("attempt-diagnostic-code");
    const delivery = new DeliverySource();
    delivery.set(change, plan(change, [task("T1-diagnostic-code")]));
    const worker = new ScriptedWorker();
    const diagnostic = {
      finalCategory: "mixed",
      submitAttempts: 1,
      schema: "invalid",
      identityMismatch: ["task"],
    };
    worker.script("T1-diagnostic-code:red", [
      {
        kind: "paused",
        code: "invalid-structural-result",
        attemptDiagnostic: diagnostic,
      },
      {
        kind: "paused",
        code: "structural-identity-mismatch",
        attemptDiagnostic: diagnostic,
      },
    ]);
    const engine = openEngine({ consumerRoot, delivery, worker });
    await engine.execute(
      command("start", change, { operationId: "diagnostic-code-start" }),
    );
    const resumed = await engine.execute(
      command("resume", change, { operationId: "diagnostic-code-resume" }),
    );

    expect(resumed).toMatchObject({
      pause: {
        code: "structural-identity-mismatch",
        diagnostic: {
          sameFailureCount: 1,
          fingerprint: expect.stringMatching(/^[a-f0-9]{16}$/u),
        },
      },
    });
    expect(
      (resumed.pause as { diagnostic: Record<string, unknown> }).diagnostic,
    ).not.toHaveProperty("action");
    await engine.close();
  });

  it("reclassifies a persisted legacy context approval on the same delivery and reopens Red correction", async () => {
    const change = "engine-legacy-context-recovery";
    const consumerRoot = makeConsumer("legacy-context-recovery");
    const xdgStateHome = temporaryRoot("legacy-context-recovery-state");
    const delivery = new DeliverySource();
    const correctionTask = task("T1-legacy-context", {
      write: "src/game.ts",
    });
    correctionTask.phases.red.write = ["tests/foundation.test.mjs"];
    correctionTask.phases.green.read = [
      "package.json",
      "tests/foundation.test.mjs",
      "src/game.ts",
    ];
    correctionTask.phases.green.write = ["src/game.ts"];
    delivery.set(change, plan(change, [correctionTask]));
    const contextRequest = {
      code: "boundary-review-needed" as const,
      refs: [
        "tests/foundation.test.mjs:209",
        "tests/foundation.test.mjs:237",
        "phase-contract.writeSet",
        "scripts/AGENTS.md",
      ],
    };
    const firstWorker = new ScriptedWorker();
    firstWorker.script("T1-legacy-context:green", [
      {
        kind: "approval-needed",
        code: "boundary-review-needed",
        contextRequest,
      },
    ]);
    let engine = openEngine({
      consumerRoot,
      xdgStateHome,
      delivery,
      worker: firstWorker,
    });
    const legacyApproval = await engine.execute(
      command("start", change, { operationId: "legacy-context-start" }),
    );
    expect(legacyApproval).toMatchObject({
      state: "approval-needed",
      deliveryRevision: 1,
      approval: {
        category: "path-boundary",
        requiredGates: ["gate-b"],
        continuation: { action: "amend", change: change, batchId: expect.any(String) },
      },
      tasks: [
        {
          taskId: "T1-legacy-context",
          state: "approval-needed",
          phase: "green",
        },
      ],
    });
    expect(
      firstWorker.calls.map((call) => call.replace(/:r\d+:.*$/u, "")),
    ).toEqual(["T1-legacy-context:red", "T1-legacy-context:green"]);
    await engine.close();

    const recoveryWorker = new ScriptedWorker();
    recoveryWorker.script("T1-legacy-context:green", [
      { kind: "paused", code: "red-artifact-constraint" },
    ]);
    engine = openEngine({
      consumerRoot,
      xdgStateHome,
      delivery,
      worker: recoveryWorker,
    });
    const recovered = await engine.execute(command("status", change));
    expect(recovered).toMatchObject({
      runId: legacyApproval.runId,
      state: "paused",
      deliveryRevision: 1,
      pause: { code: "red-artifact-constraint" },
      legalCommands: expect.arrayContaining(["resume"]),
      tasks: [
        {
          taskId: "T1-legacy-context",
          state: "retryable",
          phase: "green",
          contextRequest: {
            refs: [
              {
                kind: "source-citation",
                path: "tests/foundation.test.mjs",
                line: 209,
              },
              {
                kind: "source-citation",
                path: "tests/foundation.test.mjs",
                line: 237,
              },
              {
                kind: "contract-diagnostic",
                ref: "phase-contract.writeSet",
              },
              {
                kind: "requested-path",
                path: "scripts/AGENTS.md",
                access: "read",
              },
            ],
          },
        },
      ],
    });
    expect(JSON.stringify(recovered)).not.toMatch(/designRequest/u);

    const resumed = await engine.execute(
      command("resume", change, { operationId: "legacy-context-resume" }),
    );
    expect(resumed).toMatchObject({
      runId: legacyApproval.runId,
      state: "paused",
      deliveryRevision: 1,
      pause: { code: "red-artifact-constraint" },
      tasks: [
        {
          taskId: "T1-legacy-context",
          state: "paused",
          phase: "green",
        },
      ],
    });
    expect(
      recoveryWorker.calls.map((call) => call.replace(/:r\d+:.*$/u, "")),
    ).toEqual(["T1-legacy-context:green"]);
    expect(recoveryWorker.artifactCorrections).toEqual([
      {
        code: "red-artifact-constraint",
        attempt: 1,
        maxAttempts: 2,
        contextRequest: {
          code: "boundary-review-needed",
          refs: [
            {
              kind: "source-citation",
              path: "tests/foundation.test.mjs",
              line: 209,
            },
            {
              kind: "source-citation",
              path: "tests/foundation.test.mjs",
              line: 237,
            },
            {
              kind: "contract-diagnostic",
              ref: "phase-contract.writeSet",
            },
            {
              kind: "requested-path",
              path: "scripts/AGENTS.md",
              access: "read",
            },
          ],
        },
      },
    ]);
    await engine.close();
  });

  it("reclassifies all recoverable legacy rows without bypassing a retained approval", async () => {
    const change = "engine-legacy-mixed-approvals";
    const consumerRoot = makeConsumer("legacy-mixed-approvals");
    const xdgStateHome = temporaryRoot("legacy-mixed-approvals-state");
    const correctionTask = task("T1-recoverable", {
      write: "src/game.ts",
    });
    correctionTask.phases.red.write = ["tests/foundation.test.mjs"];
    correctionTask.phases.green.read = [
      "package.json",
      "tests/foundation.test.mjs",
      "src/game.ts",
    ];
    correctionTask.phases.green.write = ["src/game.ts"];
    const authorityTask = task("T2-authority");
    const delivery = new DeliverySource();
    delivery.set(change, plan(change, [correctionTask, authorityTask]));
    const worker = new ScriptedWorker();
    worker.script("T1-recoverable:green", [
      {
        kind: "approval-needed",
        code: "boundary-review-needed",
        contextRequest: {
          code: "boundary-review-needed",
          refs: ["tests/foundation.test.mjs:209"],
        },
      },
    ]);
    worker.script("T2-authority:red", [
      {
        kind: "approval-needed",
        code: "boundary-review-needed",
        contextRequest: {
          code: "boundary-review-needed",
          refs: [
            {
              kind: "requested-path",
              path: "new-product/path.ts",
              access: "write",
            },
          ],
        },
      },
    ]);
    let engine = openEngine({
      consumerRoot,
      xdgStateHome,
      delivery,
      worker,
    });
    const approval = await engine.execute(
      command("start", change, { operationId: "mixed-approvals-start" }),
    );
    expect(approval).toMatchObject({ state: "approval-needed" });
    await engine.close();

    const runStore = RunStore.open(
      resolveStateRoot({
        consumerRoot,
        xdgStateHome,
        homeDir: temporaryRoot("legacy-mixed-approvals-home"),
      }),
    );
    runStore.transition({
      runId: String(approval.runId),
      to: "paused",
      operationId: "simulate-legacy-approval-bypass",
      code: "red-artifact-constraint",
    });
    runStore.close();
    engine = openEngine({
      consumerRoot,
      xdgStateHome,
      delivery,
      worker,
    });

    const status = await engine.execute(command("status", change));
    expect(status).toMatchObject({
      state: "approval-needed",
      legalCommands: ["status", "discard"],
      pause: { code: "boundary-review-needed" },
      approval: {
        category: "path-boundary",
        refs: ["new-product/path.ts"],
      },
      tasks: [
        {
          taskId: "T1-recoverable",
          state: "retryable",
          phase: "green",
        },
        {
          taskId: "T2-authority",
          state: "approval-needed",
          phase: "red",
        },
      ],
    });
    await expect(
      engine.execute(
        command("resume", change, { operationId: "mixed-approvals-resume" }),
      ),
    ).rejects.toThrow(/approval-receipt-required/u);
    await engine.close();
  });

  it("retains a genuine legacy context approval and requires a newer receipt", async () => {
    const change = "engine-legacy-real-approval";
    const consumerRoot = makeConsumer("legacy-real-approval");
    const delivery = new DeliverySource();
    delivery.set(change, plan(change, [task("T1-real-approval")]));
    const worker = new ScriptedWorker();
    worker.script("T1-real-approval:red", [
      {
        kind: "approval-needed",
        code: "boundary-review-needed",
        contextRequest: {
          code: "boundary-review-needed",
          refs: [{ kind: "requested-path", path: "new-product/path.ts", access: "write" }],
        },
      },
    ]);
    const engine = openEngine({ consumerRoot, delivery, worker });
    const approval = await engine.execute(
      command("start", change, { operationId: "real-approval-start" }),
    );
    expect(approval).toMatchObject({
      state: "approval-needed",
      approval: {
        category: "path-boundary",
        requiredGates: ["gate-b"],
      },
    });
    await expect(engine.execute(command("status", change))).resolves.toMatchObject(
      {
        state: "approval-needed",
        approval: { category: "path-boundary" },
      },
    );
    await expect(
      engine.execute(
        command("resume", change, { operationId: "real-approval-resume" }),
      ),
    ).rejects.toThrow(/approval-receipt-required/u);
    await engine.close();
  });

  it.each(["cancel", "discard"] as const)(
    "settles apply recovery before exposing pending %s",
    async (intent) => {
      const change = `engine-apply-${intent}`;
      const consumerRoot = makeConsumer(intent);
      const delivery = new DeliverySource();
      delivery.set(change, plan(change, [task(`T1-${intent}`)]));
      const worker = new ScriptedWorker();
      const application = new RecoveringApplication();
      const engine = openEngine({
        consumerRoot,
        delivery,
        worker,
        verifier: new PassingVerifier(),
        application,
      });

      const starting = engine.execute(
        command("start", change, { operationId: `start-apply-${intent}` }),
      );
      await application.started;
      await expect(engine.execute(command("status", change))).resolves.toMatchObject({
        state: "applying",
        completed: false,
      });
      const controlled = await engine.execute(
        command(intent, change, { operationId: `${intent}-apply-active` }),
      );
      expect(controlled).toMatchObject(
        intent === "cancel"
          ? {
              state: "paused",
              completed: false,
              pause: { code: "operation-cancelled" },
            }
          : {
              state: "discarded",
              completed: false,
              terminal: "discarded",
            },
      );
      await expect(starting).resolves.toMatchObject({ state: controlled.state });
      expect(application.events).toEqual([
        expect.stringMatching(/^begin:/u),
        expect.stringMatching(new RegExp(`^request:${intent}:`, "u")),
        expect.stringMatching(/^recover:/u),
      ]);
      expect(readFileSync(path.join(consumerRoot, "sentinel.txt"), "utf8")).toBe(
        "main-workspace\n",
      );
      await engine.close();
    },
  );

  it("persists a resumable handoff fact without performing selector cutover", async () => {
    const change = "engine-bootstrap-path";
    const consumerRoot = makeConsumer("handoff");
    const xdgStateHome = temporaryRoot("handoff-state");
    const delivery = new DeliverySource();
    delivery.set(change, plan(change, [task("T1-handoff")]));
    const worker = new ScriptedWorker();
    worker.script("T1-handoff:red", [
      { kind: "paused", code: "bootstrap-fixture" },
    ]);
    let engine = openEngine({
      consumerRoot,
      xdgStateHome,
      delivery,
      worker,
    });
    const run = await engine.execute(
      command("start", change, { operationId: "start-handoff-001" }),
    );
    const binding = {
      operationId: "prepare-handoff-001",
      runId: run.runId,
      change: "redesign-abel-workflow-control-plane",
      receiptHash: HASH_C,
      graphHash:
        "e0380f20872d420d8c1c2924144f4ad6fb4c31a58950615a5211d1b7ef78c3c7",
      acceptanceHash: HASH_B,
    };
    const prepared = engine.prepareBootstrapHandoff(binding);
    expect(prepared).toMatchObject({
      state: "prepared",
      runId: run.runId,
      receiptHash: HASH_C,
      selectorBeforeCutover: "bootstrap",
      selectorCasPending: true,
    });
    expect(engine.prepareBootstrapHandoff(binding)).toEqual(prepared);
    await engine.close();

    engine = openEngine({
      consumerRoot,
      xdgStateHome,
      delivery,
      worker: new ScriptedWorker(),
    });
    expect(engine.inspectBootstrapHandoff(HASH_C)).toEqual(prepared);
    await engine.close();
  });
});
