import { decodeNavigation } from "../../worker-public.mjs";
import { type ActiveRuns, decodeActiveRuns } from "./active.ts";
import { decodeServiceBuild, type ServiceBuild } from "./build.ts";
import {
  type CallDeclarationLink,
  type CaptureEvent,
  type CheckNativeSettlement,
  type ContentOwner,
  callLink,
  type DetailDescriptor,
  decodeCaptureEvent,
  decodeCheckNativeSettlement,
  decodeDetailDescriptor,
  decodeOmittedBlock,
  decodeRecordingEvent,
  decodeRecordingLink,
  decodeRunSettlement,
  decodeSourceIdentity,
  type OmittedBlock,
  type RecordingEvent,
  type RecordingLink,
  type RunSettlement,
  type SourceIdentity,
  settlementOutcome,
} from "./capture.ts";
import {
  assignmentId,
  bool,
  canonicalJson,
  closed,
  compareSequence,
  decodeHash,
  decodeId,
  decodePublicError,
  decodeSequence,
  EXPORT_SCHEMA,
  integer,
  invalid,
  LIMITS,
  list,
  literal,
  nullable,
  oneOf,
  type PublicError,
  SERVICE_PROTOCOL,
  text,
  utf8Bytes,
  WORKER_PROTOCOL,
} from "./core.ts";
import {
  type ByteRange,
  type CaptureCoverage,
  type CheckSelection,
  type CommandIdentity,
  type ContentRef,
  type ContextVersion,
  checkSelection,
  type DependencyHandoff,
  decodeCommandIdentity,
  decodeContentRef,
  decodeContext,
  decodeCoverage,
  decodeCursor,
  decodeGraph,
  decodeHandoff,
  decodeModelSelection,
  decodeScope,
  type ExecutionOutcome,
  type Graph,
  type ModelSelection,
  outcomes,
  type Publication,
  type ReadCursor,
  range,
  type Scope,
  tag,
} from "./domain.ts";
export interface Receipt {
  commandId: string;
  operationId: string;
  runId: string | null;
  admission: "accepted" | "refused" | "uncertain";
  committedSeq: string;
  execution: ExecutionOutcome | null;
  settlement: RunSettlement | null;
  created: {
    kind: "task";
    taskId: string;
    state: "reserved" | "published";
  } | null;
  publication: Publication;
}
export function decodeReceipt(v: unknown): Receipt {
  canonicalJson(v);
  const o = closed(v, [
    "commandId",
    "operationId",
    "runId",
    "admission",
    "committedSeq",
    "execution",
    "settlement",
    "created",
    "publication",
  ]);
  const r: Receipt = {
    commandId: decodeId(o.commandId),
    operationId: decodeId(o.operationId),
    runId: nullable(o.runId, decodeId),
    admission: oneOf(o.admission, ["accepted", "refused", "uncertain"]),
    committedSeq: decodeSequence(o.committedSeq),
    execution: nullable(o.execution, (v) => oneOf(v, outcomes)),
    settlement: nullable(o.settlement, decodeRunSettlement),
    created: nullable(o.created, (v) => {
      const c = closed(v, ["kind", "taskId", "state"]);
      return {
        kind: literal(c.kind, "task"),
        taskId: decodeId(c.taskId),
        state: oneOf(c.state, ["reserved", "published"]),
      };
    }),
    publication: oneOf(o.publication, [
      "pending",
      "published",
      "conflict",
      "uncertain",
    ]),
  };
  if (
    r.committedSeq === "0" ||
    r.settlement?.kind === "sdk" ||
    (r.execution === "completed" && !r.settlement) ||
    (r.execution !== null &&
      r.settlement !== null &&
      settlementOutcome(r.settlement) !== r.execution) ||
    (r.created?.state === "published" && r.publication !== "published")
  )
    invalid();
  return r;
}
export interface StoredCommand {
  identity: CommandIdentity;
  receipt: Receipt;
}
export function decodeStoredCommand(v: unknown): StoredCommand {
  canonicalJson(v);
  const o = closed(v, ["identity", "receipt"]);
  const identity = decodeCommandIdentity(o.identity),
    receipt = decodeReceipt(o.receipt);
  if (identity.kind === "cancel" && receipt.runId !== identity.runId) invalid();
  const create =
    identity.kind === "action" && identity.action.kind === "create";
  if (
    (!create && receipt.created !== null) ||
    (create && receipt.admission === "accepted" && receipt.created === null)
  )
    invalid();
  if (identity.kind === "action") {
    const episode = ["start", "generate-plan", "check"].includes(
      identity.action.kind,
    );
    if (
      (receipt.admission === "accepted" &&
        episode !== (receipt.runId !== null)) ||
      (!episode &&
        (receipt.execution !== null || receipt.settlement !== null)) ||
      (receipt.settlement !== null &&
        receipt.settlement.kind !==
          (identity.action.kind === "check" ? "check" : "parent"))
    )
      invalid();
  }
  return { identity, receipt };
}
export type Reply<T> =
  | { kind: "ok"; value: T }
  | { kind: "error"; error: PublicError };
export function decodeReply<T>(v: unknown, read: (v: unknown) => T): Reply<T> {
  if (tag(v) === "ok") {
    const o = closed(v, ["kind", "value"]);
    return { kind: "ok", value: read(o.value) };
  }
  const o = closed(v, ["kind", "error"]);
  literal(o.kind, "error");
  return { kind: "error", error: decodePublicError(o.error) };
}
export type ReceiptLookup =
  | { status: "found"; receipt: Receipt }
  | { status: "absent"; committedSeq: string }
  | { status: "inconclusive"; error: PublicError };
export function decodeReceiptLookup(v: unknown): ReceiptLookup {
  canonicalJson(v);
  switch (tag(v, "status")) {
    case "found": {
      const o = closed(v, ["status", "receipt"]);
      return { status: "found", receipt: decodeReceipt(o.receipt) };
    }
    case "absent": {
      const o = closed(v, ["status", "committedSeq"]);
      return { status: "absent", committedSeq: decodeSequence(o.committedSeq) };
    }
    case "inconclusive": {
      const o = closed(v, ["status", "error"]);
      return { status: "inconclusive", error: decodePublicError(o.error) };
    }
    default:
      return invalid();
  }
}

export interface RunProjection {
  runId: string;
  taskId: string;
  childRunId: string | null;
  assignmentId: string | null;
  admission: RunIdentity;
  lifecycle: "queued" | "preparing" | "running" | "closing" | "settled";
  outcome: ExecutionOutcome | null;
  settlement: RunSettlement | null;
  reason:
    | "capacity"
    | "dependency"
    | "writer"
    | "parent-stopped"
    | "wait-expired"
    | "handoff-overflow"
    | "stale-dependency"
    | "quarantine"
    | null;
  publication: Publication;
  coverage: CaptureCoverage;
  result: ContentRef | null;
}
export function decodeRunProjection(v: unknown): RunProjection {
  const o = closed(v, [
    "runId",
    "taskId",
    "childRunId",
    "assignmentId",
    "admission",
    "lifecycle",
    "outcome",
    "settlement",
    "reason",
    "publication",
    "coverage",
    "result",
  ]);
  const r: RunProjection = {
    runId: decodeId(o.runId),
    taskId: decodeId(o.taskId),
    childRunId: nullable(o.childRunId, decodeId),
    assignmentId: nullable(o.assignmentId, assignmentId),
    admission: decodeRunIdentity(o.admission),
    lifecycle: oneOf(o.lifecycle, [
      "queued",
      "preparing",
      "running",
      "closing",
      "settled",
    ]),
    outcome: nullable(o.outcome, (v) => oneOf(v, outcomes)),
    settlement: nullable(o.settlement, decodeRunSettlement),
    reason: nullable(o.reason, (v) =>
      oneOf(v, [
        "capacity",
        "dependency",
        "writer",
        "parent-stopped",
        "wait-expired",
        "handoff-overflow",
        "stale-dependency",
        "quarantine",
      ]),
    ),
    publication: oneOf(o.publication, [
      "pending",
      "published",
      "conflict",
      "uncertain",
    ]),
    coverage: decodeCoverage(o.coverage),
    result: nullable(o.result, decodeContentRef),
  };
  if (
    r.admission.context.task?.id !== r.taskId ||
    (r.childRunId !== null &&
      !r.admission.assignments.some(
        (a) =>
          a.childRunId === r.childRunId && a.assignmentId === r.assignmentId,
      )) ||
    (r.settlement?.kind === "parent" &&
      canonicalJson(
        r.settlement.required.map(({ assignmentId, childRunId }) => ({
          assignmentId,
          childRunId,
        })),
      ) !== canonicalJson(r.admission.assignments)) ||
    (r.settlement?.kind === "sdk" &&
      r.settlement.recording.status === "committed" &&
      (r.settlement.recording.detail.childRunId !== r.childRunId ||
        (r.result !== null &&
          canonicalJson(r.result) !==
            canonicalJson(r.settlement.recording.detail.content)))) ||
    (r.settlement !== null &&
      ((r.childRunId !== null && r.settlement.kind !== "sdk") ||
        (r.childRunId === null &&
          r.settlement.kind !==
            (r.admission.kind === "check" ? "check" : "parent")) ||
        (r.outcome !== null &&
          settlementOutcome(r.settlement) !== r.outcome))) ||
    (r.childRunId === null) !== (r.assignmentId === null) ||
    (r.lifecycle === "settled") !== (r.outcome !== null) ||
    (r.outcome === "completed" &&
      (!r.settlement ||
        settlementOutcome(r.settlement) !== "completed" ||
        r.coverage.observed !== "complete"))
  )
    invalid();
  return r;
}
function runInScope(run: RunProjection, scope: Scope): boolean {
  return scope.kind === "task"
    ? run.taskId === scope.id
    : scope.kind === "run"
      ? run.runId === scope.id
      : run.childRunId === scope.id;
}
function runInView(
  run: RunProjection,
  scope: Scope,
  context: ControlContext,
): boolean {
  return (
    runInScope(run, scope) &&
    run.taskId === controlTask(context) &&
    run.admission.context.workspaceId === controlWorkspace(context)
  );
}
/** Exact bounded live horizon: all active parents/children (<=8 episodes x17),
 * then newest fully settled episode groups that fit BOTH 200 rows and 512KiB.
 * Never evict an active row to show an older one. The historicalRuns first-page
 * request exposes all retained runs at this watermark, independent of horizon.
 * Metadata-only updates use runs=[]; all affected sibling rows share ONE update.
 * If a whole update cannot fit, producer requires resync, never split same-seq rows.
 */
