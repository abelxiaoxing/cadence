/** Where the next message continues. By default that is the end of the branch
 * shown. An explicit anchor names an earlier session entry instead, so the
 * message starts a branch there: beside a message being rewritten, or after an
 * earlier turn. Setting or cancelling one is local to the composer: nothing is
 * sent, moved or deleted, and files on disk are untouched. */
import { decodeEntryId } from "../../../src/service/contracts/workbench.ts";
import type { LoadedTurn } from "./conversation-reader";

export interface SendAnchor {
  /** `edit` rewrites a message: the anchor is the entry that message continued.
   * `continue` adds a message after a turn: the anchor is that turn's end. */
  kind: "edit" | "continue";
  /** The entry the next message continues; null is the session's root. */
  entry: string | null;
  /** The turn acted on. */
  turnId: string;
  /** The first turn of the branch shown that the new context will not hold. */
  from: number;
  /** The first line of the message acted on, for the composer's strip. */
  label: string;
  /** The message had attachments that were not retained. */
  media: boolean;
  /** The draft text the composer held before, restored on Cancel. */
  stash: string;
}

/** A message's first line, as the composer's strip and the rail quote it. */
export const firstLine = (text: string): string =>
  text.trim().split("\n", 1)[0].slice(0, 200);

/** The entry a turn's user message continued, which a rewrite of that message
 * continues too. The service names it; one that predates the field leaves only
 * the previous shown turn's end to stand in, and nothing for a first message.
 * Undefined: this message cannot be rewritten from here. */
export function editHead(
  turn: Pick<LoadedTurn, "ordinal" | "header">,
  previous: Pick<LoadedTurn, "ordinal" | "header"> | undefined,
): string | null | undefined {
  if (turn.header.parent !== undefined) return turn.header.parent;
  return previous?.ordinal === turn.ordinal - 1
    ? (previous.header.entry ?? undefined)
    : undefined;
}

/** The head a Send captures: the anchor's entry, else the end of the view. */
export const sendHead = (
  anchor: Pick<SendAnchor, "entry"> | null,
  leaf: string | null,
): string | null => (anchor ? anchor.entry : leaf);

/** A turn the new context will not hold: it stays on its own branch. */
export const offBranch = (
  anchor: Pick<SendAnchor, "from"> | null,
  ordinal: number,
): boolean => anchor !== null && ordinal >= anchor.from;

/** An anchor kept with the conversation's draft, so a reload neither loses it
 * nor sends the rewritten text at the branch end. Anything unreadable is no
 * anchor. */
export function decodeAnchor(saved: string | null): SendAnchor | null {
  if (!saved) return null;
  try {
    const o = JSON.parse(saved) as Record<string, unknown>;
    if (
      (o.kind !== "edit" && o.kind !== "continue") ||
      typeof o.turnId !== "string" ||
      !Number.isSafeInteger(o.from) ||
      (o.from as number) < 0 ||
      typeof o.label !== "string" ||
      typeof o.stash !== "string"
    )
      return null;
    return {
      kind: o.kind,
      entry: o.entry === null ? null : decodeEntryId(o.entry),
      turnId: o.turnId,
      from: o.from as number,
      label: o.label,
      media: o.media === true,
      stash: o.stash,
    };
  } catch {
    return null;
  }
}
