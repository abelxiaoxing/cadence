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
/** Session entry holding one finished batch's card; display only, never part
 * of the model's context. */
export const CARD_ENTRY = "cadence-agent-batch";

export type SubagentStatus =
  | "running"
  | "done"
  | "rejected"
  | "error"
  | "cancelled";
type Ended = Exclude<SubagentStatus, "running">;

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
/** Agents written into one card; more are counted, not listed. */
export const MAX_CARD_AGENTS = 64;
const ENDED = new Set(["done", "rejected", "error", "cancelled"]);

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
 * duplicate-start and post-end activity events are ignored.
 *
 * Agents whose start was observed also form batches: the first such start
 * while no batch is open opens one, later starts join it, and it stays open
 * until the panel closes it after every member ended. An agent first seen
 * with `startedAt: null` ran before anyone looked: it joins no batch, so it
 * neither reopens the live view nor repeats a card already shown. */
export class SubagentStore {
  private readonly agents = new Map<string, SubagentState>();
  private readonly listeners = new Set<() => void>();
  private batchIds: string[] = [];
  private batchOpen = false;
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
  /** The open batch's agents in start order; empty when none is open. */
  batch(): SubagentState[] {
    if (!this.batchOpen) return [];
    return this.batchIds.flatMap((id) => this.agents.get(id) ?? []);
  }
  /** The open batch has agents and none of them still runs. */
  settled(): boolean {
    const batch = this.batch();
    return batch.length > 0 && batch.every((a) => a.status !== "running");
  }
  /** Close the open batch and return its agents; the next observed start
   * opens a new one. */
  closeBatch(): SubagentState[] {
    const batch = this.batch();
    this.batchOpen = false;
    this.batchIds = [];
    return batch;
  }
  /** Drop ended agents once their batch has become a display card. An open
   * transcript already holds its own state reference; no history list stays.
   * Listeners are not called: the panel owns the redraw. */
  prune(): string[] {
    const open = new Set(this.batchOpen ? this.batchIds : []);
    const drop = [...this.agents.values()].filter(
      (a) => a.status !== "running" && !open.has(a.id),
    );
    for (const a of drop) this.agents.delete(a.id);
    return drop.map((a) => a.id);
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
      if (o.startedAt !== null) {
        if (!this.batchOpen) {
          this.batchOpen = true;
          this.batchIds = [];
        }
        this.batchIds.push(id);
      }
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
const SYMBOL: Record<Ended, [string, PaintRole]> = {
  done: ["✔", "success"],
  error: ["✘", "error"],
  rejected: ["⊘", "accent"],
  cancelled: ["○", "muted"],
};
export function statusSymbol(
  agent: Pick<SubagentState, "status">,
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
/** A row's text: the error of a failed agent, otherwise its activity, led by
 * the label unless the producer already led with it (`label · …`). */
export function described(
  agent: Pick<SubagentState, "label" | "activity" | "status" | "error">,
): string {
  const text =
    agent.status === "error" && agent.error ? agent.error : agent.activity;
  if (!text) return agent.label;
  return text === agent.label || text.startsWith(`${agent.label} `)
    ? text
    : `${agent.label} · ${text}`;
}

const s = (n: number) => (n === 1 ? "" : "s");
const cut = (text: string, width: number) =>
  truncateToWidth(text, Math.max(0, width), "…");
/** Plain-text truncation. pi-tui wraps its ellipsis in SGR resets, which
 * would end a selected row's reverse video early; these inputs carry no ESC. */
const clip = (plain: string, width: number) =>
  cut(plain, width).replaceAll("\x1b[0m", "");

/** One row: `<lead><status> [<kind>  ]<text…>  <facts>`, never wider than
 * `width`. A selected row is reverse video across the whole width. */
interface Row {
  symbol: [string, PaintRole];
  kind: string;
  text: string;
  failed: boolean;
  facts: string;
}
function rowLine(
  row: Row,
  lead: string,
  kindWidth: number,
  width: number,
  paint: Paint,
  selected = false,
): string {
  const [symbol, role] = row.symbol;
  const kind = kindWidth ? clip(row.kind, kindWidth) : "";
  const kindCell = kindWidth
    ? `${kind}${" ".repeat(kindWidth - visibleWidth(kind))}  `
    : "";
  const head = `${lead}${symbol} ${kindCell}`;
  const room = width - visibleWidth(head) - visibleWidth(row.facts) - 2;
  const text = room < 4 ? "" : clip(row.text, room);
  const gap = " ".repeat(room < 4 ? 1 : room - visibleWidth(text) + 2);
  if (selected) {
    const cell = clip(head + text + gap + row.facts, width);
    return paint("selected", cell + " ".repeat(width - visibleWidth(cell)));
  }
  return cut(
    `${paint("dim", lead)}${paint(role, symbol)} ${kindCell}${
      row.failed ? paint("error", text) : text
    }${gap}${paint("dim", row.facts)}`,
    width,
  );
}
const kindColumn = (kinds: string[]) =>
  Math.min(12, Math.max(7, ...kinds.map((k) => visibleWidth(k))));
/** The kind every agent shares, if any; it then names the batch instead of
 * repeating on each row. A producer's default `agent` names nothing. */
const sharedKind = (agents: { kind: string }[]) => {
  const kinds = new Set(agents.map((a) => a.kind));
  const [kind] = kinds;
  return kinds.size === 1 && kind !== "agent" ? kind : undefined;
};
/** `text` and a dim `hint` when both fit; otherwise the text alone. */
const hinted = (text: string, hint: string, width: number, paint: Paint) =>
  visibleWidth(text) + visibleWidth(hint) <= width
    ? text + paint("dim", hint)
    : cut(text, width);
const noun = (kind: string | undefined, n: number) =>
  `${kind ? `${kind} ` : ""}agent${s(n)}`;
/** Tree leads for `n` rows; the last closes the tree unless `+K more` follows. */
const tree = (n: number, more: number) =>
  Array.from({ length: n }, (_, i) => (i === n - 1 && !more ? "  └ " : "  ├ "));

/** One finished batch as written into the session: display text only. */
export interface CardAgent {
  kind: string;
  /** The row text ({@link described}) when the batch closed. */
  text: string;
  status: Ended;
  /** Milliseconds, or null when the start was never observed. */
  elapsed: number | null;
}
export interface AgentCard {
  agents: CardAgent[];
  /** Members beyond {@link MAX_CARD_AGENTS}, counted, not listed. */
  omitted: number;
  /** First observed start to last end, or null when none was timed. */
  elapsed: number | null;
}
export function cardOf(agents: SubagentState[]): AgentCard {
  const ended = agents.filter(
    (a): a is SubagentState & { status: Ended } => a.status !== "running",
  );
  const timed = ended.filter((a) => !a.untimed);
  const first = Math.min(...timed.map((a) => a.startedAt));
  const last = Math.max(...timed.map((a) => a.endedAt ?? a.startedAt));
  return {
    agents: ended.slice(0, MAX_CARD_AGENTS).map((a) => ({
      kind: a.kind,
      text: described(a),
      status: a.status,
      elapsed: a.untimed ? null : elapsedOf(a, a.startedAt),
    })),
    omitted: Math.max(0, ended.length - MAX_CARD_AGENTS),
    elapsed: timed.length ? Math.max(0, last - first) : null,
  };
}
/** A card read back from a session file, which anyone may have edited:
 * anything malformed renders nothing rather than guessed text. */
export function decodeCard(data: unknown): AgentCard | undefined {
  const o = record(data);
  if (!o || !Array.isArray(o.agents) || o.agents.length > MAX_CARD_AGENTS)
    return undefined;
  const ms = (v: unknown) => (v === null ? null : count(v));
  const agents: CardAgent[] = [];
  for (const value of o.agents) {
    const a = record(value);
    const kind = a && line(a.kind, 32);
    const text = a && line(a.text, 1024);
    const elapsed = a && ms(a.elapsed);
    if (
      !a ||
      !kind ||
      text === undefined ||
      elapsed === undefined ||
      !ENDED.has(a.status as string)
    )
      return undefined;
    agents.push({ kind, text, status: a.status as Ended, elapsed });
  }
  const omitted = count(o.omitted);
  const elapsed = ms(o.elapsed);
  if (omitted === undefined || elapsed === undefined) return undefined;
  if (agents.length + omitted === 0) return undefined;
  return { agents, omitted, elapsed };
}

/** A finished batch: `✔ 3 Research agents finished · 2m 14s`, with outcome
 * counts when any failed, rejected or was cancelled. Collapsed, it lists only those;
 * expanded, every member with its final text and elapsed time. */
export function cardLines(
  card: AgentCard,
  expanded: boolean,
  width: number,
  paint: Paint,
  hint = true,
): string[] {
  const n = card.agents.length + card.omitted;
  const tally = (status: Ended) =>
    card.agents.filter((a) => a.status === status).length;
  const failed = tally("error"),
    rejected = tally("rejected"),
    cancelled = tally("cancelled");
  const [symbol, role] =
    SYMBOL[
      failed
        ? "error"
        : rejected
          ? "rejected"
          : cancelled
            ? "cancelled"
            : "done"
    ];
  const kind = sharedKind(card.agents);
  const outcome =
    failed || rejected || cancelled
      ? ` · ${tally("done")} done${failed ? ` · ${failed} failed` : ""}${rejected ? ` · ${rejected} rejected` : ""}${
          cancelled ? ` · ${cancelled} cancelled` : ""
        }`
      : "";
  const took = card.elapsed === null ? "" : ` · ${formatElapsed(card.elapsed)}`;
  const shown = expanded
    ? card.agents
    : card.agents.filter((a) => a.status !== "done");
  const more = expanded ? card.omitted : 0;
  const header = hinted(
    `${paint(role, symbol)} ${n} ${noun(kind, n)} finished${outcome}${took}`,
    hint && !expanded ? " (ctrl+o to expand)" : "",
    width,
    paint,
  );
  const kindWidth = kind ? 0 : kindColumn(shown.map((a) => a.kind));
  const rows = shown.map((a) => ({
    symbol: SYMBOL[a.status],
    kind: a.kind,
    text: a.text,
    failed: a.status === "error",
    facts: (a.elapsed === null ? "—" : formatElapsed(a.elapsed)).padStart(8),
  }));
  const leads = tree(rows.length, more);
  const lines = [
    header,
    ...rows.map((r, i) => rowLine(r, leads[i], kindWidth, width, paint)),
  ];
  if (more) lines.push(cut(`${paint("dim", "  └ ")}… +${more} more`, width));
  return lines;
}

export interface LiveFrame {
  /** The open batch, or a kept one (`CADENCE_AGENT_PANEL=always`). */
  agents: SubagentState[];
  now: number;
  frame: number;
  /** Show the `↓ to view` hint: the input box has focus. */
  hint: boolean;
}
/** One summary line; the adapted session browser owns all agent rows. */
export function liveLines(f: LiveFrame, width: number, paint: Paint): string[] {
  const { agents } = f;
  if (agents.length === 0) return [];
  const running = agents.filter((a) => a.status === "running");
  if (running.length === 0)
    return cardLines(cardOf(agents), false, width, paint, false).slice(0, 1);
  const kind = sharedKind(agents);
  const tally = (status: SubagentStatus) =>
    agents.filter((a) => a.status === status).length;
  const done = tally("done"),
    failed = tally("error"),
    rejected = tally("rejected"),
    cancelled = tally("cancelled");
  const counts = `${done ? ` · ${done} done` : ""}${
    failed ? ` · ${failed} failed` : ""
  }${rejected ? ` · ${rejected} rejected` : ""}${cancelled ? ` · ${cancelled} cancelled` : ""}`;
  const [spin, role] = statusSymbol(running[0], f.frame);
  const header = hinted(
    `${paint(role, spin)} ${running.length} ${noun(kind, running.length)} running${counts}`,
    f.hint ? " (↓ to view)" : "",
    width,
    paint,
  );
  return [header];
}
