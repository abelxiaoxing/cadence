/** SDK-free native management client. No task-action or provider API imports. */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { request } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureUserConfig } from "../install-config.mjs";
import { networkSnapshot, sameNetwork } from "../sdk-network.ts";
import {
  ContractError,
  decodeId,
  LIMITS,
  parseWireJson,
} from "../service-contract.ts";
import { effectiveWorkspace } from "../task-store.ts";
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
  stopAutostart,
} from "./autostart.ts";
import { closed, text } from "./contracts/core.ts";
import { ServiceCoordination } from "./coordination.ts";
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
import { localRecovery } from "./recovery-cli.ts";
import {
  decodeHostInput,
  decodeStartupReport,
  type HostInput,
  hostEnvironment,
  portValue,
  STARTUP_INPUT_BYTES,
  type StartOptions,
  type StartupReport,
  selectStart,
} from "./runtime.ts";

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
export function nativeCall(
  c: ServiceCoordination,
  operation: string,
  reveal = false,
): Promise<unknown> {
  const access = c.localAccess();
  const url = new URL(`${access.endpoint}/local/v1/admin/${operation}`);
  const write = !["status", "diagnose"].includes(operation);
  const body = write
    ? JSON.stringify(reveal ? { reveal: true } : {})
    : undefined;
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fail = () => {
      clearTimeout(timer);
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
          if (bytes > 16384) {
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
                16384,
              ),
              ["kind", "value"],
            );
            if (reply.kind !== "ok") throw new ContractError("unavailable");
            if (["status", "diagnose", "stop"].includes(operation)) {
              if (
                !reply.value ||
                typeof reply.value !== "object" ||
                !("epoch" in reply.value) ||
                reply.value.epoch !== access.epoch
              )
                throw new ContractError("stale");
            }
            clearTimeout(timer);
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
    req.on("error", fail);
    req.on("close", fail);
    req.end(body);
  });
}
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
export async function serviceStatus(
  c: ServiceCoordination,
  diagnose = false,
): Promise<unknown> {
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
export async function stopService(
  c: ServiceCoordination,
): Promise<ManagementReply> {
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
    const observed = c.inspect();
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
/** One fixed hint per refused startup stage, naming only the selected sources. */
function startupGuidance(result: unknown, input: HostInput): string {
  let report: StartupReport;
  try {
    report = decodeStartupReport(result);
  } catch {
    return "";
  }
  const agent = input.config.agentDir;
  const inspect = `Inspect: cadence-service diagnose|recover inspect --workspace ${JSON.stringify(input.workspace)}\n`;
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
      return `Loading Pi's SDK model runtime failed after the owner registered (optional SDK packages missing, or sources the SDK refuses); it stays quarantined.\n${inspect}`;
    default:
      return report.status === "quarantined"
        ? `The owner registered, then refused; it stays quarantined.\n${inspect}`
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
  const input = decodeHostInput(selectStart(options, process.env));
  const serialized = `${JSON.stringify(input)}\n`;
  if (Buffer.byteLength(serialized) > STARTUP_INPUT_BYTES)
    throw new ContractError("oversize");
  const c = new ServiceCoordination(input.workspace, input.stateHome);
  const existing = await serviceStatus(c);
  if (
    existing &&
    typeof existing === "object" &&
    "status" in existing &&
    existing.status === "alive"
  )
    return existing;
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
      cwd: input.config.cwd,
      env,
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
  const guidance = startupGuidance(result, input);
  if (guidance) process.stderr.write(guidance);
  // A reporting bound/client departure never sends a signal or restarts a child.
  child.stdout.destroy();
  child.stdin.destroy();
  if (!foreground) child.unref();
  else if (!completed) {
    if (failedStatus(result)) process.exitCode = 1;
    process.stdout.write(`${JSON.stringify(result)}\n`);
    await closure;
    return null;
  }
  return result;
}
/** Observe the unit's owner through the same authenticated status route; a
 * reporting bound is not a stop or restart reason. */
async function observeStarted(
  workspace: string,
): Promise<{ service: string; endpoint?: string }> {
  const deadline = performance.now() + LIMITS.startWaitMs + 2000;
  let service = "unconfirmed";
  while (performance.now() < deadline) {
    try {
      const c = new ServiceCoordination(workspace);
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
/** Orderly owner control for service managers that only signal (macOS, Windows). */
const ownerControl: OwnerControl = {
  async ownerStatus(workspace) {
    try {
      const observed = await serviceStatus(new ServiceCoordination(workspace));
      return observed && typeof observed === "object" && "status" in observed
        ? String(observed.status)
        : "unavailable";
    } catch {
      return "unavailable";
    }
  },
  async stopOwner(workspace) {
    try {
      const c = new ServiceCoordination(workspace);
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
type ServerAction = "install" | "status" | "restart" | "stop" | "uninstall";
async function serverAction(
  s: AutostartSystem,
  action: ServerAction,
  requested: string | undefined,
  linger: boolean,
): Promise<AutostartResult> {
  const install = action === "install" || action === "restart";
  const mode = action === "install" ? "install" : "restart";
  switch (s.platform) {
    case "linux":
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
function serverGuidance(
  s: AutostartSystem,
  action: ServerAction,
  result: AutostartResult & { service?: string; endpoint?: string },
): string {
  // Pi's managed copy puts no `cadence` bin on PATH.
  const cli = piUserInstall(s)
    ? `node ${JSON.stringify(join(s.root, "src", "service-cli.mjs"))}`
    : "cadence";
  const note = result.redirectedFrom
    ? `Cadence workspace: ${result.workspace} (${result.redirectedFrom} contains Cadence's private state)\n`
    : "";
  return note + serverStatusGuidance(s, action, result, cli);
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
      return "see systemctl --user status cadence and journalctl --user -u cadence";
    case "darwin":
      return `see launchctl print gui/${s.uid}/${LABEL} and ~/Library/Logs/cadence.log`;
    default:
      return `run its launcher to see why: wscript ${JSON.stringify(launcherPath(s))}`;
  }
}
function serverStatusGuidance(
  s: AutostartSystem,
  action: ServerAction,
  result: AutostartResult & { service?: string; endpoint?: string },
  cli: string,
): string {
  const workspace = JSON.stringify(result.workspace ?? "");
  const manage = `Manage: ${cli} server status|restart|stop|uninstall`;
  const when = s.platform === "linux" ? "at boot or login" : "at login";
  switch (result.status) {
    case "started": {
      const linger = lingerGuidance(result.linger);
      if (result.service !== "alive")
        return `Cadence started for ${result.workspace}, but the owner reports ${result.service}.\nInspect: ${cli} diagnose --workspace ${workspace}\n${manage}\n${linger}`;
      return `Cadence WebUI: ${result.endpoint} (workspace ${result.workspace}; starts ${when})\nEnter with your private link: ${cli} token-link --workspace ${workspace} --reveal\n${manage}\n${linger}`;
    }
    case "waiting-for-pi-login":
      return `Cadence is registered for ${result.workspace}; it starts once Pi has ${join(agentDirectory(s), "auth.json")}.\nLog in to Pi, then: ${cli} server restart\n${lingerGuidance(result.linger)}`;
    case "stopped":
      return action === "stop"
        ? `Cadence stopped; it starts again ${when}, or now with: ${cli} server restart\n`
        : "";
    case "absent":
      return action === "restart" || action === "stop"
        ? `Cadence's background service is not installed: ${cli} server install\n`
        : "";
    case "disabled":
      return `Cadence's service definition was rewritten for ${result.workspace}; left disabled as configured.\n`;
    case "masked":
      return "cadence.service is masked; Cadence did not enable or start it.\n";
    case "missing-pi-sdk":
      return `Cadence did not register its service: the Pi SDK packages pi-coding-agent and pi-ai (scope @earendil-works) do not resolve from ${s.root}, for example after installing without optional dependencies; an owner without them would quarantine.\n`;
    case "foreign":
      return `${result.unit} was not generated by Cadence; left unchanged.\n`;
    case "unavailable":
      return result.workspace
        ? `Cadence changed nothing: its owner could not be observed. Inspect: ${cli} diagnose --workspace ${workspace}\n`
        : `No user service manager; start Cadence explicitly: ${cli} start --workspace /absolute/project\n`;
    case "unsupported":
      return `Cadence has no background service for ${s.platform}; start it explicitly: ${cli} start --workspace /absolute/project\n`;
    case "unconfirmed":
    case "quarantined":
      return `Cadence changed nothing: its owner's orderly Stop was not confirmed (${result.status}). Inspect: ${cli} diagnose --workspace ${workspace}\n`;
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
];
async function serverMain(argv: string[], hostUrl: URL): Promise<void> {
  const action = SERVER_ACTIONS.find((a) => a === argv[0]);
  if (!action) throw new ContractError("invalid");
  argv.shift();
  let requested: string | undefined;
  let linger = process.env.CADENCE_LINGER !== "0";
  let noLinger = false;
  while (action === "install" && argv.length) {
    if (argv[0] === "--workspace" && argv[1] && requested === undefined)
      requested = resolve(argv.splice(0, 2)[1]);
    else if (argv[0] === "--no-linger" && !noLinger) {
      argv.shift();
      noLinger = true;
      linger = false;
    } else break;
  }
  if (argv.length) throw new ContractError("invalid");
  const s = hostSystem(dirname(dirname(fileURLToPath(hostUrl))), ownerControl);
  if (action === "install") process.stderr.write(researchTemplate(s.home));
  let result: AutostartResult & { service?: string; endpoint?: string };
  try {
    result = await serverAction(s, action, requested, linger);
  } catch (error) {
    if (error instanceof ContractError && error.code === "invalid")
      process.stderr.write(
        "Cadence server install needs an existing absolute --workspace directory.\n",
      );
    throw error;
  }
  if (result.status === "started" && result.workspace)
    Object.assign(result, await observeStarted(result.workspace));
  process.stderr.write(serverGuidance(s, action, result));
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
    ].includes(result.status) ||
    (result.status === "absent" && (action === "restart" || action === "stop"))
  )
    process.exitCode = 1;
}
export async function managementMain(
  argv: string[],
  hostUrl: URL,
): Promise<void> {
  try {
    if (!process.versions.node || process.versions.bun)
      throw new ContractError("unsupported-context");
    const command = argv.shift();
    if (command === "--help" && !argv.length) {
      process.stdout.write(
        "cadence start|status|diagnose|stop|token-link --reveal|token-rotate|recover inspect|recover resolve [--workspace PATH] [--state-home PATH]\ncadence server install [--workspace PATH] [--no-linger]|status|restart|stop|uninstall\nStart is explicit, or the background service that server install registers: a systemd user unit on Linux, started at boot through linger (--no-linger or CADENCE_LINGER=0 keeps it to login), a LaunchAgent on macOS and a Run entry on Windows, both started at login. Server restart, stop and uninstall use the orderly Stop. cadence-service is the same command. Default detached or --foreground. Start accepts --config, --agent-dir, --host, --port, --token-file.\nReturn/quit detaches clients; only explicit Cancel/Stop requests stop. Unconfirmed/quarantined is not stopped.\nRecovery resolve requires this local native terminal, exact unchanged dead-owner resources and separate process/credential/storage acknowledgments. No --yes, network recovery, killing, repair or cleanup.\n",
      );
      return;
    }
    if (command === "server") {
      await serverMain(argv, hostUrl);
      return;
    }
    let recovery: "inspect" | "resolve" | undefined;
    if (
      ![
        "start",
        "status",
        "stop",
        "diagnose",
        "token-link",
        "token-rotate",
        "recover",
      ].includes(command ?? "")
    )
      throw new ContractError("invalid");
    if (command === "recover") {
      const selected = argv.shift();
      if (selected !== "inspect" && selected !== "resolve")
        throw new ContractError("invalid");
      recovery = selected;
    }
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
      else if (flag === "--port") options.port = portValue(value);
      else if (flag === "--host" && (value === "127.0.0.1" || value === "::1"))
        options.host = value;
      else throw new ContractError("invalid");
    }
    // A directory containing the private state home (the home directory and
    // its ancestors) can never be a workspace; land on ~/cadence instead of
    // refusing. Only start creates it; observation creates nothing.
    const landing = effectiveWorkspace(options.workspace, options.stateHome);
    if (landing.redirected) {
      if (seen.has("--workspace"))
        process.stderr.write(
          `Cadence workspace: ${landing.workspace} (${options.workspace} contains Cadence's private state)\n`,
        );
      options.workspace = landing.workspace;
      if (command === "start")
        mkdirSync(landing.workspace, { recursive: true });
    }
    let result: unknown;
    if (command === "start")
      result = await startService(options, foreground, hostUrl);
    else if (landing.redirected && !existsSync(landing.workspace)) {
      if (command !== "status" && command !== "diagnose")
        throw new ContractError("unavailable");
      result = { status: "absent" };
    } else {
      const c = new ServiceCoordination(options.workspace, options.stateHome);
      if (command === "recover" && recovery)
        result = await localRecovery(c, recovery);
      else if (command === "status" || command === "diagnose")
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
    // Name the effective workspace only when it differs from the request, so
    // every existing output stays byte-identical.
    if (landing.redirected && result && typeof result === "object")
      result = { ...result, workspace: landing.workspace };
    if (result !== null) process.stdout.write(`${JSON.stringify(result)}\n`);
    if (failedStatus(result)) process.exitCode = 1;
  } catch {
    process.stderr.write('{"error":"service-refused"}\n');
    process.exitCode = 1;
  }
}
