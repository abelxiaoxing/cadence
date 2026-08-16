import { describe, expect, it } from "vitest";
import type { RequestEnvelope } from "../src/contracts";
import { Runtime } from "../src/runtime";

type TerminalStatus = "succeeded" | "failed" | "cancelled";

interface ScheduledRequest {
  request: RequestEnvelope;
  prerequisites: string[];
  mechanicalRedispatch?: boolean;
}

interface ScheduledOutcome<T = unknown> {
  id: string;
  status: TerminalStatus;
  attempts: number;
  value?: T;
  error?: string;
}

interface BatchHandle<T = unknown> {
  batchId: string;
  result(id: string): Promise<ScheduledOutcome<T>>;
  done: Promise<ScheduledOutcome<T>[]>;
}

interface SchedulerOptions<T = unknown> {
  limit: number;
  execute(
    request: RequestEnvelope,
    signal: AbortSignal,
    attempt: number,
  ): Promise<T>;
}

interface SchedulerLike<T = unknown> {
  schedule(batchId: string, requests: ScheduledRequest[]): BatchHandle<T>;
  cancel(batchId: string): void;
  cancelAll?(): Promise<void>;
}

type SchedulerConstructor = new <T>(
  options: SchedulerOptions<T>,
) => SchedulerLike<T>;

class NotReadyScheduler<T> implements SchedulerLike<T> {
  private readonly runtime = new Runtime();

  constructor(_options: SchedulerOptions<T>) {}

  schedule(batchId: string, requests: ScheduledRequest[]): BatchHandle<T> {
    const results = new Map<string, Promise<ScheduledOutcome<T>>>();
    for (const entry of requests) {
      const outcome = this.runtime
        .execute("run", { request: entry.request })
        .then((probe) => ({
          id: entry.request.id,
          status: "failed" as const,
          attempts: 0,
          error: probe.ok
            ? "not_ready: single-run facade has no scheduler"
            : `not_ready: ${probe.error}`,
        }));
      results.set(entry.request.id, outcome);
    }
    return {
      batchId,
      result(id) {
        const outcome = results.get(id);
        if (!outcome) throw new Error(`unknown scheduled request: ${id}`);
        return outcome;
      },
      done: Promise.all([...results.values()]),
    };
  }

  cancel(_batchId: string): void {
    void this.runtime.execute("cancel", {});
  }
}

let SchedulerImpl: SchedulerConstructor =
  NotReadyScheduler as unknown as SchedulerConstructor;
try {
  const schedulerSpecifier = "../src/scheduler";
  const schedulerModule = (await import(schedulerSpecifier)) as {
    Scheduler?: SchedulerConstructor;
  };
  if (typeof schedulerModule.Scheduler === "function") {
    SchedulerImpl = schedulerModule.Scheduler;
  }
} catch {
  SchedulerImpl = NotReadyScheduler as unknown as SchedulerConstructor;
}

function createScheduler<T>(
  execute: SchedulerOptions<T>["execute"],
  limit = 4,
): SchedulerLike<T> {
  return new SchedulerImpl<T>({ limit, execute });
}

function request(
  id: string,
  declared: Partial<RequestEnvelope["declared"]> = {},
): RequestEnvelope {
  return {
    stage: "abel-implement",
    role: "implementation-worker",
    id,
    phase: "green",
    objective: `Complete ${id}`,
    roots: ["."],
    context: { agents: "root contract", contract: "approved task contract" },
    declared: {
      read: [],
      write: [],
      conflicts: [],
      resources: [],
      ...declared,
    },
    output: "diff",
    snapshot: {},
  };
}

