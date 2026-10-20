/** PRIVATE disk records. Public DTOs remain owned by service-contract/worker-public. */
import { createHash } from "node:crypto";
import type {
  AdmissionIntent,
  AuthPreparationIntent,
  AuthPreparationSettlement,
} from "../service/ports.ts";
import {
  type CaptureCoverage,
  type ContentRef,
  canonicalJson,
  type DetailDescriptor,
  decodeCommandIdentity,
  decodeContentRef,
  decodeCoverage,
  decodeDetailDescriptor,
  decodeOwnerLink,
  decodeOwnerRecordingInput,
  decodeRecordingEvent,
  decodeRecordingLink,
  decodeRecordOwner,
  decodeSourceRange,
  decodeStoredCommand,
  decodeWorkerCompletion,
  LIMITS,
  type OwnerLink,
  type OwnerRecordingEvent,
  type RecordingEvent,
  type RecordingLink,
  type RecordOwner,
  type SourceRange,
  type StoredCommand,
  type WorkerCompletion,
} from "../service-contract.ts";
import {
  bool,
  closed,
  decodeHash,
  decodeId,
  decodeSequence,
  integer,
  invalid,
  list,
  literal,
  nullable,
  oneOf,
} from "../worker-public.mjs";

export const RECORD_BYTES = LIMITS.controlBytes + 64 * 1024;
export const LEGACY_FORMAT = "cadence-history-store/2";
export const FORMAT = "cadence-history-store/3";
export interface HistoryFormat {
  schema: typeof FORMAT | typeof LEGACY_FORMAT;
  storeId: string;
  workspaceId: string;
  rootIdentity: string;
}
export function decodeFormat(value: unknown): HistoryFormat {
  const o = closed(value, ["schema", "storeId", "workspaceId", "rootIdentity"]);
  return {
    schema: oneOf(o.schema, [FORMAT, LEGACY_FORMAT]),
    storeId: decodeId(o.storeId),
    workspaceId: decodeId(o.workspaceId),
    rootIdentity: decodeHash(o.rootIdentity),
  };
}
export interface Artifact {
  runId: string;
  artifactId: string;
  part: number;
  bytes: number;
  sha256: string;
}
export function decodeArtifact(value: unknown): Artifact {
  const o = closed(value, ["runId", "artifactId", "part", "bytes", "sha256"]);
  return {
    runId: decodeId(o.runId),
    artifactId: decodeId(o.artifactId),
    part: integer(o.part),
    bytes: integer(o.bytes, 1, LIMITS.artifactPartBytes),
    sha256: decodeHash(o.sha256),
  };
}
export interface RetainedDetail {
  detailId: string;
  origin: { kind: "worker" | "owner"; id: string };
  owner: RecordOwner;
  descriptor: DetailDescriptor | null;
  content: ContentRef;
  coverage: CaptureCoverage;
}
export function decodeRetainedDetail(value: unknown): RetainedDetail {
  const o = closed(value, [
    "detailId",
    "origin",
    "owner",
    "descriptor",
    "content",
    "coverage",
  ]);
  const origin = closed(o.origin, ["kind", "id"]);
  const r: RetainedDetail = {
    detailId: decodeId(o.detailId),
    origin: {
      kind: oneOf(origin.kind, ["worker", "owner"]),
      id: decodeId(origin.id),
    },
    owner: decodeRecordOwner(o.owner),
    descriptor: nullable(o.descriptor, decodeDetailDescriptor),
    content: decodeContentRef(o.content),
    coverage: decodeCoverage(o.coverage),
  };
  if (
    (r.origin.kind === "worker") !== (r.descriptor !== null) ||
    (r.descriptor && r.content.field !== r.descriptor.field)
  )
    invalid();
  return r;
}
export type SavedEvent =
  | { kind: "capture"; id: string; value: RecordingEvent }
  | { kind: "owner"; id: string; value: OwnerRecordingEvent }
  | {
      kind: "chunk";
      detailId: string;
      source: SourceRange | null;
      artifact: Artifact;
      offset: number;
      start: number;
      length: number;
    }
  | { kind: "end"; detail: RetainedDetail; source: SourceRange | null };
