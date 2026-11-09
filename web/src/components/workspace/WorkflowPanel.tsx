import { Fragment, useEffect, useId, useRef, useState } from "react";
import { FiSquare } from "react-icons/fi";
import {
  type DeliveryObservation,
  readableDelivery,
  readableWorkflowPlan,
  type WorkflowProposal,
  type WorkflowRun,
  workflowDiagnostics,
} from "../../../../src/service/contracts/workflow.ts";
import type { ServiceClient } from "../../../../src/service-client.ts";
import { useWorkbench } from "../../client/use-workbench";
import { describeError, type Translator, useT } from "../../i18n/locale";
import { Markdown } from "../rich/Markdown";
import { type WorkflowAgent, workflowAgentLabel } from "./AgentDock";

const LIVE = ["queued", "running"];
export const workflowLive = (run: WorkflowRun) => LIVE.includes(run.status);
/** When the owner accepted a run (its own clock); older records carry only
 * their first child's creation, and some nothing at all. */
export function workflowStartedAt(run: WorkflowRun): number | null {
  return (
    run.diagnostics?.acceptedAt ??
    run.steps.find((step) => step.timing)?.timing?.createdAt ??
    null
  );
}
/** A live run's status word: what it is doing now. */
export function workflowActivity(run: WorkflowRun): string {
  if (run.status === "queued") return "queued";
  return run.phase === "research" ? "researching" : run.phase;
}
/** Where each workflow line goes: after the newest turn shown that began
 * before the run, or ahead of every turn when none did and no earlier turn is
 * left to read (it waits while one is). An undated run ends the transcript,
 * and nothing is placed before any turn is read. Workflows belong to the
 * conversation, not to a branch: on any branch a line goes where its time falls. */
export function placeWorkflows(
  turns: readonly { header: { id: string; at: number } }[],
  runs: Iterable<WorkflowRun>,
  earlier: boolean,
): {
  start: WorkflowRun[];
  after: ReadonlyMap<string, WorkflowRun[]>;
  end: WorkflowRun[];
} {
  const start: WorkflowRun[] = [],
    end: WorkflowRun[] = [];
  const after = new Map<string, WorkflowRun[]>();
  if (!turns.length) return { start, after, end };
  const dated = turns.filter((turn) => turn.header.at > 0);
  const begin = (run: WorkflowRun) =>
    workflowStartedAt(run) ?? Number.MAX_SAFE_INTEGER;
  for (const run of [...runs].sort((a, b) => begin(a) - begin(b))) {
    const at = workflowStartedAt(run);
    const holder =
      at === null ? undefined : dated.findLast((turn) => turn.header.at <= at);
    if (at === null || !dated.length) end.push(run);
    else if (holder)
      after.set(holder.header.id, [
        ...(after.get(holder.header.id) ?? []),
        run,
      ]);
    else if (!earlier) start.push(run);
  }
  return { start, after, end };
}
/** Workflows of one list read at first, and added each time the turns shown
 * could hold older ones. */
export const RUN_WINDOW = 8;
/** The next number of a list's newest workflow IDs (oldest first) to read: it
 * grows once every ID in the window was read or found unreadable while the
 * oldest run read began after the oldest turn shown, or once all are shown. */
export function nextRunWindow(
  ids: readonly string[],
  size: number,
  runs: ReadonlyMap<string, WorkflowRun>,
  unreadable: ReadonlySet<string>,
  firstTurnAt: number | undefined,
  allTurns: boolean,
): number {
  if (size >= ids.length) return size;
  const window = ids.slice(-size);
  if (window.some((id) => !runs.has(id) && !unreadable.has(id))) return size;
  const starts = window.flatMap((id) => {
    const run = runs.get(id);
    const at = run ? workflowStartedAt(run) : null;
    return at === null ? [] : [at];
  });
  const oldest = starts.length ? Math.min(...starts) : Number.POSITIVE_INFINITY;
  return allTurns || (firstTurnAt !== undefined && oldest >= firstTurnAt)
    ? size + RUN_WINDOW
    : size;
}
/** Acceptance to settlement, both by the owner's clock; never the browser's. */
function workflowDuration(run: WorkflowRun, t: Translator["t"]): string {
  const start = run.diagnostics?.acceptedAt,
    end = run.diagnostics?.settledAt;
  if (!start || !end || end < start) return "";
  const s = Math.round((end - start) / 1000);
  if (s < 60) return t("{s}s", { s });
  if (s < 3600) return t("{m}m {s}s", { m: Math.floor(s / 60), s: s % 60 });
  return t("{h}h {m}m", {
    h: Math.floor(s / 3600),
    m: Math.floor((s % 3600) / 60),
  });
}
/** One workflow in the conversation: what it is doing, or how it ended. Its
 * steps, checks, delivery and diagnostics open in the main-area workflow view;
 * its subagents are in the dock. */
