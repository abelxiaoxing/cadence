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
import {
  mergeBounds,
  snapshotDirManifests,
  snapshotFiles,
} from "../src/file-snapshot";
import register, { DISPATCH_TOOL } from "../src/index";
import { runtimeForProvider } from "../src/parent-provider";
import { Runtime } from "../src/runtime";
import { PassthroughParentPayloadBridge } from "./helpers/passthrough-parent-payload-bridge.ts";

const roots: string[] = [];
let providerSequence = 0;

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "abel-runtime-scheduler-"));
  roots.push(root);
  writeFileSync(join(root, "a.txt"), "old\n");
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

function activeRuntime(): Runtime {
  const activation = new Activation();
  activation.request();
  activation.activate();
  return new Runtime({
    activation,
    parentPayloadBridge: new PassthroughParentPayloadBridge(),
  });
}

function request(id: string, root: string) {
  return {
    stage: "abel-implement",
    role: "implementation-worker",
    taskId: id,
    id,
    phase: "green",
    objective: `Complete ${id}`,
    roots: ["."],
    context: { agents: "root contract", contract: "approved task" },
    declared: {
      read: ["a.txt"],
      write: ["a.txt"],
      conflicts: [],
      resources: [],
      verificationLock: "runtime-scheduler",
    },
    snapshot: snapshotFiles(root, ["a.txt"]),
    output: "diff",
    verification: {
      id: `verify-${id}`,
      argv: ["bun", "run", "check"],
      classification: "expected-green",
      minTests: 1,
    },
  };
}

function submitted(id: string) {
  return {
    id,
    role: "implementation-worker",
    kind: "diff",
    taskId: id,
    phase: "green",
    summary: `Complete ${id}`,
    diff: `--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+${id}\n`,
    expectedVerification: "fixed fixture verification",
    risks: [],
    nextStep: "parent review",
    contractCompliant: true,
  };
}

