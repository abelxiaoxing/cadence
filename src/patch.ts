import { spawn } from "node:child_process";
import { diffWritePaths } from "./contracts.ts";
import { isCurrent } from "./file-snapshot.ts";
import type { ResultStore } from "./result-store.ts";

interface CommandResult {
  code: number;
  stdout: Buffer;
  stderr: Buffer;
}

async function git(
  root: string,
  args: string[],
  input: Buffer,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: root,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (b: Buffer) => stdout.push(b));
    child.stderr.on("data", (b: Buffer) => stderr.push(b));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      }),
    );
    child.stdin.end(input);
  });
}

export async function applyRetainedPatch(input: {
  root: string;
  id: string;
  store: ResultStore;
}): Promise<
  | { ok: true; targets: string[]; checkExitCode: 0; applyExitCode: 0 }
  | { ok: false; error: string }
> {
  const retained = input.store.get(input.id);
  if (!retained) return { ok: false, error: "retained result not found" };
  if (retained.root !== input.root)
    return { ok: false, error: "retained result root mismatch" };
  if (!isCurrent(input.root, retained.snapshot))
    return { ok: false, error: "stale file snapshot" };

  let targets: string[];
  try {
    targets = diffWritePaths(retained.diff.toString("utf8")).paths;
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  if (targets.some((path) => !retained.writeSet.includes(path))) {
    return {
      ok: false,
      error: "patch target is outside the declared write set",
    };
  }

  const numstat = await git(
    input.root,
    ["apply", "--numstat", "-z", "--recount", "-"],
    retained.diff,
  );
  if (numstat.code !== 0 || numstat.stdout.includes(Buffer.from("-\t-\t"))) {
    return {
      ok: false,
      error: `git numstat screening failed: ${numstat.stderr.toString("utf8")}`,
    };
  }
  const summary = await git(
    input.root,
    ["apply", "--summary", "--recount", "-"],
    retained.diff,
  );
  if (
    summary.code !== 0 ||
    /rename|copy|mode change|create mode 160000/i.test(
      summary.stdout.toString("utf8"),
    )
  ) {
    return { ok: false, error: "git summary screening rejected the patch" };
  }
  const check = await git(
    input.root,
    ["apply", "--check", "--recount", "--whitespace=nowarn", "-"],
    retained.diff,
  );
  if (check.code !== 0)
    return {
      ok: false,
      error: `git apply --check failed: ${check.stderr.toString("utf8")}`,
    };
  const apply = await git(
    input.root,
    ["apply", "--recount", "--whitespace=nowarn", "-"],
    retained.diff,
  );
  if (apply.code !== 0)
    return {
      ok: false,
      error: `git apply failed: ${apply.stderr.toString("utf8")}`,
    };
  input.store.discard(input.id);
  return { ok: true, targets, checkExitCode: 0, applyExitCode: 0 };
}
