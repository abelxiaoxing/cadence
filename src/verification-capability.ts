import {
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  type Stats,
} from "node:fs";
import path from "node:path";
import {
  type AtomicVerificationContract,
  type StructuredVerificationContract,
  VERIFICATION_CONFIGURATION_PATHS,
  type VerificationAdapterCode,
  type VerificationInputObservation,
  validateVerificationContract,
  verificationBoundInputPaths,
  verificationInputPaths,
  verificationSteps,
} from "./contracts.ts";
import { executionProfile } from "./execution-profile.ts";
import {
  type Bound,
  isCurrent,
  snapshotFile,
  snapshotFiles,
} from "./file-snapshot.ts";
import { observeSafePath } from "./safe-path.ts";
import { verificationEnvironmentDigest } from "./verification-identity.ts";

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
      inputObservation?: VerificationInputObservation;
    };

export type VerificationCapabilityResult =
  | {
      ok: true;
      verificationId: string;
      runnerBindings: VerificationRunnerBinding[];
    }
  | { ok: false; diagnostic: VerificationCapabilityDiagnostic };

export interface CurrentVerificationCapability {
  verificationId: string;
  runnerBindings: VerificationRunnerBinding[];
  inputSnapshot: Bound;
  runnerSnapshot: { paths: string[]; digest: string };
}

export type CurrentVerificationCapabilityResult =
  | { ok: true; value: CurrentVerificationCapability }
  | { ok: false; diagnostic: VerificationCapabilityDiagnostic };

export interface VerificationRunnerBinding {
  command: string;
  executablePath: string;
  fixedArgs?: string[];
  mountSource?: string;
}

export interface VerificationRunnerEnvironment {
  platform?: NodeJS.Platform;
  path?: string;
  pathExt?: string;
  pathDelimiter?: string;
}

export interface VerificationCapabilityOptions {
  /** Trusted plan write/delete authority, supplied only for isolated execution. */
  executionWritePaths?: readonly string[];
  dependencyOwner?: string;
  runnerEnvironment?: VerificationRunnerEnvironment;
}

const WINDOWS_EXECUTABLE_EXTENSIONS = new Set([".exe", ".cmd"]);
const DEFAULT_WINDOWS_PATH_EXT = ".COM;.EXE;.BAT;.CMD";
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
    runnerBindings: runnerBindings
      .filter((binding) => {
        const key = `${binding.command}\0${binding.executablePath}\0${JSON.stringify(binding.fixedArgs ?? [])}\0${binding.mountSource ?? ""}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((binding) => ({
        ...binding,
        ...(binding.fixedArgs ? { fixedArgs: [...binding.fixedArgs] } : {}),
      })),
  };
}

function adapterFailure(
  verificationId: string,
  code: VerificationAdapterCode,
  message: string,
  inputObservation?: VerificationInputObservation,
): VerificationCapabilityResult {
  return {
    ok: false,
    diagnostic: {
      kind: "verification-adapter",
      code,
      verificationId,
      message,
      ...(inputObservation ? { inputObservation } : {}),
    },
  };
}

function fileStatus(
  root: string,
  relative: string,
): "regular" | "absent" | "unsafe" {
  const observation = observeSafePath(root, relative);
  if (observation.kind === "file") return "regular";
  return observation.kind === "absent" ? "absent" : "unsafe";
}

function regularFile(root: string, relative: string): boolean {
  return fileStatus(root, relative) === "regular";
}

function localExecutable(
  root: string,
  executable: string,
  dependencyOwner = root,
  environment: VerificationRunnerEnvironment = {},
): boolean {
  const dependencyRoot = path.resolve(dependencyOwner, "node_modules");
  try {
    const canonicalDependencyRoot = realpathSync(dependencyRoot);
    for (const name of localExecutableNames(executable, environment)) {
      const unresolved = resolveCandidateName(
        path.resolve(dependencyRoot, ".bin"),
        name,
        environment.platform ?? process.platform,
      );
      if (!unresolved) continue;
      const canonical = realpathSync(unresolved);
      const stat = lstatSync(canonical);
      if (
        canonical !== canonicalDependencyRoot &&
        pathWithin(
          canonicalDependencyRoot,
          canonical,
          environment.platform ?? process.platform,
        ) &&
        regularExecutableFile(stat, environment.platform ?? process.platform)
      ) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

function pathApi(
  platform: NodeJS.Platform,
  ...values: readonly string[]
): typeof path.posix {
  if (platform !== "win32") return path.posix;
  if (
    process.platform === "win32" ||
    values.some(
      (value) => /^[a-z]:[\\/]/iu.test(value) || value.startsWith("\\\\"),
    )
  ) {
    return path.win32;
  }
  // Tests may model Windows executable semantics over a POSIX fixture tree.
  return path.posix;
}

function pathWithin(
  root: string,
  candidate: string,
  platform: NodeJS.Platform,
): boolean {
  const platformPath = pathApi(platform, root, candidate);
  const normalizedRoot = platformPath.resolve(root);
  const relative = platformPath.relative(
    normalizedRoot,
    platformPath.resolve(candidate),
  );
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${platformPath.sep}`) &&
      !platformPath.isAbsolute(relative))
  );
}

