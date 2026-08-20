// Minimal in-memory scheduler for the private orchestration kernel.
// FIFO DAG-ready admission with one global active limit, declared-set
// declared serialization, batch cancellation, and at most one mechanical redispatch.
import { LIMITS, type RequestEnvelope } from "./contracts.ts";

export type TerminalStatus = "succeeded" | "failed" | "cancelled";

export interface ScheduledRequest {
  request: RequestEnvelope;
  prerequisites: string[];
  mechanicalRedispatch?: boolean;
}

export interface ScheduledOutcome<T = unknown> {
  id: string;
  status: TerminalStatus;
  attempts: number;
  value?: T;
  error?: string;
}

export interface BatchHandle<T = unknown> {
  batchId: string;
  result(id: string): Promise<ScheduledOutcome<T>>;
  done: Promise<ScheduledOutcome<T>[]>;
}

export interface SchedulerOptions<T = unknown> {
  limit: number;
  execute(
    request: RequestEnvelope,
    signal: AbortSignal,
    attempt: number,
  ): Promise<T>;
}

type EntryState = "queued" | "running" | TerminalStatus;

interface Entry<T> {
  request: RequestEnvelope;
  prerequisites: string[];
  mechanicalRedispatch: boolean;
  state: EntryState;
  attempts: number;
  cancelRequested: boolean;
  cancelReason: unknown;
  controller: AbortController | null;
  resolve(outcome: ScheduledOutcome<T>): void;
  promise: Promise<ScheduledOutcome<T>>;
}

function intersects(left: string[], right: string[]): boolean {
  return left.some((path) => right.includes(path));
}

function conflictEdgeMatches(
  conflicts: string[],
  other: RequestEnvelope,
): boolean {
  return conflicts.some(
    (edge) =>
      edge === other.taskId ||
      edge === other.id ||
      other.declared.read.includes(edge) ||
      other.declared.write.includes(edge),
  );
}

