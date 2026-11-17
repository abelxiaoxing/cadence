/** Cadence observations, separate from the transcript and execution controls.
 * No polling, clock, body text or inferred delivery outcome lives here. */
import { FiActivity, FiGitBranch, FiRadio } from "react-icons/fi";
import type {
  ChatStatus,
  ChatTurnHeader,
} from "../../../../src/service/contracts/workbench.ts";
import type { WorkflowRun } from "../../../../src/service/contracts/workflow.ts";
import type { ModelAvailability } from "../../client/use-model-catalog";
import { type MessageKey, useT } from "../../i18n/locale";
import { workflowActivity, workflowLive } from "./WorkflowPanel";

/** An integration seam for the timeline's actual events, never a guess from
 * text length, stable steps, elapsed time or an omitted-thinking flag.
 * This deliberately cannot carry thinking text, signatures or tool output. */
export type RuntimeActivity =
  | { kind: "waiting" }
  | { kind: "thinking"; state: "active" | "ended" | "unavailable" }
  | { kind: "output" }
  | {
      kind: "tool";
      name: string;
      state: "running" | "completed" | "failed" | "canceled" | "unknown";
    };

/** The owner already distinguishes an active tool/thinking/text event from
 * waiting after it ends. Do not reconstruct activity from visible steps: a
 * poll may contain several completed messages, or none with readable text. */
export function runtimeActivity(header?: ChatTurnHeader): RuntimeActivity {
  if (header?.status !== "running") return { kind: "waiting" };
  const activity = header.activity;
  switch (activity?.kind) {
    case "thinking":
      return { kind: "thinking", state: "active" };
    case "text":
      return { kind: "output" };
    case "tool":
      return { kind: "tool", name: activity.name ?? "", state: "running" };
    default:
      return { kind: "waiting" };
  }
}

export type RuntimeConnection =
  | "observing"
  | "connecting"
  | "stale"
  | "paused"
  | "history";

/** A failed read is an observation failure, not proof of a broken model
 * connection, a stopped reply or a failed workflow. History can remain
 * readable without a live execution connection. */
export function runtimeConnection({
  available,
  status,
  observed,
  readFailed,
}: {
  available: boolean;
  status: ModelAvailability["status"];
  observed: boolean;
  readFailed: boolean;
}): RuntimeConnection {
  if (!available) return "paused";
  if (readFailed || status === "unavailable") return "stale";
  if (!observed || status === "connecting" || status === "preparing")
    return "connecting";
  if (status === "stopped" || status === "not-started") return "history";
  return "observing";
}

/** Select only named runs; a pause/reconnect may retain the exact last fact.
 * A missing read never completes a live run or transfers its state to another. */
export function runtimeWorkflow(
  ids: readonly string[],
  runs: ReadonlyMap<string, WorkflowRun>,
  previous?: WorkflowRun,
): WorkflowRun | undefined {
  const active = ids
    .map((id) => runs.get(id))
    .findLast((run) => run && workflowLive(run));
  if (active) return active;
  if (previous && ids.includes(previous.id) && workflowLive(previous))
    return runs.get(previous.id) ?? previous;
  const latest = ids.at(-1);
  return (
    runs.get(latest ?? "") ?? (previous?.id === latest ? previous : undefined)
  );
}

const REPLY: Record<ChatStatus, MessageKey> = {
  queued: "Reply queued",
  running: "Reply running",
  completed: "Reply ended",
  failed: "Reply failed",
  canceled: "Reply canceled",
  timeout: "Reply timed out",
  unknown: "Reply outcome unknown",
};
const CONNECTION: Record<RuntimeConnection, MessageKey> = {
  observing: "Observing current state",
  connecting: "Waiting for current observations",
  stale: "Observation delayed · showing last known state",
  paused: "Observation paused · showing last known state",
  history: "History readable · live execution not connected",
};
const TOOL: Record<
  Extract<RuntimeActivity, { kind: "tool" }>["state"],
  MessageKey
> = {
  running: "Tool running",
  completed: "Tool result observed",
  failed: "Tool failure observed",
  canceled: "Tool cancellation observed",
  unknown: "Tool outcome unknown",
};

export interface RuntimeObservationProps {
  /** Absent until a reply has actually been observed. */
  reply?: ChatStatus;
  /** Omit when no workflow is known; null means a named run is not read yet. */
  workflow?: WorkflowRun | null;
  connection: RuntimeConnection;
  replyStale?: boolean;
  workflowStale?: boolean;
  /** Latest observed reply activity. Omission explicitly means waiting. */
  activity?: RuntimeActivity;
}

export function RuntimeObservation({
  reply,
  workflow,
  connection,
  replyStale = false,
  workflowStale = false,
  activity,
}: RuntimeObservationProps) {
  const { t, tx } = useT();
  const live = reply === "running";
  const retained = connection !== "observing";
  const delayed = connection === "stale" || connection === "paused";
  const hasFacts = !!reply || !!workflow;
  const connectionLabel =
    !hasFacts && connection === "stale"
      ? "Observation unavailable · waiting for current state"
      : !hasFacts && connection === "paused"
        ? "Observation paused"
        : CONNECTION[connection];
  // Activity cannot keep a settled reply looking live. A tool result does not
  // settle the reply or the workflow, even when it is the latest event.
  const label: MessageKey =
    !activity || activity.kind === "waiting"
      ? "Waiting · no new progress observed"
      : activity.kind === "thinking"
        ? activity.state === "active"
          ? "Thinking activity observed"
          : activity.state === "ended"
            ? "Thinking activity ended"
            : "Thinking content unavailable"
        : activity.kind === "output"
          ? "Reply output observed"
          : TOOL[activity.state];
  return (
    <div
      className="runtime-observation"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={t("Runtime observation")}
    >
      {reply && (
        <div className="runtime-observation-item" data-runtime="reply">
          <FiActivity aria-hidden="true" />
          <span className="runtime-observation-text">
            <span>{t(REPLY[reply])}</span>
            {(replyStale || retained) && (
              <span className="runtime-observation-stale">
                {" "}
                · {t("Last observed")}
              </span>
            )}
            {live && (
              <span className="runtime-observation-activity">
                <span>{t(label)}</span>
                {activity?.kind === "tool" && activity.name && (
                  <span
                    className="runtime-observation-name"
                    title={activity.name}
                  >
                    {activity.name}
                  </span>
                )}
              </span>
            )}
          </span>
        </div>
      )}
      {workflow !== undefined && (
        <div className="runtime-observation-item" data-runtime="workflow">
          <FiGitBranch aria-hidden="true" />
          <span className="runtime-observation-text">
            {t("Workflow")}
            {": "}
            {workflow
              ? tx(
                  workflowLive(workflow) && workflow.phase !== "finished"
                    ? workflowActivity(workflow)
                    : workflow.status,
                )
              : t("Awaiting workflow observation")}
            {workflow && (workflowStale || retained) && (
              <span className="runtime-observation-stale">
                {" "}
                · {t("Last observed")}
              </span>
            )}
          </span>
        </div>
      )}
      <div
        className={`runtime-observation-item runtime-observation-connection${delayed ? " runtime-observation-stale" : ""}`}
        data-runtime="connection"
      >
        <FiRadio aria-hidden="true" />
        <span className="runtime-observation-text">{t(connectionLabel)}</span>
      </div>
    </div>
  );
}
