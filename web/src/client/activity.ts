import { abortScope } from "../../../src/abort-scope.ts";
import {
  type ActivityDiscovery,
  decodeActivityDiscovery,
} from "../../../src/service/contracts/activity.ts";
import { errorCode, readJson } from "./service";

export async function readActivity(
  signal: AbortSignal,
): Promise<ActivityDiscovery> {
  const scope = abortScope([signal], 12000);
  try {
    const response = await fetch("/workbench/v1/activity", {
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
      signal: scope.signal,
    });
    const value = await readJson(response);
    if (!response.ok) throw new Error(errorCode(value));
    return decodeActivityDiscovery(value);
  } finally {
    scope.dispose();
  }
}
/** After a failed observation, retained rows are never presented as current and
 * disappear after the short uncertainty window; the failure notice remains. */
export function staleActivity(
  value: ActivityDiscovery,
  now: number,
): ActivityDiscovery {
  return {
    ...value,
    completeness: "partial",
    unavailable: Math.max(1, value.unavailable),
    projects: value.projects
      .map((p) => ({
        ...p,
        activities: p.activities
          .filter((a) => now - a.observedAt <= 120000)
          .map((a) => ({ ...a, freshness: "unknown" as const })),
      }))
      .filter((p) => p.activities.length),
  };
}

/** One cancellable, serialized subscription per mounted workbench. Late replies
 * after navigation/unmount never publish into a new identity. */
export function observeActivity(
  epoch: string,
  publish: (value: ActivityDiscovery | undefined, error: string) => void,
  changedEpoch: () => void,
  read = readActivity,
) {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  let value: ActivityDiscovery | undefined;
  const tick = async () => {
    try {
      const next = await read(abort.signal);
      if (abort.signal.aborted) return;
      if (next.epoch !== epoch) {
        changedEpoch();
        throw new Error("stale");
      }
      value = next;
      publish(value, "");
    } catch (error) {
      if (abort.signal.aborted) return;
      value = value ? staleActivity(value, Date.now()) : undefined;
      publish(value, error instanceof Error ? error.message : "unavailable");
    } finally {
      if (!abort.signal.aborted) timer = setTimeout(tick, 3000);
    }
  };
  void tick();
  return () => {
    abort.abort();
    clearTimeout(timer);
  };
}
