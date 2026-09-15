import { compareCanonicalStrings } from "./canonical.ts";
import {
  isValidRelativePath,
  LIMITS,
  verificationInputPaths,
} from "./contracts.ts";
import type { ImplementPlan, PlanTaskDraft } from "./implement-plan.ts";
import { expandSingleTaskDraft } from "./single-task-draft.ts";
import { declarationPathsConflict, taskConflicts } from "./workflow-policy.ts";

/** Review data only: no executable callbacks, evidence cache or approval authority. */
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

type SerializationCause =
  | {
      kind: "producer-output" | "declared-dependency";
      waitingTaskId: string;
      dependencyTaskId: string;
      outputIds: string[];
    }
  | { kind: "declared-task-conflict" }
  | { kind: "declared-resource"; resources: string[] }
  | {
      kind: "shared-writes";
      paths: Array<{ left: string; right: string }>;
    }
  | {
      kind: "shared-write-read";
      paths: Array<{ writer: string; reader: string }>;
    }
  | { kind: "verification-lock"; locks: string[] }
  | { kind: "agents-target"; targets: string[] };

function taskAncestors(
  taskId: string,
  tasks: ReadonlyMap<string, PlanTaskDraft>,
): Set<string> {
  const ancestors = new Set<string>();
  const pending = [...(tasks.get(taskId)?.dependsOn ?? [])];
  while (pending.length > 0) {
    const dependency = pending.pop() as string;
    if (ancestors.has(dependency)) continue;
    ancestors.add(dependency);
    pending.push(...(tasks.get(dependency)?.dependsOn ?? []));
  }
  return ancestors;
}

function declarations(task: PlanTaskDraft) {
  const reads = new Set<string>();
  const writes = new Set<string>();
  const locks = new Set<string>();
  for (const phase of Object.values(task.phases)) {
    for (const entry of phase.read) reads.add(entry);
    for (const entry of phase.write) writes.add(entry);
    for (const entry of phase.delete) writes.add(entry);
    if (phase.verificationLock) locks.add(phase.verificationLock);
  }
  return {
    reads: [...reads].sort(compareCanonicalStrings),
    writes: [...writes].sort(compareCanonicalStrings),
    locks: [...locks].sort(compareCanonicalStrings),
  };
}

function conflictingPathPairs(
  left: readonly string[],
  right: readonly string[],
): Array<{ left: string; right: string }> {
  return left.flatMap((leftPath) =>
    right.flatMap((rightPath) =>
      declarationPathsConflict(leftPath, rightPath)
        ? [{ left: leftPath, right: rightPath }]
        : [],
    ),
  );
}

