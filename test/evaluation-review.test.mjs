import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  matrixPassed,
  matrixScenarios,
} from "../scripts/evaluation-matrix-policy.mjs";
import { verifyEvaluationOracle } from "../scripts/evaluation-oracle.mjs";
import { evaluationScenarios } from "../scripts/workflow-evaluation.mjs";

afterEach(() => vi.unstubAllEnvs());
it("keeps missing-capability observations out of the release gate", () => {
  expect(matrixScenarios(evaluationScenarios).map((s) => s.id)).toEqual([
    "small-fix",
    "multiple-tasks",
    "restart-recovery",
  ]);
  expect(matrixScenarios(evaluationScenarios, true)).toHaveLength(4);
  const results = [
    { expected: "completed", exitCode: 0, report: { success: true } },
    { expected: "blocked", exitCode: 1, report: { success: false } },
  ];
  expect(matrixPassed(results, true)).toBe(true);
  results[0].report.success = false;
  expect(matrixPassed(results, true)).toBe(false);
});
it
  .skipIf(process.env.CADENCE_REAL_ISOLATION !== "1")
  .each(["isolated", "local-trusted"])(
  "checks correct and incorrect product bytes with the %s oracle without a model",
  async (mode) => {
    vi.stubEnv("ABEL_EXECUTION_MODE", mode);
    const root = mkdtempSync(path.join(tmpdir(), "cadence-oracle-regression-"));
    const consumer = path.join(root, "consumer");
    mkdirSync(path.join(consumer, "src"), { recursive: true });
    const file = path.join(consumer, "src/math.mjs");
    try {
      writeFileSync(
        file,
        "export const add=(a,b)=>a+b;export const multiply=(a,b)=>a*b;",
      );
      await verifyEvaluationOracle(
        consumer,
        "multiple-tasks",
        new AbortController().signal,
      );
      writeFileSync(
        file,
        "export const add=(a,b)=>0;export const multiply=(a,b)=>a*b;",
      );
      await expect(
        verifyEvaluationOracle(
          consumer,
          "small-fix",
          new AbortController().signal,
        ),
      ).rejects.toThrow("evaluation-oracle-rejected");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
