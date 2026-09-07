import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { WorkflowActivityUpdate } from "./activity-contracts.ts";
import { compareCanonicalStrings } from "./canonical.ts";
import {
  type ApprovalBoundaryCode,
  isValidRelativePath,
  type StructuredVerificationContract,
  verificationBoundInputPaths,
} from "./contracts.ts";
import type { ControlStage } from "./control-contracts.ts";
import type {
  GateApprovalProof,
  ImplementPlan,
  PlanTaskDraft,
} from "./delivery-compiler.ts";
import type { RoutePolicy } from "./route-policy.ts";
import { canonicalJson } from "./run-state.ts";
import type { OperationLease } from "./run-store.ts";
import type { ResolvedStateRoot } from "./state-root.ts";
import {
  type CandidateContextBoundary,
  type CandidateContextRef,
  classifyCandidateContextRequest,
  normalizeCandidateContextRefs,
} from "./submit-tool.ts";
import type { WorkspaceEntry } from "./workspace-store.ts";

export const SHA256 = /^[a-f0-9]{64}$/u;
export const IDENTIFIER = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/iu;
export const CHANGE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/u;
export const PACKAGE_NAME =
  /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/iu;
export const LOCKFILES = new Set([
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);
export const IMPLEMENTATION_ROUTE_LIMITS = Object.freeze({
  preferredContextWindow: 128_000,
  preferredOutputTokens: 64_000,
  minimumContextWindow: 16_000,
  minimumOutputTokens: 8_000,
});

export function implementationRouteRequirements(
  input: {
    task?: PlanTaskDraft;
    artifactCorrection?: RedArtifactCorrection;
    repair?: { failureIdentities: string[] };
  } = {},
) {
  if (!input.task) {
    return {
      minContextWindow: IMPLEMENTATION_ROUTE_LIMITS.minimumContextWindow,
      minOutputTokens: IMPLEMENTATION_ROUTE_LIMITS.minimumOutputTokens,
    };
  }
  const serializedBytes = Buffer.byteLength(canonicalJson(input.task), "utf8");
  const pathCount = Object.values(input.task.phases).reduce(
    (total, phase) =>
      total + phase.read.length + phase.write.length + phase.delete.length,
    0,
  );
  const complexity =
    serializedBytes +
    pathCount * 512 +
    (input.artifactCorrection ? 16_384 : 0) +
    (input.repair ? input.repair.failureIdentities.length * 256 + 16_384 : 0);
  return {
    minContextWindow: IMPLEMENTATION_ROUTE_LIMITS.minimumContextWindow,
    minOutputTokens: IMPLEMENTATION_ROUTE_LIMITS.minimumOutputTokens,
    preferredContextWindow: Math.min(
      IMPLEMENTATION_ROUTE_LIMITS.preferredContextWindow,
      Math.max(
        IMPLEMENTATION_ROUTE_LIMITS.minimumContextWindow,
        16_384 + complexity * 2,
      ),
    ),
    preferredOutputTokens: Math.min(
      IMPLEMENTATION_ROUTE_LIMITS.preferredOutputTokens,
      Math.max(
        IMPLEMENTATION_ROUTE_LIMITS.minimumOutputTokens,
        8_192 + Math.ceil(complexity / 2),
      ),
    ),
  };
}

export const SEMANTIC_ROUTE_FAILURE_CODES = new Set([
  "child-no-structural-submit",
  "invalid-structural-result",
  "structural-identity-mismatch",
  "invalid-diff",
  "candidate-diff-invalid",
]);

export function semanticRouteFailure(
  value: DurableCandidateProposal,
): string | undefined {
  return (value.kind === "retryable" || value.kind === "paused") &&
    SEMANTIC_ROUTE_FAILURE_CODES.has(value.code)
    ? value.code
    : undefined;
}

export function isCancellationException(
  error: unknown,
  signal: AbortSignal,
): boolean {
  if (!signal.aborted) return false;
  if (error === signal.reason) return true;
  return (
    error instanceof Error &&
    (error.name === "AbortError" ||
      error.message === "cancelled" ||
      error.message === "operation-cancelled")
  );
}

// These adapters are read-only. Cancellation fences their late settlement;
// mutating operations must instead be awaited through their owned lifecycle.
export async function cancellableRead<T>(
  read: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  if (!signal) return read();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    const reading = Promise.resolve().then(() => {
      signal.throwIfAborted();
      return read();
    });
    reading
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export function emitWorkflowActivity(
  observer: ((event: WorkflowActivityUpdate) => void) | undefined,
  event: WorkflowActivityUpdate,
): void {
  try {
    observer?.(structuredClone(event));
  } catch {
    // Presentation is observational and cannot change workflow behavior.
  }
}

export interface WorkflowWorkspaceFacts {
  baselineRevisionId?: string;
  currentWorkspaceRevisionId?: string;
}

export interface WorkflowRouteFacts {
  routeId?: string;
  routeFingerprint?: string;
}

export interface WorkflowVerificationStatus {
  scope: "baseline" | DurableVerificationScope;
  attribution: "pre-existing" | "introduced" | "unresolved" | "environment";
  taskId?: string;
  failureIdentities?: string[];
}

export interface WorkflowContextRequest {
  code:
    | "approved-context-needed"
    | "task-split-needed"
    | "boundary-review-needed";
  refs: CandidateContextRef[];
}

export interface RedArtifactCorrection {
  code: "red-artifact-constraint";
  attempt: number;
  maxAttempts: number;
  contextRequest?: WorkflowContextRequest;
}

export type {
  RecoveryActionDecision,
  RecoveryActionRequest,
  WorkflowRecoveryFact,
  WorkflowRecoveryFeedback,
} from "./workflow-recovery-policy.ts";
export { decideRecoveryAction } from "./workflow-recovery-policy.ts";

import type {
  RecoveryActionDecision,
  RecoveryActionRequest,
  WorkflowRecoveryFact,
  WorkflowRecoveryFeedback,
} from "./workflow-recovery-policy.ts";

export const APPROVAL_AUTHORITY_CATEGORIES = [
  "observable-behavior",
  "architecture-policy",
  "dependency",
  "path-boundary",
  "conflict-resource",
  "verification-contract",
  "agents-contract",
  "irreversible-scope",
] as const;

export type ApprovalAuthorityCategory =
  (typeof APPROVAL_AUTHORITY_CATEGORIES)[number];

export interface ApprovalRequirement {
  category: ApprovalAuthorityCategory;
  requiredGates: Array<"gate-a" | "gate-b">;
  refs: string[];
}

export const INTERNAL_APPROVAL_CODES = [
  "boundary-review-needed",
  "repair-boundary-expansion",
  "task-write-set-empty",
] as const;

export type InternalApprovalCode = (typeof INTERNAL_APPROVAL_CODES)[number];
export type WorkflowApprovalCode = ApprovalBoundaryCode | InternalApprovalCode;

// These pauses need a new executable plan, not a new user decision. Environment,
// integrity and cancellation codes deliberately do not grant this continuation.
export function permitsPlanAmendment(code: string): boolean {
  return ["delivery-invalid", "needs-task-split", "task-split-needed"].includes(
    code,
  );
}

export const APPROVAL_REQUIREMENT_BY_CODE = {
  "agents-contract-insufficient": {
    category: "agents-contract",
    requiredGates: ["gate-b"],
  },
  "architecture-contract-insufficient": {
    category: "architecture-policy",
    requiredGates: ["gate-b"],
  },
  "behavior-contract-insufficient": {
    category: "observable-behavior",
    requiredGates: ["gate-a", "gate-b"],
  },
  "boundary-review-needed": {
    category: "path-boundary",
    requiredGates: ["gate-b"],
  },
  "conflict-resource-authority-insufficient": {
    category: "conflict-resource",
    requiredGates: ["gate-b"],
  },
  "irreversible-scope-insufficient": {
    category: "irreversible-scope",
    requiredGates: ["gate-a", "gate-b"],
  },
  "repair-boundary-expansion": {
    category: "path-boundary",
    requiredGates: ["gate-b"],
  },
  "task-scope-insufficient": {
    category: "path-boundary",
    requiredGates: ["gate-b"],
  },
  "task-write-set-empty": {
    category: "path-boundary",
    requiredGates: ["gate-b"],
  },
  "unapproved-dependency-change": {
    category: "dependency",
    requiredGates: ["gate-b"],
  },
  "verification-contract-insufficient": {
    category: "verification-contract",
    requiredGates: ["gate-b"],
  },
} as const satisfies Record<
  WorkflowApprovalCode,
  {
    category: ApprovalAuthorityCategory;
    requiredGates: readonly ("gate-a" | "gate-b")[];
  }
>;

export type WorkflowRetryPolicy =
  | "artifact"
  | "stale"
  | "verification"
  | "checkpoint";

export type WorkflowAttemptOutcome = (
  | {
      kind: "phase-committed";
      artifactHash: string;
      isolatedRevisionId: string;
      exitCode: number;
      classification: "expected-red" | "expected-green" | "expected-refactor";
    }
  | {
      kind: "paused" | "retryable" | "approval-needed";
      code: string;
      untrustedCandidate?: Uint8Array;
      verification?: WorkflowVerificationStatus;
      contextRequest?: WorkflowContextRequest;
      retryPolicy?: WorkflowRetryPolicy;
    }
  | { kind: "operation-cancelled"; code: "cancelled" }
) &
  WorkflowWorkspaceFacts &
  WorkflowRouteFacts & {
    attemptDiagnostic?: SafeAttemptDiagnostic;
  };

export interface WorkflowWorker {
  hasPendingVerification?(
    input: Parameters<WorkflowWorker["runAttempt"]>[0],
  ): Promise<boolean>;
  isContextReadAvailable?(input: {
    runId: string;
    deliveryRevision: number;
    plan: ImplementPlan;
    baselineRevisionId: string;
    currentWorkspaceRevisionId: string;
    path: string;
  }): boolean;
  runAttempt(input: {
    runId: string;
    operationId: string;
    deliveryRevision: number;
    taskId: string;
    phase: "red" | "green" | "refactor";
    task: PlanTaskDraft;
    plan: ImplementPlan;
    routeId?: string;
    routeFingerprint?: string;
    baselineRevisionId?: string;
    currentWorkspaceRevisionId?: string;
    repair?: {
      attribution: "introduced";
      failureIdentities: string[];
    };
    artifactCorrection?: RedArtifactCorrection;
    contextRequest?: WorkflowContextRequest;
    contextReadPaths?: string[];
    recoveryFeedback?: WorkflowRecoveryFeedback;
    additionalAttempt?: boolean;
    verificationOnly?: boolean;
    reserveCandidate?: () => boolean;
    recoveryDecision?: (
      request: RecoveryActionRequest,
    ) => RecoveryActionDecision;
    signal: AbortSignal;
    onActivity?: (
      event: Pick<
        WorkflowActivityUpdate,
        "state" | "code" | "attempt" | "maxAttempts" | "wait"
      >,
    ) => void;
  }): Promise<WorkflowAttemptOutcome>;
  rebind(input: {
    runId: string;
    taskId: string;
    task: PlanTaskDraft;
    role: "implementation-worker";
    routeId: string;
  }):
    | {
        ok: true;
        routeId?: string;
        routeFingerprint?: string;
        route?: { id?: string; fingerprint?: string };
      }
    | { ok: false; code: string };
  revalidateDelivery?(input: {
    runId: string;
    deliveryRevision: number;
    plan: ImplementPlan;
    tasks: Array<{
      taskId: string;
      deliveryRevision: number;
      state: string;
      phase: "red" | "green" | "refactor";
      contextReadPaths?: string[];
    }>;
    invalidatedTaskIds: string[];
    baselineRevisionId: string;
    currentWorkspaceRevisionId: string;
  }): {
    invalidatedTaskIds: string[];
    baselineRevisionId: string;
    currentWorkspaceRevisionId: string;
  };
  updateRoutePolicy?(policy: RoutePolicy): void;
  routePolicyStatus?(): Record<string, unknown>;
}

export interface WorkflowDelivery {
  gate: "gate-a" | "gate-b";
  revision: number;
  receiptHash: string;
  plan: ImplementPlan;
  approvalProofs?: {
    gateA: GateApprovalProof;
    gateB: GateApprovalProof;
  };
}

export interface WorkflowAvailableDelivery {
  deliveryRevision: number;
  receiptHash: string;
}

export interface WorkflowDeliverySource {
  load(input: {
    stage: ControlStage;
    change: string;
    signal?: AbortSignal;
    deliveryRevision?: number;
    receiptHash?: string;
  }): Promise<WorkflowDelivery>;
  discoverLatest?(input: {
    stage: ControlStage;
    change: string;
    signal?: AbortSignal;
  }): Promise<WorkflowAvailableDelivery | undefined>;
}

export interface WorkflowChangeVerifier {
  verify(input: {
    taskEvidence?: Array<{ taskId: string; deliveryRevision: number }>;
    runId: string;
    deliveryRevision: number;
    plan: ImplementPlan;
    baselineRevisionId?: string;
    currentWorkspaceRevisionId?: string;
    signal: AbortSignal;
  }): Promise<
    | {
        kind: "verified";
        verificationId: string;
        currentWorkspaceRevisionId?: string;
      }
    | {
        kind: "paused" | "retryable" | "approval-needed";
        code: string;
        verification?: WorkflowVerificationStatus;
      }
  >;
}

export interface WorkflowApplication {
  prepare?(input: {
    transactionId: string;
    runId: string;
    consumerRoot: string;
    deliveryRevision: number;
    plan: ImplementPlan;
    contextReadPaths?: string[];
    baselineRevisionId?: string;
    currentWorkspaceRevisionId?: string;
    signal: AbortSignal;
  }): Promise<Record<string, unknown>>;
  applyPrepared?(input: {
    transactionId: string;
    runId: string;
    consumerRoot: string;
    deliveryRevision: number;
    plan: ImplementPlan;
    contextReadPaths?: string[];
    baselineRevisionId?: string;
    currentWorkspaceRevisionId?: string;
    signal: AbortSignal;
  }): Promise<Record<string, unknown>>;
  begin(input: {
    transactionId: string;
    runId: string;
    consumerRoot: string;
    deliveryRevision: number;
    plan: ImplementPlan;
    contextReadPaths?: string[];
    baselineRevisionId?: string;
    currentWorkspaceRevisionId?: string;
    signal: AbortSignal;
  }): Promise<Record<string, unknown>>;
  requestControl(
    transactionId: string,
    intent: "cancel" | "discard",
    context?: WorkflowApplicationContext,
  ): Record<string, unknown>;
  recover(
    transactionId: string,
    context?: WorkflowApplicationContext,
  ): Promise<Record<string, unknown>>;
}

export interface WorkflowApplicationContext {
  runId: string;
  deliveryRevision: number;
  plan: ImplementPlan;
  contextReadPaths?: string[];
  baselineRevisionId?: string;
  currentWorkspaceRevisionId?: string;
}

export interface WorkflowRunLifecycle {
  cleanup(runId: string): void;
  close?(): void;
}

export interface WorkflowEngineOptions {
  consumerRoot: string;
  stateRoot: ResolvedStateRoot;
  deliverySource: WorkflowDeliverySource;
  worker: WorkflowWorker;
  changeVerifier: WorkflowChangeVerifier;
  application?: WorkflowApplication;
  lifecycle?: WorkflowRunLifecycle;
  now?: () => number;
  leaseTtlMs?: number;
  workHardLimit?: number;
}

export interface EngineRunRow {
  current_revision: number | null;
  baseline_workspace_revision: string | null;
  current_workspace_revision: string | null;
  cleanup_state: "none" | "retained" | "complete";
  route_id: string | null;
  route_fingerprint: string | null;
  transaction_id: string | null;
  verification_json: string | null;
  delivery_diagnostics_json: string | null;
  next_queue_position: number;
}

export interface EngineTaskRow {
  task_id: string;
  task_order: number;
  delivery_revision: number;
  plan_json: string;
  state: string;
  phase: "red" | "green" | "refactor";
  pause_code: string | null;
  context_request_json: string | null;
  attempt_diagnostic_json: string | null;
  route_id: string | null;
  route_fingerprint: string | null;
  queue_position: number | null;
}

export interface SafeAttemptDiagnostic {
  fingerprint?: string;
  finalCategory?: string;
  submitAttempts?: number;
  schema?: string;
  identityMismatch?: string[];
  sameFailureCount?: number;
  action?: "rebind-or-revise-delivery";
  recovery?: WorkflowRecoveryFact;
}

export function recoveryKey(
  task: PlanTaskDraft,
  phase: string,
  _row: EngineTaskRow,
  _run: EngineRunRow,
): string {
  // Keep the Red witness and the active phase's obligation across replanning.
  // Execution identities, verifier names, and wording are not progress.
  const obligation = (boundary: PlanTaskDraft["phases"]["red"]) => {
    const verification = structuredClone(
      boundary.verification,
    ) as unknown as Record<string, unknown>;
    delete verification.id;
    return {
      verification,
      verificationInputs: boundary.verificationInputs
        .map((binding) => canonicalJson(binding))
        .sort(compareCanonicalStrings),
    };
  };
  const boundary = task.phases[phase as keyof PlanTaskDraft["phases"]];
  if (!boundary) throw new Error("workflow-task-phase-invalid");
  return hash(
    canonicalJson({
      red: obligation(task.phases.red),
      phase: obligation(boundary),
    }),
    phase,
  );
}

export interface EngineOperationRow {
  command: string;
  state: string;
  outcome_json: string | null;
}

export interface ActiveOperation {
  operationId: string;
  kind: "work" | "applying";
  controller: AbortController;
  settled: Promise<Record<string, unknown>>;
}

export interface HeldOperationLease {
  lease: OperationLease;
  timer: ReturnType<typeof setInterval>;
  error?: Error;
}

export interface BootstrapRow {
  handoff_id: string;
  owner_run_id: string;
  receipt_hash: string;
  state: string;
  facts_json: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeWorkflowVerificationStatus(
  value: unknown,
): WorkflowVerificationStatus {
  if (
    !isRecord(value) ||
    typeof value.scope !== "string" ||
    ![
      "baseline",
      "baseline-task-affected",
      "baseline-full-suite",
      "task-affected",
      "change-task-affected",
      "change-full-suite",
      "agents-checkpoint",
      "post-apply",
    ].includes(value.scope) ||
    !["pre-existing", "introduced", "unresolved", "environment"].includes(
      String(value.attribution),
    ) ||
    (value.taskId !== undefined && typeof value.taskId !== "string") ||
    (value.failureIdentities !== undefined &&
      (!Array.isArray(value.failureIdentities) ||
        value.failureIdentities.length > 256 ||
        value.failureIdentities.some(
          (identity) => typeof identity !== "string" || !SHA256.test(identity),
        )))
  ) {
    throw new Error("workflow-verification-status-invalid");
  }
  return {
    scope: value.scope as WorkflowVerificationStatus["scope"],
    attribution: value.attribution as WorkflowVerificationStatus["attribution"],
    ...(typeof value.taskId === "string" ? { taskId: value.taskId } : {}),
    ...(Array.isArray(value.failureIdentities)
      ? {
          failureIdentities: [
            ...new Set(value.failureIdentities as string[]),
          ].sort(),
        }
      : {}),
  };
}

export function normalizeWorkflowContextRequest(
  value: unknown,
): WorkflowContextRequest {
  if (
    !isRecord(value) ||
    ![
      "approved-context-needed",
      "task-split-needed",
      "boundary-review-needed",
    ].includes(String(value.code))
  ) {
    throw new Error("workflow-context-request-invalid");
  }
  let refs: CandidateContextRef[];
  try {
    refs = normalizeCandidateContextRefs(value.refs);
  } catch {
    throw new Error("workflow-context-request-invalid");
  }
  return {
    code: value.code as WorkflowContextRequest["code"],
    refs,
  };
}

export function contextApprovalRefs(request: WorkflowContextRequest): string[] {
  return request.refs.flatMap((ref) =>
    ref.kind === "requested-path" ? [ref.path] : [],
  );
}

export function contextBoundaryForTask(
  task: PlanTaskDraft,
  phase: "red" | "green" | "refactor",
): CandidateContextBoundary {
  const boundary = task.phases[phase];
  if (!boundary) throw new Error("workflow-task-phase-invalid");
  return {
    phase,
    contextReadRoots: task.roots,
    readPaths: boundary.read,
    writePaths: boundary.write,
    deletePaths: boundary.delete,
    taskPaths: [
      ...new Set(
        Object.values(task.phases).flatMap((candidate) => [
          ...candidate.read,
          ...candidate.write,
          ...candidate.delete,
        ]),
      ),
    ],
    redWritePaths: task.phases.red.write,
    agents: {
      impact: task.agents.impact,
      ...(task.agents.target ? { target: task.agents.target } : {}),
    },
  };
}

export function classifyPersistedContextRequest(
  request: WorkflowContextRequest,
  task: PlanTaskDraft,
  phase: "red" | "green" | "refactor",
) {
  return classifyCandidateContextRequest(
    {
      kind: "context-request",
      candidateId: "candidate-durable-reclassification",
      code: request.code,
      refs: request.refs,
    },
    contextBoundaryForTask(task, phase),
  );
}

export function approvalRequirement(
  code: string,
  contextRequest?: WorkflowContextRequest,
): ApprovalRequirement {
  const requirement = Object.hasOwn(APPROVAL_REQUIREMENT_BY_CODE, code)
    ? APPROVAL_REQUIREMENT_BY_CODE[
        code as keyof typeof APPROVAL_REQUIREMENT_BY_CODE
      ]
    : undefined;
  if (!requirement) throw new Error("approval-code-invalid");
  return {
    category: requirement.category,
    requiredGates: [...requirement.requiredGates],
    refs: contextRequest ? contextApprovalRefs(contextRequest) : [],
  };
}

export function isWorkflowApprovalCode(
  code: string,
): code is WorkflowApprovalCode {
  return Object.hasOwn(APPROVAL_REQUIREMENT_BY_CODE, code);
}

export function hash(...values: string[]): string {
  const digest = createHash("sha256");
  for (const value of values) {
    digest.update(`${Buffer.byteLength(value)}:`);
    digest.update(value);
  }
  return digest.digest("hex");
}

export interface DependencyContractEntry {
  value: string;
  names: string[];
}

export class DependencyManifestError extends Error {
  constructor() {
    super("package-manifest-invalid");
    this.name = "DependencyManifestError";
  }
}

export function dependencyName(selector: string): string | null {
  const scoped = /(@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*)/iu.exec(
    selector,
  )?.[1];
  if (scoped) return scoped;
  const segment = selector.split("/").at(-1) ?? "";
  const name = segment.replace(/@.*$/u, "");
  return PACKAGE_NAME.test(name) ? name : null;
}

export function addDependencyResolutionEntries(
  result: Map<string, DependencyContractEntry>,
  section: string,
  value: unknown,
  selectorPath: string[] = [],
  names: string[] = [],
): void {
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      const name = dependencyName(key);
      addDependencyResolutionEntries(
        result,
        section,
        entry,
        [...selectorPath, key],
        name && key !== "." ? [...new Set([...names, name])] : names,
      );
    }
    return;
  }
  result.set(`${section}:${selectorPath.join(":")}`, {
    value: canonicalJson(value),
    names,
  });
}

export function addDependencyListPolicy(
  result: Map<string, DependencyContractEntry>,
  section: string,
  value: unknown,
): void {
  if (value === undefined) return;
  if (
    !Array.isArray(value) ||
    value.some(
      (name) => typeof name !== "string" || !PACKAGE_NAME.test(name),
    ) ||
    new Set(value).size !== value.length
  ) {
    throw new DependencyManifestError();
  }
  result.set(section, {
    value: canonicalJson([...value].sort()),
    names: [],
  });
}

export function addPatchedDependencyPolicy(
  result: Map<string, DependencyContractEntry>,
  section: string,
  value: unknown,
): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new DependencyManifestError();
  for (const [selector, patchPath] of Object.entries(value)) {
    if (
      !dependencyName(selector) ||
      typeof patchPath !== "string" ||
      !isValidRelativePath(patchPath)
    ) {
      throw new DependencyManifestError();
    }
  }
  result.set(section, { value: canonicalJson(value), names: [] });
}

