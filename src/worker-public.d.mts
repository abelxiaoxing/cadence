/** Public declaration owner for the maintained worker-public.mjs implementation. */
/** Portable service boundary. No SDK objects, credentials, filesystem paths as IDs, or execution owner. */
export declare const SERVICE_PROTOCOL = 1;
export declare const WORKER_PROTOCOL = 2;
export declare const GRAPH_SCHEMA = "cadence-graph/2";
export declare const HISTORY_SCHEMA = "cadence-history/2";
export declare const EXPORT_SCHEMA = "cadence-public-export/2";
export declare const LIMITS: Readonly<{
  controlBytes: number;
  admissionCount: 16;
  admissionBytes: number;
  cancelBytes: number;
  headerBytes: number;
  wsClientFrameBytes: number;
  startWaitMs: 10000;
  stopWaitMs: 60000;
  authWaitMs: 30000;
  authValidityMarginMs: 120000;
  browserLifetimeMs: number;
  terminateGraceMs: 1000;
  unconfirmedStopMs: 3000;
  graphBytes: number;
  grantMs: 120000;
  assignments: 16;
  instructionsBytes: number;
  expectedOutputBytes: 2048;
  workerRequestBytes: number;
  publicRequestBytes: number;
  predecessorBytes: number;
  handoffBytes: number;
  frameBytes: number;
  chunkBytes: number;
  detailBytes: number;
  childProtocolBytes: number;
  dataFrames: 100000;
  controlFrames: 256;
  sdkEvents: 1000000;
  workerQueueBytes: number;
  workerQueueFrames: 1024;
  ownerQueueBytes: number;
  ownerQueueFrames: 2048;
  ownerControlBytes: number;
  ownerControlFrames: 256;
  recordingStallMs: 5000;
  episodes: 8;
  queuedAssignments: 128;
  childReservations: 2;
  episodeMs: number;
  readyWaitMs: number;
  workerMs: 1200000;
  artifactPartBytes: number;
  progressBatchMs: 100;
  progressBatchBytes: number;
  segmentBytes: number;
  segmentRecords: 4096;
  checkoutQuotaBytes: number;
  episodeReservationBytes: number;
  freeSpaceFloorBytes: number;
  episodeControlBytes: number;
  searchReaders: 2;
  exportReaders: 2;
  downloadIdleMs: 120000;
  pageEntries: 50;
  maxPageEntries: 200;
  pageBytes: number;
  detailPageBytes: number;
  previewBytes: 4096;
  searchBytes: number;
  searchMs: 100;
  queryBytes: 1024;
  navigationBytes: 8192;
  ringEvents: 1024;
  ringBytes: number;
  viewers: 16;
  viewerMessages: 256;
  viewerBytes: number;
  heartbeatMs: 5000;
  staleMs: 15000;
  reconcileMs: 30000;
}>;
export declare const ERROR_CODES: readonly [
  "invalid",
  "oversize",
  "unauthenticated",
  "forbidden",
  "stale",
  "conflict",
  "corrupt-selected",
  "expired-grant",
  "consumed-grant",
  "unsupported-context",
  "quarantine",
  "capacity",
  "unavailable",
  "auth-unavailable",
  "recording-exhausted",
  "receipt-inconclusive",
];
export type ErrorCode = (typeof ERROR_CODES)[number];
export interface PublicError {
  code: ErrorCode;
  effect: "none" | "accepted" | "uncertain";
  recovery: "observe" | "fresh-confirmation" | "operator";
}
export declare class ContractError extends Error {
  readonly code: ErrorCode;
  constructor(code?: ErrorCode);
}
export declare function publicError(
  code: ErrorCode,
  effect?: PublicError["effect"],
): PublicError;
export declare function errorStatus(code: ErrorCode): number;
export declare function invalid(): never;
export declare function text(
  v: unknown,
  max: number,
  nonempty?: boolean,
): string;
export declare function utf8Bytes(v: string): number;
export declare function integer(v: unknown, min?: number, max?: number): number;
export declare function bool(v: unknown): boolean;
export declare function oneOf<const T extends readonly string[]>(
  v: unknown,
  values: T,
): T[number];
export declare function literal<T extends string | number>(
  v: unknown,
  expected: T,
): T;
export declare function nullable<T>(
  v: unknown,
  read: (v: unknown) => T,
): T | null;
export declare function closed(
  v: unknown,
  keys: readonly string[],
): Record<string, unknown>;
export declare function list<T>(
  v: unknown,
  max: number,
  read: (v: unknown) => T,
): T[];
export declare function decodeId(v: unknown): string;
export declare function decodeHash(v: unknown): string;
export declare function decodeSequence(v: unknown): string;
export declare function compareSequence(a: string, b: string): number;
export declare function assignmentId(v: unknown): string;
/** Deterministic identity of decoded credential-free DTOs; never use this on authentication data. */
export declare function canonicalJson(value: unknown, maximum?: number): string;
/** JSON.parse alone loses duplicate keys. All HTTP/worker text adapters must use this before a DTO decoder. */
export declare function parseWireJson(
  source: string,
  maximum?: number,
): unknown;
export declare function decodePublicError(v: unknown): PublicError;
export type TaskKind = "code" | "research" | "diagnosis";
export type Purpose = "research" | "diagnosis" | "review" | "edit";
export type ExecutionOutcome =
  | "completed"
  | "failed"
  | "canceled"
  | "timeout"
  | "unknown"
  | "blocked";
