/* Adapted from pi-web-ui LeftPanel.tsx project/current/history sections,
 * nested subagent rows, the filter box and time-grouped slim rows.
 * MIT (c) 2026 xing-shuyin. Navigation only observes the Cadence owner; no
 * session import, cwd mutation, replay or repair. */
import { type ReactNode, useState } from "react";
import {
  FiChevronDown,
  FiChevronRight,
  FiCpu,
  FiMessageSquare,
  FiSearch,
  FiSquare,
  FiTerminal,
  FiX,
} from "react-icons/fi";
import type { ChatSummary } from "../../../../src/service/contracts/workbench.ts";
import type { WorkflowRun } from "../../../../src/service/contracts/workflow.ts";
import { usePage } from "../../history/use-page";
import { type MessageKey, useT } from "../../i18n/locale";
import { buildNavigationRows } from "../../navigation/assignment-rows";
import {
  groupByTime,
  matchesFilter,
  rowTime,
  type TimeGroupKey,
} from "../../navigation/time-groups";
import type {
  ActiveRuns,
  ListRequest,
  RunProjection,
  Scope,
  ServiceClient,
  WorkspaceBootstrap,
} from "../../types";
import { PageControls } from "../history/PageControls";
import {
  ActivityList,
  type ActivityListProps,
  activityKey,
} from "./ActivityList";
import { ConversationActions } from "./ConversationActions";
import { workflowActivity } from "./WorkflowPanel";

