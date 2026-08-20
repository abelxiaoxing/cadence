// Strict request/result contracts for the private orchestration kernel.
// Structural validation only; no runtime dependency on a schema library.
export const STAGES = [
  "abel-design",
  "abel-implement",
  "abel-diagnose",
] as const;
export const ROLES = [
  "design-explorer",
  "contract-reviewer",
  "implementation-worker",
  "diagnosis-worker",
] as const;
export const ACTIONS = ["run", "apply", "discard", "cancel", "finish"] as const;
export const OUTPUT_KINDS = ["evidence", "diff"] as const;
export const PHASES = [
  "evidence",
  "red",
  "green",
  "refactor",
  "review",
] as const;

export const RECOVERY_CODES = [
  "mechanical-redispatch-exhausted",
  "implementation-artifact-delivery-blocked",
  "environment-blocked",
  "design-required",
] as const;

export type RecoveryCode = (typeof RECOVERY_CODES)[number];
export type RecoveryNext =
  | "finish-unaffected"
  | "correct-artifact"
  | "repair-environment"
  | "return-to-design";

export const LIMITS = {
  maxActiveChildSessions: 4,
  maxRequestsPerBatch: 8,
  maxEnvelopeBytes: 64 * 1024,
  phaseTimeoutMs: 20 * 60 * 1000,
  maxCompleteResultBytes: 64 * 1024,
} as const;

const NONCANONICAL = /(^|\/)\.\.(\/|$)|(^|\/)\/|^\//;
const SNAPSHOT_SHA256 = /^[a-f0-9]{64}$/;

export interface VerificationContract {
  id: string;
  argv: string[];
  classification: "expected-red" | "expected-green" | "expected-refactor";
  expectedFailure?: string;
  minTests: number;
}

export interface RequestEnvelope {
  stage: string;
  role: string;
  taskId?: string;
  id: string;
  phase: string;
  objective: string;
  roots: string[];
  context: { agents: string; contract: string };
  declared: {
    read: string[];
    write: string[];
    conflicts: string[];
    resources: string[];
    verificationLock?: string;
  };
  output: string;
  verification?: VerificationContract;
  snapshot?: unknown;
}

export interface RecoveryRecord {
  code: RecoveryCode;
  taskId: string;
  requestId: string;
  phase: string;
  launchIndex: 0 | 1;
  branchBlocked: true;
  dependentsBlocked: true;
  partialResultUsable: false;
  independentResultsPreserved: true;
  next: RecoveryNext;
}

export function isValidRelativePath(p: unknown): p is string {
  return (
    typeof p === "string" &&
    p.length > 0 &&
    p.length <= 512 &&
    !NONCANONICAL.test(p) &&
    !p.startsWith("/") &&
    !p.includes("..") &&
    !p.includes("\\") &&
    !p.includes("\u0000")
  );
}

