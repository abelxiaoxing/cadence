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
import { LIMITS } from "../src/contracts";
import {
  isCurrent,
  mergeBounds,
  snapshotDirManifests,
  snapshotFiles,
} from "../src/file-snapshot";
import { Runtime } from "../src/runtime";
import { PassthroughParentPayloadBridge } from "./helpers/passthrough-parent-payload-bridge.ts";

let child: typeof import("../src/child-session") | null = null;
let parentProvider: typeof import("../src/parent-provider") | null = null;
try {
  child = await import("../src/child-session");
  parentProvider = await import("../src/parent-provider");
} catch {
  child = null;
  parentProvider = null;
}

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const notReady = (name: string): never =>
  expect.fail(`not_ready: ${name} is not implemented`);

function evidence() {
  return {
    id: "packet-1",
    role: "design-explorer",
    kind: "evidence",
    conclusions: ["src exists"],
    citations: [{ path: "a.txt", lines: "1" }],
    constraints: [],
    dependencies: [],
    risks: [],
    blockingQuestions: [],
    hints: { writeSet: [], verification: "none", agentsImpact: "none" },
  };
}

describe("real isolated child session", () => {
  it("uses empty resources, exactly five scoped tools, one structural submit, usage, and disposal", async () => {
    if (!child || !parentProvider) return notReady("child session");
    const cwd = mkdtempSync(join(tmpdir(), "abel-child-"));
    roots.push(cwd);
    writeFileSync(join(cwd, "a.txt"), "hello\n");
    const faux = fauxProvider({ provider: "abel-faux", api: "faux" });
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("abel_submit_result", evidence(), { id: "submit-1" }),
        { stopReason: "toolUse" },
      ),
    ]);
    const modelRuntime = await parentProvider.runtimeForProvider(faux.provider);
    const result = await child.runChildSession({
      cwd,
      modelRuntime,
      model: faux.getModel(),
      systemPrompt: "Return the supplied evidence through abel_submit_result.",
      requestId: "packet-1",
      role: "design-explorer",
      output: "evidence",
      roots: [cwd],
      timeoutMs: 5_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result).toEqual(evidence());
    expect(result.toolNames).toEqual([
      "read",
      "grep",
      "find",
      "ls",
      "abel_submit_result",
    ]);
    expect(result.submitCount).toBe(1);
    expect(result.disposeCount).toBe(1);
    expect(result.usage.totalTokens).toBeGreaterThan(0);
    expect(faux.state.callCount).toBe(1);
  });

  it("rejects duplicate, mismatched, or non-structural completion", async () => {
    if (!child || !parentProvider) return notReady("child session");
    const cwd = mkdtempSync(join(tmpdir(), "abel-child-bad-"));
    roots.push(cwd);
    const faux = fauxProvider({ provider: "abel-faux-bad", api: "faux" });
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("abel_submit_result", { ...evidence(), id: "wrong" }),
        { stopReason: "toolUse" },
      ),
    ]);
    const modelRuntime = await parentProvider.runtimeForProvider(faux.provider);
    const result = await child.runChildSession({
      cwd,
      modelRuntime,
      model: faux.getModel(),
      systemPrompt: "submit",
      requestId: "packet-1",
      role: "design-explorer",
      output: "evidence",
      roots: [cwd],
      timeoutMs: 5_000,
    });
    expect(result.ok).toBe(false);
    expect(result.usage.totalTokens).toBeGreaterThan(0);
  });

  it("aborts on timeout and disposes exactly once", async () => {
    if (!child || !parentProvider) return notReady("child session");
    const cwd = mkdtempSync(join(tmpdir(), "abel-child-timeout-"));
    roots.push(cwd);
    const faux = fauxProvider({
      provider: "abel-faux-timeout",
      api: "faux",
      tokensPerSecond: 0.01,
    });
    faux.setResponses([fauxAssistantMessage("never finish in time")]);
    const modelRuntime = await parentProvider.runtimeForProvider(faux.provider);
    const result = await child.runChildSession({
      cwd,
      modelRuntime,
      model: faux.getModel(),
      systemPrompt: "wait",
      requestId: "packet-1",
      role: "design-explorer",
      output: "evidence",
      roots: [cwd],
      timeoutMs: 5,
    });
    expect(result.ok).toBe(false);
    expect(result.disposeCount).toBe(1);
  });

  it("routes one diff through Runtime run -> retain -> apply", async () => {
    if (!parentProvider) return notReady("runtime facade");
    const cwd = mkdtempSync(join(tmpdir(), "abel-runtime-"));
    roots.push(cwd);
    execFileSync("git", ["init", "-q"], { cwd });
    execFileSync("git", ["config", "user.email", "test@example.invalid"], {
      cwd,
    });
    execFileSync("git", ["config", "user.name", "Abel Test"], { cwd });
    writeFileSync(join(cwd, "a.txt"), "old\n");
    mkdirSync(join(cwd, "node_modules"));
    writeFileSync(
      join(cwd, "package.json"),
      `${JSON.stringify({
        private: true,
        scripts: {
          check:
            "node -e \"console.error('[CHILD-SESSION:expected-red]'); process.exit(1)\"",
        },
      })}\n`,
    );
    writeFileSync(join(cwd, "bun.lock"), "# fixture lock\n");
    execFileSync("git", ["add", "a.txt"], { cwd });
    execFileSync("git", ["commit", "-qm", "base"], { cwd });
    const diff = "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n";
    const submitted = {
      id: "task-1",
      role: "implementation-worker",
      kind: "diff",
      taskId: "task-1",
      phase: "red",
      summary: "change a.txt",
      diff,
      expectedVerification: "cat a.txt",
      risks: [],
      contractCompliant: true,
    };
    const faux = fauxProvider({ provider: "abel-faux-runtime", api: "faux" });
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("abel_submit_result", submitted), {
        stopReason: "toolUse",
      }),
    ]);
    const modelRuntime = await parentProvider.runtimeForProvider(faux.provider);
    const activation = new Activation();
    activation.request();
    activation.activate();
    const runtime = new Runtime({
      activation,
      parentPayloadBridge: new PassthroughParentPayloadBridge(),
    });
    const context = {
      cwd,
      model: faux.getModel(),
      modelRegistry: new ModelRegistry(modelRuntime),
    };
    const request = {
      stage: "abel-implement",
      kind: "open-task",
      boundary: {
        changeId: "child-session-runtime",
        taskId: "task-1",
        objective: "Change a.txt",
        roots: ["."],
        context: { agents: "none", contract: "approved" },
        phases: {
          red: {
            read: ["a.txt"],
            write: ["a.txt"],
            verification: {
              id: "verify-task-1-red",
              argv: ["bun", "run", "check"],
              classification: "expected-red",
              expectedFailure: "[CHILD-SESSION:expected-red]",
              minTests: 1,
            },
            verificationLock: "child-session-runtime",
          },
          green: {
            read: ["a.txt"],
            write: ["a.txt"],
            verification: {
              id: "verify-task-1-green",
              argv: ["bun", "run", "check"],
              classification: "expected-green",
              minTests: 1,
            },
            verificationLock: "child-session-runtime",
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
        changeId: "child-session-runtime",
        taskId: "task-1",
        requestId: "task-1",
        phase: "red",
        snapshot: mergeBounds(
          snapshotFiles(cwd, ["a.txt", "package.json", "bun.lock"]),
          snapshotDirManifests(cwd, ["node_modules"]),
        ),
      },
    };
    const run = await (runtime as any).execute("run", { request }, context);
    expect(run).toMatchObject({
      kind: "candidate",
      requestId: "task-1",
      taskId: "task-1",
      phase: "red",
      result: submitted,
    });
    expect(run.resultId).toBeTypeOf("string");
    const retained = runtime.results.get(run.resultId);
    expect(retained).toBeDefined();
    expect(isCurrent(cwd, retained?.snapshot ?? {})).toBe(true);
    const applied = await (runtime as any).execute(
      "apply",
      { resultId: run.resultId, requestId: "task-1:apply:0" },
      context,
    );
    expect(applied, JSON.stringify(applied)).toMatchObject({
      kind: "applied",
      requestId: "task-1:apply:0",
      taskId: "task-1",
      phase: "red",
      readyPhase: "green",
    });
    expect(readFileSync(join(cwd, "a.txt"), "utf8")).toBe("new\n");
  });
});
type ChildOutcome = {
  ok: boolean;
  result?: unknown;
  failure?: unknown;
  submitCount?: unknown;
  disposeCount?: unknown;
  toolNames?: unknown;
  transportFailure?: unknown;
  classification?: unknown;
  usage?: { totalTokens: number };
};
type ChildModule = NonNullable<typeof child>;
type ParentModule = NonNullable<typeof parentProvider>;
type FauxResponse = ReturnType<typeof fauxAssistantMessage>;

