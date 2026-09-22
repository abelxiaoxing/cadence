import type { Usage } from "@earendil-works/pi-ai";
import { Activation, type ActivationState } from "./activation.ts";
import { loadAgentDefinitions } from "./agent-registry.ts";
import {
  type ChildFailure,
  LIMITS,
  type PacketEnvelope,
  validateDiffResult,
  validateEvidenceResult,
  validatePacketEnvelope,
} from "./contracts.ts";
import type { PackageContext } from "./model-source.ts";
import type { SubagentRole } from "./subagent-process.ts";
import {
  buildSubagentPrompt,
  runSubagentProcess,
  type SubagentProcessResult,
} from "./subagent-process.ts";

export const PACKET_ACTIONS = ["run", "cancel", "finish"] as const;
export type PacketAction = (typeof PACKET_ACTIONS)[number];

import type {
  PacketActivityEvent,
  PacketActivityObserver,
  PacketActivityState,
} from "./activity-contracts.ts";

export type {
  PacketActivityEvent,
  PacketActivityObserver,
  PacketActivityState,
  PacketFailureReason,
} from "./activity-contracts.ts";

export type PacketDispatchResult =
  | {
      ok: true;
      action: PacketAction;
      result?: unknown;
      usage?: Usage;
    }
  | {
      ok: false;
      notReady?: true;
      error: string;
      failure?: ChildFailure;
      usage?: Usage;
    };

export interface PacketRuntimeOptions {
  activation?: Activation;
  concurrency?: number;
  childRunner?: PacketChildRunner;
}

export type PacketContext = PackageContext;

export type PacketChildResult =
  | { ok: true; result: unknown; usage?: Usage }
  | { ok: false; error: string; failure: ChildFailure; usage?: Usage };

export type PacketChildRunner = (input: {
  packet: PacketEnvelope;
  context: PacketContext;
  signal: AbortSignal;
}) => Promise<PacketChildResult>;

interface WaitingPacket {
  controller: AbortController;
  resolve(acquired: boolean): void;
  onAbort(): void;
}

function cancelledResult(signal: AbortSignal): PacketDispatchResult {
  const reason = signal.reason;
  return {
    ok: false,
    error:
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
          ? reason
          : "packet cancelled",
    failure: { kind: "cancelled", code: "cancelled" },
  };
}

function failureState(failure: ChildFailure): PacketActivityState {
  return failure.kind === "cancelled"
    ? "cancelled"
    : failure.kind === "transport" && failure.code === "child-timeout"
      ? "timed-out"
      : "failed";
}

type ParsedChildResult =
  | { ok: true; result: unknown }
  | { ok: false; reason: string };

