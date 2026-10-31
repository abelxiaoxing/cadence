/** Cadence service children on the background-agent panel. Observation only:
 * a Pi TUI session attaches to the owner already running for its workspace
 * (never starting one), polls the active task roster and task snapshots plus
 * the conversation-workflow roster and runs, and announces each child run
 * (task children and workflow research/implementation/review subagents) on
 * Pi's `subagent:*` bus. Reads go through the
 * typed ServiceClient; nothing here starts, cancels, retries or keeps work
 * alive, and leaving the session only detaches. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SUBAGENT_EVENTS, SUBAGENT_VIEW } from "./agent-panel-model.ts";
import { departure, NativeConnection } from "./native-client.ts";
import type { ChatTurn } from "./service/contracts/workbench.ts";
import type {
  WorkflowRun,
  WorkflowStep,
} from "./service/contracts/workflow.ts";
import type { ServiceClient } from "./service-client.ts";
import {
  type ContentRef,
  type GraphReadRequest,
  type HistoryRecord,
  LIMITS,
  type ListRequest,
  type ReadCursor,
  type RunProjection,
  type Snapshot,
} from "./service-contract.ts";

/** The NativeConnection surface the feed uses; tests substitute it. */
export interface FeedConnection {
  attach(cwd: string): Promise<FeedClient>;
  refresh(): Promise<unknown>;
  compatible(): boolean;
  detach(): Promise<void>;
  /** Drop an attachment whose owner the registry proves gone or replaced. */
  forgetSuperseded?(cwd: string): boolean;
}
/** Readonly ServiceClient reads only: no command, preflight or Cancel. */
export type FeedClient = Pick<
  ServiceClient,
  | "activeRuns"
  | "snapshot"
  | "graph"
  | "messages"
  | "tools"
  | "contents"
  | "detail"
  | "workbenchRead"
>;
export interface CadenceFeedOptions {
  connection?: () => FeedConnection;
  now?: () => number;
  timing?: Partial<FeedTiming>;
}
export interface FeedTiming {
  firstMs: number;
  activeMs: number;
  idleMs: number;
  retryMs: number;
}

/** First look waits for Pi's startup render; workspace resolution runs Git. */
export const FEED_TIMING: FeedTiming = {
  firstMs: 500,
  activeMs: 2000,
  idleMs: LIMITS.heartbeatMs,
  retryMs: 15_000,
};
/** Retained reads are paged; a child larger than this stays in /cadence-history. */
const MAX_PAGES = 50;
const MAX_DETAIL_STEPS = 8;
/** Characters of one field shown in the panel; the rest stays retained. */
const TEXT_CAP = 64 * 1024;
const CACHE_CHARS = 16 * 1024 * 1024;
/** Snapshots after an episode drained, while its children still look unsettled. */
const DRAIN_LOOKS = 5;
/** A running workflow subagent not shown in a view refreshes its activity at
 * most this often; its retained transcript is one bounded owner file. */
const WORKFLOW_ACTIVITY_MS = 10_000;
const WORKFLOW_KINDS: Partial<Record<WorkflowStep["kind"], string>> = {
  research: "Research",
  implementation: "Implementation",
  review: "Review",
};

type Child = {
  id: string;
  /** Assignment ID: rows lead with it, since kinds repeat. */
  label: string;
  runId: string;
  storeId: string;
  /** Committed watermark of the latest snapshot that showed this child. */
  seq: string;
  lifecycle: RunProjection["lifecycle"];
  ended: boolean;
  activity: string;
  /** Activity from the latest tools read, shown while the child is running. */
  working?: string;
  toolsSeq?: string;
  transcriptSeq?: string;
  /** A transcript read failed at this watermark; reopening the view retries. */
  failedSeq?: string;
  /** Final transcript messages already announced. */
  sent: number;
  /** A conversation-workflow subagent, read through workflow transcripts. */
  workflow?: {
    runId: string;
    stepId: string;
    /** The final transcript was announced after the step ended. */
    done?: boolean;
    readAt?: number;
  };
};
type Tool = Extract<HistoryRecord, { kind: "tool" }>;
type Block = { index: number; ref: ContentRef };
type Built = { messages: object[]; partial?: object; tools: Tool[] };

