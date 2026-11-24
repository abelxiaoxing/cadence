/** Where a verified delivery commit goes: the target branch as Git has it
 * right now, and the worktree that has it checked out, if one does. Observing
 * and deciding are separate so the decision is a pure function of what was
 * seen. Nothing here verifies a candidate, resolves a conflict or moves a ref. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ContractError } from "./contracts/core.ts";
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
    if (tree.prunable || !existsSync(tree.path)) continue;
    const gitDir = (
      await gitText(tree.path, ["rev-parse", "--absolute-git-dir"])
    ).trim();
    if (tree.branch === branch) {
      holder = tree.path;
      const unfinished = UNFINISHED.find((name) =>
        existsSync(join(gitDir, name)),
      );
      if (unfinished)
        busy = `${tree.path} has an unfinished Git operation (${unfinished})`;
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
