import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { ArtifactStore } from "./artifact-store.ts";
import { isValidRelativePath } from "./contracts.ts";
import { observeSafePath } from "./safe-path.ts";
import type {
  WorkspaceEntry,
  WorkspaceRevision,
  WorkspaceStore,
} from "./workspace-store.ts";

const IDENTIFIER = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/iu;
const SHA256 = /^[a-f0-9]{64}$/u;
const JOURNAL_VERSION = 2 as const;

type TransactionState =
  | "prepared"
  | "applying"
  | "recovering"
  | "paused"
  | "discarded"
  | "completed";
type PendingIntent = "cancel" | "discard";
type StepState = "pending" | "applying" | "applied" | "rolled-back";

interface TransactionStep {
  path: string;
  before: WorkspaceEntry;
  after: WorkspaceEntry;
  state: StepState;
}

interface TransactionEvent {
  sequence: number;
  kind: string;
  path?: string;
}

interface TransactionJournal {
  version: typeof JOURNAL_VERSION;
  transactionId: string;
  consumerRoot: string;
  baselineRevisionId: string;
  finalRevisionId: string;
  verificationId: string;
  boundPaths: string[];
  state: TransactionState;
  code?: string;
  pendingIntent?: PendingIntent;
  rollbackRetained: boolean;
  externalPaths: string[];
  retainedHashes: string[];
  releasedHashes: string[];
  createdDirectories: string[];
  steps: TransactionStep[];
  events: TransactionEvent[];
}

interface JournalRow {
  journal_json: string;
  journal_hash: string;
}

export interface CumulativeVerificationExecutionInput {
  root: string;
  revisionId: string;
  verificationId: string;
  signal?: AbortSignal;
}

export type CumulativeVerificationExecutionResult =
  | {
      ok: true;
      exitCode: 0;
      classification: string;
    }
  | {
      ok: false;
      kind:
        | "artifact"
        | "environment"
        | "verification"
        | "verification-adapter"
        | "approval-boundary"
        | "cancelled";
      code: string;
    };

export interface VerifyCumulativeRevisionInput {
  workspaceStore: WorkspaceStore;
  revisionId: string;
  verificationId: string;
  execute: (
    input: CumulativeVerificationExecutionInput,
  ) =>
    | CumulativeVerificationExecutionResult
    | Promise<CumulativeVerificationExecutionResult>;
  signal?: AbortSignal;
}

interface CumulativeVerificationFact {
  readonly revisionId: string;
  readonly verificationId: string;
}

const verificationFacts = new WeakMap<
  object,
  CumulativeVerificationFact & { workspaceStore: WorkspaceStore }
>();

export type CumulativeVerificationResult =
  | { ok: true; fact: object; revisionId: string; verificationId: string }
  | {
      ok: false;
      kind:
        | "artifact"
        | "environment"
        | "verification"
        | "verification-adapter"
        | "approval-boundary"
        | "cancelled";
      code: string;
      verificationId: string;
    };

export interface ApplyTransactionHooks {
  beforeFileMutation?: (input: {
    transactionId: string;
    path: string;
    index: number;
  }) => void | Promise<void>;
  afterFileMutationBeforeSave?: (input: {
    transactionId: string;
    path: string;
    index: number;
  }) => void | Promise<void>;
  afterFileMutation?: (input: {
    transactionId: string;
    path: string;
    index: number;
  }) => void | Promise<void>;
  postApply?: (input: {
    transactionId: string;
    root: string;
    signal: AbortSignal;
  }) =>
    | { ok: true }
    | { ok: false; code: string }
    | Promise<{ ok: true } | { ok: false; code: string }>;
}

export interface ApplyTransactionOptions {
  root: string;
  artifacts: ArtifactStore;
  workspaces: WorkspaceStore;
  hooks?: ApplyTransactionHooks;
  databasePath?: string;
}

export interface PrepareApplyInput {
  transactionId: string;
  consumerRoot: string;
  baselineRevisionId: string;
  finalRevisionId: string;
  boundPaths: string[];
  verificationFact: unknown;
}

export type ApplyTransactionOutcome =
  | {
      ok: true;
      transactionId: string;
      state: "prepared" | "completed";
      replayed?: true;
    }
  | {
      ok: false;
      transactionId: string;
      state: "paused" | "discarded";
      code: string;
      replayed?: true;
    };

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function journalHash(journal: TransactionJournal): string {
  return createHash("sha256")
    .update("cadence-apply-transaction-v2\0")
    .update(JSON.stringify(journal))
    .digest("hex");
}

function requireIdentifier(value: string): void {
  if (!IDENTIFIER.test(value)) throw new Error("transaction-id-invalid");
}

function requireRelative(relative: string): void {
  if (!isValidRelativePath(relative) || relative === ".") {
    throw new Error("transaction-path-invalid");
  }
}

