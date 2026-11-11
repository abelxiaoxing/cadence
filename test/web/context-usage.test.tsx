// The statusbar's context item: the head read's context size beside the
// catalog's window for the model that reported it. Pure and SSR only.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { ModelCandidate } from "../../src/service/contracts/models.ts";
import type {
  ChatContext,
  WorkbenchRead,
  WorkbenchResult,
} from "../../src/service/contracts/workbench.ts";
import {
  contextPercent,
  contextUsage,
  formatTokens,
} from "../../web/src/client/context-usage";
import { ConversationReader } from "../../web/src/client/conversation-reader";
import { LocaleProvider } from "../../web/src/i18n/locale";
import { ContextStatus } from "../../web/src/layout/ContextStatus";

afterEach(() => vi.useRealTimers());
const entry = (
  provider: string,
  model: string,
  contextWindow?: number,
): ModelCandidate => ({
  provider,
  model,
  api: "openai-completions",
  thinking: [],
  eligibility: "candidate",
  ...(contextWindow === undefined ? {} : { contextWindow }),
});
const used = (tokens: number | null): ChatContext => ({
  tokens,
  provider: "local",
  model: "qwen",
});
const status = (
  usage: Parameters<typeof ContextStatus>[0]["usage"],
  locale: "en" | "zh" = "en",
) =>
  renderToStaticMarkup(
    <LocaleProvider initial={locale}>
      <ContextStatus usage={usage} />
    </LocaleProvider>,
  );

