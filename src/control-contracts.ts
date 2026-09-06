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

export interface RecoveryRequest {
  incidentKey: string;
  failureSequence: number;
  reason: "parent-directed-retry" | "route-changed" | "context-extended";
}

const CONTROL_SCHEMA_PROPERTIES = {
  command: {
    type: "string",
    enum: ["start", "status", "resume", "rebind", "cancel", "discard"],
  },
  stage: { type: "string", enum: ["abel-implement"] },
  change: { type: "string" },
  operationId: { type: "string" },
  deliveryRevision: { type: "integer", minimum: 1 },
  receiptHash: { type: "string" },
  routeId: { type: "string" },
  recovery: {
    type: "object",
    additionalProperties: false,
    properties: {
      incidentKey: { type: "string", pattern: "^[a-f0-9]{64}$" },
      failureSequence: { type: "integer", minimum: 1 },
      reason: {
        type: "string",
        enum: ["parent-directed-retry", "route-changed", "context-extended"],
      },
    },
    required: ["incidentKey", "failureSequence", "reason"],
  },
} as const;

type ControlSchemaField = Exclude<
  keyof typeof CONTROL_SCHEMA_PROPERTIES,
  "command"
>;

const commandSchema = (
  command: ControlCommandName,
  fields: readonly ControlSchemaField[],
) => ({
  type: "object" as const,
  properties: {
    command: { type: "string" as const, enum: [command] },
    ...Object.fromEntries(
      fields.map((field) => [field, CONTROL_SCHEMA_PROPERTIES[field]]),
    ),
  },
  required: ["command", ...fields],
  additionalProperties: false,
});

/**
 * Provider-facing schema for the closed Implement command union.
 *
 * The anyOf branches express command-specific required fields, including the
 * paired optional receipt arguments on resume. Exact keys and provider-added
 * nullable padding remain enforced by the canonicalizer and validator below.
 */
export const CONTROL_COMMAND_PARAMETERS = {
  type: "object",
  properties: CONTROL_SCHEMA_PROPERTIES,
  required: ["command", "stage", "change"],
  anyOf: [
    commandSchema("start", ["stage", "change", "operationId"]),
    commandSchema("status", ["stage", "change"]),
    commandSchema("resume", ["stage", "change", "operationId"]),
    commandSchema("resume", ["stage", "change", "operationId", "recovery"]),
    commandSchema("resume", [
      "stage",
      "change",
      "operationId",
      "deliveryRevision",
      "receiptHash",
      "recovery",
    ]),
    commandSchema("resume", [
      "stage",
      "change",
      "operationId",
      "deliveryRevision",
      "receiptHash",
    ]),
    commandSchema("rebind", ["stage", "change", "operationId", "routeId"]),
    commandSchema("cancel", ["stage", "change", "operationId"]),
    commandSchema("discard", ["stage", "change", "operationId"]),
  ],
  additionalProperties: false,
} as const;

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
  recovery?: RecoveryRequest;
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
  "recovery",
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
    "recovery",
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
          ["deliveryRevision", "receiptHash", "recovery"],
        ) ||
        !validChange(value.change) ||
        !validOperationId(value.operationId)
      ) {
        break;
      }
      if (
        value.recovery !== undefined &&
        (!isRecord(value.recovery) ||
          !hasExactKeys(value.recovery, [
            "incidentKey",
            "failureSequence",
            "reason",
          ]) ||
          typeof value.recovery.incidentKey !== "string" ||
          !SHA256.test(value.recovery.incidentKey) ||
          !Number.isSafeInteger(value.recovery.failureSequence) ||
          (value.recovery.failureSequence as number) < 1 ||
          ![
            "parent-directed-retry",
            "route-changed",
            "context-extended",
          ].includes(String(value.recovery.reason)))
      )
        break;
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
