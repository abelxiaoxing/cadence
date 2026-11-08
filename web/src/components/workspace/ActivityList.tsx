import type {
  Activity,
  ActivityDiscovery,
} from "../../../../src/service/contracts/activity.ts";
import { useT } from "../../i18n/locale";

export interface ActivityListProps {
  value?: ActivityDiscovery;
  project?: string;
  error: string;
  opening: boolean;
  onOpen(path: string, activity: Activity): void;
}
export const activityKey = (
  path: string,
  source: Activity["source"],
  id: string,
  epoch: string | null,
) => JSON.stringify([path, source, id, epoch]);
/** One list of working projects/sessions, not a terminal management surface. */
export function ActivityList({
  value,
  error,
  opening,
  onOpen,
  represented = [],
}: ActivityListProps & { represented?: readonly string[] }) {
  const { t, tx } = useT();
  const sessions = new Set(
    value?.projects.flatMap((p) =>
      p.activities
        .filter((a) => a.sessionId)
        .map((a) => `${p.path}\0${a.sessionId}`),
    ),
  );
  // The selected project's managed work already has its authorized controls in
  // Running work. Discovery must not duplicate those rows or controls.
  const visible = value?.projects
    .map((p) => ({
      ...p,
      activities: p.activities.filter(
        (a) =>
          !represented.includes(activityKey(p.path, a.source, a.id, a.epoch)),
      ),
    }))
    .filter((p) => p.activities.length);
  return (
    <section className="lp-section" aria-label={t("Active Pi work")}>
      <header className="lp-section-header">
        <span className="lp-section-title">{t("Active Pi work")}</span>
      </header>
      <div className="lp-section-body">
        {value && (
          <p className="panel-hint">
            {t("{projects} projects · {sessions} sessions", {
              projects: value.projects.length,
              sessions: sessions.size,
            })}
          </p>
        )}
        {(error || value?.completeness === "partial") && (
          <p role="status" className="panel-hint">
            {t(
              "Activity observation is partial. Missing work is not known to have finished.",
            )}
            {error ? ` (${error})` : ""}
          </p>
        )}
        {represented.length > 0 && (
          <p className="panel-hint">
            {t("Owner work already listed below is not duplicated here.")}
          </p>
        )}
        {!value && !error && (
          <p className="panel-hint">{t("Discovering active work…")}</p>
        )}
        {value?.completeness === "complete" &&
          !error &&
          !value.projects.length && (
            <p className="panel-hint">
              {t(
                "No active work observed. Idle terminals and owners are not listed.",
              )}
            </p>
          )}
        {visible?.map((project) => (
          <div key={project.path}>
            <p className="panel-hint">{project.path}</p>
            {project.activities.map((activity) => (
              <button
                type="button"
                className="session-item"
                key={`${activity.epoch ?? activity.instance}:${activity.source}:${activity.id}`}
                disabled={
                  opening ||
                  !activity.sessionId ||
                  activity.history !== "shared"
                }
                onClick={() => onOpen(project.path, activity)}
              >
                <span className="session-info">
                  <span className="session-title">
                    {activity.sessionId ?? t("Unattributed work")}
                  </span>
                  <span className="session-sub">
                    {activity.source === "terminal"
                      ? t("Terminal turn (observe only)")
                      : activity.source === "turn"
                        ? t("Owner turn")
                        : t("Owner workflow")}{" "}
                    · {tx(activity.phase)} ·{" "}
                    {activity.freshness === "current"
                      ? t("Current observation")
                      : activity.freshness === "stale"
                        ? t("Stale observation")
                        : t("Unknown activity")}
                  </span>
                  {activity.history === "unavailable" && (
                    <span className="session-sub">
                      {t(
                        "History configuration differs. Activity remains observe-only.",
                      )}
                    </span>
                  )}
                  <span className="session-sub">
                    {activity.cwd}
                    {activity.executionCwd ? ` → ${activity.executionCwd}` : ""}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
