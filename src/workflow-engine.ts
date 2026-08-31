import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  ApplyTransaction,
  verifyCumulativeRevision,
} from "./apply-transaction.ts";
import { ArtifactStore } from "./artifact-store.ts";
import {
  type ApprovalBoundaryCode,
  diffWritePaths,
  isValidRelativePath,
  type StructuredVerificationContract,
  verificationInputPaths,
} from "./contracts.ts";
import {
  assertControlCommand,
  type ControlCommand,
  type ControlStage,
} from "./control-contracts.ts";
import type { GateApprovalProof } from "./delivery-compiler.ts";
import {
  DeliveryValidationError,
  type ImplementPlan,
  type PlanTaskDraft,
} from "./delivery-compiler.ts";
import type { RoutePolicy, WorkerRoutePolicy } from "./route-policy.ts";
import {
  canonicalJson,
  legalControlCommands,
  type RunProjection,
  type RunState,
} from "./run-state.ts";
import { type OperationLease, RunStore } from "./run-store.ts";
import { observeSafePath } from "./safe-path.ts";
import type { ResolvedStateRoot } from "./state-root.ts";
import type { WorkflowActivityUpdate } from "./subagent-activity.ts";
import {
  type CandidateArtifactSubmission,
  type CandidateContextBoundary,
  type CandidateContextRef,
  classifyCandidateContextRequest,
  normalizeCandidateContextRefs,
} from "./submit-tool.ts";
import {
  type BeginCandidateInput,
  TASK_LEDGER_LIMITS,
  TaskLedger,
  type VerifiedTaskEvent,
} from "./task-ledger.ts";
import { type RouteHealthStore, RunWorkerBroker } from "./worker-broker.ts";
import {
  type WorkspaceEntry,
  type WorkspaceRevision,
  WorkspaceStore,
} from "./workspace-store.ts";

const SHA256 = /^[a-f0-9]{64}$/u;
const IDENTIFIER = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/iu;
const CHANGE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/u;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/iu;
const LOCKFILES = new Set([
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);
const IMPLEMENTATION_ROUTE_REQUIREMENTS = Object.freeze({
  minContextWindow: 128_000,
  minOutputTokens: 64_000,
});

function isCancellationException(error: unknown, signal: AbortSignal): boolean {
  if (!signal.aborted) return false;
  if (error === signal.reason) return true;
  return (
    error instanceof Error &&
    (error.name === "AbortError" ||
      error.message === "cancelled" ||
      error.message === "operation-cancelled")
  );
}

function emitWorkflowActivity(
  observer: ((event: WorkflowActivityUpdate) => void) | undefined,
  event: WorkflowActivityUpdate,
): void {
  try {
    observer?.(structuredClone(event));
  } catch {
    // Presentation is observational and cannot change workflow behavior.
  }
}

const ENGINE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS workflow_engine_runs (
    run_id TEXT PRIMARY KEY REFERENCES runs(run_id) ON DELETE CASCADE,
    current_revision INTEGER,
    baseline_workspace_revision TEXT,
    current_workspace_revision TEXT,
    cleanup_state TEXT NOT NULL DEFAULT 'none',
    route_id TEXT,
    route_fingerprint TEXT,
    transaction_id TEXT,
    verification_json TEXT,
    delivery_diagnostics_json TEXT,
    next_queue_position INTEGER NOT NULL DEFAULT 1
  ) STRICT;

  CREATE TABLE IF NOT EXISTS workflow_engine_deliveries (
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    gate TEXT NOT NULL,
    receipt_hash TEXT NOT NULL,
    plan_json TEXT NOT NULL,
    PRIMARY KEY (run_id, revision)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS workflow_engine_tasks (
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    task_id TEXT NOT NULL,
    task_order INTEGER NOT NULL,
    delivery_revision INTEGER NOT NULL,
    plan_json TEXT NOT NULL,
    state TEXT NOT NULL,
    phase TEXT NOT NULL,
    pause_code TEXT,
    context_request_json TEXT,
    route_id TEXT,
    route_fingerprint TEXT,
    queue_position INTEGER,
    PRIMARY KEY (run_id, task_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS workflow_engine_operations (
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    operation_id TEXT NOT NULL,
    command TEXT NOT NULL,
    state TEXT NOT NULL,
    lease_token TEXT,
    lease_expires_at INTEGER,
    outcome_json TEXT,
    PRIMARY KEY (run_id, operation_id)
  ) STRICT;
`;

interface WorkflowWorkspaceFacts {
  baselineRevisionId?: string;
  currentWorkspaceRevisionId?: string;
}

interface WorkflowRouteFacts {
  routeId?: string;
  routeFingerprint?: string;
}

interface WorkflowVerificationStatus {
  scope: "baseline" | DurableVerificationScope;
  attribution: "pre-existing" | "introduced" | "unresolved" | "environment";
  taskId?: string;
  failureIdentities?: string[];
}

interface WorkflowContextRequest {
  code:
    | "approved-context-needed"
    | "task-split-needed"
    | "boundary-review-needed";
  refs: CandidateContextRef[];
}

interface RedArtifactCorrection {
  code: "red-artifact-constraint";
  attempt: number;
  maxAttempts: number;
  contextRequest?: WorkflowContextRequest;
}

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

interface ApprovalRequirement {
  category: ApprovalAuthorityCategory;
  requiredGates: Array<"gate-a" | "gate-b">;
  refs: string[];
}

const INTERNAL_APPROVAL_CODES = [
  "boundary-review-needed",
  "repair-boundary-expansion",
  "task-write-set-empty",
] as const;

type InternalApprovalCode = (typeof INTERNAL_APPROVAL_CODES)[number];
export type WorkflowApprovalCode = ApprovalBoundaryCode | InternalApprovalCode;

const APPROVAL_REQUIREMENT_BY_CODE = {
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

type WorkflowRetryPolicy = "artifact" | "stale" | "verification" | "checkpoint";

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
  WorkflowRouteFacts;

export interface WorkflowWorker {
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
    deliveryRevision?: number;
    receiptHash?: string;
  }): Promise<WorkflowDelivery>;
  discoverLatest?(input: {
    stage: ControlStage;
    change: string;
  }): Promise<WorkflowAvailableDelivery | undefined>;
}

export interface WorkflowChangeVerifier {
  verify(input: {
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
}

interface EngineRunRow {
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

interface EngineTaskRow {
  task_id: string;
  task_order: number;
  delivery_revision: number;
  plan_json: string;
  state: string;
  phase: "red" | "green" | "refactor";
  pause_code: string | null;
  context_request_json: string | null;
  route_id: string | null;
  route_fingerprint: string | null;
  queue_position: number | null;
}

interface EngineOperationRow {
  command: string;
  state: string;
  outcome_json: string | null;
}

interface ActiveOperation {
  operationId: string;
  kind: "work" | "applying";
  controller: AbortController;
  settled: Promise<Record<string, unknown>>;
}

interface HeldOperationLease {
  lease: OperationLease;
  timer: ReturnType<typeof setInterval>;
  error?: Error;
}

interface BootstrapRow {
  handoff_id: string;
  owner_run_id: string;
  receipt_hash: string;
  state: string;
  facts_json: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeWorkflowVerificationStatus(
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

function normalizeWorkflowContextRequest(
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

function contextApprovalRefs(request: WorkflowContextRequest): string[] {
  return request.refs.flatMap((ref) =>
    ref.kind === "requested-path" ? [ref.path] : [],
  );
}

function contextBoundaryForTask(
  task: PlanTaskDraft,
  phase: "red" | "green" | "refactor",
): CandidateContextBoundary {
  const boundary = task.phases[phase];
  if (!boundary) throw new Error("workflow-task-phase-invalid");
  return {
    phase,
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

function classifyPersistedContextRequest(
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

function approvalRequirement(
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

function isWorkflowApprovalCode(code: string): code is WorkflowApprovalCode {
  return Object.hasOwn(APPROVAL_REQUIREMENT_BY_CODE, code);
}

function hash(...values: string[]): string {
  const digest = createHash("sha256");
  for (const value of values) {
    digest.update(`${Buffer.byteLength(value)}:`);
    digest.update(value);
  }
  return digest.digest("hex");
}

interface DependencyContractEntry {
  value: string;
  names: string[];
}

class DependencyManifestError extends Error {
  constructor() {
    super("package-manifest-invalid");
    this.name = "DependencyManifestError";
  }
}

function dependencyName(selector: string): string | null {
  const scoped = /(@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*)/iu.exec(
    selector,
  )?.[1];
  if (scoped) return scoped;
  const segment = selector.split("/").at(-1) ?? "";
  const name = segment.replace(/@.*$/u, "");
  return PACKAGE_NAME.test(name) ? name : null;
}

function addDependencyResolutionEntries(
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

function addDependencyListPolicy(
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

function addPatchedDependencyPolicy(
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

function dependencyContract(
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

function hasUnapprovedDependencyChange(
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

function parseJsonRecord(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed)) throw new Error("workflow-engine-record-invalid");
  return parsed;
}

function parseDeliveryDiagnostics(value: string): string[] {
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

interface BootstrapAcceptanceFact {
  command: string;
  exitCode: 0;
  evidenceHash: string;
}

function normalizeBootstrapAcceptanceFacts(
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
  return facts.sort((left, right) => left.command.localeCompare(right.command));
}

function bootstrapAcceptanceHash(
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

function parsePlan(value: string): ImplementPlan {
  const parsed: unknown = JSON.parse(value);
  assertPlan(parsed);
  return parsed;
}

function assertPlan(value: unknown): asserts value is ImplementPlan {
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

function assertDelivery(
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

function phases(task: PlanTaskDraft): Array<"red" | "green" | "refactor"> {
  return [
    "red",
    "green",
    ...(task.phases.refactor ? (["refactor"] as const) : []),
  ];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function declarationPathsConflict(left: string, right: string): boolean {
  return (
    left === right ||
    left === "." ||
    right === "." ||
    left.startsWith(`${right}/`) ||
    right.startsWith(`${left}/`)
  );
}

function taskConflicts(
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

function taskApprovalBoundary(
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
  return canonicalJson({
    plan: planBoundary,
    task,
    outputs: plan.outputs.filter(
      (output) => output.producer.taskId === task.taskId,
    ),
  });
}

function workspaceEntryEqual(
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

function expectedClassification(
  phase: string,
): "expected-red" | "expected-green" | "expected-refactor" {
  return phase === "red"
    ? "expected-red"
    : phase === "refactor"
      ? "expected-refactor"
      : "expected-green";
}

function ensureEngineColumns(database: DatabaseSync): void {
  const ensure = (
    table: "workflow_engine_runs" | "workflow_engine_tasks",
    additions: ReadonlyArray<readonly [string, string]>,
  ) => {
    const columns = new Set(
      (
        database
          .prepare(`PRAGMA table_info(${table})`)
          .all() as unknown as Array<{
          name: string;
        }>
      ).map((column) => column.name),
    );
    for (const [name, declaration] of additions) {
      if (!columns.has(name)) {
        database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${declaration}`);
      }
    }
  };
  ensure("workflow_engine_runs", [
    ["baseline_workspace_revision", "TEXT"],
    ["current_workspace_revision", "TEXT"],
    ["cleanup_state", "TEXT NOT NULL DEFAULT 'none'"],
    ["verification_json", "TEXT"],
    ["delivery_diagnostics_json", "TEXT"],
    ["route_fingerprint", "TEXT"],
  ]);
  ensure("workflow_engine_tasks", [
    ["route_fingerprint", "TEXT"],
    ["context_request_json", "TEXT"],
  ]);
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
    }
  | { kind: "operation-cancelled"; code: "cancelled" };

export type DurablePhaseVerificationResult =
  | {
      ok: true;
      exitCode: number;
      classification: "expected-red" | "expected-green" | "expected-refactor";
      diagnostic: { kind: "assertion" | "compiler"; id: string };
    }
  | {
      ok: false;
      kind: "paused" | "retryable" | "approval-needed";
      code: string;
    };

export type DurableChangeVerificationResult =
  | {
      ok: true;
      exitCode: 0;
      classification: string;
      failureIdentities?: string[];
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
      failureIdentities?: string[];
    };

export type DurableVerificationScope =
  | "baseline-task-affected"
  | "baseline-full-suite"
  | "task-affected"
  | "change-task-affected"
  | "change-full-suite"
  | "agents-checkpoint"
  | "post-apply";

interface DurableVerificationObservation {
  status: "passed" | "failed";
  verificationId: string;
  failureIdentities: string[];
  code?: string;
}

interface DurableVerificationBaseline {
  revisionId: string;
  targetContracts: Array<{
    taskId: string;
    verificationId: string;
    expectedFailure: string;
  }>;
  affected: Array<{
    taskId: string;
    observation: DurableVerificationObservation;
  }>;
  fullSuite: DurableVerificationObservation;
}

type DurableObservedVerification =
  | { ok: true; observation: DurableVerificationObservation }
  | {
      ok: false;
      outcome:
        | { kind: "paused"; code: string }
        | { kind: "approval-needed"; code: string }
        | { kind: "operation-cancelled"; code: "cancelled" };
    };

type DurableBaselineResult =
  | { ok: true; baseline: DurableVerificationBaseline }
  | Extract<DurableObservedVerification, { ok: false }>;

type DurableAffectedResult =
  | { kind: "verified"; attribution: "none" | "pre-existing" }
  | {
      kind: "repairable";
      attribution: "introduced";
      failureIdentities: string[];
    }
  | Extract<DurableObservedVerification, { ok: false }>["outcome"];

export interface DurableWorkflowEngineOptions {
  consumerRoot: string;
  stateRoot: ResolvedStateRoot;
  deliverySource: WorkflowDeliverySource;
  routePolicy: RoutePolicy;
  proposeCandidate(input: {
    runId: string;
    operationId: string;
    deliveryRevision: number;
    taskId: string;
    phase: "red" | "green" | "refactor";
    task: PlanTaskDraft;
    workspaceRoot: string;
    ledgerProjection: unknown;
    candidateArtifact: CandidateArtifactSubmission;
    route: WorkerRoutePolicy;
    repair?: {
      attempt: number;
      attribution: "introduced";
      failureIdentities: string[];
    };
    artifactCorrection?: RedArtifactCorrection;
    signal: AbortSignal;
    onHeaders(): void;
    onProgress(): void;
  }): Promise<DurableCandidateProposal>;
  verifyPhase(input: {
    runId: string;
    deliveryRevision: number;
    taskId: string;
    phase: "red" | "green" | "refactor";
    root: string;
    verification: StructuredVerificationContract;
    signal: AbortSignal;
  }): Promise<DurablePhaseVerificationResult>;
  verifyChange(input: {
    runId: string;
    deliveryRevision: number;
    root: string;
    plan: ImplementPlan;
    scope?: DurableVerificationScope;
    verification?: StructuredVerificationContract;
    taskId?: string;
    signal: AbortSignal;
  }): Promise<DurableChangeVerificationResult>;
  now?: () => number;
  leaseTtlMs?: number;
}

interface DurableRunResources {
  runId: string;
  root: string;
  plan: ImplementPlan;
  deliveryRevision: number;
  artifacts: ArtifactStore;
  workspaces: WorkspaceStore;
  ledgers: Map<number, TaskLedger>;
  transactions: ApplyTransaction;
  baselineRevisionId: string;
  currentRevisionId: string;
  mergeTail: Promise<void>;
  verificationFact?: object;
  baselinePromises: Map<number, Promise<DurableBaselineResult>>;
  closed: boolean;
}

interface DurablePhaseFact {
  kind: "phase-verified" | "repair-verified";
  phase: "red" | "green" | "refactor";
  isolatedRevisionId: string;
  outputFacts: Array<
    | { path: string; kind: "absent" }
    | { path: string; kind: "file"; hash: string; bytes: number }
  >;
}

interface DurableCandidateCommit {
  artifactHash: string;
  isolatedRevisionId: string;
  exitCode: number;
  classification: "expected-red" | "expected-green" | "expected-refactor";
  diagnostic: { kind: "assertion" | "compiler"; id: string };
  outputFacts: DurablePhaseFact["outputFacts"];
  routeId: string;
  routeFingerprint: string;
}

type DurableRepairResult =
  | { kind: "repair-committed"; commit: DurableCandidateCommit }
  | Exclude<WorkflowAttemptOutcome, { kind: "phase-committed" }>;

type DurableRouteHealth = Parameters<RouteHealthStore["set"]>[1];

class DurableRouteHealthStore implements RouteHealthStore {
  readonly #databasePath: string;
  #database?: DatabaseSync;
  #closed = false;

  constructor(databasePath: string) {
    this.#databasePath = databasePath;
  }

  #open(): DatabaseSync {
    if (this.#closed) throw new Error("route-health-store-closed");
    if (this.#database) return this.#database;
    const database = new DatabaseSync(this.#databasePath);
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA synchronous = FULL");
    database.exec("PRAGMA busy_timeout = 5000");
    database.exec(`
      CREATE TABLE IF NOT EXISTS route_health (
        route_fingerprint TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        next_half_open_at INTEGER,
        projection_json TEXT NOT NULL
      ) STRICT;
    `);
    this.#database = database;
    return database;
  }

  get(fingerprint: string): DurableRouteHealth | undefined {
    if (!SHA256.test(fingerprint)) return undefined;
    const row = this.#open()
      .prepare(
        `SELECT state, next_half_open_at, projection_json
         FROM route_health WHERE route_fingerprint = ?`,
      )
      .get(fingerprint) as
      | {
          state: string;
          next_half_open_at: number | null;
          projection_json: string;
        }
      | undefined;
    if (!row || !["healthy", "open", "half-open"].includes(row.state)) {
      return undefined;
    }
    let projection: unknown;
    try {
      projection = JSON.parse(row.projection_json);
    } catch {
      return undefined;
    }
    if (!isRecord(projection) || projection.state !== row.state) {
      return undefined;
    }
    const retryAt = row.next_half_open_at ?? undefined;
    const lastCode =
      typeof projection.lastCode === "string" &&
      projection.lastCode.length > 0 &&
      projection.lastCode.length <= 128
        ? projection.lastCode
        : undefined;
    const probeExpiresAt =
      Number.isSafeInteger(projection.probeExpiresAt) &&
      (projection.probeExpiresAt as number) >= 0
        ? (projection.probeExpiresAt as number)
        : undefined;
    return {
      state: row.state as DurableRouteHealth["state"],
      ...(retryAt === undefined ? {} : { retryAt }),
      ...(projection.probeInFlight === true ? { probeInFlight: true } : {}),
      ...(probeExpiresAt === undefined ? {} : { probeExpiresAt }),
      ...(lastCode === undefined ? {} : { lastCode }),
    };
  }

  set(fingerprint: string, health: DurableRouteHealth): void {
    if (
      !SHA256.test(fingerprint) ||
      !["healthy", "open", "half-open"].includes(health.state) ||
      (health.retryAt !== undefined &&
        (!Number.isSafeInteger(health.retryAt) || health.retryAt < 0)) ||
      (health.probeExpiresAt !== undefined &&
        (!Number.isSafeInteger(health.probeExpiresAt) ||
          health.probeExpiresAt < 0))
    ) {
      throw new Error("route-health-fact-invalid");
    }
    const projection = {
      state: health.state,
      ...(health.probeInFlight ? { probeInFlight: true } : {}),
      ...(health.probeExpiresAt === undefined
        ? {}
        : { probeExpiresAt: health.probeExpiresAt }),
      ...(health.lastCode ? { lastCode: health.lastCode.slice(0, 128) } : {}),
    };
    this.#open()
      .prepare(
        `INSERT INTO route_health(
           route_fingerprint, state, next_half_open_at, projection_json
         ) VALUES (?, ?, ?, ?)
         ON CONFLICT(route_fingerprint) DO UPDATE SET
           state = excluded.state,
           next_half_open_at = excluded.next_half_open_at,
           projection_json = excluded.projection_json`,
      )
      .run(
        fingerprint,
        health.state,
        health.retryAt ?? null,
        JSON.stringify(projection),
      );
  }

  close(): void {
    if (this.#closed) return;
    this.#database?.close();
    this.#closed = true;
  }
}

function ensurePrivateRunDirectory(directory: string): void {
  const existing = lstatSync(directory, { throwIfNoEntry: false });
  if (existing) {
    if (existing.isSymbolicLink() || !existing.isDirectory()) {
      throw new Error("workflow-run-data-unsafe");
    }
    return;
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const created = lstatSync(directory);
  if (created.isSymbolicLink() || !created.isDirectory()) {
    throw new Error("workflow-run-data-unsafe");
  }
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function hasVerificationLifecycle(plan: ImplementPlan): boolean {
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

function deliveryTrackingPath(plan: ImplementPlan): string | undefined {
  if (!isRecord(plan.tracking) || plan.tracking.path !== "tasks.md") {
    return undefined;
  }
  const relative = `openspec/changes/${plan.changeId}/tasks.md`;
  return isValidRelativePath(relative) ? relative : undefined;
}

function deliveryBoundPaths(plan: ImplementPlan): string[] {
  const paths = new Set<string>();
  const bindVerification = (verification: StructuredVerificationContract) => {
    for (const relative of verificationInputPaths(verification)) {
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

function verificationIdentities(
  result: DurableChangeVerificationResult,
  verification: StructuredVerificationContract,
  scope: DurableVerificationScope,
): string[] {
  const supplied = result.failureIdentities;
  if (
    Array.isArray(supplied) &&
    supplied.length <= 256 &&
    supplied.every(
      (identity) => typeof identity === "string" && SHA256.test(identity),
    )
  ) {
    return [...new Set(supplied)].sort();
  }
  if (result.ok) return [];
  return [hash("verification-failure", scope, verification.id, result.code)];
}

function parseVerificationBaseline(
  value: unknown,
): DurableVerificationBaseline {
  if (
    !isRecord(value) ||
    typeof value.revisionId !== "string" ||
    !SHA256.test(value.revisionId) ||
    !Array.isArray(value.targetContracts) ||
    !Array.isArray(value.affected) ||
    !isRecord(value.fullSuite)
  ) {
    throw new Error("workflow-verification-baseline-invalid");
  }
  const baseline = structuredClone(
    value,
  ) as unknown as DurableVerificationBaseline;
  const validObservation = (observation: DurableVerificationObservation) =>
    (observation.status === "passed" || observation.status === "failed") &&
    typeof observation.verificationId === "string" &&
    IDENTIFIER.test(observation.verificationId) &&
    Array.isArray(observation.failureIdentities) &&
    observation.failureIdentities.every((identity) => SHA256.test(identity)) &&
    (observation.code === undefined || typeof observation.code === "string");
  if (
    !baseline.targetContracts.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.taskId === "string" &&
        typeof entry.verificationId === "string" &&
        typeof entry.expectedFailure === "string",
    ) ||
    !baseline.affected.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.taskId === "string" &&
        isRecord(entry.observation) &&
        validObservation(entry.observation),
    ) ||
    !validObservation(baseline.fullSuite)
  ) {
    throw new Error("workflow-verification-baseline-invalid");
  }
  return baseline;
}

function runGitApply(
  root: string,
  diff: Uint8Array,
  checkOnly: boolean,
  signal: AbortSignal,
): Promise<"ok" | "failed" | "cancelled"> {
  if (signal.aborted) return Promise.resolve("cancelled");
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: "ok" | "failed" | "cancelled") => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      resolve(value);
    };
    const child = spawn(
      "git",
      [
        "apply",
        ...(checkOnly ? ["--check"] : []),
        "--recount",
        "--whitespace=nowarn",
        "-",
      ],
      { cwd: root, shell: false, stdio: ["pipe", "ignore", "ignore"] },
    );
    const abort = () => {
      child.kill("SIGTERM");
      settle("cancelled");
    };
    signal.addEventListener("abort", abort, { once: true });
    child.once("error", () => settle(signal.aborted ? "cancelled" : "failed"));
    child.once("close", (code) =>
      settle(signal.aborted ? "cancelled" : code === 0 ? "ok" : "failed"),
    );
    child.stdin.on("error", () => undefined);
    child.stdin.end(Buffer.from(diff));
  });
}

function revisionChanges(
  root: string,
  paths: readonly string[],
): Record<
  string,
  { kind: "absent" } | { kind: "file"; bytes: Uint8Array; mode: number }
> {
  const changes: Record<
    string,
    { kind: "absent" } | { kind: "file"; bytes: Uint8Array; mode: number }
  > = {};
  for (const relative of [...new Set(paths)].sort()) {
    const observation = observeSafePath(root, relative);
    if (observation.kind === "absent") {
      changes[relative] = { kind: "absent" };
      continue;
    }
    if (observation.kind !== "file") {
      throw new Error("workflow-candidate-path-unsafe");
    }
    const target = path.join(root, ...relative.split("/"));
    const stat = lstatSync(target);
    changes[relative] = {
      kind: "file",
      bytes: readFileSync(target),
      mode: stat.mode & 0o777,
    };
  }
  return changes;
}

class DurableWorkflowComposition
  implements
    WorkflowWorker,
    WorkflowChangeVerifier,
    WorkflowApplication,
    WorkflowRunLifecycle
{
  readonly #options: DurableWorkflowEngineOptions;
  readonly #routeHealth: DurableRouteHealthStore;
  #broker: RunWorkerBroker;
  readonly #runs = new Map<string, DurableRunResources>();

  constructor(options: DurableWorkflowEngineOptions) {
    this.#options = options;
    this.#routeHealth = new DurableRouteHealthStore(
      options.stateRoot.databasePath,
    );
    this.#broker = new RunWorkerBroker(options.routePolicy, {
      ...(options.now ? { now: options.now } : {}),
      healthStore: this.#routeHealth,
    });
  }

  updateRoutePolicy(policy: RoutePolicy): void {
    this.#broker.updatePolicy(policy);
  }

  routePolicyStatus(): Record<string, unknown> {
    return this.#broker.status();
  }

