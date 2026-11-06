/** SDK-free native management client. No task-action or provider API imports. */

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { request } from "node:http";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureUserConfig } from "../install-config.mjs";
import { networkSnapshot, sameNetwork } from "../sdk-network.ts";
import {
  ContractError,
  decodeId,
  type ErrorCode,
  LIMITS,
  parseWireJson,
} from "../service-contract.ts";
import { effectiveWorkspace, privateWorkspace } from "../workspace.ts";
import {
  type AutostartResult,
  type AutostartSystem,
  agentDirectory,
  autostartStatus,
  configureAutostart,
  hostSystem,
  type LingerState,
  type OwnerControl,
  piUserInstall,
  removeAutostart,
  serviceConfigPath,
  serviceName,
  stopAutostart,
} from "./autostart.ts";
import { closed, text } from "./contracts/core.ts";
import { decodeVersion } from "./contracts/gateway.ts";
import {
  type RegistryLockDiagnostic,
  ServiceCoordination,
} from "./coordination.ts";
import {
  doctor,
  healAccount,
  healProjectForStart,
  missingWorkspace,
} from "./doctor.ts";
import { gatewayMain } from "./gateway-cli.ts";
import { GatewayStore } from "./gateway-store.ts";
import { packageCommands } from "./installation.ts";
import {
  configureLaunchAgent,
  LABEL,
  launchAgentStatus,
  removeLaunchAgent,
  stopLaunchAgent,
} from "./launchd.ts";
import {
  configureLoginRun,
  launcherPath,
  loginRunStatus,
  removeLoginRun,
  stopLoginRun,
} from "./login-run.ts";
import {
  insideUnit,
  installedVersion,
  jobOutcome,
  MaintenanceRecord,
  restartInstalled,
  type UpgradeResult,
  upgradeService,
} from "./maintenance.ts";
import { encoded } from "./private-files.ts";
import {
  decodeHostInput,
  decodeStartupReport,
  type HostInput,
  hostEnvironment,
  portValue,
  readHostConfig,
  STARTUP_INPUT_BYTES,
  type StartOptions,
  type StartupReport,
  selectStart,
} from "./runtime.ts";
import {
  DEFAULT_PORT,
  ensureServerConfig,
  PORT_KEY,
  ServerConfigRefusal,
  TOKEN_KEY,
  serverConfigPath as workbenchConfigPath,
} from "./server-config.ts";
import {
  configureSystemService,
  stopSystemService,
  systemServiceStatus,
} from "./system-service.ts";

export interface ManagementReply {
  status:
    | "absent"
    | "alive"
    | "stopped"
    | "stopping"
    | "quarantined"
    | "unavailable"
    | "unconfirmed"
    | "accepted"
    | "rotated";
  epoch?: string | null;
  actions?: boolean;
  generation?: number;
}
export interface ControlTarget {
  localAccess(): { endpoint: string; epoch: string; capability: string };
  inspect(): { status: string; epoch?: string | null };
  registryLockDiagnostic?(): RegistryLockDiagnostic | undefined;
}
export function nativeCall(
  c: ControlTarget,
  operation: string,
  reveal = false,
  controlBody?: { attachments: string[] },
  signal?: AbortSignal,
): Promise<unknown> {
  if (signal?.aborted) return Promise.reject(new ContractError("unavailable"));
  const access = c.localAccess();
  const url = new URL(`${access.endpoint}/local/v1/admin/${operation}`);
  const write = !["status", "diagnose", "activity"].includes(operation);
  const maximum = operation === "activity" ? 256 * 1024 : 16384;
  const body = write
    ? JSON.stringify(controlBody ?? (reveal ? { reveal: true } : {}))
    : undefined;
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let removeAbort = () => {};
    const fail = () => {
      clearTimeout(timer);
      removeAbort();
      reject(new ContractError("unavailable"));
    };
    const req = request(
      url,
      {
        method: write ? "POST" : "GET",
        // A single-use direct agent must not inherit native globalAgent proxy
        // routing. The local capability never belongs on a provider proxy, even
        // when this management process was started with --use-env-proxy.
        agent: false,
        headers: {
          "X-Cadence-Local": access.capability,
          Connection: "close",
          ...(body
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body),
              }
            : {}),
        },
      },
      (res) => {
        let bytes = 0;
        const chunks: Buffer[] = [];
        res.on("error", fail);
        res.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > maximum) {
            res.destroy();
            fail();
          } else chunks.push(chunk);
        });
        res.on("end", () => {
          try {
            if (res.statusCode !== 200) throw new ContractError("unavailable");
            const reply = closed(
              parseWireJson(
                new TextDecoder("utf-8", { fatal: true }).decode(
                  Buffer.concat(chunks),
                ),
                maximum,
              ),
              ["kind", "value"],
            );
            if (reply.kind !== "ok") throw new ContractError("unavailable");
            if (
              ["status", "diagnose", "stop", "activity"].includes(operation)
            ) {
              if (
                !reply.value ||
                typeof reply.value !== "object" ||
                !("epoch" in reply.value) ||
                reply.value.epoch !== access.epoch
              )
                throw new ContractError("stale");
            }
            clearTimeout(timer);
            removeAbort();
            resolve(reply.value);
          } catch {
            fail();
          }
        });
      },
    );
    // A management wait is absolute, not a socket-idle timeout that a trickling
    // response can renew indefinitely. Destroy only this request, never the host.
    timer = setTimeout(() => {
      fail();
      req.destroy();
    }, 2000);
    const cancel = () => {
      fail();
      req.destroy();
    };
    signal?.addEventListener("abort", cancel, { once: true });
    removeAbort = () => signal?.removeEventListener("abort", cancel);
    req.on("error", fail);
    req.on("close", fail);
    if (signal?.aborted) cancel();
    else req.end(body);
  });
}
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
export async function serviceStatus(
  c: ControlTarget,
  diagnose = false,
): Promise<unknown> {
  const registryLock = c.registryLockDiagnostic?.();
  if (registryLock)
    return {
      status: "unavailable",
      ...registryLock,
      recovery: "cadence doctor",
    };
  const observed = c.inspect();
  if (observed.status === "absent" || observed.status === "stopped")
    return observed;
  try {
    return await nativeCall(c, diagnose ? "diagnose" : "status");
  } catch {
    return {
      status: observed.status === "quarantined" ? "quarantined" : "unavailable",
    };
  }
}
export async function stopService(c: ControlTarget): Promise<ManagementReply> {
  // A disconnected/missing ack is never a successful stop, even if a later file
  // looks stopped. Only this authenticated exact-epoch accepted request is joined.
  let epoch: string;
  try {
    const reply = closed(await nativeCall(c, "stop"), ["status", "epoch"]);
    if (reply.status !== "accepted") throw new ContractError("unavailable");
    epoch = decodeId(reply.epoch);
  } catch {
    return { status: "unconfirmed" };
  }
  const deadline = performance.now() + LIMITS.stopWaitMs;
  while (performance.now() < deadline) {
    let observed: ReturnType<ControlTarget["inspect"]>;
    try {
      observed = c.inspect();
    } catch {
      // Registration replacement can race this passive sample. Keep joining
      // the already accepted exact-epoch Stop within its original deadline;
      // an unreadable sample is never closure and never resends the request.
      observed = { status: "unavailable" };
    }
    if (
      "epoch" in observed &&
      observed.epoch === epoch &&
      observed.status === "stopped"
    )
      return { status: "stopped", epoch };
    if (observed.status === "quarantined")
      return { status: "quarantined", epoch };
    if (
      "epoch" in observed &&
      observed.epoch !== null &&
      observed.epoch !== epoch
    )
      return { status: "unconfirmed", epoch };
    // Release holds the short registry lock; a passive inconclusive sample is
    // neither native stop nor proof of ownership loss. Keep the same bounded wait.
    await pause(25);
  }
  return { status: "unconfirmed", epoch };
}
function failedStatus(result: unknown): boolean {
  return !!(
    result &&
    typeof result === "object" &&
    "status" in result &&
    ["unconfirmed", "unavailable", "quarantined", "refused"].includes(
      String(result.status),
    )
  );
}
/** EX_CONFIG: deterministic foreground refusal is not a supervisor retry loop. */
export function managementExitCode(
  result: unknown,
  foreground = false,
): number {
  if (foreground) {
    try {
      decodeStartupReport(result);
      return 78;
    } catch {
      /* not a startup refusal */
    }
  }
  return 1;
}
/** Manager acceptance is not authenticated owner readiness. */
export function observedServerResult<T extends AutostartResult>(
  result: T,
  service: string,
) {
  return {
    ...result,
    service,
    ...(result.status === "started" && service !== "alive"
      ? {
          managerStatus: result.status,
          status: service === "quarantined" ? "quarantined" : "unconfirmed",
        }
      : {}),
  };
}
/** The specific reason, naming only the path, keys and line numbers. */
function serverConfigHint(error: ServerConfigRefusal): string {
  return `Cadence changed nothing: ${error.path} ${error.reason}.\nFix it and run the command again; the file holds the WebUI port and token as ${PORT_KEY}=<1-65535> and ${TOKEN_KEY}=<a non-empty token>, one line each.\n`;
}
function registryGuidance(_workspace: string, stateHome: string): string {
  return `Another Cadence process is updating the shared project registry right now. Try again in a moment; if this persists: cadence doctor --state-home ${JSON.stringify(stateHome)}\n`;
}
/** Answers on the owner's authenticated status route, retried briefly so a
 * busy owner is not mistaken for a stuck one. */
