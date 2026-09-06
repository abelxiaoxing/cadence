import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ArtifactStore } from "./artifact-store.ts";
import { compareCanonicalStrings } from "./canonical.ts";
import {
  diffWritePaths,
  IMPLEMENTATION_PHASES,
  type ImplementationPhase,
  isValidRelativePath,
} from "./contracts.ts";
import { configureSqlite, ensureSqliteSchema } from "./sqlite-schema.ts";
import { TASK_SCHEMA } from "./storage-schema.ts";

export const TASK_LEDGER_LIMITS = {
  maxSegmentBytes: 128 * 1024,
  maxCandidateBytes: 8 * 1024 * 1024,
  maxProjectionBytes: 64 * 1024,
  maxObjectiveBytes: 4 * 1024,
  maxEventsPerTask: 512,
} as const;

const IDENTIFIER = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/iu;
const SHA256 = /^[a-f0-9]{64}$/u;
const CLASSIFICATIONS = new Set([
  "expected-red",
  "expected-green",
  "expected-refactor",
]);
const ZERO_HASH = "0".repeat(64);

export interface CandidateIdentity {
  candidateId: string;
  runId: string;
  deliveryRevision: number;
  taskId: string;
  phase: ImplementationPhase;
  attemptId: string;
  approvedPaths: string[];
  isolatedRevisionId: string;
  verificationId: string;
  routeId: string;
  routeFingerprint: string;
}

interface CandidateRow {
  identity_json: string;
  state: string;
  next_sequence: number;
  total_bytes: number;
  artifact_hash: string | null;
  candidate_hash: string | null;
  segment_count: number | null;
  paths_json: string | null;
  pause_code: string | null;
}

interface SegmentRow {
  sequence: number;
  artifact_hash: string;
  size_bytes: number;
  segment_hash: string;
}

interface TaskRow {
  delivery_revision: number;
  boundary_hash: string;
  objective: string;
  context_refs_json: string;
  initial_phase: string;
}

interface EventRow {
  ordinal: number;
  event_id: string;
  event_json: string;
  prior_hash: string;
  event_hash: string;
}

export interface TaskLedgerOptions {
  root: string;
  artifacts: ArtifactStore;
  databasePath?: string;
}

export interface BeginCandidateInput extends CandidateIdentity {}

export interface AppendCandidateSegmentInput extends CandidateIdentity {
  sequence: number;
  bytes: Uint8Array;
  segmentHash: string;
}

export interface SealCandidateInput extends CandidateIdentity {
  segmentCount: number;
  totalBytes: number;
  candidateHash: string;
}

export type AppendCandidateSegmentResult =
  | {
      ok: true;
      state: "unsealed";
      nextSequence: number;
      totalBytes: number;
    }
  | {
      ok: false;
      state: "paused";
      code: string;
      limitBytes: number;
      replayed?: true;
    };

export type SealCandidateResult =
  | {
      ok: true;
      state: "sealed";
      artifactHash: string;
      bytes: number;
      paths: string[];
      replayed?: true;
    }
  | {
      ok: false;
      state: "paused";
      code: string;
      limitBytes: number;
    }
  | {
      ok: false;
      state: "unsealed";
      code: "candidate-incomplete";
    };

interface TaskContextReference {
  kind: "path";
  path: string;
  hash: string;
}

export interface OpenTaskInput {
  runId: string;
  deliveryRevision: number;
  taskId: string;
  boundaryHash: string;
  objective: string;
  contextRefs: TaskContextReference[];
  initialPhase: ImplementationPhase;
}

interface PhaseVerifiedEvent {
  runId: string;
  taskId: string;
  eventId: string;
  kind: "phase-verified";
  phase: ImplementationPhase;
  commandId: string;
  exitCode: number;
  expectedClassification: string;
  actualClassification: string;
  diagnostic: { kind: "assertion" | "compiler"; id: string };
  artifactHash: string;
  isolatedRevisionId: string;
  outputFacts: Array<
    | { path: string; kind: "absent" }
    | { path: string; kind: "file"; hash: string; bytes: number }
  >;
  routeId: string;
  routeFingerprint: string;
}

interface CorrectionEvent {
  runId: string;
  taskId: string;
  eventId: string;
  kind: "artifact-correction";
  phase: ImplementationPhase;
  correctionCategory: "artifact" | "stale" | "verification" | "checkpoint";
  safeFailure: { code: string; stage: string };
  candidateId: string;
  attemptId: string;
  routeId: string;
  routeFingerprint: string;
}

interface RepairVerifiedEvent {
  runId: string;
  taskId: string;
  eventId: string;
  kind: "repair-verified";
  phase: ImplementationPhase;
  attempt: number;
  commandId: string;
  exitCode: 0;
  diagnostic: { kind: "assertion" | "compiler"; id: string };
  artifactHash: string;
  isolatedRevisionId: string;
  outputFacts: PhaseVerifiedEvent["outputFacts"];
  attribution: "introduced";
  failureIdentities: string[];
  routeId: string;
  routeFingerprint: string;
}

