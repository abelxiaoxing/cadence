import { spawn } from "node:child_process";
import { preflightCandidate } from "./candidate-preflight.ts";
import { diffWritePaths } from "./contracts.ts";
import { isCurrent } from "./file-snapshot.ts";
import type { ResultStore } from "./result-store.ts";

interface CommandResult {
  code: number;
  stdout: Buffer;
  stderr: Buffer;
  cancelled: boolean;
}

async function git(
  root: string,
  args: string[],
  input: Buffer,
  signal?: AbortSignal,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: root,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      ...(signal ? { signal } : {}),
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.stdout.on("data", (b: Buffer) => stdout.push(b));
    child.stderr.on("data", (b: Buffer) => stderr.push(b));
    child.on("error", (error) => {
      if (signal?.aborted || error.name === "AbortError") {
        finish({
          code: 1,
          stdout: Buffer.concat(stdout),
          stderr: Buffer.concat(stderr),
          cancelled: true,
        });
      } else {
        reject(error);
      }
    });
    child.on("close", (code) =>
      finish({
        code: code ?? 1,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        cancelled: signal?.aborted ?? false,
      }),
    );
    child.stdin.end(input);
  });
}

function cancellationFailure(): { ok: false; error: string } {
  return { ok: false, error: "candidate application cancelled" };
}

export async function applyRetainedPatch(input: {
  root: string;
  id: string;
  store: ResultStore;
  signal?: AbortSignal;
}): Promise<
  | { ok: true; targets: string[]; checkExitCode: 0; applyExitCode: 0 }
  | { ok: false; error: string }
> {
  if (input.signal?.aborted) return cancellationFailure();
  const retained = input.store.get(input.id);
  if (!retained) return { ok: false, error: "retained result not found" };
  if (retained.root !== input.root)
    return { ok: false, error: "retained result root mismatch" };
  if (!retained.verification && !isCurrent(input.root, retained.snapshot))
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

  if (retained.verification) {
    if (
      !retained.packageManifest ||
      !retained.lockfile ||
      !retained.dependencyTarget
    ) {
      return {
        ok: false,
        error: "retained candidate preflight inputs are incomplete",
      };
    }
    const preflight = await preflightCandidate({
      root: input.root,
      diff: retained.diff,
      writeSet: retained.writeSet,
      snapshot: retained.snapshot,
      baseline: retained.baseline,
      verification: retained.verification,
      packageManifest: retained.packageManifest,
      lockfile: retained.lockfile,
      dependencyTarget: retained.dependencyTarget,
      signal: input.signal,
    });
    if (!preflight.ok) {
      return {
        ok: false,
        error: `candidate preflight rejected: ${preflight.class}:${preflight.code}`,
      };
    }
    if (!isCurrent(input.root, retained.snapshot)) {
      return { ok: false, error: "stale file snapshot after preflight" };
    }
  }
  if (input.signal?.aborted) return cancellationFailure();

  const numstat = await git(
    input.root,
    ["apply", "--numstat", "-z", "--recount", "-"],
    retained.diff,
    input.signal,
  );
  if (numstat.cancelled || input.signal?.aborted) return cancellationFailure();
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
    input.signal,
  );
  if (summary.cancelled || input.signal?.aborted) return cancellationFailure();
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
    input.signal,
  );
  if (check.cancelled || input.signal?.aborted) return cancellationFailure();
  if (check.code !== 0)
    return {
      ok: false,
      error: `git apply --check failed: ${check.stderr.toString("utf8")}`,
    };
  if (input.signal?.aborted) return cancellationFailure();
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