export async function ownerResponsive(c: ControlTarget): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await nativeCall(c, "status");
      return true;
    } catch {
      await pause(500);
    }
  }
  return false;
}
/** One fixed hint per refused startup stage, naming only the selected sources. */
function startupGuidance(result: unknown, input: HostInput): string {
  let report: StartupReport;
  try {
    report = decodeStartupReport(result);
  } catch {
    return "";
  }
  if (report.error === "registry-locked")
    return registryGuidance(input.workspace, input.stateHome);
  const agent = input.config.agentDir;
  const inspect = `Details: cadence doctor --workspace ${JSON.stringify(input.workspace)}\n`;
  switch (report.stage) {
    case "package":
      return "Cadence refused its installed package files (web/dist or agents); reinstall the package rather than editing it.\n";
    case "pi-agent-directory":
      return `Pi's agent directory ${agent} must be an existing real directory (not a symlink) owned by you.\n`;
    case "pi-auth":
      return `${join(agent, "auth.json")} must be your own single-link regular file holding valid Pi credentials; log in to Pi first.\n`;
    case "pi-models":
      return `${join(agent, "models.json")} must be your own single-link regular file using only fields Cadence's pinned Pi SDK supports; a field only newer Pi understands is refused.\n`;
    case "pi-runtime":
      return `Loading Pi's SDK model runtime failed (optional SDK packages missing, or sources the SDK refuses). Fix that and start again; the next start recovers the owner's registration automatically.\n${inspect}`;
    default:
      return report.error === "recording-exhausted"
        ? `The disk is too full for Cadence's history. Free some space and start again.\n`
        : report.status === "quarantined"
          ? `The owner registered, then refused to start. Start again; the next start recovers its registration automatically.\n${inspect}`
          : "";
  }
}
export async function startService(
  options: StartOptions,
  foreground: boolean,
  hostUrl: URL,
): Promise<unknown> {
  const network = networkSnapshot(process.env);
  const env = hostEnvironment(process.env); // validate route before any child/SDK import
  const c = new ServiceCoordination(options.workspace, options.stateHome);
  // Whatever a dead predecessor left behind is reclaimed before observing.
  const blocked = await healProjectForStart(c, () => ownerResponsive(c));
  if (blocked) {
    process.stderr.write(blocked);
    return {
      status: "refused",
      error: "quarantine",
      stage: "service",
    } satisfies StartupReport;
  }
  if (c.registryLockDiagnostic()) {
    process.stderr.write(registryGuidance(c.store.root, c.stateHome));
    return {
      status: "refused",
      error: "registry-locked",
      stage: "service",
    } satisfies StartupReport;
  }
  let input: HostInput;
  try {
    input = decodeHostInput(selectStart(options, process.env));
  } catch (error) {
    if (error instanceof ServerConfigRefusal)
      process.stderr.write(serverConfigHint(error));
    throw error;
  }
  const serialized = `${JSON.stringify(input)}\n`;
  if (Buffer.byteLength(serialized) > STARTUP_INPUT_BYTES)
    throw new ContractError("oversize");
  const existing = await serviceStatus(c);
  if (
    existing &&
    typeof existing === "object" &&
    "status" in existing &&
    existing.status === "alive"
  ) {
    // A running owner keeps its selection; a server configuration that
    // reselects it applies only after its orderly Stop.
    const running = readHostConfig(c);
    if (running && encoded(running) !== encoded(input.config))
      throw new ContractError("conflict");
    return existing;
  }
  return launchHost(input, c, foreground, hostUrl, c.store.root, env, network);
}
export async function launchHost(
  input: HostInput | import("./gateway-store.ts").GatewayInput,
  c: ControlTarget,
  foreground: boolean,
  hostUrl: URL,
  cwd: string,
  env: NodeJS.ProcessEnv,
  network: ReturnType<typeof networkSnapshot>,
): Promise<unknown> {
  const serialized = `${JSON.stringify(input)}\n`;
  if (Buffer.byteLength(serialized) > STARTUP_INPUT_BYTES)
    throw new ContractError("oversize");
  // No global Node search, inherited preloads, credentials on argv, or TS fallback.
  if (!sameNetwork(network, networkSnapshot(process.env)))
    throw new ContractError("stale");
  const child = spawn(
    process.execPath,
    [
      ...(env.NODE_USE_ENV_PROXY === "1" ? ["--use-env-proxy"] : []),
      fileURLToPath(hostUrl),
    ],
    {
      cwd,
      // A foreground owner under systemd is restarted by its unit after a
      // fault; any other owner starts its own replacement.
      env:
        foreground && process.env.INVOCATION_ID
          ? { ...env, CADENCE_SUPERVISED: "systemd" }
          : env,
      detached: !foreground,
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
    },
  );
  let completed = false;
  const closure = new Promise<void>((resolve) =>
    child.once("close", (code, signal) => {
      completed = true;
      // Foreground management waits this original child; a failed native close
      // cannot become CLI success merely because readiness was printed earlier.
      if (foreground && (code !== 0 || signal !== null)) process.exitCode = 1;
      resolve();
    }),
  );
  void closure;
  const startup = new Promise<unknown>((resolve) => {
    let bytes = "",
      resolved = false;
    const finish = (value: unknown) => {
      if (!resolved) {
        resolved = true;
        resolve(value);
      }
    };
    child.on("error", () => finish({ status: "unconfirmed" }));
    child.stdin.on("error", () => finish({ status: "unconfirmed" }));
    child.stdout.on("error", () => finish({ status: "unconfirmed" }));
    child.stdout.on("data", (chunk: Buffer) => {
      if (Buffer.byteLength(bytes) + chunk.length > 4096) {
        finish({ status: "unconfirmed" });
        return;
      }
      bytes += chunk.toString("utf8");
      if (!bytes.endsWith("\n")) return;
      try {
        const line = parseWireJson(bytes, 4096);
        // The host's own fixed refusal: a code and stage, never paths or text.
        if (
          line &&
          typeof line === "object" &&
          "status" in line &&
          line.status !== "ready"
        ) {
          finish(decodeStartupReport(line));
          return;
        }
        const ready = closed(line, ["status", "epoch"]);
        if (ready.status !== "ready") throw new ContractError("unavailable");
        const epoch = decodeId(ready.epoch);
        void nativeCall(c, "status")
          .then((reply) => {
            if (
              !reply ||
              typeof reply !== "object" ||
              !("epoch" in reply) ||
              reply.epoch !== epoch
            )
              throw new ContractError("stale");
            finish(reply);
          })
          .catch(() => finish({ status: "unconfirmed" }));
      } catch {
        finish({ status: "unconfirmed" });
      }
    });
    child.once("close", () => finish({ status: "unconfirmed" }));
  });
  child.stdin.end(serialized);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    startup,
    new Promise<unknown>((resolve) => {
      timer = setTimeout(
        () => resolve({ status: "unconfirmed" }),
        LIMITS.startWaitMs,
      );
    }),
  ]);
  clearTimeout(timer);
  const guidance = "kind" in input ? "" : startupGuidance(result, input);
  if (guidance) process.stderr.write(guidance);
  // A reporting bound/client departure never sends a signal or restarts a child.
  child.stdout.destroy();
  child.stdin.destroy();
  if (!foreground) child.unref();
  else if (!completed) {
    if (failedStatus(result)) process.exitCode = 1;
    process.stdout.write(`${JSON.stringify(result)}\n`);
    await closure;
    if (failedStatus(result))
      process.exitCode = managementExitCode(result, true);
    return null;
  }
  return result;
}
/** Observe the unit's owner through the same authenticated status route; a
 * reporting bound is not a stop or restart reason. */
