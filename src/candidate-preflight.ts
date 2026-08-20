import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  diffWritePaths,
  isValidRelativePath,
  type VerificationContract,
  validateVerificationContract,
} from "./contracts.ts";
import {
  type Bound,
  type DirBound,
  type FileBound,
  isCurrent,
  snapshotDirManifest,
} from "./file-snapshot.ts";

export type { VerificationContract } from "./contracts.ts";

export interface BaselineEntry {
  path: string;
  kind: "file" | "deleted";
  sha256?: string;
  bytes?: number;
  executable?: boolean;
}

export interface CandidatePreflightInput {
  root: string;
  diff: Buffer;
  writeSet: string[];
  snapshot: Bound;
  baseline: BaselineEntry[];
  verification: VerificationContract;
  packageManifest: FileBound;
  lockfile: FileBound;
  dependencyTarget: FileBound | DirBound;
  signal?: AbortSignal;
}

export type CandidatePreflightResult =
  | {
      ok: true;
      classification: VerificationContract["classification"];
      targets: string[];
      commandId: string;
      exitCode: number;
      testCount: number;
      identityMatch: boolean;
      checkoutRemoved: true;
    }
  | {
      ok: false;
      class: "artifact" | "design" | "environment" | "stale" | "cancelled";
      code: string;
      commandId?: string;
      exitCode?: number;
      testCount?: number;
      identityMatch?: boolean;
      checkoutRemoved: boolean;
      excerpt?: string;
    };

export interface CandidatePreflightDependencies {
  mkdtemp: typeof mkdtempSync;
  remove: typeof rmSync;
  spawn: (
    command: string,
    args: string[],
    options: CommandOptions,
  ) => CommandResult | Promise<CommandResult>;
  realpath: typeof realpathSync;
  bwrapPath: string;
}

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

interface CommandOptions {
  cwd: string;
  shell: false;
  encoding: "utf8";
  maxBuffer: number;
  timeout: number;
  input?: Buffer;
  signal?: AbortSignal;
}

interface FailureDetails {
  commandId?: string;
  exitCode?: number;
  testCount?: number;
  identityMatch?: boolean;
  excerpt?: string;
}

class PreflightFailure extends Error {
  constructor(
    readonly failureClass:
      | "artifact"
      | "design"
      | "environment"
      | "stale"
      | "cancelled",
    readonly code: string,
    readonly details: FailureDetails = {},
  ) {
    super(code);
  }
}

const SHA256 = /^[0-9a-f]{64}$/;
const LOCKFILES = [
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
] as const;
const LOAD_FAILURE =
  /(?:syntaxerror|parse error|failed to load|cannot find (?:module|package)|no test files|tests?\s+no tests|error ts\d+)/iu;
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const SANDBOX_BUN_TARGET = "/usr/bin/bun";
const SANDBOX_REPORT_TARGET = "/tmp/cadence-verification-report.json";
const MAX_REPORT_BYTES = 2 * 1024 * 1024;

const defaultDependencies: CandidatePreflightDependencies = {
  mkdtemp: mkdtempSync,
  remove: rmSync,
  spawn: spawnCommand,
  realpath: realpathSync,
  bwrapPath: "/usr/bin/bwrap",
};

function spawnCommand(
  command: string,
  args: string[],
  options: CommandOptions,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let buffered = 0;
    let commandError: Error | undefined;
    let settled = false;
    let child: ChildProcessWithoutNullStreams;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (status: number | null) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve({
        status,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        ...(commandError ? { error: commandError } : {}),
      });
    };
    const collect = (target: Buffer[], chunk: Buffer) => {
      buffered += chunk.length;
      if (buffered > options.maxBuffer) {
        commandError ??= new Error("preflight command output exceeded limit");
        child.kill("SIGKILL");
        return;
      }
      target.push(chunk);
    };
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        ...(options.signal ? { signal: options.signal } : {}),
      }) as ChildProcessWithoutNullStreams;
    } catch (error) {
      commandError = error as Error;
      resolve({ status: null, stdout: "", stderr: "", error: commandError });
      return;
    }
    timeout = setTimeout(() => {
      commandError ??= new Error("preflight command timed out");
      child.kill("SIGKILL");
    }, options.timeout);
    timeout.unref();
    child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
    child.on("error", (error) => {
      commandError ??= error;
    });
    child.on("close", (status) => finish(status));
    child.stdin.on("error", () => undefined);
    child.stdin.end(options.input);
  });
}