export function dependencyContract(
  root: string,
): Map<string, DependencyContractEntry> {
  let manifest: unknown;
  try {
    manifest = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf8"),
    );
  } catch {
    throw new DependencyManifestError();
  }
  if (!isRecord(manifest)) throw new DependencyManifestError();

  const result = new Map<string, DependencyContractEntry>();
  for (const section of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const dependencies = manifest[section];
    if (dependencies === undefined) continue;
    if (!isRecord(dependencies)) throw new DependencyManifestError();
    for (const [name, version] of Object.entries(dependencies)) {
      if (typeof version !== "string") throw new DependencyManifestError();
      result.set(`${section}:${name}`, { value: version, names: [name] });
    }
  }
  for (const section of [
    "overrides",
    "resolutions",
    "dependenciesMeta",
    "peerDependenciesMeta",
  ]) {
    if (manifest[section] !== undefined) {
      addDependencyResolutionEntries(result, section, manifest[section]);
    }
  }
  for (const section of ["workspaces", "catalog", "catalogs"]) {
    if (manifest[section] !== undefined) {
      result.set(section, {
        value: canonicalJson(manifest[section]),
        names: [],
      });
    }
  }
  for (const section of [
    "trustedDependencies",
    "blockedDependencies",
    "bundledDependencies",
    "bundleDependencies",
  ]) {
    addDependencyListPolicy(result, section, manifest[section]);
  }
  addPatchedDependencyPolicy(
    result,
    "patchedDependencies",
    manifest.patchedDependencies,
  );

  const pnpm = manifest.pnpm;
  if (pnpm !== undefined) {
    if (!isRecord(pnpm)) throw new DependencyManifestError();
    const resolutionSections = [
      "overrides",
      "packageExtensions",
      "peerDependencyRules",
      "allowedDeprecatedVersions",
    ];
    for (const section of resolutionSections) {
      if (pnpm[section] !== undefined) {
        addDependencyResolutionEntries(
          result,
          `pnpm.${section}`,
          pnpm[section],
        );
      }
    }
    addPatchedDependencyPolicy(
      result,
      "pnpm.patchedDependencies",
      pnpm.patchedDependencies,
    );
    const tracked = new Set([...resolutionSections, "patchedDependencies"]);
    const policy = Object.fromEntries(
      Object.entries(pnpm).filter(([key]) => !tracked.has(key)),
    );
    if (Object.keys(policy).length > 0) {
      result.set("pnpm.policy", { value: canonicalJson(policy), names: [] });
    }
  }
  return result;
}

