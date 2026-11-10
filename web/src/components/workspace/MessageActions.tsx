/* Adapted from pi-web-ui web/src/components/Message.tsx @ b627452c: the
 * `.msg-actions` bar under a message and its whole-message copy.
 * MIT (c) 2026 xing-shuyin.
 * Cadence: the bar is revealed on hover or focus and always shown on touch
 * screens. No action slots, context menu, speech, image export, delete or fork;
 * an action here only copies or navigates, never sends. */
import type { ReactNode } from "react";
import { FiCheck, FiCopy } from "react-icons/fi";
import type { TurnSource } from "../../client/conversation-reader";
import { useT } from "../../i18n/locale";
import { notify } from "../../layout/toasts";
import { useCopyFeedback } from "../../rich/use-copy-feedback";
import type { IndexedStep } from "./ChatSteps";

/** The text a message's copy action takes: its text parts in recorded order,
 * a blank line between them. A clipped part that can no longer change is read
 * whole; one still being written has only its listed preview. */
export function messageText(
  turn: TurnSource,
  parts: readonly IndexedStep[],
  signal: AbortSignal,
): string | Promise<string> {
  const join = (texts: readonly string[]) =>
    texts.filter((text) => text.trim() !== "").join("\n\n");
  const whole = ({ step, index }: IndexedStep) =>
    step.clipped && index < turn.header.stable;
  // Nothing to read: stay synchronous, inside the click that asked for it.
  if (!parts.some(whole)) return join(parts.map(({ step }) => step.text));
  return Promise.all(
    parts.map((part) =>
      whole(part)
        ? turn
            .detail(part.index, part.step.parts, signal)
            .then((item) => item.text)
        : part.step.text,
    ),
  ).then(join);
}

export function MessageActions({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a toolbar-like group of buttons, not a form fieldset
    <div className="msg-actions" role="group" aria-label={label}>
      {children}
    </div>
  );
}

export function MessageAction({
  icon,
  label,
  title = label,
  showLabel = false,
  done = false,
  onClick,
}: {
  icon: ReactNode;
  /** The accessible name, and the visible text when `showLabel`. */
  label: string;
  title?: string;
  showLabel?: boolean;
  done?: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      className={`msg-action${showLabel ? " labelled" : ""}${done ? " done" : ""}`}
      title={title}
      aria-label={label}
      onClick={onClick}
    >
      {icon}
      {showLabel && <span className="msg-action-label">{label}</span>}
    </button>
  );
}

/** Copies a whole message. The check glyph is the success; a failure is a toast. */
export function CopyMessageAction({
  turn,
  parts,
}: {
  turn: TurnSource;
  parts: readonly IndexedStep[];
}) {
  const { t } = useT();
  const { copied, copy } = useCopyFeedback();
  return (
    <MessageAction
      icon={
        copied ? <FiCheck aria-hidden="true" /> : <FiCopy aria-hidden="true" />
      }
      label={t("Copy message")}
      done={copied}
      onClick={() => {
        const failed = () => notify("error", t("Copy unavailable"));
        const write = (text: string) =>
          copy(text).then((ok) => {
            if (!ok) failed();
          });
        const text = messageText(turn, parts, new AbortController().signal);
        void (typeof text === "string"
          ? write(text)
          : text.then(write, failed));
      }}
    />
  );
}
