/* Adapted from pi-web-ui/web/src/stream-markdown.ts @ e8bab487af208bc9a1ab60a821652323f598127f.
 * Copyright (c) 2026 xing-shuyin. MIT; see licenses/pi-web-ui-MIT.txt.
 * Cadence: scoped presentation only; see provenance/webui-reuse.json. */
/**
 * Streaming markdown segmentation — the core of the prefix-cache renderer.
 *
 * Problem: during streaming, the accumulated text changes on EVERY delta, so a
 * memoized full-document <Markdown text={...}> re-parses (remark → rehype →
 * highlight.js) the whole growing string per frame — O(n²) cumulative work
 * that visibly janks long code-heavy replies.
 *
 * Solution: split the text into FROZEN segments (complete, append-only blocks)
 * plus one ACTIVE tail. Frozen segment text never changes again, so each is
 * rendered by its own memoized <ReactMarkdown> exactly ONCE; only the small
 * active tail re-parses. At message end the parent does ONE authoritative
 * full-document parse, so any segmentation imperfection is transient.
 *
 * Splitting rules (CommonMark-aware enough for live preview):
 *  - Split points are blank lines OUTSIDE fenced code blocks.
 *  - An unclosed ```/~~~ fence keeps everything after its opener in the tail
 *    (half-rendered code as markdown would flash horribly on close).
 *  - A blank line followed by a list marker does NOT split: CommonMark treats
 *    blank-line-separated items as one (loose) list — splitting would restart
 *    ordered numbering at 1.
 *  - Setext headings / forward link-reference definitions across splits are
 *    accepted imperfections; the final full parse corrects them.
 *
 * Pure and dependency-free (unit-tested from tsconfig.tests.json).
 */

interface StreamSegments {
  /** Complete blocks — render once via memoized Markdown, keyed by index. */
  frozen: string[];
  /** The trailing (possibly incomplete) block — re-parsed as it grows. */
  active: string;
  /** True while `active` sits inside an unclosed fence — callers MUST NOT
   *  syntax-highlight it (highlighting a growing block is O(n²) again). */
  inFence: boolean;
}

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
const LIST_RE = /^\s{0,3}(?:[-*+]|\d{1,9}[.)])\s/;

function isBlank(line: string): boolean {
  return line.trim() === "";
}

/** Fence marker of a line, or null when the line does not open/close a fence. */
function fenceMarker(line: string): string | null {
  const m = FENCE_RE.exec(line);
  return m ? m[1] : null;
}

/**
 * Segment streaming markdown into frozen prefix + active tail.
 */
export function segmentStream(text: string): StreamSegments {
  const lines = text.split("\n");
  const frozen: string[] = [];
  let current: string[] = [];
  let fence: string | null = null; // opening marker of the open fence

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (fence !== null) {
      // Inside a fence: everything belongs to the same segment until the
      // matching closer (same char, at least as long) appears.
      const marker = fenceMarker(line);
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) {
        fence = null;
      }
      current.push(line);
      continue;
    }

    const marker = fenceMarker(line);
    if (marker && !isBlank(line)) {
      fence = marker;
      current.push(line);
      continue;
    }

    if (isBlank(line)) {
      // Candidate split point — BUT not when the next content line is a
      // list item (loose lists must stay in one segment).
      let j = i;
      while (j < lines.length && isBlank(lines[j])) j++;
      const nextIsList = j < lines.length && LIST_RE.test(lines[j]);
      if (!nextIsList && current.length > 0) {
        frozen.push(current.join("\n"));
        current = [];
        continue;
      }
      current.push(line);
      continue;
    }

    current.push(line);
  }

  return { frozen, active: current.join("\n"), inFence: fence !== null };
}

/**
 * 自适应平滑流式步进（Adaptive Smooth Stream Pacer）：
 * 解决上游 API / 反代将多个 token 合并为大段 chunk 下发时，前端一次性渲染整段
 * 造成的“一顿一顿蹦字”感（接收时大段接收，渲染时逐字/微步细腻丝滑吐出）。
 *
 * 算法（细腻慢速曲线）：
 *  - 根据待显示的缓冲积压字符数 `backlog = targetText.length - displayedLen` 动态计算单步字符数：
 *      · backlog <= 0   → 已追平，返回 targetText.length
 *      · backlog <= 32  → 每步推进 1 个字符（大幅拓宽单字细腻打字机区间）
 *      · backlog <= 90  → 每步推进 2 个字符（柔和双字匀速流淌）
 *      · backlog <= 240 → 每步推进 ceil(backlog / 28) 个字符（将大段文本拆分为约 28 步 ≈ 500ms 细腻流淌完毕）
 *      · backlog > 240  → 每步推进 ceil(backlog / 18) 个字符（长文爆发时平滑消化，兼顾细腻感与响应度）
 *  - UTF-16 代理对（Emoji / 扩展汉字）安全对齐：若步进落点恰好停在高位代理（0xD800..0xDBFF）上，
 *    自动多进 1 位，防止将双码元字符劈成两半产生乱码问号。
 */
export function stepSmoothStream(
  targetText: string,
  displayedLen: number,
  finishing = false,
): number {
  const targetLen = targetText.length;
  if (displayedLen >= targetLen) return targetLen;
  if (displayedLen < 0) displayedLen = 0;

  const backlog = targetLen - displayedLen;
  let step: number;
  if (finishing) {
    // 流已结束（模型响应已完成）：在 ~180ms（约 8 步）内柔顺快速排空剩余缓冲，绝不拖泥带水
    step =
      backlog <= 16
        ? Math.max(2, Math.ceil(backlog / 6))
        : Math.ceil(backlog / 8);
  } else if (backlog <= 32) {
    step = 1;
  } else if (backlog <= 90) {
    step = 2;
  } else if (backlog <= 240) {
    step = Math.ceil(backlog / 28);
  } else {
    step = Math.ceil(backlog / 18);
  }

  let nextLen = Math.min(targetLen, displayedLen + step);
  if (nextLen < targetLen) {
    const code = targetText.charCodeAt(nextLen - 1);
    if (code >= 0xd800 && code <= 0xdbff) {
      nextLen = Math.min(targetLen, nextLen + 1);
    }
  }
  return nextLen;
}
