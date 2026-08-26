import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Activation } from "../src/activation";
import { cloneVerificationContract } from "../src/contracts.ts";
import {
  mergeBounds,
  snapshotDirManifests,
  snapshotFiles,
} from "../src/file-snapshot";
import register, { DISPATCH_TOOL } from "../src/index";
import { runtimeForProvider } from "../src/parent-provider";
import { Runtime } from "../src/runtime";
import { workerIdentity } from "../src/worker";
import {
  admitGraph,
  type ImplementTaskFixture,
  taskAttemptFor,
} from "./helpers/implement-graph-fixture.ts";
import { PassthroughParentPayloadBridge } from "./helpers/passthrough-parent-payload-bridge.ts";

const roots: string[] = [];
let providerSequence = 0;

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "abel-runtime-scheduler-"));
  roots.push(root);
  writeFileSync(join(root, "a.txt"), "old\n");
  writeFileSync(join(root, "b.txt"), "old\n");
  mkdirSync(join(root, "node_modules/.bin"), { recursive: true });
  const fixtureReporter = join(root, "node_modules/.bin/vitest");
  writeFileSync(
    fixtureReporter,
    [
      "#!/usr/bin/env bun",
      'import { writeFileSync } from "node:fs";',
      "const args = process.argv.slice(2);",
      'const output = args.find((arg) => arg.startsWith("--outputFile="))?.slice(13);',
      'if (!output) throw new Error("missing structured report output");',
      'const identity = "[RUNTIME-SCHEDULER:expected-red]";',
      "writeFileSync(output, JSON.stringify({",
      "  numTotalTests: 1,",
      "  numFailedTests: 1,",
      "  success: false,",
      '  testResults: [{ message: "", assertionResults: [{',
      '    status: "failed",',
      "    fullName: identity,",
      "    title: identity,",
      "    failureMessages: [identity],",
      "  }] }],",
      "}));",
      "process.exit(1);",
      "",
    ].join("\n"),
  );
  chmodSync(fixtureReporter, 0o755);
  mkdirSync(join(root, "test"));
  writeFileSync(
    join(root, "test/expected-red.mjs"),
    'console.error("[RUNTIME-SCHEDULER:expected-red]\\nTests 1 failed");\nprocess.exit(1);\n',
  );
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({
      private: true,
      scripts: { check: 'node -e ""', "test:target": "vitest run" },
    })}\n`,
  );
  writeFileSync(join(root, "bun.lock"), "# fixture lock\n");
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], {
    cwd: root,
  });
  execFileSync("git", ["config", "user.name", "Abel Test"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: root });
  return root;
}

function activeRuntime(): Runtime {
  const activation = new Activation();
  activation.request();
  activation.activate();
  return new Runtime({
    activation,
    parentPayloadBridge: new PassthroughParentPayloadBridge(),
  });
}

function request(
  id: string,
  root: string,
  options: {
    path?: string;
    greenPath?: string;
    verificationLock?: string;
    greenVerificationLock?: string;
    conflicts?: string[];
    resources?: string[];
  } = {},
): ImplementTaskFixture {
  const target = options.path ?? "a.txt";
  const greenTarget = options.greenPath ?? target;
  const verificationLock = options.verificationLock ?? "runtime-scheduler";
  return {
    boundary: {
      changeId: "runtime-scheduler-fixture",
      taskId: id,
      dependsOn: [],
      objective: `Complete ${id}`,
      roots: ["."],
      context: { agents: "root contract", contract: "approved task" },
      phases: {
        red: {
          read: [target, "test/expected-red.mjs", "package.json"],
          write: [target],
          verificationLock,
          verification: {
            kind: "vitest",
            id: `verify-${id}-red`,
            runner: {
              kind: "package-script",
              packageManager: "bun",
              script: "test:target",
              command: "vitest run",
            },
            testFiles: ["test/expected-red.mjs"],
            args: [],
            classification: "expected-red",
            expectedFailure: "[RUNTIME-SCHEDULER:expected-red]",
            minTests: 1,
          },
          verificationInputs: [
            { kind: "workspace", path: "test/expected-red.mjs" },
            { kind: "workspace", path: "package.json" },
          ],
        },
        green: {
          read: [greenTarget, "package.json"],
          write: [greenTarget],
          verificationLock: options.greenVerificationLock ?? verificationLock,
          verification: {
            kind: "package-script",
            id: `verify-${id}-green`,
            packageManager: "bun",
            script: "check",
            command: 'node -e ""',
            args: [],
            classification: "expected-green",
          },
          verificationInputs: [{ kind: "workspace", path: "package.json" }],
        },
      },
      scheduling: {
        conflicts: options.conflicts ?? [],
        resources: options.resources ?? [],
      },
      agents: { impact: "none", managedOnly: true },
      approvedDependencies: [],
      impactClosure: {
        changedSurfaces: ["none"],
        searchEvidence: [],
        relatedTests: [],
        affectedSuite: [],
      },
    },
    attempt: {
      changeId: "runtime-scheduler-fixture",
      taskId: id,
      requestId: id,
      phase: "red",
      snapshot: snapshotFiles(root, [
        target,
        "test/expected-red.mjs",
        "package.json",
      ]),
    },
  };
}

function submitted(id: string, target = "a.txt") {
  return {
    id,
    role: "implementation-worker",
    kind: "diff",
    taskId: id,
    phase: "red",
    summary: `Complete ${id}`,
    diff: `--- a/${target}\n+++ b/${target}\n@@ -1 +1 @@\n-old\n+${id}\n`,
    expectedVerification: "fixed fixture verification",
    risks: [],
    contractCompliant: true,
  };
}

function response(id: string, target = "a.txt") {
  return fauxAssistantMessage(
    fauxToolCall("abel_submit_result", submitted(id, target)),
    { stopReason: "toolUse" },
  );
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("fixture wait timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function contextFor(root: string, faux: ReturnType<typeof fauxProvider>) {
  const modelRuntime = await runtimeForProvider(faux.provider);
  return {
    cwd: root,
    model: faux.getModel(),
    modelRegistry: new ModelRegistry(modelRuntime),
  };
}

function candidateResultId(
  outcome: Awaited<ReturnType<Runtime["execute"]>>,
): string {
  expect(outcome).toMatchObject({ kind: "candidate" });
  if (!("kind" in outcome) || outcome.kind !== "candidate") {
    throw new Error("run did not return an Implement candidate");
  }
  return outcome.resultId;
}

describe("Runtime Scheduler integration", () => {
  it("injects the authoritative phase identity and delivery contract into the Worker prompt", async () => {
    const root = makeRoot();
    const runtime = activeRuntime();
    const faux = fauxProvider({
      provider: `abel-runtime-prompt-${providerSequence++}`,
      api: "faux",
    });
    const taskId = "stable-task";
    const requestId = "stable-task:red:1";
    const phaseRequest: ImplementTaskFixture = {
      ...request(taskId, root),
      attempt: {
        ...request(taskId, root).attempt,
        requestId,
      },
    };
    let observedContext = "";
    faux.setResponses([
      (providerContext) => {
        observedContext =
          (providerContext as unknown as { systemPrompt?: string })
            .systemPrompt ?? "";
        return fauxAssistantMessage(
          fauxToolCall("abel_submit_result", {
            ...submitted(requestId),
            taskId,
          }),
          { stopReason: "toolUse" },
        );
      },
    ]);
    const context = await contextFor(root, faux);
    expect(await admitGraph(runtime, [phaseRequest], context)).toMatchObject({
      kind: "graph-admitted",
    });

    const outcome = await runtime.execute(
      "run",
      { request: taskAttemptFor(phaseRequest) },
      context,
    );
    await runtime.execute("finish", {}, context);

    expect(outcome).toMatchObject({
      kind: "candidate",
      taskId,
      requestId,
      phase: "red",
    });
    expect(observedContext).toContain(
      `<phase-contract>${JSON.stringify({
        taskId,
        requestId,
        phase: "red",
        readSet: ["a.txt", "test/expected-red.mjs", "package.json"],
        writeSet: ["a.txt"],
        verification: cloneVerificationContract(
          phaseRequest.boundary.phases.red.verification as never,
        ),
        agentsImpact: "none",
        agentsTarget: null,
        agentsManagedOnly: true,
        agentsWriteAllowed: false,
        impactClosure: {
          changedSurfaces: ["none"],
          searchEvidence: [],
          relatedTests: [],
          affectedSuite: [],
        },
      })}</phase-contract>`,
    );
  });

  it("reconstructs a declared directory from the Worker's complete observed snapshot", async () => {
    const root = makeRoot();
    mkdirSync(join(root, "fixtures"));
    writeFileSync(join(root, "fixtures/observed.txt"), "head\n");
    writeFileSync(join(root, "fixtures/removed.txt"), "remove\n");
    execFileSync("git", ["add", "fixtures"], { cwd: root });
    execFileSync("git", ["commit", "-qm", "directory baseline"], {
      cwd: root,
    });
    writeFileSync(join(root, "fixtures/observed.txt"), "worker\n");
    rmSync(join(root, "fixtures/removed.txt"));
    writeFileSync(join(root, "fixtures/untracked.txt"), "untracked\n");
    const check = [
      "const f=require('node:fs')",
      "if(f.readFileSync('fixtures/observed.txt','utf8')!=='worker\\n')process.exit(1)",
      "if(f.existsSync('fixtures/removed.txt'))process.exit(1)",
      "if(f.readFileSync('fixtures/untracked.txt','utf8')!=='untracked\\n')process.exit(1)",
    ].join(";");
    mkdirSync(join(root, "scripts"));
    writeFileSync(join(root, "scripts/check-directory.cjs"), `${check};\n`);
    writeFileSync(
      join(root, "package.json"),
      `${JSON.stringify({
        private: true,
        scripts: {
          check: "node scripts/check-directory.cjs",
          "test:target": "vitest run",
        },
      })}\n`,
    );
    const runtime = activeRuntime();
    const faux = fauxProvider({
      provider: `abel-runtime-directory-${providerSequence++}`,
      api: "faux",
    });
    faux.setResponses([response("directory-baseline")]);
    const context = await contextFor(root, faux);
    const phaseRequest: ImplementTaskFixture = {
      ...request("directory-baseline", root),
      boundary: {
        ...request("directory-baseline", root).boundary,
        phases: {
          ...request("directory-baseline", root).boundary.phases,
          green: {
            ...request("directory-baseline", root).boundary.phases.green,
            verification: {
              kind: "package-script",
              id: "verify-directory-baseline-green",
              packageManager: "bun",
              script: "check",
              command: "node scripts/check-directory.cjs",
              args: [],
              classification: "expected-green",
            },
          },
          red: {
            ...request("directory-baseline", root).boundary.phases.red,
            read: [
              "fixtures",
              "scripts/check-directory.cjs",
              "test/expected-red.mjs",
              "package.json",
            ],
            verification: {
              kind: "steps",
              id: "directory-baseline-red-steps",
              classification: "expected-red",
              steps: [
                {
                  kind: "static-check",
                  id: "directory-baseline-static",
                  runner: {
                    kind: "node",
                    script: "scripts/check-directory.cjs",
                  },
                  args: [],
                  classification: "expected-green",
                },
                {
                  kind: "vitest",
                  id: "directory-baseline-red",
                  runner: {
                    kind: "package-script",
                    packageManager: "bun",
                    script: "test:target",
                    command: "vitest run",
                  },
                  testFiles: ["test/expected-red.mjs"],
                  args: [],
                  classification: "expected-red",
                  expectedFailure: "[RUNTIME-SCHEDULER:expected-red]",
                  minTests: 1,
                },
              ],
            },
            verificationInputs: [
              { kind: "workspace", path: "scripts/check-directory.cjs" },
              { kind: "workspace", path: "test/expected-red.mjs" },
              { kind: "workspace", path: "package.json" },
            ],
          },
        },
      },
      attempt: {
        ...request("directory-baseline", root).attempt,
        snapshot: mergeBounds(
          snapshotDirManifests(root, ["fixtures"]),
          snapshotFiles(root, [
            "a.txt",
            "scripts/check-directory.cjs",
            "test/expected-red.mjs",
            "package.json",
          ]),
        ),
      },
    };
    const admission = await admitGraph(runtime, [phaseRequest], context);
    expect(admission).toMatchObject({
      kind: "graph-admitted",
    });

    const outcome = await runtime.execute(
      "run",
      { request: taskAttemptFor(phaseRequest) },
      context,
    );
    const resultId = candidateResultId(outcome);
    const applied = await runtime.execute(
      "apply",
      {
        resultId,
        requestId: "directory-baseline:apply",
      },
      context,
    );
    await runtime.execute("finish", {}, context);

    expect(applied).toMatchObject({
      kind: "applied",
      requestId: "directory-baseline:apply",
      taskId: "directory-baseline",
      phase: "red",
      readyPhase: "green",
    });
    expect(readFileSync(join(root, "a.txt"), "utf8")).toBe(
      "directory-baseline\n",
    );
  });

  it("closes an unreadable local verification executable before Red", async () => {
    const root = makeRoot();
    const runtime = activeRuntime();
    const faux = fauxProvider({
      provider: `abel-runtime-preflight-error-${providerSequence++}`,
      api: "faux",
    });
    faux.setResponses([
      response("preflight-error"),
      response("preflight-error"),
    ]);
    const context = await contextFor(root, faux);
    const phaseRequest = request("preflight-error", root);
    chmodSync(join(root, "node_modules"), 0o000);

    try {
      const first = await admitGraph(runtime, [phaseRequest], context);
      expect(first).toMatchObject({
        kind: "graph-rejected",
        diagnostics: [
          {
            kind: "verification-adapter",
            code: "local-executable-missing",
          },
        ],
      });
      expect(JSON.stringify(first)).not.toMatch(
        /EACCES|node_modules|abel-runtime-scheduler-/i,
      );
      expect(faux.state.callCount).toBe(0);
    } finally {
      chmodSync(join(root, "node_modules"), 0o755);
      await runtime.execute("finish", {}, context);
    }
  });

  it("forwards the Pi tool signal into Runtime execution", async () => {
    const execute = vi.spyOn(Runtime.prototype, "execute").mockResolvedValue({
      kind: "cancelled",
      taskId: "signal-task",
      requestId: "signal-request",
      phase: "red",
    });
    let tool:
      | {
          name: string;
          execute: (...args: any[]) => Promise<unknown>;
        }
      | undefined;
    const pi = {
      registerTool(definition: typeof tool) {
        tool = definition;
      },
      on() {},
      getActiveTools: () => [],
      setActiveTools() {},
    };
    register(pi as never);
    const controller = new AbortController();
    const context = {};

    try {
      expect(tool?.name).toBe(DISPATCH_TOOL);
      await tool?.execute(
        "call-1",
        { action: "run", request: {} },
        controller.signal,
        undefined,
        context,
      );
      expect(execute).toHaveBeenCalledWith(
        "run",
        { request: {} },
        context,
        controller.signal,
      );
    } finally {
      execute.mockRestore();
    }
  });

  it("exposes a blocked Implement outcome directly in provider-visible content", async () => {
    const blocked = {
      kind: "blocked",
      taskId: "task-recovery-content",
      requestId: "task-recovery-content:green:0",
      phase: "green",
      failure: {
        kind: "approval-boundary",
        code: "task-scope-insufficient",
      },
    } as const;
    const execute = vi
      .spyOn(Runtime.prototype, "execute")
      .mockResolvedValue(blocked);
    let tool:
      | {
          name: string;
          execute: (...args: any[]) => Promise<unknown>;
        }
      | undefined;
    const pi = {
      registerTool(definition: typeof tool) {
        tool = definition;
      },
      on() {},
      getActiveTools: () => [],
      setActiveTools() {},
    };

    try {
      register(pi as never);
      expect(tool?.name).toBe(DISPATCH_TOOL);
      const rendered = await tool?.execute(
        "recovery-call",
        { action: "run", request: {} },
        undefined,
        undefined,
        {},
      );
      expect(rendered).not.toHaveProperty("isError");
      const content = (
        rendered as {
          content?: Array<{ type: string; text?: string }>;
        }
      ).content;
      expect(content?.[0]?.type).toBe("text");
      const providerPayload = JSON.parse(content?.[0]?.text ?? "");
      expect(providerPayload).toEqual(blocked);
    } finally {
      execute.mockRestore();
    }
  });

  it("[SLICE-4:task-lifetime-conflict] immediately defers a conflict across the ready next-phase gap without side effects", async () => {
    const root = makeRoot();
    const runtime = activeRuntime();
    const faux = fauxProvider({
      provider: `abel-runtime-ready-conflict-${providerSequence++}`,
      api: "faux",
    });
    faux.setResponses([response("ready-owner"), response("ready-contender")]);
    const context = await contextFor(root, faux);
    const ownerRequest = request("ready-owner", root);
    const contenderRequest = request("ready-contender", root);
    await admitGraph(runtime, [ownerRequest, contenderRequest], context);
    const owner = await runtime.execute(
      "run",
      { request: taskAttemptFor(ownerRequest) },
      context,
    );
    const ownerResultId = candidateResultId(owner);
    const applied = await runtime.execute(
      "apply",
      { resultId: ownerResultId, requestId: "ready-owner:apply" },
      context,
    );
    expect(applied).toMatchObject({
      kind: "applied",
      requestId: "ready-owner:apply",
      taskId: "ready-owner",
      readyPhase: "green",
    });

    const registry = (runtime as any).registry;
    const scheduler = (runtime as any).scheduler;
    expect(registry.values()[0]?.state).toEqual({
      kind: "ready",
      phase: "green",
      launchIndex: 0,
    });
    const recordsBefore = registry.values().length;
    const resultsBefore = runtime.results.size;
    const launchesBefore = faux.state.callCount;
    const open = vi.spyOn(registry, "open");
    const schedule = vi.spyOn(scheduler, "schedule");
    const contenderId = contenderRequest.boundary.taskId;
    const contender = runtime.execute(
      "run",
      { request: taskAttemptFor(contenderRequest) },
      context,
    );
    const timeout = Symbol("deferred task waited");

    try {
      const outcome = await Promise.race([
        contender,
        new Promise<typeof timeout>((resolve) =>
          setTimeout(() => resolve(timeout), 100),
        ),
      ]);

      expect(outcome).not.toBe(timeout);
      expect(outcome).toMatchObject({
        kind: "deferred",
        taskId: contenderId,
        requestId: contenderId,
        reason: "task-conflict",
      });
      expect(open).not.toHaveBeenCalled();
      expect(schedule).not.toHaveBeenCalled();
      expect(faux.state.callCount).toBe(launchesBefore);
      expect(runtime.results.size).toBe(resultsBefore);
      expect(registry.values()).toHaveLength(recordsBefore);
      expect(
        registry
          .values()
          .some(
            (record: { boundary: { taskId: string } }) =>
              record.boundary.taskId === contenderId,
          ),
      ).toBe(false);
    } finally {
      open.mockRestore();
      schedule.mockRestore();
      await runtime.execute("finish", {}, context);
    }
  });

  it("[SLICE-4:task-lifetime-conflict] keeps candidate-pending conflict active without registering, scheduling, or launching the contender", async () => {
    const root = makeRoot();
    const runtime = activeRuntime();
    const faux = fauxProvider({
      provider: `abel-runtime-candidate-conflict-${providerSequence++}`,
      api: "faux",
    });
    faux.setResponses([
      response("candidate-owner"),
      response("candidate-contender"),
    ]);
    const context = await contextFor(root, faux);
    const ownerRequest = request("candidate-owner", root);
    const contenderRequest = request("candidate-contender", root);
    await admitGraph(runtime, [ownerRequest, contenderRequest], context);
    const owner = await runtime.execute(
      "run",
      { request: taskAttemptFor(ownerRequest) },
      context,
    );
    const ownerResultId = candidateResultId(owner);

    const registry = (runtime as any).registry;
    const scheduler = (runtime as any).scheduler;
    expect(registry.values()[0]?.state).toMatchObject({
      kind: "candidate-pending",
      phase: "red",
      originRequestId: "candidate-owner",
      resultId: ownerResultId,
    });
    const recordsBefore = registry.values().length;
    const resultsBefore = runtime.results.size;
    const launchesBefore = faux.state.callCount;
    const open = vi.spyOn(registry, "open");
    const schedule = vi.spyOn(scheduler, "schedule");
    const contenderId = contenderRequest.boundary.taskId;
    const contender = runtime.execute(
      "run",
      { request: taskAttemptFor(contenderRequest) },
      context,
    );
    const timeout = Symbol("deferred task waited");

    try {
      const outcome = await Promise.race([
        contender,
        new Promise<typeof timeout>((resolve) =>
          setTimeout(() => resolve(timeout), 100),
        ),
      ]);

      expect(outcome).not.toBe(timeout);
      expect(outcome).toMatchObject({
        kind: "deferred",
        taskId: contenderId,
        requestId: contenderId,
        reason: "task-conflict",
      });
      expect(open).not.toHaveBeenCalled();
      expect(schedule).not.toHaveBeenCalled();
      expect(faux.state.callCount).toBe(launchesBefore);
      expect(runtime.results.size).toBe(resultsBefore);
      expect(registry.values()).toHaveLength(recordsBefore);
    } finally {
      open.mockRestore();
      schedule.mockRestore();
      await runtime.execute("finish", {}, context);
    }
  });

  it.each(["edge", "resource", "later-verification-lock"] as const)(
    "[SLICE-4:task-lifetime-conflict] derives a task-lifetime %s conflict before admission",
    async (source) => {
      const root = makeRoot();
      const runtime = activeRuntime();
      const faux = fauxProvider({
        provider: `abel-runtime-${source}-conflict-${providerSequence++}`,
        api: "faux",
      });
      const ownerId = `${source}-owner`;
      const contenderId = `${source}-contender`;
      const sharedResource = source === "resource" ? [source] : [];
      const sharedLaterLock =
        source === "later-verification-lock" ? source : undefined;
      faux.setResponses([response(ownerId)]);
      const context = await contextFor(root, faux);
      const ownerRequest = request(ownerId, root, {
        verificationLock: `${ownerId}-red`,
        greenVerificationLock: sharedLaterLock ?? `${ownerId}-green`,
        conflicts: source === "edge" ? [contenderId] : [],
        resources: sharedResource,
      });
      const contenderRequest = request(contenderId, root, {
        path: "b.txt",
        verificationLock: `${contenderId}-red`,
        greenVerificationLock: sharedLaterLock ?? `${contenderId}-green`,
        resources: sharedResource,
      });
      await admitGraph(runtime, [ownerRequest, contenderRequest], context);
      const owner = await runtime.execute(
        "run",
        { request: taskAttemptFor(ownerRequest) },
        context,
      );
      expect(owner).toMatchObject({ kind: "candidate", taskId: ownerId });

      const registry = (runtime as any).registry;
      const scheduler = (runtime as any).scheduler;
      const recordsBefore = registry.values().length;
      const sequenceBefore = (runtime as any).batchSeq;
      const open = vi.spyOn(registry, "open");
      const schedule = vi.spyOn(scheduler, "schedule");

      try {
        const deferred = await runtime.execute(
          "run",
          { request: taskAttemptFor(contenderRequest) },
          context,
        );

        expect(deferred).toMatchObject({
          kind: "deferred",
          taskId: contenderId,
          requestId: contenderId,
          reason: "task-conflict",
        });
        expect(open).not.toHaveBeenCalled();
        expect(schedule).not.toHaveBeenCalled();
        expect(faux.state.callCount).toBe(1);
        expect(registry.values()).toHaveLength(recordsBefore);
        expect((runtime as any).batchSeq).toBe(sequenceBefore);
      } finally {
        open.mockRestore();
        schedule.mockRestore();
        await runtime.execute("finish", {}, context);
      }
    },
  );

  it.each([
    [
      "blocked",
      {
        kind: "blocked",
        phase: "red",
        failure: {
          kind: "approval-boundary",
          code: "task-scope-insufficient",
        },
      },
    ],
    ["completed", { kind: "completed", finalPhase: "green" }],
  ] as const)(
    "[SLICE-4:task-lifetime-conflict] releases a %s task conflict and admits a later open",
    async (terminalKind, terminalState) => {
      const root = makeRoot();
      const runtime = activeRuntime();
      const faux = fauxProvider({
        provider: `abel-runtime-${terminalKind}-release-${providerSequence++}`,
        api: "faux",
      });
      const context = await contextFor(root, faux);
      const registry = (runtime as any).registry;
      const ownerRequest = request(`${terminalKind}-owner`, root);
      const owner = registry.open(
        ownerRequest.boundary,
        "terminal-fixture",
        root,
        ownerRequest.attempt,
      );
      owner.state = structuredClone(terminalState);
      const contenderId = `${terminalKind}-contender`;
      const contenderRequest = request(contenderId, root);
      await admitGraph(runtime, [ownerRequest, contenderRequest], context);
      faux.setResponses([response(contenderId)]);

      try {
        const outcome = await runtime.execute(
          "run",
          { request: taskAttemptFor(contenderRequest) },
          context,
        );

        expect(outcome).toMatchObject({
          kind: "candidate",
          taskId: contenderId,
          requestId: contenderId,
          phase: "red",
          result: { kind: "diff", taskId: contenderId },
        });
        expect(faux.state.callCount).toBe(1);
        expect(registry.values()).toHaveLength(2);
        expect(
          registry
            .values()
            .find(
              (record: { boundary: { taskId: string } }) =>
                record.boundary.taskId === contenderId,
            )?.state.kind,
        ).toBe("candidate-pending");
      } finally {
        await runtime.execute("finish", {}, context);
      }
    },
  );

  it("admits compatible Runtime runs through the Scheduler", async () => {
    const root = makeRoot();
    const runtime = activeRuntime();
    const faux = fauxProvider({
      provider: `abel-runtime-scheduler-${providerSequence++}`,
      api: "faux",
    });
    const first = deferred<ReturnType<typeof fauxAssistantMessage>>();
    const second = deferred<ReturnType<typeof fauxAssistantMessage>>();
    const starts: string[] = [];
    faux.setResponses([
      async () => {
        starts.push("left");
        return first.promise;
      },
      async () => {
        starts.push("right");
        return second.promise;
      },
    ]);
    const context = await contextFor(root, faux);
    const leftRequest = request("left", root);
    const rightRequest = request("right", root, {
      path: "b.txt",
      verificationLock: "runtime-scheduler-right",
    });
    await admitGraph(runtime, [leftRequest, rightRequest], context);

    const left = runtime.execute(
      "run",
      { request: taskAttemptFor(leftRequest) },
      context,
    );
    await waitFor(() => starts.length === 1);
    const right = runtime.execute(
      "run",
      { request: taskAttemptFor(rightRequest) },
      context,
    );
    await waitFor(() => starts.length === 2);
    const startsBeforeFirstSettled = [...starts];

    first.resolve(response("left"));
    second.resolve(response("right", "b.txt"));
    const outcomes = await Promise.all([left, right]);
    await runtime.execute("finish", {}, context);

    expect(startsBeforeFirstSettled).toEqual(["left", "right"]);
    expect(
      outcomes.map((outcome) => ("kind" in outcome ? outcome.kind : null)),
    ).toEqual(["candidate", "candidate"]);
  });

  it("binds a same-task candidate before launching a queued phase attempt", async () => {
    const root = makeRoot();
    const runtime = activeRuntime();
    const faux = fauxProvider({
      provider: `abel-runtime-same-task-${providerSequence++}`,
      api: "faux",
    });
    const context = await contextFor(root, faux);
    const taskId = "same-task-race";
    const admitted = request(taskId, root);
    await admitGraph(runtime, [admitted], context);
    const registry = (runtime as any).registry;
    registry.open(
      admitted.boundary,
      workerIdentity(context.model),
      root,
      admitted.attempt,
    );
    const phaseAttempt = (requestId: string) => ({
      stage: "abel-implement" as const,
      kind: "task-attempt" as const,
      attempt: { ...admitted.attempt, requestId },
    });
    const firstRequestId = `${taskId}:red:first`;
    const secondRequestId = `${taskId}:red:second`;
    const firstResponse = deferred<ReturnType<typeof fauxAssistantMessage>>();
    let firstStarted = false;
    faux.setResponses([
      async () => {
        firstStarted = true;
        return firstResponse.promise;
      },
      fauxAssistantMessage(
        fauxToolCall("abel_submit_result", {
          ...submitted(secondRequestId),
          taskId,
        }),
        { stopReason: "toolUse" },
      ),
    ]);

    const first = runtime.execute(
      "run",
      { request: phaseAttempt(firstRequestId) },
      context,
    );
    await waitFor(() => firstStarted);
    const second = runtime.execute(
      "run",
      { request: phaseAttempt(secondRequestId) },
      context,
    );
    const secondRejected = expect(second).rejects.toThrow(
      /candidate|pending|launchable/i,
    );
    firstResponse.resolve(
      fauxAssistantMessage(
        fauxToolCall("abel_submit_result", {
          ...submitted(firstRequestId),
          taskId,
        }),
        { stopReason: "toolUse" },
      ),
    );

    const firstOutcome = await first;
    const resultId = candidateResultId(firstOutcome);
    await secondRejected;

    expect(faux.state.callCount).toBe(1);
    expect(runtime.results.size).toBe(1);
    expect(runtime.results.get(resultId)).toMatchObject({
      taskId,
      originRequestId: firstRequestId,
    });
    await runtime.execute("finish", {}, context);
  });

  it("rolls back a candidate cancelled after binding and preserves the phase budget", async () => {
    const root = makeRoot();
    const runtime = activeRuntime();
    const faux = fauxProvider({
      provider: `abel-runtime-bind-cancel-${providerSequence++}`,
      api: "faux",
    });
    const context = await contextFor(root, faux);
    const taskId = "candidate-bind-cancel";
    const admitted = request(taskId, root);
    await admitGraph(runtime, [admitted], context);
    const registry = (runtime as any).registry;
    const worker = registry.open(
      admitted.boundary,
      workerIdentity(context.model),
      root,
      admitted.attempt,
    );
    const readyState = {
      kind: "ready" as const,
      phase: "red" as const,
      launchIndex: 1 as const,
      correction: {
        kind: "artifact" as const,
        code: "red-not-witnessed" as const,
        stage: "phase-runtime" as const,
      },
    };
    worker.state = structuredClone(readyState);
    const phaseAttempt = (requestId: string) => ({
      stage: "abel-implement" as const,
      kind: "task-attempt" as const,
      attempt: { ...admitted.attempt, requestId },
    });
    const firstRequestId = `${taskId}:red:cancelled`;
    const retryRequestId = `${taskId}:red:retry`;
    const taskResponse = (requestId: string) =>
      fauxAssistantMessage(
        fauxToolCall("abel_submit_result", {
          ...submitted(requestId),
          taskId,
        }),
        { stopReason: "toolUse" },
      );
    faux.setResponses([
      taskResponse(firstRequestId),
      taskResponse(retryRequestId),
    ]);
    const controller = new AbortController();
    const originalRemember = (runtime as any).rememberRetainedResult.bind(
      runtime,
    );
    vi.spyOn(runtime as any, "rememberRetainedResult").mockImplementationOnce(
      (...args: unknown[]) => {
        originalRemember(...args);
        controller.abort(new Error("cancel after candidate binding"));
      },
    );

    const cancelled = await (runtime.execute as any)(
      "run",
      { request: phaseAttempt(firstRequestId) },
      context,
      controller.signal,
    );

    expect(cancelled).toMatchObject({
      kind: "cancelled",
      taskId,
      requestId: firstRequestId,
      phase: "red",
      usage: { totalTokens: expect.any(Number) },
    });
    expect(runtime.results.size).toBe(0);
    expect(worker.state).toEqual(readyState);

    const retried = await (runtime.execute as any)(
      "run",
      { request: phaseAttempt(retryRequestId) },
      context,
    );
    const resultId = candidateResultId(retried);
    expect(runtime.results.get(resultId)).toMatchObject({
      taskId,
      originRequestId: retryRequestId,
      launchIndex: 1,
    });
    expect(faux.state.callCount).toBe(2);
    await runtime.execute("finish", {}, context);
  });

  it("preserves a consumed transport launch when the second launch is cancelled", async () => {
    const root = makeRoot();
    const runtime = activeRuntime();
    const faux = fauxProvider({
      provider: `abel-runtime-transport-cancel-${providerSequence++}`,
      api: "faux",
    });
    const context = await contextFor(root, faux);
    const taskId = "transport-then-cancel";
    const admitted = request(taskId, root);
    await admitGraph(runtime, [admitted], context);
    const worker = (runtime as any).registry.open(
      admitted.boundary,
      workerIdentity(context.model),
      root,
      admitted.attempt,
    );
    const phaseAttempt = (requestId: string) => ({
      stage: "abel-implement" as const,
      kind: "task-attempt" as const,
      attempt: { ...admitted.attempt, requestId },
    });
    const secondStarted = deferred<void>();
    const transportFailure = {
      ok: false as const,
      error: "sanitized transport failure",
      failure: {
        kind: "transport" as const,
        code: "transport-failure" as const,
        stage: "child-provider-stream" as const,
      },
      failureKind: "failed" as const,
      failureClass: "transport" as const,
    };
    const dispatch = vi
      .spyOn(runtime as any, "dispatchChild")
      .mockResolvedValueOnce(transportFailure)
      .mockImplementationOnce(async (...args: unknown[]) => {
        const signal = args[3] as AbortSignal;
        secondStarted.resolve();
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
        return {
          ok: false,
          error: "cancelled",
          failure: { kind: "cancelled", code: "cancelled" },
          failureKind: "cancelled",
        };
      })
      .mockResolvedValueOnce(transportFailure);
    const controller = new AbortController();
    const requestId = `${taskId}:red:cancelled`;
    const running = (runtime.execute as any)(
      "run",
      { request: phaseAttempt(requestId) },
      context,
      controller.signal,
    );
    await secondStarted.promise;

    controller.abort(new Error("cancel second transport launch"));
    const cancelled = await running;

    expect(cancelled).toMatchObject({
      kind: "cancelled",
      taskId,
      requestId,
      phase: "red",
    });
    expect(worker.state).toEqual({
      kind: "ready",
      phase: "red",
      launchIndex: 1,
    });

    const stopped = await (runtime.execute as any)(
      "run",
      { request: phaseAttempt(`${taskId}:red:retry`) },
      context,
    );
    expect(stopped).toMatchObject({
      kind: "blocked",
      taskId,
      phase: "red",
      failure: { kind: "attempts-exhausted", cause: "transport" },
    });
    expect(dispatch).toHaveBeenCalledTimes(3);
    await runtime.execute("finish", {}, context);
  });

  it("cancel aborts active work without launching a deferred conflict", async () => {
    const root = makeRoot();
    const runtime = activeRuntime();
    const faux = fauxProvider({
      provider: `abel-runtime-cancel-${providerSequence++}`,
      api: "faux",
    });
    const pending = deferred<ReturnType<typeof fauxAssistantMessage>>();
    const aborted = deferred<void>();
    let childStarted = false;
    let childAborted = false;
    faux.setResponses([
      (_context, options) => {
        childStarted = true;
        options?.signal?.addEventListener(
          "abort",
          () => {
            childAborted = true;
            aborted.resolve();
            pending.reject(new Error("provider observed cancellation"));
          },
          { once: true },
        );
        return pending.promise;
      },
    ]);
    const context = await contextFor(root, faux);
    const runningRequest = request("cancelled-child", root);
    const queuedRequest = request("queued-child", root);
    await admitGraph(runtime, [runningRequest, queuedRequest], context);

    const run = runtime.execute(
      "run",
      { request: taskAttemptFor(runningRequest) },
      context,
    );
    await waitFor(() => childStarted);
    const queued = runtime.execute(
      "run",
      { request: taskAttemptFor(queuedRequest) },
      context,
    );
    const cancelPromise = runtime.execute("cancel", {}, context);
    await Promise.race([
      aborted.promise,
      new Promise((resolve) => setTimeout(resolve, 100)),
    ]);
    const cancellationReachedChild = childAborted;
    if (!childAborted) pending.resolve(response("cancelled-child"));
    const cancel = await cancelPromise;
    const [outcome, queuedOutcome] = await Promise.all([run, queued]);
    const retainedBeforeFinish = runtime.results.size;
    await runtime.execute("finish", {}, context);

    expect(cancel).toEqual({ ok: true, action: "cancel" });
    expect(cancellationReachedChild).toBe(true);
    expect(outcome).toMatchObject({
      kind: "cancelled",
      taskId: "cancelled-child",
      requestId: "cancelled-child",
      phase: "red",
    });
    expect(queuedOutcome).toMatchObject({
      kind: "deferred",
      taskId: "queued-child",
      requestId: "queued-child",
      reason: "task-conflict",
    });
    expect(faux.state.callCount).toBe(1);
    expect(retainedBeforeFinish).toBe(0);
  });

  it("does not admit a run whose tool signal is already aborted", async () => {
    const root = makeRoot();
    const runtime = activeRuntime();
    const faux = fauxProvider({
      provider: `abel-runtime-pre-cancel-${providerSequence++}`,
      api: "faux",
    });
    faux.setResponses([response("never-started")]);
    const context = await contextFor(root, faux);
    const cancelledRequest = request("never-started", root);
    await admitGraph(runtime, [cancelledRequest], context);
    const controller = new AbortController();
    controller.abort(new Error("tool call cancelled"));

    const outcome = await (runtime.execute as any)(
      "run",
      { request: taskAttemptFor(cancelledRequest) },
      context,
      controller.signal,
    );
    await runtime.execute("finish", {}, context);

    expect(outcome).toMatchObject({
      kind: "cancelled",
      taskId: "never-started",
      requestId: "never-started",
      phase: "red",
    });
    expect(faux.state.callCount).toBe(0);
  });

  it("tool cancellation settles only its own batch and preserves a compatible sibling", async () => {
    const root = makeRoot();
    const runtime = activeRuntime();
    const faux = fauxProvider({
      provider: `abel-runtime-tool-cancel-${providerSequence++}`,
      api: "faux",
    });
    const pending = deferred<ReturnType<typeof fauxAssistantMessage>>();
    let firstStarted = false;
    faux.setResponses([
      (_context, options) => {
        firstStarted = true;
        options?.signal?.addEventListener(
          "abort",
          () => pending.reject(new Error("provider observed cancellation")),
          { once: true },
        );
        return pending.promise;
      },
      response("surviving-sibling", "b.txt"),
    ]);
    const context = await contextFor(root, faux);
    const cancelledRequest = request("tool-cancelled", root);
    const siblingRequest = request("surviving-sibling", root, {
      path: "b.txt",
      verificationLock: "runtime-tool-cancel-sibling",
    });
    await admitGraph(runtime, [cancelledRequest, siblingRequest], context);
    const controller = new AbortController();
    const cancelled = (runtime.execute as any)(
      "run",
      { request: taskAttemptFor(cancelledRequest) },
      context,
      controller.signal,
    );
    await waitFor(() => firstStarted);
    const sibling = runtime.execute(
      "run",
      { request: taskAttemptFor(siblingRequest) },
      context,
    );

    controller.abort(new Error("tool call cancelled"));
    const timeout = Symbol("timeout");
    const raced = await Promise.race([
      Promise.all([cancelled, sibling]),
      new Promise<typeof timeout>((resolve) =>
        setTimeout(() => resolve(timeout), 500),
      ),
    ]);
    if (raced === timeout) {
      pending.resolve(response("tool-cancelled"));
      await Promise.all([cancelled, sibling]);
    }
    const retainedBeforeFinish = runtime.results.size;
    await runtime.execute("finish", {}, context);

    expect(raced).not.toBe(timeout);
    if (raced === timeout) return;
    expect(raced[0]).toMatchObject({
      kind: "cancelled",
      taskId: "tool-cancelled",
      requestId: "tool-cancelled",
      phase: "red",
    });
    expect(raced[0]).not.toHaveProperty("resultId");
    expect(raced[1]).toMatchObject({
      kind: "candidate",
      taskId: "surviving-sibling",
      requestId: "surviving-sibling",
      phase: "red",
    });
    expect(retainedBeforeFinish).toBe(1);
    expect(faux.state.callCount).toBe(2);
  });

  it("settles tool cancellation while phase auth is still pending", async () => {
    const root = makeRoot();
    const runtime = activeRuntime();
    const faux = fauxProvider({
      provider: `abel-runtime-auth-cancel-${providerSequence++}`,
      api: "faux",
    });
    faux.setResponses([response("auth-window")]);
    const auth = deferred<{
      ok: true;
      apiKey: string;
      headers: Record<string, string>;
    }>();
    let authStarted = false;
    const context = {
      cwd: root,
      model: faux.getModel(),
      modelRegistry: {
        getProvider: () => faux.provider,
        getApiKeyAndHeaders: () => {
          authStarted = true;
          return auth.promise;
        },
      },
    };
    const authRequest = request("auth-window", root);
    await admitGraph(runtime, [authRequest], context as any);
    const controller = new AbortController();
    const run = (runtime.execute as any)(
      "run",
      { request: taskAttemptFor(authRequest) },
      context,
      controller.signal,
    );
    await waitFor(() => authStarted);

    controller.abort(new Error("tool call cancelled during auth"));
    const timeout = Symbol("timeout");
    const raced = await Promise.race([
      run,
      new Promise<typeof timeout>((resolve) =>
        setTimeout(() => resolve(timeout), 500),
      ),
    ]);
    auth.resolve({ ok: true, apiKey: "test", headers: {} });
    if (raced === timeout) await run;
    await runtime.execute("finish", {}, context as any);

    expect(raced).not.toBe(timeout);
    if (raced === timeout) return;
    expect(raced).toMatchObject({
      kind: "cancelled",
      taskId: "auth-window",
      requestId: "auth-window",
      phase: "red",
    });
    expect(faux.state.callCount).toBe(0);
  });
});
