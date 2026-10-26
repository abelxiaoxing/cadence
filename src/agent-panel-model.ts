/** Background-agent panel model. Pure: no Pi host, terminal or timer access.
 * The panel only observes these bus events; producers own their agents, and
 * nothing here can start, cancel or keep one alive. */

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export const SUBAGENT_EVENTS = {
  start: "subagent:start",
  message: "subagent:message",
  activity: "subagent:activity",
  stats: "subagent:stats",
  end: "subagent:end",
} as const;
/** Panel → producers: the agent whose transcript is shown (`id: null` when
 * none), so a producer can load messages for that one agent only. */
export const SUBAGENT_VIEW = "subagent:view";

export type SubagentStatus = "running" | "done" | "error" | "cancelled";

export interface SubagentState {
  id: string;
  label: string;
  kind: string;
  startedAt: number;
  /** Producer passed `startedAt: null`: the run began before it was observed. */
  untimed?: boolean;
  endedAt?: number;
  status: SubagentStatus;
  activity: string;
  /** Absent until a producer reports usage; not every producer meters it. */
  tokensIn?: number;
  tokensOut?: number;
  error?: string;
  /** Messages in arrival order (same shape as the main session's). */
  messages: object[];
  /** The last message is a streaming snapshot the next message replaces. */
  streaming: boolean;
  /** Earlier messages dropped to keep the retained view bounded. */
  omitted: number;
  /** Bumped by every message event, so views rebuild only on change. */
  revision: number;
  /** Time of the last event, for choosing the most recently active rows. */
  activeAt: number;
}

/** Retained messages per agent; older ones are counted, not kept. */
export const MAX_MESSAGES = 2000;
const ENDED = new Set(["done", "error", "cancelled"]);

const record = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
/** One terminal-safe line: controls and line breaks collapse to spaces. */
export function oneLine(v: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strip terminal controls from producer text
  return v.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").trim();
}
const line = (v: unknown, max: number) =>
  typeof v === "string" ? oneLine(v).slice(0, max) : undefined;
const count = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0
    ? Math.floor(v)
    : undefined;

/** Map<id, SubagentState> fed only by bus events. Malformed, unknown-agent,
 * duplicate-start and post-end activity events are ignored. */
export class SubagentStore {
  private readonly agents = new Map<string, SubagentState>();
  private readonly listeners = new Set<() => void>();
  constructor(private readonly now: () => number = Date.now) {}

  get size(): number {
    return this.agents.size;
  }
  get(id: string): SubagentState | undefined {
    return this.agents.get(id);
  }
  /** Start order, which stays stable while rows update. */
  ordered(): SubagentState[] {
    return [...this.agents.values()];
  }
  running(): number {
    let n = 0;
    for (const a of this.agents.values()) if (a.status === "running") n++;
    return n;
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  apply(channel: string, data: unknown): boolean {
    const changed = this.reduce(channel, data);
    if (changed) for (const listener of this.listeners) listener();
    return changed;
  }

  private reduce(channel: string, data: unknown): boolean {
    const o = record(data);
    const id = o && line(o.id, 256);
    if (!o || !id) return false;
    const now = this.now();
    if (channel === SUBAGENT_EVENTS.start) {
      if (this.agents.has(id)) return false;
      this.agents.set(id, {
        id,
        label: line(o.label, 512) || id,
        kind: line(o.kind, 32) || "agent",
        startedAt: count(o.startedAt) ?? now,
        ...(o.startedAt === null ? { untimed: true } : {}),
        status: "running",
        activity: "",
        messages: [],
        streaming: false,
        omitted: 0,
        revision: 0,
        activeAt: now,
      });
      return true;
    }
    const agent = this.agents.get(id);
    if (!agent) return false;
    switch (channel) {
      case SUBAGENT_EVENTS.message: {
        const message = record(o.message);
        if (!message) return false;
        if (agent.streaming)
          agent.messages[agent.messages.length - 1] = message;
        else agent.messages.push(message);
        agent.streaming = o.streaming === true;
        agent.revision++;
        const excess = agent.messages.length - MAX_MESSAGES;
        if (excess > 0) {
          agent.messages.splice(0, excess);
          agent.omitted += excess;
        }
        break;
      }
      case SUBAGENT_EVENTS.activity: {
        if (agent.status !== "running") return false;
        const activity = line(o.activity, 512);
        if (activity === undefined) return false;
        agent.activity = activity;
        this.stats(agent, o);
        break;
      }
      case SUBAGENT_EVENTS.stats:
        if (!this.stats(agent, o)) return false;
        break;
      case SUBAGENT_EVENTS.end: {
        if (agent.status !== "running" || !ENDED.has(o.status as string))
          return false;
        agent.status = o.status as SubagentStatus;
        agent.endedAt = Math.max(agent.startedAt, count(o.endedAt) ?? now);
        const error = line(o.error, 512);
        if (error) agent.error = error;
        if (agent.streaming) agent.revision++;
        agent.streaming = false;
        break;
      }
      default:
        return false;
    }
    agent.activeAt = now;
    return true;
  }
  private stats(agent: SubagentState, o: Record<string, unknown>): boolean {
    const tokensIn = count(o.tokensIn),
      tokensOut = count(o.tokensOut);
    if (tokensIn !== undefined) agent.tokensIn = tokensIn;
    if (tokensOut !== undefined) agent.tokensOut = tokensOut;
    return tokensIn !== undefined || tokensOut !== undefined;
  }
}

/** "43s", "4m 43s", "1h 02m". */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const m = Math.floor((s % 3600) / 60);
  return `${Math.floor(s / 3600)}h ${String(m).padStart(2, "0")}m`;
}
/** "999", "110.9k", "1.2M"; a value that rounds to 1000k is shown as M. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  const k = Math.round(n / 100) / 10;
  if (k < 1000) return `${k.toFixed(1)}k`;
  return `${(Math.round(n / 100000) / 10).toFixed(1)}M`;
}
export function elapsedOf(agent: SubagentState, now: number): number {
  return (agent.endedAt ?? now) - agent.startedAt;
}
/** Elapsed column text: "—" when the start was never observed. */
export function elapsedText(agent: SubagentState, now: number): string {
  return agent.untimed ? "—" : formatElapsed(elapsedOf(agent, now));
}

