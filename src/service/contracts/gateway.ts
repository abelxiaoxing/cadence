/** Public directory-less workbench DTOs. No tokens, endpoints or native capabilities. */
import {
  decodeServiceBuild,
  type ServiceBuild,
} from "../../service-contract.ts";
import {
  bool,
  ContractError,
  closed,
  decodeHash,
  decodeId,
  integer,
  list,
  literal,
  oneOf,
  text,
} from "./core.ts";
export interface ProjectEntry {
  id: string;
  path: string;
  cwd: string;
  /** null: directory selection only; no owner has been prepared here. */
  epoch: string | null;
}
export function decodeProjectEntry(value: unknown): ProjectEntry {
  const o = closed(value, ["id", "path", "cwd", "epoch"]);
  return {
    id: decodeHash(o.id),
    path: text(o.path, 4096, true),
    cwd: text(o.cwd, 4096, true),
    epoch: o.epoch === null ? null : decodeId(o.epoch),
  };
}
/** Connection readiness is not conversation identity or permission to act. */
export interface ProjectObservation {
  kind: "project-observation";
  status: "running" | "stopped" | "not-started" | "unavailable";
  epoch: string | null;
  /** Stable existing history identity, also used by browser draft keys. */
  workspaceId: string | null;
}
export function decodeProjectObservation(value: unknown): ProjectObservation {
  const o = closed(value, ["kind", "status", "epoch", "workspaceId"]);
  return {
    kind: literal(o.kind, "project-observation"),
    status: oneOf(o.status, [
      "running",
      "stopped",
      "not-started",
      "unavailable",
    ]),
    epoch: o.epoch === null ? null : decodeId(o.epoch),
    workspaceId: o.workspaceId === null ? null : decodeId(o.workspaceId),
  };
}
export const RECOVERY_SCOPES = ["registry", "workbench", "project"] as const;
export const RECOVERY_CAUSES = [
  /** The machine restarted (or shut down) while Cadence was running. */
  "reboot",
  /** The Cadence process ended without its orderly Stop on this boot. */
  "crash",
  /** Cadence restarted itself after a runtime fault. */
  "restart",
  /** Damaged or incomplete private files were found. */
  "storage",
] as const;
export const RECOVERY_ACTIONS = [
  "released-locks",
  "stopped-workers",
  "stopped-owner",
  "continued-history",
  "archived-history",
  "archived-state",
  "rebuilt-registry",
  "removed-temporaries",
] as const;
/** What startup self-healing did; no private paths beyond the project root. */
export interface RecoveryNotice {
  id: string;
  at: number;
  scope: (typeof RECOVERY_SCOPES)[number];
  path: string | null;
  cause: (typeof RECOVERY_CAUSES)[number];
  actions: (typeof RECOVERY_ACTIONS)[number][];
  workers: number;
  /** Damaged bytes were kept in Cadence's recovery archive. */
  archived: boolean;
}
export function decodeRecoveryNotice(value: unknown): RecoveryNotice {
  const o = closed(value, [
    "id",
    "at",
    "scope",
    "path",
    "cause",
    "actions",
    "workers",
    "archived",
  ]);
  return {
    id: decodeId(o.id),
    at: integer(o.at, 0),
    scope: oneOf(o.scope, RECOVERY_SCOPES),
    path: o.path === null ? null : text(o.path, 4096, true),
    cause: oneOf(o.cause, RECOVERY_CAUSES),
    actions: list(o.actions, RECOVERY_ACTIONS.length, (a) =>
      oneOf(a, RECOVERY_ACTIONS),
    ),
    workers: integer(o.workers, 0, 1_000_000),
    archived: bool(o.archived),
  };
}
export interface WorkbenchEntry {
  kind: "workbench";
  epoch: string;
  csrf: string;
  home: string;
  projects: ProjectEntry[];
  /** Recent automatic recoveries, newest first. */
  recoveries: RecoveryNotice[];
  build: ServiceBuild;
}
export function decodeWorkbenchEntry(value: unknown): WorkbenchEntry {
  const o = closed(value, [
    "kind",
    "epoch",
    "csrf",
    "home",
    "projects",
    "recoveries",
    "build",
  ]);
  return {
    kind: literal(o.kind, "workbench"),
    epoch: decodeId(o.epoch),
    csrf: decodeId(o.csrf),
    home: text(o.home, 4096, true),
    projects: list(o.projects, 128, decodeProjectEntry),
    recoveries: list(o.recoveries, 20, decodeRecoveryNotice),
    build: decodeServiceBuild(o.build),
  };
}

