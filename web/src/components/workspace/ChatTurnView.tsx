/* A conversation turn in pi-web-ui's Message composition: a meta line (speaker,
 * model, time) over a body of message text and tool cards in recorded order,
 * then the message's action bar. MIT (c) 2026 xing-shuyin.
 * Cadence: where the session forks, the user's message also carries a version
 * pager; its actions and the pager only choose what is read or where the next
 * message will continue, never send. */
import { memo, useState } from "react";
import {
  FiChevronLeft,
  FiChevronRight,
  FiCornerDownRight,
  FiEdit2,
} from "react-icons/fi";
import type { TurnSource } from "../../client/conversation-reader";
import { useT } from "../../i18n/locale";
import { StreamMarkdown } from "../rich/StreamMarkdown";
import {
  LEGACY_OMITTED_NOTICE,
  StepText,
  ToolStep,
  turnParts,
} from "./ChatSteps";
import {
  CopyMessageAction,
  MessageAction,
  MessageActions,
} from "./MessageActions";

const clock = (at: number, locale: string) =>
  new Date(at).toLocaleTimeString(locale === "zh" ? "zh-CN" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
/** Memoized: a settled turn keeps its source, so polling never re-renders it. */
export const ChatTurnView = memo(function ChatTurnView({
  turn,
  onContinue,
  onEdit,
  version = 0,
  versions = 0,
  onVersion,
  off = false,
}: {
  turn: TurnSource;
  /** Present when the next message may continue from this turn's end: it only
   * moves the composer's anchor, and that message starts a new branch there. */
  onContinue?(turnId: string): void;
  /** Present when the turn's message may be put back in the composer to be
   * rewritten: sending it starts a branch beside this turn. */
  onEdit?(turnId: string): void;
  /** This message's place (from 1) among the `versions` the session holds of
   * it; a step shows the neighbouring version's branch. */
  version?: number;
  versions?: number;
  onVersion?(turnId: string, step: -1 | 1): void;
  /** Shown, but the message being composed will not have it in its context. */
  off?: boolean;
}) {
  const { t, tx, locale } = useT();
  const { header } = turn;
  const { user, replies } = turnParts(turn.steps);
  // A whole-reply copy takes the answer's text parts in recorded order: no tool
  // card, and no failed or incomplete attempt (its own labelled block).
  const answer = replies.filter(
    ({ step }) => step.role === "assistant" && !step.error,
  );
  const live = header.status === "queued" || header.status === "running";
  // "After this turn": offered on the turn's last message, once Pi ended it.
  const continueAction = onContinue && header.entry && (
    <MessageAction
      icon={<FiCornerDownRight aria-hidden="true" />}
      label={t("Continue from here")}
      title={t(
        "Send the next message from the end of this turn. It starts a new branch there; the later turns stay on theirs and nothing is deleted.",
      )}
      showLabel
      onClick={() => onContinue(header.id)}
    />
  );
  const editAction = onEdit && !live && (
    <MessageAction
      icon={<FiEdit2 aria-hidden="true" />}
      label={t("Edit and resend")}
      title={t(
        "Put this message back in the composer. Sending it starts a new branch beside this one; nothing is deleted.",
      )}
      onClick={() => onEdit(header.id)}
    />
  );
  const [context, setContext] = useState(false);
  const { thinking, media, other } = header.omitted;
  const omitted = [
    thinking && t("Thinking is not retained."),
    media && t("Media is not retained."),
    other && t("Other content is not retained."),
  ].filter((note) => note !== false);
  const notice = header.notice
    .split("\n")
    .filter((line) => line && line !== LEGACY_OMITTED_NOTICE);
  const { execution } = header;
  // While the reply is live its last message is still being written.
  const streaming = live && replies.at(-1)?.step.role === "assistant";
  // Nothing visibly in progress: no tool call or message is being written yet.
  const waiting =
    live && !streaming && !replies.some(({ index }) => index >= header.stable);
  const time = header.at > 0 && (
    <time className="msg-time" dateTime={new Date(header.at).toISOString()}>
      {clock(header.at, locale)}
    </time>
  );
  const replied = replies.length > 0 || live || omitted.length > 0;
  return (
    <section
      className={off ? "chat-turn off-branch" : "chat-turn"}
      aria-label={
        off
          ? t("Conversation turn, not in the new message's context")
          : t("Conversation turn")
      }
    >
      {user.map(({ step, index }, position) => {
        const copyable = step.text.trim() !== "";
        const edit = position === 0 && editAction;
        // Without a reply the user's message is the turn's last.
        const branch =
          !replied && position === user.length - 1 && continueAction;
        return (
          <article className="msg msg-user" key={index}>
            <div className="msg-meta">
              <span className="msg-role">{t("You")}</span>
              {time}
              {position === 0 && versions > 1 && (
                // biome-ignore lint/a11y/useSemanticElements: a compact pager in a meta line, not a form fieldset
                <span
                  className="msg-versions"
                  role="group"
                  aria-label={t("Version {index} of {count}", {
                    index: version,
                    count: versions,
                  })}
                >
                  <button
                    type="button"
                    className="msg-version-step"
                    aria-label={t("Previous version")}
                    title={t("Previous version")}
                    disabled={!onVersion || version <= 1}
                    onClick={() => onVersion?.(header.id, -1)}
                  >
                    <FiChevronLeft aria-hidden="true" />
                  </button>
                  <span className="msg-version-count" aria-hidden="true">
                    {version}/{versions}
                  </span>
                  <button
                    type="button"
                    className="msg-version-step"
                    aria-label={t("Next version")}
                    title={t("Next version")}
                    disabled={!onVersion || version >= versions}
                    onClick={() => onVersion?.(header.id, 1)}
                  >
                    <FiChevronRight aria-hidden="true" />
                  </button>
                </span>
              )}
            </div>
            <div className="msg-body">
              <StepText turn={turn} index={index} step={step} copy={false} />
            </div>
            {/* An image-only message with no action offered has no bar. */}
            {(copyable || edit || branch) && (
              <MessageActions label={t("Message actions")}>
                {edit}
                {copyable && (
                  <CopyMessageAction turn={turn} parts={[{ step, index }]} />
                )}
                {branch}
              </MessageActions>
            )}
          </article>
        );
      })}
      {replied && (
        <article className="msg msg-assistant">
          <div className="msg-meta">
            <span className="msg-role">Cadence</span>
            {execution && (
              <button
                type="button"
                className="msg-model"
                aria-expanded={context}
                title={t("Context fixed at admission:")}
                onClick={() => setContext((shown) => !shown)}
              >
                {execution.model
                  ? `${execution.model.provider}/${execution.model.model}`
                  : t("No model")}
              </button>
            )}
            {user.length === 0 && time}
          </div>
          {execution && context && (
            <p className="msg-context">
              {t("Context fixed at admission:")} <code>{execution.cwd}</code>
              {" · "}
              {execution.model
                ? `${execution.model.provider}/${execution.model.model} · ${execution.model.thinking}`
                : t("No model")}
            </p>
          )}
          <div className="msg-body">
            {replies.map(({ step, index }, position) =>
              step.role === "tool" ? (
                <ToolStep key={index} turn={turn} index={index} step={step} />
              ) : (
                <div className="msg-part" key={index}>
                  {step.error && (
                    <span className="ep-state failed">
                      {t("Incomplete model response")}
                    </span>
                  )}
                  <StepText
                    turn={turn}
                    index={index}
                    step={step}
                    render={
                      streaming && position === replies.length - 1
                        ? (text) => <StreamMarkdown text={text} />
                        : undefined
                    }
                  />
                </div>
              ),
            )}
            {waiting && (
              <p className="msg-working" role="status">
                <span className="working-spin" aria-hidden="true" />
                {header.status === "queued" ? tx("queued") : t("Working…")}
              </p>
            )}
            {omitted.map((note) => (
              <p className="msg-omitted" key={note}>
                {note}
              </p>
            ))}
          </div>
          {/* Nothing to act on while the reply is still being written. */}
          {!live && (answer.length > 0 || continueAction) && (
            <MessageActions label={t("Message actions")}>
              {answer.length > 0 && (
                <CopyMessageAction turn={turn} parts={answer} />
              )}
              {continueAction}
            </MessageActions>
          )}
        </article>
      )}
      {header.status === "running" && header.retry && (
        <p className="inspector-note chat-turn-retry" role="status">
          {header.retry.phase === "waiting"
            ? t(
                "Upstream interrupted. Retry {attempt}/{maxAttempts} is scheduled after {seconds}s; completed tool results are kept.",
                {
                  attempt: header.retry.attempt,
                  maxAttempts: header.retry.maxAttempts,
                  seconds: Math.ceil(header.retry.delayMs / 1000),
                },
              )
            : t(
                "Retrying the model request ({attempt}/{maxAttempts}); completed tool results are kept.",
                {
                  attempt: header.retry.attempt,
                  maxAttempts: header.retry.maxAttempts,
                },
              )}
        </p>
      )}
      {notice.length > 0 && (
        <p className="inspector-note chat-turn-notice">
          {notice.map((line) => tx(line)).join("\n")}
        </p>
      )}
      {!["completed", "running", "queued"].includes(header.status) && (
        <p className={`ep-state ${header.status}`}>{tx(header.status)}</p>
      )}
    </section>
  );
});