async function runChildSessionFixture(
  childRef: ChildModule,
  parentRef: ParentModule,
  tag: string,
  response: FauxResponse,
  request: {
    requestId: string;
    role: "design-explorer" | "implementation-worker";
    output: "evidence" | "diff";
  } = {
    requestId: "task-1",
    role: "implementation-worker",
    output: "diff",
  },
) {
  const cwd = mkdtempSync(join(tmpdir(), `abel-fc-${tag}-`));
  roots.push(cwd);
  writeFileSync(join(cwd, "a.txt"), "old\n");
  const faux = fauxProvider({ provider: `abel-fc-${tag}`, api: "faux" });
  faux.setResponses([response]);
  const modelRuntime = await parentRef.runtimeForProvider(faux.provider);
  return (await childRef.runChildSession({
    cwd,
    modelRuntime,
    model: faux.getModel(),
    systemPrompt: "Submit the supplied diff through abel_submit_result.",
    requestId: request.requestId,
    role: request.role,
    output: request.output,
    roots: [cwd],
    timeoutMs: 5_000,
  })) as unknown as ChildOutcome;
}

const validDiffSubmit = {
  id: "task-1",
  role: "implementation-worker",
  kind: "diff",
  taskId: "task-1",
  phase: "red",
  summary: "change a.txt",
  diff: "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n",
  expectedVerification: "cat a.txt",
  risks: [],
  contractCompliant: true,
};

