import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  type StructuredVerificationContract,
  VERIFICATION_CONFIGURATION_PATHS,
} from "./contracts.ts";
import type { IsolationMount } from "./isolation-backend.ts";
import {
  resolveVerificationRunner,
  type VerificationRunnerBinding,
  validateVerificationAdapterCapability,
  verificationRunnerFiles,
} from "./verification-capability.ts";
import { runWorkspaceIo } from "./workspace-io.ts";

export async function captureVerificationEnvironmentIdentity(
  dependencyOwner: string,
  verifications: readonly StructuredVerificationContract[],
  signal?: AbortSignal,
): Promise<string> {
  const roots = [path.join(dependencyOwner, "node_modules")];
  const node = resolveVerificationRunner("node");
  if (node) roots.push(realpathSync(node.executablePath));
  for (const verification of verifications) {
    // Identity describes installed tools; admission/execution separately owns config authorization.
    const capability = validateVerificationAdapterCapability(
      dependencyOwner,
      verification,
      { executionWritePaths: VERIFICATION_CONFIGURATION_PATHS },
    );
    if (!capability.ok) throw new Error("verification-environment-unavailable");
    roots.push(
      ...verificationRunnerFiles(
        dependencyOwner,
        verification,
        capability.runnerBindings,
      ),
    );
    for (const binding of capability.runnerBindings)
      if (binding.mountSource) roots.push(binding.mountSource);
  }
  return runWorkspaceIo<string>({
    root: dependencyOwner,
    artifactRoot: dependencyOwner,
    operation: "verificationIdentity",
    args: [roots],
    signal,
  });
}

const CACHES = [".vite", ".vite-temp"];
function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

/** A disposable dependency view: immutable packages and independently writable caches. */
export function prepareVerificationEnvironment(
  root: string,
  dependencyOwner: string,
  runnerBindings: readonly VerificationRunnerBinding[],
) {
  const privateRoot = mkdtempSync(
    path.join(path.dirname(root), ".cadence-verification-"),
  );
  const cleanup = () => rmSync(privateRoot, { recursive: true, force: true });
  try {
    const mounts: IsolationMount[] = [
      { source: privateRoot, target: "/cadence", writable: true },
    ];
    for (const directory of [
      "home",
      "cache",
      "tmp",
      "reports",
      "dependencies",
    ]) {
      mkdirSync(path.join(privateRoot, directory), { mode: 0o700 });
    }
    writeFileSync(path.join(privateRoot, "home/user.npmrc"), "");
    writeFileSync(path.join(privateRoot, "home/global.npmrc"), "");
    const dependencies = path.join(dependencyOwner, "node_modules");
    const stat = lstatSync(dependencies, { throwIfNoEntry: false });
    if (stat) {
      const target = path.join(root, "node_modules");
      const targetStat = lstatSync(target, { throwIfNoEntry: false });
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        (targetStat &&
          (!targetStat.isDirectory() || targetStat.isSymbolicLink()))
      ) {
        throw new Error("dependency-path-unsafe");
      }
      if (!targetStat) mkdirSync(target, { mode: 0o700 });
      const view = path.join(privateRoot, "dependencies");
      mounts.push({ source: view, target: "/workspace/node_modules" });
      const entries = readdirSync(dependencies);
      if (entries.length > 20_000) throw new Error("dependency-view-too-large");
      const canonical = realpathSync(dependencies);
      for (const name of entries) {
        if (CACHES.includes(name)) continue;
        const source = path.join(dependencies, name);
        const placeholder = path.join(view, name);
        const entry = lstatSync(source);
        if (entry.isSymbolicLink()) {
          const link = readlinkSync(source);
          if (
            path.isAbsolute(link) ||
            !within(canonical, realpathSync(source))
          ) {
            throw new Error("dependency-path-unsafe");
          }
          symlinkSync(link, placeholder);
        } else {
          if (entry.isDirectory()) mkdirSync(placeholder);
          else if (entry.isFile()) writeFileSync(placeholder, "");
          else throw new Error("dependency-path-unsafe");
          mounts.push({ source, target: `/workspace/node_modules/${name}` });
        }
      }
      for (const cache of CACHES) {
        mkdirSync(path.join(view, cache));
        const source = path.join(privateRoot, "cache", cache);
        mkdirSync(source);
        mounts.push({
          source,
          target: `/workspace/node_modules/${cache}`,
          writable: true,
        });
      }
    }
    const sources = new Map<string, string>();
    const bindings = runnerBindings.map((binding) => {
      if (!binding.mountSource) return { ...binding };
      const source = path.resolve(binding.mountSource);
      const stat = lstatSync(source);
      const executable = realpathSync(binding.executablePath);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        !within(source, executable)
      ) {
        throw new Error("runner-mount-unavailable");
      }
      let target = sources.get(source);
      if (!target) {
        target = `/cadence-runners/${sources.size}`;
        sources.set(source, target);
        mounts.push({ source, target });
      }
      const translate = (file: string) =>
        path.posix.join(target, ...path.relative(source, file).split(path.sep));
      return {
        ...binding,
        executablePath: translate(executable),
        ...(binding.fixedArgs
          ? {
              fixedArgs: binding.fixedArgs.map((arg) =>
                path.isAbsolute(arg) && within(source, arg)
                  ? translate(arg)
                  : arg,
              ),
            }
          : {}),
      };
    });
    return {
      privateRoot,
      mounts,
      bindings,
      cleanup,
      environment: {
        CI: "1",
        HOME: "/cadence/home",
        XDG_CACHE_HOME: "/cadence/cache",
        TMPDIR: "/cadence/tmp",
        npm_config_cache: "/cadence/cache/npm",
        npm_config_userconfig: "/cadence/home/user.npmrc",
        npm_config_globalconfig: "/cadence/home/global.npmrc",
        PATH: [
          ...new Set(
            // Honor explicitly resolved private runtimes before system fallbacks.
            [
              ...bindings.filter((binding) => binding.mountSource),
              ...bindings.filter((binding) => !binding.mountSource),
            ].map((binding) => path.posix.dirname(binding.executablePath)),
          ),
          "/usr/local/bin",
          "/usr/bin",
          "/bin",
        ].join(":"),
      },
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}
