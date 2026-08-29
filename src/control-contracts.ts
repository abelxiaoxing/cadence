// Caller-facing commands for the private Abel workflow control plane.
// Mechanical graph, snapshot, task, and apply identities are intentionally not
// part of this surface: the control plane derives them from approved delivery.

export const CONTROL_PROTOCOL_VERSION = 2 as const;

export const CONTROL_COMMANDS = [
  "start",
  "status",
  "resume",
  "rebind",
  "cancel",
  "discard",
] as const;

export const CONTROL_STAGES = ["abel-design", "abel-implement"] as const;

export type ControlCommandName = (typeof CONTROL_COMMANDS)[number];
export type ControlStage = (typeof CONTROL_STAGES)[number];

const IDENTIFIER = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/iu;
const CHANGE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

interface ControlBase {
  version: typeof CONTROL_PROTOCOL_VERSION;
  command: ControlCommandName;
  stage: ControlStage;
}

interface NamedControlBase extends ControlBase {
  change: string;
}

export interface NamedStartControlCommand extends NamedControlBase {
  command: "start";
  operationId: string;
  provisionalKey?: string;
}

export interface ProvisionalDesignStartControlCommand extends ControlBase {
  command: "start";
  stage: "abel-design";
  provisionalKey: string;
  operationId: string;
}

export type StartControlCommand =
  | NamedStartControlCommand
  | ProvisionalDesignStartControlCommand;

export interface StatusControlCommand extends NamedControlBase {
  command: "status";
}

export interface ResumeControlCommand extends NamedControlBase {
  command: "resume";
  operationId: string;
  deliveryRevision?: number;
  receiptHash?: string;
}

export interface RebindControlCommand extends NamedControlBase {
  command: "rebind";
  operationId: string;
  routeId: string;
}

export interface CancelControlCommand extends NamedControlBase {
  command: "cancel";
  operationId: string;
}

export interface DiscardControlCommand extends NamedControlBase {
  command: "discard";
  operationId: string;
}

export type ControlCommand =
  | StartControlCommand
  | StatusControlCommand
  | ResumeControlCommand
  | RebindControlCommand
  | CancelControlCommand
  | DiscardControlCommand;

export type ControlCommandValidation =
  | { ok: true; value: ControlCommand }
  | {
      ok: false;
      code: "invalid-control-command" | "unsupported-control-version";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => allowed.has(key))
  );
}

function validCommon(value: Record<string, unknown>): boolean {
  return (
    value.version === CONTROL_PROTOCOL_VERSION &&
    (CONTROL_COMMANDS as readonly unknown[]).includes(value.command) &&
    (CONTROL_STAGES as readonly unknown[]).includes(value.stage)
  );
}

function validChange(value: unknown): value is string {
  return typeof value === "string" && CHANGE_NAME.test(value);
}

function validOperationId(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER.test(value);
}

export function validateControlCommand(
  value: unknown,
): ControlCommandValidation {
  if (!isRecord(value)) return { ok: false, code: "invalid-control-command" };
  if (
    Object.hasOwn(value, "version") &&
    value.version !== CONTROL_PROTOCOL_VERSION
  ) {
    return { ok: false, code: "unsupported-control-version" };
  }
  if (!validCommon(value)) {
    return { ok: false, code: "invalid-control-command" };
  }

  const common = ["version", "command", "stage"] as const;
  const named = [...common, "change"] as const;
  switch (value.command) {
    case "status":
      if (!hasExactKeys(value, named) || !validChange(value.change)) break;
      return {
        ok: true,
        value: structuredClone(value) as unknown as StatusControlCommand,
      };
    case "cancel":
    case "discard":
      if (
        hasExactKeys(value, [...named, "operationId"]) &&
        validChange(value.change) &&
        validOperationId(value.operationId)
      ) {
        return {
          ok: true,
          value: structuredClone(value) as unknown as ControlCommand,
        };
      }
      break;
    case "start":
      if (
        hasExactKeys(value, [...named, "operationId"], ["provisionalKey"]) &&
        validChange(value.change) &&
        validOperationId(value.operationId) &&
        (value.provisionalKey === undefined ||
          (value.stage === "abel-design" &&
            typeof value.provisionalKey === "string" &&
            SHA256.test(value.provisionalKey)))
      ) {
        return {
          ok: true,
          value: structuredClone(value) as unknown as NamedStartControlCommand,
        };
      }
      if (
        hasExactKeys(value, [...common, "provisionalKey", "operationId"]) &&
        value.stage === "abel-design" &&
        typeof value.provisionalKey === "string" &&
        SHA256.test(value.provisionalKey) &&
        validOperationId(value.operationId)
      ) {
        return {
          ok: true,
          value: structuredClone(
            value,
          ) as unknown as ProvisionalDesignStartControlCommand,
        };
      }
      break;
    case "rebind":
      if (
        hasExactKeys(value, [...named, "operationId", "routeId"]) &&
        validChange(value.change) &&
        validOperationId(value.operationId) &&
        typeof value.routeId === "string" &&
        IDENTIFIER.test(value.routeId)
      ) {
        return {
          ok: true,
          value: structuredClone(value) as unknown as RebindControlCommand,
        };
      }
      break;
    case "resume": {
      if (
        !hasExactKeys(
          value,
          [...named, "operationId"],
          ["deliveryRevision", "receiptHash"],
        ) ||
        !validChange(value.change) ||
        !validOperationId(value.operationId)
      ) {
        break;
      }
      const hasRevision = value.deliveryRevision !== undefined;
      const hasReceipt = value.receiptHash !== undefined;
      if (hasRevision !== hasReceipt) break;
      if (
        hasRevision &&
        (!Number.isSafeInteger(value.deliveryRevision) ||
          (value.deliveryRevision as number) < 1 ||
          typeof value.receiptHash !== "string" ||
          !SHA256.test(value.receiptHash))
      ) {
        break;
      }
      return {
        ok: true,
        value: structuredClone(value) as unknown as ResumeControlCommand,
      };
    }
  }
  return { ok: false, code: "invalid-control-command" };
}

export function assertControlCommand(value: unknown): ControlCommand {
  const validation = validateControlCommand(value);
  if (!validation.ok) {
    const error = new Error(validation.code);
    error.name = "ControlCommandError";
    throw error;
  }
  return validation.value;
}

export function controlRunKey(
  canonicalRootHash: string,
  stage: ControlStage,
  change: string,
): string {
  if (!SHA256.test(canonicalRootHash) || !CHANGE_NAME.test(change)) {
    throw new Error("invalid-control-run-key");
  }
  return `${canonicalRootHash}:${stage}:${change}`;
}
