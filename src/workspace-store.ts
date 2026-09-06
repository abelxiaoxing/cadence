import { execFile, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { ArtifactStore } from "./artifact-store.ts";
import { compareCanonicalStrings } from "./canonical.ts";
import { isValidRelativePath } from "./contracts.ts";
import { observeSafePath } from "./safe-path.ts";
import { runWorkspaceIo, type WorkspaceIoMetrics } from "./workspace-io.ts";

const SHA256 = /^[a-f0-9]{64}$/u;

export interface WorkspaceFileEntry {
  kind: "file";
  hash: string;
  bytes: number;
  mode: number;
}

export interface WorkspaceAbsentEntry {
  kind: "absent";
}

export type WorkspaceEntry = WorkspaceFileEntry | WorkspaceAbsentEntry;
export type WorkspaceEntries = Record<string, WorkspaceEntry>;

export interface WorkspaceRevision {
  revisionId: string;
  parentRevisionId: string | null;
  manifestHash: string;
  entries: WorkspaceEntries;
}

export interface CaptureBaselineInput {
  gitTimeoutMs?: number;
  consumerRoot: string;
  approvedUntracked?: string[];
  absent?: string[];
  excludedPaths?: string[];
}

export type WorkspaceChange =
  | Uint8Array
  | null
  | { kind: "absent" }
  | { kind: "file"; bytes: Uint8Array; mode?: number };

export interface CreateRevisionInput {
  parentRevisionId: string;
  changes: Record<string, WorkspaceChange>;
}

export interface MergeRevisionInput {
  baseRevisionId: string;
  currentRevisionId: string;
  candidateRevisionId: string;
  boundPaths: string[];
}

function hash(...values: Array<string | Uint8Array>): string {
  const digest = createHash("sha256");
  for (const value of values) {
    const bytes = typeof value === "string" ? Buffer.from(value) : value;
    digest.update(`${bytes.byteLength}:`);
    digest.update(bytes);
  }
  return digest.digest("hex");
}

function stableEntries(entries: WorkspaceEntries): WorkspaceEntries {
  return Object.fromEntries(
    Object.entries(entries)
      .sort(([left], [right]) => compareCanonicalStrings(left, right))
      .map(([relative, entry]) => [relative, { ...entry }]),
  );
}

function manifestHash(entries: WorkspaceEntries): string {
  return hash(
    "cadence-workspace-manifest",
    JSON.stringify(stableEntries(entries)),
  );
}

function revisionId(parentRevisionId: string | null, manifest: string): string {
  return hash("cadence-workspace-revision", parentRevisionId ?? "", manifest);
}

function ensureDirectory(directory: string): void {
  const stat = lstatSync(directory, { throwIfNoEntry: false });
  if (stat) {
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("unsafe-workspace-path");
    }
    chmodSync(directory, 0o700);
    return;
  }
  let cursor = path.dirname(directory);
  while (cursor !== path.dirname(cursor)) {
    const ancestor = lstatSync(cursor, { throwIfNoEntry: false });
    if (ancestor) {
      if (ancestor.isSymbolicLink() || !ancestor.isDirectory()) {
        throw new Error("unsafe-workspace-path");
      }
      break;
    }
    cursor = path.dirname(cursor);
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const created = lstatSync(directory);
  if (created.isSymbolicLink() || !created.isDirectory()) {
    throw new Error("unsafe-workspace-path");
  }
  chmodSync(directory, 0o700);
}

function syncDirectory(directory: string): void {
  const descriptor = openSync(directory, constants.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function writeAtomic(target: string, bytes: Uint8Array): void {
  const directory = path.dirname(target);
  ensureDirectory(directory);
  const temporary = path.join(
    directory,
    `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const descriptor = openSync(
    temporary,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o600,
  );
  try {
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  try {
    renameSync(temporary, target);
    chmodSync(target, 0o600);
    syncDirectory(directory);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // The rename may already have consumed the temporary file.
    }
    throw error;
  }
}

function requireSafeRelative(relative: string): void {
  if (!isValidRelativePath(relative) || relative === ".") {
    throw new Error("unsafe-workspace-path");
  }
}

function isExcluded(relative: string, excluded: readonly string[]): boolean {
  return excluded.some(
    (entry) => relative === entry || relative.startsWith(`${entry}/`),
  );
}

function parseNullSeparated(bytes: Buffer): string[] {
  const decoded = bytes.toString("utf8");
  if (!Buffer.from(decoded, "utf8").equals(bytes)) {
    throw new Error("unsafe-workspace-path");
  }
  return decoded.split("\0").filter((entry) => entry.length > 0);
}

function sameEntry(
  left: WorkspaceEntry | undefined,
  right: WorkspaceEntry | undefined,
): boolean {
  if (!left || !right) return left === right;
  if (left.kind !== right.kind) return false;
  return (
    left.kind === "absent" ||
    (right.kind === "file" &&
      left.hash === right.hash &&
      left.bytes === right.bytes &&
      left.mode === right.mode)
  );
}

function requireMode(mode: number): number {
  if (!Number.isInteger(mode) || mode < 0 || mode > 0o777) {
    throw new Error("workspace-file-mode-invalid");
  }
  return mode;
}

function requireRevisionShape(value: unknown): WorkspaceRevision {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("workspace-revision-invalid");
  }
  const candidate = value as Partial<WorkspaceRevision>;
  if (
    typeof candidate.revisionId !== "string" ||
    !SHA256.test(candidate.revisionId) ||
    (candidate.parentRevisionId !== null &&
      (typeof candidate.parentRevisionId !== "string" ||
        !SHA256.test(candidate.parentRevisionId))) ||
    typeof candidate.manifestHash !== "string" ||
    !SHA256.test(candidate.manifestHash) ||
    !candidate.entries ||
    typeof candidate.entries !== "object" ||
    Array.isArray(candidate.entries)
  ) {
    throw new Error("workspace-revision-invalid");
  }
  for (const [relative, entry] of Object.entries(candidate.entries)) {
    requireSafeRelative(relative);
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("workspace-revision-invalid");
    }
    if ((entry as WorkspaceEntry).kind === "absent") {
      if (Object.keys(entry).length !== 1) {
        throw new Error("workspace-revision-invalid");
      }
      continue;
    }
    const file = entry as WorkspaceFileEntry;
    if (
      file.kind !== "file" ||
      !SHA256.test(file.hash) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      Object.keys(file).length !== 4
    ) {
      throw new Error("workspace-revision-invalid");
    }
    requireMode(file.mode);
  }
  return candidate as WorkspaceRevision;
}

/** Immutable manifests over private content-addressed workspace bytes. */
export class WorkspaceStore {
  readonly root: string;
  readonly #revisions: string;
  readonly #artifacts: ArtifactStore;

  readonly #checkCancelled: () => void;
  readonly #onMetrics?: (metrics: WorkspaceIoMetrics) => void;

  constructor(
    root: string,
    artifacts: ArtifactStore,
    options: {
      checkCancelled?: () => void;
      onMetrics?: (metrics: WorkspaceIoMetrics) => void;
    } = {},
  ) {
    this.#checkCancelled = options.checkCancelled ?? (() => {});
    this.#onMetrics = options.onMetrics;
    if (!path.isAbsolute(root)) throw new Error("workspace-store-root-invalid");
    this.root = path.resolve(root);
    this.#revisions = path.join(this.root, "revisions");
    this.#artifacts = artifacts;
    ensureDirectory(this.root);
    ensureDirectory(this.#revisions);
  }

  #revisionPath(id: string): string {
    if (!SHA256.test(id)) throw new Error("workspace-revision-id-invalid");
    return path.join(this.#revisions, id.slice(0, 2), `${id}.json`);
  }

  #storeRevision(
    parentRevisionId: string | null,
    rawEntries: WorkspaceEntries,
  ): WorkspaceRevision {
    const entries = stableEntries(rawEntries);
    const manifest = manifestHash(entries);
    const id = revisionId(parentRevisionId, manifest);
    const revision: WorkspaceRevision = {
      revisionId: id,
      parentRevisionId,
      manifestHash: manifest,
      entries,
    };
    const target = this.#revisionPath(id);
    const existing = lstatSync(target, { throwIfNoEntry: false });
    if (existing) {
      const stored = this.getRevision(id);
      if (JSON.stringify(stored) !== JSON.stringify(revision)) {
        throw new Error("workspace-revision-conflict");
      }
      return stored;
    }

    writeAtomic(target, Buffer.from(`${JSON.stringify(revision)}\n`));
    const inherited = parentRevisionId
      ? this.getRevision(parentRevisionId).entries
      : {};
    for (const [relative, entry] of Object.entries(entries)) {
      if (entry.kind === "file" && !sameEntry(entry, inherited[relative]))
        this.#artifacts.retain(entry.hash);
    }
    return structuredClone(revision);
  }

  #isAncestor(ancestorId: string, revision: WorkspaceRevision): boolean {
    let cursor: WorkspaceRevision | null = revision;
    const visited = new Set<string>();
    while (cursor) {
      if (cursor.revisionId === ancestorId) return true;
      if (visited.has(cursor.revisionId)) {
        throw new Error("workspace-revision-cycle");
      }
      visited.add(cursor.revisionId);
      cursor = cursor.parentRevisionId
        ? this.getRevision(cursor.parentRevisionId)
        : null;
    }
    return false;
  }

  captureBaseline(input: CaptureBaselineInput): WorkspaceRevision {
    const consumerRoot = path.resolve(input.consumerRoot);
    const rootStat = lstatSync(consumerRoot, { throwIfNoEntry: false });
    if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
      throw new Error("unsafe-workspace-path");
    }
    const excluded = [".git", "node_modules", ...(input.excludedPaths ?? [])];
    for (const relative of excluded) requireSafeRelative(relative);

    return this.#captureBaselineFiles(
      input,
      this.#trackedFiles(input),
      consumerRoot,
      excluded,
    );
  }

  #trackedFiles(input: CaptureBaselineInput): string[] {
    const timeout = input.gitTimeoutMs ?? 30_000;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30_000)
      throw new Error("workspace-git-timeout-invalid");
    const consumerRoot = path.resolve(input.consumerRoot);
    let tracked: string[];
    try {
      tracked = parseNullSeparated(
        execFileSync("git", ["ls-files", "-z", "--cached"], {
          cwd: consumerRoot,
          maxBuffer: 32 * 1024 * 1024,
          timeout,
          killSignal: "SIGKILL",
        }),
      );
    } catch (error) {
      if (error instanceof Error && error.message === "unsafe-workspace-path") {
        throw error;
      }
      throw new Error("workspace-git-baseline-unavailable");
    }

    return tracked;
  }

  #captureBaselineFiles(
    input: CaptureBaselineInput,
    tracked: string[],
    consumerRoot: string,
    excluded: string[],
  ): WorkspaceRevision {
    const approved = input.approvedUntracked ?? [];
    const absent = input.absent ?? [];
    const selected = [...new Set([...tracked, ...approved])].sort();
    const entries: WorkspaceEntries = {};
    for (const relative of selected) {
      this.#checkCancelled();
      requireSafeRelative(relative);
      if (isExcluded(relative, excluded)) continue;
      const observation = observeSafePath(consumerRoot, relative);
      if (observation.kind === "absent") {
        entries[relative] = { kind: "absent" };
        continue;
      }
      if (observation.kind !== "file") throw new Error("unsafe-workspace-path");
      const absolute = path.join(consumerRoot, ...relative.split("/"));
      const bytes = readFileSync(absolute);
      const artifact = this.#artifacts.put(bytes);
      const stat = lstatSync(absolute);
      entries[relative] = {
        kind: "file",
        hash: artifact.hash,
        bytes: artifact.bytes,
        mode: requireMode(stat.mode & 0o777),
      };
    }
    for (const relative of [...new Set(absent)].sort()) {
      requireSafeRelative(relative);
      if (isExcluded(relative, excluded))
        throw new Error("unsafe-workspace-path");
      if (observeSafePath(consumerRoot, relative).kind !== "absent") {
        throw new Error("workspace-path-not-absent");
      }
      entries[relative] = { kind: "absent" };
    }
    return this.#storeRevision(null, entries);
  }

  getRevision(id: string): WorkspaceRevision {
    const target = this.#revisionPath(id);
    const stat = lstatSync(target, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.isSymbolicLink()) {
      throw new Error("workspace-revision-unavailable");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(target, "utf8"));
    } catch {
      throw new Error("workspace-revision-invalid");
    }
    const revision = requireRevisionShape(parsed);
    if (
      revision.revisionId !== id ||
      (manifestHash(revision.entries) !== revision.manifestHash &&
        hash("cadence-workspace-manifest", JSON.stringify(revision.entries)) !==
          revision.manifestHash) ||
      revisionId(revision.parentRevisionId, revision.manifestHash) !== id
    ) {
      throw new Error("workspace-revision-integrity-invalid");
    }
    return structuredClone(revision);
  }

  createRevision(input: CreateRevisionInput): WorkspaceRevision {
    const parent = this.getRevision(input.parentRevisionId);
    const entries = stableEntries(parent.entries);
    for (const [relative, change] of Object.entries(input.changes).sort(
      ([left], [right]) => compareCanonicalStrings(left, right),
    )) {
      requireSafeRelative(relative);
      if (
        change === null ||
        (typeof change === "object" &&
          "kind" in change &&
          change.kind === "absent")
      ) {
        entries[relative] = { kind: "absent" };
        continue;
      }
      const descriptor =
        change instanceof Uint8Array
          ? {
              kind: "file" as const,
              bytes: change,
              mode:
                entries[relative]?.kind === "file"
                  ? entries[relative].mode
                  : 0o644,
            }
          : change;
      if (
        descriptor?.kind !== "file" ||
        !(descriptor.bytes instanceof Uint8Array)
      ) {
        throw new Error("workspace-change-invalid");
      }
      const artifact = this.#artifacts.put(descriptor.bytes);
      entries[relative] = {
        kind: "file",
        hash: artifact.hash,
        bytes: artifact.bytes,
        mode: requireMode(descriptor.mode ?? 0o644),
      };
    }
    return this.#storeRevision(parent.revisionId, entries);
  }

  mergeRevision(input: MergeRevisionInput): WorkspaceRevision {
    const base = this.getRevision(input.baseRevisionId);
    const current = this.getRevision(input.currentRevisionId);
    const candidate = this.getRevision(input.candidateRevisionId);
    if (
      candidate.parentRevisionId !== base.revisionId ||
      !this.#isAncestor(base.revisionId, current)
    ) {
      throw new Error("workspace-revision-base-invalid");
    }
    const boundPaths = [...new Set(input.boundPaths)];
    for (const relative of boundPaths) {
      requireSafeRelative(relative);
      if (!sameEntry(base.entries[relative], current.entries[relative])) {
        throw new Error("workspace-revision-stale");
      }
    }

    const allPaths = new Set([
      ...Object.keys(base.entries),
      ...Object.keys(candidate.entries),
    ]);
    const delta = [...allPaths].filter(
      (relative) =>
        !sameEntry(base.entries[relative], candidate.entries[relative]),
    );
    for (const relative of delta) {
      if (!sameEntry(base.entries[relative], current.entries[relative])) {
        throw new Error("workspace-revision-stale");
      }
    }

    const merged = stableEntries(current.entries);
    for (const relative of delta.sort()) {
      const entry = candidate.entries[relative];
      if (entry) merged[relative] = { ...entry };
      else delete merged[relative];
    }
    return this.#storeRevision(current.revisionId, merged);
  }

  materialize(revisionIdValue: string, destination: string): void {
    const revision = this.getRevision(revisionIdValue);
    const root = path.resolve(destination);
    ensureDirectory(root);
    for (const [relative, entry] of Object.entries(revision.entries)) {
      this.#checkCancelled();
      requireSafeRelative(relative);
      const observation = observeSafePath(root, relative);
      if (entry.kind === "absent") {
        const segments = relative.split("/");
        const supersededByFileAncestor = segments
          .slice(0, -1)
          .some(
            (_segment, index) =>
              revision.entries[segments.slice(0, index + 1).join("/")]?.kind ===
              "file",
          );
        if (supersededByFileAncestor) continue;
        if (observation.kind !== "absent") {
          throw new Error("workspace-materialize-conflict");
        }
        continue;
      }
      const segments = relative.split("/");
      let parent = root;
      for (const segment of segments.slice(0, -1)) {
        parent = path.join(parent, segment);
        ensureDirectory(parent);
      }
      const target = path.join(root, ...segments);
      if (observation.kind !== "absent") {
        throw new Error("workspace-materialize-conflict");
      }
      const bytes = this.#artifacts.copyVerified(entry.hash, target);
      if (bytes !== entry.bytes)
        throw new Error("workspace-revision-integrity-invalid");
      chmodSync(target, entry.mode);
    }
  }
  /** Used by the trusted I/O worker; Git is bounded and cancellable. */
  async captureBaselineWithGit(
    input: CaptureBaselineInput,
    signal?: AbortSignal,
  ): Promise<WorkspaceRevision> {
    signal?.throwIfAborted();
    const consumerRoot = path.resolve(input.consumerRoot);
    const stat = lstatSync(consumerRoot, { throwIfNoEntry: false });
    if (!stat?.isDirectory() || stat.isSymbolicLink())
      throw new Error("unsafe-workspace-path");
    const excluded = [".git", "node_modules", ...(input.excludedPaths ?? [])];
    for (const relative of excluded) requireSafeRelative(relative);
    const timeout = input.gitTimeoutMs ?? 30_000;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30_000)
      throw new Error("workspace-git-timeout-invalid");
    let tracked: string[];
    try {
      const { stdout } = await promisify(execFile)(
        "git",
        ["ls-files", "-z", "--cached"],
        {
          cwd: consumerRoot,
          encoding: "buffer",
          maxBuffer: 32 * 1024 * 1024,
          timeout,
          killSignal: "SIGKILL",
          signal,
        },
      );
      tracked = parseNullSeparated(stdout);
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof Error && error.message === "unsafe-workspace-path")
        throw error;
      throw new Error("workspace-git-baseline-unavailable");
    }
    this.#checkCancelled();
    return this.#captureBaselineFiles(input, tracked, consumerRoot, excluded);
  }

  captureBaselineAsync(
    input: CaptureBaselineInput,
    signal?: AbortSignal,
  ): Promise<WorkspaceRevision> {
    return runWorkspaceIo({
      root: this.root,
      artifactRoot: this.#artifacts.root,
      operation: "captureBaseline",
      args: [input],
      signal,
      onMetrics: this.#onMetrics,
    });
  }

  materializeAsync(
    revisionId: string,
    destination: string,
    signal?: AbortSignal,
  ): Promise<void> {
    return runWorkspaceIo({
      root: this.root,
      artifactRoot: this.#artifacts.root,
      operation: "materialize",
      args: [revisionId, destination],
      signal,
      onMetrics: this.#onMetrics,
    });
  }
}
