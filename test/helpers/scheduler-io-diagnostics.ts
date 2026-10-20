/** Opt-in test instrumentation. No paths, arguments, payloads or errors retained.
 * Native API durations enclose syscall work; async timings ALSO include queue and
 * event-loop delay. They are not kernel-only syscall timers. Never replace an
 * original promise, defer a callback, or write a receipt on a critical IO path.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { ChildProcess } from "node:child_process";
import type { Dir, Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";

type Total = {
  count: number;
  ms: number;
  maxMs: number;
  errors: number;
  cpuUserUs?: number;
  cpuSystemUs?: number;
};
type Case = {
  ordinal: number;
  start: number;
  bodyEnd: number | null;
  teardownEnd: number | null;
  bodyRejected: boolean;
  totals: Record<string, Total>;
  late: Record<string, Total>;
  pending: number;
};
type Event = { ms: number; case: number; stage: string; id: number };
const resource = () => {
  const activeResources: Record<string, number> = {};
  for (const type of process.getActiveResourcesInfo()) {
    const key = [
      "Timeout",
      "Immediate",
      "TCPServerWrap",
      "TCPSocketWrap",
      "ProcessWrap",
      "PipeWrap",
      "FSReqCallback",
      "FSReqPromise",
      "FileHandle",
      "FileHandleCloseReq",
      "MessagePort",
    ].includes(type)
      ? type
      : "other";
    activeResources[key] = (activeResources[key] ?? 0) + 1;
  }
  return {
    cpu: process.cpuUsage(),
    usage: process.resourceUsage(),
    activeResources,
  };
};

export class SchedulerIoDiagnostics {
  readonly enabled: boolean;
  private readonly context = new AsyncLocalStorage<Case>();
  private readonly start = performance.now();
  private readonly cases: Case[] = [];
  private readonly events: Event[] = [];
  private readonly snapshots: object[] = [];
  private readonly samples: object[] = [];
  private readonly originals = new WeakMap<object, number>();
  private readonly descriptors = new Map<number, "directory" | "file">();
  private readonly handles = new WeakSet<object>();
  private nextIdentity = 0;
  private current?: Case;
  private timer?: ReturnType<typeof setInterval>;
  private dropped = 0;
  constructor(enabled = false) {
    this.enabled = enabled;
  }
  private record(
    case_: Case | undefined,
    name: string,
    start: number,
    error: boolean,
    cpuBefore?: NodeJS.CpuUsage,
  ): void {
    if (!case_) return;
    const ms = performance.now() - start;
    const cpu = cpuBefore ? process.cpuUsage(cpuBefore) : undefined;
    for (const table of case_.teardownEnd === null
      ? [case_.totals]
      : [case_.totals, case_.late]) {
      table[name] ??= { count: 0, ms: 0, maxMs: 0, errors: 0 };
      const total = table[name];
      total.count++;
      total.ms += ms;
      total.maxMs = Math.max(total.maxMs, ms);
      if (error) total.errors++;
      if (cpu) {
        total.cpuUserUs = (total.cpuUserUs ?? 0) + cpu.user;
        total.cpuSystemUs = (total.cpuSystemUs ?? 0) + cpu.system;
      }
    }
  }
  private identity(value: object): number {
    let id = this.originals.get(value);
    if (id === undefined) {
      id = ++this.nextIdentity;
      this.originals.set(value, id);
    }
    return id;
  }
  mark(
    stage: string,
    id = 0,
    case_ = this.context.getStore() ?? this.current,
  ): void {
    if (!this.enabled) return;
    if (this.events.length === 8192) {
      this.dropped++;
      return;
    }
    this.events.push({
      ms: performance.now(),
      case: case_?.ordinal ?? 0,
      stage,
      id,
    });
  }
  original(stage: string, promise: Promise<unknown>): void {
    if (!this.enabled) return;
    const case_ = this.context.getStore() ?? this.current;
    const id = this.identity(promise);
    this.mark(`${stage}:registered`, id, case_);
    if (case_) case_.pending++;
    void promise.then(
      () => {
        if (case_) case_.pending--;
        this.mark(`${stage}:settled`, id, case_);
      },
      () => {
        if (case_) case_.pending--;
        this.mark(`${stage}:rejected`, id, case_);
      },
    );
  }
  /** Return the EXACT original result, including promise identity and throw. */
  timed<T>(name: string, call: () => T): T {
    if (!this.enabled) return call();
    const case_ = this.context.getStore();
    if (!case_) return call();
    // Sparse fsync-only CPU deltas; never per-stat resource sampling. Other
    // threads contribute to process CPU, so elapsed-minus-CPU is not kernel time.
    const cpu = name.startsWith("fsyncSync:") ? process.cpuUsage() : undefined;
    const start = performance.now();
    let result: T;
    try {
      result = call();
    } catch (error) {
      this.record(case_, name, start, true, cpu);
      throw error;
    }
    if (result instanceof Promise) {
      case_.pending++;
      void result.then(
        () => {
          case_.pending--;
          this.record(case_, name, start, false);
        },
        () => {
          case_.pending--;
          this.record(case_, name, start, true);
        },
      );
    } else this.record(case_, name, start, false, cpu);
    return result;
  }
  /** Test registration only: same test names/options/deadlines and callback result. */
  tests<T extends object>(it: T): T {
    if (!this.enabled) return it;
    const diagnostic = this;
    const register = (target: T): T =>
      new Proxy(target, {
        apply(fn, self, args: unknown[]) {
          const callback = args[1];
          if (typeof callback !== "function")
            throw Error("diagnostic test registration");
          const wrapped = function (this: unknown, ...input: unknown[]) {
            return diagnostic.runCase(() =>
              Reflect.apply(callback, this, input),
            );
          };
          return Reflect.apply(fn as (...a: unknown[]) => unknown, self, [
            args[0],
            wrapped,
            ...args.slice(2),
          ]);
        },
        get(fn, key, receiver) {
          const value = Reflect.get(fn, key, receiver);
          if (key !== "each") return value;
          if (typeof value !== "function")
            throw Error("diagnostic each registration");
          return (...args: unknown[]) =>
            register(Reflect.apply(value, fn, args));
        },
      });
    return register(it);
  }
  runCase<T>(call: () => T): T {
    if (!this.enabled) return call();
    if (this.cases.length === 64) throw Error("diagnostic case bound");
    const case_: Case = {
      ordinal: this.cases.length + 1,
      start: performance.now(),
      bodyEnd: null,
      teardownEnd: null,
      bodyRejected: false,
      totals: {},
      late: {},
      pending: 0,
    };
    this.cases.push(case_);
    this.current = case_;
    this.mark("case:begin", 0, case_);
    this.snapshot("case:begin");
    if (!this.timer) {
      this.timer = setInterval(() => {
        if (this.samples.length < 1201)
          this.samples.push({
            ms: performance.now(),
            case: this.current?.ordinal ?? 0,
            ...resource(),
          });
        else this.dropped++;
      }, 1000);
      this.timer.unref();
    }
    const end = (rejected: boolean) => {
      case_.bodyEnd = performance.now();
      case_.bodyRejected = rejected;
      this.mark(rejected ? "body:rejected" : "body:resolved", 0, case_);
    };
    return this.context.run(case_, () => {
      try {
        const result = call();
        if (result instanceof Promise)
          void result.then(
            () => end(false),
            () => end(true),
          );
        else end(false);
        return result;
      } catch (error) {
        end(true);
        throw error;
      }
    });
  }
  /** Teardown itself runs in the same case context, without joining late work. */
  teardown<T>(call: () => T): T {
    return this.current ? this.context.run(this.current, call) : call();
  }
  snapshot(stage: string, observation: object = {}): void {
    if (!this.enabled) return;
    if (this.snapshots.length === 256) {
      this.dropped++;
      return;
    }
    this.snapshots.push({
      ms: performance.now(),
      case: this.current?.ordinal ?? 0,
      stage,
      ...resource(),
      observation,
      cases: this.cases.map((c) => ({
        ordinal: c.ordinal,
        bodyEnd: c.bodyEnd,
        teardownEnd: c.teardownEnd,
        pending: c.pending,
        late: structuredClone(c.late),
      })),
    });
  }
  teardownEnded(): void {
    if (this.current) this.current.teardownEnd = performance.now();
    this.snapshot("teardown:end");
  }
  native(child: ChildProcess): void {
    if (!this.enabled) return;
    const case_ = this.context.getStore();
    const id = this.identity(child);
    const pid = child.pid ?? 0;
    this.mark(`native:spawn:${pid}`, id, case_);
    child.on("error", () => this.mark("native:error", id, case_));
    child.on("exit", (code, signal) =>
      this.mark(`native:exit:${code ?? "null"}:${signal ?? "none"}`, id, case_),
    );
    child.on("close", (code, signal) =>
      this.mark(
        `native:close:${code ?? "null"}:${signal ?? "none"}`,
        id,
        case_,
      ),
    );
  }
  fs(actual: typeof import("node:fs")): typeof import("node:fs") {
    if (!this.enabled) return actual;
    const diagnostic = this;
    const result = { ...actual };
    // These Node native API calls do not expose buffers/paths in diagnostics.
    const keys = [
      "lstatSync",
      "statSync",
      "fstatSync",
      "realpathSync",
      "readSync",
      "readFileSync",
      "writeSync",
      "writeFileSync",
      "mkdirSync",
      "mkdtempSync",
      "readdirSync",
      "renameSync",
      "unlinkSync",
      "statfsSync",
      "fsyncSync",
      "closeSync",
      "openSync",
      "opendirSync",
    ] as const;
    for (const key of keys) {
      const original = actual[key];
      Reflect.set(result, key, function (this: unknown, ...args: unknown[]) {
        const kind =
          key === "fsyncSync"
            ? (diagnostic.descriptors.get(args[0] as number) ?? "unknown")
            : null;
        const returned = diagnostic.timed(kind ? `${key}:${kind}` : key, () =>
          Reflect.apply(original, this, args),
        );
        if (key === "openSync" && diagnostic.descriptors.size < 256)
          diagnostic.descriptors.set(
            returned as number,
            typeof args[1] === "number" &&
              (args[1] & actual.constants.O_DIRECTORY) !== 0
              ? "directory"
              : "file",
          );
        if (key === "closeSync")
          diagnostic.descriptors.delete(args[0] as number);
        if (key === "opendirSync") diagnostic.directory(returned as Dir);
        // Classification uses an already-returned stat only, never an extra syscall.
        if (key === "fstatSync" && diagnostic.descriptors.size < 256)
          diagnostic.descriptors.set(
            args[0] as number,
            (returned as Stats).isDirectory() ? "directory" : "file",
          );
        return returned;
      });
    }
    return result;
  }
  private directory(dir: Dir): void {
    for (const key of ["readSync", "closeSync"] as const) {
      const original = dir[key];
      const diagnostic = this;
      Reflect.set(dir, key, function (this: Dir, ...args: unknown[]) {
        return diagnostic.timed(`directory:${key}`, () =>
          Reflect.apply(original, this, args),
        );
      });
    }
  }
  promises(
    actual: typeof import("node:fs/promises"),
  ): typeof import("node:fs/promises") {
    if (!this.enabled) return actual;
    const diagnostic = this;
    return {
      ...actual,
      open(...args) {
        const original = diagnostic.timed("async:open", () =>
          actual.open(...args),
        );
        // Registered before the caller's await, but returns its original promise.
        void original.then(
          (handle) => diagnostic.handle(handle),
          () => {},
        );
        return original;
      },
    };
  }
  private handle(handle: FileHandle): void {
    if (this.handles.has(handle)) return;
    this.handles.add(handle);
    for (const key of [
      "writeFile",
      "write",
      "read",
      "readFile",
      "stat",
      "sync",
      "close",
    ] as const) {
      const original = handle[key];
      const diagnostic = this;
      Reflect.set(handle, key, function (this: FileHandle, ...args: unknown[]) {
        return diagnostic.timed(`async:${key}`, () =>
          Reflect.apply(original, this, args),
        );
      });
    }
  }
  finish(): object {
    if (this.timer) clearInterval(this.timer);
    this.snapshot("file:end");
    return {
      schema: "cadence-scheduler-io/1",
      pid: process.pid,
      start: this.start,
      end: performance.now(),
      enabled: this.enabled,
      cases: this.cases,
      events: this.events,
      snapshots: this.snapshots,
      samples: this.samples,
      dropped: this.dropped,
    };
  }
}
export const schedulerIo = new SchedulerIoDiagnostics(
  process.env.CADENCE_SCHEDULER_IO_DIAGNOSTICS === "1",
);
