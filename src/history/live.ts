/** W1-compatible committed notifications. Rings are navigation accelerators only;
 * snapshots/heartbeats recover eviction, generation changes and lost final updates. */
import type { LiveProjectionPort } from "../service/http.ts";
import {
  ContractError,
  canonicalJson,
  decodeLiveEvent,
  decodeScope,
  decodeSnapshot,
  LIMITS,
  type LiveEvent,
  type Scope,
  type Snapshot,
} from "../service-contract.ts";
import type { HistoryProjection } from "./projection.ts";
import type { HistoryWriter } from "./writer.ts";

/** Narrow an already observed atomic group, never synthesize a missing run.
 * Task horizons contain whole parent/assignment groups. Run snapshots contain
 * that same complete group; child snapshots cannot prove their siblings. The
 * context and watermark remain the source observation, not renewed consent. */
export function scopedSnapshot(
  source: Snapshot,
  scope: Scope,
): Snapshot | undefined {
  if (scope.kind === "task" || source.scope.kind === "child") return;
  if (
    !source.runs.some((run) =>
      scope.kind === "run"
        ? run.runId === scope.id && run.childRunId === null
        : run.childRunId === scope.id,
    )
  )
    return;
  return decodeSnapshot({
    ...source,
    scope,
    runs: source.runs.filter((run) =>
      scope.kind === "run"
        ? run.runId === scope.id
        : run.childRunId === scope.id,
    ),
    horizon: {
      ...source.horizon,
      historicalRuns: { ...source.horizon.historicalRuns, scope },
    },
  });
}

interface Viewer {
  scope: Scope;
  callback: (event: LiveEvent) => void;
  seq: string;
  closed: boolean;
  queue: LiveEvent[];
  bytes: number;
  scheduled: boolean;
  keys: Set<string> | null;
}
interface Ring {
  events: LiveEvent[];
  bytes: number;
  snapshot: Snapshot;
}
export class HistoryLive implements LiveProjectionPort {
  private readonly viewers = new Set<Viewer>();
  private readonly rings = new Map<string, Ring>();
  private readonly pending = new Map<string, Scope>();
  private scheduled = false;
  private closed = false;
  private readonly detach: () => void;
  private readonly detachSnapshots: () => void;
  constructor(
    readonly writer: HistoryWriter,
    readonly projection: HistoryProjection,
  ) {
    this.detachSnapshots = projection.observeSnapshots((snapshot) => {
      for (const viewer of this.viewers)
        if (
          viewer.keys === null &&
          canonicalJson(viewer.scope) === canonicalJson(snapshot.scope)
        ) {
          viewer.keys = new Set(snapshot.keys);
          viewer.seq = snapshot.committedSeq;
        }
    });
    this.detach = writer.subscribeCommitted((notice) => {
      if (this.closed) return;
      if (notice.gap)
        for (const v of this.viewers) this.enqueue(v, this.watermark(v.scope));
      for (const id of notice.runs)
        this.pending.set(`run/${id}`, { kind: "run", id });
      for (const id of notice.tasks)
        this.pending.set(`task/${id}`, { kind: "task", id });
      // Metadata/control updates affect attached run/child contexts too.
      for (const v of this.viewers)
        this.pending.set(`${v.scope.kind}/${v.scope.id}`, v.scope);
      if (this.pending.size > LIMITS.maxPageEntries) {
        this.pending.clear();
        for (const v of this.viewers) this.enqueue(v, this.watermark(v.scope));
      }
      if (!this.scheduled) {
        this.scheduled = true;
        setImmediate(() => {
          void this.drain();
        });
      }
    });
  }
  watermark = (input: Scope): LiveEvent => {
    const scope = decodeScope(input),
      session = this.projection.environment.session();
    return decodeLiveEvent({
      kind: "heartbeat",
      storeId: this.writer.files.format.storeId,
      epoch: session.epoch,
      scope,
      committedSeq: this.writer.committedSeq,
    });
  };
  subscribe = (
    input: Scope,
    callback: (event: LiveEvent) => void,
  ): (() => void) => {
    if (this.closed || this.viewers.size >= LIMITS.viewers)
      throw new ContractError("capacity");
    const scope = decodeScope(input),
      viewer: Viewer = {
        scope,
        callback,
        seq: this.writer.committedSeq,
        closed: false,
        queue: [],
        bytes: 0,
        scheduled: false,
        keys: null,
      };
    this.viewers.add(viewer);
    return () => {
      viewer.closed = true;
      viewer.queue = [];
      viewer.bytes = 0;
      this.viewers.delete(viewer);
    };
  };
  private enqueue(v: Viewer, event: LiveEvent): void {
    if (v.closed) return;
    const bytes = Buffer.byteLength(canonicalJson(event));
    if (
      v.queue.length >= LIMITS.viewerMessages ||
      v.bytes + bytes > LIMITS.viewerBytes
    ) {
      // A newer heartbeat explicitly drives W1 resync; never split sibling updates.
      v.queue = [this.watermark(v.scope)];
      v.bytes = Buffer.byteLength(canonicalJson(v.queue[0]));
    } else {
      v.queue.push(event);
      v.bytes += bytes;
    }
    if (v.scheduled) return;
    v.scheduled = true;
    setImmediate(() => {
      void this.pump(v);
    });
  }
  private async pump(v: Viewer): Promise<void> {
    try {
      while (!v.closed && v.queue.length) {
        const event = v.queue.shift();
        if (!event) break;
        v.bytes -= Buffer.byteLength(canonicalJson(event));
        // At most one original callback promise per viewer; do not launch an
        // unbounded series of async observers or adopt them in the writer.
        await v.callback(event);
      }
    } catch {
      v.closed = true;
      this.viewers.delete(v);
      v.queue = [];
      v.bytes = 0;
    } finally {
      v.scheduled = false;
    }
  }

