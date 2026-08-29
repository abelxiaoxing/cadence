import { createHash } from "node:crypto";
import type { ControlStage } from "./control-contracts.ts";

export const RUN_STATES = [
  "created",
  "validating-delivery",
  "ready",
  "queued",
  "connecting",
  "running",
  "validating",
  "verifying",
  "retryable",
  "paused",
  "approval-needed",
  "change-verifying",
  "ready-to-apply",
  "applying",
  "recovering",
  "completed",
  "discarded",
  "rejected",
] as const;

export const TASK_STATES = [
  "pending",
  "queued",
  "phase-ready",
  "phase-running",
  "validating",
  "phase-verified",
  "repairable",
  "retryable",
  "paused",
  "approval-needed",
  "verified",
] as const;

export type RunState = (typeof RUN_STATES)[number];
export type TaskState = (typeof TASK_STATES)[number];
export type DeliveryGate = "gate-a" | "gate-b";

export const ZERO_EVENT_HASH = "0".repeat(64);
const SHA256 = /^[a-f0-9]{64}$/u;

export interface DeliveryBindingProjection {
  gate: DeliveryGate;
  revision: number;
  receiptHash: string;
  approvalProof?: {
    revision: number;
    contractHash: string;
    recordHash: string;
  };
}

export interface RunProjection {
  runId: string;
  rootHash: string;
  stage: ControlStage;
  change?: string;
  provisionalKey?: string;
  state: RunState;
  sequence: number;
  eventHash: string;
  deliveryRevision?: number;
  deliveryBindings: DeliveryBindingProjection[];
  pauseCode?: string;
  terminal?: "completed" | "discarded" | "rejected";
}

export type RunEventType =
  | "run-created"
  | "change-bound"
  | "delivery-bound"
  | "state-transitioned"
  | "operation-interrupted";

export interface RunEvent {
  sequence: number;
  type: RunEventType;
  payload: Record<string, unknown>;
  priorHash: string;
  hash: string;
}

const TERMINAL_STATES = new Set<RunState>([
  "completed",
  "discarded",
  "rejected",
]);

const LEGAL_TRANSITIONS: Readonly<Record<RunState, readonly RunState[]>> = {
  created: ["validating-delivery", "paused", "discarded", "rejected"],
  "validating-delivery": [
    "ready",
    "paused",
    "approval-needed",
    "discarded",
    "rejected",
  ],
  ready: ["queued", "running", "paused", "discarded", "rejected"],
  queued: ["connecting", "running", "paused", "discarded"],
  connecting: ["running", "retryable", "paused", "discarded"],
  running: [
    "validating",
    "verifying",
    "queued",
    "retryable",
    "paused",
    "approval-needed",
    "change-verifying",
    "discarded",
  ],
  validating: [
    "running",
    "verifying",
    "retryable",
    "paused",
    "approval-needed",
    "discarded",
  ],
  verifying: [
    "running",
    "retryable",
    "paused",
    "approval-needed",
    "change-verifying",
    "discarded",
  ],
  retryable: ["queued", "connecting", "running", "paused", "discarded"],
  paused: [
    "paused",
    "validating-delivery",
    "ready",
    "queued",
    "connecting",
    "running",
    "approval-needed",
    "recovering",
    "completed",
    "discarded",
    "rejected",
  ],
  "approval-needed": ["validating-delivery", "paused", "discarded", "rejected"],
  "change-verifying": [
    "running",
    "retryable",
    "paused",
    "approval-needed",
    "ready-to-apply",
    "discarded",
  ],
  "ready-to-apply": ["applying", "paused", "discarded"],
  applying: ["recovering", "completed"],
  recovering: ["applying", "paused", "completed", "discarded", "rejected"],
  completed: [],
  discarded: [],
  rejected: [],
};

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function hashRunEvent(event: Omit<RunEvent, "hash">): string {
  return createHash("sha256").update(canonicalJson(event)).digest("hex");
}

export function createRunEvent(
  sequence: number,
  type: RunEventType,
  payload: Record<string, unknown>,
  priorHash: string,
): RunEvent {
  if (
    !Number.isSafeInteger(sequence) ||
    sequence < 1 ||
    !SHA256.test(priorHash)
  ) {
    throw new Error("event-integrity-invalid-header");
  }
  const unsigned = {
    sequence,
    type,
    payload: structuredClone(payload),
    priorHash,
  };
  return { ...unsigned, hash: hashRunEvent(unsigned) };
}

export function canTransition(from: RunState, to: RunState): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

export function assertRunTransition(from: RunState, to: RunState): void {
  if (!canTransition(from, to)) {
    throw new Error(`invalid-run-transition:${from}:${to}`);
  }
}

function requireString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`event-integrity-invalid-${key}`);
  }
  return value;
}

