import { useState } from "react";
import { requestDownload } from "../../history/download-export";
import type { ExportRequest } from "../../types";
import { ActionDialog } from "../actions/ActionDialog";
export function ExportDialog({
  request,
  onClose,
}: {
  request: ExportRequest;
  onClose: () => void;
}) {
  const [frozenRequest] = useState(request);
  const [format, setFormat] = useState(request.format),
    [status, setStatus] = useState("");
  return (
    <ActionDialog title="Export retained history" onClose={onClose}>
      <p>
        Selected {frozenRequest.scope.kind}: {frozenRequest.scope.id} · snapshot{" "}
        {frozenRequest.snapshotSeq}
      </p>
      <label>
        Format
        <select
          value={format}
          onChange={(e) =>
            setFormat(e.target.value === "markdown" ? "markdown" : "ndjson")
          }
        >
          <option value="ndjson">NDJSON public archive</option>
          <option value="markdown">
            Readable Markdown with footer metadata
          </option>
        </select>
      </label>
      <p>
        Includes retained context, messages/tools, graph, lifecycle, changes,
        checks, human review and coverage beyond loaded pages. Redactions and
        source omissions remain.
      </p>
      <p>
        A native browser download request cannot establish completion. Inspect
        the original EOF and completion trailer/counts/digest in the downloaded
        artifact; missing footer means incomplete. Revoked access may terminate
        without a trailer.
      </p>
      <button
        type="button"
        onClick={() => {
          try {
            requestDownload({ ...frozenRequest, format });
            setStatus(
              "Download requested — completion not verified by this browser UI.",
            );
          } catch {
            setStatus("Download unavailable; no archive claimed complete.");
          }
        }}
      >
        Request selected-scope download
      </button>
      <p role="status">{status}</p>
    </ActionDialog>
  );
}
