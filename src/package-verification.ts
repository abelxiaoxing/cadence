import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import path from "node:path";
import {
  type AtomicVerificationContract,
  type StructuredVerificationContract,
  type VerificationObservation,
  verificationSteps,
} from "./contracts.ts";
import { canonicalJson } from "./implement-graph.ts";
import { BubblewrapIsolationBackend } from "./isolation-backend.ts";
import { observeSafePath } from "./safe-path.ts";
import {
  bindCurrentVerificationCapability,
  isVerificationCapabilityCurrent,
  type VerificationRunnerBinding,
} from "./verification-capability.ts";
import { prepareVerificationEnvironment } from "./verification-environment.ts";

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function packageScriptInvocation(
  packageManager: string,
  script: string,
  args: string[],
): string[] {
  return packageManager === "npm"
    ? ["run", script, "--", ...args]
    : ["run", script, ...args];
}

function bindingFor(
  bindings: readonly VerificationRunnerBinding[],
  command: string,
): VerificationRunnerBinding | undefined {
  return bindings.find((binding) => binding.command === command);
}

function verificationInvocation(
  step: AtomicVerificationContract,
  bindings: readonly VerificationRunnerBinding[],
  reportFile: string,
): { executable: string; args: string[] } | undefined {
  const reporter =
    step.kind === "vitest"
      ? ["--reporter=json", `--outputFile.json=${reportFile}`]
      : [];
  if (step.kind === "package-script") {
    const binding = bindingFor(bindings, step.packageManager);
    return binding
      ? {
          executable: binding.executablePath,
          args: [
            ...(binding.fixedArgs ?? []),
            ...packageScriptInvocation(
              step.packageManager,
              step.script,
              step.args,
            ),
          ],
        }
      : undefined;
  }
  const runner = step.runner;
  if (runner.kind === "package-script") {
    const binding = bindingFor(bindings, runner.packageManager);
    const args =
      step.kind === "vitest"
        ? [...step.testFiles, ...step.args, ...reporter]
        : step.args;
    return binding
      ? {
          executable: binding.executablePath,
          args: [
            ...(binding.fixedArgs ?? []),
            ...packageScriptInvocation(
              runner.packageManager,
              runner.script,
              args,
            ),
          ],
        }
      : undefined;
  }
  if (runner.kind === "local-binary") {
    const binding = bindingFor(bindings, runner.executable);
    return {
      executable:
        binding?.executablePath ??
        `/workspace/node_modules/.bin/${runner.executable}`,
      args: [
        ...(binding?.fixedArgs ?? []),
        ...(step.kind === "vitest"
          ? [...step.testFiles, ...step.args, ...reporter]
          : step.args),
      ],
    };
  }
  const command = runner.kind === "node" ? "node" : "npx";
  const binding = bindingFor(bindings, command);
  if (!binding) return undefined;
  return {
    executable: binding.executablePath,
    args:
      runner.kind === "node"
        ? [...(binding.fixedArgs ?? []), runner.script, ...step.args]
        : [
            ...(binding.fixedArgs ?? []),
            "--no-install",
            runner.executable,
            ...(step.kind === "vitest" ? step.testFiles : []),
            ...step.args,
            ...reporter,
          ],
  };
}

function vitestReport(json: string):
  | {
      total: number;
      failed: number;
      success: boolean;
      failures: string[];
      failedText: string[];
    }
  | undefined {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const report = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(report.numTotalTests) ||
    !Number.isSafeInteger(report.numFailedTests) ||
    typeof report.success !== "boolean" ||
    (report.numTotalTests as number) < 0 ||
    (report.numFailedTests as number) < 0 ||
    (report.numFailedTests as number) > (report.numTotalTests as number) ||
    !Array.isArray(report.testResults) ||
    (report.numRuntimeErrorTestSuites !== undefined &&
      report.numRuntimeErrorTestSuites !== 0) ||
    (Array.isArray(report.unhandledErrors) && report.unhandledErrors.length > 0)
  ) {
    return undefined;
  }
  let assertionCount = 0;
  for (const suite of report.testResults) {
    if (
      !suite ||
      typeof suite !== "object" ||
      !Array.isArray(suite.assertionResults)
    )
      return undefined;
    for (const assertion of suite.assertionResults) {
      if (
        !assertion ||
        typeof assertion !== "object" ||
        ![
          "passed",
          "failed",
          "pending",
          "skipped",
          "todo",
          "disabled",
        ].includes(assertion.status)
      )
        return undefined;
      assertionCount++;
    }
  }
  if (assertionCount !== report.numTotalTests) return undefined;
  const failedAssertions = (
    Array.isArray(report.testResults) ? report.testResults : []
  ).flatMap((suite): Array<{ identity: string; text: string[] }> => {
    if (!suite || typeof suite !== "object" || Array.isArray(suite)) return [];
    const record = suite as Record<string, unknown>;
    const suiteName =
      typeof record.name === "string"
        ? record.name.replace(/^\/workspace\//u, "")
        : "unknown-suite";
    if (!Array.isArray(record.assertionResults)) return [];
    return record.assertionResults.flatMap(
      (assertion): Array<{ identity: string; text: string[] }> => {
        if (
          !assertion ||
          typeof assertion !== "object" ||
          Array.isArray(assertion)
        ) {
          return [];
        }
        const entry = assertion as Record<string, unknown>;
        if (entry.status !== "failed") return [];
        const title =
          typeof entry.fullName === "string"
            ? entry.fullName
            : typeof entry.title === "string"
              ? entry.title
              : "unknown-assertion";
        const diagnostics = Array.isArray(entry.failureMessages)
          ? entry.failureMessages.filter(
              (message): message is string => typeof message === "string",
            )
          : [];
        return [
          {
            identity: `${suiteName}\0${title}`,
            text: [title, ...diagnostics],
          },
        ];
      },
    );
  });
  if (
    failedAssertions.length !== report.numFailedTests ||
    report.success !== (report.numFailedTests === 0)
  )
    return undefined;
  return {
    total: report.numTotalTests as number,
    failed: report.numFailedTests as number,
    success: report.success,
    failures: failedAssertions.map((failure) => failure.identity),
    failedText: failedAssertions.flatMap((failure) => failure.text),
  };
}

