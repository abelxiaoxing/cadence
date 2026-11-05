/** Readonly workflow observation for this Pi conversation, never the whole
 * checkout. Attribution uses the run's immutable admission context, not copied
 * session history. Missing attribution never broadcasts. Departure detaches. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SUBAGENT_EVENTS, SUBAGENT_VIEW } from "./agent-panel-model.ts";
import { departure, NativeConnection } from "./native-client.ts";
import type { ChatTurn } from "./service/contracts/workbench.ts";
import type {
  WorkflowRun,
  WorkflowStep,
} from "./service/contracts/workflow.ts";
import type { ServiceClient } from "./service-client.ts";
import { LIMITS } from "./service-contract.ts";

/** The NativeConnection surface the feed uses; tests substitute it. */
export interface FeedConnection {
  attach(cwd: string): Promise<FeedClient>;
  refresh(): Promise<unknown>;
  compatible(): boolean;
  detach(): Promise<void>;
  forgetSuperseded?(cwd: string): boolean;
}
/** No command, preflight, Cancel or project-wide legacy task reads. */
export type FeedClient = Pick<ServiceClient, "workbenchRead">;
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
/** Characters of one field shown in the panel; the rest stays retained. */
const TEXT_CAP = 64 * 1024;
/** Consecutive unreadable looks before ending an observation as unknown. */
const DRAIN_LOOKS = 5;
/** Unviewed running children refresh their activity at most this often. */
const WORKFLOW_ACTIVITY_MS = 10_000;
const WORKFLOW_KINDS: Partial<Record<WorkflowStep["kind"], string>> = {
  research: "Research",
  implementation: "Implementation",
  review: "Review",
};
type Child = {
  id: string;
  label: string;
  runId: string;
  stepId: string;
  ended: boolean;
  activity: string;
  working?: string;
  readAt?: number;
  failed?: boolean;
  sent: number;
};

