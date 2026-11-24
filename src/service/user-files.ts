/** Direct user-owned file manager for the browser workspace.
 * Intentionally unencumbered: no sensitive-name hiding, no symlink/hardlink
 * refusal, no redaction, and no root confinement. Guardrails exist only to
 * prevent tool bugs (self-recursive copies, silent overwrites, OOM previews). */
import {
  closeSync,
  cpSync,
  type Dirent,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

export const IS_WIN32 = process.platform === "win32";
export const MACHINE_ROOT = "@root";
export const MAX_LIST_ENTRIES = 2000;
export const MAX_PREVIEW_BYTES = 512 * 1024;
export const MAX_SAVE_BYTES = 2 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 256 * 1024 * 1024;
const MAX_SEARCH_RESULTS = 100;
const MAX_SEARCH_VISITED = 20_000;
const MAX_SEARCH_DEPTH = 20;
const MAX_SEARCH_MS = 2500;
const SEARCH_SKIP_DIRS = new Set(["node_modules", ".git"]);

const IMAGE_MIME: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
};

export type UserFileErrorCode =
  | "invalid"
  | "not-found"
  | "exists"
  | "not-directory"
  | "not-file"
  | "protected"
  | "self-target"
  | "oversize"
  | "io";

export class UserFileError extends Error {
  constructor(
    readonly code: UserFileErrorCode,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "UserFileError";
  }
}

export interface UserFileEntry {
  name: string;
  path: string;
  directory: boolean;
  size?: number;
  symlink?: boolean;
}

export interface UserFileListing {
  path: string;
  absPath: string;
  parent: string | null;
  entries: UserFileEntry[];
  limited: boolean;
}

export interface UserFileSearchHit {
  name: string;
  path: string;
  /** Path relative to the search scope directory (always forward-slash). */
  relPath: string;
  directory: boolean;
}

export interface UserFileSearchResult {
  results: UserFileSearchHit[];
  truncated: boolean;
}

export type UserFileReadResult =
  | {
      kind: "text";
      path: string;
      absPath: string;
      name: string;
      text: string;
      size: number;
      limited: boolean;
      editable: boolean;
    }
  | {
      kind: "image";
      path: string;
      absPath: string;
      name: string;
      size: number;
      mimeType: string;
    }
  | {
      kind: "binary";
      path: string;
      absPath: string;
      name: string;
      size: number;
      mimeType: string;
    };

export function normWirePath(raw: string): string {
  const s = raw.replaceAll("\\", "/").trim();
  if (!s) return "";
  if (s === "/" || s === MACHINE_ROOT) return s;
  if (s === `${MACHINE_ROOT}/`) return MACHINE_ROOT;
  const trimmed = s.replace(/\/+$/, "");
  return trimmed || "/";
}

export function isAbsoluteWirePath(raw: string): boolean {
  const s = normWirePath(raw);
  if (s === MACHINE_ROOT || s.startsWith("/")) return true;
  return IS_WIN32 && /^[A-Za-z]:(?:\/|$)/.test(s);
}

export function isProtectedRoot(raw: string): boolean {
  const s = normWirePath(raw);
  return s === MACHINE_ROOT || s === "/" || /^[A-Za-z]:$/.test(s);
}

export function wireToAbs(wire: string): string {
  const w = normWirePath(wire);
  if (IS_WIN32 && /^[A-Za-z]:$/.test(w)) return `${w[0].toUpperCase()}:\\`;
  return resolve(w);
}

export function absToWirePosix(abs: string): string {
  const p = abs.split(sep).join("/");
  if (IS_WIN32 && /^[A-Za-z]:\/$/.test(p)) return p.slice(0, 2);
  if (p !== "/" && p.endsWith("/")) return p.replace(/\/+$/, "") || "/";
  return p;
}

export function absoluteParent(wire: string): string | null {
  const s = normWirePath(wire);
  if (!s || s === MACHINE_ROOT || s === "/") return null;
  const i = s.lastIndexOf("/");
  if (i < 0) return /^[A-Za-z]:$/.test(s) ? MACHINE_ROOT : null;
  if (i === 0) return "/";
  return s.slice(0, i);
}

function expandTilde(raw: string): string {
  if (raw === "~") return homedir();
  if (raw.startsWith("~/") || raw.startsWith("~\\"))
    return join(homedir(), raw.slice(2));
  return raw;
}

