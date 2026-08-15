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
import {
  contractOf,
  sameContract,
  WorkerRegistry,
  workerIdentity,
} from "./worker.ts";

const SHA256_HEX = /^[0-9a-f]{64}$/;

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

export class Runtime {
  readonly activation: Activation;
  readonly limits = LIMITS;
  readonly results = new ResultStore();
  private applyTail: Promise<void> = Promise.resolve();
  private applySeq = 0;
  private readonly registry = new WorkerRegistry();

  constructor(opts: RuntimeOptions = {}) {
    this.activation = opts.activation ?? new Activation();
  }

  async execute(
    action: string,
    params: { request?: unknown; resultId?: string },
    ctx?: RunContext,
  ): Promise<DispatchResult> {
    if (!(ACTIONS as readonly string[]).includes(action)) {
      return { ok: false, error: `unknown action: ${String(action)}` };
    }
    if (!this.activation.isActive()) {
      return { ok: false, notReady: true, error: "dispatcher is not active" };
    }
    if (action === "run") return this.run(params.request, ctx);
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
    if (action === "cancel") return { ok: true, action };
    drainStage({
      results: this.results,
      registry: this.registry,
      activation: this.activation,
    });
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
  ): Promise<DispatchResult> {
    let phase: Awaited<ReturnType<typeof runtimeFromContext>>;
    try {
      phase = await runtimeFromContext(ctx);
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
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
    });
    if (!child.ok) return child;
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
  ): Promise<DispatchResult> {
    if (!ctx) return { ok: false, error: "run requires extension context" };
    const validation = validateRequestEnvelope(request);
    if (!validation.ok) return { ok: false, error: validation.reason };
    const envelope = validation.value;
    const agent = loadAgentDefinitions().find(
      (item) => item.role === envelope.role,
    );
    if (!agent) return { ok: false, error: "package Agent role not found" };
    if (!ctx.model)
      return { ok: false, error: "run requires a model identity" };
    const identity = workerIdentity(ctx.model);
    const contract = contractOf(envelope);
    const existing = this.registry.get(envelope.id);
    if (existing) {
      if (existing.identity !== identity) {
        return {
          ok: false,
          error:
            "blocked: logical Worker pinned provider/model identity differs",
        };
      }
      if (!sameContract(existing.contract, contract)) {
        return {
          ok: false,
          error:
            "blocked: logical Worker contract changed for a recovery scope",
        };
      }
      if (existing.redispatchUsed) {
        return {
          ok: false,
          error: "blocked: mechanical redispatch is already exhausted",
        };
      }
    } else {
      this.registry.pin(contract, identity);
    }
    const pinned = this.registry.get(envelope.id);
    const first = await this.dispatchChild(agent, envelope, ctx);
    if (first.ok) {
      if (pinned) pinned.redispatchUsed = false;
      return first;
    }
    if (pinned?.redispatchUsed) {
      return {
        ok: false,
        error: "blocked: mechanical redispatch failed and is exhausted",
      };
    }
    if (!pinned) {
      return { ok: false, error: "blocked: logical Worker is not pinned" };
    }
    pinned.redispatchUsed = true;
    const second = await this.dispatchChild(agent, envelope, ctx);
    if (!second.ok) {
      return {
        ok: false,
        error: "blocked: identical mechanical redispatch failed again",
      };
    }
    return second;
  }

  validateRequest(
    envelope: unknown,
  ): { ok: true; value: RequestEnvelope } | { ok: false; reason: string } {
    return validateRequestEnvelope(envelope);
  }

  drain(): void {
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
