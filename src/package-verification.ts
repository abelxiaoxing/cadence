import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import {
  type AtomicVerificationContract,
  type StructuredVerificationContract,
  verificationSteps,
} from "./contracts.ts";
import { canonicalJson } from "./implement-graph.ts";
import { BubblewrapIsolationBackend } from "./isolation-backend.ts";
import {
  bindCurrentVerificationCapability,
  isVerificationCapabilityCurrent,
  type VerificationRunnerBinding,
} from "./verification-capability.ts";

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function packageScriptInvocation(
  packageManager: string,
  script: string,
  args: string[],
): string[] {
  return packageManager === "npm" || packageManager === "pnpm"
    ? ["run", script, "--", ...args]
    : ["run", script, ...args];
}

function bindingFor(
  bindings: readonly VerificationRunnerBinding[],
  command: string,
): VerificationRunnerBinding | undefined {
  return bindings.find((binding) => binding.command === command);
}

function prepareRunnerBindings(
  root: string,
  bindings: readonly VerificationRunnerBinding[],
): {
  bindings: VerificationRunnerBinding[];
  mounts: Array<{ source: string; target: string }>;
  cleanupRoot?: string;
} {
  if (!bindings.some((binding) => binding.mountSource)) {
    return {
      bindings: bindings.map((binding) => ({
        ...binding,
        ...(binding.fixedArgs ? { fixedArgs: [...binding.fixedArgs] } : {}),
      })),
      mounts: [],
    };
  }
  const cleanupRoot = mkdtempSync(path.join(root, ".cadence-runners-"));
  try {
    const mounted = new Map<
      string,
      { source: string; target: string; sandboxTarget: string }
    >();
    const prepared = bindings.map((binding) => {
      if (!binding.mountSource) return { ...binding };
      const source = path.resolve(binding.mountSource);
      const sourceStat = lstatSync(source);
      if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
        throw new Error("runner-mount-unavailable");
      }
      let mount = mounted.get(source);
      if (!mount) {
        const target = path.join(cleanupRoot, String(mounted.size));
        mkdirSync(target, { mode: 0o700 });
        const sandboxRelative = path
          .relative(root, target)
          .split(path.sep)
          .join("/");
        mount = {
          source,
          target,
          sandboxTarget: `/workspace/${sandboxRelative}`,
        };
        mounted.set(source, mount);
      }
      const executable = realpathSync(binding.executablePath);
      const relative = path.relative(source, executable);
      if (
        relative === "" ||
        relative.startsWith("..") ||
        path.isAbsolute(relative)
      ) {
        throw new Error("runner-mount-unavailable");
      }
      return {
        command: binding.command,
        executablePath: path.posix.join(
          mount.sandboxTarget,
          ...relative.split(path.sep),
        ),
        ...(binding.fixedArgs ? { fixedArgs: [...binding.fixedArgs] } : {}),
      };
    });
    return {
      bindings: prepared,
      mounts: [...mounted.values()].map(({ source, sandboxTarget }) => ({
        source,
        target: sandboxTarget,
      })),
      cleanupRoot,
    };
  } catch (error) {
    rmSync(cleanupRoot, { recursive: true, force: true });
    throw error;
  }
}

function verificationInvocation(
  step: AtomicVerificationContract,
  bindings: readonly VerificationRunnerBinding[],
): { executable: string; args: string[] } | undefined {
  const reporter = step.kind === "vitest" ? ["--reporter=json"] : [];
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

function vitestReport(stdout: string):
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
    value = JSON.parse(stdout);
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
    typeof report.success !== "boolean"
  ) {
    return undefined;
  }
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
        verificationId: input.step.id,
        exitCode: input.exitCode,
        output: normalizedOutput,
      }),
    ),
  ];
}