function reject(
  failureClass: PreflightFailure["failureClass"],
  code: string,
  details: FailureDetails = {},
): never {
  throw new PreflightFailure(failureClass, code, details);
}

function failed(
  failureClass: PreflightFailure["failureClass"],
  code: string,
  details: FailureDetails = {},
  checkoutRemoved = true,
): CandidatePreflightResult {
  return {
    ok: false,
    class: failureClass,
    code,
    ...details,
    checkoutRemoved,
  };
}

function removeCheckout(
  temp: string,
  dependencies: CandidatePreflightDependencies,
): { failed: boolean; removed: boolean } {
  let cleanupFailed = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      dependencies.remove(temp, { recursive: true, force: true });
    } catch {
      cleanupFailed = true;
    }
    let removed = false;
    try {
      removed = lstatSync(temp, { throwIfNoEntry: false }) === undefined;
    } catch {
      cleanupFailed = true;
    }
    if (removed) return { failed: cleanupFailed, removed: true };
    cleanupFailed = true;
  }
  return { failed: true, removed: false };
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function safePath(root: string, relative: string): string {
  if (
    !isValidRelativePath(relative) ||
    relative.trim() !== relative ||
    /[\r\n\t]/u.test(relative)
  ) {
    reject("artifact", "noncanonical-path");
  }
  const absolute = path.resolve(root, relative);
  if (absolute === root || !absolute.startsWith(`${root}${path.sep}`)) {
    reject("artifact", "escaping-path");
  }
  return absolute;
}

function sameDirBound(actual: DirBound | null, expected: DirBound): boolean {
  return (
    actual !== null &&
    actual.kind === "dir" &&
    actual.manifest === expected.manifest
  );
}

function validSnapshot(snapshot: Bound): boolean {
  if (
    snapshot === null ||
    typeof snapshot !== "object" ||
    Array.isArray(snapshot)
  ) {
    return false;
  }
  for (const [relative, value] of Object.entries(snapshot)) {
    if (!isValidRelativePath(relative) || !value || typeof value !== "object")
      return false;
    if (value.kind === "file") {
      if (
        !SHA256.test(value.sha256) ||
        !Number.isSafeInteger(value.bytes) ||
        value.bytes < 0
      )
        return false;
    } else if (value.kind === "dir") {
      if (!SHA256.test(value.manifest)) return false;
    } else if (value.kind === "absent") {
      if (value.absent !== true) return false;
    } else {
      return false;
    }
  }
  return true;
}

async function run(
  dependencies: CandidatePreflightDependencies,
  cwd: string,
  command: string,
  args: string[],
  input?: Buffer,
  signal?: AbortSignal,
): Promise<CommandResult> {
  const options: CommandOptions = {
    cwd,
    shell: false,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
    timeout: COMMAND_TIMEOUT_MS,
    ...(input === undefined ? {} : { input }),
    ...(signal === undefined ? {} : { signal }),
  };
  try {
    const result = await dependencies.spawn(command, args, options);
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      ...(result.error === undefined ? {} : { error: result.error }),
    };
  } catch (error) {
    return {
      status: null,
      stdout: "",
      stderr: "",
      error: error as Error,
    };
  }
}

function commandExcerpt(
  result: Pick<CommandResult, "stdout" | "stderr">,
  secrets: string[],
): string {
  let text = `${result.stdout}\n${result.stderr}`;
  for (const secret of secrets) {
    if (secret) text = text.replaceAll(secret, "<path>");
  }
  return [...text]
    .map((character) =>
      character === "\n" ||
      ((character.codePointAt(0) ?? 0) >= 0x20 &&
        (character.codePointAt(0) ?? 0) <= 0x7e)
        ? character
        : "?",
    )
    .join("")
    .slice(-1024);
}

function requireCurrentHost(input: CandidatePreflightInput): void {
  if (!isCurrent(input.root, input.snapshot)) reject("stale", "stale-snapshot");
}

