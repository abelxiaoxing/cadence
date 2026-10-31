/** Workspace identity and bounded filesystem operations, independent of task records. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  type Stats,
} from "node:fs";
import { homedir } from "node:os";
import {
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";
import { object } from "./data-shapes.ts";
export function parseRecord(data: Buffer): unknown {
  try {
    return JSON.parse(data.toString("utf8"));
  } catch {
    throw new Error("Corrupt JSON state; preserved without reset");
  }
}
export function absent(error: unknown): boolean {
  return object(error) && error.code === "ENOENT";
}
/** Reject links in every existing ancestor. Missing observation never creates paths.
 * The readonly hook inspects each existing directory synchronously, including
 * the root, before visiting its child. It must not await, mutate or retain state
 * as authority for a later call/effect. Legacy/default traversal is unchanged.
 */
export function safeDirectory(path: string, create?: boolean): boolean;
export function safeDirectory(
  path: string,
  create: false,
  inspectExisting: (path: string, stat: Stats) => void,
): boolean;
export function safeDirectory(
  path: string,
  create = false,
  inspectExisting?: (path: string, stat: Stats) => void,
): boolean {
  const full = resolve(path);
  const root = parse(full).root;
  if (inspectExisting) {
    const st = lstatSync(root);
    if (!st.isDirectory() || st.isSymbolicLink())
      throw new Error("Unsafe directory");
    inspectExisting(root, st);
  }
  let at = root;
  for (const part of full.slice(root.length).split(sep).filter(Boolean)) {
    at = join(at, part);
    let existing: Stats | undefined;
    try {
      // One no-follow observation per component: a link is never reported as
      // a directory, and the inspection sees this same, latest observation.
      const checked = lstatSync(at);
      if (!checked.isDirectory() || checked.isSymbolicLink())
        throw new Error("Unsafe directory");
      existing = checked;
    } catch (error) {
      if (!absent(error)) throw error;
      if (!create) return false;
      try {
        mkdirSync(at, { mode: 0o700 });
      } catch (mkdirError) {
        if (!object(mkdirError) || mkdirError.code !== "EEXIST")
          throw mkdirError;
      }
      const created = lstatSync(at);
      if (!created.isDirectory() || created.isSymbolicLink())
        throw new Error("Unsafe directory");
    }
    // Outside the ENOENT handler: an inspection refusal is never absence and
    // must not authorize creation, even if its error happens to carry ENOENT.
    if (existing) inspectExisting?.(at, existing);
  }
  return true;
}
const transientWindows = new Set(["EPERM", "EACCES", "EBUSY"]);
/** Windows refuses to replace, remove or recreate a path while another process
 * holds it (a polling reader, antivirus, a delete still pending), which POSIX
 * never does. Retry the same operation briefly; `recheck` reasserts the
 * caller's expected bytes before every retry, so a retry never overwrites a
 * change. Other errors, including EEXIST and ENOENT, keep their meaning. */
export function retryWindowsFileOperation<T>(
  operation: () => T,
  recheck?: () => void,
): T {
  if (process.platform !== "win32") return operation();
  const deadline = performance.now() + 2000;
  for (let delay = 2; ; delay = Math.min(delay * 2, 50)) {
    try {
      return operation();
    } catch (error) {
      if (
        !object(error) ||
        !transientWindows.has(String(error.code)) ||
        performance.now() >= deadline
      )
        throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
      recheck?.();
    }
  }
}
/** `packaged` reads the installed package's own files (web assets, Agent
 * profiles). A package manager may hard-link them into its store (Bun's default
 * backend), so a second link is not an alias of workspace or task state; their
 * callers bind content instead. Every other read stays single-link. */
export function readBounded(
  path: string,
  max: number,
  packaged = false,
): Buffer | undefined {
  if (!safeDirectory(dirname(path))) return undefined;
  let fd: number;
  try {
    const st = lstatSync(path);
    if (
      !st.isFile() ||
      st.isSymbolicLink() ||
      (!packaged && st.nlink !== 1) ||
      st.size > max
    )
      throw new Error("Unsafe or oversized file");
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (error) {
    if (absent(error)) return undefined;
    throw error;
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || (!packaged && st.nlink !== 1) || st.size > max)
      throw new Error("Unsafe or oversized file");
    // Read at most max+1 even if another editor grows the file after stat.
    const buffer = Buffer.alloc(max + 1);
    let size = 0;
    while (size < buffer.length) {
      const n = readSync(fd, buffer, size, buffer.length - size, null);
      if (!n) break;
      size += n;
    }
    if (size > max) throw new Error("Oversized file");
    return buffer.subarray(0, size);
  } finally {
    closeSync(fd);
  }
}

/** Git observations describe the physical cwd, not inherited alternate
 * index/worktree overrides. Root never borrows sudo's original user's trust. */
