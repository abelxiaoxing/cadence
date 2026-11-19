import {
  type ActivityDiscovery,
  decodeActivityDiscovery,
} from "../../../src/service/contracts/activity.ts";
import { observationRead, refusedAccess } from "./observation-read";

export async function readActivity(
  signal: AbortSignal,
): Promise<ActivityDiscovery> {
  return observationRead(
    "/workbench/v1/activity",
    signal,
    decodeActivityDiscovery,
  );
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
  invalidateEntry: (refusal?: string) => void,
  read = readActivity,
) {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  let value: ActivityDiscovery | undefined;
  let announcedEpoch: string | undefined;
  const tick = async () => {
    try {
      const next = await read(abort.signal);
      if (abort.signal.aborted) return;
      if (next.epoch !== epoch) {
        if (announcedEpoch !== next.epoch) {
          announcedEpoch = next.epoch;
          invalidateEntry();
        }
        throw new Error("stale");
      }
      announcedEpoch = undefined;
      value = next;
      publish(value, "");
    } catch (error) {
      if (abort.signal.aborted) return;
      const code = error instanceof Error ? error.message : "unavailable";
      if (refusedAccess(code)) {
        abort.abort();
        invalidateEntry(code);
        publish(undefined, code);
        return;
      }
      value = value ? staleActivity(value, Date.now()) : undefined;
      publish(value, code);
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