  #recordCorrection(
    ledger: TaskLedger,
    input: {
      runId: string;
      operationId: string;
      taskId: string;
      phase: "red" | "green" | "refactor";
    },
    identity: BeginCandidateInput,
    correction: {
      category: "artifact" | "stale" | "verification" | "checkpoint";
      code: string;
      stage: string;
    },
  ): void {
    ledger.commitVerifiedEvent({
      runId: input.runId,
      taskId: input.taskId,
      eventId: `correction-${hash(
        input.operationId,
        identity.candidateId,
        correction.category,
        correction.code,
        correction.stage,
      ).slice(0, 40)}`,
      kind: "artifact-correction",
      phase: input.phase,
      correctionCategory: correction.category,
      safeFailure: { code: correction.code, stage: correction.stage },
      candidateId: identity.candidateId,
      attemptId: identity.attemptId,
      routeId: identity.routeId,
      routeFingerprint: identity.routeFingerprint,
    });
  }

  #runRoot(runId: string): string {
    if (!IDENTIFIER.test(runId)) throw new Error("workflow-run-id-invalid");
    const dataRoot = path.join(this.#options.stateRoot.rootDir, "run-data");
    const root = path.join(dataRoot, runId);
    const relative = path.relative(dataRoot, root);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("workflow-run-data-unsafe");
    }
    return root;
  }

  #captureBaseline(workspaces: WorkspaceStore, plan: ImplementPlan) {
    const candidates = new Set<string>();
    const absent = new Set<string>();
    for (const relative of deliveryBoundPaths(plan)) {
      const observation = observeSafePath(this.#options.consumerRoot, relative);
      if (observation.kind === "file") candidates.add(relative);
      else if (observation.kind === "absent") absent.add(relative);
      else throw new Error("workflow-baseline-path-unsafe");
    }
    return workspaces.captureBaseline({
      consumerRoot: this.#options.consumerRoot,
      approvedUntracked: [...candidates].sort(),
      absent: [...absent].sort(),
    });
  }

  async #verifyPostApply(
    resources: DurableRunResources,
    root: string,
    signal: AbortSignal,
  ): Promise<{ ok: true } | { ok: false; code: string }> {
    if (
      resources.plan.outputs.some(
        (output) => observeSafePath(root, output.path).kind !== "file",
      )
    ) {
      return { ok: false, code: "producer-output-unavailable" };
    }
    const lifecycle = hasVerificationLifecycle(resources.plan);
    const result = await this.#options.verifyChange({
      runId: resources.runId,
      deliveryRevision: resources.deliveryRevision,
      root,
      plan: structuredClone(resources.plan),
      ...(lifecycle
        ? {
            scope: "post-apply" as const,
            verification: structuredClone(
              resources.plan.verification.change.postApply,
            ),
          }
        : {}),
      signal,
    });
    return result.ok &&
      result.exitCode === 0 &&
      result.classification.length > 0
      ? { ok: true }
      : {
          ok: false,
          code: result.ok ? "post-apply-verification-invalid" : result.code,
        };
  }

  #resources(input: {
    runId: string;
    deliveryRevision: number;
    plan?: ImplementPlan;
    baselineRevisionId?: string;
    currentWorkspaceRevisionId?: string;
  }): DurableRunResources {
    const existing = this.#runs.get(input.runId);
    if (existing) {
      if (
        input.baselineRevisionId &&
        existing.baselineRevisionId !== input.baselineRevisionId
      ) {
        throw new Error("workflow-baseline-revision-conflict");
      }
      if (input.plan) {
        existing.plan = structuredClone(input.plan);
        existing.deliveryRevision = input.deliveryRevision;
      }
      return existing;
    }
    if (!input.plan) {
      throw new Error("workflow-plan-unavailable");
    }
    const root = this.#runRoot(input.runId);
    ensurePrivateRunDirectory(root);
    const artifacts = new ArtifactStore(path.join(root, "artifacts"));
    const workspaces = new WorkspaceStore(
      path.join(root, "workspaces"),
      artifacts,
    );
    let baselineRevisionId = input.baselineRevisionId;
    let currentRevisionId = input.currentWorkspaceRevisionId;
    if (!baselineRevisionId || !currentRevisionId) {
      if (baselineRevisionId || currentRevisionId || !input.plan) {
        throw new Error("workflow-workspace-revision-unavailable");
      }
      const baseline = this.#captureBaseline(workspaces, input.plan);
      baselineRevisionId = baseline.revisionId;
      currentRevisionId = baseline.revisionId;
    } else {
      workspaces.getRevision(baselineRevisionId);
      workspaces.getRevision(currentRevisionId);
    }
    let resources!: DurableRunResources;
    const transactions = new ApplyTransaction({
      root: path.join(root, "transactions"),
      artifacts,
      workspaces,
      hooks: {
        postApply: ({ root: verificationRoot, signal }) =>
          this.#verifyPostApply(resources, verificationRoot, signal),
      },
    });
    resources = {
      runId: input.runId,
      root,
      plan: structuredClone(input.plan),
      deliveryRevision: input.deliveryRevision,
      artifacts,
      workspaces,
      ledgers: new Map(),
      transactions,
      baselineRevisionId,
      currentRevisionId,
      mergeTail: Promise.resolve(),
      baselinePromises: new Map(),
      closed: false,
    };
    this.#runs.set(input.runId, resources);
    return resources;
  }

  #closeResources(resources: DurableRunResources): void {
    if (resources.closed) return;
    for (const ledger of resources.ledgers.values()) ledger.close();
    resources.ledgers.clear();
    resources.transactions.close();
    resources.closed = true;
  }

  #ledger(
    resources: DurableRunResources,
    deliveryRevision: number,
  ): TaskLedger {
    const existing = resources.ledgers.get(deliveryRevision);
    if (existing) return existing;
    const ledger = new TaskLedger({
      root: path.join(
        resources.root,
        "ledgers",
        `revision-${deliveryRevision}`,
      ),
      artifacts: resources.artifacts,
    });
    resources.ledgers.set(deliveryRevision, ledger);
    return ledger;
  }

  async #observeVerification(input: {
    resources: DurableRunResources;
    revisionId: string;
    scope: DurableVerificationScope;
    verification: StructuredVerificationContract;
    signal: AbortSignal;
    taskId?: string;
  }): Promise<DurableObservedVerification> {
    if (input.signal.aborted) {
      return {
        ok: false,
        outcome: { kind: "operation-cancelled", code: "cancelled" },
      };
    }
    const root = mkdtempSync(path.join(input.resources.root, "verification-"));
    try {
      input.resources.workspaces.materialize(input.revisionId, root);
      const result = await this.#options.verifyChange({
        runId: input.resources.runId,
        deliveryRevision: input.resources.deliveryRevision,
        root,
        plan: structuredClone(input.resources.plan),
        scope: input.scope,
        verification: structuredClone(input.verification),
        ...(input.taskId ? { taskId: input.taskId } : {}),
        signal: input.signal,
      });
      if (result.ok) {
        return {
          ok: true,
          observation: {
            status: "passed",
            verificationId: input.verification.id,
            failureIdentities: verificationIdentities(
              result,
              input.verification,
              input.scope,
            ),
          },
        };
      }
      if (result.kind === "verification") {
        return {
          ok: true,
          observation: {
            status: "failed",
            verificationId: input.verification.id,
            failureIdentities: verificationIdentities(
              result,
              input.verification,
              input.scope,
            ),
            code: result.code,
          },
        };
      }
      if (result.kind === "approval-boundary") {
        return {
          ok: false,
          outcome: { kind: "approval-needed", code: result.code },
        };
      }
      if (result.kind === "cancelled" || input.signal.aborted) {
        return {
          ok: false,
          outcome: { kind: "operation-cancelled", code: "cancelled" },
        };
      }
      return {
        ok: false,
        outcome: { kind: "paused", code: result.code },
      };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  async #captureVerificationBaseline(input: {
    resources: DurableRunResources;
    ledger: TaskLedger;
    signal: AbortSignal;
  }): Promise<DurableBaselineResult> {
    const stored = input.ledger.durableFact("verification-baseline");
    if (stored !== undefined) {
      const baseline = parseVerificationBaseline(stored);
      if (baseline.revisionId !== input.resources.baselineRevisionId) {
        throw new Error("workflow-verification-baseline-conflict");
      }
      return { ok: true, baseline };
    }
    const plan = input.resources.plan;
    const affected: DurableVerificationBaseline["affected"] = [];
    for (const task of plan.tasks) {
      const observed = await this.#observeVerification({
        resources: input.resources,
        revisionId: input.resources.baselineRevisionId,
        scope: "baseline-task-affected",
        verification: task.affectedVerification,
        taskId: task.taskId,
        signal: input.signal,
      });
      if (!observed.ok) return observed;
      affected.push({
        taskId: task.taskId,
        observation: observed.observation,
      });
    }
    const fullSuite = await this.#observeVerification({
      resources: input.resources,
      revisionId: input.resources.baselineRevisionId,
      scope: "baseline-full-suite",
      verification: plan.verification.baseline.fullSuite,
      signal: input.signal,
    });
    if (!fullSuite.ok) return fullSuite;
    const baseline: DurableVerificationBaseline = {
      revisionId: input.resources.baselineRevisionId,
      targetContracts: plan.tasks.map((task) => ({
        taskId: task.taskId,
        verificationId: task.phases.red.verification.id,
        expectedFailure:
          "expectedFailure" in task.phases.red.verification
            ? (task.phases.red.verification.expectedFailure ??
              task.phases.red.verification.id)
            : task.phases.red.verification.id,
      })),
      affected,
      fullSuite: fullSuite.observation,
    };
    input.ledger.putDurableFact("verification-baseline", baseline);
    return { ok: true, baseline };
  }

  #ensureVerificationBaseline(input: {
    resources: DurableRunResources;
    ledger: TaskLedger;
    signal: AbortSignal;
  }): Promise<DurableBaselineResult> {
    const existing = input.resources.baselinePromises.get(
      input.resources.deliveryRevision,
    );
    if (existing) return existing;
    const pending = this.#captureVerificationBaseline(input).then((result) => {
      if (!result.ok) {
        input.resources.baselinePromises.delete(
          input.resources.deliveryRevision,
        );
      }
      return result;
    });
    input.resources.baselinePromises.set(
      input.resources.deliveryRevision,
      pending,
    );
    return pending;
  }

  async #verifyTaskAffected(input: {
    resources: DurableRunResources;
    baseline: DurableVerificationBaseline;
    task: PlanTaskDraft;
    revisionId: string;
    signal: AbortSignal;
  }): Promise<DurableAffectedResult> {
    const baseline = input.baseline.affected.find(
      (entry) => entry.taskId === input.task.taskId,
    );
    if (!baseline) throw new Error("workflow-task-baseline-unavailable");
    const current = await this.#observeVerification({
      resources: input.resources,
      revisionId: input.revisionId,
      scope: "task-affected",
      verification: input.task.affectedVerification,
      taskId: input.task.taskId,
      signal: input.signal,
    });
    if (!current.ok) return current.outcome;
    if (current.observation.status === "passed") {
      return { kind: "verified", attribution: "none" };
    }
    const prior = new Set(baseline.observation.failureIdentities);
    const introduced = current.observation.failureIdentities.filter(
      (identity) => !prior.has(identity),
    );
    if (introduced.length === 0) {
      return { kind: "verified", attribution: "pre-existing" };
    }
    return {
      kind: "repairable",
      attribution: "introduced",
      failureIdentities: introduced,
    };
  }

  #completeTracking(
    resources: DurableRunResources,
    taskId: string,
  ): WorkspaceRevision {
    const current = resources.workspaces.getRevision(
      resources.currentRevisionId,
    );
    const trackingPath = deliveryTrackingPath(resources.plan);
    if (!trackingPath) return current;
    const entry = current.entries[trackingPath];
    if (!entry || entry.kind === "absent") return current;
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      resources.artifacts.read(entry.hash),
    );
    const escaped = taskId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const taskIdentity = new RegExp(
      `(?:^|[^A-Za-z0-9._:-])${escaped}(?![A-Za-z0-9._:-])`,
      "u",
    );
    let matches = 0;
    let changed = false;
    const updated = text
      .split(/(?<=\n)/u)
      .map((segment) => {
        const line = segment.endsWith("\n") ? segment.slice(0, -1) : segment;
        if (!/^\s*-\s+\[[ xX]\]/u.test(line) || !taskIdentity.test(line)) {
          return segment;
        }
        matches += 1;
        if (/^\s*-\s+\[[xX]\]/u.test(line)) return segment;
        changed = true;
        return segment.replace(/^(\s*-\s+)\[ \]/u, "$1[x]");
      })
      .join("");
    if (matches !== 1) throw new Error("workflow-tracking-task-mismatch");
    if (!changed) return current;
    const next = resources.workspaces.createRevision({
      parentRevisionId: current.revisionId,
      changes: {
        [trackingPath]: {
          kind: "file",
          bytes: new TextEncoder().encode(updated),
          mode: entry.mode,
        },
      },
    });
    resources.currentRevisionId = next.revisionId;
    return next;
  }

  #agentsManagedParts(
    text: string,
  ): { prefix: string; suffix: string } | undefined {
    const startMarker = "<!-- ABEL:AGENTS-INDEX:START -->";
    const endMarker = "<!-- ABEL:AGENTS-INDEX:END -->";
    const lines = text.split("\n");
    const starts: Array<{ line: number; start: number }> = [];
    const ends: Array<{ line: number; end: number }> = [];
    let offset = 0;
    for (const [line, value] of lines.entries()) {
      if (value === startMarker) starts.push({ line, start: offset });
      if (value === endMarker) {
        ends.push({ line, end: offset + value.length });
      }
      offset += value.length + 1;
    }
    if (
      starts.length !== 1 ||
      ends.length !== 1 ||
      starts[0].line >= ends[0].line
    ) {
      return undefined;
    }
    return {
      prefix: text.slice(0, starts[0].start),
      suffix: text.slice(ends[0].end),
    };
  }

  #applyAgentsCheckpoint(
    resources: DurableRunResources,
  ): { ok: true; revision: WorkspaceRevision } | { ok: false; code: string } {
    const checkpoint = resources.plan.verification.agentsCheckpoint;
    const current = resources.workspaces.getRevision(
      resources.currentRevisionId,
    );
    if (!checkpoint.required) return { ok: true, revision: current };
    const changes: Record<
      string,
      { kind: "absent" } | { kind: "file"; bytes: Uint8Array; mode: number }
    > = {};
    for (const operation of checkpoint.operations) {
      const entry = current.entries[operation.target];
      let before: string | null;
      if (!entry || entry.kind === "absent") {
        before = null;
      } else {
        try {
          before = new TextDecoder("utf-8", { fatal: true }).decode(
            resources.artifacts.read(entry.hash),
          );
        } catch {
          return { ok: false, code: "agents-checkpoint-contract-stale" };
        }
      }
      if (operation.impact === "create-index") {
        if (operation.managedBlock === null) {
          throw new Error("workflow-agents-checkpoint-invalid");
        }
        const desired = `${operation.managedBlock}\n`;
        if (before !== null && before !== desired) {
          return { ok: false, code: "agents-checkpoint-contract-stale" };
        }
        if (before === null) {
          changes[operation.target] = {
            kind: "file",
            bytes: new TextEncoder().encode(desired),
            mode: 0o644,
          };
        }
        continue;
      }
      if (operation.impact === "remove-index") {
        if (operation.managedBlock !== null) {
          throw new Error("workflow-agents-checkpoint-invalid");
        }
        if (before === null) continue;
        const parts = this.#agentsManagedParts(before);
        if (!parts) {
          return { ok: false, code: "agents-checkpoint-contract-stale" };
        }
        const after = `${parts.prefix}${parts.suffix}`;
        changes[operation.target] =
          after.trim().length === 0
            ? { kind: "absent" }
            : {
                kind: "file",
                bytes: new TextEncoder().encode(after),
                mode: entry?.kind === "file" ? entry.mode : 0o644,
              };
        continue;
      }
      if (operation.managedBlock === null || before === null) {
        return { ok: false, code: "agents-checkpoint-contract-stale" };
      }
      const parts = this.#agentsManagedParts(before);
      if (!parts) {
        return { ok: false, code: "agents-checkpoint-contract-stale" };
      }
      const after = `${parts.prefix}${operation.managedBlock}${parts.suffix}`;
      if (after !== before) {
        changes[operation.target] = {
          kind: "file",
          bytes: new TextEncoder().encode(after),
          mode: entry?.kind === "file" ? entry.mode : 0o644,
        };
      }
    }
    if (Object.keys(changes).length === 0) {
      return { ok: true, revision: current };
    }
    return {
      ok: true,
      revision: resources.workspaces.createRevision({
        parentRevisionId: current.revisionId,
        changes,
      }),
    };
  }

  #openTask(
    resources: DurableRunResources,
    ledger: TaskLedger,
    input: Parameters<WorkflowWorker["runAttempt"]>[0],
  ): void {
    const revision = resources.workspaces.getRevision(
      resources.baselineRevisionId,
    );
    const contextRefs = [...new Set(input.task.phases.red.read)]
      .sort()
      .flatMap((relative) => {
        const entry = revision.entries[relative];
        return entry?.kind === "file"
          ? [{ kind: "path" as const, path: relative, hash: entry.hash }]
          : [];
      });
    ledger.openTask({
      runId: input.runId,
      deliveryRevision: input.deliveryRevision,
      taskId: input.taskId,
      boundaryHash: hash("durable-task-boundary", JSON.stringify(input.task)),
      objective: input.task.objective,
      contextRefs,
      initialPhase: "red",
    });
  }

  #replayedPhase(
    resources: DurableRunResources,
    ledger: TaskLedger,
    input: Parameters<WorkflowWorker["runAttempt"]>[0],
  ): WorkflowAttemptOutcome | undefined {
    if (input.artifactCorrection?.code === "red-artifact-constraint") {
      return undefined;
    }
    const projection = ledger.projection({
      runId: input.runId,
      taskId: input.taskId,
      nextPhase: input.phase,
    }) as {
      history: Array<Record<string, unknown>>;
    };
    const event = projection.history.find(
      (candidate) =>
        candidate.kind === "phase-verified" && candidate.phase === input.phase,
    );
    if (!event) return undefined;
    if (
      typeof event.artifactHash !== "string" ||
      !SHA256.test(event.artifactHash) ||
      typeof event.isolatedRevisionId !== "string" ||
      !SHA256.test(event.isolatedRevisionId) ||
      typeof event.exitCode !== "number" ||
      event.actualClassification !== expectedClassification(input.phase)
    ) {
      throw new Error("workflow-ledger-phase-invalid");
    }
    let isolatedRevisionId = event.isolatedRevisionId;
    const finalPhase = input.task.phases.refactor ? "refactor" : "green";
    if (hasVerificationLifecycle(input.plan) && input.phase === finalPhase) {
      const fact = ledger.durableFact(
        `task-final-${hash(input.taskId).slice(0, 40)}`,
      );
      if (
        !isRecord(fact) ||
        fact.taskId !== input.taskId ||
        fact.phase !== input.phase ||
        typeof fact.isolatedRevisionId !== "string" ||
        !SHA256.test(fact.isolatedRevisionId)
      ) {
        throw new Error("workflow-task-completion-fact-invalid");
      }
      isolatedRevisionId = fact.isolatedRevisionId;
    }
    resources.workspaces.getRevision(isolatedRevisionId);
    if (
      this.#revisionDescendsFrom(
        resources,
        resources.currentRevisionId,
        isolatedRevisionId,
      )
    ) {
      isolatedRevisionId = resources.currentRevisionId;
    } else if (
      !this.#revisionDescendsFrom(
        resources,
        isolatedRevisionId,
        resources.currentRevisionId,
      )
    ) {
      throw new Error("workspace-revision-stale");
    }
    resources.currentRevisionId = isolatedRevisionId;
    return {
      kind: "phase-committed",
      artifactHash: event.artifactHash,
      isolatedRevisionId,
      exitCode: event.exitCode,
      classification: expectedClassification(input.phase),
      baselineRevisionId: resources.baselineRevisionId,
    };
  }

  #expandedBaseline(
    resources: DurableRunResources,
    plan: ImplementPlan,
  ): WorkspaceRevision {
    const baseline = resources.workspaces.getRevision(
      resources.baselineRevisionId,
    );
    const candidates = new Map<string, boolean>(
      deliveryBoundPaths(plan).map((relative) => [relative, false]),
    );
    for (const task of plan.tasks) {
      for (const phase of Object.values(task.phases)) {
        for (const relative of phase.read) candidates.set(relative, false);
        for (const relative of [...phase.write, ...phase.delete]) {
          candidates.set(relative, true);
        }
      }
    }
    for (const output of plan.outputs) candidates.set(output.path, true);
    for (const task of plan.tasks) {
      if (task.agents.impact === "none" || !task.agents.target) continue;
      candidates.set(task.agents.target, task.agents.impact === "create-index");
    }
    const trackingPath = deliveryTrackingPath(plan);
    if (
      trackingPath &&
      (Object.hasOwn(baseline.entries, trackingPath) ||
        observeSafePath(this.#options.consumerRoot, trackingPath).kind ===
          "file")
    ) {
      candidates.set(trackingPath, false);
    }
    const changes: Record<
      string,
      { kind: "absent" } | { kind: "file"; bytes: Uint8Array; mode: number }
    > = {};
    for (const [relative, mayBeAbsent] of [...candidates].sort(
      ([left], [right]) => left.localeCompare(right),
    )) {
      if (relative === ".") continue;
      const observation = observeSafePath(this.#options.consumerRoot, relative);
      if (observation.kind === "absent") {
        if (baseline.entries[relative]?.kind === "absent") continue;
        if (!mayBeAbsent)
          throw new Error("workflow-baseline-input-unavailable");
        changes[relative] = { kind: "absent" };
        continue;
      }
      if (observation.kind !== "file") {
        throw new Error("workflow-baseline-path-unsafe");
      }
      const target = path.join(
        this.#options.consumerRoot,
        ...relative.split("/"),
      );
      const stat = lstatSync(target);
      const bytes = readFileSync(target);
      const mode = stat.mode & 0o777;
      const prior = baseline.entries[relative];
      if (
        prior?.kind === "file" &&
        prior.hash === sha256Bytes(bytes) &&
        prior.bytes === bytes.byteLength &&
        prior.mode === mode
      ) {
        continue;
      }
      changes[relative] = {
        kind: "file",
        bytes,
        mode,
      };
    }
    return Object.keys(changes).length === 0
      ? baseline
      : resources.workspaces.createRevision({
          parentRevisionId: baseline.revisionId,
          changes,
        });
  }

  #orderedTasks(plan: ImplementPlan): PlanTaskDraft[] {
    const remaining = new Map(plan.tasks.map((task) => [task.taskId, task]));
    const ordered: PlanTaskDraft[] = [];
    const admitted = new Set<string>();
    while (remaining.size > 0) {
      let progressed = false;
      for (const task of plan.tasks) {
        if (
          !remaining.has(task.taskId) ||
          task.dependsOn.some((dependency) => !admitted.has(dependency))
        ) {
          continue;
        }
        remaining.delete(task.taskId);
        admitted.add(task.taskId);
        ordered.push(task);
        progressed = true;
      }
      if (!progressed) throw new Error("workflow-plan-dependency-cycle");
    }
    return ordered;
  }

  #phaseFacts(
    resources: DurableRunResources,
    task: {
      taskId: string;
      deliveryRevision: number;
      phase: "red" | "green" | "refactor";
    },
  ): DurablePhaseFact[] {
    let projection: unknown;
    try {
      projection = this.#ledger(resources, task.deliveryRevision).projection({
        runId: resources.runId,
        taskId: task.taskId,
        nextPhase: task.phase,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "ledger-task-unavailable"
      ) {
        return [];
      }
      throw error;
    }
    if (!isRecord(projection) || !Array.isArray(projection.history)) {
      throw new Error("workflow-ledger-projection-invalid");
    }
    return projection.history.flatMap((event): DurablePhaseFact[] => {
      if (
        !isRecord(event) ||
        (event.kind !== "phase-verified" && event.kind !== "repair-verified")
      ) {
        return [];
      }
      if (
        !["red", "green", "refactor"].includes(String(event.phase)) ||
        typeof event.isolatedRevisionId !== "string" ||
        !SHA256.test(event.isolatedRevisionId) ||
        !Array.isArray(event.outputFacts)
      ) {
        throw new Error("workflow-ledger-phase-invalid");
      }
      const outputFacts = event.outputFacts.map((fact) => {
        if (
          !isRecord(fact) ||
          typeof fact.path !== "string" ||
          (fact.kind !== "absent" && fact.kind !== "file")
        ) {
          throw new Error("workflow-ledger-phase-invalid");
        }
        if (fact.kind === "absent") {
          return { path: fact.path, kind: "absent" as const };
        }
        if (
          typeof fact.hash !== "string" ||
          !SHA256.test(fact.hash) ||
          !Number.isSafeInteger(fact.bytes) ||
          (fact.bytes as number) < 0
        ) {
          throw new Error("workflow-ledger-phase-invalid");
        }
        return {
          path: fact.path,
          kind: "file" as const,
          hash: fact.hash,
          bytes: fact.bytes as number,
        };
      });
      return [
        {
          kind: event.kind,
          phase: event.phase as DurablePhaseFact["phase"],
          isolatedRevisionId: event.isolatedRevisionId,
          outputFacts,
        },
      ];
    });
  }

  revalidateDelivery(
    input: Parameters<NonNullable<WorkflowWorker["revalidateDelivery"]>>[0],
  ): ReturnType<NonNullable<WorkflowWorker["revalidateDelivery"]>> {
    const resources = this.#resources({
      runId: input.runId,
      deliveryRevision: input.deliveryRevision,
      plan: input.plan,
      baselineRevisionId: input.baselineRevisionId,
      currentWorkspaceRevisionId: input.currentWorkspaceRevisionId,
    });
    const expandedBaseline = this.#expandedBaseline(resources, input.plan);
    const rows = new Map(input.tasks.map((task) => [task.taskId, task]));
    const facts = new Map(
      input.tasks.map((task) => [
        task.taskId,
        this.#phaseFacts(resources, task),
      ]),
    );
    const invalidated = new Set(input.invalidatedTaskIds);
    const ordered = this.#orderedTasks(input.plan);
    let rebuilt = expandedBaseline;
    for (;;) {
      let grew = false;
      rebuilt = expandedBaseline;
      for (const task of ordered) {
        const row = rows.get(task.taskId);
        if (!row || invalidated.has(task.taskId)) continue;
        if (task.dependsOn.some((dependency) => invalidated.has(dependency))) {
          invalidated.add(task.taskId);
          grew = true;
          continue;
        }
        for (const fact of facts.get(task.taskId) ?? []) {
          const phase = task.phases[fact.phase];
          if (!phase) {
            invalidated.add(task.taskId);
            grew = true;
            break;
          }
          const original = resources.workspaces.getRevision(
            fact.isolatedRevisionId,
          );
          if (!original.parentRevisionId) {
            throw new Error("workflow-ledger-revision-base-invalid");
          }
          const originalBase = resources.workspaces.getRevision(
            original.parentRevisionId,
          );
          const current = resources.workspaces.getRevision(rebuilt.revisionId);
          const boundaries =
            fact.kind === "repair-verified"
              ? Object.values(task.phases)
              : [phase];
          const boundPaths = [
            ...new Set(
              boundaries.flatMap((boundary) => [
                ...boundary.read,
                ...boundary.write,
                ...boundary.delete,
                ...boundary.verificationInputs.flatMap((binding) =>
                  binding.kind === "workspace" ? [binding.path] : [],
                ),
              ]),
            ),
          ];
          if (
            boundPaths.some(
              (relative) =>
                !workspaceEntryEqual(
                  originalBase.entries[relative],
                  current.entries[relative],
                ),
            )
          ) {
            invalidated.add(task.taskId);
            grew = true;
            break;
          }
          const changes: Record<
            string,
            | { kind: "absent" }
            | { kind: "file"; bytes: Uint8Array; mode: number }
          > = {};
          for (const output of fact.outputFacts) {
            const entry = original.entries[output.path];
            if (
              output.kind === "absent"
                ? entry?.kind !== "absent"
                : entry?.kind !== "file" ||
                  entry.hash !== output.hash ||
                  entry.bytes !== output.bytes
            ) {
              throw new Error("workflow-ledger-output-integrity-invalid");
            }
            changes[output.path] =
              entry.kind === "absent"
                ? { kind: "absent" }
                : {
                    kind: "file",
                    bytes: resources.artifacts.read(entry.hash),
                    mode: entry.mode,
                  };
          }
          rebuilt = resources.workspaces.createRevision({
            parentRevisionId: rebuilt.revisionId,
            changes,
          });
        }
      }
      for (const output of input.plan.outputs) {
        if (invalidated.has(output.producer.taskId)) continue;
        const produced = (facts.get(output.producer.taskId) ?? []).some(
          (fact) => fact.phase === output.producer.phase,
        );
        if (
          produced &&
          rebuilt.entries[output.path]?.kind !== "file" &&
          !invalidated.has(output.producer.taskId)
        ) {
          invalidated.add(output.producer.taskId);
          grew = true;
        }
      }
      if (!grew) break;
    }
    if (hasVerificationLifecycle(input.plan)) {
      const retainedRevisions = new Set(
        input.tasks
          .filter((task) => !invalidated.has(task.taskId))
          .map((task) => task.deliveryRevision),
      );
      for (const deliveryRevision of retainedRevisions) {
        const ledger = this.#ledger(resources, deliveryRevision);
        const stored = ledger.durableFact("verification-baseline");
        resources.baselinePromises.delete(deliveryRevision);
        if (stored === undefined) continue;
        const baseline = parseVerificationBaseline(stored);
        if (baseline.revisionId === expandedBaseline.revisionId) continue;
        if (baseline.revisionId !== input.baselineRevisionId) {
          throw new Error("workflow-verification-baseline-conflict");
        }
        ledger.replaceDurableFact("verification-baseline", stored, {
          ...baseline,
          revisionId: expandedBaseline.revisionId,
        });
      }
    }
    resources.baselineRevisionId = expandedBaseline.revisionId;
    resources.currentRevisionId = rebuilt.revisionId;
    if (hasVerificationLifecycle(input.plan)) {
      for (const task of input.tasks) {
        if (task.state === "verified" && !invalidated.has(task.taskId)) {
          this.#completeTracking(resources, task.taskId);
        }
      }
    }
    return {
      invalidatedTaskIds: [...invalidated].sort(),
      baselineRevisionId: resources.baselineRevisionId,
      currentWorkspaceRevisionId: resources.currentRevisionId,
    };
  }

  async #mergeCandidate(
    resources: DurableRunResources,
    input: Parameters<WorkflowWorker["runAttempt"]>[0],
    baseRevisionId: string,
    candidateRevisionId: string,
    boundPaths?: string[],
  ) {
    let release!: () => void;
    const prior = resources.mergeTail;
    resources.mergeTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prior;
    try {
      const phase = input.task.phases[input.phase];
      if (!phase) throw new Error("workflow-task-phase-invalid");
      const merged = resources.workspaces.mergeRevision({
        baseRevisionId,
        currentRevisionId: resources.currentRevisionId,
        candidateRevisionId,
        boundPaths: boundPaths ?? [
          ...new Set([...phase.read, ...phase.write, ...phase.delete]),
        ],
      });
      resources.currentRevisionId = merged.revisionId;
      return merged;
    } finally {
      release();
    }
  }

  async #rollbackWorkspacePaths(input: {
    resources: DurableRunResources;
    baseRevisionId: string;
    rejectedRevisionId: string;
    paths: readonly string[];
  }): Promise<void> {
    const { resources } = input;
    let release!: () => void;
    const prior = resources.mergeTail;
    resources.mergeTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prior;
    try {
      const base = resources.workspaces.getRevision(input.baseRevisionId);
      const rejected = resources.workspaces.getRevision(
        input.rejectedRevisionId,
      );
      const current = resources.workspaces.getRevision(
        resources.currentRevisionId,
      );
      const changes: Record<
        string,
        { kind: "absent" } | { kind: "file"; bytes: Uint8Array; mode: number }
      > = {};
      for (const relative of [...new Set(input.paths)].sort()) {
        const before = base.entries[relative];
        const rejectedEntry = rejected.entries[relative];
        if (workspaceEntryEqual(before, rejectedEntry)) continue;
        const latest = current.entries[relative];
        if (workspaceEntryEqual(latest, before)) continue;
        if (!workspaceEntryEqual(latest, rejectedEntry)) {
          throw new Error("workspace-revision-stale");
        }
        changes[relative] =
          before?.kind === "file"
            ? {
                kind: "file",
                bytes: resources.artifacts.read(before.hash),
                mode: before.mode,
              }
            : { kind: "absent" };
      }
      if (Object.keys(changes).length === 0) return;
      const rolledBack = resources.workspaces.createRevision({
        parentRevisionId: current.revisionId,
        changes,
      });
      resources.currentRevisionId = rolledBack.revisionId;
    } finally {
      release();
    }
  }

  async #runRepairCandidate(input: {
    resources: DurableRunResources;
    ledger: TaskLedger;
    attempt: Parameters<WorkflowWorker["runAttempt"]>[0];
    repairAttempt: number;
    failureIdentities: string[];
  }): Promise<DurableRepairResult> {
    const { resources, ledger } = input;
    const request = input.attempt;
    if (request.signal.aborted) {
      return { kind: "operation-cancelled", code: "cancelled" };
    }
    const phase = request.task.phases[request.phase];
    if (!phase) throw new Error("workflow-task-phase-invalid");
    const allPhases = Object.values(request.task.phases);
    const approvedWritePaths = [
      ...new Set(allPhases.flatMap((boundary) => boundary.write)),
    ].sort();
    const approvedDeletePaths = [
      ...new Set(allPhases.flatMap((boundary) => boundary.delete)),
    ].sort();
    const approvedPaths = [
      ...new Set([...approvedWritePaths, ...approvedDeletePaths]),
    ].sort();
    const boundPaths = [
      ...new Set(
        allPhases.flatMap((boundary) => [
          ...boundary.read,
          ...boundary.write,
          ...boundary.delete,
        ]),
      ),
    ].sort();
    if (approvedPaths.length === 0) {
      return { kind: "approval-needed", code: "task-write-set-empty" };
    }
    const baseRevisionId = resources.currentRevisionId;
    const proposalRoot = mkdtempSync(path.join(resources.root, "repair-"));
    try {
      resources.workspaces.materialize(baseRevisionId, proposalRoot);
      if (request.routeId) {
        const rebound = this.#broker.resumeBinding({
          runId: request.runId,
          role: "implementation-worker",
          routeId: request.routeId,
          ...(request.routeFingerprint
            ? { expectedFingerprint: request.routeFingerprint }
            : {}),
          requirements: IMPLEMENTATION_ROUTE_REQUIREMENTS,
        });
        if (!rebound.ok) return { kind: "paused", code: rebound.code };
      }
      const ledgerProjection = ledger.projection({
        runId: request.runId,
        taskId: request.taskId,
        nextPhase: request.phase,
      });
      const repair = {
        attempt: input.repairAttempt,
        attribution: "introduced" as const,
        failureIdentities: [...input.failureIdentities],
      };
      let identity: BeginCandidateInput | undefined;
      const routed = await this.#broker.run({
        runId: request.runId,
        operationId: `${request.operationId}:${request.taskId}:repair:${input.repairAttempt}`,
        role: "implementation-worker",
        requirements: IMPLEMENTATION_ROUTE_REQUIREMENTS,
        signal: request.signal,
        ...(request.onActivity ? { onActivity: request.onActivity } : {}),
        execute: (attempt) => {
          identity = {
            candidateId: `candidate-${randomUUID()}`,
            runId: request.runId,
            deliveryRevision: request.deliveryRevision,
            taskId: request.taskId,
            phase: request.phase,
            attemptId: `repair-${hash(
              request.operationId,
              request.taskId,
              String(input.repairAttempt),
              attempt.route.fingerprint,
            ).slice(0, 40)}`,
            approvedPaths,
            isolatedRevisionId: baseRevisionId,
            verificationId: request.task.repairVerification.id,
            routeId: attempt.route.id,
            routeFingerprint: attempt.route.fingerprint,
          };
          return this.#options.proposeCandidate({
            runId: request.runId,
            operationId: request.operationId,
            deliveryRevision: request.deliveryRevision,
            taskId: request.taskId,
            phase: request.phase,
            task: structuredClone(request.task),
            workspaceRoot: proposalRoot,
            ledgerProjection,
            candidateArtifact: {
              ledger,
              identity,
              workspaceRoot: proposalRoot,
              writePaths: approvedWritePaths,
              deletePaths: approvedDeletePaths,
            },
            route: attempt.route,
            repair,
            ...(request.artifactCorrection
              ? { artifactCorrection: request.artifactCorrection }
              : {}),
            signal: attempt.signal,
            onHeaders: attempt.onHeaders,
            onProgress: attempt.onProgress,
          });
        },
      });
      if (!routed.ok) {
        return routed.state === "cancelled" || request.signal.aborted
          ? { kind: "operation-cancelled", code: "cancelled" }
          : { kind: "paused", code: routed.code };
      }
      if (!identity || identity.routeId !== routed.routeId) {
        throw new Error("candidate-route-identity-invalid");
      }
      const correctionIdentity = identity;
      const withRoute = <T extends object>(outcome: T) => ({
        ...outcome,
        routeId: correctionIdentity.routeId,
        routeFingerprint: correctionIdentity.routeFingerprint,
      });
      let uncommittedRevisionId: string | undefined;
      const reject = async <T extends object>(
        outcome: T,
        correction: {
          category: "artifact" | "stale" | "verification" | "checkpoint";
          code: string;
          stage: string;
        },
        rollback = false,
      ): Promise<T> => {
        if (rollback && uncommittedRevisionId) {
          await this.#rollbackWorkspacePaths({
            resources,
            baseRevisionId,
            rejectedRevisionId: uncommittedRevisionId,
            paths: approvedPaths,
          });
        }
        this.#recordCorrection(ledger, request, correctionIdentity, correction);
        return withRoute({ ...outcome, retryPolicy: correction.category });
      };
      const proposal = routed.value;
      if (
        proposal.kind !== "candidate" &&
        proposal.kind !== "sealed-candidate"
      ) {
        return proposal.kind === "operation-cancelled" ||
          proposal.kind === "paused" ||
          proposal.kind === "approval-needed"
          ? withRoute(proposal)
          : reject(proposal, {
              category: "artifact",
              code: proposal.code,
              stage: "candidate-submit",
            });
      }
      emitWorkflowActivity(request.onActivity, { state: "validating" });
      ledger.beginCandidate(identity);
      let bytes: Buffer;
      if (proposal.kind === "sealed-candidate") {
        if (
          proposal.candidateId !== identity.candidateId ||
          !SHA256.test(proposal.artifactHash) ||
          !Number.isSafeInteger(proposal.bytes) ||
          proposal.bytes < 1 ||
          !Array.isArray(proposal.paths)
        ) {
          return reject(
            { kind: "retryable", code: "candidate-diff-invalid" },
            {
              category: "artifact",
              code: "candidate-diff-invalid",
              stage: "candidate-seal",
            },
          );
        }
        bytes = Buffer.from(ledger.readSealedCandidate(identity.candidateId));
        if (
          bytes.length !== proposal.bytes ||
          sha256Bytes(bytes) !== proposal.artifactHash
        ) {
          throw new Error("candidate-seal-integrity-invalid");
        }
      } else {
        if (
          !(proposal.bytes instanceof Uint8Array) ||
          proposal.bytes.length === 0
        ) {
          return reject(
            { kind: "retryable", code: "candidate-diff-invalid" },
            {
              category: "artifact",
              code: "candidate-diff-invalid",
              stage: "candidate-submit",
            },
          );
        }
        bytes = Buffer.from(proposal.bytes);
      }
      let candidatePaths: string[];
      try {
        candidatePaths = diffWritePaths(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        ).paths;
      } catch {
        return reject(
          { kind: "retryable", code: "candidate-diff-invalid" },
          {
            category: "artifact",
            code: "candidate-diff-invalid",
            stage: "candidate-diff",
          },
        );
      }
      if (
        candidatePaths.some((relative) => !approvedPaths.includes(relative))
      ) {
        return reject(
          {
            kind: "approval-needed",
            code: "repair-boundary-expansion",
          },
          {
            category: "artifact",
            code: "repair-boundary-expansion",
            stage: "candidate-boundary",
          },
        );
      }
      if (proposal.kind === "sealed-candidate") {
        if (
          JSON.stringify([...proposal.paths].sort()) !==
          JSON.stringify([...candidatePaths].sort())
        ) {
          return reject(
            { kind: "retryable", code: "candidate-diff-invalid" },
            {
              category: "artifact",
              code: "candidate-diff-invalid",
              stage: "candidate-seal",
            },
          );
        }
      }
      const dependencySensitive = candidatePaths.some(
        (relative) => relative === "package.json" || LOCKFILES.has(relative),
      );
      let dependenciesBefore: Map<string, DependencyContractEntry> | undefined;
      if (dependencySensitive) {
        try {
          dependenciesBefore = dependencyContract(proposalRoot);
        } catch (error) {
          if (!(error instanceof DependencyManifestError)) throw error;
          return reject(
            { kind: "retryable", code: error.message },
            {
              category: "artifact",
              code: error.message,
              stage: "candidate-dependency",
            },
          );
        }
      }

      const checked = await runGitApply(
        proposalRoot,
        bytes,
        true,
        request.signal,
      );
      if (checked !== "ok") {
        return checked === "cancelled"
          ? withRoute({ kind: "operation-cancelled", code: "cancelled" })
          : reject(
              { kind: "retryable", code: "candidate-diff-invalid" },
              {
                category: "artifact",
                code: "candidate-diff-invalid",
                stage: "candidate-check",
              },
            );
      }
      const applied = await runGitApply(
        proposalRoot,
        bytes,
        false,
        request.signal,
      );
      if (applied !== "ok") {
        return applied === "cancelled"
          ? withRoute({ kind: "operation-cancelled", code: "cancelled" })
          : reject(
              { kind: "retryable", code: "candidate-diff-invalid" },
              {
                category: "artifact",
                code: "candidate-diff-invalid",
                stage: "candidate-apply",
              },
            );
      }
      if (dependenciesBefore) {
        let dependenciesAfter: Map<string, DependencyContractEntry>;
        try {
          dependenciesAfter = dependencyContract(proposalRoot);
        } catch (error) {
          if (!(error instanceof DependencyManifestError)) throw error;
          return reject(
            { kind: "retryable", code: error.message },
            {
              category: "artifact",
              code: error.message,
              stage: "candidate-dependency",
            },
          );
        }
        if (
          hasUnapprovedDependencyChange(
            dependenciesBefore,
            dependenciesAfter,
            request.task.approvedDependencies,
            candidatePaths.some((relative) => LOCKFILES.has(relative)),
          )
        ) {
          return reject(
            { kind: "approval-needed", code: "unapproved-dependency-change" },
            {
              category: "artifact",
              code: "unapproved-dependency-change",
              stage: "candidate-dependency",
            },
          );
        }
      }

      let artifactHash: string;
      if (proposal.kind === "sealed-candidate") {
        artifactHash = proposal.artifactHash;
      } else {
        let sequence = 0;
        for (
          let offset = 0;
          offset < bytes.length;
          offset += TASK_LEDGER_LIMITS.maxSegmentBytes
        ) {
          const segment = bytes.subarray(
            offset,
            Math.min(offset + TASK_LEDGER_LIMITS.maxSegmentBytes, bytes.length),
          );
          const accepted = ledger.appendCandidateSegment({
            ...identity,
            sequence,
            bytes: segment,
            segmentHash: sha256Bytes(segment),
          });
          if (!accepted.ok) {
            return reject(
              { kind: "paused", code: accepted.code },
              {
                category: "artifact",
                code: accepted.code,
                stage: "candidate-segment",
              },
            );
          }
          sequence += 1;
        }
        const sealed = ledger.sealCandidate({
          ...identity,
          segmentCount: sequence,
          totalBytes: bytes.length,
          candidateHash: sha256Bytes(bytes),
        });
        if (!sealed.ok) {
          return reject(
            { kind: "retryable", code: sealed.code },
            {
              category: "artifact",
              code: sealed.code,
              stage: "candidate-seal",
            },
          );
        }
        artifactHash = sealed.artifactHash;
      }
      const candidate = resources.workspaces.createRevision({
        parentRevisionId: baseRevisionId,
        changes: revisionChanges(proposalRoot, approvedPaths),
      });
      const requiredOutputs = request.plan.outputs.filter(
        (output) =>
          output.producer.taskId === request.taskId &&
          (!request.artifactCorrection || output.producer.phase !== "refactor"),
      );
      if (
        requiredOutputs.some(
          (output) => candidate.entries[output.path]?.kind !== "file",
        )
      ) {
        return reject(
          { kind: "retryable", code: "producer-output-unavailable" },
          {
            category: "artifact",
            code: "producer-output-unavailable",
            stage: "candidate-output",
          },
        );
      }
      emitWorkflowActivity(request.onActivity, { state: "verifying" });
      const verified = await this.#options.verifyPhase({
        runId: request.runId,
        deliveryRevision: request.deliveryRevision,
        taskId: request.taskId,
        phase: request.phase,
        root: proposalRoot,
        verification: structuredClone(request.task.repairVerification),
        signal: request.signal,
      });
      if (!verified.ok) {
        return reject(verified, {
          category: "verification",
          code: verified.code,
          stage: "phase-verification",
        });
      }
      if (
        verified.classification !== "expected-green" ||
        verified.exitCode !== 0
      ) {
        return reject(
          { kind: "retryable", code: "verification-rejected" },
          {
            category: "verification",
            code: "verification-rejected",
            stage: "phase-verification",
          },
        );
      }
      let merged: ReturnType<WorkspaceStore["mergeRevision"]>;
      try {
        merged = await this.#mergeCandidate(
          resources,
          request,
          baseRevisionId,
          candidate.revisionId,
          boundPaths,
        );
        uncommittedRevisionId = merged.revisionId;
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "workspace-revision-stale"
        ) {
          return reject(
            { kind: "retryable", code: "workspace-revision-stale" },
            {
              category: "stale",
              code: "workspace-revision-stale",
              stage: "candidate-merge",
            },
          );
        }
        throw error;
      }
      if (
        requiredOutputs.some(
          (output) => merged.entries[output.path]?.kind !== "file",
        )
      ) {
        return reject(
          { kind: "retryable", code: "producer-output-unavailable" },
          {
            category: "artifact",
            code: "producer-output-unavailable",
            stage: "candidate-output",
          },
          true,
        );
      }
      const outputFacts = approvedPaths.map((relative) => {
        const entry = merged.entries[relative];
        return entry?.kind === "file"
          ? {
              path: relative,
              kind: "file" as const,
              hash: entry.hash,
              bytes: entry.bytes,
            }
          : { path: relative, kind: "absent" as const };
      });
      return {
        kind: "repair-committed",
        commit: {
          artifactHash,
          isolatedRevisionId: merged.revisionId,
          exitCode: verified.exitCode,
          classification: verified.classification,
          diagnostic: verified.diagnostic,
          outputFacts,
          routeId: identity.routeId,
          routeFingerprint: identity.routeFingerprint,
        },
      };
    } finally {
      rmSync(proposalRoot, { recursive: true, force: true });
    }
  }

  #revisionDescendsFrom(
    resources: DurableRunResources,
    descendantRevisionId: string,
    ancestorRevisionId: string,
  ): boolean {
    let current = resources.workspaces.getRevision(descendantRevisionId);
    const visited = new Set<string>();
    for (;;) {
      if (current.revisionId === ancestorRevisionId) return true;
      if (
        current.parentRevisionId === null ||
        visited.has(current.revisionId)
      ) {
        return false;
      }
      visited.add(current.revisionId);
      current = resources.workspaces.getRevision(current.parentRevisionId);
    }
  }

  #verifiedPhaseReplay(
    ledger: TaskLedger,
    input: Parameters<WorkflowWorker["runAttempt"]>[0],
  ): { artifactHash: string; exitCode: number; isolatedRevisionId: string } {
    const projection = ledger.projection({
      runId: input.runId,
      taskId: input.taskId,
      nextPhase: input.phase,
    }) as { history: Array<Record<string, unknown>> };
    const event = projection.history.find(
      (candidate) =>
        candidate.kind === "phase-verified" && candidate.phase === input.phase,
    );
    if (
      !event ||
      typeof event.artifactHash !== "string" ||
      !SHA256.test(event.artifactHash) ||
      typeof event.isolatedRevisionId !== "string" ||
      !SHA256.test(event.isolatedRevisionId) ||
      typeof event.exitCode !== "number" ||
      event.actualClassification !== expectedClassification(input.phase)
    ) {
      throw new Error("workflow-ledger-phase-invalid");
    }
    return {
      artifactHash: event.artifactHash,
      exitCode: event.exitCode,
      isolatedRevisionId: event.isolatedRevisionId,
    };
  }

  async #runRedArtifactCorrection(input: {
    resources: DurableRunResources;
    ledger: TaskLedger;
    baseline?: DurableVerificationBaseline;
    attempt: Parameters<WorkflowWorker["runAttempt"]>[0];
  }): Promise<WorkflowAttemptOutcome> {
    const { resources, ledger } = input;
    const request = input.attempt;
    if (
      request.phase !== "green" ||
      request.artifactCorrection?.code !== "red-artifact-constraint"
    ) {
      throw new Error("workflow-red-artifact-correction-invalid");
    }
    const priorRed = this.#verifiedPhaseReplay(ledger, {
      ...request,
      phase: "red",
    });
    if (!hasVerificationLifecycle(request.plan)) {
      return { kind: "paused", code: "red-artifact-constraint" };
    }
    const stableRevisionId = resources.currentRevisionId;
    const correctionPaths = [
      ...new Set(
        Object.values(request.task.phases).flatMap((phase) => [
          ...phase.write,
          ...phase.delete,
        ]),
      ),
    ];
    const rejectCorrection = async <T extends WorkflowAttemptOutcome>(
      outcome: T,
    ): Promise<T> => {
      if (resources.currentRevisionId !== stableRevisionId) {
        await this.#rollbackWorkspacePaths({
          resources,
          baseRevisionId: stableRevisionId,
          rejectedRevisionId: resources.currentRevisionId,
          paths: correctionPaths,
        });
      }
      return outcome;
    };
    const failureIdentities = [
      hash(
        "red-artifact-constraint",
        request.taskId,
        request.task.phases.red.verification.id,
      ),
    ];
    const correctionAttemptUsed = request.artifactCorrection.attempt;
    if (
      correctionAttemptUsed < 1 ||
      correctionAttemptUsed > request.artifactCorrection.maxAttempts
    ) {
      throw new Error("workflow-red-artifact-correction-invalid");
    }
    const repaired = await this.#runRepairCandidate({
      resources,
      ledger,
      attempt: request,
      repairAttempt: correctionAttemptUsed,
      failureIdentities,
    });
    if (repaired.kind !== "repair-committed") {
      return rejectCorrection(repaired);
    }

    const correctedRevision = resources.workspaces.getRevision(
      repaired.commit.isolatedRevisionId,
    );
    const acceptedRedRevision = resources.workspaces.getRevision(
      priorRed.isolatedRevisionId,
    );
    if (!acceptedRedRevision.parentRevisionId) {
      throw new Error("workflow-ledger-revision-base-invalid");
    }
    const correctedRedChanges: Record<
      string,
      { kind: "absent" } | { kind: "file"; bytes: Uint8Array; mode: number }
    > = {};
    for (const relative of [
      ...new Set([
        ...request.task.phases.red.write,
        ...request.task.phases.red.delete,
      ]),
    ]) {
      const entry = correctedRevision.entries[relative];
      correctedRedChanges[relative] =
        entry?.kind === "file"
          ? {
              kind: "file",
              bytes: resources.artifacts.read(entry.hash),
              mode: entry.mode,
            }
          : { kind: "absent" };
    }
    const correctedRedRevision = resources.workspaces.createRevision({
      parentRevisionId: acceptedRedRevision.parentRevisionId,
      changes: correctedRedChanges,
    });
    const verifyCorrectedContract = async (input: {
      phase: "red" | "green";
      revisionId: string;
      verification: StructuredVerificationContract;
    }): Promise<DurablePhaseVerificationResult> => {
      const root = mkdtempSync(path.join(resources.root, "correction-check-"));
      try {
        resources.workspaces.materialize(input.revisionId, root);
        return await this.#options.verifyPhase({
          runId: request.runId,
          deliveryRevision: request.deliveryRevision,
          taskId: request.taskId,
          phase: input.phase,
          root,
          verification: structuredClone(input.verification),
          signal: request.signal,
        });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    };
    emitWorkflowActivity(request.onActivity, { state: "verifying" });
    const redVerification = await verifyCorrectedContract({
      phase: "red",
      revisionId: correctedRedRevision.revisionId,
      verification: request.task.phases.red.verification,
    });
    if (!redVerification.ok) {
      return rejectCorrection({
        ...redVerification,
        ...(redVerification.kind === "retryable"
          ? { retryPolicy: "verification" as const }
          : {}),
      });
    }
    if (
      redVerification.classification !== "expected-red" ||
      redVerification.exitCode === 0
    ) {
      return rejectCorrection({
        kind: "retryable",
        code: "verification-rejected",
        retryPolicy: "verification",
      });
    }
    const greenVerification = await verifyCorrectedContract({
      phase: "green",
      revisionId: repaired.commit.isolatedRevisionId,
      verification: request.task.phases.green.verification,
    });
    if (!greenVerification.ok) {
      return rejectCorrection({
        ...greenVerification,
        ...(greenVerification.kind === "retryable"
          ? { retryPolicy: "verification" as const }
          : {}),
      });
    }
    if (
      greenVerification.classification !== "expected-green" ||
      greenVerification.exitCode !== 0
    ) {
      return rejectCorrection({
        kind: "retryable",
        code: "verification-rejected",
        retryPolicy: "verification",
      });
    }

    const repairEvent: VerifiedTaskEvent = {
      runId: request.runId,
      taskId: request.taskId,
      eventId: `red-artifact-correction-${hash(
        request.operationId,
        request.taskId,
        repaired.commit.artifactHash,
      ).slice(0, 40)}`,
      kind: "repair-verified",
      phase: request.phase,
      attempt: correctionAttemptUsed,
      commandId: request.task.repairVerification.id,
      exitCode: 0,
      diagnostic: repaired.commit.diagnostic,
      artifactHash: repaired.commit.artifactHash,
      isolatedRevisionId: repaired.commit.isolatedRevisionId,
      outputFacts: repaired.commit.outputFacts,
      attribution: "introduced",
      failureIdentities: [
        hash(
          "red-artifact-constraint",
          request.taskId,
          request.task.phases.red.verification.id,
        ),
      ],
      routeId: repaired.commit.routeId,
      routeFingerprint: repaired.commit.routeFingerprint,
    };
    const greenPaths = new Set([
      ...request.task.phases.green.write,
      ...request.task.phases.green.delete,
    ]);
    const greenEvent: VerifiedTaskEvent = {
      runId: request.runId,
      taskId: request.taskId,
      eventId: `green-corrected-${hash(
        request.operationId,
        request.taskId,
        repaired.commit.artifactHash,
      ).slice(0, 40)}`,
      kind: "phase-verified",
      phase: "green",
      commandId: request.task.phases.green.verification.id,
      exitCode: greenVerification.exitCode,
      expectedClassification: "expected-green",
      actualClassification: greenVerification.classification,
      diagnostic: greenVerification.diagnostic,
      artifactHash: repaired.commit.artifactHash,
      isolatedRevisionId: repaired.commit.isolatedRevisionId,
      outputFacts: repaired.commit.outputFacts.filter((fact) =>
        greenPaths.has(fact.path),
      ),
      routeId: repaired.commit.routeId,
      routeFingerprint: repaired.commit.routeFingerprint,
    };
    const events: VerifiedTaskEvent[] = [repairEvent, greenEvent];
    if (input.baseline) {
      const affected = await this.#verifyTaskAffected({
        resources,
        baseline: input.baseline,
        task: request.task,
        revisionId: repaired.commit.isolatedRevisionId,
        signal: request.signal,
      });
      if (affected.kind === "repairable") {
        return rejectCorrection({
          kind: "retryable",
          code: "red-artifact-constraint",
          retryPolicy: "artifact",
        });
      }
      if (affected.kind !== "verified") return rejectCorrection(affected);
    }
    if (request.task.phases.refactor) {
      ledger.commitVerifiedEvents(events);
      return {
        kind: "phase-committed",
        artifactHash: repaired.commit.artifactHash,
        isolatedRevisionId: repaired.commit.isolatedRevisionId,
        exitCode: greenVerification.exitCode,
        classification: greenVerification.classification,
        routeId: repaired.commit.routeId,
        routeFingerprint: repaired.commit.routeFingerprint,
      };
    }
    const completedRevision = this.#completeTracking(resources, request.taskId);
    ledger.commitTaskCompletion({
      events,
      factKey: `task-final-${hash(request.taskId).slice(0, 40)}`,
      fact: {
        taskId: request.taskId,
        phase: request.phase,
        isolatedRevisionId: completedRevision.revisionId,
        attribution: "introduced",
        repairAttempts: correctionAttemptUsed,
      },
    });
    return {
      kind: "phase-committed",
      artifactHash: repaired.commit.artifactHash,
      isolatedRevisionId: completedRevision.revisionId,
      exitCode: greenVerification.exitCode,
      classification: greenVerification.classification,
      routeId: repaired.commit.routeId,
      routeFingerprint: repaired.commit.routeFingerprint,
    };
  }

  async #runCumulativeRepair(input: {
    resources: DurableRunResources;
    ledger: TaskLedger;
    baseline: DurableVerificationBaseline;
    attempt: Parameters<WorkflowWorker["runAttempt"]>[0];
  }): Promise<WorkflowAttemptOutcome> {
    const { resources, ledger } = input;
    const request = input.attempt;
    const finalPhase = request.task.phases.refactor ? "refactor" : "green";
    const requestedFailures = request.repair?.failureIdentities;
    if (
      request.phase !== finalPhase ||
      request.repair?.attribution !== "introduced" ||
      !Array.isArray(requestedFailures) ||
      requestedFailures.length === 0 ||
      requestedFailures.length > 256 ||
      requestedFailures.some(
        (identity) => typeof identity !== "string" || !SHA256.test(identity),
      )
    ) {
      throw new Error("workflow-repair-context-invalid");
    }
    this.#verifiedPhaseReplay(ledger, request);
    const projection = ledger.projection({
      runId: request.runId,
      taskId: request.taskId,
      nextPhase: request.phase,
    }) as { history: Array<Record<string, unknown>> };
    const priorRepairs = projection.history.filter(
      (event) =>
        event.kind === "repair-verified" && event.phase === request.phase,
    );
    let stableRevisionId = resources.currentRevisionId;
    let affected: DurableAffectedResult = {
      kind: "repairable",
      attribution: "introduced",
      failureIdentities: [...new Set(requestedFailures)].sort(),
    };
    const replayedRepair = priorRepairs.at(-1);
    if (replayedRepair) {
      if (
        typeof replayedRepair.artifactHash !== "string" ||
        !SHA256.test(replayedRepair.artifactHash) ||
        typeof replayedRepair.isolatedRevisionId !== "string" ||
        !SHA256.test(replayedRepair.isolatedRevisionId)
      ) {
        throw new Error("workflow-ledger-phase-invalid");
      }
      if (
        this.#revisionDescendsFrom(
          resources,
          replayedRepair.isolatedRevisionId,
          stableRevisionId,
        )
      ) {
        resources.currentRevisionId = replayedRepair.isolatedRevisionId;
        stableRevisionId = replayedRepair.isolatedRevisionId;
        const replayedAffected = await this.#verifyTaskAffected({
          resources,
          baseline: input.baseline,
          task: request.task,
          revisionId: stableRevisionId,
          signal: request.signal,
        });
        if (replayedAffected.kind === "verified") {
          return {
            kind: "phase-committed",
            artifactHash: replayedRepair.artifactHash,
            isolatedRevisionId: stableRevisionId,
            exitCode: 0,
            classification: expectedClassification(request.phase),
          };
        }
        if (replayedAffected.kind !== "repairable") return replayedAffected;
        affected = replayedAffected;
      }
    }

    const repairEvents: VerifiedTaskEvent[] = [];
    let lastCommit: DurableCandidateCommit | undefined;
    let repairAttempt = 0;
    let uncommittedRevisionId: string | undefined;
    const rollbackPaths = [
      ...new Set(
        Object.values(request.task.phases).flatMap((phase) => [
          ...phase.write,
          ...phase.delete,
        ]),
      ),
    ];
    const discardUncommitted = async <T extends WorkflowAttemptOutcome>(
      outcome: T,
    ): Promise<T> => {
      if (uncommittedRevisionId) {
        await this.#rollbackWorkspacePaths({
          resources,
          baseRevisionId: stableRevisionId,
          rejectedRevisionId: uncommittedRevisionId,
          paths: rollbackPaths,
        });
      }
      return outcome;
    };
    while (affected.kind === "repairable") {
      if (repairAttempt >= request.plan.verification.repair.maxAttempts) {
        return discardUncommitted({
          kind: "paused",
          code: "repair-attempts-exhausted",
        });
      }
      repairAttempt += 1;
      const failureIdentities = [...affected.failureIdentities];
      const repair = await this.#runRepairCandidate({
        resources,
        ledger,
        attempt: request,
        repairAttempt,
        failureIdentities,
      });
      if (repair.kind !== "repair-committed") {
        return discardUncommitted(repair);
      }
      lastCommit = repair.commit;
      uncommittedRevisionId = repair.commit.isolatedRevisionId;
      repairEvents.push({
        runId: request.runId,
        taskId: request.taskId,
        eventId: `cumulative-repair-${hash(
          stableRevisionId,
          request.taskId,
          String(repairAttempt),
        ).slice(0, 40)}`,
        kind: "repair-verified",
        phase: request.phase,
        attempt: repairAttempt,
        commandId: request.task.repairVerification.id,
        exitCode: 0,
        diagnostic: repair.commit.diagnostic,
        artifactHash: repair.commit.artifactHash,
        isolatedRevisionId: repair.commit.isolatedRevisionId,
        outputFacts: repair.commit.outputFacts,
        attribution: "introduced",
        failureIdentities,
        routeId: repair.commit.routeId,
        routeFingerprint: repair.commit.routeFingerprint,
      });
      affected = await this.#verifyTaskAffected({
        resources,
        baseline: input.baseline,
        task: request.task,
        revisionId: repair.commit.isolatedRevisionId,
        signal: request.signal,
      });
    }
    if (affected.kind !== "verified") return discardUncommitted(affected);
    if (!lastCommit || repairEvents.length === 0) {
      throw new Error("workflow-repair-commit-unavailable");
    }
    ledger.commitVerifiedEvents(repairEvents);
    return {
      kind: "phase-committed",
      artifactHash: lastCommit.artifactHash,
      isolatedRevisionId: lastCommit.isolatedRevisionId,
      exitCode: 0,
      classification: expectedClassification(request.phase),
      routeId: lastCommit.routeId,
      routeFingerprint: lastCommit.routeFingerprint,
    };
  }

  async runAttempt(
    input: Parameters<WorkflowWorker["runAttempt"]>[0],
  ): Promise<WorkflowAttemptOutcome> {
    if (input.signal.aborted) {
      return { kind: "operation-cancelled", code: "cancelled" };
    }
    const resources = this.#resources({
      runId: input.runId,
      deliveryRevision: input.deliveryRevision,
      plan: input.plan,
      ...(input.baselineRevisionId
        ? { baselineRevisionId: input.baselineRevisionId }
        : {}),
      ...(input.currentWorkspaceRevisionId
        ? { currentWorkspaceRevisionId: input.currentWorkspaceRevisionId }
        : {}),
    });
    let selectedRoute: Required<WorkflowRouteFacts> | undefined;
    const retained = <T extends WorkflowAttemptOutcome>(outcome: T): T =>
      ({
        ...(selectedRoute ?? {}),
        ...outcome,
        baselineRevisionId: resources.baselineRevisionId,
        currentWorkspaceRevisionId: resources.currentRevisionId,
      }) as T;
    const ledger = this.#ledger(resources, input.deliveryRevision);
    let verificationBaseline: DurableVerificationBaseline | undefined;
    if (hasVerificationLifecycle(input.plan)) {
      emitWorkflowActivity(input.onActivity, { state: "verifying" });
      const captured = await this.#ensureVerificationBaseline({
        resources,
        ledger,
        signal: input.signal,
      });
      if (!captured.ok) {
        const outcome = captured.outcome;
        return retained(
          outcome.kind === "paused"
            ? {
                ...outcome,
                verification: {
                  scope: "baseline",
                  attribution: "environment",
                },
              }
            : outcome,
        );
      }
      verificationBaseline = captured.baseline;
    }
    this.#openTask(resources, ledger, input);
    if (input.artifactCorrection?.code === "red-artifact-constraint") {
      return retained(
        await this.#runRedArtifactCorrection({
          resources,
          ledger,
          ...(verificationBaseline ? { baseline: verificationBaseline } : {}),
          attempt: input,
        }),
      );
    }
    if (input.repair) {
      if (!verificationBaseline) {
        throw new Error("workflow-verification-baseline-unavailable");
      }
      return retained(
        await this.#runCumulativeRepair({
          resources,
          ledger,
          baseline: verificationBaseline,
          attempt: input,
        }),
      );
    }
    const replay = this.#replayedPhase(resources, ledger, input);
    if (replay) return retained(replay);
    const phase = input.task.phases[input.phase];
    if (!phase) throw new Error("workflow-task-phase-invalid");
    const approvedPaths = [
      ...new Set([...phase.write, ...phase.delete]),
    ].sort();
    const rollbackPaths = [
      ...new Set(
        Object.values(input.task.phases).flatMap((boundary) => [
          ...boundary.write,
          ...boundary.delete,
        ]),
      ),
    ].sort();
    if (approvedPaths.length === 0) {
      return retained({
        kind: "approval-needed",
        code: "task-write-set-empty",
      });
    }
    const baseRevisionId = resources.currentRevisionId;
    const proposalRoot = mkdtempSync(path.join(resources.root, "attempt-"));
    try {
      resources.workspaces.materialize(baseRevisionId, proposalRoot);
      if (input.routeId) {
        const rebound = this.#broker.resumeBinding({
          runId: input.runId,
          role: "implementation-worker",
          routeId: input.routeId,
          ...(input.routeFingerprint
            ? { expectedFingerprint: input.routeFingerprint }
            : {}),
          requirements: IMPLEMENTATION_ROUTE_REQUIREMENTS,
        });
        if (!rebound.ok) {
          return retained({ kind: "paused", code: rebound.code });
        }
      }
      const ledgerProjection = ledger.projection({
        runId: input.runId,
        taskId: input.taskId,
        nextPhase: input.phase,
      });
      let identity: BeginCandidateInput | undefined;
      const routed = await this.#broker.run({
        runId: input.runId,
        operationId: `${input.operationId}:${input.taskId}:${input.phase}`,
        role: "implementation-worker",
        requirements: IMPLEMENTATION_ROUTE_REQUIREMENTS,
        signal: input.signal,
        ...(input.onActivity ? { onActivity: input.onActivity } : {}),
        execute: (attempt) => {
          identity = {
            candidateId: `candidate-${randomUUID()}`,
            runId: input.runId,
            deliveryRevision: input.deliveryRevision,
            taskId: input.taskId,
            phase: input.phase,
            attemptId: `attempt-${hash(
              input.operationId,
              input.taskId,
              input.phase,
              attempt.route.fingerprint,
            ).slice(0, 40)}`,
            approvedPaths,
            isolatedRevisionId: baseRevisionId,
            verificationId: phase.verification.id,
            routeId: attempt.route.id,
            routeFingerprint: attempt.route.fingerprint,
          };
          return this.#options.proposeCandidate({
            runId: input.runId,
            operationId: input.operationId,
            deliveryRevision: input.deliveryRevision,
            taskId: input.taskId,
            phase: input.phase,
            task: structuredClone(input.task),
            workspaceRoot: proposalRoot,
            ledgerProjection,
            candidateArtifact: {
              ledger,
              identity,
              workspaceRoot: proposalRoot,
              writePaths: phase.write,
              deletePaths: phase.delete,
            },
            route: attempt.route,
            signal: attempt.signal,
            onHeaders: attempt.onHeaders,
            onProgress: attempt.onProgress,
          });
        },
      });
      if (!routed.ok) {
        return retained(
          routed.state === "cancelled" || input.signal.aborted
            ? { kind: "operation-cancelled", code: "cancelled" }
            : { kind: "paused", code: routed.code },
        );
      }
      if (!identity || identity.routeId !== routed.routeId) {
        throw new Error("candidate-route-identity-invalid");
      }
      const correctionIdentity = identity;
      selectedRoute = {
        routeId: identity.routeId,
        routeFingerprint: identity.routeFingerprint,
      };
      let uncommittedRevisionId: string | undefined;
      const reject = async <T extends WorkflowAttemptOutcome>(
        outcome: T,
        correction: {
          category: "artifact" | "stale" | "verification" | "checkpoint";
          code: string;
          stage: string;
        },
        rollback = false,
      ): Promise<T> => {
        if (rollback && uncommittedRevisionId) {
          await this.#rollbackWorkspacePaths({
            resources,
            baseRevisionId,
            rejectedRevisionId: uncommittedRevisionId,
            paths: rollbackPaths,
          });
        }
        this.#recordCorrection(ledger, input, correctionIdentity, correction);
        return retained({ ...outcome, retryPolicy: correction.category });
      };
      const proposal = routed.value;
      if (
        proposal.kind !== "candidate" &&
        proposal.kind !== "sealed-candidate"
      ) {
        return proposal.kind === "operation-cancelled" ||
          proposal.kind === "paused" ||
          proposal.kind === "approval-needed"
          ? retained(proposal)
          : reject(proposal, {
              category: "artifact",
              code: proposal.code,
              stage: "candidate-submit",
            });
      }
      emitWorkflowActivity(input.onActivity, { state: "validating" });
      ledger.beginCandidate(identity);
      let bytes: Buffer;
      if (proposal.kind === "sealed-candidate") {
        if (
          proposal.candidateId !== identity.candidateId ||
          !SHA256.test(proposal.artifactHash) ||
          !Number.isSafeInteger(proposal.bytes) ||
          proposal.bytes < 1 ||
          !Array.isArray(proposal.paths)
        ) {
          return reject(
            { kind: "retryable", code: "candidate-diff-invalid" },
            {
              category: "artifact",
              code: "candidate-diff-invalid",
              stage: "candidate-seal",
            },
          );
        }
        bytes = Buffer.from(ledger.readSealedCandidate(identity.candidateId));
        if (
          bytes.length !== proposal.bytes ||
          sha256Bytes(bytes) !== proposal.artifactHash
        ) {
          throw new Error("candidate-seal-integrity-invalid");
        }
      } else {
        if (
          !(proposal.bytes instanceof Uint8Array) ||
          proposal.bytes.length === 0
        ) {
          return reject(
            { kind: "retryable", code: "candidate-diff-invalid" },
            {
              category: "artifact",
              code: "candidate-diff-invalid",
              stage: "candidate-submit",
            },
          );
        }
        bytes = Buffer.from(proposal.bytes);
      }
      let candidatePaths: string[];
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        candidatePaths = diffWritePaths(text).paths;
      } catch {
        return reject(
          { kind: "retryable", code: "candidate-diff-invalid" },
          {
            category: "artifact",
            code: "candidate-diff-invalid",
            stage: "candidate-diff",
          },
        );
      }
      if (
        candidatePaths.some((relative) => !approvedPaths.includes(relative))
      ) {
        return reject(
          { kind: "retryable", code: "write-set-mismatch" },
          {
            category: "artifact",
            code: "write-set-mismatch",
            stage: "candidate-boundary",
          },
        );
      }
      if (proposal.kind === "sealed-candidate") {
        if (
          JSON.stringify([...proposal.paths].sort()) !==
          JSON.stringify([...candidatePaths].sort())
        ) {
          return reject(
            { kind: "retryable", code: "candidate-diff-invalid" },
            {
              category: "artifact",
              code: "candidate-diff-invalid",
              stage: "candidate-seal",
            },
          );
        }
      }
      const dependencySensitive = candidatePaths.some(
        (relative) => relative === "package.json" || LOCKFILES.has(relative),
      );
      let dependenciesBefore: Map<string, DependencyContractEntry> | undefined;
      if (dependencySensitive) {
        try {
          dependenciesBefore = dependencyContract(proposalRoot);
        } catch (error) {
          if (!(error instanceof DependencyManifestError)) throw error;
          return reject(
            { kind: "retryable", code: error.message },
            {
              category: "artifact",
              code: error.message,
              stage: "candidate-dependency",
            },
          );
        }
      }
      const checked = await runGitApply(
        proposalRoot,
        bytes,
        true,
        input.signal,
      );
      if (checked !== "ok") {
        return checked === "cancelled"
          ? retained({ kind: "operation-cancelled", code: "cancelled" })
          : reject(
              { kind: "retryable", code: "candidate-diff-invalid" },
              {
                category: "artifact",
                code: "candidate-diff-invalid",
                stage: "candidate-check",
              },
            );
      }
      const applied = await runGitApply(
        proposalRoot,
        bytes,
        false,
        input.signal,
      );
      if (applied !== "ok") {
        return applied === "cancelled"
          ? retained({ kind: "operation-cancelled", code: "cancelled" })
          : reject(
              { kind: "retryable", code: "candidate-diff-invalid" },
              {
                category: "artifact",
                code: "candidate-diff-invalid",
                stage: "candidate-apply",
              },
            );
      }
      if (dependenciesBefore) {
        let dependenciesAfter: Map<string, DependencyContractEntry>;
        try {
          dependenciesAfter = dependencyContract(proposalRoot);
        } catch (error) {
          if (!(error instanceof DependencyManifestError)) throw error;
          return reject(
            { kind: "retryable", code: error.message },
            {
              category: "artifact",
              code: error.message,
              stage: "candidate-dependency",
            },
          );
        }
        if (
          hasUnapprovedDependencyChange(
            dependenciesBefore,
            dependenciesAfter,
            input.task.approvedDependencies,
            candidatePaths.some((relative) => LOCKFILES.has(relative)),
          )
        ) {
          return reject(
            { kind: "approval-needed", code: "unapproved-dependency-change" },
            {
              category: "artifact",
              code: "unapproved-dependency-change",
              stage: "candidate-dependency",
            },
          );
        }
      }
      let artifactHash: string;
      if (proposal.kind === "sealed-candidate") {
        artifactHash = proposal.artifactHash;
      } else {
        let sequence = 0;
        for (
          let offset = 0;
          offset < bytes.length;
          offset += TASK_LEDGER_LIMITS.maxSegmentBytes
        ) {
          const segment = bytes.subarray(
            offset,
            Math.min(offset + TASK_LEDGER_LIMITS.maxSegmentBytes, bytes.length),
          );
          const accepted = ledger.appendCandidateSegment({
            ...identity,
            sequence,
            bytes: segment,
            segmentHash: sha256Bytes(segment),
          });
          if (!accepted.ok) {
            return reject(
              { kind: "paused", code: accepted.code },
              {
                category: "artifact",
                code: accepted.code,
                stage: "candidate-segment",
              },
            );
          }
          sequence += 1;
        }
        const sealed = ledger.sealCandidate({
          ...identity,
          segmentCount: sequence,
          totalBytes: bytes.length,
          candidateHash: sha256Bytes(bytes),
        });
        if (!sealed.ok) {
          return reject(
            { kind: "retryable", code: sealed.code },
            {
              category: "artifact",
              code: sealed.code,
              stage: "candidate-seal",
            },
          );
        }
        artifactHash = sealed.artifactHash;
      }
      const candidate = resources.workspaces.createRevision({
        parentRevisionId: baseRevisionId,
        changes: revisionChanges(proposalRoot, approvedPaths),
      });
      if (
        candidatePaths.some((relative) => {
          const entry = candidate.entries[relative];
          return phase.delete.includes(relative)
            ? entry?.kind !== "absent"
            : entry?.kind !== "file";
        })
      ) {
        return reject(
          { kind: "retryable", code: "write-set-mismatch" },
          {
            category: "artifact",
            code: "write-set-mismatch",
            stage: "candidate-output",
          },
        );
      }
      const requiredOutputs = input.plan.outputs.filter(
        (output) =>
          output.producer.taskId === input.taskId &&
          output.producer.phase === input.phase,
      );
      if (
        requiredOutputs.some(
          (output) => candidate.entries[output.path]?.kind !== "file",
        )
      ) {
        return reject(
          { kind: "retryable", code: "producer-output-unavailable" },
          {
            category: "artifact",
            code: "producer-output-unavailable",
            stage: "candidate-output",
          },
        );
      }
      emitWorkflowActivity(input.onActivity, { state: "verifying" });
      const verified = await this.#options.verifyPhase({
        runId: input.runId,
        deliveryRevision: input.deliveryRevision,
        taskId: input.taskId,
        phase: input.phase,
        root: proposalRoot,
        verification: structuredClone(phase.verification),
        signal: input.signal,
      });
      if (!verified.ok) {
        return reject(verified, {
          category: "verification",
          code: verified.code,
          stage: "phase-verification",
        });
      }
      const expected = expectedClassification(input.phase);
      if (
        verified.classification !== expected ||
        (input.phase === "red"
          ? verified.exitCode === 0
          : verified.exitCode !== 0)
      ) {
        return reject(
          { kind: "retryable", code: "verification-rejected" },
          {
            category: "verification",
            code: "verification-rejected",
            stage: "phase-verification",
          },
        );
      }
      let merged: ReturnType<WorkspaceStore["mergeRevision"]>;
      try {
        merged = await this.#mergeCandidate(
          resources,
          input,
          baseRevisionId,
          candidate.revisionId,
        );
        uncommittedRevisionId = merged.revisionId;
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "workspace-revision-stale"
        ) {
          return reject(
            { kind: "retryable", code: "workspace-revision-stale" },
            {
              category: "stale",
              code: "workspace-revision-stale",
              stage: "candidate-merge",
            },
          );
        }
        throw error;
      }
      const outputFacts = approvedPaths.map((relative) => {
        const entry = merged.entries[relative];
        return entry?.kind === "file"
          ? {
              path: relative,
              kind: "file" as const,
              hash: entry.hash,
              bytes: entry.bytes,
            }
          : { path: relative, kind: "absent" as const };
      });
      if (
        requiredOutputs.some(
          (output) => merged.entries[output.path]?.kind !== "file",
        )
      ) {
        return reject(
          { kind: "retryable", code: "producer-output-unavailable" },
          {
            category: "artifact",
            code: "producer-output-unavailable",
            stage: "candidate-output",
          },
          true,
        );
      }
      const phaseEvent: VerifiedTaskEvent = {
        runId: input.runId,
        taskId: input.taskId,
        eventId: `${input.phase}-verified-r${input.deliveryRevision}`,
        kind: "phase-verified",
        phase: input.phase,
        commandId: phase.verification.id,
        exitCode: verified.exitCode,
        expectedClassification: expected,
        actualClassification: verified.classification,
        diagnostic: verified.diagnostic,
        artifactHash,
        isolatedRevisionId: merged.revisionId,
        outputFacts,
        routeId: identity.routeId,
        routeFingerprint: identity.routeFingerprint,
      };
      const finalPhase = input.task.phases.refactor ? "refactor" : "green";
      if (!verificationBaseline || input.phase !== finalPhase) {
        ledger.commitVerifiedEvent(phaseEvent);
        return retained({
          kind: "phase-committed",
          artifactHash,
          isolatedRevisionId: merged.revisionId,
          exitCode: verified.exitCode,
          classification: verified.classification,
          baselineRevisionId: resources.baselineRevisionId,
        });
      }

      const completionEvents: VerifiedTaskEvent[] = [phaseEvent];
      const discardUncommitted = async <T extends WorkflowAttemptOutcome>(
        outcome: T,
      ): Promise<T> => {
        if (uncommittedRevisionId) {
          await this.#rollbackWorkspacePaths({
            resources,
            baseRevisionId,
            rejectedRevisionId: uncommittedRevisionId,
            paths: rollbackPaths,
          });
        }
        return retained(outcome);
      };
      let affected = await this.#verifyTaskAffected({
        resources,
        baseline: verificationBaseline,
        task: input.task,
        revisionId: merged.revisionId,
        signal: input.signal,
      });
      let repairAttempts = 0;
      let completionAttribution: "none" | "pre-existing" | "introduced" =
        "none";
      while (affected.kind === "repairable") {
        completionAttribution = "introduced";
        if (repairAttempts >= input.plan.verification.repair.maxAttempts) {
          return reject(
            { kind: "paused", code: "repair-attempts-exhausted" },
            {
              category: "verification",
              code: "repair-attempts-exhausted",
              stage: "task-affected-verification",
            },
            true,
          );
        }
        repairAttempts += 1;
        const failureIdentities = [...affected.failureIdentities];
        const repair = await this.#runRepairCandidate({
          resources,
          ledger,
          attempt: input,
          repairAttempt: repairAttempts,
          failureIdentities,
        });
        if (repair.kind !== "repair-committed") {
          return discardUncommitted(repair);
        }
        selectedRoute = {
          routeId: repair.commit.routeId,
          routeFingerprint: repair.commit.routeFingerprint,
        };
        uncommittedRevisionId = repair.commit.isolatedRevisionId;
        completionEvents.push({
          runId: input.runId,
          taskId: input.taskId,
          eventId: `repair-${repairAttempts}-verified-r${input.deliveryRevision}`,
          kind: "repair-verified",
          phase: input.phase,
          attempt: repairAttempts,
          commandId: input.task.repairVerification.id,
          exitCode: 0,
          diagnostic: repair.commit.diagnostic,
          artifactHash: repair.commit.artifactHash,
          isolatedRevisionId: repair.commit.isolatedRevisionId,
          outputFacts: repair.commit.outputFacts,
          attribution: "introduced",
          failureIdentities,
          routeId: repair.commit.routeId,
          routeFingerprint: repair.commit.routeFingerprint,
        });
        affected = await this.#verifyTaskAffected({
          resources,
          baseline: verificationBaseline,
          task: input.task,
          revisionId: repair.commit.isolatedRevisionId,
          signal: input.signal,
        });
      }
      if (affected.kind !== "verified") {
        return affected.kind === "operation-cancelled"
          ? discardUncommitted(affected)
          : reject(
              affected,
              {
                category: "verification",
                code: affected.code,
                stage: "task-affected-verification",
              },
              true,
            );
      }
      if (completionAttribution === "none") {
        completionAttribution = affected.attribution;
      }
      let completedRevision: WorkspaceRevision;
      try {
        completedRevision = this.#completeTracking(resources, input.taskId);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "workflow-tracking-task-mismatch"
        ) {
          return reject(
            { kind: "paused", code: "tracking-contract-invalid" },
            {
              category: "checkpoint",
              code: "tracking-contract-invalid",
              stage: "tracking-checkpoint",
            },
            true,
          );
        }
        throw error;
      }
      const factKey = `task-final-${hash(input.taskId).slice(0, 40)}`;
      ledger.commitTaskCompletion({
        events: completionEvents,
        factKey,
        fact: {
          taskId: input.taskId,
          phase: input.phase,
          isolatedRevisionId: completedRevision.revisionId,
          attribution: completionAttribution,
          repairAttempts,
        },
      });
      return retained({
        kind: "phase-committed",
        artifactHash,
        isolatedRevisionId: completedRevision.revisionId,
        exitCode: verified.exitCode,
        classification: verified.classification,
        baselineRevisionId: resources.baselineRevisionId,
      });
    } finally {
      rmSync(proposalRoot, { recursive: true, force: true });
    }
  }

  rebind(input: Parameters<WorkflowWorker["rebind"]>[0]) {
    const rebound = this.#broker.rebind({
      runId: input.runId,
      role: input.role,
      routeId: input.routeId,
      requirements: IMPLEMENTATION_ROUTE_REQUIREMENTS,
    });
    return rebound.ok
      ? {
          ok: true as const,
          routeId: rebound.route.id,
          routeFingerprint: rebound.route.fingerprint,
        }
      : { ok: false as const, code: rebound.code };
  }

  async verify(
    input: Parameters<WorkflowChangeVerifier["verify"]>[0],
  ): Promise<Awaited<ReturnType<WorkflowChangeVerifier["verify"]>>> {
    if (!input.currentWorkspaceRevisionId) {
      return { kind: "paused", code: "workspace-revision-unavailable" };
    }
    const resources = this.#resources({
      runId: input.runId,
      deliveryRevision: input.deliveryRevision,
      plan: input.plan,
      currentWorkspaceRevisionId: input.currentWorkspaceRevisionId,
      baselineRevisionId:
        input.baselineRevisionId ??
        this.#runs.get(input.runId)?.baselineRevisionId,
    });
    const cumulativeRevision = resources.workspaces.getRevision(
      resources.currentRevisionId,
    );
    if (
      input.plan.outputs.some(
        (output) => cumulativeRevision.entries[output.path]?.kind !== "file",
      )
    ) {
      return { kind: "paused", code: "producer-output-unavailable" };
    }
    if (hasVerificationLifecycle(input.plan)) {
      const ledger = this.#ledger(resources, input.deliveryRevision);
      const captured = await this.#ensureVerificationBaseline({
        resources,
        ledger,
        signal: input.signal,
      });
      if (!captured.ok) {
        return captured.outcome.kind === "approval-needed"
          ? captured.outcome
          : captured.outcome.kind === "operation-cancelled"
            ? { kind: "paused", code: "cancelled" }
            : {
                ...captured.outcome,
                verification: {
                  scope: "baseline",
                  attribution: "environment",
                },
              };
      }
      for (const task of input.plan.tasks) {
        const baseline = captured.baseline.affected.find(
          (entry) => entry.taskId === task.taskId,
        );
        if (!baseline) throw new Error("workflow-task-baseline-unavailable");
        const current = await this.#observeVerification({
          resources,
          revisionId: resources.currentRevisionId,
          scope: "change-task-affected",
          verification: task.affectedVerification,
          taskId: task.taskId,
          signal: input.signal,
        });
        if (!current.ok) {
          return current.outcome.kind === "approval-needed"
            ? current.outcome
            : current.outcome.kind === "operation-cancelled"
              ? { kind: "paused", code: "cancelled" }
              : {
                  ...current.outcome,
                  verification: {
                    scope: "change-task-affected",
                    attribution: "environment",
                    taskId: task.taskId,
                  },
                };
        }
        if (current.observation.status === "failed") {
          const prior = new Set(baseline.observation.failureIdentities);
          const introduced = current.observation.failureIdentities.filter(
            (identity) => !prior.has(identity),
          );
          if (introduced.length > 0) {
            return {
              kind: "paused",
              code: "verification-repair-required",
              verification: {
                scope: "change-task-affected",
                attribution: "introduced",
                taskId: task.taskId,
                failureIdentities: introduced,
              },
            };
          }
        }
      }
      const fullSuite = await this.#observeVerification({
        resources,
        revisionId: resources.currentRevisionId,
        scope: "change-full-suite",
        verification: input.plan.verification.change.fullSuite,
        signal: input.signal,
      });
      if (!fullSuite.ok) {
        return fullSuite.outcome.kind === "approval-needed"
          ? fullSuite.outcome
          : fullSuite.outcome.kind === "operation-cancelled"
            ? { kind: "paused", code: "cancelled" }
            : {
                ...fullSuite.outcome,
                verification: {
                  scope: "change-full-suite",
                  attribution: "environment",
                },
              };
      }
      if (fullSuite.observation.status === "failed") {
        const baselineFailures = new Set(
          captured.baseline.fullSuite.failureIdentities,
        );
        const introduced = fullSuite.observation.failureIdentities.filter(
          (identity) => !baselineFailures.has(identity),
        );
        if (introduced.length > 0) {
          return {
            kind: "paused",
            code: "verification-attribution-unresolved",
            verification: {
              scope: "change-full-suite",
              attribution: "unresolved",
              failureIdentities: introduced,
            },
          };
        }
      }
      const checkpoint = input.plan.verification.agentsCheckpoint;
      if (checkpoint.required && checkpoint.verification) {
        const applied = this.#applyAgentsCheckpoint(resources);
        if (!applied.ok) {
          return { kind: "paused", code: applied.code };
        }
        const observed = await this.#observeVerification({
          resources,
          revisionId: applied.revision.revisionId,
          scope: "agents-checkpoint",
          verification: checkpoint.verification,
          signal: input.signal,
        });
        if (!observed.ok) {
          return observed.outcome.kind === "approval-needed"
            ? observed.outcome
            : observed.outcome.kind === "operation-cancelled"
              ? { kind: "paused", code: "cancelled" }
              : {
                  ...observed.outcome,
                  verification: {
                    scope: "agents-checkpoint",
                    attribution: "environment",
                  },
                };
        }
        if (observed.observation.status === "failed") {
          return {
            kind: "paused",
            code: "agents-checkpoint-verification-failed",
            verification: {
              scope: "agents-checkpoint",
              attribution: "introduced",
              failureIdentities: observed.observation.failureIdentities,
            },
          };
        }
        resources.currentRevisionId = applied.revision.revisionId;
      }
      const verificationId = `change-${hash(
        input.plan.changeId,
        String(input.deliveryRevision),
        resources.currentRevisionId,
      ).slice(0, 40)}`;
      const sealed = await verifyCumulativeRevision({
        workspaceStore: resources.workspaces,
        revisionId: resources.currentRevisionId,
        verificationId,
        signal: input.signal,
        execute: async () => ({
          ok: true as const,
          exitCode: 0 as const,
          classification: "lifecycle-verified",
        }),
      });
      if (!sealed.ok) return { kind: "paused", code: sealed.code };
      resources.verificationFact = sealed.fact;
      return {
        kind: "verified",
        verificationId: sealed.verificationId,
        currentWorkspaceRevisionId: resources.currentRevisionId,
      };
    }
    const verificationId = `change-${hash(
      input.plan.changeId,
      String(input.deliveryRevision),
    ).slice(0, 40)}`;
    const result = await verifyCumulativeRevision({
      workspaceStore: resources.workspaces,
      revisionId: resources.currentRevisionId,
      verificationId,
      signal: input.signal,
      execute: ({ root, signal }) =>
        this.#options.verifyChange({
          runId: input.runId,
          deliveryRevision: input.deliveryRevision,
          root,
          plan: structuredClone(input.plan),
          signal: signal ?? input.signal,
        }),
    });
    if (!result.ok) {
      return {
        kind:
          result.kind === "approval-boundary"
            ? "approval-needed"
            : result.kind === "verification"
              ? "retryable"
              : "paused",
        code: result.code,
      };
    }
    resources.verificationFact = result.fact;
    return { kind: "verified", verificationId: result.verificationId };
  }

  async prepare(
    input: Parameters<WorkflowApplication["begin"]>[0],
  ): Promise<Record<string, unknown>> {
    if (!input.baselineRevisionId || !input.currentWorkspaceRevisionId) {
      return { state: "paused", code: "workspace-revision-unavailable" };
    }
    const resources = this.#resources({
      runId: input.runId,
      deliveryRevision: input.deliveryRevision,
      plan: input.plan,
      baselineRevisionId: input.baselineRevisionId,
      currentWorkspaceRevisionId: input.currentWorkspaceRevisionId,
    });
    if (!resources.verificationFact) {
      return { state: "paused", code: "verification-fact-unavailable" };
    }
    const prepared = await resources.transactions.prepare({
      transactionId: input.transactionId,
      consumerRoot: input.consumerRoot,
      baselineRevisionId: resources.baselineRevisionId,
      finalRevisionId: resources.currentRevisionId,
      boundPaths: deliveryBoundPaths(input.plan),
      verificationFact: resources.verificationFact,
    });
    return prepared;
  }

  async applyPrepared(
    input: Parameters<WorkflowApplication["begin"]>[0],
  ): Promise<Record<string, unknown>> {
    const resources = this.#resources({
      runId: input.runId,
      deliveryRevision: input.deliveryRevision,
      plan: input.plan,
      ...(input.baselineRevisionId
        ? { baselineRevisionId: input.baselineRevisionId }
        : {}),
      ...(input.currentWorkspaceRevisionId
        ? { currentWorkspaceRevisionId: input.currentWorkspaceRevisionId }
        : {}),
    });
    return resources.transactions.apply(input.transactionId, input.signal);
  }

  async begin(
    input: Parameters<WorkflowApplication["begin"]>[0],
  ): Promise<Record<string, unknown>> {
    const prepared = await this.prepare(input);
    return prepared.state === "prepared" ? this.applyPrepared(input) : prepared;
  }

  #resourcesForApplication(
    context: WorkflowApplicationContext | undefined,
  ): DurableRunResources {
    if (!context) throw new Error("workflow-application-context-unavailable");
    return this.#resources({
      runId: context.runId,
      deliveryRevision: context.deliveryRevision,
      plan: context.plan,
      ...(context.baselineRevisionId
        ? { baselineRevisionId: context.baselineRevisionId }
        : {}),
      ...(context.currentWorkspaceRevisionId
        ? { currentWorkspaceRevisionId: context.currentWorkspaceRevisionId }
        : {}),
    });
  }

  requestControl(
    transactionId: string,
    intent: "cancel" | "discard",
    context?: WorkflowApplicationContext,
  ): Record<string, unknown> {
    return this.#resourcesForApplication(context).transactions.requestControl(
      transactionId,
      intent,
    );
  }

  recover(
    transactionId: string,
    context?: WorkflowApplicationContext,
  ): Promise<Record<string, unknown>> {
    return this.#resourcesForApplication(context).transactions.recover(
      transactionId,
    );
  }

  cleanup(runId: string): void {
    const resources = this.#runs.get(runId);
    if (resources) {
      this.#closeResources(resources);
      this.#runs.delete(runId);
    }
    rmSync(this.#runRoot(runId), { recursive: true, force: true });
  }

  close(): void {
    for (const resources of this.#runs.values()) {
      this.#closeResources(resources);
    }
    this.#runs.clear();
    this.#routeHealth.close();
  }
}