export async function executePackageVerification(input: {
  root: string;
  dependencyOwner: string;
  verification: StructuredVerificationContract;
  signal: AbortSignal;
}) {
  const capability = bindCurrentVerificationCapability(
    input.root,
    input.verification,
    { dependencyOwner: input.dependencyOwner },
  );
  if (!capability.ok) {
    return {
      ok: false as const,
      kind: "paused" as const,
      code: capability.diagnostic.code,
    };
  }
  let runners: ReturnType<typeof prepareRunnerBindings>;
  try {
    runners = prepareRunnerBindings(
      input.root,
      capability.value.runnerBindings,
    );
  } catch {
    return {
      ok: false as const,
      kind: "paused" as const,
      code: "runner-mount-unavailable",
    };
  }
  try {
    const nodeModules = path.join(input.dependencyOwner, "node_modules");
    const dependency = lstatSync(nodeModules, { throwIfNoEntry: false });
    const mounts = [] as Array<{
      source: string;
      target: string;
      writable?: boolean;
    }>;
    if (dependency) {
      if (!dependency.isDirectory() || dependency.isSymbolicLink()) {
        return {
          ok: false as const,
          kind: "paused" as const,
          code: "dependency-path-unsafe",
        };
      }
      const target = path.join(input.root, "node_modules");
      const targetStat = lstatSync(target, { throwIfNoEntry: false });
      if (
        targetStat &&
        (!targetStat.isDirectory() || targetStat.isSymbolicLink())
      ) {
        return {
          ok: false as const,
          kind: "paused" as const,
          code: "dependency-path-unsafe",
        };
      }
      if (!targetStat) mkdirSync(target, { mode: 0o700 });
      mounts.push({ source: nodeModules, target: "/workspace/node_modules" });
    }
    mounts.push(...runners.mounts);
    const isolation = new BubblewrapIsolationBackend();
    const steps = verificationSteps(input.verification);
    let final:
      | {
          exitCode: number;
          classification: AtomicVerificationContract["classification"];
          diagnostic: { kind: "assertion" | "compiler"; id: string };
        }
      | undefined;
    for (const step of steps) {
      const invocation = verificationInvocation(step, runners.bindings);
      if (!invocation) {
        return {
          ok: false as const,
          kind: "paused" as const,
          code: "runner-missing",
        };
      }
      const executed = await isolation.run({
        root: input.root,
        executable: invocation.executable,
        args: invocation.args,
        mounts,
        environment: { CI: "1" },
        signal: input.signal,
      });
      if (!executed.ok) {
        if (executed.state === "cancelled") throw input.signal.reason;
        return {
          ok: false as const,
          kind: "paused" as const,
          code: executed.code,
        };
      }
      const report =
        step.kind === "vitest" ? vitestReport(executed.stdout) : undefined;
      const output = `${executed.stdout}\n${executed.stderr}`;
      const identity =
        step.classification !== "expected-red" ||
        (step.kind === "vitest"
          ? report?.failedText.some((text) =>
              text.includes(step.expectedFailure ?? ""),
            ) === true
          : output.includes(step.expectedFailure ?? ""));
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
      if (!accepted) {
        return {
          ok: false as const,
          kind: "retryable" as const,
          code:
            step.classification === "expected-red" && executed.exitCode === 0
              ? "red-not-witnessed"
              : "verification-rejected",
          failureIdentities: normalizedFailureIdentities({
            step,
            report,
            output,
            exitCode: executed.exitCode,
          }),
        };
      }
      if (!isVerificationCapabilityCurrent(input.root, capability.value)) {
        return {
          ok: false as const,
          kind: "retryable" as const,
          code: "verification-input-unavailable",
        };
      }
      final = {
        exitCode: executed.exitCode,
        classification: step.classification,
        diagnostic: {
          kind: step.kind === "vitest" ? "assertion" : "compiler",
          id: step.id,
        },
      };
    }
    return final
      ? { ok: true as const, ...final }
      : {
          ok: false as const,
          kind: "paused" as const,
          code: "verification-contract-unsupported",
        };
  } finally {
    if (runners.cleanupRoot) {
      rmSync(runners.cleanupRoot, { recursive: true, force: true });
    }
  }
}
