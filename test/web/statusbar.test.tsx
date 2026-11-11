// The statusbar's connection latency and cache-hit items. Pure and SSR only.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type {
  ChatCache,
  WorkbenchRead,
  WorkbenchResult,
} from "../../src/service/contracts/workbench.ts";
import { cacheMetrics } from "../../web/src/client/cache-usage";
import { ConversationReader } from "../../web/src/client/conversation-reader";
import {
  LATENCY_WINDOW_MS,
  latencyOf,
  latencySample,
} from "../../web/src/client/latency";
import { LocaleProvider } from "../../web/src/i18n/locale";
import { CacheStatus } from "../../web/src/layout/CacheStatus";
import { ConnectionStatus } from "../../web/src/layout/StatusItem";

afterEach(() => vi.useRealTimers());
const ORIGIN = "https://cadence.example";
const PROJECT = "a".repeat(64);
const timing = (
  name: string,
  requestStart: number,
  responseStart: number,
  initiatorType = "fetch",
) => ({ name, initiatorType, requestStart, responseStart });

it("a latency sample is a fetch of this origin's service API, from the request leaving to the reply's first byte", () => {
  expect(
    latencySample(timing(`${ORIGIN}/api/v1/active-runs`, 1000, 1042.4), ORIGIN),
  ).toEqual({ at: 1042.4, ms: 42.400000000000091 });
  expect(
    latencySample(
      timing(
        `${ORIGIN}/projects/${PROJECT}/api/v1/workbench/read?request=%7B%7D`,
        10,
        25,
      ),
      ORIGIN,
    ),
  ).toEqual({ at: 25, ms: 15 });
  for (const entry of [
    // Assets, another origin, a non-fetch load and an untimed entry say nothing.
    timing(`${ORIGIN}/assets/cadence.js`, 10, 25),
    timing(`${ORIGIN}/projects/short/api/v1/session`, 10, 25),
    timing("https://elsewhere.example/api/v1/session", 10, 25),
    timing(`${ORIGIN}/api/v1/session`, 10, 25, "script"),
    timing(`${ORIGIN}/api/v1/session`, 0, 25),
    timing(`${ORIGIN}/api/v1/session`, 30, 25),
    timing("not a url", 10, 25),
  ])
    expect(latencySample(entry, ORIGIN), entry.name).toBeNull();
});

it("the latency is the fastest recent sample and nothing once every sample is old", () => {
  const samples = [
    { at: 1000, ms: 180.2 },
    { at: 2000, ms: 23.6 },
    { at: 3000, ms: 61 },
  ];
  expect(latencyOf(samples, 3000)).toBe(24);
  // The fastest one ages out before the slower one after it.
  expect(latencyOf(samples, 2000 + LATENCY_WINDOW_MS + 1)).toBe(61);
  expect(latencyOf(samples, 3000 + LATENCY_WINDOW_MS + 1)).toBeNull();
  expect(latencyOf([], 0)).toBeNull();
});

it.each(["en", "zh"] as const)(
  "%s: the connection item appends the latency with pi's tones and says how it was measured",
  (locale) => {
    const render = (latency: number | null, dot = "ok") =>
      renderToStaticMarkup(
        <LocaleProvider initial={locale}>
          <ConnectionStatus dot={dot} tip="Tip." latency={latency}>
            Chat ready
          </ConnectionStatus>
        </LocaleProvider>,
      );
    const fast = render(23);
    expect(fast).toContain('<span class="status-dot ok" aria-hidden="true">');
    // The statement is the live region; a new latency figure is not announced.
    expect(fast).toContain(
      '<span class="bar-item-text" role="status">Chat ready</span>',
    );
    expect(fast).toContain('<span class="status-latency ok">23ms</span>');
    expect(fast).toContain(
      locale === "zh" ? "网络延迟：23ms" : "Network latency: 23ms",
    );
    expect(fast).toContain("Tip.");
    expect(render(99)).toContain("status-latency ok");
    expect(render(100)).toContain("status-latency mid");
    expect(render(299)).toContain("status-latency mid");
    expect(render(300)).toContain("status-latency warn");
    // Without a figure the item is its statement alone.
    const unknown = render(null, "busy");
    expect(unknown).not.toContain("status-latency");
    expect(unknown).toContain('title="Tip."');
  },
);

