/* Adapted from pi-web-ui message-delta.ts immutable same-message/block append.
 * MIT (c) 2026 xing-shuyin. Cadence consumes decoded immutable DetailPages,
 * not provider deltas, hidden thinking, usage or execution state. */
import type { ContentRef, DetailPage } from "../types";
export interface RetainedText {
  content: ContentRef;
  chunks: readonly string[];
  offset: number;
}
export function appendDetailPage(
  previous: RetainedText | null,
  page: DetailPage,
): RetainedText {
  const base = previous ?? { content: page.content, chunks: [], offset: 0 };
  const a = base.content,
    b = page.content;
  if (
    a.recordId !== b.recordId ||
    a.version !== b.version ||
    a.field !== b.field ||
    a.sha256 !== b.sha256 ||
    a.bytes !== b.bytes ||
    base.offset !== (page.range?.start ?? 0)
  )
    throw new Error("Noncontiguous immutable field");
  // New containers, preserved previous chunks; display accumulation never settles a run.
  return {
    ...base,
    chunks: [...base.chunks, page.text],
    offset: page.range?.end ?? 0,
  };
}
