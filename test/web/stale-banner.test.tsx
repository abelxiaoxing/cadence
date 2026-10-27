// Render the real App banner with a controlled observation result. HTTP/current
// semantics and the built retained conversation have separate integration tests.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { App, WorkspaceNotice } from "../../web/src/App";
import { LocaleProvider } from "../../web/src/i18n/locale";

const viewer = vi.hoisted(() => ({
  actions: false,
  transportStatus: "current" as const,
  attachmentVersion: 1,
  compatible: true,
  error: undefined as string | undefined,
  refresh: () => {},
}));
vi.mock("../../web/src/client/use-workspace", () => ({
  useWorkspace: () => viewer,
}));
afterEach(() => {
  vi.unstubAllGlobals();
  viewer.compatible = true;
  viewer.error = undefined;
});
function render(locale: "en" | "zh") {
  vi.stubGlobal("window", { location: new URL("http://127.0.0.1:43210/app") });
  return renderToStaticMarkup(
    <LocaleProvider initial={locale}>
      <App />
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
