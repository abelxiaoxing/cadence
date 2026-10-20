import { hash } from "../service/private-files.ts";
/** Forward-only original journal validator. Checkpoints contain source coordinates,
 * scalar counters and standard SHA state, never rows/markers/reference arrays.
 * Consumers may only restore authenticated checkpoints; this is not an admission API. */
import { ContractError, canonicalJson, LIMITS } from "../service-contract.ts";
import {
  bool,
  closed,
  decodeHash,
  decodeId,
  integer,
  oneOf,
  text,
} from "../worker-public.mjs";
import type { HistoryFiles, HistoryReadBudget } from "./files.ts";
import type { LocatedBatch, Pointer } from "./navigation.ts";
import {
  assertIncarnation,
  incarnation,
  readRange,
  reproveAppend,
} from "./read-io.ts";
import {
  decodeSha256State,
  ResumableSha256,
  type Sha256State,
} from "./sha256-state.ts";
import { sourceLocator } from "./source-row.ts";
import {
  type CommitMarker,
  decodeJournalText,
  type JournalRow,
  RECORD_BYTES,
} from "./types.ts";

function bad(): never {
  throw new ContractError("corrupt-selected");
}
const seq = (s: string): number => {
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < 0 || String(n) !== s) bad();
  return n;
};
const emptyHash = () => new ResumableSha256().snapshot();
const key = (r: { runId: string; artifactId: string; part: number }) =>
  `${r.runId}/${r.artifactId}/${r.part}`;