export function hasUnapprovedDependencyChange(
  before: Map<string, DependencyContractEntry>,
  after: Map<string, DependencyContractEntry>,
  approvedDependencies: readonly string[],
  lockfileChanged: boolean,
): boolean {
  if (lockfileChanged) return true;
  const approved = new Set(approvedDependencies);
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const previous = before.get(key);
    const next = after.get(key);
    if (previous?.value === next?.value) continue;
    const names = new Set([...(previous?.names ?? []), ...(next?.names ?? [])]);
    if (names.size === 0 || [...names].some((name) => !approved.has(name))) {
      return true;
    }
  }
  return false;
}

export function parseJsonRecord(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed)) throw new Error("workflow-engine-record-invalid");
  return parsed;
}

export function parseDeliveryDiagnostics(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.length > 256 ||
    parsed.some(
      (diagnostic) =>
        typeof diagnostic !== "string" ||
        diagnostic.length === 0 ||
        diagnostic.length > 1024,
    ) ||
    new Set(parsed).size !== parsed.length
  ) {
    throw new Error("workflow-delivery-diagnostics-invalid");
  }
  return [...(parsed as string[])];
}

export interface BootstrapAcceptanceFact {
  command: string;
  exitCode: 0;
  evidenceHash: string;
}

export function normalizeBootstrapAcceptanceFacts(
  value: unknown,
): BootstrapAcceptanceFact[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
    throw new Error("bootstrap-handoff-invalid");
  }
  const commands = new Set<string>();
  const facts = value.map((entry): BootstrapAcceptanceFact => {
    if (
      !isRecord(entry) ||
      Object.keys(entry).length !== 3 ||
      !Object.hasOwn(entry, "command") ||
      !Object.hasOwn(entry, "exitCode") ||
      !Object.hasOwn(entry, "evidenceHash") ||
      typeof entry.command !== "string" ||
      entry.command.length === 0 ||
      entry.command.length > 512 ||
      /[\n\r\0]/u.test(entry.command) ||
      entry.exitCode !== 0 ||
      typeof entry.evidenceHash !== "string" ||
      !SHA256.test(entry.evidenceHash) ||
      commands.has(entry.command)
    ) {
      throw new Error("bootstrap-handoff-invalid");
    }
    commands.add(entry.command);
    return {
      command: entry.command,
      exitCode: 0,
      evidenceHash: entry.evidenceHash,
    };
  });
  return facts.sort((left, right) =>
    compareCanonicalStrings(left.command, right.command),
  );
}

