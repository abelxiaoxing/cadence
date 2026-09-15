import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { verifyCumulativeRevision } from "./apply-transaction.ts";
import type { ArtifactStore } from "./artifact-store.ts";
import { canonicalJson } from "./canonical.ts";
import {
  type StructuredVerificationContract,
  verificationInputPaths,
} from "./contracts.ts";
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
  baselineRecoveryKey,
  type DurableVerificationScope,
  hash,
  hasVerificationLifecycle,
  IDENTIFIER,
  isRecord,
  SHA256,
  type WorkflowAttemptOutcome,
  type WorkflowChangeVerifier,
  type WorkflowVerificationPrerequisite,
} from "./workflow-policy.ts";
import type { WorkspaceRevision } from "./workspace-store.ts";
export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function verificationContractIdentity(
  verification: StructuredVerificationContract,
): string {
  const executionSemantics = (
    contract: StructuredVerificationContract,
  ): unknown => {
    if (contract.kind === "steps") {
      return {
        kind: contract.kind,
        steps: contract.steps.map((step) => executionSemantics(step)),
      };
    }
    const {
      id: _id,
      classification: _classification,
      expectedFailure: _expectedFailure,
      ...semantics
    } = contract;
    return semantics;
  };
  return hash(
    "verification-contract-v1",
    canonicalJson(executionSemantics(verification)),
  );
}

const BASELINE_CAPABILITY_CODES = new Set([
  "dependency-path-unsafe",
  "isolation-backend-launch-failed",
  "isolation-backend-unavailable",
  "local-executable-missing",
  "runner-missing",
  "sandbox-runtime-unavailable",
  "verification-environment-changed",
  "verification-environment-requires-trusted-mode",
  "verification-environment-unavailable",
  "verification-runner-launch-failed",
  "workspace-dependency-missing",
]);

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => allowed.has(key))
  );
}

