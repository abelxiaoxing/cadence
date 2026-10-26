/* Adapted from pi-web-ui LeftPanel.tsx nested/collapsed current and history rows,
 * lp-section headers and session-item rows. MIT (c) 2026 xing-shuyin.
 * Selection only observes; never switch_session/repair. */
import { useMemo, useState } from "react";
import {
  FiChevronDown,
  FiChevronRight,
  FiFileText,
  FiList,
  FiPlus,
} from "react-icons/fi";
import { usePage } from "../../history/use-page";
import { useT } from "../../i18n/locale";
import { buildNavigationRows } from "../../navigation/assignment-rows";
import type {
  ListRequest,
  RunProjection,
  Scope,
  ServiceClient,
  WorkspaceBootstrap,
} from "../../types";
import { PageControls } from "../history/PageControls";
export function TaskSidebar({
  client,
  workspace,
  taskId,
  runs,
  onTask,
  onScope,
  onNew,
}: {
  client: ServiceClient;
  workspace: WorkspaceBootstrap;
  taskId: string | null;
  runs: RunProjection[];
  onTask: (id: string) => void;
  onScope: (scope: Scope) => void;
  onNew: () => void;
}) {
  const request: ListRequest = {
    reader: "tasks",
    storeId: workspace.storeId,
    scope: { kind: "workspace", id: workspace.workspaceId },
    snapshotSeq: null,
    after: null,
    limit: 50,
  };
  const { t, tx } = useT();
  const tasks = usePage(client, request),
    [collapsed, setCollapsed] = useState(new Set<string>());
  const rows = useMemo(
    () =>
      buildNavigationRows(
        runs.map((r) => ({
          id: r.childRunId ?? r.runId,
          parentId: r.childRunId ? r.runId : null,
          label: r.assignmentId ?? r.admission.kind,
          active: r.lifecycle !== "settled",
          failed: r.outcome === "failed",
          unknown: r.outcome === "unknown",
        })),
        collapsed,
      ),
    [runs, collapsed],
  );
  const records =
    tasks.page && !("kind" in tasks.page) ? tasks.page.records : null;
  const taskCount = records?.filter((r) => r.kind === "task").length;
  // Page-local count; "+" marks retained tasks beyond this bounded page,
  // after it as well as before it.
  const countLabel =
    taskCount === undefined
      ? ""
      : ` (${taskCount}${(tasks.page && !("kind" in tasks.page) && tasks.page.next) || tasks.canPrevious ? "+" : ""})`;
  return (
    <aside className="panel panel-left lp-panel">
      <section className="lp-section grow">
        <header className="lp-section-header">
          <h2 className="lp-section-title">
            {t("Tasks")}
            {countLabel}
          </h2>
          <div className="lp-section-actions">
            <button
              type="button"
              className="lp-section-action"
              aria-label={t("New task")}
              title={t("New task")}
              onClick={onNew}
            >
              <FiPlus aria-hidden="true" />
            </button>
          </div>
        </header>
        <nav aria-label={t("Tasks")} className="lp-section-body task-list">
          {records?.map((r) =>
            r.kind === "task" ? (
              <button
                type="button"
                className={`session-item${r.owner.taskId === taskId ? " active" : ""}`}
                aria-current={r.owner.taskId === taskId ? "true" : undefined}
                key={r.owner.taskId}
                title={r.goal}
                onClick={() => onTask(r.owner.taskId)}
              >
                <span className="session-icon">
                  <FiFileText aria-hidden="true" />
                </span>
                <span className="session-info">
                  <span className="session-title">{r.goal}</span>{" "}
                  <span className="session-sub">
                    {r.owner.taskId} · v{r.version}
                  </span>
                </span>
              </button>
            ) : null,
          )}
          {taskCount === 0 && (
            <p className="panel-empty">{t("No retained task on this page.")}</p>
          )}
          <PageControls pager={tasks} />
        </nav>
        <p className="panel-hint">
          {t("One checkout owner. Open/history never executes.")}
        </p>
      </section>
      {taskId && (
        <section className="lp-section episodes">
          <header className="lp-section-header">
            <h3 className="lp-section-title">
              {t("Active and recent episodes")}
            </h3>
          </header>
          <div className="lp-section-body">
            <nav aria-label={t("Runs and assignments")}>
              {rows.map((row) => {
                const state = row.c.failed
                  ? "failed"
                  : row.c.unknown
                    ? "unknown"
                    : row.c.active
                      ? "active"
                      : "settled";
                return (
                  <div
                    className="ep-row"
                    key={row.c.id}
                    style={{ paddingInlineStart: `${row.depth * 16}px` }}
                  >
                    {row.hasKids ? (
                      <button
                        type="button"
                        className="ep-toggle"
                        aria-label={t("Toggle assignments")}
                        aria-expanded={!row.isCollapsed}
                        onClick={() =>
                          setCollapsed((prev) => {
                            const next = new Set(prev);
                            if (next.has(row.c.id)) next.delete(row.c.id);
                            else next.add(row.c.id);
                            return next;
                          })
                        }
                      >
                        {row.isCollapsed ? (
                          <FiChevronRight aria-hidden="true" />
                        ) : (
                          <FiChevronDown aria-hidden="true" />
                        )}
                      </button>
                    ) : (
                      <span className="ep-toggle-spacer" aria-hidden="true" />
                    )}
                    <button
                      type="button"
                      className="session-item"
                      onClick={() =>
                        onScope({
                          kind: row.c.parentId ? "child" : "run",
                          id: row.c.id,
                        })
                      }
                    >
                      <span className="session-info">
                        <span className="session-title">{row.c.label}</span>
                        {row.isCollapsed && " "}
                        {row.isCollapsed && (
                          <span className="session-sub session-outcome">
                            {`${t("{count} descendants", { count: row.descendantCount })}${row.hasFailure ? t(" / failed child") : ""}${row.hasUnknown ? t(" / unknown child") : ""}`}
                          </span>
                        )}
                      </span>{" "}
                      <span className={`ep-state ${state}`}>{tx(state)}</span>
                    </button>
                  </div>
                );
              })}
              {rows.length === 0 && (
                <p className="panel-empty">
                  {t("No active or recent episode observed.")}
                </p>
              )}
            </nav>
            <button
              type="button"
              className="ghost ep-all"
              onClick={() => onScope({ kind: "task", id: taskId })}
            >
              <FiList aria-hidden="true" />
              {t("All retained episodes for task")}
            </button>
          </div>
        </section>
      )}
    </aside>
  );
}