function decodeSavedEvent(value: unknown, owner: OwnerLink | null): SavedEvent {
  const kind = closedTag(value);
  if (kind === "capture") {
    const o = closed(value, ["kind", "id", "value"]),
      v = decodeRecordingEvent(o.value);
    if (
      owner ||
      v.event.kind === "stored-chunk" ||
      v.event.kind === "stored-end"
    )
      invalid();
    return { kind, id: decodeId(o.id), value: v };
  }
  if (kind === "owner") {
    const o = closed(value, ["kind", "id", "value"]);
    if (!owner) invalid();
    const v = decodeOwnerRecordingInput({
      link: owner,
      observedMs: 0,
      events: [o.value],
    }).events[0];
    if (v.kind === "content-chunk" || v.kind === "content-end") invalid();
    return { kind, id: decodeId(o.id), value: v };
  }
  if (kind === "chunk") {
    const o = closed(value, [
      "kind",
      "detailId",
      "source",
      "artifact",
      "offset",
      "start",
      "length",
    ]);
    const source = nullable(o.source, decodeSourceRange);
    if ((source === null) !== (owner !== null)) invalid();
    const artifact = decodeArtifact(o.artifact),
      offset = integer(o.offset, 0, LIMITS.detailBytes),
      start = integer(o.start, 0, LIMITS.artifactPartBytes),
      length = integer(o.length, 1, LIMITS.chunkBytes);
    if (start + length > artifact.bytes || offset + length > LIMITS.detailBytes)
      invalid();
    return {
      kind,
      detailId: decodeId(o.detailId),
      source,
      artifact,
      offset,
      start,
      length,
    };
  }
  const o = closed(value, ["kind", "detail", "source"]);
  literal(kind, "end");
  const detail = decodeRetainedDetail(o.detail),
    source = nullable(o.source, decodeSourceRange);
  if (
    (detail.origin.kind === "owner") !== (owner !== null) ||
    (source === null) !== (owner !== null)
  )
    invalid();
  return { kind: "end", detail, source };
}
function closedTag(value: unknown): string {
  // Shared closed decoders below own every variant; no arbitrary payload retention.
  if (
    !value ||
    typeof value !== "object" ||
    !("kind" in value) ||
    typeof value.kind !== "string"
  )
    invalid();
  return value.kind;
}
export function decodeAdmissionIntent(value: unknown): AdmissionIntent {
  const o = closed(value, [
    "commandId",
    "operationId",
    "runId",
    "identity",
    "createdTaskId",
  ]);
  return {
    commandId: decodeId(o.commandId),
    operationId: decodeId(o.operationId),
    runId: nullable(o.runId, decodeId),
    identity: decodeCommandIdentity(o.identity),
    createdTaskId: nullable(o.createdTaskId, decodeId),
  };
}
export function decodeAuthIntent(value: unknown): AuthPreparationIntent {
  const o = closed(value, [
    "operationId",
    "epoch",
    "runId",
    "childRunId",
    "sourceSelectionId",
    "validityMs",
  ]);
  return {
    operationId: decodeId(o.operationId),
    epoch: decodeId(o.epoch),
    runId: decodeId(o.runId),
    childRunId: decodeId(o.childRunId),
    sourceSelectionId: decodeId(o.sourceSelectionId),
    validityMs: integer(o.validityMs, 1),
  };
}
export function decodeAuthSettlement(
  value: unknown,
): AuthPreparationSettlement {
  const o = closed(value, ["operationId", "outcome", "admissionClosed"]);
  return {
    operationId: decodeId(o.operationId),
    outcome: oneOf(o.outcome, ["resolved", "refused", "failed"]),
    admissionClosed: bool(o.admissionClosed),
  };
}
/** Explicit bridge over a validated final tail. Never a license to skip interior damage. */
export interface RecoveryBridge {
  kind: "recovery";
  recoveryId: string;
  epoch: string;
  coordinationDigest: string;
  historyDigest: string;
  previous: {
    segment: number;
    bytes: number;
    sha256: string;
    committedBytes: number;
    committedSeq: string;
    highSeq: string;
  };
  acknowledgments: { processes: true; credentials: true; storage: true };
}
export function decodeRecoveryBridge(v: unknown): RecoveryBridge {
  const o = closed(v, [
    "kind",
    "recoveryId",
    "epoch",
    "coordinationDigest",
    "historyDigest",
    "previous",
    "acknowledgments",
  ]);
  const p = closed(o.previous, [
    "segment",
    "bytes",
    "sha256",
    "committedBytes",
    "committedSeq",
    "highSeq",
  ]);
  const a = closed(o.acknowledgments, ["processes", "credentials", "storage"]);
  const previous = {
    segment: integer(p.segment),
    bytes: integer(p.bytes, 0, LIMITS.segmentBytes),
    sha256: decodeHash(p.sha256),
    committedBytes: integer(p.committedBytes, 0, LIMITS.segmentBytes),
    committedSeq: decodeSequence(p.committedSeq),
    highSeq: decodeSequence(p.highSeq),
  };
  if (
    previous.committedBytes > previous.bytes ||
    BigInt(previous.highSeq) < BigInt(previous.committedSeq)
  )
    invalid();
  if (a.processes !== true || a.credentials !== true || a.storage !== true)
    invalid();
  return {
    kind: literal(o.kind, "recovery"),
    recoveryId: decodeId(o.recoveryId),
    epoch: decodeId(o.epoch),
    coordinationDigest: decodeHash(o.coordinationDigest),
    historyDigest: decodeHash(o.historyDigest),
    previous,
    acknowledgments: { processes: true, credentials: true, storage: true },
  };
}
/** Every journal navigation path uses this same explicit sequence-gap rule. */
export function validBatchSequence(
  rows: JournalRow[],
  previous: string,
): boolean {
  const bridge = rows[0]?.value;
  const base = bridge?.kind === "recovery" ? bridge.previous.highSeq : previous;
  if (
    bridge?.kind === "recovery" &&
    (rows.length !== 1 || bridge.previous.committedSeq !== previous)
  )
    return false;
  return rows.every(
    (row, i) =>
      row.seq === String(BigInt(base) + BigInt(i) + 1n) &&
      (i === 0 || row.value.kind !== "recovery"),
  );
}
export interface ResourcePolicy {
  generation: number;
  quotaBytes: number;
  episodeReservationBytes: number;
  freeSpaceFloorBytes: number;
  episodeControlBytes: number;
}
function decodeResourcePolicy(v: unknown): ResourcePolicy {
  const o = closed(v, [
    "generation",
    "quotaBytes",
    "episodeReservationBytes",
    "freeSpaceFloorBytes",
    "episodeControlBytes",
  ]);
  return {
    generation: integer(o.generation, 1),
    quotaBytes: integer(o.quotaBytes, LIMITS.episodeControlBytes),
    episodeReservationBytes: integer(
      o.episodeReservationBytes,
      LIMITS.episodeControlBytes,
    ),
    freeSpaceFloorBytes: literal(
      o.freeSpaceFloorBytes,
      LIMITS.freeSpaceFloorBytes,
    ),
    episodeControlBytes: literal(
      o.episodeControlBytes,
      LIMITS.episodeControlBytes,
    ),
  };
}
export type JournalValue =
  | RecoveryBridge
  | { kind: "owner-epoch"; epoch: string }
  | {
      kind: "admission";
      intent: AdmissionIntent;
      record: StoredCommand;
      policy?: ResourcePolicy;
    }
  | { kind: "auth-preparation"; intent: AuthPreparationIntent }
  | { kind: "auth-settlement"; result: AuthPreparationSettlement }
  | { kind: "launch"; link: RecordingLink; operationId: string }
  | { kind: "settlement"; link: RecordingLink; completion: WorkerCompletion }
  | {
      kind: "capture";
      link: RecordingLink;
      source: SourceRange;
      events: SavedEvent[];
    }
  | {
      kind: "owner";
      link: OwnerLink;
      observedMs: number;
      events: SavedEvent[];
    };
