import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type AutostartSystem,
  serviceEnvironment,
} from "../src/service/autostart.ts";
import {
  canUpgrade,
  decodeServiceEntry,
} from "../src/service/contracts/gateway.ts";
import {
  fetchVersions,
  type Installation,
  installation,
  installVersion,
  PACKAGE,
  type PackageCommand,
  type PackageCommands,
  registryCommand,
} from "../src/service/installation.ts";
import {
  installedVersion,
  release,
  releaseForInstallation,
  upgradeService,
} from "../src/service/maintenance.ts";

const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0))
    rmSync(path, { recursive: true, force: true });
});
const routes = [
  "npm",
  "bun",
  "pi-npm",
  "pi-bun",
  "npm-local",
  "bun-local",
] as const;
function fixture(route: Installation["route"]) {
  const home = mkdtempSync(join(tmpdir(), "cadence-installation-"));
  temporary.push(home);
  const agent = join(home, "custom agent"),
    pi = route.startsWith("pi-");
  const prefix = join(
    home,
    pi
      ? "custom agent/npm"
      : route.endsWith("local")
        ? "local project"
        : "custom global",
  );
  const modules = join(
    prefix,
    ...(route === "npm" ? ["lib"] : []),
    "node_modules",
  );
  const root = join(modules, ...PACKAGE.split("/"));
  mkdirSync(root, { recursive: true });
  const manager = route.includes("bun") ? "bun" : "npm";
  const settings = join(agent, "settings.json");
  if (pi)
    writeFileSync(
      settings,
      JSON.stringify({
        packages: [{ source: `npm:${PACKAGE}`, skills: [] }, "npm:unrelated"],
        ...(manager === "bun" ? { npmCommand: ["bun"] } : {}),
        unrelated: "preserved",
      }),
    );
  writeFileSync(
    join(prefix, "package.json"),
    JSON.stringify({
      dependencies: { [PACKAGE]: "^1.0.0", unrelated: "^1.0.0" },
    }),
  );
  writeFileSync(
    join(prefix, manager === "bun" ? "bun.lock" : "package-lock.json"),
    "{}",
  );
  const setVersion = (version: string) =>
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: PACKAGE, version }),
    );
  setVersion("1.0.0");
  const s: AutostartSystem = {
    home,
    root,
    env: { HOME: home, PI_CODING_AGENT_DIR: agent },
    platform: "linux",
    node: process.execPath,
    unit: "cadence.service",
    uid: process.getuid?.() ?? 1000,
    cgroup: () => undefined,
    systemctl: () => {
      throw new Error("no service manager during discovery");
    },
    linger: () => undefined,
    enableLinger: () => false,
    launchctl: () => ({ status: 1, stdout: "" }),
    reg: () => ({ status: 1, stdout: "" }),
    launch: () => false,
    stopOwner: async () => "stopped",
    ownerStatus: async () => "absent",
  };
  const calls: {
    manager: string;
    args: string[];
    show?: boolean;
    options?: Parameters<PackageCommand>[2];
  }[] = [];
  let stopped = false;
  const command =
    (name: string): PackageCommand =>
    async (args, show, options) => {
      calls.push({ manager: name, args, show, options });
      if (args[0] === "root")
        return {
          status: 0,
          stdout: `${route === "npm" ? modules : join(home, "elsewhere", "lib", "node_modules")}\n`,
        };
      if (args[0] === "pm")
        return {
          status: route === "bun" ? 0 : 1,
          stdout: `${prefix} node_modules (12 installed)\n└── ${PACKAGE}@1.0.0\n`,
        };
      if (args[0] === "view" || args[0] === "info")
        return {
          status: 0,
          stdout: JSON.stringify({
            ...(args[0] === "info" ? { name: PACKAGE } : {}),
            version: "2.0.0",
            deprecated: false,
          }),
        };
      if (args[0] === "cache" || args.includes("--ignore-scripts")) {
        expect(stopped).toBe(false);
        if (name === "bun") {
          const stage = args[args.indexOf("--cwd") + 1];
          expect(stage).not.toBe(prefix);
          expect(
            JSON.parse(readFileSync(join(stage, "package.json"), "utf8")),
          ).toEqual({ private: true });
        }
      } else {
        expect(stopped).toBe(true);
        const version = args.at(-1)?.split("@").at(-1) ?? "";
        setVersion(version);
      }
      return { status: 0, stdout: "" };
    };
  const commands: PackageCommands = {
    npm: command("npm"),
    bun: command("bun"),
  };
  return {
    s,
    home,
    prefix,
    modules,
    root,
    settings,
    calls,
    commands,
    manager,
    setVersion,
    stop: () => {
      stopped = true;
    },
  };
}

