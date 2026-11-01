import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type AutostartSystem,
  buildUnit,
  unitPath,
  write,
} from "../src/service/autostart.ts";
import type { MaintenanceJob } from "../src/service/contracts/gateway.ts";
import { GatewayStore } from "../src/service/gateway-store.ts";
import {
  cgroupPath,
  insideUnit,
  installedVersion,
  jobOutcome,
  MaintenanceRecord,
  type Npm,
  release,
  supervisingUnit,
  upgradeService,
} from "../src/service/maintenance.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function temporary(): string {
  const root = mkdtempSync(join(tmpdir(), "cadence-maintenance-"));
  roots.push(root);
  return root;
}
const USER_CGROUP =
  "/user.slice/user-1000.slice/user@1000.service/app.slice/cadence.service";

/** An npm global layout with one installed copy at `version`. */
function system(
  options: {
    version?: string;
    cgroup?: string;
    controlGroup?: string;
    invocation?: string;
    unit?: string;
  } = {},
) {
  const home = temporary();
  const global = join(home, "prefix", "lib", "node_modules");
  const root = join(global, "@abelxiaoxing", "cadence");
  mkdirSync(join(root, "src"), { recursive: true });
  const setVersion = (version: string) =>
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "@abelxiaoxing/cadence", version }),
    );
  setVersion(options.version ?? "1.0.0");
  const calls: string[] = [];
  const s: AutostartSystem = {
    platform: "linux",
    env: { PATH: "/usr/bin", XDG_DATA_HOME: join(home, "data") },
    home,
    node: "/usr/bin/node",
    root,
    unit: options.unit ?? "cadence.service",
    scope: "user",
    uid: 1000,
    cgroup: () =>
      options.cgroup === undefined ? undefined : `0::${options.cgroup}\n`,
    systemctl(args) {
      calls.push(args.join(" "));
      if (args.includes("--property=ControlGroup"))
        return { status: 0, stdout: `${options.controlGroup ?? ""}\n` };
      if (args.includes("--property=InvocationID"))
        return { status: 0, stdout: `${options.invocation ?? ""}\n` };
      return { status: 0, stdout: "" };
    },
    linger: () => undefined,
    enableLinger: () => false,
    launchctl: () => ({ status: 1, stdout: "" }),
    reg: () => ({ status: 1, stdout: "" }),
    launch: () => false,
    stopOwner: async () => "stopped",
    ownerStatus: async () => "absent",
  };
  return { s, home, global, root, calls, setVersion };
}
function generate(s: AutostartSystem, workspace: string | null) {
  write(
    unitPath(s),
    buildUnit({
      node: s.node,
      cli: join(s.root, "src", "service-cli.mjs"),
      workspace,
      serverConfig: join(s.home, "server.env"),
      agentDir: join(s.home, "agent"),
      sdk: [],
      environment: [["PATH", "/usr/bin"]],
    }),
  );
}

describe("in-service detection", () => {
  it("reads the systemd hierarchy on cgroup v2 and hybrid hosts", () => {
    expect(cgroupPath(`0::${USER_CGROUP}\n`)).toBe(USER_CGROUP);
    expect(
      cgroupPath(
        "12:pids:/elsewhere\n1:name=systemd:/system.slice/cadence.service\n0::/\n",
      ),
    ).toBe("/system.slice/cadence.service");
    expect(cgroupPath(undefined)).toBeUndefined();
    expect(cgroupPath("garbage\n")).toBeUndefined();
  });
  it("covers the unit's own cgroup and its children, never a sibling or an inactive unit", () => {
    const inside = (cgroup: string | undefined, controlGroup: string) =>
      insideUnit(system({ cgroup, controlGroup }).s);
    expect(inside(USER_CGROUP, USER_CGROUP)).toBe(true);
    expect(inside(`${USER_CGROUP}/worker`, USER_CGROUP)).toBe(true);
    expect(inside(`${USER_CGROUP}-other`, USER_CGROUP)).toBe(false);
    expect(
      inside("/user.slice/user-1000.slice/session-2.scope", USER_CGROUP),
    ).toBe(false);
    // An inactive unit has no cgroup, so nothing runs inside it.
    expect(inside(USER_CGROUP, "")).toBe(false);
    expect(inside(undefined, USER_CGROUP)).toBe(false);
    const other = system({ cgroup: USER_CGROUP, controlGroup: USER_CGROUP });
    other.s.platform = "darwin";
    expect(insideUnit(other.s)).toBe(false);
    expect(other.calls).toEqual([]);
  });
  it("proves the running workbench instance with systemd's InvocationID", () => {
    const invocation = "0123456789abcdef0123456789abcdef";
    const named = `${USER_CGROUP.replace("cadence.service", "cadence-lab.service")}`;
    const probe = (
      cgroup: string,
      env: NodeJS.ProcessEnv,
      workspace: string | null = null,
    ) => {
      const f = system({ cgroup, invocation });
      const selections: unknown[] = [];
      const found = supervisingUnit(env, (selection) => {
        selections.push(selection);
        const s = {
          ...f.s,
          scope: selection.scope ?? f.s.scope,
          unitDirectory: join(f.home, "system-units"),
          unit: selection.name
            ? `cadence-${selection.name}.service`
            : "cadence.service",
        };
        if (selection.scope) generate(s, workspace);
        return s;
      });
      return { found, selections };
    };
    const user = probe(named, { INVOCATION_ID: invocation });
    expect(user.found?.unit).toBe("cadence-lab.service");
    expect(user.selections.at(-1)).toEqual({ scope: "user", name: "lab" });
    expect(
      probe("/system.slice/cadence.service", {
        INVOCATION_ID: invocation,
      }).selections.at(-1),
    ).toEqual({ scope: "system", name: undefined });
    // Another instance of the unit, no systemd, a project unit, a foreign unit.
    expect(
      probe(named, { INVOCATION_ID: "f".repeat(32) }).found,
    ).toBeUndefined();
    expect(probe(named, {}).found).toBeUndefined();
    expect(
      probe(named, { INVOCATION_ID: invocation }, "/srv/project").found,
    ).toBeUndefined();
    expect(
      probe(USER_CGROUP.replace("cadence.service", "other.service"), {
        INVOCATION_ID: invocation,
      }).selections,
    ).toHaveLength(1);
  });
});