export function decodeJournalValue(value: unknown): JournalValue {
  const kind = closedTag(value);
  switch (kind) {
    case "recovery":
      return decodeRecoveryBridge(value);
    case "owner-epoch": {
      const o = closed(value, ["kind", "epoch"]);
      return { kind, epoch: decodeId(o.epoch) };
    }
    case "admission-compact": {
      const hasPolicy = Object.hasOwn(value as object, "policy");
      const o = closed(value, [
        "kind",
        "intent",
        "receipt",
        ...(hasPolicy ? ["policy"] : []),
      ]);
      const intent = decodeAdmissionIntent(o.intent);
      return decodeJournalValue({
        kind: "admission",
        intent,
        record: { identity: intent.identity, receipt: o.receipt },
        ...(hasPolicy ? { policy: o.policy } : {}),
      });
    }
    case "admission": {
      const hasPolicy =
        typeof value === "object" &&
        value !== null &&
        Object.hasOwn(value, "policy");
      const o = closed(value, [
          "kind",
          "intent",
          "record",
          ...(hasPolicy ? ["policy"] : []),
        ]),
        intent = decodeAdmissionIntent(o.intent),
        record = decodeStoredCommand(o.record);
      if (
        record.receipt.commandId !== intent.commandId ||
        record.receipt.operationId !== intent.operationId ||
        record.receipt.runId !== intent.runId ||
        canonicalJson(record.identity) !== canonicalJson(intent.identity) ||
        (record.receipt.created?.taskId ?? null) !== intent.createdTaskId
      )
        invalid();
      const policy = hasPolicy ? decodeResourcePolicy(o.policy) : undefined;
      if (
        policy &&
        intent.identity.kind === "action" &&
        policy.generation !== intent.identity.expected.configRev
      )
        invalid();
      return { kind, intent, record, ...(policy ? { policy } : {}) };
    }
    case "auth-preparation": {
      const o = closed(value, ["kind", "intent"]);
      return { kind, intent: decodeAuthIntent(o.intent) };
    }
    case "auth-settlement": {
      const o = closed(value, ["kind", "result"]);
      return { kind, result: decodeAuthSettlement(o.result) };
    }
    case "launch": {
      const o = closed(value, ["kind", "link", "operationId"]);
      return {
        kind,
        link: decodeRecordingLink(o.link),
        operationId: decodeId(o.operationId),
      };
    }
    case "settlement": {
      const o = closed(value, ["kind", "link", "completion"]),
        link = decodeRecordingLink(o.link),
        completion = decodeWorkerCompletion(o.completion);
      if (link.childRunId !== completion.childRunId) invalid();
      return { kind, link, completion };
    }
    case "capture": {
      const o = closed(value, ["kind", "link", "source", "events"]);
      return {
        kind,
        link: decodeRecordingLink(o.link),
        source: decodeSourceRange(o.source),
        events: list(o.events, LIMITS.ownerQueueFrames, (v) =>
          decodeSavedEvent(v, null),
        ),
      };
    }
    case "owner": {
      const o = closed(value, ["kind", "link", "observedMs", "events"]),
        link = decodeOwnerLink(o.link);
      return {
        kind,
        link,
        observedMs: integer(o.observedMs),
        events: list(o.events, LIMITS.ownerQueueFrames, (v) =>
          decodeSavedEvent(v, link),
        ),
      };
    }
    default:
      return invalid();
  }
}
export interface JournalRow {
  kind: "record";
  seq: string;
  id: string;
  value: JournalValue;
}
export interface CommitMarker {
  navigationRoot?: string | null;
  kind: "commit";
  previous: string;
  first: string;
  last: string;
  count: number;
  sha256: string;
  artifacts: Artifact[];
}
export function decodeJournalLine(value: unknown): JournalRow | CommitMarker {
  if (closedTag(value) === "record") {
    const o = closed(value, ["kind", "seq", "id", "value"]);
    return {
      kind: "record",
      seq: decodeSequence(o.seq),
      id: decodeId(o.id),
      value: decodeJournalValue(o.value),
    };
  }
  const indexed =
    typeof value === "object" &&
    value !== null &&
    Object.hasOwn(value, "navigationRoot");
  const o = closed(value, [
    ...(indexed ? ["navigationRoot"] : []),
    "kind",
    "previous",
    "first",
    "last",
    "count",
    "sha256",
    "artifacts",
  ]);
  literal(o.kind, "commit");
  return {
    kind: "commit",
    ...(indexed
      ? { navigationRoot: nullable(o.navigationRoot, decodeHash) }
      : {}),
    previous: decodeSequence(o.previous),
    first: decodeSequence(o.first),
    last: decodeSequence(o.last),
    count: integer(o.count, 1, LIMITS.segmentRecords),
    sha256: decodeHash(o.sha256),
    artifacts: list(o.artifacts, LIMITS.ownerQueueFrames, decodeArtifact),
  };
}
export const COMPLETE: CaptureCoverage = {
  observed: "complete",
  source: "complete",
  redacted: false,
  omissions: [],
};
export function captureCoverage(
  event: RecordingEvent["event"],
): CaptureCoverage | null {
  if (event.kind === "capture-status") return event.coverage;
  if (event.kind === "omitted-block")
    return { ...COMPLETE, source: "limited", omissions: [event.block.reason] };
  return null;
}
export function combineCoverage(
  a: CaptureCoverage,
  b: CaptureCoverage,
): CaptureCoverage {
  return {
    observed:
      a.observed === "complete" && b.observed === "complete"
        ? "complete"
        : "incomplete",
    source:
      a.source === "unavailable" || b.source === "unavailable"
        ? "unavailable"
        : a.source === "limited" || b.source === "limited"
          ? "limited"
          : "complete",
    redacted: a.redacted || b.redacted,
    omissions: [...new Set([...a.omissions, ...b.omissions])],
  };
}
export function rowArtifacts(row: JournalRow): Artifact[] {
  return row.value.kind === "capture" || row.value.kind === "owner"
    ? row.value.events.flatMap((e) => (e.kind === "chunk" ? [e.artifact] : []))
    : [];
}

