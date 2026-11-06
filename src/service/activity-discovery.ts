/** Two fact sources, one readonly aggregation. No history scan, owner startup,
 * attachment, model runtime, checkout gate or execution authority. */
import { hostname } from "node:os";
import { join } from "node:path";
import { sanitizeText } from "../worker-redaction.mjs";
import {
  canonicalAmbientRoot,
  contains,
  privateWorkspace,
  resolveWorkspaceAsync,
  stateHomeInside,
} from "../workspace.ts";
import {
  ACTIVITY_FRESH_MS,
  ACTIVITY_RETAIN_MS,
  ActivityFiles,
  activityReaderScope,
} from "./activity-files.ts";
import { CheckoutStore } from "./checkout-lock.ts";
import {
  type Activity,
  type ActivityDiscovery,
  decodeOwnerActivity,
} from "./contracts/activity.ts";
import { compatibleBuild, type ServiceBuild } from "./contracts/build.ts";
import { ServiceCoordination } from "./coordination.ts";
import { holderState } from "./liveness.ts";
import { sessionDirectory } from "./pi-sessions.ts";
import { hash } from "./private-files.ts";

/** One shared sweep per gateway, reused by every tab. At most four transports,
 * 16 owners per sweep (round-robin), each transport has an absolute 2s deadline. */
