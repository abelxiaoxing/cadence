/* Adapted directly from pi-web-ui SearchBar.tsx DOM highlight/scroll helpers.
 * MIT (c) 2026 xing-shuyin. Selected retained field PAGE only, case-sensitive;
 * durable server search remains independent and can reach every retained page. */
export function collectRanges(root: HTMLElement, query: string): Range[] {
  const all: Range[] = [];
  const needle = query;
  if (!needle) return all;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const el = node.parentElement;
      // 跳过搜索栏自身，避免高亮输入框里的查询文本
      if (!el || el.closest(".search-bar")) return NodeFilter.FILTER_REJECT;
      // 折叠摘要行的命中走折叠层（collectFoldedHits），展开后转 DOM 命中
      if (el.closest(".msg-collapsed")) return NodeFilter.FILTER_REJECT;
      return (node.textContent ?? "").includes(needle)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const lower = node.textContent ?? "";
    // 只收消息气泡内的文本（[data-msg-id]），壳层文案（回到底部等）不参与命中
    if (!node.parentElement?.closest("[data-retained-field]")) continue;
    let idx = lower.indexOf(needle);
    while (idx !== -1) {
      const r = document.createRange();
      r.setStart(node, idx);
      r.setEnd(node, idx + needle.length);
      all.push(r);
      if (all.length === 1000) return all; // visual highlight bound, not a retained-history cutoff
      idx = lower.indexOf(needle, idx + needle.length);
    }
  }
  return all;
}

const highlights = new Map<string, Range[]>();
export function setHighlight(name: string, ranges: Range[]) {
  if (ranges.length) highlights.set(name, ranges);
  else highlights.delete(name);
  const active = name.endsWith("-active");
  name = active ? "cadence-page-active" : "cadence-page";
  ranges = [...highlights]
    .filter(([key]) => key.endsWith("-active") === active)
    .flatMap(([, value]) => value);
  const css = CSS as unknown as { highlights?: Map<string, unknown> };
  if (!css.highlights) return;
  if (ranges.length === 0) {
    css.highlights.delete(name);
    return;
  }
  // Highlight 构造器在旧 lib.dom 里没有类型，运行时按特性检测使用。
  const Ctor = (
    window as unknown as { Highlight?: new (...r: Range[]) => unknown }
  ).Highlight;
  if (Ctor) css.highlights.set(name, new Ctor(...ranges));
}

/** 从命中节点向容器方向收集带滚动的祖先（内 → 外）。 */
function collectScrollers(
  start: HTMLElement | null,
  end: HTMLElement,
): HTMLElement[] {
  const out: HTMLElement[] = [];
  let el = start;
  while (el && el !== end) {
    const cs = getComputedStyle(el);
    if (
      /(auto|scroll|hidden)/.test(cs.overflowY + cs.overflowX) &&
      (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)
    ) {
      out.push(el);
    }
    el = el.parentElement;
  }
  return out;
}

/** 命中词先在各内层滚动容器（tool 参数 / tool 输出 / bash 输出等自带滚动条的区域）
 *  里逐级居中——横纵两个方向都要滚：超长单行（ask_user_question 的 JSON 参数、
 *  bash 长行输出，white-space: pre 不换行）只在水平方向溢出，纵向“已可见”时
 *  绝不能跳过容器，否则词的 scrollLeft 永远停在 0、词被裁在视野外看不见。
 *  最内层先滚，reflow 后外层拿到更新后的坐标，最后再滚外层消息容器。
 *  保证「搜索到了」就一定看得见；区间已可见则不打扰。 */
export function scrollRangeIntoView(wrap: HTMLElement, range: Range) {
  const start = range.startContainer.parentElement as HTMLElement | null;
  for (const s of collectScrollers(start, wrap)) {
    const rr = range.getBoundingClientRect();
    const sr = s.getBoundingClientRect();
    if (rr.height <= 0 || rr.width <= 0) return;
    if (!(rr.top >= sr.top + 4 && rr.bottom <= sr.bottom - 4)) {
      s.scrollTop += rr.top - sr.top - (s.clientHeight - rr.height) / 2;
    }
    if (!(rr.left >= sr.left + 4 && rr.right <= sr.right - 4)) {
      s.scrollLeft += rr.left - sr.left - (s.clientWidth - rr.width) / 2;
    }
  }
  const rr = range.getBoundingClientRect();
  const wr = wrap.getBoundingClientRect();
  if (rr.height <= 0 || rr.width <= 0) return;
  // 外层消息容器：横纵都完整可见（留 6px 余量）才不打扰，避免相邻命中抖动
  const vVisible = rr.top >= wr.top + 6 && rr.bottom <= wr.bottom - 6;
  const hVisible = rr.left >= wr.left + 6 && rr.right <= wr.right - 6;
  if (vVisible && hVisible) return;
  if (!vVisible)
    wrap.scrollTop += rr.top - wr.top - (wr.height - rr.height) / 2;
  if (!hVisible) {
    wrap.scrollLeft += rr.left - wr.left - (wr.width - rr.width) / 2;
  }
}
