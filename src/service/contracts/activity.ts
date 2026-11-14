/** Readonly activity projections, never execution authority or historical outcomes. */
import { decodeServiceBuild, type ServiceBuild } from "./build.ts";
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
import { decodeSessionId, type ExecutionContext } from "./models.ts";

export const ACTIVITY_PHASES = [
  "turn",
  "queued",
  "running",
  "research",
  "implementing",
  "verifying",
  "reviewing",
  "recovering",
  "learning",
  "integrating",
  "stopping",
  "settling",
] as const;
export interface Activity {
  id: string;
  source: "terminal" | "turn" | "workflow";
  sessionId: string | null;
  cwd: string;
  leaf: string | null;
  history: "shared" | "unavailable";
  phase: (typeof ACTIVITY_PHASES)[number];
  freshness: "current" | "stale" | "unknown";
  observedAt: number;
  /** Only owner work carries an epoch. Instance/activity identity is separate from session. */
  epoch: string | null;
  instance: string | null;
  executionCwd: string | null;
}
export function decodeActivity(value: unknown): Activity {
  const o = closed(value, [
    "id",
    "source",
    "sessionId",
    "cwd",
    "leaf",
    "history",
    "phase",
    "freshness",
    "observedAt",
    "epoch",
    "instance",
    "executionCwd",
  ]);
  return {
    id: decodeId(o.id),
    source: oneOf(o.source, ["terminal", "turn", "workflow"]),
    sessionId: o.sessionId === null ? null : decodeSessionId(o.sessionId),
    cwd: text(o.cwd, 4096, true),
    leaf: o.leaf === null ? null : text(o.leaf, 128, true),
    history: oneOf(o.history, ["shared", "unavailable"]),
    phase: oneOf(o.phase, ACTIVITY_PHASES),
    freshness: oneOf(o.freshness, ["current", "stale", "unknown"]),
    observedAt: integer(o.observedAt, 0),
    epoch: o.epoch === null ? null : decodeId(o.epoch),
    instance: o.instance === null ? null : decodeId(o.instance),
    executionCwd:
      o.executionCwd === null ? null : text(o.executionCwd, 4096, true),
  };
}
export interface OwnerActivity {
  kind: "owner-activity";
  readerScope: string;
  complete: boolean;
  epoch: string;
  build: ServiceBuild;
  activities: Activity[];
}
export function decodeOwnerActivity(value: unknown): OwnerActivity {
  const o = closed(value, [
    "kind",
    "epoch",
    "build",
    "activities",
    "readerScope",
    "complete",
  ]);
  return {
    kind: literal(o.kind, "owner-activity"),
    readerScope: decodeHash(o.readerScope),
    complete: bool(o.complete),
    epoch: decodeId(o.epoch),
    build: decodeServiceBuild(o.build),
    activities: list(o.activities, 64, decodeActivity),
  };
}
export interface ActivityProject {
  path: string;
  activities: Activity[];
}
export interface ActivityDiscovery {
  kind: "activity-discovery";
  epoch: string;
  observedAt: number;
  completeness: "complete" | "partial";
  /** Unreadable, stale or capacity-limited observations, not completed work. */
  unavailable: number;
  projects: ActivityProject[];
}
export function decodeActivityDiscovery(value: unknown): ActivityDiscovery {
  const o = closed(value, [
    "kind",
    "epoch",
    "observedAt",
    "completeness",
    "unavailable",
    "projects",
  ]);
  return {
    kind: literal(o.kind, "activity-discovery"),
    epoch: decodeId(o.epoch),
    observedAt: integer(o.observedAt, 0),
    completeness: oneOf(o.completeness, ["complete", "partial"]),
    unavailable: integer(o.unavailable, 0, 10000),
    projects: list(o.projects, 128, (v) => {
      const p = closed(v, ["path", "activities"]);
      return {
        path: text(p.path, 4096, true),
        activities: list(p.activities, 256, decodeActivity),
      };
    }),
  };
}

/** Metadata projection of an original still held by its owner. Final result
 * values remain history; a retained original with a result is still settling. */
export function managedActivity(input: {
  id: string;
  source: "turn" | "workflow";
  execution?: ExecutionContext;
  root: string;
  epoch: string;
  phase: Activity["phase"];
  now: number;
  leaf?: string | null;
  executionCwd?: string | null;
}): Activity {
  const e = input.execution;
  const location = e?.version.conversation;
  const attributed =
    e?.checkoutRoot === input.root &&
    e.version.epoch === input.epoch &&
    location?.cwd === e.cwd;
  return {
    id: input.id,
    source: input.source,
    sessionId: attributed ? location.id : null,
    cwd: attributed ? e.cwd : input.root,
    leaf: input.leaf ?? null,
    history: "shared",
    phase: input.phase,
    freshness: "current",
    observedAt: input.now,
    epoch: input.epoch,
    instance: null,
    executionCwd: input.executionCwd ?? null,
  };
}