export type Closure = "not-launched" | "direct-child-closed" | "unconfirmed";
export type Publication = "pending" | "published" | "conflict" | "uncertain";
export type Field =
  | "plan"
  | "context"
  | "message"
  | "final-text"
  | "tool-args"
  | "tool-update"
  | "tool-result"
  | "check"
  | "changes"
  | "review";
export declare const fields: readonly [
  "plan",
  "context",
  "message",
  "final-text",
  "tool-args",
  "tool-update",
  "tool-result",
  "check",
  "changes",
  "review",
];
export declare const outcomes: readonly [
  "completed",
  "failed",
  "canceled",
  "timeout",
  "unknown",
  "blocked",
];
export declare const closures: readonly [
  "not-launched",
  "direct-child-closed",
  "unconfirmed",
];
export interface ModelSelection {
  sourceSelectionId: string;
  provider: string;
  model: string;
  api:
    | "openai-completions"
    | "openai-responses"
    | "openai-codex-responses"
    | "anthropic-messages"
    | "google-generative-ai"
    | "mistral-conversations"
    | "azure-openai-responses";
  thinking: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
}
export type ModelSelector = Omit<ModelSelection, "sourceSelectionId">;
export declare const modelApis: readonly ModelSelection["api"][];
export declare const thinkingLevels: readonly ModelSelection["thinking"][];
export declare function decodeModelSelector(v: unknown): ModelSelector;
export declare function decodeModelSelection(v: unknown): ModelSelection;
export interface RoleSelection {
  role: "design-explorer" | "implementation-worker" | "diagnosis-worker";
  sha256: string;
}
export declare function role(v: unknown): RoleSelection;
export declare function roleForPurpose(purpose: Purpose): RoleSelection["role"];
export interface ContentRef {
  recordId: string;
  version: number;
  field: Field;
  bytes: number;
  sha256: string;
}
export declare function decodeContentRef(v: unknown): ContentRef;
export interface ByteRange {
  start: number;
  end: number;
}
export declare function range(v: unknown): ByteRange;
export type DependencySource =
  | {
      kind: "current";
      assignmentId: string;
    }
  | {
      kind: "historical";
      runId: string;
      childRunId: string;
      result: ContentRef;
    };
