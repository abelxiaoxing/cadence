/** Admission by host capacity: pure ordering and arithmetic, no processes. */
import { expect, it } from "vitest";
import {
  HOST_COST,
  HOST_RESERVE_BYTES,
  HOST_WARMUP_MS,
  HostCapacity,
} from "../src/service/host-capacity.ts";

const GIB = 1024 ** 3;
const never = new AbortController().signal;
function fixture(cores = 8, memory = 64 * GIB) {
  const host = { cores, memory, now: 1000 };
  const capacity = new HostCapacity(
    {
      cores: () => host.cores,
      memory: () => host.memory,
    },
    () => host.now,
  );
  const started: string[] = [];
  const open = new Map<string, () => void>();
  /** Starts a step that stays running until `finish(name)`. */
  const step = (
    name: string,
    cost: (typeof HOST_COST)[keyof typeof HOST_COST],
    signal = never,
    queued?: (ahead: number) => void,
  ) =>
    capacity.run(
      cost,
      signal,
      () =>
        new Promise<void>((resolve) => {
          started.push(name);
          open.set(name, resolve);
        }),
      queued,
    );
  const finish = async (name: string) => {
    open.get(name)?.();
    open.delete(name);
    await new Promise((resolve) => setImmediate(resolve));
  };
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return { host, capacity, started, step, finish, settle };
}

it("admits as many steps as the cores allow and queues the rest in arrival order", async () => {
  const f = fixture(8);
  const all = [
    f.step("heavy-1", HOST_COST.heavy),
    f.step("heavy-2", HOST_COST.heavy),
    f.step("heavy-3", HOST_COST.heavy),
    f.step("light-1", HOST_COST.light),
  ];
  await f.settle();
  // Two heavy steps fill eight cores. The light one would fit beside nothing
  // and must not overtake the heavy step that arrived before it.
  expect(f.started).toEqual(["heavy-1", "heavy-2"]);
  await f.finish("heavy-1");
  expect(f.started).toEqual(["heavy-1", "heavy-2", "heavy-3"]);
  await f.finish("heavy-2");
  expect(f.started).toEqual(["heavy-1", "heavy-2", "heavy-3", "light-1"]);
  await f.finish("heavy-3");
  await f.finish("light-1");
  await Promise.all(all);
});
it("nothing is refused: any number of steps wait and every one runs", async () => {
  const f = fixture(2);
  const steps = Array.from({ length: 300 }, (_, i) =>
    f.step(`s${i}`, HOST_COST.light),
  );
  await f.settle();
  expect(f.started).toHaveLength(2);
  for (let i = 0; i < 300; i++) await f.finish(`s${i}`);
  await Promise.all(steps);
  expect(f.started).toEqual(Array.from({ length: 300 }, (_, i) => `s${i}`));
});
it("one step always runs, even on a host smaller than the step", async () => {
  const f = fixture(1, 0);
  const first = f.step("heavy", HOST_COST.heavy);
  const second = f.step("light", HOST_COST.light);
  await f.settle();
  expect(f.started).toEqual(["heavy"]);
  await f.finish("heavy");
  expect(f.started).toEqual(["heavy", "light"]);
  await f.finish("light");
  await Promise.all([first, second]);
});
it("available memory is read at every decision", async () => {
  const f = fixture(16, HOST_COST.heavy.bytes + HOST_RESERVE_BYTES);
  const a = f.step("a", HOST_COST.heavy);
  f.host.memory = HOST_COST.heavy.bytes + HOST_RESERVE_BYTES - 1;
  const b = f.step("b", HOST_COST.heavy);
  await f.settle();
  // Cores are free, memory is not: the second step waits.
  expect(f.started).toEqual(["a"]);
  f.host.memory = 64 * GIB;
  await f.finish("a");
  expect(f.started).toEqual(["a", "b"]);
  await f.finish("b");
  await Promise.all([a, b]);
});
it("a waiting step learns how many are ahead; one that starts at once is not told", async () => {
  const f = fixture(1);
  const told: number[] = [];
  const queued = (ahead: number) => told.push(ahead);
  const a = f.step("a", HOST_COST.light, never, queued);
  const b = f.step("b", HOST_COST.light, never, queued);
  const c = f.step("c", HOST_COST.light, never, queued);
  await f.settle();
  expect(told).toEqual([0, 1]);
  for (const name of ["a", "b", "c"]) await f.finish(name);
  await Promise.all([a, b, c]);
});
it("aborting a waiting step gives its turn to the next; a running step is not interrupted", async () => {
  const f = fixture(1);
  const running = new AbortController();
  const a = f.step("a", HOST_COST.light, running.signal);
  const waiting = new AbortController();
  const b = expect(
    f.step("b", HOST_COST.light, waiting.signal),
  ).rejects.toThrow("stale");
  const c = f.step("c", HOST_COST.light);
  waiting.abort();
  await b;
  running.abort();
  await f.settle();
  expect(f.started).toEqual(["a"]);
  await f.finish("a");
  expect(f.started).toEqual(["a", "c"]);
  await f.finish("c");
  await Promise.all([a, c]);
  await expect(f.step("d", HOST_COST.light, waiting.signal)).rejects.toThrow(
    "stale",
  );
});
it("a step that throws gives its room back", async () => {
  const f = fixture(1);
  await expect(
    f.capacity.run(HOST_COST.heavy, never, async () => {
      throw new Error("boom");
    }),
  ).rejects.toThrow("boom");
  const next = f.step("next", HOST_COST.heavy);
  await f.settle();
  expect(f.started).toEqual(["next"]);
  await f.finish("next");
  await next;
});
it("holds warmup memory for newly admitted bursts without double-counting once live OS memory takes over", async () => {
  // 16 cores, 5 GiB free: room for two 2 GiB heavy steps plus 1 GiB reserve,
  // never four on the same tick before they allocate RSS.
  const f = fixture(16, 5 * GIB);
  const steps = [1, 2, 3, 4].map((i) => f.step(`h${i}`, HOST_COST.heavy));
  await f.settle();
  expect(f.started).toEqual(["h1", "h2"]);
  // Once the warmup window elapses, live OS memory governs: if h1/h2 only
  // used 0.5 GiB total (4.5 GiB still free), h3 is admitted without double-
  // counting h1/h2's 4 GiB estimate.
  f.host.now += HOST_WARMUP_MS;
  f.host.memory = 4.5 * GIB;
  // Trigger pump by aborting a dummy waiter or finishing h1; here advance via
  // finishing h1 would free h1, so instead enqueue and abort a tiny step?
  // Wait: verify h3 stays queued if real memory dropped, then admits when free.
  f.host.memory = 2 * GIB;
  const probeAbort = new AbortController();
  const poke = f.step("poke", HOST_COST.light, probeAbort.signal);
  probeAbort.abort();
  await expect(poke).rejects.toThrow("stale");
  expect(f.started).toEqual(["h1", "h2"]);
  f.host.memory = 4.5 * GIB;
  const poke2Abort = new AbortController();
  const poke2 = f.step("poke2", HOST_COST.light, poke2Abort.signal);
  poke2Abort.abort();
  await expect(poke2).rejects.toThrow("stale");
  expect(f.started).toEqual(["h1", "h2", "h3"]);
  for (const name of ["h1", "h2", "h3", "h4"]) await f.finish(name);
  await Promise.all(steps);
});
