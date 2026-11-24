import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  assertWorkflowCommit,
  assertWorkflowScope,
  pathIdentity,
  pathIdentityAsync,
  snapshotChanges,
  WorkflowRefusal,
  workflowObservation,
  workingSnapshot,
  worktreeResidue,
} from "../src/service/workflow-git.ts";
import { stagedPlan as plan } from "./helpers/workflow-plan.ts";

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), "workflow-scope-"));
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "-c",
        "core.hooksPath=/dev/null",
        ...args,
      ],
      { cwd, encoding: "utf8" },
    ).trim();
  git("init", "-q");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  for (const name of ["allowed.txt", "protected.txt"])
    writeFileSync(join(cwd, name), "original\n");
  git("add", ".");
  git("commit", "-qm", "baseline");
  const before = git("rev-parse", "HEAD");
  return { cwd, git, before };
}

it.each(["restored", "deleted"])(
  "scope refuses concealed staged %s files without clearing the index",
  async (shape) => {
    const { cwd, git } = fixture();
    const path = shape === "restored" ? "protected.txt" : "extra.txt";
    writeFileSync(join(cwd, path), "unapproved\n");
    git("add", "--", path);
    if (shape === "restored") writeFileSync(join(cwd, path), "original\n");
    else unlinkSync(join(cwd, path));
    writeFileSync(join(cwd, "allowed.txt"), "approved\n");
    const staged = git("diff", "--cached", "--binary");
    await expect(assertWorkflowScope(cwd, ["allowed.txt"])).rejects.toThrow(
      "forbidden",
    );
    expect(git("diff", "--cached", "--binary")).toBe(staged);
    expect(git("show", `:${path}`)).toBe("unapproved");
  },
);

it("approved staged/worktree differences and deletions remain explicit scope members", async () => {
  const { cwd, git, before } = fixture();
  writeFileSync(join(cwd, "allowed.txt"), "staged\n");
  git("add", "allowed.txt");
  writeFileSync(join(cwd, "allowed.txt"), "original\n");
  expect(await assertWorkflowScope(cwd, ["allowed.txt"])).toEqual([
    "allowed.txt",
  ]);
  unlinkSync(join(cwd, "allowed.txt"));
  const changes = await assertWorkflowScope(cwd, ["allowed.txt"]);
  git("add", "--", ...changes);
  git("commit", "-qm", "approved removal");
  await expect(
    assertWorkflowCommit(cwd, before, git("rev-parse", "HEAD"), [
      "allowed.txt",
    ]),
  ).resolves.toEqual(["allowed.txt"]);
  expect(readFileSync(join(cwd, "protected.txt"), "utf8")).toBe("original\n");
});

it("actual commit verification refuses extra files and an unexpected parent", async () => {
  const { cwd, git, before } = fixture();
  writeFileSync(join(cwd, "protected.txt"), "unapproved\n");
  git("add", ".");
  git("commit", "-qm", "out of scope");
  const extra = git("rev-parse", "HEAD");
  await expect(
    assertWorkflowCommit(cwd, before, extra, ["allowed.txt"]),
  ).rejects.toThrow("forbidden");
  writeFileSync(join(cwd, "allowed.txt"), "approved\n");
  git("add", ".");
  git("commit", "-qm", "wrong ancestor");
  await expect(
    assertWorkflowCommit(cwd, before, git("rev-parse", "HEAD"), [
      "allowed.txt",
    ]),
  ).rejects.toThrow("stale");
  expect(git("rev-parse", "HEAD")).not.toBe(before);
});

it("a declared directory scope covers its contents in scope and commit checks", async () => {
  const { cwd, git, before } = fixture();
  mkdirSync(join(cwd, "src/feature"), { recursive: true });
  writeFileSync(join(cwd, "src/feature/a.ts"), "export {};\n");
  writeFileSync(join(cwd, "src/featured.ts"), "outside\n");
  await expect(assertWorkflowScope(cwd, ["src/feature"])).rejects.toThrow(
    WorkflowRefusal,
  );
  unlinkSync(join(cwd, "src/featured.ts"));
  expect(await assertWorkflowScope(cwd, ["src/feature"])).toEqual([
    "src/feature/a.ts",
  ]);
  git("add", ".");
  git("commit", "-qm", "directory scope");
  await expect(
    assertWorkflowCommit(cwd, before, git("rev-parse", "HEAD"), [
      "src/feature",
    ]),
  ).resolves.toEqual(["src/feature/a.ts"]);
});

