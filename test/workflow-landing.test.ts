/** Where a verified commit goes: parsing what Git reports and deciding from it.
 * Pure; the real-Git observations are in workflow-landing-git.test.ts. */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  carriedNotice,
  fingerprint,
  parseMergeTree,
  parseWorktrees,
  planFusion,
  planLanding,
  type TargetState,
  wipBackupRef,
} from "../src/service/workflow-landing.ts";

const A = "a".repeat(40),
  B = "b".repeat(40);
const state = (over: Partial<TargetState> = {}): TargetState => ({
  head: A,
  holder: null,
  busy: null,
  ...over,
});

it("reads every worktree Git lists, with its branch, detached HEAD or missing directory", () => {
  const listed = [
    `worktree /repo\0HEAD ${A}\0branch refs/heads/main\0`,
    `worktree /state/run/integration\0HEAD ${B}\0detached\0`,
    `worktree /gone\0HEAD ${A}\0branch refs/heads/old\0prunable gitdir file points to non-existent location\0`,
    "worktree /bare\0bare\0",
    "worktree /with space/and\nnewline\0HEAD ".concat(
      A,
      "\0branch refs/heads/x y\0",
    ),
  ].join("\0");
  expect(parseWorktrees(`${listed}\0`)).toEqual([
    { path: "/repo", head: A, branch: "refs/heads/main", prunable: false },
    {
      path: "/state/run/integration",
      head: B,
      branch: null,
      prunable: false,
    },
    { path: "/gone", head: A, branch: "refs/heads/old", prunable: true },
    { path: "/bare", head: null, branch: null, prunable: false },
    {
      path: "/with space/and\nnewline",
      head: A,
      branch: "refs/heads/x y",
      prunable: false,
    },
  ]);
  expect(parseWorktrees("")).toEqual([]);
});

it("a branch nobody has checked out moves by reference alone, whatever is uncommitted elsewhere", () => {
  expect(planLanding(A, state(), ["a.txt"], ["a.txt"])).toEqual({
    kind: "ref",
  });
});
it("a checked-out branch is fast-forwarded there unless its uncommitted paths are ones the landing changes", () => {
  const held = state({ holder: "/repo" });
  expect(planLanding(A, held, [], ["a.txt"])).toEqual({
    kind: "fast-forward",
    worktree: "/repo",
  });
  // Uncommitted work on other files is Git's to keep.
  expect(planLanding(A, held, ["notes.txt", "src/b.ts"], ["src/a.ts"])).toEqual(
    { kind: "fast-forward", worktree: "/repo" },
  );
  expect(
    planLanding(A, held, ["notes.txt", "src/a.ts"], ["src/a.ts", "x"]),
  ).toEqual({ kind: "overlap", worktree: "/repo", paths: ["src/a.ts"] });
  // A file where the landing has a directory, and the other way round.
  expect(planLanding(A, held, ["web"], ["web/dist/index.html"])).toEqual({
    kind: "overlap",
    worktree: "/repo",
    paths: ["web"],
  });
  expect(planLanding(A, held, ["web/dist/new.js"], ["web/dist"])).toEqual({
    kind: "overlap",
    worktree: "/repo",
    paths: ["web/dist/new.js"],
  });
});
it("a branch that moved is taken in first; one that cannot take a landing is waited for; a deleted one is neither", () => {
  expect(planLanding(A, state({ head: B }), [], [])).toEqual({
    kind: "moved",
    head: B,
  });
  // Waiting comes first: after a rebase the head will be somewhere else again.
  expect(
    planLanding(
      A,
      state({ head: B, busy: "refs/heads/main is being rebased in /repo" }),
      [],
      [],
    ),
  ).toEqual({
    kind: "wait",
    reason: "refs/heads/main is being rebased in /repo",
  });
  expect(
    planLanding(A, state({ head: null, busy: "anything" }), [], []),
  ).toEqual({ kind: "gone" });
});

it("merge-tree's answer is read into the tree and the sides of what could not be merged", () => {
  const output = [
    A,
    `100644 ${A} 1\tdel.txt`,
    `100644 ${B} 2\tdel.txt`,
    `100644 ${A} 2\tnew file.txt`,
    `100644 ${B} 3\tnew file.txt`,
    "",
    "1",
    "del.txt",
    "CONFLICT (modify/delete)",
    "CONFLICT (modify/delete): del.txt deleted in x and modified in y.",
    "",
  ].join("\0");
  expect(parseMergeTree(output)).toEqual({
    tree: A,
    conflicts: [
      {
        path: "del.txt",
        base: { mode: "100644", oid: A },
        ours: { mode: "100644", oid: B },
      },
      {
        path: "new file.txt",
        ours: { mode: "100644", oid: A },
        theirs: { mode: "100644", oid: B },
      },
    ],
  });
  // Merged without anything left over: the tree alone.
  expect(parseMergeTree(`${A}\0\0`)).toEqual({ tree: A, conflicts: [] });
  expect(parseMergeTree(A)).toEqual({ tree: A, conflicts: [] });
  expect(() => parseMergeTree("fatal: not a tree")).toThrow();
});