/** True when two declared envelopes cannot be active at the same time. */
export function declarationsConflict(
  left: RequestEnvelope,
  right: RequestEnvelope,
): boolean {
  const a = left.declared;
  const b = right.declared;
  if (intersects(a.write, b.write)) return true;
  if (intersects(a.write, b.read) || intersects(a.read, b.write)) return true;
  if (conflictEdgeMatches(a.conflicts, right)) return true;
  if (conflictEdgeMatches(b.conflicts, left)) return true;
  if (intersects(a.resources, b.resources)) return true;
  return (
    a.verificationLock !== undefined &&
    a.verificationLock === b.verificationLock
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class Batch<T> {
  readonly entries: Entry<T>[] = [];
  readonly byId = new Map<string, Entry<T>>();

  constructor(
    readonly batchId: string,
    requests: ScheduledRequest[],
  ) {
    for (const scheduled of requests) {
      let resolve: (outcome: ScheduledOutcome<T>) => void = () => {};
      const promise = new Promise<ScheduledOutcome<T>>((accept) => {
        resolve = accept;
      });
      const entry: Entry<T> = {
        request: scheduled.request,
        prerequisites: [...scheduled.prerequisites],
        mechanicalRedispatch: scheduled.mechanicalRedispatch === true,
        state: "queued",
        attempts: 0,
        cancelRequested: false,
        cancelReason: undefined,
        controller: null,
        resolve,
        promise,
      };
      this.entries.push(entry);
      this.byId.set(entry.request.id, entry);
    }
  }
}

export class Scheduler<T> {
  private readonly limit: number;
  private readonly execute: SchedulerOptions<T>["execute"];
  private readonly batches: Batch<T>[] = [];
  private readonly active = new Set<Entry<T>>();

  constructor(options: SchedulerOptions<T>) {
    this.limit = Math.max(
      1,
      Math.min(options.limit, LIMITS.maxActiveChildSessions),
    );
    this.execute = options.execute;
  }

  schedule(batchId: string, requests: ScheduledRequest[]): BatchHandle<T> {
    if (requests.length > LIMITS.maxRequestsPerBatch) {
      throw new Error(
        `batch ${batchId} exceeds ${LIMITS.maxRequestsPerBatch} requests`,
      );
    }
    const batch = new Batch<T>(batchId, requests);
    this.batches.push(batch);
    for (const entry of batch.entries) {
      const missing = entry.prerequisites.find((id) => !batch.byId.has(id));
      if (missing !== undefined) {
        this.settle(batch, entry, {
          id: entry.request.id,
          status: "cancelled",
          attempts: 0,
          error: `unknown prerequisite: ${missing}`,
        });
      }
    }
    this.pump();
    const done = Promise.all(batch.entries.map((entry) => entry.promise));
    void done.then(() => this.removeBatch(batch));
    return {
      batchId,
      result: (id: string) => {
        const entry = batch.byId.get(id);
        if (!entry) throw new Error(`unknown scheduled request: ${id}`);
        return entry.promise;
      },
      done,
    };
  }

  private removeBatch(batch: Batch<T>): void {
    const index = this.batches.indexOf(batch);
    if (index >= 0) this.batches.splice(index, 1);
  }

  cancel(
    batchId: string,
    reason: unknown = new Error("batch cancelled"),
  ): void {
    const batch = this.batches.find(
      (candidate) => candidate.batchId === batchId,
    );
    if (batch) this.cancelBatch(batch, reason);
  }

  async cancelAll(
    reason: unknown = new Error("batch cancelled"),
  ): Promise<void> {
    const batches = [...this.batches];
    for (const batch of batches) this.requestCancellation(batch, reason);
    for (const batch of batches) this.settleQueuedCancellation(batch);
    await Promise.all(
      batches.flatMap((batch) => batch.entries.map((entry) => entry.promise)),
    );
  }

  private cancelBatch(batch: Batch<T>, reason: unknown): void {
    this.requestCancellation(batch, reason);
    this.settleQueuedCancellation(batch);
  }

  private requestCancellation(batch: Batch<T>, reason: unknown): void {
    for (const entry of batch.entries) {
      if (entry.state !== "queued" && entry.state !== "running") continue;
      if (!entry.cancelRequested) entry.cancelReason = reason;
      entry.cancelRequested = true;
      if (entry.state === "running") entry.controller?.abort(reason);
    }
  }

  private settleQueuedCancellation(batch: Batch<T>): void {
    for (const entry of batch.entries) {
      if (entry.state === "queued") {
        this.settle(batch, entry, this.cancelOutcome(entry));
      }
    }
    this.pump();
  }

  private pump(): void {
    for (const batch of this.batches) {
      for (const entry of batch.entries) {
        if (this.active.size >= this.limit) return;
        if (entry.state !== "queued" || entry.cancelRequested) continue;
        if (!this.prerequisitesSucceeded(batch, entry)) continue;
        if (this.hasActiveConflict(entry)) continue;
        this.start(batch, entry);
      }
    }
  }

  private prerequisitesSucceeded(batch: Batch<T>, entry: Entry<T>): boolean {
    return entry.prerequisites.every(
      (id) => batch.byId.get(id)?.state === "succeeded",
    );
  }

  private hasActiveConflict(entry: Entry<T>): boolean {
    for (const activeEntry of this.active) {
      if (declarationsConflict(entry.request, activeEntry.request)) {
        return true;
      }
    }
    return false;
  }

  private start(batch: Batch<T>, entry: Entry<T>): void {
    // Guarded start: a cancelled or settled queued closure never runs later.
    if (entry.state !== "queued" || entry.cancelRequested) return;
    entry.state = "running";
    entry.attempts += 1;
    entry.controller = new AbortController();
    this.active.add(entry);
    const attempt = entry.attempts;
    this.execute(entry.request, entry.controller.signal, attempt).then(
      (value) => {
        if (entry.cancelRequested) {
          this.settleCancelled(batch, entry);
          return;
        }
        this.settle(batch, entry, {
          id: entry.request.id,
          status: "succeeded",
          attempts: entry.attempts,
          value,
        });
      },
      (error) => {
        if (entry.cancelRequested) {
          this.settleCancelled(batch, entry);
          return;
        }
        if (entry.mechanicalRedispatch && attempt === 1) {
          this.redispatch(batch, entry);
          return;
        }
        this.settle(batch, entry, {
          id: entry.request.id,
          status: "failed",
          attempts: entry.attempts,
          error: errorMessage(error),
        });
      },
    );
  }

  private redispatch(batch: Batch<T>, entry: Entry<T>): void {
    // One identical mechanical redispatch in the retained active slot; the
    // attempt becomes 2 and a further failure settles, so no third attempt.
    entry.state = "queued";
    entry.controller = null;
    this.start(batch, entry);
  }

  private settleCancelled(batch: Batch<T>, entry: Entry<T>): void {
    this.settle(batch, entry, this.cancelOutcome(entry));
  }

  private cancelOutcome(entry: Entry<T>): ScheduledOutcome<T> {
    return {
      id: entry.request.id,
      status: "cancelled",
      attempts: entry.attempts,
      error: errorMessage(entry.cancelReason ?? new Error("batch cancelled")),
    };
  }

  private settle(
    batch: Batch<T>,
    entry: Entry<T>,
    outcome: ScheduledOutcome<T>,
  ): void {
    // Every scheduled request reaches exactly one terminal state.
    if (entry.state !== "queued" && entry.state !== "running") return;
    entry.state = outcome.status;
    this.active.delete(entry);
    entry.controller = null;
    entry.resolve(outcome);
    if (outcome.status !== "succeeded") {
      this.blockDependents(batch, entry.request.id, outcome.status);
    }
    this.pump();
  }

  private blockDependents(
    batch: Batch<T>,
    prerequisiteId: string,
    status: TerminalStatus,
  ): void {
    // A dependent can never start after a prerequisite failure or cancel;
    // independent siblings keep their own outcomes.
    for (const dependent of batch.entries) {
      if (dependent.state !== "queued") continue;
      if (!dependent.prerequisites.includes(prerequisiteId)) continue;
      this.settle(batch, dependent, {
        id: dependent.request.id,
        status: "cancelled",
        attempts: dependent.attempts,
        error: `blocked: prerequisite ${prerequisiteId} ${status}`,
      });
    }
  }
}
