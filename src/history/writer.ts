import { createHash, type Hash, randomUUID } from "node:crypto";
import { join } from "node:path";
import type { OwnerLease } from "../service/coordination.ts";
import type {
  AdmissionCommit,
  AdmissionIntent,
  AdmissionPersistence,
  AuthAccountingPort,
  AuthPreparationIntent,
  AuthPreparationSettlement,
  CaptureSink,
  OwnerJournalPort,
  PersistenceResult,
  ProcessAccountingPort,
  StoredLookup,
} from "../service/ports.ts";
import { encoded, hash, json } from "../service/private-files.ts";
import {
  CaptureBudgetPool,
  type CaptureCoverage,
  type CommittedBatch,
  type ContentRef,
  type ContextVersion,
  ContractError,
  canonicalJson,
  type DetailDescriptor,
  decodeCheckObligations,
  decodeContext,
  decodeGraph,
  decodeId,
  decodeOwnerRecordingInput,
  decodeRecordingLink,
  decodeRunIdentity,
  decodeStoredCommand,
  decodeWorkerCompletion,
  type Graph,
  LIMITS,
  type OwnerFact,
  type OwnerLink,
  type OwnerRecordingInput,
  type PublicRecordingInput,
  publicError,
  type RecordingLink,
  type RecordOwner,
  type RunIdentity,
  type SourceRange,
  type StoredCommand,
  type WorkerCompletion,
} from "../service-contract.ts";
import { TextSanitizer } from "../worker-redaction.mjs";
import { decodeRunAdmission } from "./admission.ts";
import { checkFold } from "./checks.ts";
import {
  emptyScan,
  HistoryFiles,
  HistoryReadBudget,
  type ScanState,
  type WriteObserver,
} from "./files.ts";
import { HistoryNavigation } from "./navigation.ts";
import { assertPlanContent, planRecording } from "./plans.ts";
import {
  publicationRecord,
  savedRecordIdentity,
  syncTaskPublication,
  type TaskPublicationRequest,
  type TaskPublicationResult,
} from "./publication.ts";
import { HistoryReader, latestTaskRun, planFold } from "./reader.ts";
import { reviewIssues } from "./review.ts";
import {
  OperationState,
  RunState,
  readOperationState,
  readRunState,
  uncertainSettlement,
} from "./run-state.ts";
import { taskFoldMemory } from "./task-folds.ts";
import {
  type Artifact,
  COMPLETE,
  combineCoverage,
  decodeAdmissionIntent,
  decodeAuthIntent,
  decodeAuthSettlement,
  type JournalRow,
  type JournalValue,
  RECORD_BYTES,
  type ResourcePolicy,
  type RetainedDetail,
  type SavedEvent,
} from "./types.ts";

export interface CommitNotice {
  seq: string;
  tasks: string[];
  runs: string[];
  gap: boolean;
}
interface CommitObserver {
  callback: (notice: CommitNotice) => void;
  pending: CommitNotice | null;
  busy: boolean;
  active: boolean;
}
interface OpenDetail {
  detailId: string;
  origin: RetainedDetail["origin"];
  owner: RecordOwner;
  descriptor: DetailDescriptor | null;
  field: RetainedDetail["content"]["field"];
  recordId: string;
  version: number;
  bytes: number;
  hash: Hash;
  parts: number;
  ended: RetainedDetail | null;
  committedSeq: string | null;
}
interface ChildState {
  link: RecordingLink;
  operationId: string;
  settled: boolean;
  ready: boolean;
  messages: Map<string, number>;
  tools: Map<string, number>;
  details: Map<string, OpenDetail>;
  final: { messageId: string; detailId: string } | null;
}
interface Job {
  build: (
    seq: string,
  ) => JournalValue | undefined | Promise<JournalValue | undefined>;
  bytes: number;
  safety: boolean;
  continuation: boolean;
  control: boolean;
  resolve: (result: PersistenceResult) => void;
}
export type ReviewContextSource = (
  taskId: string,
  published?: { revision: number; identity: string },
) => import("./review.ts").ReviewContext;
export interface HistoryWriterOptions {
  /** Synchronous lifetime registration BEFORE scheduling/effects. Not a viewer callback.
   * Throws refuse the job without effects; original accounting still settles. */
  onOriginal?: (original: Promise<PersistenceResult>, safety: boolean) => void;
  quotaBytes?: number;
  episodeReservationBytes?: number;
  /** Scheduling/fault observation for fixtures; actual fs writes are never replaced. */
  observeWrite?: WriteObserver;
  onFence?: () => void;
  /** Actual readonly review observation/obligations, never SDK/auth work. */
  reviewContext?: ReviewContextSource;
}
const failure = (uncertain: boolean): PersistenceResult => ({
  status: "refused",
  durability: uncertain ? "uncertain" : "none",
  error: publicError("recording-exhausted", uncertain ? "uncertain" : "none"),
});

/** One original serialized writer. No viewer, provider, scheduler, replay or cleanup.
 * Capture and owner ports are bound views, not additional sequence authorities. */
