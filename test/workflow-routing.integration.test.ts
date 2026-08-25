// P-005 Red (R-09.26): workflow routing integration surface. Exercises eligible
// stage activation, Init inactivity, five-action routing (run/apply/discard/
// cancel/finish), file snapshots, parent-only authority, and cancellation
// against the CURRENT product. Failures are valid only at the routing surface.

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
import { snapshotFiles } from "../src/file-snapshot";
import { Runtime } from "../src/runtime";
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
  const cwd = mkdtempSync(join(tmpdir(), `abel-wr-${tag}-`));
  roots.push(cwd);
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], {
    cwd,
  });
  execFileSync("git", ["config", "user.name", "Abel Test"], { cwd });
  writeFileSync(join(cwd, "a.txt"), "old\n");
  mkdirSync(join(cwd, "node_modules/.bin"), { recursive: true });
  const fixtureReporter = join(cwd, "node_modules/.bin/vitest");
  writeFileSync(
    fixtureReporter,
    [
      "#!/usr/bin/env bun",
      'import { writeFileSync } from "node:fs";',
      "const args = process.argv.slice(2);",
      'const output = args.find((arg) => arg.startsWith("--outputFile="))?.slice(13);',
      'if (!output) throw new Error("missing structured report output");',
      'const identity = "[WORKFLOW-ROUTING:expected-red]";',
      "writeFileSync(output, JSON.stringify({",
      "  numTotalTests: 1, numFailedTests: 1, success: false,",
      '  testResults: [{ message: "", assertionResults: [{',
      '    status: "failed", fullName: identity, title: identity,',
      "    failureMessages: [identity],",
      "  }] }],",
      "}));",
      "process.exit(1);",
      "",
    ].join("\n"),
  );
  chmodSync(fixtureReporter, 0o755);
  mkdirSync(join(cwd, "test"));
  writeFileSync(
    join(cwd, "package.json"),
    `${JSON.stringify({
      private: true,
      scripts: { check: 'node -e ""', "test:target": "vitest run" },
    })}\n`,
  );
  writeFileSync(join(cwd, "bun.lock"), "# fixture lock\n");
  writeFileSync(
    join(cwd, "test/expected-red.mjs"),
    "// fixture expected Red\n",
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

function requestFor(
  id: string,
  phase: string,
  root: string,
  snapshot?: unknown,
) {
  const paths = ["a.txt"];
  const target = ["bun", "run", "test:target", "test/expected-red.mjs"];
  return {
    stage: "abel-implement",
    kind: "open-task",
    boundary: {
      changeId: `workflow-routing-${id}`,
      taskId: id,
      objective: "Change a.txt",
      roots: ["."],
      context: { agents: "none", contract: "approved" },
      phases: {
        red: {
          read: paths,
          write: paths,
          verification: {
            id: `verify-${id}-red`,
            argv: target,
            classification: "expected-red",
            expectedFailure: "[WORKFLOW-ROUTING:expected-red]",
            minTests: 1,
          },
          verificationLock: "workflow-routing-red",
        },
        green: {
          read: paths,
          write: paths,
          verification: {
            id: `verify-${id}-green`,
            argv: target,
            classification: "expected-green",
            minTests: 1,
          },
          verificationLock: "workflow-routing-red",
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
      changeId: `workflow-routing-${id}`,
      taskId: id,
      requestId: id,
      phase,
      snapshot: snapshot ?? snapshotFiles(root, paths),
    },
  };
}

function nonImplementRequest(stage: "abel-design" | "abel-diagnose") {
  const design = stage === "abel-design";
  return {
    stage,
    role: design ? "design-explorer" : "diagnosis-worker",
    id: `${stage}-packet`,
    phase: design ? "evidence" : "red",
    objective: design
      ? "Inspect the bounded fixture"
      : "Diagnose the bounded fixture",
    roots: ["."],
    context: { agents: "none", contract: "approved" },
    declared: {
      read: ["a.txt"],
      write: design ? [] : ["a.txt"],
      conflicts: [],
      resources: [],
    },
    output: design ? "evidence" : "diff",
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
    contractCompliant: true,
  };
}

async function modelFixture(tag: string) {
  if (!parentProvider) return notReady("parent-provider");
  const faux = fauxProvider({ provider: `abel-wr-${tag}`, api: "faux" });
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

describe("eligible activation gates dispatch", () => {
  it("stays inactive by default and rejects run until an eligible stage verifies", async () => {
    const cwd = makeRoot("inactive");
    const { faux, modelRuntime } = await modelFixture("inactive");
    const context = {
      cwd,
      model: faux.getModel(),
      modelRegistry: new ModelRegistry(modelRuntime),
    };
    const runtime = new Runtime({
      parentPayloadBridge: new PassthroughParentPayloadBridge(),
    });
    const blocked = await (runtime as any).execute(
      "run",
      { request: requestFor("task-inactive", "red", cwd) },
      context,
    );
    expect(blocked.ok).toBe(false);
    expect(blocked.notReady).toBe(true);

    // Verifying through the activated runtime then accepts the same request.
    const { faux: faux2, modelRuntime: rt2 } = await modelFixture("verify");
    faux2.setResponses([submitResponse(diffSubmit("task-inactive", "red"))]);
    const act = new Activation();
    act.request();
    act.activate();
    const active = new Runtime({
      activation: act,
      parentPayloadBridge: new PassthroughParentPayloadBridge(),
    });
    const accepted = await (active as any).execute(
      "run",
      { request: requestFor("task-inactive", "red", cwd) },
      {
        cwd,
        model: faux2.getModel(),
        modelRegistry: new ModelRegistry(rt2),
      },
    );
    expect(accepted).toMatchObject({
      kind: "candidate",
      taskId: "task-inactive",
      requestId: "task-inactive",
      phase: "red",
      resultId: expect.any(String),
    });
  });
});

describe("[SLICE-1:boundary-once] non-Implement routing regression", () => {
  it("keeps Design and Diagnose run envelopes executable", async () => {
    const { runtime, context } = await makeActive("non-implement");
    const dispatch = vi
      .spyOn(runtime as any, "dispatchChild")
      .mockResolvedValue({
        ok: true,
        action: "run",
        result: { kind: "evidence" },
      });

    const design = await (runtime as any).execute(
      "run",
      { request: nonImplementRequest("abel-design") },
      context,
    );
    const diagnose = await (runtime as any).execute(
      "run",
      { request: nonImplementRequest("abel-diagnose") },
      context,
    );

    expect(design.ok).toBe(true);
    expect(diagnose.ok).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("[DIAGNOSE:design-structural-redispatch] mechanically redispatches one invalid structural Design result", async () => {
    const { runtime, context } = await makeActive("design-structural-retry");
    const dispatch = vi
      .spyOn(runtime as any, "dispatchChild")
      .mockResolvedValueOnce({
        ok: false,
        error: "final assistant message is not one structural submit",
        failure: { kind: "artifact", code: "invalid-structural-result" },
        failureKind: "failed",
        failureClass: "artifact",
        transportFailure: false,
        disposeCount: 1,
        classification: {
          finalCategory: "mixed",
          attempts: 1,
          schema: "valid",
          identity: { request: true, role: true, task: true, phase: true },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        action: "run",
        result: { kind: "evidence" },
      });

    const result = await (runtime as any).execute(
      "run",
      { request: nonImplementRequest("abel-design") },
      context,
    );

    expect(result).toMatchObject({
      ok: true,
      action: "run",
      result: { kind: "evidence" },
    });
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls[1]?.[1]).toBe(dispatch.mock.calls[0]?.[1]);
  });

  it("[DIAGNOSE:design-missing-submit-redispatch] mechanically redispatches one Design result without a structural submit", async () => {
    const { runtime, context } = await makeActive(
      "design-missing-submit-retry",
    );
    const dispatch = vi
      .spyOn(runtime as any, "dispatchChild")
      .mockResolvedValueOnce({
        ok: false,
        error: "child produced no structural submission",
        failure: { kind: "artifact", code: "child-no-structural-submit" },
        failureKind: "failed",
        failureClass: "artifact",
        transportFailure: false,
        disposeCount: 1,
        classification: {
          finalCategory: "text-only",
          attempts: 0,
          schema: "none",
          identity: { request: false, role: false, task: false, phase: false },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        action: "run",
        result: { kind: "evidence" },
      });

    const result = await (runtime as any).execute(
      "run",
      { request: nonImplementRequest("abel-design") },
      context,
    );

    expect(result).toMatchObject({
      ok: true,
      action: "run",
      result: { kind: "evidence" },
    });
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls[1]?.[1]).toBe(dispatch.mock.calls[0]?.[1]);
  });
});

describe("Init never activates dispatch", () => {
  it("a package prompt with no eligible marker leaves the dispatcher inactive", async () => {
    const cwd = makeRoot("init");
    const { faux, modelRuntime } = await modelFixture("init");
    const context = {
      cwd,
      model: faux.getModel(),
      modelRegistry: new ModelRegistry(modelRuntime),
    };
    const runtime = new Runtime({
      parentPayloadBridge: new PassthroughParentPayloadBridge(),
    });
    const blocked = await (runtime as any).execute("cancel", {}, context);
    expect(blocked.ok).toBe(false);
    expect(blocked.notReady).toBe(true);
  });
});

describe("five-action routing", () => {
  it("routes run -> retain -> apply and exposes the retained diff", async () => {
    const { cwd, faux, runtime, context } = await makeActive("five");
    faux.setResponses([
      submitResponse(diffSubmit("task-five", "red")),
      submitResponse(diffSubmit("task-five-b", "red")),
    ]);
    const run = await (runtime as any).execute(
      "run",
      { request: requestFor("task-five", "red", cwd) },
      context,
    );
    expect(run).toMatchObject({
      kind: "candidate",
      taskId: "task-five",
      requestId: "task-five",
      phase: "red",
      resultId: expect.any(String),
    });
    const resultId = run.resultId as string;
    expect(resultId).toBeTypeOf("string");
    const retained = (runtime as any).results.get(resultId);
    expect(retained?.diff?.toString("utf8")).toBe(DIFF);

    const applied = await (runtime as any).execute(
      "apply",
      { resultId, requestId: "task-five:apply" },
      context,
    );
    expect(applied).toMatchObject({
      kind: "applied",
      taskId: "task-five",
      requestId: "task-five:apply",
      phase: "red",
      readyPhase: "green",
    });
    expect(readFileSync(join(cwd, "a.txt"), "utf8")).toBe("new\n");
  });

  it("routes run -> discard and removes the retained diff from memory", async () => {
    const { cwd, faux, runtime, context } = await makeActive("discard");
    faux.setResponses([submitResponse(diffSubmit("task-discard", "red"))]);
    const run = await (runtime as any).execute(
      "run",
      { request: requestFor("task-discard", "red", cwd) },
      context,
    );
    expect(run).toMatchObject({
      kind: "candidate",
      taskId: "task-discard",
      requestId: "task-discard",
      phase: "red",
      resultId: expect.any(String),
    });
    const resultId = run.resultId as string;
    const discarded = await (runtime as any).execute(
      "discard",
      {
        resultId,
        requestId: "task-discard:discard",
        rejection: {
          kind: "artifact",
          code: "parent-review-rejected",
          evidence: ["discard routing fixture"],
        },
      },
      context,
    );
    expect(discarded).toMatchObject({
      kind: "retry",
      taskId: "task-discard",
      requestId: "task-discard:discard",
      phase: "red",
      scope: "worker",
      cause: "artifact",
      remainingAttempts: 1,
    });
    expect((runtime as any).results.get(resultId)).toBeUndefined();
  });

  it("routes cancel and finish without leaving retained results live", async () => {
    const { cwd, faux, runtime, context } = await makeActive("cancel-finish");
    faux.setResponses([submitResponse(diffSubmit("task-cf", "red"))]);
    const run = await (runtime as any).execute(
      "run",
      { request: requestFor("task-cf", "red", cwd) },
      context,
    );
    expect(run).toMatchObject({
      kind: "candidate",
      taskId: "task-cf",
      requestId: "task-cf",
      phase: "red",
      resultId: expect.any(String),
    });
    const resultId = run.resultId as string;
    const cancelled = await (runtime as any).execute("cancel", {}, context);
    expect(cancelled.ok).toBe(true);
    const finished = await (runtime as any).execute("finish", {}, context);
    expect(finished.ok).toBe(true);
    expect(runtime.state).toBe("inactive");
    expect((runtime as any).results.get(resultId)).toBeUndefined();
  });
});

describe("file snapshots bind request bounds", () => {
  it("merges a safe file snapshot into the retained result", async () => {
    const { cwd, faux, runtime, context } = await makeActive("snapshot");
    faux.setResponses([submitResponse(diffSubmit("task-snap", "red"))]);
    const snapshot = snapshotFiles(cwd, ["a.txt"]);
    const run = await (runtime as any).execute(
      "run",
      { request: requestFor("task-snap", "red", cwd, snapshot) },
      context,
    );
    expect(run).toMatchObject({
      kind: "candidate",
      taskId: "task-snap",
      requestId: "task-snap",
      phase: "red",
      resultId: expect.any(String),
    });
    const retained = (runtime as any).results.get(run.resultId as string);
    expect(retained?.snapshot?.["a.txt"]?.kind).toBe("file");
  });

  it("rejects an unsafe snapshot before child dispatch or retention", async () => {
    const { cwd, faux, runtime, context } = await makeActive("snapshot-bad");
    faux.setResponses([submitResponse(diffSubmit("task-snap-bad", "red"))]);
    await expect(
      (runtime as any).execute(
        "run",
        {
          request: requestFor("task-snap-bad", "red", cwd, {
            "../escape": true,
          }),
        },
        context,
      ),
    ).rejects.toThrow(/snapshot|protocol/i);
    expect(faux.state.callCount).toBe(0);
    expect((runtime as any).results.size).toBe(0);
  });
});

describe("parent-only authority", () => {
  it("apply requires an explicit retained result and owning context", async () => {
    const { cwd, faux, runtime, context } = await makeActive("authority");
    faux.setResponses([submitResponse(diffSubmit("task-auth", "red"))]);
    await expect(
      (runtime as any).execute("apply", {}, context),
    ).rejects.toThrow(/resultId/i);
    await expect(
      (runtime as any).execute(
        "apply",
        { resultId: "missing", requestId: "task-auth:missing-apply" },
        context,
      ),
    ).rejects.toThrow(/retained.*result not found/i);
    const run = await (runtime as any).execute(
      "run",
      { request: requestFor("task-auth", "red", cwd) },
      context,
    );
    expect(run).toMatchObject({
      kind: "candidate",
      taskId: "task-auth",
      requestId: "task-auth",
      phase: "red",
      resultId: expect.any(String),
    });
    const applied = await (runtime as any).execute(
      "apply",
      { resultId: run.resultId, requestId: "task-auth:apply" },
      context,
    );
    expect(applied).toMatchObject({
      kind: "applied",
      taskId: "task-auth",
      requestId: "task-auth:apply",
      phase: "red",
      readyPhase: "green",
    });
  });
});

describe("cancellation", () => {
  it("rejects cancel while inactive and returns ok once active", async () => {
    const cwd = makeRoot("cancel-state");
    const { faux, modelRuntime } = await modelFixture("cancel-state");
    const context = {
      cwd,
      model: faux.getModel(),
      modelRegistry: new ModelRegistry(modelRuntime),
    };
    const runtime = new Runtime({
      parentPayloadBridge: new PassthroughParentPayloadBridge(),
    });
    const inactive = await (runtime as any).execute("cancel", {}, context);
    expect(inactive.ok).toBe(false);
    const act = new Activation();
    act.request();
    act.activate();
    const activeRuntime = new Runtime({
      activation: act,
      parentPayloadBridge: new PassthroughParentPayloadBridge(),
    });
    const ok = await (activeRuntime as any).execute("cancel", {}, context);
    expect(ok.ok).toBe(true);
    expect(activeRuntime.state).toBe("active");
  });
});