async function observeStarted(
  workspace: string | null,
  config?: string,
): Promise<{ service: string; endpoint?: string }> {
  const deadline = performance.now() + LIMITS.startWaitMs + 2000;
  let service = "unconfirmed";
  while (performance.now() < deadline) {
    try {
      const c =
        workspace === null
          ? new GatewayStore(config ?? workbenchConfigPath(homedir()))
          : new ServiceCoordination(workspace);
      const observed = await serviceStatus(c);
      if (observed && typeof observed === "object" && "status" in observed)
        service = String(observed.status);
      if (service === "alive")
        return { service, endpoint: c.localAccess().endpoint };
      if (service === "quarantined") break;
    } catch {
      /* not registered yet */
    }
    await pause(250);
  }
  return { service };
}
/** The running owner's private entry link, for the guidance only: never part
 * of the JSON result. */
async function privateLink(
  workspace: string | null,
  stateHome?: string,
  config?: string,
): Promise<string | undefined> {
  try {
    const value = closed(
      await nativeCall(
        workspace === null
          ? new GatewayStore(
              config ?? workbenchConfigPath(homedir()),
              stateHome,
            )
          : new ServiceCoordination(workspace, stateHome),
        "token-link",
        true,
      ),
      ["link"],
    );
    return text(value.link, 4096, true);
  } catch {
    return undefined;
  }
}
/** Orderly owner control for service managers that only signal (macOS, Windows). */
export const ownerControl: OwnerControl = {
  async ownerStatus(workspace, config) {
    try {
      const observed = await serviceStatus(
        workspace === null
          ? new GatewayStore(config ?? workbenchConfigPath(homedir()))
          : new ServiceCoordination(workspace),
      );
      return observed && typeof observed === "object" && "status" in observed
        ? String(observed.status)
        : "unavailable";
    } catch {
      return "unavailable";
    }
  },
  async stopOwner(workspace, config) {
    try {
      const c =
        workspace === null
          ? new GatewayStore(config ?? workbenchConfigPath(homedir()))
          : new ServiceCoordination(workspace);
      const observed = await serviceStatus(c);
      const status =
        observed && typeof observed === "object" && "status" in observed
          ? String(observed.status)
          : "unavailable";
      if (status === "absent" || status === "stopped") return "stopped";
      return status === "alive" ? (await stopService(c)).status : status;
    } catch {
      return "unavailable";
    }
  },
};
type ServerAction =
  | "install"
  | "status"
  | "restart"
  | "stop"
  | "uninstall"
  | "upgrade";
