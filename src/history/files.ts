import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  opendirSync,
  openSync,
  statfsSync,
} from "node:fs";
import { open } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  OwnerLease,
  ServiceCoordination,
} from "../service/coordination.ts";
import {
  DirectoryWalks,
  encoded,
  type FileSnapshot,
  hash,
  json,
  type PrivateFiles,
} from "../service/private-files.ts";
import {
  ContractError,
  canonicalJson,
  decodeId,
  LIMITS,
  parseWireJson,
  type RunIdentity,
} from "../service-contract.ts";
import { closed, literal, text } from "../worker-public.mjs";
import { decodeRunAdmission, type RunAdmission } from "./admission.ts";
import { assertIncarnation, statSize } from "./read-io.ts";
import {
  type Artifact,
  batchArtifacts,
  type CommitMarker,
  decodeFormat,
  decodeJournalText,
  encodeJournalText,
  FORMAT,
  type HistoryFormat,
  type JournalRow,
  RECORD_BYTES,
  type RecoveryBridge,
  validBatchSequence,
} from "./types.ts";

export type WriteBoundary =
  | "publication-before-save"
  | "publication-after-save"
  | "intent"
  | "run-admission"
  | "artifacts"
  | "journal"
  | "commit"
  | "checkpoint";
/** Testable IO scheduling boundary only. It cannot replace any native write/flush. */
export type WriteObserver = (boundary: WriteBoundary) => void | Promise<void>;
export interface ScanState {
  navigationRoot?: string | null;
  highSeq?: string;
  committedBytes?: number;
  committedSeq: string;
  segment: number;
  records: number;
  tail: boolean;
  bytes: number;
  identity: string | null;
}
export interface JournalBatch {
  rows: JournalRow[];
  marker: CommitMarker;
  segment: number;
  identity: string;
  segmentBytes: number;
}
/** Per-call native-read admission. A failed reservation performs no payload read. */
export class HistoryReadBudget {
  private readonly started = performance.now();
  bytes = 0;
  /** This call's synchronous directory walks; never outlives an await. */
  readonly walks = new DirectoryWalks();
  reserve(bytes: number): void {
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      this.bytes + bytes > LIMITS.searchBytes ||
      performance.now() - this.started >= LIMITS.searchMs
    )
      throw new ContractError("receipt-inconclusive");
    this.bytes += bytes;
  }
  /** This quantum's wall-clock time ran out, whatever it was spent on. */
  get elapsed(): boolean {
    return performance.now() - this.started >= LIMITS.searchMs;
  }
}
/** A quantum that made no semantic progress because its wall-clock time, not
 * its byte limit, ran out: possibly a host stall (GC, scheduling, scanning).
 * Same refusal code; only the read's own entry may repeat it afresh. */
export class StalledQuantum extends ContractError {
  constructor() {
    super("receipt-inconclusive");
  }
}
/** Refuse a quantum that made no semantic progress. Nothing is faked: a pure
 * time stall is only marked repeatable; byte exhaustion is final. */
export function noProgress(budget: HistoryReadBudget): never {
  throw budget.elapsed
    ? new StalledQuantum()
    : new ContractError("receipt-inconclusive");
}
/** Fresh quanta that may repeat one stalled quantum before its refusal stands. */
export const STALL_RETRIES = 2;
/** Repeat a whole read whose quantum stalled, with a fresh budget, at most
 * STALL_RETRIES times after yielding a turn. A stalled quantum left no state. */
