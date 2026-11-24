/* Adapted from pi-web-ui RightPanel.tsx: toolbar, path breadcrumbs, right-click
 * context menu, inline create/rename, cut/copy/paste/duplicate, drag-and-drop
 * upload, hidden-file toggle, recursive search tree, and inline text/image
 * preview & editing. MIT (c) 2026 xing-shuyin. */
import {
  Fragment,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FiCheck,
  FiChevronDown,
  FiChevronRight,
  FiClipboard,
  FiCopy,
  FiDownload,
  FiEdit2,
  FiEye,
  FiEyeOff,
  FiFile,
  FiFilePlus,
  FiFolder,
  FiFolderPlus,
  FiHome,
  FiLink,
  FiMoreHorizontal,
  FiRefreshCw,
  FiSave,
  FiScissors,
  FiSearch,
  FiTrash2,
  FiUpload,
  FiX,
} from "react-icons/fi";
import type { ConversationLocation } from "../../../../src/service/contracts/models.ts";
import {
  breadcrumbsFor,
  buildSearchTree,
  createUserFilesClient,
  formatFileSize,
  hostPath,
  isAbsolutePath,
  isHiddenName,
  isProtectedRootPath,
  lastSegment,
  MACHINE_ROOT,
  normalizeWireDir,
  parentWireOf,
  renameSelectionRange,
  type SearchTreeNode,
  type UserFileEntry,
  type UserFileListing,
  type UserFileReadResult,
  type UserFileSearchHit,
  type UserFilesClient,
} from "../../client/user-files";
import { type Translator, useT } from "../../i18n/locale";
import { notify } from "../../layout/toasts";
import { fencedCode } from "../../rich/code-fence";
import { detectLanguage } from "../../rich/file-diff";
import { copyTextToClipboard } from "../../rich/use-copy-feedback";
import { ActionDialog } from "../actions/ActionDialog";
import { Markdown } from "../rich/Markdown";
import { ContextMenu, type ContextMenuItem } from "../ui/ContextMenu";

export { hostPath };

const LS_SHOW_HIDDEN = "cadence:files-show-hidden";

function readShowHidden(): boolean {
  try {
    return localStorage.getItem(LS_SHOW_HIDDEN) === "1";
  } catch {
    return false;
  }
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

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

export type FileMenuTarget =
  | { kind: "file"; entry: UserFileEntry }
  | { kind: "dir"; entry: UserFileEntry }
  | { kind: "list"; dir: string; label: string };

export interface FileMenuActions {
  onPreview(entry: UserFileEntry): void;
  onOpenDir(path: string): void;
  onDownload(entry: UserFileEntry): void;
  onReference(entry: UserFileEntry): void;
  onCreate(dir: string, dirLabel: string | null, kind: "file" | "dir"): void;
  onUpload(dir: string): void;
  onPaste(destDir: string): void;
  onRename(entry: UserFileEntry): void;
  onDuplicate(entry: UserFileEntry): void;
  onCut(entry: UserFileEntry): void;
  onCopy(entry: UserFileEntry): void;
  onCopyName(entry: UserFileEntry): void;
  onCopyFullPath(entry: UserFileEntry): void;
  onCopyRelativePath(entry: UserFileEntry): void;
  onDelete(entry: UserFileEntry): void;
  onRefresh(): void;
}

/** Build context menu items for a file row, folder row, or blank list area. */
export function buildFileMenuItems(
  target: FileMenuTarget,
  opts: {
    currentPath: string;
    hasClipboard: boolean;
    t: Translator["t"];
    actions: FileMenuActions;
  },
): ContextMenuItem[] {
  const { currentPath, hasClipboard, t, actions } = opts;
  const items: ContextMenuItem[] = [];

  if (target.kind === "list") {
    const canCreateHere = currentPath !== MACHINE_ROOT;
    if (canCreateHere) {
      items.push(
        {
          id: "new-file",
          group: "new",
          label: t("New file"),
          icon: <FiFilePlus />,
          onSelect: () => actions.onCreate(currentPath, null, "file"),
        },
        {
          id: "new-dir",
          group: "new",
          label: t("New folder"),
          icon: <FiFolderPlus />,
          onSelect: () => actions.onCreate(currentPath, null, "dir"),
        },
        {
          id: "upload",
          group: "new",
          label: t("Upload files to this folder"),
          icon: <FiUpload />,
          onSelect: () => actions.onUpload(currentPath),
        },
      );
      if (hasClipboard) {
        items.push({
          id: "paste",
          group: "new",
          label: t("Paste"),
          icon: <FiClipboard />,
          onSelect: () => actions.onPaste(currentPath),
        });
      }
    }
    items.push({
      id: "refresh",
      group: "view",
      label: t("Refresh"),
      icon: <FiRefreshCw />,
      onSelect: actions.onRefresh,
    });
    return items;
  }

  const { entry } = target;
  const isDir = target.kind === "dir";
  const protectedRoot = isProtectedRootPath(entry.path);
  const absolute = isAbsolutePath(entry.path);

  if (isDir) {
    items.push({
      id: "enter",
      group: "open",
      label: t("Open folder"),
      icon: <FiFolder />,
      onSelect: () => actions.onOpenDir(entry.path),
    });
  } else {
    items.push(
      {
        id: "open",
        group: "open",
        label: t("Open preview"),
        icon: <FiFile />,
        onSelect: () => actions.onPreview(entry),
      },
      {
        id: "download",
        group: "open",
        label: t("Download"),
        icon: <FiDownload />,
        onSelect: () => actions.onDownload(entry),
      },
    );
  }

  if (isDir && entry.path !== MACHINE_ROOT) {
    items.push(
      {
        id: "new-file",
        group: "new",
        label: t("New file"),
        icon: <FiFilePlus />,
        onSelect: () => actions.onCreate(entry.path, entry.name, "file"),
      },
      {
        id: "new-dir",
        group: "new",
        label: t("New folder"),
        icon: <FiFolderPlus />,
        onSelect: () => actions.onCreate(entry.path, entry.name, "dir"),
      },
      {
        id: "upload",
        group: "new",
        label: t("Upload files to this folder"),
        icon: <FiUpload />,
        onSelect: () => actions.onUpload(entry.path),
      },
    );
    if (hasClipboard) {
      items.push({
        id: "paste",
        group: "new",
        label: t("Paste"),
        icon: <FiClipboard />,
        onSelect: () => actions.onPaste(entry.path),
      });
    }
  }

  if (entry.path !== MACHINE_ROOT) {
    items.push({
      id: "reference",
      group: "chat",
      label: isDir
        ? t("Link folder path to chat")
        : t("Reference path to chat"),
      icon: <FiLink />,
      onSelect: () => actions.onReference(entry),
    });
  }

  if (!protectedRoot) {
    items.push(
      {
        id: "rename",
        group: "edit",
        label: t("Rename"),
        shortcut: "F2",
        icon: <FiEdit2 />,
        onSelect: () => actions.onRename(entry),
      },
      {
        id: "duplicate",
        group: "edit",
        label: t("Duplicate"),
        icon: <FiCopy />,
        onSelect: () => actions.onDuplicate(entry),
      },
      {
        id: "cut",
        group: "edit",
        label: t("Cut"),
        icon: <FiScissors />,
        onSelect: () => actions.onCut(entry),
      },
      {
        id: "copy",
        group: "edit",
        label: t("Copy"),
        icon: <FiCopy />,
        onSelect: () => actions.onCopy(entry),
      },
    );
  }

  items.push(
    {
      id: "copy-name",
      group: "clipboard",
      label: t("Copy name"),
      icon: <FiCopy />,
      onSelect: () => actions.onCopyName(entry),
    },
    {
      id: "copy-path",
      group: "clipboard",
      label: t("Copy full path"),
      icon: <FiClipboard />,
      onSelect: () => actions.onCopyFullPath(entry),
    },
  );
  if (!absolute && entry.path !== MACHINE_ROOT) {
    items.push({
      id: "copy-rel",
      group: "clipboard",
      label: t("Copy relative path"),
      icon: <FiClipboard />,
      onSelect: () => actions.onCopyRelativePath(entry),
    });
  }

  if (!protectedRoot) {
    items.push({
      id: "delete",
      group: "danger",
      label: t("Delete"),
      icon: <FiTrash2 />,
      danger: true,
      onSelect: () => actions.onDelete(entry),
    });
  }

  return items;
}

interface UploadItem {
  id: string;
  name: string;
  dir: string;
  phase: "uploading" | "done" | "error";
  percent: number;
  error?: string;
}

function InlineNameForm({
  icon,
  prefix,
  value,
  placeholder,
  ariaLabel,
  selectionRange,
  busy,
  onChange,
  onSubmit,
  onCancel,
}: {
  icon: ReactNode;
  prefix?: string | null;
  value: string;
  placeholder: string;
  ariaLabel: string;
  selectionRange?: [number, number];
  busy?: boolean;
  onChange(value: string): void;
  onSubmit(): void;
  onCancel(): void;
}) {
  const { t } = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const initialRange = useRef(selectionRange);
  const prevBusy = useRef(Boolean(busy));

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    if (initialRange.current) {
      input.setSelectionRange(initialRange.current[0], initialRange.current[1]);
    }
  }, []);

  useEffect(() => {
    if (prevBusy.current && !busy) {
      inputRef.current?.focus({ preventScroll: true });
    }
    prevBusy.current = Boolean(busy);
  }, [busy]);

  return (
    <form
      className="file-item file-inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) onSubmit();
      }}
      onBlur={(event) => {
        if (busy) return;
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          onCancel();
        }
      }}
    >
      <span className="file-icon" aria-hidden="true">
        {icon}
      </span>
      {prefix ? (
        <span className="file-target-prefix" title={prefix}>
          {prefix}/
        </span>
      ) : null}
      <input
        ref={inputRef}
        className="file-inline-input"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        readOnly={busy}
        onChange={(event) => {
          if (!busy) onChange(event.target.value);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape" && !busy) {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <button
        type="submit"
        className="file-inline-btn confirm"
        disabled={busy}
        aria-label={t("Confirm")}
        title={t("Confirm")}
        onMouseDown={(event) => event.preventDefault()}
      >
        <FiCheck aria-hidden="true" />
      </button>
      <button
        type="button"
        className="file-inline-btn cancel"
        disabled={busy}
        aria-label={t("Cancel")}
        title={t("Cancel")}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onCancel}
      >
        <FiX aria-hidden="true" />
      </button>
    </form>
  );
}

