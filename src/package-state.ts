import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { syncDirectory } from "./directory-sync.ts";
import { assertExecutionsSettled } from "./execution-retention.ts";
import { RunStore } from "./run-store.ts";
import { prepareStateRoot, type ResolvedStateRoot } from "./state-root.ts";

export class PackageStateError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
export interface PackageStateNotice {
  reason:
    | "package-upgrade"
    | "unversioned-store"
    | "unreadable-store"
    | "missing-store";
  previousVersion: string | null;
  currentVersion: string;
  backupPath: string;
  oldRunsAbandoned: true;
  workspaceRestored: false;
  warning: string;
}
interface ResetIntent
  extends Omit<
    PackageStateNotice,
    "oldRunsAbandoned" | "workspaceRestored" | "warning"
  > {
  backupName: string;
}
const fail = (code: string): never => {
  throw new PackageStateError(code);
};
const versionParts = (version: string): number[] => {
  if (!/^\d+\.\d+\.\d+$/u.test(version)) fail("package-state-version-invalid");
  const parts = version.split(".").map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part)))
    fail("package-state-version-invalid");
  return parts;
};
function compareVersions(left: string, right: string): number {
  const a = versionParts(left),
    b = versionParts(right);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}
function regular(file: string): boolean {
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (!stat) return false;
  if (!stat.isFile() || stat.isSymbolicLink())
    fail("package-state-path-unsafe");
  return true;
}
function table(db: DatabaseSync, name: string): boolean {
  return !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
}
function storedVersion(db: DatabaseSync): string | null {
  if (!table(db, "cadence_package_version")) return null;
  const rows = db.prepare("SELECT version FROM cadence_package_version").all();
  if (rows.length !== 1 || typeof rows[0].version !== "string")
    fail("package-state-version-invalid");
  const version = String(rows[0].version);
  versionParts(version);
  return version;
}
// Only inspect the version. Old task/lease/apply records are deliberately not
// interpreted: this policy abandons them, including malformed or unreadable facts.
function inspectVersion(file: string): {
  version: string | null;
  unreadable: boolean;
} {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    return { version: storedVersion(db), unreadable: false };
  } catch (error) {
    const failure = error as { errcode?: number; code?: string };
    // An actual SQLite lock is not a stale durable lease record. Do not move
    // storage while an uncoordinated old opener is observably using it.
    if (failure.errcode !== undefined && [5, 6].includes(failure.errcode & 255))
      fail("package-state-in-use");
    if (
      (error instanceof PackageStateError &&
        error.code === "package-state-version-invalid") ||
      (failure.errcode !== undefined &&
        [1, 11, 26].includes(failure.errcode & 255))
    )
      return { version: null, unreadable: true };
    // Schema errors / SQLITE_CORRUPT / SQLITE_NOTADB mean opaque old bytes.
    // Permissions, disk I/O, resource exhaustion and unknown errors do not.
    return fail("package-state-reset-unavailable");
  } finally {
    db?.close();
  }
}

function hasOldResources(state: ResolvedStateRoot): boolean {
  // Cover the production run-data layout and unknown historical resources.
  // Never descend through resource links; the whole root is renamed as-is.
  const emptyScaffolds = new Set(["artifacts", "workspaces", "transactions"]);
  return readdirSync(state.rootDir).some((name) => {
    const file = path.join(state.rootDir, name);
    const stat = lstatSync(file);
    return (
      !emptyScaffolds.has(name) ||
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      readdirSync(file).length > 0
    );
  });
}

const RESET_WARNING =
  "Old runs and approval evidence are abandoned, not resumed. Stop all old hosts and execution processes before resetting; the lock cannot fence older versions or detached descendants. The main workspace is not restored: interrupted apply may have left partial changes. Inspect Git diff before starting new work.";

function persistIntent(file: string, intent: ResetIntent): void {
  const temp = `${file}.tmp`;
  regular(temp);
  const fd = openSync(temp, "w", 0o600);
  try {
    writeFileSync(fd, JSON.stringify(intent));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, file);
  syncDirectory(path.dirname(file));
}

/** Package boundary only: low-level storage and read-only operator inspection never reset state.
 * The external SQLite write lock is held until every service connection has closed.
 * SQLite releases it on process death; no PID guessing or stale-lock deletion is used.
 */