const submitResponse = (submitted: typeof validDiffSubmit): FauxResponse =>
  fauxAssistantMessage(fauxToolCall("abel_submit_result", submitted), {
    stopReason: "toolUse",
  });

describe("structural submission fixture precheck", () => {
  it("runs one valid strict diff submit through a real in-memory child session", async () => {
    if (!child || !parentProvider) return notReady("child session");
    const result = await runChildSessionFixture(
      child,
      parentProvider,
      "precheck",
      submitResponse(validDiffSubmit),
    );
    expect(result.ok).toBe(true);
    expect(result.submitCount).toBe(1);
    expect(result.disposeCount).toBe(1);
    expect(result.toolNames).toEqual([
      "read",
      "grep",
      "find",
      "ls",
      "abel_submit_result",
    ]);
  });
});

describe("structural submission classification", () => {
  it("[SLICE-2:typed-failure] measures non-ASCII evidence limits in UTF-8 bytes", async () => {
    if (!child || !parentProvider) return notReady("child session");
    const submitted = {
      ...evidence(),
      conclusions: ["界".repeat(Math.ceil(LIMITS.maxCompleteResultBytes / 3))],
    };
    const serialized = JSON.stringify(submitted);
    expect(serialized.length).toBeLessThan(LIMITS.maxCompleteResultBytes);
    expect(Buffer.byteLength(serialized, "utf8")).toBeGreaterThan(
      LIMITS.maxCompleteResultBytes,
    );

    const result = await runChildSessionFixture(
      child,
      parentProvider,
      "result-limit-evidence-utf8",
      fauxAssistantMessage(fauxToolCall("abel_submit_result", submitted), {
        stopReason: "toolUse",
      }),
      {
        requestId: "packet-1",
        role: "design-explorer",
        output: "evidence",
      },
    );

    expect(result.ok).toBe(false);
    expect(result.failure).toEqual({
      kind: "result-limit",
      limitBytes: LIMITS.maxCompleteResultBytes,
    });
    expect(result.result).toBeUndefined();
  });

  it("[SLICE-2:typed-failure] measures non-ASCII diff limits in UTF-8 bytes", async () => {
    if (!child || !parentProvider) return notReady("child session");
    const submitted = {
      ...validDiffSubmit,
      diff: [
        "--- a/a.txt",
        "+++ b/a.txt",
        "@@ -1 +1,2 @@",
        "-old",
        "+new",
        `+${"界".repeat(Math.ceil(LIMITS.maxCompleteResultBytes / 3))}`,
        "",
      ].join("\n"),
    };
    const serialized = JSON.stringify(submitted);
    expect(serialized.length).toBeLessThan(LIMITS.maxCompleteResultBytes);
    expect(Buffer.byteLength(serialized, "utf8")).toBeGreaterThan(
      LIMITS.maxCompleteResultBytes,
    );

    const result = await runChildSessionFixture(
      child,
      parentProvider,
      "result-limit-diff-utf8",
      submitResponse(submitted),
    );

    expect(result.ok).toBe(false);
    expect(result.failure).toEqual({
      kind: "result-limit",
      limitBytes: LIMITS.maxCompleteResultBytes,
    });
    expect(result.result).toBeUndefined();
  });

  it("[SLICE-2:typed-failure] returns a terminal result-limit failure without a partial result", async () => {
    if (!child || !parentProvider) return notReady("child session");
    const oversizedDiff = [
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1 +1,2 @@",
      "-old",
      "+new",
      `+${"x".repeat(LIMITS.maxCompleteResultBytes)}`,
      "",
    ].join("\n");
    const result = await runChildSessionFixture(
      child,
      parentProvider,
      "result-limit",
      submitResponse({ ...validDiffSubmit, diff: oversizedDiff }),
    );

    expect(result.ok).toBe(false);
    expect(result.failure).toEqual({
      kind: "result-limit",
      limitBytes: LIMITS.maxCompleteResultBytes,
    });
    expect(result.result).toBeUndefined();
  });

  it("[SLICE-2:typed-failure] distinguishes final shape, attempts, schema, and request/role/task/phase identity", async () => {
    if (!child || !parentProvider) return notReady("child session");
    const classification = (result: ChildOutcome) =>
      result.classification as
        | undefined
        | {
            finalCategory?: unknown;
            attempts?: unknown;
            schema?: unknown;
            identity?: {
              request?: unknown;
              role?: unknown;
              task?: unknown;
              phase?: unknown;
            };
          };

    // Final shape: a single valid strict submit is one retained submission.
    const single = await runChildSessionFixture(
      child,
      parentProvider,
      "single",
      submitResponse(validDiffSubmit),
    );
    const singleCls = classification(single);
    expect.soft(single.ok).toBe(true);
    expect.soft(singleCls?.finalCategory).toBe("single-submit-only");
    expect.soft(singleCls?.attempts).toBe(1);
    expect.soft(singleCls?.schema).toBe("valid");
    expect.soft(singleCls?.identity?.request).toBe(true);
    expect.soft(singleCls?.identity?.role).toBe(true);
    expect.soft(singleCls?.identity?.task).toBe(true);
    expect.soft(singleCls?.identity?.phase).toBe(true);

    // Final shape: an assistant that only produces text is not structural.
    const textOnly = await runChildSessionFixture(
      child,
      parentProvider,
      "text",
      fauxAssistantMessage("explaining progress without submitting"),
    );
    expect.soft(classification(textOnly)?.finalCategory).toBe("text-only");
    expect.soft(textOnly.transportFailure).toBe(false);

    // Attempts: a wrong request is still counted as an attempted submit.
    const wrongRequest = await runChildSessionFixture(
      child,
      parentProvider,
      "wrong-request",
      submitResponse({ ...validDiffSubmit, id: "other-task" }),
    );
    expect.soft(wrongRequest.ok).toBe(false);
    expect.soft(classification(wrongRequest)?.attempts).toBe(1);
    expect.soft(classification(wrongRequest)?.identity?.request).toBe(false);

    // Attempts: a wrong role is still counted as an attempted submit.
    const wrongRole = await runChildSessionFixture(
      child,
      parentProvider,
      "wrong-role",
      submitResponse({ ...validDiffSubmit, role: "design-explorer" }),
    );
    expect.soft(wrongRole.ok).toBe(false);
    expect.soft(classification(wrongRole)?.attempts).toBe(1);
    expect.soft(classification(wrongRole)?.identity?.role).toBe(false);

    // Identity: a wrong task id must be rejected before retention.
    const wrongTask = await runChildSessionFixture(
      child,
      parentProvider,
      "wrong-task",
      submitResponse({ ...validDiffSubmit, taskId: "other-task" }),
    );
    expect.soft(wrongTask.ok).toBe(false);
    expect.soft(classification(wrongTask)?.identity?.task).toBe(false);

    // Identity: a phase other than the request phase must be rejected.
    const wrongPhase = await runChildSessionFixture(
      child,
      parentProvider,
      "wrong-phase",
      submitResponse({ ...validDiffSubmit, phase: "review" }),
    );
    expect.soft(wrongPhase.ok).toBe(false);
    expect.soft(classification(wrongPhase)?.identity?.phase).toBe(false);

    // Schema: an invalid diff payload is rejected and classed as invalid.
    const invalidSchema = await runChildSessionFixture(
      child,
      parentProvider,
      "schema",
      submitResponse({ ...validDiffSubmit, diff: "not a diff" }),
    );
    expect.soft(invalidSchema.ok).toBe(false);
    expect.soft(classification(invalidSchema)?.schema).toBe("invalid");
    expect.soft(invalidSchema.transportFailure).toBe(false);
    expect.soft(invalidSchema.failure).toEqual({
      kind: "artifact",
      code: "invalid-structural-result",
    });
  });
});
