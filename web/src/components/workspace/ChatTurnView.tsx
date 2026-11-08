/* Extracted from the pi-web-ui-adapted ChatWorkspace presentation. MIT (c) 2026 xing-shuyin. */
import { memo } from "react";
import type { TurnSource } from "../../client/conversation-reader";
import { useT } from "../../i18n/locale";
import { StreamMarkdown } from "../rich/StreamMarkdown";
import {
  ChatSteps,
  LEGACY_OMITTED_NOTICE,
  StepText,
  turnParts,
} from "./ChatSteps";
/** Memoized: a settled turn keeps its source, so polling never re-renders it. */
export const ChatTurnView = memo(function ChatTurnView({
  turn,
  toggled,
  onToggle,
}: {
  turn: TurnSource;
  /** The user's choice for this turn's steps, kept across remounts. */
  toggled?: boolean | null;
  onToggle?(turnId: string, open: boolean): void;
}) {
  const { t, tx } = useT();
  const { header } = turn;
  const { user, steps, answer } = turnParts(turn.steps);
  const live = header.status === "running" && answer.length === 0;
  const grouped =
    steps.length > 0 || live || Object.values(header.omitted).some(Boolean);
  const notice = header.notice
    .split("\n")
    .filter((line) => line && line !== LEGACY_OMITTED_NOTICE);
  return (
    <section className="chat-turn" aria-label={t("Conversation turn")}>
      {user.map(({ step, index }) => (
        <article className="chat-message user" key={index}>
          <div className="chat-message-role">{t("You")}</div>
          <StepText turn={turn} index={index} step={step} />
        </article>
      ))}
      {(grouped || answer.length > 0) && (
        <article className="chat-message assistant">
          <div className="chat-message-role">Cadence</div>
          {grouped && (
            <ChatSteps
              turn={turn}
              steps={steps}
              live={live}
              answered={answer.length > 0}
              toggled={toggled}
              onToggle={(open) => onToggle?.(header.id, open)}
            />
          )}
          {answer.map(({ step, index }) => (
            <StepText
              key={index}
              turn={turn}
              index={index}
              step={step}
              render={
                header.status === "running"
                  ? (text) => <StreamMarkdown text={text} />
                  : undefined
              }
            />
          ))}
        </article>
      )}
      {header.execution && (
        <details className="inspector-note">
          <summary>{t("Context fixed at admission:")}</summary>
          <p>
            <code>{header.execution.cwd}</code> ·{" "}
            {header.execution.model
              ? `${header.execution.model.provider}/${header.execution.model.model} · ${header.execution.model.thinking}`
              : t("No model")}
          </p>
        </details>
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
