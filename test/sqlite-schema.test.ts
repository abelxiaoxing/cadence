import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { RunStore, RunStoreFormatError } from "../src/run-store.ts";
import {
  ensureSqliteSchema,
  matchesSqliteSchema,
} from "../src/sqlite-schema.ts";
import { resolveStateRoot } from "../src/state-root.ts";
import {
  ENGINE_ADDITIONS,
  ENGINE_SCHEMA,
  RUN_SCHEMA,
} from "../src/storage-schema.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

it("rejects a missing core column at open, preserving the malformed database", () => {
  const root = mkdtempSync(path.join(tmpdir(), "cadence-schema-"));
  roots.push(root);
  const consumerRoot = path.join(root, "consumer");
  mkdirSync(consumerRoot);
  const stateRoot = resolveStateRoot({
    consumerRoot,
    xdgStateHome: path.join(root, "state"),
  });
  const store = RunStore.open(stateRoot);
  store.close();
  const database = new DatabaseSync(stateRoot.databasePath);
  database.exec("ALTER TABLE runs DROP COLUMN change_name");
  try {
    expect(() => RunStore.open(stateRoot)).toThrow(RunStoreFormatError);
    expect(
      database
        .prepare(
          "SELECT name FROM pragma_table_info('runs') WHERE name = 'change_name'",
        )
        .get(),
    ).toBeUndefined();
  } finally {
    database.close();
  }
});

it.each([
  [
    "required column type",
    RUN_SCHEMA.replace("root_hash TEXT NOT NULL", "root_hash INTEGER NOT NULL"),
  ],
  ["NOT NULL", RUN_SCHEMA.replace("root_hash TEXT NOT NULL", "root_hash TEXT")],
  [
    "unique key",
    RUN_SCHEMA.replace(",\n    UNIQUE (root_hash, stage, lookup_key)", ""),
  ],
  [
    "foreign key",
    RUN_SCHEMA.replaceAll(" ON DELETE CASCADE", " ON DELETE RESTRICT"),
  ],
  ["STRICT", RUN_SCHEMA.replaceAll(") STRICT;", ");")],
])("validates the %s contract", (_label, schema) => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(schema);
    expect(matchesSqliteSchema(database, RUN_SCHEMA)).toBe(false);
  } finally {
    database.close();
  }
});

it("atomically adds supported engine columns and rolls back all additions on an invalid structure", () => {
  for (const valid of [true, false]) {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec(RUN_SCHEMA);
      database.exec(ENGINE_SCHEMA);
      database.exec(
        "ALTER TABLE workflow_engine_runs DROP COLUMN baseline_workspace_revision",
      );
      if (!valid)
        database.exec("ALTER TABLE workflow_engine_tasks DROP COLUMN phase");
      if (valid) {
        ensureSqliteSchema(database, ENGINE_SCHEMA, ENGINE_ADDITIONS);
        expect(matchesSqliteSchema(database, ENGINE_SCHEMA)).toBe(true);
        ensureSqliteSchema(database, ENGINE_SCHEMA, ENGINE_ADDITIONS);
      } else {
        expect(() =>
          ensureSqliteSchema(database, ENGINE_SCHEMA, ENGINE_ADDITIONS),
        ).toThrow("storage-schema-invalid");
        expect(
          database
            .prepare(
              "SELECT name FROM pragma_table_info('workflow_engine_runs') WHERE name = 'baseline_workspace_revision'",
            )
            .get(),
        ).toBeUndefined();
      }
    } finally {
      database.close();
    }
  }
});

it("refuses to recreate missing tables in an existing storage namespace", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(RUN_SCHEMA);
    database.exec(ENGINE_SCHEMA);
    database.exec("DROP TABLE workflow_engine_tasks");
    expect(() =>
      ensureSqliteSchema(database, ENGINE_SCHEMA, ENGINE_ADDITIONS),
    ).toThrow("storage-schema-invalid");
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE name = 'workflow_engine_tasks'",
        )
        .get(),
    ).toBeUndefined();
  } finally {
    database.close();
  }
});

