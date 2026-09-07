import type { ImplementPlan } from "./implement-plan.ts";

export type RecoveryActionRequest = {
  kind: "affected-repair" | "cumulative-repair" | "red-correction";
  attempt: number;
};
export type RecoveryActionDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: "repair-attempts-exhausted" | "artifact-attempts-exhausted";
    };

/** One policy for every nested recovery action; execution services supply facts only. */
export function decideRecoveryAction(
  plan: ImplementPlan,
  request: RecoveryActionRequest,
  authority: { additionalAttempt?: boolean; verificationOnly?: boolean } = {},
): RecoveryActionDecision {
  const correction = request.kind === "red-correction";
  const limit =
    authority.additionalAttempt || authority.verificationOnly
      ? 1
      : correction
        ? plan.verification.artifactCorrection.maxAttempts
        : plan.verification.repair.maxAttempts;
  return Number.isSafeInteger(request.attempt) &&
    request.attempt > 0 &&
    request.attempt <= limit
    ? { allowed: true }
    : {
        allowed: false,
        code: correction
          ? "artifact-attempts-exhausted"
          : "repair-attempts-exhausted",
      };
}

export interface WorkflowRecoveryFeedback {
  code: string;
  attempt: number;
  maxAttempts: number;
  strategy:
    | "revise-candidate"
    | "refresh-candidate"
    | "repair-verification"
    | "compact-patch";
  failureIdentities?: string[];
}

export interface WorkflowRecoveryFact {
  key: string;
  failures: number;
  feedback: WorkflowRecoveryFeedback;
}

export function recoveryExhausted(
  incident: WorkflowRecoveryFact | undefined,
  maximum: number,
  granted: boolean,
): boolean {
  return !granted && incident !== undefined && incident.failures >= maximum;
}

/** A grant is a recommendation until the state machine validates and records it in its lease transaction. */
export function assessRecoveryGrant(input: {
  current: boolean;
  incident?: WorkflowRecoveryFact;
  failureSequence: number;
  requestedSequence: number;
  reason: string;
  previous: { route?: string | null; context?: string | null };
  observed: { route?: string | null; context?: string | null };
  budget?: { used: number; max_work: number };
}): string | undefined {
  if (
    !input.current ||
    !input.incident ||
    input.incident.failures < input.incident.feedback.maxAttempts ||
    input.failureSequence !== input.requestedSequence
  )
    return "recovery-request-stale";
  if (
    (input.reason === "route-changed" &&
      (!input.previous.route ||
        input.previous.route === input.observed.route)) ||
    (input.reason === "context-extended" &&
      (!input.previous.context ||
        input.previous.context === input.observed.context))
  )
    return "recovery-evidence-unavailable";
  if (!input.budget || input.budget.used >= input.budget.max_work)
    return "change-work-budget-exhausted";
  return undefined;
}
