/** Browser fixture budgets, not production execution deadlines. A complete
 * scenario owns 120s; 15s bounds each UI action, not an entire engineering run.
 * Callers pass the remaining absolute scenario deadline, reserving UI/teardown
 * time. Progress and temporary read failures never renew that deadline. */
import type { WorkflowRun } from "../../src/service/contracts/workflow.ts";
import type { ServiceClient } from "../../src/service-client.ts";

export const BROWSER_SCENARIO_MS = 120_000;
export const BROWSER_ACTION_MS = 15_000;
const POLL_MS = 100;
export type WorkflowObservation = Awaited<
  ReturnType<ServiceClient["workbenchRead"]>
>;

/** Observe one already attempted run. No session allocation, approval, Send,
 * retry of a mutation, or inference of success from a merge hash alone. */
export async function observeWorkflow(
  client: Pick<ServiceClient, "workbenchRead">,
  id: string,
  deadline: number,
  observed: (reply: WorkflowObservation) => void,
): Promise<WorkflowRun> {
  if (!Number.isFinite(deadline))
    throw new Error("A finite absolute scenario deadline is required");
  let last = "not observed";
  while (performance.now() < deadline) {
    const abort = new AbortController();
    const timer = setTimeout(
      () => abort.abort(),
      Math.min(BROWSER_ACTION_MS, deadline - performance.now()),
    );
    let reply: WorkflowObservation;
    try {
      reply = await client.workbenchRead(
        { kind: "workflow", id },
        abort.signal,
      );
    } finally {
      clearTimeout(timer);
    }
    observed(reply);
    if (reply.kind === "ok") {
      const value = reply.value;
      if (
        value.kind !== "workflow" ||
        value.response.type !== "run" ||
        value.response.run.id !== id
      )
        throw new Error(
          "Workflow observation does not match the attempted run",
        );
      const run = value.response.run;
      last = `${run.status}/${run.phase}`;
      if (
        performance.now() < deadline &&
        !["queued", "running"].includes(run.status)
      )
        return run;
    } else last = `read refused: ${reply.error.code}`;
    const remaining = deadline - performance.now();
    if (remaining > 0)
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(POLL_MS, remaining)),
      );
  }
  throw new Error(
    `Workflow ${id} did not settle within the existing scenario deadline (last observation: ${last}). No command was replayed.`,
  );
}
