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
  "structural-identity-mismatch",
  "invalid-verification-contract",
  "lockfile-bound-mismatch",
  "noncanonical-path",
  "nonregular-mode",
  "outside-managed-region",
  "package-bound-mismatch",
  "package-manifest-invalid",
  "parent-review-rejected",
  "producer-output-unavailable",
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
  "child-session-create",
  "child-provider-stream",
  "child-timeout",
  "child-finalization",
  "structural-submit",
  "candidate-retention",
  "candidate-diff",
  "candidate-preflight",
  "parent-review",
  "candidate-apply",
  "agents-checkpoint",
  "phase-runtime",
] as const;

export const SUBMIT_FINAL_CATEGORIES = [
  "no-final-assistant",
  "text-only",
  "mixed",
  "multiple-submit",
  "single-submit-only",
] as const;
export const SUBMIT_SCHEMA_STATES = [
  "not-submitted",
  "valid",
  "invalid",
] as const;
export const IDENTITY_DIMENSIONS = [
  "request",
  "role",
  "task",
  "phase",
] as const;

export type ArtifactFailureCode = (typeof ARTIFACT_FAILURE_CODES)[number];
export type StaleFailureCode = (typeof STALE_FAILURE_CODES)[number];
export type EnvironmentFailureCode = (typeof ENVIRONMENT_FAILURE_CODES)[number];
export type ApprovalBoundaryCode = (typeof APPROVAL_BOUNDARY_CODES)[number];
export type VerificationAdapterCode =
  (typeof VERIFICATION_ADAPTER_CODES)[number];
export type ChildTransportCode = (typeof CHILD_TRANSPORT_CODES)[number];
export type FailureStage = (typeof FAILURE_STAGES)[number];
export type SubmitFinalCategory = (typeof SUBMIT_FINAL_CATEGORIES)[number];
export type SubmitSchemaState = (typeof SUBMIT_SCHEMA_STATES)[number];
export type IdentityDimension = (typeof IDENTITY_DIMENSIONS)[number];

export interface SafeFailureDetails {
  finalCategory?: SubmitFinalCategory;
  submitAttempts?: number;
  schema?: SubmitSchemaState;
  identityMismatch?: IdentityDimension[];
  verificationId?: string;
}

export interface SafeFailureDiagnostic {
  code: ArtifactFailureCode | StaleFailureCode | ChildTransportCode;
  stage: FailureStage;
  details?: SafeFailureDetails;
}

export type EnvironmentFailure = {
  kind: "environment";
  code: EnvironmentFailureCode;
  message?: string;
  stage?: FailureStage;
};

export type CandidateFailure =
  | {
      kind: "artifact";
      code: ArtifactFailureCode;
      stage: FailureStage;
      details?: SafeFailureDetails;
    }
  | { kind: "stale"; code: StaleFailureCode; stage: FailureStage }
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
      stage: FailureStage;
      details?: SafeFailureDetails;
    };

export type CandidateRejection =
  | {
      kind: "artifact";
      code: "parent-review-rejected";
      stage: "parent-review";
    }
  | { kind: "approval-boundary"; code: ApprovalBoundaryCode };

export type TaskFailure =
  | { kind: "approval-boundary"; code: ApprovalBoundaryCode }
  | { kind: "verification-adapter"; code: VerificationAdapterCode }
  | {
      kind: "graph-readiness";
      diagnostic: ImplementGraphReadinessDiagnostic;
    }
  | {
      kind: "attempts-exhausted";
      cause: "artifact" | "stale" | "transport";
      attemptsUsed: 2;
      lastFailure: SafeFailureDiagnostic;
    }
  | {
      kind: "checkpoint-attempts-exhausted";
      cause: "artifact" | "stale";
      attemptsUsed: 2;
      lastFailure: SafeFailureDiagnostic;
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
}

export type PackageManager = "bun" | "npm" | "pnpm" | "yarn";

