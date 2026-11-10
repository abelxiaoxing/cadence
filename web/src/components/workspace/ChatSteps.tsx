/* A turn's tool cards and message text, adapted from pi-web-ui ToolCallBlock,
 * HalfRingSpinner and Message. MIT (c) 2026 xing-shuyin. A card keeps its
 * recorded arguments and output, read only once opened; its glyph says what was
 * recorded for that call, never whether the work succeeded. */
import { type ReactNode, useMemo, useState } from "react";
import type { IconType } from "react-icons";
import {
  FiCheck,
  FiCompass,
  FiEdit2,
  FiEdit3,
  FiFileText,
  FiFolder,
  FiMinus,
  FiSearch,
  FiTerminal,
  FiTool,
  FiX,
} from "react-icons/fi";
import type { ChatStep } from "../../../../src/service/contracts/workbench.ts";
import type { TurnSource } from "../../client/conversation-reader";
import { useStepDetail } from "../../client/turn-source";
import { describeError, type MessageKey, useT } from "../../i18n/locale";
import { parseFileMutationArgs } from "../../rich/file-diff";
import { CopyButton } from "../rich/CopyButton";
import { Markdown } from "../rich/Markdown";
import { CollapsibleHead } from "../transcript/CollapsibleHead";
import { ChatImages } from "./ChatImages";
import { FileChangeCard } from "./FileChangeCard";

/** Turns saved before `omitted` existed carry this line in `notice`. It states
 * the retention rule rather than an outcome of the turn, so it is not shown. */
export const LEGACY_OMITTED_NOTICE =
  "Hidden thinking, signatures and media are not retained.";

export interface IndexedStep {
  step: ChatStep;
  index: number;
}
/** A turn's user messages and, in recorded order, what followed them: message
 * text, thinking blocks and tool calls. An assistant message that only carried
 * tool calls has no text and is not shown. */
export function turnParts(steps: readonly ChatStep[]): {
  user: IndexedStep[];
  replies: IndexedStep[];
} {
  const indexed = steps.map((step, index) => ({ step, index }));
  return {
    user: indexed.filter(({ step }) => step.role === "user"),
    replies: indexed.filter(
      ({ step }) =>
        step.role === "tool" ||
        step.role === "thinking" ||
        (step.role === "assistant" && step.text.trim() !== ""),
    ),
  };
}

type Tone = "exec" | "read" | "edit" | "search" | "default";
const TOOLS: Readonly<Record<string, readonly [IconType, Tone]>> = {
  bash: [FiTerminal, "exec"],
  powershell: [FiTerminal, "exec"],
  read: [FiFileText, "read"],
  ls: [FiFolder, "read"],
  write: [FiEdit3, "edit"],
  edit: [FiEdit2, "edit"],
  grep: [FiSearch, "search"],
  find: [FiCompass, "search"],
};
const PLAIN_TOOL: readonly [IconType, Tone] = [FiTool, "default"];
// Tool names are model-chosen: `constructor` or `__proto__` must not reach the prototype.
const toolLook = (name: string) =>
  Object.hasOwn(TOOLS, name) ? TOOLS[name] : PLAIN_TOOL;

/** What is recorded for one tool call. `ok` only where its result must exist:
 * the turn completed, or a later assistant message followed the call. A later
 * thinking block is not that evidence: it may belong to the calling message. */
export type ToolState = "run" | "ok" | "err" | "idle";
export function toolState(turn: TurnSource, index: number): ToolState {
  const { header, steps } = turn;
  if (steps[index]?.error) return "err";
  const live = header.status === "queued" || header.status === "running";
  if (live && index >= header.stable) return "run";
  return header.status === "completed" ||
    live ||
    steps.slice(index + 1).some((step) => step.role === "assistant")
    ? "ok"
    : "idle";
}
const STATE_LABEL: Readonly<Record<ToolState, MessageKey>> = {
  run: "Tool call in progress",
  ok: "Tool result recorded",
  err: "Tool error recorded",
  idle: "No tool result observed",
};

export function HalfRingSpinner() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      width="1em"
      height="1em"
      className="half-ring-spin"
      aria-hidden="true"
    >
      <path d="M 12 2 A 10 10 0 0 1 12 22" />
    </svg>
  );
}

/** A message's text. A clipped listing reads the whole text once the step can
 * no longer change; until then only its preview exists. */
