import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

import { runChildSession } from "../src/child-session.ts";
import {
  assessDeliveryTraceability,
  compileGateAReceipt,
  compileImplementPlan,
  compileReadyReceipt,
  DeliveryValidationError,
  type ImplementPlan,
  parseGateAReceipt,
  parseReadyReceipt,
} from "../src/delivery-compiler.ts";
import { DesignJournal } from "../src/design-journal.ts";
import {
  runtimeForProvider,
  runtimeForWorkerRoute,
} from "../src/parent-provider.ts";
import { parseRoutePolicy } from "../src/route-policy.ts";
import { RunStore } from "../src/run-store.ts";
import { resolveStateRoot } from "../src/state-root.ts";
import { RunWorkerBroker } from "../src/worker-broker.ts";
import { PassthroughParentPayloadBridge } from "./helpers/passthrough-parent-payload-bridge.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function policy(primaryModel = "primary-worker") {
  const roles = [
    "design-explorer",
    "implementation-worker",
    "diagnosis-worker",
  ];
  const parsed = parseRoutePolicy({
    version: 2,
    routes: {
      primary: {
        kind: "custom",
        url: "https://primary.worker.invalid/v1",
        model: primaryModel,
        dialect: "openai-responses",
        apiKeyEnv: "PRIVATE_WORKER_KEY",
        capabilities: {
          roles,
          dialects: ["openai-responses"],
          contextWindow: 256_000,
          maxTokens: 128_000,
        },
      },
      inherited: {
        kind: "inherited",
        capabilities: {
          roles,
          dialects: ["openai-responses"],
          contextWindow: 256_000,
          maxTokens: 128_000,
        },
      },
    },
    roles: Object.fromEntries(
      roles.map((role) => [role, ["primary", "inherited"]]),
    ),
  });
  if (!parsed.ok) throw new Error("route fixture must parse");
  return parsed.policy;
}

function packagePlan(change: string) {
  const verification = (
    id: string,
    classification: "expected-red" | "expected-green",
  ) => ({
    kind: "vitest" as const,
    id,
    runner: {
      kind: "package-script" as const,
      packageManager: "bun" as const,
      script: "test:target",
      command: "vitest run",
    },
    testFiles: ["test/fixture.test.ts"],
    args: [],
    minTests: 1,
    classification,
    ...(classification === "expected-red"
      ? { expectedFailure: "package-loader-red" }
      : {}),
  });
  const phase = (name: "red" | "green") => ({
    read: ["package.json", "test/fixture.test.ts", "value.txt"],
    write: ["value.txt"],
    delete: [],
    verification: verification(
      `package-loader-${name}`,
      name === "red" ? "expected-red" : "expected-green",
    ),
    verificationInputs: [
      { kind: "workspace" as const, path: "package.json" },
      { kind: "workspace" as const, path: "test/fixture.test.ts" },
    ],
    verificationLock: "package-loader-verification",
  });
  return {
    schemaVersion: 3 as const,
    changeId: change,
    tasks: [
      {
        taskId: "package-loader-task",
        dependsOn: [],
        objective: "Load the canonical package delivery",
        context: { agents: "root", contract: "approved package loader" },
        roots: ["."],
        phases: { red: phase("red"), green: phase("green") },
        affectedVerification: verification(
          "package-loader-affected",
          "expected-green",
        ),
        repairVerification: verification(
          "package-loader-repair",
          "expected-green",
        ),
        scheduling: { conflicts: [], resources: ["package-loader"] },
        agents: { impact: "none" as const, managedOnly: true as const },
        approvedDependencies: [],
        impactClosure: {
          changedSurfaces: ["none" as const],
          searchEvidence: [],
          relatedTests: [
            {
              path: "test/fixture.test.ts",
              disposition: "unaffected" as const,
              evidence: "package delivery fixture",
            },
          ],
          affectedSuite: ["test/fixture.test.ts"],
        },
      },
    ],
    outputs: [],
    verification: {
      baseline: {
        target: "task-red-contracts" as const,
        affected: "task-affected-contracts" as const,
        fullSuite: verification("package-full-baseline", "expected-green"),
        failureIdentity: "normalized-v1" as const,
      },
      change: {
        affected: "task-affected-contracts" as const,
        fullSuite: verification("package-full-change", "expected-green"),
        postApply: verification("package-post-apply", "expected-green"),
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
        ] as ["pre-existing", "introduced", "unresolved", "environment"],
      },
      agentsCheckpoint: {
        required: false,
        verification: null,
        operations: [],
      },
    },
    tracking: {
      path: "tasks.md" as const,
      format: "markdown-checkbox" as const,
      taskIds: ["package-loader-task"],
      completionOwner: "parent" as const,
    },
  };
}

function directEngineFixture(label: string) {
  const consumerRoot = mkdtempSync(
    path.join(tmpdir(), `cadence-direct-engine-${label}-consumer-`),
  );
  const stateBase = mkdtempSync(
    path.join(tmpdir(), `cadence-direct-engine-${label}-state-`),
  );
  const homeDir = mkdtempSync(
    path.join(tmpdir(), `cadence-direct-engine-${label}-home-`),
  );
  roots.push(consumerRoot, stateBase, homeDir);
  mkdirSync(path.join(consumerRoot, "test"), { recursive: true });
  writeFileSync(
    path.join(consumerRoot, "package.json"),
    `${JSON.stringify({ scripts: { "test:target": "vitest run" } })}\n`,
  );
  writeFileSync(
    path.join(consumerRoot, "test/fixture.test.ts"),
    "export {};\n",
  );
  writeFileSync(path.join(consumerRoot, "value.txt"), "base\n");
  execFileSync("git", ["init", "-q"], { cwd: consumerRoot });
  execFileSync("git", ["add", "."], { cwd: consumerRoot });
  return {
    consumerRoot,
    stateRoot: resolveStateRoot({
      consumerRoot,
      xdgStateHome: stateBase,
      homeDir,
    }),
  };
}

function writeTrustedDeliveryFixture(input: {
  consumerRoot: string;
  change: string;
}) {
  const changeRoot = path.join(
    input.consumerRoot,
    "openspec",
    "changes",
    input.change,
  );
  const specRelative = "specs/delivery-contract/spec.md";
  const artifacts = new Map<string, Buffer>([
    ["proposal.md", Buffer.from("# Proposal\n\nTrusted delivery.\n")],
    ["design.md", Buffer.from("# Design\n\nCode-owned receipt.\n")],
    [
      specRelative,
      Buffer.from(
        [
          "## ADDED Requirements",
          "",
          "### Requirement: Trusted delivery",
          "",
          "The delivery is complete.",
          "",
          "#### Scenario: Valid receipt",
          "",
          "- **WHEN** Implement loads the receipt",
          "- **THEN** every binding resolves",
          "",
        ].join("\n"),
      ),
    ],
    [
      "tasks.md",
      Buffer.from(
        [
          "# Tasks",
          "",
          "- [ ] `package-loader-task`",
          `  - \`${specRelative}#Trusted delivery/Valid receipt\``,
          "  - Verification: `package-loader-red`",
          "  - Verification: `package-loader-green`",
          "",
        ].join("\n"),
      ),
    ],
  ]);
  mkdirSync(path.join(changeRoot, "specs", "delivery-contract"), {
    recursive: true,
  });
  for (const [relative, bytes] of artifacts) {
    writeFileSync(path.join(changeRoot, relative), bytes);
  }
  const bindings = [...artifacts].map(([relative, bytes]) => ({
    path: relative,
    rawSha256: createHash("sha256").update(bytes).digest("hex"),
  }));
  const gateA = compileGateAReceipt({
    change: input.change,
    schema: "spec-driven",
    approval: {
      revision: 1,
      contractHash: "a".repeat(64),
      recordHash: "b".repeat(64),
    },
    artifacts: bindings.filter((binding) =>
      ["proposal.md", specRelative].includes(binding.path),
    ),
  });
  writeFileSync(path.join(changeRoot, "gate-a.yaml"), gateA.bytes);
  const compiled = compileImplementPlan(packagePlan(input.change), {
    consumerRoot: input.consumerRoot,
  });
  writeFileSync(path.join(changeRoot, "implement-plan.json"), compiled.bytes);
  const traceability = assessDeliveryTraceability({
    tasksMarkdown: artifacts.get("tasks.md")?.toString("utf8") ?? "",
    specs: [
      {
        path: specRelative,
        text: artifacts.get(specRelative)?.toString("utf8") ?? "",
      },
    ],
    plan: compiled.plan,
  });
  if (!traceability.ok) {
    throw new Error(
      `traceability fixture invalid: ${traceability.diagnostics}`,
    );
  }
  const ready = compileReadyReceipt({
    change: input.change,
    schema: "spec-driven",
    deliveryRevision: 1,
    gateA: { rawSha256: gateA.rawSha256 },
    gateB: {
      revision: 1,
      contractHash: compiled.planHash,
      recordHash: "c".repeat(64),
    },
    artifacts: bindings,
    compiledPlan: compiled,
    traceability: traceability.value,
  });
  writeFileSync(path.join(changeRoot, "ready.yaml"), ready.bytes);
  return {
    changeRoot,
    compiled,
    artifactPaths: bindings.map((binding) => binding.path).sort(),
    inspectOpenSpec: async () => ({
      change: input.change,
      schema: "spec-driven",
      planningComplete: true,
      strictValid: true,
      artifactPaths: bindings.map((binding) => binding.path).sort(),
    }),
  };
}

function bindTrustedDeliveryProofs(input: {
  consumerRoot: string;
  stateBase: string;
  change: string;
  trusted: ReturnType<typeof writeTrustedDeliveryFixture>;
}) {
  const stateRoot = resolveStateRoot({
    consumerRoot: input.consumerRoot,
    xdgStateHome: input.stateBase,
  });
  const runs = RunStore.open(stateRoot);
  const run = runs.startRun({
    stage: "abel-design",
    change: input.change,
    operationId: "fixture-design-start",
  });
  runs.transition({
    runId: run.runId,
    to: "paused",
    operationId: "fixture-design-paused",
  });
  const journal = DesignJournal.open(stateRoot);
  journal.recordDecision({
    runId: run.runId,
    operationId: "fixture-behavior",
    decisionId: "fixture-contract",
    category: "behavior",
    contract: "Trusted delivery behavior contract",
    refs: ["proposal.md"],
  });
  const gateA = journal.approveGate({
    runId: run.runId,
    operationId: "fixture-gate-a",
    gate: "gate-a",
    contract: "Approved trusted delivery WHAT contract",
  });
  journal.recordCompiledPlan({
    runId: run.runId,
    operationId: "fixture-plan",
    bytes: input.trusted.compiled.bytes,
    rawSha256: input.trusted.compiled.rawSha256,
    canonicalHash: input.trusted.compiled.planHash,
  });
  const gateB = journal.approveGate({
    runId: run.runId,
    operationId: "fixture-gate-b",
    gate: "gate-b",
  });
  const gateAPath = path.join(input.trusted.changeRoot, "gate-a.yaml");
  const readyPath = path.join(input.trusted.changeRoot, "ready.yaml");
  const priorGateA = parseGateAReceipt(readFileSync(gateAPath));
  const priorReady = parseReadyReceipt(readFileSync(readyPath));
  const nextGateA = compileGateAReceipt({
    change: input.change,
    schema: priorGateA.schema,
    approval: gateA.proof,
    artifacts: priorGateA.artifacts,
  });
  const nextReady = compileReadyReceipt({
    change: input.change,
    schema: priorReady.schema,
    deliveryRevision: priorReady.deliveryRevision,
    gateA: { rawSha256: nextGateA.rawSha256 },
    gateB: gateB.proof,
    artifacts: priorReady.artifacts,
    compiledPlan: input.trusted.compiled,
    traceability: priorReady.traceability,
  });
  writeFileSync(gateAPath, nextGateA.bytes);
  writeFileSync(readyPath, nextReady.bytes);
  const lease = journal.acquireFinalizationLease({
    runId: run.runId,
    operationId: "fixture-finalization",
  });
  journal.recordFinalization({
    runId: run.runId,
    operationId: "fixture-finalization",
    lease,
    deliveryRevision: 1,
    receiptHash: nextReady.rawSha256,
    gateA: gateA.proof,
    gateB: gateB.proof,
    planCanonicalHash: input.trusted.compiled.planHash,
  });
  journal.releaseFinalizationLease(lease);
  journal.close();
  runs.close();
}

describe("run-bound Worker attempts", () => {
  it("settles an inherited disposable child through the route broker", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "cadence-runtime-broker-"));
    roots.push(cwd);
    writeFileSync(path.join(cwd, "evidence.txt"), "trusted\n");
    const result = {
      id: "broker-evidence",
      role: "design-explorer",
      kind: "evidence",
      packet_id: "broker-evidence",
      module_name: "runtime-broker",
      scope: ["evidence.txt"],
      files_read: ["evidence.txt"],
      evidence: [
        {
          claim: "broker child settled",
          path: "evidence.txt",
          line_start: 1,
          line_end: 1,
        },
      ],
      existing_structures: [],
      existing_conventions: [],
      constraints_discovered: [],
      open_questions: [],
      dependencies: [],
      write_set_hints: [],
      validation_hints: [],
      agents_impact_hints: [],
      risks: [],
      success_criteria_hints: [],
    };
    const faux = fauxProvider({ provider: "runtime-broker-faux", api: "faux" });
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("abel_submit_result", result), {
        stopReason: "toolUse",
      }),
    ]);
    const modelRuntime = await runtimeForProvider(faux.provider);
    const context = {
      model: faux.getModel(),
      modelRegistry: new ModelRegistry(modelRuntime),
    };
    const broker = new RunWorkerBroker(policy());
    broker.rebind({
      runId: "inherited-child-run",
      role: "design-explorer",
      routeId: "inherited",
    });
    const execution = broker.run({
      runId: "inherited-child-run",
      operationId: "inherited-child-attempt",
      role: "design-explorer",
      execute: async (attempt) => {
        const phase = await runtimeForWorkerRoute(
          attempt.route,
          context,
          new PassthroughParentPayloadBridge(),
          attempt.signal,
        );
        if (!phase.ok) throw new Error(phase.error);
        attempt.onHeaders();
        const child = await runChildSession({
          cwd,
          modelRuntime: phase.modelRuntime,
          model: phase.model,
          systemPrompt: "Submit the supplied structural evidence.",
          requestId: "broker-evidence",
          role: "design-explorer",
          output: "evidence",
          roots: [cwd],
          allowedPaths: ["evidence.txt"],
          timeoutMs: 2_000,
          signal: attempt.signal,
          failureOverride: phase.failureOverride,
        });
        attempt.onProgress();
        return child;
      },
    });
    let diagnostic: ReturnType<typeof setTimeout> | undefined;
    const settled = await Promise.race([
      execution,
      new Promise<never>((_resolve, reject) => {
        diagnostic = setTimeout(
          () =>
            reject(
              new Error(
                `inherited child did not settle: calls=${faux.state.callCount}, pending=${faux.getPendingResponseCount()}`,
              ),
            ),
          3_000,
        );
      }),
    ]).finally(() => clearTimeout(diagnostic));
    expect(settled).toMatchObject({
      ok: true,
      routeId: "inherited",
      value: { ok: true, result },
    });
    expect(faux.state.callCount).toBe(1);
  });

  it("fails over only through declared routes without changing task identity", async () => {
    const broker = new RunWorkerBroker(policy());
    expect(
      broker.rebind({
        runId: "stable-run",
        role: "implementation-worker",
        routeId: "primary",
      }),
    ).toMatchObject({ ok: true, route: { id: "primary" } });
    const routes: string[] = [];
    const ledger = Object.freeze({
      runId: "stable-run",
      taskId: "stable-task",
      deliveryRevision: 4,
      currentPhase: "green",
    });
    const result = await broker.run({
      runId: ledger.runId,
      operationId: "green-attempt-001",
      role: "implementation-worker",
      requirements: { dialects: ["openai-responses"] },
      execute: async ({ route, onHeaders, onProgress }) => {
        routes.push(route.id);
        onHeaders();
        if (route.id === "primary") throw new Error("transport unavailable");
        onProgress();
        return { ledger, routeId: route.id };
      },
    });

    expect(result).toMatchObject({
      ok: true,
      routeId: "inherited",
      value: { ledger, routeId: "inherited" },
      attempts: [{ routeId: "primary", code: "transport-failure" }],
    });
    expect(routes).toEqual(["primary", "inherited"]);
    expect(broker.binding("stable-run", "implementation-worker")).toBe(
      "inherited",
    );
    expect(
      broker.resumeBinding({
        runId: "stable-run",
        role: "implementation-worker",
        routeId: "inherited",
      }),
    ).toMatchObject({ ok: true, route: { id: "inherited" } });
    expect(JSON.stringify(broker.status())).not.toMatch(
      /primary\.worker\.invalid|PRIVATE_WORKER_KEY/u,
    );
  });

  it("uses an explicit compatible rebind for the next disposable attempt", async () => {
    const broker = new RunWorkerBroker(policy());
    expect(
      broker.rebind({
        runId: "rebind-run",
        role: "implementation-worker",
        routeId: "inherited",
        requirements: { dialects: ["openai-responses"] },
      }),
    ).toMatchObject({ ok: true, route: { id: "inherited" } });
    expect(broker.binding("rebind-run", "implementation-worker")).toBe(
      "inherited",
    );

    const routes: string[] = [];
    await expect(
      broker.run({
        runId: "rebind-run",
        operationId: "replacement-attempt-001",
        role: "implementation-worker",
        execute: async ({ route, onHeaders, onProgress }) => {
          routes.push(route.id);
          onHeaders();
          onProgress();
          return { taskId: "same-task", accepted: true };
        },
      }),
    ).resolves.toMatchObject({
      ok: true,
      routeId: "inherited",
      value: { taskId: "same-task", accepted: true },
    });
    expect(routes).toEqual(["inherited"]);
  });

  it("forwards cancellation and accepts no partial attempt value", async () => {
    const broker = new RunWorkerBroker(policy());
    const controller = new AbortController();
    const running = broker.run({
      runId: "cancel-run",
      operationId: "cancel-attempt-001",
      role: "implementation-worker",
      signal: controller.signal,
      execute: async ({ signal, onHeaders }) => {
        onHeaders();
        return new Promise<{ partial: true }>((resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
          void resolve;
        });
      },
    });
    controller.abort(new Error("user cancellation"));

    await expect(running).resolves.toMatchObject({
      ok: false,
      state: "cancelled",
      code: "cancelled",
    });
    expect(await running).not.toHaveProperty("value");
  });
});

