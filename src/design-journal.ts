import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  type DesignEvidenceResult,
  validateEvidenceResult,
} from "./contracts.ts";
import { canonicalJson } from "./run-state.ts";
import { prepareStateRoot, type ResolvedStateRoot } from "./state-root.ts";

const SHA256 = /^[a-f0-9]{64}$/u;
const IDENTIFIER = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/iu;
const ZERO_HASH = "0".repeat(64);
const MAX_PLAN_BYTES = 16 * 1024 * 1024;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS design_facts (
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    kind TEXT NOT NULL,
    identity TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    canonical_hash TEXT NOT NULL,
    prior_record_hash TEXT NOT NULL,
    record_hash TEXT NOT NULL,
    PRIMARY KEY (run_id, sequence),
    UNIQUE (run_id, kind, identity),
    UNIQUE (run_id, record_hash)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS design_operations (
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    operation_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    outcome_json TEXT NOT NULL,
    PRIMARY KEY (run_id, operation_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS design_compiled_plans (
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    fact_sequence INTEGER NOT NULL,
    raw_sha256 TEXT NOT NULL,
    canonical_hash TEXT NOT NULL,
    plan_bytes BLOB NOT NULL,
    PRIMARY KEY (run_id, revision),
    UNIQUE (run_id, fact_sequence),
    FOREIGN KEY (run_id, fact_sequence)
      REFERENCES design_facts(run_id, sequence) ON DELETE CASCADE
  ) STRICT;

  CREATE TABLE IF NOT EXISTS design_finalization_leases (
    run_id TEXT PRIMARY KEY REFERENCES runs(run_id) ON DELETE CASCADE,
    operation_id TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL
  ) STRICT;
`;

type DecisionCategory = "behavior" | "technical";
type DesignGate = "gate-a" | "gate-b";

interface RunRow {
  run_id: string;
  root_hash: string;
  stage: string;
  change_name: string | null;
  state: string;
}

interface FactRow {
  sequence: number;
  kind: string;
  identity: string;
  payload_json: string;
  canonical_hash: string;
  prior_record_hash: string;
  record_hash: string;
}

interface OperationRow {
  operation: string;
  request_hash: string;
  outcome_json: string;
}

export interface DesignJournalOptions {
  now?: () => number;
  finalizationLeaseMs?: number;
}

export interface DesignFinalizationLease {
  runId: string;
  operationId: string;
  token: string;
  expiresAt: number;
}

export interface DesignGateProof {
  revision: number;
  contractHash: string;
  recordHash: string;
}

export interface DesignEvidenceProjection {
  packetId: string;
  resultHash: string;
  recordHash: string;
  sequence: number;
  moduleName: string;
  scope: string[];
  filesRead: string[];
  citations: Array<{
    path: string;
    lineStart: number;
    lineEnd: number;
    claimHash: string;
  }>;
}

export interface DesignDecisionProjection {
  decisionId: string;
  category: DecisionCategory;
  revision: number;
  contractHash: string;
  refs: string[];
  recordHash: string;
  sequence: number;
}

export interface DesignPlanProjection {
  revision: number;
  rawSha256: string;
  canonicalHash: string;
  recordHash: string;
  sequence: number;
}

export interface DesignGateProjection {
  current: boolean;
  proof?: DesignGateProof;
  approvedSequence?: number;
  staleReason?:
    | "behavior-decision-changed"
    | "technical-decision-changed"
    | "plan-recompiled"
    | "gate-a-stale"
    | "plan-missing";
}

export interface DesignStatusProjection {
  runId: string;
  change?: string;
  evidence: DesignEvidenceProjection[];
  decisions: DesignDecisionProjection[];
  gates: {
    gateA: DesignGateProjection;
    gateB: DesignGateProjection;
  };
  plan: DesignPlanProjection | null;
}

export interface GateProofVerificationInput {
  change: string;
  gate: DesignGate;
  proof: DesignGateProof;
}

export interface FinalizedDeliveryVerificationInput {
  change: string;
  deliveryRevision: number;
  receiptHash: string;
  gateA: DesignGateProof;
  gateB: DesignGateProof;
  planCanonicalHash: string;
}

export type DesignArtifactOperationFacts =
  | {
      runId: string;
      operationId: string;
      operation: "write-artifact";
      path: string;
      bytes: number;
      rawSha256: string;
    }
  | {
      runId: string;
      operationId: string;
      operation: "delete-artifact";
      path: string;
    };

export type DesignArtifactOperationOutcome =
  | {
      operation: "write-artifact";
      runId: string;
      path: string;
      bytes: number;
      rawSha256: string;
    }
  | {
      operation: "delete-artifact";
      runId: string;
      path: string;
      deleted: false;
    }
  | {
      operation: "delete-artifact";
      runId: string;
      path: string;
      deleted: true;
      bytes: number;
      rawSha256: string;
    };

export interface DesignArtifactOperationState {
  state: "pending" | "committed";
  outcome: DesignArtifactOperationOutcome;
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function requireIdentifier(value: string, label: string): void {
  if (!IDENTIFIER.test(value)) throw new Error(`invalid-${label}`);
}

function requireHash(value: string, label: string): void {
  if (!SHA256.test(value)) throw new Error(`invalid-${label}`);
}

function parseRecord(value: string, code: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(code);
  }
  return parsed as Record<string, unknown>;
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length && actual.every((key) => keys.includes(key))
  );
}

function normalizeRefs(refs: readonly string[]): string[] {
  if (
    !Array.isArray(refs) ||
    refs.length > 128 ||
    refs.some(
      (ref) =>
        typeof ref !== "string" ||
        ref.length === 0 ||
        ref.length > 512 ||
        ref.trim() !== ref ||
        ref.includes("\0") ||
        ref.includes("\n") ||
        ref.includes("\r"),
    )
  ) {
    throw new Error("design-decision-refs-invalid");
  }
  return [...new Set(refs)].sort((left, right) => left.localeCompare(right));
}

export class DesignJournal {
  readonly stateRoot: ResolvedStateRoot;
  readonly #database: DatabaseSync;
  readonly #now: () => number;
  readonly #finalizationLeaseMs: number;
  #closed = false;

  private constructor(
    stateRoot: ResolvedStateRoot,
    database: DatabaseSync,
    options: DesignJournalOptions,
  ) {
    this.stateRoot = stateRoot;
    this.#database = database;
    this.#now = options.now ?? Date.now;
    this.#finalizationLeaseMs = options.finalizationLeaseMs ?? 300_000;
  }

  static open(
    unresolved: ResolvedStateRoot,
    options: DesignJournalOptions = {},
  ): DesignJournal {
    if (
      options.finalizationLeaseMs !== undefined &&
      (!Number.isSafeInteger(options.finalizationLeaseMs) ||
        options.finalizationLeaseMs < 1)
    ) {
      throw new Error("design-finalization-lease-invalid");
    }
    const stateRoot = prepareStateRoot(unresolved);
    const database = new DatabaseSync(stateRoot.databasePath);
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA synchronous = FULL");
    database.exec("PRAGMA busy_timeout = 5000");
    database.exec(SCHEMA);
    return new DesignJournal(stateRoot, database, options);
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("design-journal-closed");
  }

  #transaction<T>(work: () => T): T {
    this.#assertOpen();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  #run(runId: string, mutable: boolean): RunRow {
    const row = this.#database
      .prepare(
        `SELECT run_id, root_hash, stage, change_name, state
         FROM runs WHERE run_id = ?`,
      )
      .get(runId) as RunRow | undefined;
    if (
      !row ||
      row.root_hash !== this.stateRoot.consumerRootHash ||
      row.stage !== "abel-design" ||
      (mutable && ["completed", "discarded", "rejected"].includes(row.state))
    ) {
      throw new Error("design-run-invalid");
    }
    return row;
  }

  assertDesignRun(runId: string): void {
    this.#assertOpen();
    this.#run(runId, true);
  }

  operationOutcome(
    runId: string,
    operationId: string,
    operation: string,
  ): Record<string, unknown> | undefined {
    this.#assertOpen();
    this.#run(runId, false);
    requireIdentifier(operationId, "design-operation-id");
    const row = this.#database
      .prepare(
        `SELECT operation, outcome_json FROM design_operations
         WHERE run_id = ? AND operation_id = ?`,
      )
      .get(runId, operationId) as
      | Pick<OperationRow, "operation" | "outcome_json">
      | undefined;
    if (!row) return undefined;
    if (row.operation !== operation)
      throw new Error("design-operation-conflict");
    return structuredClone(
      parseRecord(row.outcome_json, "design-operation-outcome-invalid"),
    );
  }

  #artifactOperationRequest(
    input: DesignArtifactOperationFacts,
  ): Record<string, unknown> {
    requireIdentifier(input.operationId, "design-operation-id");
    if (
      typeof input.path !== "string" ||
      input.path.length === 0 ||
      input.path.length > 512
    ) {
      throw new Error("design-artifact-path-invalid");
    }
    if (input.operation === "write-artifact") {
      if (
        !Number.isSafeInteger(input.bytes) ||
        input.bytes < 0 ||
        input.bytes > MAX_PLAN_BYTES
      ) {
        throw new Error("design-artifact-content-too-large");
      }
      requireHash(input.rawSha256, "design-artifact-hash");
      return {
        operation: input.operation,
        path: input.path,
        bytes: input.bytes,
        rawSha256: input.rawSha256,
      };
    }
    return { operation: input.operation, path: input.path };
  }

  #validateArtifactOperationOutcome(
    input: DesignArtifactOperationFacts,
    value: unknown,
  ): DesignArtifactOperationOutcome {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("design-artifact-operation-outcome-invalid");
    }
    const outcome = value as Record<string, unknown>;
    if (
      outcome.operation !== input.operation ||
      outcome.runId !== input.runId ||
      outcome.path !== input.path
    ) {
      throw new Error("design-artifact-operation-outcome-invalid");
    }
    if (input.operation === "write-artifact") {
      if (
        !hasExactKeys(outcome, [
          "operation",
          "runId",
          "path",
          "bytes",
          "rawSha256",
        ]) ||
        outcome.bytes !== input.bytes ||
        outcome.rawSha256 !== input.rawSha256
      ) {
        throw new Error("design-artifact-operation-outcome-invalid");
      }
      return structuredClone(outcome) as DesignArtifactOperationOutcome;
    }
    if (outcome.deleted === false) {
      if (!hasExactKeys(outcome, ["operation", "runId", "path", "deleted"])) {
        throw new Error("design-artifact-operation-outcome-invalid");
      }
      return structuredClone(outcome) as DesignArtifactOperationOutcome;
    }
    if (
      !hasExactKeys(outcome, [
        "operation",
        "runId",
        "path",
        "deleted",
        "bytes",
        "rawSha256",
      ]) ||
      outcome.deleted !== true ||
      !Number.isSafeInteger(outcome.bytes) ||
      Number(outcome.bytes) < 0 ||
      Number(outcome.bytes) > MAX_PLAN_BYTES ||
      !SHA256.test(String(outcome.rawSha256))
    ) {
      throw new Error("design-artifact-operation-outcome-invalid");
    }
    return structuredClone(outcome) as DesignArtifactOperationOutcome;
  }

  artifactOperationState(
    input: DesignArtifactOperationFacts,
  ): DesignArtifactOperationState | undefined {
    this.#assertOpen();
    this.#run(input.runId, false);
    const request = this.#artifactOperationRequest(input);
    const row = this.#database
      .prepare(
        `SELECT operation, request_hash, outcome_json
         FROM design_operations WHERE run_id = ? AND operation_id = ?`,
      )
      .get(input.runId, input.operationId) as OperationRow | undefined;
    if (!row) return undefined;
    if (
      row.operation !== input.operation ||
      row.request_hash !== sha256(canonicalJson(request))
    ) {
      throw new Error("design-operation-conflict");
    }
    const stored = parseRecord(
      row.outcome_json,
      "design-artifact-operation-state-invalid",
    );
    if (stored.state !== "pending" && stored.state !== "committed") {
      throw new Error("design-artifact-operation-state-invalid");
    }
    return {
      state: stored.state,
      outcome: this.#validateArtifactOperationOutcome(input, stored.outcome),
    };
  }

  prepareArtifactOperation(
    input: DesignArtifactOperationFacts,
    lease: DesignFinalizationLease,
    outcome: DesignArtifactOperationOutcome,
  ): DesignArtifactOperationState {
    if (
      lease.runId !== input.runId ||
      lease.operationId !== input.operationId
    ) {
      throw new Error("design-finalization-lease-fenced");
    }
    return this.#transaction(() => {
      this.#run(input.runId, true);
      this.#assertFinalizationLease(lease);
      const existing = this.artifactOperationState(input);
      if (existing) return existing;
      const request = this.#artifactOperationRequest(input);
      const validated = this.#validateArtifactOperationOutcome(input, outcome);
      const state: DesignArtifactOperationState = {
        state: "pending",
        outcome: validated,
      };
      this.#database
        .prepare(
          `INSERT INTO design_operations(
             run_id, operation_id, operation, request_hash, outcome_json
           ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          input.runId,
          input.operationId,
          input.operation,
          sha256(canonicalJson(request)),
          canonicalJson(state),
        );
      return structuredClone(state);
    });
  }

  commitArtifactOperation(
    input: DesignArtifactOperationFacts,
    lease: DesignFinalizationLease,
  ): DesignArtifactOperationOutcome {
    if (
      lease.runId !== input.runId ||
      lease.operationId !== input.operationId
    ) {
      throw new Error("design-finalization-lease-fenced");
    }
    return this.#transaction(() => {
      this.#run(input.runId, true);
      this.#assertFinalizationLease(lease);
      const existing = this.artifactOperationState(input);
      if (!existing) throw new Error("design-artifact-operation-unprepared");
      if (existing.state === "committed") {
        return structuredClone(existing.outcome);
      }
      this.#database
        .prepare(
          `UPDATE design_operations SET outcome_json = ?
           WHERE run_id = ? AND operation_id = ?`,
        )
        .run(
          canonicalJson({ state: "committed", outcome: existing.outcome }),
          input.runId,
          input.operationId,
        );
      return structuredClone(existing.outcome);
    });
  }

  assertNoPendingArtifactOperations(runId: string): void {
    this.#assertOpen();
    this.#run(runId, true);
    const rows = this.#database
      .prepare(
        `SELECT outcome_json FROM design_operations
         WHERE run_id = ? AND operation IN ('write-artifact', 'delete-artifact')`,
      )
      .all(runId) as unknown as Array<{ outcome_json: string }>;
    for (const row of rows) {
      const state = parseRecord(
        row.outcome_json,
        "design-artifact-operation-state-invalid",
      ).state;
      if (state !== "pending" && state !== "committed") {
        throw new Error("design-artifact-operation-state-invalid");
      }
      if (state === "pending") {
        throw new Error("design-artifact-operation-pending");
      }
    }
  }

  latestFinalizationOutcome(
    runId: string,
  ): { operationId: string; outcome: Record<string, unknown> } | undefined {
    this.#assertOpen();
    this.#run(runId, false);
    const row = this.#database
      .prepare(
        `SELECT operation_id, outcome_json FROM design_operations
         WHERE run_id = ? AND operation = 'finalize-delivery'
         ORDER BY rowid DESC LIMIT 1`,
      )
      .get(runId) as { operation_id: string; outcome_json: string } | undefined;
    return row
      ? {
          operationId: row.operation_id,
          outcome: structuredClone(
            parseRecord(
              row.outcome_json,
              "design-finalization-outcome-invalid",
            ),
          ),
        }
      : undefined;
  }

  acquireFinalizationLease(input: {
    runId: string;
    operationId: string;
  }): DesignFinalizationLease {
    requireIdentifier(input.operationId, "design-operation-id");
    return this.#transaction(() => {
      this.#run(input.runId, true);
      const now = this.#now();
      const existing = this.#database
        .prepare(
          `SELECT operation_id, token, expires_at
           FROM design_finalization_leases WHERE run_id = ?`,
        )
        .get(input.runId) as
        | { operation_id: string; token: string; expires_at: number }
        | undefined;
      if (existing && existing.expires_at > now) {
        throw new Error("design-finalization-busy");
      }
      if (existing) {
        this.#database
          .prepare("DELETE FROM design_finalization_leases WHERE run_id = ?")
          .run(input.runId);
      }
      const lease: DesignFinalizationLease = {
        runId: input.runId,
        operationId: input.operationId,
        token: randomUUID(),
        expiresAt: now + this.#finalizationLeaseMs,
      };
      this.#database
        .prepare(
          `INSERT INTO design_finalization_leases(
             run_id, operation_id, token, expires_at
           ) VALUES (?, ?, ?, ?)`,
        )
        .run(lease.runId, lease.operationId, lease.token, lease.expiresAt);
      return lease;
    });
  }

  #assertFinalizationLease(lease: DesignFinalizationLease): void {
    const row = this.#database
      .prepare(
        `SELECT operation_id, token, expires_at
         FROM design_finalization_leases WHERE run_id = ?`,
      )
      .get(lease.runId) as
      | { operation_id: string; token: string; expires_at: number }
      | undefined;
    if (
      !row ||
      row.operation_id !== lease.operationId ||
      row.token !== lease.token ||
      row.expires_at !== lease.expiresAt ||
      row.expires_at <= this.#now()
    ) {
      throw new Error("design-finalization-lease-fenced");
    }
  }

  assertFinalizationLease(lease: DesignFinalizationLease): void {
    this.#assertOpen();
    this.#assertFinalizationLease(lease);
  }

  releaseFinalizationLease(lease: DesignFinalizationLease): void {
    this.#transaction(() => {
      this.#database
        .prepare(
          `DELETE FROM design_finalization_leases
           WHERE run_id = ? AND operation_id = ? AND token = ?`,
        )
        .run(lease.runId, lease.operationId, lease.token);
    });
  }

  #facts(runId: string): FactRow[] {
    return this.#database
      .prepare(
        `SELECT sequence, kind, identity, payload_json, canonical_hash,
                prior_record_hash, record_hash
         FROM design_facts WHERE run_id = ? ORDER BY sequence`,
      )
      .all(runId) as unknown as FactRow[];
  }

  #appendFact(
    runId: string,
    kind: string,
    identity: string,
    payload: Record<string, unknown>,
  ): FactRow {
    const latest = this.#database
      .prepare(
        `SELECT sequence, record_hash FROM design_facts
         WHERE run_id = ? ORDER BY sequence DESC LIMIT 1`,
      )
      .get(runId) as { sequence: number; record_hash: string } | undefined;
    const sequence = (latest?.sequence ?? 0) + 1;
    const canonicalHash = sha256(canonicalJson(payload));
    const priorRecordHash = latest?.record_hash ?? ZERO_HASH;
    const recordHash = sha256(
      canonicalJson({
        runId,
        sequence,
        kind,
        identity,
        canonicalHash,
        priorRecordHash,
      }),
    );
    this.#database
      .prepare(
        `INSERT INTO design_facts(
           run_id, sequence, kind, identity, payload_json, canonical_hash,
           prior_record_hash, record_hash
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        runId,
        sequence,
        kind,
        identity,
        canonicalJson(payload),
        canonicalHash,
        priorRecordHash,
        recordHash,
      );
    return {
      sequence,
      kind,
      identity,
      payload_json: canonicalJson(payload),
      canonical_hash: canonicalHash,
      prior_record_hash: priorRecordHash,
      record_hash: recordHash,
    };
  }

  #operationReplay(
    runId: string,
    operationId: string,
    operation: string,
    request: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    requireIdentifier(operationId, "design-operation-id");
    const requestHash = sha256(canonicalJson(request));
    const row = this.#database
      .prepare(
        `SELECT operation, request_hash, outcome_json
         FROM design_operations WHERE run_id = ? AND operation_id = ?`,
      )
      .get(runId, operationId) as OperationRow | undefined;
    if (!row) return undefined;
    if (row.operation !== operation || row.request_hash !== requestHash) {
      throw new Error("design-operation-conflict");
    }
    return parseRecord(row.outcome_json, "design-operation-outcome-invalid");
  }

  #recordOperation(
    runId: string,
    operationId: string,
    operation: string,
    request: Record<string, unknown>,
    outcome: Record<string, unknown>,
  ): void {
    this.#database
      .prepare(
        `INSERT INTO design_operations(
           run_id, operation_id, operation, request_hash, outcome_json
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        runId,
        operationId,
        operation,
        sha256(canonicalJson(request)),
        canonicalJson(outcome),
      );
  }

  recordEvidence(input: {
    runId: string;
    evidence: DesignEvidenceResult;
  }): DesignEvidenceProjection {
    return this.#transaction(() => {
      this.#run(input.runId, true);
      const validation = validateEvidenceResult(input.evidence);
      if (!validation.ok || input.evidence.role !== "design-explorer") {
        throw new Error("design-evidence-invalid");
      }
      const resultHash = sha256(canonicalJson(input.evidence));
      const existing = this.#database
        .prepare(
          `SELECT sequence, payload_json, record_hash
           FROM design_facts
           WHERE run_id = ? AND kind = 'evidence' AND identity = ?`,
        )
        .get(input.runId, input.evidence.packet_id) as
        | { sequence: number; payload_json: string; record_hash: string }
        | undefined;
      if (existing) {
        const payload = parseRecord(
          existing.payload_json,
          "design-evidence-record-invalid",
        );
        if (payload.resultHash !== resultHash) {
          throw new Error("design-evidence-conflict");
        }
        return this.#evidenceProjection(existing, payload);
      }
      const payload = {
        packetId: input.evidence.packet_id,
        resultHash,
        moduleName: input.evidence.module_name,
        scope: [...new Set(input.evidence.scope)].sort(),
        filesRead: [...new Set(input.evidence.files_read)].sort(),
        citations: input.evidence.evidence
          .map((citation) => ({
            path: citation.path,
            lineStart: citation.line_start,
            lineEnd: citation.line_end,
            claimHash: sha256(citation.claim),
          }))
          .sort(
            (left, right) =>
              left.path.localeCompare(right.path) ||
              left.lineStart - right.lineStart ||
              left.lineEnd - right.lineEnd ||
              left.claimHash.localeCompare(right.claimHash),
          ),
      };
      const fact = this.#appendFact(
        input.runId,
        "evidence",
        input.evidence.packet_id,
        payload,
      );
      return this.#evidenceProjection(fact, payload);
    });
  }

  #evidenceProjection(
    row: Pick<FactRow, "sequence" | "record_hash">,
    payload: Record<string, unknown>,
  ): DesignEvidenceProjection {
    return {
      packetId: String(payload.packetId),
      resultHash: String(payload.resultHash),
      recordHash: row.record_hash,
      sequence: row.sequence,
      moduleName: String(payload.moduleName),
      scope: structuredClone(payload.scope as string[]),
      filesRead: structuredClone(payload.filesRead as string[]),
      citations: structuredClone(
        payload.citations as DesignEvidenceProjection["citations"],
      ),
    };
  }

  recordDecision(input: {
    runId: string;
    operationId: string;
    decisionId: string;
    category: DecisionCategory;
    contractHash: string;
    refs: string[];
  }): Record<string, unknown> {
    requireIdentifier(input.decisionId, "design-decision-id");
    requireHash(input.contractHash, "design-decision-hash");
    if (input.category !== "behavior" && input.category !== "technical") {
      throw new Error("design-decision-category-invalid");
    }
    const refs = normalizeRefs(input.refs);
    const request = {
      operation: "record-decision",
      decisionId: input.decisionId,
      category: input.category,
      contractHash: input.contractHash,
      refs,
    };
    return this.#transaction(() => {
      this.#run(input.runId, true);
      const replay = this.#operationReplay(
        input.runId,
        input.operationId,
        "record-decision",
        request,
      );
      if (replay) return structuredClone(replay);
      const prior = this.#latestDecision(input.runId, input.decisionId);
      if (prior && prior.category !== input.category) {
        throw new Error("design-decision-category-conflict");
      }
      let decision: DesignDecisionProjection;
      if (
        prior &&
        prior.contractHash === input.contractHash &&
        canonicalJson(prior.refs) === canonicalJson(refs)
      ) {
        decision = prior;
      } else {
        const revision = (prior?.revision ?? 0) + 1;
        const payload = {
          decisionId: input.decisionId,
          category: input.category,
          revision,
          contractHash: input.contractHash,
          refs,
        };
        const fact = this.#appendFact(
          input.runId,
          "decision",
          `${input.decisionId}:${revision}`,
          payload,
        );
        decision = this.#decisionProjection(fact, payload);
      }
      const outcome = {
        operation: "record-decision",
        runId: input.runId,
        decision,
        gates: this.#gateStatus(input.runId),
      };
      this.#recordOperation(
        input.runId,
        input.operationId,
        "record-decision",
        request,
        outcome,
      );
      return structuredClone(outcome);
    });
  }

  #decisionProjection(
    fact: Pick<FactRow, "sequence" | "record_hash">,
    payload: Record<string, unknown>,
  ): DesignDecisionProjection {
    return {
      decisionId: String(payload.decisionId),
      category: payload.category as DecisionCategory,
      revision: Number(payload.revision),
      contractHash: String(payload.contractHash),
      refs: structuredClone(payload.refs as string[]),
      recordHash: fact.record_hash,
      sequence: fact.sequence,
    };
  }

  #latestDecision(
    runId: string,
    decisionId: string,
  ): DesignDecisionProjection | undefined {
    const rows = this.#facts(runId).filter((row) => row.kind === "decision");
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index];
      const payload = parseRecord(
        row.payload_json,
        "design-decision-record-invalid",
      );
      if (payload.decisionId === decisionId) {
        return this.#decisionProjection(row, payload);
      }
    }
    return undefined;
  }

  approveGate(input: {
    runId: string;
    operationId: string;
    gate: DesignGate;
    contractHash: string;
  }): {
    operation: "approve-gate";
    runId: string;
    gate: DesignGate;
    proof: DesignGateProof;
  } {
    if (input.gate !== "gate-a" && input.gate !== "gate-b") {
      throw new Error("design-gate-invalid");
    }
    requireHash(input.contractHash, "design-decision-hash");
    const request = {
      operation: "approve-gate",
      gate: input.gate,
      contractHash: input.contractHash,
    };
    return this.#transaction(() => {
      this.#run(input.runId, true);
      const replay = this.#operationReplay(
        input.runId,
        input.operationId,
        "approve-gate",
        request,
      );
      if (replay)
        return structuredClone(replay) as ReturnType<
          DesignJournal["approveGate"]
        >;
      if (input.gate === "gate-b") {
        const current = this.#gateStatus(input.runId);
        if (!current.gateA.current) throw new Error("design-gate-a-required");
        const plan = this.#currentPlanProjection(input.runId);
        if (!plan) throw new Error("design-plan-required");
        if (plan.canonicalHash !== input.contractHash) {
          throw new Error("design-gate-b-plan-mismatch");
        }
      }
      const existing = this.#latestApproval(input.runId, input.gate);
      const currentGate = this.#gateStatus(input.runId)[
        input.gate === "gate-a" ? "gateA" : "gateB"
      ];
      let proof: DesignGateProof;
      if (
        existing &&
        currentGate.current &&
        existing.proof.contractHash === input.contractHash
      ) {
        proof = existing.proof;
      } else {
        const revision = (existing?.proof.revision ?? 0) + 1;
        const payload = {
          gate: input.gate,
          revision,
          contractHash: input.contractHash,
        };
        const fact = this.#appendFact(
          input.runId,
          "approval",
          `${input.gate}:${revision}`,
          payload,
        );
        proof = {
          revision,
          contractHash: input.contractHash,
          recordHash: fact.record_hash,
        };
      }
      const outcome = {
        operation: "approve-gate" as const,
        runId: input.runId,
        gate: input.gate,
        proof,
      };
      this.#recordOperation(
        input.runId,
        input.operationId,
        "approve-gate",
        request,
        outcome,
      );
      return structuredClone(outcome);
    });
  }

  #latestApproval(
    runId: string,
    gate: DesignGate,
  ): { sequence: number; proof: DesignGateProof } | undefined {
    const rows = this.#facts(runId).filter((row) => row.kind === "approval");
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index];
      const payload = parseRecord(
        row.payload_json,
        "design-approval-record-invalid",
      );
      if (payload.gate === gate) {
        return {
          sequence: row.sequence,
          proof: {
            revision: Number(payload.revision),
            contractHash: String(payload.contractHash),
            recordHash: row.record_hash,
          },
        };
      }
    }
    return undefined;
  }

  recordCompiledPlan(input: {
    runId: string;
    operationId: string;
    bytes: Uint8Array;
    rawSha256: string;
    canonicalHash: string;
    lease?: DesignFinalizationLease;
  }): Record<string, unknown> {
    requireHash(input.rawSha256, "design-plan-raw-hash");
    requireHash(input.canonicalHash, "design-plan-canonical-hash");
    if (
      !(input.bytes instanceof Uint8Array) ||
      input.bytes.byteLength < 1 ||
      input.bytes.byteLength > MAX_PLAN_BYTES ||
      sha256(input.bytes) !== input.rawSha256
    ) {
      throw new Error("design-plan-bytes-invalid");
    }
    const request = {
      operation: "compile-plan",
      rawSha256: input.rawSha256,
      canonicalHash: input.canonicalHash,
    };
    return this.#transaction(() => {
      this.#run(input.runId, true);
      const replay = this.#operationReplay(
        input.runId,
        input.operationId,
        "compile-plan",
        request,
      );
      if (replay) return structuredClone(replay);
      if (input.lease) {
        if (
          input.lease.runId !== input.runId ||
          input.lease.operationId !== input.operationId
        ) {
          throw new Error("design-finalization-lease-fenced");
        }
        this.#assertFinalizationLease(input.lease);
      }
      if (!this.#gateStatus(input.runId).gateA.current) {
        throw new Error("design-gate-a-required");
      }
      const prior = this.#currentPlanProjection(input.runId);
      const revision = (prior?.revision ?? 0) + 1;
      const payload = {
        revision,
        rawSha256: input.rawSha256,
        canonicalHash: input.canonicalHash,
      };
      const fact = this.#appendFact(
        input.runId,
        "plan",
        String(revision),
        payload,
      );
      this.#database
        .prepare(
          `INSERT INTO design_compiled_plans(
             run_id, revision, fact_sequence, raw_sha256, canonical_hash,
             plan_bytes
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.runId,
          revision,
          fact.sequence,
          input.rawSha256,
          input.canonicalHash,
          Buffer.from(input.bytes),
        );
      const plan: DesignPlanProjection = {
        revision,
        rawSha256: input.rawSha256,
        canonicalHash: input.canonicalHash,
        recordHash: fact.record_hash,
        sequence: fact.sequence,
      };
      const outcome = {
        operation: "compile-plan",
        runId: input.runId,
        plan,
        gates: this.#gateStatus(input.runId),
      };
      this.#recordOperation(
        input.runId,
        input.operationId,
        "compile-plan",
        request,
        outcome,
      );
      return structuredClone(outcome);
    });
  }

  #currentPlanProjection(runId: string): DesignPlanProjection | undefined {
    const row = this.#database
      .prepare(
        `SELECT plans.revision, plans.raw_sha256, plans.canonical_hash,
                facts.sequence, facts.record_hash
         FROM design_compiled_plans AS plans
         JOIN design_facts AS facts
           ON facts.run_id = plans.run_id
          AND facts.sequence = plans.fact_sequence
         WHERE plans.run_id = ? ORDER BY plans.revision DESC LIMIT 1`,
      )
      .get(runId) as
      | {
          revision: number;
          raw_sha256: string;
          canonical_hash: string;
          sequence: number;
          record_hash: string;
        }
      | undefined;
    return row
      ? {
          revision: row.revision,
          rawSha256: row.raw_sha256,
          canonicalHash: row.canonical_hash,
          recordHash: row.record_hash,
          sequence: row.sequence,
        }
      : undefined;
  }

  currentCompiledPlan(
    runId: string,
  ): { projection: DesignPlanProjection; bytes: Uint8Array } | undefined {
    this.#assertOpen();
    this.#run(runId, false);
    const row = this.#database
      .prepare(
        `SELECT plan_bytes FROM design_compiled_plans
         WHERE run_id = ? ORDER BY revision DESC LIMIT 1`,
      )
      .get(runId) as { plan_bytes: Uint8Array } | undefined;
    const projection = this.#currentPlanProjection(runId);
    if (!row || !projection) return undefined;
    return { projection, bytes: Uint8Array.from(row.plan_bytes) };
  }

  verifyGateProof(input: GateProofVerificationInput): boolean {
    this.#assertOpen();
    if (
      typeof input.change !== "string" ||
      input.change.length === 0 ||
      (input.gate !== "gate-a" && input.gate !== "gate-b") ||
      !Number.isSafeInteger(input.proof.revision) ||
      input.proof.revision < 1 ||
      !SHA256.test(input.proof.contractHash) ||
      !SHA256.test(input.proof.recordHash)
    ) {
      return false;
    }
    const row = this.#database
      .prepare(
        `SELECT facts.run_id, facts.payload_json
         FROM design_facts AS facts
         JOIN runs ON runs.run_id = facts.run_id
         WHERE runs.root_hash = ? AND runs.stage = 'abel-design'
           AND runs.change_name = ? AND facts.kind = 'approval'
           AND facts.record_hash = ?`,
      )
      .get(
        this.stateRoot.consumerRootHash,
        input.change,
        input.proof.recordHash,
      ) as { run_id: string; payload_json: string } | undefined;
    if (!row) return false;
    const payload = parseRecord(
      row.payload_json,
      "design-approval-record-invalid",
    );
    if (
      payload.gate !== input.gate ||
      payload.revision !== input.proof.revision ||
      payload.contractHash !== input.proof.contractHash
    ) {
      return false;
    }
    const status = this.#gateStatus(row.run_id)[
      input.gate === "gate-a" ? "gateA" : "gateB"
    ];
    return (
      status.current &&
      status.proof?.recordHash === input.proof.recordHash &&
      status.proof.revision === input.proof.revision &&
      status.proof.contractHash === input.proof.contractHash
    );
  }

  verifyFinalizedDelivery(input: FinalizedDeliveryVerificationInput): boolean {
    this.#assertOpen();
    if (
      typeof input.change !== "string" ||
      input.change.length === 0 ||
      !Number.isSafeInteger(input.deliveryRevision) ||
      input.deliveryRevision < 1 ||
      !SHA256.test(input.receiptHash) ||
      !SHA256.test(input.planCanonicalHash)
    ) {
      return false;
    }
    const rows = this.#database
      .prepare(
        `SELECT facts.payload_json
         FROM design_facts AS facts
         JOIN runs ON runs.run_id = facts.run_id
         WHERE runs.root_hash = ? AND runs.stage = 'abel-design'
           AND runs.change_name = ? AND facts.kind = 'finalization'`,
      )
      .all(this.stateRoot.consumerRootHash, input.change) as unknown as Array<{
      payload_json: string;
    }>;
    return rows.some((row) => {
      const payload = parseRecord(
        row.payload_json,
        "design-finalization-record-invalid",
      );
      return (
        payload.deliveryRevision === input.deliveryRevision &&
        payload.receiptHash === input.receiptHash &&
        payload.planCanonicalHash === input.planCanonicalHash &&
        canonicalJson(payload.gateA) === canonicalJson(input.gateA) &&
        canonicalJson(payload.gateB) === canonicalJson(input.gateB)
      );
    });
  }

  nextDeliveryRevision(runId: string): number {
    this.#assertOpen();
    const run = this.#run(runId, true);
    if (!run.change_name) throw new Error("design-change-required");
    const rows = this.#database
      .prepare(
        `SELECT facts.payload_json
         FROM design_facts AS facts
         JOIN runs ON runs.run_id = facts.run_id
         WHERE runs.root_hash = ? AND runs.stage = 'abel-design'
           AND runs.change_name = ? AND facts.kind = 'finalization'`,
      )
      .all(
        this.stateRoot.consumerRootHash,
        run.change_name,
      ) as unknown as Array<{
      payload_json: string;
    }>;
    const maximum = rows.reduce((current, row) => {
      const payload = parseRecord(
        row.payload_json,
        "design-finalization-record-invalid",
      );
      const revision = Number(payload.deliveryRevision);
      if (!Number.isSafeInteger(revision) || revision < 1) {
        throw new Error("design-finalization-record-invalid");
      }
      return Math.max(current, revision);
    }, 0);
    return maximum + 1;
  }

  recordFinalization(input: {
    runId: string;
    operationId: string;
    lease: DesignFinalizationLease;
    deliveryRevision: number;
    receiptHash: string;
    gateA: DesignGateProof;
    gateB: DesignGateProof;
    planCanonicalHash: string;
  }): Record<string, unknown> {
    if (
      input.lease.runId !== input.runId ||
      input.lease.operationId !== input.operationId
    ) {
      throw new Error("design-finalization-lease-fenced");
    }
    if (
      !Number.isSafeInteger(input.deliveryRevision) ||
      input.deliveryRevision < 1
    ) {
      throw new Error("design-delivery-revision-invalid");
    }
    for (const [label, value] of [
      ["design-receipt-hash", input.receiptHash],
      ["design-plan-canonical-hash", input.planCanonicalHash],
      ["design-gate-a-contract-hash", input.gateA.contractHash],
      ["design-gate-a-record-hash", input.gateA.recordHash],
      ["design-gate-b-contract-hash", input.gateB.contractHash],
      ["design-gate-b-record-hash", input.gateB.recordHash],
    ] as const) {
      requireHash(value, label);
    }
    const request = {
      operation: "finalize-delivery",
      deliveryRevision: input.deliveryRevision,
      receiptHash: input.receiptHash,
      gateA: input.gateA,
      gateB: input.gateB,
      planCanonicalHash: input.planCanonicalHash,
    };
    return this.#transaction(() => {
      this.#run(input.runId, false);
      const replay = this.#operationReplay(
        input.runId,
        input.operationId,
        "finalize-delivery",
        request,
      );
      if (replay) return structuredClone(replay);
      this.#run(input.runId, true);
      this.#assertFinalizationLease(input.lease);
      const gates = this.#gateStatus(input.runId);
      const plan = this.#currentPlanProjection(input.runId);
      if (
        !gates.gateA.current ||
        !gates.gateB.current ||
        canonicalJson(gates.gateA.proof) !== canonicalJson(input.gateA) ||
        canonicalJson(gates.gateB.proof) !== canonicalJson(input.gateB) ||
        !plan ||
        plan.canonicalHash !== input.planCanonicalHash ||
        input.gateB.contractHash !== input.planCanonicalHash
      ) {
        throw new Error("design-finalization-proof-stale");
      }
      const expectedRevision = this.nextDeliveryRevision(input.runId);
      if (input.deliveryRevision !== expectedRevision) {
        throw new Error("design-delivery-revision-conflict");
      }
      const payload = {
        deliveryRevision: input.deliveryRevision,
        receiptHash: input.receiptHash,
        gateA: input.gateA,
        gateB: input.gateB,
        planCanonicalHash: input.planCanonicalHash,
      };
      this.#appendFact(
        input.runId,
        "finalization",
        String(input.deliveryRevision),
        payload,
      );
      const outcome = {
        operation: "finalize-delivery",
        runId: input.runId,
        state: "completed",
        completed: true,
        deliveryRevision: input.deliveryRevision,
        receiptHash: input.receiptHash,
      };
      this.#recordOperation(
        input.runId,
        input.operationId,
        "finalize-delivery",
        request,
        outcome,
      );
      return structuredClone(outcome);
    });
  }

  #gateStatus(runId: string): DesignStatusProjection["gates"] {
    const facts = this.#facts(runId);
    const latestBehavior = facts
      .filter((fact) => {
        if (fact.kind !== "decision") return false;
        return (
          parseRecord(fact.payload_json, "design-decision-record-invalid")
            .category === "behavior"
        );
      })
      .at(-1)?.sequence;
    const latestTechnical = facts
      .filter((fact) => {
        if (fact.kind !== "decision") return false;
        return (
          parseRecord(fact.payload_json, "design-decision-record-invalid")
            .category === "technical"
        );
      })
      .at(-1)?.sequence;
    const plan = this.#currentPlanProjection(runId);
    const gateAApproval = this.#latestApproval(runId, "gate-a");
    const gateBApproval = this.#latestApproval(runId, "gate-b");
    const gateAChanged =
      gateAApproval !== undefined &&
      latestBehavior !== undefined &&
      latestBehavior > gateAApproval.sequence;
    const gateA: DesignGateProjection = gateAApproval
      ? {
          current: !gateAChanged,
          proof: gateAApproval.proof,
          approvedSequence: gateAApproval.sequence,
          ...(gateAChanged
            ? { staleReason: "behavior-decision-changed" as const }
            : {}),
        }
      : { current: false };

    let staleReason: DesignGateProjection["staleReason"];
    if (gateBApproval) {
      if (
        latestBehavior !== undefined &&
        latestBehavior > gateBApproval.sequence
      ) {
        staleReason = "behavior-decision-changed";
      } else if (
        latestTechnical !== undefined &&
        latestTechnical > gateBApproval.sequence
      ) {
        staleReason = "technical-decision-changed";
      } else if (plan && plan.sequence > gateBApproval.sequence) {
        staleReason = "plan-recompiled";
      } else if (!plan) {
        staleReason = "plan-missing";
      } else if (!gateA.current) {
        staleReason = "gate-a-stale";
      } else if (plan.canonicalHash !== gateBApproval.proof.contractHash) {
        staleReason = "plan-recompiled";
      }
    }
    const gateB: DesignGateProjection = gateBApproval
      ? {
          current: staleReason === undefined,
          proof: gateBApproval.proof,
          approvedSequence: gateBApproval.sequence,
          ...(staleReason ? { staleReason } : {}),
        }
      : { current: false };
    return { gateA, gateB };
  }

  status(runId: string): DesignStatusProjection {
    this.#assertOpen();
    const run = this.#run(runId, false);
    const facts = this.#facts(runId);
    const evidence = facts
      .filter((fact) => fact.kind === "evidence")
      .map((fact) =>
        this.#evidenceProjection(
          fact,
          parseRecord(fact.payload_json, "design-evidence-record-invalid"),
        ),
      );
    const latestDecisions = new Map<string, DesignDecisionProjection>();
    for (const fact of facts.filter(
      (candidate) => candidate.kind === "decision",
    )) {
      const decision = this.#decisionProjection(
        fact,
        parseRecord(fact.payload_json, "design-decision-record-invalid"),
      );
      latestDecisions.set(decision.decisionId, decision);
    }
    return {
      runId,
      ...(run.change_name ? { change: run.change_name } : {}),
      evidence,
      decisions: [...latestDecisions.values()].sort((left, right) =>
        left.decisionId.localeCompare(right.decisionId),
      ),
      gates: this.#gateStatus(runId),
      plan: this.#currentPlanProjection(runId) ?? null,
    };
  }

  close(): void {
    if (this.#closed) return;
    this.#database.close();
    this.#closed = true;
  }
}