export function resolveBaseCwd(cwd: string): string {
  const trimmed = cwd.trim();
  if (!trimmed) return resolve(homedir());
  return resolve(expandTilde(trimmed));
}

export function resolveUserPath(cwd: string, rawPath: string): string {
  const base = resolveBaseCwd(cwd);
  const trimmed = rawPath.trim();
  if (!trimmed) return base;
  const expanded = expandTilde(trimmed);
  if (expanded !== trimmed) return resolve(expanded);
  const wire = normWirePath(trimmed);
  if (wire === MACHINE_ROOT) return MACHINE_ROOT;
  if (isAbsoluteWirePath(wire)) return wireToAbs(wire);
  return resolve(base, wire);
}

export function toWirePath(cwd: string, abs: string): string {
  if (abs === MACHINE_ROOT) return MACHINE_ROOT;
  const root = resolveBaseCwd(cwd);
  const target = resolve(abs);
  const rel = relative(root, target);
  if (rel === "") return "";
  if (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`))
    return rel.split(sep).join("/");
  return absToWirePosix(target);
}

function parentForPath(cwd: string, abs: string): string | null {
  if (abs === MACHINE_ROOT) return null;
  const wire = absToWirePosix(resolve(abs));
  const parentAbsWire = absoluteParent(wire);
  if (parentAbsWire === null) return null;
  if (parentAbsWire === MACHINE_ROOT) return MACHINE_ROOT;
  return toWirePath(cwd, wireToAbs(parentAbsWire));
}

function validateSegment(segment: string): string {
  const s = segment.trim();
  if (
    !s ||
    s === "." ||
    s === ".." ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: file names cannot contain control characters
    /[\x00-\x1f\x7f]/.test(s) ||
    s.includes("/") ||
    s.includes("\\")
  )
    throw new UserFileError("invalid", `Invalid name: ${segment}`);
  if (IS_WIN32) {
    if (/[<>:"|?*]/.test(s) || /[. ]$/.test(s))
      throw new UserFileError("invalid", `Invalid name: ${segment}`);
    if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(s))
      throw new UserFileError("invalid", `Invalid name: ${segment}`);
  }
  return s;
}

export function parseNestedRelativeName(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) throw new UserFileError("invalid", "Name cannot be empty");
  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("\\") ||
    /^[A-Za-z]:/.test(trimmed)
  )
    throw new UserFileError("invalid", `Must be a relative path: ${raw}`);
  const parts = trimmed.replaceAll("\\", "/").split("/");
  if (parts.some((p) => p.trim() === ""))
    throw new UserFileError("invalid", `Invalid path: ${raw}`);
  return parts.map(validateSegment);
}

export function mimeForFile(name: string): string {
  const ext = extname(name).toLowerCase();
  if (IMAGE_MIME[ext]) return IMAGE_MIME[ext];
  if (
    /\.(?:txt|md|markdown|ts|tsx|js|jsx|mjs|cjs|json|css|html|xml|yaml|yml|toml|ini|sh|bash|zsh|py|rs|go|java|c|h|cpp|hpp|rb|php|sql|env|gitignore|dockerignore|csv)$/i.test(
      name,
    )
  )
    return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function mapErrno(error: unknown, fallback: string): UserFileError {
  if (error instanceof UserFileError) return error;
  const e = error as NodeJS.ErrnoException;
  if (e?.code === "ENOENT")
    return new UserFileError("not-found", e.message || fallback, 404);
  if (e?.code === "EEXIST")
    return new UserFileError("exists", e.message || fallback, 409);
  if (e?.code === "ENOTDIR")
    return new UserFileError("not-directory", e.message || fallback, 400);
  if (e?.code === "EISDIR")
    return new UserFileError("not-file", e.message || fallback, 400);
  return new UserFileError("io", e?.message || fallback, 500);
}

function listMachineRoot(): UserFileListing {
  if (IS_WIN32) {
    const entries: UserFileEntry[] = [];
    for (let code = 65; code <= 90; code++) {
      const drive = `${String.fromCharCode(code)}:`;
      try {
        if (statSync(`${drive}\\`).isDirectory())
          entries.push({ name: drive, path: drive, directory: true });
      } catch {}
    }
    return {
      path: MACHINE_ROOT,
      absPath: MACHINE_ROOT,
      parent: null,
      entries,
      limited: false,
    };
  }
  return {
    path: MACHINE_ROOT,
    absPath: "/",
    parent: null,
    entries: [{ name: "/", path: "/", directory: true }],
    limited: false,
  };
}

export function listUserFiles(cwd: string, rawPath = ""): UserFileListing {
  try {
    const abs = resolveUserPath(cwd, rawPath);
    if (abs === MACHINE_ROOT) return listMachineRoot();
    const stat = statSync(abs);
    if (!stat.isDirectory())
      throw new UserFileError("not-directory", `Not a directory: ${abs}`);
    const wire = toWirePath(cwd, abs);
    const dirents = readdirSync(abs, { withFileTypes: true });
    const entries: UserFileEntry[] = [];
    for (const d of dirents) {
      const childAbs = join(abs, d.name);
      const isSymlink = d.isSymbolicLink();
      let directory = d.isDirectory();
      let size: number | undefined;
      if (isSymlink) {
        try {
          const st = statSync(childAbs);
          directory = st.isDirectory();
          if (!directory) size = st.size;
        } catch {
          directory = false;
        }
      } else if (!directory) {
        try {
          size = lstatSync(childAbs).size;
        } catch {}
      }
      entries.push({
        name: d.name,
        path: toWirePath(cwd, childAbs),
        directory,
        ...(size !== undefined ? { size } : {}),
        ...(isSymlink ? { symlink: true } : {}),
      });
    }
    entries.sort(
      (a, b) =>
        Number(b.directory) - Number(a.directory) ||
        a.name.localeCompare(b.name),
    );
    const limited = entries.length > MAX_LIST_ENTRIES;
    if (limited) entries.length = MAX_LIST_ENTRIES;
    return {
      path: wire,
      absPath: abs,
      parent: parentForPath(cwd, abs),
      entries,
      limited,
    };
  } catch (error) {
    throw mapErrno(error, "Failed to list directory");
  }
}

export function searchUserFiles(
  cwd: string,
  query: string,
  scope = "",
  includeHidden = false,
): UserFileSearchResult {
  const rawQuery = query.trim();
  if (!rawQuery) return { results: [], truncated: false };
  const walkAbs = resolveUserPath(cwd, scope);
  if (walkAbs === MACHINE_ROOT) return { results: [], truncated: false };
  try {
    if (!statSync(walkAbs).isDirectory())
      return { results: [], truncated: false };
  } catch {
    return { results: [], truncated: false };
  }

  const q = rawQuery.replaceAll("\\", "/").toLowerCase();
  const results: UserFileSearchHit[] = [];
  const seen = new Set<string>();
  const start = Date.now();
  let visited = 0;
  let truncated = false;

  const addHit = (
    absPath: string,
    name: string,
    relPath: string,
    directory: boolean,
  ) => {
    const wire = toWirePath(cwd, absPath);
    if (seen.has(wire)) return;
    seen.add(wire);
    results.push({ name, path: wire, relPath, directory });
  };

  // Direct path match when query explicitly looks like a path (not `.` or `..`)
  if (
    rawQuery.includes("/") ||
    rawQuery.includes("\\") ||
    rawQuery.startsWith("~")
  ) {
    try {
      const directAbs = resolveUserPath(walkAbs, rawQuery);
      if (directAbs !== MACHINE_ROOT && directAbs !== walkAbs) {
        const st = statSync(directAbs);
        if (st.isFile() || st.isDirectory()) {
          const relFromWalk = relative(walkAbs, directAbs);
          const relPath =
            !isAbsolute(relFromWalk) &&
            relFromWalk !== ".." &&
            !relFromWalk.startsWith(`..${sep}`)
              ? relFromWalk.split(sep).join("/")
              : absToWirePosix(directAbs);
          addHit(
            directAbs,
            basename(directAbs) || directAbs,
            relPath,
            st.isDirectory(),
          );
        }
      }
    } catch {}
  }

  const budgetLeft = () =>
    results.length < MAX_SEARCH_RESULTS &&
    visited < MAX_SEARCH_VISITED &&
    Date.now() - start < MAX_SEARCH_MS;

  const walk = (dirAbs: string, relFromScope: string, depth: number) => {
    if (!budgetLeft() || depth > MAX_SEARCH_DEPTH) {
      truncated = true;
      return;
    }
    let dirents: Dirent[];
    try {
      dirents = readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of dirents) {
      visited++;
      if (!budgetLeft()) {
        truncated = true;
        return;
      }
      const name = String(d.name);
      if (SEARCH_SKIP_DIRS.has(name)) continue;
      if (!includeHidden && name.startsWith(".")) continue;
      const childAbs = join(dirAbs, name);
      let isDir = d.isDirectory();
      if (d.isSymbolicLink()) {
        // Don't recurse infinitely into directory symlinks during search,
        // but still classify and match them.
        try {
          isDir = statSync(childAbs).isDirectory();
        } catch {
          isDir = false;
        }
      }
      const childRel = relFromScope ? `${relFromScope}/${name}` : name;
      if (
        name.toLowerCase().includes(q) ||
        childRel.toLowerCase().includes(q)
      ) {
        addHit(childAbs, name, childRel, isDir);
      }
      if (isDir && !d.isSymbolicLink()) walk(childAbs, childRel, depth + 1);
    }
  };

  walk(walkAbs, "", 0);
  return { results, truncated };
}

export function readUserFile(cwd: string, rawPath: string): UserFileReadResult {
  try {
    const abs = resolveUserPath(cwd, rawPath);
    if (abs === MACHINE_ROOT) throw new UserFileError("not-file", "Not a file");
    const st = statSync(abs);
    if (!st.isFile())
      throw new UserFileError("not-file", `Not a file: ${rawPath}`);
    const wire = toWirePath(cwd, abs);
    const name = basename(abs) || rawPath;
    const ext = extname(name).toLowerCase();
    if (IMAGE_MIME[ext]) {
      return {
        kind: "image",
        path: wire,
        absPath: abs,
        name,
        size: st.size,
        mimeType: IMAGE_MIME[ext],
      };
    }
    const readLen = Math.min(st.size, MAX_PREVIEW_BYTES);
    const buf = Buffer.alloc(readLen);
    let bytesRead = 0;
    if (readLen > 0) {
      const fd = openSync(abs, "r");
      try {
        while (bytesRead < readLen) {
          const n = readSync(
            fd,
            buf,
            bytesRead,
            readLen - bytesRead,
            bytesRead,
          );
          if (n <= 0) break;
          bytesRead += n;
        }
      } finally {
        closeSync(fd);
      }
    }
    const slice = bytesRead === readLen ? buf : buf.subarray(0, bytesRead);
    const whole = bytesRead === st.size || bytesRead < readLen;
    if (slice.includes(0)) {
      return {
        kind: "binary",
        path: wire,
        absPath: abs,
        name,
        size: st.size,
        mimeType: mimeForFile(name),
      };
    }
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(slice, {
        stream: !whole,
      });
      return {
        kind: "text",
        path: wire,
        absPath: abs,
        name,
        text,
        size: st.size,
        limited: !whole,
        editable: whole && st.size <= MAX_SAVE_BYTES,
      };
    } catch {
      return {
        kind: "binary",
        path: wire,
        absPath: abs,
        name,
        size: st.size,
        mimeType: mimeForFile(name),
      };
    }
  } catch (error) {
    throw mapErrno(error, "Failed to read file");
  }
}

export function writeUserFile(
  cwd: string,
  rawPath: string,
  text: string,
): { path: string; absPath: string; size: number } {
  try {
    const abs = resolveUserPath(cwd, rawPath);
    if (abs === MACHINE_ROOT) throw new UserFileError("not-file", "Not a file");
    const size = Buffer.byteLength(text, "utf8");
    if (size > MAX_SAVE_BYTES)
      throw new UserFileError(
        "oversize",
        `File exceeds ${Math.round(MAX_SAVE_BYTES / 1024 / 1024)} MiB save limit`,
        413,
      );
    const st = statSync(abs);
    if (!st.isFile())
      throw new UserFileError("not-file", `Not a file: ${rawPath}`);
    writeFileSync(abs, text, "utf8");
    return { path: toWirePath(cwd, abs), absPath: abs, size };
  } catch (error) {
    throw mapErrno(error, "Failed to save file");
  }
}

export function createUserEntry(
  cwd: string,
  rawDir: string,
  rawName: string,
  kind: "file" | "dir",
): { path: string; absPath: string; name: string; directory: boolean } {
  try {
    const baseAbs = resolveUserPath(cwd, rawDir);
    if (baseAbs === MACHINE_ROOT)
      throw new UserFileError("protected", "Cannot create at machine root");
    const baseStat = statSync(baseAbs);
    if (!baseStat.isDirectory())
      throw new UserFileError("not-directory", `Not a directory: ${rawDir}`);
    const segments = parseNestedRelativeName(rawName);
    const targetAbs = join(baseAbs, ...segments);
    if (lstatSync(targetAbs, { throwIfNoEntry: false }))
      throw new UserFileError("exists", `Already exists: ${rawName}`, 409);
    if (kind === "dir") {
      mkdirSync(targetAbs, { recursive: true });
    } else {
      mkdirSync(dirname(targetAbs), { recursive: true });
      writeFileSync(targetAbs, "", { flag: "wx" });
    }
    return {
      path: toWirePath(cwd, targetAbs),
      absPath: targetAbs,
      name: segments[segments.length - 1],
      directory: kind === "dir",
    };
  } catch (error) {
    throw mapErrno(error, "Failed to create entry");
  }
}

export function renameUserEntry(
  cwd: string,
  rawPath: string,
  rawNewName: string,
): { path: string; absPath: string; name: string } {
  try {
    if (isProtectedRoot(rawPath))
      throw new UserFileError("protected", `Cannot rename: ${rawPath}`);
    const srcAbs = resolveUserPath(cwd, rawPath);
    if (isProtectedRoot(absToWirePosix(srcAbs)))
      throw new UserFileError("protected", `Cannot rename: ${srcAbs}`);
    const srcStat = lstatSync(srcAbs);
    const name = validateSegment(rawNewName);
    const destAbs = join(dirname(srcAbs), name);
    if (destAbs === srcAbs)
      return { path: toWirePath(cwd, srcAbs), absPath: srcAbs, name };
    const existing = lstatSync(destAbs, { throwIfNoEntry: false });
    const isCaseOnlyRename =
      existing !== undefined &&
      existing.dev === srcStat.dev &&
      existing.ino === srcStat.ino &&
      destAbs.toLowerCase() === srcAbs.toLowerCase();
    if (existing && !isCaseOnlyRename)
      throw new UserFileError("exists", `Already exists: ${name}`, 409);
    renameSync(srcAbs, destAbs);
    return { path: toWirePath(cwd, destAbs), absPath: destAbs, name };
  } catch (error) {
    throw mapErrno(error, "Failed to rename entry");
  }
}

function dedupeCopyDest(dest: string): string {
  if (!lstatSync(dest, { throwIfNoEntry: false })) return dest;
  const dir = dirname(dest);
  const base = basename(dest);
  const ext = extname(base);
  const stem = ext && base !== ext ? base.slice(0, -ext.length) : base;
  const suffix = ext && base !== ext ? ext : "";
  for (let i = 1; i < 1000; i++) {
    const candidate = join(
      dir,
      `${stem} copy${i === 1 ? "" : ` ${i}`}${suffix}`,
    );
    if (!lstatSync(candidate, { throwIfNoEntry: false })) return candidate;
  }
  return join(dir, `${stem} copy ${Date.now()}${suffix}`);
}

export function copyUserEntry(
  cwd: string,
  rawSrc: string,
  rawDestDir: string,
  move = false,
): { path: string; absPath: string; name: string } {
  try {
    if (isProtectedRoot(rawSrc))
      throw new UserFileError("protected", `Cannot copy/move: ${rawSrc}`);
    const srcAbs = resolveUserPath(cwd, rawSrc);
    if (isProtectedRoot(absToWirePosix(srcAbs)))
      throw new UserFileError("protected", `Cannot copy/move: ${srcAbs}`);
    const srcStat = lstatSync(srcAbs);
    const destDirAbs = resolveUserPath(cwd, rawDestDir);
    if (destDirAbs === MACHINE_ROOT)
      throw new UserFileError("protected", "Cannot target machine root");
    if (!statSync(destDirAbs).isDirectory())
      throw new UserFileError(
        "not-directory",
        `Target is not a directory: ${rawDestDir}`,
      );
    const prefix = srcAbs.endsWith(sep) ? srcAbs : `${srcAbs}${sep}`;
    if (destDirAbs === srcAbs || destDirAbs.startsWith(prefix))
      throw new UserFileError(
        "self-target",
        "Cannot copy or move a folder into itself",
      );
    if (!srcStat.isSymbolicLink() && srcStat.isDirectory()) {
      const realSrc = realpathSync(srcAbs);
      const realDest = realpathSync(destDirAbs);
      const realPrefix = realSrc.endsWith(sep) ? realSrc : `${realSrc}${sep}`;
      if (realDest === realSrc || realDest.startsWith(realPrefix))
        throw new UserFileError(
          "self-target",
          "Cannot copy or move a folder into itself",
        );
    }
    const base = basename(srcAbs);
    let destAbs = join(destDirAbs, base);
    if (move) {
      if (destAbs === srcAbs)
        return { path: toWirePath(cwd, srcAbs), absPath: srcAbs, name: base };
      if (lstatSync(destAbs, { throwIfNoEntry: false }))
        throw new UserFileError("exists", `Already exists: ${base}`, 409);
      try {
        renameSync(srcAbs, destAbs);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
        cpSync(srcAbs, destAbs, {
          recursive: true,
          verbatimSymlinks: true,
          force: false,
          errorOnExist: true,
        });
        rmSync(srcAbs, { recursive: true, force: true });
      }
    } else {
      destAbs = dedupeCopyDest(destAbs);
      cpSync(srcAbs, destAbs, {
        recursive: true,
        verbatimSymlinks: true,
        force: false,
        errorOnExist: true,
      });
    }
    return {
      path: toWirePath(cwd, destAbs),
      absPath: destAbs,
      name: basename(destAbs),
    };
  } catch (error) {
    throw mapErrno(
      error,
      move ? "Failed to move entry" : "Failed to copy entry",
    );
  }
}

export function deleteUserEntry(
  cwd: string,
  rawPath: string,
): { deleted: true; path: string } {
  try {
    if (!rawPath.trim() || isProtectedRoot(rawPath))
      throw new UserFileError("protected", `Cannot delete: ${rawPath}`);
    const srcAbs = resolveUserPath(cwd, rawPath);
    if (isProtectedRoot(absToWirePosix(srcAbs)))
      throw new UserFileError("protected", `Cannot delete: ${srcAbs}`);
    lstatSync(srcAbs);
    rmSync(srcAbs, { recursive: true, force: false });
    return { deleted: true, path: rawPath };
  } catch (error) {
    throw mapErrno(error, "Failed to delete entry");
  }
}

export function prepareUploadTarget(
  cwd: string,
  rawDir: string,
  rawName: string,
): { destAbs: string; wirePath: string; name: string } {
  try {
    const dirAbs = resolveUserPath(cwd, rawDir);
    if (dirAbs === MACHINE_ROOT)
      throw new UserFileError("protected", "Cannot upload to machine root");
    mkdirSync(dirAbs, { recursive: true });
    if (!statSync(dirAbs).isDirectory())
      throw new UserFileError("not-directory", `Not a directory: ${rawDir}`);
    const name = validateSegment(rawName);
    const destAbs = join(dirAbs, name);
    if (lstatSync(destAbs, { throwIfNoEntry: false }))
      throw new UserFileError("exists", `Already exists: ${name}`, 409);
    return { destAbs, wirePath: toWirePath(cwd, destAbs), name };
  } catch (error) {
    throw mapErrno(error, "Failed to prepare upload");
  }
}

export function resolveRawFile(
  cwd: string,
  rawPath: string,
): { absPath: string; name: string; size: number; mimeType: string } {
  try {
    const abs = resolveUserPath(cwd, rawPath);
    if (abs === MACHINE_ROOT) throw new UserFileError("not-file", "Not a file");
    const st = statSync(abs);
    if (!st.isFile())
      throw new UserFileError("not-file", `Not a file: ${rawPath}`);
    const name = basename(abs) || "file";
    return {
      absPath: abs,
      name,
      size: st.size,
      mimeType: mimeForFile(name),
    };
  } catch (error) {
    throw mapErrno(error, "Failed to open file");
  }
}
