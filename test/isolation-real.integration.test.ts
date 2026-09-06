import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { compileCandidatePatch } from "../src/candidate-patch.ts";
import { BubblewrapIsolationBackend } from "../src/isolation-backend.ts";
import { executePackageVerification } from "../src/package-verification.ts";
import { parseRoutePolicy } from "../src/route-policy.ts";
import { resolveStateRoot } from "../src/state-root.ts";
import { openDurableWorkflowEngine } from "../src/workflow-engine.ts";
import { verificationFixturePlan } from "./helpers/verification-plan.ts";

const roots: string[] = [];
afterEach(() => {
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

  it("executes Red, resumes after durable storage reopen, then Green, cumulative verification and final apply", async () => {
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
          if (input.phase === "green" && pauseGreen)
            return { kind: "paused", code: "fixture-reopen" };
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
          const result = await executePackageVerification({
            ...input,
            dependencyOwner: consumerRoot,
          });
          if (result.ok) observations.push(input.phase);
          return result;
        },
        verifyChange: async (input) => {
          const verification =
            input.verification ?? check("real-fallback", "test/regression.mjs");
          const result = await executePackageVerification({
            root: input.root,
            dependencyOwner: consumerRoot,
            verification,
            signal: input.signal,
          });
          if (!result.ok)
            return {
              ok: false,
              kind: "verification",
              code: result.code,
              failureIdentities: [result.code],
            };
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
      engine = open();
      const finished = await engine.execute({
        command: "resume",
        stage: "abel-implement",
        change,
        operationId: "real-resume",
      });
      expect(finished).toMatchObject({ state: "completed", completed: true });
      expect(phases).toEqual(["red", "green"]);
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
  }, 60_000);
});
