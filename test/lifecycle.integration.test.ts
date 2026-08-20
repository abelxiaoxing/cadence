// P-006 Red (R-09.30): pi lifecycle integration surface. Covers stage cleanup
// restoring inactive state, session_shutdown finishing the stage, no private
// state created on disk after delegation, and unique child usage returned once.
// Failures are valid only at the lifecycle/drain boundary: leaked active state,
// retained result, mis-restored tools, or double-counted usage.

import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
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
import { Runtime } from "../src/runtime";
import { PassthroughParentPayloadBridge } from "./helpers/passthrough-parent-payload-bridge.ts";

let entrypoint: typeof import("../src/index") | null = null;
let parentProvider: typeof import("../src/parent-provider") | null = null;
try {
  entrypoint = await import("../src/index");
} catch {
  entrypoint = null;
}
try {
  parentProvider = await import("../src/parent-provider");
} catch {
  parentProvider = null;
}

class FakePi {
  tools: { name: string }[] = [];
  active: string[] = [];
  handlers: Record<string, ((...args: unknown[]) => unknown)[]> = {};
  registerTool(def: { name: string }) {
    this.tools.push(def);
  }
  on(event: string, handler: (...args: unknown[]) => unknown) {
    if (!this.handlers[event]) this.handlers[event] = [];
    this.handlers[event].push(handler);
  }
  async emit(event: string, ...args: unknown[]) {
    for (const h of this.handlers[event] ?? []) await h(...args, {});
  }
  getAllTools() {
    return this.tools.map((t) => ({ name: t.name }));
  }
  getActiveTools() {
    return [...this.active];
  }
  setActiveTools(names: string[]) {
    this.active = [...names];
  }
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
  const cwd = mkdtempSync(join(tmpdir(), `abel-lifecycle-${tag}-`));
  roots.push(cwd);
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], {
    cwd,
  });
  execFileSync("git", ["config", "user.name", "Abel Test"], { cwd });
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
    'console.error("[LIFECYCLE:expected-red]\\nTests 1 failed");\nprocess.exit(1);\n',
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
      verificationLock: "lifecycle-red",
    },
    output: "diff",
    verification: {
      id: `verify-${id}`,
      argv: ["bun", "run", "test:target", "test/expected-red.mjs"],
      classification: "expected-red",
      expectedFailure: "[LIFECYCLE:expected-red]",
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
  const faux = fauxProvider({ provider: `abel-lifecycle-${tag}`, api: "faux" });
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

describe("stage cleanup restores inactive state", () => {
  it("restores inactive state and clears retained state", async () => {
    const { cwd, faux, runtime, context } = await makeActive("stage-clean");
    faux.setResponses([submitResponse(diffSubmit("task-clean", "red"))]);
    const run = await (runtime as any).execute(
      "run",
      { request: requestFor("task-clean", "red", cwd) },
      context,
    );
    expect(run.ok).toBe(true);
    const resultId = run.resultId as string;
    expect((runtime as any).results.get(resultId)).toBeDefined();
    expect((runtime as any).registry.has("task-clean")).toBe(true);

    const finished = await (runtime as any).execute("finish", {}, context);
    expect(finished.ok).toBe(true);
    expect(runtime.state).toBe("inactive");
    expect((runtime as any).results.get(resultId)).toBeUndefined();
    expect((runtime as any).results.size).toBe(0);
    expect((runtime as any).registry.has("task-clean")).toBe(false);
  });
});

describe("pi lifecycle end (session_shutdown) finishes the stage", () => {
  it("removes only the dispatcher from the active tool set", async () => {
    if (!entrypoint) return notReady("entrypoint");
    const pi = new FakePi();
    entrypoint.default(pi as never);
    pi.active = ["read", "bash", "abel_dispatch"];
    await pi.emit("session_shutdown", { reason: "end" });
    expect(pi.getActiveTools()).toEqual(["read", "bash"]);
  });
});

describe("no private state filesystem after delegation", () => {
  it("leaves no private state on disk", async () => {
    const { cwd, faux, runtime, context } = await makeActive("fs-scope");
    faux.setResponses([submitResponse(diffSubmit("task-fs", "red"))]);
    const run = await (runtime as any).execute(
      "run",
      { request: requestFor("task-fs", "red", cwd) },
      context,
    );
    expect(run.ok).toBe(true);
    const entries = readdirSync(cwd);
    expect(entries).not.toContain(".abel");
    expect(entries).not.toContain("transcripts");
    expect(entries).not.toContain("credentials");
    expect(entries).not.toContain("sessions");
  });
});

describe("unique child usage is returned exactly once", () => {
  it("exposes the single child usage without double counting", async () => {
    const { faux, runtime, context } = await makeActive("usage-once");
    faux.setResponses([submitResponse(diffSubmit("task-usage", "red"))]);
    const run = await (runtime as any).execute(
      "run",
      { request: requestFor("task-usage", "red", context.cwd) },
      context,
    );
    expect(run.ok).toBe(true);
    expect(run.usage).toBeDefined();
    expect(run.usage).not.toBeInstanceOf(Array);
    expect(run.usage.totalTokens).toBeTypeOf("number");
  });
});
