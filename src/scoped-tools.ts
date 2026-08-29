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
import { basename, dirname, join, relative, resolve, sep } from "node:path";

export const TOOL_LIMITS = {
  maxReadBytes: 50 * 1024,
  maxReadLines: 2000,
  maxGrepPattern: 1024,
  maxGrepFiles: 2000,
  maxGrepMillis: 5000,
  maxEntries: 20000,
} as const;

function globToRegExp(pattern: string): RegExp | { error: string } {
  if (pattern.length === 0) return { error: "missing pattern" };
  if (pattern.length > TOOL_LIMITS.maxGrepPattern) {
    return {
      error: `pattern exceeds ${TOOL_LIMITS.maxGrepPattern} characters`,
    };
  }
  let source = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*" && pattern[i + 1] === "*") {
      const next = pattern[i + 2];
      if (next === "/") {
        source += "(?:.*/)?";
        i += 2;
        continue;
      }
      source += ".*";
      i += 1;
      continue;
    }
    if (ch === "*") {
      source += "[^/]*";
      continue;
    }
    if (ch === "?") {
      source += "[^/]";
      continue;
    }
    if (ch === "[") {
      let end = i + 1;
      if (pattern[end] === "!" || pattern[end] === "^") end++;
      while (end < pattern.length && pattern[end] !== "]") end++;
      if (end === pattern.length) {
        source += "\\[";
        continue;
      }
      const raw = pattern.slice(i + 1, end);
      const negated = raw.startsWith("!") || raw.startsWith("^");
      const body = raw.slice(negated ? 1 : 0);
      if (body.length === 0 || body.includes("/")) {
        return { error: "invalid glob character class" };
      }
      const escaped = [...body]
        .map((value, index) => {
          if (value === "\\" || value === "[" || value === "]") {
            return `\\${value}`;
          }
          return value === "^" && index === 0 ? "\\^" : value;
        })
        .join("");
      source += `[${negated ? "^" : ""}${escaped}]`;
      i = end;
      continue;
    }
    if ("\\^$+()[]{}|.".includes(ch)) source += `\\${ch}`;
    else source += ch;
  }
  source += "$";
  try {
    return new RegExp(source, "u");
  } catch {
    return { error: "invalid glob pattern" };
  }
}

function boundedInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function isWithinPath(path: string, parent: string): boolean {
  return path === parent || path.startsWith(`${parent}${sep}`);
}

function isAllowedContent(path: string, allowedPaths?: string[]): boolean {
  return (
    allowedPaths === undefined ||
    allowedPaths.some((allowed) => isWithinPath(path, allowed))
  );
}

function isRelatedToAllowedPath(
  path: string,
  allowedPaths?: string[],
): boolean {
  return (
    allowedPaths === undefined ||
    allowedPaths.some(
      (allowed) => isWithinPath(path, allowed) || isWithinPath(allowed, path),
    )
  );
}

function commonAncestor(paths: string[]): string {
  let candidate = paths[0];
  while (!paths.every((path) => isWithinPath(path, candidate))) {
    const parent = dirname(candidate);
    if (parent === candidate) return candidate;
    candidate = parent;
  }
  return candidate;
}

function relativePath(base: string, path: string): string {
  return (relative(base, path) || ".").split(sep).join("/");
}

export type Observation =
  | { kind: "file"; path: string }
  | { kind: "dir"; path: string };

export class ScopedObservationCollector {
  readonly #observations = new Map<string, Observation>();
  readonly #limit: number;
  #truncated = false;