describe("installation discovery", () => {
  it("keeps manager locations in generated service environments, never registry credentials", () => {
    const f = fixture("bun");
    Object.assign(f.s.env, {
      BUN_INSTALL_GLOBAL_DIR: f.prefix,
      BUN_INSTALL: join(f.home, "bun"),
      XDG_CONFIG_HOME: join(f.home, "config"),
      npm_config_prefix: join(f.home, "npm"),
      NPM_CONFIG_USERCONFIG: join(f.home, "custom.npmrc"),
      NPM_TOKEN: "secret",
      npm_config_registry: "https://secret@registry.invalid",
    });
    const env = Object.fromEntries(serviceEnvironment(f.s));
    expect(env).toMatchObject({
      BUN_INSTALL_GLOBAL_DIR: f.prefix,
      BUN_INSTALL: join(f.home, "bun"),
      XDG_CONFIG_HOME: join(f.home, "config"),
      npm_config_prefix: join(f.home, "npm"),
      NPM_CONFIG_USERCONFIG: join(f.home, "custom.npmrc"),
    });
    expect(env.NPM_TOKEN).toBeUndefined();
    expect(env.npm_config_registry).toBeUndefined();
  });
  it("refuses Bun prefix-local registry files without copying or changing them", async () => {
    const f = fixture("bun-local"),
      file = join(f.prefix, ".npmrc");
    writeFileSync(file, "//registry.invalid/:_authToken=fabricated\n");
    expect(await installation(f.s, f.commands)).toEqual({
      route: "unsupported-install",
    });
    expect(readFileSync(file, "utf8")).toBe(
      "//registry.invalid/:_authToken=fabricated\n",
    );
  });

  it.each(routes)(
    "identifies only the running %s copy without install or registry contact",
    async (route) => {
      const f = fixture(route);
      const result = await installation(f.s, f.commands);
      expect(result).toEqual({ route, manager: f.manager, prefix: f.prefix });
      expect(
        f.calls.every((call) => ["pm", "root"].includes(call.args[0])),
      ).toBe(true);
      const dto = decodeServiceEntry({
        kind: "service",
        version: "1.0.0",
        unit: null,
        upgrade: route,
        work: 0,
        job: null,
      });
      expect(canUpgrade(dto.upgrade)).toBe(true);
    },
  );
  it.each([
    [{ packages: [`npm:${PACKAGE}@1.0.0`] }, "pinned"],
    [{ packages: [{ source: `npm:${PACKAGE}@latest` }] }, "pinned"],
    [
      {
        packages: [`npm:${PACKAGE}`],
        npmCommand: ["mise", "exec", "--", "npm"],
      },
      "unsupported-install",
    ],
    [
      { packages: [`npm:${PACKAGE}`], npmCommand: ["pnpm"] },
      "unsupported-install",
    ],
    [
      { packages: [`npm:${PACKAGE}`, `npm:${PACKAGE}@1.0.0`] },
      "unsupported-install",
    ],
    [{ packages: ["npm:another"] }, "unsupported-install"],
    [null, "unsupported-install"],
  ] as const)(
    "refuses pinned, ambiguous or custom Pi declarations without rewriting them (%j)",
    async (settings, route) => {
      const f = fixture("pi-npm"),
        bytes = JSON.stringify(settings);
      writeFileSync(f.settings, bytes);
      expect(await installation(f.s, f.commands)).toEqual({ route });
      expect(canUpgrade(route)).toBe(false);
      expect(readFileSync(f.settings, "utf8")).toBe(bytes);
      expect(f.calls).toEqual([]);
    },
  );
  it("does not reinterpret another Pi agent's installation as an ordinary local dependency", async () => {
    const f = fixture("pi-npm");
    writeFileSync(
      join(f.prefix, "package.json"),
      JSON.stringify({
        name: "pi-extensions",
        private: true,
        dependencies: { [PACKAGE]: "1.0.0" },
      }),
    );
    writeFileSync(
      f.settings,
      JSON.stringify({ packages: [`npm:${PACKAGE}@1.0.0`] }),
    );
    f.s.env.PI_CODING_AGENT_DIR = join(f.home, "different-agent");
    expect(await installation(f.s, f.commands)).toEqual({
      route: "unsupported-install",
    });
  });
  it("does not bypass an unselected Pi prefix through Bun's global-directory proof", async () => {
    const f = fixture("pi-bun");
    writeFileSync(
      join(f.prefix, "package.json"),
      JSON.stringify({
        name: "pi-extensions",
        private: true,
        dependencies: { [PACKAGE]: "1.0.0" },
      }),
    );
    f.s.env.PI_CODING_AGENT_DIR = join(f.home, "different-agent");
    f.commands.bun = async () => ({
      status: 0,
      stdout: `${f.prefix} node_modules (1)\n`,
    });
    expect(await installation(f.s, f.commands)).toEqual({
      route: "unsupported-install",
    });
  });
  it("does not reinterpret Pi's temporary prefix as a local install", async () => {
    const f = fixture("npm-local");
    writeFileSync(
      join(f.prefix, "package.json"),
      JSON.stringify({
        name: "pi-extensions",
        private: true,
        dependencies: { [PACKAGE]: "1.0.0" },
      }),
    );
    expect(await installation(f.s, f.commands)).toEqual({
      route: "unsupported-install",
    });
  });
  it("preserves unreadable Pi settings and refuses a missing declaration", async () => {
    const f = fixture("pi-npm");
    writeFileSync(f.settings, "{unfinished");
    expect(await installation(f.s, f.commands)).toEqual({
      route: "unsupported-install",
    });
    expect(readFileSync(f.settings, "utf8")).toBe("{unfinished");
    rmSync(f.settings);
    expect(await installation(f.s, f.commands)).toEqual({
      route: "unsupported-install",
    });
    expect(existsSync(f.settings)).toBe(false);
  });
  it("does not mistake another global copy or an npm link for the running checkout", async () => {
    const f = fixture("npm"),
      checkout = join(f.home, "checkout");
    mkdirSync(checkout);
    expect(await installation({ ...f.s, root: checkout }, f.commands)).toEqual({
      route: "unsupported-install",
    });
    rmSync(f.root, { recursive: true });
    symlinkSync(checkout, f.root, "dir");
    expect(await installation({ ...f.s, root: checkout }, f.commands)).toEqual({
      route: "unsupported-install",
    });
  });
  it("refuses a linked scope directory even if the package itself is not a symlink", async () => {
    const f = fixture("npm"),
      scope = join(f.home, "source-scope");
    rmSync(join(f.modules, "@abelxiaoxing"), { recursive: true });
    mkdirSync(join(scope, "cadence"), { recursive: true });
    symlinkSync(scope, join(f.modules, "@abelxiaoxing"), "dir");
    expect(
      await installation({ ...f.s, root: join(scope, "cadence") }, f.commands),
    ).toEqual({ route: "unsupported-install" });
  });
  it("does not let Bun's directory listing steal an npm-managed prefix", async () => {
    const f = fixture("npm-local");
    f.commands.bun = async () => ({
      status: 0,
      stdout: `${f.prefix} node_modules (1)\n`,
    });
    expect(await installation(f.s, f.commands)).toEqual({
      route: "npm-local",
      manager: "npm",
      prefix: f.prefix,
    });
  });
  it("refuses mixed manager evidence even at Bun's configured global directory", async () => {
    const f = fixture("bun");
    writeFileSync(join(f.prefix, "package-lock.json"), "{}");
    expect(await installation(f.s, f.commands)).toEqual({
      route: "unsupported-install",
    });
  });
  it("recognizes npm's shrinkwrap as manager evidence without a package-lock", async () => {
    const f = fixture("npm-local");
    rmSync(join(f.prefix, "package-lock.json"));
    writeFileSync(join(f.prefix, "npm-shrinkwrap.json"), "{}");
    expect(await installation(f.s, f.commands)).toEqual({
      route: "npm-local",
      manager: "npm",
      prefix: f.prefix,
    });
  });
  it("Bun global discovery needs no npm executable and accepts its current output", async () => {
    const f = fixture("bun");
    f.commands.npm = async () => {
      throw new Error("must not use npm");
    };
    f.commands.bun = async () => ({
      status: 0,
      stdout: `${f.prefix} node_modules (12)\n`,
    });
    expect((await installation(f.s, f.commands)).route).toBe("bun");
  });
  it.each([
    "both locks",
    "no lock",
    "transitive",
    "file source",
    "wrong manager",
  ])("refuses unproven local installations: %s", async (condition) => {
    const f = fixture("npm-local");
    if (condition === "both locks")
      writeFileSync(join(f.prefix, "bun.lock"), "{}");
    if (condition === "no lock") rmSync(join(f.prefix, "package-lock.json"));
    if (condition === "transitive")
      writeFileSync(join(f.prefix, "package.json"), "{}");
    if (condition === "file source")
      writeFileSync(
        join(f.prefix, "package.json"),
        JSON.stringify({ dependencies: { [PACKAGE]: "file:../source" } }),
      );
    if (condition === "wrong manager")
      writeFileSync(
        join(f.prefix, "package.json"),
        JSON.stringify({
          dependencies: { [PACKAGE]: "1.0.0" },
          packageManager: "pnpm@10",
        }),
      );
    expect(await installation(f.s, f.commands)).toEqual({
      route: "unsupported-install",
    });
  });
  it.skipIf(process.getuid?.() === 0)(
    "refuses a prefix this account cannot write",
    async () => {
      const f = fixture("npm");
      chmodSync(f.prefix, 0o500);
      try {
        expect(await installation(f.s, f.commands)).toEqual({
          route: "not-writable",
        });
      } finally {
        chmodSync(f.prefix, 0o700);
      }
    },
  );
});

