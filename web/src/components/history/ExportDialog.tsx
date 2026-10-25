import { useState } from "react";
import { requestDownload } from "../../history/download-export";
import { useT } from "../../i18n/locale";
import type { ExportRequest } from "../../types";
import { ActionDialog } from "../actions/ActionDialog";
export function ExportDialog({
  request,
  onClose,
}: {
  request: ExportRequest;
  onClose: () => void;
}) {
  const { t, tx } = useT();
  const [frozenRequest] = useState(request);
  const [format, setFormat] = useState(request.format),
    [status, setStatus] = useState("");
  return (
    <ActionDialog title={t("Export retained history")} onClose={onClose}>
      <p>
        {t("Selected {kind}: {id} · snapshot {seq}", {
          kind: tx(frozenRequest.scope.kind),
          id: frozenRequest.scope.id,
          seq: frozenRequest.snapshotSeq,
        })}
      </p>
      <label>
        {t("Format")}
        <select
          value={format}
          onChange={(e) =>
            setFormat(e.target.value === "markdown" ? "markdown" : "ndjson")
          }
        >
          <option value="ndjson">{t("NDJSON public archive")}</option>
          <option value="markdown">
            {t("Readable Markdown with footer metadata")}
          </option>
        </select>
      </label>
      <p>
        {t(
          "Includes retained context, messages/tools, graph, lifecycle, changes, checks, human review and coverage beyond loaded pages. Redactions and source omissions remain.",
        )}
      </p>
      <p>
        {t(
          "A native browser download request cannot establish completion. Inspect the original EOF and completion trailer/counts/digest in the downloaded artifact; missing footer means incomplete. Revoked access may terminate without a trailer.",
        )}
      </p>
      <button
        type="button"
        onClick={() => {
          try {
            requestDownload({ ...frozenRequest, format });
            setStatus(
              t(
                "Download requested — completion not verified by this browser UI.",
              ),
            );
          } catch {
            setStatus(t("Download unavailable; no archive claimed complete."));
          }
        }}
      >
        {t("Request selected-scope download")}
      </button>
      <p role="status">{status}</p>
    </ActionDialog>
  );
}