export interface Dependency {
  source: DependencySource;
  range: ByteRange | null;
  requireCompleteObservation: boolean;
}
export declare function dependency(v: unknown): Dependency;
export declare function tag(v: unknown, key?: string): string;
export interface Assignment {
  id: string;
  purpose: Purpose;
  instructions: string;
  expectedOutput: string;
  role: RoleSelection;
  model: ModelSelection;
  dependencies: Dependency[];
}
export interface Graph {
  schema: typeof GRAPH_SCHEMA;
  taskId: string;
  taskKind: TaskKind;
  taskRevision: number;
  revision: number;
  planRevision: number;
  plan: ContentRef;
  assignments: Assignment[];
}
export declare function decodeGraph(v: unknown): Graph;
export interface TaskVersion {
  id: string;
  kind: TaskKind;
  revision: number;
  identity: string;
  graphRevision: number | null;
  graphIdentity: string | null;
}
export declare function taskVersion(v: unknown): TaskVersion;
export interface ContextVersion {
  epoch: string;
  accessGeneration: number;
  configRev: number;
  controlRev: number;
  workspaceId: string;
  cwdId: string;
  model: ModelSelection;
  checkEnvGeneration: number;
  checkoutGeneration: number;
  observation: {
    identity: string;
    complete: boolean;
  };
  task: TaskVersion | null;
}
export declare function decodeContext(v: unknown): ContextVersion;
export interface CheckSelection {
  kind: "configured" | "manual";
  name: string;
  command: string;
  timeoutMs: number;
}
export declare function checkSelection(v: unknown): CheckSelection;
export type Action =
  | {
      kind: "create";
      taskKind: TaskKind;
      goal: string;
    }
  | {
      kind: "save-plan";
      taskId: string;
      plan: string;
      graph: Graph;
    }
  | {
      kind: "generate-plan";
      taskId: string;
    }
  | {
      kind: "start";
      taskId: string;
    }
  | {
      kind: "check";
      taskId: string;
      check: CheckSelection;
    }
  | {
      kind: "review";
      taskId: string;
      runId: string;
      changesIdentity: string;
      checksRevision: number;
      acceptIssues: boolean;
    };
export declare function decodeAction(v: unknown): Action;
export interface PreflightRequest {
  expected: ContextVersion;
  action: Action;
}
export declare function decodePreflightRequest(v: unknown): PreflightRequest;
export interface Command extends PreflightRequest {
  commandId: string;
  grant: string;
}
export declare function decodeCommand(v: unknown): Command;
/** Durable idempotency identity deliberately excludes the disposable grant and
 * attachment. Old-epoch receipts are observations, not renewed execution consent. */
export type CommandIdentity =
  | {
      kind: "action";
      expected: ContextVersion;
      action: Action;
    }
  | {
      kind: "cancel";
      epoch: string;
      runId: string;
    };
export declare function decodeCommandIdentity(v: unknown): CommandIdentity;
export interface CancelCommand {
  commandId: string;
  epoch: string;
  runId: string;
}
export declare function decodeCancel(v: unknown): CancelCommand;
export type Issue =
  | "incomplete-observation"
  | "unrun-checks"
  | "stale-checks"
  | "failed-checks"
  | "partial-results"
  | "recording-incomplete"
  | "legacy-context";
