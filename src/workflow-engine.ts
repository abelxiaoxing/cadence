// Stable package-private facade. Only WorkflowEngine owns state transitions.

export {
  type DurableChangeVerificationResult,
  type DurablePhaseVerificationResult,
  type DurableWorkflowEngineOptions,
  openDurableWorkflowEngine,
} from "./durable-workflow.ts";
export type {
  DurableCandidateProposal,
  DurableVerificationScope,
} from "./workflow-policy.ts";
export {
  APPROVAL_AUTHORITY_CATEGORIES,
  type ApprovalAuthorityCategory,
  type WorkflowApplication,
  type WorkflowApplicationContext,
  type WorkflowApprovalCode,
  type WorkflowAttemptOutcome,
  type WorkflowAvailableDelivery,
  type WorkflowChangeVerifier,
  type WorkflowDelivery,
  type WorkflowDeliverySource,
  type WorkflowEngineOptions,
  type WorkflowRunLifecycle,
  type WorkflowWorker,
} from "./workflow-policy.ts";
export { WorkflowEngine } from "./workflow-state-machine.ts";
