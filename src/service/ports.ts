import type {
  Action,
  ActionPreview,
  CancelCommand,
  CaptureBudget,
  CheckObligations,
  CommandIdentity,
  CommittedBatch,
  ContextVersion,
  DetailReadResult,
  EntityReadRequest,
  EntityReadResult,
  ExportFrame,
  ExportRequest,
  GraphReadRequest,
  GraphReadResult,
  HistoryReadResult,
  ListRequest,
  OwnerRecordingInput,
  PublicError,
  PublicRecordingInput,
  ReadCursor,
  Receipt,
  RecordingLink,
  Scope,
  SearchPage,
  SessionBootstrap,
  Snapshot,
  StoredCommand,
  WorkerCompletion,
  WorkerPublicRequest,
  WorkspaceBootstrap,
} from "../service-contract.ts";

/** Only authenticated ingress constructs this; never decode authority from a request body. */
export interface Caller {
  attachmentId: string;
  authority: "browser" | "local";
  accessGeneration: number;
}
export type { CommandIdentity, StoredCommand } from "../service-contract.ts";
export type StoredLookup =
  | { status: "found"; record: StoredCommand }
  | { status: "absent"; committedSeq: string }
  | { status: "inconclusive" };
export interface AdmissionIntent {
  commandId: string;
  operationId: string;
  runId: string | null;
  identity: CommandIdentity;
  createdTaskId: string | null;
}
export type AdmissionCommit =
  | { status: "committed" | "existing"; record: StoredCommand }
  | { status: "refused"; error: PublicError }
  | { status: "uncertain" };
/**
 * W3: exclusive intent reservation + flush + journal commit before returning committed.
 * A stale/partial/index-inconclusive lookup is NOT absent. No restart dispatch.
 * The action commit CASes the exact expected context and advances that task's (or
 * create workspace's) controlRev by one, visible to observe before resolution.
 * W3 tracks original outstanding promises even after the caller stops waiting;
 * admission's recording-stall deadline is not rollback/settlement of a late write.
 * All supported control writers share this serialization; arbitrary file races
 * are still optimistic, not OS-atomic CAS. Cancel does not consume controlRev.
 */
export interface AdmissionPersistence {
  lookup(commandId: string): Promise<StoredLookup>;
  /** Ordinary admission only; Cancel must not join original storage before stop. */
  lookupForAdmission?(commandId: string): Promise<StoredLookup>;
  /** Selected intent only, for conflict refusal during safety-lane saturation.
   * Null is unknown, NEVER evidence of absent/accepted/durable receipt. */
  reservedIdentity?(commandId: string): CommandIdentity | null;
  commit(intent: AdmissionIntent): Promise<AdmissionCommit>;
}
export interface RunTarget {
  runId: string;
  epoch: string;
  state: "active" | "settled" | "unknown";
  cancelRequested: boolean;
}
export interface AdmissionOwner {
  /** Local readonly observations only: no auth, SDK construction or provider calls. */
  observe(action: Action): Promise<ActionPreview>;
  /** Exact current-v1 publication lineage for a frozen saved graph after own summaries.
   * Missing/false is never permission to use an older graph task revision. */
  currentGraph?(
    graph: import("../service-contract.ts").Graph,
    version: ContextVersion,
  ): boolean;
  currentAccess(): { epoch: string; accessGeneration: number };
  run(runId: string): RunTarget | undefined;
  /** Synchronous enqueue of ONLY this newly committed command, never receipt replay.
   * W4 rechecks context after every preparation await and before actual launch.
   * Generate-plan MUST force readonly preparation, never dispatch the stored graph.
   * This call must synchronously expose activeRunId for admitted episodes/checks.
   */
  activate(intent: AdmissionIntent, receipt: Receipt): void;
  /** Close episode admission and coalesce bounded cancellation of original handles.
   * Synchronously sets RunTarget.cancelRequested before returning, coalescing
   * repeated IDs against the original run. This request is not native closure
   * and must remain usable under recording failure or quota exhaustion.
   */
  requestCancel(command: CancelCommand): void;
  /** Close admission, preserve fences; no cleanup/retry/rollback implied. */
  quarantine(reason: "persistence" | "activation" | "context"): void;
}
export interface AdmissionClock {
  now(): number;
  uuid(): string;
}