function regularExecutableFile(
  stat: Stats,
  platform: NodeJS.Platform,
): boolean {
  return stat.isFile() && (platform === "win32" || (stat.mode & 0o111) !== 0);
}

function windowsPathExtensions(pathExt: string | undefined): string[] {
  const seen = new Set<string>();
  const extensions: string[] = [];
  for (const entry of (pathExt ?? DEFAULT_WINDOWS_PATH_EXT).split(";")) {
    const extension = entry.trim().toLowerCase();
    if (!WINDOWS_EXECUTABLE_EXTENSIONS.has(extension) || seen.has(extension)) {
      continue;
    }
    seen.add(extension);
    extensions.push(extension);
  }
  return extensions;
}

function runnerNames(
  command: string,
  environment: VerificationRunnerEnvironment,
): string[] {
  if (!/^[a-z0-9][a-z0-9._-]*$/iu.test(command)) return [];
  if ((environment.platform ?? process.platform) !== "win32") {
    return [command];
  }
  const extension = path.extname(command).toLowerCase();
  if (extension) {
    return WINDOWS_EXECUTABLE_EXTENSIONS.has(extension) ? [command] : [];
  }
  return windowsPathExtensions(environment.pathExt).map(
    (candidateExtension) => `${command}${candidateExtension}`,
  );
}

function localExecutableNames(
  executable: string,
  environment: VerificationRunnerEnvironment,
): string[] {
  if (!/^[a-z0-9][a-z0-9._-]*$/iu.test(executable)) return [];
  if ((environment.platform ?? process.platform) !== "win32") {
    return [executable];
  }
  const extension = path.extname(executable).toLowerCase();
  if (extension) {
    return WINDOWS_EXECUTABLE_EXTENSIONS.has(extension) ? [executable] : [];
  }
  return [
    executable,
    ...windowsPathExtensions(environment.pathExt).map(
      (candidateExtension) => `${executable}${candidateExtension}`,
    ),
  ];
}

function resolveCandidateName(
  directory: string,
  name: string,
  platform: NodeJS.Platform,
): string | null {
  const exact = path.join(directory, name);
  if (platform !== "win32") return exact;
  try {
    const matches = readdirSync(directory).filter(
      (entry) => entry.toLowerCase() === name.toLowerCase(),
    );
    return matches.length === 1
      ? path.join(directory, matches[0] as string)
      : null;
  } catch {
    return null;
  }
}

