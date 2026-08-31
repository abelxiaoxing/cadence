import { randomUUID } from "node:crypto";
import { chmodSync, closeSync, lstatSync, openSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  createRunEvent,
  type DeliveryGate,
  type RunEvent,
  type RunProjection,
  type RunStage,
  type RunState,
  reduceRunEvents,
  ZERO_EVENT_HASH,
} from "./run-state.ts";
import {
  prepareStateRoot,
  type ResolvedStateRoot,
  StateRootError,
} from "./state-root.ts";

export class RunStoreFormatError extends Error {
  readonly code = "run-store-reset-required" as const;
  readonly databasePath: string;
  readonly recovery = Object.freeze({
    action: "reset-private-run-store" as const,
    requiresBackup: true as const,
    retryCommand: "status-or-start" as const,
  });

  constructor(databasePath: string) {
    super("run-store-reset-required");
    this.name = "RunStoreFormatError";
    this.databasePath = databasePath;
  }
}

const CHANGE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/u;
const IDENTIFIER = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/iu;
const SHA256 = /^[a-f0-9]{64}$/u;

interface RunRow {
  run_id: string;
  projection_json: string;
}

interface EventRow {
  sequence: number;
  type: string;
  payload_json: string;
  prior_hash: string;
  event_hash: string;
}

interface OperationRow {
  kind: string;
  state: string;
  outcome_json: string | null;
  lease_token: string | null;
  lease_expires_at: number | null;
}

export interface RunStoreOptions {
  now?: () => number;
  busyTimeoutMs?: number;
}

export interface StartRunInput {
  stage: RunStage;
  change?: string;
  provisionalKey?: string;
  operationId: string;
}

export interface BindDeliveryInput {
  runId: string;
  gate: DeliveryGate;
  revision: number;
  receiptHash: string;
  approvalProof?: {
    revision: number;
    contractHash: string;
    recordHash: string;
  };
  operationId: string;
  lease?: OperationLease;
}

export interface OperationLease {
  runId: string;
  operationId: string;
  token: string;
  expiresAt: number;
}

