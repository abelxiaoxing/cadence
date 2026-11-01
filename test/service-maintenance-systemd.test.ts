/** The real systemd user manager, opt-in (CADENCE_SYSTEMD_E2E=1; see
 * engineering/verification.md). A generated workbench unit, the bundled CLI
 * and gateway and a real transient job: a child inside the service is refused
 * without any change, and the WebUI route restarts the service from outside it.
 * The unit lives in a private HOME and is linked from the manager's runtime
 * directory, so the account's own systemd, Pi and state directories stay as
 * they are. */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildUnit,
  hostSystem,
  serviceConfigPath,
  serviceEnvironment,
  unitPath,
  write,
} from "../src/service/autostart.ts";
import { ownerControl } from "../src/service/cli.ts";
import type { MaintenanceJob } from "../src/service/contracts/gateway.ts";
import { GatewayStore } from "../src/service/gateway-store.ts";
import { installedVersion } from "../src/service/maintenance.ts";
import {
  ensureServerConfig,
  readServerConfig,
} from "../src/service/server-config.ts";
import { loadWebAssets } from "../src/service-assets.ts";

const repository = fileURLToPath(new URL("..", import.meta.url));
const enabled =
  process.platform === "linux" &&
  process.env.CADENCE_SYSTEMD_E2E === "1" &&
  !!process.env.XDG_RUNTIME_DIR;
const systemctl = (...args: string[]) =>
  spawnSync("systemctl", ["--user", ...args], { encoding: "utf8" });
const property = (unit: string, name: string) =>
  systemctl("show", `--property=${name}`, "--value", unit).stdout.trim();
async function until<T>(
  read: () => Promise<T | undefined> | T | undefined,
  ms: number,
): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    try {
      const value = await read();
      if (value !== undefined) return value;
    } catch {
      /* not answering yet */
    }
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
async function freePort(): Promise<number> {
  const server = createServer().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  if (!address || typeof address === "string") throw new Error("port");
  return address.port;
}

