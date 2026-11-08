/** One-time notice that Cadence recovered by itself after an unclean shutdown
 * or crash. Dismissal is remembered in this browser only. */
import { useState } from "react";
import type { RecoveryNotice } from "../../../../src/service/contracts/gateway.ts";
import { type MessageKey, useT } from "../../i18n/locale";

const STORAGE_KEY = "cadence-recovery-dismissed";
const CAUSES: Record<RecoveryNotice["cause"], MessageKey> = {
  reboot:
    "The machine restarted while Cadence was running. Cadence recovered automatically.",
  crash: "Cadence ended unexpectedly last time. It recovered automatically.",
  restart: "Cadence ran into a problem and restarted itself.",
  storage: "Cadence repaired some incomplete files automatically.",
};
const ACTIONS: Record<RecoveryNotice["actions"][number], MessageKey> = {
  "released-locks": "Released the previous run's locks.",
  "stopped-workers": "Stopped {count} leftover worker processes.",
  "stopped-owner": "Stopped the unresponsive previous process.",
  "continued-history": "History continues after the last complete entry.",
  "archived-history":
    "Unreadable history was archived and a new one was started.",
  "archived-state": "Damaged state was archived; it started afresh.",
  "rebuilt-registry": "Rebuilt the project registry.",
  "removed-temporaries": "Set aside interrupted temporary files.",
};
function readDismissed(): string[] {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "[]",
    );
    return Array.isArray(value)
      ? value.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}
function name(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}
export function RecoveryNotices({
  notices,
  project,
}: {
  notices: readonly RecoveryNotice[];
  /** Inside a project: only its own and account-wide recoveries. */
  project?: string;
}) {
  const { t } = useT();
  const [dismissed, setDismissed] = useState(readDismissed);
  const [open, setOpen] = useState(false);
  const visible = notices.filter(
    (n) =>
      !dismissed.includes(n.id) &&
      (project === undefined || n.scope !== "project" || n.path === project),
  );
  if (!visible.length) return null;
  const latest = visible[0];
  const dismiss = () => {
    const next = [...dismissed, ...visible.map((n) => n.id)].slice(-50);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* this session only */
    }
    setDismissed(next);
  };
  const where = (n: RecoveryNotice) =>
    n.scope === "project" && n.path
      ? t("Folder {name}", { name: name(n.path) })
      : n.scope === "workbench"
        ? t("Cadence service")
        : t("Project registry");
  return (
    <div className="banner-notice recovery-notice" role="status">
      <span>
        {t(CAUSES[latest.cause])}{" "}
        {latest.cause !== "storage" &&
          t(
            "Work that was running is marked as interrupted; start it again when you are ready.",
          )}
      </span>{" "}
      <button type="button" onClick={() => setOpen((v) => !v)}>
        {open ? t("Hide details") : t("Details")}
      </button>{" "}
      <button type="button" onClick={dismiss}>
        {t("Dismiss")}
      </button>
      {open && (
        <ul className="recovery-details">
          {visible.map((n) => (
            <li key={n.id}>
              <strong>{where(n)}</strong>{" "}
              <time dateTime={new Date(n.at).toISOString()}>
                {new Date(n.at).toLocaleString()}
              </time>
              {": "}
              {n.actions
                .map((a) => t(ACTIONS[a], { count: n.workers }))
                .join(" ")}
              {n.archived &&
                ` ${t("Archived files are kept for 30 days; cadence doctor shows where.")}`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
