/** Bounded, no-config-write Git observations and exact workflow write scopes. */
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  gitArguments,
  gitEnvironment,
  readBounded,
  safeDirectory,
} from "../task-store.ts";
import { ContractError } from "./contracts/core.ts";
import { type WorkflowPlan, workflowPath } from "./contracts/workflow.ts";
import { hash } from "./private-files.ts";

export function gitRead(cwd: string, args: string[]): string {
  const r = spawnSync("git", gitArguments(args), {
    cwd,
    env: gitEnvironment(),
    encoding: "utf8",
    timeout: 10000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  if (r.error || r.status !== 0) throw new ContractError("unavailable");
  return r.stdout;
}
export function safeWorkflowFile(cwd: string, name: string): string {
  workflowPath(name);
  const p = resolve(cwd, name);
  if (relative(cwd, p).startsWith("..")) throw new ContractError("forbidden");
  safeDirectory(dirname(p));
  try {
    const st = lstatSync(p);
    if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1)
      throw new ContractError("forbidden");
  } catch (e) {
    if (!(e instanceof Error && "code" in e && e.code === "ENOENT")) throw e;
  }
  return p;
}
export function workflowChanged(cwd: string): string[] {
  return [
    ...new Set([
      ...gitRead(cwd, [
        "diff",
        "--name-only",
        "-z",
        "--no-renames",
        "--no-ext-diff",
        "--no-textconv",
        "HEAD",
        "--",
      ])
        .split("\0")
        .filter(Boolean),
      // HEAD -> working tree alone can hide staged bytes when the worktree
      // was restored to HEAD. The commit consumes the index, not that view.
      ...gitRead(cwd, [
        "diff",
        "--cached",
        "--name-only",
        "-z",
        "--no-renames",
        "--no-ext-diff",
        "--no-textconv",
        "HEAD",
        "--",
      ])
        .split("\0")
        .filter(Boolean),
      ...gitRead(cwd, ["ls-files", "--others", "--exclude-standard", "-z"])
        .split("\0")
        .filter(Boolean),
    ]),
  ];
}
export function assertWorkflowScope(
  cwd: string,
  allowed: readonly string[],
): string[] {
  const changes = workflowChanged(cwd);
  for (const name of changes) {
    if (!allowed.includes(name)) throw new ContractError("forbidden");
    safeWorkflowFile(cwd, name);
  }
  return changes;
}
/** A task commit must extend its observed baseline and contain only its scope. */
export function assertWorkflowCommit(
  cwd: string,
  before: string,
  commit: string,
  allowed: readonly string[],
): void {
  if (gitRead(cwd, ["show", "-s", "--format=%P", commit]).trim() !== before)
    throw new ContractError("stale");
  const names = gitRead(cwd, [
    "diff",
    "--name-only",
    "-z",
    "--no-renames",
    "--no-ext-diff",
    "--no-textconv",
    before,
    commit,
    "--",
  ])
    .split("\0")
    .filter(Boolean);
  for (const name of names) {
    if (!allowed.includes(name)) throw new ContractError("forbidden");
    safeWorkflowFile(cwd, name);
  }
}
export function workflowObservation(
  cwd: string,
  plan?: WorkflowPlan,
): { identity: string; head: string; branch: string } {
  const paths = [
    ...new Set([
      ".cadence/project.md",
      "AGENTS.md",
      ...(plan?.tasks.flatMap((t) => t.writes) ?? []),
    ]),
  ];
  const contents = paths.map((p) => {
    const file = safeWorkflowFile(cwd, p);
    const bytes = readBounded(file, 1024 * 1024);
    return [p, bytes ? hash(bytes) : null];
  });
  if (plan?.delivery === "working-copy") {
    // The ordinary bounded working-copy observation is additionally taken by the
    // service; this exact per-write identity refuses substituted direct targets.
    return { identity: hash(JSON.stringify(contents)), head: "", branch: "" };
  }
  const head = gitRead(cwd, ["rev-parse", "--verify", "HEAD"]).trim();
  const branch = gitRead(cwd, ["symbolic-ref", "HEAD"]).trim();
  if (!/^refs\/heads\//u.test(branch) || !/^[a-f0-9]{40,64}$/u.test(head))
    throw new ContractError("invalid");
  if (plan) {
    // A task cannot implicitly adopt dirty inputs as its committed baseline.
    const dirty = workflowChanged(cwd);
    if (
      dirty.some((p) =>
        paths.some(
          (q) => p === q || p.startsWith(`${q}/`) || q.startsWith(`${p}/`),
        ),
      )
    )
      throw new ContractError("conflict");
    gitRead(cwd, ["var", "GIT_AUTHOR_IDENT"]);
    gitRead(cwd, ["var", "GIT_COMMITTER_IDENT"]);
  }
  return {
    head,
    branch,
    identity: hash(
      JSON.stringify({
        head,
        branch,
        contents,
        status: gitRead(cwd, ["status", "--porcelain=v1", "-uall"]),
        index: gitRead(cwd, [
          "diff",
          "--cached",
          "--binary",
          "--no-ext-diff",
          "--no-textconv",
        ]),
        worktree: gitRead(cwd, [
          "diff",
          "--binary",
          "--no-ext-diff",
          "--no-textconv",
        ]),
      }),
    ),
  };
}
export function projectMarkdown(cwd: string, context: string): string {
  const file = safeWorkflowFile(cwd, ".cadence/project.md");
  const previous =
    readBounded(file, 128 * 1024)?.toString("utf8") ??
    "# Cadence project context\n";
  const start = "<!-- CADENCE:PROJECT:START -->",
    end = "<!-- CADENCE:PROJECT:END -->";
  if (
    previous.split(start).length !== previous.split(end).length ||
    previous.split(start).length > 2
  )
    throw new ContractError("conflict");
  const block = `${start}\n${context}\n${end}`;
  if (!previous.includes(start)) return `${previous.trimEnd()}\n\n${block}\n`;
  if (previous.indexOf(end) < previous.indexOf(start))
    throw new ContractError("conflict");
  return (
    previous.slice(0, previous.indexOf(start)) +
    block +
    previous.slice(previous.indexOf(end) + end.length)
  );
}
/** Existing package dependencies must be provisioned by plan.setup, never copied implicitly. */
export function assertWorktree(root: string, cwd: string): void {
  if (
    !safeDirectory(cwd) ||
    resolve(gitRead(cwd, ["rev-parse", "--show-toplevel"]).trim()) !==
      resolve(cwd)
  )
    throw new ContractError("stale");
  const common = (p: string) =>
    resolve(p, gitRead(p, ["rev-parse", "--git-common-dir"]).trim());
  if (common(root) !== common(cwd)) throw new ContractError("stale");
  const marker = join(cwd, ".git");
  if (
    !lstatSync(marker).isFile() ||
    !readFileSync(marker, "utf8").startsWith("gitdir: ")
  )
    throw new ContractError("stale");
}
