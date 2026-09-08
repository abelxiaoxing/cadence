import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { matrixPassed, matrixScenarios } from "./evaluation-matrix-policy.mjs";
import { evaluationScenarios } from "./workflow-evaluation.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const live = args.includes("--live");
const repeats = Number(option("--repeats", "1"));
if (!Number.isSafeInteger(repeats) || repeats < 1 || repeats > 10)
  throw new Error("repeats must be 1..10");
const timeoutMs = Number(option("--timeout-ms", "600000"));
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 1800000)
  throw new Error("invalid timeout");
const root = mkdtempSync(path.join(tmpdir(), "cadence-evaluation-matrix-"));
const results = [];
try {
  for (const scenario of matrixScenarios(
    evaluationScenarios,
    args.includes("--include-observations"),
  ))
    for (let attempt = 1; attempt <= repeats; attempt++) {
      const output = path.join(root, "report.json");
      rmSync(output, { force: true });
      const child = spawnSync(
        process.execPath,
        [
          "--experimental-strip-types",
          path.join(import.meta.dirname, "evaluate-workflow.mjs"),
          "--scenario",
          scenario.id,
          "--output",
          output,
          "--timeout-ms",
          String(timeoutMs),
          ...(live ? ["--live"] : []),
          ...(option("--model") ? ["--model", option("--model")] : []),
        ],
        {
          timeout: timeoutMs + 60000,
          encoding: "utf8",
          maxBuffer: 1024 * 1024,
        },
      );
      let report;
      try {
        report = JSON.parse(readFileSync(output, "utf8"));
      } catch {
        report = {
          success: false,
          reason: child.error?.code ?? "report-unavailable",
        };
      }
      results.push({
        scenario: scenario.id,
        expected: scenario.expected ?? "completed",
        attempt,
        exitCode: child.status,
        report,
      });
    }
  const measured = results.map(({ report }) => report);
  const completionRuns = results.filter(
    (entry) => entry.expected === "completed",
  );
  const summary = {
    mode: live ? "live-model" : "preflight",
    runs: results.length,
    completionRate: live
      ? completionRuns.filter((entry) => entry.report.success === true).length /
        completionRuns.length
      : null,
    elapsedMs: measured.reduce((n, r) => n + (r.elapsedMs ?? 0), 0),
    tokens: measured.reduce((n, r) => n + (r.tokens ?? 0), 0),
    cost: measured.reduce((n, r) => n + (r.cost ?? 0), 0),
    repeatedAmendments: measured.reduce(
      (n, r) => n + (r.repeatedAmendments ?? 0),
      0,
    ),
    capabilityObservations: results
      .filter((entry) => entry.expected === "blocked")
      .map((entry) => ({
        scenario: entry.scenario,
        reason: entry.report.reason,
        completed: entry.report.success === true,
        assessment:
          "observation-only; a stall is not proof of correct recovery",
      })),
    results,
  };
  const serialized = `${JSON.stringify(summary, null, 2)}\n`;
  if (option("--output")) writeFileSync(option("--output"), serialized);
  console.log(serialized);
  if (!matrixPassed(results, live)) process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
