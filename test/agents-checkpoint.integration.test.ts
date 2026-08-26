import { execFileSync } from "node:child_process";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Activation } from "../src/activation.ts";
import { snapshotFiles } from "../src/file-snapshot.ts";
import { applyAgentsCheckpoint } from "../src/patch.ts";
import { Runtime } from "../src/runtime.ts";
import { workerIdentity } from "../src/worker.ts";
import {
  admitGraph,
  graphAdmissionFor,
  type ImplementTaskFixture,
  taskAttemptFor,
} from "./helpers/implement-graph-fixture.ts";
import { PassthroughParentPayloadBridge } from "./helpers/passthrough-parent-payload-bridge.ts";

const START = "<!-- ABEL:AGENTS-INDEX:START -->";
const END = "<!-- ABEL:AGENTS-INDEX:END -->";
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "cadence-agents-checkpoint-"));
  roots.push(root);
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], {
    cwd: root,
  });
  execFileSync("git", ["config", "user.name", "Cadence Test"], {
    cwd: root,
  });
  writeFileSync(
    path.join(root, "AGENTS.md"),
    ["# Human policy", "", START, "- old route", END, ""].join("\n"),
  );
  mkdirSync(path.join(root, "scripts"));
  writeFileSync(
    path.join(root, "scripts/check.mjs"),
    "process.exitCode = 0;\n",
  );
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ scripts: { check: "node scripts/check.mjs" } }),
  );
  execFileSync("git", ["add", "AGENTS.md", "package.json", "scripts"], {
    cwd: root,
  });
  execFileSync("git", ["commit", "-qm", "baseline"], { cwd: root });
  return root;
}

function managedDiff(route: string): string {
  return [
    "--- a/AGENTS.md",
    "+++ b/AGENTS.md",
    "@@ -2,4 +2,4 @@",
    " ",
    ` ${START}`,
    "-- old route",
    `+- ${route}`,
    ` ${END}`,
    "",
  ].join("\n");
}

function checkpoint(root: string, diff: string, impact = "update-existing") {
  return {
    stage: "abel-implement",
    taskId: "docs-agents-checkpoint",
    agentsImpact: impact,
    agentsTarget: "AGENTS.md",
    agentsManagedOnly: true,
    stableCheckpoint: true,
    snapshot: snapshotFiles(root, ["AGENTS.md"]),
    diff,
  };
}

function checkpointAttempt(root: string, diff: string) {
  return {
    changeId: "agents-checkpoint-fixture",
    taskId: "docs-agents-checkpoint",
    requestId: "docs-agents-checkpoint:checkpoint:0",
    snapshot: snapshotFiles(root, ["AGENTS.md"]),
    diff,
  };
}

function docsTaskRequest(
  snapshot: unknown,
  options: { taskId?: string; document?: string } = {},
): ImplementTaskFixture {
  const taskId = options.taskId ?? "docs-agents-checkpoint";
  const document = options.document ?? "README.md";
  return {
    boundary: {
      changeId: "agents-checkpoint-fixture",
      taskId,
      dependsOn: [],
      objective: "Update approved README and environment documentation",
      roots: ["."],
      context: { agents: "root AGENTS", contract: "approved docs task" },
      phases: {
        red: {
          read: [document, "package.json"],
          write: [document],
          verification: {
            kind: "static-check",
            id: `${taskId}-static-red`,
            runner: {
              kind: "package-script",
              packageManager: "bun",
              script: "check",
              command: "node scripts/check.mjs",
            },
            args: [],
            classification: "expected-red",
            expectedFailure: "[DOCS:missing-approved-route]",
          },
          verificationInputs: [{ kind: "workspace", path: "package.json" }],
        },
        green: {
          read: [document, "package.json"],
          write: [document],
          verification: {
            kind: "static-check",
            id: `${taskId}-static-green`,
            runner: {
              kind: "package-script",
              packageManager: "bun",
              script: "check",
              command: "node scripts/check.mjs",
            },
            args: [],
            classification: "expected-green",
          },
          verificationInputs: [{ kind: "workspace", path: "package.json" }],
        },
      },
      scheduling: { conflicts: [], resources: [] },
      agents: {
        impact: "update-existing",
        target: "AGENTS.md",
        managedOnly: true,
      },
      approvedDependencies: [],
      impactClosure: {
        changedSurfaces: ["none"],
        searchEvidence: [],
        relatedTests: [],
        affectedSuite: [],
      },
    },
    attempt: {
      changeId: "agents-checkpoint-fixture",
      taskId,
      requestId: `${taskId}:red:0`,
      phase: "red",
      snapshot,
    },
  } as const;
}

