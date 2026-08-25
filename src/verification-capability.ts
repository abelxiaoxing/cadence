import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import {
  type AtomicVerificationContract,
  isValidRelativePath,
  type VerificationAdapterCode,
  validateVerificationContract,
  verificationInputPaths,
  verificationSteps,
} from "./contracts.ts";

export type VerificationCapabilityDiagnostic =
  | {
      kind: "design-readiness";
      code: "verification-contract-unsupported";
      verificationId?: string;
      message: string;
    }
  | {
      kind: "verification-adapter";
      code: VerificationAdapterCode;
      verificationId: string;
      message: string;
    };

export type VerificationCapabilityResult =
  | {
      ok: true;
      verificationId: string;
      runnerBindings: VerificationRunnerBinding[];
    }
  | { ok: false; diagnostic: VerificationCapabilityDiagnostic };

export interface VerificationRunnerBinding {
  command: string;
  executablePath: string;
  mountSource?: string;
}

export interface VerificationReadiness {
  taskContractsExecutable: boolean;
  diagnostics: VerificationCapabilityDiagnostic[];
}

const SHELL_OPERATOR = /[;&|`$<>\n\r\0]/u;
const SIMPLE_TOKEN =
  /^(?:[a-z0-9][a-z0-9._:@/=-]*|--?[a-z0-9][a-z0-9._:@/=-]*)$/iu;
const NETWORKING_RUNNERS = new Set(["bunx", "pnpx"]);
const SYSTEM_MOUNT_ROOTS = ["/usr", "/bin", "/lib", "/lib64", "/etc"];
const BROAD_MOUNT_ROOTS = new Set([
  "/",
  "/home",
  "/root",
  "/tmp",
  "/var",
  "/var/tmp",
]);

function capabilitySuccess(
  verificationId: string,
  runnerBindings: VerificationRunnerBinding[] = [],
): VerificationCapabilityResult {
  const seen = new Set<string>();
  return {
    ok: true,
    verificationId,
    runnerBindings: runnerBindings.filter((binding) => {
      const key = `${binding.command}\0${binding.executablePath}\0${binding.mountSource ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  };
}

function adapterFailure(
  verificationId: string,
  code: VerificationAdapterCode,
  message: string,
): VerificationCapabilityResult {
  return {
    ok: false,
    diagnostic: { kind: "verification-adapter", code, verificationId, message },
  };
}

function fileStatus(
  root: string,
  relative: string,
): "regular" | "absent" | "unsafe" {
  if (!isValidRelativePath(relative)) return "unsafe";
  const resolvedRoot = path.resolve(root);
  const absolute = path.resolve(resolvedRoot, relative);
  if (
    absolute === resolvedRoot ||
    !absolute.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    return "unsafe";
  }
  const stat = lstatSync(absolute, { throwIfNoEntry: false });
  if (!stat) return "absent";
  return stat.isFile() && !stat.isSymbolicLink() ? "regular" : "unsafe";
}

function regularFile(root: string, relative: string): boolean {
  return fileStatus(root, relative) === "regular";
}

function localExecutable(
  root: string,
  executable: string,
  dependencyOwner = root,
): boolean {
  const dependencyRoot = path.resolve(dependencyOwner, "node_modules");
  const unresolved = path.resolve(dependencyRoot, ".bin", executable);
  try {
    const canonicalDependencyRoot = realpathSync(dependencyRoot);
    const canonical = realpathSync(unresolved);
    const stat = lstatSync(canonical);
    return (
      canonical !== canonicalDependencyRoot &&
      canonical.startsWith(`${canonicalDependencyRoot}${path.sep}`) &&
      stat.isFile() &&
      (stat.mode & 0o111) !== 0
    );
  } catch {
    return false;
  }
}

