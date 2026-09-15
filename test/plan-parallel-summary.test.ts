import { describe, expect, it } from "vitest";

import type { PlanTaskDraft } from "../src/implement-plan.ts";
import { planAuthoringSummary } from "../src/plan-draft-summary.ts";
import { verificationFixturePlan } from "./helpers/verification-plan.ts";

function fixture() {
  const { plan, check } = verificationFixturePlan("parallel-summary");
  const template = plan.tasks[0]!;
  const task = (taskId: string): PlanTaskDraft => {
    const value = structuredClone(template);
    value.taskId = taskId;
    value.dependsOn = [];
    value.phases.red.read = ["test/regression.mjs"];
    value.phases.red.write = [`src/${taskId}-red.ts`];
    value.phases.green.read = ["test/regression.mjs"];
    value.phases.green.write = [`src/${taskId}-green.ts`];
    value.phases.red.verification.id = `${taskId}-red`;
    value.phases.green.verification.id = `${taskId}-green`;
    value.phases.red.verificationInputs = [
      { kind: "workspace", path: "test/regression.mjs" },
    ];
    value.phases.green.verificationInputs = [
      { kind: "workspace", path: "test/regression.mjs" },
    ];
    delete value.phases.red.verificationLock;
    delete value.phases.green.verificationLock;
    value.baselineVerification = check(
      `${taskId}-baseline`,
      "test/regression.mjs",
    );
    value.affectedVerification = check(
      `${taskId}-affected`,
      "test/regression.mjs",
    );
    value.repairVerification = check(`${taskId}-repair`, "test/regression.mjs");
    value.scheduling = { conflicts: [], resources: [] };
    value.agents = { impact: "none", managedOnly: true };
    value.impactClosure = {
      changedSurfaces: ["none"],
      searchEvidence: [],
      relatedTests: [],
      affectedSuite: [],
    };
    return value;
  };
  return { plan, task, check };
}

function serialization(
  summary: ReturnType<typeof planAuthoringSummary>,
  left: string,
  right: string,
) {
  return summary.parallelism.serializations.find(
    (entry) => entry.taskIds.includes(left) && entry.taskIds.includes(right),
  );
}