function response(id: string) {
  return fauxAssistantMessage(
    fauxToolCall("abel_submit_result", submitted(id)),
    { stopReason: "toolUse" },
  );
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("fixture wait timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function contextFor(root: string, faux: ReturnType<typeof fauxProvider>) {
  const modelRuntime = await runtimeForProvider(faux.provider);
  return {
    cwd: root,
    model: faux.getModel(),
    modelRegistry: new ModelRegistry(modelRuntime),
  };
}

describe("Runtime Scheduler integration", () => {
  it("injects the authoritative phase identity and delivery contract into the Worker prompt", async () => {
    const root = makeRoot();
    const runtime = activeRuntime();
    const faux = fauxProvider({
      provider: `abel-runtime-prompt-${providerSequence++}`,
      api: "faux",
    });
    const taskId = "stable-task";
    const requestId = "stable-task:green:1";
    const phaseRequest = {
      ...request(requestId, root),
      taskId,
      id: requestId,
    };
    let observedContext = "";
    faux.setResponses([
      (providerContext) => {
        observedContext =
          (providerContext as unknown as { systemPrompt?: string })
            .systemPrompt ?? "";
        return fauxAssistantMessage(
          fauxToolCall("abel_submit_result", {
            ...submitted(requestId),
            taskId,
          }),
          { stopReason: "toolUse" },
        );
      },
    ]);
    const context = await contextFor(root, faux);

    const outcome = await runtime.execute(
      "run",
      { request: phaseRequest },
      context,
    );
    await runtime.execute("finish", {}, context);

    expect(outcome.ok).toBe(true);
    expect(observedContext).toContain(
      `<phase-contract>${JSON.stringify({
        taskId,
        requestId,
        phase: "green",
        readSet: ["a.txt"],
        writeSet: ["a.txt"],
        verification: phaseRequest.verification,
      })}</phase-contract>`,
    );
  });

  it("reconstructs a declared directory from the Worker's complete observed snapshot", async () => {
    const root = makeRoot();
    mkdirSync(join(root, "fixtures"));
    writeFileSync(join(root, "fixtures/observed.txt"), "head\n");
    writeFileSync(join(root, "fixtures/removed.txt"), "remove\n");
    execFileSync("git", ["add", "fixtures"], { cwd: root });
    execFileSync("git", ["commit", "-qm", "directory baseline"], {
      cwd: root,
    });
    writeFileSync(join(root, "fixtures/observed.txt"), "worker\n");
    rmSync(join(root, "fixtures/removed.txt"));
    writeFileSync(join(root, "fixtures/untracked.txt"), "untracked\n");
    const check = [
      "const f=require('node:fs')",
      "if(f.readFileSync('fixtures/observed.txt','utf8')!=='worker\\n')process.exit(1)",
      "if(f.existsSync('fixtures/removed.txt'))process.exit(1)",
      "if(f.readFileSync('fixtures/untracked.txt','utf8')!=='untracked\\n')process.exit(1)",
    ].join(";");
    writeFileSync(
      join(root, "package.json"),
      `${JSON.stringify({ private: true, scripts: { check: `node -e "${check}"` } })}\n`,
    );
    const runtime = activeRuntime();
    const faux = fauxProvider({
      provider: `abel-runtime-directory-${providerSequence++}`,
      api: "faux",
    });
    faux.setResponses([response("directory-baseline")]);
    const context = await contextFor(root, faux);
    const phaseRequest = {
      ...request("directory-baseline", root),
      declared: {
        ...request("directory-baseline", root).declared,
        read: ["fixtures"],
      },
      snapshot: mergeBounds(
        snapshotDirManifests(root, ["fixtures"]),
        snapshotFiles(root, ["a.txt"]),
      ),
    };

    const outcome = await runtime.execute(
      "run",
      { request: phaseRequest },
      context,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || !outcome.resultId) return;
    const applied = await runtime.execute(
      "apply",
      { resultId: outcome.resultId },
      context,
    );
    await runtime.execute("finish", {}, context);

    expect(applied.ok).toBe(true);
    expect(readFileSync(join(root, "a.txt"), "utf8")).toBe(
      "directory-baseline\n",
    );
  });

  it("sanitizes preflight preparation exceptions and consumes the two-launch budget", async () => {
    const root = makeRoot();
    const runtime = activeRuntime();
    const faux = fauxProvider({
      provider: `abel-runtime-preflight-error-${providerSequence++}`,
      api: "faux",
    });
    faux.setResponses([
      response("preflight-error"),
      response("preflight-error"),
    ]);
    const context = await contextFor(root, faux);
    const phaseRequest = request("preflight-error", root);
    chmodSync(join(root, "node_modules"), 0o000);

    try {
      const first = await runtime.execute(
        "run",
        { request: phaseRequest },
        context,
      );
      const second = await runtime.execute(
        "run",
        { request: phaseRequest },
        context,
      );
      const blocked = await runtime.execute(
        "run",
        { request: phaseRequest },
        context,
      );

      expect(first).toMatchObject({
        ok: false,
        recovery: { code: "environment-blocked", launchIndex: 0 },
      });
      expect(second).toMatchObject({
        ok: false,
        recovery: { code: "environment-blocked", launchIndex: 1 },
      });
      expect(blocked).toMatchObject({
        ok: false,
        recovery: { code: "mechanical-redispatch-exhausted" },
      });
      expect(JSON.stringify([first, second, blocked])).not.toMatch(
        /EACCES|node_modules|abel-runtime-scheduler-/i,
      );
      expect(faux.state.callCount).toBe(2);
    } finally {
      chmodSync(join(root, "node_modules"), 0o755);
      await runtime.execute("finish", {}, context);
    }
  });

  it("forwards the Pi tool signal into Runtime execution", async () => {
    const execute = vi
      .spyOn(Runtime.prototype, "execute")
      .mockResolvedValue({ ok: false, error: "tool call cancelled" });
    let tool:
      | {
          name: string;
          execute: (...args: any[]) => Promise<unknown>;
        }
      | undefined;
    const pi = {
      registerTool(definition: typeof tool) {
        tool = definition;
      },
      on() {},
      getActiveTools: () => [],
      setActiveTools() {},
    };
    register(pi as never);
    const controller = new AbortController();
    const context = {};

    try {
      expect(tool?.name).toBe(DISPATCH_TOOL);
      await tool?.execute(
        "call-1",
        { action: "run", request: {} },
        controller.signal,
        undefined,
        context,
      );
      expect(execute).toHaveBeenCalledWith(
        "run",
        { action: "run", request: {} },
        context,
        controller.signal,
      );
    } finally {
      execute.mockRestore();
    }
  });

  it("exposes complete recovery records in provider-visible failure content", async () => {
    const recovery = {
      code: "design-required",
      taskId: "task-recovery-content",
      requestId: "task-recovery-content:green:0",
      phase: "green",
      launchIndex: 1,
      branchBlocked: true,
      dependentsBlocked: true,
      partialResultUsable: false,
      independentResultsPreserved: true,
      next: "return-to-design",
    } as const;
    const execute = vi.spyOn(Runtime.prototype, "execute").mockResolvedValue({
      ok: false,
      error: "design-required: branch recovery is required",
      recovery,
    });
    let tool:
      | {
          name: string;
          execute: (...args: any[]) => Promise<unknown>;
        }
      | undefined;
    const pi = {
      registerTool(definition: typeof tool) {
        tool = definition;
      },
      on() {},
      getActiveTools: () => [],
      setActiveTools() {},
    };

    try {
      register(pi as never);
      expect(tool?.name).toBe(DISPATCH_TOOL);
      const rendered = await tool?.execute(
        "recovery-call",
        { action: "run", request: {} },
        undefined,
        undefined,
        {},
      );
      expect(rendered).toMatchObject({ isError: true });
      const content = (
        rendered as {
          content?: Array<{ type: string; text?: string }>;
        }
      ).content;
      expect(content?.[0]?.type).toBe("text");
      const providerPayload = JSON.parse(content?.[0]?.text ?? "");
      expect(providerPayload).toMatchObject({
        ok: false,
        error: "design-required: branch recovery is required",
      });
      expect(providerPayload.recovery).toEqual(recovery);
    } finally {
      execute.mockRestore();
    }
  });

  it("serializes conflicting Runtime runs through the Scheduler", async () => {
    const root = makeRoot();
    const runtime = activeRuntime();
    const faux = fauxProvider({
      provider: `abel-runtime-scheduler-${providerSequence++}`,
      api: "faux",
    });
    const first = deferred<ReturnType<typeof fauxAssistantMessage>>();
    const second = deferred<ReturnType<typeof fauxAssistantMessage>>();
    const starts: string[] = [];
    faux.setResponses([
      async () => {
        starts.push("left");
        return first.promise;
      },
      async () => {
        starts.push("right");
        return second.promise;
      },
    ]);
    const context = await contextFor(root, faux);

    const left = runtime.execute(
      "run",
      { request: request("left", root) },
      context,
    );
    await waitFor(() => starts.length === 1);
    const right = runtime.execute(
      "run",
      { request: request("right", root) },
      context,
    );
    await Promise.race([
      waitFor(() => starts.length === 2, 250).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 250)),
    ]);
    const startsBeforeFirstSettled = [...starts];

    first.resolve(response("left"));
    await waitFor(() => starts.length === 2);
    second.resolve(response("right"));
    const outcomes = await Promise.all([left, right]);
    await runtime.execute("finish", {}, context);

    expect(startsBeforeFirstSettled).toEqual(["left"]);
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
  });

  it("cancel aborts active work, settles it, and never starts queued work", async () => {
    const root = makeRoot();
    const runtime = activeRuntime();
    const faux = fauxProvider({
      provider: `abel-runtime-cancel-${providerSequence++}`,
      api: "faux",
    });
    const pending = deferred<ReturnType<typeof fauxAssistantMessage>>();
    const aborted = deferred<void>();
    let childStarted = false;
    let childAborted = false;
    faux.setResponses([
      (_context, options) => {
        childStarted = true;
        options?.signal?.addEventListener(
          "abort",
          () => {
            childAborted = true;
            aborted.resolve();
            pending.reject(new Error("provider observed cancellation"));
          },
          { once: true },
        );
        return pending.promise;
      },
    ]);
    const context = await contextFor(root, faux);

    const run = runtime.execute(
      "run",
      { request: request("cancelled-child", root) },
      context,
    );
    await waitFor(() => childStarted);
    const queued = runtime.execute(
      "run",
      { request: request("queued-child", root) },
      context,
    );
    const cancelPromise = runtime.execute("cancel", {}, context);
    await Promise.race([
      aborted.promise,
      new Promise((resolve) => setTimeout(resolve, 100)),
    ]);
    const cancellationReachedChild = childAborted;
    if (!childAborted) pending.resolve(response("cancelled-child"));
    const cancel = await cancelPromise;
    const [outcome, queuedOutcome] = await Promise.all([run, queued]);
    const retainedBeforeFinish = runtime.results.size;
    await runtime.execute("finish", {}, context);

    expect(cancel).toEqual({ ok: true, action: "cancel" });
    expect(cancellationReachedChild).toBe(true);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatch(/cancel/i);
    expect(queuedOutcome.ok).toBe(false);
    if (!queuedOutcome.ok) expect(queuedOutcome.error).toMatch(/cancel/i);
    expect(faux.state.callCount).toBe(1);
    expect(retainedBeforeFinish).toBe(0);
  });

  it("does not admit a run whose tool signal is already aborted", async () => {
    const root = makeRoot();
    const runtime = activeRuntime();
    const faux = fauxProvider({
      provider: `abel-runtime-pre-cancel-${providerSequence++}`,
      api: "faux",
    });
    faux.setResponses([response("never-started")]);
    const context = await contextFor(root, faux);
    const controller = new AbortController();
    controller.abort(new Error("tool call cancelled"));

    const outcome = await (runtime.execute as any)(
      "run",
      { request: request("never-started", root) },
      context,
      controller.signal,
    );
    await runtime.execute("finish", {}, context);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatch(/tool call cancelled/i);
    expect(faux.state.callCount).toBe(0);
  });

  it("tool cancellation settles only its own batch and releases a queued sibling", async () => {
    const root = makeRoot();
    const runtime = activeRuntime();
    const faux = fauxProvider({
      provider: `abel-runtime-tool-cancel-${providerSequence++}`,
      api: "faux",
    });
    const pending = deferred<ReturnType<typeof fauxAssistantMessage>>();
    let firstStarted = false;
    faux.setResponses([
      (_context, options) => {
        firstStarted = true;
        options?.signal?.addEventListener(
          "abort",
          () => pending.reject(new Error("provider observed cancellation")),
          { once: true },
        );
        return pending.promise;
      },
      response("surviving-sibling"),
    ]);
    const context = await contextFor(root, faux);
    const controller = new AbortController();
    const cancelled = (runtime.execute as any)(
      "run",
      { request: request("tool-cancelled", root) },
      context,
      controller.signal,
    );
    await waitFor(() => firstStarted);
    const sibling = runtime.execute(
      "run",
      { request: request("surviving-sibling", root) },
      context,
    );

    controller.abort(new Error("tool call cancelled"));
    const timeout = Symbol("timeout");
    const raced = await Promise.race([
      Promise.all([cancelled, sibling]),
      new Promise<typeof timeout>((resolve) =>
        setTimeout(() => resolve(timeout), 500),
      ),
    ]);
    if (raced === timeout) {
      pending.resolve(response("tool-cancelled"));
      await Promise.all([cancelled, sibling]);
    }
    const retainedBeforeFinish = runtime.results.size;
    await runtime.execute("finish", {}, context);

    expect(raced).not.toBe(timeout);
    if (raced === timeout) return;
    expect(raced[0].ok).toBe(false);
    if (!raced[0].ok) expect(raced[0].error).toMatch(/tool call cancelled/i);
    expect(
      "resultId" in raced[0] ? raced[0].resultId : undefined,
    ).toBeUndefined();
    expect(raced[1].ok).toBe(true);
    if (raced[1].ok) expect(raced[1].resultId).toBeTypeOf("string");
    expect(retainedBeforeFinish).toBe(1);
    expect(faux.state.callCount).toBe(2);
  });

  it("settles tool cancellation while phase auth is still pending", async () => {
    const root = makeRoot();
    const runtime = activeRuntime();
    const faux = fauxProvider({
      provider: `abel-runtime-auth-cancel-${providerSequence++}`,
      api: "faux",
    });
    faux.setResponses([response("auth-window")]);
    const auth = deferred<{
      ok: true;
      apiKey: string;
      headers: Record<string, string>;
    }>();
    let authStarted = false;
    const context = {
      cwd: root,
      model: faux.getModel(),
      modelRegistry: {
        getProvider: () => faux.provider,
        getApiKeyAndHeaders: () => {
          authStarted = true;
          return auth.promise;
        },
      },
    };
    const controller = new AbortController();
    const run = (runtime.execute as any)(
      "run",
      { request: request("auth-window", root) },
      context,
      controller.signal,
    );
    await waitFor(() => authStarted);

    controller.abort(new Error("tool call cancelled during auth"));
    const timeout = Symbol("timeout");
    const raced = await Promise.race([
      run,
      new Promise<typeof timeout>((resolve) =>
        setTimeout(() => resolve(timeout), 500),
      ),
    ]);
    auth.resolve({ ok: true, apiKey: "test", headers: {} });
    if (raced === timeout) await run;
    await runtime.execute("finish", {}, context as any);

    expect(raced).not.toBe(timeout);
    if (raced === timeout) return;
    expect(raced.ok).toBe(false);
    if (!raced.ok) expect(raced.error).toMatch(/cancelled during auth/i);
    expect(faux.state.callCount).toBe(0);
  });
});
