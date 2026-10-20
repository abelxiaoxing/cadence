/** Bounded list/entity continuation. A single forward validator proves the
 * snapshot, a single output iterator visits it, and at most one target worker
 * collects fixed original-source locators. Nothing here writes an accelerator. */
import { createHash } from "node:crypto";
import {
  ContractError,
  canonicalJson,
  decodeEntityReadResult,
  decodeHistoryReadResult,
  decodeHistoryRecord,
  type EntityReadRequest,
  type EntityReadResult,
  type HistoryReadResult,
  type HistoryRecord,
  LIMITS,
  type ListRequest,
  ownerInScope,
  parseWireJson,
  readIdentity,
} from "../service-contract.ts";
import { closed, integer, oneOf } from "../worker-public.mjs";
import { decodeScanPoint } from "./detail-progress.ts";
import {
  collectEntity,
  decodeEntityState,
  type EntityState,
  entityDetail,
  freshEntity,
  materializeEntity,
  sourceAt,
} from "./entity-state.ts";
import { HistoryReadBudget } from "./files.ts";
import type { LocatedBatch } from "./navigation.ts";
import type { HistoryProjection } from "./projection.ts";
import { HistoryReadProof, type ReadProofContext } from "./read-proof.ts";
import {
  decodeRetainedProgress,
  freshProgress,
  type RetainedProgress,
} from "./retained-progress.ts";
import { RetainedTraversal } from "./retained-traversal.ts";
import {
  collectRun,
  decodeRunProgressState,
  freshRun,
  materializeRun,
  type RunProgressState,
} from "./run-progress-state.ts";
import type { ScanPoint } from "./search.ts";
import { ResumableSha256 } from "./sha256-state.ts";
import { SourceRows } from "./source-row.ts";
import { COMPLETE, combineCoverage, type JournalRow } from "./types.ts";
import {
  decodeValidator,
  ForwardValidator,
  freshValidator,
  type ValidatorState,
} from "./validator.ts";

const SLOTS = LIMITS.assignments + 1;
function bad(): never {
  throw new ContractError("corrupt-selected");
}
const initial = (): ScanPoint => ({
  pos: { segment: 1, offset: 0 },
  row: 0,
  event: 0,
  byte: 0,
  snapshot: 0,
});
const count = (row: JournalRow) =>
  row.value.kind === "capture" || row.value.kind === "owner"
    ? row.value.events.length
    : 1;
