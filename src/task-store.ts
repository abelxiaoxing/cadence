import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  renameSync,
  type Stats,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, hostname } from "node:os";
import {
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  decodeCheck,
  decodeTask,
  MAX_RECORD_BYTES,
  object,
  type TaskRecord,
  validId,
} from "./task-types.ts";
import { diagnosticText } from "./verification-diagnostics.ts";

function parseRecord(data: Buffer): unknown {
  try {
    return JSON.parse(data.toString("utf8"));
  } catch {
    throw new Error("Corrupt JSON state; preserved without reset");
  }
}
function absent(error: unknown): boolean {
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
/** Canonical bytes written by save; identity is optimistic record concurrency, not consent. */
function recordText(record: TaskRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}
function contentIdentity(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex");
}
export function savedRecordIdentity(record: TaskRecord): string {
  return contentIdentity(recordText(record));
}
/** Resolve ambient aliases, including a missing tail, without creating anything. */
function canonicalAmbientRoot(path: string): string {
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
function privateRootFor(canonicalRoot: string, stateHome: string): string {
  return join(
    canonicalAmbientRoot(stateHome),
    "cadence-assistant-v1",
    createHash("sha256").update(canonicalRoot).digest("hex"),
  );
}
function contains(root: string, path: string): boolean {
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
export const LANDING_WORKSPACE = "cadence";
/** A directory that contains the private state home (the home directory and
 * its ancestors) can never be a workspace; use ~/cadence instead of refusing.
 * Observation only: the caller decides whether the landing may be created. */
export function effectiveWorkspace(
  requested: string,
  stateHome?: string,
  home = homedir(),
): { workspace: string; redirected: boolean } {
  if (privateWorkspace(requested, stateHome))
    throw new Error("Private state cannot be a workspace");
  if (!stateHomeInside(resolveWorkspace(requested).root, stateHome))
    return { workspace: requested, redirected: false };
  return { workspace: join(home, LANDING_WORKSPACE), redirected: true };
}
export interface CheckoutLock {
  schema: "cadence-assistant-lock/1";
  token: string;
  pid: number;
  host: string;
  runId: string;
  root: string;
}
export class TaskStore {
  readonly root: string;
  readonly tasks: string;
  readonly privateRoot: string;
  constructor(root: string, stateHome = defaultStateHome()) {
    this.root = realpathSync(root);
    if (privateWorkspace(this.root, stateHome))
      throw new Error("Private state cannot be a workspace");
    this.tasks = join(this.root, ".cadence", "assistant", "tasks");
    this.privateRoot = privateRootFor(this.root, stateHome);
    if (contains(this.root, this.privateRoot))
      throw new Error("Private state home must be outside the working copy");
  }
  get lockPath(): string {
    return join(this.privateRoot, "checkout.lock");
  }
  private inspectPrivate(): void {
    const namespace = dirname(this.privateRoot);
    for (const path of [namespace, this.privateRoot]) {
      if (!safeDirectory(path)) continue;
      const st = lstatSync(path);
      if (
        process.platform !== "win32" &&
        ((st.mode & 0o077) !== 0 ||
          (process.getuid && st.uid !== process.getuid()))
      )
        throw new Error("Private state permissions refused");
    }
  }
  private inspectPrivateFile(path: string, max: number): void {
    this.inspectPrivate();
    if (!safeDirectory(this.privateRoot)) return;
    try {
      const st = lstatSync(path);
      if (
        !st.isFile() ||
        st.isSymbolicLink() ||
        st.nlink !== 1 ||
        st.size > max ||
        (process.platform !== "win32" &&
          ((st.mode & 0o077) !== 0 ||
            (process.getuid && st.uid !== process.getuid())))
      )
        throw new Error("Unsafe private state file");
    } catch (error) {
      if (!absent(error)) throw error;
    }
  }
  inspectLock(): CheckoutLock | undefined {
    this.inspectPrivateFile(this.lockPath, 8192);
    const data = readBounded(this.lockPath, 8192);
    if (!data) return undefined;
    const lock: unknown = parseRecord(data);
    if (
      !object(lock) ||
      lock.schema !== "cadence-assistant-lock/1" ||
      lock.root !== this.root ||
      typeof lock.token !== "string" ||
      !validId(lock.token) ||
      typeof lock.runId !== "string" ||
      !validId(lock.runId) ||
      typeof lock.host !== "string" ||
      !Number.isInteger(lock.pid) ||
      Number(lock.pid) < 1
    )
      throw new Error("Unknown or corrupt coordination lock");
    return lock as unknown as CheckoutLock;
  }
  acquire(): CheckoutLock {
    this.inspectPrivate();
    safeDirectory(this.privateRoot, true);
    const lock: CheckoutLock = {
      schema: "cadence-assistant-lock/1",
      token: randomUUID(),
      runId: randomUUID(),
      pid: process.pid,
      host: hostname(),
      root: this.root,
    };
    let fd: number;
    try {
      fd = retryWindowsFileOperation(() =>
        openSync(this.lockPath, "wx", 0o600),
      );
    } catch {
      throw new Error(
        "Checkout busy or unresolved lock; inspect and explicitly recover only a dead owner",
      );
    }
    try {
      writeFileSync(fd, JSON.stringify(lock));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    return lock;
  }
  assertOwner(lock: CheckoutLock): void {
    if (JSON.stringify(this.inspectLock()) !== JSON.stringify(lock))
      throw new Error("Coordination lock changed");
  }
  release(lock: CheckoutLock): void {
    if (lock.pid !== process.pid || lock.host !== hostname())
      throw new Error("Only the owning process may release a lock");
    this.assertOwner(lock);
    retryWindowsFileOperation(
      () => unlinkSync(this.lockPath),
      () => this.assertOwner(lock),
    );
  }
  recover(expected: CheckoutLock, acknowledgeEscapedProcesses: boolean): void {
    if (!acknowledgeEscapedProcesses || expected.host !== hostname())
      throw new Error("Recovery requires informed local-owner confirmation");
    this.assertOwner(expected);
    try {
      process.kill(expected.pid, 0);
    } catch (error) {
      if (!object(error) || error.code !== "ESRCH")
        throw new Error("Owner status unknown");
      this.assertOwner(expected);
      unlinkSync(this.lockPath);
      return;
    }
    throw new Error("Owner is live; stop it first");
  }
  load(id: string): TaskRecord | undefined {
    return this.loadSnapshot(id)?.record;
  }
  loadSnapshot(
    id: string,
  ): { record: TaskRecord; identity: string } | undefined {
    if (!validId(id)) throw new Error("Invalid task id");
    const directory = join(this.tasks, id);
    if (
      safeDirectory(directory) &&
      readdirSync(directory).some((name) => name !== "task.json")
    )
      throw new Error(
        "Unknown task directory content; preserved without reset",
      );
    const data = readBounded(
      join(this.tasks, id, "task.json"),
      MAX_RECORD_BYTES,
    );
    if (!data) return undefined;
    const record = decodeTask(parseRecord(data));
    if (record.id !== id) throw new Error("Task identity mismatch");
    return { record, identity: contentIdentity(data) };
  }
  list(): TaskRecord[] {
    if (!safeDirectory(this.tasks)) return [];
    const entries = readdirSync(this.tasks);
    if (entries.length > 1000) throw new Error("Task listing limit exceeded");
    return entries.map((id) => {
      const task = this.load(id);
      if (!task) throw new Error("Unknown task directory");
      return task;
    });
  }
  save(
    record: TaskRecord,
    expectedRevision: number,
    held?: CheckoutLock,
    expectedIdentity?: string,
  ): TaskRecord {
    const next = decodeTask(record);
    if (next.revision !== expectedRevision + 1)
      throw new Error("Revision conflict");
    const text = recordText(next);
    if (Buffer.byteLength(text) > MAX_RECORD_BYTES)
      throw new Error("Task record limit");
    const lock = held ?? this.acquire();
    if (lock.pid !== process.pid || lock.host !== hostname())
      throw new Error("Not the lock owner");
    try {
      this.assertOwner(lock);
      const current = this.loadSnapshot(next.id);
      if ((current?.record.revision ?? 0) !== expectedRevision)
        throw new Error("Revision conflict");
      if (current?.identity !== expectedIdentity)
        throw new Error("Task content changed; reopen it");
      const dir = join(this.tasks, next.id);
      safeDirectory(dir, true);
      // Unknown sibling state is not overwritten or cleaned.
      if (!current && readdirSync(dir).length)
        throw new Error("Unknown task directory");
      const temporary = join(dir, `task.${randomUUID()}.tmp`);
      const fd = openSync(temporary, "wx", 0o600);
      try {
        writeFileSync(fd, text);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      this.assertOwner(lock);
      // Check again after preparing the replacement. External editors do not share our lock;
      // this detects observed conflicts, not an atomic filesystem CAS against hostile writers.
      const latest = readBounded(join(dir, "task.json"), MAX_RECORD_BYTES);
      if ((latest ? contentIdentity(latest) : undefined) !== expectedIdentity)
        throw new Error(
          "Task content changed; replacement preserved without overwrite",
        );
      retryWindowsFileOperation(
        () => renameSync(temporary, join(dir, "task.json")),
        () => {
          this.assertOwner(lock);
          const now = readBounded(join(dir, "task.json"), MAX_RECORD_BYTES);
          if ((now ? contentIdentity(now) : undefined) !== expectedIdentity)
            throw new Error(
              "Task content changed; replacement preserved without overwrite",
            );
        },
      );
      return next;
    } finally {
      if (!held) this.release(lock);
    }
  }
  checks() {
    const data = readBounded(
      join(this.root, ".cadence", "assistant", "config.json"),
      32768,
    );
    if (!data) return [];
    const value: unknown = parseRecord(data);
    if (
      !object(value) ||
      value.schema !== TASK_CONFIG_SCHEMA ||
      !Array.isArray(value.checks) ||
      value.checks.length > 32 ||
      Object.keys(value).some((key) => !["schema", "checks"].includes(key))
    )
      throw new Error("Unknown check configuration");
    const checks = value.checks.map(decodeCheck);
    if (
      new Set(checks.map((check) => check.name)).size !== checks.length ||
      checks.some((check) => check.name === "Manual command")
    )
      throw new Error("Duplicate or reserved check name");
    return checks;
  }
  readLog(name: string): string {
    if (!/^[a-f0-9-]{36}\.log$/.test(name))
      throw new Error("Invalid diagnostic name");
    this.inspectPrivateFile(join(this.privateRoot, name), 65536);
    const data = readBounded(join(this.privateRoot, name), 65536);
    return data
      ? diagnosticText(data.toString("utf8"), 65536)
      : "Private diagnostic unavailable";
  }
  writeLog(lock: CheckoutLock, output: string): string {
    if (lock.pid !== process.pid || lock.host !== hostname())
      throw new Error("Not the lock owner");
    this.assertOwner(lock);
    const name = `${randomUUID()}.log`;
    writeFileSync(join(this.privateRoot, name), diagnosticText(output, 65536), {
      flag: "wx",
      mode: 0o600,
    });
    return name;
  }
}
export const TASK_CONFIG_SCHEMA = "cadence-assistant-checks/1";
