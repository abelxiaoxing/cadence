import { lstatSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
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
  const root = mkdtempSync(path.join(tmpdir(), `cadence-control-${label}-`));
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

type TestStateRoot = Record<string, unknown> & { databasePath: string };
type TestRunStore = {
  startRun(input: Record<string, unknown>): Record<string, unknown>;
  status(runId: string): Record<string, unknown>;
  close(): void;
};

function testStateRoot(label: string): TestStateRoot {
  const resolve = requiredFunction<
    (options: Record<string, unknown>) => TestStateRoot
  >(stateRootModule, "resolveStateRoot");
  return resolve({
    consumerRoot: temporaryRoot(`${label}-consumer`),
    xdgStateHome: temporaryRoot(`${label}-xdg`),
    homeDir: temporaryRoot(`${label}-home`),
  });
}

function openTestRunStore(stateRoot: TestStateRoot): TestRunStore {
  const storeClass = requiredModule(runStoreModule, "RunStore").RunStore as {
    open(resolved: Record<string, unknown>): TestRunStore;
  };
  return storeClass.open(stateRoot);
}

function rowCount(database: DatabaseSync, from: string): number {
  return Number(
    (
      database.prepare(`SELECT COUNT(*) AS count FROM ${from}`).get() as {
        count: number;
      }
    ).count,
  );
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
  const resources = ["control-store-schema", "delivery-current"];
  if (reverseSets) {
    sourcePaths.reverse();
    resources.reverse();
  }
  return {
    changeId: "durable-control-plane",
    tasks: [
      {
        taskId: "T1-control-store-delivery",
        dependsOn: [],
        objective: "Compile and persist the current control contract",
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
            verificationLock: "vitest-cadence-control",
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
            verificationLock: "vitest-cadence-control",
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
              evidence: "T1 owns its current Red witness",
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
        failureIdentity: "normalized",
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
  it("canonicalizes only strict-provider padding before exact validation", () => {
    const canonicalize = requiredFunction<(value: unknown) => unknown>(
      controlContracts,
      "canonicalizeControlCommandToolInput",
    );
    const validate = requiredFunction<
      (value: unknown) => Record<string, unknown>
    >(controlContracts, "validateControlCommand");
    const common = {
      stage: "abel-implement",
      change: "strict-provider-padding",
    };
    const cases = [
      {
        input: {
          ...common,
          command: "start",
          operationId: "strict-start",
          deliveryRevision: 1,
          receiptHash: "",
          routeId: "",
        },
        expected: { ...common, command: "start", operationId: "strict-start" },
      },
      {
        input: {
          ...common,
          command: "status",
          operationId: null,
          deliveryRevision: null,
          receiptHash: null,
          routeId: null,
        },
        expected: { ...common, command: "status" },
      },
      {
        input: {
          ...common,
          command: "resume",
          operationId: "strict-resume",
          deliveryRevision: null,
          receiptHash: null,
          routeId: null,
        },
        expected: {
          ...common,
          command: "resume",
          operationId: "strict-resume",
        },
      },
      {
        input: {
          ...common,
          command: "rebind",
          operationId: "strict-rebind",
          deliveryRevision: null,
          receiptHash: null,
          routeId: "implementation-primary",
        },
        expected: {
          ...common,
          command: "rebind",
          operationId: "strict-rebind",
          routeId: "implementation-primary",
        },
      },
      ...(["cancel", "discard"] as const).map((command) => ({
        input: {
          ...common,
          command,
          operationId: `strict-${command}`,
          deliveryRevision: null,
          receiptHash: null,
          routeId: null,
        },
        expected: {
          ...common,
          command,
          operationId: `strict-${command}`,
        },
      })),
    ];

    for (const { input, expected } of cases) {
      const canonical = canonicalize(input);
      expect(canonical).toEqual(expected);
      expect(validate(canonical)).toMatchObject({ ok: true });
    }

    const malformedResume = canonicalize({
      ...common,
      command: "resume",
      operationId: "strict-malformed-resume",
      deliveryRevision: 1,
      receiptHash: "",
      routeId: null,
    });
    expect(validate(malformedResume)).toMatchObject({
      ok: false,
      code: "invalid-control-command",
    });

    const unknown = canonicalize(
      JSON.parse(
        '{"command":"start","stage":"abel-implement","change":"strict-provider-padding","operationId":"strict-unknown","__proto__":{"polluted":true}}',
      ),
    );
    expect(Object.hasOwn(unknown as object, "__proto__")).toBe(true);
    expect(validate(unknown)).toMatchObject({
      ok: false,
      code: "invalid-control-command",
    });
  });

  it("accepts the closed command surface and rejects undeclared mechanics", () => {
    const validate = requiredFunction<
      (value: unknown) => Record<string, unknown>
    >(controlContracts, "validateControlCommand");
    const commands = requiredModule(
      controlContracts,
      "CONTROL_COMMANDS",
    ).CONTROL_COMMANDS;
    const schema = requiredModule(
      controlContracts,
      "CONTROL_COMMAND_PARAMETERS",
    ).CONTROL_COMMAND_PARAMETERS as any;
    expect(schema.required).toEqual(["command", "stage", "change"]);
    expect(schema.anyOf).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          properties: expect.objectContaining({
            command: { type: "string", enum: ["status"] },
          }),
          required: ["command", "stage", "change"],
        }),
        expect.objectContaining({
          properties: expect.objectContaining({
            command: { type: "string", enum: ["start"] },
          }),
          required: ["command", "stage", "change", "operationId"],
        }),
        expect.objectContaining({
          properties: expect.objectContaining({
            command: { type: "string", enum: ["rebind"] },
          }),
          required: ["command", "stage", "change", "operationId", "routeId"],
        }),
      ]),
    );
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
        command: "rebind",
        stage: "abel-implement",
        change: "durable-control-plane",
        operationId: "rebind-001",
        routeId: "implementation-primary",
      }),
    ).toMatchObject({ ok: true });

    expect(
      validate({
        command: "resume",
        stage: "abel-implement",
        change: "durable-control-plane",
        operationId: "resume-001",
        internalState: {},
      }),
    ).toMatchObject({ ok: false, code: "invalid-control-command" });
    expect(
      validate({
        version: 2,
        command: "start",
        stage: "abel-implement",
        change: "durable-control-plane",
        operationId: "version-field-rejected",
      }),
    ).toMatchObject({ ok: false, code: "invalid-control-command" });

    expect(
      validate({
        command: "start",
        stage: "abel-design",
        change: "durable-control-plane",
        operationId: "bind-provisional-design",
      }),
    ).toMatchObject({ ok: false, code: "invalid-control-command" });
    expect(
      validate({
        command: "start",
        stage: "abel-implement",
        change: "durable-control-plane",
        provisionalKey: "a".repeat(64),
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
          rawSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          canonicalHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        },
      },
    });
    expect(left.bytes).toEqual(right.bytes);
    expect(left.rawSha256).toBe(right.rawSha256);
    expect(left.planHash).toBe(right.planHash);
    expect(String(left.tasksMarkdown)).toContain("T1-control-store-delivery");

    const draft = planDraft();
    delete draft.tracking;
    expect(compile(draft, { consumerRoot }).bytes).toEqual(left.bytes);
    expect(draft).not.toHaveProperty("tracking");
  });

  it("rejects a phase with no writable or deletable boundary", () => {
    const compile = requiredFunction<
      (
        draft: Record<string, unknown>,
        options: { consumerRoot: string },
      ) => Record<string, unknown>
    >(deliveryCompiler, "compileImplementPlan");
    const draft = planDraft() as any;
    draft.tasks[0].phases.green.write = [];
    draft.tasks[0].phases.green.delete = [];
    expect(() =>
      compile(draft, {
        consumerRoot: path.resolve(import.meta.dirname, ".."),
      }),
    ).toThrow(/delivery-plan-empty-phase-boundary/u);
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

  it("rejects noncanonical plan and receipt fields", () => {
    const compilePlan = requiredFunction<
      (
        draft: Record<string, unknown>,
        options: { consumerRoot: string },
      ) => Record<string, unknown>
    >(deliveryCompiler, "compileImplementPlan");
    const invalidPlan = planDraft() as any;
    invalidPlan.unknownField = true;
    expect(() =>
      compilePlan(invalidPlan, {
        consumerRoot: path.resolve(import.meta.dirname, ".."),
      }),
    ).toThrow(/delivery-plan-invalid/u);

    const consumerRoot = path.resolve(import.meta.dirname, "..");
    const draft = planDraft() as any;
    for (const tracking of [
      null,
      { ...draft.tracking, completionOwner: "worker" },
      { ...draft.tracking, taskIds: ["another-task"] },
    ]) {
      expect(() =>
        compilePlan({ ...draft, tracking }, { consumerRoot }),
      ).toThrow(/delivery-tracking-/u);
    }
    const parsePlan = requiredFunction<(bytes: Uint8Array) => unknown>(
      deliveryCompiler,
      "parseImplementPlan",
    );
    const canonical = compilePlan(draft, { consumerRoot }).plan as any;
    delete canonical.tracking;
    // Stored deliveries must remain complete, even though drafts may omit tracking.
    expect(() => parsePlan(Buffer.from(JSON.stringify(canonical)))).toThrow(
      /delivery-plan-invalid/u,
    );

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
    const invalid = JSON.parse(Buffer.from(gate.bytes).toString("utf8"));
    invalid.unknownField = true;
    const invalidReceipt = Buffer.from(`${JSON.stringify(invalid)}\n`);
    expect(() => parseGateA(invalidReceipt)).toThrow(/gate-a-receipt-invalid/u);
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

  it.skipIf(process.platform !== "win32")(
    "initializes private state through native drive-letter and backslash paths",
    () => {
      const resolve = requiredFunction<
        (options: Record<string, unknown>) => TestStateRoot
      >(stateRootModule, "resolveStateRoot");
      const consumerRoot = temporaryRoot("windows-consumer");
      const userRoot = temporaryRoot("windows-user");
      const resolved = resolve({
        consumerRoot,
        xdgStateHome: path.join(userRoot, "AppData", "Local"),
        homeDir: userRoot,
      });
      expect(path.win32.isAbsolute(String(resolved.databasePath))).toBe(true);
      expect(String(resolved.databasePath)).toMatch(/^[a-z]:\\/iu);
      expect(String(resolved.databasePath)).toContain("\\");
      const store = openTestRunStore(resolved);
      expect(
        store.startRun({
          stage: "abel-design",
          provisionalKey: "c".repeat(64),
          operationId: "windows-native-start",
        }),
      ).toMatchObject({ runId: expect.any(String) });
      store.close();
    },
  );
});

describe("durable run journal", () => {
  it("migrates the supported schema_meta v4 store without losing runs or operation receipts", () => {
    const resolved = testStateRoot("legacy-v4");
    let store = openTestRunStore(resolved);
    const created = store.startRun({
      stage: "abel-design",
      provisionalKey: "a".repeat(64),
      operationId: "legacy-v4-start",
    });
    store.close();

    const legacy = new DatabaseSync(String(resolved.databasePath));
    legacy.exec(`
      CREATE TABLE schema_meta (
        version INTEGER PRIMARY KEY CHECK (version = 4)
      ) STRICT;
      INSERT INTO schema_meta(version) VALUES (4);
    `);
    const before = {
      runs: rowCount(legacy, "runs"),
      operations: rowCount(legacy, "operations"),
    };
    legacy.close();

    store = openTestRunStore(resolved);
    expect(store.status(String(created.runId))).toEqual(created);
    expect(
      store.startRun({
        stage: "abel-design",
        provisionalKey: "a".repeat(64),
        operationId: "legacy-v4-start",
      }),
    ).toEqual(created);
    store.close();

    const migrated = new DatabaseSync(String(resolved.databasePath), {
      readOnly: true,
    });
    expect(
      migrated
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_meta'",
        )
        .get(),
    ).toBeUndefined();
    expect(rowCount(migrated, "runs")).toBe(before.runs);
    expect(rowCount(migrated, "operations")).toBe(before.operations);
    migrated.close();
  });

  it("rolls back a failed supported migration and preserves the legacy store", () => {
    const migrationErrorClass = requiredModule(
      runStoreModule,
      "RunStoreMigrationError",
    ).RunStoreMigrationError as new (
      ...args: any[]
    ) => Error;
    const resolved = testStateRoot("legacy-migration-failure");
    openTestRunStore(resolved).close();
    const legacy = new DatabaseSync(String(resolved.databasePath));
    legacy.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE schema_meta (
        version INTEGER PRIMARY KEY CHECK (version = 4)
      ) STRICT;
      INSERT INTO schema_meta(version) VALUES (4);
      CREATE TABLE migration_blocker (
        version INTEGER NOT NULL REFERENCES schema_meta(version)
      ) STRICT;
      INSERT INTO migration_blocker(version) VALUES (4);
    `);
    legacy.close();

    expect(() => openTestRunStore(resolved)).toThrow(migrationErrorClass);
    const preserved = new DatabaseSync(String(resolved.databasePath), {
      readOnly: true,
    });
    expect(preserved.prepare("SELECT version FROM schema_meta").get()).toEqual({
      version: 4,
    });
    expect(
      preserved.prepare("SELECT version FROM migration_blocker").get(),
    ).toEqual({ version: 4 });
    preserved.close();
  });

  it("fences a reused Design start operation id across different inputs", () => {
    const resolved = testStateRoot("design-start-conflict");
    const store = openTestRunStore(resolved);
    store.startRun({
      stage: "abel-design",
      provisionalKey: "a".repeat(64),
      operationId: "same-design-start",
    });
    expect(() =>
      store.startRun({
        stage: "abel-design",
        provisionalKey: "b".repeat(64),
        operationId: "same-design-start",
      }),
    ).toThrow(/operation-id-conflict/u);
    store.close();

    const database = new DatabaseSync(String(resolved.databasePath), {
      readOnly: true,
    });
    expect(rowCount(database, "runs")).toBe(1);
    expect(rowCount(database, "operations")).toBe(1);
    database.close();
  });

  it("serializes concurrent Design starts without losing a run or receipt", async () => {
    const resolved = testStateRoot("concurrent-design-start");
    openTestRunStore(resolved).close();
    const workerUrl = new URL(
      "./fixtures/run-store-start-worker.mjs",
      import.meta.url,
    );
    const workers = [
      new Worker(workerUrl, {
        execArgv: ["--experimental-strip-types"],
        workerData: {
          stateRoot: resolved,
          provisionalKey: "d".repeat(64),
          operationId: "concurrent-design-start-one",
        },
      }),
      new Worker(workerUrl, {
        execArgv: ["--experimental-strip-types"],
        workerData: {
          stateRoot: resolved,
          provisionalKey: "e".repeat(64),
          operationId: "concurrent-design-start-two",
        },
      }),
    ];
    const nextMessage = (worker: Worker) =>
      new Promise<any>((resolveMessage, reject) => {
        worker.once("message", resolveMessage);
        worker.once("error", reject);
      });
    try {
      expect(await Promise.all(workers.map(nextMessage))).toEqual([
        "ready",
        "ready",
      ]);
      for (const worker of workers) worker.postMessage("start");
      const outcomes = await Promise.all(workers.map(nextMessage));
      expect(outcomes).toEqual([
        expect.objectContaining({ ok: true, runId: expect.any(String) }),
        expect.objectContaining({ ok: true, runId: expect.any(String) }),
      ]);
      expect(outcomes[0].runId).not.toBe(outcomes[1].runId);
    } finally {
      await Promise.all(workers.map((worker) => worker.terminate()));
    }

    const database = new DatabaseSync(String(resolved.databasePath), {
      readOnly: true,
    });
    expect(rowCount(database, "runs")).toBe(2);
    expect(rowCount(database, "operations WHERE kind = 'start'")).toBe(2);
    database.close();
  });

  it.each([
    [
      "before the run insert",
      `CREATE TRIGGER fail_start_before_run
       BEFORE INSERT ON runs
       BEGIN SELECT RAISE(ABORT, 'forced-before-run'); END`,
      "fail_start_before_run",
    ],
    [
      "after the run insert and before the receipt",
      `CREATE TRIGGER fail_start_before_receipt
       BEFORE INSERT ON operations WHEN NEW.kind = 'start'
       BEGIN SELECT RAISE(ABORT, 'forced-before-receipt'); END`,
      "fail_start_before_receipt",
    ],
  ])(
    "rolls back a Design start failure %s",
    (_label, triggerSql, triggerName) => {
      const resolved = testStateRoot(`atomic-start-${triggerName}`);
      openTestRunStore(resolved).close();
      const setup = new DatabaseSync(String(resolved.databasePath));
      setup.exec(triggerSql);
      setup.close();
      const store = openTestRunStore(resolved);
      const request = {
        stage: "abel-design",
        provisionalKey: "f".repeat(64),
        operationId: "atomic-design-start",
      };
      expect(() => store.startRun(request)).toThrow(/forced-/u);
      const failed = new DatabaseSync(String(resolved.databasePath));
      expect(rowCount(failed, "runs")).toBe(0);
      expect(rowCount(failed, "operations")).toBe(0);
      failed.exec(`DROP TRIGGER ${triggerName}`);
      failed.close();
      expect(store.startRun(request)).toMatchObject({
        runId: expect.any(String),
      });
      store.close();
    },
  );

  it("rolls back a Design start when transaction commit fails", () => {
    const resolved = testStateRoot("atomic-commit");
    openTestRunStore(resolved).close();
    const setup = new DatabaseSync(String(resolved.databasePath));
    setup.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE deferred_parent (id TEXT PRIMARY KEY) STRICT;
      CREATE TABLE deferred_commit_failure (
        id TEXT NOT NULL REFERENCES deferred_parent(id)
          DEFERRABLE INITIALLY DEFERRED
      ) STRICT;
      CREATE TRIGGER fail_start_commit
      AFTER INSERT ON operations WHEN NEW.kind = 'start'
      BEGIN
        INSERT INTO deferred_commit_failure(id) VALUES ('missing');
      END;
    `);
    setup.close();
    const store = openTestRunStore(resolved);
    const request = {
      stage: "abel-design",
      provisionalKey: "1".repeat(64),
      operationId: "commit-failure-start",
    };
    expect(() => store.startRun(request)).toThrow(/constraint failed/u);
    const failed = new DatabaseSync(String(resolved.databasePath));
    expect(rowCount(failed, "runs")).toBe(0);
    expect(rowCount(failed, "operations")).toBe(0);
    expect(rowCount(failed, "deferred_commit_failure")).toBe(0);
    failed.exec("DROP TRIGGER fail_start_commit");
    failed.close();
    expect(store.startRun(request)).toMatchObject({
      runId: expect.any(String),
    });
    store.close();
  });

  it("requires an explicit reset for a noncanonical private store", () => {
    const resolve = requiredFunction<
      (options: Record<string, unknown>) => Record<string, unknown>
    >(stateRootModule, "resolveStateRoot");
    const prepare = requiredFunction<
      (resolved: Record<string, unknown>) => Record<string, unknown>
    >(stateRootModule, "prepareStateRoot");
    const storeClass = requiredModule(runStoreModule, "RunStore").RunStore as {
      open(resolved: Record<string, unknown>): unknown;
    };
    const errorClass = requiredModule(runStoreModule, "RunStoreFormatError")
      .RunStoreFormatError as new (
      ...args: any[]
    ) => Error;
    const resolved = resolve({
      consumerRoot: temporaryRoot("noncanonical-store-consumer"),
      xdgStateHome: temporaryRoot("noncanonical-store-xdg"),
      homeDir: temporaryRoot("noncanonical-store-home"),
    });
    prepare(resolved);
    const database = new DatabaseSync(String(resolved.databasePath));
    database.exec(`
      CREATE TABLE old_state(value TEXT) STRICT;
      INSERT INTO old_state(value) VALUES ('preserved');
    `);
    database.close();

    let rejected: any;
    try {
      storeClass.open(resolved);
    } catch (error) {
      rejected = error;
    }
    expect(rejected).toBeInstanceOf(errorClass);
    expect(rejected).toMatchObject({
      code: "run-store-reset-required",
      databasePath: resolved.databasePath,
      recovery: {
        action: "reset-private-run-store",
        requiresBackup: true,
        retryCommand: "status-or-start",
      },
    });
    const preserved = new DatabaseSync(String(resolved.databasePath));
    expect(preserved.prepare("SELECT value FROM old_state").get()).toEqual({
      value: "preserved",
    });
    preserved.close();
  });

  it("does not initialize a foreign schema-less database as a current run store", () => {
    const resolve = requiredFunction<
      (options: Record<string, unknown>) => Record<string, unknown>
    >(stateRootModule, "resolveStateRoot");
    const prepare = requiredFunction<
      (resolved: Record<string, unknown>) => Record<string, unknown>
    >(stateRootModule, "prepareStateRoot");
    const storeClass = requiredModule(runStoreModule, "RunStore").RunStore as {
      open(resolved: Record<string, unknown>): unknown;
    };
    const resolved = resolve({
      consumerRoot: temporaryRoot("foreign-schema-consumer"),
      xdgStateHome: temporaryRoot("foreign-schema-xdg"),
      homeDir: temporaryRoot("foreign-schema-home"),
    });
    prepare(resolved);
    const database = new DatabaseSync(String(resolved.databasePath));
    database.exec("CREATE TABLE foreign_state(value TEXT) STRICT;");
    database.close();
    expect(() => storeClass.open(resolved)).toThrow(
      /run-store-reset-required/u,
    );
  });

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
        transition(input: Record<string, unknown>): Record<string, unknown>;
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
    expect(() =>
      store.transition({
        runId: created.runId,
        to: "paused",
        operationId: "start-001",
      }),
    ).toThrow(/operation-id-conflict/u);

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