export function validateVerificationContract(
  value: unknown,
): { ok: true; value: VerificationContract } | { ok: false; reason: string } {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return { ok: false, reason: "invalid verification contract" };
  const contract = value as Record<string, unknown>;
  if (
    typeof contract.id !== "string" ||
    contract.id.length === 0 ||
    contract.id.length > 128 ||
    !Array.isArray(contract.argv) ||
    contract.argv.some(
      (part) =>
        typeof part !== "string" ||
        part.length === 0 ||
        /[;&|`$<>\n\r]/u.test(part) ||
        part.includes("\0"),
    ) ||
    !["expected-red", "expected-green", "expected-refactor"].includes(
      String(contract.classification),
    ) ||
    !Number.isSafeInteger(contract.minTests) ||
    (contract.minTests as number) < 1
  ) {
    return { ok: false, reason: "invalid verification contract" };
  }
  const argv = contract.argv as string[];
  const check =
    argv.length === 3 &&
    argv[0] === "bun" &&
    argv[1] === "run" &&
    argv[2] === "check";
  const target =
    argv.length >= 4 &&
    argv[0] === "bun" &&
    argv[1] === "run" &&
    argv[2] === "test:target" &&
    argv
      .slice(3)
      .every((part) => part.startsWith("test/") && isValidRelativePath(part));
  if (!check && !target)
    return { ok: false, reason: "verification argv is not approved" };
  if (
    contract.classification === "expected-red"
      ? typeof contract.expectedFailure !== "string" ||
        contract.expectedFailure.length === 0
      : contract.expectedFailure !== undefined
  ) {
    return { ok: false, reason: "invalid expected failure identity" };
  }
  return { ok: true, value: contract as unknown as VerificationContract };
}

function validateImplementationSnapshot(
  snapshot: unknown,
  paths: string[],
): string | null {
  if (
    snapshot === undefined ||
    snapshot === null ||
    typeof snapshot !== "object" ||
    Array.isArray(snapshot)
  ) {
    return "invalid snapshot";
  }
  const bounds = snapshot as Record<string, unknown>;
  for (const [path, value] of Object.entries(bounds)) {
    if (
      !isValidRelativePath(path) ||
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value)
    ) {
      return "invalid snapshot";
    }
    const entry = value as Record<string, unknown>;
    if (entry.kind === "file") {
      if (
        typeof entry.sha256 !== "string" ||
        !SNAPSHOT_SHA256.test(entry.sha256) ||
        typeof entry.bytes !== "number" ||
        !Number.isSafeInteger(entry.bytes) ||
        entry.bytes < 0
      ) {
        return "invalid snapshot";
      }
    } else if (entry.kind === "dir") {
      if (
        typeof entry.manifest !== "string" ||
        !SNAPSHOT_SHA256.test(entry.manifest)
      ) {
        return "invalid snapshot";
      }
    } else if (entry.kind === "absent") {
      if (entry.absent !== true) return "invalid snapshot";
    } else {
      return "invalid snapshot";
    }
  }
  if (
    [...new Set(paths)].some(
      (path) => !Object.prototype.hasOwnProperty.call(bounds, path),
    )
  ) {
    return "snapshot does not cover declared paths";
  }
  return null;
}

export function validateRequestEnvelope(
  value: unknown,
): { ok: true; value: RequestEnvelope } | { ok: false; reason: string } {
  if (value === null || typeof value !== "object") {
    return { ok: false, reason: "missing request envelope" };
  }
  const env = value as Record<string, unknown>;
  for (const field of [
    "stage",
    "role",
    "id",
    "phase",
    "objective",
    "roots",
    "context",
    "declared",
    "output",
  ]) {
    if (env[field] === undefined) {
      return { ok: false, reason: `missing required field: ${field}` };
    }
  }
  if (!(STAGES as readonly string[]).includes(env.stage as string)) {
    return { ok: false, reason: `unknown stage: ${String(env.stage)}` };
  }
  if (!(ROLES as readonly string[]).includes(env.role as string)) {
    return { ok: false, reason: `unknown role: ${String(env.role)}` };
  }
  if (
    typeof env.id !== "string" ||
    env.id.length === 0 ||
    env.id.length > 128
  ) {
    return { ok: false, reason: "invalid request id" };
  }
  if (
    env.taskId !== undefined &&
    (typeof env.taskId !== "string" ||
      env.taskId.length === 0 ||
      env.taskId.length > 128)
  ) {
    return { ok: false, reason: "invalid task id" };
  }
  // Implementation phases use a phase-local request id and carry their stable
  // task identity explicitly. Other packets keep id as task id.
  if (
    env.stage === "abel-implement" &&
    env.output === "diff" &&
    env.taskId === undefined
  ) {
    return { ok: false, reason: "missing required field: taskId" };
  }
  if (
    typeof env.phase !== "string" ||
    !(PHASES as readonly string[]).includes(env.phase)
  ) {
    return { ok: false, reason: `invalid phase: ${String(env.phase)}` };
  }
  const serialized = JSON.stringify(env);
  if (serialized.length > LIMITS.maxEnvelopeBytes) {
    return {
      ok: false,
      reason: `request envelope exceeds ${LIMITS.maxEnvelopeBytes / 1024} KiB`,
    };
  }
  if (
    typeof env.objective !== "string" ||
    env.objective.length === 0 ||
    env.objective.length > 4096
  ) {
    return { ok: false, reason: "invalid objective" };
  }
  if (
    !Array.isArray(env.roots) ||
    env.roots.length === 0 ||
    !env.roots.every(isValidRelativePath)
  ) {
    return { ok: false, reason: "invalid path roots" };
  }
  const ctx = env.context as Record<string, unknown>;
  if (
    ctx === null ||
    typeof ctx !== "object" ||
    typeof ctx.agents !== "string" ||
    typeof ctx.contract !== "string"
  ) {
    return { ok: false, reason: "invalid context" };
  }
  const decl = env.declared as Record<string, unknown>;
  if (decl === null || typeof decl !== "object") {
    return { ok: false, reason: "invalid declared sets" };
  }
  for (const key of ["read", "write", "conflicts", "resources"]) {
    if (
      !Array.isArray(decl[key]) ||
      !(decl[key] as unknown[]).every(isValidRelativePath)
    ) {
      return { ok: false, reason: `invalid declared ${key} set` };
    }
  }
  if (
    decl.verificationLock !== undefined &&
    !isValidRelativePath(decl.verificationLock)
  ) {
    return { ok: false, reason: "invalid verification lock" };
  }
  if (!(OUTPUT_KINDS as readonly string[]).includes(env.output as string)) {
    return { ok: false, reason: `invalid output kind: ${String(env.output)}` };
  }
  if (env.verification !== undefined) {
    const verification = validateVerificationContract(env.verification);
    if (!verification.ok) {
      return {
        ok: false,
        reason: verification.reason,
      };
    }
  }
  if (env.stage === "abel-implement" && env.output === "diff") {
    if (env.verification === undefined) {
      return { ok: false, reason: "missing required field: verification" };
    }
    const expectedClassification = {
      red: "expected-red",
      green: "expected-green",
      refactor: "expected-refactor",
    }[String(env.phase)];
    if (
      expectedClassification === undefined ||
      (env.verification as VerificationContract).classification !==
        expectedClassification
    ) {
      return {
        ok: false,
        reason:
          "verification classification does not match implementation phase",
      };
    }
  }
  if (env.stage === "abel-implement" && env.output === "diff") {
    const snapshotReason = validateImplementationSnapshot(env.snapshot, [
      ...(decl.read as string[]),
      ...(decl.write as string[]),
    ]);
    if (snapshotReason !== null) {
      return { ok: false, reason: snapshotReason };
    }
  }
  if (
    env.snapshot !== undefined &&
    (env.snapshot === null || typeof env.snapshot !== "object")
  ) {
    return { ok: false, reason: "invalid snapshot" };
  }
  return { ok: true, value: env as unknown as RequestEnvelope };
}

/** Extract proposed write paths from ordinary unified diff header pairs. */
export function diffWritePaths(diffText: string): {
  paths: string[];
  kind: string;
} {
  if (typeof diffText !== "string" || diffText.length === 0) {
    throw new Error("empty diff");
  }
  const hasFinalLf = diffText.endsWith("\n");
  const lines = (hasFinalLf ? diffText.slice(0, -1) : diffText).split("\n");

  for (const line of lines) {
    if (/^(?:GIT binary patch|Binary files )/.test(line)) {
      throw new Error("binary diff is not supported");
    }
    if (/^(?:copy|rename) (?:from|to) /.test(line)) {
      throw new Error(`${line.split(" ", 1)[0]} records are not supported`);
    }
    if (/^(?:old|new) mode /.test(line)) {
      throw new Error("mode transitions are not supported");
    }
    const mode = /^(?:new file mode|deleted file mode) (.+)$/.exec(line);
    if (mode) requireRegularFileMode(mode[1]);
  }

  const paths: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!isFileSectionStart(lines[i])) {
      if (paths.length === 0) {
        throw new Error("diff has no ordinary text headers");
      }
      throw new Error(`unconsumed diff content: ${lines[i]}`);
    }

    let gitTarget: string | null = null;
    if (lines[i].startsWith("diff --git ")) {
      gitTarget = parseGitTarget(lines[i]);
      i++;
    }

    let operation: "add" | "delete" | null = null;
    const mode = /^(new file mode|deleted file mode) (.+)$/.exec(
      lines[i] ?? "",
    );
    if (mode) {
      operation = mode[1] === "new file mode" ? "add" : "delete";
      i++;
    }
    if (lines[i]?.startsWith("index ")) {
      parseIndexMetadata(lines[i]);
      i++;
    }

    if (!lines[i]?.startsWith("--- ")) {
      throw new Error("file section is missing an ordinary --- header");
    }
    const oldPath = parseHeaderPath(lines[i].slice(4), "a");
    i++;
    if (!lines[i]?.startsWith("+++ ")) {
      throw new Error("diff header pair is malformed");
    }
    const newPath = parseHeaderPath(lines[i].slice(4), "b");
    i++;

    if (oldPath === null && newPath === null) {
      throw new Error("diff header pair has no target");
    }
    if (oldPath !== null && newPath !== null && oldPath !== newPath) {
      throw new Error("mismatched old/new diff targets");
    }
    const target = oldPath ?? newPath;
    if (target === null) throw new Error("diff header pair has no target");
    if (gitTarget !== null && gitTarget !== target) {
      throw new Error("mismatched diff --git and text targets");
    }
    if (
      (operation === "add" && oldPath !== null) ||
      (operation === "delete" && newPath !== null)
    ) {
      throw new Error("create/delete metadata does not match text headers");
    }
    if (paths.includes(target)) throw new Error("duplicate diff targets");
    paths.push(target);

    let sawHunk = false;
    while (lines[i]?.startsWith("@@")) {
      const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/.exec(
        lines[i],
      );
      if (!hunk) throw new Error(`invalid hunk header: ${lines[i]}`);
      const range = [
        Number(hunk[1]),
        Number(hunk[2] ?? "1"),
        Number(hunk[3]),
        Number(hunk[4] ?? "1"),
      ];
      if (!range.every(Number.isSafeInteger)) {
        throw new Error("hunk range exceeds supported integer bounds");
      }
      let oldRemaining = range[1];
      let newRemaining = range[3];
      sawHunk = true;
      i++;

      while (oldRemaining > 0 || newRemaining > 0) {
        if (i >= lines.length) throw new Error("hunk body underflow");
        const body = lines[i];
        switch (body[0]) {
          case " ":
            if (oldRemaining === 0 || newRemaining === 0) {
              throw new Error("hunk body overflow");
            }
            oldRemaining--;
            newRemaining--;
            break;
          case "-":
            if (oldRemaining === 0) throw new Error("hunk body overflow");
            oldRemaining--;
            break;
          case "+":
            if (newRemaining === 0) throw new Error("hunk body overflow");
            newRemaining--;
            break;
          default:
            throw new Error("hunk body underflow");
        }
        i++;
        if (lines[i] === "\\ No newline at end of file") i++;
      }
    }
    if (!sawHunk) {
      throw new Error("file section has no valid unified-diff hunk");
    }
  }

  if (!hasFinalLf) throw new Error("diff must end with LF");
  return { paths, kind: "text" };
}

function isFileSectionStart(line: string | undefined): boolean {
  return (
    line?.startsWith("diff --git ") === true ||
    line?.startsWith("new file mode ") === true ||
    line?.startsWith("deleted file mode ") === true ||
    line?.startsWith("index ") === true ||
    line?.startsWith("--- ") === true
  );
}

function parseGitTarget(line: string): string {
  const prefix = "diff --git a/";
  if (!line.startsWith(prefix)) throw new Error("malformed diff --git header");
  const rest = line.slice(prefix.length);
  for (
    let separator = rest.indexOf(" b/");
    separator >= 0;
    separator = rest.indexOf(" b/", separator + 1)
  ) {
    const oldPath = rest.slice(0, separator);
    const newPath = rest.slice(separator + 3);
    if (oldPath === newPath) return requireCanonicalDiffPath(oldPath);
  }
  throw new Error("mismatched diff --git targets");
}

function parseIndexMetadata(line: string): void {
  const index = /^index [0-9a-f]+\.\.[0-9a-f]+(?: ([0-7]{6}))?$/.exec(line);
  if (!index) throw new Error("malformed index metadata");
  if (index[1]) requireRegularFileMode(index[1]);
}

function requireRegularFileMode(mode: string): void {
  if (mode === "160000") {
    throw new Error("submodule mode is not supported: 160000");
  }
  if (mode !== "100644" && mode !== "100755") {
    throw new Error(`non-regular file mode is not supported: ${mode}`);
  }
}

function parseHeaderPath(header: string, prefix: "a" | "b"): string | null {
  if (header === "/dev/null") return null;
  const other = prefix === "a" ? "b" : "a";
  if (header.startsWith(`${other}/`)) {
    throw new Error("mismatched old/new diff header prefixes");
  }
  const path = header.startsWith(`${prefix}/`) ? header.slice(2) : header;
  return requireCanonicalDiffPath(path);
}

function requireCanonicalDiffPath(path: string): string {
  if (
    !isValidRelativePath(path) ||
    path.trim() !== path ||
    /[\r\n\t]/.test(path)
  ) {
    throw new Error(`noncanonical or escaping diff path: ${path}`);
  }
  return path;
}

export interface EvidenceResult {
  id: string;
  role: string;
  kind: "evidence";
  conclusions: string[];
  citations: { path: string; lines: string }[];
  constraints: string[];
  dependencies: string[];
  risks: string[];
  blockingQuestions: string[];
  hints: { writeSet: string[]; verification: string; agentsImpact: string };
}

export interface DiffResult {
  id: string;
  role: string;
  kind: "diff";
  taskId: string;
  phase: string;
  summary: string;
  diff: string;
  expectedVerification: string;
  risks: string[];
  nextStep: string;
  contractCompliant: boolean;
}

export function validateEvidenceResult(value: unknown): {
  ok: boolean;
  reason?: string;
} {
  if (value === null || typeof value !== "object")
    return { ok: false, reason: "missing result" };
  const r = value as Record<string, unknown>;
  if (r.kind !== "evidence") return { ok: false, reason: "wrong result kind" };
  for (const field of [
    "id",
    "role",
    "conclusions",
    "citations",
    "blockingQuestions",
  ]) {
    if (r[field] === undefined)
      return { ok: false, reason: `missing field: ${field}` };
  }
  if (typeof r.id !== "string" || typeof r.role !== "string")
    return { ok: false, reason: "invalid identity" };
  if (!(ROLES as readonly string[]).includes(r.role))
    return { ok: false, reason: "unknown role" };
  const serialized = JSON.stringify(r);
  if (serialized.length > LIMITS.maxCompleteResultBytes) {
    return {
      ok: false,
      reason: `result exceeds ${LIMITS.maxCompleteResultBytes} bytes`,
    };
  }
  return { ok: true };
}

export function validateDiffResult(value: unknown): {
  ok: boolean;
  reason?: string;
  paths?: string[];
} {
  if (value === null || typeof value !== "object")
    return { ok: false, reason: "missing result" };
  const r = value as Record<string, unknown>;
  if (r.kind !== "diff") return { ok: false, reason: "wrong result kind" };
  for (const field of [
    "id",
    "role",
    "taskId",
    "phase",
    "summary",
    "diff",
    "expectedVerification",
    "risks",
    "nextStep",
    "contractCompliant",
  ]) {
    if (r[field] === undefined)
      return { ok: false, reason: `missing field: ${field}` };
  }
  if (
    typeof r.id !== "string" ||
    r.id.length === 0 ||
    r.id.length > 128 ||
    typeof r.role !== "string" ||
    r.role.length === 0 ||
    typeof r.taskId !== "string" ||
    r.taskId.length === 0
  ) {
    return { ok: false, reason: "invalid identity" };
  }
  if (!(ROLES as readonly string[]).includes(r.role))
    return { ok: false, reason: "unknown role" };
  if (
    typeof r.phase !== "string" ||
    !(PHASES as readonly string[]).includes(r.phase)
  ) {
    return { ok: false, reason: "invalid phase" };
  }
  if (
    typeof r.summary !== "string" ||
    r.summary.length === 0 ||
    typeof r.expectedVerification !== "string" ||
    r.expectedVerification.length === 0 ||
    typeof r.nextStep !== "string" ||
    r.nextStep.length === 0
  ) {
    return { ok: false, reason: "invalid diff result text" };
  }
  if (
    !Array.isArray(r.risks) ||
    !(r.risks as unknown[]).every((x) => typeof x === "string")
  ) {
    return { ok: false, reason: "invalid risks" };
  }
  if (r.contractCompliant !== true)
    return { ok: false, reason: "contract compliance not affirmed" };
  let paths: string[];
  try {
    paths = diffWritePaths(r.diff as string).paths;
  } catch (err) {
    return { ok: false, reason: `invalid diff: ${(err as Error).message}` };
  }
  const serialized = JSON.stringify(r);
  if (serialized.length > LIMITS.maxCompleteResultBytes) {
    return {
      ok: false,
      reason: `result exceeds ${LIMITS.maxCompleteResultBytes} bytes`,
    };
  }
  return { ok: true, paths };
}