function conflictCauses(
  left: PlanTaskDraft,
  right: PlanTaskDraft,
  truncate: () => void,
): SerializationCause[] {
  const causes: SerializationCause[] = [];
  if (
    left.scheduling.conflicts.includes(right.taskId) ||
    right.scheduling.conflicts.includes(left.taskId)
  ) {
    causes.push({ kind: "declared-task-conflict" });
  }
  const resources = left.scheduling.resources
    .filter((resource) => right.scheduling.resources.includes(resource))
    .sort(compareCanonicalStrings);
  if (resources.length > 8) truncate();
  if (resources.length > 0) {
    causes.push({
      kind: "declared-resource",
      resources: resources.slice(0, 8),
    });
  }

  const leftDeclarations = declarations(left);
  const rightDeclarations = declarations(right);
  const sharedWrites = conflictingPathPairs(
    leftDeclarations.writes,
    rightDeclarations.writes,
  );
  const leftWriteReads = conflictingPathPairs(
    leftDeclarations.writes,
    rightDeclarations.reads,
  );
  const rightWriteReads = conflictingPathPairs(
    rightDeclarations.writes,
    leftDeclarations.reads,
  ).map(({ left: writer, right: reader }) => ({ writer, reader }));
  if (sharedWrites.length > 8) truncate();
  if (sharedWrites.length > 0) {
    causes.push({ kind: "shared-writes", paths: sharedWrites.slice(0, 8) });
  }
  const writeReads = [
    ...leftWriteReads.map(({ left: writer, right: reader }) => ({
      writer,
      reader,
    })),
    ...rightWriteReads,
  ];
  if (writeReads.length > 8) truncate();
  if (writeReads.length > 0) {
    causes.push({
      kind: "shared-write-read",
      paths: writeReads.slice(0, 8),
    });
  }
  if (
    left.agents.impact !== "none" &&
    right.agents.impact !== "none" &&
    left.agents.target &&
    left.agents.target === right.agents.target
  ) {
    causes.push({ kind: "agents-target", targets: [left.agents.target] });
  }
  const locks = leftDeclarations.locks
    .filter((lock) => rightDeclarations.locks.includes(lock))
    .sort(compareCanonicalStrings);
  if (locks.length > 8) truncate();
  if (locks.length > 0) {
    causes.push({ kind: "verification-lock", locks: locks.slice(0, 8) });
  }
  return causes;
}
export function planAuthoringSummary(
  plan: ImplementPlan,
  authoredDraft?: unknown,
) {
  const quick = record(authoredDraft).singleTask !== undefined;
  const authored = record(expandSingleTaskDraft(authoredDraft));
  const authoredTask = (taskId: string) =>
    record(
      Array.isArray(authored.tasks)
        ? authored.tasks.find((item) => record(item).taskId === taskId)
        : undefined,
    );
  const derivations: Array<{ field: string; source: string; taskId?: string }> =
    [];
  let derivationsTruncated = false;
  const derived = (field: string, source: string, taskId?: string) => {
    if (derivations.length >= 128) {
      derivationsTruncated = true;
      return;
    }
    derivations.push({ field, source, ...(taskId ? { taskId } : {}) });
  };
  if (quick) derived("singleTask", "single-task-author-input");
  if (authoredDraft !== undefined) {
    if (!Object.hasOwn(authored, "tracking")) derived("tracking", "task-ids");
    if (plan.changeContract && !Object.hasOwn(authored, "changeContract"))
      derived("changeContract", "approved-gate-a");
    for (const task of plan.tasks) {
      const input = authoredTask(task.taskId);
      if (
        task.baselineVerification &&
        !Object.hasOwn(input, "baselineVerification")
      ) {
        derived(
          "baselineVerification",
          "affected-safe-original-inputs",
          task.taskId,
        );
      }
      for (const [phase, boundary] of Object.entries(task.phases)) {
        const phaseInput = record(record(input.phases)[phase]);
        if (!Object.hasOwn(phaseInput, "verificationInputs"))
          derived(
            `phases.${phase}.verificationInputs`,
            "contract-and-declared-outputs",
            task.taskId,
          );
        if (Object.hasOwn(input, "read"))
          derived(
            `phases.${phase}.read`,
            "common-and-phase-reads",
            task.taskId,
          );
        const verification = record(phaseInput.verification);
        if (typeof verification.use === "string")
          derived(
            `phases.${phase}.verification`,
            `definition:${verification.use}`,
            task.taskId,
          );
        if (!Object.hasOwn(verification, "id"))
          derived(
            `phases.${phase}.verification.id`,
            "stable-task-purpose-command",
            task.taskId,
          );
        if (!Object.hasOwn(verification, "classification"))
          derived(
            `phases.${phase}.verification.classification`,
            boundary.verification.classification,
            task.taskId,
          );
      }
      const tests = record(input.impactClosure).relatedTests;
      if (
        Array.isArray(tests) &&
        tests.some((test) => !Object.hasOwn(record(test), "disposition"))
      )
        derived("impactClosure.relatedTests", "declared-writers", task.taskId);
      if (!Object.hasOwn(record(input.agents), "managedOnly"))
        derived("agents.managedOnly", "parent-managed-boundary", task.taskId);
    }
    const verification = record(authored.verification);
    for (const [group, keys] of [
      ["baseline", ["target", "affected", "failureIdentity"]],
      ["change", ["affected"]],
      [
        "repair",
        ["inBoundaryOnly", "approvalOnBoundaryExpansion", "attribution"],
      ],
    ] as const) {
      for (const key of keys)
        if (!Object.hasOwn(record(verification[group]), key))
          derived(`verification.${group}.${key}`, "fixed-execution-contract");
    }
    if (!Object.hasOwn(verification, "agentsCheckpoint"))
      derived("verification.agentsCheckpoint", "explicit-none-impacts");
  }
  let truncated = plan.tasks.length > 16;
  const paths = (values: readonly string[]) => {
    const safe = values.filter(isValidRelativePath);
    if (safe.length !== values.length || safe.length > 32) truncated = true;
    return safe.slice(0, 32);
  };
  const tasks = plan.tasks.slice(0, 16).map((task) => ({
    taskId: task.taskId,
    dependsOn: task.dependsOn.slice(0, 16),
    phases: Object.entries(task.phases).map(([phase, boundary]) => ({
      phase,
      read: paths(boundary.read),
      write: paths(boundary.write),
      delete: paths(boundary.delete),
      verificationId: boundary.verification.id,
      classification: boundary.verification.classification,
      verificationInputs: boundary.verificationInputs.slice(0, 32),
    })),
    baselineVerification: task.baselineVerification?.id ?? null,
    affectedVerification: task.affectedVerification.id,
    repairVerification: task.repairVerification.id,
    verificationSources: {
      baseline:
        authoredDraft === undefined
          ? "compiled-plan"
          : Object.hasOwn(authoredTask(task.taskId), "baselineVerification")
            ? "author-input"
            : task.baselineVerification
              ? "affected-safe-original-inputs"
              : "retained-legacy",
      affected: authoredDraft === undefined ? "compiled-plan" : "author-input",
      repair: authoredDraft === undefined ? "compiled-plan" : "author-input",
    },
    agentsImpact: task.agents.impact,
  }));
  if (
    plan.tasks.some(
      (task) =>
        task.dependsOn.length > 16 ||
        Object.values(task.phases).some(
          (phase) => phase.verificationInputs.length > 32,
        ),
    )
  )
    truncated = true;

  const projectedTasks = [...plan.tasks]
    .sort((left, right) => compareCanonicalStrings(left.taskId, right.taskId))
    .slice(0, 16);
  const tasksById = new Map(plan.tasks.map((task) => [task.taskId, task]));
  const ancestors = new Map(
    plan.tasks.map((task) => [
      task.taskId,
      taskAncestors(task.taskId, tasksById),
    ]),
  );
  const outputsById = new Map(
    plan.outputs.map((output) => [output.id, output]),
  );
  const consumedOutputsByTask = new Map<string, string[]>();
  const consumedOutputIds = (task: PlanTaskDraft) => {
    const cached = consumedOutputsByTask.get(task.taskId);
    if (cached) return cached;
    const ids = new Set(
      Object.values(task.phases).flatMap((phase) =>
        phase.verificationInputs.flatMap((binding) =>
          binding.kind === "output" ? [binding.outputId] : [],
        ),
      ),
    );
    const finalInputs = new Set([
      ...verificationInputPaths(task.affectedVerification),
      ...verificationInputPaths(task.repairVerification),
    ]);
    for (const output of plan.outputs) {
      if (finalInputs.has(output.path)) ids.add(output.id);
    }
    const consumed = [...ids].sort(compareCanonicalStrings);
    consumedOutputsByTask.set(task.taskId, consumed);
    return consumed;
  };
  const dependencyCause = (
    waitingTask: PlanTaskDraft,
    dependencyTaskId: string,
  ): Extract<
    SerializationCause,
    { kind: "producer-output" | "declared-dependency" }
  > => {
    const outputIds = consumedOutputIds(waitingTask).filter(
      (outputId) =>
        outputsById.get(outputId)?.producer.taskId === dependencyTaskId,
    );
    if (outputIds.length > 16) truncated = true;
    return {
      kind: outputIds.length > 0 ? "producer-output" : "declared-dependency",
      waitingTaskId: waitingTask.taskId,
      dependencyTaskId,
      outputIds: outputIds.slice(0, 16),
    };
  };
  const waiting: Array<{
    taskId: string;
    dependencyTaskId: string;
    reason: "producer-output" | "declared-dependency";
    outputIds: string[];
  }> = [];
  for (const task of projectedTasks) {
    for (const dependencyTaskId of [...task.dependsOn].sort(
      compareCanonicalStrings,
    )) {
      if (waiting.length >= 128) {
        truncated = true;
        break;
      }
      const cause = dependencyCause(task, dependencyTaskId);
      waiting.push({
        taskId: task.taskId,
        dependencyTaskId,
        reason: cause.kind,
        outputIds: cause.outputIds,
      });
    }
  }
  const staticEligiblePairs: Array<{ taskIds: [string, string] }> = [];
  const serializations: Array<{
    taskIds: [string, string];
    causes: SerializationCause[];
  }> = [];
  for (const [index, left] of projectedTasks.entries()) {
    for (const right of projectedTasks.slice(index + 1)) {
      const leftWaits = ancestors.get(left.taskId)?.has(right.taskId) ?? false;
      const rightWaits = ancestors.get(right.taskId)?.has(left.taskId) ?? false;
      const conflict = taskConflicts(left, right);
      if (
        !leftWaits &&
        !rightWaits &&
        !conflict.taskLifetime &&
        !conflict.verification
      ) {
        if (staticEligiblePairs.length < 64) {
          staticEligiblePairs.push({ taskIds: [left.taskId, right.taskId] });
        } else {
          truncated = true;
        }
        continue;
      }
      const causes: SerializationCause[] = [];
      if (leftWaits) causes.push(dependencyCause(left, right.taskId));
      if (rightWaits) causes.push(dependencyCause(right, left.taskId));
      if (conflict.taskLifetime || conflict.verification) {
        causes.push(...conflictCauses(left, right, () => (truncated = true)));
      }
      if (serializations.length < 64) {
        serializations.push({ taskIds: [left.taskId, right.taskId], causes });
      } else {
        truncated = true;
      }
    }
  }
  const initiallyEligibleTasks = projectedTasks.filter(
    (task) => task.dependsOn.length === 0,
  );
  const initiallyRunnableTasks: PlanTaskDraft[] = [];
  for (const task of initiallyEligibleTasks) {
    if (initiallyRunnableTasks.length >= LIMITS.maxActiveChildSessions) break;
    if (
      initiallyRunnableTasks.some((selected) => {
        const conflict = taskConflicts(task, selected);
        return conflict.taskLifetime || conflict.verification;
      })
    ) {
      continue;
    }
    initiallyRunnableTasks.push(task);
  }
  const checkpoint = plan.verification.agentsCheckpoint;
  return {
    tasks,
    parallelism: {
      assessment: "static-plan" as const,
      authority: "review-only" as const,
      runtimePrerequisites: "not-assessed" as const,
      initiallyEligibleScope: "individual-dependency-free" as const,
      initiallyEligible: initiallyEligibleTasks.map((task) => task.taskId),
      initiallyRunnableGroup: {
        taskIds: initiallyRunnableTasks.map((task) => task.taskId),
        maximumSize: LIMITS.maxActiveChildSessions,
        basis: "dependency-free-task-conflict-policy" as const,
        capacityAssumption: "all-shared-slots-available" as const,
      },
      staticEligiblePairsScope: "eventual-compatibility" as const,
      staticEligiblePairs,
      waiting,
      serializations,
      globalBarriers: [
        {
          kind: "cumulative-verification" as const,
          required: true,
          verificationId: plan.verification.change.fullSuite.id,
          requires: ["all-tasks-verified" as const],
          taskIds: projectedTasks.map((task) => task.taskId),
        },
        {
          kind: "agents-checkpoint" as const,
          required: checkpoint.required,
          verificationId: checkpoint.verification?.id ?? null,
          requires: ["cumulative-verification" as const],
        },
        {
          kind: "post-apply-verification" as const,
          required: true,
          verificationId: plan.verification.change.postApply.id,
          requires: [
            "cumulative-verification" as const,
            ...(checkpoint.required
              ? (["agents-checkpoint" as const] as const)
              : []),
            "transactional-apply" as const,
          ],
        },
      ],
    },
    recovery: {
      artifactCorrection: plan.verification.artifactCorrection.maxAttempts,
      repair: plan.verification.repair.maxAttempts,
    },
    verifications: {
      baseline: plan.verification.baseline.fullSuite.id,
      fullSuite: plan.verification.change.fullSuite.id,
      postApply: plan.verification.change.postApply.id,
    },
    derivations,
    derivationRules: [
      "tracking:task-ids",
      "verificationInputs:contract-and-declared-outputs",
      "baselineVerification:affected-safe-original-inputs",
      "relatedTests:declared-writers",
      "verification-identities:stable-task-and-purpose",
    ],
    truncated: truncated || derivationsTruncated,
  };
}
