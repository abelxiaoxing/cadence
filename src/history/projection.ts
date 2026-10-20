/** Retained public projection. Current authority is supplied separately, never
 * reconstructed from an old admission or by constructing an SDK on a read. */
import { createHash } from "node:crypto";
import type { ProjectionPort } from "../service/ports.ts";
import {
  type CheckObligations,
  type CheckSelection,
  ContractError,
  type ControlContext,
  canonicalJson,
  controlTask,
  controlWorkspace,
  decodeControlContext,
  decodeCursor,
  decodeEntityPage,
  decodeEntityReadRequest,
  decodeHistoryPage,
  decodeHistoryRecord,
  decodeListRequest,
  decodeScope,
  decodeSessionBootstrap,
  decodeSnapshot,
  decodeWorkspaceBootstrap,
  type EntityReadRequest,
  type EntityReadResult,
  type HistoryPage,
  type HistoryReadResult,
  type HistoryRecord,
  LIMITS,
  type ListRequest,
  type ModelSelection,
  ownerInScope,
  publicError,
  type ReadCursor,
  type RunProjection,
  readIdentity,
  type Scope,
  type SessionBootstrap,
  type Snapshot,
} from "../service-contract.ts";
import type { TaskRecord } from "../task-types.ts";
import { currentChecks } from "./checks.ts";
import {
  collectEntity,
  entityDetail,
  freshEntity,
  materializeEntity,
  sourceAt,
} from "./entity-state.ts";
import { exportHistory } from "./export.ts";
import { HistoryReadBudget } from "./files.ts";
import {
  entityPreparation,
  listPreparation,
  readRetainedEntity,
  readRetainedList,
} from "./list-progress.ts";
import {
  HistoryNavigation,
  type LocatedBatch,
  type Position,
} from "./navigation.ts";
import { HistoryReadProof } from "./read-proof.ts";
import type { HistoryReader } from "./reader.ts";
import { RunState } from "./run-state.ts";
import { searchHistory } from "./search.ts";
import { SourceRows } from "./source-row.ts";
import { COMPLETE, combineCoverage, FORMAT, type JournalRow } from "./types.ts";

export interface ReadEnvironment {
  /** Actual W4 current result revision. Absent only in legacy retained fixtures. */
  checkObligations?(taskId: string): CheckObligations;
  /** RAM-only W1/W4 callbacks. No provider/auth resolution or admission effects. */
  session(): SessionBootstrap;
  workspace(): {
    rootLabel: string;
    models: ModelSelection[];
    context: ControlContext;
    activeRuns?: import("../service-contract.ts").ActiveRuns;
  };
  context(taskId: string): ControlContext;
  checks(taskId: string): { revision: number; selections: CheckSelection[] };
  /** Bounded legacy-only v1 summaries, disjoint from committed Create records.
   * The owner supplies this readonly current inventory; no import/approval.
   * Any native payload reads must reserve this call's budget before IO. */
  legacyTasks(budget: HistoryReadBudget): readonly TaskRecord[];
}
export type RetainedProjectionPort = ProjectionPort;
const RECORD_SLOTS = LIMITS.assignments + 1;
const ROW_SLOTS = LIMITS.ownerQueueFrames * RECORD_SLOTS + 1;
type Entity = Extract<HistoryRecord, { kind: "task" | "message" | "tool" }>;
function fail(): never {
  throw new ContractError("corrupt-selected");
}
const fits = (
  link: { taskId: string; runId: string | null; childRunId?: string | null },
  scope: ListRequest["scope"],
) =>
  scope.kind === "workspace" ||
  (scope.kind === "task"
    ? link.taskId === scope.id
    : scope.kind === "run"
      ? link.runId === scope.id
      : link.childRunId === scope.id);
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const GAP = {
  ...COMPLETE,
  observed: "incomplete" as const,
  omissions: ["gap" as const],
};

