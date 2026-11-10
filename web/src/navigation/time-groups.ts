/* Adapted from pi-web-ui web/src/components/LeftPanel.tsx groupSessionsByTime
 * @ b627452c; MIT (c) 2026 xing-shuyin.
 * Cadence: groups the conversations already listed by the local calendar day of
 * their last modification (today, yesterday, earlier). It reads nothing and
 * keeps each group's listed order. */

export type TimeGroupKey = "today" | "yesterday" | "earlier";
export interface TimeGroup<T> {
  key: TimeGroupKey;
  items: T[];
}
const ORDER: readonly TimeGroupKey[] = ["today", "yesterday", "earlier"];

/** Which day a time (epoch milliseconds) belongs to. An unknown time (0) is
 * earlier, and one ahead of this browser's clock still counts as today. */
export function timeGroupOf(
  time: number,
  now: number = Date.now(),
): TimeGroupKey {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  if (time >= day.getTime()) return "today";
  // Calendar arithmetic, not 24 hours: a daylight-saving day is not that long.
  day.setDate(day.getDate() - 1);
  return time >= day.getTime() ? "yesterday" : "earlier";
}

export function groupByTime<T>(
  items: readonly T[],
  at: (item: T) => number,
  now: number = Date.now(),
): TimeGroup<T>[] {
  const groups = new Map<TimeGroupKey, T[]>();
  for (const item of items) {
    const key = timeGroupOf(at(item), now);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return ORDER.flatMap((key) => {
    const group = groups.get(key);
    return group ? [{ key, items: group }] : [];
  });
}

/** A case-insensitive match of a typed filter against a listed title. */
export function matchesFilter(title: string, filter: string): boolean {
  const query = filter.trim().toLowerCase();
  return !query || title.toLowerCase().includes(query);
}

/** A row's time: the clock time within today and yesterday (the group names
 * the day), otherwise the date, with its year once that differs. */
export function rowTime(
  time: number,
  locale: string,
  now: number = Date.now(),
): string {
  const date = new Date(time);
  if (timeGroupOf(time, now) !== "earlier")
    return date.toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  return date.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === new Date(now).getFullYear()
      ? {}
      : { year: "numeric" }),
  });
}
