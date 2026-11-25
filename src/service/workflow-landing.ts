/** Where a verified delivery commit goes: the target branch as Git has it
 * right now, and the worktree that has it checked out, if one does; and, when
 * that worktree has uncommitted changes to files the landing changes, what
 * becomes of each of them. Observing and deciding are separate so every
 * decision is a pure function of what was seen. Nothing here verifies a
 * candidate, reconciles a conflict or moves a ref. */
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ContractError } from "./contracts/core.ts";
import type { WorkflowBuild } from "./contracts/workflow.ts";
import {
  classifyConflicts,
  parseUnmerged,
  type Unmerged,
} from "./workflow-derived.ts";
import { changedPaths, gitRun, gitText, overlapping } from "./workflow-git.ts";

export interface Worktree {
  path: string;
  head: string | null;
  /** The checked-out branch; null for a detached or bare worktree. */
  branch: string | null;
  /** Its directory is gone; Git only still lists it. */
  prunable: boolean;
}
/** `git worktree list --porcelain -z`: NUL-terminated fields, an empty field
 * between worktrees. */
export function parseWorktrees(output: string): Worktree[] {
  const list: Worktree[] = [];
  let current: Worktree | undefined;
  for (const field of output.split("\0")) {
    if (!field) {
      current = undefined;
      continue;
    }
    const at = field.indexOf(" ");
    const key = at < 0 ? field : field.slice(0, at);
    const value = at < 0 ? "" : field.slice(at + 1);
    if (key === "worktree") {
      current = { path: value, head: null, branch: null, prunable: false };
      list.push(current);
    } else if (!current) continue;
    else if (key === "HEAD") current.head = value;
    else if (key === "branch") current.branch = value;
    else if (key === "prunable") current.prunable = true;
  }
  return list;
}

export interface TargetState {
  /** The branch's commit right now; null when the branch does not exist. */
  head: string | null;
  /** The worktree that has the branch checked out, if one does. */
  holder: string | null;
  /** Why the branch cannot take a landing just now, if it cannot. */
  busy: string | null;
}
/** Left by an operation that will write the worktree's index or branch. */
const UNFINISHED = [
  "MERGE_HEAD",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "index.lock",
] as const;
function firstLine(path: string): string | null {
  try {
    return readFileSync(path, "utf8").split("\n")[0].trim();
  } catch {
    return null;
  }
}
/** The branch itself is the authority, never a remembered value. A rebase
 * detaches HEAD, so `git worktree list` no longer names the branch, yet
 * finishing the rebase writes the branch with its old value expected: moving
 * it in between would strand the user's rebased commits. */
export async function observeTarget(
  cwd: string,
  branch: string,
): Promise<TargetState> {
  const ref = await gitRun(cwd, [
    "rev-parse",
    "--verify",
    "--quiet",
    `${branch}^{commit}`,
  ]);
  if (ref.code !== 0 && ref.code !== 1) throw new ContractError("unavailable");
  const head = ref.code === 0 ? ref.stdout.trim() : null;
  let holder: string | null = null,
    busy: string | null = null;
  for (const tree of parseWorktrees(
    await gitText(cwd, ["worktree", "list", "--porcelain", "-z"]),
  )) {
    if (tree.prunable || !existsSync(join(tree.path, ".git"))) continue;
    let gitDir: string;
    try {
      gitDir = (
        await gitText(tree.path, ["rev-parse", "--absolute-git-dir"])
      ).trim();
    } catch (error) {
      // A sibling detached worktree can be mid-`worktree add` or mid-`worktree
      // remove` while another run observes the target branch without the `.git`
      // lease. Skip only non-holder worktrees whose directory or gitdir vanished.
      if (tree.branch !== branch) {
        const pointer = firstLine(join(tree.path, ".git"));
        const linkedDir = pointer?.startsWith("gitdir:")
          ? resolve(tree.path, pointer.slice("gitdir:".length).trim())
          : null;
        const vanished =
          !existsSync(tree.path) ||
          !existsSync(join(tree.path, ".git")) ||
          (linkedDir !== null && !existsSync(join(linkedDir, "HEAD")));
        if (vanished) continue;
        const fresh = parseWorktrees(
          await gitText(cwd, ["worktree", "list", "--porcelain", "-z"]),
        ).find((entry) => entry.path === tree.path);
        if (!fresh || fresh.prunable) continue;
      }
      throw error;
    }
    if (tree.branch === branch) {
      holder = tree.path;
      const unfinished = UNFINISHED.find((name) =>
        existsSync(join(gitDir, name)),
      );
      if (unfinished)
        busy = `${tree.path} has an unfinished Git operation (${unfinished})`;
      // Left by a stash or a pick that stopped at a conflict: no marker file,
      // but nothing can be saved from that index or fast-forwarded over it.
      else if (
        (await gitText(tree.path, ["ls-files", "--unmerged", "-z"])).length
      )
        busy = `${tree.path} has unresolved conflicts in its index`;
    }
    for (const rebase of ["rebase-merge", "rebase-apply"])
      if (firstLine(join(gitDir, rebase, "head-name")) === branch)
        busy = `${branch} is being rebased in ${tree.path}`;
  }
  return { head, holder, busy };
}
/** Uncommitted paths of a worktree, staged ones and untracked files included. */
export function uncommitted(worktree: string): Promise<string[]> {
  return changedPaths(worktree);
}