async function serverAction(
  s: AutostartSystem,
  action: Exclude<ServerAction, "upgrade">,
  requested: string | undefined,
  linger: boolean,
): Promise<AutostartResult> {
  const install = action === "install" || action === "restart";
  const mode = action === "install" ? "install" : "restart";
  switch (s.platform) {
    case "linux":
      if (s.scope === "system") {
        if (install) return configureSystemService(s, mode, requested);
        if (action === "stop" || action === "uninstall")
          return stopSystemService(s, action === "uninstall");
        return systemServiceStatus(s);
      }
      if (install) return configureAutostart(s, mode, requested, linger);
      if (action === "stop") return stopAutostart(s);
      return action === "uninstall" ? removeAutostart(s) : autostartStatus(s);
    case "darwin":
      if (install) return configureLaunchAgent(s, mode, requested);
      if (action === "stop") return stopLaunchAgent(s);
      return action === "uninstall"
        ? removeLaunchAgent(s)
        : launchAgentStatus(s);
    case "win32":
      if (install) return configureLoginRun(s, mode, requested);
      if (action === "stop") return stopLoginRun(s);
      return action === "uninstall" ? removeLoginRun(s) : loginRunStatus(s);
    default:
      return { status: "unsupported" };
  }
}
/** Linux only: the WebUI's restart and upgrade use systemd's transient units,
 * and the other platforms' managers have not been qualified for it. */
