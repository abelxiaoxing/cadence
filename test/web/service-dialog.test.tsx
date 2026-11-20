// The service dialog's static presentation; the restart itself is covered by
// test/service-maintenance-systemd.test.ts against a real systemd manager.
import { Children, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import {
  canUpgrade,
  type MaintenanceJob,
  type ServiceEntry,
  UPGRADE_ROUTES,
} from "../../src/service/contracts/gateway.ts";
import {
  maintenanceOutcome,
  maintenanceWaitMs,
  observeMaintenance,
  unchanged,
} from "../../web/src/client/maintenance-observation";
import { ActionDialog } from "../../web/src/components/actions/ActionDialog";
import { FolderSetup } from "../../web/src/components/workspace/FolderSetup";
import {
  describeJob,
  installationMessage,
  ServiceDialog,
  UpgradeOffer,
} from "../../web/src/components/workspace/ServiceDialog";
import {
  type Locale,
  LocaleProvider,
  type Translator,
  translate,
} from "../../web/src/i18n/locale";

const job = (patch: Partial<MaintenanceJob>): MaintenanceJob => ({
  id: "11111111-1111-4111-8111-111111111111",
  action: "upgrade",
  from: "2.0.28",
  to: "2.0.29",
  state: "ready",
  reason: null,
  version: "2.0.29",
  at: 1,
  endedAt: 2,
  ...patch,
});
it("names every recorded outcome, including a rollback and why a job failed", () => {
  const words =
    (locale: Locale): Translator["t"] =>
    (key, vars) =>
      translate(locale, key, vars);
  const en = words("en"),
    zh = words("zh");
  expect(describeJob(en, job({ action: "restart", to: null }))).toBe(
    "Cadence restarted.",
  );
  expect(describeJob(en, job({}))).toBe("Cadence 2.0.29 is running.");
  expect(describeJob(en, job({ version: "2.0.28" }))).toBe(
    "Cadence 2.0.28 was already installed.",
  );
  expect(
    describeJob(
      en,
      job({ state: "rolled-back", reason: "not-ready", version: "2.0.28" }),
    ),
  ).toBe("Cadence 2.0.29 did not become ready; 2.0.28 was reinstalled.");
  expect(
    describeJob(en, job({ state: "failed", reason: "fetch-failed" })),
  ).toBe(
    "The upgrade did not finish: The release could not be downloaded; the service kept running.",
  );
  expect(
    describeJob(
      zh,
      job({
        action: "restart",
        to: null,
        state: "failed",
        reason: "interrupted",
      }),
    ),
  ).toBe("重启未完成：任务在报告结果前结束。");
});
it("only a job that stopped nothing keeps the page connected", () => {
  expect(unchanged(job({ state: "failed", reason: "fetch-failed" }))).toBe(
    true,
  );
  expect(unchanged(job({ state: "failed", reason: "refused" }))).toBe(true);
  expect(unchanged(job({ version: "2.0.28" }))).toBe(true);
  expect(unchanged(job({}))).toBe(false);
  expect(unchanged(job({ state: "failed", reason: "not-ready" }))).toBe(false);
  expect(unchanged(job({ state: "rolled-back", reason: "not-ready" }))).toBe(
    false,
  );
  expect(
    unchanged(job({ action: "restart", to: null, version: "2.0.28" })),
  ).toBe(false);
});
it.each([0, 3])(
  "the displayed target is the final upgrade action (%i running)",
  (work) => {
    const onUpgrade = vi.fn();
    const t: Translator["t"] = (key, vars) => translate("zh", key, vars);
    const props = {
      version: "2.0.29",
      work: Array.from({ length: work }, (_, index) => ({
        project: `/projects/project-${index}`,
        source: index === 0 ? ("workflow" as const) : ("turn" as const),
        id: `work-${index}`,
        sessionId: index === 0 ? "sample-conversation" : null,
      })),
      sending: false,
      onUpgrade,
      t,
    };
    const offer = UpgradeOffer(props);
    const html = renderToStaticMarkup(offer);
    expect(html).toContain(
      work ? "停止运行中的工作并升级到 2.0.29" : "升级到 2.0.29",
    );
    expect(html.includes("3 个正在运行的工作流或会话将被停止")).toBe(!!work);
    if (work) {
      expect(html).toContain("/projects/project-0");
      expect(html).toContain("work-2");
      expect(html).toContain("sample-conversation");
    }
    expect(html).toContain("升级成功后页面会自动刷新");
    const actions = Children.toArray(offer.props.children).filter(
      (item): item is ReactElement<{ onClick(): void }> =>
        isValidElement(item) && item.type === "button",
    );
    expect(actions).toHaveLength(1);
    expect(onUpgrade).not.toHaveBeenCalled();
    actions[0].props.onClick();
    expect(onUpgrade).toHaveBeenCalledExactlyOnceWith("2.0.29");
    expect(renderToStaticMarkup(<UpgradeOffer {...props} sending />)).toContain(
      'disabled=""',
    );
  },
);
it("reloads only for the submitted upgrade once its target is ready and serving", () => {
  const submitted = job({ state: "running", version: null, endedAt: null });
  const current: ServiceEntry = {
    kind: "service",
    work: null,
    unit: null,
    upgrade: "npm",
    version: "2.0.29",
    job: job({}),
  };
  expect(maintenanceOutcome(submitted, current)).toBe("reload");
  expect(
    maintenanceOutcome(submitted, { ...current, version: "2.0.28" }),
  ).toBeUndefined();
  for (const mismatch of [job({ to: "2.0.30" }), job({ version: "2.0.30" })])
    expect(maintenanceOutcome(submitted, { ...current, job: mismatch })).toBe(
      "changed",
    );
  for (const other of [null, submitted, job({ id: "other" })])
    expect(
      maintenanceOutcome(submitted, { ...current, job: other }),
    ).toBeUndefined();
  for (const settled of [
    job({ state: "rolled-back" }),
    job({ state: "failed" }),
    job({ version: submitted.from }),
  ])
    expect(maintenanceOutcome(submitted, { ...current, job: settled })).toBe(
      settled,
    );
  const restart = job({ action: "restart", to: null });
  expect(maintenanceOutcome(restart, { ...current, job: restart })).toBe(
    restart,
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("keeps observing through a proxy error and a version handoff, then reconnects just once without another command", async () => {
  vi.useFakeTimers();
  const submitted = job({ state: "running", version: null, endedAt: null });
  const status = { kind: "service", job: job({}), version: submitted.to };
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response("Bad Gateway", { status: 502 }))
    .mockResolvedValueOnce(new Response("<html>Starting…</html>"))
    .mockResolvedValueOnce(Response.json({ ...status, job: submitted }))
    .mockResolvedValueOnce(
      Response.json({ ...status, version: submitted.from }),
    )
    // The next release's work/installation fields need not be readable to
    // observe our own job, but could never be used as action confirmation.
    .mockResolvedValueOnce(
      Response.json({ ...status, upgrade: "another-manager" }),
    );
  vi.stubGlobal("fetch", fetch);
  const waiting = vi.fn(),
    result = vi.fn();
  observeMaintenance(submitted, waiting, result);
  await vi.advanceTimersByTimeAsync(4000);
  expect(waiting).toHaveBeenCalledTimes(2);
  expect(result).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(maintenanceWaitMs.upgrade);
  expect(result).toHaveBeenCalledExactlyOnceWith("reload");
  expect(fetch).toHaveBeenCalledTimes(5);
  for (const [path, init] of fetch.mock.calls) {
    expect(path).toBe("/workbench/v1/service");
    expect(init?.method ?? "GET").toBe("GET");
  }
});

it.each([401, 403])(
  "an access refusal (%i) stops polling without reloading",
  async (status) => {
    vi.useFakeTimers();
    const result = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status })),
    );
    observeMaintenance(job({}), vi.fn(), result);
    await vi.advanceTimersByTimeAsync(maintenanceWaitMs.upgrade);
    expect(result).toHaveBeenCalledExactlyOnceWith("access-denied");
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

it.each([true, false])(
  "a late matching result after departure or timeout cannot reload (leave=%s)",
  async (leave) => {
    vi.useFakeTimers();
    let reply!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      () =>
        new Promise<Response>((resolve) => {
          reply = resolve;
        }),
    );
    const result = vi.fn();
    const stop = observeMaintenance(job({}), vi.fn(), result);
    await vi.advanceTimersByTimeAsync(1000);
    if (leave) stop();
    await vi.advanceTimersByTimeAsync(maintenanceWaitMs.upgrade);
    reply(Response.json({ kind: "service", version: "2.0.29", job: job({}) }));
    await vi.advanceTimersByTimeAsync(1000);
    if (leave) expect(result).not.toHaveBeenCalled();
    else expect(result).toHaveBeenCalledExactlyOnceWith("timeout");
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("a dialog without a close handler offers no dismissal while a restart runs", () => {
  const closable = renderToStaticMarkup(
    <ActionDialog title="Cadence service" onClose={() => {}}>
      body
    </ActionDialog>,
  );
  const pinned = renderToStaticMarkup(
    <ActionDialog title="Cadence service">body</ActionDialog>,
  );
  expect(closable).toContain("dialog-close");
  expect(pinned).not.toContain("dialog-close");
});
it("the entry offers the service dialog only when the workbench supplies it, and the dialog starts by reading", () => {
  const home = (onOpenService?: () => void) =>
    renderToStaticMarkup(
      <LocaleProvider>
        <FolderSetup
          ready
          onChooseFolder={() => {}}
          onRefresh={() => {}}
          onOpenService={onOpenService}
        />
      </LocaleProvider>,
    );
  expect(home(() => {})).toContain('aria-label="Cadence service"');
  expect(home()).not.toContain('aria-label="Cadence service"');
  const dialog = renderToStaticMarkup(
    <LocaleProvider>
      <ServiceDialog epoch="e" csrf="c" onClose={() => {}} />
    </LocaleProvider>,
  );
  expect(dialog).toContain("Reading the service…");
  expect(dialog).toMatch(/<button type="button" disabled="">.*Restart service/);
});

it("describes every installation route in both languages and enables all supported managers", () => {
  for (const locale of ["en", "zh"] as const) {
    const t: Translator["t"] = (key, vars) => translate(locale, key, vars);
    for (const route of UPGRADE_ROUTES) {
      const message = installationMessage(t, route);
      expect(message.length).toBeGreaterThan(10);
      if (locale === "zh") expect(message).toMatch(/[\u4e00-\u9fff]/);
      expect(canUpgrade(route)).toBe(
        ["npm", "bun", "pi-npm", "pi-bun", "npm-local", "bun-local"].includes(
          route,
        ),
      );
    }
    expect(installationMessage(t, "pi-bun")).toContain("Pi");
    expect(installationMessage(t, "pi-bun")).toContain("Bun");
  }
});
