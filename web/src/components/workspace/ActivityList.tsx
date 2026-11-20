import type { ReactNode } from "react";
import { FiChevronRight } from "react-icons/fi";
import type {
  Activity,
  ActivityDiscovery,
  ActivityProject,
} from "../../../../src/service/contracts/activity.ts";
import { useT } from "../../i18n/locale";
import { ConversationRow } from "./ConversationRow";

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

/** Take only the selected project's attributable reports (and its orphan
 * workflows) out of discovery, whether or not its history has loaded. The
 * viewer's exact roster identities, when available, already occupy `seen`. */
export function groupProjectActivity(
  project: ActivityProject | undefined,
  seen: Set<string>,
) {
  const sessions = new Map<string, Activity[]>();
  const unlinked: Activity[] = [];
  if (project) {
    for (const a of project.activities) {
      const key = activityKey(project.path, a);
      if (seen.has(key)) continue;
      if (a.source === "workflow" && !a.sessionId) unlinked.push(a);
      else if (
        a.sessionId &&
        a.history === "shared" &&
        (a.source === "terminal" ? a.instance : a.epoch)
      ) {
        const group = sessions.get(a.sessionId) ?? [];
        group.push(a);
        sessions.set(a.sessionId, group);
      } else continue;
      seen.add(key);
    }
    for (const reports of [...sessions.values(), unlinked])
      reports.sort((a, b) =>
        activityKey(project.path, a).localeCompare(
          activityKey(project.path, b),
        ),
      );
  }
  return { sessions, unlinked };
}

export function SessionWorkDetails({
  label,
  title,
  count,
  children,
}: {
  label: string;
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <details className="history-workflows">
      <summary title={label} aria-label={`${label} · ${title} (${count})`}>
        <span>{count}</span>
        <FiChevronRight aria-hidden="true" />
      </summary>
      {children}
    </details>
  );
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
  const item =
    grouped && !activity.sessionId ? (
      <p className="panel-hint">
        {source} · <code>{activity.id}</code>
        <br />
        {tx(activity.phase)} · {fresh} · {activity.cwd}
        {activity.executionCwd ? ` → ${activity.executionCwd}` : ""}
      </p>
    ) : (
      <button
        type="button"
        className="session-item"
        disabled={
          opening || !activity.sessionId || activity.history !== "shared"
        }
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
    );
  return grouped ? (
    <div
      className={
        activity.source === "terminal"
          ? "history-run history-terminal"
          : "history-run"
      }
    >
      {item}
    </div>
  ) : (
    item
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
  const seen = new Set(represented);
  const visible = value?.projects
    .map((p) => {
      const { sessions, unlinked } = groupProjectActivity(
        awaitingHistory && p.path === project ? p : undefined,
        seen,
      );
      const rows = p.activities.filter(
        (a) => !seen.has(activityKey(p.path, a)),
      );
      return { path: p.path, rows, sessions, unlinked };
    })
    .filter((p) => p.rows.length || p.sessions.size || p.unlinked.length);
  // Independent project observations may arrive in a different order on
  // every poll. Keep the selected history prefix in place above other paths.
  if (awaitingHistory)
    visible?.sort(
      (a, b) => Number(b.path === project) - Number(a.path === project),
    );
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
        {visible?.map(({ path, rows, sessions, unlinked }) => (
          <div key={path}>
            <p className="panel-hint">{path}</p>
            {[...sessions]
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([id, reports]) => {
                const title = t("Conversation {id}", { id });
                return (
                  <div key={id} className="history-entry has-workflows">
                    <ConversationRow
                      chat={{ id, title }}
                      selected={false}
                      activityLabel={
                        !error && reports.some((a) => a.freshness === "current")
                          ? t("Working")
                          : t("Stale observation")
                      }
                      onOpen={() => {
                        if (!opening) onOpen(path, reports[0]);
                      }}
                    />
                    <SessionWorkDetails
                      label={t("Details")}
                      title={title}
                      count={reports.length}
                    >
                      {reports.map((a) => row(path, a, true))}
                    </SessionWorkDetails>
                  </div>
                );
              })}
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
