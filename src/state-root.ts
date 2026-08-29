import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const STATE_ROOT_ERROR_CODES = [
  "consumer-root-unavailable",
  "invalid-state-base",
  "state-component-symlink",
  "state-component-type",
  "state-root-inside-consumer",
] as const;

export type StateRootErrorCode = (typeof STATE_ROOT_ERROR_CODES)[number];

export class StateRootError extends Error {
  readonly code: StateRootErrorCode;

  constructor(code: StateRootErrorCode) {
    super(code);
    this.name = "StateRootError";
    this.code = code;
  }
}

export interface StateRootOptions {
  consumerRoot: string;
  xdgStateHome?: string;
  homeDir?: string;
}

export interface ResolvedStateRoot {
  consumerRoot: string;
  consumerRootHash: string;
  stateBase: string;
  productRoot: string;
  rootsDir: string;
  rootDir: string;
  databasePath: string;
  artifactsDir: string;
  workspacesDir: string;
  transactionsDir: string;
}

function isContainedBy(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function inspectExistingComponents(absolutePath: string): void {
  const parsed = path.parse(absolutePath);
  const relativeParts = absolutePath
    .slice(parsed.root.length)
    .split(path.sep)
    .filter(Boolean);
  let current = parsed.root;
  for (const part of relativeParts) {
    current = path.join(current, part);
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new StateRootError("state-component-symlink");
    }
    if (!stat.isDirectory() && current !== absolutePath) {
      throw new StateRootError("state-component-type");
    }
  }
}

function canonicalFuturePath(input: string): string {
  const absolute = path.resolve(input);
  inspectExistingComponents(absolute);
  let cursor = absolute;
  const missing: string[] = [];
  for (;;) {
    try {
      return path.join(realpathSync.native(cursor), ...missing.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      missing.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

function requireAbsoluteDirectoryBase(
  xdgStateHome: string | undefined,
  homeDir: string,
): string {
  if (xdgStateHome && path.isAbsolute(xdgStateHome)) {
    return canonicalFuturePath(xdgStateHome);
  }
  if (!path.isAbsolute(homeDir)) {
    throw new StateRootError("invalid-state-base");
  }
  return canonicalFuturePath(path.join(homeDir, ".local", "state"));
}

export function resolveStateRoot(options: StateRootOptions): ResolvedStateRoot {
  let consumerRoot: string;
  try {
    consumerRoot = realpathSync.native(path.resolve(options.consumerRoot));
    if (!lstatSync(consumerRoot).isDirectory()) {
      throw new StateRootError("consumer-root-unavailable");
    }
  } catch (error) {
    if (error instanceof StateRootError) throw error;
    throw new StateRootError("consumer-root-unavailable");
  }

  const stateBase = requireAbsoluteDirectoryBase(
    options.xdgStateHome,
    options.homeDir ?? os.homedir(),
  );
  const consumerRootHash = createHash("sha256")
    .update(consumerRoot)
    .digest("hex");
  const productRoot = canonicalFuturePath(path.join(stateBase, "abel-cadence"));
  const rootsDir = canonicalFuturePath(path.join(productRoot, "roots"));
  const rootDir = canonicalFuturePath(path.join(rootsDir, consumerRootHash));

  if (isContainedBy(consumerRoot, rootDir)) {
    throw new StateRootError("state-root-inside-consumer");
  }

  return {
    consumerRoot,
    consumerRootHash,
    stateBase,
    productRoot,
    rootsDir,
    rootDir,
    databasePath: path.join(rootDir, "control.sqlite3"),
    artifactsDir: path.join(rootDir, "artifacts"),
    workspacesDir: path.join(rootDir, "workspaces"),
    transactionsDir: path.join(rootDir, "transactions"),
  };
}

function ensureDirectory(directory: string): void {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = path.dirname(directory);
    if (parent !== directory) ensureDirectory(parent);
    mkdirSync(directory, { mode: 0o700 });
    chmodSync(directory, 0o700);
    return;
  }
  if (stat.isSymbolicLink()) {
    throw new StateRootError("state-component-symlink");
  }
  if (!stat.isDirectory()) {
    throw new StateRootError("state-component-type");
  }
}

export function prepareStateRoot(
  resolved: ResolvedStateRoot,
): ResolvedStateRoot {
  const checked = resolveStateRoot({
    consumerRoot: resolved.consumerRoot,
    xdgStateHome: resolved.stateBase,
    homeDir: path.dirname(resolved.stateBase),
  });
  if (
    checked.consumerRootHash !== resolved.consumerRootHash ||
    checked.rootDir !== resolved.rootDir
  ) {
    throw new StateRootError("invalid-state-base");
  }

  ensureDirectory(resolved.stateBase);
  for (const directory of [
    resolved.productRoot,
    resolved.rootsDir,
    resolved.rootDir,
    resolved.artifactsDir,
    resolved.workspacesDir,
    resolved.transactionsDir,
  ]) {
    ensureDirectory(directory);
    chmodSync(directory, 0o700);
  }

  try {
    const database = lstatSync(resolved.databasePath);
    if (database.isSymbolicLink()) {
      throw new StateRootError("state-component-symlink");
    }
    if (!database.isFile()) {
      throw new StateRootError("state-component-type");
    }
  } catch (error) {
    if (
      error instanceof StateRootError ||
      (error as NodeJS.ErrnoException).code !== "ENOENT"
    ) {
      throw error;
    }
  }
  return { ...resolved };
}
