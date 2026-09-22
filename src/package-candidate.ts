import type { VerificationFailureSummary } from "./contracts.ts";
import type { DurableWorkflowEngineOptions } from "./durable-contracts.ts";
import type { ParentModelSource } from "./model-source.ts";
import { proposeProcessPackageCandidate } from "./package-candidate-process.ts";
import type { DurableCandidateProposal } from "./workflow-policy.ts";

/**
 * Parent-owned candidate adapter. The child only edits the disposable proposal
 * root; this function returns its bounded diff to the existing sealing and
 * verification pipeline.
 */
export function proposePackageCandidate(
  input: Parameters<DurableWorkflowEngineOptions["proposeCandidate"]>[0],
  context: ParentModelSource | undefined,
  implementationAgent: { content: string },
  verificationDiagnostics: VerificationFailureSummary[] = [],
): Promise<DurableCandidateProposal> {
  return proposeProcessPackageCandidate(
    input,
    context,
    implementationAgent,
    verificationDiagnostics,
  );
}