interface Target {
  phase: "scan" | "detail" | "render";
  proof: ValidatorState;
  row: number;
  event: number;
  entity: EntityState | null;
  run: RunProgressState | null;
  stop: string | null;
}
interface State {
  phase: "discover" | "read" | "legacy" | "done";
  traversal: RetainedProgress;
  point: ScanPoint;
  target: Target | null;
  seek: ScanPoint | null;
  ordinal: number;
  legacy: number;
  legacyIdentity: string | null;
}
function fresh(request: ListRequest | EntityReadRequest): State {
  const traversal = freshProgress();
  if (request.snapshotSeq === null) traversal.phase = "output";
  return {
    phase: request.snapshotSeq === null ? "discover" : "read",
    traversal,
    point: initial(),
    target: null,
    seek: null,
    ordinal: 0,
    legacy: 0,
    legacyIdentity: null,
  };
}
function decodeState(value: unknown): State {
  const o = closed(value, [
    "phase",
    "traversal",
    "point",
    "target",
    "seek",
    "ordinal",
    "legacy",
    "legacyIdentity",
  ]);
  let target: Target | null = null;
  if (o.target !== null) {
    const t = closed(o.target, [
      "phase",
      "proof",
      "row",
      "event",
      "entity",
      "run",
      "stop",
    ]);
    if (t.stop !== null && typeof t.stop !== "string") bad();
    target = {
      phase: oneOf(t.phase, ["scan", "detail", "render"]),
      proof: decodeValidator(t.proof),
      row: integer(t.row, 0, LIMITS.segmentRecords),
      event: integer(t.event, 0, LIMITS.ownerQueueFrames),
      entity: t.entity === null ? null : decodeEntityState(t.entity),
      run: t.run === null ? null : decodeRunProgressState(t.run),
      stop: t.stop,
    };
    if (!target.entity === !target.run) bad();
  }
  if (
    o.legacyIdentity !== null &&
    (typeof o.legacyIdentity !== "string" ||
      !/^[a-f0-9]{64}$/.test(o.legacyIdentity))
  )
    bad();
  return {
    phase: oneOf(o.phase, ["discover", "read", "legacy", "done"]),
    traversal: decodeRetainedProgress(o.traversal),
    point: decodeScanPoint(o.point),
    target,
    seek: o.seek === null ? null : decodeScanPoint(o.seek),
    ordinal: integer(o.ordinal),
    legacy: integer(o.legacy, 0, 1000),
    legacyIdentity: o.legacyIdentity,
  };
}
function target(
  entity: EntityState | null,
  run: RunProgressState | null,
  stop: string | null = null,
): Target {
  return {
    phase: "scan",
    proof: freshValidator(),
    row: 0,
    event: 0,
    entity,
    run,
    stop,
  };
}
function current(
  v: ForwardValidator,
  budget: HistoryReadBudget,
): LocatedBatch | null {
  const s = v.state,
    p =
      s.phase === "ready"
        ? {
            segment: s.segment,
            offset: s.start,
            bytes: s.end - s.start,
            seq: String(s.committed),
          }
        : v.next(budget);
  return p ? v.batch(p, budget) : null;
}
function fits(
  link: { taskId: string; runId: string | null; childRunId?: string | null },
  scope: ListRequest["scope"],
): boolean {
  return (
    scope.kind === "workspace" ||
    (scope.kind === "task"
      ? link.taskId === scope.id
      : scope.kind === "run"
        ? link.runId === scope.id
        : link.childRunId === scope.id)
  );
}
function nextAfter(
  request: ListRequest,
  n: number,
): NonNullable<ListRequest["after"]> {
  const h = createHash("sha256")
    .update(
      canonicalJson({ ...readIdentity(request), after: null, ordinal: n }),
    )
    .digest("hex");
  return {
    recordId: `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`,
    version: 1,
    offset: n,
  };
}
export function listPreparation(
  request: ListRequest,
  completion: ReturnType<HistoryReadProof["prepareCompletion"]>,
  start?: ScanPoint,
): HistoryReadResult {
  const state = fresh(request);
  // A legacy public coordinate is a requested output position, not proof. The
  // finite source traversal still starts at byte zero and authenticates it.
  if (start) state.seek = start;
  const next = {
    ...readIdentity(request),
    navigation: completion.seal(
      { purpose: "list", request },
      Buffer.from(canonicalJson(state, 6000)),
    ),
  };
  return decodeHistoryReadResult({
    kind: "progress",
    request,
    next,
    coverage: COMPLETE,
  });
}
export function entityPreparation(
  request: EntityReadRequest,
  completion: ReturnType<HistoryReadProof["prepareCompletion"]>,
): EntityReadResult {
  const next = {
    ...readIdentity(request),
    navigation: completion.seal(
      { purpose: "entity", request },
      Buffer.from(canonicalJson(fresh(request), 6000)),
    ),
  };
  return decodeEntityReadResult({
    kind: "progress",
    request,
    next,
    coverage: COMPLETE,
  });
}