interface RouteReboundEvent {
  runId: string;
  taskId: string;
  eventId: string;
  kind: "route-rebound";
  phase: ImplementationPhase;
  routeFingerprint: string;
  routeId: string;
  attemptId: string;
}

export type VerifiedTaskEvent =
  | PhaseVerifiedEvent
  | RepairVerifiedEvent
  | CorrectionEvent
  | RouteReboundEvent;

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function hashEvent(
  priorHash: string,
  ordinal: number,
  eventJson: string,
): string {
  return createHash("sha256")
    .update("cadence-task-ledger-event\0")
    .update(priorHash)
    .update("\0")
    .update(String(ordinal))
    .update("\0")
    .update(eventJson)
    .digest("hex");
}

function ensurePrivateDirectory(directory: string): void {
  if (!path.isAbsolute(directory)) throw new Error("task-ledger-root-invalid");
  const absolute = path.resolve(directory);
  let cursor = absolute;
  const missing: string[] = [];
  for (;;) {
    const stat = lstatSync(cursor, { throwIfNoEntry: false });
    if (stat) {
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error("task-ledger-root-invalid");
      }
      break;
    }
    missing.push(cursor);
    const parent = path.dirname(cursor);
    if (parent === cursor) throw new Error("task-ledger-root-invalid");
    cursor = parent;
  }
  for (const target of missing.reverse()) {
    mkdirSync(target, { mode: 0o700 });
    chmodSync(target, 0o700);
  }
  chmodSync(absolute, 0o700);
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    expected
      .slice()
      .sort()
      .every((key, index) => actual[index] === key)
  );
}

function requireIdentifier(
  value: unknown,
  code: string,
): asserts value is string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new Error(code);
  }
}

function requireHash(value: unknown, code: string): asserts value is string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error(code);
  }
}

function requirePhase(value: unknown): asserts value is ImplementationPhase {
  if (!(IMPLEMENTATION_PHASES as readonly unknown[]).includes(value)) {
    throw new Error("ledger-phase-invalid");
  }
}

function normalizePaths(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some(
      (entry) =>
        !isValidRelativePath(entry) ||
        entry === "." ||
        typeof entry !== "string",
    ) ||
    new Set(value).size !== value.length
  ) {
    throw new Error("candidate-approved-paths-invalid");
  }
  return [...value].sort();
}

function candidateIdentity(input: CandidateIdentity): CandidateIdentity {
  if (
    !hasExactKeys(input, [
      "candidateId",
      "runId",
      "deliveryRevision",
      "taskId",
      "phase",
      "attemptId",
      "approvedPaths",
      "isolatedRevisionId",
      "verificationId",
      "routeId",
      "routeFingerprint",
    ]) ||
    !Number.isSafeInteger(input.deliveryRevision) ||
    input.deliveryRevision < 1
  ) {
    throw new Error("candidate-identity-invalid");
  }
  requireIdentifier(input.candidateId, "candidate-identity-invalid");
  requireIdentifier(input.runId, "candidate-identity-invalid");
  requireIdentifier(input.taskId, "candidate-identity-invalid");
  requireIdentifier(input.attemptId, "candidate-identity-invalid");
  requireIdentifier(input.verificationId, "candidate-identity-invalid");
  requireIdentifier(input.routeId, "candidate-identity-invalid");
  requireHash(input.routeFingerprint, "candidate-identity-invalid");
  requirePhase(input.phase);
  requireHash(input.isolatedRevisionId, "candidate-identity-invalid");
  return {
    candidateId: input.candidateId,
    runId: input.runId,
    deliveryRevision: input.deliveryRevision,
    taskId: input.taskId,
    phase: input.phase,
    attemptId: input.attemptId,
    approvedPaths: normalizePaths(input.approvedPaths),
    isolatedRevisionId: input.isolatedRevisionId,
    verificationId: input.verificationId,
    routeId: input.routeId,
    routeFingerprint: input.routeFingerprint,
  };
}

function identityFromSegment(
  input: AppendCandidateSegmentInput,
): CandidateIdentity {
  const {
    sequence: _sequence,
    bytes: _bytes,
    segmentHash: _segmentHash,
    ...identity
  } = input;
  return candidateIdentity(identity);
}

function identityFromSeal(input: SealCandidateInput): CandidateIdentity {
  const {
    segmentCount: _segmentCount,
    totalBytes: _totalBytes,
    candidateHash: _candidateHash,
    ...identity
  } = input;
  return candidateIdentity(identity);
}

function sameIdentity(rowJson: string, identity: CandidateIdentity): boolean {
  return rowJson === JSON.stringify(identity);
}

function requireTaskKey(runId: unknown, taskId: unknown): void {
  requireIdentifier(runId, "ledger-task-identity-invalid");
  requireIdentifier(taskId, "ledger-task-identity-invalid");
}