function greenAttempt(
  request: ReturnType<typeof docsTaskRequest>,
  snapshot: unknown,
) {
  return {
    stage: "abel-implement",
    kind: "task-attempt",
    attempt: {
      ...structuredClone(request.attempt),
      requestId: `${request.attempt.taskId}:green:0`,
      phase: "green",
      snapshot,
    },
  } as const;
}

function pinCheckpointWorker(runtime: Runtime, root: string): void {
  const request = docsTaskRequest({});
  const admission = graphAdmissionFor([request]);
  (runtime as any).registry.admitGraph(
    admission.graph,
    admission.graphHash,
    root,
    admission.state,
  );
  const worker = (runtime as any).registry.open(
    request.boundary,
    workerIdentity({ provider: "test-provider", id: "test-model" }),
    root,
    request.attempt,
  );
  worker.state = {
    kind: "agents-checkpoint-pending",
    finalPhase: "green",
    attemptIndex: 0,
  };
}

function runtimeFixture(): Runtime {
  const activation = new Activation();
  activation.request();
  activation.activate();
  return new Runtime({
    activation,
    parentPayloadBridge: new PassthroughParentPayloadBridge(),
  });
}

function runtimeContext(root: string): Parameters<Runtime["execute"]>[2] {
  return {
    cwd: root,
    model: {
      provider: "test-provider",
      id: "test-model",
      name: "test-model",
    },
    modelRegistry: {},
  } as Parameters<Runtime["execute"]>[2];
}

function mockCandidateDelivery(runtime: Runtime, root: string) {
  return vi
    .spyOn(runtime as any, "dispatchChild")
    .mockImplementation(async (_agent: unknown, envelope: any) => {
      const resultId = runtime.results.retain({
        diff: "--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new\n",
        root,
        writeSet: [...envelope.declared.write],
        approvedDependencies: [...(envelope.approvedDependencies ?? [])],
        snapshot: structuredClone(envelope.snapshot),
      });
      return {
        ok: true,
        action: "run",
        result: { kind: "diff" },
        resultId,
      };
    });
}

async function finalCandidateFixture() {
  const root = fixture();
  writeFileSync(path.join(root, "README.md"), "old docs\n");
  const runtime = runtimeFixture();
  const request = docsTaskRequest(
    snapshotFiles(root, ["README.md", "package.json"]),
  );
  const dispatch = vi.spyOn(runtime as any, "dispatchChild");
  const redResultId = runtime.results.retain({
    diff: [
      "--- a/README.md",
      "+++ b/README.md",
      "@@ -1 +1 @@",
      "-old docs",
      "+red docs",
      "",
    ].join("\n"),
    root,
    writeSet: ["README.md"],
    approvedDependencies: [],
    snapshot: request.attempt.snapshot,
  } as Parameters<typeof runtime.results.retain>[0]);
  dispatch.mockResolvedValueOnce({
    ok: true,
    action: "run",
    result: { kind: "diff" },
    resultId: redResultId,
  });
  await admitGraph(runtime, [request], runtimeContext(root));
  await (runtime.execute as any)(
    "run",
    { request: taskAttemptFor(request) },
    runtimeContext(root),
  );
  await (runtime.execute as any)(
    "apply",
    {
      resultId: redResultId,
      requestId: "docs-agents-checkpoint:apply:red",
    },
    runtimeContext(root),
  );

  const greenSnapshot = snapshotFiles(root, ["README.md", "package.json"]);
  const green = greenAttempt(request, greenSnapshot);
  const greenResultId = runtime.results.retain({
    diff: [
      "--- a/README.md",
      "+++ b/README.md",
      "@@ -1 +1 @@",
      "-red docs",
      "+approved docs",
      "",
    ].join("\n"),
    root,
    writeSet: ["README.md"],
    approvedDependencies: [],
    snapshot: greenSnapshot,
  } as Parameters<typeof runtime.results.retain>[0]);
  dispatch.mockResolvedValueOnce({
    ok: true,
    action: "run",
    result: { kind: "diff" },
    resultId: greenResultId,
  });
  await (runtime.execute as any)(
    "run",
    { request: green },
    runtimeContext(root),
  );

  const applied = await (runtime.execute as any)(
    "apply",
    {
      resultId: greenResultId,
      requestId: "docs-agents-checkpoint:apply:final",
    },
    runtimeContext(root),
  );
  const worker = (runtime as any).registry.values()[0];
  return { root, runtime, request, worker, applied };
}