function within(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function commonDirectory(left: string, right: string): string {
  const leftParts = path.resolve(left).split(path.sep).filter(Boolean);
  const rightParts = path.resolve(right).split(path.sep).filter(Boolean);
  const common: string[] = [];
  for (
    let index = 0;
    index < Math.min(leftParts.length, rightParts.length);
    index++
  ) {
    if (leftParts[index] !== rightParts[index]) break;
    common.push(leftParts[index] as string);
  }
  return path.join(path.parse(path.resolve(left)).root, ...common);
}

function unsafeMountSource(source: string): boolean {
  if (BROAD_MOUNT_ROOTS.has(source)) return true;
  const parts = source.split(path.sep).filter(Boolean);
  return (
    (parts[0] === "home" && parts.length <= 2) ||
    (parts[0] === "Users" && parts.length <= 2) ||
    (parts[0] === "root" && parts.length <= 1)
  );
}

export function resolveVerificationRunner(
  command: string,
): VerificationRunnerBinding | null {
  const candidates = [
    ...(command === "bun" && process.versions.bun ? [process.execPath] : []),
    ...(process.env.PATH ?? "")
      .split(path.delimiter)
      .filter(Boolean)
      .map((directory) => path.join(directory, command)),
  ];
  for (const candidate of candidates) {
    try {
      const executablePath = path.resolve(candidate);
      const canonical = realpathSync(executablePath);
      const stat = lstatSync(canonical);
      if (!stat.isFile() || (stat.mode & 0o111) === 0) continue;
      const systemVisible = SYSTEM_MOUNT_ROOTS.some(
        (root) => within(root, executablePath) && within(root, canonical),
      );
      if (systemVisible) return { command, executablePath };
      const mountSource = commonDirectory(
        path.dirname(executablePath),
        path.dirname(canonical),
      );
      if (unsafeMountSource(mountSource)) continue;
      const sourceStat = lstatSync(mountSource);
      if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) continue;
      return { command, executablePath, mountSource };
    } catch {}
  }
  return null;
}

