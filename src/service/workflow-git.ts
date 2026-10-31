/** Workflow Git observations and exact write scopes. In-run observations spawn
 * asynchronously so a large repository never stalls the owner's event loop;
 * admission keeps a small names-only synchronous observation. Contents are
 * hashed by streaming, never buffered as a diff. No config writes. */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readlinkSync,
  readSync,
  realpathSync,
  type Stats,
} from "node:fs";
import { lstat, open, readdir, readlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  gitArguments,
  gitEnvironment,
  readBounded,
  safeDirectory,
} from "../task-store.ts";
import { ContractError } from "./contracts/core.ts";
import {
  type WorkflowPlan,
  workflowCovers,
  workflowPath,
} from "./contracts/workflow.ts";
import { hash } from "./private-files.ts";

/** Names-only Git output (one entry per changed path). */
const NAMES_BYTES = 64 * 1024 * 1024;
const SYNC_MS = 30_000;
const READ_MS = 120_000;
/** Larger files use a stat identity instead of a full content hash. */
const HASH_BYTES = 64 * 1024 * 1024;
const CHUNK = 1024 * 1024;
const PROJECT_BYTES = 1024 * 1024;

/** A refusal with an explanation; the public code stays one of ERROR_CODES. */
export class WorkflowRefusal extends ContractError {
  constructor(
    code: "conflict" | "stale" | "forbidden" | "invalid",
    readonly detail: string,
  ) {
    super(code);
  }
}

export function gitRead(cwd: string, args: string[]): string {
  const r = spawnSync("git", gitArguments(args), {
    cwd,
    env: gitEnvironment(),
    encoding: "utf8",
    timeout: SYNC_MS,
    maxBuffer: NAMES_BYTES,
    windowsHide: true,
  });
  if (r.error || r.status !== 0) throw new ContractError("unavailable");
  return r.stdout;
}
/** Synchronous read where exit 1 is an answer (check-ignore), not a failure. */
function gitAnswer(cwd: string, args: string[]): string | null {
  const r = spawnSync("git", gitArguments(args), {
    cwd,
    env: gitEnvironment(),
    encoding: "utf8",
    timeout: SYNC_MS,
    maxBuffer: NAMES_BYTES,
    windowsHide: true,
  });
  if (r.error || (r.status !== 0 && r.status !== 1))
    throw new ContractError("unavailable");
  return r.status === 0 ? r.stdout : null;
}
/** Asynchronous bounded Git read; the exit code is returned for callers that branch on it. */
export function gitRun(
  cwd: string,
  args: string[],
  timeoutMs = READ_MS,
): Promise<{ code: number | null; stdout: string }> {
  return new Promise((done, fail) => {
    const child = spawn("git", gitArguments(args), {
      cwd,
      env: gitEnvironment(),
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    let bytes = 0,
      broken = false;
    const timer = setTimeout(() => {
      broken = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > NAMES_BYTES) {
        broken = true;
        child.kill("SIGKILL");
      } else chunks.push(chunk);
    });
    child.once("error", () => {
      broken = true;
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (broken) fail(new ContractError("unavailable"));
      else done({ code, stdout: Buffer.concat(chunks).toString("utf8") });
    });
  });
}
export async function gitText(
  cwd: string,
  args: string[],
  timeoutMs = READ_MS,
): Promise<string> {
  const r = await gitRun(cwd, args, timeoutMs);
  if (r.code !== 0) throw new ContractError("unavailable");
  return r.stdout;
}
export async function gitHead(cwd: string): Promise<string> {
  return (await gitText(cwd, ["rev-parse", "--verify", "HEAD"])).trim();
}
function contains(root: string, path: string): boolean {
  const within = relative(root, path);
  return (
    !within ||
    (!within.startsWith(`..${sep}`) && within !== ".." && !isAbsolute(within))
  );
}
/** Either directory containing the other: worktrees never nest with the checkout. */
export function nested(a: string, b: string): boolean {
  return contains(a, b) || contains(b, a);
}
export function safeWorkflowFile(cwd: string, name: string): string {
  workflowPath(name);
  const p = resolve(cwd, name);
  if (relative(cwd, p).startsWith("..")) throw new ContractError("forbidden");
  safeDirectory(dirname(p));
  try {
    const st = lstatSync(p);
    if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1)
      throw new ContractError("forbidden");
  } catch (e) {
    if (!(e instanceof Error && "code" in e && e.code === "ENOENT")) throw e;
  }
  return p;
}
/** A declared target may be an absent path, a regular file or a directory scope. */
function declaredTarget(cwd: string, name: string): void {
  workflowPath(name);
  const p = resolve(cwd, name);
  if (relative(cwd, p).startsWith("..")) throw new ContractError("forbidden");
  safeDirectory(dirname(p));
  try {
    const st = lstatSync(p);
    if (
      st.isSymbolicLink() ||
      (!st.isFile() && !st.isDirectory()) ||
      (st.isFile() && st.nlink !== 1)
    )
      throw new ContractError("forbidden");
  } catch (e) {
    if (!(e instanceof Error && "code" in e && e.code === "ENOENT")) throw e;
  }
}
const absent = (e: unknown) =>
  e instanceof Error &&
  "code" in e &&
  (e.code === "ENOENT" || e.code === "ENOTDIR");