function within(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

export function commonDirectory(
  left: string,
  right: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const platformPath = pathApi(platform, left, right);
  const leftResolved = platformPath.resolve(left);
  const rightResolved = platformPath.resolve(right);
  const leftRoot = platformPath.parse(leftResolved).root;
  const rightRoot = platformPath.parse(rightResolved).root;
  const comparable = (value: string) =>
    platform === "win32" ? value.toLowerCase() : value;
  if (comparable(leftRoot) !== comparable(rightRoot)) return leftRoot;

  const parts = (value: string, root: string) =>
    platformPath.relative(root, value).split(platformPath.sep).filter(Boolean);
  const leftParts = parts(leftResolved, leftRoot);
  const rightParts = parts(rightResolved, rightRoot);
  const common: string[] = [];
  for (
    let index = 0;
    index < Math.min(leftParts.length, rightParts.length);
    index++
  ) {
    const leftPart = leftParts[index] as string;
    const rightPart = rightParts[index] as string;
    if (comparable(leftPart) !== comparable(rightPart)) break;
    common.push(leftPart);
  }
  return platformPath.join(leftRoot, ...common);
}

function unsafeMountSource(source: string): boolean {
  if (BROAD_MOUNT_ROOTS.has(source)) return true;
  if (path.resolve(source) === path.parse(path.resolve(source)).root)
    return true;
  const parts = path
    .relative(path.parse(path.resolve(source)).root, path.resolve(source))
    .split(path.sep)
    .filter(Boolean)
    .map((part) => part.toLowerCase());
  return (
    (parts[0] === "home" && parts.length <= 2) ||
    (parts[0] === "users" && parts.length <= 2) ||
    (parts[0] === "root" && parts.length <= 1)
  );
}

function safeRunnerSource(
  paths: readonly string[],
  platform: NodeJS.Platform,
): string | null {
  let source = path.dirname(paths[0] as string);
  for (const candidate of paths.slice(1)) {
    source = commonDirectory(source, path.dirname(candidate), platform);
  }
  if (unsafeMountSource(source)) return null;
  try {
    const stat = lstatSync(source);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
  } catch {
    return null;
  }
  return paths.every((candidate) => pathWithin(source, candidate, platform))
    ? source
    : null;
}

function resolvedRunnerEnvironment(
  environment: VerificationRunnerEnvironment,
): Required<VerificationRunnerEnvironment> {
  return {
    platform: environment.platform ?? process.platform,
    path: environment.path ?? process.env.PATH ?? "",
    pathExt:
      environment.pathExt ?? process.env.PATHEXT ?? DEFAULT_WINDOWS_PATH_EXT,
    pathDelimiter: environment.pathDelimiter ?? path.delimiter,
  };
}

function windowsShimBinding(
  command: string,
  launcherPath: string,
  environment: Required<VerificationRunnerEnvironment>,
): VerificationRunnerBinding | null {
  const name = path.basename(command, path.extname(command)).toLowerCase();
  if (name !== "npm" && name !== "npx") return null;
  const node = resolveVerificationRunner("node", environment);
  if (
    !node ||
    node.fixedArgs ||
    path.extname(node.executablePath).toLowerCase() !== ".exe"
  ) {
    return null;
  }
  const cli = path.join(
    path.dirname(launcherPath),
    "node_modules",
    "npm",
    "bin",
    `${name}-cli.js`,
  );
  try {
    const canonicalLauncher = realpathSync(launcherPath);
    const canonicalCli = realpathSync(cli);
    const cliStat = lstatSync(canonicalCli);
    if (!cliStat.isFile()) return null;
    const source = safeRunnerSource(
      [node.executablePath, canonicalLauncher, canonicalCli],
      environment.platform,
    );
    if (!source) return null;
    return {
      command,
      executablePath: node.executablePath,
      fixedArgs: [canonicalCli],
    };
  } catch {
    return null;
  }
}

function localPackageDirectories(dependencyRoot: string): string[] {
  const packages: string[] = [];
  try {
    for (const entry of readdirSync(dependencyRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const candidate = path.join(dependencyRoot, entry.name);
      if (!entry.name.startsWith("@")) {
        packages.push(candidate);
        continue;
      }
      for (const scoped of readdirSync(candidate, { withFileTypes: true })) {
        if (scoped.isDirectory() && !scoped.name.startsWith(".")) {
          packages.push(path.join(candidate, scoped.name));
        }
      }
    }
  } catch {
    return [];
  }
  return packages;
}

function localPackageBinTargets(
  dependencyOwner: string,
  executable: string,
  platform: NodeJS.Platform,
): string[] {
  const dependencyRoot = path.resolve(dependencyOwner, "node_modules");
  let canonicalDependencyRoot: string;
  try {
    canonicalDependencyRoot = realpathSync(dependencyRoot);
  } catch {
    return [];
  }
  const targets: string[] = [];
  for (const packageDirectory of localPackageDirectories(dependencyRoot)) {
    try {
      const directoryStat = lstatSync(packageDirectory);
      if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
        continue;
      }
      const canonicalPackage = realpathSync(packageDirectory);
      if (
        !pathWithin(canonicalDependencyRoot, canonicalPackage, platform) ||
        canonicalPackage === canonicalDependencyRoot
      ) {
        continue;
      }
      const manifestPath = path.join(canonicalPackage, "package.json");
      const manifestStat = lstatSync(manifestPath);
      if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) continue;
      const manifest = JSON.parse(
        readFileSync(manifestPath, "utf8"),
      ) as unknown;
      if (
        !manifest ||
        typeof manifest !== "object" ||
        Array.isArray(manifest)
      ) {
        continue;
      }
      const record = manifest as Record<string, unknown>;
      const packageName =
        typeof record.name === "string"
          ? (record.name.split("/").pop() ?? "")
          : "";
      const bin = record.bin;
      let relative: unknown;
      if (
        typeof bin === "string" &&
        (platform === "win32"
          ? packageName.toLowerCase() === executable.toLowerCase()
          : packageName === executable)
      ) {
        relative = bin;
      } else if (bin && typeof bin === "object" && !Array.isArray(bin)) {
        const entries = Object.entries(bin as Record<string, unknown>).filter(
          ([name]) =>
            platform === "win32"
              ? name.toLowerCase() === executable.toLowerCase()
              : name === executable,
        );
        if (entries.length === 1) relative = entries[0]?.[1];
      }
      if (
        typeof relative !== "string" ||
        relative.length === 0 ||
        relative.includes("\0")
      ) {
        continue;
      }
      const unresolved = path.resolve(canonicalPackage, relative);
      if (!pathWithin(canonicalPackage, unresolved, platform)) continue;
      const canonical = realpathSync(unresolved);
      const stat = lstatSync(canonical);
      if (
        stat.isFile() &&
        pathWithin(canonicalPackage, canonical, platform) &&
        pathWithin(canonicalDependencyRoot, canonical, platform)
      ) {
        targets.push(canonical);
      }
    } catch {}
  }
  return [...new Set(targets)];
}

