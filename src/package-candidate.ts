import { createHash } from "node:crypto";
import path from "node:path";
import { runChildSession } from "./child-session.ts";
import type { VerificationFailureSummary } from "./contracts.ts";
import { LIMITS } from "./contracts.ts";
import type { DurableWorkflowEngineOptions } from "./durable-contracts.ts";
import type { ParentModelSource } from "./model-source.ts";
import { runtimeForWorkerRoute } from "./parent-provider.ts";
import type { WorkerRoutePolicy } from "./route-policy.ts";
import { isSafeRegularFile } from "./safe-path.ts";
import {
  classifyCandidateContextRequest,
  permitsContextRead,
} from "./submit-tool.ts";
import { transportFailureError } from "./transport-budget.ts";
import type { DurableCandidateProposal } from "./workflow-policy.ts";

function childRequestId(
  operationId: string,
  taskId: string,
  phase: string,
): string {
  return `child-${createHash("sha256").update(`${operationId}\0${taskId}\0${phase}`).digest("hex").slice(0, 40)}`;
}
export async function proposePackageCandidate(
  input: Parameters<DurableWorkflowEngineOptions["proposeCandidate"]>[0],
  context: ParentModelSource | undefined,
  implementationAgent: { content: string },
  verificationDiagnostics: VerificationFailureSummary[] = [],
): Promise<DurableCandidateProposal> {
  if (!context) {
    return { kind: "paused", code: "parent-context-unavailable" };
  }
  const phaseRuntime = await runtimeForWorkerRoute(
    input.route as WorkerRoutePolicy,
    context,
    input.signal,
    process.env,
  );
  if (!phaseRuntime.ok) {
    if (phaseRuntime.failure.kind === "cancelled") {
      return { kind: "operation-cancelled", code: "cancelled" };
    }
    throw new Error(phaseRuntime.failure.code);
  }
  const phase = input.task.phases[input.phase];
  if (!phase) {
    return { kind: "paused", code: "task-phase-unavailable" };
  }
  const taskPhases = Object.values(input.task.phases);
  const executionBoundary = input.artifactCorrection
    ? {
        read: [
          ...new Set(
            taskPhases.flatMap((boundary) => [
              ...boundary.read,
              ...boundary.write,
              ...boundary.delete,
            ]),
          ),
        ].sort(),
        write: [
          ...new Set(taskPhases.flatMap((boundary) => boundary.write)),
        ].sort(),
        delete: [
          ...new Set(taskPhases.flatMap((boundary) => boundary.delete)),
        ].sort(),
      }
    : {
        read: [
          ...new Set(
            taskPhases.flatMap((boundary) => [
              ...boundary.read,
              ...boundary.write,
              ...boundary.delete,
            ]),
          ),
        ].sort(),
        write: [...phase.write],
        delete: [...phase.delete],
      };
  executionBoundary.read = [
    ...new Set([
      ...executionBoundary.read,
      ...(input.contextReadPaths ?? []).filter(
        (relative) =>
          permitsContextRead(relative, input.task.roots) &&
          isSafeRegularFile(input.workspaceRoot, relative),
      ),
    ]),
  ].sort();
  const phaseContract = {
    verificationDiagnostics,
    candidateId: input.candidateArtifact.identity.candidateId,
    taskId: input.taskId,
    phase: input.phase,
    readSet: executionBoundary.read,
    writeSet: executionBoundary.write,
    deleteSet: executionBoundary.delete,
    verification: structuredClone(phase.verification),
    agentsImpact: input.task.agents.impact,
    agentsTarget: input.task.agents.target ?? null,
    agentsManagedOnly: true,
    agentsWriteAllowed: false,
    impactClosure: structuredClone(input.task.impactClosure),
    ...(input.artifactCorrection
      ? { artifactCorrection: structuredClone(input.artifactCorrection) }
      : {}),
    ...(input.contextRequest
      ? { requestedContext: structuredClone(input.contextRequest) }
      : {}),
    ...(input.recoveryFeedback
      ? { recoveryFeedback: structuredClone(input.recoveryFeedback) }
      : {}),
    ...(input.repair
      ? {
          repair: {
            attempt: input.repair.attempt,
            attribution: input.repair.attribution,
            failureIdentities: [...input.repair.failureIdentities],
            verification: structuredClone(input.task.repairVerification),
            inBoundaryOnly: true,
          },
        }
      : {}),
  };
  const child = await runChildSession({
    cwd: input.workspaceRoot,
    modelRuntime: phaseRuntime.modelRuntime,
    model: phaseRuntime.model,
    systemPrompt: [
      implementationAgent.content,
      input.task.objective,
      input.task.context.agents,
      input.task.context.contract,
      "Use recoveryFeedback to change the failing approach. For compact-patch, prefer exact replace operations and omit unchanged bodies; submit one complete atomic patch. Never repeat an unchanged failing submission or weaken verification to obtain a pass.",
      `<phase-contract>${JSON.stringify(phaseContract)}</phase-contract>`,
    ].join("\n\n"),
    requestId: childRequestId(input.operationId, input.taskId, input.phase),
    taskId: input.taskId,
    role: "implementation-worker",
    phase: input.phase,
    output: "diff",
    roots: input.task.roots.map((root) =>
      path.resolve(input.workspaceRoot, root),
    ),
    allowedPaths: [
      ...new Set([
        ...executionBoundary.read,
        ...executionBoundary.write,
        ...executionBoundary.delete,
      ]),
    ],
    timeoutMs: LIMITS.phaseTimeoutMs,
    signal: input.signal,
    ledgerProjection: input.ledgerProjection,
    candidateArtifact: input.candidateArtifact,
    onStreamStart: input.onRequestStart,
    onStreamHeaders: input.onHeaders,
    onStreamProgress: input.onProgress,
  });
  if (!child.ok) {
    if (child.failure.kind === "transport") {
      throw transportFailureError(child.failure.code);
    }
    if (child.failure.kind === "cancelled") {
      return { kind: "operation-cancelled", code: "cancelled" };
    }
    if (child.failure.kind === "approval-boundary") {
      return { kind: "approval-needed", code: child.failure.code };
    }
    if (child.failure.kind === "execution-limit") {
      return { kind: "paused", code: "needs-task-split" };
    }
    if (child.failure.kind === "result-limit") {
      return { kind: "retryable", code: "needs-task-split" };
    }
    const attemptDiagnostic = {
      finalCategory: child.classification.finalCategory,
      submitAttempts: child.classification.attempts,
      schema: child.classification.schema,
      identityMismatch: Object.entries(child.classification.identity)
        .filter(([, matches]) => !matches)
        .map(([dimension]) => dimension),
    };
    return child.failure.kind === "environment" ||
      child.failure.kind === "verification-adapter"
      ? { kind: "paused", code: child.failure.code, attemptDiagnostic }
      : { kind: "retryable", code: child.failure.code, attemptDiagnostic };
  }
  const result = child.result;
  if (result.kind === "context-request") {
    return classifyCandidateContextRequest(result, {
      phase: input.phase,
      contextReadRoots: input.task.roots,
      readPaths: phase.read,
      writePaths: phase.write,
      deletePaths: phase.delete,
      taskPaths: [
        ...new Set(
          Object.values(input.task.phases).flatMap((boundary) => [
            ...boundary.read,
            ...boundary.write,
            ...boundary.delete,
          ]),
        ),
      ],
      redWritePaths: input.task.phases.red.write,
      agents: {
        impact: input.task.agents.impact,
        ...(input.task.agents.target
          ? { target: input.task.agents.target }
          : {}),
      },
    });
  }
  if (result.kind !== "sealed-candidate") {
    return { kind: "retryable", code: "candidate-diff-invalid" };
  }
  return {
    kind: "sealed-candidate",
    candidateId: result.candidateId,
    artifactHash: result.artifactHash,
    bytes: result.bytes,
    paths: [...result.paths],
  };
}