function validateInput(input: CandidatePreflightInput): {
  targets: string[];
  lockPath: string;
  dependencyPath: string;
} {
  if (!Buffer.isBuffer(input.diff) || input.diff.length === 0)
    reject("artifact", "invalid-diff-bytes");
  if (!validSnapshot(input.snapshot)) reject("artifact", "invalid-snapshot");
  const verification = validateVerificationContract(input.verification);
  if (!verification.ok) reject("artifact", "invalid-verification-contract");

  let targets: string[];
  try {
    targets = diffWritePaths(input.diff.toString("utf8")).paths;
  } catch (error) {
    reject("artifact", "invalid-diff", {
      excerpt: String((error as Error).message).slice(0, 256),
    });
  }

  const writeSet = [...new Set(input.writeSet)];
  if (
    writeSet.length !== input.writeSet.length ||
    writeSet.some((relative) => !isValidRelativePath(relative)) ||
    targets.some((target) => !writeSet.includes(target))
  ) {
    reject("artifact", "write-set-mismatch");
  }

  const packageBound = input.snapshot["package.json"];
  if (
    packageBound?.kind !== "file" ||
    packageBound.sha256 !== input.packageManifest.sha256 ||
    packageBound.bytes !== input.packageManifest.bytes
  ) {
    reject("artifact", "package-bound-mismatch");
  }
  const lockPath = LOCKFILES.find((candidate) => {
    const bound = input.snapshot[candidate];
    return (
      bound?.kind === "file" &&
      bound.sha256 === input.lockfile.sha256 &&
      bound.bytes === input.lockfile.bytes
    );
  });
  if (!lockPath) reject("artifact", "lockfile-bound-mismatch");

  const dependencyPath = "node_modules";
  const dependencyBound = input.snapshot[dependencyPath];
  if (
    !dependencyBound ||
    dependencyBound.kind !== input.dependencyTarget.kind ||
    (dependencyBound.kind === "file" &&
      input.dependencyTarget.kind === "file" &&
      (dependencyBound.sha256 !== input.dependencyTarget.sha256 ||
        dependencyBound.bytes !== input.dependencyTarget.bytes)) ||
    (dependencyBound.kind === "dir" &&
      input.dependencyTarget.kind === "dir" &&
      dependencyBound.manifest !== input.dependencyTarget.manifest)
  ) {
    reject("artifact", "dependency-bound-mismatch");
  }

  const entries = new Map<string, BaselineEntry>();
  for (const entry of input.baseline) {
    if (!entry || !isValidRelativePath(entry.path) || entries.has(entry.path)) {
      reject("artifact", "baseline-shape");
    }
    if (entry.kind === "file") {
      if (
        !SHA256.test(entry.sha256 ?? "") ||
        !Number.isSafeInteger(entry.bytes) ||
        (entry.bytes ?? -1) < 0 ||
        typeof entry.executable !== "boolean"
      ) {
        reject("artifact", "baseline-shape");
      }
      const bound = input.snapshot[entry.path];
      if (
        bound?.kind !== "file" ||
        bound.sha256 !== entry.sha256 ||
        bound.bytes !== entry.bytes
      ) {
        reject("artifact", "baseline-bound-mismatch");
      }
    } else if (
      entry.kind !== "deleted" ||
      entry.sha256 !== undefined ||
      entry.bytes !== undefined ||
      entry.executable !== undefined ||
      input.snapshot[entry.path]?.kind !== "absent"
    ) {
      reject("artifact", "baseline-shape");
    }
    entries.set(entry.path, entry);
  }
  for (const [relative, bound] of Object.entries(input.snapshot)) {
    if (
      (bound.kind === "file" || bound.kind === "absent") &&
      !entries.has(relative)
    ) {
      reject("artifact", "incomplete-baseline");
    }
  }
  if (targets.some((target) => !entries.has(target)))
    reject("artifact", "target-baseline-missing");
  for (const testPath of input.verification.argv.slice(3)) {
    if (!entries.has(testPath))
      reject("artifact", "verification-baseline-missing");
  }
  return { targets, lockPath, dependencyPath };
}

