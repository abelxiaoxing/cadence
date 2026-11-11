/* Cadence: the service round trip, read from the timing of requests the page
 * already makes. It sends nothing and polls nothing: pi-web-ui times its
 * WebSocket hello and ping, and an ordinary Cadence conversation holds no
 * socket. */
import { useSyncExternalStore } from "react";

/** One finished API request: when its reply began, and how long after the
 * request was sent (both on the page's performance clock). */
export interface LatencySample {
  at: number;
  ms: number;
}
/** How long a sample counts, and how many are kept. */
export const LATENCY_WINDOW_MS = 60_000;
const LATENCY_SAMPLES = 20;

/** The sample one resource timing entry gives: only a fetch of this origin's
 * service API, from the request leaving to the reply's first byte. Connection
 * setup and queueing come before `requestStart`, so they are left out. */
export function latencySample(
  entry: Pick<
    PerformanceResourceTiming,
    "name" | "initiatorType" | "requestStart" | "responseStart"
  >,
  origin: string,
): LatencySample | null {
  if (entry.initiatorType !== "fetch") return null;
  let url: URL;
  try {
    url = new URL(entry.name);
  } catch {
    return null;
  }
  if (
    url.origin !== origin ||
    !/^(?:\/projects\/[a-f0-9]{64})?\/api\/v1\//.test(url.pathname) ||
    !(entry.requestStart > 0) ||
    !(entry.responseStart >= entry.requestStart)
  )
    return null;
  return {
    at: entry.responseStart,
    ms: entry.responseStart - entry.requestStart,
  };
}

/** The round trip the recent requests show, in whole milliseconds: the
 * fastest within the window, since a slower one adds the service's own work
 * for that request to the network's. Null when no sample is recent. */
export function latencyOf(
  samples: readonly LatencySample[],
  now: number,
): number | null {
  let best: number | null = null;
  for (const sample of samples)
    if (
      now - sample.at <= LATENCY_WINDOW_MS &&
      (best === null || sample.ms < best)
    )
      best = sample.ms;
  return best === null ? null : Math.round(best);
}

let samples: LatencySample[] = [];
let current: number | null = null;
let observer: PerformanceObserver | undefined;
let aging: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function publish(): void {
  const next = latencyOf(samples, performance.now());
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof PerformanceObserver !== "undefined") {
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const sample = latencySample(
            entry as PerformanceResourceTiming,
            location.origin,
          );
          if (sample) samples = [...samples.slice(1 - LATENCY_SAMPLES), sample];
        }
        publish();
      });
      observer.observe({ type: "resource", buffered: true });
      // A sample ages out even when no request follows it.
      aging = setInterval(publish, 5000);
    } catch {
      observer = undefined;
    }
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    observer?.disconnect();
    observer = undefined;
    clearInterval(aging);
    samples = [];
    current = null;
  };
}

/** The current round trip to the service in milliseconds, or null while no
 * recent request has shown one. */
export function useLatency(): number | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}
