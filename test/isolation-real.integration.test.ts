import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { compileCandidatePatch } from "../src/candidate-patch.ts";
import type { StructuredVerificationContract } from "../src/contracts.ts";
import { BubblewrapIsolationBackend } from "../src/isolation-backend.ts";
import {
  changeVerificationResult,
  executePackageVerification,
  phaseVerificationResult,
} from "../src/package-verification.ts";
import { parseRoutePolicy } from "../src/route-policy.ts";
import { resolveStateRoot } from "../src/state-root.ts";
import {
  bindDraftVerificationInputs,
  resolveVerificationRunner,
} from "../src/verification-capability.ts";
import { captureVerificationEnvironmentIdentity } from "../src/verification-environment.ts";
import { openDurableWorkflowEngine } from "../src/workflow-engine.ts";
import { verificationFixturePlan } from "./helpers/verification-plan.ts";

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function temporary() {
  const root = mkdtempSync(path.join(tmpdir(), "cadence-real-isolation-"));
  roots.push(root);
  return root;
}
const nodeRuntime = path.dirname(path.dirname(realpathSync(process.execPath)));
const nodeMount = { source: nodeRuntime, target: "/node-runtime" };
const sandboxNode = "/node-runtime/bin/node";
const enabled = process.env.CADENCE_REAL_ISOLATION === "1";

