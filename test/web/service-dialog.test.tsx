// The service dialog's static presentation; the restart itself is covered by
// test/service-maintenance-systemd.test.ts against a real systemd manager.
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { MaintenanceJob } from "../../src/service/contracts/gateway.ts";
import { ActionDialog } from "../../web/src/components/actions/ActionDialog";
import {
  describeJob,
  ServiceDialog,
  unchanged,
} from "../../web/src/components/workspace/ServiceDialog";
import { WorkbenchHome } from "../../web/src/components/workspace/WorkbenchHome";
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
        <WorkbenchHome
          ready
          onOpenFolder={() => {}}
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
