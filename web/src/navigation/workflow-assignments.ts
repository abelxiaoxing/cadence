/** What a workflow run records about its assignments, for the chat line, the
 * workflow view's board and the subagent dock. Everything here is read from
 * the run: an older service that lists no assignments yields nothing. */
import type {
  DeliveryArtifact,
  WorkflowRun,
  WorkflowStep,
  WorkflowTaskState,
} from "../../../src/service/contracts/workflow.ts";
import type { MessageKey, Translator } from "../i18n/locale";

/** A workflow step ID is `<assignment>-<uuid>`, and a review assignment is
 * itself `review-<uuid>`; the assignment without its suffixes is the readable part. */
export function workflowAgentLabel(stepId: string) {
  return stepId.replace(
    /(?:-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})+$/i,
    "",
  );
}

export type AssignmentState = WorkflowTaskState["state"];
export type AssignmentCounts = Readonly<Record<AssignmentState, number>>;
/** How many of the agreement's assignments are in each state; null when the
 * run lists none. */
export function assignmentCounts(run: WorkflowRun): AssignmentCounts | null {
  if (!run.tasks?.length) return null;
  const counts = { queued: 0, running: 0, completed: 0, failed: 0 };
  for (const task of run.tasks) counts[task.state] += 1;
  return counts;
}
const COUNT_TEXT: readonly (readonly [AssignmentState, MessageKey])[] = [
  ["running", "{count} running"],
  ["queued", "{count} queued"],
  ["completed", "{count} done"],
  ["failed", "{count} failed"],
];
/** "2 running · 1 queued · 3 done": states with none are left out. */
export function describeCounts(
  counts: AssignmentCounts,
  t: Translator["t"],
): string {
  return COUNT_TEXT.filter(([state]) => counts[state] > 0)
    .map(([state, text]) => t(text, { count: counts[state] }))
    .join(" · ");
}
/** The counts a live run's chat line shows in place of step names: only while
 * assignments are still queued or running, and only once they run side by
 * side (several at once, or one in its own worktree). */
export function sideBySideCounts(run: WorkflowRun): AssignmentCounts | null {
  const counts = assignmentCounts(run);
  if (!counts || counts.queued + counts.running === 0) return null;
  return counts.running > 1 || (run.delivery?.artifacts?.length ?? 0) > 0
    ? counts
    : null;
}

/** One assignment on the board: where it stands, the listed steps that carry
 * its ID as their label, and its own worktree when it ran beside others. */
export interface AssignmentRow {
  task: WorkflowTaskState;
  steps: WorkflowStep[];
  artifact?: DeliveryArtifact;
}
export function assignmentRows(
  run: WorkflowRun,
  steps: readonly WorkflowStep[] = run.steps,
): AssignmentRow[] {
  return (run.tasks ?? []).map((task) => {
    const artifact = run.delivery?.artifacts?.findLast(
      (entry) => entry.id === task.id,
    );
    return {
      task,
      steps: steps.filter((step) => workflowAgentLabel(step.id) === task.id),
      ...(artifact ? { artifact } : {}),
    };
  });
}

const LIVE: readonly string[] = ["queued", "running"];
/** The subagent dock's rows, one group per run that has subagents (steps with
 * a child run): the newest run first and its newest agent first, with live
 * agents, and runs that have one, above settled ones. */
export function dockGroups(
  ids: readonly string[],
  runs: ReadonlyMap<string, WorkflowRun>,
): { run: WorkflowRun; steps: WorkflowStep[] }[] {
  const settled = (status: string) => Number(!LIVE.includes(status));
  return [...new Set(ids)]
    .flatMap((id) => {
      const run = runs.get(id);
      const steps = (run?.steps.filter((step) => step.childRunId) ?? [])
        .reverse()
        .sort((a, b) => settled(a.status) - settled(b.status));
      return run && steps.length ? [{ run, steps }] : [];
    })
    .reverse()
    .sort((a, b) => settled(a.steps[0].status) - settled(b.steps[0].status));
}

/** Whether a recorded deviation set this check step aside: it ran and failed,
 * and stopped gating acceptance. The acceptance record lists such steps; a
 * delivery without one (direct working-copy) lists a round's checks in its
 * verification, where a failed check can only be one a deviation names. */
export function checkSetAside(run: WorkflowRun, step: WorkflowStep): boolean {
  if (step.kind !== "check") return false;
  if (run.delivery?.acceptance?.waived?.includes(step.id)) return true;
  return (
    step.status === "failed" &&
    !!run.verification?.steps.includes(step.id) &&
    (run.deviations ?? []).some((deviation) =>
      deviation.waives.includes(workflowAgentLabel(step.id)),
    )
  );
}