export interface PackageScriptRunner {
  kind: "package-script";
  packageManager: PackageManager;
  script: string;
  command: string;
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
  command: string;
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

export type StructuredVerificationContract =
  | AtomicVerificationContract
  | VerificationStepsContract;

export type VerificationContract = StructuredVerificationContract;

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

export const IMPLEMENTATION_PHASES = ["red", "green", "refactor"] as const;
export type ImplementationPhase = (typeof IMPLEMENTATION_PHASES)[number];

export type VerificationInputBinding =
  | { kind: "workspace"; path: string }
  | { kind: "output"; outputId: string };

export interface PhaseBoundary {
  read: string[];
  write: string[];
  verification: VerificationContract;
  verificationInputs: VerificationInputBinding[];
  verificationLock?: string;
}

export interface TaskBoundary {
  changeId: string;
  taskId: string;
  dependsOn: string[];
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

export interface ImplementGraphOutput {
  id: string;
  path: string;
  producer: { taskId: string; phase: ImplementationPhase };
  postcondition: "regular-file";
}

export type ImplementTaskBoundary = Omit<TaskBoundary, "changeId">;

export interface ImplementGraphBoundary {
  changeId: string;
  tasks: ImplementTaskBoundary[];
  outputs: ImplementGraphOutput[];
}

export const IMPLEMENT_GRAPH_READINESS_CODES = [
  "dependency-blocked",
  "dependency-cycle",
  "duplicate-output-id",
  "duplicate-task-id",
  "graph-hash-mismatch",
  "invalid-implement-graph",
  "invalid-output-path",
  "multiple-output-producers",
  "output-not-declared",
  "output-producer-invalid",
  "output-write-not-approved",
  "phase-blocked",
  "producer-not-dependency",
  "producer-output-unavailable",
  "producer-phase-after-consumer",
  "unknown-dependency",
  "verification-input-binding-mismatch",
  "workspace-input-has-producer",
  "workspace-input-unavailable",
] as const;

export type ImplementGraphReadinessCode =
  (typeof IMPLEMENT_GRAPH_READINESS_CODES)[number];

type ImplementGraphDiagnosticDetails = Partial<{
  taskId: string;
  phase: ImplementationPhase;
  verificationId: string;
  outputId: string;
  path: string;
  producerTaskId: string;
  producerPhase: ImplementationPhase;
  dependencyTaskId: string;
}>;

export type ImplementGraphReadinessDiagnostic =
  | ({
      kind: "graph-readiness";
      code: ImplementGraphReadinessCode;
    } & ImplementGraphDiagnosticDetails)
  | ({
      kind: "verification-adapter";
      code: VerificationAdapterCode;
      taskId: string;
      phase: ImplementationPhase;
      verificationId: string;
    } & ImplementGraphDiagnosticDetails)
  | ({
      kind: "design-readiness";
      code: "verification-contract-unsupported";
      taskId: string;
      phase: ImplementationPhase;
      verificationId?: string;
    } & ImplementGraphDiagnosticDetails);

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
      kind: "admit-graph";
      graph: ImplementGraphBoundary;
      graphHash: string;
      state: { completedTasks: string[]; blockedTasks: string[] };
    }
  | {
      stage: "abel-implement";
      kind: "task-attempt";
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
    !/^[a-z]:\//iu.test(p) &&
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
): value is PackageScriptRunner {
  if (
    !hasExactKeys(value, ["kind", "packageManager", "script", "command"]) ||
    value.kind !== "package-script" ||
    !["bun", "npm", "pnpm", "yarn"].includes(String(value.packageManager)) ||
    typeof value.script !== "string" ||
    !VERIFICATION_NAME.test(value.script) ||
    value.script.includes("/") ||
    !validScriptCommand(value.command)
  ) {
    return false;
  }
  return true;
}

function validateExecutableRunner(value: unknown): value is ExecutableRunner {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const runner = value as Record<string, unknown>;
  if (runner.kind === "package-script") {
    return validatePackageScriptRunner(runner);
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

function validateVitestRunner(value: ExecutableRunner): boolean {
  if (value.kind === "package-script") {
    const tokens = value.command.split(/\s+/u);
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
): value is AtomicVerificationContract {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const contract = value as Record<string, unknown>;
  const expectedFailure =
    contract.classification === "expected-red" ? ["expectedFailure"] : [];
  if (contract.kind === "vitest") {
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
      ]) &&
      validVerificationIdentity(contract) &&
      validateExecutableRunner(contract.runner) &&
      validateVitestRunner(executableRunner) &&
      Array.isArray(contract.testFiles) &&
      contract.testFiles.length > 0 &&
      contract.testFiles.length <= 64 &&
      contract.testFiles.every(isValidRelativePath) &&
      new Set(contract.testFiles).size === contract.testFiles.length &&
      validVerificationArgs(contract.args) &&
      Number.isSafeInteger(contract.minTests) &&
      (contract.minTests as number) >= 1
    );
  }
  if (contract.kind === "package-script") {
    const runner = {
      kind: "package-script",
      packageManager: contract.packageManager,
      script: contract.script,
      command: contract.command,
    };
    return (
      hasExactKeys(contract, [
        "kind",
        "id",
        "packageManager",
        "script",
        "command",
        "args",
        "classification",
        ...expectedFailure,
      ]) &&
      validVerificationIdentity(contract) &&
      validatePackageScriptRunner(runner) &&
      validVerificationArgs(contract.args)
    );
  }
  if (contract.kind !== "static-check") return false;
  const runner = contract.runner as Record<string, unknown> | undefined;
  const validRunner =
    validateExecutableRunner(runner) ||
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
    return validateAtomicVerification(contract);
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
    !contract.steps.every((step) => validateAtomicVerification(step))
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

export function validateVerificationContract(
  value: unknown,
):
  | { ok: true; value: StructuredVerificationContract }
  | { ok: false; reason: string } {
  if (validateStructuredVerification(value)) {
    return { ok: true, value: structuredClone(value) };
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
      verificationSteps(verification).flatMap((step) => {
        const paths =
          step.kind === "vitest"
            ? [...step.testFiles]
            : step.kind === "static-check" && step.runner.kind === "node"
              ? [step.runner.script]
              : [];
        if (
          step.kind === "package-script" ||
          ("runner" in step && step.runner.kind === "package-script")
        ) {
          paths.push("package.json");
        }
        return paths;
      }),
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
  const bounds = snapshot as Record<string, { kind?: unknown }> | undefined;
  if (
    bounds !== undefined &&
    !affectedSuite.some((test) => bounds[test]?.kind === "file")
  ) {
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
    rejection.stage !== "parent-review" ||
    !hasExactKeys(rejection, ["kind", "code", "stage"])
  ) {
    return false;
  }
  return true;
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

function validateIdentifierSet(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every(validIdentifier) &&
    new Set(value).size === value.length
  );
}

function validateVerificationInputBindings(
  value: unknown,
): value is VerificationInputBinding[] {
  if (!Array.isArray(value)) return false;
  const keys = new Set<string>();
  for (const binding of value) {
    if (
      binding &&
      typeof binding === "object" &&
      !Array.isArray(binding) &&
      (binding as { kind?: unknown }).kind === "workspace" &&
      hasExactKeys(binding, ["kind", "path"]) &&
      isValidRelativePath(binding.path)
    ) {
      if (keys.has(`workspace:${binding.path}`)) return false;
      keys.add(`workspace:${binding.path}`);
      continue;
    }
    if (
      binding &&
      typeof binding === "object" &&
      !Array.isArray(binding) &&
      (binding as { kind?: unknown }).kind === "output" &&
      hasExactKeys(binding, ["kind", "outputId"]) &&
      validIdentifier(binding.outputId)
    ) {
      if (keys.has(`output:${binding.outputId}`)) return false;
      keys.add(`output:${binding.outputId}`);
      continue;
    }
    return false;
  }
  return true;
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
      ["read", "write", "verification", "verificationInputs"],
      ["verificationLock"],
    )
  ) {
    return false;
  }
  if (
    !validatePathSet(value.read) ||
    !validatePathSet(value.write) ||
    !validateVerificationInputBindings(value.verificationInputs) ||
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
      "dependsOn",
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
    !validateIdentifierSet(value.dependsOn) ||
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

export type ImplementGraphContractDiagnostic =
  | { code: "invalid-implement-graph" }
  | { code: "invalid-output-path"; outputId?: string };

export function validateImplementGraphBoundary(value: unknown):
  | { ok: true; value: ImplementGraphBoundary }
  | {
      ok: false;
      reason: string;
      diagnostic: ImplementGraphContractDiagnostic;
    } {
  if (
    !hasExactKeys(value, ["changeId", "tasks", "outputs"]) ||
    !validIdentifier(value.changeId) ||
    !Array.isArray(value.tasks) ||
    value.tasks.length === 0 ||
    value.tasks.length > 128 ||
    !Array.isArray(value.outputs) ||
    value.outputs.length > 512
  ) {
    return {
      ok: false,
      reason: "invalid Implement graph boundary",
      diagnostic: { code: "invalid-implement-graph" },
    };
  }

  for (const candidate of value.tasks) {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      return {
        ok: false,
        reason: "invalid Implement task boundary",
        diagnostic: { code: "invalid-implement-graph" },
      };
    }
    const task = candidate as Record<string, unknown>;
    const phases = task.phases as Record<string, unknown> | undefined;
    if (
      Object.hasOwn(task, "changeId") ||
      !Object.hasOwn(task, "dependsOn") ||
      !validateIdentifierSet(task.dependsOn) ||
      !phases ||
      !["red", "green"].every((phase) => {
        const boundary = phases[phase];
        return (
          boundary !== null &&
          typeof boundary === "object" &&
          !Array.isArray(boundary) &&
          Object.hasOwn(boundary, "verificationInputs")
        );
      }) ||
      (phases.refactor !== undefined &&
        (!phases.refactor ||
          typeof phases.refactor !== "object" ||
          Array.isArray(phases.refactor) ||
          !Object.hasOwn(phases.refactor, "verificationInputs"))) ||
      !validateTaskBoundary({ changeId: value.changeId, ...task }, undefined)
    ) {
      return {
        ok: false,
        reason: "invalid Implement task boundary",
        diagnostic: { code: "invalid-implement-graph" },
      };
    }
  }

  for (const candidate of value.outputs) {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      return {
        ok: false,
        reason: "invalid Implement graph output",
        diagnostic: { code: "invalid-implement-graph" },
      };
    }
    const output = candidate as Record<string, unknown>;
    if (!isValidRelativePath(output.path)) {
      return {
        ok: false,
        reason: "invalid Implement graph output path",
        diagnostic: {
          code: "invalid-output-path",
          ...(validIdentifier(output.id) ? { outputId: output.id } : {}),
        },
      };
    }
    if (
      !hasExactKeys(output, ["id", "path", "producer", "postcondition"]) ||
      !validIdentifier(output.id) ||
      !hasExactKeys(output.producer, ["taskId", "phase"]) ||
      !validIdentifier(output.producer.taskId) ||
      !(IMPLEMENTATION_PHASES as readonly unknown[]).includes(
        output.producer.phase,
      ) ||
      output.postcondition !== "regular-file"
    ) {
      return {
        ok: false,
        reason: "invalid Implement graph output",
        diagnostic: { code: "invalid-implement-graph" },
      };
    }
  }

  return {
    ok: true,
    value: structuredClone(value) as unknown as ImplementGraphBoundary,
  };
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
  const phases = [
    boundary.phases.red,
    boundary.phases.green,
    ...(boundary.phases.refactor ? [boundary.phases.refactor] : []),
  ];
  return validateImpactClosure(
    boundary.impactClosure,
    {
      read: [...new Set(phases.flatMap((entry) => entry.read))],
      write: [...new Set(phases.flatMap((entry) => entry.write))],
    },
    attempt.snapshot,
  );
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
  if (request.kind === "admit-graph") {
    const state = request.state as Record<string, unknown>;
    if (
      !hasExactKeys(request, [
        "stage",
        "kind",
        "graph",
        "graphHash",
        "state",
      ]) ||
      typeof request.graphHash !== "string" ||
      !SNAPSHOT_SHA256.test(request.graphHash) ||
      !hasExactKeys(state, ["completedTasks", "blockedTasks"]) ||
      !validateIdentifierSet(state.completedTasks) ||
      !validateIdentifierSet(state.blockedTasks)
    ) {
      return { ok: false, reason: "invalid Implement graph admission" };
    }
    const completedTasks = state.completedTasks as string[];
    const blockedTasks = state.blockedTasks as string[];
    if (completedTasks.some((taskId) => blockedTasks.includes(taskId))) {
      return { ok: false, reason: "invalid Implement graph admission" };
    }
    const graph = validateImplementGraphBoundary(request.graph);
    if (!graph.ok) return { ok: false, reason: graph.reason };
    const taskIds = new Set(graph.value.tasks.map((task) => task.taskId));
    if (
      [...completedTasks, ...blockedTasks].some(
        (taskId) => !taskIds.has(taskId),
      )
    ) {
      return { ok: false, reason: "unknown Implement graph task state" };
    }
    return {
      ok: true,
      value: {
        stage: "abel-implement",
        kind: "admit-graph",
        graph: graph.value,
        graphHash: request.graphHash,
        state: structuredClone({ completedTasks, blockedTasks }),
      },
    };
  }
  if (request.kind === "task-attempt") {
    if (
      !hasExactKeys(request, ["stage", "kind", "attempt"]) ||
      !validatePhaseAttemptShape(request.attempt)
    ) {
      return { ok: false, reason: "invalid task attempt contract" };
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
  return validateNonImplementRequestEnvelope(value);
}

function validateNonImplementRequestEnvelope(
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
      kind: "graph-admitted";
      changeId: string;
      graphHash: string;
      readyTasks: string[];
      blockedTasks: string[];
    }
  | {
      kind: "graph-rejected";
      changeId: string;
      graphHash: string;
      diagnostics: ImplementGraphReadinessDiagnostic[];
    }
  | {
      kind: "dependency-blocked";
      requestId: string;
      taskId: string;
      phase: ImplementationPhase;
      diagnostics: ImplementGraphReadinessDiagnostic[];
    }
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
      lastFailure: SafeFailureDiagnostic;
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
      result?: ApplyResult;
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
    return {
      ok: false,
      reason: `invalid diff: ${(err as Error).message}`,
      failure: {
        kind: "artifact",
        code: "invalid-diff",
        stage: "candidate-diff",
      },
    };
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
