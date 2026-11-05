/** SDK-free package-manager selection for the exact copy running the service.
 * Discovery never installs anything or rewrites Pi's package declarations. */
import { spawn } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { type AutostartSystem, agentDirectory } from "./autostart.ts";
import type { ServiceEntry } from "./contracts/gateway.ts";

export const PACKAGE = "@abelxiaoxing/cadence";
/** One metadata query, or one install including dependencies. */
const VIEW_MS = 30_000;
const INSTALL_MS = 15 * 60_000;
export type PackageCommand = (
  args: string[],
  show?: boolean,
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
) => Promise<{ status: number | null; stdout: string }>;
export type PackageCommands = Record<"npm" | "bun", PackageCommand>;

/** Use the service account's configuration, never the agent's project cwd.
 * Shown package output goes to stderr; stdout remains the CLI result. */
export function packageCommands(s: AutostartSystem): PackageCommands {
  const command =
    (name: string): PackageCommand =>
    (args, show = false, options) =>
      new Promise((resolve) => {
        const child = spawn(name, args, {
          cwd: options?.cwd ?? s.home,
          env: { ...s.env, HOME: s.home, ...options?.env },
          stdio: ["ignore", show ? 2 : "pipe", show ? 2 : "ignore"],
          timeout: show ? INSTALL_MS : VIEW_MS,
          windowsHide: true,
        });
        let stdout = "";
        child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
          if (stdout.length < 1 << 20) stdout += chunk;
        });
        child.once("error", () => resolve({ status: null, stdout: "" }));
        child.once("close", (status) => resolve({ status, stdout }));
      });
  return { npm: command("npm"), bun: command("bun") };
}

export type UpgradeRoute = ServiceEntry["upgrade"];
export interface Installation {
  route: "npm" | "bun" | "pi-npm" | "pi-bun" | "npm-local" | "bun-local";
  manager: "npm" | "bun";
  /** The package-manager project/prefix, not the package itself. */
  prefix: string;
}
export type InstallationResult =
  | Installation
  | {
      route: "unsupported-install" | "not-writable" | "pinned";
    };
const unsupported = (): InstallationResult => ({
  route: "unsupported-install",
});

function sameCopy(modules: string, root: string): boolean {
  try {
    const path = join(modules, ...PACKAGE.split("/"));
    // npm link / isolated-store symlinks do not identify a replaceable copy
    // at the service's fixed path. Never turn a checkout into an npm install.
    return (
      !lstatSync(path).isSymbolicLink() &&
      realpathSync(path) === realpathSync(root) &&
      realpathSync(path) === join(realpathSync(modules), ...PACKAGE.split("/"))
    );
  } catch {
    return false;
  }
}
/** Listing a directory with Bun does not prove Bun installed it: pm ls also
 * reads npm trees. Only an unambiguous manager lock identifies a local prefix. */
function prefixManager(prefix: string): "npm" | "bun" | undefined {
  const npm =
    existsSync(join(prefix, "package-lock.json")) ||
    existsSync(join(prefix, "npm-shrinkwrap.json"));
  const bun =
    existsSync(join(prefix, "bun.lock")) ||
    existsSync(join(prefix, "bun.lockb"));
  return npm === bun ? undefined : bun ? "bun" : "npm";
}

function writable(
  installation: Installation,
  modules: string,
  root: string,
): InstallationResult {
  // Bun's staging must use the same user-level registry configuration as
  // the real install. Prefix-local registry files cannot be transplanted to
  // staging (they may contain credentials); leave those setups to a terminal.
  if (
    installation.manager === "bun" &&
    [".npmrc", "bunfig.toml", ".bunfig.toml"].some((name) =>
      existsSync(join(installation.prefix, name)),
    )
  )
    return unsupported();
  try {
    for (const path of [installation.prefix, modules, dirname(root), root])
      accessSync(path, constants.W_OK);
    for (const name of [
      "package.json",
      "package-lock.json",
      "npm-shrinkwrap.json",
      "bun.lock",
      "bun.lockb",
    ])
      if (existsSync(join(installation.prefix, name)))
        accessSync(join(installation.prefix, name), constants.W_OK);
    return installation;
  } catch {
    return { route: "not-writable" };
  }
}

