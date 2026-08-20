// P-006 Red (R-09.30): fixed-seed drain property tests against the CURRENT
// runtime. A drain must be a single idempotent step that closes admission,
// erases retained results and Worker metadata, and leaves the dispatcher
// inactive. The current runtime fails only by leaking active state
// (Activation steps to "draining" instead of "inactive" on one drain call);
// retained-result erasure, cancel, tool restoration, and worker identity are
// asserted to pin down exactly where the drain gap is.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { Activation, activateTool, deactivateTool } from "../src/activation";
import { snapshotFiles } from "../src/file-snapshot";
import { Runtime } from "../src/runtime";
import { contractOf, WorkerRegistry, workerIdentity } from "../src/worker";
import { PassthroughParentPayloadBridge } from "./helpers/passthrough-parent-payload-bridge.ts";

let parentProvider: typeof import("../src/parent-provider") | null = null;
try {
  parentProvider = await import("../src/parent-provider");
} catch {
  parentProvider = null;
}

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

const notReady = (name: string): never =>
  expect.fail(`not_ready: ${name} is not implemented`);

const DIFF = "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n";

function makeRoot(tag: string): string {
  const cwd = mkdtempSync(join(tmpdir(), `abel-drain-${tag}-`));
  roots.push(cwd);
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], {
    cwd,
  });
  execFileSync("git", ["config", "user.name", "Abel Drain"], { cwd });
  writeFileSync(join(cwd, "a.txt"), "old\n");
  mkdirSync(join(cwd, "node_modules"));
  mkdirSync(join(cwd, "test"));
  writeFileSync(
    join(cwd, "package.json"),
    `${JSON.stringify({
      private: true,
      scripts: { check: 'node -e ""', "test:target": "node" },
    })}\n`,
  );
  writeFileSync(join(cwd, "bun.lock"), "# fixture lock\n");
  writeFileSync(
    join(cwd, "test/expected-red.mjs"),
    'console.error("[DRAIN:expected-red]\\nTests 1 failed");\nprocess.exit(1);\n',
  );
  execFileSync("git", ["add", "a.txt"], { cwd });
  execFileSync("git", ["commit", "-qm", "base"], { cwd });
  return cwd;
}

const submitResponse = (submitted: unknown) =>
  fauxAssistantMessage(
    fauxToolCall("abel_submit_result", submitted as Record<string, any>),
    { stopReason: "toolUse" },
  );

function requestFor(id: string, phase: string, root: string) {
  return {
    stage: "abel-implement",
    role: "implementation-worker",
    taskId: id,
    id,
    phase,
    objective: "Change a.txt",
    roots: ["."],
    context: { agents: "none", contract: "approved" },
    declared: {
      read: ["a.txt"],
      write: ["a.txt"],
      conflicts: [],
      resources: [],
      verificationLock: "drain-red",
    },
    output: "diff",
    verification: {
      id: `verify-${id}`,
      argv: ["bun", "run", "test:target", "test/expected-red.mjs"],
      classification: "expected-red" as const,
      expectedFailure: "[DRAIN:expected-red]",
      minTests: 1,
    },
    snapshot: snapshotFiles(root, ["a.txt"]),
  };
}

function diffSubmit(id: string, phase: string) {
  return {
    id,
    role: "implementation-worker",
    kind: "diff",
    taskId: id,
    phase,
    summary: "change a.txt",
    diff: DIFF,
    expectedVerification: "cat a.txt",
    risks: [],
    nextStep: "apply",
    contractCompliant: true,
  };
}

async function modelFixture(tag: string) {
  if (!parentProvider) return notReady("parent-provider");
  const faux = fauxProvider({ provider: `abel-drain-${tag}`, api: "faux" });
  const modelRuntime = await parentProvider.runtimeForProvider(faux.provider);
  return { faux, modelRuntime };
}

