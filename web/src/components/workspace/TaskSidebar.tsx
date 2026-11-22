/* Adapted from pi-web-ui LeftPanel.tsx project/current/history sections,
 * nested subagent rows, the filter box and time-grouped slim rows.
 * MIT (c) 2026 xing-shuyin. Navigation only observes the Cadence owner; no
 * session import, cwd mutation, replay or repair. A row's rename and archive
 * are explicit owner commands (`ConversationRow.tsx`). */
import {
  type ReactNode,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FiArchive,
  FiChevronDown,
  FiChevronRight,
  FiCpu,
  FiMessageSquare,
  FiSearch,
  FiSquare,
  FiX,
} from "react-icons/fi";
import type { Activity } from "../../../../src/service/contracts/activity.ts";
import type { ChatSummary } from "../../../../src/service/contracts/workbench.ts";
import type { WorkflowRun } from "../../../../src/service/contracts/workflow.ts";
import { unsettled } from "../../client/conversation-reader";
import { refusedAccess } from "../../client/observation-read";
import { useConversationHistory } from "../../client/use-conversation-history";
import type { RetainedTaskHistory } from "../../client/use-retained-task-workspace";
import { usePage } from "../../history/use-page";
import { type MessageKey, useT } from "../../i18n/locale";
import { buildNavigationRows } from "../../navigation/assignment-rows";
import {
  groupByTime,
  matchesFilter,
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
  ActivityRow,
  activityKey,
  groupProjectActivity,
  SessionWorkDetails,
} from "./ActivityList";
import { ConversationActions } from "./ConversationActions";
import {
  ArchivedList,
  ConversationRow,
  useConversationCommands,
} from "./ConversationRow";
import type { CanCancelWorkflow } from "./WorkflowPanel";
import "./history-activity.css";

type OpenScope = (scope: Scope, snapshot?: string, label?: string) => void;
const TIME_GROUPS: Readonly<Record<TimeGroupKey, MessageKey>> = {
  today: "Today",
  yesterday: "Yesterday",
  earlier: "Earlier",
};

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

/** History keeps its last local session and unattributed work across incomplete reads.
 * Only this display projection is extended, never the gateway feed or a roster
 * that supplies actions. Its lifetime spans the sidebar's loading/loaded views. */
export function useHistoryDiscovery(
  discovery?: ActivityListProps,
  allowed = true,
) {
  const path = discovery?.project,
    value = discovery?.value,
    error = discovery?.error;
  const previous = useRef<{ path: string; epoch: string; reports: Activity[] }>(
    null,
  );
  const projection = useMemo(() => {
    if (
      !allowed ||
      !path ||
      !value ||
      refusedAccess(error) ||
      error === "stale"
    )
      return;
    const local = value.projects.find((p) => p.path === path);
    const activities = local?.activities ?? [];
    const incomplete = !!error || value.completeness !== "complete";
    const last = previous.current;
    const seen = new Set(activities.map((a) => activityKey(path, a)));
    const missing =
      incomplete && last?.path === path && last.epoch === value.epoch
        ? last.reports
            .filter((a) => !seen.has(activityKey(path, a)))
            .map((a) => ({ ...a, freshness: "stale" as const }))
        : [];
    const reports = [...activities, ...missing];
    const selected = { path, activities: reports };
    // Retain what both local surfaces can display. Incompatible terminals
    // remain discovery-only; the history grouping still excludes them.
    const groups = groupProjectActivity(selected, new Set(), "discovery");
    return {
      retained: error
        ? last?.path === path && last.epoch === value.epoch
          ? last
          : null
        : {
            path,
            epoch: value.epoch,
            reports: [...groups.sessions.values(), groups.unlinked].flat(),
          },
      value: missing.length
        ? {
            ...value,
            projects: local
              ? value.projects.map((p) => (p === local ? selected : p))
              : [...value.projects, selected],
          }
        : value,
    };
  }, [allowed, path, value, error]);
  useLayoutEffect(() => {
    previous.current = projection?.retained ?? null;
  }, [projection]);
  if (!discovery || !path || !value) return discovery;
  if (refusedAccess(error)) return { ...discovery, value: undefined };
  // Changing observation identity retires the local prefix, not another
  // directory's independent (already freshness-bounded) discovery rows.
  return {
    ...discovery,
    value: projection?.value ?? {
      ...value,
      projects: value.projects.filter((p) => p.path !== path),
    },
  };
}