function normalizeContextRefs(value: unknown): TaskContextReference[] {
  if (!Array.isArray(value) || value.length > 128) {
    throw new Error("ledger-context-refs-invalid");
  }
  const refs = value.map((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      !hasExactKeys(entry, ["kind", "path", "hash"]) ||
      (entry as TaskContextReference).kind !== "path" ||
      !isValidRelativePath((entry as TaskContextReference).path)
    ) {
      throw new Error("ledger-context-refs-invalid");
    }
    requireHash(
      (entry as TaskContextReference).hash,
      "ledger-context-refs-invalid",
    );
    return { ...(entry as TaskContextReference) };
  });
  const identities = refs.map((entry) => `${entry.kind}:${entry.path}`);
  if (new Set(identities).size !== identities.length) {
    throw new Error("ledger-context-refs-invalid");
  }
  return refs.sort((left, right) =>
    compareCanonicalStrings(left.path, right.path),
  );
}

function safeText(value: unknown, code: string, maximum = 256): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.includes("\0") ||
    /[\r\n]/u.test(value)
  ) {
    throw new Error(code);
  }
  return value;
}

function normalizePhaseEvent(input: PhaseVerifiedEvent): PhaseVerifiedEvent {
  if (
    !hasExactKeys(input, [
      "runId",
      "taskId",
      "eventId",
      "kind",
      "phase",
      "commandId",
      "exitCode",
      "expectedClassification",
      "actualClassification",
      "diagnostic",
      "artifactHash",
      "isolatedRevisionId",
      "outputFacts",
      "routeId",
      "routeFingerprint",
    ]) ||
    !Number.isSafeInteger(input.exitCode) ||
    input.exitCode < 0 ||
    !CLASSIFICATIONS.has(input.expectedClassification) ||
    !CLASSIFICATIONS.has(input.actualClassification) ||
    !input.diagnostic ||
    typeof input.diagnostic !== "object" ||
    Array.isArray(input.diagnostic) ||
    !hasExactKeys(input.diagnostic, ["kind", "id"]) ||
    !["assertion", "compiler"].includes(input.diagnostic.kind) ||
    !Array.isArray(input.outputFacts) ||
    input.outputFacts.length > 128
  ) {
    throw new Error("ledger-event-field-invalid");
  }
  requirePhase(input.phase);
  safeText(input.commandId, "ledger-event-field-invalid", 128);
  safeText(input.diagnostic.id, "ledger-event-field-invalid", 512);
  requireHash(input.artifactHash, "ledger-event-field-invalid");
  requireHash(input.isolatedRevisionId, "ledger-event-field-invalid");
  requireIdentifier(input.routeId, "ledger-event-field-invalid");
  requireHash(input.routeFingerprint, "ledger-event-field-invalid");
  const outputFacts = input.outputFacts.map((fact) => {
    if (
      !fact ||
      typeof fact !== "object" ||
      Array.isArray(fact) ||
      !isValidRelativePath(fact.path) ||
      (fact.kind !== "absent" && fact.kind !== "file")
    ) {
      throw new Error("ledger-event-field-invalid");
    }
    if (fact.kind === "absent") {
      if (!hasExactKeys(fact, ["path", "kind"])) {
        throw new Error("ledger-event-field-invalid");
      }
      return { path: fact.path, kind: "absent" as const };
    }
    if (
      !hasExactKeys(fact, ["path", "kind", "hash", "bytes"]) ||
      !Number.isSafeInteger(fact.bytes) ||
      fact.bytes < 0
    ) {
      throw new Error("ledger-event-field-invalid");
    }
    requireHash(fact.hash, "ledger-event-field-invalid");
    return { ...fact };
  });
  return {
    ...input,
    diagnostic: { ...input.diagnostic },
    outputFacts,
  };
}