const phases = [
  "select",
  "locate",
  "decode",
  "members",
  "admission",
  "commit",
  "ready",
  "eof",
  "done",
] as const;
export interface ValidatorState {
  v: 1;
  phase: (typeof phases)[number];
  segment: number;
  stamp: string;
  size: number;
  at: number;
  line: number;
  end: number;
  raw: Sha256State;
  body: Sha256State;
  records: number;
  high: number;
  committed: number;
  committedBytes: number;
  start: number;
  count: number;
  first: number;
  marker: number;
  member: number;
  memberEnd: number;
  event: number;
  reference: number;
  tail: boolean;
  bridge: boolean;
  required: boolean;
  admission: null | { runId: string; hash: string };
  previous: {
    segment: number;
    bytes: number;
    sha: string;
    high: number;
    committed: number;
    offset: number;
    tail: boolean;
    stamp: string;
  };
}
export function freshValidator(): ValidatorState {
  return {
    v: 1,
    phase: "select",
    segment: 1,
    stamp: "",
    size: 0,
    at: 0,
    line: 0,
    end: 0,
    raw: emptyHash(),
    body: emptyHash(),
    records: 0,
    high: 0,
    committed: 0,
    committedBytes: 0,
    start: 0,
    count: 0,
    first: 0,
    marker: 0,
    member: 0,
    memberEnd: 0,
    event: 0,
    reference: -1,
    tail: false,
    bridge: false,
    required: false,
    admission: null,
    previous: {
      segment: 0,
      bytes: 0,
      sha: new ResumableSha256().digest(),
      high: 0,
      committed: 0,
      offset: 0,
      tail: false,
      stamp: "",
    },
  };
}
export function decodeValidator(value: unknown): ValidatorState {
  const o = closed(value, Object.keys(freshValidator()));
  const p = closed(o.previous, [
    "segment",
    "bytes",
    "sha",
    "high",
    "committed",
    "offset",
    "tail",
    "stamp",
  ]);
  if (o.v !== 1) bad();
  const s: ValidatorState = {
    v: 1,
    phase: oneOf(o.phase, phases),
    segment: integer(o.segment, 1, 999999999999),
    stamp: text(o.stamp, 256),
    size: integer(o.size, 0, LIMITS.segmentBytes),
    at: integer(o.at, 0, LIMITS.segmentBytes),
    line: integer(o.line, 0, LIMITS.segmentBytes),
    end: integer(o.end, 0, LIMITS.segmentBytes),
    raw: decodeSha256State(o.raw),
    body: decodeSha256State(o.body),
    records: integer(o.records, 0, LIMITS.segmentRecords),
    high: integer(o.high),
    committed: integer(o.committed),
    committedBytes: integer(o.committedBytes, 0, LIMITS.segmentBytes),
    start: integer(o.start, 0, LIMITS.segmentBytes),
    count: integer(o.count, 0, LIMITS.segmentRecords),
    first: integer(o.first),
    marker: integer(o.marker, 0, LIMITS.segmentBytes),
    member: integer(o.member, 0, LIMITS.segmentBytes),
    memberEnd: integer(o.memberEnd, 0, LIMITS.segmentBytes),
    event: integer(o.event, 0, LIMITS.ownerQueueFrames),
    reference: integer(o.reference, -1, LIMITS.ownerQueueFrames - 1),
    tail: bool(o.tail),
    bridge: bool(o.bridge),
    required: bool(o.required),
    admission: null,
    previous: {
      segment: integer(p.segment, 0, 999999999998),
      bytes: integer(p.bytes, 0, LIMITS.segmentBytes),
      sha: text(p.sha, 64, true),
      high: integer(p.high),
      committed: integer(p.committed),
      offset: integer(p.offset, 0, LIMITS.segmentBytes),
      tail: bool(p.tail),
      stamp: text(p.stamp, 256),
    },
  };
  if (o.admission !== null) {
    const a = closed(o.admission, ["runId", "hash"]);
    s.admission = { runId: decodeId(a.runId), hash: decodeHash(a.hash) };
  }
  if (
    (s.phase === "admission") !== (s.admission !== null) ||
    s.high > s.segment * LIMITS.segmentRecords ||
    !/^[a-f0-9]{64}$/.test(s.previous.sha) ||
    s.previous.segment !== s.segment - 1 ||
    s.previous.offset > s.previous.bytes ||
    s.previous.high < s.previous.committed ||
    s.at !== s.raw.bytes ||
    s.line > s.at ||
    s.end > s.at ||
    s.at > s.size ||
    s.high < s.committed ||
    s.committedBytes > s.at ||
    s.start > s.line ||
    s.body.bytes > 2 * RECORD_BYTES ||
    (s.phase !== "select" && s.phase !== "done" && !s.stamp) ||
    (["members", "admission", "commit", "ready"].includes(s.phase) &&
      (!s.count ||
        s.marker < s.start ||
        s.marker !== s.line ||
        s.end <= s.marker ||
        s.member > s.marker)) ||
    (s.phase === "decode" &&
      (s.end !== s.at || s.end <= s.line || s.end - s.line > RECORD_BYTES)) ||
    (s.phase === "eof" && s.at !== s.size)
  )
    bad();
  return s;
}

