/* Extracted from the pi-web-ui-adapted ChatWorkspace. MIT (c) 2026 xing-shuyin.
 * Presentation only, shared by folder setup and an empty conversation. */
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useT } from "../../i18n/locale";
import { Crystal } from "../../optics/Crystal";

export function ChatWelcome({
  hint,
  children,
  onStart,
}: {
  hint?: string;
  onStart?(prompt: string): void;
  children?: ReactNode;
}) {
  const { t } = useT();
  return (
    <div className="empty-state chat-welcome">
      <span className="empty-logo" aria-hidden="true">
        <Crystal />
      </span>
      <h2>{t("What would you like to work on?")}</h2>
      {hint && <p>{hint}</p>}
      {onStart && (
        <div className="entry-starters">
          {(["Explain this project", "Help me plan a change"] as const).map(
            (prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => onStart(t(prompt))}
              >
                {t(prompt)}
              </button>
            ),
          )}
        </div>
      )}
      {children}
    </div>
  );
}

/** Initial/recovered observations establish a baseline, never a notification.
 * This component is mounted only for the displayed, readable conversation.
 * Neither polling objects nor elapsed time enter its comparison. */
export function ConversationFeedback({
  receipt,
  semantic,
}: {
  receipt: string;
  semantic?: string;
}) {
  const { t } = useT();
  const prior = useRef({ receipt, semantic });
  const [notice, setNotice] = useState<{
    message: "Message received" | "Conversation updated";
    sequence: number;
    count: number;
  } | null>(null);
  useEffect(() => {
    const last = prior.current;
    prior.current = { receipt, semantic };
    // The Send receipt does not depend on the mode read. Losing or regaining
    // a semantic baseline neither announces an event nor interrupts its timer.
    const accepted = !!receipt && last.receipt !== receipt;
    const changed =
      semantic !== undefined &&
      last.semantic !== undefined &&
      semantic !== last.semantic;
    if (!accepted && !changed) return;
    const message = accepted ? "Message received" : "Conversation updated";
    setNotice((visible) => ({
      message,
      sequence: (visible?.sequence ?? 0) + 1,
      count: visible?.message === message ? visible.count + 1 : 1,
    }));
  }, [receipt, semantic]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => {
      setNotice((visible) => (visible === notice ? null : visible));
    }, 1400);
    return () => clearTimeout(timer);
  }, [notice]);
  return (
    <span
      role="status"
      className="conversation-feedback"
      data-event={notice?.message}
      data-replay={notice && notice.sequence % 2 === 0 ? "" : undefined}
    >
      {notice &&
        (notice.count === 1
          ? t(notice.message)
          : t(
              notice.message === "Message received"
                ? "{count} messages received"
                : "Conversation updated {count} times",
              { count: notice.count },
            ))}
    </span>
  );
}
