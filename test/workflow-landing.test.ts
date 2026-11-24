/** Where a verified commit goes: parsing what Git reports and deciding from it.
 * Pure; the real-Git observations are in workflow-landing-git.test.ts. */
import { expect, it } from "vitest";
import {
  parseWorktrees,
  planLanding,
  type TargetState,
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
