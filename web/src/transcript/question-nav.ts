/* Adapted from pi-web-ui web/src/question-nav.ts @ b627452c; MIT (c) 2026
 * xing-shuyin. Unchanged logic: which questions get a bar on a rail of a given
 * height, the gap between bars, and whether the full list is needed. */

/** Bars are 3px tall; at least 4px apart they stay distinct, so a rail holds
 * one bar per 7px. A longer history is sampled evenly, always keeping the
 * active question, and `many` asks for the complete list beside the rail. */
export function questionNavLayout(
  count: number,
  height: number,
  activeIndex: number,
) {
  const available = Math.max(0, height);
  const capacity = Math.floor((available + 4) / 7);
  const visible = Math.min(count, capacity);
  const indices = Array.from({ length: visible }, (_, slot) => {
    const start = Math.floor((slot * count) / visible);
    const end = Math.floor(((slot + 1) * count) / visible) - 1;
    if (activeIndex >= start && activeIndex <= end) return activeIndex;
    return slot === visible - 1 ? end : start;
  });
  const gap =
    visible > 1 ? Math.min(27, (available - visible * 3) / (visible - 1)) : 0;
  return { indices, gap, many: count > visible || (visible > 1 && gap < 20) };
}
