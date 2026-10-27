/* Adapted from pi-web-ui GoalBar.tsx goalbar/goalbar-row/goalbar-btn families,
 * placed where pi's composer sits. MIT (c) 2026 xing-shuyin. Each button only
 * opens a panel or requests a preview; every effect still needs confirmation. */
import type { ReactNode } from "react";
import {
  FiCheck,
  FiCheckSquare,
  FiEdit3,
  FiPlay,
  FiSquare,
  FiUserCheck,
  FiZap,
} from "react-icons/fi";
import { type MessageKey, useT } from "../../i18n/locale";
import type { ActiveRunRef, ContextVersion, RunProjection } from "../../types";

export type TaskStage = "unavailable" | "plan" | "ready" | "running" | "verify";
const STEPS: readonly (readonly [
  Exclude<TaskStage, "unavailable" | "running">,
  MessageKey,
])[] = [
  ["plan", "Plan"],
  ["ready", "Start"],
  ["verify", "Check and review"],
];
/** The next step from the current control context and observed runs. Only a
 * hint: it grants nothing, and an older run outside the snapshot horizon may be
 * missing from `runs`. */
export function taskStage(
  context: ContextVersion | null,
  runs: readonly RunProjection[],
  active: ActiveRunRef | undefined,
): TaskStage {
  if (active) return "running";
  if (!context?.task) return "unavailable";
  if (context.task.graphRevision === null) return "plan";
  return runs.some(
    (r) =>
      r.childRunId === null &&
      r.admission.kind === "start" &&
      r.lifecycle === "settled",
  )
    ? "verify"
    : "ready";
}
export function TaskFlow({
  context,
  runs,
  active,
  rosterComplete,
  canAct,
  cancelCompatible,
  canceling,
  onGenerate,
  onStart,
  onPanel,
  onCancel,
}: {
  context: ContextVersion | null;
  runs: readonly RunProjection[];
  active: ActiveRunRef | undefined;
  rosterComplete: boolean;
  canAct: boolean;
  cancelCompatible: boolean;
  canceling: boolean;
  onGenerate: () => void;
  onStart: () => void;
  onPanel: (tab: "plan" | "checks" | "review") => void;
  onCancel: (runId: string) => void;
}) {
  const { t, tx } = useT();
  const stage = taskStage(context, runs, active);
  // A running Generate is still the planning step; a running check is verification.
  const current =
    stage === "running"
      ? active?.kind === "generate-plan"
        ? "plan"
        : active?.kind === "check"
          ? "verify"
          : "ready"
      : stage;
  const reached = STEPS.findIndex(([step]) => step === current);
  const last = runs.find(
    (r) => r.childRunId === null && r.admission.kind === "start",
  );
  let text: string;
  let buttons: ReactNode;
  switch (stage) {
    case "running":
      text = t(
        "{kind} is running · {stage}. Leaving this page does not cancel it.",
        {
          kind: tx(active?.kind ?? "start"),
          stage: tx(active?.stage ?? "active"),
        },
      );
      buttons = active && (
        <button
          type="button"
          className="goalbar-btn danger"
          disabled={!cancelCompatible || canceling}
          onClick={() => onCancel(active.runId)}
        >
          <FiSquare aria-hidden="true" />
          {t("Stop this run")}
        </button>
      );
      break;
    case "plan":
      text = t(
        "Next: write a readable plan with assignments and save it. Code tasks can first ask the model for a readonly proposal.",
      );
      buttons = (
        <>
          {context?.task?.kind === "code" && (
            <button
              type="button"
              className="goalbar-btn ghost"
              disabled={!canAct}
              onClick={onGenerate}
            >
              <FiZap aria-hidden="true" />
              {t("Generate plan proposal")}
            </button>
          )}
          <button
            type="button"
            className="goalbar-btn"
            onClick={() => onPanel("plan")}
          >
            <FiEdit3 aria-hidden="true" />
            {t("Edit plan")}
          </button>
        </>
      );
      break;
    case "ready":
      text = t(
        "Plan saved (revision {revision}). Nothing runs until you confirm Start.",
        { revision: context?.task?.graphRevision ?? "?" },
      );
      buttons = (
        <>
          <button
            type="button"
            className="goalbar-btn ghost"
            onClick={() => onPanel("plan")}
          >
            <FiEdit3 aria-hidden="true" />
            {t("Edit plan")}
          </button>
          <button
            type="button"
            className="goalbar-btn"
            disabled={!canAct}
            onClick={onStart}
          >
            <FiPlay aria-hidden="true" />
            {t("Start execution")}
          </button>
        </>
      );
      break;
    case "verify":
      text = t(
        "Last run settled: {outcome}. Run checks, then record human review.",
        { outcome: tx(last?.outcome ?? last?.lifecycle ?? "unknown") },
      );
      buttons = (
        <>
          <button
            type="button"
            className="goalbar-btn ghost"
            disabled={!canAct}
            onClick={onStart}
          >
            <FiPlay aria-hidden="true" />
            {t("Start execution")}
          </button>
          <button
            type="button"
            className="goalbar-btn ghost"
            onClick={() => onPanel("checks")}
          >
            <FiCheckSquare aria-hidden="true" />
            {t("Run checks")}
          </button>
          <button
            type="button"
            className="goalbar-btn"
            onClick={() => onPanel("review")}
          >
            <FiUserCheck aria-hidden="true" />
            {t("Review")}
          </button>
        </>
      );
      break;
    default:
      text = t(
        "Actions need the current control context; recorded history stays readable.",
      );
      buttons = null;
  }
  return (
    <section className="inputbar task-flow" aria-label={t("Next step")}>
      <div className="goalbar">
        <ol className="flow-steps">
          <li className="done">
            <FiCheck aria-hidden="true" />
            {t("Goal")}
          </li>
          {STEPS.map(([step, label], i) => (
            <li
              key={step}
              className={
                stage === "unavailable" || i > reached
                  ? ""
                  : i < reached
                    ? "done"
                    : stage === "running"
                      ? "current busy"
                      : "current"
              }
              aria-current={i === reached ? "step" : undefined}
            >
              {i < reached && stage !== "unavailable" ? (
                <FiCheck aria-hidden="true" />
              ) : (
                <span className="flow-num">{i + 2}</span>
              )}
              {t(label)}
            </li>
          ))}
        </ol>
        <div className="goalbar-row">
          <p className="goalbar-text" role="status">
            {text}
            {!rosterComplete &&
              ` ${t("Active roster unavailable; absence is not proof of settlement.")}`}
          </p>
          {buttons}
        </div>
      </div>
    </section>
  );
}
