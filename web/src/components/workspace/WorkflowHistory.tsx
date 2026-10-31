import { useState } from "react";
import { useWorkbench } from "../../client/use-workbench";
import { useT } from "../../i18n/locale";
import type { ServiceClient } from "../../types";
import type { WorkflowAgent } from "./AgentDock";

/** Readonly, on-demand navigation, including native-started settled workflows. */
export function WorkflowHistory({
  client,
  onOpen,
}: {
  client: ServiceClient;
  onOpen(agent: WorkflowAgent): void;
}) {
  const { t, tx } = useT();
  const [open, setOpen] = useState(false);
  const [after, setAfter] = useState<string | null>(null);
  const [scan, setScan] = useState<string>();
  const [previous, setPrevious] = useState<(string | null)[]>([]);
  const page = useWorkbench(
    client,
    open
      ? { kind: "workflow-history", after, ...(scan ? { scan } : {}) }
      : null,
  );
  const history =
    page.value?.kind === "workflow-history" ? page.value : undefined;
  const progress =
    page.value?.kind === "workflow-history-progress" ? page.value : undefined;
  const error =
    page.error ??
    (progress && progress.after !== after ? "invalid" : undefined);
  return (
    <details
      className="lp-section workflow-history"
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
        if (!event.currentTarget.open) setScan(undefined);
      }}
    >
      <summary className="lp-section-heading">{t("Workflow history")}</summary>
      {open && (
        <div className="lp-section-body">
          <p className="panel-hint">
            {t(
              "ID order; refresh to observe new runs. Unreadable records are not removed.",
            )}
          </p>
          {error && <p role="alert">{error}</p>}
          {!history && !progress && !error && <p>{t("Reading…")}</p>}
          {progress && !error && (
            <div>
              <p>
                {t("Scanning retained workflow IDs; no complete page yet.")}
              </p>
              <button
                type="button"
                disabled={page.loading}
                onClick={() => setScan(progress.scan)}
              >
                {t("Continue reading history")}
              </button>
            </div>
          )}
          {history?.entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="session-item"
              onClick={() =>
                onOpen({
                  runId: entry.id,
                  stepId: null,
                  label: entry.run?.goal || entry.id,
                })
              }
            >
              <span className="session-info">
                <span className="session-title">
                  {entry.run?.goal || entry.id}
                </span>
                <span className="session-sub">
                  {tx(entry.run?.status ?? "unavailable")}
                </span>
              </span>
            </button>
          ))}
          {history && !error && history.entries.length === 0 && (
            <p className="panel-hint">
              {t("No retained workflows on this page.")}
            </p>
          )}
          <div className="page-controls">
            <button
              type="button"
              disabled={!previous.length}
              onClick={() => {
                setScan(undefined);
                setAfter(previous.at(-1) ?? null);
                setPrevious(previous.slice(0, -1));
              }}
            >
              {t("Previous")}
            </button>
            <button
              type="button"
              disabled={!history?.next || !!error || page.loading}
              onClick={() => {
                if (history?.next) {
                  setScan(undefined);
                  setPrevious([...previous, after]);
                  setAfter(history.next);
                }
              }}
            >
              {t("Next")}
            </button>
            <button
              type="button"
              onClick={() => {
                setScan(undefined);
                page.refresh();
              }}
            >
              {t("Observe current state")}
            </button>
          </div>
        </div>
      )}
    </details>
  );
}