export function batchArtifacts(rows: JournalRow[]): Artifact[] {
  const unique = new Map<string, Artifact>();
  for (const ref of rows.flatMap(rowArtifacts)) {
    const key = `${ref.runId}/${ref.artifactId}/${ref.part}`,
      previous = unique.get(key);
    if (previous && canonicalJson(previous) !== canonicalJson(ref)) invalid();
    unique.set(key, ref);
  }
  return [...unique.values()];
}

/** Parsed-value memoization, NOT commit evidence. Every consumer still reads the
 * original bytes and verifies its actual marker/checksum/membership. Encoding can
 * prime this cache before durability, but no reader publishes without that marker.
 * Copies on return prevent a caller from changing subsequent decoded observations.
 * At most the active and preceding segments (16 MiB / 8192 lines), never artifact
 * bodies. Retaining both avoids decoder thrash at an ordinary segment rotation. */
const decodedLines = new Map<
  string,
  { bytes: number; value: JournalRow | CommitMarker }
>();
let decodedBytes = 0;
const lineKey = (text: string) =>
  createHash("sha256").update(text).digest("hex");
function remember(text: string, value: JournalRow | CommitMarker): void {
  const key = lineKey(text);
  if (decodedLines.has(key)) return;
  const bytes = Buffer.byteLength(text);
  while (
    decodedLines.size &&
    (decodedLines.size >= 2 * LIMITS.segmentRecords ||
      decodedBytes + bytes > 2 * LIMITS.segmentBytes)
  ) {
    const first = decodedLines.keys().next().value;
    if (!first) break;
    decodedBytes -= decodedLines.get(first)?.bytes ?? 0;
    decodedLines.delete(first);
  }
  if (bytes <= 2 * LIMITS.segmentBytes) {
    decodedLines.set(key, { bytes, value });
    decodedBytes += bytes;
  }
}
/** Disk-only compact admission: one identity, shared by intent and receipt in RAM.
 * Historical duplicated rows remain canonical/readable; no ceiling is changed. */
