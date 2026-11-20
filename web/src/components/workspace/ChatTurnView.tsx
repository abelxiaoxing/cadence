/* A conversation turn in pi-web-ui's Message composition: a meta line (speaker,
 * model, time) over a body of message text, thinking blocks and tool cards in
 * recorded order, with the reply's action bar in its byline. MIT (c) 2026 xing-shuyin.
 * Cadence: where the session forks, the user's message also carries a version
 * pager; its actions and the pager only choose what is read or where the next
 * message will continue, never send. */
import { memo, useLayoutEffect, useRef, useState } from "react";
import {
  FiChevronLeft,
  FiChevronRight,
  FiCornerDownRight,
  FiEdit2,
  FiLayers,
} from "react-icons/fi";
import { type TurnSource, unsettled } from "../../client/conversation-reader";
import { useT } from "../../i18n/locale";
import { StreamMarkdown } from "../StreamMarkdown";
import { CollapsibleHead } from "../transcript/CollapsibleHead";
import {
  type IndexedStep,
  LEGACY_OMITTED_NOTICE,
  StepText,
  ThinkingStep,
  ToolStep,
  turnParts,
} from "./ChatSteps";
import {
  CopyMessageAction,
  MessageAction,
  MessageActions,
} from "./MessageActions";
import { traceGroups } from "./trace-groups";
import { stepActive } from "./turn-source";
import "./trace-groups.css";

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
  reading = false,
  expandedSteps,
  onExpandSteps,
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
  /** The transcript reader left follow mode. */
  reading?: boolean;
  /** Only an explicit group disclosure survives a windowed turn's unmount. */
  expandedSteps?: ReadonlySet<string>;
  onExpandSteps?(turnId: string, steps: ReadonlySet<string>): void;
}) {
  const { t, tx, locale } = useT();
  const { header } = turn;
  const { user, replies } = turnParts(turn.steps);
  // A whole-reply copy takes the answer's text parts in recorded order: no tool
  // card, and no failed or incomplete attempt (its own labelled block).
  const answer = replies.filter(
    ({ step }) => step.role === "assistant" && !step.error,
  );
  const live = unsettled(header.status);
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
  // Stable is a read-cache boundary, never evidence of model/tool activity.
  const waiting = live && !replies.some(({ step }) => stepActive(step));
  const time = header.at > 0 && (
    <time className="msg-time" dateTime={new Date(header.at).toISOString()}>
      {clock(header.at, locale)}
    </time>
  );
  const replied = replies.length > 0 || live || omitted.length > 0;
  // Remember steps, not a group's changing bounds. A newly settled call can
  // join two groups without closing a detail or reparenting its focused row.
  const [kept, setKept] = useState<ReadonlySet<string>>(() => new Set());
  const [focusedHead, setFocusedHead] = useState<string>();
  const replyBody = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState<ReadonlySet<string>>(() => new Set());
  // Watch only individually displayed rows while not following. When a new
  // result would group them, keep their exact flat layout until they leave
  // the viewport. This is not an explicit disclosure or a detail read.
  useLayoutEffect(() => {
    // Both can replace the set of individually displayed DOM rows.
    void turn.steps;
    void kept;
    void expandedSteps;
    const body = replyBody.current;
    if (!reading || !body || typeof IntersectionObserver === "undefined") {
      setInView((previous) => (previous.size ? new Set() : previous));
      return;
    }
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (changes) => {
        for (const change of changes) {
          const key = (change.target as HTMLElement).dataset.readingStep;
          if (key !== undefined) {
            if (change.isIntersecting) visible.add(key);
            else visible.delete(key);
          }
        }
        setInView((previous) =>
          previous.size === visible.size &&
          [...visible].every((key) => previous.has(key))
            ? previous
            : new Set(visible),
        );
      },
      { root: body.closest(".chat-messages") },
    );
    for (const row of body.querySelectorAll("[data-reading-step]"))
      observer.observe(row);
    return () => observer.disconnect();
  }, [reading, turn.steps, kept, expandedSteps]);
  function renderPart({ step, index, key }: IndexedStep, grouped = false) {
    if (step.role === "tool" || step.role === "thinking") {
      const keep = () =>
        setKept((prior) => (prior.has(key) ? prior : new Set(prior).add(key)));
      const Step = step.role === "tool" ? ToolStep : ThinkingStep;
      return (
        <div
          className="trace-entry"
          data-reading-step={grouped ? undefined : key}
          key={key}
          onFocusCapture={keep}
          onPointerDownCapture={keep}
          onClickCapture={keep}
        >
          <Step key={key} turn={turn} index={index} step={step} />
        </div>
      );
    }
    return (
      <div className="msg-part" key={key}>
        {step.error && (
          <span className="ep-state failed">
            {t("Incomplete model response")}
          </span>
        )}
        <StepText
          turn={turn}
          index={index}
          step={step}
          copy={live || step.error || answer.length !== 1}
          render={(text) => (
            <StreamMarkdown
              text={text}
              streaming={live && step.state === "streaming"}
            />
          )}
        />
      </div>
    );
  }
  const timeline = traceGroups(turn, replies).flatMap((entry) => {
    if ("step" in entry) return [renderPart(entry)];
    const { members, count } = entry;
    const open = members.some(
      ({ key }) => kept.has(key) || expandedSteps?.has(key),
    );
    if (!open && reading && members.some(({ key }) => inView.has(key)))
      return members.map((part) => renderPart(part));
    const results = members.filter(({ step }) => step.role === "tool").length;
    const breakdown = [
      results > 0 && `${t("Tool result recorded")}: ${results}`,
      count > results && `${t("Thinking activity ended")}: ${count - results}`,
    ]
      .filter(Boolean)
      .join(" · ");
    const anchor = members.find(({ key }) => key === focusedHead) ?? members[0];
    const label =
      locale === "zh"
        ? `已完成 ${count} 步 · ${open ? "收起过程" : "展开过程"}`
        : `${count} steps completed · ${open ? "Hide steps" : "Show steps"}`;
    return [
      <div
        className="trace-summary"
        key={`summary:${anchor.key}`}
        onFocusCapture={() => setFocusedHead(anchor.key)}
        onBlurCapture={() => setFocusedHead(undefined)}
      >
        <CollapsibleHead
          open={open}
          onToggle={() => {
            const toggle = (prior?: ReadonlySet<string>) => {
              const next = new Set(prior);
              for (const { key } of members) {
                if (open) next.delete(key);
                else next.add(key);
              }
              return next;
            };
            if (onExpandSteps)
              onExpandSteps(turn.renderId ?? header.id, toggle(expandedSteps));
            // Without windowing the choice is local too. Collapse always
            // releases member interaction/visibility holds in this group.
            if (!onExpandSteps || open) setKept(toggle);
            if (open) setInView(toggle);
          }}
          headClassName="trace-group-head"
          titleText={breakdown}
          icon={<FiLayers aria-hidden="true" />}
        >
          {label}
        </CollapsibleHead>
      </div>,
      ...(open ? members.map((part) => renderPart(part, true)) : []),
    ];
  });
  return (
    <section
      className={off ? "chat-turn off-branch" : "chat-turn"}
      aria-label={
        off
          ? t("Conversation turn, not in the new message's context")
          : t("Conversation turn")
      }
    >
      {user.map(({ step, index, key }, position) => {
        const copyable = step.text.trim() !== "";
        const edit = position === 0 && editAction;
        // Without a reply the user's message is the turn's last.
        const branch =
          !replied && position === user.length - 1 && continueAction;
        return (
          <article className="msg msg-user" key={key}>
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
                  <CopyMessageAction
                    turn={turn}
                    parts={[{ step, index, key }]}
                  />
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
            {!live && (answer.length > 0 || continueAction) && (
              <MessageActions label={t("Message actions")}>
                {answer.length > 0 && (
                  <CopyMessageAction turn={turn} parts={answer} />
                )}
                {continueAction}
              </MessageActions>
            )}
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
          <div className="msg-body" ref={replyBody}>
            {timeline}
            {waiting && (
              <p className="msg-working" role="status">
                <span className="working-spin" aria-hidden="true" />
                {header.status === "running"
                  ? t("Working…")
                  : tx(header.status)}
              </p>
            )}
            {omitted.map((note) => (
              <p className="msg-omitted" key={note}>
                {note}
              </p>
            ))}
          </div>
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
          {header.retry.reason &&
            ` ${t("The provider said: {reason}", { reason: header.retry.reason })}`}
        </p>
      )}
      {notice.length > 0 && (
        <p className="inspector-note chat-turn-notice">
          {notice.map((line) => tx(line)).join("\n")}
        </p>
      )}
      {!live && header.status !== "completed" && (
        <p className={`ep-state ${header.status}`}>{tx(header.status)}</p>
      )}
    </section>
  );
});