function verifyBaselineAt(root: string, baseline: BaselineEntry[]): void {
  for (const entry of baseline) {
    const absolute = safePath(root, entry.path);
    const stat = lstatSync(absolute, { throwIfNoEntry: false });
    if (entry.kind === "deleted") {
      if (stat) reject("stale", "baseline-deletion-drift");
      continue;
    }
    if (!stat?.isFile() || stat.isSymbolicLink())
      reject("artifact", "baseline-file-kind");
    const bytes = readFileSync(absolute);
    if (
      bytes.length !== entry.bytes ||
      sha256(bytes) !== entry.sha256 ||
      Boolean(stat.mode & 0o111) !== entry.executable
    ) {
      reject("stale", "baseline-file-drift");
    }
  }
}

function scanCheckout(checkout: string): void {
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (directory === checkout && entry.name === ".git") continue;
      const absolute = path.join(directory, entry.name);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) reject("artifact", "checkout-symlink");
      if (stat.isDirectory()) visit(absolute);
      else if (!stat.isFile()) reject("artifact", "checkout-special-file");
    }
  };
  visit(checkout);
}

function resolveBunExecutable(
  dependencies: CandidatePreflightDependencies,
): string {
  const candidates = [
    ...(process.versions.bun ? [process.execPath] : []),
    ...(process.env.PATH ?? "")
      .split(path.delimiter)
      .filter(Boolean)
      .map((entry) => path.join(entry, "bun")),
  ];
  for (const candidate of candidates) {
    try {
      const executable = dependencies.realpath(candidate);
      const stat = lstatSync(executable);
      if (stat.isFile() && (stat.mode & 0o111) !== 0) return executable;
    } catch {}
  }
  reject("environment", "bun-executable-unavailable");
}

async function requireRegularGitModes(
  dependencies: CandidatePreflightDependencies,
  checkout: string,
  signal?: AbortSignal,
): Promise<void> {
  const result = await run(
    dependencies,
    checkout,
    "git",
    ["ls-files", "--stage", "-z"],
    undefined,
    signal,
  );
  if (signal?.aborted) reject("cancelled", "cancelled");
  if (result.error || result.status !== 0)
    reject("environment", "git-index-unavailable");
  for (const record of result.stdout.split("\0").filter(Boolean)) {
    const mode = record.slice(0, 6);
    if (mode !== "100644" && mode !== "100755")
      reject("artifact", mode === "160000" ? "submodule" : "nonregular-mode");
  }
}

function reconstructBaseline(
  input: CandidatePreflightInput,
  checkout: string,
): void {
  for (const entry of input.baseline) {
    const source = safePath(input.root, entry.path);
    const target = safePath(checkout, entry.path);
    if (entry.kind === "deleted") {
      const stat = lstatSync(target, { throwIfNoEntry: false });
      if (stat?.isDirectory()) reject("artifact", "baseline-deletion-kind");
      rmSync(target, { force: true });
      continue;
    }
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
    const stat = lstatSync(target);
    const mode = entry.executable ? 0o755 : 0o644;
    if ((stat.mode & 0o777) !== mode) {
      chmodSync(target, mode);
    }
  }
  verifyBaselineAt(checkout, input.baseline);
}

function copySafeDirectory(source: string, target: string): void {
  const directory = lstatSync(source, { throwIfNoEntry: false });
  if (!directory?.isDirectory() || directory.isSymbolicLink())
    reject("artifact", "baseline-directory-kind");
  mkdirSync(target, { recursive: true });
  chmodSync(target, directory.mode & 0o777);
  for (const name of readdirSync(source).sort()) {
    const sourceEntry = path.join(source, name);
    const targetEntry = path.join(target, name);
    const stat = lstatSync(sourceEntry);
    if (stat.isSymbolicLink()) reject("artifact", "baseline-directory-symlink");
    if (stat.isDirectory()) {
      copySafeDirectory(sourceEntry, targetEntry);
      continue;
    }
    if (!stat.isFile()) reject("artifact", "baseline-directory-special-file");
    copyFileSync(sourceEntry, targetEntry);
    chmodSync(targetEntry, stat.mode & 0o777);
  }
}

