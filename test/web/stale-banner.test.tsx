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
import type {
  ProjectObservation,
  WorkbenchEntry,
} from "../../src/service/contracts/gateway.ts";
import { PROJECT_ASSOCIATION_HEADER } from "../../src/service/contracts/workbench.ts";
import type { WorkflowRun } from "../../src/service/contracts/workflow.ts";
import { LIMITS, publicError } from "../../src/service-contract.ts";
import { App } from "../../web/src/App";
import { browserClient } from "../../web/src/client/browser";
import { LAST_PROJECT_STORAGE_KEY } from "../../web/src/client/last-project";
import {
  ObservationAccess,
  type ViewerState,
} from "../../web/src/client/observer";
import { recordedTurn } from "../../web/src/client/turn-source";
import type { ChatWorkspace } from "../../web/src/components/workspace/ChatWorkspace";
import { FolderSetup } from "../../web/src/components/workspace/FolderSetup";
import type { TaskSidebar } from "../../web/src/components/workspace/TaskSidebar";
import { LocaleProvider } from "../../web/src/i18n/locale";
import { Workbench } from "../../web/src/Workbench";
import { context, coverage, hash, id } from "./fixtures";

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
let readProjectHeader = false,
  liveViewer = false,
  readTaskHistory = false;
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
vi.mock("../../web/src/client/use-workspace", async (original) => {
  const real =
    await original<typeof import("../../web/src/client/use-workspace")>();
  return {
    useWorkspace: (...args: Parameters<typeof real.useWorkspace>) => {
      if (liveViewer)
        return retain(workspaceCells, () => real.useWorkspace(...args));
      reads.observe(...args);
      return {
        ...viewer,
        refresh: reads.viewer,
        reconnect: reads.reconnect,
        whenReady: reads.whenReady,
      };
    },
  };
});

// In the browse-only cases, run the real bootstrap and the actual sidebar /
// transcript page reads. The rest of the child tree is still ordinary SSR.
vi.mock(
  "../../web/src/client/use-retained-task-workspace",
  async (original) => {
    const actual =
      await original<
        typeof import("../../web/src/client/use-retained-task-workspace")
      >();
    return {
      useRetainedTaskWorkspace: (
        ...args: Parameters<typeof actual.useRetainedTaskWorkspace>
      ) =>
        retain(readTaskHistory ? retainedCells : undefined, () =>
          actual.useRetainedTaskWorkspace(...args),
        ),
    };
  },
);
vi.mock("../../web/src/history/use-page", async (original) => {
  const actual =
    await original<typeof import("../../web/src/history/use-page")>();
  return {
    usePage: (...args: Parameters<typeof actual.usePage>) => {
      const reader = args[1]?.reader;
      const cells =
        readTaskHistory &&
        (reader === "tasks" || reader === "messages" || reader === "runs")
          ? pageCells[reader]
          : undefined;
      return retain(cells, () => actual.usePage(...args));
    },
  };
});