export function StepText({
  turn,
  index,
  step,
  copy = true,
  render = (text) => <Markdown text={text} />,
}: {
  turn: TurnSource;
  index: number;
  step: ChatStep;
  /** False where the message's action bar already copies this very text. */
  copy?: boolean;
  render?(text: string): ReactNode;
}) {
  const { t } = useT();
  const settled = index < turn.header.stable;
  const full = useStepDetail(turn, index, step, step.clipped && settled);
  const text = full.value?.text ?? step.text;
  return (
    <>
      {step.images?.length ? (
        <ChatImages images={step.images} turn={turn} />
      ) : null}
      {text.trim() !== "" && (
        <div className="msg-text single">
          <div className="msg-text-main">{render(text)}</div>
          {copy && <CopyButton text={text} className="msg-text-copy" />}
        </div>
      )}
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

/** A command as typed, or the arguments as recorded when they hold none. */
function toolCommand(args: string): string | undefined {
  try {
    const value: unknown = JSON.parse(args);
    const command =
      value && typeof value === "object" && Object.hasOwn(value, "command")
        ? (value as { command: unknown }).command
        : undefined;
    return typeof command === "string" && command ? command : undefined;
  } catch {
    return undefined;
  }
}
function readableArgs(args: string): string {
  try {
    return JSON.stringify(JSON.parse(args), null, 2);
  } catch {
    return args;
  }
}

export function ToolStep({
  turn,
  index,
  step,
}: {
  turn: TurnSource;
  index: number;
  step: ChatStep;
}) {
  const { t } = useT();
  // Arguments and output are read only once the card is opened.
  const [open, setOpen] = useState(false);
  const detail = useStepDetail(turn, index, step, open);
  const [Icon, tone] = toolLook(step.name);
  const state = toolState(turn, index);
  const status = t(STATE_LABEL[state]);
  const args = detail.value?.args;
  const command = args ? toolCommand(args) : undefined;
  // An edit or write shows what it asked for as a change, from these arguments.
  const change = useMemo(
    () => (args ? parseFileMutationArgs(step.name, args) : null),
    [step.name, args],
  );
  return (
    <div className={`toolcall ${state}`}>
      <CollapsibleHead
        open={open}
        onToggle={() => setOpen((shown) => !shown)}
        headClassName="toolcall-head"
        titleText={t(open ? "Collapse" : "Show arguments and output")}
        icon={<Icon aria-hidden="true" />}
        iconClassName={`toolcall-icon tc-tone-${tone}`}
        titleClassName="toolcall-name"
        after={
          <>
            <span
              className="toolcall-status"
              role="img"
              title={status}
              aria-label={status}
            >
              {state === "err" ? (
                <FiX aria-hidden="true" />
              ) : state === "ok" ? (
                <FiCheck aria-hidden="true" />
              ) : state === "run" ? (
                <HalfRingSpinner />
              ) : (
                <FiMinus aria-hidden="true" />
              )}
            </span>
            {step.target && (
              <span className="toolcall-path" title={step.target}>
                {tone === "exec" && "$ "}
                {step.target}
              </span>
            )}
            <span className="toolcall-spacer" />
            {step.target && (
              <CopyButton text={step.target} className="chead-copy" />
            )}
          </>
        }
      >
        {step.name || t("Tool")}
      </CollapsibleHead>
      {open && (
        <div className="toolcall-body">
          {step.parts === 0 ? (
            <p className="inspector-note">
              {t("Nothing more is recorded for this call.")}
            </p>
          ) : detail.value ? (
            <>
              {detail.value.args && (
                <div className="toolcall-args">
                  {change ? (
                    <FileChangeCard data={change} failed={state === "err"} />
                  ) : command ? (
                    <div className="termline">
                      <FiTerminal
                        className="termline-icon"
                        aria-hidden="true"
                      />
                      <code>{command}</code>
                    </div>
                  ) : (
                    <pre>{readableArgs(detail.value.args)}</pre>
                  )}
                </div>
              )}
              {detail.value.text && (
                <div className="toolcall-output">
                  <div className="toolcall-output-label">
                    {t(step.error ? "Error output" : "Output")}
                  </div>
                  <pre>{detail.value.text}</pre>
                </div>
              )}
            </>
          ) : (
            <p className={detail.error ? "banner-notice" : "inspector-note"}>
              {detail.error ? describeError(t, detail.error) : t("Reading…")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
