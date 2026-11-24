/** Direct user file-manager client for `/workbench/v1/files/*` plus pure
 * path, breadcrumb, rename-selection, and search-tree helpers. */
import type {
  UserFileEntry,
  UserFileListing,
  UserFileReadResult,
  UserFileSearchHit,
  UserFileSearchResult,
} from "../../../src/service/user-files.ts";

export type {
  UserFileEntry,
  UserFileListing,
  UserFileReadResult,
  UserFileSearchHit,
  UserFileSearchResult,
};

export interface UserFilesMeta {
  csrf: string;
  home: string;
  platform: string;
}

export interface UserFilesError extends Error {
  code: string;
}

export interface UserFilesClient {
  meta(signal?: AbortSignal): Promise<UserFilesMeta>;
  list(
    cwd: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<UserFileListing>;
  search(
    cwd: string,
    query: string,
    scope: string,
    includeHidden: boolean,
    signal?: AbortSignal,
  ): Promise<UserFileSearchResult>;
  read(
    cwd: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<UserFileReadResult>;
  write(
    cwd: string,
    path: string,
    text: string,
  ): Promise<{ path: string; absPath: string; size: number }>;
  create(
    cwd: string,
    dir: string,
    name: string,
    kind: "file" | "dir",
  ): Promise<{
    path: string;
    absPath: string;
    name: string;
    directory: boolean;
  }>;
  rename(
    cwd: string,
    path: string,
    newName: string,
  ): Promise<{ path: string; absPath: string; name: string }>;
  copy(
    cwd: string,
    src: string,
    destDir: string,
    move?: boolean,
  ): Promise<{ path: string; absPath: string; name: string }>;
  remove(cwd: string, path: string): Promise<{ deleted: true; path: string }>;
  upload(
    cwd: string,
    dir: string,
    file: File,
    onProgress?: (percent: number) => void,
    signal?: AbortSignal,
  ): Promise<{ path: string; absPath: string; name: string; size: number }>;
  rawUrl(cwd: string, path: string, download?: boolean): string;
}

export const MACHINE_ROOT = "@root";

function fileError(code: string, message: string): UserFilesError {
  const err = new Error(message || code) as UserFilesError;
  err.code = code || "io";
  return err;
}

async function parseReply<T>(response: Response): Promise<T> {
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw fileError("unavailable", response.statusText || "Request failed");
  }
  if (
    parsed &&
    typeof parsed === "object" &&
    "kind" in parsed &&
    parsed.kind === "ok" &&
    "value" in parsed
  )
    return parsed.value as T;
  const errObj =
    parsed &&
    typeof parsed === "object" &&
    "error" in parsed &&
    parsed.error &&
    typeof parsed.error === "object"
      ? (parsed.error as Record<string, unknown>)
      : undefined;
  const code = typeof errObj?.code === "string" ? errObj.code : "unavailable";
  const message =
    typeof errObj?.message === "string" && errObj.message
      ? errObj.message
      : code;
  throw fileError(code, message);
}

export function createUserFilesClient(
  getInitialCsrf?: () => string | undefined,
): UserFilesClient {
  let cachedMeta: UserFilesMeta | null = null;
  let pendingMeta: Promise<UserFilesMeta> | null = null;

  const fetchMeta = async (signal?: AbortSignal): Promise<UserFilesMeta> => {
    const response = await fetch("/workbench/v1/files/meta", {
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
      signal,
    });
    const meta = await parseReply<UserFilesMeta>(response);
    cachedMeta = meta;
    return meta;
  };

  const resolveCsrf = async (): Promise<string> => {
    const provided = getInitialCsrf?.();
    if (provided) return provided;
    if (cachedMeta?.csrf) return cachedMeta.csrf;
    if (!pendingMeta) {
      pendingMeta = fetchMeta().finally(() => {
        pendingMeta = null;
      });
    }
    return (await pendingMeta).csrf;
  };

  const getJson = async <T>(
    action: string,
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<T> => {
    const qs = new URLSearchParams(params);
    const response = await fetch(
      `/workbench/v1/files/${action}?${qs.toString()}`,
      {
        credentials: "same-origin",
        redirect: "error",
        cache: "no-store",
        signal,
      },
    );
    return parseReply<T>(response);
  };

  const postJson = async <T>(
    action: string,
    payload: Record<string, unknown>,
  ): Promise<T> => {
    const csrf = await resolveCsrf();
    const response = await fetch(`/workbench/v1/files/${action}`, {
      method: "POST",
      credentials: "same-origin",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        "X-Cadence-CSRF": csrf,
      },
      body: JSON.stringify(payload),
    });
    if (response.status === 403) cachedMeta = null;
    return parseReply<T>(response);
  };

  const rawUrl = (cwd: string, path: string, download = false): string => {
    const qs = new URLSearchParams({ cwd, path });
    if (download) qs.set("download", "1");
    return `/workbench/v1/files/raw?${qs.toString()}`;
  };

  return {
    meta: fetchMeta,
    list: (cwd, path, signal) => getJson("list", { cwd, path }, signal),
    search: (cwd, q, scope, includeHidden, signal) =>
      getJson(
        "search",
        { cwd, q, scope, hidden: includeHidden ? "1" : "0" },
        signal,
      ),
    read: (cwd, path, signal) => getJson("read", { cwd, path }, signal),
    write: (cwd, path, text) => postJson("write", { cwd, path, text }),
    create: (cwd, dir, name, kind) =>
      postJson("create", { cwd, dir, name, kind }),
    rename: (cwd, path, newName) => postJson("rename", { cwd, path, newName }),
    copy: (cwd, src, destDir, move = false) =>
      postJson("copy", { cwd, src, destDir, move }),
    remove: (cwd, path) => postJson("delete", { cwd, path }),
    async upload(cwd, dir, file, onProgress, signal) {
      const csrf = await resolveCsrf();
      const qs = new URLSearchParams({ cwd, dir, name: file.name });
      const url = `/workbench/v1/files/upload?${qs.toString()}`;
      if (typeof XMLHttpRequest === "undefined") {
        const response = await fetch(url, {
          method: "POST",
          credentials: "same-origin",
          redirect: "error",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Cadence-CSRF": csrf,
          },
          body: file,
          signal,
        });
        if (response.status === 403) cachedMeta = null;
        onProgress?.(100);
        return parseReply(response);
      }
      return new Promise((resolveUpload, rejectUpload) => {
        const xhr = new XMLHttpRequest();
        const onAbort = () => xhr.abort();
        if (signal?.aborted) {
          rejectUpload(fileError("io", "Upload aborted"));
          return;
        }
        signal?.addEventListener("abort", onAbort, { once: true });
        xhr.open("POST", url, true);
        xhr.withCredentials = true;
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.setRequestHeader("X-Cadence-CSRF", csrf);
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable && ev.total > 0)
            onProgress?.(
              Math.min(100, Math.round((ev.loaded / ev.total) * 100)),
            );
        };
        xhr.onload = () => {
          signal?.removeEventListener("abort", onAbort);
          try {
            const parsed = JSON.parse(xhr.responseText);
            if (
              xhr.status >= 200 &&
              xhr.status < 300 &&
              parsed?.kind === "ok" &&
              parsed.value
            ) {
              onProgress?.(100);
              resolveUpload(parsed.value);
              return;
            }
            if (xhr.status === 403) cachedMeta = null;
            const code =
              typeof parsed?.error?.code === "string"
                ? parsed.error.code
                : "unavailable";
            const msg =
              typeof parsed?.error?.message === "string"
                ? parsed.error.message
                : code;
            rejectUpload(fileError(code, msg));
          } catch {
            rejectUpload(fileError("unavailable", "Upload failed"));
          }
        };
        xhr.onerror = () => {
          signal?.removeEventListener("abort", onAbort);
          rejectUpload(fileError("unavailable", "Network error during upload"));
        };
        xhr.onabort = () => {
          signal?.removeEventListener("abort", onAbort);
          rejectUpload(fileError("io", "Upload aborted"));
        };
        xhr.send(file);
      });
    },
    rawUrl,
  };
}