function resolveLocalVerificationRunner(
  dependencyOwner: string,
  executable: string,
  runnerEnvironment: VerificationRunnerEnvironment,
): VerificationRunnerBinding | null {
  const environment = resolvedRunnerEnvironment(runnerEnvironment);
  if (environment.platform !== "win32") return null;
  const targets = localPackageBinTargets(
    dependencyOwner,
    executable,
    environment.platform,
  );
  if (targets.length !== 1) return null;
  const target = targets[0] as string;
  const extension = path.extname(target).toLowerCase();
  if (extension === ".exe") {
    return { command: executable, executablePath: target };
  }
  if (![".js", ".cjs", ".mjs"].includes(extension)) return null;
  const node = resolveVerificationRunner("node", environment);
  if (!node || node.fixedArgs) return null;
  return {
    command: executable,
    executablePath: node.executablePath,
    fixedArgs: [target],
  };
}

export function resolveVerificationRunner(
  command: string,
  runnerEnvironment: VerificationRunnerEnvironment = {},
): VerificationRunnerBinding | null {
  const environment = resolvedRunnerEnvironment(runnerEnvironment);
  const directories = environment.path
    .split(environment.pathDelimiter)
    .filter(Boolean);
  const seenDirectories = new Set<string>();
  const candidates = [
    ...(command === "bun" &&
    process.versions.bun &&
    environment.platform === process.platform
      ? [process.execPath]
      : []),
    ...directories.flatMap((directory) => {
      const resolvedDirectory = path.resolve(directory);
      const key =
        environment.platform === "win32"
          ? resolvedDirectory.toLowerCase()
          : resolvedDirectory;
      if (seenDirectories.has(key)) return [];
      seenDirectories.add(key);
      return runnerNames(command, environment).flatMap((name) => {
        const candidate = resolveCandidateName(
          resolvedDirectory,
          name,
          environment.platform,
        );
        return candidate ? [candidate] : [];
      });
    }),
  ];
  const seenCandidates = new Set<string>();
  for (const candidate of candidates) {
    try {
      const executablePath = path.resolve(candidate);
      const candidateKey =
        environment.platform === "win32"
          ? executablePath.toLowerCase()
          : executablePath;
      if (seenCandidates.has(candidateKey)) continue;
      seenCandidates.add(candidateKey);
      const canonical = realpathSync(executablePath);
      const stat = lstatSync(canonical);
      if (!regularExecutableFile(stat, environment.platform)) continue;
      if (environment.platform === "win32") {
        const extension = path.extname(executablePath).toLowerCase();
        if (extension === ".cmd") {
          const shim = windowsShimBinding(command, executablePath, environment);
          if (shim) return shim;
          continue;
        }
        if (extension !== ".exe") continue;
        if (
          !safeRunnerSource([executablePath, canonical], environment.platform)
        ) {
          continue;
        }
        return { command, executablePath };
      }
      const systemVisible = SYSTEM_MOUNT_ROOTS.some(
        (root) => within(root, executablePath) && within(root, canonical),
      );
      if (systemVisible) return { command, executablePath };
      const mountSource = commonDirectory(
        path.dirname(executablePath),
        path.dirname(canonical),
        environment.platform,
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

function validatePackageScript(
  root: string,
  verificationId: string,
  packageManager: string,
  script: string,
  approvedCommand: string,
  _dependencyOwner = root,
  runnerEnvironment: VerificationRunnerEnvironment = {},
): VerificationCapabilityResult {
  const packageRunner = resolveVerificationRunner(
    packageManager,
    runnerEnvironment,
  );
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
  if (actual !== approvedCommand) {
    return adapterFailure(
      verificationId,
      "script-command-mismatch",
      `package.json script ${script} differs from the Gate B contract`,
    );
  }
  // Approved scripts are opaque shell programs and may invoke nested scripts
  // or hooks. Supply the available supported runtimes without parsing shell
  // syntax or rejecting composition; isolation still owns their execution.
  const runtimes = ["node", "bun", "npm", "npx", "pnpm", "yarn"].flatMap(
    (command) => {
      const binding = resolveVerificationRunner(command, runnerEnvironment);
      return binding ? [binding] : [];
    },
  );
  return capabilitySuccess(verificationId, [packageRunner, ...runtimes]);
}

/** Inspect active directives, never comments or arbitrary words in values. */
function unsupportedExecutionConfiguration(source: string): boolean {
  const restricted = new Set([
    "scriptshell",
    "userconfig",
    "globalconfig",
    "yarnpath",
    "plugins",
    "auth",
    "authtoken",
    "password",
    "token",
    "npmauthtoken",
    "npmauthident",
  ]);
  for (const line of source.split(/\r?\n/u)) {
    let quote = "";
    let escaped = false;
    let active = "";
    const parts: string[] = [];
    let flowDepth = 0;
    for (const character of line) {
      if (escaped) {
        active += character;
        escaped = false;
        continue;
      }
      if (character === "\\" && quote === '"') {
        active += character;
        escaped = true;
        continue;
      }
      if (quote) {
        active += character;
        if (character === quote) quote = "";
      } else if (character === '"' || character === "'") {
        quote = character;
        active += character;
      } else if (
        character === "#" ||
        (character === ";" && active.trim() === "")
      ) {
        break;
      } else if (
        character === "{" ||
        character === "}" ||
        (character === "," && flowDepth > 0)
      ) {
        if (character === "{") flowDepth++;
        if (character === "}") flowDepth = Math.max(0, flowDepth - 1);
        parts.push(active);
        active = "";
      } else active += character;
    }
    parts.push(active);
    for (const part of parts) {
      if (part.includes("${")) return true;
      const directive = part.match(
        /^\s*(?:"((?:\\.|[^"\\])*)"|'([^']*)'|([^\s=]+))\s*(.*)$/u,
      );
      if (!directive) continue;
      const rawKey = directive[1] ?? directive[2] ?? directive[3];
      if (!rawKey.endsWith(":") && !directive[4]) continue;
      const key = rawKey
        .replace(/:$/u, "")
        .split(":")
        .at(-1)
        ?.replace(/[-_]/gu, "")
        .toLowerCase();
      if (key && restricted.has(key)) return true;
    }
  }
  return false;
}

function validateAtomicCapability(
  root: string,
  step: AtomicVerificationContract,
  dependencyOwner: string,
  runnerEnvironment: VerificationRunnerEnvironment,
  executionWritePaths: readonly string[],
): VerificationCapabilityResult {
  if (
    step.kind === "vitest" &&
    [
      ...step.args,
      ...(step.runner.kind === "package-script"
        ? step.runner.command.split(/\s+/u)
        : []),
    ].some((arg) => /^--(?:reporters?|outputFile)(?:[.=]|$)/u.test(arg))
  ) {
    return adapterFailure(
      step.id,
      "report-arguments-conflict",
      "Vitest report arguments are owned by the adapter",
    );
  }
  if (step.executionBindings) {
    for (const [relative, expected] of Object.entries(step.executionBindings)) {
      if (executionWritePaths.includes(relative)) continue;
      const observation = observeSafePath(root, relative);
      if (
        (expected === null && observation.kind !== "absent") ||
        (expected !== null && snapshotFile(root, relative)?.sha256 !== expected)
      ) {
        return adapterFailure(
          step.id,
          "verification-config-mismatch",
          "Bound execution inputs changed; recompile the verification contract",
        );
      }
    }
  }
  for (const relative of verificationBoundInputPaths(step).filter((file) =>
    VERIFICATION_CONFIGURATION_PATHS.includes(file),
  )) {
    const observation = observeSafePath(root, relative);
    if (!["file", "absent"].includes(observation.kind))
      return adapterFailure(
        step.id,
        "verification-config-unsafe",
        "Execution configuration must be a regular file",
      );
    if (
      observation.kind !== "file" ||
      ![
        ".npmrc",
        ".yarnrc",
        ".yarnrc.yml",
        "bunfig.toml",
        "pnpm-workspace.yaml",
      ].includes(relative)
    )
      continue;
    if (
      lstatSync(path.join(root, relative)).size > 64 * 1024 ||
      (executionProfile().mode !== "local-trusted" &&
        unsupportedExecutionConfiguration(
          readFileSync(path.join(root, relative), "utf8"),
        ))
    ) {
      return adapterFailure(
        step.id,
        "verification-config-unsafe",
        "Execution configuration requires unsupported credentials or host configuration",
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
      runnerEnvironment,
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
      runnerEnvironment,
    );
    if (!script.ok) return script;
    if (
      step.kind === "vitest" &&
      !localExecutable(root, "vitest", dependencyOwner, runnerEnvironment)
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
    const node = resolveVerificationRunner("node", runnerEnvironment);
    return node
      ? capabilitySuccess(step.id, [node])
      : adapterFailure(
          step.id,
          "runner-missing",
          "Node is unavailable or cannot be mounted safely",
        );
  }
  if (
    !localExecutable(
      root,
      runner.executable,
      dependencyOwner,
      runnerEnvironment,
    )
  ) {
    return adapterFailure(
      step.id,
      "local-executable-missing",
      `local executable ${runner.executable} is unavailable`,
    );
  }
  if (runner.kind === "npx") {
    const npx = resolveVerificationRunner("npx", runnerEnvironment);
    return npx
      ? capabilitySuccess(step.id, [npx])
      : adapterFailure(
          step.id,
          "runner-missing",
          "npx is unavailable or cannot be mounted safely",
        );
  }
  if ((runnerEnvironment.platform ?? process.platform) === "win32") {
    const binding = resolveLocalVerificationRunner(
      dependencyOwner,
      runner.executable,
      runnerEnvironment,
    );
    return binding
      ? capabilitySuccess(step.id, [binding])
      : adapterFailure(
          step.id,
          "local-executable-missing",
          `local executable ${runner.executable} has no safe direct Windows binding`,
        );
  }
  return capabilitySuccess(step.id);
}

/** Enrich only a new design draft, never rewrite proof-bound canonical delivery bytes. */
export function bindDraftVerificationInputs(
  root: string,
  draft: unknown,
): unknown {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    const item = Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        // Gate A is immutable approval authority, not an execution contract.
        key === "changeContract" ? structuredClone(child) : visit(child),
      ]),
    );
    if (
      item.kind === "package-script" &&
      item.command === undefined &&
      typeof item.script === "string"
    ) {
      const scripts = packageManifest(root)?.scripts as
        | Record<string, unknown>
        | undefined;
      item.command = scripts?.[item.script];
    }
    if (
      ["vitest", "package-script", "static-check"].includes(
        String(item.kind),
      ) &&
      typeof item.id === "string"
    ) {
      const validation = validateVerificationContract(item);
      if (
        validation.ok &&
        verificationBoundInputPaths(validation.value).some((file) =>
          VERIFICATION_CONFIGURATION_PATHS.includes(file),
        )
      ) {
        item.executionBindings = Object.fromEntries(
          VERIFICATION_CONFIGURATION_PATHS.map((relative) => [
            relative,
            snapshotFile(root, relative)?.sha256 ?? null,
          ]),
        );
      }
    }
    return item;
  };
  return visit(draft);
}