export interface Snapshot {
  protocol: 1;
  storeId: string;
  epoch: string;
  scope: Scope;
  committedSeq: string;
  context: ControlContext;
  runs: RunProjection[];
  horizon: { policy: "active-and-recent"; historicalRuns: ListRequest };
}
export function decodeSnapshot(v: unknown): Snapshot {
  canonicalJson(v, LIMITS.pageBytes);
  const o = closed(v, [
    "protocol",
    "storeId",
    "epoch",
    "scope",
    "committedSeq",
    "context",
    "runs",
    "horizon",
  ]);
  const r: Snapshot = {
    protocol: literal(o.protocol, SERVICE_PROTOCOL),
    storeId: decodeId(o.storeId),
    epoch: decodeId(o.epoch),
    scope: decodeScope(o.scope),
    committedSeq: decodeSequence(o.committedSeq),
    context: decodeControlContext(o.context),
    runs: list(o.runs, LIMITS.maxPageEntries, decodeRunProjection),
    horizon: decodeHorizon(o.horizon),
  };
  if (
    !contextFits(r.context, r.epoch, r.scope) ||
    canonicalJson(r.horizon.historicalRuns.scope) !== canonicalJson(r.scope) ||
    r.horizon.historicalRuns.snapshotSeq !== r.committedSeq ||
    r.horizon.historicalRuns.storeId !== r.storeId ||
    r.runs.some((run) => !runInView(run, r.scope, r.context)) ||
    new Set(r.runs.map((run) => run.childRunId ?? run.runId)).size !==
      r.runs.length
  )
    invalid();
  return r;
}
export type LiveEvent =
  | {
      kind: "update";
      storeId: string;
      epoch: string;
      scope: Scope;
      previousSeq: string;
      committedSeq: string;
      runs: RunProjection[];
      removed: string[];
      context: ControlContext;
    }
  | {
      kind: "heartbeat";
      storeId: string;
      epoch: string;
      scope: Scope;
      committedSeq: string;
    };
export function decodeLiveEvent(v: unknown): LiveEvent {
  canonicalJson(v, LIMITS.pageBytes);
  const kind = tag(v);
  const o = closed(
    v,
    kind === "update"
      ? [
          "kind",
          "storeId",
          "epoch",
          "scope",
          "previousSeq",
          "committedSeq",
          "runs",
          "removed",
          "context",
        ]
      : ["kind", "storeId", "epoch", "scope", "committedSeq"],
  );
  const base = {
    storeId: decodeId(o.storeId),
    epoch: decodeId(o.epoch),
    scope: decodeScope(o.scope),
    committedSeq: decodeSequence(o.committedSeq),
  };
  if (kind === "update") {
    const previousSeq = decodeSequence(o.previousSeq);
    if (compareSequence(base.committedSeq, previousSeq) <= 0) invalid();
    const context = decodeControlContext(o.context);
    if (!contextFits(context, base.epoch, base.scope)) invalid();
    const runs = list(o.runs, LIMITS.maxPageEntries, decodeRunProjection);
    const removed = list(o.removed, LIMITS.maxPageEntries, decodeId);
    const keys = runs.map((r) => r.childRunId ?? r.runId);
    if (
      runs.some((r) => !runInView(r, base.scope, context)) ||
      new Set(keys).size !== keys.length ||
      new Set(removed).size !== removed.length ||
      removed.some((id) => keys.includes(id))
    )
      invalid();
    return { kind, ...base, previousSeq, runs, removed, context };
  }
  literal(kind, "heartbeat");
  return { kind: "heartbeat", ...base };
}
/** Strip only the opaque navigation field, preserving every exact read selector. */
export function readIdentity<T extends { navigation?: string }>(
  value: T,
): Omit<T, "navigation"> {
  const { navigation: _navigation, ...identity } = value;
  return identity;
}
export interface DetailProgress {
  kind: "progress";
  cursor: ReadCursor;
  next: ReadCursor;
  coverage: CaptureCoverage;
}
export interface RequestProgress<T> {
  kind: "progress";
  request: T;
  next: T;
  coverage: CaptureCoverage;
}
function progressPair<T extends { navigation?: string }>(
  request: T,
  next: T,
): void {
  // Structural correlation only. The private history owner must authenticate
  // semantic phase/address advancement; nonce inequality does NOT prove work.
  if (
    !next.navigation ||
    next.navigation === request.navigation ||
    canonicalJson(readIdentity(request)) !== canonicalJson(readIdentity(next))
  )
    invalid();
}
export type DetailReadResult = DetailPage | DetailProgress;
export function decodeDetailReadResult(v: unknown): DetailReadResult {
  if (Object.getOwnPropertyDescriptor(v ?? {}, "kind")?.value !== "progress")
    return decodeDetailPage(v);
  canonicalJson({ kind: "ok", value: v }, LIMITS.pageBytes);
  const o = closed(v, ["kind", "cursor", "next", "coverage"]),
    cursor = decodeCursor(o.cursor),
    next = decodeCursor(o.next);
  progressPair(cursor, next);
  return {
    kind: "progress",
    cursor,
    next,
    coverage: decodeCoverage(o.coverage),
  };
}
export interface DetailPage {
  cursor: ReadCursor;
  content: ContentRef;
  range: ByteRange | null;
  text: string;
  next: ReadCursor | null;
  coverage: CaptureCoverage;
}
export function decodeDetailPage(v: unknown): DetailPage {
  canonicalJson({ kind: "ok", value: v }, LIMITS.pageBytes);
  const o = closed(v, [
    "cursor",
    "content",
    "range",
    "text",
    "next",
    "coverage",
  ]);
  const r: DetailPage = {
    cursor: decodeCursor(o.cursor),
    content: decodeContentRef(o.content),
    range: nullable(o.range, range),
    text: text(o.text, LIMITS.detailPageBytes),
    next: nullable(o.next, decodeCursor),
    coverage: decodeCoverage(o.coverage),
  };
  if (
    r.cursor.recordId !== r.content.recordId ||
    r.cursor.recordVersion !== r.content.version ||
    r.cursor.field !== r.content.field ||
    (r.range
      ? r.range.start !== r.cursor.offset ||
        r.range.end > r.content.bytes ||
        r.range.end - r.range.start !== utf8Bytes(r.text)
      : r.content.bytes !== 0 || r.cursor.offset !== 0 || r.text !== "")
  )
    invalid();
  if (
    r.coverage.observed === "complete" &&
    (r.next !== null) !== (r.range?.end ?? 0) < r.content.bytes
  )
    invalid();
  if (
    r.next &&
    (r.next.offset !== r.range?.end ||
      canonicalJson(readIdentity({ ...r.next, offset: r.cursor.offset })) !==
        canonicalJson(readIdentity(r.cursor)))
  )
    invalid();
  return r;
}
export interface SearchHit {
  owner: RecordOwner;
  content: ContentRef;
  range: ByteRange;
  preview: string;
  cursor: ReadCursor;
}
export interface SearchPage {
  cursor: ReadCursor;
  hits: SearchHit[];
  next: ReadCursor | null;
  coverage: CaptureCoverage;
}
export function decodeSearchPage(v: unknown): SearchPage {
  canonicalJson({ kind: "ok", value: v }, LIMITS.pageBytes);
  const o = closed(v, ["cursor", "hits", "next", "coverage"]);
  const cursor = decodeCursor(o.cursor);
  if (!cursor.query) invalid();
  const queryBytes = utf8Bytes(cursor.query);
  const hits = list(o.hits, LIMITS.maxPageEntries, (v) => {
    const h = closed(v, ["content", "range", "preview", "cursor", "owner"]);
    const content = decodeContentRef(h.content);
    const owner = decodeRecordOwner(h.owner);
    if (!ownerInScope(owner, cursor.scope)) invalid();
    const selected = range(h.range);
    const at = decodeCursor(h.cursor);
    if (
      selected.end > content.bytes ||
      selected.end - selected.start !== queryBytes ||
      at.recordId !== content.recordId ||
      at.recordVersion !== content.version ||
      at.field !== content.field ||
      at.offset !== selected.start ||
      at.storeId !== cursor.storeId ||
      canonicalJson(at.scope) !== canonicalJson(cursor.scope) ||
      at.snapshotSeq !== cursor.snapshotSeq ||
      at.query !== cursor.query ||
      at.navigation !== undefined
    )
      invalid();
    return {
      content,
      owner,
      range: selected,
      preview: text(h.preview, LIMITS.previewBytes),
      cursor: at,
    };
  });
  const next = nullable(o.next, decodeCursor);
  if (
    next &&
    (next.storeId !== cursor.storeId ||
      canonicalJson(next.scope) !== canonicalJson(cursor.scope) ||
      next.query !== cursor.query ||
      next.snapshotSeq !== cursor.snapshotSeq ||
      (next.recordId === cursor.recordId &&
        next.recordVersion === cursor.recordVersion &&
        next.field === cursor.field &&
        (next.offset < cursor.offset ||
          (next.offset === cursor.offset &&
            (!next.navigation || next.navigation === cursor.navigation)))))
  )
    invalid();
  return { cursor, hits, next, coverage: decodeCoverage(o.coverage) };
}

