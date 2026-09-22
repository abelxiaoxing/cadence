import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  options: undefined as any,
  diagnostics: [] as any[],
  result: undefined as any,
}));
vi.mock("../src/workflow-engine.ts", () => ({
  openDurableWorkflowEngine: (options: any) => {
    harness.options = options;
    return {
      close() {},
      async execute() {
        await options.verifyPhase({
          root: ".",
          verification: {},
          signal: new AbortController().signal,
        });
        await options.proposeCandidate({});
        return { state: "paused" };
      },
    };
  },
}));
vi.mock("../src/package-verification.ts", async (original) => ({
  ...(await original<any>()),
  executePackageVerification: async () => harness.result,
}));
vi.mock("../src/package-candidate.ts", () => ({
  proposePackageCandidate: async (
    _input: any,
    _context: any,
    _agent: any,
    diagnostics: any,
  ) => {
    harness.diagnostics.push(diagnostics);
    return { kind: "paused", code: "test" };
  },
}));

import { openPackageWorkflowService } from "../src/package-workflow.ts";

const roots: string[] = [];
afterEach(() => {
  roots.splice(0).forEach((root) => {
    rmSync(root, { recursive: true, force: true });
  });
  vi.unstubAllEnvs();
  harness.diagnostics = [];
});
it("delivers a failure summary to the next candidate and clears it for a later successful operation", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "cadence-feedback-wiring-"));
  roots.push(root);
  const state = mkdtempSync(path.join(tmpdir(), "cadence-feedback-state-"));
  roots.push(state);
  vi.stubEnv("XDG_STATE_HOME", state);
  const service = openPackageWorkflowService({
    cwd: root,
    modelRegistry: {
      getProvider: () => undefined,
      getApiKeyAndHeaders: async () => ({ ok: false }),
    },
  });
  const evidence = {
    id: "test",
    exitCode: 1,
    classification: "expected-green",
    failureIdentities: ["a".repeat(64)],
    policy: "report-file-v3",
  };
  harness.result = {
    kind: "rejected",
    code: "verification-rejected",
    evidence,
    diagnostic: {
      verificationId: "test",
      code: "verification-rejected",
      stdout: "",
      stderr: "expected 2, received 1",
      failures: ["adds integers"],
      truncated: false,
      nextStep: "repair candidate",
    },
  };
  try {
    const result = await service.execute({
      stage: "abel-implement",
      command: "start",
      change: "feedback",
      operationId: "one",
    });
    expect(harness.diagnostics[0][0].stderr).toBe("expected 2, received 1");
    expect(result.verificationDiagnostics).toEqual(harness.diagnostics[0]);
    harness.result = {
      kind: "accepted",
      evidence: { ...evidence, exitCode: 0 },
    };
    await service.execute({
      stage: "abel-implement",
      command: "resume",
      change: "feedback",
      operationId: "two",
    });
    expect(harness.diagnostics[1]).toEqual([]);
  } finally {
    await service.close();
  }
});

it("projects a reset notice on real Design start and retains the versioned run on reopen", async () => {
  const { RunStore } = await import("../src/run-store.ts");
  const { resolveStateRoot } = await import("../src/state-root.ts");
  const root = mkdtempSync(path.join(tmpdir(), "cadence-reset-wiring-"));
  roots.push(root);
  const stateHome = mkdtempSync(path.join(tmpdir(), "cadence-reset-state-"));
  roots.push(stateHome);
  vi.stubEnv("XDG_STATE_HOME", stateHome);
  const state = resolveStateRoot({
    consumerRoot: root,
    xdgStateHome: stateHome,
  });
  RunStore.open(state).close();
  const context = {
    cwd: root,
    modelRegistry: {
      getProvider: () => undefined,
      getApiKeyAndHeaders: async () => ({ ok: false as const }),
    },
  };
  let service = openPackageWorkflowService(context);
  const request = {
    operation: "start",
    operationId: "reset-start",
    requirement: "Verify version reset without touching repository files",
  };
  let runId: unknown;
  try {
    const result = await service.executeDesign(request);
    runId = result.runId;
    expect(result).toMatchObject({
      state: "paused",
      packageStateReset: {
        reason: "unversioned-store",
        previousVersion: null,
        backupPath: expect.any(String),
      },
    });
    expect(() => openPackageWorkflowService(context)).toThrow(
      "package-state-in-use",
    );
  } finally {
    await service.close();
  }
  service = openPackageWorkflowService(context);
  try {
    const result = await service.executeDesign(request);
    expect(result.runId).toBe(runId);
    expect(result.packageStateReset).toBeUndefined();
  } finally {
    await service.close();
  }
});

it("releases package ownership and the Design connection when service initialization fails", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "cadence-reset-open-failure-"));
  roots.push(root);
  const stateHome = mkdtempSync(
    path.join(tmpdir(), "cadence-reset-open-failure-state-"),
  );
  roots.push(stateHome);
  vi.stubEnv("XDG_STATE_HOME", stateHome);
  vi.stubEnv("ABEL_WORK_MAX_UNITS", "invalid");
  const context = {
    cwd: root,
    modelRegistry: {
      getProvider: () => undefined,
      getApiKeyAndHeaders: async () => ({ ok: false as const }),
    },
  };
  expect(() => openPackageWorkflowService(context)).toThrow(
    "verification-host-limit-invalid",
  );
  vi.stubEnv("ABEL_WORK_MAX_UNITS", "512");
  await openPackageWorkflowService(context).close();
});