function findSearchNodeEntry(
  nodes: readonly SearchTreeNode[],
  targetPath: string,
): UserFileEntry | null {
  for (const node of nodes) {
    if (node.path === targetPath) {
      return {
        name: node.name,
        path: node.path,
        directory: node.directory,
      };
    }
    if (node.children.length > 0) {
      const nested = findSearchNodeEntry(node.children, targetPath);
      if (nested) return nested;
    }
  }
  return null;
}

function SearchTreeRows({
  nodes,
  depth,
  collapsed,
  selected,
  cutSrc,
  renaming,
  renameDraft,
  renameBusy,
  onToggle,
  onOpenDir,
  onOpenFile,
  onStartRename,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  onContextMenu,
}: {
  nodes: readonly SearchTreeNode[];
  depth: number;
  collapsed: readonly string[];
  selected: string | null;
  cutSrc: string | null;
  renaming: UserFileEntry | null;
  renameDraft: string;
  renameBusy: boolean;
  onToggle(path: string): void;
  onOpenDir(path: string): void;
  onOpenFile(path: string): void;
  onStartRename(entry: UserFileEntry): void;
  onRenameChange(value: string): void;
  onRenameSubmit(): void;
  onRenameCancel(): void;
  onContextMenu(event: React.MouseEvent, entry: UserFileEntry): void;
}) {
  const { t } = useT();
  return (
    <>
      {nodes.map((node) => {
        const entry: UserFileEntry = {
          name: node.name,
          path: node.path,
          directory: node.directory,
        };
        const isCollapsed = collapsed.includes(node.path);
        const isRenaming = renaming?.path === node.path;
        const isCut = cutSrc === node.path;
        return (
          <Fragment key={node.path || node.name}>
            {isRenaming ? (
              <InlineNameForm
                icon={node.directory ? <FiFolder /> : <FiFile />}
                value={renameDraft}
                placeholder={node.name}
                ariaLabel={t("Rename")}
                selectionRange={renameSelectionRange(node.name, node.directory)}
                busy={renameBusy}
                onChange={onRenameChange}
                onSubmit={onRenameSubmit}
                onCancel={onRenameCancel}
              />
            ) : node.directory ? (
              <div
                className={`file-item dir${isCut ? " cut" : ""}`}
                data-type="dir"
                data-path={node.path}
                style={{ paddingLeft: 4 + depth * 12 }}
              >
                <button
                  type="button"
                  className="file-tree-toggle"
                  aria-label={node.path}
                  aria-expanded={!isCollapsed}
                  onClick={() => onToggle(node.path)}
                  onContextMenu={(event) => onContextMenu(event, entry)}
                >
                  {isCollapsed ? (
                    <FiChevronRight aria-hidden="true" />
                  ) : (
                    <FiChevronDown aria-hidden="true" />
                  )}
                </button>
                <button
                  type="button"
                  className="file-main"
                  title={node.path}
                  onClick={() => onOpenDir(node.path)}
                  onContextMenu={(event) => onContextMenu(event, entry)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "F2" &&
                      !isProtectedRootPath(entry.path)
                    ) {
                      event.preventDefault();
                      onStartRename(entry);
                    }
                  }}
                >
                  <FiFolder className="file-icon" aria-hidden="true" />
                  <span className={`file-name${node.matched ? "" : " muted"}`}>
                    {node.name}
                  </span>
                </button>
              </div>
            ) : (
              <div
                className={`file-item file${selected === node.path ? " selected" : ""}${isCut ? " cut" : ""}`}
                data-type="file"
                data-path={node.path}
                style={{ paddingLeft: 16 + depth * 12 }}
              >
                <button
                  type="button"
                  className="file-main"
                  title={node.path}
                  onClick={() => onOpenFile(node.path)}
                  onContextMenu={(event) => onContextMenu(event, entry)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "F2" &&
                      !isProtectedRootPath(entry.path)
                    ) {
                      event.preventDefault();
                      onStartRename(entry);
                    }
                  }}
                >
                  <FiFile className="file-icon" aria-hidden="true" />
                  <span className="file-name">{node.name}</span>
                </button>
              </div>
            )}
            {node.directory && !isCollapsed && (
              <SearchTreeRows
                nodes={node.children}
                depth={depth + 1}
                collapsed={collapsed}
                selected={selected}
                cutSrc={cutSrc}
                renaming={renaming}
                renameDraft={renameDraft}
                renameBusy={renameBusy}
                onToggle={onToggle}
                onOpenDir={onOpenDir}
                onOpenFile={onOpenFile}
                onStartRename={onStartRename}
                onRenameChange={onRenameChange}
                onRenameSubmit={onRenameSubmit}
                onRenameCancel={onRenameCancel}
                onContextMenu={onContextMenu}
              />
            )}
          </Fragment>
        );
      })}
    </>
  );
}

