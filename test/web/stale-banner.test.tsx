// Render the real App banner with a controlled observation result. HTTP/current
// semantics and the built retained conversation have separate integration tests.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { ProjectObservation } from "../../src/service/contracts/gateway.ts";
import type { WorkspaceBootstrap } from "../../src/service-contract.ts";
import { App } from "../../web/src/App";
import { WorkspaceNotice } from "../../web/src/components/workspace/WorkspaceNotice";
import { LocaleProvider } from "../../web/src/i18n/locale";
import { context, id } from "./fixtures";

const viewer = vi.hoisted(() => ({
  actions: false,
  transportStatus: "current" as "current" | "stale" | "closed",
  workspace: undefined as WorkspaceBootstrap | undefined,
  attachmentVersion: 1,
  compatible: true as boolean | undefined,
  error: undefined as string | undefined,
  refresh: () => {},
}));
const execution = vi.hoisted(() => ({
  value: undefined as ProjectObservation | undefined,
  error: undefined as string | undefined,
  fresh: true,
}));
// Retain only ref slots for the transition test. This is controlled SSR,
// not a claim of real React mounting or browser lifecycle validation.
const retainedRefs = vi.hoisted(() => ({
  enabled: false,
  index: 0,
  slots: [] as { current: unknown }[],
}));
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  return {
    ...actual,
    useRef: (initial: unknown) => {
      const ref = actual.useRef(initial);
      if (!retainedRefs.enabled) return ref;
      const index = retainedRefs.index++;
      retainedRefs.slots[index] ??= ref;
      return retainedRefs.slots[index];
    },
  };
});
vi.mock("../../web/src/client/use-project-observation", async (original) => {
  const actual =
    await original<
      typeof import("../../web/src/client/use-project-observation")
    >();
  return {
    ...actual,
    useProjectObservation: () => ({
      ...execution,
      readiness: actual.projectReadiness(
        execution.value,
        execution.error,
        execution.fresh,
      ),
      refresh() {},
      prepared() {},
    }),
  };
});
vi.mock("../../web/src/client/use-workspace", () => ({
  useWorkspace: () => viewer,
}));
afterEach(() => {
  vi.unstubAllGlobals();
  viewer.compatible = true;
  viewer.error = undefined;
  viewer.workspace = undefined;
  viewer.transportStatus = "current";
  viewer.attachmentVersion = 1;
  execution.value = undefined;
  execution.error = undefined;
  execution.fresh = true;
  retainedRefs.enabled = false;
  retainedRefs.index = 0;
  retainedRefs.slots = [];
});
function render(
  locale: "en" | "zh",
  project = false,
  buildCompatible = true,
  service = false,
) {
  retainedRefs.index = 0;
  vi.stubGlobal("window", { location: new URL("http://127.0.0.1:43210/app") });
  return renderToStaticMarkup(
    <LocaleProvider initial={locale}>
      <App
        buildCompatible={buildCompatible}
        onOpenService={service ? () => {} : undefined}
        project={
          project
            ? {
                id: "a".repeat(64),
                path: "/fixture",
                cwd: "/fixture",
                epoch: id(),
              }
            : undefined
        }
      />
    </LocaleProvider>,
  );
}
it.each(["en", "zh"] as const)(
  "%s: the conversation folder stays in the lower-right statusbar, not beneath the heading",
  (locale) => {
    execution.value = {
      kind: "project-observation",
      status: "not-started",
      epoch: null,
      workspaceId: null,
    };
    const html = render(locale, true);
    const conversation = html.match(
      /<section class="chat-workspace"[\s\S]*?<\/section>/,
    )?.[0];
    expect(conversation).toBeDefined();
    expect(html).not.toMatch(/Workbench projects|工作台项目|workbench-entry/);
    expect(html.match(/class="status-cwd"/g)).toHaveLength(1);
    expect(conversation).toContain('class="conversation-header"');
    expect(conversation).not.toContain("conversation-cwd");
    expect(conversation).not.toContain(
      locale === "zh" ? "会话目录：" : "Conversation folder:",
    );
    expect(conversation).not.toContain("/fixture");
    const statusbar = html.slice(html.indexOf('<footer class="statusbar">'));
    expect(statusbar).toMatch(
      /class="statusbar-right".*class="status-cwd" title="\/fixture"/,
    );
    // The chip shows the folder's own name; its title keeps the whole path.
    expect(statusbar).toContain("<span>fixture</span>");
    expect(statusbar).toContain(
      locale === "zh"
        ? 'aria-label="切换工作文件夹"'
        : 'aria-label="Switch working folder"',
    );
  },
);
it.each(["en", "zh"] as const)(
  "%s: generic stale asks for fresh observation/confirmation, not a source diagnosis or service command",
  (locale) => {
    viewer.error = "stale";
    const html = render(locale);
    expect(html).toContain('role="status"');
    expect(html).toContain(
      locale === "zh"
        ? "上下文已变化，请先读取当前状态，再确认计划。"
        : "Context changed. Read the current state before confirming a plan.",
    );
    expect(html).not.toMatch(
      /models\.json|systemctl|cadence-service|restart|重启/,
    );
    expect(html).toContain(
      locale === "zh" ? "兼容" : "Shared compatibility: compatible",
    );
  },
);
it.each(["en", "zh"] as const)(
  "%s: a local failure never hides a stale observation or suggests starting the service",
  (locale) => {
    const html = renderToStaticMarkup(
      <LocaleProvider initial={locale}>
        <WorkspaceNotice
          error="Link copy unavailable."
          observationError="stale"
        />
      </LocaleProvider>,
    );
    expect(html).toContain("Link copy unavailable.");
    expect(html).toContain("stale");
    expect(html).toContain(
      locale === "zh"
        ? "上下文已变化，请先读取当前状态，再确认计划。"
        : "Context changed. Read the current state before confirming a plan.",
    );
    expect(html).not.toMatch(
      /models\.json|systemctl|cadence-service|restart|重启/,
    );
  },
);
it("local failures stay separate; readonly failure never suggests starting or restarting a service", () => {
  const renderNotice = (error?: string, observationError?: string) =>
    renderToStaticMarkup(
      <LocaleProvider initial="en">
        <WorkspaceNotice error={error} observationError={observationError} />
      </LocaleProvider>,
    );
  expect(renderNotice()).toBe("");
  const local = renderNotice("Preflight refused: stale");
  expect(local).toContain("Preflight refused: stale");
  expect(local).not.toContain("cadence-service");
  const unavailable = renderNotice(undefined, "unavailable");
  expect(unavailable).toContain("Latest state unavailable.");
  expect(unavailable).not.toMatch(/cadence-service|Retained history is shown/);
});
it("a real compatibility failure remains distinct from stale and is never declared compatible by the error banner", () => {
  viewer.compatible = false;
  viewer.error = "stale";
  const html = render("en");
  expect(html).toContain("Context changed. Read the current state");
  expect(html).toContain(
    "unavailable / mismatch — reload built assets; normal actions disabled",
  );
  expect(html).not.toContain("Shared compatibility: compatible");
});
it("an incompatible browser build is not presented as prepare-on-send", () => {
  const html = render("zh", true, false, true);
  expect(html).toContain("不可用 / 不匹配——请重新加载构建产物；常规操作已禁用");
  expect(html).not.toContain("重命名和归档需要执行服务；将在下次发送时启动。");
  expect(html).not.toContain('aria-label="Cadence 服务"');
  expect(render("zh", true, true, true)).toContain('aria-label="Cadence 服务"');
});