// Feed the three actual workflow surfaces one retained run. Capture only
// their rendered HTML button props so we can also invoke a retired handler.
let workflow: WorkflowRun | undefined;
type StopSurface = "line" | "sidebar" | "card";
type StopButton = { disabled: boolean; onClick(): void };
const stopButtons = new Map<StopSurface, StopButton>();
vi.mock("react/jsx-dev-runtime", async (original) => {
  const actual = await original<typeof import("react/jsx-dev-runtime")>();
  const jsxDEV: typeof actual.jsxDEV = (...args) => {
    const el = actual.jsxDEV(...args);
    if (
      workflow &&
      el.type === "button" &&
      isValidElement<ComponentProps<"button">>(el)
    ) {
      const label = "Cancel workflow — request stop";
      const props = el.props;
      const surface =
        props["aria-label"] === label
          ? "line"
          : Children.toArray(props.children).includes(label)
            ? props.className === "danger"
              ? "card"
              : "sidebar"
            : undefined;
      if (surface) stopButtons.set(surface, props as StopButton);
    }
    return el;
  };
  return { ...actual, jsxDEV };
});
vi.mock("../../web/src/client/use-workbench", async (original) => {
  const real =
    await original<typeof import("../../web/src/client/use-workbench")>();
  return {
    ...real,
    useWorkbench: (...args: Parameters<typeof real.useWorkbench>) => {
      const read = real.useWorkbench(...args);
      if (workflow && args[1]?.kind === "workflow-active")
        return {
          ...read,
          value: { kind: "workflow-active", runs: [workflow], links: [] },
        };
      if (
        workflow &&
        args[1]?.kind === "workflow" &&
        args[1].id === workflow.id
      )
        return {
          ...read,
          value: { kind: "workflow", response: { type: "run", run: workflow } },
        };
      return read;
    },
  };
});
vi.mock("../../web/src/components/workspace/AgentDock", async (original) => {
  const real =
    await original<
      typeof import("../../web/src/components/workspace/AgentDock")
    >();
  return {
    ...real,
    useWorkflowRuns: (...args: Parameters<typeof real.useWorkflowRuns>) => {
      const view = real.useWorkflowRuns(...args);
      return workflow
        ? { ...view, runs: new Map([[workflow.id, workflow]]) }
        : view;
    },
  };
});
vi.mock("../../web/src/client/use-conversation", async (original) => {
  const real =
    await original<typeof import("../../web/src/client/use-conversation")>();
  return {
    ...real,
    useConversation: (...args: Parameters<typeof real.useConversation>) => {
      const view = real.useConversation(...args);
      return workflow
        ? {
            ...view,
            runs: [workflow.id],
            count: 1,
            turns: [
              {
                ordinal: 0,
                ...recordedTurn({
                  id: chat,
                  epoch,
                  status: "completed",
                  notice: "",
                  omitted: { thinking: false, media: false, other: false },
                  items: [],
                }),
              },
            ],
          }
        : view;
    },
  };
});

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
let allocation: AbortController | undefined;
function retireViewer() {
  allocation?.abort();
  allocation = undefined;
  Object.assign(viewer, { attached: false, allocationSignal: undefined });
}
function attachViewer() {
  retireViewer();
  allocation = new AbortController();
  Object.assign(viewer, {
    epoch,
    attached: true,
    allocationSignal: allocation.signal,
    attachmentVersion: viewer.attachmentVersion + 1,
  });
}
function ready() {
  if (!viewer.attached) attachViewer();
  viewer.actions = true;
  viewer.transportStatus = "current";
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
const pageCells: Record<"tasks" | "messages" | "runs", unknown[]> = {
  tasks: [],
  messages: [],
  runs: [],
};
const retainedCells: unknown[] = [];
const appCells: unknown[] = [],
  workbenchCells: unknown[] = [],
  workspaceCells: unknown[] = [],
  projectCells: unknown[] = [],
  footerCells: unknown[] = [];
function retain<T>(cells: unknown[] | undefined, render: () => T): T {
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
const effects = new Map<object, EffectCallback>(),
  cleanups = new Map<object, () => void>();
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
    useMemo<T>(factory: () => T, deps: readonly unknown[]) {
      const value = real.useMemo(factory, deps);
      if (active !== workspaceCells && active !== retainedCells) return value;
      const at = index++;
      const previous = active[at] as
        | { value: T; deps: readonly unknown[] }
        | undefined;
      if (previous && deps.every((d, i) => Object.is(d, previous.deps[i])))
        return previous.value;
      active[at] = { value, deps };
      return value;
    },
    useCallback(fn: unknown, deps: readonly unknown[]) {
      const callback = real.useCallback(fn as () => void, deps);
      if (active !== workbenchCells) return callback;
      const at = index++;
      const prior = active[at] as
        | { fn: unknown; deps: readonly unknown[] }
        | undefined;
      if (prior && deps.every((d, i) => d === prior.deps[i])) return prior.fn;
      active[at] = { fn, deps };
      return fn;
    },
    useEffect(effect: EffectCallback, deps?: readonly unknown[]) {
      real.useEffect(effect, deps);
      if (
        active !== footerCells &&
        active !== projectCells &&
        active !== workspaceCells &&
        active !== workbenchCells &&
        active !== retainedCells &&
        !(active && Object.values(pageCells).includes(active))
      )
        return;
      const at = index++,
        prior = active[at] as
          | { key: object; deps?: readonly unknown[] }
          | undefined;
      if (!prior || !deps || deps.some((v, i) => prior.deps?.[i] !== v)) {
        const key = prior?.key ?? {};
        effects.set(key, effect);
        active[at] = { deps, key };
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
    projectId?: string;
    access?: ObservationAccess;
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
        projectAccess={options.access}
        onOpenService={() => {}}
        project={
          options.project
            ? {
                id: options.projectId ?? hash,
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
  commitEffects();
  return connectionMarkup(html);
}
function commitEffects() {
  for (const [cells, effect] of effects) {
    cleanups.get(cells)?.();
    cleanups.delete(cells);
    const result = effect();
    if (typeof result === "function") cleanups.set(cells, result);
  }
  effects.clear();
}
function connectionMarkup(html: string) {
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
  workflow = undefined;
  stopButtons.clear();
  for (const cleanup of cleanups.values()) cleanup();
  effects.clear();
  cleanups.clear();
  workspaceCells.length =
    workbenchCells.length =
    appCells.length =
    footerCells.length =
    projectCells.length =
      0;
  for (const cells of [retainedCells, ...Object.values(pageCells)])
    cells.length = 0;
  readTaskHistory = readProjectHeader = liveViewer = false;
  execution.value = undefined;
  execution.error = undefined;
  execution.fresh = true;
  execution.association = "unknown";
  retireViewer();
  Object.assign(viewer, {
    epoch: undefined,
    workspace: undefined,
    error: undefined,
    observation: undefined,
    activeRuns: undefined,
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
    expect(reads.observe.mock.lastCall?.slice(1, 4)).toEqual([
      null,
      true,
      epoch,
    ]);
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
    expect(reads.observe.mock.lastCall?.slice(1, 4)).toEqual([
      null,
      true,
      epoch,
    ]);
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
  it.each(["project", "viewer"] as const)(
    `${locale}: %s access refusal shows sign-in instead of a read retry`,
    async (source) => {
      observed();
      ready();
      const access = new ObservationAccess();
      const options = { project: true, access };
      render(locale, options);
      const oldRefresh = connectionAction;
      const oldPrepare = chatProps.prepareForSend;
      const code = source === "project" ? "unauthenticated" : "forbidden";
      access.refuse(source, code);
      if (source === "project") execution.error = code;
      const result = render(locale, options);
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
      oldRefresh();
      await expect(oldPrepare?.(new AbortController().signal)).rejects.toThrow(
        code,
      );
      expect(prepare).not.toHaveBeenCalled();
      expect(reads.project).not.toHaveBeenCalled();
      expect(reads.viewer).not.toHaveBeenCalled();
      // Even if the project GET then observes a replacement owner, it did
      // not authenticate this page again. No new viewer is permitted.
      viewer.error = execution.error = undefined;
      observed();
      if (execution.value) execution.value.epoch = id();
      expect(
        render(locale, { ...options, selectedEpoch: id() }).summary,
      ).toContain(zh ? "需要重新登录" : "Sign-in required");
      expect(reads.observe.mock.lastCall?.[2]).toBe(false);
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
  expect(reads.observe.mock.lastCall?.slice(1, 4)).toEqual([null, false, null]);
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
  expect(reads.observe.mock.lastCall?.slice(1, 4)).toEqual([null, true, epoch]);
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
  retireViewer();
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
  expect(reads.observe.mock.lastCall?.slice(1, 4)).toEqual([null, false, null]);
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
  expect(reads.observe.mock.lastCall?.slice(1, 4)).toEqual([
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
  expect(reads.observe.mock.lastCall?.slice(1, 4)).toEqual([null, true, null]);
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

function activeWorkflow(): WorkflowRun {
  return {
    id: id(),
    epoch,
    goal: "Retained workflow",
    phase: "implementing",
    status: "running",
    steps: [],
    notice: "",
    mergedCommit: null,
    humanReviewed: false,
  };
}
it.each(["sidebar", "line", "card"] as const)(
  "the real %s workflow stop button and dispatch share the exact viewer, not history/WS freshness",
  async (surface) => {
    vi.stubGlobal("window", {
      location: new URL("http://127.0.0.1:43210/app"),
    });
    const api = browserClient(),
      access = new ObservationAccess();
    const command = vi
      .spyOn(api.client, "workbenchCommand")
      .mockResolvedValue({ kind: "error", error: publicError("conflict") });
    const options = { project: true, api, access };
    observed();
    ready();
    workflow = activeWorkflow();
    const draw = () => {
      stopButtons.clear();
      return render("en", options);
    };
    draw();
    sidebar.onWorkflow?.(workflow, null); // open the whole-run AgentView / Card
    const button = () => {
      draw();
      const stop = stopButtons.get(surface);
      if (!stop) throw Error(`missing ${surface} Stop`);
      return stop;
    };
    const original = button();
    expect(original.disabled).toBe(false);
    let finish!: () => void;
    reads.whenReady.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const handoff = chatProps.prepareForSend?.(new AbortController().signal);
    await Promise.resolve();
    original.onClick(); // before render, same epoch
    const waiting = button();
    expect(waiting.disabled).toBe(true);
    waiting.onClick();
    attachViewer();
    finish();
    await handoff;
    expect(button().disabled).toBe(false);
    original.onClick(); // cannot borrow the replacement
    waiting.onClick();
    workflow = { ...workflow, epoch: id() };
    const previousOwner = button();
    expect(previousOwner.disabled).toBe(true);
    previousOwner.onClick();
    workflow = { ...workflow, epoch };
    if (!viewer.workspace) throw Error("missing viewer workspace");
    viewer.workspace.workspaceId = id();
    const otherProject = button();
    expect(otherProject.disabled).toBe(true);
    otherProject.onClick();
    viewer.workspace.workspaceId = workspaceId;
    const beforeBrowse = button();
    execution.association = "unassociated";
    const browsing = draw();
    expect(browsing.summary).toContain("Browsing only");
    beforeBrowse.onClick();
    // The sidebar roster may depart; retained runs in the chat and detail still render.
    stopButtons.get(surface)?.onClick();
    if (surface !== "sidebar")
      expect(stopButtons.get(surface)?.disabled).toBe(true);
    execution.association = "associated";
    attachViewer();
    viewer.transportStatus = "stale";
    viewer.actions = false;
    viewer.error = "timeout";
    viewer.workspace = undefined;
    viewer.activeRuns = {
      status: "complete",
      runs: [],
      workspaceId,
      storeId,
      epoch,
    };
    const safety = button();
    expect(safety.disabled).toBe(false);
    expect(chatProps.actionsReady).toBe(false);
    expect(command).not.toHaveBeenCalled();
    safety.onClick();
    await Promise.resolve();
    await Promise.resolve();
    expect(command).toHaveBeenCalledExactlyOnceWith({
      kind: "workflow-cancel",
      epoch,
      runId: workflow.id,
      commandId: expect.any(String),
    });
    connectionAction();
    ready();
    const recovered = button();
    expect(recovered.disabled).toBe(false);
    access.refuse("viewer", "unauthenticated");
    recovered.onClick(); // before render or effect cleanup
    expect(draw().summary).toContain("Sign-in required");
    original.onClick();
    expect(command).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledOnce(); // only the explicit handoff above
  },
);

it("a safety roster arriving before the workspace keeps its controls in navigation without pushing down the transcript", () => {
  attachViewer();
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
  expect(reads.observe.mock.lastCall?.slice(1, 4)).toEqual([null, false, null]);
  expect(chatProps.available).toBe(true);
  expect(get).toHaveBeenCalledTimes(1);
  association = "associated";
  connectionAction();
  render("en", options);
  await vi.advanceTimersByTimeAsync(0);
  render("en", options);
  expect(reads.observe.mock.lastCall?.slice(1, 4)).toEqual([null, true, epoch]);
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
  expect(reads.observe.mock.lastCall?.slice(1, 4)).toEqual([null, true, epoch]);
  expect(chatProps.actionsReady).toBe(false); // viewer has not supplied data
});

// Retain the real Workbench effects and render its actual setup / selected App.
// Requests, history and clock below are controlled; this is not browser evidence.
const gatewayEntry = (project = true): WorkbenchEntry => ({
  kind: "workbench",
  home: "/home/fixture",
  epoch,
  csrf: id(),
  projects: project
    ? [{ id: hash, cwd: "/fixture", path: "/fixture", epoch }]
    : [],
  recoveries: [],
  build: {
    contractHash: hash,
    assets: { buildId: hash, sourceHash: hash, contractHash: hash },
  },
});
function entryView(searchHash: string, locale: "en" | "zh" = "en") {
  vi.useFakeTimers();
  const location = new URL(`http://127.0.0.1:43210/app${searchHash}`);
  const window = Object.assign(new EventTarget(), { location });
  vi.stubGlobal("window", window);
  vi.stubGlobal("location", location);
  const move = vi.fn((_state: unknown, _title: string, path: string) => {
    location.href = new URL(path, location).href;
  });
  vi.stubGlobal("history", {
    replaceState: move,
    pushState: move,
    state: null,
  });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => (key === LAST_PROJECT_STORAGE_KEY ? hash : null),
    setItem: vi.fn(),
  });
  const calls: {
    url: string;
    init?: RequestInit;
    resolve: (res: Response) => void;
  }[] = [];
  vi.stubGlobal("sessionStorage", {
    getItem: () => null,
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
  let activityEpoch: string = epoch;
  let refuseActivity = false,
    activityReads = 0;
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    if (url === "/workbench/v1/activity" && !init?.method) {
      activityReads++;
      if (refuseActivity)
        return Promise.resolve(new Response("", { status: 403 }));
      return Promise.resolve(
        Response.json({
          kind: "activity-discovery",
          epoch: activityEpoch,
          observedAt: 1,
          completeness: "complete",
          unavailable: 0,
          projects: [],
        }),
      );
    }
    return new Promise<Response>((resolve) =>
      calls.push({ url, init, resolve }),
    );
  });
  let setup: ComponentProps<typeof FolderSetup> | undefined;
  let app: ComponentProps<typeof App> | undefined;
  function Screen() {
    const result = retain(workbenchCells, Workbench);
    const first =
      result.type === App ? result : Children.toArray(result.props.children)[0];
    setup =
      isValidElement<ComponentProps<typeof FolderSetup>>(first) &&
      first.type === FolderSetup
        ? first.props
        : undefined;
    app =
      isValidElement<ComponentProps<typeof App>>(first) && first.type === App
        ? first.props
        : undefined;
    return result;
  }
  const draw = () => {
    const html = renderToStaticMarkup(
      <LocaleProvider initial={locale}>
        <Screen />
      </LocaleProvider>,
    );
    commitEffects();
    const view = connectionMarkup(html);
    expect(view.top).not.toContain("banner-notice");
    return { ...view, setup, app };
  };
  return {
    draw,
    calls,
    move,
    location,
    window,
    forbidActivity: () => {
      refuseActivity = true;
    },
    activityReads: () => activityReads,
    setActivityEpoch: (next: string) => {
      activityEpoch = next;
    },
  };
}
const flush = () => vi.advanceTimersByTimeAsync(0);
function partialBody(value: unknown) {
  const data = new TextEncoder().encode(JSON.stringify(value));
  let finish!: () => void;
  const response = new Response(
    new ReadableStream({
      start(stream) {
        stream.enqueue(data.subarray(0, -1));
        finish = () => {
          stream.enqueue(data.subarray(-1));
          stream.close();
        };
      },
    }),
  );
  return { response, finish };
}
const browseable = {
  kind: "project-observation",
  workspaceId,
  epoch,
  status: "stopped",
};
for (const locale of ["en", "zh"] as const) {
  const zh = locale === "zh";
  const route = zh ? `task=${task}` : `chat=${chat}`;
  const deepLink = `?project=${hash}#${route}`;
  it(`${locale}: the actual ${zh ? "task" : "chat"} entry retires hung ${zh ? "body" : "headers"}, then recovers in place; opened App also reports an entry failure in its footer`, async () => {
    const page = entryView(deepLink, locale);
    expect(page.draw().summary).toContain(zh ? "正在连接…" : "Connecting…");
    const old = partialBody(gatewayEntry(false));
    if (zh) page.calls[0].resolve(old.response);
    await vi.advanceTimersByTimeAsync(10000);
    expect(page.draw().details).toContain("timeout");
    expect(page.calls[0].init?.signal?.aborted).toBe(true);
    expect(page.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5000);
    page.calls[1].resolve(Response.json(gatewayEntry()));
    observed();
    ready();
    if (zh) taskData();
    await flush();
    expect(page.draw().summary).toContain(zh ? "任务状态已更新" : "Chat ready");
    if (zh) old.finish();
    else page.calls[0].resolve(Response.json(gatewayEntry(false)));
    await flush();
    expect(page.draw().app?.project?.id).toBe(hash);
    expect(page.location.search + page.location.hash).toBe(deepLink);
    expect(page.move).not.toHaveBeenCalled();
    connectionAction();
    page.calls[2].resolve(
      Response.json(
        { kind: "error", error: publicError("unavailable") },
        { status: 503 },
      ),
    );
    await flush();
    const stale = page.draw();
    expect(stale.details).toContain(
      zh ? "工作台入口读取：" : "Workbench observation:",
    );
    expect(stale.summary).toContain(
      zh ? "仅有上次读取的状态" : "Last known state",
    );
    // Manual read replaces the scheduled retry; even a later completion from
    // a replaced attempt must not navigate or start another chain.
    connectionAction();
    connectionAction();
    expect(page.calls[3].init?.signal?.aborted).toBe(true);
    page.calls[4].resolve(Response.json(gatewayEntry()));
    page.calls[3].resolve(Response.json(gatewayEntry(false)));
    await vi.advanceTimersByTimeAsync(15000);
    expect(page.draw().summary).toContain(zh ? "任务状态已更新" : "Chat ready");
    expect(page.calls.map((c) => [c.url, c.init?.method ?? "GET"])).toEqual(
      Array(5).fill(["/workbench/v1", "GET"]),
    );
    expect(page.move).not.toHaveBeenCalled();
  });
  it(`${locale}: last-folder restoration retires hung ${zh ? "headers" : "body"} without claiming a missing directory, then retries without Open`, async () => {
    const page = entryView("", locale);
    page.draw();
    page.calls[0].resolve(Response.json(gatewayEntry()));
    await flush();
    const old = partialBody(browseable);
    if (!zh) page.calls[1].resolve(old.response);
    expect(page.draw().html).toContain(
      zh
        ? "正在返回上次的文件夹 /fixture"
        : "Returning to your last folder /fixture",
    );
    await vi.advanceTimersByTimeAsync(10000);
    const failed = page.draw();
    expect(failed.details).toContain(
      zh ? "项目观察：" : "Project observation:",
    );
    expect(failed.details).toContain("timeout");
    expect(failed.html).not.toContain(
      zh ? "此文件夹不可用" : "This folder is unavailable",
    );
    await vi.advanceTimersByTimeAsync(5000);
    page.calls[2].resolve(Response.json(gatewayEntry()));
    await flush();
    page.calls[3].resolve(Response.json(browseable));
    await flush();
    expect(page.draw().app?.project?.cwd).toBe("/fixture");
    if (!zh) old.finish();
    else page.calls[1].resolve(Response.json(browseable));
    await vi.advanceTimersByTimeAsync(15000);
    expect(page.move).toHaveBeenCalledExactlyOnceWith(
      null,
      "",
      `/app?project=${hash}`,
    );
    expect(page.calls.map((c) => c.url)).toEqual([
      "/workbench/v1",
      `/workbench/v1/projects/${hash}`,
      "/workbench/v1",
      `/workbench/v1/projects/${hash}`,
    ]);
    expect(page.calls.every((c) => !c.init?.method)).toBe(true);
  });
  it.each(["entry", "restore"])(
    `${locale}: an HTTP ${zh ? 403 : 401} at %s requests sign-in, not automatic retries or direct fallback`,
    async (stage) => {
      const page = entryView(stage === "entry" ? deepLink : "", locale);
      page.draw();
      if (stage === "restore") {
        page.calls[0].resolve(Response.json(gatewayEntry()));
        await flush();
      }
      page.calls
        .at(-1)
        ?.resolve(new Response("not a JSON reply", { status: zh ? 403 : 401 }));
      await vi.advanceTimersByTimeAsync(30000);
      const refused = page.draw();
      expect(refused.setup).toBeDefined();
      expect(refused.summary).toContain(
        zh ? "需要重新登录" : "Sign-in required",
      );
      expect(refused.details).toContain(
        zh ? ">重新登录</button>" : ">Sign in again</button>",
      );
      expect(refused.details).toContain(zh ? "forbidden" : "unauthenticated");
      expect(page.calls.length).toBe(stage === "entry" ? 1 : 2);
      expect(page.move).not.toHaveBeenCalled();
    },
  );
}

it.each(["draft", "picker", "epoch", "navigation", "hash", "unmount"])(
  "%s wins over a late last-project read",
  async (change) => {
    const page = entryView("");
    page.draw();
    page.calls[0].resolve(Response.json(gatewayEntry()));
    await flush();
    const setup = page.draw().setup;
    const old = page.calls[1];
    const late = partialBody(browseable);
    old.resolve(late.response);
    await flush();
    if (change === "draft")
      setup?.onDraftChange?.({ text: "keep my local draft", model: null });
    if (change === "picker") setup?.onChooseFolder();
    if (change === "epoch") {
      page.setActivityEpoch(id());
      await vi.advanceTimersByTimeAsync(3000);
    }
    if (change === "navigation") {
      page.location.search = `?project=${"b".repeat(64)}`;
      page.window.dispatchEvent(new Event("popstate"));
    }
    if (change === "hash") {
      page.location.hash = `#task=${task}`;
      page.window.dispatchEvent(new Event("hashchange"));
    }
    if (change === "unmount") {
      for (const cleanup of cleanups.values()) cleanup();
      cleanups.clear();
    }
    expect(old.init?.signal?.aborted).toBe(true);
    if (change === "epoch" || change === "navigation")
      page.calls[2].resolve(Response.json(gatewayEntry(false)));
    if (change === "hash") page.calls[2].resolve(Response.json(gatewayEntry()));
    late.finish();
    await flush();
    if (change !== "unmount") {
      const view = page.draw();
      expect(view.setup).toBeDefined();
      if (change === "draft")
        expect(view.html).toContain(">keep my local draft</textarea>");
      if (change === "picker") expect(view.html).toContain("Use this folder");
      if (change === "epoch" || change === "navigation")
        expect(view.html).toContain(
          "This folder is unavailable. Choose another folder",
        );
    }
    expect(page.move).not.toHaveBeenCalled();
    expect(page.calls.every((c) => !c.init?.method)).toBe(true);
  },
);
it("a draft written before a chat deep link has loaded stays in setup when both the replacement and retired entry GETs settle", async () => {
  const page = entryView(`?project=${hash}#chat=${chat}`);
  page.draw().setup?.onDraftChange?.({ text: "mine", model: null });
  expect(page.calls[0].init?.signal?.aborted).toBe(true);
  page.calls[1].resolve(Response.json(gatewayEntry()));
  page.calls[0].resolve(Response.json(gatewayEntry()));
  await flush();
  expect(page.draw().html).toContain(">mine</textarea>");
  expect(page.move).not.toHaveBeenCalled();
  expect(page.calls).toHaveLength(2);
});
it("only the recognized 400/invalid refusal selects the direct App; malformed error envelopes stay gateway faults", async () => {
  const page = entryView("");
  page.draw();
  page.calls[0].resolve(
    Response.json(
      { kind: "error", error: { code: "invalid" } },
      { status: 400 },
    ),
  );
  await flush();
  expect(page.draw().setup).toBeDefined();
  connectionAction();
  page.calls[1].resolve(
    Response.json(
      { kind: "error", error: publicError("invalid") },
      { status: 400 },
    ),
  );
  await flush();
  const direct = page.draw();
  expect(direct.app).toBeDefined();
  expect(direct.app?.project).toBeUndefined();
  expect(page.move).not.toHaveBeenCalled();
});

it.each(["selection", "preparation"])(
  "an older entry GET cannot erase a newer explicit %s result or replay its POST",
  async (change) => {
    const page = entryView(`?project=${hash}#chat=${chat}`);
    page.draw();
    const initial = gatewayEntry();
    page.calls[0].resolve(Response.json(initial));
    await flush();
    const app = page.draw().app;
    if (!app) throw new Error("expected a selected App");
    connectionAction();
    const old = page.calls[1];
    const next = { ...initial.projects[0], epoch: id() };
    if (change === "selection")
      Object.assign(next, {
        id: "b".repeat(64),
        cwd: "/other",
        path: "/other",
      });
    const explicit =
      change === "selection"
        ? app.onOpenProject?.(next.cwd)
        : app.onPrepareExecution?.("send", new AbortController().signal);
    page.calls[2].resolve(Response.json(initial));
    await flush();
    expect(page.calls[3].url).toBe(
      `/workbench/v1/${change === "selection" ? "select" : "prepare-send"}`,
    );
    page.calls[3].resolve(Response.json({ kind: "project", project: next }));
    await explicit;
    expect(old.init?.signal?.aborted).toBe(true);
    old.resolve(Response.json(gatewayEntry(false)));
    await vi.advanceTimersByTimeAsync(15000);
    expect(page.draw().app?.project).toEqual(next);
    expect(page.calls.filter((c) => c.init?.method === "POST")).toHaveLength(1);
    expect(page.move).toHaveBeenCalledTimes(change === "selection" ? 1 : 0);
  },
);
it("entry retries leave an explicit activity Open error visible without retrying the selection", async () => {
  const page = entryView(`?project=${hash}`);
  page.draw();
  page.calls[0].resolve(Response.json(gatewayEntry()));
  await flush();
  const app = page.draw().app;
  app?.discovery?.onOpen("/fixture", {
    id: id(),
    source: "turn",
    cwd: "/fixture",
    sessionId: chat,
    leaf: null,
    history: "shared",
    phase: "turn",
    freshness: "current",
    observedAt: 1,
    epoch,
    instance: null,
    executionCwd: null,
  });
  page.calls[1].resolve(Response.json(gatewayEntry()));
  await flush();
  expect(page.calls[2].url).toBe("/workbench/v1/select");
  page.calls[2].resolve(
    Response.json(
      { kind: "error", error: publicError("conflict") },
      { status: 409 },
    ),
  );
  await flush();
  expect(page.draw().top).toContain(
    "Another operation is still in progress (conflict)",
  );
  connectionAction();
  page.calls[3].resolve(
    Response.json(
      { kind: "error", error: publicError("unavailable") },
      { status: 503 },
    ),
  );
  await flush();
  const failed = page.draw();
  expect(failed.top).toContain(
    "Another operation is still in progress (conflict)",
  );
  expect(failed.details).toContain("Workbench observation: unavailable.");
  await vi.advanceTimersByTimeAsync(5000);
  page.calls[4].resolve(Response.json(gatewayEntry()));
  await flush();
  expect(page.draw().top).toContain(
    "Another operation is still in progress (conflict)",
  );
  expect(page.calls.filter((c) => c.init?.method === "POST")).toHaveLength(1);
  expect(page.move).not.toHaveBeenCalled();
});

it("an activity denial retires a simultaneous entry read; late 200, More refresh and epoch navigation cannot reopen the project", async () => {
  const page = entryView(`?project=${hash}#task=${task}`);
  page.draw();
  const entry = gatewayEntry();
  page.calls[0].resolve(Response.json(entry));
  await flush();
  const { app } = page.draw();
  if (!app?.projectAccess) throw new Error("missing selected project lifetime");
  app.entryObservation?.refresh();
  expect(page.calls).toHaveLength(2);
  page.forbidActivity();
  await vi.advanceTimersByTimeAsync(3000);
  expect(app.projectAccess.refusal).toEqual({
    source: "entry",
    code: "forbidden",
  });
  expect(page.calls[1].init?.signal?.aborted).toBe(true);
  page.calls[1].resolve(Response.json({ ...entry, epoch: id() }));
  page.window.dispatchEvent(new Event("popstate"));
  app.entryObservation?.refresh();
  connectionAction(); // even a stale refresh callback cannot reattach
  await vi.advanceTimersByTimeAsync(30000);
  const refused = page.draw();
  expect(refused.summary).toContain("Sign-in required");
  expect(refused.details).toContain("forbidden");
  expect(reads.observe.mock.lastCall?.[2]).toBe(false);
  expect(page.calls.map((c) => [c.url, c.init?.method ?? "GET"])).toEqual(
    Array(2).fill(["/workbench/v1", "GET"]),
  );
  expect(page.activityReads()).toBe(2);
  expect(prepare).not.toHaveBeenCalled();
});

// Both observation hooks, the App that owns their shared lifetime, and the
// HTTP/WS client run here; the clock, network and React commits are controlled.
async function connectedTaskViewer() {
  readProjectHeader = liveViewer = true;
  vi.useFakeTimers();
  const sockets: Socket[] = [];
  class Socket extends EventTarget {
    constructor() {
      super();
      sockets.push(this);
    }
    send = vi.fn();
    close = vi.fn();
    frame(value: unknown) {
      this.dispatchEvent(
        new MessageEvent("message", { data: JSON.stringify(value) }),
      );
    }
  }
  vi.stubGlobal("WebSocket", Socket);
  ready();
  taskData();
  const ctx = {
    status: "unavailable",
    workspaceId,
    taskId: task,
    error: publicError("unavailable"),
  };
  const snapshot = { ...viewer.observation?.snapshot, context: ctx };
  const running = () =>
    Response.json(
      { kind: "project-observation", status: "running", workspaceId, epoch },
      { headers: { [PROJECT_ASSOCIATION_HEADER]: "associated" } },
    );
  const ok = (value: unknown) => Response.json({ kind: "ok", value });
  let hold = false;
  const waiting = new Map<
    string,
    { signal?: AbortSignal | null; reply(response: Response): void }
  >();
  const calls: { path: string; method: string; attachment: string | null }[] =
    [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    const path =
      new URL(url, "http://127.0.0.1:43210").pathname.split("/").pop() ?? "";
    const attachment = new Headers(init?.headers).get("x-cadence-attachment");
    calls.push({ path, method: init?.method ?? "GET", attachment });
    if (hold && (path === hash || path === "snapshot"))
      return new Promise<Response>((reply) =>
        waiting.set(path, { reply, signal: init?.signal }),
      );
    if (path === hash) return Promise.resolve(running());
    if (path === "session" && attachment)
      return Promise.resolve(
        Response.json(
          {
            kind: "ok",
            value: {
              protocol: 1,
              storeId,
              epoch,
              accessGeneration: 1,
              authority: "browser",
              csrf: id(),
              capabilities: {
                actions: true,
                manualChecks: false,
                history: true,
              },
            },
          },
          { headers: { "x-cadence-attachment": attachment } },
        ),
      );
    if (path === "active-runs")
      return Promise.resolve(
        ok({ workspaceId, storeId, epoch, status: "complete", runs: [] }),
      );
    if (path === "workspace")
      return Promise.resolve(
        ok({ ...viewer.workspace, context: { ...ctx, taskId: null } }),
      );
    if (path === "snapshot") return Promise.resolve(ok(snapshot));
    if (path === "detach") return Promise.resolve(ok(null));
    throw new Error(`unexpected request: ${path}`);
  });
  const options = { project: true, task: true };
  render("en", options);
  await flush(); // project observation
  render("en", options);
  await flush(); // serialized viewer acquisition
  expect(sockets).toHaveLength(1);
  const socket = sockets[0];
  socket.dispatchEvent(new Event("open"));
  socket.frame({ kind: "snapshot", snapshot });
  expect(render("en", options).summary).toContain("Task up to date");
  return {
    options,
    snapshot,
    running,
    ok,
    calls,
    waiting,
    sockets,
    socket,
    hold: () => {
      hold = true;
    },
  };
}
it.each(["project", "viewer"])(
  "a %s refusal wins the race with the other chain's pending 200 and the old task subscription",
  async (source) => {
    const {
      options,
      snapshot,
      running,
      ok,
      calls,
      waiting,
      sockets,
      socket,
      hold,
    } = await connectedTaskViewer();
    const refresh = connectionAction;
    hold();
    refresh();
    render("en", options);
    await flush();
    expect([...waiting.keys()].sort()).toEqual([hash, "snapshot"].sort());
    socket.frame({ kind: "resync" });
    const project = waiting.get(hash),
      viewerRead = waiting.get("snapshot");
    const denied = source === "project" ? project : viewerRead;
    const late = source === "viewer" ? project : viewerRead;
    denied?.reply(
      Response.json(
        { kind: "error", error: publicError("forbidden") },
        { status: 403 },
      ),
    );
    await flush();
    expect(late?.signal?.aborted).toBe(true);
    expect(socket.close).toHaveBeenCalledOnce();
    late?.reply(source === "viewer" ? running() : ok(snapshot));
    socket.frame({ kind: "snapshot", snapshot });
    socket.dispatchEvent(new Event("close"));
    refresh();
    const refused = render("en", { ...options, selectedEpoch: id() });
    expect(refused.summary).toContain("Sign-in required");
    expect(refused.details).toContain("forbidden");
    await vi.advanceTimersByTimeAsync(2 * LIMITS.reconcileMs);
    expect(calls.filter((c) => c.path === hash)).toHaveLength(2);
    const sessions = calls.filter((c) => c.path === "session");
    expect(sessions).toHaveLength(2);
    expect(sessions[1].attachment).toBe(sessions[0].attachment);
    expect(calls.filter((c) => c.path === "snapshot")).toHaveLength(2);
    expect(calls.filter((c) => c.method !== "GET")).toEqual([
      { path: "detach", method: "POST", attachment: sessions[0].attachment },
    ]);
    expect(sockets).toHaveLength(1);
    expect(
      socket.send.mock.calls.map(([frame]) => JSON.parse(frame).kind),
    ).toEqual(["subscribe"]);
    expect(prepare).not.toHaveBeenCalled();
  },
);

it("a task viewer replaced between React commits cannot lend its new allocation to the previous workflow Stop button", async () => {
  workflow = activeWorkflow();
  const { socket, sockets, calls } = await connectedTaskViewer();
  const old = stopButtons.get("sidebar");
  expect(old?.disabled).toBe(false);
  socket.dispatchEvent(new Event("close"));
  // Let the real observer retire and replace its session at the same epoch,
  // with React still displaying the old button. No click prepared this viewer.
  await vi.advanceTimersByTimeAsync(1000);
  expect(sockets).toHaveLength(2);
  const sessions = calls.filter((c) => c.path === "session");
  expect(sessions).toHaveLength(2);
  expect(sessions[1].attachment).toBeTruthy();
  expect(sessions[1].attachment).not.toBe(sessions[0].attachment);
  old?.onClick();
  expect(calls.filter((c) => c.path === "command")).toEqual([]);
});

it("a completed readiness callback cannot finish preparation after access was denied", async () => {
  observed();
  ready();
  const access = new ObservationAccess();
  const options = { project: true, access };
  render("en", options);
  let finish!: () => void;
  reads.whenReady.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const waiting = chatProps.prepareForSend?.(new AbortController().signal);
  await Promise.resolve();
  expect(reads.reconnect).toHaveBeenCalledOnce();
  access.refuse("viewer", "unauthenticated");
  finish();
  await expect(waiting).rejects.toThrow("unauthenticated");
  expect(render("en", options).summary).toContain("Sign-in required");
  expect(chatProps.actionsReady).toBe(false);
  expect(chatProps.prepareForSend).toBeUndefined();
  expect(prepare).toHaveBeenCalledOnce();
});

function independentHistory() {
  readTaskHistory = liveViewer = true;
  vi.useFakeTimers();
  observed();
  execution.association = "unassociated";
  const access = new ObservationAccess();
  const options = { task: true, project: true, access };
  const workspaces: {
    reply: (r: Response) => void;
    signal?: AbortSignal | null;
  }[] = [];
  const paths: string[] = [];
  const socket = vi.fn();
  vi.stubGlobal("WebSocket", socket);
  const message = id(),
    resultCall = id();
  const ok = (value: unknown) => Response.json({ kind: "ok", value });
  const bootstrap = (seq: string, changed = {}) =>
    ok({
      workspaceId,
      storeId,
      epoch,
      rootLabel: "retained fixture",
      committedSeq: seq,
      models: [],
      context: {
        status: "unavailable",
        workspaceId,
        taskId: null,
        error: publicError("unavailable"),
      },
      activeRuns: { status: "complete", workspaceId, storeId, epoch, runs: [] },
      ...changed,
    });
  let refusePage = false;
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    const target = new URL(url);
    paths.push(`${init?.method} ${target.pathname}`);
    expect(new Headers(init?.headers).has("x-cadence-attachment")).toBe(false);
    expect(new Headers(init?.headers).has("x-cadence-csrf")).toBe(false);
    const route = target.pathname.split("/").at(-1);
    if (route === "workspace")
      return new Promise<Response>((reply) =>
        workspaces.push({ reply, signal: init?.signal }),
      );
    const req = JSON.parse(target.searchParams.get("request") ?? "null");
    if (route === "messages" && refusePage)
      return Promise.resolve(new Response("", { status: 401 }));
    expect(req).toMatchObject({
      storeId,
      snapshotSeq: "12",
      after: null,
      scope:
        route === "tasks"
          ? { kind: "workspace", id: workspaceId }
          : { kind: "task", id: task },
    });
    return Promise.resolve(
      ok({
        request: req,
        coverage,
        next: null,
        records:
          route === "tasks"
            ? [
                {
                  kind: "task",
                  version: 1,
                  owner: {
                    taskId: task,
                    runId: null,
                    childRunId: null,
                    entity: { kind: "task", id: task, version: 1 },
                  },
                  goal: "Independent retained task",
                  plan: null,
                },
              ]
            : route === "messages"
              ? [
                  {
                    kind: "message",
                    version: 1,
                    owner: {
                      taskId: task,
                      runId: id(),
                      childRunId: id(),
                      entity: { kind: "message", id: message, version: 1 },
                    },
                    role: "tool-result",
                    resultCallId: resultCall,
                    state: "final",
                    finalBlockCount: 0,
                    finalText: null,
                    source: { disposition: "unavailable", value: null },
                  },
                ]
              : [],
      }),
    );
  });
  return {
    options,
    access,
    bootstrap,
    workspaces,
    paths,
    socket,
    message,
    resultCall,
    refusePage: () => {
      refusePage = true;
    },
  };
}
it.each(["en", "zh"] as const)(
  "%s: #task reads a retained task and its message without a viewer, even after a hung bootstrap",
  async (locale) => {
    const f = independentHistory();
    render(locale, f.options);
    const late = partialBody({
      kind: "error",
      error: publicError("forbidden"),
    });
    f.workspaces[0].reply(late.response);
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.workspaces[0].signal?.aborted).toBe(true);
    const failed = render(locale, f.options);
    expect(failed.details).toContain("timeout");
    expect(failed.html).toContain(
      locale === "en" ? "Recorded history unavailable:" : "无法读取历史记录：",
    );
    await vi.advanceTimersByTimeAsync(5000);
    f.workspaces[1].reply(f.bootstrap("12"));
    late.finish();
    await flush();
    render(locale, f.options);
    await flush();
    const view = render(locale, f.options);
    expect(view.summary).toContain(
      locale === "en" ? "Browsing only" : "仅浏览",
    );
    expect(view.html).toContain("Independent retained task");
    expect(view.html).toContain(`data-msg-id="${f.message}"`);
    expect(view.html).toContain(f.resultCall);
    expect(sidebar.workspace).toBeUndefined();
    expect(sidebar.activeRuns).toBeUndefined();
    expect(sidebar.canCancel).toBe(false);
    expect(sidebar.actionsUnavailable).toBeTruthy();
    expect(f.paths.sort()).toEqual(
      ["messages", "runs", "tasks", "workspace", "workspace"].map(
        (route) => `GET /projects/${hash}/api/v1/${route}`,
      ),
    );
    expect(f.socket).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  },
);
it("an incomplete or mismatched history identity cannot open pages; an authenticated replacement can, but a page's refusal retires the entire read", async () => {
  const f = independentHistory();
  if (!execution.value) throw Error("missing fixture");
  execution.value.workspaceId = null;
  expect(render("en", f.options).details).toContain(
    "History identity not confirmed",
  );
  expect(f.paths).toEqual([]);
  execution.value.workspaceId = workspaceId;
  render("en", f.options);
  f.workspaces[0].reply(
    f.bootstrap("999", { epoch: id(), activeRuns: undefined }),
  );
  await flush();
  expect(render("en", f.options).details).toContain(
    "History workspace does not match the selected owner",
  );
  expect(sidebar.retained).toBeUndefined();
  connectionAction();
  render("en", f.options);
  f.workspaces[1].reply(f.bootstrap("12"));
  await flush();
  f.refusePage();
  render("en", f.options);
  await flush();
  expect(render("en", f.options).summary).toContain("Sign-in required");
  expect(f.access.refusal?.code).toBe("unauthenticated");
  await vi.advanceTimersByTimeAsync(30000);
  expect(f.workspaces).toHaveLength(2);
  expect(f.socket).not.toHaveBeenCalled();
  expect(prepare).not.toHaveBeenCalled();
});
it.each(["task", "owner", "project", "association", "access", "unmount"])(
  "%s retires a delayed independent history read before it can publish or refuse access",
  async (change) => {
    const f = independentHistory();
    render("en", f.options);
    if (change === "owner" && execution.value) execution.value.epoch = id();
    if (change === "project")
      Object.assign(f.options, { projectId: "b".repeat(64) });
    if (change === "task") {
      vi.stubGlobal("location", window.location);
      vi.stubGlobal("history", { replaceState: vi.fn() });
      sidebar.onTask(id());
    }
    if (change === "access") f.access.refuse("entry", "forbidden");
    if (change === "association") execution.association = "unknown";
    if (change === "unmount") {
      for (const cleanup of cleanups.values()) cleanup();
      cleanups.clear();
    } else render("en", f.options);
    expect(f.workspaces[0].signal?.aborted).toBe(true);
    f.workspaces[0].reply(new Response("", { status: 401 }));
    await flush();
    expect(f.access.refusal?.code).toBe(
      change === "access" ? "forbidden" : undefined,
    );
    expect(f.paths.every((path) => path.endsWith("/workspace"))).toBe(true);
    expect(f.socket).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  },
);