export function gitEnvironment(): NodeJS.ProcessEnv {
  const root = process.getuid?.() === 0;
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => !name.startsWith("GIT_") && !(root && name === "SUDO_UID"),
      ),
    ),
    GIT_OPTIONAL_LOCKS: "0",
    LC_ALL: "C",
  };
}
/** Observation is not permission to trust another account's repository.
 * Even with fsmonitor/textconv/ext-diff disabled, status/diff can invoke clean
 * or process filters. Root therefore requires Git's own ownership check, with
 * no safe.directory exceptions (including inherited wildcards). No config is
 * written and ordinary-user trust behavior stays unchanged. */
export function gitArguments(args: string[]): string[] {
  return process.platform !== "win32" && process.getuid?.() === 0
    ? ["-c", "safe.directory=", "-c", "core.fsmonitor=false", ...args]
    : args;
}
export function resolveWorkspace(cwd: string): { root: string; cwd: string } {
  const actual = realpathSync(cwd);
  const result = spawnSync(
    "git",
    gitArguments(["rev-parse", "--show-toplevel"]),
    {
      cwd: actual,
      env: gitEnvironment(),
      encoding: "utf8",
      timeout: 3000,
      maxBuffer: 8192,
      windowsHide: true,
    },
  );
  // Remove only Git's record terminator, not valid whitespace in a path.
  const topLevel = result.stdout?.replace(
    process.platform === "win32" ? /\r?\n$/ : /\n$/,
    "",
  );
  if (result.status === 0 && topLevel)
    return { root: realpathSync(topLevel), cwd: actual };
  if (result.error && !object(result.error))
    throw new Error("Cannot resolve workspace");
  if (result.error && object(result.error) && result.error.code !== "ENOENT")
    throw new Error("Workspace lookup failed");
  // A missing Git executable or a confirmed non-repository is an honest non-Git workspace.
  if (!result.error && !result.stderr.includes("not a git repository"))
    throw new Error("Git workspace lookup refused");
  return { root: actual, cwd: actual };
}
export function defaultStateHome(): string {
  const candidate =
    process.platform === "win32"
      ? process.env.LOCALAPPDATA
      : process.env.XDG_STATE_HOME;
  if (candidate && !isAbsolute(candidate))
    throw new Error("State home must be absolute");
  return (
    candidate ??
    join(
      homedir(),
      process.platform === "win32" ? "AppData/Local" : ".local/state",
    )
  );
}
/** Resolve ambient aliases, including a missing tail, without creating anything. */
export function canonicalAmbientRoot(path: string): string {
  const full = resolve(path);
  try {
    return realpathSync(full);
  } catch (error) {
    if (!absent(error)) throw error;
    // A dangling alias is not a missing ambient directory.
    try {
      lstatSync(full);
      throw new Error("Dangling ambient root");
    } catch (statError) {
      if (!absent(statError)) throw statError;
    }
    const parent = dirname(full);
    if (parent === full) throw error;
    return join(canonicalAmbientRoot(parent), full.slice(parent.length));
  }
}
export function privateRootFor(
  canonicalRoot: string,
  stateHome: string,
): string {
  return join(
    canonicalAmbientRoot(stateHome),
    "cadence-assistant-v1",
    createHash("sha256").update(canonicalRoot).digest("hex"),
  );
}
export function contains(root: string, path: string): boolean {
  const within = relative(root, resolve(path));
  return (
    !within ||
    (!within.startsWith(`..${sep}`) && within !== ".." && !isAbsolute(within))
  );
}
/** Private history, locks and access material must stay outside the working
 * copy, or change observation, check freshness and review would see them. */
export function stateHomeInside(
  root: string,
  stateHome = defaultStateHome(),
): boolean {
  const canonical = realpathSync(root);
  return contains(canonical, privateRootFor(canonical, stateHome));
}
/** Also exclude projects *inside* our reserved private namespace. Root access
 * does not turn private history/coordination into an ordinary engineering tree.
 * Resolves missing tails without creating anything (for explicit project mkdir). */
export function privateWorkspace(
  requested: string,
  stateHome = defaultStateHome(),
): boolean {
  return contains(
    join(canonicalAmbientRoot(stateHome), "cadence-assistant-v1"),
    canonicalAmbientRoot(requested),
  );
}
/** A project must be explicit and outside private state. Never choose, create or
 * reconstruct a default workspace. The workbench itself has no project cwd. */
export function effectiveWorkspace(
  requested: string,
  stateHome?: string,
  _home?: string,
): { workspace: string; redirected: boolean } {
  if (
    privateWorkspace(requested, stateHome) ||
    stateHomeInside(resolveWorkspace(requested).root, stateHome)
  )
    throw new Error(
      "Choose a project outside Cadence private state; no default workspace was created",
    );
  return { workspace: requested, redirected: false };
}
