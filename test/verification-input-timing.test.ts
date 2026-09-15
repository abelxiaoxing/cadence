import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  compileImplementPlan,
  DesignPlanValidationError,
  parseImplementPlan,
} from "../src/delivery-compiler.ts";
import { canonicalJson } from "../src/implement-graph.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function workspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), "cadence-input-timing-"));
  roots.push(root);
  mkdirSync(path.join(root, "src"));
  mkdirSync(path.join(root, "test"));
  writeFileSync(path.join(root, "package.json"), '{"type":"module"}\n');
  writeFileSync(path.join(root, "test/baseline.mjs"), "export {};\n");
  writeFileSync(path.join(root, "test/existing.mjs"), "export {};\n");
  return root;
}

function verification(
  id: string,
  script: string,
  classification: "expected-red" | "expected-green" | "expected-refactor",
): Record<string, unknown> {
  return {
    kind: "static-check" as const,
    id,
    runner: { kind: "node" as const, script },
    args: [],
    classification,
    ...(classification === "expected-red"
      ? { expectedFailure: "planned regression" }
      : {}),
  };
}

function verificationGroup(
  id: string,
  scripts: string[],
): Record<string, unknown> {
  return {
    kind: "steps",
    id,
    classification: "expected-green",
    steps: scripts.map((script, index) =>
      verification(`${id}-${index}`, script, "expected-green"),
    ),
  };
}

function phase(
  id: string,
  script: string,
  classification: "expected-red" | "expected-green" | "expected-refactor",
  options: {
    read?: string[];
    write?: string[];
    deletions?: string[];
    source?: Record<string, unknown>;
  } = {},
): Record<string, unknown> {
  return {
    read: options.read ?? [],
    write: options.write ?? [],
    delete: options.deletions ?? [],
    verification: verification(id, script, classification),
    verificationInputs: [options.source ?? { kind: "workspace", path: script }],
  };
}

function task(
  taskId: string,
  testPath: string,
  options: {
    dependsOn?: string[];
    outputId?: string;
    originalTest?: boolean;
  } = {},
): any {
  const source = options.outputId
    ? { kind: "output", outputId: options.outputId }
    : { kind: "workspace", path: testPath };
  return {
    taskId,
    dependsOn: options.dependsOn ?? [],
    objective: `Implement ${taskId}`,
    context: { agents: "root", contract: "approved input timing" },
    roots: ["."],
    phases: {
      red: phase(`${taskId}-red`, testPath, "expected-red", {
        ...(options.originalTest ? { read: [testPath] } : {}),
        write: [testPath],
        source,
      }),
      green: phase(`${taskId}-green`, testPath, "expected-green", {
        read: [testPath],
        write: [`src/${taskId}.ts`],
        source,
      }),
    },
    baselineVerification: verification(
      `${taskId}-baseline`,
      "test/baseline.mjs",
      "expected-green",
    ),
    affectedVerification: verification(
      `${taskId}-affected`,
      testPath,
      "expected-green",
    ),
    repairVerification: verification(
      `${taskId}-repair`,
      testPath,
      "expected-green",
    ),
    scheduling: { conflicts: [], resources: [] },
    agents: { impact: "none" as const, managedOnly: true as const },
    approvedDependencies: [],
    impactClosure: {
      changedSurfaces: ["none" as const],
      searchEvidence: [],
      relatedTests: [],
      affectedSuite: [],
    },
  };
}

function plan(testPath = "test/future.mjs"): any {
  const outputId = "future-test";
  const owner = task("owner", testPath, { outputId });
  return {
    changeId: "verification-input-timing",
    tasks: [owner],
    outputs: [
      {
        id: outputId,
        path: testPath,
        producer: { taskId: owner.taskId, phase: "red" as const },
        postcondition: "regular-file" as const,
      },
    ],
    verification: {
      baseline: {
        target: "task-red-contracts" as const,
        affected: "task-affected-contracts" as const,
        fullSuite: verification(
          "global-baseline",
          "test/baseline.mjs",
          "expected-green",
        ),
        failureIdentity: "normalized" as const,
      },
      change: {
        affected: "task-affected-contracts" as const,
        fullSuite: verification(
          "global-full-suite",
          testPath,
          "expected-green",
        ),
        postApply: verification(
          "global-post-apply",
          testPath,
          "expected-green",
        ),
      },
      artifactCorrection: { maxAttempts: 2 },
      repair: {
        maxAttempts: 1,
        inBoundaryOnly: true as const,
        approvalOnBoundaryExpansion: true as const,
        attribution: [
          "pre-existing",
          "introduced",
          "unresolved",
          "environment",
        ] as const,
      },
      agentsCheckpoint: {
        required: false as const,
        verification: null,
        operations: [],
      },
    },
    tracking: {
      path: "tasks.md" as const,
      format: "markdown-checkbox" as const,
      taskIds: [owner.taskId],
      completionOwner: "parent" as const,
    },
  };
}