function normalizedFailureIdentities(input: {
  step: AtomicVerificationContract;
  report?: ReturnType<typeof vitestReport>;
  output: string;
  exitCode: number;
}): string[] {
  const vitestFailures = input.report?.failures ?? [];
  if (vitestFailures.length > 0) {
    return [...new Set(vitestFailures)]
      .sort()
      .map((failure) => sha256(`vitest-failure\0${failure}`));
  }
  const normalizedOutput = input.output
    .replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "gu"), "")
    .replace(/\r\n?/gu, "\n")
    .replace(/\b\d+(?:\.\d+)?(?:ms|s)\b/gu, "<duration>")
    .slice(0, 64 * 1024);
  return [
    sha256(
      canonicalJson({
        obligation:
          input.step.kind === "package-script"
            ? {
                kind: "package-script",
                packageManager: input.step.packageManager,
                script: input.step.script,
                command: input.step.command,
                args: input.step.args,
              }
            : {
                kind: input.step.kind,
                runner: input.step.runner,
                args: input.step.args,
              },
        exitCode: input.exitCode,
        output: normalizedOutput,
      }),
    ),
  ];
}

export const VERIFICATION_REPORT_LIMIT = 64 * 1024 * 1024;

function readReport(root: string, relative: string, maximum: number): string {
  if (observeSafePath(root, relative).kind !== "file")
    throw new Error("verification-report-unavailable");
  const descriptor = openSync(
    path.join(root, relative),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile()) throw new Error("verification-report-unavailable");
    if (stat.size > maximum) throw new Error("verification-report-too-large");
    const bytes = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(
        descriptor,
        bytes,
        offset,
        bytes.length - offset,
        null,
      );
      if (count === 0) break;
      offset += count;
    }
    if (offset !== stat.size) throw new Error("verification-report-invalid");
    return bytes.subarray(0, offset).toString("utf8");
  } finally {
    closeSync(descriptor);
  }
}