/** Historical identity is immutable; it does not confer current control authority. */
export interface RunIdentity {
  operationId: string;
  commandId: string;
  kind: "start" | "generate-plan" | "check";
  context: ContextVersion;
  assignments: { assignmentId: string; childRunId: string }[];
  graph: { recordId: string; revision: number; sha256: string } | null;
}
export function decodeRunIdentity(v: unknown): RunIdentity {
  const o = closed(v, [
    "operationId",
    "commandId",
    "kind",
    "context",
    "assignments",
    "graph",
  ]);
  const context = decodeContext(o.context);
  const graph = nullable(o.graph, (v) => {
    const g = closed(v, ["recordId", "revision", "sha256"]);
    return {
      recordId: decodeId(g.recordId),
      revision: integer(g.revision, 1),
      sha256: decodeHash(g.sha256),
    };
  });
  const kind = oneOf(o.kind, ["start", "generate-plan", "check"]);
  const assignments = list(o.assignments, LIMITS.assignments, (v) => {
    const a = closed(v, ["assignmentId", "childRunId"]);
    return {
      assignmentId: assignmentId(a.assignmentId),
      childRunId: decodeId(a.childRunId),
    };
  });
  if (
    (kind === "check") !== (assignments.length === 0) ||
    new Set(assignments.map((a) => a.assignmentId)).size !==
      assignments.length ||
    new Set(assignments.map((a) => a.childRunId)).size !== assignments.length
  )
    invalid();
  if (
    !context.task ||
    (kind === "start" &&
      (!graph ||
        graph.revision !== context.task.graphRevision ||
        graph.sha256 !== context.task.graphIdentity)) ||
    (kind !== "start" && graph !== null)
  )
    invalid();
  return {
    operationId: decodeId(o.operationId),
    commandId: decodeId(o.commandId),
    kind,
    context,
    assignments,
    graph,
  };
}
export type ControlContext =
  | { status: "available"; version: ContextVersion }
  | {
      status: "unavailable";
      workspaceId: string;
      taskId: string | null;
      error: PublicError;
    };
export function decodeControlContext(v: unknown): ControlContext {
  if (tag(v, "status") === "available") {
    const o = closed(v, ["status", "version"]);
    return { status: "available", version: decodeContext(o.version) };
  }
  const o = closed(v, ["status", "workspaceId", "taskId", "error"]);
  literal(o.status, "unavailable");
  const error = decodePublicError(o.error);
  literal(error.effect, "none");
  return {
    status: "unavailable",
    workspaceId: decodeId(o.workspaceId),
    taskId: nullable(o.taskId, decodeId),
    error,
  };
}
export function controlWorkspace(c: ControlContext): string {
  return c.status === "available" ? c.version.workspaceId : c.workspaceId;
}
export function controlTask(c: ControlContext): string | null {
  return c.status === "available" ? (c.version.task?.id ?? null) : c.taskId;
}
function contextFits(c: ControlContext, epoch: string, scope: Scope): boolean {
  return (
    (c.status !== "available" || c.version.epoch === epoch) &&
    (scope.kind !== "task" || controlTask(c) === scope.id)
  );
}
export interface SessionBootstrap {
  build?: ServiceBuild;
  protocol: 1;
  storeId: string;
  epoch: string;
  accessGeneration: number;
  authority: "browser" | "local";
  csrf: string | null;
  capabilities: { actions: boolean; manualChecks: boolean; history: boolean };
}
export function decodeSessionBootstrap(v: unknown): SessionBootstrap {
  const o = closed(v, [
    "protocol",
    "storeId",
    "epoch",
    "accessGeneration",
    "authority",
    "csrf",
    "capabilities",
    ...(Object.getOwnPropertyDescriptor(v ?? {}, "build") ? ["build"] : []),
  ]);
  const c = closed(o.capabilities, ["actions", "manualChecks", "history"]);
  const authority = oneOf(o.authority, ["browser", "local"]),
    csrf = nullable(o.csrf, decodeId);
  const capabilities = {
    actions: bool(c.actions),
    manualChecks: bool(c.manualChecks),
    history: bool(c.history),
  };
  if (
    (authority === "browser" && (csrf === null || capabilities.manualChecks)) ||
    (authority === "local" && csrf !== null)
  )
    invalid();
  return {
    ...(o.build === undefined ? {} : { build: decodeServiceBuild(o.build) }),
    protocol: literal(o.protocol, SERVICE_PROTOCOL),
    storeId: decodeId(o.storeId),
    epoch: decodeId(o.epoch),
    accessGeneration: integer(o.accessGeneration, 1),
    authority,
    csrf,
    capabilities,
  };
}
export interface WorkspaceBootstrap {
  /** Absent on old/uncomposed readers: never evidence of an empty active roster. */
  activeRuns?: ActiveRuns;
  workspaceId: string;
  storeId: string;
  epoch: string;
  committedSeq: string;
  rootLabel: string;
  context: ControlContext;
  models: ModelSelection[];
}
export function decodeWorkspaceBootstrap(v: unknown): WorkspaceBootstrap {
  canonicalJson({ kind: "ok", value: v }, LIMITS.pageBytes);
  const o = closed(v, [
    "workspaceId",
    "storeId",
    "epoch",
    "committedSeq",
    "rootLabel",
    "context",
    "models",
    ...(Object.hasOwn(v ?? {}, "activeRuns") ? ["activeRuns"] : []),
  ]);
  const r: WorkspaceBootstrap = {
    ...(o.activeRuns === undefined
      ? {}
      : { activeRuns: decodeActiveRuns(o.activeRuns) }),
    workspaceId: decodeId(o.workspaceId),
    storeId: decodeId(o.storeId),
    epoch: decodeId(o.epoch),
    committedSeq: decodeSequence(o.committedSeq),
    rootLabel: text(o.rootLabel, 4096, true),
    context: decodeControlContext(o.context),
    models: list(o.models, LIMITS.maxPageEntries, decodeModelSelection),
  };
  if (
    r.activeRuns &&
    (r.activeRuns.storeId !== r.storeId ||
      r.activeRuns.workspaceId !== r.workspaceId ||
      r.activeRuns.epoch !== r.epoch)
  )
    invalid();
  if (
    controlWorkspace(r.context) !== r.workspaceId ||
    controlTask(r.context) !== null ||
    (r.context.status === "available" && r.context.version.epoch !== r.epoch)
  )
    invalid();
  return r;
}