it("every file the landing and the user's uncommitted changes share is carried over in one of five ways", () => {
  const side = (mode = "100644") => ({ mode, oid: A });
  const both = (path: string) => ({
    path,
    base: side(),
    ours: side(),
    theirs: side(),
  });
  const plan = planFusion(
    [
      "src/a.ts",
      "src/clean.ts",
      "src/new.ts",
      "src/deleted.ts",
      "dist/app.js",
      "pins.json",
      "vendor/lib",
    ],
    [
      both("src/a.ts"),
      // Untracked on the user's side, added by the landing.
      { path: "src/new.ts", ours: side(), theirs: side() },
      // The user deleted what the landing changed.
      { path: "src/deleted.ts", base: side(), ours: side() },
      both("dist/app.js"),
      both("pins.json"),
      {
        path: "vendor/lib",
        base: side("160000"),
        ours: side("160000"),
        theirs: side("160000"),
      },
    ],
    [
      { name: "bundle", command: "make", outputs: ["dist"] },
      { name: "pins", command: "pin", outputs: [], refreshes: ["pins.json"] },
    ],
  );
  expect(plan).toEqual({
    merged: ["src/clean.ts"],
    // What a build writes is its to write again, pinned values included.
    landed: ["dist/app.js", "pins.json"],
    kept: ["src/deleted.ts"],
    reconcile: ["src/a.ts", "src/new.ts"],
    submodules: ["vendor/lib"],
  });
  expect(planFusion(["a", "b"], [], [])).toEqual({
    merged: ["a", "b"],
    landed: [],
    kept: [],
    reconcile: [],
    submodules: [],
  });
});

it("the result says what became of each file, where the earlier versions are and how to have them back", () => {
  const ref = wipBackupRef("0f8b1a52-7a3c-4f0e-9d51-2f6c1e7a9b10");
  expect(ref).toBe(
    "refs/cadence/wip-backup/0f8b1a52-7a3c-4f0e-9d51-2f6c1e7a9b10",
  );
  const notice = carriedNotice(
    "/repo",
    {
      merged: ["a.ts"],
      fused: ["b.ts"],
      marked: ["c.ts"],
      kept: ["d.bin"],
      landed: ["dist/app.js"],
    },
    ref,
  );
  expect(notice).toBe(
    `/repo had uncommitted changes to 5 files this delivery changes; they were carried over onto the new commit — merged with them: a.ts; reconciled with them by a worker: b.ts; left for you with both versions between conflict markers: c.ts; kept as your uncommitted version, because the two could not be merged (the delivered version is in HEAD): d.bin; replaced by the delivered version, because a build derives them: dist/app.js. Those files as they were before are in ${ref}: git show ${ref}:<file> prints one, and after git restore --source=HEAD --staged --worktree -- <files>, git stash apply --index ${ref} puts them back for Git to merge.`,
  );
  expect(
    carriedNotice(
      "/repo",
      { merged: ["a.ts"], fused: [], marked: [], kept: [], landed: [] },
      ref,
    ),
  ).toContain(
    "uncommitted changes to 1 file this delivery changes; they were carried over onto the new commit — merged with them: a.ts. Those files",
  );
});

it("a file written between two looks has another fingerprint; an absent one is told from a present one", () => {
  const dir = mkdtempSync(join(tmpdir(), "landing-fingerprint-"));
  try {
    writeFileSync(join(dir, "a.txt"), "one\n");
    const first = fingerprint(dir, ["a.txt", "absent.txt"]);
    expect(fingerprint(dir, ["absent.txt", "a.txt"])).toBe(first);
    writeFileSync(join(dir, "a.txt"), "one, changed\n");
    expect(fingerprint(dir, ["a.txt", "absent.txt"])).not.toBe(first);
    const second = fingerprint(dir, ["a.txt", "absent.txt"]);
    writeFileSync(join(dir, "absent.txt"), "");
    expect(fingerprint(dir, ["a.txt", "absent.txt"])).not.toBe(second);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
