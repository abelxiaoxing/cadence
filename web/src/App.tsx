/* Adapted from pi-web-ui App.tsx/LeftPanel/RightPanel three-pane composition,
 * responsive drawers and action-dialog families. MIT (c) 2026 xing-shuyin.
 * Cadence uses only its existing portable service client. No browser executor. */
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { IconType } from "react-icons";
import {
  FiChevronDown,
  FiClock,
  FiDownload,
  FiFolder,
  FiGitBranch,
  FiLayers,
  FiLink,
  FiMessageSquare,
  FiServer,
  FiSquare,
  FiTool,
} from "react-icons/fi";
import type { ProjectEntry } from "../../src/service/contracts/gateway.ts";
import type { ConversationLocation } from "../../src/service/contracts/models.ts";
import { canonicalJson } from "../../src/service-contract.ts";
import { type BrowserClient, browserClient } from "./client/browser";
import type { PreparationProgress } from "./client/conversation-send";
import type { FolderDraft } from "./client/folder-draft";
import type { PreviewModels } from "./client/model-preview";
import { activityRoute, chatFromLocation } from "./client/project-route";
import type { CommandObservation } from "./client/receipts";
import { mergeObservation } from "./client/receipts";
import { useConversationHistory } from "./client/use-conversation-history";
import type { ModelAvailability } from "./client/use-model-catalog";
import { useProjectObservation } from "./client/use-project-observation";
import { useWorkbench } from "./client/use-workbench";
import { useWorkspace } from "./client/use-workspace";
import { ViewLifetime } from "./client/view-lifetime";
import { ReceiptPanel } from "./components/actions/ReceiptPanel";
import { ContentExplorer } from "./components/history/ContentExplorer";
import { DetailPane } from "./components/history/DetailPane";
import { EntityPane } from "./components/history/EntityPane";
import { ExportDialog } from "./components/history/ExportDialog";
import { GlobalSearchModal } from "./components/history/GlobalSearchModal";
import { PageControls } from "./components/history/PageControls";
import { RunBrowser } from "./components/history/RunBrowser";
import { SearchBar } from "./components/history/SearchBar";
import { MessageList } from "./components/transcript/MessageList";
import { ToolCallBlock } from "./components/transcript/ToolCallBlock";
import {
  ActivityList,
  type ActivityListProps,
} from "./components/workspace/ActivityList";
import {
  AgentDock,
  type WorkflowAgent,
} from "./components/workspace/AgentDock";
import {
  ChatWorkspace,
  type ConversationActivity,
} from "./components/workspace/ChatWorkspace";
import { FilesPanel } from "./components/workspace/FilesPanel";
import { InspectorPanel } from "./components/workspace/InspectorPanel";
import { ProjectPicker } from "./components/workspace/ProjectPicker";
import { RunSummary } from "./components/workspace/RunSummary";
import { TaskSidebar } from "./components/workspace/TaskSidebar";
import { WorkflowAgentView } from "./components/workspace/WorkflowAgentView";
import { cancelWorkflow } from "./components/workspace/WorkflowPanel";
import { WorkingFolderButton } from "./components/workspace/WorkingFolderButton";
import { WorkspaceNotice } from "./components/workspace/WorkspaceNotice";
import { historyUrl, readHistoryUrl } from "./history/history-url";
import { usePage } from "./history/use-page";
import { useT } from "./i18n/locale";
import { AppShell } from "./layout/AppShell";
import { ContextStatus } from "./layout/ContextStatus";
import { StatusItem, WorkingStatus } from "./layout/StatusItem";
import { notify } from "./layout/toasts";
import { usePanelLayout } from "./layout/use-panel-layout";
import { copyTextToClipboard } from "./rich/use-copy-feedback";
import { TimelineView } from "./timeline/TimelineView";
import type { ListRequest, ReadCursor, Scope, SearchHit } from "./types";