function upgrade(
  s: AutostartSystem,
  to: string | undefined,
): Promise<UpgradeResult> {
  if (s.platform !== "linux") return Promise.resolve({ status: "unsupported" });
  return upgradeService(s, to, {
    commands: packageCommands(s),
    stop: () => serverAction(s, "stop", undefined, false),
    restart: () => restartInstalled(s),
  });
}
function serverGuidance(
  s: AutostartSystem,
  action: ServerAction,
  result: AutostartResult & { service?: string; endpoint?: string },
  link: string | undefined,
): string {
  // Pi's managed copy puts no `cadence` bin on PATH.
  const cli = piUserInstall(s)
    ? `node ${JSON.stringify(join(s.root, "src", "service-cli.mjs"))}`
    : "cadence";
  const note = result.redirectedFrom
    ? `Cadence workspace: ${result.workspace} (${result.redirectedFrom} contains Cadence's private state)\n`
    : "";
  return note + serverStatusGuidance(s, action, result, cli, link);
}
/** Linger only; never `server install`, which restarts the owner. */
function lingerGuidance(linger: LingerState | undefined): string {
  switch (linger) {
    case "enabled":
      return "Linger enabled: Cadence starts at boot and keeps running after logout (undo: loginctl disable-linger).\n";
    case "off":
      return "Linger is off: Cadence starts at login and stops at logout. Start it at boot: loginctl enable-linger\n";
    case "refused":
      return "Linger needs authorization: Cadence starts at login and stops at logout. Start it at boot: loginctl enable-linger (may ask for your password)\n";
    default:
      return "";
  }
}
/** The platform's own diagnosis for a definition it refused to load or start. */
function managerDetail(s: AutostartSystem): string {
  switch (s.platform) {
    case "linux":
      return `see systemctl ${s.scope === "system" ? "--system" : "--user"} status ${s.unit} and journalctl ${s.scope === "system" ? "" : "--user "}-u ${s.unit}`;
    case "darwin":
      return `see launchctl print gui/${s.uid}/${LABEL} and ~/Library/Logs/cadence.log`;
    default:
      return `run its launcher to see why: wscript ${JSON.stringify(launcherPath(s))}`;
  }
}
const REASONS: Record<string, string> = {
  "fetch-failed": "the release could not be fetched; the service kept running",
  "stop-unconfirmed": "the running service did not confirm its orderly Stop",
  "install-failed": "the package manager could not install it",
  "not-ready": "the new version did not become ready",
};
function serverStatusGuidance(
  s: AutostartSystem,
  action: ServerAction,
  result: UpgradeResult & { service?: string; endpoint?: string },
  cli: string,
  link: string | undefined,
): string {
  const workspace = JSON.stringify(result.workspace ?? "");
  if (result.status === "inside-service")
    return `This command runs inside ${s.unit}: stopping the service would also end this command before it starts Cadence again. Restart or upgrade from the WebUI (Cadence service), or run the command in a terminal outside the service.\n`;
  if (action === "upgrade") {
    const terminal = `Upgrade it the way you installed it, then: ${cli} server restart`;
    switch (result.status) {
      case "upgraded":
        return `Cadence ${result.version} is running (upgraded from ${result.from}).\n`;
      case "current":
        return `Cadence ${result.version} is already the latest version.\n`;
      case "deprecated":
        return `Cadence ${result.to} is deprecated on npm; nothing changed.\n`;
      case "rolled-back":
        return `Cadence ${result.to} did not become ready, so ${result.from} was reinstalled and is running; ${managerDetail(s)}.\n`;
      case "unsupported-install":
        return `The installation method for this copy of Cadence (${s.root}) could not be safely identified. ${terminal}\n`;
      case "pinned":
        return `Pi pins this package version; change its package declaration explicitly before upgrading. ${terminal}\n`;
      case "not-writable":
        return `The package manager cannot write ${s.root} as this account. ${terminal}\n`;
      case "unsupported":
        return `Cadence upgrades itself only on Linux. ${terminal}\n`;
      case "failed":
        return `Cadence was not upgraded: ${REASONS[result.reason ?? ""] ?? result.reason}. Installed version: ${result.version ?? "not confirmed"}; ${managerDetail(s)}.\n`;
    }
  }
  if (
    result.workspace === null &&
    ["quarantined", "unconfirmed", "unavailable"].includes(result.status)
  )
    return `Cadence workbench is not ready (${result.status}).\nDetails and repair: ${cli} doctor${s.platform === "linux" ? "" : ""} --fix\n`;
  if (result.workspace === null && result.status === "started")
    return `Cadence unified workbench: ${link ?? result.endpoint ?? result.service ?? "unconfirmed"}\nNo default workspace was created. Projects are opened explicitly.\nManage: ${cli} server status|restart|stop|uninstall\n`;
  const flags = `${s.scope === "system" ? " --system" : s.platform === "linux" ? " --user" : ""}${serviceName(s) ? ` --name ${serviceName(s)}` : ""}`;
  const manage = `Manage: ${cli} server status|restart|stop|uninstall${flags}`;
  const when =
    s.scope === "system"
      ? "at boot, as root (no linger)"
      : s.platform === "linux"
        ? "at boot or login"
        : "at login";
  const config = `Port and token: ${PORT_KEY} and ${TOKEN_KEY} in ${serviceConfigPath(s)} (edit them, then: ${cli} server restart${flags})`;
  switch (result.status) {
    case "started": {
      const linger = lingerGuidance(result.linger);
      if (result.service !== "alive")
        return `Cadence started for ${result.workspace}, but the owner reports ${result.service}.\nInspect: ${cli} diagnose --workspace ${workspace}\n${manage}\n${linger}`;
      if (!link)
        return `Cadence WebUI: ${result.endpoint} (workspace ${result.workspace}; starts ${when})\nEnter with your private link: ${cli} token-link --workspace ${workspace} --reveal\n${config}\n${manage}\n${linger}`;
      return `Cadence WebUI: ${link}\nOpen this private link (workspace ${result.workspace}; starts ${when}); its token admits anyone who has it.\n${config}\n${manage}\n${linger}`;
    }
    case "waiting-for-pi-login":
      return `Cadence is registered for ${result.workspace}; it starts once Pi has ${join(agentDirectory(s), "auth.json")}.\nLog in to Pi, then: ${cli} server restart${flags}\n${config}\n${lingerGuidance(result.linger)}`;
    case "stopped":
      return action === "stop"
        ? `Cadence stopped; it starts again ${when}, or now with: ${cli} server restart${flags}\n`
        : "";
    case "absent":
      return action === "restart" || action === "stop"
        ? `Cadence's background service is not installed: ${cli} server install\n`
        : "";
    case "disabled":
      return `Cadence's service definition was rewritten for ${result.workspace}; left disabled as configured.\n`;
    case "masked":
      return `${s.unit} is masked; Cadence did not enable or start it.\n`;
    case "root-required":
      return `System service management requires root. Run this command explicitly as root (for example sudo -H); Cadence never elevates itself. Root uses its own Pi credentials and private state, not copied user profiles.\n`;
    case "scope-conflict":
      return `The user service ${result.unit} still exists. Stop/uninstall it explicitly with --user before installing --system; no service or state was migrated.\n`;
    case "project-running":
      return `This project already has a running owner. Stop it explicitly before registering a different supervisor: ${cli} stop --workspace ${workspace}\n`;
    case "environment-changed":
      return "HOME or XDG_STATE_HOME differs from the generated unit. Use its original environment for orderly stop/uninstall before explicitly installing with the new state selection; no migration or lock cleanup was attempted.\n";
    case "workspace-changed":
      return "Workspace changed during orderly Stop; nothing was rewritten. Observe and retry explicitly.\n";
    case "missing-pi-sdk":
      return `Cadence did not register its service: the Pi SDK packages pi-coding-agent and pi-ai (scope @earendil-works) do not resolve from ${s.root}, for example after installing without optional dependencies; an owner without them would quarantine.\n`;
    case "foreign":
      return `${result.unit} was not generated by Cadence; left unchanged.\n`;
    case "unavailable":
      return result.workspace
        ? `Cadence changed nothing: its owner could not be observed. Inspect: ${cli} diagnose --workspace ${workspace}\n`
        : `No selected service manager; start Cadence explicitly: ${cli} start --workspace /absolute/project\n`;
    case "unsupported":
      return `Cadence has no background service for ${s.platform}; start it explicitly: ${cli} start --workspace /absolute/project\n`;
    case "unconfirmed":
    case "quarantined":
      return `Cadence owner reports ${result.status}; it did not confirm a successful start or stop.\nDetails and repair: ${cli} doctor --workspace ${workspace} --fix\n`;
    case "failed":
      return `Could not register or start Cadence's service; ${managerDetail(s)}.\n${lingerGuidance(result.linger)}`;
    default:
      return "";
  }
}
/** Missing-only, independent of the service result; a failure is reported, not fatal. */
function researchTemplate(home: string): string {
  try {
    const result = ensureUserConfig(home);
    return result.created
      ? `Cadence created the research configuration template ${result.path}\n`
      : "";
  } catch (error) {
    return `Cadence could not create the research configuration template: ${error instanceof Error ? error.message : String(error)}\n`;
  }
}
const SERVER_ACTIONS: ServerAction[] = [
  "install",
  "status",
  "restart",
  "stop",
  "uninstall",
  "upgrade",
];
async function serverMain(argv: string[], hostUrl: URL): Promise<void> {
  const action = SERVER_ACTIONS.find((a) => a === argv[0]);
  if (!action) throw new ContractError("invalid");
  argv.shift();
  let requested: string | undefined;
  let linger = process.env.CADENCE_LINGER !== "0";
  let scope: "system" | "user" | undefined;
  let name: string | undefined, port: number | undefined;
  let to: string | undefined, job: string | undefined;
  const seen = new Set<string>();
  while (argv.length) {
    const flag = argv.shift();
    if (!flag || seen.has(flag)) throw new ContractError("invalid");
    seen.add(flag);
    if (flag === "--system" || flag === "--user") {
      if (scope) throw new ContractError("invalid");
      scope = flag === "--system" ? "system" : "user";
    } else if (flag === "--no-linger" && action === "install") linger = false;
    else if (flag === "--name" && argv[0]) name = argv.shift();
    else if (flag === "--workspace" && action === "install" && argv[0])
      requested = resolve(argv.shift() as string);
    else if (flag === "--port" && action === "install" && argv[0]) {
      port = portValue(argv.shift() as string);
      if (!port) throw new ContractError("invalid");
    } else if (flag === "--to" && action === "upgrade" && argv[0])
      to = decodeVersion(argv.shift());
    // The WebUI's transient unit names the job whose outcome it records.
    else if (
      flag === "--job" &&
      (action === "restart" || action === "upgrade") &&
      argv[0]
    )
      job = decodeId(argv.shift());
    else throw new ContractError("invalid");
  }
  const s = hostSystem(dirname(dirname(fileURLToPath(hostUrl))), ownerControl, {
    scope,
    name,
  });
  if ((scope || name !== undefined) && s.platform !== "linux")
    throw new ContractError("unsupported-context");
  if (s.scope === "system" && s.uid !== 0) {
    const result = { status: "root-required", scope: "system" as const };
    process.stderr.write(serverGuidance(s, action, result, undefined));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = 1;
    return;
  }
  // Before any change: stopping the unit would end this command with it.
  if (action !== "status" && insideUnit(s)) {
    const result = { status: "inside-service", unit: s.unit };
    process.stderr.write(serverGuidance(s, action, result, undefined));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = 1;
    return;
  }
  if (action === "install") process.stderr.write(researchTemplate(s.home));
  // The definition starts with --server-config on the .env, so install and
  // restart add missing keys and refuse an unusable file before any change.
  if (action === "install" || action === "restart") {
    try {
      const { added, exposed } = ensureServerConfig(s.home, {
        name: serviceName(s),
        port,
      });
      const path = serviceConfigPath(s);
      if (added.length)
        process.stderr.write(
          `Cadence added ${added.map((key) => (key === PORT_KEY ? `${key}=${port ?? DEFAULT_PORT}` : `a random private ${key}`)).join(" and ")} to ${path}\n`,
        );
      // Not a refusal: the user's own mode, like Pi's sources.
      if (exposed)
        process.stderr.write(
          `Note: other users can read ${path}; chmod 600 ${JSON.stringify(path)} keeps ${TOKEN_KEY} private.\n`,
        );
    } catch (error) {
      if (error instanceof ServerConfigRefusal)
        process.stderr.write(serverConfigHint(error));
      throw error;
    }
  }
  let result: UpgradeResult & { service?: string; endpoint?: string };
  try {
    result =
      action === "upgrade"
        ? await upgrade(s, to)
        : await serverAction(s, action, requested, linger);
  } catch (error) {
    if (error instanceof ContractError && error.code === "invalid")
      process.stderr.write(
        "Cadence server install needs an existing absolute --workspace directory.\n",
      );
    throw error;
  }
  // A definition whose project directory was removed: say so, plainly.
  const vanished =
    typeof result.workspace === "string"
      ? missingWorkspace(result.workspace)
      : null;
  let link: string | undefined;
  if (result.status === "started" && result.workspace !== undefined) {
    const workspace = result.workspace;
    const observation = await observeStarted(workspace, serviceConfigPath(s));
    result = {
      ...observedServerResult(result, observation.service),
      ...observation,
    };
    // A job's output goes to the journal; the browser already holds its cookie.
    if (result.service === "alive" && !job)
      link = await privateLink(workspace, undefined, serviceConfigPath(s));
  }
  if (
    action === "status" &&
    result.workspace !== undefined &&
    !vanished &&
    ["active", "activating", "failed"].includes(result.status)
  ) {
    const target =
      result.workspace === null
        ? new GatewayStore(serviceConfigPath(s))
        : new ServiceCoordination(result.workspace);
    const observed = await serviceStatus(target);
    if (observed && typeof observed === "object" && "status" in observed) {
      const service = String(observed.status);
      result = {
        ...result,
        service,
        ...(service === "quarantined"
          ? { managerStatus: result.status, status: service }
          : {}),
      };
    }
  }
  if (vanished) result = { ...result, service: "workspace-missing" };
  if (job && (action === "restart" || action === "upgrade")) {
    const { state, reason } = jobOutcome(action, result);
    try {
      new MaintenanceRecord(new GatewayStore(serviceConfigPath(s))).finish(
        job,
        state,
        reason,
        action === "upgrade"
          ? (result.version ?? null)
          : installedVersion(s.root),
      );
    } catch {
      // Not recorded: the WebUI reads the ended job as interrupted.
    }
  }
  process.stderr.write(vanished ?? serverGuidance(s, action, result, link));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (
    [
      "failed",
      "foreign",
      "unavailable",
      "unsupported",
      "unconfirmed",
      "quarantined",
      "missing-pi-sdk",
      "root-required",
      "scope-conflict",
      "workspace-changed",
      "project-running",
      "environment-changed",
      "inside-service",
      "unsupported-install",
      "pinned",
      "not-writable",
      "deprecated",
      "rolled-back",
    ].includes(result.status) ||
    (result.status === "absent" && (action === "restart" || action === "stop"))
  )
    process.exitCode = 1;
}
/** Explicit local project launch, not browser discovery or task admission.
 * Separate checkouts keep separate owner locks/history/ports; the current
 * project's accepted work is never stopped or moved to the new cwd. */