it.each([
  "unknown",
  "unavailable",
  "old-running",
  "old-stopped",
  "viewer-stale",
])(
  "%s never presents a retained observation as current/ready or infers stopped",
  (state) => {
    const workspace: WorkspaceBootstrap = {
      workspaceId: id(),
      storeId: id(),
      epoch: id(),
      committedSeq: "1",
      rootLabel: "fixture",
      context: { status: "available", version: context() },
      models: [],
    };
    viewer.workspace = workspace;
    if (state !== "unknown")
      execution.value = {
        kind: "project-observation",
        status:
          state === "unavailable"
            ? "unavailable"
            : state === "old-stopped"
              ? "stopped"
              : "running",
        epoch: workspace.epoch,
        workspaceId: workspace.workspaceId,
      };
    if (state.startsWith("old-")) execution.error = "unavailable";
    if (state === "viewer-stale") viewer.error = "stale";
    const html = render("en", true);
    const statusbar = html.slice(html.indexOf('<footer class="statusbar">'));
    expect(html).toContain(
      "Started work may still be running. No message is resent.",
    );
    expect(statusbar).not.toContain("Chat ready");
    expect(statusbar).not.toContain(">current<");
    expect(statusbar).not.toContain("Ready to prepare on Send");
    expect(html).not.toContain("Execution will be prepared when you send.");
    expect(html).not.toContain("status-dot ok");
  },
);
for (const locale of ["en", "zh"] as const) {
  it.each(["stopped", "not-started"] as const)(
    `${locale}: %s offers preparation in the statusbar without a global notice`,
    (status) => {
      execution.value = {
        kind: "project-observation",
        status,
        epoch: null,
        workspaceId: status === "stopped" ? id() : null,
      };
      const html = render(locale, true);
      const statusbar = html.slice(html.indexOf('<footer class="statusbar">'));
      expect(html).not.toContain('class="workspace-notice"');
      expect(html).not.toContain("Execution will be prepared when you send.");
      expect(html).not.toContain("浏览不会启动服务");
      expect(statusbar).toContain(
        locale === "zh" ? "发送时按需准备" : "Ready to prepare on Send",
      );
      expect(statusbar).not.toContain("status-dot error");
      expect(statusbar).not.toContain("status-dot ok");
      expect(html).toContain(locale === "zh" ? "选择模型" : "Choose a model");
      expect(html).not.toContain(
        locale === "zh" ? "模型目录读取失败" : "Model list unavailable",
      );
    },
  );
  it.each([
    "direct",
    "project-pending",
    "project-running",
    "session-acquired",
    "workspace-pending",
  ])(
    `${locale}: %s first connection stays quiet without claiming readiness`,
    (phase) => {
      viewer.transportStatus =
        phase === "workspace-pending" ? "current" : "closed";
      viewer.attachmentVersion = [
        "session-acquired",
        "workspace-pending",
      ].includes(phase)
        ? 1
        : 0;
      viewer.compatible = viewer.attachmentVersion ? true : undefined;
      if (!["direct", "project-pending"].includes(phase))
        execution.value = {
          kind: "project-observation",
          status: "running",
          epoch: id(),
          workspaceId: id(),
        };
      const html = render(locale, phase !== "direct");
      const statusbar = html.slice(html.indexOf('<footer class="statusbar">'));
      expect(html).not.toContain('class="workspace-notice"');
      expect(statusbar).toContain(
        locale === "zh" ? "正在连接…" : "Connecting…",
      );
      expect(statusbar).toContain("status-dot busy");
      expect(statusbar).not.toMatch(
        /status-dot (ok|error)|Chat ready|>current<|聊天已就绪/,
      );
      expect(statusbar).not.toContain("Active roster unavailable");
      expect(statusbar).not.toContain("活动运行列表不可用");
    },
  );
  it.each([
    "project-error",
    "project-unavailable",
    "project-stale",
    "viewer-error",
    "transport-stale",
    "incompatible",
  ])(`${locale}: %s during the first connection remains visible`, (failure) => {
    viewer.transportStatus = "closed";
    viewer.attachmentVersion = 0;
    viewer.compatible = undefined;
    if (failure === "project-error") execution.error = "unavailable";
    if (failure === "project-unavailable")
      execution.value = {
        kind: "project-observation",
        status: "unavailable",
        epoch: null,
        workspaceId: null,
      };
    if (failure === "project-stale") {
      execution.value = {
        kind: "project-observation",
        status: "running",
        epoch: id(),
        workspaceId: id(),
      };
      execution.fresh = false;
    }
    if (failure === "viewer-error") viewer.error = "unavailable";
    if (failure === "transport-stale") viewer.transportStatus = "stale";
    if (failure === "incompatible") viewer.compatible = false;
    const html = render(locale, true);
    const statusbar = html.slice(html.indexOf('<footer class="statusbar">'));
    expect(html).toContain('class="workspace-notice"');
    expect(html).toContain(
      locale === "zh"
        ? "已开始的工作可能仍在运行"
        : "Started work may still be running",
    );
    expect(statusbar).not.toContain(
      locale === "zh" ? "正在连接…" : "Connecting…",
    );
    expect(statusbar).toContain("status-dot error");
  });
}
it.each(["data", "failure"])(
  "%s followed by an empty reconnect is not a new quiet first load",
  (first) => {
    retainedRefs.enabled = true;
    const epoch = id();
    execution.value = {
      kind: "project-observation",
      status: "running",
      epoch,
      workspaceId: id(),
    };
    if (first === "data")
      viewer.workspace = {
        workspaceId: id(),
        storeId: id(),
        epoch,
        committedSeq: "1",
        rootLabel: "fixture",
        context: { status: "available", version: context() },
        models: [],
      };
    else viewer.error = "unavailable";
    render("en", true);
    viewer.workspace = undefined;
    viewer.error = undefined;
    viewer.compatible = undefined;
    viewer.transportStatus = "closed";
    viewer.attachmentVersion = 0;
    const html = render("en", true);
    expect(html).toContain("Started work may still be running");
    expect(html).not.toContain("Connecting…");
  },
);
it("local, project-read and viewer errors remain visible together", () => {
  const html = renderToStaticMarkup(
    <WorkspaceNotice
      error="Link copy unavailable."
      projectObservationError="unavailable"
      observationError="stale"
    />,
  );
  expect(html).toContain("Link copy unavailable.");
  expect(html).toContain("Project observation: unavailable.");
  expect(html).toContain("Context changed. Read the current state");
  expect(html).not.toContain("cadence-service");
});

it("one observation warning covers the same stale condition, keeps independent errors and offers a readonly action", () => {
  viewer.error = "stale";
  viewer.transportStatus = "stale";
  const html = render("en");
  expect(html.match(/class="workspace-notice"/g)).toHaveLength(1);
  expect(html).toContain("Observe current state");
  expect(html).toContain("Conversation history could not be read");
  expect(html).not.toContain("Retained history is shown");
  const statusbar = html.slice(html.indexOf('<footer class="statusbar">'));
  expect(statusbar).not.toContain(" · stale");
});
