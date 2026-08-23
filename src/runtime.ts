import { lstatSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import type { Usage } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Activation, type ActivationState } from "./activation.ts";
import { loadAgentDefinitions } from "./agent-registry.ts";
import type { BaselineEntry } from "./candidate-preflight.ts";
import { runChildSession, UsageAggregator } from "./child-session.ts";
import {
  ACTIONS,
  type AgentsCheckpointAttempt,
  type AgentsCheckpointRequest,
  type CandidateFailure,
  type ChildFailure,
  type DiffResult,
  type ImplementApplyOperation,
  type ImplementationPhase,
  type ImplementDiscardOperation,
  type ImplementOutcome,
  type ImplementRunRequest,
  LIMITS,
  type PhaseAttempt,
  type RequestEnvelope,
  type RunRequest,
  type TaskBoundary,
  type TaskFailure,
  validateAgentsCheckpointAttempt,
  validateImplementApplyOperation,
  validateImplementDiscardOperation,
  validatePhaseAttemptAgainstBoundary,
  validateRequestEnvelope,
} from "./contracts.ts";
import { drainStage } from "./drain.ts";
import {
  type Bound,
  type DirBound,
  type FileBound,
  isCurrent,
  mergeBounds,
  snapshotDirManifest,
  snapshotFile,
  snapshotFiles,
} from "./file-snapshot.ts";
import type { ParentPayloadBridge } from "./parent-payload-bridge.ts";
import { customPhaseRuntime, runtimeFromContext } from "./parent-provider.ts";
import { applyAgentsCheckpoint, applyRetainedPatch } from "./patch.ts";
import {
  type BoundRetainedResult,
  ResultStore,
  type RetainedCandidateFacts,
  type RetainedCandidateIdentity,
} from "./result-store.ts";
import { declarationsConflict, Scheduler } from "./scheduler.ts";
import {
  describeInvalidSubagentEndpoint,
  resolveSubagentEndpoint,
  type SubagentEndpoint,
} from "./subagent-endpoint.ts";
import {
  type TaskRecord,
  taskConflictOf,
  taskRecordKey,
  WorkerRegistry,
  workerIdentity,
} from "./worker.ts";

const SHA256_HEX = /^[0-9a-f]{64}$/;

function isFileSystemFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  );
}

function canonicalWorkspaceRoot(root: string): string | null {
  try {
    return realpathSync(root);
  } catch {
    return null;
  }
}

function isImplementRunRequest(
  request: RunRequest,
): request is ImplementRunRequest {
  return request.stage === "abel-implement" && "kind" in request;
}

function targetsImplement(request: unknown): boolean {
  return (
    typeof request === "object" &&
    request !== null &&
    !Array.isArray(request) &&
    (request as Record<string, unknown>).stage === "abel-implement"
  );
}

function cloneLegacyEnvelope(request: RequestEnvelope): RequestEnvelope {
  return {
    ...request,
    taskId: request.taskId ?? request.id,
    roots: [...request.roots],
    context: { ...request.context },
    declared: {
      ...request.declared,
      read: [...request.declared.read],
      write: [...request.declared.write],
      conflicts: [...request.declared.conflicts],
      resources: [...request.declared.resources],
    },
    ...(request.approvedDependencies === undefined
      ? {}
      : { approvedDependencies: [...request.approvedDependencies] }),
    ...(request.impactClosure === undefined
      ? {}
      : { impactClosure: structuredClone(request.impactClosure) }),
    ...(request.verification === undefined
      ? {}
      : {
          verification: {
            ...request.verification,
            argv: [...request.verification.argv],
          },
        }),
    ...(request.snapshot === undefined
      ? {}
      : { snapshot: structuredClone(request.snapshot) }),
  };
}

function deriveImplementEnvelope(
  record: TaskRecord,
  attempt: PhaseAttempt,
): RequestEnvelope {
  const boundary = record.boundary;
  const phase = boundary.phases[attempt.phase];
  if (!phase) throw new Error("task attempt phase is not declared");
  return {
    stage: "abel-implement",
    role: "implementation-worker",
    taskId: boundary.taskId,
    id: attempt.requestId,
    phase: attempt.phase,
    objective: boundary.objective,
    roots: [...boundary.roots],
    context: { ...boundary.context },
    declared: {
      read: [...phase.read],
      write: [...phase.write],
      conflicts: [...boundary.scheduling.conflicts],
      resources: [...boundary.scheduling.resources],
      ...(phase.verificationLock === undefined
        ? {}
        : { verificationLock: phase.verificationLock }),
    },
    output: "diff",
    agentsImpact: boundary.agents.impact,
    ...(boundary.agents.target === undefined
      ? {}
      : { agentsTarget: boundary.agents.target }),
    agentsManagedOnly: true,
    approvedDependencies: [...boundary.approvedDependencies],
    impactClosure: structuredClone(boundary.impactClosure),
    verification: {
      ...phase.verification,
      argv: [...phase.verification.argv],
    },
    snapshot: structuredClone(attempt.snapshot),
  };
}

function nextDeclaredPhase(
  boundary: TaskBoundary,
  phase: PhaseAttempt["phase"],
): "green" | "refactor" | null {
  if (phase === "red") return "green";
  if (phase === "green" && boundary.phases.refactor) return "refactor";
  return null;
}

function assertAttemptAllowed(record: TaskRecord, attempt: PhaseAttempt): void {
  switch (record.state.kind) {
    case "candidate-pending":
      throw new Error("current phase candidate is awaiting parent apply");
    case "agents-checkpoint-pending":
      throw new Error("AGENTS checkpoint is pending");
    case "blocked":
      if (attempt.phase !== record.state.phase) {
        throw new Error("terminal task phase mismatch");
      }
      return;
    case "completed":
      if (attempt.phase !== record.state.finalPhase) {
        throw new Error("terminal task phase mismatch");
      }
      return;
    case "ready":
      if (attempt.phase !== record.state.phase) {
        throw new Error("invalid implementation phase transition");
      }
  }
}

function taskPhase(record: TaskRecord): PhaseAttempt["phase"] {
  return record.state.kind === "agents-checkpoint-pending" ||
    record.state.kind === "completed"
    ? record.state.finalPhase
    : record.state.phase;
}

function taskLaunchIndex(record: TaskRecord): 0 | 1 {
  return record.state.kind === "ready" ||
    record.state.kind === "candidate-pending"
    ? record.state.launchIndex
    : record.state.kind === "blocked" &&
        record.state.failure.kind === "attempts-exhausted"
      ? 1
      : 0;
}

interface PreparedPreflight {
  snapshot: Bound;
  baseline: BaselineEntry[];
  packageManifest: FileBound;
  lockfile: FileBound;
  dependencyTarget: FileBound | DirBound;
}

function addBaselineFile(
  root: string,
  relative: string,
  executable: boolean,
  entries: Map<string, BaselineEntry>,
  observed: Bound,
): boolean {
  const bound = snapshotFile(root, relative);
  if (!bound) return false;
  observed[relative] = bound;
  entries.set(relative, {
    path: relative,
    kind: "file",
    sha256: bound.sha256,
    bytes: bound.bytes,
    executable,
  });
  return true;
}