export const DISCOVERY_REFRESH_MS = 3000;
export const DISCOVERY_OWNERS = 16;
export const DISCOVERY_CONCURRENCY = 4;
export const DISCOVERY_NATIVE = 16;
const DISCOVERY_BYTES = 256 * 1024;
export class ActivityDiscoveryReader {
  private pending?: Promise<ActivityDiscovery>;
  private cached?: ActivityDiscovery;
  private offset = 0;
  private nativeOffset = 0;
  private closed = false;
  private generation = 0;
  private observation = new AbortController();
  private readonly kept = new Map<
    string,
    { path: string; activity: Activity }
  >();
  constructor(
    private readonly o: {
      stateHome: string;
      agentDir: string;
      epoch: string;
      build: ServiceBuild;
      readOwner(c: ServiceCoordination, signal: AbortSignal): Promise<unknown>;
      secrets(): readonly string[];
      now?: () => number;
      native?: () => ReturnType<ActivityFiles["scan"]>;
      candidates?: () => { root: string; epoch: string; host: string }[];
      resolve?: (
        cwd: string,
      ) =>
        | { root: string; cwd: string }
        | Promise<{ root: string; cwd: string }>;
      probe?: typeof holderState;
    },
  ) {}
  invalidate(): void {
    this.generation++;
    this.observation.abort();
    this.observation = new AbortController();
    this.kept.clear();
    this.cached = undefined;
  }
  close(): void {
    this.closed = true;
    this.invalidate();
  }
  read(): Promise<ActivityDiscovery> {
    if (this.closed) return Promise.reject(new Error("unavailable"));
    if (this.pending) return this.pending;
    const now = (this.o.now ?? Date.now)();
    if (this.cached && now - this.cached.observedAt < DISCOVERY_REFRESH_MS)
      return Promise.resolve(this.cached);
    const generation = this.generation;
    this.pending = this.collect(now)
      .then((value) => {
        if (this.closed || generation !== this.generation)
          throw new Error("unavailable");
        this.cached = value;
        return value;
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }
  private async collect(now: number): Promise<ActivityDiscovery> {
    const o = this.o;
    const generation = this.generation;
    const signal = this.observation.signal;
    let unavailable = 0,
      bytes = 0;
    const found = new Map<string, { path: string; activity: Activity }>();
    const knownOwners = new Set<string>();
    const ownerReaders = new Map<string, string | null>();
    let registryKnown = false;
    const nativeIds = new Set<string>();
    let nativeIncomplete = true;
    const projectPaths = new Set<string>();
    const safe = (value: string) =>
      sanitizeText(value, o.secrets()) === value &&
      [...value].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127);
    const add = (path: string, activity: Activity) => {
      const size = Buffer.byteLength(JSON.stringify([path, activity]));
      if (
        (!projectPaths.has(path) && projectPaths.size >= 128) ||
        found.size >= 256 ||
        bytes + size > DISCOVERY_BYTES ||
        ![
          path,
          activity.cwd,
          activity.executionCwd ?? "",
          activity.sessionId ?? "",
          activity.leaf ?? "",
        ].every(safe)
      ) {
        unavailable++;
        return;
      }
      projectPaths.add(path);
      bytes += size;
      found.set(
        `${path}:${activity.epoch ?? activity.instance}:${activity.source}:${activity.id}`,
        { path, activity },
      );
    };
    try {
      const native =
        o.native?.() ?? new ActivityFiles(o.agentDir, o.stateHome).scan();
      unavailable += native.unavailable;
      nativeIncomplete = native.unavailable > 0;
      for (const record of native.records)
        nativeIds.add(`${record.instance}:${record.activity}`);
      const selected = Array.from(
        { length: Math.min(native.records.length, DISCOVERY_NATIVE) },
        (_, i) =>
          native.records[(this.nativeOffset + i) % native.records.length],
      );
      this.nativeOffset = native.records.length
        ? (this.nativeOffset + selected.length) % native.records.length
        : 0;
      if (selected.length < native.records.length) unavailable++;
      let nextNative = 0;
      await Promise.all(
        Array.from(
          { length: Math.min(DISCOVERY_CONCURRENCY, selected.length) },
          async () => {
            for (;;) {
              const record = selected[nextNative++];
              if (!record || signal.aborted) return;
              try {
                const age = now - record.renewedAt;
                if (age < 0 || age > ACTIVITY_RETAIN_MS) {
                  unavailable++;
                  continue;
                }
                if (record.process.host !== hostname()) {
                  unavailable++;
                  continue;
                }
                const state = (o.probe ?? holderState)(record.process).state;
                const freshness =
                  state !== "live"
                    ? "unknown"
                    : age > ACTIVITY_FRESH_MS
                      ? "stale"
                      : "current";
                if (freshness !== "current") unavailable++;
                const actual = o.resolve
                  ? await o.resolve(record.cwd)
                  : await resolveWorkspaceAsync(record.cwd, signal);
                if (signal.aborted) return;
                if (
                  actual.cwd !== record.cwd ||
                  contains(
                    join(
                      canonicalAmbientRoot(o.stateHome),
                      "cadence-worktrees-v1",
                    ),
                    actual.root,
                  )
                ) {
                  unavailable++;
                  continue;
                }
                if (
                  privateWorkspace(actual.root, o.stateHome) ||
                  stateHomeInside(actual.root, o.stateHome)
                )
                  throw new Error("private-workspace");
                add(actual.root, {
                  id: record.activity,
                  source: "terminal",
                  sessionId: record.sessionId,
                  cwd: record.cwd,
                  leaf: record.leaf,
                  history:
                    record.sessionScope ===
                    hash(sessionDirectory(record.cwd, o.agentDir))
                      ? "shared"
                      : "unavailable",
                  phase: "turn",
                  freshness,
                  observedAt: record.renewedAt,
                  epoch: null,
                  instance: record.instance,
                  executionCwd: null,
                });
              } catch {
                unavailable++;
              }
            }
          },
        ),
      );
    } catch {
      unavailable++;
    }
    try {
      const candidates = (
        o.candidates?.() ??
        new ServiceCoordination(null, o.stateHome).registryView()?.value
          .entries ??
        []
      ).filter((r) => r.host === hostname());
      registryKnown = true;
      for (const row of candidates) ownerReaders.set(row.root, null);
      const chosen = Array.from(
        { length: Math.min(candidates.length, DISCOVERY_OWNERS) },
        (_, i) => candidates[(this.offset + i) % candidates.length],
      );
      this.offset = candidates.length
        ? (this.offset + chosen.length) % candidates.length
        : 0;
      if (chosen.length < candidates.length) unavailable++;
      let next = 0;
      await Promise.all(
        Array.from(
          { length: Math.min(DISCOVERY_CONCURRENCY, chosen.length) },
          async () => {
            for (;;) {
              const row = chosen[next++];
              if (!row || signal.aborted) return;
              try {
                if (
                  contains(
                    join(
                      canonicalAmbientRoot(o.stateHome),
                      "cadence-worktrees-v1",
                    ),
                    row.root,
                  )
                )
                  throw new Error("managed-workspace");
                const c = new ServiceCoordination(
                  new CheckoutStore(row.root, o.stateHome),
                );
                if (
                  c.store.root !== row.root ||
                  c.localAccess().epoch !== row.epoch
                )
                  throw new Error();
                const summary = decodeOwnerActivity(
                  await o.readOwner(c, signal),
                );
                if (signal.aborted) return;
                if (
                  summary.epoch !== row.epoch ||
                  c.localAccess().epoch !== row.epoch ||
                  !compatibleBuild(summary.build, {
                    kind: "native",
                    contractHash: o.build.contractHash,
                  })
                )
                  throw new Error();
                if (
                  summary.activities.some(
                    (activity) =>
                      activity.epoch !== row.epoch ||
                      activity.source === "terminal",
                  )
                )
                  throw new Error("invalid-attribution");
                if (summary.complete)
                  knownOwners.add(`${row.root}:${row.epoch}`);
                else unavailable++;
                ownerReaders.set(row.root, summary.readerScope);
                for (const activity of summary.activities)
                  add(row.root, { ...activity, observedAt: now });
              } catch {
                unavailable++;
              }
            }
          },
        ),
      );
    } catch {
      unavailable++;
    }
    // A failed query, vanished reservation, or new epoch is NOT settlement.
    for (const [key, kept] of this.kept) {
      if (
        found.has(key) ||
        (kept.activity.source === "terminal"
          ? !nativeIncomplete &&
            !nativeIds.has(`${kept.activity.instance}:${kept.activity.id}`)
          : knownOwners.has(`${kept.path}:${kept.activity.epoch}`))
      )
        continue;
      if (now - kept.activity.observedAt <= ACTIVITY_RETAIN_MS) {
        unavailable++;
        add(kept.path, { ...kept.activity, freshness: "unknown" });
      }
    }
    if (this.closed || generation !== this.generation)
      throw new Error("unavailable");
    this.kept.clear();
    const projects = new Map<string, Activity[]>();
    for (const [key, value] of found) {
      if (
        value.activity.source === "terminal" &&
        (!registryKnown ||
          (ownerReaders.has(value.path) &&
            ownerReaders.get(value.path) !== activityReaderScope(o.agentDir)))
      )
        value.activity = { ...value.activity, history: "unavailable" };
      this.kept.set(key, value);
      const list = projects.get(value.path) ?? [];
      list.push(value.activity);
      projects.set(value.path, list);
    }
    return {
      kind: "activity-discovery",
      epoch: o.epoch,
      observedAt: now,
      completeness: unavailable ? "partial" : "complete",
      unavailable: Math.min(10000, unavailable),
      projects: [...projects].map(([path, activities]) => ({
        path,
        activities,
      })),
    };
  }
}
