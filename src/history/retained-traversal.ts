import { createHash } from "node:crypto";
import {
  type CaptureCoverage,
  ContractError,
  canonicalJson,
  type RunIdentity,
  type Scope,
} from "../service-contract.ts";
import type { HistoryFiles, HistoryReadBudget } from "./files.ts";
import type { LocatedBatch, Pointer } from "./navigation.ts";
import { assertIncarnation, reproveAppend } from "./read-io.ts";
import {
  decodeRetainedProgress,
  freshProgress,
  type RetainedProgress,
} from "./retained-progress.ts";
import type { ScanPoint } from "./search.ts";
import { ResumableSha256 } from "./sha256-state.ts";
import {
  COMPLETE,
  combineCoverage,
  type RetainedDetail,
  type SavedEvent,
} from "./types.ts";
import { ForwardValidator } from "./validator.ts";

function bad(): never {
  throw new ContractError("corrupt-selected");
}
const fingerprint = (v: unknown) =>
  createHash("sha256").update(canonicalJson(v)).digest("hex");
const ready = (v: ForwardValidator): Pointer => {
  const s = v.state;
  if (s.phase !== "ready") bad();
  return {
    segment: s.segment,
    offset: s.start,
    bytes: s.end - s.start,
    seq: String(s.committed),
  };
};
const gap: CaptureCoverage = {
  ...COMPLETE,
  observed: "incomplete",
  omissions: ["gap"],
};
export class RetainedTraversal {
  readonly state: RetainedProgress;
  private proof: ForwardValidator;
  private worker?: ForwardValidator;
  private batches = new WeakMap<
    ForwardValidator,
    { pointer: string; batch: LocatedBatch }
  >();
  constructor(
    readonly files: HistoryFiles,
    readonly snapshotSeq: string,
    public budget: HistoryReadBudget,
    state = freshProgress(),
  ) {
    this.state = decodeRetainedProgress(state);
    this.proof = new ForwardValidator(files, this.state.proof);
    if (this.state.work)
      this.worker = new ForwardValidator(files, this.state.work.proof);
    this.revalidate();
  }
  private revalidate(): void {
    this.proof.revalidate(this.budget);
    this.worker?.revalidate(this.budget);
    for (const w of [this.state.snapshot, this.state.end, this.state.admission])
      if (w)
        w.stamp = reproveAppend(
          this.files,
          this.files.segmentPath(w.pointer.segment),
          w.stamp,
          w.pointer.offset + w.pointer.bytes,
          w.sha256,
          this.budget,
        );
  }
  checkpoint(): RetainedProgress {
    this.state.proof = this.proof.checkpoint();
    if (this.state.work && this.worker)
      this.state.work.proof = this.worker.checkpoint();
    return structuredClone(this.state);
  }
  assertCurrent(): void {
    this.proof.assertCurrent();
    this.worker?.assertCurrent();
    for (const w of [this.state.snapshot, this.state.end, this.state.admission])
      if (w)
        assertIncarnation(
          this.files,
          this.files.segmentPath(w.pointer.segment),
          w.stamp,
        );
  }
  renew(budget: HistoryReadBudget): void {
    this.budget = budget;
    this.revalidate();
  }
  private current(v: ForwardValidator): LocatedBatch | null {
    const p = v.state.phase === "ready" ? ready(v) : v.next(this.budget);
    if (!p) return null;
    if (BigInt(p.seq) > BigInt(this.snapshotSeq)) bad();
    const id = canonicalJson(p),
      cached = this.batches.get(v);
    if (cached?.pointer === id) {
      v.assertCurrent();
      return cached.batch;
    }
    const batch = v.batch(p, this.budget);
    this.batches.set(v, { pointer: id, batch });
    return batch;
  }
  prepare(p: ScanPoint): void {
    this.files.assertReadFormat(this.budget);
    if (this.state.phase !== "snapshot") {
      this.assertCurrent();
      return;
    }
    if (this.snapshotSeq === "0") {
      this.state.phase = "output";
      return;
    }
    for (;;) {
      const pointer = this.proof.next(this.budget);
      if (!pointer || BigInt(pointer.seq) > BigInt(this.snapshotSeq)) bad();
      if (pointer.seq === this.snapshotSeq) {
        this.state.snapshot = {
          pointer,
          stamp: this.proof.state.stamp,
          sha256: new ResumableSha256(this.proof.state.raw).digest(),
        };
        this.state.phase = "output";
        this.proof = new ForwardValidator(this.files);
        p.pos = { segment: 1, offset: 0 };
        p.row = 0;
        p.event = 0;
        p.byte = 0;
        // Existing public coordinate remains a locator, never the proof.
        p.snapshot = (pointer.segment - 1) * 8388608 + pointer.offset + 1;
        return;
      }
    }
  }
  snapshotBatch(pos: {
    segment: number;
    offset: number;
  }): LocatedBatch | undefined {
    const witness = this.state.snapshot;
    if (
      !witness ||
      witness.pointer.segment !== pos.segment ||
      witness.pointer.offset !== pos.offset
    )
      return;
    this.assertCurrent();
    return this.proof.batch(witness.pointer, this.budget);
  }
  next(p: ScanPoint): LocatedBatch | null {
    if (this.snapshotSeq === "0") return null;
    if (this.state.phase === "finish" || this.state.phase === "done")
      return null;
    if (this.proof.state.phase === "ready") {
      const q = ready(this.proof);
      if (p.pos.segment === q.segment && p.pos.offset === q.offset + q.bytes)
        this.proof.next(this.budget);
    }
    const b = this.current(this.proof);
    if (!b) bad();
    // Recovery may cross an uncommitted tail; install its actual batch position.
    p.pos = { segment: b.pointer.segment, offset: b.pointer.offset };
    if (p.row > b.rows.length) bad();
    return b;
  }
  private begin(
    kind: "end" | "overlap" | "admission",
    target: unknown,
    offset = 0,
    length = 0,
  ): NonNullable<RetainedProgress["work"]> {
    const id = fingerprint(target);
    if (this.state.work) {
      if (this.state.work.kind !== kind || this.state.work.target !== id) bad();
      return this.state.work;
    }
    const work: NonNullable<RetainedProgress["work"]> = {
      kind,
      target: id,
      proof: this.proof.checkpoint(),
      row: 0,
      event: 0,
      overlap: "",
      offset,
      length,
    };
    this.state.work = work;
    this.worker = new ForwardValidator(
      this.files,
      kind === "admission" ? undefined : work.proof,
    );
    return work;
  }
  private stopWork(): void {
    this.state.work = null;
    this.worker = undefined;
  }
  private savedEnd(
    matches: (d: RetainedDetail) => boolean,
  ): RetainedDetail | undefined {
    const w = this.state.end;
    if (!w) return;
    assertIncarnation(
      this.files,
      this.files.segmentPath(w.pointer.segment),
      w.stamp,
    );
    const b = this.proof.batch(w.pointer, this.budget),
      v = b.rows[w.row]?.value;
    const e =
      v?.kind === "capture" || v?.kind === "owner"
        ? v.events[w.event]
        : undefined;
    if (e?.kind !== "end") bad();
    return matches(e.detail) ? e.detail : undefined;
  }
  ending(target: {
    id?: string;
    detailId?: string;
    origin?: RetainedDetail["origin"];
  }): RetainedDetail | undefined {
    const matches = (d: RetainedDetail) =>
      target.id
        ? d.content.recordId === target.id
        : d.detailId === target.detailId &&
          canonicalJson(d.origin) === canonicalJson(target.origin);
    const saved = this.savedEnd(matches);
    if (saved) return saved;
    const w = this.begin("end", target),
      v = this.worker;
    if (!v) bad();
    for (;;) {
      const b = this.current(v);
      if (!b) bad();
      for (; w.row < b.rows.length; w.row++, w.event = 0) {
        const row = b.rows[w.row].value,
          events =
            row.kind === "owner" || row.kind === "capture" ? row.events : [];
        for (; w.event < events.length; w.event++) {
          this.budget.reserve(0);
          const e = events[w.event];
          if (e.kind === "end" && matches(e.detail)) {
            this.state.end = {
              pointer: b.pointer,
              stamp: v.state.stamp,
              sha256: new ResumableSha256(v.state.raw).digest(),
              row: w.row,
              event: w.event,
            };
            this.stopWork();
            return e.detail;
          }
        }
      }
      if (b.pointer.seq === this.snapshotSeq) {
        this.stopWork();
        return;
      }
      w.row = 0;
      w.event = 0;
      v.next(this.budget);
    }
  }
  admitted(
    scope: Scope,
  ): { taskId: string; runId: string; identity: RunIdentity } | undefined {
    const select = (b: LocatedBatch, row: number, event: number) => {
      const value = b.rows[row]?.value;
      if (value?.kind !== "owner") return;
      const e = value.events[event];
      if (
        e?.kind !== "owner" ||
        e.value.kind !== "fact" ||
        e.value.fact.kind !== "parent-admitted"
      )
        return;
      const f = e.value.fact;
      if (
        !(scope.kind === "run"
          ? f.runId === scope.id
          : f.identity.assignments.some((a) => a.childRunId === scope.id))
      )
        return;
      return {
        taskId: value.link.taskId,
        runId: f.runId,
        identity: f.identity,
      };
    };
    if (this.state.admissionMissing) return;
    const old = this.state.admission;
    if (old) {
      const selected = select(
        this.proof.batch(old.pointer, this.budget),
        old.row,
        old.event,
      );
      if (!selected) bad();
      return selected;
    }
    const w = this.begin("admission", scope),
      v = this.worker;
    if (!v) bad();
    for (;;) {
      const b = this.current(v);
      if (!b) bad();
      for (; w.row < b.rows.length; w.row++, w.event = 0) {
        const row = b.rows[w.row].value,
          count =
            row.kind === "owner" || row.kind === "capture"
              ? row.events.length
              : 0;
        for (; w.event < count; w.event++) {
          this.budget.reserve(0);
          const selected = select(b, w.row, w.event);
          if (selected) {
            this.state.admission = {
              pointer: b.pointer,
              stamp: v.state.stamp,
              sha256: new ResumableSha256(v.state.raw).digest(),
              row: w.row,
              event: w.event,
            };
            this.stopWork();
            return selected;
          }
        }
      }
      if (b.pointer.seq === this.snapshotSeq) {
        this.state.admissionMissing = true;
        this.stopWork();
        return;
      }
      w.row = 0;
      w.event = 0;
      v.next(this.budget);
    }
  }
  overlap(
    e: Extract<SavedEvent, { kind: "chunk" }>,
    length: number,
    sourceLink: unknown,
    bytes: (e: Extract<SavedEvent, { kind: "chunk" }>) => Buffer,
  ): Buffer {
    if (!length) return Buffer.alloc(0);
    const w = this.begin(
        "overlap",
        {
          artifact: e.artifact.artifactId,
          link: sourceLink,
          detail: e.detailId,
          offset: e.offset,
          length,
        },
        e.offset + e.length,
        length,
      ),
      v = this.worker;
    if (!v) bad();
    for (;;) {
      const b = this.current(v);
      if (!b) bad();
      for (; w.row < b.rows.length; w.row++, w.event = 0) {
        const row = b.rows[w.row].value,
          events =
            row.kind === "owner" || row.kind === "capture" ? row.events : [];
        for (; w.event < events.length; w.event++) {
          this.budget.reserve(0);
          const next = events[w.event];
          if (
            next.kind !== "chunk" ||
            next.artifact.artifactId !== e.artifact.artifactId ||
            next.offset < w.offset
          )
            continue;
          if (
            next.detailId !== e.detailId ||
            next.offset !== w.offset ||
            next.artifact.runId !== e.artifact.runId ||
            !(
              (row.kind === "owner" || row.kind === "capture") &&
              canonicalJson(row.link) === canonicalJson(sourceLink)
            )
          )
            bad();
          const prior = Buffer.from(w.overlap, "base64url"),
            part = bytes(next).subarray(0, length - prior.length);
          const joined = Buffer.concat([prior, part]);
          w.overlap = joined.toString("base64url");
          w.offset += part.length;
          if (joined.length === length) {
            this.stopWork();
            return joined;
          }
        }
      }
      if (b.pointer.seq === this.snapshotSeq) {
        const result = Buffer.from(w.overlap, "base64url");
        this.stopWork();
        return result;
      }
      w.row = 0;
      w.event = 0;
      v.next(this.budget);
    }
  }
  finish(): void {
    if (this.state.phase === "done") return;
    this.state.phase = "finish";
    // Continue the SAME validator beyond the pinned commit to observe a real
    // final tail. Later committed work is outside this historical snapshot.
    const next = this.proof.next(this.budget);
    if (!next && this.proof.state.previous.tail)
      this.state.coverage = combineCoverage(this.state.coverage, gap);
    this.state.phase = "done";
    this.assertCurrent();
  }
}