export async function executePackageVerification(input: {
  root: string;
  dependencyOwner: string;
  verification: StructuredVerificationContract;
  signal: AbortSignal;
  maxReportBytes?: number;
  executionWritePaths?: readonly string[];
}): Promise<VerificationObservation> {
  const unavailable = (
    code: string,
    category: "environment" | "adapter" | "resource" = "adapter",
  ): VerificationObservation => ({
    kind: "unavailable",
    category,
    code,
    verificationId: input.verification.id,
  });
  if (input.signal.aborted) return { kind: "cancelled" };
  const maxReportBytes = input.maxReportBytes ?? VERIFICATION_REPORT_LIMIT;
  if (!Number.isSafeInteger(maxReportBytes) || maxReportBytes < 1)
    return unavailable("verification-report-limit-invalid", "resource");
  const capability = bindCurrentVerificationCapability(
    input.root,
    input.verification,
    {
      dependencyOwner: input.dependencyOwner,
      executionWritePaths: input.executionWritePaths,
    },
  );
  if (!capability.ok) return unavailable(capability.diagnostic.code);
  let environment: ReturnType<typeof prepareVerificationEnvironment>;
  try {
    environment = prepareVerificationEnvironment(
      input.root,
      input.dependencyOwner,
      capability.value.runnerBindings,
    );
  } catch {
    return unavailable("verification-environment-unavailable", "environment");
  }
  try {
    const isolation = new BubblewrapIsolationBackend();
    let final: VerificationObservation | undefined;
    let sequence = 0;
    for (const step of verificationSteps(input.verification)) {
      const relative = `reports/${sequence++}.json`;
      const invocation = verificationInvocation(
        step,
        environment.bindings,
        `/cadence/${relative}`,
      );
      if (!invocation) return unavailable("runner-missing");
      const executed = await isolation.run({
        root: input.root,
        ...invocation,
        mounts: environment.mounts,
        environment: environment.environment,
        ...(step.kind !== "vitest" && step.classification === "expected-red"
          ? { outputWitness: step.expectedFailure }
          : {}),
        signal: input.signal,
      });
      if (!executed.ok) {
        if (executed.state === "cancelled") return { kind: "cancelled" };
        return unavailable(
          executed.code,
          executed.code === "isolation-execution-timeout"
            ? "resource"
            : "environment",
        );
      }
      let report: ReturnType<typeof vitestReport>;
      if (step.kind === "vitest") {
        try {
          report = vitestReport(
            readReport(environment.privateRoot, relative, maxReportBytes),
          );
        } catch (error) {
          const large =
            error instanceof Error &&
            error.message === "verification-report-too-large";
          return unavailable(
            large
              ? "verification-report-too-large"
              : "verification-report-unavailable",
            large ? "resource" : "adapter",
          );
        }
        if (!report || (executed.exitCode === 0) !== report.success)
          return unavailable("verification-report-invalid");
      }
      // A shell could not start its program; this is not evidence about the product.
      if ([126, 127].includes(executed.exitCode))
        return unavailable("verification-runner-launch-failed", "environment");
      if (!isVerificationCapabilityCurrent(input.root, capability.value))
        return unavailable("verification-input-unavailable");
      const output = `${executed.stdout}\n${executed.stderr}`;
      const identity =
        step.classification !== "expected-red" ||
        (step.kind === "vitest"
          ? report?.failedText.some((text) =>
              text.includes(step.expectedFailure ?? ""),
            ) === true
          : executed.outputWitnessMatched === true);
      const accepted =
        step.classification === "expected-red"
          ? executed.exitCode !== 0 &&
            identity &&
            (step.kind !== "vitest" ||
              (report !== undefined &&
                report.failed > 0 &&
                report.total >= step.minTests))
          : executed.exitCode === 0 &&
            (step.kind !== "vitest" ||
              (report?.success === true && report.total >= step.minTests));
      const evidence = {
        id: step.id,
        exitCode: executed.exitCode,
        classification: step.classification,
        policy: "report-file-v3" as const,
        ...(report ? { tests: report.total } : {}),
        failureIdentities: accepted
          ? []
          : normalizedFailureIdentities({
              step,
              report,
              output,
              exitCode: executed.exitCode,
            }),
      };
      if (!accepted)
        return {
          kind: "rejected",
          code:
            step.classification === "expected-red" && executed.exitCode === 0
              ? "red-not-witnessed"
              : "verification-rejected",
          evidence,
        };
      final = { kind: "accepted", evidence };
    }
    return final ?? unavailable("verification-contract-unsupported");
  } finally {
    environment.cleanup();
  }
}

/** Compatibility at the execution service boundary, without guessing from error strings. */
export function phaseVerificationResult(result: VerificationObservation) {
  if (result.kind === "cancelled")
    throw new DOMException("cancelled", "AbortError");
  if (result.kind === "accepted")
    return {
      ok: true as const,
      exitCode: result.evidence.exitCode,
      classification: result.evidence.classification,
      diagnostic: { kind: "assertion" as const, id: result.evidence.id },
    };
  if (result.kind === "rejected")
    return {
      ok: false as const,
      kind: "retryable" as const,
      code: result.code,
      failureIdentities: result.evidence.failureIdentities,
    };
  return {
    ok: false as const,
    kind: "paused" as const,
    code: result.code,
    category: result.category,
  };
}

export function changeVerificationResult(result: VerificationObservation) {
  if (result.kind === "accepted")
    return {
      ok: true as const,
      exitCode: 0 as const,
      classification: result.evidence.classification,
    };
  if (result.kind === "cancelled")
    return {
      ok: false as const,
      kind: "cancelled" as const,
      code: "cancelled",
    };
  if (result.kind === "rejected")
    return {
      ok: false as const,
      kind: "verification" as const,
      code: result.code,
      failureIdentities: result.evidence.failureIdentities,
    };
  return {
    ok: false as const,
    kind:
      result.category === "adapter"
        ? ("verification-adapter" as const)
        : ("environment" as const),
    code: result.code,
  };
}
