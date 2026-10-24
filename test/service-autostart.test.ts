import {
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
import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshAutostart } from "../src/install-config.mjs";
import { autostartHint, autostartNotice } from "../src/native-client.ts";
import {
  type AutostartSystem,
  autostartStatus,
  buildUnit,
  configureAutostart,
  piUserInstall,
  removeAutostart,
  servicePath,
} from "../src/service/autostart.ts";

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

interface Fake {
  s: AutostartSystem;
  home: string;
  calls: string[];
  unit: string;
  state: { enabled: string; active: boolean; linger: boolean | undefined };
  /** interactive flag of each enable-linger attempt */
  lingerAttempts: boolean[];
}
/** Pi user-scope layout: ~/.pi/agent/npm/node_modules/@abelxiaoxing/cadence. */
function fake(
  options: {
    pi?: boolean;
    auth?: boolean;
    sdk?: boolean;
    /** logind allows enable-linger without a password prompt */
    lingerAllowed?: boolean;
  } = {},
): Fake {
  const home = mkdtempSync(join(tmpdir(), "cadence-autostart-"));
  roots.push(home);
  const agent = join(home, ".pi", "agent");
  const piRoot = join(agent, "npm", "node_modules", "@abelxiaoxing", "cadence");
  const checkout = join(home, "work", "cadence");
  for (const d of [piRoot, checkout])
    mkdirSync(join(d, "src"), { recursive: true });
  if (options.auth !== false) writeFileSync(join(agent, "auth.json"), "{}");
  // Provided by another package (Pi's install itself omits Cadence's peers).
  if (options.sdk !== false)
    for (const name of ["pi-coding-agent", "pi-ai"]) {
      const sdk = join(agent, "npm", "node_modules", "@earendil-works", name);
      mkdirSync(sdk, { recursive: true });
      writeFileSync(join(sdk, "package.json"), "{}");
    }
  const calls: string[] = [];
  const state = {
    enabled: "not-found",
    active: false,
    linger: false as boolean | undefined,
  };
  const lingerAttempts: boolean[] = [];
  const s: AutostartSystem = {
    platform: "linux",
    env: {
      PATH: `${piRoot}/node_modules/.bin:/usr/lib/node_modules/npm/node_modules/@npmcli/run-script/lib/node-gyp-bin:/home/u/.bun/bin:/usr/bin:/usr/bin`,
      LANG: "C.UTF-8",
    },
    home,
    node: "/usr/bin/node",
    root: options.pi === false ? checkout : piRoot,
    unit: "cadence.service",
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
      lingerAttempts.push(interactive);
      if (options.lingerAllowed !== false) state.linger = true;
      return options.lingerAllowed !== false;
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
  return { s, home, calls, unit, state, lingerAttempts };
}

// systemd user units are Linux-only; the generated file uses Linux paths/PATH.
describe.skipIf(process.platform !== "linux")("systemd user autostart", () => {
  it("first Pi user-scope install writes the unit, enables it and starts ~/cadence on the default service route", () => {
    const f = fake();
    expect(piUserInstall(f.s)).toBe(true);
    const result = configureAutostart(f.s, "refresh");
    expect(result).toEqual({
      status: "started",
      unit: f.unit,
      workspace: join(f.home, "cadence"),
      linger: "enabled",
    });
    // Boot start without prompting: the install hook has no terminal.
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
    ]);
    const text = readFileSync(f.unit, "utf8");
    const cli = join(f.s.root, "src", "service-cli.mjs");
    const ws = join(f.home, "cadence");
    expect(text).toContain(
      `ExecStart="/usr/bin/node" "${cli}" "start" "--foreground" "--workspace" "${ws}"`,
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
        `ConditionPathExists=${join(f.home, ".pi", "agent", "npm", "node_modules", "@earendil-works", name, "package.json")}\n`,
      );
    // npm lifecycle bins are not the user's search path.
    expect(text).toContain('Environment="PATH=/home/u/.bun/bin:/usr/bin"');
    expect(text).toContain('Environment="LANG=C.UTF-8"');
    expect(text).not.toContain("PI_CODING_AGENT_DIR");
    expect(text).toContain("KillMode=mixed\n");
    expect(text).toContain("WantedBy=default.target\n");
    // No --port: the default 17423 route, or the workspace's saved selection.
    expect(text).not.toContain("--port");
  });

  it("refresh leaves checkout, project, temporary and opted-out installs completely alone", () => {
    const checkout = fake({ pi: false });
    expect(configureAutostart(checkout.s, "refresh")).toEqual({
      status: "skipped",
    });
    expect(checkout.calls).toEqual([]);
    const opted = fake();
    opted.s.env.CADENCE_AUTOSTART = "0";
    expect(configureAutostart(opted.s, "refresh")).toEqual({
      status: "skipped",
    });
    const mac = fake();
    mac.s.platform = "darwin";
    expect(configureAutostart(mac.s, "refresh")).toEqual({ status: "skipped" });
    for (const f of [checkout, opted, mac]) {
      expect(f.calls).toEqual([]);
      expect(f.lingerAttempts).toEqual([]);
      expect(existsSync(f.unit)).toBe(false);
      expect(existsSync(join(f.home, "cadence"))).toBe(false);
    }
  });

  it("a custom Pi agent directory is followed and baked for the service", () => {
    const f = fake();
    const custom = join(f.home, "pi-agent");
    const target = join(custom, "npm", "node_modules", "@abelxiaoxing");
    mkdirSync(target, { recursive: true });
    symlinkSync(f.s.root, join(target, "cadence"));
    writeFileSync(join(custom, "auth.json"), "{}");
    f.s.env.PI_CODING_AGENT_DIR = "~/pi-agent";
    expect(configureAutostart(f.s, "refresh").status).toBe("started");
    const text = readFileSync(f.unit, "utf8");
    expect(text).toContain(`Environment="PI_CODING_AGENT_DIR=${custom}"`);
    expect(text).toContain(`ConditionPathExists=${join(custom, "auth.json")}`);
  });

  it("upgrade of an enabled active unit stops with the old definition before rewriting, keeps the workspace and starts again", () => {
    const f = fake();
    const ws = join(f.home, "projects", "kept");
    mkdirSync(ws, { recursive: true });
    f.s.env.CADENCE_WORKSPACE = ws;
    configureAutostart(f.s, "refresh");
    delete f.s.env.CADENCE_WORKSPACE;
    f.calls.length = 0;
    f.s.node = "/opt/node-24/bin/node";
    expect(configureAutostart(f.s, "refresh")).toMatchObject({
      status: "started",
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
    expect(readFileSync(f.unit, "utf8")).toContain(
      'ExecStart="/opt/node-24/bin/node"',
    );
  });

  it("upgrade respects disable and mask; a manually started disabled unit is restarted, not enabled", () => {
    const f = fake();
    configureAutostart(f.s, "refresh");
    f.state.enabled = "disabled";
    f.state.active = false;
    f.calls.length = 0;
    expect(configureAutostart(f.s, "refresh").status).toBe("disabled");
    expect(f.calls).not.toContain("enable cadence.service");
    expect(f.calls).not.toContain("start cadence.service");
    f.state.active = true;
    f.calls.length = 0;
    expect(configureAutostart(f.s, "refresh").status).toBe("started");
    expect(f.calls).not.toContain("enable cadence.service");
    f.state.enabled = "masked";
    f.state.active = false;
    f.calls.length = 0;
    expect(configureAutostart(f.s, "refresh").status).toBe("masked");
    expect(f.calls.at(-1)).toBe("daemon-reload");
    // An explicit install re-enables a disabled unit, never a masked one.
    f.state.enabled = "disabled";
    expect(configureAutostart(f.s, "install").status).toBe("started");
    expect(f.state.enabled).toBe("enabled");
  });

  it("without Pi's auth.json the unit is enabled but not started, avoiding a quarantined first owner", () => {
    const f = fake({ auth: false });
    expect(configureAutostart(f.s, "refresh").status).toBe(
      "waiting-for-pi-login",
    );
    expect(f.calls).toContain("enable cadence.service");
    expect(f.calls).not.toContain("start cadence.service");
  });

  it("a first registration lingers without prompting; refusal, CADENCE_LINGER=0 and a later disable-linger are respected", () => {
    const refused = fake({ lingerAllowed: false });
    expect(configureAutostart(refused.s, "refresh")).toMatchObject({
      status: "started",
      linger: "refused",
    });
    expect(refused.lingerAttempts).toEqual([false]);
    // Upgrades are not first registrations, so disable-linger is kept.
    const f = fake();
    configureAutostart(f.s, "refresh");
    f.state.linger = false;
    expect(configureAutostart(f.s, "refresh")).toMatchObject({
      status: "started",
      linger: "off",
    });
    expect(f.lingerAttempts).toEqual([false]);
    const opted = fake();
    opted.s.env.CADENCE_LINGER = "0";
    expect(configureAutostart(opted.s, "refresh").linger).toBe("off");
    const on = fake();
    on.state.linger = true;
    expect(configureAutostart(on.s, "refresh").linger).toBe("on");
    // No logind answer: nothing is reported or attempted.
    const unknown = fake();
    unknown.state.linger = undefined;
    expect(configureAutostart(unknown.s, "refresh")).not.toHaveProperty(
      "linger",
    );
    for (const g of [opted, on, unknown]) expect(g.lingerAttempts).toEqual([]);
    // The enabled unit waiting for Pi login still gets boot start.
    const waiting = fake({ auth: false });
    expect(configureAutostart(waiting.s, "refresh")).toMatchObject({
      status: "waiting-for-pi-login",
      linger: "enabled",
    });
  });

  it("explicit install lingers only with --linger, which may prompt; masked and disabled units never linger", () => {
    const f = fake();
    expect(configureAutostart(f.s, "install")).toMatchObject({
      status: "started",
      linger: "off",
    });
    expect(f.lingerAttempts).toEqual([]);
    expect(configureAutostart(f.s, "install", undefined, true)).toMatchObject({
      status: "started",
      linger: "enabled",
    });
    expect(f.lingerAttempts).toEqual([true]);
    const masked = fake();
    masked.state.enabled = "masked";
    const result = configureAutostart(masked.s, "install", undefined, true);
    expect(result.status).toBe("masked");
    expect(result).not.toHaveProperty("linger");
    expect(masked.lingerAttempts).toEqual([]);
    const disabled = fake();
    configureAutostart(disabled.s, "refresh");
    disabled.state.enabled = "disabled";
    disabled.state.active = false;
    disabled.state.linger = false;
    expect(configureAutostart(disabled.s, "refresh")).toEqual({
      status: "disabled",
      unit: disabled.unit,
      workspace: join(disabled.home, "cadence"),
    });
    expect(disabled.lingerAttempts).toEqual([false]);
  });

  it("without a resolvable Pi SDK nothing is written, so a later refresh is still a first registration", () => {
    const f = fake({ sdk: false });
    expect(configureAutostart(f.s, "refresh")).toEqual({
      status: "missing-pi-sdk",
    });
    expect(f.calls).toEqual(["show-environment"]);
    expect(existsSync(f.unit)).toBe(false);
    expect(existsSync(join(f.home, "cadence"))).toBe(false);
    for (const name of ["pi-coding-agent", "pi-ai"]) {
      const sdk = join(
        f.home,
        ".pi",
        "agent",
        "npm",
        "node_modules",
        "@earendil-works",
        name,
      );
      mkdirSync(sdk, { recursive: true });
      writeFileSync(join(sdk, "package.json"), "{}");
    }
    expect(configureAutostart(f.s, "refresh").status).toBe("started");
    expect(f.calls).toContain("enable cadence.service");
  });

  it("foreign unit files and missing user managers are reported without effects", () => {
    const f = fake();
    mkdirSync(join(f.unit, ".."), { recursive: true });
    writeFileSync(f.unit, "[Unit]\nDescription=mine\n");
    expect(configureAutostart(f.s, "refresh")).toEqual({
      status: "foreign",
      unit: f.unit,
    });
    expect(removeAutostart(f.s).status).toBe("foreign");
    expect(readFileSync(f.unit, "utf8")).toBe("[Unit]\nDescription=mine\n");
    expect(f.calls).toEqual(["show-environment"]);
    const g = fake();
    g.s.systemctl = (args) => {
      g.calls.push(args.join(" "));
      return { status: 1, stdout: "" };
    };
    expect(configureAutostart(g.s, "refresh")).toEqual({
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

  it("a home-directory workspace lands on ~/cadence, which upgrades then keep", () => {
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
    const upgrade = configureAutostart(f.s, "refresh");
    expect(upgrade).toMatchObject({ workspace: join(f.home, "cadence") });
    expect(upgrade.redirectedFrom).toBeUndefined();
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
      agentDir: "/p",
      sdk: [],
      environment: [["LANG", 'a"b\\c%']],
    });
    expect(text).toContain('WorkingDirectory=/w/100%%$HOME"x\n');
    expect(text).toContain(
      'ExecStart="/usr/bin/node" "/opt/a b/src/service-cli.mjs" "start" "--foreground" "--workspace" "/w/100%%$$HOME\\"x"',
    );
    expect(text).toContain('Environment="LANG=a\\"b\\\\c%%"');
    expect(() =>
      buildUnit({
        node: "/usr/bin/node",
        cli: "/c",
        workspace: "/w\nExecStartPre=/bin/false",
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

  it("remove disables through ExecStop and deletes only the generated unit; status reads it back", () => {
    const f = fake();
    configureAutostart(f.s, "refresh");
    expect(autostartStatus(f.s)).toEqual({
      status: "active",
      enabled: "enabled",
      unit: f.unit,
      workspace: join(f.home, "cadence"),
      linger: "on",
    });
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
    expect(autostartStatus(f.s)).toEqual({ status: "absent" });
  });

  it("postinstall delegates to the management client's refresh with only stderr visible", () => {
    const calls: unknown[][] = [];
    refreshAutostart((...args) => {
      calls.push(args);
      return undefined;
    });
    expect(calls).toEqual([
      [
        process.execPath,
        [
          expect.stringMatching(/[/\\]src[/\\]service-cli\.mjs$/),
          "autostart",
          "refresh",
        ],
        { stdio: ["ignore", "ignore", "inherit"] },
      ],
    ]);
  });
  it("/cadence names the explicit autostart command only while no unit is registered", () => {
    const home = mkdtempSync(join(tmpdir(), "cadence-hint-"));
    roots.push(home);
    vi.stubEnv("HOME", home);
    vi.stubEnv("XDG_DATA_HOME", undefined);
    const hint = autostartHint();
    expect(hint).toContain("autostart install");
    expect(hint).toContain("http://127.0.0.1:17423");
    expect(hint).toMatch(/[/\\]src[/\\]service-cli\.mjs"/);
    const unit = join(home, ".local", "share", "systemd", "user");
    mkdirSync(unit, { recursive: true });
    writeFileSync(join(unit, "cadence.service"), "# generated\n");
    expect(autostartHint()).toBe("");
    // Observation only: nothing else was created.
    expect(existsSync(join(home, "cadence"))).toBe(false);
  });
  it("the startup card names boot-start gaps from path observations only", () => {
    const home = mkdtempSync(join(tmpdir(), "cadence-notice-"));
    roots.push(home);
    const checkout = join(home, "work", "cadence");
    mkdirSync(checkout, { recursive: true });
    const o = {
      platform: "linux" as const,
      env: {},
      home,
      root: checkout,
      lingerFile: join(home, "linger", "u"),
    };
    // Unregistered checkouts and project installs are explicit by design.
    expect(autostartNotice(o)).toBeUndefined();
    const scope = join(home, ".pi", "agent", "npm", "node_modules");
    mkdirSync(join(scope, "@abelxiaoxing"), { recursive: true });
    symlinkSync(checkout, join(scope, "@abelxiaoxing", "cadence"));
    expect(autostartNotice(o)).toMatch(
      /[/\\]src[/\\]service-cli\.mjs" autostart install --linger$/,
    );
    expect(
      autostartNotice({ ...o, env: { CADENCE_AUTOSTART: "0" } }),
    ).toBeUndefined();
    expect(autostartNotice({ ...o, platform: "darwin" })).toBeUndefined();
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
    symlinkSync("/dev/null", join(config, "cadence.service"));
    expect(autostartNotice(o)).toBeUndefined();
    expect(existsSync(join(home, "cadence"))).toBe(false);
  });
});