async function makeActive(tag: string) {
  const cwd = makeRoot(tag);
  const { faux, modelRuntime } = await modelFixture(tag);
  const activation = new Activation();
  activation.request();
  activation.activate();
  const runtime = new Runtime({
    activation,
    parentPayloadBridge: new PassthroughParentPayloadBridge(),
  });
  return {
    cwd,
    faux,
    runtime,
    context: {
      cwd,
      model: faux.getModel(),
      modelRegistry: new ModelRegistry(modelRuntime),
    } as const,
  };
}

describe("drain property: single idempotent step closes admission", () => {
  it("one active drain lands inactive instead of leaking a half state", () => {
    const activation = new Activation();
    activation.request();
    activation.activate();
    expect(activation.isActive()).toBe(true);
    activation.drain();
    expect(activation.state).toBe("inactive");
    expect(activation.isActive()).toBe(false);
  });

  it("a drained runtime rejects new runs as not ready", async () => {
    const fixture = await makeActive("no-admission");
    fixture.runtime.drain();
    const blocked = await (fixture.runtime as any).execute(
      "run",
      { request: requestFor("drain-quiescent", "red", fixture.cwd) },
      fixture.context,
    );
    expect(blocked.ok).toBe(false);
    expect(blocked.notReady).toBe(true);
  });
});

describe("drain property: finish erases results and worker", () => {
  it("finish clears the retained diff and pinned worker", async () => {
    const fixture = await makeActive("erase");
    fixture.faux.setResponses([
      submitResponse(diffSubmit("drain-erase", "red")),
    ]);
    const run = await (fixture.runtime as any).execute(
      "run",
      { request: requestFor("drain-erase", "red", fixture.cwd) },
      fixture.context,
    );
    expect(run.ok).toBe(true);
    const resultId = run.resultId as string;
    expect((fixture.runtime as any).results.get(resultId)).toBeDefined();
    const finished = await (fixture.runtime as any).execute(
      "finish",
      {},
      fixture.context,
    );
    expect(finished.ok).toBe(true);
    expect(fixture.runtime.state).toBe("inactive");
    expect((fixture.runtime as any).results.get(resultId)).toBeUndefined();
    expect((fixture.runtime as any).results.size).toBe(0);
  });

  it("drain is idempotent and repeatable on an inactive runtime", () => {
    const runtime = new Runtime({
      parentPayloadBridge: new PassthroughParentPayloadBridge(),
    });
    runtime.drain();
    runtime.drain();
    expect(runtime.state).toBe("inactive");
  });
});

describe("drain property: cancel keeps the stage active", () => {
  it("cancel keeps retained results while active", async () => {
    const fixture = await makeActive("cancel");
    fixture.faux.setResponses([
      submitResponse(diffSubmit("drain-cancel", "red")),
    ]);
    const run = await (fixture.runtime as any).execute(
      "run",
      { request: requestFor("drain-cancel", "red", fixture.cwd) },
      fixture.context,
    );
    expect(run.ok).toBe(true);
    const resultId = run.resultId as string;
    const cancelled = await (fixture.runtime as any).execute(
      "cancel",
      {},
      fixture.context,
    );
    expect(cancelled.ok).toBe(true);
    expect(fixture.runtime.state).toBe("active");
    expect((fixture.runtime as any).results.get(resultId)).toBeDefined();
  });
});

describe("drain property: tool restoration keeps other tools", () => {
  it("deactivateTool removes only the dispatcher name", () => {
    const active = activateTool(["read", "grep"], "disp");
    const restored = deactivateTool(active, "disp");
    expect(restored).toEqual(["read", "grep"]);
  });
});

describe("drain property: worker identity is stable", () => {
  it("a worker is pinned by request id and erased on drain", () => {
    const registry = new WorkerRegistry();
    const contract = contractOf(
      requestFor("drain-identity", "red", process.cwd()),
    );
    const worker = registry.pin(contract, workerIdentity({ id: "model-a" }));
    expect(worker.state).toEqual({ kind: "ready" });
    expect(registry.has("drain-identity")).toBe(true);
    registry.clear();
    expect(registry.has("drain-identity")).toBe(false);
  });
});
