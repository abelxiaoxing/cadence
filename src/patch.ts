import { spawn } from "node:child_process";
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { preflightCandidate } from "./candidate-preflight.ts";
import {
  type AgentsCheckpointRequest,
  type ApplyCandidateResult,
  type CandidateFailure,
  diffWritePaths,
  validateAgentsCheckpointRequest,
} from "./contracts.ts";
import { type Bound, isCurrent } from "./file-snapshot.ts";
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

function failure(value: CandidateFailure): {
  ok: false;
  failure: CandidateFailure;
} {
  return { ok: false, failure: value };
}

function cancellationFailure(): {
  ok: false;
  failure: CandidateFailure;
} {
  return failure({ kind: "cancelled", code: "cancelled" });
}

type AgentsCheckpointResult =
  | {
      ok: true;
      target: string;
      agentsImpact: AgentsCheckpointRequest["agentsImpact"];
      checkExitCode: 0;
      applyExitCode: 0;
    }
  | {
      ok: false;
      failure: CandidateFailure;
    };

const AGENTS_START = "<!-- ABEL:AGENTS-INDEX:START -->";
const AGENTS_END = "<!-- ABEL:AGENTS-INDEX:END -->";
const NONREGULAR_AGENTS_TARGET = Symbol("nonregular AGENTS target");

function managedParts(text: string): { prefix: string; suffix: string } | null {
  const lines = text.split("\n");
  const starts: Array<{ line: number; start: number; end: number }> = [];
  const ends: Array<{ line: number; start: number; end: number }> = [];
  let offset = 0;
  for (const [line, value] of lines.entries()) {
    const range = { line, start: offset, end: offset + value.length };
    if (value === AGENTS_START) starts.push(range);
    if (value === AGENTS_END) ends.push(range);
    offset = range.end + 1;
  }
  if (
    starts.length !== 1 ||
    ends.length !== 1 ||
    starts[0].line >= ends[0].line
  ) {
    return null;
  }
  return {
    prefix: text.slice(0, starts[0].start),
    suffix: text.slice(ends[0].end),
  };
}

function checkpointContentIsScoped(
  impact: AgentsCheckpointRequest["agentsImpact"],
  before: string | null,
  after: string | null,
): boolean {
  const beforeParts = before === null ? null : managedParts(before);
  const afterParts = after === null ? null : managedParts(after);
  if (impact === "update-existing") {
    return (
      beforeParts !== null &&
      afterParts !== null &&
      beforeParts.prefix === afterParts.prefix &&
      beforeParts.suffix === afterParts.suffix
    );
  }
  if (impact === "create-index") {
    return (
      before === null &&
      afterParts !== null &&
      afterParts.prefix.trim() === "" &&
      afterParts.suffix.trim() === ""
    );
  }
  if (beforeParts === null) return false;
  if (after === null) {
    return beforeParts.prefix.trim() === "" && beforeParts.suffix.trim() === "";
  }
  return (
    managedParts(after) === null &&
    after === `${beforeParts.prefix}${beforeParts.suffix}`
  );
}

function regularText(
  root: string,
  target: string,
): string | null | typeof NONREGULAR_AGENTS_TARGET {
  const resolvedRoot = path.resolve(root);
  const absolute = path.resolve(resolvedRoot, target);
  if (
    absolute === resolvedRoot ||
    !absolute.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error("AGENTS target escapes the root");
  }
  const stat = lstatSync(absolute, { throwIfNoEntry: false });
  if (!stat) return null;
  if (!stat.isFile() || stat.isSymbolicLink()) {
    return NONREGULAR_AGENTS_TARGET;
  }
  return readFileSync(absolute, "utf8");
}

