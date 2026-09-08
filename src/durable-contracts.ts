import type { ArtifactStore } from "./artifact-store.ts";
import type { StructuredVerificationContract } from "./contracts.ts";
import type { ImplementPlan, PlanTaskDraft } from "./delivery-compiler.ts";
import type { RoutePolicy, WorkerRoutePolicy } from "./route-policy.ts";

import type { ResolvedStateRoot } from "./state-root.ts";
import type { CandidateArtifactSubmission } from "./submit-tool.ts";
import type { TaskLedger } from "./task-ledger.ts";

import type {
  DurableCandidateProposal,
  DurableVerificationScope,
  RedArtifactCorrection,
  WorkflowAttemptOutcome,
  WorkflowContextRequest,
  WorkflowDeliverySource,
  WorkflowRecoveryFeedback,
} from "./workflow-policy.ts";

import type { WorkspaceStore } from "./workspace-store.ts";

export interface DurableResourceInput {
  runId: string;
  deliveryRevision: number;
  plan?: ImplementPlan;
  baselineRevisionId?: string;
  currentWorkspaceRevisionId?: string;
}

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
      attributionReliable?: boolean;
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
      attributionReliable?: boolean;
    };

export interface DurableVerificationObservation {
  status: "passed" | "failed";
  verificationId: string;
  failureIdentities: string[];
  code?: string;
  attributionReliable?: boolean;
}

export interface DurableVerificationBaseline {
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

export type DurableObservedVerification =
  | { ok: true; observation: DurableVerificationObservation }
  | {
      ok: false;
      outcome:
        | { kind: "paused"; code: string }
        | { kind: "approval-needed"; code: string }
        | { kind: "operation-cancelled"; code: "cancelled" };
    };

export type DurableBaselineResult =
  | { ok: true; baseline: DurableVerificationBaseline }
  | Extract<DurableObservedVerification, { ok: false }>;

export type DurableAffectedResult =
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
    contextRequest?: WorkflowContextRequest;
    contextReadPaths?: string[];
    recoveryFeedback?: WorkflowRecoveryFeedback;
    signal: AbortSignal;
    onRequestStart?(): void;
    onHeaders(): void;
    onProgress(): void;
  }): Promise<DurableCandidateProposal>;
  verifyPhase(input: {
    executionWritePaths?: readonly string[];
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
  workHardLimit?: number;
  verificationPolicy?: string;
  verificationEnvironment?(
    plan: ImplementPlan,
    signal: AbortSignal,
  ): Promise<string>;
}

export interface DurableExecutionResources {
  runId: string;
  root: string;
  plan: ImplementPlan;
  deliveryRevision: number;
  artifacts: ArtifactStore;
  workspaces: WorkspaceStore;
  ledgers: Map<number, TaskLedger>;
  baselineRevisionId: string;
  currentRevisionId: string;
  mergeTail: Promise<void>;
  verificationFact?: object;
  baselinePromises: Map<number, Promise<DurableBaselineResult>>;
  environmentIdentity?: string;
}

export interface DurablePhaseFact {
  kind: "phase-verified" | "repair-verified";
  phase: "red" | "green" | "refactor";
  isolatedRevisionId: string;
  outputFacts: Array<
    | { path: string; kind: "absent" }
    | { path: string; kind: "file"; hash: string; bytes: number }
  >;
}

export interface DurableCandidateCommit {
  artifactHash: string;
  isolatedRevisionId: string;
  exitCode: number;
  classification: "expected-red" | "expected-green" | "expected-refactor";
  diagnostic: { kind: "assertion" | "compiler"; id: string };
  outputFacts: DurablePhaseFact["outputFacts"];
  routeId: string;
  routeFingerprint: string;
}

export type DurableRepairResult =
  | { kind: "repair-committed"; commit: DurableCandidateCommit }
  | Exclude<WorkflowAttemptOutcome, { kind: "phase-committed" }>;
export type PhaseResources = Omit<
  DurableExecutionResources,
  "verificationFact"
>;