type OpenScope = (scope: Scope, snapshot?: string, label?: string) => void;
const TIME_GROUPS: Readonly<Record<TimeGroupKey, MessageKey>> = {
  today: "Today",
  yesterday: "Yesterday",
  earlier: "Earlier",
};

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
  executionStopped = false,
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
  chats = [],
  chatActivityKnown = true,
  chatHistoryPartial = false,
  chatHistoryControls,
  conversationId,
  onConversation,
  onNewConversation,
  workflows,
  workflowLinks = [],
  workflowError = false,
  discovery,
  selectedWorkflow,
  onWorkflow,
  onCancelWorkflow,
}: {
  client: ServiceClient;
  workspace?: WorkspaceBootstrap;
  executionStopped?: boolean;
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
  chats?: ChatSummary[];
  chatActivityKnown?: boolean;
  chatHistoryPartial?: boolean;
  chatHistoryControls?: ReactNode;
  conversationId?: string | null;
  onConversation?: (id: string) => void;
  onNewConversation?: () => void;
  /** Active Cadence workflow runs; undefined until first observed. */
  workflows?: WorkflowRun[];
  workflowLinks?: { runId: string; conversationId: string }[];
  workflowError?: boolean;
  discovery?: ActivityListProps;
  selectedWorkflow?: string;
  onWorkflow?: (run: WorkflowRun, conversationId: string | null) => void;
  onCancelWorkflow?: (run: WorkflowRun) => Promise<void>;
}) {
  const { t, tx, locale } = useT();
  // A filter over the history rows already listed; it reads nothing.
  const [filter, setFilter] = useState("");
  const request: ListRequest | null = workspace
    ? {
        reader: "tasks",
        storeId: workspace.storeId,
        scope: { kind: "workspace", id: workspace.workspaceId },
        snapshotSeq: null,
        after: null,
        limit: 50,
      }
    : null;
  const tasks = usePage(client, request);
  // Keep the retained read/Back stack in one stable owner when the selected task
  // moves from the running group into history, or a section is folded.
  const conversationPager = usePage(
    client,
    taskId && request && workspace
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
  const [stopping, setStopping] = useState<Set<string>>(() => new Set());
  const workflowRow = (run: WorkflowRun) => {
    const link =
      workflowLinks.find((entry) => entry.runId === run.id)?.conversationId ??
      null;
    return (
      <div key={run.id} className="conversation-group">
        <button
          type="button"
          className={`session-item${selectedWorkflow === run.id || (link && link === conversationId) ? " active" : ""}`}
          onClick={() => onWorkflow?.(run, link)}
          title={run.goal}
        >
          <span className="status-dot busy" aria-hidden="true" />
          <span className="session-info">
            <span className="session-title">{run.goal}</span>
            <span className="session-sub">
              {t("Cadence workflow")} · {tx(run.phase)} · {tx(run.status)}
            </span>
          </span>
        </button>
        {onCancelWorkflow && (
          <button
            type="button"
            className="conversation-stop"
            disabled={stopping.has(run.id)}
            onClick={() => {
              setStopping((value) => new Set(value).add(run.id));
              void onCancelWorkflow(run).finally(() =>
                setStopping((value) => {
                  const next = new Set(value);
                  next.delete(run.id);
                  return next;
                }),
              );
            }}
          >
            <FiSquare aria-hidden="true" />
            {t("Cancel workflow — request stop")}
          </button>
        )}
      </div>
    );
  };
  // Only live replies are "running"; the open conversation stays in history
  // (highlighted there) once its reply settles.
  const liveChats = chats.filter(
    (chat) => chat.status === "running" || chat.status === "queued",
  );
  const pastChats = chats.filter((chat) => !liveChats.includes(chat));
  // A conversation's live workflow is what it is doing, unless its reply ended
  // badly: that status stays (the workflow is listed under Running anyway).
  const liveWorkflow = (chat: ChatSummary) =>
    workflows?.findLast((run) =>
      workflowLinks.some(
        (link) => link.runId === run.id && link.conversationId === chat.id,
      ),
    );
  // A slim row: the title and when it last changed. Its icon says where the
  // conversation started; a second line appears only for a live workflow's
  // phase or a reply that is not simply completed.
  const chatRow = (chat: ChatSummary) => {
    const live = chat.status === "running" || chat.status === "queued";
    const flow =
      live || chat.status === "completed" ? liveWorkflow(chat) : undefined;
    const state = flow
      ? tx(workflowActivity(flow))
      : chat.cadence && live
        ? t("Discussing")
        : chat.status === "completed"
          ? ""
          : tx(chat.status);
    const origin =
      chat.origin === "terminal"
        ? t("Started in the terminal")
        : t("Started in the WebUI");
    const tag = locale === "zh" ? "zh-CN" : "en-GB";
    return (
      <button
        type="button"
        key={chat.id}
        className={`session-item${chat.id === conversationId ? " active" : ""}`}
        aria-current={chat.id === conversationId ? "true" : undefined}
        onClick={() => onConversation?.(chat.id)}
        title={chat.title}
      >
        <span
          className="session-icon"
          role="img"
          aria-label={origin}
          title={origin}
        >
          {chat.origin === "terminal" ? (
            <FiTerminal aria-hidden="true" />
          ) : (
            <FiMessageSquare aria-hidden="true" />
          )}
        </span>
        <span className="session-info">
          <span className="session-title">{chat.title}</span>
          {state && (
            <span
              className={`session-sub session-state ${flow ? "running" : chat.status}`}
            >
              {state}
            </span>
          )}
        </span>
        {chat.updatedAt > 0 && (
          <time
            className="session-time"
            dateTime={new Date(chat.updatedAt).toISOString()}
            title={new Date(chat.updatedAt).toLocaleString(tag)}
          >
            {rowTime(chat.updatedAt, tag)}
          </time>
        )}
      </button>
    );
  };
  const shownChats = pastChats.filter((chat) =>
    matchesFilter(chat.title, filter),
  );
  const shownTasks = history.filter((r) => matchesFilter(r.goal, filter));
  return (
    <aside className="panel panel-left lp-panel">
      {discovery && (
        <ActivityList
          {...discovery}
          represented={
            !executionStopped && discovery.project
              ? [
                  ...(workflows ?? []).map((r) =>
                    activityKey(
                      discovery.project as string,
                      "workflow",
                      r.id,
                      r.epoch,
                    ),
                  ),
                  ...liveChats.flatMap((chat) =>
                    chat.live
                      ? [
                          activityKey(
                            discovery.project as string,
                            "turn",
                            chat.live.commandId,
                            chat.live.epoch,
                          ),
                        ]
                      : [],
                  ),
                ]
              : []
          }
        />
      )}
      <ConversationActions onConversation={onNewConversation} />
      {!executionStopped && (
        <SidebarSection
          title={t("Running work")}
          count={
            activeRuns?.status === "complete" &&
            workflows &&
            !workflowError &&
            chatActivityKnown
              ? String(active.length + liveChats.length + workflows.length)
              : t("Not observed")
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
          {workflowError && (
            <p className="panel-hint">
              {t(
                "Workflow activity unavailable; retained work may still be running.",
              )}
            </p>
          )}
          {!chatActivityKnown && (
            <p className="panel-hint">
              {t("Conversation activity unavailable.")}
            </p>
          )}
          {liveChats.map(chatRow)}
          {workflows?.map(workflowRow)}
          {activeRuns?.status === "complete" &&
            active.length === 0 &&
            liveChats.length === 0 &&
            workflows?.length === 0 &&
            !workflowError &&
            chatActivityKnown && (
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
      )}
      <SidebarSection
        title={t("Conversation history")}
        count={
          !workspace
            ? `${pastChats.length}${chatHistoryPartial ? "+" : ""}`
            : tasks.page && !("kind" in tasks.page)
              ? `${pastChats.length + history.length}${tasks.page.next || tasks.canPrevious || chatHistoryPartial ? "+" : ""}`
              : t("Not observed")
        }
        className="grow"
      >
        <nav aria-label={t("Tasks")} className="task-list">
          {(pastChats.length > 0 || history.length > 0) && (
            <label className="lp-filter">
              <FiSearch aria-hidden="true" />
              <input
                type="search"
                value={filter}
                placeholder={t("Filter conversations…")}
                aria-label={t("Filter conversations…")}
                onChange={(event) => setFilter(event.target.value)}
              />
              {filter && (
                <button
                  type="button"
                  className="lp-filter-clear"
                  title={t("Clear filter")}
                  aria-label={t("Clear filter")}
                  onClick={() => setFilter("")}
                >
                  <FiX aria-hidden="true" />
                </button>
              )}
            </label>
          )}
          {groupByTime(shownChats, (chat) => chat.updatedAt).map((group) => (
            <div className="lp-time-group" key={group.key}>
              <h3 className="lp-time-label">{t(TIME_GROUPS[group.key])}</h3>
              {group.items.map(chatRow)}
            </div>
          ))}
          {shownTasks.length > 0 && (
            <h3 className="lp-time-label">{t("Tasks")}</h3>
          )}
          {shownTasks.map((r) => (
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
          {shownChats.length === 0 &&
            shownTasks.length === 0 &&
            (pastChats.length > 0 || history.length > 0) && (
              <p className="panel-hint" role="status">
                {t(
                  "No listed conversation matches. Pages not loaded are not searched.",
                )}
              </p>
            )}
          {tasks.page &&
            !("kind" in tasks.page) &&
            history.length === 0 &&
            pastChats.length === 0 &&
            !chatHistoryPartial && (
              <p className="panel-hint">{t("No conversations yet.")}</p>
            )}
          {chatHistoryControls}
          {workspace && <PageControls pager={tasks} compact />}
        </nav>
        {!shownTasks.some((r) => r.owner.taskId === taskId) && conversations}
      </SidebarSection>
    </aside>
  );
}