export type Landing =
  /** The branch no longer exists. */
  | { kind: "gone" }
  /** The branch is not where the candidate was verified: take it in first. */
  | { kind: "moved"; head: string }
  /** The branch cannot take a landing just now; look again later. */
  | { kind: "wait"; reason: string }
  /** No worktree has it checked out: the reference alone moves. */
  | { kind: "ref" }
  /** A worktree has it checked out and none of its uncommitted paths are
   * touched: Git's own fast-forward keeps them, staged or not. */
  | { kind: "fast-forward"; worktree: string }
  /** That worktree has uncommitted changes to paths the landing changes. */
  | { kind: "overlap"; worktree: string; paths: string[] };
/** What to do with a commit verified on `base`. `dirty` are the uncommitted
 * paths of the worktree that has the branch checked out, `changed` the paths
 * the landing changes. */
export function planLanding(
  base: string,
  state: TargetState,
  dirty: readonly string[],
  changed: readonly string[],
): Landing {
  if (state.head === null) return { kind: "gone" };
  if (state.busy) return { kind: "wait", reason: state.busy };
  if (state.head !== base) return { kind: "moved", head: state.head };
  if (!state.holder) return { kind: "ref" };
  const paths = overlapping(changed, dirty);
  return paths.length
    ? { kind: "overlap", worktree: state.holder, paths }
    : { kind: "fast-forward", worktree: state.holder };
}

/** Where a run's backup of uncommitted changes is kept: a private reference
 * holding a commit in stash format, so Git's own `stash apply` restores it. */
export function wipBackupRef(run: string): string {
  return `refs/cadence/wip-backup/${run}`;
}
/** The index flags that hide a tracked file's real bytes from Git. */
export type HiddenFlag = "assume-unchanged" | "skip-worktree";
/** Tracked paths among `paths` that carry such a flag and whose bytes in the
 * worktree are not what the index has: Git reports nothing for them, yet
 * refuses to fast-forward over them. */
export async function hiddenChanges(
  worktree: string,
  paths: readonly string[],
): Promise<{ path: string; flag: HiddenFlag }[]> {
  if (!paths.length) return [];
  const literal = paths.map((path) => `:(literal)${path}`);
  const flagged = (
    await gitText(worktree, ["ls-files", "-v", "-z", "--", ...literal])
  )
    .split("\0")
    .flatMap((row): { path: string; flag: HiddenFlag }[] =>
      row.startsWith("S ")
        ? [{ path: row.slice(2), flag: "skip-worktree" }]
        : /^[a-z] /u.test(row)
          ? [{ path: row.slice(2), flag: "assume-unchanged" }]
          : [],
    );
  const changed: { path: string; flag: HiddenFlag }[] = [];
  for (const entry of flagged) {
    const staged = (
      await gitText(worktree, [
        "ls-files",
        "-s",
        "-z",
        "--",
        `:(literal)${entry.path}`,
      ])
    ).split(" ")[1];
    const actual = await gitRun(worktree, ["hash-object", "--", entry.path]);
    // A file that is gone, or cannot be hashed, is not what the index has.
    if (actual.code !== 0 || actual.stdout.trim() !== staged)
      changed.push(entry);
  }
  return changed;
}
/** What the listed files look like on disk, cheaply: enough to notice that
 * one of them was written between two looks. */