/** Explicit browser/native project opening shares the same launch policy. No
 * task, global cwd mutation, credential copying or service-manager registration. */
/** A genuine pre-admission refusal, distinct from an uncertain launch. */
export class ProjectOpenRefusal extends ContractError {
  constructor(
    readonly noOwner: boolean,
    code: ErrorCode = "unavailable",
  ) {
    super(code);
  }
}
export async function openProjectDirectory(
  workspace: string,
  stateHome: string,
  agentDir: string,
  hostUrl: URL,
): Promise<{ path: string; link: string }> {
  if (privateWorkspace(workspace, stateHome))
    throw new ContractError("forbidden");
  effectiveWorkspace(workspace, stateHome);
  const c = new ServiceCoordination(workspace, stateHome);
  // A registry lock left by a dead process is released before deciding
  // whether this is a new selection.
  await healAccount(new ServiceCoordination(null, stateHome));
  if (c.registryLockDiagnostic())
    throw new ProjectOpenRefusal(true, "registry-locked");
  const kept = readHostConfig(c);
  const options: StartOptions = {
    workspace,
    stateHome,
    ...(!kept ? { port: 0, agentDir } : {}),
  };
  const result = await startService(options, false, hostUrl);
  if (
    !result ||
    typeof result !== "object" ||
    !("status" in result) ||
    result.status !== "alive"
  )
    throw new ProjectOpenRefusal(
      !!result &&
        typeof result === "object" &&
        "status" in result &&
        result.status === "refused" &&
        (("error" in result && result.error === "registry-locked") ||
          c.inspect().status === "absent"),
      result &&
        typeof result === "object" &&
        "error" in result &&
        result.error === "registry-locked"
        ? "registry-locked"
        : "unavailable",
    );
  const link = await privateLink(c.store.root, stateHome);
  if (!link) throw new ContractError("unavailable");
  return { path: c.store.root, link };
}