describe("WebUI job record", () => {
  const job = (id: string): MaintenanceJob => ({
    id,
    action: "restart",
    from: "1.0.0",
    to: null,
    state: "running",
    reason: null,
    version: null,
    at: 1,
    endedAt: null,
  });
  it("settles only the running job it names", () => {
    const root = temporary();
    const record = new MaintenanceRecord(
      new GatewayStore(join(root, "server.env"), join(root, "state")),
    );
    expect(record.read()).toBeNull();
    const first = job("11111111-1111-4111-8111-111111111111");
    record.write(first);
    record.finish(
      "22222222-2222-4222-8222-222222222222",
      "ready",
      null,
      "1.0.0",
    );
    expect(record.read()).toEqual(first);
    record.finish(first.id, "failed", "not-ready", "1.0.0");
    expect(record.read()).toMatchObject({
      state: "failed",
      reason: "not-ready",
      version: "1.0.0",
    });
    // A settled job is final; a later report cannot rewrite it.
    record.finish(first.id, "ready", null, "1.0.0");
    expect(record.read()?.state).toBe("failed");
  });
});

describe("upgrade", () => {
  interface Npmish {
    view?: unknown;
    viewStatus?: number;
    cache?: number;
    install?: (version: string) => number;
  }
  function npm(f: ReturnType<typeof system>, o: Npmish, log: string[]): Npm {
    return async (args) => {
      log.push(`npm ${args.join(" ")}`);
      if (args[0] === "root") return { status: 0, stdout: `${f.global}\n` };
      if (args[0] === "view")
        return {
          status: o.viewStatus ?? 0,
          stdout: JSON.stringify(o.view ?? "2.0.0"),
        };
      if (args[0] === "cache") return { status: o.cache ?? 0, stdout: "" };
      const version = (args.at(-1) ?? "").split("@").at(-1) ?? "";
      const status = o.install ? o.install(version) : 0;
      if (status === 0) f.setVersion(version);
      return { status, stdout: "" };
    };
  }
  async function run(
    o: Npmish & {
      to?: string;
      stop?: string;
      ready?: boolean[];
      version?: string;
    } = {},
  ) {
    const f = system({ version: o.version });
    const log: string[] = [];
    const ready = [...(o.ready ?? [true])];
    const result = await upgradeService(f.s, o.to, {
      npm: npm(f, o, log),
      stop: async () => {
        log.push("stop");
        return { status: o.stop ?? "stopped" };
      },
      restart: async () => {
        log.push(`restart ${installedVersion(f.root)}`);
        return ready.shift() ?? false;
      },
    });
    return { result, log, f };
  }
  it("refuses a copy that npm does not own before any registry contact or stop", async () => {
    const f = system();
    const log: string[] = [];
    const result = await upgradeService(f.s, undefined, {
      npm: async (args) => {
        log.push(args.join(" "));
        return { status: 0, stdout: `${join(f.home, "elsewhere")}\n` };
      },
      stop: async () => {
        throw new Error("never stops");
      },
      restart: async () => {
        throw new Error("never restarts");
      },
    });
    expect(result).toEqual({ status: "not-npm-global" });
    expect(log).toEqual(["root --global"]);
  });
  it("fetches before stopping, installs the exact version and reports the new copy", async () => {
    const { result, log } = await run({ view: "2.0.0" });
    expect(result).toEqual({
      status: "upgraded",
      from: "1.0.0",
      to: "2.0.0",
      version: "2.0.0",
    });
    expect(log).toEqual([
      "npm root --global",
      "npm view @abelxiaoxing/cadence@latest version deprecated --json",
      "npm cache add @abelxiaoxing/cadence@2.0.0",
      "stop",
      "npm install --global --no-audit --no-fund @abelxiaoxing/cadence@2.0.0",
      "restart 2.0.0",
    ]);
  });
  it("names an exact requested version, and changes nothing for the current or a deprecated one", async () => {
    expect((await run({ to: "1.5.0", view: "1.5.0" })).log[1]).toBe(
      "npm view @abelxiaoxing/cadence@1.5.0 version deprecated --json",
    );
    const current = await run({ view: "1.0.0" });
    expect(current.result).toMatchObject({
      status: "current",
      version: "1.0.0",
    });
    expect(current.log).not.toContain("stop");
    const deprecated = await run({
      view: { version: "2.0.0", deprecated: "Withdrawn" },
    });
    expect(deprecated.result).toMatchObject({
      status: "deprecated",
      to: "2.0.0",
    });
    expect(deprecated.log).not.toContain("stop");
  });
  it("an unreachable registry or a failed download leaves the service running", async () => {
    for (const o of [{ viewStatus: 1 }, { cache: 1 }]) {
      const { result, log } = await run(o);
      expect(result).toMatchObject({
        status: "failed",
        reason: "fetch-failed",
      });
      expect(log).not.toContain("stop");
    }
  });
  it("installs nothing when the running service does not confirm its Stop", async () => {
    const { result, log } = await run({ stop: "unconfirmed" });
    expect(result).toMatchObject({
      status: "unconfirmed",
      reason: "stop-unconfirmed",
    });
    expect(log.some((line) => line.startsWith("npm install"))).toBe(false);
  });
  it("replaces a release that does not become ready with the previous version", async () => {
    const back = await run({ ready: [false, true] });
    expect(back.result).toEqual({
      status: "rolled-back",
      reason: "not-ready",
      from: "1.0.0",
      to: "2.0.0",
      version: "1.0.0",
    });
    expect(back.log.slice(-3)).toEqual([
      "restart 2.0.0",
      "npm install --global --no-audit --no-fund @abelxiaoxing/cadence@1.0.0",
      "restart 1.0.0",
    ]);
    const neither = await run({ ready: [false, false] });
    expect(neither.result).toMatchObject({
      status: "failed",
      reason: "not-ready",
    });
  });
  it("restarts whatever is installed after a failed install", async () => {
    const { result, log } = await run({ install: () => 1 });
    expect(result).toMatchObject({
      status: "failed",
      reason: "install-failed",
      version: "1.0.0",
    });
    expect(log.at(-1)).toBe("restart 1.0.0");
  });
  it("reads npm's single-field and object answers and refuses a range", async () => {
    const answer =
      (value: unknown, status = 0): Npm =>
      async () => ({ status, stdout: JSON.stringify(value) });
    expect(await release("latest", answer("2.0.28"))).toEqual({
      version: "2.0.28",
      deprecated: false,
    });
    expect(
      await release(
        "2.0.13",
        answer({ version: "2.0.13", deprecated: "Withdrawn; use 2.0.12" }),
      ),
    ).toEqual({ version: "2.0.13", deprecated: true });
    expect(await release("2", answer(["2.0.27", "2.0.28"]))).toBeUndefined();
    expect(await release("latest", answer({}, 1))).toBeUndefined();
  });
});

it("records a CLI result as the WebUI outcome", () => {
  expect(
    jobOutcome("restart", { status: "started", service: "alive" }),
  ).toEqual({
    state: "ready",
    reason: null,
  });
  expect(
    jobOutcome("restart", { status: "started", service: "quarantined" }),
  ).toEqual({ state: "failed", reason: "not-ready" });
  expect(jobOutcome("restart", { status: "unconfirmed" })).toEqual({
    state: "failed",
    reason: "stop-unconfirmed",
  });
  expect(jobOutcome("restart", { status: "foreign" })).toEqual({
    state: "failed",
    reason: "refused",
  });
  expect(jobOutcome("upgrade", { status: "current" })).toEqual({
    state: "ready",
    reason: null,
  });
  expect(jobOutcome("upgrade", { status: "rolled-back" })).toEqual({
    state: "rolled-back",
    reason: "not-ready",
  });
  expect(
    jobOutcome("upgrade", { status: "failed", reason: "install-failed" }),
  ).toEqual({ state: "failed", reason: "install-failed" });
  expect(jobOutcome("upgrade", { status: "not-writable" })).toEqual({
    state: "failed",
    reason: "refused",
  });
});