export function isHiddenName(name: string): boolean {
  return name.startsWith(".") && name !== "..";
}

export function isAbsolutePath(path: string): boolean {
  return (
    path === MACHINE_ROOT ||
    path.startsWith("/") ||
    /^[A-Za-z]:(?:[\\/]|$)/.test(path)
  );
}

export function isProtectedRootPath(path: string): boolean {
  const s = path.replaceAll("\\", "/").trim();
  return s === MACHINE_ROOT || s === "/" || /^[A-Za-z]:\/?$/.test(s);
}

export function parentWireOf(path: string): string {
  const w = path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path;
  const i = w.lastIndexOf("/");
  if (i < 0) return "";
  if (i === 0) return "/";
  return w.slice(0, i);
}

/** An entry's full path on the service host, in the folder's own separators.
 * Already-absolute paths (when browsing outside `cwd`) pass through normalized. */
export function hostPath(cwd: string, path: string): string {
  if (!path) return cwd;
  if (path === MACHINE_ROOT) return "/";
  const separator = cwd.startsWith("/") ? "/" : "\\";
  if (path.startsWith("/")) return path;
  if (/^[A-Za-z]:(?:[\\/]|$)/.test(path)) {
    return path.length === 2 ? `${path}\\` : path.split("/").join("\\");
  }
  return `${cwd.replace(/[\\/]+$/, "")}${separator}${path.split("/").join(separator)}`;
}

