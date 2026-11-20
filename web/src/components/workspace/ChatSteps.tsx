/* A turn's tool cards and message text, adapted from pi-web-ui ToolCallBlock,
 * HalfRingSpinner and Message. MIT (c) 2026 xing-shuyin. A card keeps its
 * recorded arguments and output, read only once opened; its glyph says what was
 * recorded for that call, never whether the work succeeded. */
import { type ReactNode, useMemo, useState } from "react";
import type { IconType } from "react-icons";
import {
  FiCheck,
  FiCompass,
  FiCpu,
  FiEdit2,
  FiEdit3,
  FiFileText,
  FiFolder,
  FiMinus,
  FiSearch,
  FiSlash,
  FiTerminal,
  FiTool,
  FiX,
} from "react-icons/fi";
import type { ChatStep } from "../../../../src/service/contracts/workbench.ts";
import {
  stepIdentity,
  type TurnSource,
  unsettled,
} from "../../client/conversation-reader";
import { describeError, type MessageKey, useT } from "../../i18n/locale";
import { parseFileMutationArgs } from "../../rich/file-diff";
import { CopyButton } from "../rich/CopyButton";
import { Markdown } from "../rich/Markdown";
import { CollapsibleHead } from "../transcript/CollapsibleHead";
import { ChatImages } from "./ChatImages";
import { FileChangeCard } from "./FileChangeCard";
import { stepActive, useStepDetail } from "./turn-source";

/** Turns saved before `omitted` existed carry this line in `notice`. It states
 * the retention rule rather than an outcome of the turn, so it is not shown. */
export const LEGACY_OMITTED_NOTICE =
  "Hidden thinking, signatures and media are not retained.";

export interface IndexedStep {
  step: ChatStep;
  index: number;
  key: string;
}
/** A turn's user messages and, in recorded order, what followed them: message
 * text, thinking blocks and tool calls. An assistant message that only carried
 * tool calls has no text and is not shown. */
export function turnParts(steps: readonly ChatStep[]): {
  user: IndexedStep[];
  replies: IndexedStep[];
} {
  const indexed = steps.map((step, index) => ({
    step,
    index,
    key: stepIdentity(step),
  }));
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

/** Explicit call state is separate from immutable content and reply outcome.
 * Old history without it remains neutral unless it records an actual error. */
export type ToolState = "run" | "ok" | "err" | "idle";
export function toolState(turn: TurnSource, index: number): ToolState {
  const step = turn.steps[index];
  if (step?.error || step?.state === "failed") return "err";
  if (step?.state === "completed") return "ok";
  if (step && stepActive(step) && unsettled(turn.header.status)) return "run";
  return "idle";
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
  const argumentText = args && !change ? (command ?? readableArgs(args)) : "";
  return (
    <div className={`toolcall ${state}${open ? " open" : ""}`}>
      <CollapsibleHead
        open={open}
        onToggle={() => setOpen((shown) => !shown)}
        headClassName="toolcall-head"
        titleText={t(open ? "Collapse" : "Show arguments and output")}
        icon={<Icon aria-hidden="true" />}
        iconClassName={`toolcall-icon tc-tone-${tone}`}
        titleClassName="toolcall-name"
        summary={
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
          </>
        }
        after={
          step.target && (
            <CopyButton
              text={step.target}
              label={t("Copy tool summary")}
              className="chead-copy"
            />
          )
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
                  ) : (
                    <>
                      <div className="toolcall-output-label">
                        {t(command ? "Command" : "Arguments")}
                        <CopyButton
                          text={argumentText}
                          label={t(command ? "Copy command" : "Copy arguments")}
                          className="output-copy"
                        />
                      </div>
                      {command ? (
                        <div className="termline">
                          <FiTerminal
                            className="termline-icon"
                            aria-hidden="true"
                          />
                          <code>{argumentText}</code>
                        </div>
                      ) : (
                        <pre>{argumentText}</pre>
                      )}
                    </>
                  )}
                </div>
              )}
              {detail.value.text && (
                <div className="toolcall-output">
                  <div className="toolcall-output-label">
                    {t(state === "err" ? "Error output" : "Output")} · {status}
                    <CopyButton
                      text={detail.value.text}
                      label={t("Copy output")}
                      className="output-copy"
                    />
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
          {detail.value && detail.error && (
            <p className="banner-notice">{describeError(t, detail.error)}</p>
          )}
        </div>
      )}
    </div>
  );
}

/** Adapted from the existing pi-web-ui ThinkingBlock (MIT (c) 2026
 * xing-shuyin). An activity has no detail affordance; readable Pi thinking
 * takes its place with the same step identity and starts folded. */
export function ThinkingStep({
  turn,
  index,
  step,
}: {
  turn: TurnSource;
  index: number;
  step: ChatStep;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const detail = useStepDetail(turn, index, step, open && step.parts > 0);
  const recording = stepActive(step) && unsettled(turn.header.status);
  const row = `thinking${recording ? " run" : ""}`;
  if (step.parts === 0)
    return (
      <div className={row}>
        <div
          className="chead thinking-head"
          title={t(
            "Thinking content is not streamed. Readable recorded thinking can be opened after it is saved.",
          )}
        >
          <span className="chead-main trace-note">
            <span className="chead-icon thinking-icon" aria-hidden="true">
              {recording ? <FiCpu /> : <FiSlash />}
            </span>
            <span className="chead-title thinking-label" role="status">
              {t(
                recording
                  ? "Thinking activity observed"
                  : step.state === "completed"
                    ? "Thinking activity ended"
                    : "Thinking content unavailable",
              )}
            </span>
            {recording && <HalfRingSpinner />}
          </span>
        </div>
      </div>
    );
  const text = detail.value?.text.trim() ?? "";
  return (
    <div className={`${row}${open ? " open" : ""}`}>
      <CollapsibleHead
        open={open}
        onToggle={() => setOpen((shown) => !shown)}
        headClassName="thinking-head"
        titleText={t(open ? "Collapse" : "Show thinking")}
        icon={<FiCpu aria-hidden="true" />}
        iconClassName="thinking-icon"
        titleClassName="thinking-label"
        after={text && <CopyButton text={text} className="chead-copy" />}
      >
        {t("Thinking")}
      </CollapsibleHead>
      {open && (
        <div className="thinking-body">
          {text || (
            <p className={detail.error ? "banner-notice" : "inspector-note"}>
              {detail.error
                ? describeError(t, detail.error)
                : detail.value
                  ? t("No thinking text is recorded for this block.")
                  : t("Reading…")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
