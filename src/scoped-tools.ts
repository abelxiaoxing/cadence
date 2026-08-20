// Scoped read-only filesystem tools: read, grep, find, ls. Repository-relative
// paths only, no mutation, no process execution, bounded output and scan sizes.
import {
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  type Stats,
  statSync,
} from "node:fs";
import { basename, join, relative, resolve } from "node:path";

export const TOOL_LIMITS = {
  maxReadBytes: 50 * 1024,
  maxReadLines: 2000,
  maxGrepPattern: 1024,
  maxGrepFiles: 2000,
  maxGrepMillis: 5000,
  maxEntries: 20000,
} as const;

export type Observation =
  | { kind: "file"; path: string }
  | { kind: "dir"; path: string };

export interface ScopedToolDef {
  name: string;
  description: string;
  execute(params: Record<string, unknown>): Promise<Record<string, unknown>>;
}

interface Options {
  roots: string[];
  allowedPaths?: string[];
  observer?: (obs: Observation) => void;
}

type PathResult =
  | { ok: true; abs: string; rel: string }
  | { ok: false; error: string };

function resolveScoped(
  roots: string[],
  input: unknown,
  allowedPaths?: string[],
): PathResult {
  if (typeof input !== "string" || input.length === 0) {
    return { ok: false, error: "missing path" };
  }
  if (input.includes("\u0000"))
    return { ok: false, error: "NUL byte rejected" };
  if (input.includes("\\")) return { ok: false, error: "backslash rejected" };
  if (input.startsWith("/") || input.startsWith("~")) {
    return { ok: false, error: "absolute path rejected" };
  }
  if (input.split("/").includes("..")) {
    return { ok: false, error: "parent traversal rejected" };
  }
  if (input.startsWith("./") || input.includes("//") || input.endsWith("/.")) {
    return { ok: false, error: "noncanonical path rejected" };
  }
  let insideRoot = false;
  for (const root of roots) {
    const abs = resolve(root, input);
    const inside =
      abs === root || abs.startsWith(root.endsWith("/") ? root : `${root}/`);
    if (!inside) continue;
    insideRoot = true;
    if (
      allowedPaths &&
      !allowedPaths.some(
        (allowed) => abs === allowed || abs.startsWith(`${allowed}/`),
      )
    ) {
      continue;
    }
    // Hidden directories are rejected unless the root itself is the hidden scope.
    const hiddenRoot =
      basename(realpathSync(root)) === ".git" ||
      basename(realpathSync(root)) === "node_modules";
    for (const segment of input.split("/").slice(0, -1)) {
      if ((segment === ".git" || segment === "node_modules") && !hiddenRoot) {
        return { ok: false, error: "hidden path rejected" };
      }
    }
    // Reject symlinks on any existing component and verify realpath containment.
    let current = root;
    for (const segment of input.split("/")) {
      current = join(current, segment);
      let st: Stats | undefined;
      try {
        st = lstatSync(current);
      } catch {
        break; // nonexistent leaf is fine for absent markers
      }
      if (st.isSymbolicLink()) return { ok: false, error: "symlink rejected" };
    }
    if (existsSync(current)) {
      const real = realpathSync(current);
      const realRoot = realpathSync(root);
      if (real !== realRoot && !real.startsWith(`${realRoot}/`)) {
        return { ok: false, error: "path escapes the approved root" };
      }
    }
    return { ok: true, abs: abs, rel: relative(root, abs) || "." };
  }
  return {
    ok: false,
    error: insideRoot
      ? "path is outside the declared read/write scope"
      : "path is outside every approved root",
  };
}

function existsSync(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

function utf8Text(abs: string): string | null {
  const buf = readFileSync(abs);
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return text;
  } catch {
    return null;
  }
}