function diagnostics(value: unknown, root: string) {
  try {
    compileImplementPlan(value, { consumerRoot: root });
  } catch (error) {
    expect(error).toBeInstanceOf(DesignPlanValidationError);
    return (error as DesignPlanValidationError).diagnostics;
  }
  throw new Error("expected compilation to fail");
}

describe("verification input timing", () => {
  it("derives an original baseline only from safe affected inputs, including files modified later", () => {
    const root = workspace();
    const draft = plan("test/existing.mjs");
    delete draft.tasks[0].baselineVerification;

    const compiled = compileImplementPlan(draft, { consumerRoot: root });

    expect(compiled.plan.tasks[0]?.baselineVerification).toEqual(
      compiled.plan.tasks[0]?.affectedVerification,
    );

    mkdirSync(path.join(root, "test/not-a-file.mjs"));
    const unsafe = plan("test/not-a-file.mjs");
    delete unsafe.tasks[0].baselineVerification;
    expect(diagnostics(unsafe, root)).toContainEqual(
      expect.objectContaining({
        code: "workspace-input-unavailable",
        field: "baselineVerification",
        path: "test/not-a-file.mjs",
      }),
    );
  });

  it("keeps a future Red test out of the original task and full-suite baselines", () => {
    const root = workspace();
    const missingTaskBaseline = plan();
    delete missingTaskBaseline.tasks[0].baselineVerification;
    expect(diagnostics(missingTaskBaseline, root)).toContainEqual(
      expect.objectContaining({
        code: "workspace-input-unavailable",
        taskId: "owner",
        field: "baselineVerification",
        path: "test/future.mjs",
      }),
    );

    const futureTaskBaseline = plan();
    futureTaskBaseline.tasks[0].baselineVerification = verification(
      "invalid-task-baseline",
      "test/future.mjs",
      "expected-green",
    );
    expect(diagnostics(futureTaskBaseline, root)).toContainEqual(
      expect.objectContaining({
        code: "workspace-input-unavailable",
        taskId: "owner",
        field: "baselineVerification",
        path: "test/future.mjs",
      }),
    );

    const futureGlobalBaseline = plan();
    futureGlobalBaseline.verification.baseline.fullSuite = verification(
      "invalid-global-baseline",
      "test/future.mjs",
      "expected-green",
    );
    expect(diagnostics(futureGlobalBaseline, root)).toContainEqual(
      expect.objectContaining({
        code: "workspace-input-unavailable",
        field: "verification.baseline.fullSuite",
        path: "test/future.mjs",
      }),
    );

    const compiled = compileImplementPlan(plan(), { consumerRoot: root });
    expect(compiled.plan.tasks[0]?.baselineVerification).toMatchObject({
      runner: { script: "test/baseline.mjs" },
    });
    expect(compiled.plan.tasks[0]?.affectedVerification).toMatchObject({
      runner: { script: "test/future.mjs" },
    });
    expect(compiled.plan.verification.change.fullSuite).toMatchObject({
      runner: { script: "test/future.mjs" },
    });
    expect(compiled.plan.verification.change.postApply).toMatchObject({
      runner: { script: "test/future.mjs" },
    });
  });

  it("preserves retained canonical plans that predate task baselines", () => {
    const root = workspace();
    const compiled = compileImplementPlan(plan(), { consumerRoot: root });
    const old = structuredClone(compiled.plan);
    delete old.tasks[0]?.baselineVerification;
    const bytes = Buffer.from(`${canonicalJson(old)}\n`);

    const parsed = parseImplementPlan(bytes);

    expect(parsed.tasks[0]).not.toHaveProperty("baselineVerification");
    expect(Buffer.from(`${canonicalJson(parsed)}\n`)).toEqual(bytes);
  });

  it("keeps every new test in its producing phase, affected repair, cumulative, and final checks", () => {
    const root = workspace();
    const cases: Array<[string, (draft: any) => void]> = [
      [
        "phases.red.verification",
        (draft) => {
          draft.tasks[0].phases.red = phase(
            "owner-red",
            "test/baseline.mjs",
            "expected-red",
            {
              read: ["test/baseline.mjs"],
              write: ["test/future.mjs"],
            },
          );
        },
      ],
      [
        "affectedVerification",
        (draft) => {
          draft.tasks[0].affectedVerification = verification(
            "owner-affected",
            "test/baseline.mjs",
            "expected-green",
          );
        },
      ],
      [
        "phases.green.verification",
        (draft) => {
          draft.tasks[0].phases.green = phase(
            "owner-green",
            "test/baseline.mjs",
            "expected-green",
            {
              read: ["test/baseline.mjs"],
              write: ["src/owner.ts"],
            },
          );
        },
      ],
      [
        "repairVerification",
        (draft) => {
          draft.tasks[0].repairVerification = verification(
            "owner-repair",
            "test/baseline.mjs",
            "expected-green",
          );
        },
      ],
      [
        "verification.change.fullSuite",
        (draft) => {
          draft.verification.change.fullSuite = verification(
            "global-full-suite",
            "test/baseline.mjs",
            "expected-green",
          );
        },
      ],
      [
        "verification.change.postApply",
        (draft) => {
          draft.verification.change.postApply = verification(
            "global-post-apply",
            "test/baseline.mjs",
            "expected-green",
          );
        },
      ],
    ];

    for (const [field, mutate] of cases) {
      const draft = plan();
      mutate(draft);
      expect(diagnostics(draft, root)).toContainEqual(
        expect.objectContaining({
          code: "verification-input-binding-mismatch",
          field,
          path: "test/future.mjs",
        }),
      );
    }
  });

  it.each([
    ["cumulative", "verification.change.postApply"],
    ["post-apply", "verification.change.fullSuite"],
    ["checkpoint", "verification.change.fullSuite"],
  ] as const)(
    "retains a new verification entrypoint identified only by %s verification",
    (source, additionallyMissing) => {
      const root = workspace();
      const draft = plan();
      draft.tasks[0].phases.red = phase(
        "owner-red-existing",
        "test/baseline.mjs",
        "expected-red",
        {
          read: ["test/baseline.mjs"],
          write: ["test/future.mjs"],
        },
      );
      draft.tasks[0].phases.green = phase(
        "owner-green-existing",
        "test/baseline.mjs",
        "expected-green",
        {
          read: ["test/baseline.mjs"],
          write: ["src/owner.ts"],
        },
      );
      draft.tasks[0].affectedVerification = verification(
        "owner-affected-existing",
        "test/baseline.mjs",
        "expected-green",
      );
      draft.tasks[0].repairVerification = verification(
        "owner-repair-existing",
        "test/baseline.mjs",
        "expected-green",
      );
      draft.verification.change.fullSuite = verification(
        "global-full-suite",
        source === "cumulative" ? "test/future.mjs" : "test/baseline.mjs",
        "expected-green",
      );
      draft.verification.change.postApply = verification(
        "global-post-apply",
        source === "post-apply" ? "test/future.mjs" : "test/baseline.mjs",
        "expected-green",
      );
      if (source === "checkpoint") {
        draft.tasks[0].agents = {
          impact: "create-index",
          target: "AGENTS.md",
          managedOnly: true,
        };
        draft.verification.agentsCheckpoint = {
          required: true,
          verification: verification(
            "agents-checkpoint",
            "test/future.mjs",
            "expected-green",
          ),
          operations: [
            {
              target: "AGENTS.md",
              impact: "create-index",
              taskIds: ["owner"],
              managedBlock:
                "<!-- ABEL:AGENTS-INDEX:START -->\n- managed\n<!-- ABEL:AGENTS-INDEX:END -->",
            },
          ],
        };
      }

      const missingFields = diagnostics(draft, root)
        .filter(
          (entry) =>
            entry.code === "verification-input-binding-mismatch" &&
            entry.path === "test/future.mjs",
        )
        .map((entry) => entry.field);
      expect(missingFields).toEqual(
        expect.arrayContaining([
          "phases.red.verification",
          "phases.green.verification",
          "affectedVerification",
          "repairVerification",
          additionallyMissing,
        ]),
      );
    },
  );

  it("uses declared verification identity instead of test-like path names", () => {
    const root = workspace();
    const dataOutput = plan();
    for (const [id, outputPath] of [
      ["fixture-data", "test/fixtures/data.json"],
      ["generated-helper", "scripts/generated-helper.mjs"],
    ]) {
      dataOutput.tasks[0].phases.red.write.push(outputPath);
      dataOutput.outputs.push({
        id,
        path: outputPath,
        producer: { taskId: "owner", phase: "red" },
        postcondition: "regular-file",
      });
    }
    expect(
      compileImplementPlan(dataOutput, { consumerRoot: root }).closure,
    ).toEqual({ executable: true, diagnostics: [] });

    const colocatedTest = plan("src/feature.test.ts");
    colocatedTest.verification.change.fullSuite = verification(
      "global-full-suite",
      "test/baseline.mjs",
      "expected-green",
    );
    expect(diagnostics(colocatedTest, root)).toContainEqual(
      expect.objectContaining({
        code: "verification-input-binding-mismatch",
        field: "verification.change.fullSuite",
        path: "src/feature.test.ts",
      }),
    );
  });

  it("applies parent-owned AGENTS creation and removal before checkpoint and post-apply inputs", () => {
    const root = workspace();
    const managedBlock =
      "<!-- ABEL:AGENTS-INDEX:START -->\n- managed\n<!-- ABEL:AGENTS-INDEX:END -->";
    const created = plan();
    created.tasks[0].agents = {
      impact: "create-index",
      target: "AGENTS.md",
      managedOnly: true,
    };
    created.verification.agentsCheckpoint = {
      required: true,
      verification: verificationGroup("agents-checkpoint", [
        "test/future.mjs",
        "AGENTS.md",
      ]),
      operations: [
        {
          target: "AGENTS.md",
          impact: "create-index",
          taskIds: ["owner"],
          managedBlock,
        },
      ],
    };
    created.verification.change.postApply = verificationGroup("post-apply", [
      "test/future.mjs",
      "AGENTS.md",
    ]);
    expect(
      compileImplementPlan(created, { consumerRoot: root }).closure,
    ).toEqual({ executable: true, diagnostics: [] });

    writeFileSync(path.join(root, "AGENTS.md"), `${managedBlock}\n`);
    const removed = structuredClone(created);
    removed.tasks[0].agents.impact = "remove-index";
    removed.verification.agentsCheckpoint.operations[0].impact = "remove-index";
    removed.verification.agentsCheckpoint.operations[0].managedBlock = null;
    expect(diagnostics(removed, root)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "workspace-input-unavailable",
          field: "verification.agentsCheckpoint.verification",
          path: "AGENTS.md",
        }),
        expect.objectContaining({
          code: "workspace-input-unavailable",
          field: "verification.change.postApply",
          path: "AGENTS.md",
        }),
      ]),
    );
  });

  it("requires affected and repair inputs to survive through the task final stage", () => {
    const root = workspace();
    const deleted = plan("test/existing.mjs");
    deleted.tasks[0].phases.green = phase(
      "owner-green",
      "test/baseline.mjs",
      "expected-green",
      {
        read: ["test/baseline.mjs"],
        deletions: ["test/existing.mjs"],
      },
    );
    expect(diagnostics(deleted, root)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "producer-output-unavailable",
          taskId: "owner",
          field: "affectedVerification",
          path: "test/existing.mjs",
        }),
        expect.objectContaining({
          code: "producer-output-unavailable",
          taskId: "owner",
          field: "repairVerification",
          path: "test/existing.mjs",
        }),
      ]),
    );

    deleted.tasks[0].phases.refactor = phase(
      "owner-refactor",
      "test/existing.mjs",
      "expected-refactor",
      {
        write: ["test/existing.mjs"],
        source: { kind: "output", outputId: "future-test" },
      },
    );
    expect(
      compileImplementPlan(deleted, { consumerRoot: root }).closure,
    ).toEqual({ executable: true, diagnostics: [] });
  });

  it("requires task consumers to depend on their output producer", () => {
    const root = workspace();
    const draft = plan();
    const consumer = task("consumer", "test/future.mjs", {
      dependsOn: ["owner"],
      outputId: "future-test",
    });
    consumer.phases.red.write = ["src/consumer-red.ts"];
    consumer.phases.red.read = ["test/future.mjs"];
    draft.tasks.push(consumer);
    draft.tracking.taskIds.push("consumer");
    expect(compileImplementPlan(draft, { consumerRoot: root }).closure).toEqual(
      { executable: true, diagnostics: [] },
    );

    consumer.dependsOn = [];
    expect(diagnostics(draft, root)).toContainEqual(
      expect.objectContaining({
        code: "producer-not-dependency",
        taskId: "consumer",
        field: "affectedVerification",
        producerTaskId: "owner",
      }),
    );
  });

  it("requires global and checkpoint inputs to survive the complete task graph", () => {
    const root = workspace();
    const draft = plan();
    const cleanup = task("cleanup", "test/baseline.mjs", {
      dependsOn: ["owner"],
    });
    cleanup.phases.green = phase(
      "cleanup-green",
      "test/baseline.mjs",
      "expected-green",
      {
        read: ["test/baseline.mjs"],
        deletions: ["test/future.mjs"],
      },
    );
    cleanup.affectedVerification = verification(
      "cleanup-affected",
      "test/baseline.mjs",
      "expected-green",
    );
    cleanup.repairVerification = verification(
      "cleanup-repair",
      "test/baseline.mjs",
      "expected-green",
    );
    draft.tasks.push(cleanup);
    draft.tracking.taskIds.push("cleanup");
    draft.verification.agentsCheckpoint = {
      required: true,
      verification: verification(
        "agents-checkpoint",
        "test/future.mjs",
        "expected-green",
      ),
      operations: [
        {
          target: "AGENTS.md",
          impact: "update-existing",
          taskIds: ["cleanup"],
          managedBlock:
            "<!-- ABEL:AGENTS-INDEX:START -->\n- managed\n<!-- ABEL:AGENTS-INDEX:END -->",
        },
      ],
    };
    cleanup.agents = {
      impact: "update-existing",
      target: "AGENTS.md",
      managedOnly: true,
    };

    expect(diagnostics(draft, root)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "producer-output-unavailable",
          field: "verification.change.fullSuite",
          path: "test/future.mjs",
        }),
        expect.objectContaining({
          code: "producer-output-unavailable",
          field: "verification.change.postApply",
          path: "test/future.mjs",
        }),
        expect.objectContaining({
          code: "producer-output-unavailable",
          field: "verification.agentsCheckpoint.verification",
          path: "test/future.mjs",
        }),
      ]),
    );

    cleanup.phases.refactor = phase(
      "cleanup-refactor",
      "test/future.mjs",
      "expected-refactor",
      {
        write: ["test/future.mjs"],
        source: { kind: "output", outputId: "future-test" },
      },
    );
    expect(compileImplementPlan(draft, { consumerRoot: root }).closure).toEqual(
      { executable: true, diagnostics: [] },
    );
  });

  it("rejects a phase input deleted after its declared producer and before consumption", () => {
    const root = workspace();
    const draft = plan();
    draft.tasks[0].phases.green = phase(
      "owner-green",
      "test/future.mjs",
      "expected-green",
      {
        read: ["test/future.mjs"],
        deletions: ["test/future.mjs"],
        source: { kind: "output", outputId: "future-test" },
      },
    );

    expect(diagnostics(draft, root)).toContainEqual(
      expect.objectContaining({
        code: "producer-output-unavailable",
        taskId: "owner",
        phase: "green",
        path: "test/future.mjs",
      }),
    );
  });
});