/** Process-wide: children keep their announced state across sessions, like the
 * panel's store, so a later session never announces one twice. */
class FeedState {
  readonly children = new Map<string, Child>();
  readonly purposes = new Map<string, Map<string, string>>();
  readonly texts = new Map<string, string>();
  cached = 0;
  viewing: string | undefined;
  remember(key: string, text: string): void {
    if (this.cached + text.length > CACHE_CHARS) {
      this.texts.clear();
      this.cached = 0;
    }
    this.texts.set(key, text);
    this.cached += text.length;
  }
}

export function registerCadenceAgentFeed(
  pi: ExtensionAPI,
  options: CadenceFeedOptions = {},
): void {
  const state = new FeedState();
  let feed: Feed | undefined;
  pi.events.on(SUBAGENT_VIEW, (data) => {
    const id = (data as { id?: unknown } | undefined)?.id;
    state.viewing = typeof id === "string" ? id : undefined;
    const child = state.viewing && state.children.get(state.viewing);
    if (child) child.failedSeq = undefined;
    feed?.wake();
  });
  const stop = () => {
    const leaving = feed?.stop();
    feed = undefined;
    return leaving ?? Promise.resolve();
  };
  pi.on("session_start", (_event, ctx) => {
    void stop();
    if (
      ctx.mode !== "tui" ||
      !ctx.hasUI ||
      process.env.CADENCE_AGENT_PANEL === "off"
    )
      return;
    feed = new Feed(pi, ctx.cwd, state, options);
  });
  pi.on("session_shutdown", () => departure(stop()));
}

const label = (purpose: string | undefined, kind: string) =>
  purpose
    ? purpose[0].toUpperCase() + purpose.slice(1)
    : kind === "generate-plan"
      ? "Planner"
      : "Child";
function lifecycleText(row: RunProjection): string {
  switch (row.lifecycle) {
    case "queued":
      return row.reason
        ? `Queued · ${row.reason.replaceAll("-", " ")}`
        : "Queued";
    case "preparing":
      return "Preparing";
    case "closing":
      return "Finishing";
    default:
      return "Working";
  }
}
function workingText(tools: Tool[]): string {
  const last = tools.at(-1);
  if (!last) return "Working";
  if (last.result === null) return `Running ${last.name}`;
  const n = tools.length;
  return `Working · ${n} tool call${n === 1 ? "" : "s"} (last: ${last.name})`;
}
/** Final or execution arguments are canonical JSON; anything else shows none. */
function parseArgs(text: string | undefined): object {
  try {
    const value = text === undefined ? {} : JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  } catch {
    return {};
  }
}
const capped = (text: string) =>
  text.length > TEXT_CAP
    ? `${text.slice(0, TEXT_CAP)}\n… (truncated; the project owner retains the full text)`
    : text;
/** A workflow step transcript in Pi's message shapes. Each assistant message
 * carries its tool calls, followed by their results; while the turn runs, its
 * last group may still grow and is a streaming snapshot. */
