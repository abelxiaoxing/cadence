import { expect, it } from "vitest";
import { ContractError } from "../src/service/contracts/core.ts";
import {
  PARALLEL,
  parallelLimit,
  settleLimited,
} from "../src/service/workflows.ts";

it("the execution limit is a tuning value: whole numbers from 1, capped, otherwise the default", () => {
  expect(parallelLimit({})).toBe(PARALLEL.default);
  expect(parallelLimit({ CADENCE_PARALLEL: "1" })).toBe(1);
  expect(parallelLimit({ CADENCE_PARALLEL: "6" })).toBe(6);
  expect(parallelLimit({ CADENCE_PARALLEL: "999" })).toBe(PARALLEL.maximum);
  for (const value of ["", "0", "-2", "2.5", "many", " 3", "03x"])
    expect(parallelLimit({ CADENCE_PARALLEL: value })).toBe(PARALLEL.default);
});

it("limited settlement keeps input order, never exceeds the limit and joins everything before reporting", async () => {
  let active = 0,
    peak = 0;
  const started: number[] = [];
  const task =
    (index: number, fail = false) =>
    async () => {
      started.push(index);
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setImmediate(resolve));
      active--;
      if (fail) throw new Error(`failed ${index}`);
      return index;
    };
  const all = await settleLimited(
    3,
    Array.from({ length: 8 }, (_, index) => task(index)),
  );
  expect(peak).toBe(3);
  expect(all.map((r) => (r.status === "fulfilled" ? r.value : "x"))).toEqual([
    0, 1, 2, 3, 4, 5, 6, 7,
  ]);

  // After the first rejection nothing new starts, and what had started is joined.
  started.length = 0;
  const partial = await settleLimited(2, [
    task(0),
    task(1, true),
    task(2),
    task(3),
    task(4),
  ]);
  expect(active).toBe(0);
  expect(started).not.toContain(4);
  expect(partial[0]).toMatchObject({ status: "fulfilled", value: 0 });
  expect(partial[1]).toMatchObject({ status: "rejected" });
  const firstRejection = partial.find((r) => r.status === "rejected");
  expect((firstRejection as PromiseRejectedResult).reason.message).toBe(
    "failed 1",
  );
  expect((partial[4] as PromiseRejectedResult).reason).toBeInstanceOf(
    ContractError,
  );
  expect(await settleLimited(4, [])).toEqual([]);
});