export function bootstrapAcceptanceHash(
  facts: readonly BootstrapAcceptanceFact[],
  workspaceManifestHash: string,
) {
  return createHash("sha256")
    .update(
      canonicalJson({
        acceptanceFacts: facts,
        workspaceManifestHash,
      }),
    )
    .digest("hex");
}

export function parsePlan(value: string): ImplementPlan {
  const parsed: unknown = JSON.parse(value);
  assertPlan(parsed);
  return parsed;
}

export function assertPlan(value: unknown): asserts value is ImplementPlan {
  if (
    !isRecord(value) ||
    typeof value.changeId !== "string" ||
    !Array.isArray(value.tasks) ||
    !Array.isArray(value.outputs) ||
    !isRecord(value.verification) ||
    !isRecord(value.verification.artifactCorrection) ||
    !Number.isSafeInteger(value.verification.artifactCorrection.maxAttempts) ||
    (value.verification.artifactCorrection.maxAttempts as number) < 2 ||
    (value.verification.artifactCorrection.maxAttempts as number) > 3 ||
    value.tasks.length === 0
  ) {
    throw new Error("delivery-plan-invalid");
  }
  const identifiers = new Set<string>();
  for (const task of value.tasks) {
    if (
      !isRecord(task) ||
      typeof task.taskId !== "string" ||
      !IDENTIFIER.test(task.taskId) ||
      identifiers.has(task.taskId) ||
      !Array.isArray(task.dependsOn) ||
      !isRecord(task.phases) ||
      !isRecord(task.phases.red) ||
      !isRecord(task.phases.green) ||
      !isRecord(task.scheduling)
    ) {
      throw new Error("delivery-plan-invalid-task");
    }
    identifiers.add(task.taskId);
  }
  for (const task of value.tasks as unknown as PlanTaskDraft[]) {
    if (task.dependsOn.some((dependency) => !identifiers.has(dependency))) {
      throw new Error("delivery-plan-invalid-dependency");
    }
  }
}

