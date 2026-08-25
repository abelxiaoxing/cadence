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

export const AGENTS_IMPACTS = [
  "none",
  "update-existing",
  "create-index",
  "remove-index",
] as const;
export type AgentsImpact = (typeof AGENTS_IMPACTS)[number];

export const IMPACT_SURFACES = [
  "none",
  "route-authorization",
  "page-state",
  "api-response",
  "public-html",
] as const;
export type ImpactSurface = (typeof IMPACT_SURFACES)[number];

export const LIMITS = {
  maxActiveChildSessions: 4,
  maxRequestsPerBatch: 8,
  maxEnvelopeBytes: 64 * 1024,
  phaseTimeoutMs: 20 * 60 * 1000,
  maxCompleteResultBytes: 64 * 1024,
} as const;

export const ARTIFACT_FAILURE_CODES = [
  "agents-impact-mismatch",
  "agents-target-mismatch",
  "baseline-bound-mismatch",
  "baseline-deletion-kind",
  "baseline-directory-kind",
  "baseline-directory-mismatch",
  "baseline-directory-special-file",
  "baseline-directory-symlink",
  "baseline-file-kind",
  "baseline-shape",
  "candidate-check-failed",
  "checkout-special-file",
  "checkout-symlink",
  "dependency-bound-mismatch",
  "escaping-path",
  "git-apply-check-failed",
  "git-apply-failed",
  "git-numstat-rejected",
  "git-summary-rejected",
  "ignored-baseline-input",
  "incomplete-baseline",
  "invalid-approved-dependencies",
  "invalid-checkpoint-contract",
  "invalid-diff",
  "invalid-diff-bytes",
  "invalid-snapshot",
  "invalid-structural-result",
  "child-no-structural-submit",
  "invalid-verification-contract",
  "lockfile-bound-mismatch",
  "noncanonical-path",
  "nonregular-mode",
  "outside-managed-region",
  "package-bound-mismatch",
  "package-manifest-invalid",
  "parent-review-rejected",
  "red-not-witnessed",
  "submodule",
  "target-baseline-missing",
  "verification-baseline-missing",
  "verification-input-unavailable",
  "verification-rejected",
  "verification-report-invalid",
  "verification-report-missing",
  "write-set-mismatch",
] as const;
export const STALE_FAILURE_CODES = [
  "baseline-deletion-drift",
  "baseline-directory-drift",
  "baseline-file-drift",
  "git-apply-check-failed",
  "stale-snapshot",
] as const;
export const ENVIRONMENT_FAILURE_CODES = [
  "bubblewrap-launch-failed",
  "bubblewrap-or-dependency-unavailable",
  "bun-executable-unavailable",
  "checkpoint-unavailable",
  "checkout-cleanup-failed",
  "checkout-failed",
  "clone-alternates",
  "clone-failed",
  "child-session-create-failed",
  "dependency-path-unsafe",
  "git-apply-check-unavailable",
  "git-apply-failed",
  "git-apply-unavailable",
  "git-ignore-check-failed",
  "git-index-unavailable",
  "invalid-subagent-endpoint",
  "parent-bridge-capture-not-ready",
  "parent-bridge-generation-invalidated",
  "parent-bridge-model-key-mismatch",
  "parent-bridge-provider-not-installed",
  "parent-bridge-session-unavailable",
  "root-unavailable",
  "sandbox-runtime-unavailable",
] as const;
export const APPROVAL_BOUNDARY_CODES = [
  "unapproved-dependency-change",
  "behavior-contract-insufficient",
  "architecture-contract-insufficient",
  "task-scope-insufficient",
  "verification-contract-insufficient",
  "agents-contract-insufficient",
] as const;
export const VERIFICATION_ADAPTER_CODES = [
  "input-missing",
  "local-executable-missing",
  "runner-missing",
  "script-command-mismatch",
  "script-missing",
  "script-unsafe",
] as const;
export const CHILD_TRANSPORT_CODES = [
  "child-no-final-assistant",
  "child-provider-stream-aborted",
  "child-provider-stream-error",
  "child-timeout",
  "timeout",
  "transport-failure",
] as const;
export const FAILURE_STAGES = [
  "phase-runtime",
  "child-session-create",
  "child-provider-stream",
  "child-finalization",
  "child-timeout",
] as const;

export type ArtifactFailureCode = (typeof ARTIFACT_FAILURE_CODES)[number];
export type StaleFailureCode = (typeof STALE_FAILURE_CODES)[number];
export type EnvironmentFailureCode = (typeof ENVIRONMENT_FAILURE_CODES)[number];
export type ApprovalBoundaryCode = (typeof APPROVAL_BOUNDARY_CODES)[number];
export type VerificationAdapterCode =
  (typeof VERIFICATION_ADAPTER_CODES)[number];
export type ChildTransportCode = (typeof CHILD_TRANSPORT_CODES)[number];
export type FailureStage = (typeof FAILURE_STAGES)[number];

export interface SafeFailureDiagnostic {
  code: ChildTransportCode;
  stage: FailureStage;
}

export type EnvironmentFailure = {
  kind: "environment";
  code: EnvironmentFailureCode;
  message?: string;
  stage?: FailureStage;
};

export type CandidateFailure =
  | { kind: "artifact"; code: ArtifactFailureCode; evidence?: string[] }
  | { kind: "stale"; code: StaleFailureCode }
  | EnvironmentFailure
  | { kind: "verification-adapter"; code: VerificationAdapterCode }
  | { kind: "approval-boundary"; code: ApprovalBoundaryCode }
  | { kind: "cancelled"; code: "cancelled" }
  | { kind: "result-limit"; limitBytes: number };

export type ChildFailure =
  | CandidateFailure
  | {
      kind: "transport";
      code: ChildTransportCode;
      stage?: FailureStage;
    };

export type CandidateRejection =
  | {
      kind: "artifact";
      code: "parent-review-rejected";
      evidence?: string[];
    }
  | { kind: "approval-boundary"; code: ApprovalBoundaryCode };

export type TaskFailure =
  | { kind: "approval-boundary"; code: ApprovalBoundaryCode }
  | { kind: "verification-adapter"; code: VerificationAdapterCode }
  | {
      kind: "attempts-exhausted";
      cause: "artifact" | "stale" | "transport";
      lastFailure?: SafeFailureDiagnostic;
    }
  | {
      kind: "checkpoint-attempts-exhausted";
      cause: "artifact" | "stale";
    }
  | EnvironmentFailure
  | { kind: "result-limit"; limitBytes: number };