function compactAdmission(value: JournalRow | CommitMarker): unknown {
  if (value.kind !== "record" || value.value.kind !== "admission") return value;
  const { intent, record, policy } = value.value;
  return {
    ...value,
    value: {
      kind: "admission-compact",
      intent,
      receipt: record.receipt,
      ...(policy ? { policy } : {}),
    },
  };
}
export function encodeJournalText(input: JournalRow | CommitMarker): string {
  const value = decodeJournalLine(input),
    text = canonicalJson(compactAdmission(value), RECORD_BYTES);
  remember(text, value);
  return `${text}\n`;
}
/** Canonical equality rejects duplicate keys and noncanonical disk encodings. */
export function decodeJournalText(line: string): JournalRow | CommitMarker {
  const text = line.endsWith("\n") ? line.slice(0, -1) : line;
  // The fixed structural record has no payload tree. Match its complete canonical
  // representation once, then retain the shared ID/sequence validators. Avoid
  // repeatedly allocating descriptors, sorted objects and a cloned cache entry
  // for thousands of these tiny rows during cold membership scans.
  const epoch =
    /^\{"id":"([0-9a-f-]{36})","kind":"record","seq":"([0-9]+)","value":\{"epoch":"([0-9a-f-]{36})","kind":"owner-epoch"\}\}$/.exec(
      text,
    );
  if (epoch)
    return {
      kind: "record",
      id: decodeId(epoch[1]),
      seq: decodeSequence(epoch[2]),
      value: { kind: "owner-epoch", epoch: decodeId(epoch[3]) },
    };
  const key = lineKey(text),
    cached = decodedLines.get(key);
  if (cached) return structuredClone(cached.value);
  const raw = JSON.parse(text);
  const value = decodeJournalLine(raw);
  const compact =
    raw?.kind === "record" && raw.value?.kind === "admission-compact";
  if (
    canonicalJson(compact ? compactAdmission(value) : value, RECORD_BYTES) !==
    text
  )
    invalid();
  remember(text, value);
  return structuredClone(value);
}
