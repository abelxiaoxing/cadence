import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, vi } from "vitest";
import type { StructuredVerificationContract } from "../../src/contracts.ts";
import { verificationFixturePlan } from "./verification-plan.ts";

const runtime = (file: string) =>
  process.env.CADENCE_NATIVE_PACKAGE_ROOT
    ? pathToFileURL(
        path.join(process.env.CADENCE_NATIVE_PACKAGE_ROOT, "src", file),
      ).href
    : new URL(`../../src/${file}`, import.meta.url).href;
const { compileCandidatePatch } = (await import(
  runtime("candidate-patch.ts")
)) as typeof import("../../src/candidate-patch.ts");
const {
  changeVerificationResult,
  executePackageVerification,
  phaseVerificationResult,
} = (await import(
  runtime("package-verification.ts")
)) as typeof import("../../src/package-verification.ts");
const { parseRoutePolicy } = (await import(
  runtime("route-policy.ts")
)) as typeof import("../../src/route-policy.ts");
const { resolveStateRoot } = (await import(
  runtime("state-root.ts")
)) as typeof import("../../src/state-root.ts");
const { captureVerificationEnvironmentIdentity } = (await import(
  runtime("verification-environment.ts")
)) as typeof import("../../src/verification-environment.ts");
const { openDurableWorkflowEngine } = (await import(
  runtime("workflow-engine.ts")
)) as typeof import("../../src/workflow-engine.ts");

export async function exerciseNativeImplement(
  mode: "isolated" | "host-trusted",
  temporary: () => string,
) {
  vi.stubEnv("ABEL_EXECUTION_MODE", mode);
  const root = temporary();
  const consumerRoot = path.join(root, "consumer");
  mkdirSync(path.join(consumerRoot, "test"), { recursive: true });
  writeFileSync(path.join(consumerRoot, "package.json"), '{"type":"module"}\n');
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
  const failures: unknown[] = [];
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
      awaitPostApplySettlement: true,
      verificationPolicy: pauseGreen ? undefined : "report-file-v3",
      verificationEnvironment: (current, signal) =>
        captureVerificationEnvironmentIdentity(
          consumerRoot,
          [
            current.tasks[0]?.baselineVerification ??
              current.verification.baseline.fullSuite,
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
              writePaths: input.task.phases[input.phase]?.write ?? [],
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
          executionOwnerRoot: stateRoot.rootDir,
        });
        if (result.kind !== "accepted") failures.push(result);
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
          executionOwnerRoot: stateRoot.rootDir,
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
    expect(
      finished,
      JSON.stringify({ pause: finished.pause, failures }),
    ).toMatchObject({
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
}
