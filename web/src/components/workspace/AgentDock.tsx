/* pi-web-ui's compact agent rows, backed only by Cadence retained child IDs.
 * MIT (c) 2026 xing-shuyin. This observer never launches or cancels an agent. */
import { useEffect, useState } from "react";
import { FiChevronDown, FiCpu } from "react-icons/fi";
import { useT } from "../../i18n/locale";
import type { ActiveRuns, RunProjection, ServiceClient } from "../../types";

interface Row {
  taskId: string;
  run: RunProjection;
  snapshot: string;
}
export function AgentDock({
  client,
  active,
  taskId,
  runs,
  snapshot,
  onOpen,
}: {
  client: ServiceClient;
  active?: ActiveRuns;
  taskId: string | null;
  runs: RunProjection[];
  snapshot?: string;
  onOpen(
    taskId: string,
    childId: string,
    snapshot: string,
    label: string,
  ): void;
}) {
  const { t, tx } = useT();
  const [open, setOpen] = useState(true),
    [rows, setRows] = useState<Row[]>([]),
    [error, setError] = useState(false);
  const key = JSON.stringify(
    active?.status === "complete"
      ? [...new Set(active.runs.map((run) => run.taskId))]
      : [],
  );
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const next: Row[] = [];
      let failed = false;
      for (const id of JSON.parse(key) as string[]) {
        const result = await client.snapshot(
          { kind: "task", id },
          abort.signal,
        );
        if (abort.signal.aborted) return;
        if (result.kind === "ok") {
          for (const run of result.value.runs) {
            if (run.childRunId)
              next.push({
                taskId: id,
                run,
                snapshot: result.value.committedSeq,
              });
          }
        } else failed = true;
      }
      if (!abort.signal.aborted) {
        setRows(next);
        setError(failed);
        timer = setTimeout(() => void poll(), 3000);
      }
    };
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [client, key]);
  const current =
    taskId && snapshot
      ? runs
          .filter((run) => run.childRunId)
          .map((run) => ({ taskId, run, snapshot }))
      : [];
  const merged = [
    ...rows,
    ...current.filter(
      (row) => !rows.some((r) => r.run.childRunId === row.run.childRunId),
    ),
  ].sort(
    (a, b) =>
      Number(a.run.lifecycle === "settled") -
      Number(b.run.lifecycle === "settled"),
  );
  return (
    <section className={`agent-dock${open ? "" : " collapsed"}`}>
      <button
        type="button"
        className="agent-dock-heading"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <FiChevronDown />
        <FiCpu />
        <span>{t("Subagents")}</span>
        <span className="lp-count">{merged.length}</span>
      </button>
      {open && (
        <div className="agent-dock-body">
          {(error || active?.status !== "complete") && (
            <p className="panel-hint">{t("Subagent roster unavailable")}</p>
          )}
          {merged.length === 0 && !error && active?.status === "complete" && (
            <p className="panel-hint">
              {t("Cadence subagents appear here when a task runs.")}
            </p>
          )}
          {merged.map((row) => (
            <button
              type="button"
              className="agent-dock-row"
              key={row.run.childRunId}
              onClick={() =>
                onOpen(
                  row.taskId,
                  row.run.childRunId as string,
                  row.snapshot,
                  row.run.assignmentId ?? t("Subagent"),
                )
              }
            >
              <span
                className={`agent-dot ${row.run.outcome ?? row.run.lifecycle}`}
              />
              <span className="agent-dock-label">
                <strong>{row.run.assignmentId ?? t("Subagent")}</strong>
                <small>{t("Task {id}", { id: row.taskId.slice(0, 8) })}</small>
              </span>
              <span
                className={`ep-state ${row.run.outcome ?? row.run.lifecycle}`}
              >
                {tx(row.run.outcome ?? row.run.lifecycle)}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