export interface OperationLeaseStatus {
  state: "running" | "committed" | "interrupted";
  outcome?: Record<string, unknown>;
  expiresAt?: number;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS runs (
    run_id TEXT PRIMARY KEY,
    root_hash TEXT NOT NULL,
    stage TEXT NOT NULL,
    lookup_key TEXT NOT NULL,
    change_name TEXT,
    provisional_key TEXT,
    state TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    event_hash TEXT NOT NULL,
    delivery_revision INTEGER,
    projection_json TEXT NOT NULL,
    terminal_tombstone TEXT,
    UNIQUE (root_hash, stage, lookup_key)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS delivery_bindings (
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    gate TEXT NOT NULL,
    revision INTEGER NOT NULL,
    receipt_hash TEXT NOT NULL,
    approval_revision INTEGER,
    contract_hash TEXT,
    record_hash TEXT,
    operation_id TEXT NOT NULL,
    PRIMARY KEY (run_id, gate, revision),
    UNIQUE (run_id, operation_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS events (
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    prior_hash TEXT NOT NULL,
    event_hash TEXT NOT NULL,
    PRIMARY KEY (run_id, sequence),
    UNIQUE (run_id, event_hash)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS tasks (
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    task_id TEXT NOT NULL,
    state TEXT NOT NULL,
    phase TEXT,
    projection_json TEXT NOT NULL,
    PRIMARY KEY (run_id, task_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS operations (
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    operation_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    state TEXT NOT NULL,
    outcome_json TEXT,
    lease_token TEXT,
    lease_expires_at INTEGER,
    PRIMARY KEY (run_id, operation_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS route_health (
    route_fingerprint TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    next_half_open_at INTEGER,
    projection_json TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS artifacts (
    content_hash TEXT PRIMARY KEY,
    size_bytes INTEGER NOT NULL,
    seal_state TEXT NOT NULL,
    owner_run_id TEXT REFERENCES runs(run_id) ON DELETE CASCADE,
    reference_count INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS workspace_revisions (
    revision_id TEXT PRIMARY KEY,
    owner_run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    parent_revision_id TEXT,
    manifest_hash TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS apply_transactions (
    transaction_id TEXT PRIMARY KEY,
    owner_run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    state TEXT NOT NULL,
    intent_json TEXT NOT NULL,
    recovery_json TEXT
  ) STRICT;

  CREATE TABLE IF NOT EXISTS bootstrap_handoffs (
    handoff_id TEXT PRIMARY KEY,
    owner_run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    receipt_hash TEXT NOT NULL UNIQUE,
    state TEXT NOT NULL,
    facts_json TEXT NOT NULL
  ) STRICT;
`;

function requireIdentifier(value: string, label: string): void {
  if (!IDENTIFIER.test(value)) throw new Error(`invalid-${label}`);
}

function configureDatabase(
  database: DatabaseSync,
  busyTimeoutMs: number | undefined,
): void {
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = FULL");
  database.exec(
    `PRAGMA busy_timeout = ${Math.max(1, Math.min(30_000, busyTimeoutMs ?? 5_000))}`,
  );
}

const REQUIRED_TABLES = [
  "runs",
  "delivery_bindings",
  "events",
  "tasks",
  "operations",
  "route_health",
  "artifacts",
  "workspace_revisions",
  "apply_transactions",
  "bootstrap_handoffs",
] as const;

const REQUIRED_DELIVERY_BINDING_COLUMNS = [
  "run_id",
  "gate",
  "revision",
  "receipt_hash",
  "approval_revision",
  "contract_hash",
  "record_hash",
  "operation_id",
] as const;

function applicationTables(database: DatabaseSync): string[] {
  return (
    database
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
      )
      .all() as unknown as Array<{ name: string }>
  ).map(({ name }) => name);
}

function tableColumns(database: DatabaseSync, table: string): string[] {
  return (
    database.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{
      name: string;
    }>
  ).map(({ name }) => name);
}

function hasCurrentSchema(database: DatabaseSync): boolean {
  const tables = applicationTables(database);
  const deliveryBindingColumns = tableColumns(database, "delivery_bindings");
  return (
    !tables.includes("schema_meta") &&
    REQUIRED_TABLES.every((table) => tables.includes(table)) &&
    REQUIRED_DELIVERY_BINDING_COLUMNS.every((column) =>
      deliveryBindingColumns.includes(column),
    )
  );
}

function parseProjection(value: string): RunProjection {
  const parsed = JSON.parse(value) as RunProjection;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof parsed.runId !== "string"
  ) {
    throw new Error("run-projection-invalid");
  }
  return parsed;
}

function lookupKey(input: StartRunInput): string {
  const hasChange = typeof input.change === "string";
  const hasProvisional = typeof input.provisionalKey === "string";
  if (hasChange === hasProvisional) throw new Error("invalid-run-lookup-key");
  if (hasChange) {
    if (!CHANGE_NAME.test(input.change as string))
      throw new Error("invalid-change");
    return `change:${input.change}`;
  }
  if (!SHA256.test(input.provisionalKey as string)) {
    throw new Error("invalid-provisional-key");
  }
  if (input.stage !== "abel-design") {
    throw new Error("provisional-run-requires-design");
  }
  return `provisional:${input.provisionalKey}`;
}

export class RunStore {
  readonly stateRoot: ResolvedStateRoot;
  readonly #database: DatabaseSync;
  readonly #now: () => number;
  #closed = false;

  private constructor(
    stateRoot: ResolvedStateRoot,
    database: DatabaseSync,
    options: RunStoreOptions,
  ) {
    this.stateRoot = stateRoot;
    this.#database = database;
    this.#now = options.now ?? Date.now;
  }

  static open(
    unresolved: ResolvedStateRoot,
    options: RunStoreOptions = {},
  ): RunStore {
    const stateRoot = prepareStateRoot(unresolved);
    try {
      const existing = lstatSync(stateRoot.databasePath);
      if (existing.isSymbolicLink()) {
        throw new StateRootError("state-component-symlink");
      }
      if (!existing.isFile()) {
        throw new StateRootError("state-component-type");
      }
    } catch (error) {
      if (
        error instanceof StateRootError ||
        (error as NodeJS.ErrnoException).code !== "ENOENT"
      ) {
        throw error;
      }
      const descriptor = openSync(stateRoot.databasePath, "ax", 0o600);
      closeSync(descriptor);
    }
    chmodSync(stateRoot.databasePath, 0o600);

    let database: DatabaseSync | undefined;
    try {
      database = new DatabaseSync(stateRoot.databasePath);
      configureDatabase(database, options.busyTimeoutMs);
      const tables = applicationTables(database);
      if (tables.length === 0) {
        database.exec(SCHEMA);
      } else if (!hasCurrentSchema(database)) {
        throw new RunStoreFormatError(stateRoot.databasePath);
      }
    } catch (error) {
      database?.close();
      if (error instanceof RunStoreFormatError) throw error;
      throw new RunStoreFormatError(stateRoot.databasePath);
    }
    if (!database) throw new RunStoreFormatError(stateRoot.databasePath);
    const store = new RunStore(stateRoot, database, options);
    store.#secureDatabaseFiles();
    store.recoverExpiredLeases();
    return store;
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("run-store-closed");
  }

  #transaction<T>(work: () => T): T {
    this.#assertOpen();
    this.#database.exec("BEGIN IMMEDIATE");
    let value: T;
    try {
      value = work();
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
    this.#secureDatabaseFiles();
    return value;
  }

  #secureDatabaseFiles(): void {
    for (const file of [
      this.stateRoot.databasePath,
      `${this.stateRoot.databasePath}-wal`,
      `${this.stateRoot.databasePath}-shm`,
    ]) {
      try {
        const stat = lstatSync(file);
        if (stat.isSymbolicLink() || !stat.isFile()) {
          throw new StateRootError(
            stat.isSymbolicLink()
              ? "state-component-symlink"
              : "state-component-type",
          );
        }
        chmodSync(file, 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }

  #runRow(runId: string): RunRow {
    const row = this.#database
      .prepare("SELECT run_id, projection_json FROM runs WHERE run_id = ?")
      .get(runId) as RunRow | undefined;
    if (!row) throw new Error("run-not-found");
    return row;
  }

  #operation(runId: string, operationId: string): OperationRow | undefined {
    return this.#database
      .prepare(
        `SELECT kind, state, outcome_json, lease_token, lease_expires_at
         FROM operations WHERE run_id = ? AND operation_id = ?`,
      )
      .get(runId, operationId) as OperationRow | undefined;
  }

  #operationOutcome(
    runId: string,
    operationId: string,
    kind: string,
  ): RunProjection | undefined {
    const row = this.#operation(runId, operationId);
    if (row && row.kind !== kind) throw new Error("operation-id-conflict");
    if (row?.state !== "committed" || row.outcome_json === null)
      return undefined;
    return parseProjection(row.outcome_json);
  }

  #recordOperation(
    runId: string,
    operationId: string,
    kind: string,
    outcome: RunProjection,
  ): void {
    this.#database
      .prepare(
        `INSERT INTO operations(
           run_id, operation_id, kind, state, outcome_json
         ) VALUES (?, ?, ?, 'committed', ?)
         ON CONFLICT(run_id, operation_id) DO UPDATE SET
           state = 'committed', outcome_json = excluded.outcome_json,
           lease_token = NULL, lease_expires_at = NULL`,
      )
      .run(runId, operationId, kind, JSON.stringify(outcome));
  }

  #events(runId: string): RunEvent[] {
    const rows = this.#database
      .prepare(
        `SELECT sequence, type, payload_json, prior_hash, event_hash
         FROM events WHERE run_id = ? ORDER BY sequence`,
      )
      .all(runId) as unknown as EventRow[];
    return rows.map((row) => ({
      sequence: Number(row.sequence),
      type: row.type as RunEvent["type"],
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
      priorHash: row.prior_hash,
      hash: row.event_hash,
    }));
  }

  #appendEvent(
    runId: string,
    type: RunEvent["type"],
    payload: Record<string, unknown>,
  ): RunProjection {
    const row = this.#runRow(runId);
    const current = parseProjection(row.projection_json);
    const event = createRunEvent(
      current.sequence + 1,
      type,
      payload,
      current.eventHash,
    );
    const projection = reduceRunEvents([...this.#events(runId), event]);
    this.#database
      .prepare(
        `INSERT INTO events(
           run_id, sequence, type, payload_json, prior_hash, event_hash
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        runId,
        event.sequence,
        event.type,
        JSON.stringify(event.payload),
        event.priorHash,
        event.hash,
      );
    this.#database
      .prepare(
        `UPDATE runs SET state = ?, sequence = ?, event_hash = ?,
           delivery_revision = ?, projection_json = ?, terminal_tombstone = ?
         WHERE run_id = ?`,
      )
      .run(
        projection.state,
        projection.sequence,
        projection.eventHash,
        projection.deliveryRevision ?? null,
        JSON.stringify(projection),
        projection.terminal ?? null,
        runId,
      );
    return projection;
  }

  startRun(input: StartRunInput): RunProjection {
    requireIdentifier(input.operationId, "operation-id");
    if (input.stage !== "abel-design" && input.stage !== "abel-implement") {
      throw new Error("invalid-run-stage");
    }
    const key = lookupKey(input);
    return this.#transaction(() => {
      let existing = this.#database
        .prepare(
          `SELECT run_id, projection_json FROM runs
           WHERE root_hash = ? AND stage = ? AND lookup_key = ?`,
        )
        .get(this.stateRoot.consumerRootHash, input.stage, key) as
        | RunRow
        | undefined;
      if (existing) {
        const projection = parseProjection(existing.projection_json);
        if (
          input.stage === "abel-design" &&
          ["completed", "discarded", "rejected"].includes(projection.state)
        ) {
          this.#database
            .prepare("UPDATE runs SET lookup_key = ? WHERE run_id = ?")
            .run(`terminal:${existing.run_id}`, existing.run_id);
          existing = undefined;
        }
      }
      if (existing) {
        const replay = this.#operationOutcome(
          existing.run_id,
          input.operationId,
          "start",
        );
        if (replay) return replay;
        const projection = parseProjection(existing.projection_json);
        this.#recordOperation(
          existing.run_id,
          input.operationId,
          "start",
          projection,
        );
        return projection;
      }

      const runId = randomUUID();
      const event = createRunEvent(
        1,
        "run-created",
        {
          runId,
          rootHash: this.stateRoot.consumerRootHash,
          stage: input.stage,
          ...(input.change ? { change: input.change } : {}),
          ...(input.provisionalKey
            ? { provisionalKey: input.provisionalKey }
            : {}),
        },
        ZERO_EVENT_HASH,
      );
      const projection = reduceRunEvents([event]);
      this.#database
        .prepare(
          `INSERT INTO runs(
             run_id, root_hash, stage, lookup_key, change_name,
             provisional_key, state, sequence, event_hash, projection_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          runId,
          this.stateRoot.consumerRootHash,
          input.stage,
          key,
          input.change ?? null,
          input.provisionalKey ?? null,
          projection.state,
          projection.sequence,
          projection.eventHash,
          JSON.stringify(projection),
        );
      this.#database
        .prepare(
          `INSERT INTO events(
             run_id, sequence, type, payload_json, prior_hash, event_hash
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          runId,
          event.sequence,
          event.type,
          JSON.stringify(event.payload),
          event.priorHash,
          event.hash,
        );
      this.#recordOperation(runId, input.operationId, "start", projection);
      return projection;
    });
  }

  bindChange(input: {
    runId: string;
    change: string;
    operationId: string;
  }): RunProjection {
    requireIdentifier(input.operationId, "operation-id");
    if (!CHANGE_NAME.test(input.change)) throw new Error("invalid-change");
    return this.#transaction(() => {
      const replay = this.#operationOutcome(
        input.runId,
        input.operationId,
        "change-bound",
      );
      if (replay) return replay;
      const current = this.status(input.runId);
      if (current.stage !== "abel-design" || !current.provisionalKey) {
        throw new Error("change-binding-not-allowed");
      }
      const conflict = this.#database
        .prepare(
          `SELECT run_id FROM runs
           WHERE root_hash = ? AND stage = ? AND lookup_key = ?`,
        )
        .get(current.rootHash, current.stage, `change:${input.change}`) as
        | { run_id: string }
        | undefined;
      if (conflict && conflict.run_id !== input.runId) {
        throw new Error("change-run-already-exists");
      }
      this.#database
        .prepare(
          `UPDATE runs SET lookup_key = ?, change_name = ?, provisional_key = NULL
           WHERE run_id = ?`,
        )
        .run(`change:${input.change}`, input.change, input.runId);
      const projection = this.#appendEvent(input.runId, "change-bound", {
        change: input.change,
      });
      this.#recordOperation(
        input.runId,
        input.operationId,
        "change-bound",
        projection,
      );
      return projection;
    });
  }

  #requireDeliveryBinding(input: BindDeliveryInput): void {
    requireIdentifier(input.operationId, "operation-id");
    if (
      (input.gate !== "gate-a" && input.gate !== "gate-b") ||
      !Number.isSafeInteger(input.revision) ||
      input.revision < 1 ||
      !SHA256.test(input.receiptHash) ||
      (input.approvalProof !== undefined &&
        (!Number.isSafeInteger(input.approvalProof.revision) ||
          input.approvalProof.revision < 1 ||
          !SHA256.test(input.approvalProof.contractHash) ||
          !SHA256.test(input.approvalProof.recordHash)))
    ) {
      throw new Error("invalid-delivery-binding");
    }
  }

