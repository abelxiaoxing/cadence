/* pi-web-ui's compact agent rows, backed only by Cadence retained child IDs.
 * MIT (c) 2026 xing-shuyin. This observer never launches or cancels an agent. */
import { useEffect, useState } from "react";
import { FiChevronDown, FiCpu } from "react-icons/fi";
import type { WorkflowRun } from "../../../../src/service/contracts/workflow.ts";
import { useT } from "../../i18n/locale";
import type { ActiveRuns, RunProjection, ServiceClient } from "../../types";

interface Row {
  taskId: string;
  run: RunProjection;
  snapshot: string;
}
/** One workflow subagent (a step with a child run) opened in the main area. */
export interface WorkflowAgent {
  runId: string;
  stepId: string | null;
  label: string;
}
const LIVE = ["queued", "running"];
/** A workflow step ID is `<assignment>-<uuid>`; the assignment is the readable part. */
export function workflowAgentLabel(stepId: string) {
  return stepId.replace(
    /-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "",
  );
}
/** Observe the named workflow runs: live ones on an interval, settled ones once. */
export function useWorkflowRuns(
  client: Pick<ServiceClient, "workbenchRead">,
  ids: readonly string[],
  interval = 2000,
) {
  const [runs, setRuns] = useState<ReadonlyMap<string, WorkflowRun>>(
    () => new Map(),
  );
  const [failed, setFailed] = useState(false);
  const key = JSON.stringify([...new Set(ids)]);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const known = new Map<string, WorkflowRun>();
    const poll = async () => {
      let error = false;
      for (const id of JSON.parse(key) as string[]) {
        const previous = known.get(id);
        if (previous && !LIVE.includes(previous.status)) continue;
        const reply = await client.workbenchRead(
          { kind: "workflow", id },
          abort.signal,
        );
        if (abort.signal.aborted) return;
        if (
          reply.kind === "ok" &&
          reply.value.kind === "workflow" &&
          reply.value.response.type === "run"
        )
          known.set(id, reply.value.response.run);
        else error = true;
      }
      if (abort.signal.aborted) return;
      setRuns(new Map(known));
      setFailed(error);
      if (error || [...known.values()].some((run) => LIVE.includes(run.status)))
        timer = setTimeout(() => void poll(), interval);
    };
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [client, key, interval]);
  return { runs, failed };
}
export function AgentDock({
  client,
  active,
  taskId,
  runs,
  snapshot,
  workflowRuns = [],
  selected,
  onOpen,
  onOpenWorkflow,
}: {
  client: ServiceClient;
  active?: ActiveRuns;
  taskId: string | null;
  runs: RunProjection[];
  snapshot?: string;
  /** Active workflow runs plus the current conversation's recent runs. */
  workflowRuns?: readonly string[];
  selected?: WorkflowAgent | null;
  onOpen(
    taskId: string,
    childId: string,
    snapshot: string,
    label: string,
  ): void;
  onOpenWorkflow?(agent: WorkflowAgent): void;
}) {
  const { t, tx } = useT();
  const [open, setOpen] = useState(true),
    [rows, setRows] = useState<Row[]>([]),
    [error, setError] = useState(false);
  const workflows = useWorkflowRuns(client, workflowRuns);
  const key = JSON.stringify(
    active?.status === "complete"
      ? [...new Set(active.runs.map((run) => run.taskId))]
      : [],
  );
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const next: Row[] = [];
      let failed = false;
      for (const id of JSON.parse(key) as string[]) {
        const result = await client.snapshot(
          { kind: "task", id },
          abort.signal,
        );
        if (abort.signal.aborted) return;
        if (result.kind === "ok") {
          for (const run of result.value.runs) {
            if (run.childRunId)
              next.push({
                taskId: id,
                run,
                snapshot: result.value.committedSeq,
              });
          }
        } else failed = true;
      }
      if (!abort.signal.aborted) {
        setRows(next);
        setError(failed);
        timer = setTimeout(() => void poll(), 3000);
      }
    };
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [client, key]);
  const current =
    taskId && snapshot
      ? runs
          .filter((run) => run.childRunId)
          .map((run) => ({ taskId, run, snapshot }))
      : [];
  const merged = [
    ...rows,
    ...current.filter(
      (row) => !rows.some((r) => r.run.childRunId === row.run.childRunId),
    ),
  ].sort(
    (a, b) =>
      Number(a.run.lifecycle === "settled") -
      Number(b.run.lifecycle === "settled"),
  );
  // Newest first; live agents above settled ones.
  const agents = [...new Set(workflowRuns)]
    .flatMap((id) => {
      const run = workflows.runs.get(id);
      return run
        ? run.steps
            .filter((step) => step.childRunId)
            .map((step) => ({ run, step }))
        : [];
    })
    .reverse()
    .sort(
      (a, b) =>
        Number(!LIVE.includes(a.step.status)) -
        Number(!LIVE.includes(b.step.status)),
    );
  const count = merged.length + agents.length;
  return (
    <section className={`agent-dock${open ? "" : " collapsed"}`}>
      <button
        type="button"
        className="agent-dock-heading"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <FiChevronDown />
        <FiCpu />
        <span>{t("Subagents")}</span>
        <span className="lp-count">{count}</span>
      </button>
      {open && (
        <div className="agent-dock-body">
          {(error || active?.status !== "complete" || workflows.failed) && (
            <p className="panel-hint">{t("Subagent roster unavailable")}</p>
          )}
          {count === 0 && !error && active?.status === "complete" && (
            <p className="panel-hint">
              {t(
                "Cadence research, implementation and review agents appear here.",
              )}
            </p>
          )}
          {agents.map(({ run, step }) => {
            const label = workflowAgentLabel(step.id);
            return (
              <button
                type="button"
                className={`agent-dock-row${selected?.runId === run.id && selected.stepId === step.id ? " active" : ""}`}
                key={step.childRunId}
                title={run.goal}
                onClick={() =>
                  onOpenWorkflow?.({ runId: run.id, stepId: step.id, label })
                }
              >
                <span className={`agent-dot ${step.status}`} />
                <span className="agent-dock-label">
                  <strong>
                    {tx(step.kind)} · {label}
                  </strong>
                  <small>{run.goal}</small>
                </span>
                <span className={`ep-state ${step.status}`}>
                  {tx(step.status)}
                </span>
              </button>
            );
          })}
          {merged.map((row) => (
            <button
              type="button"
              className="agent-dock-row"
              key={row.run.childRunId}
              onClick={() =>
                onOpen(
                  row.taskId,
                  row.run.childRunId as string,
                  row.snapshot,
                  row.run.assignmentId ?? t("Subagent"),
                )
              }
            >
              <span
                className={`agent-dot ${row.run.outcome ?? row.run.lifecycle}`}
              />
              <span className="agent-dock-label">
                <strong>{row.run.assignmentId ?? t("Subagent")}</strong>
                <small>{t("Task {id}", { id: row.taskId.slice(0, 8) })}</small>
              </span>
              <span
                className={`ep-state ${row.run.outcome ?? row.run.lifecycle}`}
              >
                {tx(row.run.outcome ?? row.run.lifecycle)}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