/** Directory scopes are observed by content, bounded: a larger tree must be
 * declared through narrower paths. Nested repositories are not traversed. */
const DIRECTORY_ENTRIES = 20_000;
/** Inside a directory scope larger files use a stat identity. */
const DIRECTORY_HASH_BYTES = 1024 * 1024;
function quickIdentity(st: Stats, hashBytes: number): string | undefined {
  if (!st.isFile()) return `special:${st.mode}`;
  if (st.size > hashBytes)
    return `stat:${st.size}:${st.mtimeMs}:${st.ctimeMs}:${st.ino}`;
  return undefined;
}
function fileIdentity(p: string, st: Stats, hashBytes: number): string | null {
  if (st.isSymbolicLink()) return `link:${hash(readlinkSync(p))}`;
  const quick = quickIdentity(st, hashBytes);
  if (quick) return quick;
  let fd: number;
  try {
    fd = openSync(p, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (e) {
    if (absent(e)) return null;
    throw e;
  }
  try {
    if (!fstatSync(fd).isFile()) throw new ContractError("stale");
    const digest = createHash("sha256"),
      buffer = Buffer.alloc(CHUNK);
    for (let n = readSync(fd, buffer); n > 0; n = readSync(fd, buffer))
      digest.update(buffer.subarray(0, n));
    return `sha256:${digest.digest("hex")}`;
  } finally {
    closeSync(fd);
  }
}
async function fileIdentityAsync(
  p: string,
  st: Stats,
  hashBytes: number,
): Promise<string | null> {
  if (st.isSymbolicLink()) return `link:${hash(await readlink(p))}`;
  const quick = quickIdentity(st, hashBytes);
  if (quick) return quick;
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(p, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (e) {
    if (absent(e)) return null;
    throw e;
  }
  try {
    const digest = createHash("sha256"),
      buffer = Buffer.alloc(CHUNK);
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, CHUNK, null);
      if (!bytesRead) break;
      digest.update(buffer.subarray(0, bytesRead));
    }
    return `sha256:${digest.digest("hex")}`;
  } finally {
    await handle.close();
  }
}
const tooLarge = (name: string) =>
  new WorkflowRefusal(
    "invalid",
    `Declared directory ${name} has more than ${DIRECTORY_ENTRIES} entries; declare narrower write paths.`,
  );
function directoryIdentity(root: string, name: string): string {
  const rows: string[] = [];
  let count = 0;
  const visit = (directory: string, prefix: string) => {
    for (const entry of readdirSync(directory).sort()) {
      if (entry === ".git") continue;
      if (++count > DIRECTORY_ENTRIES) throw tooLarge(name);
      const full = join(directory, entry),
        relative = `${prefix}${entry}`;
      const st = lstatSync(full);
      if (st.isDirectory()) {
        rows.push(`${relative}/`);
        visit(full, `${relative}/`);
      } else
        rows.push(
          `${relative}\0${fileIdentity(full, st, DIRECTORY_HASH_BYTES)}`,
        );
    }
  };
  visit(root, "");
  return `directory:${hash(rows.join("\n"))}`;
}
async function directoryIdentityAsync(
  root: string,
  name: string,
): Promise<string> {
  const rows: string[] = [];
  let count = 0;
  const visit = async (directory: string, prefix: string) => {
    for (const entry of (await readdir(directory)).sort()) {
      if (entry === ".git") continue;
      if (++count > DIRECTORY_ENTRIES) throw tooLarge(name);
      const full = join(directory, entry),
        relative = `${prefix}${entry}`;
      const st = await lstat(full);
      if (st.isDirectory()) {
        rows.push(`${relative}/`);
        await visit(full, `${relative}/`);
      } else
        rows.push(
          `${relative}\0${await fileIdentityAsync(full, st, DIRECTORY_HASH_BYTES)}`,
        );
    }
  };
  await visit(root, "");
  return `directory:${hash(rows.join("\n"))}`;
}
/** Streaming content identity: no size ceiling makes a target unplannable.
 * A directory's identity covers its contents unless `walk` is false (a Git
 * scope pinned by HEAD plus the dirty check needs no tree walk). */
export function pathIdentity(
  cwd: string,
  name: string,
  walk = true,
): string | null {
  const p = resolve(cwd, name);
  if (relative(cwd, p).startsWith("..")) throw new ContractError("forbidden");
  let st: Stats;
  try {
    st = lstatSync(p);
  } catch (e) {
    if (absent(e)) return null;
    throw e;
  }
  if (st.isDirectory()) return walk ? directoryIdentity(p, name) : "directory";
  return fileIdentity(p, st, HASH_BYTES);
}
export async function pathIdentityAsync(
  cwd: string,
  name: string,
): Promise<string | null> {
  const p = resolve(cwd, name);
  if (relative(cwd, p).startsWith("..")) throw new ContractError("forbidden");
  let st: Stats;
  try {
    st = await lstat(p);
  } catch (e) {
    if (absent(e)) return null;
    throw e;
  }
  if (st.isDirectory()) return directoryIdentityAsync(p, name);
  return fileIdentityAsync(p, st, HASH_BYTES);
}
export function contentsIdentity(cwd: string, paths: readonly string[]) {
  return hash(JSON.stringify(paths.map((p) => [p, pathIdentity(cwd, p)])));
}
export async function contentsIdentityAsync(
  cwd: string,
  paths: readonly string[],
): Promise<string> {
  const rows = [];
  for (const p of paths) rows.push([p, await pathIdentityAsync(cwd, p)]);
  return hash(JSON.stringify(rows));
}
const names = (s: string) => s.split("\0").filter(Boolean);
const CHANGED = [
  [
    "diff",
    "--name-only",
    "-z",
    "--no-renames",
    "--no-ext-diff",
    "--no-textconv",
    "HEAD",
    "--",
  ],
  // HEAD -> working tree alone can hide staged bytes when the worktree
  // was restored to HEAD. The commit consumes the index, not that view.
  [
    "diff",
    "--cached",
    "--name-only",
    "-z",
    "--no-renames",
    "--no-ext-diff",
    "--no-textconv",
    "HEAD",
    "--",
  ],
  ["ls-files", "--others", "--exclude-standard", "-z"],
];
export function workflowChanged(cwd: string): string[] {
  return [...new Set(CHANGED.flatMap((args) => names(gitRead(cwd, args))))];
}
export async function changedPaths(cwd: string): Promise<string[]> {
  const outputs = await Promise.all(CHANGED.map((args) => gitText(cwd, args)));
  return [...new Set(outputs.flatMap(names))];
}
/** A changed path overlaps a scope when either contains the other. */
export function overlapping(
  scope: readonly string[],
  changed: readonly string[],
): string[] {
  return changed
    .filter(
      (p) =>
        workflowCovers(scope, p) || scope.some((q) => q.startsWith(`${p}/`)),
    )
    .sort();
}
const list = (paths: readonly string[]) =>
  `${paths.slice(0, 32).join(", ")}${paths.length > 32 ? ` and ${paths.length - 32} more` : ""}`;
export async function assertWorkflowScope(
  cwd: string,
  allowed: readonly string[],
): Promise<string[]> {
  const changes = await changedPaths(cwd);
  const outside = changes.filter((name) => !workflowCovers(allowed, name));
  if (outside.length)
    throw new WorkflowRefusal(
      "forbidden",
      `Changes outside the approved write scope were preserved, not committed: ${list(outside.sort())}`,
    );
  for (const name of changes) safeWorkflowFile(cwd, name);
  return changes;
}
/** A task commit must extend its observed baseline and contain only its scope. */
export async function assertWorkflowCommit(
  cwd: string,
  before: string,
  commit: string,
  allowed: readonly string[],
): Promise<string[]> {
  if (
    (await gitText(cwd, ["show", "-s", "--format=%P", commit])).trim() !==
    before
  )
    throw new ContractError("stale");
  const changed = await committedPaths(cwd, before, commit);
  const outside = changed.filter((name) => !workflowCovers(allowed, name));
  if (outside.length)
    throw new WorkflowRefusal(
      "forbidden",
      `Commit contains files outside the approved scope: ${list(outside)}`,
    );
  for (const name of changed) safeWorkflowFile(cwd, name);
  return changed;
}
export async function committedPaths(
  cwd: string,
  from: string,
  to: string,
): Promise<string[]> {
  return names(
    await gitText(cwd, [
      "diff",
      "--name-only",
      "-z",
      "--no-renames",
      "--no-ext-diff",
      "--no-textconv",
      from,
      to,
      "--",
    ]),
  ).sort();
}
/** Consent observation: branch/HEAD, declared target contents and project
 * guidance, plus a refusal when a declared target is already dirty. Unrelated
 * dirty files are not part of it: they never block planning or delivery. */
export function workflowObservation(
  cwd: string,
  plan?: WorkflowPlan,
): { identity: string; head: string; branch: string } {
  const declared = [...new Set(plan?.tasks.flatMap((t) => t.writes) ?? [])];
  for (const p of declared) declaredTarget(cwd, p);
  const paths = [...new Set([".cadence/project.md", "AGENTS.md", ...declared])];
  const working = plan?.delivery === "working-copy";
  const contents = paths.map((p) => [p, pathIdentity(cwd, p, working)]);
  if (working) {
    // The ordinary bounded working-copy observation is additionally taken by the
    // service; this exact per-write identity refuses substituted direct targets.
    return { identity: hash(JSON.stringify(contents)), head: "", branch: "" };
  }
  const head = gitRead(cwd, ["rev-parse", "--verify", "HEAD"]).trim();
  const branch = gitRead(cwd, ["symbolic-ref", "HEAD"]).trim();
  if (!/^refs\/heads\//u.test(branch) || !/^[a-f0-9]{40,64}$/u.test(head))
    throw new ContractError("invalid");
  if (plan) {
    // A task cannot implicitly adopt dirty inputs as its committed baseline.
    const dirty = overlapping(declared, workflowChanged(cwd));
    if (dirty.length)
      throw new WorkflowRefusal(
        "conflict",
        `Declared write targets have uncommitted changes: ${list(dirty)}. Commit, stash or leave them out of the plan; Cadence never adopts dirty inputs.`,
      );
    // An ignored target is never committed: its edit could only be lost with
    // the worktree. Local merge refuses it; working-copy delivery edits in place.
    const ignored = gitAnswer(cwd, ["check-ignore", "--", ...declared]);
    if (ignored !== null)
      throw new WorkflowRefusal(
        "invalid",
        `Declared write targets are ignored by Git and cannot be delivered by local merge: ${list(
          ((names) =>
            names.length ? names : ignored.split("\n").filter(Boolean))(
            declared.filter((p) => ignored.split("\n").includes(p)),
          ).sort(),
        )}. Use working-copy delivery or change the ignore rules.`,
      );
    gitRead(cwd, ["var", "GIT_AUTHOR_IDENT"]);
    gitRead(cwd, ["var", "GIT_COMMITTER_IDENT"]);
  }
  return {
    head,
    branch,
    identity: hash(JSON.stringify({ head, branch, contents })),
  };
}
/** Only what a safe fast-forward needs: the same branch and HEAD, and no dirty
 * declared/generated target. Unrelated user changes are left to `merge --ff-only`. */
export async function assertTarget(
  cwd: string,
  expected: { head: string; branch: string },
  scope: readonly string[],
): Promise<void> {
  const head = await gitHead(cwd);
  const branch = (await gitText(cwd, ["symbolic-ref", "HEAD"])).trim();
  if (head !== expected.head || branch !== expected.branch)
    throw new WorkflowRefusal(
      "stale",
      `The target branch changed during the run (expected ${expected.branch} at ${expected.head.slice(0, 12)}); nothing was integrated.`,
    );
  const dirty = overlapping(scope, await changedPaths(cwd));
  if (dirty.length)
    throw new WorkflowRefusal(
      "conflict",
      `Declared targets changed in the checkout during the run: ${list(dirty)}. Nothing was integrated; the candidate is retained.`,
    );
}
export async function tracked(cwd: string, name: string): Promise<boolean> {
  return (
    (await gitRun(cwd, ["ls-files", "--error-unmatch", "--", name])).code === 0
  );
}
/** Where a generated note can land: through the candidate when a fast-forward
 * can deliver it, otherwise written directly after integration. */
export async function documentPlacement(
  cwd: string,
  name: string,
): Promise<"commit" | "direct"> {
  const dirty = (await changedPaths(cwd)).includes(name);
  if (await tracked(cwd, name)) return dirty ? "direct" : "commit";
  if ((await gitRun(cwd, ["check-ignore", "-q", "--", name])).code === 0)
    return "direct";
  return (await pathIdentityAsync(cwd, name)) === null ? "commit" : "direct";
}
/** Anything left under a scope in a worktree, including ignored files that a
 * plain `git worktree remove` would delete. */
export async function scopeResidue(
  cwd: string,
  scope: readonly string[],
): Promise<string[]> {
  if (!scope.length) return [];
  const out = await gitText(cwd, [
    "status",
    "--porcelain=v1",
    "-z",
    "-uall",
    "--ignored=traditional",
    "--no-renames",
    "--",
    ...scope,
  ]);
  return names(out)
    .map((row) => row.slice(3))
    .filter(Boolean)
    .sort();
}
/** Working-copy scope evidence: identity of every changed path plus `extra`.
 * Outside a Git work tree only `extra` (the declared targets) is observable. */
export async function workingSnapshot(
  cwd: string,
  extra: readonly string[],
): Promise<{ git: boolean; paths: Map<string, string | null> }> {
  let changed: string[] = [];
  const inside = await gitRun(cwd, ["rev-parse", "--is-inside-work-tree"]);
  const git = inside.code === 0 && inside.stdout.trim() === "true";
  if (git) {
    const born = await gitRun(cwd, ["rev-parse", "--verify", "HEAD"]);
    changed =
      born.code === 0
        ? await changedPaths(cwd)
        : names(
            await gitText(cwd, [
              "ls-files",
              "--cached",
              "--others",
              "--exclude-standard",
              "-z",
            ]),
          );
  }
  const paths = new Map<string, string | null>();
  for (const p of new Set([...changed, ...extra]))
    paths.set(p, await pathIdentityAsync(cwd, p));
  return { git, paths };
}
export function snapshotChanges(
  before: Map<string, string | null>,
  after: Map<string, string | null>,
): string[] {
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((p) => (before.get(p) ?? null) !== (after.get(p) ?? null))
    .sort();
}
export function projectMarkdown(cwd: string, context: string): string {
  const file = safeWorkflowFile(cwd, ".cadence/project.md");
  const previous =
    readBounded(file, PROJECT_BYTES)?.toString("utf8") ??
    "# Cadence project context\n";
  const start = "<!-- CADENCE:PROJECT:START -->",
    end = "<!-- CADENCE:PROJECT:END -->";
  if (
    previous.split(start).length !== previous.split(end).length ||
    previous.split(start).length > 2
  )
    throw new WorkflowRefusal(
      "conflict",
      ".cadence/project.md has unbalanced Cadence managed-region markers.",
    );
  const block = `${start}\n${context}\n${end}`;
  if (!previous.includes(start)) return `${previous.trimEnd()}\n\n${block}\n`;
  if (previous.indexOf(end) < previous.indexOf(start))
    throw new WorkflowRefusal(
      "conflict",
      ".cadence/project.md has misordered Cadence managed-region markers.",
    );
  return (
    previous.slice(0, previous.indexOf(start)) +
    block +
    previous.slice(previous.indexOf(end) + end.length)
  );
}
/** Existing package dependencies must be provisioned by plan.setup, never copied implicitly. */
export async function assertWorktree(root: string, cwd: string): Promise<void> {
  if (!safeDirectory(cwd)) throw new ContractError("stale");
  const real = (p: string) => realpathSync(resolve(p));
  if (
    real((await gitText(cwd, ["rev-parse", "--show-toplevel"])).trim()) !==
    real(cwd)
  )
    throw new ContractError("stale");
  const common = async (p: string) =>
    real(
      resolve(p, (await gitText(p, ["rev-parse", "--git-common-dir"])).trim()),
    );
  if ((await common(root)) !== (await common(cwd)))
    throw new ContractError("stale");
  const marker = resolve(cwd, ".git");
  if (
    !lstatSync(marker).isFile() ||
    !(readBounded(marker, 8192)?.toString("utf8") ?? "").startsWith("gitdir: ")
  )
    throw new ContractError("stale");
}
