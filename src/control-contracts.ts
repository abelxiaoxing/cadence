// Caller-facing commands for the private Abel workflow control plane.
// Mechanical graph, snapshot, task, and apply identities are intentionally not
// part of this surface: the control plane derives them from approved delivery.

export const CONTROL_COMMANDS = [
  "start",
  "status",
  "resume",
  "rebind",
  "cancel",
  "discard",
] as const;

export const CONTROL_STAGES = ["abel-implement"] as const;

export type ControlCommandName = (typeof CONTROL_COMMANDS)[number];
export type ControlStage = (typeof CONTROL_STAGES)[number];

const IDENTIFIER = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/iu;
const CHANGE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

interface ControlBase {
  command: ControlCommandName;
  stage: ControlStage;
  change: string;
}

export interface StartControlCommand extends ControlBase {
  command: "start";
  operationId: string;
}

export interface StatusControlCommand extends ControlBase {
  command: "status";
}

export interface ResumeControlCommand extends ControlBase {
  command: "resume";
  operationId: string;
  deliveryRevision?: number;
  receiptHash?: string;
}

export interface RebindControlCommand extends ControlBase {
  command: "rebind";
  operationId: string;
  routeId: string;
}

export interface CancelControlCommand extends ControlBase {
  command: "cancel";
  operationId: string;
}

export interface DiscardControlCommand extends ControlBase {
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
  | { ok: false; code: "invalid-control-command" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const CONTROL_TOOL_FIELDS = new Set([
  "command",
  "stage",
  "change",
  "operationId",
  "deliveryRevision",
  "receiptHash",
  "routeId",
]);

const COMMAND_FIELDS: Readonly<
  Record<ControlCommandName, ReadonlySet<string>>
> = Object.freeze({
  start: new Set(["command", "stage", "change", "operationId"]),
  status: new Set(["command", "stage", "change"]),
  resume: new Set([
    "command",
    "stage",
    "change",
    "operationId",
    "deliveryRevision",
    "receiptHash",
  ]),
  rebind: new Set(["command", "stage", "change", "operationId", "routeId"]),
  cancel: new Set(["command", "stage", "change", "operationId"]),
  discard: new Set(["command", "stage", "change", "operationId"]),
});

/**
 * Adapts Pi/provider strict-schema padding to the closed command union.
 * Known fields belonging to a different command are projected away, while
 * unknown fields and fields owned by the selected command remain available to
 * the strict validator and therefore cannot bypass its exact-key/type checks.
 */
export function canonicalizeControlCommandToolInput(value: unknown): unknown {
  if (
    !isRecord(value) ||
    !(CONTROL_COMMANDS as readonly unknown[]).includes(value.command)
  ) {
    return value;
  }
  const command = value.command as ControlCommandName;
  const allowed = COMMAND_FIELDS[command];
  const canonical = Object.create(null) as Record<string, unknown>;
  for (const [key, entry] of Object.entries(value)) {
    if (CONTROL_TOOL_FIELDS.has(key) && !allowed.has(key)) continue;
    if (
      command === "resume" &&
      (key === "deliveryRevision" || key === "receiptHash") &&
      (entry === null || entry === undefined)
    ) {
      continue;
    }
    canonical[key] = entry;
  }
  return canonical;
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
  if (!validCommon(value)) {
    return { ok: false, code: "invalid-control-command" };
  }

  const common = ["command", "stage", "change"] as const;
  switch (value.command) {
    case "status":
      if (!hasExactKeys(value, common) || !validChange(value.change)) break;
      return {
        ok: true,
        value: structuredClone(value) as unknown as StatusControlCommand,
      };
    case "cancel":
    case "discard":
      if (
        hasExactKeys(value, [...common, "operationId"]) &&
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
        hasExactKeys(value, [...common, "operationId"]) &&
        validChange(value.change) &&
        validOperationId(value.operationId)
      ) {
        return {
          ok: true,
          value: structuredClone(value) as unknown as StartControlCommand,
        };
      }
      break;
    case "rebind":
      if (
        hasExactKeys(value, [...common, "operationId", "routeId"]) &&
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
          [...common, "operationId"],
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