async function projectMain(argv: string[], hostUrl: URL): Promise<void> {
  if (argv.shift() !== "open") throw new ContractError("invalid");
  const options: StartOptions = { workspace: process.cwd() };
  let create = false,
    selected = false;
  const seen = new Set<string>();
  while (argv.length) {
    const flag = argv.shift() as string;
    if (!flag.startsWith("--") && !selected) {
      options.workspace = resolve(flag);
      selected = true;
    } else if (!seen.has(flag) && flag === "--create") {
      seen.add(flag);
      create = true;
    } else if (
      !seen.has(flag) &&
      (flag === "--state-home" || flag === "--agent-dir") &&
      argv[0]
    ) {
      seen.add(flag);
      const value = resolve(argv.shift() as string);
      if (flag === "--state-home") options.stateHome = value;
      else options.agentDir = value;
    } else throw new ContractError("invalid");
  }
  if (privateWorkspace(options.workspace, options.stateHome))
    throw new ContractError("forbidden");
  if (create) mkdirSync(options.workspace, { recursive: true });
  const missing = missingWorkspace(options.workspace);
  if (missing) {
    process.stderr.write(missing);
    process.stdout.write(
      `${JSON.stringify({ status: "refused", reason: "workspace-missing" })}\n`,
    );
    process.exitCode = 1;
    return;
  }
  effectiveWorkspace(options.workspace, options.stateHome);
  const c = new ServiceCoordination(options.workspace, options.stateHome);
  await healAccount(new ServiceCoordination(null, options.stateHome));
  const kept = c.registryLockDiagnostic() ? undefined : readHostConfig(c);
  // Port 0 is requested only for a genuinely new selection. An existing owner
  // keeps its exact persisted port/cwd/config; an inconclusive read is not new.
  if (!kept) options.port = 0;
  const result = await startService(options, false, hostUrl);
  const alive =
    result &&
    typeof result === "object" &&
    "status" in result &&
    result.status === "alive";
  const config = alive ? readHostConfig(c) : undefined;
  process.stdout.write(
    `${JSON.stringify({ ...(result as object), workspace: c.store.root, ...(config ? { cwd: config.cwd, endpoint: c.localAccess().endpoint } : {}) })}\n`,
  );
  if (alive) {
    const link = await privateLink(c.store.root, options.stateHome);
    process.stderr.write(
      `Project owner ready: ${c.store.root} (task cwd: ${config?.cwd}). No task was created or started.\n`,
    );
    if (link) process.stderr.write(`Private WebUI link: ${link}\n`);
    process.stderr.write(
      `Native entry: open Pi in this project and use /cadence. Stop only this project: cadence stop --workspace ${JSON.stringify(c.store.root)}${options.stateHome ? ` --state-home ${JSON.stringify(options.stateHome)}` : ""}\n`,
    );
  }
  if (failedStatus(result)) process.exitCode = 1;
}

