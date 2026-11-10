/* `formatTokens` is adapted from pi-web-ui web/src/format-tokens.ts @ b627452c;
 * MIT (c) 2026 xing-shuyin.
 * Cadence: the context size is the head read's observation and the window is
 * the catalog's; nothing here estimates, sums or polls. */
import type { ModelCandidate } from "../../../src/service/contracts/models.ts";
import type { ChatContext } from "../../../src/service/contracts/workbench.ts";

/** What the statusbar states about the open conversation's context. */
export interface ContextUsage {
  /** Tokens the branch's last completed model response reported; null when a
   * compaction followed it, so the size is unknown until the next response. */
  tokens: number | null;
  /** That model's context window, when its catalog entry states one. */
  window: number | null;
  provider: string;
  model: string;
}

/** The head read's context size beside the window of the model that reported
 * it. The reader states no window: only a catalog entry with the same provider
 * and model, stating a positive one, supplies it. */
export function contextUsage(
  context: ChatContext | undefined,
  entries: readonly ModelCandidate[] | undefined,
): ContextUsage | undefined {
  if (!context) return undefined;
  const window = entries?.find(
    (entry) =>
      entry.provider === context.provider && entry.model === context.model,
  )?.contextWindow;
  return {
    tokens: context.tokens,
    window: window && window > 0 ? window : null,
    provider: context.provider,
    model: context.model,
  };
}

/** `950`, `12.3K`, `1.2M`; a count that rounds up to a thousand K is 1M. */
export function formatTokens(n: number): string {
  const scaled = (value: number, unit: string) =>
    `${value.toFixed(1).replace(/\.0$/, "")}${unit}`;
  if (n >= 999_950) return scaled(n / 1_000_000, "M");
  if (n >= 1000) return scaled(n / 1000, "K");
  return String(n);
}

/** The whole percent of the window in use. More than the window is stated as
 * more than 100, never clamped into looking full but fine. */
export function contextPercent(tokens: number, window: number): number {
  return Math.round((tokens / window) * 100);
}