/** Selection range `[start, end]` when starting an inline rename.
 * For files with an extension (e.g. `FilesPanel.tsx`), selects the stem
 * before the last dot; dotfiles (`.env`) and directories select the full name. */
export function renameSelectionRange(
  name: string,
  directory: boolean,
): [number, number] {
  if (directory) return [0, name.length];
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return [0, name.length];
  return [0, dot];
}

export interface BreadcrumbSegment {
  label: string;
  path: string;
}

export function lastSegment(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() || path
  );
}

/** Clickable trail segments for the current wire path.
 * Inside `cwd`, starts from the project folder name; outside `cwd`, starts
 * from `/` or the Windows drive letter. */
export function breadcrumbsFor(
  cwd: string | undefined,
  currentPath: string,
  rootFallbackLabel: string,
): BreadcrumbSegment[] {
  if (currentPath === MACHINE_ROOT) return [{ label: "/", path: MACHINE_ROOT }];
  if (!currentPath) {
    return [{ label: cwd ? lastSegment(cwd) : rootFallbackLabel, path: "" }];
  }
  const normalized = currentPath.replaceAll("\\", "/");
  if (normalized.startsWith("/")) {
    const parts = normalized.split("/").filter(Boolean);
    return [
      { label: "/", path: "/" },
      ...parts.map((part, i) => ({
        label: part,
        path: `/${parts.slice(0, i + 1).join("/")}`,
      })),
    ];
  }
  if (/^[A-Za-z]:/.test(normalized)) {
    const parts = normalized.split("/").filter(Boolean);
    return parts.map((part, i) => ({
      label: part,
      path: parts.slice(0, i + 1).join("/"),
    }));
  }
  const parts = normalized.split("/").filter(Boolean);
  return [
    { label: cwd ? lastSegment(cwd) : rootFallbackLabel, path: "" },
    ...parts.map((part, i) => ({
      label: part,
      path: parts.slice(0, i + 1).join("/"),
    })),
  ];
}

export interface SearchTreeNode {
  name: string;
  path: string;
  directory: boolean;
  matched: boolean;
  children: SearchTreeNode[];
}

export function normalizeWireDir(path: string): string {
  const s = path.replaceAll("\\", "/").trim();
  if (!s) return "";
  if (s === "/" || s === MACHINE_ROOT) return s;
  return s.replace(/\/+$/, "") || "/";
}

export function buildSearchTree(
  hits: readonly UserFileSearchHit[],
  scope: string,
): SearchTreeNode[] {
  const root: SearchTreeNode = {
    name: "",
    path: "",
    directory: true,
    matched: false,
    children: [],
  };
  const scopeNorm =
    scope && scope !== MACHINE_ROOT && scope !== "/"
      ? `${scope.replace(/\/+$/, "")}/`
      : scope === "/"
        ? "/"
        : "";
  for (const hit of hits) {
    const rawRel =
      hit.relPath ??
      (scopeNorm && hit.path.startsWith(scopeNorm)
        ? hit.path.slice(scopeNorm.length)
        : hit.path);
    const parts = rawRel.split("/").filter(Boolean);
    if (parts.length === 0) continue;
    let node = root;
    const baseScope =
      scopeNorm === "/" ? "" : scopeNorm ? scopeNorm.slice(0, -1) : "";
    const relIsAbs = isAbsolutePath(rawRel);
    const leadingSlash = relIsAbs ? rawRel.startsWith("/") : scopeNorm === "/";
    let acc = relIsAbs ? "" : baseScope;
    parts.forEach((part, index) => {
      const isLast = index === parts.length - 1;
      if (index === 0 && leadingSlash) acc = `/${part}`;
      else acc = acc ? `${acc}/${part}` : part;
      const nodePath = isLast ? hit.path : acc;
      let child = node.children.find((c) => c.name === part);
      if (!child) {
        child = {
          name: part,
          path: nodePath,
          directory: isLast ? hit.directory : true,
          matched: false,
          children: [],
        };
        node.children.push(child);
      } else if (isLast) {
        child.path = hit.path;
        if (hit.directory) child.directory = true;
      }
      if (isLast) child.matched = true;
      node = child;
    });
  }
  const sortTree = (n: SearchTreeNode) => {
    n.children.sort(
      (a, b) =>
        Number(b.directory) - Number(a.directory) ||
        a.name.localeCompare(b.name),
    );
    n.children.forEach(sortTree);
  };
  sortTree(root);
  return root.children;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}
