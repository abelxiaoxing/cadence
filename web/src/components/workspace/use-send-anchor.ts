/* The composer's anchor (see client/conversation-anchor.ts) with what moving
 * it does to the draft: the draft the composer held is set aside, a rewritten
 * message's text and images are read back into it, and releasing the anchor
 * brings the earlier draft back. Local state only: nothing here sends, and
 * images stay in memory like every unsent image. */
import { type RefObject, useEffect, useRef, useState } from "react";
import type { ChatImage } from "../../../../src/service/contracts/workbench.ts";
import {
  decodeAnchor,
  editHead,
  firstLine,
  type SendAnchor,
} from "../../client/conversation-anchor";
import type { LoadedTurn } from "../../client/conversation-reader";
import { turnParts } from "./ChatSteps";
import { messageText } from "./MessageActions";

const IMAGE_SUFFIX: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
/** A recorded image as a draft image: the same bytes, uploaded again on Send. */
const draftImage = (blob: Blob, image: ChatImage, index: number) =>
  new File(
    [blob],
    `image-${index + 1}.${IMAGE_SUFFIX[image.mimeType] ?? "img"}`,
    { type: image.mimeType },
  );

export function useSendAnchor({
  draftKey,
  draft,
  setDraft,
  images,
  alive,
  onUnread,
}: {
  /** The conversation's draft namespace: the anchor is kept beside the text,
   * so a reload neither loses it nor sends a rewritten message at the branch
   * end. */
  draftKey: string;
  draft: string;
  setDraft(next: string | ((value: string) => string)): void;
  images: {
    files: readonly File[];
    add(files: File[]): void;
    replace(files: readonly File[]): void;
  };
  alive: RefObject<boolean>;
  /** Part of a rewritten message could not be read back into the draft. */
  onUnread(): void;
}) {
  const [anchor, setAnchor] = useState<SendAnchor | null>(() => {
    try {
      return decodeAnchor(sessionStorage.getItem(`${draftKey}:anchor`));
    } catch {
      return null;
    }
  });
  const now = useRef(anchor);
  now.current = anchor;
  useEffect(() => {
    try {
      if (anchor)
        sessionStorage.setItem(`${draftKey}:anchor`, JSON.stringify(anchor));
      else sessionStorage.removeItem(`${draftKey}:anchor`);
    } catch {
      /* The anchor still applies in memory. */
    }
  }, [draftKey, anchor]);
  // The image drafts set aside with `anchor.stash`.
  const stashed = useRef<readonly File[]>([]);
  // The rewritten message's whole text and images being read back: Send waits
  // for them, and Cancel or another anchor abandons them.
  const reading = useRef<AbortController | null>(null);
  const [attaching, setAttaching] = useState(false);
  const stopReading = () => {
    reading.current?.abort();
    reading.current = null;
    setAttaching(false);
  };

  /** Back to the end of the view, with the draft that was set aside: Cancel, a
   * change of the branch shown, or the anchor's own Send being accepted. */
  const release = () => {
    stopReading();
    const held = now.current;
    if (!held) return;
    now.current = null;
    setAnchor(null);
    setDraft(held.stash);
    images.replace(stashed.current);
    stashed.current = [];
  };
  const move = (
    turn: LoadedTurn,
    kind: SendAnchor["kind"],
    entry: string | null,
  ) => {
    stopReading();
    // The first anchor sets the composer's own draft aside; moving the anchor
    // keeps that one, not the text of the message being given up.
    const held = now.current;
    if (!held) stashed.current = images.files;
    const first = turnParts(turn.steps).user[0];
    const next: SendAnchor = {
      kind,
      entry,
      turnId: turn.header.id,
      from: kind === "edit" ? turn.ordinal : turn.ordinal + 1,
      label: firstLine(first?.step.text ?? ""),
      media: kind === "edit" && turn.header.omitted.media,
      stash: held ? held.stash : draft,
    };
    now.current = next;
    setAnchor(next);
    images.replace([]);
    return first;
  };
  /** The next message continues from this turn's end, on an empty draft.
   * False when Pi has not ended the turn. */
  const continueAfter = (turn: LoadedTurn): boolean => {
    if (!turn.header.entry) return false;
    move(turn, "continue", turn.header.entry);
    setDraft("");
    return true;
  };
  /** The turn's message goes back into the draft, to be sent beside it. False
   * when the entry it continued is not known (see `editHead`). */
  const edit = (
    turn: LoadedTurn,
    previous: LoadedTurn | undefined,
  ): boolean => {
    const entry = editHead(turn, previous);
    if (entry === undefined) return false;
    const first = move(turn, "edit", entry);
    setDraft(first?.step.text ?? "");
    if (!first) return true;
    // The listed text may be a prefix, and the images are read back as bytes.
    const preview = first.step.text;
    const recorded = first.step.images ?? [];
    const read = new AbortController();
    const whole = messageText(turn, [first], read.signal);
    if (typeof whole === "string" && !recorded.length) return true;
    reading.current = read;
    setAttaching(true);
    const { image } = turn;
    void Promise.allSettled([
      whole,
      ...recorded.map((descriptor, index) =>
        image
          ? image(descriptor, read.signal).then((blob) =>
              draftImage(blob, descriptor, index),
            )
          : Promise.reject(new Error("unavailable")),
      ),
    ]).then(([text, ...files]) => {
      if (read.signal.aborted || !alive.current) return;
      reading.current = null;
      setAttaching(false);
      if (text.status === "fulfilled")
        setDraft((value) =>
          value === preview ? (text.value as string) : value,
        );
      const drafts = files.flatMap((file) =>
        file.status === "fulfilled" ? [file.value as File] : [],
      );
      try {
        if (drafts.length) images.add(drafts);
      } catch {
        drafts.length = 0;
      }
      if (text.status === "rejected" || drafts.length < recorded.length)
        onUnread();
    });
    return true;
  };
  return {
    anchor,
    /** The anchor as of now, for callers that outlive one render. */
    current: () => now.current,
    /** A rewritten message's text or images are still being read back. */
    attaching,
    release,
    continueAfter,
    edit,
  };
}
