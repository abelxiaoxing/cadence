// Strict request/result contracts for the private orchestration kernel.
// Structural validation only; no runtime dependency on a schema library.

export type {
  ControlCommand,
  ControlCommandName,
  ControlCommandValidation,
  ControlStage,
} from "./control-contracts.ts";
export {
  assertControlCommand,
  CONTROL_COMMANDS,
  CONTROL_STAGES,
  controlRunKey,
  validateControlCommand,
} from "./control-contracts.ts";

export const STAGES = [
  "abel-design",
  "abel-implement",
  "abel-diagnose",
] as const;
export const ROLES = [
  "design-explorer",
  "implementation-worker",
  "diagnosis-worker",
] as const;
export const OUTPUT_KINDS = ["evidence", "diff"] as const;
export const PHASES = ["evidence", "red", "green", "refactor"] as const;

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
  maxEnvelopeBytes: 64 * 1024,
  phaseTimeoutMs: 20 * 60 * 1000,
  maxCompleteResultBytes: 64 * 1024,
} as const;

/** Shared collection bounds for runtime verification and author-facing schemas. */
export const VERIFICATION_LIMITS = Object.freeze({
  minSteps: 1,
  maxSteps: 8,
  minTestFiles: 1,
  maxTestFiles: 64,
});

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
  "child-provider-authentication-failed",
  "bubblewrap-launch-failed",
  "bubblewrap-or-dependency-unavailable",
  "bun-executable-unavailable",
  "checkpoint-unavailable",
  "checkout-cleanup-failed",
  "checkout-failed",
  "clone-alternates",
  "clone-failed",
  "dependency-path-unsafe",
  "git-apply-check-unavailable",
  "git-apply-failed",
  "git-apply-unavailable",
  "git-ignore-check-failed",
  "git-index-unavailable",
  "invalid-subagent-endpoint",
  "root-unavailable",
  "sandbox-runtime-unavailable",
] as const;
export const APPROVAL_BOUNDARY_CODES = [
  "unapproved-dependency-change",
  "behavior-contract-insufficient",
  "architecture-contract-insufficient",
  "task-scope-insufficient",
  "conflict-resource-authority-insufficient",
  "verification-contract-insufficient",
  "agents-contract-insufficient",
  "irreversible-scope-insufficient",
] as const;
export const VERIFICATION_ADAPTER_CODES = [
  "input-missing",
  "local-executable-missing",
  "runner-missing",
  "script-command-mismatch",
  "script-missing",
  "script-unsafe",
  "report-arguments-conflict",
  "verification-config-mismatch",
  "verification-config-unsafe",
] as const;
export const CHILD_TRANSPORT_CODES = [
  "child-provider-rate-limited",
  "first-progress-timeout",
  "stream-idle-timeout",
  "attempt-timeout",
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
  | {
      kind: "execution-limit";
      code: "child-turn-limit" | "child-context-limit";
    }
  | CandidateFailure
  | {
      kind: "transport";
      code: ChildTransportCode;
      stage: FailureStage;
      details?: SafeFailureDetails;
    };

const NONCANONICAL = /(^|\/)\.\.(\/|$)|(^|\/)\/|^\//;

export type VerificationClassification =
  | "expected-red"
  | "expected-green"
  | "expected-refactor";

export interface VerificationFailureSummary {
  verificationId: string;
  code: string;
  exitCode?: number;
  failures: string[];
  stdout: string;
  stderr: string;
  truncated: boolean;
  nextStep: string;
}

/** Runtime-owned evidence; unavailable checks never become product baselines. */
export interface VerificationEvidence {
  id: string;
  exitCode: number;
  classification: VerificationClassification;
  tests?: number;
  failureIdentities: string[];
  policy: "report-file-v3";
  attributionReliable?: boolean;
}
export type VerificationObservation =
  | { kind: "accepted"; evidence: VerificationEvidence }
  | {
      kind: "rejected";
      code: "red-not-witnessed" | "verification-rejected";
      evidence: VerificationEvidence;
      diagnostic?: VerificationFailureSummary;
    }
  | {
      kind: "unavailable";
      category: "environment" | "adapter" | "resource";
      code: string;
      verificationId: string;
      diagnostic?: VerificationFailureSummary;
    }
  | { kind: "cancelled" };

interface VerificationBase {
  id: string;
  classification: VerificationClassification;
  expectedFailure?: string;
  executionBindings?: Record<string, string | null>;
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
  delete: string[];
  verification: VerificationContract;
  verificationInputs: VerificationInputBinding[];
  verificationLock?: string;
}

export interface TaskBoundary {
  verificationMode?: "behavior" | "mechanical" | "refactor";
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
  field: string;
  expectedPaths: string[];
  actualPaths: string[];
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

export interface PacketEnvelope {
  stage: "abel-design" | "abel-diagnose";
  role: "design-explorer" | "diagnosis-worker";
  runId?: string;
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
  output: "evidence" | "diff";
}

// JSON-schema counterpart for model-visible path arguments; keep its behavior
// checked against isValidRelativePath rather than hiding constraints in prose.
export const RELATIVE_PATH_PATTERN = String.raw`^(?:\.|(?!/)(?![a-zA-Z]:/)(?!\./)(?![\s\S]*\.\.)(?![\s\S]*[\\\u0000])(?![\s\S]*//)(?![\s\S]*/\.(?:/|$))(?![\s\S]*/$)[\s\S]+)$`;

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
const IDENTIFIER = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/iu;

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
    !value.includes("\0")
  );
}

