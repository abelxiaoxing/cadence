/* Adapted from pi-web-ui/web/src/components/StreamMarkdown.tsx @ e8bab487af208bc9a1ab60a821652323f598127f.
 * Copyright (c) 2026 xing-shuyin. MIT; see licenses/pi-web-ui-MIT.txt.
 * Cadence: scoped presentation only; see provenance/webui-reuse.json. */
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { segmentStream, stepSmoothStream } from "../../rich/stream-markdown";
import { MarkdownBody } from "./Markdown";

/**
 * Prefix-cached streaming markdown renderer (see stream-markdown.ts for the
 * segmentation rules). Replaces the naive `<Markdown text={growingString}>`
 * during streaming, which re-parsed the whole document per delta — O(n²)
 * cumulative parse + highlight work that janks long code-heavy replies.
 *
 * Structure:
 *  - frozen[] segments: append-only complete blocks. Each is its own memoized
 *    <ReactMarkdown> keyed by stable index → parsed exactly ONCE ever; React
 *    reuses their DOM subtrees across frames (copy buttons don't remount).
 *  - active tail inside an unclosed fence: rendered as PLAIN code — no
 *    highlighting a growing block (that would be O(n²) within the block).
 *  - active tail otherwise: full markdown, throttled to ~200ms with a
 *    trailing-edge timer so the last text always renders.
 *
 * The parent switches to the authoritative one-shot <Markdown> at message end,
 * correcting any segmentation imperfection (setext headings, forward link
 * reference definitions) in the final render.
 */

/** One frozen segment: immutable input → parses exactly once thanks to memo. */
const FrozenSegment = memo(function FrozenSegment({ text }: { text: string }) {
  // Must go through MarkdownBody — the shared pipeline config (codeblock chrome +
  // safe code rendering). A bare <ReactMarkdown> here silently skipped mermaid.
  return <MarkdownBody text={text} />;
});

/** 恒定步进时间间隔（ms）：锚定约 45 步/秒的细腻节奏，防止在 120Hz/144Hz/240Hz 高刷屏上因 rAF 频率翻倍导致吐字过快。 */
const SMOOTH_PACE_MS = 22;
/** 余韵收尾（finishing）步进时间间隔（ms）：保持平滑加速的同时防止在高刷屏上瞬间闪完导致短思考无过程。 */
const FINISHING_PACE_MS = 14;

const isDocumentHidden = () =>
  typeof document !== "undefined" && document.hidden;

/**
 * 将网络层大段脉冲到达的流式文本，通过 requestAnimationFrame + 时间锚定熨平为
 * 恒定节奏逐字/微步连续流淌的字符串（接收时大段接收，渲染时逐字细腻丝滑渲染）。
 * - 首次挂载若非活跃流（!active）或已有超长历史文本（> 1500 字符，如刷新或切换会话），直接对齐现有长度；
 *   后台标签页（document.hidden）挂载或流式到达直接对齐现有长度，杜绝切回前台时多块同时补播文字流动画；
 *   活跃流中到达的 200~400 字短思考块一律从 0 开始平滑吐出，避免无过程直接全部显示；
 * - 支持 onSettled 回调：当缓冲池追平 targetText 时触发，供流结束余韵收尾（Graceful Tail Drain）无缝切回静态渲染。
 */
