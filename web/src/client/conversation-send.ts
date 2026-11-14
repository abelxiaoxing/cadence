/** One explicit user's message, pinned before startup or model selection awaits.
 * A continuation adds only the freshly observed model version, never a new
 * conversation head, control revision, text or command identity. */
import { abortScope } from "../../../src/abort-scope.ts";
import {
  ContractError,
  canonicalJson,
  decodeId,
  integer,
  text,
} from "../../../src/service/contracts/core.ts";
import {
  decodeModelSelector,
  type ModelSelector,
} from "../../../src/service/contracts/domain.ts";
import {
  type ChoiceVersion,
  type ConversationLocation,
  catalogOffers,
  decodeConversationLocation,
  type ModelCatalog,
} from "../../../src/service/contracts/models.ts";
import {
  CONVERSATION_SEND_BYTES,
  decodeEntryId,
  decodeSessionId,
  decodeWorkbenchCommand,
  type WorkbenchCommand,
} from "../../../src/service/contracts/workbench.ts";
import type { ServiceClient } from "../../../src/service-client.ts";

type Intent =
  | Omit<Extract<WorkbenchCommand, { kind: "send" }>, "model">
  | Omit<Extract<WorkbenchCommand, { kind: "cadence-send" }>, "model">
  | Extract<WorkbenchCommand, { kind: "cadence-exit" }>;
export interface PendingSend {
  readonly text: string;
  readonly images: readonly File[];
  readonly location?: ConversationLocation;
  readonly model?: ModelSelector;
  /** Explicit local preselection, installed only by this Send. */
  readonly installModel?: boolean;
  /** A waiting Send may continue only this prepared owner, never start another. */
  readonly preparedEpoch?: string;
  readonly command: Readonly<Intent>;
}
/** Same finite startup reporting budget as native on-demand entry. It never
 * kills a service or cancels work; no message has been dispatched at this stage. */
export const SEND_PREPARATION_MS = 20_000;
export type PreparationStage = "not-dispatched" | "dispatched" | "confirmed";
export type PreparationProgress = (
  stage: Exclude<PreparationStage, "not-dispatched">,
) => void;
export type PrepareExecution = (
  signal: AbortSignal,
  location?: ConversationLocation,
  progress?: PreparationProgress,
) => Promise<void>;

/** One budget covers the gateway read, prepare POST/body and fresh attachment. */
export async function waitForPreparation(
  prepare: PrepareExecution,
  departure: AbortSignal,
  location: ConversationLocation | undefined,
  progress: PreparationProgress,
): Promise<void> {
  const scope = abortScope([departure], SEND_PREPARATION_MS);
  try {
    if (scope.signal.aborted) throw scope.signal.reason;
    await prepare(scope.signal, location, progress);
  } finally {
    scope.dispose();
  }
}

export function unsentMessage(stage: PreparationStage, effect?: string) {
  if (effect === "none")
    return "Execution preparation was refused with no effect ({code}). This attempt started no execution service; the message was not sent and its draft is kept.";
  switch (stage) {
    case "dispatched":
      return "Preparation outcome is unknown ({code}); an execution service may have started. The message was not sent and its draft is kept.";
    case "confirmed":
      return "Execution preparation was confirmed, but the message was not sent ({code}). Its draft is kept.";
    default:
      return "The message was not sent ({code}). Its draft is kept.";
  }
}
export function preparationEffect(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("effect" in error))
    return undefined;
  return ["none", "accepted", "uncertain"].includes(String(error.effect))
    ? String(error.effect)
    : undefined;
}
export function sendFailureMessage(effect?: string) {
  return effect === "none"
    ? "The message was not accepted ({code}). Its draft is kept."
    : "Send outcome is unknown ({code}). Observe the original command before sending again; no automatic retry.";
}

/** The only final dispatch. Uncertain replies retain the original ID for
 * observation, never a replacement ID or an automatic second command. */
