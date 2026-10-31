/* Adapted from pi-web-ui App.tsx/LeftPanel/RightPanel three-pane composition,
 * responsive drawers and action-dialog families. MIT (c) 2026 xing-shuyin.
 * Cadence uses only its existing portable service client. No browser executor. */
import {
  type CSSProperties,
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
  FiCpu,
  FiDownload,
  FiFolder,
  FiGitBranch,
  FiGlobe,
  FiLayers,
  FiLink,
  FiLogOut,
  FiMenu,
  FiMessageSquare,
  FiPlus,
  FiRefreshCw,
  FiSidebar,
  FiSquare,
  FiTool,
} from "react-icons/fi";
import { canonicalJson } from "../../src/service-contract.ts";
import {
  type CommandObservation,
  type PreparedAction,
  prepare,
} from "./client/actions";
import { type BrowserClient, browserClient } from "./client/browser";
import { localBuild } from "./client/build-identity";
import {
  type PlanMetadataPort,
  planMetadataClient,
} from "./client/plan-metadata";
import { mergeObservation } from "./client/receipts";
import { beginTask } from "./client/task-entry";
import { useWorkbench } from "./client/use-workbench";
import { useWorkspace } from "./client/use-workspace";
import { ViewLifetime } from "./client/view-lifetime";
import { ConfirmAction } from "./components/actions/ConfirmAction";
import { ModelChooser } from "./components/actions/ModelChooser";
import { ReceiptPanel } from "./components/actions/ReceiptPanel";
import { ContentExplorer } from "./components/history/ContentExplorer";
import { DetailPane } from "./components/history/DetailPane";
import { EntityPane } from "./components/history/EntityPane";
import { ExportDialog } from "./components/history/ExportDialog";
import { GlobalSearchModal } from "./components/history/GlobalSearchModal";
import { PageControls } from "./components/history/PageControls";
import { RunBrowser } from "./components/history/RunBrowser";
import { SearchBar } from "./components/history/SearchBar";
import { PlanApproval } from "./components/plan/PlanApproval";
import { MessageList } from "./components/transcript/MessageList";
import { ToolCallBlock } from "./components/transcript/ToolCallBlock";
import { AgentDock } from "./components/workspace/AgentDock";
import { ChatWorkspace } from "./components/workspace/ChatWorkspace";
import { FilesPanel } from "./components/workspace/FilesPanel";
import {
  InspectorPanel,
  InspectorPlaceholder,
} from "./components/workspace/InspectorPanel";
import { ProjectPicker } from "./components/workspace/ProjectPicker";
import { RunSummary } from "./components/workspace/RunSummary";
import { TaskSidebar } from "./components/workspace/TaskSidebar";
import { WorkflowCard } from "./components/workspace/WorkflowPanel";
import { WorkingFolderButton } from "./components/workspace/WorkingFolderButton";
import { historyUrl, readHistoryUrl } from "./history/history-url";
import { usePage } from "./history/use-page";
import { Template, useT } from "./i18n/locale";
import { ResizeHandle } from "./layout/ResizeHandle";
import type { DrawerSide } from "./layout/swipe-drawer";
import { useDrawerFocus } from "./layout/use-drawer-focus";
import { useSwipeDrawer } from "./layout/use-swipe-drawer";
import { copyTextToClipboard } from "./rich/use-copy-feedback";
import { TimelineView } from "./timeline/TimelineView";
import type {
  Action,
  ContextVersion,
  ListRequest,
  ReadCursor,
  Scope,
  SearchHit,
} from "./types";

function chatFromLocation(): string | null {
  const value = new URLSearchParams(window.location.hash?.slice(1)).get("chat");
  return value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
    ? value
    : null;
}

