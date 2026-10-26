import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parseEnvFile } from "../skills/_shared/load-config.mjs";
import { CONFIG_TEMPLATE } from "../src/install-config.mjs";
import { autostartHint, autostartNotice } from "../src/native-client.ts";
import {
  type AutostartSystem,
  autostartStatus,
  buildUnit,
  configureAutostart,
  removeAutostart,
  servicePath,
  serviceUnit,
  stopAutostart,
  unitPath,
} from "../src/service/autostart.ts";
import {
  buildPlist,
  configureLaunchAgent,
  launchAgentStatus,
  plistPath,
  removeLaunchAgent,
  stopLaunchAgent,
} from "../src/service/launchd.ts";
import {
  buildLauncher,
  configureLoginRun,
  launcherPath,
  loginRunStatus,
  RUN_KEY,
  removeLoginRun,
  stopLoginRun,
} from "../src/service/login-run.ts";
import {
  ensureServerConfig,
  serverConfigPath,
} from "../src/service/server-config.ts";
import {
  configureSystemService,
  stopSystemService,
  systemServiceStatus,
} from "../src/service/system-service.ts";

const repository = fileURLToPath(new URL("..", import.meta.url));
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function temporary(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

const AGENT = "com.abelxiaoxing.cadence";
const APPROVED =
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run";
interface Fake {
  s: AutostartSystem;
  home: string;
  calls: string[];
  unit: string;
  state: {
    enabled: string;
    active: boolean;
    linger: boolean | undefined;
    /** launchd job loaded; launchd or Windows owner running */
    loaded: boolean;
    running: boolean;
    disabled: boolean;
    run: boolean;
    approved?: string;
  };
  /** interactive flag of each enable-linger attempt */
  lingerAttempts: boolean[];
  /** what the authenticated orderly Stop answers */
  stop: { reply: string };
}
/** npm global layout (<prefix>/lib/node_modules/@abelxiaoxing/cadence) with
 * its optional Pi SDK. */
function fake(
  options: {
    platform?: NodeJS.Platform;
    auth?: boolean;
    sdk?: boolean;
    /** logind allows enable-linger without a password prompt */
    lingerAllowed?: boolean;
    /** the prompted attempt succeeds */
    lingerPrompt?: boolean;
  } = {},
): Fake {
  const home = temporary("cadence-server-");
  const agent = join(home, ".pi", "agent");
  const root = join(
    home,
    "prefix",
    "lib",
    "node_modules",
    "@abelxiaoxing",
    "cadence",
  );
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(agent, { recursive: true });
  if (options.auth !== false) writeFileSync(join(agent, "auth.json"), "{}");
  if (options.sdk !== false)
    for (const name of ["pi-coding-agent", "pi-ai"]) {
      const sdk = join(root, "node_modules", "@earendil-works", name);
      mkdirSync(sdk, { recursive: true });
      writeFileSync(join(sdk, "package.json"), "{}");
    }
  const platform = options.platform ?? "linux";
  const calls: string[] = [];
  const state: Fake["state"] = {
    enabled: "not-found",
    active: false,
    linger: false,
    loaded: false,
    running: false,
    disabled: false,
    run: false,
  };
  const lingerAttempts: boolean[] = [];
  const stop = { reply: "stopped" };
  const s: AutostartSystem = {
    platform,
    env: {
      PATH: `${root}/node_modules/.bin:/usr/lib/node_modules/npm/node_modules/@npmcli/run-script/lib/node-gyp-bin:/home/u/.bun/bin:/usr/bin:/usr/bin`,
      LANG: "C.UTF-8",
      ...(platform === "win32"
        ? { LOCALAPPDATA: join(home, "AppData", "Local") }
        : {}),
    },
    home,
    node: "/usr/bin/node",
    root,
    unit: "cadence.service",
    uid: 501,
    systemctl(args) {
      calls.push(args.join(" "));
      if (args[0] === "is-enabled")
        return {
          status: state.enabled === "enabled" ? 0 : 1,
          stdout: `${state.enabled}\n`,
        };
      if (args[0] === "is-active")
        return {
          status: state.active ? 0 : 3,
          stdout: state.active ? "active\n" : "inactive\n",
        };
      if (args[0] === "enable") state.enabled = "enabled";
      if (args[0] === "start") state.active = true;
      if (args[0] === "stop") state.active = false;
      if (args.join(" ") === "disable --now cadence.service") {
        state.enabled = "disabled";
        state.active = false;
      }
      return { status: 0, stdout: "" };
    },
    linger: () => state.linger,
    enableLinger(interactive) {
      calls.push(interactive ? "enable-linger --prompt" : "enable-linger");
      lingerAttempts.push(interactive);
      const ok = interactive
        ? options.lingerPrompt !== false
        : options.lingerAllowed !== false;
      if (ok) state.linger = true;
      return ok;
    },
    launchctl(args) {
      calls.push(`launchctl ${args.join(" ")}`);
      switch (args[0]) {
        case "print":
          return {
            status: state.loaded ? 0 : 113,
            stdout: state.loaded
              ? `${args[1]} = {\n\tstate = ${state.running ? "running" : "not running"}\n}\n`
              : "",
          };
        case "print-disabled":
          return {
            status: 0,
            stdout: `disabled services = {\n${state.disabled ? `\t"${AGENT}" => disabled\n` : ""}}\n`,
          };
        case "bootout":
          state.loaded = false;
          state.running = false;
          break;
        case "enable":
          state.disabled = false;
          break;
        case "bootstrap":
          if (state.disabled) return { status: 119, stdout: "" };
          state.loaded = true;
          state.running = true;
      }
      return { status: 0, stdout: "" };
    },
    reg(args) {
      calls.push(`reg ${args.join(" ")}`);
      const approved = args[1] === APPROVED;
      if (args[0] === "query") {
        const value = approved
          ? state.approved && `REG_BINARY    ${state.approved}`
          : state.run && "REG_SZ    (data)";
        return value
          ? { status: 0, stdout: `\r\n    Cadence    ${value}\r\n` }
          : { status: 1, stdout: "" };
      }
      if (args[0] === "add") state.run = true;
      if (args[0] === "delete") {
        if (approved) state.approved = undefined;
        else state.run = false;
      }
      return { status: 0, stdout: "" };
    },
    launch(path) {
      calls.push(`launch ${path}`);
      state.running = true;
      return true;
    },
    async stopOwner(workspace) {
      calls.push(`stop-owner ${workspace}`);
      if (stop.reply === "stopped") state.running = false;
      return stop.reply;
    },
    async ownerStatus(workspace) {
      calls.push(`owner-status ${workspace}`);
      return state.running ? "alive" : "absent";
    },
  };
  const unit = join(
    home,
    ".local",
    "share",
    "systemd",
    "user",
    "cadence.service",
  );
  return { s, home, calls, unit, state, lingerAttempts, stop };
}

// systemd user units are Linux-only; the generated file uses Linux paths/PATH.
describe.skipIf(process.platform !== "linux")("systemd user service", () => {
  it("install writes the unit, enables it, starts ~/cadence on the default route and lingers without a prompt", () => {
    const f = fake();
    expect(configureAutostart(f.s, "install", undefined, true)).toEqual({
      status: "started",
      unit: f.unit,
      workspace: join(f.home, "cadence"),
      linger: "enabled",
    });
    expect(f.lingerAttempts).toEqual([false]);
    expect(existsSync(join(f.home, "cadence"))).toBe(true);
    expect(f.calls).toEqual([
      "show-environment",
      "is-enabled cadence.service",
      "is-active --quiet cadence.service",
      "daemon-reload",
      "enable cadence.service",
      "reset-failed cadence.service",
      "start cadence.service",
      "enable-linger",
    ]);
    const text = readFileSync(f.unit, "utf8");
    const cli = join(f.s.root, "src", "service-cli.mjs");
    const ws = join(f.home, "cadence");
    const config = join(f.home, ".pi", "agent", "cadence", ".env");
    expect(text).toMatch(
      /^# Generated by @abelxiaoxing\/cadence; `cadence server install`/,
    );
    expect(text).toContain(
      `ExecStart="/usr/bin/node" "${cli}" "start" "--foreground" "--workspace" "${ws}" "--server-config" "${config}"\n`,
    );
    expect(text).toContain(
      `ExecStop=-"/usr/bin/node" "${cli}" "stop" "--workspace" "${ws}"`,
    );
    expect(text).toContain(`WorkingDirectory=${ws}\n`);
    expect(text).toContain(`ConditionPathExists=${cli}\n`);
    expect(text).toContain(
      `ConditionPathExists=${join(f.home, ".pi", "agent", "auth.json")}\n`,
    );
    for (const name of ["pi-coding-agent", "pi-ai"])
      expect(text).toContain(
        `ConditionPathExists=${join(f.s.root, "node_modules", "@earendil-works", name, "package.json")}\n`,
      );
    // npm lifecycle bins are not the user's search path.
    expect(text).toContain('Environment="PATH=/home/u/.bun/bin:/usr/bin"');
    expect(text).toContain('Environment="LANG=C.UTF-8"');
    expect(text).not.toContain("PI_CODING_AGENT_DIR");
    expect(text).toContain("KillMode=mixed\n");
    expect(text).toContain("WantedBy=default.target\n");
    // No --port: CADENCE_PORT and CADENCE_TOKEN in the .env select them.
    expect(text).not.toContain("--port");
  });

  it("linger asks for a password only when logind needs authorization, after the start; opt-outs and an existing linger attempt nothing", () => {
    const prompted = fake({ lingerAllowed: false });
    prompted.state.active = true;
    expect(
      configureAutostart(prompted.s, "install", undefined, true),
    ).toMatchObject({ status: "started", linger: "enabled" });
    expect(prompted.lingerAttempts).toEqual([false, true]);
    // An interrupted password prompt must not leave the stopped owner down.
    expect(prompted.calls).toContain("stop cadence.service");
    expect(prompted.calls.slice(-3)).toEqual([
      "start cadence.service",
      "enable-linger",
      "enable-linger --prompt",
    ]);
    const refused = fake({ lingerAllowed: false, lingerPrompt: false });
    expect(
      configureAutostart(refused.s, "install", undefined, true).linger,
    ).toBe("refused");
    const off = fake();
    expect(configureAutostart(off.s, "install", undefined, false).linger).toBe(
      "off",
    );
    const on = fake();
    on.state.linger = true;
    expect(configureAutostart(on.s, "install", undefined, true).linger).toBe(
      "on",
    );
    // No logind answer: nothing is reported or attempted.
    const unknown = fake();
    unknown.state.linger = undefined;
    expect(
      configureAutostart(unknown.s, "install", undefined, true),
    ).not.toHaveProperty("linger");
    for (const g of [off, on, unknown]) expect(g.lingerAttempts).toEqual([]);
  });

  it("without Pi's auth.json the unit is enabled with boot start but not started, avoiding a quarantined first owner", () => {
    const f = fake({ auth: false });
    expect(configureAutostart(f.s, "install", undefined, true)).toMatchObject({
      status: "waiting-for-pi-login",
      linger: "enabled",
    });
    expect(f.calls).toContain("enable cadence.service");
    expect(f.calls).not.toContain("start cadence.service");
  });

  it("restart rewrites the unit with the current Node, stopping with the old definition first, and keeps workspace, enablement and linger", () => {
    const f = fake();
    const ws = join(f.home, "projects", "kept");
    mkdirSync(ws, { recursive: true });
    configureAutostart(f.s, "install", ws);
    f.calls.length = 0;
    f.s.node = "/opt/node-24/bin/node";
    expect(configureAutostart(f.s, "restart")).toEqual({
      status: "started",
      unit: f.unit,
      workspace: ws,
    });
    expect(f.calls).toEqual([
      "show-environment",
      "is-enabled cadence.service",
      "is-active --quiet cadence.service",
      "stop cadence.service",
      "daemon-reload",
      "reset-failed cadence.service",
      "start cadence.service",
    ]);
    expect(f.lingerAttempts).toEqual([]);
    expect(readFileSync(f.unit, "utf8")).toContain(
      'ExecStart="/opt/node-24/bin/node"',
    );
  });

  it("restart needs an installed unit and keeps disable and mask; install re-enables a disabled unit, never a masked one", () => {
    const fresh = fake();
    expect(configureAutostart(fresh.s, "restart")).toEqual({
      status: "absent",
    });
    expect(fresh.calls).toEqual(["show-environment"]);
    expect(existsSync(fresh.unit)).toBe(false);
    expect(existsSync(join(fresh.home, "cadence"))).toBe(false);
    const f = fake();
    configureAutostart(f.s, "install");
    f.state.enabled = "disabled";
    f.state.active = false;
    f.calls.length = 0;
    expect(configureAutostart(f.s, "restart").status).toBe("started");
    expect(f.calls).not.toContain("enable cadence.service");
    expect(f.state.enabled).toBe("disabled");
    f.state.enabled = "masked";
    f.state.active = false;
    f.calls.length = 0;
    expect(configureAutostart(f.s, "restart").status).toBe("masked");
    expect(f.calls.at(-1)).toBe("daemon-reload");
    const masked = configureAutostart(f.s, "install", undefined, true);
    expect(masked.status).toBe("masked");
    expect(masked).not.toHaveProperty("linger");
    expect(f.lingerAttempts).toEqual([]);
    f.state.enabled = "disabled";
    expect(configureAutostart(f.s, "install").status).toBe("started");
    expect(f.state.enabled).toBe("enabled");
  });

  it("a custom Pi agent directory is followed and baked for the service", () => {
    const f = fake();
    const custom = join(f.home, "pi-agent");
    mkdirSync(custom, { recursive: true });
    writeFileSync(join(custom, "auth.json"), "{}");
    f.s.env.PI_CODING_AGENT_DIR = "~/pi-agent";
    expect(configureAutostart(f.s, "install").status).toBe("started");
    const text = readFileSync(f.unit, "utf8");
    expect(text).toContain(`Environment="PI_CODING_AGENT_DIR=${custom}"`);
    expect(text).toContain(`ConditionPathExists=${join(custom, "auth.json")}`);
  });

  it("without a resolvable Pi SDK nothing is written", () => {
    const f = fake({ sdk: false });
    expect(configureAutostart(f.s, "install")).toEqual({
      status: "missing-pi-sdk",
    });
    expect(f.calls).toEqual(["show-environment"]);
    expect(existsSync(f.unit)).toBe(false);
    expect(existsSync(join(f.home, "cadence"))).toBe(false);
  });

  it("foreign unit files and missing user managers are reported without effects", () => {
    const f = fake();
    mkdirSync(join(f.unit, ".."), { recursive: true });
    writeFileSync(f.unit, "[Unit]\nDescription=mine\n");
    for (const result of [
      configureAutostart(f.s, "install"),
      configureAutostart(f.s, "restart"),
      stopAutostart(f.s),
      removeAutostart(f.s),
    ])
      expect(result).toEqual({ status: "foreign", unit: f.unit });
    expect(readFileSync(f.unit, "utf8")).toBe("[Unit]\nDescription=mine\n");
    expect(f.calls).toEqual(["show-environment", "show-environment"]);
    const g = fake();
    g.s.systemctl = (args) => {
      g.calls.push(args.join(" "));
      return { status: 1, stdout: "" };
    };
    expect(configureAutostart(g.s, "install")).toEqual({
      status: "unavailable",
    });
    expect(existsSync(g.unit)).toBe(false);
  });

  it("explicit workspaces must be existing absolute directories", () => {
    const f = fake();
    expect(() => configureAutostart(f.s, "install", "relative/dir")).toThrow();
    expect(() =>
      configureAutostart(f.s, "install", join(f.home, "missing")),
    ).toThrow();
    expect(existsSync(f.unit)).toBe(false);
  });

  it("a home-directory workspace lands on ~/cadence, which restarts then keep", () => {
    const f = fake();
    // ~/.local/state (the unit's default state home) is inside ~.
    expect(configureAutostart(f.s, "install", "~")).toMatchObject({
      status: "started",
      workspace: join(f.home, "cadence"),
      redirectedFrom: f.home,
    });
    expect(readFileSync(f.unit, "utf8")).toContain(
      `WorkingDirectory=${join(f.home, "cadence")}\n`,
    );
    const restart = configureAutostart(f.s, "restart");
    expect(restart).toMatchObject({ workspace: join(f.home, "cadence") });
    expect(restart.redirectedFrom).toBeUndefined();
    // With the state home moved outside, home is used as given.
    const g = fake();
    g.s.env.XDG_STATE_HOME = join(g.home, "..", "state");
    expect(configureAutostart(g.s, "install", "~")).toMatchObject({
      workspace: g.home,
    });
  });

  it("escapes systemd specifiers, variables and quotes; refuses control characters", () => {
    const text = buildUnit({
      node: "/usr/bin/node",
      cli: "/opt/a b/src/service-cli.mjs",
      workspace: '/w/100%$HOME"x',
      serverConfig: "/h/$s%.json",
      agentDir: "/p",
      sdk: [],
      environment: [["LANG", 'a"b\\c%']],
    });
    expect(text).toContain('WorkingDirectory=/w/100%%$HOME"x\n');
    expect(text).toContain(
      'ExecStart="/usr/bin/node" "/opt/a b/src/service-cli.mjs" "start" "--foreground" "--workspace" "/w/100%%$$HOME\\"x" "--server-config" "/h/$$s%%.json"\n',
    );
    expect(text).toContain('Environment="LANG=a\\"b\\\\c%%"');
    expect(() =>
      buildUnit({
        node: "/usr/bin/node",
        cli: "/c",
        workspace: "/w\nExecStartPre=/bin/false",
        serverConfig: "/s",
        agentDir: "/p",
        sdk: [],
        environment: [],
      }),
    ).toThrow();
  });

  it("servicePath drops npm lifecycle entries and relative entries", () => {
    expect(
      servicePath("/x/node_modules/.bin:relative:/npm/node-gyp-bin:/a:/b:/a"),
    ).toBe("/a:/b");
    expect(servicePath(undefined)).toBe("/usr/local/bin:/usr/bin:/bin");
  });

  it("stop goes through ExecStop and keeps the unit enabled; uninstall disables through ExecStop and deletes only the generated unit", () => {
    const f = fake();
    configureAutostart(f.s, "install");
    expect(autostartStatus(f.s)).toEqual({
      status: "active",
      enabled: "enabled",
      unit: f.unit,
      workspace: join(f.home, "cadence"),
      linger: "off",
    });
    f.calls.length = 0;
    expect(stopAutostart(f.s)).toEqual({
      status: "stopped",
      unit: f.unit,
      workspace: join(f.home, "cadence"),
    });
    expect(f.calls).toEqual(["show-environment", "stop cadence.service"]);
    expect(f.state.enabled).toBe("enabled");
    f.calls.length = 0;
    expect(removeAutostart(f.s)).toEqual({ status: "removed", unit: f.unit });
    expect(f.calls).toEqual([
      "show-environment",
      "disable --now cadence.service",
      "daemon-reload",
      "reset-failed cadence.service",
    ]);
    expect(existsSync(f.unit)).toBe(false);
    expect(existsSync(join(f.home, "cadence"))).toBe(true);
    expect(removeAutostart(f.s)).toEqual({ status: "absent" });
    expect(stopAutostart(f.s)).toEqual({ status: "absent" });
    expect(autostartStatus(f.s)).toEqual({ status: "absent" });
  });

  it("the management CLI exposes the server commands and refuses others without effects", () => {
    const data = temporary("cadence-server-cli-");
    const cli = join(repository, "src", "service-cli.mjs");
    const env = { ...process.env, XDG_DATA_HOME: data };
    const run = (...argv: string[]) =>
      spawnSync(process.execPath, [cli, ...argv], { encoding: "utf8", env });
    const help = run("--help").stdout;
    expect(help).toContain(
      "cadence server install [--workspace PATH] [--no-linger]|status|restart|stop|uninstall",
    );
    // The `cadence-service` bin is the same client.
    const alias = spawnSync(
      process.execPath,
      [join(repository, "src", "cadence-service.mjs"), "--help"],
      { encoding: "utf8", env },
    );
    expect(alias.stdout).toBe(help);
    const status = run("server", "status");
    expect(status.stdout).toBe('{"status":"absent"}\n');
    expect(status.status).toBe(0);
    for (const argv of [
      ["server", "refresh"],
      ["server", "stop", "--workspace", data],
      ["autostart", "install"],
    ]) {
      const refused = run(...argv);
      expect(refused.status).toBe(1);
      expect(refused.stderr).toBe('{"error":"service-refused"}\n');
    }
    expect(readdirSync(data)).toEqual([]);
  });
});

// launchd paths and the baked PATH are POSIX; Windows splits PATH on `;`.
describe.skipIf(process.platform === "win32")("macOS LaunchAgent", () => {
  it("install writes a login agent without KeepAlive and loads it, which starts ~/cadence", async () => {
    const f = fake({ platform: "darwin" });
    const path = plistPath(f.s);
    const ws = join(f.home, "cadence");
    expect(await configureLaunchAgent(f.s, "install")).toEqual({
      status: "started",
      unit: path,
      workspace: ws,
    });
    expect(path).toBe(
      join(f.home, "Library", "LaunchAgents", `${AGENT}.plist`),
    );
    expect(f.calls).toEqual([
      `launchctl print gui/501/${AGENT}`,
      `launchctl enable gui/501/${AGENT}`,
      `launchctl bootstrap gui/501 ${path}`,
    ]);
    const text = readFileSync(path, "utf8");
    const cli = join(f.s.root, "src", "service-cli.mjs");
    expect(text).toMatch(
      /^<\?xml version="1.0" encoding="UTF-8"\?>\n<!-- Generated by @abelxiaoxing\/cadence/,
    );
    expect(text).toContain(
      [
        "\t<array>",
        "\t\t<string>/usr/bin/node</string>",
        `\t\t<string>${cli}</string>`,
        "\t\t<string>start</string>",
        "\t\t<string>--foreground</string>",
        "\t\t<string>--workspace</string>",
        `\t\t<string>${ws}</string>`,
        "\t\t<string>--server-config</string>",
        `\t\t<string>${join(f.home, ".pi", "agent", "cadence", ".env")}</string>`,
        "\t</array>",
      ].join("\n"),
    );
    expect(text).toContain(
      `\t<key>WorkingDirectory</key>\n\t<string>${ws}</string>\n`,
    );
    expect(text).toContain(
      "\t\t<key>PATH</key>\n\t\t<string>/home/u/.bun/bin:/usr/bin</string>\n",
    );
    expect(text).toContain("\t<key>RunAtLoad</key>\n\t<true/>\n");
    expect(text).not.toContain("KeepAlive");
    expect(text).toContain(
      `<string>${join(f.home, "Library", "Logs", "cadence.log")}</string>`,
    );
  });

  it("reinstalling stops the owner orderly before unloading; an unconfirmed Stop changes nothing", async () => {
    const f = fake({ platform: "darwin" });
    const path = plistPath(f.s);
    const ws = join(f.home, "cadence");
    await configureLaunchAgent(f.s, "install");
    f.calls.length = 0;
    f.s.node = "/opt/node-24/bin/node";
    expect((await configureLaunchAgent(f.s, "install")).status).toBe("started");
    expect(f.calls).toEqual([
      `stop-owner ${ws}`,
      `launchctl print gui/501/${AGENT}`,
      `launchctl bootout gui/501/${AGENT}`,
      `launchctl enable gui/501/${AGENT}`,
      `launchctl bootstrap gui/501 ${path}`,
    ]);
    const kept = readFileSync(path, "utf8");
    expect(kept).toContain("<string>/opt/node-24/bin/node</string>");
    // A Stop still settling is a refusal too, reported as unconfirmed.
    for (const [reply, status] of [
      ["unconfirmed", "unconfirmed"],
      ["quarantined", "quarantined"],
      ["unavailable", "unavailable"],
      ["stopping", "unconfirmed"],
    ]) {
      f.stop.reply = reply;
      f.calls.length = 0;
      f.s.node = "/opt/other/bin/node";
      expect(await configureLaunchAgent(f.s, "restart")).toEqual({
        status,
        workspace: ws,
        unit: path,
      });
      expect(await removeLaunchAgent(f.s)).toEqual({
        status,
        workspace: ws,
        unit: path,
      });
      expect(f.calls).toEqual([`stop-owner ${ws}`, `stop-owner ${ws}`]);
      expect(readFileSync(path, "utf8")).toBe(kept);
      expect(f.state.loaded).toBe(true);
    }
  });

  it("restart needs an agent and keeps `launchctl disable`; install undoes it", async () => {
    const fresh = fake({ platform: "darwin" });
    expect(await configureLaunchAgent(fresh.s, "restart")).toEqual({
      status: "absent",
    });
    expect(fresh.calls).toEqual([]);
    const f = fake({ platform: "darwin" });
    await configureLaunchAgent(f.s, "install");
    f.state.disabled = true;
    f.calls.length = 0;
    expect(await configureLaunchAgent(f.s, "restart")).toMatchObject({
      status: "disabled",
    });
    expect(f.calls).toContain("launchctl print-disabled gui/501");
    expect(f.calls.some((c) => c.startsWith("launchctl bootstrap"))).toBe(
      false,
    );
    expect(await configureLaunchAgent(f.s, "install")).toMatchObject({
      status: "started",
    });
    expect(f.state.disabled).toBe(false);
  });

  it("without Pi's auth.json the agent is written for the next login but not loaded", async () => {
    const f = fake({ platform: "darwin", auth: false });
    expect(await configureLaunchAgent(f.s, "install")).toMatchObject({
      status: "waiting-for-pi-login",
    });
    expect(existsSync(plistPath(f.s))).toBe(true);
    expect(f.calls.some((c) => c.startsWith("launchctl bootstrap"))).toBe(
      false,
    );
  });

  it("stop runs only the orderly Stop and leaves the agent loaded for the next login", async () => {
    const f = fake({ platform: "darwin" });
    const path = plistPath(f.s);
    const ws = join(f.home, "cadence");
    await configureLaunchAgent(f.s, "install");
    f.calls.length = 0;
    expect(await stopLaunchAgent(f.s)).toEqual({
      status: "stopped",
      workspace: ws,
      unit: path,
    });
    expect(f.calls).toEqual([`stop-owner ${ws}`]);
    expect(f.state.loaded).toBe(true);
    f.stop.reply = "unconfirmed";
    expect(await stopLaunchAgent(f.s)).toEqual({
      status: "unconfirmed",
      workspace: ws,
      unit: path,
    });
  });

  it("uninstall stops orderly, unloads and deletes only the generated agent; status reads it back", async () => {
    const f = fake({ platform: "darwin" });
    const path = plistPath(f.s);
    const ws = join(f.home, "cadence");
    await configureLaunchAgent(f.s, "install");
    expect(launchAgentStatus(f.s)).toEqual({
      status: "active",
      enabled: "enabled",
      unit: path,
      workspace: ws,
    });
    f.state.running = false;
    expect(launchAgentStatus(f.s).status).toBe("inactive");
    f.calls.length = 0;
    expect(await removeLaunchAgent(f.s)).toEqual({
      status: "removed",
      unit: path,
    });
    expect(f.calls).toEqual([
      `stop-owner ${ws}`,
      `launchctl print gui/501/${AGENT}`,
      `launchctl bootout gui/501/${AGENT}`,
    ]);
    expect(existsSync(path)).toBe(false);
    expect(existsSync(ws)).toBe(true);
    expect(await removeLaunchAgent(f.s)).toEqual({ status: "absent" });
    expect(await stopLaunchAgent(f.s)).toEqual({ status: "absent" });
    expect(launchAgentStatus(f.s)).toEqual({ status: "absent" });
  });

  it("foreign agents, a missing SDK and a missing GUI domain are reported without effects", async () => {
    const f = fake({ platform: "darwin" });
    const path = plistPath(f.s);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "<plist>mine</plist>\n");
    for (const result of [
      await configureLaunchAgent(f.s, "install"),
      await stopLaunchAgent(f.s),
      await removeLaunchAgent(f.s),
      launchAgentStatus(f.s),
    ])
      expect(result).toEqual({ status: "foreign", unit: path });
    expect(readFileSync(path, "utf8")).toBe("<plist>mine</plist>\n");
    expect(f.calls).toEqual([]);
    const sdk = fake({ platform: "darwin", sdk: false });
    expect(await configureLaunchAgent(sdk.s, "install")).toEqual({
      status: "missing-pi-sdk",
    });
    expect(existsSync(plistPath(sdk.s))).toBe(false);
    const nobody = fake({ platform: "darwin" });
    nobody.s.uid = undefined;
    expect(await configureLaunchAgent(nobody.s, "install")).toEqual({
      status: "unavailable",
    });
  });

  it("escapes XML, keeps such a workspace across restarts and refuses control characters", async () => {
    const f = fake({ platform: "darwin" });
    const ws = join(f.home, "a&b<c>");
    mkdirSync(ws);
    await configureLaunchAgent(f.s, "install", ws);
    expect(readFileSync(plistPath(f.s), "utf8")).toContain(
      `<string>${join(f.home, "a&amp;b&lt;c&gt;")}</string>`,
    );
    expect(await configureLaunchAgent(f.s, "restart")).toMatchObject({
      status: "started",
      workspace: ws,
    });
    expect(() =>
      buildPlist({
        node: "/n",
        cli: "/c",
        workspace: "/w\n</string>",
        serverConfig: "/s",
        environment: [],
        log: "/l",
      }),
    ).toThrow();
  });
});