export type PaintRole =
  | "accent"
  | "success"
  | "error"
  | "muted"
  | "dim"
  | "selected";
/** Theme seam; tests pass identity. `selected` is reverse video. */
export type Paint = (role: PaintRole, text: string) => string;

export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SYMBOL: Record<
  Exclude<SubagentStatus, "running">,
  [string, PaintRole]
> = {
  done: ["✔", "success"],
  error: ["✘", "error"],
  cancelled: ["○", "muted"],
};
export function statusSymbol(
  agent: SubagentState,
  frame: number,
): [string, PaintRole] {
  return agent.status === "running"
    ? [SPINNER[frame % SPINNER.length], "accent"]
    : SYMBOL[agent.status];
}
/** `↓in [↑out]`, or "" when the producer never reported usage. */
export function usage(agent: SubagentState): string {
  const input =
    agent.tokensIn === undefined ? "" : `↓${formatTokens(agent.tokensIn)}`;
  const out =
    agent.tokensOut === undefined ? "" : `↑${formatTokens(agent.tokensOut)}`;
  return [input, out].filter(Boolean).join(" ");
}
/** Elapsed plus usage when known: "4m 12s · ↓1.2M" or "4m 12s". */
export function factsText(agent: SubagentState, now: number): string {
  const used = usage(agent);
  return `${elapsedText(agent, now)}${used ? ` · ${used}` : ""}`;
}

/** The `max` most recently active agents plus any pinned ones, shown in
 * stable start order, and how many others are hidden. */
export function visibleAgents(
  agents: SubagentState[],
  max: number,
  pinned: (string | undefined)[] = [],
): { rows: SubagentState[]; hidden: number } {
  if (agents.length <= max) return { rows: agents, hidden: 0 };
  const recent = [...agents].sort((a, b) => b.activeAt - a.activeAt);
  const keep = new Set(recent.slice(0, max).map((a) => a.id));
  for (const id of pinned) {
    if (!id || keep.has(id) || !agents.some((a) => a.id === id)) continue;
    const drop = [...keep]
      .reverse()
      .find((k) => !pinned.includes(k) && k !== id);
    if (drop) keep.delete(drop);
    keep.add(id);
  }
  const rows = agents.filter((a) => keep.has(a.id));
  return { rows, hidden: agents.length - rows.length };
}

export interface PanelFrame {
  agents: SubagentState[];
  focus: "input" | "panel";
  /** Selected row: an agent id, or undefined for main. */
  selected: string | undefined;
  /** Agent shown in place of the main view, if any. */
  view: string | undefined;
  now: number;
  frame: number;
  maxRows: number;
  showEmpty: boolean;
}
const s = (n: number) => (n === 1 ? "" : "s");
const cut = (text: string, width: number) =>
  truncateToWidth(text, Math.max(0, width), "…");