function advanceTarget(
  p: HistoryProjection,
  t: Target,
  snapshot: string,
  budget: HistoryReadBudget,
  sources: SourceRows,
): HistoryRecord | undefined {
  const v = new ForwardValidator(p.reader.files, t.proof);
  v.revalidate(budget);
  let reset = false;
  try {
    if (snapshot === "0") t.phase = "render";
    while (t.phase !== "render") {
      const b = current(v, budget);
      if (!b || BigInt(b.pointer.seq) > BigInt(snapshot)) bad();
      for (; t.row < b.rows.length; t.row++, t.event = 0) {
        const row = b.rows[t.row];
        for (; t.event < count(row); t.event++) {
          budget.reserve(0);
          if (t.phase === "detail") {
            if (t.entity && entityDetail(t.entity, row, t.event)) {
              t.entity.detail = sourceAt(b, t.row, t.event);
              t.phase = "render";
              break;
            }
          } else {
            const value = row.value,
              e =
                value.kind === "capture" || value.kind === "owner"
                  ? value.events[t.event]
                  : null;
            if (e?.kind === "capture" && e.id === t.stop) {
              t.phase = "render";
              break;
            }
            if (t.entity) collectEntity(t.entity, b, t.row, t.event);
            if (t.run) collectRun(t.run, b, t.row, t.event);
            if (t.entity?.done) {
              t.phase = "render";
              break;
            }
          }
        }
        if (t.phase === "render") break;
      }
      if (t.phase === "render" || b.pointer.seq === snapshot) {
        if (t.phase === "detail" && !t.entity?.detail) bad();
        if (t.entity?.detailId && !t.entity.detail) {
          t.phase = "detail";
          t.row = 0;
          t.event = 0;
          t.proof = freshValidator();
          reset = true;
          // Phase transition is semantic progress; the next quantum performs
          // the backwards-selected content lookup with the same validator.
          throw new ContractError("receipt-inconclusive");
        }
        t.phase = "render";
        break;
      }
      t.row = 0;
      t.event = 0;
      v.next(budget);
    }
    v.assertCurrent();
    if (t.run) return materializeRun(t.run, sources, p.readEpoch());
    if (!t.entity) bad();
    const record = materializeEntity(t.entity, sources);
    if (t.entity.wanted !== null && record?.version !== t.entity.wanted) return;
    return record;
  } finally {
    if (!reset) t.proof = v.checkpoint();
  }
}