export function assertDelivery(
  value: unknown,
  stage: ControlStage,
  change: string,
  requestedRevision?: number,
  requestedReceipt?: string,
): asserts value is WorkflowDelivery {
  if (
    !isRecord(value) ||
    (value.gate !== "gate-a" && value.gate !== "gate-b") ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 1 ||
    typeof value.receiptHash !== "string" ||
    !SHA256.test(value.receiptHash)
  ) {
    throw new Error("delivery-invalid");
  }
  assertPlan(value.plan);
  if (value.approvalProofs !== undefined) {
    if (!isRecord(value.approvalProofs)) throw new Error("delivery-invalid");
    for (const gate of ["gateA", "gateB"] as const) {
      const proof = value.approvalProofs[gate];
      if (
        !isRecord(proof) ||
        !Number.isSafeInteger(proof.revision) ||
        (proof.revision as number) < 1 ||
        typeof proof.contractHash !== "string" ||
        !SHA256.test(proof.contractHash) ||
        typeof proof.recordHash !== "string" ||
        !SHA256.test(proof.recordHash)
      ) {
        throw new Error("delivery-invalid");
      }
    }
  }
  if (stage === "abel-implement" && value.gate !== "gate-b") {
    throw new Error("delivery-gate-b-required");
  }
  if ((value.plan as ImplementPlan).changeId !== change) {
    throw new Error("delivery-change-mismatch");
  }
  if (requestedRevision !== undefined && value.revision !== requestedRevision) {
    throw new Error("delivery-revision-mismatch");
  }
  if (
    requestedReceipt !== undefined &&
    value.receiptHash !== requestedReceipt
  ) {
    throw new Error("delivery-receipt-mismatch");
  }
}

