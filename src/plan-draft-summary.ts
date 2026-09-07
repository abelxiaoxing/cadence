import { isValidRelativePath } from "./contracts.ts";
import type { ImplementPlan } from "./implement-plan.ts";

/** Review data only: no executable callbacks, evidence cache or approval authority. */
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function planAuthoringSummary(
  plan: ImplementPlan,
  authoredDraft?: unknown,
) {
  const authored = record(authoredDraft);
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
  if (authoredDraft !== undefined) {
    if (!Object.hasOwn(authored, "tracking")) derived("tracking", "task-ids");
    if (plan.changeContract && !Object.hasOwn(authored, "changeContract"))
      derived("changeContract", "approved-gate-a");
    for (const task of plan.tasks) {
      const input = record(
        Array.isArray(authored.tasks)
          ? authored.tasks.find((item) => record(item).taskId === task.taskId)
          : undefined,
      );
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
    affectedVerification: task.affectedVerification.id,
    repairVerification: task.repairVerification.id,
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
  return {
    tasks,
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
      "relatedTests:declared-writers",
      "verification-identities:stable-task-and-purpose",
    ],
    truncated: truncated || derivationsTruncated,
  };
}
