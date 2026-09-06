import { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "./canonical.ts";

export class SqliteSchemaError extends Error {
  readonly code = "storage-schema-invalid";
  constructor() {
    super("storage-schema-invalid");
  }
}

type Row = Record<string, string | number | null>;
interface TableContract {
  columns: Row[];
  foreignKeys: string[];
  uniqueKeys: string[];
  strict: number;
}
const contracts = new Map<string, Map<string, TableContract>>();
const identifier = (name: string): string => `"${name.replaceAll('"', '""')}"`;

export function configureSqlite(
  database: DatabaseSync,
  busyTimeoutMs = 5000,
): void {
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = FULL");
  database.exec(
    `PRAGMA busy_timeout = ${Math.max(1, Math.min(30_000, busyTimeoutMs))}`,
  );
}

function describeTable(database: DatabaseSync, table: string): TableContract {
  const columns = database
    .prepare(`PRAGMA table_info(${identifier(table)})`)
    .all() as Row[];
  const foreignKeys = database
    .prepare(`PRAGMA foreign_key_list(${identifier(table)})`)
    .all() as Row[];
  const indexes = database
    .prepare(`PRAGMA index_list(${identifier(table)})`)
    .all() as Row[];
  const uniqueKeys = indexes
    .filter((row) => row.unique === 1)
    .map((row) => {
      const fields = database
        .prepare(`PRAGMA index_xinfo(${identifier(String(row.name))})`)
        .all() as Row[];
      return canonicalJson({
        partial: row.partial,
        fields: fields
          .filter((field) => field.key === 1)
          .map(({ name, coll, desc }) => ({ name, coll, desc })),
      });
    })
    .sort();
  const strict = (
    database
      .prepare(
        "SELECT strict FROM pragma_table_list WHERE schema = 'main' AND name = ?",
      )
      .get(table) as Row | undefined
  )?.strict;
  return {
    columns: columns.map(({ name, type, notnull, dflt_value, pk }) => ({
      name,
      type,
      notnull,
      dflt_value,
      pk,
    })),
    foreignKeys: foreignKeys
      .map(({ table: target, from, to, on_update, on_delete, match, seq }) =>
        canonicalJson({ target, from, to, on_update, on_delete, match, seq }),
      )
      .sort(),
    uniqueKeys,
    strict: Number(strict ?? 0),
  };
}

function schemaContract(schema: string): Map<string, TableContract> {
  const cached = contracts.get(schema);
  if (cached) return cached;
  const reference = new DatabaseSync(":memory:");
  try {
    reference.exec(schema);
    const names = reference
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .all() as Row[];
    const contract = new Map(
      names.map(({ name }) => [
        String(name),
        describeTable(reference, String(name)),
      ]),
    );
    contracts.set(schema, contract);
    return contract;
  } finally {
    reference.close();
  }
}

/** Check every required column, key, foreign key and STRICT boundary; permit additive columns. */
export function matchesSqliteSchema(
  database: DatabaseSync,
  schema: string,
): boolean {
  for (const [table, expected] of schemaContract(schema)) {
    const actual = describeTable(database, table);
    if (
      actual.strict !== expected.strict ||
      expected.columns.some(
        (column) =>
          !actual.columns.some(
            (candidate) => canonicalJson(candidate) === canonicalJson(column),
          ),
      ) ||
      canonicalJson(actual.foreignKeys) !==
        canonicalJson(expected.foreignKeys) ||
      canonicalJson(actual.uniqueKeys) !== canonicalJson(expected.uniqueKeys)
    )
      return false;
  }
  return true;
}

/** Serialize creation and the closed, additive migration set across concurrent openers. */
export function ensureSqliteSchema(
  database: DatabaseSync,
  schema: string,
  additions: Record<string, Record<string, string>> = {},
): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    const expected = [...schemaContract(schema).keys()];
    const present = expected.filter((table) =>
      database
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .get(table),
    );
    // An absent namespace is a first open; a partially missing namespace is damaged.
    if (present.length > 0 && present.length !== expected.length)
      throw new SqliteSchemaError();
    database.exec(schema);
    for (const [table, columns] of Object.entries(additions)) {
      const existing = new Set(
        describeTable(database, table).columns.map(({ name }) => name),
      );
      for (const [column, declaration] of Object.entries(columns)) {
        if (!existing.has(column))
          database.exec(
            `ALTER TABLE ${identifier(table)} ADD COLUMN ${identifier(column)} ${declaration}`,
          );
      }
    }
    if (!matchesSqliteSchema(database, schema)) throw new SqliteSchemaError();
    database.exec("COMMIT");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      /* Preserve the original failure. */
    }
    throw error;
  }
}
