import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  DesignPlanValidationError,
  parseGateAReceipt,
  parseReadyReceipt,
} from "../src/delivery-compiler.ts";
import { DesignController } from "../src/design-control.ts";
import { DesignJournal } from "../src/design-journal.ts";
import {
  DISPATCH_TOOL,
  packageDeliverySource,
  registerWorkflowControl,
  type WorkflowControlEngine,
} from "../src/index.ts";
import {
  inspectOpenSpecDelivery,
  OpenSpecCliError,
} from "../src/openspec-cli.ts";
import { canonicalJson } from "../src/run-state.ts";
import { RunStore } from "../src/run-store.ts";
import { resolveStateRoot } from "../src/state-root.ts";
import { WorkflowEngine } from "../src/workflow-engine.ts";

const roots: string[] = [];
const BEHAVIOR_DECISION = "Closed delivery observable behavior";
const BEHAVIOR_APPROVAL = "Approved closed delivery WHAT contract";
const BEHAVIOR_HASH = createHash("sha256")
  .update("abel-design-gate-a\0")
  .update(BEHAVIOR_APPROVAL)
  .digest("hex");

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function verification(
  id: string,
  classification: "expected-red" | "expected-green",
) {
  return {
    kind: "static-check" as const,
    id,
    runner: { kind: "node" as const, script: "verify.mjs" },
    args: [],
    classification,
    ...(classification === "expected-red"
      ? { expectedFailure: "[DESIGN-DELIVERY:red]" }
      : {}),
  };
}