/** Plain-text truncation. pi-tui wraps its ellipsis in SGR resets, which
 * would end a selected row's reverse video early; these inputs carry no ESC. */
const clip = (plain: string, width: number) =>
  cut(plain, width).replaceAll("\x1b[0m", "");

/** Z3: `● main`, an optional `+K more`, then one row per visible agent:
 * `<status> <kind> <activity…> <elapsed> [· ↓in [↑out]]`. */
export function panelLines(
  f: PanelFrame,
  width: number,
  paint: Paint,
): string[] {
  if (f.agents.length === 0 && !f.showEmpty) return [];
  const marked = f.focus === "panel";
  const marker = (selected: boolean) => (!marked ? "" : selected ? "▶" : " ");
  const row = (selected: boolean, plain: string, painted: string) => {
    if (!selected) return cut(painted, width);
    const cell = clip(plain, width);
    return paint("selected", cell + " ".repeat(width - visibleWidth(cell)));
  };
  const onMain = f.selected === undefined;
  const lines = [
    row(
      marked && onMain,
      `${marker(onMain)}● main`,
      `${marker(onMain)}${paint(f.view === undefined ? "accent" : "dim", "●")} main`,
    ),
  ];
  const { rows, hidden } = visibleAgents(f.agents, f.maxRows, [
    f.selected,
    f.view,
  ]);
  if (hidden > 0)
    lines.push(
      cut(`${marker(false)}${paint("dim", `  +${hidden} more`)}`, width),
    );
  const kindWidth = Math.min(
    12,
    Math.max(7, ...rows.map((a) => visibleWidth(a.kind))),
  );
  for (const a of rows) {
    const selected = marked && f.selected === a.id;
    const [symbol, role] = statusSymbol(a, f.frame);
    const kind = clip(a.kind, kindWidth);
    const kindCell = kind + " ".repeat(kindWidth - visibleWidth(kind));
    const used = usage(a);
    const right = `${elapsedText(a, f.now).padStart(8)}${used ? ` · ${used}` : ""}`;
    const head = `${marker(selected)}${symbol} ${kindCell}  `;
    const room = width - visibleWidth(head) - visibleWidth(right) - 2;
    const failed = a.status === "error" && a.error;
    const activity = room < 4 ? "" : clip(failed || a.activity, room);
    const gap = " ".repeat(room < 4 ? 1 : room - visibleWidth(activity) + 2);
    lines.push(
      row(
        selected,
        head + activity + gap + right,
        `${marker(selected)}${paint(role, symbol)} ${kindCell}  ${
          failed ? paint("error", activity) : activity
        }${gap}${paint("dim", right)}`,
      ),
    );
  }
  return lines;
}

/** Bottom of Z1: launched/waiting block while any agent runs, then one
 * finished line with the outcome counts. */
export function summaryLines(
  agents: SubagentState[],
  width: number,
  paint: Paint,
  maxLabels: number,
): string[] {
  if (agents.length === 0) return [];
  const n = agents.length;
  const running = agents.filter((a) => a.status === "running").length;
  if (running === 0) {
    const count = (status: SubagentStatus) =>
      agents.filter((a) => a.status === status).length;
    const cancelled = count("cancelled");
    const outcome = `ok=${count("done")}, failed=${count("error")}${
      cancelled ? `, cancelled=${cancelled}` : ""
    }`;
    return [
      cut(
        `${paint("success", "✔")} ${n} background agent${s(n)} finished (${outcome}) — select a row below and press Enter to review`,
        width,
      ),
    ];
  }
  // Running agents first, so a new one is never hidden behind finished ones.
  const shown = [
    ...agents.filter((a) => a.status === "running"),
    ...agents.filter((a) => a.status !== "running"),
  ].slice(0, maxLabels);
  const more = n - shown.length;
  const tree = shown.map((a, i) =>
    cut(
      `  ${paint("dim", i === shown.length - 1 && !more ? "└" : "├")} ${a.label}`,
      width,
    ),
  );
  if (more) tree.push(cut(`  ${paint("dim", "└")} … +${more} more`, width));
  return [
    cut(
      `${paint("accent", "●")} ${n} background agent${s(n)} launched (↓ to manage)`,
      width,
    ),
    ...tree,
    cut(
      `${paint("dim", "*")} Waiting for ${running} background agent${s(running)} to finish`,
      width,
    ),
  ];
}