export interface ActionPreview {
  version: ContextVersion;
  action: Action;
  rootLabel: string;
  cwdLabel: string;
  readablePlan: string;
  graph: Graph | null;
  activeRunId: string | null;
  issues: Issue[];
  checkEnvironmentPolicy?: "service-launch-ordinary/1";
  configuredChecks: CheckSelection[];
  checksRevision: number;
  reviewRunId: string | null;
}
export declare function decodePreview(v: unknown): ActionPreview;
export interface Preflight {
  grant: string;
  expiresAt: string;
  preview: ActionPreview;
}
export declare function decodePreflight(v: unknown): Preflight;
export interface CaptureCoverage {
  observed: "complete" | "incomplete";
  source: "complete" | "limited" | "unavailable";
  redacted: boolean;
  omissions: (
    | "binary"
    | "hidden-thinking"
    | "source-limit"
    | "capture-limit"
    | "gap"
    | "unsupported"
  )[];
}
export declare function decodeCoverage(v: unknown): CaptureCoverage;
export interface HandoffInput {
  assignmentId: string;
  dependencyIndex: number;
  runId: string;
  childRunId: string;
  result: ContentRef;
  range: ByteRange | null;
  text: string;
  coverage: CaptureCoverage;
}
export interface DependencyHandoff {
  graphRevision: number;
  inputs: HandoffInput[];
}
export declare function decodeHandoff(v: unknown): DependencyHandoff;
export interface WorkerPublicRequest {
  protocol: 2;
  taskId: string;
  taskKind: TaskKind;
  runId: string;
  childRunId: string;
  assignmentId: string;
  purpose: Purpose;
  model: ModelSelection;
  role: RoleSelection;
  context: string;
  instructions: string;
  prompt: string;
  handoff: DependencyHandoff;
}
export declare function decodeWorkerPublicRequest(
  v: unknown,
): WorkerPublicRequest;
/** Enforce on the actual serialized anonymous-stdin envelope AFTER owner-only auth insertion. Never log/return it. */
export declare function assertWorkerEnvelopeSize(serialized: string): void;
export interface NativeSettlement {
  outcome: Exclude<ExecutionOutcome, "blocked">;
  closure: Closure;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  stdin: "delivered" | "failed" | "not-required";
  final: "valid" | "missing" | "invalid";
  cleanup: "settled" | "failed" | "unconfirmed";
  capture: CaptureCoverage;
}
export declare function decodeNativeSettlement(v: unknown): NativeSettlement;
export interface Scope {
  kind: "task" | "run" | "child";
  id: string;
}
export declare function decodeScope(v: unknown): Scope;
/** Navigation only, never auth. No epoch: historical cursors survive owner restart. */
export interface ReadCursor {
  navigation?: string;
  storeId: string;
  scope: Scope;
  query: string | null;
  snapshotSeq: string;
  recordId: string | null;
  recordVersion: number | null;
  field: Field | null;
  offset: number;
}
export declare function decodeNavigation(v: unknown): string;
export declare function decodeCursor(v: unknown): ReadCursor;
/** IDs are local occurrences, never joins on nullable/reused source IDs. */
export interface SourceIdentity {
  disposition: "observed" | "unavailable" | "redacted";
  value: string | null;
}
export interface CallDeclarationLink {
  messageId: string;
  blockId: string;
}
/** message-final is the ordered concatenation (no inserted separators) of the
 * actual finalized message's text blocks. It is a labelled derived text field,
 * not a synthetic source block or the streaming preview. Nontext blocks remain
 * separately described/omitted with coverage. Partial argument UTF-8 is observed
 * partial JSON text; final/execution args use canonical ordinary JSON data.
 */
export type ContentOwner =
  | {
      kind: "message-final";
      messageId: string;
    }
  | {
      kind: "context";
      component:
        | "request-context"
        | "request-prompt"
        | "request-instructions"
        | "role"
        | "effective-system";
    }
  | {
      kind: "handoff";
      dependencyIndex: number;
      source: ContentRef;
    }
  | {
      kind: "message";
      messageId: string;
      blockId: string;
      index: number;
      stage: "stream" | "final";
    }
  | {
      kind: "tool";
      callId: string;
      blockId: string;
      index: number;
      stage:
        | "arguments-partial"
        | "arguments-final"
        | "execution-arguments"
        | "update-snapshot"
        | "result";
    };