export interface CandidateApplyEvidence {
  targets: string[];
  checkExitCode: 0;
  applyExitCode: 0;
}

export type ApplyCandidateResult =
  | { ok: true; result: CandidateApplyEvidence }
  | { ok: false; failure: CandidateFailure };

const NONCANONICAL = /(^|\/)\.\.(\/|$)|(^|\/)\/|^\//;
const SNAPSHOT_SHA256 = /^[a-f0-9]{64}$/;

export type VerificationClassification =
  | "expected-red"
  | "expected-green"
  | "expected-refactor";

interface VerificationBase {
  id: string;
  classification: VerificationClassification;
  expectedFailure?: string;
  /** Internal marker retained only for normalized 1.0.x argv compatibility. */
  legacy?: true;
}

export type PackageManager = "bun" | "npm" | "pnpm" | "yarn";

export interface PackageScriptRunner {
  kind: "package-script";
  packageManager: PackageManager;
  script: string;
  /** Exact Gate-B-approved package.json script value. Omitted only for legacy input. */
  command?: string;
}

export type ExecutableRunner =
  | PackageScriptRunner
  | { kind: "local-binary"; executable: string }
  | { kind: "npx"; executable: string; noInstall: true };

export interface VitestVerificationContract extends VerificationBase {
  kind: "vitest";
  runner: ExecutableRunner;
  testFiles: string[];
  args: string[];
  minTests: number;
}

export interface PackageScriptVerificationContract extends VerificationBase {
  kind: "package-script";
  packageManager: PackageManager;
  script: string;
  /** Exact Gate-B-approved package.json script value. Omitted only for legacy input. */
  command?: string;
  args: string[];
}

export interface StaticCheckVerificationContract extends VerificationBase {
  kind: "static-check";
  runner: ExecutableRunner | { kind: "node"; script: string };
  args: string[];
}

export type AtomicVerificationContract =
  | VitestVerificationContract
  | PackageScriptVerificationContract
  | StaticCheckVerificationContract;

export interface VerificationStepsContract {
  kind: "steps";
  id: string;
  classification: VerificationClassification;
  steps: AtomicVerificationContract[];
}

/** @deprecated Accepted only as 1.0.x compatibility input and normalized immediately. */
export interface LegacyVerificationContract extends VerificationBase {
  argv: string[];
  minTests: number;
  kind?: never;
}

export type StructuredVerificationContract =
  | AtomicVerificationContract
  | VerificationStepsContract;

export type VerificationContract =
  | StructuredVerificationContract
  | LegacyVerificationContract;

export interface ImpactClosureContract {
  changedSurfaces: ImpactSurface[];
  searchEvidence: string[];
  relatedTests: Array<{
    path: string;
    disposition: "current-task" | "regression-task" | "unaffected";
    evidence: string;
    regressionTaskId?: string;
  }>;
  affectedSuite: string[];
}

export type ImplementationPhase = "red" | "green" | "refactor";

export interface PhaseBoundary {
  read: string[];
  write: string[];
  verification: VerificationContract;
  verificationLock?: string;
}

export interface TaskBoundary {
  changeId: string;
  taskId: string;
  objective: string;
  context: { agents: string; contract: string };
  roots: string[];
  phases: {
    red: PhaseBoundary;
    green: PhaseBoundary;
    refactor?: PhaseBoundary;
  };
  scheduling: { conflicts: string[]; resources: string[] };
  agents: {
    impact: AgentsImpact;
    target?: string;
    managedOnly: true;
  };
  approvedDependencies: string[];
  impactClosure: ImpactClosureContract;
}

export interface PhaseAttempt {
  changeId: string;
  taskId: string;
  requestId: string;
  phase: ImplementationPhase;
  snapshot: unknown;
}

export type ImplementRunRequest =
  | {
      stage: "abel-implement";
      kind: "open-task";
      boundary: TaskBoundary;
      attempt: PhaseAttempt;
    }
  | {
      stage: "abel-implement";
      kind: "phase-attempt";
      attempt: PhaseAttempt;
    };

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
  agentsImpact?: AgentsImpact;
  agentsTarget?: string;
  agentsManagedOnly?: true;
  approvedDependencies?: string[];
  impactClosure?: ImpactClosureContract;
  verification?: VerificationContract;
  snapshot?: unknown;
}

export type RunRequest = RequestEnvelope | ImplementRunRequest;

export interface AgentsCheckpointRequest {
  stage: "abel-implement";
  taskId: string;
  agentsImpact: Exclude<AgentsImpact, "none">;
  agentsTarget: string;
  agentsManagedOnly: true;
  stableCheckpoint: true;
  snapshot: unknown;
  diff: string;
}

export interface AgentsCheckpointAttempt {
  changeId: string;
  taskId: string;
  requestId: string;
  snapshot: unknown;
  diff: string;
}

export interface ImplementApplyOperation {
  resultId: string;
  requestId: string;
}

export interface ImplementDiscardOperation extends ImplementApplyOperation {
  rejection: CandidateRejection;
}

export function isValidRelativePath(p: unknown): p is string {
  return (
    typeof p === "string" &&
    p.length > 0 &&
    p.length <= 512 &&
    !NONCANONICAL.test(p) &&
    !p.startsWith("/") &&
    (p === "." ||
      (!p.startsWith("./") &&
        !p.endsWith("/") &&
        !p.split("/").includes("."))) &&
    !p.includes("..") &&
    !p.includes("\\") &&
    !p.includes("\u0000")
  );
}

export function isAgentsPath(p: unknown): p is string {
  return isValidRelativePath(p) && /(?:^|\/)AGENTS\.md$/u.test(p);
}