export interface RecordOwner {
  taskId: string;
  runId: string | null;
  childRunId: string | null;
  entity: {
    kind:
      | "task"
      | "run"
      | "child"
      | "message"
      | "tool"
      | "check"
      | "changes"
      | "review";
    id: string;
    version: number;
  };
}
export function decodeRecordOwner(v: unknown): RecordOwner {
  const o = closed(v, ["taskId", "runId", "childRunId", "entity"]),
    e = closed(o.entity, ["kind", "id", "version"]);
  const r: RecordOwner = {
    taskId: decodeId(o.taskId),
    runId: nullable(o.runId, decodeId),
    childRunId: nullable(o.childRunId, decodeId),
    entity: {
      kind: oneOf(e.kind, [
        "task",
        "run",
        "child",
        "message",
        "tool",
        "check",
        "changes",
        "review",
      ]),
      id: decodeId(e.id),
      version: integer(e.version, 1),
    },
  };
  if (
    (r.childRunId !== null && r.runId === null) ||
    (r.entity.kind === "task" &&
      (r.entity.id !== r.taskId || r.runId !== null)) ||
    (r.entity.kind === "run" &&
      (r.entity.id !== r.runId || r.childRunId !== null)) ||
    (r.entity.kind === "child" && r.entity.id !== r.childRunId) ||
    (["message", "tool"].includes(r.entity.kind) && r.childRunId === null) ||
    (["check", "changes", "review"].includes(r.entity.kind) &&
      r.childRunId !== null)
  )
    invalid();
  return r;
}
export function ownerInScope(owner: RecordOwner, scope: Scope): boolean {
  return scope.kind === "task"
    ? owner.taskId === scope.id
    : scope.kind === "run"
      ? owner.runId === scope.id
      : owner.childRunId === scope.id;
}
export interface ObservationFact {
  identity: string;
  complete: boolean;
  checkoutGeneration: number;
}
function observationFact(v: unknown): ObservationFact {
  const o = closed(v, ["identity", "complete", "checkoutGeneration"]);
  return {
    identity: decodeHash(o.identity),
    complete: bool(o.complete),
    checkoutGeneration: integer(o.checkoutGeneration),
  };
}
export type AssignmentStateFact = {
  kind: "assignment-state";
  childRunId: string;
  state: "waiting" | "ready" | "preparing" | "closing" | "unstarted";
  reason: RunProjection["reason"];
};
export type AdmissionClosedFact = {
  kind: "admission-closed";
  reason:
    | "failed"
    | "canceled"
    | "timeout"
    | "wait-expired"
    | "handoff-overflow"
    | "stale-dependency"
    | "quarantine";
};
export type OwnerFact =
  | AssignmentStateFact
  | AdmissionClosedFact
  | { kind: "parent-admitted"; runId: string; identity: RunIdentity }
  | {
      kind: "parent-settled";
      runId: string;
      settlement: Extract<RunSettlement, { kind: "parent" }>;
    }
  | {
      kind: "gate";
      /** Absent only on historical run-wide gate observations. */
      reservationId?: string;
      lane: "reader" | "writer" | "check";
      state: "waiting" | "held" | "released" | "unknown";
      checkoutGeneration: number;
    }
  | {
      kind: "handoff";
      childRunId: string;
      handoff: DependencyHandoff;
      observation: ObservationFact;
    }
  | {
      kind: "changes";
      observationId: string;
      stage: "before" | "after" | "review";
      observation: ObservationFact;
      content: ContentRef;
    }
  | {
      kind: "check-start";
      checkId: string;
      selection: CheckSelection;
      cwdId: string;
      cwdLabel: string;
      checkEnvGeneration: number;
      before: ObservationFact;
    }
  | {
      kind: "check-settled";
      /** Exact one-step advance under this operation's held check reservation. */
      ownAdvance?: {
        operationId: string;
        reservationId: string;
        from: number;
        to: number;
      };
      checkId: string;
      native: CheckNativeSettlement;
      status: "passed" | "failed" | "canceled" | "stale";
      before: ObservationFact;
      after: ObservationFact;
      output: ContentRef | null;
      coverage: CaptureCoverage;
    }
  | {
      kind: "review";
      reviewId: string;
      runId: string;
      checksRevision: number;
      changesIdentity: string;
      acceptIssues: boolean;
      outcome: "reviewed" | "reviewed-with-issues";
      content: ContentRef;
    }
  | {
      kind: "publication-intent";
      publicationId: string;
      expectedRevision: number;
      expectedIdentity: string | null;
      nextRevision: number;
      nextIdentity: string;
    }
  | {
      kind: "publication-settled";
      publicationId: string;
      status: "published" | "conflict" | "uncertain";
      observed: { revision: number; identity: string } | null;
    };
