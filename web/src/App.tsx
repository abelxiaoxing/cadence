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
  FiCheckCircle,
  FiClock,
  FiCpu,
  FiDownload,
  FiFolder,
  FiGitBranch,
  FiGitCommit,
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
import { useWorkspace } from "./client/use-workspace";
import { ViewLifetime } from "./client/view-lifetime";
import { ActionDialog } from "./components/actions/ActionDialog";
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
import { MessageList } from "./components/transcript/MessageList";
import { ToolCallBlock } from "./components/transcript/ToolCallBlock";
import {
  InspectorPanel,
  InspectorPlaceholder,
} from "./components/workspace/InspectorPanel";
import { RunSummary } from "./components/workspace/RunSummary";
import { TaskSidebar } from "./components/workspace/TaskSidebar";
import { historyUrl, readHistoryUrl } from "./history/history-url";
import { usePage } from "./history/use-page";
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
  TaskKind,
} from "./types";

const VIEWS: readonly (readonly [string, IconType])[] = [
  ["messages", FiMessageSquare],
  ["tools", FiTool],
  ["context", FiLayers],
  ["timeline", FiClock],
  ["runs", FiGitBranch],
  ["outcomes", FiCheckCircle],
];
export function App({
  api: provided,
  planMetadata,
}: {
  api?: BrowserClient;
  planMetadata?: PlanMetadataPort;
}) {
  const [api] = useState(() => provided ?? browserClient());
  const [modelOpen, setModelOpen] = useState(false);
  const [detached, setDetached] = useState(false);
  const [initial] = useState(readHistoryUrl),
    [taskId, setTaskId] = useState<string | null>(initial?.taskId ?? null);
  const [scope, setScope] = useState<Scope | null>(
    initial ? { kind: "task", id: initial.taskId } : null,
  );
  const workspace = useWorkspace(
    api,
    taskId ? { kind: "task", id: taskId } : null,
    !detached,
  );
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
  const [tab, setTab] = useState("messages"),
    [searchOpen, setSearchOpen] = useState(false),
    [exportOpen, setExportOpen] = useState(false);
  const [hit, setHit] = useState<SearchHit>(),
    [detail, setDetail] = useState<ReadCursor | undefined>(initial?.cursor);
  const [newOpen, setNewOpen] = useState(false),
    [goal, setGoal] = useState(""),
    [kind, setKind] = useState<TaskKind>("code");
  const [prepared, setPrepared] = useState<PreparedAction>(),
    [preparing, setPreparing] = useState(false),
    [error, setError] = useState("");
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
      setError("Current action context unavailable; observe again.");
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
        setError(`Preflight refused: ${reply.error.code}`);
      else setPrepared(reply.value);
    } catch {
      if (lifetime.current.current(ticket))
        setError("Preflight unavailable. No automatic retry.");
    } finally {
      if (lifetime.current.current(ticket)) setPreparing(false);
    }
  };
  const selectTask = (id: string) => {
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
      const target = readHistoryUrl();
      if (!target) return;
      // Same-document links/back navigation observe the exact new task too.
      // Changing a hash never refreshes a grant or replays an action.
      lifetime.current.depart();
      setPrepared(undefined);
      setPreparing(false);
      setTaskId(target.taskId);
      setScope({ kind: "task", id: target.taskId });
      setHit(undefined);
      setDetail(target.cursor);
      setTab("messages");
      closeDrawer();
    };
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, [closeDrawer]);
  const selectScope = (value: Scope) => {
    lifetime.current.depart();
    setPrepared(undefined);
    setPreparing(false);
    setScope(value);
    setHit(undefined);
    setDetail(undefined);
    setTab(value.kind === "task" ? "runs" : "messages");
    closeDrawer();
  };
  const snapshotSeq =
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
    if (value.receipt && lifetime.current.current(resultTicket)) {
      workspace.refresh();

      if (value.receipt.created?.state === "published")
        selectTask(value.receipt.created.taskId);
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
      error: "Stop requested; settlement is not yet confirmed.",
    });
    void api.client
      .cancel({ commandId, epoch, runId })
      .then((reply) => {
        result(
          reply.kind === "ok"
            ? { commandId, receipt: reply.value }
            : {
                commandId,
                error: `${reply.error.code}; cancellation effect ${reply.error.effect}. Observe exact receipt.`,
              },
        );
      })
      .catch(() =>
        setReceipt({
          commandId,
          error: "Cancellation effect uncertain. Observe exact receipt.",
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
        <h1>Detached</h1>
        <p>Accepted service work continues. No Cancel was requested.</p>
        {receipts.map((value) => (
          <p key={value.commandId}>
            Observe command after reconnect: <code>{value.commandId}</code>
          </p>
        ))}
        <button
          type="button"
          className="primary"
          onClick={() => setDetached(false)}
        >
          Reconnect as a viewer
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
        : "No task selected");
  return (
    <div className="app">
      <header className="topbar">
        <button
          type="button"
          className="panel-toggle"
          aria-label="Tasks"
          onClick={() => setDrawer((d) => (d === "left" ? null : "left"))}
        >
          <FiMenu aria-hidden="true" />
        </button>
        {/* Phone drawers open below the topbar, so its controls stay live. */}
        <div className="topbar-flow">
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
          <nav className="tb-tabs" aria-label="Recorded views">
            {VIEWS.map(([t, Icon]) => (
              <button
                type="button"
                key={t}
                className="tb-tab"
                aria-label={t}
                aria-pressed={tab === t}
                onClick={() => {
                  setDetail(undefined);
                  setHit(undefined);
                  setTab(t);
                }}
              >
                <Icon aria-hidden="true" />
                <span>{t}</span>
              </button>
            ))}
          </nav>
          <span className="tb-spacer" aria-hidden="true" />
          <div className="tb-actions">
            <SearchBar
              disabled={!searchSeed}
              onOpen={() => setSearchOpen(true)}
            />
            <button
              type="button"
              className="chip"
              aria-label="Export selected scope"
              data-tip="Export selected scope"
              disabled={!seed}
              onClick={() => setExportOpen(true)}
            >
              <FiDownload aria-hidden="true" />
            </button>
            <button
              type="button"
              className="chip"
              aria-label="Copy token-free link"
              data-tip="Copy token-free link"
              disabled={!taskId}
              onClick={() => {
                if (taskId)
                  void copyTextToClipboard(historyUrl(taskId, detail)).then(
                    (ok) => setError(ok ? "" : "Link copy unavailable."),
                  );
              }}
            >
              <FiLink aria-hidden="true" />
            </button>
            <button
              type="button"
              className="chip"
              aria-label="Observe current state"
              data-tip="Observe current state"
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
              aria-label="Choose owner model"
              data-tip="Choose owner model"
              onClick={() => setModelOpen(true)}
            >
              <FiCpu aria-hidden="true" />
              <span className="chip-label">Model</span>
            </button>
            <button
              type="button"
              className="chip"
              aria-label="Return — work continues"
              data-tip="Return — accepted work continues"
              onClick={() => {
                setPrepared(undefined);
                setDrawer(null);
                setSearchOpen(false);
                setExportOpen(false);
                lifetime.current.depart();
                setPreparing(false);
                setDetached(true);
              }}
            >
              <FiLogOut aria-hidden="true" />
              <span className="chip-label">Return</span>
            </button>
          </div>
        </div>
        <button
          type="button"
          className="panel-toggle has-label"
          aria-label="Plan / review"
          onClick={() => setDrawer((d) => (d === "right" ? null : "right"))}
        >
          <FiSidebar aria-hidden="true" />
          <span>Plan</span>
        </button>
      </header>
      {activeRuns.length > 0 && (
        <section className="run-strip" aria-label="Execution and cancellation">
          {activeRuns.map((r) => (
            <div className="run-strip-row" key={r.runId}>
              <span className="status-dot busy" aria-hidden="true" />
              <span className="run-strip-label">
                {r.kind} {r.runId} · {r.stage}
              </span>
              <button type="button" onClick={() => selectTask(r.taskId)}>
                Open active task
              </button>
              <button
                type="button"
                className="danger"
                disabled={!workspace.cancelCompatible || canceling.has(r.runId)}
                onClick={() => cancel(r.runId)}
              >
                <FiSquare aria-hidden="true" />
                Cancel run — request stop
              </button>
            </div>
          ))}
        </section>
      )}
      {(error || workspace.error) && (
        <p className="banner-notice" role="alert">
          {error || workspace.error}. Explicit service guidance:{" "}
          <code>cadence-service status</code> /{" "}
          <code>cadence-service start --workspace &lt;path&gt;</code>. No
          service is started by this page.
        </p>
      )}
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
          aria-label="Close drawer"
          tabIndex={-1}
          className={`drawer-backdrop persistent${drawer ? " on" : ""}`}
          onClick={closeDrawer}
        />
        <section
          className={`panel-drawer drawer-left${drawer === "left" ? " open" : ""}`}
          aria-label="Task navigation drawer"
          tabIndex={-1}
          inert={mobile && drawer !== "left"}
        >
          {workspace.workspace && (
            <TaskSidebar
              client={api.client}
              workspace={workspace.workspace}
              taskId={taskId}
              runs={runs}
              onTask={selectTask}
              onScope={selectScope}
              onNew={() => {
                closeDrawer();
                setNewOpen(true);
              }}
            />
          )}
        </section>
        <ResizeHandle side="left" width={leftWidth} onResize={setLeftWidth} />
        <main className="main" inert={mobile && drawer !== null}>
          {scope && (
            <p className="scope-bar">
              <FiGitCommit aria-hidden="true" />
              <span className="scope-kind">Selected {scope.kind}:</span>
              <code>{scope.id}</code>
              <span>· snapshot {snapshotSeq}.</span>
              <span className="scope-hint">
                Pages and old outcomes are historical observations, not renewed
                consent.
              </span>
            </p>
          )}
          <div className="workspace-content">
            {!seed && (
              <section className="empty-state">
                <span className="empty-logo" aria-hidden="true">
                  C
                </span>
                <h2>Open a task or create one explicitly</h2>
                <p>
                  Plans, children, checks and human review share one service
                  owner. No chat or discovery activates execution.
                </p>
                <button
                  type="button"
                  className="primary"
                  disabled={!workspace.workspace}
                  onClick={() => setNewOpen(true)}
                >
                  <FiPlus aria-hidden="true" />
                  Create task
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
                    <RunBrowser
                      key={taskId}
                      client={api.client}
                      seed={{
                        ...seed,
                        scope: { kind: "task", id: taskId ?? seed.scope.id },
                      }}
                      onScope={selectScope}
                    />
                  )}
                  {tab === "outcomes" &&
                    (runs.length > 0 ? (
                      runs.map((r) => (
                        <RunSummary key={r.childRunId ?? r.runId} run={r} />
                      ))
                    ) : (
                      <p className="panel-empty">
                        {current && observation.state
                          ? "No owner run projection in this snapshot."
                          : "No snapshot observed yet; absence is not proof of settlement."}
                      </p>
                    ))}
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
          aria-label="Plan and review drawer"
          tabIndex={-1}
          inert={mobile && drawer !== "right"}
        >
          {seed ? (
            <InspectorPanel
              key={taskId}
              client={api.client}
              context={context}
              seed={seed}
              runs={runs}
              canAct={canAct && !preparing}
              onAction={(a) => void action(a)}
              planMetadata={metadata}
            />
          ) : (
            <InspectorPlaceholder />
          )}
        </section>
      </div>
      <footer className="statusbar">
        <div className="statusbar-left">
          <span
            className="status-item"
            role="status"
            title="Connection freshness is not execution outcome."
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
            {connection}
            {` · transport ${observation.transportStatus}`}
            {observation.error ? ` · ${observation.error}` : ""}
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
                ? `${activeRuns.length} active run${activeRuns.length === 1 ? "" : "s"}`
                : "No active runs"
              : "Active roster unavailable; absence is not proof of settlement."}
          </span>
          <span className="status-item faint">
            Connection freshness is not execution outcome.
          </span>
        </div>
        <div className="statusbar-right">
          <span
            className={`status-item${workspace.compatible ? " faint" : " warn"}`}
            title={localBuild?.buildId ?? "unbuilt source"}
          >
            <span className="build-part">
              Local browser build:{" "}
              <code>{localBuild?.buildId ?? "unbuilt source"}</code>.{" "}
            </span>
            <span>
              Shared compatibility:{" "}
              {workspace.compatible
                ? "compatible"
                : "unavailable / mismatch — reload built assets; normal actions disabled"}
              .
            </span>
          </span>
        </div>
      </footer>
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
      {newOpen && (
        <ActionDialog title="Create task" onClose={() => setNewOpen(false)}>
          <label>
            Kind
            <select
              aria-label="Kind"
              value={kind}
              onChange={(e) =>
                setKind(
                  e.target.value === "research"
                    ? "research"
                    : e.target.value === "diagnosis"
                      ? "diagnosis"
                      : "code",
                )
              }
            >
              <option value="code">Code</option>
              <option value="research">Readonly research</option>
              <option value="diagnosis">Readonly diagnosis</option>
            </select>
          </label>
          <label>
            Goal
            <textarea
              aria-label="Goal"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={6}
            />
          </label>
          <footer>
            <button
              type="button"
              className="primary"
              disabled={
                !workspace.actions ||
                workspace.workspace?.context.status !== "available" ||
                preparing ||
                !goal.trim()
              }
              onClick={() => {
                setNewOpen(false);
                void action({ kind: "create", taskKind: kind, goal });
              }}
            >
              Preview Create (does not Start)
            </button>
          </footer>
        </ActionDialog>
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
              history.replaceState(null, "", historyUrl(taskId, value.cursor));
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
