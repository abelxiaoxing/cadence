/* pi-web-ui's compact agent rows, backed only by Cadence retained child IDs.
 * MIT (c) 2026 xing-shuyin. This observer never launches or cancels an agent. */
import { useEffect, useRef, useState } from "react";
import { FiChevronDown, FiCpu } from "react-icons/fi";
import type {
  WorkflowRun,
  WorkflowStep,
} from "../../../../src/service/contracts/workflow.ts";
import { useT } from "../../i18n/locale";
import {
  assignmentCounts,
  describeCounts,
  dockGroups,
  workflowAgentLabel,
} from "../../navigation/workflow-assignments";
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
/** Reads in flight at once, newest first, so current work shows soonest. */
const READS = 4;
/** An ID never read successfully (a terminal attempt the owner refused leaves
 * one) is retried this often; it is never taken as a settled or absent run. */
const UNREAD_RETRY_MS = 10000;
/** Observe the named workflow runs: live ones on an interval, settled ones once.
 * `failed`: a run already observed could not be read again, so what it shows
 * may be out of date. `unreadable`: IDs not read successfully yet. */
export function useWorkflowRuns(
  client: Pick<ServiceClient, "workbenchRead">,
  ids: readonly string[],
  interval = 2000,
) {
  const [observation, setObservation] = useState<{
    runs: ReadonlyMap<string, WorkflowRun>;
    failed: boolean;
    unreadable: ReadonlySet<string>;
  }>(() => ({ runs: new Map(), failed: false, unreadable: new Set() }));
  // Keep every observed run across changes to the watched IDs. A failed
  // re-read must not turn known live work into an unobserved/absent row.
  const retained = useRef({ client, runs: new Map<string, WorkflowRun>() });
  const key = JSON.stringify([...new Set(ids)]);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (retained.current.client !== client)
      retained.current = { client, runs: new Map() };
    const listed = JSON.parse(key) as string[];
    const wanted = new Set(listed);
    for (const id of retained.current.runs.keys())
      if (!wanted.has(id)) retained.current.runs.delete(id);
    const known = new Map(retained.current.runs);
    const missed = new Map<string, number>();
    const publish = (failed: boolean) => {
      const runs = new Map<string, WorkflowRun>();
      for (const id of listed) {
        const run = known.get(id);
        if (run) runs.set(id, run);
      }
      setObservation({ runs, failed, unreadable: new Set(missed.keys()) });
      return runs;
    };
    /** Whether the read left an observed run without a current observation. */
    const read = async (id: string) => {
      const reply = await client.workbenchRead(
        { kind: "workflow", id },
        abort.signal,
      );
      if (abort.signal.aborted) return false;
      if (
        reply.kind === "ok" &&
        reply.value.kind === "workflow" &&
        reply.value.response.type === "run"
      ) {
        const run = reply.value.response.run;
        known.set(id, run);
        missed.delete(id);
        retained.current.runs.set(id, run);
        return false;
      }
      if (known.has(id)) return true;
      missed.set(id, Date.now());
      return false;
    };
    const poll = async () => {
      let failed = false;
      const now = Date.now();
      const due = listed
        .filter((id) => {
          const previous = known.get(id);
          return previous
            ? LIVE.includes(previous.status)
            : now - (missed.get(id) ?? 0) >= UNREAD_RETRY_MS;
        })
        .reverse();
      for (let i = 0; i < due.length; i += READS) {
        const stale = await Promise.all(due.slice(i, i + READS).map(read));
        if (abort.signal.aborted) return;
        failed ||= stale.includes(true);
        if (i + READS < due.length) publish(failed);
      }
      const runs = publish(failed);
      if (failed || [...runs.values()].some((run) => LIVE.includes(run.status)))
        timer = setTimeout(() => void poll(), interval);
      else if (missed.size)
        timer = setTimeout(() => void poll(), UNREAD_RETRY_MS);
    };
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [client, key, interval]);
  return observation;
}
/** One run's subagents in the dock. Its head names the run and where its
 * assignments stand (the queued ones have no agent row yet) and opens the
 * run's own view; each row is one subagent with its step's status, and under
 * it the state of the assignment it works on. */
export function WorkflowAgentGroup({
  run,
  steps,
  selected,
  onOpen,
}: {
  run: WorkflowRun;
  steps: readonly WorkflowStep[];
  selected?: WorkflowAgent | null;
  onOpen?(agent: WorkflowAgent): void;
}) {
  const { t, tx } = useT();
  const counts = assignmentCounts(run);
  const chosen = selected?.runId === run.id ? selected.stepId : undefined;
  return (
    <section className="agent-dock-run" aria-label={run.goal}>
      <button
        type="button"
        className={`agent-dock-run-head${chosen === null ? " active" : ""}`}
        title={run.goal}
        onClick={() =>
          onOpen?.({ runId: run.id, stepId: null, label: run.goal })
        }
      >
        <span className="agent-dock-run-goal">{run.goal}</span>
        {counts && (
          <span className="agent-dock-run-state">
            {describeCounts(counts, t)}
          </span>
        )}
      </button>
      {steps.map((step) => {
        const label = workflowAgentLabel(step.id);
        const task = run.tasks?.find((entry) => entry.id === label);
        return (
          <button
            type="button"
            className={`agent-dock-row${chosen === step.id ? " active" : ""}`}
            key={step.childRunId}
            title={task ? `${task.title} · ${run.goal}` : run.goal}
            onClick={() => onOpen?.({ runId: run.id, stepId: step.id, label })}
          >
            <span className={`agent-dot ${step.status}`} />
            <span className="agent-dock-label">
              <strong>{`${tx(step.kind)} · ${label}`}</strong>
              {task && (
                <small>
                  {t("Assignment: {state}", { state: tx(task.state) })}
                </small>
              )}
            </span>
            <span className={`ep-state ${step.status}`}>{tx(step.status)}</span>
          </button>
        );
      })}
    </section>
  );
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
  // Unset follows the roster: folded while empty, open once agents appear.
  const [opened, setOpen] = useState<boolean | null>(null),
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
  const groups = dockGroups(workflowRuns, workflows.runs);
  const agents = groups.flatMap((group) => group.steps);
  const count = merged.length + agents.length;
  const live =
    agents.filter((step) => LIVE.includes(step.status)).length +
    merged.filter((row) => row.run.lifecycle !== "settled").length;
  const open = opened ?? (count > 0 || !!error);
  return (
    <section className={`agent-dock${open ? "" : " collapsed"}`}>
      <button
        type="button"
        className="agent-dock-heading"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <FiChevronDown />
        <FiCpu />
        <span>{t("Subagents")}</span>
        <span className={`lp-count${live ? " live" : ""}`}>
          {live
            ? t("{active} active · {total} total", {
                active: live,
                total: count,
              })
            : count}
        </span>
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
          {groups.map(({ run, steps }) => (
            <WorkflowAgentGroup
              key={run.id}
              run={run}
              steps={steps}
              selected={selected}
              onOpen={onOpenWorkflow}
            />
          ))}
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