describe("Windows login Run entry", () => {
  const decode = (path: string) => {
    const bytes = readFileSync(path);
    expect([...bytes.subarray(0, 2)]).toEqual([0xff, 0xfe]);
    return bytes.subarray(2).toString("utf16le");
  };

  it("install writes a UTF-16 launcher, registers the Run entry and starts it without a window", async () => {
    const f = fake({ platform: "win32" });
    const path = launcherPath(f.s);
    const ws = join(f.home, "cadence");
    expect(path).toBe(
      join(f.home, "AppData", "Local", "cadence-server", "cadence.vbs"),
    );
    expect(await configureLoginRun(f.s, "install")).toEqual({
      status: "started",
      unit: path,
      workspace: ws,
    });
    expect(f.calls).toEqual([
      `reg query ${RUN_KEY} /v Cadence`,
      `reg add ${RUN_KEY} /v Cadence /t REG_SZ /d "C:\\Windows\\System32\\wscript.exe" "${path}" /f`,
      `reg delete ${APPROVED} /v Cadence /f`,
      `launch ${path}`,
    ]);
    const cli = join(f.s.root, "src", "service-cli.mjs");
    expect(decode(path).split("\r\n")).toEqual([
      "' Generated by @abelxiaoxing/cadence; `cadence server install` and `restart` rewrite this file.",
      `' Started at login by ${RUN_KEY}\\Cadence; window style 0 hides the console.`,
      'Set shell = CreateObject("WScript.Shell")',
      `shell.CurrentDirectory = "${ws}"`,
      `shell.Run """/usr/bin/node"" ""${cli}"" start --workspace ""${ws}"" --server-config ""${join(f.home, ".pi", "agent", "cadence", ".env")}""", 0, False`,
      "",
    ]);
  });

  it("a Run value or launcher that Cadence did not generate is left unchanged", async () => {
    const f = fake({ platform: "win32" });
    f.state.run = true;
    expect(await configureLoginRun(f.s, "install")).toEqual({
      status: "foreign",
      unit: `${RUN_KEY}\\Cadence`,
    });
    expect(f.calls).toEqual([`reg query ${RUN_KEY} /v Cadence`]);
    expect(existsSync(launcherPath(f.s))).toBe(false);
    const g = fake({ platform: "win32" });
    const path = launcherPath(g.s);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "WScript.Echo 1\r\n");
    for (const result of [
      await configureLoginRun(g.s, "install"),
      await stopLoginRun(g.s),
      await removeLoginRun(g.s),
      await loginRunStatus(g.s),
    ])
      expect(result).toEqual({ status: "foreign", unit: path });
    expect(readFileSync(path, "utf8")).toBe("WScript.Echo 1\r\n");
    expect(g.calls).toEqual([]);
  });

  it("reinstalling stops the owner orderly first; an unconfirmed Stop changes nothing", async () => {
    const f = fake({ platform: "win32" });
    const path = launcherPath(f.s);
    const ws = join(f.home, "cadence");
    await configureLoginRun(f.s, "install");
    f.calls.length = 0;
    f.s.node = "C:\\node\\node.exe";
    expect((await configureLoginRun(f.s, "install")).status).toBe("started");
    expect(f.calls[0]).toBe(`stop-owner ${ws}`);
    expect(decode(path)).toContain('shell.Run """C:\\node\\node.exe""');
    const kept = readFileSync(path);
    f.stop.reply = "unconfirmed";
    f.calls.length = 0;
    f.s.node = "C:\\other\\node.exe";
    expect(await configureLoginRun(f.s, "restart")).toEqual({
      status: "unconfirmed",
      workspace: ws,
      unit: path,
    });
    expect(await removeLoginRun(f.s)).toEqual({
      status: "unconfirmed",
      workspace: ws,
      unit: path,
    });
    expect(f.calls).toEqual([`stop-owner ${ws}`, `stop-owner ${ws}`]);
    expect(readFileSync(path).equals(kept)).toBe(true);
    expect(f.state.run).toBe(true);
  });

  it("restart keeps the Run entry and a Task Manager disable; install undoes the disable; status reports both", async () => {
    const f = fake({ platform: "win32" });
    const path = launcherPath(f.s);
    const ws = join(f.home, "cadence");
    expect(await configureLoginRun(f.s, "restart")).toEqual({
      status: "absent",
    });
    await configureLoginRun(f.s, "install");
    f.state.approved = "030000000000000000000000";
    f.calls.length = 0;
    expect((await configureLoginRun(f.s, "restart")).status).toBe("started");
    expect(f.calls).toEqual([`stop-owner ${ws}`, `launch ${path}`]);
    expect(await loginRunStatus(f.s)).toEqual({
      status: "active",
      enabled: "disabled",
      unit: path,
      workspace: ws,
    });
    await configureLoginRun(f.s, "install");
    f.state.running = false;
    expect(await loginRunStatus(f.s)).toEqual({
      status: "inactive",
      enabled: "enabled",
      unit: path,
      workspace: ws,
    });
  });

  it("without Pi's auth.json the entry is registered for the next login but nothing starts", async () => {
    const f = fake({ platform: "win32", auth: false });
    expect(await configureLoginRun(f.s, "install")).toMatchObject({
      status: "waiting-for-pi-login",
    });
    expect(f.state.run).toBe(true);
    expect(f.calls.some((c) => c.startsWith("launch"))).toBe(false);
  });

  it("stop runs only the orderly Stop; uninstall stops orderly and deletes both registry values and only the generated launcher", async () => {
    const f = fake({ platform: "win32" });
    const path = launcherPath(f.s);
    const ws = join(f.home, "cadence");
    await configureLoginRun(f.s, "install");
    f.calls.length = 0;
    expect(await stopLoginRun(f.s)).toEqual({
      status: "stopped",
      workspace: ws,
      unit: path,
    });
    expect(f.calls).toEqual([`stop-owner ${ws}`]);
    expect(f.state.run).toBe(true);
    f.state.approved = "020000000000000000000000";
    f.calls.length = 0;
    expect(await removeLoginRun(f.s)).toEqual({
      status: "removed",
      unit: path,
    });
    expect(f.calls).toEqual([
      `stop-owner ${ws}`,
      `reg query ${RUN_KEY} /v Cadence`,
      `reg delete ${RUN_KEY} /v Cadence /f`,
      `reg query ${APPROVED} /v Cadence`,
      `reg delete ${APPROVED} /v Cadence /f`,
    ]);
    expect(existsSync(path)).toBe(false);
    expect(existsSync(ws)).toBe(true);
    expect(await removeLoginRun(f.s)).toEqual({ status: "absent" });
    expect(await loginRunStatus(f.s)).toEqual({ status: "absent" });
  });

  it("bakes only a custom Pi agent directory, doubles VBScript quotes and refuses quoted paths", async () => {
    const f = fake({ platform: "win32" });
    const custom = join(f.home, "pi-agent");
    mkdirSync(custom);
    writeFileSync(join(custom, "auth.json"), "{}");
    f.s.env.PI_CODING_AGENT_DIR = "~/pi-agent";
    await configureLoginRun(f.s, "install");
    expect(decode(launcherPath(f.s))).toContain(
      `\r\nSet env = shell.Environment("Process")\r\nenv("PI_CODING_AGENT_DIR") = "${custom}"\r\n`,
    );
    const input = {
      node: "C:\\n.exe",
      cli: "C:\\c.mjs",
      workspace: "C:\\w",
      serverConfig: "C:\\s.json",
      environment: [["X", 'a"b']] as [string, string][],
    };
    expect(buildLauncher(input)).toContain('\r\nenv("X") = "a""b"\r\n');
    expect(() => buildLauncher({ ...input, workspace: 'C:\\w"x' })).toThrow();
  });
});