/** Pi's user-scope npm directory is independent of npm/Bun's global prefix.
 * Its settings select the manager. Custom wrappers and pinned declarations
 * need an explicit terminal update, not a guessed command or a settings edit. */
export async function installation(
  s: AutostartSystem,
  commands: PackageCommands,
): Promise<InstallationResult> {
  const agent = agentDirectory(s),
    piPrefix = join(agent, "npm");
  if (sameCopy(join(piPrefix, "node_modules"), s.root)) {
    try {
      const settings = JSON.parse(
        readFileSync(join(agent, "settings.json"), "utf8"),
      );
      if (!settings || !Array.isArray(settings.packages)) return unsupported();
      const sources = settings.packages
        .map((p: unknown) =>
          typeof p === "string"
            ? p
            : p && typeof p === "object" && "source" in p
              ? p.source
              : undefined,
        )
        .filter(
          (source: unknown): source is string =>
            typeof source === "string" &&
            (source === `npm:${PACKAGE}` ||
              source.startsWith(`npm:${PACKAGE}@`)),
        );
      if (sources.length !== 1) return unsupported();
      if (sources[0] !== `npm:${PACKAGE}`) return { route: "pinned" };
      const command: unknown = settings.npmCommand ?? ["npm"];
      if (
        !Array.isArray(command) ||
        command.length !== 1 ||
        !["npm", "bun"].includes(command[0])
      )
        return unsupported();
      const manager = command[0] as "npm" | "bun";
      return writable(
        {
          route: manager === "npm" ? "pi-npm" : "pi-bun",
          manager,
          prefix: piPrefix,
        },
        join(piPrefix, "node_modules"),
        s.root,
      );
    } catch {
      return unsupported();
    }
  }
  const localModules = dirname(dirname(s.root)),
    local = dirname(localModules);
  const manifest = (() => {
    try {
      return JSON.parse(readFileSync(join(local, "package.json"), "utf8"));
    } catch {
      return undefined;
    }
  })();
  // Pi names its managed npm projects, including temporary installs,
  // pi-extensions. Neither a local fallback nor a coincidentally configured
  // Bun globalDir may bypass the selected agent's declaration/pin boundary.
  if (
    manifest?.name === "pi-extensions" ||
    basename(dirname(local)) === ".pi" ||
    (basename(local) === "npm" &&
      existsSync(join(dirname(local), "settings.json")))
  )
    return unsupported();
  // Ask Bun for its actual global directory (including custom bunfig.toml),
  // not a guess derived from ~/.bun/bin. A sibling copy is never selected.
  const bun = await commands.bun(["pm", "ls", "--global"]);
  const bunPrefix =
    bun.status === 0
      ? /^(\/[^\r\n]+) node_modules(?: \(\d+(?: installed)?\))?\r?$/.exec(
          bun.stdout.split("\n")[0],
        )?.[1]
      : undefined;
  if (bunPrefix && sameCopy(join(bunPrefix, "node_modules"), s.root)) {
    const manager = prefixManager(bunPrefix);
    if (manager === "bun")
      return writable(
        { route: "bun", manager: "bun", prefix: bunPrefix },
        join(bunPrefix, "node_modules"),
        s.root,
      );
    if (!manager) return unsupported();
    // An npm-only lock is not a Bun installation even if its configured
    // globalDir points here. Continue with npm's global/local proofs.
  }
  const npm = await commands.npm(["root", "--global"]);
  const modules = npm.status === 0 ? npm.stdout.trim() : "";
  const prefix = dirname(dirname(modules));
  // Linux npm global layout; never accept malformed/relative output.
  if (
    isAbsolute(modules) &&
    modules === join(prefix, "lib", "node_modules") &&
    sameCopy(modules, s.root)
  )
    return writable({ route: "npm", manager: "npm", prefix }, modules, s.root);
  // Direct local installs need a top-level declaration and one manager's
  // lockfile. Transitive dependencies, project-local Pi installs and checkouts
  // cannot be inferred from a node_modules-looking path alone.
  if (
    basename(localModules) !== "node_modules" ||
    !sameCopy(localModules, s.root)
  )
    return unsupported();
  try {
    if (
      ![
        manifest.dependencies,
        manifest.devDependencies,
        manifest.optionalDependencies,
      ].some(
        (deps) =>
          deps &&
          typeof deps[PACKAGE] === "string" &&
          /^(?:[~^]?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?|latest)$/.test(
            deps[PACKAGE],
          ),
      )
    )
      return unsupported();
    const manager = prefixManager(local);
    if (!manager) return unsupported();
    if (
      manifest.packageManager !== undefined &&
      (typeof manifest.packageManager !== "string" ||
        !manifest.packageManager.startsWith(`${manager}@`))
    )
      return unsupported();
    return writable(
      {
        route: manager === "bun" ? "bun-local" : "npm-local",
        manager,
        prefix: local,
      },
      localModules,
      s.root,
    );
  } catch {
    return unsupported();
  }
}