  constructor(limit = 512) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 4096) {
      throw new Error("observation-limit-invalid");
    }
    this.#limit = limit;
  }

  readonly observe = (observation: Observation): void => {
    const key = `${observation.kind}:${observation.path}`;
    if (this.#observations.has(key)) return;
    if (this.#observations.size >= this.#limit) {
      this.#truncated = true;
      return;
    }
    this.#observations.set(key, { ...observation });
  };

  projection(): { observations: Observation[]; truncated: boolean } {
    return {
      observations: [...this.#observations.values()]
        .map((entry) => ({ ...entry }))
        .sort(
          (left, right) =>
            left.path.localeCompare(right.path) ||
            left.kind.localeCompare(right.kind),
        ),
      truncated: this.#truncated,
    };
  }
}

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
type ResolvedPath = Extract<PathResult, { ok: true }>;

function resolveScoped(
  roots: string[],
  input: unknown,
  allowedPaths?: string[],
  allowScopedAncestor = false,
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
        (allowed) =>
          isWithinPath(abs, allowed) ||
          (allowScopedAncestor && isWithinPath(allowed, abs)),
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
  const virtualRoot = commonAncestor(roots);

  function resolveScanTargets(
    input: unknown,
  ):
    | { ok: true; targets: ResolvedPath[]; virtual: boolean }
    | { ok: false; error: string } {
    if (input !== undefined) {
      const resolved = resolveScoped(roots, input, allowedPaths, true);
      return resolved.ok
        ? { ok: true, targets: [resolved], virtual: false }
        : resolved;
    }
    const targets: ResolvedPath[] = [];
    for (const root of roots) {
      const resolved = resolveScoped([root], ".", allowedPaths, true);
      if (resolved.ok) targets.push(resolved);
    }
    return targets.length > 0
      ? { ok: true, targets, virtual: roots.length > 1 }
      : {
          ok: false,
          error: "path is outside the declared read/write scope",
        };
  }

  function rootRelativePath(path: string, virtual: boolean): string {
    if (virtual) return relativePath(virtualRoot, path);
    const root = roots.find((candidate) => isWithinPath(path, candidate));
    return relativePath(root ?? roots[0], path);
  }

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
      const allLines = text.split("\n");
      const offset = boundedInteger(params.offset);
      const limit = boundedInteger(params.limit);
      if (offset !== undefined && offset > allLines.length) {
        return {
          ok: false,
          error: `offset ${offset} exceeds file length (${allLines.length} lines)`,
        };
      }
      const start = offset === undefined ? 0 : Math.max(0, offset - 1);
      const windowed =
        offset === undefined && limit === undefined
          ? allLines
          : allLines.slice(
              start,
              limit === undefined ? undefined : start + limit,
            );
      let content = windowed.join("\n");
      let truncated =
        Buffer.byteLength(content, "utf8") > TOOL_LIMITS.maxReadBytes ||
        windowed.length > TOOL_LIMITS.maxReadLines;
      if (Buffer.byteLength(content, "utf8") > TOOL_LIMITS.maxReadBytes) {
        content = Buffer.from(content, "utf8")
          .subarray(0, TOOL_LIMITS.maxReadBytes)
          .toString("utf8");
        truncated = true;
      }
      if (content.split("\n").length > TOOL_LIMITS.maxReadLines) {
        content = content
          .split("\n")
          .slice(0, TOOL_LIMITS.maxReadLines)
          .join("\n");
        truncated = true;
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
      const scan = resolveScanTargets(params.path);
      if (!scan.ok) return { ok: false, error: scan.error };
      let regex: RegExp;
      try {
        regex = new RegExp(pattern, "u");
      } catch {
        return { ok: false, error: "invalid regular expression" };
      }
      const start = performance.now();
      const matches: { path: string; line: number; text: string }[] = [];
      let scanned = 0;
      const files: string[] = [];
      for (const target of scan.targets) {
        collectFiles(target.abs, files, TOOL_LIMITS.maxEntries, allowedPaths);
      }
      files.sort((left, right) => {
        const leftPath = rootRelativePath(left, scan.virtual);
        const rightPath = rootRelativePath(right, scan.virtual);
        return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0;
      });
      for (const file of files) {
        if (scanned >= TOOL_LIMITS.maxGrepFiles) break;
        if (performance.now() - start > TOOL_LIMITS.maxGrepMillis) break;
        scanned++;
        const text = utf8Text(file);
        if (text === null) continue;
        const path = rootRelativePath(file, scan.virtual);
        observe({ kind: "file", path });
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i++) {
          regex.lastIndex = 0;
          if (regex.test(lines[i])) {
            matches.push({
              path,
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
      const scan = resolveScanTargets(params.path);
      if (!scan.ok) return { ok: false, error: scan.error };
      for (const target of scan.targets) {
        let st: Stats | undefined;
        try {
          st = statSync(target.abs);
        } catch {
          return { ok: false, error: "directory does not exist" };
        }
        if (!st.isDirectory()) return { ok: false, error: "not a directory" };
        observe({
          kind: "dir",
          path: rootRelativePath(target.abs, scan.virtual),
        });
      }
      if (scan.virtual) {
        const names = new Set(
          scan.targets.map(
            (target) => relativePath(virtualRoot, target.abs).split("/")[0],
          ),
        );
        return {
          ok: true,
          entries: [...names]
            .sort()
            .slice(0, TOOL_LIMITS.maxEntries)
            .map((name) => ({ name, type: "dir" })),
        };
      }
      const resolved = scan.targets[0];
      const entries = readdirSync(resolved.abs, { withFileTypes: true })
        .filter((e) => !isHidden(e.name, roots))
        .filter((e) =>
          isRelatedToAllowedPath(join(resolved.abs, e.name), allowedPaths),
        )
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
      "Search for files by glob pattern within the approved scope; paths are relative to the search directory (max 20,000 entries).",
    async execute(params) {
      const pattern = params.pattern;
      if (typeof pattern !== "string" || pattern.length === 0) {
        return { ok: false, error: "missing pattern" };
      }
      const limit =
        params.limit === undefined
          ? TOOL_LIMITS.maxEntries
          : boundedInteger(params.limit);
      if (limit === undefined) {
        return { ok: false, error: "limit must be a positive integer" };
      }
      const scan = resolveScanTargets(params.path);
      if (!scan.ok) return { ok: false, error: scan.error };
      for (const target of scan.targets) {
        let st: Stats | undefined;
        try {
          st = statSync(target.abs);
        } catch {
          return { ok: false, error: "directory does not exist" };
        }
        if (!st.isDirectory()) return { ok: false, error: "not a directory" };
        observe({
          kind: "dir",
          path: rootRelativePath(target.abs, scan.virtual),
        });
      }
      const matcher = globToRegExp(pattern);
      if ("error" in matcher) {
        return { ok: false, error: matcher.error };
      }
      const files: string[] = [];
      for (const target of scan.targets) {
        collectFiles(target.abs, files, TOOL_LIMITS.maxEntries, allowedPaths);
      }
      const findBase = scan.virtual ? virtualRoot : scan.targets[0].abs;
      const out = files.map((abs) => relativePath(findBase, abs));
      const entries = out.filter(
        (rel) => matcher.test(rel) || matcher.test(basename(rel)),
      );
      return {
        ok: true,
        entries: entries
          .sort()
          .slice(0, Math.min(limit, TOOL_LIMITS.maxEntries)),
      };
    },
  };

  function collectFiles(
    dir: string,
    out: string[],
    limit: number,
    scopedPaths?: string[],
  ): string[] {
    if (out.length >= limit) return out;
    const target = statSync(dir);
    if (target.isFile()) {
      if (isAllowedContent(dir, scopedPaths)) out.push(dir);
      return out;
    }
    if (!target.isDirectory()) return out;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (out.length >= limit) break;
      if (isHidden(e.name, roots)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (isRelatedToAllowedPath(full, scopedPaths)) {
          collectFiles(full, out, limit, scopedPaths);
        }
      } else if (e.isFile() && isAllowedContent(full, scopedPaths)) {
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
