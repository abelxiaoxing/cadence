/* Adapted from pi-web-ui/web/src/panel-sash.ts @ e8bab487af208bc9a1ab60a821652323f598127f.
 * Copyright (c) 2026 xing-shuyin. MIT; see licenses/pi-web-ui-MIT.txt.
 * Cadence: scoped presentation only; see provenance/webui-reuse.json. */
/**
 * 面板纵向分割（sash）纯计算 —— 与左栏 VSCode 风格分割同一套「权重」模型：
 * 各段用 flex-grow 权重按比例分配高度，拖动只改相邻两段的权重、总权重守恒，
 * 双击复位到默认权重。
 *
 * 这里只放可单测的数学与解析；量高度、挂 pointer 事件留在组件里
 * （见 `components/RightPanel.tsx`；左栏的等价逻辑目前内联在 `LeftPanel.tsx`）。
 */

/** 相邻两段的权重（above = 上方/前一段，below = 下方/后一段）。 */
interface SashPair {
  above: number;
  below: number;
}

/**
 * 解析持久化的权重（localStorage 里可能是旧版本、被手改或截断的 JSON）：
 * 逐键校验，非「有限正数」的键回落默认值，整体坏 JSON 则全量默认。
 */
export function parseWeights<T extends Record<string, number>>(
  raw: string | null,
  defaults: T,
): T {
  const out: Record<string, number> = { ...defaults };
  if (!raw) return out as T;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const key of Object.keys(defaults)) {
        const value = (parsed as Record<string, unknown>)[key];
        if (typeof value === "number" && Number.isFinite(value) && value > 0)
          out[key] = value;
      }
    }
  } catch {
    // 坏 JSON → 全量默认
  }
  return out as T;
}

interface SashDragInput {
  /** 开始拖动时的权重快照。 */
  start: SashPair;
  /** 指针纵向位移（向下为正，px）。 */
  deltaPx: number;
  /** 参与分配的可用高度（px）；面板被压缩到 0 时也安全。 */
  availablePx: number;
  /** 参与分配的总权重（含未拖动裁剪的其它段）。 */
  totalWeight: number;
  /** 上下两段的最小高度（px）。 */
  minAbovePx: number;
  minBelowPx: number;
}

/**
 * 拖动结果：两段权重总和守恒，且各自不小于最小像素；
 * 退化情形（可用高度为 0、两个最小值之和超过可用高度）不产生 NaN / 负数 / 抖动。
 */
export function applySashDrag(input: SashDragInput): SashPair {
  const pairTotal = input.start.above + input.start.below;
  const available = Math.max(1, input.availablePx);
  const totalWeight = input.totalWeight > 0 ? input.totalWeight : 1;
  const pxPerWeight = available / totalWeight;
  const minAboveWeight = input.minAbovePx / pxPerWeight;
  const minBelowWeight = input.minBelowPx / pxPerWeight;
  if (minAboveWeight + minBelowWeight >= pairTotal) {
    // 面板太矮：两个最小值已装不下（甚至重叠）→ 按最小像素比例折中，保证都为正且总量守恒
    const minTotal = input.minAbovePx + input.minBelowPx || 1;
    const above = (pairTotal * input.minAbovePx) / minTotal;
    return { above, below: pairTotal - above };
  }
  const above = Math.min(
    pairTotal - minBelowWeight,
    Math.max(minAboveWeight, input.start.above + input.deltaPx / pxPerWeight),
  );
  return { above, below: pairTotal - above };
}
