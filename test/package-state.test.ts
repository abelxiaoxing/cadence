import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { acquirePackageState } from "../src/package-state.ts";
import { RunStore } from "../src/run-store.ts";
import { resolveStateRoot } from "../src/state-root.ts";
import {
  APPLY_SCHEMA,
  DESIGN_SCHEMA,
  ENGINE_SCHEMA,
} from "../src/storage-schema.ts";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "cadence-package-state-"));
  roots.push(root);
  const consumerRoot = path.join(root, "中文 project");
  mkdirSync(consumerRoot);
  writeFileSync(path.join(consumerRoot, "uncommitted.txt"), "preserve");
  const state = resolveStateRoot({
    consumerRoot,
    xdgStateHome: path.join(root, "state"),
  });
  return { root, state };
}
function seed(state: ReturnType<typeof fixture>["state"]) {
  const store = RunStore.open(state);
  try {
    return store.startRun({
      stage: "abel-design",
      operationId: "start",
      provisionalKey: "a".repeat(64),
    });
  } finally {
    store.close();
  }
}
function query(state: ReturnType<typeof fixture>["state"], sql: string) {
  const db = new DatabaseSync(state.databasePath, { readOnly: true });
  try {
    return db.prepare(sql).all();
  } finally {
    db.close();
  }
}

it("creates once, retains same-version facts, and blocks downgrade without changing them", () => {
  const { state } = fixture();
  acquirePackageState(state, "1.5.3").close();
  const run = seed(state);
  const again = acquirePackageState(state, "1.5.3");
  expect(again.notice).toBeUndefined();
  again.close();
  expect(query(state, "SELECT run_id FROM runs")).toEqual([
    { run_id: run.runId },
  ]);
  expect(() => acquirePackageState(state, "1.5.2")).toThrow(
    "package-state-downgrade-blocked",
  );
  expect(query(state, "SELECT run_id FROM runs")).toEqual([
    { run_id: run.runId },
  ]);
});

it.each([false, true])(
  "backs up the entire current root, resets all facts and preserves the repository (versioned: %s)",
  (versioned) => {
    const { state, root } = fixture();
    if (versioned) acquirePackageState(state, "1.5.2").close();
    const run = seed(state);
    if (!versioned) {
      const db = new DatabaseSync(state.databasePath);
      db.exec(
        "ALTER TABLE delivery_bindings DROP COLUMN approval_revision; ALTER TABLE delivery_bindings DROP COLUMN contract_hash; ALTER TABLE delivery_bindings DROP COLUMN record_hash; CREATE TABLE schema_meta(version INTEGER PRIMARY KEY CHECK(version=2)) STRICT; INSERT INTO schema_meta VALUES(2)",
      );
      db.close();
    }
    for (const directory of [
      state.artifactsDir,
      state.workspacesDir,
      state.transactionsDir,
    ])
      writeFileSync(path.join(directory, "retained"), "old bytes");
    const other = path.join(root, "other-root");
    mkdirSync(other);
    writeFileSync(path.join(other, "data"), "other");
    const owner = acquirePackageState(state, "1.5.3");
    expect(owner.notice).toMatchObject({
      reason: versioned ? "package-upgrade" : "unversioned-store",
      previousVersion: versioned ? "1.5.2" : null,
      currentVersion: "1.5.3",
    });
    const backup = owner.notice!.backupPath;
    owner.close();
    const db = new DatabaseSync(path.join(backup, "control.sqlite3"), {
      readOnly: true,
    });
    try {
      expect(db.prepare("SELECT run_id FROM runs").all()).toEqual([
        { run_id: run.runId },
      ]);
    } finally {
      db.close();
    }
    expect(query(state, "SELECT * FROM runs")).toEqual([]);
    expect(query(state, "SELECT version FROM cadence_package_version")).toEqual(
      [{ version: "1.5.3" }],
    );
    for (const name of ["artifacts", "workspaces", "transactions"])
      expect(readFileSync(path.join(backup, name, "retained"), "utf8")).toBe(
        "old bytes",
      );
    expect(
      readFileSync(path.join(state.consumerRoot, "uncommitted.txt"), "utf8"),
    ).toBe("preserve");
    expect(readFileSync(path.join(other, "data"), "utf8")).toBe("other");
    const again = acquirePackageState(state, "1.5.3");
    expect(again.notice).toBeUndefined();
    again.close();
    // Release the last owner before fixture cleanup (important on Windows).
  },
);

