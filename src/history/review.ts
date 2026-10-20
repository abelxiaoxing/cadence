/** Human acknowledgment policy. No mutation of historical native/check facts. */
import type {
  CheckObligations,
  Issue,
  ObservationFact,
} from "../service-contract.ts";
import type { RunState } from "./run-state.ts";
export interface ReviewContext {
  checks: CheckObligations;
  observation: ObservationFact;
  /** Latest relevant executed selections, including native-local manual checks. */
  recorded?: CheckObligations["definitions"];
  /** Coverage of latest relevant check output, independent of native PASS. */
  recordingIncomplete: boolean;
}
export function reviewIssues(
  run: RunState,
  current: ReviewContext,
  code: boolean,
  epoch: string,
): Issue[] {
  const issues = new Set<Issue>();
  if (!current.observation.complete) issues.add("incomplete-observation");
  const projections = run.projections(epoch);
  if (projections.some((p) => p.outcome !== "completed"))
    issues.add("partial-results");
  if (
    projections.some(
      (p) =>
        p.coverage.observed !== "complete" ||
        p.coverage.source !== "complete" ||
        p.coverage.omissions.length,
    )
  )
    issues.add("recording-incomplete");
  if (code) {
    if (current.recordingIncomplete) issues.add("recording-incomplete");
    const recorded = current.recorded ?? [];
    if (
      !recorded.length ||
      current.checks.definitions.some((d) => d.status === "not-run")
    )
      issues.add("unrun-checks");
    const checks = [...current.checks.definitions, ...recorded];
    if (checks.some((c) => c.status === "stale")) issues.add("stale-checks");
    if (checks.some((c) => c.status === "failed" || c.status === "canceled"))
      issues.add("failed-checks");
  }
  return [...issues].sort();
}
