/** Public directory-less workbench DTOs. No tokens, endpoints or native capabilities. */
import {
  decodeServiceBuild,
  type ServiceBuild,
} from "../../service-contract.ts";
import {
  bool,
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
  epoch: string;
}
export function decodeProjectEntry(value: unknown): ProjectEntry {
  const o = closed(value, ["id", "path", "cwd", "epoch"]);
  return {
    id: decodeHash(o.id),
    path: text(o.path, 4096, true),
    cwd: text(o.cwd, 4096, true),
    epoch: decodeId(o.epoch),
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