function scheduled(
  id: string,
  options: {
    prerequisites?: string[];
    declared?: Partial<RequestEnvelope["declared"]>;
    mechanicalRedispatch?: boolean;
  } = {},
): ScheduledRequest {
  return {
    request: request(id, options.declared),
    prerequisites: options.prerequisites ?? [],
    mechanicalRedispatch: options.mechanicalRedispatch,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

function turn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("FIFO DAG-ready scheduling", () => {
  it("starts and settles a saturated queue in FIFO order exactly once", async () => {
    const starts: string[] = [];
    const calls = new Map<string, number>();
    const gates = {
      a: deferred<string>(),
      b: deferred<string>(),
      c: deferred<string>(),
    };
    const scheduler = createScheduler<string>(async (envelope) => {
      starts.push(envelope.id);
      calls.set(envelope.id, (calls.get(envelope.id) ?? 0) + 1);
      return gates[envelope.id as keyof typeof gates].promise;
    }, 1);

    const batch = scheduler.schedule("fifo", [
      scheduled("a"),
      scheduled("b"),
      scheduled("c"),
    ]);
    await turn();
    expect(starts).toEqual(["a"]);

    gates.a.resolve("A");
    expect(await batch.result("a")).toMatchObject({
      id: "a",
      status: "succeeded",
      attempts: 1,
      value: "A",
    });
    await turn();
    expect(starts).toEqual(["a", "b"]);

    gates.b.resolve("B");
    expect(await batch.result("b")).toMatchObject({
      id: "b",
      status: "succeeded",
      attempts: 1,
      value: "B",
    });
    await turn();
    expect(starts).toEqual(["a", "b", "c"]);

    gates.c.resolve("C");
    const outcomes = await batch.done;
    expect(outcomes.map((outcome) => outcome.id)).toEqual(["a", "b", "c"]);
    expect(outcomes.every((outcome) => outcome.status === "succeeded")).toBe(
      true,
    );
    expect(Object.fromEntries(calls)).toEqual({ a: 1, b: 1, c: 1 });
  });

  it("starts only DAG-ready work and admits a child after its prerequisite succeeds", async () => {
    const starts: string[] = [];
    const gates = {
      root: deferred<string>(),
      child: deferred<string>(),
      sibling: deferred<string>(),
    };
    const scheduler = createScheduler<string>(async (envelope) => {
      starts.push(envelope.id);
      return gates[envelope.id as keyof typeof gates].promise;
    }, 2);

    const batch = scheduler.schedule("dag", [
      scheduled("root"),
      scheduled("child", { prerequisites: ["root"] }),
      scheduled("sibling"),
    ]);
    await turn();
    expect(starts).toEqual(["root", "sibling"]);

    gates.root.resolve("accepted");
    await batch.result("root");
    await turn();
    expect(starts).toEqual(["root", "sibling", "child"]);

    gates.sibling.resolve("sibling");
    gates.child.resolve("child");
    expect((await batch.done).map((outcome) => outcome.status)).toEqual([
      "succeeded",
      "succeeded",
      "succeeded",
    ]);
  });

  it("enforces the global limit of four and rejects batches over eight", async () => {
    const starts: string[] = [];
    const gates = new Map(
      Array.from({ length: 9 }, (_, index) => [
        `task-${index}`,
        deferred<string>(),
      ]),
    );
    const scheduler = createScheduler<string>(async (envelope) => {
      starts.push(envelope.id);
      return gates.get(envelope.id)!.promise;
    });

    const batch = scheduler.schedule(
      "bounded",
      Array.from({ length: 5 }, (_, index) => scheduled(`task-${index}`)),
    );
    await turn();
    expect(starts).toEqual(["task-0", "task-1", "task-2", "task-3"]);

    gates.get("task-0")!.resolve("done");
    await batch.result("task-0");
    await turn();
    expect(starts).toEqual(["task-0", "task-1", "task-2", "task-3", "task-4"]);

    for (let index = 1; index < 5; index++) {
      gates.get(`task-${index}`)!.resolve("done");
    }
    await batch.done;

    expect(() =>
      scheduler.schedule(
        "too-large",
        Array.from({ length: 9 }, (_, index) => scheduled(`task-${index}`)),
      ),
    ).toThrow(/8|batch/i);
  });
});

describe("declared compatibility", () => {
  const serializationCases: Array<
    [
      string,
      Partial<RequestEnvelope["declared"]>,
      Partial<RequestEnvelope["declared"]>,
    ]
  > = [
    [
      "read/write intersection",
      { write: ["src/shared.ts"] },
      { read: ["src/shared.ts"] },
    ],
    [
      "declared conflict edge",
      { conflicts: ["right"] },
      { write: ["src/right.ts"] },
    ],
    [
      "shared resource",
      { resources: ["faux-provider"] },
      { resources: ["faux-provider"] },
    ],
    [
      "shared verification lock",
      { verificationLock: "affected-suite" },
      { verificationLock: "affected-suite" },
    ],
  ];

  it.each(serializationCases)(
    "serializes %s while allowing it after the active request settles",
    async (_name, leftDeclared, rightDeclared) => {
      const starts: string[] = [];
      const left = deferred<string>();
      const right = deferred<string>();
      const scheduler = createScheduler<string>(async (envelope) => {
        starts.push(envelope.id);
        return envelope.id === "left" ? left.promise : right.promise;
      }, 2);

      const batch = scheduler.schedule("compatibility", [
        scheduled("left", { declared: leftDeclared }),
        scheduled("right", { declared: rightDeclared }),
      ]);
      await turn();
      expect(starts).toEqual(["left"]);

      left.resolve("left");
      await batch.result("left");
      await turn();
      expect(starts).toEqual(["left", "right"]);

      right.resolve("right");
      expect((await batch.done).map((outcome) => outcome.status)).toEqual([
        "succeeded",
        "succeeded",
      ]);
    },
  );

  it("starts disjoint declarations concurrently", async () => {
    const starts: string[] = [];
    const left = deferred<string>();
    const right = deferred<string>();
    const scheduler = createScheduler<string>(async (envelope) => {
      starts.push(envelope.id);
      return envelope.id === "left" ? left.promise : right.promise;
    }, 2);

    const batch = scheduler.schedule("disjoint", [
      scheduled("left", {
        declared: {
          read: ["src/a.ts"],
          write: ["test/a.test.ts"],
          resources: ["resource-a"],
          verificationLock: "lock-a",
        },
      }),
      scheduled("right", {
        declared: {
          read: ["src/b.ts"],
          write: ["test/b.test.ts"],
          resources: ["resource-b"],
          verificationLock: "lock-b",
        },
      }),
    ]);
    await turn();
    expect(starts).toEqual(["left", "right"]);

    left.resolve("left");
    right.resolve("right");
    expect((await batch.done).map((outcome) => outcome.status)).toEqual([
      "succeeded",
      "succeeded",
    ]);
  });
});

describe("cancellation and branch isolation", () => {
  it("cancels an active request through its signal and prevents a queued closure from starting", async () => {
    const starts: string[] = [];
    const aborted: string[] = [];
    const scheduler = createScheduler<string>(
      (envelope, signal) =>
        new Promise<string>((resolve, reject) => {
          starts.push(envelope.id);
          const timer = setTimeout(() => resolve("late completion"), 50);
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              aborted.push(envelope.id);
              reject(signal.reason ?? new Error("cancelled"));
            },
            { once: true },
          );
        }),
      1,
    );

    const batch = scheduler.schedule("cancel-batch", [
      scheduled("active"),
      scheduled("queued"),
    ]);
    await turn();
    scheduler.cancel("cancel-batch");
    const outcomes = await batch.done;

    expect(starts).toEqual(["active"]);
    expect(aborted).toEqual(["active"]);
    expect(outcomes).toEqual([
      expect.objectContaining({ id: "active", status: "cancelled" }),
      expect.objectContaining({
        id: "queued",
        status: "cancelled",
        attempts: 0,
      }),
    ]);
    await turn();
    expect(starts).toEqual(["active"]);
  });

  it("cancelAll marks every batch before settlement can admit another queue", async () => {
    const starts: string[] = [];
    const active = deferred<string>();
    const scheduler = createScheduler<string>((envelope, signal) => {
      starts.push(envelope.id);
      if (envelope.id !== "active") return Promise.resolve("unexpected start");
      return new Promise<string>((resolve, reject) => {
        active.promise.then(resolve, reject);
        signal.addEventListener(
          "abort",
          () => reject(signal.reason ?? new Error("cancelled")),
          { once: true },
        );
      });
    }, 1);
    const first = scheduler.schedule("first", [scheduled("active")]);
    const second = scheduler.schedule("second", [scheduled("queued")]);
    await turn();

    const cancelAll = scheduler.cancelAll;
    expect(cancelAll).toBeTypeOf("function");
    await cancelAll?.call(scheduler);
    const outcomes = await Promise.all([first.done, second.done]);

    expect(starts).toEqual(["active"]);
    expect(outcomes.flat().map((outcome) => outcome.status)).toEqual([
      "cancelled",
      "cancelled",
    ]);
  });

  it("retains an independent sibling success when another branch fails", async () => {
    const calls = new Map<string, number>();
    const scheduler = createScheduler<string>(async (envelope) => {
      calls.set(envelope.id, (calls.get(envelope.id) ?? 0) + 1);
      if (envelope.id === "failed") throw new Error("mechanical failure");
      return "retained sibling";
    }, 2);

    const batch = scheduler.schedule("branches", [
      scheduled("failed", { mechanicalRedispatch: true }),
      scheduled("succeeded"),
    ]);
    const outcomes = await batch.done;
    expect(outcomes).toEqual([
      expect.objectContaining({
        id: "failed",
        status: "failed",
        attempts: 2,
      }),
      expect.objectContaining({
        id: "succeeded",
        status: "succeeded",
        value: "retained sibling",
      }),
    ]);
    expect(calls.get("failed")).toBe(2);
    expect(calls.get("succeeded")).toBe(1);
  });
});

describe("one identical mechanical redispatch", () => {
  it("permits one identical redispatch and never starts a third attempt", async () => {
    let recoveringCalls = 0;
    const recovering = createScheduler<string>(async () => {
      recoveringCalls++;
      if (recoveringCalls === 1) throw new Error("phase auth expired");
      return "fresh phase auth";
    }, 1);
    const recovered = await recovering
      .schedule("recover-once", [
        scheduled("worker", { mechanicalRedispatch: true }),
      ])
      .result("worker");
    expect(recovered).toMatchObject({
      status: "succeeded",
      attempts: 2,
      value: "fresh phase auth",
    });
    expect(recoveringCalls).toBe(2);

    let blockedCalls = 0;
    const blocked = createScheduler<string>(async () => {
      blockedCalls++;
      throw new Error("phase auth still expired");
    }, 1);
    const blockedOutcome = await blocked
      .schedule("block-after-redispatch", [
        scheduled("worker", { mechanicalRedispatch: true }),
      ])
      .result("worker");

    expect(blockedOutcome).toMatchObject({
      status: "failed",
      attempts: 2,
    });
    expect(blockedCalls).toBe(2);
    await turn();
    expect(blockedCalls).toBe(2);
  });
});
