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

export const LIMITS = {
  maxActiveChildSessions: 4,
  maxRequestsPerBatch: 8,
  maxEnvelopeBytes: 64 * 1024,
  phaseTimeoutMs: 20 * 60 * 1000,
  maxCompleteResultBytes: 64 * 1024,
} as const;

const NONCANONICAL = /(^|\/)\.\.(\/|$)|(^|\/)\/|^\//;

export interface RequestEnvelope {
  stage: string;
  role: string;
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
  snapshot?: unknown;
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
  if (/^GIT binary patch|^Binary files /.test(diffText)) {
    throw new Error("binary diff is not supported");
  }
  const lines = diffText.split("\n");
  if (lines.some((line) => /^copy (from|to) /.test(line))) {
    throw new Error("copy records are not supported");
  }
  if (lines.some((line) => /^rename (from|to) /.test(line))) {
    throw new Error("rename records are not supported");
  }
  const paths: string[] = [];
  let sawHeader = false;
  let pendingOld: string | null = null;
  for (const line of lines) {
    if (/^old mode /.test(line) || /^new mode /.test(line)) {
      throw new Error("mode transitions are not supported");
    }
    if (/^(new|deleted) file mode /.test(line)) {
      const mode = line.split(" ").pop();
      if (mode === "160000") {
        throw new Error("submodule mode is not supported");
      }
      if (mode !== "100644" && mode !== "100755") {
        throw new Error(`non-regular file mode is not supported: ${mode}`);
      }
      continue;
    }
    if (line.startsWith("--- ") && !line.startsWith("--- /dev/null")) {
      pendingOld = parseHeaderPath(line.slice(4));
      continue;
    }
    if (line.startsWith("+++ ")) {
      const newPath = parseHeaderPath(line.slice(4));
      let target: string;
      if (newPath === null) {
        if (pendingOld === null) {
          throw new Error("diff header pair is malformed");
        }
        target = pendingOld;
      } else {
        target = newPath;
        if (pendingOld !== null && pendingOld !== newPath) {
          throw new Error("mismatched old/new diff targets");
        }
      }
      pendingOld = null;
      if (paths.includes(target)) throw new Error("duplicate diff targets");
      paths.push(target);
      sawHeader = true;
    }
  }
  if (!sawHeader || paths.length === 0) {
    throw new Error("diff has no ordinary text headers");
  }
  return { paths, kind: "text" };
}

function parseHeaderPath(header: string): string | null {
  if (header === "/dev/null") return null;
  const path = header.replace(/^\s*(a|b)\//, "");
  if (!isValidRelativePath(path)) {
    throw new Error(`noncanonical or escaping diff path: ${header}`);
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
