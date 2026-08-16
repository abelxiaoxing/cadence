import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Activation, type ActivationState } from "./activation.ts";
import { loadAgentDefinitions } from "./agent-registry.ts";
import { runChildSession } from "./child-session.ts";
import {
  ACTIONS,
  type DiffResult,
  LIMITS,
  type RequestEnvelope,
  validateRequestEnvelope,
} from "./contracts.ts";
import { drainStage } from "./drain.ts";
import { type Bound, mergeBounds } from "./file-snapshot.ts";
import { runtimeFromContext } from "./parent-provider.ts";
import { applyRetainedPatch } from "./patch.ts";
import { ResultStore } from "./result-store.ts";
import { Scheduler } from "./scheduler.ts";
import {
  contractOf,
  sameContract,
  WorkerRegistry,
  workerIdentity,
} from "./worker.ts";

const SHA256_HEX = /^[0-9a-f]{64}$/;

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
  | { ok: false; notReady?: true; error: string };

export interface ApplyResult {
  targets: string[];
  checkExitCode: 0;
  applyExitCode: 0;
  sequence?: number;
}

export interface RuntimeOptions {
  activation?: Activation;
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
  private readonly registry = new WorkerRegistry();
  private readonly runContexts = new WeakMap<
    RequestEnvelope,
    StoredRunContext
  >();
  private readonly scheduler: Scheduler<ScheduledRunResult>;

  constructor(opts: RuntimeOptions = {}) {
    this.activation = opts.activation ?? new Activation();
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
      return this.enqueueApply(ctx.cwd, params.resultId);
    }
    if (action === "discard") {
      if (!params.resultId)
        return { ok: false, error: "discard requires resultId" };
      return this.results.discard(params.resultId)
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

  private enqueueApply(root: string, id: string): Promise<DispatchResult> {
    const run = this.applyTail.then(
      () => applyRetainedPatch({ root, id, store: this.results }),
      () => applyRetainedPatch({ root, id, store: this.results }),
    );
    this.applyTail = run.then(
      () => undefined,
      () => undefined,
    );
    const seq = ++this.applySeq;
    return run.then(
      (result) =>
        result.ok
          ? { ok: true, action: "apply", result: { ...result, sequence: seq } }
          : result,
      (error) => ({ ok: false, error: (error as Error).message }),
    );
  }

  private async dispatchChild(
    agent: { role: string; content: string },
    envelope: RequestEnvelope,
    ctx: RunContext,
    signal: AbortSignal,
  ): Promise<DispatchResult & { failureKind?: RunFailureKind }> {
    if (signal.aborted)
      return {
        ...cancellationError(signal),
        failureKind: "cancelled",
      };
    let phase: Awaited<ReturnType<typeof runtimeFromContext>>;
    try {
      phase = await runtimeFromContext(ctx, signal);
    } catch (error) {
      return {
        ok: false,
        error: signal.aborted
          ? cancellationError(signal).error
          : (error as Error).message,
        failureKind: signal.aborted ? "cancelled" : "failed",
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
    const systemPrompt = [
      agent.content,
      envelope.objective,
      envelope.context.agents,
      envelope.context.contract,
    ].join("\n\n");
    const child = await runChildSession({
      cwd: ctx.cwd,
      modelRuntime: phase.modelRuntime,
      model: phase.model,
      systemPrompt,
      requestId: envelope.id,
      role: envelope.role,
      phase: envelope.phase,
      output: envelope.output as "evidence" | "diff",
      roots,
      timeoutMs: LIMITS.phaseTimeoutMs,
      signal,
    });
    if (signal.aborted)
      return {
        ...cancellationError(signal),
        failureKind: "cancelled",
      };
    if (!child.ok) return { ...child, failureKind: child.failureKind };
    if (envelope.output === "evidence") {
      return {
        ok: true,
        action: "run",
        result: child.result,
        usage: child.usage,
      };
    }
    const diff = child.result as DiffResult;
    const resultId = this.results.retain({
      diff: diff.diff,
      writeSet: envelope.declared.write,
      root: ctx.cwd,
    });
    if (isSafeBound(envelope.snapshot)) {
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
      roots: [...validation.value.roots],
      context: { ...validation.value.context },
      declared: {
        ...validation.value.declared,
        read: [...validation.value.declared.read],
        write: [...validation.value.declared.write],
        conflicts: [...validation.value.declared.conflicts],
        resources: [...validation.value.declared.resources],
      },
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
        };
        const { failureKind, ...publicResult } = internalResult;
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
  ): Promise<DispatchResult & { failureKind?: RunFailureKind }> {
    if (signal.aborted)
      return {
        ...cancellationError(signal),
        failureKind: "cancelled",
      };
    const agent = loadAgentDefinitions().find(
      (item) => item.role === envelope.role,
    );
    if (!agent)
      return {
        ok: false,
        error: "package Agent role not found",
        failureKind: "failed",
      };
    if (!ctx.model)
      return {
        ok: false,
        error: "run requires a model identity",
        failureKind: "failed",
      };
    const identity = workerIdentity(ctx.model);
    const contract = contractOf(envelope);
    const existing = this.registry.get(envelope.id);
    if (existing) {
      if (existing.identity !== identity) {
        return {
          ok: false,
          error:
            "blocked: logical Worker pinned provider/model identity differs",
          failureKind: "failed",
        };
      }
      if (!sameContract(existing.contract, contract)) {
        return {
          ok: false,
          error:
            "blocked: logical Worker contract changed for a recovery scope",
          failureKind: "failed",
        };
      }
      if (existing.redispatchUsed) {
        return {
          ok: false,
          error: "blocked: mechanical redispatch is already exhausted",
          failureKind: "failed",
        };
      }
    } else {
      this.registry.pin(contract, identity);
    }
    const pinned = this.registry.get(envelope.id);
    const first = await this.dispatchChild(agent, envelope, ctx, signal);
    if (signal.aborted)
      return {
        ...cancellationError(signal),
        failureKind: "cancelled",
      };
    if (first.ok) {
      if (pinned) pinned.redispatchUsed = false;
      return first;
    }
    if (pinned?.redispatchUsed) {
      return {
        ok: false,
        error: "blocked: mechanical redispatch failed and is exhausted",
        failureKind: first.failureKind ?? "failed",
      };
    }
    if (!pinned) {
      return {
        ok: false,
        error: "blocked: logical Worker is not pinned",
        failureKind: "failed",
      };
    }
    pinned.redispatchUsed = true;
    const second = await this.dispatchChild(agent, envelope, ctx, signal);
    if (signal.aborted)
      return {
        ...cancellationError(signal),
        failureKind: "cancelled",
      };
    if (!second.ok) {
      return {
        ok: false,
        error: "blocked: identical mechanical redispatch failed again",
        failureKind: second.failureKind ?? first.failureKind ?? "failed",
      };
    }
    return second;
  }

  validateRequest(
    envelope: unknown,
  ): { ok: true; value: RequestEnvelope } | { ok: false; reason: string } {
    return validateRequestEnvelope(envelope);
  }

  async drain(): Promise<void> {
    const settled = this.scheduler.cancelAll();
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