describe("startup guidance", () => {
  /** Path observation inputs; the package root is a checkout unless moved. */
  function observation() {
    const home = temporary("cadence-notice-");
    const checkout = join(home, "work", "cadence");
    mkdirSync(checkout, { recursive: true });
    const o = {
      platform: "linux" as NodeJS.Platform,
      env: {} as NodeJS.ProcessEnv,
      home,
      root: checkout,
      lingerFile: join(home, "linger", "u"),
      systemd: join(home, "run-systemd-system"),
    };
    mkdirSync(o.systemd);
    const global = join(
      home,
      "prefix",
      "lib",
      "node_modules",
      "@abelxiaoxing",
      "cadence",
    );
    mkdirSync(global, { recursive: true });
    return { o, home, checkout, global };
  }

  /** `cadence server <argv>` for an isolated home; callers pass a missing
   * workspace so that nothing can register even if a check regressed. */
  function server(home: string, ...argv: string[]) {
    return spawnSync(
      process.execPath,
      [join(repository, "src", "service-cli.mjs"), "server", ...argv],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          XDG_DATA_HOME: join(home, "data"),
          LOCALAPPDATA: join(home, "local"),
        },
      },
    );
  }
  const WEBUI =
    /\n# Cadence WebUI for `cadence server install`: edit, then run `cadence server restart`\.\n# The token admits anyone who has it to your workspace; keep it private\.\nCADENCE_PORT=17423\nCADENCE_TOKEN=([A-Za-z0-9_-]{43})\n$/;

  it("server install creates the research template with the WebUI port and a random token, then only adds missing keys", () => {
    const home = temporary("cadence-template-");
    const file = join(home, ".pi", "agent", "cadence", ".env");
    const first = server(home, "install", "--workspace", join(home, "missing"));
    expect(first.status).toBe(1);
    expect(first.stderr).toContain(
      `Cadence created the research configuration template ${file}\n`,
    );
    expect(first.stderr).toContain(
      `Cadence added CADENCE_PORT=17423 and a random private CADENCE_TOKEN to ${file}\n`,
    );
    const text = readFileSync(file, "utf8");
    expect(text.startsWith(CONFIG_TEMPLATE)).toBe(true);
    const token = WEBUI.exec(text.slice(CONFIG_TEMPLATE.length))?.[1];
    expect(token).toBeDefined();
    // Never shown: the link is printed only by a started owner.
    expect(first.stdout + first.stderr).not.toContain(token);
    // The research skills still read the same file.
    expect(parseEnvFile(text)).toMatchObject({
      GROK_API_URL: "https://api.x.ai/v1",
      CADENCE_PORT: "17423",
      CADENCE_TOKEN: token,
    });
    if (process.platform !== "win32") {
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(statSync(dirname(file)).mode & 0o777).toBe(0o700);
    }
    // Another home gets another token.
    const other = temporary("cadence-template-");
    server(other, "install", "--workspace", join(other, "missing"));
    expect(
      parseEnvFile(
        readFileSync(join(other, ".pi", "agent", "cadence", ".env"), "utf8"),
      ).CADENCE_TOKEN,
    ).not.toBe(token);
    // An existing file keeps every byte; only the missing keys are appended.
    writeFileSync(file, "GROK_API_KEY=keep-me");
    const second = server(
      home,
      "install",
      "--workspace",
      join(home, "missing"),
    );
    expect(second.stderr).not.toContain("research configuration template");
    const kept = readFileSync(file, "utf8");
    expect(kept.startsWith("GROK_API_KEY=keep-me\n")).toBe(true);
    expect(WEBUI.test(kept.slice("GROK_API_KEY=keep-me".length))).toBe(true);
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true }))
        if (entry.isDirectory()) walk(join(dir, entry.name));
        else files.push(relative(home, join(dir, entry.name)));
    };
    walk(home);
    expect(files).toEqual([join(".pi", "agent", "cadence", ".env")]);
  });

  it("server install and restart keep a configured port and token; an unusable .env refuses before any change", () => {
    const home = temporary("cadence-server-config-");
    const file = join(home, ".pi", "agent", "cadence", ".env");
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    // Only the token: the port is added after the existing lines, with their
    // CRLF endings.
    const own =
      'GROK_API_KEY=k\r\nCADENCE_TOKEN="my-own-private-token-0123456789abcdef"\r\n';
    writeFileSync(file, own, { mode: 0o600 });
    const first = server(home, "install", "--workspace", join(home, "missing"));
    expect(first.stderr).toContain(
      `Cadence added CADENCE_PORT=17423 to ${file}\n`,
    );
    const text = readFileSync(file, "utf8");
    expect(text.startsWith(own)).toBe(true);
    expect(text.slice(own.length)).toMatch(
      /^\r\n# [^\r\n]*\r\n# [^\r\n]*\r\nCADENCE_PORT=17423\r\n$/,
    );
    expect(first.stdout + first.stderr).not.toContain("my-own-private");
    for (const argv of [
      ["install", "--workspace", join(home, "missing")],
      ["restart"],
    ]) {
      const again = server(home, ...argv);
      expect(again.stderr).not.toContain("Cadence added");
      expect(readFileSync(file, "utf8")).toBe(text);
    }
    const token = "CADENCE_TOKEN=my-own-private-token-0123456789abcdef";
    // Each refusal names its reason and line, never a byte of the file.
    for (const [bad, reason] of [
      [
        `CADENCE_PORT=0\n${token}\n`,
        "has CADENCE_PORT on line 1 that is not a whole number from 1 to 65535",
      ],
      [
        `CADENCE_PORT=70000\n${token}\n`,
        "has CADENCE_PORT on line 1 that is not a whole number from 1 to 65535",
      ],
      [
        `CADENCE_PORT=017423\n${token}\n`,
        "has CADENCE_PORT on line 1 that is not a whole number from 1 to 65535",
      ],
      [
        "CADENCE_PORT=17423\nCADENCE_TOKEN=short\n",
        "has CADENCE_TOKEN on line 2 shorter than 32 characters or with control characters",
      ],
      [
        `CADENCE_PORT=17423\n${token}\n\n${token}\n`,
        "sets CADENCE_TOKEN twice (lines 2 and 4); keep one",
      ],
      [
        `CADENCE_PORT=17423\nCADENCE_PORT=17424\n${token}\n`,
        "sets CADENCE_PORT twice (lines 1 and 2); keep one",
      ],
      [
        `CADENCE_PORT=17423\n${token}\nnot a setting\n`,
        "has no KEY=value setting on line 3, which the research skills refuse too",
      ],
      [
        `GROK_API_KEY=k\nexport TAVILY_API_KEY=t\n${token}\n`,
        'has an invalid name on line 2 (letters, digits and _ only, no "export"), which the research skills refuse too',
      ],
      [
        `CADENCE_PORT=17423\nCADENCE_TOKEN="my-own-private-token-0123456789abcdef\n`,
        "has an unterminated quote on line 2, which the research skills refuse too",
      ],
    ]) {
      writeFileSync(file, bad);
      const refused = server(
        home,
        "install",
        "--workspace",
        join(home, "missing"),
      );
      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain(
        `Cadence changed nothing: ${file} ${reason}.\n`,
      );
      expect(refused.stdout + refused.stderr).not.toContain("my-own-private");
      expect(readFileSync(file, "utf8")).toBe(bad);
      expect(existsSync(join(home, "data"))).toBe(false);
      expect(existsSync(join(home, "cadence"))).toBe(false);
    }
  });

  // Mode bits and links are POSIX facts; Windows has neither check.
  it.skipIf(process.platform === "win32")(
    "a .env made by hand, under umask 002 or by a dotfiles manager is accepted like Pi's sources; only ownership and content refuse",
    () => {
      const missing = (home: string) => [
        "install",
        "--workspace",
        join(home, "missing"),
      ];
      // Older docs had users `mkdir -p ~/.pi/agent/cadence`; an editor then
      // made the .env 0644. Cadence appends and writes it 0600.
      const hand = temporary("cadence-env-hand-");
      const handFile = join(hand, ".pi", "agent", "cadence", ".env");
      mkdirSync(dirname(handFile), { recursive: true, mode: 0o755 });
      chmodSync(dirname(handFile), 0o755);
      writeFileSync(handFile, "GROK_API_KEY=keep-me\n", { mode: 0o644 });
      chmodSync(handFile, 0o644);
      const appended = server(hand, ...missing(hand));
      expect(appended.stderr).toContain(
        `Cadence added CADENCE_PORT=17423 and a random private CADENCE_TOKEN to ${handFile}\n`,
      );
      expect(appended.stderr).not.toContain("changed nothing");
      expect(appended.stderr).not.toContain("Note:");
      const handText = readFileSync(handFile, "utf8");
      expect(handText.startsWith("GROK_API_KEY=keep-me\n")).toBe(true);
      expect(statSync(handFile).mode & 0o777).toBe(0o600);
      expect(statSync(dirname(handFile)).mode & 0o777).toBe(0o755);

      // umask 002 with both keys set: nothing is rewritten, the mode stays
      // and a note names chmod.
      const shared = temporary("cadence-env-umask-");
      const sharedFile = join(shared, ".pi", "agent", "cadence", ".env");
      mkdirSync(dirname(sharedFile), { recursive: true });
      chmodSync(dirname(sharedFile), 0o775);
      const full =
        "CADENCE_PORT=18000\nCADENCE_TOKEN=my-own-private-token-0123456789abcdef\n";
      writeFileSync(sharedFile, full);
      chmodSync(sharedFile, 0o664);
      const noted = server(shared, ...missing(shared));
      expect(noted.stderr).not.toContain("changed nothing");
      expect(noted.stderr).not.toContain("Cadence added");
      expect(noted.stderr).toContain(
        `Note: other users can read ${sharedFile}; chmod 600 ${JSON.stringify(sharedFile)} keeps CADENCE_TOKEN private.\n`,
      );
      expect(readFileSync(sharedFile, "utf8")).toBe(full);
      expect(statSync(sharedFile).mode & 0o777).toBe(0o664);

      // A symlinked ~/.pi and a stow-style symlinked .env: the keys go into
      // the real file and both links stay links.
      const dot = temporary("cadence-env-dotfiles-");
      const repo = join(dot, "dotfiles");
      mkdirSync(join(repo, "pi", "agent", "cadence"), { recursive: true });
      mkdirSync(join(repo, "env"));
      writeFileSync(join(repo, "env", "cadence.env"), "GROK_API_KEY=k\n");
      symlinkSync(join(repo, "pi"), join(dot, ".pi"));
      const dotFile = join(dot, ".pi", "agent", "cadence", ".env");
      symlinkSync(join(repo, "env", "cadence.env"), dotFile);
      const linked = server(dot, ...missing(dot));
      expect(linked.stderr).toContain(`Cadence added CADENCE_PORT=17423`);
      expect(lstatSync(join(dot, ".pi")).isSymbolicLink()).toBe(true);
      expect(lstatSync(dotFile).isSymbolicLink()).toBe(true);
      expect(
        parseEnvFile(readFileSync(join(repo, "env", "cadence.env"), "utf8")),
      ).toMatchObject({ GROK_API_KEY: "k", CADENCE_PORT: "17423" });

      // A link to nothing names that, not a privacy rule.
      rmSync(join(repo, "env", "cadence.env"));
      const dangling = server(dot, ...missing(dot));
      expect(dangling.status).toBe(1);
      expect(dangling.stderr).toContain(
        `Cadence changed nothing: ${dotFile} is a link to a file that does not exist.\n`,
      );
      expect(existsSync(join(repo, "env", "cadence.env"))).toBe(false);
    },
  );

  it("/cadence names `cadence server install` while no service is registered", () => {
    const { o, home } = observation();
    expect(autostartHint(o)).toBe(
      "\nTo run the shared service and WebUI (default http://127.0.0.1:17423) at boot: cadence server install",
    );
    expect(autostartHint({ ...o, env: { CADENCE_LINGER: "0" } })).toMatch(
      / at login: cadence server install --no-linger$/,
    );
    expect(autostartHint({ ...o, platform: "darwin" })).toMatch(
      / at login: cadence server install$/,
    );
    expect(autostartHint({ ...o, systemd: join(home, "absent") })).toBe("");
    const unit = join(home, ".local", "share", "systemd", "user");
    mkdirSync(unit, { recursive: true });
    writeFileSync(join(unit, "cadence.service"), "# generated\n");
    expect(autostartHint(o)).toBe("");
    // Observation only: nothing else was created.
    expect(existsSync(join(home, "cadence"))).toBe(false);
  });

  // Symbolic links need extra privileges on Windows hosts.
  it.skipIf(process.platform === "win32")(
    "the startup card warns installed copies, not checkouts, on every supported platform",
    () => {
      const { o, home, checkout, global } = observation();
      // A checkout loaded with `pi -e` is explicit by design.
      expect(autostartNotice(o)).toBeUndefined();
      expect(autostartNotice({ ...o, root: global })).toBe(
        "Cadence服务：后台服务未安装，WebUI（默认 http://127.0.0.1:17423）不会运行。安装并开机自启：cadence server install",
      );
      // Pi's managed copy has no `cadence` bin on PATH.
      const scope = join(home, ".pi", "agent", "npm", "node_modules");
      mkdirSync(join(scope, "@abelxiaoxing"), { recursive: true });
      symlinkSync(checkout, join(scope, "@abelxiaoxing", "cadence"));
      expect(autostartNotice(o)).toMatch(
        /开机自启：node ".*[/\\]src[/\\]service-cli\.mjs" server install$/,
      );
      // A linger opt-out is never undone by the suggested command.
      expect(autostartNotice({ ...o, env: { CADENCE_LINGER: "0" } })).toMatch(
        /登录后自启：node ".*" server install --no-linger$/,
      );
      expect(
        autostartNotice({ ...o, env: { CADENCE_AUTOSTART: "0" } }),
      ).toBeUndefined();
      // Without systemd there is no user manager to register with.
      expect(
        autostartNotice({ ...o, systemd: join(home, "absent") }),
      ).toBeUndefined();
      const mac = { ...o, platform: "darwin" as const, root: global };
      expect(autostartNotice(mac)).toMatch(
        /登录后自启：cadence server install$/,
      );
      const agents = join(home, "Library", "LaunchAgents");
      mkdirSync(agents, { recursive: true });
      writeFileSync(join(agents, `${AGENT}.plist`), "<plist/>\n");
      expect(autostartNotice(mac)).toBeUndefined();
      const local = join(home, "Local");
      const windows = {
        ...o,
        platform: "win32" as const,
        root: global,
        env: { LOCALAPPDATA: local },
      };
      expect(autostartNotice(windows)).toMatch(
        /登录后自启：cadence server install$/,
      );
      mkdirSync(join(local, "cadence-server"), { recursive: true });
      writeFileSync(join(local, "cadence-server", "cadence.vbs"), "");
      expect(autostartNotice(windows)).toBeUndefined();
      expect(existsSync(join(home, "cadence"))).toBe(false);
    },
  );

  it.skipIf(process.platform === "win32")(
    "the startup card names a missing linger for an enabled Linux unit from path observations only",
    () => {
      const { o, home } = observation();
      const data = join(home, ".local", "share", "systemd", "user");
      const config = join(home, ".config", "systemd", "user");
      mkdirSync(data, { recursive: true });
      writeFileSync(join(data, "cadence.service"), "# generated\n");
      // Registered but disabled: the user's choice.
      expect(autostartNotice(o)).toBeUndefined();
      mkdirSync(join(config, "default.target.wants"), { recursive: true });
      symlinkSync(
        join(data, "cadence.service"),
        join(config, "default.target.wants", "cadence.service"),
      );
      expect(autostartNotice(o)).toContain("loginctl enable-linger");
      expect(
        autostartNotice({ ...o, env: { CADENCE_LINGER: "0" } }),
      ).toBeUndefined();
      mkdirSync(join(home, "linger"));
      writeFileSync(o.lingerFile, "");
      expect(autostartNotice(o)).toBeUndefined();
      rmSync(o.lingerFile);
      // `systemctl --user mask --runtime` links under XDG_RUNTIME_DIR.
      const runtime = join(home, "run-user");
      mkdirSync(join(runtime, "systemd", "user"), { recursive: true });
      symlinkSync(
        "/dev/null",
        join(runtime, "systemd", "user", "cadence.service"),
      );
      expect(
        autostartNotice({ ...o, env: { XDG_RUNTIME_DIR: runtime } }),
      ).toBeUndefined();
      expect(autostartNotice(o)).toContain("loginctl enable-linger");
      symlinkSync("/dev/null", join(config, "cadence.service"));
      expect(autostartNotice(o)).toBeUndefined();
      expect(existsSync(join(home, "cadence"))).toBe(false);
    },
  );
});

