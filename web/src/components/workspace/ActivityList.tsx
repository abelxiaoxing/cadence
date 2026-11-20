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

export function ActivityRow({
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
  // Discovery carries identity and location, not access to this owner's run.
  if (grouped && !activity.sessionId)
    return (
      <p className="panel-hint">
        {source} · <code>{activity.id}</code>
        <br />
        {tx(activity.phase)} · {fresh} · {activity.cwd}
        {activity.executionCwd ? ` → ${activity.executionCwd}` : ""}
      </p>
    );
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
  project,
  error,
  opening,
  onOpen,
  represented,
  awaitingHistory,
}: ActivityListProps & {
  represented?: ReadonlySet<string>;
  awaitingHistory?: boolean;
}) {
  const { t } = useT();
  const visible = value?.projects
    .map(({ path, activities }) => {
      const rows: Activity[] = [],
        unlinked: Activity[] = [];
      for (const a of activities) {
        if (represented?.has(activityKey(path, a))) continue;
        if (
          awaitingHistory &&
          path === project &&
          a.source === "workflow" &&
          !a.sessionId
        )
          unlinked.push(a);
        else rows.push(a);
      }
      unlinked.sort((a, b) =>
        activityKey(path, a).localeCompare(activityKey(path, b)),
      );
      return { path, rows, unlinked };
    })
    .filter((p) => p.rows.length || p.unlinked.length);
  const partial = !!error || value?.completeness === "partial";
  if (!visible?.length && !partial) return null;
  const row = (path: string, activity: Activity, grouped = false) => (
    <ActivityRow
      key={activityKey(path, activity)}
      path={path}
      activity={activity}
      opening={opening}
      onOpen={onOpen}
      grouped={grouped}
    />
  );
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
        {visible?.map(({ path, rows, unlinked }) => (
          <div key={path}>
            <p className="panel-hint">{path}</p>
            {unlinked.length > 0 && (
              <details className="history-unlinked">
                <summary>
                  <span
                    className="status-dot busy"
                    role="img"
                    aria-label={
                      !error && unlinked.some((a) => a.freshness === "current")
                        ? t("Working")
                        : t("Stale observation")
                    }
                  />
                  {t("Unattributed work")} · {unlinked.length}
                </summary>
                {unlinked.map((a) => row(path, a, true))}
              </details>
            )}
            {rows.map((a) => row(path, a))}
          </div>
        ))}
      </div>
    </section>
  );
}