export function registerCadenceAgentFeed(
  pi: ExtensionAPI,
  options: CadenceFeedOptions = {},
): void {
  let feed: Feed | undefined;
  pi.events.on(SUBAGENT_VIEW, (data) => {
    const id = (data as { id?: unknown } | undefined)?.id;
    feed?.view(typeof id === "string" ? id : undefined);
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
    const conversationId = ctx.sessionManager.getSessionId();
    if (!conversationId) return;
    feed = new Feed(pi, ctx.cwd, conversationId, options);
  });
  pi.on("session_shutdown", () => departure(stop()));
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
  /** Only running children; settled ones live in the panel's display snapshot. */
  private readonly children = new Map<string, Child>();
  private viewing: string | undefined;
  /** Attributed workflow → consecutive unreadable looks. A run leaving the
   * roster remains ours until its final observation; attribution is not lost
   * just because the roster no longer includes the finished run. */
  private readonly workflows = new Map<string, number>();
  /** Failed observation is terminal for this observer, not a retry loop.
   * Only ids remain, and only while the roster still lists those runs. */
  private readonly abandoned = new Set<string>();
  constructor(
    private readonly pi: ExtensionAPI,
    private readonly cwd: string,
    private readonly conversationId: string,
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
    return this.connection.detach().catch(() => {});
  }
  view(id: string | undefined): void {
    this.viewing = id;
    const child = id === undefined ? undefined : this.children.get(id);
    if (!child || child.ended) return;
    child.failed = false;
    if (this.busy) this.woken = true;
    else if (this.client) this.schedule(0);
  }
  private schedule(ms: number): void {
    clearTimeout(this.timer);
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), ms);
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
      await this.observe(this.client);
      next = this.workflows.size ? this.timing.activeMs : this.timing.idleMs;
    } catch {
      this.client = undefined;
      if (!this.connection.forgetSuperseded?.(this.cwd))
        await this.connection.detach().catch(() => {});
      // One lost look is not an outcome. After a whole failed retry we can
      // no longer observe the work, without claiming it actually failed.
      if (attaching)
        for (const runId of [...this.workflows.keys()])
          this.abandon(runId, "owner unavailable");
    } finally {
      this.busy = false;
    }
    this.schedule(this.woken ? 0 : next);
  }
  private async observe(client: FeedClient): Promise<void> {
    const signal = this.abort.signal;
    const roster = await client.workbenchRead(
      { kind: "workflow-active" },
      signal,
    );
    if (this.stopped) return;
    if (roster.kind === "ok" && roster.value.kind === "workflow-active") {
      const listed = new Set(roster.value.runs.map((run) => run.id));
      for (const id of this.abandoned)
        if (!listed.has(id)) this.abandoned.delete(id);
      for (const run of roster.value.runs)
        if (
          run.execution?.version.conversation?.id === this.conversationId &&
          !this.abandoned.has(run.id) &&
          !this.workflows.has(run.id)
        )
          this.workflows.set(run.id, 0);
    } else {
      // Detect a restarted owner, but do not turn an unreadable roster into
      // evidence that already-attributed work finished.
      await this.connection.refresh();
      if (this.stopped) return;
    }
    const ends: object[] = [];
    try {
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
            this.abandon(runId, "workflow not readable");
          else this.workflows.set(runId, misses + 1);
          continue;
        }
        this.workflows.set(runId, 0);
        const run = reply.value.response.run;
        const open = ["queued", "running"].includes(run.status);
        for (const step of run.steps) this.followStep(run, step, open, ends);
        if (!open) this.workflows.delete(runId);
      }
      for (const child of this.children.values()) {
        if (this.stopped) return;
        const viewed = child.id === this.viewing;
        // One final read for a transcript already open when its end arrived.
        // Never load/retry an ended child's history after this observation.
        if (viewed) {
          if (child.ended || !child.failed)
            await this.refreshTranscript(client, child);
        } else if (
          !child.ended &&
          this.now() - (child.readAt ?? 0) >= WORKFLOW_ACTIVITY_MS
        ) {
          const turn = await this.turn(client, child);
          if (this.stopped) return;
          if (turn) {
            child.working = turnWorking(
              turn,
              !["queued", "running"].includes(turn.status),
            );
            this.activity(child, child.working);
          }
        }
      }
    } finally {
      // A later read failing cannot discard a previously observed outcome.
      // Final streaming snapshots, when available, still precede their end.
      for (const end of ends) this.emit("end", end);
      for (const [id, child] of this.children)
        if (child.ended) this.children.delete(id);
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
    const outcome =
      step.status === "running" ? (open ? null : "unknown") : step.status;
    let child = this.children.get(id);
    if (!child) {
      // Historical steps are not live agents, even inside an active run.
      if (outcome) return;
      child = {
        id,
        label: step.id,
        runId: run.id,
        stepId: step.id,
        ended: false,
        activity: "",
        sent: 0,
      };
      this.children.set(id, child);
      this.emit("start", { id, label: step.id, kind, startedAt: this.now() });
    }
    if (child.ended) return;
    if (!outcome) {
      this.activity(child, child.working ?? `Working · ${run.phase}`);
      return;
    }
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
  private abandon(runId: string, why: string): void {
    this.workflows.delete(runId);
    this.abandoned.add(runId);
    for (const [id, child] of this.children) {
      if (child.runId !== runId) continue;
      this.activity(child, "outcome not observed");
      this.emit("end", {
        id,
        status: "error",
        endedAt: this.now(),
        error: `${child.label} · outcome not observed here (${why}); see /cadence-history`,
      });
      this.children.delete(id);
    }
  }
  private activity(child: Child, text: string): void {
    const activity = `${child.label} · ${text}`;
    if (child.ended || activity === child.activity) return;
    child.activity = activity;
    this.emit("activity", { id: child.id, activity });
  }
  private async turn(
    client: FeedClient,
    child: Child,
  ): Promise<ChatTurn | null | undefined> {
    child.readAt = this.now();
    const reply = await client.workbenchRead(
      { kind: "workflow-transcript", id: child.runId, stepId: child.stepId },
      this.abort.signal,
    );
    if (
      reply.kind === "error" ||
      reply.value.kind !== "workflow-transcript" ||
      reply.value.runId !== child.runId ||
      reply.value.stepId !== child.stepId
    )
      return undefined;
    return reply.value.turn;
  }
  private async refreshTranscript(
    client: FeedClient,
    child: Child,
  ): Promise<void> {
    const turn = await this.turn(client, child);
    if (this.stopped || this.viewing !== child.id) return;
    if (turn === undefined) {
      child.failed = true;
      return;
    }
    if (!turn) return;
    const finished = !["queued", "running"].includes(turn.status);
    const built = turnMessages(turn, finished);
    child.working = turnWorking(turn, finished);
    this.activity(child, child.working);
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
}
