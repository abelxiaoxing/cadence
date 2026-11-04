/* Folded tool presentation split out of ChatWorkspace, adapted from pi-web-ui
 * MessageList. MIT (c) 2026 xing-shuyin. One disclosure for a turn's intermediate
 * steps, so the answer leads; steps keep their recorded arguments and output and
 * nothing is inferred about success. */
import { type ReactNode, useState } from "react";
import { FiChevronRight } from "react-icons/fi";
import type { ChatStep } from "../../../../src/service/contracts/workbench.ts";
import type { TurnSource } from "../../client/conversation-reader";
import { useStepDetail } from "../../client/turn-source";
import { describeError, type MessageKey, useT } from "../../i18n/locale";
import { Markdown } from "../rich/Markdown";
import { ChatImages } from "./ChatImages";

/** Turns saved before `omitted` existed carry this line in `notice`. It states
 * the retention rule rather than an outcome of the turn, so it is not shown. */
export const LEGACY_OMITTED_NOTICE =
  "Hidden thinking, signatures and media are not retained.";

export interface IndexedStep {
  step: ChatStep;
  index: number;
}
/** Steps run through the last tool call; assistant text after it is the answer. */
export function turnParts(steps: readonly ChatStep[]): {
  user: IndexedStep[];
  steps: IndexedStep[];
  answer: IndexedStep[];
} {
  const indexed = steps.map((step, index) => ({ step, index }));
  const replies = indexed.filter(({ step }) => step.role !== "user");
  const last = replies.findLastIndex(({ step }) => step.role === "tool");
  const shown = ({ step }: IndexedStep) =>
    step.role === "tool" || step.text.trim() !== "";
  return {
    user: indexed.filter(({ step }) => step.role === "user"),
    steps: replies.slice(0, last + 1).filter(shown),
    answer: replies.slice(last + 1).filter(shown),
  };
}

type Kind = "read" | "list" | "search" | "run" | "edit" | "other";
const KINDS: Readonly<Record<string, Kind>> = {
  read: "read",
  ls: "list",
  find: "search",
  grep: "search",
  bash: "run",
  powershell: "run",
  edit: "edit",
  write: "edit",
};
// Tool names are model-chosen: `constructor` or `__proto__` must not reach the prototype.
const kindOf = (name: string): Kind =>
  Object.hasOwn(KINDS, name) ? KINDS[name] : "other";
const PHRASES: Readonly<Record<Kind, readonly [MessageKey, MessageKey]>> = {
  read: ["Read 1 file", "Read {n} files"],
  list: ["Listed 1 directory", "Listed {n} directories"],
  search: ["Searched once", "Searched {n} times"],
  run: ["Ran 1 command", "Ran {n} commands"],
  edit: ["Edited 1 file", "Edited {n} files"],
  other: ["Used 1 tool", "Used {n} tools"],
};
// Files and directories count once however often they are touched; calls count each time.
const BY_TARGET: ReadonlySet<Kind> = new Set(["read", "list", "edit"]);
function countKey(step: ChatStep, kind: Kind): string {
  if (!BY_TARGET.has(kind)) return step.id;
  if (step.target) return step.target;
  // `ls` without a path lists the working directory.
  return kind === "list" ? "." : step.id;
}