export class WorkflowEngine {
  readonly #consumerRoot: string;
  readonly #stateRoot: ResolvedStateRoot;
  readonly #runStore: RunStore;
  readonly #database: DatabaseSync;
  readonly #deliverySource: WorkflowDeliverySource;
  readonly #worker: WorkflowWorker;
  readonly #changeVerifier: WorkflowChangeVerifier;
  readonly #application?: WorkflowApplication;
  readonly #lifecycle?: WorkflowRunLifecycle;
  readonly #now: () => number;
  readonly #leaseTtlMs: number;
  readonly #active = new Map<string, ActiveOperation>();
  readonly #operationLeases = new Map<string, HeldOperationLease>();
  #orphanRecoveryTimer?: ReturnType<typeof setTimeout>;
  #closed = false;

  private constructor(options: WorkflowEngineOptions) {
    this.#consumerRoot = path.resolve(options.consumerRoot);
    this.#stateRoot = options.stateRoot;
    this.#deliverySource = options.deliverySource;
    this.#worker = options.worker;
    this.#changeVerifier = options.changeVerifier;
    this.#application = options.application;
    this.#lifecycle = options.lifecycle;
    this.#now = options.now ?? Date.now;
    this.#leaseTtlMs = options.leaseTtlMs ?? 60_000;
    this.#runStore = RunStore.open(options.stateRoot, { now: this.#now });
    this.#database = new DatabaseSync(options.stateRoot.databasePath);
    this.#database.exec("PRAGMA foreign_keys = ON");
    this.#database.exec("PRAGMA journal_mode = WAL");
    this.#database.exec("PRAGMA synchronous = FULL");
    this.#database.exec("PRAGMA busy_timeout = 5000");
    this.#database.exec(ENGINE_SCHEMA);
    ensureEngineColumns(this.#database);
    this.#recoverInterruptedOperations();
    this.#recoverTerminalCleanup();
  }

  static open(options: WorkflowEngineOptions): WorkflowEngine {
    if (
      path.resolve(options.consumerRoot) !== options.stateRoot.consumerRoot ||
      options.stateRoot.consumerRootHash.length !== 64
    ) {
      throw new Error("workflow-engine-root-mismatch");
    }
    if (
      !options.deliverySource ||
      typeof options.deliverySource.load !== "function" ||
      !options.worker ||
      typeof options.worker.runAttempt !== "function" ||
      typeof options.worker.rebind !== "function" ||
      !options.changeVerifier ||
      typeof options.changeVerifier.verify !== "function" ||
      (options.application !== undefined &&
        (typeof options.application.prepare === "function") !==
          (typeof options.application.applyPrepared === "function"))
    ) {
      throw new Error("workflow-engine-service-invalid");
    }
    if (
      options.leaseTtlMs !== undefined &&
      (!Number.isSafeInteger(options.leaseTtlMs) || options.leaseTtlMs < 1)
    ) {
      throw new Error("workflow-engine-lease-invalid");
    }
    return new WorkflowEngine(options);
  }

  updateRoutePolicy(policy: RoutePolicy): void {
    this.#assertOpen();
    if (!this.#worker.updateRoutePolicy) {
      throw new Error("route-policy-update-unavailable");
    }
    this.#worker.updateRoutePolicy(policy);
  }

  routePolicyStatus(): Record<string, unknown> | undefined {
    this.#assertOpen();
    return this.#worker.routePolicyStatus?.();
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("workflow-engine-closed");
  }

  #transaction<T>(work: () => T): T {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  #operationKey(runId: string, operationId: string): string {
    return `${runId}\0${operationId}`;
  }

