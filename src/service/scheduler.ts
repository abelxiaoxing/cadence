/** One checkout scheduler. Policy reservations are not native settlement evidence. */
import { randomUUID } from "node:crypto";
import type { HistoryReader } from "../history/reader.ts";
import { COMPLETE } from "../history/types.ts";
import type { HistoryWriter } from "../history/writer.ts";
import {
  type AdmissionClosedFact,
  type Assignment,
  type CheckNativeSettlement,
  type CheckSelection,
  type ContentRef,
  ContractError,
  canonicalJson,
  childSatisfied,
  decodeGraph,
  type Graph,
  LIMITS,
  type ObservationFact,
  type OwnerFact,
  type OwnerLink,
  type OwnerRecordingEvent,
  publicError,
  type RequiredChildSettlement,
  type RunIdentity,
  type RunProjection,
  type WorkerCompletion,
  type WorkerPublicRequest,
} from "../service-contract.ts";
import { preparedWorker, runCheck } from "../subagent-process.ts";
import type { TaskRecord } from "../task-types.ts";
import { sanitizeText } from "../worker-redaction.mjs";
import { type CheckLiteralSource, CheckRecording } from "./check-recording.ts";
import type { GraphContext } from "./graph.ts";
import { dependencyHandoff } from "./graph.ts";
import type { OwnerModelContext } from "./model-context.ts";
import type { AcceptedWorkResult, ServiceOwner } from "./owner.ts";
import type { AdmissionIntent, RunTarget } from "./ports.ts";

export async function recordOwner(
  writer: HistoryWriter,
  link: OwnerLink,
  events: OwnerRecordingEvent[],
): Promise<string> {
  const reservation = writer.owner().reserve({
    sourceFrames: 0,
    retainedBytes: 0,
    outputBytes: events.reduce(
      (bytes, event) =>
        bytes +
        (event.kind === "fact" && event.fact.kind === "handoff"
          ? 256 * 1024
          : 64 * 1024),
      1024,
    ),
    outputChunks: events.length,
    lane: "control",
  });
  if (reservation.status !== "reserved") throw new ContractError("capacity");
  const result = await reservation.reservation.commit({
    link,
    observedMs: Math.floor(performance.now()),
    events,
  });
  if (result.status !== "committed")
    throw new ContractError("recording-exhausted");
  return result.batch.committedSeq;
}
interface EpisodeContext {
  intent: AdmissionIntent;
  task: TaskRecord;
  sources: GraphContext;
  /** Actual selected-source check; unrelated task revisions/access rotation excluded. */
  current(): boolean;
  observe(advance: boolean): { observation: ObservationFact; text: string };
  /** The owned checkout generation, without observing the working copy. */
  generation(): number;
  /** Advance the owned checkout generation by one and return it. */
  advance(): number;
  publish(baseline?: ContentRef): Promise<void>;
}
export type EpisodeInput = EpisodeContext &
  (
    | { kind: "start"; graph: Graph; planUnretained: boolean }
    | { kind: "generate-plan"; graph: null; planUnretained: false }
    | {
        kind: "check";
        graph: null;
        planUnretained: false;
        check: CheckSelection;
        cwd: string;
        environment: Readonly<NodeJS.ProcessEnv>;
        secrets: readonly string[];
        secretSource: CheckLiteralSource;
        definitionCurrent(): boolean;
      }
  );
