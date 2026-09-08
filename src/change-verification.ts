import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { verifyCumulativeRevision } from "./apply-transaction.ts";
import type { ArtifactStore } from "./artifact-store.ts";
import type { StructuredVerificationContract } from "./contracts.ts";
import type { PlanTaskDraft } from "./delivery-compiler.ts";
import type {
  DurableAffectedResult,
  DurableBaselineResult,
  DurableChangeVerificationResult,
  DurableExecutionResources,
  DurableObservedVerification,
  DurablePhaseVerificationResult,
  DurableResourceInput,
  DurableVerificationBaseline,
  DurableVerificationObservation,
  DurableWorkflowEngineOptions,
} from "./durable-contracts.ts";

import { observeSafePath } from "./safe-path.ts";

import type { TaskLedger } from "./task-ledger.ts";
import {
  type DurableVerificationScope,
  hash,
  hasVerificationLifecycle,
  IDENTIFIER,
  isRecord,
  SHA256,
  type WorkflowAttemptOutcome,
  type WorkflowChangeVerifier,
} from "./workflow-policy.ts";
import type { WorkspaceRevision } from "./workspace-store.ts";
export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function verificationIdentities(
  result: DurableChangeVerificationResult,
  verification: StructuredVerificationContract,
  scope: DurableVerificationScope,
): string[] {
  // Keep the complete comparison set; only Worker/status summaries are bounded.
  const supplied = result.failureIdentities;
  if (
    Array.isArray(supplied) &&
    supplied.every(
      (identity) => typeof identity === "string" && SHA256.test(identity),
    )
  ) {
    return [...new Set(supplied)].sort();
  }
  if (result.ok) return [];
  return [hash("verification-failure", scope, verification.id, result.code)];
}
export function verificationBaselineFact(
  baseline: DurableVerificationBaseline,
  artifacts: ArtifactStore,
) {
  // Complete private evidence must not inherit the bounded model projection limits.
  const artifact = artifacts.put(Buffer.from(JSON.stringify(baseline)));
  return {
    revisionId: baseline.revisionId,
    baselineArtifactHash: artifact.hash,
  };
}
export function parseVerificationBaseline(
  value: unknown,
  artifacts: ArtifactStore,
): DurableVerificationBaseline {
  if (isRecord(value) && typeof value.baselineArtifactHash === "string") {
    const revisionId = value.revisionId;
    value = JSON.parse(
      Buffer.from(artifacts.read(value.baselineArtifactHash)).toString("utf8"),
    );
    if (!isRecord(value) || value.revisionId !== revisionId)
      throw new Error("workflow-verification-baseline-conflict");
  }
  if (
    !isRecord(value) ||
    typeof value.revisionId !== "string" ||
    !SHA256.test(value.revisionId) ||
    !Array.isArray(value.targetContracts) ||
    !Array.isArray(value.affected) ||
    !isRecord(value.fullSuite)
  ) {
    throw new Error("workflow-verification-baseline-invalid");
  }
  const baseline = structuredClone(
    value,
  ) as unknown as DurableVerificationBaseline;
  const validObservation = (observation: DurableVerificationObservation) =>
    (observation.status === "passed" || observation.status === "failed") &&
    typeof observation.verificationId === "string" &&
    IDENTIFIER.test(observation.verificationId) &&
    Array.isArray(observation.failureIdentities) &&
    observation.failureIdentities.every((identity) => SHA256.test(identity)) &&
    (observation.code === undefined || typeof observation.code === "string") &&
    (observation.attributionReliable === undefined ||
      typeof observation.attributionReliable === "boolean");
  if (
    !baseline.targetContracts.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.taskId === "string" &&
        typeof entry.verificationId === "string" &&
        typeof entry.expectedFailure === "string",
    ) ||
    !baseline.affected.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.taskId === "string" &&
        isRecord(entry.observation) &&
        validObservation(entry.observation),
    ) ||
    !validObservation(baseline.fullSuite)
  ) {
    throw new Error("workflow-verification-baseline-invalid");
  }
  return baseline;
}

