/* Adapted from pi-web-ui LeftPanel.tsx nested/collapsed current and history rows.
 * MIT (c) 2026 xing-shuyin. Selection only observes; never switch_session/repair. */
import { useMemo, useState } from "react";
import { usePage } from "../../history/use-page";
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
  return (
    <aside className="panel panel-left">
      <header className="panel-header">
        <h2>Tasks</h2>
        <button type="button" onClick={onNew}>
          New task
        </button>
      </header>
      <p className="panel-hint">
        One checkout owner. Open/history never executes.
      </p>
      <nav aria-label="Tasks" className="task-list">
        {tasks.page &&
          !("kind" in tasks.page) &&
          tasks.page.records.map((r) =>
            r.kind === "task" ? (
              <button
                type="button"
                className={r.owner.taskId === taskId ? "active" : ""}
                key={r.owner.taskId}
                onClick={() => onTask(r.owner.taskId)}
              >
                <strong>{r.goal}</strong>
                <small>
                  {r.owner.taskId} · v{r.version}
                </small>
              </button>
            ) : null,
          )}
      </nav>
      <PageControls pager={tasks} />
      {taskId && (
        <>
          <h3>Active and recent episodes</h3>
          <nav aria-label="Runs and assignments">
            {rows.map((row) => (
              <div
                className="conv-row"
                key={row.c.id}
                style={{ paddingInlineStart: `${row.depth * 16}px` }}
              >
                {row.hasKids && (
                  <button
                    type="button"
                    aria-label="Toggle assignments"
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
                    {row.isCollapsed ? "▸" : "▾"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    onScope({
                      kind: row.c.parentId ? "child" : "run",
                      id: row.c.id,
                    })
                  }
                >
                  {row.c.label}{" "}
                  {row.c.failed
                    ? "failed"
                    : row.c.unknown
                      ? "unknown"
                      : row.c.active
                        ? "active"
                        : "settled"}
                  {row.isCollapsed &&
                    ` · ${row.descendantCount} descendants${row.hasFailure ? " / failed child" : ""}${row.hasUnknown ? " / unknown child" : ""}`}
                </button>
              </div>
            ))}
          </nav>
          <button
            type="button"
            onClick={() => onScope({ kind: "task", id: taskId })}
          >
            All retained episodes for task
          </button>
        </>
      )}
    </aside>
  );
}