function validVerificationIdentity(contract: Record<string, unknown>): boolean {
  if (
    !validIdentifier(contract.id) ||
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
    if (UNSAFE_VERIFICATION_TOKEN.test(value.command)) return false;
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
  if (
    contract.executionBindings !== undefined &&
    (!contract.executionBindings ||
      typeof contract.executionBindings !== "object" ||
      Array.isArray(contract.executionBindings) ||
      Object.entries(contract.executionBindings).some(
        ([key, hash]) =>
          !VERIFICATION_CONFIGURATION_PATHS.includes(key) ||
          (hash !== null &&
            (typeof hash !== "string" || !/^[a-f0-9]{64}$/u.test(hash))),
      ))
  )
    return false;
  const expectedFailure = [
    ...(contract.classification === "expected-red" ? ["expectedFailure"] : []),
    ...(contract.executionBindings === undefined ? [] : ["executionBindings"]),
  ];
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
      contract.testFiles.length >= VERIFICATION_LIMITS.minTestFiles &&
      contract.testFiles.length <= VERIFICATION_LIMITS.maxTestFiles &&
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
    !validIdentifier(contract.id) ||
    !["expected-red", "expected-green", "expected-refactor"].includes(
      String(contract.classification),
    ) ||
    !Array.isArray(contract.steps) ||
    contract.steps.length < VERIFICATION_LIMITS.minSteps ||
    contract.steps.length > VERIFICATION_LIMITS.maxSteps ||
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

export const VERIFICATION_CONFIGURATION_PATHS: readonly string[] = [
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "bun.lock",
  "bun.lockb",
  "pnpm-lock.yaml",
  "yarn.lock",
  ".npmrc",
  ".yarnrc",
  ".yarnrc.yml",
  "bunfig.toml",
  "pnpm-workspace.yaml",
];

export function verificationBoundInputPaths(
  verification: VerificationContract,
): string[] {
  return [
    ...new Set([
      ...verificationInputPaths(verification),
      ...verificationSteps(verification).flatMap((step) =>
        step.kind === "vitest" ||
        step.kind === "package-script" ||
        ("runner" in step && step.runner.kind === "package-script")
          ? VERIFICATION_CONFIGURATION_PATHS
          : [],
      ),
    ]),
  ];
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
  return typeof value === "string" && IDENTIFIER.test(value);
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
  mode: unknown = "behavior",
): value is PhaseBoundary {
  if (
    !hasExactKeys(
      value,
      ["read", "write", "delete", "verification", "verificationInputs"],
      ["verificationLock"],
    )
  ) {
    return false;
  }
  if (
    !validatePathSet(value.read) ||
    !validatePathSet(value.write) ||
    !validatePathSet(value.delete) ||
    !validateVerificationInputBindings(value.verificationInputs) ||
    value.write.some(isAgentsPath) ||
    value.delete.some(isAgentsPath) ||
    value.write.some((path) => (value.delete as string[]).includes(path)) ||
    (value.verificationLock !== undefined &&
      !isValidRelativePath(value.verificationLock))
  ) {
    return false;
  }
  const verification = validateVerificationContract(value.verification);
  if (!verification.ok) return false;
  const classification = {
    red:
      mode !== undefined && mode !== "behavior"
        ? "expected-green"
        : "expected-red",
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
    !hasExactKeys(
      value,
      [
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
      ],
      ["verificationMode"],
    ) ||
    (value.verificationMode !== undefined &&
      !["behavior", "mechanical", "refactor"].includes(
        String(value.verificationMode),
      )) ||
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
    !validatePhaseBoundary(value.phases.red, "red", value.verificationMode) ||
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
        ...phase.delete,
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
    write: [
      ...new Set(phases.flatMap((entry) => [...entry.write, ...entry.delete])),
    ],
  };
  return (
    validateImpactClosure(value.impactClosure, declared, snapshot) === null
  );
}

export type ImplementGraphContractDiagnostic =
  | {
      code: "invalid-implement-graph";
      taskId?: string;
      phase?: ImplementationPhase;
      field?: string;
      category?: string;
      outputId?: string;
      path?: string;
      expectedPaths?: string[];
      actualPaths?: string[];
      allowedValues?: string[];
    }
  | {
      code: "invalid-output-path";
      outputId?: string;
      field: "outputs.path";
      category: "path";
    };

function phaseBoundaryContractDiagnostic(
  value: unknown,
  phase: ImplementationPhase,
  mode: unknown = "behavior",
): Omit<
  Extract<
    ImplementGraphContractDiagnostic,
    { code: "invalid-implement-graph" }
  >,
  "code"
> | null {
  const prefix = `phases.${phase}`;
  if (
    !hasExactKeys(
      value,
      ["read", "write", "delete", "verification", "verificationInputs"],
      ["verificationLock"],
    )
  ) {
    return { phase, field: prefix, category: "shape" };
  }
  if (!validatePathSet(value.read)) {
    return { phase, field: `${prefix}.read`, category: "path-set" };
  }
  if (!validatePathSet(value.write) || value.write.some(isAgentsPath)) {
    return { phase, field: `${prefix}.write`, category: "path-set" };
  }
  if (!validatePathSet(value.delete) || value.delete.some(isAgentsPath)) {
    return { phase, field: `${prefix}.delete`, category: "path-set" };
  }
  const deletions = value.delete as string[];
  if (value.write.some((candidate) => deletions.includes(candidate))) {
    return { phase, field: prefix, category: "write-delete-overlap" };
  }
  if (!validateVerificationInputBindings(value.verificationInputs)) {
    return {
      phase,
      field: `${prefix}.verificationInputs`,
      category: "verification-input-binding",
    };
  }
  if (
    value.verificationLock !== undefined &&
    !isValidRelativePath(value.verificationLock)
  ) {
    return {
      phase,
      field: `${prefix}.verificationLock`,
      category: "path",
    };
  }
  const verification = validateVerificationContract(value.verification);
  if (!verification.ok) {
    return {
      phase,
      field: `${prefix}.verification`,
      category: "verification-contract",
    };
  }
  const classification = {
    red:
      mode !== undefined && mode !== "behavior"
        ? "expected-green"
        : "expected-red",
    green: "expected-green",
    refactor: "expected-refactor",
  } as const;
  if (verification.value.classification !== classification[phase]) {
    return {
      phase,
      field: `${prefix}.verification.classification`,
      category: "verification-classification",
    };
  }
  return null;
}

function impactClosureCategory(reason: string): string {
  const categories: Record<string, string> = {
    "invalid impact closure": "shape",
    "invalid impact closure related test": "related-test",
    "current-task related test is outside the write set":
      "current-task-outside-write-set",
    "regression task identity is required": "regression-task-identity",
    "unexpected regression task identity": "regression-task-identity",
    "public impact closure is incomplete": "public-impact-incomplete",
    "affected suite contains no existing test evidence":
      "existing-test-evidence",
  };
  return categories[reason] ?? "contract";
}

function taskBoundaryContractDiagnostic(
  value: Record<string, unknown>,
  snapshot: unknown,
): Omit<
  Extract<
    ImplementGraphContractDiagnostic,
    { code: "invalid-implement-graph" }
  >,
  "code"
> | null {
  const taskId = validIdentifier(value.taskId) ? value.taskId : undefined;
  const diagnostic = (
    field: string,
    category: string,
    phase?: ImplementationPhase,
  ) => ({
    ...(taskId ? { taskId } : {}),
    ...(phase ? { phase } : {}),
    field,
    category,
  });
  if (
    !hasExactKeys(
      value,
      [
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
      ],
      ["verificationMode"],
    )
  ) {
    return diagnostic("task", "shape");
  }
  if (
    value.verificationMode !== undefined &&
    !["behavior", "mechanical", "refactor"].includes(
      String(value.verificationMode),
    )
  )
    return diagnostic("verificationMode", "shape");
  if (!validIdentifier(value.changeId)) {
    return diagnostic("changeId", "identifier");
  }
  if (!validIdentifier(value.taskId)) {
    return diagnostic("taskId", "identifier");
  }
  if (!validateIdentifierSet(value.dependsOn)) {
    return diagnostic("dependsOn", "identifier-set");
  }
  if (
    typeof value.objective !== "string" ||
    value.objective.length === 0 ||
    value.objective.length > 4096
  ) {
    return diagnostic("objective", "text-boundary");
  }
  if (
    !hasExactKeys(value.context, ["agents", "contract"]) ||
    typeof value.context.agents !== "string" ||
    typeof value.context.contract !== "string"
  ) {
    return diagnostic("context", "shape");
  }
  if (!validateRoots(value.roots)) {
    return diagnostic("roots", "path-set");
  }
  if (!hasExactKeys(value.phases, ["red", "green"], ["refactor"])) {
    return diagnostic("phases", "shape");
  }
  for (const phase of IMPLEMENTATION_PHASES) {
    const boundary = value.phases[phase];
    if (phase === "refactor" && boundary === undefined) continue;
    const phaseDiagnostic = phaseBoundaryContractDiagnostic(
      boundary,
      phase,
      value.verificationMode,
    );
    if (phaseDiagnostic)
      return { ...diagnostic("phases", "contract"), ...phaseDiagnostic };
  }
  if (
    !hasExactKeys(value.scheduling, ["conflicts", "resources"]) ||
    !validatePathSet(value.scheduling.conflicts) ||
    !validatePathSet(value.scheduling.resources)
  ) {
    return diagnostic("scheduling", "path-set");
  }
  if (
    !hasExactKeys(value.agents, ["impact", "managedOnly"], ["target"]) ||
    !(AGENTS_IMPACTS as readonly unknown[]).includes(value.agents.impact) ||
    value.agents.managedOnly !== true ||
    (value.agents.impact === "none"
      ? value.agents.target !== undefined
      : !isAgentsPath(value.agents.target))
  ) {
    return diagnostic("agents", "contract");
  }
  if (validateApprovedDependencies(value.approvedDependencies) !== null) {
    return diagnostic("approvedDependencies", "dependency-set");
  }
  const roots = value.roots as string[];
  for (const phase of IMPLEMENTATION_PHASES) {
    const boundary = value.phases[phase] as PhaseBoundary | undefined;
    if (!boundary) continue;
    for (const [field, candidates] of [
      ["read", boundary.read],
      ["write", boundary.write],
      ["delete", boundary.delete],
      ["verification", verificationInputPaths(boundary.verification)],
    ] as const) {
      if (candidates.some((candidate) => !isWithinRoots(candidate, roots))) {
        return diagnostic(`phases.${phase}.${field}`, "outside-roots", phase);
      }
    }
    if (boundary.verification.kind !== undefined) {
      const declared = new Set([...boundary.read, ...boundary.write]);
      if (
        verificationInputPaths(boundary.verification).some(
          (input) => !declared.has(input),
        )
      ) {
        return diagnostic(
          `phases.${phase}.verification`,
          "verification-input-not-declared",
          phase,
        );
      }
    }
  }
  const taskPhases = value.phases as Record<
    ImplementationPhase,
    PhaseBoundary | undefined
  >;
  const phases = IMPLEMENTATION_PHASES.flatMap((phase) => {
    const boundary = taskPhases[phase];
    return boundary ? [boundary] : [];
  });
  const declared = {
    read: [...new Set(phases.flatMap((entry) => entry.read))],
    write: [
      ...new Set(phases.flatMap((entry) => [...entry.write, ...entry.delete])),
    ],
  };
  const impactReason = validateImpactClosure(
    value.impactClosure,
    declared,
    snapshot,
  );
  if (impactReason !== null) {
    if (impactReason === "current-task related test is outside the write set") {
      const related = (value.impactClosure as ImpactClosureContract)
        .relatedTests;
      const index = related.findIndex(
        (test) =>
          test.disposition === "current-task" &&
          !declared.write.includes(test.path),
      );
      const test = related[index];
      if (test)
        return {
          ...diagnostic(
            `impactClosure.relatedTests.${index}.disposition`,
            "current-task-outside-write-set",
          ),
          path: test.path,
          expectedPaths: [...declared.write].sort(),
          actualPaths: [test.path],
        };
    }
    return diagnostic("impactClosure", impactClosureCategory(impactReason));
  }
  return validateTaskBoundary(value, snapshot)
    ? null
    : diagnostic("task", "contract");
}

/** Refine rejected author input; this never admits a partial or repaired task. */
function taskFieldDiagnostics(
  task: Record<string, unknown>,
): ImplementGraphContractDiagnostic[] {
  const diagnostics: ImplementGraphContractDiagnostic[] = [];
  const add = (
    detail: Omit<
      Extract<
        ImplementGraphContractDiagnostic,
        { code: "invalid-implement-graph" }
      >,
      "code"
    >,
  ) => {
    if (diagnostics.length < 64)
      diagnostics.push({
        code: "invalid-implement-graph",
        ...(validIdentifier(task.taskId) ? { taskId: task.taskId } : {}),
        ...detail,
      });
  };
  if (task.phases && typeof task.phases === "object") {
    const phases = task.phases as Record<string, unknown>;
    for (const phase of IMPLEMENTATION_PHASES) {
      const boundary = phases[phase];
      if (!boundary || typeof boundary !== "object") continue;
      for (const field of ["read", "write", "delete"] as const) {
        const paths = (boundary as Record<string, unknown>)[field];
        if (!Array.isArray(paths)) continue;
        const seen = new Set<string>();
        for (const [index, file] of paths.entries()) {
          if (!isValidRelativePath(file)) continue;
          if (seen.has(file))
            add({
              phase,
              field: `phases.${phase}.${field}.${index}`,
              category: "duplicate-path",
              path: file,
            });
          seen.add(file);
        }
      }
    }
  }
  if (task.impactClosure && typeof task.impactClosure === "object") {
    const closure = task.impactClosure as Record<string, unknown>;
    if (Array.isArray(closure.changedSurfaces)) {
      for (const [index, surface] of closure.changedSurfaces.entries()) {
        if (!(IMPACT_SURFACES as readonly unknown[]).includes(surface))
          add({
            field: `impactClosure.changedSurfaces.${index}`,
            category: "enum",
            allowedValues: [...IMPACT_SURFACES],
          });
      }
      if (
        closure.changedSurfaces.some(
          (surface) =>
            surface !== "none" &&
            (IMPACT_SURFACES as readonly unknown[]).includes(surface),
        ) &&
        Array.isArray(closure.affectedSuite) &&
        Array.isArray(closure.relatedTests)
      ) {
        const related = new Set(
          closure.relatedTests.flatMap((item) =>
            item && typeof item === "object" ? [item.path] : [],
          ),
        );
        for (const [index, file] of closure.affectedSuite.entries())
          if (isValidRelativePath(file) && !related.has(file))
            add({
              field: `impactClosure.affectedSuite.${index}`,
              category: "related-test-missing",
              path: file,
            });
      }
    }
  }
  return diagnostics;
}

export function validateImplementGraphBoundary(value: unknown):
  | { ok: true; value: ImplementGraphBoundary }
  | {
      ok: false;
      reason: string;
      diagnostic: ImplementGraphContractDiagnostic;
      diagnostics?: ImplementGraphContractDiagnostic[];
    } {
  if (
    !hasExactKeys(value, ["changeId", "tasks", "outputs"]) ||
    !validIdentifier(value.changeId) ||
    !Array.isArray(value.tasks) ||
    value.tasks.length === 0 ||
    value.tasks.length > 128 ||
    !Array.isArray(value.outputs) ||
    value.outputs.length > 512
  )
    return {
      ok: false,
      reason: "invalid Implement graph boundary",
      diagnostic: { code: "invalid-implement-graph" },
    };

  // Collect independent task/output failures without admitting a partial graph.
  const failures: Array<{
    reason: string;
    diagnostic: ImplementGraphContractDiagnostic;
  }> = [];
  for (const candidate of value.tasks) {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      failures.push({
        reason: "invalid Implement task boundary",
        diagnostic: {
          code: "invalid-implement-graph",
          field: "tasks",
          category: "shape",
        },
      });
      continue;
    }
    const task = candidate as Record<string, unknown>;
    const diagnostic = Object.hasOwn(task, "changeId")
      ? {
          ...(validIdentifier(task.taskId) ? { taskId: task.taskId } : {}),
          field: "changeId",
          category: "unexpected-field",
        }
      : taskBoundaryContractDiagnostic(
          { changeId: value.changeId, ...task },
          undefined,
        );
    if (diagnostic) {
      const fields = taskFieldDiagnostics(task);
      // Replace a broad diagnostic only when these details refine that field;
      // retain unrelated shape/authority failures in the same batch.
      if (
        !fields.some(
          (detail) =>
            diagnostic.field &&
            detail.field?.startsWith(`${diagnostic.field}.`),
        )
      )
        fields.push({ code: "invalid-implement-graph", ...diagnostic });
      for (const detail of fields)
        failures.push({
          reason: "invalid Implement task boundary",
          diagnostic: detail,
        });
    }
  }
  for (const candidate of value.outputs) {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      failures.push({
        reason: "invalid Implement graph output",
        diagnostic: { code: "invalid-implement-graph" },
      });
      continue;
    }
    const output = candidate as Record<string, unknown>;
    if (!isValidRelativePath(output.path)) {
      failures.push({
        reason: "invalid Implement graph output path",
        diagnostic: {
          code: "invalid-output-path",
          ...(validIdentifier(output.id) ? { outputId: output.id } : {}),
          field: "outputs.path",
          category: "path",
        },
      });
      continue;
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
      failures.push({
        reason: "invalid Implement graph output",
        diagnostic: {
          code: "invalid-implement-graph",
          ...(validIdentifier(output.id) ? { outputId: output.id } : {}),
          field: "outputs",
          category: "shape",
        },
      });
    }
  }
  const first = failures[0];
  if (first)
    return {
      ok: false,
      ...first,
      ...(failures.length > 1
        ? { diagnostics: failures.map((failure) => failure.diagnostic) }
        : {}),
    };
  return {
    ok: true,
    value: structuredClone(value) as unknown as ImplementGraphBoundary,
  };
}

