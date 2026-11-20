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
/** Session IDs group display rows. Only the producer and work identity can
 * remove a particular observation from discovery. */
export function activityKey(
  path: string,
  a: Activity | { source: "turn" | "workflow"; epoch: string; id: string },
) {
  return JSON.stringify([
    path,
    a.source,
    a.source === "terminal" ? a.instance : a.epoch,
    a.id,
  ]);
}

export function ActivityButton({
  path,
  activity,
  opening,
  onOpen,
  grouped = false,
}: Pick<ActivityListProps, "onOpen" | "opening"> & {
  path: string;
  activity: Activity;
  grouped?: boolean;
}) {
  const { t, tx } = useT();
  const source =
    activity.source === "terminal"
      ? t("Terminal turn (observe only)")
      : activity.source === "turn"
        ? t("Owner turn")
        : t("Owner workflow");
  const fresh =
    activity.freshness === "current"
      ? t("Current observation")
      : activity.freshness === "stale"
        ? t("Stale observation")
        : t("Unknown activity");
  // Already under the session title: identify the particular work and its
  // producer, not just the session (or a terminal leaf shared by two turns).
  const producer =
    activity.source === "terminal" ? activity.instance : activity.epoch;
  return (
    <button
      type="button"
      className="session-item"
      disabled={opening || !activity.sessionId || activity.history !== "shared"}
      title={
        grouped
          ? `${source} · ${activity.cwd} · ${activity.leaf ?? activity.sessionId} · ${producer} · ${activity.id}`
          : undefined
      }
      onClick={() => onOpen(path, activity)}
    >
      <span className="session-info">
        <span className="session-title">
          {grouped
            ? [activity.leaf, source].filter(Boolean).join(" · ")
            : (activity.sessionId ?? t("Unattributed work"))}
        </span>
        <span className="session-sub">
          {grouped
            ? `${fresh} · ${producer?.slice(0, 8)} · ${activity.id.slice(0, 8)}`
            : `${source} · ${tx(activity.phase)} · ${fresh}`}
        </span>
        {activity.history === "unavailable" && (
          <span className="session-sub">
            {t("History configuration differs. Activity remains observe-only.")}
          </span>
        )}
        <span className="session-sub">
          {activity.cwd}
          {activity.executionCwd ? ` → ${activity.executionCwd}` : ""}
        </span>
      </span>
    </button>
  );
}

/** One list of working projects/sessions, not a terminal management surface. */
export function ActivityList({
  value,
  error,
  opening,
  onOpen,
  represented,
}: ActivityListProps & { represented?: ReadonlySet<string> }) {
  const { t } = useT();
  const visible = value?.projects
    .map((p) => ({
      ...p,
      activities: p.activities.filter(
        (a) => !represented?.has(activityKey(p.path, a)),
      ),
    }))
    .filter((p) => p.activities.length);
  const partial = !!error || value?.completeness === "partial";
  if (!visible?.length && !partial) return null;
  return (
    <section className="lp-section" aria-label={t("Active Pi work")}>
      <div className="lp-section-body">
        {partial && (
          <p role="status" className="panel-hint">
            {t(
              "Activity observation is partial. Missing work is not known to have finished.",
            )}
            {error ? ` (${error})` : ""}
          </p>
        )}
        {visible?.map((project) => (
          <div key={project.path}>
            <p className="panel-hint">{project.path}</p>
            {project.activities.map((activity) => (
              <ActivityButton
                key={activityKey(project.path, activity)}
                path={project.path}
                activity={activity}
                opening={opening}
                onOpen={onOpen}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
