/* Adapted from pi-web-ui LeftPanel.tsx project/current/history sections and
 * nested subagent rows. MIT (c) 2026 xing-shuyin. Navigation only observes the
 * Cadence owner; no session import, cwd mutation, replay or repair. */
import { type ReactNode, useState } from "react";
import {
  FiChevronDown,
  FiChevronRight,
  FiCpu,
  FiFolder,
  FiMessageSquare,
  FiPlus,
  FiSquare,
} from "react-icons/fi";
import type { ChatSummary } from "../../../../src/service/contracts/workbench.ts";
import { usePage } from "../../history/use-page";
import { useT } from "../../i18n/locale";
import { buildNavigationRows } from "../../navigation/assignment-rows";
import type {
  ActiveRuns,
  ListRequest,
  RunProjection,
  Scope,
  ServiceClient,
  WorkspaceBootstrap,
} from "../../types";
import { PageControls } from "../history/PageControls";

type OpenScope = (scope: Scope, snapshot?: string, label?: string) => void;

function SidebarSection({
  title,
  children,
  className = "",
  count,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  count?: string;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className={`lp-section ${className}${open ? "" : " collapsed"}`}>
      <header className="lp-section-header">
        <button
          type="button"
          className="lp-section-heading"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? (
            <FiChevronDown aria-hidden="true" />
          ) : (
            <FiChevronRight aria-hidden="true" />
          )}
          <span className="lp-section-title">{title}</span>
          {count && <span className="lp-count">{count}</span>}
        </button>
      </header>
      <div className="lp-section-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}

export function ConversationTree({
  runs,
  scope,
  snapshot,
  onScope,
}: {
  runs: RunProjection[];
  scope: Scope | null;
  snapshot?: string;
  onScope: OpenScope;
}) {
  const { t, tx } = useT();
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const rows = buildNavigationRows(
    runs.map((r) => ({
      id: r.childRunId ?? r.runId,
      parentId: r.childRunId ? r.runId : null,
      label: r.childRunId
        ? (r.assignmentId ?? t("Subagent"))
        : tx(r.admission.kind),
      active: r.lifecycle !== "settled",
      failed: r.outcome === "failed",
      unknown: r.outcome === "unknown",
    })),
    collapsed,
  );
  return (
    <nav className="conversation-tree" aria-label={t("Runs and assignments")}>
      {rows.map((row) => {
        const projection = runs.find(
          (r) => (r.childRunId ?? r.runId) === row.c.id,
        );
        const kind = projection?.childRunId ? "child" : "run";
        // Historical lifecycle is not the current active roster. Preserve the
        // recorded outcome (including canceled/partial/unknown), never infer PASS.
        const state = projection?.outcome ?? projection?.lifecycle ?? "unknown";
        const selected = scope?.kind === kind && scope.id === row.c.id;
        return (
          <div
            className="ep-row"
            key={row.c.id}
            style={{ paddingInlineStart: `${row.depth * 14}px` }}
          >
            {row.hasKids ? (
              <button
                type="button"
                className="ep-toggle"
                aria-label={t("Toggle assignments")}
                aria-expanded={!row.isCollapsed}
                onClick={() =>
                  setCollapsed((previous) => {
                    const next = new Set(previous);
                    if (next.has(row.c.id)) next.delete(row.c.id);
                    else next.add(row.c.id);
                    return next;
                  })
                }
              >
                {row.isCollapsed ? (
                  <FiChevronRight aria-hidden="true" />
                ) : (
                  <FiChevronDown aria-hidden="true" />
                )}
              </button>
            ) : (
              <span className="ep-toggle-spacer" aria-hidden="true" />
            )}
            <button
              type="button"
              className={`session-item${selected ? " active" : ""}`}
              aria-current={selected ? "true" : undefined}
              title={`${row.c.label} · ${row.c.id}`}
              onClick={() =>
                onScope({ kind, id: row.c.id }, snapshot, row.c.label)
              }
            >
              <span className="session-icon">
                {kind === "child" ? (
                  <FiCpu aria-hidden="true" />
                ) : (
                  <FiMessageSquare aria-hidden="true" />
                )}
              </span>
              <span className="session-info">
                <span className="session-title">{row.c.label}</span>
                {kind === "child" && (
                  <span className="session-sub">{t("Subagent")}</span>
                )}
                {row.isCollapsed && (
                  <span className="session-sub session-outcome">
                    {`${t("{count} descendants", { count: row.descendantCount })}${row.hasFailure ? t(" / failed child") : ""}${row.hasUnknown ? t(" / unknown child") : ""}`}
                  </span>
                )}
              </span>
              <span className={`ep-state ${state}`}>{tx(state)}</span>
            </button>
          </div>
        );
      })}
    </nav>
  );
}

function RetainedConversations({
  pager,
  scope,
  onScope,
  exclude,
}: {
  pager: ReturnType<typeof usePage>;
  exclude: string[];
  scope: Scope | null;
  onScope: OpenScope;
}) {
  const { t } = useT();
  const page = pager.page;
  return (
    <div className="retained-conversations">
      {page && !("kind" in page) && (
        <>
          <ConversationTree
            runs={page.records.flatMap((r) =>
              r.kind === "run" && !exclude.includes(r.projection.runId)
                ? [r.projection]
                : [],
            )}
            scope={scope}
            snapshot={page.request.snapshotSeq ?? undefined}
            onScope={onScope}
          />
          {page.records.length === 0 && (
            <p className="panel-hint">
              {t("No retained conversations on this page.")}
            </p>
          )}
        </>
      )}
      <PageControls pager={pager} compact />
    </div>
  );
}

export function TaskSidebar({
  client,
  workspace,
  taskId,
  scope,
  runs,
  snapshot,
  activeRuns,
  cancelCompatible,
  canceling,
  onCancel,
  onTask,
  onScope,
  onNew,
  onProject,
  chats = [],
  conversationId,
  projects,
  onConversation,
  onNewConversation,
  onOpenProject,
}: {
  client: ServiceClient;
  workspace: WorkspaceBootstrap;
  taskId: string | null;
  scope: Scope | null;
  runs: RunProjection[];
  snapshot?: string;
  activeRuns?: ActiveRuns;
  cancelCompatible: boolean;
  canceling: Set<string>;
  onCancel: (runId: string) => void;
  onTask: (id: string, title?: string) => void;
  onScope: OpenScope;
  onNew: () => void;
  onProject: () => void;
  chats?: ChatSummary[];
  conversationId?: string | null;
  projects?: { path: string; current: boolean }[];
  onConversation?: (id: string) => void;
  onNewConversation?: () => void;
  onOpenProject?: (path?: string) => void;
}) {
  const { t, tx } = useT();
  const request: ListRequest = {
    reader: "tasks",
    storeId: workspace.storeId,
    scope: { kind: "workspace", id: workspace.workspaceId },
    snapshotSeq: null,
    after: null,
    limit: 50,
  };
  const tasks = usePage(client, request);
  // Keep the retained read/Back stack in one stable owner when the selected task
  // moves from the running group into history, or a section is folded.
  const conversationPager = usePage(
    client,
    taskId
      ? {
          ...request,
          reader: "runs",
          scope: { kind: "task", id: taskId },
          snapshotSeq: snapshot ?? workspace.committedSeq,
        }
      : null,
  );
  const records =
    tasks.page && !("kind" in tasks.page)
      ? tasks.page.records.flatMap((r) => (r.kind === "task" ? [r] : []))
      : [];
  const active = activeRuns?.status === "complete" ? activeRuns.runs : [];
  const history = records.filter(
    (r) => !active.some((a) => a.taskId === r.owner.taskId),
  );
  const conversations = taskId && (
    <section
      className="task-conversations"
      aria-label={t("Task conversations")}
    >
      <h3>{t("Task conversations")}</h3>
      <RetainedConversations
        key={taskId}
        pager={conversationPager}
        scope={scope}
        onScope={onScope}
        exclude={active.map((run) => run.runId)}
      />
    </section>
  );
  const project =
    workspace.rootLabel.split(/[\\/]/).filter(Boolean).at(-1) ??
    workspace.rootLabel;
  const liveChats = chats.filter(
    (chat) =>
      chat.status === "running" ||
      chat.status === "queued" ||
      chat.id === conversationId,
  );
  const chatRow = (chat: ChatSummary) => (
    <button
      type="button"
      key={chat.id}
      className={`session-item${chat.id === conversationId ? " active" : ""}`}
      onClick={() => onConversation?.(chat.id)}
      title={chat.title}
    >
      <span className="session-icon">
        <FiMessageSquare />
      </span>
      <span className="session-info">
        <span className="session-title">{chat.title}</span>
        <span className="session-sub">
          {t("Ordinary")} · {tx(chat.status)}
        </span>
      </span>
    </button>
  );
  return (
    <aside className="panel panel-left lp-panel">
      <div className="lp-new">
        <button
          type="button"
          className="new-conversation"
          onClick={onNewConversation ?? onNew}
        >
          <FiPlus aria-hidden="true" />
          {onNewConversation ? t("New conversation") : t("New task")}
        </button>
        {onNewConversation && (
          <button
            type="button"
            className="new-task-shortcut"
            aria-label={t("New task")}
            title={t("New task")}
            onClick={onNew}
          >
            <FiCpu />
          </button>
        )}
      </div>
      <SidebarSection title={t("Recent projects")} className="projects">
        {projects ? (
          <>
            {projects.map((entry) => (
              <button
                type="button"
                className={`session-item project-item${entry.current ? " active" : ""}`}
                key={entry.path}
                title={entry.path}
                onClick={() =>
                  entry.current ? onProject() : onOpenProject?.(entry.path)
                }
              >
                <span className="session-icon">
                  <FiFolder />
                </span>
                <span className="session-info">
                  <span className="session-title">
                    {entry.path.split(/[\\/]/).filter(Boolean).at(-1) ??
                      entry.path}
                  </span>
                  <span className="session-sub">{entry.path}</span>
                </span>
              </button>
            ))}
            <button
              type="button"
              className="project-open"
              onClick={() => onOpenProject?.()}
            >
              <FiPlus />
              {t("Open working folder")}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="session-item project-item active"
              title={workspace.rootLabel}
              onClick={onProject}
            >
              <span className="session-icon">
                <FiFolder aria-hidden="true" />
              </span>
              <span className="session-info">
                <span className="session-title">{project}</span>
                <span className="session-sub">{workspace.rootLabel}</span>
              </span>
            </button>
            <p className="panel-hint">
              {t(
                "This service exposes one project. Opening it never starts work.",
              )}
            </p>
          </>
        )}
      </SidebarSection>
      <SidebarSection
        title={t("Running conversations")}
        count={
          activeRuns?.status === "complete"
            ? String(active.length + liveChats.length)
            : "?"
        }
        className="running-conversations"
      >
        {activeRuns?.status !== "complete" && (
          <p className="panel-hint">
            {t(
              "Active roster unavailable; absence is not proof of settlement.",
            )}
          </p>
        )}
        {liveChats.map(chatRow)}
        {activeRuns?.status === "complete" &&
          active.length === 0 &&
          liveChats.length === 0 && (
            <p className="panel-hint">{t("No active runs")}</p>
          )}
        {active.map((run) => {
          const title = records.find(
            (r) => r.owner.taskId === run.taskId,
          )?.goal;
          return (
            <div key={run.runId} className="conversation-group">
              <button
                type="button"
                className={`session-item${taskId === run.taskId && scope?.kind === "task" ? " active" : ""}`}
                onClick={() => onTask(run.taskId, title)}
                title={run.runId}
              >
                <span className="status-dot busy" aria-hidden="true" />
                <span className="session-info">
                  <span className="session-title">
                    {title ?? t("Task {id}", { id: run.taskId.slice(0, 8) })}
                  </span>
                  <span className="session-sub">
                    {tx(run.kind)} · {tx(run.stage)}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="conversation-stop"
                disabled={!cancelCompatible || canceling.has(run.runId)}
                onClick={() => onCancel(run.runId)}
              >
                <FiSquare aria-hidden="true" />
                {t("Cancel run — request stop")}
              </button>
              {taskId === run.taskId && (
                <ConversationTree
                  runs={runs.filter((r) => r.runId === run.runId)}
                  scope={scope}
                  onScope={onScope}
                />
              )}
            </div>
          );
        })}
      </SidebarSection>
      <SidebarSection
        title={t("Conversation history")}
        count={
          tasks.page && !("kind" in tasks.page)
            ? `${history.length}${tasks.page.next || tasks.canPrevious ? "+" : ""}`
            : "?"
        }
        className="grow"
      >
        <nav aria-label={t("Tasks")} className="task-list">
          {chats.filter((chat) => !liveChats.includes(chat)).map(chatRow)}
          {history.map((r) => (
            <div key={r.owner.taskId}>
              <button
                type="button"
                className={`session-item${r.owner.taskId === taskId && scope?.kind === "task" ? " active" : ""}`}
                aria-current={
                  r.owner.taskId === taskId && scope?.kind === "task"
                    ? "true"
                    : undefined
                }
                title={r.goal}
                onClick={() => onTask(r.owner.taskId, r.goal)}
              >
                <span className="session-icon">
                  <FiMessageSquare aria-hidden="true" />
                </span>
                <span className="session-info">
                  <span className="session-title">{r.goal}</span>
                  <span className="session-sub">
                    {t("Task {id}", { id: r.owner.taskId.slice(0, 8) })}
                  </span>
                </span>
              </button>
              {r.owner.taskId === taskId && conversations}
            </div>
          ))}
          {tasks.page && !("kind" in tasks.page) && history.length === 0 && (
            <p className="panel-hint">{t("No retained task on this page.")}</p>
          )}
          <PageControls pager={tasks} compact />
        </nav>
        {!history.some((r) => r.owner.taskId === taskId) && conversations}
      </SidebarSection>
    </aside>
  );
}