export function TaskSidebar({
  client,
  workspace,
  retained,
  executionStopped = false,
  taskId,
  scope,
  runs,
  snapshot,
  activeRuns,
  canCancel,
  canceling,
  onCancel,
  onTask,
  onScope,
  chats: listedChats,
  activeChats,
  chatActivityKnown = true,
  chatHistoryPartial = false,
  chatHistoryControls,
  conversationId,
  onConversation,
  onNewConversation,
  actionsUnavailable = "",
  actionCurrent = () => !actionsUnavailable,
  onConversationsChanged,
  workflows,
  workflowLinks = [],
  workflowError = false,
  discovery,
  selectedWorkflow,
  onWorkflow,
  canCancelWorkflow,
  onCancelWorkflow,
}: {
  client: ServiceClient;
  workspace?: WorkspaceBootstrap;
  retained?: RetainedTaskHistory;
  executionStopped?: boolean;
  taskId: string | null;
  scope: Scope | null;
  runs: RunProjection[];
  snapshot?: string;
  activeRuns?: ActiveRuns;
  canCancel: boolean;
  canceling: Set<string>;
  onCancel: (runId: string) => void;
  onTask: (id: string, title?: string) => void;
  onScope: OpenScope;
  chats?: ChatSummary[];
  /** Independent of the displayed page, including archived/unwritten replies. */
  activeChats?: ChatSummary[];
  chatActivityKnown?: boolean;
  chatHistoryPartial?: boolean;
  chatHistoryControls?: ReactNode;
  conversationId?: string | null;
  onConversation?: (id: string) => void;
  onNewConversation?: () => void;
  /** Why rename and archive cannot be requested now (they need a live
   * authenticated execution owner); empty when they can. */
  actionsUnavailable?: string;
  actionCurrent?(): boolean;
  /** A rename or archive was accepted, or its outcome is unknown: the
   * conversation lists should be read again. */
  onConversationsChanged?: (id: string) => void;
  /** Active Cadence workflow runs; undefined until first observed. */
  workflows?: WorkflowRun[];
  workflowLinks?: { runId: string; conversationId: string }[];
  workflowError?: boolean;
  discovery?: ActivityListProps;
  selectedWorkflow?: string;
  onWorkflow?: (run: WorkflowRun, conversationId: string | null) => void;
  canCancelWorkflow?: CanCancelWorkflow;
  onCancelWorkflow?: (run: WorkflowRun) => Promise<void>;
}) {
  const { t, tx } = useT();
  // A filter over the history rows already listed; it reads nothing.
  const [filter, setFilter] = useState("");
  // The conversations the history leaves out, read only while they are shown.
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true);
  // Older history beyond Today and Yesterday stays folded until expanded or filtered.
  const [earlierOpen, setEarlierOpen] = useState(false);
  const heading = useId();
  const archived = useConversationHistory(
    client,
    archivedOpen && historyOpen,
    true,
  );
  const refreshArchived = archived.refresh;
  const commands = useConversationCommands(client, (id) => {
    refreshArchived();
    onConversationsChanged?.(id);
  });
  const historyWorkspace = retained?.workspace ?? workspace;
  const historyClient = retained?.client ?? client;
  const request: ListRequest | null = historyWorkspace
    ? {
        reader: "tasks",
        storeId: historyWorkspace.storeId,
        scope: { kind: "workspace", id: historyWorkspace.workspaceId },
        snapshotSeq: retained?.workspace.committedSeq ?? null,
        after: null,
        limit: 50,
      }
    : null;
  const tasks = usePage(historyClient, request);
  // Keep the retained read/Back stack in one stable owner when the selected task
  // moves from the running group into history, or a section is folded.
  const conversationPager = usePage(
    historyClient,
    taskId && request && historyWorkspace
      ? {
          ...request,
          reader: "runs",
          scope: { kind: "task", id: taskId },
          snapshotSeq: snapshot ?? historyWorkspace.committedSeq,
        }
      : null,
  );
  const records =
    tasks.page && !("kind" in tasks.page)
      ? tasks.page.records.flatMap((r) => (r.kind === "task" ? [r] : []))
      : [];
  const active =
    !executionStopped && activeRuns?.status === "complete"
      ? activeRuns.runs
      : [];
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
  // Page order and last-write time change during work. Pin by session identity,
  // not by phase/mtime or by which of several associated runs was seen last.
  const chats = listedChats ?? [];
  const summaries = new Map(
    [...chats, ...(archived.value?.entries ?? []), ...(activeChats ?? [])].map(
      (chat) => [chat.id, chat],
    ),
  );
  // The owner keeps a reply on its roster through cleanup, even after its
  // result is recorded. Consult page hints only before the first roster read.
  const liveChats = executionStopped
    ? []
    : (activeChats ??
      [...summaries.values()].filter(
        (chat) => chat.live || unsettled(chat.status),
      ));
  const replying = new Set(liveChats.map((chat) => chat.id));
  const links = new Map(
    workflowLinks.map((link) => [link.runId, link.conversationId]),
  );
  const linked = new Map<string, WorkflowRun[]>();
  const unlinked: WorkflowRun[] = [];
  const roster = executionStopped ? [] : (workflows ?? []);
  for (const run of [...roster].sort((a, b) => a.id.localeCompare(b.id))) {
    const parent = links.get(run.id);
    if (parent) {
      const group = linked.get(parent) ?? [];
      group.push(run);
      linked.set(parent, group);
    } else unlinked.push(run);
  }
  const project = discovery?.project;
  const represented = new Set<string>();
  if (project) {
    for (const run of roster)
      represented.add(
        activityKey(project, {
          source: "workflow",
          id: run.id,
          epoch: run.epoch,
        }),
      );
    for (const chat of liveChats)
      if (chat.live)
        represented.add(
          activityKey(project, {
            source: "turn",
            id: chat.live.commandId,
            epoch: chat.live.epoch,
          }),
        );
  }
  const { sessions: discovered, unlinked: unlinkedReports } =
    groupProjectActivity(
      discovery?.value?.projects.find((p) => p.path === project),
      represented,
    );
  const unlinkedCount = unlinked.length + unlinkedReports.length;
  const unlinkedCurrent =
    (unlinked.length > 0 && !workflowError) ||
    (!discovery?.error &&
      unlinkedReports.some((a) => a.freshness === "current"));
  const pinned = new Set([...replying, ...linked.keys(), ...discovered.keys()]);
  // Stable first-observed tie-breaker for concurrent work that carries no
  // immutable start timestamp (e.g. terminal-only reports or older owners).
  const pinnedOrder = useRef<{ seq: number; seen: Map<string, number> }>({
    seq: 0,
    seen: new Map(),
  });
  const pinnedSignature = [...pinned].sort().join(",");
  useLayoutEffect(() => {
    const current = new Set(pinnedSignature ? pinnedSignature.split(",") : []);
    const { seen } = pinnedOrder.current;
    for (const id of [...seen.keys()]) {
      if (!current.has(id)) seen.delete(id);
    }
    for (const id of current) {
      if (!seen.has(id)) seen.set(id, ++pinnedOrder.current.seq);
    }
  }, [pinnedSignature]);
  const activeStartedAt = (id: string) => {
    let latest = summaries.get(id)?.live?.startedAt ?? 0;
    for (const run of linked.get(id) ?? []) {
      const at = run.diagnostics?.acceptedAt ?? 0;
      if (at > latest) latest = at;
    }
    return latest;
  };
  const orderedPinned = [...pinned].sort((a, b) => {
    const diff = activeStartedAt(b) - activeStartedAt(a);
    if (diff !== 0) return diff;
    const seenDiff =
      (pinnedOrder.current.seen.get(b) ?? 0) -
      (pinnedOrder.current.seen.get(a) ?? 0);
    if (seenDiff !== 0) return seenDiff;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const isPinnedLive = (id: string) => {
    const flows = linked.get(id);
    const reports = discovered.get(id);
    return (
      (replying.has(id) && chatActivityKnown) ||
      (!!flows && !workflowError) ||
      (!discovery?.error && !!reports?.some((a) => a.freshness === "current"))
    );
  };
  const pastChats = chats.filter((chat) => !pinned.has(chat.id));
  const activityKnown =
    executionStopped ||
    (chatActivityKnown && !workflowError && activeRuns?.status === "complete");
  const workflowRow = (run: WorkflowRun) => {
    const identity = `${run.goal} · ${run.id}`;
    const stop = t("Cancel workflow — request stop");
    const stopUnavailable = stopping.has(run.id)
      ? t("In progress…")
      : !canCancelWorkflow?.(run)
        ? t("Viewer access not confirmed")
        : undefined;
    return (
      <div key={run.id} className="history-run">
        <button
          type="button"
          className={`session-item${selectedWorkflow === run.id ? " active" : ""}`}
          aria-current={selectedWorkflow === run.id ? "true" : undefined}
          onClick={() => onWorkflow?.(run, links.get(run.id) ?? null)}
          title={`${t("Open workflow details")} · ${identity}`}
        >
          <span className="session-info">
            <span className="session-title">{run.goal}</span>
            <span className="session-sub">
              {t("Workflow")} · {run.id.slice(0, 8)}
            </span>
          </span>
          <FiChevronRight aria-hidden="true" />
        </button>
        {onCancelWorkflow && (
          <button
            type="button"
            className="conversation-stop"
            aria-label={`${stop} · ${identity}`}
            disabled={!!stopUnavailable}
            title={stopUnavailable}
            aria-description={stopUnavailable}
            onClick={() => {
              if (stopping.has(run.id) || !canCancelWorkflow?.(run)) return;
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
            {stop}
          </button>
        )}
      </div>
    );
  };
  const reportRow = (a: Activity) =>
    project &&
    discovery && (
      <ActivityRow
        key={activityKey(project, a)}
        grouped
        path={project}
        activity={a}
        opening={discovery.opening}
        onOpen={discovery.onOpen}
      />
    );
  const chatRow = (id: string, chat?: ChatSummary) => {
    const flows = linked.get(id);
    const reports = discovered.get(id);
    const workCount = (flows?.length ?? 0) + (reports?.length ?? 0);
    const details = reports
      ? !flows && reports.every((a) => a.source === "terminal")
        ? t("Terminal turn (observe only)")
        : t("Details")
      : t("Open workflow details");
    const busy = pinned.has(id);
    const status = chat?.status;
    const staleReply = unsettled(status) && !replying.has(id);
    const busyLive = busy && isPinnedLive(id);
    const activityLabel = busy
      ? busyLive
        ? t("Working")
        : t("Stale observation")
      : undefined;
    const activityState = busy
      ? busyLive
        ? ("live" as const)
        : ("stale" as const)
      : undefined;
    const showActions = !!chat && !replying.has(id) && !unsettled(status);
    const label = chat ?? {
      id,
      title: t("Conversation {id}", { id }),
    };
    return (
      <div
        key={id}
        className={workCount ? "history-entry has-workflows" : "history-entry"}
      >
        <ConversationRow
          chat={label}
          selected={id === conversationId}
          activityLabel={activityLabel}
          activityState={activityState}
          state={
            staleReply
              ? t("Not observed")
              : status && status !== "completed" && !unsettled(status)
                ? tx(status)
                : ""
          }
          tone={staleReply ? "unknown" : status}
          onOpen={() => {
            if (!chat && reports && project && discovery) {
              if (!discovery.opening) discovery.onOpen(project, reports[0]);
            } else onConversation?.(id);
          }}
          row={commands.states.get(id)}
          unavailable={actionsUnavailable}
          onArchive={
            showActions
              ? (value) => {
                  if (actionCurrent()) commands.archive(id, value);
                }
              : undefined
          }
          onRename={
            showActions && !chat?.archived
              ? (name) => {
                  if (actionCurrent()) commands.rename(id, name);
                }
              : undefined
          }
        />
        {workCount > 0 && (
          <SessionWorkDetails
            label={details}
            title={label.title}
            count={workCount}
          >
            {flows?.map(workflowRow)}
            {reports?.map(reportRow)}
          </SessionWorkDetails>
        )}
      </div>
    );
  };
  const shownPinned = orderedPinned.filter((id) => {
    const title = summaries.get(id)?.title ?? t("Conversation {id}", { id });
    return matchesFilter(title, filter);
  });
  const shownChats = pastChats.filter((chat) =>
    matchesFilter(chat.title, filter),
  );
  const shownTasks = history.filter((r) => matchesFilter(r.goal, filter));
  const timeGroups = groupByTime(shownChats, (chat) => chat.updatedAt);
  const todayChats = timeGroups.find((g) => g.key === "today")?.items ?? [];
  const yesterdayChats =
    timeGroups.find((g) => g.key === "yesterday")?.items ?? [];
  const earlierChats = timeGroups.find((g) => g.key === "earlier")?.items ?? [];
  const earlierExpanded = earlierOpen || filter.trim().length > 0;
  const page = tasks.page && !("kind" in tasks.page) ? tasks.page : undefined;
  const countKnown =
    activityKnown &&
    (!discovery ||
      (!discovery.error && discovery.value?.completeness === "complete")) &&
    (archivedOpen
      ? !!archived.value && !archived.error
      : !!listedChats && (!historyWorkspace || (!!page && !tasks.error)));
  const total = archivedOpen
    ? (archived.value?.entries ?? []).length
    : pastChats.length +
      history.length +
      new Set(active.map((run) => run.taskId)).size;
  const partial = archivedOpen
    ? archived.canPrevious || !!archived.value?.next
    : tasks.canPrevious || !!page?.next || chatHistoryPartial;
  const count = countKnown
    ? `${(archivedOpen ? 0 : pinned.size) + total}${partial ? "+" : ""}`
    : t("Not observed");
  const collapsedActive = pinned.size + unlinkedCount + active.length;
  const collapsedLive =
    orderedPinned.some(isPinnedLive) || unlinkedCurrent || active.length > 0;
  const hasFilterable =
    pinned.size > 0 || pastChats.length > 0 || history.length > 0;
  return (
    <aside className="panel panel-left lp-panel">
      {discovery && <ActivityList {...discovery} represented={represented} />}
      <ConversationActions onConversation={onNewConversation} />
      {/* One unified history section: running conversations stay pinned at the
          top of Today rather than floating above the history heading. */}
      <section className="lp-section grow" aria-labelledby={heading}>
        <div className="lp-section-body">
          <header className="lp-section-header">
            <button
              type="button"
              className="lp-section-heading"
              aria-expanded={historyOpen}
              onClick={() => setHistoryOpen(!historyOpen)}
            >
              {historyOpen ? (
                <FiChevronDown aria-hidden="true" />
              ) : (
                <FiChevronRight aria-hidden="true" />
              )}
              <span className="lp-section-title" id={heading}>
                {t(
                  archivedOpen
                    ? "Archived conversations"
                    : "Conversation history",
                )}
              </span>
              {!historyOpen && collapsedActive > 0 && (
                <span
                  role="img"
                  className={`lp-live-pill${collapsedLive ? "" : " stale"}`}
                  title={
                    collapsedLive
                      ? t("{count} running", { count: collapsedActive })
                      : t("Stale observation")
                  }
                  aria-label={
                    collapsedLive
                      ? t("{count} running", { count: collapsedActive })
                      : t("Stale observation")
                  }
                >
                  <span
                    className={`status-dot ${collapsedLive ? "live" : "busy"}`}
                    aria-hidden="true"
                  />
                  {collapsedActive}
                </span>
              )}
              <span className="lp-count">{count}</span>
            </button>
            <button
              type="button"
              className="lp-section-action"
              aria-pressed={archivedOpen}
              title={t(archivedOpen ? "Back to history" : "Show archived")}
              aria-label={t(archivedOpen ? "Back to history" : "Show archived")}
              onClick={() => {
                setHistoryOpen(true);
                setArchivedOpen(!archivedOpen);
              }}
            >
              <FiArchive aria-hidden="true" />
            </button>
          </header>
          {historyOpen && archivedOpen && (
            <ArchivedList
              list={archived}
              onBack={() => setArchivedOpen(false)}
              row={(chat) => chatRow(chat.id, chat)}
            />
          )}
          <nav
            aria-label={t("Tasks")}
            className="task-list"
            hidden={!historyOpen || archivedOpen}
          >
            {!executionStopped && activeRuns?.status !== "complete" && (
              <p className="panel-hint">
                {t(
                  "Active roster unavailable; absence is not proof of settlement.",
                )}
              </p>
            )}
            {!executionStopped && workflowError && (
              <p className="panel-hint">
                {t(
                  "Workflow activity unavailable; retained work may still be running.",
                )}
              </p>
            )}
            {!executionStopped && !chatActivityKnown && (
              <p className="panel-hint">
                {t("Conversation activity unavailable.")}
              </p>
            )}
            {hasFilterable && (
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
            {unlinkedCount > 0 && (
              <details className="history-unlinked">
                <summary>
                  <span
                    className={`status-dot ${unlinkedCurrent ? "live" : "busy"}`}
                    role="img"
                    aria-label={
                      unlinkedCurrent ? t("Working") : t("Stale observation")
                    }
                  />
                  {t("Unattributed work")} · {unlinkedCount}
                </summary>
                {unlinked.map(workflowRow)}
                {unlinkedReports.map(reportRow)}
              </details>
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
                    <span
                      className="status-dot live"
                      role="img"
                      aria-label={t("Working")}
                    />
                    <span className="session-info">
                      <span className="session-title">
                        {title ??
                          t("Task {id}", { id: run.taskId.slice(0, 8) })}
                      </span>
                      <span className="session-sub">
                        {tx(run.kind)} · {run.runId.slice(0, 8)}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="conversation-stop"
                    disabled={!canCancel || canceling.has(run.runId)}
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
            {(shownPinned.length > 0 || todayChats.length > 0) && (
              <div className="lp-time-group" key="today">
                <h3 className="lp-time-label">{t(TIME_GROUPS.today)}</h3>
                {shownPinned.map((id) => chatRow(id, summaries.get(id)))}
                {todayChats.map((chat) => chatRow(chat.id, chat))}
              </div>
            )}
            {yesterdayChats.length > 0 && (
              <div className="lp-time-group" key="yesterday">
                <h3 className="lp-time-label">{t(TIME_GROUPS.yesterday)}</h3>
                {yesterdayChats.map((chat) => chatRow(chat.id, chat))}
              </div>
            )}
            {earlierChats.length > 0 && (
              <div className="lp-time-group" key="earlier">
                <button
                  type="button"
                  className="lp-time-label lp-time-toggle"
                  aria-expanded={earlierExpanded}
                  onClick={() => setEarlierOpen((open) => !open)}
                >
                  {earlierExpanded ? (
                    <FiChevronDown aria-hidden="true" />
                  ) : (
                    <FiChevronRight aria-hidden="true" />
                  )}
                  <span>{t(TIME_GROUPS.earlier)}</span>
                  <span className="lp-time-count">{earlierChats.length}</span>
                </button>
                {earlierExpanded &&
                  earlierChats.map((chat) => chatRow(chat.id, chat))}
              </div>
            )}
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
            {shownPinned.length === 0 &&
              shownChats.length === 0 &&
              shownTasks.length === 0 &&
              hasFilterable && (
                <p className="panel-hint" role="status">
                  {t(
                    "No listed conversation matches. Pages not loaded are not searched.",
                  )}
                </p>
              )}
            {countKnown &&
              page &&
              history.length === 0 &&
              pastChats.length === 0 &&
              !pinned.size &&
              !unlinkedCount &&
              !active.length &&
              !chatHistoryPartial && (
                <p className="panel-hint">{t("No conversations yet.")}</p>
              )}
            {chatHistoryControls}
            {historyWorkspace && <PageControls pager={tasks} compact />}
          </nav>
          {historyOpen &&
            !archivedOpen &&
            !shownTasks.some((r) => r.owner.taskId === taskId) &&
            conversations}
        </div>
      </section>
    </aside>
  );
}
