import { useEffect, useRef, useState } from "react";
import type { CadenceConversation } from "../../../../src/service/contracts/workbench.ts";
import { readableWorkflowPlan } from "../../../../src/service/contracts/workflow.ts";
import type { ServiceClient } from "../../../../src/service-client.ts";
import { useWorkbench } from "../../client/use-workbench";
import { useT } from "../../i18n/locale";
import { Markdown } from "../rich/Markdown";
import { ChatTurnView } from "./ChatTurnView";

export function WorkflowPanel({
  client,
  state,
  canApprove,
  onApprove,
  onChanged,
  pending,
}: {
  client: ServiceClient;
  state: CadenceConversation;
  canApprove: boolean;
  onApprove(): void;
  onChanged(): void;
  pending: string;
}) {
  const { t } = useT();
  const [count, setCount] = useState(2);
  const ids = [...new Set([...state.runs, ...(pending ? [pending] : [])])];
  return (
    <section className="workflow-panel" aria-label={t("Cadence workflow")}>
      {ids.length > count && (
        <button
          type="button"
          className="ghost"
          onClick={() => setCount((n) => n + 5)}
        >
          {t("Earlier workflow results")}
        </button>
      )}
      {ids.slice(-count).map((id) => (
        <WorkflowCard key={id} client={client} id={id} onChanged={onChanged} />
      ))}
      {state.enabled && state.proposal && (
        <section
          className="workflow-plan banner-notice"
          aria-label={t("Current implementation plan")}
        >
          <h3>{t("Current implementation plan")}</h3>
          <p>
            {t("Tools and checks run on the service host, not in a sandbox.")}
          </p>
          <p>
            <code>{state.proposal.cwd}</code> · {state.proposal.display?.model}
          </p>
          {state.proposal.display?.branch && (
            <p>
              <code>{state.proposal.display.branch}</code> ·{" "}
              <code>{state.proposal.display.baseCommit}</code>
            </p>
          )}
          <p>
            {t(
              "Approval covers only this plan: implementation, checks, bounded repairs and the displayed local delivery. No push, publication or deployment.",
            )}
          </p>
          <Markdown text={readableWorkflowPlan(state.proposal.plan)} />
          <button
            type="button"
            className="primary"
            disabled={!canApprove}
            onClick={onApprove}
          >
            {t("Implement this plan")}
          </button>
          <p>
            {t(
              "To change the plan, continue the conversation. A changed plan requires fresh approval.",
            )}
          </p>
        </section>
      )}
      {state.enabled && !state.proposal && ids.length === 0 && (
        <p className="inspector-note">
          {t(
            "Cadence stays on for this conversation until you explicitly exit.",
          )}
        </p>
      )}
    </section>
  );
}
export function WorkflowCard({
  client,
  id,
  onChanged,
}: {
  client: ServiceClient;
  id: string;
  onChanged?(): void;
}) {
  const { t, tx } = useT();
  const [poll, setPoll] = useState(1000);
  const page = useWorkbench(client, { kind: "workflow", id }, poll);
  const run =
    page.value?.kind === "workflow" && page.value.response.type === "run"
      ? page.value.response.run
      : null;
  const [detail, setDetail] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
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
      {(page.error || error) && (
        <p role="alert">
          {error || page.error} ·{" "}
          {t("State unavailable is not completion. No automatic resubmission.")}
        </p>
      )}
      {run?.notice && <p>{run.notice}</p>}
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
      {run?.steps.map((step) => (
        <details key={step.id} className="chat-tool">
          <summary>
            {tx(step.kind)} · {step.id} · {tx(step.status)}
          </summary>
          {step.exitCode !== null && (
            <p>
              {t("Exit code")}: {step.exitCode}
            </p>
          )}
          <Markdown text={step.text} />
          {step.childRunId && (
            <>
              <p>
                <code>{step.childRunId}</code>
              </p>
              <button
                type="button"
                className="ghost"
                onClick={() => setTranscript(step.id)}
              >
                {t("Subagent transcript")}
              </button>
            </>
          )}
          {transcript === step.id && (
            <WorkflowTranscript
              client={client}
              id={id}
              stepId={step.id}
              running={step.status === "running"}
            />
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
            void client
              .workbenchCommand({
                kind: "workflow-cancel",
                commandId: crypto.randomUUID(),
                epoch: run.epoch,
                runId: id,
              })
              .then((reply) => {
                if (!alive.current) return;
                if (reply.kind === "error") setError(reply.error.code);
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
      <button type="button" className="ghost" onClick={page.refresh}>
        {t("Observe current state")}
      </button>
    </article>
  );
}

function WorkflowTranscript({
  client,
  id,
  stepId,
  running,
}: {
  client: ServiceClient;
  id: string;
  stepId: string;
  running: boolean;
}) {
  const { t } = useT();
  const page = useWorkbench(
    client,
    { kind: "workflow-transcript", id, stepId },
    running ? 1000 : 0,
  );
  const turn =
    page.value?.kind === "workflow-transcript" ? page.value.turn : null;
  return (
    <section aria-label={t("Subagent transcript")}>
      {page.error && <p role="alert">{page.error}</p>}
      {turn ? (
        <ChatTurnView turn={turn} />
      ) : (
        <p>
          {t(
            "No retained transcript observed yet; absence is not proof of no activity.",
          )}
        </p>
      )}
    </section>
  );
}
