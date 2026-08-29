import path from "node:path";
import type { Usage } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Activation, type ActivationState } from "./activation.ts";
import { loadAgentDefinitions } from "./agent-registry.ts";
import {
  type ChildFailureKind,
  type ChildSessionResult,
  runChildSession,
  UsageAggregator,
} from "./child-session.ts";
import {
  type ChildFailure,
  LIMITS,
  type PacketEnvelope,
  validatePacketEnvelope,
} from "./contracts.ts";
import type { ParentPayloadBridge } from "./parent-payload-bridge.ts";
import { runtimeForWorkerRoute } from "./parent-provider.ts";
import {
  loadRoutePolicy,
  type RoutePolicy,
  unavailableRoutePolicy,
  type WorkerRole,
} from "./route-policy.ts";
import { type BrokerActivityUpdate, RunWorkerBroker } from "./worker-broker.ts";

export const PACKET_ACTIONS = ["run", "cancel", "finish"] as const;
export type PacketAction = (typeof PACKET_ACTIONS)[number];

export type PacketActivityState =
  | "queued"
  | "connecting"
  | "waiting-first-response"
  | "running"
  | "retrying"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed-out";

export type PacketFailureReason =
  | "subagent failed"
  | "subagent cancelled"
  | "phase timed out";

export interface PacketActivityEvent {
  state: PacketActivityState;
  requestId: string;
  role: string;
  phase: string;
  objective: string;
  sequence: number;
  attempt?: number;
  maxAttempts?: number;
  code?: string;
  wait?: string;
  failureReason?: PacketFailureReason;
}

export type PacketActivityObserver = (
  event: PacketActivityEvent,
) => void | Promise<void>;

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
  parentPayloadBridge: ParentPayloadBridge;
  routePolicy?: RoutePolicy;
  routePolicyHome?: string;
  environment?: Readonly<Record<string, string | undefined>>;
  concurrency?: number;
  childRunner?: PacketChildRunner;
}

export type PacketContext = Pick<
  ExtensionContext,
  "cwd" | "model" | "modelRegistry"
>;

export type PacketChildRunner = (input: {
  packet: PacketEnvelope;
  context: PacketContext;
  signal: AbortSignal;
}) => Promise<ChildSessionResult>;

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

function failureState(kind: ChildFailureKind): PacketActivityState {
  return kind === "cancelled"
    ? "cancelled"
    : kind === "timed-out"
      ? "timed-out"
      : "failed";
}

function syntheticChildFailure(
  error: string,
  failure: ChildFailure,
  failureKind: ChildFailureKind = failure.kind === "cancelled"
    ? "cancelled"
    : "failed",
): ChildSessionResult {
  return {
    ok: false,
    error,
    failure,
    failureKind,
    transportFailure: failure.kind === "transport",
    disposeCount: 0,
    usage: new UsageAggregator().total(),
    classification: {
      finalCategory: "no-final-assistant",
      attempts: 0,
      schema: "invalid",
      identity: { request: false, role: false, task: false, phase: false },
    },
  };
}

export class PacketRuntime {
  readonly activation: Activation;
  readonly limits = LIMITS;
  readonly #parentPayloadBridge: ParentPayloadBridge;
  readonly #routePolicy?: RoutePolicy;
  readonly #routePolicyHome?: string;
  readonly #environment: Readonly<Record<string, string | undefined>>;
  readonly #concurrency: number;
  readonly #childRunner?: PacketChildRunner;
  readonly #brokers = new Map<string, RunWorkerBroker>();
  readonly #brokerPolicies = new Map<string, string>();
  readonly #controllers = new Set<AbortController>();
  readonly #operations = new Set<Promise<PacketDispatchResult>>();
  readonly #waiting: WaitingPacket[] = [];
  #active = 0;
  #sequence = 0;

