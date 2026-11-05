// Render the real App banner with a controlled observation result. HTTP/current
// semantics and the built retained conversation have separate integration tests.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { ProjectObservation } from "../../src/service/contracts/gateway.ts";
import type { WorkspaceBootstrap } from "../../src/service-contract.ts";
import { App, WorkspaceNotice } from "../../web/src/App";
import { LocaleProvider } from "../../web/src/i18n/locale";
import { context, id } from "./fixtures";

const viewer = vi.hoisted(() => ({
  actions: false,
  transportStatus: "current" as "current" | "stale" | "closed",
  workspace: undefined as WorkspaceBootstrap | undefined,
  attachmentVersion: 1,
  compatible: true,
  error: undefined as string | undefined,
  refresh: () => {},
}));
const execution = vi.hoisted(() => ({
  value: undefined as ProjectObservation | undefined,
  error: undefined as string | undefined,
}));
vi.mock("../../web/src/client/use-project-observation", async (original) => {
  const actual =
    await original<
      typeof import("../../web/src/client/use-project-observation")
    >();
  return {
    ...actual,
    useProjectObservation: () => ({
      ...execution,
      readiness: actual.projectReadiness(execution.value, execution.error),
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
  execution.value = undefined;
  execution.error = undefined;
});
function render(locale: "en" | "zh", project = false) {
  vi.stubGlobal("window", { location: new URL("http://127.0.0.1:43210/app") });
  return renderToStaticMarkup(
    <LocaleProvider initial={locale}>
      <App
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
  "%s: generic stale asks for fresh observation/confirmation, not a source diagnosis or service command",
  (locale) => {
    viewer.error = "stale";
    const html = render(locale);
    expect(html).toContain('role="alert"');
    expect(html).toContain(
      locale === "zh"
        ? "上下文已变化。请重新观察并请求新的确认。"
        : "Context changed. Observe again and request a fresh confirmation.",
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
    expect(html).toContain(locale === "zh" ? "已过期" : "stale");
    expect(html).toContain(
      locale === "zh"
        ? "上下文已变化。请重新观察并请求新的确认。"
        : "Context changed. Observe again and request a fresh confirmation.",
    );
    expect(html).not.toMatch(
      /models\.json|systemctl|cadence-service|restart|重启/,
    );
  },
);
it("local failures alone are not service-start instructions, but service unavailability keeps its guidance", () => {
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
  expect(renderNotice(undefined, "unavailable")).toContain(
    "cadence-service status",
  );
});
it("a real compatibility failure remains distinct from stale and is never declared compatible by the error banner", () => {
  viewer.compatible = false;
  viewer.error = "stale";
  const html = render("en");
  expect(html).toContain("Context changed. Observe again");
  expect(html).toContain(
    "unavailable / mismatch — reload built assets; normal actions disabled",
  );
  expect(html).not.toContain("Shared compatibility: compatible");
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
      "Retained history is shown; this does not mean work has stopped.",
    );
    expect(statusbar).not.toContain("Chat ready");
    expect(statusbar).not.toContain(">current<");
    expect(statusbar).not.toContain("Ready to prepare on Send");
    expect(html).not.toContain("Execution will be prepared when you send.");
    expect(html).not.toContain("status-dot ok");
  },
);
it("only a positive stopped observation offers preparation, separately from work settlement", () => {
  execution.value = {
    kind: "project-observation",
    status: "stopped",
    epoch: null,
    workspaceId: id(),
  };
  const html = render("en", true);
  expect(html).toContain(
    "Execution will be prepared when you send. Browsing does not start it.",
  );
  expect(html).toContain("Ready to prepare on Send");
});
it("local, project-read and viewer errors remain visible together", () => {
  const html = renderToStaticMarkup(
    <WorkspaceNotice
      error="Link copy unavailable."
      projectObservationError="unavailable"
      observationError="stale"
      onDemand
    />,
  );
  expect(html).toContain("Link copy unavailable.");
  expect(html).toContain("Project observation: unavailable.");
  expect(html).toContain("Context changed. Observe again");
  expect(html).not.toContain("cadence-service");
});
