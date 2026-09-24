import { randomUUID } from "node:crypto";
import { closeSync, lstatSync, openSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "./canonical.ts";
import { syncDirectory } from "./directory-sync.ts";
import { acquireCheckoutOwnership } from "./package-state.ts";
import { configureSqlite, matchesSqliteSchema } from "./sqlite-schema.ts";
import {
  ensureStateDirectory,
  type ResolvedStateRoot,
  resolveStateRoot,
} from "./state-root.ts";
import { TASK_FOUNDATION_SCHEMA } from "./storage-schema.ts";
import { requireLegacyQuiescence } from "./task-legacy.ts";
import {
  closedTaskObject,
  decodePortableTask,
  decodeTaskArtifact,
  newPortableTask,
  type PortableTask,
  TASK_LIMITS,
  type TaskArtifact,
  taskDigest,
  taskError,
  taskFail,
  taskHash,
  taskId,
  taskInteger,
  taskPublicationPath,
} from "./task-records.ts";

export interface TaskReview {
  taskId: string;
  revision: number;
  artifacts: TaskArtifact[];
  digest: string;
}
export interface TaskPublication {
  sequence: number;
  operationId: string;
  taskId: string;
  path: string;
  expected: Uint8Array | null;
  desired: Uint8Array;
  state: "pending" | "delivered" | "conflict";
}
function safeDatabase(file: string): void {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    const stat = lstatSync(file + suffix, { throwIfNoEntry: false });
    if (
      stat &&
      (!stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1 ||
        (process.platform !== "win32" &&
          ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.())))
    )
      taskFail("task-path-unsafe");
  }
}
const schemaQuery =
  "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name";
