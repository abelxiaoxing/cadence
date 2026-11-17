/* Adapted from pi-web-ui/web/src/stream-markdown.ts @ e8bab487af208bc9a1ab60a821652323f598127f.
 * Copyright (c) 2026 xing-shuyin. MIT; see licenses/pi-web-ui-MIT.txt.
 * Cadence: scoped presentation only; see provenance/webui-reuse.json. */
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import remarkBackslashMath from "./remark-backslash-math";

/** The same CommonMark/GFM/math syntax as MarkdownBody (without its expensive
 * HTML, KaTeX and highlighting stages). Boundaries come from the whole source
 * tree, not blank-line guesses: lists, quotes, code and math stay intact.
 * Reparse on content changes: new syntax can extend a container, close TeX
 * delimiters or resolve earlier references. Only unchanged prefixes are cached;
 * "frozen" is a rendering optimization, never a promise against new syntax. */
const parser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkBackslashMath);

type Block = ReturnType<typeof parser.parse>["children"][number];

interface StreamSegment {
  /** UTF-16 source offset, including indentation, not a trimmed-text count. */
  start: number;
  /** Exact source slice, including inter-block separators. */
  text: string;
}
interface StreamSegments {
  segments: StreamSegment[];
  /** Exact source slices for the workflow renderer's existing prefix/pacer. */
  frozen: string[];
  active: string;
  /** Only a standalone active fenced-code block may use a plain preview. */
  inFence: boolean;
}

function needsDocumentContext(node: {
  type: string;
  children?: readonly { type: string }[];
}): boolean {
  // Definitions may live inside any container. Include references as well as
  // definitions so the entire dependency region shares resolution, footnote
  // numbering/backlinks and ONE footer at the document's end. All earlier
  // top-level nodes are independent; keeping them separate preserves their
  // components when a later definition first resolves an earlier reference.
  return (
    node.type === "definition" ||
    node.type === "linkReference" ||
    node.type === "imageReference" ||
    node.type === "footnoteDefinition" ||
    node.type === "footnoteReference" ||
    (node.children?.some(needsDocumentContext) ?? false)
  );
}

/** This flag only preserves the workflow caller's no-highlight preview policy;
 * it does NOT decide segmentation. The parser has already identified code. */
function openFence(block: Block | undefined, source: string): boolean {
  if (block?.type !== "code") return false;
  const lines = source.split(/\r\n|\r|\n/);
  const opener = /^ {0,3}(`{3,}|~{3,})/.exec(lines[0]);
  if (!opener) return false; // Indented code, not a fence.
  const marker = opener[1];
  return !lines.slice(1).some((line) => {
    const closer = /^ {0,3}(`{3,}|~{3,})[\t ]*$/.exec(line);
    return (
      closer && closer[1][0] === marker[0] && closer[1].length >= marker.length
    );
  });
}

/** Partition the original source at independently parseable top-level roots.
 * From the first document-dependent root onward, conservatively parse together.
 * Every delimiter/indent/CRLF is retained, so legacy callers summing these
 * strings' lengths also get real source offsets. Terminal state is irrelevant. */
export function segmentStream(text: string): StreamSegments {
  const { children } = parser.parse(text);
  const starts = text ? [0] : [];
  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    const point = node.position?.start;
    // Start at the source LINE boundary: dropping indentation changes code,
    // list and math semantics. The first slice also retains leading blanks.
    if (i > 0 && point?.offset !== undefined)
      starts.push(point.offset - (point.column - 1));
    if (needsDocumentContext(node)) break;
  }
  const segments = starts.map((start, i) => ({
    start,
    text: text.slice(start, starts[i + 1]),
  }));
  const active = segments.at(-1)?.text ?? "";
  const last = children.at(-1);
  const inFence =
    segments.length === children.length &&
    openFence(last, text.slice(last?.position?.start.offset));
  return {
    segments,
    frozen: segments.slice(0, -1).map((part) => part.text),
    active,
    inFence,
  };
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