export async function retryStalled<T>(read: () => Promise<T>): Promise<T> {
  for (let retry = 0; ; retry++) {
    try {
      return await read();
    } catch (error) {
      if (!(error instanceof StalledQuantum) || retry >= STALL_RETRIES)
        throw error;
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
}
/** Repeat a whole single-quantum read, with a fresh budget, when it refused
 * only because that budget's wall-clock time ran out (a host stall), at most
 * STALL_RETRIES times; byte exhaustion and every other refusal stay final. */
export function stallTolerant<T>(read: (budget: HistoryReadBudget) => T): T {
  for (let retry = 0; ; retry++) {
    const budget = new HistoryReadBudget();
    try {
      return read(budget);
    } catch (error) {
      if (
        !(error instanceof ContractError) ||
        error.code !== "receipt-inconclusive" ||
        !budget.elapsed ||
        retry >= STALL_RETRIES
      )
        throw error;
    }
  }
}
function corrupt(): never {
  throw new ContractError("corrupt-selected");
}
// A live owner's readers must not infer durability from page-cache visibility of
// a marker whose original append/sync/close is still pending. One small prefix
// fence per store, shared by readonly opens; failed writes retain it until restart.
// Restart validates preserved bytes, never executes them. This is not a disk lock.
const publicationFences = new Map<string, ScanState>();
// Original queued jobs exist BEFORE append publication fences. Recovery cannot
// override their lifetime with a PID probe or a caller-supplied acknowledgment.
const activity = new Map<string, { pending: number; generation: number }>();

export class HistoryFiles {
  readonly directory: string;
  readonly files: PrivateFiles;
  private proofSnapshot: FileSnapshot | undefined;
  private constructor(
    readonly coordination: ServiceCoordination,
    readonly format: HistoryFormat,
    private readonly formatSnapshot: FileSnapshot,
  ) {
    this.directory = join(coordination.directory, "history-v2");
    this.files = coordination.files;
  }
  static open(coordination: ServiceCoordination): HistoryFiles | undefined {
    const dir = join(coordination.directory, "history-v2");
    if (!coordination.files.directory(dir)) return undefined;
    const file = coordination.files.read(join(dir, "format.json"));
    if (!file) corrupt();
    const format = decodeFormat(json(file));
    if (format.rootIdentity !== hash(coordination.store.root)) corrupt();
    return new HistoryFiles(coordination, format, file);
  }
  static initialize(lease: OwnerLease): HistoryFiles {
    lease.assert();
    const c = lease.coordination;
    const existing = HistoryFiles.open(c);
    if (existing) {
      existing.assertWritable();
      return existing;
    }
    const dir = join(c.directory, "history-v2");
    const format: HistoryFormat = {
      schema: FORMAT,
      storeId: randomUUID(),
      workspaceId: randomUUID(),
      rootIdentity: hash(c.store.root),
    };
    c.files.directory(dir, true);
    for (const name of ["commands", "ledger", "runs", "indexes"]) {
      lease.assert();
      c.files.directory(join(dir, name), true);
    }
    lease.assert();
    // Publish key and its durability attempts BEFORE the final format marker.
    // A crash leaves an incomplete namespace that open()/initialize() refuse.
    const keyPath = join(dir, "read-proof-key.json");
    c.files.create(
      keyPath,
      encoded({
        schema: "cadence-history-read-key/1",
        storeId: format.storeId,
        key: randomBytes(32).toString("base64url"),
      }),
    );
    lease.assert();
    const snapshot = c.files.create(join(dir, "format.json"), encoded(format));
    const result = new HistoryFiles(c, format, snapshot);
    result.syncParents(join(dir, "format.json"));
    result.assertWritable();
    return result;
  }
  private activity() {
    const key = `${this.directory}/${this.format.storeId}`;
    let state = activity.get(key);
    if (!state) {
      state = { pending: 0, generation: 0 };
      activity.set(key, state);
    }
    return state;
  }
  get writeGeneration(): number {
    return this.activity().generation;
  }
  assertWriteGeneration(generation: number): void {
    if (generation !== this.writeGeneration)
      throw new ContractError("quarantine");
  }
  retainOriginal(generation: number): () => void {
    this.assertWriteGeneration(generation);
    if (publicationFences.has(this.directory) && !this.activity().pending)
      throw new ContractError("quarantine");
    const state = this.activity();
    state.pending++;
    return () => {
      state.pending--;
    };
  }
  assertRecoveryIdle(): void {
    if (this.activity().pending || publicationFences.has(this.directory))
      throw new ContractError("quarantine");
  }
  assertFormat(): void {
    this.files.assert(join(this.directory, "format.json"), this.formatSnapshot);
  }
  /** Private navigation key only; never passed to journal, projections or workers.
   * Stateless legacy reads do not need this key. Warm users pin its incarnation;
   * cold tokens independently bind both selected stamps in authenticated AAD. */
  readProofMaterial(budget?: HistoryReadBudget): {
    key: Buffer;
    formatStamp: string;
    keyStamp: string;
    readBytes: number;
  } {
    if (this.format.schema !== FORMAT)
      throw new ContractError("unsupported-context");
    if (budget) this.assertReadFormat(budget);
    else this.assertFormat();
    const selected = this.readBudgeted(
      join(this.directory, "read-proof-key.json"),
      512,
      budget,
    );
    if (
      !selected ||
      (this.proofSnapshot &&
        (selected.identity !== this.proofSnapshot.identity ||
          selected.stamp !== this.proofSnapshot.stamp))
    )
      corrupt();
    try {
      const record = closed(
        parseWireJson(
          new TextDecoder("utf-8", { fatal: true }).decode(selected.bytes),
          512,
        ),
        ["schema", "storeId", "key"],
      );
      literal(record.schema, "cadence-history-read-key/1");
      if (decodeId(record.storeId) !== this.format.storeId) corrupt();
      const value = text(record.key, 43, true),
        key = Buffer.from(value, "base64url");
      if (
        !/^[A-Za-z0-9_-]{43}$/.test(value) ||
        key.length !== 32 ||
        key.toString("base64url") !== value
      )
        corrupt();
      this.proofSnapshot ??= selected;
      return {
        key,
        formatStamp: this.formatSnapshot.stamp,
        keyStamp: selected.stamp,
        readBytes: this.formatSnapshot.bytes.length + selected.bytes.length,
      };
    } catch {
      return corrupt();
    }
  }
  assertWritable(): void {
    if (!this.proofSnapshot) {
      this.readProofMaterial();
      return;
    }
    this.assertFormat();
    // The writer does not consume the key for each capture reservation. Pin the
    // originally decoded private immutable file; detect supported replacement,
    // edits and unsafe metadata without re-reading/re-decoding it per frame.
    assertIncarnation(
      this,
      join(this.directory, "read-proof-key.json"),
      this.proofSnapshot.stamp,
    );
  }
  segmentPath(segment: number): string {
    return join(
      this.directory,
      "ledger",
      `${String(segment).padStart(12, "0")}.jsonl`,
    );
  }
  artifactPath(ref: Artifact): string {
    return join(
      this.directory,
      "runs",
      ref.runId,
      "artifacts",
      ref.artifactId,
      `${ref.part}.part`,
    );
  }
  admissionPath(runId: string): string {
    decodeId(runId);
    return join(this.directory, "runs", runId, "admission.json");
  }
  writeAdmission(lease: OwnerLease, input: RunAdmission): void {
    lease.assert();
    this.assertWritable();
    const value = decodeRunAdmission(input);
    this.files.create(
      this.admissionPath(value.runId),
      encoded(value),
      RECORD_BYTES,
    );
    this.syncParents(this.admissionPath(value.runId));
  }
  private readBudgeted(
    path: string,
    maximum: number,
    budget?: HistoryReadBudget,
  ): FileSnapshot | undefined {
    if (!budget) return this.files.read(path, maximum);
    // Reserve actual selected size BEFORE PrivateFiles allocates/reads. A grow
    // between stat/read exceeds the same reserved ceiling and refuses.
    let size: number;
    try {
      size = lstatSync(path).size;
    } catch {
      return this.files.read(path, 0, budget.walks);
    } // Absence still validated by PrivateFiles; any existing payload refuses.
    if (size > maximum) corrupt();
    budget.reserve(size);
    return this.files.read(path, size, budget.walks);
  }
  readCommand(
    commandId: string,
    budget: HistoryReadBudget,
  ): FileSnapshot | undefined {
    decodeId(commandId);
    this.assertReadFormat(budget);
    return this.readBudgeted(
      join(this.directory, "commands", commandId, "intent.json"),
      RECORD_BYTES,
      budget,
    );
  }
  readAdmission(
    runId: string,
    identity: RunIdentity,
    budget?: HistoryReadBudget,
  ): RunAdmission {
    return this.readAdmissionIdentity(
      runId,
      hash(canonicalJson(identity)),
      budget,
    );
  }
  /** Finite validator's selected original-source identity, not a caller receipt. */
  readAdmissionIdentity(
    runId: string,
    identity: string,
    budget?: HistoryReadBudget,
  ): RunAdmission {
    if (budget) this.assertReadFormat(budget);
    else this.assertFormat();
    const file = this.readBudgeted(
      this.admissionPath(runId),
      RECORD_BYTES,
      budget,
    );
    if (!file) corrupt();
    const value = decodeRunAdmission(json(file, RECORD_BYTES));
    if (
      value.runId !== runId ||
      hash(canonicalJson(value.identity)) !== identity
    )
      corrupt();
    return value;
  }
  syncParents(file: string): void {
    if (process.platform === "win32") return;
    for (let path = dirname(file); ; path = dirname(path)) {
      if (!this.files.directory(path)) corrupt();
      const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY);
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      if (path === this.coordination.directory) break;
      if (path === dirname(path)) corrupt();
    }
  }
  assertReadFormat(budget: HistoryReadBudget): void {
    budget.reserve(this.formatSnapshot.bytes.length);
    this.files.assert(
      join(this.directory, "format.json"),
      this.formatSnapshot,
      this.formatSnapshot.bytes.length,
    );
  }
  assertPublished(segment: number, end: number, seq: string): void {
    const fence = publicationFences.get(this.directory);
    if (
      fence &&
      (BigInt(seq) > BigInt(fence.committedSeq) ||
        segment > fence.segment ||
        (segment === fence.segment && end > fence.bytes))
    )
      throw new ContractError("receipt-inconclusive");
  }
  readArtifact(ref: Artifact, budget?: HistoryReadBudget): Buffer {
    if (budget) this.assertReadFormat(budget);
    else this.assertFormat();
    const file = this.readBudgeted(
      this.artifactPath(ref),
      LIMITS.artifactPartBytes,
      budget,
    );
    if (
      !file ||
      file.bytes.length !== ref.bytes ||
      file.identity !== ref.sha256
    )
      corrupt();
    // Validate complete UTF-8; independently chunked artifacts never split code points.
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
    } catch {
      corrupt();
    }
    return file.bytes;
  }
  writeArtifact(lease: OwnerLease, ref: Artifact, text: string): void {
    lease.assert();
    this.assertWritable();
    if (Buffer.byteLength(text) !== ref.bytes || hash(text) !== ref.sha256)
      corrupt();
    this.files.create(this.artifactPath(ref), text, LIMITS.artifactPartBytes);
    this.syncParents(this.artifactPath(ref));
  }
  /** Every retained/orphan/index byte counts. Bounded depth/one descriptor per level;
   * no accumulated directory listing and no cleanup. Unsafe entries refuse. */
  usage(): number {
    const walk = (path: string, depth: number): number => {
      if (depth > 8 || !this.files.directory(path)) corrupt();
      let bytes = 0;
      const dir = opendirSync(path);
      try {
        for (let e = dir.readSync(); e; e = dir.readSync()) {
          const p = join(path, e.name),
            st = lstatSync(p);
          if (st.isDirectory()) bytes += walk(p, depth + 1);
          else {
            bytes += statSize(this, p, LIMITS.segmentBytes);
          }
          if (!Number.isSafeInteger(bytes)) corrupt();
        }
      } finally {
        dir.closeSync();
      }
      return bytes;
    };
    return walk(this.directory, 0);
  }
  freeBytes(): number {
    const s = statfsSync(this.directory, { bigint: true });
    return Number(s.bavail * s.bsize);
  }
  /** Scans bounded segments and pending batches. Only a marker with intact actual
   * referenced bytes publishes rows. Never truncates, skips or repairs a tail. */
  *scan(
    state: ScanState = emptyScan(),
    verifyArtifacts = true,
    budget?: HistoryReadBudget,
    throughSegment = Number.MAX_SAFE_INTEGER,
  ): Generator<JournalBatch> {
    if (budget) this.assertReadFormat(budget);
    else this.assertFormat();
    state.committedSeq = "0";
    state.highSeq = "0";
    state.committedBytes = 0;
    state.navigationRoot = undefined;
    state.segment = 0;
    state.records = 0;
    state.tail = false;
    state.bytes = 0;
    state.identity = null;
    let count = 0;
    const ledger = join(this.directory, "ledger");
    if (!this.files.directory(ledger)) corrupt();
    const dir = opendirSync(ledger);
    try {
      for (let e = dir.readSync(); e; e = dir.readSync()) {
        budget?.reserve(0);
        if (!/^[0-9]{12}\.jsonl$/.test(e.name) || !e.isFile()) corrupt();
        count++;
      }
    } finally {
      dir.closeSync();
    }
    const fence = publicationFences.get(this.directory);
    if (fence) count = Math.min(count, fence.segment);
    count = Math.min(count, throughSegment);
    for (let n = 1; n <= count; n++) {
      let file = this.readBudgeted(
        this.segmentPath(n),
        LIMITS.segmentBytes,
        budget,
      );
      if (!file) corrupt();
      if (fence && n === fence.segment) {
        if (file.bytes.length < fence.bytes) corrupt();
        const bytes = file.bytes.subarray(0, fence.bytes);
        if (hash(bytes) !== fence.identity) corrupt();
        file = { ...file, bytes, identity: hash(bytes) };
      }
      const preceding = { ...state };
      state.segment = n;
      state.committedBytes = 0;
      state.tail = false;
      state.bytes = file.bytes.length;
      state.identity = file.identity;
      state.records = 0;
      let at = 0,
        pending: JournalRow[] = [],
        pendingBytes = 0,
        checksum = createHash("sha256");
      while (at < file.bytes.length) {
        budget?.reserve(0);
        const end = file.bytes.indexOf(10, at);
        if (end < 0) {
          state.tail = true;
          break;
        }
        const line = file.bytes.subarray(at, end + 1);
        if (line.length > RECORD_BYTES) corrupt();
        let decoded: JournalRow | CommitMarker;
        try {
          decoded = decodeJournalText(
            new TextDecoder("utf-8", { fatal: true }).decode(line),
          );
        } catch {
          corrupt();
        }
        at = end + 1;
        state.records++;
        if (state.records > LIMITS.segmentRecords) corrupt();
        if (decoded.kind === "record") {
          let base = state.committedSeq;
          if (decoded.value.kind === "recovery") {
            if (
              pending.length ||
              at !== line.length ||
              n !== decoded.value.previous.segment + 1
            )
              corrupt();
            if (
              decoded.value.previous.segment !== preceding.segment ||
              decoded.value.previous.bytes !== preceding.bytes ||
              decoded.value.previous.sha256 !==
                (preceding.identity ?? hash("")) ||
              decoded.value.previous.committedSeq !== preceding.committedSeq ||
              decoded.value.previous.highSeq !==
                (preceding.highSeq ?? preceding.committedSeq) ||
              decoded.value.previous.committedBytes !==
                (preceding.committedBytes ?? 0)
            )
              corrupt();
            base = decoded.value.previous.highSeq;
          } else if (preceding.tail && state.committedBytes === 0) corrupt();
          const next = BigInt(base) + BigInt(pending.length) + 1n;
          if (decoded.seq !== String(next)) corrupt();
          state.highSeq = decoded.seq;
          pendingBytes += line.length;
          if (pendingBytes > 2 * RECORD_BYTES) corrupt();
          pending.push(decoded);
          checksum.update(line);
          continue;
        }
        const artifacts = batchArtifacts(pending);
        if (
          !pending.length ||
          !validBatchSequence(pending, decoded.previous) ||
          decoded.previous !== state.committedSeq ||
          decoded.first !== pending[0].seq ||
          decoded.last !== pending.at(-1)?.seq ||
          decoded.count !== pending.length ||
          decoded.sha256 !== checksum.digest("hex") ||
          canonicalJson(decoded.artifacts, RECORD_BYTES) !==
            canonicalJson(artifacts, RECORD_BYTES)
        )
          corrupt();
        if (verifyArtifacts)
          for (const artifact of artifacts) this.readArtifact(artifact, budget);
        // Immutable admission bytes are required membership, not an index.
        for (const row of pending) {
          const v = row.value;
          if (v.kind !== "owner") continue;
          for (const e of v.events)
            if (
              e.kind === "owner" &&
              e.value.kind === "fact" &&
              e.value.fact.kind === "parent-admitted"
            )
              this.readAdmission(
                e.value.fact.runId,
                e.value.fact.identity,
                budget,
              );
        }
        state.committedSeq = decoded.last;
        state.committedBytes = at;
        state.navigationRoot = decoded.navigationRoot;
        yield {
          rows: pending,
          marker: decoded,
          segment: n,
          identity: file.identity,
          segmentBytes: file.bytes.length,
        };
        pending = [];
        pendingBytes = 0;
        checksum = createHash("sha256");
      }
      if (pending.length) state.tail = true;
      if (state.tail && n !== count) {
        // Only the explicit, intact next bridge can cross this preserved final tail.
        const next = this.recoveryAfterTail(
          n,
          state.committedBytes ?? 0,
          budget,
        );
        if (!next) corrupt();
      }
    }
    if (fence && fence.segment <= throughSegment) {
      if (state.committedSeq !== fence.committedSeq) corrupt();
      state.tail = true;
    }
  }
  /** Verify the exact preserved previous segment, not just a hash of a projection. */
  validateRecovery(bridge: RecoveryBridge, budget?: HistoryReadBudget): void {
    const p = bridge.previous;
    if (p.segment === 0) {
      if (
        p.bytes ||
        p.committedBytes ||
        p.committedSeq !== "0" ||
        p.highSeq !== "0" ||
        p.sha256 !== hash("")
      )
        corrupt();
      return;
    }
    // Use the SAME authoritative scanner to prove the predecessor's committed
    // offset and highest complete row. A matching byte hash alone cannot attest
    // those claimed facts. Stop before the bridge to avoid recursive validation.
    const prior = emptyScan();
    for (const _ of this.scan(prior, false, budget, p.segment)) {
      /* validate */
    }
    if (
      prior.segment !== p.segment ||
      prior.bytes !== p.bytes ||
      prior.identity !== p.sha256 ||
      prior.committedBytes !== p.committedBytes ||
      prior.committedSeq !== p.committedSeq ||
      prior.highSeq !== p.highSeq
    )
      corrupt();
  }
  recoveryAfterTail(
    segment: number,
    committedOffset: number,
    budget?: HistoryReadBudget,
  ): {
    rows: JournalRow[];
    marker: CommitMarker;
    bytes: number;
    segment: number;
  } | null {
    const next = this.readBudgeted(
      this.segmentPath(segment + 1),
      LIMITS.segmentBytes,
      budget,
    );
    if (!next) return null;
    const first = next.bytes.indexOf(10),
      second = next.bytes.indexOf(10, first + 1);
    if (first < 0 || second < 0) corrupt();
    const row = decodeJournalText(
      new TextDecoder("utf-8", { fatal: true }).decode(
        next.bytes.subarray(0, first + 1),
      ),
    );
    const marker = decodeJournalText(
      new TextDecoder("utf-8", { fatal: true }).decode(
        next.bytes.subarray(first + 1, second + 1),
      ),
    );
    if (
      row.kind !== "record" ||
      row.value.kind !== "recovery" ||
      marker.kind !== "commit" ||
      row.value.previous.segment !== segment ||
      row.value.previous.committedBytes !== committedOffset ||
      marker.count !== 1 ||
      marker.first !== row.seq ||
      marker.last !== row.seq ||
      !validBatchSequence([row], marker.previous) ||
      marker.sha256 !== hash(next.bytes.subarray(0, first + 1)) ||
      marker.artifacts.length
    )
      corrupt();
    this.validateRecovery(row.value, budget);
    this.assertPublished(segment + 1, second + 1, marker.last);
    return { rows: [row], marker, bytes: second + 1, segment: segment + 1 };
  }
  /** Exclusive new segment, no append to/truncation of damaged original bytes.
   * Authority and original-owner absence belong to the REQUIRED W1 caller guard. */
  async appendRecovery(
    state: ScanState,
    row: JournalRow,
    assertCurrent: () => Promise<void>,
    observer?: WriteObserver,
  ): Promise<{ state: ScanState; snapshot: FileSnapshot }> {
    this.assertWritable();
    this.assertRecoveryIdle();
    if (row.value.kind !== "recovery") throw new ContractError("quarantine");
    await assertCurrent();
    this.assertWritable();
    this.assertRecoveryIdle();
    this.validateRecovery(row.value);
    const { body, trailer, marker } = this.encodeBatch(state, [row]);
    const segment = state.segment + 1,
      path = this.segmentPath(segment);
    publicationFences.set(this.directory, { ...state });
    // Retire existing writer handles even if a later recovery write fails. A new
    // writer must independently scan the preserved bridge/tail before admission.
    this.activity().generation++;
    // Exclusive creation is also the competing-recovery fence. Failed bytes stay.
    const before = this.files.create(path, "", LIMITS.segmentBytes);
    let committed: FileSnapshot | undefined;
    const fd = await open(
      path,
      constants.O_WRONLY | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0),
    );
    const assertOriginal = (bytes: string): FileSnapshot => {
      const original = fstatSync(fd.fd),
        selected = lstatSync(path);
      if (
        original.dev !== selected.dev ||
        original.ino !== selected.ino ||
        original.nlink !== 1
      )
        corrupt();
      const snapshot = this.files.read(path, LIMITS.segmentBytes);
      if (!snapshot || snapshot.identity !== hash(bytes)) corrupt();
      return snapshot;
    };
    try {
      await assertCurrent();
      this.assertWritable();
      this.files.assert(path, before, LIMITS.segmentBytes);
      assertOriginal("");
      await fd.writeFile(body);
      await observer?.("journal");
      await assertCurrent();
      this.assertWritable();
      assertOriginal(body);
      await fd.writeFile(trailer);
      await fd.sync();
      this.syncParents(path);
      await observer?.("commit");
      await assertCurrent();
      this.assertWritable();
      committed = assertOriginal(body + trailer);
    } finally {
      await fd.close();
    }
    // Original close is an asynchronous boundary too. Never publish or hand off
    // a replacement bridge/prefix as if it were this original committed write.
    await assertCurrent();
    this.assertWritable();
    if (!committed) corrupt();
    this.files.assert(path, committed, LIMITS.segmentBytes);
    publicationFences.delete(this.directory);
    return {
      snapshot: committed,
      state: {
        committedSeq: marker.last,
        highSeq: marker.last,
        segment,
        records: 2,
        tail: false,
        bytes: Buffer.byteLength(body + trailer),
        committedBytes: Buffer.byteLength(body + trailer),
        identity: hash(body + trailer),
        navigationRoot: undefined,
      },
    };
  }
  inspect(): ScanState {
    const state = emptyScan();
    for (const _ of this.scan(state)) {
      /* validate to original EOF */
    }
    return state;
  }
  encodeBatch(
    state: ScanState,
    rows: JournalRow[],
    navigationRoot?: string | null,
  ): {
    body: string;
    trailer: string;
    marker: CommitMarker;
    rowBytes: number[];
  } {
    if (!rows.length) throw new ContractError("invalid");
    const lines = rows.map(encodeJournalText);
    const body = lines.join("");
    if (Buffer.byteLength(body) > 2 * RECORD_BYTES)
      throw new ContractError("oversize");
    const marker: CommitMarker = {
      kind: "commit",
      ...(navigationRoot !== undefined ? { navigationRoot } : {}),
      previous: state.committedSeq,
      first: rows[0].seq,
      last: rows[rows.length - 1].seq,
      count: rows.length,
      sha256: hash(body),
      artifacts: batchArtifacts(rows),
    };
    const trailer = encodeJournalText(marker);
    return {
      body,
      trailer,
      marker,
      rowBytes: lines.map((line) => Buffer.byteLength(line)),
    };
  }
  async append(
    lease: OwnerLease,
    state: ScanState,
    rows: JournalRow[],
    observer?: WriteObserver,
    navigationRoot?: string | null,
    beforeAppend?: (size: {
      rowBytes: readonly number[];
      trailerBytes: number;
    }) => void,
    beforeEffect?: () => void,
  ): Promise<ScanState> {
    this.assertWritable();
    beforeEffect?.();
    if (publicationFences.has(this.directory))
      throw new ContractError("quarantine");
    publicationFences.set(this.directory, { ...state });
    const next = await this.appendOriginal(
      lease,
      state,
      rows,
      observer,
      navigationRoot,
      beforeAppend,
      beforeEffect,
    );
    // Only original successful sync, selected-byte validation AND close publish.
    publicationFences.delete(this.directory);
    return next;
  }
  private async appendOriginal(
    lease: OwnerLease,
    state: ScanState,
    rows: JournalRow[],
    observer?: WriteObserver,
    navigationRoot?: string | null,
    beforeAppend?: (size: {
      rowBytes: readonly number[];
      trailerBytes: number;
    }) => void,
    beforeEffect?: () => void,
  ): Promise<ScanState> {
    this.assertWritable();
    beforeEffect?.();
    if (!rows.length || state.tail) throw new ContractError("quarantine");
    const batch = this.encodeBatch(state, rows, navigationRoot);
    // Charge the exact validated encoding before the first filesystem effect.
    // The writer does not independently serialize/validate the same batch twice.
    beforeAppend?.({
      rowBytes: [...batch.rowBytes],
      trailerBytes: Buffer.byteLength(batch.trailer),
    });
    const { body, trailer, marker } = batch;
    let segment = state.segment || 1;
    if (
      state.bytes + Buffer.byteLength(body + trailer) > LIMITS.segmentBytes ||
      state.records + rows.length + 1 > LIMITS.segmentRecords
    )
      segment++;
    lease.assert();
    const path = this.segmentPath(segment);
    let before: FileSnapshot | undefined = this.files.read(
      path,
      LIMITS.segmentBytes,
    );
    if (segment !== state.segment) {
      if (before) corrupt();
      before = this.files.create(path, "", LIMITS.segmentBytes);
    }
    if (
      !before ||
      (segment === state.segment &&
        (before.bytes.length !== state.bytes ||
          before.identity !== state.identity))
    )
      corrupt();
    const fd = await open(
      path,
      constants.O_WRONLY | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      lease.assert();
      this.files.assert(path, before, LIMITS.segmentBytes);
      const opened = await fd.stat(),
        selected = lstatSync(path);
      if (
        opened.ino !== selected.ino ||
        opened.dev !== selected.dev ||
        opened.nlink !== 1
      )
        corrupt();
      beforeEffect?.();
      await fd.writeFile(body);
      await observer?.("journal");
      lease.assert();
      this.assertWritable();
      beforeEffect?.();
      await fd.writeFile(trailer);
      await fd.sync();
      await observer?.("commit");
      lease.assert();
      this.assertWritable();
      const after = this.files.read(path, LIMITS.segmentBytes);
      if (
        !after ||
        after.identity !==
          createHash("sha256")
            .update(before.bytes)
            .update(body)
            .update(trailer)
            .digest("hex")
      )
        corrupt();
      return {
        committedSeq: marker.last,
        highSeq: marker.last,
        committedBytes: after.bytes.length,
        navigationRoot,
        segment,
        records:
          (segment === state.segment ? state.records : 0) + rows.length + 1,
        tail: false,
        bytes: after.bytes.length,
        identity: after.identity,
      };
    } finally {
      await fd.close();
    }
  }
  checkpoint(lease: OwnerLease, state: ScanState): void {
    lease.assert();
    this.assertWritable();
    const path = join(this.directory, "checkpoint.json"),
      old = this.files.read(path);
    const body = encoded({
      schema: "cadence-history-checkpoint/2",
      storeId: this.format.storeId,
      committedSeq: state.committedSeq,
      segment: state.segment,
    });
    if (old) this.files.replace(path, old, body);
    else this.files.create(path, body);
  }
}
export function emptyScan(): ScanState {
  return {
    committedSeq: "0",
    segment: 0,
    records: 0,
    tail: false,
    bytes: 0,
    identity: null,
  };
}
