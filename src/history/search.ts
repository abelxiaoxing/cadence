/** Literal retained search and the shared export traversal. Never reads a live
 * ring, a provider, private auth accounting, or an uncommitted artifact. */
import { createHash } from "node:crypto";
import {
  type CaptureCoverage,
  type ContentRef,
  ContractError,
  canonicalJson,
  decodeCursor,
  decodeHistoryRecord,
  decodeSearchPage,
  type ExportRequest,
  type GraphPage,
  type HistoryRecord,
  LIMITS,
  ownerInScope,
  parseWireJson,
  type ReadCursor,
  type RecordOwner,
  readIdentity,
  type SearchPage,
} from "../service-contract.ts";
import { HistoryReadBudget } from "./files.ts";
import {
  HistoryNavigation,
  type LocatedBatch,
  type Position,
} from "./navigation.ts";
import { HistoryReadProof } from "./read-proof.ts";
import type { HistoryReader } from "./reader.ts";
import {
  decodeRetainedProgress,
  type RetainedProgress,
} from "./retained-progress.ts";
import { RetainedTraversal } from "./retained-traversal.ts";
import {
  COMPLETE,
  captureCoverage,
  combineCoverage,
  FORMAT,
  type JournalRow,
  type RetainedDetail,
  type SavedEvent,
} from "./types.ts";

function bad(): never {
  throw new ContractError("corrupt-selected");
}
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const gap: CaptureCoverage = {
  ...COMPLETE,
  observed: "incomplete",
  omissions: ["gap"],
};
const BYTE_SLOTS = LIMITS.predecessorBytes + 1;
const SUBSLOTS = 2 * LIMITS.assignments + 2;
const EVENT_SLOTS = LIMITS.ownerQueueFrames * SUBSLOTS + 1;
const address = (p: Position) => {
  const n = (p.segment - 1) * LIMITS.segmentBytes + p.offset + 1;
  if (!Number.isSafeInteger(n) || n < 1) throw new ContractError("capacity");
  return n;
};
const position = (n: number): Position => ({
  segment: Math.floor((n - 1) / LIMITS.segmentBytes) + 1,
  offset: (n - 1) % LIMITS.segmentBytes,
});
const uuid = (digits: string) => {
  const s = `${digits.slice(0, 12)}4${digits.slice(12, 15)}8${digits.slice(15)}`;
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
};
const digits = (id: string) => {
  const s = id.replaceAll("-", "");
  return s.slice(0, 12) + s.slice(13, 16) + s.slice(17);
};
export const publicTextRef = (
  id: string,
  label: string,
  text: string,
  field: ContentRef["field"],
  batch: LocatedBatch,
  row: JournalRow,
  slot: number,
): ContentRef => ({
  recordId: uuid(
    address(batch.pointer).toString(16).padStart(14, "0") +
      createHash("sha256").update(`${id}/${label}`).digest("hex").slice(0, 16),
  ),
  version: batch.rows.indexOf(row) * EVENT_SLOTS + slot + 1,
  field,
  bytes: Buffer.byteLength(text),
  sha256: createHash("sha256").update(text).digest("hex"),
});
export interface ScanPoint {
  pos: Position;
  row: number;
  event: number;
  byte: number;
  snapshot: number;
}
const initial = (): ScanPoint => ({
  pos: { segment: 1, offset: 0 },
  row: 0,
  event: 0,
  byte: 0,
  snapshot: 0,
});
/** The finite cursor stores a source position and a verified snapshot position.
 * Its digest binds the entire navigation context, not authentication. No RAM or
 * writable cursor registry is necessary, including on zero-hit pages. */