/** One readable sentence for a refusal code, plus where to look next. */
function refusalHint(code: string): string {
  switch (code) {
    case "invalid":
      return "Cadence did not understand the command or one of its paths (see cadence --help).\n";
    case "registry-locked":
      return "Another Cadence process is updating the shared project registry. Try again in a moment, or run: cadence doctor\n";
    case "quarantine":
    case "conflict":
      return "Cadence could not take over this project right now. See what is holding it: cadence doctor\n";
    case "recording-exhausted":
      return "The disk is too full for Cadence's history. Free some space and try again.\n";
    case "unsupported-context":
      return "Run Cadence's management command with Node.js 22.19 or newer (not Bun), without NODE_OPTIONS.\n";
    default:
      return "Cadence could not complete the command. Details: cadence doctor\n";
  }
}
/** `cadence doctor [--fix] [--yes]`; `recover inspect|resolve` are aliases. */
export async function doctorMain(
  command: string,
  argv: string[],
): Promise<void> {
  let fix = false,
    yes = false;
  if (command === "recover") {
    const mode = argv.shift();
    if (mode !== "inspect" && mode !== "resolve")
      throw new ContractError("invalid");
    fix = mode === "resolve";
  }
  const options: {
    stateHome?: string;
    serverConfig?: string;
    workspace?: string;
  } = {};
  const seen = new Set<string>();
  while (argv.length) {
    const flag = argv.shift() as string;
    if (seen.has(flag)) throw new ContractError("invalid");
    seen.add(flag);
    if (flag === "--fix") fix = true;
    else if (flag === "--yes") yes = true;
    else if (
      ["--workspace", "--state-home", "--server-config"].includes(flag) &&
      argv[0]
    ) {
      const value = resolve(argv.shift() as string);
      if (flag === "--workspace") options.workspace = value;
      else if (flag === "--state-home") options.stateHome = value;
      else options.serverConfig = value;
    } else throw new ContractError("invalid");
  }
  const result = await doctor({
    ...options,
    fix,
    yes,
    probeProject: async (root, stateHome) => {
      try {
        return await ownerResponsive(new ServiceCoordination(root, stateHome));
      } catch {
        return false;
      }
    },
    probeWorkbench: (store) => ownerResponsive(store),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
export async function managementMain(
  argv: string[],
  hostUrl: URL,
): Promise<void> {
  const foregroundStart =
    argv.includes("--foreground") &&
    (argv[0] === "start" || (argv[0] === "workbench" && argv[1] === "start"));
  try {
    if (!process.versions.node || process.versions.bun)
      throw new ContractError("unsupported-context");
    const command = argv.shift();
    if (command === "doctor" || command === "recover") {
      await doctorMain(command, argv);
      return;
    }
    if (command === "workbench") {
      await gatewayMain(argv, hostUrl);
      return;
    }
    if (
      [
        "start",
        "status",
        "diagnose",
        "stop",
        "token-link",
        "token-rotate",
      ].includes(command ?? "") &&
      !argv.includes("--workspace")
    ) {
      await gatewayMain([command as string, ...argv], hostUrl);
      return;
    }
    if (command === "--help" && !argv.length) {
      process.stdout.write(
        "cadence start|status|diagnose|stop|token-link --reveal|token-rotate [--workspace PATH] [--state-home PATH]\nWithout --workspace these commands address the unified workbench, never cwd; no default project directory is created.\ncadence workbench start|status|diagnose|stop|token-link --reveal|token-rotate [--server-config PATH] [--state-home PATH]\ncadence doctor [--fix] [--yes] [--workspace PATH] [--state-home PATH] [--server-config PATH]\nStart recovers automatically from an unclean shutdown or crash. Doctor shows the state readonly; --fix also stops an unresponsive Cadence or takes over state it cannot observe, after one confirmation (--yes skips it). recover inspect|resolve are aliases of doctor and doctor --fix.\ncadence server install [--workspace PATH] [--no-linger]|status|restart|stop|uninstall|upgrade [--to VERSION]\nUpgrade (Linux, identified Pi/npm/Bun installs) fetches the release while the service runs, then stops it, installs the release and restarts; a release that does not become ready is replaced by the previous version. Server commands that change the service refuse to run inside it; use the WebUI or a terminal.\nLinux server options: --system (root, no linger) or --user; --name NAME selects an independent service; install also accepts --port PORT (required for a new named service). Root defaults to --system. No automatic sudo or profile migration.\ncadence project open [PATH] [--create] [--agent-dir PATH] [--state-home PATH]\nProject open explicitly starts/reuses that checkout owner, selecting a private free port for a new project. It never creates or starts a task.\nStart is explicit, or the background service that server install registers: a system/root unit on Linux without linger, or --user with optional linger (--no-linger or CADENCE_LINGER=0 keeps user scope to login), a LaunchAgent on macOS and a Run entry on Windows, both started at login. Server restart, stop and uninstall use the orderly Stop. cadence-service is the same command. Default detached or --foreground. Start accepts --config, --agent-dir, --host, --port, --token-file, --server-config (the .env whose CADENCE_PORT and CADENCE_TOKEN the background service uses).\nReturn/quit detaches clients; only explicit Cancel/Stop requests stop.\n",
      );
      return;
    }
    if (command === "project") {
      await projectMain(argv, hostUrl);
      return;
    }
    if (command === "server") {
      await serverMain(argv, hostUrl);
      return;
    }
    if (
      ![
        "start",
        "status",
        "stop",
        "diagnose",
        "token-link",
        "token-rotate",
      ].includes(command ?? "")
    )
      throw new ContractError("invalid");
    const options: StartOptions = { workspace: process.cwd() };
    let foreground = false,
      reveal = false;
    const seen = new Set<string>();
    while (argv.length) {
      const flag = argv.shift();
      if (!flag) throw new ContractError("invalid");
      if (seen.has(flag)) throw new ContractError("invalid");
      seen.add(flag);
      if (flag === "--foreground" && command === "start") {
        foreground = true;
        continue;
      }
      if (flag === "--reveal" && command === "token-link") {
        reveal = true;
        continue;
      }
      const value = argv.shift();
      if (!value) throw new ContractError("invalid");
      if (flag === "--workspace") options.workspace = value;
      else if (flag === "--state-home") options.stateHome = value;
      else if (command !== "start") throw new ContractError("invalid");
      else if (flag === "--config") options.config = value;
      else if (flag === "--agent-dir") options.agentDir = value;
      else if (flag === "--token-file") options.tokenFile = value;
      else if (flag === "--server-config") options.serverConfig = value;
      else if (flag === "--port") options.port = portValue(value);
      else if (flag === "--host" && (value === "127.0.0.1" || value === "::1"))
        options.host = value;
      else throw new ContractError("invalid");
    }
    const missing = missingWorkspace(resolve(options.workspace));
    if (missing) {
      process.stderr.write(missing);
      // Release whatever the vanished project's owner left behind, so it
      // blocks nothing else (its history stays in Cadence's private state).
      await healAccount(new ServiceCoordination(null, options.stateHome)).catch(
        () => undefined,
      );
      process.stdout.write(
        `${JSON.stringify({ status: command === "start" ? "refused" : "absent", reason: "workspace-missing" })}\n`,
      );
      // A unit pointing at a removed directory must not restart in a loop.
      process.exitCode = foreground ? 78 : 1;
      return;
    }
    effectiveWorkspace(options.workspace, options.stateHome);
    let result: unknown;
    if (command === "start")
      result = await startService(options, foreground, hostUrl);
    else {
      const c = new ServiceCoordination(options.workspace, options.stateHome);
      if (command === "status" || command === "diagnose")
        result = await serviceStatus(c, command === "diagnose");
      else if (command === "stop") result = await stopService(c);
      else if (command === "token-link") {
        if (!reveal) throw new ContractError("forbidden");
        const value = closed(await nativeCall(c, command, true), ["link"]);
        result = { link: text(value.link, 4096, true) };
      } else if (command === "token-rotate")
        result = await nativeCall(c, command);
      else throw new ContractError("invalid");
    }
    if (result !== null) process.stdout.write(`${JSON.stringify(result)}\n`);
    if (failedStatus(result))
      process.exitCode = managementExitCode(result, foreground);
  } catch (error) {
    const code = error instanceof ContractError ? error.code : "unavailable";
    process.stderr.write(
      `${refusalHint(code)}${JSON.stringify({ error: "service-refused", code })}\n`,
    );
    process.exitCode =
      foregroundStart &&
      (error instanceof ContractError || error instanceof ServerConfigRefusal)
        ? 78
        : 1;
  }
}
