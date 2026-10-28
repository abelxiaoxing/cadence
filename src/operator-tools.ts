import {
  effectiveWorkspace,
  resolveWorkspace,
  TaskStore,
} from "./task-store.ts";
import { diagnosticText } from "./verification-diagnostics.ts";

/** Observe only the explicit project; private-state ancestors are refused,
 * never redirected to or reconstructed as a default workspace. */
const observed = (cwd: string) =>
  resolveWorkspace(effectiveWorkspace(cwd).workspace);

/** Readonly observations: no controller, runner, migration or recovery imports. */
export function inspectConsumer(cwd: string) {
  const workspace = observed(cwd);
  const store = new TaskStore(workspace.root);
  const tasks = store.list();
  const checks = store.checks();
  const lock = store.inspectLock();
  return {
    ok: true,
    schema: "cadence-assistant-doctor/1",
    root: workspace.root,
    cwd: workspace.cwd,
    taskCount: tasks.length,
    checks: checks.map(({ name, timeoutMs }) => ({
      name: diagnosticText(name),
      timeoutMs,
    })),
    checkStatus: "not-run",
    coordination: lock
      ? "locked; inspect in the terminal workflow"
      : "unlocked",
    note: "Observation only. Missing state stays absent. Old history is not imported. External and older writers are not contained.",
  };
}

export function inspectRuns(cwd: string) {
  const workspace = observed(cwd);
  const store = new TaskStore(workspace.root);
  return {
    ok: true,
    schema: "cadence-assistant-history/1",
    root: workspace.root,
    tasks: store.list().map((task) => ({
      id: task.id,
      kind: task.kind,
      phase: task.phase === "running" ? "interrupted" : task.phase,
      goal: diagnosticText(task.goal, 512),
      revision: task.revision,
      checks: task.checks.map(({ name, status, exitCode, durationMs }) => ({
        name: diagnosticText(name, 128),
        status,
        exitCode,
        durationMs,
      })),
      review: task.review?.outcome ?? "not-reviewed",
    })),
    note: "Context only; no work resumed. Stored check outcomes are historical, not a current freshness verification. Legacy stores remain untouched.",
  };
}