interface Node {
  assignment: Assignment | null;
  childRunId: string;
  state: "queued" | "active" | "done";
  readyAt: number | null;
  order: number;
  waitReason: RunProjection["reason"];
  observing: boolean;
  abort: AbortController;
  result: RequiredChildSettlement | null;
}
interface Episode {
  input: EpisodeInput;
  identity: RunIdentity;
  link: OwnerLink;
  nodes: Node[];
  after: Map<string, ObservationFact>;
  baseline?: ContentRef;
  started: number;
  allocated: boolean;
  initialized: boolean;
  expectedObservation: ObservationFact;
  reason: AdmissionClosedFact["reason"] | null;
  closeWrite?: Promise<void>;
  settling: boolean;
  /** Terminal fact has been submitted after native/auth drainage. This closes
   * cancellation recording, not original publication/lifetime accounting. */
  settlementStarted: boolean;
  done: Promise<AcceptedWorkResult>;
  jobs: Set<Promise<void>>;
  finished: boolean;
  wake?: () => void;
  target: RunTarget;
}
export interface ReviewBarrier {
  assertHeld(): void;
  release(): void;
}
export interface SchedulerOptions {
  owner: ServiceOwner;
  writer: HistoryWriter;
  reader: HistoryReader;
  models: OwnerModelContext;
  ownerSecrets: readonly string[];
  /** Explicit local policy only; native test budget can be shorter, never longer. */
  workerTimeoutMs?: number;
  now?: () => number;
}
export class TaskScheduler {
  private readonly episodes = new Map<string, Episode>();
  private readonly recent = new Map<string, RunTarget>();
  private readonly holders = new Map<string, "reader" | "writer" | "check">();
  private readonly barriers: {
    id: string;
    order: number;
    conversation: boolean;
    resolve: (barrier: ReviewBarrier) => void;
    reject: (error: unknown) => void;
  }[] = [];
  private barrier: string | null = null;
  private sequence = 0;
  private turn = 0;
  private pumping = false;
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private readonly now: () => number;
  private readonly timeout: number;
  constructor(private readonly options: SchedulerOptions) {
    this.now = options.now ?? (() => performance.now());
    this.timeout = options.workerTimeoutMs ?? LIMITS.workerMs;
    if (
      !Number.isSafeInteger(this.timeout) ||
      this.timeout < 100 ||
      this.timeout > LIMITS.workerMs
    )
      throw new ContractError("invalid");
  }
  get accounting() {
    return {
      episodes: this.episodes.size,
      queued: [...this.episodes.values()].reduce(
        (n, e) => n + e.nodes.filter((a) => a.state === "queued").length,
        0,
      ),
      reservations: this.holders.size,
      retainedAllowance:
        this.episodes.size * (LIMITS.graphBytes + 256 * 1024) +
        this.holders.size * (LIMITS.workerRequestBytes * 5),
    };
  }
  assertQuiescent(): void {
    if (this.closed) throw new ContractError("quarantine");
    if (
      this.episodes.size ||
      this.holders.size ||
      this.barriers.length ||
      this.barrier ||
      this.pumping
    )
      throw new ContractError("conflict");
  }
  assertCapacity(assignments: number): void {
    if (this.closed || this.options.owner.state !== "idle")
      throw new ContractError("quarantine");
    if (
      this.episodes.size >= LIMITS.episodes ||
      this.accounting.queued + assignments > LIMITS.queuedAssignments
    )
      throw new ContractError("capacity");
  }
  /** Metadata shares the actual checkout gate, but is not a child/check slot. */
  reviewBarrier(
    operationId: string,
    signal?: AbortSignal,
  ): Promise<ReviewBarrier> {
    return this.acquireBarrier(operationId, false, signal);
  }
  /** Chat writes its own synchronous private journal, not a W3 metadata job. */
  conversationBarrier(
    operationId: string,
    signal: AbortSignal,
  ): Promise<ReviewBarrier> {
    return this.acquireBarrier(operationId, true, signal);
  }
  private acquireBarrier(
    operationId: string,
    conversation: boolean,
    signal?: AbortSignal,
  ): Promise<ReviewBarrier> {
    if (signal?.aborted) throw new ContractError("stale");
    if (this.closed || this.options.owner.state !== "idle")
      throw new ContractError("quarantine");
    if (
      this.barriers.length >= 16 ||
      this.barrier === operationId ||
      this.barriers.some((b) => b.id === operationId)
    )
      throw new ContractError("capacity");
    const promise = new Promise<ReviewBarrier>((resolve, reject) => {
      const abort = () => {
        const index = this.barriers.findIndex((row) => row.id === operationId);
        if (index >= 0)
          this.barriers.splice(index, 1)[0].reject(new ContractError("stale"));
      };
      this.barriers.push({
        id: operationId,
        order: ++this.sequence,
        conversation,
        resolve: (value) => {
          signal?.removeEventListener("abort", abort);
          resolve(value);
        },
        reject: (error) => {
          signal?.removeEventListener("abort", abort);
          reject(error);
        },
      });
      signal?.addEventListener("abort", abort, { once: true });
    });
    this.pump();
    return promise;
  }
  private closeBarriers(): void {
    for (const b of this.barriers.splice(0))
      b.reject(new ContractError("quarantine"));
  }
  run(id: string): RunTarget | undefined {
    return this.episodes.get(id)?.target ?? this.recent.get(id);
  }
  /** Bounded current originals only. Retired unknown history is not active work. */
  activeRefs(): import("../service-contract.ts").ActiveRunRef[] {
    return [...this.episodes.values()].map((e) => ({
      taskId: e.link.taskId,
      runId: e.target.runId,
      operationId: e.link.operationId,
      epoch: e.link.epoch,
      kind: e.input.kind,
      stage:
        e.reason || e.settling || this.closed
          ? "draining"
          : e.allocated
            ? "active"
            : "accepted-unallocated",
    }));
  }
  activeTask(taskId: string): string | null {
    return (
      [...this.episodes.values()].find((e) => e.link.taskId === taskId)?.target
        .runId ?? null
    );
  }
  async settled(runId: string): Promise<void> {
    await this.episodes.get(runId)?.done;
  }
  activate(input: EpisodeInput): Promise<AcceptedWorkResult> {
    this.assertCapacity(
      input.kind === "start" ? input.graph.assignments.length : 1,
    );
    // Counts/encoded allowances precede graph/task copies and asynchronous work.
    input =
      input.kind === "start"
        ? {
            ...input,
            intent: structuredClone(input.intent),
            graph: decodeGraph(input.graph),
            task: structuredClone(input.task),
          }
        : {
            ...input,
            intent: structuredClone(input.intent),
            task: structuredClone(input.task),
          };
    const { intent } = input;
    if (
      !intent.runId ||
      intent.identity.kind !== "action" ||
      intent.identity.action.kind !== input.kind ||
      (input.kind === "start" &&
        !intent.identity.expected.task?.graphIdentity) ||
      (input.kind === "generate-plan" &&
        (input.graph !== null || input.task.kind !== "code")) ||
      this.activeTask(input.task.id)
    )
      throw new ContractError("conflict");
    let graphReference: RunIdentity["graph"] = null;
    if (input.kind === "start") {
      const sha256 = intent.identity.expected.task?.graphIdentity;
      if (!sha256) throw new ContractError("conflict");
      graphReference = {
        recordId: intent.runId,
        revision: input.graph.revision,
        sha256,
      };
    }
    const assignments =
      input.kind === "start"
        ? input.graph.assignments
        : input.kind === "generate-plan"
          ? [input.sources.planningAssignment(intent.identity.expected.model)]
          : [null];
    const nodes: Node[] = assignments.map((assignment) => {
      const childRunId = randomUUID();
      return {
        assignment,
        childRunId,
        state: "queued",
        readyAt: null,
        order: ++this.sequence,
        waitReason: assignment?.dependencies.length ? "dependency" : "capacity",
        observing: false,
        abort: new AbortController(),
        result: assignment
          ? {
              assignmentId: assignment.id,
              childRunId,
              native: null,
              settlementSeq: null,
              recording: {
                status: "refused",
                selected: null,
                error: publicError("unavailable"),
              },
            }
          : null,
      };
    });
    const original = Promise.resolve().then(() => this.lifetime(e));
    const e: Episode = {
      input,
      nodes,
      started: this.now(),
      allocated: false,
      initialized: false,
      expectedObservation: {
        ...intent.identity.expected.observation,
        checkoutGeneration: intent.identity.expected.checkoutGeneration,
      },
      reason: null,
      settling: false,
      settlementStarted: false,
      after: new Map(),
      identity: {
        operationId: intent.operationId,
        commandId: intent.commandId,
        kind: input.kind,
        context: structuredClone(intent.identity.expected),
        assignments: nodes.flatMap((n) =>
          n.assignment
            ? [
                {
                  assignmentId: n.assignment.id,
                  childRunId: n.childRunId,
                },
              ]
            : [],
        ),
        graph: graphReference,
      },
      link: {
        epoch: intent.identity.expected.epoch,
        taskId: input.task.id,
        runId: intent.runId,
        operationId: intent.operationId,
      },
      done: original,
      jobs: new Set(),
      finished: false,
      target: {
        runId: intent.runId,
        epoch: intent.identity.expected.epoch,
        state: "active",
        cancelRequested: false,
      },
    };
    this.episodes.set(intent.runId, e); // synchronous visibility to next admission
    return e.done;
  }
  /** The original control flow joins every scheduled continuation, even when
   * native/storage reporting has already fenced the episode. Reservations are
   * deliberately not refunded by an uncertain return. */
  private async lifetime(e: Episode): Promise<AcceptedWorkResult> {
    await Promise.resolve(); // caller registers its accepted lifetime before effects
    this.job(e, () => this.initialize(e));
    while (e.jobs.size || (!e.finished && e.target.state !== "unknown"))
      await new Promise<void>((resolve) => {
        e.wake = resolve;
      });
    if (e.target.state === "settled") return { status: "settled" };
    e.target.state = "unknown"; // control flow ended, but publication/recording did not
    await this.options.writer.abandonPublication(e.link.operationId);
    return { status: "uncertain" };
  }
  private job(e: Episode, work: () => Promise<void>): void {
    const original = Promise.resolve()
      .then(work)
      .catch(() => {
        this.quarantine();
      })
      .finally(() => {
        e.jobs.delete(original);
        e.wake?.();
      });
    e.jobs.add(original);
  }
  /** Fixture/owner drain of exact whole episodes, never a clean-result claim. */
  async settledAll(): Promise<void> {
    await Promise.all([...this.episodes.values()].map((e) => e.done));
  }
  private fact(e: Episode, fact: OwnerFact): Promise<string> {
    return recordOwner(this.options.writer, e.link, [{ kind: "fact", fact }]);
  }
  private async initialize(e: Episode): Promise<void> {
    if (this.closed) {
      e.finished = true;
      return;
    }
    if (e.input.planUnretained) {
      const retained = await this.options.writer.retainAcceptedRunPlan(
        e.link.operationId,
        e.input.graph,
        this.options.ownerSecrets,
      );
      if (retained.status !== "committed")
        throw new ContractError("recording-exhausted");
    }
    if (this.closed) {
      e.finished = true;
      return;
    }
    const result = await this.options.writer.admitRun(
      e.target.runId,
      e.identity,
      e.input.graph,
    );
    if (result.status !== "committed")
      throw new ContractError("recording-exhausted");
    e.allocated = true;
    if (!this.closed) await e.input.publish();
    if (e.reason) await this.close(e, e.reason);
    else if (e.input.kind !== "check")
      for (const n of e.nodes) {
        if (this.closed || e.reason) break;
        await this.fact(e, {
          kind: "assignment-state",
          childRunId: n.childRunId,
          state: "waiting",
          reason: n.assignment?.dependencies.length ? "dependency" : "capacity",
        });
      }
    e.initialized = true;
    this.pump();
  }
  private owned(): boolean {
    try {
      this.options.owner.lease.assert();
      return true;
    } catch {
      return false;
    }
  }
  cancel(runId: string): void {
    const e = this.episodes.get(runId);
    if (!e || e.target.cancelRequested || e.settlementStarted) return;
    e.target.cancelRequested = true;
    e.reason ??= "canceled"; // stop admission before ANY awaited recording
    for (const n of e.nodes) if (this.owned()) n.abort.abort();
    this.job(e, async () => {
      await this.close(e, e.reason ?? "canceled");
      this.pump();
    });
  }
  quiesce(): void {
    this.closed = true;
    this.closeBarriers();
    clearTimeout(this.timer);
    // Abort every selected child before scheduling/awaiting any safety write.
    for (const e of this.episodes.values())
      for (const n of e.nodes) if (this.owned()) n.abort.abort();
    for (const id of this.episodes.keys()) this.cancel(id);
  }
  quarantine(): void {
    this.closed = true;
    this.closeBarriers();
    for (const e of this.episodes.values()) {
      e.reason ??= "quarantine";
      e.target.state = "unknown";
      e.wake?.();
    }
    // ServiceOwner revalidates ownership before invoking each original stop callback.
    this.options.owner.quarantine();
    for (const e of this.episodes.values())
      for (const n of e.nodes) if (this.owned()) n.abort.abort();
  }
  private async close(
    e: Episode,
    reason: AdmissionClosedFact["reason"],
  ): Promise<void> {
    e.reason ??= reason;
    if (!e.allocated || e.settlementStarted) return;
    e.closeWrite ??= this.fact(e, {
      kind: "admission-closed",
      reason: e.reason,
    }).then(() => {});
    await e.closeWrite;
  }
  private ready(e: Episode, n: Node): boolean {
    return (
      !n.assignment ||
      n.assignment.dependencies.every(
        (d) =>
          d.source.kind === "historical" ||
          e.nodes.some(
            (p) =>
              p.assignment?.id ===
                (d.source.kind === "current" ? d.source.assignmentId : "") &&
              p.state === "done" &&
              p.result !== null &&
              childSatisfied(p.result),
          ),
      )
    );
  }
  private pump(): void {
    if (this.pumping) return;
    this.pumping = true;
    try {
      clearTimeout(this.timer);
      const list = [...this.episodes.values()];
      for (const e of list) {
        if (!e.initialized || e.settling) continue;
        if (
          !e.reason &&
          !e.settlementStarted &&
          this.now() - e.started >= LIMITS.episodeMs
        ) {
          e.reason = "timeout";
          for (const n of e.nodes) if (this.owned()) n.abort.abort();
        }
        for (const n of e.nodes)
          if (n.state === "queued" && this.ready(e, n))
            n.readyAt ??= this.now();
        if (
          !e.reason &&
          e.nodes.some(
            (n) =>
              n.state === "queued" &&
              n.readyAt !== null &&
              this.now() - n.readyAt >= LIMITS.readyWaitMs,
          )
        )
          e.reason = "wait-expired";
        if (e.reason) {
          if (!e.closeWrite)
            this.job(e, async () => {
              await this.close(e, e.reason ?? "canceled");
            });
          if (!e.nodes.some((n) => n.state === "active")) this.finishEpisode(e);
        } else if (e.nodes.every((n) => n.state === "done"))
          this.finishEpisode(e);
      }
      const candidates = list.flatMap((e) =>
        !this.closed && e.initialized && !e.reason && !e.settling
          ? e.nodes
              .filter((n) => n.state === "queued" && n.readyAt !== null)
              .map((n) => ({ e, n }))
          : [],
      );
      const barrierOrder = this.barriers[0]?.order ?? Infinity;
      if (
        !this.closed &&
        this.barrier === null &&
        this.holders.size === 0 &&
        this.barriers.length &&
        !candidates.some((c) => c.n.order < barrierOrder)
      ) {
        const b = this.barriers.shift();
        if (!b) throw new ContractError("conflict");
        this.barrier = b.id;
        b.resolve({
          assertHeld: () => {
            if (
              this.closed ||
              this.barrier !== b.id ||
              this.holders.size ||
              !this.owned() ||
              this.options.owner.state !== "idle"
            )
              throw new ContractError("quarantine");
          },
          release: () => {
            // A reporting failure must not refund an original unknown write.
            if (
              this.barrier !== b.id ||
              this.options.writer.quarantined ||
              (!b.conversation && this.options.writer.pendingWrites)
            )
              throw new ContractError("quarantine");
            this.barrier = null;
            this.pump();
          },
        });
      }
      const writerOrder = Math.min(
        barrierOrder,
        ...candidates
          .filter(
            ({ n }) => n.assignment === null || n.assignment.purpose === "edit",
          )
          .map(({ n }) => n.order),
      );
      for (const { e, n } of candidates) {
        const reason: RunProjection["reason"] =
          this.barrier !== null ||
          [...this.holders.values()].some((lane) => lane !== "reader") ||
          ((n.assignment === null || n.assignment.purpose === "edit") &&
            this.holders.size > 0) ||
          n.order > writerOrder
            ? "writer"
            : "capacity";
        if (n.assignment && n.waitReason !== reason && !n.observing) {
          n.waitReason = reason;
          n.observing = true;
          this.job(e, async () => {
            if (!this.closed && !e.reason)
              await this.fact(e, {
                kind: "assignment-state",
                childRunId: n.childRunId,
                state: "waiting",
                reason,
              });
            n.observing = false;
            this.pump();
          });
        }
      }
      while (
        this.barrier === null &&
        this.holders.size < LIMITS.childReservations
      ) {
        let picked: { e: Episode; n: Node } | undefined;
        for (let count = 0; count < list.length; count++) {
          const e = list[(this.turn + count) % list.length];
          picked = candidates.find(
            (c) =>
              c.e === e &&
              c.n.state === "queued" &&
              !c.n.observing &&
              (c.n.assignment === null || c.n.assignment.purpose === "edit"
                ? this.holders.size === 0 && c.n.order < barrierOrder
                : ![...this.holders.values()].some(
                    (lane) => lane !== "reader",
                  ) && c.n.order < writerOrder),
          );
          if (picked) break;
        }
        if (!picked) break;
        const { e, n } = picked;
        n.state = "active";
        this.holders.set(
          n.childRunId,
          n.assignment === null
            ? "check"
            : n.assignment.purpose === "edit"
              ? "writer"
              : "reader",
        );
        this.turn = (list.indexOf(e) + 1) % list.length;
        this.job(e, () =>
          e.input.kind === "check"
            ? this.executeCheck(e, n)
            : this.execute(e, n),
        );
      }
      if (this.episodes.size && !this.closed) {
        this.timer = setTimeout(() => this.pump(), 1000);
        this.timer.unref();
      }
    } finally {
      this.pumping = false;
    }
  }
  /** Cheap ownership/source/definition currency at every step. The working
   * copy is observed (`changes`) only where it decides an effect: the last
   * check before a native launch; the baseline and after-exit captures are
   * compared where they are taken. */
  private current(e: Episode, n: Node, changes = false): boolean {
    return (
      !this.closed &&
      !e.reason &&
      !n.abort.signal.aborted &&
      this.options.owner.state === "idle" &&
      this.owned() &&
      e.input.current() &&
      e.input.sources.current() &&
      (!changes ||
        canonicalJson(e.input.observe(false).observation) ===
          canonicalJson(e.expectedObservation))
    );
  }
  private async execute(e: Episode, n: Node): Promise<void> {
    if (!n.assignment || !n.result || e.input.kind === "check")
      throw new ContractError("invalid");
    const lane = n.assignment.purpose === "edit" ? "writer" : "reader";
    let held = false,
      originalAuth: Promise<void> | undefined;
    try {
      if (!this.current(e, n)) {
        await this.close(e, "stale-dependency");
        return;
      }
      await this.fact(e, {
        kind: "assignment-state",
        childRunId: n.childRunId,
        state: "ready",
        reason: null,
      });
      if (!this.current(e, n)) {
        await this.close(e, e.reason ?? "stale-dependency");
        return;
      }
      await this.fact(e, {
        kind: "gate",
        reservationId: n.childRunId,
        lane,
        state: "held",
        checkoutGeneration: e.input.generation(),
      });
      held = true;
      if (!this.current(e, n)) {
        await this.close(e, e.reason ?? "stale-dependency");
        return;
      }
      const observed = e.input.observe(false),
        before = observed.observation;
      const baseline = await this.changes(e, "before", observed);
      e.baseline ??= baseline;
      if (
        !this.current(e, n) ||
        canonicalJson(before) !== canonicalJson(e.expectedObservation)
      ) {
        await this.close(e, e.reason ?? "stale-dependency");
        return;
      }
      let request: WorkerPublicRequest;
      try {
        if (e.input.kind === "generate-plan") {
          request = e.input.sources.planningRequest(
            e.input.task,
            e.identity.context.model,
            e.target.runId,
            n.childRunId,
          );
        } else {
          const handoff = dependencyHandoff(
            this.options.reader,
            e.input.graph,
            e.identity,
            e.target.runId,
            n.assignment,
            this.options.writer.committedSeq,
            before,
            e.after,
          );
          request = e.input.sources.request(
            e.input.task,
            e.input.graph,
            e.target.runId,
            n.childRunId,
            n.assignment,
            handoff,
          );
          await this.fact(e, {
            kind: "handoff",
            childRunId: n.childRunId,
            handoff,
            observation: before,
          });
        }
      } catch (error) {
        await this.close(
          e,
          error instanceof ContractError && error.code === "oversize"
            ? "handoff-overflow"
            : "stale-dependency",
        );
        return;
      }
      if (!this.current(e, n)) {
        await this.close(e, "stale-dependency");
        return;
      }
      await this.fact(e, {
        kind: "assignment-state",
        childRunId: n.childRunId,
        state: "preparing",
        reason: null,
      });
      if (!this.current(e, n)) {
        await this.close(e, e.reason ?? "stale-dependency");
        return;
      }
      const auth = this.options.models.prepareTracked({
        request,
        operationId: randomUUID(),
        epoch: e.link.epoch,
        timeoutMs: this.timeout,
        signal: n.abort.signal,
        current: () => this.current(e, n),
      });
      originalAuth = auth.settled;
      const prepared = await auth.result;
      if (prepared.status !== "prepared" || !this.current(e, n, true)) {
        await this.close(e, e.reason ?? "failed");
        await this.fact(e, {
          kind: "assignment-state",
          childRunId: n.childRunId,
          state: "closing",
          reason: "parent-stopped",
        });
        return;
      }
      const link = {
        epoch: e.link.epoch,
        taskId: e.link.taskId,
        runId: e.target.runId,
        childRunId: n.childRunId,
      };
      const launch = await this.options.writer.processes.launchIntent(
        link,
        e.link.operationId,
      );
      if (launch.status !== "committed")
        throw new ContractError("recording-exhausted");
      // PreparedModelContext rechecks callback/abort again synchronously at consume.
      const worker = preparedWorker(
        prepared.prepared,
        request,
        link,
        this.options.ownerSecrets,
        this.timeout,
        () => this.owned(),
      );
      const original = worker.launch(
        n.abort.signal,
        this.options.writer.capture(link),
      );
      this.options.owner.trackWorker(original, () => {
        if (this.owned()) n.abort.abort();
      });
      const completion: WorkerCompletion = await original;
      if (completion.native.outcome !== "completed")
        await this.close(
          e,
          completion.native.outcome === "canceled"
            ? "canceled"
            : completion.native.outcome === "timeout"
              ? "timeout"
              : "failed",
        );
      await this.fact(e, {
        kind: "assignment-state",
        childRunId: n.childRunId,
        state: "closing",
        reason: null,
      });
      const settled = await this.options.writer.processes.settlement(
        link,
        completion,
      );
      if (settled.status !== "committed")
        throw new ContractError("recording-exhausted");
      n.result = {
        ...n.result,
        native: completion.native,
        recording: completion.recording,
        settlementSeq: settled.batch.committedSeq,
      };
      if (this.closed) return;
      const observedAfter = e.input.observe(lane === "writer"),
        after = observedAfter.observation;
      await this.changes(e, "after", observedAfter);
      e.after.set(n.childRunId, after);
      if (lane === "writer") e.expectedObservation = after;
      if (!childSatisfied(n.result))
        await this.close(
          e,
          completion.native.outcome === "canceled"
            ? "canceled"
            : completion.native.outcome === "timeout"
              ? "timeout"
              : "failed",
        );
    } finally {
      await originalAuth;
      if (
        this.options.writer.quarantined ||
        ["quarantined", "stopped"].includes(this.options.owner.state)
      ) {
        this.quarantine();
      } else {
        if (!n.result?.native)
          await this.fact(e, {
            kind: "assignment-state",
            childRunId: n.childRunId,
            state: "unstarted",
            reason: this.reason(e),
          });
        if (held)
          await this.fact(e, {
            kind: "gate",
            reservationId: n.childRunId,
            lane,
            state: "released",
            checkoutGeneration: e.input.generation(),
          });
        this.holders.delete(n.childRunId);
        n.state = "done";
        this.pump();
      }
    }
  }
  private async executeCheck(e: Episode, n: Node): Promise<void> {
    const input = e.input;
    if (input.kind !== "check") throw new ContractError("invalid");
    const before = e.expectedObservation,
      checkId = n.childRunId;
    let held = false;
    let native: CheckNativeSettlement = {
      outcome: e.reason === "canceled" ? "canceled" : "failed",
      closure: "not-launched",
      exitCode: null,
      signal: null,
      durationMs: 0,
      stdin: "not-required",
    };
    let recording: CheckRecording | undefined;
    try {
      // Start is the native intent even when a later guard proves no launch.
      await this.fact(e, {
        kind: "check-start",
        checkId,
        selection: input.check,
        cwdId: e.identity.context.cwdId,
        cwdLabel: input.cwd,
        checkEnvGeneration: e.identity.context.checkEnvGeneration,
        before,
      });
      if (this.current(e, n) && input.definitionCurrent()) {
        await this.fact(e, {
          kind: "gate",
          reservationId: checkId,
          lane: "check",
          state: "held",
          checkoutGeneration: before.checkoutGeneration,
        });
        held = true;
        if (this.current(e, n) && input.definitionCurrent()) {
          recording = new CheckRecording(
            this.options.writer.checkOutput(e.link, checkId),
            e.link,
            checkId,
            input.secrets,
            input.secretSource,
          );
          await recording.begin();
          if (this.current(e, n) && input.definitionCurrent()) {
            // Register the original native promise BEFORE its single launch microtask.
            const output = recording;
            const original = Promise.resolve().then(async () => {
              if (!this.current(e, n, true) || !input.definitionCurrent())
                return native;
              await runCheck(input.check, input.cwd, n.abort.signal, {
                environment: input.environment,
                recording: output,
                maySignal: () => this.owned(),
                onNative: (observed) => {
                  native = observed;
                },
              });
              return native;
            });
            this.options.owner.trackCheck(original, () => {
              if (this.owned()) n.abort.abort();
            });
            native = await original;
          }
        }
      }
      if (recording)
        await recording.end(native.closure === "direct-child-closed");
      const retained = recording?.result() ?? {
        output: null,
        coverage: {
          observed: "incomplete" as const,
          source: "unavailable" as const,
          redacted: false,
          omissions: ["gap" as const],
        },
      };
      // One owned transition, only while this exact check holds the lane. Any
      // foreign generation remains visible and cannot borrow this normalization.
      const observed = input.observe(false).observation;
      // The same observation, with this check's one owned generation advance.
      const after = held
        ? { ...observed, checkoutGeneration: input.advance() }
        : observed;
      const ownAdvance =
        held && observed.checkoutGeneration === before.checkoutGeneration
          ? {
              operationId: e.link.operationId,
              reservationId: checkId,
              from: before.checkoutGeneration,
              to: after.checkoutGeneration,
            }
          : undefined;
      const fresh =
        input.current() &&
        input.definitionCurrent() &&
        observed.identity === before.identity &&
        observed.complete === before.complete &&
        after.identity === before.identity &&
        after.complete === before.complete &&
        ownAdvance !== undefined &&
        ownAdvance.to === ownAdvance.from + 1;
      const status =
        native.outcome === "canceled" || native.outcome === "timeout"
          ? "canceled"
          : native.outcome !== "completed" ||
              retained.coverage.observed !== "complete" ||
              !retained.output
            ? "failed"
            : fresh
              ? "passed"
              : "stale";
      e.settlementStarted = true;
      await this.fact(e, {
        kind: "check-settled",
        checkId,
        native,
        status,
        before,
        after,
        ...(ownAdvance ? { ownAdvance } : {}),
        ...retained,
      });
      if (
        native.closure === "unconfirmed" ||
        this.options.writer.quarantined ||
        this.options.owner.state === "quarantined"
      ) {
        this.quarantine();
        return;
      }
      if (held)
        await this.fact(e, {
          kind: "gate",
          reservationId: checkId,
          lane: "check",
          state: "released",
          checkoutGeneration: after.checkoutGeneration,
        });
      this.holders.delete(checkId);
      n.state = "done";
      this.pump();
    } catch {
      // Native exit/close was observed independently, but a refused/stalled
      // original recorder cannot be repaired by publishing success or refunding.
      this.quarantine();
    }
  }
  private async changes(
    e: Episode,
    stage: "before" | "after",
    view: { observation: ObservationFact; text: string },
  ): Promise<ContentRef> {
    // Fixed observation ceiling and reservation precede retained sanitization/copies.
    if (Buffer.byteLength(view.text) > 128 * 1024)
      throw new ContractError("oversize");
    const reserved = this.options.writer.owner().reserve({
      sourceFrames: 0,
      retainedBytes: 256 * 1024,
      outputBytes: 512 * 1024,
      outputChunks: 20,
      lane: "data",
    });
    if (reserved.status !== "reserved") throw new ContractError("capacity");
    let consumed = false;
    try {
      const text = sanitizeText(view.text, this.options.ownerSecrets),
        bytes = Buffer.from(text),
        detailId = randomUUID(),
        observationId = randomUUID();
      const events: OwnerRecordingEvent[] = [
        {
          kind: "content-begin",
          detailId,
          owner: {
            taskId: e.link.taskId,
            runId: e.link.runId,
            childRunId: null,
            entity: { kind: "changes", id: observationId, version: 1 },
          },
          field: "changes",
          encoding: "utf8",
        },
      ];
      for (let at = 0; at < bytes.length; ) {
        let end = Math.min(at + LIMITS.chunkBytes, bytes.length);
        while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
        events.push({
          kind: "content-chunk",
          detailId,
          text: bytes.subarray(at, end).toString("utf8"),
        });
        at = end;
      }
      events.push({
        kind: "content-end",
        detailId,
        coverage: {
          ...COMPLETE,
          redacted: text !== view.text,
          source: view.observation.complete ? "complete" : "limited",
          omissions: view.observation.complete ? [] : ["source-limit"],
        },
      });
      const promise = reserved.reservation.commit({
        link: e.link,
        observedMs: Math.floor(this.now()),
        events,
      });
      consumed = true;
      const result = await promise;
      if (
        result.status !== "committed" ||
        result.batch.ownerDetails.length !== 1
      )
        throw new ContractError("recording-exhausted");
      const content = result.batch.ownerDetails[0].content;
      await this.fact(e, {
        kind: "changes",
        observationId,
        stage,
        observation: view.observation,
        content,
      });
      return content;
    } finally {
      if (!consumed) reserved.reservation.release();
    }
  }
  private reason(e: Episode): RunProjection["reason"] {
    return e.reason &&
      [
        "wait-expired",
        "handoff-overflow",
        "stale-dependency",
        "quarantine",
      ].includes(e.reason)
      ? (e.reason as RunProjection["reason"])
      : "parent-stopped";
  }
  private finishEpisode(e: Episode): void {
    if (e.settling) return;
    e.settling = true;
    this.job(e, async () => {
      await e.closeWrite;
      if (e.input.kind === "check") {
        if (e.nodes[0].state === "queued")
          await this.executeCheck(e, e.nodes[0]);
      } else {
        for (const n of e.nodes)
          if (n.state === "queued") {
            await this.fact(e, {
              kind: "assignment-state",
              childRunId: n.childRunId,
              state: "unstarted",
              reason: this.reason(e),
            });
            n.state = "done";
          }
        const required = e.nodes.flatMap((n) => (n.result ? [n.result] : []));
        const outcome = required.every(childSatisfied)
          ? "completed"
          : e.reason === "canceled"
            ? "canceled"
            : e.reason === "timeout"
              ? "timeout"
              : e.reason === "failed"
                ? "failed"
                : "blocked";
        e.settlementStarted = true;
        await this.fact(e, {
          kind: "parent-settled",
          runId: e.target.runId,
          settlement: { kind: "parent", outcome, required },
        });
      }
      if (this.closed) {
        e.finished = true;
        return;
      }
      await e.input.publish(e.baseline);
      e.target.state = "settled";
      this.recent.set(e.target.runId, { ...e.target });
      if (this.recent.size > LIMITS.episodes * 2)
        this.recent.delete(this.recent.keys().next().value ?? "");
      this.episodes.delete(e.target.runId);
      e.finished = true;
      this.pump();
    });
  }
}
