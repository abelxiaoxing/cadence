/** Native attachment only. No SDK/auth resolution, worker or storage mutation. */

import { existsSync, realpathSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Agent, Dispatcher1Wrapper } from "undici";
import { nativeBuild } from "./native-build.ts";
import { ServiceCoordination } from "./service/coordination.ts";
import { ServiceClient } from "./service-client.ts";
import {
  ContractError,
  compatibleBuild,
  type SessionBootstrap,
} from "./service-contract.ts";
import { HttpServiceTransport } from "./service-http-client.ts";
import { effectiveWorkspace } from "./task-store.ts";

export const MANAGEMENT_GUIDANCE =
  "Cadence owner absent, unavailable or incompatible. Explicitly run cadence-service status --workspace <path>, cadence-service diagnose --workspace <path>, or cadence-service start --workspace <path>. Stop older Cadence sessions first. For retained fences use cadence-service recover inspect; resolve requires a local terminal and separate process, credential and storage acknowledgments. Never treat unavailable/quarantined as stopped. No service was started and no embedded executor is available.";

const UNIT = "cadence.service";
const xdg = (value: string | undefined, fallback: string) =>
  value && isAbsolute(value) ? value : fallback;
const cliPath = () =>
  JSON.stringify(fileURLToPath(new URL("./service-cli.mjs", import.meta.url)));

/** Linux: npm may skip or hide the Pi install hook that registers the user
 * unit, so name the explicit command when it is absent. Reads one path only. */
export function autostartHint(): string {
  if (process.platform !== "linux") return "";
  const data = xdg(
    process.env.XDG_DATA_HOME,
    join(homedir(), ".local", "share"),
  );
  if (existsSync(join(data, "systemd", "user", UNIT))) return "";
  return `\nTo run the shared service and WebUI (default http://127.0.0.1:17423) at boot: node ${cliPath()} autostart install --linger`;
}

export interface AutostartObservation {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
  /** Package root; only Pi's managed user copy registers itself. */
  root: string;
  /** logind keeps one flag file per lingering user name. */
  lingerFile: string;
}
function hostObservation(): AutostartObservation {
  let user = "";
  try {
    user = userInfo().username;
  } catch {
    // No passwd entry: linger is unobservable, so it reads as off.
  }
  return {
    platform: process.platform,
    env: process.env,
    home: homedir(),
    root: fileURLToPath(new URL("..", import.meta.url)),
    lingerFile: user ? join("/var/lib/systemd/linger", user) : "",
  };
}
/** Same selection as Pi's getAgentDir: PI_CODING_AGENT_DIR or ~/.pi/agent. */
function piUserCopy(o: AutostartObservation): boolean {
  const selected = o.env.PI_CODING_AGENT_DIR;
  const agent = !selected
    ? join(o.home, ".pi", "agent")
    : resolve(
        selected === "~"
          ? o.home
          : selected.startsWith("~/")
            ? join(o.home, selected.slice(2))
            : selected,
      );
  try {
    const managed = join(
      agent,
      "npm",
      "node_modules",
      "@abelxiaoxing",
      "cadence",
    );
    return realpathSync(managed) === realpathSync(o.root);
  } catch {
    return false;
  }
}
/** Startup-card line while boot start of the Linux user unit needs a human
 * step. Path observations only: nothing is created, spawned or started, and a
 * disabled or masked unit, CADENCE_AUTOSTART=0 or CADENCE_LINGER=0 is quiet. */