export async function upgradeRoute(
  s: AutostartSystem,
  commands = packageCommands(s),
): Promise<UpgradeRoute> {
  return (await installation(s, commands)).route;
}

/** CLI flags override npmrc/environment defaults. Reads/cache must use the
 * same scope as the real install: npm ignores project npmrc in global mode. */
function npmScope(i: Installation): string[] {
  return [
    i.route === "npm" ? "--global" : "--global=false",
    "--prefix",
    i.prefix,
  ];
}

/** Metadata uses the installation's own npm project configuration too. */
export function registryCommand(
  i: Installation,
  commands: PackageCommands,
): PackageCommand {
  return (args, show) =>
    commands[i.manager](
      i.manager === "npm" ? [args[0], ...npmScope(i), ...args.slice(1)] : args,
      show,
      { cwd: i.prefix },
    );
}

export function installVersion(
  i: Installation,
  version: string,
  commands: PackageCommands,
) {
  const spec = `${PACKAGE}@${version}`;
  if (i.manager === "npm")
    return commands.npm(
      [
        "install",
        ...npmScope(i),
        ...(i.route === "pi-npm" ? ["--legacy-peer-deps"] : []),
        "--no-audit",
        "--no-fund",
        spec,
      ],
      true,
      { cwd: i.prefix },
    );
  return commands.bun(
    [
      "add",
      ...(i.route === "bun"
        ? ["--global"]
        : i.route === "pi-bun"
          ? ["--omit=peer"]
          : []),
      "--cwd",
      i.prefix,
      "--exact",
      spec,
    ],
    true,
    { env: i.route === "bun" ? { BUN_INSTALL_GLOBAL_DIR: i.prefix } : {} },
  );
}

/** Fetch both exact package bodies before Stop. Bun has no cache-add command
 * on supported installations: install into a fresh private staging project
 * with scripts disabled, never into the live tree. Only this staging is removed. */
export async function fetchVersions(
  i: Installation,
  versions: string[],
  commands: PackageCommands,
): Promise<boolean> {
  try {
    for (const version of versions) {
      const spec = `${PACKAGE}@${version}`;
      if (i.manager === "npm") {
        if (
          (
            await commands.npm(["cache", "add", ...npmScope(i), spec], true, {
              cwd: i.prefix,
            })
          ).status !== 0
        )
          return false;
      } else {
        const stage = mkdtempSync(join(tmpdir(), "cadence-upgrade-"));
        try {
          writeFileSync(
            join(stage, "package.json"),
            JSON.stringify({ private: true }),
          );
          if (
            (
              await commands.bun(
                [
                  "add",
                  "--cwd",
                  stage,
                  "--ignore-scripts",
                  "--no-save",
                  ...(i.route === "pi-bun" ? ["--omit=peer"] : []),
                  spec,
                ],
                true,
              )
            ).status !== 0
          )
            return false;
        } finally {
          rmSync(stage, { recursive: true, force: true });
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}
