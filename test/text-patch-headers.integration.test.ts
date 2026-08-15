import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { diffWritePaths } from "../src/contracts.ts";
import { applyRetainedPatch } from "../src/patch.ts";
import { ResultStore } from "../src/result-store.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "abel-hdr-"));
  roots.push(root);
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@example.invalid"]);
  git(root, ["config", "user.name", "Abel Test"]);
  writeFileSync(join(root, "a.txt"), "old\n");
  git(root, ["add", "a.txt"]);
  git(root, ["commit", "-qm", "base"]);
  return root;
}

it("header red: ordinary and copy direct/parent outcomes", async () => {
  // (a) standard ordinary add/delete patch
  const root = makeRoot();
  writeFileSync(join(root, "b.txt"), "new\n");
  rmSync(join(root, "a.txt"));
  git(root, ["add", "-A"]);
  const ordinary = git(root, ["diff", "HEAD"]);
  git(root, ["checkout", "-qf", "HEAD"]);
  execFileSync("git", ["apply", "--check", "--whitespace=nowarn", "-"], {
    cwd: root,
    input: ordinary,
  });

  // (b) complete copy record via --find-copies-harder
  const copyRoot = makeRoot();
  writeFileSync(join(copyRoot, "b.txt"), "old\n");
  git(copyRoot, ["add", "b.txt"]);
  const copy = git(copyRoot, [
    "diff",
    "--cached",
    "HEAD",
    "--find-copies-harder",
  ]);
  git(copyRoot, ["checkout", "-qf", "HEAD"]);
  execFileSync("git", ["apply", "--check", "--whitespace=nowarn", "-"], {
    cwd: copyRoot,
    input: copy,
  });

  // DIRECT parser outcome for the ordinary add/delete
  let directOrdinary: {
    threw: boolean;
    paths: string[] | null;
    error: string | null;
  } = { threw: false, paths: null, error: null };
  try {
    directOrdinary.paths = diffWritePaths(ordinary).paths;
  } catch (err) {
    directOrdinary = {
      threw: true,
      paths: null,
      error: (err as Error).message,
    };
  }

  // ORDINARY parent-path outcome
  const ordinaryStore = new ResultStore();
  const ordinaryId = ordinaryStore.retain({
    diff: ordinary,
    writeSet: ["a.txt", "b.txt"],
    root,
  });
  const ordinaryParent = await applyRetainedPatch({
    root,
    id: ordinaryId,
    store: ordinaryStore,
  });

  // DIRECT copy parser outcome
  let directCopy: { threw: boolean; error: string | null } = {
    threw: false,
    error: null,
  };
  try {
    diffWritePaths(copy);
  } catch (err) {
    directCopy = { threw: true, error: (err as Error).message };
  }

  // COPY parent-path outcome
  const copyStore = new ResultStore();
  const copyId = copyStore.retain({
    diff: copy,
    writeSet: ["a.txt", "b.txt"],
    root: copyRoot,
  });
  const copyParent = await applyRetainedPatch({
    root: copyRoot,
    id: copyId,
    store: copyStore,
  });

  // ---- labelled soft assertions (every path already executed) ----
  expect
    .soft(
      !directOrdinary.threw &&
        directOrdinary.paths?.includes("a.txt") &&
        directOrdinary.paths?.includes("b.txt"),
      "wrong ordinary direct paths",
    )
    .toBe(true);
  expect
    .soft(ordinaryParent.ok, "failed ordinary parent application")
    .toBe(true);
  expect
    .soft(
      directCopy.threw && directCopy.error?.includes("copy"),
      "direct copy error lacking copy",
    )
    .toBe(true);
  expect
    .soft(
      !copyParent.ok && copyParent.error.includes("copy"),
      "parent copy error lacking copy",
    )
    .toBe(true);
});
