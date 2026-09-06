import { compareCanonicalStrings } from "./canonical.ts";
import { configureSqlite, ensureSqliteSchema } from "./sqlite-schema.ts";
import { ROUTE_HEALTH_SCHEMA } from "./storage-schema.ts";
import { hasVerificationLifecycle } from "./workflow-policy.ts";

interface DurableResourceInput {
  runId: string;
  deliveryRevision: number;
  plan?: ImplementPlan;
  baselineRevisionId?: string;
  currentWorkspaceRevisionId?: string;
}

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  ApplyTransaction,
  verifyCumulativeRevision,
} from "./apply-transaction.ts";
import { ArtifactStore } from "./artifact-store.ts";
import {
  diffWritePaths,
  type StructuredVerificationContract,
} from "./contracts.ts";
import type { ImplementPlan, PlanTaskDraft } from "./delivery-compiler.ts";
import type { RoutePolicy, WorkerRoutePolicy } from "./route-policy.ts";
import { observeSafePath } from "./safe-path.ts";
import type { ResolvedStateRoot } from "./state-root.ts";
import type { CandidateArtifactSubmission } from "./submit-tool.ts";
import {
  type BeginCandidateInput,
  TASK_LEDGER_LIMITS,
  TaskLedger,
  type VerifiedTaskEvent,
} from "./task-ledger.ts";
import { type RouteHealthStore, RunWorkerBroker } from "./worker-broker.ts";
import {
  type DependencyContractEntry,
  DependencyManifestError,
  type DurableCandidateProposal,
  type DurableVerificationScope,
  decideRecoveryAction,
  deliveryBoundPaths,
  deliveryTrackingPath,
  dependencyContract,
  emitWorkflowActivity,
  expectedClassification,
  hash,
  hasUnapprovedDependencyChange,
  IDENTIFIER,
  implementationRouteRequirements,
  isRecord,
  LOCKFILES,
  type RedArtifactCorrection,
  SHA256,
  semanticRouteFailure,
  type WorkflowApplication,
  type WorkflowApplicationContext,
  type WorkflowAttemptOutcome,
  type WorkflowChangeVerifier,
  type WorkflowContextRequest,
  type WorkflowDeliverySource,
  type WorkflowRecoveryFeedback,
  type WorkflowRouteFacts,
  type WorkflowRunLifecycle,
  type WorkflowWorker,
  workspaceEntryEqual,
} from "./workflow-policy.ts";
import { WorkflowEngine } from "./workflow-state-machine.ts";
import { type WorkspaceRevision, WorkspaceStore } from "./workspace-store.ts";
export type DurablePhaseVerificationResult =
  | {
      ok: true;
      exitCode: number;
      classification: "expected-red" | "expected-green" | "expected-refactor";
      diagnostic: { kind: "assertion" | "compiler"; id: string };
    }
  | {
      ok: false;
      kind: "paused" | "retryable" | "approval-needed";
      code: string;
    };

export type DurableChangeVerificationResult =
  | {
      ok: true;
      exitCode: 0;
      classification: string;
      failureIdentities?: string[];
    }
  | {
      ok: false;
      kind:
        | "artifact"
        | "environment"
        | "verification"
        | "verification-adapter"
        | "approval-boundary"
        | "cancelled";
      code: string;
      failureIdentities?: string[];
    };

interface DurableVerificationObservation {
  status: "passed" | "failed";
  verificationId: string;
  failureIdentities: string[];
  code?: string;
}

interface DurableVerificationBaseline {
  revisionId: string;
  targetContracts: Array<{
    taskId: string;
    verificationId: string;
    expectedFailure: string;
  }>;
  affected: Array<{
    taskId: string;
    observation: DurableVerificationObservation;
  }>;
  fullSuite: DurableVerificationObservation;
}

type DurableObservedVerification =
  | { ok: true; observation: DurableVerificationObservation }
  | {
      ok: false;
      outcome:
        | { kind: "paused"; code: string }
        | { kind: "approval-needed"; code: string }
        | { kind: "operation-cancelled"; code: "cancelled" };
    };

type DurableBaselineResult =
  | { ok: true; baseline: DurableVerificationBaseline }
  | Extract<DurableObservedVerification, { ok: false }>;

type DurableAffectedResult =
  | { kind: "verified"; attribution: "none" | "pre-existing" }
  | {
      kind: "repairable";
      attribution: "introduced";
      failureIdentities: string[];
    }
  | Extract<DurableObservedVerification, { ok: false }>["outcome"];

export interface DurableWorkflowEngineOptions {
  consumerRoot: string;
  stateRoot: ResolvedStateRoot;
  deliverySource: WorkflowDeliverySource;
  routePolicy: RoutePolicy;
  proposeCandidate(input: {
    runId: string;
    operationId: string;
    deliveryRevision: number;
    taskId: string;
    phase: "red" | "green" | "refactor";
    task: PlanTaskDraft;
    workspaceRoot: string;
    ledgerProjection: unknown;
    candidateArtifact: CandidateArtifactSubmission;
    route: WorkerRoutePolicy;
    repair?: {
      attempt: number;
      attribution: "introduced";
      failureIdentities: string[];
    };
    artifactCorrection?: RedArtifactCorrection;
    contextRequest?: WorkflowContextRequest;
    contextReadPaths?: string[];
    recoveryFeedback?: WorkflowRecoveryFeedback;
    signal: AbortSignal;
    onHeaders(): void;
    onProgress(): void;
  }): Promise<DurableCandidateProposal>;
  verifyPhase(input: {
    executionWritePaths?: readonly string[];
    runId: string;
    deliveryRevision: number;
    taskId: string;
    phase: "red" | "green" | "refactor";
    root: string;
    verification: StructuredVerificationContract;
    signal: AbortSignal;
  }): Promise<DurablePhaseVerificationResult>;
  verifyChange(input: {
    runId: string;
    deliveryRevision: number;
    root: string;
    plan: ImplementPlan;
    scope?: DurableVerificationScope;
    verification?: StructuredVerificationContract;
    taskId?: string;
    signal: AbortSignal;
  }): Promise<DurableChangeVerificationResult>;
  now?: () => number;
  leaseTtlMs?: number;
  workHardLimit?: number;
  verificationPolicy?: string;
  verificationEnvironment?(
    plan: ImplementPlan,
    signal: AbortSignal,
  ): Promise<string>;
}

interface DurableRunResources {
  runId: string;
  root: string;
  plan: ImplementPlan;
  deliveryRevision: number;
  artifacts: ArtifactStore;
  workspaces: WorkspaceStore;
  ledgers: Map<number, TaskLedger>;
  transactions: ApplyTransaction;
  baselineRevisionId: string;
  currentRevisionId: string;
  mergeTail: Promise<void>;
  verificationFact?: object;
  baselinePromises: Map<number, Promise<DurableBaselineResult>>;
  environmentIdentity?: string;
  closed: boolean;
}

interface DurablePhaseFact {
  kind: "phase-verified" | "repair-verified";
  phase: "red" | "green" | "refactor";
  isolatedRevisionId: string;
  outputFacts: Array<
    | { path: string; kind: "absent" }
    | { path: string; kind: "file"; hash: string; bytes: number }
  >;
}

interface DurableCandidateCommit {
  artifactHash: string;
  isolatedRevisionId: string;
  exitCode: number;
  classification: "expected-red" | "expected-green" | "expected-refactor";
  diagnostic: { kind: "assertion" | "compiler"; id: string };
  outputFacts: DurablePhaseFact["outputFacts"];
  routeId: string;
  routeFingerprint: string;
}

type DurableRepairResult =
  | { kind: "repair-committed"; commit: DurableCandidateCommit }
  | Exclude<WorkflowAttemptOutcome, { kind: "phase-committed" }>;

type DurableRouteHealth = Parameters<RouteHealthStore["set"]>[1];

class DurableRouteHealthStore implements RouteHealthStore {
  readonly #databasePath: string;
  #database?: DatabaseSync;
  #closed = false;

  constructor(databasePath: string) {
    this.#databasePath = databasePath;
  }

  #open(): DatabaseSync {
    if (this.#closed) throw new Error("route-health-store-closed");
    if (this.#database) return this.#database;
    const database = new DatabaseSync(this.#databasePath);
    try {
      configureSqlite(database);
      ensureSqliteSchema(database, ROUTE_HEALTH_SCHEMA);
    } catch (error) {
      database.close();
      throw error;
    }

    this.#database = database;
    return database;
  }

  get(fingerprint: string): DurableRouteHealth | undefined {
    if (!SHA256.test(fingerprint)) return undefined;
    const row = this.#open()
      .prepare(
        `SELECT state, next_half_open_at, projection_json
         FROM route_health WHERE route_fingerprint = ?`,
      )
      .get(fingerprint) as
      | {
          state: string;
          next_half_open_at: number | null;
          projection_json: string;
        }
      | undefined;
    if (!row || !["healthy", "open", "half-open"].includes(row.state)) {
      return undefined;
    }
    let projection: unknown;
    try {
      projection = JSON.parse(row.projection_json);
    } catch {
      return undefined;
    }
    if (!isRecord(projection) || projection.state !== row.state) {
      return undefined;
    }
    const retryAt = row.next_half_open_at ?? undefined;
    const lastCode =
      typeof projection.lastCode === "string" &&
      projection.lastCode.length > 0 &&
      projection.lastCode.length <= 128
        ? projection.lastCode
        : undefined;
    const probeExpiresAt =
      Number.isSafeInteger(projection.probeExpiresAt) &&
      (projection.probeExpiresAt as number) >= 0
        ? (projection.probeExpiresAt as number)
        : undefined;
    return {
      state: row.state as DurableRouteHealth["state"],
      ...(retryAt === undefined ? {} : { retryAt }),
      ...(projection.probeInFlight === true ? { probeInFlight: true } : {}),
      ...(probeExpiresAt === undefined ? {} : { probeExpiresAt }),
      ...(lastCode === undefined ? {} : { lastCode }),
    };
  }

  set(fingerprint: string, health: DurableRouteHealth): void {
    if (
      !SHA256.test(fingerprint) ||
      !["healthy", "open", "half-open"].includes(health.state) ||
      (health.retryAt !== undefined &&
        (!Number.isSafeInteger(health.retryAt) || health.retryAt < 0)) ||
      (health.probeExpiresAt !== undefined &&
        (!Number.isSafeInteger(health.probeExpiresAt) ||
          health.probeExpiresAt < 0))
    ) {
      throw new Error("route-health-fact-invalid");
    }
    const projection = {
      state: health.state,
      ...(health.probeInFlight ? { probeInFlight: true } : {}),
      ...(health.probeExpiresAt === undefined
        ? {}
        : { probeExpiresAt: health.probeExpiresAt }),
      ...(health.lastCode ? { lastCode: health.lastCode.slice(0, 128) } : {}),
    };
    this.#open()
      .prepare(
        `INSERT INTO route_health(
           route_fingerprint, state, next_half_open_at, projection_json
         ) VALUES (?, ?, ?, ?)
         ON CONFLICT(route_fingerprint) DO UPDATE SET
           state = excluded.state,
           next_half_open_at = excluded.next_half_open_at,
           projection_json = excluded.projection_json`,
      )
      .run(
        fingerprint,
        health.state,
        health.retryAt ?? null,
        JSON.stringify(projection),
      );
  }

  close(): void {
    if (this.#closed) return;
    this.#database?.close();
    this.#closed = true;
  }
}

function ensurePrivateRunDirectory(directory: string): void {
  const existing = lstatSync(directory, { throwIfNoEntry: false });
  if (existing) {
    if (existing.isSymbolicLink() || !existing.isDirectory()) {
      throw new Error("workflow-run-data-unsafe");
    }
    return;
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const created = lstatSync(directory);
  if (created.isSymbolicLink() || !created.isDirectory()) {
    throw new Error("workflow-run-data-unsafe");
  }
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function verificationIdentities(
  result: DurableChangeVerificationResult,
  verification: StructuredVerificationContract,
  scope: DurableVerificationScope,
): string[] {
  // Keep the complete comparison set; only Worker/status summaries are bounded.
  const supplied = result.failureIdentities;
  if (
    Array.isArray(supplied) &&
    supplied.every(
      (identity) => typeof identity === "string" && SHA256.test(identity),
    )
  ) {
    return [...new Set(supplied)].sort();
  }
  if (result.ok) return [];
  return [hash("verification-failure", scope, verification.id, result.code)];
}

function verificationBaselineFact(
  baseline: DurableVerificationBaseline,
  artifacts: ArtifactStore,
) {
  // Complete private evidence must not inherit the bounded model projection limits.
  const artifact = artifacts.put(Buffer.from(JSON.stringify(baseline)));
  return {
    revisionId: baseline.revisionId,
    baselineArtifactHash: artifact.hash,
  };
}

function parseVerificationBaseline(
  value: unknown,
  artifacts: ArtifactStore,
): DurableVerificationBaseline {
  if (isRecord(value) && typeof value.baselineArtifactHash === "string") {
    const revisionId = value.revisionId;
    value = JSON.parse(
      Buffer.from(artifacts.read(value.baselineArtifactHash)).toString("utf8"),
    );
    if (!isRecord(value) || value.revisionId !== revisionId)
      throw new Error("workflow-verification-baseline-conflict");
  }
  if (
    !isRecord(value) ||
    typeof value.revisionId !== "string" ||
    !SHA256.test(value.revisionId) ||
    !Array.isArray(value.targetContracts) ||
    !Array.isArray(value.affected) ||
    !isRecord(value.fullSuite)
  ) {
    throw new Error("workflow-verification-baseline-invalid");
  }
  const baseline = structuredClone(
    value,
  ) as unknown as DurableVerificationBaseline;
  const validObservation = (observation: DurableVerificationObservation) =>
    (observation.status === "passed" || observation.status === "failed") &&
    typeof observation.verificationId === "string" &&
    IDENTIFIER.test(observation.verificationId) &&
    Array.isArray(observation.failureIdentities) &&
    observation.failureIdentities.every((identity) => SHA256.test(identity)) &&
    (observation.code === undefined || typeof observation.code === "string");
  if (
    !baseline.targetContracts.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.taskId === "string" &&
        typeof entry.verificationId === "string" &&
        typeof entry.expectedFailure === "string",
    ) ||
    !baseline.affected.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.taskId === "string" &&
        isRecord(entry.observation) &&
        validObservation(entry.observation),
    ) ||
    !validObservation(baseline.fullSuite)
  ) {
    throw new Error("workflow-verification-baseline-invalid");
  }
  return baseline;
}

function runGitApply(
  root: string,
  diff: Uint8Array,
  checkOnly: boolean,
  signal: AbortSignal,
): Promise<"ok" | "failed" | "cancelled"> {
  if (signal.aborted) return Promise.resolve("cancelled");
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: "ok" | "failed" | "cancelled") => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      resolve(value);
    };
    const child = spawn(
      "git",
      [
        "apply",
        ...(checkOnly ? ["--check"] : []),
        "--recount",
        "--whitespace=nowarn",
        "-",
      ],
      { cwd: root, shell: false, stdio: ["pipe", "ignore", "ignore"] },
    );
    const abort = () => {
      child.kill("SIGTERM");
      settle("cancelled");
    };
    signal.addEventListener("abort", abort, { once: true });
    child.once("error", () => settle(signal.aborted ? "cancelled" : "failed"));
    child.once("close", (code) =>
      settle(signal.aborted ? "cancelled" : code === 0 ? "ok" : "failed"),
    );
    child.stdin.on("error", () => undefined);
    child.stdin.end(Buffer.from(diff));
  });
}

function revisionChanges(
  root: string,
  paths: readonly string[],
): Record<
  string,
  { kind: "absent" } | { kind: "file"; bytes: Uint8Array; mode: number }
> {
  const changes: Record<
    string,
    { kind: "absent" } | { kind: "file"; bytes: Uint8Array; mode: number }
  > = {};
  for (const relative of [...new Set(paths)].sort()) {
    const observation = observeSafePath(root, relative);
    if (observation.kind === "absent") {
      changes[relative] = { kind: "absent" };
      continue;
    }
    if (observation.kind !== "file") {
      throw new Error("workflow-candidate-path-unsafe");
    }
    const target = path.join(root, ...relative.split("/"));
    const stat = lstatSync(target);
    changes[relative] = {
      kind: "file",
      bytes: readFileSync(target),
      mode: stat.mode & 0o777,
    };
  }
  return changes;
}

