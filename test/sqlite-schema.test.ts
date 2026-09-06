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