export function FilesPanel({
  cwd: explicitCwd,
  location,
  home: providedHome,
  csrf,
  observed = "",
  filesClient: providedClient,
  initialListing,
  initialPreview,
  initialError,
  onReference,
}: {
  /** Base conversation directory; defaults to `location?.cwd`. */
  cwd?: string;
  location?: ConversationLocation;
  home?: string;
  csrf?: string;
  /** Triggers a quiet refresh when execution starts/stops/changes. */
  observed?: string;
  filesClient?: UserFilesClient;
  /** Optional initial state for SSR/unit tests. */
  initialListing?: UserFileListing;
  initialPreview?: UserFileReadResult;
  initialError?: string;
  onReference(path: string): void;
}) {
  const { t } = useT();
  const baseCwd = explicitCwd ?? location?.cwd ?? "";
  const csrfRef = useRef(csrf);
  csrfRef.current = csrf;

  const client = useMemo(
    () => providedClient ?? createUserFilesClient(() => csrfRef.current),
    [providedClient],
  );

  const [homeDir, setHomeDir] = useState(
    providedHome ? normalizeWireDir(providedHome) : "",
  );
  useEffect(() => {
    if (providedHome) setHomeDir(normalizeWireDir(providedHome));
  }, [providedHome]);

  useEffect(() => {
    if (homeDir) return;
    const abort = new AbortController();
    void client
      .meta(abort.signal)
      .then((meta) => {
        if (!abort.signal.aborted && meta.home)
          setHomeDir(normalizeWireDir(meta.home));
      })
      .catch(() => {});
    return () => abort.abort();
  }, [client, homeDir]);

  const normBaseCwd = useMemo(
    () => (baseCwd ? normalizeWireDir(baseCwd) : ""),
    [baseCwd],
  );

  const [currentPath, setCurrentPath] = useState("");
  const [selected, setSelected] = useState<string | null>(
    initialPreview?.path ?? null,
  );
  const [previewDirty, setPreviewDirty] = useState(false);
  const [pendingSelected, setPendingSelected] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(readShowHidden);
  const [searching, setSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<UserFileSearchHit[]>([]);
  const [searchTruncated, setSearchTruncated] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [collapsedDirs, setCollapsedDirs] = useState<string[]>([]);

  const [listingState, setListingState] = useState<
    { requestedPath: string; data: UserFileListing } | undefined
  >(
    initialListing
      ? { requestedPath: initialListing.path, data: initialListing }
      : undefined,
  );
  const listing =
    listingState && listingState.requestedPath === currentPath
      ? listingState.data
      : undefined;
  const [listError, setListError] = useState<string | null>(
    initialError ?? null,
  );
  const [listVersion, setListVersion] = useState(0);

  const [previewData, setPreviewData] = useState<
    UserFileReadResult | undefined
  >(initialPreview);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewVersion, setPreviewVersion] = useState(0);

  const [clipboard, setClipboard] = useState<{
    src: string;
    cut: boolean;
  } | null>(null);
  const [creating, setCreating] = useState<{
    dir: string;
    dirLabel: string | null;
    kind: "file" | "dir";
  } | null>(null);
  const [createDraft, setCreateDraft] = useState("");
  const [createBusy, setCreateBusy] = useState(false);

  const [renaming, setRenaming] = useState<UserFileEntry | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);

  const [deleting, setDeleting] = useState<UserFileEntry | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    target: FileMenuTarget;
  } | null>(null);

  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const uploadDirRef = useRef<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLElement>(null);
  const mountedRef = useRef(true);
  const uploadTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const timer of uploadTimersRef.current) clearTimeout(timer);
      uploadTimersRef.current.clear();
    };
  }, []);

  const toggleShowHidden = () => {
    setShowHidden((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(LS_SHOW_HIDDEN, next ? "1" : "0");
      } catch {}
      return next;
    });
  };

  const refreshAll = useCallback(() => {
    setListVersion((v) => v + 1);
    setPreviewVersion((v) => v + 1);
  }, []);

  const lastObserved = useRef(observed);
  useEffect(() => {
    if (lastObserved.current === observed) return;
    lastObserved.current = observed;
    refreshAll();
  }, [observed, refreshAll]);

  // Fetch directory listing
  useEffect(() => {
    void listVersion;
    if (!baseCwd) return;
    const requestedPath = currentPath;
    const abort = new AbortController();
    setListError(null);
    void client
      .list(baseCwd, requestedPath, abort.signal)
      .then((next) => {
        if (abort.signal.aborted) return;
        setListingState({ requestedPath, data: next });
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        setListError(errorMessage(error, t("Failed to list directory")));
      });
    return () => abort.abort();
  }, [baseCwd, currentPath, listVersion, client, t]);

  // Fetch selected file preview
  useEffect(() => {
    void previewVersion;
    if (!baseCwd || !selected) {
      setPreviewData(undefined);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }
    const abort = new AbortController();
    setPreviewLoading(true);
    setPreviewError(null);
    void client
      .read(baseCwd, selected, abort.signal)
      .then((next) => {
        if (abort.signal.aborted) return;
        setPreviewData(next);
        setPreviewLoading(false);
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        setPreviewData(undefined);
        setPreviewError(errorMessage(error, t("Failed to read file")));
        setPreviewLoading(false);
      });
    return () => abort.abort();
  }, [baseCwd, selected, previewVersion, client, t]);

  // Debounced recursive search
  const trimmedSearch = searchQuery.trim();
  useEffect(() => {
    void trimmedSearch;
    void currentPath;
    void showHidden;
    setCollapsedDirs([]);
  }, [trimmedSearch, currentPath, showHidden]);

  useEffect(() => {
    void listVersion;
    if (!baseCwd || !trimmedSearch) {
      setSearchHits([]);
      setSearchTruncated(false);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void client
        .search(baseCwd, trimmedSearch, currentPath, showHidden, abort.signal)
        .then((res) => {
          if (abort.signal.aborted) return;
          setSearchHits(res.results);
          setSearchTruncated(res.truncated);
          setSearchLoading(false);
        })
        .catch(() => {
          if (abort.signal.aborted) return;
          setSearchHits([]);
          setSearchLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [baseCwd, trimmedSearch, currentPath, showHidden, listVersion, client]);

  const searchTree = useMemo(
    () => (trimmedSearch ? buildSearchTree(searchHits, currentPath) : []),
    [trimmedSearch, searchHits, currentPath],
  );

  const navigateTo = useCallback(
    (nextPath: string) => {
      const normalized = normalizeWireDir(nextPath);
      const wire = normBaseCwd && normalized === normBaseCwd ? "" : normalized;
      setCurrentPath(wire);
      setCreating(null);
      setRenaming(null);
      setSearching(false);
      setSearchQuery("");
    },
    [normBaseCwd],
  );

  const openFilePreview = useCallback(
    (filePath: string) => {
      if (selected === filePath) {
        setPendingSelected(null);
        setPreviewVersion((v) => v + 1);
        return;
      }
      if (previewDirty) {
        setPendingSelected(filePath);
        return;
      }
      setPendingSelected(null);
      setSelected(filePath);
    },
    [selected, previewDirty],
  );

  const triggerDownload = useCallback(
    (entry: UserFileEntry) => {
      if (!baseCwd) return;
      const url = client.rawUrl(baseCwd, entry.path, true);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = entry.name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    },
    [baseCwd, client],
  );

  const copyWithFeedback = useCallback(
    (text: string) => {
      void copyTextToClipboard(text).then((ok) => {
        if (ok) notify("info", t("Copied to clipboard"));
        else notify("error", t("Copy unavailable"));
      });
    },
    [t],
  );

  const uploadFiles = useCallback(
    (dir: string, files: File[]) => {
      if (!baseCwd || files.length === 0) return;
      for (const file of files) {
        const id = crypto.randomUUID();
        setUploads((rows) => [
          ...rows,
          { id, name: file.name, dir, phase: "uploading", percent: 0 },
        ]);
        void client
          .upload(baseCwd, dir, file, (percent) => {
            if (!mountedRef.current) return;
            setUploads((rows) =>
              rows.map((r) => (r.id === id ? { ...r, percent } : r)),
            );
          })
          .then(() => {
            if (!mountedRef.current) return;
            setUploads((rows) =>
              rows.map((r) =>
                r.id === id ? { ...r, phase: "done", percent: 100 } : r,
              ),
            );
            setListVersion((v) => v + 1);
            const timer = setTimeout(() => {
              uploadTimersRef.current.delete(timer);
              if (!mountedRef.current) return;
              setUploads((rows) => rows.filter((r) => r.id !== id));
            }, 2500);
            uploadTimersRef.current.add(timer);
          })
          .catch((error: unknown) => {
            if (!mountedRef.current) return;
            const msg = errorMessage(error, t("Upload failed"));
            setUploads((rows) =>
              rows.map((r) =>
                r.id === id ? { ...r, phase: "error", error: msg } : r,
              ),
            );
            notify(
              "error",
              t("Upload of {name} failed: {error}", {
                name: file.name,
                error: msg,
              }),
            );
          });
      }
    },
    [baseCwd, client, t],
  );

  const startUploadPicker = useCallback((dir: string) => {
    uploadDirRef.current = dir;
    if (fileInputRef.current) fileInputRef.current.value = "";
    fileInputRef.current?.click();
  }, []);

  const startCreate = useCallback(
    (dir: string, dirLabel: string | null, kind: "file" | "dir") => {
      setRenaming(null);
      setCreateDraft("");
      setCreating({ dir, dirLabel, kind });
    },
    [],
  );

  const submitCreate = useCallback(() => {
    if (!baseCwd || !creating || createBusy) return;
    const name = createDraft.trim();
    if (!name) {
      setCreating(null);
      return;
    }
    const kind = creating.kind;
    setCreateBusy(true);
    void client
      .create(baseCwd, creating.dir, name, kind)
      .then((created) => {
        if (!mountedRef.current) return;
        setCreating(null);
        setCreateDraft("");
        setListVersion((v) => v + 1);
        notify(
          "info",
          t(
            kind === "dir" ? "Folder created: {name}" : "File created: {name}",
            {
              name: created.name,
            },
          ),
        );
      })
      .catch((error: unknown) => {
        if (!mountedRef.current) return;
        notify(
          "error",
          t("Create failed: {error}", {
            error: errorMessage(error, t("Invalid name")),
          }),
        );
      })
      .finally(() => {
        if (mountedRef.current) setCreateBusy(false);
      });
  }, [baseCwd, creating, createBusy, createDraft, client, t]);

  const startRename = useCallback((entry: UserFileEntry) => {
    if (isProtectedRootPath(entry.path)) return;
    setCreating(null);
    setRenameDraft(entry.name);
    setRenaming(entry);
  }, []);

  const submitRename = useCallback(() => {
    if (!baseCwd || !renaming || renameBusy) return;
    const nextName = renameDraft.trim();
    if (!nextName || nextName === renaming.name) {
      setRenaming(null);
      return;
    }
    const oldPath = renaming.path;
    const isDir = renaming.directory;
    setRenameBusy(true);
    void client
      .rename(baseCwd, oldPath, nextName)
      .then((renamed) => {
        if (!mountedRef.current) return;
        setRenaming(null);
        setPendingSelected(null);
        setListVersion((v) => v + 1);
        setSelected((prev) => {
          if (!prev) return prev;
          if (prev === oldPath) {
            setPreviewVersion((v) => v + 1);
            return renamed.path;
          }
          if (isDir && prev.startsWith(`${oldPath}/`)) {
            setPreviewVersion((v) => v + 1);
            return `${renamed.path}${prev.slice(oldPath.length)}`;
          }
          return prev;
        });
        setClipboard((prev) =>
          prev && prev.src === oldPath ? { ...prev, src: renamed.path } : prev,
        );
        notify("info", t("Renamed to {name}", { name: renamed.name }));
      })
      .catch((error: unknown) => {
        if (!mountedRef.current) return;
        notify(
          "error",
          t("Rename failed: {error}", {
            error: errorMessage(error, t("Invalid name")),
          }),
        );
      })
      .finally(() => {
        if (mountedRef.current) setRenameBusy(false);
      });
  }, [baseCwd, renaming, renameBusy, renameDraft, client, t]);

  const runCopyOrMove = useCallback(
    (src: string, destDir: string, move: boolean) => {
      if (!baseCwd) return;
      void client
        .copy(baseCwd, src, destDir, move)
        .then((res) => {
          if (!mountedRef.current) return;
          if (move) {
            setClipboard(null);
            setPendingSelected(null);
            setSelected((prev) => {
              if (!prev) return prev;
              if (prev === src) {
                setPreviewVersion((v) => v + 1);
                return res.path;
              }
              if (prev.startsWith(`${src}/`)) {
                setPreviewVersion((v) => v + 1);
                return `${res.path}${prev.slice(src.length)}`;
              }
              return prev;
            });
          }
          setListVersion((v) => v + 1);
          notify(
            "info",
            t(move ? "Moved {name}" : "Copied {name}", { name: res.name }),
          );
        })
        .catch((error: unknown) => {
          if (!mountedRef.current) return;
          notify(
            "error",
            t(move ? "Move failed: {error}" : "Copy failed: {error}", {
              error: errorMessage(error, t("Operation failed")),
            }),
          );
        });
    },
    [baseCwd, client, t],
  );

  const confirmDelete = useCallback(() => {
    if (!baseCwd || !deleting || deleteBusy) return;
    const target = deleting;
    setDeleteBusy(true);
    void client
      .remove(baseCwd, target.path)
      .then(() => {
        if (!mountedRef.current) return;
        setDeleting(null);
        setClipboard((prev) => (prev?.src === target.path ? null : prev));
        setPendingSelected((prev) =>
          prev && (prev === target.path || prev.startsWith(`${target.path}/`))
            ? null
            : prev,
        );
        setSelected((prev) => {
          if (!prev) return prev;
          if (prev === target.path || prev.startsWith(`${target.path}/`)) {
            setPreviewDirty(false);
            return null;
          }
          return prev;
        });
        setListVersion((v) => v + 1);
        notify("info", t("Deleted {name}", { name: target.name }));
      })
      .catch((error: unknown) => {
        if (!mountedRef.current) return;
        notify(
          "error",
          t("Delete failed: {error}", {
            error: errorMessage(error, t("Operation failed")),
          }),
        );
      })
      .finally(() => {
        if (mountedRef.current) setDeleteBusy(false);
      });
  }, [baseCwd, deleting, deleteBusy, client, t]);

  const savePreviewText = useCallback(
    async (filePath: string, text: string) => {
      if (!baseCwd) throw new Error("No folder");
      const saved = await client.write(baseCwd, filePath, text);
      if (!mountedRef.current) return;
      setPreviewData((prev) =>
        prev && prev.path === filePath && prev.kind === "text"
          ? {
              ...prev,
              text,
              size: saved.size,
              limited: false,
              editable: true,
            }
          : prev,
      );
      setPreviewDirty(false);
      setPreviewVersion((v) => v + 1);
      setListVersion((v) => v + 1);
      notify("info", t("Saved {name}", { name: lastSegment(filePath) }));
    },
    [baseCwd, client, t],
  );

  const menuActions = useMemo<FileMenuActions>(
    () => ({
      onPreview: (entry) => openFilePreview(entry.path),
      onOpenDir: (path) => navigateTo(path),
      onDownload: triggerDownload,
      onReference: (entry) => onReference(entry.path),
      onCreate: startCreate,
      onUpload: startUploadPicker,
      onPaste: (destDir) => {
        if (!clipboard) return;
        runCopyOrMove(clipboard.src, destDir, clipboard.cut);
      },
      onRename: startRename,
      onDuplicate: (entry) =>
        runCopyOrMove(entry.path, parentWireOf(entry.path), false),
      onCut: (entry) => setClipboard({ src: entry.path, cut: true }),
      onCopy: (entry) => setClipboard({ src: entry.path, cut: false }),
      onCopyName: (entry) => copyWithFeedback(entry.name),
      onCopyFullPath: (entry) =>
        copyWithFeedback(baseCwd ? hostPath(baseCwd, entry.path) : entry.path),
      onCopyRelativePath: (entry) => copyWithFeedback(entry.path),
      onDelete: (entry) => setDeleting(entry),
      onRefresh: refreshAll,
    }),
    [
      openFilePreview,
      navigateTo,
      triggerDownload,
      onReference,
      startCreate,
      startUploadPicker,
      clipboard,
      runCopyOrMove,
      startRename,
      copyWithFeedback,
      baseCwd,
      refreshAll,
    ],
  );

  const openContextMenu = useCallback(
    (event: React.MouseEvent, target: FileMenuTarget) => {
      if (!baseCwd) return;
      event.preventDefault();
      event.stopPropagation();
      setMenu({ x: event.clientX, y: event.clientY, target });
    },
    [baseCwd],
  );

  const openButtonMenu = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, target: FileMenuTarget) => {
      if (!baseCwd) return;
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      setMenu({ x: rect.right, y: rect.bottom + 2, target });
    },
    [baseCwd],
  );

  // Drag-and-drop file upload onto blank list or a specific folder row
  const isFileDrag = (event: React.DragEvent) =>
    Array.from(event.dataTransfer?.types ?? []).includes("Files");

  const clearDropHighlight = useCallback(() => {
    listRef.current
      ?.querySelectorAll(".file-item.drop-target")
      .forEach((el) => {
        el.classList.remove("drop-target");
      });
    listRef.current?.classList.remove("drop-root");
  }, []);

  const dropTargetDir = (target: EventTarget | null): string => {
    const row =
      target instanceof Element
        ? (target.closest(".file-item") as HTMLElement | null)
        : null;
    if (row?.dataset.type === "dir" && row.dataset.path !== undefined)
      return row.dataset.path;
    return currentPath;
  };

  const applyDropHighlight = (dir: string) => {
    clearDropHighlight();
    if (dir !== currentPath) {
      const escaped =
        typeof CSS !== "undefined" && typeof CSS.escape === "function"
          ? CSS.escape(dir)
          : dir.replaceAll('"', '\\"');
      const row = listRef.current?.querySelector(
        `.file-item[data-path="${escaped}"]`,
      );
      if (row) {
        row.classList.add("drop-target");
        return;
      }
    }
    listRef.current?.classList.add("drop-root");
  };

  const visibleEntries = useMemo(() => {
    if (!listing) return undefined;
    return showHidden
      ? listing.entries
      : listing.entries.filter((entry) => !isHiddenName(entry.name));
  }, [listing, showHidden]);

  const crumbs = useMemo(
    () => breadcrumbsFor(baseCwd || undefined, currentPath, t("Not observed")),
    [baseCwd, currentPath, t],
  );

  const atHome =
    !!homeDir &&
    (currentPath === homeDir ||
      currentPath.startsWith(`${homeDir}/`) ||
      (currentPath === "" && normBaseCwd === homeDir));
  const atProject = !isAbsolutePath(currentPath);

  const menuItems = useMemo(
    () =>
      menu
        ? buildFileMenuItems(menu.target, {
            currentPath,
            hasClipboard: !!clipboard,
            t,
            actions: menuActions,
          })
        : [],
    [menu, currentPath, clipboard, t, menuActions],
  );

  const canMutateHere = !!baseCwd && currentPath !== MACHINE_ROOT;

  return (
    <div className="files-panel">
      <header className="panel-crumbs files-toolbar">
        <button
          type="button"
          className={`crumb${atProject && baseCwd ? " active" : ""}`}
          title={
            baseCwd ? `${t("Project folder:")} ${baseCwd}` : t("Project folder")
          }
          aria-label={t("Project folder")}
          disabled={!baseCwd}
          onClick={() => navigateTo("")}
        >
          <FiFolder aria-hidden="true" />
        </button>
        {homeDir ? (
          <button
            type="button"
            className={`crumb${atHome && !atProject ? " active" : ""}`}
            title={`${t("Home folder:")} ${homeDir}`}
            aria-label={t("Home folder")}
            disabled={!baseCwd}
            onClick={() => navigateTo(homeDir)}
          >
            <FiHome aria-hidden="true" />
          </button>
        ) : null}
        <span className="files-toolbar-spacer" />
        <button
          type="button"
          className="crumb"
          title={t("New file")}
          aria-label={t("New file")}
          disabled={!canMutateHere}
          onClick={() => startCreate(currentPath, null, "file")}
        >
          <FiFilePlus aria-hidden="true" />
        </button>
        <button
          type="button"
          className="crumb"
          title={t("New folder")}
          aria-label={t("New folder")}
          disabled={!canMutateHere}
          onClick={() => startCreate(currentPath, null, "dir")}
        >
          <FiFolderPlus aria-hidden="true" />
        </button>
        <button
          type="button"
          className="crumb"
          title={t("Upload files to this folder")}
          aria-label={t("Upload files to this folder")}
          disabled={!canMutateHere}
          onClick={() => startUploadPicker(currentPath)}
        >
          <FiUpload aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`crumb${showHidden ? " active" : ""}`}
          title={showHidden ? t("Hide hidden files") : t("Show hidden files")}
          aria-label={
            showHidden ? t("Hide hidden files") : t("Show hidden files")
          }
          aria-pressed={showHidden}
          onClick={toggleShowHidden}
        >
          {showHidden ? (
            <FiEye aria-hidden="true" />
          ) : (
            <FiEyeOff aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          className={`crumb${searching ? " active" : ""}`}
          title={t("Search files…")}
          aria-label={t("Search files…")}
          aria-pressed={searching}
          disabled={!baseCwd}
          onClick={() => {
            if (searching) setSearchQuery("");
            setSearching((v) => !v);
          }}
        >
          <FiSearch aria-hidden="true" />
        </button>
        <button
          type="button"
          className="crumb"
          title={t("Refresh files")}
          aria-label={t("Refresh files")}
          disabled={!baseCwd}
          onClick={refreshAll}
        >
          <FiRefreshCw aria-hidden="true" />
        </button>
      </header>

      <div className="panel-crumbs files-pathrow">
        {searching ? (
          <label className="file-filter inline">
            <FiSearch aria-hidden="true" />
            <input
              // biome-ignore lint/a11y/noAutofocus: opened by explicit search toggle
              autoFocus
              value={searchQuery}
              aria-label={t("Search files…")}
              placeholder={t("Search files…")}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setSearchQuery("");
                  setSearching(false);
                }
              }}
            />
            <button
              type="button"
              className="crumb"
              aria-label={t("Close")}
              onClick={() => {
                if (searchQuery) setSearchQuery("");
                else setSearching(false);
              }}
            >
              <FiX aria-hidden="true" />
            </button>
          </label>
        ) : (
          <nav
            className="files-breadcrumbs"
            aria-label={t("Current path")}
            title={listing?.absPath ?? baseCwd}
          >
            {crumbs.map((seg, index) => (
              <span className="crumb-seg" key={seg.path || "root"}>
                {index > 0 && <FiChevronRight aria-hidden="true" />}
                <button
                  type="button"
                  className={`crumb${seg.path === currentPath ? " active" : ""}`}
                  title={seg.path || baseCwd}
                  disabled={!baseCwd}
                  onClick={() => navigateTo(seg.path)}
                >
                  {seg.label}
                </button>
              </span>
            ))}
          </nav>
        )}
      </div>

      {uploads.length > 0 && (
        <div className="file-uploads">
          {uploads.map((item) => (
            <div className="file-upload-row" key={item.id}>
              <div className="file-upload-head">
                <span className="file-upload-name" title={item.name}>
                  {item.name}
                </span>
                <span className="file-upload-state">
                  {item.phase === "uploading"
                    ? `${item.percent}%`
                    : item.phase === "done"
                      ? t("Uploaded")
                      : item.error || t("Upload failed")}
                </span>
                {item.phase !== "uploading" && (
                  <button
                    type="button"
                    className="crumb"
                    aria-label={t("Close")}
                    onClick={() =>
                      setUploads((rows) => rows.filter((r) => r.id !== item.id))
                    }
                  >
                    <FiX aria-hidden="true" />
                  </button>
                )}
              </div>
              {item.phase === "uploading" && (
                <progress max={100} value={item.percent} />
              )}
            </div>
          ))}
        </div>
      )}

      {listError && (
        <p className="inspector-note" role="alert">
          {listError}
        </p>
      )}

      <section
        ref={listRef}
        className="file-list"
        aria-label={t("File list")}
        onContextMenu={(event) => {
          const row = (event.target as Element | null)?.closest(
            ".file-item",
          ) as HTMLElement | null;
          if (row) {
            if (row.classList.contains("file-inline-form")) return;
            const rowPath = row.dataset.path;
            if (rowPath === undefined) {
              event.preventDefault();
              return;
            }
            const entry = trimmedSearch
              ? findSearchNodeEntry(searchTree, rowPath)
              : listing?.entries.find((e) => e.path === rowPath);
            if (entry) {
              openContextMenu(event, {
                kind: entry.directory ? "dir" : "file",
                entry,
              });
            }
            return;
          }
          openContextMenu(event, {
            kind: "list",
            dir: currentPath,
            label: currentPath || lastSegment(baseCwd),
          });
        }}
        onDragOver={(event) => {
          if (!canMutateHere || !isFileDrag(event)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "copy";
          applyDropHighlight(dropTargetDir(event.target));
        }}
        onDragLeave={(event) => {
          if (
            event.relatedTarget &&
            event.currentTarget.contains(event.relatedTarget as Node)
          )
            return;
          clearDropHighlight();
        }}
        onDrop={(event) => {
          clearDropHighlight();
          if (!canMutateHere || !isFileDrag(event)) return;
          event.preventDefault();
          event.stopPropagation();
          const dropped = Array.from(event.dataTransfer?.files ?? []);
          if (dropped.length > 0)
            uploadFiles(dropTargetDir(event.target), dropped);
        }}
        onDragEnd={clearDropHighlight}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            const picked = Array.from(event.target.files ?? []);
            if (picked.length > 0) uploadFiles(uploadDirRef.current, picked);
          }}
        />

        {creating && (
          <InlineNameForm
            icon={creating.kind === "dir" ? <FiFolder /> : <FiFile />}
            prefix={creating.dir !== currentPath ? creating.dirLabel : null}
            value={createDraft}
            placeholder={
              creating.kind === "dir"
                ? t("Folder name or path/to/folder")
                : t("File name or path/to/file")
            }
            ariaLabel={
              creating.kind === "dir" ? t("New folder") : t("New file")
            }
            busy={createBusy}
            onChange={setCreateDraft}
            onSubmit={submitCreate}
            onCancel={() => setCreating(null)}
          />
        )}

        {!baseCwd ? (
          <p className="panel-empty" role="status">
            {t("No folder selected.")}
          </p>
        ) : trimmedSearch ? (
          searchLoading ? (
            <p className="panel-empty" role="status">
              {t("Searching files…")}
            </p>
          ) : searchTree.length > 0 ? (
            <>
              <SearchTreeRows
                nodes={searchTree}
                depth={0}
                collapsed={collapsedDirs}
                selected={selected}
                cutSrc={clipboard?.cut ? clipboard.src : null}
                renaming={renaming}
                renameDraft={renameDraft}
                renameBusy={renameBusy}
                onToggle={(dir) =>
                  setCollapsedDirs((prev) =>
                    prev.includes(dir)
                      ? prev.filter((p) => p !== dir)
                      : [...prev, dir],
                  )
                }
                onOpenDir={navigateTo}
                onOpenFile={openFilePreview}
                onStartRename={startRename}
                onRenameChange={setRenameDraft}
                onRenameSubmit={submitRename}
                onRenameCancel={() => setRenaming(null)}
                onContextMenu={(event, entry) =>
                  openContextMenu(event, {
                    kind: entry.directory ? "dir" : "file",
                    entry,
                  })
                }
              />
              {searchTruncated && (
                <p className="inspector-note">
                  {t("More matches exist; refine the search query.")}
                </p>
              )}
            </>
          ) : (
            <p className="panel-empty">{t("No matching files")}</p>
          )
        ) : !listing && !listError ? (
          <p className="panel-empty" role="status">
            {t("Reading files…")}
          </p>
        ) : (
          <>
            {listing && listing.parent !== null && (
              <button
                type="button"
                className="file-item dir"
                aria-label={t("Parent folder")}
                title={t("Parent folder")}
                onClick={() => navigateTo(listing.parent ?? "")}
              >
                <FiFolder className="file-icon" aria-hidden="true" />
                <span className="file-name">..</span>
              </button>
            )}
            {visibleEntries?.map((entry) =>
              renaming?.path === entry.path ? (
                <InlineNameForm
                  key={entry.path}
                  icon={entry.directory ? <FiFolder /> : <FiFile />}
                  value={renameDraft}
                  placeholder={entry.name}
                  ariaLabel={t("Rename")}
                  selectionRange={renameSelectionRange(
                    entry.name,
                    entry.directory,
                  )}
                  busy={renameBusy}
                  onChange={setRenameDraft}
                  onSubmit={submitRename}
                  onCancel={() => setRenaming(null)}
                />
              ) : (
                <div
                  key={entry.path}
                  className={`file-item ${entry.directory ? "dir" : "file"}${selected === entry.path ? " selected" : ""}${clipboard?.cut && clipboard.src === entry.path ? " cut" : ""}${isHiddenName(entry.name) ? " hidden-entry" : ""}`}
                  data-type={entry.directory ? "dir" : "file"}
                  data-path={entry.path}
                >
                  <button
                    type="button"
                    className="file-main"
                    aria-current={selected === entry.path ? "true" : undefined}
                    title={entry.path}
                    onClick={() => {
                      if (entry.directory) navigateTo(entry.path);
                      else openFilePreview(entry.path);
                    }}
                    onContextMenu={(event) =>
                      openContextMenu(event, {
                        kind: entry.directory ? "dir" : "file",
                        entry,
                      })
                    }
                    onKeyDown={(event) => {
                      if (
                        event.key === "F2" &&
                        !isProtectedRootPath(entry.path)
                      ) {
                        event.preventDefault();
                        startRename(entry);
                      }
                    }}
                  >
                    {entry.directory ? (
                      <FiFolder className="file-icon" aria-hidden="true" />
                    ) : (
                      <FiFile className="file-icon" aria-hidden="true" />
                    )}
                    <span className="file-name">{entry.name}</span>
                    {entry.symlink ? (
                      <span className="file-symlink-tag" aria-hidden="true">
                        ↗
                      </span>
                    ) : null}
                  </button>
                  {entry.path !== MACHINE_ROOT && (
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
                      onClick={() => onReference(entry.path)}
                    >
                      <FiLink aria-hidden="true" />
                    </button>
                  )}
                  <button
                    type="button"
                    className="file-attach more"
                    aria-label={t("More actions for {path}", {
                      path: entry.name,
                    })}
                    title={t("More actions")}
                    aria-haspopup="menu"
                    onClick={(event) =>
                      openButtonMenu(event, {
                        kind: entry.directory ? "dir" : "file",
                        entry,
                      })
                    }
                  >
                    <FiMoreHorizontal aria-hidden="true" />
                  </button>
                </div>
              ),
            )}
            {!listError && visibleEntries?.length === 0 && (
              <p className="panel-empty">{t("No visible files")}</p>
            )}
            {listing?.limited && (
              <p className="inspector-note">
                {t("Bounded listing; narrow the directory to see more.")}
              </p>
            )}
          </>
        )}
      </section>

      <FilePreview
        path={selected}
        cwd={baseCwd}
        loading={previewLoading}
        error={previewError}
        file={previewData}
        rawUrl={
          selected && baseCwd ? client.rawUrl(baseCwd, selected) : undefined
        }
        downloadUrl={
          selected && baseCwd
            ? client.rawUrl(baseCwd, selected, true)
            : undefined
        }
        pendingSwitch={pendingSelected}
        onDirtyChange={setPreviewDirty}
        onConfirmSwitch={() => {
          if (pendingSelected) {
            setSelected(pendingSelected);
            setPendingSelected(null);
            setPreviewDirty(false);
          }
        }}
        onCancelSwitch={() => setPendingSelected(null)}
        onSave={savePreviewText}
        onClose={() => {
          setPendingSelected(null);
          setPreviewDirty(false);
          setSelected(null);
        }}
      />

      {menu && menuItems.length > 0 && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={
            menu.target.kind === "list"
              ? menu.target.label || t("File list")
              : menu.target.entry.name
          }
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      )}

      {deleting && (
        <ActionDialog
          title={t("Delete {name}", { name: deleting.name })}
          onClose={deleteBusy ? undefined : () => setDeleting(null)}
        >
          <p>
            {deleting.directory
              ? t(
                  "This folder and all of its contents will be permanently deleted.",
                )
              : t("This file will be permanently deleted.")}
          </p>
          <code className="file-delete-path">
            {baseCwd ? hostPath(baseCwd, deleting.path) : deleting.path}
          </code>
          <footer>
            <button
              type="button"
              disabled={deleteBusy}
              onClick={() => setDeleting(null)}
            >
              {t("Cancel")}
            </button>
            <button
              type="button"
              className="danger"
              // biome-ignore lint/a11y/noAutofocus: explicit delete confirmation dialog
              autoFocus
              disabled={deleteBusy}
              onClick={confirmDelete}
            >
              {deleteBusy ? t("Deleting…") : t("Delete")}
            </button>
          </footer>
        </ActionDialog>
      )}
    </div>
  );
}

