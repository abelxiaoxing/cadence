// The actual App, footer and child props under controlled observations. SSR and
// retained hook cells exercise transitions and callbacks, not React DOM/layout.
import {
  Children,
  type ComponentProps,
  type EffectCallback,
  isValidElement,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { ProjectObservation } from "../../src/service/contracts/gateway.ts";
import { PROJECT_ASSOCIATION_HEADER } from "../../src/service/contracts/workbench.ts";
import { LIMITS, publicError } from "../../src/service-contract.ts";
import { App } from "../../web/src/App";
import { browserClient } from "../../web/src/client/browser";
import type { ViewerState } from "../../web/src/client/observer";
import type { ChatWorkspace } from "../../web/src/components/workspace/ChatWorkspace";
import type { TaskSidebar } from "../../web/src/components/workspace/TaskSidebar";
import { LocaleProvider } from "../../web/src/i18n/locale";
import { context, hash, id } from "./fixtures";

const viewer: ViewerState = {
  actions: false,
  attached: false,
  transportStatus: "closed",
  attachmentVersion: 0,
};
const execution = {
  value: undefined as ProjectObservation | undefined,
  error: undefined as string | undefined,
  fresh: true,
  association: "unknown" as "associated" | "unassociated" | "unknown",
};
let readProjectHeader = false;
const reads = {
  project: vi.fn(),
  viewer: vi.fn(),
  reconnect: vi.fn(() => 7),
  whenReady: vi.fn<() => Promise<void>>(),
  prepared: vi.fn(),
  observe: vi.fn(),
};
vi.mock("../../web/src/client/use-project-observation", async (original) => {
  const actual =
    await original<
      typeof import("../../web/src/client/use-project-observation")
    >();
  return {
    ...actual,
    useProjectObservation: (
      ...args: Parameters<typeof actual.useProjectObservation>
    ) => {
      if (readProjectHeader)
        return retain(projectCells, () =>
          actual.useProjectObservation(...args),
        );
      return {
        ...execution,
        readiness: actual.projectReadiness(
          execution.value,
          execution.error,
          execution.fresh,
        ),
        refresh: reads.project,
        prepared: reads.prepared,
      };
    },
  };
});
vi.mock("../../web/src/client/use-workspace", () => ({
  useWorkspace: (...args: unknown[]) => {
    reads.observe(...args);
    return {
      ...viewer,
      refresh: reads.viewer,
      reconnect: reads.reconnect,
      whenReady: reads.whenReady,
    };
  },
}));

const epoch = id(),
  task = id(),
  chat = id(),
  workspaceId = id(),
  storeId = id();
const observed = (status: ProjectObservation["status"] = "running") => {
  execution.value = {
    kind: "project-observation",
    epoch: status === "running" ? epoch : null,
    workspaceId,
    status,
  };
  execution.association = "associated";
};
function ready() {
  Object.assign(viewer, {
    attached: true,
    epoch,
    actions: true,
    transportStatus: "current",
    attachmentVersion: 1,
  });
  viewer.workspace = {
    workspaceId,
    epoch,
    storeId,
    committedSeq: "1",
    rootLabel: "fixture",
    models: [],
    context: { status: "available", version: context() },
  };
}
function taskData(committedSeq = "1") {
  const scope = { kind: "task", id: task } as const;
  viewer.observation = {
    connection: "current",
    lastObservedMs: 1,
    snapshot: {
      protocol: 1,
      storeId,
      scope,
      epoch,
      committedSeq,
      runs: [],
      context: { status: "available", version: context() },
      horizon: {
        policy: "active-and-recent",
        historicalRuns: {
          reader: "runs",
          storeId,
          scope,
          snapshotSeq: committedSeq,
          after: null,
          limit: 50,
        },
      },
    },
  };
}

// Retain App's refs/state, its disclosure timer, and (in the header test)
// the real project hook's controlled GET. All other children use ordinary SSR.
let active: unknown[] | undefined,
  index = 0;
const appCells: unknown[] = [],
  projectCells: unknown[] = [],
  footerCells: unknown[] = [];
function retain<T>(cells: unknown[], render: () => T): T {
  const parent = active,
    outer = index;
  active = cells;
  index = 0;
  try {
    return render();
  } finally {
    active = parent;
    index = outer;
  }
}
const effects = new Map<unknown[], EffectCallback>(),
  cleanups = new Map<unknown[], () => void>();
vi.mock("react", async (original) => {
  const real = await original<typeof import("react")>();
  return {
    ...real,
    useRef(initial: unknown) {
      const ref = real.useRef(initial);
      if (!active) return ref;
      const at = index++;
      active[at] ??= ref;
      return active[at];
    },
    useState(initial: unknown) {
      const result = real.useState(initial);
      if (!active) return result;
      const cells = active,
        at = index++;
      if (!(at in cells)) cells[at] = result[0];
      return [
        cells[at],
        (value: unknown) => {
          cells[at] = typeof value === "function" ? value(cells[at]) : value;
        },
      ];
    },
    useEffect(effect: EffectCallback, deps?: readonly unknown[]) {
      real.useEffect(effect, deps);
      if (active !== footerCells && active !== projectCells) return;
      const at = index++,
        prior = active[at] as readonly unknown[] | undefined;
      if (!prior || deps?.some((v, i) => prior[i] !== v)) {
        effects.set(active, effect);
        active[at] = deps;
      }
    },
  };
});
let chatProps: ComponentProps<typeof ChatWorkspace>,
  sidebar: ComponentProps<typeof TaskSidebar>;
vi.mock(
  "../../web/src/components/workspace/ChatWorkspace",
  async (original) => {
    const real =
      await original<
        typeof import("../../web/src/components/workspace/ChatWorkspace")
      >();
    return {
      ...real,
      ChatWorkspace: (props: typeof chatProps) => {
        chatProps = props;
        return <real.ChatWorkspace {...props} />;
      },
    };
  },
);
vi.mock("../../web/src/components/workspace/TaskSidebar", async (original) => {
  const real =
    await original<
      typeof import("../../web/src/components/workspace/TaskSidebar")
    >();
  return {
    ...real,
    TaskSidebar: (props: typeof sidebar) => {
      sidebar = props;
      return <real.TaskSidebar {...props} />;
    },
  };
});
let connectionAction: () => void;
vi.mock(
  "../../web/src/components/workspace/WorkspaceNotice",
  async (original) => {
    const real =
      await original<
        typeof import("../../web/src/components/workspace/WorkspaceNotice")
      >();
    return {
      ...real,
      WorkspaceConnection: (
        props: ComponentProps<typeof real.WorkspaceConnection>,
      ) => {
        const disclosure = retain(footerCells, () =>
          real.WorkspaceConnection(props),
        );
        const panel = disclosure.props.children[1];
        const action = Children.toArray(panel.props.children).find(
          (child) => isValidElement(child) && child.type === "button",
        );
        if (!isValidElement<{ onClick: () => void }>(action))
          throw new Error("missing disclosure action");
        connectionAction = action.props.onClick;
        return disclosure;
      },
    };
  },
);
function RetainedApp(props: ComponentProps<typeof App>) {
  return retain(appCells, () => App(props));
}
const prepare = vi.fn(async () => epoch);
function render(
  locale: "en" | "zh" = "en",
  options: {
    project?: boolean;
    selectedEpoch?: string;
    task?: boolean;
    api?: ReturnType<typeof browserClient>;
  } = {},
) {
  vi.stubGlobal("window", {
    location: new URL(
      `http://127.0.0.1:43210/app#${options.task ? `task=${task}` : `chat=${chat}`}`,
    ),
  });
  const html = renderToStaticMarkup(
    <LocaleProvider initial={locale}>
      <RetainedApp
        api={options.api}
        onOpenService={() => {}}
        project={
          options.project
            ? {
                id: hash,
                path: "/fixture",
                cwd: "/fixture",
                epoch: options.selectedEpoch ?? epoch,
              }
            : undefined
        }
        onPrepareExecution={options.project ? prepare : undefined}
      />
    </LocaleProvider>,
  );
  for (const [cells, effect] of effects) {
    cleanups.get(cells)?.();
    cleanups.delete(cells);
    const result = effect();
    if (typeof result === "function") cleanups.set(cells, result);
  }
  effects.clear();
  const top = html.slice(
    html.indexOf("</header>"),
    html.indexOf('class="layout"'),
  );
  const footer = html.slice(html.indexOf('<footer class="statusbar">'));
  expect(top).not.toMatch(
    /workspace-notice|workspace-connection|Latest state unavailable|当前无法获取最新状态|Started work may still|已开始的工作可能仍在/,
  );
  expect(html.match(/class="workspace-connection"/g)).toHaveLength(1);
  const details = footer.match(
    /<details class="workspace-connection">(.*?)<\/details>/s,
  )?.[1];
  expect(details).toBeDefined();
  const summary = details?.match(/<summary (.*?)<\/summary>/s)?.[1] ?? "";
  expect(summary).toContain('aria-label="');
  return { html, top, footer, details, summary };
}
afterEach(() => {
  for (const cleanup of cleanups.values()) cleanup();
  effects.clear();
  cleanups.clear();
  appCells.length = footerCells.length = projectCells.length = 0;
  readProjectHeader = false;
  execution.value = undefined;
  execution.error = undefined;
  execution.fresh = true;
  execution.association = "unknown";
  Object.assign(viewer, {
    epoch: undefined,
    workspace: undefined,
    error: undefined,
    observation: undefined,
    activeRuns: undefined,
    attached: false,
    actions: false,
    transportStatus: "closed",
    attachmentVersion: 0,
  });
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
for (const locale of ["en", "zh"] as const) {
  const zh = locale === "zh";
  it.each(["stopped", "not-started"] as const)(
    `${locale}: positive %s in the footer, folder and model picker remain usable`,
    (status) => {
      observed(status);
      const { html, footer, summary, details } = render(locale, {
        project: true,
      });
      expect(summary).toContain(
        status === "stopped"
          ? zh
            ? "执行服务已停止"
            : "Execution stopped"
          : zh
            ? "执行服务尚未启动"
            : "Execution not started",
      );
      expect(details).toContain(
        zh ? "可按需准备执行服务" : "Ready to prepare execution",
      );
      expect(summary).not.toMatch(/status-dot (ok|error)/);
      expect(html.match(/class="status-cwd"/g)).toHaveLength(1);
      expect(footer).toMatch(
        /class="statusbar-right".*class="status-cwd" title="\/fixture"/,
      );
      const conversation = html.slice(
        html.indexOf('class="chat-workspace"'),
        html.indexOf("</main>"),
      );
      expect(conversation).toContain('class="conversation-header"');
      expect(conversation).not.toMatch(/conversation-cwd|\/fixture/);
      expect(footer).toContain("<span>fixture</span>");
      expect(footer).toContain(
        zh
          ? 'aria-label="切换工作文件夹"'
          : 'aria-label="Switch working folder"',
      );
      expect(html).toContain(zh ? "选择模型" : "Choose a model");
      expect(reads.observe.mock.lastCall?.[2]).toBe(false);
    },
  );
  it(`${locale}: initial load, healthy viewer, model refresh, failed read and recovery keep the same connection disclosure`, () => {
    const options = { project: true };
    expect(render(locale, options).summary).toContain(
      zh ? "正在连接…" : "Connecting…",
    );
    observed();
    expect(render(locale, options).summary).toContain(
      zh ? "正在连接…" : "Connecting…",
    );
    expect(reads.observe.mock.lastCall?.slice(1)).toEqual([null, true, epoch]);
    ready();
    const readyLabel = zh ? "可以开始对话" : "Chat ready";
    expect(render(locale, options).summary).toContain(readyLabel);
    expect(chatProps.actionsReady).toBe(true);
    chatProps.onModelChanged?.();
    expect(reads.project).toHaveBeenCalledTimes(1);
    expect(reads.viewer).toHaveBeenCalledTimes(1);
    execution.fresh = false;
    expect(render(locale, options).summary).toContain(
      zh ? "正在更新状态…" : "Updating state…",
    );
    expect(chatProps.actionsReady).toBe(false);
    expect(reads.observe.mock.lastCall?.slice(1)).toEqual([null, true, epoch]);
    execution.error = "timeout";
    const failed = render(locale, options);
    expect(failed.summary).toContain(
      zh ? "仅有上次读取的状态" : "Last known state",
    );
    expect(failed.details).toContain("timeout");
    connectionAction();
    expect(reads.project).toHaveBeenCalledTimes(2);
    expect(reads.viewer).toHaveBeenCalledTimes(2);
    expect(prepare).not.toHaveBeenCalled();
    expect(reads.reconnect).not.toHaveBeenCalled();
    execution.error = undefined;
    expect(render(locale, options).details).toContain("timeout");
    execution.fresh = true;
    expect(render(locale, options).summary).toContain(readyLabel);
    expect(chatProps.actionsReady).toBe(true);
  });
  it(`${locale}: readonly task resync stays updating after the HTTP snapshot, until live evidence arrives`, () => {
    observed();
    ready();
    taskData();
    const options = { project: true, task: true };
    const current = zh ? "任务状态已更新" : "Task up to date";
    const updating = zh ? "正在更新状态…" : "Updating state…";
    expect(render(locale, options).summary).toContain(current);

    // A resync frame marks the transport stale, without a socket error.
    viewer.transportStatus = "stale";
    viewer.actions = false;
    expect(render(locale, options).summary).toContain(updating);
    expect(sidebar.actionsUnavailable).toBeTruthy();

    // A new HTTP snapshot makes the projection current, not the transport.
    taskData("2");
    expect(render(locale, options).summary).toContain(updating);
    expect(sidebar.snapshot).toBe("2");
    expect(sidebar.actionsUnavailable).toBeTruthy();

    // Observer accepted a matching live frame for this subscription.
    viewer.transportStatus = "current";
    viewer.actions = true;
    expect(render(locale, options).summary).toContain(current);
    expect(sidebar.actionsUnavailable).toBe("");
  });
  it.each(["project", "viewer"])(
    `${locale}: %s access refusal shows sign-in instead of a read retry`,
    (source) => {
      observed();
      ready();
      if (source === "project") execution.error = "unauthenticated";
      else viewer.error = "Access revoked; explicit token re-entry required.";
      const result = render(locale, { project: true });
      expect(result.summary).toContain(
        zh ? "需要重新登录" : "Sign-in required",
      );
      expect(result.details).toContain(
        zh ? ">重新登录</button>" : ">Sign in again</button>",
      );
      expect(result.details).not.toContain(
        zh ? "读取当前状态</button>" : "Observe current state</button>",
      );
      const reload = vi.fn();
      Object.assign(window.location, { reload });
      connectionAction();
      expect(reload).toHaveBeenCalledTimes(1);
      expect(reads.project).not.toHaveBeenCalled();
      expect(reads.viewer).not.toHaveBeenCalled();
      expect(chatProps.actionsReady).toBe(false);
      expect(chatProps.enabled).toBe(false);
      expect(chatProps.prepareForSend).toBeUndefined();
      expect(chatProps.prepareForPlan).toBeUndefined();
      if (source === "viewer") {
        // Even if the project GET then observes a replacement owner, it did
        // not authenticate this page again. No new viewer is permitted.
        viewer.error = undefined;
        observed();
        if (execution.value) execution.value.epoch = id();
        expect(render(locale, { project: true }).summary).toContain(
          zh ? "需要重新登录" : "Sign-in required",
        );
        expect(reads.observe.mock.lastCall?.[2]).toBe(false);
      }
      expect(result.html).toContain(
        zh ? 'aria-label="Cadence 服务"' : 'aria-label="Cadence service"',
      );
    },
  );
}
it("an independent owner is browse-only until explicit preparation; even a same-epoch handoff waits for the requested new viewer", async () => {
  observed();
  execution.association = "unassociated";
  const options = { project: true };
  expect(render("en", options).summary).toContain("Browsing only");
  expect(reads.observe.mock.lastCall?.slice(1)).toEqual([null, false, null]);
  expect(chatProps.available).toBe(true);
  expect(chatProps.enabled).toBe(true);
  expect(chatProps.actionsReady).toBe(false);
  connectionAction();
  expect(reads.viewer).not.toHaveBeenCalled();
  expect(prepare).not.toHaveBeenCalled();
  reads.prepared.mockImplementationOnce(() => {
    execution.association = "associated";
  });
  let release!: () => void;
  reads.whenReady.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const signal = new AbortController().signal;
  const pending = chatProps.prepareForSend?.(signal, {
    id: chat,
    cwd: "/fixture",
  });
  await Promise.resolve();
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(prepare).toHaveBeenCalledWith(
    "send",
    signal,
    { id: chat, cwd: "/fixture" },
    undefined,
  );
  expect(reads.whenReady).toHaveBeenCalledWith(epoch, signal, 7);
  ready();
  expect(render("en", options).summary).toContain("Updating state…");
  expect(reads.observe.mock.lastCall?.slice(1)).toEqual([null, true, epoch]);
  expect(chatProps.actionsReady).toBe(false);
  expect(chatProps.canInterrupt).toBe(false);
  expect(sidebar.canCancel).toBe(false);
  release();
  await pending;
  expect(render("en", options).summary).toContain("Chat ready");
  expect(chatProps.actionsReady).toBe(true);
  expect(prepare).toHaveBeenCalledTimes(1);
});
it("does not infer association from even a remembered non-null entry epoch", () => {
  observed();
  execution.association = "unknown";
  const result = render("en", { project: true });
  expect(result.details).toContain("Viewer access not confirmed");
  expect(result.summary).not.toContain("Browsing only");
  expect(reads.observe.mock.lastCall?.[2]).toBe(false);
  expect(prepare).not.toHaveBeenCalled();
});
it("a direct viewer reconnecting after a good read does not diagnose a history read failure", () => {
  ready();
  expect(render().summary).toContain("Chat ready");
  viewer.attached = false;
  viewer.workspace = undefined;
  viewer.transportStatus = "closed";
  const result = render();
  expect(result.summary).toContain("Updating state…");
  expect(result.html).toContain("Reading conversation history…");
  expect(result.html).not.toContain("Conversation history could not be read");
  expect(chatProps.actionsReady).toBe(false);
});
it("neither a mismatched workspace nor the previous selected epoch supplies action or safety authority", () => {
  observed();
  ready();
  const options = { project: true };
  if (!viewer.workspace) throw new Error("fixture");
  viewer.workspace.workspaceId = id();
  expect(render("en", options).summary).not.toContain("Chat ready");
  expect(chatProps.actionsReady).toBe(false);
  expect(chatProps.canInterrupt).toBe(false);
  execution.fresh = false;
  render("en", options);
  expect(sidebar.canCancel).toBe(false);
  execution.fresh = true;
  viewer.workspace.workspaceId = workspaceId;
  expect(render("en", options).summary).toContain("Chat ready");
  // A new project selection arrives before its own read or effect cleanup.
  execution.fresh = false;
  render("en", { ...options, selectedEpoch: id() });
  expect(reads.observe.mock.lastCall?.slice(1)).toEqual([null, false, null]);
  expect(chatProps.actionsReady).toBe(false);
  expect(chatProps.canInterrupt).toBe(false);
  expect(sidebar.canCancel).toBe(false);
});
it("a task needs a matching snapshot AND live transport; quiet resync is not failure but a persistent wait remains diagnosable", () => {
  vi.useFakeTimers();
  ready();
  taskData();
  const options = { task: true, project: true };
  observed();
  expect(render("en", options).summary).toContain("Task up to date");
  expect(reads.observe.mock.lastCall?.slice(1)).toEqual([
    { kind: "task", id: task },
    true,
    epoch,
  ]);
  if (!viewer.observation) throw new Error("fixture");
  viewer.observation.connection = "resync";
  expect(render("en", options).summary).toContain("Updating state…");
  viewer.observation.connection = "stale";
  expect(render("en", options).summary).toContain("Updating state…");
  viewer.observation.connection = "current";
  viewer.observation.snapshot.scope.id = id();
  expect(render("en", options).summary).toContain("Updating state…");
  viewer.observation.snapshot.scope.id = task;
  viewer.observation.snapshot.epoch = id();
  expect(render("en", options).summary).toContain("Updating state…");
  viewer.observation.snapshot.epoch = epoch;
  viewer.transportStatus = "closed";
  expect(render("en", options).summary).toContain("Updating state…");
  vi.advanceTimersByTime(LIMITS.staleMs);
  const delayed = render("en", options);
  expect(delayed.summary).toContain("Last known state");
  expect(delayed.details).toContain(
    "Waiting for current state from this connection.",
  );
  connectionAction();
  expect(prepare).not.toHaveBeenCalled();
  expect(reads.reconnect).not.toHaveBeenCalled();
  viewer.transportStatus = "stale";
  viewer.error = "socket-timeout";
  expect(render("en", options).details).toContain(
    "Viewer observation: No recent update from the task connection (socket-timeout).",
  );
  viewer.error = undefined;
  viewer.transportStatus = "current";
  expect(render("en", options).summary).toContain("Task up to date");
});
it.each(["stopped", "not-started", "running"] as const)(
  "retained %s after a failed project read is neither positive stop nor ready",
  (status) => {
    observed(status);
    execution.fresh = false;
    execution.error = "timeout";
    const { summary, details } = render("en", { project: true });
    expect(summary).toContain("Last known state");
    expect(summary).not.toMatch(
      /status-dot ok|Execution (stopped|not started)|Chat ready/,
    );
    expect(details).not.toContain("Ready to prepare execution");
    expect(chatProps.actionsReady).toBe(false);
    expect(reads.observe.mock.lastCall?.[2]).toBe(false);
  },
);
it("the direct owner's first failure is visible without falsely claiming retained data", () => {
  viewer.error = "stale";
  const { details, summary, html } = render();
  expect(summary).toContain("Latest state unavailable.");
  expect(details).toContain(
    "Context changed. Read the current state before confirming a plan.",
  );
  expect(details).not.toMatch(
    /models\.json|systemctl|restart|Retained history is shown/,
  );
  expect(html).toContain("Conversation history could not be read");
  expect(reads.observe.mock.lastCall?.slice(1)).toEqual([null, true, null]);
});
it("the explicit workflow Cancel refusal stays visible independently of project and viewer diagnostics; recovery does not repeat it", async () => {
  vi.stubGlobal("window", { location: new URL("http://127.0.0.1:43210/app") });
  const api = browserClient();
  const command = vi
    .spyOn(api.client, "workbenchCommand")
    .mockResolvedValue({ kind: "error", error: publicError("conflict") });
  observed();
  ready();
  const options = { project: true, api };
  render("en", options);
  await sidebar.onCancelWorkflow?.({
    id: id(),
    epoch,
    goal: "fixture",
    phase: "implementing",
    status: "running",
    steps: [],
    notice: "",
    mergedCommit: null,
    humanReviewed: false,
  });
  execution.error = "timeout";
  viewer.error = "stale";
  const failed = render("en", options);
  expect(failed.top).toContain('role="alert">conflict</p>');
  expect(failed.details).toContain("Project observation: timeout.");
  expect(failed.details).toContain("Viewer observation: stale.");
  connectionAction();
  execution.error = viewer.error = undefined;
  expect(render("en", options).summary).toContain("Chat ready");
  expect(command).toHaveBeenCalledTimes(1);
});

it("a safety roster arriving before the workspace keeps its controls in navigation without pushing down the transcript", () => {
  viewer.attached = true;
  viewer.epoch = epoch;
  viewer.activeRuns = {
    status: "complete",
    workspaceId,
    storeId,
    epoch,
    runs: [
      {
        taskId: task,
        operationId: id(),
        runId: id(),
        epoch,
        kind: "start",
        stage: "active",
      },
    ],
  };
  const { html, top } = render();
  expect(top).not.toContain("run-strip");
  expect(html).toContain('class="run-strip"');
  expect(html).toContain("Cancel run — request stop");
});

it("the selected project GET's actual association header reaches App; changing only the header changes viewer admission", async () => {
  vi.useFakeTimers();
  readProjectHeader = true;
  let association = "unassociated";
  const get = vi.fn(async () =>
    Response.json(
      { kind: "project-observation", status: "running", epoch, workspaceId },
      { headers: { [PROJECT_ASSOCIATION_HEADER]: association } },
    ),
  );
  vi.stubGlobal("fetch", get);
  const options = { project: true };
  render("en", options);
  await vi.advanceTimersByTimeAsync(0);
  expect(render("en", options).summary).toContain("Browsing only");
  expect(reads.observe.mock.lastCall?.slice(1)).toEqual([null, false, null]);
  expect(chatProps.available).toBe(true);
  expect(get).toHaveBeenCalledTimes(1);
  association = "associated";
  connectionAction();
  render("en", options);
  await vi.advanceTimersByTimeAsync(0);
  render("en", options);
  expect(reads.observe.mock.lastCall?.slice(1)).toEqual([null, true, epoch]);
  expect(get).toHaveBeenCalledTimes(2);
  expect(prepare).not.toHaveBeenCalled();

  association = "unassociated";
  connectionAction();
  render("en", options);
  await vi.advanceTimersByTimeAsync(0);
  expect(render("en", options).summary).toContain("Browsing only");
  // Authenticated confirmation is also real evidence. No session should be
  // needed to *begin* this preparation, nor a second GET to confirm its reply.
  const signal = new AbortController().signal;
  await chatProps.prepareForSend?.(signal);
  render("en", options);
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(reads.whenReady).toHaveBeenCalledWith(epoch, signal, 7);
  expect(reads.observe.mock.lastCall?.slice(1)).toEqual([null, true, epoch]);
  expect(chatProps.actionsReady).toBe(false); // viewer has not supplied data
});
