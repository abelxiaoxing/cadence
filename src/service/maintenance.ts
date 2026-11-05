/** Restart and upgrade that outlive the service they replace.
 *
 * Stopping a systemd unit ends every process in its cgroup. A management
 * command that the service's own agent started (however detached) therefore
 * dies at the stop and never starts the service again. The CLI refuses to run
 * inside the unit it would stop, and the WebUI hands the whole operation to a
 * separate transient unit that runs the same CLI outside that cgroup.
 * Management-only and SDK-free. */
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AutostartResult,
  type AutostartSystem,
  generatedUnit,
  serviceName,
  unitEnvironment,
  unitWorkspace,
} from "./autostart.ts";
import { ContractError, closed, literal } from "./contracts/core.ts";
import {
  decodeMaintenanceJob,
  decodeVersion,
  type MaintenanceJob,
  type MaintenanceReason,
} from "./contracts/gateway.ts";
import type { GatewayStore } from "./gateway-store.ts";
import {
  fetchVersions,
  type InstallationResult,
  installation,
  installVersion,
  PACKAGE,
  type PackageCommand,
  type PackageCommands,
  registryCommand,
} from "./installation.ts";
import { encoded, json } from "./private-files.ts";

/** systemd stops a job that runs longer; a restart takes seconds, npm minutes. */
const JOB_SECONDS = 1800;
/** A restart waits for its owner to become ready (see observeStarted). */
const RESTART_MS = 5 * 60_000;

/** The systemd hierarchy path in a /proc/<pid>/cgroup text. */
export function cgroupPath(text: string | undefined): string | undefined {
  const lines = text?.split("\n") ?? [];
  const find = (pattern: RegExp) =>
    lines.map((line) => pattern.exec(line)?.[1]).find(Boolean);
  // Hybrid hosts track units in the named systemd hierarchy; v2 has only 0::.
  return find(/^\d+:name=systemd:(\/.*)$/) ?? find(/^0::(\/.*)$/);
}

/** Whether stopping the selected unit would also end this process. */
export function insideUnit(s: AutostartSystem): boolean {
  if (s.platform !== "linux") return false;
  const own = cgroupPath(s.cgroup());
  if (!own) return false;
  const unit = s
    .systemctl(["show", "--property=ControlGroup", "--value", s.unit])
    .stdout.trim();
  return unit !== "" && (own === unit || own.startsWith(`${unit}/`));
}

/** The generated workbench unit this process runs in. systemd's InvocationID
 * proves the exact running instance, not just a unit with the same name. */
export function supervisingUnit(
  env: NodeJS.ProcessEnv,
  system: (selection: {
    scope?: "user" | "system";
    name?: string;
  }) => AutostartSystem,
): AutostartSystem | undefined {
  const path = cgroupPath(system({}).cgroup());
  const match =
    path &&
    /\/cadence(?:-([A-Za-z0-9][A-Za-z0-9_-]{0,47}))?\.service$/.exec(path);
  if (!path || !match || !env.INVOCATION_ID) return undefined;
  const s = system({
    scope: /\/user@[0-9]+\.service\//.test(path) ? "user" : "system",
    name: match[1],
  });
  const invocation = s
    .systemctl(["show", "--property=InvocationID", "--value", s.unit])
    .stdout.trim();
  if (invocation !== env.INVOCATION_ID) return undefined;
  const text = generatedUnit(s);
  return typeof text === "string" && unitWorkspace(text) === null
    ? s
    : undefined;
}

/** Unit names cannot contain dots, so this never names a Cadence service. */
export function maintenanceUnit(s: AutostartSystem): string {
  return s.unit.replace(/\.service$/, ".maintenance.service");
}

export function installedVersion(root: string): string {
  const value: unknown = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  );
  if (!value || typeof value !== "object" || !("name" in value))
    throw new ContractError("invalid");
  literal(value.name, PACKAGE);
  return decodeVersion("version" in value ? value.version : undefined);
}

/** The workbench's latest WebUI job, one private file beside its registration. */
export class MaintenanceRecord {
  constructor(private readonly store: GatewayStore) {}
  private get path(): string {
    return this.store.path("maintenance.json");
  }
  read(): MaintenanceJob | null {
    const file = this.store.files.read(this.path);
    if (!file) return null;
    const o = closed(json(file), ["schema", "job"]);
    literal(o.schema, "cadence-maintenance-job/1");
    return decodeMaintenanceJob(o.job);
  }
  write(job: MaintenanceJob): void {
    const bytes = encoded({ schema: "cadence-maintenance-job/1", job });
    const current = this.store.files.read(this.path);
    if (current) this.store.files.replace(this.path, current, bytes);
    else this.store.files.create(this.path, bytes);
  }
  /** Settles only the job it names; a newer request is never overwritten. */
  finish(
    id: string,
    state: MaintenanceJob["state"],
    reason: MaintenanceReason | null,
    version: string | null,
  ): void {
    const job = this.read();
    if (job?.id !== id || job.state !== "running") return;
    this.write({ ...job, state, reason, version, endedAt: Date.now() });
  }
}