export function scanCursor(base: ReadCursor, p: ScanPoint): ReadCursor {
  const version = address(p.pos),
    offset = (p.row * EVENT_SLOTS + p.event) * BYTE_SLOTS + p.byte;
  if (!Number.isSafeInteger(offset)) throw new ContractError("capacity");
  const snapshot = p.snapshot.toString(16).padStart(14, "0");
  if (snapshot.length !== 14) throw new ContractError("capacity");
  const binding = createHash("sha256")
    .update(
      canonicalJson({
        ...readIdentity(base),
        recordId: null,
        recordVersion: version,
        field: "context",
        offset,
        snapshot,
      }),
    )
    .digest("hex")
    .slice(0, 16);
  return {
    ...readIdentity(base),
    recordId: uuid(snapshot + binding),
    recordVersion: version,
    field: "context",
    offset,
  };
}
export function parseScanCursor(base: ReadCursor): ScanPoint {
  if (base.recordId === null) {
    if (base.offset !== 0) bad();
    return initial();
  }
  const raw = digits(base.recordId),
    snapshot = Number.parseInt(raw.slice(0, 14), 16);
  if (!Number.isSafeInteger(snapshot) || !base.recordVersion) bad();
  const slot = Math.floor(base.offset / BYTE_SLOTS);
  const p = {
    pos: position(base.recordVersion),
    row: Math.floor(slot / EVENT_SLOTS),
    event: slot % EVENT_SLOTS,
    byte: base.offset % BYTE_SLOTS,
    snapshot,
  };
  if (
    p.row > LIMITS.segmentRecords ||
    !equal(scanCursor(base, p), readIdentity(base))
  )
    bad();
  return p;
}
export type RetainedItem =
  | {
      kind: "text";
      owner: RecordOwner;
      content: ContentRef;
      start: number;
      text: string;
      coverage: CaptureCoverage;
      inline?: true;
    }
  | { kind: "end"; detail: RetainedDetail; owner: RecordOwner }
  | { kind: "record"; record: HistoryRecord }
  | { kind: "graph"; graph: GraphPage };

/** One bounded source batch and one selected artifact, not a transcript map.
 * Detail metadata lookahead uses the SAME native-IO/time budget as traversal. */
