/** Rename and archive: two owner commands about a conversation, never a
 * message. Each is one explicit request; a lost reply is observed through the
 * next list read, never sent again. */
import {
  CONVERSATION_NAME_CHARS,
  type WorkbenchCommand,
} from "../../../src/service/contracts/workbench.ts";
import type { ServiceClient } from "../../../src/service-client.ts";

export type ConversationCommand = Extract<
  WorkbenchCommand,
  { kind: "conversation-rename" | "conversation-archive" }
>;
/** `refused`: nothing reached the owner, or it answered with no effect.
 * `unknown`: the request may have taken effect. */
export type ConversationOutcome =
  | { kind: "accepted" }
  | { kind: "refused" | "unknown"; code: string };

/** A typed name as Pi will record it: one trimmed line without control
 * characters. Null when it is longer than a name may be. Empty clears the
 * name, so the first message titles the conversation again. */
export function conversationName(draft: string): string | null {
  const name = draft.replace(/\p{Cc}+/gu, " ").trim();
  return [...name].length > CONVERSATION_NAME_CHARS ? null : name;
}
export const renameCommand = (
  conversationId: string,
  name: string,
): ConversationCommand => ({
  kind: "conversation-rename",
  commandId: crypto.randomUUID(),
  conversationId,
  name,
});
export const archiveCommand = (
  conversationId: string,
  archived: boolean,
): ConversationCommand => ({
  kind: "conversation-archive",
  commandId: crypto.randomUUID(),
  conversationId,
  archived,
});
export async function conversationCommand(
  client: Pick<ServiceClient, "workbenchCommand">,
  command: ConversationCommand,
): Promise<ConversationOutcome> {
  let reply: Awaited<ReturnType<ServiceClient["workbenchCommand"]>>;
  try {
    reply = await client.workbenchCommand(command);
  } catch {
    // The client refused the request's shape before sending anything.
    return { kind: "refused", code: "invalid" };
  }
  if (reply.kind === "ok") return { kind: "accepted" };
  return {
    kind: reply.error.effect === "none" ? "refused" : "unknown",
    code: reply.error.code,
  };
}