/** Runs `cadence server <action> --job <id>` in its own transient unit, with
 * the environment the service's definition bakes, so it observes the same
 * state home and Pi sources. The fixed name admits one job at a time. */
export function launchJob(s: AutostartSystem, job: MaintenanceJob): boolean {
  const text = generatedUnit(s);
  if (typeof text !== "string") return false;
  const scope = s.scope === "system" ? "--system" : "--user";
  const name = serviceName(s);
  const result = spawnSync(
    "systemd-run",
    [
      scope,
      `--unit=${maintenanceUnit(s)}`,
      `--description=Cadence ${job.action} requested from the WebUI`,
      "--collect",
      "--quiet",
      `--property=RuntimeMaxSec=${JOB_SECONDS}`,
      // The gateway's HOME, which a user unit inherits from its manager.
      ...[...new Map([["HOME", s.home], ...unitEnvironment(text)])].map(
        ([key, value]) => `--setenv=${key}=${value}`,
      ),
      "--",
      s.node,
      join(s.root, "src", "service-cli.mjs"),
      "server",
      job.action,
      scope,
      ...(name ? ["--name", name] : []),
      ...(job.to ? ["--to", job.to] : []),
      "--job",
      job.id,
    ],
    { stdio: "ignore", timeout: 20_000 },
  );
  return !result.error && result.status === 0;
}

export function jobRunning(s: AutostartSystem): boolean {
  return s.systemctl(["is-active", "--quiet", maintenanceUnit(s)]).status === 0;
}

type Run = { status: number | null; stdout: string };
function run(command: string, args: string[], timeout: number): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "ignore"],
      timeout,
      windowsHide: true,
    });
    let stdout = "";
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
      if (stdout.length < 1 << 20) stdout += chunk;
    });
    child.once("error", () => resolve({ status: null, stdout: "" }));
    child.once("close", (status) => resolve({ status, stdout }));
  });
}

export interface Release {
  version: string;
  deprecated: boolean;
}
/** The registry's exact version for a tag or version; undefined when it
 * cannot be resolved to one version. */
export async function release(
  spec: string | undefined,
  command: PackageCommand,
  manager: "npm" | "bun" = "npm",
): Promise<Release | undefined> {
  const name = `${PACKAGE}@${spec ?? "latest"}`;
  // Bun 1.3's info accepts only one property, silently ignoring the second.
  // Read its complete version metadata so a deprecated release stays refused.
  const result = await command(
    manager === "bun"
      ? ["info", name, "--json"]
      : ["view", name, "version", "deprecated", "--json"],
  );
  if (result.status !== 0) return undefined;
  try {
    // One field present prints a string; both print an object. npm 12 keeps
    // a top-level array even for one result; unwrap exactly that one layer.
    let value: unknown = JSON.parse(result.stdout);
    if (manager === "bun") {
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        !("name" in value) ||
        !("version" in value)
      )
        return undefined;
      literal(value.name, PACKAGE);
      return {
        version: decodeVersion(value.version),
        deprecated:
          "deprecated" in value && typeof value.deprecated === "string",
      };
    }
    if (Array.isArray(value)) {
      if (value.length !== 1) return undefined;
      value = value[0];
    }
    if (typeof value === "string")
      return { version: decodeVersion(value), deprecated: false };
    const o = closed(value, ["version", "deprecated"]);
    return {
      version: decodeVersion(o.version),
      deprecated: typeof o.deprecated === "string",
    };
  } catch {
    return undefined;
  }
}

/** Refused/unknown installations do not fall back to a different registry
 * client. Both the WebUI check and the upgrade use this exact selection. */
export function releaseForInstallation(
  selected: InstallationResult,
  commands: PackageCommands,
  spec?: string,
): Promise<Release | undefined> {
  return "manager" in selected
    ? release(spec, registryCommand(selected, commands), selected.manager)
    : Promise.resolve(undefined);
}

/** Starts the installed copy's own `server restart`, which rewrites the
 * definition for that version and waits for its owner. Its stderr (which
 * carries the private link) is not forwarded into a journal. */