export function turnMessages(
  turn: ChatTurn,
  finished: boolean,
): { messages: object[]; partial?: object } {
  const messages: object[] = [];
  let group:
    | { assistant: { role: string; content: object[] }; results: object[] }
    | undefined;
  const close = () => {
    if (group) messages.push(group.assistant, ...group.results);
    group = undefined;
  };
  for (const item of turn.items) {
    if (item.role === "user") {
      close();
      messages.push({
        role: "user",
        content: [{ type: "text", text: capped(item.text) }],
      });
    } else if (item.role === "assistant") {
      close();
      group = {
        assistant: {
          role: "assistant",
          content: item.text ? [{ type: "text", text: capped(item.text) }] : [],
        },
        results: [],
      };
    } else {
      group ??= { assistant: { role: "assistant", content: [] }, results: [] };
      const name = item.name || "tool";
      group.assistant.content.push({
        type: "toolCall",
        id: item.id,
        name,
        arguments: parseArgs(item.args),
      });
      group.results.push({
        role: "toolResult",
        toolCallId: item.id,
        toolName: name,
        content: [{ type: "text", text: capped(item.text) }],
        isError: item.error,
      });
    }
  }
  if (finished || !group) {
    close();
    return { messages };
  }
  return { messages, partial: group.assistant };
}
function turnWorking(turn: ChatTurn, finished: boolean): string {
  const tools = turn.items.filter((i) => i.role === "tool");
  const last = tools.at(-1);
  if (!last) return "Working";
  if (!finished && turn.items.at(-1) === last && !last.text && !last.error)
    return `Running ${last.name || "tool"}`;
  const n = tools.length;
  return `Working · ${n} tool call${n === 1 ? "" : "s"} (last: ${last.name || "tool"})`;
}