function applyVerifiedEvent(
  projection: RunProjection | undefined,
  event: RunEvent,
): RunProjection {
  switch (event.type) {
    case "run-created": {
      if (projection || event.sequence !== 1) {
        throw new Error("event-integrity-duplicate-create");
      }
      const stage = event.payload.stage;
      if (stage !== "abel-design" && stage !== "abel-implement") {
        throw new Error("event-integrity-invalid-stage");
      }
      const change = event.payload.change;
      const provisionalKey = event.payload.provisionalKey;
      if (
        (typeof change !== "string" || change.length === 0) ===
        (typeof provisionalKey !== "string" || provisionalKey.length === 0)
      ) {
        throw new Error("event-integrity-invalid-run-key");
      }
      return {
        runId: requireString(event.payload, "runId"),
        rootHash: requireString(event.payload, "rootHash"),
        stage,
        ...(typeof change === "string" ? { change } : {}),
        ...(typeof provisionalKey === "string" ? { provisionalKey } : {}),
        state: "created",
        sequence: event.sequence,
        eventHash: event.hash,
        deliveryBindings: [],
      };
    }
    case "change-bound": {
      if (projection?.stage !== "abel-design") {
        throw new Error("event-integrity-change-binding");
      }
      const { provisionalKey: _provisionalKey, ...boundProjection } =
        projection;
      return {
        ...boundProjection,
        change: requireString(event.payload, "change"),
        sequence: event.sequence,
        eventHash: event.hash,
      };
    }
    case "delivery-bound": {
      if (!projection) throw new Error("event-integrity-missing-run");
      const gate = event.payload.gate;
      const revision = event.payload.revision;
      const receiptHash = event.payload.receiptHash;
      const approvalProof = event.payload.approvalProof;
      if (
        (gate !== "gate-a" && gate !== "gate-b") ||
        !Number.isSafeInteger(revision) ||
        (revision as number) < 1 ||
        typeof receiptHash !== "string" ||
        !SHA256.test(receiptHash) ||
        (approvalProof !== undefined &&
          (!approvalProof ||
            typeof approvalProof !== "object" ||
            Array.isArray(approvalProof) ||
            !Number.isSafeInteger(
              (approvalProof as Record<string, unknown>).revision,
            ) ||
            Number((approvalProof as Record<string, unknown>).revision) < 1 ||
            typeof (approvalProof as Record<string, unknown>).contractHash !==
              "string" ||
            !SHA256.test(
              String((approvalProof as Record<string, unknown>).contractHash),
            ) ||
            typeof (approvalProof as Record<string, unknown>).recordHash !==
              "string" ||
            !SHA256.test(
              String((approvalProof as Record<string, unknown>).recordHash),
            )))
      ) {
        throw new Error("event-integrity-delivery-binding");
      }
      const binding: DeliveryBindingProjection = {
        gate: gate as DeliveryGate,
        revision: revision as number,
        receiptHash,
        ...(approvalProof
          ? {
              approvalProof: structuredClone(
                approvalProof as DeliveryBindingProjection["approvalProof"],
              ),
            }
          : {}),
      };
      const existing = projection.deliveryBindings.find(
        (candidate) =>
          candidate.gate === binding.gate &&
          candidate.revision === binding.revision,
      );
      if (
        existing &&
        (existing.receiptHash !== binding.receiptHash ||
          canonicalJson(existing.approvalProof) !==
            canonicalJson(binding.approvalProof))
      ) {
        throw new Error("event-integrity-delivery-conflict");
      }
      const deliveryBindings = existing
        ? projection.deliveryBindings
        : [...projection.deliveryBindings, binding].sort(
            (left, right) =>
              left.revision - right.revision ||
              left.gate.localeCompare(right.gate),
          );
      return {
        ...projection,
        deliveryBindings,
        deliveryRevision: Math.max(
          projection.deliveryRevision ?? 0,
          binding.revision,
        ),
        sequence: event.sequence,
        eventHash: event.hash,
      };
    }
    case "state-transitioned": {
      if (!projection) throw new Error("event-integrity-missing-run");
      const from = event.payload.from;
      const to = event.payload.to;
      if (
        from !== projection.state ||
        !(RUN_STATES as readonly unknown[]).includes(to)
      ) {
        throw new Error("event-integrity-state-mismatch");
      }
      assertRunTransition(projection.state, to as RunState);
      const nextState = to as RunState;
      const {
        pauseCode: _pauseCode,
        terminal: _terminal,
        ...transitionedProjection
      } = projection;
      return {
        ...transitionedProjection,
        state: nextState,
        sequence: event.sequence,
        eventHash: event.hash,
        ...(typeof event.payload.code === "string"
          ? { pauseCode: event.payload.code }
          : {}),
        ...(TERMINAL_STATES.has(nextState)
          ? { terminal: nextState as "completed" | "discarded" | "rejected" }
          : {}),
      };
    }
    case "operation-interrupted": {
      if (!projection || TERMINAL_STATES.has(projection.state)) {
        throw new Error("event-integrity-interruption");
      }
      const nextState =
        projection.state === "applying" ? "recovering" : "paused";
      if (nextState !== projection.state) {
        assertRunTransition(projection.state, nextState);
      }
      return {
        ...projection,
        state: nextState,
        pauseCode: "operation-interrupted",
        sequence: event.sequence,
        eventHash: event.hash,
      };
    }
  }
}

export function reduceRunEvents(events: readonly RunEvent[]): RunProjection {
  if (events.length === 0) throw new Error("event-integrity-empty");
  let projection: RunProjection | undefined;
  let priorHash = ZERO_EVENT_HASH;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (
      event.sequence !== index + 1 ||
      event.priorHash !== priorHash ||
      !SHA256.test(event.hash) ||
      hashRunEvent({
        sequence: event.sequence,
        type: event.type,
        payload: event.payload,
        priorHash: event.priorHash,
      }) !== event.hash
    ) {
      throw new Error("event-integrity-hash-chain");
    }
    projection = applyVerifiedEvent(projection, event);
    priorHash = event.hash;
  }
  if (!projection) throw new Error("event-integrity-empty");
  return projection;
}

export function legalControlCommands(state: RunState): string[] {
  if (TERMINAL_STATES.has(state)) return ["status"];
  if (
    state === "paused" ||
    state === "retryable" ||
    state === "approval-needed"
  ) {
    return ["status", "resume", "rebind", "discard"];
  }
  if (state === "recovering") return ["status", "resume", "discard"];
  return ["status", "cancel", "discard"];
}