export function createScopedTools(opts: Options): ScopedToolDef[] {
  const roots = opts.roots.map((r) => resolve(r));
  const allowedPaths = opts.allowedPaths?.map((p) => resolve(p));
  const observe = opts.observer ?? (() => {});

  const readTool: ScopedToolDef = {
    name: "read",
    description:
      "Read a regular UTF-8 text file within the approved scope (max 2,000 lines / 50 KiB).",
    async execute(params) {
      const resolved = resolveScoped(roots, params.path, allowedPaths);
      if (!resolved.ok) return { ok: false, error: resolved.error };
      let st: Stats | undefined;
      try {
        st = statSync(resolved.abs);
      } catch {
        return { ok: false, error: "file does not exist" };
      }
      if (!st.isFile()) return { ok: false, error: "not a regular file" };
      const text = utf8Text(resolved.abs);
      if (text === null) return { ok: false, error: "not valid UTF-8 text" };
      observe({ kind: "file", path: resolved.rel });
      const bytes = Buffer.byteLength(text, "utf8");
      const lines = text.split("\n").length;
      const truncated =
        bytes > TOOL_LIMITS.maxReadBytes || lines > TOOL_LIMITS.maxReadLines;
      let content = text;
      if (bytes > TOOL_LIMITS.maxReadBytes) {
        content = Buffer.from(text, "utf8")
          .subarray(0, TOOL_LIMITS.maxReadBytes)
          .toString("utf8");
      }
      if (content.split("\n").length > TOOL_LIMITS.maxReadLines) {
        content = content
          .split("\n")
          .slice(0, TOOL_LIMITS.maxReadLines)
          .join("\n");
      }
      return { ok: true, content, truncated };
    },
  };

  const grepTool: ScopedToolDef = {
    name: "grep",
    description:
      "Search regular text files with a bounded JavaScript regular expression (max 1,024 chars, 2,000 files).",
    async execute(params) {
      const pattern = params.pattern;
      if (typeof pattern !== "string" || pattern.length === 0) {
        return { ok: false, error: "missing pattern" };
      }
      if (pattern.length > TOOL_LIMITS.maxGrepPattern) {
        return {
          ok: false,
          error: `pattern exceeds ${TOOL_LIMITS.maxGrepPattern} characters`,
        };
      }
      const resolved = resolveScoped(roots, params.path ?? ".", allowedPaths);
      if (!resolved.ok) return { ok: false, error: resolved.error };
      let regex: RegExp;
      try {
        regex = new RegExp(pattern, "u");
      } catch {
        return { ok: false, error: "invalid regular expression" };
      }
      const start = performance.now();
      const matches: { path: string; line: number; text: string }[] = [];
      let scanned = 0;
      const files = collectFiles(resolved.abs, [], TOOL_LIMITS.maxEntries);
      for (const file of files) {
        if (scanned >= TOOL_LIMITS.maxGrepFiles) break;
        if (performance.now() - start > TOOL_LIMITS.maxGrepMillis) break;
        scanned++;
        const text = utf8Text(file);
        if (text === null) continue;
        observe({ kind: "file", path: relative(roots[0], file) });
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i++) {
          regex.lastIndex = 0;
          if (regex.test(lines[i])) {
            matches.push({
              path: relative(roots[0], file),
              line: i + 1,
              text: lines[i].slice(0, 500),
            });
          }
        }
      }
      return { ok: true, matches };
    },
  };

  const lsTool: ScopedToolDef = {
    name: "ls",
    description:
      "List a directory within the approved scope (max 20,000 entries, stable code-unit order).",
    async execute(params) {
      const resolved = resolveScoped(roots, params.path ?? ".", allowedPaths);
      if (!resolved.ok) return { ok: false, error: resolved.error };
      let st: Stats | undefined;
      try {
        st = statSync(resolved.abs);
      } catch {
        return { ok: false, error: "directory does not exist" };
      }
      if (!st.isDirectory()) return { ok: false, error: "not a directory" };
      observe({ kind: "dir", path: resolved.rel });
      const entries = readdirSync(resolved.abs, { withFileTypes: true })
        .filter((e) => !isHidden(e.name, roots))
        .slice(0, TOOL_LIMITS.maxEntries)
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      return {
        ok: true,
        entries: entries.map((e) => ({
          name: e.name,
          type: e.isDirectory() ? "dir" : "file",
        })),
      };
    },
  };

  const findTool: ScopedToolDef = {
    name: "find",
    description:
      "Recursively list paths within the approved scope (max 20,000 entries, stable code-unit order).",
    async execute(params) {
      const resolved = resolveScoped(roots, params.path ?? ".", allowedPaths);
      if (!resolved.ok) return { ok: false, error: resolved.error };
      let st: Stats | undefined;
      try {
        st = statSync(resolved.abs);
      } catch {
        return { ok: false, error: "directory does not exist" };
      }
      if (!st.isDirectory()) return { ok: false, error: "not a directory" };
      observe({ kind: "dir", path: resolved.rel });
      const out = collectFiles(resolved.abs, [], TOOL_LIMITS.maxEntries);
      return { ok: true, entries: out.slice(0, TOOL_LIMITS.maxEntries).sort() };
    },
  };

  function collectFiles(dir: string, out: string[], limit: number): string[] {
    if (out.length >= limit) return out;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (out.length >= limit) break;
      if (isHidden(e.name, roots)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        collectFiles(full, out, limit);
      } else if (e.isFile()) {
        out.push(full);
      }
    }
    return out;
  }

  function isHidden(name: string, scopes: string[]): boolean {
    if (name !== ".git" && name !== "node_modules") return false;
    // Explicit scope: the approved root itself is the hidden directory.
    for (const scope of scopes) {
      if (basename(realpathSync(scope)) === name) return false;
    }
    return true;
  }

  return [readTool, grepTool, lsTool, findTool];
}

export { resolveScoped };