it("the window comes only from the catalog entry of the model that reported the size", () => {
  const entries = [
    entry("local", "other", 32_000),
    entry("remote", "qwen", 64_000),
    entry("local", "qwen", 200_000),
  ];
  expect(contextUsage(used(12_345), entries)).toEqual({
    tokens: 12_345,
    window: 200_000,
    provider: "local",
    model: "qwen",
  });
  // No entry, no stated window, or no catalog at all: tokens only.
  expect(contextUsage(used(12_345), entries.slice(0, 2))?.window).toBeNull();
  expect(
    contextUsage(used(12_345), [entry("local", "qwen")])?.window,
  ).toBeNull();
  expect(
    contextUsage(used(12_345), [entry("local", "qwen", 0)])?.window,
  ).toBeNull();
  expect(contextUsage(used(12_345), undefined)?.window).toBeNull();
  // An unknown size keeps its window; an absent observation states nothing.
  expect(contextUsage(used(null), entries)).toMatchObject({
    tokens: null,
    window: 200_000,
  });
  expect(contextUsage(undefined, entries)).toBeUndefined();
});
it("token counts are short and a percentage is never clamped into looking fine", () => {
  expect(formatTokens(0)).toBe("0");
  expect(formatTokens(950)).toBe("950");
  expect(formatTokens(1000)).toBe("1K");
  expect(formatTokens(12_345)).toBe("12.3K");
  expect(formatTokens(200_000)).toBe("200K");
  expect(formatTokens(999_949)).toBe("999.9K");
  expect(formatTokens(999_950)).toBe("1M");
  expect(formatTokens(1_250_000)).toBe("1.3M");
  expect(contextPercent(12_345, 200_000)).toBe(6);
  expect(contextPercent(210_000, 200_000)).toBe(105);
});
it("the statusbar item states tokens, the window and percentage when known, and says what the figure leaves out", () => {
  const known = status({
    tokens: 12_345,
    window: 200_000,
    provider: "local",
    model: "qwen",
  });
  // The figures as pi shows them: the tokens used, then the window.
  expect(known).toContain(
    '<span class="ctx-val">12.3K</span><span class="status-sep">/</span><span class="ctx-max">200K</span>',
  );
  // The ring repeats the figures for assistive technology, never replaces them.
  expect(known).toContain(
    'role="meter" aria-label="Context window in use" aria-valuemin="0" aria-valuemax="200000" aria-valuenow="12345" aria-valuetext="Context 12.3K / 200K · 6%"',
  );
  expect(known).toContain('class="ctx-ring ok"');
  expect(known).toContain('stroke-dashoffset="29.53"');
  expect(known).toContain(
    'title="Context 12.3K / 200K · 6%. Context size as of the last completed model response (local/qwen). Messages after that response are not counted."',
  );
  expect(known).not.toContain("is-zero");
  // The ring's tone follows the share in use: half, then four fifths.
  const share = (tokens: number) =>
    status({ tokens, window: 200_000, provider: "local", model: "qwen" });
  // (of the rounded percentage the title states).
  expect(share(98_000)).toContain('class="ctx-ring ok"');
  expect(share(100_000)).toContain('class="ctx-ring mid"');
  expect(share(158_000)).toContain('class="ctx-ring mid"');
  expect(share(160_000)).toContain('class="ctx-ring warn"');
  // More than the window is said, and the ring only fills.
  const over = share(210_000);
  expect(over).toContain("Context 210K / 200K · 105%");
  expect(over).toContain('<span class="ctx-val">210K</span>');
  expect(over).toContain('aria-valuenow="200000"');
  expect(over).toContain('stroke-dashoffset="0"');
  expect(over).toContain('class="ctx-ring warn"');
  // Without a window: tokens only, an empty ring, and the reason in the tooltip.
  const bare = status({
    tokens: 12_345,
    window: null,
    provider: "local",
    model: "qwen",
  });
  expect(bare).toContain('<span class="ctx-val">12.3K</span></span>');
  expect(bare).toContain("Context 12.3K tokens");
  expect(bare).not.toContain("%");
  expect(bare).not.toContain("meter");
  expect(bare).not.toContain("ctx-ring-fill");
  expect(bare).toContain("states no context window for this model");
  // After a compaction the size is unknown: never zero, never the old figure.
  const compacted = status({
    tokens: null,
    window: 200_000,
    provider: "local",
    model: "qwen",
  });
  expect(compacted).toContain("Context unknown after compaction");
  expect(compacted).toContain('<span aria-hidden="true">—</span>');
  expect(compacted).toContain("status-ctx is-zero");
  expect(compacted).not.toContain("meter");
  expect(compacted).not.toMatch(/\d+K/);
  expect(compacted).toContain("A compaction followed that response");
  // No observation at all is a dash that says so, not a figure.
  const absent = status(undefined);
  expect(absent).toContain("Context size not observed yet");
  expect(absent).toContain("status-ctx is-zero");
  expect(absent).not.toMatch(/ctx-val|ctx-ring-fill|meter|%/);
  const zh = status(
    { tokens: 12_345, window: 200_000, provider: "local", model: "qwen" },
    "zh",
  );
  expect(zh).toContain("上下文 12.3K / 200K · 6%");
  expect(zh).toContain("不包含那次回复之后的消息");
  expect(
    status(
      { tokens: null, window: null, provider: "local", model: "qwen" },
      "zh",
    ),
  ).toContain("压缩后上下文大小未知");
  expect(status(undefined, "zh")).toContain("尚未读取到上下文大小");
});
it("the reader carries the head read's context and drops it when the head states none", async () => {
  vi.useFakeTimers();
  const id = crypto.randomUUID();
  let context: ChatContext | undefined = used(4096);
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
        ...(context ? { context } : {}),
      };
      return { kind: "ok" as const, value };
    },
  };
  const reader = new ConversationReader(client, id, () => {});
  expect(reader.view().context).toBeUndefined();
  reader.setActive(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(reader.view().context).toEqual(used(4096));
  // An older service, or a branch with no model response in reach.
  context = undefined;
  reader.refresh();
  await vi.advanceTimersByTimeAsync(0);
  expect(reader.view()).not.toHaveProperty("context");
  // Another branch never shows the previous branch's figure meanwhile.
  context = used(null);
  reader.refresh();
  await vi.advanceTimersByTimeAsync(0);
  expect(reader.view().context).toEqual(used(null));
  reader.choose("11111111-1111-4111-8111-111111111111");
  expect(reader.view()).not.toHaveProperty("context");
  reader.close();
});
