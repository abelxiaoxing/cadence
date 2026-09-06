import type { AtomicVerificationContract } from "../../src/contracts.ts";
import type { ImplementPlan } from "../../src/delivery-compiler.ts";
export function verificationFixturePlan(change: string) {
  const check = (
    id: string,
    script: string,
    classification: "expected-red" | "expected-green" = "expected-green",
  ): AtomicVerificationContract => ({
    kind: "static-check",
    id,
    runner: { kind: "node", script },
    args: [],
    classification,
    ...(classification === "expected-red"
      ? { expectedFailure: "real-regression" }
      : {}),
  });
  const phase = (name: "red" | "green") => ({
    read: [
      "package.json",
      "test/regression.mjs",
      "test/health.mjs",
      "value.txt",
    ],
    write: [name === "red" ? "test/regression.mjs" : "value.txt"],
    delete: [],
    verification: check(
      `real-${name}`,
      "test/regression.mjs",
      name === "red" ? "expected-red" : "expected-green",
    ),
    verificationInputs: [
      { kind: "workspace" as const, path: "test/regression.mjs" },
    ],
    verificationLock: "real-check",
  });
  const plan: ImplementPlan = {
    changeId: change,
    tasks: [
      {
        taskId: "real-task",
        dependsOn: [],
        objective: "Make the regression pass",
        context: { agents: "root", contract: "approved fixture" },
        roots: ["."],
        phases: { red: phase("red"), green: phase("green") },
        affectedVerification: check("real-affected", "test/regression.mjs"),
        repairVerification: check("real-repair", "test/regression.mjs"),
        scheduling: { conflicts: [], resources: ["real-value"] },
        agents: { impact: "none", managedOnly: true },
        approvedDependencies: [],
        impactClosure: {
          changedSurfaces: ["none"],
          searchEvidence: [],
          relatedTests: [
            {
              path: "test/regression.mjs",
              disposition: "current-task",
              evidence: "regression fixture",
            },
          ],
          affectedSuite: ["test/regression.mjs"],
        },
      },
    ],
    outputs: [],
    verification: {
      baseline: {
        target: "task-red-contracts",
        affected: "task-affected-contracts",
        fullSuite: check("real-baseline", "test/health.mjs"),
        failureIdentity: "normalized",
      },
      change: {
        affected: "task-affected-contracts",
        fullSuite: check("real-full", "test/regression.mjs"),
        postApply: check("real-post", "test/regression.mjs"),
      },
      artifactCorrection: { maxAttempts: 2 },
      repair: {
        maxAttempts: 1,
        inBoundaryOnly: true,
        approvalOnBoundaryExpansion: true,
        attribution: [
          "pre-existing",
          "introduced",
          "unresolved",
          "environment",
        ],
      },
      agentsCheckpoint: {
        required: false,
        verification: null,
        operations: [],
      },
    },
    tracking: {
      path: "tasks.md",
      format: "markdown-checkbox",
      taskIds: ["real-task"],
      completionOwner: "parent",
    },
  };

  return { plan, check };
}
