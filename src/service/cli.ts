/** SDK-free native management client. No task-action or provider API imports. */
import { spawn } from "node:child_process";
import { request } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { networkSnapshot, sameNetwork } from "../sdk-network.ts";
import {
  ContractError,
  decodeId,
  LIMITS,
  parseWireJson,
} from "../service-contract.ts";
import {
  type AutostartResult,
  type AutostartSystem,
  agentDirectory,
  autostartStatus,
  configureAutostart,
  hostSystem,
  removeAutostart,
} from "./autostart.ts";
import { closed, text } from "./contracts/core.ts";
import { ServiceCoordination } from "./coordination.ts";
import { localRecovery } from "./recovery-cli.ts";
import {
  decodeHostInput,
  hostEnvironment,
  portValue,
  STARTUP_INPUT_BYTES,
  type StartOptions,
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
    ["unconfirmed", "unavailable", "quarantined"].includes(
      String(result.status),
    )
  );
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
        const ready = closed(parseWireJson(bytes, 4096), ["status", "epoch"]);
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
function autostartGuidance(
  s: AutostartSystem,
  result: AutostartResult & { service?: string; endpoint?: string },
): string {
  const name = s.unit.replace(/\.service$/, "");
  const cli = JSON.stringify(join(s.root, "src", "service-cli.mjs"));
  const workspace = JSON.stringify(result.workspace ?? "");
  const manage = `Manage: systemctl --user status|restart|stop ${name}; logs: journalctl --user -u ${name}; opt out: systemctl --user disable --now ${name}`;
  switch (result.status) {
    case "started": {
      if (result.service !== "alive")
        return `${s.unit} started for ${result.workspace}, but the owner reports ${result.service}.\nInspect: node ${cli} diagnose --workspace ${workspace}\n${manage}\n`;
      const linger =
        s.linger() === false
          ? "Linger is off: Cadence starts at login and stops at logout. `loginctl enable-linger` keeps it running and starts it at boot.\n"
          : "";
      return `Cadence WebUI: ${result.endpoint} (${s.unit}, workspace ${result.workspace})\nEnter with your private link: node ${cli} token-link --workspace ${workspace} --reveal\n${manage}\n${linger}`;
    }
    case "waiting-for-pi-login":
      return `${s.unit} is enabled for ${result.workspace}; it starts once Pi has ${join(agentDirectory(s), "auth.json")}.\nLog in to Pi, then: systemctl --user start ${name}\n`;
    case "disabled":
      return `${s.unit} refreshed for ${result.workspace}; left disabled as configured.\n`;
    case "masked":
      return `${s.unit} is masked; Cadence did not enable or start it.\n`;
    case "missing-pi-sdk":
      return `Cadence did not register ${s.unit}: the Pi SDK peers pi-coding-agent and pi-ai (scope @earendil-works) do not resolve from ${s.root} (Pi's package install omits peers), and an owner without them would quarantine.\n`;
    case "foreign":
      return `${result.unit} was not generated by Cadence; left unchanged.\n`;
    case "unavailable":
      return `No systemd user manager; start Cadence explicitly: node ${cli} start --workspace /absolute/project\n`;
    case "failed":
      return `Could not enable or start ${s.unit}; see systemctl --user status ${name} and journalctl --user -u ${name}.\n`;
    default:
      return "";
  }
}
async function autostartMain(argv: string[], hostUrl: URL): Promise<void> {
  const action = argv.shift();
  let requested: string | undefined;
  if (action === "install" && argv[0] === "--workspace" && argv[1])
    requested = resolve(argv.splice(0, 2)[1]);
  if (
    argv.length ||
    !["install", "refresh", "remove", "status"].includes(action ?? "")
  )
    throw new ContractError("invalid");
  const s = hostSystem(dirname(dirname(fileURLToPath(hostUrl))));
  let result: AutostartResult & { service?: string; endpoint?: string };
  if (action === "remove") result = removeAutostart(s);
  else if (action === "status") result = autostartStatus(s);
  else {
    try {
      result = configureAutostart(
        s,
        action === "install" ? "install" : "refresh",
        requested,
      );
    } catch (error) {
      if (error instanceof ContractError && error.code === "invalid")
        process.stderr.write(
          "Cadence autostart needs an existing absolute workspace directory (--workspace or CADENCE_WORKSPACE).\n",
        );
      throw error;
    }
    if (result.status === "started" && result.workspace)
      Object.assign(result, await observeStarted(result.workspace));
    process.stderr.write(autostartGuidance(s, result));
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (["failed", "foreign", "unavailable"].includes(result.status))
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
        "cadence-service start|status|diagnose|stop|token-link --reveal|token-rotate|recover inspect|recover resolve [--workspace PATH] [--state-home PATH]\ncadence-service autostart install [--workspace PATH]|refresh|remove|status\nStart is explicit, or the Linux systemd user unit that Pi's user-scope install registers (CADENCE_AUTOSTART=0, disable or mask opts out). Default detached or --foreground. Start accepts --config, --agent-dir, --host, --port, --token-file.\nReturn/quit detaches clients; only explicit Cancel/Stop requests stop. Unconfirmed/quarantined is not stopped.\nRecovery resolve requires this local native terminal, exact unchanged dead-owner resources and separate process/credential/storage acknowledgments. No --yes, network recovery, killing, repair or cleanup.\n",
      );
      return;
    }
    if (command === "autostart") {
      await autostartMain(argv, hostUrl);
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
    let result: unknown;
    if (command === "start")
      result = await startService(options, foreground, hostUrl);
    else {
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
    if (result !== null) process.stdout.write(`${JSON.stringify(result)}\n`);
    if (failedStatus(result)) process.exitCode = 1;
  } catch {
    process.stderr.write('{"error":"service-refused"}\n');
    process.exitCode = 1;
  }
}