export function fingerprint(
  worktree: string,
  paths: readonly string[],
): string {
  return JSON.stringify(
    [...paths].sort().map((path) => {
      try {
        const stat = lstatSync(join(worktree, path), { bigint: true });
        return [
          path,
          String(stat.size),
          String(stat.mtimeNs),
          String(stat.ino),
        ];
      } catch {
        return [path, null];
      }
    }),
  );
}

/** `git merge-tree --write-tree -z`: the resulting tree, then one entry per
 * side of every path that could not be merged, then messages. */
export function parseMergeTree(output: string): {
  tree: string;
  conflicts: Unmerged[];
} {
  const fields = output.split("\0");
  const tree = fields[0] ?? "";
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(tree))
    throw new Error("Unexpected merge-tree output");
  const end = fields.indexOf("", 1);
  return {
    tree,
    conflicts: parseUnmerged(
      fields.slice(1, end < 0 ? fields.length : end).join("\0"),
    ),
  };
}

/** What became of a file the user had uncommitted changes to while a
 * delivery that changes it landed. */
export type Carried =
  /** Both changes are there, merged by Git. */
  | "merged"
  /** A build derives it: the landed version stands. */
  | "landed"
  /** The two cannot be merged (one side deleted it, or it is not text): the
   * user's version stays, as an uncommitted change against the landed one. */
  | "kept"
  /** A worker reconciled the two versions. */
  | "fused"
  /** Both versions are in the file, between markers, for the user. */
  | "marked";
export interface FusionPlan {
  merged: string[];
  landed: string[];
  kept: string[];
  /** Text both sides changed: a worker is asked to reconcile these. */
  reconcile: string[];
  /** A submodule pointer both moved: nothing here can carry that over. */
  submodules: string[];
}
/** Sorts the paths a landing and the user's uncommitted changes share by
 * what can be done about each. `conflicts` is what merging the user's
 * worktree state onto the landed commit left unmerged (the landing as
 * "ours", the user's changes as "theirs"). */
export function planFusion(
  overlap: readonly string[],
  conflicts: readonly Unmerged[],
  builds: readonly WorkflowBuild[],
): FusionPlan {
  const gitlink = (entry: Unmerged) =>
    [entry.base, entry.ours, entry.theirs].some(
      (side) => side?.mode === "160000",
    );
  const sorted = classifyConflicts(
    conflicts.filter((entry) => !gitlink(entry)),
    builds,
  );
  const paths = (entries: readonly Unmerged[]) =>
    entries.map((entry) => entry.path);
  const plan = {
    // What a build writes is its to write again, values included.
    landed: paths([...sorted.derived, ...sorted.refresh]),
    kept: paths(sorted.other),
    reconcile: paths(sorted.text),
    submodules: paths(conflicts.filter(gitlink)),
  };
  const settled = new Set(Object.values(plan).flat());
  return {
    merged: overlap.filter((path) => !settled.has(path)).sort(),
    ...plan,
  };
}
/** The part of a delivery's result that tells the user what was done with
 * their uncommitted changes, and how to have them back as they were. */
export function carriedNotice(
  worktree: string,
  carried: Readonly<Record<Carried, readonly string[]>>,
  backup: string,
): string {
  const list = (paths: readonly string[]) =>
    `${paths.slice(0, 16).join(", ")}${paths.length > 16 ? ` and ${paths.length - 16} more` : ""}`;
  const all = Object.values(carried).flat();
  const parts = [
    carried.merged.length ? `merged with them: ${list(carried.merged)}` : "",
    carried.fused.length
      ? `reconciled with them by a worker: ${list(carried.fused)}`
      : "",
    carried.marked.length
      ? `left for you with both versions between conflict markers: ${list(carried.marked)}`
      : "",
    carried.kept.length
      ? `kept as your uncommitted version, because the two could not be merged (the delivered version is in HEAD): ${list(carried.kept)}`
      : "",
    carried.landed.length
      ? `replaced by the delivered version, because a build derives them: ${list(carried.landed)}`
      : "",
  ].filter(Boolean);
  return `${worktree} had uncommitted changes to ${all.length} file${all.length === 1 ? "" : "s"} this delivery changes; they were carried over onto the new commit — ${parts.join("; ")}. Those files as they were before are in ${backup}: git show ${backup}:<file> prints one, and after git restore --source=HEAD --staged --worktree -- <files>, git stash apply --index ${backup} puts them back for Git to merge.`;
}