export function autostartNotice(
  o: AutostartObservation = hostObservation(),
): string | undefined {
  if (o.platform !== "linux" || o.env.CADENCE_AUTOSTART === "0") return;
  const data = xdg(o.env.XDG_DATA_HOME, join(o.home, ".local", "share"));
  const config = xdg(o.env.XDG_CONFIG_HOME, join(o.home, ".config"));
  if (!existsSync(join(data, "systemd", "user", UNIT)))
    return piUserCopy(o)
      ? `Cadence服务：未注册开机自启（npm 可能跳过或隐藏了安装脚本）。注册并开机启动：node ${cliPath()} autostart install --linger`
      : undefined;
  const user = join(config, "systemd", "user");
  if (
    existsSync(join(user, UNIT)) ||
    !existsSync(join(user, "default.target.wants", UNIT)) ||
    o.env.CADENCE_LINGER === "0" ||
    existsSync(o.lingerFile)
  )
    return;
  return "Cadence服务：linger 未开启，仅在登录后启动、注销时停止。开机启动：loginctl enable-linger";
}

export class NativeConnection {
  private transport?: HttpServiceTransport;
  private network?: Agent;
  private networkClose?: Promise<void>;
  private closing?: Promise<void>;
  private allocating?: Promise<void>;
  client?: ServiceClient;
  session?: SessionBootstrap;
  private epoch?: string;

  async attach(cwd: string): Promise<ServiceClient> {
    // Failed detach keeps its exact transport/slot. Explicit re-entry may retry
    // detach, but never forget it and allocate a replacement on uncertainty.
    await this.detach();
    // Pi started in the home directory attaches to the ~/cadence landing owner,
    // the same one the management client starts there. Observation only.
    const access = new ServiceCoordination(
      effectiveWorkspace(cwd).workspace,
    ).localAccess();
    this.epoch = access.epoch;
    const network = new Agent();
    this.network = network;
    // Node 22/24 built-in fetch bundles undici 6/7, whose legacy handlers an
    // undici 8 Agent rejects. The public wrapper adapts them on every line.
    const dispatcher = new Dispatcher1Wrapper(network);
    this.transport = new HttpServiceTransport({
      origin: access.endpoint,
      localCapability: access.capability,
      build: nativeBuild,
      // Bound finite requests, not the entire streaming archive. Export keeps
      // caller cancellation and the owner's download-idle policy, like WebUI.
      requestTimeoutMs: 10000,
      // Local capability MUST stay on direct numeric loopback even when the Pi
      // process routes provider auth through a proxy. Public per-request Node
      // dispatcher only: never replace/restore the parent's global dispatcher.
      fetch: (url, init) =>
        globalThis.fetch(url, Object.assign({}, init, { dispatcher })),
    });
    const client = new ServiceClient(this.transport);
    this.client = client;
    const allocation = (async () => {
      await this.refresh();
    })();
    this.allocating = allocation;
    try {
      await allocation;
    } finally {
      if (this.allocating === allocation) this.allocating = undefined;
    }
    return client;
  }
  async refresh(): Promise<SessionBootstrap> {
    if (!this.client) throw new ContractError("unavailable");
    const reply = await this.client.session();
    if (reply.kind === "error") throw new ContractError(reply.error.code);
    if (reply.value.authority !== "local" || reply.value.epoch !== this.epoch)
      throw new ContractError("stale");
    this.session = reply.value;
    return reply.value;
  }
  compatible(safety = false): boolean {
    return compatibleBuild(this.session?.build, nativeBuild, safety);
  }
  detach(): Promise<void> {
    if (this.closing) return this.closing;
    const transport = this.transport;
    const network = this.network;
    if (!transport && !network) return Promise.resolve();
    const allocation = this.allocating;
    const closing = (async () => {
      // Track late allocations; a caller's departure isn't evidence of release.
      await allocation?.catch(() => {});
      await transport?.detach();
      if (network) {
        this.networkClose ??= Promise.resolve().then(() => network.close());
        await this.networkClose; // original close; failure retains this exact resource
      }
      if (this.transport === transport && this.network === network) {
        this.network = undefined;
        this.networkClose = undefined;
        this.transport = undefined;
        this.client = undefined;
        this.session = undefined;
      }
    })();
    this.closing = closing;
    void closing
      .finally(() => {
        if (this.closing === closing) this.closing = undefined;
      })
      .catch(() => {});
    return closing;
  }
}
