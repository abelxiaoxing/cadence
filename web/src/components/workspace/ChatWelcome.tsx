/* Extracted from the pi-web-ui-adapted ChatWorkspace. MIT (c) 2026 xing-shuyin.
 * Presentation only, shared by folder setup and an empty conversation. */
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useT } from "../../i18n/locale";
import { Crystal } from "../../optics/Crystal";

export function ChatWelcome({
  hint,
  children,
}: {
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state chat-welcome">
      <span className="empty-logo" aria-hidden="true">
        <Crystal />
      </span>
      {hint && <p>{hint}</p>}
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
  const span = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const app = span.current?.closest(".app") as HTMLElement | null;
    if (!app) return;
    if (notice) {
      app.dataset.feedbackEvent = notice.message;
      if (notice.sequence % 2 === 0) app.dataset.feedbackReplay = "";
      else delete app.dataset.feedbackReplay;
    } else {
      delete app.dataset.feedbackEvent;
      delete app.dataset.feedbackReplay;
    }
    return () => {
      delete app.dataset.feedbackEvent;
      delete app.dataset.feedbackReplay;
    };
  }, [notice]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => {
      setNotice((visible) => (visible === notice ? null : visible));
    }, 1400);
    return () => clearTimeout(timer);
  }, [notice]);
  return (
    <span
      ref={span}
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