it("cache metrics are shares of every input token the session's usage states", () => {
  expect(cacheMetrics({ input: 300, read: 10_000, write: 1200 })).toEqual({
    totalInput: 11_500,
    miss: 300,
    read: 10_000,
    write: 1200,
    hitRate: 10_000 / 11_500,
  });
  expect(cacheMetrics({ input: 0, read: 0, write: 0 }).hitRate).toBe(0);
});

it.each(["en", "zh"] as const)(
  "%s: the cache item states the hit share with pi's tones, and a dash without input tokens",
  (locale) => {
    const render = (cache?: ChatCache) =>
      renderToStaticMarkup(
        <LocaleProvider initial={locale}>
          <CacheStatus cache={cache} />
        </LocaleProvider>,
      );
    const hit = render({ input: 300, read: 10_000, write: 1200 });
    expect(hit).toContain('<b class="cache-pct ok">87.0%</b>');
    expect(hit).toContain(
      locale === "zh"
        ? "缓存命中：87.0% · 缓存读取 10K · 缓存写入 1.2K · 未命中 300（共 11.5K 输入 token） 按本会话全部用量记录累计，包含所有分支。"
        : "Cache hit: 87.0% · read 10K · write 1.2K · miss 300 (of 11.5K input tokens) Summed over every usage record of this session, on every branch.",
    );
    expect(hit).not.toContain("is-zero");
    expect(render({ input: 30, read: 70, write: 0 })).toContain("cache-pct ok");
    expect(render({ input: 31, read: 69, write: 0 })).toContain(
      "cache-pct mid",
    );
    expect(render({ input: 60, read: 40, write: 0 })).toContain(
      "cache-pct mid",
    );
    expect(render({ input: 61, read: 39, write: 0 })).toContain(
      "cache-pct warn",
    );
    // No totals, or totals of nothing: a dash, never 0%.
    for (const empty of [render(), render({ input: 0, read: 0, write: 0 })]) {
      expect(empty).toContain('<b class="cache-pct">—</b>');
      expect(empty).toContain("status-cache is-zero");
      expect(empty).not.toContain("%");
      expect(empty).toContain(
        locale === "zh" ? "还没有输入 token" : "state no input tokens yet",
      );
    }
  },
);

it("the reader carries the head read's cache totals across branches of the session and drops them when the head states none", async () => {
  vi.useFakeTimers();
  const id = crypto.randomUUID();
  let cache: ChatCache | undefined = { input: 1, read: 2, write: 3 };
  const client = {
    workbenchRead: async (request: WorkbenchRead) => {
      if (request.kind !== "conversation") throw Error(request.kind);
      const value: WorkbenchResult = {
        kind: "conversation",
        summary: null,
        leaf: null,
        continues: true,
        turns: 0,
        branches: 0,
        runs: [],
        attempt: null,
        ...(cache ? { cache } : {}),
      };
      return { kind: "ok" as const, value };
    },
  };
  const reader = new ConversationReader(client, id, () => {});
  expect(reader.view()).not.toHaveProperty("cache");
  reader.setActive(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(reader.view().cache).toEqual({ input: 1, read: 2, write: 3 });
  // The totals are the session's: choosing a branch keeps them until read again.
  reader.choose("11111111-1111-4111-8111-111111111111");
  expect(reader.view().cache).toEqual({ input: 1, read: 2, write: 3 });
  // An older service states none.
  cache = undefined;
  reader.refresh();
  await vi.advanceTimersByTimeAsync(0);
  expect(reader.view()).not.toHaveProperty("cache");
  reader.close();
});