it.each([
  ["active run", "UPDATE runs SET state = 'running'"],
  [
    "operation lease",
    "INSERT INTO operations(run_id,operation_id,kind,state,lease_expires_at) SELECT run_id,'lease','lease','committed',9007199254740991 FROM runs",
  ],
  [
    "engine operation",
    "INSERT INTO workflow_engine_operations(run_id,operation_id,command,state) SELECT run_id,'execute','start','running' FROM runs",
  ],
  [
    "design lease",
    "INSERT INTO design_finalization_leases SELECT run_id,'finalize','token',9007199254740991 FROM runs",
  ],
  [
    "apply intent",
    "INSERT INTO apply_transactions(transaction_id,owner_run_id,state,intent_json,recovery_json) SELECT 'tx',run_id,'prepared','{}','{}' FROM runs",
  ],
])(
  "abandons retained %s records rather than requiring settlement",
  (_label, sql) => {
    const { state } = fixture();
    seed(state);
    const db = new DatabaseSync(state.databasePath);
    db.exec(DESIGN_SCHEMA + ENGINE_SCHEMA);
    db.exec(sql);
    db.close();
    const before = query(state, "SELECT * FROM runs");
    const owner = acquirePackageState(state, "1.5.3");
    try {
      expect(owner.notice).toMatchObject({
        oldRunsAbandoned: true,
        workspaceRestored: false,
        warning: expect.stringContaining("Git diff"),
      });
      const backup = new DatabaseSync(
        path.join(owner.notice!.backupPath, "control.sqlite3"),
        { readOnly: true },
      );
      try {
        expect(backup.prepare("SELECT * FROM runs").all()).toEqual(before);
      } finally {
        backup.close();
      }
      expect(query(state, "SELECT * FROM runs")).toEqual([]);
    } finally {
      owner.close();
    }
  },
);

it("holds cross-process ownership until close, and the OS releases it on host exit", () => {
  const { state } = fixture();
  const owner = acquirePackageState(state, "1.5.3");
  const lock = path.join(
    state.rootsDir,
    `${state.consumerRootHash}.package-state`,
    "lock.sqlite3",
  );
  const script = `const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(process.argv[1]); db.exec('PRAGMA busy_timeout=1; BEGIN IMMEDIATE');`;
  expect(spawnSync(process.execPath, ["-e", script, lock]).status).not.toBe(0);
  expect(() => acquirePackageState(state, "1.5.4")).toThrow(
    "package-state-in-use",
  );
  owner.close();
  expect(spawnSync(process.execPath, ["-e", script, lock]).status).toBe(0);
  acquirePackageState(state, "1.5.4").close();
});

it.each([false, true])(
  "recovers interrupted reset publication (backup already moved: %s)",
  (moved) => {
    const { state } = fixture();
    seed(state);
    const original = RunStore.open;
    const injected = vi.spyOn(RunStore, "open").mockImplementation(() => {
      throw Error("injected-new-store-open");
    });
    expect(() => acquirePackageState(state, "1.5.3")).toThrow(
      "package-state-reset-unavailable",
    );
    injected.mockImplementation(original);
    const coordinator = path.join(
      state.rootsDir,
      `${state.consumerRootHash}.package-state`,
    );
    const intent = JSON.parse(
      readFileSync(path.join(coordinator, "reset.json"), "utf8"),
    );
    if (!moved) {
      // Model a crash before rename using only this disposable fixture.
      rmSync(state.rootDir, { recursive: true });
      renameSync(intent.backupPath, state.rootDir);
    }
    const resumed = acquirePackageState(state, "1.5.3");
    expect(resumed.notice?.backupPath).toBe(intent.backupPath);
    resumed.close();
    expect(
      readdirSync(coordinator).filter((name) => name.startsWith("backup-")),
    ).toHaveLength(1);
    expect(query(state, "SELECT * FROM runs")).toEqual([]);
    expect(query(state, "SELECT version FROM cadence_package_version")).toEqual(
      [{ version: "1.5.3" }],
    );
  },
);

it("backs up corrupt storage without requiring its schema or transaction state", () => {
  const { state } = fixture();
  seed(state);
  writeFileSync(state.databasePath, "not sqlite");
  const owner = acquirePackageState(state, "1.5.3");
  try {
    expect(owner.notice?.reason).toBe("unreadable-store");
    expect(
      readFileSync(
        path.join(owner.notice!.backupPath, "control.sqlite3"),
        "utf8",
      ),
    ).toBe("not sqlite");
    expect(query(state, "SELECT * FROM runs")).toEqual([]);
  } finally {
    owner.close();
  }
});

it.each(["prepared", "recovering", "paused", "corrupt", "missing"])(
  "abandons real-layout %s apply journal without restoring the workspace",
  (status) => {
    const { state } = fixture();
    acquirePackageState(state, "1.5.2").close();
    const run = seed(state);
    const transactions = path.join(
      state.rootDir,
      "run-data",
      run.runId,
      "transactions",
    );
    mkdirSync(transactions, { recursive: true });
    const file = path.join(transactions, "apply.sqlite3");
    if (status === "corrupt") writeFileSync(file, "corrupt journal");
    else if (status !== "missing") {
      const db = new DatabaseSync(file);
      db.exec(APPLY_SCHEMA);
      db.prepare("INSERT INTO apply_transaction_journal VALUES(?,?,?)").run(
        "tx",
        JSON.stringify({ state: status }),
        "fixture",
      );
      db.close();
    }
    writeFileSync(
      path.join(state.consumerRoot, "uncommitted.txt"),
      "partial apply bytes",
    );
    const owner = acquirePackageState(state, "1.5.3");
    try {
      expect(owner.notice?.reason).toBe("package-upgrade");
      expect(
        existsSync(
          path.join(
            owner.notice!.backupPath,
            "run-data",
            run.runId,
            "transactions",
          ),
        ),
      ).toBe(true);
      expect(existsSync(path.join(state.rootDir, "run-data"))).toBe(false);
      expect(
        readFileSync(path.join(state.consumerRoot, "uncommitted.txt"), "utf8"),
      ).toBe("partial apply bytes");
    } finally {
      owner.close();
    }
  },
);