export async function applyAgentsCheckpoint(
  root: string,
  value: unknown,
  signal?: AbortSignal,
): Promise<AgentsCheckpointResult> {
  const validation = validateAgentsCheckpointRequest(value);
  if (!validation.ok) {
    return failure({ kind: "artifact", code: "invalid-checkpoint-contract" });
  }
  const request = validation.value;
  if (signal?.aborted) {
    return cancellationFailure();
  }
  const before = regularText(root, request.agentsTarget);
  if (before === NONREGULAR_AGENTS_TARGET) {
    return failure({ kind: "artifact", code: "nonregular-mode" });
  }
  if (!isCurrent(root, request.snapshot as Bound)) {
    return failure({ kind: "stale", code: "stale-snapshot" });
  }
  let targets: string[];
  try {
    targets = diffWritePaths(request.diff).paths;
  } catch {
    return failure({ kind: "artifact", code: "invalid-diff" });
  }
  if (targets.length !== 1 || targets[0] !== request.agentsTarget) {
    return failure({ kind: "artifact", code: "agents-target-mismatch" });
  }

  let temp: string | undefined;
  try {
    if (
      (request.agentsImpact === "create-index" && before !== null) ||
      (request.agentsImpact !== "create-index" && before === null)
    ) {
      return failure({ kind: "artifact", code: "agents-impact-mismatch" });
    }
    temp = mkdtempSync(path.join(tmpdir(), "cadence-agents-checkpoint-"));
    if (before !== null) {
      const temporaryTarget = path.join(temp, request.agentsTarget);
      mkdirSync(path.dirname(temporaryTarget), { recursive: true });
      copyFileSync(path.join(root, request.agentsTarget), temporaryTarget);
    }
    const bytes = Buffer.from(request.diff, "utf8");
    const candidateCheck = await git(
      temp,
      ["apply", "--check", "--recount", "--whitespace=nowarn", "-"],
      bytes,
      signal,
    );
    if (candidateCheck.cancelled || signal?.aborted) {
      return cancellationFailure();
    }
    if (candidateCheck.code !== 0) {
      return failure({ kind: "artifact", code: "git-apply-check-failed" });
    }
    const candidateApply = await git(
      temp,
      ["apply", "--recount", "--whitespace=nowarn", "-"],
      bytes,
      signal,
    );
    if (candidateApply.cancelled || signal?.aborted) {
      return cancellationFailure();
    }
    if (candidateApply.code !== 0) {
      return failure({ kind: "artifact", code: "git-apply-failed" });
    }
    const after = regularText(temp, request.agentsTarget);
    if (after === NONREGULAR_AGENTS_TARGET) {
      return failure({ kind: "artifact", code: "nonregular-mode" });
    }
    if (!checkpointContentIsScoped(request.agentsImpact, before, after)) {
      return failure({ kind: "artifact", code: "outside-managed-region" });
    }
    if (!isCurrent(root, request.snapshot as Bound)) {
      return failure({ kind: "stale", code: "stale-snapshot" });
    }
    const check = await git(
      root,
      ["apply", "--check", "--recount", "--whitespace=nowarn", "-"],
      bytes,
      signal,
    );
    if (check.cancelled || signal?.aborted) {
      return cancellationFailure();
    }
    if (check.code !== 0) {
      return failure({ kind: "stale", code: "git-apply-check-failed" });
    }
    const apply = await git(
      root,
      ["apply", "--recount", "--whitespace=nowarn", "-"],
      bytes,
    );
    if (apply.code !== 0) {
      return failure({ kind: "environment", code: "git-apply-failed" });
    }
    return {
      ok: true,
      target: request.agentsTarget,
      agentsImpact: request.agentsImpact,
      checkExitCode: 0,
      applyExitCode: 0,
    };
  } finally {
    if (temp) rmSync(temp, { recursive: true, force: true });
  }
}

export async function applyRetainedPatch(input: {
  root: string;
  id: string;
  store: ResultStore;
  signal?: AbortSignal;
}): Promise<ApplyCandidateResult> {
  if (input.signal?.aborted) return cancellationFailure();
  const retained = input.store.resolveForApply(input.id);
  if (retained.root !== input.root)
    throw new Error("retained result root mismatch");
  if (!retained.verification && !isCurrent(input.root, retained.snapshot))
    return failure({ kind: "stale", code: "stale-snapshot" });

  let targets: string[];
  try {
    targets = diffWritePaths(retained.diff.toString("utf8")).paths;
  } catch {
    return failure({ kind: "artifact", code: "invalid-diff" });
  }
  if (targets.some((path) => !retained.writeSet.includes(path))) {
    return failure({ kind: "artifact", code: "write-set-mismatch" });
  }

  if (retained.verification) {
    if (
      !retained.packageManifest ||
      !retained.lockfile ||
      !retained.dependencyTarget
    ) {
      throw new Error("retained candidate preflight inputs are incomplete");
    }
    const preflight = await preflightCandidate({
      root: input.root,
      diff: retained.diff,
      writeSet: retained.writeSet,
      approvedDependencies: retained.approvedDependencies,
      snapshot: retained.snapshot,
      baseline: retained.baseline,
      verification: retained.verification,
      packageManifest: retained.packageManifest,
      lockfile: retained.lockfile,
      dependencyTarget: retained.dependencyTarget,
      signal: input.signal,
    });
    if (!preflight.ok) {
      switch (preflight.kind) {
        case "artifact":
          return failure({
            kind: preflight.kind,
            code: preflight.code,
            ...(preflight.excerpt ? { evidence: [preflight.excerpt] } : {}),
          });
        case "stale":
          return failure({ kind: preflight.kind, code: preflight.code });
        case "environment":
          return failure({ kind: preflight.kind, code: preflight.code });
        case "approval-boundary":
          return failure({ kind: preflight.kind, code: preflight.code });
        case "cancelled":
          return failure({ kind: preflight.kind, code: preflight.code });
      }
    }
    if (!isCurrent(input.root, retained.snapshot)) {
      return failure({ kind: "stale", code: "stale-snapshot" });
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
    return failure({ kind: "artifact", code: "invalid-diff" });
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
    return failure({ kind: "artifact", code: "invalid-diff" });
  }
  const check = await git(
    input.root,
    ["apply", "--check", "--recount", "--whitespace=nowarn", "-"],
    retained.diff,
    input.signal,
  );
  if (check.cancelled || input.signal?.aborted) return cancellationFailure();
  if (check.code !== 0)
    return failure({ kind: "artifact", code: "git-apply-check-failed" });
  if (input.signal?.aborted) return cancellationFailure();
  const apply = await git(
    input.root,
    ["apply", "--recount", "--whitespace=nowarn", "-"],
    retained.diff,
  );
  if (apply.code !== 0)
    return failure({ kind: "environment", code: "git-apply-failed" });
  input.store.discard(input.id);
  return {
    ok: true,
    result: { targets, checkExitCode: 0, applyExitCode: 0 },
  };
}