export class RetainedScan {
  readonly nav: HistoryNavigation;
  readonly traversal?: RetainedTraversal;
  private artifact?: { key: string; bytes: Buffer };
  private ends = new Map<string, RetainedDetail>();
  private admission?: {
    runId: string;
    taskId: string;
    childRunId: string | null;
    plan: ContentRef | null;
  };
  coverage: CaptureCoverage = { ...COMPLETE, omissions: [] };
  constructor(
    readonly reader: HistoryReader,
    readonly request: Pick<ExportRequest, "storeId" | "scope" | "snapshotSeq">,
    public budget: HistoryReadBudget,
    progress?: RetainedProgress | true,
  ) {
    this.request = {
      storeId: request.storeId,
      scope: { ...request.scope },
      snapshotSeq: request.snapshotSeq,
    };
    if (request.storeId !== reader.storeId) bad();
    this.nav = new HistoryNavigation(reader.files);
    if (progress) {
      this.traversal = new RetainedTraversal(
        reader.files,
        request.snapshotSeq,
        budget,
        progress === true ? undefined : progress,
      );
      this.coverage = this.traversal.state.coverage;
    }
  }
  /** Establish a real snapshot incrementally when every accelerator is absent.
   * Before it is established, callers return only advancing zero-hit pages. */
  renew(budget: HistoryReadBudget): void {
    this.budget = budget;
    this.artifact = undefined;
    this.traversal?.renew(budget);
  }
  checkpoint(): RetainedProgress {
    if (!this.traversal) bad();
    this.traversal.state.coverage = this.coverage;
    return this.traversal.checkpoint();
  }
  prepare(p: ScanPoint): boolean {
    if (this.traversal) {
      this.traversal.prepare(p);
      return true;
    }
    this.reader.files.assertReadFormat(this.budget);
    if (this.request.snapshotSeq === "0") return true;
    if (p.snapshot) {
      this.nav.snapshotAt(
        position(p.snapshot),
        this.request.snapshotSeq,
        this.budget,
      );
      return true;
    }
    if (p.pos.segment === 1 && p.pos.offset === 0) {
      const hint = this.nav.snapshotHint(this.request.snapshotSeq, this.budget);
      if (hint) {
        p.snapshot = address(hint);
        return true;
      }
    }
    for (;;) {
      const b = this.nav.next(p.pos, this.budget);
      if (!b || BigInt(b.pointer.seq) > BigInt(this.request.snapshotSeq)) bad();
      if (b.pointer.seq === this.request.snapshotSeq) {
        this.nav.snapshotAt(b.pointer, this.request.snapshotSeq, this.budget);
        p.snapshot = address(b.pointer);
        p.pos = { segment: 1, offset: 0 };
        return true;
      }
      p.pos = b.next;
    }
  }
  private fits(link: {
    taskId: string;
    runId: string | null;
    childRunId?: string | null;
  }): boolean {
    const s = this.request.scope;
    return s.kind === "task"
      ? s.id === link.taskId
      : s.kind === "run"
        ? s.id === link.runId
        : s.id === link.childRunId;
  }
  private selectedAdmission() {
    if (this.admission) return this.admission;
    const s = this.request.scope;
    if (s.kind === "task") return undefined;
    if (this.traversal) {
      const source = this.traversal.admitted(s);
      if (!source) return;
      const admission = this.reader.files.readAdmission(
        source.runId,
        source.identity,
        this.budget,
      );
      this.admission = {
        runId: source.runId,
        taskId: source.taskId,
        childRunId: s.kind === "child" ? s.id : null,
        plan: admission.graph?.plan ?? null,
      };
      return this.admission;
    }
    for (const b of this.nav.reverseBatches(
      s.id,
      this.request.snapshotSeq,
      this.budget,
    ))
      for (const row of b.rows)
        if (row.value.kind === "owner")
          for (const e of row.value.events)
            if (
              e.kind === "owner" &&
              e.value.kind === "fact" &&
              e.value.fact.kind === "parent-admitted"
            ) {
              const f = e.value.fact;
              if (
                s.kind === "run"
                  ? f.runId !== s.id
                  : !f.identity.assignments.some((a) => a.childRunId === s.id)
              )
                continue;
              const a = this.reader.files.readAdmission(
                f.runId,
                f.identity,
                this.budget,
              );
              this.admission = {
                runId: f.runId,
                taskId: row.value.link.taskId,
                childRunId: s.kind === "child" ? s.id : null,
                plan: a.graph?.plan ?? null,
              };
              return this.admission;
            }
    return undefined;
  }
  /** A frozen graph can select a task-owned plan. Only that exact reference is
   * projected into the selected run/child; entity and content versions survive. */
  scopedOwner(detail: RetainedDetail): RecordOwner | undefined {
    if (ownerInScope(detail.owner, this.request.scope)) return detail.owner;
    if (
      detail.owner.entity.kind !== "task" ||
      detail.content.field !== "plan" ||
      detail.owner.runId !== null
    )
      return;
    const selected = this.selectedAdmission();
    if (
      selected?.taskId === detail.owner.taskId &&
      equal(selected.plan, detail.content)
    )
      return {
        taskId: detail.owner.taskId,
        runId: selected.runId,
        childRunId: selected.childRunId,
        // The frozen selection belongs to the immutable run/child occurrence,
        // not a task entity relabelled with an invalid run link. The original
        // task/plan identity remains in the exported graph and retained detail.
        entity: {
          kind: selected.childRunId ? "child" : "run",
          id: selected.childRunId ?? selected.runId,
          version: 1,
        },
      };
  }
  private assertDetail(
    detail: RetainedDetail,
    value: Extract<JournalRow["value"], { kind: "capture" | "owner" }>,
  ) {
    const child = value.kind === "capture" ? value.link.childRunId : null;
    if (
      detail.origin.kind !== (value.kind === "capture" ? "worker" : "owner") ||
      detail.origin.id !==
        (value.kind === "capture"
          ? value.link.childRunId
          : value.link.operationId) ||
      detail.owner.taskId !== value.link.taskId ||
      detail.owner.runId !== value.link.runId ||
      detail.owner.childRunId !== child
    )
      bad();
    if (detail.descriptor)
      decodeHistoryRecord({
        kind: "content",
        owner: detail.owner,
        version: detail.content.version,
        detailId: detail.detailId,
        descriptor: detail.descriptor,
        content: detail.content,
        coverage: detail.coverage,
      });
  }
  private ending(id: string, batch: LocatedBatch): RetainedDetail | undefined {
    if (this.traversal) return this.traversal.ending({ id });
    const old = this.ends.get(id);
    if (old) return old;
    const indexed = this.nav.content(id, this.request.snapshotSeq, this.budget);
    if (indexed) {
      this.remember(indexed);
      return indexed;
    }
    let b: LocatedBatch | null = batch;
    for (;;) {
      for (const row of b.rows)
        if (row.value.kind === "capture" || row.value.kind === "owner")
          for (const e of row.value.events)
            if (e.kind === "end" && e.detail.content.recordId === id) {
              this.remember(e.detail);
              return e.detail;
            }
      if (b.pointer.seq === this.request.snapshotSeq) return;
      b = this.nav.next(b.next, this.budget);
      if (!b || BigInt(b.pointer.seq) > BigInt(this.request.snapshotSeq)) bad();
    }
  }
  private remember(detail: RetainedDetail) {
    if (this.ends.size >= LIMITS.ownerQueueFrames)
      this.ends.delete(this.ends.keys().next().value ?? "");
    this.ends.set(detail.content.recordId, detail);
  }
  private hasEnd(
    batch: LocatedBatch,
    detailId: string,
    origin: RetainedDetail["origin"],
  ): boolean {
    if (this.traversal) return !!this.traversal.ending({ detailId, origin });
    for (const d of this.ends.values())
      if (d.detailId === detailId && equal(d.origin, origin)) return true;
    let b: LocatedBatch | null = batch;
    for (;;) {
      for (const row of b.rows) {
        this.budget.reserve(0);
        if (row.value.kind !== "capture" && row.value.kind !== "owner")
          continue;
        for (const e of row.value.events)
          if (
            e.kind === "end" &&
            e.detail.detailId === detailId &&
            equal(e.detail.origin, origin)
          ) {
            this.remember(e.detail);
            return true;
          }
      }
      if (b.pointer.seq === this.request.snapshotSeq) return false;
      b = this.nav.next(b.next, this.budget);
      if (!b || BigInt(b.pointer.seq) > BigInt(this.request.snapshotSeq)) bad();
    }
  }
  private bytes(e: Extract<SavedEvent, { kind: "chunk" }>): Buffer {
    const key = canonicalJson(e.artifact);
    if (this.artifact?.key !== key)
      this.artifact = {
        key,
        bytes: this.reader.files.readArtifact(e.artifact, this.budget),
      };
    return this.artifact.bytes.subarray(e.start, e.start + e.length);
  }
  /** Literal overlap is fetched only from the SAME content field and exact next
   * stored offsets, never from adjacent unrelated event text. */
  overlap(
    e: Extract<SavedEvent, { kind: "chunk" }>,
    batch: LocatedBatch,
    length: number,
  ): Buffer {
    if (this.traversal) {
      const row = batch.rows.find(
        (row) =>
          (row.value.kind === "owner" || row.value.kind === "capture") &&
          row.value.events.includes(e),
      );
      if (!row || (row.value.kind !== "owner" && row.value.kind !== "capture"))
        bad();
      return this.traversal.overlap(e, length, row.value.link, (next) =>
        this.bytes(next),
      );
    }
    const pieces: Buffer[] = [];
    if (!length) return Buffer.alloc(0);
    let end = e.offset + e.length,
      remaining = length,
      b: LocatedBatch | null = batch;
    for (;;) {
      for (const row of b.rows)
        if (row.value.kind === "capture" || row.value.kind === "owner")
          for (const next of row.value.events)
            if (
              next.kind === "chunk" &&
              next.artifact.artifactId === e.artifact.artifactId &&
              next.offset >= end
            ) {
              if (next.offset !== end) bad();
              const bytes = this.bytes(next).subarray(0, remaining);
              pieces.push(bytes);
              remaining -= bytes.length;
              end += bytes.length;
              if (!remaining) return Buffer.concat(pieces);
            }
      if (b.pointer.seq === this.request.snapshotSeq)
        return Buffer.concat(pieces);
      b = this.nav.next(b.next, this.budget);
      if (!b || BigInt(b.pointer.seq) > BigInt(this.request.snapshotSeq)) bad();
    }
  }
  /** Item lookup is lazy; caller advances the point only after consuming an item. */
  item(
    batch: LocatedBatch,
    row: JournalRow,
    event: number,
  ): RetainedItem | undefined {
    const v = row.value,
      sub = event % SUBSLOTS;
    event = Math.floor(event / SUBSLOTS);
    if (v.kind === "recovery") {
      this.coverage = combineCoverage(this.coverage, gap);
      return;
    }
    if (
      v.kind === "admission" &&
      event === 0 &&
      v.intent.identity.kind === "action" &&
      v.intent.identity.action.kind === "create" &&
      v.intent.createdTaskId
    ) {
      let owner: RecordOwner = {
        taskId: v.intent.createdTaskId,
        runId: null,
        childRunId: null,
        entity: { kind: "task", id: v.intent.createdTaskId, version: 1 },
      };
      if (!this.fits(owner)) {
        const selected = this.selectedAdmission();
        if (selected?.taskId !== owner.taskId) return;
        owner = {
          taskId: owner.taskId,
          runId: selected.runId,
          childRunId: selected.childRunId,
          entity: {
            kind: selected.childRunId ? "child" : "run",
            id: selected.childRunId ?? selected.runId,
            version: 1,
          },
        };
      }
      const text = v.intent.identity.action.goal;
      if (sub === 0 && owner.entity.kind === "task")
        return {
          kind: "record",
          record: { kind: "task", owner, version: 1, goal: text, plan: null },
        };
      if (sub === 1)
        return {
          kind: "text",
          owner,
          content: publicTextRef(
            row.id,
            "goal",
            text,
            "context",
            batch,
            row,
            1,
          ),
          start: 0,
          text,
          inline: true,
          coverage: COMPLETE,
        };
      return;
    }
    // Accepted saved graphs are retained documents, not Start authority. Their
    // independent publication facts remain in this same export (including failures).
    if (
      v.kind === "admission" &&
      event === 0 &&
      sub === 0 &&
      v.intent.identity.kind === "action" &&
      v.intent.identity.action.kind === "save-plan" &&
      this.request.scope.kind === "task" &&
      v.intent.identity.action.taskId === this.request.scope.id
    ) {
      const graph = v.intent.identity.action.graph;
      return {
        kind: "graph",
        graph: {
          request: {
            ...this.request,
            graph: {
              recordId: v.intent.operationId,
              revision: graph.revision,
              sha256: createHash("sha256")
                .update(canonicalJson(graph))
                .digest("hex"),
            },
          },
          graph,
        },
      };
    }
    if (v.kind !== "capture" && v.kind !== "owner") return;
    const e = v.events[event];
    if (!e) return;
    if (sub === 0 && this.fits(v.link)) {
      const detailId =
        e.kind === "capture" && e.value.event.kind === "detail-begin"
          ? e.value.event.detailId
          : e.kind === "owner" && e.value.kind === "content-begin"
            ? e.value.detailId
            : null;
      if (
        detailId &&
        !this.hasEnd(batch, detailId, {
          kind: v.kind === "capture" ? "worker" : "owner",
          id: v.kind === "capture" ? v.link.childRunId : v.link.operationId,
        })
      )
        this.coverage = combineCoverage(this.coverage, gap);
    }
    if (e.kind === "chunk" && sub === 0) {
      // Reject siblings before opening their artifacts or looking ahead.
      if (!this.fits(v.link) && !(v.kind === "owner" && v.link.runId === null))
        return;
      const detail = this.ending(e.artifact.artifactId, batch);
      if (!detail) {
        this.coverage = combineCoverage(this.coverage, gap);
        return;
      }
      this.assertDetail(detail, v);
      const owner = this.scopedOwner(detail);
      if (!owner) return;
      if (
        detail.detailId !== e.detailId ||
        e.offset + e.length > detail.content.bytes
      )
        bad();
      const bytes = this.bytes(e);
      return {
        kind: "text",
        owner,
        content: detail.content,
        start: e.offset,
        text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        coverage: detail.coverage,
      };
    }
    if (e.kind === "end" && sub === 0) {
      const owner = this.scopedOwner(e.detail);
      if (!owner) return;
      this.coverage = combineCoverage(this.coverage, e.detail.coverage);
      this.assertDetail(e.detail, v);
      return { kind: "end", detail: e.detail, owner };
    }
    if (
      e.kind === "capture" &&
      sub === 0 &&
      v.kind === "capture" &&
      this.fits(v.link)
    ) {
      const observed = captureCoverage(e.value.event);
      if (observed) this.coverage = combineCoverage(this.coverage, observed);
      return {
        kind: "record",
        record: {
          kind: "capture-fact",
          recordId: e.id,
          committedSeq: row.seq,
          link: v.link,
          capture: e.value,
        },
      };
    }
    if (e.kind === "owner" && e.value.kind === "fact" && v.kind === "owner") {
      const fact = e.value.fact;
      if (
        fact.kind === "parent-admitted" &&
        sub === 1 &&
        (this.fits(v.link) ||
          (this.request.scope.kind === "child" &&
            fact.identity.assignments.some(
              (a) => a.childRunId === this.request.scope.id,
            )))
      ) {
        const admission = this.reader.files.readAdmission(
          fact.runId,
          fact.identity,
          this.budget,
        );
        if (admission.graph && fact.identity.graph)
          return {
            kind: "graph",
            graph: {
              request: { ...this.request, graph: fact.identity.graph },
              graph: admission.graph,
            },
          };
      }
      if (
        fact.kind === "handoff" &&
        sub > 0 &&
        (this.fits(v.link) ||
          (this.request.scope.kind === "child" &&
            fact.childRunId === this.request.scope.id))
      ) {
        const i = Math.floor((sub - 1) / 2),
          h = fact.handoff.inputs[i];
        if (!h) return;
        const owner: RecordOwner = {
          taskId: v.link.taskId,
          runId: v.link.runId,
          childRunId: fact.childRunId,
          entity: { kind: "child", id: fact.childRunId, version: 1 },
        };
        const content = publicTextRef(
          e.id,
          `handoff/${i}`,
          h.text,
          "context",
          batch,
          row,
          event * SUBSLOTS + i * 2 + 2,
        );
        if (sub % 2)
          return {
            kind: "record",
            record: {
              kind: "content",
              owner,
              version: content.version,
              detailId: content.recordId,
              descriptor: {
                owner: {
                  kind: "handoff",
                  dependencyIndex: h.dependencyIndex,
                  source: h.result,
                },
                field: "context",
                encoding: "utf8",
              },
              content,
              coverage: h.coverage,
            },
          };
        return {
          kind: "text",
          owner,
          content,
          start: 0,
          text: h.text,
          inline: true,
          coverage: h.coverage,
        };
      }
      if (sub === 0 && this.fits(v.link))
        return {
          kind: "record",
          record: {
            kind: "owner-fact",
            recordId: e.id,
            committedSeq: row.seq,
            observedMs: v.observedMs,
            link: v.link,
            fact,
          },
        };
    }
  }
  inline(cursor: ReadCursor): RetainedItem | undefined {
    if (!cursor.recordId || !cursor.recordVersion || cursor.field !== "context")
      return;
    const at = Number.parseInt(digits(cursor.recordId).slice(0, 14), 16);
    if (!Number.isSafeInteger(at) || at < 1) return;
    const b = this.traversal
      ? this.traversal.snapshotBatch(position(at))
      : this.nav.next(position(at), this.budget);
    if (!b || BigInt(b.pointer.seq) > BigInt(cursor.snapshotSeq)) return;
    // An inline field carries its own original source address. When it also
    // names the requested boundary, validate that exact original batch rather
    // than rescanning an unrelated archive prefix. Otherwise normal snapshot
    // membership (or explicit inconclusive fallback) still applies.
    if (!this.traversal) {
      if (b.pointer.seq === cursor.snapshotSeq)
        this.nav.snapshotAt(b.pointer, cursor.snapshotSeq, this.budget);
      else this.nav.snapshot(cursor.snapshotSeq, this.budget);
    }
    const row = Math.floor((cursor.recordVersion - 1) / EVENT_SLOTS),
      slot = (cursor.recordVersion - 1) % EVENT_SLOTS;
    if (!b.rows[row]) bad();
    const item = this.item(b, b.rows[row], slot);
    if (
      item?.kind === "text" &&
      item.content.recordId === cursor.recordId &&
      item.content.version === cursor.recordVersion
    )
      return item;
  }
  count(row: JournalRow): number {
    return row.value.kind === "capture" || row.value.kind === "owner"
      ? row.value.events.length * SUBSLOTS
      : SUBSLOTS;
  }
  advance(row: JournalRow, event: number): number {
    const v = row.value,
      sub = event % SUBSLOTS;
    const e =
      v.kind === "capture" || v.kind === "owner"
        ? v.events[Math.floor(event / SUBSLOTS)]
        : undefined;
    const extra =
      v.kind === "admission"
        ? 1
        : e?.kind === "owner" && e.value.kind === "fact"
          ? e.value.fact.kind === "handoff"
            ? e.value.fact.handoff.inputs.length * 2
            : e.value.fact.kind === "parent-admitted"
              ? 1
              : 0
          : 0;
    return sub < extra
      ? event + 1
      : (Math.floor(event / SUBSLOTS) + 1) * SUBSLOTS;
  }
  next(p: ScanPoint): LocatedBatch | null {
    if (this.traversal) return this.traversal.next(p);
    if (this.request.snapshotSeq === "0") return null;
    const b = this.nav.next(p.pos, this.budget);
    if (
      !b ||
      BigInt(b.pointer.seq) > BigInt(this.request.snapshotSeq) ||
      p.row > b.rows.length
    )
      bad();
    return b;
  }
  finish(): void {
    if (this.traversal) {
      this.traversal.finish();
      this.coverage = combineCoverage(
        this.coverage,
        this.traversal.state.coverage,
      );
      return;
    }
    // Tail uncertainty is independent of traversal reaching its pinned watermark.
    if (this.nav.hasTail(this.request.snapshotSeq, this.budget))
      this.coverage = combineCoverage(this.coverage, gap);
  }
}

