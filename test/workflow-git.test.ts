import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  assertWorkflowCommit,
  assertWorkflowScope,
} from "../src/service/workflow-git.ts";

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
  for (const name of ["allowed.txt", "protected.txt"])
    writeFileSync(join(cwd, name), "original\n");
  git("add", ".");
  git("commit", "-qm", "baseline");
  const before = git("rev-parse", "HEAD");
  return { cwd, git, before };
}

it.each(["restored", "deleted"])(
  "scope refuses concealed staged %s files without clearing the index",
  (shape) => {
    const { cwd, git } = fixture();
    const path = shape === "restored" ? "protected.txt" : "extra.txt";
    writeFileSync(join(cwd, path), "unapproved\n");
    git("add", "--", path);
    if (shape === "restored") writeFileSync(join(cwd, path), "original\n");
    else unlinkSync(join(cwd, path));
    writeFileSync(join(cwd, "allowed.txt"), "approved\n");
    const staged = git("diff", "--cached", "--binary");
    expect(() => assertWorkflowScope(cwd, ["allowed.txt"])).toThrow(
      "forbidden",
    );
    expect(git("diff", "--cached", "--binary")).toBe(staged);
    expect(git("show", `:${path}`)).toBe("unapproved");
  },
);

it("approved staged/worktree differences and deletions remain explicit scope members", () => {
  const { cwd, git, before } = fixture();
  writeFileSync(join(cwd, "allowed.txt"), "staged\n");
  git("add", "allowed.txt");
  writeFileSync(join(cwd, "allowed.txt"), "original\n");
  expect(assertWorkflowScope(cwd, ["allowed.txt"])).toEqual(["allowed.txt"]);
  unlinkSync(join(cwd, "allowed.txt"));
  const changes = assertWorkflowScope(cwd, ["allowed.txt"]);
  git("add", "--", ...changes);
  git("commit", "-qm", "approved removal");
  expect(() =>
    assertWorkflowCommit(cwd, before, git("rev-parse", "HEAD"), [
      "allowed.txt",
    ]),
  ).not.toThrow();
  expect(readFileSync(join(cwd, "protected.txt"), "utf8")).toBe("original\n");
});

it("actual commit verification refuses extra files and an unexpected parent", () => {
  const { cwd, git, before } = fixture();
  writeFileSync(join(cwd, "protected.txt"), "unapproved\n");
  git("add", ".");
  git("commit", "-qm", "out of scope");
  const extra = git("rev-parse", "HEAD");
  expect(() =>
    assertWorkflowCommit(cwd, before, extra, ["allowed.txt"]),
  ).toThrow("forbidden");
  writeFileSync(join(cwd, "allowed.txt"), "approved\n");
  git("add", ".");
  git("commit", "-qm", "wrong ancestor");
  expect(() =>
    assertWorkflowCommit(cwd, before, git("rev-parse", "HEAD"), [
      "allowed.txt",
    ]),
  ).toThrow("stale");
  expect(git("rev-parse", "HEAD")).not.toBe(before);
});