const VIEWS: readonly (readonly [string, IconType])[] = [
  ["tools", FiTool],
  ["context", FiLayers],
  ["timeline", FiClock],
  ["runs", FiGitBranch],
];
/** Local operation failures cannot diagnose the service or hide its observation. */
export function WorkspaceNotice({
  error,
  observationError,
}: {
  error?: string;
  observationError?: string;
}) {
  const { t, tx } = useT();
  if (!error && !observationError) return null;
  return (
    <p className="banner-notice" role="alert">
      {error && <>{error} </>}
      {observationError && (
        <>
          {t("{message}.", { message: tx(observationError) })}{" "}
          {observationError === "stale" ? (
            t(
              "Context changed. Observe again and request a fresh confirmation.",
            )
          ) : (
            <Template
              text={t(
                "Explicit service guidance: {status} / {start}. No service is started by this page.",
              )}
              slots={{
                status: <code>cadence-service status</code>,
                start: (
                  <code>cadence-service start --workspace &lt;path&gt;</code>
                ),
              }}
            />
          )}
        </>
      )}
    </p>
  );
}
export function App({
  api: provided,
  planMetadata,
  onOpenProject,
  onWorkbenchHome,
  workbenchHome,
  projectEntries,
}: {
  api?: BrowserClient;
  planMetadata?: PlanMetadataPort;
  onOpenProject?(path: string): Promise<void>;
  onWorkbenchHome?(): void;
  workbenchHome?: string;
  projectEntries?: { path: string; current: boolean }[];
}) {
  const { t, tx, locale, setLocale } = useT();
  const [api] = useState(() => provided ?? browserClient());
  const [modelOpen, setModelOpen] = useState(false);
  const [detached, setDetached] = useState(false);
  const [initial] = useState(readHistoryUrl),
    [taskId, setTaskId] = useState<string | null>(initial?.taskId ?? null);
  const [chatId, setChatId] = useState<string | null>(() =>
    initial ? null : (chatFromLocation() ?? crypto.randomUUID()),
  );
  const [taskComposer, setTaskComposer] = useState(false);
  const [projectOpen, setProjectOpen] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<"files" | "task">(
    initial ? "task" : "files",
  );
  const [reference, setReference] = useState<string>();
  const clearReference = useCallback(() => setReference(undefined), []);
  const [scope, setScope] = useState<Scope | null>(
    initial ? (initial.scope ?? { kind: "task", id: initial.taskId }) : null,
  );
  const workspace = useWorkspace(
    api,
    taskId ? { kind: "task", id: taskId } : null,
    !detached,
  );
  const chatWorkspace = useRef<string | null>(null);
  if (workspace.workspace)
    chatWorkspace.current = workspace.workspace.workspaceId;
  const chats = useWorkbench(
    api.client,
    workspace.workspace && !detached ? { kind: "conversations" } : null,
    2000,
  );
  const workflowActivity = useWorkbench(
    api.client,
    !detached ? { kind: "workflow-active" } : null,
    1000,
  );
  const background =
    workflowActivity.value?.kind === "workflow-active"
      ? workflowActivity.value.runs
      : undefined;
  const projects = useWorkbench(
    api.client,
    workspace.workspace && !detached ? { kind: "projects" } : null,
  );
  const workingFolder =
    (projects.value?.kind === "projects"
      ? projects.value.entries.find((entry) => entry.current)?.path
      : undefined) ?? workspace.workspace?.rootLabel;
  const taskOrigin = useWorkbench(
    api.client,
    taskId && workspace.workspace && !detached
      ? { kind: "task-origin", taskId }
      : null,
  );
  const linkedChat =
    taskOrigin.value?.kind === "task-origin"
      ? taskOrigin.value.conversationId
      : null;
  const observation = {
    state: workspace.observation,
    transportStatus: workspace.transportStatus,
    error: workspace.error,
    refresh: workspace.refresh,
  };
  const metadataStore = workspace.workspace?.storeId;
  const metadata = useMemo(
    () =>
      planMetadata ??
      (metadataStore
        ? planMetadataClient(api.client, metadataStore)
        : undefined),
    [planMetadata, api, metadataStore],
  );
  const current =
    observation.state?.snapshot.scope.kind === "task" &&
    observation.state.snapshot.scope.id === taskId
      ? observation.state.snapshot.context
      : undefined;
  const context: ContextVersion | null =
    current?.status === "available" ? current.version : null;
  const canAct =
    workspace.actions &&
    observation.state?.connection === "current" &&
    observation.transportStatus === "current" &&
    !!context &&
    context.epoch === workspace.workspace?.epoch;
  const [drawer, setDrawer] = useState<DrawerSide | null>(null),
    [mobile, setMobile] = useState(false),
    layout = useRef<HTMLDivElement>(null);
  const [leftWidth, setLeftWidth] = useState(260),
    [rightWidth, setRightWidth] = useState(360);
  const closeDrawer = useCallback(() => setDrawer(null), []);
  useEffect(() => {
    const query = matchMedia("(max-width: 900px)");
    const change = () => setMobile(query.matches);
    change();
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  useSwipeDrawer({
    enabled: mobile && !detached,
    open: drawer,
    onOpenChange: setDrawer,
    container: layout,
  });
  useDrawerFocus(layout, drawer, mobile && !detached, closeDrawer);
  const [selectedSnapshot, setSelectedSnapshot] = useState<string | undefined>(
    initial?.snapshotSeq,
  );
  const [taskTitle, setTaskTitle] = useState("");
  const [scopeTitle, setScopeTitle] = useState("");
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const viewMenu = useRef<HTMLDetailsElement>(null);
  const [tab, setTab] = useState("messages"),
    [searchOpen, setSearchOpen] = useState(false),
    [exportOpen, setExportOpen] = useState(false);
  const [hit, setHit] = useState<SearchHit>(),
    [detail, setDetail] = useState<ReadCursor | undefined>(initial?.cursor);
  const [enteringTask, setEnteringTask] = useState(false);
  const [prepared, setPrepared] = useState<PreparedAction>(),
    [preparing, setPreparing] = useState(false),
    [error, setError] = useState("");
  const [receipts, setReceipts] = useState<CommandObservation[]>([]),
    [canceling, setCanceling] = useState(new Set<string>());
  const mounted = useRef(true);
  const creationRead = useRef<AbortController | null>(null);
  const entryBusy = useRef(false);
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
    context,
    attachment: workspace.attachmentVersion,
    workspaceContext: workspace.workspace?.context ?? null,
    observationError: workspace.error ?? null,
  });
  lifetime.current.select(viewIdentity);
  const [actionView, setActionView] = useState(viewIdentity);
  if (actionView !== viewIdentity) {
    setActionView(viewIdentity);
    setPreparing(false);
    setPrepared(undefined);
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      creationRead.current?.abort();
      lifetime.current.depart();
    };
  }, []);
  const actionContext =
    prepared?.preflight.preview.action.kind === "create"
      ? workspace.workspace?.context.status === "available"
        ? workspace.workspace.context.version
        : null
      : context;
  const action = async (a: Action) => {
    const expected =
      a.kind === "create"
        ? workspace.workspace?.context.status === "available"
          ? workspace.workspace.context.version
          : null
        : context;
    if (!workspace.actions || !expected || preparing || detached) {
      setError(t("Current action context unavailable; observe again."));
      return;
    }
    lifetime.current.depart();
    const ticket = lifetime.current.ticket();
    setPreparing(true);
    setError("");
    try {
      const reply = await prepare(api.client, expected, a);
      if (!lifetime.current.current(ticket)) return;
      if (reply.kind === "error")
        setError(t("Preflight refused: {code}", { code: reply.error.code }));
      else setPrepared(reply.value);
    } catch {
      if (lifetime.current.current(ticket))
        setError(t("Preflight unavailable. No automatic retry."));
    } finally {
      if (lifetime.current.current(ticket)) setPreparing(false);
    }
  };
  const selectChat = (id: string = crypto.randomUUID(), cadence = false) => {
    setTaskComposer(cadence);
    creationRead.current?.abort();
    lifetime.current.depart();
    setPrepared(undefined);
    setPreparing(false);
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
      null,
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
    creationRead.current?.abort();
    setChatId(null);
    setRightTab("task");
    setTaskTitle(title ?? "");
    setScopeTitle("");
    setSelectedSnapshot(undefined);
    lifetime.current.depart();
    setPrepared(undefined);
    setPreparing(false);
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
      creationRead.current?.abort();
      const target = readHistoryUrl();
      if (!target) {
        const chat = chatFromLocation();
        if (chat) {
          setChatId(chat);
          setTaskId(null);
          setScope(null);
          setRightTab("files");
          setPrepared(undefined);
          lifetime.current.depart();
          closeDrawer();
        }
        return;
      }
      setChatId(null);
      setRightTab("task");
      // Same-document links/back navigation observe the exact new task too.
      // Changing a hash never refreshes a grant or replays an action.
      lifetime.current.depart();
      setPrepared(undefined);
      setPreparing(false);
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
    return () => window.removeEventListener("hashchange", navigate);
  }, [closeDrawer]);
  const selectScope = (value: Scope, snapshot?: string, label?: string) => {
    setSelectedSnapshot(snapshot);
    setScopeTitle(label ?? "");
    lifetime.current.depart();
    setPrepared(undefined);
    setPreparing(false);
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
  const sendTask = async (goal: string): Promise<boolean> => {
    const base = workspace.workspace;
    if (
      entryBusy.current ||
      !workspace.actions ||
      !base ||
      base.context.status !== "available" ||
      detached
    )
      return false;
    const abort = new AbortController();
    creationRead.current?.abort();
    creationRead.current = abort;
    entryBusy.current = true;
    setEnteringTask(true);
    setError("");
    const creation: {
      value?: { taskId: string; commandId: string };
    } = {};
    const origin =
      chats.value?.kind === "conversations" &&
      chats.value.entries.some((chat) => chat.id === chatId)
        ? chatId
        : null;
    try {
      const id = await beginTask({
        client: api.client,
        storeId: base.storeId,
        context: base.context.version,
        goal,
        signal: abort.signal,
        observe: (value) => {
          setReceipt(value);
          const receipt =
            value.receipt ??
            (value.lookup?.status === "found"
              ? value.lookup.receipt
              : undefined);
          if (receipt?.created?.state === "published")
            creation.value = {
              taskId: receipt.created.taskId,
              commandId: value.commandId,
            };
        },
      });
      if (abort.signal.aborted) return false;
      if (origin && creation.value) {
        const linked = await api.client.workbenchCommand({
          kind: "link-task",
          commandId: creation.value.commandId,
          epoch: base.epoch,
          taskId: id,
          conversationId: origin,
        });
        if (abort.signal.aborted) return false;
        if (linked.kind !== "ok")
          setError(
            t("Task created, but its conversation link was not confirmed."),
          );
      }
      selectTask(id);
      workspace.refresh();
      return true;
    } catch (error) {
      if (!abort.signal.aborted && mounted.current) {
        if (creation.value) selectTask(creation.value.taskId);
        setError(
          t(
            "Task preparation stopped: {reason}. Observe the original receipt; no automatic retry.",
            {
              reason: error instanceof Error ? error.message : "unavailable",
            },
          ),
        );
        workspace.refresh();
      }
      return false;
    } finally {
      entryBusy.current = false;
      if (mounted.current) setEnteringTask(false);
    }
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
  const connection =
    observation.state?.connection ??
    (!workspace.workspace
      ? "Service unavailable"
      : taskId
        ? "Task snapshot not observed yet"
        : "Chat ready");
  return (
    <div className={`app${inspectorOpen ? "" : " inspector-hidden"}`}>
      <header className="topbar">
        <button
          type="button"
          className="panel-toggle"
          aria-label={t("Tasks")}
          onClick={() => setDrawer((d) => (d === "left" ? null : "left"))}
        >
          <FiMenu aria-hidden="true" />
        </button>
        {/* Phone drawers open below the topbar, so its controls stay live. */}
        <div className="topbar-flow">
          {onWorkbenchHome && (
            <button
              type="button"
              className="icon-btn"
              aria-label={t("Workbench projects")}
              title={t("Workbench projects")}
              onClick={onWorkbenchHome}
            >
              <FiFolder />
            </button>
          )}
          <span className="brand">
            <span className="brand-logo" aria-hidden="true">
              C
            </span>
            <h1 className="brand-name">Cadence</h1>
          </span>
          {workspace.workspace && (
            <span
              className="chip static chip-root"
              title={workspace.workspace.rootLabel}
            >
              <FiFolder aria-hidden="true" />
              <span>{workspace.workspace.rootLabel}</span>
            </span>
          )}
          <span className="tb-spacer" aria-hidden="true" />
          {/* Recorded views read a task/child scope; an ordinary conversation
              has none and folds its tools into the transcript. */}
          {scope && (
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
                            setError(ok ? "" : t("Link copy unavailable.")),
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
          )}
          <span className="tb-spacer" aria-hidden="true" />
          <div className="tb-actions">
            <SearchBar
              disabled={!searchSeed}
              onOpen={() => setSearchOpen(true)}
            />
            <button
              type="button"
              className="chip"
              aria-label={t("Observe current state")}
              data-tip={t("Observe current state")}
              onClick={() => {
                workspace.refresh();
                observation.refresh();
              }}
            >
              <FiRefreshCw aria-hidden="true" />
            </button>
            <button
              type="button"
              className="chip"
              aria-label={t("Choose owner model")}
              data-tip={t("Choose owner model")}
              onClick={() => setModelOpen(true)}
            >
              <FiCpu aria-hidden="true" />
              <span className="chip-label">{t("Model")}</span>
            </button>
            <button
              type="button"
              className="chip"
              aria-label={t("Return — work continues")}
              data-tip={t("Return — accepted work continues")}
              onClick={() => {
                setPrepared(undefined);
                setDrawer(null);
                setSearchOpen(false);
                setExportOpen(false);
                lifetime.current.depart();
                setPreparing(false);
                creationRead.current?.abort();
                setDetached(true);
              }}
            >
              <FiLogOut aria-hidden="true" />
              <span className="chip-label">{t("Return")}</span>
            </button>
            {/* Named in the language it selects, so either reader can find it. */}
            <button
              type="button"
              className="chip chip-lang"
              lang={locale === "zh" ? "en" : "zh-CN"}
              aria-label={locale === "zh" ? "Switch to English" : "切换到中文"}
              data-tip={locale === "zh" ? "Switch to English" : "切换到中文"}
              onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
            >
              <FiGlobe aria-hidden="true" />
              <span>{locale === "zh" ? "EN" : "中文"}</span>
            </button>
          </div>
        </div>
        <button
          type="button"
          className="panel-toggle has-label inspector-toggle"
          aria-label={t("Plan / review")}
          aria-expanded={mobile ? drawer === "right" : inspectorOpen}
          onClick={() =>
            mobile
              ? setDrawer((d) => (d === "right" ? null : "right"))
              : setInspectorOpen((value) => !value)
          }
        >
          <FiSidebar aria-hidden="true" />
          <span>{chatId ? t("Files") : t("Plan")}</span>
        </button>
      </header>
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
                disabled={!workspace.cancelCompatible || canceling.has(r.runId)}
                onClick={() => cancel(r.runId)}
              >
                <FiSquare aria-hidden="true" />
                {t("Cancel run — request stop")}
              </button>
            </div>
          ))}
        </section>
      )}
      <WorkspaceNotice error={error} observationError={workspace.error} />
      <div
        ref={layout}
        className="layout"
        style={
          {
            "--left-w": `${leftWidth}px`,
            "--right-w": `${rightWidth}px`,
          } as CSSProperties
        }
      >
        <button
          type="button"
          aria-label={t("Close drawer")}
          tabIndex={-1}
          className={`drawer-backdrop persistent${drawer ? " on" : ""}`}
          onClick={closeDrawer}
        />
        <section
          className={`panel-drawer drawer-left${drawer === "left" ? " open" : ""}`}
          aria-label={t("Task navigation drawer")}
          tabIndex={-1}
          inert={mobile && drawer !== "left"}
        >
          {workspace.workspace && (
            <TaskSidebar
              client={api.client}
              workspace={workspace.workspace}
              taskId={taskId}
              scope={scope}
              runs={runs}
              snapshot={observation.state?.snapshot.committedSeq}
              activeRuns={workspace.activeRuns}
              cancelCompatible={!!workspace.cancelCompatible}
              canceling={canceling}
              onCancel={cancel}
              chats={
                chats.value?.kind === "conversations" ? chats.value.entries : []
              }
              conversationId={chatId}
              onConversation={selectChat}
              onNewConversation={() => selectChat()}
              workflowActiveCount={background?.length}
              onTask={selectTask}
              onScope={selectScope}
              onNew={() => {
                if (chatId) setTaskComposer(true);
                else selectChat(undefined, true);
              }}
            />
          )}
          {workspace.workspace && (
            <AgentDock
              client={api.client}
              active={workspace.activeRuns}
              taskId={taskId}
              runs={runs}
              snapshot={snapshotSeq}
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
        </section>
        <ResizeHandle side="left" width={leftWidth} onResize={setLeftWidth} />
        <main className="main" inert={mobile && drawer !== null}>
          {background?.length || workflowActivity.error ? (
            <details className="background-workflows">
              <summary>
                {t("Background workflows")} · {background?.length ?? "?"}
              </summary>
              {workflowActivity.error && (
                <p role="alert">
                  {t(
                    "Workflow activity unavailable; retained work may still be running.",
                  )}
                </p>
              )}
              {background?.map((run) => (
                <WorkflowCard
                  key={run.id}
                  client={api.client}
                  id={run.id}
                  onChanged={workflowActivity.refresh}
                />
              ))}
            </details>
          ) : null}
          {chatId && (
            <ChatWorkspace
              key={`${chatWorkspace.current ?? "connecting"}:${chatId}`}
              client={api.client}
              id={chatId}
              workspaceId={chatWorkspace.current ?? "connecting"}
              available={!!workspace.workspace}
              canInterrupt={!!workspace.cancelCompatible}
              cadenceEnabled={
                workspace.actions &&
                workspace.workspace?.context.status === "available"
              }
              enabled={
                !!workspace.workspace &&
                !!workspace.compatible &&
                !workspace.error
              }
              onModel={() => setModelOpen(true)}
              onChanged={() => {
                chats.refresh();
                workspace.refresh();
              }}
              reference={reference}
              onReferenceUsed={clearReference}
              initialMode={taskComposer ? "cadence" : "chat"}
              legacyTask={taskComposer}
              onModeChanged={() => setTaskComposer(false)}
              taskPending={enteringTask}
              onCadence={sendTask}
            />
          )}
          {scope && (
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
                {linkedChat && (
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => selectChat(linkedChat)}
                  >
                    {t("Back to ordinary conversation")}
                  </button>
                )}
                <h2 title={taskTitle || scope.id}>
                  {scope.kind === "task"
                    ? taskTitle || t("Task {id}", { id: scope.id.slice(0, 8) })
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
          {taskId && (
            <PlanApproval
              key={taskId}
              client={api.client}
              storeId={storeId}
              context={context}
              runs={runs}
              snapshotSeq={snapshotSeq}
              canAct={canAct && !preparing}
              onResult={result}
            />
          )}
          <div className="workspace-content" hidden={!!chatId}>
            {!seed && (
              <section className="empty-state">
                <span className="empty-logo" aria-hidden="true">
                  C
                </span>
                <h2>{t("Open a task or create one explicitly")}</h2>
                <p>
                  {t(
                    "Plans, children, checks and human review share one service owner. No chat or discovery activates execution.",
                  )}
                </p>
                <button
                  type="button"
                  className="primary"
                  disabled={!workspace.workspace}
                  onClick={() => selectChat(undefined, true)}
                >
                  <FiPlus aria-hidden="true" />
                  {t("New task")}
                </button>
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
                  {tab === "tools" && <Tools client={api.client} seed={seed} />}
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
                            <RunSummary key={r.childRunId ?? r.runId} run={r} />
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
                          scope: { kind: "task", id: taskId ?? seed.scope.id },
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
        </main>
        <ResizeHandle
          side="right"
          width={rightWidth}
          onResize={setRightWidth}
        />
        <section
          className={`panel-drawer drawer-right${drawer === "right" ? " open" : ""}`}
          aria-label={t("Plan and review drawer")}
          tabIndex={-1}
          inert={mobile && drawer !== "right"}
        >
          <div className="workbench-right">
            <nav className="rp-tabs" aria-label={t("Workspace panels")}>
              <button
                type="button"
                className="rp-tab"
                aria-pressed={rightTab === "files"}
                onClick={() => setRightTab("files")}
              >
                <FiFolder />
                {t("Files")}
              </button>
              <button
                type="button"
                className="rp-tab"
                aria-pressed={rightTab === "task"}
                disabled={!seed}
                onClick={() => setRightTab("task")}
              >
                <FiLayers />
                {t("Task details")}
              </button>
            </nav>
            {rightTab === "files" ? (
              <FilesPanel
                client={api.client}
                enabled={!!workspace.workspace}
                onReference={(path) => {
                  if (!chatId) selectChat(linkedChat ?? undefined);
                  setReference(path);
                  closeDrawer();
                }}
              />
            ) : seed ? (
              <InspectorPanel
                key={taskId}
                client={api.client}
                context={context}
                seed={{
                  ...seed,
                  scope: { kind: "task", id: taskId ?? seed.scope.id },
                }}
                runs={runs}
                canAct={canAct && !preparing}
                onAction={(a) => void action(a)}
                planMetadata={metadata}
              />
            ) : (
              <InspectorPlaceholder />
            )}
          </div>
        </section>
      </div>
      <footer className="statusbar">
        <div className="statusbar-left">
          <span
            className="status-item"
            role="status"
            title={t("Connection freshness is not execution outcome.")}
          >
            <span
              className={`status-dot ${
                observation.error || !workspace.workspace
                  ? "error"
                  : observation.transportStatus !== "current"
                    ? "busy"
                    : !observation.state
                      ? ""
                      : observation.state.connection === "current"
                        ? "ok"
                        : "busy"
              }`}
              aria-hidden="true"
            />
            {tx(connection)}
            {t(" · transport {status}", {
              status: tx(observation.transportStatus),
            })}
            {observation.error ? ` · ${tx(observation.error)}` : ""}
          </span>
          <span
            className={`status-item${
              roster?.status === "complete"
                ? activeRuns.length > 0
                  ? " warn"
                  : ""
                : " faint"
            }`}
          >
            {roster?.status === "complete"
              ? activeRuns.length > 0
                ? t(
                    activeRuns.length === 1
                      ? "{count} active run"
                      : "{count} active runs",
                    { count: activeRuns.length },
                  )
                : t("No active runs")
              : t(
                  "Active roster unavailable; absence is not proof of settlement.",
                )}
          </span>
        </div>
        <div className="statusbar-right">
          {workspace.workspace && (
            <WorkingFolderButton
              path={workingFolder}
              onClick={() => setProjectOpen("")}
            />
          )}
          <div
            className={`status-item${workspace.compatible ? " faint" : " warn"}`}
            title={localBuild?.buildId ?? t("unbuilt source")}
          >
            <details className="build-part">
              <summary>{t("Build information")}</summary>
              <Template
                text={t("Local browser build: {build}.")}
                slots={{
                  build: (
                    <code>{localBuild?.buildId ?? t("unbuilt source")}</code>
                  ),
                }}
              />{" "}
            </details>
            <span>
              {t("Shared compatibility: {state}.", {
                state: workspace.compatible
                  ? t("compatible")
                  : t(
                      "unavailable / mismatch — reload built assets; normal actions disabled",
                    ),
              })}
            </span>
          </div>
        </div>
      </footer>
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
          home={workbenchHome}
          epoch={workspace.workspace.epoch}
          onClose={() => setProjectOpen(null)}
        />
      )}
      {modelOpen && (
        <ModelChooser
          client={api.client}
          compatible={
            !!workspace.compatible &&
            workspace.transportStatus === "current" &&
            !workspace.error
          }
          onClose={() => setModelOpen(false)}
          onChanged={() => {
            setPrepared(undefined);
            lifetime.current.depart();
            workspace.refresh(true);
          }}
        />
      )}
      {prepared && (
        <ConfirmAction
          key={prepared.commandId}
          prepared={prepared}
          client={api.client}
          current={
            workspace.actions &&
            (canAct || prepared.preflight.preview.action.kind === "create")
              ? actionContext
              : null
          }
          attachmentVersion={workspace.attachmentVersion}
          onClose={() => {
            if (lifetime.current.current(resultTicket)) {
              lifetime.current.depart();
              setPrepared((value) => (value === prepared ? undefined : value));
            }
          }}
          onResult={result}
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
    </div>
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
