import { execFileSync } from "node:child_process";
import {
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
  mkdirSync(join(root, "node_modules"));
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({ private: true, scripts: { check: 'node -e ""' } })}\n`,
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
    role: "implementation-worker",
    taskId: id,
    id,
    phase: "green",
    objective: `Complete ${id}`,
    roots: ["."],
    context: { agents: "root contract", contract: "approved" },
    declared: {
      read,
      write,
      conflicts: [],
      resources: [],
      verificationLock: `e2e-${id}`,
    },
    output: "diff",
    snapshot,
    verification: {
      id: `verify-${id}`,
      argv: ["bun", "run", "check"],
      classification: "expected-green",
      minTests: 1,
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
    phase: "green",
    summary: `Complete ${id}`,
    diff: modifyPatch(file, before, after),
    expectedVerification: "fixed fixture verification",
    risks: [],
    nextStep: "parent review",
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
  it("runs two disjoint Workers, keeps both current, and applies both serially", async () => {
    const root = makeGitRoot({ a: "a0\n", b: "b0\n" });
    const runtime = activeRuntime();
    const left = await runWorker(root, "worker-a", "a", "a0", "a1");
    const right = await runWorker(root, "worker-b", "b", "b0", "b1");
    const runA = await (runtime as any).execute(
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
    );
    expect(runA.ok).toBe(true);
    const runB = await (runtime as any).execute(
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
    );
    expect(runB.ok).toBe(true);
    const applyA = await (runtime as any).execute(
      "apply",
      { resultId: runA.resultId },
      left.context,
    );
    expect(applyA.ok).toBe(true);
    const applyB = await (runtime as any).execute(
      "apply",
      { resultId: runB.resultId },
      right.context,
    );
    expect(applyB.ok).toBe(true);
    expect(readFileSync(join(root, "a"), "utf8")).toBe("a1\n");
    expect(readFileSync(join(root, "b"), "utf8")).toBe("b1\n");
    expect((runtime as any).results.size).toBe(0);
  });
});