function parsePacketResult(
  packet: PacketEnvelope,
  text: string,
): ParsedChildResult {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/giu)];
  let value: unknown;
  for (let index = fenced.length - 1; index >= 0; index -= 1) {
    try {
      value = JSON.parse(fenced[index]?.[1]?.trim() ?? "");
      break;
    } catch {
      // Keep looking for an earlier valid block; model text is not authority.
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { ok: false, reason: "child-result-json-invalid" };
  const candidate = value as Record<string, unknown>;
  if (packet.output === "evidence") {
    const checked = validateEvidenceResult(candidate);
    return checked.ok
      ? { ok: true, result: candidate }
      : { ok: false, reason: checked.reason ?? "child-evidence-invalid" };
  }
  const checked = validateDiffResult(candidate);
  return checked.ok
    ? { ok: true, result: candidate }
    : { ok: false, reason: checked.reason ?? "child-diff-invalid" };
}

export class PacketRuntime {
  readonly activation: Activation;
  readonly limits = LIMITS;
  readonly #concurrency: number;
  readonly #childRunner?: PacketChildRunner;
  readonly #controllers = new Set<AbortController>();
  readonly #operations = new Set<Promise<PacketDispatchResult>>();
  readonly #waiting: WaitingPacket[] = [];
  #active = 0;
  #sequence = 0;

  constructor(options: PacketRuntimeOptions) {
    this.activation = options.activation ?? new Activation();
    this.#childRunner = options.childRunner;
    this.#concurrency = Math.max(
      1,
      Math.min(
        options.concurrency ?? LIMITS.maxActiveChildSessions,
        LIMITS.maxActiveChildSessions,
      ),
    );
  }

  validateRequest(value: unknown) {
    return validatePacketEnvelope(value);
  }

  async execute(
    action: string,
    params: { request?: unknown },
    context?: PacketContext,
    signal?: AbortSignal,
    observer?: PacketActivityObserver,
  ): Promise<PacketDispatchResult> {
    if (!(PACKET_ACTIONS as readonly string[]).includes(action)) {
      throw new Error(`unknown packet action: ${String(action)}`);
    }
    if (!this.activation.isActive()) {
      return { ok: false, notReady: true, error: "dispatcher is not active" };
    }
    if (action === "cancel") {
      await this.cancel();
      return { ok: true, action };
    }
    if (action === "finish") {
      await this.drain();
      return { ok: true, action };
    }
    const operation = this.#run(params.request, context, signal, observer);
    this.#operations.add(operation);
    try {
      return await operation;
    } finally {
      this.#operations.delete(operation);
    }
  }

  async #run(
    request: unknown,
    context?: PacketContext,
    parentSignal?: AbortSignal,
    observer?: PacketActivityObserver,
  ): Promise<PacketDispatchResult> {
    if (!context) return { ok: false, error: "run requires extension context" };
    const validation = validatePacketEnvelope(request);
    if (!validation.ok) return { ok: false, error: validation.reason };
    const packet = validation.value;
    const sequence = ++this.#sequence;
    this.#notify(packet, observer, sequence, "queued");

    const controller = new AbortController();
    this.#controllers.add(controller);
    const forwardCancellation = () => {
      if (!controller.signal.aborted) controller.abort(parentSignal?.reason);
    };
    if (parentSignal?.aborted) forwardCancellation();
    else
      parentSignal?.addEventListener("abort", forwardCancellation, {
        once: true,
      });

    let acquired = false;
    try {
      acquired = await this.#acquire(controller);
      if (!acquired || controller.signal.aborted) {
        this.#notify(packet, observer, sequence, "cancelled");
        return cancelledResult(controller.signal);
      }
      if (this.#childRunner) {
        this.#notify(packet, observer, sequence, "running");
      }
      const child = await this.#dispatchChild(
        packet,
        context,
        controller.signal,
        (activity) =>
          this.#notify(packet, observer, sequence, activity.state, {
            attempt: activity.attempt,
            maxAttempts: activity.maxAttempts,
          }),
      );
      if (!child.ok) {
        const state = failureState(child.failure);
        this.#notify(packet, observer, sequence, state);
        return {
          ok: false,
          error: child.error,
          failure: child.failure,
          ...(child.usage ? { usage: child.usage } : {}),
        };
      }
      this.#notify(packet, observer, sequence, "completed");
      return {
        ok: true,
        action: "run",
        result: child.result,
        ...(child.usage ? { usage: child.usage } : {}),
      };
    } catch (error) {
      this.#notify(
        packet,
        observer,
        sequence,
        controller.signal.aborted ? "cancelled" : "failed",
      );
      throw error;
    } finally {
      parentSignal?.removeEventListener("abort", forwardCancellation);
      this.#controllers.delete(controller);
      if (acquired) this.#release();
    }
  }

  async #dispatchChild(
    packet: PacketEnvelope,
    context: PacketContext,
    signal: AbortSignal,
    onActivity?: (event: {
      state: PacketActivityState;
      attempt: number;
      maxAttempts: number;
    }) => void,
  ): Promise<PacketChildResult> {
    if (signal.aborted)
      return {
        ok: false,
        error: "packet cancelled",
        failure: { kind: "cancelled", code: "cancelled" },
      };
    if (this.#childRunner)
      return this.#childRunner({
        packet: structuredClone(packet),
        context,
        signal,
      });
    const agent = loadAgentDefinitions().find(
      (candidate) => candidate.role === packet.role,
    );
    if (!agent) throw new Error("packet-agent-unavailable");
    const role = packet.role as SubagentRole;
    const result = await runSubagentProcess({
      role,
      cwd: context.cwd,
      model: context.model
        ? { provider: context.model.provider, id: context.model.id }
        : undefined,
      prompt: buildSubagentPrompt({
        role,
        agentContent: agent.content,
        objective: packet.objective,
        context: [
          packet.context.agents,
          packet.context.contract,
          JSON.stringify({
            id: packet.id,
            phase: packet.phase,
            read: packet.declared.read,
            write: packet.declared.write,
            output: packet.output,
          }),
        ].join("\n\n"),
      }),
      signal,
      onEvent: (event) => {
        if (event.type === "agent_start")
          onActivity?.({
            state: "waiting-first-response",
            attempt: 1,
            maxAttempts: 1,
          });
        if (event.type === "tool_execution_start")
          onActivity?.({ state: "running", attempt: 1, maxAttempts: 1 });
      },
    });
    return this.#processResult(packet, result);
  }

  #processResult(
    packet: PacketEnvelope,
    result: SubagentProcessResult,
  ): PacketChildResult {
    if (result.status !== "completed") {
      const failure: ChildFailure =
        result.status === "cancelled"
          ? { kind: "cancelled", code: "cancelled" }
          : result.status === "timed-out"
            ? {
                kind: "transport",
                code: "child-timeout",
                stage: "child-timeout",
              }
            : result.status === "output-limit"
              ? {
                  kind: "result-limit",
                  limitBytes: LIMITS.maxCompleteResultBytes,
                }
              : {
                  kind: "transport",
                  code: "transport-failure",
                  stage: "child-provider-stream",
                };
      return {
        ok: false,
        error: result.error ?? result.status,
        failure,
        ...(result.usage ? { usage: result.usage } : {}),
      };
    }
    const parsed = parsePacketResult(packet, result.finalText);
    if (!parsed.ok)
      return {
        ok: false,
        error: parsed.reason,
        failure: {
          kind: "artifact",
          code: "invalid-structural-result",
          stage: "child-provider-stream",
        },
        ...(result.usage ? { usage: result.usage } : {}),
      };
    return {
      ok: true,
      result: parsed.result,
      ...(result.usage ? { usage: result.usage } : {}),
    };
  }

  #notify(
    packet: PacketEnvelope,
    observer: PacketActivityObserver | undefined,
    sequence: number,
    state: PacketActivityState,
    metadata: Pick<
      PacketActivityEvent,
      "attempt" | "maxAttempts" | "code" | "wait"
    > = {},
  ): void {
    if (!observer) return;
    const event: PacketActivityEvent = {
      state,
      requestId: packet.id,
      role: packet.role,
      phase: packet.phase,
      objective: packet.objective,
      sequence,
      ...metadata,
      ...(state === "cancelled"
        ? { failureReason: "subagent cancelled" as const }
        : state === "timed-out"
          ? { failureReason: "phase timed out" as const }
          : state === "failed"
            ? { failureReason: "subagent failed" as const }
            : {}),
    };
    try {
      const result = observer(event);
      if (result instanceof Promise) void result.catch(() => undefined);
    } catch {
      // Presentation observers cannot alter execution.
    }
  }

  #acquire(controller: AbortController): Promise<boolean> {
    if (controller.signal.aborted) return Promise.resolve(false);
    if (this.#active < this.#concurrency) {
      this.#active += 1;
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      let waiting: WaitingPacket;
      const onAbort = () => {
        const index = this.#waiting.indexOf(waiting);
        if (index >= 0) this.#waiting.splice(index, 1);
        resolve(false);
      };
      waiting = { controller, resolve, onAbort };
      this.#waiting.push(waiting);
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  #release(): void {
    this.#active -= 1;
    while (this.#waiting.length > 0) {
      const next = this.#waiting.shift();
      if (!next || next.controller.signal.aborted) continue;
      next.controller.signal.removeEventListener("abort", next.onAbort);
      this.#active += 1;
      next.resolve(true);
      break;
    }
  }

  async cancel(): Promise<void> {
    const reason = new Error("packet runtime cancelled");
    for (const controller of this.#controllers) {
      if (!controller.signal.aborted) controller.abort(reason);
    }
    await Promise.allSettled([...this.#operations]);
  }

  async drain(): Promise<void> {
    this.activation.drain();
    await this.cancel();
  }

  get state(): ActivationState {
    return this.activation.state;
  }
}
