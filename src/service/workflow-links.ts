/** Narrow owner-managed dependency symlinks for isolated delivery worktrees.
 * Creation records exact parent/symlink inode identity before confirming; cleanup
 * re-verifies that identity before unlinkSync and never removes target directories
 * or modified/replaced paths. */
import {
  type Dirent,
  existsSync,
  lstatSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmdirSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { safeDirectory, withinWorkspace } from "../workspace.ts";
import { ContractError } from "./contracts/core.ts";
import {
  WORKFLOW_LIMITS,
  type WorkflowSetupLink,
  workflowBoundary,
  workflowCovers,
  workflowPath,
} from "./contracts/workflow.ts";
import { gitAnswer, gitRead, WorkflowRefusal } from "./workflow-git.ts";

export interface ManagedLinkRecord {
  worktree: string;
  path: string;
  source: string;
  parentDev: number;
  parentIno: number;
  linkDev: number;
  linkIno: number;
  status: "intent" | "confirmed" | "unlinked" | "retained";
  reason?: string;
}

export interface ManagedLinkJournal {
  read(): ManagedLinkRecord[];
  write(records: readonly ManagedLinkRecord[]): void;
}

const isEnoent = (error: unknown): boolean =>
  error instanceof Error &&
  "code" in error &&
  (error.code === "ENOENT" || error.code === "ENOTDIR");

function normalizeWindowsLinkTarget(target: string): string {
  let normalized = target.replace(/^\\\\\?\\/u, "");
  if (!/^[A-Za-z]:[/\\]$/u.test(normalized))
    normalized = normalized.replace(/[/\\]+$/u, "");
  return normalized;
}

/** Compare an observed `readlinkSync` target against the expected target.
 * On Windows, NTFS directory junctions include a trailing backslash (and
 * sometimes a `\\?\` verbatim prefix) that `path.resolve()` omits. */
export function sameLinkTarget(
  observed: string,
  expected: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== "win32") return observed === expected;
  return (
    normalizeWindowsLinkTarget(observed) ===
    normalizeWindowsLinkTarget(expected)
  );
}

/** Shallow readonly proposal-time discovery of plain, untracked, Git-ignored
 * `node_modules` directories (depth <= 2) for local-merge worktrees. Never
 * follows symlinks, never copies files, never descends into `node_modules` or
 * hidden directories, and excludes any path overlapping declared writes. */