const UNSAFE_VERIFICATION_TOKEN = /[;&|`$<>\n\r\0]/u;
const VERIFICATION_NAME = /^[a-z0-9][a-z0-9._:@/-]*$/iu;
const EXECUTABLE_NAME = /^[a-z0-9][a-z0-9._-]*$/iu;

function validVerificationToken(value: unknown): value is string {
  const optionValue =
    typeof value === "string" && value.includes("=")
      ? value.slice(value.indexOf("=") + 1)
      : value;
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    value.trim() === value &&
    !UNSAFE_VERIFICATION_TOKEN.test(value) &&
    !value.includes("\\") &&
    !value.startsWith("/") &&
    !/^[a-z]:\//iu.test(value) &&
    !/(^|\/)\.\.(\/|$)/u.test(value) &&
    typeof optionValue === "string" &&
    !optionValue.startsWith("/") &&
    !/^[a-z]:\//iu.test(optionValue) &&
    !/(^|\/)\.\.(\/|$)/u.test(optionValue)
  );
}

function validVerificationArgs(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 128 &&
    value.every(validVerificationToken)
  );
}

function validScriptCommand(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 1024 &&
    value.trim() === value &&
    !UNSAFE_VERIFICATION_TOKEN.test(value)
  );
}

function validVerificationIdentity(contract: Record<string, unknown>): boolean {
  if (
    typeof contract.id !== "string" ||
    contract.id.length === 0 ||
    contract.id.length > 128 ||
    !["expected-red", "expected-green", "expected-refactor"].includes(
      String(contract.classification),
    )
  ) {
    return false;
  }
  return contract.classification === "expected-red"
    ? typeof contract.expectedFailure === "string" &&
        contract.expectedFailure.length > 0 &&
        contract.expectedFailure.length <= 512
    : contract.expectedFailure === undefined;
}

function validatePackageScriptRunner(
  value: unknown,
  requireCommand: boolean,
): value is PackageScriptRunner {
  if (
    !hasExactKeys(
      value,
      requireCommand
        ? ["kind", "packageManager", "script", "command"]
        : ["kind", "packageManager", "script"],
      requireCommand ? [] : ["command"],
    ) ||
    value.kind !== "package-script" ||
    !["bun", "npm", "pnpm", "yarn"].includes(String(value.packageManager)) ||
    typeof value.script !== "string" ||
    !VERIFICATION_NAME.test(value.script) ||
    value.script.includes("/") ||
    (value.command !== undefined && !validScriptCommand(value.command))
  ) {
    return false;
  }
  return !requireCommand || value.command !== undefined;
}

function validateExecutableRunner(
  value: unknown,
  requirePackageCommand: boolean,
): value is ExecutableRunner {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const runner = value as Record<string, unknown>;
  if (runner.kind === "package-script") {
    return validatePackageScriptRunner(runner, requirePackageCommand);
  }
  if (
    runner.kind === "local-binary" &&
    hasExactKeys(runner, ["kind", "executable"])
  ) {
    return (
      typeof runner.executable === "string" &&
      EXECUTABLE_NAME.test(runner.executable)
    );
  }
  return (
    runner.kind === "npx" &&
    hasExactKeys(runner, ["kind", "executable", "noInstall"]) &&
    typeof runner.executable === "string" &&
    EXECUTABLE_NAME.test(runner.executable) &&
    runner.noInstall === true
  );
}

function validateVitestRunner(
  value: ExecutableRunner,
  legacy: boolean,
): boolean {
  if (legacy) return true;
  if (value.kind === "package-script") {
    const tokens = value.command?.split(/\s+/u) ?? [];
    return (
      tokens[0] === "vitest" ||
      (tokens[0] === "npx" &&
        tokens[1] === "--no-install" &&
        tokens[2] === "vitest")
    );
  }
  return value.executable === "vitest";
}

function validateAtomicVerification(
  value: unknown,
  requirePackageCommand: boolean,
): value is AtomicVerificationContract {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const contract = value as Record<string, unknown>;
  const legacy = contract.legacy === true;
  const packageCommandRequired = requirePackageCommand && !legacy;
  const expectedFailure =
    contract.classification === "expected-red" ? ["expectedFailure"] : [];
  if (contract.kind === "vitest") {
    const legacyRunner = contract.runner as Record<string, unknown>;
    const executableRunner = contract.runner as ExecutableRunner;
    return (
      hasExactKeys(contract, [
        "kind",
        "id",
        "runner",
        "testFiles",
        "args",
        "classification",
        ...expectedFailure,
        "minTests",
        ...(legacy ? ["legacy"] : []),
      ]) &&
      validVerificationIdentity(contract) &&
      validateExecutableRunner(contract.runner, packageCommandRequired) &&
      validateVitestRunner(executableRunner, legacy) &&
      Array.isArray(contract.testFiles) &&
      contract.testFiles.length > 0 &&
      contract.testFiles.length <= 64 &&
      contract.testFiles.every(isValidRelativePath) &&
      new Set(contract.testFiles).size === contract.testFiles.length &&
      validVerificationArgs(contract.args) &&
      Number.isSafeInteger(contract.minTests) &&
      (contract.minTests as number) >= 1 &&
      (!legacy ||
        (hasExactKeys(legacyRunner, ["kind", "packageManager", "script"]) &&
          legacyRunner.kind === "package-script" &&
          legacyRunner.packageManager === "bun" &&
          legacyRunner.script === "test:target" &&
          contract.testFiles.every((part) => part.startsWith("test/")) &&
          contract.args.length === 0))
    );
  }
  if (contract.kind === "package-script") {
    const runner = {
      kind: "package-script",
      packageManager: contract.packageManager,
      script: contract.script,
      ...(contract.command === undefined ? {} : { command: contract.command }),
    };
    return (
      hasExactKeys(
        contract,
        [
          "kind",
          "id",
          "packageManager",
          "script",
          ...(packageCommandRequired ? ["command"] : []),
          "args",
          "classification",
          ...expectedFailure,
          ...(legacy ? ["legacy"] : []),
        ],
        packageCommandRequired ? [] : ["command"],
      ) &&
      validVerificationIdentity(contract) &&
      validatePackageScriptRunner(runner, packageCommandRequired) &&
      validVerificationArgs(contract.args) &&
      (!legacy ||
        (contract.packageManager === "bun" &&
          contract.script === "check" &&
          contract.command === undefined &&
          contract.args.length === 0))
    );
  }
  if (contract.kind !== "static-check") return false;
  const runner = contract.runner as Record<string, unknown> | undefined;
  const validRunner =
    validateExecutableRunner(runner, requirePackageCommand) ||
    (hasExactKeys(runner, ["kind", "script"]) &&
      runner.kind === "node" &&
      isValidRelativePath(runner.script));
  return (
    hasExactKeys(contract, [
      "kind",
      "id",
      "runner",
      "args",
      "classification",
      ...expectedFailure,
    ]) &&
    validVerificationIdentity(contract) &&
    validRunner &&
    validVerificationArgs(contract.args)
  );
}

function validateStructuredVerification(
  value: unknown,
): value is StructuredVerificationContract {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const contract = value as Record<string, unknown>;
  if (contract.kind !== "steps") {
    return validateAtomicVerification(contract, true);
  }
  if (
    !hasExactKeys(contract, ["kind", "id", "classification", "steps"]) ||
    typeof contract.id !== "string" ||
    contract.id.length === 0 ||
    contract.id.length > 128 ||
    !["expected-red", "expected-green", "expected-refactor"].includes(
      String(contract.classification),
    ) ||
    !Array.isArray(contract.steps) ||
    contract.steps.length === 0 ||
    contract.steps.length > 8 ||
    !contract.steps.every((step) => validateAtomicVerification(step, true))
  ) {
    return false;
  }
  const steps = contract.steps as AtomicVerificationContract[];
  return (
    steps
      .slice(0, -1)
      .every((step) => step.classification === "expected-green") &&
    steps.at(-1)?.classification === contract.classification &&
    new Set(steps.map((step) => step.id)).size === steps.length
  );
}

function normalizeLegacyVerification(
  contract: Record<string, unknown>,
): StructuredVerificationContract | null {
  if (
    !hasExactKeys(
      contract,
      ["id", "argv", "classification", "minTests"],
      ["expectedFailure"],
    ) ||
    !validVerificationIdentity(contract) ||
    !Number.isSafeInteger(contract.minTests) ||
    (contract.minTests as number) < 1 ||
    !Array.isArray(contract.argv) ||
    !contract.argv.every(validVerificationToken)
  ) {
    return null;
  }
  const argv = contract.argv as string[];
  const base = {
    id: contract.id as string,
    classification: contract.classification as VerificationClassification,
    ...(contract.expectedFailure === undefined
      ? {}
      : { expectedFailure: contract.expectedFailure as string }),
  };
  if (
    argv.length >= 4 &&
    argv[0] === "bun" &&
    argv[1] === "run" &&
    argv[2] === "test:target" &&
    argv
      .slice(3)
      .every((part) => part.startsWith("test/") && isValidRelativePath(part))
  ) {
    return {
      ...base,
      kind: "vitest",
      runner: {
        kind: "package-script",
        packageManager: "bun",
        script: "test:target",
      },
      testFiles: argv.slice(3),
      args: [],
      minTests: contract.minTests as number,
      legacy: true,
    };
  }
  if (
    argv.length === 3 &&
    argv[0] === "bun" &&
    argv[1] === "run" &&
    argv[2] === "check"
  ) {
    return {
      ...base,
      kind: "package-script",
      packageManager: "bun",
      script: "check",
      args: [],
      legacy: true,
    };
  }
  return null;
}

export function validateVerificationContract(
  value: unknown,
):
  | { ok: true; value: StructuredVerificationContract }
  | { ok: false; reason: string } {
  if (validateStructuredVerification(value)) {
    return { ok: true, value: structuredClone(value) };
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const legacy = normalizeLegacyVerification(
      value as Record<string, unknown>,
    );
    if (legacy) return { ok: true, value: legacy };
  }
  return {
    ok: false,
    reason: "verification contract is unsupported by the Implement runtime",
  };
}

export function verificationSteps(
  verification: VerificationContract,
): AtomicVerificationContract[] {
  const normalized = validateVerificationContract(verification);
  if (!normalized.ok) return [];
  return normalized.value.kind === "steps"
    ? structuredClone(normalized.value.steps)
    : [structuredClone(normalized.value)];
}

export function verificationInputPaths(
  verification: VerificationContract,
): string[] {
  return [
    ...new Set(
      verificationSteps(verification).flatMap((step) =>
        step.kind === "vitest"
          ? step.testFiles
          : step.kind === "static-check" && step.runner.kind === "node"
            ? [step.runner.script]
            : [],
      ),
    ),
  ];
}

export function cloneVerificationContract(
  verification: VerificationContract,
): StructuredVerificationContract {
  const normalized = validateVerificationContract(verification);
  if (!normalized.ok) throw new Error(normalized.reason);
  return structuredClone(normalized.value);
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
        !hasExactKeys(entry, ["kind", "sha256", "bytes"]) ||
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
        !hasExactKeys(entry, ["kind", "manifest"]) ||
        typeof entry.manifest !== "string" ||
        !SNAPSHOT_SHA256.test(entry.manifest)
      ) {
        return "invalid snapshot";
      }
    } else if (entry.kind === "absent") {
      if (!hasExactKeys(entry, ["kind", "absent"]) || entry.absent !== true) {
        return "invalid snapshot";
      }
    } else {
      return "invalid snapshot";
    }
  }
  if ([...new Set(paths)].some((path) => !Object.hasOwn(bounds, path))) {
    return "snapshot does not cover declared paths";
  }
  return null;
}

function validateAgentsContract(env: Record<string, unknown>): string | null {
  if (!(AGENTS_IMPACTS as readonly unknown[]).includes(env.agentsImpact)) {
    return "invalid AGENTS impact";
  }
  if (env.agentsManagedOnly !== true) return "AGENTS must be managed-only";
  if (env.agentsImpact === "none") {
    return env.agentsTarget === undefined
      ? null
      : "none AGENTS impact cannot declare a target";
  }
  return isAgentsPath(env.agentsTarget)
    ? null
    : "AGENTS impact requires an explicit AGENTS target";
}

function validateApprovedDependencies(value: unknown): string | null {
  if (
    !Array.isArray(value) ||
    value.some(
      (dependency) =>
        typeof dependency !== "string" ||
        !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/iu.test(
          dependency,
        ),
    ) ||
    new Set(value).size !== value.length
  ) {
    return "invalid approved dependencies";
  }
  return null;
}

function validateImpactClosure(
  value: unknown,
  declared: Record<string, unknown>,
  snapshot: unknown,
): string | null {
  if (
    !hasExactKeys(value, [
      "changedSurfaces",
      "searchEvidence",
      "relatedTests",
      "affectedSuite",
    ])
  ) {
    return "invalid impact closure";
  }
  const closure = value as Record<string, unknown>;
  const surfaces = closure.changedSurfaces;
  const searchEvidence = closure.searchEvidence;
  const relatedTests = closure.relatedTests;
  const affectedSuite = closure.affectedSuite;
  if (
    !Array.isArray(surfaces) ||
    surfaces.length === 0 ||
    surfaces.some(
      (surface) => !(IMPACT_SURFACES as readonly unknown[]).includes(surface),
    ) ||
    new Set(surfaces).size !== surfaces.length ||
    (surfaces.includes("none") && surfaces.length !== 1) ||
    !Array.isArray(searchEvidence) ||
    searchEvidence.some(
      (evidence) => typeof evidence !== "string" || evidence.length === 0,
    ) ||
    !Array.isArray(relatedTests) ||
    !Array.isArray(affectedSuite) ||
    affectedSuite.some(
      (test) => !isValidRelativePath(test) || !isTestPath(test),
    ) ||
    new Set(affectedSuite).size !== affectedSuite.length
  ) {
    return "invalid impact closure";
  }

  const scope = new Set([
    ...((declared.read as string[]) ?? []),
    ...((declared.write as string[]) ?? []),
  ]);
  const writes = new Set((declared.write as string[]) ?? []);
  const relatedPaths = new Set<string>();
  for (const item of relatedTests) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return "invalid impact closure related test";
    }
    const related = item as Record<string, unknown>;
    const relatedKeys =
      related.disposition === "regression-task"
        ? ["path", "disposition", "evidence", "regressionTaskId"]
        : ["path", "disposition", "evidence"];
    if (
      !hasExactKeys(related, relatedKeys) ||
      !isValidRelativePath(related.path) ||
      !isTestPath(related.path) ||
      relatedPaths.has(related.path) ||
      !scope.has(related.path) ||
      !["current-task", "regression-task", "unaffected"].includes(
        String(related.disposition),
      ) ||
      typeof related.evidence !== "string" ||
      related.evidence.length === 0
    ) {
      return "invalid impact closure related test";
    }
    relatedPaths.add(related.path);
    if (related.disposition === "current-task" && !writes.has(related.path)) {
      return "current-task related test is outside the write set";
    }
    if (
      related.disposition === "regression-task" &&
      (typeof related.regressionTaskId !== "string" ||
        related.regressionTaskId.length === 0)
    ) {
      return "regression task identity is required";
    }
    if (
      related.disposition !== "regression-task" &&
      related.regressionTaskId !== undefined
    ) {
      return "unexpected regression task identity";
    }
  }

  if (surfaces[0] === "none") return null;
  if (
    searchEvidence.length === 0 ||
    relatedTests.length === 0 ||
    affectedSuite.length === 0 ||
    affectedSuite.some((test) => !relatedPaths.has(test))
  ) {
    return "public impact closure is incomplete";
  }
  const bounds = snapshot as Record<string, { kind?: unknown }>;
  if (!affectedSuite.some((test) => bounds?.[test]?.kind === "file")) {
    return "affected suite contains no existing test evidence";
  }
  return null;
}

function isTestPath(path: string): boolean {
  return /^(?:test|tests)\//u.test(path);
}

export function validateAgentsCheckpointRequest(
  value: unknown,
):
  | { ok: true; value: AgentsCheckpointRequest }
  | { ok: false; reason: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "missing AGENTS checkpoint request" };
  }
  const request = value as Record<string, unknown>;
  if (
    request.stage !== "abel-implement" ||
    typeof request.taskId !== "string" ||
    request.taskId.length === 0 ||
    request.taskId.length > 128 ||
    request.agentsImpact === "none" ||
    !(AGENTS_IMPACTS as readonly unknown[]).includes(request.agentsImpact) ||
    !isAgentsPath(request.agentsTarget) ||
    request.agentsManagedOnly !== true ||
    request.stableCheckpoint !== true ||
    typeof request.diff !== "string" ||
    request.diff.length === 0 ||
    request.diff.length > LIMITS.maxCompleteResultBytes
  ) {
    return { ok: false, reason: "invalid AGENTS checkpoint contract" };
  }
  const snapshotReason = validateImplementationSnapshot(request.snapshot, [
    request.agentsTarget,
  ] as string[]);
  if (snapshotReason !== null) {
    return { ok: false, reason: snapshotReason };
  }
  return {
    ok: true,
    value: request as unknown as AgentsCheckpointRequest,
  };
}

export function validateAgentsCheckpointAttempt(
  value: unknown,
):
  | { ok: true; value: AgentsCheckpointAttempt }
  | { ok: false; reason: string } {
  if (
    !hasExactKeys(value, [
      "changeId",
      "taskId",
      "requestId",
      "snapshot",
      "diff",
    ]) ||
    !validIdentifier(value.changeId) ||
    !validIdentifier(value.taskId) ||
    !validIdentifier(value.requestId) ||
    typeof value.diff !== "string" ||
    value.diff.length === 0 ||
    value.diff.length > LIMITS.maxCompleteResultBytes ||
    !value.snapshot ||
    typeof value.snapshot !== "object" ||
    Array.isArray(value.snapshot) ||
    Object.keys(value.snapshot).length === 0 ||
    validateImplementationSnapshot(
      value.snapshot,
      Object.keys(value.snapshot as Record<string, unknown>),
    ) !== null
  ) {
    return { ok: false, reason: "invalid AGENTS checkpoint attempt" };
  }
  return {
    ok: true,
    value: structuredClone(value) as unknown as AgentsCheckpointAttempt,
  };
}

export function validateImplementApplyOperation(
  value: unknown,
):
  | { ok: true; value: ImplementApplyOperation }
  | { ok: false; reason: string } {
  if (
    !hasExactKeys(value, ["resultId", "requestId"]) ||
    !validIdentifier(value.resultId) ||
    !validIdentifier(value.requestId)
  ) {
    return { ok: false, reason: "invalid Implement apply operation" };
  }
  return {
    ok: true,
    value: { resultId: value.resultId, requestId: value.requestId },
  };
}

function validateCandidateRejection(
  value: unknown,
): value is CandidateRejection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const rejection = value as Record<string, unknown>;
  if (rejection.kind === "approval-boundary") {
    return (
      hasExactKeys(rejection, ["kind", "code"]) &&
      (APPROVAL_BOUNDARY_CODES as readonly unknown[]).includes(rejection.code)
    );
  }
  if (
    rejection.kind !== "artifact" ||
    rejection.code !== "parent-review-rejected" ||
    !hasExactKeys(rejection, ["kind", "code"], ["evidence"])
  ) {
    return false;
  }
  return (
    rejection.evidence === undefined ||
    (Array.isArray(rejection.evidence) &&
      rejection.evidence.length <= 8 &&
      rejection.evidence.every(
        (item) =>
          typeof item === "string" && item.length > 0 && item.length <= 512,
      ))
  );
}

export function validateImplementDiscardOperation(
  value: unknown,
):
  | { ok: true; value: ImplementDiscardOperation }
  | { ok: false; reason: string } {
  if (
    !hasExactKeys(value, ["resultId", "requestId", "rejection"]) ||
    !validIdentifier(value.resultId) ||
    !validIdentifier(value.requestId) ||
    !validateCandidateRejection(value.rejection)
  ) {
    return { ok: false, reason: "invalid Implement discard operation" };
  }
  return {
    ok: true,
    value: structuredClone(value) as unknown as ImplementDiscardOperation,
  };
}

function hasExactKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(record, key)) &&
    Object.keys(record).every((key) => allowed.has(key))
  );
}

function validIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function validatePathSet(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every(isValidRelativePath) &&
    new Set(value).size === value.length
  );
}

function validateRoots(value: unknown): value is string[] {
  if (!validatePathSet(value) || value.length === 0) return false;
  if (
    value.some(
      (root) => (root !== "." && root.startsWith("./")) || root.endsWith("/"),
    )
  ) {
    return false;
  }
  return !value.some((root, index) =>
    value.some(
      (other, otherIndex) =>
        index !== otherIndex && (root === "." || other.startsWith(`${root}/`)),
    ),
  );
}

function isWithinRoots(path: string, roots: string[]): boolean {
  return roots.some(
    (root) => root === "." || path === root || path.startsWith(`${root}/`),
  );
}

function validatePhaseBoundary(
  value: unknown,
  phase: ImplementationPhase,
): value is PhaseBoundary {
  if (
    !hasExactKeys(
      value,
      ["read", "write", "verification"],
      ["verificationLock"],
    )
  ) {
    return false;
  }
  if (
    !validatePathSet(value.read) ||
    !validatePathSet(value.write) ||
    value.write.some(isAgentsPath) ||
    (value.verificationLock !== undefined &&
      !isValidRelativePath(value.verificationLock))
  ) {
    return false;
  }
  const verification = validateVerificationContract(value.verification);
  if (!verification.ok) return false;
  const classification = {
    red: "expected-red",
    green: "expected-green",
    refactor: "expected-refactor",
  } as const;
  return verification.value.classification === classification[phase];
}

function validateTaskBoundary(
  value: unknown,
  snapshot: unknown,
): value is TaskBoundary {
  if (
    !hasExactKeys(value, [
      "changeId",
      "taskId",
      "objective",
      "context",
      "roots",
      "phases",
      "scheduling",
      "agents",
      "approvedDependencies",
      "impactClosure",
    ]) ||
    !validIdentifier(value.changeId) ||
    !validIdentifier(value.taskId) ||
    typeof value.objective !== "string" ||
    value.objective.length === 0 ||
    value.objective.length > 4096 ||
    !hasExactKeys(value.context, ["agents", "contract"]) ||
    typeof value.context.agents !== "string" ||
    typeof value.context.contract !== "string" ||
    !validateRoots(value.roots) ||
    !hasExactKeys(value.phases, ["red", "green"], ["refactor"]) ||
    !validatePhaseBoundary(value.phases.red, "red") ||
    !validatePhaseBoundary(value.phases.green, "green") ||
    (value.phases.refactor !== undefined &&
      !validatePhaseBoundary(value.phases.refactor, "refactor")) ||
    !hasExactKeys(value.scheduling, ["conflicts", "resources"]) ||
    !validatePathSet(value.scheduling.conflicts) ||
    !validatePathSet(value.scheduling.resources) ||
    !hasExactKeys(value.agents, ["impact", "managedOnly"], ["target"]) ||
    !(AGENTS_IMPACTS as readonly unknown[]).includes(value.agents.impact) ||
    value.agents.managedOnly !== true
  ) {
    return false;
  }
  if (
    value.agents.impact === "none"
      ? value.agents.target !== undefined
      : !isAgentsPath(value.agents.target)
  ) {
    return false;
  }
  if (validateApprovedDependencies(value.approvedDependencies) !== null) {
    return false;
  }
  const phases = [
    value.phases.red,
    value.phases.green,
    ...(value.phases.refactor ? [value.phases.refactor] : []),
  ];
  const roots = value.roots as string[];
  if (
    phases.some((phase) =>
      [
        ...phase.read,
        ...phase.write,
        ...verificationInputPaths(phase.verification),
      ].some((path) => !isWithinRoots(path, roots)),
    )
  ) {
    return false;
  }
  if (
    phases.some((phase) => {
      if (phase.verification.kind === undefined) return false;
      const declared = new Set([...phase.read, ...phase.write]);
      return verificationInputPaths(phase.verification).some(
        (input) => !declared.has(input),
      );
    })
  ) {
    return false;
  }
  const declared = {
    read: [...new Set(phases.flatMap((entry) => entry.read))],
    write: [...new Set(phases.flatMap((entry) => entry.write))],
  };
  return (
    validateImpactClosure(value.impactClosure, declared, snapshot) === null
  );
}

function normalizedTaskBoundary(value: TaskBoundary): TaskBoundary {
  const clone = structuredClone(value);
  clone.phases.red.verification = cloneVerificationContract(
    clone.phases.red.verification,
  );
  clone.phases.green.verification = cloneVerificationContract(
    clone.phases.green.verification,
  );
  if (clone.phases.refactor) {
    clone.phases.refactor.verification = cloneVerificationContract(
      clone.phases.refactor.verification,
    );
  }
  return clone;
}

function validatePhaseAttemptShape(value: unknown): value is PhaseAttempt {
  if (
    !hasExactKeys(value, [
      "changeId",
      "taskId",
      "requestId",
      "phase",
      "snapshot",
    ]) ||
    !validIdentifier(value.changeId) ||
    !validIdentifier(value.taskId) ||
    !validIdentifier(value.requestId) ||
    !["red", "green", "refactor"].includes(String(value.phase))
  ) {
    return false;
  }
  if (
    !value.snapshot ||
    typeof value.snapshot !== "object" ||
    Array.isArray(value.snapshot)
  ) {
    return false;
  }
  return (
    validateImplementationSnapshot(
      value.snapshot,
      Object.keys(value.snapshot as Record<string, unknown>),
    ) === null
  );
}

export function validatePhaseAttemptAgainstBoundary(
  boundary: TaskBoundary,
  attempt: PhaseAttempt,
): string | null {
  if (
    attempt.changeId !== boundary.changeId ||
    attempt.taskId !== boundary.taskId
  ) {
    return "task attempt identity mismatch";
  }
  const phase = boundary.phases[attempt.phase];
  if (!phase) return "task attempt phase is not declared";
  const snapshotReason = validateImplementationSnapshot(attempt.snapshot, [
    ...phase.read,
    ...phase.write,
  ]);
  if (snapshotReason !== null) return snapshotReason;
  const bounds = attempt.snapshot as Record<string, { kind?: unknown }>;
  if (
    phase.write.some(
      (path) =>
        bounds[path]?.kind !== "file" && bounds[path]?.kind !== "absent",
    )
  ) {
    return "write snapshot must bind a regular file or absent path";
  }
  return null;
}

function validateImplementRunRequest(
  value: unknown,
): { ok: true; value: ImplementRunRequest } | { ok: false; reason: string } {
  const serialized = JSON.stringify(value);
  if (serialized.length > LIMITS.maxEnvelopeBytes) {
    return {
      ok: false,
      reason: `request envelope exceeds ${LIMITS.maxEnvelopeBytes / 1024} KiB`,
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "missing request envelope" };
  }
  const request = value as Record<string, unknown>;
  if (request.kind === "open-task") {
    if (
      request.attempt &&
      typeof request.attempt === "object" &&
      !Array.isArray(request.attempt) &&
      !Object.hasOwn(request.attempt, "snapshot")
    ) {
      return { ok: false, reason: "invalid snapshot" };
    }
    if (
      !hasExactKeys(request, ["stage", "kind", "boundary", "attempt"]) ||
      !validatePhaseAttemptShape(request.attempt) ||
      !validateTaskBoundary(request.boundary, request.attempt.snapshot)
    ) {
      return { ok: false, reason: "invalid task open contract" };
    }
    const boundary = request.boundary as TaskBoundary;
    const attempt = request.attempt as PhaseAttempt;
    const attemptReason = validatePhaseAttemptAgainstBoundary(
      boundary,
      attempt,
    );
    if (attempt.phase !== "red" || attemptReason !== null) {
      return {
        ok: false,
        reason:
          attempt.phase !== "red"
            ? "task open must begin with Red"
            : (attemptReason ?? "invalid phase attempt"),
      };
    }
    return {
      ok: true,
      value: {
        stage: "abel-implement",
        kind: "open-task",
        boundary: normalizedTaskBoundary(boundary),
        attempt: structuredClone(attempt),
      },
    };
  }
  if (request.kind === "phase-attempt") {
    if (
      !hasExactKeys(request, ["stage", "kind", "attempt"]) ||
      !validatePhaseAttemptShape(request.attempt)
    ) {
      return { ok: false, reason: "invalid phase attempt contract" };
    }
    return {
      ok: true,
      value: structuredClone(request) as ImplementRunRequest,
    };
  }
  return { ok: false, reason: "invalid Implement run kind" };
}

export function validateRequestEnvelope(
  value: unknown,
): { ok: true; value: RunRequest } | { ok: false; reason: string } {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).stage === "abel-implement"
  ) {
    return validateImplementRunRequest(value);
  }
  return validateLegacyRequestEnvelope(value);
}

function validateLegacyRequestEnvelope(
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
  if ((decl.write as unknown[]).some(isAgentsPath)) {
    return { ok: false, reason: "subagents cannot declare AGENTS writes" };
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
    const agentsReason = validateAgentsContract(env);
    if (agentsReason !== null) return { ok: false, reason: agentsReason };
    const dependenciesReason = validateApprovedDependencies(
      env.approvedDependencies,
    );
    if (dependenciesReason !== null) {
      return { ok: false, reason: dependenciesReason };
    }
    const closureReason = validateImpactClosure(
      env.impactClosure,
      decl,
      env.snapshot,
    );
    if (closureReason !== null) return { ok: false, reason: closureReason };
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

export interface CompactEvidenceResult {
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

export interface DesignEvidenceResult {
  id: string;
  role: "design-explorer";
  kind: "evidence";
  packet_id: string;
  module_name: string;
  scope: string[];
  files_read: string[];
  evidence: Array<{
    claim: string;
    path: string;
    line_start: number;
    line_end: number;
  }>;
  existing_structures: string[];
  existing_conventions: string[];
  constraints_discovered: string[];
  open_questions: string[];
  dependencies: string[];
  write_set_hints: string[];
  validation_hints: string[];
  agents_impact_hints: string[];
  risks: string[];
  success_criteria_hints: string[];
}

export type EvidenceResult = CompactEvidenceResult | DesignEvidenceResult;

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
  contractCompliant: boolean;
}

export interface ApplyResult {
  targets: string[];
  checkExitCode: 0;
  applyExitCode: 0;
  sequence?: number;
}

export interface AgentsCheckpointResult {
  target: string;
  agentsImpact: Exclude<TaskBoundary["agents"]["impact"], "none">;
  checkExitCode: 0;
  applyExitCode: 0;
  sequence?: number;
}

export type ImplementOutcome =
  | {
      kind: "deferred";
      requestId: string;
      taskId: string;
      reason: "task-conflict";
    }
  | {
      kind: "candidate";
      requestId: string;
      taskId: string;
      phase: ImplementationPhase;
      resultId: string;
      result: DiffResult;
    }
  | {
      kind: "applied";
      requestId: string;
      taskId: string;
      phase: "red" | "green";
      readyPhase: "green" | "refactor";
      result: ApplyResult;
    }
  | {
      kind: "checkpoint-required";
      requestId: string;
      taskId: string;
      finalPhase: "green" | "refactor";
      result: ApplyResult;
    }
  | {
      kind: "retry";
      requestId: string;
      taskId: string;
      scope: "worker" | "checkpoint";
      phase: ImplementationPhase;
      cause: "artifact" | "stale";
      remainingAttempts: 1;
    }
  | {
      kind: "completed";
      requestId: string;
      taskId: string;
      finalPhase: "green" | "refactor";
      result?: ApplyResult | AgentsCheckpointResult;
    }
  | {
      kind: "blocked";
      requestId: string;
      taskId: string;
      phase: ImplementationPhase;
      failure: TaskFailure;
    }
  | {
      kind: "cancelled";
      requestId: string;
      taskId: string;
      phase: ImplementationPhase;
    };

export function validateEvidenceResult(value: unknown): {
  ok: boolean;
  reason?: string;
  failure?: CandidateFailure;
} {
  if (value === null || typeof value !== "object")
    return { ok: false, reason: "missing result" };
  const r = value as Record<string, unknown>;
  if (r.kind !== "evidence") return { ok: false, reason: "wrong result kind" };
  if (r.role === "design-explorer") return validateDesignEvidenceResult(r);
  const fields = [
    "id",
    "role",
    "kind",
    "conclusions",
    "citations",
    "constraints",
    "dependencies",
    "risks",
    "blockingQuestions",
    "hints",
  ] as const;
  if (!hasExactKeys(r, fields)) {
    return { ok: false, reason: "invalid evidence result fields" };
  }
  if (!validIdentifier(r.id) || typeof r.role !== "string")
    return { ok: false, reason: "invalid identity" };
  if (!(ROLES as readonly string[]).includes(r.role))
    return { ok: false, reason: "unknown role" };
  for (const field of [
    "conclusions",
    "constraints",
    "dependencies",
    "risks",
    "blockingQuestions",
  ] as const) {
    if (
      !Array.isArray(r[field]) ||
      !r[field].every((entry) => typeof entry === "string")
    ) {
      return { ok: false, reason: `invalid evidence field: ${field}` };
    }
  }
  if (
    !Array.isArray(r.citations) ||
    r.citations.some(
      (citation) =>
        !hasExactKeys(citation, ["path", "lines"]) ||
        !isValidRelativePath(citation.path) ||
        typeof citation.lines !== "string",
    )
  ) {
    return { ok: false, reason: "invalid evidence citations" };
  }
  if (
    !hasExactKeys(r.hints, ["writeSet", "verification", "agentsImpact"]) ||
    !validatePathSet(r.hints.writeSet) ||
    typeof r.hints.verification !== "string" ||
    !(AGENTS_IMPACTS as readonly unknown[]).includes(r.hints.agentsImpact)
  ) {
    return { ok: false, reason: "invalid evidence hints" };
  }
  const serialized = JSON.stringify(r);
  if (Buffer.byteLength(serialized, "utf8") > LIMITS.maxCompleteResultBytes) {
    return {
      ok: false,
      reason: `result exceeds ${LIMITS.maxCompleteResultBytes} bytes`,
      failure: {
        kind: "result-limit",
        limitBytes: LIMITS.maxCompleteResultBytes,
      },
    };
  }
  return { ok: true };
}

function validateDesignEvidenceResult(r: Record<string, unknown>): {
  ok: boolean;
  reason?: string;
  failure?: CandidateFailure;
} {
  const fields = [
    "id",
    "role",
    "kind",
    "packet_id",
    "module_name",
    "scope",
    "files_read",
    "evidence",
    "existing_structures",
    "existing_conventions",
    "constraints_discovered",
    "open_questions",
    "dependencies",
    "write_set_hints",
    "validation_hints",
    "agents_impact_hints",
    "risks",
    "success_criteria_hints",
  ] as const;
  if (!hasExactKeys(r, fields)) {
    return { ok: false, reason: "invalid Design evidence result fields" };
  }
  if (
    !validIdentifier(r.id) ||
    r.packet_id !== r.id ||
    !validIdentifier(r.module_name)
  ) {
    return { ok: false, reason: "invalid Design evidence identity" };
  }
  if (!validatePathSet(r.scope) || r.scope.length === 0) {
    return { ok: false, reason: "invalid Design evidence scope" };
  }
  if (!validatePathSet(r.files_read) || !validatePathSet(r.write_set_hints)) {
    return { ok: false, reason: "invalid Design evidence path set" };
  }
  if (
    !Array.isArray(r.evidence) ||
    r.evidence.some(
      (entry) =>
        !hasExactKeys(entry, ["claim", "path", "line_start", "line_end"]) ||
        typeof entry.claim !== "string" ||
        entry.claim.length === 0 ||
        !isValidRelativePath(entry.path) ||
        !Number.isSafeInteger(entry.line_start) ||
        !Number.isSafeInteger(entry.line_end) ||
        (entry.line_start as number) < 1 ||
        (entry.line_end as number) < (entry.line_start as number),
    )
  ) {
    return { ok: false, reason: "invalid Design evidence citations" };
  }
  for (const field of [
    "existing_structures",
    "existing_conventions",
    "constraints_discovered",
    "open_questions",
    "dependencies",
    "validation_hints",
    "agents_impact_hints",
    "risks",
    "success_criteria_hints",
  ] as const) {
    if (
      !Array.isArray(r[field]) ||
      !r[field].every((entry) => typeof entry === "string")
    ) {
      return {
        ok: false,
        reason: `invalid Design evidence field: ${field}`,
      };
    }
  }
  const serialized = JSON.stringify(r);
  if (Buffer.byteLength(serialized, "utf8") > LIMITS.maxCompleteResultBytes) {
    return {
      ok: false,
      reason: `result exceeds ${LIMITS.maxCompleteResultBytes} bytes`,
      failure: {
        kind: "result-limit",
        limitBytes: LIMITS.maxCompleteResultBytes,
      },
    };
  }
  return { ok: true };
}

export function validateDiffResult(value: unknown): {
  ok: boolean;
  reason?: string;
  paths?: string[];
  failure?: CandidateFailure;
} {
  if (value === null || typeof value !== "object")
    return { ok: false, reason: "missing result" };
  const r = value as Record<string, unknown>;
  if (r.kind !== "diff") return { ok: false, reason: "wrong result kind" };
  const fields = [
    "id",
    "role",
    "kind",
    "taskId",
    "phase",
    "summary",
    "diff",
    "expectedVerification",
    "risks",
    "contractCompliant",
  ] as const;
  if (!hasExactKeys(r, fields)) {
    return { ok: false, reason: "invalid diff result fields" };
  }
  for (const field of fields) {
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
    r.expectedVerification.length === 0
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
  if (Buffer.byteLength(serialized, "utf8") > LIMITS.maxCompleteResultBytes) {
    return {
      ok: false,
      reason: `result exceeds ${LIMITS.maxCompleteResultBytes} bytes`,
      failure: {
        kind: "result-limit",
        limitBytes: LIMITS.maxCompleteResultBytes,
      },
    };
  }
  return { ok: true, paths };
}
