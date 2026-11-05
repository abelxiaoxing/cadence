/** Adapted from gotgenes/pi-packages @ 52854c12d590142e61a4f6a6947be9084035300d.
 * MIT; see licenses/pi-subagents-MIT.txt and provenance/agent-browser-reuse.json. */
/**
 * labeled-rule.ts — a full-width horizontal rule with labels embedded in it, in
 * the style of Pi's editor border (`── ⠋ Working ─────`).
 *
 * `── <left> ─────── <right> ──`: the left label follows a two-dash lead-in, the
 * optional right label precedes a two-dash trailer, and dashes fill the gap.
 * Labels arrive already styled; `paint` colours only the rule's own characters,
 * so a caller can tint the rule without re-colouring the text it carries.
 *
 * Each label is a list of fallbacks in preference order. The right label is
 * dropped before the left one falls back, and when no left candidate fits, the
 * last is truncated with an ellipsis. The result always spans exactly `width`
 * columns: pi-tui rejects a wider row, and a narrower one leaves the rule short.
 */

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const LEAD = "── ";
const TRAIL = " ──";
const DASH = "─";

/** Paint a rule of exactly `width` columns carrying the first labels that fit. */
export function labeledRule(
  width: number,
  paint: (rule: string) => string,
  left: readonly string[],
  right: readonly string[] = [],
): string {
  for (const leftLabel of left) {
    for (const rightLabel of [...right, undefined]) {
      if (fits(width, leftLabel, rightLabel))
        return compose(width, paint, leftLabel, rightLabel);
    }
  }
  const lastLeft = left.at(-1) ?? "";
  // Leave room for the lead-in, the space after the label, and one dash.
  const truncated = truncateToWidth(
    lastLeft,
    Math.max(0, width - LEAD.length - 2),
    "…",
  );
  return compose(width, paint, truncated, undefined);
}

/** Whether both labels fit with at least one dash of fill between them. */
function fits(width: number, left: string, right: string | undefined): boolean {
  return LEAD.length + visibleWidth(left) + 1 + 1 + rightWidth(right) <= width;
}

function compose(
  width: number,
  paint: (rule: string) => string,
  left: string,
  right: string | undefined,
): string {
  const fill = DASH.repeat(
    Math.max(
      1,
      width - LEAD.length - visibleWidth(left) - 1 - rightWidth(right),
    ),
  );
  const tail =
    right === undefined
      ? paint(` ${fill}`)
      : `${paint(` ${fill} `)}${right}${paint(TRAIL)}`;
  return `${paint(LEAD)}${left}${tail}`;
}

/** Columns the right label costs, including its leading space and the trailer. */
function rightWidth(right: string | undefined): number {
  return right === undefined ? 0 : 1 + visibleWidth(right) + TRAIL.length;
}
