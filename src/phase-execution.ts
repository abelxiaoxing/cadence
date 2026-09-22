import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import {
  inspectCandidateArtifact,
  sealCandidateArtifact,
} from "./candidate-artifact.ts";
import { revisionChanges, runGitApply } from "./candidate-workspace.ts";
import type { StructuredVerificationContract } from "./contracts.ts";
import type { PlanTaskDraft } from "./delivery-compiler.ts";
import type {
  DurableAffectedResult,
  DurableBaselineResult,
  DurableCandidateCommit,
  DurablePhaseVerificationResult,
  DurableRepairResult,
  DurableResourceInput,
  DurableVerificationBaseline,
  DurableWorkflowEngineOptions,
  PhaseResources,
} from "./durable-contracts.ts";
import { isExecutionRetained } from "./execution-retention.ts";
import { removePathSync } from "./remove-path.ts";
import type {
  BeginCandidateInput,
  TaskLedger,
  VerifiedTaskEvent,
} from "./task-ledger.ts";
import {
  type DependencyContractEntry,
  DependencyManifestError,
  type DurableCandidateProposal,
  decideRecoveryAction,
  deliveryTrackingPath,
  dependencyContract,
  emitWorkflowActivity,
  expectedClassification,
  hash,
  hasUnapprovedDependencyChange,
  hasVerificationLifecycle,
  isRecord,
  LOCKFILES,
  SHA256,
  taskExecutionContract,
  type WorkflowAttemptOutcome,
  type WorkflowRouteFacts,
  type WorkflowWorker,
  workspaceEntryEqual,
} from "./workflow-policy.ts";
import type { WorkspaceRevision, WorkspaceStore } from "./workspace-store.ts";

