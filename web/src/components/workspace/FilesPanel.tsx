/* Adapted from pi-web-ui RightPanel.tsx: crumb toolbar, path trail, directory
 * rows with hover actions (download, reference path only, copy name, copy
 * path), name filter, readonly preview and path references.
 * MIT (c) 2026 xing-shuyin.
 * No file mutation, remote SSH, transfer, plugin widgets or set_cwd transport. */
import { memo, useEffect, useRef, useState } from "react";
import {
  FiCheck,
  FiChevronRight,
  FiClipboard,
  FiCopy,
  FiDownload,
  FiFile,
  FiFolder,
  FiHelpCircle,
  FiLink,
  FiRefreshCw,
  FiSearch,
  FiX,
} from "react-icons/fi";
import type { ConversationLocation } from "../../../../src/service/contracts/models.ts";
import type { FileEntry } from "../../../../src/service/contracts/workbench.ts";
import type { ServiceClient } from "../../../../src/service-client.ts";
import { readFileParts, saveBlob } from "../../client/file-download";
import { useWorkbench } from "../../client/use-workbench";
import { describeError, useT } from "../../i18n/locale";
import { dismissToasts, notify } from "../../layout/toasts";
import { fencedCode } from "../../rich/code-fence";
import { detectLanguage } from "../../rich/file-diff";
import { useCopyFeedback } from "../../rich/use-copy-feedback";
import { Markdown } from "../rich/Markdown";

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

/** An entry's full path on the service host, in the folder's own separators. */
export function hostPath(cwd: string, path: string): string {
  const separator = cwd.startsWith("/") ? "/" : "\\";
  return `${cwd.replace(/[\\/]+$/, "")}${separator}${path.split("/").join(separator)}`;
}
const DOWNLOAD_TOAST = "file-download";

/** A previewed file's text through the Markdown code renderer: numbered
 * lines, a copy action and the bundled highlighter for a known extension.
 * Memoized, so a panel re-render never highlights the same text again. */
export const FilePreviewText = memo(function FilePreviewText({
  path,
  text,
}: {
  path: string;
  text: string;
}) {
  return <Markdown text={fencedCode(text, detectLanguage(path))} />;
});

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
    [selected, setSelected] = useState<string | null>(null);
  // A name filter over the entries already listed; it reads nothing.
  const [filter, setFilter] = useState<string | null>(null);
  // Which row action last copied: `name:<path>` or `path:<path>`.
  const [copiedKey, setCopiedKey] = useState("");
  const [help, setHelp] = useState(false);
  const { copied, copy } = useCopyFeedback();
  // One download at a time; leaving the folder's conversation abandons it.
  const [downloading, setDownloading] = useState<string | null>(null);
  const downloadAbort = useRef<AbortController | null>(null);
  const cwd = location?.cwd,
    conversation = location?.id;
  useEffect(() => {
    void client;
    void cwd;
    void conversation;
    return () => {
      downloadAbort.current?.abort();
      downloadAbort.current = null;
      setDownloading(null);
    };
  }, [client, cwd, conversation]);
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
  const copyText = (key: string, text: string) => {
    setCopiedKey(key);
    void copy(text).then((ok) => {
      if (!ok) notify("error", t("Copy unavailable"));
    });
  };
  const download = (entry: FileEntry) => {
    const abort = new AbortController();
    downloadAbort.current = abort;
    setDownloading(entry.path);
    dismissToasts(DOWNLOAD_TOAST);
    void readFileParts(async (offset) => {
      const reply = await client.workbenchRead(
        {
          kind: "file-part",
          path: entry.path,
          offset,
          ...(location ? { location } : {}),
        },
        abort.signal,
      );
      if (abort.signal.aborted) throw new Error("unavailable");
      if (reply.kind === "error") throw new Error(reply.error.code);
      return reply.value;
    })
      .then((blob) => {
        if (abort.signal.aborted) return;
        return saveBlob(blob, entry.name);
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        const code = error instanceof Error ? error.message : String(error);
        notify(
          "error",
          t("Download of {path} failed: {error}", {
            path: entry.name,
            error:
              code === "oversize"
                ? t("the file is larger than the 64 MiB download limit")
                : describeError(t, code),
          }),
          DOWNLOAD_TOAST,
        );
      })
      .finally(() => {
        if (downloadAbort.current !== abort) return;
        downloadAbort.current = null;
        setDownloading(null);
      });
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
          {t(
            "Readonly preview · references send paths, not file contents · a download is the file's own bytes, unredacted",
          )}
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
            {!entry.directory && (
              <button
                type="button"
                className={`file-attach download${downloading === entry.path ? " busy" : ""}`}
                aria-label={t("Download file {path}", { path: entry.name })}
                title={t("Download file {path}", { path: entry.name })}
                aria-busy={downloading === entry.path}
                disabled={!enabled || !!files.error || downloading !== null}
                onClick={() => download(entry)}
              >
                <FiDownload aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              className="file-attach ref"
              aria-label={t(
                entry.directory
                  ? "Link folder path {path} to the chat"
                  : "Reference path only: {path} (the agent reads it on demand)",
                { path: entry.name },
              )}
              title={t(
                entry.directory
                  ? "Link folder path {path} to the chat"
                  : "Reference path only: {path} (the agent reads it on demand)",
                { path: entry.name },
              )}
              disabled={!enabled || !!files.error}
              onClick={() => onReference(entry.path)}
            >
              <FiLink aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`file-attach copy${copied && copiedKey === `name:${entry.path}` ? " copied" : ""}`}
              aria-label={t("Copy name {path}", { path: entry.name })}
              title={t("Copy name {path}", { path: entry.name })}
              onClick={() => copyText(`name:${entry.path}`, entry.name)}
            >
              {copied && copiedKey === `name:${entry.path}` ? (
                <FiCheck aria-hidden="true" />
              ) : (
                <FiCopy aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              className={`file-attach copy${copied && copiedKey === `path:${entry.path}` ? " copied" : ""}`}
              aria-label={t("Copy path {path}", { path: entry.name })}
              title={t("Copy path {path}", { path: entry.name })}
              onClick={() =>
                copyText(
                  `path:${entry.path}`,
                  location ? hostPath(location.cwd, entry.path) : entry.path,
                )
              }
            >
              {copied && copiedKey === `path:${entry.path}` ? (
                <FiCheck aria-hidden="true" />
              ) : (
                <FiClipboard aria-hidden="true" />
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
              <FilePreviewText path={file.path} text={file.text} />
              {file.limited && (
                <p className="inspector-note">
                  {t("File preview is limited; this is not the complete file.")}
                </p>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
