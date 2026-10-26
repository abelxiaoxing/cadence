/** Native attachment only. No SDK/auth resolution, worker or storage mutation. */

import { existsSync, realpathSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
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
const LABEL = "com.abelxiaoxing.cadence";
/** Exists only when systemd booted the machine (sd_booted); without it there
 * is no user manager, and `server install` reports unavailable. */
const SYSTEMD_BOOTED = "/run/systemd/system";
const xdg = (value: string | undefined, fallback: string) =>
  value && isAbsolute(value) ? value : fallback;
/** The definition `cadence server install` writes, or undefined without a
 * supported user service manager. */
function definition(o: AutostartObservation): string | undefined {
  switch (o.platform) {
    case "linux":
      return existsSync(o.systemd)
        ? join(
            xdg(o.env.XDG_DATA_HOME, join(o.home, ".local", "share")),
            "systemd",
            "user",
            UNIT,
          )
        : undefined;
    case "darwin":
      return join(o.home, "Library", "LaunchAgents", `${LABEL}.plist`);
    case "win32":
      return join(
        xdg(o.env.LOCALAPPDATA, join(o.home, "AppData", "Local")),
        "cadence-server",
        "cadence.vbs",
      );
    default:
      return undefined;
  }
}
const bootStart = (o: AutostartObservation) =>
  o.platform === "linux" && o.env.CADENCE_LINGER !== "0";
/** Pi's managed copy puts no `cadence` bin on PATH; CADENCE_LINGER=0 keeps
 * the suggested command login-only, too. */
const installCommand = (o: AutostartObservation) =>
  `${piUserCopy(o) ? `node ${JSON.stringify(join(o.root, "src", "service-cli.mjs"))}` : "cadence"} server install${o.platform === "linux" && o.env.CADENCE_LINGER === "0" ? " --no-linger" : ""}`;

/** Name the explicit command while no background service is registered.
 * Reads paths only. */
export function autostartHint(
  o: AutostartObservation = hostObservation(),
): string {
  const path = definition(o);
  if (!path || existsSync(path)) return "";
  return `\nTo run the shared service and WebUI (default http://127.0.0.1:17423) ${bootStart(o) ? "at boot" : "at login"}: ${installCommand(o)}`;
}

export interface AutostartObservation {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
  /** Package root; installed copies, not checkouts, get the startup notice. */
  root: string;
  /** logind keeps one flag file per lingering user name. */
  lingerFile: string;
  /** Exists only on a systemd-booted machine. */
  systemd: string;
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
    systemd: SYSTEMD_BOOTED,
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
/** An npm or Pi package copy; a checkout loaded with `pi -e` is explicit by design. */
function installedCopy(o: AutostartObservation): boolean {
  return piUserCopy(o) || resolve(o.root).split(sep).includes("node_modules");
}
/** Startup-card warning while the background service needs a human step.
 * Path observations only: nothing is created, spawned or started. A machine
 * without a supported user service manager, a disabled or (also runtime-)
 * masked Linux unit and CADENCE_AUTOSTART=0 are quiet; CADENCE_LINGER=0 never
 * suggests linger. */
export function autostartNotice(
  o: AutostartObservation = hostObservation(),
): string | undefined {
  if (o.env.CADENCE_AUTOSTART === "0") return;
  const path = definition(o);
  if (!path) return;
  if (!existsSync(path))
    return installedCopy(o)
      ? `Cadence服务：后台服务未安装，WebUI（默认 http://127.0.0.1:17423）不会运行。安装并${bootStart(o) ? "开机" : "登录后"}自启：${installCommand(o)}`
      : undefined;
  if (o.platform !== "linux") return;
  const config = xdg(o.env.XDG_CONFIG_HOME, join(o.home, ".config"));
  const user = join(config, "systemd", "user");
  const runtime = o.env.XDG_RUNTIME_DIR;
  if (
    existsSync(join(user, UNIT)) ||
    (runtime &&
      isAbsolute(runtime) &&
      existsSync(join(runtime, "systemd", "user", UNIT))) ||
    !existsSync(join(user, "default.target.wants", UNIT)) ||
    o.env.CADENCE_LINGER === "0" ||
    existsSync(o.lingerFile)
  )
    return;
  return "Cadence服务：linger 未开启，仅在登录后启动、注销时停止。开机启动：loginctl enable-linger";
}

/** Pi exits right after its session_shutdown handlers settle. An unsent
 * detach leaves the attachment holding one of the owner's viewer slots until
 * its idle expiry, so a departing session waits briefly for the detach; a
 * slow or absent owner never holds Pi's quit longer than `ms`. */
export async function departure(detaching: Promise<void>, ms = 1500) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    detaching.catch(() => {}),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms);
      timer.unref?.();
    }),
  ]);
  clearTimeout(timer);
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