export async function searchHistory(
  reader: HistoryReader,
  value: ReadCursor,
  limit: number = LIMITS.pageEntries,
): Promise<SearchPage> {
  const cursor = decodeCursor(value);

  if (
    !cursor.query ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > LIMITS.maxPageEntries
  )
    throw new ContractError("invalid");
  const p = parseScanCursor(cursor),
    originalBudget = new HistoryReadBudget();
  const finite = reader.files.format.schema === FORMAT;
  if (!finite && cursor.navigation !== undefined) bad();
  const proof = new HistoryReadProof(reader.files),
    completion = finite ? proof.prepareCompletion(originalBudget) : undefined;
  const progress =
    cursor.navigation === undefined
      ? undefined
      : decodeRetainedProgress(
          parseWireJson(
            new TextDecoder("utf-8", { fatal: true }).decode(
              proof.open(
                { purpose: "search", request: cursor },
                cursor.navigation,
                originalBudget,
              ),
            ),
            6000,
          ),
        );
  if (finite && !progress && cursor.recordId !== null) bad();
  // Leave byte/time headroom for current-key/source guards and the full envelope.
  const budget = new HistoryReadBudget();
  budget.reserve = (bytes) => {
    if (originalBudget.bytes + bytes > LIMITS.searchBytes - 8192)
      throw new ContractError("receipt-inconclusive");
    originalBudget.reserve(bytes);
  };
  const scan = new RetainedScan(
      reader,
      cursor,
      budget,
      finite ? (progress ?? true) : undefined,
    ),
    query = Buffer.from(cursor.query);
  const coordinate = () =>
    canonicalJson({ p, state: finite ? scan.checkpoint() : null });
  const before = coordinate();
  const hits: SearchPage["hits"] = [];
  let done = false,
    encoded = Buffer.byteLength(canonicalJson(cursor)) + 20 * 1024;
  try {
    scan.prepare(p);
    outer: for (;;) {
      const b = scan.next(p);
      if (!b) {
        done = true;
        break;
      }
      for (; p.row < b.rows.length; p.row++, p.event = 0) {
        const row = b.rows[p.row],
          count = scan.count(row);
        if (p.event > count) bad();
        for (
          ;
          p.event < count;
          p.event = scan.advance(row, p.event), p.byte = 0
        ) {
          budget.reserve(0);
          const item = scan.item(b, row, p.event);
          if (item?.kind !== "text") continue;
          scan.coverage = combineCoverage(scan.coverage, item.coverage);
          const body = Buffer.from(item.text);
          if (p.byte > body.length || (body[p.byte] & 0xc0) === 0x80) bad();
          const e =
            row.value.kind === "capture" || row.value.kind === "owner"
              ? row.value.events[Math.floor(p.event / SUBSLOTS)]
              : undefined;
          const tail =
            e?.kind === "chunk" && query.length > 1
              ? scan.overlap(
                  e,
                  b,
                  Math.min(
                    query.length - 1,
                    item.content.bytes - item.start - body.length,
                  ),
                )
              : Buffer.alloc(0);
          const text = Buffer.concat([body, tail]);
          for (;;) {
            budget.reserve(0);
            const at = text.indexOf(query, p.byte);
            if (at < 0 || at >= body.length) break;
            const start = item.start + at,
              hit = {
                owner: item.owner,
                content: item.content,
                range: { start, end: start + query.length },
                preview: cursor.query,
                cursor: {
                  ...readIdentity(cursor),
                  recordId: item.content.recordId,
                  recordVersion: item.content.version,
                  field: item.content.field,
                  offset: start,
                },
              };
            const size = Buffer.byteLength(canonicalJson(hit));
            if (
              hits.length >= limit ||
              encoded + size > LIMITS.pageBytes - 4096
            ) {
              p.byte = at;
              break outer;
            }
            hits.push(hit);
            encoded += size;
            p.byte = at + 1;
            while (p.byte < body.length && (body[p.byte] & 0xc0) === 0x80)
              p.byte++;
          }
        }
      }
      if (b.pointer.seq === cursor.snapshotSeq) {
        done = true;
        break;
      }
      p.pos = b.next;
      p.row = 0;
      p.event = 0;
      p.byte = 0;
    }
    if (done) scan.finish();
  } catch (error) {
    if (
      !(error instanceof ContractError) ||
      error.code !== "receipt-inconclusive"
    )
      throw error;
    if (!hits.length && before === coordinate()) throw error;
    done = false;
  }
  scan.traversal?.assertCurrent();
  const next = done ? null : scanCursor(cursor, p);
  if (next && completion)
    next.navigation = completion.seal(
      { purpose: "search", request: next },
      Buffer.from(canonicalJson(scan.checkpoint(), 6000)),
    );
  else completion?.validate();
  return decodeSearchPage({ cursor, hits, next, coverage: scan.coverage });
}
