import type { PlanTaskDraft } from "./implement-plan.ts";
import { type EngineTaskRow, taskConflicts } from "./workflow-policy.ts";

function taskPlan(row: EngineTaskRow): PlanTaskDraft {
  return JSON.parse(row.plan_json) as PlanTaskDraft;
}
export function hasTaskConflict(
  row: EngineTaskRow,
  rows: EngineTaskRow[],
  selectedTaskIds: ReadonlySet<string>,
): boolean {
  const candidate = taskPlan(row);
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
    if (other.state === "pending" && !dependenciesVerified(other, rows)) {
      return false;
    }
    const conflict = taskConflicts(candidate, taskPlan(other));
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

export function dependenciesVerified(
  row: EngineTaskRow,
  rows: EngineTaskRow[],
): boolean {
  const byId = new Map(rows.map((candidate) => [candidate.task_id, candidate]));
  return taskPlan(row).dependsOn.every(
    (dependency) => byId.get(dependency)?.state === "verified",
  );
}

/** Simulate ordered queue decisions without storage access or launch authority. */
export function selectRunnableTasks(input: {
  rows: readonly EngineTaskRow[];
  attempted: ReadonlySet<string>;
  activeTasks: number;
  capacity: number;
  nextQueuePosition: number;
}) {
  const rows = input.rows.map((row) => ({ ...row }));
  const runnable: string[] = [];
  const selected = new Set<string>();
  const updates: Array<
    | { kind: "pending"; taskId: string }
    | { kind: "queue"; taskId: string; reason: "conflict" | "capacity" }
  > = [];
  let position = input.nextQueuePosition;
  let capacityBlocked = false;
  for (const row of rows) {
    if (row.state === "verified" || input.attempted.has(row.task_id)) continue;
    if (!dependenciesVerified(row, rows)) {
      if (row.state !== "pending") {
        updates.push({ kind: "pending", taskId: row.task_id });
        row.state = "pending";
        row.pause_code = null;
        row.queue_position = null;
      }
      continue;
    }
    const conflict = hasTaskConflict(row, rows, selected);
    const capacity = input.activeTasks + runnable.length >= input.capacity;
    if (conflict || capacity) {
      const reason = conflict ? "conflict" : "capacity";
      updates.push({ kind: "queue", taskId: row.task_id, reason });
      if (row.state !== "queued" || row.queue_position === null)
        row.queue_position = position++;
      row.state = "queued";
      row.pause_code = reason === "capacity" ? "worker-capacity" : null;
      if (!conflict) capacityBlocked = true;
      continue;
    }
    runnable.push(row.task_id);
    selected.add(row.task_id);
  }
  return { runnable, updates, capacityBlocked };
}