export function WorkflowLine({
  client,
  run,
  onOpen,
  onChanged,
}: {
  client: ServiceClient;
  run: WorkflowRun;
  onOpen(): void;
  onChanged?(): void;
}) {
  const { t, tx } = useT();
  const goal = useId();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const live = workflowLive(run);
  const meta = live
    ? [
        tx(workflowActivity(run)),
        run.steps
          .filter((step) => step.status === "running")
          .map((step) => workflowAgentLabel(step.id))
          .join(", "),
      ]
    : [
        tx(run.status),
        run.mergedCommit
          ? t("merged {commit}", { commit: run.mergedCommit.slice(0, 7) })
          : "",
        workflowDuration(run, t),
      ];
  // Only an unsuccessful end needs its reason in the conversation.
  const reason =
    live || run.status === "completed"
      ? ""
      : (run.notice.split("\n").find((line) => line.trim()) ?? "");
  const state = meta.filter(Boolean).join(" · ");
  return (
    <article className={`workflow-line ${run.status}`} aria-labelledby={goal}>
      <button
        type="button"
        className="workflow-line-open"
        title={t("Open workflow details")}
        onClick={onOpen}
      >
        <span className={`agent-dot ${run.status}`} aria-hidden="true" />
        <span className="workflow-line-goal" id={goal}>
          {run.goal}
        </span>
        <span
          className={`workflow-line-meta ep-state ${run.status}`}
          title={state}
        >
          {state}
        </span>
      </button>
      {live && (
        <button
          type="button"
          className="ghost workflow-line-stop"
          aria-label={t("Cancel workflow — request stop")}
          title={t("Cancel workflow — request stop")}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError("");
            void cancelWorkflow(client, run)
              .then((code) => {
                if (!alive.current) return;
                setError(code);
                onChanged?.();
              })
              .finally(() => {
                if (alive.current) setBusy(false);
              });
          }}
        >
          <FiSquare aria-hidden="true" />
          {t("Stop")}
        </button>
      )}
      {error ? (
        <p className="workflow-line-reason" role="alert">
          {describeError(t, error)}
        </p>
      ) : (
        reason && (
          <p className="workflow-line-reason" title={reason}>
            {tx(reason)}
          </p>
        )
      )}
    </article>
  );
}
/** The plan awaiting approval: the conversation's one pending decision. */
export function PlanCard({
  proposal,
  canApprove,
  approvalHint,
  onApprove,
}: {
  proposal: WorkflowProposal;
  canApprove: boolean;
  /** Why approval is unavailable for the displayed plan, if known. */
  approvalHint?: string;
  onApprove(): void;
}) {
  const { t } = useT();
  return (
    <section
      className="workflow-plan"
      aria-label={t("Current implementation plan")}
    >
      <h3>{t("Current implementation plan")}</h3>
      <p>{t("Tools and checks run on the service host, not in a sandbox.")}</p>
      <p>
        <code>{proposal.cwd}</code> · {proposal.display?.model}
      </p>
      <p>
        {t("Declared write paths use the checkout root:")}{" "}
        <code>{proposal.checkoutRoot ?? proposal.cwd}</code>
      </p>
      {proposal.display?.runtime && <p>{proposal.display.runtime}</p>}
      {proposal.display?.branch && (
        <p>
          <code>{proposal.display.branch}</code> ·{" "}
          <code>{proposal.display.baseCommit}</code>
        </p>
      )}
      <p>
        {t(
          "Approval covers this goal and boundary: adaptive implementation, checks, recovery, project knowledge and the displayed local delivery. No push, publication or deployment.",
        )}
      </p>
      <Markdown
        text={`## ${proposal.plan.goal}\n\n${proposal.plan.acceptance}\n\n${proposal.plan.decisions}`}
      />
      <details>
        <summary>{t("Complete delivery agreement")}</summary>
        <Markdown text={readableWorkflowPlan(proposal.plan)} />
      </details>
      {proposal.delivery && (
        <Markdown text={readableDelivery(proposal.delivery)} />
      )}
      <button
        type="button"
        className="primary"
        disabled={!canApprove}
        onClick={onApprove}
      >
        {t("Implement this plan")}
      </button>
      {!canApprove && (
        <p className="inspector-note" role="status">
          {approvalHint ?? t("Plan approval is currently unavailable.")}
        </p>
      )}
      <p>
        {t(
          "To change the plan, continue the conversation. A changed plan requires fresh approval.",
        )}
      </p>
    </section>
  );
}
/** Request orderly closure of one workflow; the reply is an observation, never a retry. */
export async function cancelWorkflow(
  client: Pick<ServiceClient, "workbenchCommand">,
  run: { id: string; epoch: string },
): Promise<string> {
  const reply = await client.workbenchCommand({
    kind: "workflow-cancel",
    commandId: crypto.randomUUID(),
    epoch: run.epoch,
    runId: run.id,
  });
  return reply.kind === "error" ? reply.error.code : "";
}
type WorkflowCardProps = {
  client: ServiceClient;
  id: string;
  onChanged?(): void;
  onOpenAgent?(agent: WorkflowAgent): void;
};
export function WorkflowCard(props: WorkflowCardProps) {
  // A different run must not inherit an archive cursor, stopped polling or a
  // selected step belonging to the previous run.
  return <WorkflowCardView key={props.id} {...props} />;
}
function WorkflowCardView({
  client,
  id,
  onChanged,
  onOpenAgent,
}: WorkflowCardProps) {
  const { t, tx } = useT();
  const [poll, setPoll] = useState(1000);
  const [before, setBefore] = useState<number | undefined>();
  // Archived steps are immutable, but their run's status and Stop affordance
  // are live observations even while the reader is looking at an older page.
  const page = useWorkbench(client, { kind: "workflow", id }, poll);
  const history = useWorkbench(
    client,
    before === undefined ? null : { kind: "workflow", id, before },
  );
  const historical =
    history.value?.kind === "workflow" && history.value.response.type === "run"
      ? history.value.response.run
      : null;
  const run =
    page.value?.kind === "workflow" && page.value.response.type === "run"
      ? page.value.response.run
      : null;
  const shown = before === undefined ? run : historical;
  const [detail, setDetail] = useState<string | null>(null);
  const result = useWorkbench(
    client,
    detail ? { kind: "workflow-detail", id, stepId: detail } : null,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const active = run && ["queued", "running"].includes(run.status);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (run && !["queued", "running"].includes(run.status)) setPoll(0);
  }, [run]);
  return (
    <article
      className="workflow-card chat-tool"
      aria-label={t("Workflow progress")}
    >
      <header>
        <strong>{run?.goal ?? t("Observing workflow")}</strong>
        {run && (
          <span className={`ep-state ${run.status}`}>
            {tx(run.phase)} · {tx(run.status)}
          </span>
        )}
      </header>
      {(page.error || history.error || error) && (
        <p role="alert">
          {error || page.error || history.error} ·{" "}
          {t("State unavailable is not completion. No automatic resubmission.")}
        </p>
      )}
      {run?.execution && (
        <p className="inspector-note">
          {t("Context fixed at admission:")} <code>{run.execution.cwd}</code> ·{" "}
          {run.execution.model
            ? `${run.execution.model.provider}/${run.execution.model.model} · ${run.execution.model.thinking}`
            : t("No model")}
        </p>
      )}
      {run?.notice && <p>{run.notice}</p>}
      {run?.delivery && <DeliveryDetails delivery={run.delivery} />}
      {run && (
        <details>
          <summary>Owner timing and runtime</summary>
          <pre className="workflow-detail">{workflowDiagnostics(run)}</pre>
        </details>
      )}
      {run?.mergedCommit && (
        <p>
          {t("Actual local merge commit:")} <code>{run.mergedCommit}</code>
        </p>
      )}
      {run && (
        <p className="inspector-note">
          {t(
            "Agent review is not human review. Worktrees and retained results are preserved.",
          )}
        </p>
      )}
      {run && (run.revision ?? 0) > 0 && (
        <p>
          {t("Implementation route updates")}: {run.revision}
        </p>
      )}
      {run && ((shown?.stepsBefore ?? 0) > 0 || before !== undefined) && (
        <nav className="workflow-actions">
          {(shown?.stepsBefore ?? 0) > 0 && (
            <button
              type="button"
              className="ghost"
              onClick={() => setBefore(shown?.stepsBefore)}
            >
              {t("Earlier workflow steps")}
            </button>
          )}
          {before !== undefined && (
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setBefore(undefined);
                setPoll(1000);
              }}
            >
              {t("Latest workflow steps")}
            </button>
          )}
        </nav>
      )}
      {shown?.steps.map((step) => (
        <details key={step.id} className="chat-tool">
          <summary>
            {tx(step.kind)} · {workflowAgentLabel(step.id)} · {tx(step.status)}
          </summary>
          {step.exitCode !== null && (
            <p>
              {t("Exit code")}: {step.exitCode}
            </p>
          )}
          <Markdown text={step.text} />
          {step.childRunId && onOpenAgent && (
            <button
              type="button"
              className="ghost"
              onClick={() =>
                onOpenAgent({
                  runId: id,
                  stepId: step.id,
                  label: workflowAgentLabel(step.id),
                })
              }
            >
              {t("Open subagent context")}
            </button>
          )}
          {step.truncated && <p>{t("Preview is truncated.")}</p>}
          <button
            type="button"
            className="ghost"
            onClick={() => setDetail(step.id)}
          >
            {t("Read retained step result")}
          </button>
          {detail === step.id && result.value?.kind === "file" && (
            <pre className="workflow-detail">{result.value.text}</pre>
          )}
          {detail === step.id && result.error && (
            <p role="alert">{result.error}</p>
          )}
        </details>
      ))}
      {active && (
        <button
          type="button"
          className="danger"
          disabled={busy}
          onClick={() => {
            if (!run) return;
            setBusy(true);
            void cancelWorkflow(client, run)
              .then((code) => {
                if (!alive.current) return;
                setError(code);
                page.refresh();
                onChanged?.();
              })
              .finally(() => {
                if (alive.current) setBusy(false);
              });
          }}
        >
          {t("Cancel workflow — request stop")}
        </button>
      )}
      <button
        type="button"
        className="ghost"
        onClick={() => {
          page.refresh();
          if (before !== undefined) history.refresh();
        }}
      >
        {t("Observe current state")}
      </button>
    </article>
  );
}