export function validateVerificationCapability(
  root: string,
  value: unknown,
  options: VerificationCapabilityOptions = {},
): VerificationCapabilityResult {
  return validateCapability(root, value, options, true);
}

/** Validate one exact adapter and bind all of its current file inputs. */
export function bindCurrentVerificationCapability(
  root: string,
  value: unknown,
  options: VerificationCapabilityOptions = {},
): CurrentVerificationCapabilityResult {
  const capability = validateVerificationCapability(root, value, options);
  if (!capability.ok) return capability;
  const validation = validateVerificationContract(value);
  if (!validation.ok) {
    throw new Error("verification-capability-invariant");
  }
  let paths: string[];
  let runnerDigest: string;
  try {
    paths = verificationRunnerFiles(
      options.dependencyOwner ?? root,
      validation.value,
      capability.runnerBindings,
    );
    runnerDigest = verificationEnvironmentDigest(paths);
  } catch {
    return {
      ok: false,
      diagnostic: {
        kind: "verification-adapter",
        verificationId: capability.verificationId,
        code: "runner-missing",
        message: "Installed verification runner changed or is unavailable",
      },
    };
  }
  return {
    ok: true,
    value: {
      verificationId: capability.verificationId,
      runnerBindings: capability.runnerBindings.map((binding) => ({
        ...binding,
        ...(binding.fixedArgs ? { fixedArgs: [...binding.fixedArgs] } : {}),
      })),
      inputSnapshot: snapshotFiles(
        root,
        verificationBoundInputPaths(validation.value),
      ),
      runnerSnapshot: { paths, digest: runnerDigest },
    },
  };
}