  private async drain(): Promise<void> {
    const order = { task: 0, run: 1, child: 2 };
    const scopes = [...this.pending.values()].sort(
      (a, b) => order[a.kind] - order[b.kind],
    );
    this.pending.clear();
    // Only this finite drain's actual snapshots, never prior rings/current
    // context cached across notification rounds. New commits queue the next
    // drain while this one runs, so a narrowed observation cannot lose a final.
    const sources: Snapshot[] = [];
    try {
      for (const scope of scopes) {
        if (this.closed) return;
        if (
          scope.kind !== "run" &&
          ![...this.viewers].some(
            (v) => canonicalJson(v.scope) === canonicalJson(scope),
          )
        )
          continue;
        let snapshot: Snapshot | undefined;
        // Prefer the latest already-observed containing group. Do not rescan
        // the same task/run and re-observe its checkout/model for every scope.
        for (let i = sources.length - 1; i >= 0 && !snapshot; i--)
          snapshot = scopedSnapshot(sources[i], scope);
        const reused = snapshot !== undefined;
        try {
          snapshot ??= await this.projection.snapshot(scope);
        } catch {
          for (const v of this.viewers)
            if (v.scope.id === scope.id)
              this.enqueue(v, this.watermark(v.scope));
          continue;
        }
        // Retain only originals that can serve viewers in this round. No copy
        // of every unobserved run ring, nor a second narrowed copy of a group:
        // at most one page-sized source per viewer (not 200 x 512KiB).
        if (
          !reused &&
          sources.length < LIMITS.viewers &&
          (scope.kind === "task" ||
            scopes.some(
              (s) =>
                s.kind === "child" &&
                snapshot.runs.some((r) => r.childRunId === s.id),
            ))
        )
          sources.push(snapshot);
        const key = `${scope.kind}/${scope.id}`,
          old = this.rings.get(key);
        const update = (
          previousSeq: string,
          selected: Scope = scope,
          previousKeys?: Set<string>,
        ): LiveEvent =>
          decodeLiveEvent({
            kind: "update",
            storeId: snapshot.storeId,
            epoch: snapshot.epoch,
            scope: selected,
            previousSeq,
            committedSeq: snapshot.committedSeq,
            context: snapshot.context,
            runs: snapshot.runs.filter(
              (r) => selected.kind !== "child" || r.childRunId === selected.id,
            ),
            removed: [
              ...(previousKeys ??
                new Set(
                  (old?.snapshot.runs ?? []).map(
                    (r) => r.childRunId ?? r.runId,
                  ),
                )),
            ].filter(
              (id) =>
                !snapshot.runs.some((r) => (r.childRunId ?? r.runId) === id),
            ),
          });
        if (old && old.snapshot.committedSeq === snapshot.committedSeq)
          continue;
        // Retain one ring per run even with zero viewers. Task/child subscriptions
        // project the same atomic committed group, never invent another reducer.
        if (scope.kind === "run") {
          const event = update(old?.snapshot.committedSeq ?? "0"),
            bytes = Buffer.byteLength(canonicalJson(event));
          const ring = old ?? { events: [], bytes: 0, snapshot };
          while (
            ring.events.length &&
            (ring.events.length >= LIMITS.ringEvents ||
              ring.bytes + bytes > LIMITS.ringBytes)
          )
            ring.bytes -= Buffer.byteLength(canonicalJson(ring.events.shift()));
          ring.events.push(event);
          ring.bytes += bytes;
          ring.snapshot = snapshot;
          this.rings.set(key, ring);
          // Bounded aggregate metadata. Eviction never erases durable history.
          while (
            this.rings.size > LIMITS.maxPageEntries ||
            [...this.rings.values()].reduce((n, r) => n + r.bytes, 0) >
              32 * 1024 * 1024
          ) {
            const first = this.rings.keys().next().value;
            if (first) this.rings.delete(first);
            else break;
          }
        }
        for (const v of this.viewers) {
          const matches =
            (v.scope.kind === scope.kind && v.scope.id === scope.id) ||
            (scope.kind === "run" &&
              v.scope.kind === "child" &&
              snapshot.runs.some((r) => r.childRunId === v.scope.id));
          if (!matches || BigInt(v.seq) >= BigInt(snapshot.committedSeq))
            continue;
          try {
            if (!v.keys) {
              this.enqueue(v, this.watermark(v.scope));
              continue;
            }
            const event = update(v.seq, v.scope, v.keys);
            v.keys = new Set(
              snapshot.runs
                .filter(
                  (r) =>
                    v.scope.kind !== "child" || r.childRunId === v.scope.id,
                )
                .map((r) => r.childRunId ?? r.runId),
            );
            v.seq = snapshot.committedSeq;
            this.enqueue(v, event);
          } catch {
            this.enqueue(v, this.watermark(v.scope));
          }
        }
      }
    } catch {
      for (const viewer of this.viewers) {
        try {
          this.enqueue(viewer, this.watermark(viewer.scope));
        } catch {
          viewer.closed = true;
          this.viewers.delete(viewer);
        }
      }
    } finally {
      this.scheduled = false;
      if (!this.closed && this.pending.size) {
        this.scheduled = true;
        setImmediate(() => {
          void this.drain();
        });
      }
    }
  }
  replay(runId: string, after: string): readonly LiveEvent[] | null {
    const ring = this.rings.get(`run/${runId}`);
    if (!ring) return null;
    if (after === ring.snapshot.committedSeq) return [];
    const at = ring.events.findIndex(
      (e) => e.kind === "update" && e.previousSeq === after,
    );
    return at < 0 ? null : structuredClone(ring.events.slice(at));
  }
  close(): void {
    this.closed = true;
    this.detach();
    this.detachSnapshots();
    this.pending.clear();
    this.rings.clear();
    for (const v of this.viewers) {
      v.closed = true;
      v.queue = [];
    }
    this.viewers.clear();
  }
}