export const MAINTENANCE_ACTIONS = ["restart", "upgrade"] as const;
export const MAINTENANCE_STATES = [
  "running",
  "ready",
  "failed",
  "rolled-back",
] as const;
/** Why a restart or upgrade did not end as requested. */
export const MAINTENANCE_REASONS = [
  /** The release could not be fetched; the service was not stopped. */
  "fetch-failed",
  /** The running service did not confirm its orderly Stop. */
  "stop-unconfirmed",
  /** npm could not install the release. */
  "install-failed",
  /** The started service did not become ready. */
  "not-ready",
  /** The service manager or its definition refused the operation. */
  "refused",
  /** The job ended without reporting, for example when it was killed. */
  "interrupted",
] as const;
export type MaintenanceReason = (typeof MAINTENANCE_REASONS)[number];
/** One restart or upgrade requested from the WebUI. */
export interface MaintenanceJob {
  id: string;
  action: (typeof MAINTENANCE_ACTIONS)[number];
  /** The version that ran when the job was requested. */
  from: string;
  /** The upgrade's exact target. */
  to: string | null;
  state: (typeof MAINTENANCE_STATES)[number];
  reason: MaintenanceReason | null;
  /** The installed version when the job ended. */
  version: string | null;
  at: number;
  endedAt: number | null;
}
const VERSION =
  /^(?:0|[1-9][0-9]{0,8})\.(?:0|[1-9][0-9]{0,8})\.(?:0|[1-9][0-9]{0,8})(?:-[0-9A-Za-z.-]{1,64})?$/;
/** An exact npm version, never a range or tag. */
export function decodeVersion(value: unknown): string {
  const version = text(value, 96, true);
  if (!VERSION.test(version)) throw new ContractError("invalid");
  return version;
}
export function decodeMaintenanceJob(value: unknown): MaintenanceJob {
  const o = closed(value, [
    "id",
    "action",
    "from",
    "to",
    "state",
    "reason",
    "version",
    "at",
    "endedAt",
  ]);
  return {
    id: decodeId(o.id),
    action: oneOf(o.action, MAINTENANCE_ACTIONS),
    from: decodeVersion(o.from),
    to: o.to === null ? null : decodeVersion(o.to),
    state: oneOf(o.state, MAINTENANCE_STATES),
    reason: o.reason === null ? null : oneOf(o.reason, MAINTENANCE_REASONS),
    version: o.version === null ? null : decodeVersion(o.version),
    at: integer(o.at, 0),
    endedAt: o.endedAt === null ? null : integer(o.endedAt, 0),
  };
}
/** The manager and scope of this exact installation, or why it refuses. */
export const UPGRADE_ROUTES = [
  "npm",
  "bun",
  "pi-npm",
  "pi-bun",
  "npm-local",
  "bun-local",
  "unsupported-install",
  "pinned",
  "not-writable",
] as const;
export function canUpgrade(route: (typeof UPGRADE_ROUTES)[number]): boolean {
  return (
    route === "npm" ||
    route === "bun" ||
    route === "pi-npm" ||
    route === "pi-bun" ||
    route === "npm-local" ||
    route === "bun-local"
  );
}
export interface ServiceEntry {
  kind: "service";
  /** The running package version. */
  version: string;
  /** The generated systemd unit this workbench runs in; without one the
   * WebUI cannot restart or upgrade it. */
  unit: { name: string; scope: "user" | "system" } | null;
  upgrade: (typeof UPGRADE_ROUTES)[number];
  /** Accepted work in the associated running projects; a restart stops it. */
  work: number;
  /** The latest restart or upgrade requested from the WebUI. */
  job: MaintenanceJob | null;
}
export function decodeServiceEntry(value: unknown): ServiceEntry {
  const o = closed(value, [
    "kind",
    "version",
    "unit",
    "upgrade",
    "work",
    "job",
  ]);
  let unit: ServiceEntry["unit"] = null;
  if (o.unit !== null) {
    const u = closed(o.unit, ["name", "scope"]);
    unit = {
      name: text(u.name, 96, true),
      scope: oneOf(u.scope, ["user", "system"] as const),
    };
  }
  return {
    kind: literal(o.kind, "service"),
    version: decodeVersion(o.version),
    unit,
    upgrade: oneOf(o.upgrade, UPGRADE_ROUTES),
    work: integer(o.work, 0, 1_000_000),
    job: o.job === null ? null : decodeMaintenanceJob(o.job),
  };
}
export interface ReleaseEntry {
  kind: "release";
  /** The registry's latest version. */
  version: string;
  deprecated: boolean;
}
export function decodeReleaseEntry(value: unknown): ReleaseEntry {
  const o = closed(value, ["kind", "version", "deprecated"]);
  return {
    kind: literal(o.kind, "release"),
    version: decodeVersion(o.version),
    deprecated: bool(o.deprecated),
  };
}
/** Semantic version order for x.y.z[-pre]; a prerelease sorts first. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.split(/-(.*)/s);
    return { core: core.split(".").map(Number), pre };
  };
  const x = parse(a),
    y = parse(b);
  for (let i = 0; i < 3; i++)
    if (x.core[i] !== y.core[i]) return x.core[i] < y.core[i] ? -1 : 1;
  if (x.pre === y.pre) return 0;
  if (x.pre === undefined) return 1;
  if (y.pre === undefined) return -1;
  return x.pre < y.pre ? -1 : 1;
}
