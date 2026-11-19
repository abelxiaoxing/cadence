/* pi-web-ui's compact agent rows, backed only by Cadence retained child IDs.
 * MIT (c) 2026 xing-shuyin. This observer never launches or cancels an agent. */
import { useState } from "react";
import { FiChevronDown, FiCpu } from "react-icons/fi";
import type {
  WorkflowRun,
  WorkflowStep,
} from "../../../../src/service/contracts/workflow.ts";
import { useT } from "../../i18n/locale";
import {
  assignmentCounts,
  describeCounts,
  type dockGroups,
  workflowAgentLabel,
} from "../../navigation/workflow-assignments";
import type { RunProjection } from "../../types";

/** One workflow subagent (a step with a child run) opened in the main area. */
export interface WorkflowAgent {
  runId: string;
  stepId: string | null;
  label: string;
}
export interface ConversationAgents {
  groups: ReturnType<typeof dockGroups>;
  unavailable: boolean;
}
const LIVE = ["queued", "running"];
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
  const currentRun = chosen === null;
  return (
    <section className="agent-dock-run" aria-label={run.goal}>
      <button
        type="button"
        className={`agent-dock-run-head${currentRun ? " active" : ""}`}
        aria-current={currentRun || undefined}
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
        const currentStep = chosen === step.id;
        const label = workflowAgentLabel(step.id);
        const task = run.tasks?.find((entry) => entry.id === label);
        return (
          <button
            type="button"
            className={`agent-dock-row${currentStep ? " active" : ""}`}
            aria-current={currentStep || undefined}
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

type DockProps = { unavailable: boolean } & (
  | {
      kind: "conversation";
      groups: ConversationAgents["groups"];
      selected: WorkflowAgent | null;
      onOpen(agent: WorkflowAgent): void;
    }
  | {
      kind: "task";
      runs: RunProjection[];
      onOpen(childId: string, label: string): void;
    }
);
/** Display only the current chat observation OR the selected task snapshot.
 * The independent project-wide safety roster belongs to Running work. */
export function AgentDock(props: DockProps) {
  const { t, tx } = useT();
  const [opened, setOpen] = useState<boolean | null>(null);
  const agents =
    props.kind === "conversation"
      ? props.groups.flatMap((group) => group.steps)
      : [];
  const children =
    props.kind === "task"
      ? props.runs
          .flatMap((run) =>
            run.childRunId ? [{ run, id: run.childRunId }] : [],
          )
          .sort(
            (a, b) =>
              Number(a.run.lifecycle === "settled") -
              Number(b.run.lifecycle === "settled"),
          )
      : [];
  const count = agents.length + children.length;
  const live =
    agents.filter((step) => LIVE.includes(step.status)).length +
    children.filter(({ run }) => run.lifecycle !== "settled").length;
  const open = opened ?? count > 0;
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
            : count || (props.unavailable ? "—" : 0)}
        </span>
      </button>
      {open && (
        <div className="agent-dock-body">
          {props.unavailable ? (
            <p className="panel-hint">{t("Subagent roster unavailable")}</p>
          ) : (
            count === 0 && (
              <p className="panel-hint">
                {t(
                  "Cadence research, implementation and review agents appear here.",
                )}
              </p>
            )
          )}
          {props.kind === "conversation"
            ? props.groups.map(({ run, steps }) => (
                <WorkflowAgentGroup
                  key={run.id}
                  run={run}
                  steps={steps}
                  selected={props.selected}
                  onOpen={props.onOpen}
                />
              ))
            : children.map(({ run, id }) => (
                <button
                  type="button"
                  className="agent-dock-row"
                  key={id}
                  onClick={() =>
                    props.onOpen(id, run.assignmentId ?? t("Subagent"))
                  }
                >
                  <span
                    className={`agent-dot ${run.outcome ?? run.lifecycle}`}
                  />
                  <span className="agent-dock-label">
                    <strong>{run.assignmentId ?? t("Subagent")}</strong>
                  </span>
                  <span className={`ep-state ${run.outcome ?? run.lifecycle}`}>
                    {tx(run.outcome ?? run.lifecycle)}
                  </span>
                </button>
              ))}
        </div>
      )}
    </section>
  );
}