// These are isolated filesystem/manager-adapter tests, not a host root install.
describe.skipIf(process.platform !== "linux")(
  "system service without linger",
  () => {
    function system() {
      const f = fake();
      f.s.scope = "system";
      f.s.uid = 0;
      f.s.unitDirectory = join(f.home, "system-units");
      const manager = f.s.systemctl;
      f.s.systemctl = (args) => {
        const reply = manager(args);
        if (reply.status === 0 && args[0] === "start") f.state.running = true;
        if (reply.status === 0 && args[0] === "stop") f.state.running = false;
        return reply;
      };
      f.s.linger = () => {
        throw new Error("system service must not consult logind");
      };
      f.s.enableLinger = () => {
        throw new Error("system service must not change linger");
      };
      return { ...f, systemUnit: unitPath(f.s) };
    }
    it("requires explicit root authority; no definition/config/workspace creation or sudo", async () => {
      const f = system();
      f.s.uid = 1000;
      expect(await configureSystemService(f.s, "install")).toEqual({
        status: "root-required",
        scope: "system",
      });
      expect(await stopSystemService(f.s, true)).toEqual({
        status: "root-required",
        scope: "system",
      });
      expect(f.calls).toEqual([]);
      expect(existsSync(f.systemUnit)).toBe(false);
      expect(existsSync(join(f.home, "cadence"))).toBe(false);
    });
    it("writes User=root, multi-user.target and the exact HOME; never accesses linger", async () => {
      const f = system();
      const observe = f.s.ownerStatus;
      f.s.ownerStatus = async (workspace) => {
        if (!existsSync(workspace))
          throw new Error("no directory exists to observe yet");
        return observe(workspace);
      };
      expect(await configureSystemService(f.s, "install")).toMatchObject({
        status: "started",
        scope: "system",
        unit: f.systemUnit,
      });
      const text = readFileSync(f.systemUnit, "utf8");
      expect(text).toContain("User=root\n");
      expect(text).toContain("WantedBy=multi-user.target\n");
      expect(text).toContain(`Environment="HOME=${f.home}"`);
      expect(text).toContain('"stop" "--workspace"');
      expect(text).not.toContain("systemctl --user");
      expect(f.lingerAttempts).toEqual([]);
      expect(systemServiceStatus(f.s)).toMatchObject({
        status: "active",
        enabled: "enabled",
        scope: "system",
      });
      expect(systemServiceStatus(f.s)).not.toHaveProperty("linger");
    });
    it("refuses every uncertain Stop before systemctl stop, rewrite or uninstall", async () => {
      const f = system();
      await configureSystemService(f.s, "install");
      const original = readFileSync(f.systemUnit, "utf8");
      for (const reply of [
        "unconfirmed",
        "quarantined",
        "unavailable",
        "stopping",
      ]) {
        f.stop.reply = reply;
        f.s.node = "/new/node";
        f.calls.length = 0;
        expect((await configureSystemService(f.s, "restart")).status).not.toBe(
          "started",
        );
        expect((await stopSystemService(f.s, true)).status).not.toBe("removed");
        expect(f.calls).not.toContain("stop cadence.service");
        expect(f.calls).not.toContain("daemon-reload");
        expect(readFileSync(f.systemUnit, "utf8")).toBe(original);
      }
    });
    it("orderly stop precedes the manager; restart retains disable and uninstall preserves data", async () => {
      const f = system();
      await configureSystemService(f.s, "install");
      f.state.enabled = "disabled";
      f.calls.length = 0;
      expect((await configureSystemService(f.s, "restart")).status).toBe(
        "started",
      );
      expect(
        f.calls.indexOf(`stop-owner ${join(f.home, "cadence")}`),
      ).toBeLessThan(f.calls.indexOf("stop cadence.service"));
      expect(f.calls).not.toContain("enable cadence.service");
      const sentinel = join(f.home, "cadence", "consumer.txt");
      writeFileSync(sentinel, "keep");
      expect((await stopSystemService(f.s, true)).status).toBe("removed");
      expect(existsSync(f.systemUnit)).toBe(false);
      expect(readFileSync(sentinel, "utf8")).toBe("keep");
      expect(existsSync(join(f.home, ".pi", "agent", "auth.json"))).toBe(true);
    });
    it("preserves masks, foreign units, edited definitions and an old user registration", async () => {
      const f = system();
      mkdirSync(dirname(f.systemUnit), { recursive: true });
      symlinkSync("/dev/null", f.systemUnit);
      f.state.enabled = "masked";
      expect((await configureSystemService(f.s, "install")).status).toBe(
        "masked",
      );
      expect(lstatSync(f.systemUnit).isSymbolicLink()).toBe(true);
      const foreign = system();
      mkdirSync(dirname(foreign.systemUnit), { recursive: true });
      writeFileSync(foreign.systemUnit, "foreign");
      expect((await configureSystemService(foreign.s, "install")).status).toBe(
        "foreign",
      );
      const old = system();
      mkdirSync(dirname(old.unit), { recursive: true });
      writeFileSync(old.unit, "legacy user registration");
      expect((await configureSystemService(old.s, "install")).status).toBe(
        "scope-conflict",
      );
      expect(old.calls).toEqual([]);
      const changed = system();
      await configureSystemService(changed.s, "install");
      changed.s.stopOwner = async () => {
        writeFileSync(changed.systemUnit, "edited by operator");
        return "stopped";
      };
      expect((await configureSystemService(changed.s, "restart")).status).toBe(
        "foreign",
      );
      expect(readFileSync(changed.systemUnit, "utf8")).toBe(
        "edited by operator",
      );
    });
    it("named services have distinct units/configuration/tokens, without replacing prior ports", async () => {
      const f = system();
      f.s.unit = serviceUnit("api");
      const a = ensureServerConfig(f.home, { name: "api", port: 17424 });
      const b = ensureServerConfig(f.home, { name: "worker", port: 17425 });
      expect(a.config.token).not.toBe(b.config.token);
      expect(a.path).not.toBe(b.path);
      expect(existsSync(serverConfigPath(f.home))).toBe(false);
      expect((await configureSystemService(f.s, "install")).status).toBe(
        "started",
      );
      expect(unitPath(f.s)).toBe(
        join(f.s.unitDirectory as string, "cadence-api.service"),
      );
      expect(readFileSync(unitPath(f.s), "utf8")).toContain(
        `"--server-config" "${a.path}"`,
      );
      const bytes = readFileSync(a.path);
      expect(() =>
        ensureServerConfig(f.home, { name: "api", port: 17426 }),
      ).toThrow("corrupt-selected");
      expect(readFileSync(a.path)).toEqual(bytes);
      for (const name of [
        "../escape",
        "",
        "a.service",
        "%i",
        "two words",
        "a".repeat(49),
      ])
        expect(() => serviceUnit(name)).toThrow();
    });
    it("never adopts a detached owner or treats a different state-home as a stopped one", async () => {
      const f = system();
      mkdirSync(join(f.home, "cadence"));
      f.s.ownerStatus = async () => "alive";
      expect((await configureSystemService(f.s, "install")).status).toBe(
        "project-running",
      );
      expect(existsSync(f.systemUnit)).toBe(false);
      expect(existsSync(join(f.home, "cadence"))).toBe(true);
      const changed = system();
      await configureSystemService(changed.s, "install");
      const before = readFileSync(changed.systemUnit);
      changed.s.env.XDG_STATE_HOME = join(changed.home, "another-state");
      changed.calls.length = 0;
      expect((await configureSystemService(changed.s, "restart")).status).toBe(
        "environment-changed",
      );
      expect((await stopSystemService(changed.s, true)).status).toBe(
        "environment-changed",
      );
      expect(changed.calls.some((call) => call.startsWith("stop-owner"))).toBe(
        false,
      );
      expect(readFileSync(changed.systemUnit)).toEqual(before);
    });
    it.each(["install", "restart", "stop", "uninstall"] as const)(
      "%s never stops or adopts a detached owner behind an inactive old unit",
      async (action) => {
        const f = system();
        await configureSystemService(f.s, "install");
        const original = readFileSync(f.systemUnit);
        f.state.active = false; // Unit stopped, then project open started an owner.
        f.state.running = true;
        f.calls.length = 0;
        const result =
          action === "install" || action === "restart"
            ? await configureSystemService(f.s, action)
            : await stopSystemService(f.s, action === "uninstall");
        expect(result.status).toBe("project-running");
        expect(f.state.running).toBe(true);
        expect(f.state.active).toBe(false);
        expect(f.calls.some((call) => call.startsWith("stop-owner"))).toBe(
          false,
        );
        expect(f.calls).not.toContain("stop cadence.service");
        expect(f.calls).not.toContain("start cadence.service");
        expect(f.calls).not.toContain("daemon-reload");
        expect(readFileSync(f.systemUnit)).toEqual(original);
      },
    );
    it("a reinstall with a different target does not stop the old directory's detached owner", async () => {
      const f = system();
      await configureSystemService(f.s, "install");
      const original = readFileSync(f.systemUnit),
        target = join(f.home, "new-project");
      mkdirSync(target);
      f.state.active = false;
      f.state.running = true;
      f.s.ownerStatus = async (workspace) =>
        workspace === target ? "absent" : "alive";
      f.calls.length = 0;
      expect(
        (await configureSystemService(f.s, "install", target)).status,
      ).toBe("project-running");
      expect(f.state.running).toBe(true);
      expect(f.calls.some((call) => call.startsWith("stop-owner"))).toBe(false);
      expect(readFileSync(f.systemUnit)).toEqual(original);
    });
    it.each(["quarantined", "unavailable", "stopping"])(
      "an inactive unit does not prove its old owner's %s state is stopped",
      async (status) => {
        const f = system();
        await configureSystemService(f.s, "install");
        const original = readFileSync(f.systemUnit);
        f.state.active = false;
        f.s.ownerStatus = async () => status;
        f.calls.length = 0;
        expect((await configureSystemService(f.s, "restart")).status).toBe(
          "unavailable",
        );
        expect((await stopSystemService(f.s, true)).status).toBe("unavailable");
        expect(f.calls.some((call) => call.startsWith("stop-owner"))).toBe(
          false,
        );
        expect(f.calls).not.toContain("daemon-reload");
        expect(readFileSync(f.systemUnit)).toEqual(original);
      },
    );
    it("an inactive unit with a stopped owner can restart without sending Stop to a detached replacement", async () => {
      const f = system();
      await configureSystemService(f.s, "install");
      f.state.active = false;
      f.state.running = false;
      f.s.ownerStatus = async () => "stopped";
      f.s.stopOwner = async () => {
        throw new Error("inactive owner must not be stopped again");
      };
      expect((await configureSystemService(f.s, "restart")).status).toBe(
        "started",
      );
      f.state.active = false;
      f.state.running = false;
      expect((await stopSystemService(f.s, true)).status).toBe("removed");
    });
    it("root native discovery suggests system install but never loginctl or a user bus", () => {
      const f = system();
      const o = {
        platform: "linux" as const,
        env: { CADENCE_LINGER: "0" },
        home: f.home,
        root: f.s.root,
        systemd: f.home,
        lingerFile: "/absent",
        uid: 0,
        systemUnitDirectory: f.s.unitDirectory,
      };
      expect(autostartHint(o)).toContain("server install --system");
      expect(autostartHint(o)).toContain("at boot");
      expect(autostartNotice(o)).toContain("server install --system");
      mkdirSync(dirname(f.systemUnit), { recursive: true });
      writeFileSync(f.systemUnit, "registered");
      expect(autostartNotice(o)).toBeUndefined();
    });
  },
);