export function decodeOwnerFact(v: unknown): OwnerFact {
  canonicalJson(v, LIMITS.controlBytes);
  const kind = tag(v);
  switch (kind) {
    case "assignment-state": {
      const o = closed(v, ["kind", "childRunId", "state", "reason"]);
      const state = oneOf(o.state, [
        "waiting",
        "ready",
        "preparing",
        "closing",
        "unstarted",
      ]);
      const reason = nullable(o.reason, (v) =>
        oneOf(v, [
          "capacity",
          "dependency",
          "writer",
          "parent-stopped",
          "wait-expired",
          "handoff-overflow",
          "stale-dependency",
          "quarantine",
        ]),
      );
      if ((state === "waiting" || state === "unstarted") && reason === null)
        invalid();
      if ((state === "ready" || state === "preparing") && reason !== null)
        invalid();
      return { kind, childRunId: decodeId(o.childRunId), state, reason };
    }
    case "admission-closed": {
      const o = closed(v, ["kind", "reason"]);
      return {
        kind,
        reason: oneOf(o.reason, [
          "failed",
          "canceled",
          "timeout",
          "wait-expired",
          "handoff-overflow",
          "stale-dependency",
          "quarantine",
        ]),
      };
    }
    case "parent-admitted": {
      const o = closed(v, ["kind", "runId", "identity"]);
      return {
        kind,
        runId: decodeId(o.runId),
        identity: decodeRunIdentity(o.identity),
      };
    }
    case "parent-settled": {
      const o = closed(v, ["kind", "runId", "settlement"]),
        settlement = decodeRunSettlement(o.settlement);
      if (settlement.kind !== "parent") invalid();
      return { kind, runId: decodeId(o.runId), settlement };
    }
    case "gate": {
      const hasReservation =
        typeof v === "object" &&
        v !== null &&
        Object.hasOwn(v, "reservationId");
      const o = closed(v, [
        "kind",
        "lane",
        "state",
        "checkoutGeneration",
        ...(hasReservation ? ["reservationId"] : []),
      ]);
      return {
        kind,
        ...(hasReservation ? { reservationId: decodeId(o.reservationId) } : {}),
        lane: oneOf(o.lane, ["reader", "writer", "check"]),
        state: oneOf(o.state, ["waiting", "held", "released", "unknown"]),
        checkoutGeneration: integer(o.checkoutGeneration),
      };
    }
    case "handoff": {
      const o = closed(v, ["kind", "childRunId", "handoff", "observation"]);
      return {
        kind,
        childRunId: decodeId(o.childRunId),
        handoff: decodeHandoff(o.handoff),
        observation: observationFact(o.observation),
      };
    }
    case "changes": {
      const o = closed(v, [
          "kind",
          "observationId",
          "stage",
          "observation",
          "content",
        ]),
        content = decodeContentRef(o.content);
      literal(content.field, "changes");
      return {
        kind,
        observationId: decodeId(o.observationId),
        stage: oneOf(o.stage, ["before", "after", "review"]),
        observation: observationFact(o.observation),
        content,
      };
    }
    case "check-start": {
      const o = closed(v, [
        "kind",
        "checkId",
        "selection",
        "cwdId",
        "cwdLabel",
        "checkEnvGeneration",
        "before",
      ]);
      return {
        kind,
        checkId: decodeId(o.checkId),
        selection: checkSelection(o.selection),
        cwdId: decodeId(o.cwdId),
        cwdLabel: text(o.cwdLabel, 4096, true),
        checkEnvGeneration: integer(o.checkEnvGeneration, 1),
        before: observationFact(o.before),
      };
    }
    case "check-settled": {
      const hasAdvance =
        typeof v === "object" && v !== null && Object.hasOwn(v, "ownAdvance");
      const o = closed(v, [
        "kind",
        "checkId",
        "native",
        "status",
        "before",
        "after",
        "output",
        "coverage",
        ...(hasAdvance ? ["ownAdvance"] : []),
      ]);
      let ownAdvance: Extract<
        OwnerFact,
        { kind: "check-settled" }
      >["ownAdvance"];
      if (hasAdvance) {
        const a = closed(o.ownAdvance, [
          "operationId",
          "reservationId",
          "from",
          "to",
        ]);
        ownAdvance = {
          operationId: decodeId(a.operationId),
          reservationId: decodeId(a.reservationId),
          from: integer(a.from),
          to: integer(a.to),
        };
        if (
          ownAdvance.to !== ownAdvance.from + 1 ||
          ownAdvance.reservationId !== o.checkId
        )
          invalid();
      }
      const native = decodeCheckNativeSettlement(o.native),
        status = oneOf(o.status, ["passed", "failed", "canceled", "stale"]),
        before = observationFact(o.before),
        after = observationFact(o.after),
        output = nullable(o.output, decodeContentRef),
        coverage = decodeCoverage(o.coverage);
      if (output && output.field !== "check") invalid();
      if (
        status === "passed" &&
        (native.outcome !== "completed" ||
          canonicalJson({
            ...before,
            checkoutGeneration: after.checkoutGeneration,
          }) !== canonicalJson(after) ||
          (ownAdvance
            ? before.checkoutGeneration !== ownAdvance.from ||
              after.checkoutGeneration !== ownAdvance.to ||
              output === null
            : before.checkoutGeneration !== after.checkoutGeneration) ||
          coverage.observed !== "complete")
      )
        invalid();
      if (
        status === "canceled" &&
        !["canceled", "timeout"].includes(native.outcome)
      )
        invalid();
      return {
        kind,
        ...(ownAdvance ? { ownAdvance } : {}),
        checkId: decodeId(o.checkId),
        native,
        status,
        before,
        after,
        output,
        coverage,
      };
    }
    case "review": {
      const o = closed(v, [
        "kind",
        "reviewId",
        "runId",
        "checksRevision",
        "changesIdentity",
        "acceptIssues",
        "outcome",
        "content",
      ]);
      const acceptIssues = bool(o.acceptIssues),
        outcome = oneOf(o.outcome, ["reviewed", "reviewed-with-issues"]),
        content = decodeContentRef(o.content);
      literal(content.field, "review");
      if (outcome === "reviewed-with-issues" && !acceptIssues) invalid();
      return {
        kind,
        reviewId: decodeId(o.reviewId),
        runId: decodeId(o.runId),
        checksRevision: integer(o.checksRevision),
        changesIdentity: decodeHash(o.changesIdentity),
        acceptIssues,
        outcome,
        content,
      };
    }
    case "publication-intent": {
      const o = closed(v, [
        "kind",
        "publicationId",
        "expectedRevision",
        "expectedIdentity",
        "nextRevision",
        "nextIdentity",
      ]);
      const expectedRevision = integer(o.expectedRevision),
        expectedIdentity = nullable(o.expectedIdentity, decodeHash),
        nextRevision = integer(o.nextRevision, 1);
      if (
        (expectedRevision === 0) !== (expectedIdentity === null) ||
        nextRevision !== expectedRevision + 1
      )
        invalid();
      return {
        kind,
        publicationId: decodeId(o.publicationId),
        expectedRevision,
        expectedIdentity,
        nextRevision,
        nextIdentity: decodeHash(o.nextIdentity),
      };
    }
    case "publication-settled": {
      const o = closed(v, ["kind", "publicationId", "status", "observed"]);
      const status = oneOf(o.status, ["published", "conflict", "uncertain"]),
        observed = nullable(o.observed, (v) => {
          const x = closed(v, ["revision", "identity"]);
          return {
            revision: integer(x.revision, 1),
            identity: decodeHash(x.identity),
          };
        });
      if (status === "published" && observed === null) invalid();
      return {
        kind,
        publicationId: decodeId(o.publicationId),
        status,
        observed,
      };
    }
    default:
      return invalid();
  }
}
export interface OwnerLink {
  epoch: string;
  operationId: string;
  taskId: string;
  runId: string | null;
}
export function decodeOwnerLink(v: unknown): OwnerLink {
  const o = closed(v, ["epoch", "operationId", "taskId", "runId"]);
  return {
    epoch: decodeId(o.epoch),
    operationId: decodeId(o.operationId),
    taskId: decodeId(o.taskId),
    runId: nullable(o.runId, decodeId),
  };
}
export type OwnerRecordingEvent =
  | { kind: "fact"; fact: OwnerFact }
  | {
      kind: "content-begin";
      detailId: string;
      owner: RecordOwner;
      field: "plan" | "check" | "changes" | "review";
      encoding: "utf8";
    }
  | { kind: "content-chunk"; detailId: string; text: string }
  | { kind: "content-end"; detailId: string; coverage: CaptureCoverage };
export interface OwnerRecordingInput {
  observedMs: number;
  link: OwnerLink;
  events: OwnerRecordingEvent[];
}
export function decodeOwnerRecordingInput(v: unknown): OwnerRecordingInput {
  canonicalJson(v, LIMITS.ownerQueueBytes);
  const o = closed(v, ["observedMs", "link", "events"]),
    link = decodeOwnerLink(o.link);
  const events = list<OwnerRecordingEvent>(
    o.events,
    LIMITS.ownerQueueFrames,
    (v) => {
      const kind = tag(v);
      if (kind === "fact") {
        const e = closed(v, ["kind", "fact"]),
          fact = decodeOwnerFact(e.fact);
        if (
          ("runId" in fact && fact.runId !== link.runId) ||
          (fact.kind === "parent-admitted" &&
            (fact.identity.context.task?.id !== link.taskId ||
              fact.identity.operationId !== link.operationId)) ||
          ([
            "gate",
            "assignment-state",
            "admission-closed",
            "handoff",
            "check-start",
            "check-settled",
          ].includes(fact.kind) &&
            link.runId === null)
        )
          invalid();
        return { kind, fact };
      }
      if (kind === "content-begin") {
        const e = closed(v, ["kind", "detailId", "owner", "field", "encoding"]),
          owner = decodeRecordOwner(e.owner);
        const field = oneOf(e.field, ["plan", "check", "changes", "review"]);
        if (
          owner.taskId !== link.taskId ||
          owner.runId !== link.runId ||
          owner.childRunId !== null ||
          owner.entity.kind !== (field === "plan" ? "task" : field)
        )
          invalid();
        return {
          kind,
          detailId: decodeId(e.detailId),
          owner,
          field,
          encoding: literal(e.encoding, "utf8"),
        };
      }
      if (kind === "content-chunk") {
        const e = closed(v, ["kind", "detailId", "text"]);
        return {
          kind,
          detailId: decodeId(e.detailId),
          text: text(e.text, LIMITS.chunkBytes),
        };
      }
      const e = closed(v, ["kind", "detailId", "coverage"]);
      literal(kind, "content-end");
      return {
        kind: "content-end",
        detailId: decodeId(e.detailId),
        coverage: decodeCoverage(e.coverage),
      };
    },
  );
  return { observedMs: integer(o.observedMs), link, events };
}