function normalizeVerifiedEvent(input: VerifiedTaskEvent): VerifiedTaskEvent {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("ledger-event-field-invalid");
  }
  requireTaskKey(input.runId, input.taskId);
  requireIdentifier(input.eventId, "ledger-event-field-invalid");
  if (input.kind === "phase-verified") return normalizePhaseEvent(input);
  if (input.kind === "repair-verified") {
    if (
      !hasExactKeys(input, [
        "runId",
        "taskId",
        "eventId",
        "kind",
        "phase",
        "attempt",
        "commandId",
        "exitCode",
        "diagnostic",
        "artifactHash",
        "isolatedRevisionId",
        "outputFacts",
        "attribution",
        "failureIdentities",
        "routeId",
        "routeFingerprint",
      ]) ||
      !Number.isSafeInteger(input.attempt) ||
      input.attempt < 1 ||
      input.attempt > 3 ||
      input.exitCode !== 0 ||
      input.attribution !== "introduced" ||
      !Array.isArray(input.failureIdentities) ||
      input.failureIdentities.length === 0 ||
      input.failureIdentities.length > 256 ||
      input.failureIdentities.some(
        (identity) => typeof identity !== "string" || !SHA256.test(identity),
      )
    ) {
      throw new Error("ledger-event-field-invalid");
    }
    const normalizedPhase = normalizePhaseEvent({
      runId: input.runId,
      taskId: input.taskId,
      eventId: input.eventId,
      kind: "phase-verified",
      phase: input.phase,
      commandId: input.commandId,
      exitCode: input.exitCode,
      expectedClassification: "expected-green",
      actualClassification: "expected-green",
      diagnostic: input.diagnostic,
      artifactHash: input.artifactHash,
      isolatedRevisionId: input.isolatedRevisionId,
      outputFacts: input.outputFacts,
      routeId: input.routeId,
      routeFingerprint: input.routeFingerprint,
    });
    return {
      ...input,
      diagnostic: normalizedPhase.diagnostic,
      outputFacts: normalizedPhase.outputFacts,
      failureIdentities: [...new Set(input.failureIdentities)].sort(),
    };
  }
  if (input.kind === "artifact-correction") {
    if (
      !hasExactKeys(input, [
        "runId",
        "taskId",
        "eventId",
        "kind",
        "phase",
        "correctionCategory",
        "safeFailure",
        "candidateId",
        "attemptId",
        "routeId",
        "routeFingerprint",
      ]) ||
      !["artifact", "stale", "verification", "checkpoint"].includes(
        input.correctionCategory,
      ) ||
      !input.safeFailure ||
      typeof input.safeFailure !== "object" ||
      !hasExactKeys(input.safeFailure, ["code", "stage"])
    ) {
      throw new Error("ledger-event-field-invalid");
    }
    requirePhase(input.phase);
    safeText(input.safeFailure.code, "ledger-event-field-invalid");
    safeText(input.safeFailure.stage, "ledger-event-field-invalid");
    requireIdentifier(input.candidateId, "ledger-event-field-invalid");
    requireIdentifier(input.attemptId, "ledger-event-field-invalid");
    requireIdentifier(input.routeId, "ledger-event-field-invalid");
    requireHash(input.routeFingerprint, "ledger-event-field-invalid");
    return structuredClone(input);
  }
  if (input.kind === "route-rebound") {
    if (
      !hasExactKeys(input, [
        "runId",
        "taskId",
        "eventId",
        "kind",
        "phase",
        "routeFingerprint",
        "routeId",
        "attemptId",
      ])
    ) {
      throw new Error("ledger-event-field-invalid");
    }
    requirePhase(input.phase);
    requireHash(input.routeFingerprint, "ledger-event-field-invalid");
    requireIdentifier(input.routeId, "ledger-event-field-invalid");
    requireIdentifier(input.attemptId, "ledger-event-field-invalid");
    return { ...input };
  }
  throw new Error("ledger-event-field-invalid");
}

const FORBIDDEN_PROJECTION_KEY =
  /(?:raw|prompt|transcript|reasoning|model.?output|credential|secret|tool.?history|command.?log)/iu;

function validateProjectionValue(value: unknown, depth = 0): void {
  if (depth > 12) throw new Error("ledger-projection-invalid");
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 512) throw new Error("ledger-projection-invalid");
    for (const entry of value) validateProjectionValue(entry, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") {
    throw new Error("ledger-projection-invalid");
  }
  const entries = Object.entries(value);
  if (entries.length > 128) throw new Error("ledger-projection-invalid");
  for (const [key, entry] of entries) {
    if (FORBIDDEN_PROJECTION_KEY.test(key)) {
      throw new Error("ledger-projection-private-field");
    }
    validateProjectionValue(entry, depth + 1);
  }
}

export function serializeTaskLedgerProjection(value: unknown): string {
  validateProjectionValue(value);
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized) > TASK_LEDGER_LIMITS.maxProjectionBytes) {
    throw new Error("ledger-projection-capacity-exceeded");
  }
  return serialized;
}

/** Durable task facts and bounded sealed candidate segments. */
export class TaskLedger {
  readonly root: string;
  readonly #artifacts: ArtifactStore;
  readonly #database: DatabaseSync;
  #closed = false;