function ensurePrivateDirectory(directory: string): void {
  if (!path.isAbsolute(directory)) throw new Error("transaction-root-invalid");
  let cursor = path.resolve(directory);
  const missing: string[] = [];
  for (;;) {
    const stat = lstatSync(cursor, { throwIfNoEntry: false });
    if (stat) {
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error("transaction-root-invalid");
      }
      break;
    }
    missing.push(cursor);
    const parent = path.dirname(cursor);
    if (parent === cursor) throw new Error("transaction-root-invalid");
    cursor = parent;
  }
  for (const target of missing.reverse()) {
    mkdirSync(target, { mode: 0o700 });
    chmodSync(target, 0o700);
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

function entryEqual(left: WorkspaceEntry, right: WorkspaceEntry): boolean {
  if (left.kind !== right.kind) return false;
  return (
    left.kind === "absent" ||
    (right.kind === "file" &&
      left.hash === right.hash &&
      left.bytes === right.bytes &&
      left.mode === right.mode)
  );
}

function normalizedEntry(entry: WorkspaceEntry | undefined): WorkspaceEntry {
  return entry ? structuredClone(entry) : { kind: "absent" };
}

function isContainedBy(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function canonicalConsumerRoot(input: string): string {
  const absolute = path.resolve(input);
  const stat = lstatSync(absolute, { throwIfNoEntry: false });
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("consumer-root-invalid");
  }
  return realpathSync.native(absolute);
}

function currentEntry(
  root: string,
  relative: string,
): WorkspaceEntry | "unsafe" {
  const observation = observeSafePath(root, relative);
  if (observation.kind === "absent") return { kind: "absent" };
  if (observation.kind !== "file") return "unsafe";
  const absolute = path.join(root, ...relative.split("/"));
  const bytes = readFileSync(absolute);
  const stat = lstatSync(absolute);
  return {
    kind: "file",
    hash: hashBytes(bytes),
    bytes: bytes.byteLength,
    mode: stat.mode & 0o777,
  };
}

function mainMatches(
  root: string,
  relative: string,
  expected: WorkspaceEntry,
): boolean {
  const current = currentEntry(root, relative);
  return current !== "unsafe" && entryEqual(current, expected);
}

function fileEntryAt(target: string): WorkspaceEntry | "unsafe" | "absent" {
  const stat = lstatSync(target, { throwIfNoEntry: false });
  if (!stat) return "absent";
  if (!stat.isFile() || stat.isSymbolicLink()) return "unsafe";
  const bytes = readFileSync(target);
  const confirmed = lstatSync(target, { throwIfNoEntry: false });
  if (
    !confirmed?.isFile() ||
    confirmed.isSymbolicLink() ||
    confirmed.dev !== stat.dev ||
    confirmed.ino !== stat.ino
  ) {
    return "unsafe";
  }
  return {
    kind: "file",
    hash: hashBytes(bytes),
    bytes: bytes.byteLength,
    mode: confirmed.mode & 0o777,
  };
}

function restoreClaim(claim: string, target: string): boolean {
  try {
    linkSync(claim, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  unlinkSync(claim);
  syncDirectory(path.dirname(target));
  return true;
}

async function raceWithAbort<T>(
  execution: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  let removeAbort = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = () =>
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new Error("operation-cancelled"),
      );
    removeAbort = () => signal.removeEventListener("abort", onAbort);
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([execution, aborted]);
  } finally {
    removeAbort();
  }
}

function safeTargetPath(root: string, relative: string): string {
  requireRelative(relative);
  const segments = relative.split("/");
  let parent = root;
  for (const segment of segments.slice(0, -1)) {
    parent = path.join(parent, segment);
    const stat = lstatSync(parent, { throwIfNoEntry: false });
    if (!stat) break;
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("transaction-target-unsafe");
    }
  }
  return path.join(root, ...segments);
}