export function validatePacketEnvelope(
  value: unknown,
): { ok: true; value: PacketEnvelope } | { ok: false; reason: string } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "missing request envelope" };
  }
  const packet = value as Record<string, unknown>;
  const baseRequired = [
    "stage",
    "role",
    "id",
    "phase",
    "objective",
    "roots",
    "context",
    "declared",
    "output",
  ] as const;
  const required =
    packet.stage === "abel-design"
      ? ([
          ...baseRequired.slice(0, 2),
          "runId",
          ...baseRequired.slice(2),
        ] as const)
      : baseRequired;
  for (const field of required) {
    if (packet[field] === undefined) {
      return { ok: false, reason: `missing required field: ${field}` };
    }
  }
  if (!hasExactKeys(packet, required)) {
    return { ok: false, reason: "invalid packet fields" };
  }

  if (packet.stage !== "abel-design" && packet.stage !== "abel-diagnose") {
    return {
      ok: false,
      reason: `unsupported packet stage: ${String(packet.stage)}`,
    };
  }
  if (
    (packet.stage === "abel-design" && packet.role !== "design-explorer") ||
    (packet.stage === "abel-diagnose" && packet.role !== "diagnosis-worker")
  ) {
    return { ok: false, reason: "packet role does not match stage" };
  }
  if (
    (packet.stage === "abel-design" && !validIdentifier(packet.runId)) ||
    (packet.stage === "abel-diagnose" && packet.runId !== undefined)
  ) {
    return { ok: false, reason: "invalid Design run identity" };
  }
  if (!validIdentifier(packet.id)) {
    return { ok: false, reason: "invalid request id" };
  }
  if (
    typeof packet.phase !== "string" ||
    !(PHASES as readonly string[]).includes(packet.phase)
  ) {
    return { ok: false, reason: `invalid phase: ${String(packet.phase)}` };
  }
  if (
    typeof packet.objective !== "string" ||
    packet.objective.length === 0 ||
    packet.objective.length > 4096
  ) {
    return { ok: false, reason: "invalid objective" };
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(packet);
  } catch {
    return { ok: false, reason: "request envelope is not serializable" };
  }
  if (serialized.length > LIMITS.maxEnvelopeBytes) {
    return {
      ok: false,
      reason: `request envelope exceeds ${LIMITS.maxEnvelopeBytes / 1024} KiB`,
    };
  }
  if (
    !Array.isArray(packet.roots) ||
    packet.roots.length === 0 ||
    !packet.roots.every(isValidRelativePath)
  ) {
    return { ok: false, reason: "invalid path roots" };
  }
  if (
    !hasExactKeys(packet.context, ["agents", "contract"]) ||
    typeof packet.context.agents !== "string" ||
    typeof packet.context.contract !== "string"
  ) {
    return { ok: false, reason: "invalid context" };
  }
  if (
    !hasExactKeys(
      packet.declared,
      ["read", "write", "conflicts", "resources"],
      ["verificationLock"],
    )
  ) {
    return { ok: false, reason: "invalid declared sets" };
  }
  for (const key of ["read", "write", "conflicts", "resources"] as const) {
    const entries = packet.declared[key];
    if (
      !Array.isArray(entries) ||
      !entries.every(isValidRelativePath) ||
      new Set(entries).size !== entries.length
    ) {
      return { ok: false, reason: `invalid declared ${key} set` };
    }
  }
  if ((packet.declared.write as unknown[]).some(isAgentsPath)) {
    return { ok: false, reason: "subagents cannot declare AGENTS writes" };
  }
  if (
    packet.declared.verificationLock !== undefined &&
    !isValidRelativePath(packet.declared.verificationLock)
  ) {
    return { ok: false, reason: "invalid verification lock" };
  }
  if (!(OUTPUT_KINDS as readonly unknown[]).includes(packet.output)) {
    return {
      ok: false,
      reason: `invalid output kind: ${String(packet.output)}`,
    };
  }
  if (
    packet.stage === "abel-design" &&
    (packet.phase !== "evidence" ||
      packet.output !== "evidence" ||
      (packet.declared.write as unknown[]).length !== 0)
  ) {
    return { ok: false, reason: "invalid Design packet contract" };
  }

  return {
    ok: true,
    value: structuredClone(packet) as unknown as PacketEnvelope,
  };
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