function planDraft(change: string) {
  const phase = (classification: "expected-red" | "expected-green") => ({
    read: ["src/value.ts", "verify.mjs"],
    write: ["src/value.ts"],
    delete: [],
    verification: verification(
      classification === "expected-red" ? "delivery-red" : "delivery-green",
      classification,
    ),
    verificationInputs: [{ kind: "workspace" as const, path: "verify.mjs" }],
  });
  return {
    changeId: change,
    tasks: [
      {
        taskId: "delivery-task",
        dependsOn: [],
        objective: "Close the Design delivery loop",
        context: { agents: "root", contract: "approved delivery" },
        roots: ["."],
        phases: {
          red: phase("expected-red"),
          green: phase("expected-green"),
        },
        scheduling: { conflicts: [], resources: ["design-delivery"] },
        agents: { impact: "none" as const, managedOnly: true as const },
        approvedDependencies: [],
        impactClosure: {
          changedSurfaces: ["none" as const],
          searchEvidence: [],
          relatedTests: [],
          affectedSuite: [],
        },
        affectedVerification: verification(
          "delivery-affected",
          "expected-green",
        ),
        repairVerification: verification("delivery-repair", "expected-green"),
      },
    ],
    outputs: [],
    verification: {
      baseline: {
        target: "task-red-contracts" as const,
        affected: "task-affected-contracts" as const,
        fullSuite: verification("delivery-baseline", "expected-green"),
        failureIdentity: "normalized" as const,
      },
      change: {
        affected: "task-affected-contracts" as const,
        fullSuite: verification("delivery-full", "expected-green"),
        postApply: verification("delivery-post-apply", "expected-green"),
      },
      artifactCorrection: { maxAttempts: 2 },
      repair: {
        maxAttempts: 2,
        inBoundaryOnly: true as const,
        approvalOnBoundaryExpansion: true as const,
        attribution: [
          "pre-existing",
          "introduced",
          "unresolved",
          "environment",
        ] as ["pre-existing", "introduced", "unresolved", "environment"],
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
      taskIds: ["delivery-task"],
      completionOwner: "parent" as const,
    },
  };
}

function fixture(label: string) {
  const consumerRoot = mkdtempSync(
    path.join(
      realpathSync(tmpdir()),
      `abel-design-delivery-consumer-${label}-`,
    ),
  );
  const stateHome = mkdtempSync(
    path.join(realpathSync(tmpdir()), `abel-design-delivery-state-${label}-`),
  );
  roots.push(consumerRoot, stateHome);
  const change = "close-design-delivery";
  const changeRoot = path.join(consumerRoot, "openspec/changes", change);
  mkdirSync(path.join(changeRoot, "specs/example"), { recursive: true });
  mkdirSync(path.join(consumerRoot, "src"), { recursive: true });
  writeFileSync(
    path.join(consumerRoot, "src/value.ts"),
    "export const value = 1;\n",
  );
  writeFileSync(path.join(consumerRoot, "verify.mjs"), "export {};\n");
  writeFileSync(path.join(changeRoot, "proposal.md"), "## Why\n\nClose it.\n");
  writeFileSync(path.join(changeRoot, "design.md"), "## Decisions\n\nOne.\n");
  writeFileSync(
    path.join(changeRoot, "specs/example/spec.md"),
    [
      "## ADDED Requirements",
      "",
      "### Requirement: Closed delivery",
      "",
      "The delivery is closed.",
      "",
      "#### Scenario: Delivery is finalized",
      "",
      "- **WHEN** both Gates are current",
      "- **THEN** ready is written last",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(changeRoot, "tasks.md"),
    [
      "## 1. Delivery",
      "",
      "- [ ] `delivery-task` implements delivery-red then delivery-green.",
      "  - Owns `specs/example/spec.md#Closed delivery/Delivery is finalized`",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(changeRoot, "plan-draft.json"),
    `${JSON.stringify(planDraft(change), null, 2)}\n`,
  );
  const artifactPaths = [
    "design.md",
    "proposal.md",
    "specs/example/spec.md",
    "tasks.md",
  ];
  const inspectOpenSpec = async () => ({
    change,
    schema: "spec-driven",
    planningComplete: true,
    strictValid: true,
    artifactPaths,
  });
  const stateRoot = resolveStateRoot({
    consumerRoot,
    xdgStateHome: stateHome,
  });
  const runs = RunStore.open(stateRoot);
  const run = runs.startRun({
    stage: "abel-design",
    change,
    operationId: "start-design",
  });
  runs.transition({
    runId: run.runId,
    to: "paused",
    operationId: "await-design",
    code: "design-awaiting-evidence",
  });
  runs.close();
  const controller = DesignController.open({
    consumerRoot,
    stateRoot,
    inspectOpenSpec,
  });
  return {
    consumerRoot,
    stateRoot,
    change,
    changeRoot,
    runId: run.runId,
    inspectOpenSpec,
    controller,
  };
}

async function approveAndCompile(
  item: ReturnType<typeof fixture>,
): Promise<Record<string, unknown>> {
  await approveGateAOnly(item);
  const compiled = await item.controller.execute({
    operation: "compile-plan",
    runId: item.runId,
    operationId: "compile-v1",
  });
  await item.controller.execute({
    operation: "approve-gate",
    runId: item.runId,
    operationId: "approve-b-v1",
    gate: "gate-b",
  });
  return compiled;
}

async function approveGateAOnly(
  item: ReturnType<typeof fixture>,
): Promise<void> {
  await item.controller.execute({
    operation: "record-decision",
    runId: item.runId,
    operationId: "behavior-v1",
    decisionId: "observable-contract",
    category: "behavior",
    contract: BEHAVIOR_DECISION,
    refs: ["specs/example/spec.md#Closed delivery"],
  });
  await item.controller.execute({
    operation: "approve-gate",
    runId: item.runId,
    operationId: "approve-a-v1",
    gate: "gate-a",
    contract: BEHAVIOR_APPROVAL,
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function journeyControlEngine(
  item: ReturnType<typeof fixture>,
  phases: string[],
): { control: WorkflowControlEngine; designCalls: () => number } {
  const design = DesignController.open({
    consumerRoot: item.consumerRoot,
    stateRoot: item.stateRoot,
    inspectOpenSpec: item.inspectOpenSpec,
  });
  const workflow = WorkflowEngine.open({
    consumerRoot: item.consumerRoot,
    stateRoot: item.stateRoot,
    deliverySource: packageDeliverySource(item.consumerRoot, {
      inspectOpenSpec: item.inspectOpenSpec,
      verifyGateProof: (input) => design.verifyGateProof(input),
      verifyFinalizedDelivery: (input) => design.verifyFinalizedDelivery(input),
    }),
    worker: {
      runAttempt: async (input) => {
        phases.push(input.phase);
        if (phases.length === 1) {
          return {
            kind: "phase-committed" as const,
            artifactHash: "d".repeat(64),
            isolatedRevisionId: "e".repeat(64),
            exitCode: 1,
            classification: "expected-red" as const,
          };
        }
        if (phases.length === 2) {
          return {
            kind: "approval-needed" as const,
            code: "unapproved-dependency-change",
          };
        }
        return { kind: "paused" as const, code: "endpoint-unavailable" };
      },
      rebind: () => ({ ok: true as const, routeId: "fixture" }),
    },
    changeVerifier: {
      verify: async () => ({
        kind: "paused" as const,
        code: "verification-not-reached",
      }),
    },
  });
  let designCalls = 0;
  return {
    designCalls: () => designCalls,
    control: {
      execute: (command, _context, signal, onActivity) =>
        workflow.execute(command, signal, onActivity),
      executeDesign(request) {
        designCalls += 1;
        return design.execute(request);
      },
      assertDesignRun: (runId) => design.assertDesignRun(runId),
      recordDesignEvidence: (input) => design.recordEvidence(input),
      async close() {
        await workflow.close();
        design.close();
      },
    },
  };
}

function extensionJourneyHarness(
  consumerRoot: string,
  control: WorkflowControlEngine,
  initialPrompt: "abel-design" | "abel-implement" | "abel-diagnose",
) {
  const packageRoot = path.resolve(import.meta.dirname, "..");
  const handlers = new Map<string, (...args: any[]) => unknown>();
  let tool: any;
  let active = ["read", "bash", "edit"];
  const pi = {
    registerTool(definition: unknown) {
      tool = definition;
    },
    on(name: string, handler: (...args: any[]) => unknown) {
      handlers.set(name, handler);
    },
    getCommands: () =>
      (["abel-design", "abel-implement", "abel-diagnose"] as const).map(
        (name) => ({
          name,
          source: "prompt",
          sourceInfo: {
            origin: "package",
            baseDir: packageRoot,
            path: path.join(packageRoot, "prompts", `${name}.md`),
          },
        }),
      ),
    getActiveTools: () => [...active],
    setActiveTools(next: string[]) {
      active = [...next];
    },
  };
  registerWorkflowControl(pi as never, async () => control);
  const context = {
    cwd: consumerRoot,
    mode: "print",
    model: undefined,
    modelRegistry: {},
  };
  const invoke = (
    prompt: "abel-design" | "abel-implement" | "abel-diagnose",
  ) => {
    handlers.get("input")?.({ text: `/${prompt} ${itemChange}` });
    handlers.get("before_agent_start")?.(
      {
        prompt: `<abel-request>${itemChange}</abel-request> <!-- ABEL:PROMPT:${prompt} -->`,
      },
      context,
    );
  };
  const itemChange = "close-design-delivery";
  invoke(initialPrompt);
  return {
    active: () => [...active],
    context,
    handlers,
    invoke,
    async execute(id: string, params: unknown) {
      const result = await tool.execute(
        id,
        params,
        undefined,
        undefined,
        context,
      );
      return result.details as Record<string, unknown>;
    },
  };
}

describe("safe private Design artifact mutation", () => {
  it("owns provisional identity, change binding, and approval hashes in code", async () => {
    const consumerRoot = mkdtempSync(
      path.join(realpathSync(tmpdir()), "abel-design-lifecycle-consumer-"),
    );
    const stateHome = mkdtempSync(
      path.join(realpathSync(tmpdir()), "abel-design-lifecycle-state-"),
    );
    roots.push(consumerRoot, stateHome);
    mkdirSync(path.join(consumerRoot, "openspec/changes"), { recursive: true });
    const stateRoot = resolveStateRoot({
      consumerRoot,
      xdgStateHome: stateHome,
    });
    const controller = DesignController.open({
      consumerRoot,
      stateRoot,
      inspectOpenSpec: async (_root, change) => ({
        change,
        schema: "spec-driven",
        planningComplete: false,
        strictValid: false,
        artifactPaths: [],
      }),
    });
    const requirement = "Keep the raw requirement out of durable state";
    try {
      const started = await controller.execute({
        operation: "start",
        operationId: "start-from-requirement",
        requirement,
      });
      expect(started).toMatchObject({
        state: "paused",
        completed: false,
        pause: { code: "design-awaiting-gate-a" },
        runId: expect.any(String),
        legalOperations: ["status", "record-decision", "approve-gate"],
        packetActions: ["finish"],
      });
      const runId = String(started.runId);
      expect(
        await controller.execute({
          operation: "status",
          runId,
        }),
      ).toEqual(started);
      expect(
        await controller.execute({
          operation: "start",
          operationId: "start-from-requirement",
          requirement: `  ${requirement}\r\n`,
        }),
      ).toEqual(started);
      await expect(
        controller.execute({
          operation: "start",
          operationId: "start-from-requirement",
          requirement: "A conflicting normalized requirement",
        }),
      ).rejects.toThrow(/design-operation-conflict/u);

      const decision = await controller.execute({
        operation: "record-decision",
        runId,
        operationId: "record-behavior",
        decisionId: "observable-contract",
        category: "behavior",
        contract: "The workflow remains recoverable and non-blocking.",
        refs: ["proposal.md#What Changes"],
      });
      expect(decision).toMatchObject({
        decision: { contractHash: expect.stringMatching(/^[a-f0-9]{64}$/u) },
      });
      const approved = await controller.execute({
        operation: "approve-gate",
        runId,
        operationId: "approve-behavior",
        gate: "gate-a",
        contract: "Approved WHAT contract",
      });
      expect(approved).toMatchObject({
        proof: { contractHash: expect.stringMatching(/^[a-f0-9]{64}$/u) },
      });
      const bound = await controller.execute({
        operation: "bind-change",
        runId,
        operationId: "bind-friendly-design",
        change: "friendly-design-control",
      });
      expect(bound).toMatchObject({
        runId,
        change: "friendly-design-control",
        state: "paused",
        legalOperations: [
          "status",
          "record-decision",
          "write-artifact",
          "delete-artifact",
          "validate-plan-draft",
          "compile-plan",
        ],
        packetActions: ["finish"],
      });
      expect(
        await controller.execute({
          operation: "bind-change",
          runId,
          operationId: "bind-friendly-design",
          change: "friendly-design-control",
        }),
      ).toMatchObject({ runId, change: "friendly-design-control" });
      await expect(
        controller.execute({
          operation: "bind-change",
          runId,
          operationId: "bind-friendly-design",
          change: "conflicting-design-control",
        }),
      ).rejects.toThrow(/design-operation-conflict/u);

      const database = new DatabaseSync(stateRoot.databasePath, {
        readOnly: true,
      });
      const durable =
        JSON.stringify(database.prepare("SELECT * FROM runs").all()) +
        JSON.stringify(database.prepare("SELECT * FROM events").all()) +
        JSON.stringify(database.prepare("SELECT * FROM design_facts").all()) +
        JSON.stringify(
          database.prepare("SELECT * FROM design_operations").all(),
        ) +
        JSON.stringify(database.prepare("SELECT * FROM operations").all());
      database.close();
      expect(durable).not.toContain(requirement);
      expect(durable).not.toContain("Approved WHAT contract");
      expect(durable).not.toContain(
        "The workflow remains recoverable and non-blocking.",
      );
    } finally {
      controller.close();
    }
  });

  it.each([
    ["minimal", "x", false],
    ["English", "Design a durable run without changing the repository.", false],
    ["Chinese", "设计修复文档批次的 UNSUPPORTED_DOCUMENT_TYPE 误报。", true],
  ])(
    "starts, replays, and restores a %s requirement",
    async (_label, requirement, legacyV4) => {
      const consumerRoot = mkdtempSync(
        path.join(realpathSync(tmpdir()), "abel-design-start-input-consumer-"),
      );
      const stateHome = mkdtempSync(
        path.join(realpathSync(tmpdir()), "abel-design-start-input-state-"),
      );
      roots.push(consumerRoot, stateHome);
      const stateRoot = resolveStateRoot({
        consumerRoot,
        xdgStateHome: stateHome,
      });
      if (legacyV4) {
        RunStore.open(stateRoot).close();
        const legacy = new DatabaseSync(stateRoot.databasePath);
        legacy.exec(`
          CREATE TABLE schema_meta (
            version INTEGER PRIMARY KEY CHECK (version = 4)
          ) STRICT;
          INSERT INTO schema_meta(version) VALUES (4);
        `);
        legacy.close();
      }
      const controller = DesignController.open({
        consumerRoot,
        stateRoot,
        inspectOpenSpec: async () => {
          throw new Error("unexpected-openspec-inspection");
        },
      });
      try {
        const request = {
          operation: "start" as const,
          operationId: "input-start",
          requirement,
        };
        const started = await controller.execute(request);
        expect(started).toMatchObject({
          runId: expect.any(String),
          stage: "abel-design",
          state: "paused",
        });
        expect(await controller.execute(request)).toEqual(started);
        expect(
          await controller.execute({
            operation: "status",
            runId: String(started.runId),
          }),
        ).toEqual(started);
        expect(existsSync(path.join(consumerRoot, "openspec/changes"))).toBe(
          false,
        );

        const database = new DatabaseSync(stateRoot.databasePath, {
          readOnly: true,
        });
        const durable = JSON.stringify(
          database
            .prepare(
              `SELECT lookup_key, provisional_key, projection_json
             FROM runs`,
            )
            .all(),
        );
        if (legacyV4) {
          expect(
            database
              .prepare(
                "SELECT name FROM sqlite_master WHERE name = 'schema_meta'",
              )
              .get(),
          ).toBeUndefined();
        }
        database.close();
        expect(durable).not.toContain(requirement);
        expect(durable).toMatch(/[a-f0-9]{64}/u);
      } finally {
        controller.close();
      }
    },
  );

  it("replays the released v1.2.2 provisional hash without replacing its run or receipt", async () => {
    const consumerRoot = mkdtempSync(
      path.join(realpathSync(tmpdir()), "abel-design-v122-consumer-"),
    );
    const stateHome = mkdtempSync(
      path.join(realpathSync(tmpdir()), "abel-design-v122-state-"),
    );
    roots.push(consumerRoot, stateHome);
    const stateRoot = resolveStateRoot({
      consumerRoot,
      xdgStateHome: stateHome,
    });
    const requirement = "Preserve a released durable Design operation receipt";
    const operationId = "released-v122-start";
    const legacyHash = createHash("sha256")
      .update("abel-design-requirement-v1")
      .update("\0")
      .update(requirement)
      .digest("hex");
    const legacyStore = RunStore.open(stateRoot);
    const legacyRun = legacyStore.startRun({
      stage: "abel-design",
      provisionalKey: legacyHash,
      operationId,
    });
    legacyStore.transition({
      runId: legacyRun.runId,
      to: "paused",
      operationId: `design-await-gate-a-${createHash("sha256")
        .update(legacyRun.runId)
        .digest("hex")
        .slice(0, 32)}`,
      code: "design-awaiting-gate-a",
    });
    legacyStore.close();
    const legacyDatabase = new DatabaseSync(stateRoot.databasePath);
    legacyDatabase.exec(`
      CREATE TABLE schema_meta (
        version INTEGER PRIMARY KEY CHECK (version = 4)
      ) STRICT;
      INSERT INTO schema_meta(version) VALUES (4);
    `);
    legacyDatabase.close();

    const controller = DesignController.open({
      consumerRoot,
      stateRoot,
      inspectOpenSpec: async () => {
        throw new Error("unexpected-openspec-inspection");
      },
    });
    try {
      const replay = await controller.execute({
        operation: "start",
        operationId,
        requirement,
      });
      expect(replay).toMatchObject({
        runId: legacyRun.runId,
        state: "paused",
      });
      const database = new DatabaseSync(stateRoot.databasePath, {
        readOnly: true,
      });
      expect(
        Number(
          (database.prepare("SELECT COUNT(*) AS count FROM runs").get() as any)
            .count,
        ),
      ).toBe(1);
      expect(
        Number(
          (
            database
              .prepare("SELECT COUNT(*) AS count FROM operations")
              .get() as any
          ).count,
        ),
      ).toBe(2);
      expect(
        database
          .prepare("SELECT name FROM sqlite_master WHERE name = 'schema_meta'")
          .get(),
      ).toBeUndefined();
      database.close();
    } finally {
      controller.close();
    }
  });

  it("writes every admitted artifact kind with exact UTF-8 bytes", async () => {
    const item = fixture("artifact-write");
    await expect(
      item.controller.execute({
        operation: "write-artifact",
        runId: item.runId,
        operationId: "write-before-gate-a",
        path: "proposal.md",
        content: "premature\n",
      }),
    ).rejects.toThrow(/design-gate-a-required/u);
    await approveGateAOnly(item);
    const artifacts = new Map([
      [".openspec.yaml", "schema: spec-driven\n"],
      ["proposal.md", "## Why\n\n精确内容。\n"],
      ["design.md", "## Decisions\n\nBounded.\n"],
      ["tasks.md", "## Tasks\n\n- [ ] one\n"],
      [
        "specs/new-capability/nested-contract/spec.md",
        "## ADDED Requirements\n",
      ],
      ["plan-draft.json", '{"changeId":"artifact-write"}\n'],
    ]);

    let operation = 0;
    for (const [relative, content] of artifacts) {
      const outcome = await item.controller.execute({
        operation: "write-artifact",
        runId: item.runId,
        operationId: `write-artifact-${operation++}`,
        path: relative,
        content,
      });
      const bytes = Buffer.from(content, "utf8");
      expect(outcome).toEqual({
        operation: "write-artifact",
        runId: item.runId,
        path: relative,
        bytes: bytes.length,
        rawSha256: createHash("sha256").update(bytes).digest("hex"),
      });
      expect(readFileSync(path.join(item.changeRoot, relative))).toEqual(bytes);
    }
    item.controller.close();
  });

  it("rejects product, reserved, malformed, and oversized artifact targets before mutation", async () => {
    const item = fixture("artifact-forbidden");
    await approveGateAOnly(item);
    const productBefore = readFileSync(
      path.join(item.consumerRoot, "src/value.ts"),
    );
    for (const relative of [
      "src/value.ts",
      "../outside.md",
      "gate-a.yaml",
      "ready.yaml",
      "implement-plan.json",
      "specs/spec.md",
      "specs/.hidden/spec.md",
    ]) {
      await expect(
        item.controller.execute({
          operation: "write-artifact",
          runId: item.runId,
          operationId: `forbidden-${createHash("sha256")
            .update(relative)
            .digest("hex")
            .slice(0, 16)}`,
          path: relative,
          content: "must not be written\n",
        }),
      ).rejects.toThrow(/design-artifact-path-invalid/u);
    }
    await expect(
      item.controller.execute({
        operation: "write-artifact",
        runId: item.runId,
        operationId: "oversized-artifact",
        path: "proposal.md",
        content: "x".repeat(16 * 1024 * 1024 + 1),
      }),
    ).rejects.toThrow(/design-artifact-content-too-large/u);
    expect(readFileSync(path.join(item.consumerRoot, "src/value.ts"))).toEqual(
      productBefore,
    );
    expect(existsSync(path.join(item.changeRoot, "gate-a.yaml"))).toBe(false);
    expect(existsSync(path.join(item.changeRoot, "ready.yaml"))).toBe(false);
    expect(existsSync(path.join(item.changeRoot, "implement-plan.json"))).toBe(
      false,
    );
    item.controller.close();
  });

  it("deletes only an admitted regular file and replays without a second mutation", async () => {
    const item = fixture("artifact-delete-replay");
    await approveGateAOnly(item);
    const relative = "specs/obsolete/spec.md";
    await item.controller.execute({
      operation: "write-artifact",
      runId: item.runId,
      operationId: "write-obsolete-spec",
      path: relative,
      content: "obsolete\n",
    });
    const request = {
      operation: "delete-artifact" as const,
      runId: item.runId,
      operationId: "delete-obsolete-spec",
      path: relative,
    };
    const deleted = await item.controller.execute(request);
    expect(deleted).toMatchObject({
      operation: "delete-artifact",
      runId: item.runId,
      path: relative,
      deleted: true,
      rawSha256: createHash("sha256").update("obsolete\n").digest("hex"),
    });
    expect(existsSync(path.join(item.changeRoot, relative))).toBe(false);

    writeFileSync(path.join(item.changeRoot, relative), "replacement\n");
    await item.controller.execute({
      operation: "record-decision",
      runId: item.runId,
      operationId: "behavior-after-delete",
      decisionId: "observable-contract",
      category: "behavior",
      contract: "Changed observable contract after artifact deletion",
      refs: ["proposal.md#Changed"],
    });
    await expect(item.controller.execute(request)).resolves.toEqual(deleted);
    expect(readFileSync(path.join(item.changeRoot, relative), "utf8")).toBe(
      "replacement\n",
    );
    await expect(
      item.controller.execute({
        ...request,
        path: "proposal.md",
      }),
    ).rejects.toThrow(/design-operation-conflict/u);
    item.controller.close();
  });

  it("rejects a symlink component without writing through it", async () => {
    const item = fixture("artifact-symlink");
    await approveGateAOnly(item);
    const outside = mkdtempSync(
      path.join(realpathSync(tmpdir()), "abel-design-artifact-outside-"),
    );
    roots.push(outside);
    symlinkSync(
      outside,
      path.join(item.changeRoot, "specs/symlinked"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(
      item.controller.execute({
        operation: "write-artifact",
        runId: item.runId,
        operationId: "write-through-symlink",
        path: "specs/symlinked/spec.md",
        content: "escape\n",
      }),
    ).rejects.toThrow(/design-artifact-path-unsafe/u);
    expect(existsSync(path.join(outside, "spec.md"))).toBe(false);
    item.controller.close();
  });

  it("preflights a valid PlanDraft without installing or journaling a canonical plan", async () => {
    const item = fixture("plan-preflight");
    await approveGateAOnly(item);

    const validated = await item.controller.execute({
      operation: "validate-plan-draft",
      runId: item.runId,
    });

    expect(validated).toMatchObject({
      operation: "validate-plan-draft",
      runId: item.runId,
      valid: true,
      plan: {
        taskCount: 1,
        outputCount: 0,
        rawSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        canonicalHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    });
    expect(existsSync(path.join(item.changeRoot, "implement-plan.json"))).toBe(
      false,
    );
    expect(item.controller.status(item.runId).plan).toBeNull();
    item.controller.close();
  });

  it("reports the exact task, phase, field, and category for an invalid draft", async () => {
    const item = fixture("plan-preflight-diagnostic");
    await approveGateAOnly(item);
    const invalid = planDraft(item.change);
    (invalid.tasks[0]!.phases.green.verification.args as string[]) = [
      "--unsafe&&operator",
    ];
    writeFileSync(
      path.join(item.changeRoot, "plan-draft.json"),
      `${JSON.stringify(invalid, null, 2)}\n`,
    );

    try {
      await item.controller.execute({
        operation: "validate-plan-draft",
        runId: item.runId,
      });
      throw new Error("expected PlanDraft validation failure");
    } catch (error) {
      expect(error).toBeInstanceOf(DesignPlanValidationError);
      expect((error as DesignPlanValidationError).diagnostics).toContainEqual({
        code: "invalid-implement-graph",
        taskId: "delivery-task",
        phase: "green",
        field: "phases.green.verification",
        category: "verification-contract",
      });
    }
    expect(existsSync(path.join(item.changeRoot, "implement-plan.json"))).toBe(
      false,
    );
    item.controller.close();
  });

  it("does not install a compiled plan after its Design mutation lease expires", async () => {
    const item = fixture("compile-lease-expiry");
    await approveGateAOnly(item);
    item.controller.close();
    let now = 0;
    const expiring = DesignController.open({
      consumerRoot: item.consumerRoot,
      stateRoot: item.stateRoot,
      inspectOpenSpec: item.inspectOpenSpec,
      now: () => ++now,
      finalizationLeaseMs: 1,
    });
    await expect(
      expiring.execute({
        operation: "compile-plan",
        runId: item.runId,
        operationId: "compile-expired",
      }),
    ).rejects.toThrow(/design-finalization-lease-fenced/u);
    expect(existsSync(path.join(item.changeRoot, "implement-plan.json"))).toBe(
      false,
    );
    expiring.close();
  });
});

describe("explicit four-entrypoint approval round trip", () => {
  it("switches Implement to explicit Design and resumes the same run from a fresh extension context", async () => {
    const item = fixture("extension-approval-round-trip");
    await approveAndCompile(item);
    await item.controller.execute({
      operation: "finalize-delivery",
      runId: item.runId,
      operationId: "finalize-v1",
    });
    item.controller.close();

    const phases: string[] = [];
    const firstEngine = journeyControlEngine(item, phases);
    const first = extensionJourneyHarness(
      item.consumerRoot,
      firstEngine.control,
      "abel-implement",
    );
    const approval = await first.execute("implement-v1", {
      command: "start",
      stage: "abel-implement",
      change: item.change,
      operationId: "implement-v1",
    });
    expect(approval).toMatchObject({
      state: "approval-needed",
      deliveryRevision: 1,
      approval: {
        category: "dependency",
        requiredGates: ["gate-b"],
        designRequest: `/abel-design --change ${item.change}`,
      },
    });
    expect(firstEngine.designCalls()).toBe(0);
    expect(first.active()).toEqual(["read", "bash", "edit", DISPATCH_TOOL]);

    first.invoke("abel-design");
    expect(first.active()).toEqual(["read", DISPATCH_TOOL]);
    const designStart = await first.execute("design-v2", {
      action: "design",
      request: {
        operation: "start",
        change: item.change,
        operationId: "design-v2",
      },
    });
    const designRunId = String(designStart.runId);
    await first.execute("behavior-v2", {
      action: "design",
      request: {
        operation: "record-decision",
        runId: designRunId,
        operationId: "behavior-v2",
        decisionId: "observable-contract",
        category: "behavior",
        contract: BEHAVIOR_DECISION,
        refs: ["specs/example/spec.md#Closed delivery"],
      },
    });
    await first.execute("dependency-v2", {
      action: "design",
      request: {
        operation: "record-decision",
        runId: designRunId,
        operationId: "dependency-v2",
        decisionId: "dependency-authority",
        category: "technical",
        contract: "Approved dependency authority",
        refs: ["design.md#Decisions"],
      },
    });
    await first.execute("approve-a-v2", {
      action: "design",
      request: {
        operation: "approve-gate",
        runId: designRunId,
        operationId: "approve-a-v2",
        gate: "gate-a",
        contract: BEHAVIOR_APPROVAL,
      },
    });
    await first.execute("write-plan-v2", {
      action: "design",
      request: {
        operation: "write-artifact",
        runId: designRunId,
        operationId: "write-plan-v2",
        path: "plan-draft.json",
        content: `${JSON.stringify(planDraft(item.change), null, 2)}\n`,
      },
    });
    const compiled = await first.execute("compile-v2", {
      action: "design",
      request: {
        operation: "compile-plan",
        runId: designRunId,
        operationId: "compile-v2",
      },
    });
    const planHash = (compiled.plan as { canonicalHash: string } | undefined)
      ?.canonicalHash;
    expect(planHash).toMatch(/^[a-f0-9]{64}$/u);
    await first.execute("approve-b-v2", {
      action: "design",
      request: {
        operation: "approve-gate",
        runId: designRunId,
        operationId: "approve-b-v2",
        gate: "gate-b",
      },
    });
    const revised = await first.execute("finalize-v2", {
      action: "design",
      request: {
        operation: "finalize-delivery",
        runId: designRunId,
        operationId: "finalize-v2",
      },
    });
    expect(revised).toMatchObject({
      state: "completed",
      deliveryRevision: 2,
      receiptHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(first.active()).toEqual(["read", "bash", "edit"]);
    await first.handlers.get("session_shutdown")?.();

    const freshEngine = journeyControlEngine(item, phases);
    const fresh = extensionJourneyHarness(
      item.consumerRoot,
      freshEngine.control,
      "abel-implement",
    );
    const status = await fresh.execute("fresh-status", {
      command: "status",
      stage: "abel-implement",
      change: item.change,
    });
    expect(status).toMatchObject({
      runId: approval.runId,
      state: "approval-needed",
      legalCommands: ["status", "resume", "discard"],
      availableDelivery: {
        deliveryRevision: 2,
        receiptHash: revised.receiptHash,
      },
    });

    const resumed = await fresh.execute("implement-v2", {
      command: "resume",
      stage: "abel-implement",
      change: item.change,
      operationId: "implement-v2",
      deliveryRevision: 2,
      receiptHash: revised.receiptHash,
    });
    expect(resumed).toMatchObject({
      runId: approval.runId,
      deliveryRevision: 2,
      state: "paused",
      pause: { code: "endpoint-unavailable" },
    });
    expect(phases).toEqual(["red", "green", "green"]);
    await fresh.handlers.get("session_shutdown")?.();
  });
});

describe("code-owned Design delivery compilation", () => {
  it("compiles the fixed draft, binds Gate B, and finalizes ready last", async () => {
    const item = fixture("success");
    const compiled = await approveAndCompile(item);
    expect(compiled).toMatchObject({
      operation: "compile-plan",
      runId: item.runId,
      plan: {
        revision: 1,
        rawSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        canonicalHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    });
    expect(
      createHash("sha256")
        .update(readFileSync(path.join(item.changeRoot, "implement-plan.json")))
        .digest("hex"),
    ).toBe((compiled.plan as { rawSha256: string }).rawSha256);

    const finalized = await item.controller.execute({
      operation: "finalize-delivery",
      runId: item.runId,
      operationId: "finalize-v1",
    });
    expect(finalized).toMatchObject({
      operation: "finalize-delivery",
      runId: item.runId,
      state: "completed",
      completed: true,
      deliveryRevision: 1,
      receiptHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(() =>
      readFileSync(path.join(item.changeRoot, "plan-draft.json")),
    ).toThrow();

    const gateA = parseGateAReceipt(
      readFileSync(path.join(item.changeRoot, "gate-a.yaml")),
    );
    const ready = parseReadyReceipt(
      readFileSync(path.join(item.changeRoot, "ready.yaml")),
    );
    expect(gateA.approval).toMatchObject({
      revision: 1,
      contractHash: BEHAVIOR_HASH,
      recordHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(ready.approvals.gateB).toMatchObject({
      revision: 1,
      contractHash: ready.plan.canonicalHash,
      recordHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    item.controller.close();

    const reopened = DesignController.open({
      consumerRoot: item.consumerRoot,
      stateRoot: item.stateRoot,
      inspectOpenSpec: item.inspectOpenSpec,
    });
    const nextDesign = await reopened.execute({
      operation: "start",
      change: item.change,
      operationId: "start-design-revision-2",
    });
    expect(nextDesign).toMatchObject({
      stage: "abel-design",
      change: item.change,
      state: "paused",
      pause: { code: "design-awaiting-evidence" },
    });
    expect(nextDesign.runId).not.toBe(item.runId);
    reopened.close();
  });

  it("leaves no new ready receipt when final validation fails", async () => {
    const item = fixture("failure");
    await approveAndCompile(item);
    item.controller.close();
    const failing = DesignController.open({
      consumerRoot: item.consumerRoot,
      stateRoot: item.stateRoot,
      inspectOpenSpec: async () => ({
        change: item.change,
        schema: "spec-driven",
        planningComplete: true,
        strictValid: false,
        artifactPaths: [
          "design.md",
          "proposal.md",
          "specs/example/spec.md",
          "tasks.md",
        ],
      }),
    });
    await expect(
      failing.execute({
        operation: "finalize-delivery",
        runId: item.runId,
        operationId: "finalize-invalid",
      }),
    ).rejects.toThrow(/design-finalization-invalid/u);
    expect(() =>
      readFileSync(path.join(item.changeRoot, "ready.yaml")),
    ).toThrow();
    failing.close();
  });

  it("preserves OpenSpec launch diagnostics, suppresses dependent errors, and retries the same operation", async () => {
    const item = fixture("openspec-retry");
    await approveAndCompile(item);
    item.controller.close();
    let broken = true;
    const controller = DesignController.open({
      consumerRoot: item.consumerRoot,
      stateRoot: item.stateRoot,
      inspectOpenSpec: async () => {
        if (broken)
          throw new OpenSpecCliError("status", "spawn", "launch-failed", {
            systemCode: "ENOENT",
          });
        return item.inspectOpenSpec();
      },
    });
    const request = {
      operation: "finalize-delivery" as const,
      runId: item.runId,
      operationId: "retry-openspec",
    };
    try {
      await expect(controller.execute(request)).rejects.toMatchObject({
        diagnostics: ["design-openspec-unavailable"],
        openSpecDiagnostic: {
          command: "status",
          phase: "spawn",
          reason: "launch-failed",
          systemCode: "ENOENT",
        },
      });
      expect(existsSync(path.join(item.changeRoot, "ready.yaml"))).toBe(false);
      broken = false;
      await expect(controller.execute(request)).resolves.toMatchObject({
        state: "completed",
        deliveryRevision: 1,
      });
      const source = packageDeliverySource(item.consumerRoot, {
        inspectOpenSpec: item.inspectOpenSpec,
        verifyGateProof: (input) => controller.verifyGateProof(input),
        verifyFinalizedDelivery: (input) =>
          controller.verifyFinalizedDelivery(input),
      });
      await expect(
        source.discoverLatest({ stage: "abel-implement", change: item.change }),
      ).resolves.toMatchObject({ deliveryRevision: 1 });
      await expect(
        source.load({ stage: "abel-implement", change: item.change }),
      ).resolves.toMatchObject({ revision: 1, gate: "gate-b" });
    } finally {
      controller.close();
    }
  });

  it.skipIf(process.env.CADENCE_REAL_OPENSPEC !== "1")(
    "finalizes and admits a delivery through the real global CLI",
    async () => {
      const item = fixture("real-openspec");
      writeFileSync(
        path.join(item.consumerRoot, "openspec/config.yaml"),
        "schema: spec-driven\n",
      );
      writeFileSync(
        path.join(item.changeRoot, "proposal.md"),
        "## Why\n\nClose delivery.\n\n## What Changes\n\n- Add closed delivery.\n\n## Capabilities\n\n### New Capabilities\n- `example`: closed delivery.\n\n## Impact\n\nCLI only.\n",
      );
      const spec = path.join(item.changeRoot, "specs/example/spec.md");
      writeFileSync(
        spec,
        readFileSync(spec, "utf8").replace(
          "The delivery is closed.",
          "The delivery SHALL be closed.",
        ),
      );
      await approveAndCompile(item);
      item.controller.close();
      const controller = DesignController.open({
        consumerRoot: item.consumerRoot,
        stateRoot: item.stateRoot,
        inspectOpenSpec: inspectOpenSpecDelivery,
      });
      try {
        await expect(
          controller.execute({
            operation: "finalize-delivery",
            runId: item.runId,
            operationId: "real-finalize",
          }),
        ).resolves.toMatchObject({ state: "completed", deliveryRevision: 1 });
        const source = packageDeliverySource(item.consumerRoot, {
          verifyGateProof: (input) => controller.verifyGateProof(input),
          verifyFinalizedDelivery: (input) =>
            controller.verifyFinalizedDelivery(input),
        });
        const delivery = await source.discoverLatest({
          stage: "abel-implement",
          change: item.change,
        });
        expect(delivery).toMatchObject({ deliveryRevision: 1 });
        await expect(
          source.load({
            stage: "abel-implement",
            change: item.change,
            ...delivery,
          }),
        ).resolves.toMatchObject({ revision: 1, gate: "gate-b" });
      } finally {
        controller.close();
      }
    },
    60_000,
  );

  it("serializes competing finalization operations before receipt mutation", async () => {
    const item = fixture("finalization-overlap");
    await approveAndCompile(item);
    item.controller.close();
    const firstEntered = deferred();
    const releaseFirst = deferred();
    let inspections = 0;
    const inspectOpenSpec = async () => {
      inspections += 1;
      if (inspections === 1) {
        firstEntered.resolve();
        await releaseFirst.promise;
      }
      return item.inspectOpenSpec();
    };
    const firstController = DesignController.open({
      consumerRoot: item.consumerRoot,
      stateRoot: item.stateRoot,
      inspectOpenSpec,
    });
    const secondController = DesignController.open({
      consumerRoot: item.consumerRoot,
      stateRoot: item.stateRoot,
      inspectOpenSpec,
    });
    const first = firstController
      .execute({
        operation: "finalize-delivery",
        runId: item.runId,
        operationId: "finalize-owner",
      })
      .then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
    await firstEntered.promise;
    const second = await secondController
      .execute({
        operation: "finalize-delivery",
        runId: item.runId,
        operationId: "finalize-competitor",
      })
      .then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
    releaseFirst.resolve();
    const owner = await first;

    expect(second).toMatchObject({
      ok: false,
      error: expect.objectContaining({
        message: "design-finalization-busy",
      }),
    });
    expect(owner).toMatchObject({
      ok: true,
      value: { state: "completed", deliveryRevision: 1 },
    });
    expect(inspections).toBe(1);
    expect(
      parseReadyReceipt(readFileSync(path.join(item.changeRoot, "ready.yaml"))),
    ).toMatchObject({ deliveryRevision: 1 });
    firstController.close();
    secondController.close();
  });

  it("retains committed receipts and completes the run on finalization replay", async () => {
    const item = fixture("completion-replay");
    await approveAndCompile(item);
    const database = new DatabaseSync(item.stateRoot.databasePath);
    database.exec(`
      CREATE TRIGGER fail_design_completion
      BEFORE UPDATE OF state ON runs
      WHEN NEW.run_id = '${item.runId}' AND NEW.state = 'completed'
      BEGIN
        SELECT RAISE(ABORT, 'forced-design-completion-failure');
      END
    `);

    await expect(
      item.controller.execute({
        operation: "finalize-delivery",
        runId: item.runId,
        operationId: "finalize-v1",
      }),
    ).rejects.toThrow(/forced-design-completion-failure/u);
    expect(() =>
      parseReadyReceipt(readFileSync(path.join(item.changeRoot, "ready.yaml"))),
    ).not.toThrow();

    database.exec("DROP TRIGGER fail_design_completion");
    const replay = await item.controller.execute({
      operation: "finalize-delivery",
      runId: item.runId,
      operationId: "finalize-v1",
    });
    expect(replay).toMatchObject({ state: "completed", completed: true });
    const runs = RunStore.open(item.stateRoot);
    expect(runs.status(item.runId).state).toBe("completed");
    runs.close();
    database.close();
    item.controller.close();
  });
});

describe("private Gate proofs bind Implement admission", () => {
  it("rejects a noncanonical receipt before starting a Worker", async () => {
    const item = fixture("noncanonical-receipt");
    await approveAndCompile(item);
    await item.controller.execute({
      operation: "finalize-delivery",
      runId: item.runId,
      operationId: "finalize-v1",
    });

    for (const name of ["gate-a.yaml", "ready.yaml"]) {
      const target = path.join(item.changeRoot, name);
      const receipt = JSON.parse(readFileSync(target, "utf8"));
      receipt.unknownField = true;
      writeFileSync(target, `${canonicalJson(receipt)}\n`);
    }

    const journal = DesignJournal.open(item.stateRoot);
    const source = packageDeliverySource(item.consumerRoot, {
      inspectOpenSpec: item.inspectOpenSpec,
      verifyGateProof: (input) => journal.verifyGateProof(input),
      verifyFinalizedDelivery: (input) =>
        journal.verifyFinalizedDelivery(input),
    });
    let workerCalls = 0;
    const engine = WorkflowEngine.open({
      consumerRoot: item.consumerRoot,
      stateRoot: item.stateRoot,
      deliverySource: source,
      worker: {
        runAttempt: async () => {
          workerCalls += 1;
          return { kind: "paused" as const, code: "worker-must-not-run" };
        },
        rebind: () => ({ ok: true as const, routeId: "fixture" }),
      },
      changeVerifier: {
        verify: async () => ({
          kind: "paused" as const,
          code: "verification-must-not-run",
        }),
      },
    });
    const expectedDiagnostics = [
      "delivery-receipt-invalid",
      "delivery-recompile-required",
    ];
    await expect(
      engine.execute({
        command: "start",
        stage: "abel-implement",
        change: item.change,
        operationId: "noncanonical-start",
      }),
    ).resolves.toMatchObject({
      state: "paused",
      completed: false,
      pause: { code: "delivery-invalid" },
      delivery: {
        code: "delivery-invalid",
        diagnostics: expectedDiagnostics,
      },
      tasks: [],
    });
    await expect(
      engine.execute({
        command: "status",
        stage: "abel-implement",
        change: item.change,
      }),
    ).resolves.toMatchObject({
      state: "paused",
      delivery: {
        code: "delivery-invalid",
        diagnostics: expectedDiagnostics,
      },
      legalCommands: ["status", "resume", "discard"],
    });
    expect(workerCalls).toBe(0);
    await engine.close();
    journal.close();
    item.controller.close();
  });

  it("discovers a proof-bound receipt locally without treating it as full admission", async () => {
    const item = fixture("delivery-discovery");
    await approveAndCompile(item);
    const finalized = await item.controller.execute({
      operation: "finalize-delivery",
      runId: item.runId,
      operationId: "finalize-v1",
    });
    const journal = DesignJournal.open(item.stateRoot);
    const source = packageDeliverySource(item.consumerRoot, {
      inspectOpenSpec: item.inspectOpenSpec,
      verifyGateProof: (input) => journal.verifyGateProof(input),
      verifyFinalizedDelivery: (input) =>
        journal.verifyFinalizedDelivery(input),
    });
    await expect(
      source.discoverLatest({
        stage: "abel-implement",
        change: item.change,
      }),
    ).resolves.toEqual({
      deliveryRevision: 1,
      receiptHash: finalized.receiptHash,
    });

    writeFileSync(path.join(item.changeRoot, "proposal.md"), "tampered\n");
    await expect(
      source.discoverLatest({
        stage: "abel-implement",
        change: item.change,
      }),
    ).resolves.toEqual({
      deliveryRevision: 1,
      receiptHash: finalized.receiptHash,
    });
    await expect(
      source.load({ stage: "abel-implement", change: item.change }),
    ).rejects.toMatchObject({
      diagnostics: expect.arrayContaining([
        "delivery-artifact-hash-mismatch:proposal.md",
      ]),
    });
    journal.close();
    item.controller.close();
  });

  it("accepts both current proofs and rejects a repository-only forgery", async () => {
    const item = fixture("admission");
    await approveAndCompile(item);
    await item.controller.execute({
      operation: "finalize-delivery",
      runId: item.runId,
      operationId: "finalize-v1",
    });
    const journal = DesignJournal.open(item.stateRoot);
    const source = packageDeliverySource(item.consumerRoot, {
      inspectOpenSpec: item.inspectOpenSpec,
      verifyGateProof: (input) => journal.verifyGateProof(input),
      verifyFinalizedDelivery: (input) =>
        journal.verifyFinalizedDelivery(input),
    });
    await expect(
      source.load({ stage: "abel-implement", change: item.change }),
    ).resolves.toMatchObject({
      revision: 1,
      approvalProofs: {
        gateA: { recordHash: expect.stringMatching(/^[a-f0-9]{64}$/u) },
        gateB: { recordHash: expect.stringMatching(/^[a-f0-9]{64}$/u) },
      },
    });

    const engine = WorkflowEngine.open({
      consumerRoot: item.consumerRoot,
      stateRoot: item.stateRoot,
      deliverySource: source,
      worker: {
        runAttempt: async () => ({
          kind: "paused" as const,
          code: "endpoint-unavailable",
        }),
        rebind: () => ({ ok: true as const, routeId: "fixture" }),
      },
      changeVerifier: {
        verify: async () => ({
          kind: "paused" as const,
          code: "verification-not-reached",
        }),
      },
    });
    const admitted = await engine.execute({
      command: "start",
      stage: "abel-implement",
      change: item.change,
      operationId: "implement-with-both-proofs",
    });
    expect(admitted).toMatchObject({
      state: "paused",
      deliveryBindings: [
        {
          gate: "gate-a",
          revision: 1,
          approvalProof: {
            recordHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
          },
        },
        {
          gate: "gate-b",
          revision: 1,
          approvalProof: {
            recordHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
          },
        },
      ],
    });
    await engine.close();

    const readyPath = path.join(item.changeRoot, "ready.yaml");
    const forged = JSON.parse(readFileSync(readyPath, "utf8"));
    forged.approvals.gateB.recordHash = "f".repeat(64);
    writeFileSync(readyPath, `${canonicalJson(forged)}\n`);
    await expect(
      source.load({ stage: "abel-implement", change: item.change }),
    ).rejects.toMatchObject({
      diagnostics: expect.arrayContaining(["delivery-gate-b-proof-invalid"]),
    });

    const original = JSON.parse(
      canonicalJson(parseReadyReceipt(readFileSync(readyPath))),
    );
    original.approvals.gateB.recordHash = (
      await item.controller.status(item.runId)
    ).gates.gateB.proof?.recordHash;
    original.deliveryRevision = 2;
    writeFileSync(readyPath, `${canonicalJson(original)}\n`);
    await expect(
      source.discoverLatest({
        stage: "abel-implement",
        change: item.change,
      }),
    ).resolves.toBeUndefined();
    await expect(
      source.load({ stage: "abel-implement", change: item.change }),
    ).rejects.toMatchObject({
      diagnostics: expect.arrayContaining([
        "delivery-finalization-proof-invalid",
      ]),
    });
    journal.close();
    item.controller.close();
  });

  it("finalizes a newer Design receipt and resumes the original Implement run", async () => {
    const item = fixture("same-run-handoff");
    await approveAndCompile(item);
    await item.controller.execute({
      operation: "finalize-delivery",
      runId: item.runId,
      operationId: "finalize-v1",
    });
    item.controller.close();

    const journal = DesignJournal.open(item.stateRoot);
    const source = packageDeliverySource(item.consumerRoot, {
      inspectOpenSpec: item.inspectOpenSpec,
      verifyGateProof: (input) => journal.verifyGateProof(input),
      verifyFinalizedDelivery: (input) =>
        journal.verifyFinalizedDelivery(input),
    });
    const phases: string[] = [];
    const engine = WorkflowEngine.open({
      consumerRoot: item.consumerRoot,
      stateRoot: item.stateRoot,
      deliverySource: source,
      worker: {
        runAttempt: async (input) => {
          phases.push(input.phase);
          if (phases.length === 1) {
            return {
              kind: "phase-committed" as const,
              artifactHash: "d".repeat(64),
              isolatedRevisionId: "e".repeat(64),
              exitCode: 1,
              classification: "expected-red" as const,
            };
          }
          if (phases.length === 2) {
            return {
              kind: "approval-needed" as const,
              code: "unapproved-dependency-change",
            };
          }
          return { kind: "paused" as const, code: "endpoint-unavailable" };
        },
        rebind: () => ({ ok: true as const, routeId: "fixture" }),
      },
      changeVerifier: {
        verify: async () => ({
          kind: "paused" as const,
          code: "verification-not-reached",
        }),
      },
    });
    const approval = await engine.execute({
      command: "start",
      stage: "abel-implement",
      change: item.change,
      operationId: "implement-v1",
    });
    expect(approval).toMatchObject({
      state: "approval-needed",
      deliveryRevision: 1,
      approval: {
        category: "dependency",
        requiredGates: ["gate-b"],
        designRequest: `/abel-design --change ${item.change}`,
      },
    });

    const design = DesignController.open({
      consumerRoot: item.consumerRoot,
      stateRoot: item.stateRoot,
      inspectOpenSpec: item.inspectOpenSpec,
    });
    const nextDesign = await design.execute({
      operation: "start",
      change: item.change,
      operationId: "design-v2",
    });
    writeFileSync(
      path.join(item.changeRoot, "plan-draft.json"),
      `${JSON.stringify(planDraft(item.change), null, 2)}\n`,
    );
    await design.execute({
      operation: "record-decision",
      runId: nextDesign.runId,
      operationId: "behavior-v2",
      decisionId: "observable-contract",
      category: "behavior",
      contract: BEHAVIOR_DECISION,
      refs: ["specs/example/spec.md#Closed delivery"],
    });
    await design.execute({
      operation: "record-decision",
      runId: nextDesign.runId,
      operationId: "dependency-v2",
      decisionId: "dependency-authority",
      category: "technical",
      contract: "Approved dependency authority",
      refs: ["design.md#Decisions"],
    });
    await design.execute({
      operation: "approve-gate",
      runId: nextDesign.runId,
      operationId: "approve-a-v2",
      gate: "gate-a",
      contract: BEHAVIOR_APPROVAL,
    });
    await design.execute({
      operation: "compile-plan",
      runId: nextDesign.runId,
      operationId: "compile-v2",
    });
    await design.execute({
      operation: "approve-gate",
      runId: nextDesign.runId,
      operationId: "approve-b-v2",
      gate: "gate-b",
    });
    const revised = await design.execute({
      operation: "finalize-delivery",
      runId: nextDesign.runId,
      operationId: "finalize-v2",
    });
    expect(revised).toMatchObject({ deliveryRevision: 2 });
    design.close();

    const freshStatus = await engine.execute({
      command: "status",
      stage: "abel-implement",
      change: item.change,
    });
    expect(freshStatus).toMatchObject({
      runId: approval.runId,
      state: "approval-needed",
      legalCommands: ["status", "resume", "discard"],
      availableDelivery: {
        deliveryRevision: 2,
        receiptHash: revised.receiptHash,
      },
      conditionalCommands: [
        {
          command: "resume",
          satisfiedBy: {
            deliveryRevision: 2,
            receiptHash: revised.receiptHash,
          },
        },
      ],
    });

    const resumed = await engine.execute({
      command: "resume",
      stage: "abel-implement",
      change: item.change,
      operationId: "implement-v2",
      deliveryRevision: 2,
      receiptHash: revised.receiptHash,
    });
    expect(resumed).toMatchObject({
      runId: approval.runId,
      deliveryRevision: 2,
      state: "paused",
      pause: { code: "endpoint-unavailable" },
    });
    expect(phases).toEqual(["red", "green", "green"]);
    await engine.close();
    journal.close();
  });

  it("requires both Gates when observable behavior authority is missing", async () => {
    const item = fixture("behavior-handoff");
    await approveAndCompile(item);
    await item.controller.execute({
      operation: "finalize-delivery",
      runId: item.runId,
      operationId: "finalize-v1",
    });
    item.controller.close();
    const journal = DesignJournal.open(item.stateRoot);
    const engine = WorkflowEngine.open({
      consumerRoot: item.consumerRoot,
      stateRoot: item.stateRoot,
      deliverySource: packageDeliverySource(item.consumerRoot, {
        inspectOpenSpec: item.inspectOpenSpec,
        verifyGateProof: (input) => journal.verifyGateProof(input),
        verifyFinalizedDelivery: (input) =>
          journal.verifyFinalizedDelivery(input),
      }),
      worker: {
        runAttempt: async () => ({
          kind: "approval-needed" as const,
          code: "behavior-contract-insufficient",
        }),
        rebind: () => ({ ok: true as const }),
      },
      changeVerifier: {
        verify: async () => ({ kind: "paused" as const, code: "unused" }),
      },
    });
    await expect(
      engine.execute({
        command: "start",
        stage: "abel-implement",
        change: item.change,
        operationId: "behavior-approval",
      }),
    ).resolves.toMatchObject({
      state: "approval-needed",
      legalCommands: ["status", "discard"],
      approval: {
        category: "observable-behavior",
        requiredGates: ["gate-a", "gate-b"],
        designRequest: `/abel-design --change ${item.change}`,
      },
    });
    await engine.close();
    journal.close();
  });

  it("classifies an empty runtime write contract as a Gate-B path boundary", async () => {
    const item = fixture("empty-runtime-write-contract");
    await approveAndCompile(item);
    await item.controller.execute({
      operation: "finalize-delivery",
      runId: item.runId,
      operationId: "finalize-v1",
    });
    item.controller.close();
    const journal = DesignJournal.open(item.stateRoot);
    const engine = WorkflowEngine.open({
      consumerRoot: item.consumerRoot,
      stateRoot: item.stateRoot,
      deliverySource: packageDeliverySource(item.consumerRoot, {
        inspectOpenSpec: item.inspectOpenSpec,
        verifyGateProof: (input) => journal.verifyGateProof(input),
        verifyFinalizedDelivery: (input) =>
          journal.verifyFinalizedDelivery(input),
      }),
      worker: {
        runAttempt: async () => ({
          kind: "approval-needed" as const,
          code: "task-write-set-empty",
        }),
        rebind: () => ({ ok: true as const }),
      },
      changeVerifier: {
        verify: async () => ({ kind: "paused" as const, code: "unused" }),
      },
    });
    await expect(
      engine.execute({
        command: "start",
        stage: "abel-implement",
        change: item.change,
        operationId: "empty-write-contract",
      }),
    ).resolves.toMatchObject({
      state: "approval-needed",
      approval: {
        category: "path-boundary",
        requiredGates: ["gate-b"],
      },
    });
    await engine.close();
    journal.close();
  });

  it.each([
    {
      code: "conflict-resource-authority-insufficient",
      category: "conflict-resource",
      requiredGates: ["gate-b"],
    },
    {
      code: "irreversible-scope-insufficient",
      category: "irreversible-scope",
      requiredGates: ["gate-a", "gate-b"],
    },
  ] as const)(
    "maps $code without keyword inference",
    async ({ code, category, requiredGates }) => {
      const item = fixture(`approval-map-${category}`);
      await approveAndCompile(item);
      await item.controller.execute({
        operation: "finalize-delivery",
        runId: item.runId,
        operationId: "finalize-v1",
      });
      item.controller.close();
      const journal = DesignJournal.open(item.stateRoot);
      const engine = WorkflowEngine.open({
        consumerRoot: item.consumerRoot,
        stateRoot: item.stateRoot,
        deliverySource: packageDeliverySource(item.consumerRoot, {
          inspectOpenSpec: item.inspectOpenSpec,
          verifyGateProof: (input) => journal.verifyGateProof(input),
          verifyFinalizedDelivery: (input) =>
            journal.verifyFinalizedDelivery(input),
        }),
        worker: {
          runAttempt: async () => ({
            kind: "approval-needed" as const,
            code,
          }),
          rebind: () => ({ ok: true as const }),
        },
        changeVerifier: {
          verify: async () => ({ kind: "paused" as const, code: "unused" }),
        },
      });
      await expect(
        engine.execute({
          command: "start",
          stage: "abel-implement",
          change: item.change,
          operationId: `approval-map-${category}`,
        }),
      ).resolves.toMatchObject({
        state: "approval-needed",
        approval: { category, requiredGates: [...requiredGates] },
      });
      await engine.close();
      journal.close();
    },
  );

  it("turns an unknown approval code into an integrity pause", async () => {
    const item = fixture("unknown-approval-code");
    await approveAndCompile(item);
    await item.controller.execute({
      operation: "finalize-delivery",
      runId: item.runId,
      operationId: "finalize-v1",
    });
    item.controller.close();
    const journal = DesignJournal.open(item.stateRoot);
    const engine = WorkflowEngine.open({
      consumerRoot: item.consumerRoot,
      stateRoot: item.stateRoot,
      deliverySource: packageDeliverySource(item.consumerRoot, {
        inspectOpenSpec: item.inspectOpenSpec,
        verifyGateProof: (input) => journal.verifyGateProof(input),
        verifyFinalizedDelivery: (input) =>
          journal.verifyFinalizedDelivery(input),
      }),
      worker: {
        runAttempt: async () => ({
          kind: "approval-needed" as const,
          code: "invented-boundary-gap",
        }),
        rebind: () => ({ ok: true as const }),
      },
      changeVerifier: {
        verify: async () => ({ kind: "paused" as const, code: "unused" }),
      },
    });
    await expect(
      engine.execute({
        command: "start",
        stage: "abel-implement",
        change: item.change,
        operationId: "unknown-approval-code",
      }),
    ).resolves.toMatchObject({
      state: "paused",
      pause: { code: "approval-code-invalid" },
    });
    const status = await engine.execute({
      command: "status",
      stage: "abel-implement",
      change: item.change,
    });
    expect(status).not.toHaveProperty("approval");
    await engine.close();
    journal.close();
  });
});