  #bindDelivery(input: BindDeliveryInput): RunProjection {
    if (input.lease) {
      if (input.lease.runId !== input.runId) throw new Error("lease-fenced");
      this.#assertLease(input.lease);
    }
    const replay = this.#operationOutcome(
      input.runId,
      input.operationId,
      "delivery-bound",
    );
    if (replay) return replay;
    const existing = this.#database
      .prepare(
        `SELECT receipt_hash, approval_revision, contract_hash, record_hash
         FROM delivery_bindings
         WHERE run_id = ? AND gate = ? AND revision = ?`,
      )
      .get(input.runId, input.gate, input.revision) as
      | {
          receipt_hash: string;
          approval_revision: number | null;
          contract_hash: string | null;
          record_hash: string | null;
        }
      | undefined;
    if (existing) {
      if (
        existing.receipt_hash !== input.receiptHash ||
        existing.approval_revision !==
          (input.approvalProof?.revision ?? null) ||
        existing.contract_hash !==
          (input.approvalProof?.contractHash ?? null) ||
        existing.record_hash !== (input.approvalProof?.recordHash ?? null)
      ) {
        throw new Error("delivery-revision-conflict");
      }
      const projection = this.status(input.runId);
      this.#recordOperation(
        input.runId,
        input.operationId,
        "delivery-bound",
        projection,
      );
      return projection;
    }
    this.#runRow(input.runId);
    this.#database
      .prepare(
        `INSERT INTO delivery_bindings(
           run_id, gate, revision, receipt_hash, approval_revision,
           contract_hash, record_hash, operation_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.runId,
        input.gate,
        input.revision,
        input.receiptHash,
        input.approvalProof?.revision ?? null,
        input.approvalProof?.contractHash ?? null,
        input.approvalProof?.recordHash ?? null,
        input.operationId,
      );
    const projection = this.#appendEvent(input.runId, "delivery-bound", {
      gate: input.gate,
      revision: input.revision,
      receiptHash: input.receiptHash,
      ...(input.approvalProof
        ? { approvalProof: structuredClone(input.approvalProof) }
        : {}),
    });
    this.#recordOperation(
      input.runId,
      input.operationId,
      "delivery-bound",
      projection,
    );
    return projection;
  }

  bindDelivery(input: BindDeliveryInput): RunProjection {
    this.#requireDeliveryBinding(input);
    return this.#transaction(() => this.#bindDelivery(input));
  }

  bindDeliveryAtomically(
    input: BindDeliveryInput,
    write: (database: DatabaseSync) => void,
  ): RunProjection {
    this.#requireDeliveryBinding(input);
    if (typeof write !== "function") {
      throw new Error("delivery-binding-write-invalid");
    }
    return this.#transaction(() => {
      const projection = this.#bindDelivery(input);
      write(this.#database);
      return projection;
    });
  }

  bindDeliveriesAtomically(
    inputs: readonly BindDeliveryInput[],
    write: (database: DatabaseSync) => void,
  ): RunProjection {
    if (inputs.length === 0) throw new Error("delivery-binding-empty");
    for (const input of inputs) this.#requireDeliveryBinding(input);
    const runId = inputs[0]?.runId;
    if (
      !runId ||
      inputs.some(
        (input) =>
          input.runId !== runId ||
          (input.lease?.token ?? null) !== (inputs[0]?.lease?.token ?? null),
      ) ||
      typeof write !== "function"
    ) {
      throw new Error("delivery-binding-write-invalid");
    }
    return this.#transaction(() => {
      let projection: RunProjection | undefined;
      for (const input of inputs) projection = this.#bindDelivery(input);
      write(this.#database);
      if (!projection) throw new Error("delivery-binding-empty");
      return projection;
    });
  }

  acquireLease(input: {
    runId: string;
    operationId: string;
    ttlMs: number;
    preempt?: boolean;
    exclusive?: boolean;
  }): OperationLease {
    requireIdentifier(input.operationId, "operation-id");
    if (!Number.isSafeInteger(input.ttlMs) || input.ttlMs < 1) {
      throw new Error("invalid-lease-ttl");
    }
    return this.#transaction(() => {
      this.#runRow(input.runId);
      const now = this.#now();
      const existing = this.#operation(input.runId, input.operationId);
      if (
        existing?.state === "running" &&
        existing.lease_token &&
        existing.lease_expires_at !== null &&
        existing.lease_expires_at >= now
      ) {
        if (!input.preempt) {
          if (input.exclusive) throw new Error("operation-already-running");
          return {
            runId: input.runId,
            operationId: input.operationId,
            token: existing.lease_token,
            expiresAt: existing.lease_expires_at,
          };
        }
      }
      const token = randomUUID();
      const expiresAt = now + input.ttlMs;
      this.#database
        .prepare(
          `INSERT INTO operations(
             run_id, operation_id, kind, state, lease_token, lease_expires_at
           ) VALUES (?, ?, 'lease', 'running', ?, ?)
           ON CONFLICT(run_id, operation_id) DO UPDATE SET
             state = 'running', outcome_json = NULL,
             lease_token = excluded.lease_token,
             lease_expires_at = excluded.lease_expires_at`,
        )
        .run(input.runId, input.operationId, token, expiresAt);
      return {
        runId: input.runId,
        operationId: input.operationId,
        token,
        expiresAt,
      };
    });
  }

  renewLease(lease: OperationLease, ttlMs: number): OperationLease {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1)
      throw new Error("invalid-lease-ttl");
    return this.#transaction(() => {
      const existing = this.#operation(lease.runId, lease.operationId);
      if (
        existing?.state !== "running" ||
        existing.lease_token !== lease.token ||
        existing.lease_expires_at === null ||
        existing.lease_expires_at < this.#now()
      ) {
        throw new Error("lease-fenced");
      }
      const expiresAt = this.#now() + ttlMs;
      this.#database
        .prepare(
          `UPDATE operations SET lease_expires_at = ?
           WHERE run_id = ? AND operation_id = ? AND lease_token = ?`,
        )
        .run(expiresAt, lease.runId, lease.operationId, lease.token);
      return { ...lease, expiresAt };
    });
  }

  #assertLease(lease: OperationLease): void {
    const existing = this.#operation(lease.runId, lease.operationId);
    if (
      existing?.state !== "running" ||
      existing.lease_token !== lease.token ||
      existing.lease_expires_at === null ||
      existing.lease_expires_at < this.#now()
    ) {
      throw new Error("lease-fenced");
    }
  }

  assertLease(lease: OperationLease): void {
    this.#transaction(() => this.#assertLease(lease));
  }

  inspectOperation(
    runId: string,
    operationId: string,
  ): OperationLeaseStatus | undefined {
    this.#assertOpen();
    requireIdentifier(operationId, "operation-id");
    this.#runRow(runId);
    let operation = this.#operation(runId, operationId);
    if (!operation) return undefined;
    if (
      operation.state === "running" &&
      operation.lease_expires_at !== null &&
      operation.lease_expires_at < this.#now()
    ) {
      this.#transaction(() => {
        this.#database
          .prepare(
            `UPDATE operations
             SET state = 'interrupted', lease_token = NULL,
                 lease_expires_at = NULL
             WHERE run_id = ? AND operation_id = ? AND state = 'running'
               AND lease_expires_at < ?`,
          )
          .run(runId, operationId, this.#now());
      });
      operation = this.#operation(runId, operationId);
      if (!operation) throw new Error("operation-recovery-invalid");
    }
    if (
      operation.state !== "running" &&
      operation.state !== "committed" &&
      operation.state !== "interrupted"
    ) {
      throw new Error("operation-state-invalid");
    }
    let outcome: Record<string, unknown> | undefined;
    if (operation.outcome_json !== null) {
      const parsed = JSON.parse(operation.outcome_json) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("operation-outcome-invalid");
      }
      outcome = parsed as Record<string, unknown>;
    }
    return {
      state: operation.state,
      ...(outcome ? { outcome: structuredClone(outcome) } : {}),
      ...(operation.lease_expires_at === null
        ? {}
        : { expiresAt: operation.lease_expires_at }),
    };
  }

  commitLease(
    lease: OperationLease,
    outcome: Record<string, unknown>,
  ): Record<string, unknown> {
    const serialized = JSON.stringify(outcome);
    if (!serialized) throw new Error("operation-outcome-invalid");
    return this.#transaction(() => {
      this.#assertLease(lease);
      const result = this.#database
        .prepare(
          `UPDATE operations
           SET state = 'committed', outcome_json = ?,
               lease_token = NULL, lease_expires_at = NULL
           WHERE run_id = ? AND operation_id = ? AND state = 'running'
             AND lease_token = ?`,
        )
        .run(serialized, lease.runId, lease.operationId, lease.token);
      if (Number(result.changes) !== 1) throw new Error("lease-fenced");
      return structuredClone(outcome);
    });
  }

  interruptLease(lease: OperationLease): void {
    this.#transaction(() => {
      this.#assertLease(lease);
      const result = this.#database
        .prepare(
          `UPDATE operations
           SET state = 'interrupted', outcome_json = NULL,
               lease_token = NULL, lease_expires_at = NULL
           WHERE run_id = ? AND operation_id = ? AND state = 'running'
             AND lease_token = ?`,
        )
        .run(lease.runId, lease.operationId, lease.token);
      if (Number(result.changes) !== 1) throw new Error("lease-fenced");
    });
  }

  transition(input: {
    runId: string;
    to: RunState;
    operationId: string;
    code?: string;
    lease?: OperationLease;
  }): RunProjection {
    return this.transitionAtomically(input, () => {});
  }

  transitionAtomically(
    input: {
      runId: string;
      to: RunState;
      operationId: string;
      code?: string;
      lease?: OperationLease;
    },
    write: (database: DatabaseSync) => void,
  ): RunProjection {
    requireIdentifier(input.operationId, "operation-id");
    if (typeof write !== "function") {
      throw new Error("state-transition-write-invalid");
    }
    return this.#transaction(() => {
      if (input.lease) {
        if (input.lease.runId !== input.runId) throw new Error("lease-fenced");
        this.#assertLease(input.lease);
      }
      const replay = this.#operationOutcome(
        input.runId,
        input.operationId,
        "state-transitioned",
      );
      if (replay) return replay;
      const current = this.status(input.runId);
      const projection = this.#appendEvent(input.runId, "state-transitioned", {
        from: current.state,
        to: input.to,
        ...(input.code ? { code: input.code } : {}),
      });
      write(this.#database);
      this.#recordOperation(
        input.runId,
        input.operationId,
        "state-transitioned",
        projection,
      );
      return projection;
    });
  }

  status(runId: string): RunProjection {
    this.#assertOpen();
    return parseProjection(this.#runRow(runId).projection_json);
  }

  listEvents(runId: string): RunEvent[] {
    this.#assertOpen();
    this.#runRow(runId);
    return structuredClone(this.#events(runId));
  }

  rebuildProjection(runId: string): RunProjection {
    return reduceRunEvents(this.listEvents(runId));
  }

  verifyIntegrity(runId: string): RunProjection {
    const rebuilt = this.rebuildProjection(runId);
    const stored = this.status(runId);
    if (JSON.stringify(rebuilt) !== JSON.stringify(stored)) {
      throw new Error("run-projection-integrity-mismatch");
    }
    return rebuilt;
  }

  recoverExpiredLeases(): number {
    this.#assertOpen();
    const expired = this.#database
      .prepare(
        `SELECT run_id, operation_id FROM operations
         WHERE state = 'running' AND lease_expires_at < ?`,
      )
      .all(this.#now()) as unknown as Array<{
      run_id: string;
      operation_id: string;
    }>;
    if (expired.length === 0) return 0;
    return this.#transaction(() => {
      for (const row of expired) {
        this.#database
          .prepare(
            `UPDATE operations
             SET state = 'interrupted', lease_token = NULL,
                 lease_expires_at = NULL
             WHERE run_id = ? AND operation_id = ? AND state = 'running'`,
          )
          .run(row.run_id, row.operation_id);
      }
      return expired.length;
    });
  }

  close(): void {
    if (this.#closed) return;
    this.#database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    this.#secureDatabaseFiles();
    this.#database.close();
    this.#closed = true;
  }
}