class DurableWorkflowComposition
  implements
    WorkflowWorker,
    WorkflowChangeVerifier,
    WorkflowApplication,
    WorkflowRunLifecycle
{
  readonly #options: DurableWorkflowEngineOptions;
  readonly #routeHealth: DurableRouteHealthStore;
  #broker: RunWorkerBroker;
  readonly #runs = new Map<string, DurableRunResources>();

  constructor(options: DurableWorkflowEngineOptions) {
    this.#options = options;
    this.#routeHealth = new DurableRouteHealthStore(
      options.stateRoot.databasePath,
    );
    this.#broker = new RunWorkerBroker(options.routePolicy, {
      ...(options.now ? { now: options.now } : {}),
      healthStore: this.#routeHealth,
    });
  }

  updateRoutePolicy(policy: RoutePolicy): void {
    this.#broker.updatePolicy(policy);
  }

  async #refreshEnvironment(
    resources: DurableRunResources,
    signal: AbortSignal,
  ): Promise<void> {
    if (!this.#options.verificationEnvironment) return;
    const identity = await this.#options.verificationEnvironment(
      resources.plan,
      signal,
    );
    if (identity !== resources.environmentIdentity) {
      resources.environmentIdentity = identity;
      resources.baselinePromises.clear();
      resources.verificationFact = undefined;
    }
  }

  async #environmentCurrent(
    runId: string,
    signal: AbortSignal,
    expected?: string,
  ): Promise<boolean> {
    if (!this.#options.verificationEnvironment) return true;
    const resources = this.#runs.get(runId);
    if (!resources) return false;
    try {
      const identity = await this.#options.verificationEnvironment(
        resources.plan,
        signal,
      );
      resources.environmentIdentity ??= identity;
      return identity === (expected ?? resources.environmentIdentity);
    } catch {
      signal.throwIfAborted();
      return false;
    }
  }

  async #verifyPhase(
    input: Parameters<DurableWorkflowEngineOptions["verifyPhase"]>[0],
  ): Promise<DurablePhaseVerificationResult> {
    if (await this.#environmentCurrent(input.runId, input.signal)) {
      const identity = this.#runs.get(input.runId)?.environmentIdentity;
      const result = await this.#options.verifyPhase(input);
      if (await this.#environmentCurrent(input.runId, input.signal, identity))
        return result;
    }
    return {
      ok: false,
      kind: "paused",
      code: "verification-environment-changed",
    };
  }

  async #verifyChange(
    input: Parameters<DurableWorkflowEngineOptions["verifyChange"]>[0],
  ): Promise<DurableChangeVerificationResult> {
    if (await this.#environmentCurrent(input.runId, input.signal)) {
      const identity = this.#runs.get(input.runId)?.environmentIdentity;
      const result = await this.#options.verifyChange(input);
      if (await this.#environmentCurrent(input.runId, input.signal, identity))
        return result;
    }
    return {
      ok: false,
      kind: "environment",
      code: "verification-environment-changed",
    };
  }

  routePolicyStatus(): Record<string, unknown> {
    return this.#broker.status();
  }

  #recordCorrection(
    ledger: TaskLedger,
    input: {
      runId: string;
      operationId: string;
      taskId: string;
      phase: "red" | "green" | "refactor";
    },
    identity: BeginCandidateInput,
    correction: {
      category: "artifact" | "stale" | "verification" | "checkpoint";
      code: string;
      stage: string;
    },
  ): void {
    ledger.commitVerifiedEvent({
      runId: input.runId,
      taskId: input.taskId,
      eventId: `correction-${hash(
        input.operationId,
        identity.candidateId,
        correction.category,
        correction.code,
        correction.stage,
      ).slice(0, 40)}`,
      kind: "artifact-correction",
      phase: input.phase,
      correctionCategory: correction.category,
      safeFailure: { code: correction.code, stage: correction.stage },
      candidateId: identity.candidateId,
      attemptId: identity.attemptId,
      routeId: identity.routeId,
      routeFingerprint: identity.routeFingerprint,
    });
  }

  #runRoot(runId: string): string {
    if (!IDENTIFIER.test(runId)) throw new Error("workflow-run-id-invalid");
    const dataRoot = path.join(this.#options.stateRoot.rootDir, "run-data");
    const root = path.join(dataRoot, runId);
    const relative = path.relative(dataRoot, root);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("workflow-run-data-unsafe");
    }
    return root;
  }

  #captureBaseline(
    workspaces: WorkspaceStore,
    plan: ImplementPlan,
    signal: AbortSignal,
  ) {
    const candidates = new Set<string>();
    const absent = new Set<string>();
    for (const relative of deliveryBoundPaths(plan)) {
      const observation = observeSafePath(this.#options.consumerRoot, relative);
      if (observation.kind === "file") candidates.add(relative);
      else if (observation.kind === "absent") absent.add(relative);
      else throw new Error("workflow-baseline-path-unsafe");
    }
    return workspaces.captureBaselineAsync(
      {
        consumerRoot: this.#options.consumerRoot,
        approvedUntracked: [...candidates].sort(),
        absent: [...absent].sort(),
      },
      signal,
    );
  }

  async #verifyPostApply(
    resources: DurableRunResources,
    root: string,
    signal: AbortSignal,
    transactionId: string,
  ): Promise<{ ok: true } | { ok: false; code: string }> {
    if (this.#options.verificationEnvironment) {
      const fact = this.#ledger(
        resources,
        resources.deliveryRevision,
      ).durableFact(`apply-environment-${hash(transactionId).slice(0, 40)}`);
      if (!isRecord(fact) || typeof fact.identity !== "string")
        return { ok: false, code: "verification-environment-changed" };
      resources.environmentIdentity = fact.identity;
      if (
        !(await this.#environmentCurrent(
          resources.runId,
          signal,
          fact.identity,
        ))
      )
        return { ok: false, code: "verification-environment-changed" };
    }
    if (
      resources.plan.outputs.some(
        (output) => observeSafePath(root, output.path).kind !== "file",
      )
    ) {
      return { ok: false, code: "producer-output-unavailable" };
    }
    const lifecycle = hasVerificationLifecycle(resources.plan);
    const result = await this.#verifyChange({
      runId: resources.runId,
      deliveryRevision: resources.deliveryRevision,
      root,
      plan: structuredClone(resources.plan),
      ...(lifecycle
        ? {
            scope: "post-apply" as const,
            verification: structuredClone(
              resources.plan.verification.change.postApply,
            ),
          }
        : {}),
      signal,
    });
    return result.ok &&
      result.exitCode === 0 &&
      result.classification.length > 0
      ? { ok: true }
      : {
          ok: false,
          code: result.ok ? "post-apply-verification-invalid" : result.code,
        };
  }

  readonly #initializing = new Map<string, Promise<DurableRunResources>>();

  async #prepareResources(
    input: DurableResourceInput,
    signal: AbortSignal,
  ): Promise<DurableRunResources> {
    signal.throwIfAborted();
    const pending = this.#initializing.get(input.runId);
    if (pending) return pending;
    if (
      this.#runs.has(input.runId) ||
      (input.baselineRevisionId && input.currentWorkspaceRevisionId)
    )
      return this.#resources(input);
    const initialize = async () => {
      if (
        !input.plan ||
        input.baselineRevisionId ||
        input.currentWorkspaceRevisionId
      )
        throw new Error("workflow-workspace-revision-unavailable");
      const root = this.#runRoot(input.runId);
      ensurePrivateRunDirectory(root);
      const artifacts = new ArtifactStore(path.join(root, "artifacts"));
      const workspaces = new WorkspaceStore(
        path.join(root, "workspaces"),
        artifacts,
      );
      const baseline = await this.#captureBaseline(
        workspaces,
        input.plan,
        signal,
      );
      signal.throwIfAborted();
      return this.#resources({
        ...input,
        baselineRevisionId: baseline.revisionId,
        currentWorkspaceRevisionId: baseline.revisionId,
      });
    };
    const promise = initialize();
    this.#initializing.set(input.runId, promise);
    try {
      return await promise;
    } finally {
      this.#initializing.delete(input.runId);
    }
  }

  #resources(input: {
    runId: string;
    deliveryRevision: number;
    plan?: ImplementPlan;
    baselineRevisionId?: string;
    currentWorkspaceRevisionId?: string;
  }): DurableRunResources {
    const existing = this.#runs.get(input.runId);
    if (existing) {
      if (
        input.baselineRevisionId &&
        existing.baselineRevisionId !== input.baselineRevisionId
      ) {
        throw new Error("workflow-baseline-revision-conflict");
      }
      if (input.plan) {
        existing.plan = structuredClone(input.plan);
        existing.deliveryRevision = input.deliveryRevision;
      }
      return existing;
    }
    if (!input.plan) {
      throw new Error("workflow-plan-unavailable");
    }
    const root = this.#runRoot(input.runId);
    ensurePrivateRunDirectory(root);
    const artifacts = new ArtifactStore(path.join(root, "artifacts"));
    const workspaces = new WorkspaceStore(
      path.join(root, "workspaces"),
      artifacts,
    );
    const baselineRevisionId = input.baselineRevisionId;
    const currentRevisionId = input.currentWorkspaceRevisionId;
    if (!baselineRevisionId || !currentRevisionId)
      throw new Error("workflow-workspace-revision-unavailable");
    workspaces.getRevision(baselineRevisionId);
    workspaces.getRevision(currentRevisionId);
    let resources!: DurableRunResources;
    const transactions = new ApplyTransaction({
      root: path.join(root, "transactions"),
      artifacts,
      workspaces,
      hooks: {
        postApply: ({ transactionId, root: verificationRoot, signal }) =>
          this.#verifyPostApply(
            resources,
            verificationRoot,
            signal,
            transactionId,
          ),
      },
    });
    resources = {
      runId: input.runId,
      root,
      plan: structuredClone(input.plan),
      deliveryRevision: input.deliveryRevision,
      artifacts,
      workspaces,
      ledgers: new Map(),
      transactions,
      baselineRevisionId,
      currentRevisionId,
      mergeTail: Promise.resolve(),
      baselinePromises: new Map(),
      closed: false,
    };
    this.#runs.set(input.runId, resources);
    return resources;
  }

  #closeResources(resources: DurableRunResources): void {
    if (resources.closed) return;
    for (const ledger of resources.ledgers.values()) ledger.close();
    resources.ledgers.clear();
    resources.transactions.close();
    resources.closed = true;
  }

  #ledger(
    resources: DurableRunResources,
    deliveryRevision: number,
  ): TaskLedger {
    const existing = resources.ledgers.get(deliveryRevision);
    if (existing) return existing;
    const ledger = new TaskLedger({
      root: path.join(
        resources.root,
        "ledgers",
        `revision-${deliveryRevision}`,
      ),
      artifacts: resources.artifacts,
    });
    resources.ledgers.set(deliveryRevision, ledger);
    return ledger;
  }

  async #observeVerification(input: {
    resources: DurableRunResources;
    revisionId: string;
    scope: DurableVerificationScope;
    verification: StructuredVerificationContract;
    signal: AbortSignal;
    taskId?: string;
  }): Promise<DurableObservedVerification> {
    if (input.signal.aborted) {
      return {
        ok: false,
        outcome: { kind: "operation-cancelled", code: "cancelled" },
      };
    }
    const root = mkdtempSync(path.join(input.resources.root, "verification-"));
    try {
      await input.resources.workspaces.materializeAsync(
        input.revisionId,
        root,
        input.signal,
      );
      const result = await this.#verifyChange({
        runId: input.resources.runId,
        deliveryRevision: input.resources.deliveryRevision,
        root,
        plan: structuredClone(input.resources.plan),
        scope: input.scope,
        verification: structuredClone(input.verification),
        ...(input.taskId ? { taskId: input.taskId } : {}),
        signal: input.signal,
      });
      if (result.ok) {
        return {
          ok: true,
          observation: {
            status: "passed",
            verificationId: input.verification.id,
            failureIdentities: verificationIdentities(
              result,
              input.verification,
              input.scope,
            ),
          },
        };
      }
      if (result.kind === "verification") {
        return {
          ok: true,
          observation: {
            status: "failed",
            verificationId: input.verification.id,
            failureIdentities: verificationIdentities(
              result,
              input.verification,
              input.scope,
            ),
            code: result.code,
          },
        };
      }
      if (result.kind === "approval-boundary") {
        return {
          ok: false,
          outcome: { kind: "approval-needed", code: result.code },
        };
      }
      if (result.kind === "cancelled" || input.signal.aborted) {
        return {
          ok: false,
          outcome: { kind: "operation-cancelled", code: "cancelled" },
        };
      }
      return {
        ok: false,
        outcome: { kind: "paused", code: result.code },
      };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  async #captureVerificationBaseline(input: {
    resources: DurableRunResources;
    ledger: TaskLedger;
    signal: AbortSignal;
  }): Promise<DurableBaselineResult> {
    const environmentIdentity = input.resources.environmentIdentity;
    const stored = input.ledger.durableFact(
      this.#baselineFactKey(input.resources),
    );
    if (stored !== undefined) {
      const baseline = parseVerificationBaseline(
        stored,
        input.resources.artifacts,
      );
      if (baseline.revisionId !== input.resources.baselineRevisionId) {
        throw new Error("workflow-verification-baseline-conflict");
      }
      return { ok: true, baseline };
    }
    const plan = input.resources.plan;
    const affected: DurableVerificationBaseline["affected"] = [];
    for (const task of plan.tasks) {
      const observed = await this.#observeVerification({
        resources: input.resources,
        revisionId: input.resources.baselineRevisionId,
        scope: "baseline-task-affected",
        verification: task.affectedVerification,
        taskId: task.taskId,
        signal: input.signal,
      });
      if (!observed.ok) return observed;
      affected.push({
        taskId: task.taskId,
        observation: observed.observation,
      });
    }
    const fullSuite = await this.#observeVerification({
      resources: input.resources,
      revisionId: input.resources.baselineRevisionId,
      scope: "baseline-full-suite",
      verification: plan.verification.baseline.fullSuite,
      signal: input.signal,
    });
    if (!fullSuite.ok) return fullSuite;
    const baseline: DurableVerificationBaseline = {
      revisionId: input.resources.baselineRevisionId,
      targetContracts: plan.tasks
        .filter(
          (task) =>
            !task.verificationMode || task.verificationMode === "behavior",
        )
        .map((task) => ({
          taskId: task.taskId,
          verificationId: task.phases.red.verification.id,
          expectedFailure:
            "expectedFailure" in task.phases.red.verification
              ? (task.phases.red.verification.expectedFailure ??
                task.phases.red.verification.id)
              : task.phases.red.verification.id,
        })),
      affected,
      fullSuite: fullSuite.observation,
    };
    if (environmentIdentity !== input.resources.environmentIdentity)
      return {
        ok: false,
        outcome: { kind: "paused", code: "verification-environment-changed" },
      };
    input.ledger.putDurableFact(
      this.#baselineFactKey(input.resources),
      verificationBaselineFact(baseline, input.resources.artifacts),
    );
    return { ok: true, baseline };
  }

  async #ensureVerificationBaseline(input: {
    resources: DurableRunResources;
    ledger: TaskLedger;
    signal: AbortSignal;
  }): Promise<DurableBaselineResult> {
    try {
      await this.#refreshEnvironment(input.resources, input.signal);
    } catch {
      return {
        ok: false,
        outcome: {
          kind: "paused",
          code: "verification-environment-unavailable",
        },
      };
    }
    const existing = input.resources.baselinePromises.get(
      input.resources.deliveryRevision,
    );
    if (existing) return existing;
    const pending = this.#captureVerificationBaseline(input).then((result) => {
      if (!result.ok) {
        input.resources.baselinePromises.delete(
          input.resources.deliveryRevision,
        );
      }
      return result;
    });
    input.resources.baselinePromises.set(
      input.resources.deliveryRevision,
      pending,
    );
    return pending;
  }

  async #verifyTaskAffected(input: {
    resources: DurableRunResources;
    baseline: DurableVerificationBaseline;
    task: PlanTaskDraft;
    revisionId: string;
    signal: AbortSignal;
  }): Promise<DurableAffectedResult> {
    const baseline = input.baseline.affected.find(
      (entry) => entry.taskId === input.task.taskId,
    );
    if (!baseline) throw new Error("workflow-task-baseline-unavailable");
    const current = await this.#observeVerification({
      resources: input.resources,
      revisionId: input.revisionId,
      scope: "task-affected",
      verification: input.task.affectedVerification,
      taskId: input.task.taskId,
      signal: input.signal,
    });
    if (!current.ok) return current.outcome;
    if (current.observation.status === "passed") {
      return { kind: "verified", attribution: "none" };
    }
    const prior = new Set(baseline.observation.failureIdentities);
    const introduced = current.observation.failureIdentities.filter(
      (identity) => !prior.has(identity),
    );
    if (introduced.length === 0) {
      return { kind: "verified", attribution: "pre-existing" };
    }
    return {
      kind: "repairable",
      attribution: "introduced",
      failureIdentities: introduced.slice(0, 256),
    };
  }

  #completeTracking(
    resources: DurableRunResources,
    taskId: string,
  ): WorkspaceRevision {
    const current = resources.workspaces.getRevision(
      resources.currentRevisionId,
    );
    const trackingPath = deliveryTrackingPath(resources.plan);
    if (!trackingPath) return current;
    const entry = current.entries[trackingPath];
    if (!entry || entry.kind === "absent") return current;
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      resources.artifacts.read(entry.hash),
    );
    const escaped = taskId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const taskIdentity = new RegExp(
      `(?:^|[^A-Za-z0-9._:-])${escaped}(?![A-Za-z0-9._:-])`,
      "u",
    );
    let matches = 0;
    let changed = false;
    const updated = text
      .split(/(?<=\n)/u)
      .map((segment) => {
        const line = segment.endsWith("\n") ? segment.slice(0, -1) : segment;
        if (!/^\s*-\s+\[[ xX]\]/u.test(line) || !taskIdentity.test(line)) {
          return segment;
        }
        matches += 1;
        if (/^\s*-\s+\[[xX]\]/u.test(line)) return segment;
        changed = true;
        return segment.replace(/^(\s*-\s+)\[ \]/u, "$1[x]");
      })
      .join("");
    if (matches !== 1) throw new Error("workflow-tracking-task-mismatch");
    if (!changed) return current;
    const next = resources.workspaces.createRevision({
      parentRevisionId: current.revisionId,
      changes: {
        [trackingPath]: {
          kind: "file",
          bytes: new TextEncoder().encode(updated),
          mode: entry.mode,
        },
      },
    });
    resources.currentRevisionId = next.revisionId;
    return next;
  }

  #agentsManagedParts(
    text: string,
  ): { prefix: string; suffix: string } | undefined {
    const startMarker = "<!-- ABEL:AGENTS-INDEX:START -->";
    const endMarker = "<!-- ABEL:AGENTS-INDEX:END -->";
    const lines = text.split("\n");
    const starts: Array<{ line: number; start: number }> = [];
    const ends: Array<{ line: number; end: number }> = [];
    let offset = 0;
    for (const [line, value] of lines.entries()) {
      if (value === startMarker) starts.push({ line, start: offset });
      if (value === endMarker) {
        ends.push({ line, end: offset + value.length });
      }
      offset += value.length + 1;
    }
    if (
      starts.length !== 1 ||
      ends.length !== 1 ||
      starts[0].line >= ends[0].line
    ) {
      return undefined;
    }
    return {
      prefix: text.slice(0, starts[0].start),
      suffix: text.slice(ends[0].end),
    };
  }

  #applyAgentsCheckpoint(
    resources: DurableRunResources,
  ): { ok: true; revision: WorkspaceRevision } | { ok: false; code: string } {
    const checkpoint = resources.plan.verification.agentsCheckpoint;
    const current = resources.workspaces.getRevision(
      resources.currentRevisionId,
    );
    if (!checkpoint.required) return { ok: true, revision: current };
    const changes: Record<
      string,
      { kind: "absent" } | { kind: "file"; bytes: Uint8Array; mode: number }
    > = {};
    for (const operation of checkpoint.operations) {
      const entry = current.entries[operation.target];
      let before: string | null;
      if (!entry || entry.kind === "absent") {
        before = null;
      } else {
        try {
          before = new TextDecoder("utf-8", { fatal: true }).decode(
            resources.artifacts.read(entry.hash),
          );
        } catch {
          return { ok: false, code: "agents-checkpoint-contract-stale" };
        }
      }
      if (operation.impact === "create-index") {
        if (operation.managedBlock === null) {
          throw new Error("workflow-agents-checkpoint-invalid");
        }
        const desired = `${operation.managedBlock}\n`;
        if (before !== null && before !== desired) {
          return { ok: false, code: "agents-checkpoint-contract-stale" };
        }
        if (before === null) {
          changes[operation.target] = {
            kind: "file",
            bytes: new TextEncoder().encode(desired),
            mode: 0o644,
          };
        }
        continue;
      }
      if (operation.impact === "remove-index") {
        if (operation.managedBlock !== null) {
          throw new Error("workflow-agents-checkpoint-invalid");
        }
        if (before === null) continue;
        const parts = this.#agentsManagedParts(before);
        if (!parts) {
          return { ok: false, code: "agents-checkpoint-contract-stale" };
        }
        const after = `${parts.prefix}${parts.suffix}`;
        changes[operation.target] =
          after.trim().length === 0
            ? { kind: "absent" }
            : {
                kind: "file",
                bytes: new TextEncoder().encode(after),
                mode: entry?.kind === "file" ? entry.mode : 0o644,
              };
        continue;
      }
      if (operation.managedBlock === null || before === null) {
        return { ok: false, code: "agents-checkpoint-contract-stale" };
      }
      const parts = this.#agentsManagedParts(before);
      if (!parts) {
        return { ok: false, code: "agents-checkpoint-contract-stale" };
      }
      const after = `${parts.prefix}${operation.managedBlock}${parts.suffix}`;
      if (after !== before) {
        changes[operation.target] = {
          kind: "file",
          bytes: new TextEncoder().encode(after),
          mode: entry?.kind === "file" ? entry.mode : 0o644,
        };
      }
    }
    if (Object.keys(changes).length === 0) {
      return { ok: true, revision: current };
    }
    return {
      ok: true,
      revision: resources.workspaces.createRevision({
        parentRevisionId: current.revisionId,
        changes,
      }),
    };
  }

  #openTask(
    resources: DurableRunResources,
    ledger: TaskLedger,
    input: Parameters<WorkflowWorker["runAttempt"]>[0],
  ): void {
    const revision = resources.workspaces.getRevision(
      resources.baselineRevisionId,
    );
    const contextRefs = [...new Set(input.task.phases.red.read)]
      .sort()
      .flatMap((relative) => {
        const entry = revision.entries[relative];
        return entry?.kind === "file"
          ? [{ kind: "path" as const, path: relative, hash: entry.hash }]
          : [];
      });
    ledger.openTask({
      runId: input.runId,
      deliveryRevision: input.deliveryRevision,
      taskId: input.taskId,
      boundaryHash: hash("durable-task-boundary", JSON.stringify(input.task)),
      objective: input.task.objective,
      contextRefs,
      initialPhase:
        input.task.verificationMode &&
        input.task.verificationMode !== "behavior"
          ? "green"
          : "red",
    });
  }

  #executionWritePaths(resources: DurableRunResources): string[] {
    return [
      ...new Set(
        resources.plan.tasks.flatMap((task) =>
          Object.values(task.phases).flatMap((phase) => [
            ...phase.write,
            ...phase.delete,
          ]),
        ),
      ),
    ];
  }

  #baselineFactKey(resources: DurableRunResources): string {
    return this.#options.verificationPolicy || resources.environmentIdentity
      ? `verification-baseline-${hash(this.#options.verificationPolicy ?? "legacy", resources.environmentIdentity ?? "legacy").slice(0, 24)}`
      : "verification-baseline";
  }

  #policyFactKey(
    resources: DurableRunResources,
    event: Record<string, unknown>,
  ): string {
    return `verified-policy-${hash(this.#options.verificationPolicy ?? "legacy", resources.environmentIdentity ?? "legacy", JSON.stringify({ kind: event.kind, phase: event.phase, commandId: event.commandId, artifactHash: event.artifactHash, isolatedRevisionId: event.isolatedRevisionId, exitCode: event.exitCode, actualClassification: event.actualClassification })).slice(0, 40)}`;
  }

  async #revalidatePhasePolicy(
    resources: DurableRunResources,
    ledger: TaskLedger,
    task: PlanTaskDraft,
    signal: AbortSignal,
  ): Promise<WorkflowAttemptOutcome | undefined> {
    if (
      !this.#options.verificationPolicy &&
      !this.#options.verificationEnvironment
    )
      return undefined;
    const projection = ledger.projection({
      runId: resources.runId,
      taskId: task.taskId,
      nextPhase: "green",
    }) as { history: Array<Record<string, unknown>> };
    for (const event of projection.history.filter(
      (event) =>
        event.kind === "phase-verified" || event.kind === "repair-verified",
    )) {
      const key = this.#policyFactKey(resources, event);
      if (ledger.durableFact(key) !== undefined) continue;
      const phase = event.phase as "red" | "green" | "refactor";
      const boundary = task.phases[phase];
      const repair = event.kind === "repair-verified";
      const verification = repair
        ? task.repairVerification
        : boundary?.verification;
      const expected = repair
        ? "expected-green"
        : expectedClassification(phase);
      if (
        !boundary ||
        !verification ||
        typeof event.isolatedRevisionId !== "string"
      )
        throw new Error("workflow-ledger-phase-invalid");
      const root = mkdtempSync(
        path.join(resources.root, "policy-verification-"),
      );
      try {
        await resources.workspaces.materializeAsync(
          event.isolatedRevisionId,
          root,
          signal,
        );
        const result = await this.#verifyPhase({
          executionWritePaths: this.#executionWritePaths(resources),
          runId: resources.runId,
          deliveryRevision: resources.deliveryRevision,
          taskId: task.taskId,
          phase,
          root,
          verification,
          signal,
        });
        if (!result.ok)
          return {
            kind: "paused",
            code:
              result.kind === "paused"
                ? result.code
                : "verification-policy-rejected",
          };
        if (
          result.classification !== expected ||
          (expected === "expected-red"
            ? result.exitCode === 0
            : result.exitCode !== 0)
        )
          return { kind: "paused", code: "verification-policy-rejected" };
        ledger.putDurableFact(key, {
          policy: this.#options.verificationPolicy ?? "legacy",
        });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
    return undefined;
  }

  #pendingCandidate(
    ledger: TaskLedger,
    key: string,
    baseRevisionId: string,
  ):
    | {
        identity: BeginCandidateInput;
        proposal: Extract<
          DurableCandidateProposal,
          { kind: "sealed-candidate" }
        >;
      }
    | undefined {
    const value = ledger.durableFact(key);
    if (
      !isRecord(value) ||
      !isRecord(value.identity) ||
      !isRecord(value.proposal) ||
      value.identity.isolatedRevisionId !== baseRevisionId
    )
      return undefined;
    return value as unknown as {
      identity: BeginCandidateInput;
      proposal: Extract<DurableCandidateProposal, { kind: "sealed-candidate" }>;
    };
  }

  #savePendingCandidate(ledger: TaskLedger, key: string, value: unknown): void {
    const previous = ledger.durableFact(key);
    if (previous === undefined) ledger.putDurableFact(key, value);
    else ledger.replaceDurableFact(key, previous, value);
  }

  #replayedPhase(
    resources: DurableRunResources,
    ledger: TaskLedger,
    input: Parameters<WorkflowWorker["runAttempt"]>[0],
  ): WorkflowAttemptOutcome | undefined {
    if (input.artifactCorrection?.code === "red-artifact-constraint") {
      return undefined;
    }
    const projection = ledger.projection({
      runId: input.runId,
      taskId: input.taskId,
      nextPhase: input.phase,
    }) as {
      history: Array<Record<string, unknown>>;
    };
    const event = projection.history.find(
      (candidate) =>
        candidate.kind === "phase-verified" && candidate.phase === input.phase,
    );
    if (!event) return undefined;
    if (
      typeof event.artifactHash !== "string" ||
      !SHA256.test(event.artifactHash) ||
      typeof event.isolatedRevisionId !== "string" ||
      !SHA256.test(event.isolatedRevisionId) ||
      typeof event.exitCode !== "number" ||
      event.actualClassification !== expectedClassification(input.phase)
    ) {
      throw new Error("workflow-ledger-phase-invalid");
    }
    let isolatedRevisionId = event.isolatedRevisionId;
    const finalPhase = input.task.phases.refactor ? "refactor" : "green";
    if (hasVerificationLifecycle(input.plan) && input.phase === finalPhase) {
      const fact = ledger.durableFact(
        `task-final-${hash(input.taskId).slice(0, 40)}`,
      );
      if (
        !isRecord(fact) ||
        fact.taskId !== input.taskId ||
        fact.phase !== input.phase ||
        typeof fact.isolatedRevisionId !== "string" ||
        !SHA256.test(fact.isolatedRevisionId)
      ) {
        throw new Error("workflow-task-completion-fact-invalid");
      }
      isolatedRevisionId = fact.isolatedRevisionId;
    }
    resources.workspaces.getRevision(isolatedRevisionId);
    if (
      this.#revisionDescendsFrom(
        resources,
        resources.currentRevisionId,
        isolatedRevisionId,
      )
    ) {
      isolatedRevisionId = resources.currentRevisionId;
    } else if (
      !this.#revisionDescendsFrom(
        resources,
        isolatedRevisionId,
        resources.currentRevisionId,
      )
    ) {
      throw new Error("workspace-revision-stale");
    }
    resources.currentRevisionId = isolatedRevisionId;
    return {
      kind: "phase-committed",
      artifactHash: event.artifactHash,
      isolatedRevisionId,
      exitCode: event.exitCode,
      classification: expectedClassification(input.phase),
      baselineRevisionId: resources.baselineRevisionId,
    };
  }

  #expandedBaseline(
    resources: DurableRunResources,
    plan: ImplementPlan,
  ): WorkspaceRevision {
    const baseline = resources.workspaces.getRevision(
      resources.baselineRevisionId,
    );
    const candidates = new Map<string, boolean>(
      deliveryBoundPaths(plan).map((relative) => [relative, false]),
    );
    for (const task of plan.tasks) {
      for (const phase of Object.values(task.phases)) {
        for (const relative of phase.read) candidates.set(relative, false);
        for (const relative of [...phase.write, ...phase.delete]) {
          candidates.set(relative, true);
        }
      }
    }
    for (const output of plan.outputs) candidates.set(output.path, true);
    for (const task of plan.tasks) {
      if (task.agents.impact === "none" || !task.agents.target) continue;
      candidates.set(task.agents.target, task.agents.impact === "create-index");
    }
    const trackingPath = deliveryTrackingPath(plan);
    if (
      trackingPath &&
      (Object.hasOwn(baseline.entries, trackingPath) ||
        observeSafePath(this.#options.consumerRoot, trackingPath).kind ===
          "file")
    ) {
      candidates.set(trackingPath, false);
    }
    const changes: Record<
      string,
      { kind: "absent" } | { kind: "file"; bytes: Uint8Array; mode: number }
    > = {};
    for (const [relative, mayBeAbsent] of [...candidates].sort(
      ([left], [right]) => compareCanonicalStrings(left, right),
    )) {
      if (relative === ".") continue;
      const observation = observeSafePath(this.#options.consumerRoot, relative);
      if (observation.kind === "absent") {
        if (baseline.entries[relative]?.kind === "absent") continue;
        if (!mayBeAbsent)
          throw new Error("workflow-baseline-input-unavailable");
        changes[relative] = { kind: "absent" };
        continue;
      }
      if (observation.kind !== "file") {
        throw new Error("workflow-baseline-path-unsafe");
      }
      const target = path.join(
        this.#options.consumerRoot,
        ...relative.split("/"),
      );
      const stat = lstatSync(target);
      const bytes = readFileSync(target);
      const mode = stat.mode & 0o777;
      const prior = baseline.entries[relative];
      if (
        prior?.kind === "file" &&
        prior.hash === sha256Bytes(bytes) &&
        prior.bytes === bytes.byteLength &&
        prior.mode === mode
      ) {
        continue;
      }
      changes[relative] = {
        kind: "file",
        bytes,
        mode,
      };
    }
    return Object.keys(changes).length === 0
      ? baseline
      : resources.workspaces.createRevision({
          parentRevisionId: baseline.revisionId,
          changes,
        });
  }

  #orderedTasks(plan: ImplementPlan): PlanTaskDraft[] {
    const remaining = new Map(plan.tasks.map((task) => [task.taskId, task]));
    const ordered: PlanTaskDraft[] = [];
    const admitted = new Set<string>();
    while (remaining.size > 0) {
      let progressed = false;
      for (const task of plan.tasks) {
        if (
          !remaining.has(task.taskId) ||
          task.dependsOn.some((dependency) => !admitted.has(dependency))
        ) {
          continue;
        }
        remaining.delete(task.taskId);
        admitted.add(task.taskId);
        ordered.push(task);
        progressed = true;
      }
      if (!progressed) throw new Error("workflow-plan-dependency-cycle");
    }
    return ordered;
  }

  #phaseFacts(
    resources: DurableRunResources,
    task: {
      taskId: string;
      deliveryRevision: number;
      phase: "red" | "green" | "refactor";
    },
  ): DurablePhaseFact[] {
    let projection: unknown;
    try {
      projection = this.#ledger(resources, task.deliveryRevision).projection({
        runId: resources.runId,
        taskId: task.taskId,
        nextPhase: task.phase,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "ledger-task-unavailable"
      ) {
        return [];
      }
      throw error;
    }
    if (!isRecord(projection) || !Array.isArray(projection.history)) {
      throw new Error("workflow-ledger-projection-invalid");
    }
    return projection.history.flatMap((event): DurablePhaseFact[] => {
      if (
        !isRecord(event) ||
        (event.kind !== "phase-verified" && event.kind !== "repair-verified")
      ) {
        return [];
      }
      if (
        !["red", "green", "refactor"].includes(String(event.phase)) ||
        typeof event.isolatedRevisionId !== "string" ||
        !SHA256.test(event.isolatedRevisionId) ||
        !Array.isArray(event.outputFacts)
      ) {
        throw new Error("workflow-ledger-phase-invalid");
      }
      const outputFacts = event.outputFacts.map((fact) => {
        if (
          !isRecord(fact) ||
          typeof fact.path !== "string" ||
          (fact.kind !== "absent" && fact.kind !== "file")
        ) {
          throw new Error("workflow-ledger-phase-invalid");
        }
        if (fact.kind === "absent") {
          return { path: fact.path, kind: "absent" as const };
        }
        if (
          typeof fact.hash !== "string" ||
          !SHA256.test(fact.hash) ||
          !Number.isSafeInteger(fact.bytes) ||
          (fact.bytes as number) < 0
        ) {
          throw new Error("workflow-ledger-phase-invalid");
        }
        return {
          path: fact.path,
          kind: "file" as const,
          hash: fact.hash,
          bytes: fact.bytes as number,
        };
      });
      return [
        {
          kind: event.kind,
          phase: event.phase as DurablePhaseFact["phase"],
          isolatedRevisionId: event.isolatedRevisionId,
          outputFacts,
        },
      ];
    });
  }

  revalidateDelivery(
    input: Parameters<NonNullable<WorkflowWorker["revalidateDelivery"]>>[0],
  ): ReturnType<NonNullable<WorkflowWorker["revalidateDelivery"]>> {
    const resources = this.#resources({
      runId: input.runId,
      deliveryRevision: input.deliveryRevision,
      plan: input.plan,
      baselineRevisionId: input.baselineRevisionId,
      currentWorkspaceRevisionId: input.currentWorkspaceRevisionId,
    });
    const expandedBaseline = this.#expandedBaseline(resources, input.plan);
    const rows = new Map(input.tasks.map((task) => [task.taskId, task]));
    const facts = new Map(
      input.tasks.map((task) => [
        task.taskId,
        this.#phaseFacts(resources, task),
      ]),
    );
    const invalidated = new Set(input.invalidatedTaskIds);
    const ordered = this.#orderedTasks(input.plan);
    let rebuilt = expandedBaseline;
    for (;;) {
      let grew = false;
      rebuilt = expandedBaseline;
      for (const task of ordered) {
        const row = rows.get(task.taskId);
        if (!row || invalidated.has(task.taskId)) continue;
        if (task.dependsOn.some((dependency) => invalidated.has(dependency))) {
          invalidated.add(task.taskId);
          grew = true;
          continue;
        }
        for (const fact of facts.get(task.taskId) ?? []) {
          const phase = task.phases[fact.phase];
          if (!phase) {
            invalidated.add(task.taskId);
            grew = true;
            break;
          }
          const original = resources.workspaces.getRevision(
            fact.isolatedRevisionId,
          );
          if (!original.parentRevisionId) {
            throw new Error("workflow-ledger-revision-base-invalid");
          }
          const originalBase = resources.workspaces.getRevision(
            original.parentRevisionId,
          );
          const current = resources.workspaces.getRevision(rebuilt.revisionId);
          const boundaries =
            fact.kind === "repair-verified"
              ? Object.values(task.phases)
              : [phase];
          const boundPaths = [
            ...new Set(
              boundaries.flatMap((boundary) => [
                ...(row.contextReadPaths ?? []),
                ...boundary.read,
                ...boundary.write,
                ...boundary.delete,
                ...boundary.verificationInputs.flatMap((binding) =>
                  binding.kind === "workspace" ? [binding.path] : [],
                ),
              ]),
            ),
          ];
          if (
            boundPaths.some(
              (relative) =>
                !workspaceEntryEqual(
                  originalBase.entries[relative],
                  current.entries[relative],
                ),
            )
          ) {
            invalidated.add(task.taskId);
            grew = true;
            break;
          }
          const changes: Record<
            string,
            | { kind: "absent" }
            | { kind: "file"; bytes: Uint8Array; mode: number }
          > = {};
          for (const output of fact.outputFacts) {
            const entry = original.entries[output.path];
            if (
              output.kind === "absent"
                ? entry?.kind !== "absent"
                : entry?.kind !== "file" ||
                  entry.hash !== output.hash ||
                  entry.bytes !== output.bytes
            ) {
              throw new Error("workflow-ledger-output-integrity-invalid");
            }
            changes[output.path] =
              entry.kind === "absent"
                ? { kind: "absent" }
                : {
                    kind: "file",
                    bytes: resources.artifacts.read(entry.hash),
                    mode: entry.mode,
                  };
          }
          rebuilt = resources.workspaces.createRevision({
            parentRevisionId: rebuilt.revisionId,
            changes,
          });
        }
      }
      for (const output of input.plan.outputs) {
        if (invalidated.has(output.producer.taskId)) continue;
        const produced = (facts.get(output.producer.taskId) ?? []).some(
          (fact) => fact.phase === output.producer.phase,
        );
        if (
          produced &&
          rebuilt.entries[output.path]?.kind !== "file" &&
          !invalidated.has(output.producer.taskId)
        ) {
          invalidated.add(output.producer.taskId);
          grew = true;
        }
      }
      if (!grew) break;
    }
    if (hasVerificationLifecycle(input.plan)) {
      const retainedRevisions = new Set(
        input.tasks
          .filter((task) => !invalidated.has(task.taskId))
          .map((task) => task.deliveryRevision),
      );
      for (const deliveryRevision of retainedRevisions) {
        const ledger = this.#ledger(resources, deliveryRevision);
        const stored = ledger.durableFact(this.#baselineFactKey(resources));
        resources.baselinePromises.delete(deliveryRevision);
        if (stored === undefined) continue;
        const baseline = parseVerificationBaseline(stored, resources.artifacts);
        if (baseline.revisionId === expandedBaseline.revisionId) continue;
        if (baseline.revisionId !== input.baselineRevisionId) {
          throw new Error("workflow-verification-baseline-conflict");
        }
        ledger.replaceDurableFact(
          this.#baselineFactKey(resources),
          stored,
          verificationBaselineFact(
            {
              ...baseline,
              revisionId: expandedBaseline.revisionId,
            },
            resources.artifacts,
          ),
        );
      }
    }
    resources.baselineRevisionId = expandedBaseline.revisionId;
    resources.currentRevisionId = rebuilt.revisionId;
    if (hasVerificationLifecycle(input.plan)) {
      for (const task of input.tasks) {
        if (task.state === "verified" && !invalidated.has(task.taskId)) {
          this.#completeTracking(resources, task.taskId);
        }
      }
    }
    return {
      invalidatedTaskIds: [...invalidated].sort(),
      baselineRevisionId: resources.baselineRevisionId,
      currentWorkspaceRevisionId: resources.currentRevisionId,
    };
  }

  async #mergeCandidate(
    resources: DurableRunResources,
    input: Parameters<WorkflowWorker["runAttempt"]>[0],
    baseRevisionId: string,
    candidateRevisionId: string,
    boundPaths?: string[],
  ) {
    let release!: () => void;
    const prior = resources.mergeTail;
    resources.mergeTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prior;
    try {
      const phase = input.task.phases[input.phase];
      if (!phase) throw new Error("workflow-task-phase-invalid");
      const merged = resources.workspaces.mergeRevision({
        baseRevisionId,
        currentRevisionId: resources.currentRevisionId,
        candidateRevisionId,
        boundPaths: [
          ...new Set([
            ...(boundPaths ?? [...phase.read, ...phase.write, ...phase.delete]),
            ...(input.contextReadPaths ?? []),
          ]),
        ],
      });
      resources.currentRevisionId = merged.revisionId;
      return merged;
    } finally {
      release();
    }
  }

  async #rollbackWorkspacePaths(input: {
    resources: DurableRunResources;
    baseRevisionId: string;
    rejectedRevisionId: string;
    paths: readonly string[];
  }): Promise<void> {
    const { resources } = input;
    let release!: () => void;
    const prior = resources.mergeTail;
    resources.mergeTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prior;
    try {
      const base = resources.workspaces.getRevision(input.baseRevisionId);
      const rejected = resources.workspaces.getRevision(
        input.rejectedRevisionId,
      );
      const current = resources.workspaces.getRevision(
        resources.currentRevisionId,
      );
      const changes: Record<
        string,
        { kind: "absent" } | { kind: "file"; bytes: Uint8Array; mode: number }
      > = {};
      for (const relative of [...new Set(input.paths)].sort()) {
        const before = base.entries[relative];
        const rejectedEntry = rejected.entries[relative];
        if (workspaceEntryEqual(before, rejectedEntry)) continue;
        const latest = current.entries[relative];
        if (workspaceEntryEqual(latest, before)) continue;
        if (!workspaceEntryEqual(latest, rejectedEntry)) {
          throw new Error("workspace-revision-stale");
        }
        changes[relative] =
          before?.kind === "file"
            ? {
                kind: "file",
                bytes: resources.artifacts.read(before.hash),
                mode: before.mode,
              }
            : { kind: "absent" };
      }
      if (Object.keys(changes).length === 0) return;
      const rolledBack = resources.workspaces.createRevision({
        parentRevisionId: current.revisionId,
        changes,
      });
      resources.currentRevisionId = rolledBack.revisionId;
    } finally {
      release();
    }
  }

  async #runRepairCandidate(input: {
    resources: DurableRunResources;
    ledger: TaskLedger;
    attempt: Parameters<WorkflowWorker["runAttempt"]>[0];
    repairAttempt: number;
    failureIdentities: string[];
  }): Promise<DurableRepairResult> {
    const { resources, ledger } = input;
    const request = input.attempt;
    if (request.signal.aborted) {
      return { kind: "operation-cancelled", code: "cancelled" };
    }
    const phase = request.task.phases[request.phase];
    if (!phase) throw new Error("workflow-task-phase-invalid");
    const allPhases = Object.values(request.task.phases);
    const approvedWritePaths = [
      ...new Set(allPhases.flatMap((boundary) => boundary.write)),
    ].sort();
    const approvedDeletePaths = [
      ...new Set(allPhases.flatMap((boundary) => boundary.delete)),
    ].sort();
    const approvedPaths = [
      ...new Set([...approvedWritePaths, ...approvedDeletePaths]),
    ].sort();
    const boundPaths = [
      ...new Set(
        allPhases.flatMap((boundary) => [
          ...boundary.read,
          ...boundary.write,
          ...boundary.delete,
        ]),
      ),
    ].sort();
    if (approvedPaths.length === 0) {
      return { kind: "approval-needed", code: "task-write-set-empty" };
    }
    const baseRevisionId = resources.currentRevisionId;
    const pendingKey = `pending-${hash(request.taskId, request.phase, request.task.repairVerification.id).slice(0, 40)}`;
    const pending = this.#pendingCandidate(ledger, pendingKey, baseRevisionId);
    const proposalRoot = mkdtempSync(path.join(resources.root, "repair-"));
    try {
      await resources.workspaces.materializeAsync(
        baseRevisionId,
        proposalRoot,
        request.signal,
      );
      if (request.routeId && !pending) {
        const rebound = this.#broker.resumeBinding({
          runId: request.runId,
          taskId: request.taskId,
          role: "implementation-worker",
          routeId: request.routeId,
          ...(request.routeFingerprint
            ? { expectedFingerprint: request.routeFingerprint }
            : {}),
          requirements: implementationRouteRequirements({
            task: request.task,
            ...(request.artifactCorrection
              ? { artifactCorrection: request.artifactCorrection }
              : {}),
            repair: { failureIdentities: input.failureIdentities },
          }),
        });
        if (!rebound.ok) return { kind: "paused", code: rebound.code };
      }
      const ledgerProjection = ledger.projection({
        runId: request.runId,
        taskId: request.taskId,
        nextPhase: request.phase,
      });
      const repair = {
        attempt: input.repairAttempt,
        attribution: "introduced" as const,
        failureIdentities: [...input.failureIdentities],
      };
      let identity: BeginCandidateInput | undefined = pending?.identity;
      const routed = pending
        ? {
            ok: true as const,
            value: pending.proposal,
            routeId: pending.identity.routeId,
            routeFingerprint: pending.identity.routeFingerprint,
          }
        : await this.#broker.run({
            runId: request.runId,
            taskId: request.taskId,
            operationId: `${request.operationId}:${request.taskId}:repair:${input.repairAttempt}`,
            role: "implementation-worker",
            requirements: implementationRouteRequirements({
              task: request.task,
              ...(request.artifactCorrection
                ? { artifactCorrection: request.artifactCorrection }
                : {}),
              repair: { failureIdentities: input.failureIdentities },
            }),
            signal: request.signal,
            ...(request.onActivity ? { onActivity: request.onActivity } : {}),
            classifyResult: semanticRouteFailure,
            execute: async (attempt) => {
              identity = {
                candidateId: `candidate-${randomUUID()}`,
                runId: request.runId,
                deliveryRevision: request.deliveryRevision,
                taskId: request.taskId,
                phase: request.phase,
                attemptId: `repair-${hash(
                  request.operationId,
                  request.taskId,
                  String(input.repairAttempt),
                  attempt.route.fingerprint,
                ).slice(0, 40)}`,
                approvedPaths,
                isolatedRevisionId: baseRevisionId,
                verificationId: request.task.repairVerification.id,
                routeId: attempt.route.id,
                routeFingerprint: attempt.route.fingerprint,
              };
              if (request.reserveCandidate && !request.reserveCandidate())
                return {
                  kind: "paused" as const,
                  code:
                    request.additionalAttempt || request.verificationOnly
                      ? "repair-attempts-exhausted"
                      : "change-work-budget-exhausted",
                };
              return this.#options.proposeCandidate({
                runId: request.runId,
                operationId: request.operationId,
                deliveryRevision: request.deliveryRevision,
                taskId: request.taskId,
                phase: request.phase,
                task: structuredClone(request.task),
                contextReadPaths: request.contextReadPaths,
                workspaceRoot: proposalRoot,
                ledgerProjection,
                candidateArtifact: {
                  ledger,
                  identity,
                  workspaceRoot: proposalRoot,
                  writePaths: approvedWritePaths,
                  deletePaths: approvedDeletePaths,
                },
                route: attempt.route,
                repair,
                ...(request.artifactCorrection
                  ? { artifactCorrection: request.artifactCorrection }
                  : {}),
                ...(request.contextRequest
                  ? { contextRequest: request.contextRequest }
                  : {}),
                ...(request.recoveryFeedback
                  ? { recoveryFeedback: request.recoveryFeedback }
                  : {}),
                signal: attempt.signal,
                onHeaders: attempt.onHeaders,
                onProgress: attempt.onProgress,
              });
            },
          });
      if (!routed.ok) {
        return routed.state === "cancelled" || request.signal.aborted
          ? { kind: "operation-cancelled", code: "cancelled" }
          : { kind: "paused", code: routed.code };
      }
      if (!identity || identity.routeId !== routed.routeId) {
        throw new Error("candidate-route-identity-invalid");
      }
      const correctionIdentity = identity;
      const withRoute = <T extends object>(outcome: T) => ({
        ...outcome,
        routeId: correctionIdentity.routeId,
        routeFingerprint: correctionIdentity.routeFingerprint,
      });
      let uncommittedRevisionId: string | undefined;
      const reject = async <T extends object>(
        outcome: T,
        correction: {
          category: "artifact" | "stale" | "verification" | "checkpoint";
          code: string;
          stage: string;
        },
        rollback = false,
      ): Promise<T> => {
        if (rollback && uncommittedRevisionId) {
          await this.#rollbackWorkspacePaths({
            resources,
            baseRevisionId,
            rejectedRevisionId: uncommittedRevisionId,
            paths: approvedPaths,
          });
        }
        this.#recordCorrection(ledger, request, correctionIdentity, correction);
        return withRoute({ ...outcome, retryPolicy: correction.category });
      };
      const proposal = routed.value;
      if (
        proposal.kind !== "candidate" &&
        proposal.kind !== "sealed-candidate"
      ) {
        return proposal.kind === "operation-cancelled" ||
          proposal.kind === "paused" ||
          proposal.kind === "approval-needed"
          ? withRoute(proposal)
          : reject(proposal, {
              category: "artifact",
              code: proposal.code,
              stage: "candidate-submit",
            });
      }
      emitWorkflowActivity(request.onActivity, { state: "validating" });
      ledger.beginCandidate(identity);
      let bytes: Buffer;
      if (proposal.kind === "sealed-candidate") {
        if (
          proposal.candidateId !== identity.candidateId ||
          !SHA256.test(proposal.artifactHash) ||
          !Number.isSafeInteger(proposal.bytes) ||
          proposal.bytes < 1 ||
          !Array.isArray(proposal.paths)
        ) {
          return reject(
            { kind: "retryable", code: "candidate-diff-invalid" },
            {
              category: "artifact",
              code: "candidate-diff-invalid",
              stage: "candidate-seal",
            },
          );
        }
        bytes = Buffer.from(ledger.readSealedCandidate(identity.candidateId));
        if (
          bytes.length !== proposal.bytes ||
          sha256Bytes(bytes) !== proposal.artifactHash
        ) {
          throw new Error("candidate-seal-integrity-invalid");
        }
      } else {
        if (
          !(proposal.bytes instanceof Uint8Array) ||
          proposal.bytes.length === 0
        ) {
          return reject(
            { kind: "retryable", code: "candidate-diff-invalid" },
            {
              category: "artifact",
              code: "candidate-diff-invalid",
              stage: "candidate-submit",
            },
          );
        }
        bytes = Buffer.from(proposal.bytes);
      }
      let candidatePaths: string[];
      try {
        candidatePaths = diffWritePaths(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        ).paths;
      } catch {
        return reject(
          { kind: "retryable", code: "candidate-diff-invalid" },
          {
            category: "artifact",
            code: "candidate-diff-invalid",
            stage: "candidate-diff",
          },
        );
      }
      if (
        candidatePaths.some((relative) => !approvedPaths.includes(relative))
      ) {
        return reject(
          {
            kind: "approval-needed",
            code: "repair-boundary-expansion",
          },
          {
            category: "artifact",
            code: "repair-boundary-expansion",
            stage: "candidate-boundary",
          },
        );
      }
      if (proposal.kind === "sealed-candidate") {
        if (
          JSON.stringify([...proposal.paths].sort()) !==
          JSON.stringify([...candidatePaths].sort())
        ) {
          return reject(
            { kind: "retryable", code: "candidate-diff-invalid" },
            {
              category: "artifact",
              code: "candidate-diff-invalid",
              stage: "candidate-seal",
            },
          );
        }
      }
      const dependencySensitive = candidatePaths.some(
        (relative) => relative === "package.json" || LOCKFILES.has(relative),
      );
      let dependenciesBefore: Map<string, DependencyContractEntry> | undefined;
      if (dependencySensitive) {
        try {
          dependenciesBefore = dependencyContract(proposalRoot);
        } catch (error) {
          if (!(error instanceof DependencyManifestError)) throw error;
          return reject(
            { kind: "retryable", code: error.message },
            {
              category: "artifact",
              code: error.message,
              stage: "candidate-dependency",
            },
          );
        }
      }

      const checked = await runGitApply(
        proposalRoot,
        bytes,
        true,
        request.signal,
      );
      if (checked !== "ok") {
        return checked === "cancelled"
          ? withRoute({ kind: "operation-cancelled", code: "cancelled" })
          : reject(
              { kind: "retryable", code: "candidate-diff-invalid" },
              {
                category: "artifact",
                code: "candidate-diff-invalid",
                stage: "candidate-check",
              },
            );
      }
      const applied = await runGitApply(
        proposalRoot,
        bytes,
        false,
        request.signal,
      );
      if (applied !== "ok") {
        return applied === "cancelled"
          ? withRoute({ kind: "operation-cancelled", code: "cancelled" })
          : reject(
              { kind: "retryable", code: "candidate-diff-invalid" },
              {
                category: "artifact",
                code: "candidate-diff-invalid",
                stage: "candidate-apply",
              },
            );
      }
      if (dependenciesBefore) {
        let dependenciesAfter: Map<string, DependencyContractEntry>;
        try {
          dependenciesAfter = dependencyContract(proposalRoot);
        } catch (error) {
          if (!(error instanceof DependencyManifestError)) throw error;
          return reject(
            { kind: "retryable", code: error.message },
            {
              category: "artifact",
              code: error.message,
              stage: "candidate-dependency",
            },
          );
        }
        if (
          hasUnapprovedDependencyChange(
            dependenciesBefore,
            dependenciesAfter,
            request.task.approvedDependencies,
            candidatePaths.some((relative) => LOCKFILES.has(relative)),
          )
        ) {
          return reject(
            { kind: "approval-needed", code: "unapproved-dependency-change" },
            {
              category: "artifact",
              code: "unapproved-dependency-change",
              stage: "candidate-dependency",
            },
          );
        }
      }

      let artifactHash: string;
      if (proposal.kind === "sealed-candidate") {
        artifactHash = proposal.artifactHash;
      } else {
        let sequence = 0;
        for (
          let offset = 0;
          offset < bytes.length;
          offset += TASK_LEDGER_LIMITS.maxSegmentBytes
        ) {
          const segment = bytes.subarray(
            offset,
            Math.min(offset + TASK_LEDGER_LIMITS.maxSegmentBytes, bytes.length),
          );
          const accepted = ledger.appendCandidateSegment({
            ...identity,
            sequence,
            bytes: segment,
            segmentHash: sha256Bytes(segment),
          });
          if (!accepted.ok) {
            return reject(
              { kind: "paused", code: accepted.code },
              {
                category: "artifact",
                code: accepted.code,
                stage: "candidate-segment",
              },
            );
          }
          sequence += 1;
        }
        const sealed = ledger.sealCandidate({
          ...identity,
          segmentCount: sequence,
          totalBytes: bytes.length,
          candidateHash: sha256Bytes(bytes),
        });
        if (!sealed.ok) {
          return reject(
            { kind: "retryable", code: sealed.code },
            {
              category: "artifact",
              code: sealed.code,
              stage: "candidate-seal",
            },
          );
        }
        artifactHash = sealed.artifactHash;
      }
      const candidate = resources.workspaces.createRevision({
        parentRevisionId: baseRevisionId,
        changes: revisionChanges(proposalRoot, approvedPaths),
      });
      const requiredOutputs = request.plan.outputs.filter(
        (output) =>
          output.producer.taskId === request.taskId &&
          (!request.artifactCorrection || output.producer.phase !== "refactor"),
      );
      if (
        requiredOutputs.some(
          (output) => candidate.entries[output.path]?.kind !== "file",
        )
      ) {
        return reject(
          { kind: "retryable", code: "producer-output-unavailable" },
          {
            category: "artifact",
            code: "producer-output-unavailable",
            stage: "candidate-output",
          },
        );
      }
      emitWorkflowActivity(request.onActivity, { state: "verifying" });
      this.#savePendingCandidate(ledger, pendingKey, {
        identity,
        proposal: {
          kind: "sealed-candidate",
          candidateId: identity.candidateId,
          artifactHash,
          bytes: bytes.length,
          paths: candidatePaths,
        },
      });
      const verified = await this.#verifyPhase({
        executionWritePaths: this.#executionWritePaths(resources),
        runId: request.runId,
        deliveryRevision: request.deliveryRevision,
        taskId: request.taskId,
        phase: request.phase,
        root: proposalRoot,
        verification: structuredClone(request.task.repairVerification),
        signal: request.signal,
      });
      if (!verified.ok) {
        if (verified.kind === "paused") return verified;
        this.#savePendingCandidate(ledger, pendingKey, null);
        return reject(verified, {
          category: "verification",
          code: verified.code,
          stage: "phase-verification",
        });
      }
      if (
        verified.classification !== "expected-green" ||
        verified.exitCode !== 0
      ) {
        return reject(
          { kind: "retryable", code: "verification-rejected" },
          {
            category: "verification",
            code: "verification-rejected",
            stage: "phase-verification",
          },
        );
      }
      let merged: ReturnType<WorkspaceStore["mergeRevision"]>;
      try {
        merged = await this.#mergeCandidate(
          resources,
          request,
          baseRevisionId,
          candidate.revisionId,
          boundPaths,
        );
        uncommittedRevisionId = merged.revisionId;
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "workspace-revision-stale"
        ) {
          return reject(
            { kind: "retryable", code: "workspace-revision-stale" },
            {
              category: "stale",
              code: "workspace-revision-stale",
              stage: "candidate-merge",
            },
          );
        }
        throw error;
      }
      if (
        requiredOutputs.some(
          (output) => merged.entries[output.path]?.kind !== "file",
        )
      ) {
        return reject(
          { kind: "retryable", code: "producer-output-unavailable" },
          {
            category: "artifact",
            code: "producer-output-unavailable",
            stage: "candidate-output",
          },
          true,
        );
      }
      const outputFacts = approvedPaths.map((relative) => {
        const entry = merged.entries[relative];
        return entry?.kind === "file"
          ? {
              path: relative,
              kind: "file" as const,
              hash: entry.hash,
              bytes: entry.bytes,
            }
          : { path: relative, kind: "absent" as const };
      });
      return {
        kind: "repair-committed",
        commit: {
          artifactHash,
          isolatedRevisionId: merged.revisionId,
          exitCode: verified.exitCode,
          classification: verified.classification,
          diagnostic: verified.diagnostic,
          outputFacts,
          routeId: identity.routeId,
          routeFingerprint: identity.routeFingerprint,
        },
      };
    } finally {
      rmSync(proposalRoot, { recursive: true, force: true });
    }
  }

  #revisionDescendsFrom(
    resources: DurableRunResources,
    descendantRevisionId: string,
    ancestorRevisionId: string,
  ): boolean {
    let current = resources.workspaces.getRevision(descendantRevisionId);
    const visited = new Set<string>();
    for (;;) {
      if (current.revisionId === ancestorRevisionId) return true;
      if (
        current.parentRevisionId === null ||
        visited.has(current.revisionId)
      ) {
        return false;
      }
      visited.add(current.revisionId);
      current = resources.workspaces.getRevision(current.parentRevisionId);
    }
  }

  #verifiedPhaseReplay(
    ledger: TaskLedger,
    input: Parameters<WorkflowWorker["runAttempt"]>[0],
  ): { artifactHash: string; exitCode: number; isolatedRevisionId: string } {
    const projection = ledger.projection({
      runId: input.runId,
      taskId: input.taskId,
      nextPhase: input.phase,
    }) as { history: Array<Record<string, unknown>> };
    const event = projection.history.find(
      (candidate) =>
        candidate.kind === "phase-verified" && candidate.phase === input.phase,
    );
    if (
      !event ||
      typeof event.artifactHash !== "string" ||
      !SHA256.test(event.artifactHash) ||
      typeof event.isolatedRevisionId !== "string" ||
      !SHA256.test(event.isolatedRevisionId) ||
      typeof event.exitCode !== "number" ||
      event.actualClassification !== expectedClassification(input.phase)
    ) {
      throw new Error("workflow-ledger-phase-invalid");
    }
    return {
      artifactHash: event.artifactHash,
      exitCode: event.exitCode,
      isolatedRevisionId: event.isolatedRevisionId,
    };
  }

  async #runRedArtifactCorrection(input: {
    resources: DurableRunResources;
    ledger: TaskLedger;
    baseline?: DurableVerificationBaseline;
    attempt: Parameters<WorkflowWorker["runAttempt"]>[0];
  }): Promise<WorkflowAttemptOutcome> {
    const { resources, ledger } = input;
    const request = input.attempt;
    if (
      request.phase !== "green" ||
      request.artifactCorrection?.code !== "red-artifact-constraint"
    ) {
      throw new Error("workflow-red-artifact-correction-invalid");
    }
    const priorRed = this.#verifiedPhaseReplay(ledger, {
      ...request,
      phase: "red",
    });
    if (!hasVerificationLifecycle(request.plan)) {
      return { kind: "paused", code: "red-artifact-constraint" };
    }
    const stableRevisionId = resources.currentRevisionId;
    const correctionPaths = [
      ...new Set(
        Object.values(request.task.phases).flatMap((phase) => [
          ...phase.write,
          ...phase.delete,
        ]),
      ),
    ];
    const rejectCorrection = async <T extends WorkflowAttemptOutcome>(
      outcome: T,
    ): Promise<T> => {
      if (resources.currentRevisionId !== stableRevisionId) {
        await this.#rollbackWorkspacePaths({
          resources,
          baseRevisionId: stableRevisionId,
          rejectedRevisionId: resources.currentRevisionId,
          paths: correctionPaths,
        });
      }
      return outcome;
    };
    const failureIdentities = [
      hash(
        "red-artifact-constraint",
        request.taskId,
        request.task.phases.red.verification.id,
      ),
    ];
    const correctionAttemptUsed = request.artifactCorrection.attempt;
    const correctionAction = {
      kind: "red-correction" as const,
      attempt:
        request.additionalAttempt || request.verificationOnly
          ? 1
          : correctionAttemptUsed,
    };
    const correctionDecision =
      request.recoveryDecision?.(correctionAction) ??
      decideRecoveryAction(request.plan, correctionAction, request);
    if (!correctionDecision.allowed)
      return { kind: "paused", code: correctionDecision.code };
    const repaired = await this.#runRepairCandidate({
      resources,
      ledger,
      attempt: request,
      repairAttempt: correctionAttemptUsed,
      failureIdentities,
    });
    if (repaired.kind !== "repair-committed") {
      return rejectCorrection(repaired);
    }

    const correctedRevision = resources.workspaces.getRevision(
      repaired.commit.isolatedRevisionId,
    );
    const acceptedRedRevision = resources.workspaces.getRevision(
      priorRed.isolatedRevisionId,
    );
    if (!acceptedRedRevision.parentRevisionId) {
      throw new Error("workflow-ledger-revision-base-invalid");
    }
    const correctedRedChanges: Record<
      string,
      { kind: "absent" } | { kind: "file"; bytes: Uint8Array; mode: number }
    > = {};
    for (const relative of [
      ...new Set([
        ...request.task.phases.red.write,
        ...request.task.phases.red.delete,
      ]),
    ]) {
      const entry = correctedRevision.entries[relative];
      correctedRedChanges[relative] =
        entry?.kind === "file"
          ? {
              kind: "file",
              bytes: resources.artifacts.read(entry.hash),
              mode: entry.mode,
            }
          : { kind: "absent" };
    }
    const correctedRedRevision = resources.workspaces.createRevision({
      parentRevisionId: acceptedRedRevision.parentRevisionId,
      changes: correctedRedChanges,
    });
    const verifyCorrectedContract = async (input: {
      phase: "red" | "green";
      revisionId: string;
      verification: StructuredVerificationContract;
    }): Promise<DurablePhaseVerificationResult> => {
      const root = mkdtempSync(path.join(resources.root, "correction-check-"));
      try {
        await resources.workspaces.materializeAsync(
          input.revisionId,
          root,
          request.signal,
        );
        return await this.#verifyPhase({
          executionWritePaths: this.#executionWritePaths(resources),
          runId: request.runId,
          deliveryRevision: request.deliveryRevision,
          taskId: request.taskId,
          phase: input.phase,
          root,
          verification: structuredClone(input.verification),
          signal: request.signal,
        });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    };
    emitWorkflowActivity(request.onActivity, { state: "verifying" });
    const redVerification = await verifyCorrectedContract({
      phase: "red",
      revisionId: correctedRedRevision.revisionId,
      verification: request.task.phases.red.verification,
    });
    if (!redVerification.ok) {
      return rejectCorrection({
        ...redVerification,
        ...(redVerification.kind === "retryable"
          ? { retryPolicy: "verification" as const }
          : {}),
      });
    }
    if (
      redVerification.classification !== "expected-red" ||
      redVerification.exitCode === 0
    ) {
      return rejectCorrection({
        kind: "retryable",
        code: "verification-rejected",
        retryPolicy: "verification",
      });
    }
    const greenVerification = await verifyCorrectedContract({
      phase: "green",
      revisionId: repaired.commit.isolatedRevisionId,
      verification: request.task.phases.green.verification,
    });
    if (!greenVerification.ok) {
      return rejectCorrection({
        ...greenVerification,
        ...(greenVerification.kind === "retryable"
          ? { retryPolicy: "verification" as const }
          : {}),
      });
    }
    if (
      greenVerification.classification !== "expected-green" ||
      greenVerification.exitCode !== 0
    ) {
      return rejectCorrection({
        kind: "retryable",
        code: "verification-rejected",
        retryPolicy: "verification",
      });
    }

    const repairEvent: VerifiedTaskEvent = {
      runId: request.runId,
      taskId: request.taskId,
      eventId: `red-artifact-correction-${hash(
        request.operationId,
        request.taskId,
        repaired.commit.artifactHash,
      ).slice(0, 40)}`,
      kind: "repair-verified",
      phase: request.phase,
      attempt: correctionAttemptUsed,
      commandId: request.task.repairVerification.id,
      exitCode: 0,
      diagnostic: repaired.commit.diagnostic,
      artifactHash: repaired.commit.artifactHash,
      isolatedRevisionId: repaired.commit.isolatedRevisionId,
      outputFacts: repaired.commit.outputFacts,
      attribution: "introduced",
      failureIdentities: [
        hash(
          "red-artifact-constraint",
          request.taskId,
          request.task.phases.red.verification.id,
        ),
      ],
      routeId: repaired.commit.routeId,
      routeFingerprint: repaired.commit.routeFingerprint,
    };
    const greenPaths = new Set([
      ...request.task.phases.green.write,
      ...request.task.phases.green.delete,
    ]);
    const greenEvent: VerifiedTaskEvent = {
      runId: request.runId,
      taskId: request.taskId,
      eventId: `green-corrected-${hash(
        request.operationId,
        request.taskId,
        repaired.commit.artifactHash,
      ).slice(0, 40)}`,
      kind: "phase-verified",
      phase: "green",
      commandId: request.task.phases.green.verification.id,
      exitCode: greenVerification.exitCode,
      expectedClassification: "expected-green",
      actualClassification: greenVerification.classification,
      diagnostic: greenVerification.diagnostic,
      artifactHash: repaired.commit.artifactHash,
      isolatedRevisionId: repaired.commit.isolatedRevisionId,
      outputFacts: repaired.commit.outputFacts.filter((fact) =>
        greenPaths.has(fact.path),
      ),
      routeId: repaired.commit.routeId,
      routeFingerprint: repaired.commit.routeFingerprint,
    };
    const events: VerifiedTaskEvent[] = [repairEvent, greenEvent];
    if (input.baseline) {
      const affected = await this.#verifyTaskAffected({
        resources,
        baseline: input.baseline,
        task: request.task,
        revisionId: repaired.commit.isolatedRevisionId,
        signal: request.signal,
      });
      if (affected.kind === "repairable") {
        return rejectCorrection({
          kind: "retryable",
          code: "red-artifact-constraint",
          retryPolicy: "artifact",
        });
      }
      if (affected.kind !== "verified") return rejectCorrection(affected);
    }
    if (request.task.phases.refactor) {
      ledger.commitVerifiedEvents(events);
      return {
        kind: "phase-committed",
        artifactHash: repaired.commit.artifactHash,
        isolatedRevisionId: repaired.commit.isolatedRevisionId,
        exitCode: greenVerification.exitCode,
        classification: greenVerification.classification,
        routeId: repaired.commit.routeId,
        routeFingerprint: repaired.commit.routeFingerprint,
      };
    }
    const completedRevision = this.#completeTracking(resources, request.taskId);
    ledger.commitTaskCompletion({
      events,
      factKey: `task-final-${hash(request.taskId).slice(0, 40)}`,
      fact: {
        taskId: request.taskId,
        phase: request.phase,
        isolatedRevisionId: completedRevision.revisionId,
        attribution: "introduced",
        repairAttempts: correctionAttemptUsed,
      },
    });
    return {
      kind: "phase-committed",
      artifactHash: repaired.commit.artifactHash,
      isolatedRevisionId: completedRevision.revisionId,
      exitCode: greenVerification.exitCode,
      classification: greenVerification.classification,
      routeId: repaired.commit.routeId,
      routeFingerprint: repaired.commit.routeFingerprint,
    };
  }

  async #runCumulativeRepair(input: {
    resources: DurableRunResources;
    ledger: TaskLedger;
    baseline: DurableVerificationBaseline;
    attempt: Parameters<WorkflowWorker["runAttempt"]>[0];
  }): Promise<WorkflowAttemptOutcome> {
    const { resources, ledger } = input;
    const request = input.attempt;
    const finalPhase = request.task.phases.refactor ? "refactor" : "green";
    const requestedFailures = request.repair?.failureIdentities;
    if (
      request.phase !== finalPhase ||
      request.repair?.attribution !== "introduced" ||
      !Array.isArray(requestedFailures) ||
      requestedFailures.length === 0 ||
      requestedFailures.length > 256 ||
      requestedFailures.some(
        (identity) => typeof identity !== "string" || !SHA256.test(identity),
      )
    ) {
      throw new Error("workflow-repair-context-invalid");
    }
    this.#verifiedPhaseReplay(ledger, request);
    const projection = ledger.projection({
      runId: request.runId,
      taskId: request.taskId,
      nextPhase: request.phase,
    }) as { history: Array<Record<string, unknown>> };
    const priorRepairs = projection.history.filter(
      (event) =>
        event.kind === "repair-verified" && event.phase === request.phase,
    );
    let stableRevisionId = resources.currentRevisionId;
    let affected: DurableAffectedResult = {
      kind: "repairable",
      attribution: "introduced",
      failureIdentities: [...new Set(requestedFailures)].sort(),
    };
    const replayedRepair = priorRepairs.at(-1);
    if (replayedRepair) {
      if (
        typeof replayedRepair.artifactHash !== "string" ||
        !SHA256.test(replayedRepair.artifactHash) ||
        typeof replayedRepair.isolatedRevisionId !== "string" ||
        !SHA256.test(replayedRepair.isolatedRevisionId)
      ) {
        throw new Error("workflow-ledger-phase-invalid");
      }
      if (
        this.#revisionDescendsFrom(
          resources,
          replayedRepair.isolatedRevisionId,
          stableRevisionId,
        )
      ) {
        resources.currentRevisionId = replayedRepair.isolatedRevisionId;
        stableRevisionId = replayedRepair.isolatedRevisionId;
        const replayedAffected = await this.#verifyTaskAffected({
          resources,
          baseline: input.baseline,
          task: request.task,
          revisionId: stableRevisionId,
          signal: request.signal,
        });
        if (replayedAffected.kind === "verified") {
          return {
            kind: "phase-committed",
            artifactHash: replayedRepair.artifactHash,
            isolatedRevisionId: stableRevisionId,
            exitCode: 0,
            classification: expectedClassification(request.phase),
          };
        }
        if (replayedAffected.kind !== "repairable") return replayedAffected;
        affected = replayedAffected;
      }
    }

    const repairEvents: VerifiedTaskEvent[] = [];
    let lastCommit: DurableCandidateCommit | undefined;
    let repairAttempt = 0;
    let uncommittedRevisionId: string | undefined;
    const rollbackPaths = [
      ...new Set(
        Object.values(request.task.phases).flatMap((phase) => [
          ...phase.write,
          ...phase.delete,
        ]),
      ),
    ];
    const discardUncommitted = async <T extends WorkflowAttemptOutcome>(
      outcome: T,
    ): Promise<T> => {
      if (uncommittedRevisionId) {
        await this.#rollbackWorkspacePaths({
          resources,
          baseRevisionId: stableRevisionId,
          rejectedRevisionId: uncommittedRevisionId,
          paths: rollbackPaths,
        });
      }
      return outcome;
    };
    while (affected.kind === "repairable") {
      if (
        !(
          request.recoveryDecision?.({
            kind: "cumulative-repair",
            attempt: repairAttempt + 1,
          }) ??
          decideRecoveryAction(
            request.plan,
            { kind: "cumulative-repair", attempt: repairAttempt + 1 },
            request,
          )
        ).allowed
      ) {
        return discardUncommitted({
          kind: "paused",
          code: "repair-attempts-exhausted",
        });
      }
      repairAttempt += 1;
      const failureIdentities = [...affected.failureIdentities];
      const repair = await this.#runRepairCandidate({
        resources,
        ledger,
        attempt: request,
        repairAttempt,
        failureIdentities,
      });
      if (repair.kind !== "repair-committed") {
        return discardUncommitted(repair);
      }
      lastCommit = repair.commit;
      uncommittedRevisionId = repair.commit.isolatedRevisionId;
      repairEvents.push({
        runId: request.runId,
        taskId: request.taskId,
        eventId: `cumulative-repair-${hash(
          stableRevisionId,
          request.taskId,
          String(repairAttempt),
        ).slice(0, 40)}`,
        kind: "repair-verified",
        phase: request.phase,
        attempt: repairAttempt,
        commandId: request.task.repairVerification.id,
        exitCode: 0,
        diagnostic: repair.commit.diagnostic,
        artifactHash: repair.commit.artifactHash,
        isolatedRevisionId: repair.commit.isolatedRevisionId,
        outputFacts: repair.commit.outputFacts,
        attribution: "introduced",
        failureIdentities,
        routeId: repair.commit.routeId,
        routeFingerprint: repair.commit.routeFingerprint,
      });
      affected = await this.#verifyTaskAffected({
        resources,
        baseline: input.baseline,
        task: request.task,
        revisionId: repair.commit.isolatedRevisionId,
        signal: request.signal,
      });
    }
    if (affected.kind !== "verified") return discardUncommitted(affected);
    if (!lastCommit || repairEvents.length === 0) {
      throw new Error("workflow-repair-commit-unavailable");
    }
    ledger.commitVerifiedEvents(repairEvents);
    return {
      kind: "phase-committed",
      artifactHash: lastCommit.artifactHash,
      isolatedRevisionId: lastCommit.isolatedRevisionId,
      exitCode: 0,
      classification: expectedClassification(request.phase),
      routeId: lastCommit.routeId,
      routeFingerprint: lastCommit.routeFingerprint,
    };
  }

  async hasPendingVerification(
    input: Parameters<WorkflowWorker["runAttempt"]>[0],
  ): Promise<boolean> {
    if (!input.baselineRevisionId || !input.currentWorkspaceRevisionId)
      return false;
    const resources = await this.#prepareResources(input, input.signal);
    const ledger = this.#ledger(resources, input.deliveryRevision);
    const verificationIds = [
      input.task.phases[input.phase]?.verification.id,
      input.task.repairVerification?.id,
    ];
    return verificationIds.some(
      (id) =>
        id &&
        this.#pendingCandidate(
          ledger,
          `pending-${hash(input.taskId, input.phase, id).slice(0, 40)}`,
          resources.currentRevisionId,
        ) !== undefined,
    );
  }

  isContextReadAvailable(
    input: Parameters<NonNullable<WorkflowWorker["isContextReadAvailable"]>>[0],
  ): boolean {
    const resources = this.#resources(input);
    const revision = resources.workspaces.getRevision(
      input.currentWorkspaceRevisionId,
    );
    return revision.entries[input.path]?.kind === "file";
  }

  async runAttempt(
    input: Parameters<WorkflowWorker["runAttempt"]>[0],
  ): Promise<WorkflowAttemptOutcome> {
    if (input.signal.aborted) {
      return { kind: "operation-cancelled", code: "cancelled" };
    }
    const resources = await this.#prepareResources(
      {
        runId: input.runId,
        deliveryRevision: input.deliveryRevision,
        plan: input.plan,
        ...(input.baselineRevisionId
          ? { baselineRevisionId: input.baselineRevisionId }
          : {}),
        ...(input.currentWorkspaceRevisionId
          ? { currentWorkspaceRevisionId: input.currentWorkspaceRevisionId }
          : {}),
      },
      input.signal,
    );
    let selectedRoute: Required<WorkflowRouteFacts> | undefined;
    const retained = <T extends WorkflowAttemptOutcome>(outcome: T): T =>
      ({
        ...(selectedRoute ?? {}),
        ...outcome,
        baselineRevisionId: resources.baselineRevisionId,
        currentWorkspaceRevisionId: resources.currentRevisionId,
      }) as T;
    const ledger = this.#ledger(resources, input.deliveryRevision);
    let verificationBaseline: DurableVerificationBaseline | undefined;
    if (hasVerificationLifecycle(input.plan)) {
      emitWorkflowActivity(input.onActivity, { state: "verifying" });
      const captured = await this.#ensureVerificationBaseline({
        resources,
        ledger,
        signal: input.signal,
      });
      if (!captured.ok) {
        const outcome = captured.outcome;
        return retained(
          outcome.kind === "paused"
            ? {
                ...outcome,
                verification: {
                  scope: "baseline",
                  attribution: "environment",
                },
              }
            : outcome,
        );
      }
      verificationBaseline = captured.baseline;
    }
    this.#openTask(resources, ledger, input);
    if (input.artifactCorrection?.code === "red-artifact-constraint") {
      return retained(
        await this.#runRedArtifactCorrection({
          resources,
          ledger,
          ...(verificationBaseline ? { baseline: verificationBaseline } : {}),
          attempt: input,
        }),
      );
    }
    if (input.repair) {
      if (!verificationBaseline) {
        throw new Error("workflow-verification-baseline-unavailable");
      }
      return retained(
        await this.#runCumulativeRepair({
          resources,
          ledger,
          baseline: verificationBaseline,
          attempt: input,
        }),
      );
    }
    const policyFailure = await this.#revalidatePhasePolicy(
      resources,
      ledger,
      input.task,
      input.signal,
    );
    if (policyFailure) return retained(policyFailure);
    const replay = this.#replayedPhase(resources, ledger, input);
    if (replay) return retained(replay);
    const phase = input.task.phases[input.phase];
    if (!phase) throw new Error("workflow-task-phase-invalid");
    const approvedPaths = [
      ...new Set([...phase.write, ...phase.delete]),
    ].sort();
    const rollbackPaths = [
      ...new Set(
        Object.values(input.task.phases).flatMap((boundary) => [
          ...boundary.write,
          ...boundary.delete,
        ]),
      ),
    ].sort();
    if (approvedPaths.length === 0) {
      return retained({
        kind: "approval-needed",
        code: "task-write-set-empty",
      });
    }
    const baseRevisionId = resources.currentRevisionId;
    const pendingKey = `pending-${hash(input.taskId, input.phase, phase.verification.id).slice(0, 40)}`;
    const pending = this.#pendingCandidate(ledger, pendingKey, baseRevisionId);
    const proposalRoot = mkdtempSync(path.join(resources.root, "attempt-"));
    try {
      await resources.workspaces.materializeAsync(
        baseRevisionId,
        proposalRoot,
        input.signal,
      );
      if (input.routeId && !pending) {
        const rebound = this.#broker.resumeBinding({
          runId: input.runId,
          taskId: input.taskId,
          role: "implementation-worker",
          routeId: input.routeId,
          ...(input.routeFingerprint
            ? { expectedFingerprint: input.routeFingerprint }
            : {}),
          requirements: implementationRouteRequirements({
            task: input.task,
            ...(input.artifactCorrection
              ? { artifactCorrection: input.artifactCorrection }
              : {}),
            ...(input.repair ? { repair: input.repair } : {}),
          }),
        });
        if (!rebound.ok) {
          return retained({ kind: "paused", code: rebound.code });
        }
      }
      const ledgerProjection = ledger.projection({
        runId: input.runId,
        taskId: input.taskId,
        nextPhase: input.phase,
      });
      let identity: BeginCandidateInput | undefined = pending?.identity;
      const routed = pending
        ? {
            ok: true as const,
            value: pending.proposal,
            routeId: pending.identity.routeId,
            routeFingerprint: pending.identity.routeFingerprint,
          }
        : await this.#broker.run({
            runId: input.runId,
            taskId: input.taskId,
            operationId: `${input.operationId}:${input.taskId}:${input.phase}`,
            role: "implementation-worker",
            requirements: implementationRouteRequirements({
              task: input.task,
              ...(input.artifactCorrection
                ? { artifactCorrection: input.artifactCorrection }
                : {}),
              ...(input.repair ? { repair: input.repair } : {}),
            }),
            signal: input.signal,
            ...(input.onActivity ? { onActivity: input.onActivity } : {}),
            classifyResult: semanticRouteFailure,
            execute: async (attempt) => {
              identity = {
                candidateId: `candidate-${randomUUID()}`,
                runId: input.runId,
                deliveryRevision: input.deliveryRevision,
                taskId: input.taskId,
                phase: input.phase,
                attemptId: `attempt-${hash(
                  input.operationId,
                  input.taskId,
                  input.phase,
                  attempt.route.fingerprint,
                ).slice(0, 40)}`,
                approvedPaths,
                isolatedRevisionId: baseRevisionId,
                verificationId: phase.verification.id,
                routeId: attempt.route.id,
                routeFingerprint: attempt.route.fingerprint,
              };
              if (input.reserveCandidate && !input.reserveCandidate())
                return {
                  kind: "paused" as const,
                  code:
                    input.additionalAttempt || input.verificationOnly
                      ? "repair-attempts-exhausted"
                      : "change-work-budget-exhausted",
                };
              return this.#options.proposeCandidate({
                runId: input.runId,
                operationId: input.operationId,
                deliveryRevision: input.deliveryRevision,
                taskId: input.taskId,
                phase: input.phase,
                task: structuredClone(input.task),
                contextReadPaths: input.contextReadPaths,
                workspaceRoot: proposalRoot,
                ledgerProjection,
                candidateArtifact: {
                  ledger,
                  identity,
                  workspaceRoot: proposalRoot,
                  writePaths: phase.write,
                  deletePaths: phase.delete,
                },
                route: attempt.route,
                ...(input.contextRequest
                  ? { contextRequest: input.contextRequest }
                  : {}),
                ...(input.recoveryFeedback
                  ? { recoveryFeedback: input.recoveryFeedback }
                  : {}),
                signal: attempt.signal,
                onHeaders: attempt.onHeaders,
                onProgress: attempt.onProgress,
              });
            },
          });
      if (!routed.ok) {
        return retained(
          routed.state === "cancelled" || input.signal.aborted
            ? { kind: "operation-cancelled", code: "cancelled" }
            : { kind: "paused", code: routed.code },
        );
      }
      if (!identity || identity.routeId !== routed.routeId) {
        throw new Error("candidate-route-identity-invalid");
      }
      const correctionIdentity = identity;
      selectedRoute = {
        routeId: identity.routeId,
        routeFingerprint: identity.routeFingerprint,
      };
      let uncommittedRevisionId: string | undefined;
      const reject = async <T extends WorkflowAttemptOutcome>(
        outcome: T,
        correction: {
          category: "artifact" | "stale" | "verification" | "checkpoint";
          code: string;
          stage: string;
        },
        rollback = false,
      ): Promise<T> => {
        if (rollback && uncommittedRevisionId) {
          await this.#rollbackWorkspacePaths({
            resources,
            baseRevisionId,
            rejectedRevisionId: uncommittedRevisionId,
            paths: rollbackPaths,
          });
        }
        this.#recordCorrection(ledger, input, correctionIdentity, correction);
        return retained({ ...outcome, retryPolicy: correction.category });
      };
      const proposal = routed.value;
      if (
        proposal.kind !== "candidate" &&
        proposal.kind !== "sealed-candidate"
      ) {
        return proposal.kind === "operation-cancelled" ||
          proposal.kind === "paused" ||
          proposal.kind === "approval-needed"
          ? retained(proposal)
          : reject(proposal, {
              category: "artifact",
              code: proposal.code,
              stage: "candidate-submit",
            });
      }
      emitWorkflowActivity(input.onActivity, { state: "validating" });
      ledger.beginCandidate(identity);
      let bytes: Buffer;
      if (proposal.kind === "sealed-candidate") {
        if (
          proposal.candidateId !== identity.candidateId ||
          !SHA256.test(proposal.artifactHash) ||
          !Number.isSafeInteger(proposal.bytes) ||
          proposal.bytes < 1 ||
          !Array.isArray(proposal.paths)
        ) {
          return reject(
            { kind: "retryable", code: "candidate-diff-invalid" },
            {
              category: "artifact",
              code: "candidate-diff-invalid",
              stage: "candidate-seal",
            },
          );
        }
        bytes = Buffer.from(ledger.readSealedCandidate(identity.candidateId));
        if (
          bytes.length !== proposal.bytes ||
          sha256Bytes(bytes) !== proposal.artifactHash
        ) {
          throw new Error("candidate-seal-integrity-invalid");
        }
      } else {
        if (
          !(proposal.bytes instanceof Uint8Array) ||
          proposal.bytes.length === 0
        ) {
          return reject(
            { kind: "retryable", code: "candidate-diff-invalid" },
            {
              category: "artifact",
              code: "candidate-diff-invalid",
              stage: "candidate-submit",
            },
          );
        }
        bytes = Buffer.from(proposal.bytes);
      }
      let candidatePaths: string[];
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        candidatePaths = diffWritePaths(text).paths;
      } catch {
        return reject(
          { kind: "retryable", code: "candidate-diff-invalid" },
          {
            category: "artifact",
            code: "candidate-diff-invalid",
            stage: "candidate-diff",
          },
        );
      }
      if (
        candidatePaths.some((relative) => !approvedPaths.includes(relative))
      ) {
        return reject(
          { kind: "retryable", code: "write-set-mismatch" },
          {
            category: "artifact",
            code: "write-set-mismatch",
            stage: "candidate-boundary",
          },
        );
      }
      if (proposal.kind === "sealed-candidate") {
        if (
          JSON.stringify([...proposal.paths].sort()) !==
          JSON.stringify([...candidatePaths].sort())
        ) {
          return reject(
            { kind: "retryable", code: "candidate-diff-invalid" },
            {
              category: "artifact",
              code: "candidate-diff-invalid",
              stage: "candidate-seal",
            },
          );
        }
      }
      const dependencySensitive = candidatePaths.some(
        (relative) => relative === "package.json" || LOCKFILES.has(relative),
      );
      let dependenciesBefore: Map<string, DependencyContractEntry> | undefined;
      if (dependencySensitive) {
        try {
          dependenciesBefore = dependencyContract(proposalRoot);
        } catch (error) {
          if (!(error instanceof DependencyManifestError)) throw error;
          return reject(
            { kind: "retryable", code: error.message },
            {
              category: "artifact",
              code: error.message,
              stage: "candidate-dependency",
            },
          );
        }
      }
      const checked = await runGitApply(
        proposalRoot,
        bytes,
        true,
        input.signal,
      );
      if (checked !== "ok") {
        return checked === "cancelled"
          ? retained({ kind: "operation-cancelled", code: "cancelled" })
          : reject(
              { kind: "retryable", code: "candidate-diff-invalid" },
              {
                category: "artifact",
                code: "candidate-diff-invalid",
                stage: "candidate-check",
              },
            );
      }
      const applied = await runGitApply(
        proposalRoot,
        bytes,
        false,
        input.signal,
      );
      if (applied !== "ok") {
        return applied === "cancelled"
          ? retained({ kind: "operation-cancelled", code: "cancelled" })
          : reject(
              { kind: "retryable", code: "candidate-diff-invalid" },
              {
                category: "artifact",
                code: "candidate-diff-invalid",
                stage: "candidate-apply",
              },
            );
      }
      if (dependenciesBefore) {
        let dependenciesAfter: Map<string, DependencyContractEntry>;
        try {
          dependenciesAfter = dependencyContract(proposalRoot);
        } catch (error) {
          if (!(error instanceof DependencyManifestError)) throw error;
          return reject(
            { kind: "retryable", code: error.message },
            {
              category: "artifact",
              code: error.message,
              stage: "candidate-dependency",
            },
          );
        }
        if (
          hasUnapprovedDependencyChange(
            dependenciesBefore,
            dependenciesAfter,
            input.task.approvedDependencies,
            candidatePaths.some((relative) => LOCKFILES.has(relative)),
          )
        ) {
          return reject(
            { kind: "approval-needed", code: "unapproved-dependency-change" },
            {
              category: "artifact",
              code: "unapproved-dependency-change",
              stage: "candidate-dependency",
            },
          );
        }
      }
      let artifactHash: string;
      if (proposal.kind === "sealed-candidate") {
        artifactHash = proposal.artifactHash;
      } else {
        let sequence = 0;
        for (
          let offset = 0;
          offset < bytes.length;
          offset += TASK_LEDGER_LIMITS.maxSegmentBytes
        ) {
          const segment = bytes.subarray(
            offset,
            Math.min(offset + TASK_LEDGER_LIMITS.maxSegmentBytes, bytes.length),
          );
          const accepted = ledger.appendCandidateSegment({
            ...identity,
            sequence,
            bytes: segment,
            segmentHash: sha256Bytes(segment),
          });
          if (!accepted.ok) {
            return reject(
              { kind: "paused", code: accepted.code },
              {
                category: "artifact",
                code: accepted.code,
                stage: "candidate-segment",
              },
            );
          }
          sequence += 1;
        }
        const sealed = ledger.sealCandidate({
          ...identity,
          segmentCount: sequence,
          totalBytes: bytes.length,
          candidateHash: sha256Bytes(bytes),
        });
        if (!sealed.ok) {
          return reject(
            { kind: "retryable", code: sealed.code },
            {
              category: "artifact",
              code: sealed.code,
              stage: "candidate-seal",
            },
          );
        }
        artifactHash = sealed.artifactHash;
      }
      const candidate = resources.workspaces.createRevision({
        parentRevisionId: baseRevisionId,
        changes: revisionChanges(proposalRoot, approvedPaths),
      });
      if (
        candidatePaths.some((relative) => {
          const entry = candidate.entries[relative];
          return phase.delete.includes(relative)
            ? entry?.kind !== "absent"
            : entry?.kind !== "file";
        })
      ) {
        return reject(
          { kind: "retryable", code: "write-set-mismatch" },
          {
            category: "artifact",
            code: "write-set-mismatch",
            stage: "candidate-output",
          },
        );
      }
      const requiredOutputs = input.plan.outputs.filter(
        (output) =>
          output.producer.taskId === input.taskId &&
          output.producer.phase === input.phase,
      );
      if (
        requiredOutputs.some(
          (output) => candidate.entries[output.path]?.kind !== "file",
        )
      ) {
        return reject(
          { kind: "retryable", code: "producer-output-unavailable" },
          {
            category: "artifact",
            code: "producer-output-unavailable",
            stage: "candidate-output",
          },
        );
      }
      emitWorkflowActivity(input.onActivity, { state: "verifying" });
      this.#savePendingCandidate(ledger, pendingKey, {
        identity,
        proposal: {
          kind: "sealed-candidate",
          candidateId: identity.candidateId,
          artifactHash,
          bytes: bytes.length,
          paths: candidatePaths,
        },
      });
      const verified = await this.#verifyPhase({
        executionWritePaths: this.#executionWritePaths(resources),
        runId: input.runId,
        deliveryRevision: input.deliveryRevision,
        taskId: input.taskId,
        phase: input.phase,
        root: proposalRoot,
        verification: structuredClone(phase.verification),
        signal: input.signal,
      });
      if (!verified.ok) {
        if (verified.kind === "paused") return retained(verified);
        this.#savePendingCandidate(ledger, pendingKey, null);
        return reject(verified, {
          category: "verification",
          code: verified.code,
          stage: "phase-verification",
        });
      }
      const expected = expectedClassification(input.phase);
      if (
        verified.classification !== expected ||
        (input.phase === "red"
          ? verified.exitCode === 0
          : verified.exitCode !== 0)
      ) {
        return reject(
          { kind: "retryable", code: "verification-rejected" },
          {
            category: "verification",
            code: "verification-rejected",
            stage: "phase-verification",
          },
        );
      }
      let merged: ReturnType<WorkspaceStore["mergeRevision"]>;
      try {
        merged = await this.#mergeCandidate(
          resources,
          input,
          baseRevisionId,
          candidate.revisionId,
        );
        uncommittedRevisionId = merged.revisionId;
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "workspace-revision-stale"
        ) {
          return reject(
            { kind: "retryable", code: "workspace-revision-stale" },
            {
              category: "stale",
              code: "workspace-revision-stale",
              stage: "candidate-merge",
            },
          );
        }
        throw error;
      }
      const outputFacts = approvedPaths.map((relative) => {
        const entry = merged.entries[relative];
        return entry?.kind === "file"
          ? {
              path: relative,
              kind: "file" as const,
              hash: entry.hash,
              bytes: entry.bytes,
            }
          : { path: relative, kind: "absent" as const };
      });
      if (
        requiredOutputs.some(
          (output) => merged.entries[output.path]?.kind !== "file",
        )
      ) {
        return reject(
          { kind: "retryable", code: "producer-output-unavailable" },
          {
            category: "artifact",
            code: "producer-output-unavailable",
            stage: "candidate-output",
          },
          true,
        );
      }
      const phaseEvent: VerifiedTaskEvent = {
        runId: input.runId,
        taskId: input.taskId,
        eventId: `${input.phase}-verified-r${input.deliveryRevision}`,
        kind: "phase-verified",
        phase: input.phase,
        commandId: phase.verification.id,
        exitCode: verified.exitCode,
        expectedClassification: expected,
        actualClassification: verified.classification,
        diagnostic: verified.diagnostic,
        artifactHash,
        isolatedRevisionId: merged.revisionId,
        outputFacts,
        routeId: identity.routeId,
        routeFingerprint: identity.routeFingerprint,
      };
      if (this.#options.verificationPolicy || resources.environmentIdentity)
        ledger.putDurableFact(
          this.#policyFactKey(
            resources,
            phaseEvent as unknown as Record<string, unknown>,
          ),
          { policy: this.#options.verificationPolicy ?? "legacy" },
        );
      const finalPhase = input.task.phases.refactor ? "refactor" : "green";
      if (!verificationBaseline || input.phase !== finalPhase) {
        ledger.commitVerifiedEvent(phaseEvent);
        return retained({
          kind: "phase-committed",
          artifactHash,
          isolatedRevisionId: merged.revisionId,
          exitCode: verified.exitCode,
          classification: verified.classification,
          baselineRevisionId: resources.baselineRevisionId,
        });
      }

      const completionEvents: VerifiedTaskEvent[] = [phaseEvent];
      const discardUncommitted = async <T extends WorkflowAttemptOutcome>(
        outcome: T,
      ): Promise<T> => {
        if (uncommittedRevisionId) {
          await this.#rollbackWorkspacePaths({
            resources,
            baseRevisionId,
            rejectedRevisionId: uncommittedRevisionId,
            paths: rollbackPaths,
          });
        }
        return retained(outcome);
      };
      let affected = await this.#verifyTaskAffected({
        resources,
        baseline: verificationBaseline,
        task: input.task,
        revisionId: merged.revisionId,
        signal: input.signal,
      });
      let repairAttempts = 0;
      let completionAttribution: "none" | "pre-existing" | "introduced" =
        "none";
      while (affected.kind === "repairable") {
        completionAttribution = "introduced";
        if (
          !(
            input.recoveryDecision?.({
              kind: "affected-repair",
              attempt: repairAttempts + 1,
            }) ??
            decideRecoveryAction(
              input.plan,
              { kind: "affected-repair", attempt: repairAttempts + 1 },
              input,
            )
          ).allowed
        ) {
          return reject(
            { kind: "paused", code: "repair-attempts-exhausted" },
            {
              category: "verification",
              code: "repair-attempts-exhausted",
              stage: "task-affected-verification",
            },
            true,
          );
        }
        repairAttempts += 1;
        const failureIdentities = [...affected.failureIdentities];
        const repair = await this.#runRepairCandidate({
          resources,
          ledger,
          attempt: input,
          repairAttempt: repairAttempts,
          failureIdentities,
        });
        if (repair.kind !== "repair-committed") {
          return discardUncommitted(repair);
        }
        selectedRoute = {
          routeId: repair.commit.routeId,
          routeFingerprint: repair.commit.routeFingerprint,
        };
        uncommittedRevisionId = repair.commit.isolatedRevisionId;
        completionEvents.push({
          runId: input.runId,
          taskId: input.taskId,
          eventId: `repair-${repairAttempts}-verified-r${input.deliveryRevision}`,
          kind: "repair-verified",
          phase: input.phase,
          attempt: repairAttempts,
          commandId: input.task.repairVerification.id,
          exitCode: 0,
          diagnostic: repair.commit.diagnostic,
          artifactHash: repair.commit.artifactHash,
          isolatedRevisionId: repair.commit.isolatedRevisionId,
          outputFacts: repair.commit.outputFacts,
          attribution: "introduced",
          failureIdentities,
          routeId: repair.commit.routeId,
          routeFingerprint: repair.commit.routeFingerprint,
        });
        affected = await this.#verifyTaskAffected({
          resources,
          baseline: verificationBaseline,
          task: input.task,
          revisionId: repair.commit.isolatedRevisionId,
          signal: input.signal,
        });
      }
      if (affected.kind !== "verified") {
        return affected.kind === "operation-cancelled"
          ? discardUncommitted(affected)
          : reject(
              affected,
              {
                category: "verification",
                code: affected.code,
                stage: "task-affected-verification",
              },
              true,
            );
      }
      if (completionAttribution === "none") {
        completionAttribution = affected.attribution;
      }
      let completedRevision: WorkspaceRevision;
      try {
        completedRevision = this.#completeTracking(resources, input.taskId);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "workflow-tracking-task-mismatch"
        ) {
          return reject(
            { kind: "paused", code: "tracking-contract-invalid" },
            {
              category: "checkpoint",
              code: "tracking-contract-invalid",
              stage: "tracking-checkpoint",
            },
            true,
          );
        }
        throw error;
      }
      const factKey = `task-final-${hash(input.taskId).slice(0, 40)}`;
      ledger.commitTaskCompletion({
        events: completionEvents,
        factKey,
        fact: {
          taskId: input.taskId,
          phase: input.phase,
          isolatedRevisionId: completedRevision.revisionId,
          attribution: completionAttribution,
          repairAttempts,
        },
      });
      return retained({
        kind: "phase-committed",
        artifactHash,
        isolatedRevisionId: completedRevision.revisionId,
        exitCode: verified.exitCode,
        classification: verified.classification,
        baselineRevisionId: resources.baselineRevisionId,
      });
    } finally {
      rmSync(proposalRoot, { recursive: true, force: true });
    }
  }

  rebind(input: Parameters<WorkflowWorker["rebind"]>[0]) {
    const rebound = this.#broker.rebind({
      runId: input.runId,
      taskId: input.taskId,
      role: input.role,
      routeId: input.routeId,
      requirements: implementationRouteRequirements({ task: input.task }),
    });
    return rebound.ok
      ? {
          ok: true as const,
          routeId: rebound.route.id,
          routeFingerprint: rebound.route.fingerprint,
        }
      : { ok: false as const, code: rebound.code };
  }

  async verify(
    input: Parameters<WorkflowChangeVerifier["verify"]>[0],
  ): Promise<Awaited<ReturnType<WorkflowChangeVerifier["verify"]>>> {
    if (!input.currentWorkspaceRevisionId) {
      return { kind: "paused", code: "workspace-revision-unavailable" };
    }
    const resources = await this.#prepareResources(
      {
        runId: input.runId,
        deliveryRevision: input.deliveryRevision,
        plan: input.plan,
        currentWorkspaceRevisionId: input.currentWorkspaceRevisionId,
        baselineRevisionId:
          input.baselineRevisionId ??
          this.#runs.get(input.runId)?.baselineRevisionId,
      },
      input.signal,
    );
    try {
      await this.#refreshEnvironment(resources, input.signal);
    } catch {
      return { kind: "paused", code: "verification-environment-unavailable" };
    }
    for (const reference of input.taskEvidence ?? []) {
      const task = input.plan.tasks.find(
        (task) => task.taskId === reference.taskId,
      );
      if (!task) throw new Error("workflow-ledger-task-invalid");
      const failure = await this.#revalidatePhasePolicy(
        resources,
        this.#ledger(resources, reference.deliveryRevision),
        task,
        input.signal,
      );
      if (failure)
        return {
          kind: "paused",
          code:
            "code" in failure ? failure.code : "verification-policy-rejected",
        };
    }
    const cumulativeRevision = resources.workspaces.getRevision(
      resources.currentRevisionId,
    );
    if (
      input.plan.outputs.some(
        (output) => cumulativeRevision.entries[output.path]?.kind !== "file",
      )
    ) {
      return { kind: "paused", code: "producer-output-unavailable" };
    }
    if (hasVerificationLifecycle(input.plan)) {
      const ledger = this.#ledger(resources, input.deliveryRevision);
      const captured = await this.#ensureVerificationBaseline({
        resources,
        ledger,
        signal: input.signal,
      });
      if (!captured.ok) {
        return captured.outcome.kind === "approval-needed"
          ? captured.outcome
          : captured.outcome.kind === "operation-cancelled"
            ? { kind: "paused", code: "cancelled" }
            : {
                ...captured.outcome,
                verification: {
                  scope: "baseline",
                  attribution: "environment",
                },
              };
      }
      for (const task of input.plan.tasks) {
        const baseline = captured.baseline.affected.find(
          (entry) => entry.taskId === task.taskId,
        );
        if (!baseline) throw new Error("workflow-task-baseline-unavailable");
        const current = await this.#observeVerification({
          resources,
          revisionId: resources.currentRevisionId,
          scope: "change-task-affected",
          verification: task.affectedVerification,
          taskId: task.taskId,
          signal: input.signal,
        });
        if (!current.ok) {
          return current.outcome.kind === "approval-needed"
            ? current.outcome
            : current.outcome.kind === "operation-cancelled"
              ? { kind: "paused", code: "cancelled" }
              : {
                  ...current.outcome,
                  verification: {
                    scope: "change-task-affected",
                    attribution: "environment",
                    taskId: task.taskId,
                  },
                };
        }
        if (current.observation.status === "failed") {
          const prior = new Set(baseline.observation.failureIdentities);
          const introduced = current.observation.failureIdentities.filter(
            (identity) => !prior.has(identity),
          );
          if (introduced.length > 0) {
            return {
              kind: "paused",
              code: "verification-repair-required",
              verification: {
                scope: "change-task-affected",
                attribution: "introduced",
                taskId: task.taskId,
                failureIdentities: introduced.slice(0, 256),
              },
            };
          }
        }
      }
      const fullSuite = await this.#observeVerification({
        resources,
        revisionId: resources.currentRevisionId,
        scope: "change-full-suite",
        verification: input.plan.verification.change.fullSuite,
        signal: input.signal,
      });
      if (!fullSuite.ok) {
        return fullSuite.outcome.kind === "approval-needed"
          ? fullSuite.outcome
          : fullSuite.outcome.kind === "operation-cancelled"
            ? { kind: "paused", code: "cancelled" }
            : {
                ...fullSuite.outcome,
                verification: {
                  scope: "change-full-suite",
                  attribution: "environment",
                },
              };
      }
      if (fullSuite.observation.status === "failed") {
        const baselineFailures = new Set(
          captured.baseline.fullSuite.failureIdentities,
        );
        const introduced = fullSuite.observation.failureIdentities.filter(
          (identity) => !baselineFailures.has(identity),
        );
        if (introduced.length > 0) {
          return {
            kind: "paused",
            code: "verification-attribution-unresolved",
            verification: {
              scope: "change-full-suite",
              attribution: "unresolved",
              failureIdentities: introduced.slice(0, 256),
            },
          };
        }
      }
      const checkpoint = input.plan.verification.agentsCheckpoint;
      if (checkpoint.required && checkpoint.verification) {
        const applied = this.#applyAgentsCheckpoint(resources);
        if (!applied.ok) {
          return { kind: "paused", code: applied.code };
        }
        const observed = await this.#observeVerification({
          resources,
          revisionId: applied.revision.revisionId,
          scope: "agents-checkpoint",
          verification: checkpoint.verification,
          signal: input.signal,
        });
        if (!observed.ok) {
          return observed.outcome.kind === "approval-needed"
            ? observed.outcome
            : observed.outcome.kind === "operation-cancelled"
              ? { kind: "paused", code: "cancelled" }
              : {
                  ...observed.outcome,
                  verification: {
                    scope: "agents-checkpoint",
                    attribution: "environment",
                  },
                };
        }
        if (observed.observation.status === "failed") {
          return {
            kind: "paused",
            code: "agents-checkpoint-verification-failed",
            verification: {
              scope: "agents-checkpoint",
              attribution: "introduced",
              failureIdentities: observed.observation.failureIdentities.slice(
                0,
                256,
              ),
            },
          };
        }
        resources.currentRevisionId = applied.revision.revisionId;
      }
      const verificationId = `change-${hash(
        input.plan.changeId,
        String(input.deliveryRevision),
        resources.currentRevisionId,
        ...(resources.environmentIdentity
          ? [resources.environmentIdentity]
          : []),
      ).slice(0, 40)}`;
      const sealed = await verifyCumulativeRevision({
        workspaceStore: resources.workspaces,
        revisionId: resources.currentRevisionId,
        verificationId,
        signal: input.signal,
        execute: async () => ({
          ok: true as const,
          exitCode: 0 as const,
          classification: "lifecycle-verified",
        }),
      });
      if (!sealed.ok) return { kind: "paused", code: sealed.code };
      resources.verificationFact = sealed.fact;
      return {
        kind: "verified",
        verificationId: sealed.verificationId,
        currentWorkspaceRevisionId: resources.currentRevisionId,
      };
    }
    const verificationId = `change-${hash(
      input.plan.changeId,
      String(input.deliveryRevision),
      ...(resources.environmentIdentity ? [resources.environmentIdentity] : []),
    ).slice(0, 40)}`;
    const result = await verifyCumulativeRevision({
      workspaceStore: resources.workspaces,
      revisionId: resources.currentRevisionId,
      verificationId,
      signal: input.signal,
      execute: ({ root, signal }) =>
        this.#verifyChange({
          runId: input.runId,
          deliveryRevision: input.deliveryRevision,
          root,
          plan: structuredClone(input.plan),
          signal: signal ?? input.signal,
        }),
    });
    if (!result.ok) {
      return {
        kind:
          result.kind === "approval-boundary"
            ? "approval-needed"
            : result.kind === "verification"
              ? "retryable"
              : "paused",
        code: result.code,
      };
    }
    resources.verificationFact = result.fact;
    return { kind: "verified", verificationId: result.verificationId };
  }

  async prepare(
    input: Parameters<WorkflowApplication["begin"]>[0],
  ): Promise<Record<string, unknown>> {
    if (!input.baselineRevisionId || !input.currentWorkspaceRevisionId) {
      return { state: "paused", code: "workspace-revision-unavailable" };
    }
    const resources = await this.#prepareResources(
      {
        runId: input.runId,
        deliveryRevision: input.deliveryRevision,
        plan: input.plan,
        baselineRevisionId: input.baselineRevisionId,
        currentWorkspaceRevisionId: input.currentWorkspaceRevisionId,
      },
      input.signal,
    );
    if (!resources.verificationFact) {
      return { state: "paused", code: "verification-fact-unavailable" };
    }
    if (this.#options.verificationEnvironment) {
      if (!resources.environmentIdentity)
        return {
          state: "paused",
          code: "verification-environment-unavailable",
        };
      this.#ledger(resources, resources.deliveryRevision).putDurableFact(
        `apply-environment-${hash(input.transactionId).slice(0, 40)}`,
        { identity: resources.environmentIdentity },
      );
    }
    const prepared = await resources.transactions.prepare({
      transactionId: input.transactionId,
      consumerRoot: input.consumerRoot,
      baselineRevisionId: resources.baselineRevisionId,
      finalRevisionId: resources.currentRevisionId,
      boundPaths: [
        ...new Set([
          ...deliveryBoundPaths(input.plan),
          ...(input.contextReadPaths ?? []),
        ]),
      ].sort(),
      verificationFact: resources.verificationFact,
    });
    return prepared;
  }

  async applyPrepared(
    input: Parameters<WorkflowApplication["begin"]>[0],
  ): Promise<Record<string, unknown>> {
    const resources = await this.#prepareResources(
      {
        runId: input.runId,
        deliveryRevision: input.deliveryRevision,
        plan: input.plan,
        ...(input.baselineRevisionId
          ? { baselineRevisionId: input.baselineRevisionId }
          : {}),
        ...(input.currentWorkspaceRevisionId
          ? { currentWorkspaceRevisionId: input.currentWorkspaceRevisionId }
          : {}),
      },
      input.signal,
    );
    return resources.transactions.apply(input.transactionId, input.signal);
  }

  async begin(
    input: Parameters<WorkflowApplication["begin"]>[0],
  ): Promise<Record<string, unknown>> {
    const prepared = await this.prepare(input);
    return prepared.state === "prepared" ? this.applyPrepared(input) : prepared;
  }

  #resourcesForApplication(
    context: WorkflowApplicationContext | undefined,
  ): DurableRunResources {
    if (!context) throw new Error("workflow-application-context-unavailable");
    return this.#resources({
      runId: context.runId,
      deliveryRevision: context.deliveryRevision,
      plan: context.plan,
      ...(context.baselineRevisionId
        ? { baselineRevisionId: context.baselineRevisionId }
        : {}),
      ...(context.currentWorkspaceRevisionId
        ? { currentWorkspaceRevisionId: context.currentWorkspaceRevisionId }
        : {}),
    });
  }

  requestControl(
    transactionId: string,
    intent: "cancel" | "discard",
    context?: WorkflowApplicationContext,
  ): Record<string, unknown> {
    return this.#resourcesForApplication(context).transactions.requestControl(
      transactionId,
      intent,
    );
  }

  recover(
    transactionId: string,
    context?: WorkflowApplicationContext,
  ): Promise<Record<string, unknown>> {
    return this.#resourcesForApplication(context).transactions.recover(
      transactionId,
    );
  }

  cleanup(runId: string): void {
    const resources = this.#runs.get(runId);
    if (resources) {
      this.#closeResources(resources);
      this.#runs.delete(runId);
    }
    rmSync(this.#runRoot(runId), { recursive: true, force: true });
  }

  close(): void {
    for (const resources of this.#runs.values()) {
      this.#closeResources(resources);
    }
    this.#runs.clear();
    this.#routeHealth.close();
  }
}

export function openDurableWorkflowEngine(
  options: DurableWorkflowEngineOptions,
): WorkflowEngine {
  const composition = new DurableWorkflowComposition(options);
  return WorkflowEngine.open({
    consumerRoot: options.consumerRoot,
    stateRoot: options.stateRoot,
    deliverySource: options.deliverySource,
    worker: composition,
    ...(options.workHardLimit !== undefined
      ? { workHardLimit: options.workHardLimit }
      : {}),
    changeVerifier: composition,
    application: composition,
    lifecycle: composition,
    ...(options.now ? { now: options.now } : {}),
    ...(options.leaseTtlMs !== undefined
      ? { leaseTtlMs: options.leaseTtlMs }
      : {}),
  });
}