export function useSmoothStreamText(
  text: string,
  active = true,
  finishing = false,
  onSettled?: () => void,
): string {
  const [displayedLen, setDisplayedLen] = useState<number>(() =>
    !active || isDocumentHidden() || text.length > 1500 ? text.length : 0,
  );
  const targetRef = useRef(text);
  targetRef.current = text;
  const lenRef = useRef(displayedLen);
  lenRef.current = displayedLen;
  const finishingRef = useRef(finishing);
  finishingRef.current = finishing;
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleVisibility = () => {
      if (document.hidden) {
        // 切至后台：直接追平现有长度并结算，不堆积后台动画积压
        lenRef.current = targetRef.current.length;
        setDisplayedLen(targetRef.current.length);
        if (finishingRef.current || !active) {
          onSettledRef.current?.();
        }
      } else {
        // 切回前台：在后台期间收到的所有文字全部直接显示；
        // 若流已结束（finishing/非活跃），立即结算并不再播放文字流动画；
        // 若流仍在继续，已有文字直接就绪，后续新到 chunk 才平滑流淌。
        lenRef.current = targetRef.current.length;
        setDisplayedLen(targetRef.current.length);
        if (finishingRef.current || !active) {
          onSettledRef.current?.();
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, [active]);

  useEffect(() => {
    if (!active) {
      if (lenRef.current !== text.length) {
        lenRef.current = text.length;
        setDisplayedLen(text.length);
      }
      return;
    }
    if (isDocumentHidden()) {
      if (lenRef.current !== text.length) {
        lenRef.current = text.length;
        setDisplayedLen(text.length);
      }
      if (finishing || lenRef.current >= text.length) {
        onSettledRef.current?.();
      }
      return;
    }
    if (text.length < lenRef.current) {
      lenRef.current = text.length;
      setDisplayedLen(text.length);
      return;
    }
    if (lenRef.current >= text.length) {
      onSettledRef.current?.();
      return;
    }

    let raf = 0;
    let lastTickTime = 0;
    const tick = (now: number) => {
      const paceMs = finishingRef.current ? FINISHING_PACE_MS : SMOOTH_PACE_MS;
      if (lastTickTime > 0 && now - lastTickTime < paceMs) {
        raf = requestAnimationFrame(tick);
        return;
      }
      lastTickTime = now;
      const target = targetRef.current;
      const next = stepSmoothStream(
        target,
        lenRef.current,
        finishingRef.current,
      );
      if (next !== lenRef.current) {
        lenRef.current = next;
        setDisplayedLen(next);
      }
      if (next < target.length) {
        raf = requestAnimationFrame(tick);
      } else {
        onSettledRef.current?.();
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, active, finishing]);

  if (!active || displayedLen >= text.length) return text;
  return text.slice(0, displayedLen);
}

const LONG_TAIL_THRESHOLD = 600;
const LONG_TAIL_INTERVAL_MS = 32;

/** Active (still-growing) tail:
 *  - Normal paragraphs (< 600 chars) and fenced code render immediately at 60FPS
 *    alongside useSmoothStreamText's per-frame character pacer;
 *  - Extremely long unbroken single paragraphs (>= 600 chars) throttle to 32ms (~30FPS). */
function ActiveTail({ text, inFence }: { text: string; inFence: boolean }) {
  const isLong = !inFence && text.length >= LONG_TAIL_THRESHOLD;
  const [rendered, setRendered] = useState(text);
  const lastRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isLong) return;
    const elapsed = Date.now() - lastRef.current;
    const flush = () => {
      lastRef.current = Date.now();
      setRendered(text);
    };
    if (elapsed >= LONG_TAIL_INTERVAL_MS) {
      flush();
      return;
    }
    timerRef.current = setTimeout(flush, LONG_TAIL_INTERVAL_MS - elapsed);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [text, isLong]);

  if (inFence) {
    // Growing fenced code: plain <pre>, zero highlight cost while typing.
    return (
      <div className="codeblock">
        <pre>
          <code>{text}</code>
        </pre>
      </div>
    );
  }
  return <MarkdownBody text={isLong ? rendered : text} />;
}

export const StreamMarkdown = memo(function StreamMarkdown({
  text,
  finishing = false,
  onSettled,
}: {
  text: string;
  finishing?: boolean;
  onSettled?: () => void;
}) {
  const smoothed = useSmoothStreamText(text, true, finishing, onSettled);
  const { frozen, active, inFence } = useMemo(
    () => segmentStream(smoothed),
    [smoothed],
  );
  let offset = 0;
  const segments = frozen.map((text) => {
    const key = `stream-offset:${offset}`;
    offset += text.length;
    return { key, text };
  });
  return (
    <div className="md">
      {segments.map(({ text, key }) => (
        <FrozenSegment key={key} text={text} />
      ))}
      {/* key restarts the throttle whenever a block freezes — the fresh tail
			    renders immediately instead of waiting out the previous interval. */}
      {active.length > 0 && (
        <ActiveTail key={frozen.length} text={active} inFence={inFence} />
      )}
    </div>
  );
});
