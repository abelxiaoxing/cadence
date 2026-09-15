import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { BubblewrapIsolationBackend } from "../src/isolation-backend.ts";
import {
  changeVerificationResult,
  executePackageVerification,
  phaseVerificationResult,
} from "../src/package-verification.ts";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

it.each([
  ["absent", "input-missing"],
  ["unsafe", "input-unsafe"],
] as const)(
  "preserves a structured %s input observation through verification adapters",
  async (kind, code) => {
    const root = mkdtempSync(path.join(tmpdir(), "cadence-input-test-"));
    roots.push(root);
    if (kind === "unsafe") {
      const outsideRoot = mkdtempSync(
        path.join(tmpdir(), "cadence-outside-input-test-"),
      );
      roots.push(outsideRoot);
      const outside = path.join(outsideRoot, "future.test.js");
      writeFileSync(outside, "export {};\n");
      symlinkSync(outside, path.join(root, "future.test.js"));
    }
    const result = await executePackageVerification({
      root,
      dependencyOwner: path.resolve(import.meta.dirname, ".."),
      verification: {
        kind: "vitest",
        id: "input-observation",
        runner: { kind: "local-binary", executable: "vitest" },
        testFiles: ["future.test.js"],
        args: [],
        minTests: 1,
        classification: "expected-green",
      },
      signal: new AbortController().signal,
    });
    const expected = {
      ok: false,
      code,
      inputObservation: { path: "future.test.js", kind },
    };
    expect(result).toMatchObject({
      kind: "unavailable",
      category: "adapter",
      verificationId: "input-observation",
      code,
      inputObservation: expected.inputObservation,
    });
    expect(phaseVerificationResult(result)).toMatchObject({
      ...expected,
      kind: "paused",
    });
    expect(changeVerificationResult(result)).toMatchObject({
      ...expected,
      kind: "verification-adapter",
    });
  },
);

it.each([
  "missing",
  "malformed",
  "symlink",
  "oversized",
  "contradictory",
  "runtime-error",
  "count-mismatch",
])(
  "classifies a %s report as unavailable rather than a product failure",
  async (defect) => {
    const root = mkdtempSync(path.join(tmpdir(), "cadence-report-test-"));
    roots.push(root);
    writeFileSync(path.join(root, "sample.test.js"), "export {};\n");
    vi.spyOn(BubblewrapIsolationBackend.prototype, "run").mockImplementation(
      async (input) => {
        const scratch = input.mounts?.find(
          (mount) => mount.target === "/cadence",
        )?.source;
        if (!scratch) throw new Error("missing scratch mount");
        const target = path.join(scratch, "reports/0.json");
        const report = {
          numTotalTests: defect === "count-mismatch" ? 2 : 1,
          numFailedTests: 0,
          success: true,
          testResults: [
            {
              name: "/workspace/sample.test.js",
              assertionResults: [{ status: "passed", fullName: "passes" }],
            },
          ],
          ...(defect === "runtime-error"
            ? { numRuntimeErrorTestSuites: 1 }
            : {}),
        };
        if (defect === "symlink") {
          writeFileSync(
            path.join(root, "outside.json"),
            JSON.stringify(report),
          );
          symlinkSync(path.join(root, "outside.json"), target);
        } else if (defect !== "missing") {
          writeFileSync(
            target,
            defect === "malformed"
              ? "{"
              : defect === "oversized"
                ? "x".repeat(1025)
                : JSON.stringify(report),
          );
        }
        return {
          ok: true,
          state: "completed",
          exitCode: defect === "contradictory" ? 1 : 0,
          stdout: "ordinary log",
          stderr: "",
          logs: {
            stdout: { bytes: 12, truncated: false },
            stderr: { bytes: 0, truncated: false },
          },
        };
      },
    );
    const result = await executePackageVerification({
      root,
      dependencyOwner: path.resolve(import.meta.dirname, ".."),
      verification: {
        kind: "vitest",
        id: "report-check",
        runner: { kind: "local-binary", executable: "vitest" },
        testFiles: ["sample.test.js"],
        args: [],
        minTests: 1,
        classification: "expected-green",
      },
      maxReportBytes: 1024,
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      kind: "unavailable",
      category: defect === "oversized" ? "resource" : "adapter",
    });
    expect(result).not.toHaveProperty("evidence");
  },
);

it("identifies the execution obligation independently of display IDs", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "cadence-failure-identity-"));
  roots.push(root);
  for (const script of ["failure.mjs", "other.mjs"])
    writeFileSync(path.join(root, script), "process.exitCode = 1;\n");
  vi.spyOn(BubblewrapIsolationBackend.prototype, "run").mockResolvedValue({
    ok: true,
    state: "completed",
    exitCode: 1,
    stdout: "existing failure",
    stderr: "",
    logs: {
      stdout: { bytes: 16, truncated: false },
      stderr: { bytes: 0, truncated: false },
    },
  });
  const identify = async (
    id: string,
    script = "failure.mjs",
    args: string[] = [],
  ) => {
    const result = await executePackageVerification({
      root,
      dependencyOwner: root,
      signal: new AbortController().signal,
      verification: {
        kind: "static-check",
        id,
        runner: { kind: "node", script },
        args,
        classification: "expected-green",
      },
    });
    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") throw new Error("missing failure evidence");
    return result.evidence.failureIdentities;
  };
  const baseline = await identify("baseline-full");
  expect(await identify("change-full")).toEqual(baseline);
  expect(await identify("baseline-full", "other.mjs")).not.toEqual(baseline);
  expect(
    await identify("baseline-full", "failure.mjs", ["--strict"]),
  ).not.toEqual(baseline);
});
