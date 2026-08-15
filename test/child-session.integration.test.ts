import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import { Runtime } from "../src/runtime";

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
    execFileSync("git", ["add", "a.txt"], { cwd });
    execFileSync("git", ["commit", "-qm", "base"], { cwd });
    const diff = "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n";
    const submitted = {
      id: "task-1",
      role: "implementation-worker",
      kind: "diff",
      taskId: "task-1",
      phase: "green",
      summary: "change a.txt",
      diff,
      expectedVerification: "cat a.txt",
      risks: [],
      nextStep: "apply",
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
    const runtime = new Runtime({ activation });
    const context = {
      cwd,
      model: faux.getModel(),
      modelRegistry: new ModelRegistry(modelRuntime),
    };
    const request = {
      stage: "abel-implement",
      role: "implementation-worker",
      id: "task-1",
      phase: "green",
      objective: "Change a.txt",
      roots: ["."],
      context: { agents: "none", contract: "approved" },
      declared: {
        read: ["a.txt"],
        write: ["a.txt"],
        conflicts: [],
        resources: [],
      },
      output: "diff",
    };
    const run = await (runtime as any).execute("run", { request }, context);
    expect(run.ok).toBe(true);
    expect(run.resultId).toBeTypeOf("string");
    const applied = await (runtime as any).execute(
      "apply",
      { resultId: run.resultId },
      context,
    );
    expect(applied.ok).toBe(true);
    expect(readFileSync(join(cwd, "a.txt"), "utf8")).toBe("new\n");
  });
});
type ChildOutcome = {
  ok: boolean;
  submitCount?: unknown;
  disposeCount?: unknown;
  toolNames?: unknown;
  classification?: unknown;
};
type ChildModule = NonNullable<typeof child>;
type ParentModule = NonNullable<typeof parentProvider>;
type FauxResponse = ReturnType<typeof fauxAssistantMessage>;

async function runChildSessionFixture(
  childRef: ChildModule,
  parentRef: ParentModule,
  tag: string,
  response: FauxResponse,
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
    requestId: "task-1",
    role: "implementation-worker",
    output: "diff",
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
  nextStep: "apply",
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
  it("distinguishes final shape, attempts, schema, and request/role/task/phase identity", async () => {
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
  });
});