describe.skipIf(!enabled)("real systemd user manager", () => {
  it("refuses a restart from inside the service and restarts it from the WebUI's transient unit", async () => {
    const root = mkdtempSync(join(tmpdir(), "cm-"));
    const name = `e2e${randomBytes(3).toString("hex")}`,
      unit = `cadence-${name}.service`;
    const home = join(root, "home"),
      state = join(root, "state"),
      agent = join(root, "agent");
    for (const dir of [home, state, agent]) mkdirSync(dir, { recursive: true });
    const runtime = join(process.env.XDG_RUNTIME_DIR ?? "", "systemd", "user");
    const link = join(runtime, unit),
      dropIn = join(runtime, `${unit}.d`);
    const s = hostSystem(repository, ownerControl, { scope: "user", name });
    s.home = home;
    s.node = process.execPath;
    s.env = {
      PATH: process.env.PATH,
      LANG: "C.UTF-8",
      XDG_STATE_HOME: state,
      PI_CODING_AGENT_DIR: agent,
    };
    const cli = join(repository, "src", "service-cli.mjs");
    ensureServerConfig(home, { name, port: await freePort() });
    const config = serviceConfigPath(s);
    const configBytes = readFileSync(config);
    const { port, token } = readServerConfig(config).config;
    const endpoint = `http://127.0.0.1:${port}`;
    try {
      write(
        unitPath(s),
        buildUnit({
          node: s.node,
          cli,
          workspace: null,
          serverConfig: config,
          agentDir: agent,
          sdk: [],
          environment: serviceEnvironment(s),
        }),
      );
      mkdirSync(dropIn, { recursive: true });
      symlinkSync(unitPath(s), link);
      // A management command started by a process inside the service, as an
      // agent tool would, detached into its own session.
      const once = join(root, "inside.once"),
        inside = join(root, "inside.json");
      writeFileSync(
        join(dropIn, "test.conf"),
        `[Service]\nEnvironment=HOME=${home}\nExecStartPost=/bin/sh -c 'test -e ${once} || { : > ${once}; setsid nohup ${process.execPath} ${cli} server restart --user --name ${name} > ${inside} 2>/dev/null & }'\n`,
      );
      expect(systemctl("daemon-reload").status).toBe(0);
      expect(systemctl("start", unit).status).toBe(0);
      const store = new GatewayStore(config, state);
      await until(
        () => (store.inspect().status === "alive" ? true : undefined),
        20_000,
      );
      const first = property(unit, "InvocationID");

      const refused = await until(() => {
        const text = existsSync(inside) ? readFileSync(inside, "utf8") : "";
        return text.endsWith("\n") ? JSON.parse(text) : undefined;
      }, 20_000);
      expect(refused).toEqual({ status: "inside-service", unit });
      expect(property(unit, "ActiveState")).toBe("active");
      expect(property(unit, "InvocationID")).toBe(first);
      expect(readFileSync(config)).toEqual(configBytes);

      const entered = await fetch(`${endpoint}/?token=${token}`, {
        redirect: "manual",
      });
      const headers = {
        Cookie: entered.headers.get("set-cookie")?.split(";")[0] ?? "",
        Origin: endpoint,
      };
      const workbench = (await (
        await fetch(`${endpoint}/workbench/v1`, { headers })
      ).json()) as { epoch: string; csrf: string };
      const version = installedVersion(repository);
      const service = await (
        await fetch(`${endpoint}/workbench/v1/service`, { headers })
      ).json();
      expect(service).toMatchObject({
        version,
        unit: { name: unit, scope: "user" },
        work: 0,
        job: null,
      });
      const manifest = loadWebAssets().manifest;
      const response = await fetch(`${endpoint}/workbench/v1/service`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "X-Cadence-CSRF": workbench.csrf,
          "X-Cadence-Build": JSON.stringify({
            kind: "browser",
            sourceHash: manifest.sourceHash,
            contractHash: manifest.contractHash,
            buildId: manifest.buildId,
          }),
        },
        body: JSON.stringify({
          action: "restart",
          from: version,
          to: null,
          work: 0,
          epoch: workbench.epoch,
        }),
      });
      const accepted = (await response.json()) as { job: MaintenanceJob };
      expect(response.status, JSON.stringify(accepted)).toBe(200);
      expect(accepted.job).toMatchObject({
        action: "restart",
        state: "running",
      });
      // The old service stops and a new one answers; the job records the outcome.
      const settled = await until(async () => {
        const current = (await (
          await fetch(`${endpoint}/workbench/v1/service`, { headers })
        ).json()) as { job: MaintenanceJob | null };
        return current.job?.id === accepted.job.id &&
          current.job.state !== "running"
          ? current.job
          : undefined;
      }, 60_000);
      expect(settled).toMatchObject({ state: "ready", reason: null, version });
      expect(property(unit, "ActiveState")).toBe("active");
      expect(property(unit, "InvocationID")).not.toBe(first);
      expect(store.inspect().epoch).not.toBe(workbench.epoch);
      expect(readFileSync(config)).toEqual(configBytes);
      // The transient job was collected, and its journal never carried the token.
      const job = unit.replace(/\.service$/, ".maintenance.service");
      await until(
        () => (property(job, "ActiveState") === "active" ? undefined : true),
        10_000,
      );
      const journal = spawnSync(
        "journalctl",
        ["--user", "-u", job, "-o", "cat", "--no-pager"],
        { encoding: "utf8" },
      );
      if (journal.status === 0) expect(journal.stdout).not.toContain(token);
    } finally {
      systemctl("stop", unit);
      rmSync(link, { force: true });
      rmSync(dropIn, { recursive: true, force: true });
      systemctl("daemon-reload");
      systemctl("reset-failed", unit);
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});