describe("bounded plan parallelism summary", () => {
  it("projects dependency-free pairs, producer waits, declared dependencies, and shared path serialization", () => {
    const { plan, task, check } = fixture();
    const producer = task("producer");
    producer.phases.green.write = ["src/producer-api.ts"];
    const independent = task("independent");
    independent.phases.green.write = ["src/shared.ts"];
    const conflict = task("conflict");
    conflict.phases.red.read.push("src/shared.ts");
    conflict.phases.green.write = ["src/shared.ts"];
    const consumer = task("consumer");
    consumer.dependsOn = ["producer"];
    for (const [phase, classification] of [
      ["red", "expected-red"],
      ["green", "expected-green"],
    ] as const) {
      consumer.phases[phase].read = ["src/producer-api.ts"];
      consumer.phases[phase].verification = check(
        `consumer-${phase}`,
        "src/producer-api.ts",
        classification,
      );
      consumer.phases[phase].verificationInputs = [
        { kind: "output", outputId: "producer-api" },
      ];
    }
    consumer.affectedVerification = check(
      "consumer-affected",
      "src/producer-api.ts",
    );
    consumer.repairVerification = check(
      "consumer-repair",
      "src/producer-api.ts",
    );
    const declared = task("declared");
    declared.dependsOn = ["independent"];
    plan.tasks = [producer, independent, conflict, consumer, declared];
    plan.outputs = [
      {
        id: "producer-api",
        path: "src/producer-api.ts",
        producer: { taskId: "producer", phase: "green" },
        postcondition: "regular-file",
      },
    ];
    plan.tracking.taskIds = plan.tasks.map((entry) => entry.taskId);
    const authored = structuredClone(plan);
    delete authored.tasks[0]!.baselineVerification;

    const summary = planAuthoringSummary(plan, authored);

    expect(summary.parallelism).toMatchObject({
      assessment: "static-plan",
      authority: "review-only",
      runtimePrerequisites: "not-assessed",
      initiallyEligibleScope: "individual-dependency-free",
      initiallyEligible: expect.arrayContaining([
        "producer",
        "independent",
        "conflict",
      ]),
      initiallyRunnableGroup: {
        taskIds: ["conflict", "producer"],
        maximumSize: 4,
        basis: "dependency-free-task-conflict-policy",
        capacityAssumption: "all-shared-slots-available",
      },
      staticEligiblePairsScope: "eventual-compatibility",
      staticEligiblePairs: expect.arrayContaining([
        { taskIds: ["independent", "producer"] },
      ]),
      waiting: expect.arrayContaining([
        {
          taskId: "consumer",
          dependencyTaskId: "producer",
          reason: "producer-output",
          outputIds: ["producer-api"],
        },
        {
          taskId: "declared",
          dependencyTaskId: "independent",
          reason: "declared-dependency",
          outputIds: [],
        },
      ]),
    });
    expect(serialization(summary, "conflict", "independent")?.causes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "shared-writes" }),
        expect.objectContaining({ kind: "shared-write-read" }),
      ]),
    );
    expect(
      serialization(summary, "consumer", "producer")?.causes,
    ).toContainEqual(
      expect.objectContaining({
        kind: "producer-output",
        waitingTaskId: "consumer",
        dependencyTaskId: "producer",
        outputIds: ["producer-api"],
      }),
    );
    expect(
      serialization(summary, "declared", "independent")?.causes,
    ).toContainEqual(
      expect.objectContaining({
        kind: "declared-dependency",
        waitingTaskId: "declared",
        dependencyTaskId: "independent",
      }),
    );
    expect(
      summary.tasks.find((entry) => entry.taskId === "producer"),
    ).toMatchObject({
      baselineVerification: "producer-baseline",
      affectedVerification: "producer-affected",
      repairVerification: "producer-repair",
      verificationSources: {
        baseline: "affected-safe-original-inputs",
        affected: "author-input",
        repair: "author-input",
      },
    });
    expect(summary.derivations).toContainEqual({
      taskId: "producer",
      field: "baselineVerification",
      source: "affected-safe-original-inputs",
    });
  });

  it("names declared resource, verification lock, AGENTS, and explicit conflict causes", () => {
    const { plan, task } = fixture();
    const resourceLeft = task("resource-left");
    const resourceRight = task("resource-right");
    resourceLeft.scheduling.resources = ["database"];
    resourceRight.scheduling.resources = ["database"];
    const lockLeft = task("lock-left");
    const lockRight = task("lock-right");
    lockLeft.phases.green.verificationLock = "suite-lock";
    lockRight.phases.red.verificationLock = "suite-lock";
    const agentsLeft = task("agents-left");
    const agentsRight = task("agents-right");
    agentsLeft.agents = {
      impact: "update-existing",
      target: "AGENTS.md",
      managedOnly: true,
    };
    agentsRight.agents = structuredClone(agentsLeft.agents);
    const explicitLeft = task("explicit-left");
    const explicitRight = task("explicit-right");
    explicitLeft.scheduling.conflicts = ["explicit-right"];
    plan.tasks = [
      resourceLeft,
      resourceRight,
      lockLeft,
      lockRight,
      agentsLeft,
      agentsRight,
      explicitLeft,
      explicitRight,
    ];

    const summary = planAuthoringSummary(plan, plan);

    expect(
      serialization(summary, "resource-left", "resource-right")?.causes,
    ).toContainEqual({ kind: "declared-resource", resources: ["database"] });
    expect(
      serialization(summary, "lock-left", "lock-right")?.causes,
    ).toContainEqual({ kind: "verification-lock", locks: ["suite-lock"] });
    expect(
      serialization(summary, "agents-left", "agents-right")?.causes,
    ).toContainEqual({ kind: "agents-target", targets: ["AGENTS.md"] });
    expect(
      serialization(summary, "explicit-left", "explicit-right")?.causes,
    ).toContainEqual({ kind: "declared-task-conflict" });
  });

  it("bounds task and pair projections without exposing objective or context text", () => {
    const { plan, task } = fixture();
    plan.tasks = Array.from({ length: 20 }, (_, index) => {
      const value = task(`task-${index}`);
      value.objective = `private-objective-${index}`;
      value.context = {
        agents: `private-agent-context-${index}`,
        contract: `private-contract-text-${index}`,
      };
      return value;
    });

    const summary = planAuthoringSummary(plan, plan);
    const serialized = JSON.stringify(summary);

    expect(summary.tasks).toHaveLength(16);
    expect(summary.parallelism.staticEligiblePairs.length).toBeLessThanOrEqual(
      64,
    );
    expect(summary.parallelism.serializations.length).toBeLessThanOrEqual(64);
    expect(summary.truncated).toBe(true);
    expect(serialized).not.toContain("private-objective");
    expect(serialized).not.toContain("private-contract-text");
    expect(serialized).not.toContain("private-agent-context");
  });

  it("selects one deterministic conflict-free initial group within shared capacity", () => {
    const { plan, task } = fixture();
    const alpha = task("alpha");
    const beta = task("beta");
    const charlie = task("charlie");
    const delta = task("delta");
    const echo = task("echo");
    const foxtrot = task("foxtrot");
    alpha.scheduling.conflicts = ["beta"];
    beta.scheduling.conflicts = ["alpha"];
    plan.tasks = [foxtrot, echo, delta, charlie, beta, alpha];

    const summary = planAuthoringSummary(plan, plan);

    expect(summary.parallelism.initiallyEligible).toEqual([
      "alpha",
      "beta",
      "charlie",
      "delta",
      "echo",
      "foxtrot",
    ]);
    expect(summary.parallelism.initiallyRunnableGroup).toEqual({
      taskIds: ["alpha", "charlie", "delta", "echo"],
      maximumSize: 4,
      basis: "dependency-free-task-conflict-policy",
      capacityAssumption: "all-shared-slots-available",
    });
  });

  it("reports every simultaneous serialization cause for a task pair", () => {
    const { plan, task } = fixture();
    const left = task("left");
    const right = task("right");
    left.scheduling = { conflicts: ["right"], resources: ["database"] };
    right.scheduling = { conflicts: ["left"], resources: ["database"] };
    left.phases.red.write = ["src/shared.ts"];
    left.phases.green.verificationLock = "suite-lock";
    right.phases.red.read.push("src/shared.ts");
    right.phases.green.write = ["src/shared.ts"];
    right.phases.red.verificationLock = "suite-lock";
    left.agents = {
      impact: "update-existing",
      target: "AGENTS.md",
      managedOnly: true,
    };
    right.agents = structuredClone(left.agents);
    plan.tasks = [right, left];

    const summary = planAuthoringSummary(plan, plan);

    expect(serialization(summary, "left", "right")?.causes).toEqual(
      expect.arrayContaining([
        { kind: "declared-task-conflict" },
        { kind: "declared-resource", resources: ["database"] },
        expect.objectContaining({ kind: "shared-writes" }),
        expect.objectContaining({ kind: "shared-write-read" }),
        { kind: "agents-target", targets: ["AGENTS.md"] },
        { kind: "verification-lock", locks: ["suite-lock"] },
      ]),
    );
  });

  it("separates eventual compatibility from initial readiness and exposes global barriers", () => {
    const { plan, task, check } = fixture();
    const producer = task("producer");
    const firstConsumer = task("first-consumer");
    const secondConsumer = task("second-consumer");
    firstConsumer.dependsOn = ["producer"];
    secondConsumer.dependsOn = ["producer"];
    plan.tasks = [secondConsumer, producer, firstConsumer];
    plan.verification.change.fullSuite = check(
      "cumulative-suite",
      "test/regression.mjs",
    );
    plan.verification.agentsCheckpoint = {
      required: true,
      verification: check("agents-checkpoint", "test/regression.mjs"),
      operations: [],
    };
    plan.verification.change.postApply = check(
      "post-apply-suite",
      "test/regression.mjs",
    );

    const summary = planAuthoringSummary(plan, plan);

    expect(summary.parallelism.initiallyRunnableGroup.taskIds).toEqual([
      "producer",
    ]);
    expect(summary.parallelism.staticEligiblePairsScope).toBe(
      "eventual-compatibility",
    );
    expect(summary.parallelism.staticEligiblePairs).toContainEqual({
      taskIds: ["first-consumer", "second-consumer"],
    });
    expect(summary.parallelism.globalBarriers).toEqual([
      {
        kind: "cumulative-verification",
        required: true,
        verificationId: "cumulative-suite",
        requires: ["all-tasks-verified"],
        taskIds: ["first-consumer", "producer", "second-consumer"],
      },
      {
        kind: "agents-checkpoint",
        required: true,
        verificationId: "agents-checkpoint",
        requires: ["cumulative-verification"],
      },
      {
        kind: "post-apply-verification",
        required: true,
        verificationId: "post-apply-suite",
        requires: [
          "cumulative-verification",
          "agents-checkpoint",
          "transactional-apply",
        ],
      },
    ]);
  });
});