export type PanelKey =
  | "down"
  | "up"
  | "next"
  | "previous"
  | "enter"
  | "escape"
  | "interrupt"
  | "pageUp"
  | "pageDown"
  | "halfUp"
  | "halfDown"
  | "home"
  | "end"
  | "other";
/** `pass` leaves the key to Pi; `open`/`close` show or leave an agent view. */
export type PanelAction = "pass" | "consume" | "open" | "close";
export interface Scroll {
  top: number;
  /** Stick to the newest line as the transcript grows. */
  follow: boolean;
}

/** Focus model. F_input (default) passes every key except ↓ on an idle, empty
 * editor; F_panel moves the Z3 selection; an agent view keeps F_panel and
 * replaces the main view until Esc, Ctrl+C or Enter on main. */
export class PanelFocus {
  focus: "input" | "panel" = "input";
  selected: string | undefined;
  view: string | undefined;
  /** Rows of the last rendered agent view, for paging. */
  page = 10;
  private readonly scrolls = new Map<string, Scroll>();
  constructor(private readonly store: SubagentStore) {}

  key(key: PanelKey, editorIdle: boolean): PanelAction {
    if (this.focus === "input" && this.view === undefined) {
      if (key !== "down" || !editorIdle || this.store.size === 0) return "pass";
      this.focus = "panel";
      this.selected = this.store.ordered()[0].id;
      return "consume";
    }
    const rows = [undefined, ...this.store.ordered().map((a) => a.id)];
    const at = Math.max(0, rows.indexOf(this.selected));
    switch (key) {
      case "up":
      case "previous":
        // ↑ past main returns to the input, the inverse of ↓.
        if (at === 0 && this.view === undefined) this.focus = "input";
        else this.selected = rows[Math.max(0, at - 1)];
        return "consume";
      case "down":
      case "next":
        this.selected = rows[Math.min(rows.length - 1, at + 1)];
        return "consume";
      case "enter":
        if (this.selected === undefined) {
          if (this.view !== undefined) return this.leave();
          this.focus = "input";
          return "consume";
        }
        if (this.view === undefined) {
          this.view = this.selected;
          return "open";
        }
        this.view = this.selected;
        return "consume";
      case "escape":
      case "interrupt":
        if (this.view !== undefined) return this.leave();
        this.focus = "input";
        // Ctrl+C keeps Pi's own clear/interrupt/exit meaning.
        return key === "escape" ? "consume" : "pass";
      case "pageUp":
      case "pageDown":
      case "halfUp":
      case "halfDown":
      case "home":
      case "end":
        if (this.view !== undefined) {
          this.scroll(this.view, key);
          return "consume";
        }
        // The main transcript scrolls itself; Ctrl+U/D must not edit or exit.
        return key === "halfUp" || key === "halfDown" ? "consume" : "pass";
      default:
        if (this.view !== undefined) return "consume";
        this.focus = "input";
        return "pass";
    }
  }
  /** Pi replaced the agent view (another dialog took the editor slot). */
  abandon(): void {
    this.view = undefined;
    this.focus = "input";
  }
  /** Top line for this view, remembered per agent across switches. */
  settle(id: string, total: number, height: number): number {
    const s = this.scrolls.get(id) ?? { top: 0, follow: true };
    const max = Math.max(0, total - height);
    const top = s.follow ? max : Math.min(Math.max(0, s.top), max);
    this.scrolls.set(id, { top, follow: top >= max });
    this.page = Math.max(1, height);
    return top;
  }
  scrollOf(id: string): Scroll | undefined {
    return this.scrolls.get(id);
  }
  private leave(): PanelAction {
    this.view = undefined;
    return "close";
  }
  private scroll(id: string, key: PanelKey): void {
    const s = this.scrolls.get(id) ?? { top: 0, follow: true };
    const step =
      key === "pageUp" || key === "pageDown"
        ? Math.max(1, this.page - 1)
        : Math.max(1, Math.floor(this.page / 2));
    const sign = key === "pageUp" || key === "halfUp" ? -1 : 1;
    this.scrolls.set(
      id,
      key === "home"
        ? { top: 0, follow: false }
        : key === "end"
          ? { top: s.top, follow: true }
          : { top: s.top + sign * step, follow: false },
    );
  }
}