  constructor(options: TaskLedgerOptions) {
    if (!options || typeof options !== "object") {
      throw new Error("task-ledger-options-invalid");
    }
    this.root = path.resolve(options.root);
    ensurePrivateDirectory(this.root);
    this.#artifacts = options.artifacts;
    const databasePath = path.resolve(
      options.databasePath ?? path.join(this.root, "task-ledger.sqlite3"),
    );
    const relative = path.relative(this.root, databasePath);
    if (
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      databasePath === this.root
    ) {
      throw new Error("task-ledger-database-invalid");
    }
    const existing = lstatSync(databasePath, { throwIfNoEntry: false });
    if (existing && (!existing.isFile() || existing.isSymbolicLink())) {
      throw new Error("task-ledger-database-invalid");
    }
    this.#database = new DatabaseSync(databasePath);
    configureSqlite(this.#database);
    ensureSqliteSchema(this.#database, TASK_SCHEMA);
    chmodSync(databasePath, 0o600);
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("task-ledger-closed");
  }

  #candidate(candidateId: string): CandidateRow {
    this.#assertOpen();
    requireIdentifier(candidateId, "candidate-identity-invalid");
    const row = this.#database
      .prepare(
        `SELECT identity_json, state, next_sequence, total_bytes,
                artifact_hash, candidate_hash, segment_count, paths_json,
                pause_code
         FROM candidates WHERE candidate_id = ?`,
      )
      .get(candidateId) as CandidateRow | undefined;
    if (!row) throw new Error("candidate-unavailable");
    return row;
  }

  beginCandidate(input: BeginCandidateInput) {
    this.#assertOpen();
    const identity = candidateIdentity(input);
    const json = JSON.stringify(identity);
    const existing = this.#database
      .prepare(
        "SELECT identity_json, state FROM candidates WHERE candidate_id = ?",
      )
      .get(identity.candidateId) as
      | { identity_json: string; state: string }
      | undefined;
    if (existing) {
      if (existing.identity_json !== json) {
        throw new Error("candidate-identity-mismatch");
      }
      return {
        ok: true,
        candidateId: identity.candidateId,
        state: existing.state,
        replayed: true,
      };
    }
    this.#database
      .prepare(
        `INSERT INTO candidates (
          candidate_id, identity_json, state, next_sequence, total_bytes
        ) VALUES (?, ?, 'unsealed', 0, 0)`,
      )
      .run(identity.candidateId, json);
    return { ok: true, candidateId: identity.candidateId, state: "unsealed" };
  }

  appendCandidateSegment(
    input: AppendCandidateSegmentInput,
  ): AppendCandidateSegmentResult {
    this.#assertOpen();
    if (
      !hasExactKeys(input, [
        "candidateId",
        "runId",
        "deliveryRevision",
        "taskId",
        "phase",
        "attemptId",
        "approvedPaths",
        "isolatedRevisionId",
        "verificationId",
        "routeId",
        "routeFingerprint",
        "sequence",
        "bytes",
        "segmentHash",
      ])
    ) {
      throw new Error("candidate-segment-invalid");
    }
    const identity = identityFromSegment(input);
    const row = this.#candidate(identity.candidateId);
    if (!sameIdentity(row.identity_json, identity)) {
      throw new Error("candidate-identity-mismatch");
    }
    if (row.state === "paused") {
      return {
        ok: false,
        state: "paused",
        code: row.pause_code ?? "needs-task-split",
        limitBytes: TASK_LEDGER_LIMITS.maxCandidateBytes,
        replayed: true,
      };
    }
    if (row.state !== "unsealed") throw new Error("candidate-already-sealed");
    if (
      !Number.isSafeInteger(input.sequence) ||
      input.sequence < 0 ||
      input.sequence !== row.next_sequence
    ) {
      throw new Error("candidate-segment-order-invalid");
    }
    if (
      !(input.bytes instanceof Uint8Array) ||
      input.bytes.byteLength === 0 ||
      input.bytes.byteLength > TASK_LEDGER_LIMITS.maxSegmentBytes
    ) {
      throw new Error("candidate-segment-size-invalid");
    }
    requireHash(input.segmentHash, "candidate-segment-hash-invalid");
    const bytes = Buffer.from(input.bytes);
    if (sha256(bytes) !== input.segmentHash) {
      throw new Error("candidate-segment-hash-invalid");
    }
    if (
      row.total_bytes + bytes.byteLength >
      TASK_LEDGER_LIMITS.maxCandidateBytes
    ) {
      this.#database
        .prepare(
          "UPDATE candidates SET state = 'paused', pause_code = 'needs-task-split' WHERE candidate_id = ?",
        )
        .run(identity.candidateId);
      return {
        ok: false,
        state: "paused",
        code: "needs-task-split",
        limitBytes: TASK_LEDGER_LIMITS.maxCandidateBytes,
      };
    }
    const artifact = this.#artifacts.put(bytes);
    this.#artifacts.retain(artifact.hash);
    try {
      this.#database.exec("BEGIN IMMEDIATE");
      this.#database
        .prepare(
          `INSERT INTO candidate_segments (
             candidate_id, sequence, artifact_hash, size_bytes, segment_hash
           ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          identity.candidateId,
          input.sequence,
          artifact.hash,
          artifact.bytes,
          input.segmentHash,
        );
      this.#database
        .prepare(
          `UPDATE candidates
           SET next_sequence = next_sequence + 1,
               total_bytes = total_bytes + ?
           WHERE candidate_id = ?`,
        )
        .run(artifact.bytes, identity.candidateId);
      this.#database.exec("COMMIT");
    } catch (error) {
      try {
        this.#database.exec("ROLLBACK");
      } catch {}
      this.#artifacts.release(artifact.hash);
      throw error;
    }
    return {
      ok: true,
      state: "unsealed",
      nextSequence: input.sequence + 1,
      totalBytes: row.total_bytes + artifact.bytes,
    };
  }

  #segments(candidateId: string): SegmentRow[] {
    return this.#database
      .prepare(
        `SELECT sequence, artifact_hash, size_bytes, segment_hash
         FROM candidate_segments WHERE candidate_id = ? ORDER BY sequence`,
      )
      .all(candidateId) as unknown as SegmentRow[];
  }

  sealCandidate(input: SealCandidateInput): SealCandidateResult {
    this.#assertOpen();
    if (
      !hasExactKeys(input, [
        "candidateId",
        "runId",
        "deliveryRevision",
        "taskId",
        "phase",
        "attemptId",
        "approvedPaths",
        "isolatedRevisionId",
        "verificationId",
        "routeId",
        "routeFingerprint",
        "segmentCount",
        "totalBytes",
        "candidateHash",
      ])
    ) {
      throw new Error("candidate-seal-invalid");
    }
    const identity = identityFromSeal(input);
    const row = this.#candidate(identity.candidateId);
    if (!sameIdentity(row.identity_json, identity)) {
      throw new Error("candidate-identity-mismatch");
    }
    if (
      !Number.isSafeInteger(input.segmentCount) ||
      input.segmentCount < 1 ||
      !Number.isSafeInteger(input.totalBytes) ||
      input.totalBytes < 1
    ) {
      throw new Error("candidate-seal-invalid");
    }
    requireHash(input.candidateHash, "candidate-seal-hash-invalid");
    if (row.state === "sealed") {
      if (
        row.segment_count !== input.segmentCount ||
        row.total_bytes !== input.totalBytes ||
        row.candidate_hash !== input.candidateHash
      ) {
        throw new Error("candidate-seal-conflict");
      }
      if (!row.artifact_hash) {
        throw new Error("candidate-seal-integrity-invalid");
      }
      return {
        ok: true,
        state: "sealed",
        artifactHash: row.artifact_hash,
        bytes: row.total_bytes,
        paths: JSON.parse(row.paths_json ?? "[]") as string[],
        replayed: true,
      };
    }
    if (row.state === "paused") {
      return {
        ok: false,
        state: "paused",
        code: row.pause_code ?? "needs-task-split",
        limitBytes: TASK_LEDGER_LIMITS.maxCandidateBytes,
      };
    }
    const segments = this.#segments(identity.candidateId);
    if (
      segments.length !== input.segmentCount ||
      row.next_sequence !== input.segmentCount
    ) {
      return { ok: false, state: "unsealed", code: "candidate-incomplete" };
    }
    const buffers = segments.map((segment, index) => {
      if (segment.sequence !== index) {
        throw new Error("candidate-segment-order-invalid");
      }
      const bytes = Buffer.from(this.#artifacts.read(segment.artifact_hash));
      if (
        bytes.byteLength !== segment.size_bytes ||
        sha256(bytes) !== segment.segment_hash
      ) {
        throw new Error("candidate-segment-integrity-invalid");
      }
      return bytes;
    });
    const candidate = Buffer.concat(buffers);
    if (
      candidate.byteLength !== input.totalBytes ||
      candidate.byteLength !== row.total_bytes ||
      sha256(candidate) !== input.candidateHash
    ) {
      throw new Error("candidate-seal-hash-invalid");
    }
    let diff: string;
    try {
      diff = new TextDecoder("utf-8", { fatal: true }).decode(candidate);
    } catch {
      throw new Error("candidate-diff-invalid");
    }
    let paths: string[];
    try {
      paths = diffWritePaths(diff).paths;
    } catch {
      throw new Error("candidate-diff-invalid");
    }
    if (paths.some((relative) => !identity.approvedPaths.includes(relative))) {
      throw new Error("candidate-write-set-mismatch");
    }
    const artifact = this.#artifacts.put(candidate);
    this.#artifacts.retain(artifact.hash);
    this.#database
      .prepare(
        `UPDATE candidates
         SET state = 'sealed', artifact_hash = ?, candidate_hash = ?,
             segment_count = ?, paths_json = ?, pause_code = NULL
         WHERE candidate_id = ? AND state = 'unsealed'`,
      )
      .run(
        artifact.hash,
        input.candidateHash,
        input.segmentCount,
        JSON.stringify(paths),
        identity.candidateId,
      );
    return {
      ok: true,
      state: "sealed",
      artifactHash: artifact.hash,
      bytes: artifact.bytes,
      paths,
    };
  }

  readSealedCandidate(candidateId: string): Uint8Array {
    const row = this.#candidate(candidateId);
    if (row.state !== "sealed" || !row.artifact_hash) {
      throw new Error("candidate-not-sealed");
    }
    const bytes = this.#artifacts.read(row.artifact_hash);
    if (
      bytes.byteLength !== row.total_bytes ||
      sha256(bytes) !== row.candidate_hash
    ) {
      throw new Error("candidate-seal-integrity-invalid");
    }
    return Buffer.from(bytes);
  }

  openTask(input: OpenTaskInput) {
    this.#assertOpen();
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      !hasExactKeys(input, [
        "runId",
        "deliveryRevision",
        "taskId",
        "boundaryHash",
        "objective",
        "contextRefs",
        "initialPhase",
      ]) ||
      !Number.isSafeInteger(input.deliveryRevision) ||
      input.deliveryRevision < 1 ||
      typeof input.objective !== "string" ||
      input.objective.length === 0 ||
      Buffer.byteLength(input.objective) > TASK_LEDGER_LIMITS.maxObjectiveBytes
    ) {
      throw new Error("ledger-task-invalid");
    }
    requireTaskKey(input.runId, input.taskId);
    requireHash(input.boundaryHash, "ledger-task-invalid");
    requirePhase(input.initialPhase);
    const contextRefs = normalizeContextRefs(input.contextRefs);
    const existing = this.#database
      .prepare(
        `SELECT delivery_revision, boundary_hash, objective,
                context_refs_json, initial_phase
         FROM task_ledger WHERE run_id = ? AND task_id = ?`,
      )
      .get(input.runId, input.taskId) as TaskRow | undefined;
    const expected = {
      delivery_revision: input.deliveryRevision,
      boundary_hash: input.boundaryHash,
      objective: input.objective,
      context_refs_json: JSON.stringify(contextRefs),
      initial_phase: input.initialPhase,
    };
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(expected)) {
        throw new Error("ledger-task-conflict");
      }
      return { accepted: true, replayed: true };
    }
    this.#database
      .prepare(
        `INSERT INTO task_ledger (
           run_id, task_id, delivery_revision, boundary_hash, objective,
           context_refs_json, initial_phase
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.runId,
        input.taskId,
        input.deliveryRevision,
        input.boundaryHash,
        input.objective,
        JSON.stringify(contextRefs),
        input.initialPhase,
      );
    return { accepted: true };
  }

  #task(runId: string, taskId: string): TaskRow {
    requireTaskKey(runId, taskId);
    const row = this.#database
      .prepare(
        `SELECT delivery_revision, boundary_hash, objective,
                context_refs_json, initial_phase
         FROM task_ledger WHERE run_id = ? AND task_id = ?`,
      )
      .get(runId, taskId) as TaskRow | undefined;
    if (!row) throw new Error("ledger-task-unavailable");
    return row;
  }

  #events(runId: string, taskId: string): EventRow[] {
    const rows = this.#database
      .prepare(
        `SELECT ordinal, event_id, event_json, prior_hash, event_hash
         FROM task_events WHERE run_id = ? AND task_id = ? ORDER BY ordinal`,
      )
      .all(runId, taskId) as unknown as EventRow[];
    let prior = ZERO_HASH;
    for (const [index, row] of rows.entries()) {
      if (
        row.ordinal !== index + 1 ||
        row.prior_hash !== prior ||
        row.event_hash !== hashEvent(prior, row.ordinal, row.event_json)
      ) {
        throw new Error("ledger-event-integrity-invalid");
      }
      prior = row.event_hash;
    }
    return rows;
  }

  commitVerifiedEvent(input: VerifiedTaskEvent) {
    this.#assertOpen();
    const normalized = normalizeVerifiedEvent(input);
    const task = this.#task(normalized.runId, normalized.taskId);
    const rows = this.#events(normalized.runId, normalized.taskId);
    const existing = rows.find((row) => row.event_id === normalized.eventId);
    const json = JSON.stringify(normalized);
    if (existing) {
      if (existing.event_json !== json)
        throw new Error("ledger-event-conflict");
      return { accepted: true, ordinal: existing.ordinal, replayed: true };
    }
    if (rows.length >= TASK_LEDGER_LIMITS.maxEventsPerTask) {
      throw new Error("ledger-event-capacity-exceeded");
    }
    if (normalized.kind === "phase-verified") {
      if (task.initial_phase === "green" && normalized.phase === "red")
        throw new Error("ledger-phase-order-invalid");
      const completed = rows
        .map((row) => JSON.parse(row.event_json) as VerifiedTaskEvent)
        .filter(
          (event): event is PhaseVerifiedEvent =>
            event.kind === "phase-verified",
        )
        .map((event) => event.phase);
      const required =
        normalized.phase === "green"
          ? task.initial_phase === "green"
            ? undefined
            : "red"
          : normalized.phase === "refactor"
            ? "green"
            : undefined;
      if (required && !completed.includes(required)) {
        throw new Error("ledger-phase-order-invalid");
      }
      if (completed.includes(normalized.phase)) {
        throw new Error("ledger-phase-order-invalid");
      }
    }
    const ordinal = rows.length + 1;
    const priorHash = rows.at(-1)?.event_hash ?? ZERO_HASH;
    const digest = hashEvent(priorHash, ordinal, json);
    this.#database
      .prepare(
        `INSERT INTO task_events (
           run_id, task_id, ordinal, event_id, event_json, prior_hash,
           event_hash
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        normalized.runId,
        normalized.taskId,
        ordinal,
        normalized.eventId,
        json,
        priorHash,
        digest,
      );
    return { accepted: true, ordinal };
  }

  putDurableFact(factKey: string, fact: unknown): unknown {
    this.#assertOpen();
    requireIdentifier(factKey, "ledger-fact-key-invalid");
    const factJson = serializeTaskLedgerProjection(fact);
    const existing = this.#database
      .prepare("SELECT fact_json FROM durable_facts WHERE fact_key = ?")
      .get(factKey) as { fact_json: string } | undefined;
    if (existing) {
      if (existing.fact_json !== factJson) {
        throw new Error("ledger-fact-conflict");
      }
      return JSON.parse(existing.fact_json) as unknown;
    }
    this.#database
      .prepare("INSERT INTO durable_facts(fact_key, fact_json) VALUES (?, ?)")
      .run(factKey, factJson);
    return JSON.parse(factJson) as unknown;
  }

  durableFact(factKey: string): unknown | undefined {
    this.#assertOpen();
    requireIdentifier(factKey, "ledger-fact-key-invalid");
    const row = this.#database
      .prepare("SELECT fact_json FROM durable_facts WHERE fact_key = ?")
      .get(factKey) as { fact_json: string } | undefined;
    return row ? (JSON.parse(row.fact_json) as unknown) : undefined;
  }

  replaceDurableFact(
    factKey: string,
    expectedFact: unknown,
    fact: unknown,
  ): unknown {
    this.#assertOpen();
    requireIdentifier(factKey, "ledger-fact-key-invalid");
    const expectedJson = serializeTaskLedgerProjection(expectedFact);
    const factJson = serializeTaskLedgerProjection(fact);
    const result = this.#database
      .prepare(
        "UPDATE durable_facts SET fact_json = ? WHERE fact_key = ? AND fact_json = ?",
      )
      .run(factJson, factKey, expectedJson);
    if (Number(result.changes) !== 1) {
      throw new Error("ledger-fact-conflict");
    }
    return JSON.parse(factJson) as unknown;
  }

  commitVerifiedEvents(events: VerifiedTaskEvent[]): void {
    this.#assertOpen();
    if (!Array.isArray(events) || events.length === 0 || events.length > 4) {
      throw new Error("ledger-event-batch-invalid");
    }
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      for (const event of events) this.commitVerifiedEvent(event);
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  commitTaskCompletion(input: {
    events: VerifiedTaskEvent[];
    factKey: string;
    fact: unknown;
  }): unknown {
    this.#assertOpen();
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      !hasExactKeys(input, ["events", "factKey", "fact"]) ||
      !Array.isArray(input.events) ||
      input.events.length === 0 ||
      input.events.length > 4
    ) {
      throw new Error("ledger-task-completion-invalid");
    }
    requireIdentifier(input.factKey, "ledger-fact-key-invalid");
    serializeTaskLedgerProjection(input.fact);
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      for (const event of input.events) this.commitVerifiedEvent(event);
      const fact = this.putDurableFact(input.factKey, input.fact);
      this.#database.exec("COMMIT");
      return fact;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  recordWorkerClaim(_input: Record<string, unknown>) {
    this.#assertOpen();
    return { accepted: false, reason: "worker-claim-untrusted" } as const;
  }

  projection(input: {
    runId: string;
    taskId: string;
    nextPhase: ImplementationPhase;
  }) {
    this.#assertOpen();
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      !hasExactKeys(input, ["runId", "taskId", "nextPhase"])
    ) {
      throw new Error("ledger-projection-request-invalid");
    }
    requirePhase(input.nextPhase);
    const task = this.#task(input.runId, input.taskId);
    const history = this.#events(input.runId, input.taskId).map((row) => {
      const value = JSON.parse(row.event_json) as VerifiedTaskEvent;
      const {
        runId: _runId,
        taskId: _taskId,
        eventId: _eventId,
        ...fact
      } = value;
      return { ordinal: row.ordinal, ...fact };
    });
    const projection = {
      runId: input.runId,
      taskId: input.taskId,
      deliveryRevision: task.delivery_revision,
      boundaryHash: task.boundary_hash,
      objective: task.objective,
      contextRefs: JSON.parse(task.context_refs_json) as TaskContextReference[],
      currentPhase: input.nextPhase,
      history,
    };
    serializeTaskLedgerProjection(projection);
    return structuredClone(projection);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#database.close();
  }

  [Symbol.dispose](): void {
    this.close();
  }
}
