/* Adapted from pi-web-ui RightPanel.tsx: crumb toolbar, path trail, directory
 * rows with hover actions, name filter, readonly preview and path references.
 * MIT (c) 2026 xing-shuyin.
 * No file mutation, remote SSH, transfer, plugin widgets or set_cwd transport. */
import { useEffect, useRef, useState } from "react";
import {
  FiCheck,
  FiChevronRight,
  FiCopy,
  FiFile,
  FiFolder,
  FiHelpCircle,
  FiLink,
  FiRefreshCw,
  FiSearch,
  FiX,
} from "react-icons/fi";
import type { ConversationLocation } from "../../../../src/service/contracts/models.ts";
import type { ServiceClient } from "../../../../src/service-client.ts";
import { useWorkbench } from "../../client/use-workbench";
import { describeError, useT } from "../../i18n/locale";
import { useCopyFeedback } from "../../rich/use-copy-feedback";

const lastSegment = (path: string) =>
  path
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop() || path;
/** Each folder on the way to `path`, keeping the listing's own separators. */
function trail(path: string): { label: string; path: string }[] {
  return [...path.matchAll(/[^\\/]+/g)].map((match) => ({
    label: match[0],
    path: path.slice(0, match.index + match[0].length),
  }));
}

export function FilesPanel({
  client,
  enabled,
  location,
  observed = "",
  onReference,
}: {
  client: ServiceClient;
  enabled: boolean;
  location?: ConversationLocation;
  /** Changes when execution starts, stops or is replaced: the reads move
   * between the stopped-owner reader and the owner, so they are made again. */
  observed?: string;
  onReference(path: string): void;
}) {
  const { t } = useT();
  const [path, setPath] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [notice, setNotice] = useState("");
  // A name filter over the entries already listed; it reads nothing.
  const [filter, setFilter] = useState<string | null>(null);
  const [copiedPath, setCopiedPath] = useState("");
  const [help, setHelp] = useState(false);
  const { copied, copy } = useCopyFeedback();
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
  const { refresh: refreshFiles } = files,
    { refresh: refreshPreview } = preview;
  const lastObserved = useRef(observed);
  useEffect(() => {
    if (lastObserved.current === observed) return;
    lastObserved.current = observed;
    refreshFiles();
    refreshPreview();
  }, [observed, refreshFiles, refreshPreview]);
  const listing = files.value?.kind === "files" ? files.value : undefined;
  const file = preview.value?.kind === "file" ? preview.value : undefined;
  const open = (next: string) => {
    setPath(next);
    setFilter(null);
  };
  const query = filter?.trim().toLowerCase() ?? "";
  const entries = listing?.entries.filter(
    (entry) => !query || entry.name.toLowerCase().includes(query),
  );
  return (
    <div className="files-panel">
      <header className="panel-crumbs">
        <button
          type="button"
          className={`crumb${path ? "" : " active"}`}
          title={
            location
              ? `${t("Conversation folder:")} ${location.cwd}`
              : undefined
          }
          disabled={!location}
          onClick={() => open("")}
        >
          {location ? lastSegment(location.cwd) : t("Not observed")}
        </button>
        <button
          type="button"
          className="crumb"
          title={t("Refresh files")}
          aria-label={t("Refresh files")}
          disabled={!enabled}
          onClick={() => {
            files.refresh();
            preview.refresh();
          }}
        >
          <FiRefreshCw aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`crumb${filter === null ? "" : " active"}`}
          aria-label={t("Filter this folder…")}
          title={t("Filter this folder…")}
          aria-pressed={filter !== null}
          disabled={!listing}
          onClick={() => setFilter(filter === null ? "" : null)}
        >
          <FiSearch aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`crumb${help ? " active" : ""}`}
          aria-label={t("About this panel")}
          title={t("About this panel")}
          aria-expanded={help}
          onClick={() => setHelp((shown) => !shown)}
        >
          <FiHelpCircle aria-hidden="true" />
        </button>
        {trail(path).map((segment) => (
          <span className="crumb-seg" key={segment.path}>
            <FiChevronRight aria-hidden="true" />
            <button
              type="button"
              className={`crumb${segment.path === path ? " active" : ""}`}
              title={segment.path}
              onClick={() => open(segment.path)}
            >
              {segment.label}
            </button>
          </span>
        ))}
      </header>
      {help && (
        <p className="files-policy">
          {t("Readonly preview · references send paths, not file contents")}
        </p>
      )}
      {filter !== null && (
        <label className="file-filter">
          <FiSearch aria-hidden="true" />
          <input
            // biome-ignore lint/a11y/noAutofocus: opened by the filter button the user just pressed
            autoFocus
            value={filter}
            aria-label={t("Filter this folder…")}
            placeholder={t("Filter this folder…")}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setFilter(null);
            }}
          />
          <button
            type="button"
            className="crumb"
            aria-label={t("Close")}
            onClick={() => setFilter(null)}
          >
            <FiX aria-hidden="true" />
          </button>
        </label>
      )}
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
                ? "Files appear once this folder has been observed."
                : "The conversation folder has not been observed.",
            )}
          </p>
        ) : !listing && !files.error ? (
          <p className="panel-empty" role="status">
            {t("Reading files…")}
          </p>
        ) : null}
        {listing && listing.parent != null && !query && (
          <button
            type="button"
            className="file-item dir"
            aria-label={t("Parent folder")}
            title={t("Parent folder")}
            onClick={() => open(listing.parent ?? "")}
          >
            <FiFolder className="file-icon" aria-hidden="true" />
            <span className="file-name">..</span>
          </button>
        )}
        {entries?.map((entry) => (
          <div
            className={`file-item ${entry.directory ? "dir" : "file"}${selected === entry.path ? " selected" : ""}`}
            key={entry.path}
          >
            <button
              type="button"
              className="file-main"
              title={entry.path}
              onClick={() =>
                entry.directory ? open(entry.path) : setSelected(entry.path)
              }
            >
              {entry.directory ? (
                <FiFolder className="file-icon" aria-hidden="true" />
              ) : (
                <FiFile className="file-icon" aria-hidden="true" />
              )}
              <span className="file-name">{entry.name}</span>
            </button>
            <button
              type="button"
              className="file-attach"
              aria-label={t("Reference {path}", { path: entry.name })}
              title={t("Reference {path}", { path: entry.name })}
              disabled={!enabled || !!files.error}
              onClick={() => onReference(entry.path)}
            >
              <FiLink aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`file-attach${copied && copiedPath === entry.path ? " copied" : ""}`}
              aria-label={t("Copy path {path}", { path: entry.name })}
              title={t("Copy path {path}", { path: entry.name })}
              onClick={() => {
                setCopiedPath(entry.path);
                void copy(entry.path).then((ok) =>
                  setNotice(ok ? "" : t("Link copy unavailable.")),
                );
              }}
            >
              {copied && copiedPath === entry.path ? (
                <FiCheck aria-hidden="true" />
              ) : (
                <FiCopy aria-hidden="true" />
              )}
            </button>
          </div>
        ))}
        {enabled &&
          !files.error &&
          entries?.length === 0 &&
          (query ? (
            <p className="panel-empty">{t("No matching files")}</p>
          ) : (
            <p className="panel-empty">{t("No visible files")}</p>
          ))}
        {listing?.limited && (
          <p className="inspector-note">
            {t("Bounded listing; narrow the directory to see more.")}
          </p>
        )}
      </section>
      {selected && (
        <section className="file-preview">
          <header>
            <FiFile aria-hidden="true" />
            <span title={selected}>{lastSegment(selected)}</span>
            <button
              type="button"
              className="crumb"
              aria-label={t("Close preview")}
              title={t("Close preview")}
              onClick={() => setSelected(null)}
            >
              <FiX aria-hidden="true" />
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
    </div>
  );
}