export type DetailDescriptor = {
  owner: ContentOwner;
  field:
    | "context"
    | "message"
    | "final-text"
    | "tool-args"
    | "tool-update"
    | "tool-result";
  encoding: "utf8" | "canonical-json";
};
export interface OmittedBlock {
  owner: ContentOwner;
  sourceType: "image" | "audio" | "binary" | "hidden-thinking" | "unsupported";
  mimeType: string | null;
  reason: "binary" | "hidden-thinking" | "unsupported";
}
export declare function decodeSourceIdentity(v: unknown): SourceIdentity;
export declare function callLink(v: unknown): CallDeclarationLink;
export declare function decodeContentOwner(v: unknown): ContentOwner;
export declare function decodeDetailDescriptor(v: unknown): DetailDescriptor;
export declare function decodeOmittedBlock(v: unknown): OmittedBlock;
/** tool-start observes public SDK tool_execution_start, which can precede
 * validation or actual execution. startObserved never proves a native launch.
 * W2's stateful producer correlates actual block/call occurrences; a nullable or
 * reused source value never supplies an inferred nearest-message association.
 */
export type CaptureEvent =
  | {
      kind: "ready";
      requestProtocol: 2;
    }
  | {
      kind: "message-start";
      messageId: string;
      role: "user" | "assistant" | "tool-result";
      source: SourceIdentity;
      resultCallId: string | null;
    }
  | {
      kind: "message-text";
      messageId: string;
      blockId: string;
      detailId: string;
    }
  | {
      kind: "message-end";
      messageId: string;
      finalDetailId: string | null;
      finalBlockCount: number;
      stopReason:
        | "stop"
        | "length"
        | "toolUse"
        | "error"
        | "aborted"
        | "unknown";
    }
  | {
      kind: "call-declaration";
      callId: string;
      declaration: CallDeclarationLink;
      index: number;
      source: SourceIdentity;
      name: string;
      argsDetailId: string | null;
      stage: "partial" | "final";
    }
  | {
      kind: "tool-start";
      callId: string;
      declaration: CallDeclarationLink | null;
      source: SourceIdentity;
      name: string;
      argsDetailId: string | null;
    }
  | {
      kind: "tool-update";
      callId: string;
      detailId: string;
      semantics: "snapshot";
    }
  | {
      kind: "tool-end";
      callId: string;
      declaration: CallDeclarationLink | null;
      source: SourceIdentity;
      name: string;
      resultDetailId: string;
      isError: boolean;
      association: "declared" | "execution-only" | "orphan" | "ambiguous";
      startObserved: boolean;
    }
  | {
      kind: "omitted-block";
      block: OmittedBlock;
    }
  | {
      kind: "detail-begin";
      detailId: string;
      descriptor: DetailDescriptor;
    }
  | {
      kind: "detail-chunk";
      detailId: string;
      offset: number;
      text: string;
    }
  | {
      kind: "detail-end";
      detailId: string;
      bytes: number;
      sha256: string;
      coverage: CaptureCoverage;
    }
  | {
      kind: "capture-status";
      coverage: CaptureCoverage;
    }
  | {
      kind: "worker-failure";
      code:
        | "protocol"
        | "capture"
        | "model"
        | "auth"
        | "network"
        | "cleanup"
        | "prompt";
    }
  | {
      kind: "final";
      messageId: string;
      detailId: string;
      stopReason: "stop";
    };
export interface CaptureFrame {
  protocol: 2;
  childRunId: string;
  workerSeq: number;
  observedMs: number;
  event: CaptureEvent;
}
export declare function decodeCaptureEvent(v: unknown): CaptureEvent;
export declare function decodeCaptureFrame(v: unknown): CaptureFrame;
export interface CapturePosition {
  childRunId: string;
  workerSeq: number;
  observedMs: number;
  final: boolean;
}
/** Header ordering only; W2 must additionally verify detail associations, hashes,
 * control/data totals and native settlement. A final frame is never native success. */