export type {
  CommittedBatch,
  ContextVersion,
  PublicRecordingInput,
  RecordingLink,
} from "../service-contract.ts";
export type PersistenceResult =
  | { status: "committed"; batch: CommittedBatch }
  | { status: "refused"; error: PublicError; durability: "none" | "uncertain" };
/** One-shot lease. No implicit refunds for timed-out ORIGINAL writes. The writer
 * fences on uncertainty and retains unsettled accounting. reserve/grow are sync,
 * before copy/await; each lease costs max(1, sourceFrames+outputChunks) slots
 * against the SAME ownerQueueFrames ceiling, including prefix-only leases.
 * sourceFrames counts original validated frames ONCE; retainedBytes includes raw
 * ingress + decoder copies + sanitizer prefixes; outputBytes counts encoded
 * output/expansion; outputChunks counts transformed events, not workerSeq.
 * Prefixes may occupy a separate retained-byte lease (sourceFrames=0); acquire it
 * before releasing the source lease. Grow before expansion/rechunking, never
 * buffer a whole detail outside these accounts. Zero events are allowed.
 * Commit consumes the lease once; release is only for an uncommitted lease.
 */
export interface CaptureReservation {
  grow(
    additional: CaptureBudget,
  ): { status: "reserved" } | { status: "refused"; error: PublicError };
  commit(input: PublicRecordingInput): Promise<PersistenceResult>;
  release(): void;
}
export interface OwnerReservation {
  grow(
    additional: CaptureBudget,
  ): { status: "reserved" } | { status: "refused"; error: PublicError };
  commit(input: OwnerRecordingInput): Promise<PersistenceResult>;
  release(): void;
}
/** W2/owner sanitizes before commit, W3 hashes stored bytes and maps detail IDs.
 * Cumulative per-child limits: ownerQueueBytes/ownerQueueFrames (all leases,
 * in-flight writes, prefixes and expansion). Reserve ownerControlBytes and
 * ownerControlFrames INSIDE those ceilings for control, unavailable to data. Source
 * childProtocolBytes/dataFrames remain separate from stored totals. Pending
 * commit beyond recordingStallMs stops/fences, not a release or retry.
 * Both ports feed the ONE W3 journal; there is no worker-only second writer.
 */
export interface CaptureSink {
  reserve(
    budget: CaptureBudget,
  ):
    | { status: "reserved"; reservation: CaptureReservation }
    | { status: "refused"; error: PublicError };
}
export interface OwnerJournalPort {
  reserve(
    budget: CaptureBudget,
  ):
    | { status: "reserved"; reservation: OwnerReservation }
    | { status: "refused"; error: PublicError };
}
export interface AuthPreparationIntent {
  operationId: string;
  epoch: string;
  runId: string;
  childRunId: string;
  sourceSelectionId: string;
  validityMs: number;
}
export interface AuthPreparationSettlement {
  operationId: string;
  outcome: "resolved" | "refused" | "failed";
  admissionClosed: boolean;
}
export interface AuthAccountingPort {
  /** Resolve this exact reporting promise to its original job, never a global drain. */
  original?(report: Promise<PersistenceResult>): Promise<PersistenceResult>;
  /** True only when the writer registered originals with the lifetime owner before effects. */
  readonly lifetimeTracked?: boolean;
  /** Must commit before getAuth. Never accepts keys, hashes of keys, headers or auth env. */
  preparation(intent: AuthPreparationIntent): Promise<PersistenceResult>;
  /** Called after ORIGINAL tracked promise settles, even after caller cancel/timeout.
   * An unmatched durable intent remains credential-uncertain after crash.
   */
  settlement(result: AuthPreparationSettlement): Promise<PersistenceResult>;
}
export interface ProcessAccountingPort {
  launchIntent(
    link: RecordingLink,
    operationId: string,
  ): Promise<PersistenceResult>;
  settlement(
    link: RecordingLink,
    completion: WorkerCompletion,
  ): Promise<PersistenceResult>;
}
/** Owner-only closure holding prepared auth in RAM. No credentials in the portable
 * request/graph/client or history port. Actual serialized envelope must independently
 * pass assertWorkerEnvelopeSize after auth, immediately before the single spawn.
 */