export async function dispatchSend(
  client: Pick<ServiceClient, "workbenchCommand">,
  command: ReturnType<typeof sendCommand>,
  pending: (id: string) => void,
) {
  pending(command.commandId);
  const reply = await client.workbenchCommand(command);
  if (reply.kind === "ok" || reply.error.effect === "none") pending("");
  return reply;
}
export function captureSend(input: {
  id: string;
  head: string | null;
  text: string;
  images?: readonly File[];
  revision: number;
  intent: "ordinary" | "enter" | "message" | "exit";
  location?: ConversationLocation;
  model?: ModelSelector;
  installModel?: boolean;
}): PendingSend {
  const common = {
    commandId: crypto.randomUUID(),
    conversationId: decodeSessionId(input.id),
    head: input.head === null ? null : decodeEntryId(input.head),
  };
  const location = input.location
    ? decodeConversationLocation(input.location)
    : undefined;
  if (location && location.id !== common.conversationId)
    throw new ContractError("stale");
  const message = text(
    input.text,
    CONVERSATION_SEND_BYTES,
    !input.images?.length,
  );
  const command: Intent =
    input.intent === "exit"
      ? {
          kind: "cadence-exit",
          ...(location ? { location } : {}),
          ...common,
          revision: integer(input.revision, 0),
        }
      : input.intent === "ordinary"
        ? { kind: "send", ...common, text: message }
        : {
            kind: "cadence-send",
            ...common,
            text: message,
            intent: input.intent,
            revision: integer(input.revision, 0),
          };
  return Object.freeze({
    text: message,
    ...(input.installModel ? { installModel: true } : {}),
    images: Object.freeze([...(input.images ?? [])]),
    command: Object.freeze(command),
    ...(location ? { location: Object.freeze(location) } : {}),
    ...(input.model ? { model: Object.freeze(selector(input.model)) } : {}),
  });
}
export function selector(model: ModelSelector): ModelSelector {
  return decodeModelSelector({
    provider: model.provider,
    model: model.model,
    api: model.api,
    thinking: model.thinking,
  });
}
export function withSendModel(
  intent: PendingSend,
  model: ModelSelector,
): PendingSend {
  return Object.freeze({ ...intent, model: Object.freeze(selector(model)) });
}
export function assertSendModel(
  intent: PendingSend,
  model: ModelSelector,
): void {
  if (
    intent.model &&
    canonicalJson(intent.model) !== canonicalJson(selector(model))
  )
    throw new ContractError("stale");
}
/** A model choice completes one original Send; no new message/head/ID is captured. */
export function waitingModelSend(
  intent: PendingSend,
  epoch: string,
): PendingSend {
  return Object.freeze({ ...intent, preparedEpoch: decodeId(epoch) });
}
export function chooseWaitingModel(
  intent: PendingSend,
  choice: ModelSelector,
  installed: boolean,
): PendingSend {
  return Object.freeze({
    ...withSendModel(intent, choice),
    installModel: !installed,
  });
}
export function modelWaitDisposition(
  intent: PendingSend,
  availability: { status: string; epoch?: string },
): "wait" | "ready" | "cancel" {
  if (!intent.preparedEpoch) return "cancel";
  if (availability.status === "ready")
    return availability.epoch === intent.preparedEpoch ? "ready" : "cancel";
  return ["stopped", "not-started"].includes(availability.status)
    ? "cancel"
    : "wait";
}
/** Exit changes mode, not model preference. Unknown/older receipts keep the draft. */
export function modelDraftConsumed(
  commandId: string,
  modelCommandId: string,
): boolean {
  return !!commandId && commandId === modelCommandId;
}

/** Apply only an explicit preselection captured by this Send. A preview is
 * never authority: the current live catalog must offer the exact selector. */
export async function installSendModel(
  client: Pick<ServiceClient, "chooseModel" | "models">,
  intent: PendingSend,
  catalog: ModelCatalog,
  current: () => boolean,
): Promise<ModelCatalog> {
  if (!current()) throw new ContractError("stale");
  if (!intent.installModel || !intent.model) return catalog;
  if (!catalogOffers(catalog.entries, intent.model))
    throw new ContractError("unsupported-context");
  if (
    catalog.selected &&
    canonicalJson(selector(catalog.selected)) === canonicalJson(intent.model)
  )
    return catalog;
  const chosen = await client.chooseModel(
    { expected: catalog.version, choice: intent.model },
    intent.location,
  );
  if (!current()) throw new ContractError("stale");
  if (chosen.kind === "error") throw new ContractError(chosen.error.code);
  const observed = await client.models(undefined, intent.location);
  if (!current()) throw new ContractError("stale");
  if (observed.kind === "error") throw new ContractError(observed.error.code);
  if (
    !observed.value.selected ||
    canonicalJson(observed.value.version) !==
      canonicalJson(chosen.value.version) ||
    canonicalJson(observed.value.selected) !==
      canonicalJson(chosen.value.selected)
  )
    throw new ContractError("stale");
  assertSendModel(intent, observed.value.selected);
  return observed.value;
}
export function sendCommand(
  intent: PendingSend,
  model?: ChoiceVersion,
): Extract<
  WorkbenchCommand,
  { kind: "send" | "cadence-send" | "cadence-exit" }
> {
  if (
    intent.location &&
    intent.command.kind !== "cadence-exit" &&
    canonicalJson(intent.location) !==
      canonicalJson(model?.conversation ?? null)
  )
    throw new ContractError("stale");
  if (
    intent.preparedEpoch &&
    intent.command.kind !== "cadence-exit" &&
    model?.epoch !== intent.preparedEpoch
  )
    throw new ContractError("stale");
  const command = decodeWorkbenchCommand(
    intent.command.kind === "cadence-exit"
      ? intent.command
      : { ...intent.command, model },
  );
  if (
    command.kind !== "send" &&
    command.kind !== "cadence-send" &&
    command.kind !== "cadence-exit"
  )
    throw new ContractError("invalid");
  return command;
}
/** Retain the original draft namespace when upgrading existing conversations.
 * Reading never copies/deletes old browser data; newly selected directories use
 * their stable key even before a history identity has been created. */
export function draftKey(
  workspaceId: string,
  id: string,
  ...legacyWorkspaceIds: (string | undefined)[]
): string {
  const primary = `cadence:draft:${workspaceId}:${id}`;
  try {
    const exists = (key: string) =>
      [key, `${key}:pending`, `${key}:mode`].some(
        (k) => sessionStorage.getItem(k) !== null,
      );
    if (exists(primary)) return primary;
    for (const namespace of legacyWorkspaceIds) {
      if (!namespace) continue;
      const legacy = `cadence:draft:${namespace}:${id}`;
      if (exists(legacy)) return legacy;
    }
  } catch {
    /* Browser storage is advisory. */
  }
  return primary;
}