export async function readRetainedList(
  p: HistoryProjection,
  request: ListRequest,
): Promise<HistoryReadResult> {
  return read(p, request, false);
}
export async function readRetainedEntity(
  p: HistoryProjection,
  request: EntityReadRequest,
): Promise<EntityReadResult> {
  return read(p, request, true);
}
function read(
  p: HistoryProjection,
  request: ListRequest,
  entity: false,
): Promise<HistoryReadResult>;
function read(
  p: HistoryProjection,
  request: EntityReadRequest,
  entity: true,
): Promise<EntityReadResult>;
async function read(
  p: HistoryProjection,
  request: ListRequest | EntityReadRequest,
  entity: boolean,
): Promise<HistoryReadResult | EntityReadResult> {
  const budget = new HistoryReadBudget(),
    proof = new HistoryReadProof(p.reader.files),
    completion = proof.prepareCompletion(budget);
  const context = (r: typeof request): ReadProofContext =>
    "reader" in r
      ? { purpose: "list", request: r }
      : { purpose: "entity", request: r };
  let s = fresh(request);
  if (request.navigation)
    s = decodeState(
      parseWireJson(
        new TextDecoder("utf-8", { fatal: true }).decode(
          proof.open(context(request), request.navigation, budget),
        ),
        6000,
      ),
    );
  if (
    request.storeId !== p.reader.storeId ||
    ("reader" in request &&
      request.scope.kind === "workspace" &&
      request.scope.id !== p.reader.files.format.workspaceId)
  )
    bad();
  const sources = new SourceRows(p.reader.files, budget);
  const collected: HistoryRecord[] = [];
  let finishPage: (() => HistoryReadResult) | undefined;
  let traversal: RetainedTraversal | undefined,
    discovery: ForwardValidator | undefined;
  const coordinate = () => canonicalJson(s, 6000),
    before = coordinate();
  const validate = () => {
    traversal?.assertCurrent();
    discovery?.assertCurrent();
    sources.assertCurrent();
  };
  const seal = <T extends typeof request>(r: T): T => {
    validate();
    return {
      ...readIdentity(r),
      navigation: completion.seal(context(r), Buffer.from(coordinate())),
    } as T;
  };
  const progress = () => {
    if (coordinate() === before)
      throw new ContractError("receipt-inconclusive");
    const next = seal(request);
    return entity
      ? decodeEntityReadResult({
          kind: "progress",
          request,
          next,
          coverage: s.traversal.coverage,
        })
      : decodeHistoryReadResult({
          kind: "progress",
          request,
          next,
          coverage: s.traversal.coverage,
        });
  };
  try {
    if (s.phase === "discover") {
      if (!("reader" in request) || request.snapshotSeq !== null) bad();
      discovery = new ForwardValidator(p.reader.files, s.traversal.proof);
      discovery.revalidate(budget);
      try {
        for (;;) {
          const pointer = discovery.next(budget);
          if (!pointer) break;
          s.traversal.snapshot = {
            pointer,
            stamp: discovery.state.stamp,
            sha256: new ResumableSha256(discovery.state.raw).digest(),
          };
        }
      } finally {
        s.traversal.proof = discovery.checkpoint();
      }
      if (discovery.state.previous.tail)
        s.traversal.coverage = combineCoverage(s.traversal.coverage, {
          ...COMPLETE,
          observed: "incomplete",
          omissions: ["gap"],
        });
      const snapshotSeq = s.traversal.snapshot?.pointer.seq ?? "0";
      s.phase = "read";
      s.traversal.phase = "output";
      s.traversal.proof = freshValidator();
      const next = seal({ ...readIdentity(request), snapshotSeq });
      return decodeHistoryReadResult({
        kind: "snapshot",
        request,
        next,
        coverage: s.traversal.coverage,
      });
    }
    if (request.snapshotSeq === null) bad();
    traversal = new RetainedTraversal(
      p.reader.files,
      request.snapshotSeq,
      budget,
      s.traversal,
    );
    traversal.prepare(s.point);
    if (
      "reader" in request &&
      request.reader === "tasks" &&
      request.after?.version === Number.MAX_SAFE_INTEGER &&
      s.phase === "read"
    ) {
      s.phase = "legacy";
      s.legacy = request.after.offset;
    }
    if (entity) {
      if (!("kind" in request)) bad();
      s.target ??= target(
        freshEntity(request.kind, request.id, request.version),
        null,
      );
      const record = advanceTarget(
        p,
        s.target,
        request.snapshotSeq,
        budget,
        sources,
      );
      let selected = record;
      if (!selected && request.kind === "task")
        selected = legacyEntity(p, request.id, request.version, budget);
      if (
        !selected ||
        !("owner" in selected) ||
        !ownerInScope(selected.owner, request.scope)
      )
        bad();
      validate();
      completion.validate();
      return decodeEntityReadResult({ request, record: selected });
    }
    if (!("reader" in request)) bad();
    const finish = (): HistoryReadResult => {
      if (!traversal) bad();
      s.traversal = traversal.checkpoint();
      let next: ListRequest | null = null;
      if (s.phase !== "done") {
        s.ordinal += collected.length || 1;
        next = seal({
          ...readIdentity(request),
          after: nextAfter(request, s.ordinal),
        });
      } else {
        validate();
        completion.validate();
      }
      return decodeHistoryReadResult({
        request,
        records: collected,
        next,
        coverage: s.traversal.coverage,
      });
    };
    finishPage = finish;
    while (s.phase === "read") {
      const b = traversal.next(s.point);
      if (!b) {
        // Output exhaustion is not completion of the independent tail proof.
        // A previous quantum may have suspended finish() after the snapshot.
        traversal.finish();
        s.phase = request.reader === "tasks" ? "legacy" : "done";
        break;
      }
      if (s.seek) {
        const seek = s.seek;
        if (
          b.pointer.segment > seek.pos.segment ||
          (b.pointer.segment === seek.pos.segment &&
            b.pointer.offset > seek.pos.offset)
        )
          bad();
        if (
          b.pointer.segment !== seek.pos.segment ||
          b.pointer.offset !== seek.pos.offset
        ) {
          if (b.pointer.seq === request.snapshotSeq) bad();
          s.point.pos = b.next;
          s.point.row = 0;
          s.point.event = 0;
          continue;
        }
        s.point.row = seek.row;
        s.point.event = seek.event;
        s.seek = null;
      }
      for (; s.point.row < b.rows.length; s.point.row++, s.point.event = 0) {
        const row = b.rows[s.point.row],
          value = row.value;
        for (; s.point.event < count(row) * SLOTS; s.point.event++) {
          budget.reserve(0);
          const index = Math.floor(s.point.event / SLOTS),
            ordinal = s.point.event % SLOTS,
            event =
              value.kind === "owner" || value.kind === "capture"
                ? value.events[index]
                : null;
          let record: HistoryRecord | undefined;
          if (s.target) {
            record = advanceTarget(
              p,
              s.target,
              request.snapshotSeq,
              budget,
              sources,
            );
            if (
              request.reader === "tools" &&
              s.target.entity?.first &&
              canonicalJson(s.target.entity.first) !==
                canonicalJson(sourceAt(b, s.point.row, index))
            )
              record = undefined;
            if (
              request.reader === "contents" &&
              event?.kind === "capture" &&
              event.value.event.kind === "omitted-block" &&
              value.kind === "capture"
            )
              record = omitted(
                value.link,
                event.value.event.block,
                record && "version" in record ? record.version : 1,
              );
            s.target = null;
          } else if (
            request.reader === "tasks" &&
            ordinal === 0 &&
            value.kind === "admission" &&
            value.intent.createdTaskId &&
            value.intent.identity.kind === "action" &&
            value.intent.identity.action.kind === "create"
          ) {
            s.target = target(
              freshEntity("task", value.intent.createdTaskId, null),
              null,
            );
            // The first Create/message-start is an original occurrence anchor.
            s.target.proof = traversal.checkpoint().proof;
            s.target.row = s.point.row;
            s.target.event = index;
          } else if (
            (value.kind === "capture" || value.kind === "owner") &&
            fits(
              {
                ...value.link,
                childRunId:
                  value.kind === "capture" ? value.link.childRunId : null,
              },
              request.scope,
            )
          ) {
            if (
              ordinal === 0 &&
              request.reader === "contents" &&
              event?.kind === "end" &&
              event.detail.descriptor
            )
              record = {
                kind: "content",
                owner: event.detail.owner,
                version: event.detail.content.version,
                detailId: event.detail.detailId,
                descriptor: event.detail.descriptor,
                content: event.detail.content,
                coverage: event.detail.coverage,
              };
            if (
              ordinal === 0 &&
              event?.kind === "capture" &&
              value.kind === "capture"
            ) {
              const e = event.value.event;
              if (request.reader === "events")
                record = {
                  kind: "capture-fact",
                  recordId: event.id,
                  committedSeq: row.seq,
                  link: value.link,
                  capture: event.value,
                };
              if (request.reader === "messages" && e.kind === "message-start") {
                s.target = target(
                  freshEntity("message", e.messageId, null),
                  null,
                );
                s.target.proof = traversal.checkpoint().proof;
                s.target.row = s.point.row;
                s.target.event = index;
              }
              if (
                request.reader === "tools" &&
                (e.kind === "call-declaration" ||
                  e.kind === "tool-start" ||
                  e.kind === "tool-end")
              )
                s.target = target(freshEntity("tool", e.callId, null), null);
              if (request.reader === "contents" && e.kind === "omitted-block") {
                const o = e.block.owner;
                if ("messageId" in o)
                  s.target = target(
                    freshEntity("message", o.messageId, null),
                    null,
                    event.id,
                  );
                else if ("callId" in o)
                  s.target = target(
                    freshEntity("tool", o.callId, null),
                    null,
                    event.id,
                  );
                else record = omitted(value.link, e.block, 1);
              }
            }
            if (
              ordinal === 0 &&
              event?.kind === "owner" &&
              event.value.kind === "fact" &&
              value.kind === "owner"
            ) {
              const fact = event.value.fact;
              if (
                request.reader === "events" ||
                (request.reader === "checks" &&
                  ["check-start", "check-settled"].includes(fact.kind)) ||
                (request.reader === "changes" && fact.kind === "changes") ||
                (request.reader === "reviews" && fact.kind === "review")
              )
                record = {
                  kind: "owner-fact",
                  recordId: event.id,
                  committedSeq: row.seq,
                  observedMs: value.observedMs,
                  link: value.link,
                  fact,
                };
            }
          }
          // Parent-admitted rows legitimately own child-scoped run projections.
          if (
            !s.target &&
            !record &&
            request.reader === "runs" &&
            value.kind === "owner" &&
            event?.kind === "owner" &&
            event.value.kind === "fact" &&
            event.value.fact.kind === "parent-admitted"
          ) {
            const f = event.value.fact,
              child = ordinal
                ? f.identity.assignments[ordinal - 1]?.childRunId
                : null;
            if (
              (ordinal === 0 || child) &&
              fits({ ...value.link, childRunId: child }, request.scope)
            )
              s.target = target(
                null,
                freshRun(f.runId, child ?? null, ordinal),
              );
          }
          if (s.target) {
            s.point.event--;
            continue;
          } // same original slot; next iteration runs the target
          if (record) {
            const decoded = decodeHistoryRecord(record);
            // Reserve the ENTIRE encoded response, including both envelopes and
            // worst-case next proof, before advancing the publication position.
            const value = {
              request,
              records: [...collected, decoded],
              next: {
                ...readIdentity(request),
                after: nextAfter(request, s.ordinal + collected.length + 1),
                navigation: "x".repeat(LIMITS.navigationBytes),
              },
              coverage: traversal.state.coverage,
            };
            const encoded = JSON.stringify({ kind: "ok", value });
            if (Buffer.byteLength(encoded) > LIMITS.pageBytes) {
              if (!collected.length) throw new ContractError("oversize");
              return finish();
            }
            collected.push(decoded);
            if (record.kind === "content")
              traversal.state.coverage = combineCoverage(
                traversal.state.coverage,
                record.coverage,
              );
            if (collected.length === request.limit) {
              s.point.event++;
              return finish();
            }
          }
        }
      }
      if (b.pointer.seq === request.snapshotSeq) {
        traversal.finish();
        s.phase = request.reader === "tasks" ? "legacy" : "done";
        break;
      }
      s.point.pos = b.next;
      s.point.row = 0;
      s.point.event = 0;
    }
    if (s.phase === "legacy") {
      const tasks = [...p.environment.legacyTasks(budget)].sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
      );
      if (tasks.length > 1000) throw new ContractError("capacity");
      const sum = createHash("sha256");
      for (const task of tasks) {
        budget.reserve(0);
        sum.update(
          JSON.stringify({
            id: task.id,
            revision: task.revision,
            goal: task.goal,
          }),
        );
      }
      const identity = sum.digest("hex");
      if (s.legacy > tasks.length) bad();
      if (
        !s.legacyIdentity &&
        request.after?.version === Number.MAX_SAFE_INTEGER
      ) {
        const h = createHash("sha256")
          .update(
            canonicalJson({
              ...readIdentity(request),
              after: null,
              legacy: s.legacy === 0 ? "begin" : identity,
              offset: s.legacy,
            }),
          )
          .digest("hex");
        if (
          request.after.recordId !==
          `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
        )
          bad();
      }
      if (s.legacyIdentity && s.legacyIdentity !== identity) bad();
      s.legacyIdentity = identity;
      const task = tasks[s.legacy];
      if (task) {
        s.legacy++;
        if (s.legacy === tasks.length) s.phase = "done";
        traversal.state.coverage = combineCoverage(traversal.state.coverage, {
          ...COMPLETE,
          observed: "incomplete",
          omissions: ["gap"],
        });
        collected.push(taskRecord(task));
        return finish();
      }
      s.phase = "done";
    }
    return finish();
  } catch (error) {
    if (
      !(error instanceof ContractError) ||
      error.code !== "receipt-inconclusive"
    )
      throw error;
    if (traversal) s.traversal = traversal.checkpoint();
    if (collected.length && finishPage) return finishPage();
    return progress();
  }
}
function taskRecord(t: import("../task-types.ts").TaskRecord): HistoryRecord {
  return decodeHistoryRecord({
    kind: "task",
    owner: {
      taskId: t.id,
      runId: null,
      childRunId: null,
      entity: { kind: "task", id: t.id, version: t.revision },
    },
    version: t.revision,
    goal: t.goal,
    plan: null,
  });
}
function legacyEntity(
  p: HistoryProjection,
  id: string,
  version: number,
  budget: HistoryReadBudget,
): HistoryRecord | undefined {
  const tasks = p.environment.legacyTasks(budget);
  if (tasks.length > 1000) throw new ContractError("capacity");
  const t = tasks.find((t) => t.id === id && t.revision === version);
  return t ? taskRecord(t) : undefined;
}
function omitted(
  link: import("../service-contract.ts").RecordingLink,
  block: import("../service-contract.ts").OmittedBlock,
  version: number,
): HistoryRecord {
  const o = block.owner,
    kind = "messageId" in o ? "message" : "callId" in o ? "tool" : "child",
    id =
      "messageId" in o
        ? o.messageId
        : "callId" in o
          ? o.callId
          : link.childRunId;
  return decodeHistoryRecord({
    kind: "omitted",
    owner: {
      taskId: link.taskId,
      runId: link.runId,
      childRunId: link.childRunId,
      entity: { kind, id, version },
    },
    version,
    block,
  });
}
