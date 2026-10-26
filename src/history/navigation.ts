/** Derived navigation only. Every selected pointer is checked against the original
 * committed journal; no index can authorize acceptance, launch or replay. */
import { createHash } from "node:crypto";
import { lstatSync, type Stats } from "node:fs";
import { dirname, join } from "node:path";
import type { OwnerLease } from "../service/coordination.ts";
import { encoded, hash } from "../service/private-files.ts";
import {
  ContractError,
  canonicalJson,
  decodeId,
  decodeSequence,
  LIMITS,
  parseWireJson,
} from "../service-contract.ts";
import { closed, integer, literal } from "../worker-public.mjs";
import type { HistoryFiles, HistoryReadBudget } from "./files.ts";
import {
  ACTIVE_KEY,
  chainHash,
  type IndexHead,
  IndexTree,
} from "./index-tree.ts";
import { readRange } from "./read-io.ts";
import { RunState } from "./run-state.ts";
import { sourceLocator } from "./source-row.ts";
import {
  batchArtifacts,
  decodeJournalText,
  type JournalRow,
  RECORD_BYTES,
  type RetainedDetail,
  type SavedEvent,
  validBatchSequence,
} from "./types.ts";

export interface Position {
  segment: number;
  offset: number;
}
export interface Pointer extends Position {
  bytes: number;
  seq: string;
}
export interface LocatedBatch {
  pointer: Pointer;
  sourceRow?: (index: number) => import("./source-row.ts").SourceRow;
  rows: JournalRow[];
  previous: string;
  next: Position;
  navigationRoot?: string | null;
}
function bad(): never {
  throw new ContractError("corrupt-selected");
}
const stamp = (s: Stats) =>
  [s.dev, s.ino, s.size, s.ctimeMs, s.mtimeMs, s.mode, s.uid, s.nlink].join(
    ":",
  );
