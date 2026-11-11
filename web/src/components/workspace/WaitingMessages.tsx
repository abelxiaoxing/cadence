/* Adapted from pi-web-ui web/src/components/MessageList.tsx @ b627452c
 * (QueuedMessage): a message waiting for the running reply is shown as the
 * user's own row with a tag for how it was sent and actions to take it back.
 * MIT (c) 2026 xing-shuyin.
 * Cadence: the rows are what the conversation's head read states, never a
 * local guess. Taking one back is a command the service may refuse once Pi
 * holds the message, and a message its reply ended without delivering is
 * shown with its reason; nothing here sends anything again. */
import { FiCornerUpLeft, FiX } from "react-icons/fi";
import type {
  ChatAttempt,
  ChatPending,
} from "../../../../src/service/contracts/workbench.ts";
import { useT } from "../../i18n/locale";

export function WaitingMessages({
  pending,
  undelivered,
  canWithdraw,
  recallable,
  onWithdraw,
  onRestore,
}: {
  /** Sent into the reply in progress and not delivered yet, oldest first. */
  pending: readonly ChatPending[];
  /** Sent into the branch's last reply, which ended without delivering them. */
  undelivered: readonly ChatAttempt[];
  /** A withdrawal can be requested now. */
  canWithdraw: boolean;
  /** The whole text of this message is known, so it can be put back. */
  recallable(input: ChatPending): boolean;
  /** `recall` also puts the text back into the message box once withdrawn. */
  onWithdraw(input: ChatPending, recall: boolean): void;
  /** Puts an undelivered message's text into the message box; sends nothing. */
  onRestore(text: string): void;
}) {
  const { t, tx } = useT();
  if (!pending.length && !undelivered.length) return null;
  return (
    <section className="chat-waiting-list" aria-label={t("Waiting messages")}>
      {pending.map((input) => (
        <article className={`chat-waiting ${input.mode}`} key={input.commandId}>
          <header>
            <span className={`chat-waiting-tag ${input.mode}`}>
              {input.mode === "steer"
                ? t("Steering: read at the model's next step")
                : t("Queued: sent when this reply ends")}
            </span>
            <span className="chat-waiting-actions">
              {recallable(input) && (
                <button
                  type="button"
                  className="ghost icon"
                  disabled={!canWithdraw}
                  title={t("Withdraw and put back in the message box")}
                  aria-label={t("Withdraw and put back in the message box")}
                  onClick={() => onWithdraw(input, true)}
                >
                  <FiCornerUpLeft aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                className="ghost icon"
                disabled={!canWithdraw}
                title={t("Withdraw")}
                aria-label={t("Withdraw")}
                onClick={() => onWithdraw(input, false)}
              >
                <FiX aria-hidden="true" />
              </button>
            </span>
          </header>
          <p className="chat-attempt-text">{input.text}</p>
        </article>
      ))}
      {undelivered.map((input) => (
        <article
          className="chat-attempt chat-undelivered"
          key={input.commandId}
        >
          <p className="chat-attempt-text">{input.text}</p>
          <p className="inspector-note">
            <span className={`ep-state ${input.status}`}>
              {tx(input.status)}
            </span>{" "}
            {input.notice ? tx(input.notice) : t("Not delivered.")}
          </p>
          <button
            type="button"
            className="ghost"
            onClick={() => onRestore(input.text)}
          >
            <FiCornerUpLeft aria-hidden="true" />
            {t("Put back in the message box")}
          </button>
        </article>
      ))}
    </section>
  );
}
