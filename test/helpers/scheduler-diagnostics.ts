/** Test-only bounded timings. Never await/replace originals or retain their payloads. */
import { writeFileSync } from "node:fs";
import { HistoryNavigation } from "../../src/history/navigation.ts";
import type { ServiceHost } from "../../src/service/host.ts";
import type { TaskActions } from "../../src/service/task-actions.ts";

export class SchedulerDiagnostics {
  private readonly start = performance.now();
  private sequence = 0;
  private readonly identities = new WeakMap<object, number>();
  private readonly events: { ms: number; stage: string; id: number }[] = [];
  private readonly totals = new Map<
    string,
    { count: number; ms: number; maxMs: number }
  >();
  private readonly pending = new Set<number>();
  private readonly restores: (() => void)[] = [];
  private dropped = 0;
  path?: string;
  mark(stage: string, id = 0): void {
    if (this.events.length >= 2048) {
      this.dropped++;
      return;
    }
    this.events.push({ ms: performance.now() - this.start, stage, id });
  }
  private id(value: object): number {
    let id = this.identities.get(value);
    if (id === undefined) {
      id = ++this.sequence;
      this.identities.set(value, id);
    }
    return id;
  }
  original(stage: string, promise: Promise<unknown>): void {
    const id = this.id(promise);
    if (this.pending.size < 2048) this.pending.add(id);
    else this.dropped++;
    this.mark(`${stage}:registered`, id);
    void promise.then(
      () => {
        this.pending.delete(id);
        this.mark(`${stage}:settled`, id);
      },
      () => {
        this.pending.delete(id);
        this.mark(`${stage}:rejected`, id);
      },
    );
  }
  private time<T>(stage: string, fn: () => T): T {
    const start = performance.now();
    try {
      return fn();
    } finally {
      const ms = performance.now() - start;
      const total = this.totals.get(stage) ?? { count: 0, ms: 0, maxMs: 0 };
      total.count++;
      total.ms += ms;
      total.maxMs = Math.max(total.maxMs, ms);
      this.totals.set(stage, total);
    }
  }
  wrap<T extends object, K extends keyof T>(
    target: T,
    key: K,
    replacement: T[K],
  ): void {
    const original = target[key];
    target[key] = replacement;
    this.restores.push(() => {
      target[key] = original;
    });
  }
  attach(h: ServiceHost, actions: TaskActions): void {
    const history = h.owner.trackHistory.bind(h.owner);
    const diagnostic = this;
    const prepareIndex = HistoryNavigation.prototype.prepare;
    this.wrap(
      HistoryNavigation.prototype,
      "prepare",
      function (this: HistoryNavigation, ...args) {
        return diagnostic.time("navigation:prepare", () =>
          prepareIndex.apply(this, args),
        );
      },
    );
    const publishIndex = HistoryNavigation.prototype.publish;
    this.wrap(
      HistoryNavigation.prototype,
      "publish",
      function (this: HistoryNavigation, ...args) {
        return diagnostic.time("navigation:publish", () =>
          publishIndex.apply(this, args),
        );
      },
    );
    const activeIndex = HistoryNavigation.prototype.publishActive;
    this.wrap(
      HistoryNavigation.prototype,
      "publishActive",
      function (this: HistoryNavigation, ...args) {
        return diagnostic.time("navigation:active", () =>
          activeIndex.apply(this, args),
        );
      },
    );
    const create = h.coordination.files.create.bind(h.coordination.files);
    this.wrap(h.coordination.files, "create", (...args) =>
      this.time("private-create", () => create(...args)),
    );
    const replace = h.coordination.files.replace.bind(h.coordination.files);
    this.wrap(h.coordination.files, "replace", (...args) =>
      this.time("private-replace", () => replace(...args)),
    );
    const capture = h.writer.capture.bind(h.writer);
    this.wrap(h.writer, "capture", (link) => {
      const sink = capture(link),
        reserve = sink.reserve.bind(sink);
      return {
        reserve: (budget) => {
          const result = reserve(budget);
          if (result.status === "reserved") {
            const commit = result.reservation.commit.bind(result.reservation);
            result.reservation.commit = (input) => {
              if (input.events.some((event) => event.event.kind === "ready"))
                this.mark("capture:ready");
              return commit(input);
            };
          }
          return result;
        },
      };
    });
    this.wrap(h.owner, "trackHistory", (original, safety) => {
      this.original(safety ? "write-safety" : "write", original);
      return history(original, safety);
    });
    const worker = h.owner.trackWorker.bind(h.owner);
    this.wrap(h.owner, "trackWorker", (original, stop) => {
      this.original("worker", original);
      return worker(original, stop);
    });
    const prepare = h.models.prepareTracked.bind(h.models);
    this.wrap(h.models, "prepareTracked", (input) => {
      this.mark("auth:begin");
      const result = prepare(input);
      this.original("auth-original", result.settled);
      this.original("auth-report", result.result);
      return result;
    });
    const publish = h.writer.publishTask.bind(h.writer);
    this.wrap(h.writer, "publishTask", (input) => {
      this.mark("publication:begin");
      const original = publish(input);
      this.original("publication-report", original);
      return original;
    });
    const port = h.writer.owner.bind(h.writer);
    this.wrap(h.writer, "owner", () => {
      const result = port(),
        reserve = result.reserve.bind(result);
      return {
        reserve: (budget) => {
          const reserved = reserve(budget);
          if (reserved.status === "reserved") {
            const commit = reserved.reservation.commit.bind(
              reserved.reservation,
            );
            reserved.reservation.commit = (input) => {
              for (const event of input.events)
                if (event.kind === "fact") {
                  const fact = event.fact;
                  this.mark(
                    fact.kind === "gate"
                      ? `gate:${fact.lane}:${fact.state}`
                      : fact.kind === "assignment-state"
                        ? `assignment:${fact.state}`
                        : fact.kind,
                  );
                }
              return commit(input);
            };
          }
          return reserved;
        },
      };
    });
    const observe = actions.observe.bind(actions);
    this.wrap(actions, "observe", (action) => {
      this.mark(`observe:${action.kind}:begin`);
      const original = this.time("observe-sync", () => observe(action));
      this.original(`observe:${action.kind}`, original);
      return original;
    });
    const assert = h.owner.lease.assert.bind(h.owner.lease);
    this.wrap(h.owner.lease, "assert", () => this.time("lease-assert", assert));
    const read = h.coordination.files.read.bind(h.coordination.files);
    this.wrap(h.coordination.files, "read", (...args) =>
      this.time("private-read", () => read(...args)),
    );
    const append = h.writer.files.append.bind(h.writer.files);
    this.wrap(h.writer.files, "append", (...args) => {
      this.mark("append:begin");
      const original = append(...args);
      this.original("append", original);
      return original;
    });
  }
  snapshot(h?: ServiceHost, actions?: TaskActions): object {
    return {
      schema: "cadence-scheduler-timings/1",
      start: this.start,
      events: this.events,
      totals: Object.fromEntries(this.totals),
      dropped: this.dropped,
      pendingOriginalOrReportIds: [...this.pending],
      ownerState: h?.owner.state,
      writerPending: h?.writer.pendingWrites,
      scheduler: actions?.scheduler.accounting,
    };
  }
  finish(h?: ServiceHost, actions?: TaskActions): void {
    this.mark("diagnostic:snapshot");
    try {
      if (this.path)
        writeFileSync(
          this.path,
          `${JSON.stringify(this.snapshot(h, actions), null, 2)}\n`,
          { mode: 0o600 },
        );
    } catch {
      // Diagnostics must not replace the case's original failure or teardown.
      console.error(
        "Scheduler timing receipt unavailable; original test outcome unchanged.",
      );
    } finally {
      for (const restore of this.restores.reverse()) restore();
    }
  }
}