export function phases(
  task: PlanTaskDraft,
): Array<"red" | "green" | "refactor"> {
  return [
    ...(!task.verificationMode || task.verificationMode === "behavior"
      ? ["red" as const]
      : []),
    "green",
    ...(task.phases.refactor ? (["refactor"] as const) : []),
  ];
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export function declarationPathsConflict(left: string, right: string): boolean {
  return (
    left === right ||
    left === "." ||
    right === "." ||
    left.startsWith(`${right}/`) ||
    right.startsWith(`${left}/`)
  );
}

export function taskConflicts(
  left: PlanTaskDraft,
  right: PlanTaskDraft,
): { taskLifetime: boolean; verification: boolean } {
  if (
    left.scheduling.conflicts.includes(right.taskId) ||
    right.scheduling.conflicts.includes(left.taskId)
  ) {
    return { taskLifetime: true, verification: false };
  }
  const leftResources = new Set(left.scheduling.resources);
  if (right.scheduling.resources.some((entry) => leftResources.has(entry))) {
    return { taskLifetime: true, verification: false };
  }

  const declarations = (task: PlanTaskDraft) => {
    const reads = new Set<string>();
    const writes = new Set<string>();
    const verificationLocks = new Set<string>();
    for (const phase of Object.values(task.phases)) {
      for (const entry of stringArray(phase.read)) reads.add(entry);
      for (const entry of stringArray(phase.write)) writes.add(entry);
      for (const entry of stringArray(phase.delete)) writes.add(entry);
      if (typeof phase.verificationLock === "string") {
        verificationLocks.add(phase.verificationLock);
      }
    }
    return { reads, writes, verificationLocks };
  };
  const leftDeclarations = declarations(left);
  const rightDeclarations = declarations(right);
  const leftWriteConflict = [...leftDeclarations.writes].some((entry) =>
    [...rightDeclarations.writes, ...rightDeclarations.reads].some((other) =>
      declarationPathsConflict(entry, other),
    ),
  );
  const rightWriteConflict = [...rightDeclarations.writes].some((entry) =>
    [...leftDeclarations.reads].some((other) =>
      declarationPathsConflict(entry, other),
    ),
  );
  const agentsConflict =
    left.agents.impact !== "none" &&
    right.agents.impact !== "none" &&
    left.agents.target !== undefined &&
    left.agents.target === right.agents.target;
  const verification = [...leftDeclarations.verificationLocks].some((lock) =>
    rightDeclarations.verificationLocks.has(lock),
  );
  return {
    taskLifetime: leftWriteConflict || rightWriteConflict || agentsConflict,
    verification,
  };
}

export function taskApprovalBoundary(
  plan: ImplementPlan,
  task: PlanTaskDraft,
): string {
  const planBoundary = structuredClone(plan) as unknown as Record<
    string,
    unknown
  >;
  delete planBoundary.tasks;
  delete planBoundary.outputs;
  if (isRecord(planBoundary.tracking)) {
    delete planBoundary.tracking.taskIds;
  }
  // Retry limits and presentation do not invalidate verified product facts.
  if (isRecord(planBoundary.verification)) {
    delete planBoundary.verification.artifactCorrection;
    if (isRecord(planBoundary.verification.repair))
      delete planBoundary.verification.repair.maxAttempts;
  }
  return canonicalJson({
    plan: planBoundary,
    task,
    outputs: plan.outputs.filter(
      (output) => output.producer.taskId === task.taskId,
    ),
  });
}

export function workspaceEntryEqual(
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

export function expectedClassification(
  phase: string,
): "expected-red" | "expected-green" | "expected-refactor" {
  return phase === "red"
    ? "expected-red"
    : phase === "refactor"
      ? "expected-refactor"
      : "expected-green";
}

export type DurableCandidateProposal =
  | { kind: "candidate"; bytes: Uint8Array }
  | {
      kind: "sealed-candidate";
      candidateId: string;
      artifactHash: string;
      bytes: number;
      paths: string[];
    }
  | {
      kind: "paused" | "retryable" | "approval-needed";
      code: string;
      contextRequest?: WorkflowContextRequest;
      attemptDiagnostic?: SafeAttemptDiagnostic;
    }
  | { kind: "operation-cancelled"; code: "cancelled" };

export type DurableVerificationScope =
  | "baseline-task-affected"
  | "baseline-full-suite"
  | "task-affected"
  | "change-task-affected"
  | "change-full-suite"
  | "agents-checkpoint"
  | "post-apply";

export function deliveryTrackingPath(plan: ImplementPlan): string | undefined {
  if (!isRecord(plan.tracking) || plan.tracking.path !== "tasks.md") {
    return undefined;
  }
  const relative = `openspec/changes/${plan.changeId}/tasks.md`;
  return isValidRelativePath(relative) ? relative : undefined;
}

export function deliveryBoundPaths(plan: ImplementPlan): string[] {
  const paths = new Set<string>();
  const bindVerification = (verification: StructuredVerificationContract) => {
    for (const relative of verificationBoundInputPaths(verification)) {
      if (relative !== ".") paths.add(relative);
    }
  };
  for (const task of plan.tasks) {
    for (const phase of Object.values(task.phases)) {
      for (const relative of [...phase.read, ...phase.write, ...phase.delete]) {
        if (relative !== ".") paths.add(relative);
      }
      for (const binding of phase.verificationInputs) {
        if (binding.kind === "workspace") paths.add(binding.path);
      }
      bindVerification(phase.verification);
    }
    if (hasVerificationLifecycle(plan)) {
      bindVerification(task.affectedVerification);
      bindVerification(task.repairVerification);
    }
    if (task.agents.target) paths.add(task.agents.target);
  }
  for (const output of plan.outputs) paths.add(output.path);
  if (hasVerificationLifecycle(plan)) {
    bindVerification(plan.verification.baseline.fullSuite);
    bindVerification(plan.verification.change.fullSuite);
    bindVerification(plan.verification.change.postApply);
    if (plan.verification.agentsCheckpoint.verification) {
      bindVerification(plan.verification.agentsCheckpoint.verification);
    }
    for (const operation of plan.verification.agentsCheckpoint.operations) {
      paths.add(operation.target);
    }
  }
  const trackingPath = deliveryTrackingPath(plan);
  if (trackingPath) paths.add(trackingPath);
  return [...paths].sort();
}

export function hasVerificationLifecycle(plan: ImplementPlan): boolean {
  return (
    isRecord(plan.verification) &&
    isRecord(plan.verification.baseline) &&
    isRecord(plan.verification.change) &&
    isRecord(plan.verification.repair) &&
    isRecord(plan.tracking) &&
    plan.tasks.every(
      (task) =>
        isRecord(task.affectedVerification) &&
        isRecord(task.repairVerification),
    )
  );
}