function reconstructBoundDirectories(
  input: CandidatePreflightInput,
  checkout: string,
  dependencyPath: string,
): void {
  const directories = Object.entries(input.snapshot)
    .filter(
      (entry): entry is [string, DirBound] =>
        entry[1].kind === "dir" && entry[0] !== dependencyPath,
    )
    .sort(([left], [right]) => left.localeCompare(right));
  const roots = directories.filter(
    ([relative], index) =>
      !directories.some(
        ([parent], parentIndex) =>
          parentIndex !== index && relative.startsWith(`${parent}/`),
      ),
  );
  for (const [relative, expected] of roots) {
    const source = safePath(input.root, relative);
    const target = safePath(checkout, relative);
    rmSync(target, { recursive: true, force: true });
    copySafeDirectory(source, target);
    if (!sameDirBound(snapshotDirManifest(checkout, relative), expected)) {
      if (!sameDirBound(snapshotDirManifest(input.root, relative), expected))
        reject("stale", "baseline-directory-drift");
      reject("artifact", "baseline-directory-mismatch");
    }
  }
}

function sandboxArgs(
  checkout: string,
  dependencySource: string,
  dependencyIsDirectory: boolean,
  bunExecutable: string,
  invocation: string[],
  reportSource?: string,
): string[] {
  const candidate = "/candidate";
  const args = [
    "--unshare-net",
    "--unshare-pid",
    "--die-with-parent",
    "--new-session",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/tmp",
    "--clearenv",
    "--setenv",
    "PATH",
    "/usr/bin:/usr/local/bin:/bin",
    "--setenv",
    "HOME",
    "/nonexistent",
    "--setenv",
    "CI",
    "1",
  ];
  for (const systemPath of ["/usr", "/bin", "/lib", "/lib64", "/etc"]) {
    if (existsSync(systemPath)) args.push("--ro-bind", systemPath, systemPath);
  }
  args.push("--ro-bind", bunExecutable, SANDBOX_BUN_TARGET);
  const dependencyDestination = path.posix.join(candidate, "node_modules");
  const localDependency = path.join(checkout, "node_modules");
  rmSync(localDependency, { recursive: true, force: true });
  if (dependencyIsDirectory) {
    mkdirSync(localDependency, { recursive: true });
  } else {
    writeFileSync(localDependency, "");
  }
  args.push(
    "--dir",
    candidate,
    "--bind",
    checkout,
    candidate,
    "--ro-bind",
    dependencySource,
    dependencyDestination,
    ...(reportSource ? ["--bind", reportSource, SANDBOX_REPORT_TARGET] : []),
    "--chdir",
    candidate,
    "--",
    ...invocation,
  );
  return args;
}

interface StructuredTestReport {
  total: number;
  failed: number;
  success: boolean;
  failedAssertions: string[];
  fileErrors: string[];
}

