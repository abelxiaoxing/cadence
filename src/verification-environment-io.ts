import {
  constants,
  cpSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { ExecutionProfile } from "./execution-profile.ts";
import type { IsolationMount } from "./isolation-backend.ts";
import type { VerificationRunnerBinding } from "./verification-capability.ts";

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
export function prepareVerificationEnvironmentIo(
  root: string,
  dependencyOwner: string,
  runnerBindings: readonly VerificationRunnerBinding[],
  profile: ExecutionProfile,
  environment: NodeJS.ProcessEnv,
  checkCancelled: () => void,
  privateRoot: string,
) {
  const cleanup = () => rmSync(privateRoot, { recursive: true, force: true });
  try {
    const local = profile.mode === "local-trusted";
    if (local && realpathSync(root) === realpathSync(dependencyOwner))
      throw new Error("trusted-candidate-required");
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
      let viewEntries = 0;
      const projectEntry = (name: string) => {
        checkCancelled();
        if (++viewEntries > 20_000)
          throw new Error("dependency-view-too-large");
        if (CACHES.includes(name)) return;
        const source = path.join(dependencies, name);
        const placeholder = path.join(view, name);
        const entry = lstatSync(source);
        if (entry.isSymbolicLink()) {
          const resolved = realpathSync(source);
          if (within(canonical, resolved)) {
            symlinkSync(
              path.relative(path.dirname(source), resolved),
              placeholder,
            );
          } else if (within(realpathSync(dependencyOwner), resolved)) {
            const relative = path.relative(
              realpathSync(dependencyOwner),
              resolved,
            );
            const candidate = path.join(root, relative);
            if (!lstatSync(candidate, { throwIfNoEntry: false }))
              throw new Error("workspace-dependency-missing");
            symlinkSync(
              local
                ? candidate
                : `/workspace/${relative.split(path.sep).join("/")}`,
              placeholder,
            );
          } else throw new Error("dependency-path-unsafe");
        } else if (
          entry.isDirectory() &&
          name.startsWith("@") &&
          !name.includes(path.sep)
        ) {
          mkdirSync(placeholder);
          for (const child of readdirSync(source))
            projectEntry(path.join(name, child));
        } else {
          if (entry.isDirectory()) mkdirSync(placeholder);
          else if (entry.isFile()) writeFileSync(placeholder, "");
          else throw new Error("dependency-path-unsafe");
          mounts.push({
            source,
            target: `/workspace/node_modules/${name.split(path.sep).join("/")}`,
          });
        }
      };
      for (const name of entries) projectEntry(name);
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
    if (local && stat) {
      // Private copies keep package caches/writes away from consumer dependencies.
      const copyEntry = (name: string) => {
        checkCancelled();
        const source = path.join(dependencies, name);
        const destination = path.join(root, "node_modules", name);
        if (CACHES.includes(name)) {
          mkdirSync(destination, { recursive: true });
          return;
        }
        removeEntry(destination, checkCancelled);
        const stat = lstatSync(source);
        if (stat.isSymbolicLink()) {
          const resolved = realpathSync(source);
          const translated = within(canonicalRoot(dependencyOwner), resolved)
            ? path.join(
                root,
                path.relative(canonicalRoot(dependencyOwner), resolved),
              )
            : resolved;
          symlinkSync(translated, destination);
        } else if (
          stat.isDirectory() &&
          name.startsWith("@") &&
          !name.includes(path.sep)
        ) {
          mkdirSync(destination);
          for (const child of readdirSync(source))
            copyEntry(path.join(name, child));
        } else
          cpSync(source, destination, {
            recursive: true,
            filter: () => {
              checkCancelled();
              return true;
            },
            mode: constants.COPYFILE_FICLONE,
            verbatimSymlinks: true,
          });
      };
      for (const name of readdirSync(path.join(privateRoot, "dependencies")))
        copyEntry(name);
    }

    const sources = new Map<string, string>();
    const bindings = runnerBindings.map((binding) => {
      if (local || !binding.mountSource) return { ...binding };
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
    checkCancelled();
    return {
      privateRoot,
      mounts,
      bindings,
      reportRoot: local ? privateRoot : "/cadence",
      environment: {
        ...(local
          ? Object.fromEntries(
              profile.inheritEnvironment.flatMap((name) =>
                environment[name] === undefined
                  ? []
                  : [[name, environment[name] ?? ""]],
              ),
            )
          : {}),
        CI: "1",
        HOME: local ? path.join(privateRoot, "home") : "/cadence/home",
        XDG_CACHE_HOME: local
          ? path.join(privateRoot, "cache")
          : "/cadence/cache",
        TMPDIR: local ? path.join(privateRoot, "tmp") : "/cadence/tmp",
        npm_config_cache: local
          ? path.join(privateRoot, "cache/npm")
          : "/cadence/cache/npm",
        npm_config_userconfig: local
          ? path.join(privateRoot, "home/user.npmrc")
          : "/cadence/home/user.npmrc",
        npm_config_globalconfig: local
          ? path.join(privateRoot, "home/global.npmrc")
          : "/cadence/home/global.npmrc",
        PATH: [
          ...new Set(
            // Honor explicitly resolved private runtimes before system fallbacks.
            [
              ...bindings.filter((binding) => binding.mountSource),
              ...bindings.filter((binding) => !binding.mountSource),
            ].map((binding) => path.posix.dirname(binding.executablePath)),
          ),
          ...(local ? (environment.PATH ?? "").split(path.delimiter) : []),
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

function canonicalRoot(root: string): string {
  return realpathSync(root);
}

/** Per-entry cancellation, including replacement of an earlier dependency view. */
function removeEntry(file: string, checkCancelled: () => void): void {
  checkCancelled();
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (!stat) return;
  if (stat.isDirectory())
    for (const name of readdirSync(file))
      removeEntry(path.join(file, name), checkCancelled);
  rmSync(file, { recursive: stat.isDirectory(), force: true });
}
