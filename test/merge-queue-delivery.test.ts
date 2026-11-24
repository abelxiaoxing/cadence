// @module-tag slow
/** Deliveries landing on a real repository: the branch itself is the frontier,
 * a moved branch is taken in by replay, and the user's checkout is touched
 * only by Git's own fast-forward. Real Git throughout; workers are stand-ins. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { repository } from "./helpers/delivery-engine.ts";

const lines = (text: string) => text.trimEnd().split("\n");

it("two deliveries to one branch land in arrival order: the second replays onto what the first left and is verified again", async () => {
  const r = repository();
  const x = r.delivery("change two"),
    y = r.delivery("change b");
  await x.create();
  await y.create();
  writeFileSync(join(x.cwd, "a.txt"), "one\nTWO\nthree\nfour\nfive\n");
  writeFileSync(join(y.cwd, "b.txt"), "B\n");
  // Both verified in isolation on the same baseline, in parallel.
  await Promise.all([x.accept(), y.accept()]);
  expect(x.reviewed).toHaveLength(1);
  expect(y.reviewed).toHaveLength(1);
  expect(r.git("rev-parse", "HEAD")).toBe(x.base);

  await Promise.all([x.land(), y.land()]);
  const [second, first, base] = lines(r.git("log", "--format=%H", "-3"));
  expect(base).toBe(x.base);
  expect(first).toBe(x.live.run.mergedCommit);
  expect(second).toBe(y.live.run.mergedCommit);
  // Each is one commit with one parent; nothing was merged with a merge commit.
  expect(r.git("show", "-s", "--format=%P", second)).toBe(first);
  expect(r.git("show", "-s", "--format=%s", first)).toBe("Cadence: change two");
  expect(r.git("diff", "--name-only", first, second)).toBe("b.txt");
  // The first landed exactly what was verified; the second was verified again
  // as the commit that landed.
  expect(x.reviewed).toEqual([first]);
  expect(y.reviewed).toHaveLength(2);
  expect(y.reviewed[1]).toBe(second);
  // The user's checkout followed by fast-forward.
  expect(readFileSync(join(r.root, "a.txt"), "utf8")).toContain("TWO");
  expect(readFileSync(join(r.root, "b.txt"), "utf8")).toBe("B\n");
  expect(r.git("status", "--porcelain")).toBe("");
  // Task branches hold what landed; candidates are clean and detached.
  expect(r.git("rev-parse", x.view.taskBranch)).toBe(first);
  expect(r.git("rev-parse", y.view.taskBranch)).toBe(second);
  expect(r.gitAt(y.cwd, "status", "--porcelain")).toBe("");
  expect(y.view.integration).toMatchObject({
    status: "applied",
    before: first,
    after: second,
    sync: { mode: "fast-forward", worktree: r.root },
  });
  expect(r.queue.busy).toBe(false);
});

it("the same file changed in different places by a delivery and by the branch merges without anyone resolving anything", async () => {
  const r = repository();
  const x = r.delivery("change two");
  await x.create();
  writeFileSync(join(x.cwd, "a.txt"), "one\nTWO\nthree\nfour\nfive\n");
  await x.accept();
  // The user commits to the same file, far enough away.
  writeFileSync(join(r.root, "a.txt"), "one\ntwo\nthree\nfour\nFIVE\n");
  r.git("commit", "-qam", "my own change");
  const mine = r.git("rev-parse", "HEAD");
  await x.land();
  expect(readFileSync(join(r.root, "a.txt"), "utf8")).toBe(
    "one\nTWO\nthree\nfour\nFIVE\n",
  );
  expect(r.git("show", "-s", "--format=%P", "HEAD")).toBe(mine);
  expect(x.reviewed).toHaveLength(2);
});

it("a checkout that switched to another branch is not touched: the target moves by reference alone", async () => {
  const r = repository();
  const x = r.delivery("change two");
  await x.create();
  writeFileSync(join(x.cwd, "a.txt"), "one\nTWO\nthree\nfour\nfive\n");
  await x.accept();
  r.git("switch", "-qc", "debug-y");
  writeFileSync(join(r.root, "a.txt"), "my debugging mess\n");
  writeFileSync(join(r.root, "scratch.txt"), "untracked\n");
  await x.land();
  // The branch has the delivery; the checkout is exactly as the user left it.
  expect(r.git("rev-parse", r.BRANCH)).toBe(x.live.run.mergedCommit);
  expect(r.git("symbolic-ref", "HEAD")).toBe("refs/heads/debug-y");
  expect(r.git("rev-parse", "HEAD")).toBe(x.base);
  expect(readFileSync(join(r.root, "a.txt"), "utf8")).toBe(
    "my debugging mess\n",
  );
  expect(existsSync(join(r.root, "scratch.txt"))).toBe(true);
  expect(x.view.integration.sync).toEqual({ mode: "ref", worktree: null });
  // Exactly the verified commit: nothing had to be replayed.
  expect(x.reviewed).toEqual([x.live.run.mergedCommit]);
});

it("uncommitted and staged changes to other files survive the fast-forward exactly", async () => {
  const r = repository();
  const x = r.delivery("change two");
  await x.create();
  writeFileSync(join(x.cwd, "a.txt"), "one\nTWO\nthree\nfour\nfive\n");
  await x.accept();
  writeFileSync(join(r.root, "b.txt"), "staged by me\n");
  r.git("add", "b.txt");
  writeFileSync(join(r.root, "b.txt"), "staged by me\nand more, unstaged\n");
  writeFileSync(join(r.root, "notes.txt"), "untracked\n");
  await x.land();
  expect(r.git("rev-parse", "HEAD")).toBe(x.live.run.mergedCommit);
  expect(lines(r.git("status", "--porcelain"))).toEqual([
    "MM b.txt",
    "?? notes.txt",
  ]);
  expect(r.git("show", ":b.txt")).toBe("staged by me");
  expect(readFileSync(join(r.root, "b.txt"), "utf8")).toBe(
    "staged by me\nand more, unstaged\n",
  );
});

it("rule files the branch changed are remembered for every later review", async () => {
  const r = repository();
  const x = r.delivery("change two");
  await x.create();
  writeFileSync(join(x.cwd, "a.txt"), "one\nTWO\nthree\nfour\nfive\n");
  await x.accept();
  writeFileSync(join(r.root, "AGENTS.md"), "# Rules\nNo shouting.\n");
  r.git("add", "AGENTS.md");
  r.git("commit", "-qm", "new rule");
  const frontier = r.git("rev-parse", "HEAD");
  await x.land();
  expect(x.live.rules).toEqual({
    from: x.base,
    to: frontier,
    paths: ["AGENTS.md"],
  });
  // The candidate's own worktree now holds the current rules for its workers.
  expect(r.git("show", `${x.live.run.mergedCommit}:AGENTS.md`)).toContain(
    "No shouting.",
  );
  expect(await x.engine.rulesBrief(x.live, r.root)).toContain("+No shouting.");
});

it("a target whose history was rewritten is followed like any other move", async () => {
  const r = repository();
  r.git("commit", "-q", "--allow-empty", "-m", "to be reworded");
  const x = r.delivery("change two");
  await x.create();
  writeFileSync(join(x.cwd, "a.txt"), "one\nTWO\nthree\nfour\nfive\n");
  await x.accept();
  // The baseline commit is rewritten away: it is no ancestor of the branch.
  r.git("commit", "-q", "--amend", "--allow-empty", "-m", "reworded");
  const rewritten = r.git("rev-parse", "HEAD");
  expect(rewritten).not.toBe(x.base);
  await x.land();
  expect(r.git("show", "-s", "--format=%P", "HEAD")).toBe(rewritten);
  expect(r.git("rev-parse", x.view.taskBranch)).toBe(x.live.run.mergedCommit);
  expect(readFileSync(join(r.root, "a.txt"), "utf8")).toContain("TWO");
});

it("a replay Git cannot merge changes nothing: the branch, the checkout and the sealed candidate stay as they were", async () => {
  const r = repository();
  const x = r.delivery("change two");
  await x.create();
  writeFileSync(join(x.cwd, "a.txt"), "one\nTWO\nthree\nfour\nfive\n");
  await x.accept();
  const sealed = x.head();
  writeFileSync(join(r.root, "a.txt"), "one\ntwo, my way\nthree\nfour\nfive\n");
  r.git("commit", "-qam", "the same line");
  const mine = r.git("rev-parse", "HEAD");
  await expect(x.land()).rejects.toMatchObject({
    code: "conflict",
    detail: expect.stringContaining("a.txt"),
  });
  expect(r.git("rev-parse", r.BRANCH)).toBe(mine);
  expect(x.head()).toBe(sealed);
  expect(r.gitAt(x.cwd, "status", "--porcelain")).toBe("");
  expect(readFileSync(join(x.cwd, "a.txt"), "utf8")).toContain("TWO");
  expect(r.git("rev-parse", x.view.taskBranch)).toBe(x.base);
  expect(r.queue.busy).toBe(false);
});

it("a branch the user is rebasing is waited for; landing in between would strand the rebase", async () => {
  const r = repository();
  const x = r.delivery("change b");
  await x.create();
  writeFileSync(join(x.cwd, "b.txt"), "B\n");
  await x.accept();
  // main gains a commit that conflicts with an older branch being rebased
  // onto... the target itself: put main mid-rebase onto another branch.
  r.git("switch", "-qc", "upstream");
  writeFileSync(join(r.root, "a.txt"), "one\nupstream\nthree\nfour\nfive\n");
  r.git("commit", "-qam", "upstream");
  r.git("switch", "-q", "main");
  writeFileSync(join(r.root, "a.txt"), "one\nmain\nthree\nfour\nfive\n");
  r.git("commit", "-qam", "main");
  expect(() => r.git("rebase", "upstream")).toThrow();
  const waits: string[] = [];
  x.engine.pause = async () => {
    waits.push(x.live.run.notice);
    // The user finishes the rebase.
    writeFileSync(join(r.root, "a.txt"), "one\nboth\nthree\nfour\nfive\n");
    r.git("add", "a.txt");
    r.git("-c", "core.editor=true", "rebase", "--continue");
  };
  await x.land();
  expect(waits).toHaveLength(1);
  expect(waits[0]).toContain("is being rebased");
  // The rebase finished untouched, and the delivery landed on its result.
  expect(r.git("symbolic-ref", "HEAD")).toBe(r.BRANCH);
  expect(r.git("rev-parse", "HEAD")).toBe(x.live.run.mergedCommit);
  expect(r.git("log", "--format=%s", "-3").split("\n")).toEqual([
    "Cadence: change b",
    "main",
    "upstream",
  ]);
  expect(readFileSync(join(r.root, "b.txt"), "utf8")).toBe("B\n");
});