export function acquirePackageState(
  unresolved: ResolvedStateRoot,
  version = String(
    JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ).version,
  ),
): { notice?: PackageStateNotice; close(): void } {
  versionParts(version);
  const state = prepareStateRoot(unresolved);
  try {
    assertExecutionsSettled(state.rootDir);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "isolation-termination-unconfirmed"
    )
      fail(error.message);
    throw error;
  }
  for (const suffix of ["-wal", "-shm", "-journal"])
    regular(state.databasePath + suffix);
  const coordinator = path.join(
    state.rootsDir,
    `${state.consumerRootHash}.package-state`,
  );
  const stat = lstatSync(coordinator, { throwIfNoEntry: false });
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink()))
    fail("package-state-path-unsafe");
  mkdirSync(coordinator, { recursive: true, mode: 0o700 });
  const lockFile = path.join(coordinator, "lock.sqlite3");
  for (const suffix of ["", "-journal", "-wal", "-shm"])
    regular(lockFile + suffix);
  if (!existsSync(lockFile)) {
    try {
      closeSync(openSync(lockFile, "wx", 0o600));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  const lock = new DatabaseSync(lockFile);
  let closed = false;
  const close = () => {
    if (!closed) {
      closed = true;
      lock.close();
    }
  };
  try {
    lock.exec("PRAGMA busy_timeout = 1; BEGIN IMMEDIATE");
  } catch {
    close();
    fail("package-state-in-use");
  }
  try {
    const intentFile = path.join(coordinator, "reset.json");
    let intent: ResetIntent | undefined;
    if (regular(intentFile)) {
      intent = JSON.parse(readFileSync(intentFile, "utf8")) as ResetIntent;
      if (
        !intent ||
        !/^backup-[a-f0-9-]{36}$/u.test(intent.backupName) ||
        intent.backupPath !== path.join(coordinator, intent.backupName) ||
        ![
          "package-upgrade",
          "unversioned-store",
          "unreadable-store",
          "missing-store",
        ].includes(intent.reason) ||
        (intent.previousVersion !== null &&
          typeof intent.previousVersion !== "string")
      )
        fail("package-state-reset-intent-invalid");
      if (intent.currentVersion !== version)
        fail("package-state-reset-version-mismatch");
    }
    let fresh = !regular(state.databasePath);
    if (!intent) {
      const observed = fresh
        ? { version: null, unreadable: false }
        : inspectVersion(state.databasePath);
      if (observed.version === version) return { close };
      if (
        observed.version !== null &&
        compareVersions(observed.version, version) > 0
      )
        fail("package-state-downgrade-blocked");
      if (!fresh || hasOldResources(state)) {
        const backupName = `backup-${randomUUID()}`;
        intent = {
          backupName,
          backupPath: path.join(coordinator, backupName),
          previousVersion: observed.version,
          currentVersion: version,
          reason: fresh
            ? "missing-store"
            : observed.unreadable
              ? "unreadable-store"
              : observed.version === null
                ? "unversioned-store"
                : "package-upgrade",
        };
        persistIntent(intentFile, intent);
      }
    }
    if (intent) {
      const backup = lstatSync(intent.backupPath, { throwIfNoEntry: false });
      if (backup && (!backup.isDirectory() || backup.isSymbolicLink()))
        fail("package-state-path-unsafe");
      if (!backup) {
        // Abandon the old namespace as opaque bytes, including run-data and
        // SQLite sidecars. No transaction replay or main-workspace rollback.
        renameSync(state.rootDir, intent.backupPath);
        syncDirectory(coordinator);
        syncDirectory(state.rootsDir);
      }
      prepareStateRoot(state);
      fresh = true;
    }
    if (fresh) {
      RunStore.open(state).close();
      const db = new DatabaseSync(state.databasePath);
      try {
        db.exec(
          "PRAGMA synchronous = FULL; BEGIN IMMEDIATE; CREATE TABLE IF NOT EXISTS cadence_package_version (version TEXT NOT NULL) STRICT",
        );
        const existing = db
          .prepare("SELECT version FROM cadence_package_version")
          .all();
        if (existing.length === 0)
          db.prepare("INSERT INTO cadence_package_version VALUES (?)").run(
            version,
          );
        else if (existing.length !== 1 || existing[0].version !== version)
          fail("package-state-reset-version-mismatch");
        db.exec("COMMIT");
      } finally {
        db.close();
      }
      syncDirectory(state.rootDir);
    }
    if (intent) {
      unlinkSync(intentFile);
      syncDirectory(coordinator);
    }
    return {
      close,
      ...(intent
        ? {
            notice: {
              reason: intent.reason,
              previousVersion: intent.previousVersion,
              currentVersion: version,
              backupPath: intent.backupPath,
              oldRunsAbandoned: true,
              workspaceRestored: false,
              warning: RESET_WARNING,
            },
          }
        : {}),
    };
  } catch (error) {
    close();
    if (error instanceof PackageStateError) throw error;
    throw new PackageStateError("package-state-reset-unavailable");
  }
}