export interface PreparedWorkerPort {
  readonly request: WorkerPublicRequest;
  launch(signal: AbortSignal, sink: CaptureSink): Promise<WorkerCompletion>;
}
/** W3 rejects unknown/future snapshots, validates committed membership and all
 * linkage/hash facts against retained storage. A valid cursor never supplies
 * authentication or permission to silently rebase. First-page null snapshot
 * selects current committed watermark; every continuation pins it forever.
 */
export interface ProjectionPort {
  checkObligations(taskId: string): Promise<CheckObligations>;
  entity(request: EntityReadRequest): Promise<EntityReadResult>;
  session(): Promise<SessionBootstrap>;
  workspace(): Promise<WorkspaceBootstrap>;
  tasks(request: ListRequest): Promise<HistoryReadResult>;
  runs(request: ListRequest): Promise<HistoryReadResult>;
  messages(request: ListRequest): Promise<HistoryReadResult>;
  tools(request: ListRequest): Promise<HistoryReadResult>;
  contents(request: ListRequest): Promise<HistoryReadResult>;
  events(request: ListRequest): Promise<HistoryReadResult>;
  checks(request: ListRequest): Promise<HistoryReadResult>;
  changes(request: ListRequest): Promise<HistoryReadResult>;
  reviews(request: ListRequest): Promise<HistoryReadResult>;
  graph(request: GraphReadRequest): Promise<GraphReadResult>;
  detail(cursor: ReadCursor): Promise<DetailReadResult>;
  search(cursor: ReadCursor): Promise<SearchPage>;
  /** Auth adapter captures access generation and RECHECKS before every output
   * chunk, including trailer. Revocation/disconnect aborts read only, produces
   * no completion trailer and never cancels work. Two readers, 120s idle bound.
   * Digests cover encodeExportFrame bytes before trailer in the chosen format.
   */
  export(
    request: ExportRequest,
    signal: AbortSignal,
  ): AsyncIterable<ExportFrame>;
  snapshot(scope: Scope): Promise<Snapshot>;
  /** Re-authenticate each read; a cursor is only committed navigation identity. */
  validateCursor(
    cursor: ReadCursor,
  ): Promise<
    | { status: "valid" | "progress-needed" }
    | { status: "refused"; error: PublicError }
  >;
}

/** Finite explicit RAM choice, separate from task-action grants and durable receipts. */
export interface ModelChoicePort {
  catalog(): import("../service-contract.ts").ModelCatalog;
  choose(
    request: import("../service-contract.ts").ChooseModelRequest,
  ): import("../service-contract.ts").ModelChoiceState;
}

/** Actual current owner, independent of retained historical paging. Missing binding refuses. */
export interface CurrentMetadataPort {
  current(
    request: import("../service-contract.ts").CurrentRequest,
    signal?: AbortSignal,
  ):
    | import("../service-contract.ts").CurrentView
    | Promise<import("../service-contract.ts").CurrentView>;
  currentChanges(
    request: import("../service-contract.ts").CurrentRequest,
    signal?: AbortSignal,
  ):
    | import("../service-contract.ts").CurrentChanges
    | Promise<import("../service-contract.ts").CurrentChanges>;
  activeRuns(
    signal?: AbortSignal,
  ):
    | import("../service-contract.ts").ActiveRuns
    | Promise<import("../service-contract.ts").ActiveRuns>;
}
