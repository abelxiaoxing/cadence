// @module-tag slow
/** What a landing sees of a real repository: where the branch is, which
 * worktree has it checked out and whether it can take a landing just now. */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { observeTarget, uncommitted } from "../src/service/workflow-landing.ts";
import { repository } from "./helpers/delivery-engine.ts";

it("the branch is read from Git: checked out here, in another worktree, nowhere, or gone", async () => {
  const r = repository();
  const head = r.git("rev-parse", "HEAD");
  expect(await observeTarget(r.root, r.BRANCH)).toEqual({
    head,
    holder: r.root,
    busy: null,
  });
  // Observed from anywhere in the repository, including a detached candidate.
  const candidate = join(r.home, "candidate");
  r.git("worktree", "add", "-q", "--detach", candidate, head);
  expect(await observeTarget(candidate, r.BRANCH)).toMatchObject({
    holder: r.root,
  });
  r.git("switch", "-qc", "elsewhere");
  expect(await observeTarget(r.root, r.BRANCH)).toEqual({
    head,
    holder: null,
    busy: null,
  });
  // Another of the user's worktrees takes it.
  const other = join(r.home, "other");
  r.git("worktree", "add", "-q", other, "main");
  expect(await observeTarget(r.root, r.BRANCH)).toMatchObject({
    holder: other,
  });
  // Its directory vanishes: Git still lists it, nothing is there to write.
  r.git("worktree", "remove", "--force", other);
  r.git("branch", "-q", "-D", "main");
  expect(await observeTarget(r.root, r.BRANCH)).toEqual({
    head: null,
    holder: null,
    busy: null,
  });
});

it("a merge left unfinished in the checkout, or a rebase of the branch anywhere, means not just now", async () => {
  const r = repository();
  r.git("switch", "-qc", "side");
  writeFileSync(join(r.root, "a.txt"), "one\nside\nthree\nfour\nfive\n");
  r.git("commit", "-qam", "side");
  r.git("switch", "-q", "main");
  writeFileSync(join(r.root, "a.txt"), "one\nmain\nthree\nfour\nfive\n");
  r.git("commit", "-qam", "main");
  expect(() => r.git("merge", "side")).toThrow();
  expect(await observeTarget(r.root, r.BRANCH)).toMatchObject({
    holder: r.root,
    busy: expect.stringContaining("unfinished Git operation (MERGE_HEAD)"),
  });
  r.git("merge", "--abort");
  expect((await observeTarget(r.root, r.BRANCH)).busy).toBeNull();
  // A rebase detaches HEAD: no worktree lists the branch, yet it is in use.
  expect(() => r.git("rebase", "side")).toThrow();
  expect(await observeTarget(r.root, r.BRANCH)).toEqual({
    head: r.git("rev-parse", r.BRANCH),
    holder: null,
    busy: `${r.BRANCH} is being rebased in ${r.root}`,
  });
  r.git("rebase", "--abort");
  expect(await observeTarget(r.root, r.BRANCH)).toMatchObject({
    holder: r.root,
    busy: null,
  });
});

it("an index left with unresolved conflicts, by a stash that did not apply cleanly, means not just now either", async () => {
  const r = repository();
  writeFileSync(join(r.root, "a.txt"), "one\nmine\nthree\nfour\nfive\n");
  r.git("stash");
  writeFileSync(join(r.root, "a.txt"), "one\ncommitted\nthree\nfour\nfive\n");
  r.git("commit", "-qam", "committed");
  expect(() => r.git("stash", "pop")).toThrow();
  // No merge or pick is in progress as far as marker files say.
  expect(await observeTarget(r.root, r.BRANCH)).toMatchObject({
    holder: r.root,
    busy: `${r.root} has unresolved conflicts in its index`,
  });
  r.git("checkout", "--theirs", "a.txt");
  r.git("add", "a.txt");
  expect((await observeTarget(r.root, r.BRANCH)).busy).toBeNull();
});

it("uncommitted paths include staged, unstaged and untracked ones, never ignored ones", async () => {
  const r = repository();
  writeFileSync(join(r.root, "a.txt"), "changed\n");
  writeFileSync(join(r.root, "b.txt"), "staged\n");
  r.git("add", "b.txt");
  writeFileSync(join(r.root, "new.txt"), "untracked\n");
  r.git(
    "update-index",
    "--add",
    "--cacheinfo",
    `100644,${r.git("hash-object", "-w", "a.txt")},only-staged.txt`,
  );
  expect((await uncommitted(r.root)).sort()).toEqual([
    "a.txt",
    "b.txt",
    "new.txt",
    "only-staged.txt",
  ]);
});