export class ForwardValidator {
  readonly state: ValidatorState;
  private block?: { start: number; bytes: Buffer; segment: number };
  private markerCache?: {
    at: number;
    segment: number;
    marker: CommitMarker;
    refs: Map<string, number>;
  };
  private rowCache?: { at: number; segment: number; row: JournalRow };
  constructor(
    readonly files: HistoryFiles,
    state: ValidatorState = freshValidator(),
  ) {
    this.state = decodeValidator(state);
  }
  checkpoint(): ValidatorState {
    return structuredClone(this.state);
  }
  assertCurrent(): void {
    const s = this.state;
    if (s.stamp)
      assertIncarnation(this.files, this.files.segmentPath(s.segment), s.stamp);
    if (s.previous.stamp)
      assertIncarnation(
        this.files,
        this.files.segmentPath(s.previous.segment),
        s.previous.stamp,
      );
  }
  revalidate(budget: HistoryReadBudget): void {
    const s = this.state;
    if (s.stamp && s.phase === "ready") {
      s.stamp = reproveAppend(
        this.files,
        this.files.segmentPath(s.segment),
        s.stamp,
        s.at,
        new ResumableSha256(s.raw).digest(),
        budget,
      );
      s.size = Number(s.stamp.split(":")[2]);
    }
    this.assertCurrent();
  }
  private range(
    start: number,
    length: number,
    budget: HistoryReadBudget,
  ): Buffer {
    return readRange(
      this.files,
      this.files.segmentPath(this.state.segment),
      start,
      length,
      budget,
    );
  }
  /** At most 64KiB of original bytes per locator/hash unit. The complete unit's
   * state is installed before any subsequent cooperative deadline check. */
  private locate(
    start: number,
    budget: HistoryReadBudget,
  ): { end: number; newline: boolean; bytes: Buffer } {
    const s = this.state;
    if (
      !this.block ||
      this.block.segment !== s.segment ||
      start < this.block.start ||
      start >= this.block.start + this.block.bytes.length
    ) {
      this.block = {
        start,
        segment: s.segment,
        bytes: this.range(start, Math.min(64 * 1024, s.size - start), budget),
      };
    }
    const bytes = this.block.bytes.subarray(start - this.block.start),
      n = bytes.indexOf(10),
      take = n < 0 ? bytes.length : n + 1;
    return {
      end: start + take,
      newline: n >= 0,
      bytes: bytes.subarray(0, take),
    };
  }
  private decoded(
    start: number,
    end: number,
    budget: HistoryReadBudget,
  ): JournalRow | CommitMarker {
    if (end <= start || end - start > RECORD_BYTES) bad();
    try {
      return decodeJournalText(
        new TextDecoder("utf-8", { fatal: true }).decode(
          this.range(start, end - start, budget),
        ),
      );
    } catch (e) {
      if (e instanceof ContractError && e.code === "receipt-inconclusive")
        throw e;
      return bad();
    }
  }
  private marker(budget: HistoryReadBudget): {
    marker: CommitMarker;
    refs: Map<string, number>;
  } {
    const s = this.state;
    if (
      this.markerCache?.segment === s.segment &&
      this.markerCache.at === s.marker
    )
      return this.markerCache;
    const m = this.decoded(s.marker, s.end, budget);
    if (m.kind !== "commit") bad();
    const refs = new Map<string, number>();
    m.artifacts.forEach((r, i) => {
      if (refs.has(key(r))) bad();
      refs.set(key(r), i);
    });
    this.markerCache = { at: s.marker, segment: s.segment, marker: m, refs };
    return this.markerCache;
  }
  /** Returns a verified pointer, not a claim about arbitrary artifact bodies. */
  next(budget: HistoryReadBudget): Pointer | null {
    this.assertCurrent();
    const s = this.state;
    if (s.phase === "ready") {
      s.start = s.end;
      s.line = s.end;
      s.count = 0;
      s.first = 0;
      s.body = emptyHash();
      s.bridge = false;
      s.required = false;
      s.phase = "locate";
    }
    for (;;) {
      budget.reserve(0);
      switch (s.phase) {
        case "select": {
          let selected: { size: number; stamp: string };
          try {
            selected = incarnation(
              this.files,
              this.files.segmentPath(s.segment),
              LIMITS.segmentBytes,
            );
          } catch (e) {
            if (
              e &&
              typeof e === "object" &&
              "code" in e &&
              e.code === "ENOENT"
            ) {
              s.phase = "done";
              return null;
            }
            throw e;
          }
          s.size = selected.size;
          s.stamp = selected.stamp;
          s.phase = "locate";
          break;
        }
        case "locate": {
          if (s.at === s.size) {
            s.tail = s.count > 0 || s.line !== s.at;
            s.phase = "eof";
            break;
          }
          const part = this.locate(s.at, budget);
          s.raw = new ResumableSha256(s.raw).update(part.bytes).snapshot();
          s.at = part.end;
          if (part.newline) {
            s.end = part.end;
            s.phase = "decode";
          }
          // An unterminated fragment is preserved even when no row can decode it.
          if (part.newline && s.end - s.line > RECORD_BYTES) bad();
          break;
        }
        case "decode": {
          const line = this.range(s.line, s.end - s.line, budget);
          let r: JournalRow | CommitMarker;
          try {
            r = decodeJournalText(
              new TextDecoder("utf-8", { fatal: true }).decode(line),
            );
          } catch {
            return bad();
          }
          if (++s.records > LIMITS.segmentRecords) bad();
          if (r.kind === "record") {
            let base = s.committed;
            if (r.value.kind === "recovery") {
              const p = r.value.previous,
                prior = s.previous;
              if (
                s.count ||
                s.line !== 0 ||
                s.segment !== p.segment + 1 ||
                p.segment !== prior.segment ||
                p.bytes !== prior.bytes ||
                p.sha256 !== prior.sha ||
                p.committedBytes !== prior.offset ||
                seq(p.committedSeq) !== prior.committed ||
                seq(p.highSeq) !== prior.high
              )
                bad();
              base = prior.high;
              s.bridge = true;
            } else if (s.previous.tail && s.committedBytes === 0) bad();
            if (seq(r.seq) !== base + s.count + 1 || (s.bridge && s.count))
              bad();
            if (
              (r.value.kind === "owner" || r.value.kind === "capture") &&
              r.value.events.some(
                (e) =>
                  e.kind === "chunk" ||
                  (e.kind === "owner" &&
                    e.value.kind === "fact" &&
                    e.value.fact.kind === "parent-admitted"),
              )
            )
              s.required = true;
            if (!s.count) s.first = seq(r.seq);
            s.high = seq(r.seq);
            s.count++;
            s.body = new ResumableSha256(s.body).update(line).snapshot();
            if (s.body.bytes > 2 * RECORD_BYTES) bad();
            s.line = s.end;
            s.phase = "locate";
          } else {
            if (
              !s.count ||
              seq(r.previous) !== s.committed ||
              seq(r.first) !== s.first ||
              seq(r.last) !== s.high ||
              r.count !== s.count ||
              r.sha256 !== new ResumableSha256(s.body).digest() ||
              (s.bridge && (s.count !== 1 || r.artifacts.length))
            )
              bad();
            s.marker = s.line;
            s.member = s.start;
            s.memberEnd = s.start;
            s.event = 0;
            s.reference = -1;
            s.phase = r.artifacts.length || s.required ? "members" : "commit";
            this.markerCache = undefined;
          }
          break;
        }
        case "members": {
          const { marker, refs } = this.marker(budget);
          if (s.member === s.marker) {
            if (s.reference !== marker.artifacts.length - 1) bad();
            s.phase = "commit";
            break;
          }
          if (
            s.memberEnd === s.member ||
            !this.rowCache ||
            this.rowCache.at !== s.member ||
            this.rowCache.segment !== s.segment
          ) {
            if (
              s.memberEnd === s.member ||
              this.range(s.memberEnd - 1, 1, budget)[0] !== 10
            ) {
              const part = this.locate(s.memberEnd, budget);
              s.memberEnd = part.end;
              if (!part.newline) break;
            }
            const row = this.decoded(s.member, s.memberEnd, budget);
            if (row.kind !== "record") bad();
            this.rowCache = { at: s.member, segment: s.segment, row };
          }
          const row = this.rowCache.row,
            v = row.value;
          const events =
            v.kind === "owner" || v.kind === "capture" ? v.events : [];
          if (s.event >= events.length) {
            s.member = s.memberEnd;
            s.event = 0;
            this.rowCache = undefined;
            break;
          }
          const e = events[s.event];
          if (e.kind === "chunk") {
            const i = refs.get(key(e.artifact));
            if (
              i === undefined ||
              i > s.reference + 1 ||
              canonicalJson(e.artifact) !== canonicalJson(marker.artifacts[i])
            )
              bad();
            // Every first appearance must be the NEXT marker entry. Repeats may
            // only refer backwards. This proves exact ordered-set equality in
            // constant serialized space, including conflicting duplicates.
            s.reference = Math.max(s.reference, i);
          }
          if (
            e.kind === "owner" &&
            e.value.kind === "fact" &&
            e.value.fact.kind === "parent-admitted"
          ) {
            s.admission = {
              runId: e.value.fact.runId,
              hash: hash(canonicalJson(e.value.fact.identity)),
            };
            s.phase = "admission";
          } else s.event++;
          break;
        }
        case "admission": {
          const selected = s.admission;
          if (!selected) bad();
          this.files.readAdmissionIdentity(
            selected.runId,
            selected.hash,
            budget,
          );
          s.admission = null;
          s.event++;
          s.phase = "members";
          break;
        }
        case "commit": {
          this.files.assertPublished(s.segment, s.end, String(s.high));
          this.assertCurrent();
          s.committed = s.high;
          s.committedBytes = s.end;
          s.phase = "ready";
          return {
            segment: s.segment,
            offset: s.start,
            bytes: s.end - s.start,
            seq: String(s.committed),
          };
        }
        case "eof": {
          this.assertCurrent();
          s.previous = {
            segment: s.segment,
            bytes: s.size,
            sha: new ResumableSha256(s.raw).digest(),
            high: s.high,
            committed: s.committed,
            offset: s.committedBytes,
            tail: s.tail,
            stamp: s.stamp,
          };
          s.segment++;
          s.stamp = "";
          s.size = 0;
          s.at = 0;
          s.line = 0;
          s.end = 0;
          s.raw = emptyHash();
          s.body = emptyHash();
          s.records = 0;
          s.committedBytes = 0;
          s.start = 0;
          s.count = 0;
          s.first = 0;
          s.marker = 0;
          s.member = 0;
          s.memberEnd = 0;
          s.event = 0;
          s.reference = -1;
          s.bridge = false;
          s.required = false;
          s.phase = "select";
          this.block = undefined;
          this.markerCache = undefined;
          this.rowCache = undefined;
          break;
        }
        case "done":
          return null;
      }
    }
  }
  /** Reconstruct only a selected already-validated batch. It remains bounded by
   * the original row/marker ceilings and is never included in a checkpoint. */
  batch(p: Pointer, budget: HistoryReadBudget): LocatedBatch {
    this.assertCurrent();
    const bytes = readRange(
      this.files,
      this.files.segmentPath(p.segment),
      p.offset,
      p.bytes,
      budget,
    );
    const rows: JournalRow[] = [];
    let at = 0,
      marker: CommitMarker | undefined;
    while (at < bytes.length) {
      const start = at,
        end = bytes.indexOf(10, at);
      if (end < 0) bad();
      const decode = () =>
        decodeJournalText(
          new TextDecoder("utf-8", { fatal: true }).decode(
            bytes.subarray(start, end + 1),
          ),
        );
      if (end + 1 === bytes.length) {
        const r = decode();
        if (r.kind !== "commit") bad();
        marker = r;
      } else {
        let row: JournalRow | undefined;
        Object.defineProperty(rows, rows.length, {
          enumerable: true,
          get() {
            if (!row) {
              const r = decode();
              if (r.kind !== "record") bad();
              row = r;
            }
            return row;
          },
        });
      }
      at = end + 1;
    }
    if (!marker || marker.last !== p.seq) bad();
    this.files.assertPublished(p.segment, p.offset + p.bytes, p.seq);
    return {
      pointer: { ...p },
      sourceRow: (index) => sourceLocator(bytes, p, index, rows.length),
      rows,
      previous: marker.previous,
      next: { segment: p.segment, offset: p.offset + p.bytes },
      navigationRoot: marker.navigationRoot,
    };
  }
}
