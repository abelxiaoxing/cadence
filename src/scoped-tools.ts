// Scoped read-only filesystem tools: read, grep, find, ls. Repository-relative
// paths only, no mutation, no process execution, bounded output and scan sizes.
import {
  constants,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  type Stats,
  statSync,
} from "node:fs";
import { lstat, open, opendir } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { Worker } from "node:worker_threads";
import { observeSafePath } from "./safe-path.ts";

export const TOOL_LIMITS = {
  maxReadBytes: 50 * 1024,
  maxReadLines: 2000,
  maxGrepPattern: 1024,
  maxGrepFiles: 2000,
  maxGrepMillis: 5000,
  maxGrepFileBytes: 1024 * 1024,
  maxGrepScanBytes: 16 * 1024 * 1024,
  maxGrepMatches: 1000,
  maxGrepResultBytes: 50 * 1024,
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
  execute(
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>>;
}

interface Options {
  cwd?: string;
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
  workspaceRoot = commonAncestor(roots),
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
  if (/^[a-z]:/iu.test(input))
    return { ok: false, error: "absolute path rejected" };
  const abs = resolve(workspaceRoot, input);
  const root = [...roots]
    .sort((a, b) => b.length - a.length)
    .find(
      (candidate) =>
        isWithinPath(abs, candidate) ||
        (allowScopedAncestor && isWithinPath(candidate, abs)),
    );
  if (!root || !isWithinPath(abs, workspaceRoot)) {
    return { ok: false, error: "path is outside every approved root" };
  }
  if (
    !isAllowedContent(abs, allowedPaths) &&
    !(allowScopedAncestor && isRelatedToAllowedPath(abs, allowedPaths))
  ) {
    return {
      ok: false,
      error: "path is outside the declared read/write scope",
    };
  }
  // Check all components from the workspace, including the admitted root.
  const hiddenRoot =
    basename(root) === ".git" || basename(root) === "node_modules";
  if (
    !hiddenRoot &&
    input
      .split("/")
      .some((segment) => segment === ".git" || segment === "node_modules")
  ) {
    return { ok: false, error: "hidden path rejected" };
  }
  let current = workspaceRoot;
  for (const segment of [".", ...relative(workspaceRoot, abs).split(sep)]) {
    current = join(current, segment);
    try {
      if (lstatSync(current).isSymbolicLink())
        return { ok: false, error: "symlink rejected" };
    } catch {
      break;
    }
  }
  if (existsSync(current)) {
    const real = realpathSync(current);
    const realRoot = realpathSync(workspaceRoot);
    if (!isWithinPath(real, realRoot))
      return { ok: false, error: "path escapes the approved root" };
  }
  return { ok: true, abs, rel: relativePath(workspaceRoot, abs) };
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
  if (roots.length === 0) throw new Error("approved roots are required");
  const workspaceRoot = resolve(opts.cwd ?? commonAncestor(roots));
  if (!roots.every((root) => isWithinPath(root, workspaceRoot)))
    throw new Error("approved root outside workspace");
  const allowedPaths = opts.allowedPaths?.map((p) => resolve(p));
  const observe = opts.observer ?? (() => {});

  function resolveScanTargets(
    input: unknown,
  ):
    | { ok: true; targets: ResolvedPath[]; virtual: boolean; base: string }
    | { ok: false; error: string } {
    const resolved = resolveScoped(
      roots,
      input ?? ".",
      allowedPaths,
      true,
      workspaceRoot,
    );
    if (!resolved.ok) return resolved;
    if (roots.some((root) => isWithinPath(resolved.abs, root))) {
      return {
        ok: true,
        targets: [resolved],
        virtual: false,
        base: resolved.abs,
      };
    }
    const targets: ResolvedPath[] = [];
    for (const root of roots) {
      if (!isWithinPath(root, resolved.abs)) continue;
      const target = resolveScoped(
        roots,
        relativePath(workspaceRoot, root),
        allowedPaths,
        true,
        workspaceRoot,
      );
      if (
        target.ok &&
        !targets.some((existing) => isWithinPath(target.abs, existing.abs))
      )
        targets.push(target);
    }
    return targets.length > 0
      ? { ok: true, targets, virtual: true, base: resolved.abs }
      : { ok: false, error: "path is outside the declared read/write scope" };
  }

  function rootRelativePath(path: string): string {
    return relativePath(workspaceRoot, path);
  }

  const readTool: ScopedToolDef = {
    name: "read",
    description:
      "Read a regular UTF-8 text file within the approved scope (max 2,000 lines / 50 KiB).",
    async execute(params) {
      const resolved = resolveScoped(
        roots,
        params.path,
        allowedPaths,
        false,
        workspaceRoot,
      );
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
      "Search scoped UTF-8 files using a cancellable JavaScript regexp (5 seconds, 1 MiB/file, 16 MiB total, 1,000 matches / 50 KiB output); truncated results are marked.",
    async execute(params, signal) {
      if (signal?.aborted) return { ok: false, error: "search cancelled" };
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
      try {
        new RegExp(pattern, "u");
      } catch {
        return { ok: false, error: "invalid regular expression" };
      }
      const scan = resolveScanTargets(params.path);
      if (!scan.ok) return { ok: false, error: scan.error };
      const deadline = performance.now() + TOOL_LIMITS.maxGrepMillis;
      const files: string[] = [];
      const matches: Array<{ path: string; line: number; text: string }> = [];
      let truncated = false;
      let visited = 0;
      let scanBytes = 0;
      let resultBytes = 0;
      let worker: Worker | undefined;
      const checkSearch = () => {
        if (signal?.aborted) throw new Error("search cancelled");
        if (performance.now() >= deadline) throw new Error("search timed out");
      };
      const collectSearchFiles = async (directory: string): Promise<void> => {
        checkSearch();
        const target = await lstat(directory);
        checkSearch();
        if (target.isFile()) {
          if (isAllowedContent(directory, allowedPaths)) files.push(directory);
          return;
        }
        if (!target.isDirectory()) return;
        const entries = await opendir(directory);
        for await (const entry of entries) {
          checkSearch();
          if (
            ++visited > TOOL_LIMITS.maxEntries ||
            files.length >= TOOL_LIMITS.maxGrepFiles
          ) {
            truncated = true;
            break;
          }
          if (isHidden(entry.name, roots)) continue;
          const full = join(directory, entry.name);
          if (entry.isDirectory() && isRelatedToAllowedPath(full, allowedPaths))
            await collectSearchFiles(full);
          else if (entry.isFile() && isAllowedContent(full, allowedPaths))
            files.push(full);
        }
      };
      try {
        for (const target of scan.targets) await collectSearchFiles(target.abs);
        const ordered = [...new Set(files)].sort((left, right) => {
          const a = rootRelativePath(left);
          const b = rootRelativePath(right);
          return a < b ? -1 : a > b ? 1 : 0;
        });
        if (ordered.length > TOOL_LIMITS.maxGrepFiles) truncated = true;
        checkSearch();
        worker = new Worker(
          new URL("./scoped-grep-worker.mjs", import.meta.url),
          {
            resourceLimits: { maxOldGenerationSizeMb: 64 },
          },
        );
        // Keep one rejection path installed between requests as well, so a late
        // worker error cannot become an uncaught EventEmitter error.
        let workerFailed = false;
        worker.on("error", () => {
          workerFailed = true;
        });
        for (const file of ordered.slice(0, TOOL_LIMITS.maxGrepFiles)) {
          checkSearch();
          if (scanBytes >= TOOL_LIMITS.maxGrepScanBytes) {
            truncated = true;
            break;
          }
          const limit = Math.min(
            TOOL_LIMITS.maxGrepFileBytes,
            TOOL_LIMITS.maxGrepScanBytes - scanBytes,
          );
          // Read at most the budget plus one byte, even if the file grows after
          // admission. Oversized files are skipped explicitly, never decoded in full.
          const buffer = Buffer.alloc(limit + 1);
          const path = rootRelativePath(file);
          if (observeSafePath(workspaceRoot, path).kind !== "file") {
            truncated = true;
            continue;
          }
          const fd = await open(
            file,
            constants.O_RDONLY |
              (constants.O_NOFOLLOW ?? 0) |
              (constants.O_NONBLOCK ?? 0),
          );
          let length = 0;
          try {
            if (!(await fd.stat()).isFile()) {
              truncated = true;
              continue;
            }
            while (length < buffer.length) {
              checkSearch();
              const { bytesRead: count } = await fd.read(
                buffer,
                length,
                buffer.length - length,
                null,
              );
              if (count === 0) break;
              length += count;
            }
          } finally {
            await fd.close();
          }
          checkSearch();
          scanBytes += Math.min(length, limit);
          if (length > limit) {
            truncated = true;
            continue;
          }
          let text: string;
          try {
            text = new TextDecoder("utf-8", { fatal: true }).decode(
              buffer.subarray(0, length),
            );
          } catch {
            continue;
          }
          observe({ kind: "file", path });
          if (workerFailed) return { ok: false, error: "search unavailable" };
          const currentWorker = worker;
          const result = await new Promise<{
            matches: typeof matches;
            bytes: number;
            truncated: boolean;
          }>((resolve, reject) => {
            const cleanup = () => {
              clearTimeout(timer);
              signal?.removeEventListener("abort", onAbort);
              currentWorker.removeListener("message", onMessage);
              currentWorker.removeListener("error", onError);
              currentWorker.removeListener("exit", onError);
            };
            const fail = (message: string) => {
              cleanup();
              reject(new Error(message));
            };
            const onAbort = () => fail("search cancelled");
            const onError = () => fail("search unavailable");
            const onMessage = (value: {
              matches: typeof matches;
              bytes: number;
              truncated: boolean;
            }) => {
              cleanup();
              resolve(value);
            };
            const timer = setTimeout(
              () => fail("search timed out"),
              Math.max(1, deadline - performance.now()),
            );
            signal?.addEventListener("abort", onAbort, { once: true });
            currentWorker.once("message", onMessage);
            currentWorker.once("error", onError);
            currentWorker.once("exit", onError);
            if (signal?.aborted) {
              onAbort();
              return;
            }
            currentWorker.postMessage({
              pattern,
              path,
              text,
              maxMatches: TOOL_LIMITS.maxGrepMatches - matches.length,
              maxBytes: TOOL_LIMITS.maxGrepResultBytes - resultBytes,
            });
          });
          matches.push(...result.matches);
          resultBytes += result.bytes;
          if (result.truncated) {
            truncated = true;
            break;
          }
        }
        return { ok: true, matches, truncated };
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        return {
          ok: false,
          error: ["search cancelled", "search timed out"].includes(message)
            ? message
            : "search unavailable",
        };
      } finally {
        await worker?.terminate();
      }
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
          path: rootRelativePath(target.abs),
        });
      }
      if (scan.virtual) {
        const names = new Set(
          scan.targets.map(
            (target) => relativePath(scan.base, target.abs).split("/")[0],
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
      "Search for files by glob pattern within the approved scope; returned paths are workspace-relative (max 20,000 entries).",
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
          path: rootRelativePath(target.abs),
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
      const entries = [...new Set(files)]
        .filter((abs) => {
          const searched = relativePath(scan.base, abs);
          return matcher.test(searched) || matcher.test(basename(abs));
        })
        .map((abs) => rootRelativePath(abs));
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
    traversal = {
      remaining: TOOL_LIMITS.maxEntries as number,
      truncated: false,
    },
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
      if (out.length >= limit || traversal.remaining-- <= 0) {
        traversal.truncated = true;
        break;
      }
      if (isHidden(e.name, roots)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (isRelatedToAllowedPath(full, scopedPaths)) {
          collectFiles(full, out, limit, scopedPaths, traversal);
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
      if (basename(scope) === name) return false;
    }
    return true;
  }

  return [readTool, grepTool, lsTool, findTool];
}

export { resolveScoped };