export function isVerificationCapabilityCurrent(
  root: string,
  capability: CurrentVerificationCapability,
): boolean {
  try {
    return (
      isCurrent(root, capability.inputSnapshot) &&
      verificationEnvironmentDigest(capability.runnerSnapshot.paths) ===
        capability.runnerSnapshot.digest
    );
  } catch {
    return false;
  }
}

export function verificationRunnerFiles(
  dependencyOwner: string,
  verification: StructuredVerificationContract,
  bindings: readonly VerificationRunnerBinding[],
): string[] {
  const files = bindings.flatMap((binding) => [
    binding.executablePath,
    ...(binding.fixedArgs ?? []).filter((arg) => path.isAbsolute(arg)),
  ]);
  for (const file of [...new Set(files)]) {
    // Keep the launcher identity and explicitly include its resolved bytes:
    // the digest intentionally does not follow arbitrary dependency symlinks.
    const resolved = realpathSync(file);
    files.push(resolved);
    // System runners have no mountSource. Bind their installed package too,
    // including implementation modules and bundled dependencies beyond bin/.
    for (
      let directory = path.dirname(resolved);
      directory !== path.dirname(directory);
      directory = path.dirname(directory)
    ) {
      if (
        lstatSync(path.join(directory, "package.json"), {
          throwIfNoEntry: false,
        })?.isFile()
      ) {
        files.push(directory);
        break;
      }
    }
  }
  for (const step of verificationSteps(verification)) {
    if (
      !("runner" in step) ||
      step.runner.kind === "node" ||
      step.runner.kind === "package-script"
    )
      continue;
    const executable =
      step.kind === "vitest" ? "vitest" : step.runner.executable;
    const file = path.join(dependencyOwner, "node_modules/.bin", executable);
    try {
      files.push(file, realpathSync(file));
    } catch {
      /* Admission owns missing runner diagnostics. */
    }
  }
  return [...new Set(files)];
}

