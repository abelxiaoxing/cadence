/** Messages sent into a reply that is running: whether one may be offered,
 * the two commands, and what a command's reply settled. Pure; the conversation
 * decides when to call and what to do with the text typed. */
import {
  type ChatSummary,
  PENDING_TEXT_BYTES,
  WAITING_INPUTS,
  type WorkbenchCommand,
} from "../../../src/service/contracts/workbench.ts";

export type InputMode = "steer" | "queue";
type Live = NonNullable<ChatSummary["live"]>;

/** Why the text typed cannot go into the running reply, in the order a user
 * can do something about it; null when it can. Such a message has no image,
 * changes no mode and continues no other entry than the reply's own. */
export type InputRefusal = "images" | "mode" | "anchor" | "full";
export function inputRefusal(o: {
  images: number;
  /** The text would turn Cadence mode on or off if it were sent as a Send. */
  modeChange: boolean;
  anchored: boolean;
  waiting: number;
}): InputRefusal | null {
  if (o.images > 0) return "images";
  if (o.modeChange) return "mode";
  if (o.anchored) return "anchor";
  return o.waiting >= WAITING_INPUTS ? "full" : null;
}

export function inputCommand(
  conversationId: string,
  live: Pick<Live, "commandId" | "epoch">,
  mode: InputMode,
  text: string,
  commandId: string = crypto.randomUUID(),
): Extract<WorkbenchCommand, { kind: "conversation-input" }> {
  return {
    kind: "conversation-input",
    commandId,
    conversationId,
    turnId: live.commandId,
    epoch: live.epoch,
    mode,
    text,
  };
}
export function withdrawCommand(
  conversationId: string,
  live: Pick<Live, "commandId" | "epoch">,
  inputId: string,
  commandId: string = crypto.randomUUID(),
): Extract<WorkbenchCommand, { kind: "conversation-input-cancel" }> {
  return {
    kind: "conversation-input-cancel",
    commandId,
    conversationId,
    turnId: live.commandId,
    epoch: live.epoch,
    inputId,
  };
}

/** Whether a waiting message's stated text is surely all of it: the head read
 * states at most `PENDING_TEXT_BYTES` of a message, so only a text clearly
 * below that can be put back into the message box as the message it was. */
export function wholePendingText(text: string): boolean {
  return (
    new TextEncoder().encode(JSON.stringify(text)).length <=
    PENDING_TEXT_BYTES - 8
  );
}

/** What a command's reply settled: it was taken; it was refused and nothing
 * changed; or neither is known, so the next read decides and nothing is sent
 * again in its place. */
export type InputOutcome =
  | { kind: "accepted" }
  | { kind: "refused"; code: string }
  | { kind: "unknown"; code: string };
export function inputOutcome(
  reply:
    | { kind: "ok" }
    | { kind: "error"; error: { code: string; effect?: string } },
): InputOutcome {
  if (reply.kind === "ok") return { kind: "accepted" };
  return reply.error.effect === "none"
    ? { kind: "refused", code: reply.error.code }
    : { kind: "unknown", code: reply.error.code };
}