function pointer(v: unknown): Pointer {
  const o = closed(v, ["segment", "offset", "bytes", "seq"]);
  return {
    segment: integer(o.segment, 1),
    offset: integer(o.offset, 0, LIMITS.segmentBytes),
    bytes: integer(o.bytes, 1, 3 * RECORD_BYTES),
    seq: decodeSequence(o.seq),
  };
}
export interface PreparedIndex {
  root: string | null;
  heads: Map<
    string,
    {
      seq: string;
      hash: string;
      previous: string | null;
      previousHash: string | null;
    }
  >;
}
// Read-only, finite source-locator memoization. No text/artifact bodies and no
// persistence: every use still validates the original selected batch/part.
// This also lets an exact hit navigate after a bounded no-index search without
// rescanning byte zero in a different request/HistoryReader instance.
const sourceHints = new Map<string, { value: unknown; bytes: number }>();
let sourceHintBytes = 0;
export class HistoryNavigation {
  private readonly tails = new WeakMap<HistoryReadBudget, boolean>();
  private readonly authRuns = new Map<string, string>();
  private readonly tree: IndexTree;
  private readonly roots = new WeakMap<
    HistoryReadBudget,
    Map<string, string | null | undefined>
  >();
  private readonly points = new WeakMap<
    HistoryReadBudget,
    Map<string, Pointer>
  >();
  private cache = new Map<
    string,
    {
      identity: string;
      batch: LocatedBatch;
      bytes: number;
      stamp: string;
      budget: HistoryReadBudget;
    }
  >();
  private cacheBytes = 0;
  private blocks = new Map<
    string,
    { bytes: Buffer; stamp: string; budget: HistoryReadBudget }
  >();
  private block(
    path: string,
    at: number,
    size: number,
    budget: HistoryReadBudget,
  ): Buffer {
    const start = Math.floor(at / (1024 * 1024)) * 1024 * 1024,
      key = `${path}/${start}`,
      st = stamp(lstatSync(path));
    let old = this.blocks.get(key);
    if (!old || old.budget !== budget || old.stamp !== st) {
      const bytes = readRange(
        this.files,
        path,
        start,
        Math.min(1024 * 1024, size - start),
        budget,
      );
      if (
        old &&
        (bytes.length < old.bytes.length ||
          !bytes.subarray(0, old.bytes.length).equals(old.bytes))
      )
        bad();
      if (!old && this.blocks.size >= 4) {
        const first = this.blocks.keys().next().value;
        if (first) this.blocks.delete(first);
      }
      old = { bytes, stamp: st, budget };
      this.blocks.set(key, old);
    }
    return old.bytes.subarray(at - start);
  }
  constructor(readonly files: HistoryFiles) {
    this.tree = new IndexTree(files);
  }
  prepare(
    lease: OwnerLease,
    state: { committedSeq: string; navigationRoot?: string | null },
    rows: JournalRow[],
    active: { runId: string; taskId: string }[],
    charge: (bytes: number) => void,
  ): PreparedIndex | undefined {
    if (state.committedSeq !== "0" && state.navigationRoot === undefined)
      return;
    const root = state.navigationRoot ?? null,
      heads: PreparedIndex["heads"] = new Map(),
      updates = new Map<string, IndexHead>(),
      auth = new Map(this.authRuns),
      seq = rows.at(-1)?.seq;
    if (!seq) throw new ContractError("invalid");
    const keys = new Set<string>();
    for (const row of rows) {
      for (const key of navigationKeys(row)) keys.add(key);
      if (row.value.kind === "owner")
        for (const e of row.value.events)
          if (
            e.kind === "owner" &&
            e.value.kind === "fact" &&
            e.value.fact.kind === "parent-admitted"
          )
            keys.add(`roster:${row.value.link.taskId}`);
      if (row.value.kind === "auth-preparation")
        auth.set(row.value.intent.operationId, row.value.intent.runId);
      if (row.value.kind === "auth-settlement") {
        const run = auth.get(row.value.result.operationId);
        if (run) keys.add(run);
        auth.delete(row.value.result.operationId);
      }
    }
    const previousHeads = this.tree.heads(root, [...keys, ACTIVE_KEY]);
    for (const id of keys) {
      const previous = previousHeads.get(id);
      const head = {
        seq,
        previous: previous?.seq ?? null,
        previousHash: previous?.hash ?? null,
        hash: chainHash(seq, previous?.seq ?? null, previous?.hash ?? null),
      };
      heads.set(id, head);
      updates.set(id, { seq, hash: head.hash });
    }
    const activeHash = hash(canonicalJson(active));
    if (previousHeads.get(ACTIVE_KEY)?.hash !== activeHash)
      updates.set(ACTIVE_KEY, { seq, hash: activeHash });
    return { root: this.tree.update(lease, root, updates, charge), heads };
  }
  private anchoredHead(
    id: string,
    snapshot: string,
    budget: HistoryReadBudget,
  ): IndexHead | null | undefined {
    let roots = this.roots.get(budget);
    if (!roots?.has(snapshot)) {
      this.snapshot(snapshot, budget);
      roots = this.roots.get(budget);
    }
    const root = roots?.get(snapshot);
    if (root === undefined) return undefined;
    try {
      return this.tree.head(root, id, budget) ?? null;
    } catch {
      budget.reserve(0);
      return undefined; // Missing/corrupt accelerator is not committed absence.
    }
  }
  indexPath(group: string, id: string): string {
    return join(this.files.directory, "indexes", group, `${id}.json`);
  }
  private hintKey(group: string, id: string): string {
    return `${this.files.directory}/${this.files.format.storeId}/${group}/${id}`;
  }
  private sourceHints(batch: LocatedBatch): void {
    const put = (group: string, id: string, value: unknown) => {
      const key = this.hintKey(group, id),
        bytes =
          Buffer.byteLength(key) + Buffer.byteLength(JSON.stringify(value));
      const old = sourceHints.get(key);
      if (old) {
        sourceHintBytes -= old.bytes;
        sourceHints.delete(key);
      }
      while (
        sourceHints.size &&
        (sourceHints.size >= LIMITS.ownerQueueFrames ||
          sourceHintBytes + bytes > 2 * 1024 * 1024)
      ) {
        const first = sourceHints.keys().next().value;
        if (!first) break;
        sourceHintBytes -= sourceHints.get(first)?.bytes ?? 0;
        sourceHints.delete(first);
      }
      sourceHints.set(key, { value, bytes });
      sourceHintBytes += bytes;
    };
    const parts = new Map<
      string,
      { first: number; last: number; part: number; id: string }
    >();
    for (const row of batch.rows)
      if (row.value.kind === "owner" || row.value.kind === "capture")
        for (const e of row.value.events) {
          if (e.kind === "end")
            put("contents", e.detail.content.recordId, {
              pointer: batch.pointer,
            });
          if (e.kind === "chunk") {
            const id = e.artifact.artifactId,
              key = `${id}/${e.artifact.part}`,
              old = parts.get(key);
            parts.set(key, {
              first: old?.first ?? e.offset,
              last: e.offset + e.length,
              part: e.artifact.part,
              id,
            });
          }
        }
    for (const [key, { id, ...part }] of parts) {
      put("parts", key, { pointer: batch.pointer, ...part });
      const old = sourceHints.get(this.hintKey("part-heads", id))?.value as
        | { count: number }
        | undefined;
      put("part-heads", id, {
        count: Math.max(old?.count ?? 0, part.part + 1),
      });
    }
  }
  private index(
    group: string,
    id: string,
    budget: HistoryReadBudget,
  ): unknown | undefined {
    const path = this.indexPath(group, id);
    const source = sourceHints.get(this.hintKey(group, id));
    if (source && group !== "part-heads") {
      budget.reserve(0);
      return structuredClone(source.value);
    }
    try {
      if (!this.files.files.directory(dirname(path), false, budget.walks))
        return source ? structuredClone(source.value) : undefined;
      const size = lstatSync(path).size;
      if (size > RECORD_BYTES)
        return source ? structuredClone(source.value) : undefined;
      return parseWireJson(
        readRange(this.files, path, 0, size, budget).toString("utf8"),
        RECORD_BYTES,
      );
    } catch (e) {
      if (e instanceof ContractError && e.code === "receipt-inconclusive")
        throw e;
      return source ? structuredClone(source.value) : undefined; // Never repair an accelerator on a read.
    }
  }
  private write(
    lease: OwnerLease,
    group: string,
    id: string,
    value: unknown,
    charge: (bytes: number) => void,
    replace = false,
  ): void {
    const path = this.indexPath(group, id),
      body = encoded(value),
      bytes = Buffer.byteLength(body);
    if (bytes > RECORD_BYTES) throw new ContractError("oversize");
    charge(bytes);
    lease.assert();
    const previous = this.files.files.read(path, RECORD_BYTES);
    if (previous) {
      if (!replace) {
        if (previous.identity !== hash(body)) bad();
        return;
      }
      this.files.files.replace(
        path,
        previous,
        body,
        Math.max(previous.bytes.length, bytes),
      );
    } else this.files.files.create(path, body, bytes);
  }
  /** Linear retained metadata: one commit pointer and one locator per immutable
   * artifact/end. Mutable head files are small; no full-history rewrite. */
  publish(
    lease: OwnerLease,
    p: Pointer,
    rows: JournalRow[],
    charge: (bytes: number) => void,
    prepared?: PreparedIndex,
  ): void {
    this.write(lease, "commits", p.seq, p, charge);
    const artifacts = new Map<
      string,
      { first: number; last: number; part: number }
    >();
    for (const row of rows) {
      const v = row.value;
      if (v.kind !== "owner" && v.kind !== "capture") continue;
      for (const e of v.events) {
        if (e.kind === "chunk") {
          const key = `${e.artifact.artifactId}/${e.artifact.part}`;
          const old = artifacts.get(key);
          artifacts.set(key, {
            first: old?.first ?? e.offset,
            last: e.offset + e.length,
            part: e.artifact.part,
          });
        }
        if (e.kind === "end")
          this.write(
            lease,
            "contents",
            e.detail.content.recordId,
            { pointer: p },
            charge,
          );
      }
    }
    const partHeads = new Map<string, number>();
    for (const [key, range] of artifacts) {
      this.write(lease, "parts", key, { pointer: p, ...range }, charge);
      const id = key.split("/")[0];
      partHeads.set(id, Math.max(partHeads.get(id) ?? 0, range.part + 1));
    }
    for (const [id, count] of partHeads)
      this.write(lease, "part-heads", id, { count }, charge, true);
    const keys = new Set<string>(),
      runKeys = new Set<string>(),
      rosters = new Set<string>();
    for (const row of rows) {
      const v = row.value;
      if (v.kind === "admission" && v.intent.runId) runKeys.add(v.intent.runId);
      if (v.kind === "auth-preparation") runKeys.add(v.intent.runId);
      if (v.kind === "launch" || v.kind === "settlement")
        runKeys.add(v.link.runId);
      if (
        v.kind === "owner" &&
        v.link.runId &&
        v.events.some((e) => e.kind === "owner" && e.value.kind === "fact")
      )
        runKeys.add(v.link.runId);
      if (
        v.kind === "capture" &&
        v.events.some(
          (e) =>
            e.kind === "end" ||
            (e.kind === "capture" &&
              ["ready", "final", "worker-failure", "capture-status"].includes(
                e.value.event.kind,
              )),
        )
      )
        runKeys.add(v.link.runId);
      if (v.kind === "owner")
        for (const e of v.events)
          if (
            e.kind === "owner" &&
            e.value.kind === "fact" &&
            e.value.fact.kind === "parent-admitted"
          )
            rosters.add(v.link.taskId);
      for (const key of navigationKeys(row)) keys.add(key);
      if (row.value.kind === "auth-preparation")
        this.authRuns.set(row.value.intent.operationId, row.value.intent.runId);
      if (row.value.kind === "auth-settlement") {
        const run = this.authRuns.get(row.value.result.operationId);
        if (run) {
          keys.add(run);
          runKeys.add(run);
        }
        this.authRuns.delete(row.value.result.operationId);
      }
    }
    for (const key of keys) {
      const head = prepared?.heads.get(key);
      const old = head
        ? undefined
        : this.files.files.read(this.indexPath("entities", key));
      const previous =
        head?.previous ??
        (old
          ? decodeSequence(
              closed(parseWireJson(old.bytes.toString("utf8")), ["seq"]).seq,
            )
          : null);
      this.write(
        lease,
        "entity-links",
        `${key}/${p.seq}`,
        {
          pointer: p,
          previous,
          ...(head ? { previousHash: head.previousHash, hash: head.hash } : {}),
        },
        charge,
      );
      // A prepared immutable root already anchors this exact head. The mutable
      // legacy hint is only consulted by the no-root writer path above; readers
      // validate root/entity-links or scan original commits. Do not rewrite an
      // unused duplicate (or adopt its old bytes) at every durable transition.
      if (!head)
        this.write(lease, "entities", key, { seq: p.seq }, charge, true);
    }
    for (const runId of runKeys) {
      const old = this.files.files.read(
        this.indexPath("run-locators", runId),
        RECORD_BYTES,
      );
      const pointers = old
        ? closed(parseWireJson(old.bytes.toString("utf8"), RECORD_BYTES), [
            "pointers",
          ]).pointers
        : [];
      if (!Array.isArray(pointers) || pointers.length >= 512) continue;
      this.write(
        lease,
        "run-locators",
        runId,
        { pointers: [...pointers, p] },
        charge,
        true,
      );
    }
    for (const taskId of rosters) {
      const head = prepared?.heads.get(`roster:${taskId}`);
      const old = head
        ? undefined
        : this.files.files.read(this.indexPath("rosters", taskId));
      const previous = head
        ? head.previous
        : old
          ? decodeSequence(
              closed(parseWireJson(old.bytes.toString("utf8")), ["seq"]).seq,
            )
          : null;
      this.write(
        lease,
        "roster-links",
        `${taskId}/${p.seq}`,
        {
          pointer: p,
          previous,
          ...(head ? { hash: head.hash, previousHash: head.previousHash } : {}),
        },
        charge,
      );
      if (!head)
        this.write(lease, "rosters", taskId, { seq: p.seq }, charge, true);
    }
    this.write(lease, "heads", "latest", p, charge, true);
  }
  private validateBridge(
    rows: JournalRow[],
    pos: Position,
    budget: HistoryReadBudget,
  ): void {
    const bridge = rows[0]?.value;
    if (bridge?.kind !== "recovery") return;
    if (pos.segment !== bridge.previous.segment + 1 || pos.offset !== 0) bad();
    this.files.validateRecovery(bridge, budget);
  }
  /** A pointer is only a hint. Recompute batch checksum, range, count and original
   * artifact membership from the selected bytes on EVERY use. */
  batch(p: Pointer, budget: HistoryReadBudget): LocatedBatch {
    const key = canonicalJson(p),
      cached = this.cache.get(key),
      path = this.files.segmentPath(p.segment);
    if (
      cached &&
      cached.budget === budget &&
      cached.stamp === stamp(lstatSync(path))
    ) {
      this.validateBridge(cached.batch.rows, p, budget);
      this.rememberBoundary(p, cached.batch.navigationRoot, budget);
      return cached.batch;
    }
    const bytes = readRange(this.files, path, p.offset, p.bytes, budget);
    const identity = hash(bytes);
    if (cached) {
      if (cached.identity !== identity) bad();
      cached.budget = budget;
      cached.stamp = stamp(lstatSync(path));
      this.files.assertPublished(p.segment, p.offset + p.bytes, p.seq);
      this.validateBridge(cached.batch.rows, p, budget);
      this.rememberBoundary(p, cached.batch.navigationRoot, budget);
      return cached.batch;
    }
    if (bytes.at(-1) !== 10) bad();
    const lines = new TextDecoder("utf-8", { fatal: true })
      .decode(bytes)
      .split("\n");
    lines.pop();
    const rows: JournalRow[] = [];
    let used = 0;
    for (const line of lines.slice(0, -1)) {
      budget.reserve(0);
      const row = decodeJournalText(line);
      if (row.kind !== "record") bad();
      rows.push(row);
      used += Buffer.byteLength(line) + 1;
    }
    const last = lines.at(-1);
    if (!last) bad();
    const m = decodeJournalText(last);
    if (
      m.kind !== "commit" ||
      !rows.length ||
      m.last !== p.seq ||
      m.count !== rows.length ||
      m.first !== rows[0].seq ||
      m.last !== rows.at(-1)?.seq ||
      m.sha256 !== hash(bytes.subarray(0, used)) ||
      canonicalJson(m.artifacts, RECORD_BYTES) !==
        canonicalJson(batchArtifacts(rows), RECORD_BYTES)
    )
      bad();
    if (!validBatchSequence(rows, m.previous)) bad();
    this.validateBridge(rows, p, budget);
    this.files.assertPublished(p.segment, p.offset + p.bytes, p.seq);
    const batch = {
      pointer: p,
      sourceRow: (index: number) => sourceLocator(bytes, p, index, rows.length),
      rows,
      previous: m.previous,
      navigationRoot: m.navigationRoot,
      next: { segment: p.segment, offset: p.offset + p.bytes },
    };
    while (
      this.cache.size &&
      (this.cache.size >= LIMITS.maxPageEntries ||
        this.cacheBytes + bytes.length > 2 * 1024 * 1024)
    ) {
      const key = this.cache.keys().next().value;
      if (!key) break;
      this.cacheBytes -= this.cache.get(key)?.bytes ?? 0;
      this.cache.delete(key);
    }
    if (bytes.length <= 2 * 1024 * 1024) {
      this.cache.set(key, {
        identity,
        batch,
        bytes: bytes.length,
        stamp: stamp(lstatSync(path)),
        budget,
      });
      this.cacheBytes += bytes.length;
    }
    this.rememberBoundary(p, m.navigationRoot, budget);
    this.sourceHints(batch);
    return batch;
  }
  /** Forward scan keeps at most one batch. Continuations point to a verified batch
   * boundary, including pages with no selected records. */
  next(pos: Position, budget: HistoryReadBudget): LocatedBatch | null {
    this.tails.set(budget, false);
    let { segment, offset } = pos;
    for (;;) {
      budget.reserve(0);
      const path = this.files.segmentPath(segment);
      let size: number;
      try {
        size = lstatSync(path).size;
      } catch (e) {
        if (e instanceof Error && "code" in e && e.code === "ENOENT")
          return null;
        throw e;
      }
      if (size > LIMITS.segmentBytes || offset > size) bad();
      if (offset === size) {
        segment++;
        offset = 0;
        continue;
      }
      // Read a bounded block and stop on the first complete commit. No artifact
      // bodies and no unrelated full segment are read by metadata navigation.
      let pending = Buffer.alloc(0),
        at = offset,
        bodyBytes = 0;
      const checksum = createHash("sha256"),
        rows: JournalRow[] = [];
      while (at < size) {
        const chunk = this.block(path, at, size, budget);
        at += chunk.length;
        pending = Buffer.concat([pending, chunk]);
        for (;;) {
          budget.reserve(0);
          const end = pending.indexOf(10);
          if (end < 0) break;
          const line = pending.subarray(0, end + 1);
          pending = pending.subarray(end + 1);
          const v = decodeJournalText(
            new TextDecoder("utf-8", { fatal: true }).decode(line),
          );
          if (v.kind === "record") {
            rows.push(v);
            checksum.update(line);
            bodyBytes += line.length;
            if (bodyBytes > 2 * RECORD_BYTES) bad();
            continue;
          }
          const p = {
            segment,
            offset,
            bytes: bodyBytes + line.length,
            seq: v.last,
          };
          if (
            !rows.length ||
            v.count !== rows.length ||
            v.first !== rows[0].seq ||
            v.last !== rows.at(-1)?.seq ||
            v.sha256 !== checksum.digest("hex") ||
            canonicalJson(v.artifacts, RECORD_BYTES) !==
              canonicalJson(batchArtifacts(rows), RECORD_BYTES)
          )
            bad();
          if (!validBatchSequence(rows, v.previous)) bad();
          this.validateBridge(rows, p, budget);
          this.files.assertPublished(segment, offset + p.bytes, p.seq);
          const batch = {
            pointer: p,
            rows,
            previous: v.previous,
            navigationRoot: v.navigationRoot,
            next: { segment, offset: offset + p.bytes },
          };
          this.rememberBoundary(p, v.navigationRoot, budget);
          this.sourceHints(batch);
          return batch;
        }
        if (pending.length > RECORD_BYTES) bad();
      }
      const recovered = this.files.recoveryAfterTail(segment, offset, budget);
      if (recovered) {
        const batch = {
          rows: recovered.rows,
          pointer: {
            segment: recovered.segment,
            offset: 0,
            bytes: recovered.bytes,
            seq: recovered.marker.last,
          },
          previous: recovered.marker.previous,
          navigationRoot: recovered.marker.navigationRoot,
          next: { segment: recovered.segment, offset: recovered.bytes },
        };
        this.rememberBoundary(
          batch.pointer,
          recovered.marker.navigationRoot,
          budget,
        );
        return batch;
      }
      this.tails.set(budget, true);
      return null; // No explicit bridge: preserve the original final tail.
    }
  }
  private rememberBoundary(
    p: Pointer,
    root: string | null | undefined,
    budget: HistoryReadBudget,
  ): void {
    let roots = this.roots.get(budget);
    if (!roots) {
      roots = new Map();
      this.roots.set(budget, roots);
    }
    roots.set(p.seq, root);
    let points = this.points.get(budget);
    if (!points) {
      points = new Map();
      this.points.set(budget, points);
    }
    if (points.size >= LIMITS.ownerQueueFrames) {
      const first = points.keys().next().value;
      if (first) points.delete(first);
    }
    points.set(p.seq, { ...p });
  }
  private boundary(
    p: Pointer,
    budget: HistoryReadBudget,
  ): { previous: string; next: Position } {
    return this.batch(p, budget);
  }
  private nextBoundary(
    pos: Position,
    budget: HistoryReadBudget,
  ): LocatedBatch | null {
    // The same original parse proves both membership and traversal. Previously
    // this parsed every JSON line to find a marker, reread the whole batch, then
    // decoded every line again; cold point reads paid that work twice.
    return this.next(pos, budget);
  }
  snapshot(seq: string, budget: HistoryReadBudget): Pointer | null {
    decodeSequence(seq);
    this.files.assertReadFormat(budget);
    if (seq === "0") {
      let roots = this.roots.get(budget);
      if (!roots) {
        roots = new Map();
        this.roots.set(budget, roots);
      }
      roots.set(seq, null);
      return null;
    }
    const proven = this.points.get(budget)?.get(seq);
    if (proven) return { ...proven };
    const hint = this.snapshotHint(seq, budget);
    if (hint) return hint;
    let pos: Position = { segment: 1, offset: 0 },
      previous = "0";
    for (;;) {
      const b = this.nextBoundary(pos, budget);
      if (!b) bad();
      if (b.previous !== previous) bad();
      if (b.pointer.seq === seq) return b.pointer;
      if (BigInt(b.pointer.seq) > BigInt(seq)) bad();
      previous = b.pointer.seq;
      pos = b.next;
    }
  }
  /** Only bounded accelerators; callers doing resumable scans must not restart a
   * full prefix scan just to establish the snapshot on every continuation. */
  snapshotHint(seq: string, budget: HistoryReadBudget): Pointer | undefined {
    decodeSequence(seq);
    this.files.assertReadFormat(budget);
    const hint = this.index("commits", seq, budget);
    if (hint) {
      try {
        const p = pointer(hint);
        if (p.seq !== seq) bad();
        this.boundary(p, budget);
        return p;
      } catch (e) {
        if (e instanceof ContractError && e.code === "receipt-inconclusive")
          throw e;
      }
    }
    // A lost commit accelerator need not force a repeated full prefix when the
    // independently verified current head names this EXACT historical snapshot.
    const latest = this.index("heads", "latest", budget);
    if (latest) {
      try {
        const p = pointer(latest);
        if (p.seq === seq) {
          this.boundary(p, budget);
          return p;
        }
      } catch (error) {
        if (
          error instanceof ContractError &&
          error.code === "receipt-inconclusive"
        )
          throw error;
      }
    }
  }
  snapshotAt(pos: Position, seq: string, budget: HistoryReadBudget): void {
    const b = this.next(pos, budget);
    if (!b || b.pointer.seq !== seq) bad();
    this.boundary(b.pointer, budget);
  }
  hasTail(snapshot: string, budget: HistoryReadBudget): boolean {
    const p = this.snapshot(snapshot, budget);
    try {
      const next = this.nextBoundary(
        p
          ? { segment: p.segment, offset: p.offset + p.bytes }
          : { segment: 1, offset: 0 },
        budget,
      );
      return next === null && this.tails.get(budget) === true;
    } catch (error) {
      if (
        error instanceof ContractError &&
        error.code === "receipt-inconclusive"
      )
        return true;
      throw error;
    }
  }
  latest(budget: HistoryReadBudget): string {
    this.files.assertReadFormat(budget);
    const hint = this.index("heads", "latest", budget);
    let pos: Position = { segment: 1, offset: 0 },
      seq = "0";
    if (hint) {
      try {
        const p = pointer(hint),
          b = this.boundary(p, budget);
        pos = b.next;
        seq = p.seq;
      } catch (e) {
        if (e instanceof ContractError && e.code === "receipt-inconclusive")
          throw e;
      }
    }
    for (;;) {
      const b = this.nextBoundary(pos, budget);
      if (!b) return seq;
      if (b.previous !== seq) bad();
      pos = b.next;
      seq = b.pointer.seq;
    }
  }
  publishActive(
    lease: OwnerLease,
    seq: string,
    runs: { runId: string; taskId: string }[],
    charge: (bytes: number) => void,
  ): void {
    // A progress commit usually does not change the active roster. The immutable
    // root already binds its last change; rewriting/fsyncing identical derived
    // membership at every watermark adds no integrity or freshness evidence.
    const old = this.files.files.read(this.indexPath("heads", "active"));
    if (old) {
      const previous = closed(parseWireJson(old.bytes.toString("utf8")), [
        "seq",
        "runs",
      ]);
      if (canonicalJson(previous.runs) === canonicalJson(runs)) return;
    }
    this.write(lease, "heads", "active", { seq, runs }, charge, true);
  }
  active(
    snapshot: string,
    budget: HistoryReadBudget,
  ): { runId: string; taskId: string }[] {
    if (snapshot === "0") return [];
    try {
      const value = this.index("heads", "active", budget);
      if (!value) throw new ContractError("receipt-inconclusive");
      const o = closed(value, ["seq", "runs"]);
      const expected = this.anchoredHead(ACTIVE_KEY, snapshot, budget);
      if (!expected || expected.hash !== hash(canonicalJson(o.runs)))
        throw new ContractError("receipt-inconclusive");
      if (
        BigInt(decodeSequence(o.seq)) > BigInt(snapshot) ||
        BigInt(decodeSequence(o.seq)) < BigInt(expected.seq) ||
        !Array.isArray(o.runs) ||
        o.runs.length > LIMITS.episodes
      )
        throw new ContractError("receipt-inconclusive");
      return o.runs.map((v) => {
        const r = closed(v, ["runId", "taskId"]);
        return { runId: decodeId(r.runId), taskId: decodeId(r.taskId) };
      });
    } catch {
      budget.reserve(0);
      const runs = new Map<string, RunState>();
      for (const b of this.scanSnapshot(snapshot, budget)) {
        for (const row of b.rows) {
          const v = row.value;
          if (v.kind === "recovery") runs.clear();
          if (
            v.kind === "admission" &&
            v.intent.identity.kind === "action" &&
            v.intent.runId
          ) {
            if (runs.size >= LIMITS.episodes || runs.has(v.intent.runId)) bad();
            runs.set(v.intent.runId, new RunState(v.intent.runId));
          }
          for (const state of runs.values()) state.apply(row, b.pointer.seq);
        }
        for (const [id, state] of runs) if (state.drained) runs.delete(id);
      }
      return [...runs.values()].flatMap((r) =>
        r.admission?.context.task
          ? [{ runId: r.runId, taskId: r.admission.context.task.id }]
          : [],
      );
    }
  }
  /** Bounded authoritative fallback, never installed as an index on a read. */
  *scanSnapshot(
    snapshot: string,
    budget: HistoryReadBudget,
  ): Generator<LocatedBatch> {
    if (snapshot === "0") return;
    let pos: Position = { segment: 1, offset: 0 },
      previous = "0";
    for (;;) {
      const b = this.next(pos, budget);
      if (
        !b ||
        b.previous !== previous ||
        BigInt(b.pointer.seq) > BigInt(snapshot)
      )
        bad();
      yield b;
      if (b.pointer.seq === snapshot) return;
      previous = b.pointer.seq;
      pos = b.next;
    }
  }
  *reverseBatches(
    id: string,
    snapshot: string,
    budget: HistoryReadBudget,
    roster = false,
  ): Generator<LocatedBatch> {
    let oldest: string | undefined;
    try {
      for (const batch of this.indexedReverseBatches(
        id,
        snapshot,
        budget,
        roster,
      )) {
        oldest = batch.pointer.seq;
        yield batch;
      }
    } catch {
      budget.reserve(0);
      // Already validated/yielded suffix is not duplicated if a later hint is lost.
      for (const batch of [...this.scanSnapshot(snapshot, budget)].reverse())
        if (oldest === undefined || BigInt(batch.pointer.seq) < BigInt(oldest))
          yield batch;
    }
  }