  #leaseOperationId(runId: string, _operationId: string): string {
    return `engine-run-${hash(runId).slice(0, 40)}`;
  }

  #holdOperationLease(lease: OperationLease, commandOperationId: string): void {
    const key = this.#operationKey(lease.runId, commandOperationId);
    const existing = this.#operationLeases.get(key);
    if (existing) clearInterval(existing.timer);
    const intervalMs = Math.max(1, Math.floor(this.#leaseTtlMs / 3));
    const held: HeldOperationLease = {
      lease,
      timer: setInterval(() => {
        if (this.#operationLeases.get(key) !== held) return;
        try {
          held.lease = this.#runStore.renewLease(held.lease, this.#leaseTtlMs);
          this.#database
            .prepare(
              `UPDATE workflow_engine_operations
               SET lease_expires_at = ?
               WHERE run_id = ? AND operation_id = ? AND state = 'running'
                 AND lease_token = ?`,
            )
            .run(
              held.lease.expiresAt,
              lease.runId,
              commandOperationId,
              lease.token,
            );
        } catch {
          held.error = new Error("lease-fenced");
          clearInterval(held.timer);
          const active = this.#active.get(lease.runId);
          if (active?.operationId === commandOperationId) {
            active.controller.abort(held.error);
          }
        }
      }, intervalMs),
    };
    held.timer.unref?.();
    this.#operationLeases.set(key, held);
  }

  #operationLease(runId: string, operationId: string): OperationLease {
    const held = this.#operationLeases.get(
      this.#operationKey(runId, operationId),
    );
    if (!held || held.error) throw held?.error ?? new Error("lease-fenced");
    this.#runStore.assertLease(held.lease);
    return held.lease;
  }

  #releaseOperationLease(runId: string, operationId: string): void {
    const key = this.#operationKey(runId, operationId);
    const held = this.#operationLeases.get(key);
    if (!held) return;
    clearInterval(held.timer);
    this.#operationLeases.delete(key);
  }

  #assertLeaseInTransaction(lease: OperationLease): void {
    const row = this.#database
      .prepare(
        `SELECT state, lease_token, lease_expires_at
         FROM operations WHERE run_id = ? AND operation_id = ?`,
      )
      .get(lease.runId, lease.operationId) as
      | {
          state: string;
          lease_token: string | null;
          lease_expires_at: number | null;
        }
      | undefined;
    if (
      row?.state !== "running" ||
      row.lease_token !== lease.token ||
      row.lease_expires_at === null ||
      row.lease_expires_at < this.#now()
    ) {
      throw new Error("lease-fenced");
    }
  }

  #leasedTransaction<T>(lease: OperationLease, work: () => T): T {
    return this.#transaction(() => {
      this.#assertLeaseInTransaction(lease);
      return work();
    });
  }

  #lookupRun(stage: ControlStage, change: string): string | undefined {
    return (
      this.#database
        .prepare(
          `SELECT run_id FROM runs
           WHERE root_hash = ? AND stage = ? AND lookup_key = ?`,
        )
        .get(this.#stateRoot.consumerRootHash, stage, `change:${change}`) as
        | { run_id: string }
        | undefined
    )?.run_id;
  }

  #ensureEngineRun(runId: string): void {
    this.#database
      .prepare(
        `INSERT INTO workflow_engine_runs(
           run_id, current_revision, baseline_workspace_revision,
           current_workspace_revision, cleanup_state, next_queue_position
         ) VALUES (?, NULL, NULL, NULL, 'none', 1)
         ON CONFLICT(run_id) DO NOTHING`,
      )
      .run(runId);
  }

  #engineRun(runId: string): EngineRunRow {
    const row = this.#database
      .prepare(
        `SELECT current_revision, baseline_workspace_revision,
                current_workspace_revision, cleanup_state, route_id,
                route_fingerprint,
                transaction_id, verification_json, delivery_diagnostics_json,
                next_queue_position
         FROM workflow_engine_runs WHERE run_id = ?`,
      )
      .get(runId) as EngineRunRow | undefined;
    if (!row) throw new Error("workflow-engine-run-unavailable");
    return row;
  }

  #operation(
    runId: string,
    operationId: string,
  ): EngineOperationRow | undefined {
    return this.#database
      .prepare(
        `SELECT command, state, outcome_json FROM workflow_engine_operations
         WHERE run_id = ? AND operation_id = ?`,
      )
      .get(runId, operationId) as EngineOperationRow | undefined;
  }

  #operationReplay(
    runId: string,
    operationId: string,
    command: string,
  ): Record<string, unknown> | undefined {
    const row = this.#operation(runId, operationId);
    if (row && row.command !== command) {
      throw new Error("operation-command-mismatch");
    }
    return row?.state === "committed" && row.outcome_json
      ? parseJsonRecord(row.outcome_json)
      : undefined;
  }

  #beginOperation(
    runId: string,
    operationId: string,
    command: string,
  ): Record<string, unknown> | undefined {
    if (!IDENTIFIER.test(operationId)) throw new Error("invalid-operation-id");
    const replay = this.#operationReplay(runId, operationId, command);
    if (replay) return replay;
    const existing = this.#operation(runId, operationId);
    if (existing?.state === "running") {
      const leaseStatus = this.#runStore.inspectOperation(
        runId,
        this.#leaseOperationId(runId, operationId),
      );
      if (leaseStatus?.state === "committed" && leaseStatus.outcome) {
        this.#database
          .prepare(
            `UPDATE workflow_engine_operations
             SET state = 'committed', lease_token = NULL,
                 lease_expires_at = NULL, outcome_json = ?
             WHERE run_id = ? AND operation_id = ?`,
          )
          .run(JSON.stringify(leaseStatus.outcome), runId, operationId);
        return structuredClone(leaseStatus.outcome);
      }
      if (leaseStatus?.state === "running") {
        throw new Error("operation-already-running");
      }
      this.#database
        .prepare(
          `UPDATE workflow_engine_operations
           SET state = 'interrupted', lease_token = NULL,
               lease_expires_at = NULL
           WHERE run_id = ? AND operation_id = ? AND state = 'running'`,
        )
        .run(runId, operationId);
    }
    const leaseOperationId = this.#leaseOperationId(runId, operationId);
    const priorLease = this.#runStore.inspectOperation(runId, leaseOperationId);
    const preempt = command === "cancel" || command === "discard";
    if (priorLease?.state === "running" && !preempt) {
      throw new Error("operation-already-running");
    }
    const lease = this.#runStore.acquireLease({
      runId,
      operationId: leaseOperationId,
      ttlMs: this.#leaseTtlMs,
      exclusive: true,
      ...(preempt ? { preempt: true } : {}),
    });
    if (preempt) {
      this.#database
        .prepare(
          `UPDATE workflow_engine_operations
           SET state = 'interrupted', lease_token = NULL,
               lease_expires_at = NULL
           WHERE run_id = ? AND operation_id <> ? AND state = 'running'`,
        )
        .run(runId, operationId);
    }
    this.#database
      .prepare(
        `INSERT INTO workflow_engine_operations(
           run_id, operation_id, command, state, lease_token,
           lease_expires_at, outcome_json
         ) VALUES (?, ?, ?, 'running', ?, ?, NULL)
         ON CONFLICT(run_id, operation_id) DO UPDATE SET
           command = excluded.command, state = 'running',
           lease_token = excluded.lease_token,
           lease_expires_at = excluded.lease_expires_at,
           outcome_json = NULL`,
      )
      .run(runId, operationId, command, lease.token, lease.expiresAt);
    this.#holdOperationLease(lease, operationId);
    return undefined;
  }

  #commitOperation(
    runId: string,
    operationId: string,
    outcome: Record<string, unknown>,
  ): Record<string, unknown> {
    const lease = this.#operationLease(runId, operationId);
    try {
      const committed = this.#runStore.commitLease(lease, outcome);
      const result = this.#database
        .prepare(
          `UPDATE workflow_engine_operations
           SET state = 'committed', lease_token = NULL,
               lease_expires_at = NULL, outcome_json = ?
           WHERE run_id = ? AND operation_id = ? AND state = 'running'
             AND lease_token = ?`,
        )
        .run(JSON.stringify(committed), runId, operationId, lease.token);
      if (Number(result.changes) !== 1) {
        throw new Error("operation-journal-fenced");
      }
      return structuredClone(committed);
    } finally {
      this.#releaseOperationLease(runId, operationId);
    }
  }

  #interruptOperation(runId: string, operationId: string): void {
    let lease: OperationLease;
    try {
      lease = this.#operationLease(runId, operationId);
      this.#runStore.interruptLease(lease);
      this.#database
        .prepare(
          `UPDATE workflow_engine_operations
           SET state = 'interrupted', lease_token = NULL,
               lease_expires_at = NULL
           WHERE run_id = ? AND operation_id = ? AND state = 'running'
             AND lease_token = ?`,
        )
        .run(runId, operationId, lease.token);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "lease-fenced") {
        throw error;
      }
    } finally {
      this.#releaseOperationLease(runId, operationId);
    }
  }

  #transition(
    runId: string,
    to: RunState,
    identity: string,
    code?: string,
    lease?: OperationLease,
  ): RunProjection {
    if (lease) this.#runStore.assertLease(lease);
    const current = this.#runStore.status(runId);
    if (
      current.state === to &&
      (to !== "paused" || code === undefined || current.pauseCode === code)
    ) {
      return current;
    }
    return this.#runStore.transition({
      runId,
      to,
      operationId: `eng-${hash(runId, identity, String(current.sequence), to).slice(0, 40)}`,
      ...(code ? { code } : {}),
      ...(lease ? { lease } : {}),
    });
  }

  #recoverInterruptedOperations(): void {
    if (this.#orphanRecoveryTimer) {
      clearTimeout(this.#orphanRecoveryTimer);
      this.#orphanRecoveryTimer = undefined;
    }
    let nextExpiry: number | undefined;
    const interrupted = this.#database
      .prepare(
        `SELECT run_id, operation_id FROM workflow_engine_operations
         WHERE state = 'running'`,
      )
      .all() as unknown as Array<{ run_id: string; operation_id: string }>;
    for (const row of interrupted) {
      const leaseStatus = this.#runStore.inspectOperation(
        row.run_id,
        this.#leaseOperationId(row.run_id, row.operation_id),
      );
      if (leaseStatus?.state === "committed" && leaseStatus.outcome) {
        this.#database
          .prepare(
            `UPDATE workflow_engine_operations
             SET state = 'committed', lease_token = NULL,
                 lease_expires_at = NULL, outcome_json = ?
             WHERE run_id = ? AND operation_id = ? AND state = 'running'`,
          )
          .run(
            JSON.stringify(leaseStatus.outcome),
            row.run_id,
            row.operation_id,
          );
        continue;
      }
      if (leaseStatus?.state === "running") {
        if (leaseStatus.expiresAt !== undefined) {
          nextExpiry = Math.min(nextExpiry ?? Infinity, leaseStatus.expiresAt);
        }
        continue;
      }
      this.#database
        .prepare(
          `UPDATE workflow_engine_operations
           SET state = 'interrupted', lease_token = NULL,
               lease_expires_at = NULL
           WHERE run_id = ? AND operation_id = ? AND state = 'running'`,
        )
        .run(row.run_id, row.operation_id);
      const projection = this.#runStore.status(row.run_id);
      if (["completed", "discarded", "rejected"].includes(projection.state)) {
        continue;
      }
      this.#database
        .prepare(
          `UPDATE workflow_engine_tasks
           SET state = 'paused',
               pause_code = CASE
                 WHEN pause_code = 'red-artifact-constraint'
                   THEN pause_code
                 ELSE 'operation-interrupted'
               END,
               context_request_json = CASE
                 WHEN pause_code = 'red-artifact-constraint'
                   THEN context_request_json
                 ELSE NULL
               END,
               queue_position = NULL
           WHERE run_id = ? AND state IN ('phase-running', 'validating')`,
        )
        .run(row.run_id);
      if (projection.state === "applying") {
        this.#transition(
          row.run_id,
          "recovering",
          "restart-apply-recovery",
          "operation-interrupted",
        );
      } else if (
        [
          "created",
          "validating-delivery",
          "ready",
          "queued",
          "connecting",
          "running",
          "validating",
          "verifying",
          "retryable",
          "approval-needed",
          "change-verifying",
          "ready-to-apply",
        ].includes(projection.state)
      ) {
        this.#transition(
          row.run_id,
          "paused",
          "restart-operation-interrupted",
          "operation-interrupted",
        );
      }
    }
    if (nextExpiry !== undefined && !this.#closed) {
      const delay = Math.max(1, nextExpiry - this.#now() + 1);
      this.#orphanRecoveryTimer = setTimeout(() => {
        this.#orphanRecoveryTimer = undefined;
        if (this.#closed) return;
        try {
          this.#recoverInterruptedOperations();
        } catch {
          // A later status/restart will surface durable journal corruption.
        }
      }, delay);
      this.#orphanRecoveryTimer.unref?.();
    }
  }

  #recoverTerminalCleanup(): void {
    const rows = this.#database
      .prepare(
        `SELECT workflow_engine_runs.run_id
         FROM workflow_engine_runs
         JOIN runs ON runs.run_id = workflow_engine_runs.run_id
         WHERE runs.state IN ('completed', 'discarded')
           AND workflow_engine_runs.cleanup_state = 'retained'`,
      )
      .all() as unknown as Array<{ run_id: string }>;
    for (const row of rows) {
      try {
        this.#cleanupTerminal(row.run_id, "restart-cleanup");
      } catch {
        // Terminal status remains truthful and a later reload retries cleanup.
      }
    }
  }

  #tasks(runId: string): EngineTaskRow[] {
    return this.#database
      .prepare(
        `SELECT task_id, task_order, delivery_revision, plan_json, state,
                phase, pause_code, context_request_json, route_id,
                route_fingerprint, queue_position
         FROM workflow_engine_tasks WHERE run_id = ? ORDER BY task_order`,
      )
      .all(runId) as unknown as EngineTaskRow[];
  }

  #taskPlan(row: EngineTaskRow): PlanTaskDraft {
    return JSON.parse(row.plan_json) as PlanTaskDraft;
  }

  #currentPlan(runId: string): ImplementPlan {
    const revision = this.#engineRun(runId).current_revision;
    if (revision === null) throw new Error("delivery-not-bound");
    return this.#planForRevision(runId, revision);
  }

  #planForRevision(runId: string, revision: number): ImplementPlan {
    const row = this.#database
      .prepare(
        `SELECT plan_json FROM workflow_engine_deliveries
         WHERE run_id = ? AND revision = ?`,
      )
      .get(runId, revision) as { plan_json: string } | undefined;
    if (!row) throw new Error("delivery-not-bound");
    return parsePlan(row.plan_json);
  }

  async #loadDelivery(
    stage: ControlStage,
    change: string,
    deliveryRevision?: number,
    receiptHash?: string,
  ): Promise<WorkflowDelivery> {
    const delivery = await this.#deliverySource.load({
      stage,
      change,
      ...(deliveryRevision === undefined ? {} : { deliveryRevision }),
      ...(receiptHash === undefined ? {} : { receiptHash }),
    });
    assertDelivery(delivery, stage, change, deliveryRevision, receiptHash);
    return structuredClone(delivery);
  }

  #admitDelivery(
    runId: string,
    delivery: WorkflowDelivery,
    lease: OperationLease,
  ): void {
    this.#runStore.assertLease(lease);
    const existing = this.#database
      .prepare(
        `SELECT receipt_hash, plan_json FROM workflow_engine_deliveries
         WHERE run_id = ? AND revision = ?`,
      )
      .get(runId, delivery.revision) as
      | { receipt_hash: string; plan_json: string }
      | undefined;
    const serializedPlan = JSON.stringify(delivery.plan);
    if (
      existing &&
      (existing.receipt_hash !== delivery.receiptHash ||
        existing.plan_json !== serializedPlan)
    ) {
      throw new Error("delivery-revision-conflict");
    }
    const engineRun = this.#engineRun(runId);
    if (
      engineRun.current_revision !== null &&
      delivery.revision < engineRun.current_revision
    ) {
      throw new Error("delivery-revision-stale");
    }
    const priorRows = this.#tasks(runId);
    const priorById = new Map(priorRows.map((row) => [row.task_id, row]));
    const priorPlan =
      engineRun.current_revision === null
        ? undefined
        : this.#planForRevision(runId, engineRun.current_revision);
    const priorTasks = new Map(
      (priorPlan?.tasks ?? []).map((task) => [task.taskId, task]),
    );
    const nextTasks = new Map(
      delivery.plan.tasks.map((task) => [task.taskId, task]),
    );
    const priorBoundPaths = new Set(
      priorPlan ? deliveryBoundPaths(priorPlan) : [],
    );
    const boundaryExpanded = deliveryBoundPaths(delivery.plan).some(
      (relative) => !priorBoundPaths.has(relative),
    );
    const compatible = new Set<string>();
    if (priorPlan) {
      for (const [taskId, priorTask] of priorTasks) {
        const nextTask = nextTasks.get(taskId);
        if (
          nextTask &&
          taskApprovalBoundary(priorPlan, priorTask) ===
            taskApprovalBoundary(delivery.plan, nextTask)
        ) {
          compatible.add(taskId);
        }
      }
    }
    let invalidated = new Set(
      priorRows
        .filter((row) => !compatible.has(row.task_id))
        .map((row) => row.task_id),
    );
    let revalidatedWorkspace:
      | {
          baselineRevisionId: string;
          currentWorkspaceRevisionId: string;
        }
      | undefined;
    if (
      priorPlan &&
      (invalidated.size > 0 || boundaryExpanded) &&
      engineRun.baseline_workspace_revision &&
      engineRun.current_workspace_revision
    ) {
      if (!this.#worker.revalidateDelivery) {
        if (boundaryExpanded) {
          throw new Error("workflow-delivery-revalidation-unavailable");
        }
        if (
          engineRun.current_workspace_revision !==
          engineRun.baseline_workspace_revision
        ) {
          throw new Error("workflow-delivery-revalidation-unavailable");
        }
      } else {
        const result = this.#worker.revalidateDelivery({
          runId,
          deliveryRevision: delivery.revision,
          plan: structuredClone(delivery.plan),
          tasks: priorRows
            .filter((row) => compatible.has(row.task_id))
            .map((row) => ({
              taskId: row.task_id,
              deliveryRevision: row.delivery_revision,
              state: row.state,
              phase: row.phase,
            })),
          invalidatedTaskIds: [...invalidated].sort(),
          baselineRevisionId: engineRun.baseline_workspace_revision,
          currentWorkspaceRevisionId: engineRun.current_workspace_revision,
        });
        const resultIds = new Set(result.invalidatedTaskIds);
        if (
          !Array.isArray(result.invalidatedTaskIds) ||
          resultIds.size !== result.invalidatedTaskIds.length ||
          [...invalidated].some((taskId) => !resultIds.has(taskId)) ||
          [...resultIds].some((taskId) => !priorById.has(taskId)) ||
          !SHA256.test(result.baselineRevisionId) ||
          !SHA256.test(result.currentWorkspaceRevisionId)
        ) {
          throw new Error("workflow-delivery-revalidation-invalid");
        }
        invalidated = resultIds;
        revalidatedWorkspace = {
          baselineRevisionId: result.baselineRevisionId,
          currentWorkspaceRevisionId: result.currentWorkspaceRevisionId,
        };
      }
    }
    const deliveryBindings = delivery.approvalProofs
      ? ([
          {
            runId,
            gate: "gate-a" as const,
            revision: delivery.revision,
            receiptHash: delivery.receiptHash,
            approvalProof: structuredClone(delivery.approvalProofs.gateA),
            operationId: `bind-a-${hash(
              runId,
              String(delivery.revision),
              delivery.approvalProofs.gateA.recordHash,
            ).slice(0, 40)}`,
            lease,
          },
          {
            runId,
            gate: "gate-b" as const,
            revision: delivery.revision,
            receiptHash: delivery.receiptHash,
            approvalProof: structuredClone(delivery.approvalProofs.gateB),
            operationId: `bind-b-${hash(
              runId,
              String(delivery.revision),
              delivery.approvalProofs.gateB.recordHash,
            ).slice(0, 40)}`,
            lease,
          },
        ] as const)
      : ([
          {
            runId,
            gate: delivery.gate,
            revision: delivery.revision,
            receiptHash: delivery.receiptHash,
            operationId: `bind-${hash(
              runId,
              String(delivery.revision),
              delivery.receiptHash,
            ).slice(0, 40)}`,
            lease,
          },
        ] as const);
    this.#runStore.bindDeliveriesAtomically(deliveryBindings, (database) => {
      const engineLease = database
        .prepare(
          `SELECT state, lease_expires_at
             FROM workflow_engine_operations
             WHERE run_id = ? AND lease_token = ?`,
        )
        .get(runId, lease.token) as
        | { state: string; lease_expires_at: number | null }
        | undefined;
      if (
        engineLease?.state !== "running" ||
        engineLease.lease_expires_at === null ||
        engineLease.lease_expires_at < this.#now()
      ) {
        throw new Error("lease-fenced");
      }
      database
        .prepare(
          `INSERT INTO workflow_engine_runs(
             run_id, current_revision, delivery_diagnostics_json,
             next_queue_position
           ) VALUES (?, ?, NULL, 1)
           ON CONFLICT(run_id) DO UPDATE SET
             current_revision = excluded.current_revision,
             verification_json = NULL,
             delivery_diagnostics_json = NULL`,
        )
        .run(runId, delivery.revision);
      if (revalidatedWorkspace) {
        database
          .prepare(
            `UPDATE workflow_engine_runs
             SET baseline_workspace_revision = ?,
                 current_workspace_revision = ?, cleanup_state = 'retained'
             WHERE run_id = ?`,
          )
          .run(
            revalidatedWorkspace.baselineRevisionId,
            revalidatedWorkspace.currentWorkspaceRevisionId,
            runId,
          );
      }
      database
        .prepare(
          `INSERT INTO workflow_engine_deliveries(
             run_id, revision, gate, receipt_hash, plan_json
           ) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(run_id, revision) DO NOTHING`,
        )
        .run(
          runId,
          delivery.revision,
          delivery.gate,
          delivery.receiptHash,
          serializedPlan,
        );

      const admitted = new Set<string>();
      delivery.plan.tasks.forEach((task, taskOrder) => {
        admitted.add(task.taskId);
        const taskJson = JSON.stringify(task);
        const prior = priorById.get(task.taskId);
        if (!prior) {
          database
            .prepare(
              `INSERT INTO workflow_engine_tasks(
                 run_id, task_id, task_order, delivery_revision, plan_json,
                 state, phase
               ) VALUES (?, ?, ?, ?, ?, 'pending', 'red')`,
            )
            .run(runId, task.taskId, taskOrder, delivery.revision, taskJson);
          return;
        }
        if (compatible.has(task.taskId) && !invalidated.has(task.taskId)) {
          database
            .prepare(
              `UPDATE workflow_engine_tasks
               SET task_order = ?, plan_json = ?
               WHERE run_id = ? AND task_id = ?`,
            )
            .run(taskOrder, taskJson, runId, task.taskId);
          return;
        }
        database
          .prepare(
            `UPDATE workflow_engine_tasks
             SET task_order = ?, delivery_revision = ?, plan_json = ?,
                 state = 'pending', phase = 'red', pause_code = NULL,
                 context_request_json = NULL, queue_position = NULL
             WHERE run_id = ? AND task_id = ?`,
          )
          .run(taskOrder, delivery.revision, taskJson, runId, task.taskId);
      });
      for (const row of priorRows) {
        if (!admitted.has(row.task_id)) {
          database
            .prepare(
              `DELETE FROM workflow_engine_tasks
               WHERE run_id = ? AND task_id = ?`,
            )
            .run(runId, row.task_id);
        }
      }
    });
  }

  #deliveryFailure(
    runId: string,
    operationId: string,
    error: unknown,
    lease: OperationLease,
  ): Record<string, unknown> | undefined {
    if (!(error instanceof DeliveryValidationError)) return undefined;
    this.#leasedTransaction(lease, () => {
      this.#database
        .prepare(
          `UPDATE workflow_engine_runs
           SET delivery_diagnostics_json = ? WHERE run_id = ?`,
        )
        .run(JSON.stringify(error.diagnostics), runId);
    });
    this.#transition(
      runId,
      "paused",
      `${operationId}:delivery-invalid`,
      "delivery-invalid",
      lease,
    );
    return {
      ...this.#statusByRun(runId),
      delivery: {
        code: "delivery-invalid",
        diagnostics: [...error.diagnostics],
      },
    };
  }

  #setTask(
    runId: string,
    taskId: string,
    values: {
      state?: string;
      phase?: "red" | "green" | "refactor";
      pauseCode?: string | null;
      contextRequest?: WorkflowContextRequest | null;
      routeId?: string | null;
      routeFingerprint?: string | null;
      queuePosition?: number | null;
    },
    lease?: OperationLease,
  ): void {
    const assignments: string[] = [];
    const parameters: Array<string | number | null> = [];
    if (values.state !== undefined) {
      assignments.push("state = ?");
      parameters.push(values.state);
    }
    if (values.phase !== undefined) {
      assignments.push("phase = ?");
      parameters.push(values.phase);
    }
    if (values.pauseCode !== undefined) {
      assignments.push("pause_code = ?");
      parameters.push(values.pauseCode);
    }
    if (values.contextRequest !== undefined) {
      assignments.push("context_request_json = ?");
      parameters.push(
        values.contextRequest === null
          ? null
          : JSON.stringify(
              normalizeWorkflowContextRequest(values.contextRequest),
            ),
      );
    }
    if (values.routeId !== undefined) {
      assignments.push("route_id = ?");
      parameters.push(values.routeId);
    }
    if (values.routeFingerprint !== undefined) {
      assignments.push("route_fingerprint = ?");
      parameters.push(values.routeFingerprint);
    }
    if (values.queuePosition !== undefined) {
      assignments.push("queue_position = ?");
      parameters.push(values.queuePosition);
    }
    if (assignments.length === 0) return;
    const write = () => {
      this.#database
        .prepare(
          `UPDATE workflow_engine_tasks SET ${assignments.join(", ")}
           WHERE run_id = ? AND task_id = ?`,
        )
        .run(...parameters, runId, taskId);
    };
    if (lease) this.#leasedTransaction(lease, write);
    else write();
  }

  #setVerificationStatus(
    runId: string,
    status: WorkflowVerificationStatus | null,
    lease: OperationLease,
  ): void {
    const serialized =
      status === null
        ? null
        : JSON.stringify(normalizeWorkflowVerificationStatus(status));
    this.#leasedTransaction(lease, () => {
      this.#database
        .prepare(
          `UPDATE workflow_engine_runs SET verification_json = ?
           WHERE run_id = ?`,
        )
        .run(serialized, runId);
    });
  }

  #queueTask(runId: string, row: EngineTaskRow, lease: OperationLease): void {
    if (row.state === "queued" && row.queue_position !== null) return;
    const engineRun = this.#engineRun(runId);
    this.#leasedTransaction(lease, () => {
      this.#setTask(runId, row.task_id, {
        state: "queued",
        pauseCode: null,
        queuePosition: engineRun.next_queue_position,
      });
      this.#database
        .prepare(
          `UPDATE workflow_engine_runs
           SET next_queue_position = next_queue_position + 1
           WHERE run_id = ?`,
        )
        .run(runId);
    });
  }

  #hasConflict(
    row: EngineTaskRow,
    rows: EngineTaskRow[],
    selectedTaskIds: ReadonlySet<string>,
  ): boolean {
    const candidate = this.#taskPlan(row);
    return rows.some((other) => {
      if (other.task_id === row.task_id || other.state === "verified") {
        return false;
      }
      if (other.state === "queued") {
        if (row.state !== "queued") return false;
        const candidatePosition = row.queue_position ?? Number.MAX_SAFE_INTEGER;
        const otherPosition = other.queue_position ?? Number.MAX_SAFE_INTEGER;
        if (
          otherPosition > candidatePosition ||
          (otherPosition === candidatePosition &&
            other.task_order > row.task_order)
        ) {
          return false;
        }
      }
      if (other.task_order > row.task_order && other.state === "pending") {
        return false;
      }
      if (
        other.state === "pending" &&
        !this.#dependenciesVerified(other, rows)
      ) {
        return false;
      }
      const conflict = taskConflicts(candidate, this.#taskPlan(other));
      return (
        conflict.taskLifetime ||
        (conflict.verification &&
          ([
            "pending",
            "phase-ready",
            "phase-running",
            "validating",
            "queued",
          ].includes(other.state) ||
            selectedTaskIds.has(other.task_id)))
      );
    });
  }

  #dependenciesVerified(row: EngineTaskRow, rows: EngineTaskRow[]): boolean {
    const byId = new Map(
      rows.map((candidate) => [candidate.task_id, candidate]),
    );
    return this.#taskPlan(row).dependsOn.every(
      (dependency) => byId.get(dependency)?.state === "verified",
    );
  }

  #recordWorkspaceFacts(
    runId: string,
    outcome: WorkflowAttemptOutcome,
    lease: OperationLease,
  ): void {
    const baselineRevisionId = outcome.baselineRevisionId;
    const currentWorkspaceRevisionId =
      outcome.kind === "phase-committed"
        ? outcome.isolatedRevisionId
        : outcome.currentWorkspaceRevisionId;
    if (
      (baselineRevisionId !== undefined && !SHA256.test(baselineRevisionId)) ||
      (currentWorkspaceRevisionId !== undefined &&
        !SHA256.test(currentWorkspaceRevisionId)) ||
      (outcome.kind !== "phase-committed" &&
        (baselineRevisionId === undefined) !==
          (currentWorkspaceRevisionId === undefined))
    ) {
      throw new Error("workflow-attempt-workspace-fact-invalid");
    }
    if (currentWorkspaceRevisionId === undefined) return;
    this.#leasedTransaction(lease, () => {
      this.#database
        .prepare(
          `UPDATE workflow_engine_runs
           SET baseline_workspace_revision = COALESCE(
                 baseline_workspace_revision, ?
               ),
               current_workspace_revision = ?,
               cleanup_state = CASE
                 WHEN ? IS NULL THEN cleanup_state ELSE 'retained'
               END
           WHERE run_id = ?`,
        )
        .run(
          baselineRevisionId ?? null,
          currentWorkspaceRevisionId,
          baselineRevisionId ?? null,
          runId,
        );
    });
  }

  #recordRouteFacts(
    runId: string,
    taskId: string,
    outcome: WorkflowAttemptOutcome,
    lease: OperationLease,
  ): void {
    if (
      (outcome.routeId === undefined) !==
        (outcome.routeFingerprint === undefined) ||
      (outcome.routeId !== undefined && !IDENTIFIER.test(outcome.routeId)) ||
      (outcome.routeFingerprint !== undefined &&
        !SHA256.test(outcome.routeFingerprint))
    ) {
      throw new Error("workflow-attempt-route-fact-invalid");
    }
    if (!outcome.routeId || !outcome.routeFingerprint) return;
    const routeId = outcome.routeId;
    const routeFingerprint = outcome.routeFingerprint;
    this.#leasedTransaction(lease, () => {
      this.#setTask(runId, taskId, {
        routeId,
        routeFingerprint,
      });
      this.#database
        .prepare(
          `UPDATE workflow_engine_runs
           SET route_id = ?, route_fingerprint = ? WHERE run_id = ?`,
        )
        .run(routeId, routeFingerprint, runId);
    });
  }

  async #runTask(
    runId: string,
    row: EngineTaskRow,
    operationId: string,
    signal: AbortSignal,
    lease: OperationLease,
    onActivity?: (event: WorkflowActivityUpdate) => void,
  ): Promise<void> {
    const task = this.#taskPlan(row);
    const orderedPhases = phases(task);
    let phaseIndex = orderedPhases.indexOf(row.phase);
    let artifactAttempts = 0;
    const persistedContextRequest = row.context_request_json
      ? normalizeWorkflowContextRequest(
          JSON.parse(row.context_request_json) as unknown,
        )
      : undefined;
    const persistedRedArtifactCorrection =
      row.phase === "green" &&
      persistedContextRequest !== undefined &&
      classifyPersistedContextRequest(persistedContextRequest, task, "green")
        .code === "red-artifact-constraint";
    let redArtifactCorrection =
      row.phase === "green" &&
      (row.pause_code === "red-artifact-constraint" ||
        persistedRedArtifactCorrection);
    let correctionContextRequest = redArtifactCorrection
      ? persistedContextRequest
      : undefined;
    if (phaseIndex < 0) throw new Error("workflow-task-phase-invalid");
    while (phaseIndex < orderedPhases.length) {
      const phase = orderedPhases[phaseIndex];
      if (signal.aborted) {
        this.#setTask(
          runId,
          row.task_id,
          {
            state: "paused",
            phase,
            pauseCode: "operation-cancelled",
            contextRequest: null,
            queuePosition: null,
          },
          lease,
        );
        return;
      }
      const current = this.#engineRun(runId);
      if (current.current_revision === null)
        throw new Error("delivery-not-bound");
      const verificationStatus = current.verification_json
        ? normalizeWorkflowVerificationStatus(
            JSON.parse(current.verification_json) as unknown,
          )
        : undefined;
      const plan = this.#planForRevision(runId, row.delivery_revision);
      const repair =
        verificationStatus?.scope === "change-task-affected" &&
        verificationStatus.attribution === "introduced" &&
        verificationStatus.taskId === row.task_id &&
        verificationStatus.failureIdentities &&
        verificationStatus.failureIdentities.length > 0
          ? {
              attribution: "introduced" as const,
              failureIdentities: [...verificationStatus.failureIdentities],
            }
          : undefined;
      const artifactCorrection =
        redArtifactCorrection && phase === "green"
          ? {
              code: "red-artifact-constraint" as const,
              attempt: artifactAttempts + 1,
              maxAttempts: plan.verification.artifactCorrection.maxAttempts,
              ...(correctionContextRequest
                ? {
                    contextRequest: structuredClone(correctionContextRequest),
                  }
                : {}),
            }
          : undefined;
      this.#setTask(
        runId,
        row.task_id,
        {
          state: "phase-running",
          phase,
          pauseCode: artifactCorrection?.code ?? null,
          contextRequest: correctionContextRequest ?? null,
          queuePosition: null,
        },
        lease,
      );
      let outcome: WorkflowAttemptOutcome;
      try {
        outcome = await this.#worker.runAttempt({
          runId,
          operationId,
          deliveryRevision: row.delivery_revision,
          taskId: row.task_id,
          phase,
          task: structuredClone(task),
          plan: structuredClone(plan),
          ...(current.baseline_workspace_revision
            ? { baselineRevisionId: current.baseline_workspace_revision }
            : {}),
          ...(current.current_workspace_revision
            ? {
                currentWorkspaceRevisionId: current.current_workspace_revision,
              }
            : {}),
          ...(row.route_id || current.route_id
            ? { routeId: row.route_id ?? current.route_id ?? undefined }
            : {}),
          ...(row.route_fingerprint || current.route_fingerprint
            ? {
                routeFingerprint:
                  row.route_fingerprint ??
                  current.route_fingerprint ??
                  undefined,
              }
            : {}),
          ...(repair ? { repair } : {}),
          ...(artifactCorrection ? { artifactCorrection } : {}),
          signal,
          onActivity: (event) => {
            const projection = this.#runStore.status(runId);
            emitWorkflowActivity(onActivity, {
              ...event,
              stage: projection.stage,
              runId,
              ...(projection.change ? { change: projection.change } : {}),
              taskId: row.task_id,
              phase,
              objective: task.objective,
              legalCommands: ["status", "cancel", "discard"],
            });
          },
        });
      } catch (error) {
        if (isCancellationException(error, signal)) {
          outcome = { kind: "operation-cancelled", code: "cancelled" };
        } else {
          throw error;
        }
      }
      if (!isRecord(outcome) || typeof outcome.kind !== "string") {
        throw new Error("workflow-attempt-outcome-invalid");
      }
      this.#recordWorkspaceFacts(runId, outcome, lease);
      this.#recordRouteFacts(runId, row.task_id, outcome, lease);
      if (outcome.routeId && outcome.routeFingerprint) {
        row.route_id = outcome.routeId;
        row.route_fingerprint = outcome.routeFingerprint;
      }
      if (
        outcome.kind !== "phase-committed" &&
        outcome.kind !== "operation-cancelled" &&
        outcome.verification
      ) {
        this.#setVerificationStatus(runId, outcome.verification, lease);
      }
      if (outcome.kind === "retryable" && outcome.retryPolicy === "artifact") {
        if (outcome.code === "red-artifact-constraint") {
          redArtifactCorrection = true;
          correctionContextRequest = outcome.contextRequest
            ? normalizeWorkflowContextRequest(outcome.contextRequest)
            : correctionContextRequest;
        }
        artifactAttempts += 1;
        const maxAttempts = plan.verification.artifactCorrection.maxAttempts;
        if (artifactAttempts < maxAttempts) {
          this.#setTask(
            runId,
            row.task_id,
            {
              state: "retryable",
              phase,
              pauseCode: redArtifactCorrection
                ? "red-artifact-constraint"
                : outcome.code,
              contextRequest: correctionContextRequest ?? null,
              queuePosition: null,
            },
            lease,
          );
          emitWorkflowActivity(onActivity, {
            state: "retrying",
            stage: this.#runStore.status(runId).stage,
            runId,
            taskId: row.task_id,
            phase,
            objective: task.objective,
            legalCommands: ["status", "cancel", "discard"],
            code: outcome.code,
            attempt: artifactAttempts,
            maxAttempts,
            wait: "artifact-correction",
          });
          continue;
        }
      }
      if (outcome.kind === "phase-committed") {
        if (
          !SHA256.test(outcome.artifactHash) ||
          !SHA256.test(outcome.isolatedRevisionId) ||
          (outcome.baselineRevisionId !== undefined &&
            !SHA256.test(outcome.baselineRevisionId)) ||
          outcome.classification !== expectedClassification(phase)
        ) {
          throw new Error("workflow-attempt-fact-invalid");
        }
        if (repair) {
          this.#setVerificationStatus(runId, null, lease);
          this.#setTask(
            runId,
            row.task_id,
            {
              state: "verified",
              phase,
              pauseCode: null,
              contextRequest: null,
              queuePosition: null,
            },
            lease,
          );
          return;
        }
        artifactAttempts = 0;
        redArtifactCorrection = false;
        correctionContextRequest = undefined;
        phaseIndex += 1;
        if (phaseIndex >= orderedPhases.length) {
          this.#setTask(
            runId,
            row.task_id,
            {
              state: "verified",
              phase,
              pauseCode: null,
              contextRequest: null,
              queuePosition: null,
            },
            lease,
          );
          return;
        }
        this.#setTask(
          runId,
          row.task_id,
          {
            state: "phase-ready",
            phase: orderedPhases[phaseIndex],
            pauseCode: null,
            contextRequest: null,
            queuePosition: null,
          },
          lease,
        );
        continue;
      }
      if (outcome.kind === "operation-cancelled") {
        this.#setTask(
          runId,
          row.task_id,
          {
            state: "paused",
            phase,
            pauseCode: "operation-cancelled",
            contextRequest: null,
            queuePosition: null,
          },
          lease,
        );
        return;
      }
      if (
        outcome.kind === "paused" ||
        outcome.kind === "retryable" ||
        outcome.kind === "approval-needed"
      ) {
        if (typeof outcome.code !== "string" || outcome.code.length === 0) {
          throw new Error("workflow-attempt-outcome-invalid");
        }
        const approvalCodeInvalid =
          outcome.kind === "approval-needed" &&
          !isWorkflowApprovalCode(outcome.code);
        this.#setTask(
          runId,
          row.task_id,
          {
            state: approvalCodeInvalid ? "paused" : outcome.kind,
            phase,
            pauseCode: approvalCodeInvalid
              ? "approval-code-invalid"
              : outcome.code,
            contextRequest:
              !approvalCodeInvalid && outcome.contextRequest
                ? normalizeWorkflowContextRequest(outcome.contextRequest)
                : (correctionContextRequest ?? null),
            queuePosition: null,
          },
          lease,
        );
        return;
      }
      throw new Error("workflow-attempt-outcome-invalid");
    }
  }

  #firstPaused(rows: EngineTaskRow[]): EngineTaskRow | undefined {
    return (
      rows.find((row) => row.state === "approval-needed") ??
      rows.find((row) => ["paused", "retryable"].includes(row.state))
    );
  }

  #recoverLegacyContextApproval(runId: string): boolean {
    const projection = this.#runStore.status(runId);
    if (!["approval-needed", "paused"].includes(projection.state)) return false;
    const rows = this.#tasks(runId);
    const approvalRows = rows.filter((row) => row.state === "approval-needed");
    if (approvalRows.length === 0) return false;
    const reclassified = rows.flatMap((row) => {
      if (
        row.state !== "approval-needed" ||
        row.pause_code !== "boundary-review-needed" ||
        row.context_request_json === null
      ) {
        return [];
      }
      try {
        const request = normalizeWorkflowContextRequest(
          JSON.parse(row.context_request_json) as unknown,
        );
        const classified = classifyPersistedContextRequest(
          request,
          this.#taskPlan(row),
          row.phase,
        );
        if (classified.kind === "approval-needed") return [];
        return [
          {
            row,
            state: classified.kind === "retryable" ? "retryable" : "paused",
            code: classified.code,
            contextRequest: JSON.stringify(
              normalizeWorkflowContextRequest(classified.contextRequest),
            ),
          },
        ];
      } catch {
        return [];
      }
    });
    const reclassifiedTaskIds = new Set(
      reclassified.map((entry) => entry.row.task_id),
    );
    const retainedApprovals = approvalRows.filter(
      (row) => !reclassifiedTaskIds.has(row.task_id),
    );
    const updateTasks = (database: DatabaseSync) => {
      for (const entry of reclassified) {
        const updated = database
          .prepare(
            `UPDATE workflow_engine_tasks
             SET state = ?, phase = ?, pause_code = ?, context_request_json = ?,
                 queue_position = NULL
             WHERE run_id = ? AND task_id = ?
               AND state = 'approval-needed'
               AND pause_code = 'boundary-review-needed'`,
          )
          .run(
            entry.state,
            entry.row.phase,
            entry.code,
            entry.contextRequest,
            runId,
            entry.row.task_id,
          );
        if (Number(updated.changes) !== 1) {
          throw new Error("workflow-legacy-context-race");
        }
      }
    };
    const transitionWithUpdates = (
      to: "paused" | "approval-needed",
      code: string,
    ) =>
      this.#runStore.transitionAtomically(
        {
          runId,
          to,
          operationId: `legacy-context-${hash(
            runId,
            String(projection.sequence),
            to,
            code,
            JSON.stringify(
              reclassified.map((entry) => [entry.row.task_id, entry.code]),
            ),
          ).slice(0, 40)}`,
          code,
        },
        updateTasks,
      );
    if (retainedApprovals.length > 0) {
      if (projection.state === "approval-needed") {
        if (reclassified.length === 0) return false;
        this.#transaction(() => updateTasks(this.#database));
      } else {
        transitionWithUpdates(
          "approval-needed",
          retainedApprovals[0].pause_code ?? "approval-code-invalid",
        );
      }
      return true;
    }
    const first = reclassified[0];
    if (!first) return false;
    transitionWithUpdates("paused", first.code);
    return true;
  }

  async #finishChange(
    runId: string,
    operationId: string,
    signal: AbortSignal,
    lease: OperationLease,
    repairCycles: Map<string, number>,
    onActivity?: (event: WorkflowActivityUpdate) => void,
  ): Promise<Record<string, unknown>> {
    const plan = this.#currentPlan(runId);
    let engineRun = this.#engineRun(runId);
    if (engineRun.current_revision === null)
      throw new Error("delivery-not-bound");
    const deliveryRevision = engineRun.current_revision;
    this.#transition(
      runId,
      "change-verifying",
      `${operationId}:change-verifying`,
      undefined,
      lease,
    );
    const projection = this.#runStore.status(runId);
    emitWorkflowActivity(onActivity, {
      state: "verifying",
      stage: projection.stage,
      runId,
      ...(projection.change ? { change: projection.change } : {}),
      objective: projection.change
        ? `verify change ${projection.change}`
        : "verify workflow change",
      legalCommands: ["status", "cancel", "discard"],
    });
    const verification = await this.#changeVerifier.verify({
      runId,
      deliveryRevision,
      plan: structuredClone(plan),
      ...(engineRun.baseline_workspace_revision
        ? { baselineRevisionId: engineRun.baseline_workspace_revision }
        : {}),
      ...(engineRun.current_workspace_revision
        ? {
            currentWorkspaceRevisionId: engineRun.current_workspace_revision,
          }
        : {}),
      signal,
    });
    this.#runStore.assertLease(lease);
    if (verification.kind !== "verified") {
      if (verification.verification) {
        this.#setVerificationStatus(runId, verification.verification, lease);
      }
      if (
        verification.code === "verification-repair-required" &&
        verification.verification?.scope === "change-task-affected" &&
        verification.verification.attribution === "introduced" &&
        verification.verification.taskId
      ) {
        const task = this.#tasks(runId).find(
          (candidate) =>
            candidate.task_id === verification.verification?.taskId,
        );
        if (task) {
          const used = repairCycles.get(task.task_id) ?? 0;
          if (used >= plan.verification.repair.maxAttempts) {
            this.#setTask(
              runId,
              task.task_id,
              {
                state: "paused",
                phase: task.phase,
                pauseCode: "repair-attempts-exhausted",
                queuePosition: null,
              },
              lease,
            );
            this.#transition(
              runId,
              "paused",
              `${operationId}:repair-attempts-exhausted:${task.task_id}`,
              "repair-attempts-exhausted",
              lease,
            );
            return this.#statusByRun(runId);
          }
          repairCycles.set(task.task_id, used + 1);
          const taskPlan = this.#taskPlan(task);
          this.#setTask(
            runId,
            task.task_id,
            {
              state: "repairable",
              phase: taskPlan.phases.refactor ? "refactor" : "green",
              pauseCode: verification.code,
              queuePosition: null,
            },
            lease,
          );
          this.#transition(
            runId,
            "running",
            `${operationId}:repairable:${task.task_id}`,
            undefined,
            lease,
          );
          return this.#advance(
            runId,
            operationId,
            signal,
            lease,
            repairCycles,
            onActivity,
          );
        }
      }
      const approvalCodeInvalid =
        verification.kind === "approval-needed" &&
        !isWorkflowApprovalCode(verification.code);
      const state =
        verification.kind === "approval-needed" && !approvalCodeInvalid
          ? "approval-needed"
          : "paused";
      const code = approvalCodeInvalid
        ? "approval-code-invalid"
        : verification.code;
      this.#transition(
        runId,
        state,
        `${operationId}:change-verification-${state}`,
        code,
        lease,
      );
      return this.#statusByRun(runId);
    }
    if (verification.currentWorkspaceRevisionId !== undefined) {
      const currentWorkspaceRevisionId =
        verification.currentWorkspaceRevisionId;
      if (!SHA256.test(currentWorkspaceRevisionId)) {
        throw new Error("workflow-verification-workspace-fact-invalid");
      }
      this.#leasedTransaction(lease, () => {
        this.#database
          .prepare(
            `UPDATE workflow_engine_runs
             SET current_workspace_revision = ?, cleanup_state = 'retained'
             WHERE run_id = ?`,
          )
          .run(currentWorkspaceRevisionId, runId);
      });
      engineRun = this.#engineRun(runId);
    }
    this.#transition(
      runId,
      "ready-to-apply",
      `${operationId}:ready-to-apply`,
      undefined,
      lease,
    );
    if (!this.#application) {
      this.#transition(
        runId,
        "paused",
        `${operationId}:application-unavailable`,
        "application-unavailable",
        lease,
      );
      return this.#statusByRun(runId);
    }
    const transactionId = `apply-${hash(
      runId,
      String(deliveryRevision),
      operationId,
    ).slice(0, 40)}`;
    this.#leasedTransaction(lease, () => {
      this.#database
        .prepare(
          `UPDATE workflow_engine_runs SET transaction_id = ? WHERE run_id = ?`,
        )
        .run(transactionId, runId);
    });
    const applicationInput = {
      transactionId,
      runId,
      consumerRoot: this.#consumerRoot,
      deliveryRevision,
      plan: structuredClone(plan),
      ...(engineRun.baseline_workspace_revision
        ? { baselineRevisionId: engineRun.baseline_workspace_revision }
        : {}),
      ...(engineRun.current_workspace_revision
        ? {
            currentWorkspaceRevisionId: engineRun.current_workspace_revision,
          }
        : {}),
      signal,
    };
    let application: Record<string, unknown>;
    if (this.#application.prepare && this.#application.applyPrepared) {
      const prepared = await this.#application.prepare(applicationInput);
      this.#runStore.assertLease(lease);
      if (prepared.state !== "prepared") {
        return this.#settleApplication(
          runId,
          operationId,
          prepared,
          lease,
          onActivity,
        );
      }
      this.#transition(
        runId,
        "applying",
        `${operationId}:applying`,
        undefined,
        lease,
      );
      emitWorkflowActivity(onActivity, {
        state: "applying",
        stage: projection.stage,
        runId,
        ...(projection.change ? { change: projection.change } : {}),
        objective: projection.change
          ? `apply change ${projection.change}`
          : "apply workflow change",
        legalCommands: ["status", "cancel", "discard"],
      });
      const active = this.#active.get(runId);
      if (active) active.kind = "applying";
      application = await this.#application.applyPrepared(applicationInput);
    } else {
      this.#transition(
        runId,
        "applying",
        `${operationId}:applying`,
        undefined,
        lease,
      );
      emitWorkflowActivity(onActivity, {
        state: "applying",
        stage: projection.stage,
        runId,
        ...(projection.change ? { change: projection.change } : {}),
        objective: projection.change
          ? `apply change ${projection.change}`
          : "apply workflow change",
        legalCommands: ["status", "cancel", "discard"],
      });
      const active = this.#active.get(runId);
      if (active) active.kind = "applying";
      application = await this.#application.begin(applicationInput);
    }
    this.#runStore.assertLease(lease);
    return this.#settleApplication(
      runId,
      operationId,
      application,
      lease,
      onActivity,
    );
  }

  #settleApplication(
    runId: string,
    operationId: string,
    outcome: Record<string, unknown>,
    lease: OperationLease,
    onActivity?: (event: WorkflowActivityUpdate) => void,
  ): Record<string, unknown> {
    const state = outcome.state;
    if (state === "completed") {
      const current = this.#runStore.status(runId);
      if (current.state === "recovering") {
        this.#transition(
          runId,
          "completed",
          `${operationId}:recovered-complete`,
          undefined,
          lease,
        );
      } else if (
        current.state === "applying" ||
        current.state === "ready-to-apply"
      ) {
        this.#transition(
          runId,
          "completed",
          `${operationId}:apply-complete`,
          undefined,
          lease,
        );
      }
      this.#cleanupTerminal(runId, operationId, lease);
    } else if (state === "paused") {
      if (this.#runStore.status(runId).state === "applying") {
        this.#transition(
          runId,
          "recovering",
          `${operationId}:apply-recovering`,
          typeof outcome.code === "string" ? outcome.code : "recovery-required",
          lease,
        );
        const recovering = this.#runStore.status(runId);
        emitWorkflowActivity(onActivity, {
          state: "recovering",
          stage: recovering.stage,
          runId,
          ...(recovering.change ? { change: recovering.change } : {}),
          objective: recovering.change
            ? `recover change ${recovering.change}`
            : "recover workflow application",
          code:
            typeof outcome.code === "string"
              ? outcome.code
              : "recovery-required",
          legalCommands: ["status", "cancel", "discard"],
        });
      }
      this.#transition(
        runId,
        "paused",
        `${operationId}:apply-paused`,
        typeof outcome.code === "string" ? outcome.code : "recovery-required",
        lease,
      );
    } else if (state === "discarded") {
      if (this.#runStore.status(runId).state === "applying") {
        this.#transition(
          runId,
          "recovering",
          `${operationId}:discard-recovering`,
          "run-discarded",
          lease,
        );
        const recovering = this.#runStore.status(runId);
        emitWorkflowActivity(onActivity, {
          state: "recovering",
          stage: recovering.stage,
          runId,
          ...(recovering.change ? { change: recovering.change } : {}),
          objective: recovering.change
            ? `recover change ${recovering.change}`
            : "recover workflow application",
          code: "run-discarded",
          legalCommands: ["status"],
        });
      }
      this.#transition(
        runId,
        "discarded",
        `${operationId}:apply-discarded`,
        undefined,
        lease,
      );
      this.#cleanupTerminal(runId, operationId, lease);
    } else if (state === "recovering") {
      this.#transition(
        runId,
        "recovering",
        `${operationId}:application-recovering`,
        typeof outcome.code === "string" ? outcome.code : "recovery-required",
        lease,
      );
      const recovering = this.#runStore.status(runId);
      emitWorkflowActivity(onActivity, {
        state: "recovering",
        stage: recovering.stage,
        runId,
        ...(recovering.change ? { change: recovering.change } : {}),
        objective: recovering.change
          ? `recover change ${recovering.change}`
          : "recover workflow application",
        code:
          typeof outcome.code === "string" ? outcome.code : "recovery-required",
        legalCommands: ["status", "cancel", "discard"],
      });
    } else {
      throw new Error("workflow-application-outcome-invalid");
    }
    return this.#statusByRun(runId);
  }

  #applicationContext(runId: string): WorkflowApplicationContext {
    const current = this.#engineRun(runId);
    if (current.current_revision === null)
      throw new Error("delivery-not-bound");
    return {
      runId,
      deliveryRevision: current.current_revision,
      plan: structuredClone(this.#currentPlan(runId)),
      ...(current.baseline_workspace_revision
        ? { baselineRevisionId: current.baseline_workspace_revision }
        : {}),
      ...(current.current_workspace_revision
        ? { currentWorkspaceRevisionId: current.current_workspace_revision }
        : {}),
    };
  }

  #cleanupTerminal(
    runId: string,
    _currentOperationId: string,
    lease?: OperationLease,
  ): void {
    if (lease) this.#runStore.assertLease(lease);
    this.#lifecycle?.cleanup(runId);
    const cleanup = () => {
      this.#database
        .prepare("DELETE FROM workflow_engine_tasks WHERE run_id = ?")
        .run(runId);
      this.#database
        .prepare("DELETE FROM workflow_engine_deliveries WHERE run_id = ?")
        .run(runId);
      this.#database
        .prepare(`DELETE FROM workspace_revisions WHERE owner_run_id = ?`)
        .run(runId);
      this.#database
        .prepare(`DELETE FROM apply_transactions WHERE owner_run_id = ?`)
        .run(runId);
      this.#database
        .prepare(
          `UPDATE workflow_engine_runs
           SET baseline_workspace_revision = NULL,
               current_workspace_revision = NULL,
               transaction_id = NULL, verification_json = NULL,
               cleanup_state = 'complete'
           WHERE run_id = ?`,
        )
        .run(runId);
    };
    if (lease) this.#leasedTransaction(lease, cleanup);
    else this.#transaction(cleanup);
  }

  async #advance(
    runId: string,
    operationId: string,
    signal: AbortSignal,
    lease: OperationLease,
    repairCycles: Map<string, number> = new Map(),
    onActivity?: (event: WorkflowActivityUpdate) => void,
  ): Promise<Record<string, unknown>> {
    this.#transition(
      runId,
      "running",
      `${operationId}:running`,
      undefined,
      lease,
    );
    const run = this.#runStore.status(runId);
    emitWorkflowActivity(onActivity, {
      state: "running",
      stage: run.stage,
      runId,
      ...(run.change ? { change: run.change } : {}),
      objective: run.change ? `change ${run.change}` : "workflow run",
      legalCommands: ["status", "cancel", "discard"],
    });
    const existingVerification = this.#engineRun(runId).verification_json;
    const repairStatus = existingVerification
      ? normalizeWorkflowVerificationStatus(
          JSON.parse(existingVerification) as unknown,
        )
      : undefined;
    const retainsRepairContext =
      repairStatus?.scope === "change-task-affected" &&
      repairStatus.attribution === "introduced" &&
      repairStatus.taskId !== undefined &&
      this.#tasks(runId).some(
        (task) =>
          task.task_id === repairStatus.taskId && task.state !== "verified",
      );
    if (!retainsRepairContext) {
      this.#setVerificationStatus(runId, null, lease);
    }
    const attempted = new Set<string>();
    let madeProgress = true;
    while (madeProgress && !signal.aborted) {
      madeProgress = false;
      const rows = this.#tasks(runId);
      const runnable: Array<{
        row: EngineTaskRow;
        before: string;
      }> = [];
      const selectedTaskIds = new Set<string>();
      for (const row of rows) {
        if (row.state === "verified" || attempted.has(row.task_id)) continue;
        if (!this.#dependenciesVerified(row, rows)) {
          if (row.state !== "pending") {
            this.#setTask(
              runId,
              row.task_id,
              {
                state: "pending",
                pauseCode: null,
                queuePosition: null,
              },
              lease,
            );
          }
          continue;
        }
        if (this.#hasConflict(row, this.#tasks(runId), selectedTaskIds)) {
          this.#queueTask(runId, row, lease);
          continue;
        }
        const before = `${row.state}:${row.phase}`;
        attempted.add(row.task_id);
        selectedTaskIds.add(row.task_id);
        runnable.push({ row, before });
      }
      const settled = await Promise.allSettled(
        runnable.map(({ row }) =>
          this.#runTask(runId, row, operationId, signal, lease, onActivity),
        ),
      );
      const rejected = settled.find(
        (outcome): outcome is PromiseRejectedResult =>
          outcome.status === "rejected",
      );
      if (rejected) throw rejected.reason;
      for (const { row, before } of runnable) {
        const after = this.#tasks(runId).find(
          (candidate) => candidate.task_id === row.task_id,
        );
        if (after && `${after.state}:${after.phase}` !== before) {
          madeProgress = true;
        }
      }
    }

    if (signal.aborted) {
      const current = this.#runStore.status(runId);
      if (!["paused", "discarded", "completed"].includes(current.state)) {
        this.#transition(
          runId,
          "paused",
          `${operationId}:cancelled`,
          "operation-cancelled",
          lease,
        );
      }
      return this.#statusByRun(runId);
    }
    const rows = this.#tasks(runId);
    const paused = this.#firstPaused(rows);
    if (paused) {
      this.#transition(
        runId,
        paused.state === "approval-needed" ? "approval-needed" : "paused",
        `${operationId}:task-paused:${paused.task_id}`,
        paused.pause_code ?? "task-paused",
        lease,
      );
      return this.#statusByRun(runId);
    }
    if (rows.every((row) => row.state === "verified")) {
      return this.#finishChange(
        runId,
        operationId,
        signal,
        lease,
        repairCycles,
        onActivity,
      );
    }
    this.#transition(
      runId,
      "paused",
      `${operationId}:scheduler-stalled`,
      "scheduler-integrity-paused",
      lease,
    );
    return this.#statusByRun(runId);
  }

  #statusByRun(runId: string): Record<string, unknown> {
    const projection = this.#runStore.status(runId);
    const rows = this.#tasks(runId);
    const queued = rows
      .filter((row) => row.state === "queued")
      .sort(
        (left, right) =>
          (left.queue_position ?? Number.MAX_SAFE_INTEGER) -
            (right.queue_position ?? Number.MAX_SAFE_INTEGER) ||
          left.task_order - right.task_order,
      );
    const firstPaused = this.#firstPaused(rows);
    let engineRun: EngineRunRow | undefined;
    try {
      engineRun = this.#engineRun(runId);
    } catch {
      engineRun = undefined;
    }
    const contextRequest = firstPaused?.context_request_json
      ? normalizeWorkflowContextRequest(
          JSON.parse(firstPaused.context_request_json) as unknown,
        )
      : undefined;
    const pauseCode =
      projection.state === "approval-needed" &&
      firstPaused?.state === "approval-needed"
        ? (firstPaused.pause_code ?? projection.pauseCode ?? "task-paused")
        : (projection.pauseCode ?? firstPaused?.pause_code ?? "task-paused");
    const approval =
      projection.state === "approval-needed"
        ? approvalRequirement(pauseCode, contextRequest)
        : undefined;
    const currentRevision = projection.deliveryRevision ?? 0;
    return {
      runId: projection.runId,
      stage: projection.stage,
      ...(projection.change ? { change: projection.change } : {}),
      state: projection.state,
      ...(projection.deliveryRevision === undefined
        ? {}
        : { deliveryRevision: projection.deliveryRevision }),
      ...(projection.deliveryBindings.length > 0
        ? { deliveryBindings: structuredClone(projection.deliveryBindings) }
        : {}),
      completed: projection.state === "completed",
      ...(projection.terminal ? { terminal: projection.terminal } : {}),
      ...(projection.pauseCode || firstPaused?.pause_code
        ? {
            pause: {
              code: pauseCode,
            },
          }
        : {}),
      legalCommands:
        projection.state === "approval-needed"
          ? ["status", "discard"]
          : legalControlCommands(projection.state).filter(
              (command) => command !== "rebind" || firstPaused !== undefined,
            ),
      ...(approval && projection.change
        ? {
            approval: {
              category: approval.category,
              requiredGates: approval.requiredGates,
              refs: approval.refs,
              designRequest: `/abel-design --change ${projection.change}`,
              retainedRun: {
                runId: projection.runId,
                deliveryRevision: currentRevision,
              },
              receiptPrecondition: {
                deliveryRevision: { greaterThan: currentRevision },
                receiptHash: "matching-ready-receipt",
              },
            },
            conditionalCommands: [
              {
                command: "resume",
                stage: "abel-implement",
                change: projection.change,
                requires: {
                  deliveryRevision: { greaterThan: currentRevision },
                  receiptHash: "matching-ready-receipt",
                },
              },
            ],
          }
        : {}),
      tasks: rows.map((row) => ({
        taskId: row.task_id,
        state: row.state,
        ...(row.state === "verified" ? {} : { phase: row.phase }),
        ...(row.context_request_json
          ? {
              contextRequest: normalizeWorkflowContextRequest(
                JSON.parse(row.context_request_json) as unknown,
              ),
            }
          : {}),
      })),
      queue: queued.map((row, index) => ({
        taskId: row.task_id,
        position: index + 1,
        reason: "conflict",
      })),
      ...(engineRun?.verification_json
        ? {
            verification: normalizeWorkflowVerificationStatus(
              JSON.parse(engineRun.verification_json) as unknown,
            ),
          }
        : {}),
      ...(engineRun?.delivery_diagnostics_json
        ? {
            delivery: {
              code: "delivery-invalid",
              diagnostics: parseDeliveryDiagnostics(
                engineRun.delivery_diagnostics_json,
              ),
            },
          }
        : {}),
      ...(engineRun?.route_id
        ? {
            routeBinding: {
              routeId: engineRun.route_id,
              ...(engineRun.route_fingerprint
                ? { routeFingerprint: engineRun.route_fingerprint }
                : {}),
            },
          }
        : {}),
      ...(engineRun?.cleanup_state === "retained"
        ? {
            privateData: {
              retained: true,
              cleanup: "retained",
              ...(engineRun.baseline_workspace_revision
                ? {
                    baselineRevisionId: engineRun.baseline_workspace_revision,
                  }
                : {}),
              ...(engineRun.current_workspace_revision
                ? {
                    currentRevisionId: engineRun.current_workspace_revision,
                  }
                : {}),
            },
          }
        : engineRun?.cleanup_state === "complete"
          ? {
              privateData: {
                retained: false,
                cleanup: "complete",
              },
            }
          : {}),
    };
  }

  async #withAvailableDelivery(
    outcome: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (
      outcome.stage !== "abel-implement" ||
      outcome.state !== "approval-needed" ||
      typeof outcome.change !== "string" ||
      !this.#deliverySource.discoverLatest
    ) {
      return outcome;
    }
    let available: WorkflowAvailableDelivery | undefined;
    try {
      available = await this.#deliverySource.discoverLatest({
        stage: "abel-implement",
        change: outcome.change,
      });
    } catch {
      return outcome;
    }
    const currentRevision =
      typeof outcome.deliveryRevision === "number"
        ? outcome.deliveryRevision
        : 0;
    if (
      !available ||
      !Number.isSafeInteger(available.deliveryRevision) ||
      available.deliveryRevision <= currentRevision ||
      !SHA256.test(available.receiptHash)
    ) {
      return outcome;
    }
    const conditionalCommands = Array.isArray(outcome.conditionalCommands)
      ? outcome.conditionalCommands.map((entry) =>
          isRecord(entry) && entry.command === "resume"
            ? {
                ...entry,
                satisfiedBy: {
                  deliveryRevision: available.deliveryRevision,
                  receiptHash: available.receiptHash,
                },
              }
            : entry,
        )
      : outcome.conditionalCommands;
    return {
      ...outcome,
      legalCommands: ["status", "resume", "discard"],
      availableDelivery: structuredClone(available),
      ...(conditionalCommands === undefined ? {} : { conditionalCommands }),
    };
  }

  #launchAdvance(
    runId: string,
    operationId: string,
    externalSignal?: AbortSignal,
    onActivity?: (event: WorkflowActivityUpdate) => void,
  ): Promise<Record<string, unknown>> {
    const lease = this.#operationLease(runId, operationId);
    const controller = new AbortController();
    const abortFromExternal = () => {
      controller.abort(
        externalSignal?.reason ?? new Error("operation-cancelled"),
      );
    };
    if (externalSignal?.aborted) abortFromExternal();
    else
      externalSignal?.addEventListener("abort", abortFromExternal, {
        once: true,
      });
    const active: ActiveOperation = {
      operationId,
      kind: "work",
      controller,
      settled: Promise.resolve({}),
    };
    this.#active.set(runId, active);
    const settled = (async () => {
      try {
        const outcome = await this.#advance(
          runId,
          operationId,
          controller.signal,
          lease,
          new Map(),
          onActivity,
        );
        return this.#commitOperation(runId, operationId, outcome);
      } catch (error) {
        this.#interruptOperation(runId, operationId);
        const controlSettled =
          controller.signal.aborted &&
          controller.signal.reason instanceof Error &&
          ["operation-cancelled", "run-discarded"].includes(
            controller.signal.reason.message,
          ) &&
          (isCancellationException(error, controller.signal) ||
            (error instanceof Error &&
              ["lease-fenced", "operation-journal-fenced"].includes(
                error.message,
              )));
        if (controlSettled) return this.#statusByRun(runId);
        throw error;
      } finally {
        externalSignal?.removeEventListener("abort", abortFromExternal);
        if (this.#active.get(runId) === active) this.#active.delete(runId);
      }
    })();
    active.settled = settled;
    return settled;
  }

  async #start(
    command: Extract<ControlCommand, { command: "start" }>,
    signal?: AbortSignal,
    onActivity?: (event: WorkflowActivityUpdate) => void,
  ) {
    const existingRun = this.#lookupRun(command.stage, command.change);
    if (existingRun) {
      this.#ensureEngineRun(existingRun);
      const replay = this.#operationReplay(
        existingRun,
        command.operationId,
        command.command,
      );
      if (replay) return replay;
      const restarted = this.#runStore.startRun({
        stage: command.stage,
        change: command.change,
        operationId: command.operationId,
      });
      if (restarted.state !== "created") {
        const begun = this.#beginOperation(
          existingRun,
          command.operationId,
          command.command,
        );
        if (begun) return begun;
        return this.#commitOperation(
          existingRun,
          command.operationId,
          this.#statusByRun(existingRun),
        );
      }
    }

    const runId =
      existingRun ??
      this.#runStore.startRun({
        stage: command.stage,
        change: command.change,
        operationId: command.operationId,
      }).runId;
    this.#ensureEngineRun(runId);
    const begun = this.#beginOperation(
      runId,
      command.operationId,
      command.command,
    );
    if (begun) return begun;
    const lease = this.#operationLease(runId, command.operationId);
    this.#transition(
      runId,
      "validating-delivery",
      `${command.operationId}:validating-delivery`,
      undefined,
      lease,
    );
    emitWorkflowActivity(onActivity, {
      state: "validating",
      stage: command.stage,
      runId,
      change: command.change,
      objective: `validate delivery ${command.change}`,
      legalCommands: ["status", "cancel", "discard"],
    });
    try {
      const delivery = await this.#loadDelivery(command.stage, command.change);
      this.#admitDelivery(runId, delivery, lease);
      this.#transition(
        runId,
        "ready",
        `${command.operationId}:delivery-ready`,
        undefined,
        lease,
      );
      return this.#launchAdvance(
        runId,
        command.operationId,
        signal,
        onActivity,
      );
    } catch (error) {
      const failure = this.#deliveryFailure(
        runId,
        command.operationId,
        error,
        lease,
      );
      if (failure) {
        return this.#commitOperation(runId, command.operationId, failure);
      }
      this.#interruptOperation(runId, command.operationId);
      throw error;
    }
  }

  async #resume(
    command: Extract<ControlCommand, { command: "resume" }>,
    signal?: AbortSignal,
    onActivity?: (event: WorkflowActivityUpdate) => void,
  ) {
    const runId = this.#lookupRun(command.stage, command.change);
    if (!runId) throw new Error("run-not-found");
    this.#recoverLegacyContextApproval(runId);
    const replay = this.#beginOperation(
      runId,
      command.operationId,
      command.command,
    );
    if (replay) return replay;
    const lease = this.#operationLease(runId, command.operationId);
    const current = this.#runStore.status(runId);
    if (current.state === "recovering") {
      emitWorkflowActivity(onActivity, {
        state: "recovering",
        stage: current.stage,
        runId,
        ...(current.change ? { change: current.change } : {}),
        objective: current.change
          ? `recover change ${current.change}`
          : "recover workflow application",
        legalCommands: ["status", "cancel", "discard"],
      });
      const transactionId = this.#engineRun(runId).transaction_id;
      if (!transactionId || !this.#application) {
        this.#interruptOperation(runId, command.operationId);
        throw new Error("apply-recovery-unavailable");
      }
      const recovered = await this.#application.recover(
        transactionId,
        this.#applicationContext(runId),
      );
      this.#runStore.assertLease(lease);
      const outcome = this.#settleApplication(
        runId,
        command.operationId,
        recovered,
        lease,
        onActivity,
      );
      return this.#commitOperation(runId, command.operationId, outcome);
    }
    if (
      !["paused", "retryable", "approval-needed", "ready"].includes(
        current.state,
      )
    ) {
      this.#interruptOperation(runId, command.operationId);
      throw new Error("resume-not-allowed");
    }
    try {
      const engineRevision = this.#engineRun(runId).current_revision;
      const projectedRevision = current.deliveryRevision;
      const deliveryOutOfSync =
        projectedRevision !== undefined && projectedRevision !== engineRevision;
      if (
        current.state === "approval-needed" &&
        (command.deliveryRevision === undefined ||
          command.receiptHash === undefined ||
          command.deliveryRevision <=
            (engineRevision ?? projectedRevision ?? 0))
      ) {
        this.#interruptOperation(runId, command.operationId);
        throw new Error("approval-receipt-required");
      }
      if (
        command.deliveryRevision !== undefined ||
        engineRevision === null ||
        deliveryOutOfSync
      ) {
        this.#transition(
          runId,
          "validating-delivery",
          `${command.operationId}:validating-delivery`,
          undefined,
          lease,
        );
        emitWorkflowActivity(onActivity, {
          state: "validating",
          stage: command.stage,
          runId,
          change: command.change,
          objective: `validate delivery ${command.change}`,
          legalCommands: ["status", "cancel", "discard"],
        });
        const requestedRevision =
          command.deliveryRevision ??
          (deliveryOutOfSync ? projectedRevision : undefined);
        const projectedBinding = current.deliveryBindings.find(
          (binding) =>
            binding.gate === "gate-b" && binding.revision === requestedRevision,
        );
        const delivery = await this.#loadDelivery(
          command.stage,
          command.change,
          requestedRevision,
          command.receiptHash ?? projectedBinding?.receiptHash,
        );
        this.#admitDelivery(runId, delivery, lease);
        this.#transition(
          runId,
          "ready",
          `${command.operationId}:delivery-ready`,
          undefined,
          lease,
        );
      } else if (current.state !== "ready") {
        this.#transition(
          runId,
          "ready",
          `${command.operationId}:resume-ready`,
          undefined,
          lease,
        );
      }
      return this.#launchAdvance(
        runId,
        command.operationId,
        signal,
        onActivity,
      );
    } catch (error) {
      const failure = this.#deliveryFailure(
        runId,
        command.operationId,
        error,
        lease,
      );
      if (failure) {
        return this.#commitOperation(runId, command.operationId, failure);
      }
      this.#interruptOperation(runId, command.operationId);
      throw error;
    }
  }

  #rebind(command: Extract<ControlCommand, { command: "rebind" }>) {
    const runId = this.#lookupRun(command.stage, command.change);
    if (!runId) throw new Error("run-not-found");
    const replay = this.#beginOperation(
      runId,
      command.operationId,
      command.command,
    );
    if (replay) return replay;
    const lease = this.#operationLease(runId, command.operationId);
    const state = this.#runStore.status(runId).state;
    if (!["paused", "retryable"].includes(state)) {
      this.#interruptOperation(runId, command.operationId);
      throw new Error("rebind-not-allowed");
    }
    const task = this.#tasks(runId).find((row) =>
      ["paused", "retryable"].includes(row.state),
    );
    if (!task) {
      this.#interruptOperation(runId, command.operationId);
      throw new Error("rebind-task-unavailable");
    }
    const rebound = this.#worker.rebind({
      runId,
      taskId: task.task_id,
      role: "implementation-worker",
      routeId: command.routeId,
    });
    if (!rebound.ok) {
      this.#interruptOperation(runId, command.operationId);
      throw new Error(rebound.code);
    }
    const routeId = rebound.routeId ?? rebound.route?.id ?? command.routeId;
    const routeFingerprint =
      rebound.routeFingerprint ?? rebound.route?.fingerprint;
    if (
      !IDENTIFIER.test(routeId) ||
      (routeFingerprint !== undefined && !SHA256.test(routeFingerprint))
    ) {
      this.#interruptOperation(runId, command.operationId);
      throw new Error("route-rebind-result-invalid");
    }
    const priorRouteId = task.route_id ?? this.#engineRun(runId).route_id;
    const priorRouteFingerprint =
      task.route_fingerprint ?? this.#engineRun(runId).route_fingerprint;
    this.#leasedTransaction(lease, () => {
      this.#setTask(runId, task.task_id, {
        routeId,
        routeFingerprint: routeFingerprint ?? null,
      });
      this.#database
        .prepare(
          `UPDATE workflow_engine_runs
           SET route_id = ?, route_fingerprint = ? WHERE run_id = ?`,
        )
        .run(routeId, routeFingerprint ?? null, runId);
    });
    const outcome = {
      ...this.#statusByRun(runId),
      routeBinding: {
        routeId,
        ...(routeFingerprint ? { routeFingerprint } : {}),
      },
      operation: {
        kind: "route-rebound",
        ...(priorRouteId ? { priorRouteId } : {}),
        ...(priorRouteFingerprint ? { priorRouteFingerprint } : {}),
        routeId,
        ...(routeFingerprint ? { routeFingerprint } : {}),
      },
    };
    return this.#commitOperation(runId, command.operationId, outcome);
  }

  async #controlApply(
    runId: string,
    operationId: string,
    intent: "cancel" | "discard",
    lease: OperationLease,
    onActivity?: (event: WorkflowActivityUpdate) => void,
  ): Promise<Record<string, unknown>> {
    const transactionId = this.#engineRun(runId).transaction_id;
    if (!transactionId || !this.#application) {
      throw new Error("apply-recovery-unavailable");
    }
    const context = this.#applicationContext(runId);
    this.#application.requestControl(transactionId, intent, context);
    const active = this.#active.get(runId);
    if (active && active.operationId !== operationId) {
      active.controller.abort(
        new Error(
          intent === "cancel" ? "operation-cancelled" : "run-discarded",
        ),
      );
    }
    if (this.#runStore.status(runId).state === "applying") {
      this.#transition(
        runId,
        "recovering",
        `${operationId}:${intent}-recovering`,
        intent === "cancel" ? "operation-cancelled" : "run-discarded",
        lease,
      );
      const recovering = this.#runStore.status(runId);
      emitWorkflowActivity(onActivity, {
        state: "recovering",
        stage: recovering.stage,
        runId,
        ...(recovering.change ? { change: recovering.change } : {}),
        objective: recovering.change
          ? `recover change ${recovering.change}`
          : "recover workflow application",
        code: intent === "cancel" ? "operation-cancelled" : "run-discarded",
        legalCommands: ["status"],
      });
    }
    const recovered = await this.#application.recover(transactionId, context);
    this.#runStore.assertLease(lease);
    return this.#settleApplication(
      runId,
      operationId,
      recovered,
      lease,
      onActivity,
    );
  }

  async #abortActiveOperation(runId: string, reason: Error): Promise<void> {
    const active = this.#active.get(runId);
    if (!active) return;
    active.controller.abort(reason);
    try {
      await active.settled;
    } catch (error) {
      const fenced =
        error instanceof Error &&
        ["lease-fenced", "operation-journal-fenced"].includes(error.message);
      if (
        !fenced &&
        !isCancellationException(error, active.controller.signal)
      ) {
        throw error;
      }
    }
  }

  async #cancel(
    command: Extract<ControlCommand, { command: "cancel" }>,
    onActivity?: (event: WorkflowActivityUpdate) => void,
  ) {
    const runId = this.#lookupRun(command.stage, command.change);
    if (!runId) throw new Error("run-not-found");
    const replay = this.#beginOperation(
      runId,
      command.operationId,
      command.command,
    );
    if (replay) return replay;
    const lease = this.#operationLease(runId, command.operationId);
    const state = this.#runStore.status(runId).state;
    let outcome: Record<string, unknown>;
    if (state === "applying" || state === "recovering") {
      outcome = await this.#controlApply(
        runId,
        command.operationId,
        "cancel",
        lease,
        onActivity,
      );
    } else {
      const activeSettlement = this.#abortActiveOperation(
        runId,
        new Error("operation-cancelled"),
      );
      const current = this.#runStore.status(runId);
      if (
        !["paused", "discarded", "completed", "rejected"].includes(
          current.state,
        )
      ) {
        this.#transition(
          runId,
          "paused",
          `${command.operationId}:cancelled`,
          "operation-cancelled",
          lease,
        );
      }
      outcome = this.#statusByRun(runId);
      await activeSettlement;
    }
    outcome = {
      ...outcome,
      operation: { kind: "operation-cancelled" },
    };
    return this.#commitOperation(runId, command.operationId, outcome);
  }

  async #discard(
    command: Extract<ControlCommand, { command: "discard" }>,
    onActivity?: (event: WorkflowActivityUpdate) => void,
  ) {
    const runId = this.#lookupRun(command.stage, command.change);
    if (!runId) throw new Error("run-not-found");
    const replay = this.#beginOperation(
      runId,
      command.operationId,
      command.command,
    );
    if (replay) return replay;
    const lease = this.#operationLease(runId, command.operationId);
    const state = this.#runStore.status(runId).state;
    let outcome: Record<string, unknown>;
    if (state === "applying" || state === "recovering") {
      outcome = await this.#controlApply(
        runId,
        command.operationId,
        "discard",
        lease,
        onActivity,
      );
    } else {
      const activeSettlement = this.#abortActiveOperation(
        runId,
        new Error("run-discarded"),
      );
      const current = this.#runStore.status(runId);
      if (current.state !== "discarded") {
        if (["completed", "rejected"].includes(current.state)) {
          this.#interruptOperation(runId, command.operationId);
          throw new Error("discard-not-allowed");
        }
        this.#transition(
          runId,
          "discarded",
          `${command.operationId}:discarded`,
          undefined,
          lease,
        );
        await activeSettlement;
        this.#cleanupTerminal(runId, command.operationId, lease);
      } else {
        await activeSettlement;
      }
      outcome = this.#statusByRun(runId);
    }
    return this.#commitOperation(runId, command.operationId, outcome);
  }

  async execute(
    value: unknown,
    signal?: AbortSignal,
    onActivity?: (event: WorkflowActivityUpdate) => void,
  ): Promise<Record<string, unknown>> {
    this.#assertOpen();
    const command = assertControlCommand(value);
    switch (command.command) {
      case "start":
        return this.#withAvailableDelivery(
          await this.#start(command, signal, onActivity),
        );
      case "status": {
        const runId = this.#lookupRun(command.stage, command.change);
        if (!runId) {
          return {
            stage: command.stage,
            change: command.change,
            state: "not-started",
            durable: true,
            completed: false,
            legalCommands: ["start"],
            tasks: [],
            queue: [],
          };
        }
        this.#recoverLegacyContextApproval(runId);
        return this.#withAvailableDelivery(this.#statusByRun(runId));
      }
      case "resume":
        return this.#withAvailableDelivery(
          await this.#resume(command, signal, onActivity),
        );
      case "rebind":
        return this.#rebind(command);
      case "cancel":
        return this.#cancel(command, onActivity);
      case "discard":
        return this.#discard(command, onActivity);
    }
  }

  prepareBootstrapHandoff(
    input: Record<string, unknown>,
  ): Record<string, unknown> {
    this.#assertOpen();
    const acceptanceFacts = normalizeBootstrapAcceptanceFacts(
      input.acceptanceFacts,
    );
    const workspaceManifestHash =
      typeof input.workspaceManifestHash === "string" &&
      SHA256.test(input.workspaceManifestHash)
        ? input.workspaceManifestHash
        : undefined;
    if (
      typeof input.operationId !== "string" ||
      !IDENTIFIER.test(input.operationId) ||
      typeof input.runId !== "string" ||
      typeof input.change !== "string" ||
      !CHANGE_NAME.test(input.change) ||
      typeof input.receiptHash !== "string" ||
      !SHA256.test(input.receiptHash) ||
      typeof input.graphHash !== "string" ||
      !SHA256.test(input.graphHash) ||
      typeof input.acceptanceHash !== "string" ||
      !SHA256.test(input.acceptanceHash) ||
      (acceptanceFacts !== undefined) !==
        (workspaceManifestHash !== undefined) ||
      (acceptanceFacts !== undefined &&
        workspaceManifestHash !== undefined &&
        bootstrapAcceptanceHash(acceptanceFacts, workspaceManifestHash) !==
          input.acceptanceHash)
    ) {
      throw new Error("bootstrap-handoff-invalid");
    }
    this.#runStore.status(input.runId);
    const existing = this.#database
      .prepare(
        `SELECT handoff_id, owner_run_id, receipt_hash, state, facts_json
         FROM bootstrap_handoffs WHERE receipt_hash = ?`,
      )
      .get(input.receiptHash) as BootstrapRow | undefined;
    if (existing) {
      const outcome = parseJsonRecord(existing.facts_json);
      const existingAcceptanceFacts = normalizeBootstrapAcceptanceFacts(
        outcome.acceptanceFacts,
      );
      const storedBindingValid =
        outcome.handoffId === existing.handoff_id &&
        outcome.runId === existing.owner_run_id &&
        outcome.receiptHash === existing.receipt_hash &&
        outcome.selectorBeforeCutover === "bootstrap" &&
        existing.state === "prepared" &&
        outcome.state === "prepared" &&
        outcome.selectorCasPending === true;
      if (!storedBindingValid) throw new Error("bootstrap-handoff-invalid");
      const stableBindingMatches =
        existing.owner_run_id === input.runId &&
        outcome.change === input.change &&
        outcome.graphHash === input.graphHash;
      if (!stableBindingMatches) {
        throw new Error("bootstrap-handoff-conflict");
      }
      const acceptanceMatches =
        outcome.acceptanceHash === input.acceptanceHash &&
        canonicalJson(existingAcceptanceFacts ?? null) ===
          canonicalJson(acceptanceFacts ?? null) &&
        outcome.workspaceManifestHash === workspaceManifestHash;
      if (acceptanceMatches) return structuredClone(outcome);
      if (
        existing.state !== "prepared" ||
        outcome.state !== "prepared" ||
        outcome.selectorBeforeCutover !== "bootstrap" ||
        outcome.selectorCasPending !== true ||
        acceptanceFacts === undefined ||
        workspaceManifestHash === undefined
      ) {
        throw new Error("bootstrap-handoff-conflict");
      }
      const refreshedHandoffId = `handoff-${hash(
        input.runId,
        input.receiptHash,
        input.graphHash,
        input.acceptanceHash,
        workspaceManifestHash,
      ).slice(0, 40)}`;
      const refreshed = {
        ...outcome,
        handoffId: refreshedHandoffId,
        acceptanceHash: input.acceptanceHash,
        acceptanceFacts,
        workspaceManifestHash,
      };
      this.#transaction(() => {
        const result = this.#database
          .prepare(
            `UPDATE bootstrap_handoffs
             SET handoff_id = ?, facts_json = ?
             WHERE handoff_id = ? AND state = 'prepared' AND facts_json = ?`,
          )
          .run(
            refreshedHandoffId,
            JSON.stringify(refreshed),
            existing.handoff_id,
            existing.facts_json,
          );
        if (Number(result.changes) !== 1) {
          throw new Error("bootstrap-handoff-conflict");
        }
      });
      return structuredClone(refreshed);
    }
    const handoffId = `handoff-${hash(
      input.runId,
      input.receiptHash,
      input.graphHash,
      input.acceptanceHash,
      workspaceManifestHash ?? "acceptance-pending",
    ).slice(0, 40)}`;
    const outcome = {
      handoffId,
      state: "prepared",
      runId: input.runId,
      change: input.change,
      receiptHash: input.receiptHash,
      graphHash: input.graphHash,
      acceptanceHash: input.acceptanceHash,
      ...(acceptanceFacts ? { acceptanceFacts } : {}),
      ...(workspaceManifestHash ? { workspaceManifestHash } : {}),
      selectorBeforeCutover: "bootstrap",
      selectorCasPending: true,
    };
    const preparedRows = this.#database
      .prepare(
        `SELECT handoff_id, owner_run_id, receipt_hash, state, facts_json
         FROM bootstrap_handoffs WHERE state = 'prepared'
         ORDER BY handoff_id`,
      )
      .all() as unknown as BootstrapRow[];
    if (preparedRows.length > 0) throw new Error("bootstrap-handoff-conflict");
    this.#transaction(() => {
      this.#database
        .prepare(
          `INSERT INTO bootstrap_handoffs(
             handoff_id, owner_run_id, receipt_hash, state, facts_json
           ) VALUES (?, ?, ?, 'prepared', ?)`,
        )
        .run(
          handoffId,
          String(input.runId),
          String(input.receiptHash),
          JSON.stringify(outcome),
        );
    });
    return structuredClone(outcome);
  }

  inspectBootstrapHandoff(receiptHash: string): Record<string, unknown> {
    this.#assertOpen();
    if (!SHA256.test(receiptHash)) throw new Error("bootstrap-handoff-invalid");
    const row = this.#database
      .prepare(
        `SELECT facts_json FROM bootstrap_handoffs WHERE receipt_hash = ?`,
      )
      .get(receiptHash) as { facts_json: string } | undefined;
    if (!row) throw new Error("bootstrap-handoff-not-found");
    return parseJsonRecord(row.facts_json);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    if (this.#orphanRecoveryTimer) {
      clearTimeout(this.#orphanRecoveryTimer);
      this.#orphanRecoveryTimer = undefined;
    }
    const active = [...this.#active.values()];
    for (const operation of active) {
      operation.controller.abort(new Error("workflow-engine-closed"));
    }
    await Promise.allSettled(active.map((operation) => operation.settled));
    this.#lifecycle?.close?.();
    this.#database.close();
    this.#runStore.close();
    this.#closed = true;
  }
}

export function openDurableWorkflowEngine(
  options: DurableWorkflowEngineOptions,
): WorkflowEngine {
  const composition = new DurableWorkflowComposition(options);
  return WorkflowEngine.open({
    consumerRoot: options.consumerRoot,
    stateRoot: options.stateRoot,
    deliverySource: options.deliverySource,
    worker: composition,
    changeVerifier: composition,
    application: composition,
    lifecycle: composition,
    ...(options.now ? { now: options.now } : {}),
    ...(options.leaseTtlMs !== undefined
      ? { leaseTtlMs: options.leaseTtlMs }
      : {}),
  });
}