export interface SnapshotNotice {
  scope: Scope;
  committedSeq: string;
  keys: string[];
}
export class HistoryProjection implements RetainedProjectionPort {
  readonly navigation: HistoryNavigation;
  private readonly snapshotObservers = new Set<
    (snapshot: SnapshotNotice) => void
  >();
  observeSnapshots(callback: (snapshot: SnapshotNotice) => void): () => void {
    if (this.snapshotObservers.size >= LIMITS.viewers)
      throw new ContractError("capacity");
    this.snapshotObservers.add(callback);
    return () => {
      this.snapshotObservers.delete(callback);
    };
  }
  constructor(
    readonly reader: HistoryReader,
    readonly environment: ReadEnvironment,
  ) {
    this.navigation = new HistoryNavigation(reader.files);
  }
  session = async () => {
    const s = decodeSessionBootstrap(this.environment.session());
    if (s.storeId !== this.reader.storeId) fail();
    return s;
  };
  workspace = async () => {
    const session = await this.session(),
      current = this.environment.workspace();
    return decodeWorkspaceBootstrap({
      ...current,
      workspaceId: this.reader.files.format.workspaceId,
      storeId: this.reader.storeId,
      epoch: session.epoch,
      committedSeq: this.navigation.latest(new HistoryReadBudget()),
    });
  };
  readEpoch(): string {
    const session = decodeSessionBootstrap(this.environment.session());
    if (session.storeId !== this.reader.storeId) fail();
    return session.epoch;
  }
  /** Indexed entity chains carry original batch pointers. Missing chains use the
   * same bounded authoritative scan, not an invented absent entity. */
  private batches(
    id: string,
    snapshot: string,
    budget: HistoryReadBudget,
  ): LocatedBatch[] {
    const indexed = this.navigation.entityBatches(id, snapshot, budget);
    if (indexed) return indexed;
    const out: LocatedBatch[] = [];
    let pos: Position = { segment: 1, offset: 0 };
    for (;;) {
      const b = this.navigation.next(pos, budget);
      if (!b) {
        if (snapshot !== "0") fail();
        break;
      }
      if (BigInt(b.pointer.seq) > BigInt(snapshot)) {
        if (snapshot !== "0") fail();
        break;
      }
      out.push(b);
      if (b.pointer.seq === snapshot) break;
      pos = b.next;
    }
    return out;
  }
  runState(id: string, snapshot: string, budget: HistoryReadBudget): RunState {
    const state = new RunState(id);
    for (const b of this.navigation.runBatches(id, snapshot, budget) ??
      this.batches(id, snapshot, budget))
      for (const row of b.rows) state.apply(row, b.pointer.seq);
    if (state.admission)
      this.reader.files.readAdmission(id, state.admission, budget);
    return state;
  }
  projectRun(state: RunState, scope: Scope): RunProjection[] {
    return state.projections(this.readEpoch()).filter((r) => fits(r, scope));
  }
  private entityAt(
    id: string,
    kind: Entity["kind"],
    snapshot: string,
    budget: HistoryReadBudget,
    version?: number,
    stopEventId?: string,
  ): Entity | undefined {
    const state = freshEntity(kind, id, version ?? null);
    const selected = new Map<string, { batch: LocatedBatch; row: number }>();
    const remember = (batch: LocatedBatch, row: number) => {
      const keys = [
        state.first,
        state.last,
        state.result,
        state.detail,
      ].flatMap((source) =>
        source ? [`${source.segment}/${source.offset}`] : [],
      );
      for (const key of selected.keys())
        if (!keys.includes(key)) selected.delete(key);
      const source = sourceAt(batch, row);
      const key = `${source.segment}/${source.offset}`;
      if (keys.includes(key)) selected.set(key, { batch, row });
    };
    // The accelerated owner has already checked these original batches. Reuse
    // its budget-scoped cache/stamp/checksum guard, rather than rereading each
    // message row through a second IO path. At most four selected row slots.
    const sources = new SourceRows(this.reader.files, budget, (source) => {
      const selectedRow = selected.get(`${source.segment}/${source.offset}`);
      if (!selectedRow) fail();
      const batch = this.navigation.batch(selectedRow.batch.pointer, budget);
      const { event: _event, ...original } = sourceAt(batch, selectedRow.row);
      if (
        original.segment !== source.segment ||
        original.offset !== source.offset ||
        original.bytes !== source.bytes ||
        original.sha256 !== source.sha256 ||
        original.seq !== source.seq
      )
        fail();
      return batch.rows[selectedRow.row];
    });
    const batches = this.batches(id, snapshot, budget).map((batch) =>
      batch.sourceRow ? batch : this.navigation.batch(batch.pointer, budget),
    );
    outer: for (const batch of batches) {
      for (let row = 0; row < batch.rows.length; row++) {
        const value = batch.rows[row].value,
          count =
            value.kind === "capture" || value.kind === "owner"
              ? value.events.length
              : 1;
        for (let event = 0; event < count; event++) {
          const e =
            value.kind === "capture" || value.kind === "owner"
              ? value.events[event]
              : null;
          if (e?.kind === "capture" && e.id === stopEventId) break outer;
          const previous = state.last;
          collectEntity(state, batch, row, event);
          if (previous !== state.last) remember(batch, row);
          if (state.done) break outer;
        }
      }
    }
    if (state.detailId) {
      outer: for (const batch of batches)
        for (let row = 0; row < batch.rows.length; row++) {
          const value = batch.rows[row].value;
          if (value.kind !== "capture" && value.kind !== "owner") continue;
          for (let event = 0; event < value.events.length; event++)
            if (entityDetail(state, batch.rows[row], event)) {
              state.detail = sourceAt(batch, row, event);
              remember(batch, row);
              break outer;
            }
        }
      if (!state.detail) throw new ContractError("receipt-inconclusive");
    }
    let record = materializeEntity(state, sources);
    sources.assertCurrent();
    if (!record && kind === "task") {
      const tasks = this.environment.legacyTasks(budget);
      if (tasks.length > 1000) throw new ContractError("capacity");
      const legacy = tasks.find((t) => t.id === id);
      if (legacy)
        record = {
          kind,
          owner: {
            taskId: id,
            runId: null,
            childRunId: null,
            entity: { kind, id, version: legacy.revision },
          },
          version: legacy.revision,
          goal: legacy.goal,
          plan: null,
        };
    }
    const result =
      version === undefined || version === record?.version ? record : undefined;
    return result ? (decodeHistoryRecord(result) as Entity) : undefined;
  }
  private acceleratedEntity = async (
    value: EntityReadRequest,
    budget: HistoryReadBudget,
  ) => {
    const request = decodeEntityReadRequest(value);
    if (request.storeId !== this.reader.storeId) fail();
    this.navigation.snapshot(request.snapshotSeq, budget);
    const record = this.entityAt(
      request.id,
      request.kind,
      request.snapshotSeq,
      budget,
      request.version,
    );
    if (!record || !ownerInScope(record.owner, request.scope)) fail();
    return decodeEntityPage({ request, record });
  };
  entity = async (value: EntityReadRequest): Promise<EntityReadResult> => {
    const request = decodeEntityReadRequest(value);
    if (request.navigation) return readRetainedEntity(this, request);
    const budget = new HistoryReadBudget();
    const completion =
      this.reader.files.format.schema === FORMAT
        ? new HistoryReadProof(this.reader.files).prepareCompletion(budget)
        : null;
    try {
      const page = await this.acceleratedEntity(request, budget);
      completion?.validate();
      return page;
    } catch (error) {
      if (
        !completion ||
        !(error instanceof ContractError) ||
        error.code !== "receipt-inconclusive"
      )
        throw error;
      return entityPreparation(request, completion);
    }
  };
  /** Navigation cursor is a query-bound verified batch/row/item position, not an
   * entity content version, an authentication token, or an execution capability. */
  private cursor(
    request: ListRequest,
    pos: Position,
    row: number,
    item: number,
  ): NonNullable<ListRequest["after"]> {
    const offset =
      pos.offset * (LIMITS.segmentRecords + 1) * ROW_SLOTS +
      row * ROW_SLOTS +
      item;
    const digest = createHash("sha256")
      .update(
        canonicalJson({
          ...readIdentity(request),
          after: null,
          position: { ...pos, row, item },
        }),
      )
      .digest("hex");
    return {
      recordId: `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`,
      version: pos.segment,
      offset,
    };
  }
  private parseCursor(request: ListRequest): {
    pos: Position;
    row: number;
    item: number;
  } {
    const a = request.after;
    if (!a) return { pos: { segment: 1, offset: 0 }, row: 0, item: 0 };
    const unit = (LIMITS.segmentRecords + 1) * ROW_SLOTS,
      pos = { segment: a.version, offset: Math.floor(a.offset / unit) },
      row = Math.floor((a.offset % unit) / ROW_SLOTS),
      item = a.offset % ROW_SLOTS;
    if (!equal(a, this.cursor(request, pos, row, item))) fail();
    return { pos, row, item };
  }
  private *records(
    row: JournalRow,
    request: ListRequest,
    budget: HistoryReadBudget,
    from: number,
  ): Generator<{ item: number; record: HistoryRecord }> {
    const v = row.value,
      snapshot = request.snapshotSeq;
    if (snapshot === null) fail();
    if (
      request.reader === "tasks" &&
      v.kind === "admission" &&
      v.intent.identity.kind === "action" &&
      v.intent.identity.action.kind === "create" &&
      v.intent.createdTaskId
    ) {
      const record = this.entityAt(
        v.intent.createdTaskId,
        "task",
        snapshot,
        budget,
      );
      if (record && from === 0) yield { item: 0, record };
      return;
    }
    if (v.kind !== "capture" && v.kind !== "owner") return;
    if (
      !(request.reader === "runs" && request.scope.kind === "child") &&
      !fits(
        {
          ...v.link,
          childRunId: v.kind === "capture" ? v.link.childRunId : null,
        },
        request.scope,
      )
    )
      return;
    if (from > v.events.length * RECORD_SLOTS) fail();
    for (
      let index = Math.floor(from / RECORD_SLOTS);
      index < v.events.length;
      index++
    ) {
      budget.reserve(0);
      const e = v.events[index],
        out: HistoryRecord[] = [];
      if (
        e.kind === "end" &&
        e.detail.descriptor &&
        request.reader === "contents"
      )
        out.push(
          decodeHistoryRecord({
            kind: "content",
            owner: e.detail.owner,
            version: e.detail.content.version,
            detailId: e.detail.detailId,
            descriptor: e.detail.descriptor,
            content: e.detail.content,
            coverage: e.detail.coverage,
          }),
        );
      if (e.kind === "capture" && v.kind === "capture") {
        const event = e.value.event;
        if (request.reader === "events")
          out.push({
            kind: "capture-fact",
            recordId: e.id,
            committedSeq: row.seq,
            link: v.link,
            capture: e.value,
          });
        if (request.reader === "messages" && event.kind === "message-start") {
          const r = this.entityAt(event.messageId, "message", snapshot, budget);
          if (r) out.push(r);
        }
        // Each occurrence is emitted at its first observed public version only;
        // no source-ID/name/nearest-message join creates a missing start.
        if (
          request.reader === "tools" &&
          (event.kind === "call-declaration" ||
            event.kind === "tool-start" ||
            event.kind === "tool-end")
        ) {
          const rows = this.batches(event.callId, snapshot, budget);
          const initial = rows
            .flatMap((b) => b.rows)
            .find(
              (r) =>
                r.value.kind === "capture" &&
                r.value.events.some(
                  (x) =>
                    x.kind === "capture" &&
                    "callId" in x.value.event &&
                    x.value.event.callId === event.callId,
                ),
            );
          if (
            initial?.id === row.id &&
            v.events.findIndex(
              (x) =>
                x.kind === "capture" &&
                ["call-declaration", "tool-start", "tool-end"].includes(
                  x.value.event.kind,
                ) &&
                "callId" in x.value.event &&
                x.value.event.callId === event.callId,
            ) === index
          ) {
            const r = this.entityAt(event.callId, "tool", snapshot, budget);
            if (r) out.push(r);
          }
        }
        if (request.reader === "contents" && event.kind === "omitted-block") {
          const o = event.block.owner,
            kind =
              "messageId" in o ? "message" : "callId" in o ? "tool" : "child",
            id =
              "messageId" in o
                ? o.messageId
                : "callId" in o
                  ? o.callId
                  : v.link.childRunId;
          const version =
            kind === "child"
              ? 1
              : (this.entityAt(id, kind, snapshot, budget, undefined, e.id)
                  ?.version ?? 1);
          out.push(
            decodeHistoryRecord({
              kind: "omitted",
              owner: {
                taskId: v.link.taskId,
                runId: v.link.runId,
                childRunId: v.link.childRunId,
                entity: { kind, id, version },
              },
              version,
              block: event.block,
            }),
          );
        }
      }
      if (e.kind === "owner" && e.value.kind === "fact" && v.kind === "owner") {
        const fact = e.value.fact;
        if (request.reader === "runs" && fact.kind === "parent-admitted")
          out.push(
            ...this.runState(fact.runId, snapshot, budget)
              .projections(this.readEpoch())
              .filter((r) => fits(r, request.scope))
              .map((projection) => ({ kind: "run" as const, projection })),
          );
        if (
          request.reader === "events" ||
          (request.reader === "checks" &&
            ["check-start", "check-settled"].includes(fact.kind)) ||
          (request.reader === "changes" && fact.kind === "changes") ||
          (request.reader === "reviews" && fact.kind === "review")
        )
          out.push({
            kind: "owner-fact",
            recordId: e.id,
            committedSeq: row.seq,
            observedMs: v.observedMs,
            link: v.link,
            fact,
          });
      }
      for (const [ordinal, record] of out.entries()) {
        const item = index * RECORD_SLOTS + ordinal;
        if (item >= from) yield { item, record };
      }
    }
  }
  private async acceleratedPage(
    value: ListRequest,
    kind: ListRequest["reader"],
    budget = new HistoryReadBudget(),
  ): Promise<HistoryPage> {
    let request = decodeListRequest(value);
    if (request.navigation !== undefined) fail();
    if (
      request.reader !== kind ||
      request.storeId !== this.reader.storeId ||
      (request.scope.kind === "workspace" &&
        request.scope.id !== this.reader.files.format.workspaceId)
    )
      fail();
    const snapshot = request.snapshotSeq ?? this.navigation.latest(budget);
    this.navigation.snapshot(snapshot, budget);
    request = { ...request, snapshotSeq: snapshot };
    let { pos, row: rowIndex, item: itemIndex } = this.parseCursor(request);
    const records: HistoryRecord[] = [];
    let bytes = 2048,
      next: ListRequest | null = null,
      coverage = this.navigation.hasTail(snapshot, budget)
        ? { ...GAP, omissions: [...GAP.omissions] }
        : { ...COMPLETE, omissions: [...COMPLETE.omissions] };
    if (snapshot === "0")
      return decodeHistoryPage({ request, records, next, coverage });
    try {
      for (;;) {
        const b = this.navigation.next(pos, budget);
        if (!b || BigInt(b.pointer.seq) > BigInt(snapshot)) fail();
        if (rowIndex > b.rows.length) fail();
        for (; rowIndex < b.rows.length; rowIndex++, itemIndex = 0) {
          for (const item of this.records(
            b.rows[rowIndex],
            request,
            budget,
            itemIndex,
          )) {
            itemIndex = item.item;
            const record = item.record,
              size = Buffer.byteLength(canonicalJson(record));
            if (
              records.length >= request.limit ||
              bytes + size > LIMITS.pageBytes
            ) {
              next = {
                ...request,
                after: this.cursor(request, pos, rowIndex, itemIndex),
              };
              return decodeHistoryPage({ request, records, next, coverage });
            }
            bytes += size;
            records.push(record);
            itemIndex++;
            if (record.kind === "content")
              coverage = combineCoverage(coverage, record.coverage);
          }
        }
        if (b.pointer.seq === snapshot) break;
        pos = b.next;
        rowIndex = 0;
        itemIndex = 0;
        next = { ...request, after: this.cursor(request, pos, 0, 0) };
      }
      next = null;
    } catch (e) {
      if (!(e instanceof ContractError) || e.code !== "receipt-inconclusive")
        throw e;
      next = {
        ...request,
        after: this.cursor(request, pos, rowIndex, itemIndex),
      };
      if (equal(next.after, request.after)) throw e; // No silent rebasing or nonadvancing retry loop.
      coverage = combineCoverage(coverage, GAP);
    }
    return decodeHistoryPage({ request, records, next, coverage });
  }
  private acceleratedTasks = async (
    value: ListRequest,
    budget: HistoryReadBudget,
  ): Promise<HistoryPage> => {
    const initial = decodeListRequest(value);
    if (initial.navigation !== undefined) fail();
    const legacyVersion = Number.MAX_SAFE_INTEGER;
    if (
      initial.reader !== "tasks" ||
      initial.storeId !== this.reader.storeId ||
      initial.scope.id !== this.reader.files.format.workspaceId
    )
      fail();
    const legacyPhase = initial.after?.version === legacyVersion;
    const privatePage = legacyPhase
      ? null
      : await this.acceleratedPage(initial, "tasks", budget);
    if (privatePage?.next) return privatePage;
    const snapshot = privatePage?.request.snapshotSeq ?? initial.snapshotSeq;
    if (snapshot === null) fail();
    const request = { ...initial, snapshotSeq: snapshot };
    if (legacyPhase) this.navigation.snapshot(snapshot, budget);
    const cursor = (offset: number, identity: string) => {
      const digest = createHash("sha256")
        .update(
          canonicalJson({ ...request, after: null, legacy: identity, offset }),
        )
        .digest("hex");
      return {
        recordId: `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`,
        version: legacyVersion,
        offset,
      };
    };
    const records = [...(privatePage?.records ?? [])];
    const transition = () =>
      decodeHistoryPage({
        request,
        records,
        next: { ...request, after: cursor(0, "begin") },
        coverage: combineCoverage(privatePage?.coverage ?? COMPLETE, GAP),
      });
    if (records.length === request.limit) return transition();
    let legacy: readonly TaskRecord[];
    try {
      budget.reserve(0);
      legacy = this.environment.legacyTasks(budget);
    } catch (error) {
      if (!legacyPhase) return transition();
      throw error;
    }
    if (legacy.length > 1000) throw new ContractError("capacity");
    const items = [...legacy].sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
      ),
      digest = createHash("sha256");
    for (const item of items) {
      budget.reserve(0);
      if (Buffer.byteLength(item.goal) > 8192) fail();
      digest.update(
        JSON.stringify({
          id: item.id,
          revision: item.revision,
          goal: item.goal,
        }),
      );
    }
    const identity = digest.digest("hex");
    let offset = legacyPhase ? (initial.after?.offset ?? 0) : 0;
    if (
      offset > items.length ||
      (legacyPhase &&
        !equal(
          initial.after,
          cursor(offset, offset === 0 ? "begin" : identity),
        ))
    )
      fail();
    let bytes =
      2048 +
      records.reduce((n, r) => n + Buffer.byteLength(JSON.stringify(r)), 0);
    try {
      while (offset < items.length && records.length < request.limit) {
        budget.reserve(0);
        const task = items[offset];
        const record = decodeHistoryRecord({
          kind: "task",
          owner: {
            taskId: task.id,
            runId: null,
            childRunId: null,
            entity: { kind: "task", id: task.id, version: task.revision },
          },
          version: task.revision,
          goal: task.goal,
          plan: null,
        });
        const size = Buffer.byteLength(JSON.stringify(record));
        if (bytes + size > LIMITS.pageBytes) break;
        bytes += size;
        records.push(record);
        offset++;
      }
    } catch (error) {
      if (
        !(error instanceof ContractError) ||
        error.code !== "receipt-inconclusive" ||
        offset === (initial.after?.offset ?? 0)
      )
        throw error;
    }
    return decodeHistoryPage({
      request,
      records,
      next:
        offset < items.length
          ? {
              ...request,
              after: cursor(offset, offset === 0 ? "begin" : identity),
            }
          : null,
      coverage: legacy.length
        ? combineCoverage(privatePage?.coverage ?? COMPLETE, GAP)
        : (privatePage?.coverage ?? COMPLETE),
    });
  };
  private async page(
    value: ListRequest,
    kind: ListRequest["reader"],
  ): Promise<HistoryReadResult> {
    const request = decodeListRequest(value);
    if (request.reader !== kind || request.storeId !== this.reader.storeId)
      fail();
    if (request.navigation) return readRetainedList(this, request);
    const budget = new HistoryReadBudget(),
      completion =
        this.reader.files.format.schema === FORMAT
          ? new HistoryReadProof(this.reader.files).prepareCompletion(budget)
          : null;
    try {
      const result =
        kind === "tasks"
          ? await this.acceleratedTasks(request, budget)
          : await this.acceleratedPage(request, kind, budget);
      completion?.validate();
      return result;
    } catch (error) {
      if (
        !completion ||
        !(error instanceof ContractError) ||
        error.code !== "receipt-inconclusive"
      )
        throw error;
      const c =
        request.after && request.after.version !== Number.MAX_SAFE_INTEGER
          ? this.parseCursor(request)
          : null;
      return listPreparation(
        request,
        completion,
        c
          ? { pos: c.pos, row: c.row, event: c.item, byte: 0, snapshot: 0 }
          : undefined,
      );
    }
  }
  tasks = (r: ListRequest) => this.page(r, "tasks");
  runs = (r: ListRequest) => this.page(r, "runs");
  messages = (r: ListRequest) => this.page(r, "messages");
  tools = (r: ListRequest) => this.page(r, "tools");
  contents = (r: ListRequest) => this.page(r, "contents");
  events = (r: ListRequest) => this.page(r, "events");
  checks = (r: ListRequest) => this.page(r, "checks");
  changes = (r: ListRequest) => this.page(r, "changes");
  reviews = (r: ListRequest) => this.page(r, "reviews");
  search: ProjectionPort["search"] = (cursor) =>
    searchHistory(this.reader, cursor);
  export: ProjectionPort["export"] = (request, signal) =>
    exportHistory(this, request, signal);
  graph: ProjectionPort["graph"] = (r) => this.reader.graph(r);
  detail = (r: ReadCursor) => this.reader.readDetail(r);
  validateCursor = async (
    cursor: ReadCursor,
  ): ReturnType<ProjectionPort["validateCursor"]> => {
    try {
      if (cursor.storeId !== this.reader.storeId) fail();
      decodeCursor(cursor);
      // Only the named operation establishes membership. Do not run a second
      // independent detail/snapshot scan before the original read budget.
      return { status: "progress-needed" };
    } catch (error) {
      return {
        status: "refused",
        error: publicError(
          error instanceof ContractError ? error.code : "unavailable",
        ),
      };
    }
  };
  checkObligations = async (taskId: string): Promise<CheckObligations> =>
    this.environment.checkObligations?.(taskId) ??
    currentChecks(
      this.reader.files,
      taskId,
      this.environment.checks(taskId),
      this.environment.context(taskId),
    ).checks;
  snapshot = async (input: Scope): Promise<Snapshot> => {
    const scope = decodeScope(input),
      budget = new HistoryReadBudget(),
      seq = this.navigation.latest(budget),
      epoch = this.readEpoch();
    this.navigation.snapshot(seq, budget);
    let taskId = scope.kind === "task" ? scope.id : null;
    const active = this.navigation.active(seq, budget),
      groups: RunProjection[][] = [],
      seen = new Set<string>();
    const selected = (id: string) => {
      const group = this.runState(id, seq, budget)
        .projections(epoch)
        .filter((r) => fits(r, scope));
      if (group.length) {
        taskId = group[0].taskId;
        seen.add(id);
      }
      return group;
    };
    for (const a of active)
      if (
        scope.kind === "task"
          ? a.taskId === scope.id
          : scope.kind === "run"
            ? a.runId === scope.id
            : true
      ) {
        const group = selected(a.runId);
        if (group.length) groups.push(group);
      }
    if (!taskId) {
      for (const b of this.navigation.reverseBatches(scope.id, seq, budget)) {
        for (const row of b.rows)
          if (row.value.kind === "owner")
            for (const e of row.value.events)
              if (
                e.kind === "owner" &&
                e.value.kind === "fact" &&
                e.value.fact.kind === "parent-admitted"
              ) {
                const group = selected(e.value.fact.runId);
                if (group.length) {
                  groups.push(group);
                  break;
                }
              }
        if (taskId) break;
      }
    }
    if (!taskId) fail();
    const runs = groups.flat();
    const base = {
      protocol: 1,
      storeId: this.reader.storeId,
      epoch,
      scope,
      committedSeq: seq,
      horizon: {
        policy: "active-and-recent",
        historicalRuns: {
          reader: "runs",
          storeId: this.reader.storeId,
          scope,
          snapshotSeq: seq,
          after: null,
          limit: LIMITS.pageEntries,
        },
      },
    };
    let encodedBytes = Buffer.byteLength(JSON.stringify({ ...base, runs }));
    if (runs.length > 200 || encodedBytes > LIMITS.pageBytes)
      throw new ContractError("capacity");
    outer: for (const b of this.navigation.reverseBatches(
      scope.id,
      seq,
      budget,
      scope.kind === "task",
    ))
      for (const row of [...b.rows].reverse())
        if (row.value.kind === "owner")
          for (const e of [...row.value.events].reverse())
            if (
              e.kind === "owner" &&
              e.value.kind === "fact" &&
              e.value.fact.kind === "parent-admitted" &&
              !seen.has(e.value.fact.runId)
            ) {
              const group = selected(e.value.fact.runId);
              const groupBytes = Buffer.byteLength(JSON.stringify(group));
              if (
                runs.length + group.length > 200 ||
                encodedBytes + groupBytes > LIMITS.pageBytes
              )
                break outer;
              encodedBytes += groupBytes;
              runs.push(...group);
            }
    // Finish the original history quantum before the independently bounded current
    // checkout/model observation. Its synchronous cost must not expire a later
    // history read; neither budget is renewed and final Reply size is still checked.
    const context = decodeControlContext(this.environment.context(taskId));
    if (
      controlWorkspace(context) !== this.reader.files.format.workspaceId ||
      controlTask(context) !== taskId
    )
      fail();
    const snapshot = decodeSnapshot({ ...base, context, runs });
    for (const observer of this.snapshotObservers) {
      try {
        observer({
          scope: { ...snapshot.scope },
          committedSeq: snapshot.committedSeq,
          keys: snapshot.runs.map((r) => r.childRunId ?? r.runId),
        });
      } catch {
        /* Read observers cannot alter retained outcomes. */
      }
    }
    return snapshot;
  };
}