export declare function advanceCapture(
  position: CapturePosition,
  input: unknown,
): {
  position: CapturePosition;
  frame: CaptureFrame;
};
/** Native shell checks have no SDK assistant-final, and absent stdin is real EOF. */
export interface CheckNativeSettlement {
  outcome: Exclude<ExecutionOutcome, "blocked">;
  closure: Closure;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  stdin: "not-required";
}
export declare function decodeCheckNativeSettlement(
  v: unknown,
): CheckNativeSettlement;
export interface FinalSelection {
  messageId: string;
  detailId: string;
}
export declare function decodeFinalSelection(v: unknown): FinalSelection;
export interface DetailCommit {
  childRunId: string;
  detailId: string;
  content: ContentRef;
  committedSeq: string;
}
export declare function decodeDetailCommit(v: unknown): DetailCommit;
export type FinalRecording =
  | {
      status: "committed";
      selected: FinalSelection;
      detail: DetailCommit;
    }
  | {
      status: "pending" | "uncertain";
      selected: FinalSelection | null;
    }
  | {
      status: "refused";
      selected: FinalSelection | null;
      error: PublicError;
    };
export declare function decodeFinalRecording(v: unknown): FinalRecording;
export interface RequiredChildSettlement {
  assignmentId: string;
  childRunId: string;
  native: NativeSettlement | null;
  recording: FinalRecording;
  settlementSeq: string | null;
}
export type RunSettlement =
  | {
      kind: "sdk";
      native: NativeSettlement;
      recording: FinalRecording;
      settlementSeq: string | null;
    }
  | {
      kind: "parent";
      outcome: ExecutionOutcome;
      required: RequiredChildSettlement[];
    }
  | {
      kind: "check";
      native: CheckNativeSettlement;
      capture: CaptureCoverage;
      settlementSeq: string | null;
    };
export declare function childSatisfied(
  child: Pick<
    RequiredChildSettlement,
    "native" | "recording" | "settlementSeq"
  >,
): boolean;
export declare function settlementOutcome(s: RunSettlement): ExecutionOutcome;
export declare function decodeRunSettlement(v: unknown): RunSettlement;
export interface WorkerCompletion {
  childRunId: string;
  native: NativeSettlement;
  selected: FinalSelection | null;
  recording: FinalRecording;
}
export declare function decodeWorkerCompletion(v: unknown): WorkerCompletion;
/** Original wire hashes/offsets never enter transformed chunks. W3 assigns stored
 * offsets/hashes. Rechunking is NOT another worker sequence or observed event. */
export interface SourceRange {
  first: number;
  last: number;
  firstObservedMs: number;
  lastObservedMs: number;
}
export declare function decodeSourceRange(v: unknown): SourceRange;
export type SanitizedCaptureEvent =
  | Exclude<
      CaptureEvent,
      {
        kind: "detail-chunk" | "detail-end";
      }
    >
  | {
      kind: "stored-chunk";
      detailId: string;
      text: string;
    }
  | {
      kind: "stored-end";
      detailId: string;
      coverage: CaptureCoverage;
    };
export interface RecordingEvent {
  source: SourceRange;
  event: SanitizedCaptureEvent;
}
export declare function decodeRecordingEvent(v: unknown): RecordingEvent;
export interface RecordingLink {
  epoch: string;
  taskId: string;
  runId: string;
  childRunId: string;
}
export declare function decodeRecordingLink(v: unknown): RecordingLink;
export interface PublicRecordingInput {
  link: RecordingLink;
  source: SourceRange;
  events: RecordingEvent[];
}
export declare function decodeRecordingInput(v: unknown): PublicRecordingInput;
export interface CaptureBudget {
  sourceFrames: number;
  retainedBytes: number;
  outputBytes: number;
  outputChunks: number;
  lane: "data" | "control";
}
export declare function decodeCaptureBudget(v: unknown): CaptureBudget;
export interface OwnerDetailCommit {
  operationId: string;
  detailId: string;
  content: ContentRef;
  committedSeq: string;
}
export interface CommittedBatch {
  committedSeq: string;
  details: DetailCommit[];
  ownerDetails: OwnerDetailCommit[];
  coverage: CaptureCoverage;
}
export declare function decodeCommittedBatch(v: unknown): CommittedBatch;