let expectedSchema: string | undefined;
function exactSchema(db: DatabaseSync): boolean {
  if (!expectedSchema) {
    const reference = new DatabaseSync(":memory:");
    try {
      reference.exec(TASK_FOUNDATION_SCHEMA);
      expectedSchema = canonicalJson(reference.prepare(schemaQuery).all());
    } finally {
      reference.close();
    }
  }
  return canonicalJson(db.prepare(schemaQuery).all()) === expectedSchema;
}
function validateDatabase(db: DatabaseSync, rootHash: string): void {
  if (
    !matchesSqliteSchema(db, TASK_FOUNDATION_SCHEMA) ||
    !exactSchema(db) ||
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type IN ('trigger','view')")
      .get()
  )
    taskFail("task-storage-invalid");
  const rows = db.prepare("SELECT version, root_hash FROM task_protocol").all();
  if (
    rows.length !== 1 ||
    rows[0].version !== 1 ||
    rows[0].root_hash !== rootHash
  )
    taskFail("task-storage-invalid");
}
function bytes(value: unknown): Uint8Array {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength > TASK_LIMITS.artifactBytes
  )
    taskFail("task-storage-invalid");
  return value;
}
function publicationIdentity(
  id: string,
  relative: string,
  expected: Uint8Array | null,
  desired: Uint8Array,
): string {
  return taskHash(
    canonicalJson({
      taskId: id,
      path: relative,
      expected: expected === null ? null : taskHash(expected),
      desired: taskHash(desired),
    }),
  );
}
/** Internal infrastructure only, deliberately absent from the Pi tool surface. */
export class TaskStore {
  readonly databasePath: string;
  readonly consumerRoot: string;
  #db: DatabaseSync;
  #release: () => void;
  #closed = false;
  private constructor(
    db: DatabaseSync,
    file: string,
    root: string,
    release: () => void,
  ) {
    this.#db = db;
    this.databasePath = file;
    this.consumerRoot = root;
    this.#release = release;
  }
  static open(unresolved: ResolvedStateRoot): TaskStore {
    const state = resolveStateRoot({
      consumerRoot: unresolved.consumerRoot,
      xdgStateHome: unresolved.stateBase,
    });
    if (
      state.rootDir !== unresolved.rootDir ||
      state.consumerRootHash !== unresolved.consumerRootHash
    )
      taskFail("task-storage-invalid");
    ensureStateDirectory(state.rootsDir);
    let ownership: ReturnType<typeof acquireCheckoutOwnership>;
    try {
      ownership = acquireCheckoutOwnership(state);
    } catch {
      return taskFail("task-ownership-unresolved");
    }
    let db: DatabaseSync | undefined;
    try {
      requireLegacyQuiescence(state, ownership.coordinator);
      // Sibling protocol area: an old package reset cannot move this namespace.
      const directory = path.join(
        state.productRoot,
        "task-v1",
        state.consumerRootHash,
      );
      ensureStateDirectory(path.dirname(directory));
      ensureStateDirectory(directory);
      for (const privateDirectory of [path.dirname(directory), directory]) {
        const stat = lstatSync(privateDirectory);
        if (
          process.platform !== "win32" &&
          ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.())
        )
          taskFail("task-path-unsafe");
      }
      const file = path.join(directory, "control.sqlite3");
      safeDatabase(file);
      const exists = !!lstatSync(file, { throwIfNoEntry: false });
      if (exists) {
        const probe = new DatabaseSync(file, { readOnly: true });
        try {
          validateDatabase(probe, state.consumerRootHash);
        } finally {
          probe.close();
        }
      } else closeSync(openSync(file, "wx", 0o600));
      db = new DatabaseSync(file);
      if (exists) validateDatabase(db, state.consumerRootHash);
      configureSqlite(db);
      if (!exists) {
        db.exec("BEGIN IMMEDIATE");
        db.exec(TASK_FOUNDATION_SCHEMA);
        db.prepare("INSERT INTO task_protocol VALUES (1, ?)").run(
          state.consumerRootHash,
        );
        db.exec("COMMIT");
        syncDirectory(directory);
      }
      return new TaskStore(db, file, state.consumerRoot, ownership.close);
    } catch (error) {
      db?.close();
      ownership.close();
      return taskError(error, "task-storage-invalid");
    }
  }
  close(): void {
    if (!this.#closed) {
      this.#closed = true;
      try {
        this.#db.close();
      } finally {
        this.#release();
      }
    }
  }
  #ready(): void {
    if (this.#closed) taskFail("task-ownership-unresolved");
  }
  #transaction<T>(action: () => T): T {
    this.#ready();
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      return taskError(error, "task-storage-invalid");
    }
  }
  create(
    title: string,
    kind: PortableTask["kind"] = "code",
    depth: PortableTask["depth"] = "compact",
  ): PortableTask {
    const record = newPortableTask(title, kind, depth);
    this.#transaction(() =>
      this.#db
        .prepare("INSERT INTO task_records VALUES (?, ?, ?, ?)")
        .run(
          record.id,
          record.revision,
          canonicalJson(record),
          taskHash(canonicalJson(record)),
        ),
    );
    return record;
  }
  get(id: string): PortableTask {
    this.#ready();
    taskId(id);
    const row = this.#db
      .prepare("SELECT * FROM task_records WHERE task_id = ?")
      .get(id);
    if (!row) taskFail("task-not-found");
    if (
      typeof row.payload_json !== "string" ||
      taskHash(row.payload_json) !== row.payload_hash
    )
      taskFail("task-storage-invalid");
    let record: PortableTask;
    try {
      record = decodePortableTask(JSON.parse(row.payload_json));
    } catch {
      return taskFail("task-storage-invalid");
    }
    if (record.id !== id || record.revision !== row.revision)
      taskFail("task-storage-invalid");
    return record;
  }
  /** Revises context, not executable state; imported lifecycle is never admitted here. */
  revise(value: unknown): PortableTask {
    const record = decodePortableTask(value);
    return this.#transaction(() => {
      const old = this.get(record.id);
      if (
        record.revision !== old.revision + 1 ||
        record.lifecycle !== "planning" ||
        old.lifecycle !== "planning"
      )
        taskFail("task-conflict");
      this.#db
        .prepare(
          "UPDATE task_records SET revision = ?, payload_json = ?, payload_hash = ? WHERE task_id = ?",
        )
        .run(
          record.revision,
          canonicalJson(record),
          taskHash(canonicalJson(record)),
          record.id,
        );
      return record;
    });
  }
  freezeReview(
    id: string,
    supplied: ReadonlyMap<string, Uint8Array>,
  ): TaskReview {
    return this.#transaction(() => {
      const record = this.get(id);
      const artifacts = record.artifacts.filter((a) =>
        ["brief", "requirements", "design", "plan"].includes(a.role),
      );
      const required =
        record.depth === "compact"
          ? ["brief"]
          : record.kind === "code"
            ? ["requirements", "design", "plan"]
            : ["requirements", "design"];
      if (
        required.some((role) => !artifacts.some((a) => a.role === role)) ||
        supplied.size !== artifacts.length
      )
        taskFail("task-record-invalid");
      let total = 0;
      for (const artifact of artifacts) {
        const content = supplied.get(artifact.path);
        total += content?.byteLength ?? 0;
        if (
          !content ||
          content.byteLength !== artifact.bytes ||
          taskHash(content) !== artifact.sha256 ||
          total > TASK_LIMITS.artifactBytes
        )
          taskFail("task-review-stale");
      }
      const manifest = canonicalJson({
        taskId: id,
        revision: record.revision,
        artifacts,
      });
      const digest = taskHash(manifest);
      const old = this.#db
        .prepare(
          "SELECT digest FROM task_reviews WHERE task_id = ? AND revision = ?",
        )
        .get(id, record.revision);
      if (old) {
        if (old.digest !== digest) taskFail("task-conflict");
        return this.review(id, record.revision);
      }
      this.#db
        .prepare("INSERT INTO task_reviews VALUES (?, ?, ?, ?)")
        .run(id, record.revision, manifest, digest);
      for (const artifact of artifacts)
        this.#db
          .prepare("INSERT INTO task_review_bytes VALUES (?, ?, ?)")
          .run(
            digest,
            artifact.path,
            supplied.get(artifact.path) ?? taskFail("task-record-invalid"),
          );
      return { taskId: id, revision: record.revision, artifacts, digest };
    });
  }
  review(id: string, revision: number): TaskReview {
    this.get(id);
    taskInteger(revision);
    const row = this.#db
      .prepare("SELECT * FROM task_reviews WHERE task_id = ? AND revision = ?")
      .get(id, revision);
    if (!row) taskFail("task-not-found");
    if (
      typeof row.manifest_json !== "string" ||
      taskHash(row.manifest_json) !== row.digest
    )
      taskFail("task-storage-invalid");
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.manifest_json);
    } catch {
      return taskFail("task-storage-invalid");
    }
    const r = closedTaskObject(parsed, ["taskId", "revision", "artifacts"]);
    if (
      r.taskId !== id ||
      r.revision !== revision ||
      !Array.isArray(r.artifacts) ||
      r.artifacts.length > TASK_LIMITS.artifacts
    )
      taskFail("task-storage-invalid");
    const artifacts = r.artifacts.map(decodeTaskArtifact);
    const digest = taskDigest(row.digest);
    for (const a of artifacts) this.reviewBytes(digest, a);
    return { taskId: id, revision, artifacts, digest };
  }
  reviewBytes(digest: string, artifact: TaskArtifact): Uint8Array {
    this.#ready();
    taskDigest(digest);
    decodeTaskArtifact(artifact);
    const row = this.#db
      .prepare(
        "SELECT bytes FROM task_review_bytes WHERE digest = ? AND path = ?",
      )
      .get(digest, artifact.path);
    const content = bytes(row?.bytes);
    if (
      content.byteLength !== artifact.bytes ||
      taskHash(content) !== artifact.sha256
    )
      taskFail("task-storage-invalid");
    return content;
  }
  /** Desired bytes and exact retry identity commit together before repository mutation. */
  intent(
    id: string,
    relative: string,
    expected: Uint8Array | null,
    desired: Uint8Array,
    operationId: string = randomUUID(),
  ): TaskPublication {
    this.get(id);
    taskPublicationPath(id, relative);
    taskId(operationId);
    bytes(desired);
    if (expected !== null) bytes(expected);
    const identity = publicationIdentity(id, relative, expected, desired);
    return this.#transaction(() => {
      const old = this.#db
        .prepare(
          "SELECT operation_id FROM task_publications WHERE operation_id = ?",
        )
        .get(operationId);
      if (old) {
        const op = this.publication(operationId);
        if (
          publicationIdentity(op.taskId, op.path, op.expected, op.desired) !==
          identity
        )
          taskFail("task-conflict");
        return op;
      }
      if (
        this.#db
          .prepare(
            "SELECT 1 FROM task_publications WHERE path = ? AND state != 'delivered'",
          )
          .get(relative)
      )
        taskFail("task-conflict");
      this.#db
        .prepare(
          "INSERT INTO task_publications(operation_id, task_id, path, expected, desired, identity_hash, state) VALUES (?, ?, ?, ?, ?, ?, 'pending')",
        )
        .run(operationId, id, relative, expected, desired, identity);
      return this.publication(operationId);
    });
  }
  publication(operationId: string): TaskPublication {
    this.#ready();
    taskId(operationId);
    const r = this.#db
      .prepare("SELECT * FROM task_publications WHERE operation_id = ?")
      .get(operationId);
    if (!r) taskFail("task-not-found");
    const id = taskId(r.task_id),
      relative = taskPublicationPath(id, r.path),
      expected = r.expected === null ? null : bytes(r.expected),
      desired = bytes(r.desired);
    if (
      publicationIdentity(id, relative, expected, desired) !==
        r.identity_hash ||
      (r.state !== "pending" &&
        r.state !== "delivered" &&
        r.state !== "conflict")
    )
      taskFail("task-storage-invalid");
    return {
      sequence: taskInteger(r.sequence),
      operationId,
      taskId: id,
      path: relative,
      expected,
      desired,
      state: r.state,
    };
  }
  settle(operationId: string, state: "delivered" | "conflict"): void {
    this.#transaction(() => {
      const old = this.publication(operationId);
      if (old.state === "delivered" && state !== "delivered")
        taskFail("task-conflict");
      this.#db
        .prepare(
          "UPDATE task_publications SET state = ? WHERE operation_id = ?",
        )
        .run(state, operationId);
    });
  }
}