describe.skipIf(!enabled)("real Linux isolation contract", () => {
  beforeAll(async () => {
    expect(process.platform).toBe("linux");
    const backend = new BubblewrapIsolationBackend();
    expect(await backend.available()).toBe(true);
    expect(
      await backend.run({ root: temporary(), executable: "/bin/true" }),
    ).toMatchObject({ ok: true, exitCode: 0 });
  });

  it("resolves scoped workspace packages against candidate bytes", async () => {
    const owner = temporary();
    const root = temporary();
    mkdirSync(path.join(owner, "node_modules/@scope"), { recursive: true });
    mkdirSync(path.join(owner, "packages/lib"), { recursive: true });
    mkdirSync(path.join(root, "packages/lib"), { recursive: true });
    symlinkSync(
      "../../packages/lib",
      path.join(owner, "node_modules/@scope/lib"),
    );
    writeFileSync(
      path.join(owner, "packages/lib/index.js"),
      'module.exports="host";',
    );
    writeFileSync(
      path.join(root, "packages/lib/index.js"),
      'module.exports="candidate";',
    );
    writeFileSync(
      path.join(root, "check.cjs"),
      'require("node:assert/strict").equal(require("@scope/lib"), "candidate");',
    );
    expect(
      await executePackageVerification({
        root,
        dependencyOwner: owner,
        signal: new AbortController().signal,
        verification: {
          kind: "static-check",
          id: "workspace-link",
          runner: { kind: "node", script: "check.cjs" },
          args: [],
          classification: "expected-green",
        },
      }),
    ).toMatchObject({ kind: "accepted" });
  });

  it("hides host files and environment, denies host networking, and protects mounted dependencies", async () => {
    const root = temporary();
    const outside = temporary();
    const dependencies = temporary();
    writeFileSync(path.join(outside, "private.txt"), "private fixture\n");
    writeFileSync(
      path.join(dependencies, "dependency.txt"),
      "immutable dependency\n",
    );
    const server = createServer((socket) => socket.end("host access"));
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("fixture-server");
    writeFileSync(
      path.join(root, "probe.mjs"),
      `
      import assert from 'node:assert/strict';
      import { readFileSync, writeFileSync, existsSync } from 'node:fs';
      import { connect } from 'node:net';
      assert.equal(existsSync(${JSON.stringify(path.join(outside, "private.txt"))}), false);
      assert.equal(process.env.CADENCE_HOST_ONLY_FIXTURE, undefined);
      assert.equal(readFileSync('/dependencies/dependency.txt', 'utf8'), 'immutable dependency\\n');
      assert.throws(() => writeFileSync('/dependencies/dependency.txt', 'changed'));
      await new Promise((resolve, reject) => {
        const socket = connect({ host: '127.0.0.1', port: ${address.port} });
        socket.once('connect', () => { socket.destroy(); reject(new Error('host-network-access')); });
        socket.once('error', resolve);
        socket.setTimeout(1000, () => { socket.destroy(); resolve(); });
      });
    `,
    );
    const previous = process.env.CADENCE_HOST_ONLY_FIXTURE;
    process.env.CADENCE_HOST_ONLY_FIXTURE = "fixture";
    try {
      const result = await new BubblewrapIsolationBackend().run({
        root,
        executable: sandboxNode,
        args: ["probe.mjs"],
        mounts: [nodeMount, { source: dependencies, target: "/dependencies" }],
      });
      expect(result).toMatchObject({ ok: true, exitCode: 0 });
      expect(
        readFileSync(path.join(dependencies, "dependency.txt"), "utf8"),
      ).toBe("immutable dependency\n");
    } finally {
      if (previous === undefined) delete process.env.CADENCE_HOST_ONLY_FIXTURE;
      else process.env.CADENCE_HOST_ONLY_FIXTURE = previous;
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("kills sandbox descendants before a cancelled command settles", async () => {
    const root = temporary();
    writeFileSync(
      path.join(root, "descendant.mjs"),
      "import { appendFileSync } from 'node:fs'; setInterval(() => appendFileSync('heartbeat', 'x'), 10);\n",
    );
    writeFileSync(
      path.join(root, "parent.mjs"),
      "import { spawn } from 'node:child_process'; spawn(process.execPath, ['descendant.mjs'], { detached: true, stdio: 'ignore' }).unref(); setInterval(() => {}, 1000);\n",
    );
    const controller = new AbortController();
    const execution = new BubblewrapIsolationBackend({
      terminateGraceMs: 50,
    }).run({
      root,
      executable: sandboxNode,
      args: ["parent.mjs"],
      mounts: [nodeMount],
      signal: controller.signal,
    });
    await expect
      .poll(() => {
        try {
          return readFileSync(path.join(root, "heartbeat"), "utf8").length;
        } catch {
          return 0;
        }
      })
      .toBeGreaterThan(0);
    controller.abort();
    expect(await execution).toEqual({
      ok: false,
      state: "cancelled",
      code: "cancelled",
    });
    const stopped = readFileSync(path.join(root, "heartbeat"), "utf8");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(readFileSync(path.join(root, "heartbeat"), "utf8")).toBe(stopped);
  });

  it.each(["isolated", "local-trusted"])(
    "executes Red, storage reopen, Green, cumulative verification and apply in %s mode",
    async (mode) => {
      vi.stubEnv("ABEL_EXECUTION_MODE", mode);
      const root = temporary();
      const consumerRoot = path.join(root, "consumer");
      mkdirSync(consumerRoot);
      mkdirSync(path.join(consumerRoot, "test"));
      writeFileSync(
        path.join(consumerRoot, "package.json"),
        '{"type":"module"}\n',
      );
      writeFileSync(path.join(consumerRoot, "value.txt"), "0\n");
      writeFileSync(
        path.join(consumerRoot, "test/regression.mjs"),
        "export {};\n",
      );
      writeFileSync(
        path.join(consumerRoot, "test/health.mjs"),
        "import {readFileSync} from 'node:fs'; if (!/^[01]\\n$/.test(readFileSync('value.txt','utf8'))) process.exit(1);\n",
      );
      const change = "real-isolation";
      const tasksPath = path.join(
        consumerRoot,
        "openspec/changes",
        change,
        "tasks.md",
      );
      mkdirSync(path.dirname(tasksPath), { recursive: true });
      writeFileSync(tasksPath, "# Tasks\n\n- [ ] real-task\n");
      execFileSync("git", ["init", "-q"], { cwd: consumerRoot });
      execFileSync("git", ["add", "."], { cwd: consumerRoot });
      const { plan, check } = verificationFixturePlan(change);
      const roles = [
        "design-explorer",
        "implementation-worker",
        "diagnosis-worker",
      ];
      const routing = parseRoutePolicy({
        routes: {
          local: {
            kind: "inherited",
            capabilities: {
              roles,
              dialects: ["openai-responses"],
              contextWindow: 256_000,
              maxTokens: 128_000,
            },
          },
        },
        roles: Object.fromEntries(roles.map((role) => [role, ["local"]])),
      });
      if (!routing.ok) throw new Error("fixture-routing");
      const stateRoot = resolveStateRoot({
        consumerRoot,
        xdgStateHome: path.join(root, "state"),
      });
      const phases: string[] = [];
      const observations: string[] = [];
      let pauseGreen = true;
      const open = () =>
        openDurableWorkflowEngine({
          consumerRoot,
          stateRoot,
          routePolicy: routing.policy,
          verificationPolicy: pauseGreen ? undefined : "report-file-v3",
          verificationEnvironment: (current, signal) =>
            captureVerificationEnvironmentIdentity(
              consumerRoot,
              [current.verification.change.fullSuite],
              signal,
            ),
          deliverySource: {
            load: async () => ({
              gate: "gate-b",
              revision: 1,
              receiptHash: "a".repeat(64),
              plan,
            }),
          },
          proposeCandidate: async (input) => {
            input.onHeaders();
            input.onProgress();
            phases.push(input.phase);
            const relative =
              input.phase === "red" ? "test/regression.mjs" : "value.txt";
            const content =
              input.phase === "red"
                ? "import assert from 'node:assert/strict'; import {readFileSync} from 'node:fs'; assert.equal(readFileSync('value.txt','utf8'), '1\\n', 'real-regression');\n"
                : "1\n";
            return {
              kind: "candidate",
              bytes: Buffer.from(
                compileCandidatePatch({
                  root: input.workspaceRoot,
                  writePaths: input.task.phases[input.phase]!.write,
                  deletePaths: [],
                  operations: [{ kind: "rewrite", path: relative, content }],
                  maxBytes: 65536,
                }),
              ),
            };
          },
          verifyPhase: async (input) => {
            if (input.phase === "green" && pauseGreen)
              return { ok: false, kind: "paused", code: "fixture-reopen" };
            const result = await executePackageVerification({
              ...input,
              dependencyOwner: consumerRoot,
            });
            if (result.kind === "accepted") observations.push(input.phase);
            return phaseVerificationResult(result);
          },
          verifyChange: async (input) => {
            const verification =
              input.verification ??
              check("real-fallback", "test/regression.mjs");
            const result = await executePackageVerification({
              root: input.root,
              dependencyOwner: consumerRoot,
              verification,
              signal: input.signal,
            });
            const observed = changeVerificationResult(result);
            if (!observed.ok) return observed;
            observations.push(input.scope ?? "change");
            return { ok: true, exitCode: 0, classification: "expected-green" };
          },
        });
      let engine = open();
      try {
        const first = await engine.execute({
          command: "start",
          stage: "abel-implement",
          change,
          operationId: "real-start",
        });
        expect(first).toMatchObject({
          state: "paused",
          pause: { code: "fixture-reopen" },
        });
        expect(readFileSync(path.join(consumerRoot, "value.txt"), "utf8")).toBe(
          "0\n",
        );
        await engine.close();
        pauseGreen = false;
        mkdirSync(path.join(consumerRoot, "node_modules"), { recursive: true });
        writeFileSync(
          path.join(consumerRoot, "node_modules/environment-marker.mjs"),
          "export const revision = 2;\n",
        );
        engine = open();
        const finished = await engine.execute({
          command: "resume",
          stage: "abel-implement",
          change,
          operationId: "real-resume",
        });
        expect(finished).toMatchObject({ state: "completed", completed: true });
        expect(phases).toEqual(["red", "green"]);
        expect(observations.filter((phase) => phase === "red")).toHaveLength(2);
        expect(observations).toEqual(
          expect.arrayContaining(["red", "green", "post-apply"]),
        );
        expect(readFileSync(path.join(consumerRoot, "value.txt"), "utf8")).toBe(
          "1\n",
        );
        expect(readFileSync(tasksPath, "utf8")).toContain("- [x] real-task");
      } finally {
        await engine.close();
      }
    },
    60_000,
  );

  it("creates an absent Red regression and executes it through affected, cumulative, reopen, and post-apply isolation", async () => {
    vi.stubEnv("ABEL_EXECUTION_MODE", "isolated");
    const root = temporary();
    const consumerRoot = path.join(root, "consumer");
    mkdirSync(path.join(consumerRoot, "test"), { recursive: true });
    writeFileSync(
      path.join(consumerRoot, "package.json"),
      '{"type":"module"}\n',
    );
    writeFileSync(path.join(consumerRoot, "value.txt"), "0\n");
    writeFileSync(
      path.join(consumerRoot, "test/health.mjs"),
      "import assert from 'node:assert/strict'; import {existsSync,readFileSync} from 'node:fs'; assert.equal(readFileSync('value.txt','utf8'),'0\\n'); assert.equal(existsSync('test/regression.mjs'),false);\n",
    );
    const change = "real-absent-regression";
    const tasksPath = path.join(
      consumerRoot,
      "openspec/changes",
      change,
      "tasks.md",
    );
    mkdirSync(path.dirname(tasksPath), { recursive: true });
    writeFileSync(tasksPath, "# Tasks\n\n- [ ] real-task\n");
    execFileSync("git", ["init", "-q"], { cwd: consumerRoot });
    execFileSync("git", ["add", "."], { cwd: consumerRoot });
    expect(existsSync(path.join(consumerRoot, "test/regression.mjs"))).toBe(
      false,
    );
    expect(
      execFileSync("git", ["ls-files", "--", "test/regression.mjs"], {
        cwd: consumerRoot,
        encoding: "utf8",
      }),
    ).toBe("");

    const fixture = verificationFixturePlan(change);
    const plan = structuredClone(fixture.plan);
    const task = plan.tasks[0];
    if (!task) throw new Error("fixture-task-unavailable");
    task.phases.red.read = task.phases.red.read.filter(
      (relative) => relative !== "test/regression.mjs",
    );
    task.baselineVerification = fixture.check(
      "real-task-original-baseline",
      "test/health.mjs",
    );
    plan.verification.baseline.fullSuite = fixture.check(
      "real-full-original-baseline",
      "test/health.mjs",
    );
    const roles = [
      "design-explorer",
      "implementation-worker",
      "diagnosis-worker",
    ];
    const routing = parseRoutePolicy({
      routes: {
        local: {
          kind: "inherited",
          capabilities: {
            roles,
            dialects: ["openai-responses"],
            contextWindow: 256_000,
            maxTokens: 128_000,
          },
        },
      },
      roles: Object.fromEntries(roles.map((role) => [role, ["local"]])),
    });
    if (!routing.ok) throw new Error("fixture-routing");
    const stateRoot = resolveStateRoot({
      consumerRoot,
      xdgStateHome: path.join(root, "state"),
    });
    const proposals: string[] = [];
    const observations: Array<{ stage: string; script: string }> = [];
    let pauseGreen = true;
    const scriptFor = (verification: StructuredVerificationContract) => {
      if (
        verification.kind !== "static-check" ||
        verification.runner.kind !== "node"
      )
        throw new Error("fixture-verification-unexpected");
      return verification.runner.script;
    };
    const open = () =>
      openDurableWorkflowEngine({
        consumerRoot,
        stateRoot,
        routePolicy: routing.policy,
        verificationPolicy: pauseGreen ? undefined : "report-file-v3",
        verificationEnvironment: (current, signal) =>
          captureVerificationEnvironmentIdentity(
            consumerRoot,
            [
              current.tasks[0]!.baselineVerification!,
              current.verification.baseline.fullSuite,
              current.verification.change.fullSuite,
            ],
            signal,
          ),
        deliverySource: {
          load: async () => ({
            gate: "gate-b",
            revision: 1,
            receiptHash: "b".repeat(64),
            plan,
          }),
        },
        proposeCandidate: async (input) => {
          input.onHeaders();
          input.onProgress();
          proposals.push(input.phase);
          const relative =
            input.phase === "red" ? "test/regression.mjs" : "value.txt";
          const content =
            input.phase === "red"
              ? "import assert from 'node:assert/strict'; import {readFileSync} from 'node:fs'; assert.equal(readFileSync('value.txt','utf8'),'1\\n','real-regression-future-test');\n"
              : "1\n";
          return {
            kind: "candidate",
            bytes: Buffer.from(
              compileCandidatePatch({
                root: input.workspaceRoot,
                writePaths: input.task.phases[input.phase]!.write,
                deletePaths: [],
                operations:
                  input.phase === "red"
                    ? [
                        {
                          kind: "create",
                          path: relative,
                          content,
                          mode: "regular",
                        },
                      ]
                    : [{ kind: "rewrite", path: relative, content }],
                maxBytes: 65_536,
              }),
            ),
          };
        },
        verifyPhase: async (input) => {
          if (input.phase === "green" && pauseGreen)
            return { ok: false, kind: "paused", code: "fixture-reopen" };
          const result = await executePackageVerification({
            ...input,
            dependencyOwner: consumerRoot,
          });
          if (result.kind === "accepted") {
            observations.push({
              stage: `phase:${input.phase}`,
              script: scriptFor(input.verification),
            });
          }
          return phaseVerificationResult(result);
        },
        verifyChange: async (input) => {
          const verification =
            input.verification ??
            fixture.check("real-fallback", "test/regression.mjs");
          const result = await executePackageVerification({
            root: input.root,
            dependencyOwner: consumerRoot,
            verification,
            signal: input.signal,
          });
          const observed = changeVerificationResult(result);
          if (!observed.ok) return observed;
          observations.push({
            stage: input.scope ?? "change",
            script: scriptFor(verification),
          });
          return {
            ok: true,
            exitCode: 0,
            classification: "expected-green",
          };
        },
      });

    let engine = open();
    try {
      const first = await engine.execute({
        command: "start",
        stage: "abel-implement",
        change,
        operationId: "real-absent-start",
      });
      expect(first).toMatchObject({
        state: "paused",
        pause: { code: "fixture-reopen" },
        tasks: [{ taskId: "real-task", phase: "green" }],
      });
      expect(proposals).toEqual(["red", "green"]);
      expect(observations).toEqual(
        expect.arrayContaining([
          {
            stage: "baseline-task-affected",
            script: "test/health.mjs",
          },
          { stage: "phase:red", script: "test/regression.mjs" },
        ]),
      );
      expect(existsSync(path.join(consumerRoot, "test/regression.mjs"))).toBe(
        false,
      );
      await engine.close();

      pauseGreen = false;
      mkdirSync(path.join(consumerRoot, "node_modules"), {
        recursive: true,
      });
      writeFileSync(
        path.join(consumerRoot, "node_modules/environment-marker.mjs"),
        "export const revision = 2;\n",
      );
      engine = open();
      const finished = await engine.execute({
        command: "resume",
        stage: "abel-implement",
        change,
        operationId: "real-absent-resume",
      });
      expect(finished).toMatchObject({
        runId: first.runId,
        state: "completed",
        completed: true,
      });
      expect(proposals).toEqual(["red", "green"]);
      expect(observations).toEqual(
        expect.arrayContaining([
          {
            stage: "baseline-full-suite",
            script: "test/health.mjs",
          },
          { stage: "phase:green", script: "test/regression.mjs" },
          { stage: "task-affected", script: "test/regression.mjs" },
          {
            stage: "change-task-affected",
            script: "test/regression.mjs",
          },
          {
            stage: "change-full-suite",
            script: "test/regression.mjs",
          },
          { stage: "post-apply", script: "test/regression.mjs" },
        ]),
      );
      const requiredNewTestOrder = [
        "phase:red",
        "phase:green",
        "task-affected",
        "change-task-affected",
        "change-full-suite",
        "post-apply",
      ];
      const executedNewTestStages = observations
        .filter(({ script }) => script === "test/regression.mjs")
        .map(({ stage }) => stage);
      const firstPositions = requiredNewTestOrder.map((stage) =>
        executedNewTestStages.indexOf(stage),
      );
      expect(firstPositions.every((position) => position >= 0)).toBe(true);
      expect(firstPositions).toEqual(
        [...firstPositions].sort((left, right) => left - right),
      );
      expect(
        readFileSync(path.join(consumerRoot, "test/regression.mjs"), "utf8"),
      ).toContain("real-regression-future-test");
      expect(readFileSync(path.join(consumerRoot, "value.txt"), "utf8")).toBe(
        "1\n",
      );
      expect(readFileSync(tasksPath, "utf8")).toContain("- [x] real-task");
    } finally {
      await engine.close();
    }
  }, 60_000);

  it("preserves npm hooks, nested scripts and short circuiting while protecting host dependencies", async () => {
    const root = temporary();
    const dependencyOwner = temporary();
    mkdirSync(path.join(dependencyOwner, "node_modules/protected"), {
      recursive: true,
    });
    const sentinel = path.join(dependencyOwner, "node_modules/protected/value");
    writeFileSync(sentinel, "immutable");
    const scripts = {
      preverify: "node audit.cjs pre",
      verify: "node audit.cjs first && npm run nested && node audit.cjs last",
      nested: "node audit.cjs nested",
      postverify: "node audit.cjs post",
      broken:
        'node audit.cjs before && node -e "process.exit(1)" && node audit.cjs forbidden',
    };
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts }));
    writeFileSync(
      path.join(root, "audit.cjs"),
      String.raw`
      const fs = require('node:fs');
      const assert = require('node:assert/strict');
      assert.equal(process.env.HOME, '/cadence/home');
      assert.throws(() => fs.writeFileSync('node_modules/protected/value', 'changed'), {code: 'EROFS'});
      fs.writeFileSync('node_modules/.vite/probe', 'private');
      fs.writeFileSync('node_modules/.vite-temp/probe', 'private');
      fs.appendFileSync('order.txt', process.argv[2] + '\n');
    `,
    );
    const run = (script: "verify" | "broken") =>
      executePackageVerification({
        root,
        dependencyOwner,
        signal: new AbortController().signal,
        verification: {
          kind: "package-script",
          id: script,
          packageManager: "npm",
          script,
          command: scripts[script],
          args: [],
          classification: "expected-green",
        },
      });
    expect(await run("verify")).toMatchObject({ kind: "accepted" });
    expect(readFileSync(path.join(root, "order.txt"), "utf8")).toBe(
      "pre\nfirst\nnested\nlast\npost\n",
    );
    expect(await run("broken")).toMatchObject({ kind: "rejected" });
    expect(readFileSync(path.join(root, "order.txt"), "utf8")).toBe(
      "pre\nfirst\nnested\nlast\npost\nbefore\n",
    );
    expect(readFileSync(sentinel, "utf8")).toBe("immutable");
    expect(readdirSync(path.join(dependencyOwner, "node_modules"))).toEqual([
      "protected",
    ]);
  }, 30_000);

  it.each(["bun test", "node before.mjs && bun test", "npm run nested"])(
    "executes approved npm script %s with a private Bun runtime",
    async (command) => {
      const root = temporary();
      const runtime = path.join(temporary(), ".bun/bin");
      mkdirSync(runtime, { recursive: true });
      const bun = resolveVerificationRunner("bun");
      if (!bun) throw new Error("Bun fixture unavailable");
      cpSync(realpathSync(bun.executablePath), path.join(runtime, "bun"));
      vi.stubEnv(
        "PATH",
        `${runtime}${path.delimiter}${process.env.PATH ?? ""}`,
      );
      try {
        writeFileSync(
          path.join(root, "package.json"),
          JSON.stringify({ scripts: { test: command, nested: "bun test" } }),
        );
        writeFileSync(path.join(root, "before.mjs"), "export {};\n");
        writeFileSync(
          path.join(root, "sample.test.js"),
          "import {test,expect} from 'bun:test'; test('runtime available',()=>expect(process.execPath.startsWith('/cadence-runners/')).toBe(true));\n",
        );
        const result = await executePackageVerification({
          root,
          dependencyOwner: root,
          signal: new AbortController().signal,
          verification: {
            kind: "package-script",
            id: "npm-bun-script",
            packageManager: "npm",
            script: "test",
            command,
            args: [],
            classification: "expected-green",
          },
        });
        expect(result, JSON.stringify(result)).toMatchObject({
          kind: "accepted",
          evidence: { exitCode: 0 },
        });
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );

  it("executes an authorized manifest candidate while refusing unapproved drift", async () => {
    const root = temporary();
    const manifest = {
      description: "before",
      scripts: { check: "node check.mjs" },
    };
    writeFileSync(path.join(root, "package.json"), JSON.stringify(manifest));
    writeFileSync(
      path.join(root, "check.mjs"),
      "import {readFileSync} from 'node:fs'; if(JSON.parse(readFileSync('package.json','utf8')).description !== 'after') process.exitCode=1;",
    );
    const verification = bindDraftVerificationInputs(root, {
      kind: "package-script",
      id: "manifest-check",
      packageManager: "npm",
      script: "check",
      args: [],
      classification: "expected-green",
    }) as StructuredVerificationContract;
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ ...manifest, description: "after" }),
    );
    const input = {
      root,
      dependencyOwner: root,
      verification,
      signal: new AbortController().signal,
    };
    expect(await executePackageVerification(input)).toMatchObject({
      kind: "unavailable",
      code: "verification-config-mismatch",
    });
    expect(
      await executePackageVerification({
        ...input,
        executionWritePaths: ["package.json"],
      }),
    ).toMatchObject({ kind: "accepted" });
  });

  it("keeps a Red witness in large logs independent from displayed output", async () => {
    const root = temporary();
    writeFileSync(
      path.join(root, "red.mjs"),
      "process.stdout.write('x'.repeat(300000)+'REAL_RED_WITNESS'+'y'.repeat(300000)); process.exitCode=1;",
    );
    const verification = {
      kind: "static-check" as const,
      id: "large-red",
      runner: { kind: "node" as const, script: "red.mjs" },
      args: [],
      classification: "expected-red" as const,
      expectedFailure: "REAL_RED_WITNESS",
    };
    const run = () =>
      executePackageVerification({
        root,
        dependencyOwner: root,
        verification,
        signal: new AbortController().signal,
      });
    expect(await run()).toMatchObject({ kind: "accepted" });
    writeFileSync(
      path.join(root, "red.mjs"),
      "process.stdout.write('x'.repeat(600000)); process.exitCode=1;",
    );
    expect(await run()).toMatchObject({ kind: "rejected" });
  });

  it("runs real package managers and Vitest with private caches, config logs and large reports", async () => {
    const root = temporary();
    const dependencyOwner = path.resolve(import.meta.dirname, "..");
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ type: "module", scripts: { test: "vitest run" } }),
    );
    writeFileSync(
      path.join(root, "vitest.config.ts"),
      "console.log('config loaded'); export default {};\n",
    );
    writeFileSync(
      path.join(root, "sample.test.js"),
      "import {it,expect} from 'vitest'; for(let i=0;i<8000;i++)it('ordinary passing regression test '+i,()=>expect(1).toBe(1));\n",
    );
    for (const packageManager of process.env.CADENCE_ALL_PACKAGE_MANAGERS ===
    "1"
      ? (["npm", "bun", "pnpm", "yarn"] as const)
      : (["npm", "bun"] as const)) {
      const result = await executePackageVerification({
        root,
        dependencyOwner,
        verification: {
          kind: "vitest",
          id: "real-report",
          runner: {
            kind: "package-script",
            packageManager,
            script: "test",
            command: "vitest run",
          },
          testFiles: ["sample.test.js"],
          args: [],
          minTests: 8000,
          classification: "expected-green",
        },
        signal: new AbortController().signal,
      });
      expect(result, JSON.stringify(result)).toMatchObject({
        kind: "accepted",
        evidence: { exitCode: 0, tests: 8000 },
      });
    }
  }, 30_000);
});