describe("manager-preserving upgrade", () => {
  it.each(["pi-npm", "npm-local", "npm"] as const)(
    "pins npm's %s scope for reads, downloads and installation despite inherited global settings",
    async (route) => {
      const f = fixture(route),
        selected = await installation(f.s, f.commands);
      if (!("manager" in selected)) throw new Error("expected installation");
      const args: string[][] = [];
      f.commands.npm = async (a) => {
        args.push(a);
        return { status: 0, stdout: "" };
      };
      await registryCommand(
        selected,
        f.commands,
      )(["view", `${PACKAGE}@latest`, "version", "deprecated", "--json"]);
      await fetchVersions(selected, ["2.0.0"], f.commands);
      await installVersion(selected, "2.0.0", f.commands);
      for (const a of args) {
        expect(a).toContain(route === "npm" ? "--global" : "--global=false");
        expect(a[a.indexOf("--prefix") + 1]).toBe(f.prefix);
      }
    },
  );
  it("reads Bun's complete metadata rather than silently ignoring deprecation on single-field info implementations", async () => {
    const result = await release(
      undefined,
      async (args) => ({
        status: 0,
        stdout: JSON.stringify(
          args.includes("version")
            ? "2.0.0"
            : {
                name: PACKAGE,
                version: "2.0.0",
                deprecated: "Withdrawn",
                dist: { tarball: "https://registry.invalid/never.tgz" },
              },
        ),
      }),
      "bun",
    );
    expect(result).toEqual({ version: "2.0.0", deprecated: true });
  });
  it("does not overwrite an unready new owner unless its orderly Stop is confirmed", async () => {
    const f = fixture("pi-npm");
    let stops = 0;
    const result = await upgradeService(f.s, undefined, {
      commands: f.commands,
      stop: async () => {
        f.stop();
        return { status: ++stops === 1 ? "stopped" : "unconfirmed" };
      },
      restart: async () => false,
    });
    expect(result).toMatchObject({
      reason: "stop-unconfirmed",
      version: "2.0.0",
    });
    expect(stops).toBe(2);
    expect(f.calls.filter((c) => c.args[0] === "install")).toHaveLength(1);
  });
  it("joins the new owner's Stop before reinstalling the old version", async () => {
    const f = fixture("pi-npm"),
      order: string[] = [],
      original = f.commands.npm;
    f.commands.npm = async (args, show, options) => {
      if (args[0] === "install") order.push(args.at(-1) ?? "");
      return original(args, show, options);
    };
    const ready = [false, true];
    await upgradeService(f.s, undefined, {
      commands: f.commands,
      stop: async () => {
        order.push("stop");
        f.stop();
        return { status: "stopped" };
      },
      restart: async () => {
        order.push("restart");
        return ready.shift() ?? false;
      },
    });
    expect(order).toEqual([
      "stop",
      `${PACKAGE}@2.0.0`,
      "restart",
      "stop",
      `${PACKAGE}@1.0.0`,
      "restart",
    ]);
  });

  it.each(routes)(
    "fetches, upgrades and rolls back in the same %s installation",
    async (route) => {
      const f = fixture(route),
        ready = [false, true];
      const before = route.startsWith("pi-")
        ? readFileSync(f.settings, "utf8")
        : null;
      const result = await upgradeService(f.s, undefined, {
        commands: f.commands,
        stop: async () => {
          f.stop();
          return { status: "stopped" };
        },
        restart: async () => ready.shift() ?? false,
      });
      expect(result).toMatchObject({
        status: "rolled-back",
        from: "1.0.0",
        to: "2.0.0",
        version: "1.0.0",
      });
      const writes = f.calls.filter(
        (call) =>
          ["add", "install"].includes(call.args[0]) &&
          !call.args.includes("--ignore-scripts"),
      );
      expect(writes).toHaveLength(2);
      for (const [index, call] of writes.entries()) {
        expect(call.manager).toBe(f.manager);
        expect(call.args.at(-1)).toBe(
          `${PACKAGE}@${index === 0 ? "2.0.0" : "1.0.0"}`,
        );
        expect(call.args).toContain(f.prefix);
        expect(call.args.includes("--global")).toBe(
          route === "npm" || route === "bun",
        );
        expect(call.args.includes("--legacy-peer-deps")).toBe(
          route === "pi-npm",
        );
        expect(call.args.includes("--omit=peer")).toBe(route === "pi-bun");
        if (route === "bun")
          expect(call.options?.env?.BUN_INSTALL_GLOBAL_DIR).toBe(f.prefix);
      }
      for (const call of f.calls.filter((c) =>
        c.args.includes("--ignore-scripts"),
      ))
        expect(existsSync(call.args[call.args.indexOf("--cwd") + 1])).toBe(
          false,
        );
      if (before !== null)
        expect(readFileSync(f.settings, "utf8")).toBe(before);
    },
  );
  it("refuses registry metadata for a different exact version before fetching or stopping", async () => {
    const f = fixture("pi-npm");
    expect(
      await upgradeService(f.s, "3.0.0", {
        commands: f.commands,
        stop: async () => {
          throw new Error("must stay running");
        },
        restart: async () => false,
      }),
    ).toMatchObject({ status: "failed", reason: "fetch-failed" });
    expect(f.calls.map((call) => call.args[0])).toEqual(["view"]);
  });
  it("uses Bun's registry metadata without requiring npm and accepts an omitted deprecation field", async () => {
    const calls: string[][] = [];
    const command: PackageCommand = async (args) => {
      calls.push(args);
      return {
        status: 0,
        stdout: JSON.stringify({ name: PACKAGE, version: "2.0.0", dist: {} }),
      };
    };
    expect(await release(undefined, command, "bun")).toEqual({
      version: "2.0.0",
      deprecated: false,
    });
    expect(calls).toEqual([["info", `${PACKAGE}@latest`, "--json"]]);
  });
  it.each(["pinned", "not-writable", "unsupported-install"] as const)(
    "does not substitute npm's registry for a refused %s installation",
    async (route) => {
      const forbidden: PackageCommand = async () => {
        throw new Error("must not query a guessed registry");
      };
      expect(
        await releaseForInstallation(
          { route },
          { npm: forbidden, bun: forbidden },
        ),
      ).toBeUndefined();
    },
  );
  it("rejects malformed Bun metadata and retains empty deprecation notices", async () => {
    for (const value of [
      null,
      "2.0.0",
      [],
      [{ name: PACKAGE, version: "2.0.0" }],
      { version: "2.0.0" },
      { name: "other", version: "2.0.0" },
      { name: PACKAGE, version: "latest" },
    ])
      expect(
        await release(
          undefined,
          async () => ({ status: 0, stdout: JSON.stringify(value) }),
          "bun",
        ),
      ).toBeUndefined();
    expect(
      await release(
        undefined,
        async () => ({
          status: 0,
          stdout: JSON.stringify({
            name: PACKAGE,
            version: "2.0.0",
            deprecated: "",
          }),
        }),
        "bun",
      ),
    ).toEqual({ version: "2.0.0", deprecated: true });
    expect(
      await release(
        undefined,
        async () => ({
          status: 1,
          stdout: JSON.stringify({ name: PACKAGE, version: "2.0.0" }),
        }),
        "bun",
      ),
    ).toBeUndefined();
  });
  it("a failed Bun prefetch leaves the live installation running and removes only its staging", async () => {
    const f = fixture("pi-bun"),
      original = f.commands.bun;
    let stage = "";
    f.commands.bun = async (args, show, options) => {
      if (args.includes("--ignore-scripts")) {
        stage = args[args.indexOf("--cwd") + 1];
        return { status: 1, stdout: "" };
      }
      return original(args, show, options);
    };
    const result = await upgradeService(f.s, undefined, {
      commands: f.commands,
      stop: async () => {
        throw new Error("must stay running");
      },
      restart: async () => {
        throw new Error("must stay running");
      },
    });
    expect(result).toMatchObject({ status: "failed", reason: "fetch-failed" });
    expect(stage).not.toBe("");
    expect(existsSync(stage)).toBe(false);
    expect(installedVersion(f.root)).toBe("1.0.0");
    expect(existsSync(f.settings)).toBe(true);
  });
  it("a declaration pinned while downloading refuses before Stop", async () => {
    const f = fixture("pi-npm"),
      original = f.commands.npm;
    f.commands.npm = async (args, show, options) => {
      const result = await original(args, show, options);
      if (args[0] === "cache")
        writeFileSync(
          f.settings,
          JSON.stringify({ packages: [`npm:${PACKAGE}@1.0.0`] }),
        );
      return result;
    };
    expect(
      await upgradeService(f.s, undefined, {
        commands: f.commands,
        stop: async () => {
          throw new Error("must stay running");
        },
        restart: async () => false,
      }),
    ).toMatchObject({ status: "failed", reason: "refused" });
  });
  it("restores a partially removed package after an install failure instead of restarting the broken copy", async () => {
    const f = fixture("pi-npm"),
      original = f.commands.npm,
      restarted: string[] = [];
    f.commands.npm = async (args, show, options) => {
      if (args[0] === "install" && args.at(-1) === `${PACKAGE}@2.0.0`) {
        rmSync(join(f.root, "package.json"));
        return { status: 1, stdout: "" };
      }
      return original(args, show, options);
    };
    expect(
      await upgradeService(f.s, undefined, {
        commands: f.commands,
        stop: async () => {
          f.stop();
          return { status: "stopped" };
        },
        restart: async () => {
          restarted.push(installedVersion(f.root));
          return true;
        },
      }),
    ).toMatchObject({
      status: "failed",
      reason: "install-failed",
      version: "1.0.0",
    });
    expect(restarted).toEqual(["1.0.0"]);
  });
  it("never claims successful installation when the package manager updated another copy", async () => {
    const f = fixture("pi-bun"),
      original = f.commands.bun;
    f.commands.bun = async (args, show, options) =>
      args[0] === "add" && !args.includes("--ignore-scripts")
        ? { status: 0, stdout: "" }
        : original(args, show, options);
    expect(
      await upgradeService(f.s, undefined, {
        commands: f.commands,
        stop: async () => {
          f.stop();
          return { status: "stopped" };
        },
        restart: async () => true,
      }),
    ).toMatchObject({
      status: "failed",
      reason: "install-failed",
      version: "1.0.0",
    });
  });
});