export const READERS = [
  "tasks",
  "runs",
  "messages",
  "tools",
  "contents",
  "events",
  "checks",
  "changes",
  "reviews",
] as const;
export type ReaderKind = (typeof READERS)[number];
export type ListScope = Scope | { kind: "workspace"; id: string };
export interface ListRequest {
  navigation?: string;
  reader: ReaderKind;
  storeId: string;
  scope: ListScope;
  snapshotSeq: string | null;
  after: { recordId: string; version: number; offset: number } | null;
  limit: number;
}
export function decodeListRequest(v: unknown): ListRequest {
  const o = closed(v, [
    "reader",
    "storeId",
    "scope",
    "snapshotSeq",
    "after",
    "limit",
    ...(Object.hasOwn(v ?? {}, "navigation") ? ["navigation"] : []),
  ]);
  const reader = oneOf(o.reader, READERS),
    s = closed(o.scope, ["kind", "id"]);
  const scope: ListScope = {
    kind: oneOf(s.kind, ["workspace", "task", "run", "child"]),
    id: decodeId(s.id),
  };
  const snapshotSeq = nullable(o.snapshotSeq, decodeSequence);
  const after = nullable(o.after, (v) => {
    const a = closed(v, ["recordId", "version", "offset"]);
    return {
      recordId: decodeId(a.recordId),
      version: integer(a.version, 1),
      offset: integer(a.offset),
    };
  });
  if (
    (after && snapshotSeq === null) ||
    (reader === "tasks") !== (scope.kind === "workspace")
  )
    invalid();
  return {
    reader,
    ...(Object.hasOwn(o, "navigation")
      ? { navigation: decodeNavigation(o.navigation) }
      : {}),
    storeId: decodeId(o.storeId),
    scope,
    snapshotSeq,
    after,
    limit: integer(o.limit, 1, LIMITS.maxPageEntries),
  };
}
function decodeHorizon(v: unknown): Snapshot["horizon"] {
  const o = closed(v, ["policy", "historicalRuns"]),
    historicalRuns = decodeListRequest(o.historicalRuns);
  if (
    historicalRuns.reader !== "runs" ||
    historicalRuns.after !== null ||
    historicalRuns.snapshotSeq === null
  )
    invalid();
  return { policy: literal(o.policy, "active-and-recent"), historicalRuns };
}
export type HistoryRecord =
  | {
      kind: "task";
      owner: RecordOwner;
      version: number;
      goal: string;
      plan: ContentRef | null;
    }
  | { kind: "run"; projection: RunProjection }
  | {
      kind: "message";
      owner: RecordOwner;
      version: number;
      role: "user" | "assistant" | "tool-result";
      source: SourceIdentity;
      resultCallId: string | null;
      state: "partial" | "final";
      finalBlockCount: number | null;
      finalText: ContentRef | null;
    }
  | {
      kind: "tool";
      owner: RecordOwner;
      version: number;
      source: SourceIdentity;
      name: string;
      declaration: CallDeclarationLink | null;
      declarationStage: "partial" | "final" | null;
      startObserved: boolean;
      result: Extract<CaptureEvent, { kind: "tool-end" }> | null;
    }
  | {
      kind: "content";
      owner: RecordOwner;
      version: number;
      detailId: string;
      descriptor: DetailDescriptor;
      content: ContentRef;
      coverage: CaptureCoverage;
    }
  | {
      kind: "omitted";
      owner: RecordOwner;
      version: number;
      block: OmittedBlock;
    }
  | {
      kind: "capture-fact";
      recordId: string;
      committedSeq: string;
      link: RecordingLink;
      capture: RecordingEvent;
    }
  | {
      kind: "owner-fact";
      observedMs: number;
      recordId: string;
      committedSeq: string;
      link: OwnerLink;
      fact: OwnerFact;
    };
export function decodeHistoryRecord(v: unknown): HistoryRecord {
  const kind = tag(v);
  if (kind === "run") {
    const o = closed(v, ["kind", "projection"]);
    return { kind, projection: decodeRunProjection(o.projection) };
  }
  if (kind === "capture-fact") {
    const o = closed(v, [
        "kind",
        "recordId",
        "committedSeq",
        "link",
        "capture",
      ]),
      committedSeq = decodeSequence(o.committedSeq);
    if (committedSeq === "0") invalid();
    return {
      kind,
      recordId: decodeId(o.recordId),
      committedSeq,
      link: decodeRecordingLink(o.link),
      capture: decodeRecordingEvent(o.capture),
    };
  }
  if (kind === "owner-fact") {
    const o = closed(v, [
      "kind",
      "recordId",
      "committedSeq",
      "observedMs",
      "link",
      "fact",
    ]);
    const input = decodeOwnerRecordingInput({
      observedMs: o.observedMs,
      link: o.link,
      events: [{ kind: "fact", fact: o.fact }],
    });
    const event = input.events[0];
    if (event.kind !== "fact") invalid();
    const committedSeq = decodeSequence(o.committedSeq);
    if (committedSeq === "0") invalid();
    return {
      kind,
      recordId: decodeId(o.recordId),
      committedSeq,
      link: input.link,
      observedMs: input.observedMs,
      fact: event.fact,
    };
  }
  const common = ["kind", "owner", "version"];
  const extras =
    kind === "task"
      ? ["goal", "plan"]
      : kind === "message"
        ? [
            "role",
            "source",
            "resultCallId",
            "state",
            "finalBlockCount",
            "finalText",
          ]
        : kind === "tool"
          ? [
              "source",
              "name",
              "declaration",
              "declarationStage",
              "startObserved",
              "result",
            ]
          : kind === "content"
            ? ["detailId", "descriptor", "content", "coverage"]
            : ["block"];
  const o = closed(v, [...common, ...extras]),
    owner = decodeRecordOwner(o.owner),
    version = integer(o.version, 1);
  if (
    ["task", "message", "tool"].includes(kind) &&
    (owner.entity.kind !== kind || owner.entity.version !== version)
  )
    invalid();
  if (kind === "task") {
    const plan = nullable(o.plan, decodeContentRef);
    if (plan && plan.field !== "plan") invalid();
    return { kind, owner, version, goal: text(o.goal, 8192, true), plan };
  }
  if (kind === "message") {
    const role = oneOf(o.role, ["user", "assistant", "tool-result"]),
      state = oneOf(o.state, ["partial", "final"]),
      finalBlockCount = nullable(o.finalBlockCount, (v) =>
        integer(v, 0, LIMITS.dataFrames),
      ),
      finalText = nullable(o.finalText, decodeContentRef),
      resultCallId = nullable(o.resultCallId, decodeId);
    if (
      (state === "final") !== (finalBlockCount !== null) ||
      (state === "partial" && finalText !== null) ||
      (finalText && finalText.field !== "final-text") ||
      (role !== "tool-result" && resultCallId !== null)
    )
      invalid();
    return {
      kind,
      owner,
      version,
      role,
      state,
      finalBlockCount,
      finalText,
      resultCallId,
      source: decodeSourceIdentity(o.source),
    };
  }
  if (kind === "tool") {
    const declaration = nullable(o.declaration, callLink),
      declarationStage = nullable(o.declarationStage, (v) =>
        oneOf(v, ["partial", "final"]),
      ),
      startObserved = bool(o.startObserved);
    const result = nullable(o.result, (v) => {
      const e = decodeCaptureEvent(v);
      if (e.kind !== "tool-end") invalid();
      return e;
    });
    if (
      (declaration === null) !== (declarationStage === null) ||
      (result &&
        (result.callId !== owner.entity.id ||
          result.startObserved !== startObserved ||
          canonicalJson(result.declaration) !== canonicalJson(declaration)))
    )
      invalid();
    return {
      kind,
      owner,
      version,
      declaration,
      declarationStage,
      startObserved,
      result,
      source: decodeSourceIdentity(o.source),
      name: text(o.name, 128, true),
    };
  }
  if (kind === "content") {
    const descriptor = decodeDetailDescriptor(o.descriptor),
      content = decodeContentRef(o.content);
    if (
      descriptor.field !== content.field ||
      !descriptorFitsOwner(descriptor.owner, owner)
    )
      invalid();
    return {
      kind,
      owner,
      version,
      detailId: decodeId(o.detailId),
      descriptor,
      content,
      coverage: decodeCoverage(o.coverage),
    };
  }
  literal(kind, "omitted");
  const block = decodeOmittedBlock(o.block);
  if (!descriptorFitsOwner(block.owner, owner)) invalid();
  return { kind: "omitted", owner, version, block };
}
function descriptorFitsOwner(
  content: ContentOwner,
  owner: RecordOwner,
): boolean {
  return content.kind === "message" || content.kind === "message-final"
    ? owner.entity.kind === "message" && content.messageId === owner.entity.id
    : content.kind === "tool"
      ? owner.entity.kind === "tool" && content.callId === owner.entity.id
      : owner.entity.kind === "child";
}
function recordFits(record: HistoryRecord, request: ListRequest): boolean {
  const { scope, reader } = request;
  const owner =
    record.kind === "run"
      ? {
          taskId: record.projection.taskId,
          runId: record.projection.runId,
          childRunId: record.projection.childRunId,
        }
      : record.kind === "owner-fact"
        ? { ...record.link, childRunId: null }
        : record.kind === "capture-fact"
          ? record.link
          : record.owner;
  if (
    scope.kind !== "workspace" &&
    !(scope.kind === "task"
      ? owner.taskId === scope.id
      : scope.kind === "run"
        ? owner.runId === scope.id
        : owner.childRunId === scope.id)
  )
    return false;
  if (reader === "tasks") return record.kind === "task";
  if (reader === "runs") return record.kind === "run";
  if (reader === "messages") return record.kind === "message";
  if (reader === "tools") return record.kind === "tool";
  if (reader === "contents")
    return record.kind === "content" || record.kind === "omitted";
  if (record.kind === "capture-fact") return reader === "events";
  if (record.kind !== "owner-fact") return false;
  return (
    reader === "events" ||
    (reader === "checks" &&
      ["check-start", "check-settled"].includes(record.fact.kind)) ||
    (reader === "changes" && record.fact.kind === "changes") ||
    (reader === "reviews" && record.fact.kind === "review")
  );
}
export interface HistoryPage {
  request: ListRequest;
  records: HistoryRecord[];
  next: ListRequest | null;
  coverage: CaptureCoverage;
}
export function decodeHistoryPage(v: unknown): HistoryPage {
  canonicalJson({ kind: "ok", value: v }, LIMITS.pageBytes);
  const o = closed(v, ["request", "records", "next", "coverage"]),
    request = decodeListRequest(o.request);
  if (request.snapshotSeq === null) invalid();
  const records = list(o.records, request.limit, decodeHistoryRecord),
    next = nullable(o.next, decodeListRequest);
  if (
    records.some((r) => !recordFits(r, request)) ||
    (next &&
      (next.after === null ||
        canonicalJson(readIdentity({ ...next, after: request.after })) !==
          canonicalJson(readIdentity(request)) ||
        canonicalJson(next.after) === canonicalJson(request.after)))
  )
    invalid();
  return { request, records, next, coverage: decodeCoverage(o.coverage) };
}
export interface HistorySnapshotTransition {
  kind: "snapshot";
  request: ListRequest;
  next: ListRequest;
  coverage: CaptureCoverage;
}
export type HistoryReadResult =
  | HistoryPage
  | RequestProgress<ListRequest>
  | HistorySnapshotTransition;
