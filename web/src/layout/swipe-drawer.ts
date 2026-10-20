/* Adapted from pi-web-ui/web/src/swipe-drawer.ts @ e8bab487af208bc9a1ab60a821652323f598127f.
 * Copyright (c) 2026 xing-shuyin. MIT; see licenses/pi-web-ui-MIT.txt.
 * Cadence: scoped presentation only; see provenance/webui-reuse.json. */
/**
 * 手机端侧栏抽屉的横滑手势 —— 纯判定（DOM 粘合见 `use-swipe-drawer.ts`）。
 *
 * 行为：
 *   - 抽屉关着：从屏幕左/右边缘往内横滑 → 把那侧的抽屉拉出来（跟手）；
 *   - 抽屉开着：在面板/遮罩上往屏幕外横滑 → 把它推回去。
 *
 * 起手区必须避开**系统手势**（Android 侧滑返回 / iOS 边缘返回）：系统手势区就是
 * 最贴边的那 ~20dp，浏览器一旦把这一手判给系统返回就不会再把 touchmove 给我们
 * （或者直接 touchcancel）。因此我们只在「边缘往内 ≤ SWIPE_EDGE_ZONE_PX」的带内
 * 起手，带内最外面那点如果被系统吃掉，表现就是「这一手没反应」，不会互相打架。
 *
 * 判定分三段：
 *   1. 起手（`swipeCandidate`）：是不是从边缘起手、该动哪一侧；
 *   2. 定向（`lockAxis`）：先动 12px 再定性，竖向就整手作废（页面滚动优先）；
 *   3. 松手（`swipeShouldOpen`）：跟手进度 ≥ 40% 或快速轻扫方向即为结果。
 */

/** 起手区：距屏幕左右边缘这么多 px 以内起手才算「边缘横滑」。 */
export const SWIPE_EDGE_ZONE_PX = 72;
/** 定向前允许的「还没定性」位移（轻点、长按、抖动都不受影响）。 */
export const SWIPE_AXIS_LOCK_PX = 12;
/** 横向位移必须超过纵向的这么多倍才锁横向（斜着划留给页面滚动）。 */
export const SWIPE_AXIS_RATIO = 1.2;
/** 松手判定：跟手进度（抽屉露出比例）达到它就定成「开」。 */
export const SWIPE_COMMIT_RATIO = 0.4;
/** 快速轻扫：这么久之内划了这么远，方向即结果（不必真的拖满 40%）。 */
export const SWIPE_FLICK_PX = 48;
export const SWIPE_FLICK_MS = 320;
/** 抽屉「藏起来」时相对自身宽度的位移比 —— 必须与 styles.css 的 translateX(±105%) 一致。 */
export const DRAWER_HIDDEN_RATIO = 1.05;

export type DrawerSide = "left" | "right";
/** 手势轴向：none = 还没定性（位移太小），定性后不再改。 */
export type GestureAxis = "none" | "horizontal" | "vertical";

/** 移动端抽屉宽度（px）—— 必须与 styles.css 的 `width: min(300px, 86vw)` 一致。 */
export function drawerWidth(viewportWidth: number): number {
  return Math.min(300, viewportWidth * 0.86);
}

/**
 * 起手时该动哪一侧（null = 这一手不管）。
 *
 * 抽屉开着时只认开着的这一侧（关它），不按起手位置挑——否则「左栏开着但手指
 * 落在右半屏」会变成右栏跟着动。视口窄到两侧起手区重叠时同样放弃。
 */
export function swipeCandidate(
  startX: number,
  viewportWidth: number,
  open: DrawerSide | null,
): DrawerSide | null {
  if (open) return open;
  if (viewportWidth <= SWIPE_EDGE_ZONE_PX * 2) return null;
  if (startX <= SWIPE_EDGE_ZONE_PX) return "left";
  if (viewportWidth - startX <= SWIPE_EDGE_ZONE_PX) return "right";
  return null;
}

/** 位移定性：过了阈值才说话，横向必须明显大于纵向（否则让给页面滚动）。 */
export function lockAxis(dx: number, dy: number): GestureAxis {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < SWIPE_AXIS_LOCK_PX && ay < SWIPE_AXIS_LOCK_PX) return "none";
  return ax > ay * SWIPE_AXIS_RATIO ? "horizontal" : "vertical";
}

/**
 * 把原始横位移换算成「往屏幕内推」的有符号位移（正 = 正在打开）。
 * 左栏往右推是打开，右栏往左推才是打开。
 */
export function swipePull(side: DrawerSide, dx: number): number {
  return side === "left" ? dx : -dx;
}

/**
 * 跟手位移（px，负 = 相对「完全打开」位置向左偏，右栏调用方自行取反）。
 * `hidden` = 藏起来时的偏移量（正数）。范围钳在 [-hidden, 0]：
 * 关着时反向划不动（无橡皮筋），开着时继续往里推也不动。
 */
export function followOffset(hidden: number, pull: number): number {
  return Math.max(-hidden, Math.min(0, -hidden + pull));
}

/** 抽屉当前的「露出比例」0..1（0 = 完全藏着，1 = 完全打开）。
 *
 * 必须带上「起手时开没开」：位移 `pull` 是相对**起手位置**的，起点不同，同一段
 * 位移对应的露出度完全不同（关着拖 40% 是「该开了」，开着拖 40% 还是「别关」）。
 */
export function openProgress(
  hidden: number,
  pull: number,
  wasOpen: boolean,
): number {
  const moved = wasOpen ? hidden + pull : pull;
  return Math.max(0, Math.min(1, moved / hidden));
}

/** 松手时的判定输入。 */
export interface SwipeRelease {
  /** 起手时目标侧抽屉是开着的（true = 这一手在「推回去」）。 */
  wasOpen: boolean;
  /** 手势总位移（「往屏幕内推」方向为正，见 `swipePull`）。 */
  pull: number;
  /** 抽屉宽度 px（`drawerWidth`）。 */
  width: number;
  /** 手势时长 ms。 */
  durationMs: number;
}

/**
 * 松手后抽屉应该开着吗？
 *
 * 看两件事：① 快速轻扫（`SWIPE_FLICK_MS` 内划了 `SWIPE_FLICK_PX`）按方向定；
 * ② 否则按「露出比例」过不过 `SWIPE_COMMIT_RATIO` —— 拉开时拖过 40% 算想开，
 * 推回去时拖掉 60% 以上才算想关（两者是同一个「露出 ≥ 40% 就留着」的口径）。
 */
export function swipeShouldOpen(input: SwipeRelease): boolean {
  const { wasOpen, pull, width, durationMs } = input;
  if (durationMs <= SWIPE_FLICK_MS && Math.abs(pull) >= SWIPE_FLICK_PX)
    return pull > 0;
  return (
    openProgress(width * DRAWER_HIDDEN_RATIO, pull, wasOpen) >=
    SWIPE_COMMIT_RATIO
  );
}
