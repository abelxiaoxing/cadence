/* `cacheMetrics` is adapted from pi-web-ui web/src/cache-stats.ts @ 29bd28df;
 * MIT (c) 2026 xing-shuyin.
 * Cadence: the totals are the head read's observation of the whole session;
 * nothing here estimates a rate or counts streamed text. */
import type { ChatCache } from "../../../src/service/contracts/workbench.ts";

export interface CacheMetrics {
  /** Every input token the session's usage records state. */
  totalInput: number;
  miss: number;
  read: number;
  write: number;
  /** The share of the input read from the cache, 0 to 1. */
  hitRate: number;
}

/** A session's cache totals as shares of its input. */
export function cacheMetrics(cache: ChatCache): CacheMetrics {
  const miss = Math.max(0, cache.input),
    read = Math.max(0, cache.read),
    write = Math.max(0, cache.write);
  const totalInput = miss + read + write;
  return {
    totalInput,
    miss,
    read,
    write,
    hitRate: totalInput > 0 ? Math.min(read / totalInput, 1) : 0,
  };
}
