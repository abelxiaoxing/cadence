import type { usePage } from "../../history/use-page";
import { Coverage } from "./Coverage";
export function PageControls({ pager }: { pager: ReturnType<typeof usePage> }) {
  const { page, busy, error } = pager;
  return (
    <div className="page-controls">
      {error && (
        <p role="alert">
          Read refused: {error}. Retained state has not been repaired.
        </p>
      )}
      {busy && <p role="status">Reading bounded history page…</p>}
      {page && "kind" in page && (
        <p role="status">
          {page.kind === "snapshot"
            ? "Snapshot selected"
            : "Validating retained history"}
          ; continue this exact read. No data page yet.
        </p>
      )}
      {page && <Coverage value={page.coverage} />}
      <button
        type="button"
        disabled={busy || !pager.canPrevious}
        onClick={pager.previous}
      >
        Previous page
      </button>
      <button type="button" disabled={busy || !page?.next} onClick={pager.more}>
        {page && "kind" in page ? "Continue validation" : "Next page"}
      </button>
      <button type="button" disabled={busy} onClick={pager.refresh}>
        Observe a new snapshot
      </button>
      {page && !("kind" in page) && !page.next && (
        <span>
          End of this retained snapshot
          {page.coverage.observed === "incomplete" ? " (incomplete)" : ""}.
        </span>
      )}
    </div>
  );
}
