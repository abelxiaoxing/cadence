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
      updateRoutePolicy() {},
      routePolicyStatus: () => ({}),
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