const VIEWS: readonly (readonly [string, IconType])[] = [
  ["tools", FiTool],
  ["context", FiLayers],
  ["timeline", FiClock],
  ["runs", FiGitBranch],
];
export function App({
  api: provided,
  onOpenProject,
  homeFolder,
  projectEntries,
  notices,
  discovery,
  onOpenService,
  project,
  onChooseFolder,
  onPrepareSend,
  directoryNamespaces,
  previewModels,
  initialDraft,
  onDraftApplied,
}: {
  api?: BrowserClient;
  previewModels?: PreviewModels;
  initialDraft?: FolderDraft & { conversationId: string };
  onDraftApplied?(conversationId: string): void;
  project?: ProjectEntry;
  directoryNamespaces?: string[];
  onChooseFolder?(cwd?: string): void;
  onPrepareSend?(
    signal: AbortSignal,
    location?: ConversationLocation,
    progress?: PreparationProgress,
  ): Promise<string>;
  onOpenProject?(path: string): Promise<void>;
  homeFolder?: string;
  projectEntries?: { path: string; current: boolean }[];
  /** Workbench-supplied banners (automatic recovery). */
  notices?: ReactNode;
  discovery?: ActivityListProps;
  /** The workbench's service restart and upgrade; absent on a direct owner. */
  onOpenService?(): void;
}) {
  const { t, tx } = useT();
  const [api] = useState(() => provided ?? browserClient());
  const [activityHash, setActivityHash] = useState(() =>
    typeof window === "undefined" ? "" : window.location.hash,
  );
  const [detached, setDetached] = useState(false);
  const [initial] = useState(readHistoryUrl),
    [taskId, setTaskId] = useState<string | null>(initial?.taskId ?? null);
  const [chatId, setChatId] = useState<string | null>(() =>
    initial ? null : (chatFromLocation() ?? crypto.randomUUID()),
  );
  const activitySelection = activityRoute(activityHash, chatId ?? "");
  // A workflow subagent (or run) shown in the main area over the current view.
  const [agent, setAgent] = useState<WorkflowAgent | null>(null);
  const [chatRuns, setChatRuns] = useState<string[]>([]);
  const [projectOpen, setProjectOpen] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<"files" | "task">(
    initial ? "task" : "files",
  );
  const [reference, setReference] = useState<string>();
  const [chatLocation, setChatLocation] = useState<ConversationLocation>();
  // What the open conversation reports for the statusbar; another
  // conversation's last report is never shown for this one.
  const [reported, setReported] = useState<ConversationActivity>();
  // Counts renames and archives of the open conversation requested from the
  // sidebar, so its head is read again rather than on its next idle poll.
  const [summaryChanges, setSummaryChanges] = useState(0);
  const [newConversationCwd, setNewConversationCwd] = useState<
    string | undefined
  >(() => {
    const saved = typeof history === "undefined" ? null : history.state;
    const chat = chatFromLocation();
    return chat &&
      saved?.cadenceConversationId === chat &&
      typeof saved?.cadenceCwd === "string"
      ? saved.cadenceCwd
      : undefined;
  });
  const [filesConversationId] = useState(() => crypto.randomUUID());
  const clearReference = useCallback(() => setReference(undefined), []);
  const [scope, setScope] = useState<Scope | null>(
    initial ? (initial.scope ?? { kind: "task", id: initial.taskId }) : null,
  );
  const execution = useProjectObservation(project?.id, project?.epoch);
  const executionReady = !project || execution.readiness === "running";
  const executionStopped =
    !!project &&
    (execution.readiness === "stopped" ||
      execution.readiness === "not-started");
  // A failed readiness read must not discard an existing safety attachment.
  // Only a positive Stop or replacement epoch changes that lifetime.
  const executionEpoch = useRef<string | null>(null);
  if (executionReady && execution.value?.epoch)
    executionEpoch.current = execution.value.epoch;
  const observeExecution =
    !project ||
    (!executionStopped && (executionReady || executionEpoch.current !== null));
  const workspace = useWorkspace(
    api,
    taskId ? { kind: "task", id: taskId } : null,
    !detached && observeExecution,
    executionEpoch.current,
  );
  // Presentation only: an empty first attachment is still loading, not stale.
  // Once data or a failure was observed, a reset/reconnect must not look new.
  const initialViewer = useRef(true);
  if (
    workspace.workspace ||
    workspace.observation ||
    workspace.error ||
    workspace.transportStatus === "stale" ||
    workspace.compatible === false
  )
    initialViewer.current = false;
  // A readiness refusal is not a conversation identity failure. Keep readonly
  // history and drafts reachable; only explicit Send can prepare execution.
  const projectObserved = !!(project && (execution.value || execution.error));
  const conversationAvailable =
    !detached && !!(workspace.workspace || projectObserved);
  const chatWorkspace = useRef<string | null>(null);
  if (workspace.workspace || execution.value?.workspaceId)
    chatWorkspace.current =
      workspace.workspace?.workspaceId ?? execution.value?.workspaceId ?? null;
  const prepareSend = onPrepareSend
    ? async (
        signal: AbortSignal,
        location?: ConversationLocation,
        progress?: PreparationProgress,
      ) => {
        const epoch = await onPrepareSend(signal, location, progress);
        if (signal.aborted) throw new Error("stale");
        execution.prepared(epoch);
        const observation = workspace.reconnect();
        await workspace.whenReady(epoch, signal, observation);
      }
    : undefined;
  const chats = useConversationHistory(api.client, conversationAvailable);
  const chatActivity = useWorkbench(
    api.client,
    workspace.workspace && !detached ? { kind: "conversation-active" } : null,
    1000,
  );
  const activeChats =
    chatActivity.value?.kind === "conversation-active"
      ? chatActivity.value.entries
      : [];
  const chatEntries = [
    ...activeChats,
    ...(chats.value?.entries ?? []).filter(
      (row) => !activeChats.some((active) => active.id === row.id),
    ),
  ];
  const workflowActivity = useWorkbench(
    api.client,
    workspace.workspace && !detached ? { kind: "workflow-active" } : null,
    2000,
  );
  const background =
    workflowActivity.value?.kind === "workflow-active"
      ? workflowActivity.value
      : undefined;
  const workflowIds = useMemo(
    () => [
      ...new Set([
        ...(background?.runs.map((run) => run.id) ?? []),
        ...chatRuns,
      ]),
    ],
    [background, chatRuns],
  );
  const projects = useWorkbench(
    api.client,
    !project && workspace.workspace && !detached ? { kind: "projects" } : null,
  );
  const initialCwd =
    newConversationCwd ??
    project?.cwd ??
    (projects.value?.kind === "projects"
      ? projects.value.entries.find((entry) => entry.current)?.path
      : undefined);
  const currentChatLocation =
    chatLocation?.id === chatId ? chatLocation : undefined;
  const activity = reported?.id === chatId ? reported : undefined;
  useEffect(() => {
    if (currentChatLocation && chatFromLocation() === currentChatLocation.id)
      history.replaceState(
        {
          ...history.state,
          cadenceCwd: currentChatLocation.cwd,
          cadenceConversationId: currentChatLocation.id,
        },
        "",
        location.href,
      );
  }, [currentChatLocation]);
  const fileLocation = chatId
    ? currentChatLocation
    : initialCwd
      ? { id: filesConversationId, cwd: initialCwd }
      : undefined;
  const workingFolder =
    currentChatLocation?.cwd ??
    initialCwd ??
    (projects.value?.kind === "projects"
      ? projects.value.entries.find((entry) => entry.current)?.path
      : undefined) ??
    workspace.workspace?.rootLabel;
  const observation = {
    state: workspace.observation,
    transportStatus: workspace.transportStatus,
    error: workspace.error,
    refresh: workspace.refresh,
  };
  const current =
    observation.state?.snapshot.scope.kind === "task" &&
    observation.state.snapshot.scope.id === taskId
      ? observation.state.snapshot.context
      : undefined;
  const panels = usePanelLayout();
  const { closeDrawer } = panels;
  const [selectedSnapshot, setSelectedSnapshot] = useState<string | undefined>(
    initial?.snapshotSeq,
  );
  const [taskTitle, setTaskTitle] = useState("");
  const [scopeTitle, setScopeTitle] = useState("");
  const viewMenu = useRef<HTMLDetailsElement>(null);
  const [tab, setTab] = useState("messages"),
    [searchOpen, setSearchOpen] = useState(false),
    [exportOpen, setExportOpen] = useState(false);
  const [hit, setHit] = useState<SearchHit>(),
    [detail, setDetail] = useState<ReadCursor | undefined>(initial?.cursor);
  const [error, setError] = useState("");
  const [receipts, setReceipts] = useState<CommandObservation[]>([]),
    [canceling, setCanceling] = useState(new Set<string>());
  const mounted = useRef(true);
  const setReceipt = (value: CommandObservation) => {
    if (!mounted.current) return;
    setReceipts((previous) => {
      const index = previous.findIndex(
        (item) => item.commandId === value.commandId,
      );
      if (index < 0) return [...previous, value];
      return previous.map((item, i) =>
        i === index ? mergeObservation(item, value) : item,
      );
    });
  };
  const lifetime = useRef(new ViewLifetime());
  const viewIdentity = canonicalJson({
    taskId,
    scope,
    selectedSnapshot: selectedSnapshot ?? null,
    detached,
    attachment: workspace.attachmentVersion,
    workspaceContext: workspace.workspace?.context ?? null,
    observationError: workspace.error ?? null,
  });
  lifetime.current.select(viewIdentity);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      lifetime.current.depart();
    };
  }, []);
  const selectChat = (selected?: string) => {
    setActivityHash("");
    const id = selected ?? crypto.randomUUID();
    if (!selected) setNewConversationCwd(workingFolder ?? initialCwd);
    setAgent(null);
    if (id !== chatId) {
      setChatRuns([]);
      setReference(undefined);
    }
    lifetime.current.depart();
    setChatId(id);
    setTaskId(null);
    setScope(null);
    setTaskTitle("");
    setScopeTitle("");
    setHit(undefined);
    setDetail(undefined);
    setSelectedSnapshot(undefined);
    setTab("messages");
    setRightTab("files");
    closeDrawer();
    history.replaceState(
      { cadenceCwd: workingFolder ?? initialCwd, cadenceConversationId: id },
      "",
      `${location.pathname}${location.search}#chat=${id}`,
    );
  };
  useEffect(() => {
    if (chatId && !window.location.hash)
      history.replaceState(
        null,
        "",
        `${location.pathname}${location.search}#chat=${chatId}`,
      );
  }, [chatId]);
  const selectTask = (id: string, title?: string) => {
    setAgent(null);
    setChatRuns([]);
    setChatId(null);
    setRightTab("task");
    setTaskTitle(title ?? "");
    setScopeTitle("");
    setSelectedSnapshot(undefined);
    lifetime.current.depart();
    setTaskId(id);
    setScope({ kind: "task", id });
    setHit(undefined);
    setDetail(undefined);
    setTab("messages");
    closeDrawer();
    history.replaceState(null, "", historyUrl(id));
  };
  useEffect(() => {
    const navigate = () => {
      const target = readHistoryUrl();
      if (!target) {
        const chat = chatFromLocation();
        if (chat) {
          setActivityHash(window.location.hash);
          const cwd = history.state?.cadenceCwd;
          if (typeof cwd === "string") setNewConversationCwd(cwd);
          setReference(undefined);
          setAgent(null);
          setChatRuns([]);
          setChatId(chat);
          setTaskId(null);
          setScope(null);
          setRightTab("files");
          lifetime.current.depart();
          closeDrawer();
        }
        return;
      }
      setAgent(null);
      setChatRuns([]);
      setChatId(null);
      setRightTab("task");
      // Same-document links/back navigation observe the exact new task too.
      // Changing a hash never refreshes a grant or replays an action.
      lifetime.current.depart();
      setSelectedSnapshot(target.snapshotSeq);
      setTaskTitle("");
      setScopeTitle("");
      setTaskId(target.taskId);
      setScope(target.scope ?? { kind: "task", id: target.taskId });
      setHit(undefined);
      setDetail(target.cursor);
      setTab("messages");
      closeDrawer();
    };
    window.addEventListener("hashchange", navigate);
    window.addEventListener("popstate", navigate);
    return () => {
      window.removeEventListener("hashchange", navigate);
      window.removeEventListener("popstate", navigate);
    };
  }, [closeDrawer]);
  const selectScope = (value: Scope, snapshot?: string, label?: string) => {
    setAgent(null);
    setSelectedSnapshot(snapshot);
    setScopeTitle(label ?? "");
    lifetime.current.depart();
    setScope(value);
    setHit(undefined);
    setDetail(undefined);
    setTab("messages");
    closeDrawer();
    if (taskId)
      history.replaceState(
        null,
        "",
        historyUrl(taskId, undefined, { scope: value, snapshotSeq: snapshot }),
      );
  };
  const snapshotSeq =
    selectedSnapshot ??
    observation.state?.snapshot.committedSeq ??
    workspace.workspace?.committedSeq;
  const storeId = workspace.workspace?.storeId;
  const seed: ListRequest | null =
    scope && storeId && snapshotSeq
      ? {
          storeId,
          scope,
          snapshotSeq,
          reader: "messages",
          after: null,
          limit: 50,
        }
      : null;
  const searchSeed: ReadCursor | null =
    scope && storeId && snapshotSeq
      ? {
          storeId,
          scope,
          snapshotSeq,
          query: null,
          recordId: null,
          recordVersion: null,
          field: null,
          offset: 0,
        }
      : null;
  const runs = current ? (observation.state?.snapshot.runs ?? []) : [];
  const resultTicket = lifetime.current.ticket();
  const result = (value: CommandObservation) => {
    setReceipt(value);
    if (value.receipt && lifetime.current.current(resultTicket))
      workspace.refresh();
  };
  const cancel = (runId: string) => {
    if (
      canceling.has(runId) ||
      !workspace.cancelCompatible ||
      !workspace.activeRuns
    )
      return;
    const commandId = crypto.randomUUID(),
      epoch = workspace.activeRuns.epoch;
    setCanceling((prev) => new Set(prev).add(runId));
    setReceipt({
      commandId,
      error: t("Stop requested; settlement is not yet confirmed."),
    });
    void api.client
      .cancel({ commandId, epoch, runId })
      .then((reply) => {
        result(
          reply.kind === "ok"
            ? { commandId, receipt: reply.value }
            : {
                commandId,
                error: t(
                  "{code}; cancellation effect {effect}. Observe exact receipt.",
                  { code: reply.error.code, effect: reply.error.effect },
                ),
              },
        );
      })
      .catch(() =>
        setReceipt({
          commandId,
          error: t("Cancellation effect uncertain. Observe exact receipt."),
        }),
      )
      .finally(() => {
        // This locks only the in-flight request, not the run's settlement. A
        // refusal/lost reply must not remove explicit safety stop authority.
        // Retain the receipt; another click is explicit, never an automatic retry.
        if (mounted.current)
          setCanceling((previous) => {
            const next = new Set(previous);
            next.delete(runId);
            return next;
          });
      });
  };
  if (detached)
    return (
      <main className="entry">
        <span className="empty-logo" aria-hidden="true">
          C
        </span>
        <h1>{t("Detached")}</h1>
        <p>{t("Accepted service work continues. No Cancel was requested.")}</p>
        {receipts.map((value) => (
          <p key={value.commandId}>
            {t("Observe command after reconnect:")}{" "}
            <code>{value.commandId}</code>
          </p>
        ))}
        <button
          type="button"
          className="primary"
          onClick={() => setDetached(false)}
        >
          {t("Reconnect as a viewer")}
        </button>
      </main>
    );
  const roster = workspace.activeRuns;
  const activeRuns = roster?.status === "complete" ? roster.runs : [];
  const viewerFresh =
    !detached &&
    !workspace.error &&
    workspace.transportStatus === "current" &&
    (!observation.state || observation.state.connection === "current");
  const observationFresh = executionReady && viewerFresh;
  // What an owner-side action needs: a live compatible owner, freshly observed.
  const actionsReady =
    executionReady &&
    !!workspace.workspace &&
    !!workspace.compatible &&
    !workspace.error &&
    viewerFresh;
  const connecting =
    initialViewer.current &&
    !observation.state &&
    !observation.error &&
    !execution.error &&
    (!project ||
      (!execution.value && execution.readiness === "unknown") ||
      execution.readiness === "running");
  const modelAvailability: ModelAvailability = executionStopped
    ? {
        status:
          execution.readiness === "not-started" ? "not-started" : "stopped",
      }
    : workspace.compatible === false
      ? { status: "incompatible" }
      : executionReady &&
          viewerFresh &&
          workspace.compatible &&
          workspace.epoch &&
          (!project || execution.value?.epoch === workspace.epoch)
        ? {
            status: "ready",
            epoch: workspace.epoch,
            attachmentVersion: workspace.attachmentVersion,
          }
        : { status: connecting ? "connecting" : "unavailable" };
  const connection = detached
    ? "Viewer disconnected"
    : connecting
      ? "Connecting…"
      : project && execution.readiness === "unknown"
        ? "Project readiness unknown"
        : project && execution.readiness === "stale"
          ? "Project observation stale"
          : executionStopped
            ? "Ready to prepare on Send"
            : !viewerFresh
              ? "Viewer observation stale"
              : !workspace.workspace
                ? "Viewer observation unavailable"
                : (observation.state?.connection ??
                  (taskId ? "Task snapshot not observed yet" : "Chat ready"));
  return (
    <>
      <AppShell
        panels={panels}
        compatible={workspace.compatible}
        onOpenService={onOpenService}
        onRefresh={() => {
          workspace.refresh();
          execution.refresh();
        }}
        onDisconnect={() => {
          setSearchOpen(false);
          setExportOpen(false);
          lifetime.current.depart();
          setDetached(true);
        }}
        inspectorLabel={
          scope && rightTab === "task" ? t("History details") : t("Files")
        }
        toolbar={
          scope && (
            <nav className="tb-tabs" aria-label={t("Recorded views")}>
              <button
                type="button"
                className="tb-tab"
                aria-pressed={tab === "messages" && !detail}
                onClick={() => {
                  setDetail(undefined);
                  setHit(undefined);
                  setTab("messages");
                }}
              >
                <FiMessageSquare aria-hidden="true" />
                {t("Conversation")}
              </button>
              <details
                className="view-menu"
                ref={viewMenu}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && viewMenu.current) {
                    viewMenu.current.open = false;
                    viewMenu.current.querySelector("summary")?.focus();
                  }
                }}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget))
                    event.currentTarget.open = false;
                }}
              >
                <summary className="chip">
                  {tab === "messages" ? t("Details") : tx(tab)}
                  <FiChevronDown aria-hidden="true" />
                </summary>
                <div className="view-menu-items">
                  {VIEWS.map(([view, Icon]) => (
                    <button
                      type="button"
                      key={view}
                      aria-pressed={tab === view}
                      onClick={() => {
                        setDetail(undefined);
                        setHit(undefined);
                        setTab(view);
                        if (viewMenu.current) {
                          viewMenu.current.open = false;
                          viewMenu.current.querySelector("summary")?.focus();
                        }
                      }}
                    >
                      <Icon aria-hidden="true" />
                      {tx(view)}
                    </button>
                  ))}
                  <div className="view-menu-actions">
                    <button
                      type="button"
                      aria-label={t("Export selected scope")}
                      disabled={!seed}
                      onClick={() => {
                        if (viewMenu.current) {
                          viewMenu.current.open = false;
                          viewMenu.current.querySelector("summary")?.focus();
                        }
                        setExportOpen(true);
                      }}
                    >
                      <FiDownload aria-hidden="true" />
                      {t("Export selected scope")}
                    </button>
                    <button
                      type="button"
                      aria-label={t("Copy token-free link")}
                      disabled={!taskId}
                      onClick={() => {
                        if (taskId)
                          void copyTextToClipboard(
                            historyUrl(
                              taskId,
                              detail,
                              scope
                                ? { scope, snapshotSeq: selectedSnapshot }
                                : undefined,
                            ),
                          ).then((ok) =>
                            ok
                              ? notify("info", t("Link copied."))
                              : notify("error", t("Link copy unavailable.")),
                          );
                      }}
                    >
                      <FiLink aria-hidden="true" />
                      {t("Copy token-free link")}
                    </button>
                  </div>
                </div>
              </details>
            </nav>
          )
        }
        actions={
          scope && (
            <SearchBar
              disabled={!searchSeed}
              onOpen={() => setSearchOpen(true)}
            />
          )
        }
        notices={
          <>
            {!workspace.workspace && activeRuns.length > 0 && (
              <section
                className="run-strip"
                aria-label={t("Execution and cancellation")}
              >
                {activeRuns.map((r) => (
                  <div className="run-strip-row" key={r.runId}>
                    <span className="status-dot busy" aria-hidden="true" />
                    <span className="run-strip-label">
                      {tx(r.kind)} {r.runId} · {tx(r.stage)}
                    </span>
                    <button type="button" onClick={() => selectTask(r.taskId)}>
                      {t("Open active task")}
                    </button>
                    <button
                      type="button"
                      className="danger"
                      disabled={
                        !workspace.cancelCompatible || canceling.has(r.runId)
                      }
                      onClick={() => cancel(r.runId)}
                    >
                      <FiSquare aria-hidden="true" />
                      {t("Cancel run — request stop")}
                    </button>
                  </div>
                ))}
              </section>
            )}
            {notices}
            <WorkspaceNotice
              error={error}
              projectObservationError={execution.error}
              observationError={workspace.error}
              unavailable={
                !connecting && !executionStopped && !observationFresh
              }
              onRefresh={() => {
                workspace.refresh();
                execution.refresh();
              }}
            />
          </>
        }
        navigation={
          <>
            {!conversationAvailable && (
              <aside className="panel panel-left lp-panel">
                {discovery && <ActivityList {...discovery} />}
                <p className="panel-empty" role="status">
                  {connecting
                    ? t("Reading conversation history…")
                    : t(
                        "Conversation history could not be read. This is not an empty history.",
                      )}
                </p>
              </aside>
            )}
            {conversationAvailable && (
              <TaskSidebar
                discovery={discovery}
                client={api.client}
                workspace={workspace.workspace}
                executionStopped={executionStopped}
                taskId={taskId}
                scope={scope}
                runs={runs}
                snapshot={observation.state?.snapshot.committedSeq}
                activeRuns={workspace.activeRuns}
                cancelCompatible={!!workspace.cancelCompatible}
                canceling={canceling}
                onCancel={cancel}
                chats={chatEntries}
                chatActivityKnown={
                  chatActivity.value?.kind === "conversation-active" &&
                  !chatActivity.error
                }
                chatHistoryPartial={
                  chats.loading || chats.canPrevious || !!chats.value?.next
                }
                chatHistoryControls={
                  <>
                    {chats.error && <p role="alert">{chats.error}</p>}
                    {chats.loading && (
                      <p className="panel-hint">
                        {t("Reading conversation history…")}
                      </p>
                    )}
                    {chats.canPrevious && (
                      <button
                        type="button"
                        disabled={chats.loading}
                        onClick={chats.previous}
                      >
                        {t("Newer conversations")}
                      </button>
                    )}
                    {chats.value?.next && (
                      <button
                        type="button"
                        disabled={chats.loading}
                        onClick={chats.next}
                      >
                        {t("Older conversations")}
                      </button>
                    )}
                    {chats.canPrevious && (
                      <button type="button" onClick={chats.first}>
                        {t("Latest conversations")}
                      </button>
                    )}
                    {chats.error && (
                      <button type="button" onClick={chats.refresh}>
                        {t("Observe current state")}
                      </button>
                    )}
                  </>
                }
                conversationId={chatId}
                onConversation={selectChat}
                onNewConversation={() => selectChat()}
                actionsUnavailable={
                  actionsReady
                    ? ""
                    : executionStopped
                      ? t(
                          "Rename and archive need the execution service; it starts with your next Send.",
                        )
                      : t(
                          "Rename and archive are unavailable until the execution service is observed.",
                        )
                }
                onConversationsChanged={(id) => {
                  // The lists and the open conversation's head say what is
                  // recorded; nothing here is changed ahead of those reads.
                  chats.refresh();
                  if (id === chatId) setSummaryChanges((count) => count + 1);
                }}
                workflows={background?.runs}
                workflowLinks={background?.links}
                workflowError={!!workflowActivity.error}
                selectedWorkflow={agent?.runId}
                onWorkflow={(run, conversationId) => {
                  if (conversationId) selectChat(conversationId);
                  else {
                    setAgent({ runId: run.id, stepId: null, label: run.goal });
                    closeDrawer();
                  }
                }}
                onCancelWorkflow={async (run) => {
                  // The banner holds the last request's refusal: an accepted
                  // request clears it, nothing else does.
                  setError(await cancelWorkflow(api.client, run));
                  workflowActivity.refresh();
                }}
                onTask={selectTask}
                onScope={selectScope}
              />
            )}
            {workspace.workspace && (
              <AgentDock
                client={api.client}
                active={workspace.activeRuns}
                taskId={taskId}
                runs={runs}
                snapshot={snapshotSeq}
                workflowRuns={workflowIds}
                selected={agent}
                onOpenWorkflow={(next) => {
                  setAgent(next);
                  closeDrawer();
                }}
                onOpen={(parent, child, snapshot, label) => {
                  selectTask(parent);
                  setScope({ kind: "child", id: child });
                  setScopeTitle(label);
                  setSelectedSnapshot(snapshot);
                  history.replaceState(
                    null,
                    "",
                    historyUrl(parent, undefined, {
                      scope: { kind: "child", id: child },
                      snapshotSeq: snapshot,
                    }),
                  );
                }}
              />
            )}
          </>
        }
        content={
          <>
            {chatId && project && !projectObserved && (
              <p className="panel-empty" role="status">
                {t("Reading this conversation…")}
              </p>
            )}
            {agent && (
              <WorkflowAgentView
                key={`${agent.runId}:${agent.stepId ?? ""}`}
                client={api.client}
                agent={agent}
                backLabel={
                  chatId
                    ? t("Back to conversation")
                    : taskId
                      ? t("Back to task")
                      : t("Back")
                }
                onBack={() => setAgent(null)}
                onOpenAgent={setAgent}
              />
            )}
            {chatId && (!project || projectObserved) && (
              <ChatWorkspace
                key={`${project?.id ?? chatWorkspace.current ?? "connecting"}:${chatId}:${activitySelection.leaf ?? ""}`}
                client={api.client}
                id={chatId}
                activitySelected={activitySelection.selected}
                initialLeaf={activitySelection.leaf}
                initialCwd={initialCwd}
                onLocation={setChatLocation}
                onActivity={setReported}
                hidden={!!agent}
                onOpenAgent={setAgent}
                onWorkflowRuns={setChatRuns}
                workspaceId={
                  project
                    ? `checkout:${project.path}`
                    : (chatWorkspace.current ?? "connecting")
                }
                directoryNamespaces={directoryNamespaces}
                legacyWorkspaceId={
                  project
                    ? (execution.value?.workspaceId ?? undefined)
                    : undefined
                }
                prepareForSend={prepareSend}
                actionsReady={actionsReady}
                observe={summaryChanges}
                available={conversationAvailable}
                canInterrupt={!!workspace.cancelCompatible}
                enabled={
                  prepareSend
                    ? conversationAvailable
                    : !!workspace.workspace &&
                      !!workspace.compatible &&
                      !workspace.error
                }
                modelAvailability={modelAvailability}
                previewModels={previewModels}
                initialDraft={
                  initialDraft?.conversationId === chatId
                    ? initialDraft
                    : undefined
                }
                onDraftApplied={() => onDraftApplied?.(chatId)}
                onModelChanged={() => {
                  lifetime.current.depart();
                  workspace.refresh(true);
                  execution.refresh();
                }}
                onChanged={() => {
                  chats.refresh();
                  workspace.refresh();
                }}
                reference={reference}
                onReferenceUsed={clearReference}
              />
            )}
            {scope && !agent && (
              <header className="conversation-header">
                <div className="conversation-heading">
                  {scope.kind !== "task" && taskId && (
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => selectTask(taskId, taskTitle)}
                    >
                      {t("Back to task")}
                    </button>
                  )}

                  <h2 title={taskTitle || scope.id}>
                    {scope.kind === "task"
                      ? taskTitle ||
                        t("Task {id}", { id: scope.id.slice(0, 8) })
                      : scopeTitle ||
                        t("{kind} {id}", {
                          kind: tx(scope.kind),
                          id: scope.id.slice(0, 8),
                        })}
                  </h2>
                  {scope.kind === "child" && (
                    <span className="conversation-badge">{t("Subagent")}</span>
                  )}
                </div>
                <details className="conversation-info">
                  <summary>
                    {t("Recorded conversation")} ·{" "}
                    {t("snapshot {seq}", { seq: snapshotSeq ?? "" })}
                  </summary>
                  <code>{scope.id}</code>
                  <p>
                    {t(
                      "Pages and old outcomes are historical observations, not renewed consent.",
                    )}
                  </p>
                </details>
              </header>
            )}
            <div className="workspace-content" hidden={!!chatId || !!agent}>
              {!seed && (
                <section className="empty-state">
                  <span className="empty-logo" aria-hidden="true">
                    C
                  </span>
                  <h2>
                    {workspace.error
                      ? t("Recorded history could not be read.")
                      : t("Reading recorded history…")}
                  </h2>
                  <p>
                    {t(
                      "History is readonly. Start new work in a conversation with /cadence.",
                    )}
                  </p>
                </section>
              )}
              {seed && detail ? (
                <div className="tab-body">
                  {hit &&
                    (hit.owner.entity.kind === "task" ||
                      hit.owner.entity.kind === "message" ||
                      hit.owner.entity.kind === "tool") && (
                      <EntityPane
                        key={`${hit.owner.entity.id}:${hit.owner.entity.version}`}
                        client={api.client}
                        seed={{
                          storeId: detail.storeId,
                          scope: detail.scope,
                          snapshotSeq: detail.snapshotSeq,
                          kind: hit.owner.entity.kind,
                          id: hit.owner.entity.id,
                          version: hit.owner.entity.version,
                        }}
                      />
                    )}
                  <DetailPane
                    key={`${detail.recordId}:${detail.recordVersion}`}
                    client={api.client}
                    cursor={detail}
                    highlight={hit?.range}
                  />
                </div>
              ) : (
                seed && (
                  <div
                    key={`${scope?.kind}:${scope?.id}:${selectedSnapshot ?? "current"}`}
                    className={
                      tab === "messages" || tab === "tools"
                        ? "tab-body transcript-body"
                        : "tab-body"
                    }
                  >
                    {tab === "messages" && (
                      <MessageList client={api.client} seed={seed} />
                    )}
                    {tab === "tools" && (
                      <Tools client={api.client} seed={seed} />
                    )}
                    {tab === "context" && (
                      <ContentExplorer client={api.client} seed={seed} />
                    )}
                    {tab === "timeline" && (
                      <TimelineView
                        client={api.client}
                        seed={seed}
                        onSearch={() => setSearchOpen(true)}
                      />
                    )}
                    {tab === "runs" && (
                      <>
                        <section className="run-current">
                          <h3>{t("Runs in the current snapshot")}</h3>
                          {runs.length > 0 ? (
                            runs.map((r) => (
                              <RunSummary
                                key={r.childRunId ?? r.runId}
                                run={r}
                              />
                            ))
                          ) : (
                            <p className="panel-empty">
                              {current && observation.state
                                ? t("No owner run projection in this snapshot.")
                                : t(
                                    "No snapshot observed yet; absence is not proof of settlement.",
                                  )}
                            </p>
                          )}
                        </section>
                        <h3>{t("Retained runs")}</h3>
                        <RunBrowser
                          key={taskId}
                          client={api.client}
                          seed={{
                            ...seed,
                            scope: {
                              kind: "task",
                              id: taskId ?? seed.scope.id,
                            },
                          }}
                          onScope={selectScope}
                        />
                      </>
                    )}
                  </div>
                )
              )}
            </div>
            {workspace.workspace && receipts.length > 0 && (
              <div className="receipt-dock">
                {receipts.map((receipt) => (
                  <ReceiptPanel
                    key={receipt.commandId}
                    client={api.client}
                    value={receipt}
                    onChange={setReceipt}
                  />
                ))}
              </div>
            )}
          </>
        }
        inspectorTabs={
          <>
            <button
              type="button"
              className="rp-tab"
              aria-pressed={rightTab === "files" || !scope}
              onClick={() => setRightTab("files")}
            >
              <FiFolder aria-hidden="true" />
              {t("Files")}
            </button>
            {scope && (
              <button
                type="button"
                className="rp-tab"
                aria-pressed={rightTab === "task"}
                disabled={!seed}
                onClick={() => setRightTab("task")}
              >
                <FiLayers aria-hidden="true" />
                {t("History details")}
              </button>
            )}
          </>
        }
        inspector={
          rightTab === "files" || !scope ? (
            <FilesPanel
              key={fileLocation?.cwd ?? "owner"}
              location={fileLocation}
              client={api.client}
              enabled={conversationAvailable && !!fileLocation}
              observed={`${execution.readiness}:${execution.value?.epoch ?? ""}`}
              onReference={(path) => {
                if (!chatId) selectChat(filesConversationId);
                // A reference opened from a legacy view may enter a conversation
                // in another subdirectory. Keep that reference's original base.
                const reference =
                  !chatId && fileLocation
                    ? `${fileLocation.cwd.replace(/[\\/]+$/, "")}${fileLocation.cwd.startsWith("/") ? "/" : "\\"}${path}`
                    : path;
                setReference(reference);
                closeDrawer();
              }}
            />
          ) : seed ? (
            <InspectorPanel
              key={taskId}
              client={api.client}
              seed={{
                ...seed,
                scope: { kind: "task", id: taskId ?? seed.scope.id },
              }}
            />
          ) : (
            <p className="panel-empty" role="status">
              {workspace.error
                ? t("Recorded history could not be read.")
                : t("Reading recorded history…")}
            </p>
          )
        }
        status={
          <>
            <StatusItem
              role="status"
              tip={t("Connection freshness is not execution outcome.")}
              dot={
                connecting
                  ? "busy"
                  : executionStopped
                    ? ""
                    : !observationFresh || !workspace.workspace
                      ? "error"
                      : observation.transportStatus !== "current"
                        ? "busy"
                        : !observation.state ||
                            observation.state.connection === "current"
                          ? "ok"
                          : "busy"
              }
            >
              {tx(connection)}
            </StatusItem>
            {project && (
              <StatusItem tone="faint" icon={<FiServer />}>
                {t("Execution service: {status}", {
                  status: tx(execution.readiness),
                })}
              </StatusItem>
            )}
            {activity && activity.turns > 0 && (
              <StatusItem
                icon={<FiMessageSquare />}
                tip={t("Turns in this conversation: {count}", {
                  count: activity.turns,
                })}
              >
                {activity.turns}
              </StatusItem>
            )}
            {activity?.context && <ContextStatus usage={activity.context} />}
            {activity && activity.runningSince !== null && (
              <WorkingStatus
                since={activity.runningSince}
                label={t("Working")}
              />
            )}
            {roster?.status === "complete"
              ? activeRuns.length > 0 && (
                  <StatusItem tone="warn">
                    {t(
                      !observationFresh
                        ? "Last observed: {count} active runs"
                        : activeRuns.length === 1
                          ? "{count} active run"
                          : "{count} active runs",
                      { count: activeRuns.length },
                    )}
                  </StatusItem>
                )
              : !connecting &&
                !executionStopped && (
                  <StatusItem tone="faint">
                    {t(
                      "Active roster unavailable; absence is not proof of settlement.",
                    )}
                  </StatusItem>
                )}
          </>
        }
        folder={
          <>
            {(workspace.workspace || project) && (
              <WorkingFolderButton
                path={workingFolder}
                onClick={() =>
                  onChooseFolder
                    ? onChooseFolder(workingFolder)
                    : setProjectOpen("")
                }
              />
            )}
            {workspace.compatible === false && (
              <StatusItem tone="warn">
                {t(
                  "unavailable / mismatch — reload built assets; normal actions disabled",
                )}
              </StatusItem>
            )}
          </>
        }
      />
      {projectOpen !== null && workspace.workspace && (
        <ProjectPicker
          onOpen={onOpenProject}
          projects={
            projectEntries ??
            (projects.value?.kind === "projects" ? projects.value.entries : [])
          }
          client={api.client}
          current={workingFolder ?? workspace.workspace.rootLabel}
          initial={projectOpen || undefined}
          home={homeFolder}
          epoch={workspace.workspace.epoch}
          onClose={() => setProjectOpen(null)}
        />
      )}
      {searchOpen && searchSeed && (
        <GlobalSearchModal
          client={api.client}
          seed={searchSeed}
          onClose={() => setSearchOpen(false)}
          onHit={(value) => {
            setHit(value);
            setDetail(value.cursor);
            if (taskId)
              history.replaceState(
                null,
                "",
                historyUrl(
                  taskId,
                  value.cursor,
                  scope ? { scope, snapshotSeq: selectedSnapshot } : undefined,
                ),
              );
          }}
        />
      )}
      {exportOpen && searchSeed && (
        <ExportDialog
          request={{
            storeId: searchSeed.storeId,
            scope: searchSeed.scope,
            snapshotSeq: searchSeed.snapshotSeq,
            format: "ndjson",
          }}
          onClose={() => setExportOpen(false)}
        />
      )}
    </>
  );
}
function Tools({
  client,
  seed,
}: {
  client: BrowserClient["client"];
  seed: ListRequest;
}) {
  const pager = usePage(client, { ...seed, reader: "tools" }),
    page = pager.page;
  return (
    <section className="tools-list">
      <PageControls pager={pager} />
      <div className="tools-body">
        {page &&
          !("kind" in page) &&
          page.records.map((r) =>
            r.kind === "tool" ? (
              <ToolCallBlock
                key={`${r.owner.entity.id}:${r.version}`}
                record={r}
                client={client}
                seed={page.request}
              />
            ) : null,
          )}
      </div>
    </section>
  );
}