export function ChatSteps({
  turn,
  steps,
  live,
  answered,
  toggled = null,
  onToggle,
}: {
  turn: TurnSource;
  steps: readonly IndexedStep[];
  live: boolean;
  answered: boolean;
  /** The user's own choice, kept by the caller across remounts. */
  toggled?: boolean | null;
  onToggle?(open: boolean): void;
}) {
  const { t } = useT();
  // A turn that ends without an answer opens, so its steps explain the outcome;
  // this follows the turn as it settles until the user toggles it themselves.
  const [own, setOwn] = useState<boolean | null>(toggled);
  const open = own ?? (!live && !answered);
  const tools = steps
    .map(({ step }) => step)
    .filter((step) => step.role === "tool");
  const failed = tools.filter((step) => step.error).length;
  const { thinking, media, other } = turn.header.omitted;
  const notes = [
    thinking && t("Thinking is not retained."),
    media && t("Media is not retained."),
    other && t("Other content is not retained."),
  ].filter((note) => note !== false);
  let title: string;
  if (live) {
    const latest = tools.at(-1);
    title = latest
      ? `${t("Working…")} ${latest.name || t("Tool")} ${latest.target}`.trim()
      : t("Working…");
  } else {
    const seen = new Map<Kind, Set<string>>();
    for (const step of tools) {
      const kind = kindOf(step.name);
      seen.set(kind, (seen.get(kind) ?? new Set()).add(countKey(step, kind)));
    }
    const parts = [...seen].map(([kind, keys]) =>
      keys.size === 1
        ? t(PHRASES[kind][0])
        : t(PHRASES[kind][1], { n: keys.size }),
    );
    title =
      parts.join(" · ") ||
      (thinking
        ? t("Thought")
        : media
          ? t("Media not retained")
          : other
            ? t("Content not retained")
            : "");
  }
  const head = (
    <>
      {live ? (
        <span className="chat-steps-live" aria-hidden="true" />
      ) : (
        <FiChevronRight className="chat-steps-chevron" aria-hidden="true" />
      )}
      <span className="chat-steps-title">{title}</span>
      {failed > 0 && (
        <span className="ep-state failed">
          {t("{n} failed", { n: failed })}
        </span>
      )}
    </>
  );
  if (steps.length === 0 && notes.length === 0)
    return (
      <div className="chat-steps" role="status">
        <div className="chat-steps-head">{head}</div>
      </div>
    );
  return (
    <details
      className="chat-steps"
      aria-label={t("Working steps")}
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        if (next === open) return;
        setOwn(next);
        onToggle?.(next);
      }}
    >
      <summary className="chat-steps-head">{head}</summary>
      {steps.length > 0 && (
        <ol className="chat-steps-list">
          {steps.map(({ step, index }) => (
            <li key={index}>
              {step.role === "tool" ? (
                <ToolStep turn={turn} index={index} step={step} />
              ) : (
                <div className="chat-step-note">
                  <StepText turn={turn} index={index} step={step} />
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      {notes.map((note) => (
        <p className="chat-steps-omitted" key={note}>
          {note}
        </p>
      ))}
    </details>
  );
}

/** A message's text. A clipped listing reads the whole text once the step can
 * no longer change; until then only its preview exists. */
export function StepText({
  turn,
  index,
  step,
  render = (text) => <Markdown text={text} />,
}: {
  turn: TurnSource;
  index: number;
  step: ChatStep;
  render?(text: string): ReactNode;
}) {
  const { t } = useT();
  const settled = index < turn.header.stable;
  const full = useStepDetail(turn, index, step, step.clipped && settled);
  return (
    <>
      {step.images?.length ? (
        <ChatImages images={step.images} turn={turn} />
      ) : null}
      {render(full.value?.text ?? step.text)}
      {step.clipped && settled && !full.value && (
        <p className={full.error ? "banner-notice" : "inspector-note"}>
          {full.error
            ? describeError(t, full.error)
            : t("Reading the rest of this message…")}
        </p>
      )}
    </>
  );
}

function ToolStep({
  turn,
  index,
  step,
}: {
  turn: TurnSource;
  index: number;
  step: ChatStep;
}) {
  const { t } = useT();
  // Arguments and output are read only once the step is opened.
  const [open, setOpen] = useState(false);
  const detail = useStepDetail(turn, index, step, open);
  return (
    <details
      className="chat-tool"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="chat-tool-name">{step.name || t("Tool")}</span>
        {step.target && (
          <span className="chat-tool-target" title={step.target}>
            {step.target}
          </span>
        )}
        {step.error && <span className="ep-state failed">{t("failed")}</span>}
      </summary>
      {open &&
        step.parts > 0 &&
        (detail.value ? (
          <>
            {detail.value.args && <pre>{detail.value.args}</pre>}
            {detail.value.text && <pre>{detail.value.text}</pre>}
          </>
        ) : (
          <p className={detail.error ? "banner-notice" : "inspector-note"}>
            {detail.error ? describeError(t, detail.error) : t("Reading…")}
          </p>
        ))}
    </details>
  );
}
