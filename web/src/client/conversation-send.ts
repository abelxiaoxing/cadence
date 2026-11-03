/** One explicit user's message, pinned before startup or model selection awaits.
 * A continuation adds only the freshly observed model version, never a new
 * conversation head, control revision, text or command identity. */
import {
  ContractError,
  canonicalJson,
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
  decodeConversationLocation,
} from "../../../src/service/contracts/models.ts";
import {
  CONVERSATION_SEND_BYTES,
  decodeEntryId,
  decodeSessionId,
  decodeWorkbenchCommand,
  type WorkbenchCommand,
} from "../../../src/service/contracts/workbench.ts";

type Intent =
  | Omit<Extract<WorkbenchCommand, { kind: "send" }>, "model">
  | Omit<Extract<WorkbenchCommand, { kind: "cadence-send" }>, "model">
  | Extract<WorkbenchCommand, { kind: "cadence-exit" }>;
export interface PendingSend {
  readonly text: string;
  readonly location?: ConversationLocation;
  readonly model?: ModelSelector;
  readonly command: Readonly<Intent>;
}
/** Same finite startup reporting budget as native on-demand entry. It never
 * kills a service or cancels work; no message has been dispatched at this stage. */
export const SEND_PREPARATION_MS = 20_000;
export function captureSend(input: {
  id: string;
  head: string | null;
  text: string;
  revision: number;
  intent: "ordinary" | "enter" | "message" | "exit";
  location?: ConversationLocation;
  model?: ModelSelector;
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
  const message = text(input.text, CONVERSATION_SEND_BYTES, true);
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
export function sendCommand(
  intent: PendingSend,
  model?: ChoiceVersion,
): WorkbenchCommand {
  if (
    intent.location &&
    intent.command.kind !== "cadence-exit" &&
    canonicalJson(intent.location) !==
      canonicalJson(model?.conversation ?? null)
  )
    throw new ContractError("stale");
  return decodeWorkbenchCommand(
    intent.command.kind === "cadence-exit"
      ? intent.command
      : { ...intent.command, model },
  );
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