function addDirectoryFiles(
  root: string,
  relative: string,
  entries: Map<string, BaselineEntry>,
  observed: Bound,
): boolean {
  const directory = path.resolve(root, relative);
  for (const name of readdirSync(directory).sort()) {
    const child = path.posix.join(relative, name);
    const stat = lstatSync(path.resolve(root, child));
    if (stat.isSymbolicLink()) return false;
    if (stat.isDirectory()) {
      if (!addDirectoryFiles(root, child, entries, observed)) return false;
      continue;
    }
    if (!stat.isFile()) return false;
    if (
      !addBaselineFile(
        root,
        child,
        Boolean(stat.mode & 0o111),
        entries,
        observed,
      )
    )
      return false;
  }
  return true;
}

function preparePreflight(
  root: string,
  envelope: RequestEnvelope,
  requestSnapshot: Bound,
): PreparedPreflight | null {
  if (!envelope.verification) return null;
  const packageManifest = snapshotFile(root, "package.json");
  const lockPath = [
    "bun.lock",
    "bun.lockb",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
  ].find((candidate) => snapshotFile(root, candidate) !== null);
  const lockfile = lockPath ? snapshotFile(root, lockPath) : null;
  const dependencyTarget =
    snapshotDirManifest(root, "node_modules") ??
    snapshotFile(root, "node_modules");
  if (!packageManifest || !lockPath || !lockfile || !dependencyTarget)
    return null;
  if (!isCurrent(root, requestSnapshot)) {
    return {
      snapshot: mergeBounds(
        snapshotFiles(root, ["package.json", lockPath]),
        { node_modules: dependencyTarget },
        requestSnapshot,
      ),
      baseline: [],
      packageManifest,
      lockfile,
      dependencyTarget,
    };
  }

  const paths = new Set([
    ...Object.keys(requestSnapshot),
    ...envelope.declared.read,
    ...envelope.declared.write,
    "package.json",
    lockPath,
    ...envelope.verification.argv.slice(3),
  ]);
  const entries = new Map<string, BaselineEntry>();
  const observed: Bound = {};
  for (const relative of [...paths].sort()) {
    const absolute = path.resolve(root, relative);
    if (
      absolute === root ||
      !absolute.startsWith(`${path.resolve(root)}${path.sep}`)
    ) {
      continue;
    }
    const stat = lstatSync(absolute, { throwIfNoEntry: false });
    if (!stat) {
      observed[relative] = { kind: "absent", absent: true };
      entries.set(relative, { path: relative, kind: "deleted" });
      continue;
    }
    if (stat.isDirectory()) {
      if (relative === "node_modules") continue;
      try {
        if (!addDirectoryFiles(root, relative, entries, observed)) return null;
      } catch {
        return null;
      }
      continue;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    if (
      !addBaselineFile(
        root,
        relative,
        Boolean(stat.mode & 0o111),
        entries,
        observed,
      )
    )
      return null;
  }
  const baseline = [...entries.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  const dependencyBound: Bound = {
    node_modules: dependencyTarget,
  };
  return {
    snapshot: mergeBounds(observed, dependencyBound, requestSnapshot),
    baseline,
    packageManifest,
    lockfile,
    dependencyTarget,
  };
}

function cancellationError(
  signal: AbortSignal,
): Extract<WrappedDispatchResult, { ok: false }> {
  const reason = signal.reason;
  return {
    ok: false,
    error:
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
          ? reason
          : "child phase cancelled",
  };
}

type FailureClass = "transport" | "artifact" | "environment";

type InternalResultMetadata = {
  failureKind?: RunFailureKind;
  failureClass?: FailureClass;
  failure?: ChildFailure | TaskFailure;
  launchConsumed?: true;
};

type ChildDispatchResult = WrappedDispatchResult & InternalResultMetadata;
type InternalDispatchResult = (
  | WrappedDispatchResult
  | (ImplementOutcome & { usage?: Usage })
) &
  InternalResultMetadata;
type InternalFailureResult = Extract<WrappedDispatchResult, { ok: false }> &
  InternalResultMetadata;

interface OutcomeIdentity {
  taskId: string;
  requestId: string;
  phase: ImplementationPhase;
}

function blockedOutcome(
  identity: OutcomeIdentity,
  failure: TaskFailure,
): ImplementOutcome {
  return { kind: "blocked", ...identity, failure: structuredClone(failure) };
}

function cancelledOutcome(identity: OutcomeIdentity): ImplementOutcome {
  return { kind: "cancelled", ...identity };
}

function retryOutcome(
  identity: OutcomeIdentity,
  scope: "worker" | "checkpoint",
  cause: "artifact" | "stale",
): ImplementOutcome {
  return {
    kind: "retry",
    ...identity,
    scope,
    cause,
    remainingAttempts: 1,
  };
}

function failureClassOf(failure: ChildFailure): FailureClass | undefined {
  switch (failure.kind) {
    case "artifact":
      return "artifact";
    case "environment":
      return "environment";
    case "transport":
      return "transport";
    case "stale":
    case "approval-boundary":
    case "cancelled":
    case "result-limit":
      return undefined;
  }
}

function artifactCorrectionEvidence(failure?: ChildFailure): string {
  return failure?.kind === "artifact"
    ? `candidate:${failure.code}`
    : "generated-artifact-rejection";
}

function childFailureOf(result: InternalFailureResult): ChildFailure {
  if (result.failure) {
    switch (result.failure.kind) {
      case "artifact":
      case "stale":
      case "environment":
      case "approval-boundary":
      case "cancelled":
      case "result-limit":
      case "transport":
        return result.failure;
      case "attempts-exhausted":
      case "checkpoint-attempts-exhausted":
        break;
    }
  }
  if (result.failureKind === "cancelled") {
    return { kind: "cancelled", code: "cancelled" };
  }
  switch (result.failureClass) {
    case "artifact":
      return { kind: "artifact", code: "invalid-diff" };
    case "environment":
      return { kind: "environment", code: "root-unavailable" };
    default:
      return {
        kind: "transport",
        code:
          result.failureKind === "timed-out" ? "timeout" : "transport-failure",
      };
  }
}

function terminalTaskFailure(failure: ChildFailure): TaskFailure | undefined {
  switch (failure.kind) {
    case "approval-boundary":
    case "environment":
    case "result-limit":
      return failure;
    case "artifact":
    case "stale":
    case "cancelled":
    case "transport":
      return undefined;
  }
}

function attemptFailureCause(
  failure: ChildFailure,
): "artifact" | "stale" | "transport" {
  switch (failure.kind) {
    case "artifact":
    case "stale":
    case "transport":
      return failure.kind;
    case "approval-boundary":
    case "environment":
    case "result-limit":
    case "cancelled":
      throw new Error("non-retryable failure reached the launch budget");
  }
}

function assertNever(value: never): never {
  throw new Error(`unhandled candidate failure: ${JSON.stringify(value)}`);
}

export type RunFailureKind = "failed" | "cancelled" | "timed-out";
export type RuntimeFailureReason =
  | "subagent failed"
  | "subagent cancelled"
  | "phase timed out";
export type RuntimeActivityState =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed-out";

export interface RuntimeActivityEvent {
  state: RuntimeActivityState;
  requestId: string;
  role: string;
  phase: string;
  objective: string;
  sequence: number;
  failureReason?: RuntimeFailureReason;
}

export type RuntimeActivityObserver = (
  event: RuntimeActivityEvent,
) => void | Promise<void>;

interface ScheduledRunResult {
  dispatch: InternalDispatchResult;
  failureKind?: RunFailureKind;
}

function isSafeBound(snapshot: unknown): snapshot is Bound {
  if (
    typeof snapshot !== "object" ||
    snapshot === null ||
    Array.isArray(snapshot)
  )
    return false;
  for (const [path, value] of Object.entries(
    snapshot as Record<string, unknown>,
  )) {
    if (
      !path ||
      path.startsWith("/") ||
      path === "." ||
      path === ".." ||
      path.includes("/../") ||
      path.endsWith("/..") ||
      path.includes("\\")
    )
      return false;
    if (typeof value !== "object" || value === null) return false;
    const entry = value as Record<string, unknown>;
    if (entry.kind === "file") {
      if (
        typeof entry.sha256 !== "string" ||
        !SHA256_HEX.test(entry.sha256) ||
        typeof entry.bytes !== "number" ||
        !Number.isSafeInteger(entry.bytes) ||
        entry.bytes < 0
      )
        return false;
    } else if (entry.kind === "dir") {
      if (
        typeof entry.manifest !== "string" ||
        !SHA256_HEX.test(entry.manifest)
      )
        return false;
    } else if (entry.kind === "absent") {
      if (entry.absent !== true) return false;
    } else {
      return false;
    }
  }
  return true;
}

export type WrappedDispatchResult =
  | {
      ok: true;
      action: string;
      result?: unknown;
      resultId?: string;
      usage?: Usage;
    }
  | {
      ok: false;
      notReady?: true;
      error: string;
      failure?: ChildFailure | TaskFailure;
      usage?: Usage;
    };

export type DispatchResult =
  | WrappedDispatchResult
  | (ImplementOutcome & { usage?: Usage });

export function isWrappedDispatchResult(
  result: DispatchResult,
): result is WrappedDispatchResult {
  return "ok" in result;
}

export interface RuntimeOptions {
  activation?: Activation;
  parentPayloadBridge: ParentPayloadBridge;
}

type RunContext = Pick<ExtensionContext, "cwd" | "model" | "modelRegistry">;

interface StoredRunContext {
  ctx: RunContext;
  observer?: RuntimeActivityObserver;
  sequence: number;
  runningEmitted: boolean;
  terminalEmitted: boolean;
  usage: UsageAggregator;
}

export class Runtime {
  readonly activation: Activation;
  readonly limits = LIMITS;
  readonly results = new ResultStore();
  private applyTail: Promise<void> = Promise.resolve();
  private applySeq = 0;
  private batchSeq = 0;
  private readonly parentPayloadBridge: ParentPayloadBridge;
  private readonly registry = new WorkerRegistry();
  private readonly taskRecords = new WeakMap<RequestEnvelope, TaskRecord>();
  private readonly runContexts = new WeakMap<
    RequestEnvelope,
    StoredRunContext
  >();
  private readonly scheduler: Scheduler<ScheduledRunResult>;

  constructor(opts: RuntimeOptions) {
    this.activation = opts.activation ?? new Activation();
    this.parentPayloadBridge = opts.parentPayloadBridge;
    this.scheduler = new Scheduler({
      limit: LIMITS.maxActiveChildSessions,
      execute: async (request, signal) => {
        const context = this.runContexts.get(request);
        if (!context) throw new Error("scheduled run context is unavailable");
        const task = this.taskRecords.get(request);
        let candidateRollback:
          | {
              resultId: string;
              requestId: string;
              phase: ImplementationPhase;
              launchIndex: 0 | 1;
              priorState: TaskRecord["state"];
            }
          | undefined;
        const rollback = () => {
          const pending = candidateRollback;
          if (!pending) return;
          this.results.discard(pending.resultId);
          if (
            task?.state.kind === "candidate-pending" &&
            task.state.resultId === pending.resultId &&
            task.state.originRequestId === pending.requestId &&
            task.state.phase === pending.phase &&
            task.state.launchIndex === pending.launchIndex
          ) {
            task.state = structuredClone(pending.priorState);
          }
        };
        signal.addEventListener("abort", rollback, { once: true });
        this.notify(request, context, "running");
        const result = await this.runScheduled(request, context, signal);
        if (!isWrappedDispatchResult(result) && result.kind === "candidate") {
          if (!task) throw new Error("candidate TaskRecord is unavailable");
          if (task.state.kind !== "ready") {
            throw new Error("candidate TaskRecord is not ready");
          }
          candidateRollback = {
            resultId: result.resultId,
            requestId: result.requestId,
            phase: result.phase,
            launchIndex: task.state.launchIndex,
            priorState: structuredClone(task.state),
          };
          if (signal.aborted) {
            rollback();
          } else {
            try {
              this.rememberRetainedResult(result, request, task);
            } catch (error) {
              this.results.discard(result.resultId);
              throw error;
            }
            if (signal.aborted) rollback();
          }
        }
        return {
          dispatch: result,
          ...(result.failureKind === undefined
            ? {}
            : { failureKind: result.failureKind }),
        };
      },
    });
  }

  async execute(
    action: string,
    params: {
      request?: unknown;
      resultId?: string;
      requestId?: string;
      rejection?: unknown;
      agentsCheckpoint?: unknown;
    },
    ctx?: RunContext,
    signal?: AbortSignal,
    observer?: RuntimeActivityObserver,
  ): Promise<DispatchResult> {
    if (!(ACTIONS as readonly string[]).includes(action)) {
      throw new Error(`unknown action: ${String(action)}`);
    }
    if (!this.activation.isActive()) {
      return { ok: false, notReady: true, error: "dispatcher is not active" };
    }
    if (action === "run")
      return this.run(params.request, ctx, signal, observer);
    if (action === "apply") {
      if (!ctx) throw new Error("apply requires context");
      if (params.agentsCheckpoint !== undefined) {
        if (params.resultId !== undefined) {
          throw new Error("apply accepts either resultId or AGENTS checkpoint");
        }
        const validation = validateAgentsCheckpointAttempt(
          params.agentsCheckpoint,
        );
        if (!validation.ok) {
          throw new Error(`Implement protocol error: ${validation.reason}`);
        }
        return this.enqueueAgentsCheckpoint(ctx.cwd, validation.value, signal);
      }
      if (!params.resultId) {
        throw new Error("apply requires resultId");
      }
      const retained = this.results.get(params.resultId);
      if (
        params.requestId !== undefined ||
        (retained && this.results.hasCandidateIdentity(params.resultId))
      ) {
        const validation = validateImplementApplyOperation(params);
        if (!validation.ok) {
          throw new Error(`Implement protocol error: ${validation.reason}`);
        }
        if (!retained || !this.results.hasCandidateIdentity(params.resultId)) {
          throw new Error("retained Implement result not found");
        }
        return this.enqueueApply(ctx.cwd, validation.value, signal);
      }
      return this.enqueueApply(ctx.cwd, { resultId: params.resultId }, signal);
    }
    if (action === "discard") {
      if (!params.resultId) throw new Error("discard requires resultId");
      const retained = this.results.get(params.resultId);
      if (
        params.requestId !== undefined ||
        params.rejection !== undefined ||
        (retained && this.results.hasCandidateIdentity(params.resultId))
      ) {
        const validation = validateImplementDiscardOperation(params);
        if (!validation.ok) {
          throw new Error(`Implement protocol error: ${validation.reason}`);
        }
        if (!retained || !this.results.hasCandidateIdentity(params.resultId)) {
          throw new Error("retained Implement result not found");
        }
        return this.enqueueDiscard(validation.value);
      }
      return this.discardRetainedCandidate(params.resultId)
        ? { ok: true, action }
        : { ok: false, error: "retained result not found" };
    }
    if (action === "cancel") {
      await this.scheduler.cancelAll();
      return { ok: true, action };
    }
    await this.drain();
    return { ok: true, action: "finish" };
  }

  private enqueueAgentsCheckpoint(
    root: string,
    attempt: AgentsCheckpointAttempt,
    signal?: AbortSignal,
  ): Promise<DispatchResult> {
    const sequence = ++this.applySeq;
    return this.enqueueParentApply(() =>
      this.performAgentsCheckpoint(root, attempt, signal),
    ).then((result) => {
      if (
        isWrappedDispatchResult(result) ||
        result.kind !== "completed" ||
        !result.result
      ) {
        return result;
      }
      return {
        ...result,
        result: { ...result.result, sequence },
      };
    });
  }

  private async performAgentsCheckpoint(
    root: string,
    attempt: AgentsCheckpointAttempt,
    signal?: AbortSignal,
  ): Promise<DispatchResult> {
    const workspaceRoot = canonicalWorkspaceRoot(root);
    if (!workspaceRoot) {
      throw new Error("AGENTS checkpoint workspace is unavailable");
    }
    const worker = this.registry.get(
      taskRecordKey(workspaceRoot, attempt.changeId, attempt.taskId),
    );
    if (!worker) {
      if (
        this.registry
          .values()
          .some((record) => record.workspaceRoot === workspaceRoot)
      ) {
        throw new Error("AGENTS checkpoint identity mismatch");
      }
      throw new Error("logical Worker is unavailable for AGENTS checkpoint");
    }
    const agents = worker.boundary.agents;
    if (agents.impact === "none" || !agents.target || !agents.managedOnly) {
      throw new Error("AGENTS checkpoint contract mismatch");
    }
    if (worker.state.kind !== "agents-checkpoint-pending") {
      throw new Error("AGENTS checkpoint is not pending");
    }
    if (
      Object.keys(attempt.snapshot as Record<string, unknown>).length !== 1 ||
      !Object.hasOwn(attempt.snapshot as object, agents.target)
    ) {
      throw new Error("AGENTS checkpoint target mismatch");
    }
    const request: AgentsCheckpointRequest = {
      stage: "abel-implement",
      taskId: worker.boundary.taskId,
      agentsImpact: agents.impact,
      agentsTarget: agents.target,
      agentsManagedOnly: true,
      stableCheckpoint: true,
      snapshot: attempt.snapshot,
      diff: attempt.diff,
    };
    const result = await applyAgentsCheckpoint(workspaceRoot, request, signal);
    if (result.ok) {
      const finalPhase = worker.state.finalPhase;
      worker.state = {
        kind: "completed",
        finalPhase,
      };
      const { ok: _ok, ...checkpoint } = result;
      return {
        kind: "completed",
        requestId: attempt.requestId,
        taskId: attempt.taskId,
        finalPhase,
        result: checkpoint,
      };
    }
    return this.presentCheckpointFailure(attempt, worker, result.failure);
  }

  private presentCheckpointFailure(
    attempt: AgentsCheckpointAttempt,
    worker: TaskRecord,
    failure: CandidateFailure,
  ): DispatchResult {
    if (worker.state.kind !== "agents-checkpoint-pending") {
      throw new Error("AGENTS checkpoint is not pending");
    }
    const phase = worker.state.finalPhase;
    const identity = {
      taskId: attempt.taskId,
      requestId: attempt.requestId,
      phase,
    };
    switch (failure.kind) {
      case "artifact": {
        if (worker.state.attemptIndex === 1) {
          const taskFailure: TaskFailure = {
            kind: "checkpoint-attempts-exhausted",
            cause: "artifact",
          };
          worker.state = {
            kind: "blocked",
            phase,
            failure: structuredClone(taskFailure),
          };
          return blockedOutcome(identity, taskFailure);
        }
        worker.state = {
          kind: "agents-checkpoint-pending",
          finalPhase: phase,
          attemptIndex: 1,
        };
        return retryOutcome(identity, "checkpoint", "artifact");
      }
      case "stale": {
        if (worker.state.attemptIndex === 1) {
          const taskFailure: TaskFailure = {
            kind: "checkpoint-attempts-exhausted",
            cause: "stale",
          };
          worker.state = {
            kind: "blocked",
            phase,
            failure: structuredClone(taskFailure),
          };
          return blockedOutcome(identity, taskFailure);
        }
        worker.state = {
          kind: "agents-checkpoint-pending",
          finalPhase: phase,
          attemptIndex: 1,
        };
        return retryOutcome(identity, "checkpoint", "stale");
      }
      case "environment": {
        const taskFailure: TaskFailure = failure;
        worker.state = {
          kind: "blocked",
          phase,
          failure: structuredClone(taskFailure),
        };
        return blockedOutcome(identity, taskFailure);
      }
      case "approval-boundary": {
        const taskFailure: TaskFailure = failure;
        worker.state = {
          kind: "blocked",
          phase,
          failure: structuredClone(taskFailure),
        };
        return blockedOutcome(identity, taskFailure);
      }
      case "cancelled":
        return cancelledOutcome(identity);
      case "result-limit": {
        const taskFailure: TaskFailure = failure;
        worker.state = {
          kind: "blocked",
          phase,
          failure: structuredClone(taskFailure),
        };
        return blockedOutcome(identity, taskFailure);
      }
      default:
        return assertNever(failure);
    }
  }

  private resolveRetainedCandidate(
    resultId: string,
    operationRoot?: string,
  ): { retained: BoundRetainedResult; worker: TaskRecord } | undefined {
    const candidate = this.results.get(resultId);
    if (!candidate) return undefined;
    if (!this.results.hasCandidateIdentity(resultId)) return undefined;
    if (
      candidate.stage !== "abel-implement" ||
      candidate.canonicalRoot === undefined ||
      candidate.changeId === undefined ||
      candidate.taskId === undefined ||
      candidate.originRequestId === undefined ||
      candidate.phase === undefined ||
      candidate.launchIndex === undefined
    ) {
      throw new Error("retained candidate identity mismatch");
    }
    if (
      operationRoot !== undefined &&
      canonicalWorkspaceRoot(operationRoot) !== candidate.canonicalRoot
    ) {
      throw new Error("retained candidate identity mismatch");
    }
    const worker = this.registry.get(
      taskRecordKey(
        candidate.canonicalRoot,
        candidate.changeId,
        candidate.taskId,
      ),
    );
    if (!worker) throw new Error("retained candidate identity mismatch");
    if (
      worker.state.kind !== "candidate-pending" ||
      worker.state.resultId !== resultId ||
      worker.state.originRequestId !== candidate.originRequestId ||
      worker.state.phase !== candidate.phase ||
      worker.state.launchIndex !== candidate.launchIndex
    ) {
      throw new Error("retained candidate identity mismatch");
    }
    const phase = worker.boundary.phases[worker.state.phase];
    if (!phase || !isSafeBound(candidate.snapshot)) {
      throw new Error("retained candidate identity mismatch");
    }
    const expected: RetainedCandidateFacts = {
      stage: "abel-implement",
      canonicalRoot: worker.workspaceRoot,
      root: worker.workspaceRoot,
      changeId: worker.boundary.changeId,
      taskId: worker.boundary.taskId,
      originRequestId: worker.state.originRequestId,
      phase: worker.state.phase,
      launchIndex: worker.state.launchIndex,
      writeSet: [...phase.write],
      approvedDependencies: [...worker.boundary.approvedDependencies],
      snapshot: candidate.snapshot,
    };
    return {
      retained: this.results.resolveIdentity(resultId, expected),
      worker,
    };
  }

  private discardRetainedCandidate(resultId: string): boolean {
    return this.results.discard(resultId);
  }

  private enqueueApply(
    root: string,
    operation: ImplementApplyOperation | { resultId: string },
    signal?: AbortSignal,
  ): Promise<DispatchResult> {
    const id = operation.resultId;
    const resolved = this.resolveRetainedCandidate(id, root);
    const requestId = "requestId" in operation ? operation.requestId : null;
    if (requestId !== null && !resolved) {
      throw new Error("retained Implement result not found");
    }
    if (resolved && requestId === null) {
      throw new Error("Implement apply operation identity is missing");
    }
    const applyRoot = resolved?.retained.root ?? root;
    const run = this.enqueueParentApply(() =>
      applyRetainedPatch({ root: applyRoot, id, store: this.results, signal }),
    );
    const seq = ++this.applySeq;
    return run.then((result) => {
      if (result.ok) {
        const applied = { ...result.result, sequence: seq };
        if (resolved) {
          if (requestId === null)
            throw new Error("Implement apply operation identity is missing");
          const { retained: identity, worker } = resolved;
          if (worker.state.kind === "candidate-pending") {
            const readyPhase = nextDeclaredPhase(
              worker.boundary,
              identity.phase,
            );
            if (readyPhase) {
              worker.state = {
                kind: "ready",
                phase: readyPhase,
                launchIndex: 0,
              };
              return {
                kind: "applied",
                requestId,
                taskId: identity.taskId,
                phase: identity.phase as "red" | "green",
                readyPhase,
                result: applied,
              } satisfies ImplementOutcome;
            } else if (worker.boundary.agents.impact === "none") {
              worker.state = {
                kind: "completed",
                finalPhase: identity.phase as "green" | "refactor",
              };
              return {
                kind: "completed",
                requestId,
                taskId: identity.taskId,
                finalPhase: identity.phase as "green" | "refactor",
                result: applied,
              } satisfies ImplementOutcome;
            } else {
              worker.state = {
                kind: "agents-checkpoint-pending",
                finalPhase: identity.phase as "green" | "refactor",
                attemptIndex: 0,
              };
              return {
                kind: "checkpoint-required",
                requestId,
                taskId: identity.taskId,
                finalPhase: identity.phase as "green" | "refactor",
                result: applied,
              } satisfies ImplementOutcome;
            }
          }
          throw new Error("retained candidate is not pending");
        }
        return {
          ok: true,
          action: "apply",
          result: applied,
        };
      }
      if (!resolved) {
        return {
          ok: false,
          error: "candidate application failed",
          failure: result.failure,
        };
      }
      if (requestId === null)
        throw new Error("Implement apply operation identity is missing");
      return this.presentApplyFailure(
        requestId,
        id,
        resolved.retained,
        resolved.worker,
        result.failure,
      );
    });
  }

  private enqueueDiscard(
    operation: ImplementDiscardOperation,
  ): Promise<DispatchResult> {
    return this.enqueueParentApply(async () => {
      const resolved = this.resolveRetainedCandidate(operation.resultId);
      if (!resolved || !this.results.discard(operation.resultId)) {
        throw new Error("retained Implement result not found");
      }
      const { retained: identity, worker } = resolved;
      const outcomeIdentity = {
        requestId: operation.requestId,
        taskId: identity.taskId,
        phase: identity.phase,
      };
      const rejection = operation.rejection;
      if (rejection.kind === "approval-boundary") {
        worker.state = {
          kind: "blocked",
          phase: identity.phase,
          failure: structuredClone(rejection),
        };
        return blockedOutcome(outcomeIdentity, rejection);
      }
      if (identity.launchIndex === 0) {
        worker.state = {
          kind: "ready",
          phase: identity.phase,
          launchIndex: 1,
          correction: structuredClone(rejection),
        };
        return retryOutcome(outcomeIdentity, "worker", "artifact");
      }
      const failure: TaskFailure = {
        kind: "attempts-exhausted",
        cause: "artifact",
      };
      worker.state = {
        kind: "blocked",
        phase: identity.phase,
        failure: structuredClone(failure),
      };
      return blockedOutcome(outcomeIdentity, failure);
    });
  }

  private enqueueParentApply<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.applyTail.then(operation, operation);
    this.applyTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private presentApplyFailure(
    requestId: string,
    resultId: string,
    identity: BoundRetainedResult,
    worker: TaskRecord,
    failure: CandidateFailure,
  ): DispatchResult {
    const outcomeIdentity = {
      taskId: identity.taskId,
      requestId,
      phase: identity.phase,
    };
    switch (failure.kind) {
      case "environment": {
        this.results.discard(resultId);
        worker.state = {
          kind: "blocked",
          phase: identity.phase,
          failure: structuredClone(failure),
        };
        return blockedOutcome(outcomeIdentity, failure);
      }
      case "approval-boundary": {
        this.results.discard(resultId);
        worker.state = {
          kind: "blocked",
          phase: identity.phase,
          failure: structuredClone(failure),
        };
        return blockedOutcome(outcomeIdentity, failure);
      }
      case "stale": {
        this.results.discard(resultId);
        if (identity.launchIndex === 0) {
          worker.state = {
            kind: "ready",
            phase: identity.phase,
            launchIndex: 1,
            correction: structuredClone(failure),
          };
        } else {
          const taskFailure: TaskFailure = {
            kind: "attempts-exhausted",
            cause: "stale",
          };
          worker.state = {
            kind: "blocked",
            phase: identity.phase,
            failure: structuredClone(taskFailure),
          };
          return blockedOutcome(outcomeIdentity, taskFailure);
        }
        return retryOutcome(outcomeIdentity, "worker", "stale");
      }
      case "artifact": {
        this.results.discard(resultId);
        const correctionAvailable = identity.launchIndex === 0;
        if (!correctionAvailable) {
          const taskFailure: TaskFailure = {
            kind: "attempts-exhausted",
            cause: "artifact",
          };
          worker.state = {
            kind: "blocked",
            phase: identity.phase,
            failure: structuredClone(taskFailure),
          };
          return blockedOutcome(outcomeIdentity, taskFailure);
        }
        worker.state = {
          kind: "ready",
          phase: identity.phase,
          launchIndex: 1,
          correction: structuredClone(failure),
        };
        return retryOutcome(outcomeIdentity, "worker", "artifact");
      }
      case "cancelled":
        return cancelledOutcome(outcomeIdentity);
      case "result-limit":
        this.results.discard(resultId);
        worker.state = {
          kind: "blocked",
          phase: identity.phase,
          failure: structuredClone(failure),
        };
        return blockedOutcome(outcomeIdentity, failure);
      default:
        return assertNever(failure);
    }
  }

  private async dispatchChild(
    agent: { role: string; content: string },
    envelope: RequestEnvelope,
    ctx: RunContext,
    signal: AbortSignal,
    artifactRejection?: string,
  ): Promise<ChildDispatchResult> {
    if (signal.aborted)
      return {
        ...cancellationError(signal),
        failureKind: "cancelled",
      };
    const task = this.taskRecords.get(envelope);
    const endpoint = task
      ? task.subagentEndpoint === null
        ? ({ kind: "inherited" } as const)
        : ({ kind: "custom", endpoint: task.subagentEndpoint } as const)
      : resolveSubagentEndpoint(envelope.role, { cwd: ctx.cwd });
    if (endpoint.kind === "invalid") {
      const message = describeInvalidSubagentEndpoint(endpoint);
      return {
        ok: false,
        error: message,
        failure: {
          kind: "environment",
          code: "invalid-subagent-endpoint",
          message,
        },
        failureKind: "failed",
        failureClass: "environment",
      };
    }
    const phase =
      endpoint.kind === "custom"
        ? await customPhaseRuntime(endpoint.endpoint, signal)
        : await runtimeFromContext(ctx, this.parentPayloadBridge, signal);
    if (!phase.ok) {
      return {
        ok: false,
        error: phase.error,
        failure: phase.failure,
        failureKind:
          phase.failure.kind === "cancelled" ? "cancelled" : "failed",
        ...(phase.failure.kind === "cancelled"
          ? {}
          : { failureClass: phase.failure.kind }),
      };
    }
    if (signal.aborted)
      return {
        ...cancellationError(signal),
        failureKind: "cancelled",
      };
    const roots = envelope.roots.map(
      (root) => new URL(root, `file://${ctx.cwd}/`).pathname,
    );
    const phaseContract = {
      taskId: envelope.taskId ?? envelope.id,
      requestId: envelope.id,
      phase: envelope.phase,
      readSet: [...envelope.declared.read],
      writeSet: [...envelope.declared.write],
      verification: envelope.verification ?? null,
      agentsImpact: envelope.agentsImpact ?? "none",
      agentsTarget: envelope.agentsTarget ?? null,
      agentsManagedOnly: true,
      agentsWriteAllowed: false,
      impactClosure: envelope.impactClosure ?? null,
    };
    const systemPrompt = [
      agent.content,
      envelope.objective,
      envelope.context.agents,
      envelope.context.contract,
      `<phase-contract>${JSON.stringify(phaseContract)}</phase-contract>`,
      ...(artifactRejection
        ? [`<artifact-rejection>${artifactRejection}</artifact-rejection>`]
        : []),
    ].join("\n\n");
    const child = await runChildSession({
      cwd: ctx.cwd,
      modelRuntime: phase.modelRuntime,
      model: phase.model,
      systemPrompt,
      requestId: envelope.id,
      taskId: envelope.taskId,
      role: envelope.role,
      phase: envelope.phase,
      output: envelope.output as "evidence" | "diff",
      roots,
      allowedPaths: [
        ...new Set([...envelope.declared.read, ...envelope.declared.write]),
      ],
      timeoutMs: LIMITS.phaseTimeoutMs,
      signal,
    });
    if (signal.aborted)
      return {
        ...cancellationError(signal),
        failureKind: "cancelled",
        usage: child.usage,
      };
    if (!child.ok) {
      return {
        ...child,
        failureKind: child.failureKind,
        failureClass: failureClassOf(child.failure),
      };
    }
    if (envelope.output === "evidence") {
      return {
        ok: true,
        action: "run",
        result: child.result,
        usage: child.usage,
      };
    }
    const diff = child.result as DiffResult;
    const requestSnapshot = isSafeBound(envelope.snapshot)
      ? envelope.snapshot
      : {};
    let prepared: PreparedPreflight | null;
    try {
      prepared = preparePreflight(ctx.cwd, envelope, requestSnapshot);
    } catch (error) {
      if (!isFileSystemFailure(error)) throw error;
      return {
        ok: false,
        error: "candidate preflight inputs are unavailable",
        failure: { kind: "environment", code: "root-unavailable" },
        failureKind: "failed",
        failureClass: "environment",
        launchConsumed: true,
        usage: child.usage,
      };
    }
    if (envelope.verification && !prepared) {
      return {
        ok: false,
        error: "candidate preflight inputs are unavailable",
        failure: { kind: "environment", code: "root-unavailable" },
        failureKind: "failed",
        failureClass: "environment",
        launchConsumed: true,
        usage: child.usage,
      };
    }
    const retainedRoot = task?.workspaceRoot ?? ctx.cwd;
    const retainedSnapshot =
      prepared?.snapshot ??
      (isSafeBound(envelope.snapshot)
        ? mergeBounds(
            snapshotFiles(retainedRoot, envelope.declared.write),
            envelope.snapshot,
          )
        : undefined);
    const resultId = this.results.retain({
      diff: diff.diff,
      writeSet: envelope.declared.write,
      approvedDependencies: envelope.approvedDependencies ?? [],
      root: retainedRoot,
      ...(task
        ? {
            stage: "abel-implement" as const,
            canonicalRoot: task.workspaceRoot,
            changeId: task.boundary.changeId,
            taskId: task.boundary.taskId,
            originRequestId: envelope.id,
            phase: taskPhase(task),
            launchIndex: taskLaunchIndex(task),
          }
        : {}),
      ...(prepared
        ? {
            baseline: prepared.baseline,
            verification: envelope.verification,
            packageManifest: prepared.packageManifest,
            lockfile: prepared.lockfile,
            dependencyTarget: prepared.dependencyTarget,
          }
        : {}),
      ...(retainedSnapshot ? { snapshot: retainedSnapshot } : {}),
    });
    return {
      ok: true,
      action: "run",
      result: diff,
      resultId,
      usage: child.usage,
    };
  }

  private async run(
    request: unknown,
    ctx?: RunContext,
    signal?: AbortSignal,
    observer?: RuntimeActivityObserver,
  ): Promise<DispatchResult> {
    const implementRequest = targetsImplement(request);
    if (!ctx) {
      if (implementRequest) throw new Error("run requires extension context");
      return { ok: false, error: "run requires extension context" };
    }
    const validation = validateRequestEnvelope(request);
    if (!validation.ok) {
      if (implementRequest) {
        throw new Error(`Implement protocol error: ${validation.reason}`);
      }
      return { ok: false, error: validation.reason };
    }

    let envelope: RequestEnvelope;
    if (isImplementRunRequest(validation.value)) {
      const runRequest = validation.value;
      const attempt = runRequest.attempt;
      const workspaceRoot = canonicalWorkspaceRoot(ctx.cwd);
      if (
        runRequest.kind === "open-task" &&
        workspaceRoot &&
        this.registry.has(
          taskRecordKey(workspaceRoot, attempt.changeId, attempt.taskId),
        )
      ) {
        throw new Error("duplicate task open protocol error");
      }
      if (runRequest.kind === "open-task" && signal?.aborted) {
        return cancelledOutcome({
          taskId: attempt.taskId,
          requestId: attempt.requestId,
          phase: attempt.phase,
        });
      }
      if (!workspaceRoot) {
        throw new Error("implementation workspace is unavailable");
      }
      const key = taskRecordKey(
        workspaceRoot,
        attempt.changeId,
        attempt.taskId,
      );
      if (
        runRequest.kind === "open-task" &&
        this.registry
          .values()
          .some(
            (record) =>
              record.workspaceRoot === workspaceRoot &&
              record.state.kind !== "blocked" &&
              record.state.kind !== "completed" &&
              declarationsConflict(
                taskConflictOf(runRequest.boundary),
                record.conflict,
              ),
          )
      ) {
        return {
          kind: "deferred",
          taskId: attempt.taskId,
          requestId: attempt.requestId,
          reason: "task-conflict",
        };
      }
      if (!ctx.model) {
        throw new Error("implementation model is unavailable");
      }
      const identity = workerIdentity(ctx.model);
      let record: TaskRecord;
      if (runRequest.kind === "open-task") {
        const endpoint = resolveSubagentEndpoint("implementation-worker", {
          cwd: ctx.cwd,
        });
        if (endpoint.kind === "invalid") {
          const failure = {
            kind: "environment",
            code: "invalid-subagent-endpoint",
            message: describeInvalidSubagentEndpoint(endpoint),
          } as const;
          record = this.registry.open(
            runRequest.boundary,
            identity,
            workspaceRoot,
            attempt,
          );
          record.state = {
            kind: "blocked",
            phase: attempt.phase,
            failure,
          };
          return blockedOutcome(
            {
              taskId: attempt.taskId,
              requestId: attempt.requestId,
              phase: attempt.phase,
            },
            failure,
          );
        }
        const subagentEndpoint: Readonly<SubagentEndpoint> | null =
          endpoint.kind === "custom" ? endpoint.endpoint : null;
        record = this.registry.open(
          runRequest.boundary,
          identity,
          workspaceRoot,
          attempt,
          subagentEndpoint,
        );
      } else {
        const existing = this.registry.get(key);
        if (!existing) {
          throw new Error("task identity mismatch or task is not open");
        }
        if (existing.workerIdentity !== identity) {
          throw new Error("provider/model identity mismatch");
        }
        const attemptReason = validatePhaseAttemptAgainstBoundary(
          existing.boundary,
          attempt,
        );
        if (attemptReason !== null) throw new Error(attemptReason);
        assertAttemptAllowed(existing, attempt);
        record = existing;
      }
      if (record.state.kind === "blocked") {
        return blockedOutcome(
          {
            taskId: record.boundary.taskId,
            requestId: attempt.requestId,
            phase: record.state.phase,
          },
          record.state.failure,
        );
      }
      if (record.state.kind === "completed") {
        return {
          kind: "completed",
          taskId: record.boundary.taskId,
          requestId: attempt.requestId,
          finalPhase: record.state.finalPhase,
        };
      }
      if (signal?.aborted) {
        return cancelledOutcome({
          taskId: record.boundary.taskId,
          requestId: attempt.requestId,
          phase: taskPhase(record),
        });
      }
      envelope = deriveImplementEnvelope(record, attempt);
      this.taskRecords.set(envelope, record);
    } else {
      if (signal?.aborted) return cancellationError(signal);
      envelope = cloneLegacyEnvelope(validation.value);
    }
    const context: StoredRunContext = {
      ctx,
      observer,
      sequence: ++this.batchSeq,
      runningEmitted: false,
      terminalEmitted: false,
      usage: new UsageAggregator(),
    };
    this.runContexts.set(envelope, context);
    this.notify(envelope, context, "queued");
    const batchId = `runtime-${context.sequence}`;
    const batch = this.scheduler.schedule(batchId, [
      { request: envelope, prerequisites: [] },
    ]);
    const cancelBatch = () =>
      this.scheduler.cancel(
        batchId,
        signal?.reason ?? new Error("tool call cancelled"),
      );
    if (signal?.aborted) cancelBatch();
    else signal?.addEventListener("abort", cancelBatch, { once: true });
    try {
      const outcome = await batch.result(envelope.id);
      if (outcome.status === "succeeded" && outcome.value) {
        const internalResult = outcome.value.dispatch;
        const {
          failureKind,
          failureClass: _failureClass,
          launchConsumed: _launchConsumed,
          ...publicResult
        } = internalResult;
        const dispatch = publicResult as DispatchResult;
        if (isWrappedDispatchResult(dispatch)) {
          if (!dispatch.ok) {
            const state: RuntimeActivityState = failureKind ?? "failed";
            this.notify(envelope, context, state);
            return dispatch;
          }
          this.notify(envelope, context, "completed");
          return dispatch;
        }
        this.notify(
          envelope,
          context,
          dispatch.kind === "cancelled" ? "cancelled" : "completed",
        );
        return dispatch;
      }
      const state: RuntimeActivityState =
        outcome.status === "cancelled" ? "cancelled" : "failed";
      const task = this.taskRecords.get(envelope);
      if (task) {
        this.notify(envelope, context, state);
        if (outcome.status === "cancelled") {
          return {
            ...cancelledOutcome({
              taskId: task.boundary.taskId,
              requestId: envelope.id,
              phase: taskPhase(task),
            }),
            ...this.usageMetadata(context),
          };
        }
        throw new Error(outcome.error ?? `scheduled run ${outcome.status}`);
      }
      const terminal = {
        ok: false as const,
        error: outcome.error ?? `scheduled run ${outcome.status}`,
        ...this.usageMetadata(context),
      };
      this.notify(envelope, context, state);
      return terminal;
    } finally {
      signal?.removeEventListener("abort", cancelBatch);
      this.runContexts.delete(envelope);
    }
  }

  private notify(
    envelope: RequestEnvelope,
    context: StoredRunContext,
    state: RuntimeActivityState,
  ): void {
    if (!context.observer || context.terminalEmitted) return;
    if (state === "running") {
      if (context.runningEmitted) return;
      context.runningEmitted = true;
    }
    if (
      state === "completed" ||
      state === "failed" ||
      state === "cancelled" ||
      state === "timed-out"
    ) {
      context.terminalEmitted = true;
    }
    const event: RuntimeActivityEvent = {
      state,
      requestId: envelope.id,
      role: envelope.role,
      phase: envelope.phase,
      objective: envelope.objective,
      sequence: context.sequence,
      ...(state === "cancelled"
        ? { failureReason: "subagent cancelled" as const }
        : state === "timed-out"
          ? { failureReason: "phase timed out" as const }
          : state === "failed"
            ? { failureReason: "subagent failed" as const }
            : {}),
    };
    try {
      const result = context.observer(event);
      if (result instanceof Promise) void result.catch(() => undefined);
    } catch {
      // Presentation observers cannot affect orchestration.
    }
  }

  private async runScheduled(
    envelope: RequestEnvelope,
    context: StoredRunContext,
    signal: AbortSignal,
  ): Promise<InternalDispatchResult> {
    const ctx = context.ctx;
    const task = this.taskRecords.get(envelope);
    if (!task && envelope.stage === "abel-implement") {
      throw new Error("implementation TaskRecord is unavailable");
    }
    if (signal.aborted) {
      if (task) {
        return cancelledOutcome({
          taskId: task.boundary.taskId,
          requestId: envelope.id,
          phase: taskPhase(task),
        });
      }
      return { ...cancellationError(signal), failureKind: "cancelled" };
    }
    const agent = loadAgentDefinitions().find(
      (item) => item.role === envelope.role,
    );
    if (!agent) {
      if (task) throw new Error("implementation agent definition is missing");
      return {
        ok: false,
        error: "agent definition is unavailable",
        failure: { kind: "environment", code: "root-unavailable" },
        failureKind: "failed",
        failureClass: "environment",
      };
    }
    if (!ctx.model) {
      if (task) throw new Error("implementation model is unavailable");
      return {
        ok: false,
        error: "phase runtime is unavailable",
        failure: {
          kind: "environment",
          code: "sandbox-runtime-unavailable",
        },
        failureKind: "failed",
        failureClass: "environment",
      };
    }
    if (!task) {
      const result = await this.dispatchChild(agent, envelope, ctx, signal);
      this.captureUsage(context, "launch:0", result.usage);
      return this.withUsage(context, result);
    }
    if (task.workerIdentity !== workerIdentity(ctx.model)) {
      throw new Error("provider/model identity mismatch");
    }
    if (task.state.kind !== "ready") {
      throw new Error("implementation task is not launchable");
    }
    const phase = task.state.phase;
    const launchIndex = task.state.launchIndex;
    const correction = task.state.correction;
    const artifactRejection =
      correction?.kind === "artifact"
        ? artifactCorrectionEvidence(correction)
        : undefined;
    const identity: OutcomeIdentity = {
      taskId: task.boundary.taskId,
      requestId: envelope.id,
      phase,
    };
    const block = (failure: TaskFailure): InternalDispatchResult => {
      task.state = {
        kind: "blocked",
        phase,
        failure: structuredClone(failure),
      };
      return blockedOutcome(identity, failure);
    };
    const candidate = (
      result: Extract<ChildDispatchResult, { ok: true }>,
    ): InternalDispatchResult => {
      if (typeof result.resultId !== "string" || result.result === undefined) {
        throw new Error("implementation candidate result is incomplete");
      }
      return {
        kind: "candidate",
        ...identity,
        resultId: result.resultId,
        result: result.result as DiffResult,
      };
    };
    const finish = (result: InternalDispatchResult) =>
      this.withUsage(context, result);

    const first = await this.dispatchChild(
      agent,
      envelope,
      ctx,
      signal,
      artifactRejection,
    );
    this.captureUsage(context, "launch:0", first.usage);
    if (signal.aborted) {
      if (first.ok && typeof first.resultId === "string") {
        this.results.discard(first.resultId);
      }
      return finish(cancelledOutcome(identity));
    }
    if (first.ok) {
      return finish(candidate(first));
    }
    const firstFailure = childFailureOf(first);
    if (firstFailure.kind === "cancelled") {
      return finish(cancelledOutcome(identity));
    }
    const firstTerminal = terminalTaskFailure(firstFailure);
    if (firstTerminal) return finish(block(firstTerminal));
    if (launchIndex === 1) {
      return finish(
        block({
          kind: "attempts-exhausted",
          cause: attemptFailureCause(firstFailure),
        }),
      );
    }
    if (firstFailure.kind === "artifact" || firstFailure.kind === "stale") {
      task.state = {
        kind: "ready",
        phase,
        launchIndex: 1,
        correction: structuredClone(firstFailure),
      };
      return finish(retryOutcome(identity, "worker", firstFailure.kind));
    }

    task.state = {
      kind: "ready",
      phase,
      launchIndex: 1,
    };
    const second = await this.dispatchChild(agent, envelope, ctx, signal);
    this.captureUsage(context, "launch:1", second.usage);
    if (signal.aborted) {
      if (second.ok && typeof second.resultId === "string") {
        this.results.discard(second.resultId);
      }
      return finish(cancelledOutcome(identity));
    }
    if (second.ok) {
      return finish(candidate(second));
    }
    const secondFailure = childFailureOf(second);
    if (secondFailure.kind === "cancelled") {
      return finish(cancelledOutcome(identity));
    }
    const secondTerminal = terminalTaskFailure(secondFailure);
    if (secondTerminal) return finish(block(secondTerminal));
    return finish(
      block({
        kind: "attempts-exhausted",
        cause: attemptFailureCause(secondFailure),
      }),
    );
  }

  private captureUsage(
    context: StoredRunContext,
    id: string,
    usage: Usage | undefined,
  ): void {
    if (usage) context.usage.add(id, usage);
  }

  private usageMetadata(context: StoredRunContext): { usage?: Usage } {
    return context.usage.hasUsage() ? { usage: context.usage.total() } : {};
  }

  private withUsage<T extends InternalDispatchResult>(
    context: StoredRunContext,
    result: T,
  ): T {
    return {
      ...result,
      ...this.usageMetadata(context),
    };
  }

  private rememberRetainedResult(
    result: Extract<ImplementOutcome, { kind: "candidate" }>,
    envelope: RequestEnvelope,
    task: TaskRecord,
  ): void {
    if (task.state.kind !== "ready") {
      throw new Error("retained candidate identity mismatch");
    }
    const phaseState = task.state;
    if (
      result.requestId !== envelope.id ||
      result.taskId !== task.boundary.taskId ||
      result.phase !== phaseState.phase
    ) {
      throw new Error("retained candidate identity mismatch");
    }
    const phase = task.boundary.phases[phaseState.phase];
    if (!phase || !isSafeBound(envelope.snapshot)) {
      throw new Error("retained candidate identity mismatch");
    }
    const identity: RetainedCandidateIdentity = {
      stage: "abel-implement",
      canonicalRoot: task.workspaceRoot,
      root: task.workspaceRoot,
      changeId: task.boundary.changeId,
      taskId: task.boundary.taskId,
      originRequestId: envelope.id,
      phase: phaseState.phase,
      launchIndex: phaseState.launchIndex,
    };
    if (!this.results.get(result.resultId)) {
      throw new Error("retained candidate is unavailable");
    }
    this.results.bindIdentity(result.resultId, identity);
    this.results.resolveIdentity(result.resultId, {
      ...identity,
      writeSet: [...phase.write],
      approvedDependencies: [...task.boundary.approvedDependencies],
      snapshot: envelope.snapshot,
    });
    task.state = {
      kind: "candidate-pending",
      phase: phaseState.phase,
      launchIndex: phaseState.launchIndex,
      originRequestId: envelope.id,
      resultId: result.resultId,
    };
  }

  validateRequest(
    envelope: unknown,
  ): { ok: true; value: RunRequest } | { ok: false; reason: string } {
    return validateRequestEnvelope(envelope);
  }

  async drain(): Promise<void> {
    this.activation.drain();
    const scheduled = this.scheduler.cancelAll();
    const applied = this.applyTail;
    await Promise.all([scheduled, applied]);
    this.parentPayloadBridge?.clear();
    drainStage({
      results: this.results,
      registry: this.registry,
      activation: this.activation,
    });
  }

  get state(): ActivationState {
    return this.activation.state;
  }
}
