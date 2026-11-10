/* A conversation turn in pi-web-ui's Message composition: a meta line (speaker,
 * model, time) over a body of message text, thinking blocks and tool cards in
 * recorded order, then the message's action bar. MIT (c) 2026 xing-shuyin. */
import { memo, useState } from "react";
import { FiCornerDownRight } from "react-icons/fi";
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
import { ThinkingStep } from "./ThinkingStep";

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
}: {
  turn: TurnSource;
  /** Present when this turn's end may be chosen as the branch to read: it only
   * changes what is shown, and the next message starts a new branch there. */
  onContinue?(entry: string): void;
}) {
  const { t, tx, locale } = useT();
  const { header } = turn;
  const { user, replies } = turnParts(turn.steps);
  // A whole-reply copy takes the answer's text parts in recorded order: no tool
  // card, and no failed or incomplete attempt (its own labelled block).
  const answer = replies.filter(
    ({ step }) => step.role === "assistant" && !step.error,
  );
  const { entry } = header;
  const continueAction = onContinue && entry && (
    <MessageAction
      icon={<FiCornerDownRight aria-hidden="true" />}
      label={t("Continue from here")}
      title={t(
        "Show the conversation up to the end of this turn. The next message starts a new branch there; nothing is deleted.",
      )}
      showLabel
      onClick={() => onContinue(entry)}
    />
  );
  const live = header.status === "queued" || header.status === "running";
  const [context, setContext] = useState(false);
  // Readable thinking is a block in the reply; this flag is thinking that
  // could not be read (stored unreadable, or not kept by a workflow capture).
  const { thinking, media, other } = header.omitted;
  const omitted = [
    thinking && t("Thinking that could not be read is not shown."),
    media && t("Media is not retained."),
    other && t("Other content is not retained."),
  ].filter((note) => note !== false);
  const notice = header.notice
    .split("\n")
    .filter((line) => line && line !== LEGACY_OMITTED_NOTICE);
  const { execution } = header;
  // While the reply is live its last message is still being written; a
  // thinking block or a tool card at the end is not message text.
  const streaming = live && replies.at(-1)?.step.role === "assistant";
  // Nothing visibly in progress: no tool call or message is being written yet.
  const waiting =
    live && !streaming && !replies.some(({ index }) => index >= header.stable);
  const time = header.at > 0 && (
    <time className="msg-time" dateTime={new Date(header.at).toISOString()}>
      {clock(header.at, locale)}
    </time>
  );
  return (
    <section className="chat-turn" aria-label={t("Conversation turn")}>
      {user.map(({ step, index }, position) => {
        const copyable = step.text.trim() !== "";
        const branch = position === user.length - 1 && continueAction;
        return (
          <article className="msg msg-user" key={index}>
            <div className="msg-meta">
              <span className="msg-role">{t("You")}</span>
              {time}
            </div>
            <div className="msg-body">
              <StepText turn={turn} index={index} step={step} copy={false} />
            </div>
            {/* An image-only message of the newest turn has nothing to offer. */}
            {(copyable || branch) && (
              <MessageActions label={t("Message actions")}>
                {copyable && (
                  <CopyMessageAction turn={turn} parts={[{ step, index }]} />
                )}
                {branch}
              </MessageActions>
            )}
          </article>
        );
      })}
      {(replies.length > 0 || live || omitted.length > 0) && (
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
              ) : step.role === "thinking" ? (
                <ThinkingStep
                  key={index}
                  turn={turn}
                  index={index}
                  step={step}
                />
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
          {!live && (answer.length > 0 || user.length === 0) && (
            <MessageActions label={t("Message actions")}>
              {answer.length > 0 && (
                <CopyMessageAction turn={turn} parts={answer} />
              )}
              {user.length === 0 && continueAction}
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
