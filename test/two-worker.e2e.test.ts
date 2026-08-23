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
import { afterEach, describe, expect, it } from "vitest";
import { Activation } from "../src/activation";
import { snapshotFiles } from "../src/file-snapshot";
import { runtimeForProvider } from "../src/parent-provider";
import { Runtime } from "../src/runtime";
import { PassthroughParentPayloadBridge } from "./helpers/passthrough-parent-payload-bridge.ts";

const roots: string[] = [];
let providerSequence = 0;
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function makeGitRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "abel-e2e-"));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    writeFileSync(join(root, path), content);
  }
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
      'const identity = "[TWO-WORKER:expected-red]";',
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
    'console.error("[TWO-WORKER:expected-red]\\nTests 1 failed");\nprocess.exit(1);\n',
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

function modifyPatch(path: string, before: string, after: string): string {
  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1 +1 @@",
    `-${before}`,
    `+${after}`,
    "",
  ].join("\n");
}

function requestFor(
  id: string,
  read: string[],
  write: string[],
  snapshot: unknown,
) {
  return {
    stage: "abel-implement",
    kind: "open-task",
    boundary: {
      changeId: "two-worker-fixture",
      taskId: id,
      objective: `Complete ${id}`,
      roots: ["."],
      context: { agents: "root contract", contract: "approved" },
      phases: {
        red: {
          read,
          write,
          verificationLock: `e2e-${id}`,
          verification: {
            id: `verify-${id}-red`,
            argv: ["bun", "run", "test:target", "test/expected-red.mjs"],
            classification: "expected-red",
            expectedFailure: "[TWO-WORKER:expected-red]",
            minTests: 1,
          },
        },
        green: {
          read,
          write,
          verificationLock: `e2e-${id}`,
          verification: {
            id: `verify-${id}-green`,
            argv: ["bun", "run", "check"],
            classification: "expected-green",
            minTests: 1,
          },
        },
      },
      scheduling: { conflicts: [], resources: [] },
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
      changeId: "two-worker-fixture",
      taskId: id,
      requestId: id,
      phase: "red",
      snapshot,
    },
  };
}

async function runWorker(
  root: string,
  id: string,
  file: string,
  before: string,
  after: string,
) {
  const submitted = {
    id,
    role: "implementation-worker",
    kind: "diff",
    taskId: id,
    phase: "red",
    summary: `Complete ${id}`,
    diff: modifyPatch(file, before, after),
    expectedVerification: "fixed fixture verification",
    risks: [],
    contractCompliant: true,
  };
  const faux = fauxProvider({
    provider: `abel-e2e-${providerSequence++}`,
    api: "faux",
  });
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("abel_submit_result", submitted), {
      stopReason: "toolUse",
    }),
  ]);
  const modelRuntime = await runtimeForProvider(faux.provider);
  const context = {
    cwd: root,
    model: faux.getModel(),
    modelRegistry: new ModelRegistry(modelRuntime),
  };
  return { faux, context };
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

describe("two disjoint Workers converge", () => {
  it("[SLICE-4:task-lifetime-conflict] keeps concurrent disjoint candidates independently current through serial apply", async () => {
    const root = makeGitRoot({ a: "a0\n", b: "b0\n" });
    const runtime = activeRuntime();
    const left = await runWorker(root, "worker-a", "a", "a0", "a1");
    const right = await runWorker(root, "worker-b", "b", "b0", "b1");
    const [runA, runB] = await Promise.all([
      (runtime as any).execute(
        "run",
        {
          request: requestFor(
            "worker-a",
            ["a"],
            ["a"],
            snapshotFiles(root, ["a"]),
          ),
        },
        left.context,
      ),
      (runtime as any).execute(
        "run",
        {
          request: requestFor(
            "worker-b",
            ["b"],
            ["b"],
            snapshotFiles(root, ["b"]),
          ),
        },
        right.context,
      ),
    ]);
    expect(runA).toMatchObject({
      kind: "candidate",
      requestId: "worker-a",
      taskId: "worker-a",
      phase: "red",
    });
    expect(runB).toMatchObject({
      kind: "candidate",
      requestId: "worker-b",
      taskId: "worker-b",
      phase: "red",
    });
    expect(
      (runtime as any).registry.values().map((record: any) => record.state),
    ).toEqual([
      expect.objectContaining({ kind: "candidate-pending" }),
      expect.objectContaining({ kind: "candidate-pending" }),
    ]);
    expect((runtime as any).results.size).toBe(2);
    const applyA = await (runtime as any).execute(
      "apply",
      { resultId: runA.resultId, requestId: "worker-a:apply:red" },
      left.context,
    );
    expect(applyA).toMatchObject({
      kind: "applied",
      requestId: "worker-a:apply:red",
      taskId: "worker-a",
      phase: "red",
      readyPhase: "green",
    });
    expect(
      (runtime as any).registry.find(root, "worker-b").state,
    ).toMatchObject({ kind: "candidate-pending", resultId: runB.resultId });
    expect((runtime as any).results.size).toBe(1);
    const applyB = await (runtime as any).execute(
      "apply",
      { resultId: runB.resultId, requestId: "worker-b:apply:red" },
      right.context,
    );
    expect(applyB).toMatchObject({
      kind: "applied",
      requestId: "worker-b:apply:red",
      taskId: "worker-b",
      phase: "red",
      readyPhase: "green",
    });
    expect(readFileSync(join(root, "a"), "utf8")).toBe("a1\n");
    expect(readFileSync(join(root, "b"), "utf8")).toBe("b1\n");
    expect((runtime as any).results.size).toBe(0);
  });
});
