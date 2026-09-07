import type { ImplementPlan } from "./implement-plan.ts";
import {
  deliveryBoundPaths,
  type EngineTaskRow,
  taskApprovalBoundary,
} from "./workflow-policy.ts";
/** Compare authority only; retained bytes still require executor currentness and replay. */
export function compareDeliveryRevision(
  priorPlan: ImplementPlan | undefined,
  nextPlan: ImplementPlan,
  priorRows: readonly Pick<EngineTaskRow, "task_id">[],
) {
  const priorTasks = new Map(
    (priorPlan?.tasks ?? []).map((task) => [task.taskId, task]),
  );
  const nextTasks = new Map(nextPlan.tasks.map((task) => [task.taskId, task]));
  const priorBoundPaths = new Set(
    priorPlan ? deliveryBoundPaths(priorPlan) : [],
  );
  const boundaryExpanded = deliveryBoundPaths(nextPlan).some(
    (relative) => !priorBoundPaths.has(relative),
  );
  const compatible = new Set<string>();
  if (priorPlan) {
    for (const [taskId, priorTask] of priorTasks) {
      const nextTask = nextTasks.get(taskId);
      if (
        nextTask &&
        taskApprovalBoundary(priorPlan, priorTask) ===
          taskApprovalBoundary(nextPlan, nextTask)
      ) {
        compatible.add(taskId);
      }
    }
  }
  const invalidated = new Set(
    priorRows
      .filter((row) => !compatible.has(row.task_id))
      .map((row) => row.task_id),
  );
  return { compatible, invalidated, boundaryExpanded };
}