function structuredTestReport(reportPath: string): StructuredTestReport {
  const stat = lstatSync(reportPath, { throwIfNoEntry: false });
  if (
    !stat?.isFile() ||
    stat.isSymbolicLink() ||
    stat.size === 0 ||
    stat.size > MAX_REPORT_BYTES
  ) {
    reject("artifact", "verification-report-missing");
  }
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch {
    reject("artifact", "verification-report-invalid");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    reject("artifact", "verification-report-invalid");
  const report = value as Record<string, unknown>;
  const total = report.numTotalTests;
  const failed = report.numFailedTests;
  if (
    !Number.isSafeInteger(total) ||
    (total as number) < 0 ||
    !Number.isSafeInteger(failed) ||
    (failed as number) < 0 ||
    (failed as number) > (total as number) ||
    typeof report.success !== "boolean" ||
    !Array.isArray(report.testResults)
  ) {
    reject("artifact", "verification-report-invalid");
  }
  const failedAssertions: string[] = [];
  const fileErrors: string[] = [];
  let failedRecords = 0;
  for (const file of report.testResults) {
    if (!file || typeof file !== "object" || Array.isArray(file))
      reject("artifact", "verification-report-invalid");
    const fileRecord = file as Record<string, unknown>;
    const assertions = fileRecord.assertionResults;
    if (!Array.isArray(assertions) || typeof fileRecord.message !== "string")
      reject("artifact", "verification-report-invalid");
    if (fileRecord.message) fileErrors.push(fileRecord.message);
    for (const assertion of assertions) {
      if (
        !assertion ||
        typeof assertion !== "object" ||
        Array.isArray(assertion)
      )
        reject("artifact", "verification-report-invalid");
      const record = assertion as Record<string, unknown>;
      if (record.status !== "failed") continue;
      if (
        typeof record.fullName !== "string" ||
        typeof record.title !== "string" ||
        !Array.isArray(record.failureMessages) ||
        record.failureMessages.some((message) => typeof message !== "string")
      ) {
        reject("artifact", "verification-report-invalid");
      }
      failedRecords++;
      failedAssertions.push(
        record.fullName,
        record.title,
        ...(record.failureMessages as string[]),
      );
    }
  }
  if (failedRecords !== failed)
    reject("artifact", "verification-report-invalid");
  return {
    total: total as number,
    failed: failed as number,
    success: report.success,
    failedAssertions,
    fileErrors,
  };
}

function normalizeTarget(
  input: CandidatePreflightInput,
  result: CommandResult,
  secrets: string[],
  report?: StructuredTestReport,
): CandidatePreflightResult {
  const staticCheck = isStaticCheck(input.verification);
  const output = `${result.stdout}\n${result.stderr}`;
  const count = staticCheck ? 0 : (report?.total ?? 0);
  const identityMatch =
    input.verification.classification !== "expected-red" ||
    (staticCheck
      ? output.includes(input.verification.expectedFailure ?? "")
      : (report?.failedAssertions.some((failure) =>
          failure.includes(input.verification.expectedFailure ?? ""),
        ) ?? false));
  const loadable =
    staticCheck ||
    ((report?.fileErrors.length ?? 0) === 0 && !LOAD_FAILURE.test(output));
  const enoughTests = staticCheck || count >= input.verification.minTests;
  const accepted =
    input.verification.classification === "expected-red"
      ? result.status !== 0 &&
        (staticCheck || (report?.failed ?? 0) > 0) &&
        enoughTests &&
        identityMatch &&
        loadable
      : result.status === 0 &&
        (staticCheck || report?.success === true) &&
        enoughTests &&
        loadable;
  const details = {
    commandId: input.verification.id,
    exitCode: result.status ?? 1,
    testCount: count,
    identityMatch,
  };
  if (
    input.verification.classification === "expected-red" &&
    result.status === 0 &&
    enoughTests &&
    loadable
  ) {
    return failed("design", "red-contract-invalid", {
      ...details,
      excerpt: commandExcerpt(result, secrets),
    });
  }
  if (!accepted) {
    return failed("artifact", "verification-rejected", {
      ...details,
      excerpt: commandExcerpt(result, secrets),
    });
  }
  return {
    ok: true,
    classification: input.verification.classification,
    targets: [],
    ...details,
    checkoutRemoved: true,
  };
}

function isStaticCheck(verification: VerificationContract): boolean {
  return (
    verification.argv.length === 3 &&
    verification.argv[0] === "bun" &&
    verification.argv[1] === "run" &&
    verification.argv[2] === "check"
  );
}

function resolveDependencySource(
  dependencies: CandidatePreflightDependencies,
  root: string,
  dependencyPath: string,
): string {
  const unresolved = safePath(root, dependencyPath);
  let stat: ReturnType<typeof lstatSync> | undefined;
  try {
    stat = lstatSync(unresolved, { throwIfNoEntry: false });
  } catch {
    reject("environment", "dependency-path-unsafe");
  }
  if (!stat || stat.isSymbolicLink())
    reject("environment", "dependency-path-unsafe");
  let canonical: string;
  try {
    canonical = dependencies.realpath(unresolved);
  } catch {
    reject("environment", "dependency-path-unsafe");
  }
  if (canonical === root || !canonical.startsWith(`${root}${path.sep}`))
    reject("environment", "dependency-path-unsafe");
  return canonical;
}

export async function preflightCandidate(
  input: CandidatePreflightInput,
  dependencies: CandidatePreflightDependencies = defaultDependencies,
): Promise<CandidatePreflightResult> {
  let temp: string | undefined;
  let checkout: string | undefined;
  let targets: string[] = [];
  let outcome: CandidatePreflightResult;
  try {
    if (input.signal?.aborted) reject("cancelled", "cancelled");
    if (!validSnapshot(input.snapshot)) reject("artifact", "invalid-snapshot");
    requireCurrentHost(input);
    const validated = validateInput(input);
    targets = validated.targets;
    verifyBaselineAt(input.root, input.baseline);

    let root: string;
    try {
      root = dependencies.realpath(input.root);
    } catch {
      reject("environment", "root-unavailable");
    }
    const dependencySource = resolveDependencySource(
      dependencies,
      root,
      validated.dependencyPath,
    );
    const prefix = path.join(
      path.dirname(root),
      `.${path.basename(root)}-candidate-`,
    );
    temp = dependencies.mkdtemp(prefix);
    checkout = path.join(temp, "candidate");

    const bundle = path.join(temp, "source.bundle");
    const transportLockdown = [
      "-c",
      "protocol.allow=never",
      "-c",
      "protocol.file.allow=never",
      "-c",
      "protocol.ext.allow=never",
    ];
    let result = await run(
      dependencies,
      root,
      "git",
      [...transportLockdown, "bundle", "create", bundle, "HEAD"],
      undefined,
      input.signal,
    );
    if (input.signal?.aborted) reject("cancelled", "cancelled");
    if (result.error || result.status !== 0)
      reject("environment", "clone-failed");
    result = await run(
      dependencies,
      temp,
      "git",
      ["init", "-q", checkout],
      undefined,
      input.signal,
    );
    if (input.signal?.aborted) reject("cancelled", "cancelled");
    if (result.error || result.status !== 0)
      reject("environment", "clone-failed");
    result = await run(
      dependencies,
      checkout,
      "git",
      [
        ...transportLockdown,
        "-c",
        "protocol.file.allow=always",
        "fetch",
        "-q",
        "--no-tags",
        "--no-recurse-submodules",
        bundle,
        "HEAD",
      ],
      undefined,
      input.signal,
    );
    if (input.signal?.aborted) reject("cancelled", "cancelled");
    if (result.error || result.status !== 0)
      reject("environment", "clone-failed");
    result = await run(
      dependencies,
      checkout,
      "git",
      ["checkout", "-q", "--detach", "FETCH_HEAD"],
      undefined,
      input.signal,
    );
    if (input.signal?.aborted) reject("cancelled", "cancelled");
    if (result.error || result.status !== 0)
      reject("environment", "checkout-failed");
    if (
      existsSync(path.join(checkout, ".git", "objects", "info", "alternates"))
    ) {
      reject("environment", "clone-alternates");
    }

    await requireRegularGitModes(dependencies, checkout, input.signal);
    scanCheckout(checkout);
    for (const entry of input.baseline) {
      const ignored = await run(
        dependencies,
        root,
        "git",
        ["check-ignore", "-q", "--", entry.path],
        undefined,
        input.signal,
      );
      if (input.signal?.aborted) reject("cancelled", "cancelled");
      if (ignored.error || ignored.status === null || ignored.status > 1)
        reject("environment", "git-ignore-check-failed");
      if (ignored.status === 0) reject("artifact", "ignored-baseline-input");
    }
    reconstructBoundDirectories(input, checkout, validated.dependencyPath);
    reconstructBaseline(input, checkout);
    scanCheckout(checkout);

    result = await run(
      dependencies,
      checkout,
      "git",
      ["apply", "--check", "--recount", "--whitespace=nowarn", "-"],
      input.diff,
      input.signal,
    );
    if (input.signal?.aborted) reject("cancelled", "cancelled");
    if (result.error) reject("environment", "git-apply-check-unavailable");
    if (result.status !== 0)
      reject("artifact", "git-apply-check-failed", {
        excerpt: commandExcerpt(result, [root, checkout]),
      });
    result = await run(
      dependencies,
      checkout,
      "git",
      ["apply", "--recount", "--whitespace=nowarn", "-"],
      input.diff,
      input.signal,
    );
    if (input.signal?.aborted) reject("cancelled", "cancelled");
    if (result.error) reject("environment", "git-apply-unavailable");
    if (result.status !== 0) reject("artifact", "git-apply-failed");
    await requireRegularGitModes(dependencies, checkout, input.signal);
    scanCheckout(checkout);

    for (const testPath of input.verification.argv.slice(3)) {
      const stat = lstatSync(safePath(checkout, testPath), {
        throwIfNoEntry: false,
      });
      if (!stat?.isFile() || stat.isSymbolicLink())
        reject("artifact", "verification-input-unavailable");
    }

    let bwrap: string;
    let bunExecutable: string;
    try {
      bwrap = dependencies.realpath(dependencies.bwrapPath);
      bunExecutable = resolveBunExecutable(dependencies);
    } catch {
      reject("environment", "bubblewrap-or-dependency-unavailable");
    }

    const probeArgs = sandboxArgs(
      checkout,
      dependencySource,
      input.dependencyTarget.kind === "dir",
      bunExecutable,
      ["bun", "--version"],
    );
    result = await run(
      dependencies,
      checkout,
      bwrap,
      probeArgs,
      undefined,
      input.signal,
    );
    if (input.signal?.aborted) reject("cancelled", "cancelled");
    if (result.error || result.status !== 0)
      reject("environment", "sandbox-runtime-unavailable", {
        exitCode: result.status ?? 1,
        excerpt: commandExcerpt(result, [root, checkout]),
      });

    if (!isStaticCheck(input.verification)) {
      const checkArgs = sandboxArgs(
        checkout,
        dependencySource,
        input.dependencyTarget.kind === "dir",
        bunExecutable,
        ["bun", "run", "check"],
      );
      result = await run(
        dependencies,
        checkout,
        bwrap,
        checkArgs,
        undefined,
        input.signal,
      );
      if (input.signal?.aborted) reject("cancelled", "cancelled");
      if (result.error || result.status === null)
        reject("environment", "bubblewrap-launch-failed", {
          excerpt: commandExcerpt(result, [root, checkout]),
        });
      if (result.status !== 0)
        reject("artifact", "candidate-check-failed", {
          commandId: input.verification.id,
          exitCode: result.status,
          excerpt: commandExcerpt(result, [root, checkout]),
        });
    }

    const structuredReportPath = isStaticCheck(input.verification)
      ? undefined
      : path.join(temp, "verification-report.json");
    if (structuredReportPath)
      writeFileSync(structuredReportPath, "", { mode: 0o600 });
    const targetInvocation = structuredReportPath
      ? [
          ...input.verification.argv,
          "--reporter=json",
          `--outputFile=${SANDBOX_REPORT_TARGET}`,
        ]
      : input.verification.argv;
    const targetArgs = sandboxArgs(
      checkout,
      dependencySource,
      input.dependencyTarget.kind === "dir",
      bunExecutable,
      targetInvocation,
      structuredReportPath,
    );
    result = await run(
      dependencies,
      checkout,
      bwrap,
      targetArgs,
      undefined,
      input.signal,
    );
    if (input.signal?.aborted) reject("cancelled", "cancelled");
    requireCurrentHost(input);
    if (result.error || result.status === null)
      reject("environment", "bubblewrap-launch-failed", {
        excerpt: commandExcerpt(result, [root, checkout]),
      });
    const report = structuredReportPath
      ? structuredTestReport(structuredReportPath)
      : undefined;
    const normalized = normalizeTarget(input, result, [root, checkout], report);
    outcome = normalized.ok ? { ...normalized, targets } : normalized;
  } catch (error) {
    if (input.signal?.aborted) outcome = failed("cancelled", "cancelled");
    else if (error instanceof PreflightFailure)
      outcome = failed(error.failureClass, error.code, error.details);
    else
      outcome = failed("environment", "preflight-failed", {
        excerpt: String((error as Error).message).slice(0, 256),
      });
  }
  if (temp === undefined) return outcome;
  const cleanup = removeCheckout(temp, dependencies);
  if (cleanup.failed)
    return failed(
      "environment",
      "checkout-cleanup-failed",
      {},
      cleanup.removed,
    );
  return outcome;
}