export interface PhaseExecutionServices {
  prepareResources(
    input: DurableResourceInput,
    signal: AbortSignal,
  ): Promise<PhaseResources>;
  ledger(resources: PhaseResources, deliveryRevision: number): TaskLedger;
  ensureVerificationBaseline(input: {
    resources: PhaseResources;
    ledger: TaskLedger;
    signal: AbortSignal;
    taskId?: string;
  }): Promise<DurableBaselineResult>;
  verifyTaskAffected(input: {
    resources: PhaseResources;
    baseline: DurableVerificationBaseline;
    task: PlanTaskDraft;
    revisionId: string;
    signal: AbortSignal;
  }): Promise<DurableAffectedResult>;
  verifyPhase(
    input: Parameters<DurableWorkflowEngineOptions["verifyPhase"]>[0],
  ): Promise<DurablePhaseVerificationResult>;
}
export class PhaseExecution {
  readonly #services: PhaseExecutionServices;
  readonly #options: Pick<
    DurableWorkflowEngineOptions,
    "verificationPolicy" | "verificationEnvironment" | "proposeCandidate"
  >;
  constructor(
    options: Pick<
      DurableWorkflowEngineOptions,
      "verificationPolicy" | "verificationEnvironment" | "proposeCandidate"
    >,
    services: PhaseExecutionServices,
  ) {
    this.#options = options;
    this.#services = services;
  }
  #recordCorrection(
    ledger: TaskLedger,
    input: {
      runId: string;
      operationId: string;
      taskId: string;
      phase: "red" | "green" | "refactor";
    },
    identity: BeginCandidateInput,
    correction: {
      category: "artifact" | "stale" | "verification" | "checkpoint";
      code: string;
      stage: string;
    },
  ): void {
    ledger.commitVerifiedEvent({
      runId: input.runId,
      taskId: input.taskId,
      eventId: `correction-${hash(
        input.operationId,
        identity.candidateId,
        correction.category,
        correction.code,
        correction.stage,
      ).slice(0, 40)}`,
      kind: "artifact-correction",
      phase: input.phase,
      correctionCategory: correction.category,
      safeFailure: { code: correction.code, stage: correction.stage },
      candidateId: identity.candidateId,
      attemptId: identity.attemptId,
      routeId: identity.routeId,
      routeFingerprint: identity.routeFingerprint,
    });
  }

  completeTracking(
    resources: PhaseResources,
    taskId: string,
  ): WorkspaceRevision {
    const current = resources.workspaces.getRevision(
      resources.currentRevisionId,
    );
    const trackingPath = deliveryTrackingPath(resources.plan);
    if (!trackingPath) return current;
    const entry = current.entries[trackingPath];
    if (!entry || entry.kind === "absent") return current;
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      resources.artifacts.read(entry.hash),
    );
    const escaped = taskId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const taskIdentity = new RegExp(
      `(?:^|[^A-Za-z0-9._:-])${escaped}(?![A-Za-z0-9._:-])`,
      "u",
    );
    let matches = 0;
    let changed = false;
    const updated = text
      .split(/(?<=\n)/u)
      .map((segment) => {
        const line = segment.endsWith("\n") ? segment.slice(0, -1) : segment;
        if (!/^\s*-\s+\[[ xX]\]/u.test(line) || !taskIdentity.test(line)) {
          return segment;
        }
        matches += 1;
        if (/^\s*-\s+\[[xX]\]/u.test(line)) return segment;
        changed = true;
        return segment.replace(/^(\s*-\s+)\[ \]/u, "$1[x]");
      })
      .join("");
    if (matches !== 1) throw new Error("workflow-tracking-task-mismatch");
    if (!changed) return current;
    const next = resources.workspaces.createRevision({
      parentRevisionId: current.revisionId,
      changes: {
        [trackingPath]: {
          kind: "file",
          bytes: new TextEncoder().encode(updated),
          mode: entry.mode,
        },
      },
    });
    resources.currentRevisionId = next.revisionId;
    return next;
  }

  #openTask(
    resources: PhaseResources,
    ledger: TaskLedger,
    input: Parameters<WorkflowWorker["runAttempt"]>[0],
  ): void {
    const revision = resources.workspaces.getRevision(
      resources.baselineRevisionId,
    );
    const contextRefs = [...new Set(input.task.phases.red.read)]
      .sort()
      .flatMap((relative) => {
        const entry = revision.entries[relative];
        return entry?.kind === "file"
          ? [{ kind: "path" as const, path: relative, hash: entry.hash }]
          : [];
      });
    ledger.openTask({
      runId: input.runId,
      deliveryRevision: input.deliveryRevision,
      taskId: input.taskId,
      boundaryHash: hash(
        "durable-task-boundary",
        JSON.stringify(taskExecutionContract(input.task)),
      ),
      objective: input.task.objective,
      contextRefs,
      initialPhase:
        input.task.verificationMode &&
        input.task.verificationMode !== "behavior"
          ? "green"
          : "red",
    });
  }

  #executionWritePaths(resources: PhaseResources): string[] {
    return [
      ...new Set(
        resources.plan.tasks.flatMap((task) =>
          Object.values(task.phases).flatMap((phase) => [
            ...phase.write,
            ...phase.delete,
          ]),
        ),
      ),
    ];
  }

  #policyFactKey(
    resources: PhaseResources,
    event: Record<string, unknown>,
  ): string {
    return `verified-policy-${hash(this.#options.verificationPolicy ?? "legacy", resources.environmentIdentity ?? "legacy", JSON.stringify({ kind: event.kind, phase: event.phase, commandId: event.commandId, artifactHash: event.artifactHash, isolatedRevisionId: event.isolatedRevisionId, exitCode: event.exitCode, actualClassification: event.actualClassification })).slice(0, 40)}`;
  }

  async revalidatePhasePolicy(
    resources: PhaseResources,
    ledger: TaskLedger,
    task: PlanTaskDraft,
    signal: AbortSignal,
  ): Promise<WorkflowAttemptOutcome | undefined> {
    if (
      !this.#options.verificationPolicy &&
      !this.#options.verificationEnvironment
    )
      return undefined;
    const projection = ledger.projection({
      runId: resources.runId,
      taskId: task.taskId,
      nextPhase: "green",
    }) as { history: Array<Record<string, unknown>> };
    for (const event of projection.history.filter(
      (event) =>
        event.kind === "phase-verified" || event.kind === "repair-verified",
    )) {
      const key = this.#policyFactKey(resources, event);
      if (ledger.durableFact(key) !== undefined) continue;
      const phase = event.phase as "red" | "green" | "refactor";
      const boundary = task.phases[phase];
      const repair = event.kind === "repair-verified";
      const verification = repair
        ? task.repairVerification
        : boundary?.verification;
      const expected = repair
        ? "expected-green"
        : expectedClassification(phase);
      if (
        !boundary ||
        !verification ||
        typeof event.isolatedRevisionId !== "string"
      )
        throw new Error("workflow-ledger-phase-invalid");
      const root = mkdtempSync(
        path.join(resources.root, "policy-verification-"),
      );
      try {
        await resources.workspaces.materializeAsync(
          event.isolatedRevisionId,
          root,
          signal,
        );
        const result = await this.#services.verifyPhase({
          executionWritePaths: this.#executionWritePaths(resources),
          runId: resources.runId,
          deliveryRevision: resources.deliveryRevision,
          taskId: task.taskId,
          phase,
          root,
          verification,
          signal,
        });
        if (!result.ok)
          return {
            kind: "paused",
            code:
              result.kind === "paused"
                ? result.code
                : "verification-policy-rejected",
          };
        if (
          result.classification !== expected ||
          (expected === "expected-red"
            ? result.exitCode === 0
            : result.exitCode !== 0)
        )
          return { kind: "paused", code: "verification-policy-rejected" };
        ledger.putDurableFact(key, {
          policy: this.#options.verificationPolicy ?? "legacy",
        });
      } finally {
        if (!isExecutionRetained(root))
          removePathSync(root, { recursive: true, force: true });
      }
    }
    return undefined;
  }

  #pendingCandidate(
    ledger: TaskLedger,
    key: string,
    baseRevisionId: string,
  ):
    | {
        identity: BeginCandidateInput;
        proposal: Extract<
          DurableCandidateProposal,
          { kind: "sealed-candidate" }
        >;
      }
    | undefined {
    const value = ledger.durableFact(key);
    if (
      !isRecord(value) ||
      !isRecord(value.identity) ||
      !isRecord(value.proposal) ||
      value.identity.isolatedRevisionId !== baseRevisionId
    )
      return undefined;
    return value as unknown as {
      identity: BeginCandidateInput;
      proposal: Extract<DurableCandidateProposal, { kind: "sealed-candidate" }>;
    };
  }

  #savePendingCandidate(ledger: TaskLedger, key: string, value: unknown): void {
    const previous = ledger.durableFact(key);
    if (previous === undefined) ledger.putDurableFact(key, value);
    else ledger.replaceDurableFact(key, previous, value);
  }

  #replayedPhase(
    resources: PhaseResources,
    ledger: TaskLedger,
    input: Parameters<WorkflowWorker["runAttempt"]>[0],
  ): WorkflowAttemptOutcome | undefined {
    if (input.artifactCorrection?.code === "red-artifact-constraint") {
      return undefined;
    }
    const projection = ledger.projection({
      runId: input.runId,
      taskId: input.taskId,
      nextPhase: input.phase,
    }) as {
      history: Array<Record<string, unknown>>;
    };
    const event = projection.history.find(
      (candidate) =>
        candidate.kind === "phase-verified" && candidate.phase === input.phase,
    );
    if (!event) return undefined;
    if (
      typeof event.artifactHash !== "string" ||
      !SHA256.test(event.artifactHash) ||
      typeof event.isolatedRevisionId !== "string" ||
      !SHA256.test(event.isolatedRevisionId) ||
      typeof event.exitCode !== "number" ||
      event.actualClassification !== expectedClassification(input.phase)
    ) {
      throw new Error("workflow-ledger-phase-invalid");
    }
    let isolatedRevisionId = event.isolatedRevisionId;
    const finalPhase = input.task.phases.refactor ? "refactor" : "green";
    if (hasVerificationLifecycle(input.plan) && input.phase === finalPhase) {
      const fact = ledger.durableFact(
        `task-final-${hash(input.taskId).slice(0, 40)}`,
      );
      if (
        !isRecord(fact) ||
        fact.taskId !== input.taskId ||
        fact.phase !== input.phase ||
        typeof fact.isolatedRevisionId !== "string" ||
        !SHA256.test(fact.isolatedRevisionId)
      ) {
        throw new Error("workflow-task-completion-fact-invalid");
      }
      isolatedRevisionId = fact.isolatedRevisionId;
    }
    resources.workspaces.getRevision(isolatedRevisionId);
    if (
      this.#revisionDescendsFrom(
        resources,
        resources.currentRevisionId,
        isolatedRevisionId,
      )
    ) {
      isolatedRevisionId = resources.currentRevisionId;
    } else if (
      !this.#revisionDescendsFrom(
        resources,
        isolatedRevisionId,
        resources.currentRevisionId,
      )
    ) {
      throw new Error("workspace-revision-stale");
    }
    resources.currentRevisionId = isolatedRevisionId;
    return {
      kind: "phase-committed",
      artifactHash: event.artifactHash,
      isolatedRevisionId,
      exitCode: event.exitCode,
      classification: expectedClassification(input.phase),
      baselineRevisionId: resources.baselineRevisionId,
    };
  }

  async #mergeCandidate(
    resources: PhaseResources,
    input: Parameters<WorkflowWorker["runAttempt"]>[0],
    baseRevisionId: string,
    candidateRevisionId: string,
    boundPaths?: string[],
  ) {
    let release!: () => void;
    const prior = resources.mergeTail;
    resources.mergeTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prior;
    try {
      const phase = input.task.phases[input.phase];
      if (!phase) throw new Error("workflow-task-phase-invalid");
      const merged = resources.workspaces.mergeRevision({
        baseRevisionId,
        currentRevisionId: resources.currentRevisionId,
        candidateRevisionId,
        boundPaths: [
          ...new Set([
            ...(boundPaths ?? [...phase.read, ...phase.write, ...phase.delete]),
            ...(input.contextReadPaths ?? []),
          ]),
        ],
      });
      resources.currentRevisionId = merged.revisionId;
      return merged;
    } finally {
      release();
    }
  }

  async #rollbackWorkspacePaths(input: {
    resources: PhaseResources;
    baseRevisionId: string;
    rejectedRevisionId: string;
    paths: readonly string[];
  }): Promise<void> {
    const { resources } = input;
    let release!: () => void;
    const prior = resources.mergeTail;
    resources.mergeTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prior;
    try {
      const base = resources.workspaces.getRevision(input.baseRevisionId);
      const rejected = resources.workspaces.getRevision(
        input.rejectedRevisionId,
      );
      const current = resources.workspaces.getRevision(
        resources.currentRevisionId,
      );
      const changes: Record<
        string,
        { kind: "absent" } | { kind: "file"; bytes: Uint8Array; mode: number }
      > = {};
      for (const relative of [...new Set(input.paths)].sort()) {
        const before = base.entries[relative];
        const rejectedEntry = rejected.entries[relative];
        if (workspaceEntryEqual(before, rejectedEntry)) continue;
        const latest = current.entries[relative];
        if (workspaceEntryEqual(latest, before)) continue;
        if (!workspaceEntryEqual(latest, rejectedEntry)) {
          throw new Error("workspace-revision-stale");
        }
        changes[relative] =
          before?.kind === "file"
            ? {
                kind: "file",
                bytes: resources.artifacts.read(before.hash),
                mode: before.mode,
              }
            : { kind: "absent" };
      }
      if (Object.keys(changes).length === 0) return;
      const rolledBack = resources.workspaces.createRevision({
        parentRevisionId: current.revisionId,
        changes,
      });
      resources.currentRevisionId = rolledBack.revisionId;
    } finally {
      release();
    }
  }

  async #runRepairCandidate(input: {
    resources: PhaseResources;
    ledger: TaskLedger;
    attempt: Parameters<WorkflowWorker["runAttempt"]>[0];
    repairAttempt: number;
    failureIdentities: string[];
  }): Promise<DurableRepairResult> {
    const { resources, ledger } = input;
    const request = input.attempt;
    if (request.signal.aborted) {
      return { kind: "operation-cancelled", code: "cancelled" };
    }
    const phase = request.task.phases[request.phase];
    if (!phase) throw new Error("workflow-task-phase-invalid");
    const allPhases = Object.values(request.task.phases);
    const approvedWritePaths = [
      ...new Set(allPhases.flatMap((boundary) => boundary.write)),
    ].sort();
    const approvedDeletePaths = [
      ...new Set(allPhases.flatMap((boundary) => boundary.delete)),
    ].sort();
    const approvedPaths = [
      ...new Set([...approvedWritePaths, ...approvedDeletePaths]),
    ].sort();
    const boundPaths = [
      ...new Set(
        allPhases.flatMap((boundary) => [
          ...boundary.read,
          ...boundary.write,
          ...boundary.delete,
        ]),
      ),
    ].sort();
    if (approvedPaths.length === 0) {
      return { kind: "approval-needed", code: "task-write-set-empty" };
    }
    const baseRevisionId = resources.currentRevisionId;
    const pendingKey = `pending-${hash(request.taskId, request.phase, request.task.repairVerification.id).slice(0, 40)}`;
    const pending = this.#pendingCandidate(ledger, pendingKey, baseRevisionId);
    const proposalRoot = mkdtempSync(path.join(resources.root, "repair-"));
    try {
      await resources.workspaces.materializeAsync(
        baseRevisionId,
        proposalRoot,
        request.signal,
      );
      const ledgerProjection = ledger.projection({
        runId: request.runId,
        taskId: request.taskId,
        nextPhase: request.phase,
      });
      const repair = {
        attempt: input.repairAttempt,
        attribution: "introduced" as const,
        failureIdentities: [...input.failureIdentities],
      };
      const launch = async () => {
        const identity: BeginCandidateInput = {
          candidateId: `candidate-${randomUUID()}`,
          runId: request.runId,
          deliveryRevision: request.deliveryRevision,
          taskId: request.taskId,
          phase: request.phase,
          attemptId: `repair-${hash(
            request.operationId,
            request.taskId,
            String(input.repairAttempt),
            hash("pi-process"),
          ).slice(0, 40)}`,
          approvedPaths,
          isolatedRevisionId: baseRevisionId,
          verificationId: request.task.repairVerification.id,
          routeId: "pi-process",
          routeFingerprint: hash("pi-process"),
        };
        if (request.reserveCandidate && !request.reserveCandidate())
          return {
            identity,
            proposal: {
              kind: "paused" as const,
              code:
                request.additionalAttempt || request.verificationOnly
                  ? "repair-attempts-exhausted"
                  : "change-work-budget-exhausted",
            },
          };
        const proposal = await this.#options.proposeCandidate({
          runId: request.runId,
          operationId: request.operationId,
          deliveryRevision: request.deliveryRevision,
          taskId: request.taskId,
          phase: request.phase,
          task: structuredClone(request.task),
          contextReadPaths: request.contextReadPaths,
          workspaceRoot: proposalRoot,
          ledgerProjection,
          candidateArtifact: {
            ledger,
            identity,
            workspaceRoot: proposalRoot,
            writePaths: approvedWritePaths,
            deletePaths: approvedDeletePaths,
          },
          repair,
          ...(request.artifactCorrection
            ? { artifactCorrection: request.artifactCorrection }
            : {}),
          ...(request.contextRequest
            ? { contextRequest: request.contextRequest }
            : {}),
          ...(request.recoveryFeedback
            ? { recoveryFeedback: request.recoveryFeedback }
            : {}),
          signal: request.signal,
          onRequestStart: () =>
            emitWorkflowActivity(request.onActivity, {
              state: "waiting-first-response",
            }),
          onHeaders: () =>
            emitWorkflowActivity(request.onActivity, { state: "running" }),
          onProgress: () =>
            emitWorkflowActivity(request.onActivity, { state: "running" }),
        });
        return { identity, proposal };
      };
      const { identity, proposal } = pending ?? (await launch());
      const correctionIdentity = identity;
      const withRoute = <T extends object>(outcome: T) => ({
        ...outcome,
        routeId: correctionIdentity.routeId,
        routeFingerprint: correctionIdentity.routeFingerprint,
      });
      let uncommittedRevisionId: string | undefined;
      const reject = async <T extends object>(
        outcome: T,
        correction: {
          category: "artifact" | "stale" | "verification" | "checkpoint";
          code: string;
          stage: string;
        },
        rollback = false,
      ): Promise<T> => {
        if (rollback && uncommittedRevisionId) {
          await this.#rollbackWorkspacePaths({
            resources,
            baseRevisionId,
            rejectedRevisionId: uncommittedRevisionId,
            paths: approvedPaths,
          });
        }
        this.#recordCorrection(ledger, request, correctionIdentity, correction);
        return withRoute({ ...outcome, retryPolicy: correction.category });
      };
      if (
        proposal.kind !== "candidate" &&
        proposal.kind !== "sealed-candidate"
      ) {
        return proposal.kind === "operation-cancelled" ||
          proposal.kind === "paused" ||
          proposal.kind === "approval-needed"
          ? withRoute(proposal)
          : reject(proposal, {
              category: "artifact",
              code: proposal.code,
              stage: "candidate-submit",
            });
      }
      emitWorkflowActivity(request.onActivity, { state: "validating" });
      const inspected = inspectCandidateArtifact({
        ledger,
        identity,
        proposal,
        approvedPaths,
      });
      if (!inspected.ok) {
        const code =
          inspected.code === "write-set-mismatch"
            ? "repair-boundary-expansion"
            : inspected.code;
        return reject(
          {
            kind:
              inspected.code === "write-set-mismatch"
                ? "approval-needed"
                : "retryable",
            code,
          },
          { category: "artifact", code, stage: inspected.stage },
        );
      }
      const { bytes, paths: candidatePaths } = inspected;
      const dependencySensitive = candidatePaths.some(
        (relative) => relative === "package.json" || LOCKFILES.has(relative),
      );
      let dependenciesBefore: Map<string, DependencyContractEntry> | undefined;
      if (dependencySensitive) {
        try {
          dependenciesBefore = dependencyContract(proposalRoot);
        } catch (error) {
          if (!(error instanceof DependencyManifestError)) throw error;
          return reject(
            { kind: "retryable", code: error.message },
            {
              category: "artifact",
              code: error.message,
              stage: "candidate-dependency",
            },
          );
        }
      }

      const checked = await runGitApply(
        proposalRoot,
        bytes,
        true,
        request.signal,
      );
      if (checked !== "ok") {
        return checked === "cancelled"
          ? withRoute({ kind: "operation-cancelled", code: "cancelled" })
          : reject(
              { kind: "retryable", code: "candidate-diff-invalid" },
              {
                category: "artifact",
                code: "candidate-diff-invalid",
                stage: "candidate-check",
              },
            );
      }
      const applied = await runGitApply(
        proposalRoot,
        bytes,
        false,
        request.signal,
      );
      if (applied !== "ok") {
        return applied === "cancelled"
          ? withRoute({ kind: "operation-cancelled", code: "cancelled" })
          : reject(
              { kind: "retryable", code: "candidate-diff-invalid" },
              {
                category: "artifact",
                code: "candidate-diff-invalid",
                stage: "candidate-apply",
              },
            );
      }
      if (dependenciesBefore) {
        let dependenciesAfter: Map<string, DependencyContractEntry>;
        try {
          dependenciesAfter = dependencyContract(proposalRoot);
        } catch (error) {
          if (!(error instanceof DependencyManifestError)) throw error;
          return reject(
            { kind: "retryable", code: error.message },
            {
              category: "artifact",
              code: error.message,
              stage: "candidate-dependency",
            },
          );
        }
        if (
          hasUnapprovedDependencyChange(
            dependenciesBefore,
            dependenciesAfter,
            request.task.approvedDependencies,
            candidatePaths.some((relative) => LOCKFILES.has(relative)),
          )
        ) {
          return reject(
            { kind: "approval-needed", code: "unapproved-dependency-change" },
            {
              category: "artifact",
              code: "unapproved-dependency-change",
              stage: "candidate-dependency",
            },
          );
        }
      }

      const sealed = sealCandidateArtifact({
        ledger,
        identity,
        proposal,
        bytes,
      });
      if (!sealed.ok) {
        return reject(
          { kind: sealed.kind, code: sealed.code },
          { category: "artifact", code: sealed.code, stage: sealed.stage },
        );
      }
      const { artifactHash } = sealed;
      const candidate = resources.workspaces.createRevision({
        parentRevisionId: baseRevisionId,
        changes: revisionChanges(proposalRoot, approvedPaths),
      });
      const requiredOutputs = request.plan.outputs.filter(
        (output) =>
          output.producer.taskId === request.taskId &&
          (!request.artifactCorrection || output.producer.phase !== "refactor"),
      );
      if (
        requiredOutputs.some(
          (output) => candidate.entries[output.path]?.kind !== "file",
        )
      ) {
        return reject(
          { kind: "retryable", code: "producer-output-unavailable" },
          {
            category: "artifact",
            code: "producer-output-unavailable",
            stage: "candidate-output",
          },
        );
      }
      emitWorkflowActivity(request.onActivity, { state: "verifying" });
      this.#savePendingCandidate(ledger, pendingKey, {
        identity,
        proposal: {
          kind: "sealed-candidate",
          candidateId: identity.candidateId,
          artifactHash,
          bytes: bytes.length,
          paths: candidatePaths,
        },
      });
      const verified = await this.#services.verifyPhase({
        executionWritePaths: this.#executionWritePaths(resources),
        runId: request.runId,
        deliveryRevision: request.deliveryRevision,
        taskId: request.taskId,
        phase: request.phase,
        root: proposalRoot,
        verification: structuredClone(request.task.repairVerification),
        signal: request.signal,
      });
      if (!verified.ok) {
        if (verified.kind === "paused") return verified;
        this.#savePendingCandidate(ledger, pendingKey, null);
        return reject(verified, {
          category: "verification",
          code: verified.code,
          stage: "phase-verification",
        });
      }
      if (
        verified.classification !== "expected-green" ||
        verified.exitCode !== 0
      ) {
        return reject(
          { kind: "retryable", code: "verification-rejected" },
          {
            category: "verification",
            code: "verification-rejected",
            stage: "phase-verification",
          },
        );
      }
      let merged: ReturnType<WorkspaceStore["mergeRevision"]>;
      try {
        merged = await this.#mergeCandidate(
          resources,
          request,
          baseRevisionId,
          candidate.revisionId,
          boundPaths,
        );
        uncommittedRevisionId = merged.revisionId;
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "workspace-revision-stale"
        ) {
          return reject(
            { kind: "retryable", code: "workspace-revision-stale" },
            {
              category: "stale",
              code: "workspace-revision-stale",
              stage: "candidate-merge",
            },
          );
        }
        throw error;
      }
      if (
        requiredOutputs.some(
          (output) => merged.entries[output.path]?.kind !== "file",
        )
      ) {
        return reject(
          { kind: "retryable", code: "producer-output-unavailable" },
          {
            category: "artifact",
            code: "producer-output-unavailable",
            stage: "candidate-output",
          },
          true,
        );
      }
      const outputFacts = approvedPaths.map((relative) => {
        const entry = merged.entries[relative];
        return entry?.kind === "file"
          ? {
              path: relative,
              kind: "file" as const,
              hash: entry.hash,
              bytes: entry.bytes,
            }
          : { path: relative, kind: "absent" as const };
      });
      return {
        kind: "repair-committed",
        commit: {
          artifactHash,
          isolatedRevisionId: merged.revisionId,
          exitCode: verified.exitCode,
          classification: verified.classification,
          diagnostic: verified.diagnostic,
          outputFacts,
          routeId: identity.routeId,
          routeFingerprint: identity.routeFingerprint,
        },
      };
    } finally {
      if (!isExecutionRetained(proposalRoot))
        removePathSync(proposalRoot, { recursive: true, force: true });
    }
  }

  #revisionDescendsFrom(
    resources: PhaseResources,
    descendantRevisionId: string,
    ancestorRevisionId: string,
  ): boolean {
    let current = resources.workspaces.getRevision(descendantRevisionId);
    const visited = new Set<string>();
    for (;;) {
      if (current.revisionId === ancestorRevisionId) return true;
      if (
        current.parentRevisionId === null ||
        visited.has(current.revisionId)
      ) {
        return false;
      }
      visited.add(current.revisionId);
      current = resources.workspaces.getRevision(current.parentRevisionId);
    }
  }

  #verifiedPhaseReplay(
    ledger: TaskLedger,
    input: Parameters<WorkflowWorker["runAttempt"]>[0],
  ): { artifactHash: string; exitCode: number; isolatedRevisionId: string } {
    const projection = ledger.projection({
      runId: input.runId,
      taskId: input.taskId,
      nextPhase: input.phase,
    }) as { history: Array<Record<string, unknown>> };
    const event = projection.history.find(
      (candidate) =>
        candidate.kind === "phase-verified" && candidate.phase === input.phase,
    );
    if (
      !event ||
      typeof event.artifactHash !== "string" ||
      !SHA256.test(event.artifactHash) ||
      typeof event.isolatedRevisionId !== "string" ||
      !SHA256.test(event.isolatedRevisionId) ||
      typeof event.exitCode !== "number" ||
      event.actualClassification !== expectedClassification(input.phase)
    ) {
      throw new Error("workflow-ledger-phase-invalid");
    }
    return {
      artifactHash: event.artifactHash,
      exitCode: event.exitCode,
      isolatedRevisionId: event.isolatedRevisionId,
    };
  }

  async #runRedArtifactCorrection(input: {
    resources: PhaseResources;
    ledger: TaskLedger;
    baseline?: DurableVerificationBaseline;
    attempt: Parameters<WorkflowWorker["runAttempt"]>[0];
  }): Promise<WorkflowAttemptOutcome> {
    const { resources, ledger } = input;
    const request = input.attempt;
    if (
      request.phase !== "green" ||
      request.artifactCorrection?.code !== "red-artifact-constraint"
    ) {
      throw new Error("workflow-red-artifact-correction-invalid");
    }
    const priorRed = this.#verifiedPhaseReplay(ledger, {
      ...request,
      phase: "red",
    });
    if (!hasVerificationLifecycle(request.plan)) {
      return { kind: "paused", code: "red-artifact-constraint" };
    }
    const stableRevisionId = resources.currentRevisionId;
    const correctionPaths = [
      ...new Set(
        Object.values(request.task.phases).flatMap((phase) => [
          ...phase.write,
          ...phase.delete,
        ]),
      ),
    ];
    const rejectCorrection = async <T extends WorkflowAttemptOutcome>(
      outcome: T,
    ): Promise<T> => {
      if (resources.currentRevisionId !== stableRevisionId) {
        await this.#rollbackWorkspacePaths({
          resources,
          baseRevisionId: stableRevisionId,
          rejectedRevisionId: resources.currentRevisionId,
          paths: correctionPaths,
        });
      }
      return outcome;
    };
    const failureIdentities = [
      hash(
        "red-artifact-constraint",
        request.taskId,
        request.task.phases.red.verification.id,
      ),
    ];
    const correctionAttemptUsed = request.artifactCorrection.attempt;
    const correctionAction = {
      kind: "red-correction" as const,
      attempt:
        request.additionalAttempt || request.verificationOnly
          ? 1
          : correctionAttemptUsed,
    };
    const correctionDecision =
      request.recoveryDecision?.(correctionAction) ??
      decideRecoveryAction(request.plan, correctionAction, request);
    if (!correctionDecision.allowed)
      return { kind: "paused", code: correctionDecision.code };
    const repaired = await this.#runRepairCandidate({
      resources,
      ledger,
      attempt: request,
      repairAttempt: correctionAttemptUsed,
      failureIdentities,
    });
    if (repaired.kind !== "repair-committed") {
      return rejectCorrection(repaired);
    }

    const correctedRevision = resources.workspaces.getRevision(
      repaired.commit.isolatedRevisionId,
    );
    const acceptedRedRevision = resources.workspaces.getRevision(
      priorRed.isolatedRevisionId,
    );
    if (!acceptedRedRevision.parentRevisionId) {
      throw new Error("workflow-ledger-revision-base-invalid");
    }
    const correctedRedChanges: Record<
      string,
      { kind: "absent" } | { kind: "file"; bytes: Uint8Array; mode: number }
    > = {};
    for (const relative of [
      ...new Set([
        ...request.task.phases.red.write,
        ...request.task.phases.red.delete,
      ]),
    ]) {
      const entry = correctedRevision.entries[relative];
      correctedRedChanges[relative] =
        entry?.kind === "file"
          ? {
              kind: "file",
              bytes: resources.artifacts.read(entry.hash),
              mode: entry.mode,
            }
          : { kind: "absent" };
    }
    const correctedRedRevision = resources.workspaces.createRevision({
      parentRevisionId: acceptedRedRevision.parentRevisionId,
      changes: correctedRedChanges,
    });
    const verifyCorrectedContract = async (input: {
      phase: "red" | "green";
      revisionId: string;
      verification: StructuredVerificationContract;
    }): Promise<DurablePhaseVerificationResult> => {
      const root = mkdtempSync(path.join(resources.root, "correction-check-"));
      try {
        await resources.workspaces.materializeAsync(
          input.revisionId,
          root,
          request.signal,
        );
        return await this.#services.verifyPhase({
          executionWritePaths: this.#executionWritePaths(resources),
          runId: request.runId,
          deliveryRevision: request.deliveryRevision,
          taskId: request.taskId,
          phase: input.phase,
          root,
          verification: structuredClone(input.verification),
          signal: request.signal,
        });
      } finally {
        if (!isExecutionRetained(root))
          removePathSync(root, { recursive: true, force: true });
      }
    };
    emitWorkflowActivity(request.onActivity, { state: "verifying" });
    const redVerification = await verifyCorrectedContract({
      phase: "red",
      revisionId: correctedRedRevision.revisionId,
      verification: request.task.phases.red.verification,
    });
    if (!redVerification.ok) {
      return rejectCorrection({
        ...redVerification,
        ...(redVerification.kind === "retryable"
          ? { retryPolicy: "verification" as const }
          : {}),
      });
    }
    if (
      redVerification.classification !== "expected-red" ||
      redVerification.exitCode === 0
    ) {
      return rejectCorrection({
        kind: "retryable",
        code: "verification-rejected",
        retryPolicy: "verification",
      });
    }
    const greenVerification = await verifyCorrectedContract({
      phase: "green",
      revisionId: repaired.commit.isolatedRevisionId,
      verification: request.task.phases.green.verification,
    });
    if (!greenVerification.ok) {
      return rejectCorrection({
        ...greenVerification,
        ...(greenVerification.kind === "retryable"
          ? { retryPolicy: "verification" as const }
          : {}),
      });
    }
    if (
      greenVerification.classification !== "expected-green" ||
      greenVerification.exitCode !== 0
    ) {
      return rejectCorrection({
        kind: "retryable",
        code: "verification-rejected",
        retryPolicy: "verification",
      });
    }

    const repairEvent: VerifiedTaskEvent = {
      runId: request.runId,
      taskId: request.taskId,
      eventId: `red-artifact-correction-${hash(
        request.operationId,
        request.taskId,
        repaired.commit.artifactHash,
      ).slice(0, 40)}`,
      kind: "repair-verified",
      phase: request.phase,
      attempt: correctionAttemptUsed,
      commandId: request.task.repairVerification.id,
      exitCode: 0,
      diagnostic: repaired.commit.diagnostic,
      artifactHash: repaired.commit.artifactHash,
      isolatedRevisionId: repaired.commit.isolatedRevisionId,
      outputFacts: repaired.commit.outputFacts,
      attribution: "introduced",
      failureIdentities: [
        hash(
          "red-artifact-constraint",
          request.taskId,
          request.task.phases.red.verification.id,
        ),
      ],
      routeId: repaired.commit.routeId,
      routeFingerprint: repaired.commit.routeFingerprint,
    };
    const greenPaths = new Set([
      ...request.task.phases.green.write,
      ...request.task.phases.green.delete,
    ]);
    const greenEvent: VerifiedTaskEvent = {
      runId: request.runId,
      taskId: request.taskId,
      eventId: `green-corrected-${hash(
        request.operationId,
        request.taskId,
        repaired.commit.artifactHash,
      ).slice(0, 40)}`,
      kind: "phase-verified",
      phase: "green",
      commandId: request.task.phases.green.verification.id,
      exitCode: greenVerification.exitCode,
      expectedClassification: "expected-green",
      actualClassification: greenVerification.classification,
      diagnostic: greenVerification.diagnostic,
      artifactHash: repaired.commit.artifactHash,
      isolatedRevisionId: repaired.commit.isolatedRevisionId,
      outputFacts: repaired.commit.outputFacts.filter((fact) =>
        greenPaths.has(fact.path),
      ),
      routeId: repaired.commit.routeId,
      routeFingerprint: repaired.commit.routeFingerprint,
    };
    const events: VerifiedTaskEvent[] = [repairEvent, greenEvent];
    if (input.baseline) {
      const affected = await this.#services.verifyTaskAffected({
        resources,
        baseline: input.baseline,
        task: request.task,
        revisionId: repaired.commit.isolatedRevisionId,
        signal: request.signal,
      });
      if (affected.kind === "repairable") {
        return rejectCorrection({
          kind: "retryable",
          code: "red-artifact-constraint",
          retryPolicy: "artifact",
        });
      }
      if (affected.kind !== "verified") return rejectCorrection(affected);
    }
    if (request.task.phases.refactor) {
      ledger.commitVerifiedEvents(events);
      return {
        kind: "phase-committed",
        artifactHash: repaired.commit.artifactHash,
        isolatedRevisionId: repaired.commit.isolatedRevisionId,
        exitCode: greenVerification.exitCode,
        classification: greenVerification.classification,
        routeId: repaired.commit.routeId,
        routeFingerprint: repaired.commit.routeFingerprint,
      };
    }
    const completedRevision = this.completeTracking(resources, request.taskId);
    ledger.commitTaskCompletion({
      events,
      factKey: `task-final-${hash(request.taskId).slice(0, 40)}`,
      fact: {
        taskId: request.taskId,
        phase: request.phase,
        isolatedRevisionId: completedRevision.revisionId,
        attribution: "introduced",
        repairAttempts: correctionAttemptUsed,
      },
    });
    return {
      kind: "phase-committed",
      artifactHash: repaired.commit.artifactHash,
      isolatedRevisionId: completedRevision.revisionId,
      exitCode: greenVerification.exitCode,
      classification: greenVerification.classification,
      routeId: repaired.commit.routeId,
      routeFingerprint: repaired.commit.routeFingerprint,
    };
  }

  async #runCumulativeRepair(input: {
    resources: PhaseResources;
    ledger: TaskLedger;
    baseline: DurableVerificationBaseline;
    attempt: Parameters<WorkflowWorker["runAttempt"]>[0];
  }): Promise<WorkflowAttemptOutcome> {
    const { resources, ledger } = input;
    const request = input.attempt;
    const finalPhase = request.task.phases.refactor ? "refactor" : "green";
    const requestedFailures = request.repair?.failureIdentities;
    if (
      request.phase !== finalPhase ||
      request.repair?.attribution !== "introduced" ||
      !Array.isArray(requestedFailures) ||
      requestedFailures.length === 0 ||
      requestedFailures.length > 256 ||
      requestedFailures.some(
        (identity) => typeof identity !== "string" || !SHA256.test(identity),
      )
    ) {
      throw new Error("workflow-repair-context-invalid");
    }
    this.#verifiedPhaseReplay(ledger, request);
    const projection = ledger.projection({
      runId: request.runId,
      taskId: request.taskId,
      nextPhase: request.phase,
    }) as { history: Array<Record<string, unknown>> };
    const priorRepairs = projection.history.filter(
      (event) =>
        event.kind === "repair-verified" && event.phase === request.phase,
    );
    let stableRevisionId = resources.currentRevisionId;
    let affected: DurableAffectedResult = {
      kind: "repairable",
      attribution: "introduced",
      failureIdentities: [...new Set(requestedFailures)].sort(),
    };
    const replayedRepair = priorRepairs.at(-1);
    if (replayedRepair) {
      if (
        typeof replayedRepair.artifactHash !== "string" ||
        !SHA256.test(replayedRepair.artifactHash) ||
        typeof replayedRepair.isolatedRevisionId !== "string" ||
        !SHA256.test(replayedRepair.isolatedRevisionId)
      ) {
        throw new Error("workflow-ledger-phase-invalid");
      }
      if (
        this.#revisionDescendsFrom(
          resources,
          replayedRepair.isolatedRevisionId,
          stableRevisionId,
        )
      ) {
        resources.currentRevisionId = replayedRepair.isolatedRevisionId;
        stableRevisionId = replayedRepair.isolatedRevisionId;
        const replayedAffected = await this.#services.verifyTaskAffected({
          resources,
          baseline: input.baseline,
          task: request.task,
          revisionId: stableRevisionId,
          signal: request.signal,
        });
        if (replayedAffected.kind === "verified") {
          return {
            kind: "phase-committed",
            artifactHash: replayedRepair.artifactHash,
            isolatedRevisionId: stableRevisionId,
            exitCode: 0,
            classification: expectedClassification(request.phase),
          };
        }
        if (replayedAffected.kind !== "repairable") return replayedAffected;
        affected = replayedAffected;
      }
    }

    const repairEvents: VerifiedTaskEvent[] = [];
    let lastCommit: DurableCandidateCommit | undefined;
    let repairAttempt = 0;
    let uncommittedRevisionId: string | undefined;
    const rollbackPaths = [
      ...new Set(
        Object.values(request.task.phases).flatMap((phase) => [
          ...phase.write,
          ...phase.delete,
        ]),
      ),
    ];
    const discardUncommitted = async <T extends WorkflowAttemptOutcome>(
      outcome: T,
    ): Promise<T> => {
      if (uncommittedRevisionId) {
        await this.#rollbackWorkspacePaths({
          resources,
          baseRevisionId: stableRevisionId,
          rejectedRevisionId: uncommittedRevisionId,
          paths: rollbackPaths,
        });
      }
      return outcome;
    };
    while (affected.kind === "repairable") {
      if (
        !(
          request.recoveryDecision?.({
            kind: "cumulative-repair",
            attempt: repairAttempt + 1,
          }) ??
          decideRecoveryAction(
            request.plan,
            { kind: "cumulative-repair", attempt: repairAttempt + 1 },
            request,
          )
        ).allowed
      ) {
        return discardUncommitted({
          kind: "paused",
          code: "repair-attempts-exhausted",
        });
      }
      repairAttempt += 1;
      const failureIdentities = [...affected.failureIdentities];
      const repair = await this.#runRepairCandidate({
        resources,
        ledger,
        attempt: request,
        repairAttempt,
        failureIdentities,
      });
      if (repair.kind !== "repair-committed") {
        return discardUncommitted(repair);
      }
      lastCommit = repair.commit;
      uncommittedRevisionId = repair.commit.isolatedRevisionId;
      repairEvents.push({
        runId: request.runId,
        taskId: request.taskId,
        eventId: `cumulative-repair-${hash(
          stableRevisionId,
          request.taskId,
          String(repairAttempt),
        ).slice(0, 40)}`,
        kind: "repair-verified",
        phase: request.phase,
        attempt: repairAttempt,
        commandId: request.task.repairVerification.id,
        exitCode: 0,
        diagnostic: repair.commit.diagnostic,
        artifactHash: repair.commit.artifactHash,
        isolatedRevisionId: repair.commit.isolatedRevisionId,
        outputFacts: repair.commit.outputFacts,
        attribution: "introduced",
        failureIdentities,
        routeId: repair.commit.routeId,
        routeFingerprint: repair.commit.routeFingerprint,
      });
      affected = await this.#services.verifyTaskAffected({
        resources,
        baseline: input.baseline,
        task: request.task,
        revisionId: repair.commit.isolatedRevisionId,
        signal: request.signal,
      });
    }
    if (affected.kind !== "verified") return discardUncommitted(affected);
    if (!lastCommit || repairEvents.length === 0) {
      throw new Error("workflow-repair-commit-unavailable");
    }
    ledger.commitVerifiedEvents(repairEvents);
    return {
      kind: "phase-committed",
      artifactHash: lastCommit.artifactHash,
      isolatedRevisionId: lastCommit.isolatedRevisionId,
      exitCode: 0,
      classification: expectedClassification(request.phase),
      routeId: lastCommit.routeId,
      routeFingerprint: lastCommit.routeFingerprint,
    };
  }

  async hasPendingVerification(
    input: Parameters<WorkflowWorker["runAttempt"]>[0],
  ): Promise<boolean> {
    if (!input.baselineRevisionId || !input.currentWorkspaceRevisionId)
      return false;
    const resources = await this.#services.prepareResources(
      input,
      input.signal,
    );
    const ledger = this.#services.ledger(resources, input.deliveryRevision);
    const verificationIds = [
      input.task.phases[input.phase]?.verification.id,
      input.task.repairVerification?.id,
    ];
    return verificationIds.some(
      (id) =>
        id &&
        this.#pendingCandidate(
          ledger,
          `pending-${hash(input.taskId, input.phase, id).slice(0, 40)}`,
          resources.currentRevisionId,
        ) !== undefined,
    );
  }

  async runAttempt(
    input: Parameters<WorkflowWorker["runAttempt"]>[0],
  ): Promise<WorkflowAttemptOutcome> {
    if (input.signal.aborted) {
      return { kind: "operation-cancelled", code: "cancelled" };
    }
    const resources = await this.#services.prepareResources(
      {
        runId: input.runId,
        deliveryRevision: input.deliveryRevision,
        plan: input.plan,
        ...(input.baselineRevisionId
          ? { baselineRevisionId: input.baselineRevisionId }
          : {}),
        ...(input.currentWorkspaceRevisionId
          ? { currentWorkspaceRevisionId: input.currentWorkspaceRevisionId }
          : {}),
      },
      input.signal,
    );
    let selectedRoute: Required<WorkflowRouteFacts> | undefined;
    const retained = <T extends WorkflowAttemptOutcome>(outcome: T): T =>
      ({
        ...(selectedRoute ?? {}),
        ...outcome,
        baselineRevisionId: resources.baselineRevisionId,
        currentWorkspaceRevisionId: resources.currentRevisionId,
      }) as T;
    const ledger = this.#services.ledger(resources, input.deliveryRevision);
    let verificationBaseline: DurableVerificationBaseline | undefined;
    if (hasVerificationLifecycle(input.plan)) {
      emitWorkflowActivity(input.onActivity, { state: "verifying" });
      const captured = await this.#services.ensureVerificationBaseline({
        resources,
        ledger,
        signal: input.signal,
        taskId: input.taskId,
      });
      if (!captured.ok) {
        const outcome = captured.outcome;
        return retained(
          outcome.kind === "paused"
            ? {
                ...outcome,
                verification: {
                  scope: "baseline",
                  attribution: "environment",
                },
              }
            : outcome,
        );
      }
      verificationBaseline = captured.baseline;
    }
    this.#openTask(resources, ledger, input);
    if (input.artifactCorrection?.code === "red-artifact-constraint") {
      return retained(
        await this.#runRedArtifactCorrection({
          resources,
          ledger,
          ...(verificationBaseline ? { baseline: verificationBaseline } : {}),
          attempt: input,
        }),
      );
    }
    if (input.repair) {
      if (!verificationBaseline) {
        throw new Error("workflow-verification-baseline-unavailable");
      }
      return retained(
        await this.#runCumulativeRepair({
          resources,
          ledger,
          baseline: verificationBaseline,
          attempt: input,
        }),
      );
    }
    const policyFailure = await this.revalidatePhasePolicy(
      resources,
      ledger,
      input.task,
      input.signal,
    );
    if (policyFailure) return retained(policyFailure);
    const replay = this.#replayedPhase(resources, ledger, input);
    if (replay) return retained(replay);
    const phase = input.task.phases[input.phase];
    if (!phase) throw new Error("workflow-task-phase-invalid");
    const approvedPaths = [
      ...new Set([...phase.write, ...phase.delete]),
    ].sort();
    const rollbackPaths = [
      ...new Set(
        Object.values(input.task.phases).flatMap((boundary) => [
          ...boundary.write,
          ...boundary.delete,
        ]),
      ),
    ].sort();
    if (approvedPaths.length === 0) {
      return retained({
        kind: "approval-needed",
        code: "task-write-set-empty",
      });
    }
    const baseRevisionId = resources.currentRevisionId;
    const pendingKey = `pending-${hash(input.taskId, input.phase, phase.verification.id).slice(0, 40)}`;
    const pending = this.#pendingCandidate(ledger, pendingKey, baseRevisionId);
    const proposalRoot = mkdtempSync(path.join(resources.root, "attempt-"));
    try {
      await resources.workspaces.materializeAsync(
        baseRevisionId,
        proposalRoot,
        input.signal,
      );
      const ledgerProjection = ledger.projection({
        runId: input.runId,
        taskId: input.taskId,
        nextPhase: input.phase,
      });
      const launch = async () => {
        const identity: BeginCandidateInput = {
          candidateId: `candidate-${randomUUID()}`,
          runId: input.runId,
          deliveryRevision: input.deliveryRevision,
          taskId: input.taskId,
          phase: input.phase,
          attemptId: `attempt-${hash(
            input.operationId,
            input.taskId,
            input.phase,
            hash("pi-process"),
          ).slice(0, 40)}`,
          approvedPaths,
          isolatedRevisionId: baseRevisionId,
          verificationId: phase.verification.id,
          routeId: "pi-process",
          routeFingerprint: hash("pi-process"),
        };
        if (input.reserveCandidate && !input.reserveCandidate())
          return {
            identity,
            proposal: {
              kind: "paused" as const,
              code:
                input.additionalAttempt || input.verificationOnly
                  ? "repair-attempts-exhausted"
                  : "change-work-budget-exhausted",
            },
          };
        const proposal = await this.#options.proposeCandidate({
          runId: input.runId,
          operationId: input.operationId,
          deliveryRevision: input.deliveryRevision,
          taskId: input.taskId,
          phase: input.phase,
          task: structuredClone(input.task),
          contextReadPaths: input.contextReadPaths,
          workspaceRoot: proposalRoot,
          ledgerProjection,
          candidateArtifact: {
            ledger,
            identity,
            workspaceRoot: proposalRoot,
            writePaths: phase.write,
            deletePaths: phase.delete,
          },
          ...(input.contextRequest
            ? { contextRequest: input.contextRequest }
            : {}),
          ...(input.recoveryFeedback
            ? { recoveryFeedback: input.recoveryFeedback }
            : {}),
          signal: input.signal,
          onRequestStart: () =>
            emitWorkflowActivity(input.onActivity, {
              state: "waiting-first-response",
            }),
          onHeaders: () =>
            emitWorkflowActivity(input.onActivity, { state: "running" }),
          onProgress: () =>
            emitWorkflowActivity(input.onActivity, { state: "running" }),
        });
        return { identity, proposal };
      };
      const { identity, proposal } = pending ?? (await launch());
      const correctionIdentity = identity;
      selectedRoute = {
        routeId: identity.routeId,
        routeFingerprint: identity.routeFingerprint,
      };
      let uncommittedRevisionId: string | undefined;
      const reject = async <T extends WorkflowAttemptOutcome>(
        outcome: T,
        correction: {
          category: "artifact" | "stale" | "verification" | "checkpoint";
          code: string;
          stage: string;
        },
        rollback = false,
      ): Promise<T> => {
        if (rollback && uncommittedRevisionId) {
          await this.#rollbackWorkspacePaths({
            resources,
            baseRevisionId,
            rejectedRevisionId: uncommittedRevisionId,
            paths: rollbackPaths,
          });
        }
        this.#recordCorrection(ledger, input, correctionIdentity, correction);
        return retained({ ...outcome, retryPolicy: correction.category });
      };
      if (
        proposal.kind !== "candidate" &&
        proposal.kind !== "sealed-candidate"
      ) {
        return proposal.kind === "operation-cancelled" ||
          proposal.kind === "paused" ||
          proposal.kind === "approval-needed"
          ? retained(proposal)
          : reject(proposal, {
              category: "artifact",
              code: proposal.code,
              stage: "candidate-submit",
            });
      }
      emitWorkflowActivity(input.onActivity, { state: "validating" });
      const inspected = inspectCandidateArtifact({
        ledger,
        identity,
        proposal,
        approvedPaths,
      });
      if (!inspected.ok) {
        return reject(
          { kind: "retryable", code: inspected.code },
          {
            category: "artifact",
            code: inspected.code,
            stage: inspected.stage,
          },
        );
      }
      const { bytes, paths: candidatePaths } = inspected;
      const dependencySensitive = candidatePaths.some(
        (relative) => relative === "package.json" || LOCKFILES.has(relative),
      );
      let dependenciesBefore: Map<string, DependencyContractEntry> | undefined;
      if (dependencySensitive) {
        try {
          dependenciesBefore = dependencyContract(proposalRoot);
        } catch (error) {
          if (!(error instanceof DependencyManifestError)) throw error;
          return reject(
            { kind: "retryable", code: error.message },
            {
              category: "artifact",
              code: error.message,
              stage: "candidate-dependency",
            },
          );
        }
      }
      const checked = await runGitApply(
        proposalRoot,
        bytes,
        true,
        input.signal,
      );
      if (checked !== "ok") {
        return checked === "cancelled"
          ? retained({ kind: "operation-cancelled", code: "cancelled" })
          : reject(
              { kind: "retryable", code: "candidate-diff-invalid" },
              {
                category: "artifact",
                code: "candidate-diff-invalid",
                stage: "candidate-check",
              },
            );
      }
      const applied = await runGitApply(
        proposalRoot,
        bytes,
        false,
        input.signal,
      );
      if (applied !== "ok") {
        return applied === "cancelled"
          ? retained({ kind: "operation-cancelled", code: "cancelled" })
          : reject(
              { kind: "retryable", code: "candidate-diff-invalid" },
              {
                category: "artifact",
                code: "candidate-diff-invalid",
                stage: "candidate-apply",
              },
            );
      }
      if (dependenciesBefore) {
        let dependenciesAfter: Map<string, DependencyContractEntry>;
        try {
          dependenciesAfter = dependencyContract(proposalRoot);
        } catch (error) {
          if (!(error instanceof DependencyManifestError)) throw error;
          return reject(
            { kind: "retryable", code: error.message },
            {
              category: "artifact",
              code: error.message,
              stage: "candidate-dependency",
            },
          );
        }
        if (
          hasUnapprovedDependencyChange(
            dependenciesBefore,
            dependenciesAfter,
            input.task.approvedDependencies,
            candidatePaths.some((relative) => LOCKFILES.has(relative)),
          )
        ) {
          return reject(
            { kind: "approval-needed", code: "unapproved-dependency-change" },
            {
              category: "artifact",
              code: "unapproved-dependency-change",
              stage: "candidate-dependency",
            },
          );
        }
      }
      const sealed = sealCandidateArtifact({
        ledger,
        identity,
        proposal,
        bytes,
      });
      if (!sealed.ok) {
        return reject(
          { kind: sealed.kind, code: sealed.code },
          { category: "artifact", code: sealed.code, stage: sealed.stage },
        );
      }
      const { artifactHash } = sealed;
      const candidate = resources.workspaces.createRevision({
        parentRevisionId: baseRevisionId,
        changes: revisionChanges(proposalRoot, approvedPaths),
      });
      if (
        candidatePaths.some((relative) => {
          const entry = candidate.entries[relative];
          return phase.delete.includes(relative)
            ? entry?.kind !== "absent"
            : entry?.kind !== "file";
        })
      ) {
        return reject(
          { kind: "retryable", code: "write-set-mismatch" },
          {
            category: "artifact",
            code: "write-set-mismatch",
            stage: "candidate-output",
          },
        );
      }
      const requiredOutputs = input.plan.outputs.filter(
        (output) =>
          output.producer.taskId === input.taskId &&
          output.producer.phase === input.phase,
      );
      if (
        requiredOutputs.some(
          (output) => candidate.entries[output.path]?.kind !== "file",
        )
      ) {
        return reject(
          { kind: "retryable", code: "producer-output-unavailable" },
          {
            category: "artifact",
            code: "producer-output-unavailable",
            stage: "candidate-output",
          },
        );
      }
      emitWorkflowActivity(input.onActivity, { state: "verifying" });
      this.#savePendingCandidate(ledger, pendingKey, {
        identity,
        proposal: {
          kind: "sealed-candidate",
          candidateId: identity.candidateId,
          artifactHash,
          bytes: bytes.length,
          paths: candidatePaths,
        },
      });
      const verified = await this.#services.verifyPhase({
        executionWritePaths: this.#executionWritePaths(resources),
        runId: input.runId,
        deliveryRevision: input.deliveryRevision,
        taskId: input.taskId,
        phase: input.phase,
        root: proposalRoot,
        verification: structuredClone(phase.verification),
        signal: input.signal,
      });
      if (!verified.ok) {
        if (verified.kind === "paused") return retained(verified);
        this.#savePendingCandidate(ledger, pendingKey, null);
        return reject(verified, {
          category: "verification",
          code: verified.code,
          stage: "phase-verification",
        });
      }
      const expected = expectedClassification(input.phase);
      if (
        verified.classification !== expected ||
        (input.phase === "red"
          ? verified.exitCode === 0
          : verified.exitCode !== 0)
      ) {
        return reject(
          { kind: "retryable", code: "verification-rejected" },
          {
            category: "verification",
            code: "verification-rejected",
            stage: "phase-verification",
          },
        );
      }
      let merged: ReturnType<WorkspaceStore["mergeRevision"]>;
      try {
        merged = await this.#mergeCandidate(
          resources,
          input,
          baseRevisionId,
          candidate.revisionId,
        );
        uncommittedRevisionId = merged.revisionId;
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "workspace-revision-stale"
        ) {
          return reject(
            { kind: "retryable", code: "workspace-revision-stale" },
            {
              category: "stale",
              code: "workspace-revision-stale",
              stage: "candidate-merge",
            },
          );
        }
        throw error;
      }
      const outputFacts = approvedPaths.map((relative) => {
        const entry = merged.entries[relative];
        return entry?.kind === "file"
          ? {
              path: relative,
              kind: "file" as const,
              hash: entry.hash,
              bytes: entry.bytes,
            }
          : { path: relative, kind: "absent" as const };
      });
      if (
        requiredOutputs.some(
          (output) => merged.entries[output.path]?.kind !== "file",
        )
      ) {
        return reject(
          { kind: "retryable", code: "producer-output-unavailable" },
          {
            category: "artifact",
            code: "producer-output-unavailable",
            stage: "candidate-output",
          },
          true,
        );
      }
      const phaseEvent: VerifiedTaskEvent = {
        runId: input.runId,
        taskId: input.taskId,
        eventId: `${input.phase}-verified-r${input.deliveryRevision}`,
        kind: "phase-verified",
        phase: input.phase,
        commandId: phase.verification.id,
        exitCode: verified.exitCode,
        expectedClassification: expected,
        actualClassification: verified.classification,
        diagnostic: verified.diagnostic,
        artifactHash,
        isolatedRevisionId: merged.revisionId,
        outputFacts,
        routeId: identity.routeId,
        routeFingerprint: identity.routeFingerprint,
      };
      if (this.#options.verificationPolicy || resources.environmentIdentity)
        ledger.putDurableFact(
          this.#policyFactKey(
            resources,
            phaseEvent as unknown as Record<string, unknown>,
          ),
          { policy: this.#options.verificationPolicy ?? "legacy" },
        );
      const finalPhase = input.task.phases.refactor ? "refactor" : "green";
      if (!verificationBaseline || input.phase !== finalPhase) {
        ledger.commitVerifiedEvent(phaseEvent);
        return retained({
          kind: "phase-committed",
          artifactHash,
          isolatedRevisionId: merged.revisionId,
          exitCode: verified.exitCode,
          classification: verified.classification,
          baselineRevisionId: resources.baselineRevisionId,
        });
      }

      const completionEvents: VerifiedTaskEvent[] = [phaseEvent];
      const discardUncommitted = async <T extends WorkflowAttemptOutcome>(
        outcome: T,
      ): Promise<T> => {
        if (uncommittedRevisionId) {
          await this.#rollbackWorkspacePaths({
            resources,
            baseRevisionId,
            rejectedRevisionId: uncommittedRevisionId,
            paths: rollbackPaths,
          });
        }
        return retained(outcome);
      };
      let affected = await this.#services.verifyTaskAffected({
        resources,
        baseline: verificationBaseline,
        task: input.task,
        revisionId: merged.revisionId,
        signal: input.signal,
      });
      let repairAttempts = 0;
      let completionAttribution: "none" | "pre-existing" | "introduced" =
        "none";
      while (affected.kind === "repairable") {
        completionAttribution = "introduced";
        if (
          !(
            input.recoveryDecision?.({
              kind: "affected-repair",
              attempt: repairAttempts + 1,
            }) ??
            decideRecoveryAction(
              input.plan,
              { kind: "affected-repair", attempt: repairAttempts + 1 },
              input,
            )
          ).allowed
        ) {
          return reject(
            { kind: "paused", code: "repair-attempts-exhausted" },
            {
              category: "verification",
              code: "repair-attempts-exhausted",
              stage: "task-affected-verification",
            },
            true,
          );
        }
        repairAttempts += 1;
        const failureIdentities = [...affected.failureIdentities];
        const repair = await this.#runRepairCandidate({
          resources,
          ledger,
          attempt: input,
          repairAttempt: repairAttempts,
          failureIdentities,
        });
        if (repair.kind !== "repair-committed") {
          return discardUncommitted(repair);
        }
        selectedRoute = {
          routeId: repair.commit.routeId,
          routeFingerprint: repair.commit.routeFingerprint,
        };
        uncommittedRevisionId = repair.commit.isolatedRevisionId;
        completionEvents.push({
          runId: input.runId,
          taskId: input.taskId,
          eventId: `repair-${repairAttempts}-verified-r${input.deliveryRevision}`,
          kind: "repair-verified",
          phase: input.phase,
          attempt: repairAttempts,
          commandId: input.task.repairVerification.id,
          exitCode: 0,
          diagnostic: repair.commit.diagnostic,
          artifactHash: repair.commit.artifactHash,
          isolatedRevisionId: repair.commit.isolatedRevisionId,
          outputFacts: repair.commit.outputFacts,
          attribution: "introduced",
          failureIdentities,
          routeId: repair.commit.routeId,
          routeFingerprint: repair.commit.routeFingerprint,
        });
        affected = await this.#services.verifyTaskAffected({
          resources,
          baseline: verificationBaseline,
          task: input.task,
          revisionId: repair.commit.isolatedRevisionId,
          signal: input.signal,
        });
      }
      if (affected.kind !== "verified") {
        return affected.kind === "operation-cancelled"
          ? discardUncommitted(affected)
          : reject(
              affected,
              {
                category: "verification",
                code: affected.code,
                stage: "task-affected-verification",
              },
              true,
            );
      }
      if (completionAttribution === "none") {
        completionAttribution = affected.attribution;
      }
      let completedRevision: WorkspaceRevision;
      try {
        completedRevision = this.completeTracking(resources, input.taskId);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "workflow-tracking-task-mismatch"
        ) {
          return reject(
            { kind: "paused", code: "tracking-contract-invalid" },
            {
              category: "checkpoint",
              code: "tracking-contract-invalid",
              stage: "tracking-checkpoint",
            },
            true,
          );
        }
        throw error;
      }
      const factKey = `task-final-${hash(input.taskId).slice(0, 40)}`;
      ledger.commitTaskCompletion({
        events: completionEvents,
        factKey,
        fact: {
          taskId: input.taskId,
          phase: input.phase,
          isolatedRevisionId: completedRevision.revisionId,
          attribution: completionAttribution,
          repairAttempts,
        },
      });
      return retained({
        kind: "phase-committed",
        artifactHash,
        isolatedRevisionId: completedRevision.revisionId,
        exitCode: verified.exitCode,
        classification: verified.classification,
        baselineRevisionId: resources.baselineRevisionId,
      });
    } finally {
      if (!isExecutionRetained(proposalRoot))
        removePathSync(proposalRoot, { recursive: true, force: true });
    }
  }
}