describe("durable WorkflowEngine service composition", () => {
  it("exports one workflow control entry without a compatibility selector", async () => {
    const module = (await import("../src/index.ts")) as Record<string, unknown>;
    expect(module.registerWorkflowControl).toBeTypeOf("function");
    expect(module.default).toBeTypeOf("function");
    expect(module).not.toHaveProperty("WORKFLOW_CONTROL_SELECTOR");
    expect(module).not.toHaveProperty("registerV1BootstrapControl");
    expect(module).not.toHaveProperty("registerWorkflowControlV2");
    expect(module.openPackageWorkflowControlEngine).toBeTypeOf("function");
  });

  it("forwards the owning Pi signal and context through the injected v2 engine", async () => {
    const module = (await import("../src/index.ts")) as Record<string, unknown>;
    const registerWorkflowControl = module.registerWorkflowControl as (
      pi: unknown,
      factory: unknown,
    ) => void;
    let registeredTool:
      | {
          execute(
            toolCallId: string,
            params: unknown,
            signal: AbortSignal,
            onUpdate: undefined,
            context: Record<string, unknown>,
          ): Promise<{ details: Record<string, unknown> }>;
        }
      | undefined;
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    let closeCalls = 0;
    let factoryContext: Record<string, unknown> | undefined;
    let executionContext: Record<string, unknown> | undefined;
    let executionSignal: AbortSignal | undefined;
    const pi = {
      registerTool(tool: typeof registeredTool) {
        registeredTool = tool;
      },
      on(name: string, handler: (...args: unknown[]) => unknown) {
        handlers.set(name, handler);
      },
      getActiveTools: () => [],
      setActiveTools() {},
    };
    registerWorkflowControl(pi, (context: Record<string, unknown>) => {
      factoryContext = context;
      return {
        async execute(
          _command: unknown,
          contextForOperation: Record<string, unknown>,
          signal: AbortSignal | undefined,
        ) {
          executionContext = contextForOperation;
          executionSignal = signal;
          return {
            state: signal?.aborted ? "paused" : "running",
            completed: false,
            signalBound: signal !== undefined,
            ...(signal?.aborted
              ? { pause: { code: "operation-cancelled" } }
              : {}),
          };
        },
        close() {
          closeCalls += 1;
        },
      };
    });
    expect(registeredTool).toBeDefined();
    const cwd = mkdtempSync(path.join(tmpdir(), "cadence-v2-tool-signal-"));
    roots.push(cwd);
    const context = { cwd, marker: "owning-tool-context" };
    const controller = new AbortController();
    controller.abort(new Error("fixture tool cancellation"));
    const result = await registeredTool?.execute(
      "tool-call-v2",
      {
        command: "start",
        stage: "abel-implement",
        change: "tool-signal-binding",
        operationId: "tool-signal-start",
      },
      controller.signal,
      undefined,
      context,
    );
    expect(result?.details).toMatchObject({
      state: "paused",
      completed: false,
      signalBound: true,
      pause: { code: "operation-cancelled" },
    });
    expect(factoryContext).toBe(context);
    expect(executionContext).toBe(context);
    expect(executionSignal).toBe(controller.signal);
    await handlers.get("session_shutdown")?.();
    expect(closeCalls).toBe(1);
  });

  it("binds runtime traceability to the exact spec artifact path", () => {
    const change = "traceability-spec-identity";
    const plan = packagePlan(change);
    const task = plan.tasks[0];
    expect(task).toBeDefined();
    if (!task) return;
    const traceability = assessDeliveryTraceability({
      tasksMarkdown: [
        "# Tasks",
        "",
        `- [ ] \`${task.taskId}\``,
        "  - `specs/nonexistent/spec.md#Trusted delivery/Valid receipt`",
        `  - Verification: \`${task.phases.red.verification.id}\``,
        `  - Verification: \`${task.phases.green.verification.id}\``,
        "",
      ].join("\n"),
      specs: [
        {
          path: "specs/delivery-contract/spec.md",
          text: [
            "### Requirement: Trusted delivery",
            "",
            "#### Scenario: Valid receipt",
            "",
          ].join("\n"),
        },
      ],
      plan,
    });

    expect(traceability).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        "traceability-reference-unresolved",
        "traceability-scenario-unowned",
      ]),
    });
  });

  it("loads only a fully covered canonical v2 delivery", async () => {
    const module = (await import("../src/index.ts")) as Record<string, unknown>;
    const packageDeliverySource = module.packageDeliverySource as
      | ((
          consumerRoot: string,
          options?: Record<string, unknown>,
        ) => {
          load(
            input: Record<string, unknown>,
          ): Promise<Record<string, unknown>>;
        })
      | undefined;
    expect(packageDeliverySource).toBeTypeOf("function");
    const consumerRoot = mkdtempSync(
      path.join(tmpdir(), "cadence-package-delivery-consumer-"),
    );
    roots.push(consumerRoot);
    const change = "canonical-package-delivery";
    mkdirSync(path.join(consumerRoot, "test"), { recursive: true });
    mkdirSync(path.join(consumerRoot, "node_modules/.bin"), {
      recursive: true,
    });
    writeFileSync(
      path.join(consumerRoot, "package.json"),
      `${JSON.stringify({ scripts: { "test:target": "vitest run" } })}\n`,
    );
    writeFileSync(
      path.join(consumerRoot, "test/fixture.test.ts"),
      "export {};\n",
    );
    writeFileSync(
      path.join(consumerRoot, "node_modules/.bin/vitest"),
      "#!/bin/sh\n",
    );
    chmodSync(path.join(consumerRoot, "node_modules/.bin/vitest"), 0o755);
    writeFileSync(path.join(consumerRoot, "value.txt"), "base\n");
    const trusted = writeTrustedDeliveryFixture({ consumerRoot, change });

    const delivery = await packageDeliverySource?.(consumerRoot, {
      inspectOpenSpec: trusted.inspectOpenSpec,
      verifyGateProof: () => true,
      verifyFinalizedDelivery: () => true,
    }).load({ stage: "abel-implement", change });
    expect(delivery).toMatchObject({
      version: 2,
      gate: "gate-b",
      revision: 1,
      receiptHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      plan: trusted.compiled.plan,
    });
  });

  it("aggregates private proof verifier failures as delivery diagnostics", async () => {
    const module = (await import("../src/index.ts")) as Record<string, unknown>;
    const packageDeliverySource = module.packageDeliverySource as (
      consumerRoot: string,
      options?: Record<string, unknown>,
    ) => {
      load(input: Record<string, unknown>): Promise<Record<string, unknown>>;
    };
    const consumerRoot = mkdtempSync(
      path.join(tmpdir(), "cadence-proof-verifier-failure-consumer-"),
    );
    roots.push(consumerRoot);
    const change = "proof-verifier-failure";
    mkdirSync(path.join(consumerRoot, "test"), { recursive: true });
    mkdirSync(path.join(consumerRoot, "node_modules/.bin"), {
      recursive: true,
    });
    writeFileSync(
      path.join(consumerRoot, "package.json"),
      `${JSON.stringify({ scripts: { "test:target": "vitest run" } })}\n`,
    );
    writeFileSync(
      path.join(consumerRoot, "test/fixture.test.ts"),
      "export {};\n",
    );
    writeFileSync(
      path.join(consumerRoot, "node_modules/.bin/vitest"),
      "#!/bin/sh\n",
    );
    chmodSync(path.join(consumerRoot, "node_modules/.bin/vitest"), 0o755);
    writeFileSync(path.join(consumerRoot, "value.txt"), "base\n");
    const trusted = writeTrustedDeliveryFixture({ consumerRoot, change });
    const source = packageDeliverySource(consumerRoot, {
      inspectOpenSpec: trusted.inspectOpenSpec,
      verifyGateProof: () => {
        throw new Error("private-gate-store-corrupt");
      },
      verifyFinalizedDelivery: () => {
        throw new Error("private-finalization-store-corrupt");
      },
    });

    await expect(
      source.load({ stage: "abel-implement", change }),
    ).rejects.toMatchObject({
      diagnostics: expect.arrayContaining([
        "delivery-gate-a-proof-invalid",
        "delivery-gate-b-proof-invalid",
        "delivery-finalization-proof-invalid",
      ]),
    });
  });

  it("accepts parent-owned task checkbox progress without weakening the delivery hash", async () => {
    const module = (await import("../src/index.ts")) as Record<string, unknown>;
    const packageDeliverySource = module.packageDeliverySource as (
      consumerRoot: string,
      options?: Record<string, unknown>,
    ) => {
      load(input: Record<string, unknown>): Promise<Record<string, unknown>>;
    };
    const consumerRoot = mkdtempSync(
      path.join(tmpdir(), "cadence-tracking-delivery-consumer-"),
    );
    roots.push(consumerRoot);
    const change = "tracking-package-delivery";
    mkdirSync(path.join(consumerRoot, "test"), { recursive: true });
    mkdirSync(path.join(consumerRoot, "node_modules/.bin"), {
      recursive: true,
    });
    writeFileSync(
      path.join(consumerRoot, "package.json"),
      `${JSON.stringify({ scripts: { "test:target": "vitest run" } })}\n`,
    );
    writeFileSync(
      path.join(consumerRoot, "test/fixture.test.ts"),
      "export {};\n",
    );
    writeFileSync(
      path.join(consumerRoot, "node_modules/.bin/vitest"),
      "#!/bin/sh\n",
    );
    chmodSync(path.join(consumerRoot, "node_modules/.bin/vitest"), 0o755);
    writeFileSync(path.join(consumerRoot, "value.txt"), "base\n");
    const trusted = writeTrustedDeliveryFixture({ consumerRoot, change });
    const tasksPath = path.join(trusted.changeRoot, "tasks.md");
    writeFileSync(
      tasksPath,
      readFileSync(tasksPath, "utf8").replace(
        "- [ ] `package-loader-task`",
        "- [x] `package-loader-task`",
      ),
    );
    const source = packageDeliverySource(consumerRoot, {
      inspectOpenSpec: trusted.inspectOpenSpec,
      verifyGateProof: () => true,
      verifyFinalizedDelivery: () => true,
    });
    await expect(
      source.load({ stage: "abel-implement", change }),
    ).resolves.toMatchObject({ version: 2, revision: 1 });

    writeFileSync(
      tasksPath,
      readFileSync(tasksPath, "utf8").replace(
        "Verification: `package-loader-green`",
        "Verification: `tampered-green`",
      ),
    );
    await expect(
      source.load({ stage: "abel-implement", change }),
    ).rejects.toMatchObject({
      diagnostics: expect.arrayContaining([
        "delivery-artifact-hash-mismatch:tasks.md",
      ]),
    });
  });

  it("reports all delivery revision gaps together before Worker execution", async () => {
    const module = (await import("../src/index.ts")) as Record<string, unknown>;
    const packageDeliverySource = module.packageDeliverySource as (
      consumerRoot: string,
      options?: Record<string, unknown>,
    ) => {
      load(input: Record<string, unknown>): Promise<Record<string, unknown>>;
    };
    const consumerRoot = mkdtempSync(
      path.join(tmpdir(), "cadence-invalid-delivery-consumer-"),
    );
    roots.push(consumerRoot);
    const change = "aggregate-delivery-gaps";
    mkdirSync(path.join(consumerRoot, "test"), { recursive: true });
    mkdirSync(path.join(consumerRoot, "node_modules/.bin"), {
      recursive: true,
    });
    writeFileSync(
      path.join(consumerRoot, "package.json"),
      `${JSON.stringify({ scripts: { "test:target": "vitest run" } })}\n`,
    );
    writeFileSync(
      path.join(consumerRoot, "test/fixture.test.ts"),
      "export {};\n",
    );
    writeFileSync(
      path.join(consumerRoot, "node_modules/.bin/vitest"),
      "#!/bin/sh\n",
    );
    chmodSync(path.join(consumerRoot, "node_modules/.bin/vitest"), 0o755);
    writeFileSync(path.join(consumerRoot, "value.txt"), "base\n");
    const trusted = writeTrustedDeliveryFixture({ consumerRoot, change });
    writeFileSync(
      path.join(trusted.changeRoot, "proposal.md"),
      "# Proposal\n\nChanged after approval.\n",
    );
    const source = packageDeliverySource(consumerRoot, {
      verifyGateProof: () => true,
      verifyFinalizedDelivery: () => true,
      inspectOpenSpec: async () => ({
        change,
        schema: "spec-driven",
        planningComplete: true,
        strictValid: true,
        artifactPaths: [
          ...trusted.artifactPaths,
          "specs/missing-contract/spec.md",
        ],
      }),
    });
    let failure: unknown;
    try {
      await source.load({ stage: "abel-implement", change });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(DeliveryValidationError);
    expect((failure as DeliveryValidationError).diagnostics).toEqual(
      expect.arrayContaining([
        "delivery-artifact-hash-mismatch:proposal.md",
        "delivery-artifact-unbound:specs/missing-contract/spec.md",
      ]),
    );
  });

  it("opens package state under an absolute XDG_STATE_HOME", async () => {
    const module = (await import("../src/index.ts")) as Record<string, unknown>;
    const openPackageWorkflowControlEngine =
      module.openPackageWorkflowControlEngine as (
        context: Record<string, unknown>,
        bridge: Record<string, unknown>,
      ) => { close(): Promise<void> | void };
    const consumerRoot = mkdtempSync(
      path.join(tmpdir(), "cadence-package-state-consumer-"),
    );
    const stateBase = mkdtempSync(
      path.join(tmpdir(), "cadence-package-state-xdg-"),
    );
    roots.push(consumerRoot, stateBase);
    const roles = [
      "design-explorer",
      "implementation-worker",
      "diagnosis-worker",
    ];
    const routeDirectory = path.join(consumerRoot, ".pi", "cadence");
    mkdirSync(routeDirectory, { recursive: true });
    writeFileSync(
      path.join(routeDirectory, "routes.json"),
      `${JSON.stringify({
        version: 2,
        routes: {
          inherited: {
            kind: "inherited",
            capabilities: {
              roles,
              dialects: ["openai-responses"],
              contextWindow: 256_000,
              maxTokens: 128_000,
            },
          },
        },
        roles: Object.fromEntries(roles.map((role) => [role, ["inherited"]])),
      })}\n`,
    );
    const previousStateHome = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = stateBase;
    let engine: { close(): Promise<void> | void } | undefined;
    try {
      engine = openPackageWorkflowControlEngine({ cwd: consumerRoot }, {});
      const expected = resolveStateRoot({
        consumerRoot,
        xdgStateHome: stateBase,
      });
      expect(existsSync(expected.databasePath)).toBe(true);
      expect(expected.rootDir.startsWith(`${stateBase}${path.sep}`)).toBe(true);
    } finally {
      await engine?.close();
      if (previousStateHome === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = previousStateHome;
    }
  });

  it("fails over from unavailable inherited setup to the declared custom route", async () => {
    const module = (await import("../src/index.ts")) as Record<string, unknown>;
    const openPackageWorkflowControlEngine =
      module.openPackageWorkflowControlEngine as (
        context: Record<string, unknown>,
        bridge: Record<string, unknown>,
      ) => {
        execute(command: unknown): Promise<Record<string, unknown>>;
        close(): Promise<void> | void;
      };
    const consumerRoot = mkdtempSync(
      path.join(tmpdir(), "cadence-package-inherited-failover-consumer-"),
    );
    const stateBase = mkdtempSync(
      path.join(tmpdir(), "cadence-package-inherited-failover-state-"),
    );
    const commandRoot = mkdtempSync(
      path.join(tmpdir(), "cadence-package-inherited-failover-bin-"),
    );
    roots.push(consumerRoot, stateBase, commandRoot);
    const change = "package-inherited-setup-failover";
    mkdirSync(path.join(consumerRoot, "test"), { recursive: true });
    mkdirSync(path.join(consumerRoot, "node_modules/.bin"), {
      recursive: true,
    });
    writeFileSync(
      path.join(consumerRoot, "package.json"),
      `${JSON.stringify({ scripts: { "test:target": "vitest run" } })}\n`,
    );
    writeFileSync(
      path.join(consumerRoot, "test/fixture.test.ts"),
      "export {};\n",
    );
    writeFileSync(
      path.join(consumerRoot, "node_modules/.bin/vitest"),
      "#!/bin/sh\nexit 0\n",
    );
    chmodSync(path.join(consumerRoot, "node_modules/.bin/vitest"), 0o755);
    writeFileSync(path.join(consumerRoot, "value.txt"), "base\n");
    const trusted = writeTrustedDeliveryFixture({ consumerRoot, change });
    bindTrustedDeliveryProofs({
      consumerRoot,
      stateBase,
      change,
      trusted,
    });
    const roles = [
      "design-explorer",
      "implementation-worker",
      "diagnosis-worker",
    ];
    const routeDirectory = path.join(consumerRoot, ".pi", "cadence");
    mkdirSync(routeDirectory, { recursive: true });
    writeFileSync(
      path.join(routeDirectory, "routes.json"),
      `${JSON.stringify({
        version: 2,
        routes: {
          inherited: {
            kind: "inherited",
            capabilities: {
              roles,
              dialects: ["openai-responses"],
              contextWindow: 256_000,
              maxTokens: 128_000,
            },
          },
          fallback: {
            kind: "custom",
            url: "http://127.0.0.1:1/v1",
            model: "package-fallback",
            dialect: "openai-responses",
            apiKeyEnv: "MISSING_PACKAGE_FALLBACK_KEY",
            capabilities: {
              roles,
              dialects: ["openai-responses"],
              contextWindow: 256_000,
              maxTokens: 128_000,
            },
          },
        },
        roles: Object.fromEntries(
          roles.map((role) => [role, ["inherited", "fallback"]]),
        ),
      })}\n`,
    );
    execFileSync("git", ["init", "-q"], { cwd: consumerRoot });
    execFileSync("git", ["add", "."], { cwd: consumerRoot });

    const status = {
      changeName: change,
      schemaName: "spec-driven",
      isPlanningComplete: true,
      isComplete: true,
      artifactPaths: Object.fromEntries(
        trusted.artifactPaths.map((relative, index) => [
          `artifact-${index}`,
          {
            existingOutputPaths: [path.join(trusted.changeRoot, relative)],
          },
        ]),
      ),
    };
    const validation = { items: [{ id: change, valid: true }] };
    const openspec = path.join(commandRoot, "openspec");
    writeFileSync(
      openspec,
      [
        "#!/bin/sh",
        'if [ "$1" = "status" ]; then',
        `  printf '%s\\n' '${JSON.stringify(status)}'`,
        "else",
        `  printf '%s\\n' '${JSON.stringify(validation)}'`,
        "fi",
        "",
      ].join("\n"),
    );
    chmodSync(openspec, 0o755);

    const previousStateHome = process.env.XDG_STATE_HOME;
    const previousPath = process.env.PATH;
    process.env.XDG_STATE_HOME = stateBase;
    process.env.PATH = `${commandRoot}${path.delimiter}${previousPath ?? ""}`;
    let engine: ReturnType<typeof openPackageWorkflowControlEngine> | undefined;
    try {
      engine = openPackageWorkflowControlEngine(
        { cwd: consumerRoot, model: undefined, modelRegistry: {} },
        {},
      );
      await expect(
        engine.execute({
          command: "start",
          stage: "abel-implement",
          change,
          operationId: "package-inherited-setup-failover-start",
        }),
      ).resolves.toMatchObject({
        state: "paused",
        pause: { code: "transport-failure" },
        routePolicy: {
          routes: expect.arrayContaining([
            expect.objectContaining({ id: "inherited", health: "open" }),
            expect.objectContaining({ id: "fallback", health: "open" }),
          ]),
        },
      });
    } finally {
      await engine?.close();
      if (previousStateHome === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = previousStateHome;
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });

  it("keeps package-local status available while route policy is invalid and reloads a correction", async () => {
    const module = (await import("../src/index.ts")) as Record<string, unknown>;
    const openPackageWorkflowControlEngine =
      module.openPackageWorkflowControlEngine as (
        context: Record<string, unknown>,
        bridge: Record<string, unknown>,
      ) => {
        execute(command: unknown): Promise<Record<string, unknown>>;
        close(): Promise<void> | void;
      };
    const consumerRoot = mkdtempSync(
      path.join(tmpdir(), "cadence-package-policy-recovery-consumer-"),
    );
    const stateBase = mkdtempSync(
      path.join(tmpdir(), "cadence-package-policy-recovery-state-"),
    );
    roots.push(consumerRoot, stateBase);
    const routeDirectory = path.join(consumerRoot, ".pi", "cadence");
    const routePath = path.join(routeDirectory, "routes.json");
    mkdirSync(routeDirectory, { recursive: true });
    writeFileSync(
      routePath,
      `${JSON.stringify({ version: 1, routes: {}, roles: {} })}\n`,
    );
    const previousStateHome = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = stateBase;
    let engine: ReturnType<typeof openPackageWorkflowControlEngine> | undefined;
    try {
      engine = openPackageWorkflowControlEngine({ cwd: consumerRoot }, {});
      const started = await engine.execute({
        command: "start",
        stage: "abel-implement",
        change: "policy-recovery",
        operationId: "policy-recovery-start",
      });
      expect(started).toMatchObject({
        stage: "abel-implement",
        state: "paused",
        routePolicy: {
          ok: false,
          source: { kind: "project" },
          diagnostics: [{ code: "unsupported-policy-version" }],
        },
      });

      const roles = [
        "design-explorer",
        "implementation-worker",
        "diagnosis-worker",
      ];
      writeFileSync(
        routePath,
        `${JSON.stringify({
          version: 2,
          routes: {
            inherited: {
              kind: "inherited",
              capabilities: {
                roles,
                dialects: ["openai-responses"],
                contextWindow: 256_000,
                maxTokens: 128_000,
              },
            },
          },
          roles: Object.fromEntries(roles.map((role) => [role, ["inherited"]])),
        })}\n`,
      );
      await expect(
        engine.execute({
          command: "status",
          stage: "abel-implement",
          change: "policy-recovery",
        }),
      ).resolves.toMatchObject({
        runId: started.runId,
        state: "paused",
        routePolicy: {
          ok: true,
          source: { kind: "project" },
          routes: [{ id: "inherited", kind: "inherited" }],
        },
      });
    } finally {
      await engine?.close();
      if (previousStateHome === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = previousStateHome;
    }
  });

  it("pauses without a Worker route and resumes the same run after a policy update", async () => {
    const workflowModule = (await import(
      "../src/workflow-engine.ts"
    )) as Record<string, unknown>;
    const policyModule = (await import("../src/route-policy.ts")) as Record<
      string,
      unknown
    >;
    const openDurableWorkflowEngine =
      workflowModule.openDurableWorkflowEngine as (
        options: Record<string, unknown>,
      ) => {
        execute(command: unknown): Promise<Record<string, unknown>>;
        updateRoutePolicy(policy: unknown): void;
        close(): Promise<void> | void;
      };
    const unavailableRoutePolicy =
      policyModule.unavailableRoutePolicy as () => Record<string, unknown>;
    const fixture = directEngineFixture("policy-update-resume");
    const change = "policy-update-resume";
    const plan = packagePlan(change);
    let workerCalls = 0;
    const engine = openDurableWorkflowEngine({
      consumerRoot: fixture.consumerRoot,
      stateRoot: fixture.stateRoot,
      deliverySource: {
        load: async () => ({
          version: 2,
          gate: "gate-b",
          revision: 1,
          receiptHash: "e".repeat(64),
          plan,
        }),
      },
      routePolicy: unavailableRoutePolicy(),
      proposeCandidate: async () => {
        workerCalls += 1;
        return { kind: "paused" as const, code: "worker-reached" };
      },
      verifyPhase: async () => {
        throw new Error("a paused proposal must not reach phase verification");
      },
      verifyChange: async () => ({
        ok: true as const,
        exitCode: 0 as const,
        classification: "expected-green",
      }),
    });
    try {
      const paused = await engine.execute({
        command: "start",
        stage: "abel-implement",
        change,
        operationId: "policy-update-start",
      });
      expect(paused).toMatchObject({
        state: "paused",
        pause: { code: "endpoint-unavailable" },
      });
      expect(workerCalls).toBe(0);

      engine.updateRoutePolicy(policy());
      await expect(
        engine.execute({
          command: "resume",
          stage: "abel-implement",
          change,
          operationId: "policy-update-resume",
        }),
      ).resolves.toMatchObject({
        runId: paused.runId,
        state: "paused",
        pause: { code: "worker-reached" },
      });
      expect(workerCalls).toBe(1);
    } finally {
      await engine.close();
    }
  });

  it("requires explicit rebind after restart when a named route fingerprint changes", async () => {
    const module = (await import("../src/workflow-engine.ts")) as Record<
      string,
      unknown
    >;
    const openDurableWorkflowEngine = module.openDurableWorkflowEngine as (
      options: Record<string, unknown>,
    ) => {
      execute(command: unknown): Promise<Record<string, unknown>>;
      close(): Promise<void> | void;
    };
    const fixture = directEngineFixture("durable-route-refresh");
    const change = "durable-route-refresh";
    const plan = packagePlan(change);
    const services = {
      consumerRoot: fixture.consumerRoot,
      stateRoot: fixture.stateRoot,
      deliverySource: {
        load: async () => ({
          version: 2,
          gate: "gate-b",
          revision: 1,
          receiptHash: "7".repeat(64),
          plan,
        }),
      },
      verifyPhase: async () => {
        throw new Error("a paused proposal must not reach verification");
      },
      verifyChange: async () => ({
        ok: true as const,
        exitCode: 0 as const,
        classification: "expected-green",
      }),
    };
    let engine = openDurableWorkflowEngine({
      ...services,
      routePolicy: policy("original-model"),
      proposeCandidate: async (input: Record<string, unknown>) => {
        (input.onHeaders as () => void)();
        (input.onProgress as () => void)();
        return { kind: "retryable" as const, code: "candidate-diff-invalid" };
      },
    });
    const started = await engine.execute({
      command: "start",
      stage: "abel-implement",
      change,
      operationId: "durable-route-refresh-start",
    });
    expect(started).toMatchObject({
      state: "paused",
      pause: { code: "candidate-diff-invalid" },
      routeBinding: {
        routeId: "primary",
        routeFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    });
    await engine.close();

    let replacementCalls = 0;
    engine = openDurableWorkflowEngine({
      ...services,
      routePolicy: policy("replacement-model"),
      proposeCandidate: async (input: Record<string, unknown>) => {
        replacementCalls += 1;
        (input.onHeaders as () => void)();
        (input.onProgress as () => void)();
        return { kind: "paused" as const, code: "replacement-reached" };
      },
    });
    await expect(
      engine.execute({
        command: "resume",
        stage: "abel-implement",
        change,
        operationId: "durable-route-refresh-resume-blocked",
      }),
    ).resolves.toMatchObject({
      runId: started.runId,
      state: "paused",
      pause: { code: "route-rebind-required" },
    });
    expect(replacementCalls).toBe(0);

    const rebound = await engine.execute({
      command: "rebind",
      stage: "abel-implement",
      change,
      operationId: "durable-route-refresh-rebind",
      routeId: "primary",
    });
    expect(rebound).toMatchObject({
      routeBinding: {
        routeId: "primary",
        routeFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
      operation: {
        kind: "route-rebound",
        priorRouteId: "primary",
        priorRouteFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
        routeId: "primary",
        routeFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    });
    expect(
      (rebound.routeBinding as { routeFingerprint: string }).routeFingerprint,
    ).not.toBe(
      (started.routeBinding as { routeFingerprint: string }).routeFingerprint,
    );
    await expect(
      engine.execute({
        command: "resume",
        stage: "abel-implement",
        change,
        operationId: "durable-route-refresh-resume-rebound",
      }),
    ).resolves.toMatchObject({
      state: "paused",
      pause: { code: "replacement-reached" },
    });
    expect(replacementCalls).toBe(1);
    await engine.close();
  });

  it("mounts a safe non-system verification runner into the sandbox", async () => {
    const module = (await import("../src/index.ts")) as Record<string, unknown>;
    const executePackageVerification = module.executePackageVerification as
      | ((input: {
          root: string;
          dependencyOwner: string;
          verification: Record<string, unknown>;
          signal: AbortSignal;
        }) => Promise<Record<string, unknown>>)
      | undefined;
    expect(executePackageVerification).toBeTypeOf("function");
    const root = mkdtempSync(path.join(tmpdir(), "cadence-mounted-runner-"));
    roots.push(root);
    const runnerDirectory = path.join(root, "private-runner");
    mkdirSync(runnerDirectory);
    writeFileSync(
      path.join(runnerDirectory, "node"),
      '#!/bin/sh\nexec /usr/bin/node "$@"\n',
    );
    chmodSync(path.join(runnerDirectory, "node"), 0o755);
    writeFileSync(
      path.join(root, "check.mjs"),
      "process.stdout.write('mounted runner ok\\n');\n",
    );
    const previousPath = process.env.PATH;
    process.env.PATH = runnerDirectory;
    try {
      await expect(
        executePackageVerification?.({
          root,
          dependencyOwner: root,
          verification: {
            kind: "static-check",
            id: "mounted-runner-check",
            runner: { kind: "node", script: "check.mjs" },
            args: [],
            classification: "expected-green",
          },
          signal: new AbortController().signal,
        }),
      ).resolves.toMatchObject({
        ok: true,
        exitCode: 0,
        classification: "expected-green",
      });
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });

  it("rejects Red when its marker appears only in a passing Vitest assertion", async () => {
    const module = (await import("../src/index.ts")) as Record<string, unknown>;
    const executePackageVerification = module.executePackageVerification as
      | ((input: {
          root: string;
          dependencyOwner: string;
          verification: Record<string, unknown>;
          signal: AbortSignal;
        }) => Promise<Record<string, unknown>>)
      | undefined;
    expect(executePackageVerification).toBeTypeOf("function");
    const root = mkdtempSync(path.join(tmpdir(), "cadence-red-identity-"));
    roots.push(root);
    mkdirSync(path.join(root, "test"));
    writeFileSync(
      path.join(root, "test/red-identity.test.ts"),
      [
        'import { expect, it } from "vitest";',
        'it("passing expected-red-marker", () => expect(true).toBe(true));',
        'it("unrelated failure", () => expect(1).toBe(2));',
        "",
      ].join("\n"),
    );

    await expect(
      executePackageVerification?.({
        root,
        dependencyOwner: path.resolve(import.meta.dirname, ".."),
        verification: {
          kind: "vitest",
          id: "red-identity-check",
          runner: { kind: "local-binary", executable: "vitest" },
          testFiles: ["test/red-identity.test.ts"],
          args: [],
          classification: "expected-red",
          expectedFailure: "expected-red-marker",
          minTests: 2,
        },
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({
      ok: false,
      kind: "retryable",
      code: "verification-rejected",
    });

    writeFileSync(
      path.join(root, "test/red-identity.test.ts"),
      [
        'import { expect, it } from "vitest";',
        'it("actual failure", () => expect(1, "expected-red-marker").toBe(2));',
        "",
      ].join("\n"),
    );
    await expect(
      executePackageVerification?.({
        root,
        dependencyOwner: path.resolve(import.meta.dirname, ".."),
        verification: {
          kind: "vitest",
          id: "red-diagnostic-check",
          runner: { kind: "local-binary", executable: "vitest" },
          testFiles: ["test/red-identity.test.ts"],
          args: [],
          classification: "expected-red",
          expectedFailure: "expected-red-marker",
          minTests: 1,
        },
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({
      ok: true,
      exitCode: 1,
      classification: "expected-red",
    });
  });

  it.each([
    {
      label: "ancestor-path",
      owner: {
        write: "src",
        verificationLock: "owner-lock",
        agents: { impact: "none" as const, managedOnly: true as const },
      },
      waiter: {
        write: "src/value.ts",
        verificationLock: "waiter-lock",
        agents: { impact: "none" as const, managedOnly: true as const },
      },
    },
    {
      label: "verification-lock",
      owner: {
        write: "owner.txt",
        verificationLock: "shared-verification",
        agents: { impact: "none" as const, managedOnly: true as const },
      },
      waiter: {
        write: "waiter.txt",
        verificationLock: "shared-verification",
        agents: { impact: "none" as const, managedOnly: true as const },
      },
    },
    {
      label: "agents-target",
      owner: {
        write: "owner.txt",
        verificationLock: "owner-lock",
        agents: {
          impact: "update-existing" as const,
          target: "AGENTS.md",
          managedOnly: true as const,
        },
      },
      waiter: {
        write: "waiter.txt",
        verificationLock: "waiter-lock",
        agents: {
          impact: "update-existing" as const,
          target: "AGENTS.md",
          managedOnly: true as const,
        },
      },
    },
  ])(
    "queues an active $label conflict and preserves cancellation",
    async (fixture) => {
      const module = (await import("../src/workflow-engine.ts")) as Record<
        string,
        unknown
      >;
      const WorkflowEngine = module.WorkflowEngine as {
        open(options: Record<string, unknown>): {
          execute(
            command: unknown,
            signal?: AbortSignal,
          ): Promise<Record<string, unknown>>;
          close(): Promise<void> | void;
        };
      };
      const consumerRoot = mkdtempSync(
        path.join(tmpdir(), `cadence-engine-conflict-${fixture.label}-`),
      );
      const stateBase = mkdtempSync(
        path.join(tmpdir(), `cadence-engine-conflict-state-${fixture.label}-`),
      );
      const homeDir = mkdtempSync(
        path.join(tmpdir(), `cadence-engine-conflict-home-${fixture.label}-`),
      );
      roots.push(consumerRoot, stateBase, homeDir);
      const stateRoot = resolveStateRoot({
        consumerRoot,
        xdgStateHome: stateBase,
        homeDir,
      });
      const change = `engine-conflict-${fixture.label}`;
      const verification = (
        id: string,
        classification: "expected-red" | "expected-green",
      ) => ({
        kind: "vitest" as const,
        id,
        runner: {
          kind: "package-script" as const,
          packageManager: "bun" as const,
          script: "test:target",
          command: "vitest run",
        },
        testFiles: ["test/fixture.test.ts"],
        args: [],
        minTests: 1,
        classification,
        ...(classification === "expected-red"
          ? { expectedFailure: `conflict-${fixture.label}` }
          : {}),
      });
      const task = (taskId: string, declaration: (typeof fixture)["owner"]) => {
        const phase = (name: "red" | "green") => ({
          read: ["package.json", "test/fixture.test.ts"],
          write: [declaration.write],
          delete: [],
          verification: verification(
            `${taskId}-${name}`,
            name === "red" ? "expected-red" : "expected-green",
          ),
          verificationInputs: [
            { kind: "workspace" as const, path: "package.json" },
          ],
          verificationLock: declaration.verificationLock,
        });
        return {
          taskId,
          dependsOn: [],
          objective: `Exercise ${fixture.label} scheduling`,
          context: { agents: "root", contract: "approved conflict fixture" },
          roots: ["."],
          phases: { red: phase("red"), green: phase("green") },
          scheduling: { conflicts: [], resources: [] },
          agents: declaration.agents,
          approvedDependencies: [],
          impactClosure: {
            changedSurfaces: ["none" as const],
            searchEvidence: [],
            relatedTests: [],
            affectedSuite: ["test/fixture.test.ts"],
          },
        };
      };
      const plan = {
        schemaVersion: 3 as const,
        changeId: change,
        tasks: [
          task("T1-owner", fixture.owner),
          task("T2-waiter", fixture.waiter),
        ],
        outputs: [],
        verification: { artifactCorrection: { maxAttempts: 2 } },
      };
      let ownerStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        ownerStarted = resolve;
      });
      const worker = {
        async runAttempt(input: Record<string, unknown>) {
          if (input.taskId === "T1-owner" && input.phase === "red") {
            ownerStarted();
            const signal = input.signal as AbortSignal;
            return new Promise<Record<string, unknown>>((resolve) => {
              const cancelled = () =>
                resolve({ kind: "operation-cancelled", code: "cancelled" });
              if (signal.aborted) cancelled();
              else signal.addEventListener("abort", cancelled, { once: true });
            });
          }
          return {
            kind: "phase-committed",
            artifactHash: "a".repeat(64),
            isolatedRevisionId: "b".repeat(64),
            exitCode: input.phase === "red" ? 1 : 0,
            classification:
              input.phase === "red" ? "expected-red" : "expected-green",
          };
        },
        rebind() {
          return { ok: true, routeId: "fixture-route" };
        },
      };
      const engine = WorkflowEngine.open({
        consumerRoot,
        stateRoot,
        deliverySource: {
          load: async () => ({
            version: 2,
            gate: "gate-b",
            revision: 1,
            receiptHash: "c".repeat(64),
            plan,
          }),
        },
        worker,
        changeVerifier: {
          verify: async () => ({
            kind: "paused",
            code: "change-verification-must-not-run",
          }),
        },
      });
      const controller = new AbortController();
      const running = engine.execute(
        {
          command: "start",
          stage: "abel-implement",
          change,
          operationId: `start-${fixture.label}`,
        },
        controller.signal,
      );
      await started;
      await new Promise((resolve) => setTimeout(resolve, 10));
      await expect(
        engine.execute({
          command: "status",
          stage: "abel-implement",
          change,
        }),
      ).resolves.toMatchObject({
        state: "running",
        completed: false,
        tasks: expect.arrayContaining([
          { taskId: "T1-owner", state: "phase-running", phase: "red" },
          { taskId: "T2-waiter", state: "queued", phase: "red" },
        ]),
        queue: [{ taskId: "T2-waiter", position: 1, reason: "conflict" }],
      });
      controller.abort(new Error("cancel only this fixture operation"));
      await expect(running).resolves.toMatchObject({
        state: "paused",
        completed: false,
        pause: { code: "operation-cancelled" },
      });
      await engine.close();
    },
  );

  it.each([
    {
      label: "write-set",
      expectedCode: "write-set-mismatch",
      expectedRunState: "paused",
      expectedTaskState: "retryable",
      configurePlan() {},
      candidate: [
        "--- a/value.txt",
        "+++ b/value.txt",
        "@@ -1 +1 @@",
        "-base",
        "+approved",
        "--- /dev/null",
        "+++ b/unapproved.txt",
        "@@ -0,0 +1 @@",
        "+outside boundary",
        "",
      ].join("\n"),
    },
    {
      label: "required-output",
      expectedCode: "producer-output-unavailable",
      expectedRunState: "paused",
      expectedTaskState: "retryable",
      configurePlan(plan: ReturnType<typeof packagePlan>) {
        plan.tasks[0]?.phases.red.write.push("generated.txt");
        (
          plan.outputs as Array<{
            id: string;
            path: string;
            producer: { taskId: string; phase: "red" };
            postcondition: "regular-file";
          }>
        ).push({
          id: "required-output",
          path: "generated.txt",
          producer: { taskId: "package-loader-task", phase: "red" },
          postcondition: "regular-file",
        });
      },
      candidate: [
        "--- a/value.txt",
        "+++ b/value.txt",
        "@@ -1 +1 @@",
        "-base",
        "+approved",
        "",
      ].join("\n"),
    },
    {
      label: "unapproved-dependency",
      expectedCode: "unapproved-dependency-change",
      expectedRunState: "approval-needed",
      expectedTaskState: "approval-needed",
      configurePlan(plan: ReturnType<typeof packagePlan>) {
        plan.tasks[0]?.phases.red.write.push("package.json");
      },
      candidate: [
        "diff --git a/package.json b/package.json",
        "--- a/package.json",
        "+++ b/package.json",
        "@@ -1 +1 @@",
        '-{"scripts":{"test:target":"vitest run"}}',
        '+{"scripts":{"test:target":"vitest run"},"dependencies":{"unapproved-package":"1.0.0"}}',
        "",
      ].join("\n"),
    },
  ])(
    "rejects a $label candidate before phase verification",
    async (fixture) => {
      const module = (await import("../src/workflow-engine.ts")) as Record<
        string,
        unknown
      >;
      const openDurableWorkflowEngine = module.openDurableWorkflowEngine as (
        options: Record<string, unknown>,
      ) => {
        execute(command: unknown): Promise<Record<string, unknown>>;
        close(): Promise<void> | void;
      };
      const consumerRoot = mkdtempSync(
        path.join(tmpdir(), `cadence-candidate-boundary-${fixture.label}-`),
      );
      const stateBase = mkdtempSync(
        path.join(tmpdir(), `cadence-candidate-state-${fixture.label}-`),
      );
      const homeDir = mkdtempSync(
        path.join(tmpdir(), `cadence-candidate-home-${fixture.label}-`),
      );
      roots.push(consumerRoot, stateBase, homeDir);
      mkdirSync(path.join(consumerRoot, "test"), { recursive: true });
      writeFileSync(
        path.join(consumerRoot, "package.json"),
        `${JSON.stringify({ scripts: { "test:target": "vitest run" } })}\n`,
      );
      writeFileSync(
        path.join(consumerRoot, "test/fixture.test.ts"),
        "export {};\n",
      );
      writeFileSync(path.join(consumerRoot, "value.txt"), "base\n");
      execFileSync("git", ["init", "-q"], { cwd: consumerRoot });
      execFileSync("git", ["add", "."], { cwd: consumerRoot });
      const stateRoot = resolveStateRoot({
        consumerRoot,
        xdgStateHome: stateBase,
        homeDir,
      });
      const change = `candidate-boundary-${fixture.label}`;
      const plan = packagePlan(change);
      fixture.configurePlan(plan);
      let verificationCalls = 0;
      let proposalCalls = 0;
      let retryProjection: unknown;
      const engine = openDurableWorkflowEngine({
        consumerRoot,
        stateRoot,
        deliverySource: {
          load: async () => ({
            version: 2,
            gate: "gate-b",
            revision: 1,
            receiptHash: "d".repeat(64),
            plan,
          }),
        },
        routePolicy: policy(),
        proposeCandidate: async (input: Record<string, unknown>) => {
          proposalCalls += 1;
          if (proposalCalls === 2) retryProjection = input.ledgerProjection;
          (input.onHeaders as () => void)();
          (input.onProgress as () => void)();
          return input.phase === "red"
            ? {
                kind: "candidate" as const,
                bytes: Buffer.from(fixture.candidate),
              }
            : { kind: "paused" as const, code: "unexpected-later-phase" };
        },
        verifyPhase: async () => {
          verificationCalls += 1;
          return {
            ok: true as const,
            exitCode: 1,
            classification: "expected-red" as const,
            diagnostic: { kind: "assertion" as const, id: "fixture-red" },
          };
        },
        verifyChange: async (input: Record<string, unknown>) => {
          if (String(input.scope).startsWith("baseline-")) {
            return {
              ok: true as const,
              exitCode: 0 as const,
              classification: "expected-green",
            };
          }
          throw new Error("rejected phase must not verify the change");
        },
      });
      const started = await engine.execute({
        command: "start",
        stage: "abel-implement",
        change,
        operationId: `candidate-start-${fixture.label}`,
      });
      expect(started).toMatchObject({
        state: fixture.expectedRunState,
        completed: false,
        pause: { code: fixture.expectedCode },
        tasks: [
          {
            taskId: "package-loader-task",
            state: fixture.expectedTaskState,
            phase: "red",
          },
        ],
      });
      expect(verificationCalls).toBe(0);
      expect(existsSync(path.join(consumerRoot, "unapproved.txt"))).toBe(false);
      expect(existsSync(path.join(consumerRoot, "generated.txt"))).toBe(false);
      expect(readFileSync(path.join(consumerRoot, "value.txt"), "utf8")).toBe(
        "base\n",
      );
      expect(
        (
          JSON.parse(
            readFileSync(path.join(consumerRoot, "package.json"), "utf8"),
          ) as Record<string, unknown>
        ).dependencies,
      ).toBeUndefined();
      if (fixture.expectedTaskState === "approval-needed") {
        expect(started).toMatchObject({
          legalCommands: ["status", "discard"],
          approval: {
            category: "dependency",
            requiredGates: ["gate-b"],
            refs: [],
            designRequest: `/abel-design --change ${change}`,
            retainedRun: {
              runId: expect.any(String),
              deliveryRevision: 1,
            },
            receiptPrecondition: {
              deliveryRevision: { greaterThan: 1 },
              receiptHash: "matching-ready-receipt",
            },
          },
          conditionalCommands: [
            {
              command: "resume",
              stage: "abel-implement",
              change,
              requires: {
                deliveryRevision: { greaterThan: 1 },
                receiptHash: "matching-ready-receipt",
              },
            },
          ],
        });
        await expect(
          engine.execute({
            command: "rebind",
            stage: "abel-implement",
            change,
            operationId: `candidate-rebind-${fixture.label}`,
            routeId: "primary",
          }),
        ).rejects.toThrow(/rebind-not-allowed/u);
        await expect(
          engine.execute({
            command: "resume",
            stage: "abel-implement",
            change,
            operationId: `candidate-resume-${fixture.label}`,
          }),
        ).rejects.toThrow(/approval-receipt-required/u);
        expect(proposalCalls).toBe(1);
        await engine.close();
        return;
      }
      expect(proposalCalls).toBe(
        plan.verification.artifactCorrection.maxAttempts,
      );
      expect(retryProjection).toMatchObject({
        history: [
          {
            kind: "artifact-correction",
            phase: "red",
            correctionCategory: "artifact",
            safeFailure: { code: fixture.expectedCode },
            routeId: "primary",
            routeFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
          },
        ],
      });
      await expect(
        engine.execute({
          command: "resume",
          stage: "abel-implement",
          change,
          operationId: `candidate-resume-${fixture.label}`,
        }),
      ).resolves.toMatchObject({
        state: "paused",
        pause: { code: fixture.expectedCode },
      });
      expect(proposalCalls).toBe(
        plan.verification.artifactCorrection.maxAttempts * 2,
      );
      await engine.close();
    },
  );

  it("resumes unchanged Red evidence across a delivery revision under a replacement Worker", async () => {
    const module = (await import("../src/workflow-engine.ts")) as Record<
      string,
      unknown
    >;
    expect(
      module.openDurableWorkflowEngine,
      "[CADENCE-V2:T6-workflow-engine]: durable service composition must be exported",
    ).toBeTypeOf("function");
    const openDurableWorkflowEngine = module.openDurableWorkflowEngine as (
      options: Record<string, unknown>,
    ) => {
      execute(command: unknown): Promise<Record<string, unknown>>;
      close(): Promise<void> | void;
    };
    const consumerRoot = mkdtempSync(
      path.join(tmpdir(), "cadence-durable-engine-consumer-"),
    );
    const stateBase = mkdtempSync(
      path.join(tmpdir(), "cadence-durable-engine-state-"),
    );
    const homeDir = mkdtempSync(
      path.join(tmpdir(), "cadence-durable-engine-home-"),
    );
    roots.push(consumerRoot, stateBase, homeDir);
    mkdirSync(path.join(consumerRoot, "test"), { recursive: true });
    writeFileSync(
      path.join(consumerRoot, "package.json"),
      `${JSON.stringify({ scripts: { "test:target": "vitest run" } })}\n`,
    );
    writeFileSync(
      path.join(consumerRoot, "test/fixture.test.ts"),
      "export {};\n",
    );
    writeFileSync(path.join(consumerRoot, "value.txt"), "base\n");
    execFileSync("git", ["init", "-q"], { cwd: consumerRoot });
    execFileSync("git", ["add", "."], { cwd: consumerRoot });
    const stateRoot = resolveStateRoot({
      consumerRoot,
      xdgStateHome: stateBase,
      homeDir,
    });
    const change = "durable-composed-engine";
    const verification = (
      id: string,
      classification: "expected-red" | "expected-green",
    ) => ({
      kind: "vitest" as const,
      id,
      runner: {
        kind: "package-script" as const,
        packageManager: "bun" as const,
        script: "test:target",
        command: "vitest run",
      },
      testFiles: ["test/fixture.test.ts"],
      args: [],
      minTests: 1,
      classification,
      ...(classification === "expected-red"
        ? { expectedFailure: "durable-red" }
        : {}),
    });
    const phase = (name: "red" | "green") => ({
      read: ["package.json", "test/fixture.test.ts", "value.txt"],
      write: ["value.txt"],
      delete: [],
      verification: verification(
        `durable-${name}`,
        name === "red" ? "expected-red" : "expected-green",
      ),
      verificationInputs: [
        { kind: "workspace" as const, path: "test/fixture.test.ts" },
      ],
      verificationLock: "durable-fixture",
    });
    const plan = {
      schemaVersion: 3 as const,
      changeId: change,
      tasks: [
        {
          taskId: "durable-task",
          dependsOn: [],
          objective: "Carry Red into a replacement Green Worker",
          context: { agents: "root", contract: "approved durable task" },
          roots: ["."],
          phases: { red: phase("red"), green: phase("green") },
          scheduling: { conflicts: [], resources: ["durable-value"] },
          agents: { impact: "none" as const, managedOnly: true as const },
          approvedDependencies: [],
          impactClosure: {
            changedSurfaces: ["none" as const],
            searchEvidence: [],
            relatedTests: [
              {
                path: "test/fixture.test.ts",
                disposition: "current-task" as const,
                evidence: "durable fixture",
              },
            ],
            affectedSuite: ["test/fixture.test.ts"],
          },
        },
      ],
      outputs: [],
      verification: { artifactCorrection: { maxAttempts: 2 } },
    };
    const deliverySource = {
      load: async (input: { deliveryRevision?: number }) => {
        const revision = input.deliveryRevision ?? 1;
        return {
          version: 2 as const,
          gate: "gate-b" as const,
          revision,
          receiptHash: (revision === 1 ? "a" : "b").repeat(64),
          plan,
        };
      },
    };
    const patch = (before: string, after: string) =>
      Buffer.from(
        [
          "diff --git a/value.txt b/value.txt",
          "--- a/value.txt",
          "+++ b/value.txt",
          "@@ -1 +1 @@",
          `-${before}`,
          `+${after}`,
          "",
        ].join("\n"),
      );
    const phaseVerification = async (input: Record<string, unknown>) => {
      const root = String(input.root);
      const currentPhase = String(input.phase);
      expect(readFileSync(path.join(root, "value.txt"), "utf8")).toBe(
        currentPhase === "red" ? "red\n" : "green\n",
      );
      return {
        ok: true as const,
        exitCode: currentPhase === "red" ? 1 : 0,
        classification:
          currentPhase === "red"
            ? ("expected-red" as const)
            : ("expected-green" as const),
        diagnostic: {
          kind: "assertion" as const,
          id: `durable-${currentPhase}`,
        },
      };
    };
    const changeVerification = async (input: Record<string, unknown>) => {
      expect(
        readFileSync(path.join(String(input.root), "value.txt"), "utf8"),
      ).toBe("green\n");
      return {
        ok: true as const,
        exitCode: 0 as const,
        classification: "expected-green",
      };
    };
    const firstPhases: string[] = [];
    let engine = openDurableWorkflowEngine({
      consumerRoot,
      stateRoot,
      deliverySource,
      routePolicy: policy(),
      proposeCandidate: async (input: Record<string, unknown>) => {
        const currentPhase = String(input.phase);
        firstPhases.push(currentPhase);
        (input.onHeaders as () => void)();
        (input.onProgress as () => void)();
        expect(input.route).toMatchObject({ id: "primary" });
        expect(readFileSync(path.join(consumerRoot, "value.txt"), "utf8")).toBe(
          "base\n",
        );
        if (currentPhase === "red") {
          expect(
            readFileSync(
              path.join(String(input.workspaceRoot), "value.txt"),
              "utf8",
            ),
          ).toBe("base\n");
          return { kind: "candidate" as const, bytes: patch("base", "red") };
        }
        expect(
          readFileSync(
            path.join(String(input.workspaceRoot), "value.txt"),
            "utf8",
          ),
        ).toBe("red\n");
        return { kind: "paused" as const, code: "endpoint-unavailable" };
      },
      verifyPhase: phaseVerification,
      verifyChange: changeVerification,
    });
    const paused = await engine.execute({
      command: "start",
      stage: "abel-implement",
      change,
      operationId: "durable-start",
    });
    expect(paused).toMatchObject({
      state: "paused",
      completed: false,
      pause: { code: "endpoint-unavailable" },
      privateData: {
        retained: true,
        cleanup: "retained",
        baselineRevisionId: expect.stringMatching(/^[a-f0-9]{64}$/u),
        currentRevisionId: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    });
    expect(firstPhases).toEqual(["red", "green"]);
    expect(readFileSync(path.join(consumerRoot, "value.txt"), "utf8")).toBe(
      "base\n",
    );
    const runId = String(paused.runId);
    const privateRunRoot = path.join(stateRoot.rootDir, "run-data", runId);
    expect(existsSync(privateRunRoot)).toBe(true);
    await engine.close();

    const replacementPhases: string[] = [];
    const completionVerificationRoots: string[] = [];
    engine = openDurableWorkflowEngine({
      consumerRoot,
      stateRoot,
      deliverySource,
      routePolicy: policy(),
      proposeCandidate: async (input: Record<string, unknown>) => {
        const currentPhase = String(input.phase);
        replacementPhases.push(currentPhase);
        (input.onHeaders as () => void)();
        (input.onProgress as () => void)();
        expect(currentPhase).toBe("green");
        expect(
          readFileSync(
            path.join(String(input.workspaceRoot), "value.txt"),
            "utf8",
          ),
        ).toBe("red\n");
        expect(input.deliveryRevision).toBe(1);
        expect(input.ledgerProjection).toMatchObject({
          deliveryRevision: 1,
          currentPhase: "green",
          history: [
            {
              kind: "phase-verified",
              phase: "red",
              actualClassification: "expected-red",
              routeId: "primary",
              routeFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
            },
          ],
        });
        return { kind: "candidate" as const, bytes: patch("red", "green") };
      },
      verifyPhase: phaseVerification,
      verifyChange: async (input: Record<string, unknown>) => {
        await changeVerification(input);
        return {
          ok: false as const,
          kind: "verification" as const,
          code: "change-verification-paused",
        };
      },
    });
    const verificationPaused = await engine.execute({
      command: "resume",
      stage: "abel-implement",
      change,
      operationId: "durable-resume",
      deliveryRevision: 2,
      receiptHash: "b".repeat(64),
    });
    expect(verificationPaused).toMatchObject({
      runId,
      state: "paused",
      completed: false,
      pause: { code: "change-verification-paused" },
      tasks: [{ taskId: "durable-task", state: "verified" }],
      privateData: { retained: true, cleanup: "retained" },
    });
    expect(replacementPhases).toEqual(["green"]);
    expect(readFileSync(path.join(consumerRoot, "value.txt"), "utf8")).toBe(
      "base\n",
    );
    await engine.close();

    engine = openDurableWorkflowEngine({
      consumerRoot,
      stateRoot,
      deliverySource,
      routePolicy: policy(),
      proposeCandidate: async () => {
        throw new Error("verified-task-must-not-run-worker");
      },
      verifyPhase: phaseVerification,
      verifyChange: async (input: Record<string, unknown>) => {
        completionVerificationRoots.push(String(input.root));
        return changeVerification(input);
      },
    });
    const completed = await engine.execute({
      command: "resume",
      stage: "abel-implement",
      change,
      operationId: "durable-verify-resume",
    });
    expect(completed).toMatchObject({
      runId,
      state: "completed",
      completed: true,
      terminal: "completed",
      tasks: [],
      privateData: { retained: false, cleanup: "complete" },
    });
    expect(readFileSync(path.join(consumerRoot, "value.txt"), "utf8")).toBe(
      "green\n",
    );
    expect(completionVerificationRoots).toHaveLength(2);
    expect(completionVerificationRoots[0]).not.toBe(consumerRoot);
    expect(completionVerificationRoots[1]).not.toBe(consumerRoot);
    expect(completionVerificationRoots[1]).not.toBe(
      completionVerificationRoots[0],
    );
    expect(existsSync(privateRunRoot)).toBe(false);
    await engine.close();

    engine = openDurableWorkflowEngine({
      consumerRoot,
      stateRoot,
      deliverySource: {
        load: async () => {
          throw new Error("completed-status-must-remain-local");
        },
      },
      routePolicy: policy(),
      proposeCandidate: async () => {
        throw new Error("completed-status-must-not-run-worker");
      },
      verifyPhase: phaseVerification,
      verifyChange: changeVerification,
    });
    await expect(
      engine.execute({
        command: "status",
        stage: "abel-implement",
        change,
      }),
    ).resolves.toMatchObject({
      runId,
      state: "completed",
      completed: true,
      privateData: { retained: false, cleanup: "complete" },
    });
    await engine.close();
  });

  it("removes narrowed task authority while retaining independent revision evidence", async () => {
    const module = (await import("../src/workflow-engine.ts")) as Record<
      string,
      unknown
    >;
    const openDurableWorkflowEngine = module.openDurableWorkflowEngine as (
      options: Record<string, unknown>,
    ) => {
      execute(command: unknown): Promise<Record<string, unknown>>;
      close(): Promise<void> | void;
    };
    const consumerRoot = mkdtempSync(
      path.join(tmpdir(), "cadence-revision-narrow-consumer-"),
    );
    const stateBase = mkdtempSync(
      path.join(tmpdir(), "cadence-revision-narrow-state-"),
    );
    const homeDir = mkdtempSync(
      path.join(tmpdir(), "cadence-revision-narrow-home-"),
    );
    roots.push(consumerRoot, stateBase, homeDir);
    mkdirSync(path.join(consumerRoot, "test"), { recursive: true });
    writeFileSync(
      path.join(consumerRoot, "package.json"),
      `${JSON.stringify({ scripts: { "test:target": "vitest run" } })}\n`,
    );
    writeFileSync(
      path.join(consumerRoot, "test/fixture.test.ts"),
      "export {};\n",
    );
    writeFileSync(path.join(consumerRoot, "retained.txt"), "base\n");
    writeFileSync(path.join(consumerRoot, "removed.txt"), "base\n");
    execFileSync("git", ["init", "-q"], { cwd: consumerRoot });
    execFileSync("git", ["add", "."], { cwd: consumerRoot });
    const stateRoot = resolveStateRoot({
      consumerRoot,
      xdgStateHome: stateBase,
      homeDir,
    });
    const change = "revision-narrows-task-authority";
    const makeTask = (taskId: string, target: string) => {
      const task = structuredClone(packagePlan(change).tasks[0]);
      task.taskId = taskId;
      task.objective = `Preserve only ${taskId}`;
      task.scheduling.resources = [`resource-${taskId}`];
      for (const [phase, contract] of Object.entries(task.phases)) {
        contract.read = ["package.json", "test/fixture.test.ts", target];
        contract.write = [target];
        contract.verification.id = `${taskId}-${phase}`;
        contract.verificationLock = `verification-${taskId}`;
      }
      return task;
    };
    const retainedTask = makeTask("retained-task", "retained.txt");
    const removedTask = makeTask("removed-task", "removed.txt");
    const firstPlan = {
      ...packagePlan(change),
      tasks: [retainedTask, removedTask],
    };
    const revisedPlan = {
      ...packagePlan(change),
      tasks: [retainedTask],
    };
    const deliverySource = {
      load: async (input: { deliveryRevision?: number }) => {
        const revision = input.deliveryRevision ?? 1;
        return {
          version: 2 as const,
          gate: "gate-b" as const,
          revision,
          receiptHash: (revision === 1 ? "c" : "d").repeat(64),
          plan: revision === 1 ? firstPlan : revisedPlan,
        };
      },
    };
    const patch = (target: string, before: string, after: string) =>
      Buffer.from(
        [
          `diff --git a/${target} b/${target}`,
          `--- a/${target}`,
          `+++ b/${target}`,
          "@@ -1 +1 @@",
          `-${before}`,
          `+${after}`,
          "",
        ].join("\n"),
      );
    let revision = 1;
    const resumedPhases: string[] = [];
    const engine = openDurableWorkflowEngine({
      consumerRoot,
      stateRoot,
      deliverySource,
      routePolicy: policy(),
      proposeCandidate: async (input: Record<string, unknown>) => {
        (input.onHeaders as () => void)();
        (input.onProgress as () => void)();
        const taskId = String(input.taskId);
        const phase = String(input.phase);
        const target =
          taskId === "retained-task" ? "retained.txt" : "removed.txt";
        if (revision === 1) {
          return phase === "red"
            ? {
                kind: "candidate" as const,
                bytes: patch(target, "base", `${taskId}-red`),
              }
            : { kind: "paused" as const, code: "revision-required" };
        }
        resumedPhases.push(`${taskId}:${phase}`);
        expect(taskId).toBe("retained-task");
        expect(phase).toBe("green");
        expect(input.deliveryRevision).toBe(1);
        expect(input.ledgerProjection).toMatchObject({
          deliveryRevision: 1,
          currentPhase: "green",
          history: [
            {
              kind: "phase-verified",
              phase: "red",
              actualClassification: "expected-red",
            },
          ],
        });
        const workspaceRoot = String(input.workspaceRoot);
        expect(
          readFileSync(path.join(workspaceRoot, "retained.txt"), "utf8"),
        ).toBe("retained-task-red\n");
        expect(
          readFileSync(path.join(workspaceRoot, "removed.txt"), "utf8"),
        ).toBe("base\n");
        return { kind: "paused" as const, code: "fixture-complete" };
      },
      verifyPhase: async (input: Record<string, unknown>) => {
        const taskId = String(input.taskId);
        const target =
          taskId === "retained-task" ? "retained.txt" : "removed.txt";
        expect(
          readFileSync(path.join(String(input.root), target), "utf8"),
        ).toBe(`${taskId}-red\n`);
        return {
          ok: true as const,
          exitCode: 1,
          classification: "expected-red" as const,
          diagnostic: { kind: "assertion" as const, id: `${taskId}-red` },
        };
      },
      verifyChange: async (input: Record<string, unknown>) => {
        if (String(input.scope).startsWith("baseline-")) {
          return {
            ok: true as const,
            exitCode: 0 as const,
            classification: "expected-green",
          };
        }
        throw new Error("paused Green tasks must not verify the change");
      },
    });
    const first = await engine.execute({
      command: "start",
      stage: "abel-implement",
      change,
      operationId: "revision-narrow-start",
    });
    expect(first).toMatchObject({
      state: "paused",
      tasks: expect.arrayContaining([
        { taskId: "retained-task", state: "paused", phase: "green" },
        { taskId: "removed-task", state: "paused", phase: "green" },
      ]),
    });
    expect(readFileSync(path.join(consumerRoot, "retained.txt"), "utf8")).toBe(
      "base\n",
    );
    expect(readFileSync(path.join(consumerRoot, "removed.txt"), "utf8")).toBe(
      "base\n",
    );

    revision = 2;
    const resumed = await engine.execute({
      command: "resume",
      stage: "abel-implement",
      change,
      operationId: "revision-narrow-resume",
      deliveryRevision: 2,
      receiptHash: "d".repeat(64),
    });
    expect(resumed).toMatchObject({
      runId: first.runId,
      deliveryRevision: 2,
      state: "paused",
      pause: { code: "fixture-complete" },
      tasks: [{ taskId: "retained-task", state: "paused", phase: "green" }],
    });
    expect(resumedPhases).toEqual(["retained-task:green"]);
    await engine.close();
  });

  it("keeps a settled cancel authoritative while post-apply verification unwinds", async () => {
    const module = (await import("../src/workflow-engine.ts")) as Record<
      string,
      unknown
    >;
    const openDurableWorkflowEngine = module.openDurableWorkflowEngine as (
      options: Record<string, unknown>,
    ) => {
      execute(command: unknown): Promise<Record<string, unknown>>;
      close(): Promise<void> | void;
    };
    const consumerRoot = mkdtempSync(
      path.join(tmpdir(), "cadence-post-apply-cancel-consumer-"),
    );
    const stateBase = mkdtempSync(
      path.join(tmpdir(), "cadence-post-apply-cancel-state-"),
    );
    const homeDir = mkdtempSync(
      path.join(tmpdir(), "cadence-post-apply-cancel-home-"),
    );
    roots.push(consumerRoot, stateBase, homeDir);
    mkdirSync(path.join(consumerRoot, "test"), { recursive: true });
    writeFileSync(
      path.join(consumerRoot, "package.json"),
      `${JSON.stringify({ scripts: { "test:target": "vitest run" } })}\n`,
    );
    writeFileSync(
      path.join(consumerRoot, "test/fixture.test.ts"),
      "export {};\n",
    );
    writeFileSync(path.join(consumerRoot, "value.txt"), "base\n");
    execFileSync("git", ["init", "-q"], { cwd: consumerRoot });
    execFileSync("git", ["add", "."], { cwd: consumerRoot });
    const stateRoot = resolveStateRoot({
      consumerRoot,
      xdgStateHome: stateBase,
      homeDir,
    });
    const change = "cancel-during-post-apply-verification";
    const plan = packagePlan(change);
    const patch = (before: string, after: string) =>
      Buffer.from(
        [
          "diff --git a/value.txt b/value.txt",
          "--- a/value.txt",
          "+++ b/value.txt",
          "@@ -1 +1 @@",
          `-${before}`,
          `+${after}`,
          "",
        ].join("\n"),
      );
    let postApplyStarted!: () => void;
    const postApplyRunning = new Promise<void>((resolve) => {
      postApplyStarted = resolve;
    });
    let releasePostApply!: () => void;
    const postApplyRelease = new Promise<void>((resolve) => {
      releasePostApply = resolve;
    });
    let postApplyVerifications = 0;
    let postApplyCancellationObserved = false;
    const engine = openDurableWorkflowEngine({
      consumerRoot,
      stateRoot,
      deliverySource: {
        load: async () => ({
          version: 2 as const,
          gate: "gate-b" as const,
          revision: 1,
          receiptHash: "e".repeat(64),
          plan,
        }),
      },
      routePolicy: policy(),
      proposeCandidate: async (input: Record<string, unknown>) => {
        (input.onHeaders as () => void)();
        (input.onProgress as () => void)();
        return input.phase === "red"
          ? { kind: "candidate" as const, bytes: patch("base", "red") }
          : { kind: "candidate" as const, bytes: patch("red", "green") };
      },
      verifyPhase: async (input: Record<string, unknown>) => ({
        ok: true as const,
        exitCode: input.phase === "red" ? 1 : 0,
        classification:
          input.phase === "red"
            ? ("expected-red" as const)
            : ("expected-green" as const),
        diagnostic: {
          kind: "assertion" as const,
          id: `post-apply-${String(input.phase)}`,
        },
      }),
      verifyChange: async (input: Record<string, unknown>) => {
        const scope = String(input.scope);
        const value = readFileSync(
          path.join(String(input.root), "value.txt"),
          "utf8",
        );
        expect(value).toBe(
          scope.startsWith("baseline-") ? "base\n" : "green\n",
        );
        if (scope === "post-apply") {
          postApplyVerifications += 1;
          expect(input.root).not.toBe(consumerRoot);
          const verificationSignal = input.signal as AbortSignal;
          verificationSignal.addEventListener(
            "abort",
            () => {
              postApplyCancellationObserved = true;
            },
            { once: true },
          );
          postApplyStarted();
          await postApplyRelease;
        }
        return {
          ok: true as const,
          exitCode: 0 as const,
          classification: "expected-green",
        };
      },
    });
    const starting = engine.execute({
      command: "start",
      stage: "abel-implement",
      change,
      operationId: "post-apply-cancel-start",
    });
    await postApplyRunning;
    expect(readFileSync(path.join(consumerRoot, "value.txt"), "utf8")).toBe(
      "green\n",
    );

    const cancelled = await engine.execute({
      command: "cancel",
      stage: "abel-implement",
      change,
      operationId: "post-apply-cancel-control",
    });
    expect(cancelled).toMatchObject({
      state: "paused",
      completed: false,
      pause: { code: "operation-cancelled" },
      privateData: { retained: true, cleanup: "retained" },
      operation: { kind: "operation-cancelled" },
    });
    expect(readFileSync(path.join(consumerRoot, "value.txt"), "utf8")).toBe(
      "base\n",
    );

    releasePostApply();
    await expect(starting).resolves.toMatchObject({
      state: "paused",
      completed: false,
      pause: { code: "operation-cancelled" },
      tasks: [{ taskId: "package-loader-task", state: "verified" }],
      privateData: { retained: true, cleanup: "retained" },
    });
    expect(postApplyVerifications).toBe(1);
    expect(postApplyCancellationObserved).toBe(true);
    expect(readFileSync(path.join(consumerRoot, "value.txt"), "utf8")).toBe(
      "base\n",
    );

    const resumed = await engine.execute({
      command: "resume",
      stage: "abel-implement",
      change,
      operationId: "post-apply-cancel-resume",
    });
    expect(resumed).toMatchObject({
      state: "completed",
      completed: true,
      terminal: "completed",
    });
    expect(postApplyVerifications).toBe(2);
    expect(readFileSync(path.join(consumerRoot, "value.txt"), "utf8")).toBe(
      "green\n",
    );
    await engine.close();
  });

  it("persists route cooldown and initial private revision facts across restart", async () => {
    const module = (await import("../src/workflow-engine.ts")) as Record<
      string,
      unknown
    >;
    const openDurableWorkflowEngine = module.openDurableWorkflowEngine as (
      options: Record<string, unknown>,
    ) => {
      execute(command: unknown): Promise<Record<string, unknown>>;
      close(): Promise<void> | void;
    };
    const consumerRoot = mkdtempSync(
      path.join(tmpdir(), "cadence-durable-health-consumer-"),
    );
    const stateBase = mkdtempSync(
      path.join(tmpdir(), "cadence-durable-health-state-"),
    );
    const homeDir = mkdtempSync(
      path.join(tmpdir(), "cadence-durable-health-home-"),
    );
    roots.push(consumerRoot, stateBase, homeDir);
    mkdirSync(path.join(consumerRoot, "test"), { recursive: true });
    writeFileSync(
      path.join(consumerRoot, "package.json"),
      `${JSON.stringify({ scripts: { "test:target": "vitest run" } })}\n`,
    );
    writeFileSync(
      path.join(consumerRoot, "test/fixture.test.ts"),
      "export {};\n",
    );
    writeFileSync(path.join(consumerRoot, "value.txt"), "base\n");
    execFileSync("git", ["init", "-q"], { cwd: consumerRoot });
    execFileSync("git", ["add", "."], { cwd: consumerRoot });
    const stateRoot = resolveStateRoot({
      consumerRoot,
      xdgStateHome: stateBase,
      homeDir,
    });
    const change = "durable-route-health";
    const phase = (name: "red" | "green") => ({
      read: ["package.json", "test/fixture.test.ts", "value.txt"],
      write: ["value.txt"],
      delete: [],
      verification: {
        kind: "vitest" as const,
        id: `health-${name}`,
        runner: {
          kind: "package-script" as const,
          packageManager: "bun" as const,
          script: "test:target",
          command: "vitest run",
        },
        testFiles: ["test/fixture.test.ts"],
        args: [],
        minTests: 1,
        classification:
          name === "red"
            ? ("expected-red" as const)
            : ("expected-green" as const),
        ...(name === "red" ? { expectedFailure: "health-red" } : {}),
      },
      verificationInputs: [
        { kind: "workspace" as const, path: "test/fixture.test.ts" },
      ],
      verificationLock: "durable-health",
    });
    const plan = {
      schemaVersion: 3 as const,
      changeId: change,
      tasks: [
        {
          taskId: "health-task",
          dependsOn: [],
          objective: "Retain route health",
          context: { agents: "root", contract: "approved health task" },
          roots: ["."],
          phases: { red: phase("red"), green: phase("green") },
          scheduling: { conflicts: [], resources: ["durable-health"] },
          agents: { impact: "none" as const, managedOnly: true as const },
          approvedDependencies: [],
          impactClosure: {
            changedSurfaces: ["none" as const],
            searchEvidence: [],
            relatedTests: [
              {
                path: "test/fixture.test.ts",
                disposition: "current-task" as const,
                evidence: "durable health fixture",
              },
            ],
            affectedSuite: ["test/fixture.test.ts"],
          },
        },
      ],
      outputs: [],
      verification: { artifactCorrection: { maxAttempts: 2 } },
    };
    const deliverySource = {
      load: async () => ({
        version: 2 as const,
        gate: "gate-b" as const,
        revision: 1,
        receiptHash: "b".repeat(64),
        plan,
      }),
    };
    const firstRoutes: string[] = [];
    let engine = openDurableWorkflowEngine({
      consumerRoot,
      stateRoot,
      deliverySource,
      routePolicy: policy(),
      now: () => 1_000,
      proposeCandidate: async (input: Record<string, unknown>) => {
        firstRoutes.push(String((input.route as { id?: unknown }).id));
        throw new Error("fixture-route-failure");
      },
      verifyPhase: async () => {
        throw new Error("failed route must not verify");
      },
      verifyChange: async () => {
        throw new Error("failed route must not verify change");
      },
    });
    const paused = await engine.execute({
      command: "start",
      stage: "abel-implement",
      change,
      operationId: "health-start",
    });
    expect(paused).toMatchObject({
      state: "paused",
      completed: false,
      pause: { code: "transport-failure" },
      privateData: {
        retained: true,
        cleanup: "retained",
        baselineRevisionId: expect.stringMatching(/^[a-f0-9]{64}$/u),
        currentRevisionId: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    });
    expect(firstRoutes).toEqual(["primary", "inherited"]);
    await engine.close();

    const replacementRoutes: string[] = [];
    engine = openDurableWorkflowEngine({
      consumerRoot,
      stateRoot,
      deliverySource,
      routePolicy: policy(),
      now: () => 1_000,
      proposeCandidate: async (input: Record<string, unknown>) => {
        replacementRoutes.push(String((input.route as { id?: unknown }).id));
        throw new Error("cooldown-route-must-not-run");
      },
      verifyPhase: async () => {
        throw new Error("cooldown route must not verify");
      },
      verifyChange: async () => {
        throw new Error("cooldown route must not verify change");
      },
    });
    await expect(
      engine.execute({
        command: "resume",
        stage: "abel-implement",
        change,
        operationId: "health-resume",
      }),
    ).resolves.toMatchObject({
      runId: paused.runId,
      state: "paused",
      completed: false,
      pause: { code: "endpoint-unavailable" },
      privateData: {
        retained: true,
        cleanup: "retained",
      },
    });
    expect(replacementRoutes).toEqual([]);
    await engine.close();
  });

  it("renews the authoritative operation lease while a Worker attempt is pending", async () => {
    const module = (await import("../src/workflow-engine.ts")) as Record<
      string,
      unknown
    >;
    const WorkflowEngine = module.WorkflowEngine as {
      open(options: Record<string, unknown>): {
        execute(command: unknown): Promise<Record<string, unknown>>;
        close(): Promise<void>;
      };
    };
    const fixture = directEngineFixture("lease-renewal");
    const change = "renew-operation-lease";
    let workerStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      workerStarted = resolve;
    });
    let releaseWorker!: () => void;
    const workerRelease = new Promise<void>((resolve) => {
      releaseWorker = resolve;
    });
    const services = {
      deliverySource: {
        load: async () => ({
          version: 2 as const,
          gate: "gate-b" as const,
          revision: 1,
          receiptHash: "a".repeat(64),
          plan: packagePlan(change),
        }),
      },
      worker: {
        runAttempt: async () => {
          workerStarted();
          await workerRelease;
          return { kind: "paused" as const, code: "lease-fixture-complete" };
        },
        rebind: () => ({ ok: true as const, routeId: "inherited" }),
      },
      changeVerifier: {
        verify: async () => ({
          kind: "paused" as const,
          code: "unexpected-change-verification",
        }),
      },
    };
    const owner = WorkflowEngine.open({
      consumerRoot: fixture.consumerRoot,
      stateRoot: fixture.stateRoot,
      leaseTtlMs: 60,
      ...services,
    });
    const running = owner.execute({
      command: "start",
      stage: "abel-implement",
      change,
      operationId: "lease-renewal-start",
    });
    await started;
    await new Promise((resolve) => setTimeout(resolve, 180));

    const observer = WorkflowEngine.open({
      consumerRoot: fixture.consumerRoot,
      stateRoot: fixture.stateRoot,
      leaseTtlMs: 60,
      ...services,
    });
    try {
      await expect(
        observer.execute({
          command: "status",
          stage: "abel-implement",
          change,
        }),
      ).resolves.toMatchObject({
        state: "running",
        tasks: [{ taskId: "package-loader-task", state: "phase-running" }],
      });
    } finally {
      await observer.close();
      releaseWorker();
    }
    await expect(running).resolves.toMatchObject({
      state: "paused",
      pause: { code: "lease-fixture-complete" },
    });
    await owner.close();
  });

  it("fences an expired driver so it cannot overwrite replacement terminal state", async () => {
    const module = (await import("../src/workflow-engine.ts")) as Record<
      string,
      unknown
    >;
    const WorkflowEngine = module.WorkflowEngine as {
      open(options: Record<string, unknown>): {
        execute(command: unknown): Promise<Record<string, unknown>>;
        close(): Promise<void>;
      };
    };
    const fixture = directEngineFixture("lease-fencing");
    const change = "fence-expired-driver";
    let now = 1_000;
    let workerStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      workerStarted = resolve;
    });
    let releaseWorker!: () => void;
    const workerRelease = new Promise<void>((resolve) => {
      releaseWorker = resolve;
    });
    const services = {
      deliverySource: {
        load: async () => ({
          version: 2 as const,
          gate: "gate-b" as const,
          revision: 1,
          receiptHash: "b".repeat(64),
          plan: packagePlan(change),
        }),
      },
      worker: {
        runAttempt: async () => {
          workerStarted();
          await workerRelease;
          return { kind: "paused" as const, code: "stale-worker-result" };
        },
        rebind: () => ({ ok: true as const, routeId: "inherited" }),
      },
      changeVerifier: {
        verify: async () => ({
          kind: "paused" as const,
          code: "unexpected-change-verification",
        }),
      },
    };
    const stale = WorkflowEngine.open({
      consumerRoot: fixture.consumerRoot,
      stateRoot: fixture.stateRoot,
      leaseTtlMs: 30,
      now: () => now,
      ...services,
    });
    const staleExecution = stale.execute({
      command: "start",
      stage: "abel-implement",
      change,
      operationId: "stale-driver-start",
    });
    await started;
    now += 31;

    const replacement = WorkflowEngine.open({
      consumerRoot: fixture.consumerRoot,
      stateRoot: fixture.stateRoot,
      leaseTtlMs: 30,
      now: () => now,
      ...services,
    });
    const discarded = await replacement.execute({
      command: "discard",
      stage: "abel-implement",
      change,
      operationId: "replacement-discard",
    });
    expect(discarded).toMatchObject({
      state: "discarded",
      terminal: "discarded",
      tasks: [],
    });
    releaseWorker();
    await expect(staleExecution).rejects.toThrow(/lease-fenced/u);
    await expect(
      replacement.execute({
        command: "status",
        stage: "abel-implement",
        change,
      }),
    ).resolves.toMatchObject({
      state: "discarded",
      terminal: "discarded",
      tasks: [],
    });
    await stale.close();
    await replacement.close();
  });

  it("persists apply intent before exposing the applying state", async () => {
    const module = (await import("../src/workflow-engine.ts")) as Record<
      string,
      unknown
    >;
    const WorkflowEngine = module.WorkflowEngine as {
      open(options: Record<string, unknown>): {
        execute(command: unknown): Promise<Record<string, unknown>>;
        close(): Promise<void>;
      };
    };
    const fixture = directEngineFixture("prepare-before-applying");
    const change = "prepare-before-applying";
    let prepareStarted!: (transactionId: string) => void;
    const preparing = new Promise<string>((resolve) => {
      prepareStarted = resolve;
    });
    let releasePrepare!: () => void;
    const prepareRelease = new Promise<void>((resolve) => {
      releasePrepare = resolve;
    });
    let applyStarted!: () => void;
    const applying = new Promise<void>((resolve) => {
      applyStarted = resolve;
    });
    let releaseApply!: () => void;
    const applyRelease = new Promise<void>((resolve) => {
      releaseApply = resolve;
    });
    const engine = WorkflowEngine.open({
      consumerRoot: fixture.consumerRoot,
      stateRoot: fixture.stateRoot,
      deliverySource: {
        load: async () => ({
          version: 2 as const,
          gate: "gate-b" as const,
          revision: 1,
          receiptHash: "c".repeat(64),
          plan: packagePlan(change),
        }),
      },
      worker: {
        runAttempt: async (input: Record<string, unknown>) => ({
          kind: "phase-committed" as const,
          artifactHash: "d".repeat(64),
          isolatedRevisionId: "e".repeat(64),
          exitCode: input.phase === "red" ? 1 : 0,
          classification:
            input.phase === "red"
              ? ("expected-red" as const)
              : ("expected-green" as const),
        }),
        rebind: () => ({ ok: true as const, routeId: "inherited" }),
      },
      changeVerifier: {
        verify: async () => ({
          kind: "verified" as const,
          verificationId: "change-suite",
        }),
      },
      application: {
        prepare: async (input: Record<string, unknown>) => {
          prepareStarted(String(input.transactionId));
          await prepareRelease;
          return { state: "prepared" };
        },
        applyPrepared: async () => {
          applyStarted();
          await applyRelease;
          return { state: "paused", code: "apply-fixture-complete" };
        },
        begin: async () => {
          throw new Error("legacy begin must not run");
        },
        requestControl: () => ({ state: "recovering" }),
        recover: async () => ({ state: "paused", code: "recovered" }),
      },
    });
    const execution = engine.execute({
      command: "start",
      stage: "abel-implement",
      change,
      operationId: "prepare-before-applying-start",
    });
    await expect(preparing).resolves.toMatch(/^apply-[a-f0-9]{40}$/u);
    await expect(
      engine.execute({
        command: "status",
        stage: "abel-implement",
        change,
      }),
    ).resolves.toMatchObject({ state: "ready-to-apply", completed: false });

    releasePrepare();
    await applying;
    await expect(
      engine.execute({
        command: "status",
        stage: "abel-implement",
        change,
      }),
    ).resolves.toMatchObject({ state: "applying", completed: false });
    releaseApply();
    await expect(execution).resolves.toMatchObject({
      state: "paused",
      pause: { code: "apply-fixture-complete" },
    });
    await engine.close();
  });

  it("rejects Design commands before the implementation delivery path", async () => {
    const module = (await import("../src/workflow-engine.ts")) as Record<
      string,
      unknown
    >;
    const WorkflowEngine = module.WorkflowEngine as {
      open(options: Record<string, unknown>): {
        execute(command: unknown): Promise<Record<string, unknown>>;
        close(): Promise<void>;
      };
    };
    const fixture = directEngineFixture("design-stage-separation");
    let deliveryCalls = 0;
    let workerCalls = 0;
    const engine = WorkflowEngine.open({
      consumerRoot: fixture.consumerRoot,
      stateRoot: fixture.stateRoot,
      deliverySource: {
        load: async () => {
          deliveryCalls += 1;
          throw new Error("Design must not load an implementation plan");
        },
      },
      worker: {
        runAttempt: async () => {
          workerCalls += 1;
          throw new Error("Design must not run an implementation Worker");
        },
        rebind: () => ({ ok: true as const, routeId: "inherited" }),
      },
      changeVerifier: {
        verify: async () => {
          throw new Error("Design must not run implementation verification");
        },
      },
    });
    await expect(
      engine.execute({
        command: "start",
        stage: "abel-design",
        change: "design-stage-separation",
        operationId: "design-stage-start",
      }),
    ).rejects.toThrow(/invalid-control-command/u);
    expect(deliveryCalls).toBe(0);
    expect(workerCalls).toBe(0);
    await engine.close();
  });

  it("lets unknown Worker invariant failures escape", async () => {
    const module = await import("../src/workflow-engine.ts");
    const fixture = directEngineFixture("worker-invariant-failure");
    const change = "worker-invariant-failure";
    const engine = module.WorkflowEngine.open({
      consumerRoot: fixture.consumerRoot,
      stateRoot: fixture.stateRoot,
      deliverySource: {
        load: async () => ({
          version: 2 as const,
          gate: "gate-b" as const,
          revision: 1,
          receiptHash: "4".repeat(64),
          plan: packagePlan(change),
        }),
      },
      worker: {
        runAttempt: async () => {
          throw new Error("task-ledger-integrity-corrupt");
        },
        rebind: () => ({ ok: true as const, routeId: "inherited" }),
      },
      changeVerifier: {
        verify: async () => ({ kind: "paused" as const, code: "unused" }),
      },
    });
    await expect(
      engine.execute({
        command: "start",
        stage: "abel-implement",
        change,
        operationId: "worker-invariant-start",
      }),
    ).rejects.toThrow(/task-ledger-integrity-corrupt/u);
    await engine.close();
  });

  it("expands the baseline for an additive delivery revision", async () => {
    const module = await import("../src/workflow-engine.ts");
    const fixture = directEngineFixture("additive-delivery-baseline");
    const change = "additive-delivery-baseline";
    const plan1 = packagePlan(change);
    const plan2 = structuredClone(plan1);
    const added = structuredClone(plan1.tasks[0]);
    added.taskId = "additive-task";
    added.objective = "Use newly approved context";
    added.context.contract = "additive independent boundary";
    added.scheduling.resources = ["additive-resource"];
    for (const phase of Object.values(added.phases)) {
      phase.read = [...phase.read, "new-context.txt"].sort();
      phase.write = ["new-output.txt"];
      phase.verification.id = `additive-${phase.verification.classification}`;
      phase.verificationLock = "additive-verification";
    }
    added.affectedVerification.id = "additive-affected";
    added.repairVerification.id = "additive-repair";
    plan2.tasks.push(added);
    plan2.tracking.taskIds.push(added.taskId);
    let revision = 1;
    const revalidations: Array<Record<string, unknown>> = [];
    const attempts: Array<Record<string, unknown>> = [];
    const engine = module.WorkflowEngine.open({
      consumerRoot: fixture.consumerRoot,
      stateRoot: fixture.stateRoot,
      deliverySource: {
        load: async () => ({
          version: 2 as const,
          gate: "gate-b" as const,
          revision,
          receiptHash: (revision === 1 ? "5" : "6").repeat(64),
          plan: revision === 1 ? plan1 : plan2,
        }),
      },
      worker: {
        runAttempt: async (input: Record<string, unknown>) => {
          attempts.push({
            taskId: input.taskId,
            baselineRevisionId: input.baselineRevisionId,
          });
          return {
            kind: "paused" as const,
            code: revision === 1 ? "revision-one" : "revision-two",
            baselineRevisionId: (revision === 1 ? "a" : "b").repeat(64),
            currentWorkspaceRevisionId: (revision === 1 ? "a" : "b").repeat(64),
          };
        },
        rebind: () => ({ ok: true as const, routeId: "inherited" }),
        revalidateDelivery: (input: Record<string, unknown>) => {
          revalidations.push(structuredClone(input));
          return {
            invalidatedTaskIds: [],
            baselineRevisionId: "b".repeat(64),
            currentWorkspaceRevisionId: "b".repeat(64),
          };
        },
      },
      changeVerifier: {
        verify: async () => ({ kind: "paused" as const, code: "unused" }),
      },
    });
    await engine.execute({
      command: "start",
      stage: "abel-implement",
      change,
      operationId: "additive-revision-one",
    });
    revision = 2;
    await engine.execute({
      command: "resume",
      stage: "abel-implement",
      change,
      operationId: "additive-revision-two",
      deliveryRevision: 2,
      receiptHash: "6".repeat(64),
    });

    expect(revalidations).toHaveLength(1);
    expect(revalidations[0]).toMatchObject({
      deliveryRevision: 2,
      invalidatedTaskIds: [],
    });
    expect(attempts).toContainEqual(
      expect.objectContaining({
        baselineRevisionId: "b".repeat(64),
      }),
    );
    await engine.close();
  });

  it("reloads a mechanically repaired initial delivery in the same run", async () => {
    const module = (await import("../src/workflow-engine.ts")) as Record<
      string,
      unknown
    >;
    const WorkflowEngine = module.WorkflowEngine as {
      open(options: Record<string, unknown>): {
        execute(command: unknown): Promise<Record<string, unknown>>;
        close(): Promise<void>;
      };
    };
    const fixture = directEngineFixture("typed-delivery-failure");
    let deliveryCalls = 0;
    let workerCalls = 0;
    const options = {
      consumerRoot: fixture.consumerRoot,
      stateRoot: fixture.stateRoot,
      deliverySource: {
        load: async () => {
          deliveryCalls += 1;
          if (deliveryCalls === 1) {
            throw new DeliveryValidationError([
              "delivery-artifact-unbound:tasks.md",
              "delivery-gate-a-hash-mismatch",
            ]);
          }
          return {
            version: 2 as const,
            gate: "gate-b" as const,
            revision: 1,
            receiptHash: "f".repeat(64),
            plan: packagePlan("typed-delivery-failure"),
          };
        },
      },
      worker: {
        runAttempt: async () => {
          workerCalls += 1;
          return { kind: "paused" as const, code: "worker-now-ran" };
        },
        rebind: () => ({ ok: true as const, routeId: "inherited" }),
      },
      changeVerifier: {
        verify: async () => ({
          kind: "paused" as const,
          code: "must-not-verify",
        }),
      },
    };
    let engine = WorkflowEngine.open(options);
    await expect(
      engine.execute({
        command: "start",
        stage: "abel-implement",
        change: "typed-delivery-failure",
        operationId: "typed-delivery-start",
      }),
    ).resolves.toMatchObject({
      state: "paused",
      completed: false,
      pause: { code: "delivery-invalid" },
      delivery: {
        code: "delivery-invalid",
        diagnostics: [
          "delivery-artifact-unbound:tasks.md",
          "delivery-gate-a-hash-mismatch",
        ],
      },
      tasks: [],
    });
    expect(workerCalls).toBe(0);
    await engine.close();
    engine = WorkflowEngine.open(options);
    await expect(
      engine.execute({
        command: "status",
        stage: "abel-implement",
        change: "typed-delivery-failure",
      }),
    ).resolves.toMatchObject({
      state: "paused",
      pause: { code: "delivery-invalid" },
      delivery: {
        code: "delivery-invalid",
        diagnostics: [
          "delivery-artifact-unbound:tasks.md",
          "delivery-gate-a-hash-mismatch",
        ],
      },
      legalCommands: ["status", "resume", "discard"],
      tasks: [],
    });
    const resumed = await engine.execute({
      command: "resume",
      stage: "abel-implement",
      change: "typed-delivery-failure",
      operationId: "typed-delivery-resume",
    });
    expect(resumed).toMatchObject({
      state: "paused",
      completed: false,
      deliveryRevision: 1,
      pause: { code: "worker-now-ran" },
      tasks: [
        {
          taskId: "package-loader-task",
          state: "paused",
        },
      ],
    });
    expect(resumed).not.toHaveProperty("delivery");
    expect(deliveryCalls).toBe(2);
    expect(workerCalls).toBe(1);
    await engine.close();
  });

  it("routes Diagnose packets without admitting Implement control commands", async () => {
    const module = (await import("../src/index.ts")) as Record<string, unknown>;
    const registerWorkflowControl = module.registerWorkflowControl as (
      pi: unknown,
      factory: unknown,
    ) => void;
    let registeredTool:
      | {
          execute(
            toolCallId: string,
            params: unknown,
            signal: AbortSignal | undefined,
            onUpdate: undefined,
            context: Record<string, unknown>,
          ): Promise<{ details: Record<string, unknown> }>;
        }
      | undefined;
    const handlers = new Map<string, (...args: any[]) => any>();
    let activeTools: string[] = [];
    let engineFactoryCalls = 0;
    const packageRoot = path.resolve(import.meta.dirname, "..");
    const pi = {
      registerTool(tool: typeof registeredTool) {
        registeredTool = tool;
      },
      on(name: string, handler: (...args: any[]) => any) {
        handlers.set(name, handler);
      },
      getActiveTools: () => activeTools,
      setActiveTools(tools: string[]) {
        activeTools = tools;
      },
      getCommands: () => [
        {
          name: "abel-diagnose",
          source: "prompt",
          sourceInfo: {
            origin: "package",
            baseDir: packageRoot,
            path: path.join(packageRoot, "prompts", "abel-diagnose.md"),
          },
        },
      ],
    };
    registerWorkflowControl(pi, () => {
      engineFactoryCalls += 1;
      throw new Error("Diagnose packets must not open Implement engine");
    });
    const fixture = directEngineFixture("diagnose-stage-routing");
    handlers.get("input")?.({ text: "/abel-diagnose broken value" });
    handlers.get("before_agent_start")?.(
      {
        prompt:
          "<abel-request>broken value</abel-request> <!-- ABEL:PROMPT:abel-diagnose -->",
      },
      { cwd: fixture.consumerRoot },
    );
    const result = await registeredTool?.execute(
      "diagnose-packet-call",
      {
        action: "cancel",
      },
      undefined,
      undefined,
      { cwd: fixture.consumerRoot },
    );
    expect(result?.details).toMatchObject({
      ok: true,
      action: "cancel",
    });
    await expect(
      registeredTool?.execute(
        "diagnose-ambiguous-envelope",
        {
          action: "cancel",
          command: "discard",
          stage: "abel-implement",
          change: "diagnose-stage-routing",
          operationId: "ambiguous-discard",
        },
        undefined,
        undefined,
        { cwd: fixture.consumerRoot },
      ),
    ).rejects.toThrow(/control-envelope-ambiguous/u);
    await expect(
      registeredTool?.execute(
        "diagnose-cross-stage-call",
        {
          command: "start",
          stage: "abel-implement",
          change: "diagnose-stage-routing",
          operationId: "diagnose-cross-stage-start",
        },
        undefined,
        undefined,
        { cwd: fixture.consumerRoot },
      ),
    ).rejects.toThrow(/stage-control-mismatch/u);
    expect(engineFactoryCalls).toBe(0);
    await handlers.get("session_shutdown")?.();
  });
});

describe("durable verification lifecycle", () => {
  function lifecycleFixture(label: string) {
    const fixture = directEngineFixture(`verification-${label}`);
    const change = `verification-${label}`;
    const tasksPath = path.join(
      fixture.consumerRoot,
      "openspec",
      "changes",
      change,
      "tasks.md",
    );
    mkdirSync(path.dirname(tasksPath), { recursive: true });
    writeFileSync(
      tasksPath,
      "# Tasks\n\n- [ ] package-loader-task — verified task\n",
    );
    return { ...fixture, change, tasksPath, plan: packagePlan(change) };
  }

  const valuePatch = (before: string, after: string) =>
    Buffer.from(
      [
        "diff --git a/value.txt b/value.txt",
        "--- a/value.txt",
        "+++ b/value.txt",
        "@@ -1 +1 @@",
        `-${before}`,
        `+${after}`,
        "",
      ].join("\n"),
    );

  const verifiedPhase = (phase: string) => ({
    ok: true as const,
    exitCode: phase === "red" ? 1 : 0,
    classification:
      phase === "red"
        ? ("expected-red" as const)
        : phase === "refactor"
          ? ("expected-refactor" as const)
          : ("expected-green" as const),
    diagnostic: {
      kind: "assertion" as const,
      id: `verification-lifecycle-${phase}`,
    },
  });

  it("rebases revised tracking bytes and migrates retained verification baselines", async () => {
    const module = await import("../src/workflow-engine.ts");
    const fixture = lifecycleFixture("approved-revision-rebase");
    const plan1 = fixture.plan as unknown as ImplementPlan;
    const plan2 = structuredClone(plan1);
    const added = structuredClone(plan1.tasks[0]);
    added.taskId = "additive-task";
    added.dependsOn = ["package-loader-task"];
    added.objective = "Use newly approved additive context";
    added.context.contract = "approved additive delivery boundary";
    added.scheduling.resources = ["additive-task"];
    for (const phase of Object.values(added.phases)) {
      phase.read = [...phase.read, "new-context.txt"].sort();
      phase.write = ["new-output.txt"];
      phase.verification.id = `additive-${phase.verification.classification}`;
      phase.verificationLock = "additive-verification";
    }
    added.affectedVerification.id = "additive-affected";
    added.repairVerification.id = "additive-repair";
    plan2.tasks.push(added);
    plan2.tracking.taskIds.push(added.taskId);
    let revision = 1;
    const deliverySource = {
      load: async () => ({
        version: 2 as const,
        gate: "gate-b" as const,
        revision,
        receiptHash: (revision === 1 ? "1" : "2").repeat(64),
        plan: revision === 1 ? plan1 : plan2,
      }),
    };
    const verifyChange = async () => ({
      ok: true as const,
      exitCode: 0 as const,
      classification: "expected-green" as const,
      failureIdentities: [],
    });
    let engine = module.openDurableWorkflowEngine({
      consumerRoot: fixture.consumerRoot,
      stateRoot: fixture.stateRoot,
      deliverySource,
      routePolicy: policy(),
      proposeCandidate: async (input: Record<string, unknown>) => {
        (input.onHeaders as () => void)();
        (input.onProgress as () => void)();
        return { kind: "paused" as const, code: "revision-one-paused" };
      },
      verifyPhase: async (input: Record<string, unknown>) =>
        verifiedPhase(String(input.phase)),
      verifyChange,
    });
    const first = await engine.execute({
      command: "start",
      stage: "abel-implement",
      change: fixture.change,
      operationId: "approved-revision-one",
    });
    expect(first).toMatchObject({
      state: "paused",
      pause: { code: "revision-one-paused" },
    });
    await engine.close();

    writeFileSync(path.join(fixture.consumerRoot, "new-context.txt"), "new\n");
    writeFileSync(
      fixture.tasksPath,
      [
        "# Tasks",
        "",
        "- [ ] package-loader-task — retained task",
        "- [ ] additive-task — newly approved task",
        "",
      ].join("\n"),
    );
    revision = 2;
    const observedTracking: string[] = [];
    engine = module.openDurableWorkflowEngine({
      consumerRoot: fixture.consumerRoot,
      stateRoot: fixture.stateRoot,
      deliverySource,
      routePolicy: policy(),
      proposeCandidate: async (input: Record<string, unknown>) => {
        (input.onHeaders as () => void)();
        (input.onProgress as () => void)();
        observedTracking.push(
          readFileSync(
            path.join(
              String(input.workspaceRoot),
              path.relative(fixture.consumerRoot, fixture.tasksPath),
            ),
            "utf8",
          ),
        );
        return { kind: "paused" as const, code: "revision-two-paused" };
      },
      verifyPhase: async (input: Record<string, unknown>) =>
        verifiedPhase(String(input.phase)),
      verifyChange,
    });
    const resumed = await engine.execute({
      command: "resume",
      stage: "abel-implement",
      change: fixture.change,
      operationId: "approved-revision-two",
      deliveryRevision: 2,
      receiptHash: "2".repeat(64),
    });
    expect(resumed).toMatchObject({
      state: "paused",
      pause: { code: "revision-two-paused" },
      privateData: {
        baselineRevisionId: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    });
    expect(observedTracking).toHaveLength(1);
    expect(observedTracking[0]).toContain("additive-task");

    const ledgerDatabase = new DatabaseSync(
      path.join(
        fixture.stateRoot.rootDir,
        "run-data",
        String(first.runId),
        "ledgers",
        "revision-1",
        "task-ledger.sqlite3",
      ),
      { readOnly: true },
    );
    const baselineRow = ledgerDatabase
      .prepare(
        "SELECT fact_json FROM durable_facts WHERE fact_key = 'verification-baseline'",
      )
      .get() as { fact_json: string };
    ledgerDatabase.close();
    expect(JSON.parse(baselineRow.fact_json)).toMatchObject({
      revisionId: (resumed.privateData as { baselineRevisionId: string })
        .baselineRevisionId,
    });
    await engine.close();
  });

  it("pauses a mechanical tracking defect without requesting new authority", async () => {
    const module = await import("../src/workflow-engine.ts");
    const fixture = lifecycleFixture("tracking-defect");
    writeFileSync(
      fixture.tasksPath,
      "# Tasks\n\n- [ ] unrelated-task — stale tracking projection\n",
    );
    let workerCalls = 0;
    const engine = module.openDurableWorkflowEngine({
      consumerRoot: fixture.consumerRoot,
      stateRoot: fixture.stateRoot,
      deliverySource: {
        load: async () => ({
          version: 2 as const,
          gate: "gate-b" as const,
          revision: 1,
          receiptHash: "0".repeat(64),
          plan: fixture.plan,
        }),
      },
      routePolicy: policy(),
      proposeCandidate: async (input: Record<string, unknown>) => {
        workerCalls += 1;
        (input.onHeaders as () => void)();
        (input.onProgress as () => void)();
        return {
          kind: "candidate" as const,
          bytes:
            input.phase === "red"
              ? valuePatch("base", "red")
              : valuePatch("red", "green"),
        };
      },
      verifyPhase: async (input: Record<string, unknown>) =>
        verifiedPhase(String(input.phase)),
      verifyChange: async () => ({
        ok: true as const,
        exitCode: 0 as const,
        classification: "expected-green" as const,
        failureIdentities: [],
      }),
    });

    const paused = await engine.execute({
      command: "start",
      stage: "abel-implement",
      change: fixture.change,
      operationId: "tracking-defect-start",
    });
    expect(paused).toMatchObject({
      state: "paused",
      completed: false,
      pause: { code: "tracking-contract-invalid" },
      legalCommands: expect.arrayContaining(["status", "resume", "discard"]),
      tasks: [
        {
          taskId: "package-loader-task",
          state: "paused",
          phase: "green",
        },
      ],
    });
    expect(JSON.stringify(paused)).not.toMatch(/abel-design|return-to-design/u);
    expect(workerCalls).toBe(2);
    expect(
      readFileSync(path.join(fixture.consumerRoot, "value.txt"), "utf8"),
    ).toBe("base\n");
    await engine.close();
  });

  it("captures baselines before candidates and repairs an introduced affected failure in-boundary", async () => {
    const module = await import("../src/workflow-engine.ts");
    const fixture = lifecycleFixture("introduced-repair");
    fixture.plan.verification.repair.maxAttempts = 2;
    const events: string[] = [];
    const proposals: string[] = [];
    const repairRoutes: string[] = [];
    const engine = module.openDurableWorkflowEngine({
      consumerRoot: fixture.consumerRoot,
      stateRoot: fixture.stateRoot,
      deliverySource: {
        load: async () => ({
          version: 2 as const,
          gate: "gate-b" as const,
          revision: 1,
          receiptHash: "a".repeat(64),
          plan: fixture.plan,
        }),
      },
      routePolicy: policy(),
      proposeCandidate: async (input: Record<string, unknown>) => {
        (input.onHeaders as () => void)();
        const repair = input.repair as
          | { attempt: number; attribution: string }
          | undefined;
        const phase = String(input.phase);
        const routeId = String((input.route as { id: string }).id);
        if (repair) {
          repairRoutes.push(routeId);
          if (routeId === "primary") {
            throw new Error("repair-primary-unavailable");
          }
        }
        (input.onProgress as () => void)();
        proposals.push(repair ? `repair-${repair.attempt}` : phase);
        events.push(`candidate:${repair ? "repair" : phase}`);
        if (repair) {
          expect(repair).toMatchObject({
            attempt: 1,
            attribution: "introduced",
          });
          return {
            kind: "candidate" as const,
            bytes: valuePatch("green", "fixed"),
          };
        }
        return {
          kind: "candidate" as const,
          bytes:
            phase === "red"
              ? valuePatch("base", "red")
              : valuePatch("red", "green"),
        };
      },
      verifyPhase: async (input: Record<string, unknown>) =>
        verifiedPhase(String(input.phase)),
      verifyChange: async (input: Record<string, unknown>) => {
        const scope = String(input.scope);
        const root = String(input.root);
        const value = readFileSync(path.join(root, "value.txt"), "utf8");
        events.push(`verify:${scope}:${value.trim()}`);
        if (scope === "baseline-task-affected") {
          expect(value).toBe("base\n");
          return {
            ok: true as const,
            exitCode: 0 as const,
            classification: "expected-green",
            failureIdentities: [],
          };
        }
        if (scope === "task-affected" && value === "green\n") {
          return {
            ok: false as const,
            kind: "verification" as const,
            code: "verification-rejected",
            failureIdentities: ["b".repeat(64)],
          };
        }
        return {
          ok: true as const,
          exitCode: 0 as const,
          classification: "expected-green",
          failureIdentities: [],
        };
      },
    });

    const completed = await engine.execute({
      command: "start",
      stage: "abel-implement",
      change: fixture.change,
      operationId: "verification-repair-start",
    });
    expect(completed).toMatchObject({
      state: "completed",
      completed: true,
      terminal: "completed",
      routeBinding: { routeId: "inherited" },
    });
    expect(proposals).toEqual(["red", "green", "repair-1"]);
    expect(repairRoutes).toEqual(["primary", "inherited"]);
    expect(
      events.findIndex((event) => event.startsWith("verify:baseline")),
    ).toBeLessThan(events.findIndex((event) => event.startsWith("candidate:")));
    expect(
      readFileSync(path.join(fixture.consumerRoot, "value.txt"), "utf8"),
    ).toBe("fixed\n");
    expect(readFileSync(fixture.tasksPath, "utf8")).toContain(
      "- [x] package-loader-task",
    );
    await engine.close();
  });

  it("rolls back a failing parallel task without erasing a verified sibling revision", async () => {
    const module = await import("../src/workflow-engine.ts");
    const fixture = lifecycleFixture("parallel-rollback");
    writeFileSync(path.join(fixture.consumerRoot, "other.txt"), "other-base\n");
    execFileSync("git", ["add", "other.txt"], { cwd: fixture.consumerRoot });
    writeFileSync(
      fixture.tasksPath,
      [
        "# Tasks",
        "",
        "- [ ] package-loader-task — failing task",
        "- [ ] sibling-task — independent sibling",
        "",
      ].join("\n"),
    );
    const plan = fixture.plan as unknown as ImplementPlan;
    plan.tasks[0].scheduling.resources = ["failing-task"];
    const sibling = structuredClone(plan.tasks[0]);
    sibling.taskId = "sibling-task";
    sibling.objective = "Commit an independent sibling value";
    sibling.context.contract = "approved independent sibling";
    sibling.scheduling.resources = ["sibling-task"];
    for (const phase of Object.values(sibling.phases)) {
      phase.read = phase.read.map((relative) =>
        relative === "value.txt" ? "other.txt" : relative,
      );
      phase.write = ["other.txt"];
      phase.verificationLock = "sibling-verification";
      phase.verification.id = `sibling-${phase.verification.classification}`;
    }
    sibling.affectedVerification.id = "sibling-affected";
    sibling.repairVerification.id = "sibling-repair";
    plan.tasks.push(sibling);
    plan.tracking.taskIds = ["package-loader-task", "sibling-task"];

    const patchFile = (file: string, before: string, after: string) =>
      Buffer.from(
        [
          `diff --git a/${file} b/${file}`,
          `--- a/${file}`,
          `+++ b/${file}`,
          "@@ -1 +1 @@",
          `-${before}`,
          `+${after}`,
          "",
        ].join("\n"),
      );
    let failingVerificationStarted!: () => void;
    const failingVerification = new Promise<void>((resolve) => {
      failingVerificationStarted = resolve;
    });
    let releaseFailure!: () => void;
    const failureGate = new Promise<void>((resolve) => {
      releaseFailure = resolve;
    });
    let failAffected = true;
    const engine = module.openDurableWorkflowEngine({
      consumerRoot: fixture.consumerRoot,
      stateRoot: fixture.stateRoot,
      deliverySource: {
        load: async () => ({
          version: 2 as const,
          gate: "gate-b" as const,
          revision: 1,
          receiptHash: "9".repeat(64),
          plan,
        }),
      },
      routePolicy: policy(),
      proposeCandidate: async (input: Record<string, unknown>) => {
        (input.onHeaders as () => void)();
        (input.onProgress as () => void)();
        const isSibling = input.taskId === "sibling-task";
        const phase = String(input.phase);
        return {
          kind: "candidate" as const,
          bytes: patchFile(
            isSibling ? "other.txt" : "value.txt",
            phase === "red" ? (isSibling ? "other-base" : "base") : "red",
            phase === "red" ? "red" : "green",
          ),
        };
      },
      verifyPhase: async (input: Record<string, unknown>) =>
        verifiedPhase(String(input.phase)),
      verifyChange: async (input: Record<string, unknown>) => {
        if (
          input.scope === "task-affected" &&
          input.taskId === "package-loader-task" &&
          readFileSync(path.join(String(input.root), "value.txt"), "utf8") ===
            "green\n"
        ) {
          failingVerificationStarted();
          await failureGate;
          if (failAffected) {
            return {
              ok: false as const,
              kind: "environment" as const,
              code: "parallel-task-verification-paused",
            };
          }
        }
        return {
          ok: true as const,
          exitCode: 0 as const,
          classification: "expected-green",
          failureIdentities: [],
        };
      },
    });

    const starting = engine.execute({
      command: "start",
      stage: "abel-implement",
      change: fixture.change,
      operationId: "parallel-rollback-start",
    });
    await failingVerification;
    let siblingVerified = false;
    for (let attempt = 0; attempt < 200 && !siblingVerified; attempt += 1) {
      const status = await engine.execute({
        command: "status",
        stage: "abel-implement",
        change: fixture.change,
      });
      siblingVerified = (status.tasks as Array<Record<string, unknown>>).some(
        (task) => task.taskId === "sibling-task" && task.state === "verified",
      );
      if (!siblingVerified)
        await new Promise((resolve) => setImmediate(resolve));
    }
    expect(siblingVerified).toBe(true);
    releaseFailure();
    await expect(starting).resolves.toMatchObject({
      state: "paused",
      pause: { code: "parallel-task-verification-paused" },
      tasks: expect.arrayContaining([
        { taskId: "sibling-task", state: "verified" },
      ]),
    });

    failAffected = false;
    await expect(
      engine.execute({
        command: "resume",
        stage: "abel-implement",
        change: fixture.change,
        operationId: "parallel-rollback-resume",
      }),
    ).resolves.toMatchObject({ state: "completed", completed: true });
    expect(
      readFileSync(path.join(fixture.consumerRoot, "value.txt"), "utf8"),
    ).toBe("green\n");
    expect(
      readFileSync(path.join(fixture.consumerRoot, "other.txt"), "utf8"),
    ).toBe("green\n");
    expect(readFileSync(fixture.tasksPath, "utf8")).toContain(
      "- [x] sibling-task",
    );
    await engine.close();
  });

  it("keeps a cumulative descendant when replaying a historical phase fact", async () => {
    const module = await import("../src/workflow-engine.ts");
    const fixture = directEngineFixture("phase-replay-descendant");
    const change = "phase-replay-descendant";
    writeFileSync(path.join(fixture.consumerRoot, "sibling.txt"), "base\n");
    execFileSync("git", ["add", "sibling.txt"], { cwd: fixture.consumerRoot });
    const plan = packagePlan(change);
    const sibling = structuredClone(plan.tasks[0]);
    sibling.taskId = "descendant-sibling";
    sibling.objective = "Commit an independent cumulative descendant";
    sibling.scheduling.resources = ["descendant-sibling-resource"];
    for (const [phase, contract] of Object.entries(sibling.phases)) {
      contract.read = ["package.json", "test/fixture.test.ts", "sibling.txt"];
      contract.write = ["sibling.txt"];
      contract.verification.id = `descendant-sibling-${phase}`;
      contract.verificationLock = "descendant-sibling-verification";
    }
    sibling.affectedVerification.id = "descendant-sibling-affected";
    sibling.repairVerification.id = "descendant-sibling-repair";
    plan.tasks.push(sibling);
    plan.tracking.taskIds.push(sibling.taskId);
    const patchFile = (file: string, before: string, after: string) =>
      Buffer.from(
        [
          `diff --git a/${file} b/${file}`,
          `--- a/${file}`,
          `+++ b/${file}`,
          "@@ -1 +1 @@",
          `-${before}`,
          `+${after}`,
          "",
        ].join("\n"),
      );
    let ownerGreenCalls = 0;
    const services = {
      consumerRoot: fixture.consumerRoot,
      stateRoot: fixture.stateRoot,
      deliverySource: {
        load: async () => ({
          version: 2 as const,
          gate: "gate-b" as const,
          revision: 1,
          receiptHash: "4".repeat(64),
          plan,
        }),
      },
      routePolicy: policy(),
      proposeCandidate: async (input: Record<string, unknown>) => {
        (input.onHeaders as () => void)();
        (input.onProgress as () => void)();
        const taskId = String(input.taskId);
        const phase = String(input.phase);
        if (taskId === "package-loader-task") {
          if (phase === "red") {
            return {
              kind: "candidate" as const,
              bytes: patchFile("value.txt", "base", "red"),
            };
          }
          ownerGreenCalls += 1;
          if (ownerGreenCalls === 1) {
            return { kind: "paused" as const, code: "seed-replay-gap" };
          }
          expect(
            readFileSync(
              path.join(String(input.workspaceRoot), "sibling.txt"),
              "utf8",
            ),
          ).toBe("green\n");
          return { kind: "paused" as const, code: "descendant-preserved" };
        }
        return {
          kind: "candidate" as const,
          bytes:
            phase === "red"
              ? patchFile("sibling.txt", "base", "red")
              : patchFile("sibling.txt", "red", "green"),
        };
      },
      verifyPhase: async (input: Record<string, unknown>) => ({
        ok: true as const,
        exitCode: input.phase === "red" ? 1 : 0,
        classification:
          input.phase === "red"
            ? ("expected-red" as const)
            : ("expected-green" as const),
        diagnostic: {
          kind: "assertion" as const,
          id: `${String(input.taskId)}-${String(input.phase)}`,
        },
      }),
      verifyChange: async () => ({
        ok: true as const,
        exitCode: 0 as const,
        classification: "expected-green",
        failureIdentities: [],
      }),
    };
    let engine = module.openDurableWorkflowEngine(services);
    const first = await engine.execute({
      command: "start",
      stage: "abel-implement",
      change,
      operationId: "phase-replay-descendant-start",
    });
    expect(first).toMatchObject({
      state: "paused",
      tasks: expect.arrayContaining([
        { taskId: "package-loader-task", state: "paused", phase: "green" },
        { taskId: "descendant-sibling", state: "verified" },
      ]),
    });
    await engine.close();

    const database = new DatabaseSync(fixture.stateRoot.databasePath);
    database
      .prepare(
        `UPDATE workflow_engine_tasks
         SET state = 'pending', phase = 'red', pause_code = NULL,
             queue_position = NULL
         WHERE run_id = ? AND task_id = 'package-loader-task'`,
      )
      .run(String(first.runId));
    database.close();

    engine = module.openDurableWorkflowEngine(services);
    await expect(
      engine.execute({
        command: "resume",
        stage: "abel-implement",
        change,
        operationId: "phase-replay-descendant-resume",
      }),
    ).resolves.toMatchObject({
      state: "paused",
      pause: { code: "descendant-preserved" },
      tasks: expect.arrayContaining([
        { taskId: "descendant-sibling", state: "verified" },
      ]),
    });
    await engine.close();
  });

  it("keeps baseline failures separate and pauses an unresolved full-suite introduction without routing to Design", async () => {
    const module = await import("../src/workflow-engine.ts");
    const fixture = lifecycleFixture("baseline-attribution");
    let fullSuiteIntroduced = true;
    let workerCalls = 0;
    const engine = module.openDurableWorkflowEngine({
      consumerRoot: fixture.consumerRoot,
      stateRoot: fixture.stateRoot,
      deliverySource: {
        load: async () => ({
          version: 2 as const,
          gate: "gate-b" as const,
          revision: 1,
          receiptHash: "c".repeat(64),
          plan: fixture.plan,
        }),
      },
      routePolicy: policy(),
      proposeCandidate: async (input: Record<string, unknown>) => {
        workerCalls += 1;
        (input.onHeaders as () => void)();
        (input.onProgress as () => void)();
        return {
          kind: "candidate" as const,
          bytes:
            input.phase === "red"
              ? valuePatch("base", "red")
              : valuePatch("red", "green"),
        };
      },
      verifyPhase: async (input: Record<string, unknown>) =>
        verifiedPhase(String(input.phase)),
      verifyChange: async (input: Record<string, unknown>) => {
        const scope = String(input.scope);
        if (
          scope === "baseline-task-affected" ||
          scope === "task-affected" ||
          scope === "change-task-affected"
        ) {
          return {
            ok: false as const,
            kind: "verification" as const,
            code: "verification-rejected",
            failureIdentities: ["d".repeat(64)],
          };
        }
        if (scope === "baseline-full-suite") {
          return {
            ok: false as const,
            kind: "verification" as const,
            code: "verification-rejected",
            failureIdentities: ["e".repeat(64)],
          };
        }
        if (scope === "change-full-suite" && fullSuiteIntroduced) {
          return {
            ok: false as const,
            kind: "verification" as const,
            code: "verification-rejected",
            failureIdentities: ["e".repeat(64), "f".repeat(64)],
          };
        }
        return {
          ok: true as const,
          exitCode: 0 as const,
          classification: "expected-green",
          failureIdentities: [],
        };
      },
    });

    const paused = await engine.execute({
      command: "start",
      stage: "abel-implement",
      change: fixture.change,
      operationId: "verification-attribution-start",
    });
    expect(paused).toMatchObject({
      state: "paused",
      completed: false,
      pause: { code: "verification-attribution-unresolved" },
      verification: {
        attribution: "unresolved",
        scope: "change-full-suite",
      },
    });
    expect(JSON.stringify(paused)).not.toMatch(/abel-design|return-to-design/u);
    expect(
      readFileSync(path.join(fixture.consumerRoot, "value.txt"), "utf8"),
    ).toBe("base\n");

    fullSuiteIntroduced = false;
    const completed = await engine.execute({
      command: "resume",
      stage: "abel-implement",
      change: fixture.change,
      operationId: "verification-attribution-resume",
    });
    expect(completed).toMatchObject({ state: "completed", completed: true });
    expect(workerCalls).toBe(2);
    await engine.close();
  });

  it("treats baseline environment unavailability as a resumable pause before Worker execution", async () => {
    const module = await import("../src/workflow-engine.ts");
    const fixture = lifecycleFixture("baseline-environment");
    let environmentReady = false;
    let workerCalls = 0;
    const engine = module.openDurableWorkflowEngine({
      consumerRoot: fixture.consumerRoot,
      stateRoot: fixture.stateRoot,
      deliverySource: {
        load: async () => ({
          version: 2 as const,
          gate: "gate-b" as const,
          revision: 1,
          receiptHash: "1".repeat(64),
          plan: fixture.plan,
        }),
      },
      routePolicy: policy(),
      proposeCandidate: async (input: Record<string, unknown>) => {
        workerCalls += 1;
        (input.onHeaders as () => void)();
        (input.onProgress as () => void)();
        return {
          kind: "candidate" as const,
          bytes:
            input.phase === "red"
              ? valuePatch("base", "red")
              : valuePatch("red", "green"),
        };
      },
      verifyPhase: async (input: Record<string, unknown>) =>
        verifiedPhase(String(input.phase)),
      verifyChange: async (input: Record<string, unknown>) => {
        if (String(input.scope).startsWith("baseline-") && !environmentReady) {
          return {
            ok: false as const,
            kind: "environment" as const,
            code: "sandbox-runtime-unavailable",
          };
        }
        return {
          ok: true as const,
          exitCode: 0 as const,
          classification: "expected-green",
          failureIdentities: [],
        };
      },
    });

    await expect(
      engine.execute({
        command: "start",
        stage: "abel-implement",
        change: fixture.change,
        operationId: "baseline-environment-start",
      }),
    ).resolves.toMatchObject({
      state: "paused",
      completed: false,
      pause: { code: "sandbox-runtime-unavailable" },
      verification: { attribution: "environment", scope: "baseline" },
    });
    expect(workerCalls).toBe(0);

    environmentReady = true;
    await expect(
      engine.execute({
        command: "resume",
        stage: "abel-implement",
        change: fixture.change,
        operationId: "baseline-environment-resume",
      }),
    ).resolves.toMatchObject({ state: "completed", completed: true });
    expect(workerCalls).toBe(2);
    await engine.close();
  });

  it("reopens the owning task and repairs a cumulative affected failure without returning to Design", async () => {
    const module = await import("../src/workflow-engine.ts");
    const fixture = lifecycleFixture("cumulative-repair");
    const proposals: string[] = [];
    const engine = module.openDurableWorkflowEngine({
      consumerRoot: fixture.consumerRoot,
      stateRoot: fixture.stateRoot,
      deliverySource: {
        load: async () => ({
          version: 2 as const,
          gate: "gate-b" as const,
          revision: 1,
          receiptHash: "2".repeat(64),
          plan: fixture.plan,
        }),
      },
      routePolicy: policy(),
      proposeCandidate: async (input: Record<string, unknown>) => {
        (input.onHeaders as () => void)();
        (input.onProgress as () => void)();
        const repair = input.repair as { attempt: number } | undefined;
        const phase = String(input.phase);
        proposals.push(repair ? `repair-${repair.attempt}` : phase);
        return {
          kind: "candidate" as const,
          bytes: repair
            ? valuePatch("green", "fixed")
            : phase === "red"
              ? valuePatch("base", "red")
              : valuePatch("red", "green"),
        };
      },
      verifyPhase: async (input: Record<string, unknown>) =>
        verifiedPhase(String(input.phase)),
      verifyChange: async (input: Record<string, unknown>) => {
        const scope = String(input.scope);
        const value = readFileSync(
          path.join(String(input.root), "value.txt"),
          "utf8",
        );
        if (scope === "change-task-affected" && value === "green\n") {
          return {
            ok: false as const,
            kind: "verification" as const,
            code: "verification-rejected",
            failureIdentities: ["3".repeat(64)],
          };
        }
        return {
          ok: true as const,
          exitCode: 0 as const,
          classification: "expected-green",
          failureIdentities: [],
        };
      },
    });

    const completed = await engine.execute({
      command: "start",
      stage: "abel-implement",
      change: fixture.change,
      operationId: "cumulative-repair-start",
    });
    expect(completed).toMatchObject({ state: "completed", completed: true });
    expect(JSON.stringify(completed)).not.toMatch(
      /abel-design|return-to-design/u,
    );
    expect(proposals).toEqual(["red", "green", "repair-1"]);
    expect(
      readFileSync(path.join(fixture.consumerRoot, "value.txt"), "utf8"),
    ).toBe("fixed\n");
    await engine.close();
  });

  it("corrects a Green constraint caused by its accepted Red artifact without Design", async () => {
    const module = await import("../src/workflow-engine.ts");
    const fixture = lifecycleFixture("red-artifact-context-correction");
    const proposals: string[] = [];
    const correctionEvidence: unknown[] = [];
    const phaseVerifications: string[] = [];
    const engine = module.openDurableWorkflowEngine({
      consumerRoot: fixture.consumerRoot,
      stateRoot: fixture.stateRoot,
      deliverySource: {
        load: async () => ({
          version: 2 as const,
          gate: "gate-b" as const,
          revision: 1,
          receiptHash: "8".repeat(64),
          plan: fixture.plan,
        }),
      },
      routePolicy: policy(),
      proposeCandidate: async (input: Record<string, unknown>) => {
        (input.onHeaders as () => void)();
        (input.onProgress as () => void)();
        const correction = input.artifactCorrection as
          | { code: string }
          | undefined;
        proposals.push(
          correction ? `correction:${correction.code}` : String(input.phase),
        );
        if (correction) correctionEvidence.push(structuredClone(correction));
        if (input.phase === "red") {
          return {
            kind: "candidate" as const,
            bytes: valuePatch("base", "red"),
          };
        }
        if (correction) {
          return {
            kind: "candidate" as const,
            bytes: valuePatch("red", "green"),
          };
        }
        return {
          kind: "retryable" as const,
          code: "red-artifact-constraint",
          contextRequest: {
            code: "boundary-review-needed" as const,
            refs: [
              {
                kind: "source-citation" as const,
                path: "test/fixture.test.ts",
                line: 209,
              },
              {
                kind: "contract-diagnostic" as const,
                ref: "phase-contract.writeSet",
              },
              {
                kind: "requested-path" as const,
                path: "scripts/AGENTS.md",
                access: "read" as const,
              },
            ],
          },
        };
      },
      verifyPhase: async (input: Record<string, unknown>) => {
        phaseVerifications.push(
          `${String(input.phase)}:${String(
            (input.verification as { id?: unknown }).id,
          )}`,
        );
        return verifiedPhase(String(input.phase));
      },
      verifyChange: async () => ({
        ok: true as const,
        exitCode: 0 as const,
        classification: "expected-green" as const,
        failureIdentities: [],
      }),
    });

    const completed = await engine.execute({
      command: "start",
      stage: "abel-implement",
      change: fixture.change,
      operationId: "red-artifact-context-start",
    });
    expect(completed).toMatchObject({ state: "completed", completed: true });
    expect(JSON.stringify(completed)).not.toMatch(/designRequest/u);
    expect(proposals).toEqual([
      "red",
      "green",
      "correction:red-artifact-constraint",
    ]);
    expect(correctionEvidence).toEqual([
      {
        code: "red-artifact-constraint",
        attempt: 2,
        maxAttempts: 2,
        contextRequest: {
          code: "boundary-review-needed",
          refs: [
            {
              kind: "source-citation",
              path: "test/fixture.test.ts",
              line: 209,
            },
            {
              kind: "contract-diagnostic",
              ref: "phase-contract.writeSet",
            },
            {
              kind: "requested-path",
              path: "scripts/AGENTS.md",
              access: "read",
            },
          ],
        },
      },
    ]);
    expect(phaseVerifications).toEqual([
      "red:package-loader-red",
      "green:package-loader-repair",
      "red:package-loader-red",
      "green:package-loader-green",
    ]);
    expect(
      readFileSync(path.join(fixture.consumerRoot, "value.txt"), "utf8"),
    ).toBe("green\n");
    await engine.close();
  });

  it("commits corrected Green evidence before continuing to Refactor", async () => {
    const module = await import("../src/workflow-engine.ts");
    const fixture = lifecycleFixture("red-artifact-refactor-correction");
    const plan = structuredClone(fixture.plan) as ImplementPlan;
    const planTask = plan.tasks[0];
    if (!planTask) throw new Error("refactor fixture task missing");
    planTask.phases.refactor = {
      ...structuredClone(planTask.phases.green),
      write: [...planTask.phases.green.write, "refactor-output.txt"],
      verification: {
        ...structuredClone(planTask.phases.green.verification),
        id: "package-loader-refactor",
        classification: "expected-refactor" as const,
      },
    };
    plan.outputs.push({
      id: "refactor-output",
      path: "refactor-output.txt",
      producer: { taskId: "package-loader-task", phase: "refactor" },
      postcondition: "regular-file",
    });
    const proposals: string[] = [];
    const engine = module.openDurableWorkflowEngine({
      consumerRoot: fixture.consumerRoot,
      stateRoot: fixture.stateRoot,
      deliverySource: {
        load: async () => ({
          version: 2 as const,
          gate: "gate-b" as const,
          revision: 1,
          receiptHash: "7".repeat(64),
          plan,
        }),
      },
      routePolicy: policy(),
      proposeCandidate: async (input: Record<string, unknown>) => {
        (input.onHeaders as () => void)();
        (input.onProgress as () => void)();
        const phase = String(input.phase);
        if (phase === "red") {
          proposals.push("red");
          return {
            kind: "candidate" as const,
            bytes: valuePatch("base", "red"),
          };
        }
        if (input.artifactCorrection) {
          proposals.push("correction");
          return {
            kind: "candidate" as const,
            bytes: valuePatch("red", "green"),
          };
        }
        if (phase === "refactor") {
          proposals.push("refactor");
          return {
            kind: "candidate" as const,
            bytes: Buffer.from(
              [
                "diff --git a/value.txt b/value.txt",
                "--- a/value.txt",
                "+++ b/value.txt",
                "@@ -1 +1 @@",
                "-green",
                "+refactored",
                "diff --git a/refactor-output.txt b/refactor-output.txt",
                "new file mode 100644",
                "--- /dev/null",
                "+++ b/refactor-output.txt",
                "@@ -0,0 +1 @@",
                "+refactor complete",
                "",
              ].join("\n"),
            ),
          };
        }
        proposals.push("green");
        return {
          kind: "retryable" as const,
          code: "red-artifact-constraint",
          contextRequest: {
            code: "approved-context-needed" as const,
            refs: [
              {
                kind: "source-citation" as const,
                path: "test/fixture.test.ts",
                line: 209,
              },
            ],
          },
        };
      },
      verifyPhase: async (input: Record<string, unknown>) =>
        verifiedPhase(String(input.phase)),
      verifyChange: async () => ({
        ok: true as const,
        exitCode: 0 as const,
        classification: "expected-green" as const,
        failureIdentities: [],
      }),
    });

    const completed = await engine.execute({
      command: "start",
      stage: "abel-implement",
      change: fixture.change,
      operationId: "red-artifact-refactor-start",
    });
    expect(completed).toMatchObject({ state: "completed", completed: true });
    expect(proposals).toEqual(["red", "green", "correction", "refactor"]);
    expect(
      readFileSync(path.join(fixture.consumerRoot, "value.txt"), "utf8"),
    ).toBe("refactored\n");
    expect(
      readFileSync(
        path.join(fixture.consumerRoot, "refactor-output.txt"),
        "utf8",
      ),
    ).toBe("refactor complete\n");
    await engine.close();
  });

  it.each([
    ["red", "red-not-witnessed"],
    ["green", "verification-rejected"],
  ] as const)(
    "rejects a correction when the corrected %s contract does not verify",
    async (rejectedPhase, rejectionCode) => {
      const module = await import("../src/workflow-engine.ts");
      const fixture = lifecycleFixture(
        `red-artifact-${rejectedPhase}-verification`,
      );
      let redCalls = 0;
      const engine = module.openDurableWorkflowEngine({
        consumerRoot: fixture.consumerRoot,
        stateRoot: fixture.stateRoot,
        deliverySource: {
          load: async () => ({
            version: 2 as const,
            gate: "gate-b" as const,
            revision: 1,
            receiptHash: "6".repeat(64),
            plan: fixture.plan,
          }),
        },
        routePolicy: policy(),
        proposeCandidate: async (input: Record<string, unknown>) => {
          (input.onHeaders as () => void)();
          (input.onProgress as () => void)();
          if (input.phase === "red") {
            return {
              kind: "candidate" as const,
              bytes: valuePatch("base", "red"),
            };
          }
          if (input.artifactCorrection) {
            return {
              kind: "candidate" as const,
              bytes: valuePatch("red", "green"),
            };
          }
          return {
            kind: "retryable" as const,
            code: "red-artifact-constraint",
            contextRequest: {
              code: "approved-context-needed" as const,
              refs: [
                {
                  kind: "source-citation" as const,
                  path: "test/fixture.test.ts",
                  line: 209,
                },
              ],
            },
          };
        },
        verifyPhase: async (input: Record<string, unknown>) => {
          const phase = String(input.phase);
          const verificationId = String(
            (input.verification as { id?: unknown }).id,
          );
          if (phase === "red") {
            redCalls += 1;
            if (rejectedPhase === "red" && redCalls === 2) {
              return {
                ok: false as const,
                kind: "retryable" as const,
                code: rejectionCode,
              };
            }
          }
          if (
            rejectedPhase === "green" &&
            verificationId === "package-loader-green"
          ) {
            return {
              ok: false as const,
              kind: "retryable" as const,
              code: rejectionCode,
            };
          }
          return verifiedPhase(phase);
        },
        verifyChange: async () => ({
          ok: true as const,
          exitCode: 0 as const,
          classification: "expected-green" as const,
          failureIdentities: [],
        }),
      });

      const paused = await engine.execute({
        command: "start",
        stage: "abel-implement",
        change: fixture.change,
        operationId: `red-artifact-${rejectedPhase}-verification-start`,
      });
      expect(paused).toMatchObject({
        state: "paused",
        pause: { code: rejectionCode },
        tasks: [
          {
            taskId: "package-loader-task",
            state: "retryable",
            phase: "green",
          },
        ],
      });
      expect(
        readFileSync(path.join(fixture.consumerRoot, "value.txt"), "utf8"),
      ).toBe("base\n");
      await engine.close();
    },
  );

  it("rejects partial Red-artifact corrections and exhausts the sealed attempt budget", async () => {
    const module = await import("../src/workflow-engine.ts");
    const fixture = lifecycleFixture("red-artifact-partial-correction");
    const plan = structuredClone(fixture.plan);
    plan.verification.artifactCorrection.maxAttempts = 3;
    plan.tasks[0]?.phases.green.write.push("extra.txt");
    (
      plan.outputs as Array<{
        id: string;
        path: string;
        producer: { taskId: string; phase: "green" };
        postcondition: "regular-file";
      }>
    ).push({
      id: "partial-correction-output",
      path: "extra.txt",
      producer: { taskId: "package-loader-task", phase: "green" },
      postcondition: "regular-file",
    });
    let correctionCalls = 0;
    const engine = module.openDurableWorkflowEngine({
      consumerRoot: fixture.consumerRoot,
      stateRoot: fixture.stateRoot,
      deliverySource: {
        load: async () => ({
          version: 2 as const,
          gate: "gate-b" as const,
          revision: 1,
          receiptHash: "9".repeat(64),
          plan,
        }),
      },
      routePolicy: policy(),
      proposeCandidate: async (input: Record<string, unknown>) => {
        (input.onHeaders as () => void)();
        (input.onProgress as () => void)();
        if (input.phase === "red") {
          return {
            kind: "candidate" as const,
            bytes: valuePatch("base", "red"),
          };
        }
        if (input.artifactCorrection) {
          correctionCalls += 1;
          return {
            kind: "candidate" as const,
            bytes: valuePatch("red", `partial-${correctionCalls}`),
          };
        }
        return {
          kind: "retryable" as const,
          code: "red-artifact-constraint",
          contextRequest: {
            code: "approved-context-needed" as const,
            refs: [
              {
                kind: "source-citation" as const,
                path: "test/fixture.test.ts",
                line: 209,
              },
            ],
          },
        };
      },
      verifyPhase: async (input: Record<string, unknown>) =>
        verifiedPhase(String(input.phase)),
      verifyChange: async () => ({
        ok: true as const,
        exitCode: 0 as const,
        classification: "expected-green" as const,
        failureIdentities: [],
      }),
    });

    const paused = await engine.execute({
      command: "start",
      stage: "abel-implement",
      change: fixture.change,
      operationId: "red-artifact-partial-start",
    });
    expect(paused).toMatchObject({
      state: "paused",
      pause: { code: "producer-output-unavailable" },
      tasks: [
        {
          taskId: "package-loader-task",
          state: "retryable",
          phase: "green",
        },
      ],
      privateData: { retained: true },
    });
    expect(JSON.stringify(paused)).not.toMatch(/designRequest/u);
    expect(correctionCalls).toBe(
      plan.verification.artifactCorrection.maxAttempts - 1,
    );
    expect(
      readFileSync(path.join(fixture.consumerRoot, "value.txt"), "utf8"),
    ).toBe("base\n");
    expect(existsSync(path.join(fixture.consumerRoot, "extra.txt"))).toBe(
      false,
    );
    await engine.close();
  });

  it("classifies an out-of-bound repair as an explicit user-owned Design revision", async () => {
    const module = await import("../src/workflow-engine.ts");
    const fixture = lifecycleFixture("repair-boundary");
    const outsidePatch = Buffer.from(
      [
        "diff --git a/outside.txt b/outside.txt",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/outside.txt",
        "@@ -0,0 +1 @@",
        "+outside",
        "",
      ].join("\n"),
    );
    const engine = module.openDurableWorkflowEngine({
      consumerRoot: fixture.consumerRoot,
      stateRoot: fixture.stateRoot,
      deliverySource: {
        load: async () => ({
          version: 2 as const,
          gate: "gate-b" as const,
          revision: 1,
          receiptHash: "4".repeat(64),
          plan: fixture.plan,
        }),
      },
      routePolicy: policy(),
      proposeCandidate: async (input: Record<string, unknown>) => {
        (input.onHeaders as () => void)();
        (input.onProgress as () => void)();
        if (input.repair) {
          return { kind: "candidate" as const, bytes: outsidePatch };
        }
        return {
          kind: "candidate" as const,
          bytes:
            input.phase === "red"
              ? valuePatch("base", "red")
              : valuePatch("red", "green"),
        };
      },
      verifyPhase: async (input: Record<string, unknown>) =>
        verifiedPhase(String(input.phase)),
      verifyChange: async (input: Record<string, unknown>) => {
        const scope = String(input.scope);
        const value = readFileSync(
          path.join(String(input.root), "value.txt"),
          "utf8",
        );
        if (scope === "task-affected" && value === "green\n") {
          return {
            ok: false as const,
            kind: "verification" as const,
            code: "verification-rejected",
            failureIdentities: ["5".repeat(64)],
          };
        }
        return {
          ok: true as const,
          exitCode: 0 as const,
          classification: "expected-green",
          failureIdentities: [],
        };
      },
    });

    const approval = await engine.execute({
      command: "start",
      stage: "abel-implement",
      change: fixture.change,
      operationId: "repair-boundary-start",
    });
    expect(approval).toMatchObject({
      state: "approval-needed",
      completed: false,
      pause: { code: "repair-boundary-expansion" },
      legalCommands: ["status", "discard"],
      approval: {
        category: "path-boundary",
        requiredGates: ["gate-b"],
        refs: [],
        designRequest: `/abel-design --change ${fixture.change}`,
        receiptPrecondition: {
          deliveryRevision: { greaterThan: 1 },
          receiptHash: "matching-ready-receipt",
        },
      },
    });
    expect(JSON.stringify(approval)).not.toMatch(/return-to-design/u);
    expect(
      readFileSync(path.join(fixture.consumerRoot, "value.txt"), "utf8"),
    ).toBe("base\n");
    expect(existsSync(path.join(fixture.consumerRoot, "outside.txt"))).toBe(
      false,
    );
    await engine.close();
  });

  it("resumes after an exhausted repair budget from the last committed phase", async () => {
    const module = await import("../src/workflow-engine.ts");
    const fixture = lifecycleFixture("repair-resume");
    let repairCalls = 0;
    const proposals: string[] = [];
    const engine = module.openDurableWorkflowEngine({
      consumerRoot: fixture.consumerRoot,
      stateRoot: fixture.stateRoot,
      deliverySource: {
        load: async () => ({
          version: 2 as const,
          gate: "gate-b" as const,
          revision: 1,
          receiptHash: "6".repeat(64),
          plan: fixture.plan,
        }),
      },
      routePolicy: policy(),
      proposeCandidate: async (input: Record<string, unknown>) => {
        (input.onHeaders as () => void)();
        (input.onProgress as () => void)();
        if (input.repair) {
          repairCalls += 1;
          proposals.push(`repair-${repairCalls}`);
          return {
            kind: "candidate" as const,
            bytes: valuePatch(
              "green",
              repairCalls === 1 ? "still-broken" : "fixed",
            ),
          };
        }
        proposals.push(String(input.phase));
        return {
          kind: "candidate" as const,
          bytes:
            input.phase === "red"
              ? valuePatch("base", "red")
              : valuePatch("red", "green"),
        };
      },
      verifyPhase: async (input: Record<string, unknown>) =>
        verifiedPhase(String(input.phase)),
      verifyChange: async (input: Record<string, unknown>) => {
        const scope = String(input.scope);
        const value = readFileSync(
          path.join(String(input.root), "value.txt"),
          "utf8",
        );
        if (
          scope === "task-affected" &&
          (value === "green\n" || value === "still-broken\n")
        ) {
          return {
            ok: false as const,
            kind: "verification" as const,
            code: "verification-rejected",
            failureIdentities: ["7".repeat(64)],
          };
        }
        return {
          ok: true as const,
          exitCode: 0 as const,
          classification: "expected-green",
          failureIdentities: [],
        };
      },
    });

    await expect(
      engine.execute({
        command: "start",
        stage: "abel-implement",
        change: fixture.change,
        operationId: "repair-resume-start",
      }),
    ).resolves.toMatchObject({
      state: "paused",
      pause: { code: "repair-attempts-exhausted" },
    });
    expect(
      readFileSync(path.join(fixture.consumerRoot, "value.txt"), "utf8"),
    ).toBe("base\n");

    await expect(
      engine.execute({
        command: "resume",
        stage: "abel-implement",
        change: fixture.change,
        operationId: "repair-resume-second-operation",
      }),
    ).resolves.toMatchObject({ state: "completed", completed: true });
    expect(proposals).toEqual([
      "red",
      "green",
      "repair-1",
      "green",
      "repair-2",
    ]);
    expect(
      readFileSync(path.join(fixture.consumerRoot, "value.txt"), "utf8"),
    ).toBe("fixed\n");
    await engine.close();
  });

  it("reuses the durable verification baseline after a process-style engine restart", async () => {
    const module = await import("../src/workflow-engine.ts");
    const fixture = lifecycleFixture("baseline-restart");
    let baselineCalls = 0;
    let proposalCalls = 0;
    const options = () => ({
      consumerRoot: fixture.consumerRoot,
      stateRoot: fixture.stateRoot,
      deliverySource: {
        load: async () => ({
          version: 2 as const,
          gate: "gate-b" as const,
          revision: 1,
          receiptHash: "8".repeat(64),
          plan: fixture.plan,
        }),
      },
      routePolicy: policy(),
      proposeCandidate: async (input: Record<string, unknown>) => {
        proposalCalls += 1;
        (input.onHeaders as () => void)();
        (input.onProgress as () => void)();
        if (proposalCalls === 1) {
          return { kind: "paused" as const, code: "worker-paused" };
        }
        return {
          kind: "candidate" as const,
          bytes:
            input.phase === "red"
              ? valuePatch("base", "red")
              : valuePatch("red", "green"),
        };
      },
      verifyPhase: async (input: Record<string, unknown>) =>
        verifiedPhase(String(input.phase)),
      verifyChange: async (input: Record<string, unknown>) => {
        if (String(input.scope).startsWith("baseline-")) baselineCalls += 1;
        return {
          ok: true as const,
          exitCode: 0 as const,
          classification: "expected-green",
          failureIdentities: [],
        };
      },
    });
    const first = module.openDurableWorkflowEngine(options());
    await expect(
      first.execute({
        command: "start",
        stage: "abel-implement",
        change: fixture.change,
        operationId: "baseline-restart-start",
      }),
    ).resolves.toMatchObject({
      state: "paused",
      pause: { code: "worker-paused" },
    });
    expect(baselineCalls).toBe(2);
    await first.close();

    const restarted = module.openDurableWorkflowEngine(options());
    await expect(
      restarted.execute({
        command: "resume",
        stage: "abel-implement",
        change: fixture.change,
        operationId: "baseline-restart-resume",
      }),
    ).resolves.toMatchObject({ state: "completed", completed: true });
    expect(baselineCalls).toBe(2);
    expect(proposalCalls).toBe(3);
    await restarted.close();
  });

  it("applies the approved managed-only AGENTS checkpoint inside the private cumulative revision", async () => {
    const module = await import("../src/workflow-engine.ts");
    const fixture = lifecycleFixture("agents-checkpoint");
    const start = "<!-- ABEL:AGENTS-INDEX:START -->";
    const end = "<!-- ABEL:AGENTS-INDEX:END -->";
    const agentsPath = path.join(fixture.consumerRoot, "AGENTS.md");
    writeFileSync(
      agentsPath,
      [
        "# Human policy",
        "",
        start,
        "- old route",
        end,
        "",
        "Human tail remains.",
        "",
      ].join("\n"),
    );
    execFileSync("git", ["add", "AGENTS.md"], { cwd: fixture.consumerRoot });
    const plan = fixture.plan as unknown as ImplementPlan;
    plan.tasks[0].agents = {
      impact: "update-existing" as const,
      target: "AGENTS.md",
      managedOnly: true as const,
    };
    const managedBlock = [
      start,
      "- `src/workflow-engine.ts` owns durable workflow execution.",
      end,
    ].join("\n");
    plan.verification.agentsCheckpoint = {
      required: true,
      verification: structuredClone(plan.verification.change.fullSuite),
      operations: [
        {
          target: "AGENTS.md",
          impact: "update-existing" as const,
          taskIds: ["package-loader-task"],
          managedBlock,
        },
      ],
    };
    let checkpointObserved = false;
    const engine = module.openDurableWorkflowEngine({
      consumerRoot: fixture.consumerRoot,
      stateRoot: fixture.stateRoot,
      deliverySource: {
        load: async () => ({
          version: 2 as const,
          gate: "gate-b" as const,
          revision: 1,
          receiptHash: "9".repeat(64),
          plan,
        }),
      },
      routePolicy: policy(),
      proposeCandidate: async (input: Record<string, unknown>) => {
        (input.onHeaders as () => void)();
        (input.onProgress as () => void)();
        return {
          kind: "candidate" as const,
          bytes:
            input.phase === "red"
              ? valuePatch("base", "red")
              : valuePatch("red", "green"),
        };
      },
      verifyPhase: async (input: Record<string, unknown>) =>
        verifiedPhase(String(input.phase)),
      verifyChange: async (input: Record<string, unknown>) => {
        if (input.scope === "agents-checkpoint") {
          const agents = readFileSync(
            path.join(String(input.root), "AGENTS.md"),
            "utf8",
          );
          expect(agents).toContain("# Human policy");
          expect(agents).toContain("Human tail remains.");
          expect(agents).toContain("durable workflow execution");
          expect(agents).not.toContain("old route");
          checkpointObserved = true;
        }
        return {
          ok: true as const,
          exitCode: 0 as const,
          classification: "expected-green",
          failureIdentities: [],
        };
      },
    });

    await expect(
      engine.execute({
        command: "start",
        stage: "abel-implement",
        change: fixture.change,
        operationId: "agents-checkpoint-start",
      }),
    ).resolves.toMatchObject({ state: "completed", completed: true });
    expect(checkpointObserved).toBe(true);
    const applied = readFileSync(agentsPath, "utf8");
    expect(applied).toContain("# Human policy");
    expect(applied).toContain("Human tail remains.");
    expect(applied).toContain("durable workflow execution");
    expect(applied).not.toContain("old route");
    await engine.close();
  });

  it("rebuilds retained repair facts and tracking when a later delivery invalidates another task", async () => {
    const module = await import("../src/workflow-engine.ts");
    const fixture = lifecycleFixture("repair-revalidation");
    writeFileSync(path.join(fixture.consumerRoot, "other.txt"), "other-base\n");
    execFileSync("git", ["add", "other.txt"], { cwd: fixture.consumerRoot });
    writeFileSync(
      fixture.tasksPath,
      [
        "# Tasks",
        "",
        "- [ ] package-loader-task — retained repaired task",
        "- [ ] secondary-task — revised task",
        "",
      ].join("\n"),
    );
    const plan1 = fixture.plan as unknown as ImplementPlan;
    const secondary = structuredClone(plan1.tasks[0]);
    secondary.taskId = "secondary-task";
    secondary.objective = "Implement the secondary value";
    secondary.context.contract = "approved secondary task";
    secondary.scheduling.resources = ["secondary-task"];
    for (const phase of Object.values(secondary.phases)) {
      phase.read = phase.read.map((relative) =>
        relative === "value.txt" ? "other.txt" : relative,
      );
      phase.write = ["other.txt"];
      phase.verificationLock = "secondary-verification";
      phase.verification.id = `secondary-${phase.verification.classification}`;
    }
    secondary.affectedVerification.id = "secondary-affected";
    secondary.repairVerification.id = "secondary-repair";
    plan1.tasks.push(secondary);
    plan1.tracking.taskIds = ["package-loader-task", "secondary-task"];
    const plan2 = structuredClone(plan1);
    plan2.tasks[1].objective = "Implement the revised secondary value";
    let fullSuiteFails = true;
    const proposals: string[] = [];
    const patchFile = (file: string, before: string, after: string) =>
      Buffer.from(
        [
          `diff --git a/${file} b/${file}`,
          `--- a/${file}`,
          `+++ b/${file}`,
          "@@ -1 +1 @@",
          `-${before}`,
          `+${after}`,
          "",
        ].join("\n"),
      );
    const engine = module.openDurableWorkflowEngine({
      consumerRoot: fixture.consumerRoot,
      stateRoot: fixture.stateRoot,
      deliverySource: {
        load: async (input: { deliveryRevision?: number }) => {
          const revision = input.deliveryRevision ?? 1;
          return {
            version: 2 as const,
            gate: "gate-b" as const,
            revision,
            receiptHash: (revision === 1 ? "a" : "b").repeat(64),
            plan: revision === 1 ? plan1 : plan2,
          };
        },
      },
      routePolicy: policy(),
      proposeCandidate: async (input: Record<string, unknown>) => {
        (input.onHeaders as () => void)();
        (input.onProgress as () => void)();
        const taskId = String(input.taskId);
        const repair = input.repair as { attempt: number } | undefined;
        proposals.push(`${taskId}:${repair ? "repair" : String(input.phase)}`);
        if (taskId === "package-loader-task") {
          return {
            kind: "candidate" as const,
            bytes: repair
              ? patchFile("value.txt", "green", "fixed")
              : input.phase === "red"
                ? patchFile("value.txt", "base", "red")
                : patchFile("value.txt", "red", "green"),
          };
        }
        return {
          kind: "candidate" as const,
          bytes:
            input.phase === "red"
              ? patchFile("other.txt", "other-base", "other-red")
              : patchFile("other.txt", "other-red", "other-green"),
        };
      },
      verifyPhase: async (input: Record<string, unknown>) =>
        verifiedPhase(String(input.phase)),
      verifyChange: async (input: Record<string, unknown>) => {
        if (
          input.scope === "task-affected" &&
          input.taskId === "package-loader-task" &&
          readFileSync(path.join(String(input.root), "value.txt"), "utf8") ===
            "green\n"
        ) {
          return {
            ok: false as const,
            kind: "verification" as const,
            code: "verification-rejected",
            failureIdentities: ["c".repeat(64)],
          };
        }
        if (input.scope === "change-full-suite" && fullSuiteFails) {
          return {
            ok: false as const,
            kind: "verification" as const,
            code: "verification-rejected",
            failureIdentities: ["d".repeat(64)],
          };
        }
        return {
          ok: true as const,
          exitCode: 0 as const,
          classification: "expected-green",
          failureIdentities: [],
        };
      },
    });

    await expect(
      engine.execute({
        command: "start",
        stage: "abel-implement",
        change: fixture.change,
        operationId: "repair-revalidation-start",
      }),
    ).resolves.toMatchObject({
      state: "paused",
      pause: { code: "verification-attribution-unresolved" },
    });
    fullSuiteFails = false;
    await expect(
      engine.execute({
        command: "resume",
        stage: "abel-implement",
        change: fixture.change,
        operationId: "repair-revalidation-resume",
        deliveryRevision: 2,
        receiptHash: "b".repeat(64),
      }),
    ).resolves.toMatchObject({ state: "completed", completed: true });
    expect(
      proposals.filter((entry) => entry.startsWith("package-loader-task:")),
    ).toEqual([
      "package-loader-task:red",
      "package-loader-task:green",
      "package-loader-task:repair",
    ]);
    expect(
      proposals.filter((entry) => entry.startsWith("secondary-task:")),
    ).toEqual([
      "secondary-task:red",
      "secondary-task:green",
      "secondary-task:red",
      "secondary-task:green",
    ]);
    expect(
      readFileSync(path.join(fixture.consumerRoot, "value.txt"), "utf8"),
    ).toBe("fixed\n");
    expect(
      readFileSync(path.join(fixture.consumerRoot, "other.txt"), "utf8"),
    ).toBe("other-green\n");
    expect(readFileSync(fixture.tasksPath, "utf8")).toContain(
      "- [x] package-loader-task",
    );
    expect(readFileSync(fixture.tasksPath, "utf8")).toContain(
      "- [x] secondary-task",
    );
    await engine.close();
  });
});
