import { useEffect, useRef, useState } from "react";
import { FiCpu } from "react-icons/fi";
import type { ServiceClient } from "../../../../src/service-client.ts";
import { useWorkbench } from "../../client/use-workbench";
import { useT } from "../../i18n/locale";
import { Markdown } from "../rich/Markdown";
import type { WorkflowAgent } from "./AgentDock";
import { ChatTurnView } from "./ChatTurnView";
import { WorkflowCard } from "./WorkflowPanel";

const LIVE = ["queued", "running"];

/** Main-area context of one workflow subagent, or of a whole run when no step is selected. */
export function WorkflowAgentView({
  client,
  agent,
  backLabel,
  onBack,
  onOpenAgent,
}: {
  client: ServiceClient;
  agent: WorkflowAgent;
  backLabel: string;
  onBack(): void;
  onOpenAgent(agent: WorkflowAgent): void;
}) {
  const { t, tx } = useT();
  const [poll, setPoll] = useState(1000);
  const page = useWorkbench(
    client,
    { kind: "workflow", id: agent.runId },
    poll,
  );
  const run =
    page.value?.kind === "workflow" && page.value.response.type === "run"
      ? page.value.response.run
      : null;
  const step = agent.stepId
    ? run?.steps.find((s) => s.id === agent.stepId)
    : undefined;
  const live = step ? LIVE.includes(step.status) : false;
  useEffect(() => {
    if (run && !LIVE.includes(run.status)) setPoll(0);
  }, [run]);
  const transcript = useWorkbench(
    client,
    agent.stepId && (!run || step?.childRunId)
      ? { kind: "workflow-transcript", id: agent.runId, stepId: agent.stepId }
      : null,
    live || !run ? 1000 : 0,
  );
  const turn =
    transcript.value?.kind === "workflow-transcript"
      ? transcript.value.turn
      : null;
  const [detail, setDetail] = useState(false);
  const result = useWorkbench(
    client,
    detail && agent.stepId
      ? { kind: "workflow-detail", id: agent.runId, stepId: agent.stepId }
      : null,
  );
  const scroll = useRef<HTMLDivElement>(null),
    stick = useRef(true);
  // Follow a live transcript while the reader stays at its end.
  const items = turn?.items.length ?? 0;
  useEffect(() => {
    if (items && stick.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [items]);
  return (
    <section
      className="chat-workspace workflow-agent"
      aria-label={t("Subagent context")}
    >
      <header className="conversation-header">
        <div className="conversation-heading">
          <button type="button" className="ghost" onClick={onBack}>
            {backLabel}
          </button>
          <FiCpu aria-hidden="true" />
          <h2 title={agent.stepId ?? agent.runId}>
            {step ? `${tx(step.kind)} · ${agent.label}` : agent.label}
          </h2>
          <span className="conversation-badge">
            {agent.stepId ? t("Subagent") : t("Workflow")}
          </span>
        </div>
        {(step ?? run) && (
          <span className={`ep-state ${(step ?? run)?.status}`}>
            {tx((step ?? run)?.status ?? "")}
          </span>
        )}
      </header>
      <div
        className="chat-messages"
        ref={scroll}
        onScroll={(event) => {
          const el = event.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {page.error && (
          <p role="alert" className="banner-notice">
            {page.error} ·{" "}
            {t(
              "State unavailable is not completion. No automatic resubmission.",
            )}
          </p>
        )}
        {run && (
          <p className="inspector-note workflow-agent-goal">
            {t("Workflow")}: {run.goal} · {tx(run.phase)} · {tx(run.status)}
          </p>
        )}
        {!agent.stepId && (
          <WorkflowCard
            client={client}
            id={agent.runId}
            onOpenAgent={onOpenAgent}
          />
        )}
        {agent.stepId && transcript.error && (
          <p role="alert">{transcript.error}</p>
        )}
        {agent.stepId &&
          (turn ? (
            <ChatTurnView turn={turn} />
          ) : (
            <p className="inspector-note">
              {t(
                "No retained transcript observed yet; absence is not proof of no activity.",
              )}
            </p>
          ))}
        {step && (
          <section
            className="workflow-agent-result"
            aria-label={t("Step result")}
          >
            <h3>{t("Step result")}</h3>
            {step.exitCode !== null && (
              <p>
                {t("Exit code")}: {step.exitCode}
              </p>
            )}
            {step.text ? (
              <Markdown text={step.text} />
            ) : (
              <p className="inspector-note">{t("No result yet.")}</p>
            )}
            {step.truncated && <p>{t("Preview is truncated.")}</p>}
            <button
              type="button"
              className="ghost"
              onClick={() => setDetail(true)}
            >
              {t("Read retained step result")}
            </button>
            {detail && result.value?.kind === "file" && (
              <pre className="workflow-detail">{result.value.text}</pre>
            )}
            {detail && result.error && <p role="alert">{result.error}</p>}
          </section>
        )}
      </div>
    </section>
  );
}
