/* Folded tool presentation split out of ChatWorkspace, adapted from pi-web-ui
 * MessageList. MIT (c) 2026 xing-shuyin. One disclosure for a turn's intermediate
 * steps, so the answer leads; steps keep their recorded arguments and output and
 * nothing is inferred about success. */
import { useState } from "react";
import { FiChevronRight } from "react-icons/fi";
import type {
  ChatItem,
  ChatTurn,
} from "../../../../src/service/contracts/workbench.ts";
import { type MessageKey, useT } from "../../i18n/locale";
import { Markdown } from "../rich/Markdown";

/** Turns saved before `omitted` existed carry this line in `notice`. It states
 * the retention rule rather than an outcome of the turn, so it is not shown. */
export const LEGACY_OMITTED_NOTICE =
  "Hidden thinking, signatures and media are not retained.";

/** Steps run through the last tool call; assistant text after it is the answer. */
export function turnParts(items: readonly ChatItem[]): {
  steps: ChatItem[];
  answer: ChatItem[];
} {
  const replies = items.filter((item) => item.role !== "user");
  const last = replies.findLastIndex((item) => item.role === "tool");
  const shown = (item: ChatItem) =>
    item.role === "tool" || item.text.trim() !== "";
  return {
    steps: replies.slice(0, last + 1).filter(shown),
    answer: replies.slice(last + 1).filter(shown),
  };
}

/** A tool's recorded arguments as an object; partial or unparsable ones are null. */
function toolArgs(args: string): object | null {
  let value: unknown;
  try {
    value = JSON.parse(args);
  } catch {
    return null;
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

/** What a tool acted on, from its recorded arguments: a command's first line,
 * else a pattern and path. Partial or unparsable arguments name nothing. */
export function toolTarget(args: string): string {
  const value = toolArgs(args);
  if (!value) return "";
  const field = (name: string) => {
    const v = Object.hasOwn(value, name)
      ? (value as Record<string, unknown>)[name]
      : undefined;
    return typeof v === "string" ? v.trim() : "";
  };
  const command = field("command");
  if (command) return command.split("\n", 1)[0];
  return [field("pattern"), field("path")].filter(Boolean).join("  ");
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
function countKey(step: ChatItem, kind: Kind): string {
  if (!BY_TARGET.has(kind)) return step.id;
  const target = toolTarget(step.args);
  if (target) return target;
  // `ls` without a path lists the working directory.
  return kind === "list" && toolArgs(step.args) ? "." : step.id;
}

export function ChatSteps({
  turn,
  steps,
  live,
  answered,
}: {
  turn: ChatTurn;
  steps: readonly ChatItem[];
  live: boolean;
  answered: boolean;
}) {
  const { t } = useT();
  // A turn that ends without an answer opens, so its steps explain the outcome;
  // this follows the turn as it settles until the user toggles it themselves.
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? (!live && !answered);
  const tools = steps.filter((step) => step.role === "tool");
  const failed = tools.filter((step) => step.error).length;
  const { thinking, media, other } = turn.omitted;
  const notes = [
    thinking && t("Thinking is not retained."),
    media && t("Media is not retained."),
    other && t("Other content is not retained."),
  ].filter((note) => note !== false);
  let title: string;
  if (live) {
    const latest = tools.at(-1);
    title = latest
      ? `${t("Working…")} ${latest.name || t("Tool")} ${toolTarget(latest.args)}`.trim()
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
      onToggle={(event) => setToggled(event.currentTarget.open)}
    >
      <summary className="chat-steps-head">{head}</summary>
      {steps.length > 0 && (
        <ol className="chat-steps-list">
          {steps.map((step) => (
            <li key={step.id}>
              {step.role === "tool" ? (
                <ToolStep item={step} />
              ) : (
                <div className="chat-step-note">
                  <Markdown text={step.text} />
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

function ToolStep({ item }: { item: ChatItem }) {
  const { t } = useT();
  const target = toolTarget(item.args);
  return (
    <details className="chat-tool">
      <summary>
        <span className="chat-tool-name">{item.name || t("Tool")}</span>
        {target && (
          <span className="chat-tool-target" title={target}>
            {target}
          </span>
        )}
        {item.error && <span className="ep-state failed">{t("failed")}</span>}
      </summary>
      {item.args && <pre>{item.args}</pre>}
      {item.text && <pre>{item.text}</pre>}
    </details>
  );
}
