import { describe, expect, it } from "vitest";

let usage: typeof import("../src/child-session") | null = null;
try {
  usage = await import("../src/child-session");
} catch {
  usage = null;
}
const notReady = (name: string): never =>
  expect.fail(`not_ready: ${name} is not implemented`);

const u = (totalTokens: number) => ({
  input: totalTokens,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

describe("unique nested usage aggregation", () => {
  it("aggregates each completed message id exactly once", () => {
    if (!usage) return notReady("usage aggregation");
    const agg = new usage.UsageAggregator();
    expect(agg.add("m1", u(5))).toBe(true);
    expect(agg.add("m1", u(5))).toBe(false);
    expect(agg.add("m2", u(7))).toBe(true);
    expect(agg.total().totalTokens).toBe(12);
  });

  it("is associative over unique messages and does not replay prior phases", () => {
    if (!usage) return notReady("usage aggregation");
    const left = new usage.UsageAggregator();
    left.add("a", u(2));
    left.add("b", u(3));
    left.add("c", u(4));
    const right = new usage.UsageAggregator();
    right.add("c", u(4));
    right.add("a", u(2));
    right.add("b", u(3));
    expect(left.total()).toEqual(right.total());
    const before = left.total();
    expect(left.add("a", u(99))).toBe(false);
    expect(left.total()).toEqual(before);
  });
});