export function decodeHistoryReadResult(v: unknown): HistoryReadResult {
  if (Object.getOwnPropertyDescriptor(v ?? {}, "kind")?.value === "snapshot") {
    canonicalJson({ kind: "ok", value: v }, LIMITS.pageBytes);
    const o = closed(v, ["kind", "request", "next", "coverage"]),
      request = decodeListRequest(o.request),
      next = decodeListRequest(o.next);
    if (
      request.snapshotSeq !== null ||
      request.after !== null ||
      next.snapshotSeq === null ||
      !next.navigation ||
      canonicalJson(readIdentity({ ...next, snapshotSeq: null })) !==
        canonicalJson(readIdentity(request))
    )
      invalid();
    return {
      kind: "snapshot",
      request,
      next,
      coverage: decodeCoverage(o.coverage),
    };
  }
  if (Object.getOwnPropertyDescriptor(v ?? {}, "kind")?.value !== "progress")
    return decodeHistoryPage(v);
  canonicalJson({ kind: "ok", value: v }, LIMITS.pageBytes);
  const o = closed(v, ["kind", "request", "next", "coverage"]),
    request = decodeListRequest(o.request),
    next = decodeListRequest(o.next);
  progressPair(request, next);
  return {
    kind: "progress",
    request,
    next,
    coverage: decodeCoverage(o.coverage),
  };
}
/** First pages alone may select a newer committed snapshot. Continuations never rebase. */
export function historyReplyMatches(
  request: ListRequest,
  page: HistoryReadResult,
): boolean {
  return (
    canonicalJson({ ...page.request, snapshotSeq: request.snapshotSeq }) ===
      canonicalJson(request) &&
    (request.snapshotSeq === null ||
      request.snapshotSeq === page.request.snapshotSeq)
  );
}
export interface GraphReadRequest {
  navigation?: string;
  storeId: string;
  scope: Scope;
  snapshotSeq: string;
  graph: NonNullable<RunIdentity["graph"]>;
}
export interface GraphPage {
  request: GraphReadRequest;
  graph: Graph;
}
export function decodeGraphReadRequest(v: unknown): GraphReadRequest {
  const o = closed(v, [
      "storeId",
      "scope",
      "snapshotSeq",
      "graph",
      ...(Object.hasOwn(v ?? {}, "navigation") ? ["navigation"] : []),
    ]),
    g = closed(o.graph, ["recordId", "revision", "sha256"]);
  return {
    ...(Object.hasOwn(o, "navigation")
      ? { navigation: decodeNavigation(o.navigation) }
      : {}),
    storeId: decodeId(o.storeId),
    scope: decodeScope(o.scope),
    snapshotSeq: decodeSequence(o.snapshotSeq),
    graph: {
      recordId: decodeId(g.recordId),
      revision: integer(g.revision, 1),
      sha256: decodeHash(g.sha256),
    },
  };
}
export function decodeGraphPage(v: unknown): GraphPage {
  canonicalJson({ kind: "ok", value: v });
  const o = closed(v, ["request", "graph"]),
    request = decodeGraphReadRequest(o.request),
    graph = decodeGraph(o.graph);
  if (
    graph.revision !== request.graph.revision ||
    (request.scope.kind === "task" && request.scope.id !== graph.taskId)
  )
    invalid();
  // Stored-byte hash equality is W3's read-integrity check, not a new hashing algorithm here.
  return { request, graph };
}

export type GraphReadResult = GraphPage | RequestProgress<GraphReadRequest>;
export function decodeGraphReadResult(v: unknown): GraphReadResult {
  if (Object.getOwnPropertyDescriptor(v ?? {}, "kind")?.value !== "progress")
    return decodeGraphPage(v);
  canonicalJson({ kind: "ok", value: v }, LIMITS.pageBytes);
  const o = closed(v, ["kind", "request", "next", "coverage"]),
    request = decodeGraphReadRequest(o.request),
    next = decodeGraphReadRequest(o.next);
  progressPair(request, next);
  return {
    kind: "progress",
    request,
    next,
    coverage: decodeCoverage(o.coverage),
  };
}

export interface ExportRequest {
  storeId: string;
  scope: Scope;
  snapshotSeq: string;
  format: "ndjson" | "markdown";
}
export function decodeExportRequest(v: unknown): ExportRequest {
  const o = closed(v, ["storeId", "scope", "snapshotSeq", "format"]);
  return {
    storeId: decodeId(o.storeId),
    scope: decodeScope(o.scope),
    snapshotSeq: decodeSequence(o.snapshotSeq),
    format: oneOf(o.format, ["ndjson", "markdown"]),
  };
}
export type ExportEvent =
  | {
      kind: "manifest";
      schema: typeof EXPORT_SCHEMA;
      request: ExportRequest;
      coverage: CaptureCoverage;
      serviceProtocol: 1;
      workerProtocol: 2;
      provenance: {
        exporterBuildSha256: string;
        capturePolicy: "public-text-tools/2";
      };
    }
  | { kind: "record"; record: HistoryRecord }
  | { kind: "graph"; graph: GraphPage }
  | {
      kind: "detail";
      owner: RecordOwner;
      content: ContentRef;
      range: ByteRange | null;
      text: string;
      coverage: CaptureCoverage;
    }
  | { kind: "markdown"; text: string }
  | {
      kind: "trailer";
      complete: boolean;
      frames: number;
      encodedBytes: number;
      sha256: string;
      committedSeq: string;
      coverage: CaptureCoverage;
    };