export class HistoryWriter implements AdmissionPersistence {
  readonly files: HistoryFiles;
  readonly auth: AuthAccountingPort;
  readonly processes: ProcessAccountingPort;
  private state: ScanState;
  private readonly writeGeneration: number;
  private readonly publishing = new Set<string>();
  private readonly navigation: HistoryNavigation;
  private chain: Promise<void> = Promise.resolve();
  private queue: Job[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private originals = new Set<Promise<PersistenceResult>>();
  private readonly originalReports = new WeakMap<
    Promise<PersistenceResult>,
    Promise<PersistenceResult>
  >();
  private fenced = false;
  private used: number;
  private policyGeneration = 0;
  private configurationFloor = 0;
  private reserved = new Map<string, number>();
  private contexts = new Map<string, ContextVersion>();
  private revisions = new Map<string, number>();
  private children = new Map<string, ChildState>();
  private authOpen = new Map<string, AuthPreparationIntent>();
  private runs = new Map<string, RunState>();
  private ownerDetails = new Map<string, Map<string, OpenDetail>>();
  private pendingParts = new Map<
    string,
    { artifact: Artifact; text: string[] }
  >();
  private partWrites: { artifact: Artifact; text: string[] }[] = [];
  private readonly pool = new CaptureBudgetPool();
  private readonly pools = new Map<string, CaptureBudgetPool>();
  private readonly observers = new Set<CommitObserver>();
  /** Bounded internal notifications, delivered after original commit promises.
   * One coalesced pending notice and one original callback per observer. */
  subscribeCommitted(callback: (notice: CommitNotice) => void): () => void {
    if (this.observers.size >= LIMITS.viewers)
      throw new ContractError("capacity");
    const observer: CommitObserver = {
      callback,
      pending: null,
      busy: false,
      active: true,
    };
    this.observers.add(observer);
    return () => {
      observer.active = false;
      observer.pending = null;
      this.observers.delete(observer);
    };
  }
  private notify(notice: Omit<CommitNotice, "gap">): void {
    for (const observer of this.observers) {
      const tasks = [
          ...new Set([...(observer.pending?.tasks ?? []), ...notice.tasks]),
        ],
        runs = [
          ...new Set([...(observer.pending?.runs ?? []), ...notice.runs]),
        ];
      const gap =
        observer.pending?.gap === true ||
        tasks.length + runs.length > LIMITS.maxPageEntries;
      observer.pending = {
        seq: notice.seq,
        tasks: gap ? [] : tasks,
        runs: gap ? [] : runs,
        gap,
      };
      if (!observer.busy) {
        observer.busy = true;
        setImmediate(() => {
          void this.deliverNotice(observer);
        });
      }
    }
  }
  private async deliverNotice(observer: CommitObserver): Promise<void> {
    const notice = observer.pending;
    observer.pending = null;
    try {
      if (observer.active && notice) await observer.callback(notice);
    } catch {
      observer.active = false;
      observer.pending = null;
      this.observers.delete(observer);
    }
    observer.busy = false;
    if (observer.active && observer.pending) {
      observer.busy = true;
      setImmediate(() => {
        void this.deliverNotice(observer);
      });
    }
  }
  constructor(
    private readonly lease: OwnerLease,
    private readonly options: HistoryWriterOptions = {},
  ) {
    lease.assert();
    this.options = { ...options }; // Freeze selected resource ceilings for this owner.
    for (const limit of [
      options.quotaBytes ?? LIMITS.checkoutQuotaBytes,
      options.episodeReservationBytes ?? LIMITS.episodeReservationBytes,
    ])
      if (!Number.isSafeInteger(limit) || limit < LIMITS.episodeControlBytes)
        throw new ContractError("invalid");
    this.files =
      HistoryFiles.open(lease.coordination) ??
      (() => {
        throw new ContractError("unavailable");
      })();
    this.files.assertWritable();
    this.navigation = new HistoryNavigation(this.files);
    this.writeGeneration = this.files.writeGeneration;
    this.state = this.files.inspect();
    this.used = this.files.usage();
    if (this.state.tail) this.fenced = true;
    // Reconstruct bounded unresolved facts through the SAME semantic reducer.
    // Historical allocation is not restored as a live SDK/dispatch context.
    const unresolved = new Map<string, RunState>();
    const unfinished = new Set<string>();
    const publications = new Set<string>();
    const metadata = new Set<string>();
    for (const batch of this.files.scan()) {
      for (const row of batch.rows) {
        const value = row.value;
        if (
          value.kind === "admission" &&
          value.policy &&
          value.intent.identity.kind === "action" &&
          value.intent.identity.expected.epoch === lease.registration.epoch
        ) {
          const policy = this.resourcePolicy(value.policy.generation);
          if (canonicalJson(policy) !== canonicalJson(value.policy))
            throw new ContractError("conflict");
          this.policyGeneration = Math.max(
            this.policyGeneration,
            policy.generation,
          );
        }
        if (value.kind === "recovery") {
          unresolved.clear();
          this.authOpen.clear();
          unfinished.clear();
          publications.clear();
          metadata.clear();
          this.fenced = false; // Only the scanner-validated explicit operator bridge.
        }
        if (
          value.kind === "admission" &&
          value.intent.identity.kind === "action"
        ) {
          if (value.intent.runId === null)
            metadata.add(value.intent.operationId);
          const expected = value.intent.identity.expected;
          this.configurationFloor = Math.max(
            this.configurationFloor,
            expected.configRev,
          );
          this.revisions.set(
            expected.task?.id ?? "workspace",
            expected.controlRev + 1,
          );
          if (value.intent.runId) {
            if (
              unresolved.has(value.intent.runId) ||
              unresolved.size >= LIMITS.episodes
            )
              throw new ContractError("corrupt-selected");
            unresolved.set(
              value.intent.runId,
              new RunState(value.intent.runId),
            );
          }
        }
        const runId = this.rowRunId(value);
        if (runId) unresolved.get(runId)?.apply(row, batch.marker.last);
        if (value.kind === "capture" || value.kind === "owner") {
          for (const e of value.events) {
            if (e.kind === "owner" && e.value.kind === "fact") {
              if (e.value.fact.kind === "publication-intent")
                publications.add(e.value.fact.publicationId);
              if (e.value.fact.kind === "publication-settled") {
                publications.delete(e.value.fact.publicationId);
                if (
                  e.value.fact.status === "published" &&
                  value.kind === "owner"
                )
                  metadata.delete(value.link.operationId);
              }
            }
            if (
              e.kind === "owner" &&
              e.value.kind === "fact" &&
              e.value.fact.kind === "publication-settled" &&
              ["conflict", "uncertain"].includes(e.value.fact.status)
            )
              this.fenced = true;
            if (e.kind === "capture" && e.value.event.kind === "detail-begin")
              unfinished.add(
                `worker/${value.kind === "capture" ? value.link.childRunId : ""}/${e.value.event.detailId}`,
              );
            if (e.kind === "owner" && e.value.kind === "content-begin")
              unfinished.add(
                `owner/${value.kind === "owner" ? value.link.operationId : ""}/${e.value.detailId}`,
              );
            if (e.kind === "end")
              unfinished.delete(
                `${e.detail.origin.kind}/${e.detail.origin.id}/${e.detail.detailId}`,
              );
          }
          if (unfinished.size > LIMITS.dataFrames)
            throw new ContractError("capacity");
        }
        if (value.kind === "auth-preparation")
          this.authOpen.set(value.intent.operationId, value.intent);
        if (value.kind === "auth-settlement")
          this.authOpen.delete(value.result.operationId);
        if (
          value.kind === "settlement" &&
          uncertainSettlement(value.completion)
        )
          this.fenced = true;
      }
      for (const [runId, state] of unresolved)
        if (state.drained) unresolved.delete(runId);
    }
    if (
      this.state.tail ||
      unresolved.size ||
      this.authOpen.size ||
      unfinished.size ||
      publications.size ||
      metadata.size
    )
      this.fenced = true;
    this.auth = {
      lifetimeTracked: !!options.onOriginal,
      original: (report) => this.originalReports.get(report) ?? report,
      preparation: (input) => this.authPreparation(input),
      settlement: (input) => this.authSettlement(input),
    };
    this.processes = {
      launchIntent: (link, operationId) => this.launchIntent(link, operationId),
      settlement: (link, completion) =>
        this.processSettlement(link, completion),
    };
  }
  get committedSeq(): string {
    return this.state.committedSeq;
  }
  get quarantined(): boolean {
    return this.fenced;
  }
  /** Replayed accepted-context/policy floor across epochs, including metadata;
   * never restores a model choice or admission. */
  get configurationRevisionFloor(): number {
    return Math.max(this.policyGeneration, this.configurationFloor);
  }
  get pendingWrites(): number {
    return this.originals.size;
  }
  get accounting() {
    return {
      episodes: {
        count: this.reserved.size,
        bytes: [...this.reserved.values()].reduce((a, b) => a + b, 0),
      },
      owner: this.pool.accounting,
      children: [...this.pools.values()].map((p) => p.accounting),
    };
  }
  /** W4 supplies current control observations separately from historical admissions.
   * No model/config/current authority is reconstructed from the journal. */
  supplyContext(input: ContextVersion): void {
    const v = decodeContext(input),
      key = v.task?.id ?? "workspace";
    this.lease.assert();
    if (
      v.epoch !== this.lease.registration.epoch ||
      v.workspaceId !== this.files.format.workspaceId ||
      v.configRev < this.policyGeneration ||
      v.controlRev < (this.revisions.get(key) ?? 0)
    )
      throw new ContractError("stale");
    this.contexts.set(key, v);
  }
  /** One actual composition callback; cannot replace an installed source. */
  bindReviewContext(source: ReviewContextSource): void {
    this.assertOrdinary();
    if (this.options.reviewContext) throw new ContractError("conflict");
    this.options.reviewContext = source;
  }
  private readonly reviews = new Map<
    string,
    { taskId: string; published?: { revision: number; identity: string } }
  >();
  private assertReviews(rows: JournalRow[]): void {
    for (const row of rows)
      if (row.value.kind === "owner") {
        const review = this.reviews.get(row.value.link.operationId);
        // Nonapplication is a safety observation, not another review effect.
        if (
          review &&
          !row.value.events.every(
            (e) =>
              e.kind === "owner" &&
              e.value.kind === "fact" &&
              e.value.fact.kind === "publication-settled" &&
              e.value.fact.status !== "published",
          )
        ) {
          this.assertOrdinary();
          if (!this.options.reviewContext)
            throw new ContractError("unavailable");
          this.options.reviewContext(review.taskId, review.published);
        }
      }
  }
  /** Accepted metadata owns new artifacts/quota, not the historical run's
   * released execution reservation. The association remains the selected run. */
  reviewOutput(operationId: string): OwnerJournalPort {
    this.assertOrdinary();
    const operation = readOperationStateForPublication(this.files, operationId),
      identity = operation.intent.identity;
    if (
      operation.intent.runId !== null ||
      identity.kind !== "action" ||
      identity.action.kind !== "review" ||
      identity.expected.epoch !== this.lease.registration.epoch ||
      this.reviews.has(operationId) ||
      this.reviews.size >= 16
    )
      throw new ContractError("conflict");
    if (!this.options.reviewContext) throw new ContractError("unavailable");
    this.options.reviewContext(identity.action.taskId);
    this.reviews.set(operationId, { taskId: identity.action.taskId });
    return this.ownerPort();
  }
  /** Current epoch control sequence from accepted facts, never old execution authority. */
  controlRevision(taskId: string | null): number {
    return this.revisions.get(taskId ?? "workspace") ?? 1;
  }
  currentContext(taskId: string | null): ContextVersion | null {
    const v = this.contexts.get(taskId ?? "workspace");
    return v ? decodeContext(v) : null;
  }
  private fence(): void {
    if (this.fenced) return;
    this.fenced = true;
    try {
      this.options.onFence?.();
    } catch {
      /* Cannot replace original persistence uncertainty. */
    }
  }
  private ordinaryClosed = false;
  /** Synchronous action-owner Stop gate; safety settlement is not new work. */
  quiesce(): void {
    this.ordinaryClosed = true;
  }
  private assertOrdinary(): void {
    this.assertWritable();
    if (this.ordinaryClosed) throw new ContractError("quarantine");
  }
  /** Record nonapplication without constructing a candidate or allocating a run.
   * If a real candidate intent already exists, settle that exact identity. */
  abandonPublication(operationId: string): Promise<PersistenceResult> {
    decodeId(operationId);
    return this.enqueue(
      () => {
        const operation = readOperationStateForPublication(
          this.files,
          operationId,
        );
        const intent = operation.intent;
        if (
          operation.recovered ||
          intent.identity.kind !== "action" ||
          intent.identity.expected.epoch !== this.lease.registration.epoch
        )
          throw new ContractError("stale");
        const last = operation.publication;
        if (
          last?.kind === "publication-settled" &&
          (last.status === "uncertain" || last.status === "conflict")
        )
          return undefined;
        const taskId =
          intent.createdTaskId ?? intent.identity.expected.task?.id;
        if (!taskId) throw new ContractError("conflict");
        return this.ownerValue({
          link: {
            epoch: intent.identity.expected.epoch,
            taskId,
            runId: intent.runId,
            operationId,
          },
          observedMs: 0,
          events: [
            {
              kind: "fact",
              fact: {
                kind: "publication-settled",
                publicationId:
                  last?.kind === "publication-intent"
                    ? last.publicationId
                    : randomUUID(),
                status: "uncertain",
                observed: null,
              },
            },
          ],
        });
      },
      1024,
      true,
      undefined,
      true,
    );
  }
  private assertWritable(safety = false, continuation = false): void {
    this.files.assertWriteGeneration(this.writeGeneration);
    this.lease.assert();
    this.files.assertWritable();
    if (this.fenced && !safety) throw new ContractError("quarantine");
    if (this.ordinaryClosed && !safety && !continuation)
      throw new ContractError("quarantine");
  }
  private resourcePolicy(generation: number): ResourcePolicy {
    return {
      generation,
      quotaBytes: this.options.quotaBytes ?? LIMITS.checkoutQuotaBytes,
      episodeReservationBytes:
        this.options.episodeReservationBytes ?? LIMITS.episodeReservationBytes,
      freeSpaceFloorBytes: LIMITS.freeSpaceFloorBytes,
      episodeControlBytes: LIMITS.episodeControlBytes,
    };
  }
  private charge(
    bytes: number,
    runId: string | null = null,
    control = false,
  ): void {
    const remaining = [...this.reserved.entries()].reduce(
      (n, [id, size]) => n + Math.max(0, size - (id === runId ? bytes : 0)),
      0,
    );
    if (
      this.used + bytes + remaining >
        (this.options.quotaBytes ?? LIMITS.checkoutQuotaBytes) ||
      this.files.freeBytes() < LIMITS.freeSpaceFloorBytes + bytes ||
      (runId &&
        this.reserved.has(runId) &&
        (this.reserved.get(runId) ?? 0) <
          bytes + (control ? 0 : LIMITS.episodeControlBytes))
    )
      throw new ContractError("recording-exhausted");
    this.used += bytes;
    if (runId && this.reserved.has(runId))
      this.reserved.set(
        runId,
        Math.max(0, (this.reserved.get(runId) ?? 0) - bytes),
      );
  }
  private reserveEpisode(runId: string): void {
    if (this.reserved.has(runId)) throw new ContractError("conflict");
    const bytes =
      this.options.episodeReservationBytes ?? LIMITS.episodeReservationBytes;
    if (
      bytes < LIMITS.episodeControlBytes ||
      this.reserved.size >= LIMITS.episodes ||
      this.used + [...this.reserved.values()].reduce((a, b) => a + b, bytes) >
        (this.options.quotaBytes ?? LIMITS.checkoutQuotaBytes) ||
      this.files.freeBytes() < LIMITS.freeSpaceFloorBytes + bytes
    )
      throw new ContractError("recording-exhausted");
    this.reserved.set(runId, bytes);
  }
  private enqueue(
    build: Job["build"],
    bytes: number,
    immediate: boolean,
    settled?: () => void,
    safety = false,
    continuation = false,
  ): Promise<PersistenceResult> {
    if (this.fenced && !safety) {
      settled?.();
      return Promise.resolve(failure(false));
    }
    let release: () => void;
    try {
      release = this.files.retainOriginal(this.writeGeneration);
    } catch {
      this.fence();
      settled?.();
      return Promise.resolve(failure(false));
    }
    let resolve!: Job["resolve"];
    const original = new Promise<PersistenceResult>((yes) => {
      resolve = yes;
    });
    this.originals.add(original);
    void original.then(() => {
      this.originals.delete(original);
      release();
      settled?.();
    });
    try {
      this.options.onOriginal?.(original, safety || continuation);
    } catch {
      this.fence();
      resolve(failure(false));
      return original;
    }
    if (
      this.queue.length &&
      this.queue.reduce((n, j) => n + j.bytes, 0) + bytes >
        LIMITS.progressBatchBytes
    )
      this.schedule();
    this.queue.push({
      build,
      bytes,
      resolve,
      safety,
      continuation,
      control: immediate,
    });
    if (
      immediate ||
      this.queue.reduce((n, j) => n + j.bytes, 0) >= LIMITS.progressBatchBytes
    )
      this.schedule();
    else
      this.timer ??= setTimeout(() => this.schedule(), LIMITS.progressBatchMs);
    // Deadline reports/fences; it does NOT settle/refund the original promise.
    let timer: ReturnType<typeof setTimeout>;
    const report = Promise.race([
      original.then((result) => {
        clearTimeout(timer);
        return result;
      }),
      new Promise<PersistenceResult>((yes) => {
        timer = setTimeout(() => {
          this.fence();
          yes(failure(true));
        }, LIMITS.recordingStallMs);
      }),
    ]);
    this.originalReports.set(report, original);
    return report;
  }
  private rowRunId(v: JournalValue): string | null {
    return v.kind === "admission"
      ? v.intent.identity.kind === "action"
        ? v.intent.runId
        : null
      : v.kind === "auth-preparation"
        ? v.intent.runId
        : v.kind === "auth-settlement"
          ? (this.authOpen.get(v.result.operationId)?.runId ?? null)
          : v.kind === "launch" ||
              v.kind === "settlement" ||
              v.kind === "owner" ||
              v.kind === "capture"
            ? v.link.runId
            : null;
  }
  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.queue.length) return;
    const jobs = this.queue;
    this.queue = [];
    this.chain = this.chain.then(async () => {
      const rows: JournalRow[] = [];
      const ownRows = new Map<Job, JournalRow>();
      let result: PersistenceResult;
      const candidateRuns = new Map<string, RunState>();
      const candidateOperations = new Map<string, OperationState>();
      const safety = jobs.every((j) => j.safety);
      const continuation = jobs.every((j) => j.safety || j.continuation);
      try {
        this.assertWritable(safety, continuation);
        for (const job of jobs) {
          const seq = String(
            BigInt(this.state.committedSeq) + BigInt(rows.length) + 1n,
          );
          const value = await job.build(seq);
          if (value) {
            const row: JournalRow = {
              kind: "record",
              seq,
              id: randomUUID(),
              value,
            };
            rows.push(row);
            ownRows.set(job, row);
          }
        }
        if (rows.length) {
          // Candidate copies never authorize capture/readers before original durability.
          const watermark = rows[rows.length - 1].seq;
          for (const row of rows) {
            const v = row.value;
            if (
              v.kind === "owner" &&
              v.events.some(
                (e) =>
                  e.kind === "owner" &&
                  e.value.kind === "fact" &&
                  (e.value.fact.kind === "review" ||
                    (v.link.runId === null &&
                      ["publication-intent", "publication-settled"].includes(
                        e.value.fact.kind,
                      ))),
              )
            ) {
              const op =
                candidateOperations.get(v.link.operationId) ??
                readOperationState(this.files, v.link.operationId);
              op.apply(row, watermark);
              candidateOperations.set(v.link.operationId, op);
            }
            const runId = v.kind === "capture" ? null : this.rowRunId(v);
            if (!runId) continue;
            let candidate = candidateRuns.get(runId);
            if (!candidate) {
              candidate =
                this.runs.get(runId)?.copy() ?? this.retainedRun(runId);
              candidateRuns.set(runId, candidate);
            }
            candidate.apply(row, watermark);
            if (candidate.admission)
              this.files.readAdmission(runId, candidate.admission);
          }
          this.assertReviews(rows);
          for (const part of this.partWrites) {
            const text = part.text.join("");
            part.artifact.sha256 = hash(text);
            this.charge(part.artifact.bytes, part.artifact.runId, false);
            this.files.writeArtifact(this.lease, part.artifact, text);
          }
          this.pendingParts.clear();
          this.partWrites = [];
          await this.options.observeWrite?.("artifacts");
          this.assertWritable(safety, continuation);
          this.assertAdmissionContexts(rows);
          this.assertReviews(rows);
          const activeCandidates = new Map(this.runs);
          for (const [id, state] of candidateRuns) {
            const details = state.admission
              ? this.ownerDetails.get(state.admission.operationId)
              : undefined;
            if (
              state.drained &&
              state.admission &&
              (!details || [...details.values()].every((d) => d.ended))
            )
              activeCandidates.delete(id);
            else activeCandidates.set(id, state);
          }
          const activeRows = [...activeCandidates.values()].flatMap((r) =>
            r.admission?.context.task
              ? [{ runId: r.runId, taskId: r.admission.context.task.id }]
              : [],
          );
          let preparedIndex:
            | import("./navigation.ts").PreparedIndex
            | undefined;
          try {
            preparedIndex = this.navigation.prepare(
              this.lease,
              this.state,
              rows,
              activeRows,
              (bytes) => this.charge(bytes, null, true),
            );
          } catch {
            /* Navigation exhaustion cannot erase original safety accounting.
            An unindexed commit drops acceleration until explicit rebuild; never
            carry an old root over unindexed source facts. Orphans stay charged. */
          }
          const before = this.state;
          this.state = await this.files.append(
            this.lease,
            this.state,
            rows,
            async (stage) => {
              await this.options.observeWrite?.(stage);
              this.assertReviews(rows);
            },
            preparedIndex?.root,
            (encodedBatch) => {
              let markerBytes = encodedBatch.trailerBytes,
                index = 0;
              for (const [job, row] of ownRows) {
                this.charge(
                  encodedBatch.rowBytes[index++] + markerBytes,
                  this.rowRunId(row.value),
                  job.control,
                );
                markerBytes = 0;
              }
            },
            () => this.assertReviews(rows),
          );
          this.assertAdmissionContexts(rows);
          this.assertReviews(rows);
          // Derived hints follow ORIGINAL durability. Failure preserves orphan
          // bytes and leaves bounded authoritative reads/inconclusive available.
          try {
            const offset =
              before.segment === this.state.segment ? before.bytes : 0;
            this.navigation.publish(
              this.lease,
              {
                segment: this.state.segment,
                offset,
                bytes: this.state.bytes - offset,
                seq: this.state.committedSeq,
              },
              rows,
              (bytes) => this.charge(bytes, null, true),
              preparedIndex,
            );
          } catch {
            /* Never turn an accelerator into acceptance authority. */
          }
          this.rememberTaskFolds(rows, preparedIndex);
        }
        const batch: CommittedBatch = {
          committedSeq: this.state.committedSeq,
          details: [],
          ownerDetails: [],
          coverage: { ...COMPLETE, omissions: [] },
        };
        for (const row of rows) {
          const v = row.value;
          if (v.kind === "admission" && v.policy)
            this.policyGeneration = Math.max(
              this.policyGeneration,
              v.policy.generation,
            );
          if (v.kind === "admission" && v.intent.identity.kind === "action") {
            const e = v.intent.identity.expected,
              key = e.task?.id ?? "workspace";
            this.configurationFloor = Math.max(
              this.configurationFloor,
              e.configRev,
            );
            const next = { ...e, controlRev: e.controlRev + 1 };
            this.contexts.set(key, next);
            this.revisions.set(key, next.controlRev);
          }
          if (v.kind === "auth-preparation")
            this.authOpen.set(v.intent.operationId, v.intent);
          if (v.kind === "auth-settlement")
            this.authOpen.delete(v.result.operationId);
          if (v.kind === "launch") {
            this.children.set(v.link.childRunId, {
              link: v.link,
              operationId: v.operationId,
              ready: false,
              settled: false,
              messages: new Map(),
              tools: new Map(),
              details: new Map(),
              final: null,
            });
          }
          if (v.kind === "settlement") {
            if (uncertainSettlement(v.completion)) this.fence();
            this.children.delete(v.link.childRunId);
            this.pools.delete(v.link.childRunId);
          }
          if (v.kind === "owner") {
            if (
              v.events.some(
                (e) =>
                  e.kind === "owner" &&
                  e.value.kind === "fact" &&
                  e.value.fact.kind === "publication-settled" &&
                  ["conflict", "uncertain"].includes(e.value.fact.status),
              )
            )
              this.fence();
            const details = this.ownerDetails.get(v.link.operationId);
            if (details) {
              for (const [id, detail] of details)
                if (detail.ended) details.delete(id);
              if (!details.size) this.ownerDetails.delete(v.link.operationId);
            }
          }
          if (v.kind === "capture" || v.kind === "owner")
            for (const event of v.events)
              if (event.kind === "end") {
                const d = event.detail;
                batch.coverage = combineCoverage(batch.coverage, d.coverage);
                if (d.origin.kind === "worker") {
                  const active = this.children
                    .get(d.origin.id)
                    ?.details.get(d.detailId);
                  if (!active || active.ended !== d)
                    throw new ContractError("corrupt-selected");
                  active.committedSeq = this.state.committedSeq;
                  batch.details.push({
                    childRunId: d.origin.id,
                    detailId: d.detailId,
                    content: { ...d.content },
                    committedSeq: this.state.committedSeq,
                  });
                } else
                  batch.ownerDetails.push({
                    operationId: d.origin.id,
                    detailId: d.detailId,
                    content: { ...d.content },
                    committedSeq: this.state.committedSeq,
                  });
              }
        }
        for (const [runId, state] of candidateRuns) {
          if (
            state.unknownGate ||
            ["conflict", "uncertain"].includes(state.publication)
          )
            this.fence();
          if (
            state.drained &&
            state.admission &&
            !this.ownerDetails.get(state.admission.operationId)?.size
          ) {
            this.reserved.delete(runId);
            this.runs.delete(runId);
          } else {
            this.runs.set(runId, state);
            if (
              (state.settlement?.kind === "parent" &&
                state.settlement.outcome === "unknown") ||
              (state.settlement?.kind === "check" &&
                state.settlement.native.closure === "unconfirmed")
            )
              this.fence();
          }
        }
        if (rows.length) {
          try {
            this.navigation.publishActive(
              this.lease,
              this.state.committedSeq,
              [...this.runs.values()].flatMap((r) =>
                r.admission?.context.task
                  ? [{ runId: r.runId, taskId: r.admission.context.task.id }]
                  : [],
              ),
              (bytes) => this.charge(bytes, null, true),
            );
          } catch {
            /* derived navigation remains inconclusive */
          }
          const tasks = new Set<string>(),
            runs = new Set<string>(candidateRuns.keys());
          for (const state of candidateRuns.values())
            if (state.admission?.context.task)
              tasks.add(state.admission.context.task.id);
          for (const row of rows) {
            const v = row.value,
              run = this.rowRunId(v);
            if (run) runs.add(run);
            if (
              v.kind === "owner" ||
              v.kind === "capture" ||
              v.kind === "launch" ||
              v.kind === "settlement"
            )
              tasks.add(v.link.taskId);
            if (v.kind === "admission" && v.intent.identity.kind === "action") {
              const id =
                v.intent.createdTaskId ?? v.intent.identity.expected.task?.id;
              if (id) tasks.add(id);
            }
          }
          const notice = {
            seq: batch.committedSeq,
            tasks: [...tasks],
            runs: [...runs],
          };
          this.notify(notice);
        }
        result =
          batch.committedSeq === "0"
            ? failure(false)
            : { status: "committed", batch };
      } catch {
        this.pendingParts.clear();
        this.partWrites = [];
        this.fence();
        result = failure(true);
      }
      for (const job of jobs) {
        if (result.status !== "committed") {
          job.resolve(result);
          continue;
        }
        const v = ownRows.get(job)?.value;
        const ends =
          v?.kind === "capture" || v?.kind === "owner"
            ? v.events.flatMap((e) => (e.kind === "end" ? [e.detail] : []))
            : [];
        job.resolve({
          status: "committed",
          batch: {
            ...result.batch,
            details: result.batch.details.filter((d) =>
              ends.some(
                (e) =>
                  e.origin.kind === "worker" &&
                  e.origin.id === d.childRunId &&
                  e.detailId === d.detailId,
              ),
            ),
            ownerDetails: result.batch.ownerDetails.filter((d) =>
              ends.some(
                (e) =>
                  e.origin.kind === "owner" &&
                  e.origin.id === d.operationId &&
                  e.detailId === d.detailId,
              ),
            ),
          },
        });
      }
    });
  }
  private assertAdmissionContexts(rows: JournalRow[]): void {
    for (const { value } of rows) {
      if (value.kind !== "admission" || value.intent.identity.kind !== "action")
        continue;
      const expected = value.intent.identity.expected;
      const current = this.contexts.get(expected.task?.id ?? "workspace");
      if (!current || canonicalJson(expected) !== canonicalJson(current))
        throw new ContractError("stale");
    }
  }
  async flush(): Promise<PersistenceResult> {
    this.schedule();
    const result = this.enqueue(
      () =>
        this.state.committedSeq === "0"
          ? { kind: "owner-epoch", epoch: this.lease.registration.epoch }
          : undefined,
      0,
      true,
      undefined,
      true,
    );
    return result;
  }
  /** Original drains, even after a reporting timeout. Does not clear quarantine. */
  async settled(): Promise<void> {
    this.schedule();
    await this.chain;
  }
  async checkpoint(): Promise<void> {
    const flushed = await this.flush();
    if (flushed.status !== "committed") throw new ContractError("quarantine");
    const result = await this.enqueue(
      async () => {
        this.charge(16384, null, true); // Conservative metadata allowance, including a failed temporary.
        this.files.checkpoint(this.lease, this.state);
        await this.options.observeWrite?.("checkpoint");
        return undefined;
      },
      16384,
      true,
    );
    if (result.status !== "committed") throw new ContractError("quarantine");
  }
  reservedIdentity(commandId: string): AdmissionIntent["identity"] | null {
    decodeId(commandId);
    try {
      const bytes = this.files.readCommand(
        commandId,
        HistoryReadBudget.authority(),
      );
      return bytes
        ? decodeAdmissionIntent(json(bytes, RECORD_BYTES)).identity
        : null;
    } catch {
      return null; // Unknown intent cannot become absence or a fabricated receipt.
    }
  }
  lookup(commandId: string): Promise<StoredLookup> {
    return this.lookupCommitted(commandId);
  }
  /** Admission-only original barrier. Passive receipt reads remain immediately
   * inconclusive while publication is fenced, rather than waiting on a writer. */
  lookupForAdmission(commandId: string): Promise<StoredLookup> {
    decodeId(commandId);
    // Insert one readonly observation at the exact existing original boundary.
    // Later writes follow it rather than racing or extending a moving barrier.
    // No flush, append, index write or assumption of receipt absence occurs here.
    const lookup = this.chain.then(() => this.lookupCommitted(commandId));
    this.chain = lookup.then(
      () => {},
      () => {},
    );
    return lookup;
  }
  private async lookupCommitted(commandId: string): Promise<StoredLookup> {
    decodeId(commandId);
    try {
      const budget = HistoryReadBudget.authority();
      const intent = this.files.readCommand(commandId, budget);
      const directoryExists = this.files.files.directory(
        join(this.files.directory, "commands", commandId),
      );
      const wanted = intent
        ? decodeAdmissionIntent(json(intent, RECORD_BYTES))
        : null;
      let found: StoredCommand | null = null;
      let run: RunState | null = null;
      let operation: OperationState | null = null;
      const scan = emptyScan();
      for (const batch of this.files.scan(scan, false, budget)) {
        for (const row of batch.rows)
          if (
            row.value.kind === "admission" &&
            row.value.intent.commandId === commandId
          ) {
            if (
              !wanted ||
              canonicalJson(wanted) !== canonicalJson(row.value.intent) ||
              found
            )
              return { status: "inconclusive" };
            found = row.value.record;
            if (
              row.value.intent.identity.kind === "action" &&
              row.value.intent.runId
            )
              run = new RunState(row.value.intent.runId);
            else if (row.value.intent.identity.kind === "action")
              operation = new OperationState(row.value.intent.operationId);
          }
        for (const row of batch.rows) {
          run?.apply(row, batch.marker.last);
          operation?.apply(row, batch.marker.last);
        }
      }
      if (found)
        return {
          status: "found",
          record: decodeStoredCommand(
            run?.receipt() ?? operation?.receipt() ?? found,
          ),
        };
      if (wanted || directoryExists || scan.tail)
        return { status: "inconclusive" };
      return { status: "absent", committedSeq: scan.committedSeq };
    } catch {
      return { status: "inconclusive" };
    }
  }
  /** W4: accepted command -> immutable allocation -> auth -> launch. */
  admitRun(
    runId: string,
    identity: RunIdentity,
    graph: Graph | null = null,
    observedMs = 0,
  ): Promise<PersistenceResult> {
    const admission = decodeRunAdmission({
      schema: "cadence-run-admission/2",
      runId,
      identity,
      graph,
    });
    const task = admission.identity.context.task;
    if (!task) throw new ContractError("invalid");
    const input = decodeOwnerRecordingInput({
      link: {
        epoch: admission.identity.context.epoch,
        taskId: task.id,
        runId,
        operationId: admission.identity.operationId,
      },
      observedMs,
      events: [
        {
          kind: "fact",
          fact: {
            kind: "parent-admitted",
            runId,
            identity: admission.identity,
          },
        },
      ],
    });
    const budget = {
      sourceFrames: 0,
      retainedBytes: Buffer.byteLength(canonicalJson(admission)),
      outputBytes: Buffer.byteLength(canonicalJson(input)),
      outputChunks: 1,
      lane: "control" as const,
    };
    const lease = this.pool.reserve(budget);
    lease.beginOwner(input);
    return this.enqueue(
      () => {
        this.assertOrdinary();
        return this.ownerValue(input, admission.graph);
      },
      budget.retainedBytes + budget.outputBytes,
      true,
      () => lease.settled(),
    );
  }
  async commit(input: AdmissionIntent): Promise<AdmissionCommit> {
    const intent = decodeAdmissionIntent(input);
    let record: StoredCommand | undefined,
      existing = false,
      refused: AdmissionCommit | undefined;
    const outcome = await this.enqueue(
      async (seq) => {
        this.assertOrdinary();
        const lookup = await this.lookupCommitted(intent.commandId);
        if (lookup.status === "found") {
          if (
            canonicalJson(lookup.record.identity) !==
            canonicalJson(intent.identity)
          )
            refused = { status: "refused", error: publicError("conflict") };
          else {
            record = lookup.record;
            existing = true;
          }
          return;
        }
        if (lookup.status !== "absent") {
          refused = { status: "uncertain" };
          return;
        }
        if (intent.identity.kind === "action") {
          const expected = intent.identity.expected,
            current = this.contexts.get(expected.task?.id ?? "workspace");
          if (!current || canonicalJson(expected) !== canonicalJson(current)) {
            refused = { status: "refused", error: publicError("stale") };
            return;
          }
        } else if (intent.identity.epoch !== this.lease.registration.epoch) {
          refused = { status: "refused", error: publicError("stale") };
          return;
        }
        if (
          this.prior(
            (v) =>
              (v.kind === "admission" &&
                (v.intent.operationId === intent.operationId ||
                  (intent.identity.kind === "action" &&
                    intent.runId !== null &&
                    v.intent.identity.kind === "action" &&
                    v.intent.runId === intent.runId))) ||
              (v.kind === "auth-preparation" &&
                v.intent.operationId === intent.operationId),
          )
        ) {
          refused = { status: "refused", error: publicError("conflict") };
          return;
        }
        if (
          intent.identity.kind === "action" &&
          intent.identity.action.kind === "create" &&
          this.lease.coordination.store.list().length >= 1000
        ) {
          refused = { status: "refused", error: publicError("capacity") };
          return;
        }
        if (intent.identity.kind === "action") {
          const expected = intent.identity.expected;
          if (intent.runId) {
            if (
              [...this.runs.values()].some(
                (r) =>
                  this.reserved.has(r.runId) &&
                  r.command?.intent.identity.kind === "action" &&
                  r.command.intent.identity.expected.task?.id ===
                    expected.task?.id,
              )
            ) {
              refused = { status: "refused", error: publicError("conflict") };
              return;
            }
            this.reserveEpisode(intent.runId);
          }
        }
        this.used = Math.max(this.used, this.files.usage());
        record = decodeStoredCommand({
          identity: intent.identity,
          receipt: {
            commandId: intent.commandId,
            operationId: intent.operationId,
            runId: intent.runId,
            admission: "accepted",
            committedSeq: seq,
            execution: null,
            settlement: null,
            created: intent.createdTaskId
              ? {
                  kind: "task",
                  taskId: intent.createdTaskId,
                  state: "reserved",
                }
              : null,
            publication: "pending",
          },
        });
        this.assertOrdinary();
        const bytes = encoded(intent);
        this.charge(Buffer.byteLength(bytes), intent.runId, true);
        this.files.files.create(
          join(
            this.files.directory,
            "commands",
            intent.commandId,
            "intent.json",
          ),
          bytes,
          RECORD_BYTES,
        );
        this.files.syncParents(
          join(
            this.files.directory,
            "commands",
            intent.commandId,
            "intent.json",
          ),
        );
        await this.options.observeWrite?.("intent");
        const policy = this.resourcePolicy(
          intent.identity.kind === "action"
            ? intent.identity.expected.configRev
            : 1,
        );
        return { kind: "admission", intent, record, policy };
      },
      Buffer.byteLength(canonicalJson(intent)),
      true,
    );
    if (outcome.status !== "committed")
      return refused ?? { status: "uncertain" };
    return (
      refused ??
      (record
        ? {
            status: existing ? "existing" : "committed",
            record: decodeStoredCommand(record),
          }
        : { status: "uncertain" })
    );
  }
  /** Retain only the exact proposal named by a COMMITTED save-plan operation.
   * No public content-begin ID override, preflight write or alternate writer.
   * Owner literals must also have been checked BEFORE consent/commit by the caller. */
  retainAcceptedPlan(
    operationId: string,
    secrets: readonly string[],
  ): Promise<PersistenceResult> {
    decodeId(operationId);
    // Bound the selected admission, literal snapshot and escaped plan events before
    // copying/reading. No reservation is refunded on a reporting timeout.
    const lease = this.pool.reserve({
      sourceFrames: 0,
      retainedBytes: LIMITS.controlBytes + 2 * LIMITS.workerRequestBytes,
      outputBytes: 256 * 1024,
      outputChunks: 7, // UTF-8 boundary retreat can add one final chunk.
      lane: "data",
    });
    let sanitizer: TextSanitizer;
    try {
      sanitizer = new TextSanitizer(secrets);
    } catch (error) {
      lease.release();
      throw error;
    }
    let begun = false;
    let refused: PersistenceResult | undefined;
    const refuse = (code: "invalid" | "conflict" | "stale"): undefined => {
      refused = {
        status: "refused",
        durability: "none",
        error: publicError(code),
      };
      return undefined;
    };
    return this.enqueue(
      async () => {
        this.assertOrdinary();
        let operation: ReturnType<typeof readOperationStateForPublication>;
        try {
          operation = readOperationStateForPublication(this.files, operationId);
        } catch (error) {
          if (error instanceof ContractError && error.code === "conflict")
            return refuse("conflict");
          throw error;
        }
        const { intent, state } = operation;
        if (
          operation.recovered ||
          intent.identity.kind !== "action" ||
          intent.identity.expected.epoch !== this.lease.registration.epoch
        )
          return refuse("stale");
        const { action, expected } = intent.identity;
        if (
          intent.runId !== null ||
          action.kind !== "save-plan" ||
          !expected.task ||
          action.taskId !== expected.task.id ||
          state.receipt()?.receipt.publication !== "pending"
        )
          return refuse("conflict");
        const current = this.contexts.get(action.taskId);
        const selected = this.lease.coordination.store.loadSnapshot(
          action.taskId,
        );
        if (
          !current ||
          canonicalJson({
            ...current,
            accessGeneration: expected.accessGeneration,
          }) !==
            canonicalJson({
              ...expected,
              controlRev: expected.controlRev + 1,
            }) ||
          !selected ||
          selected.identity !== expected.task.identity ||
          selected.record.revision !== expected.task.revision ||
          action.graph.taskKind !== expected.task.kind ||
          action.graph.taskRevision !== expected.task.revision + 1 ||
          action.graph.revision !== (expected.task.graphRevision ?? 0) + 1
        )
          return refuse("stale");
        try {
          assertPlanContent(action.plan, action.graph.plan, []);
          if (sanitizer.write(action.plan, true) !== action.plan)
            return refuse("invalid");
        } catch (error) {
          if (error instanceof ContractError && error.code === "invalid")
            return refuse("invalid");
          throw error;
        }
        const ref = action.graph.plan;
        // A prospective identity cannot alias an earlier accepted proposal, open
        // allocation, artifact or committed field, including an empty field.
        const collision = [
          ...this.ownerDetails.values(),
          ...[...this.children.values()].map((c) => c.details),
        ].some((details) =>
          [...details.values()].some((d) => d.recordId === ref.recordId),
        );
        if (
          collision ||
          this.prior(
            (v) =>
              (v.kind === "admission" &&
                v.intent.operationId !== operationId &&
                v.intent.identity.kind === "action" &&
                v.intent.identity.action.kind === "save-plan" &&
                v.intent.identity.action.graph.plan.recordId ===
                  ref.recordId) ||
              ((v.kind === "owner" || v.kind === "capture") &&
                v.events.some(
                  (e) =>
                    (e.kind === "end" &&
                      e.detail.content.recordId === ref.recordId) ||
                    (e.kind === "chunk" &&
                      e.artifact.artifactId === ref.recordId),
                )),
          )
        )
          return refuse("conflict");
        const input = planRecording(
          action.plan,
          action.graph,
          operationId,
          expected.epoch,
        );
        const decoded = lease.beginOwner(input);
        begun = true;
        return this.ownerValue(decoded, null, ref);
      },
      lease.budget.retainedBytes + lease.budget.outputBytes,
      true,
      () => (begun ? lease.settled() : lease.release()),
    ).then((result) => refused ?? result);
  }
  /** Default/legacy Start producer, deliberately separate from save-plan-only API.
   * The accepted context pins the prospective graph; plan text comes ONLY from
   * the exact current raw task, never a caller's replacement or historical approval. */
  retainAcceptedRunPlan(
    operationId: string,
    graph: Graph,
    secrets: readonly string[],
  ): Promise<PersistenceResult> {
    const lease = this.pool.reserve({
      sourceFrames: 0,
      retainedBytes: 2 * LIMITS.controlBytes,
      outputBytes: 256 * 1024,
      outputChunks: 7,
      lane: "data",
    });
    let begun = false;
    let selected: Graph;
    try {
      selected = decodeGraph(graph);
    } catch (error) {
      lease.release();
      throw error;
    }
    return this.enqueue(
      () => {
        const operation = readOperationStateForPublication(
            this.files,
            operationId,
          ),
          intent = operation.intent;
        if (
          operation.recovered ||
          intent.identity.kind !== "action" ||
          intent.identity.action.kind !== "start" ||
          !intent.runId
        )
          throw new ContractError("conflict");
        const expected = intent.identity.expected,
          task = expected.task,
          snapshot = task
            ? this.lease.coordination.store.loadSnapshot(task.id)
            : undefined;
        const current = task ? this.contexts.get(task.id) : undefined;
        if (
          !snapshot ||
          !task ||
          expected.epoch !== this.lease.registration.epoch ||
          snapshot.identity !== task.identity ||
          snapshot.record.revision !== task.revision ||
          selected.taskId !== task.id ||
          selected.taskKind !== task.kind ||
          selected.taskRevision !== task.revision ||
          selected.revision !== task.graphRevision ||
          hash(canonicalJson(selected)) !== task.graphIdentity ||
          !current ||
          canonicalJson({
            ...current,
            accessGeneration: expected.accessGeneration,
          }) !==
            canonicalJson({ ...expected, controlRev: expected.controlRev + 1 })
        )
          throw new ContractError("stale");
        assertPlanContent(snapshot.record.plan, selected.plan, secrets);
        // Only absent saved-plan ownership can use this producer. No adoption of an
        // older committed reference, even if text/hash coincides.
        if (
          HistoryReader.open(this.lease.coordination)?.publishedPlan(
            task.id,
            this.state.committedSeq,
          ) ||
          this.prior(
            (v) =>
              (v.kind === "owner" || v.kind === "capture") &&
              v.events.some(
                (e) =>
                  (e.kind === "end" &&
                    e.detail.content.recordId === selected.plan.recordId) ||
                  (e.kind === "chunk" &&
                    e.artifact.artifactId === selected.plan.recordId),
              ),
          )
        )
          throw new ContractError("conflict");
        const input = lease.beginOwner(
          planRecording(
            snapshot.record.plan,
            selected,
            operationId,
            expected.epoch,
          ),
        );
        begun = true;
        return this.ownerValue(input, null, selected.plan);
      },
      lease.budget.retainedBytes + lease.budget.outputBytes,
      true,
      () => (begun ? lease.settled() : lease.release()),
    );
  }
  /** Actual v1 side effect: committed expected-byte intent -> held save -> observed
   * identity -> committed outcome, all serialized by this original writer. */
  /** After original durability and its derived hints: remember, in this
   * process only, each task's fold state at its prepared chain head when this
   * batch settles its publication. An accelerator only; any failure (format2
   * store, exhaustion) leaves the original chain to be folded. */
  private rememberTaskFolds(
    rows: JournalRow[],
    prepared: import("./navigation.ts").PreparedIndex | undefined,
  ): void {
    if (!prepared) return;
    const tasks = new Set<string>();
    for (const { value: v } of rows)
      if (
        v.kind === "owner" &&
        v.events.some(
          (e) =>
            e.kind === "owner" &&
            e.value.kind === "fact" &&
            e.value.fact.kind === "publication-settled",
        )
      )
        tasks.add(v.link.taskId);
    for (const taskId of tasks) {
      const head = prepared.heads.get(taskId);
      if (!head || head.seq !== this.state.committedSeq) continue;
      try {
        const checks = checkFold(
          this.files,
          taskId,
          head.seq,
          HistoryReadBudget.authority(),
        ).state();
        const run = latestTaskRun(
          this.files,
          taskId,
          head.seq,
          HistoryReadBudget.authority(),
        );
        const plan = planFold(
          this.files,
          taskId,
          head.seq,
          HistoryReadBudget.authority(),
          new HistoryNavigation(this.files),
          true,
        ).state();
        taskFoldMemory(this.files).remember(taskId, head, {
          checks,
          run,
          plan,
        });
      } catch {
        /* Never turn an accelerator into acceptance authority. */
      }
    }
  }
  async publishTask(
    request: TaskPublicationRequest,
  ): Promise<TaskPublicationResult> {
    request = structuredClone(request);
    decodeId(request.operationId);
    if (this.publishing.has(request.operationId))
      return {
        status: "refused",
        publicationId: null,
        committedSeq: null,
        observed: null,
      };
    // Admit this specific original publication before quiescence. Both of its
    // exact intent/save/outcome jobs may drain during Stop; this is NOT authority
    // for a new publication after Stop or any write after a durability fence.
    try {
      this.assertOrdinary();
    } catch {
      return {
        status: "refused",
        publicationId: null,
        committedSeq: null,
        observed: null,
      };
    }
    this.publishing.add(request.operationId);
    const publicationId = randomUUID();
    let link: OwnerLink | undefined;
    let record: import("../task-types.ts").TaskRecord | undefined;
    let expected: { revision: number; identity: string | null } | undefined;
    let observed: TaskPublicationResult["observed"] = null;
    let status: TaskPublicationResult["status"] = "uncertain";
    let assertContext = () => {};
    try {
      const prepared = await this.enqueue(
        () => {
          this.assertWritable(false, true);
          const operation = readOperationStateForPublication(
            this.files,
            request.operationId,
          );
          const intent = operation.intent;
          if (operation.recovered) throw new ContractError("stale");
          if (
            intent.identity.kind !== "action" ||
            intent.identity.expected.epoch !== this.lease.registration.epoch
          )
            throw new ContractError("stale");
          const identity = intent.identity,
            taskId = intent.createdTaskId ?? identity.expected.task?.id;
          if (!taskId) throw new ContractError("conflict");
          const current = this.contexts.get(
            identity.expected.task?.id ?? "workspace",
          );
          if (
            !current ||
            current.epoch !== identity.expected.epoch ||
            current.controlRev !== identity.expected.controlRev + 1
          )
            throw new ContractError("stale");
          assertContext = () => {
            const latest = this.contexts.get(
              identity.expected.task?.id ?? "workspace",
            );
            if (!latest || canonicalJson(latest) !== canonicalJson(current))
              throw new ContractError("stale");
            if (identity.action.kind === "review") {
              const review = this.options.reviewContext?.(
                taskId,
                this.reviews.get(request.operationId)?.published,
              );
              if (
                !review ||
                review.observation.identity !==
                  identity.action.changesIdentity ||
                review.checks.revision !== identity.action.checksRevision
              )
                throw new ContractError("stale");
            }
          };
          assertContext();
          const run = intent.runId ? this.retainedRun(intent.runId) : null;
          if (run && !run.admission) throw new ContractError("conflict");
          expected = run
            ? run.publicationExpected()
            : operation.state.publicationExpected();
          link = {
            epoch: identity.expected.epoch,
            taskId,
            runId: intent.runId,
            operationId: intent.operationId,
          };
          const reader = HistoryReader.open(this.lease.coordination);
          if (!reader) throw new ContractError("unavailable");
          record = publicationRecord(
            this.lease.coordination.store,
            reader,
            intent,
            link,
            run,
            request,
            expected,
            operation.facts,
            this.state.committedSeq,
          );
          this.charge(
            2 * Buffer.byteLength(`${JSON.stringify(record, null, 2)}\n`),
            intent.runId,
            true,
          );
          return this.ownerValue({
            link,
            observedMs: 0,
            events: [
              {
                kind: "fact",
                fact: {
                  kind: "publication-intent",
                  publicationId,
                  expectedRevision: expected.revision,
                  expectedIdentity: expected.identity,
                  nextRevision: record.revision,
                  nextIdentity: savedRecordIdentity(record),
                },
              },
            ],
          });
        },
        16384,
        true,
        undefined,
        false,
        true,
      );
      if (prepared.status !== "committed" || !record || !expected || !link) {
        if (!link)
          return {
            status: "refused",
            publicationId: null,
            committedSeq: null,
            observed: null,
          };
        const failedLink = link;
        // No candidate bytes/save existed: persist refusal rather than fabricate a next identity.
        const refused = await this.enqueue(
          () =>
            this.ownerValue({
              link: failedLink,
              observedMs: 0,
              events: [
                {
                  kind: "fact",
                  fact: {
                    kind: "publication-settled",
                    publicationId,
                    status: "uncertain",
                    observed: null,
                  },
                },
              ],
            }),
          1024,
          true,
          undefined,
          true,
        );
        return {
          status: "uncertain",
          publicationId: null,
          committedSeq:
            refused.status === "committed" ? refused.batch.committedSeq : null,
          observed: null,
        };
      }
      const selected = record,
        before = expected,
        owner = link;
      const outcome = await this.enqueue(
        async () => {
          await this.options.observeWrite?.("publication-before-save");
          this.assertWritable(false, true);
          const store = this.lease.coordination.store;
          try {
            // Recheck cap at the actual side effect, not just admission or later list.
            if (before.revision === 0 && store.list().length >= 1000)
              throw new ContractError("capacity");
            assertContext();
            store.save(
              selected,
              before.revision,
              this.lease.checkout,
              before.identity ?? undefined,
            );
            syncTaskPublication(store, selected.id);
            const review = this.reviews.get(request.operationId);
            if (review)
              review.published = {
                revision: selected.revision,
                identity: savedRecordIdentity(selected),
              };
            await this.options.observeWrite?.("publication-after-save");
            this.lease.assert();
            if (review) assertContext();
            const actual = store.loadSnapshot(selected.id);
            if (
              !actual ||
              actual.identity !== savedRecordIdentity(selected) ||
              actual.record.revision !== selected.revision
            )
              throw new ContractError("conflict");
            observed = {
              revision: actual.record.revision,
              identity: actual.identity,
            };
            status = "published";
          } catch {
            status = "uncertain";
            try {
              const actual = store.loadSnapshot(selected.id);
              observed = actual
                ? {
                    revision: actual.record.revision,
                    identity: actual.identity,
                  }
                : null;
              if (!actual || actual.identity !== savedRecordIdentity(selected))
                status = "conflict";
            } catch {
              status = "conflict";
            }
          }
          return this.ownerValue({
            link: owner,
            observedMs: 0,
            events: [
              {
                kind: "fact",
                fact: {
                  kind: "publication-settled",
                  publicationId,
                  status:
                    status === "published"
                      ? "published"
                      : status === "conflict"
                        ? "conflict"
                        : "uncertain",
                  observed,
                },
              },
            ],
          });
        },
        16384,
        true,
        undefined,
        false,
        true,
      );
      return {
        status: outcome.status === "committed" ? status : "uncertain",
        publicationId,
        committedSeq:
          outcome.status === "committed" ? outcome.batch.committedSeq : null,
        observed,
      };
    } finally {
      this.publishing.delete(request.operationId);
      if (
        ["published"].includes(status) &&
        !this.fenced &&
        this.pendingWrites === 0
      )
        this.reviews.delete(request.operationId);
    }
  }
  /** Read this committed run through the existing original-validated locator chain.
   * No cache crosses an await. Missing/invalid acceleration uses the SAME bounded
   * original scan, never renewed budgets, an empty-success default or index authority. */
  private retainedRun(runId: string): RunState {
    const budget = HistoryReadBudget.authority();
    const snapshot = this.state.committedSeq;
    this.navigation.snapshot(snapshot, budget);
    const batches = this.navigation.runBatches(runId, snapshot, budget);
    if (!batches) return readRunState(this.files, runId, snapshot, budget);
    const state = new RunState(runId);
    for (const batch of batches)
      for (const row of batch.rows) state.apply(row, batch.pointer.seq);
    return state;
  }
  private prior(matches: (value: JournalValue) => boolean): boolean {
    for (const batch of this.files.scan(
      emptyScan(),
      false,
      HistoryReadBudget.authority(),
    )) {
      if (batch.rows.some((row) => matches(row.value))) return true;
    }
    return false;
  }
  private childSlots(): number {
    let slots = 0;
    for (const run of this.runs.values())
      for (const auth of run.auth.values()) {
        const child = run.children.get(auth.intent.childRunId);
        if (
          child
            ? child.completion === null
            : auth.result === null ||
              (auth.result.outcome === "resolved" &&
                !auth.result.admissionClosed)
        )
          slots++;
      }
    return slots;
  }
  private authPreparation(
    input: AuthPreparationIntent,
  ): Promise<PersistenceResult> {
    const intent = decodeAuthIntent(input);
    return this.enqueue(
      () => {
        this.assertOrdinary();
        if (
          intent.epoch !== this.lease.registration.epoch ||
          this.authOpen.has(intent.operationId) ||
          this.childSlots() >= LIMITS.childReservations ||
          !this.reserved.has(intent.runId) ||
          this.prior(
            (v) =>
              (v.kind === "auth-preparation" || v.kind === "admission") &&
              v.intent.operationId === intent.operationId,
          )
        )
          throw new ContractError("conflict");
        return { kind: "auth-preparation", intent };
      },
      1024,
      true,
    );
  }
  private authSettlement(
    input: AuthPreparationSettlement,
  ): Promise<PersistenceResult> {
    const result = decodeAuthSettlement(input);
    return this.enqueue(
      () => {
        if (!this.authOpen.has(result.operationId))
          throw new ContractError("conflict");
        return { kind: "auth-settlement", result };
      },
      1024,
      true,
      undefined,
      true, // Original auth settlement may be recorded without clearing quarantine.
    );
  }
  private launchIntent(
    input: RecordingLink,
    operationId: string,
  ): Promise<PersistenceResult> {
    const link = decodeRecordingLink(input);
    decodeId(operationId);
    return this.enqueue(
      () => {
        this.assertOrdinary();
        if (
          link.epoch !== this.lease.registration.epoch ||
          this.children.has(link.childRunId) ||
          this.children.size >= LIMITS.childReservations ||
          !this.reserved.has(link.runId) ||
          this.prior(
            (v) => v.kind === "launch" && v.link.childRunId === link.childRunId,
          )
        )
          throw new ContractError("conflict");
        // This state becomes externally usable only after the original commit.
        return { kind: "launch", link, operationId };
      },
      1024,
      true,
    );
  }
  private processSettlement(
    input: RecordingLink,
    value: WorkerCompletion,
  ): Promise<PersistenceResult> {
    const link = decodeRecordingLink(input),
      completion = decodeWorkerCompletion(value);
    return this.enqueue(
      () => {
        const child = this.child(link);
        if (
          completion.native.outcome === "completed" &&
          [...child.details.values()].some((d) => !d.ended)
        )
          throw new ContractError("corrupt-selected");
        if (child.settled || completion.childRunId !== link.childRunId)
          throw new ContractError("conflict");
        if (completion.recording.status === "committed") {
          const final = child.final,
            retained = child.details.get(completion.recording.detail.detailId),
            d = retained?.ended;
          if (
            !d ||
            (completion.native.outcome === "completed" &&
              d.coverage.observed !== "complete") ||
            !final ||
            canonicalJson(final) !== canonicalJson(completion.selected) ||
            canonicalJson(d.content) !==
              canonicalJson(completion.recording.detail.content) ||
            completion.recording.detail.committedSeq !== retained?.committedSeq
          )
            throw new ContractError("corrupt-selected");
          const reader = HistoryReader.open(this.lease.coordination);
          if (!reader) throw new ContractError("corrupt-selected");
          // RAM correlation is not proof that the selected retained bytes still
          // exist. Revalidate exact committed membership and independent hashes.
          for (const _ of reader.parts(
            d,
            completion.recording.detail.committedSeq,
          )) {
            /* bounded parts, no final-text copy */
          }
        }
        for (const d of child.details.values())
          if (
            d.descriptor?.owner.kind === "tool" &&
            !child.tools.has(d.descriptor.owner.callId)
          )
            throw new ContractError("invalid");
        child.settled = true;
        return { kind: "settlement", link, completion };
      },
      8192,
      true,
      undefined,
      true,
    );
  }
  private child(link: RecordingLink): ChildState {
    const child = this.children.get(link.childRunId);
    if (
      !child ||
      canonicalJson(child.link) !== canonicalJson(link) ||
      child.settled
    )
      throw new ContractError("conflict");
    return child;
  }
  capture(input: RecordingLink): CaptureSink {
    const link = decodeRecordingLink(input);
    this.child(link);
    let pool = this.pools.get(link.childRunId);
    if (!pool) {
      if (this.pools.size >= LIMITS.childReservations)
        throw new ContractError("capacity");
      pool = new CaptureBudgetPool();
      this.pools.set(link.childRunId, pool);
    }
    const selected = pool;
    return {
      reserve: (budget) => {
        try {
          if (this.fenced) throw new ContractError("quarantine");
          const lease = selected.reserve(budget);
          return {
            status: "reserved",
            reservation: {
              grow: (extra) => {
                try {
                  lease.grow(extra);
                  return { status: "reserved" };
                } catch {
                  return { status: "refused", error: publicError("capacity") };
                }
              },
              release: () => lease.release(),
              commit: (value) => {
                const decoded = lease.beginWorker(value);
                if (canonicalJson(decoded.link) !== canonicalJson(link)) {
                  lease.settled();
                  throw new ContractError("conflict");
                }
                // Keep the lease charged until ORIGINAL job settlement, not deadline reporting.
                return this.enqueue(
                  () => this.captureValue(decoded),
                  Buffer.byteLength(canonicalJson(decoded)),
                  lease.budget.lane === "control",
                  () => lease.settled(),
                  false,
                  true, // existing launched capture drain, NOT permission past a recording fence
                );
              },
            },
          };
        } catch {
          return { status: "refused", error: publicError("capacity") };
        }
      },
    };
  }
  owner(): OwnerJournalPort {
    return this.ownerPort();
  }
  /** Existing started-check drainage only, not ordinary work after quiesce. */
  checkOutput(link: OwnerLink, checkId: string): OwnerJournalPort {
    const selected = structuredClone(link);
    const state = selected.runId ? this.runs.get(selected.runId) : undefined;
    if (
      !state ||
      state.check?.checkId !== checkId ||
      state.settlement ||
      state.admission?.operationId !== selected.operationId ||
      state.admission.context.epoch !== selected.epoch ||
      state.admission.context.task?.id !== selected.taskId ||
      state.gates.get(checkId)?.state !== "held"
    )
      throw new ContractError("conflict");
    return this.ownerPort({ link: selected, checkId });
  }
  private ownerPort(check?: {
    link: OwnerLink;
    checkId: string;
  }): OwnerJournalPort {
    return {
      reserve: (budget) => {
        try {
          if (this.fenced && budget.lane !== "control")
            throw new ContractError("quarantine");
          const lease = this.pool.reserve(budget);
          return {
            status: "reserved",
            reservation: {
              grow: (extra) => {
                try {
                  lease.grow(extra);
                  return { status: "reserved" };
                } catch {
                  return { status: "refused", error: publicError("capacity") };
                }
              },
              release: () => lease.release(),
              commit: (input) => {
                const value = lease.beginOwner(input);
                if (
                  check &&
                  (canonicalJson(value.link) !== canonicalJson(check.link) ||
                    value.events.some(
                      (e) =>
                        e.kind === "fact" ||
                        (e.kind === "content-begin" &&
                          (e.field !== "check" ||
                            e.owner.entity.kind !== "check" ||
                            e.owner.entity.id !== check.checkId ||
                            e.owner.runId !== check.link.runId ||
                            e.owner.childRunId !== null)),
                    ))
                )
                  throw new ContractError("conflict");
                const safety =
                  lease.budget.lane === "control" &&
                  value.events.length > 0 &&
                  value.events.every(
                    (e) =>
                      e.kind === "fact" &&
                      (e.fact.kind === "admission-closed" ||
                        (e.fact.kind === "assignment-state" &&
                          ["closing", "unstarted"].includes(e.fact.state)) ||
                        e.fact.kind === "parent-settled" ||
                        e.fact.kind === "check-settled" ||
                        (e.fact.kind === "gate" &&
                          ["released", "unknown"].includes(e.fact.state))),
                  );
                return this.enqueue(
                  () => this.ownerValue(value),
                  Buffer.byteLength(canonicalJson(value)),
                  lease.budget.lane === "control",
                  () => lease.settled(),
                  safety,
                  Boolean(check),
                );
              },
            },
          };
        } catch {
          return { status: "refused", error: publicError("capacity") };
        }
      },
    };
  }
  private openDetail(
    detailId: string,
    origin: RetainedDetail["origin"],
    owner: RecordOwner,
    descriptor: DetailDescriptor | null,
    field: OpenDetail["field"],
  ): OpenDetail {
    return {
      detailId,
      origin,
      owner,
      descriptor,
      field,
      recordId: randomUUID(),
      version: 1,
      bytes: 0,
      hash: createHash("sha256"),
      parts: 0,
      ended: null,
      committedSeq: null,
    };
  }
  private chunk(
    detail: OpenDetail,
    text: string,
    source: SourceRange | null,
    runId: string,
  ): SavedEvent {
    if (
      detail.ended ||
      detail.bytes + Buffer.byteLength(text) > LIMITS.detailBytes ||
      !text
    )
      throw new ContractError("invalid");
    const length = Buffer.byteLength(text);
    let part = this.pendingParts.get(detail.recordId);
    if (!part || part.artifact.bytes + length > LIMITS.artifactPartBytes) {
      part = {
        artifact: {
          runId,
          artifactId: detail.recordId,
          part: detail.parts++,
          bytes: 0,
          sha256: "0".repeat(64),
        },
        text: [],
      };
      this.pendingParts.set(detail.recordId, part);
      this.partWrites.push(part);
    }
    const start = part.artifact.bytes;
    part.artifact.bytes += length;
    part.text.push(text);
    const offset = detail.bytes;
    detail.bytes += length;
    detail.hash.update(text);
    return {
      kind: "chunk",
      detailId: detail.detailId,
      artifact: part.artifact,
      source,
      offset,
      start,
      length,
    };
  }
  private end(
    detail: OpenDetail,
    coverage: CaptureCoverage,
    source: SourceRange | null,
  ): SavedEvent {
    if (detail.ended) throw new ContractError("conflict");
    detail.ended = {
      detailId: detail.detailId,
      origin: detail.origin,
      owner: detail.owner,
      descriptor: detail.descriptor,
      content: {
        recordId: detail.recordId,
        version: detail.version,
        field: detail.field,
        bytes: detail.bytes,
        sha256: detail.hash.digest("hex"),
      },
      coverage,
    };
    return { kind: "end", detail: detail.ended, source };
  }
  private captureValue(input: PublicRecordingInput): JournalValue {
    const child = this.child(input.link),
      events: SavedEvent[] = [];
    for (const item of input.events) {
      const { event, source } = item;
      if (child.final) throw new ContractError("conflict");
      if (event.kind === "ready") {
        if (child.ready) throw new ContractError("conflict");
        child.ready = true;
      } else if (!child.ready) throw new ContractError("invalid");
      if (event.kind === "message-start") {
        if (child.messages.has(event.messageId))
          throw new ContractError("conflict");
        child.messages.set(event.messageId, 1);
      }
      if (
        event.kind === "call-declaration" ||
        event.kind === "tool-start" ||
        event.kind === "tool-end"
      )
        child.tools.set(event.callId, (child.tools.get(event.callId) ?? 0) + 1);
      if (event.kind === "detail-begin") {
        if (child.details.has(event.detailId))
          throw new ContractError("conflict");
        const o = event.descriptor.owner;
        const entity: RecordOwner["entity"] =
          o.kind === "message" || o.kind === "message-final"
            ? {
                kind: "message",
                id: o.messageId,
                version: child.messages.get(o.messageId) ?? 0,
              }
            : o.kind === "tool"
              ? {
                  kind: "tool",
                  id: o.callId,
                  version: child.tools.get(o.callId) ?? 1,
                }
              : { kind: "child", id: input.link.childRunId, version: 1 };
        if (!entity.version) throw new ContractError("invalid");
        child.details.set(
          event.detailId,
          this.openDetail(
            event.detailId,
            { kind: "worker", id: input.link.childRunId },
            {
              taskId: input.link.taskId,
              runId: input.link.runId,
              childRunId: input.link.childRunId,
              entity,
            },
            event.descriptor,
            event.descriptor.field,
          ),
        );
      }
      if (event.kind === "stored-chunk" || event.kind === "stored-end") {
        const d = child.details.get(event.detailId);
        if (!d) throw new ContractError("invalid");
        if (event.kind === "stored-chunk") {
          if (event.text)
            events.push(this.chunk(d, event.text, source, input.link.runId));
        } else events.push(this.end(d, event.coverage, source));
        continue;
      }
      if (event.kind === "message-end")
        child.messages.set(
          event.messageId,
          (child.messages.get(event.messageId) ?? 0) + 1,
        );
      if (event.kind === "final") {
        const d = child.details.get(event.detailId)?.ended;
        if (
          d?.content.field !== "final-text" ||
          d.descriptor?.owner.kind !== "message-final" ||
          d.descriptor.owner.messageId !== event.messageId
        )
          throw new ContractError("invalid");
        child.final = { messageId: event.messageId, detailId: event.detailId };
      }
      events.push({ kind: "capture", id: randomUUID(), value: item });
    }
    return { kind: "capture", link: input.link, source: input.source, events };
  }
  private assertContent(
    content: ContentRef,
    taskId: string,
    runId: string | null,
    entity: RecordOwner["entity"] | Omit<RecordOwner["entity"], "version">,
    operationId?: string,
  ): void {
    const reader = HistoryReader.open(this.lease.coordination);
    if (!reader) throw new ContractError("corrupt-selected");
    const detail = reader.selected({
      storeId: reader.storeId,
      scope: { kind: "task", id: taskId },
      snapshotSeq: this.state.committedSeq,
      recordId: content.recordId,
      recordVersion: content.version,
      field: content.field,
      offset: 0,
      query: null,
    });
    if (
      canonicalJson(detail.content) !== canonicalJson(content) ||
      detail.owner.taskId !== taskId ||
      detail.owner.runId !== runId ||
      detail.owner.entity.id !== entity.id ||
      detail.owner.entity.kind !== entity.kind ||
      (operationId !== undefined &&
        (detail.origin.kind !== "owner" || detail.origin.id !== operationId)) ||
      ("version" in entity && detail.owner.entity.version !== entity.version)
    )
      throw new ContractError("corrupt-selected");
    for (const _ of reader.parts(detail, this.state.committedSeq)) {
      /* selected integrity, not display previews */
    }
  }
  private assertHandoff(
    input: OwnerRecordingInput,
    fact: Extract<
      import("../service-contract.ts").OwnerFact,
      { kind: "handoff" }
    >,
  ): void {
    const runId = input.link.runId;
    if (!runId) throw new ContractError("conflict");
    const state = this.runs.get(runId) ?? this.retainedRun(runId);
    if (
      !state.admission ||
      state.admission.operationId !== input.link.operationId ||
      state.children.has(fact.childRunId)
    )
      throw new ContractError("conflict");
    const admitted = this.files.readAdmission(runId, state.admission),
      allocation = state.admission.assignments.find(
        (a) => a.childRunId === fact.childRunId,
      ),
      graph = admitted.graph;
    const assignment = graph?.assignments.find(
      (a) => a.id === allocation?.assignmentId,
    );
    if (
      !graph ||
      !assignment ||
      fact.handoff.graphRevision !== graph.revision ||
      fact.handoff.inputs.length !== assignment.dependencies.length
    )
      throw new ContractError("conflict");
    const reader = HistoryReader.open(this.lease.coordination);
    if (!reader) throw new ContractError("corrupt-selected");
    for (const [i, dependency] of assignment.dependencies.entries()) {
      const supplied = fact.handoff.inputs[i];
      const sourceRun =
        dependency.source.kind === "current" ? runId : dependency.source.runId;
      const sourceChild =
        dependency.source.kind === "current"
          ? state.admission.assignments.find(
              (a) =>
                a.assignmentId ===
                (dependency.source.kind === "current"
                  ? dependency.source.assignmentId
                  : ""),
            )?.childRunId
          : dependency.source.childRunId;
      if (
        !sourceChild ||
        supplied.dependencyIndex !== i ||
        supplied.assignmentId !== assignment.id ||
        supplied.runId !== sourceRun ||
        supplied.childRunId !== sourceChild ||
        canonicalJson(supplied.range) !== canonicalJson(dependency.range)
      )
        throw new ContractError("conflict");
      const source = this.runs.get(sourceRun) ?? this.retainedRun(sourceRun),
        child = source.children.get(sourceChild),
        recording = child?.completion?.recording;
      if (
        !child?.settlementSeq ||
        child.completion?.native.outcome !== "completed" ||
        child.completion.native.closure !== "direct-child-closed" ||
        recording?.status !== "committed" ||
        canonicalJson(recording.detail.content) !==
          canonicalJson(supplied.result) ||
        (dependency.source.kind === "historical" &&
          canonicalJson(dependency.source.result) !==
            canonicalJson(supplied.result)) ||
        (dependency.requireCompleteObservation && !fact.observation.complete)
      )
        throw new ContractError("conflict");
      const detail = reader.selected({
        storeId: reader.storeId,
        scope: { kind: "child", id: sourceChild },
        snapshotSeq: this.state.committedSeq,
        query: null,
        recordId: supplied.result.recordId,
        recordVersion: supplied.result.version,
        field: supplied.result.field,
        offset: 0,
      });
      const range = supplied.range ?? { start: 0, end: detail.content.bytes };
      if (
        range.end - range.start > 16 * 1024 ||
        canonicalJson(supplied.coverage) !== canonicalJson(detail.coverage)
      )
        throw new ContractError("conflict");
      const chunks: Buffer[] = [];
      for (const p of reader.parts(detail, this.state.committedSeq)) {
        const start = Math.max(0, range.start - p.offset),
          end = Math.min(p.bytes.length, range.end - p.offset);
        if (end > start) chunks.push(p.bytes.subarray(start, end));
      }
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.concat(chunks),
      );
      if (
        text !== supplied.text ||
        Buffer.byteLength(text) !== range.end - range.start
      )
        throw new ContractError("conflict");
    }
  }
  private assertReview(
    input: OwnerRecordingInput,
    fact: Extract<
      import("../service-contract.ts").OwnerFact,
      { kind: "review" }
    >,
  ): void {
    let accepted: AdmissionIntent | null = null;
    let changes: Extract<
      import("../service-contract.ts").OwnerFact,
      { kind: "changes" }
    > | null = null;
    for (const batch of this.files.scan(
      emptyScan(),
      false,
      HistoryReadBudget.authority(),
    ))
      for (const row of batch.rows) {
        const v = row.value;
        if (
          v.kind === "admission" &&
          v.intent.operationId === input.link.operationId
        )
          accepted = v.intent;
        if (
          v.kind === "owner" &&
          v.link.operationId === input.link.operationId &&
          v.events.some(
            (e) =>
              e.kind === "owner" &&
              e.value.kind === "fact" &&
              e.value.fact.kind === "review",
          )
        )
          throw new ContractError("conflict");
        if (
          v.kind === "owner" &&
          v.link.taskId === input.link.taskId &&
          v.link.runId === fact.runId
        )
          for (const e of v.events)
            if (
              e.kind === "owner" &&
              e.value.kind === "fact" &&
              e.value.fact.kind === "changes" &&
              e.value.fact.stage === "review"
            )
              changes = e.value.fact;
      }
    const identity = accepted?.identity;
    if (
      identity?.kind !== "action" ||
      identity.action.kind !== "review" ||
      identity.expected.epoch !== input.link.epoch ||
      identity.action.taskId !== input.link.taskId ||
      identity.action.runId !== fact.runId ||
      identity.action.changesIdentity !== fact.changesIdentity ||
      identity.action.checksRevision !== fact.checksRevision ||
      identity.action.acceptIssues !== fact.acceptIssues ||
      changes?.observation.identity !== fact.changesIdentity
    )
      throw new ContractError("conflict");
    const review = this.options.reviewContext?.(input.link.taskId);
    if (!review) throw new ContractError("unavailable");
    const checks = decodeCheckObligations(review.checks);
    if (
      checks.taskId !== input.link.taskId ||
      checks.revision !== fact.checksRevision ||
      canonicalJson(review.observation) !== canonicalJson(changes.observation)
    )
      throw new ContractError("conflict");
    const run = this.retainedRun(fact.runId);
    if (!run.drained || run.admission?.context.task?.id !== input.link.taskId)
      throw new ContractError("conflict");
    const issues = reviewIssues(
      run,
      { ...review, checks },
      identity.expected.task?.kind === "code",
      input.link.epoch,
    );
    if (
      issues.length &&
      (fact.outcome !== "reviewed-with-issues" || !fact.acceptIssues)
    )
      throw new ContractError("conflict");
  }

  private async ownerValue(
    input: OwnerRecordingInput,
    graph: Graph | null = null,
    acceptedPlan?: ContentRef,
  ): Promise<JournalValue> {
    const value = decodeOwnerRecordingInput(input);
    if (value.link.epoch !== this.lease.registration.epoch)
      throw new ContractError("stale");
    let details = this.ownerDetails.get(value.link.operationId);
    if (!details) {
      if (this.ownerDetails.size >= LIMITS.admissionCount)
        throw new ContractError("capacity");
      details = new Map();
      this.ownerDetails.set(value.link.operationId, details);
    }
    const events: SavedEvent[] = [];
    for (const event of value.events) {
      if (event.kind === "fact" && event.fact.kind === "parent-admitted") {
        const identity = decodeRunIdentity(event.fact.identity);
        const admission = decodeRunAdmission({
          schema: "cadence-run-admission/2",
          runId: event.fact.runId,
          identity,
          graph,
        });
        const candidate = (
          this.runs.get(admission.runId) ?? this.retainedRun(admission.runId)
        ).copy();
        candidate.apply(
          {
            kind: "record",
            seq: "1",
            id: randomUUID(),
            value: {
              kind: "owner",
              link: value.link,
              observedMs: value.observedMs,
              events: [{ kind: "owner", id: randomUUID(), value: event }],
            },
          },
          this.state.committedSeq,
        );
        const children = new Set(identity.assignments.map((a) => a.childRunId));
        if (
          children.size &&
          this.prior(
            (v) =>
              v.kind === "owner" &&
              v.events.some(
                (e) =>
                  e.kind === "owner" &&
                  e.value.kind === "fact" &&
                  e.value.fact.kind === "parent-admitted" &&
                  e.value.fact.identity.assignments.some((a) =>
                    children.has(a.childRunId),
                  ),
              ),
          )
        )
          throw new ContractError("conflict");
        if (admission.graph)
          this.assertContent(admission.graph.plan, value.link.taskId, null, {
            kind: "task",
            id: value.link.taskId,
            version: admission.graph.planRevision,
          });
        this.charge(
          Buffer.byteLength(encoded(admission)),
          admission.runId,
          true,
        );
        this.files.writeAdmission(this.lease, admission);
        await this.options.observeWrite?.("run-admission");
      }
      if (event.kind === "fact") {
        const fact = event.fact;
        if (
          fact.kind === "publication-settled" &&
          fact.status === "published"
        ) {
          const actual = this.lease.coordination.store.loadSnapshot(
            value.link.taskId,
          );
          if (
            !actual ||
            actual.identity !== fact.observed?.identity ||
            actual.record.revision !== fact.observed.revision
          )
            throw new ContractError("conflict");
        }
        if (
          fact.kind === "gate" &&
          fact.reservationId &&
          fact.lane !== "check"
        ) {
          const run = value.link.runId
            ? (this.runs.get(value.link.runId) ??
              this.retainedRun(value.link.runId))
            : null;
          if (!run?.admission) throw new ContractError("conflict");
          const selected = this.files.readAdmission(run.runId, run.admission);
          const allocation = run.admission.assignments.find(
            (a) => a.childRunId === fact.reservationId,
          );
          const assignment = selected.graph?.assignments.find(
            (a) => a.id === allocation?.assignmentId,
          );
          if (
            !allocation ||
            (assignment?.purpose === "edit" ? "writer" : "reader") !== fact.lane
          )
            throw new ContractError("conflict");
        }
        if (fact.kind === "handoff") this.assertHandoff(value, fact);
        if (fact.kind === "review") this.assertReview(value, fact);
        if (fact.kind === "changes") {
          const accepted = readOperationStateForPublication(
            this.files,
            value.link.operationId,
          ).intent;
          if (accepted.identity.kind !== "action")
            throw new ContractError("conflict");
          const action = accepted.identity.action;
          const targetRun =
            action.kind === "review" ? action.runId : accepted.runId;
          if (
            (accepted.createdTaskId ?? accepted.identity.expected.task?.id) !==
              value.link.taskId ||
            targetRun !== value.link.runId ||
            (fact.stage !== "review" &&
              accepted.identity.expected.epoch !== value.link.epoch)
          )
            throw new ContractError("conflict");
        }

        if (
          fact.kind === "publication-intent" &&
          this.prior(
            (v) =>
              v.kind === "owner" &&
              v.events.some(
                (e) =>
                  e.kind === "owner" &&
                  e.value.kind === "fact" &&
                  e.value.fact.kind === "publication-intent" &&
                  e.value.fact.publicationId === fact.publicationId,
              ),
          )
        )
          throw new ContractError("conflict");
        if (fact.kind === "changes" || fact.kind === "review")
          this.assertContent(
            fact.content,
            value.link.taskId,
            value.link.runId,
            {
              kind: fact.kind,
              id: fact.kind === "changes" ? fact.observationId : fact.reviewId,
            },
            value.link.operationId,
          );
        if (fact.kind === "check-settled" && fact.output)
          this.assertContent(
            fact.output,
            value.link.taskId,
            value.link.runId,
            { kind: "check", id: fact.checkId },
            value.link.operationId,
          );
      }
      if (event.kind === "content-begin") {
        if (
          details.has(event.detailId) ||
          [...this.ownerDetails.values()].reduce((n, ds) => n + ds.size, 0) >=
            LIMITS.ownerQueueFrames ||
          this.prior(
            (v) =>
              v.kind === "owner" &&
              v.link.operationId === value.link.operationId &&
              v.events.some(
                (e) =>
                  e.kind === "owner" &&
                  e.value.kind === "content-begin" &&
                  e.value.detailId === event.detailId,
              ),
          )
        )
          throw new ContractError("conflict");
        const opened = this.openDetail(
          event.detailId,
          { kind: "owner", id: value.link.operationId },
          event.owner,
          null,
          event.field,
        );
        // Sole private call site is retainAcceptedPlan, after accepted-action,
        // expected-byte, sanitized-byte and global identity collision checks.
        if (acceptedPlan) {
          if (
            event.field !== "plan" ||
            event.owner.entity.kind !== "task" ||
            event.owner.entity.version !== acceptedPlan.version
          )
            throw new ContractError("conflict");
          opened.recordId = acceptedPlan.recordId;
          opened.version = acceptedPlan.version;
        }
        details.set(event.detailId, opened);
      }
      if (event.kind === "content-chunk" || event.kind === "content-end") {
        const d = details.get(event.detailId);
        if (
          !d ||
          d.owner.taskId !== value.link.taskId ||
          d.owner.runId !== value.link.runId
        )
          throw new ContractError("invalid");
        if (event.kind === "content-chunk") {
          if (event.text)
            events.push(
              this.chunk(
                d,
                event.text,
                null,
                this.reviews.has(value.link.operationId)
                  ? value.link.operationId
                  : (value.link.runId ?? value.link.operationId),
              ),
            );
        } else {
          const ended = this.end(d, event.coverage, null);
          if (
            acceptedPlan &&
            canonicalJson(d.ended?.content) !== canonicalJson(acceptedPlan)
          )
            throw new ContractError("conflict");
          events.push(ended);
        }
      } else events.push({ kind: "owner", id: randomUUID(), value: event });
    }
    return {
      kind: "owner",
      link: value.link,
      observedMs: value.observedMs,
      events,
    };
  }
}