// v2 schema confirmed against 4d825b5:src/run-store.ts, not an unknown
// schema inferred from its version number. Fixtures never open a user store.
function legacyV2Store() {
  const root = mkdtempSync(path.join(tmpdir(), "cadence-v2-schema-"));
  roots.push(root);
  const consumerRoot = path.join(root, "consumer");
  mkdirSync(consumerRoot);
  const stateRoot = resolveStateRoot({
    consumerRoot,
    xdgStateHome: path.join(root, "state"),
  });
  const store = RunStore.open(stateRoot);
  const run = store.startRun({
    stage: "abel-implement",
    change: "retained-legacy-run",
    operationId: "legacy-start",
  });
  store.close();
  const database = new DatabaseSync(stateRoot.databasePath);
  database.exec(`
    ALTER TABLE delivery_bindings DROP COLUMN approval_revision;
    ALTER TABLE delivery_bindings DROP COLUMN contract_hash;
    ALTER TABLE delivery_bindings DROP COLUMN record_hash;
    CREATE TABLE schema_meta (
      version INTEGER PRIMARY KEY CHECK (version = 2)
    ) STRICT;
    INSERT INTO schema_meta VALUES (2);
  `);
  database
    .prepare(`INSERT INTO delivery_bindings
    (run_id, gate, revision, receipt_hash, operation_id) VALUES (?, 'gate-a', 1, ?, 'old-receipt')`)
    .run(run.runId, "a".repeat(64));
  database
    .prepare(`INSERT INTO tasks (run_id, task_id, state, phase, projection_json)
    VALUES (?, 'retained-task', 'paused', 'red', ?)`)
    .run(run.runId, JSON.stringify({ budgetUsed: 2, checkpoint: "retained" }));
  return { database, stateRoot, run };
}

function snapshot(database: DatabaseSync) {
  const tables = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all();
  return Object.fromEntries(
    tables.map(({ name }) => [
      String(name),
      database
        .prepare(`SELECT * FROM "${String(name).replaceAll('"', '""')}"`)
        .all(),
    ]),
  );
}

it("migrates v2 atomically, preserving every stored row and leaving old receipts unapproved across reopen", () => {
  const { database, stateRoot, run } = legacyV2Store();
  const before = snapshot(database);
  database.close();
  for (let attempt = 0; attempt < 2; attempt++) {
    const store = RunStore.open(stateRoot);
    try {
      expect(store.status(run.runId)).toEqual(run);
      expect(
        store.startRun({
          stage: "abel-implement",
          change: "retained-legacy-run",
          operationId: "legacy-start",
        }),
      ).toEqual(run);
    } finally {
      store.close();
    }
    const check = new DatabaseSync(stateRoot.databasePath, { readOnly: true });
    try {
      expect(matchesSqliteSchema(check, RUN_SCHEMA)).toBe(true);
      const expected = { ...before };
      delete expected.schema_meta;
      expected.delivery_bindings = before.delivery_bindings.map((row) => ({
        ...row,
        approval_revision: null,
        contract_hash: null,
        record_hash: null,
      }));
      expect(snapshot(check)).toEqual(expected);
    } finally {
      check.close();
    }
  }
});

it("rolls back all v2 proof columns and metadata when the migration cannot commit", () => {
  const { database, stateRoot } = legacyV2Store();
  database.exec(`CREATE TABLE migration_blocker (
    version INTEGER REFERENCES schema_meta(version) DEFERRABLE INITIALLY DEFERRED
  ) STRICT; INSERT INTO migration_blocker VALUES (2);`);
  const before = snapshot(database);
  const schema = database
    .prepare("SELECT name, sql FROM sqlite_master ORDER BY name")
    .all();
  database.close();
  expect(() => RunStore.open(stateRoot)).toThrow("run-store-migration-failed");
  const check = new DatabaseSync(stateRoot.databasePath, { readOnly: true });
  try {
    expect(snapshot(check)).toEqual(before);
    expect(
      check.prepare("SELECT name, sql FROM sqlite_master ORDER BY name").all(),
    ).toEqual(schema);
  } finally {
    check.close();
  }
});

it.each([
  ["missing required column", "ALTER TABLE runs DROP COLUMN change_name"],
  [
    "partial proof upgrade",
    "ALTER TABLE delivery_bindings ADD COLUMN approval_revision INTEGER",
  ],
  [
    "wrong proof type",
    "ALTER TABLE delivery_bindings ADD COLUMN contract_hash INTEGER",
  ],
  [
    "unknown version",
    "DROP TABLE schema_meta; CREATE TABLE schema_meta(version INTEGER PRIMARY KEY) STRICT; INSERT INTO schema_meta VALUES (3)",
  ],
  ["missing table", "DROP TABLE tasks"],
])(
  "refuses %s instead of treating v2 as permission to repair arbitrary storage",
  (_label, damage) => {
    const { database, stateRoot } = legacyV2Store();
    database.exec(damage);
    const before = snapshot(database);
    const schema = database
      .prepare("SELECT name, sql FROM sqlite_master ORDER BY name")
      .all();
    database.close();
    expect(() => RunStore.open(stateRoot)).toThrow(RunStoreFormatError);
    const check = new DatabaseSync(stateRoot.databasePath, { readOnly: true });
    try {
      expect(snapshot(check)).toEqual(before);
      expect(
        check
          .prepare("SELECT name, sql FROM sqlite_master ORDER BY name")
          .all(),
      ).toEqual(schema);
    } finally {
      check.close();
    }
  },
);
