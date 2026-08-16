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
  DispatchResult,
  RuntimeActivityEvent,
  RuntimeActivityObserver,
  RuntimeActivityState,
} from "./runtime.ts";

export const ACTIVITY_DETAILS_KEY = "activityDisplay" as const;
export const ACTIVITY_WIDGET_KEY = "abel-subagents" as const;
export const ACTIVITY_STATUS_KEY = "abel-subagents" as const;
export const ACTIVITY_REFRESH_MS = 100;
export const ACTIVITY_WIDGET_MAX_LINES = 12;
export const ACTIVITY_WIDGET_MIN_WIDTH = 3;

export type TerminalActivityState = Exclude<
  RuntimeActivityState,
  "queued" | "running"
>;

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
  nextStep: string;
  riskCount: number;
  retained: boolean;
}

export type ActivitySummary = EvidenceActivitySummary | DiffActivitySummary;

export interface ActivityDisplay {
  version: 1;
  kind: "activityDisplay";
  requestId: string;
  role: string;
  phase: string;
  objective: string;
  state: TerminalActivityState;
  elapsedMs: number;
  summary?: ActivitySummary;
  reason?: string;
}

export interface ActivitySnapshot {
  toolCallId: string;
  requestId: string;
  role: string;
  phase: string;
  objective: string;
  state: "queued" | "running";
  sequence: number;
  startedAt: number;
  elapsedMs: number;
  spinnerFrame?: number;
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

function stateGlyph(state: RuntimeActivityState, spinnerFrame = 0): string {
  switch (state) {
    case "queued":
      return "…";
    case "running":
      return SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length] ?? "⠋";
    case "completed":
      return "✓";
    case "failed":
      return "✗";
    case "cancelled":
      return "⊘";
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

function stateText(state: RuntimeActivityState): string {
  return state;
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
  const second = `  ${sanitizeDisplayText(snapshot.objective, 240)}`;
  const color =
    snapshot.state === "completed"
      ? "success"
      : snapshot.state === "failed" || snapshot.state === "timed-out"
        ? "error"
        : snapshot.state === "cancelled"
          ? "warning"
          : "accent";
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
    const running = hidden.filter((entry) => entry.state === "running").length;
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
            "error",
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
        : `  diff: ${sanitizeDisplayText(summary.summary)} · next: ${sanitizeDisplayText(summary.nextStep)} · ${summary.riskCount} risks · retained: ${summary.retained ? "yes" : "no"}`;
    return [lines[0] ?? "", line(styled(this.theme, "muted", detail), width)];
  }

  invalidate(): void {}
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

export function summarizeDispatchResult(
  result: DispatchResult,
): ActivitySummary | undefined {
  if (!result.ok) return undefined;
  const value = asRecord(result.result);
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
    value.kind === "diff" &&
    typeof value.summary === "string" &&
    typeof value.nextStep === "string" &&
    Array.isArray(value.risks)
  ) {
    return {
      kind: "diff",
      summary: sanitizeDisplayText(value.summary),
      nextStep: sanitizeDisplayText(value.nextStep),
      riskCount: value.risks.length,
      retained: typeof result.resultId === "string",
    };
  }
  return undefined;
}

function terminalState(
  event: RuntimeActivityEvent,
): event is RuntimeActivityEvent & {
  state: TerminalActivityState;
} {
  return !["queued", "running"].includes(event.state);
}

function displayFromEvent(
  entry: ActivityEntry,
  event: RuntimeActivityEvent,
  elapsedMs: number,
): ActivityDisplay {
  const reason = event.failureReason;
  return {
    version: 1,
    kind: "activityDisplay",
    requestId: entry.requestId,
    role: entry.role,
    phase: entry.phase,
    objective: sanitizeDisplayText(entry.objective),
    state: event.state as TerminalActivityState,
    elapsedMs,
    ...(reason === undefined ? {} : { reason: sanitizeFailureReason(reason) }),
  };
}

export function createActivityDisplay(
  event: RuntimeActivityEvent,
  elapsedMs: number,
  result?: DispatchResult,
): ActivityDisplay {
  const entry: ActivityEntry = {
    toolCallId: "",
    requestId: event.requestId,
    role: event.role,
    phase: event.phase,
    objective: event.objective,
    state: event.state === "queued" ? "queued" : "running",
    sequence: event.sequence,
    startedAt: 0,
    elapsedMs,
  };
  const display = displayFromEvent(entry, event, elapsedMs);
  const summary = result ? summarizeDispatchResult(result) : undefined;
  return summary ? { ...display, summary } : display;
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

  observe(
    toolCallId: string,
    onUpdate?: (result: unknown) => void,
  ): RuntimeActivityObserver {
    return (event) => this.accept(toolCallId, onUpdate, event);
  }

  accept(
    toolCallId: string,
    onUpdate: ((result: unknown) => void) | undefined,
    event: RuntimeActivityEvent,
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
        state: event.state === "queued" ? "queued" : "running",
        sequence: event.sequence,
        startedAt: this.now(),
        elapsedMs: 0,
        spinnerFrame: this.spinnerFrame,
        onUpdate,
      };
      this.entries.set(toolCallId, entry);
    } else {
      entry.onUpdate = onUpdate ?? entry.onUpdate;
      if (event.state === "running") entry.state = "running";
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

  finalize(
    toolCallId: string,
    result: DispatchResult,
  ): ActivityDisplay | undefined {
    const display = this.terminals.get(toolCallId);
    if (!display) return undefined;
    this.terminals.delete(toolCallId);
    const summary = summarizeDispatchResult(result);
    return summary ? { ...display, summary } : display;
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
        (entry) => entry.state === "running",
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
): Component {
  const details = asRecord(asRecord(result)?.details);
  const activity = details?.[ACTIVITY_DETAILS_KEY];
  if (isActivityDisplay(activity)) {
    return new ActivityInlineComponent(activity, theme, options.expanded);
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

function isActivityDisplay(value: unknown): value is ActivityDisplay {
  const record = asRecord(value);
  return (
    record?.kind === "activityDisplay" &&
    record.version === 1 &&
    typeof record.requestId === "string" &&
    typeof record.role === "string" &&
    typeof record.phase === "string" &&
    typeof record.objective === "string" &&
    typeof record.state === "string" &&
    typeof record.elapsedMs === "number"
  );
}

export function renderActivityCall(
  args: unknown,
  theme?: ActivityTheme,
): Component {
  const value = asRecord(args);
  if (value?.action !== "run") {
    return new Text(
      `Abel Dispatch ${sanitizeDisplayText(value?.action ?? "")}`,
      0,
      0,
    );
  }
  const request = asRecord(value.request);
  if (!request) return new Text("Subagent", 0, 0);
  const display: ActivitySnapshot = {
    toolCallId: "call",
    requestId: sanitizeDisplayText(request.id ?? "unknown", 128),
    role: sanitizeDisplayText(request.role ?? "unknown", 80),
    phase: sanitizeDisplayText(request.phase ?? "unknown", 40),
    objective: sanitizeDisplayText(request.objective ?? "", 240),
    state: "queued",
    sequence: 0,
    startedAt: Date.now(),
    elapsedMs: 0,
  };
  return new ActivityInlineComponent(display, theme);
}