class Feed {
  private client: FeedClient | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private busy = false;
  private woken = false;
  private stopped = false;
  private readonly abort = new AbortController();
  private readonly connection: FeedConnection;
  private readonly now: () => number;
  private readonly timing: FeedTiming;
  /** Parent run → task, followed until a snapshot after it left the roster. */
  private readonly episodes = new Map<
    string,
    { taskId: string; drained: number }
  >();
  /** Conversation workflow → consecutive unreadable looks, followed until
   * its run is observed finished. */
  private readonly workflows = new Map<string, number>();
  constructor(
    private readonly pi: ExtensionAPI,
    private readonly cwd: string,
    private readonly state: FeedState,
    options: CadenceFeedOptions,
  ) {
    this.connection = options.connection?.() ?? new NativeConnection();
    this.now = options.now ?? Date.now;
    this.timing = { ...FEED_TIMING, ...options.timing };
    this.schedule(this.timing.firstMs);
  }
  stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    this.abort.abort();
    // Detach this observer only; accepted work continues in the service.
    return this.connection.detach().catch(() => {});
  }
  /** The viewed agent changed: load its transcript now if attached. */
  wake(): void {
    if (this.busy) this.woken = true;
    else if (this.client) this.schedule(0);
  }
  private schedule(ms: number): void {
    clearTimeout(this.timer);
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), ms);
    // Observation never keeps Pi alive.
    this.timer.unref?.();
  }
  private emit(event: keyof typeof SUBAGENT_EVENTS, data: object): void {
    if (!this.stopped) this.pi.events.emit(SUBAGENT_EVENTS[event], data);
  }
  private async tick(): Promise<void> {
    if (this.stopped || this.busy) return;
    this.busy = true;
    this.woken = false;
    let next = this.timing.retryMs;
    const attaching = !this.client;
    try {
      if (!this.client) {
        const client = await this.connection.attach(this.cwd);
        if (this.stopped) {
          // stop() may have detached before this allocation existed.
          await this.connection.detach().catch(() => {});
          return;
        }
        if (!this.connection.compatible()) throw new Error("incompatible");
        this.client = client;
      }
      next = await this.observe(this.client);
    } catch {
      // Absent, stopped, restarted or incompatible owner: detach and look
      // again later. Observation never starts one. An owner the registry
      // proves gone or replaced cannot accept a detach (a restarted one on the
      // same port refuses the old capability), so its attachment is dropped.
      this.client = undefined;
      if (!this.connection.forgetSuperseded?.(this.cwd))
        await this.connection.detach().catch(() => {});
      // Still no compatible owner a whole retry after losing it: the children
      // followed so far can no longer be observed from this session.
      if (attaching) {
        this.abandon([...this.episodes.keys()], "owner unavailable");
        for (const runId of [...this.workflows.keys()])
          this.abandonWorkflow(runId, "owner unavailable");
      }
    } finally {
      this.busy = false;
    }
    this.schedule(this.woken ? 0 : next);
  }

  private async observe(client: FeedClient): Promise<number> {
    const signal = this.abort.signal;
    const roster = await client.activeRuns(signal);
    if (roster.kind === "error" || roster.value.status !== "complete") {
      // stop() aborted this read; a session request now would race its detach.
      if (this.stopped) return this.timing.activeMs;
      // Throws when the owner is gone or restarted; otherwise look again soon.
      await this.connection.refresh();
      return this.timing.activeMs;
    }
    const active = new Set<string>();
    for (const run of roster.value.runs) {
      active.add(run.runId);
      this.episodes.set(run.runId, { taskId: run.taskId, drained: 0 });
    }
    const ends: object[] = [];
    for (const taskId of new Set(
      [...this.episodes.values()].map((e) => e.taskId),
    )) {
      const reply = await client.snapshot({ kind: "task", id: taskId }, signal);
      if (this.stopped) return this.timing.activeMs;
      for (const [runId, episode] of this.episodes) {
        if (episode.taskId !== taskId) continue;
        // A refused snapshot drains a finished episode like an unsettled one.
        const open =
          reply.kind === "error" ||
          (await this.follow(client, reply.value, runId, ends));
        if (active.has(runId)) continue;
        if (!open) this.episodes.delete(runId);
        else if (++episode.drained >= DRAIN_LOOKS)
          this.abandon([runId], "no settled row after the run ended");
      }
    }
    await this.observeWorkflows(client, ends);
    if (this.stopped) return this.timing.activeMs;
    await this.refreshActivity(client);
    await this.refreshTranscript(client);
    // Ends follow the transcript so its last streaming snapshot is replaced
    // by the final message rather than kept beside it.
    for (const end of ends) this.emit("end", end);
    return this.episodes.size || this.workflows.size
      ? this.timing.activeMs
      : this.timing.idleMs;
  }

  /** Conversation-workflow subagents: the live roster names runs, each run
   * read names its steps' child IDs. Readonly; an older owner without these
   * reads leaves only task children. */
  private async observeWorkflows(
    client: FeedClient,
    ends: object[],
  ): Promise<void> {
    if (typeof client.workbenchRead !== "function") return;
    const signal = this.abort.signal;
    const roster = await client.workbenchRead(
      { kind: "workflow-active" },
      signal,
    );
    if (this.stopped) return;
    const live = new Set<string>();
    if (roster.kind === "ok" && roster.value.kind === "workflow-active")
      for (const run of roster.value.runs) {
        live.add(run.id);
        if (!this.workflows.has(run.id)) this.workflows.set(run.id, 0);
      }
    for (const [runId, misses] of [...this.workflows]) {
      const reply = await client.workbenchRead(
        { kind: "workflow", id: runId },
        signal,
      );
      if (this.stopped) return;
      if (
        reply.kind === "error" ||
        reply.value.kind !== "workflow" ||
        reply.value.response.type !== "run" ||
        reply.value.response.run.id !== runId
      ) {
        if (misses + 1 >= DRAIN_LOOKS)
          this.abandonWorkflow(runId, "workflow not readable");
        else this.workflows.set(runId, misses + 1);
        continue;
      }
      this.workflows.set(runId, 0);
      const run = reply.value.response.run;
      const open =
        live.has(runId) || ["queued", "running"].includes(run.status);
      for (const step of run.steps) this.followStep(run, step, open, ends);
      if (!open) this.workflows.delete(runId);
    }
  }
  private followStep(
    run: WorkflowRun,
    step: WorkflowStep,
    open: boolean,
    ends: object[],
  ): void {
    const kind = WORKFLOW_KINDS[step.kind];
    if (!step.childRunId || !kind) return;
    const id = step.childRunId;
    // A step still marked running in a finished run did not report its end.
    const outcome =
      step.status === "running" ? (open ? null : "unknown") : step.status;
    let child = this.state.children.get(id);
    if (!child) {
      child = {
        id,
        label: step.id,
        runId: `workflow:${run.id}`,
        storeId: "",
        seq: "",
        lifecycle: outcome ? "settled" : "running",
        ended: false,
        activity: "",
        sent: 0,
        workflow: { runId: run.id, stepId: step.id },
      };
      this.state.children.set(id, child);
      this.emit("start", {
        id,
        label: step.id,
        kind,
        // A subagent first seen settled ran before this session looked.
        startedAt: outcome ? null : this.now(),
      });
    }
    if (child.ended) return;
    if (!outcome) {
      this.activity(child, child.working ?? `Working · ${run.phase}`);
      return;
    }
    child.lifecycle = "settled";
    this.activity(child, outcome);
    child.ended = true;
    ends.push({
      id,
      status:
        outcome === "completed"
          ? "done"
          : outcome === "canceled"
            ? "cancelled"
            : "error",
      endedAt: this.now(),
      ...(outcome === "completed" || outcome === "canceled"
        ? {}
        : { error: `${child.label} · ${outcome}` }),
    });
  }
  private abandonWorkflow(runId: string, why: string): void {
    this.workflows.delete(runId);
    for (const child of this.state.children.values()) {
      if (child.workflow?.runId !== runId || child.ended) continue;
      this.activity(child, "outcome not observed");
      child.ended = true;
      this.emit("end", {
        id: child.id,
        status: "error",
        endedAt: this.now(),
        error: `${child.label} · outcome not observed here (${why}); ask cadence_status or open the WebUI`,
      });
    }
  }
  /** Reads one workflow step transcript; undefined when it is unreadable. */
  private async workflowTurn(
    client: FeedClient,
    child: Child,
  ): Promise<ChatTurn | null | undefined> {
    const w = child.workflow;
    if (!w || typeof client.workbenchRead !== "function") return undefined;
    w.readAt = this.now();
    const reply = await client.workbenchRead(
      { kind: "workflow-transcript", id: w.runId, stepId: w.stepId },
      this.abort.signal,
    );
    if (
      reply.kind === "error" ||
      reply.value.kind !== "workflow-transcript" ||
      reply.value.runId !== w.runId ||
      reply.value.stepId !== w.stepId
    )
      return undefined;
    return reply.value.turn;
  }
  private async refreshWorkflowTranscript(
    client: FeedClient,
    child: Child,
  ): Promise<void> {
    const w = child.workflow;
    if (!w || w.done || child.failedSeq !== undefined) return;
    const turn = await this.workflowTurn(client, child);
    if (this.stopped) return;
    if (turn === undefined) {
      // Reopening the view retries, like a failed task transcript read.
      child.failedSeq = "workflow";
      return;
    }
    if (!turn) return;
    const finished = !["queued", "running"].includes(turn.status);
    const built = turnMessages(turn, finished);
    child.working = turnWorking(turn, finished);
    if (!child.ended) this.activity(child, child.working);
    for (let i = child.sent; i < built.messages.length; i++)
      this.emit("message", { id: child.id, message: built.messages[i] });
    child.sent = Math.max(child.sent, built.messages.length);
    if (built.partial)
      this.emit("message", {
        id: child.id,
        message: built.partial,
        streaming: true,
      });
    if (finished && child.ended) w.done = true;
  }

  /** Announce this episode's children; true while any still looks unsettled. */
  private async follow(
    client: FeedClient,
    snapshot: Snapshot,
    runId: string,
    ends: object[],
  ): Promise<boolean> {
    const rows = snapshot.runs.filter(
      (r) => r.runId === runId && r.childRunId !== null,
    );
    // A check has no children: follow it only until its own row settles.
    if (!rows.length)
      return !snapshot.runs.some(
        (r) => r.runId === runId && !r.childRunId && r.lifecycle === "settled",
      );
    const purposes = await this.purposes(client, snapshot, rows[0]);
    let open = false;
    for (const row of rows) {
      const id = row.childRunId as string;
      const settled = row.lifecycle === "settled";
      open ||= !settled;
      let child = this.state.children.get(id);
      if (!child) {
        child = {
          id,
          label: row.assignmentId ?? id,
          runId,
          storeId: snapshot.storeId,
          seq: snapshot.committedSeq,
          lifecycle: row.lifecycle,
          ended: false,
          activity: "",
          sent: 0,
        };
        this.state.children.set(id, child);
        this.emit("start", {
          id,
          label: child.label,
          kind: label(purposes.get(row.assignmentId ?? ""), row.admission.kind),
          // A child first seen settled ran before this session looked.
          startedAt: settled ? null : this.now(),
        });
      }
      child.storeId = snapshot.storeId;
      child.seq = snapshot.committedSeq;
      child.lifecycle = row.lifecycle;
      if (child.ended) continue;
      if (settled) {
        const outcome = row.outcome ?? "unknown";
        // The row keeps its last activity after the end; make it the outcome.
        this.activity(child, outcome);
        child.ended = true;
        ends.push({
          id,
          status:
            outcome === "completed"
              ? "done"
              : outcome === "canceled"
                ? "cancelled"
                : "error",
          endedAt: this.now(),
          ...(outcome === "completed" || outcome === "canceled"
            ? {}
            : {
                error: `${child.label} · ${outcome}${
                  row.reason ? ` (${row.reason.replaceAll("-", " ")})` : ""
                }`,
              }),
        });
        continue;
      }
      this.activity(
        child,
        row.lifecycle === "running"
          ? (child.working ?? "Working")
          : lifecycleText(row),
      );
    }
    return open;
  }
  /** Stop following these episodes. Their unsettled children end as errors
   * that say the outcome was not observed, instead of spinning as running for
   * the rest of the session; /cadence-history keeps the actual outcome. */
  private abandon(runIds: string[], why: string): void {
    for (const runId of runIds) {
      this.episodes.delete(runId);
      for (const child of this.state.children.values()) {
        if (child.runId !== runId || child.ended) continue;
        this.activity(child, "outcome not observed");
        child.ended = true;
        this.emit("end", {
          id: child.id,
          status: "error",
          endedAt: this.now(),
          error: `${child.label} · outcome not observed here (${why}); see /cadence-history`,
        });
      }
    }
  }
  private activity(child: Child, text: string): void {
    const activity = `${child.label} · ${text}`;
    if (child.ended || activity === child.activity) return;
    child.activity = activity;
    this.emit("activity", { id: child.id, activity });
  }
  /** Assignment purposes from the admitted graph, read once per episode. */
  private async purposes(
    client: FeedClient,
    snapshot: Snapshot,
    row: RunProjection,
  ): Promise<Map<string, string>> {
    const cached = this.state.purposes.get(row.runId);
    if (cached) return cached;
    const purposes = new Map<string, string>();
    const graph = row.admission.graph;
    if (graph) {
      let request: GraphReadRequest = {
        storeId: snapshot.storeId,
        scope: { kind: "run", id: row.runId },
        snapshotSeq: snapshot.committedSeq,
        graph,
      };
      for (let step = 0; step < MAX_DETAIL_STEPS; step++) {
        const reply = await client.graph(request, this.abort.signal);
        if (reply.kind === "error") break;
        if (!("kind" in reply.value)) {
          for (const a of reply.value.graph.assignments)
            purposes.set(a.id, a.purpose);
          break;
        }
        request = reply.value.next;
      }
    }
    // A failed read falls back to a generic kind rather than rereading.
    this.state.purposes.set(row.runId, purposes);
    return purposes;
  }

  /** Latest tool for running children not shown in a view (that read covers it). */
  private async refreshActivity(client: FeedClient): Promise<void> {
    for (const child of this.state.children.values()) {
      if (child.workflow) {
        if (
          child.ended ||
          child.id === this.state.viewing ||
          !this.workflows.has(child.workflow.runId) ||
          this.now() - (child.workflow.readAt ?? 0) < WORKFLOW_ACTIVITY_MS
        )
          continue;
        const turn = await this.workflowTurn(client, child);
        if (this.stopped || !turn) continue;
        child.working = turnWorking(
          turn,
          !["queued", "running"].includes(turn.status),
        );
        this.activity(child, child.working);
        continue;
      }
      if (
        child.ended ||
        child.lifecycle !== "running" ||
        child.id === this.state.viewing ||
        child.toolsSeq === child.seq ||
        // Another session's workspace: not this owner's to read.
        !this.episodes.has(child.runId)
      )
        continue;
      const tools = await this.records(client, "tools", child);
      if (!tools) continue;
      child.toolsSeq = child.seq;
      child.working = workingText(tools as Tool[]);
      this.activity(child, child.working);
    }
  }
  private async refreshTranscript(client: FeedClient): Promise<void> {
    const id = this.state.viewing;
    const child = id === undefined ? undefined : this.state.children.get(id);
    if (child?.workflow) return this.refreshWorkflowTranscript(client, child);
    if (
      !child ||
      child.transcriptSeq === child.seq ||
      child.failedSeq === child.seq
    )
      return;
    const seq = child.seq;
    const built = await this.transcript(client, child);
    if (this.stopped) return;
    if (!built) {
      child.failedSeq = seq;
      return;
    }
    child.transcriptSeq = seq;
    child.toolsSeq = seq;
    child.working = workingText(built.tools);
    if (child.lifecycle === "running") this.activity(child, child.working);
    for (let i = child.sent; i < built.messages.length; i++)
      this.emit("message", { id: child.id, message: built.messages[i] });
    child.sent = Math.max(child.sent, built.messages.length);
    if (built.partial)
      this.emit("message", {
        id: child.id,
        message: built.partial,
        streaming: true,
      });
  }

  private async records(
    client: FeedClient,
    reader: "messages" | "tools" | "contents",
    child: Child,
  ): Promise<HistoryRecord[] | undefined> {
    let request: ListRequest = {
      reader,
      storeId: child.storeId,
      scope: { kind: "child", id: child.id },
      snapshotSeq: child.seq,
      after: null,
      limit: LIMITS.maxPageEntries,
    };
    const records: HistoryRecord[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const reply = await client[reader](request, this.abort.signal);
      if (reply.kind === "error") return undefined;
      if (!("kind" in reply.value)) records.push(...reply.value.records);
      if (!reply.value.next) return records;
      request = reply.value.next;
    }
    return undefined;
  }
  /** One retained field's leading text, cached by its immutable reference. */
  private async text(
    client: FeedClient,
    child: Child,
    ref: ContentRef,
  ): Promise<string | undefined> {
    const key = `${ref.recordId}:${ref.version}:${ref.field}:${ref.sha256}`;
    const hit = this.state.texts.get(key);
    if (hit !== undefined) return hit;
    let cursor: ReadCursor | null = {
      storeId: child.storeId,
      scope: { kind: "child", id: child.id },
      snapshotSeq: child.seq,
      query: null,
      recordId: ref.recordId,
      recordVersion: ref.version,
      field: ref.field,
      offset: 0,
    };
    let text = "";
    for (let step = 0; cursor && step < MAX_DETAIL_STEPS; step++) {
      const reply = await client.detail(cursor, this.abort.signal);
      if (reply.kind === "error") return undefined;
      if (!("kind" in reply.value)) text += reply.value.text;
      cursor = reply.value.next;
      if (text.length >= TEXT_CAP) break;
    }
    // One detail page can exceed the cap on its own, with no cursor left.
    if (cursor || text.length > TEXT_CAP)
      text = `${text.slice(0, TEXT_CAP)}\n… (truncated; the full text is in /cadence-history)`;
    this.state.remember(key, text);
    return text;
  }
  private async joined(
    client: FeedClient,
    child: Child,
    blocks: Block[] | undefined,
  ): Promise<string | undefined> {
    const parts: string[] = [];
    for (const block of [...(blocks ?? [])].sort((a, b) => a.index - b.index)) {
      const text = await this.text(client, child, block.ref);
      if (text === undefined) return undefined;
      parts.push(text);
    }
    return parts.join("\n");
  }
  /** The child's retained messages in Pi's message shapes: user prompt,
   * assistant text with its tool calls, and tool results. A partial message
   * ends the list as a streaming snapshot. */
  private async transcript(
    client: FeedClient,
    child: Child,
  ): Promise<Built | undefined> {
    const messages = await this.records(client, "messages", child);
    const tools = (await this.records(client, "tools", child)) as
      | Tool[]
      | undefined;
    const contents = await this.records(client, "contents", child);
    if (!messages || !tools || !contents) return undefined;
    const args = new Map<string, ContentRef>(),
      results = new Map<string, Block[]>(),
      finals = new Map<string, Block[]>(),
      streams = new Map<string, Block[]>();
    const push = (map: Map<string, Block[]>, key: string, block: Block) =>
      map.set(key, [...(map.get(key) ?? []), block]);
    for (const r of contents) {
      if (r.kind !== "content") continue;
      const owner = r.descriptor.owner;
      if (owner.kind === "tool") {
        if (
          owner.stage === "execution-arguments" ||
          (owner.stage === "arguments-final" && !args.has(owner.callId))
        )
          args.set(owner.callId, r.content);
        else if (owner.stage === "result")
          push(results, owner.callId, { index: owner.index, ref: r.content });
      } else if (owner.kind === "message")
        push(owner.stage === "final" ? finals : streams, owner.messageId, {
          index: owner.index,
          ref: r.content,
        });
    }
    const calls = new Map<string, Tool[]>(),
      byId = new Map<string, Tool>();
    for (const tool of tools) {
      byId.set(tool.owner.entity.id, tool);
      const message = tool.declaration?.messageId;
      if (message) calls.set(message, [...(calls.get(message) ?? []), tool]);
    }
    const built: Built = { messages: [], tools };
    for (const m of messages) {
      if (m.kind !== "message") continue;
      const id = m.owner.entity.id;
      // Only assistant messages carry a derived final text; a user prompt
      // keeps its final blocks, a partial message its stream blocks.
      const blocks =
        m.role === "tool-result" && m.resultCallId
          ? results.get(m.resultCallId)
          : (finals.get(id) ?? streams.get(id));
      const text = m.finalText
        ? await this.text(client, child, m.finalText)
        : await this.joined(client, child, blocks);
      if (text === undefined) return undefined;
      let message: object;
      if (m.role === "user")
        message = { role: "user", content: [{ type: "text", text }] };
      else if (m.role === "assistant") {
        const content: object[] = text ? [{ type: "text", text }] : [];
        for (const tool of calls.get(id) ?? []) {
          const ref = args.get(tool.owner.entity.id);
          const raw = ref ? await this.text(client, child, ref) : undefined;
          if (ref && raw === undefined) return undefined;
          content.push({
            type: "toolCall",
            id: tool.owner.entity.id,
            name: tool.name,
            arguments: parseArgs(raw),
          });
        }
        message = { role: "assistant", content };
      } else {
        const tool = m.resultCallId ? byId.get(m.resultCallId) : undefined;
        message = {
          role: "toolResult",
          toolCallId: m.resultCallId ?? "",
          toolName: tool?.name ?? "tool",
          content: [{ type: "text", text }],
          isError: tool?.result?.isError === true,
        };
      }
      if (m.state !== "final") {
        built.partial = message;
        break;
      }
      built.messages.push(message);
    }
    return built;
  }
}