it.each(["workspaces", "run-data", "unknown-old-resources"])(
  "backs up orphan %s when the control database is missing",
  (directory) => {
    const { state } = fixture();
    acquirePackageState(state, "1.5.3").close();
    rmSync(state.databasePath);
    const resources = path.join(state.rootDir, directory);
    mkdirSync(resources, { recursive: true });
    writeFileSync(path.join(resources, "orphan"), "retained");
    const owner = acquirePackageState(state, "1.5.4");
    try {
      expect(owner.notice?.reason).toBe("missing-store");
      expect(
        readFileSync(
          path.join(owner.notice!.backupPath, directory, "orphan"),
          "utf8",
        ),
      ).toBe("retained");
      expect(existsSync(path.join(state.rootDir, directory, "orphan"))).toBe(
        false,
      );
    } finally {
      owner.close();
    }
  },
);

it("moves nested resource links without following or modifying their targets", () => {
  const { state, root } = fixture();
  seed(state);
  const target = path.join(root, "outside");
  mkdirSync(target);
  writeFileSync(path.join(target, "keep"), "safe");
  symlinkSync(
    target,
    path.join(state.rootDir, "run-data"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const owner = acquirePackageState(state, "1.5.3");
  try {
    expect(readFileSync(path.join(target, "keep"), "utf8")).toBe("safe");
    expect(existsSync(path.join(state.rootDir, "run-data"))).toBe(false);
  } finally {
    owner.close();
  }
});

it("recovers after version publication without losing or repeating the backup", () => {
  const { state } = fixture();
  seed(state);
  const original = DatabaseSync.prototype.exec;
  let failOnce = true;
  vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
    this: DatabaseSync,
    sql: string,
  ) {
    const result = original.call(this, sql);
    // RunStore creation commits before the package-version transaction.
    if (
      sql === "COMMIT" &&
      failOnce &&
      this.prepare(
        "SELECT name FROM sqlite_master WHERE name='cadence_package_version'",
      ).get()
    ) {
      failOnce = false;
      throw Error("interrupted-after-version-commit");
    }
    return result;
  });
  expect(() => acquirePackageState(state, "1.5.3")).toThrow(
    "package-state-reset-unavailable",
  );
  vi.restoreAllMocks();
  const resumed = acquirePackageState(state, "1.5.3");
  expect(resumed.notice?.reason).toBe("unversioned-store");
  resumed.close();
  expect(query(state, "SELECT * FROM runs")).toEqual([]);
  acquirePackageState(state, "1.5.3").close();
});

it("rejects a root link without following or resetting its target", () => {
  const { state, root } = fixture();
  acquirePackageState(state, "1.5.2").close();
  const target = path.join(root, "outside-state");
  renameSync(state.rootDir, target);
  symlinkSync(
    target,
    state.rootDir,
    process.platform === "win32" ? "junction" : "dir",
  );
  expect(() => acquirePackageState(state, "1.5.3")).toThrow(
    "state-component-symlink",
  );
  const db = new DatabaseSync(path.join(target, "control.sqlite3"), {
    readOnly: true,
  });
  try {
    expect(
      db.prepare("SELECT version FROM cadence_package_version").get(),
    ).toEqual({ version: "1.5.2" });
  } finally {
    db.close();
  }
});

it("does not reinterpret an observable SQLite lock as corrupt old storage", () => {
  const { state } = fixture();
  seed(state);
  const db = new DatabaseSync(state.databasePath);
  db.exec("PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE");
  try {
    expect(() => acquirePackageState(state, "1.5.3")).toThrow(
      "package-state-in-use",
    );
  } finally {
    db.close();
  }
  expect(query(state, "SELECT * FROM runs")).toHaveLength(1);
});

it("backs up an invalid version marker without copying its submitted value into notices", () => {
  const { state } = fixture();
  acquirePackageState(state, "1.5.2").close();
  const db = new DatabaseSync(state.databasePath);
  db.exec("UPDATE cadence_package_version SET version='invalid-private-input'");
  db.close();
  const owner = acquirePackageState(state, "1.5.3");
  try {
    expect(owner.notice).toMatchObject({
      reason: "unreadable-store",
      previousVersion: null,
    });
    expect(JSON.stringify(owner.notice)).not.toContain("invalid-private-input");
  } finally {
    owner.close();
  }
});