export function validateVerificationAdapterCapability(
  root: string,
  value: unknown,
  options: VerificationCapabilityOptions = {},
): VerificationCapabilityResult {
  return validateCapability(root, value, options, false);
}

function validateCapability(
  root: string,
  value: unknown,
  options: VerificationCapabilityOptions,
  requireInputAvailability: boolean,
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
  return validateAcceptedVerificationCapability(
    root,
    validation.value,
    dependencyOwner,
    options.runnerEnvironment ?? {},
    requireInputAvailability,
    options.executionWritePaths ?? [],
  );
}

function validateAcceptedVerificationCapability(
  root: string,
  verification: StructuredVerificationContract,
  dependencyOwner: string,
  runnerEnvironment: VerificationRunnerEnvironment,
  requireInputAvailability: boolean,
  executionWritePaths: readonly string[],
): VerificationCapabilityResult {
  if (requireInputAvailability) {
    for (const input of verificationInputPaths(verification)) {
      const status = fileStatus(root, input);
      if (status !== "regular") {
        const inputObservation = { path: input, kind: status } as const;
        return adapterFailure(
          verification.id,
          status === "absent" ? "input-missing" : "input-unsafe",
          `verification input ${input} is ${status}`,
          inputObservation,
        );
      }
    }
  }
  const runnerBindings: VerificationRunnerBinding[] = [];
  for (const step of verificationSteps(verification)) {
    const capability = validateAtomicCapability(
      root,
      step,
      dependencyOwner,
      runnerEnvironment,
      executionWritePaths,
    );
    if (!capability.ok) return capability;
    runnerBindings.push(...capability.runnerBindings);
  }
  return capabilitySuccess(verification.id, runnerBindings);
}
