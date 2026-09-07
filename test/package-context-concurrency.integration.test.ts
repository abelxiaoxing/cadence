import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  active: false,
  started: undefined as (() => void) | undefined,
  release: Promise.resolve() as Promise<void>,
  observedContext: undefined as Record<string, unknown> | undefined,
  routePolicies: [] as Record<string, any>[],
}));

vi.mock("../src/parent-provider.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/parent-provider.ts")>();
  return {
    ...actual,
    runtimeForWorkerRoute: async (
      _route: unknown,
      context: Record<string, unknown>,
    ) => {
      harness.observedContext = context;
      return {
        ok: false as const,
        error: "context captured",
        failure: {
          kind: "environment" as const,
          code: "context-captured",
        },
      };
    },
  };
});

vi.mock("../src/workflow-engine.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/workflow-engine.ts")>();
  return {
    ...actual,
    openDurableWorkflowEngine: (options: Record<string, any>) => ({
      updateRoutePolicy(policy: Record<string, any>) {
        harness.routePolicies.push(policy);
      },
      routePolicyStatus: () => ({}),
      async execute(command: Record<string, unknown>) {
        if (harness.active) throw new Error("operation-already-running");
        harness.active = true;
        harness.started?.();
        await harness.release;
        try {
          await options.proposeCandidate({
            runId: "run-context-isolation",
            operationId: command.operationId,
            deliveryRevision: 1,
            taskId: "context-task",
            phase: "red",
            task: {},
            workspaceRoot: ".",
            ledgerProjection: {},
            candidateArtifact: {},
            route: {
              id: "inherited",
              kind: "inherited",
              fingerprint: "a".repeat(64),
              capabilities: {
                roles: ["implementation-worker"],
                dialects: ["openai-responses"],
                contextWindow: 256_000,
                maxTokens: 128_000,
              },
            },
            signal: new AbortController().signal,
            onHeaders() {},
            onProgress() {},
          });
          return { state: "paused", completed: false };
        } catch (error) {
          return {
            state: "paused",
            completed: false,
            pause: {
              code: error instanceof Error ? error.message : "unknown",
            },
          };
        } finally {
          harness.active = false;
        }
      },
      close() {},
    }),
  };
});

const roots: string[] = [];

afterEach(() => {
  harness.active = false;
  harness.started = undefined;
  harness.release = Promise.resolve();
  harness.observedContext = undefined;
  harness.routePolicies = [];
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("package operation context isolation", () => {
  it("refreshes the default inherited route from the owning model bounds", async () => {
    const module = await import("../src/index.ts");
    const consumerRoot = mkdtempSync(
      path.join(tmpdir(), "cadence-parent-bounds-consumer-"),
    );
    const stateRoot = mkdtempSync(
      path.join(tmpdir(), "cadence-parent-bounds-state-"),
    );
    roots.push(consumerRoot, stateRoot);
    const previousStateHome = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = stateRoot;
    const engine = module.openPackageWorkflowControlEngine({
      cwd: consumerRoot,
      model: { contextWindow: 256_000, maxTokens: 128_000 },
    } as never);

    try {
      await engine.execute(
        {
          command: "start",
          stage: "abel-implement",
          change: "parent-bounds",
          operationId: "parent-bounds-start",
        },
        {
          cwd: consumerRoot,
          model: { contextWindow: 32_768, maxTokens: 8_192 },
        } as never,
      );
      expect(
        harness.routePolicies.at(-1)?.routes.parent.capabilities,
      ).toMatchObject({ contextWindow: 32_768, maxTokens: 8_192 });
    } finally {
      await engine.close();
      if (previousStateHome === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = previousStateHome;
    }
  });

  it("keeps the owning context when an idempotent retry overlaps", async () => {
    const module = await import("../src/index.ts");
    const consumerRoot = mkdtempSync(
      path.join(tmpdir(), "cadence-context-consumer-"),
    );
    const stateRoot = mkdtempSync(
      path.join(tmpdir(), "cadence-context-state-"),
    );
    roots.push(consumerRoot, stateRoot);
    const previousStateHome = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = stateRoot;
    let release!: () => void;
    harness.release = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const executionStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    harness.started = started;
    const engine = module.openPackageWorkflowControlEngine({
      cwd: consumerRoot,
    } as never);
    const command = {
      command: "start",
      stage: "abel-implement",
      change: "context-isolation",
      operationId: "shared-operation",
    };
    const owner = { cwd: consumerRoot, marker: "owner" };
    const retry = { cwd: consumerRoot, marker: "retry" };

    try {
      const running = engine.execute(command, owner as never);
      await executionStarted;
      await expect(engine.execute(command, retry as never)).rejects.toThrow(
        /operation-already-running/u,
      );
      release();
      await expect(running).resolves.toMatchObject({
        state: "paused",
        pause: { code: "context-captured" },
      });
      expect(harness.observedContext).toBe(owner);
    } finally {
      release();
      await engine.close();
      if (previousStateHome === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = previousStateHome;
    }
  });
});