function invalidManagedDiff(route: string): string {
  return managedDiff(route).replace("-- old route", "-- absent route");
}

describe("parent-owned AGENTS stable checkpoints", () => {
  it("applies an approved update-existing diff only inside the managed block", async () => {
    const root = fixture();

    const result = await applyAgentsCheckpoint(
      root,
      checkpoint(root, managedDiff("README and environment routes")),
    );

    expect(result).toMatchObject({
      ok: true,
      target: "AGENTS.md",
      agentsImpact: "update-existing",
    });
    expect(readFileSync(path.join(root, "AGENTS.md"), "utf8")).toBe(
      [
        "# Human policy",
        "",
        START,
        "- README and environment routes",
        END,
        "",
      ].join("\n"),
    );
  });

  it("[SLICE-2:typed-failure] preserves human text when a checkpoint escapes the managed region", async () => {
    const root = fixture();
    const before = [
      `# Human policy mentions ${START} literally`,
      "",
      START,
      "- old route",
      END,
      "",
    ].join("\n");
    writeFileSync(path.join(root, "AGENTS.md"), before);
    const diff = [
      "--- a/AGENTS.md",
      "+++ b/AGENTS.md",
      "@@ -1,5 +1,5 @@",
      `-# Human policy mentions ${START} literally`,
      `+# Human policy mentions ${START} maliciously`,
      " ",
      ` ${START}`,
      "-- old route",
      "+- new route",
      ` ${END}`,
      "",
    ].join("\n");

    const result = await applyAgentsCheckpoint(root, checkpoint(root, diff));

    expect(result).toEqual({
      ok: false,
      failure: {
        kind: "artifact",
        code: "outside-managed-region",
        stage: "agents-checkpoint",
      },
    });
    expect(readFileSync(path.join(root, "AGENTS.md"), "utf8")).toBe(before);
  });

  it.each(["symlink", "directory"] as const)(
    "[SLICE-2:typed-failure] rejects a nonregular %s checkpoint target as typed artifact",
    async (kind) => {
      const root = fixture();
      const target = path.join(root, "AGENTS.md");
      const before = readFileSync(target, "utf8");
      rmSync(target);
      if (kind === "symlink") {
        writeFileSync(path.join(root, "AGENTS-target.md"), before);
        symlinkSync("AGENTS-target.md", target);
      } else {
        mkdirSync(target);
      }

      const result = await applyAgentsCheckpoint(
        root,
        checkpoint(root, managedDiff("new route")),
      );

      expect(result).toEqual({
        ok: false,
        failure: {
          kind: "artifact",
          code: "nonregular-mode",
          stage: "agents-checkpoint",
        },
      });
      expect(lstatSync(target).isSymbolicLink()).toBe(kind === "symlink");
      expect(lstatSync(target).isDirectory()).toBe(kind === "directory");
      if (kind === "symlink") {
        expect(readFileSync(path.join(root, "AGENTS-target.md"), "utf8")).toBe(
          before,
        );
      }
    },
  );

  it("rejects Design, none-impact, unstable, and human-content edits without mutation", async () => {
    const root = fixture();
    const before = readFileSync(path.join(root, "AGENTS.md"), "utf8");

    const humanEdit = [
      "--- a/AGENTS.md",
      "+++ b/AGENTS.md",
      "@@ -1,5 +1,5 @@",
      "-# Human policy",
      "+# Replaced policy",
      " ",
      ` ${START}`,
      " - old route",
      ` ${END}`,
      "",
    ].join("\n");
    const cases = [
      { ...checkpoint(root, managedDiff("new route")), stage: "abel-design" },
      { ...checkpoint(root, managedDiff("new route")), agentsImpact: "none" },
      {
        ...checkpoint(root, managedDiff("new route")),
        stableCheckpoint: false,
      },
      checkpoint(root, humanEdit),
    ];

    for (const candidate of cases) {
      const result = await applyAgentsCheckpoint(root, candidate);
      expect(result).toMatchObject({
        ok: false,
        failure: { kind: "artifact" },
      });
      expect(result).not.toHaveProperty("class");
      expect(readFileSync(path.join(root, "AGENTS.md"), "utf8")).toBe(before);
    }
  });

  it("[SLICE-2:typed-failure] derives an approved AGENTS checkpoint from the stored TaskBoundary", async () => {
    const root = fixture();
    writeFileSync(path.join(root, "README.md"), "old docs\n");
    const activation = new Activation();
    activation.request();
    activation.activate();
    const runtime = new Runtime({
      activation,
      parentPayloadBridge: new PassthroughParentPayloadBridge(),
    });
    mockCandidateDelivery(runtime, root);
    const request = docsTaskRequest(
      snapshotFiles(root, ["README.md", "package.json"]),
    );
    const context = {
      cwd: root,
      model: {
        provider: "test-provider",
        id: "test-model",
        name: "test-model",
      },
      modelRegistry: {},
    };

    await admitGraph(runtime, [request], context as never);
    const red = await runtime.execute(
      "run",
      { request: taskAttemptFor(request) },
      context as never,
    );
    expect(red).toMatchObject({
      kind: "candidate",
      taskId: "docs-agents-checkpoint",
      requestId: "docs-agents-checkpoint:red:0",
      phase: "red",
      resultId: expect.any(String),
    });
    expect(JSON.stringify(red)).not.toContain("design-required");

    const worker = (runtime as any).registry.values()[0];
    worker.state = { kind: "ready", phase: "green", launchIndex: 0 };
    const green = await runtime.execute(
      "run",
      {
        request: greenAttempt(
          request,
          snapshotFiles(root, ["README.md", "package.json"]),
        ),
      },
      context as never,
    );
    expect(green).toMatchObject({
      kind: "candidate",
      taskId: "docs-agents-checkpoint",
      requestId: "docs-agents-checkpoint:green:0",
      phase: "green",
      resultId: expect.any(String),
    });
    worker.state = {
      kind: "agents-checkpoint-pending",
      finalPhase: "green",
      attemptIndex: 0,
    };
    const applied = await (runtime.execute as any)(
      "apply",
      {
        agentsCheckpoint: checkpointAttempt(
          root,
          managedDiff("README and environment routes"),
        ),
      },
      context,
    );

    expect(applied).toMatchObject({
      kind: "completed",
      taskId: "docs-agents-checkpoint",
      requestId: "docs-agents-checkpoint:checkpoint:0",
      finalPhase: "green",
      result: {
        target: "AGENTS.md",
        agentsImpact: "update-existing",
      },
    });
    expect(JSON.stringify(applied)).not.toContain("design-required");
  });

  it("[SLICE-2:typed-failure] rejects caller-restated checkpoint boundary facts before patch application", async () => {
    const root = fixture();
    const before = readFileSync(path.join(root, "AGENTS.md"), "utf8");
    const activation = new Activation();
    activation.request();
    activation.activate();
    const runtime = new Runtime({
      activation,
      parentPayloadBridge: new PassthroughParentPayloadBridge(),
    });
    pinCheckpointWorker(runtime, root);
    const attempt = checkpointAttempt(root, managedDiff("restated route"));
    let rejection: unknown;

    try {
      await (runtime.execute as any)(
        "apply",
        {
          agentsCheckpoint: {
            ...attempt,
            stage: "abel-implement",
            agentsImpact: "update-existing",
            agentsTarget: "AGENTS.md",
            agentsManagedOnly: true,
            stableCheckpoint: true,
          },
        },
        { cwd: root },
      );
    } catch (error) {
      rejection = error;
    }

    expect.soft(rejection).toBeInstanceOf(Error);
    expect(readFileSync(path.join(root, "AGENTS.md"), "utf8")).toBe(before);
  });

  it("rejects an AGENTS checkpoint outside the Worker's original workspace", async () => {
    const originalRoot = fixture();
    const otherRoot = fixture();
    const before = readFileSync(path.join(otherRoot, "AGENTS.md"), "utf8");
    const activation = new Activation();
    activation.request();
    activation.activate();
    const runtime = new Runtime({
      activation,
      parentPayloadBridge: new PassthroughParentPayloadBridge(),
    });
    pinCheckpointWorker(runtime, originalRoot);

    await expect(
      (runtime.execute as any)(
        "apply",
        {
          agentsCheckpoint: checkpointAttempt(
            otherRoot,
            managedDiff("wrong workspace route"),
          ),
        },
        { cwd: otherRoot },
      ),
    ).rejects.toThrow(/worker.*unavailable/i);
    expect(readFileSync(path.join(otherRoot, "AGENTS.md"), "utf8")).toBe(
      before,
    );
  });

  it("serializes AGENTS checkpoints behind the shared parent apply FIFO", async () => {
    const root = fixture();
    const activation = new Activation();
    activation.request();
    activation.activate();
    const runtime = new Runtime({
      activation,
      parentPayloadBridge: new PassthroughParentPayloadBridge(),
    });
    pinCheckpointWorker(runtime, root);
    let release!: () => void;
    (runtime as any).applyTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    let settled = false;

    const applying = (runtime.execute as any)(
      "apply",
      {
        agentsCheckpoint: checkpointAttempt(root, managedDiff("queued route")),
      },
      { cwd: root },
    ).then((result: unknown) => {
      settled = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(settled).toBe(false);
    expect(readFileSync(path.join(root, "AGENTS.md"), "utf8")).toContain(
      "- old route",
    );

    release();
    await expect(applying).resolves.toMatchObject({
      kind: "completed",
      taskId: "docs-agents-checkpoint",
      requestId: "docs-agents-checkpoint:checkpoint:0",
      finalPhase: "green",
    });
    expect(readFileSync(path.join(root, "AGENTS.md"), "utf8")).toContain(
      "- queued route",
    );
  });

  it("rejects an AGENTS checkpoint before checkpoint-pending", async () => {
    const root = fixture();
    const before = readFileSync(path.join(root, "AGENTS.md"), "utf8");
    const activation = new Activation();
    activation.request();
    activation.activate();
    const runtime = new Runtime({
      activation,
      parentPayloadBridge: new PassthroughParentPayloadBridge(),
    });
    pinCheckpointWorker(runtime, root);
    const worker = (runtime as any).registry.values()[0];
    worker.state = {
      kind: "ready",
      phase: "green",
      launchIndex: 0,
    };

    await expect(
      (runtime.execute as any)(
        "apply",
        {
          agentsCheckpoint: checkpointAttempt(
            root,
            managedDiff("too early route"),
          ),
        },
        { cwd: root },
      ),
    ).rejects.toThrow(/checkpoint.*pending/i);
    expect(readFileSync(path.join(root, "AGENTS.md"), "utf8")).toBe(before);
  });

  it("creates and removes only explicitly targeted managed indexes", async () => {
    const root = fixture();
    const nested = "docs/AGENTS.md";
    mkdirSync(path.join(root, "docs"));

    const create = [
      "--- /dev/null",
      `+++ b/${nested}`,
      "@@ -0,0 +1,3 @@",
      `+${START}`,
      "+- docs route",
      `+${END}`,
      "",
    ].join("\n");
    const created = await applyAgentsCheckpoint(root, {
      ...checkpoint(root, create, "create-index"),
      agentsTarget: nested,
      snapshot: snapshotFiles(root, [nested]),
    });
    expect(created).toMatchObject({ ok: true, agentsImpact: "create-index" });

    const remove = [
      `--- a/${nested}`,
      "+++ /dev/null",
      "@@ -1,3 +0,0 @@",
      `-${START}`,
      "-- docs route",
      `-${END}`,
      "",
    ].join("\n");
    const removed = await applyAgentsCheckpoint(root, {
      ...checkpoint(root, remove, "remove-index"),
      agentsTarget: nested,
      snapshot: snapshotFiles(root, [nested]),
    });
    expect(removed).toMatchObject({ ok: true, agentsImpact: "remove-index" });
  });
});

describe("[SLICE-3:terminal-replay] bounded AGENTS checkpoint state", () => {
  it("enters checkpoint attempt zero after the final candidate is exactly applied", async () => {
    const { root, worker, applied } = await finalCandidateFixture();

    expect(applied).toMatchObject({
      kind: "checkpoint-required",
      taskId: "docs-agents-checkpoint",
      requestId: "docs-agents-checkpoint:apply:final",
      finalPhase: "green",
    });
    expect(readFileSync(path.join(root, "README.md"), "utf8")).toBe(
      "approved docs\n",
    );
    expect(worker.state).toEqual({
      kind: "agents-checkpoint-pending",
      finalPhase: "green",
      attemptIndex: 0,
    });
  });

  it.each(["artifact", "stale"] as const)(
    "bounds two typed %s checkpoint failures independently from child launches",
    async (failureKind) => {
      const { root, runtime, worker } = await finalCandidateFixture();
      const failingAttempt = (attemptIndex: number) => {
        const snapshot = snapshotFiles(root, ["AGENTS.md"]);
        if (failureKind === "stale") {
          writeFileSync(
            path.join(root, "AGENTS.md"),
            `${readFileSync(path.join(root, "AGENTS.md"), "utf8")}stale-${attemptIndex}\n`,
          );
        }
        return {
          ...checkpointAttempt(
            root,
            failureKind === "artifact"
              ? invalidManagedDiff(`invalid route ${attemptIndex}`)
              : managedDiff(`stale route ${attemptIndex}`),
          ),
          requestId: `docs-agents-checkpoint:checkpoint:${attemptIndex}`,
          snapshot,
        };
      };

      const first = await (runtime.execute as any)(
        "apply",
        { agentsCheckpoint: failingAttempt(0) },
        runtimeContext(root),
      );

      expect(first).toMatchObject({
        kind: "retry",
        taskId: "docs-agents-checkpoint",
        requestId: "docs-agents-checkpoint:checkpoint:0",
        phase: "green",
        scope: "checkpoint",
        cause: failureKind,
        remainingAttempts: 1,
      });
      expect.soft(worker.state).toEqual({
        kind: "agents-checkpoint-pending",
        finalPhase: "green",
        attemptIndex: 1,
      });

      const second = await (runtime.execute as any)(
        "apply",
        { agentsCheckpoint: failingAttempt(1) },
        runtimeContext(root),
      );

      expect(second).toMatchObject({
        kind: "blocked",
        taskId: "docs-agents-checkpoint",
        requestId: "docs-agents-checkpoint:checkpoint:1",
        phase: "green",
        failure: {
          kind: "checkpoint-attempts-exhausted",
          cause: failureKind,
          attemptsUsed: 2,
          lastFailure:
            failureKind === "artifact"
              ? {
                  code: "git-apply-check-failed",
                  stage: "agents-checkpoint",
                }
              : { code: "stale-snapshot", stage: "agents-checkpoint" },
        },
      });
      expect(worker.state).toEqual({
        kind: "blocked",
        phase: "green",
        failure: {
          kind: "checkpoint-attempts-exhausted",
          cause: failureKind,
          attemptsUsed: 2,
          lastFailure:
            failureKind === "artifact"
              ? {
                  code: "git-apply-check-failed",
                  stage: "agents-checkpoint",
                }
              : { code: "stale-snapshot", stage: "agents-checkpoint" },
        },
      });
    },
  );

  it("preserves checkpoint attempt zero when cancellation arrives before work", async () => {
    const { root, runtime, worker } = await finalCandidateFixture();
    const before = structuredClone(worker.state);
    expect.soft(before).toEqual({
      kind: "agents-checkpoint-pending",
      finalPhase: "green",
      attemptIndex: 0,
    });
    const controller = new AbortController();
    controller.abort(new Error("cancel checkpoint"));

    const cancelled = await (runtime.execute as any)(
      "apply",
      {
        agentsCheckpoint: checkpointAttempt(
          root,
          managedDiff("cancelled route"),
        ),
      },
      runtimeContext(root),
      controller.signal,
    );

    expect(cancelled).toEqual({
      kind: "cancelled",
      taskId: "docs-agents-checkpoint",
      requestId: "docs-agents-checkpoint:checkpoint:0",
      phase: "green",
    });
    expect(worker.state).toEqual(before);
  });

  it("terminally blocks checkpoint environment failure without a retry", async () => {
    const { root, runtime, worker } = await finalCandidateFixture();
    const bin = path.join(root, "checkpoint-bin");
    const wrapper = path.join(bin, "git");
    const originalPath = process.env.PATH;
    const realGit = execFileSync("sh", ["-c", "command -v git"], {
      encoding: "utf8",
    }).trim();
    mkdirSync(bin);
    writeFileSync(
      wrapper,
      [
        "#!/bin/sh",
        'if [ "$PWD" = "$CADENCE_CHECKPOINT_TEST_ROOT" ] && [ "$*" = "apply --recount --whitespace=nowarn -" ]; then',
        "  exit 1",
        "fi",
        'exec "$CADENCE_CHECKPOINT_REAL_GIT" "$@"',
        "",
      ].join("\n"),
    );
    chmodSync(wrapper, 0o755);
    process.env.PATH = `${bin}:${originalPath ?? ""}`;
    process.env.CADENCE_CHECKPOINT_REAL_GIT = realGit;
    process.env.CADENCE_CHECKPOINT_TEST_ROOT = root;

    try {
      const blocked = await (runtime.execute as any)(
        "apply",
        {
          agentsCheckpoint: checkpointAttempt(
            root,
            managedDiff("environment route"),
          ),
        },
        runtimeContext(root),
      );

      expect(blocked).toMatchObject({
        kind: "blocked",
        taskId: "docs-agents-checkpoint",
        requestId: "docs-agents-checkpoint:checkpoint:0",
        phase: "green",
        failure: { kind: "environment", code: "git-apply-failed" },
      });
      expect(worker.state).toEqual({
        kind: "blocked",
        phase: "green",
        failure: { kind: "environment", code: "git-apply-failed" },
      });
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
      delete process.env.CADENCE_CHECKPOINT_REAL_GIT;
      delete process.env.CADENCE_CHECKPOINT_TEST_ROOT;
    }
  });

  it("completes only after the managed checkpoint succeeds", async () => {
    const { root, runtime, worker } = await finalCandidateFixture();

    const completed = await (runtime.execute as any)(
      "apply",
      {
        agentsCheckpoint: checkpointAttempt(
          root,
          managedDiff("completed route"),
        ),
      },
      runtimeContext(root),
    );

    expect(completed).toMatchObject({
      kind: "completed",
      taskId: "docs-agents-checkpoint",
      requestId: "docs-agents-checkpoint:checkpoint:0",
      finalPhase: "green",
    });
    expect(worker.state).toEqual({
      kind: "completed",
      finalPhase: "green",
    });
    expect(readFileSync(path.join(root, "AGENTS.md"), "utf8")).toContain(
      "- completed route",
    );
  });

  it("throws a checkpoint before pending without changing task state", async () => {
    const root = fixture();
    const runtime = runtimeFixture();
    const request = docsTaskRequest(
      snapshotFiles(root, ["README.md", "package.json"]),
    );
    const worker = (runtime as any).registry.open(
      request.boundary,
      workerIdentity({ provider: "test-provider", id: "test-model" }),
      root,
      request.attempt,
    );
    const before = structuredClone(worker.state);

    await expect(
      (runtime.execute as any)(
        "apply",
        {
          agentsCheckpoint: checkpointAttempt(
            root,
            managedDiff("too early route"),
          ),
        },
        runtimeContext(root),
      ),
    ).rejects.toThrow(/checkpoint|transition|pending/i);
    expect(worker.state).toEqual(before);
  });

  it.each(["schema", "identity", "target"] as const)(
    "throws a %s-mismatched checkpoint without changing pending state",
    async (mismatch) => {
      const { root, runtime, worker } = await finalCandidateFixture();
      const before = structuredClone(worker.state);
      const valid = checkpointAttempt(root, managedDiff("protocol route"));
      const agentsCheckpoint =
        mismatch === "schema"
          ? { ...valid, stableCheckpoint: true }
          : mismatch === "identity"
            ? { ...valid, taskId: "different-task" }
            : {
                ...valid,
                snapshot: snapshotFiles(root, ["README.md"]),
              };

      await expect(
        (runtime.execute as any)(
          "apply",
          { agentsCheckpoint },
          runtimeContext(root),
        ),
      ).rejects.toThrow(/protocol|identity|target|checkpoint/i);
      expect(worker.state).toEqual(before);
    },
  );

  it("replays completion with the current request identity and starts no work", async () => {
    const { root, runtime, request, worker } = await finalCandidateFixture();
    await (runtime.execute as any)(
      "apply",
      {
        agentsCheckpoint: checkpointAttempt(
          root,
          managedDiff("replayed completion route"),
        ),
      },
      runtimeContext(root),
    );
    const before = structuredClone(worker.state);
    const staleSnapshot = snapshotFiles(root, ["README.md", "package.json"]);
    writeFileSync(path.join(root, "README.md"), "changed after completion\n");
    const dispatch = vi.spyOn(runtime as any, "dispatchChild");
    dispatch.mockClear();
    const checkpoint = vi.spyOn(runtime as any, "performAgentsCheckpoint");
    const requestId = "docs-agents-checkpoint:green:terminal-replay";
    const replay = {
      ...greenAttempt(request, staleSnapshot),
      attempt: {
        ...greenAttempt(request, staleSnapshot).attempt,
        requestId,
      },
    };

    const result = await (runtime.execute as any)(
      "run",
      { request: replay },
      runtimeContext(root),
    );

    expect(result).toEqual({
      kind: "completed",
      taskId: "docs-agents-checkpoint",
      requestId,
      finalPhase: "green",
    });
    expect(worker.state).toEqual(before);
    expect(dispatch).not.toHaveBeenCalled();
    expect(checkpoint).not.toHaveBeenCalled();
  });
});

describe("[SLICE-4:task-lifetime-conflict] parent-owned AGENTS admission", () => {
  it("defers an AGENTS-target conflict during checkpoint review without queue, child, or registry side effects", async () => {
    const root = fixture();
    writeFileSync(path.join(root, "README.md"), "owner docs\n");
    writeFileSync(path.join(root, "CHANGELOG.md"), "contender docs\n");
    const runtime = runtimeFixture();
    const dispatch = mockCandidateDelivery(runtime, root);
    const schedule = vi.spyOn((runtime as any).scheduler, "schedule");
    const ownerRequest = docsTaskRequest(
      snapshotFiles(root, ["README.md", "package.json"]),
      {
        taskId: "agents-owner",
        document: "README.md",
      },
    );
    const contenderRequest = docsTaskRequest(
      snapshotFiles(root, ["CHANGELOG.md", "package.json"]),
      { taskId: "agents-contender", document: "CHANGELOG.md" },
    );
    await admitGraph(
      runtime,
      [ownerRequest, contenderRequest],
      runtimeContext(root),
    );

    const admitted = await (runtime.execute as any)(
      "run",
      { request: taskAttemptFor(ownerRequest) },
      runtimeContext(root),
    );

    expect(admitted).toMatchObject({
      kind: "candidate",
      taskId: "agents-owner",
      requestId: "agents-owner:red:0",
      phase: "red",
      resultId: expect.any(String),
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    const ownerEnvelope = dispatch.mock.calls[0]?.[1] as {
      declared: { read: string[]; write: string[] };
    };
    expect(ownerEnvelope.declared.read).toEqual(["README.md", "package.json"]);
    expect(ownerEnvelope.declared.write).toEqual(["README.md"]);
    expect([
      ...ownerEnvelope.declared.read,
      ...ownerEnvelope.declared.write,
    ]).not.toContain("AGENTS.md");

    const registry = (runtime as any).registry;
    const owner = registry.values()[0];
    expect(owner.conflict.write).toContain("AGENTS.md");
    owner.state = {
      kind: "agents-checkpoint-pending",
      finalPhase: "green",
      attemptIndex: 0,
    };
    const callsBefore = {
      child: dispatch.mock.calls.length,
      scheduler: schedule.mock.calls.length,
      registry: registry.values().length,
      sequence: (runtime as any).batchSeq,
    };

    const deferred = await (runtime.execute as any)(
      "run",
      { request: taskAttemptFor(contenderRequest) },
      runtimeContext(root),
    );

    expect.soft(deferred).toMatchObject({
      kind: "deferred",
      taskId: "agents-contender",
      requestId: "agents-contender:red:0",
      reason: "task-conflict",
    });
    expect.soft(dispatch).toHaveBeenCalledTimes(callsBefore.child);
    expect.soft(schedule).toHaveBeenCalledTimes(callsBefore.scheduler);
    expect.soft(registry.values()).toHaveLength(callsBefore.registry);
    expect.soft((runtime as any).batchSeq).toBe(callsBefore.sequence);
    expect.soft(registry.find(root, "agents-contender")).toBeUndefined();
    expect(owner.state).toEqual({
      kind: "agents-checkpoint-pending",
      finalPhase: "green",
      attemptIndex: 0,
    });
  });

  it.each(["blocked", "completed"] as const)(
    "releases the AGENTS-target conflict when the owner is %s",
    async (terminal) => {
      const root = fixture();
      writeFileSync(path.join(root, "README.md"), "owner docs\n");
      writeFileSync(path.join(root, "CHANGELOG.md"), "contender docs\n");
      const runtime = runtimeFixture();
      const dispatch = mockCandidateDelivery(runtime, root);
      const ownerRequest = docsTaskRequest(
        snapshotFiles(root, ["README.md", "package.json"]),
        {
          taskId: `agents-${terminal}`,
          document: "README.md",
        },
      );
      const contenderRequest = docsTaskRequest(
        snapshotFiles(root, ["CHANGELOG.md", "package.json"]),
        { taskId: `after-${terminal}`, document: "CHANGELOG.md" },
      );
      await admitGraph(
        runtime,
        [ownerRequest, contenderRequest],
        runtimeContext(root),
      );
      const owner = (runtime as any).registry.open(
        ownerRequest.boundary,
        workerIdentity({ provider: "test-provider", id: "test-model" }),
        root,
        ownerRequest.attempt,
      );
      owner.state =
        terminal === "blocked"
          ? {
              kind: "blocked",
              phase: "red",
              failure: {
                kind: "approval-boundary",
                code: "task-scope-insufficient",
              },
            }
          : { kind: "completed", finalPhase: "green" };
      const admitted = await (runtime.execute as any)(
        "run",
        { request: taskAttemptFor(contenderRequest) },
        runtimeContext(root),
      );

      expect(admitted).toMatchObject({
        kind: "candidate",
        taskId: `after-${terminal}`,
        requestId: `after-${terminal}:red:0`,
        phase: "red",
        resultId: expect.any(String),
      });
      expect(JSON.stringify(admitted)).not.toContain("deferred");
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect((runtime as any).registry.values()).toHaveLength(2);
    },
  );
});