/** Only owner-recorded facts; an accepted candidate is not an applied merge. */
export function DeliveryDetails({
  delivery: d,
}: {
  delivery: DeliveryObservation;
}) {
  const { t, tx } = useT();
  const rows = [
    [t("Task branch"), d.taskBranch],
    [t("Task worktree"), d.worktreeRoot],
    [
      t("Delivery target"),
      `${d.binding.target.branch} @ ${d.binding.target.head}`,
    ],
    [t("Worktree preparation"), tx(d.preparation)],
    [t("Candidate commit"), d.candidate ?? t("Not recorded")],
    [
      t("Candidate acceptance"),
      d.acceptance
        ? `${t("Checks and automatic Agent review passed")} · ${d.acceptance.candidate}`
        : t("Not recorded"),
    ],
    [
      t("Local integration"),
      `${tx(d.integration.status)}${d.integration.after ? ` · ${d.integration.after}` : ""}`,
    ],
    [t("Post-merge checks"), tx(d.postChecks)],
    [t("Worktree cleanup"), tx(d.cleanup.status)],
  ];
  return (
    <section
      className="workflow-delivery"
      aria-label={t("Task branch delivery")}
    >
      <dl>
        {rows.map(([label, value]) => (
          <Fragment key={label}>
            <dt>{label}</dt>
            <dd>
              <code>{value}</code>
            </dd>
          </Fragment>
        ))}
      </dl>
      {d.integration.reason && <p>{d.integration.reason}</p>}
      {d.cleanup.reason && <p>{d.cleanup.reason}</p>}
      <p>{t("Policy: keep the task branch; no push or deployment.")}</p>
    </section>
  );
}
