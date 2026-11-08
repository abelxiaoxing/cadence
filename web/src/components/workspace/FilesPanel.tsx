/* Adapted from pi-web-ui RightPanel.tsx: files tab, breadcrumb, directory rows,
 * readonly preview and path references. MIT (c) 2026 xing-shuyin.
 * No file mutation, remote SSH, transfer, plugin widgets or set_cwd transport. */
import { useState } from "react";
import {
  FiArrowUp,
  FiCopy,
  FiFile,
  FiFolder,
  FiPlus,
  FiRefreshCw,
  FiX,
} from "react-icons/fi";
import type { ConversationLocation } from "../../../../src/service/contracts/models.ts";
import type { ServiceClient } from "../../../../src/service-client.ts";
import { useWorkbench } from "../../client/use-workbench";
import { describeError, useT } from "../../i18n/locale";
import { copyTextToClipboard } from "../../rich/use-copy-feedback";
export function FilesPanel({
  client,
  enabled,
  location,
  onReference,
}: {
  client: ServiceClient;
  enabled: boolean;
  location?: ConversationLocation;
  onReference(path: string): void;
}) {
  const { t } = useT();
  const [path, setPath] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [notice, setNotice] = useState("");
  const files = useWorkbench(
    client,
    enabled ? { kind: "files", path, ...(location ? { location } : {}) } : null,
  );
  const preview = useWorkbench(
    client,
    enabled && selected
      ? { kind: "file", path: selected, ...(location ? { location } : {}) }
      : null,
  );
  const listing = files.value?.kind === "files" ? files.value : undefined;
  const file = preview.value?.kind === "file" ? preview.value : undefined;
  return (
    <div className="files-panel">
      <header className="files-toolbar">
        <button
          type="button"
          className="ghost"
          aria-label={t("Parent folder")}
          disabled={listing?.parent == null}
          onClick={() => {
            if (listing?.parent != null) setPath(listing.parent);
          }}
        >
          <FiArrowUp />
        </button>
        <span
          className="files-path"
          title={
            location ? `${location.cwd}${path ? ` / ${path}` : ""}` : undefined
          }
        >
          {t("Conversation folder:")}{" "}
          {path || location?.cwd || t("Not observed")}
        </span>
        <button
          type="button"
          className="ghost"
          aria-label={t("Refresh files")}
          disabled={!enabled}
          onClick={() => {
            files.refresh();
            preview.refresh();
          }}
        >
          <FiRefreshCw />
        </button>
      </header>
      {files.error && (
        <p className="inspector-note" role="alert">
          {describeError(t, files.error)}
        </p>
      )}
      <section className="file-list" aria-label={t("File list")}>
        {!enabled ? (
          <p className="panel-empty" role="status">
            {t(
              location
                ? "Files are unavailable until the execution state is ready."
                : "The conversation folder has not been observed.",
            )}
          </p>
        ) : !listing && !files.error ? (
          <p className="panel-empty" role="status">
            {t("Reading files…")}
          </p>
        ) : null}
        {listing?.entries.map((entry) => (
          <div className="file-row" key={entry.path}>
            <button
              type="button"
              className={`file-name${selected === entry.path ? " selected" : ""}`}
              title={entry.path}
              onClick={() =>
                entry.directory ? setPath(entry.path) : setSelected(entry.path)
              }
            >
              {entry.directory ? <FiFolder /> : <FiFile />}
              <span>{entry.name}</span>
            </button>
            <button
              type="button"
              className="file-action"
              aria-label={t("Reference {path}", { path: entry.name })}
              disabled={!enabled || !!files.error}
              onClick={() => onReference(entry.path)}
            >
              <FiPlus />
            </button>
            <button
              type="button"
              className="file-action"
              aria-label={t("Copy path {path}", { path: entry.name })}
              onClick={() =>
                void copyTextToClipboard(entry.path).then((ok) =>
                  setNotice(ok ? "" : t("Link copy unavailable.")),
                )
              }
            >
              <FiCopy />
            </button>
          </div>
        ))}
        {enabled && !files.error && listing?.entries.length === 0 && (
          <p className="panel-empty">{t("No visible files")}</p>
        )}
        {listing?.limited && (
          <p className="inspector-note">
            {t("Bounded listing; narrow the directory to see more.")}
          </p>
        )}
      </section>
      {selected && (
        <section className="file-preview">
          <header>
            <span title={selected}>{selected}</span>
            <button
              type="button"
              className="ghost"
              aria-label={t("Close preview")}
              onClick={() => setSelected(null)}
            >
              <FiX />
            </button>
          </header>
          {preview.error && (
            <p role="alert">{describeError(t, preview.error)}</p>
          )}
          {file && (
            <>
              <pre>{file.text}</pre>
              {file.limited && (
                <p className="inspector-note">
                  {t("File preview is limited; this is not the complete file.")}
                </p>
              )}
            </>
          )}
        </section>
      )}
      {notice && <p role="alert">{notice}</p>}
      <p className="files-policy">
        {t("Readonly preview · references send paths, not file contents")}
      </p>
    </div>
  );
}