export async function restartInstalled(s: AutostartSystem): Promise<boolean> {
  const name = serviceName(s);
  const result = await run(
    s.node,
    [
      join(s.root, "src", "service-cli.mjs"),
      "server",
      "restart",
      s.scope === "system" ? "--system" : "--user",
      ...(name ? ["--name", name] : []),
    ],
    RESTART_MS,
  );
  if (result.status !== 0) return false;
  try {
    const value: unknown = JSON.parse(
      result.stdout.trim().split("\n").at(-1) ?? "",
    );
    return (
      !!value &&
      typeof value === "object" &&
      "status" in value &&
      value.status === "started" &&
      "service" in value &&
      value.service === "alive"
    );
  } catch {
    return false;
  }
}

export interface UpgradeResult extends AutostartResult {
  from?: string;
  to?: string;
  version?: string;
  reason?: MaintenanceReason;
}
export interface UpgradePorts {
  commands: PackageCommands;
  /** The platform's orderly service Stop. */
  stop(): Promise<AutostartResult>;
  /** Whether the installed copy restarted and its owner became ready. */
  restart(): Promise<boolean>;
}
/** Fetch first, while the service still runs; then stop, install and start
 * the new copy. A copy that does not become ready is replaced by the previous
 * version again. Never a range: `to` is one exact version or the latest. */
export async function upgradeService(
  s: AutostartSystem,
  to: string | undefined,
  ports: UpgradePorts,
): Promise<UpgradeResult> {
  const selected = await installation(s, ports.commands);
  if (!("manager" in selected)) return { status: selected.route };
  const currentVersion = () => {
    try {
      return installedVersion(s.root);
    } catch {
      return undefined;
    }
  };
  const from = installedVersion(s.root);
  const target = await releaseForInstallation(selected, ports.commands, to);
  if (!target || (to !== undefined && target.version !== to))
    return { status: "failed", reason: "fetch-failed", from };
  const versions = { from, to: target.version };
  if (target.version === from)
    return { status: "current", version: from, ...versions };
  if (target.deprecated) return { status: "deprecated", ...versions };
  if (!(await fetchVersions(selected, [target.version, from], ports.commands)))
    return { status: "failed", reason: "fetch-failed", ...versions };
  // A long fetch cannot authorize changing a newly pinned/replaced copy.
  if (
    currentVersion() !== from ||
    JSON.stringify(await installation(s, ports.commands)) !==
      JSON.stringify(selected)
  )
    return { status: "failed", reason: "refused", ...versions };
  const stopped = await ports.stop();
  if (stopped.status !== "stopped")
    return { ...stopped, reason: "stop-unconfirmed", ...versions };
  const install = (version: string) =>
    installVersion(selected, version, ports.commands);
  const settled = (status: string, reason?: MaintenanceReason) => ({
    status,
    ...(reason ? { reason } : {}),
    ...versions,
    version: currentVersion(),
  });
  const installed =
    (await install(target.version)).status === 0 &&
    currentVersion() === target.version;
  if (installed) {
    if (await ports.restart()) return settled("upgraded");
    // Failure to observe readiness is not proof that the new owner exited.
    // Its own orderly Stop must join it before any downgrade touches its code.
    const stoppedNew = await ports.stop();
    if (stoppedNew.status !== "stopped")
      return {
        ...stoppedNew,
        ...settled(stoppedNew.status, "stop-unconfirmed"),
      };
  }
  // Never restart a partially installed or wrong copy. Both install failure
  // and an unready new owner restore the prefetched version with its manager.
  const reason = installed ? "not-ready" : "install-failed";
  if (
    (await install(from)).status === 0 &&
    currentVersion() === from &&
    (await ports.restart())
  )
    return settled(installed ? "rolled-back" : "failed", reason);
  return settled("failed", reason);
}

/** The outcome a finished CLI job records for the WebUI. */
export function jobOutcome(
  action: MaintenanceJob["action"],
  result: UpgradeResult & { service?: string },
): { state: MaintenanceJob["state"]; reason: MaintenanceReason | null } {
  if (action === "upgrade") {
    if (result.status === "upgraded" || result.status === "current")
      return { state: "ready", reason: null };
    if (result.status === "rolled-back")
      return { state: "rolled-back", reason: "not-ready" };
    return { state: "failed", reason: result.reason ?? "refused" };
  }
  if (result.status === "started")
    return result.service === "alive"
      ? { state: "ready", reason: null }
      : { state: "failed", reason: "not-ready" };
  if (result.status === "failed")
    return { state: "failed", reason: "not-ready" };
  return {
    state: "failed",
    reason: ["unconfirmed", "quarantined", "unavailable"].includes(
      result.status,
    )
      ? "stop-unconfirmed"
      : "refused",
  };
}