export function FilePreview({
  path,
  cwd,
  loading,
  error,
  file,
  rawUrl,
  downloadUrl,
  pendingSwitch,
  onDirtyChange,
  onConfirmSwitch,
  onCancelSwitch,
  onSave,
  onClose,
}: {
  path: string | null;
  cwd?: string;
  loading: boolean;
  error?: string | null;
  file?: UserFileReadResult;
  rawUrl?: string;
  downloadUrl?: string;
  pendingSwitch?: string | null;
  onDirtyChange?(dirty: boolean): void;
  onConfirmSwitch?(): void;
  onCancelSwitch?(): void;
  onSave?(path: string, text: string): Promise<void>;
  onClose(): void;
}) {
  const { t } = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState<
    "close" | "cancel" | null
  >(null);

  const currentFile = file && file.path === path ? file : undefined;
  const originalText = currentFile?.kind === "text" ? currentFile.text : "";
  const dirty = editing && draft !== originalText;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  // Reset edit state when switching files
  useEffect(() => {
    void path;
    setEditing(false);
    setDraft("");
    setSaving(false);
    setConfirmDiscard(null);
  }, [path]);

  const enterEdit = () => {
    if (currentFile?.kind !== "text" || !currentFile.editable) return;
    setDraft(currentFile.text);
    setEditing(true);
    setConfirmDiscard(null);
  };

  const requestLeaveEdit = (mode: "close" | "cancel") => {
    if (dirty) {
      setConfirmDiscard(mode);
      return;
    }
    setEditing(false);
    setConfirmDiscard(null);
    if (mode === "close") onClose();
  };

  const handleSave = async () => {
    if (!path || !onSave || saving) return;
    setSaving(true);
    try {
      await onSave(path, draft);
      setEditing(false);
      setConfirmDiscard(null);
    } catch (err: unknown) {
      notify(
        "error",
        t("Save failed: {error}", {
          error: errorMessage(err, t("Operation failed")),
        }),
      );
    } finally {
      setSaving(false);
    }
  };

  if (!path) return null;
  const titleName = lastSegment(path);
  const canEdit =
    !!onSave && currentFile?.kind === "text" && currentFile.editable;

  return (
    <section className="file-preview">
      <header>
        <FiFile aria-hidden="true" />
        <span title={cwd ? hostPath(cwd, path) : path}>
          {titleName}
          {dirty ? " *" : ""}
        </span>
        {editing ? (
          <>
            <button
              type="button"
              className="crumb active"
              disabled={saving || !dirty}
              aria-label={t("Save file")}
              title={t("Save file")}
              onClick={() => void handleSave()}
            >
              <FiSave aria-hidden="true" />
            </button>
            <button
              type="button"
              className="crumb"
              disabled={saving}
              aria-label={t("Cancel editing")}
              title={t("Cancel editing")}
              onClick={() => requestLeaveEdit("cancel")}
            >
              <FiX aria-hidden="true" />
            </button>
          </>
        ) : (
          <>
            {canEdit && (
              <button
                type="button"
                className="crumb"
                aria-label={t("Edit file")}
                title={t("Edit file")}
                onClick={enterEdit}
              >
                <FiEdit2 aria-hidden="true" />
              </button>
            )}
            {downloadUrl && (
              <a
                className="crumb file-download-link"
                href={downloadUrl}
                download={titleName}
                aria-label={t("Download file {path}", { path: titleName })}
                title={t("Download file {path}", { path: titleName })}
              >
                <FiDownload aria-hidden="true" />
              </a>
            )}
            <button
              type="button"
              className="crumb"
              aria-label={t("Close preview")}
              title={t("Close preview")}
              onClick={() => requestLeaveEdit("close")}
            >
              <FiX aria-hidden="true" />
            </button>
          </>
        )}
      </header>

      {(confirmDiscard || pendingSwitch) && (
        <div className="file-unsaved-bar" role="alert">
          <span>{t("Discard unsaved changes?")}</span>
          <button
            type="button"
            className="crumb"
            onClick={() => {
              setConfirmDiscard(null);
              onCancelSwitch?.();
            }}
          >
            {t("Keep editing")}
          </button>
          <button
            type="button"
            className="crumb danger"
            onClick={() => {
              const mode = confirmDiscard;
              setEditing(false);
              setConfirmDiscard(null);
              if (pendingSwitch && onConfirmSwitch) {
                onConfirmSwitch();
                return;
              }
              if (mode === "close") onClose();
            }}
          >
            {t("Discard")}
          </button>
        </div>
      )}

      {loading && <p role="status">{t("Reading…")}</p>}
      {!loading && error && <p role="alert">{error}</p>}
      {!error &&
        currentFile?.kind === "text" &&
        (editing ? (
          <textarea
            className="file-editor"
            // biome-ignore lint/a11y/noAutofocus: explicit edit action
            autoFocus
            spellCheck={false}
            value={draft}
            aria-label={t("Edit file")}
            disabled={saving}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (
                (event.ctrlKey || event.metaKey) &&
                event.key.toLowerCase() === "s"
              ) {
                event.preventDefault();
                if (dirty) void handleSave();
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                requestLeaveEdit("cancel");
              }
            }}
          />
        ) : (
          <>
            <FilePreviewText path={currentFile.path} text={currentFile.text} />
            {currentFile.limited && (
              <p className="inspector-note">
                {t("File preview is limited; this is not the complete file.")}
              </p>
            )}
          </>
        ))}
      {!error && currentFile?.kind === "image" && rawUrl && (
        <div className="file-preview-image-wrap">
          <img
            className="file-preview-image"
            src={rawUrl}
            alt={currentFile.name}
          />
          <p className="inspector-note">
            {currentFile.name} · {formatFileSize(currentFile.size)}
          </p>
        </div>
      )}
      {!error && currentFile?.kind === "binary" && (
        <div className="file-preview-binary">
          <p>
            {t("Binary file ({size})", {
              size: formatFileSize(currentFile.size),
            })}
          </p>
          {downloadUrl && (
            <a
              className="file-download-btn"
              href={downloadUrl}
              download={titleName}
            >
              <FiDownload aria-hidden="true" />
              {t("Download")}
            </a>
          )}
        </div>
      )}
    </section>
  );
}