  private *indexedReverseBatches(
    id: string,
    snapshot: string,
    budget: HistoryReadBudget,
    roster = false,
  ): Generator<LocatedBatch> {
    const expected = this.anchoredHead(
      roster ? `roster:${id}` : id,
      snapshot,
      budget,
    );
    if (expected === undefined) throw new ContractError("receipt-inconclusive");
    let head: IndexHead | null = expected;
    while (head) {
      const link = this.link(
        roster ? "roster-links" : "entity-links",
        id,
        head,
        budget,
      );
      yield this.batch(link.pointer, budget);
      head = link.previous;
    }
  }
  /** The validated link at `head` and its predecessor; throws unless it chains. */
  private link(
    group: string,
    id: string,
    head: IndexHead,
    budget: HistoryReadBudget,
  ): { pointer: ReturnType<typeof pointer>; previous: IndexHead | null } {
    const value = this.index(group, `${id}/${head.seq}`, budget);
    if (!value) throw new ContractError("receipt-inconclusive");
    const o = closed(value, ["pointer", "previous", "previousHash", "hash"]),
      p = pointer(o.pointer);
    const previous = o.previous === null ? null : decodeSequence(o.previous),
      previousHash =
        o.previousHash === null
          ? null
          : typeof o.previousHash === "string"
            ? o.previousHash
            : undefined;
    if (
      previousHash === undefined ||
      (previous === null) !== (previousHash === null) ||
      p.seq !== head.seq ||
      o.hash !== head.hash ||
      chainHash(p.seq, previous, previousHash) !== head.hash ||
      (previous !== null && BigInt(previous) >= BigInt(p.seq))
    )
      throw new ContractError("receipt-inconclusive");
    return {
      pointer: p,
      previous:
        previous !== null && previousHash !== null
          ? { seq: previous, hash: previousHash }
          : null,
    };
  }
  /** A task's original batches newer than the newest chain link at or before
   * `snapshot` that `accept` resumes (an in-process remembered state), in
   * commit order, with that state. Undefined (none accepted, any index fault)
   * means fold the original chain instead; exhaustion still propagates. */
  taskSuffix<T>(
    taskId: string,
    snapshot: string,
    budget: HistoryReadBudget,
    accept: (head: IndexHead) => T | undefined,
  ): { base: T; batches: LocatedBatch[] } | undefined {
    decodeId(taskId);
    try {
      let head = this.anchoredHead(taskId, snapshot, budget) ?? null;
      const newer: LocatedBatch[] = [];
      while (head) {
        const base = accept(head);
        if (base !== undefined) return { base, batches: newer.reverse() };
        const link = this.link("entity-links", taskId, head, budget);
        newer.push(this.batch(link.pointer, budget));
        head = link.previous;
      }
    } catch {
      budget.reserve(0);
    }
    return;
  }
  runBatches(
    id: string,
    snapshot: string,
    budget: HistoryReadBudget,
  ): LocatedBatch[] | undefined {
    const expected = this.anchoredHead(id, snapshot, budget);
    if (expected === undefined) return;
    if (expected === null) return [];
    try {
      const value = this.index("run-locators", id, budget);
      if (!value) return;
      const o = closed(value, ["pointers"]);
      if (!Array.isArray(o.pointers) || o.pointers.length > 512) return;
      const pointers = o.pointers
        .map(pointer)
        .filter((p) => BigInt(p.seq) <= BigInt(expected.seq));
      let seq: string | null = null,
        proof: string | null = null;
      for (const p of pointers) {
        if (seq !== null && BigInt(seq) >= BigInt(p.seq)) return;
        proof = chainHash(p.seq, seq, proof);
        seq = p.seq;
      }
      if (seq !== expected.seq || proof !== expected.hash) return;
      return pointers.map((p) => this.batch(p, budget));
    } catch {
      budget.reserve(0);
      return;
    }
  }