  constructor(options: PacketRuntimeOptions) {
    this.activation = options.activation ?? new Activation();
    this.#parentPayloadBridge = options.parentPayloadBridge;
    this.#routePolicy = options.routePolicy;
    this.#routePolicyHome = options.routePolicyHome;
    this.#environment = options.environment ?? process.env;
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
      const usage = new UsageAggregator();
      const child = await this.#dispatchChild(
        packet,
        context,
        controller.signal,
        (activity) =>
          this.#notifyBrokerActivity(packet, observer, sequence, activity),
      );
      usage.add("launch:0", child.usage);
      if (!child.ok) {
        const state = failureState(child.failureKind);
        this.#notify(packet, observer, sequence, state);
        return {
          ok: false,
          error: child.error,
          failure: child.failure,
          usage: usage.total(),
        };
      }
      this.#notify(packet, observer, sequence, "completed");
      return {
        ok: true,
        action: "run",
        result: child.result,
        usage: usage.total(),
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
    onActivity?: (event: BrokerActivityUpdate) => void,
  ): Promise<ChildSessionResult> {
    if (signal.aborted) {
      const result = cancelledResult(signal);
      return syntheticChildFailure(
        result.ok ? "packet cancelled" : result.error,
        { kind: "cancelled", code: "cancelled" },
        "cancelled",
      );
    }
    if (this.#childRunner) {
      return this.#childRunner({
        packet: structuredClone(packet),
        context,
        signal,
      });
    }
    const agent = loadAgentDefinitions().find(
      (candidate) => candidate.role === packet.role,
    );
    if (!agent) {
      throw new Error("packet agent definition is unavailable");
    }
    const broker = this.#brokerFor(context.cwd);
    const routed = await broker.run({
      runId: `${packet.stage}:${packet.id}`,
      operationId: packet.id,
      role: packet.role as WorkerRole,
      signal,
      ...(onActivity ? { onActivity } : {}),
      execute: async (attempt) => {
        const phase = await runtimeForWorkerRoute(
          attempt.route,
          context,
          this.#parentPayloadBridge,
          attempt.signal,
          this.#environment,
        );
        if (!phase.ok) {
          if (phase.failure.kind === "cancelled") {
            return { kind: "phase-failure" as const, phase };
          }
          throw new Error(phase.failure.code);
        }
        const child = await runChildSession({
          cwd: context.cwd,
          modelRuntime: phase.modelRuntime,
          model: phase.model,
          systemPrompt: [
            agent.content,
            packet.objective,
            packet.context.agents,
            packet.context.contract,
            `<packet-contract>${JSON.stringify({
              requestId: packet.id,
              phase: packet.phase,
              readSet: packet.declared.read,
              writeSet: packet.declared.write,
              output: packet.output,
            })}</packet-contract>`,
          ].join("\n\n"),
          requestId: packet.id,
          role: packet.role,
          phase: packet.phase,
          output: packet.output as "evidence" | "diff",
          roots: packet.roots.map((root) => path.resolve(context.cwd, root)),
          allowedPaths: [
            ...new Set([...packet.declared.read, ...packet.declared.write]),
          ],
          timeoutMs: LIMITS.phaseTimeoutMs,
          signal: attempt.signal,
          failureOverride: phase.failureOverride,
          onStreamStart: attempt.onHeaders,
          onStreamProgress: attempt.onProgress,
        });
        if (!child.ok && child.failure.kind === "transport") {
          throw new Error(child.failure.code);
        }
        return { kind: "child" as const, child };
      },
    });
    if (!routed.ok) {
      const cancelled = routed.state === "cancelled" || signal.aborted;
      const timedOut = !cancelled && routed.code === "phase-timeout";
      return syntheticChildFailure(
        cancelled ? "packet cancelled" : routed.code,
        cancelled
          ? { kind: "cancelled", code: "cancelled" }
          : timedOut
            ? {
                kind: "transport",
                code: "timeout",
                stage: "child-timeout",
              }
            : {
                kind: "transport",
                code: "transport-failure",
                stage: "child-provider-stream",
              },
        cancelled ? "cancelled" : timedOut ? "timed-out" : "failed",
      );
    }
    if (routed.value.kind === "phase-failure") {
      const phase = routed.value.phase;
      return syntheticChildFailure(phase.error, phase.failure);
    }
    return routed.value.child;
  }

  #brokerFor(cwd: string): RunWorkerBroker {
    const root = path.resolve(cwd);
    const existing = this.#brokers.get(root);
    let policy = this.#routePolicy;
    if (policy && existing) return existing;
    if (!policy) {
      const resolution = loadRoutePolicy({
        cwd: root,
        ...(this.#routePolicyHome ? { home: this.#routePolicyHome } : {}),
      });
      if (!resolution.ok && resolution.source.kind !== "none") {
        const code = resolution.diagnostics[0]?.code ?? "policy-invalid";
        throw new Error(`route-policy-unavailable:${code}`);
      }
      policy = resolution.ok ? resolution.policy : unavailableRoutePolicy();
    }
    const serializedPolicy = JSON.stringify(policy);
    if (existing && this.#brokerPolicies.get(root) === serializedPolicy) {
      return existing;
    }
    const broker = new RunWorkerBroker(policy);
    this.#brokers.set(root, broker);
    this.#brokerPolicies.set(root, serializedPolicy);
    return broker;
  }

  #notifyBrokerActivity(
    packet: PacketEnvelope,
    observer: PacketActivityObserver | undefined,
    sequence: number,
    activity: BrokerActivityUpdate,
  ): void {
    this.#notify(packet, observer, sequence, activity.state, {
      attempt: activity.attempt,
      maxAttempts: activity.maxAttempts,
      ...(activity.code ? { code: activity.code } : {}),
      ...(activity.wait ? { wait: activity.wait } : {}),
    });
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
    this.#brokers.clear();
    this.#brokerPolicies.clear();
    this.#parentPayloadBridge.clear();
  }

  get state(): ActivationState {
    return this.activation.state;
  }
}