it("a local-merge agreement binds the branch, not its head or any uncommitted bytes; a working-copy one binds the exact bytes", () => {
  const { cwd, git } = fixture();
  const p = plan();
  p.tasks[0].writes = ["allowed.txt"];
  p.tasks[1].writes = ["protected.txt"];
  const first = workflowObservation(cwd, p);
  expect(first.branch).toBe(git("symbolic-ref", "HEAD"));
  // Guidance, notes and even a declared target changed in the checkout: the
  // delivery works from committed history and follows its branch.
  writeFileSync(join(cwd, "AGENTS.md"), "uncommitted guidance\n");
  mkdirSync(join(cwd, ".cadence"));
  writeFileSync(join(cwd, ".cadence/project.md"), "# untracked notes\n");
  writeFileSync(join(cwd, "allowed.txt"), "the user's own draft\n");
  expect(workflowObservation(cwd, p).identity).toBe(first.identity);
  // The branch moved: the same agreement, a later baseline.
  git("add", "-A");
  git("commit", "-qm", "the branch moved");
  const later = workflowObservation(cwd, p);
  expect(later.identity).toBe(first.identity);
  expect(later.head).not.toBe(first.head);
  // Another branch is another agreement.
  git("switch", "-qc", "release");
  expect(workflowObservation(cwd, p).identity).not.toBe(first.identity);
  git("switch", "-q", "-");

  // Direct edits bind what they will edit, byte for byte.
  const direct = { ...p, delivery: "working-copy" as const };
  const exact = workflowObservation(cwd, direct);
  expect(exact).toMatchObject({ head: "", branch: "" });
  writeFileSync(join(cwd, "unrelated.txt"), "user bytes\n");
  expect(workflowObservation(cwd, direct).identity).toBe(exact.identity);
  writeFileSync(join(cwd, "allowed.txt"), "changed target\n");
  expect(workflowObservation(cwd, direct).identity).not.toBe(exact.identity);
});

it("working-copy snapshots attribute new, changed and reverted paths", async () => {
  const { cwd } = fixture();
  writeFileSync(join(cwd, "protected.txt"), "dirty before\n");
  const before = await workingSnapshot(cwd, ["allowed.txt"]);
  expect(before.git).toBe(true);
  writeFileSync(join(cwd, "allowed.txt"), "in scope\n");
  writeFileSync(join(cwd, "protected.txt"), "original\n");
  writeFileSync(join(cwd, "stray.txt"), "out of scope\n");
  const after = await workingSnapshot(cwd, [
    "allowed.txt",
    ...before.paths.keys(),
  ]);
  expect(snapshotChanges(before.paths, after.paths)).toEqual([
    "allowed.txt",
    "protected.txt",
    "stray.txt",
  ]);
  const plain = mkdtempSync(join(tmpdir(), "workflow-plain-"));
  const outside = await workingSnapshot(plain, ["a.txt"]);
  expect(outside.git).toBe(false);
  expect([...outside.paths.keys()]).toEqual(["a.txt"]);
});

it("local merge refuses ignored targets; ignored residue outside task writes is retained", async () => {
  const { cwd, git } = fixture();
  writeFileSync(join(cwd, ".gitignore"), "generated/\n");
  git("add", ".gitignore");
  git("commit", "-qm", "ignore");
  const p = plan();
  p.tasks[0].writes = ["generated/out.txt"];
  p.tasks[1].writes = ["b.txt"];
  let refusal: unknown;
  try {
    workflowObservation(cwd, p);
  } catch (error) {
    refusal = error;
  }
  expect(refusal).toMatchObject({ code: "invalid" });
  expect((refusal as WorkflowRefusal).detail).toContain("generated/out.txt");
  p.delivery = "working-copy";
  expect(() => workflowObservation(cwd, p)).not.toThrow();
  mkdirSync(join(cwd, "src/generated"), { recursive: true });
  writeFileSync(join(cwd, "src/generated/edit.txt"), "only copy\n");
  writeFileSync(join(cwd, ".gitignore"), "generated/\n");
  expect(await worktreeResidue(cwd)).toEqual(["src/generated/edit.txt"]);
});

it("a directory target's identity follows its contents", async () => {
  const { cwd } = fixture();
  mkdirSync(join(cwd, "dir/nested"), { recursive: true });
  writeFileSync(join(cwd, "dir/nested/a.txt"), "one\n");
  const first = pathIdentity(cwd, "dir");
  expect(await pathIdentityAsync(cwd, "dir")).toBe(first);
  writeFileSync(join(cwd, "dir/nested/a.txt"), "two\n");
  const second = pathIdentity(cwd, "dir");
  expect(second).not.toBe(first);
  expect(await pathIdentityAsync(cwd, "dir")).toBe(second);
  writeFileSync(join(cwd, "dir/new.txt"), "added\n");
  expect(pathIdentity(cwd, "dir")).not.toBe(second);
  // A Git scope pinned by HEAD and the dirty check skips the walk.
  expect(pathIdentity(cwd, "dir", false)).toBe("directory");
});

it.each(["--assume-unchanged", "--skip-worktree"])(
  "%s cannot conceal edits from a scope check or authorize worktree removal",
  async (flag) => {
    const { cwd, git } = fixture();
    git("update-index", flag, "allowed.txt");
    writeFileSync(join(cwd, "allowed.txt"), "hidden consumer work");
    expect(git("status", "--porcelain")).toBe("");
    // An owned worktree with bytes Git was told not to look at is neither a
    // clean scope nor free of residue.
    await expect(assertWorkflowScope(cwd, [])).rejects.toThrow("conflict");
    expect(await worktreeResidue(cwd)).toContain("allowed.txt");
    expect(readFileSync(join(cwd, "allowed.txt"), "utf8")).toBe(
      "hidden consumer work",
    );
  },
);