function verificationIdentities(
  result: DurableChangeVerificationResult,
  contractIdentity: string,
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
  return [hash("verification-failure-v2", contractIdentity, result.code)];
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
      typeof observation.attributionReliable === "boolean") &&
    (observation.contractIdentity === undefined ||
      (typeof observation.contractIdentity === "string" &&
        SHA256.test(observation.contractIdentity)));
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

  #originalBaselineRevisionId(resources: DurableExecutionResources): string {
    return (
      (
        resources as DurableExecutionResources & {
          originalBaselineRevisionId?: string;
        }
      ).originalBaselineRevisionId ?? resources.baselineRevisionId
    );
  }

  #observedEnvironmentIdentity(resources: DurableExecutionResources): string {
    const identity = resources.environmentIdentity;
    if (!identity) return "unobserved";
    return SHA256.test(identity)
      ? identity
      : hash("verification-environment-identity-v1", identity);
  }

  #baselinePrerequisite(input: {
    resources: DurableExecutionResources;
    root: string;
    revisionId: string;
    scope: "baseline-task-affected" | "baseline-full-suite";
    verification: StructuredVerificationContract;
    result: Extract<DurableChangeVerificationResult, { ok: false }>;
    taskId?: string;
  }): WorkflowVerificationPrerequisite {
    const originalRevisionId = this.#originalBaselineRevisionId(
      input.resources,
    );
    if (input.revisionId !== originalRevisionId) {
      throw new Error("workflow-verification-baseline-conflict");
    }
    const base = {
      kind: "verification-prerequisite" as const,
      scope: input.scope,
      verificationId: input.verification.id,
      contractIdentity: verificationContractIdentity(input.verification),
      originalRevisionId,
      environmentIdentity: this.#observedEnvironmentIdentity(input.resources),
      ...(input.taskId ? { taskId: input.taskId } : {}),
    };
    const observedInputs = verificationInputPaths(input.verification).map(
      (relative) => ({
        relative,
        observation: observeSafePath(input.root, relative),
      }),
    );
    const unsafe = observedInputs.find(
      ({ observation }) =>
        observation.kind !== "file" && observation.kind !== "absent",
    );
    if (unsafe) {
      return {
        ...base,
        cause: "unsafe-input",
        input: { path: unsafe.relative, kind: "unsafe" },
      };
    }
    const absent = observedInputs.find(
      ({ observation }) => observation.kind === "absent",
    );
    if (absent) {
      const output = input.resources.plan.outputs.find(
        (candidate) => candidate.path === absent.relative,
      );
      return output
        ? {
            ...base,
            cause: "future-output",
            input: { path: absent.relative, kind: "absent" },
            producer: structuredClone(output.producer),
          }
        : {
            ...base,
            cause: "missing-input",
            input: { path: absent.relative, kind: "absent" },
          };
    }
    return {
      ...base,
      cause: BASELINE_CAPABILITY_CODES.has(input.result.code)
        ? "capability"
        : "unknown",
    };
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
    const contractIdentity = verificationContractIdentity(input.verification);
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
            failureIdentities: verificationIdentities(result, contractIdentity),
            contractIdentity,
          },
        };
      }
      if (result.kind === "verification") {
        return {
          ok: true,
          observation: {
            status: "failed",
            verificationId: input.verification.id,
            failureIdentities: verificationIdentities(result, contractIdentity),
            code: result.code,
            attributionReliable: result.attributionReliable,
            contractIdentity,
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
      const baselineScope =
        input.scope === "baseline-task-affected" ||
        input.scope === "baseline-full-suite"
          ? input.scope
          : undefined;
      return {
        ok: false,
        outcome: {
          kind: "paused",
          code: result.code,
          ...(baselineScope
            ? {
                prerequisite: this.#baselinePrerequisite({
                  resources: input.resources,
                  root,
                  revisionId: input.revisionId,
                  scope: baselineScope,
                  verification: input.verification,
                  result,
                  ...(input.taskId ? { taskId: input.taskId } : {}),
                }),
              }
            : {}),
        },
      };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  async #captureVerificationBaseline(input: {
    resources: DurableExecutionResources;
    ledger: TaskLedger;
    signal: AbortSignal;
    taskId?: string;
  }): Promise<DurableBaselineResult> {
    const aggregateFactKey = this.#aggregateBaselineFactKey(input.resources);
    for (const factKey of [
      aggregateFactKey,
      this.baselineFactKey(input.resources),
    ]) {
      const stored = input.ledger.durableFact(factKey);
      if (stored === undefined) continue;
      const baseline = parseVerificationBaseline(
        stored,
        input.resources.artifacts,
      );
      if (
        baseline.revisionId !==
        this.#originalBaselineRevisionId(input.resources)
      ) {
        throw new Error("workflow-verification-baseline-conflict");
      }
      // Legacy aggregates remain inspectable, but do not bind the complete
      // verification contract and therefore cannot authorize evidence reuse.
      if (factKey !== aggregateFactKey) continue;
      const compatible = this.#compatibleAggregateBaseline(
        baseline,
        input.resources.plan,
      );
      if (!compatible) continue;
      if (!input.taskId) return { ok: true, baseline };
      const affected = baseline.affected.filter(
        (entry) => entry.taskId === input.taskId,
      );
      if (affected.length === 1) {
        return { ok: true, baseline: { ...baseline, affected } };
      }
    }
    const plan = input.resources.plan;
    const tasks = input.taskId
      ? plan.tasks.filter((task) => task.taskId === input.taskId)
      : plan.tasks;
    if (tasks.length !== (input.taskId ? 1 : plan.tasks.length)) {
      throw new Error("workflow-task-baseline-unavailable");
    }
    const pendingAffected = tasks.map(async (task) => {
      const observed = await this.#captureBaselineObservation({
        resources: input.resources,
        ledger: input.ledger,
        verification: task.baselineVerification ?? task.affectedVerification,
        scope: "baseline-task-affected",
        taskId: task.taskId,
        signal: input.signal,
      });
      return { taskId: task.taskId, observed };
    });
    const pendingFullSuite = this.#captureBaselineObservation({
      resources: input.resources,
      ledger: input.ledger,
      verification: plan.verification.baseline.fullSuite,
      scope: "baseline-full-suite",
      signal: input.signal,
    });
    const settled = await Promise.allSettled([
      ...pendingAffected,
      pendingFullSuite,
    ]);
    const rejected = settled.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (rejected) throw rejected.reason;
    const fulfilled = settled as Array<
      PromiseFulfilledResult<
        | Awaited<(typeof pendingAffected)[number]>
        | Awaited<typeof pendingFullSuite>
      >
    >;
    const affectedResults = fulfilled
      .slice(0, pendingAffected.length)
      .map((result) => result.value) as Awaited<
      (typeof pendingAffected)[number]
    >[];
    const fullSuiteResult = fulfilled.at(-1);
    if (!fullSuiteResult) {
      throw new Error("workflow-verification-baseline-unavailable");
    }
    const fullSuite = fullSuiteResult.value as Awaited<typeof pendingFullSuite>;
    const affectedFailure = affectedResults.find((entry) => !entry.observed.ok);
    if (affectedFailure && !affectedFailure.observed.ok) {
      return affectedFailure.observed;
    }
    if (!fullSuite.ok) return fullSuite;
    const baseline: DurableVerificationBaseline = {
      revisionId: this.#originalBaselineRevisionId(input.resources),
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
      affected: affectedResults.map((entry) => {
        if (!entry.observed.ok) {
          throw new Error("workflow-task-baseline-unavailable");
        }
        return {
          taskId: entry.taskId,
          observation: entry.observed.observation,
        };
      }),
      fullSuite: fullSuite.observation,
    };
    if (!input.taskId) {
      input.ledger.putDurableFact(
        this.#aggregateBaselineFactKey(input.resources),
        verificationBaselineFact(baseline, input.resources.artifacts),
      );
    }
    return { ok: true, baseline };
  }

  #compatibleAggregateBaseline(
    baseline: DurableVerificationBaseline,
    plan: DurableExecutionResources["plan"],
  ): boolean {
    const matches = (
      observation: DurableVerificationObservation,
      contract: StructuredVerificationContract,
    ): boolean =>
      observation.verificationId === contract.id &&
      observation.contractIdentity === verificationContractIdentity(contract);
    return (
      matches(baseline.fullSuite, plan.verification.baseline.fullSuite) &&
      baseline.affected.length === plan.tasks.length &&
      plan.tasks.every((task) => {
        const entries = baseline.affected.filter(
          (entry) => entry.taskId === task.taskId,
        );
        const [entry] = entries;
        return (
          entries.length === 1 &&
          entry !== undefined &&
          matches(
            entry.observation,
            task.baselineVerification ?? task.affectedVerification,
          )
        );
      })
    );
  }

  #aggregateBaselineFactKey(resources: DurableExecutionResources): string {
    return `${this.baselineFactKey(resources)}-all-${hash(
      this.#originalBaselineRevisionId(resources),
      canonicalJson({
        tasks: resources.plan.tasks.map((task) => ({
          taskId: task.taskId,
          verification: task.baselineVerification ?? task.affectedVerification,
        })),
        fullSuite: resources.plan.verification.baseline.fullSuite,
      }),
    ).slice(0, 40)}`;
  }

  #baselineOwnerIdentity(
    resources: DurableExecutionResources,
    scope: "baseline-task-affected" | "baseline-full-suite",
    taskId?: string,
  ): string {
    if (scope === "baseline-full-suite") {
      if (taskId !== undefined)
        throw new Error("workflow-verification-baseline-failure-invalid");
      return hash("baseline-observation-owner-v1", "global");
    }
    if (!taskId)
      throw new Error("workflow-verification-baseline-failure-invalid");
    const tasks = resources.plan.tasks.filter((task) => task.taskId === taskId);
    const task = tasks[0];
    if (!task || tasks.length !== 1)
      throw new Error("workflow-verification-baseline-failure-invalid");
    return baselineRecoveryKey(task, "red");
  }

  #baselineObservationFactKey(
    resources: DurableExecutionResources,
    verification: StructuredVerificationContract,
    scope: "baseline-task-affected" | "baseline-full-suite",
    taskId?: string,
  ): string {
    return `${this.baselineFactKey(resources)}-o-${hash(
      this.#originalBaselineRevisionId(resources),
      verificationContractIdentity(verification),
      scope,
      this.#baselineOwnerIdentity(resources, scope, taskId),
    ).slice(0, 40)}`;
  }

  #baselineFailureFactKey(input: {
    resources: DurableExecutionResources;
    verification: StructuredVerificationContract;
    scope: "baseline-task-affected" | "baseline-full-suite";
    taskId?: string;
  }): string {
    return `verification-baseline-failure-${hash(
      this.#originalBaselineRevisionId(input.resources),
      verificationContractIdentity(input.verification),
      input.scope,
      this.#baselineOwnerIdentity(input.resources, input.scope, input.taskId),
      this.#observedEnvironmentIdentity(input.resources),
      this.#options.verificationPolicy ?? "legacy",
    ).slice(0, 40)}`;
  }

  #legacyBaselineFailureFactKey(input: {
    resources: DurableExecutionResources;
    verification: StructuredVerificationContract;
    scope: "baseline-task-affected" | "baseline-full-suite";
    taskId?: string;
  }): string {
    return `verification-baseline-failure-${hash(
      this.#originalBaselineRevisionId(input.resources),
      verificationContractIdentity(input.verification),
      input.scope,
      input.taskId ?? "global",
      this.#observedEnvironmentIdentity(input.resources),
      this.#options.verificationPolicy ?? "legacy",
    ).slice(0, 40)}`;
  }

  #projectBaselineFailure(
    code: string,
    observation: { path: string; kind: "absent" | "unsafe" } | undefined,
    input: {
      resources: DurableExecutionResources;
      verification: StructuredVerificationContract;
      scope: "baseline-task-affected" | "baseline-full-suite";
      taskId?: string;
    },
  ): Extract<DurableObservedVerification, { ok: false }> {
    const prerequisite: WorkflowVerificationPrerequisite = {
      kind: "verification-prerequisite",
      scope: input.scope,
      cause: BASELINE_CAPABILITY_CODES.has(code) ? "capability" : "unknown",
      verificationId: input.verification.id,
      contractIdentity: verificationContractIdentity(input.verification),
      originalRevisionId: this.#originalBaselineRevisionId(input.resources),
      environmentIdentity: this.#observedEnvironmentIdentity(input.resources),
      ...(input.taskId ? { taskId: input.taskId } : {}),
    };
    if (observation?.kind === "unsafe") {
      prerequisite.cause = "unsafe-input";
      prerequisite.input = observation;
    } else if (observation?.kind === "absent") {
      const outputs = input.resources.plan.outputs.filter(
        (output) => output.path === observation.path,
      );
      if (outputs.length > 1)
        throw new Error("workflow-verification-baseline-failure-invalid");
      prerequisite.cause =
        outputs.length === 1 ? "future-output" : "missing-input";
      prerequisite.input = observation;
      if (outputs[0])
        prerequisite.producer = structuredClone(outputs[0].producer);
    }
    return {
      ok: false,
      outcome: { kind: "paused", code, prerequisite },
    };
  }

  #storedBaselineFailure(
    value: unknown,
    input: {
      resources: DurableExecutionResources;
      verification: StructuredVerificationContract;
      scope: "baseline-task-affected" | "baseline-full-suite";
      taskId?: string;
    },
  ): Extract<DurableObservedVerification, { ok: false }> {
    if (!isRecord(value))
      throw new Error("workflow-verification-baseline-failure-invalid");
    const contractIdentity = verificationContractIdentity(input.verification);
    const originalRevisionId = this.#originalBaselineRevisionId(
      input.resources,
    );
    const environmentIdentity = this.#observedEnvironmentIdentity(
      input.resources,
    );
    const ownerIdentity = this.#baselineOwnerIdentity(
      input.resources,
      input.scope,
      input.taskId,
    );
    const declaredPaths = verificationInputPaths(input.verification);
    let observation: { path: string; kind: "absent" | "unsafe" } | undefined;
    if (value.kind === "baseline-observation-failure-v2") {
      if (
        !hasExactKeys(
          value,
          [
            "kind",
            "policyIdentity",
            "ownerIdentity",
            "scope",
            "contractIdentity",
            "originalRevisionId",
            "environmentIdentity",
            "code",
          ],
          ["observation"],
        ) ||
        value.policyIdentity !==
          hash(
            "verification-failure-policy-v2",
            this.#options.verificationPolicy ?? "legacy",
          ) ||
        value.ownerIdentity !== ownerIdentity ||
        value.scope !== input.scope ||
        value.contractIdentity !== contractIdentity ||
        value.originalRevisionId !== originalRevisionId ||
        value.environmentIdentity !== environmentIdentity
      ) {
        throw new Error("workflow-verification-baseline-failure-invalid");
      }
      if (value.observation !== undefined) {
        if (
          !isRecord(value.observation) ||
          !hasExactKeys(value.observation, ["path", "kind"]) ||
          typeof value.observation.path !== "string" ||
          !declaredPaths.includes(value.observation.path) ||
          !["absent", "unsafe"].includes(String(value.observation.kind))
        )
          throw new Error("workflow-verification-baseline-failure-invalid");
        observation = {
          path: value.observation.path,
          kind: value.observation.kind as "absent" | "unsafe",
        };
      }
    } else if (value.kind === "baseline-observation-failure-v1") {
      const prerequisite = value.prerequisite;
      if (
        !hasExactKeys(value, [
          "kind",
          "policyIdentity",
          "code",
          "prerequisite",
        ]) ||
        value.policyIdentity !==
          hash(
            "verification-failure-policy-v1",
            this.#options.verificationPolicy ?? "legacy",
          ) ||
        !isRecord(prerequisite) ||
        !hasExactKeys(
          prerequisite,
          [
            "kind",
            "scope",
            "cause",
            "verificationId",
            "contractIdentity",
            "originalRevisionId",
            "environmentIdentity",
          ],
          ["taskId", "input", "producer"],
        ) ||
        prerequisite.kind !== "verification-prerequisite" ||
        prerequisite.scope !== input.scope ||
        typeof prerequisite.verificationId !== "string" ||
        !IDENTIFIER.test(prerequisite.verificationId) ||
        prerequisite.contractIdentity !== contractIdentity ||
        prerequisite.originalRevisionId !== originalRevisionId ||
        prerequisite.environmentIdentity !== environmentIdentity ||
        prerequisite.taskId !== input.taskId ||
        ![
          "future-output",
          "missing-input",
          "unsafe-input",
          "capability",
          "unknown",
        ].includes(String(prerequisite.cause))
      )
        throw new Error("workflow-verification-baseline-failure-invalid");
      if (prerequisite.input !== undefined) {
        if (
          !isRecord(prerequisite.input) ||
          !hasExactKeys(prerequisite.input, ["path", "kind"]) ||
          typeof prerequisite.input.path !== "string" ||
          !declaredPaths.includes(prerequisite.input.path) ||
          !["absent", "unsafe"].includes(String(prerequisite.input.kind))
        )
          throw new Error("workflow-verification-baseline-failure-invalid");
        observation = {
          path: prerequisite.input.path,
          kind: prerequisite.input.kind as "absent" | "unsafe",
        };
      }
      const cause = String(prerequisite.cause);
      if (
        ((cause === "future-output" || cause === "missing-input") &&
          observation?.kind !== "absent") ||
        (cause === "unsafe-input" && observation?.kind !== "unsafe") ||
        ((cause === "capability" || cause === "unknown") &&
          (observation !== undefined ||
            prerequisite.producer !== undefined ||
            (cause === "capability") !==
              BASELINE_CAPABILITY_CODES.has(String(value.code))))
      )
        throw new Error("workflow-verification-baseline-failure-invalid");
      if (prerequisite.producer !== undefined) {
        if (
          cause !== "future-output" ||
          !isRecord(prerequisite.producer) ||
          !hasExactKeys(prerequisite.producer, ["taskId", "phase"]) ||
          typeof prerequisite.producer.taskId !== "string" ||
          !IDENTIFIER.test(prerequisite.producer.taskId) ||
          !["red", "green", "refactor"].includes(
            String(prerequisite.producer.phase),
          )
        )
          throw new Error("workflow-verification-baseline-failure-invalid");
      } else if (cause === "future-output") {
        throw new Error("workflow-verification-baseline-failure-invalid");
      }
    } else {
      throw new Error("workflow-verification-baseline-failure-invalid");
    }
    if (
      typeof value.code !== "string" ||
      value.code.length < 1 ||
      value.code.length > 256
    )
      throw new Error("workflow-verification-baseline-failure-invalid");
    return this.#projectBaselineFailure(value.code, observation, input);
  }

  async #captureBaselineObservation(input: {
    resources: DurableExecutionResources;
    ledger: TaskLedger;
    verification: StructuredVerificationContract;
    scope: "baseline-task-affected" | "baseline-full-suite";
    signal: AbortSignal;
    taskId?: string;
  }): Promise<DurableObservedVerification> {
    const contractIdentity = verificationContractIdentity(input.verification);
    const ledger = input.resources.baselineLedger ?? input.ledger;
    const factKey = this.#baselineObservationFactKey(
      input.resources,
      input.verification,
      input.scope,
      input.taskId,
    );
    const failureFactKey = this.#baselineFailureFactKey(input);
    const legacyFailureFactKey = this.#legacyBaselineFailureFactKey(input);
    const stored = ledger.durableFact(factKey);
    const storedFailures = [
      ledger.durableFact(failureFactKey),
      ledger.durableFact(legacyFailureFactKey),
      ...(input.ledger === ledger
        ? []
        : [input.ledger.durableFact(legacyFailureFactKey)]),
    ].filter((value) => value !== undefined);
    if (storedFailures.length > 1)
      throw new Error("workflow-verification-baseline-fact-conflict");
    const storedFailure = storedFailures[0];
    if (stored !== undefined && storedFailure !== undefined) {
      throw new Error("workflow-verification-baseline-fact-conflict");
    }
    if (stored !== undefined) {
      const baseline = parseVerificationBaseline(
        stored,
        input.resources.artifacts,
      );
      if (
        baseline.revisionId !==
        this.#originalBaselineRevisionId(input.resources)
      ) {
        throw new Error("workflow-verification-baseline-conflict");
      }
      if (
        baseline.fullSuite.contractIdentity !== contractIdentity ||
        baseline.targetContracts.length !== 0 ||
        baseline.affected.length !== 0
      ) {
        throw new Error("workflow-verification-baseline-conflict");
      }
      return {
        ok: true,
        observation: {
          ...baseline.fullSuite,
          verificationId: input.verification.id,
        },
      };
    }
    if (storedFailure !== undefined) {
      return this.#storedBaselineFailure(storedFailure, input);
    }
    const pendingKey = `baseline-observation:${factKey}`;
    let pending = input.resources.baselinePromises.get(pendingKey);
    if (!pending) {
      pending = this.#observeVerification({
        resources: input.resources,
        revisionId: this.#originalBaselineRevisionId(input.resources),
        scope: input.scope,
        verification: input.verification,
        ...(input.taskId ? { taskId: input.taskId } : {}),
        signal: input.signal,
      }).then(
        (observed): DurableBaselineResult =>
          observed.ok
            ? {
                ok: true,
                baseline: {
                  revisionId: this.#originalBaselineRevisionId(input.resources),
                  targetContracts: [],
                  affected: [],
                  fullSuite: observed.observation,
                },
              }
            : observed,
      );
      const owned = pending;
      pending = owned.then(
        (result) => {
          if (!result.ok) input.resources.baselinePromises.delete(pendingKey);
          return result;
        },
        (error: unknown) => {
          input.resources.baselinePromises.delete(pendingKey);
          throw error;
        },
      );
      input.resources.baselinePromises.set(pendingKey, pending);
    }
    const result = await pending;
    if (!result.ok) {
      if (result.outcome.kind === "paused") {
        if (!result.outcome.prerequisite) {
          throw new Error("workflow-verification-baseline-failure-invalid");
        }
        const prerequisite = result.outcome.prerequisite;
        const storedFact = ledger.putDurableFact(failureFactKey, {
          kind: "baseline-observation-failure-v2",
          policyIdentity: hash(
            "verification-failure-policy-v2",
            this.#options.verificationPolicy ?? "legacy",
          ),
          ownerIdentity: this.#baselineOwnerIdentity(
            input.resources,
            input.scope,
            input.taskId,
          ),
          scope: input.scope,
          contractIdentity,
          originalRevisionId: this.#originalBaselineRevisionId(input.resources),
          environmentIdentity: this.#observedEnvironmentIdentity(
            input.resources,
          ),
          code: result.outcome.code,
          ...(prerequisite.input
            ? { observation: structuredClone(prerequisite.input) }
            : {}),
        });
        return this.#storedBaselineFailure(storedFact, input);
      }
      return result;
    }
    const fact = verificationBaselineFact(
      result.baseline,
      input.resources.artifacts,
    );
    const storedFact = ledger.putDurableFact(factKey, fact);
    const baseline = parseVerificationBaseline(
      storedFact,
      input.resources.artifacts,
    );
    if (
      baseline.revisionId !==
        this.#originalBaselineRevisionId(input.resources) ||
      baseline.fullSuite.contractIdentity !== contractIdentity ||
      baseline.targetContracts.length !== 0 ||
      baseline.affected.length !== 0
    )
      throw new Error("workflow-verification-baseline-conflict");
    return {
      ok: true,
      observation: {
        ...baseline.fullSuite,
        verificationId: input.verification.id,
      },
    };
  }

  async ensureVerificationBaseline(input: {
    resources: DurableExecutionResources;
    ledger: TaskLedger;
    signal: AbortSignal;
    taskId?: string;
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
    return this.#captureVerificationBaseline(input);
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
    const comparable =
      typeof baseline.observation.contractIdentity === "string" &&
      baseline.observation.contractIdentity ===
        current.observation.contractIdentity;
    if (
      current.observation.attributionReliable === false &&
      baseline.observation.status === "failed"
    )
      return { kind: "paused", code: "verification-attribution-unresolved" };
    const prior = new Set(
      comparable ? baseline.observation.failureIdentities : [],
    );
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
          const comparable =
            typeof baseline.observation.contractIdentity === "string" &&
            baseline.observation.contractIdentity ===
              current.observation.contractIdentity;
          if (
            current.observation.attributionReliable === false &&
            baseline.observation.status === "failed"
          )
            return {
              kind: "paused",
              code: "verification-attribution-unresolved",
            };
          const prior = new Set(
            comparable ? baseline.observation.failureIdentities : [],
          );
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
        const comparable =
          typeof captured.baseline.fullSuite.contractIdentity === "string" &&
          captured.baseline.fullSuite.contractIdentity ===
            fullSuite.observation.contractIdentity;
        if (
          fullSuite.observation.attributionReliable === false &&
          captured.baseline.fullSuite.status === "failed"
        )
          return {
            kind: "paused",
            code: "verification-attribution-unresolved",
          };
        const baselineFailures = new Set(
          comparable ? captured.baseline.fullSuite.failureIdentities : [],
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