export interface ExportFrame {
  exportId: string;
  ordinal: number;
  event: ExportEvent;
}
export function decodeExportFrame(v: unknown): ExportFrame {
  canonicalJson(v, LIMITS.controlBytes);
  const o = closed(v, ["exportId", "ordinal", "event"]),
    kind = tag(o.event);
  let event: ExportEvent;
  switch (kind) {
    case "manifest": {
      const e = closed(o.event, [
        "kind",
        "schema",
        "request",
        "coverage",
        "serviceProtocol",
        "workerProtocol",
        "provenance",
      ]);
      const provenance = closed(e.provenance, [
        "exporterBuildSha256",
        "capturePolicy",
      ]);
      event = {
        kind,
        provenance: {
          exporterBuildSha256: decodeHash(provenance.exporterBuildSha256),
          capturePolicy: literal(
            provenance.capturePolicy,
            "public-text-tools/2",
          ),
        },
        schema: literal(e.schema, EXPORT_SCHEMA),
        request: decodeExportRequest(e.request),
        coverage: decodeCoverage(e.coverage),
        serviceProtocol: literal(e.serviceProtocol, SERVICE_PROTOCOL),
        workerProtocol: literal(e.workerProtocol, WORKER_PROTOCOL),
      };
      break;
    }
    case "record": {
      const e = closed(o.event, ["kind", "record"]);
      event = { kind, record: decodeHistoryRecord(e.record) };
      break;
    }
    case "graph": {
      const e = closed(o.event, ["kind", "graph"]);
      event = { kind, graph: decodeGraphPage(e.graph) };
      break;
    }
    case "detail": {
      const e = closed(o.event, [
          "kind",
          "owner",
          "content",
          "range",
          "text",
          "coverage",
        ]),
        content = decodeContentRef(e.content),
        selected = nullable(e.range, range),
        value = text(e.text, LIMITS.detailPageBytes);
      if (
        selected
          ? selected.end > content.bytes ||
            selected.end - selected.start !== utf8Bytes(value)
          : content.bytes !== 0 || value !== ""
      )
        invalid();
      event = {
        kind,
        owner: decodeRecordOwner(e.owner),
        content,
        range: selected,
        text: value,
        coverage: decodeCoverage(e.coverage),
      };
      break;
    }
    case "markdown": {
      const e = closed(o.event, ["kind", "text"]);
      event = { kind, text: text(e.text, LIMITS.detailPageBytes) };
      break;
    }
    case "trailer": {
      const e = closed(o.event, [
          "kind",
          "complete",
          "frames",
          "encodedBytes",
          "sha256",
          "committedSeq",
          "coverage",
        ]),
        coverage = decodeCoverage(e.coverage),
        complete = bool(e.complete);
      if (complete && coverage.observed !== "complete") invalid();
      event = {
        kind,
        complete,
        frames: integer(e.frames, 1),
        encodedBytes: integer(e.encodedBytes),
        sha256: decodeHash(e.sha256),
        committedSeq: decodeSequence(e.committedSeq),
        coverage,
      };
      break;
    }
    default:
      return invalid();
  }
  return {
    exportId: decodeId(o.exportId),
    ordinal: integer(o.ordinal, 1),
    event,
  };
}
/** Digest covers these exact UTF-8 bytes of ALL frames before the trailer.
 * Markdown prose is produced by W3 from the same retained reader, not the DOM.
 * The manifest/trailer are fenced JSON metadata, not executable HTML comments.
 */
export function encodeExportFrame(
  frame: ExportFrame,
  format: ExportRequest["format"],
): string {
  const f = decodeExportFrame(frame);
  if (format === "ndjson") return `${canonicalJson(f)}\n`;
  if (f.event.kind === "markdown") return f.event.text;
  if (f.event.kind !== "manifest" && f.event.kind !== "trailer") invalid();
  return `\n\n\`\`\`json\n${canonicalJson(f)}\n\`\`\`\n`;
}
/** Sequence/count/scope guard only. The streaming adapter verifies the actual
 * digest and every access-generation check. EOF without trailer is incomplete. */
export class ExportTracker {
  private exportId: string | null = null;
  private ordinal = 0;
  private bytes = 0;
  private ended = false;
  private complete = false;
  private readonly request: ExportRequest;
  constructor(request: ExportRequest) {
    this.request = decodeExportRequest(request);
  }
  receive(input: unknown): ExportFrame {
    const f = decodeExportFrame(input),
      e = f.event;
    if (
      this.ended ||
      f.ordinal !== this.ordinal + 1 ||
      (this.exportId !== null && this.exportId !== f.exportId)
    )
      invalid();
    if (this.ordinal === 0) {
      if (
        e.kind !== "manifest" ||
        canonicalJson(e.request) !== canonicalJson(this.request)
      )
        invalid();
    } else if (e.kind === "manifest") invalid();
    if (e.kind === "trailer") {
      if (
        e.frames !== this.ordinal ||
        e.encodedBytes !== this.bytes ||
        e.committedSeq !== this.request.snapshotSeq
      )
        invalid();
      this.ended = true;
      this.complete = e.complete;
    } else {
      if (
        this.request.format === "markdown" &&
        e.kind !== "manifest" &&
        e.kind !== "markdown"
      )
        invalid();
      if (this.request.format === "ndjson" && e.kind === "markdown") invalid();
      if (e.kind === "detail" && !ownerInScope(e.owner, this.request.scope))
        invalid();
      if (
        e.kind === "graph" &&
        (canonicalJson(e.graph.request.scope) !==
          canonicalJson(this.request.scope) ||
          e.graph.request.snapshotSeq !== this.request.snapshotSeq ||
          e.graph.request.storeId !== this.request.storeId)
      )
        invalid();
      if (
        e.kind === "record" &&
        !historyRecordInScope(e.record, this.request.scope)
      )
        invalid();
      this.bytes += utf8Bytes(encodeExportFrame(f, this.request.format));
    }
    this.exportId = f.exportId;
    this.ordinal = f.ordinal;
    return f;
  }
  get completion():
    | "missing-trailer"
    | "incomplete"
    | "complete-unverified-digest" {
    return !this.ended
      ? "missing-trailer"
      : this.complete
        ? "complete-unverified-digest"
        : "incomplete";
  }
}
function historyRecordInScope(r: HistoryRecord, scope: Scope): boolean {
  return r.kind === "run"
    ? runInScope(r.projection, scope)
    : r.kind === "owner-fact"
      ? scope.kind === "task"
        ? r.link.taskId === scope.id
        : scope.kind === "run" && r.link.runId === scope.id
      : r.kind === "capture-fact"
        ? scope.kind === "task"
          ? r.link.taskId === scope.id
          : scope.kind === "run"
            ? r.link.runId === scope.id
            : r.link.childRunId === scope.id
        : ownerInScope(r.owner, scope);
}

export interface CheckObligations {
  taskId: string;
  revision: number;
  definitions: {
    selection: CheckSelection;
    status: "not-run" | "passed" | "failed" | "canceled" | "stale";
    checkId: string | null;
  }[];
}
export function decodeCheckObligations(v: unknown): CheckObligations {
  const o = closed(v, ["taskId", "revision", "definitions"]);
  const definitions = list(o.definitions, 32, (v) => {
    const d = closed(v, ["selection", "status", "checkId"]),
      selection = checkSelection(d.selection),
      status = oneOf(d.status, [
        "not-run",
        "passed",
        "failed",
        "canceled",
        "stale",
      ]),
      checkId = nullable(d.checkId, decodeId);
    if (
      selection.kind !== "configured" ||
      (status === "not-run") !== (checkId === null)
    )
      invalid();
    return { selection, status, checkId };
  });
  if (
    new Set(definitions.map((d) => d.selection.name)).size !==
    definitions.length
  )
    invalid();
  return {
    taskId: decodeId(o.taskId),
    revision: integer(o.revision),
    definitions,
  };
}
export interface EntityReadRequest {
  navigation?: string;
  storeId: string;
  scope: Scope;
  snapshotSeq: string;
  kind: "task" | "message" | "tool";
  id: string;
  version: number;
}
export function decodeEntityReadRequest(v: unknown): EntityReadRequest {
  const o = closed(v, [
    "storeId",
    "scope",
    "snapshotSeq",
    "kind",
    "id",
    "version",
    ...(Object.hasOwn(v ?? {}, "navigation") ? ["navigation"] : []),
  ]);
  return {
    ...(Object.hasOwn(o, "navigation")
      ? { navigation: decodeNavigation(o.navigation) }
      : {}),
    storeId: decodeId(o.storeId),
    scope: decodeScope(o.scope),
    snapshotSeq: decodeSequence(o.snapshotSeq),
    kind: oneOf(o.kind, ["task", "message", "tool"]),
    id: decodeId(o.id),
    version: integer(o.version, 1),
  };
}
export interface EntityPage {
  request: EntityReadRequest;
  record: Extract<HistoryRecord, { kind: "task" | "message" | "tool" }>;
}
export function decodeEntityPage(v: unknown): EntityPage {
  canonicalJson({ kind: "ok", value: v }, LIMITS.pageBytes);
  const o = closed(v, ["request", "record"]),
    request = decodeEntityReadRequest(o.request),
    record = decodeHistoryRecord(o.record);
  if (
    (record.kind !== "task" &&
      record.kind !== "message" &&
      record.kind !== "tool") ||
    record.kind !== request.kind ||
    record.owner.entity.id !== request.id ||
    record.version !== request.version ||
    !ownerInScope(record.owner, request.scope)
  )
    invalid();
  return { request, record };
}

export type EntityReadResult = EntityPage | RequestProgress<EntityReadRequest>;
export function decodeEntityReadResult(v: unknown): EntityReadResult {
  if (Object.getOwnPropertyDescriptor(v ?? {}, "kind")?.value !== "progress")
    return decodeEntityPage(v);
  canonicalJson({ kind: "ok", value: v }, LIMITS.pageBytes);
  const o = closed(v, ["kind", "request", "next", "coverage"]),
    request = decodeEntityReadRequest(o.request),
    next = decodeEntityReadRequest(o.next);
  progressPair(request, next);
  return {
    kind: "progress",
    request,
    next,
    coverage: decodeCoverage(o.coverage),
  };
}
