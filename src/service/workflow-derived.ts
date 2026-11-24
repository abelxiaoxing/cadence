/** What a repository derives from its sources, and what that means when two
 * histories meet. A build step declares the paths it writes: `outputs` are
 * derived as a whole, so they are rebuilt and their bytes are never merged;
 * `refreshes` are files whose entries are source and whose values the step
 * recomputes, so only the entries are merged. Reads the repository's
 * declaration and classifies what a replay left unmerged; it runs no command
 * and changes nothing. */
import { join } from "node:path";
import { readBounded } from "../workspace.ts";
import {
  decodeWorkflowBuilds,
  type WorkflowBuild,
  WorkflowInputError,
  workflowCovers,
} from "./contracts/workflow.ts";
import { WorkflowRefusal } from "./workflow-git.ts";

/** The repository's own declaration of its build steps. An agreement that
 * leaves `build` out is bound to it when the proposal is published. */
export const DERIVED_FILE = ".cadence/derived.json";
const DERIVED_BYTES = 64 * 1024;

/** The declared build steps; none when the repository declares nothing. A
 * declaration that cannot be used is refused by naming what is wrong in it. */
export function readDerived(checkoutRoot: string): WorkflowBuild[] {
  const refuse = (detail: string): never => {
    throw new WorkflowRefusal("invalid", `${DERIVED_FILE}: ${detail}`);
  };
  let bytes: Buffer | undefined;
  try {
    bytes = readBounded(join(checkoutRoot, DERIVED_FILE), DERIVED_BYTES);
  } catch {
    return refuse(
      `is not a plain file of at most ${DERIVED_BYTES} bytes; pass build explicitly, or [] for none`,
    );
  }
  if (!bytes) return [];
  let declared: unknown;
  try {
    declared = JSON.parse(bytes.toString("utf8"));
  } catch {
    return refuse("is not JSON");
  }
  if (
    declared === null ||
    typeof declared !== "object" ||
    Array.isArray(declared) ||
    Object.keys(declared).some((key) => key !== "build")
  )
    return refuse('is an object with one field, "build"');
  try {
    return decodeWorkflowBuilds(
      (declared as { build?: unknown }).build,
      "build",
    );
  } catch (error) {
    if (error instanceof WorkflowInputError) return refuse(error.message);
    throw error;
  }
}

/** One path a replay left unmerged, with the blob each side has for it:
 * `base` the common ancestor, `ours` the branch, `theirs` the delivery. A side
 * that has no such file is absent. */
export interface Unmerged {
  path: string;
  base?: { mode: string; oid: string };
  ours?: { mode: string; oid: string };
  theirs?: { mode: string; oid: string };
}
const SIDES = { 1: "base", 2: "ours", 3: "theirs" } as const;
/** `git ls-files --unmerged -z`: `<mode> <oid> <stage>\t<path>` per entry. */
export function parseUnmerged(output: string): Unmerged[] {
  const paths = new Map<string, Unmerged>();
  for (const row of output.split("\0")) {
    if (!row) continue;
    const tab = row.indexOf("\t");
    const [mode, oid, stage] = row.slice(0, tab).split(" ");
    const side = SIDES[Number(stage) as 1 | 2 | 3];
    const path = row.slice(tab + 1);
    if (tab < 0 || !side || !mode || !oid || !path)
      throw new Error("Unexpected unmerged index entry");
    const entry = paths.get(path) ?? { path };
    entry[side] = { mode, oid };
    paths.set(path, entry);
  }
  return [...paths.values()].sort((a, b) => (a.path < b.path ? -1 : 1));
}

const REGULAR = new Set(["100644", "100755"]);
export interface Conflicts {
  /** Under a wholly derived output: the branch's version stands, and the
   * build that follows regenerates it. */
  derived: Unmerged[];
  /** A refreshed file both sides changed from a common version: merged again
   * after the declared command recomputed the values of all three. */
  refresh: Unmerged[];
  /** A regular file both sides have: Git wrote both versions into it,
   * between markers, for a worker to reconcile. */
  text: Unmerged[];
  /** Everything else (one side deleted the file, a link, a submodule): no
   * edit of marked lines settles it. */
  other: Unmerged[];
}
/** Sorts what a replay left unmerged by who can settle it. */
export function classifyConflicts(
  unmerged: readonly Unmerged[],
  builds: readonly WorkflowBuild[],
): Conflicts {
  const outputs = builds.flatMap((b) => b.outputs),
    refreshes = builds.flatMap((b) => b.refreshes ?? []);
  const result: Conflicts = { derived: [], refresh: [], text: [], other: [] };
  for (const entry of unmerged) {
    const both =
      !!entry.ours &&
      !!entry.theirs &&
      REGULAR.has(entry.ours.mode) &&
      REGULAR.has(entry.theirs.mode);
    if (workflowCovers(outputs, entry.path)) result.derived.push(entry);
    else if (!both) result.other.push(entry);
    else if (entry.base && refreshes.includes(entry.path))
      result.refresh.push(entry);
    else result.text.push(entry);
  }
  return result;
}
/** The build steps that recompute the values of `path`, in declared order. */
export function refreshers(
  builds: readonly WorkflowBuild[],
  path: string,
): WorkflowBuild[] {
  return builds.filter((b) => b.refreshes?.includes(path));
}

/** The lines Git wrote around the versions of a conflict: the start of the
 * branch's, of the common ancestor's, and the end of the delivery's. Each
 * carries a label, which keeps it apart from a `=======` a document may use
 * for its own purposes. A file is reconciled when none of them is left. */
export function conflictMarkers(text: string): string[] {
  return text
    .split(/\r?\n/u)
    .filter((line) => /^(?:<{7}|\|{7}|>{7}) \S/u.test(line));
}
/** What a path that cannot be reconciled by editing marked lines is, said for
 * whoever decides what becomes of it. */
export function describeConflict(entry: Unmerged): string {
  const gitlink = [entry.base, entry.ours, entry.theirs].some(
    (side) => side?.mode === "160000",
  );
  if (gitlink) return `${entry.path}: a submodule pointer both sides moved`;
  if (!entry.ours)
    return `${entry.path}: deleted on the branch, changed by this delivery`;
  if (!entry.theirs)
    return `${entry.path}: changed on the branch, deleted by this delivery`;
  return `${entry.path}: not a regular file on one side (a link or a changed file type)`;
}
