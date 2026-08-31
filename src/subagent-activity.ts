import type {
  ExtensionUIContext,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import {
  stripTerminalSequences,
  Text,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import type {
  PacketActivityEvent,
  PacketActivityObserver,
  PacketActivityState,
} from "./packet-runtime.ts";

export const ACTIVITY_DETAILS_KEY = "activityDisplay" as const;
export const ACTIVITY_WIDGET_KEY = "abel-subagents" as const;
export const ACTIVITY_STATUS_KEY = "abel-subagents" as const;
export const ACTIVITY_REFRESH_MS = 100;
export const ACTIVITY_WIDGET_MAX_LINES = 12;
export const ACTIVITY_WIDGET_MIN_WIDTH = 3;

export const WORKFLOW_ACTIVITY_STATES = [
  "queued",
  "connecting",
  "waiting-first-response",
  "running",
  "validating",
  "retrying",
  "verifying",
  "paused",
  "approval-needed",
  "applying",
  "recovering",
  "operation-cancelled",
  "discarded",
  "rejected",
  "completed",
] as const;

export type WorkflowActivityState = (typeof WORKFLOW_ACTIVITY_STATES)[number];
export type ActivityState = PacketActivityState | WorkflowActivityState;
export type TerminalActivityState =
  | Exclude<
      PacketActivityState,
      | "queued"
      | "connecting"
      | "waiting-first-response"
      | "running"
      | "retrying"
    >
  | WorkflowActivityState;

export interface WorkflowActivityUpdate {
  state: WorkflowActivityState;
  stage?: "abel-design" | "abel-implement";
  runId?: string;
  change?: string;
  taskId?: string;
  phase?: string;
  objective?: string;
  code?: string;
  attempt?: number;
  maxAttempts?: number;
  wait?: string;
  legalCommands?: string[];
}

export interface EvidenceActivitySummary {
  kind: "evidence";
  conclusions: number;
  citations: number;
  risks: number;
  blockingQuestions: number;
}

export interface DiffActivitySummary {
  kind: "diff";
  summary: string;
  riskCount: number;
  retained: boolean;
}

export type ActivitySummary = EvidenceActivitySummary | DiffActivitySummary;
export type ActivityTone = "accent" | "success" | "warning" | "muted" | "error";

export interface ActivityDisplay {
  kind: "activityDisplay";
  requestId: string;
  role: string;
  phase: string;
  objective: string;
  state: TerminalActivityState;
  tone: ActivityTone;
  elapsedMs: number;
  summary?: ActivitySummary;
  reason?: string;
  runId?: string;
  taskId?: string;
  code?: string;
  nextAction?: string;
  attempt?: number;
  maxAttempts?: number;
  wait?: string;
}

export interface ActivitySnapshot {
  toolCallId: string;
  requestId: string;
  role: string;
  phase: string;
  objective: string;
  state: ActivityState;
  sequence: number;
  startedAt: number;
  elapsedMs: number;
  spinnerFrame?: number;
  tone?: ActivityTone;
  runId?: string;
  taskId?: string;
  code?: string;
  nextAction?: string;
  attempt?: number;
  maxAttempts?: number;
  wait?: string;
}

interface ActivityEntry extends ActivitySnapshot {
  onUpdate?: (result: unknown) => void;
}

type ActivityColor =
  | "accent"
  | "success"
  | "error"
  | "warning"
  | "muted"
  | "text";
type ActivityTheme = {
  fg?: (color: ActivityColor, text: string) => string;
};
type ActivityUi = Pick<ExtensionUIContext, "setWidget" | "setStatus">;
type ActivityRenderContext = {
  args?: unknown;
  executionStarted?: boolean;
  isError?: boolean;
};
type TimerHandle = ReturnType<typeof setInterval>;

export interface ActivityControllerOptions {
  now?: () => number;
  setInterval?: (callback: () => void, delay: number) => TimerHandle | unknown;
  clearInterval?: (handle: TimerHandle | unknown) => void;
}

function boundedWidth(width: number): number {
  return Math.max(0, Number.isFinite(width) ? Math.floor(width) : 0);
}

function normalizeWhitespace(value: string): string {
  return stripTerminalSequences(value).replace(/\s+/g, " ").trim();
}

function redactPaths(value: string): string {
  return value
    .replace(
      /(?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|\/)(?:[^\s,;:()[\]{}]+[\\/])*[^\s,;:()[\]{}]+/g,
      "[path]",
    )
    .replace(/(?:\b[\w.-]+[\\/])+[\w.-]+/g, "[path]")
    .replace(/\b[\w.-]+\.[A-Za-z0-9]{1,12}\b/g, "[path]");
}

function redactProviderAndModel(value: string): string {
  return value.replace(
    /\b(?:provider|model)(?:\s+identity)?\s*(?:[:=]|\/)?\s*[^\s,;()[\]]+/gi,
    "[redacted]",
  );
}

export function sanitizeDisplayText(value: unknown, maxLength = 240): string {
  const text = typeof value === "string" ? value : String(value ?? "");
  const safe = redactProviderAndModel(redactPaths(normalizeWhitespace(text)));
  return safe.slice(0, Math.max(0, maxLength));
}

const SAFE_WORKFLOW_CODE = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/iu;
const SAFE_CONTROL_ACTIONS = new Set([
  "start",
  "status",
  "resume",
  "rebind",
  "cancel",
  "discard",
]);

export function sanitizeWorkflowCode(value: unknown): string {
  const code = typeof value === "string" ? value : "";
  return SAFE_WORKFLOW_CODE.test(code) ? code : "workflow-state-unavailable";
}

function sanitizeControlAction(value: unknown): string {
  const action = typeof value === "string" ? value : "";
  return SAFE_CONTROL_ACTIONS.has(action) ? action : "status";
}

const SAFE_FAILURE_REASONS = new Set([
  "subagent failed",
  "subagent cancelled",
  "phase timed out",
]);

export function sanitizeFailureReason(value: unknown, maxLength = 240): string {
  const normalized = normalizeWhitespace(String(value ?? ""));
  const safe = SAFE_FAILURE_REASONS.has(normalized)
    ? normalized
    : "subagent failed";
  return safe.slice(0, Math.max(0, maxLength));
}

export function formatElapsed(milliseconds: number): string {
  const value = Math.max(
    0,
    Math.floor(Number.isFinite(milliseconds) ? milliseconds : 0),
  );
  if (value < 1_000) return `${value}ms`;
  const seconds = Math.floor(value / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m${String(seconds % 60).padStart(2, "0")}s`;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function stateGlyph(state: ActivityState, spinnerFrame = 0): string {
  switch (state) {
    case "queued":
      return "…";
    case "connecting":
    case "waiting-first-response":
    case "running":
    case "validating":
    case "retrying":
    case "verifying":
    case "applying":
    case "recovering":
      return SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length] ?? "⠋";
    case "completed":
      return "✓";
    case "failed":
    case "rejected":
      return "✗";
    case "cancelled":
    case "operation-cancelled":
      return "⊘";
    case "discarded":
      return "◇";
    case "paused":
    case "approval-needed":
      return "!";
    case "timed-out":
      return "⌛";
  }
}

function line(value: string, width: number): string {
  const bounded = truncateToWidth(value, boundedWidth(width), "");
  return visibleWidth(bounded) <= boundedWidth(width)
    ? bounded
    : truncateToWidth(bounded, boundedWidth(width), "");
}

function stateText(state: ActivityState): string {
  return state;
}

function activityMetadata(
  snapshot: ActivitySnapshot | ActivityDisplay,
): string[] {
  const metadata: string[] = [];
  if (snapshot.taskId) {
    metadata.push(`task ${sanitizeDisplayText(snapshot.taskId, 80)}`);
  }
  if (snapshot.code) {
    metadata.push(`code ${sanitizeWorkflowCode(snapshot.code)}`);
  }
  if (
    Number.isSafeInteger(snapshot.attempt) &&
    (snapshot.attempt as number) > 0
  ) {
    metadata.push(
      Number.isSafeInteger(snapshot.maxAttempts) &&
        (snapshot.maxAttempts as number) >= (snapshot.attempt as number)
        ? `attempt ${snapshot.attempt}/${snapshot.maxAttempts}`
        : `attempt ${snapshot.attempt}`,
    );
  }
  if (snapshot.wait) {
    metadata.push(`wait ${sanitizeDisplayText(snapshot.wait, 80)}`);
  }
  if (snapshot.nextAction) {
    metadata.push(`next ${sanitizeControlAction(snapshot.nextAction)}`);
  }
  return metadata;
}

function styled(
  theme: ActivityTheme | undefined,
  color: ActivityColor,
  value: string,
): string {
  try {
    return theme?.fg?.(color, value) ?? value;
  } catch {
    return value;
  }
}

function renderActivityLines(
  snapshot: ActivitySnapshot | ActivityDisplay,
  width: number,
  theme?: ActivityTheme,
  now = Date.now(),
): string[] {
  const elapsed =
    "kind" in snapshot
      ? snapshot.elapsedMs
      : Math.max(0, now - snapshot.startedAt);
  const first = [
    stateGlyph(
      snapshot.state,
      "spinnerFrame" in snapshot ? snapshot.spinnerFrame : undefined,
    ),
    "Subagent",
    sanitizeDisplayText(snapshot.role, 80),
    `#${sanitizeDisplayText(snapshot.requestId, 128)}`,
    sanitizeDisplayText(snapshot.phase, 40),
    stateText(snapshot.state),
    formatElapsed(elapsed),
  ].join(" · ");
  const metadata = activityMetadata(snapshot);
  const objective = sanitizeDisplayText(snapshot.objective, 240);
  const second = `  ${[objective, ...metadata].filter(Boolean).join(" · ")}`;
  const color = "tone" in snapshot && snapshot.tone ? snapshot.tone : "accent";
  return [
    line(styled(theme, color, first), width),
    line(styled(theme, "muted", second), width),
  ];
}

export function renderActivityWidgetLines(
  entries: readonly ActivitySnapshot[],
  width: number,
  _now = Date.now(),
): string[] {
  const ordered = [...entries].sort(
    (left, right) =>
      left.sequence - right.sequence ||
      left.toolCallId.localeCompare(right.toolCallId),
  );
  const visible = ordered.slice(0, 5);
  const hidden = ordered.slice(visible.length);
  const lines = [line(`Agents · ${ordered.length} active`, width)];
  for (const entry of visible) {
    lines.push(...renderActivityLines(entry, width, undefined, _now));
  }
  if (hidden.length > 0) {
    const running = hidden.filter((entry) => entry.state !== "queued").length;
    const queued = hidden.filter((entry) => entry.state === "queued").length;
    const overflow = [
      `+${hidden.length} more (${running} running, ${queued} queued)`,
      `+${hidden.length} (${running}r, ${queued}q)`,
      `+${hidden.length} ${running}r ${queued}q`,
      `+${hidden.length} ${running}/${queued}`,
      `${hidden.length}:${running}/${queued}`,
      `${running}/${queued}`,
    ].find((candidate) => visibleWidth(candidate) <= boundedWidth(width));
    lines.push(line(overflow ?? `${running}/${queued}`, width));
  }
  return lines
    .slice(0, ACTIVITY_WIDGET_MAX_LINES)
    .map((entry) => line(entry, width));
}

export class ActivityWidget implements Component {
  constructor(
    private readonly entries: () => readonly ActivitySnapshot[],
    private readonly now: () => number = Date.now,
    private readonly theme?: ActivityTheme,
  ) {}

  render(width: number): string[] {
    return renderActivityWidgetLines(this.entries(), width, this.now()).map(
      (entry, index) =>
        line(
          index === 0
            ? styled(this.theme, "accent", entry)
            : styled(this.theme, "text", entry),
          width,
        ),
    );
  }

  invalidate(): void {}
}

export class ActivityInlineComponent implements Component {
  constructor(
    private readonly display: ActivityDisplay | ActivitySnapshot,
    private readonly theme?: ActivityTheme,
    private readonly expanded = false,
    private readonly now: () => number = Date.now,
  ) {}

  render(width: number): string[] {
    const lines = renderActivityLines(
      this.display,
      width,
      this.theme,
      this.now(),
    );
    if (
      !this.expanded ||
      !("summary" in this.display) ||
      !this.display.summary
    ) {
      if ("reason" in this.display && this.display.reason) {
        lines[1] = line(
          styled(
            this.theme,
            this.display.tone,
            `  reason: ${sanitizeFailureReason(this.display.reason)}`,
          ),
          width,
        );
      }
      return lines;
    }
    const summary = this.display.summary;
    const detail =
      summary.kind === "evidence"
        ? `  evidence: ${summary.conclusions} conclusions · ${summary.citations} citations · ${summary.risks} risks · ${summary.blockingQuestions} blocking`
        : `  diff: ${sanitizeDisplayText(summary.summary)} · ${summary.riskCount} risks · retained: ${summary.retained ? "yes" : "no"}`;
    return [lines[0] ?? "", line(styled(this.theme, "muted", detail), width)];
  }

  invalidate(): void {}
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function workflowStateOf(
  result: Record<string, unknown>,
): WorkflowActivityState {
  const pause = asRecord(result.pause);
  const operation = asRecord(result.operation);
  if (
    pause?.code === "operation-cancelled" ||
    operation?.kind === "operation-cancelled" ||
    result.state === "operation-cancelled"
  ) {
    return "operation-cancelled";
  }
  const state = result.state;
  switch (state) {
    case "not-started":
    case "created":
    case "ready":
    case "queued":
      return "queued";
    case "connecting":
      return "connecting";
    case "waiting-first-response":
      return "waiting-first-response";
    case "running":
      return "running";
    case "validating-delivery":
    case "validating":
      return "validating";
    case "retryable":
    case "retrying":
      return "retrying";
    case "verifying":
    case "change-verifying":
    case "ready-to-apply":
      return "verifying";
    case "paused":
      return "paused";
    case "approval-needed":
      return "approval-needed";
    case "applying":
      return "applying";
    case "recovering":
      return "recovering";
    case "discarded":
      return "discarded";
    case "rejected":
      return "rejected";
    case "completed":
      return result.completed === true ? "completed" : "rejected";
    default:
      return "running";
  }
}

function workflowTone(state: WorkflowActivityState): ActivityTone {
  switch (state) {
    case "completed":
      return "success";
    case "rejected":
      return "error";
    case "retrying":
    case "paused":
    case "approval-needed":
      return "warning";
    case "operation-cancelled":
    case "discarded":
      return "muted";
    default:
      return "accent";
  }
}

function legalWorkflowCommands(result: Record<string, unknown>): string[] {
  return Array.isArray(result.legalCommands)
    ? result.legalCommands.filter(
        (command): command is string =>
          typeof command === "string" && SAFE_CONTROL_ACTIONS.has(command),
      )
    : [];
}

function nextWorkflowAction(
  state: WorkflowActivityState,
  commands: readonly string[],
): string | undefined {
  const preferred =
    state === "paused" ||
    state === "approval-needed" ||
    state === "retrying" ||
    state === "operation-cancelled"
      ? ["resume", "status", "discard"]
      : state === "completed" || state === "discarded" || state === "rejected"
        ? ["status"]
        : ["status", "cancel", "discard"];
  return preferred.find((command) => commands.includes(command)) ?? commands[0];
}

function firstWorkflowTask(result: Record<string, unknown>):
  | {
      taskId?: string;
      phase?: string;
    }
  | undefined {
  if (!Array.isArray(result.tasks)) return undefined;
  const records = result.tasks
    .map(asRecord)
    .filter((task): task is Record<string, unknown> => task !== undefined);
  const task =
    records.find((candidate) => candidate.state !== "verified") ?? records[0];
  return task
    ? {
        ...(typeof task.taskId === "string" ? { taskId: task.taskId } : {}),
        ...(typeof task.phase === "string" ? { phase: task.phase } : {}),
      }
    : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) > 0
    ? (value as number)
    : undefined;
}

function workflowWait(
  state: WorkflowActivityState,
  result: Record<string, unknown>,
): string | undefined {
  if (typeof result.wait === "string") {
    return sanitizeDisplayText(result.wait, 80);
  }
  const approval = asRecord(result.approval);
  if (
    state === "approval-needed" &&
    (approval?.gate === "gate-a" || approval?.gate === "gate-b")
  ) {
    return approval.gate;
  }
  if (state === "connecting") return "connection";
  if (state === "waiting-first-response") return "first-response";
  if (state === "retrying") return "bounded-policy";
  const queue = Array.isArray(result.queue)
    ? asRecord(result.queue[0])
    : undefined;
  const position = positiveInteger(queue?.position);
  return state === "queued" && position ? `queue-${position}` : undefined;
}

function workflowCode(result: Record<string, unknown>): string | undefined {
  const pause = asRecord(result.pause);
  const raw =
    typeof result.code === "string"
      ? result.code
      : typeof pause?.code === "string"
        ? pause.code
        : undefined;
  return raw === undefined ? undefined : sanitizeWorkflowCode(raw);
}

export function projectWorkflowActivity(
  args: unknown,
  result: unknown,
  elapsedMs: number,
): ActivityDisplay {
  const command = asRecord(args) ?? {};
  const payload = asRecord(result) ?? {};
  const state = workflowStateOf(payload);
  const task = firstWorkflowTask(payload);
  const stage =
    payload.stage === "abel-design" || payload.stage === "abel-implement"
      ? payload.stage
      : command.stage === "abel-design" || command.stage === "abel-implement"
        ? command.stage
        : "abel-control";
  const change =
    typeof payload.change === "string"
      ? payload.change
      : typeof command.change === "string"
        ? command.change
        : undefined;
  const runId = typeof payload.runId === "string" ? payload.runId : undefined;
  const taskId =
    typeof payload.taskId === "string" ? payload.taskId : task?.taskId;
  const phase =
    typeof payload.phase === "string"
      ? payload.phase
      : (task?.phase ??
        (typeof command.command === "string" ? command.command : "control"));
  const objective =
    typeof payload.objective === "string"
      ? payload.objective
      : change
        ? `change ${change}`
        : `${String(command.command ?? "control")} workflow run`;
  const legalCommands = legalWorkflowCommands(payload);
  const policy = asRecord(payload.policy);
  const attempt = positiveInteger(payload.attempt ?? policy?.attempt);
  const maxAttempts = positiveInteger(
    payload.maxAttempts ?? policy?.maxAttempts,
  );
  const code =
    state === "rejected" && payload.state === "completed"
      ? "completion-state-inconsistent"
      : workflowCode(payload);
  return {
    kind: "activityDisplay",
    requestId: sanitizeDisplayText(
      runId ?? taskId ?? change ?? command.operationId ?? "pending",
      128,
    ),
    role: sanitizeDisplayText(stage, 80),
    phase: sanitizeDisplayText(phase, 40),
    objective: sanitizeDisplayText(objective, 240),
    state,
    tone: workflowTone(state),
    elapsedMs: Math.max(0, elapsedMs),
    ...(runId ? { runId: sanitizeDisplayText(runId, 128) } : {}),
    ...(taskId ? { taskId: sanitizeDisplayText(taskId, 128) } : {}),
    ...(code ? { code } : {}),
    ...(attempt ? { attempt } : {}),
    ...(maxAttempts ? { maxAttempts } : {}),
    ...(workflowWait(state, payload)
      ? { wait: workflowWait(state, payload) }
      : {}),
    ...(nextWorkflowAction(state, legalCommands)
      ? { nextAction: nextWorkflowAction(state, legalCommands) }
      : {}),
  };
}

function activityResultFromUpdate(update: WorkflowActivityUpdate): unknown {
  return {
    ...update,
    ...(update.state === "completed" ? { completed: true } : {}),
    ...(update.code ? { pause: { code: update.code } } : {}),
  };
}

export function summarizeDispatchResult(
  result: unknown,
): ActivitySummary | undefined {
  const outer = asRecord(result);
  if (!outer || outer.ok === false) return undefined;
  const outcome = outer.ok === true ? asRecord(outer.result) : outer;
  if (!outcome) return undefined;
  const value =
    outcome.kind === "candidate" ? asRecord(outcome.result) : outcome;
  if (!value) return undefined;
  if (
    value.kind === "evidence" &&
    Array.isArray(value.conclusions) &&
    Array.isArray(value.citations) &&
    Array.isArray(value.risks) &&
    Array.isArray(value.blockingQuestions)
  ) {
    return {
      kind: "evidence",
      conclusions: value.conclusions.length,
      citations: value.citations.length,
      risks: value.risks.length,
      blockingQuestions: value.blockingQuestions.length,
    };
  }
  if (
    value.kind === "evidence" &&
    Array.isArray(value.evidence) &&
    Array.isArray(value.existing_structures) &&
    Array.isArray(value.risks) &&
    Array.isArray(value.open_questions)
  ) {
    return {
      kind: "evidence",
      conclusions: value.existing_structures.length,
      citations: value.evidence.length,
      risks: value.risks.length,
      blockingQuestions: value.open_questions.length,
    };
  }
  if (
    value.kind === "diff" &&
    typeof value.summary === "string" &&
    Array.isArray(value.risks)
  ) {
    return {
      kind: "diff",
      summary: sanitizeDisplayText(value.summary),
      riskCount: value.risks.length,
      retained:
        typeof outer.resultId === "string" ||
        typeof outcome.resultId === "string",
    };
  }
  return undefined;
}

function toneForResult(result: unknown): ActivityTone | undefined {
  const outer = asRecord(result);
  if (!outer || outer.ok === false) return undefined;
  const value = outer.ok === true ? asRecord(outer.result) : outer;
  switch (value?.kind) {
    case "candidate":
    case "applied":
    case "completed":
      return "success";
    case "deferred":
    case "retry":
    case "checkpoint-required":
      return "warning";
    case "blocked":
    case "cancelled":
      return "muted";
    default:
      return undefined;
  }
}

function terminalState(
  event: PacketActivityEvent,
): event is PacketActivityEvent & {
  state: TerminalActivityState;
} {
  return ![
    "queued",
    "connecting",
    "waiting-first-response",
    "running",
    "retrying",
  ].includes(event.state);
}

function displayFromEvent(
  entry: ActivityEntry,
  event: PacketActivityEvent,
  elapsedMs: number,
): ActivityDisplay {
  const reason = event.failureReason;
  return {
    kind: "activityDisplay",
    requestId: entry.requestId,
    role: entry.role,
    phase: entry.phase,
    objective: sanitizeDisplayText(entry.objective),
    state: event.state as TerminalActivityState,
    ...(entry.attempt ? { attempt: entry.attempt } : {}),
    ...(entry.maxAttempts ? { maxAttempts: entry.maxAttempts } : {}),
    ...(entry.code ? { code: entry.code } : {}),
    ...(entry.wait ? { wait: entry.wait } : {}),
    tone:
      event.state === "failed" || event.state === "timed-out"
        ? "error"
        : event.state === "cancelled"
          ? "muted"
          : "success",
    elapsedMs,
    ...(reason === undefined ? {} : { reason: sanitizeFailureReason(reason) }),
  };
}

export function createActivityDisplay(
  event: PacketActivityEvent,
  elapsedMs: number,
  result?: unknown,
): ActivityDisplay {
  const entry: ActivityEntry = {
    toolCallId: "",
    requestId: event.requestId,
    role: event.role,
    phase: event.phase,
    objective: event.objective,
    state: event.state,
    sequence: event.sequence,
    startedAt: 0,
    elapsedMs,
    ...(event.attempt ? { attempt: event.attempt } : {}),
    ...(event.maxAttempts ? { maxAttempts: event.maxAttempts } : {}),
    ...(event.code ? { code: event.code } : {}),
    ...(event.wait ? { wait: event.wait } : {}),
  };
  const display = displayFromEvent(entry, event, elapsedMs);
  const summary = result ? summarizeDispatchResult(result) : undefined;
  const tone = result ? toneForResult(result) : undefined;
  return {
    ...display,
    ...(tone === undefined ? {} : { tone }),
    ...(summary === undefined ? {} : { summary }),
  };
}

function activityPartial(display: ActivityDisplay | ActivitySnapshot): unknown {
  const safeDisplay =
    "onUpdate" in display
      ? (({ onUpdate: _onUpdate, ...snapshot }) => snapshot)(display)
      : display;
  return {
    content: [
      {
        type: "text",
        text: renderActivityLines(safeDisplay, 120).join("\n"),
      },
    ],
    details: { [ACTIVITY_DETAILS_KEY]: safeDisplay },
  };
}

export class ActivityController {
  private ui?: ActivityUi;
  private accepting = false;
  private readonly entries = new Map<string, ActivityEntry>();
  private readonly terminals = new Map<string, ActivityDisplay>();
  private spinnerFrame = 0;
  private timer?: TimerHandle | unknown;
  private requestRender?: () => void;
  private widgetInstalled = false;
  private controlSequence = 0;
  private readonly now: () => number;
  private readonly setIntervalFn: (
    callback: () => void,
    delay: number,
  ) => TimerHandle | unknown;
  private readonly clearIntervalFn: (handle: TimerHandle | unknown) => void;

  constructor(options: ActivityControllerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.setIntervalFn =
      options.setInterval ??
      ((callback, delay) => setInterval(callback, delay));
    this.clearIntervalFn =
      options.clearInterval ??
      ((handle) => clearInterval(handle as TimerHandle));
  }

  attach(ui: ActivityUi): void {
    this.detachUi();
    this.ui = ui;
    this.accepting = true;
  }

  detach(): void {
    this.accepting = false;
    this.entries.clear();
    this.terminals.clear();
    this.stopTimer();
    this.detachUi();
    this.ui = undefined;
  }

  clear(): void {
    this.entries.clear();
    this.terminals.clear();
    this.stopTimer();
    this.clearUi();
  }

  beginWorkflow(
    toolCallId: string,
    args: unknown,
    onUpdate?: (result: unknown) => void,
  ): void {
    if (!this.accepting || this.entries.has(toolCallId)) return;
    const display = projectWorkflowActivity(args, { state: "queued" }, 0);
    const entry: ActivityEntry = {
      toolCallId,
      requestId: display.requestId,
      role: display.role,
      phase: display.phase,
      objective: display.objective,
      state: display.state,
      sequence: ++this.controlSequence,
      startedAt: this.now(),
      elapsedMs: 0,
      spinnerFrame: this.spinnerFrame,
      tone: display.tone,
      onUpdate,
    };
    this.entries.set(toolCallId, entry);
    this.emit(entry, entry);
    this.syncUi();
  }

  updateWorkflow(
    toolCallId: string,
    args: unknown,
    update: WorkflowActivityUpdate,
  ): void {
    const entry = this.entries.get(toolCallId);
    if (!this.accepting || !entry) return;
    const display = projectWorkflowActivity(
      args,
      activityResultFromUpdate(update),
      Math.max(0, this.now() - entry.startedAt),
    );
    Object.assign(entry, {
      requestId: display.requestId,
      role: display.role,
      phase: display.phase,
      objective: display.objective,
      state: display.state,
      elapsedMs: display.elapsedMs,
      tone: display.tone,
      runId: display.runId,
      taskId: display.taskId,
      code: display.code,
      nextAction: display.nextAction,
      attempt: display.attempt,
      maxAttempts: display.maxAttempts,
      wait: display.wait,
    });
    this.emit(entry, entry);
    this.syncUi();
  }

  finalizeWorkflow(
    toolCallId: string,
    args: unknown,
    result: unknown,
  ): ActivityDisplay | undefined {
    const entry = this.entries.get(toolCallId);
    if (!entry) return undefined;
    const display = projectWorkflowActivity(
      args,
      result,
      Math.max(0, this.now() - entry.startedAt),
    );
    this.emit(entry, display);
    this.entries.delete(toolCallId);
    this.syncUi();
    return display;
  }

  failWorkflow(toolCallId: string): void {
    const entry = this.entries.get(toolCallId);
    if (!entry) return;
    const display: ActivityDisplay = {
      kind: "activityDisplay",
      requestId: entry.requestId,
      role: entry.role,
      phase: entry.phase,
      objective: entry.objective,
      state: "failed",
      tone: "error",
      elapsedMs: Math.max(0, this.now() - entry.startedAt),
      reason: "subagent failed",
    };
    this.emit(entry, display);
    this.entries.delete(toolCallId);
    this.syncUi();
  }

  observe(
    toolCallId: string,
    onUpdate?: (result: unknown) => void,
  ): PacketActivityObserver {
    return (event) => this.accept(toolCallId, onUpdate, event);
  }

  accept(
    toolCallId: string,
    onUpdate: ((result: unknown) => void) | undefined,
    event: PacketActivityEvent,
  ): void {
    if (!this.accepting || this.terminals.has(toolCallId)) return;
    let entry = this.entries.get(toolCallId);
    if (!entry) {
      entry = {
        toolCallId,
        requestId: event.requestId,
        role: event.role,
        phase: event.phase,
        objective: sanitizeDisplayText(event.objective),
        state: event.state,
        sequence: event.sequence,
        startedAt: this.now(),
        elapsedMs: 0,
        spinnerFrame: this.spinnerFrame,
        ...(event.attempt ? { attempt: event.attempt } : {}),
        ...(event.maxAttempts ? { maxAttempts: event.maxAttempts } : {}),
        ...(event.code ? { code: event.code } : {}),
        ...(event.wait ? { wait: event.wait } : {}),
        onUpdate,
      };
      this.entries.set(toolCallId, entry);
    } else {
      entry.onUpdate = onUpdate ?? entry.onUpdate;
      entry.state = event.state;
      entry.attempt = event.attempt;
      entry.maxAttempts = event.maxAttempts;
      entry.code = event.code;
      entry.wait = event.wait;
    }
    if (terminalState(event)) {
      const display = displayFromEvent(
        entry,
        event,
        Math.max(0, this.now() - entry.startedAt),
      );
      this.terminals.set(toolCallId, display);
      this.emit(entry, display);
      this.entries.delete(toolCallId);
      this.syncUi();
      return;
    }
    this.emit(entry, {
      ...entry,
      elapsedMs: Math.max(0, this.now() - entry.startedAt),
    });
    this.syncUi();
  }

  finalize(toolCallId: string, result: unknown): ActivityDisplay | undefined {
    const display = this.terminals.get(toolCallId);
    if (!display) return undefined;
    this.terminals.delete(toolCallId);
    const summary = summarizeDispatchResult(result);
    const tone = toneForResult(result);
    return {
      ...display,
      ...(tone === undefined ? {} : { tone }),
      ...(summary === undefined ? {} : { summary }),
    };
  }

  getActiveEntries(): readonly ActivitySnapshot[] {
    return [...this.entries.values()].map(
      ({ onUpdate: _onUpdate, ...entry }) => ({
        ...entry,
        elapsedMs: Math.max(0, this.now() - entry.startedAt),
        spinnerFrame: this.spinnerFrame,
      }),
    );
  }

  isTimerActive(): boolean {
    return this.timer !== undefined;
  }

  private emit(
    entry: ActivityEntry,
    display: ActivityDisplay | ActivitySnapshot,
  ): void {
    try {
      entry.onUpdate?.(activityPartial(display));
    } catch {
      // A renderer callback is not part of orchestration.
    }
  }

  private ensureWidget(): void {
    if (!this.ui || this.widgetInstalled) return;
    try {
      this.ui.setWidget(
        ACTIVITY_WIDGET_KEY,
        (tui, theme) => {
          this.requestRender = () => tui.requestRender();
          return new ActivityWidget(
            () => this.getActiveEntries(),
            this.now,
            theme,
          );
        },
        { placement: "aboveEditor" },
      );
      this.widgetInstalled = true;
    } catch {
      // TUI failures are deliberately isolated from the run.
    }
  }

  private startTimer(): void {
    if (this.timer !== undefined) return;
    try {
      this.timer = this.setIntervalFn(
        () => this.tick(),
        ACTIVITY_REFRESH_MS,
      ) as TimerHandle;
    } catch {
      this.timer = undefined;
    }
  }

  private stopTimer(): void {
    if (this.timer === undefined) return;
    try {
      this.clearIntervalFn(this.timer);
    } catch {
      // The timer is best-effort presentation state.
    }
    this.timer = undefined;
  }

  private tick(): void {
    if (this.entries.size === 0) {
      this.stopTimer();
      this.clearUi();
      return;
    }
    this.spinnerFrame++;
    for (const entry of this.entries.values()) {
      this.emit(entry, {
        ...entry,
        elapsedMs: Math.max(0, this.now() - entry.startedAt),
        spinnerFrame: this.spinnerFrame,
      });
    }
    try {
      this.requestRender?.();
    } catch {
      // Widget refresh is best-effort.
    }
    this.syncUi();
  }

  private syncUi(): void {
    if (!this.ui) return;
    if (this.entries.size === 0) {
      this.stopTimer();
      this.clearUi();
      return;
    }
    this.ensureWidget();
    this.startTimer();
    try {
      const running = [...this.entries.values()].filter(
        (entry) => entry.state !== "queued",
      ).length;
      const queued = this.entries.size - running;
      this.ui.setStatus(
        ACTIVITY_STATUS_KEY,
        `Agents: ${running} running, ${queued} queued`,
      );
    } catch {
      // Status rendering is optional.
    }
  }

  private clearUi(): void {
    if (!this.ui) return;
    try {
      if (this.widgetInstalled)
        this.ui.setWidget(ACTIVITY_WIDGET_KEY, undefined);
    } catch {
      // Best-effort cleanup.
    }
    try {
      this.ui.setStatus(ACTIVITY_STATUS_KEY, undefined);
    } catch {
      // Best-effort cleanup.
    }
    this.widgetInstalled = false;
    this.requestRender = undefined;
  }

  private detachUi(): void {
    this.clearUi();
  }
}

export function renderActivityResult(
  result: unknown,
  options: ToolRenderResultOptions,
  theme?: ActivityTheme,
  context?: ActivityRenderContext,
): Component {
  const details = asRecord(asRecord(result)?.details);
  const activity = details?.[ACTIVITY_DETAILS_KEY];
  const failed = context?.isError === true;
  const args = asRecord(context?.args);
  const failedRun = failed && args?.action === "run";
  if (isActivityDisplay(activity) && !failed) {
    return new ActivityInlineComponent(activity, theme, options.expanded);
  }
  if (failedRun) {
    const snapshot = identityFromDispatchArgs(asRecord(context?.args)?.request);
    const display: ActivityDisplay = {
      kind: "activityDisplay",
      requestId: isActivityDisplay(activity)
        ? activity.requestId
        : snapshot.requestId,
      role: isActivityDisplay(activity) ? activity.role : snapshot.role,
      phase: isActivityDisplay(activity) ? activity.phase : snapshot.phase,
      objective: isActivityDisplay(activity)
        ? activity.objective
        : snapshot.objective,
      state: "failed",
      tone: "error",
      elapsedMs: isActivityDisplay(activity) ? activity.elapsedMs : 0,
      reason: sanitizeFailureReason(
        isActivityDisplay(activity) ? activity.reason : undefined,
      ),
    };
    return new ActivityInlineComponent(display, theme);
  }
  if (failed) {
    return new Text(
      `${dispatchLabel(args?.action ?? args?.command)} failed`,
      0,
      0,
    );
  }
  const content = asRecord(result)?.content;
  const text = Array.isArray(content)
    ? content
        .map((item) => asRecord(item)?.text)
        .filter((item): item is string => typeof item === "string")
        .join("\n")
    : "";
  return new Text(text, 0, 0);
}

function dispatchLabel(action: unknown): string {
  const value = sanitizeDisplayText(action ?? "");
  return value.length > 0 ? `Abel Dispatch ${value}` : "Abel Dispatch";
}

function isActivityDisplay(value: unknown): value is ActivityDisplay {
  const record = asRecord(value);
  return (
    record?.kind === "activityDisplay" &&
    typeof record.requestId === "string" &&
    typeof record.role === "string" &&
    typeof record.phase === "string" &&
    typeof record.objective === "string" &&
    typeof record.state === "string" &&
    typeof record.elapsedMs === "number"
  );
}

function identityFromDispatchArgs(request: unknown): {
  requestId: string;
  role: string;
  phase: string;
  objective: string;
} {
  const value = asRecord(request);
  const attempt = asRecord(value?.attempt);
  const boundary = asRecord(value?.boundary);
  return {
    requestId: sanitizeDisplayText(
      attempt?.requestId ?? value?.id ?? "unknown",
      128,
    ),
    role: sanitizeDisplayText(
      value?.role ??
        (value?.stage === "abel-implement"
          ? "implementation-worker"
          : "unknown"),
      80,
    ),
    phase: sanitizeDisplayText(attempt?.phase ?? value?.phase ?? "unknown", 40),
    objective: sanitizeDisplayText(
      value?.objective ?? boundary?.objective ?? "",
      240,
    ),
  };
}

export function renderActivityCall(
  args: unknown,
  theme?: ActivityTheme,
  context?: ActivityRenderContext,
): Component {
  const value = asRecord(args);
  if (typeof value?.command === "string") {
    if (context?.executionStarted || context?.isError) return new Text("");
    const projected = projectWorkflowActivity(value, { state: "queued" }, 0);
    const display: ActivitySnapshot = {
      toolCallId: "call",
      requestId: projected.requestId,
      role: projected.role,
      phase: projected.phase,
      objective: projected.objective,
      state: projected.state,
      sequence: 0,
      startedAt: Date.now(),
      elapsedMs: 0,
      tone: projected.tone,
    };
    return new ActivityInlineComponent(display, theme);
  }
  if (value?.action !== "run") {
    return new Text(context?.isError ? "" : dispatchLabel(value?.action), 0, 0);
  }
  if (context?.executionStarted || context?.isError) {
    return new Text("");
  }
  if (!asRecord(value.request)) return new Text("Subagent", 0, 0);
  const identity = identityFromDispatchArgs(value.request);
  const display: ActivitySnapshot = {
    toolCallId: "call",
    requestId: identity.requestId,
    role: identity.role,
    phase: identity.phase,
    objective: identity.objective,
    state: "queued",
    sequence: 0,
    startedAt: Date.now(),
    elapsedMs: 0,
  };
  return new ActivityInlineComponent(display, theme);
}