// Diagnostics contain only code-owned field names, never unexpected keys or values.
function evidenceFieldsFailure(
  value: unknown,
  fields: readonly string[],
  location: string,
): { ok: false; reason: string } {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { ok: false, reason: `${location}: expected an object` };
  const missing = fields.filter((field) => !Object.hasOwn(value, field));
  return {
    ok: false,
    reason:
      missing.length > 0
        ? `${location}: missing fields ${missing.join(", ")}`
        : `${location}: unexpected fields; allowed fields ${fields.join(", ")}`,
  };
}

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
    return evidenceFieldsFailure(r, fields, "result");
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
  if (!Array.isArray(r.citations))
    return { ok: false, reason: "citations: expected an array" };
  for (const [index, citation] of r.citations.entries()) {
    const field = `citations[${index}]`;
    if (!hasExactKeys(citation, ["path", "lines"]))
      return evidenceFieldsFailure(citation, ["path", "lines"], field);
    if (!isValidRelativePath(citation.path))
      return {
        ok: false,
        reason: `${field}.path: expected a canonical relative path`,
      };
    if (typeof citation.lines !== "string")
      return { ok: false, reason: `${field}.lines: expected a string` };
  }
  if (!hasExactKeys(r.hints, ["writeSet", "verification", "agentsImpact"]))
    return evidenceFieldsFailure(
      r.hints,
      ["writeSet", "verification", "agentsImpact"],
      "hints",
    );
  if (!validatePathSet(r.hints.writeSet))
    return {
      ok: false,
      reason: "hints.writeSet: expected unique canonical relative paths",
    };
  if (typeof r.hints.verification !== "string")
    return { ok: false, reason: "hints.verification: expected a string" };
  if (!(AGENTS_IMPACTS as readonly unknown[]).includes(r.hints.agentsImpact))
    return {
      ok: false,
      reason: `hints.agentsImpact: expected one of ${AGENTS_IMPACTS.join(", ")}`,
    };
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
    return evidenceFieldsFailure(r, fields, "result");
  }
  if (!validIdentifier(r.id))
    return { ok: false, reason: "id: expected a valid identifier" };
  if (r.packet_id !== r.id)
    return { ok: false, reason: "packet_id: must equal id" };
  if (!isValidRelativePath(r.module_name))
    return {
      ok: false,
      reason: "module_name: expected a canonical relative path or module slug",
    };
  if (!validatePathSet(r.scope) || r.scope.length === 0) {
    return {
      ok: false,
      reason:
        "scope: expected a nonempty set of unique canonical relative paths",
    };
  }
  for (const field of ["files_read", "write_set_hints"] as const) {
    if (!validatePathSet(r[field]))
      return {
        ok: false,
        reason: `${field}: expected unique canonical relative paths`,
      };
  }
  if (!Array.isArray(r.evidence))
    return { ok: false, reason: "evidence: expected an array" };
  for (const [index, entry] of r.evidence.entries()) {
    const field = `evidence[${index}]`;
    if (!hasExactKeys(entry, ["claim", "path", "line_start", "line_end"])) {
      return evidenceFieldsFailure(
        entry,
        ["claim", "path", "line_start", "line_end"],
        field,
      );
    }
    if (typeof entry.claim !== "string" || entry.claim.length === 0)
      return { ok: false, reason: `${field}.claim: expected nonempty text` };
    if (!isValidRelativePath(entry.path))
      return {
        ok: false,
        reason: `${field}.path: expected a canonical relative path`,
      };
    if (
      !Number.isSafeInteger(entry.line_start) ||
      (entry.line_start as number) < 1
    )
      return {
        ok: false,
        reason: `${field}.line_start: expected a positive safe integer`,
      };
    if (
      !Number.isSafeInteger(entry.line_end) ||
      (entry.line_end as number) < (entry.line_start as number)
    )
      return {
        ok: false,
        reason: `${field}.line_end: expected a safe integer >= line_start`,
      };
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