function packageManifest(root: string): Record<string, unknown> | null {
  if (!regularFile(root, "package.json")) return null;
  try {
    const value = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf8"),
    );
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function validateScriptCommand(
  root: string,
  verificationId: string,
  command: string,
  dependencyOwner: string,
): VerificationCapabilityResult {
  if (
    command.length === 0 ||
    command.trim() !== command ||
    SHELL_OPERATOR.test(command)
  ) {
    return adapterFailure(
      verificationId,
      "script-unsafe",
      "approved package script contains unsupported shell syntax",
    );
  }
  const tokens = command.split(/\s+/u);
  if (!SIMPLE_TOKEN.test(tokens[0] ?? "")) {
    return adapterFailure(
      verificationId,
      "script-unsafe",
      "approved package script cannot be represented as safe tokens",
    );
  }
  const executable = tokens[0] ?? "";
  const subcommands = new Set(tokens.slice(1));
  if (
    NETWORKING_RUNNERS.has(executable) ||
    (executable === "bun" && subcommands.has("x")) ||
    (executable === "npm" &&
      (subcommands.has("exec") || subcommands.has("x"))) ||
    (executable === "pnpm" && subcommands.has("dlx")) ||
    (executable === "yarn" && subcommands.has("dlx"))
  ) {
    return adapterFailure(
      verificationId,
      "script-unsafe",
      "package script uses a runner that can download implicitly",
    );
  }
  if (executable === "npx") {
    const local = tokens[1] === "--no-install" ? tokens[2] : undefined;
    if (!local || !localExecutable(root, local, dependencyOwner)) {
      return adapterFailure(
        verificationId,
        "local-executable-missing",
        "npx requires --no-install and an installed local executable",
      );
    }
    const runner = resolveVerificationRunner("npx");
    return runner
      ? capabilitySuccess(verificationId, [runner])
      : adapterFailure(
          verificationId,
          "runner-missing",
          "npx is unavailable or cannot be mounted safely",
        );
  }
  if (["node", "bun"].includes(executable)) {
    const runner = resolveVerificationRunner(executable);
    return runner
      ? capabilitySuccess(verificationId, [runner])
      : adapterFailure(
          verificationId,
          "runner-missing",
          `approved runner ${executable} is unavailable or cannot be mounted safely`,
        );
  }
  return localExecutable(root, executable, dependencyOwner)
    ? capabilitySuccess(verificationId)
    : adapterFailure(
        verificationId,
        "local-executable-missing",
        `local executable ${executable} is unavailable`,
      );
}

function validatePackageScript(
  root: string,
  verificationId: string,
  packageManager: string,
  script: string,
  approvedCommand?: string,
  dependencyOwner = root,
): VerificationCapabilityResult {
  const packageRunner = resolveVerificationRunner(packageManager);
  if (!packageRunner) {
    return adapterFailure(
      verificationId,
      "runner-missing",
      `approved package manager ${packageManager} is unavailable or cannot be mounted safely`,
    );
  }
  const manifest = packageManifest(root);
  const scripts = manifest?.scripts;
  const actual =
    scripts && typeof scripts === "object" && !Array.isArray(scripts)
      ? (scripts as Record<string, unknown>)[script]
      : undefined;
  if (typeof actual !== "string") {
    return adapterFailure(
      verificationId,
      "script-missing",
      `package.json script ${script} is missing`,
    );
  }
  if (approvedCommand !== undefined && actual !== approvedCommand) {
    return adapterFailure(
      verificationId,
      "script-command-mismatch",
      `package.json script ${script} differs from the Gate B contract`,
    );
  }
  const scriptCapability = validateScriptCommand(
    root,
    verificationId,
    actual,
    dependencyOwner,
  );
  return scriptCapability.ok
    ? capabilitySuccess(verificationId, [
        packageRunner,
        ...scriptCapability.runnerBindings,
      ])
    : scriptCapability;
}

function validateAtomicCapability(
  root: string,
  step: AtomicVerificationContract,
  dependencyOwner: string,
  allowedMissingInputs: ReadonlySet<string>,
): VerificationCapabilityResult {
  for (const input of verificationInputPaths(step)) {
    const status = fileStatus(root, input);
    if (
      status !== "regular" &&
      !(status === "absent" && allowedMissingInputs.has(input))
    ) {
      return adapterFailure(
        step.id,
        "input-missing",
        `verification input ${input} is missing or unsafe`,
      );
    }
  }
  if (step.kind === "package-script") {
    return validatePackageScript(
      root,
      step.id,
      step.packageManager,
      step.script,
      step.command,
      dependencyOwner,
    );
  }
  const runner = step.runner;
  if (runner.kind === "package-script") {
    const script = validatePackageScript(
      root,
      step.id,
      runner.packageManager,
      runner.script,
      runner.command,
      dependencyOwner,
    );
    if (!script.ok) return script;
    if (
      step.kind === "vitest" &&
      !localExecutable(root, "vitest", dependencyOwner)
    ) {
      return adapterFailure(
        step.id,
        "local-executable-missing",
        "Vitest is not installed in consumer node_modules",
      );
    }
    return script;
  }
  if (runner.kind === "node") {
    const node = resolveVerificationRunner("node");
    return node
      ? capabilitySuccess(step.id, [node])
      : adapterFailure(
          step.id,
          "runner-missing",
          "Node is unavailable or cannot be mounted safely",
        );
  }
  if (!localExecutable(root, runner.executable, dependencyOwner)) {
    return adapterFailure(
      step.id,
      "local-executable-missing",
      `local executable ${runner.executable} is unavailable`,
    );
  }
  if (runner.kind === "npx") {
    const npx = resolveVerificationRunner("npx");
    return npx
      ? capabilitySuccess(step.id, [npx])
      : adapterFailure(
          step.id,
          "runner-missing",
          "npx is unavailable or cannot be mounted safely",
        );
  }
  return capabilitySuccess(step.id);
}

export function validateVerificationCapability(
  root: string,
  value: unknown,
  options: {
    dependencyOwner?: string;
    allowedMissingInputs?: readonly string[];
  } = {},
): VerificationCapabilityResult {
  const validation = validateVerificationContract(value);
  if (!validation.ok) {
    const id =
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof (value as Record<string, unknown>).id === "string"
        ? String((value as Record<string, unknown>).id)
        : undefined;
    return {
      ok: false,
      diagnostic: {
        kind: "design-readiness",
        code: "verification-contract-unsupported",
        ...(id ? { verificationId: id } : {}),
        message: validation.reason,
      },
    };
  }
  const dependencyOwner = options.dependencyOwner ?? root;
  const allowedMissingInputs = new Set(options.allowedMissingInputs ?? []);
  const runnerBindings: VerificationRunnerBinding[] = [];
  for (const step of verificationSteps(validation.value)) {
    const capability = validateAtomicCapability(
      root,
      step,
      dependencyOwner,
      allowedMissingInputs,
    );
    if (!capability.ok) return capability;
    runnerBindings.push(...capability.runnerBindings);
  }
  return capabilitySuccess(validation.value.id, runnerBindings);
}

export function assessVerificationReadiness(
  root: string,
  contracts: readonly unknown[],
  options: {
    dependencyOwner?: string;
    allowedMissingInputs?: readonly string[];
  } = {},
): VerificationReadiness {
  const diagnostics = contracts
    .map((contract) => validateVerificationCapability(root, contract, options))
    .filter(
      (
        result,
      ): result is Extract<VerificationCapabilityResult, { ok: false }> =>
        !result.ok,
    )
    .map((result) => result.diagnostic);
  return {
    taskContractsExecutable: diagnostics.length === 0,
    diagnostics,
  };
}