export interface ChangeVerificationServices {
  prepareResources(
    input: DurableResourceInput,
    signal: AbortSignal,
  ): Promise<DurableExecutionResources>;
  ledger(
    resources: DurableExecutionResources,
    deliveryRevision: number,
  ): TaskLedger;
  revalidatePhasePolicy(
    resources: DurableExecutionResources,
    ledger: TaskLedger,
    task: PlanTaskDraft,
    signal: AbortSignal,
  ): Promise<WorkflowAttemptOutcome | undefined>;
  run(runId: string): DurableExecutionResources | undefined;
}
export class ChangeVerification {
  readonly #services: ChangeVerificationServices;
  readonly #options: Pick<
    DurableWorkflowEngineOptions,
    | "verificationEnvironment"
    | "verifyPhase"
    | "verifyChange"
    | "verificationPolicy"
  >;
  constructor(
    options: Pick<
      DurableWorkflowEngineOptions,
      | "verificationEnvironment"
      | "verifyPhase"
      | "verifyChange"
      | "verificationPolicy"
    >,
    services: ChangeVerificationServices,
  ) {
    this.#options = options;
    this.#services = services;
  }
  async #refreshEnvironment(
    resources: DurableExecutionResources,
    signal: AbortSignal,
  ): Promise<void> {
    if (!this.#options.verificationEnvironment) return;
    const identity = await this.#options.verificationEnvironment(
      resources.plan,
      signal,
    );
    if (identity !== resources.environmentIdentity) {
      resources.environmentIdentity = identity;
      resources.baselinePromises.clear();
      resources.verificationFact = undefined;
    }
  }

  async #environmentCurrent(
    runId: string,
    signal: AbortSignal,
    expected?: string,
  ): Promise<boolean> {
    if (!this.#options.verificationEnvironment) return true;
    const resources = this.#services.run(runId);
    if (!resources) return false;
    try {
      const identity = await this.#options.verificationEnvironment(
        resources.plan,
        signal,
      );
      resources.environmentIdentity ??= identity;
      return identity === (expected ?? resources.environmentIdentity);
    } catch {
      signal.throwIfAborted();
      return false;
    }
  }

  async verifyPhase(
    input: Parameters<DurableWorkflowEngineOptions["verifyPhase"]>[0],
  ): Promise<DurablePhaseVerificationResult> {
    if (await this.#environmentCurrent(input.runId, input.signal)) {
      const identity = this.#services.run(input.runId)?.environmentIdentity;
      const result = await this.#options.verifyPhase(input);
      if (await this.#environmentCurrent(input.runId, input.signal, identity))
        return result;
    }
    return {
      ok: false,
      kind: "paused",
      code: "verification-environment-changed",
    };
  }

  async #verifyChange(
    input: Parameters<DurableWorkflowEngineOptions["verifyChange"]>[0],
  ): Promise<DurableChangeVerificationResult> {
    if (await this.#environmentCurrent(input.runId, input.signal)) {
      const identity = this.#services.run(input.runId)?.environmentIdentity;
      const result = await this.#options.verifyChange(input);
      if (await this.#environmentCurrent(input.runId, input.signal, identity))
        return result;
    }
    return {
      ok: false,
      kind: "environment",
      code: "verification-environment-changed",
    };
  }

  async verifyPostApply(
    resources: DurableExecutionResources,
    root: string,
    signal: AbortSignal,
    transactionId: string,
  ): Promise<{ ok: true } | { ok: false; code: string }> {
    if (this.#options.verificationEnvironment) {
      const fact = this.#services
        .ledger(resources, resources.deliveryRevision)
        .durableFact(`apply-environment-${hash(transactionId).slice(0, 40)}`);
      if (!isRecord(fact) || typeof fact.identity !== "string")
        return { ok: false, code: "verification-environment-changed" };
      resources.environmentIdentity = fact.identity;
      if (
        !(await this.#environmentCurrent(
          resources.runId,
          signal,
          fact.identity,
        ))
      )
        return { ok: false, code: "verification-environment-changed" };
    }
    if (
      resources.plan.outputs.some(
        (output) => observeSafePath(root, output.path).kind !== "file",
      )
    ) {
      return { ok: false, code: "producer-output-unavailable" };
    }
    const lifecycle = hasVerificationLifecycle(resources.plan);
    const result = await this.#verifyChange({
      runId: resources.runId,
      deliveryRevision: resources.deliveryRevision,
      root,
      plan: structuredClone(resources.plan),
      ...(lifecycle
        ? {
            scope: "post-apply" as const,
            verification: structuredClone(
              resources.plan.verification.change.postApply,
            ),
          }
        : {}),
      signal,
    });
    return result.ok &&
      result.exitCode === 0 &&
      result.classification.length > 0
      ? { ok: true }
      : {
          ok: false,
          code: result.ok ? "post-apply-verification-invalid" : result.code,
        };
  }

  async #observeVerification(input: {
    resources: DurableExecutionResources;
    revisionId: string;
    scope: DurableVerificationScope;
    verification: StructuredVerificationContract;
    signal: AbortSignal;
    taskId?: string;
  }): Promise<DurableObservedVerification> {
    if (input.signal.aborted) {
      return {
        ok: false,
        outcome: { kind: "operation-cancelled", code: "cancelled" },
      };
    }
    const root = mkdtempSync(path.join(input.resources.root, "verification-"));
    try {
      await input.resources.workspaces.materializeAsync(
        input.revisionId,
        root,
        input.signal,
      );
      const result = await this.#verifyChange({
        runId: input.resources.runId,
        deliveryRevision: input.resources.deliveryRevision,
        root,
        plan: structuredClone(input.resources.plan),
        scope: input.scope,
        verification: structuredClone(input.verification),
        ...(input.taskId ? { taskId: input.taskId } : {}),
        signal: input.signal,
      });
      if (result.ok) {
        return {
          ok: true,
          observation: {
            status: "passed",
            verificationId: input.verification.id,
            failureIdentities: verificationIdentities(
              result,
              input.verification,
              input.scope,
            ),
          },
        };
      }
      if (result.kind === "verification") {
        return {
          ok: true,
          observation: {
            status: "failed",
            verificationId: input.verification.id,
            failureIdentities: verificationIdentities(
              result,
              input.verification,
              input.scope,
            ),
            code: result.code,
            attributionReliable: result.attributionReliable,
          },
        };
      }
      if (result.kind === "approval-boundary") {
        return {
          ok: false,
          outcome: { kind: "approval-needed", code: result.code },
        };
      }
      if (result.kind === "cancelled" || input.signal.aborted) {
        return {
          ok: false,
          outcome: { kind: "operation-cancelled", code: "cancelled" },
        };
      }
      return {
        ok: false,
        outcome: { kind: "paused", code: result.code },
      };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  async #captureVerificationBaseline(input: {
    resources: DurableExecutionResources;
    ledger: TaskLedger;
    signal: AbortSignal;
  }): Promise<DurableBaselineResult> {
    const environmentIdentity = input.resources.environmentIdentity;
    const stored = input.ledger.durableFact(
      this.baselineFactKey(input.resources),
    );
    if (stored !== undefined) {
      const baseline = parseVerificationBaseline(
        stored,
        input.resources.artifacts,
      );
      if (baseline.revisionId !== input.resources.baselineRevisionId) {
        throw new Error("workflow-verification-baseline-conflict");
      }
      return { ok: true, baseline };
    }
    const plan = input.resources.plan;
    const affected: DurableVerificationBaseline["affected"] = [];
    for (const task of plan.tasks) {
      const observed = await this.#observeVerification({
        resources: input.resources,
        revisionId: input.resources.baselineRevisionId,
        scope: "baseline-task-affected",
        verification: task.affectedVerification,
        taskId: task.taskId,
        signal: input.signal,
      });
      if (!observed.ok) return observed;
      affected.push({
        taskId: task.taskId,
        observation: observed.observation,
      });
    }
    const fullSuite = await this.#observeVerification({
      resources: input.resources,
      revisionId: input.resources.baselineRevisionId,
      scope: "baseline-full-suite",
      verification: plan.verification.baseline.fullSuite,
      signal: input.signal,
    });
    if (!fullSuite.ok) return fullSuite;
    const baseline: DurableVerificationBaseline = {
      revisionId: input.resources.baselineRevisionId,
      targetContracts: plan.tasks
        .filter(
          (task) =>
            !task.verificationMode || task.verificationMode === "behavior",
        )
        .map((task) => ({
          taskId: task.taskId,
          verificationId: task.phases.red.verification.id,
          expectedFailure:
            "expectedFailure" in task.phases.red.verification
              ? (task.phases.red.verification.expectedFailure ??
                task.phases.red.verification.id)
              : task.phases.red.verification.id,
        })),
      affected,
      fullSuite: fullSuite.observation,
    };
    if (environmentIdentity !== input.resources.environmentIdentity)
      return {
        ok: false,
        outcome: { kind: "paused", code: "verification-environment-changed" },
      };
    input.ledger.putDurableFact(
      this.baselineFactKey(input.resources),
      verificationBaselineFact(baseline, input.resources.artifacts),
    );
    return { ok: true, baseline };
  }

  async ensureVerificationBaseline(input: {
    resources: DurableExecutionResources;
    ledger: TaskLedger;
    signal: AbortSignal;
  }): Promise<DurableBaselineResult> {
    try {
      await this.#refreshEnvironment(input.resources, input.signal);
    } catch {
      return {
        ok: false,
        outcome: {
          kind: "paused",
          code: "verification-environment-unavailable",
        },
      };
    }
    const existing = input.resources.baselinePromises.get(
      input.resources.deliveryRevision,
    );
    if (existing) return existing;
    const pending = this.#captureVerificationBaseline(input).then((result) => {
      if (!result.ok) {
        input.resources.baselinePromises.delete(
          input.resources.deliveryRevision,
        );
      }
      return result;
    });
    input.resources.baselinePromises.set(
      input.resources.deliveryRevision,
      pending,
    );
    return pending;
  }

  async verifyTaskAffected(input: {
    resources: DurableExecutionResources;
    baseline: DurableVerificationBaseline;
    task: PlanTaskDraft;
    revisionId: string;
    signal: AbortSignal;
  }): Promise<DurableAffectedResult> {
    const baseline = input.baseline.affected.find(
      (entry) => entry.taskId === input.task.taskId,
    );
    if (!baseline) throw new Error("workflow-task-baseline-unavailable");
    const current = await this.#observeVerification({
      resources: input.resources,
      revisionId: input.revisionId,
      scope: "task-affected",
      verification: input.task.affectedVerification,
      taskId: input.task.taskId,
      signal: input.signal,
    });
    if (!current.ok) return current.outcome;
    if (current.observation.status === "passed") {
      return { kind: "verified", attribution: "none" };
    }
    if (
      current.observation.attributionReliable === false &&
      baseline.observation.status === "failed"
    )
      return { kind: "paused", code: "verification-attribution-unresolved" };
    const prior = new Set(baseline.observation.failureIdentities);
    const introduced = current.observation.failureIdentities.filter(
      (identity) => !prior.has(identity),
    );
    if (introduced.length === 0) {
      return { kind: "verified", attribution: "pre-existing" };
    }
    return {
      kind: "repairable",
      attribution: "introduced",
      failureIdentities: introduced.slice(0, 256),
    };
  }

  #agentsManagedParts(
    text: string,
  ): { prefix: string; suffix: string } | undefined {
    const startMarker = "<!-- ABEL:AGENTS-INDEX:START -->";
    const endMarker = "<!-- ABEL:AGENTS-INDEX:END -->";
    const lines = text.split("\n");
    const starts: Array<{ line: number; start: number }> = [];
    const ends: Array<{ line: number; end: number }> = [];
    let offset = 0;
    for (const [line, value] of lines.entries()) {
      if (value === startMarker) starts.push({ line, start: offset });
      if (value === endMarker) {
        ends.push({ line, end: offset + value.length });
      }
      offset += value.length + 1;
    }
    if (
      starts.length !== 1 ||
      ends.length !== 1 ||
      starts[0].line >= ends[0].line
    ) {
      return undefined;
    }
    return {
      prefix: text.slice(0, starts[0].start),
      suffix: text.slice(ends[0].end),
    };
  }

  #applyAgentsCheckpoint(
    resources: DurableExecutionResources,
  ): { ok: true; revision: WorkspaceRevision } | { ok: false; code: string } {
    const checkpoint = resources.plan.verification.agentsCheckpoint;
    const current = resources.workspaces.getRevision(
      resources.currentRevisionId,
    );
    if (!checkpoint.required) return { ok: true, revision: current };
    const changes: Record<
      string,
      { kind: "absent" } | { kind: "file"; bytes: Uint8Array; mode: number }
    > = {};
    for (const operation of checkpoint.operations) {
      const entry = current.entries[operation.target];
      let before: string | null;
      if (!entry || entry.kind === "absent") {
        before = null;
      } else {
        try {
          before = new TextDecoder("utf-8", { fatal: true }).decode(
            resources.artifacts.read(entry.hash),
          );
        } catch {
          return { ok: false, code: "agents-checkpoint-contract-stale" };
        }
      }
      if (operation.impact === "create-index") {
        if (operation.managedBlock === null) {
          throw new Error("workflow-agents-checkpoint-invalid");
        }
        const desired = `${operation.managedBlock}\n`;
        if (before !== null && before !== desired) {
          return { ok: false, code: "agents-checkpoint-contract-stale" };
        }
        if (before === null) {
          changes[operation.target] = {
            kind: "file",
            bytes: new TextEncoder().encode(desired),
            mode: 0o644,
          };
        }
        continue;
      }
      if (operation.impact === "remove-index") {
        if (operation.managedBlock !== null) {
          throw new Error("workflow-agents-checkpoint-invalid");
        }
        if (before === null) continue;
        const parts = this.#agentsManagedParts(before);
        if (!parts) {
          return { ok: false, code: "agents-checkpoint-contract-stale" };
        }
        const after = `${parts.prefix}${parts.suffix}`;
        changes[operation.target] =
          after.trim().length === 0
            ? { kind: "absent" }
            : {
                kind: "file",
                bytes: new TextEncoder().encode(after),
                mode: entry?.kind === "file" ? entry.mode : 0o644,
              };
        continue;
      }
      if (operation.managedBlock === null || before === null) {
        return { ok: false, code: "agents-checkpoint-contract-stale" };
      }
      const parts = this.#agentsManagedParts(before);
      if (!parts) {
        return { ok: false, code: "agents-checkpoint-contract-stale" };
      }
      const after = `${parts.prefix}${operation.managedBlock}${parts.suffix}`;
      if (after !== before) {
        changes[operation.target] = {
          kind: "file",
          bytes: new TextEncoder().encode(after),
          mode: entry?.kind === "file" ? entry.mode : 0o644,
        };
      }
    }
    if (Object.keys(changes).length === 0) {
      return { ok: true, revision: current };
    }
    return {
      ok: true,
      revision: resources.workspaces.createRevision({
        parentRevisionId: current.revisionId,
        changes,
      }),
    };
  }

  baselineFactKey(resources: DurableExecutionResources): string {
    return this.#options.verificationPolicy || resources.environmentIdentity
      ? `verification-baseline-${hash(this.#options.verificationPolicy ?? "legacy", resources.environmentIdentity ?? "legacy").slice(0, 24)}`
      : "verification-baseline";
  }

  async verify(
    input: Parameters<WorkflowChangeVerifier["verify"]>[0],
  ): Promise<Awaited<ReturnType<WorkflowChangeVerifier["verify"]>>> {
    if (!input.currentWorkspaceRevisionId) {
      return { kind: "paused", code: "workspace-revision-unavailable" };
    }
    const resources = await this.#services.prepareResources(
      {
        runId: input.runId,
        deliveryRevision: input.deliveryRevision,
        plan: input.plan,
        currentWorkspaceRevisionId: input.currentWorkspaceRevisionId,
        baselineRevisionId:
          input.baselineRevisionId ??
          this.#services.run(input.runId)?.baselineRevisionId,
      },
      input.signal,
    );
    try {
      await this.#refreshEnvironment(resources, input.signal);
    } catch {
      return { kind: "paused", code: "verification-environment-unavailable" };
    }
    for (const reference of input.taskEvidence ?? []) {
      const task = input.plan.tasks.find(
        (task) => task.taskId === reference.taskId,
      );
      if (!task) throw new Error("workflow-ledger-task-invalid");
      const failure = await this.#services.revalidatePhasePolicy(
        resources,
        this.#services.ledger(resources, reference.deliveryRevision),
        task,
        input.signal,
      );
      if (failure)
        return {
          kind: "paused",
          code:
            "code" in failure ? failure.code : "verification-policy-rejected",
        };
    }
    const cumulativeRevision = resources.workspaces.getRevision(
      resources.currentRevisionId,
    );
    if (
      input.plan.outputs.some(
        (output) => cumulativeRevision.entries[output.path]?.kind !== "file",
      )
    ) {
      return { kind: "paused", code: "producer-output-unavailable" };
    }
    if (hasVerificationLifecycle(input.plan)) {
      const ledger = this.#services.ledger(resources, input.deliveryRevision);
      const captured = await this.ensureVerificationBaseline({
        resources,
        ledger,
        signal: input.signal,
      });
      if (!captured.ok) {
        return captured.outcome.kind === "approval-needed"
          ? captured.outcome
          : captured.outcome.kind === "operation-cancelled"
            ? { kind: "paused", code: "cancelled" }
            : {
                ...captured.outcome,
                verification: {
                  scope: "baseline",
                  attribution: "environment",
                },
              };
      }
      for (const task of input.plan.tasks) {
        const baseline = captured.baseline.affected.find(
          (entry) => entry.taskId === task.taskId,
        );
        if (!baseline) throw new Error("workflow-task-baseline-unavailable");
        const current = await this.#observeVerification({
          resources,
          revisionId: resources.currentRevisionId,
          scope: "change-task-affected",
          verification: task.affectedVerification,
          taskId: task.taskId,
          signal: input.signal,
        });
        if (!current.ok) {
          return current.outcome.kind === "approval-needed"
            ? current.outcome
            : current.outcome.kind === "operation-cancelled"
              ? { kind: "paused", code: "cancelled" }
              : {
                  ...current.outcome,
                  verification: {
                    scope: "change-task-affected",
                    attribution: "environment",
                    taskId: task.taskId,
                  },
                };
        }
        if (current.observation.status === "failed") {
          if (
            current.observation.attributionReliable === false &&
            baseline.observation.status === "failed"
          )
            return {
              kind: "paused",
              code: "verification-attribution-unresolved",
            };
          const prior = new Set(baseline.observation.failureIdentities);
          const introduced = current.observation.failureIdentities.filter(
            (identity) => !prior.has(identity),
          );
          if (introduced.length > 0) {
            return {
              kind: "paused",
              code: "verification-repair-required",
              verification: {
                scope: "change-task-affected",
                attribution: "introduced",
                taskId: task.taskId,
                failureIdentities: introduced.slice(0, 256),
              },
            };
          }
        }
      }
      const fullSuite = await this.#observeVerification({
        resources,
        revisionId: resources.currentRevisionId,
        scope: "change-full-suite",
        verification: input.plan.verification.change.fullSuite,
        signal: input.signal,
      });
      if (!fullSuite.ok) {
        return fullSuite.outcome.kind === "approval-needed"
          ? fullSuite.outcome
          : fullSuite.outcome.kind === "operation-cancelled"
            ? { kind: "paused", code: "cancelled" }
            : {
                ...fullSuite.outcome,
                verification: {
                  scope: "change-full-suite",
                  attribution: "environment",
                },
              };
      }
      if (fullSuite.observation.status === "failed") {
        if (
          fullSuite.observation.attributionReliable === false &&
          captured.baseline.fullSuite.status === "failed"
        )
          return {
            kind: "paused",
            code: "verification-attribution-unresolved",
          };
        const baselineFailures = new Set(
          captured.baseline.fullSuite.failureIdentities,
        );
        const introduced = fullSuite.observation.failureIdentities.filter(
          (identity) => !baselineFailures.has(identity),
        );
        if (introduced.length > 0) {
          return {
            kind: "paused",
            code: "verification-attribution-unresolved",
            verification: {
              scope: "change-full-suite",
              attribution: "unresolved",
              failureIdentities: introduced.slice(0, 256),
            },
          };
        }
      }
      const checkpoint = input.plan.verification.agentsCheckpoint;
      if (checkpoint.required && checkpoint.verification) {
        const applied = this.#applyAgentsCheckpoint(resources);
        if (!applied.ok) {
          return { kind: "paused", code: applied.code };
        }
        const observed = await this.#observeVerification({
          resources,
          revisionId: applied.revision.revisionId,
          scope: "agents-checkpoint",
          verification: checkpoint.verification,
          signal: input.signal,
        });
        if (!observed.ok) {
          return observed.outcome.kind === "approval-needed"
            ? observed.outcome
            : observed.outcome.kind === "operation-cancelled"
              ? { kind: "paused", code: "cancelled" }
              : {
                  ...observed.outcome,
                  verification: {
                    scope: "agents-checkpoint",
                    attribution: "environment",
                  },
                };
        }
        if (observed.observation.status === "failed") {
          return {
            kind: "paused",
            code: "agents-checkpoint-verification-failed",
            verification: {
              scope: "agents-checkpoint",
              attribution: "introduced",
              failureIdentities: observed.observation.failureIdentities.slice(
                0,
                256,
              ),
            },
          };
        }
        resources.currentRevisionId = applied.revision.revisionId;
      }
      const verificationId = `change-${hash(
        input.plan.changeId,
        String(input.deliveryRevision),
        resources.currentRevisionId,
        ...(resources.environmentIdentity
          ? [resources.environmentIdentity]
          : []),
      ).slice(0, 40)}`;
      const sealed = await verifyCumulativeRevision({
        workspaceStore: resources.workspaces,
        revisionId: resources.currentRevisionId,
        verificationId,
        signal: input.signal,
        execute: async () => ({
          ok: true as const,
          exitCode: 0 as const,
          classification: "lifecycle-verified",
        }),
      });
      if (!sealed.ok) return { kind: "paused", code: sealed.code };
      resources.verificationFact = sealed.fact;
      return {
        kind: "verified",
        verificationId: sealed.verificationId,
        currentWorkspaceRevisionId: resources.currentRevisionId,
      };
    }
    const verificationId = `change-${hash(
      input.plan.changeId,
      String(input.deliveryRevision),
      ...(resources.environmentIdentity ? [resources.environmentIdentity] : []),
    ).slice(0, 40)}`;
    const result = await verifyCumulativeRevision({
      workspaceStore: resources.workspaces,
      revisionId: resources.currentRevisionId,
      verificationId,
      signal: input.signal,
      execute: ({ root, signal }) =>
        this.#verifyChange({
          runId: input.runId,
          deliveryRevision: input.deliveryRevision,
          root,
          plan: structuredClone(input.plan),
          signal: signal ?? input.signal,
        }),
    });
    if (!result.ok) {
      return {
        kind:
          result.kind === "approval-boundary"
            ? "approval-needed"
            : result.kind === "verification"
              ? "retryable"
              : "paused",
        code: result.code,
      };
    }
    resources.verificationFact = result.fact;
    return { kind: "verified", verificationId: result.verificationId };
  }
}
