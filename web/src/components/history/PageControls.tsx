import { FiRefreshCw } from "react-icons/fi";
import type { usePage } from "../../history/use-page";
import { useT } from "../../i18n/locale";
import { Coverage } from "./Coverage";
export function PageControls({
  pager,
  compact = false,
}: {
  pager: ReturnType<typeof usePage>;
  compact?: boolean;
}) {
  const { t, tx } = useT();
  const { page, busy, error } = pager;
  return (
    <div className={`page-controls${compact ? " compact" : ""}`}>
      {error && (
        <p role="alert">
          {t("Read refused: {error}. Retained state has not been repaired.", {
            error: tx(error),
          })}
        </p>
      )}
      {busy && <p role="status">{t("Reading bounded history page…")}</p>}
      {page && "kind" in page && (
        <p role="status">
          {page.kind === "snapshot"
            ? t("Snapshot selected")
            : t("Validating retained history")}
          {t("; continue this exact read. No data page yet.")}
        </p>
      )}
      {page && <Coverage value={page.coverage} compact={compact} />}
      {(!compact || pager.canPrevious) && (
        <button
          type="button"
          disabled={busy || !pager.canPrevious}
          onClick={pager.previous}
        >
          {t("Previous page")}
        </button>
      )}
      {(!compact || page?.next) && (
        <button
          type="button"
          disabled={busy || !page?.next}
          onClick={pager.more}
        >
          {page && "kind" in page ? t("Continue validation") : t("Next page")}
        </button>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={pager.refresh}
        aria-label={t("Observe a new snapshot")}
        title={t("Observe a new snapshot")}
      >
        {compact ? (
          <FiRefreshCw aria-hidden="true" />
        ) : (
          t("Observe a new snapshot")
        )}
      </button>
      {!compact && page && !("kind" in page) && !page.next && (
        <span className="page-end">
          {page.coverage.observed === "incomplete"
            ? t("End of this retained snapshot (incomplete).")
            : t("End of this retained snapshot.")}
        </span>
      )}
    </div>
  );
}
