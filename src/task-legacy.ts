import {
  closeSync,
  constants,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
} from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { canonicalJson } from "./canonical.ts";
import { type RunEvent, reduceRunEvents } from "./run-state.ts";
import type { ResolvedStateRoot } from "./state-root.ts";
import { RUN_SCHEMA } from "./storage-schema.ts";
import { taskFail } from "./task-records.ts";

const schemaQuery =
  "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name";
const markerSchema =
  "CREATE TABLE cadence_package_version (version TEXT NOT NULL) STRICT";

/** Read-only, deliberately narrow proof under the shared checkout fence. Supports
 * current core-only stores, with optional package marker, and terminal event-only
 * history. Engine/apply/resources, old schemas and reset evidence remain blocked.
 * No migration, settlement inference from PIDs, or restoration of old authority.
 */
export function requireLegacyQuiescence(
  state: ResolvedStateRoot,
  coordinator: string,
): void {
  const fail = (): never => taskFail("task-ownership-unresolved");
  try {
    if (
      readdirSync(coordinator).some(
        (name) =>
          ![
            "lock.sqlite3",
            "lock.sqlite3-journal",
            "lock.sqlite3-wal",
            "lock.sqlite3-shm",
          ].includes(name),
      )
    )
      fail();
    const root = lstatSync(state.rootDir, { throwIfNoEntry: false });
    if (!root) return;
    if (!root.isDirectory() || root.isSymbolicLink()) fail();
    let database = false;
    for (const name of readdirSync(state.rootDir)) {
      const entry = path.join(state.rootDir, name),
        stat = lstatSync(entry);
      if (name === "control.sqlite3") {
        if (
          !stat.isFile() ||
          stat.isSymbolicLink() ||
          stat.nlink !== 1 ||
          stat.size > 64 * 1024 * 1024
        )
          fail();
        database = true;
      } else if (
        !["artifacts", "workspaces", "transactions"].includes(name) ||
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        readdirSync(entry).length
      )
        fail();
    }
    if (!database) return;
    // Only the WAL format written by the supported owner is eligible. An
    // immutable connection intentionally bypasses SQLite locks, so admitting a
    // rollback-journal layout could hide a live exclusive lock with no sidecar.
    const fd = openSync(
      state.databasePath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const header = Buffer.alloc(20);
      if (
        readSync(fd, header, 0, 20, 0) !== 20 ||
        header.subarray(0, 16).toString("ascii") !== "SQLite format 3\0" ||
        header[18] !== 2 ||
        header[19] !== 2
      )
        fail();
    } finally {
      closeSync(fd);
    }
    // No WAL/journal sidecars are admitted. immutable=1 prevents even SQLite's
    // readonly WAL opener from creating shared-memory/sidecar files in history.
    const uri = pathToFileURL(state.databasePath);
    uri.search = "?mode=ro&immutable=1";
    const db = new DatabaseSync(uri.href, { readOnly: true });
    const reference = new DatabaseSync(":memory:");
    try {
      reference.exec(RUN_SCHEMA);
      const marker = db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE name = 'cadence_package_version'",
        )
        .get();
      if (marker) reference.exec(markerSchema);
      if (
        canonicalJson(db.prepare(schemaQuery).all()) !==
        canonicalJson(reference.prepare(schemaQuery).all())
      )
        fail();
      if (
        canonicalJson(db.prepare("PRAGMA quick_check").all()) !==
          canonicalJson([{ quick_check: "ok" }]) ||
        db.prepare("PRAGMA foreign_key_check").all().length
      )
        fail();
      if (marker) {
        const rows = db
          .prepare("SELECT version FROM cadence_package_version")
          .all();
        if (
          rows.length !== 1 ||
          typeof rows[0].version !== "string" ||
          !/^\d+\.\d+\.\d+$/u.test(rows[0].version)
        )
          fail();
      }
      for (const table of [
        "delivery_bindings",
        "tasks",
        "route_health",
        "artifacts",
        "workspace_revisions",
        "apply_transactions",
        "bootstrap_handoffs",
      ]) {
        if (db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()) fail();
      }
      // Bound the proof, including allocations before parsing any historic JSON.
      for (const [table, field] of [
        ["runs", "projection_json"],
        ["events", "payload_json"],
        ["operations", "outcome_json"],
      ]) {
        const row = db
          .prepare(
            `SELECT count(*) AS n, coalesce(sum(length(CAST(${field} AS BLOB))), 0) AS bytes FROM ${table}`,
          )
          .get();
        if (
          !row ||
          Number(row.n) > 4096 ||
          Number(row.bytes) > 16 * 1024 * 1024
        )
          fail();
      }
      for (const row of db.prepare("SELECT * FROM runs").all()) {
        if (
          typeof row.run_id !== "string" ||
          row.root_hash !== state.consumerRootHash
        )
          fail();
        const events: RunEvent[] = db
          .prepare("SELECT * FROM events WHERE run_id = ? ORDER BY sequence")
          .all(row.run_id)
          .map((event) => {
            if (
              typeof event.sequence !== "number" ||
              !["run-created", "state-transitioned"].includes(
                String(event.type),
              ) ||
              typeof event.payload_json !== "string" ||
              typeof event.prior_hash !== "string" ||
              typeof event.event_hash !== "string"
            )
              return fail();
            const payload: unknown = JSON.parse(event.payload_json);
            if (
              !payload ||
              typeof payload !== "object" ||
              Array.isArray(payload)
            )
              return fail();
            return {
              sequence: event.sequence,
              type:
                event.type === "run-created"
                  ? "run-created"
                  : "state-transitioned",
              payload: payload as Record<string, unknown>,
              priorHash: event.prior_hash,
              hash: event.event_hash,
            };
          });
        const projection = reduceRunEvents(events);
        if (
          !projection.terminal ||
          projection.state !== projection.terminal ||
          projection.runId !== row.run_id ||
          projection.rootHash !== state.consumerRootHash ||
          projection.stage !== row.stage ||
          projection.state !== row.state ||
          projection.sequence !== row.sequence ||
          projection.eventHash !== row.event_hash ||
          projection.terminal !== row.terminal_tombstone ||
          row.delivery_revision !== null ||
          (projection.change ?? null) !== row.change_name ||
          (projection.provisionalKey ?? null) !== row.provisional_key ||
          row.lookup_key !==
            (projection.change
              ? `change:${projection.change}`
              : `provisional:${projection.provisionalKey}`) ||
          typeof row.projection_json !== "string" ||
          canonicalJson(JSON.parse(row.projection_json)) !==
            canonicalJson(projection)
        )
          fail();
        const prefixes = new Set(
          events.map((_, index) =>
            canonicalJson(reduceRunEvents(events.slice(0, index + 1))),
          ),
        );
        for (const op of db
          .prepare("SELECT * FROM operations WHERE run_id = ?")
          .all(row.run_id)) {
          if (
            op.state !== "committed" ||
            op.lease_token !== null ||
            op.lease_expires_at !== null ||
            !["start", "state-transitioned"].includes(String(op.kind)) ||
            typeof op.outcome_json !== "string" ||
            !prefixes.has(canonicalJson(JSON.parse(op.outcome_json)))
          )
            fail();
        }
      }
    } finally {
      reference.close();
      db.close();
    }
  } catch {
    fail();
  }
}