  entityBatches(
    id: string,
    snapshot: string,
    budget: HistoryReadBudget,
  ): LocatedBatch[] | undefined {
    decodeId(id);
    const head = this.anchoredHead(id, snapshot, budget);
    if (head === null) return [];
    return [...this.reverseBatches(id, snapshot, budget)].reverse();
  }
  content(
    id: string,
    snapshot: string,
    budget: HistoryReadBudget,
  ): RetainedDetail | undefined {
    decodeId(id);
    const hint = this.index("contents", id, budget);
    if (!hint) return;
    try {
      const o = closed(hint, ["pointer"]),
        p = pointer(o.pointer);
      if (BigInt(p.seq) > BigInt(snapshot)) return;
      const batch = this.batch(p, budget);
      for (const row of batch.rows)
        if (row.value.kind === "capture" || row.value.kind === "owner")
          for (const e of row.value.events)
            if (e.kind === "end" && e.detail.content.recordId === id)
              return e.detail;
    } catch (e) {
      if (e instanceof ContractError && e.code === "receipt-inconclusive")
        throw e;
    }
  }
  /** Range hints choose a candidate only. The reader subsequently verifies that
   * candidate's ORIGINAL committed chunks cover the requested offset and checks
   * the selected artifact hash. A bad/stale hint refuses, never means absence. */
  partRange(
    id: string,
    part: number,
    budget: HistoryReadBudget,
  ): { first: number; last: number } {
    decodeId(id);
    const hint = this.index("parts", `${id}/${part}`, budget);
    if (!hint) throw new ContractError("receipt-inconclusive");
    try {
      const o = closed(hint, ["pointer", "first", "last", "part"]);
      pointer(o.pointer);
      literal(o.part, part);
      const first = integer(o.first, 0, LIMITS.detailBytes),
        last = integer(o.last, first + 1, LIMITS.detailBytes);
      return { first, last };
    } catch {
      // Only untrusted accelerator decoding is caught, never source/artifact IO.
      throw new ContractError("receipt-inconclusive");
    }
  }
  partCount(id: string, budget: HistoryReadBudget): number {
    const hint = this.index("part-heads", id, budget);
    if (!hint) throw new ContractError("receipt-inconclusive");
    try {
      return integer(closed(hint, ["count"]).count, 1, LIMITS.dataFrames);
    } catch {
      throw new ContractError("receipt-inconclusive");
    }
  }
  part(
    id: string,
    part: number,
    snapshot: string,
    budget: HistoryReadBudget,
  ): Extract<SavedEvent, { kind: "chunk" }>[] | undefined {
    const hint = this.index("parts", `${id}/${part}`, budget);
    if (!hint) return;
    try {
      const o = closed(hint, ["pointer", "first", "last", "part"]),
        p = pointer(o.pointer);
      integer(o.first);
      integer(o.last);
      literal(o.part, part);
      if (BigInt(p.seq) > BigInt(snapshot)) return;
      const chunks = this.batch(p, budget).rows.flatMap((row) =>
        row.value.kind === "owner" || row.value.kind === "capture"
          ? row.value.events.flatMap((e) =>
              e.kind === "chunk" &&
              e.artifact.artifactId === id &&
              e.artifact.part === part
                ? [e]
                : [],
            )
          : [],
      );
      const last = chunks.at(-1);
      if (
        !last ||
        chunks[0].offset !== o.first ||
        last.offset + last.length !== o.last
      )
        bad();
      return chunks;
    } catch (e) {
      if (e instanceof ContractError && e.code === "receipt-inconclusive")
        throw e;
    }
  }
}
/** Single private metadata routing owner; bodies/offsets never become public IDs. */
export function navigationKeys(row: JournalRow): string[] {
  const v = row.value,
    keys = new Set<string>();
  if (v.kind === "admission") {
    keys.add(v.intent.commandId);
    keys.add(v.intent.operationId);
    if (v.intent.runId) keys.add(v.intent.runId);
    if (v.intent.identity.kind === "action") {
      const t = v.intent.createdTaskId ?? v.intent.identity.expected.task?.id;
      if (t) keys.add(t);
      if (v.intent.identity.action.kind === "create")
        keys.add(v.intent.identity.expected.workspaceId);
    }
  }
  if (v.kind === "auth-preparation") {
    keys.add(v.intent.runId);
    keys.add(v.intent.operationId);
  }
  if (v.kind === "auth-settlement") keys.add(v.result.operationId);
  if (v.kind === "launch" || v.kind === "settlement") {
    keys.add(v.link.runId);
    keys.add(v.link.childRunId);
  }
  if (v.kind === "owner") {
    keys.add(v.link.operationId);
    if (v.events.some((e) => e.kind === "owner" && e.value.kind === "fact")) {
      keys.add(v.link.taskId);
      if (v.link.runId) keys.add(v.link.runId);
    }
  }
  if (v.kind === "owner" || v.kind === "capture")
    for (const e of v.events) {
      if (e.kind === "end") {
        if (v.kind === "capture") keys.add(v.link.runId);
        keys.add(e.detail.owner.entity.id);
        keys.add(e.detail.content.recordId);
      }
      if (e.kind === "capture") {
        const event = e.value.event;
        if ("messageId" in event) keys.add(event.messageId);
        if ("callId" in event) keys.add(event.callId);
        if (event.kind === "detail-begin" || event.kind === "omitted-block") {
          const o =
            event.kind === "detail-begin"
              ? event.descriptor.owner
              : event.block.owner;
          if ("messageId" in o) keys.add(o.messageId);
          if ("callId" in o) keys.add(o.callId);
        }
        if (
          ["ready", "final", "worker-failure", "capture-status"].includes(
            event.kind,
          ) &&
          v.kind === "capture"
        ) {
          keys.add(v.link.runId);
          keys.add(v.link.childRunId);
        }
      }
      if (e.kind === "owner" && e.value.kind === "fact") {
        const f = e.value.fact;
        if (f.kind === "parent-admitted") {
          if (f.identity.graph) keys.add(f.identity.graph.recordId);
          for (const a of f.identity.assignments) keys.add(a.childRunId);
        }
        if ("checkId" in f) keys.add(f.checkId);
        if ("observationId" in f) keys.add(f.observationId);
        if ("reviewId" in f) keys.add(f.reviewId);
      }
    }
  return [...keys];
}
