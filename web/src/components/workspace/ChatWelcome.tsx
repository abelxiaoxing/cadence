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
  const [message, setMessage] = useState<
    "Message received" | "Conversation updated" | null
  >(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
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
    setMessage(accepted ? "Message received" : "Conversation updated");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 1400);
  }, [receipt, semantic]);
  return (
    <span
      role="status"
      className="conversation-feedback"
      data-event={message || undefined}
    >
      {message && t(message)}
    </span>
  );
}
