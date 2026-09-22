import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { VerificationFailureSummary } from "./contracts.ts";
import { isValidRelativePath } from "./contracts.ts";
import type { DurableWorkflowEngineOptions } from "./durable-contracts.ts";
import type { ParentModelSource } from "./model-source.ts";
import { isSafeRegularFile } from "./safe-path.ts";
import {
  buildSubagentPrompt,
  runSubagentProcess,
  SUBAGENT_LIMITS,
} from "./subagent-process.ts";
import type { DurableCandidateProposal } from "./workflow-policy.ts";

function permitsContextRead(
  relative: string,
  roots: readonly string[],
): boolean {
  return (
    isValidRelativePath(relative) &&
    relative.split("/").every((part) => !part.startsWith(".")) &&
    !/\.(?:pem|key|p12|pfx)$/iu.test(relative) &&
    roots.some((root) => relative === root || relative.startsWith(`${root}/`))
  );
}

function restoreWorkspace(root: string, baseline: string): void {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  cpSync(baseline, root, { recursive: true, force: true, dereference: false });
}

/** Produce a Git patch from two disposable trees without invoking a shell. */
function workspaceDiff(baseline: string, proposal: string): Uint8Array {
  const parent = path.dirname(baseline);
  const proposalSnapshot = mkdtempSync(
    path.join(parent, "cadence-subagent-proposal-"),
  );
  cpSync(proposal, proposalSnapshot, {
    recursive: true,
    force: true,
    dereference: false,
  });
  try {
    const baseName = path.basename(baseline);
    const proposalName = path.basename(proposalSnapshot);
    try {
      execFileSync(
        "git",
        [
          "-c",
          "core.autocrlf=false",
          "-c",
          "core.eol=lf",
          "diff",
          "--no-index",
          "--binary",
          "--no-color",
          "--",
          baseName,
          proposalName,
        ],
        {
          cwd: parent,
          encoding: "buffer",
          maxBuffer: 8 * 1024 * 1024,
          stdio: ["ignore", "pipe", "ignore"],
        },
      );
      return Buffer.alloc(0);
    } catch (error) {
      if (!error || typeof error !== "object") return Buffer.alloc(0);
      const output = (error as { stdout?: Buffer }).stdout;
      if (!output) return Buffer.alloc(0);
      const pathPrefixes = [
        `a/${baseName}/`,
        `a/${proposalName}/`,
        `b/${baseName}/`,
        `b/${proposalName}/`,
      ];
      const normalizeHeader = (line: string): string => {
        let normalized = line;
        for (const prefix of pathPrefixes) {
          const replacement = prefix.startsWith("a/") ? "a/" : "b/";
          normalized = normalized.replaceAll(prefix, replacement);
        }
        return normalized;
      };
      const normalized = output
        .toString("utf8")
        .split("\n")
        .map((line) =>
          line.startsWith("diff --git ") ||
          line.startsWith("--- ") ||
          line.startsWith("+++ ")
            ? normalizeHeader(line)
            : line,
        )
        .join("\n");
      return Buffer.from(normalized, "utf8");
    }
  } finally {
    rmSync(proposalSnapshot, { recursive: true, force: true });
  }
}

export async function proposeProcessPackageCandidate(
  input: Parameters<DurableWorkflowEngineOptions["proposeCandidate"]>[0],
  context: ParentModelSource | undefined,
  implementationAgent: { content: string },
  verificationDiagnostics: VerificationFailureSummary[] = [],
): Promise<DurableCandidateProposal> {
  if (!context) return { kind: "paused", code: "parent-context-unavailable" };
  if (input.signal.aborted)
    return { kind: "operation-cancelled", code: "cancelled" };
  const phase = input.task.phases[input.phase];
  if (!phase) return { kind: "paused", code: "task-phase-unavailable" };
  const taskPhases = Object.values(input.task.phases);
  const read = [
    ...new Set(
      taskPhases.flatMap((boundary) => [
        ...boundary.read,
        ...boundary.write,
        ...boundary.delete,
      ]),
    ),
  ].sort();
  const write = input.artifactCorrection
    ? [...new Set(taskPhases.flatMap((boundary) => boundary.write))].sort()
    : [...phase.write];
  const deletePaths = input.artifactCorrection
    ? [...new Set(taskPhases.flatMap((boundary) => boundary.delete))].sort()
    : [...phase.delete];
  const allowedContext = (input.contextReadPaths ?? []).filter(
    (relative) =>
      permitsContextRead(relative, input.task.roots) &&
      isSafeRegularFile(input.workspaceRoot, relative),
  );
  const allowedPaths = [...new Set([...read, ...allowedContext])].sort();
  const baseline = mkdtempSync(
    path.join(os.tmpdir(), "cadence-subagent-baseline-"),
  );
  try {
    cpSync(input.workspaceRoot, baseline, {
      recursive: true,
      force: true,
      dereference: false,
    });
    const prompt = buildSubagentPrompt({
      role: "implementation-worker",
      agentContent: implementationAgent.content,
      objective: input.task.objective,
      context: [
        input.task.context.agents,
        input.task.context.contract,
        JSON.stringify({
          taskId: input.taskId,
          phase: input.phase,
          readSet: allowedPaths,
          writeSet: write,
          deleteSet: deletePaths,
          verificationDiagnostics,
          recoveryFeedback: input.recoveryFeedback,
        }),
      ].join("\n\n"),
      finalConvention:
        "Edit the disposable workspace directly. Finish with a plain-text summary; the parent will derive and validate the candidate diff.",
    });
    const child = await runSubagentProcess({
      role: "implementation-worker",
      cwd: input.workspaceRoot,
      prompt,
      model: context.model
        ? { provider: context.model.provider, id: context.model.id }
        : undefined,
      signal: input.signal,
      timeoutMs: SUBAGENT_LIMITS.timeoutMs,
      onEvent: (event) => {
        if (event.type === "agent_start") input.onRequestStart?.();
        if (event.type === "tool_execution_start") input.onProgress?.();
      },
    });
    if (child.status === "cancelled")
      return { kind: "operation-cancelled", code: "cancelled" };
    if (child.status === "timed-out")
      return { kind: "paused", code: "child-timeout" };
    if (child.status === "output-limit")
      return { kind: "retryable", code: "needs-task-split" };
    if (child.status !== "completed")
      return { kind: "retryable", code: "transport-failure" };
    const bytes = workspaceDiff(baseline, input.workspaceRoot);
    // Existing parent code applies the candidate patch to this root. Restore the
    // baseline first so child edits cannot be applied twice.
    restoreWorkspace(input.workspaceRoot, baseline);
    if (bytes.length === 0)
      return { kind: "retryable", code: "candidate-diff-invalid" };
    return { kind: "candidate", bytes };
  } finally {
    // A child is never allowed to leave edits in the proposal root: the
    // parent-side apply/verification path consumes the generated bytes.
    if (existsSync(baseline)) restoreWorkspace(input.workspaceRoot, baseline);
    rmSync(baseline, { recursive: true, force: true });
  }
}
