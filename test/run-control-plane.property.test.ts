import { lstatSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const RED_IDENTITY = "[CADENCE-V2:T1-control-store-delivery]";
const roots: string[] = [];

type ModuleRecord = Record<string, unknown>;

let controlContracts: ModuleRecord | null = null;
let deliveryCompiler: ModuleRecord | null = null;
let runState: ModuleRecord | null = null;
let runStoreModule: ModuleRecord | null = null;
let stateRootModule: ModuleRecord | null = null;

beforeAll(async () => {
  [
    controlContracts,
    deliveryCompiler,
    runState,
    runStoreModule,
    stateRootModule,
  ] = await Promise.all(
    [
      "../src/control-contracts.ts",
      "../src/delivery-compiler.ts",
      "../src/run-state.ts",
      "../src/run-store.ts",
      "../src/state-root.ts",
    ].map(async (specifier) => {
      try {
        return (await import(specifier)) as ModuleRecord;
      } catch {
        return null;
      }
    }),
  );
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function temporaryRoot(label: string): string {
  const root = mkdtempSync(path.join(tmpdir(), `cadence-v2-${label}-`));
  roots.push(root);
  return root;
}

function requiredModule(
  value: ModuleRecord | null,
  exportName: string,
): ModuleRecord {
  expect(
    value,
    `${RED_IDENTITY}: ${exportName} module must exist`,
  ).not.toBeNull();
  return value as ModuleRecord;
}

function requiredFunction<T extends (...args: never[]) => unknown>(
  module: ModuleRecord | null,
  exportName: string,
): T {
  const loaded = requiredModule(module, exportName);
  expect(
    loaded[exportName],
    `${RED_IDENTITY}: ${exportName} must be exported`,
  ).toBeTypeOf("function");
  return loaded[exportName] as T;
}

function verification(
  id: string,
  classification: "expected-red" | "expected-green",
) {
  return {
    kind: "vitest",
    id,
    runner: {
      kind: "package-script",
      packageManager: "bun",
      script: "test:target",
      command: "vitest run",
    },
    testFiles: ["test/run-control-plane.property.test.ts"],
    args: [],
    minTests: 1,
    classification,
    ...(classification === "expected-red"
      ? { expectedFailure: RED_IDENTITY }
      : {}),
  };
}

function planDraft(reverseSets = false): Record<string, unknown> {
  const sourcePaths = [
    "package.json",
    "test/run-control-plane.property.test.ts",
  ];
  const resources = ["control-store-schema", "delivery-v2"];
  if (reverseSets) {
    sourcePaths.reverse();
    resources.reverse();
  }
  return {
    schemaVersion: 3,
    changeId: "durable-control-plane",
    tasks: [
      {
        taskId: "T1-control-store-delivery",
        dependsOn: [],
        objective: "Compile and persist the v2 control contract",
        context: {
          agents: "root AGENTS applies",
          contract: "approved T1 boundary",
        },
        roots: ["."],
        phases: {
          red: {
            read: sourcePaths,
            write: ["test/run-control-plane.property.test.ts"],
            delete: [],
            verification: verification(
              "T1-control-store-delivery-red",
              "expected-red",
            ),
            verificationInputs: [
              { kind: "output", outputId: "T1-red-test" },
              { kind: "workspace", path: "package.json" },
            ],
            verificationLock: "vitest-cadence-v2",
          },
          green: {
            read: sourcePaths,
            write: [
              "src/control-contracts.ts",
              "src/run-state.ts",
              "src/run-store.ts",
              "src/state-root.ts",
              "src/delivery-compiler.ts",
            ],
            delete: [],
            verification: verification(
              "T1-control-store-delivery-green",
              "expected-green",
            ),
            verificationInputs: [
              { kind: "output", outputId: "T1-red-test" },
              { kind: "workspace", path: "package.json" },
            ],
            verificationLock: "vitest-cadence-v2",
          },
        },
        scheduling: { conflicts: [], resources },
        agents: { impact: "none", managedOnly: true },
        approvedDependencies: [],
        impactClosure: {
          changedSurfaces: ["none"],
          searchEvidence: [],
          relatedTests: [
            {
              path: "test/run-control-plane.property.test.ts",
              disposition: "current-task",
              evidence: "T1 owns its v2 Red witness",
            },
          ],
          affectedSuite: ["test/run-control-plane.property.test.ts"],
        },
        affectedVerification: verification(
          "T1-control-store-delivery-affected",
          "expected-green",
        ),
        repairVerification: verification(
          "T1-control-store-delivery-repair",
          "expected-green",
        ),
      },
    ],
    outputs: [
      {
        id: "T1-red-test",
        path: "test/run-control-plane.property.test.ts",
        producer: { taskId: "T1-control-store-delivery", phase: "red" },
        postcondition: "regular-file",
      },
    ],
    verification: {
      baseline: {
        target: "task-red-contracts",
        affected: "task-affected-contracts",
        fullSuite: verification("package-baseline", "expected-green"),
        failureIdentity: "normalized-v1",
      },
      change: {
        affected: "task-affected-contracts",
        fullSuite: verification("package-full-suite", "expected-green"),
        postApply: verification("package-post-apply", "expected-green"),
      },
      artifactCorrection: { maxAttempts: 2 },
      repair: {
        maxAttempts: 2,
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
      taskIds: ["T1-control-store-delivery"],
      completionOwner: "parent",
    },
  };
}

describe("change-oriented control contract", () => {
  it("accepts the closed command surface and rejects undeclared mechanics", () => {
    const validate = requiredFunction<
      (value: unknown) => Record<string, unknown>
    >(controlContracts, "validateControlCommand");
    const commands = requiredModule(
      controlContracts,
      "CONTROL_COMMANDS",
    ).CONTROL_COMMANDS;
    expect(commands).toEqual([
      "start",
      "status",
      "resume",
      "rebind",
      "cancel",
      "discard",
    ]);

    expect(
      validate({
        version: 2,
        command: "rebind",
        stage: "abel-implement",
        change: "durable-control-plane",
        operationId: "rebind-001",
        routeId: "implementation-primary",
      }),
    ).toMatchObject({ ok: true });

    expect(
      validate({
        version: 2,
        command: "resume",
        stage: "abel-implement",
        change: "durable-control-plane",
        operationId: "resume-001",
        internalState: {},
      }),
    ).toMatchObject({ ok: false, code: "invalid-control-command" });
    expect(
      validate({
        version: 1,
        command: "start",
        stage: "abel-implement",
        change: "durable-control-plane",
      }),
    ).toMatchObject({ ok: false, code: "unsupported-control-version" });

    const provisionalKey = "a".repeat(64);
    expect(
      validate({
        version: 2,
        command: "start",
        stage: "abel-design",
        change: "durable-control-plane",
        provisionalKey,
        operationId: "bind-provisional-design",
      }),
    ).toMatchObject({ ok: true });
    expect(
      validate({
        version: 2,
        command: "start",
        stage: "abel-implement",
        change: "durable-control-plane",
        provisionalKey,
        operationId: "invalid-implement-provisional",
      }),
    ).toMatchObject({ ok: false, code: "invalid-control-command" });
  });

  it("advertises resume while an apply is recovering", () => {
    const legal = requiredFunction<(state: string) => string[]>(
      runState,
      "legalControlCommands",
    );
    expect(legal("recovering")).toEqual(["status", "resume", "discard"]);
  });
});

describe("canonical delivery compilation", () => {
  it("normalizes set ordering and produces one stable plan and receipt binding", () => {
    const compile = requiredFunction<
      (
        draft: Record<string, unknown>,
        options: { consumerRoot: string },
      ) => Record<string, unknown>
    >(deliveryCompiler, "compileImplementPlan");
    const consumerRoot = path.resolve(import.meta.dirname, "..");
    const left = compile(planDraft(false), { consumerRoot });
    const right = compile(planDraft(true), { consumerRoot });

    expect(left).toMatchObject({
      rawSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      planHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      closure: { executable: true, diagnostics: [] },
      receipt: {
        plan: {
          path: "implement-plan.json",
          schemaVersion: 3,
          rawSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          canonicalHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        },
      },
    });
    expect(left.bytes).toEqual(right.bytes);
    expect(left.rawSha256).toBe(right.rawSha256);
    expect(left.planHash).toBe(right.planHash);
    expect(String(left.tasksMarkdown)).toContain("T1-control-store-delivery");
  });

  it("requires an explicit bounded artifact-correction policy", () => {
    const compile = requiredFunction<
      (
        draft: Record<string, unknown>,
        options: { consumerRoot: string },
      ) => Record<string, unknown>
    >(deliveryCompiler, "compileImplementPlan");
    const missing = planDraft() as any;
    delete missing.verification.artifactCorrection;
    expect(() =>
      compile(missing, {
        consumerRoot: path.resolve(import.meta.dirname, ".."),
      }),
    ).toThrow(/delivery-verification-plan-invalid/u);
    for (const maxAttempts of [1, 4]) {
      const invalid = planDraft() as any;
      invalid.verification.artifactCorrection.maxAttempts = maxAttempts;
      expect(() =>
        compile(invalid, {
          consumerRoot: path.resolve(import.meta.dirname, ".."),
        }),
      ).toThrow(/delivery-verification-plan-invalid/u);
    }
    const draft = planDraft() as any;
    expect(
      compile(draft, { consumerRoot: path.resolve(import.meta.dirname, "..") }),
    ).toMatchObject({
      plan: {
        verification: { artifactCorrection: { maxAttempts: 2 } },
      },
    });
  });

  it("rejects prior plan and receipt schema versions without an adapter", () => {
    const compilePlan = requiredFunction<
      (
        draft: Record<string, unknown>,
        options: { consumerRoot: string },
      ) => Record<string, unknown>
    >(deliveryCompiler, "compileImplementPlan");
    const legacyPlan = planDraft() as any;
    legacyPlan.schemaVersion = 2;
    expect(() =>
      compilePlan(legacyPlan, {
        consumerRoot: path.resolve(import.meta.dirname, ".."),
      }),
    ).toThrow(/delivery-plan-invalid/u);

    const compileGateA = requiredFunction<
      (input: Record<string, unknown>) => Record<string, any>
    >(deliveryCompiler, "compileGateAReceipt");
    const parseGateA = requiredFunction<
      (bytes: Uint8Array) => Record<string, unknown>
    >(deliveryCompiler, "parseGateAReceipt");
    const gate = compileGateA({
      change: "durable-control-plane",
      schema: "spec-driven",
      approval: {
        revision: 1,
        contractHash: "b".repeat(64),
        recordHash: "c".repeat(64),
      },
      artifacts: [{ path: "proposal.md", rawSha256: "a".repeat(64) }],
    });
    expect(gate.receipt.receiptVersion).toBe(4);
    const legacyReceipt = Buffer.from(
      Buffer.from(gate.bytes)
        .toString("utf8")
        .replace('"receiptVersion":4', '"receiptVersion":3'),
    );
    expect(() => parseGateA(legacyReceipt)).toThrow(/gate-a-receipt-invalid/u);
  });

  it.each([
    [
      "change ID",
      (draft: any) => {
        draft.changeId = "durable:control-plane";
      },
    ],
    [
      "verification ID",
      (draft: any) => {
        draft.tasks[0].phases.red.verification.id = "red witness";
      },
    ],
    [
      "step-group verification ID",
      (draft: any) => {
        const verification = draft.tasks[0].phases.red.verification;
        draft.tasks[0].phases.red.verification = {
          kind: "steps",
          id: "red witness",
          classification: "expected-red",
          steps: [verification],
        };
      },
    ],
    [
      "task ID",
      (draft: any) => {
        draft.tasks[0].taskId = "task identity";
        draft.tracking.taskIds = ["task identity"];
        for (const output of draft.outputs) {
          output.producer.taskId = "task identity";
        }
      },
    ],
    [
      "output ID",
      (draft: any) => {
        draft.outputs[0].id = "output identity";
        for (const phase of Object.values(draft.tasks[0].phases) as any[]) {
          phase.verificationInputs[0].outputId = "output identity";
        }
      },
    ],
  ])(
    "rejects a delivery-bound %s outside the durable ID grammar",
    (_label, mutate) => {
      const compile = requiredFunction<
        (
          draft: Record<string, unknown>,
          options: { consumerRoot: string },
        ) => Record<string, unknown>
      >(deliveryCompiler, "compileImplementPlan");
      const draft = planDraft() as any;
      mutate(draft);
      expect(() =>
        compile(draft, {
          consumerRoot: path.resolve(import.meta.dirname, ".."),
        }),
      ).toThrow(/delivery-(?:plan|verification)-invalid/u);
    },
  );

  it("seals one managed-only AGENTS operation for every approved target", () => {
    const compile = requiredFunction<
      (
        draft: Record<string, unknown>,
        options: { consumerRoot: string },
      ) => Record<string, unknown>
    >(deliveryCompiler, "compileImplementPlan");
    const draft = planDraft() as any;
    draft.tasks[0].agents = {
      impact: "update-existing",
      target: "AGENTS.md",
      managedOnly: true,
    };
    const block = [
      "<!-- ABEL:AGENTS-INDEX:START -->",
      "- `src/workflow-engine.ts` owns durable control.",
      "<!-- ABEL:AGENTS-INDEX:END -->",
    ].join("\n");
    draft.verification.agentsCheckpoint = {
      required: true,
      verification: verification("agents-checkpoint", "expected-green"),
      operations: [
        {
          target: "AGENTS.md",
          impact: "update-existing",
          taskIds: ["T1-control-store-delivery"],
          managedBlock: `${block}\n`,
        },
      ],
    };

    const compiled = compile(draft, {
      consumerRoot: path.resolve(import.meta.dirname, ".."),
    }) as any;
    expect(compiled.plan.verification.agentsCheckpoint.operations).toEqual([
      {
        target: "AGENTS.md",
        impact: "update-existing",
        taskIds: ["T1-control-store-delivery"],
        managedBlock: block,
      },
    ]);

    draft.verification.agentsCheckpoint.operations[0].managedBlock = `human text\n${block}`;
    expect(() =>
      compile(draft, { consumerRoot: path.resolve(import.meta.dirname, "..") }),
    ).toThrow(/delivery-agents-checkpoint-invalid/u);
  });

  it("validates every delete path at the graph boundary", () => {
    const compile = requiredFunction<
      (
        draft: Record<string, unknown>,
        options: { consumerRoot: string },
      ) => Record<string, unknown>
    >(deliveryCompiler, "compileImplementPlan");
    const consumerRoot = path.resolve(import.meta.dirname, "..");

    const agentsDelete = planDraft() as any;
    agentsDelete.tasks[0].phases.green.delete = ["AGENTS.md"];
    expect(() => compile(agentsDelete, { consumerRoot })).toThrow(
      /delivery-plan-invalid/u,
    );

    const outsideRoots = planDraft() as any;
    outsideRoots.tasks[0].roots = ["package.json", "src", "test"];
    outsideRoots.tasks[0].phases.green.delete = ["README.md"];
    expect(() => compile(outsideRoots, { consumerRoot })).toThrow(
      /delivery-plan-invalid/u,
    );

    const legalDelete = planDraft() as any;
    legalDelete.tasks[0].phases.green.delete = ["src/obsolete.ts"];
    expect(compile(legalDelete, { consumerRoot })).toMatchObject({
      closure: { executable: true, diagnostics: [] },
    });
  });

  it.each([
    ["affected", (draft: any) => draft.tasks[0].affectedVerification],
    ["repair", (draft: any) => draft.tasks[0].repairVerification],
    ["baseline", (draft: any) => draft.verification.baseline.fullSuite],
    ["full-suite", (draft: any) => draft.verification.change.fullSuite],
    ["post-apply", (draft: any) => draft.verification.change.postApply],
  ])("rejects a missing verification adapter for %s", (_label, select) => {
    const compile = requiredFunction<
      (
        draft: Record<string, unknown>,
        options: { consumerRoot: string },
      ) => Record<string, unknown>
    >(deliveryCompiler, "compileImplementPlan");
    const draft = planDraft() as any;
    select(draft).runner.script = "missing-script";
    expect(() =>
      compile(draft, { consumerRoot: path.resolve(import.meta.dirname, "..") }),
    ).toThrow(/delivery-plan-not-executable:.*script-missing/u);
  });

  it("rejects a missing AGENTS checkpoint verification adapter", () => {
    const compile = requiredFunction<
      (
        draft: Record<string, unknown>,
        options: { consumerRoot: string },
      ) => Record<string, unknown>
    >(deliveryCompiler, "compileImplementPlan");
    const draft = planDraft() as any;
    draft.tasks[0].agents = {
      impact: "update-existing",
      target: "AGENTS.md",
      managedOnly: true,
    };
    draft.verification.agentsCheckpoint = {
      required: true,
      verification: verification("agents-checkpoint", "expected-green"),
      operations: [
        {
          target: "AGENTS.md",
          impact: "update-existing",
          taskIds: ["T1-control-store-delivery"],
          managedBlock: [
            "<!-- ABEL:AGENTS-INDEX:START -->",
            "- managed entry",
            "<!-- ABEL:AGENTS-INDEX:END -->",
          ].join("\n"),
        },
      ],
    };
    draft.verification.agentsCheckpoint.verification.runner.script =
      "missing-script";
    expect(() =>
      compile(draft, { consumerRoot: path.resolve(import.meta.dirname, "..") }),
    ).toThrow(/delivery-plan-not-executable:.*script-missing/u);
  });
});

describe("repository-external private state", () => {
  it("rejects an in-repository state path before creating it", () => {
    const resolve = requiredFunction<
      (options: Record<string, unknown>) => Record<string, unknown>
    >(stateRootModule, "resolveStateRoot");
    const consumerRoot = temporaryRoot("consumer");
    const unsafeBase = path.join(consumerRoot, ".private-state");

    expect(() =>
      resolve({
        consumerRoot,
        xdgStateHome: unsafeBase,
        homeDir: temporaryRoot("home"),
      }),
    ).toThrow(/state-root-inside-consumer/u);
    expect(() => lstatSync(unsafeBase)).toThrow();
  });

  it("creates owner-private state directories outside the consumer", () => {
    const resolve = requiredFunction<
      (options: Record<string, unknown>) => Record<string, unknown>
    >(stateRootModule, "resolveStateRoot");
    const prepare = requiredFunction<
      (resolved: Record<string, unknown>) => Record<string, unknown>
    >(stateRootModule, "prepareStateRoot");
    const consumerRoot = temporaryRoot("consumer");
    const xdgStateHome = temporaryRoot("xdg");
    const resolved = resolve({
      consumerRoot,
      xdgStateHome,
      homeDir: temporaryRoot("home"),
    });
    const prepared = prepare(resolved);

    expect(
      String(prepared.rootDir).startsWith(`${consumerRoot}${path.sep}`),
    ).toBe(false);
    expect(lstatSync(String(prepared.rootDir)).mode & 0o777).toBe(0o700);
    expect(prepared.databasePath).toBe(
      path.join(String(prepared.rootDir), "control.sqlite3"),
    );
  });
});

describe("durable run journal", () => {
  it("rolls back a public delivery binding when its atomic admission write fails", () => {
    const resolve = requiredFunction<
      (options: Record<string, unknown>) => Record<string, unknown>
    >(stateRootModule, "resolveStateRoot");
    const storeClass = requiredModule(runStoreModule, "RunStore").RunStore as {
      open(resolved: Record<string, unknown>): {
        startRun(input: Record<string, unknown>): Record<string, unknown>;
        bindDeliveryAtomically(
          input: Record<string, unknown>,
          write: () => void,
        ): Record<string, unknown>;
        status(runId: string): Record<string, unknown>;
        listEvents(runId: string): Array<Record<string, unknown>>;
        close(): void;
      };
    };
    const store = storeClass.open(
      resolve({
        consumerRoot: temporaryRoot("atomic-binding-consumer"),
        xdgStateHome: temporaryRoot("atomic-binding-xdg"),
        homeDir: temporaryRoot("atomic-binding-home"),
      }),
    );
    const created = store.startRun({
      stage: "abel-implement",
      change: "atomic-delivery-binding",
      operationId: "atomic-binding-start",
    });

    expect(() =>
      store.bindDeliveryAtomically(
        {
          runId: created.runId,
          gate: "gate-b",
          revision: 1,
          receiptHash: "a".repeat(64),
          operationId: "atomic-binding-admit",
        },
        () => {
          throw new Error("simulated-engine-admission-stop");
        },
      ),
    ).toThrow(/simulated-engine-admission-stop/u);
    expect(store.status(String(created.runId))).not.toHaveProperty(
      "deliveryRevision",
    );
    expect(store.listEvents(String(created.runId))).toHaveLength(1);
    store.close();
  });

  it("keeps one run identity across delivery revisions, replay, and restart", () => {
    const resolve = requiredFunction<
      (options: Record<string, unknown>) => Record<string, unknown>
    >(stateRootModule, "resolveStateRoot");
    const storeClass = requiredModule(runStoreModule, "RunStore").RunStore as {
      open(
        resolved: Record<string, unknown>,
        options?: Record<string, unknown>,
      ): {
        startRun(input: Record<string, unknown>): Record<string, unknown>;
        bindDelivery(input: Record<string, unknown>): Record<string, unknown>;
        status(runId: string): Record<string, unknown>;
        listEvents(runId: string): Array<Record<string, unknown>>;
        rebuildProjection(runId: string): Record<string, unknown>;
        close(): void;
      };
    };
    expect(
      storeClass?.open,
      `${RED_IDENTITY}: RunStore.open must exist`,
    ).toBeTypeOf("function");

    const resolved = resolve({
      consumerRoot: temporaryRoot("consumer"),
      xdgStateHome: temporaryRoot("xdg"),
      homeDir: temporaryRoot("home"),
    });
    let store = storeClass.open(resolved);
    const created = store.startRun({
      stage: "abel-implement",
      change: "durable-control-plane",
      operationId: "start-001",
    });
    const repeated = store.startRun({
      stage: "abel-implement",
      change: "durable-control-plane",
      operationId: "start-002",
    });
    expect(repeated.runId).toBe(created.runId);

    const gateA = store.bindDelivery({
      runId: created.runId,
      gate: "gate-a",
      revision: 1,
      receiptHash: "a".repeat(64),
      operationId: "bind-a-001",
    });
    const replayedGateA = store.bindDelivery({
      runId: created.runId,
      gate: "gate-a",
      revision: 1,
      receiptHash: "a".repeat(64),
      operationId: "bind-a-001",
    });
    expect(replayedGateA).toEqual(gateA);

    store.bindDelivery({
      runId: created.runId,
      gate: "gate-b",
      revision: 2,
      receiptHash: "b".repeat(64),
      operationId: "bind-b-002",
    });
    const beforeRestart = store.status(String(created.runId));
    expect(beforeRestart.runId).toBe(created.runId);
    expect(beforeRestart.deliveryRevision).toBe(2);
    expect(store.rebuildProjection(String(created.runId))).toEqual(
      beforeRestart,
    );
    const eventCount = store.listEvents(String(created.runId)).length;
    store.close();

    store = storeClass.open(resolved);
    expect(store.status(String(created.runId))).toEqual(beforeRestart);
    expect(store.listEvents(String(created.runId))).toHaveLength(eventCount);
    store.close();
  });

  it("fences an expired operation lease and commits only the replacement", () => {
    const resolve = requiredFunction<
      (options: Record<string, unknown>) => Record<string, unknown>
    >(stateRootModule, "resolveStateRoot");
    const storeClass = requiredModule(runStoreModule, "RunStore").RunStore as {
      open(
        resolved: Record<string, unknown>,
        options?: Record<string, unknown>,
      ): {
        startRun(input: Record<string, unknown>): Record<string, unknown>;
        acquireLease(input: Record<string, unknown>): Record<string, unknown>;
        inspectOperation(
          runId: string,
          operationId: string,
        ): Record<string, unknown> | undefined;
        transition(input: Record<string, unknown>): Record<string, unknown>;
        close(): void;
      };
    };
    let now = 1_000;
    const store = storeClass.open(
      resolve({
        consumerRoot: temporaryRoot("consumer"),
        xdgStateHome: temporaryRoot("xdg"),
        homeDir: temporaryRoot("home"),
      }),
      { now: () => now },
    );
    const run = store.startRun({
      stage: "abel-implement",
      change: "durable-control-plane",
      operationId: "start-for-lease",
    });
    const first = store.acquireLease({
      runId: run.runId,
      operationId: "delivery-validation",
      ttlMs: 50,
    });
    now += 51;
    expect(
      store.inspectOperation(String(run.runId), "delivery-validation"),
    ).toEqual({ state: "interrupted" });
    const replacement = store.acquireLease({
      runId: run.runId,
      operationId: "delivery-validation",
      ttlMs: 50,
    });
    expect(replacement.token).not.toBe(first.token);

    expect(() =>
      store.transition({
        runId: run.runId,
        to: "validating-delivery",
        operationId: "transition-stale-lease",
        lease: first,
      }),
    ).toThrow(/lease-fenced/u);
    expect(
      store.transition({
        runId: run.runId,
        to: "validating-delivery",
        operationId: "transition-current-lease",
        lease: replacement,
      }),
    ).toMatchObject({ state: "validating-delivery" });
    store.close();
  });

  it("detects event-chain corruption instead of guessing a projection", () => {
    const reduce = requiredFunction<
      (events: Array<Record<string, unknown>>) => Record<string, unknown>
    >(runState, "reduceRunEvents");
    expect(() =>
      reduce([
        {
          sequence: 1,
          type: "run-created",
          payload: {
            runId: "run-1",
            rootHash: "0".repeat(64),
            stage: "abel-implement",
            change: "durable-control-plane",
          },
          priorHash: "0".repeat(64),
          hash: "f".repeat(64),
        },
      ]),
    ).toThrow(/event-integrity/u);
  });
});