function readOperationStateForPublication(
  files: HistoryFiles,
  operationId: string,
) {
  let intent: AdmissionIntent | undefined;
  let recovered = false;
  let publication: Extract<
    OwnerFact,
    { kind: "publication-intent" | "publication-settled" }
  > | null = null;
  const state = new OperationState(operationId);
  const facts: { link: OwnerLink; fact: OwnerFact }[] = [];
  for (const batch of files.scan(
    emptyScan(),
    false,
    HistoryReadBudget.authority(),
  ))
    for (const row of batch.rows) {
      const v = row.value;
      if (v.kind === "recovery" && intent) recovered = true;
      if (v.kind === "admission" && v.intent.operationId === operationId)
        intent = v.intent;
      if (intent?.runId === null) state.apply(row, batch.marker.last);
      if (v.kind === "owner") {
        for (const e of v.events) {
          if (
            v.link.operationId === operationId &&
            e.kind === "owner" &&
            e.value.kind === "fact" &&
            (e.value.fact.kind === "publication-intent" ||
              e.value.fact.kind === "publication-settled")
          )
            publication = e.value.fact;
          if (
            e.kind === "owner" &&
            e.value.kind === "fact" &&
            ["review", "changes", "check-settled"].includes(e.value.fact.kind)
          ) {
            if (facts.length >= LIMITS.dataFrames)
              throw new ContractError("capacity");
            facts.push({ link: v.link, fact: e.value.fact });
          }
        }
      }
    }
  if (!intent) throw new ContractError("conflict");
  return { intent, state, facts, recovered, publication };
}
