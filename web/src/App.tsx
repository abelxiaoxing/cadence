/* Adapted from pi-web-ui App.tsx/LeftPanel/RightPanel three-pane composition,
 * responsive drawers and action-dialog families. MIT (c) 2026 xing-shuyin.
 * Cadence uses only its existing portable service client. No browser executor. */
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
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
  FiSquare,
  FiTool,
} from "react-icons/fi";
import type {
  ExecutionPreparation,
  ProjectEntry,
} from "../../src/service/contracts/gateway.ts";
import type { ConversationLocation } from "../../src/service/contracts/models.ts";
import { canonicalJson, compareSequence } from "../../src/service-contract.ts";
import { type BrowserClient, browserClient } from "./client/browser";
import type { PreparationProgress } from "./client/conversation-send";
import type { FolderDraft } from "./client/folder-draft";
import { useLatency } from "./client/latency";
import type { PreviewModels } from "./client/model-preview";
import { ObservationAccess } from "./client/observer";
import {
  activityRoute,
  branchHash,
  chatFromLocation,
} from "./client/project-route";
import type { CommandObservation } from "./client/receipts";
import { mergeObservation } from "./client/receipts";
import { useConversationHistory } from "./client/use-conversation-history";
import type { ModelAvailability } from "./client/use-model-catalog";
import { useProjectObservation } from "./client/use-project-observation";
import { useRetainedTaskWorkspace } from "./client/use-retained-task-workspace";
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
  type ConversationAgents,
  type WorkflowAgent,
} from "./components/workspace/AgentDock";
import {
  BranchesPanel,
  type BranchesView,
} from "./components/workspace/BranchesPanel";
import {
  type ChatDiagnostics,
  ChatWorkspace,
  type ConversationActivity,
  type ViewerTicket,
} from "./components/workspace/ChatWorkspace";
import { FilesPanel } from "./components/workspace/FilesPanel";
import { InspectorPanel } from "./components/workspace/InspectorPanel";
import { ProjectPicker } from "./components/workspace/ProjectPicker";
import { RunSummary } from "./components/workspace/RunSummary";
import { TaskSidebar } from "./components/workspace/TaskSidebar";
import { WorkflowAgentView } from "./components/workspace/WorkflowAgentView";
import {
  type CanCancelWorkflow,
  cancelWorkflow,
  workflowLive,
} from "./components/workspace/WorkflowPanel";
import { WorkingFolderButton } from "./components/workspace/WorkingFolderButton";
import {
  accessRevoked,
  WorkspaceConnection,
} from "./components/workspace/WorkspaceNotice";
import { historyUrl, readHistoryUrl } from "./history/history-url";
import { usePage } from "./history/use-page";
import { useT } from "./i18n/locale";
import { AppShell } from "./layout/AppShell";
import { CacheStatus } from "./layout/CacheStatus";
import { ContextStatus } from "./layout/ContextStatus";
import { ReplyStatus, StatusItem } from "./layout/StatusItem";
import { notify } from "./layout/toasts";
import { usePanelLayout } from "./layout/use-panel-layout";
import { Crystal } from "./optics/Crystal";
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
  entryObservation,
  projectAccess,
  homeFolder,
  projectEntries,
  notices,
  discovery,
  onOpenService,
  project,
  onChooseFolder,
  onPrepareExecution,
  directoryNamespaces,
  previewModels,
  initialDraft,
  onDraftApplied,
}: {
  api?: BrowserClient;
  projectAccess?: ObservationAccess;
  entryObservation?: { pending: boolean; error?: string; refresh(): void };
  previewModels?: PreviewModels;
  initialDraft?: FolderDraft & { conversationId: string };
  onDraftApplied?(conversationId: string): void;
  project?: ProjectEntry;
  directoryNamespaces?: string[];
  onChooseFolder?(cwd?: string): void;
  onPrepareExecution?(
    purpose: ExecutionPreparation,
    signal: AbortSignal,
    location?: ConversationLocation,
    progress?: PreparationProgress,
  ): Promise<string>;
  onOpenProject?(path: string): Promise<void>;
  homeFolder?: string;
  projectEntries?: { path: string; current: boolean }[];
  /** Result of an explicit workbench action. */
  notices?: ReactNode;
  discovery?: ActivityListProps;
  /** The workbench's service restart and upgrade; absent on a direct owner. */
  onOpenService?(): void;
}) {
  const { t, tx } = useT();
  const [api] = useState(() => provided ?? browserClient(project?.id));
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
  const [projectOpen, setProjectOpen] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<"files" | "branches" | "task">(
    initial ? "task" : "files",
  );
  // The open conversation's session tree, for the Branches tab; another
  // conversation's is never shown for this one.
  const [branchView, setBranchView] = useState<BranchesView>();
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
  const [localAccess] = useState(() => new ObservationAccess());
  const access = projectAccess ?? localAccess;
  const refusal = useSyncExternalStore(
    access.subscribe,
    access.snapshot,
    access.snapshot,
  );
  const entryError =
    refusal?.source === "entry" ? refusal.code : entryObservation?.error;
  const entryRevoked = accessRevoked(entryError);
  const execution = useProjectObservation(
    entryRevoked ? undefined : project?.id,
    project?.epoch,
    access,
  );
  const running = !!project && execution.readiness === "running";
  const independent = running && execution.association === "unassociated";
  const executionReady =
    !project ||
    (running &&
      execution.association === "associated" &&
      !!execution.value?.epoch);
  const executionStopped =
    !!project &&
    (execution.readiness === "stopped" ||
      execution.readiness === "not-started");
  // Preserve a previously eligible safety viewer across an inconclusive read,
  // not across a positive stop, lost association, or revoked access.
  const eligible = useRef<{
    projectId: string;
    selected: string | null;
    epoch: string;
  }>(null);
  if (project) {
    if (executionReady && execution.value?.epoch)
      eligible.current = {
        projectId: project.id,
        selected: project.epoch,
        epoch: execution.value.epoch,
      };
    else if (
      eligible.current?.projectId !== project.id ||
      eligible.current.selected !== project.epoch ||
      running ||
      executionStopped ||
      refusal ||
      accessRevoked(execution.error)
    )
      eligible.current = null;
  }
  const executionEpoch = eligible.current?.epoch ?? null;
  const observeExecution =
    !entryRevoked && !refusal && (!project || executionEpoch !== null);
  const workspace = useWorkspace(
    api,
    taskId ? { kind: "task", id: taskId } : null,
    !detached && observeExecution,
    executionEpoch,
    access,
  );
  const [handoffs, setHandoffs] = useState(0);
  const expectedWorkspace = execution.value?.workspaceId;
  const wrongWorkspace =
    !!project &&
    workspace.epoch === executionEpoch &&
    !!expectedWorkspace &&
    [workspace.workspace, workspace.activeRuns].some(
      (read) => read && read.workspaceId !== expectedWorkspace,
    );
  const attached =
    !detached &&
    !entryObservation?.pending &&
    !entryError &&
    observeExecution &&
    !handoffs &&
    !wrongWorkspace &&
    workspace.attached &&
    !accessRevoked(workspace.error) &&
    (!project || workspace.epoch === executionEpoch);
  const projectError =
    (refusal?.source === "project" ? refusal.code : undefined) ??
    execution.error ??
    (execution.value?.status === "unavailable"
      ? "unavailable"
      : running && !executionReady && !independent
        ? "Viewer access not confirmed"
        : undefined);
  // Resync invalidates freshness without diagnosing a failure. Keep the
  // viewer's explicit cause separate from the current-data gate below.
  const viewerError =
    (refusal?.source === "viewer" ? refusal.code : undefined) ??
    (observeExecution
      ? (workspace.error ?? (wrongWorkspace ? "stale" : undefined))
      : undefined);
  const initialViewer = useRef(true);
  if (
    workspace.workspace ||
    workspace.observation ||
    projectError ||
    viewerError ||
    independent ||
    executionStopped
  )
    initialViewer.current = false;
  // A readiness refusal is not a conversation identity failure. Keep readonly
  // history and drafts reachable; only an explicit user action can prepare execution.
  const projectObserved = !!(
    project &&
    (execution.value || execution.error || refusal)
  );
  const signInRequired =
    !!refusal ||
    entryRevoked ||
    accessRevoked(projectError) ||
    accessRevoked(viewerError);
  const conversationAvailable =
    !detached && !signInRequired && !!(workspace.workspace || projectObserved);
  const retained = useRetainedTaskWorkspace(
    independent && !detached && !signInRequired ? project?.id : undefined,
    taskId,
    execution.value?.workspaceId,
    execution.value?.epoch,
    access,
  );
  const viewerHistoryWorkspace =
    observeExecution &&
    !wrongWorkspace &&
    !signInRequired &&
    (!project || workspace.workspace?.epoch === executionEpoch)
      ? workspace.workspace
      : undefined;
  const historyWorkspace = independent
    ? retained.history?.workspace
    : viewerHistoryWorkspace;
  const historyClient = retained.history?.client ?? api.client;
  const historyKey = `${independent ? "retained" : "viewer"}:${project?.id ?? "direct"}:${historyWorkspace?.epoch ?? ""}:${historyWorkspace?.storeId ?? ""}`;
  const chatWorkspace = useRef<string | null>(null);
  // On a direct owner the authenticated active roster already names the
  // workspace before the slower workspace read. Don't mount an editable
  // draft under a provisional namespace (or replace it when history arrives).
  const observedWorkspaceId =
    workspace.workspace?.workspaceId ??
    workspace.activeRuns?.workspaceId ??
    execution.value?.workspaceId;
  if (observedWorkspaceId) chatWorkspace.current = observedWorkspaceId;
  const draftNamespace = project
    ? `checkout:${project.path}`
    : chatWorkspace.current;
  const chats = useConversationHistory(api.client, conversationAvailable);
  const observingRoster =
    workspace.attached && workspace.workspace && !detached && !signInRequired;
  const chatActivity = useWorkbench(
    api.client,
    observingRoster ? { kind: "conversation-active" } : null,
    1000,
    access,
    workspace.attachmentVersion,
    workspace.allocationSignal,
  );
  const activeChats =
    chatActivity.value?.kind === "conversation-active"
      ? chatActivity.value.entries
      : undefined;
  const workflowActivity = useWorkbench(
    api.client,
    // Unlike full history, the safety roster is useful as soon as this
    // viewer can reach the owner, including during a task resync.
    observeExecution && workspace.attached && !detached && !signInRequired
      ? { kind: "workflow-active" }
      : null,
    2000,
    access,
    workspace.attachmentVersion,
    workspace.allocationSignal,
  );
  const background =
    workflowActivity.value?.kind === "workflow-active"
      ? workflowActivity.value
      : undefined;
  // A roster belongs to the project, not to one viewer allocation. Keep its
  // last observation for history display only while the replacement reads.
  // Fresh reads (including empty ones) replace the two rosters independently.
  const lastRoster = useRef<{
    project?: string;
    workspace?: string | null;
    chats?: typeof activeChats;
    workflows?: typeof background;
  }>({});
  const rosterScope = project
    ? (expectedWorkspace ?? (wrongWorkspace ? null : chatWorkspace.current))
    : chatWorkspace.current;
  const historyAllowed =
    !detached && !signInRequired && !executionStopped && !independent;
  if (
    !historyAllowed ||
    lastRoster.current.project !== project?.id ||
    lastRoster.current.workspace !== rosterScope
  ) {
    lastRoster.current = { project: project?.id, workspace: rosterScope };
  }
  if (historyAllowed && !wrongWorkspace) {
    if (activeChats) lastRoster.current.chats = activeChats;
    if (background) lastRoster.current.workflows = background;
  }
  const historyRoster = lastRoster.current;
  const showSidebar =
    conversationAvailable ||
    !!historyRoster.chats?.length ||
    !!historyRoster.workflows?.runs.length;
  const activeWorkflowIds = useMemo(
    () =>
      background?.links
        ?.filter((link) => link.conversationId === chatId)
        .map((link) => link.runId) ?? [],
    [background, chatId],
  );
  const projects = useWorkbench(
    api.client,
    !project && observingRoster ? { kind: "projects" } : null,
    0,
    access,
    workspace.attachmentVersion,
    workspace.allocationSignal,
  );
  const initialCwd =
    newConversationCwd ??
    project?.cwd ??
    (projects.value?.kind === "projects"
      ? projects.value.entries.find((entry) => entry.current)?.path
      : undefined);
  const currentChatLocation =
    chatLocation?.id === chatId ? chatLocation : undefined;
  const activity =
    (!project || projectObserved) && reported?.id === chatId
      ? reported
      : undefined;
  const latency = useLatency();
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
  // Scope/epoch selection can change before the previous observer's cleanup.
  // Never borrow another task's snapshot (including just its watermark).
  const candidate = workspace.observation?.snapshot;
  const taskObservation =
    candidate?.scope.kind === "task" &&
    candidate.scope.id === taskId &&
    candidate.storeId === viewerHistoryWorkspace?.storeId &&
    candidate.epoch === workspace.epoch &&
    (!project || candidate.epoch === executionEpoch)
      ? workspace.observation
      : undefined;
  const panels = usePanelLayout();
  const { closeDrawer } = panels;
  // One inspector tab at a time: Branches belongs to an open conversation,
  // History details to a task; Files is there for both.
  const branchesTab = rightTab === "branches" && !!chatId;
  const filesTab = !branchesTab && (rightTab !== "task" || !scope);
  // The conversation header's branch count opens the tab; a display choice.
  const openBranches = () => {
    setRightTab("branches");
    if (panels.mobile) panels.setDrawer("right");
    else if (!panels.inspector) panels.toggle("right");
  };
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
  const navigation = useRef(0);
  const departView = useCallback(() => {
    navigation.current++;
    lifetime.current.depart();
  }, []);
  const viewIdentity = canonicalJson({
    taskId,
    chatId,
    leaf: activitySelection.leaf ?? null,
    scope,
    selectedSnapshot: selectedSnapshot ?? null,
    detached,
    project: project?.id ?? null,
    selectedEpoch: project?.epoch ?? null,
    viewerEpoch: workspace.epoch ?? null,
    attached,
    attachment: workspace.attachmentVersion,
    workspaceContext: workspace.workspace?.context ?? null,
    observationError: workspace.error ?? null,
  });
  lifetime.current.select(viewIdentity);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      departView();
    };
  }, [departView]);
  const selectChat = (selected?: string) => {
    setActivityHash("");
    const id = selected ?? crypto.randomUUID();
    if (!selected) setNewConversationCwd(workingFolder ?? initialCwd);
    setAgent(null);
    if (id !== chatId) setReference(undefined);
    departView();
    setChatId(id);
    setTaskId(null);
    setScope(null);
    setTaskTitle("");
    setScopeTitle("");
    setHit(undefined);
    setDetail(undefined);
    setSelectedSnapshot(undefined);
    setTab("messages");
    // The History details tab belongs to a task; the others stay as chosen.
    setRightTab((tab) => (tab === "task" ? "files" : tab));
    closeDrawer();
    // Selecting the conversation already open keeps the branch it shows.
    const leaf = id === chatId ? activityRoute(location.hash, id).leaf : null;
    history.replaceState(
      { cadenceCwd: workingFolder ?? initialCwd, cadenceConversationId: id },
      "",
      `${location.pathname}${location.search}${branchHash(`#chat=${id}`, leaf)}`,
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
    setChatId(null);
    setRightTab("task");
    setTaskTitle(title ?? "");
    setScopeTitle("");
    setSelectedSnapshot(undefined);
    departView();
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
          setChatId(chat);
          setTaskId(null);
          setScope(null);
          setRightTab((tab) => (tab === "task" ? "files" : tab));
          departView();
          closeDrawer();
        }
        return;
      }
      setAgent(null);
      setChatId(null);
      setRightTab("task");
      // Same-document links/back navigation observe the exact new task too.
      // Changing a hash never refreshes a grant or replays an action.
      departView();
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
  }, [closeDrawer, departView]);
  const selectScope = (value: Scope, snapshot?: string, label?: string) => {
    setAgent(null);
    setSelectedSnapshot(snapshot);
    setScopeTitle(label ?? "");
    departView();
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
  // A deep link may pin an older commit but cannot invent a watermark or
  // borrow an anchor from a different store/scope.
  const historical = retained.history?.workspace;
  const anchorMismatch =
    historical &&
    ((selectedSnapshot &&
      compareSequence(selectedSnapshot, historical.committedSeq) > 0) ||
      (detail &&
        (detail.storeId !== historical.storeId ||
          detail.scope.kind !== scope?.kind ||
          detail.scope.id !== scope?.id ||
          compareSequence(detail.snapshotSeq, historical.committedSeq) > 0)));
  const historyError =
    retained.error ??
    (anchorMismatch
      ? "History anchor does not match the selected workspace"
      : undefined);
  const snapshotSeq =
    historyWorkspace && !anchorMismatch
      ? (selectedSnapshot ??
        taskObservation?.snapshot.committedSeq ??
        historyWorkspace.committedSeq)
      : undefined;
  const storeId = historyWorkspace?.storeId;
  const unavailableReason =
    historyError ??
    entryError ??
    projectError ??
    viewerError ??
    (signInRequired
      ? "Sign-in required"
      : executionStopped
        ? execution.readiness === "stopped"
          ? "Execution stopped"
          : "Execution not started"
        : undefined);
  const historyPlaceholder = unavailableReason
    ? t("Recorded history unavailable: {reason}.", {
        reason: tx(unavailableReason),
      })
    : t("Reading recorded history…");
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
  const runs = taskObservation?.snapshot.runs ?? [];
  const resultTicket = lifetime.current.ticket();
  const renderedSignal = workspace.allocationSignal;
  const roster = workspace.activeRuns;
  const activeRuns = roster?.status === "complete" ? roster.runs : [];
  // A matching HTTP workspace is not a current task subscription. In
  // particular, render-time scope/epoch changes precede observer cleanup.
  const viewerFresh =
    attached &&
    workspace.readCurrent &&
    !!workspace.epoch &&
    workspace.workspace?.epoch === workspace.epoch &&
    !workspace.error &&
    workspace.transportStatus === "current" &&
    (taskId
      ? taskObservation?.connection === "current"
      : !workspace.observation);
  const observationFresh = executionReady && viewerFresh;
  // Safety stop needs the exact rendered viewer and run, not a complete
  // history read or live task socket. Never let a retained button borrow the
  // mutable client's next attachment, even when the owner epoch is unchanged.
  const viewCurrent = useCallback(
    () =>
      mounted.current &&
      lifetime.current.current(resultTicket) &&
      !access.signal.aborted,
    [resultTicket, access],
  );
  const allocated = useCallback(
    (epoch?: string) =>
      viewCurrent() &&
      renderedSignal?.aborted === false &&
      attached &&
      !!workspace.epoch &&
      workspace.epoch === epoch,
    [viewCurrent, renderedSignal, attached, workspace.epoch],
  );
  const actionsReady = observationFresh && workspace.actions;
  const historyActionsUnavailable = actionsReady
    ? ""
    : executionStopped
      ? t(
          "Rename and archive need the execution service; it starts with your next Send.",
        )
      : t("Renaming and archiving are unavailable on this connection.");
  const actions = useRef(new ViewLifetime());
  actions.current.select(String(actionsReady));
  const actionId = actions.current.ticket();
  const ticket = useMemo<ViewerTicket>(
    () => ({
      allocation: renderedSignal,
      epoch: workspace.epoch,
      attached: allocated,
      current: () =>
        actionsReady &&
        actions.current.current(actionId) &&
        allocated(workspace.epoch),
    }),
    [renderedSignal, workspace.epoch, allocated, actionsReady, actionId],
  );
  // Same-allocation poll errors do not revoke an otherwise valid safety
  // viewer. Rows carried across allocations, however, are not its roster.
  const carriedRuns = !background ? historyRoster.workflows?.runs : undefined;
  const canCancelWorkflow: CanCancelWorkflow = (run) =>
    allocated(run.epoch) &&
    workflowLive(run) &&
    !carriedRuns?.some((last) => last.id === run.id);
  const latestRoster = useRef(roster);
  latestRoster.current = roster;
  // Only the explicit operation that requested a new observation may receive
  // its committed action ticket. Older handlers retain their original signal.
  const claim = useRef<{
    epoch: string;
    previous?: AbortSignal;
    accept(ticket: ViewerTicket): void;
  }>(undefined);
  useLayoutEffect(() => {
    const request = claim.current;
    if (
      request &&
      request.epoch === ticket.epoch &&
      request.previous !== ticket.allocation &&
      ticket.current()
    )
      request.accept(ticket);
  });
  const preparation = (purpose: ExecutionPreparation) =>
    onPrepareExecution && !signInRequired
      ? async (
          signal: AbortSignal,
          location?: ConversationLocation,
          progress?: PreparationProgress,
        ) => {
          access.check();
          if (
            signal.aborted ||
            !viewCurrent() ||
            !actions.current.current(actionId) ||
            renderedSignal?.aborted ||
            handoffs ||
            claim.current
          )
            throw new Error("stale");
          const selected = navigation.current;
          const departed = () =>
            signal.aborted || navigation.current !== selected;
          lifetime.current.depart();
          setHandoffs((count) => count + 1);
          try {
            const epoch = await onPrepareExecution(
              purpose,
              signal,
              location,
              progress,
            );
            access.check();
            if (departed()) throw access.waitError(signal, "stale");
            execution.prepared(epoch);
            const observation = workspace.reconnect();
            await workspace.whenReady(epoch, signal, observation);
            access.check();
            if (departed()) throw access.waitError(signal, "stale");
            // whenReady observes service data, not a React commit. Release
            // the handoff in finally and wait within the same caller deadline.
            return new Promise<ViewerTicket>((resolve, reject) => {
              const clear = () => {
                claim.current = undefined;
                signal.removeEventListener("abort", stop);
                access.signal.removeEventListener("abort", stop);
              };
              const stop = () => {
                clear();
                reject(access.waitError(signal, "stale"));
              };
              signal.addEventListener("abort", stop, { once: true });
              access.signal.addEventListener("abort", stop, { once: true });
              claim.current = {
                epoch,
                previous: renderedSignal,
                accept(next) {
                  clear();
                  resolve(next);
                },
              };
            }).then(async (next) => {
              // Pin the committed allocation through the final observer check.
              if (departed() || !next.current())
                throw access.waitError(signal, "stale");
              await workspace.whenReady(epoch, signal, observation);
              if (departed() || !next.current())
                throw access.waitError(signal, "stale");
              return next;
            });
          } finally {
            setHandoffs((count) => count - 1);
          }
        }
      : undefined;
  const prepareSend = preparation("send");
  const preparePlan = preparation("plan-validation");
  const result = (value: CommandObservation) => {
    setReceipt(value);
    if (value.receipt && lifetime.current.current(resultTicket)) {
      actions.current.depart();
      workspace.refresh();
    }
  };
  const cancel = (runId: string) => {
    const original = activeRuns.find((run) => run.runId === runId);
    const latest = latestRoster.current;
    if (
      !original ||
      !allocated(original.epoch) ||
      latest?.status !== "complete" ||
      latest.epoch !== original.epoch ||
      !latest.runs.some(
        (run) =>
          run.runId === runId &&
          run.taskId === original.taskId &&
          run.operationId === original.operationId &&
          run.epoch === original.epoch,
      ) ||
      canceling.has(runId)
    )
      return;
    const commandId = crypto.randomUUID(),
      epoch = original.epoch;
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
  const chatKey = JSON.stringify([
    project?.id,
    chatId,
    activitySelection.leaf,
    project?.epoch,
    execution.value?.epoch ?? workspace.epoch,
  ]);
  const latestChat = useRef(chatKey);
  latestChat.current = chatKey;
  const navTicket = navigation.current;
  const readSelected = useCallback(
    () =>
      mounted.current &&
      !access.signal.aborted &&
      navigation.current === navTicket &&
      latestChat.current === chatKey,
    [chatKey, navTicket, access],
  );
  const [agentReport, setAgentReport] = useState<{
    key: string;
    agents: ConversationAgents;
  }>();
  const onAgents = useCallback(
    (agents: ConversationAgents) => {
      if (readSelected()) setAgentReport({ key: chatKey, agents });
    },
    [chatKey, readSelected],
  );
  const chatAgents =
    agentReport?.key === chatKey && conversationAvailable
      ? agentReport.agents
      : undefined;
  const [report, setReport] = useState<{
    key: string;
    diagnostics: ChatDiagnostics;
  }>();
  const onDiagnostics = useCallback(
    (diagnostics: ChatDiagnostics) => {
      if (readSelected()) setReport({ key: chatKey, diagnostics });
    },
    [chatKey, readSelected],
  );
  const chatIssues =
    report?.key === chatKey && conversationAvailable
      ? report.diagnostics
      : undefined;
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
  const connecting = initialViewer.current && !projectError && !viewerError;
  const modelAvailability: ModelAvailability = executionStopped
    ? {
        status:
          execution.readiness === "not-started" ? "not-started" : "stopped",
      }
    : observationFresh && workspace.epoch
      ? {
          status: "ready",
          epoch: workspace.epoch,
          attachmentVersion: workspace.attachmentVersion,
        }
      : {
          status:
            !projectError && !viewerError && !independent
              ? "connecting"
              : "unavailable",
        };
  const refreshConnection = () => {
    if (!readSelected() || entryRevoked) return;
    actions.current.depart();
    chatIssues?.retry();
    if (workflowActivity.error) workflowActivity.refresh();
    if (chatActivity.error) chatActivity.refresh();
    if (projects.error) projects.refresh();
    entryObservation?.refresh();
    retained.refresh();
    if (observeExecution) workspace.refresh();
    execution.refresh();
  };
  return (
    <>
      <AppShell
        panels={panels}
        onOpenService={onOpenService}
        onRefresh={refreshConnection}
        onDisconnect={() => {
          setSearchOpen(false);
          setExportOpen(false);
          departView();
          setDetached(true);
        }}
        inspectorLabel={
          scope && rightTab === "task"
            ? t("History details")
            : branchesTab
              ? t("Branches")
              : t("Files")
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
            {notices}
            {error && (
              <p className="banner-notice" role="alert">
                {error}
              </p>
            )}
          </>
        }
        navigation={
          <>
            {!showSidebar && (
              <aside className="panel panel-left lp-panel">
                {discovery && <ActivityList {...discovery} />}
                {activeRuns.length > 0 && (
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
                        <button
                          type="button"
                          onClick={() => selectTask(r.taskId)}
                        >
                          {t("Open active task")}
                        </button>
                        <button
                          type="button"
                          className="danger"
                          disabled={!attached || canceling.has(r.runId)}
                          onClick={() => cancel(r.runId)}
                        >
                          <FiSquare aria-hidden="true" />
                          {t("Cancel run — request stop")}
                        </button>
                      </div>
                    ))}
                  </section>
                )}
                {!executionStopped &&
                  (projectError || viewerError || detached) && (
                    <p className="panel-hint">
                      {t(
                        "Activity observation is partial. Missing work is not known to have finished.",
                      )}
                    </p>
                  )}
                <p className="panel-empty" role="status">
                  {projectError || viewerError
                    ? t(
                        "Conversation history could not be read. This is not an empty history.",
                      )
                    : t("Reading conversation history…")}
                </p>
              </aside>
            )}
            {showSidebar && (
              <TaskSidebar
                key={`${historyKey}:${independent ? (taskId ?? "chat") : ""}`}
                discovery={discovery}
                client={api.client}
                workspace={viewerHistoryWorkspace}
                retained={retained.history}
                executionStopped={executionStopped}
                taskId={taskId}
                scope={scope}
                runs={runs}
                snapshot={taskObservation?.snapshot.committedSeq}
                activeRuns={workspace.activeRuns}
                canCancel={attached}
                canceling={canceling}
                onCancel={cancel}
                chats={chats.value?.entries}
                activeChats={historyRoster.chats}
                chatActivityKnown={
                  chatActivity.value?.kind === "conversation-active" &&
                  !chatActivity.error &&
                  !wrongWorkspace
                }
                chatHistoryPartial={
                  !chats.value ||
                  !!chats.error ||
                  chats.canPrevious ||
                  !!chats.value.next
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
                actionCurrent={ticket.current}
                actionsUnavailable={historyActionsUnavailable}
                onConversationsChanged={(id) => {
                  // The lists and the open conversation's head say what is
                  // recorded; nothing here is changed ahead of those reads.
                  chats.refresh();
                  if (id === chatId) setSummaryChanges((count) => count + 1);
                }}
                workflows={historyRoster.workflows?.runs}
                workflowLinks={historyRoster.workflows?.links}
                workflowError={
                  !background || !!workflowActivity.error || wrongWorkspace
                }
                selectedWorkflow={agent?.runId}
                onWorkflow={(run, conversationId) => {
                  if (conversationId) selectChat(conversationId);
                  setAgent({ runId: run.id, stepId: null, label: run.goal });
                  closeDrawer();
                }}
                canCancelWorkflow={canCancelWorkflow}
                onCancelWorkflow={async (run) => {
                  // The banner holds the last request's refusal: an accepted
                  // request clears it, nothing else does.
                  if (!canCancelWorkflow(run)) return;
                  setError(
                    await cancelWorkflow(api.client, run, canCancelWorkflow),
                  );
                  workflowActivity.refresh();
                }}
                onTask={selectTask}
                onScope={selectScope}
              />
            )}
            {workspace.workspace &&
              !signInRequired &&
              (chatId ? (
                <AgentDock
                  key={`chat:${chatId}`}
                  kind="conversation"
                  groups={chatAgents?.groups ?? []}
                  unavailable={
                    !background ||
                    !!workflowActivity.error ||
                    !chatAgents ||
                    chatAgents.unavailable
                  }
                  selected={agent}
                  onOpen={(next) => {
                    if (readSelected()) {
                      setAgent(next);
                      closeDrawer();
                    }
                  }}
                />
              ) : (
                taskId && (
                  <AgentDock
                    key={`task:${taskId}`}
                    kind="task"
                    runs={runs}
                    unavailable={!taskObservation || !!workspace.error}
                    onOpen={(child, label) =>
                      selectScope(
                        { kind: "child", id: child },
                        taskObservation?.snapshot.committedSeq,
                        label,
                      )
                    }
                  />
                )
              ))}
          </>
        }
        content={
          <>
            {chatId && (!draftNamespace || (project && !projectObserved)) && (
              <p className="panel-empty" role="status">
                {t("Reading this conversation…")}
              </p>
            )}
            {agent && !signInRequired && (
              <WorkflowAgentView
                key={`${agent.runId}:${agent.stepId ?? ""}`}
                client={api.client}
                agent={agent}
                canCancelWorkflow={canCancelWorkflow}
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
            {chatId && draftNamespace && (!project || projectObserved) && (
              <ChatWorkspace
                key={`${project?.id ?? draftNamespace}:${chatId}:${activitySelection.leaf ?? ""}`}
                client={api.client}
                id={chatId}
                activitySelected={activitySelection.selected}
                initialLeaf={activitySelection.leaf}
                initialCwd={initialCwd}
                onLocation={setChatLocation}
                onActivity={setReported}
                hidden={!!agent}
                onOpenAgent={setAgent}
                activeWorkflowIds={activeWorkflowIds}
                onAgents={onAgents}
                onBranches={setBranchView}
                onOpenBranches={openBranches}
                workspaceId={draftNamespace}
                directoryNamespaces={directoryNamespaces}
                legacyWorkspaceId={
                  project
                    ? (execution.value?.workspaceId ?? undefined)
                    : undefined
                }
                prepareForSend={prepareSend}
                prepareForPlan={preparePlan}
                actionsReady={actionsReady}
                viewer={ticket}
                access={access}
                readSelected={readSelected}
                onDiagnostics={onDiagnostics}
                observe={summaryChanges}
                available={conversationAvailable}
                canInterrupt={attached}
                canCancelWorkflow={canCancelWorkflow}
                enabled={
                  prepareSend
                    ? conversationAvailable && !handoffs
                    : actionsReady
                }
                modelAvailability={modelAvailability}
                previewModels={signInRequired ? undefined : previewModels}
                initialDraft={
                  initialDraft?.conversationId === chatId
                    ? initialDraft
                    : undefined
                }
                onDraftApplied={() => onDraftApplied?.(chatId)}
                onModelChanged={() => {
                  refreshConnection();
                }}
                onChanged={() => {
                  chats.refresh();
                  actions.current.depart();
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
            <div
              key={`${historyKey}:${taskId ?? "chat"}`}
              className="workspace-content"
              hidden={!!chatId || !!agent}
            >
              {!seed && (
                <section className="empty-state">
                  <span className="empty-logo" aria-hidden="true">
                    <Crystal />
                  </span>
                  <h2>{historyPlaceholder}</h2>
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
                        client={historyClient}
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
                    client={historyClient}
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
                      <MessageList client={historyClient} seed={seed} />
                    )}
                    {tab === "tools" && (
                      <Tools client={historyClient} seed={seed} />
                    )}
                    {tab === "context" && (
                      <ContentExplorer client={historyClient} seed={seed} />
                    )}
                    {tab === "timeline" && (
                      <TimelineView
                        client={historyClient}
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
                              {taskObservation
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
                          client={historyClient}
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
              aria-pressed={filesTab}
              onClick={() => setRightTab("files")}
            >
              <FiFolder aria-hidden="true" />
              {t("Files")}
            </button>
            {chatId && (
              <button
                type="button"
                className="rp-tab"
                aria-pressed={branchesTab}
                onClick={() => setRightTab("branches")}
              >
                <FiGitBranch aria-hidden="true" />
                {t("Branches")}
              </button>
            )}
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
          branchesTab ? (
            <BranchesPanel
              view={branchView?.id === chatId ? branchView : undefined}
              onChosen={closeDrawer}
            />
          ) : filesTab ? (
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
              key={`${historyKey}:${taskId}`}
              client={historyClient}
              seed={{
                ...seed,
                scope: { kind: "task", id: taskId ?? seed.scope.id },
              }}
            />
          ) : (
            <p className="panel-empty" role="status">
              {historyPlaceholder}
            </p>
          )
        }
        status={
          <>
            <WorkspaceConnection
              key={`${chatKey}:${taskId ?? "chat"}`}
              phase={
                entryObservation?.pending
                  ? "updating"
                  : executionStopped
                    ? execution.readiness === "not-started"
                      ? "not-started"
                      : "stopped"
                    : independent
                      ? "independent"
                      : observationFresh
                        ? taskId
                          ? "task"
                          : "chat"
                        : connecting
                          ? "connecting"
                          : "updating"
              }
              entryError={entryError}
              projectStatus={project && execution.readiness}
              projectError={projectError}
              viewerError={viewerError}
              historyActionsUnavailable={
                conversationAvailable ? historyActionsUnavailable : undefined
              }
              prepareOnly={chatIssues?.prepareOnly}
              readErrors={[
                ["Project directories: {code}.", projects.error],
                ["Conversation activity: {code}.", chatActivity.error],
                ["Workflow activity: {code}.", workflowActivity.error],
                ["Conversation context: {code}.", chatIssues?.context],
                ["Conversation read: {code}.", chatIssues?.head],
                ["Workflow observation: {code}.", chatIssues?.workflow],
                ["Recorded workflows: {code}.", chatIssues?.runs],
              ]}
              historyError={historyError}
              retained={
                !!workspace.workspace ||
                (execution.readiness === "stale" &&
                  !!execution.value &&
                  execution.value.status !== "unavailable")
              }
              latency={latency}
              onRefresh={refreshConnection}
            />
            {activity && <ContextStatus usage={activity.context} />}
            {activity && <CacheStatus cache={activity.cache} />}
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
            {chatId && (
              <ReplyStatus clock={activity?.replyClock ?? "unavailable"} />
            )}
            {roster?.status === "complete" && activeRuns.length > 0 && (
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
            )}
          </>
        }
        folder={
          (workspace.workspace || project) && (
            <WorkingFolderButton
              path={workingFolder}
              onClick={() =>
                onChooseFolder
                  ? onChooseFolder(workingFolder)
                  : setProjectOpen("")
              }
            />
          )
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
          key={`${historyKey}:${scope?.id}`}
          client={historyClient}
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
          key={`${historyKey}:${scope?.id}`}
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