function writeExclusiveFile(
  target: string,
  bytes: Uint8Array,
  mode: number,
): boolean {
  const directory = path.dirname(target);
  const temporary = path.join(
    directory,
    `.${path.basename(target)}.${process.pid}.${randomUUID()}.apply-tmp`,
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
    chmodSync(temporary, mode);
    try {
      linkSync(temporary, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
    unlinkSync(temporary);
    syncDirectory(directory);
    return true;
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  } finally {
    rmSync(temporary, { force: true });
  }
}

function event(
  journal: TransactionJournal,
  kind: string,
  relative?: string,
): void {
  journal.events.push({
    sequence: journal.events.length + 1,
    kind,
    ...(relative ? { path: relative } : {}),
  });
}

function requireRevisionId(value: string): void {
  if (!SHA256.test(value)) throw new Error("workspace-revision-id-invalid");
}

function validateJournal(value: unknown): TransactionJournal {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("transaction-journal-invalid");
  }
  const journal = value as TransactionJournal;
  if (
    journal.version !== JOURNAL_VERSION ||
    !IDENTIFIER.test(journal.transactionId) ||
    !path.isAbsolute(journal.consumerRoot) ||
    !SHA256.test(journal.baselineRevisionId) ||
    !SHA256.test(journal.finalRevisionId) ||
    !IDENTIFIER.test(journal.verificationId) ||
    !Array.isArray(journal.boundPaths) ||
    ![
      "prepared",
      "applying",
      "recovering",
      "paused",
      "discarded",
      "completed",
    ].includes(journal.state) ||
    typeof journal.rollbackRetained !== "boolean" ||
    !Array.isArray(journal.externalPaths) ||
    !Array.isArray(journal.retainedHashes) ||
    !Array.isArray(journal.releasedHashes) ||
    !Array.isArray(journal.createdDirectories) ||
    !Array.isArray(journal.steps) ||
    !Array.isArray(journal.events)
  ) {
    throw new Error("transaction-journal-invalid");
  }
  if (
    new Set(journal.createdDirectories).size !==
      journal.createdDirectories.length ||
    journal.createdDirectories.some((relative) => {
      try {
        requireRelative(relative);
        return false;
      } catch {
        return true;
      }
    })
  ) {
    throw new Error("transaction-journal-invalid");
  }
  if (
    journal.boundPaths.length === 0 ||
    new Set(journal.boundPaths).size !== journal.boundPaths.length ||
    journal.boundPaths.some((relative) => {
      try {
        requireRelative(relative);
        return false;
      } catch {
        return true;
      }
    })
  ) {
    throw new Error("transaction-journal-invalid");
  }
  for (const step of journal.steps) {
    requireRelative(step.path);
    if (
      !["pending", "applying", "applied", "rolled-back"].includes(step.state)
    ) {
      throw new Error("transaction-journal-invalid");
    }
  }
  if (
    journal.steps.length !== journal.boundPaths.length ||
    journal.steps.some((step, index) => step.path !== journal.boundPaths[index])
  ) {
    throw new Error("transaction-journal-invalid");
  }
  return journal;
}

function isAncestor(
  workspaces: WorkspaceStore,
  ancestorId: string,
  revision: WorkspaceRevision,
): boolean {
  let cursor: WorkspaceRevision | null = revision;
  const visited = new Set<string>();
  while (cursor) {
    if (cursor.revisionId === ancestorId) return true;
    if (visited.has(cursor.revisionId)) {
      throw new Error("workspace-revision-cycle");
    }
    visited.add(cursor.revisionId);
    cursor = cursor.parentRevisionId
      ? workspaces.getRevision(cursor.parentRevisionId)
      : null;
  }
  return false;
}

/** Materialize and execute verification without exposing a caller-forgeable fact. */
export async function verifyCumulativeRevision(
  input: VerifyCumulativeRevisionInput,
): Promise<CumulativeVerificationResult> {
  requireRevisionId(input.revisionId);
  requireIdentifier(input.verificationId);
  const revision = input.workspaceStore.getRevision(input.revisionId);
  const temporary = mkdtempSync(
    path.join(tmpdir(), "cadence-cumulative-verification-"),
  );
  chmodSync(temporary, 0o700);
  try {
    input.workspaceStore.materialize(revision.revisionId, temporary);
    if (input.signal?.aborted) {
      return {
        ok: false,
        kind: "cancelled",
        code: "cancelled",
        verificationId: input.verificationId,
      };
    }
    const result = await input.execute({
      root: temporary,
      revisionId: revision.revisionId,
      verificationId: input.verificationId,
      signal: input.signal,
    });
    if (!result.ok) {
      return {
        ok: false,
        kind: result.kind,
        code: result.code,
        verificationId: input.verificationId,
      };
    }
    if (result.exitCode !== 0 || result.classification.length === 0) {
      throw new Error("verification-outcome-invalid");
    }
    const fact = Object.freeze({
      revisionId: revision.revisionId,
      verificationId: input.verificationId,
    });
    verificationFacts.set(fact, {
      ...fact,
      workspaceStore: input.workspaceStore,
    });
    return {
      ok: true,
      fact,
      revisionId: revision.revisionId,
      verificationId: input.verificationId,
    };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

/** Journaled, restart-safe final delivery from one immutable revision. */
export class ApplyTransaction {
  readonly root: string;
  readonly #artifacts: ArtifactStore;
  readonly #workspaces: WorkspaceStore;
  readonly #hooks: ApplyTransactionHooks;
  readonly #database: DatabaseSync;
  readonly #active = new Map<
    string,
    {
      controller: AbortController;
      promise: Promise<ApplyTransactionOutcome>;
    }
  >();
  #closed = false;

  constructor(options: ApplyTransactionOptions) {
    if (!options || typeof options !== "object") {
      throw new Error("transaction-options-invalid");
    }
    this.root = path.resolve(options.root);
    ensurePrivateDirectory(this.root);
    this.#artifacts = options.artifacts;
    this.#workspaces = options.workspaces;
    this.#hooks = options.hooks ?? {};
    const databasePath = path.resolve(
      options.databasePath ?? path.join(this.root, "apply.sqlite3"),
    );
    if (!isContainedBy(this.root, databasePath)) {
      throw new Error("transaction-database-path-invalid");
    }
    const existing = lstatSync(databasePath, { throwIfNoEntry: false });
    if (existing && (!existing.isFile() || existing.isSymbolicLink())) {
      throw new Error("transaction-database-path-invalid");
    }
    this.#database = new DatabaseSync(databasePath);
    this.#database.exec(
      "PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;",
    );
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS apply_transaction_journal (
        transaction_id TEXT PRIMARY KEY,
        journal_json TEXT NOT NULL,
        journal_hash TEXT NOT NULL
      ) STRICT;
    `);
    chmodSync(databasePath, 0o600);
  }

  #save(journal: TransactionJournal): void {
    if (this.#closed) throw new Error("transaction-store-closed");
    const json = JSON.stringify(journal);
    const digest = journalHash(journal);
    this.#database
      .prepare(
        `INSERT INTO apply_transaction_journal (
           transaction_id, journal_json, journal_hash
         ) VALUES (?, ?, ?)
         ON CONFLICT(transaction_id) DO UPDATE SET
           journal_json = excluded.journal_json,
           journal_hash = excluded.journal_hash`,
      )
      .run(journal.transactionId, json, digest);
  }

  #load(transactionId: string): TransactionJournal {
    if (this.#closed) throw new Error("transaction-store-closed");
    requireIdentifier(transactionId);
    const row = this.#database
      .prepare(
        `SELECT journal_json, journal_hash
         FROM apply_transaction_journal WHERE transaction_id = ?`,
      )
      .get(transactionId) as JournalRow | undefined;
    if (!row) throw new Error("transaction-unavailable");
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.journal_json);
    } catch {
      throw new Error("transaction-journal-invalid");
    }
    const journal = validateJournal(parsed);
    if (journalHash(journal) !== row.journal_hash) {
      throw new Error("transaction-journal-integrity-invalid");
    }
    return structuredClone(journal);
  }

  #project(journal: TransactionJournal, replayed = false) {
    return {
      transactionId: journal.transactionId,
      state: journal.state,
      ...(journal.code ? { code: journal.code } : {}),
      ...(journal.pendingIntent
        ? { pendingIntent: journal.pendingIntent }
        : {}),
      rollbackRetained: journal.rollbackRetained,
      externalPaths: [...journal.externalPaths],
      steps: journal.steps.map((step) => ({
        path: step.path,
        state: step.state,
      })),
      events: journal.events
        .filter((entry) => entry.kind === "intent-prepared")
        .map((entry) => ({ ...entry })),
      ...(replayed ? { replayed: true as const } : {}),
    };
  }

  #outcome(
    journal: TransactionJournal,
    replayed = false,
  ): ApplyTransactionOutcome {
    if (journal.state === "completed" || journal.state === "prepared") {
      return {
        ok: true,
        transactionId: journal.transactionId,
        state: journal.state,
        ...(replayed ? { replayed: true as const } : {}),
      };
    }
    if (journal.state !== "paused" && journal.state !== "discarded") {
      throw new Error("transaction-outcome-nonterminal");
    }
    return {
      ok: false,
      transactionId: journal.transactionId,
      state: journal.state,
      code: journal.code ?? "recovery-required",
      ...(replayed ? { replayed: true as const } : {}),
    };
  }

  #settledOutcome(
    journal: TransactionJournal,
  ): ApplyTransactionOutcome | undefined {
    return journal.state === "completed" ||
      journal.state === "paused" ||
      journal.state === "discarded"
      ? this.#outcome(journal)
      : undefined;
  }

  async prepare(input: PrepareApplyInput): Promise<ApplyTransactionOutcome> {
    requireIdentifier(input.transactionId);
    requireRevisionId(input.baselineRevisionId);
    requireRevisionId(input.finalRevisionId);
    if (!Array.isArray(input.boundPaths) || input.boundPaths.length === 0) {
      throw new Error("transaction-bound-paths-invalid");
    }
    const boundPaths = [...new Set(input.boundPaths)].sort();
    if (boundPaths.length !== input.boundPaths.length) {
      throw new Error("transaction-bound-paths-invalid");
    }
    for (const relative of boundPaths) requireRelative(relative);
    const fact =
      input.verificationFact && typeof input.verificationFact === "object"
        ? verificationFacts.get(input.verificationFact)
        : undefined;
    if (
      !fact ||
      fact.workspaceStore !== this.#workspaces ||
      fact.revisionId !== input.finalRevisionId
    ) {
      throw new Error("verification-fact-invalid");
    }
    const consumerRoot = canonicalConsumerRoot(input.consumerRoot);
    if (isContainedBy(consumerRoot, this.root)) {
      throw new Error("transaction-root-inside-consumer");
    }
    const existing = this.#database
      .prepare(
        "SELECT journal_json, journal_hash FROM apply_transaction_journal WHERE transaction_id = ?",
      )
      .get(input.transactionId) as JournalRow | undefined;
    if (existing) {
      const journal = this.#load(input.transactionId);
      if (
        journal.consumerRoot !== consumerRoot ||
        journal.baselineRevisionId !== input.baselineRevisionId ||
        journal.finalRevisionId !== input.finalRevisionId ||
        journal.verificationId !== fact.verificationId ||
        JSON.stringify(journal.boundPaths) !== JSON.stringify(boundPaths)
      ) {
        throw new Error("transaction-id-conflict");
      }
      return this.#outcome(journal, true);
    }

    const baseline = this.#workspaces.getRevision(input.baselineRevisionId);
    const finalRevision = this.#workspaces.getRevision(input.finalRevisionId);
    if (!isAncestor(this.#workspaces, baseline.revisionId, finalRevision)) {
      throw new Error("workspace-revision-base-invalid");
    }
    for (const relative of boundPaths) {
      const expected = normalizedEntry(baseline.entries[relative]);
      if (!mainMatches(consumerRoot, relative, expected)) {
        return {
          ok: false,
          transactionId: input.transactionId,
          state: "paused",
          code: "main-workspace-stale",
        };
      }
    }
    const steps = boundPaths.map((relative) => ({
      path: relative,
      before: normalizedEntry(baseline.entries[relative]),
      after: normalizedEntry(finalRevision.entries[relative]),
      state: "pending" as const,
    }));
    const retainedHashes = [
      ...new Set(
        steps.flatMap((step) =>
          [step.before, step.after]
            .filter(
              (entry): entry is Extract<WorkspaceEntry, { kind: "file" }> =>
                entry.kind === "file",
            )
            .map((entry) => entry.hash),
        ),
      ),
    ].sort();
    for (const hash of retainedHashes) this.#artifacts.retain(hash);
    const journal: TransactionJournal = {
      version: JOURNAL_VERSION,
      transactionId: input.transactionId,
      consumerRoot,
      baselineRevisionId: baseline.revisionId,
      finalRevisionId: finalRevision.revisionId,
      verificationId: fact.verificationId,
      boundPaths,
      state: "prepared",
      rollbackRetained: true,
      externalPaths: [],
      retainedHashes,
      releasedHashes: [],
      createdDirectories: [],
      steps,
      events: [],
    };
    event(journal, "intent-prepared");
    this.#save(journal);
    return this.#outcome(journal);
  }

  #ensureTargetParents(journal: TransactionJournal, relative: string): string {
    const segments = relative.split("/");
    let parent = journal.consumerRoot;
    const relativeSegments: string[] = [];
    for (const segment of segments.slice(0, -1)) {
      parent = path.join(parent, segment);
      relativeSegments.push(segment);
      const directory = relativeSegments.join("/");
      const stat = lstatSync(parent, { throwIfNoEntry: false });
      if (stat) {
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
          throw new Error("transaction-target-unsafe");
        }
        continue;
      }
      if (!journal.createdDirectories.includes(directory)) {
        journal.createdDirectories.push(directory);
        event(journal, "directory-create-intent", directory);
        this.#save(journal);
      }
      try {
        mkdirSync(parent, { mode: 0o755 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        journal.createdDirectories = journal.createdDirectories.filter(
          (candidate) => candidate !== directory,
        );
        this.#save(journal);
      }
      const created = lstatSync(parent, { throwIfNoEntry: false });
      if (!created?.isDirectory() || created.isSymbolicLink()) {
        throw new Error("transaction-target-unsafe");
      }
      syncDirectory(path.dirname(parent));
      if (journal.createdDirectories.includes(directory)) {
        event(journal, "directory-created", directory);
        this.#save(journal);
      }
    }
    return safeTargetPath(journal.consumerRoot, relative);
  }

  #claimPath(journal: TransactionJournal, step: TransactionStep): string {
    const target = safeTargetPath(journal.consumerRoot, step.path);
    return path.join(
      path.dirname(target),
      `.${path.basename(target)}.${createHash("sha256")
        .update(`${journal.transactionId}\0${step.path}`)
        .digest("hex")
        .slice(0, 24)}.apply-claim`,
    );
  }

  #settleClaim(journal: TransactionJournal, step: TransactionStep): boolean {
    const target = safeTargetPath(journal.consumerRoot, step.path);
    const claim = this.#claimPath(journal, step);
    const claimed = fileEntryAt(claim);
    if (claimed === "absent") return true;
    if (claimed === "unsafe") return false;
    const current = currentEntry(journal.consumerRoot, step.path);
    if (current !== "unsafe" && current.kind === "absent") {
      return restoreClaim(claim, target);
    }
    if (
      current !== "unsafe" &&
      (entryEqual(claimed, step.before) || entryEqual(claimed, step.after))
    ) {
      unlinkSync(claim);
      syncDirectory(path.dirname(target));
      return true;
    }
    return false;
  }

  #applyEntry(
    journal: TransactionJournal,
    step: TransactionStep,
    expected: WorkspaceEntry,
    entry: WorkspaceEntry,
  ): boolean {
    const target = this.#ensureTargetParents(journal, step.path);
    const directory = path.dirname(target);
    const claim = this.#claimPath(journal, step);
    if (lstatSync(claim, { throwIfNoEntry: false })) {
      throw new Error("transaction-claim-unsettled");
    }

    if (expected.kind === "file") {
      try {
        renameSync(target, claim);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
      syncDirectory(directory);
      const claimed = fileEntryAt(claim);
      if (
        claimed === "unsafe" ||
        claimed === "absent" ||
        !entryEqual(claimed, expected)
      ) {
        if (!restoreClaim(claim, target)) {
          throw new Error("transaction-claim-conflict");
        }
        return false;
      }
    } else if (lstatSync(target, { throwIfNoEntry: false })) {
      return false;
    }

    if (entry.kind === "absent") {
      if (expected.kind === "file") {
        unlinkSync(claim);
        syncDirectory(directory);
      }
      return true;
    }
    const bytes = this.#artifacts.read(entry.hash);
    if (bytes.byteLength !== entry.bytes) {
      throw new Error("transaction-artifact-integrity-invalid");
    }
    const installed = writeExclusiveFile(target, bytes, entry.mode);
    if (expected.kind === "file") {
      unlinkSync(claim);
      syncDirectory(directory);
    }
    return installed;
  }

  async #release(journal: TransactionJournal): Promise<void> {
    if (!journal.rollbackRetained) return;
    for (const hash of journal.retainedHashes) {
      if (journal.releasedHashes.includes(hash)) continue;
      this.#artifacts.release(hash);
      journal.releasedHashes.push(hash);
      this.#save(journal);
    }
    journal.rollbackRetained = false;
    this.#save(journal);
  }

  #rollbackCreatedDirectories(
    journal: TransactionJournal,
    external: Set<string>,
  ): void {
    const deepestFirst = [...journal.createdDirectories].sort(
      (left, right) =>
        right.split("/").length - left.split("/").length ||
        right.localeCompare(left),
    );
    for (const relative of deepestFirst) {
      const observation = observeSafePath(journal.consumerRoot, relative);
      if (observation.kind === "absent") continue;
      if (observation.kind !== "directory") {
        external.add(relative);
        continue;
      }
      const target = path.join(journal.consumerRoot, ...relative.split("/"));
      try {
        rmdirSync(target);
      } catch (error) {
        if (
          ["ENOTEMPTY", "EEXIST"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          )
        ) {
          external.add(relative);
          continue;
        }
        throw error;
      }
      syncDirectory(path.dirname(target));
      event(journal, "directory-rolled-back", relative);
      this.#save(journal);
    }
  }

  async #rollback(
    journal: TransactionJournal,
    terminal: {
      state: "paused" | "discarded";
      code: string;
      externalPaths?: string[];
    },
  ): Promise<ApplyTransactionOutcome> {
    journal.state = "recovering";
    event(journal, "rollback-started");
    this.#save(journal);
    const external = new Set(terminal.externalPaths ?? []);
    for (const step of [...journal.steps].reverse()) {
      if (!this.#settleClaim(journal, step)) {
        external.add(step.path);
        continue;
      }
      const current = currentEntry(journal.consumerRoot, step.path);
      if (step.state === "pending") {
        if (current !== "unsafe" && entryEqual(current, step.before)) {
          step.state = "rolled-back";
          this.#save(journal);
        } else {
          external.add(step.path);
        }
        continue;
      }
      if (current !== "unsafe" && entryEqual(current, step.after)) {
        if (!entryEqual(step.before, step.after)) {
          if (!this.#applyEntry(journal, step, step.after, step.before)) {
            external.add(step.path);
            continue;
          }
        }
        step.state = "rolled-back";
        event(journal, "file-rolled-back", step.path);
        this.#save(journal);
      } else if (current !== "unsafe" && entryEqual(current, step.before)) {
        step.state = "rolled-back";
        this.#save(journal);
      } else {
        external.add(step.path);
      }
    }
    this.#rollbackCreatedDirectories(journal, external);
    journal.externalPaths = [...external].sort();
    journal.state = terminal.state;
    journal.code = terminal.code;
    event(journal, "rollback-settled");
    this.#save(journal);
    await this.#release(journal);
    return this.#outcome(journal);
  }

  async #driveForward(
    transactionId: string,
    signal?: AbortSignal,
  ): Promise<ApplyTransactionOutcome> {
    let journal = this.#load(transactionId);
    if (journal.pendingIntent) {
      return this.#rollback(journal, {
        state: journal.pendingIntent === "discard" ? "discarded" : "paused",
        code:
          journal.pendingIntent === "discard"
            ? "run-discarded"
            : "operation-cancelled",
      });
    }
    journal.state = journal.state === "recovering" ? "recovering" : "applying";
    event(journal, "apply-started");
    this.#save(journal);

    for (const [index, originalStep] of journal.steps.entries()) {
      journal = this.#load(transactionId);
      let step = journal.steps[index] as TransactionStep;
      if (journal.pendingIntent || signal?.aborted) {
        journal.pendingIntent ??= "cancel";
        journal.state = "recovering";
        event(journal, "control-pending");
        this.#save(journal);
        return this.#rollback(journal, {
          state: journal.pendingIntent === "discard" ? "discarded" : "paused",
          code:
            journal.pendingIntent === "discard"
              ? "run-discarded"
              : "operation-cancelled",
        });
      }
      if (!this.#settleClaim(journal, step)) {
        return this.#rollback(journal, {
          state: "paused",
          code: "recovery-required",
          externalPaths: [step.path],
        });
      }
      const current = currentEntry(journal.consumerRoot, step.path);
      if (step.state === "applied") {
        if (current === "unsafe" || !entryEqual(current, step.after)) {
          return this.#rollback(journal, {
            state: "paused",
            code: "recovery-required",
            externalPaths: [step.path],
          });
        }
        continue;
      }
      if (
        step.state === "applying" &&
        current !== "unsafe" &&
        entryEqual(current, step.after)
      ) {
        step.state = "applied";
        event(journal, "file-apply-recovered", step.path);
        this.#save(journal);
        continue;
      }
      if (current === "unsafe" || !entryEqual(current, step.before)) {
        return this.#rollback(journal, {
          state: "paused",
          code: "recovery-required",
          externalPaths: [step.path],
        });
      }

      if (entryEqual(step.before, step.after)) {
        step.state = "applied";
        event(journal, "bound-path-checked", step.path);
        this.#save(journal);
        continue;
      }

      step.state = "applying";
      event(journal, "file-step-started", step.path);
      this.#save(journal);
      await this.#hooks.beforeFileMutation?.({
        transactionId,
        path: originalStep.path,
        index,
      });
      journal = this.#load(transactionId);
      step = journal.steps[index] as TransactionStep;
      if (journal.pendingIntent || signal?.aborted) {
        journal.pendingIntent ??= "cancel";
        this.#save(journal);
        return this.#rollback(journal, {
          state: journal.pendingIntent === "discard" ? "discarded" : "paused",
          code:
            journal.pendingIntent === "discard"
              ? "run-discarded"
              : "operation-cancelled",
        });
      }
      if (!this.#applyEntry(journal, step, step.before, step.after)) {
        return this.#rollback(journal, {
          state: "paused",
          code: "recovery-required",
          externalPaths: [step.path],
        });
      }
      await this.#hooks.afterFileMutationBeforeSave?.({
        transactionId,
        path: originalStep.path,
        index,
      });
      journal = this.#load(transactionId);
      step = journal.steps[index] as TransactionStep;
      step.state = "applied";
      event(journal, "file-applied", step.path);
      this.#save(journal);
      try {
        await this.#hooks.afterFileMutation?.({
          transactionId,
          path: originalStep.path,
          index,
        });
      } catch (error) {
        journal = this.#load(transactionId);
        const settled = this.#settledOutcome(journal);
        if (settled) return settled;
        if (!journal.pendingIntent && !signal?.aborted) throw error;
      }
      journal = this.#load(transactionId);
      const settled = this.#settledOutcome(journal);
      if (settled) return settled;
      if (journal.pendingIntent || signal?.aborted) {
        journal.pendingIntent ??= "cancel";
        journal.state = "recovering";
        event(journal, "control-pending");
        this.#save(journal);
        return this.#rollback(journal, {
          state: journal.pendingIntent === "discard" ? "discarded" : "paused",
          code:
            journal.pendingIntent === "discard"
              ? "run-discarded"
              : "operation-cancelled",
        });
      }
      const appliedStep = journal.steps[index] as TransactionStep;
      if (
        !mainMatches(journal.consumerRoot, appliedStep.path, appliedStep.after)
      ) {
        return this.#rollback(journal, {
          state: "paused",
          code: "recovery-required",
          externalPaths: [appliedStep.path],
        });
      }
    }

    journal = this.#load(transactionId);
    const external = journal.steps
      .filter(
        (step) => !mainMatches(journal.consumerRoot, step.path, step.after),
      )
      .map((step) => step.path);
    if (external.length > 0) {
      return this.#rollback(journal, {
        state: "paused",
        code: "recovery-required",
        externalPaths: external,
      });
    }
    let postApply: { ok: true } | { ok: false; code: string } | undefined;
    try {
      if (this.#hooks.postApply) {
        const isolatedRoot = mkdtempSync(
          path.join(this.root, "post-apply-verification-"),
        );
        try {
          this.#workspaces.materialize(journal.finalRevisionId, isolatedRoot);
          const execution = Promise.resolve(
            this.#hooks.postApply({
              transactionId,
              root: isolatedRoot,
              signal: signal ?? new AbortController().signal,
            }),
          );
          void execution.catch(() => undefined);
          postApply = signal
            ? await raceWithAbort(execution, signal)
            : await execution;
        } finally {
          rmSync(isolatedRoot, { recursive: true, force: true });
        }
      }
    } catch (error) {
      journal = this.#load(transactionId);
      const settled = this.#settledOutcome(journal);
      if (settled) return settled;
      if (!journal.pendingIntent && !signal?.aborted) throw error;
    }
    journal = this.#load(transactionId);
    const settled = this.#settledOutcome(journal);
    if (settled) return settled;
    if (journal.pendingIntent || signal?.aborted) {
      journal.pendingIntent ??= "cancel";
      journal.state = "recovering";
      event(journal, "control-pending");
      this.#save(journal);
      return this.#rollback(journal, {
        state: journal.pendingIntent === "discard" ? "discarded" : "paused",
        code:
          journal.pendingIntent === "discard"
            ? "run-discarded"
            : "operation-cancelled",
      });
    }
    const postApplyExternal = journal.steps
      .filter(
        (step) => !mainMatches(journal.consumerRoot, step.path, step.after),
      )
      .map((step) => step.path);
    if (postApplyExternal.length > 0) {
      return this.#rollback(journal, {
        state: "paused",
        code: "recovery-required",
        externalPaths: postApplyExternal,
      });
    }
    if (postApply && !postApply.ok) {
      return this.#rollback(journal, {
        state: "paused",
        code: postApply.code,
      });
    }
    journal.state = "completed";
    delete journal.code;
    event(journal, "transaction-completed");
    this.#save(journal);
    await this.#release(journal);
    return this.#outcome(journal);
  }

  async apply(
    transactionId: string,
    signal?: AbortSignal,
  ): Promise<ApplyTransactionOutcome> {
    const journal = this.#load(transactionId);
    if (journal.state === "completed") {
      if (journal.rollbackRetained) await this.#release(journal);
      return this.#outcome(journal, true);
    }
    if (journal.state === "paused" || journal.state === "discarded") {
      return this.#outcome(journal, true);
    }
    try {
      return await this.#drive(transactionId, signal);
    } catch (error) {
      const interrupted = this.#load(transactionId);
      if (
        interrupted.state !== "completed" &&
        interrupted.state !== "paused" &&
        interrupted.state !== "discarded"
      ) {
        interrupted.state = "recovering";
        event(interrupted, "apply-interrupted");
        this.#save(interrupted);
      }
      throw error;
    }
  }

  async recover(transactionId: string): Promise<ApplyTransactionOutcome> {
    const journal = this.#load(transactionId);
    if (
      journal.state === "completed" ||
      journal.state === "paused" ||
      journal.state === "discarded"
    ) {
      if (journal.rollbackRetained) await this.#release(journal);
      return this.#outcome(journal, true);
    }
    return this.#drive(transactionId);
  }

  #drive(
    transactionId: string,
    parentSignal?: AbortSignal,
  ): Promise<ApplyTransactionOutcome> {
    const existing = this.#active.get(transactionId);
    if (existing) return existing.promise;
    const controller = new AbortController();
    const forwardAbort = () => {
      if (!controller.signal.aborted) {
        controller.abort(
          parentSignal?.reason ?? new Error("operation-cancelled"),
        );
      }
    };
    if (parentSignal?.aborted) forwardAbort();
    else parentSignal?.addEventListener("abort", forwardAbort, { once: true });
    let active!: {
      controller: AbortController;
      promise: Promise<ApplyTransactionOutcome>;
    };
    const promise = this.#driveForward(
      transactionId,
      controller.signal,
    ).finally(() => {
      parentSignal?.removeEventListener("abort", forwardAbort);
      if (this.#active.get(transactionId) === active) {
        this.#active.delete(transactionId);
      }
    });
    active = { controller, promise };
    this.#active.set(transactionId, active);
    return active.promise;
  }

  requestControl(transactionId: string, intent: PendingIntent) {
    if (intent !== "cancel" && intent !== "discard") {
      throw new Error("transaction-control-invalid");
    }
    const journal = this.#load(transactionId);
    if (journal.state === "completed" || journal.state === "discarded") {
      return this.#project(journal, true);
    }
    journal.pendingIntent = intent;
    journal.state = "recovering";
    event(journal, "control-pending");
    this.#save(journal);
    const active = this.#active.get(transactionId);
    if (active && !active.controller.signal.aborted) {
      active.controller.abort(
        new Error(
          intent === "discard" ? "run-discarded" : "operation-cancelled",
        ),
      );
    }
    return this.#project(journal);
  }

  status(transactionId: string) {
    return this.#project(this.#load(transactionId));
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#database.close();
  }

  [Symbol.dispose](): void {
    this.close();
  }
}
