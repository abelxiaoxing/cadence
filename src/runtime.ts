import { lstatSync, readdirSync } from "node:fs";
import path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Activation, type ActivationState } from "./activation.ts";
import { loadAgentDefinitions } from "./agent-registry.ts";
import type { BaselineEntry } from "./candidate-preflight.ts";
import { runChildSession } from "./child-session.ts";
import {
  ACTIONS,
  type DiffResult,
  LIMITS,
  type RecoveryCode,
  type RecoveryNext,
  type RecoveryRecord,
  type RequestEnvelope,
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
import { runtimeFromContext } from "./parent-provider.ts";
import { applyRetainedPatch } from "./patch.ts";
import { ResultStore } from "./result-store.ts";
import { Scheduler } from "./scheduler.ts";
import {
  contractOf,
  type LogicalWorker,
  sameContract,
  samePhaseContract,
  WorkerRegistry,
  workerIdentity,
} from "./worker.ts";

const SHA256_HEX = /^[0-9a-f]{64}$/;

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

function cancellationError(signal: AbortSignal): { ok: false; error: string } {
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

type InternalDispatchResult = DispatchResult & {
  failureKind?: RunFailureKind;
  failureClass?: FailureClass;
  launchConsumed?: true;
};

interface RecoveryIdentity {
  taskId?: string;
  id: string;
  phase: string;
}

function recoveryFailure(
  identity: RecoveryIdentity,
  code: RecoveryCode,
  next: RecoveryNext,
  launchIndex: 0 | 1,
  failureKind: RunFailureKind = "failed",
  detail = "branch recovery is required",
): InternalDispatchResult {
  const recovery: RecoveryRecord = {
    code,
    taskId: identity.taskId ?? identity.id,
    requestId: identity.id,
    phase: identity.phase,
    launchIndex,
    branchBlocked: true,
    dependentsBlocked: true,
    partialResultUsable: false,
    independentResultsPreserved: true,
    next,
  };
  return {
    ok: false,
    error: `${code}: ${detail}`,
    recovery,
    failureKind,
  };
}

function normalizedArtifactRejection(error: string): string {
  const preflight = /candidate preflight rejected: artifact:([a-z0-9-]+)/i.exec(
    error,
  );
  return preflight
    ? `candidate-preflight:${preflight[1].toLowerCase()}`
    : "generated-artifact-rejection";
}

interface RetainedRunIdentity {
  taskId: string;
  requestId: string;
  phase: string;
  launchIndex: 0 | 1;
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
  dispatch: DispatchResult;
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

export type DispatchResult =
  | {
      ok: true;
      action: string;
      result?: unknown;
      resultId?: string;
      usage?: unknown;
    }
  | {
      ok: false;
      notReady?: true;
      error: string;
      recovery?: RecoveryRecord;
    };

export interface ApplyResult {
  targets: string[];
  checkExitCode: 0;
  applyExitCode: 0;
  sequence?: number;
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
  private readonly retainedRuns = new Map<string, RetainedRunIdentity>();
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
        this.notify(request, context, "running");
        const result = await this.runScheduled(request, context.ctx, signal);
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
    params: { request?: unknown; resultId?: string },
    ctx?: RunContext,
    signal?: AbortSignal,
    observer?: RuntimeActivityObserver,
  ): Promise<DispatchResult> {
    if (!(ACTIONS as readonly string[]).includes(action)) {
      return { ok: false, error: `unknown action: ${String(action)}` };
    }
    if (!this.activation.isActive()) {
      return { ok: false, notReady: true, error: "dispatcher is not active" };
    }
    if (action === "run")
      return this.run(params.request, ctx, signal, observer);
    if (action === "apply") {
      if (!ctx || !params.resultId)
        return { ok: false, error: "apply requires context and resultId" };
      return this.enqueueApply(ctx.cwd, params.resultId, signal);
    }
    if (action === "discard") {
      if (!params.resultId)
        return { ok: false, error: "discard requires resultId" };
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

  private discardRetainedCandidate(resultId: string): boolean {
    const identity = this.retainedRuns.get(resultId);
    if (!this.results.discard(resultId)) return false;
    this.retainedRuns.delete(resultId);
    if (!identity) return true;
    const worker = this.registry.get(identity.taskId);
    if (
      worker?.currentPhase.requestId !== identity.requestId ||
      worker.currentPhase.phase !== identity.phase
    ) {
      return true;
    }
    if (identity.launchIndex === 0) {
      worker.currentPhase.correctionIndex = 1;
      worker.state = { kind: "ready" };
    } else {
      worker.state = { kind: "blocked", reason: "mechanical" };
    }
    return true;
  }

  private enqueueApply(
    root: string,
    id: string,
    signal?: AbortSignal,
  ): Promise<DispatchResult> {
    const retainedIdentity = this.retainedRuns.get(id);
    const run = this.applyTail.then(
      () => applyRetainedPatch({ root, id, store: this.results, signal }),
      () => applyRetainedPatch({ root, id, store: this.results, signal }),
    );
    this.applyTail = run.then(
      () => undefined,
      () => undefined,
    );
    const seq = ++this.applySeq;
    return run.then(
      (result) => {
        if (result.ok) {
          this.retainedRuns.delete(id);
          if (retainedIdentity) {
            const worker = this.registry.get(retainedIdentity.taskId);
            if (
              worker?.currentPhase.requestId === retainedIdentity.requestId &&
              worker.currentPhase.phase === retainedIdentity.phase
            ) {
              worker.state = { kind: "phase-applied" };
            }
          }
          return {
            ok: true,
            action: "apply",
            result: { ...result, sequence: seq },
          };
        }
        return this.presentApplyFailure(
          id,
          retainedIdentity,
          result.error,
          signal,
        );
      },
      (error) =>
        this.presentApplyFailure(
          id,
          retainedIdentity,
          (error as Error).message,
          signal,
        ),
    );
  }

  private presentApplyFailure(
    resultId: string,
    identity: RetainedRunIdentity | undefined,
    error: string,
    signal?: AbortSignal,
  ): DispatchResult {
    if (signal?.aborted) return cancellationError(signal);
    if (!identity) return { ok: false, error };
    if (/cancelled/i.test(error)) {
      return { ok: false, error: "candidate application cancelled" };
    }
    if (/candidate preflight rejected: environment:/i.test(error)) {
      return recoveryFailure(
        {
          taskId: identity.taskId,
          id: identity.requestId,
          phase: identity.phase,
        },
        "environment-blocked",
        "repair-environment",
        identity.launchIndex,
      );
    }
    const worker = this.registry.get(identity.taskId);
    if (/candidate preflight rejected: design:/i.test(error)) {
      this.results.discard(resultId);
      this.retainedRuns.delete(resultId);
      if (worker) {
        worker.state = { kind: "ready" };
      }
      return recoveryFailure(
        {
          taskId: identity.taskId,
          id: identity.requestId,
          phase: identity.phase,
        },
        "design-required",
        "return-to-design",
        identity.launchIndex,
        "failed",
        "approved Red verification contract is invalid",
      );
    }
    if (
      /^(?:candidate preflight rejected: stale:|stale file snapshot)/i.test(
        error,
      )
    ) {
      this.results.discard(resultId);
      this.retainedRuns.delete(resultId);
      if (worker) {
        if (identity.launchIndex === 0) {
          worker.state = { kind: "stale-redispatch-pending" };
        } else {
          worker.state = { kind: "blocked", reason: "mechanical" };
        }
      }
      if (identity.launchIndex === 1) {
        return recoveryFailure(
          {
            taskId: identity.taskId,
            id: identity.requestId,
            phase: identity.phase,
          },
          "mechanical-redispatch-exhausted",
          "finish-unaffected",
          1,
          "failed",
          "phase launch budget is exhausted",
        );
      }
      return { ok: false, error };
    }
    if (/^retained result (?:not found|root mismatch)/i.test(error)) {
      return { ok: false, error };
    }

    this.results.discard(resultId);
    this.retainedRuns.delete(resultId);
    const correctionAvailable = identity.launchIndex === 0;
    if (worker) {
      worker.currentPhase.correctionIndex = identity.launchIndex;
      worker.state = correctionAvailable
        ? {
            kind: "artifact-correction-pending",
            rejection: normalizedArtifactRejection(error),
          }
        : { kind: "blocked", reason: "artifact" };
    }
    return recoveryFailure(
      {
        taskId: identity.taskId,
        id: identity.requestId,
        phase: identity.phase,
      },
      "implementation-artifact-delivery-blocked",
      correctionAvailable ? "correct-artifact" : "finish-unaffected",
      identity.launchIndex,
      "failed",
      correctionAvailable
        ? "generated implementation artifact requires bounded correction"
        : "artifact correction launch budget is exhausted",
    );
  }

  private async dispatchChild(
    agent: { role: string; content: string },
    envelope: RequestEnvelope,
    ctx: RunContext,
    signal: AbortSignal,
    artifactRejection?: string,
  ): Promise<InternalDispatchResult> {
    if (signal.aborted)
      return {
        ...cancellationError(signal),
        failureKind: "cancelled",
      };
    let phase: Awaited<ReturnType<typeof runtimeFromContext>>;
    try {
      phase = await runtimeFromContext(ctx, this.parentPayloadBridge, signal);
    } catch (error) {
      const bridgeUnavailable =
        error instanceof Error &&
        error.message === "parent payload bridge is unavailable";
      return {
        ok: false,
        error: signal.aborted
          ? cancellationError(signal).error
          : (error as Error).message,
        failureKind: signal.aborted ? "cancelled" : "failed",
        failureClass: signal.aborted
          ? undefined
          : bridgeUnavailable
            ? "transport"
            : "environment",
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
      };
    if (!child.ok) {
      const generatedArtifact =
        child.classification.attempts > 0 ||
        child.classification.finalCategory === "text-only" ||
        child.classification.finalCategory === "mixed" ||
        child.classification.finalCategory === "multiple-submit";
      return {
        ...child,
        failureKind: child.failureKind,
        failureClass:
          child.failureKind === "timed-out" || child.transportFailure
            ? "transport"
            : generatedArtifact
              ? "artifact"
              : "transport",
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
    } catch {
      return {
        ok: false,
        error: "candidate preflight inputs are unavailable",
        failureKind: "failed",
        failureClass: "environment",
        launchConsumed: true,
      };
    }
    if (envelope.verification && !prepared) {
      return {
        ok: false,
        error: "candidate preflight inputs are unavailable",
        failureKind: "failed",
        failureClass: "environment",
        launchConsumed: true,
      };
    }
    const resultId = this.results.retain({
      diff: diff.diff,
      writeSet: envelope.declared.write,
      root: ctx.cwd,
      ...(prepared
        ? {
            snapshot: prepared.snapshot,
            baseline: prepared.baseline,
            verification: envelope.verification,
            packageManifest: prepared.packageManifest,
            lockfile: prepared.lockfile,
            dependencyTarget: prepared.dependencyTarget,
          }
        : {}),
    });
    if (!prepared && isSafeBound(envelope.snapshot)) {
      const retained = this.results.get(resultId);
      if (retained) {
        retained.snapshot = mergeBounds(retained.snapshot, envelope.snapshot);
      }
    }
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
    if (!ctx) return { ok: false, error: "run requires extension context" };
    if (signal?.aborted) return cancellationError(signal);
    const validation = validateRequestEnvelope(request);
    if (!validation.ok) return { ok: false, error: validation.reason };
    const envelope: RequestEnvelope = {
      ...validation.value,
      taskId: validation.value.taskId ?? validation.value.id,
      roots: [...validation.value.roots],
      context: { ...validation.value.context },
      declared: {
        ...validation.value.declared,
        read: [...validation.value.declared.read],
        write: [...validation.value.declared.write],
        conflicts: [...validation.value.declared.conflicts],
        resources: [...validation.value.declared.resources],
      },
      ...(validation.value.verification === undefined
        ? {}
        : {
            verification: {
              ...validation.value.verification,
              argv: [...validation.value.verification.argv],
            },
          }),
    };
    const context: StoredRunContext = {
      ctx,
      observer,
      sequence: ++this.batchSeq,
      runningEmitted: false,
      terminalEmitted: false,
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
        const internalResult = outcome.value.dispatch as DispatchResult & {
          failureKind?: RunFailureKind;
          failureClass?: FailureClass;
        };
        const {
          failureKind,
          failureClass: _failureClass,
          ...publicResult
        } = internalResult;
        if (publicResult.ok) {
          this.notify(envelope, context, "completed");
          return publicResult;
        }
        const state: RuntimeActivityState = failureKind ?? "failed";
        this.notify(envelope, context, state);
        return publicResult;
      }
      const state: RuntimeActivityState =
        outcome.status === "cancelled" ? "cancelled" : "failed";
      const terminal = {
        ok: false as const,
        error: outcome.error ?? `scheduled run ${outcome.status}`,
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
    ctx: RunContext,
    signal: AbortSignal,
  ): Promise<InternalDispatchResult> {
    if (signal.aborted)
      return {
        ...cancellationError(signal),
        failureKind: "cancelled",
      };
    const taskId = envelope.taskId ?? envelope.id;
    const agent = loadAgentDefinitions().find(
      (item) => item.role === envelope.role,
    );
    if (!agent)
      return {
        ...recoveryFailure(
          envelope,
          "environment-blocked",
          "repair-environment",
          0,
        ),
      };
    if (!ctx.model)
      return recoveryFailure(
        envelope,
        "environment-blocked",
        "repair-environment",
        0,
        "failed",
        "phase runtime is unavailable",
      );
    const identity = workerIdentity(ctx.model);
    const contract = contractOf(envelope);
    const existing = this.registry.get(taskId);
    if (existing) {
      if (existing.identity !== identity) {
        return recoveryFailure(
          envelope,
          "environment-blocked",
          "repair-environment",
          existing.currentPhase.correctionIndex,
          "failed",
          "pinned provider/model identity differs",
        );
      }
      if (!sameContract(existing.taskContract, contract)) {
        return recoveryFailure(
          envelope,
          "design-required",
          "return-to-design",
          existing.currentPhase.correctionIndex,
          "failed",
          "immutable task contract changed",
        );
      }
      if (
        existing.state.kind === "blocked" &&
        existing.state.reason === "artifact"
      ) {
        return recoveryFailure(
          envelope,
          "implementation-artifact-delivery-blocked",
          "finish-unaffected",
          1,
          "failed",
          "artifact correction launch budget is exhausted",
        );
      }
      if (
        existing.state.kind === "blocked" &&
        existing.state.reason === "mechanical"
      ) {
        return recoveryFailure(
          envelope,
          "mechanical-redispatch-exhausted",
          "finish-unaffected",
          1,
          "failed",
          "phase launch budget is exhausted",
        );
      }
    } else {
      this.registry.pin(contract, identity);
    }
    let pinned = this.registry.get(taskId);
    if (!pinned) {
      return recoveryFailure(
        envelope,
        "environment-blocked",
        "repair-environment",
        0,
        "failed",
        "logical Worker could not be pinned",
      );
    }

    const correctingArtifact =
      pinned.state.kind === "artifact-correction-pending";
    const redispatchingStale = pinned.state.kind === "stale-redispatch-pending";
    let artifactRejection: string | undefined;
    const changedPhase =
      pinned.currentPhase.requestId !== envelope.id ||
      pinned.currentPhase.phase !== envelope.phase;
    if (pinned.state.kind === "candidate-pending") {
      return {
        ok: false,
        error: "current phase candidate is awaiting parent apply",
        failureKind: "failed",
      };
    }
    if (redispatchingStale) {
      if (
        envelope.id !== pinned.currentPhase.requestId ||
        !samePhaseContract(pinned.currentPhase, contract.currentPhase)
      ) {
        return recoveryFailure(
          envelope,
          "design-required",
          "return-to-design",
          pinned.currentPhase.correctionIndex,
          "failed",
          "stale redispatch changed the current phase contract",
        );
      }
      pinned = this.registry.setCurrentPhase(taskId, contract, 1) ?? pinned;
    } else if (correctingArtifact) {
      if (
        envelope.id === pinned.currentPhase.requestId ||
        !samePhaseContract(pinned.currentPhase, contract.currentPhase)
      ) {
        return recoveryFailure(
          envelope,
          "design-required",
          "return-to-design",
          pinned.currentPhase.correctionIndex,
          "failed",
          "artifact correction changed the current phase contract",
        );
      }
      artifactRejection =
        pinned.state.kind === "artifact-correction-pending"
          ? pinned.state.rejection
          : undefined;
      pinned = this.registry.setCurrentPhase(taskId, contract, 1) ?? pinned;
    } else if (changedPhase) {
      if (pinned.state.kind !== "phase-applied") {
        return {
          ok: false,
          error: "current phase candidate is not applied",
          failureKind: "failed",
        };
      }
      const sameAppliedPhase = pinned.currentPhase.phase === envelope.phase;
      if (
        sameAppliedPhase &&
        !samePhaseContract(pinned.currentPhase, contract.currentPhase)
      ) {
        return recoveryFailure(
          envelope,
          "design-required",
          "return-to-design",
          pinned.currentPhase.correctionIndex,
          "failed",
          "same-phase correction changed the current phase contract",
        );
      }
      if (
        !sameAppliedPhase &&
        !isNextImplementationPhase(pinned.currentPhase.phase, envelope.phase)
      ) {
        return recoveryFailure(
          envelope,
          "design-required",
          "return-to-design",
          pinned.currentPhase.correctionIndex,
          "failed",
          "invalid implementation phase transition",
        );
      }
      pinned = this.registry.setCurrentPhase(taskId, contract, 0) ?? pinned;
    } else if (pinned.state.kind === "phase-applied") {
      return {
        ok: false,
        error: "current phase candidate is already applied",
        failureKind: "failed",
      };
    }

    const first = await this.dispatchChild(
      agent,
      envelope,
      ctx,
      signal,
      artifactRejection,
    );
    if (signal.aborted)
      return {
        ...cancellationError(signal),
        failureKind: "cancelled",
      };
    if (first.ok) {
      this.rememberRetainedResult(first, envelope, pinned);
      return first;
    }
    if (first.failureKind === "cancelled") return first;
    if (first.failureClass === "environment") {
      const launchIndex = pinned.currentPhase.correctionIndex;
      if (first.launchConsumed) this.consumeWorkerLaunch(pinned);
      return recoveryFailure(
        envelope,
        "environment-blocked",
        "repair-environment",
        launchIndex,
        first.failureKind,
      );
    }
    if (pinned.currentPhase.correctionIndex === 1) {
      const artifactBlocked =
        correctingArtifact || first.failureClass === "artifact";
      pinned.state = {
        kind: "blocked",
        reason: artifactBlocked ? "artifact" : "mechanical",
      };
      return recoveryFailure(
        envelope,
        artifactBlocked
          ? "implementation-artifact-delivery-blocked"
          : "mechanical-redispatch-exhausted",
        "finish-unaffected",
        1,
        first.failureKind,
        "phase launch budget is exhausted",
      );
    }

    if (first.failureClass === "artifact") {
      pinned.state = {
        kind: "artifact-correction-pending",
        rejection: normalizedArtifactRejection(first.error),
      };
      return recoveryFailure(
        envelope,
        "implementation-artifact-delivery-blocked",
        "correct-artifact",
        0,
        first.failureKind,
        "generated implementation artifact requires bounded correction",
      );
    }

    pinned = this.registry.setCurrentPhase(taskId, contract, 1) ?? pinned;
    const second = await this.dispatchChild(agent, envelope, ctx, signal);
    if (signal.aborted)
      return {
        ...cancellationError(signal),
        failureKind: "cancelled",
      };
    if (second.ok) {
      this.rememberRetainedResult(second, envelope, pinned);
      return second;
    }
    if (second.failureKind === "cancelled") return second;
    if (second.failureClass === "environment") {
      if (second.launchConsumed) this.consumeWorkerLaunch(pinned);
      return recoveryFailure(
        envelope,
        "environment-blocked",
        "repair-environment",
        1,
        second.failureKind,
      );
    }
    const artifactBlocked = second.failureClass === "artifact";
    pinned.state = {
      kind: "blocked",
      reason: artifactBlocked ? "artifact" : "mechanical",
    };
    return recoveryFailure(
      envelope,
      artifactBlocked
        ? "implementation-artifact-delivery-blocked"
        : "mechanical-redispatch-exhausted",
      "finish-unaffected",
      1,
      second.failureKind ?? first.failureKind,
      "phase launch budget is exhausted",
    );
  }

  private consumeWorkerLaunch(worker: LogicalWorker): void {
    if (worker.currentPhase.correctionIndex === 0) {
      worker.currentPhase.correctionIndex = 1;
      worker.state = { kind: "ready" };
      return;
    }
    worker.state = { kind: "blocked", reason: "mechanical" };
  }

  private rememberRetainedResult(
    result: InternalDispatchResult,
    envelope: RequestEnvelope,
    worker: LogicalWorker,
  ): void {
    if (!result.ok || typeof result.resultId !== "string") return;
    this.retainedRuns.set(result.resultId, {
      taskId: envelope.taskId ?? envelope.id,
      requestId: envelope.id,
      phase: envelope.phase,
      launchIndex: worker.currentPhase.correctionIndex,
    });
    worker.state = { kind: "candidate-pending" };
  }

  validateRequest(
    envelope: unknown,
  ): { ok: true; value: RequestEnvelope } | { ok: false; reason: string } {
    return validateRequestEnvelope(envelope);
  }

  async drain(): Promise<void> {
    this.parentPayloadBridge?.clear();
    const settled = this.scheduler.cancelAll();
    this.retainedRuns.clear();
    drainStage({
      results: this.results,
      registry: this.registry,
      activation: this.activation,
    });
    await settled;
  }

  get state(): ActivationState {
    return this.activation.state;
  }
}

function isNextImplementationPhase(current: string, next: string): boolean {
  const phases = ["red", "green", "refactor"];
  const index = phases.indexOf(current);
  return index >= 0 && phases[index + 1] === next;
}
