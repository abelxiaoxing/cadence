/** Pure background-agent panel model: bus events, store and formatting. */
import { describe, expect, it, vi } from "vitest";
import {
  SUBAGENT_EVENTS as E,
  formatElapsed,
  formatTokens,
  MAX_MESSAGES,
  SubagentStore,
} from "../src/agent-panel-model.ts";

function store(start = 1000) {
  let now = start;
  const s = new SubagentStore(() => now);
  return {
    s,
    at(t: number) {
      now = t;
    },
  };
}

describe("subagent store", () => {
  it("tracks start, activity, stats and end for each id", () => {
    const { s, at } = store();
    const changed = vi.fn();
    s.subscribe(changed);
    s.apply(E.start, { id: "a", label: "Analyze A", kind: "Explore" });
    s.apply(E.start, { id: "b", label: "Analyze B", kind: "Explore" });
    at(2000);
    s.apply(E.activity, {
      id: "a",
      activity: "Reading\nindex.ts",
      tokensIn: 5,
    });
    s.apply(E.stats, { id: "a", tokensIn: 110_900, tokensOut: 2100 });
    at(5000);
    s.apply(E.end, { id: "b", status: "error", error: "boom" });
    expect(s.size).toBe(2);
    expect(s.running()).toBe(1);
    expect(s.ordered().map((a) => a.id)).toEqual(["a", "b"]);
    expect(s.get("a")).toMatchObject({
      status: "running",
      activity: "Reading index.ts",
      tokensIn: 110_900,
      tokensOut: 2100,
      startedAt: 1000,
      activeAt: 2000,
    });
    expect(s.get("b")).toMatchObject({
      status: "error",
      error: "boom",
      endedAt: 5000,
    });
    expect(changed).toHaveBeenCalledTimes(5);
  });

  it("ignores malformed, unknown, duplicate and post-end events", () => {
    const { s } = store();
    const changed = vi.fn();
    s.subscribe(changed);
    for (const data of [null, 1, [], {}, { id: "" }, { id: 3 }])
      expect(s.apply(E.start, data)).toBe(false);
    expect(s.apply(E.activity, { id: "ghost", activity: "x" })).toBe(false);
    s.apply(E.start, { id: "a", label: "first", startedAt: 10 });
    expect(s.apply(E.start, { id: "a", label: "second" })).toBe(false);
    expect(s.apply(E.end, { id: "a", status: "finished" })).toBe(false);
    expect(s.apply(E.message, { id: "a", message: "text" })).toBe(false);
    expect(s.apply(E.stats, { id: "a", tokensIn: -1 })).toBe(false);
    expect(s.apply("subagent:other", { id: "a" })).toBe(false);
    expect(s.apply(E.end, { id: "a", status: "done", endedAt: 5 })).toBe(true);
    expect(s.get("a")?.endedAt).toBe(10);
    expect(s.apply(E.end, { id: "a", status: "error" })).toBe(false);
    expect(s.apply(E.activity, { id: "a", activity: "late" })).toBe(false);
    // Final messages and stats can still arrive after end.
    expect(s.apply(E.stats, { id: "a", tokensIn: 7 })).toBe(true);
    expect(s.get("a")).toMatchObject({ label: "first", status: "done" });
    expect(changed).toHaveBeenCalledTimes(3);
  });

  it("strips terminal controls from one-line fields", () => {
    const { s } = store();
    s.apply(E.start, { id: "a", label: "\x1b[2Jlabel\r\nnext", kind: "K\x07" });
    expect(s.get("a")).toMatchObject({ label: "[2Jlabel next", kind: "K" });
  });

  it("appends messages and replaces a streaming tail", () => {
    const { s } = store();
    s.apply(E.start, { id: "a" });
    s.apply(E.message, { id: "a", message: { role: "user", content: "go" } });
    s.apply(E.message, {
      id: "a",
      message: { role: "assistant", content: [] },
      streaming: true,
    });
    s.apply(E.message, {
      id: "a",
      message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
      streaming: true,
    });
    expect(s.get("a")?.messages).toHaveLength(2);
    s.apply(E.message, {
      id: "a",
      message: { role: "assistant", content: [{ type: "text", text: "hi!" }] },
    });
    s.apply(E.message, { id: "a", message: { role: "toolResult" } });
    const a = s.get("a")!;
    expect(a.streaming).toBe(false);
    expect(a.revision).toBe(5);
    expect(a.messages.map((m) => (m as { role: string }).role)).toEqual([
      "user",
      "assistant",
      "toolResult",
    ]);
  });

  it("bounds retained messages and counts the omitted ones", () => {
    const { s } = store();
    s.apply(E.start, { id: "a" });
    for (let i = 0; i < MAX_MESSAGES + 3; i++)
      s.apply(E.message, {
        id: "a",
        message: { role: "user", content: `${i}` },
      });
    const a = s.get("a")!;
    expect(a.messages).toHaveLength(MAX_MESSAGES);
    expect(a.omitted).toBe(3);
    expect(a.messages[0]).toEqual({ role: "user", content: "3" });
  });
});

describe("formatting", () => {
  it("formats elapsed time", () => {
    expect(formatElapsed(-5)).toBe("0s");
    expect(formatElapsed(43_999)).toBe("43s");
    expect(formatElapsed(60_000)).toBe("1m 0s");
    expect(formatElapsed(283_000)).toBe("4m 43s");
    expect(formatElapsed(3_599_999)).toBe("59m 59s");
    expect(formatElapsed(3_720_000)).toBe("1h 02m");
    expect(formatElapsed(36_000_000)).toBe("10h 00m");
  });
  it("formats token counts", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1000)).toBe("1.0k");
    expect(formatTokens(110_940)).toBe("110.9k");
    expect(formatTokens(999_949)).toBe("999.9k");
    expect(formatTokens(999_950)).toBe("1.0M");
    expect(formatTokens(1_234_567)).toBe("1.2M");
  });
});