export function discoverManagedLinks(
  checkoutRoot: string,
  writes: readonly string[] = [],
): WorkflowSetupLink[] {
  const realRoot = realpathSync(checkoutRoot);
  try {
    if (
      gitRead(realRoot, ["rev-parse", "--is-inside-work-tree"]).trim() !==
      "true"
    )
      return [];
  } catch {
    return [];
  }
  const MAX_DEPTH = 2;
  const MAX_DIRS = 64;
  const MAX_DIR_ENTRIES = 8192;
  const queue: { dir: string; prefix: string; depth: number }[] = [
    { dir: realRoot, prefix: "", depth: 0 },
  ];
  const found: WorkflowSetupLink[] = [];
  let dirs = 0;
  while (queue.length && found.length < WORKFLOW_LIMITS.links) {
    const current = queue.shift() as {
      dir: string;
      prefix: string;
      depth: number;
    };
    let entries: Dirent[];
    try {
      entries = readdirSync(current.dir, { withFileTypes: true }).sort(
        (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
      );
    } catch {
      continue;
    }
    let dirEntries = 0;
    for (const entry of entries) {
      if (++dirEntries > MAX_DIR_ENTRIES) break;
      const name = entry.name;
      if (name.startsWith(".")) continue;
      if (!entry.isDirectory()) continue;
      const full = join(current.dir, name);
      const rel = current.prefix ? `${current.prefix}/${name}` : name;
      let st: ReturnType<typeof lstatSync>;
      try {
        st = lstatSync(full);
      } catch {
        continue;
      }
      if (st.isSymbolicLink() || !st.isDirectory()) continue;
      if (name === "node_modules") {
        try {
          workflowPath(rel, true);
          if (!workflowBoundary(rel)) continue;
          if (
            workflowCovers(writes, rel) ||
            writes.some((w) => workflowCovers([rel], w))
          )
            continue;
          if (gitRead(realRoot, ["ls-files", "--", rel]).trim().length > 0)
            continue;
          if (gitAnswer(realRoot, ["check-ignore", "--", rel]) === null)
            continue;
          found.push({ path: rel, placement: "worktree" });
          if (found.length >= WORKFLOW_LIMITS.links) break;
        } catch {
          /* Skip unreadable or disallowed candidate without mutating anything. */
        }
        continue;
      }
      if (current.depth < MAX_DEPTH && dirs < MAX_DIRS) {
        // Never descend into nested Git repositories or submodules.
        if (existsSync(join(full, ".git"))) continue;
        dirs++;
        queue.push({ dir: full, prefix: rel, depth: current.depth + 1 });
      }
    }
  }
  return found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Validate declared managed links at proposal/admission against the real checkout.
 * Read-only: creates nothing and copies nothing. */
export function validateManagedLinks(
  checkoutRoot: string,
  links: readonly WorkflowSetupLink[],
  writes: readonly string[],
): void {
  if (!links.length) return;
  const realRoot = realpathSync(checkoutRoot);
  for (const link of links) {
    workflowPath(link.path, true);
    const sourceRel = link.source ?? link.path;
    workflowPath(sourceRel, true);
    if (
      workflowCovers(writes, link.path) ||
      writes.some((w) => workflowCovers([link.path], w))
    )
      throw new WorkflowRefusal(
        "invalid",
        `Managed dependency link "${link.path}" overlaps approved write paths; keep dependencies separate from committed edits.`,
      );
    const sourceFull = resolve(realRoot, sourceRel);
    if (!withinWorkspace(realRoot, sourceFull))
      throw new WorkflowRefusal(
        "forbidden",
        `Managed dependency link source "${sourceRel}" escapes the checkout root.`,
      );
    if (!existsSync(sourceFull))
      throw new WorkflowRefusal(
        "invalid",
        `Managed dependency link source "${sourceRel}" does not exist in ${realRoot}.`,
      );
    // Never allow a managed symlink to mask a Git-tracked path.
    let tracked = false;
    try {
      const out = gitRead(realRoot, ["ls-files", "--", link.path]).trim();
      tracked = out.length > 0;
    } catch {
      /* Handled by repository observation elsewhere. */
    }
    if (tracked)
      throw new WorkflowRefusal(
        "invalid",
        `Managed dependency link destination "${link.path}" is tracked by Git; only untracked/ignored dependency directories may be linked.`,
      );
  }
}

/** Verify no path segment between `root` and `dir` is a symlink, creating missing
 * intermediate directories safely inside `root`. */
function ensurePlainParent(
  root: string,
  dir: string,
): { dev: number; ino: number } {
  const realRoot = realpathSync(root);
  const rel = relative(realRoot, dir);
  if (rel.startsWith("..") || rel.includes("\0"))
    throw new ContractError("forbidden");
  if (!safeDirectory(dir, true)) throw new ContractError("forbidden");
  let current = realRoot;
  if (rel) {
    for (const part of rel.split(/[/\\]/u)) {
      if (!part || part === ".") continue;
      current = resolve(current, part);
      const st = lstatSync(current);
      if (st.isSymbolicLink() || !st.isDirectory())
        throw new ContractError("forbidden");
    }
  }
  const parentStat = lstatSync(current);
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory())
    throw new ContractError("forbidden");
  return { dev: parentStat.dev, ino: parentStat.ino };
}

/** Provision declared managed links for `worktreeRoot` (candidate or child).
 * Records intent before creating each symlink and confirms exact dev/ino identity. */
export function provisionManagedLinks(
  targetCheckoutRoot: string,
  worktreeRoot: string,
  links: readonly WorkflowSetupLink[],
  placement: "candidate" | "worktree",
  journal: ManagedLinkJournal,
): void {
  const selected = links.filter(
    (l) => (l.placement ?? "worktree") === placement,
  );
  if (!selected.length) return;
  const realTarget = realpathSync(targetCheckoutRoot);
  const realWorktree = realpathSync(worktreeRoot);
  const records = [...journal.read()];

  for (const link of selected) {
    const sourceRel = link.source ?? link.path;
    const sourceFull = resolve(realTarget, sourceRel);
    if (!withinWorkspace(realTarget, sourceFull) || !existsSync(sourceFull))
      throw new WorkflowRefusal(
        "invalid",
        `Managed dependency link source "${sourceRel}" is unavailable in ${realTarget}.`,
      );
    const linkFull = resolve(realWorktree, link.path);
    if (!withinWorkspace(realWorktree, linkFull))
      throw new ContractError("forbidden");
    const parent = ensurePlainParent(realWorktree, dirname(linkFull));
    let exists = false;
    try {
      lstatSync(linkFull);
      exists = true;
    } catch (error) {
      if (!isEnoent(error)) throw error;
    }
    if (exists)
      throw new WorkflowRefusal(
        "conflict",
        `Managed dependency link destination "${link.path}" already exists in ${realWorktree}; refused to overwrite.`,
      );

    const record: ManagedLinkRecord = {
      worktree: realWorktree,
      path: link.path,
      source: sourceFull,
      parentDev: parent.dev,
      parentIno: parent.ino,
      linkDev: 0,
      linkIno: 0,
      status: "intent",
    };
    records.push(record);
    journal.write(records);

    const isDir = statSync(sourceFull).isDirectory();
    symlinkSync(
      sourceFull,
      linkFull,
      process.platform === "win32" ? (isDir ? "junction" : "file") : undefined,
    );

    const st = lstatSync(linkFull);
    const observedTarget = readlinkSync(linkFull);
    if (!st.isSymbolicLink() || !sameLinkTarget(observedTarget, sourceFull))
      throw new WorkflowRefusal(
        "stale",
        `Managed dependency link "${link.path}" could not be confirmed after creation.`,
      );
    record.linkDev = st.dev;
    record.linkIno = st.ino;
    record.status = "confirmed";
    journal.write(records);
  }
}

/** Return relative paths of owner-provisioned symlinks in `worktreeRoot` whose
 * current on-disk parent and symlink identity still strictly match the confirmed
 * journal record. Used solely so untracked symlinks under trailing-slash
 * `.gitignore` rules (like `node_modules/`) do not break scope checks; never
 * excludes staged/committed paths or `worktreeResidue()`. */
export function confirmedManagedLinkPaths(
  worktreeRoot: string,
  journal: ManagedLinkJournal,
): string[] {
  const records = journal.read();
  if (!records.length || !existsSync(worktreeRoot)) return [];
  const realWorktree = realpathSync(worktreeRoot);
  const verified: string[] = [];
  for (const record of records) {
    if (record.worktree !== realWorktree || record.status !== "confirmed")
      continue;
    const linkFull = resolve(realWorktree, record.path);
    const parentDir = dirname(linkFull);
    if (!withinWorkspace(realWorktree, linkFull)) continue;
    try {
      const parentStat = lstatSync(parentDir);
      if (
        parentStat.isSymbolicLink() ||
        !parentStat.isDirectory() ||
        parentStat.dev !== record.parentDev ||
        parentStat.ino !== record.parentIno
      )
        continue;
      const linkStat = lstatSync(linkFull);
      if (
        !linkStat.isSymbolicLink() ||
        linkStat.dev !== record.linkDev ||
        linkStat.ino !== record.linkIno
      )
        continue;
      if (!sameLinkTarget(readlinkSync(linkFull), record.source)) continue;
      verified.push(record.path);
    } catch {
      /* Missing or unreadable link is never treated as confirmed. */
    }
  }
  return verified;
}

/** Identity-verified unlink of owner-provisioned symlinks for `worktreeRoot`.
 * Runs ONLY after all work/checks in `worktreeRoot` have settled and BEFORE
 * `worktreeResidue()`. Any identity mismatch refuses unlink and throws so the
 * worktree is retained for inspection. Never touches the link target. */
export function unlinkManagedLinks(
  worktreeRoot: string,
  journal: ManagedLinkJournal,
): void {
  const records = [...journal.read()];
  const realWorktree = existsSync(worktreeRoot)
    ? realpathSync(worktreeRoot)
    : worktreeRoot;
  const owned = records.filter(
    (r) => r.worktree === realWorktree && r.status === "confirmed",
  );
  if (!owned.length) return;

  for (const record of owned) {
    const linkFull = resolve(realWorktree, record.path);
    const parentDir = dirname(linkFull);
    if (!withinWorkspace(realWorktree, linkFull)) {
      record.status = "retained";
      record.reason = `Managed link "${record.path}" escaped worktree root; refused unlink.`;
      journal.write(records);
      throw new Error(record.reason);
    }

    let parentStat: ReturnType<typeof lstatSync>;
    try {
      parentStat = lstatSync(parentDir);
    } catch {
      record.status = "retained";
      record.reason = `Parent directory of managed link "${record.path}" is unreadable; refused unlink.`;
      journal.write(records);
      throw new Error(record.reason);
    }
    if (
      parentStat.isSymbolicLink() ||
      !parentStat.isDirectory() ||
      parentStat.dev !== record.parentDev ||
      parentStat.ino !== record.parentIno
    ) {
      record.status = "retained";
      record.reason = `Parent directory identity of managed link "${record.path}" changed; refused unlink to protect unowned files.`;
      journal.write(records);
      throw new Error(record.reason);
    }

    let linkStat: ReturnType<typeof lstatSync>;
    try {
      linkStat = lstatSync(linkFull);
    } catch (error) {
      if (isEnoent(error)) {
        record.status = "unlinked";
        record.reason = "Already absent before cleanup.";
        journal.write(records);
        continue;
      }
      record.status = "retained";
      record.reason = `Managed link "${record.path}" could not be inspected; refused unlink.`;
      journal.write(records);
      throw new Error(record.reason);
    }

    if (
      !linkStat.isSymbolicLink() ||
      linkStat.dev !== record.linkDev ||
      linkStat.ino !== record.linkIno
    ) {
      record.status = "retained";
      record.reason = `Managed link "${record.path}" was replaced or modified (expected symlink inode ${record.linkIno}); refused unlink and retained worktree.`;
      journal.write(records);
      throw new Error(record.reason);
    }

    const actualTarget = readlinkSync(linkFull);
    if (!sameLinkTarget(actualTarget, record.source)) {
      record.status = "retained";
      record.reason = `Managed link "${record.path}" target changed from "${record.source}" to "${actualTarget}"; refused unlink and retained worktree.`;
      journal.write(records);
      throw new Error(record.reason);
    }

    try {
      unlinkSync(linkFull);
    } catch (error) {
      if (
        process.platform === "win32" &&
        error instanceof Error &&
        "code" in error &&
        error.code === "EPERM"
      )
        rmdirSync(linkFull);
      else throw error;
    }
    let stillPresent = false;
    try {
      lstatSync(linkFull);
      stillPresent = true;
    } catch (error) {
      if (!isEnoent(error)) throw error;
    }
    if (stillPresent) {
      record.status = "retained";
      record.reason = `Managed link "${record.path}" remained present after unlink; retained worktree.`;
      journal.write(records);
      throw new Error(record.reason);
    }
    record.status = "unlinked";
    journal.write(records);
  }
}
