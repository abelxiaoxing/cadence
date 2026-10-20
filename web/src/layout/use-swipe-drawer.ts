/* Adapted from pi-web-ui/web/src/use-swipe-drawer.ts @ e8bab487af208bc9a1ab60a821652323f598127f.
 * Copyright (c) 2026 xing-shuyin. MIT; see licenses/pi-web-ui-MIT.txt.
 * Cadence: scoped presentation only; see provenance/webui-reuse.json. */
/**
 * 手机端侧栏抽屉的横滑手势 —— DOM 粘合（判定全在 `swipe-drawer.ts`，可在无 DOM
 * 环境单测）。挂一次 touch 监听在容器（`.layout`）上，靠事件冒泡吃下整屏的手势。
 *
 * 跟手怎么做：手势定性之后直接写面板的内联 `transform`（逐帧，不走 React 状态，
 * 所以不触发重渲染），同时给面板挂 `.drawer-dragging` 关掉过渡；松手时清掉内联
 * 样式与这个类，再由 React 的 `open` 类把它过渡到最终位置。
 *
 * 遮罩同理走内联 `opacity`（移动端遮罩是常驻元素，见 styles.css 的
 * `.drawer-backdrop.persistent`）—— 关着的抽屉被拉出来时才有得渐变。
 */
import { type RefObject, useEffect } from "react";
import {
  DRAWER_HIDDEN_RATIO,
  type DrawerSide,
  drawerWidth,
  followOffset,
  type GestureAxis,
  lockAxis,
  openProgress,
  swipeCandidate,
  swipePull,
  swipeShouldOpen,
} from "./swipe-drawer";

export interface SwipeDrawerOptions {
  /** 只在移动端 + 抽屉所在视图里挂监听。 */
  enabled: boolean;
  /** 当前开着的抽屉（null = 都关着）。 */
  open: DrawerSide | null;
  onOpenChange: (side: DrawerSide | null) => void;
  /** 手势监听容器（与 position 无关，事件冒泡到它就够了）。 */
  container: RefObject<HTMLElement | null>;
  /** 面板选择器，默认 `.panel-drawer.drawer-<side>`。 */
  panelSelector?: (side: DrawerSide) => string;
  /** 遮罩选择器；没有遮罩传 null（默认 `.drawer-backdrop`）。 */
  backdropSelector?: string | null;
}

/** 这些 overflow-x 才允许「横向滚动优先于抽屉手势」。 */
const SCROLLABLE_OVERFLOW_X = new Set(["auto", "scroll", "overlay"]);

/**
 * 起手点下面是横向可滚动元素（代码块、宽表格、终端…）时让位给滚动。
 * `overflow-y:auto` 会把 overflow-x 的**计算值**也变成 auto，所以必须再确认
 * 真的有横向溢出（scrollWidth > clientWidth），否则整片消息区都会被误判。
 */
function hasHorizontalScroller(
  target: EventTarget | null,
  root: HTMLElement,
): boolean {
  let el: Element | null = target instanceof Element ? target : null;
  while (el) {
    if (el instanceof HTMLElement && el.scrollWidth > el.clientWidth + 4) {
      if (SCROLLABLE_OVERFLOW_X.has(getComputedStyle(el).overflowX))
        return true;
    }
    if (el === root) break;
    el = el.parentElement;
  }
  return false;
}

/**
 * 吞掉跟手手势之后紧跟的那一下 click。触摸手势被 preventDefault 后浏览器通常
 * 不再合成 click，但「抽屉刚拉开又被遮罩的 onClick 关上」这种闪一下太难查，
 * 索性在状态真的变了时补一道保险（400ms 自动解锁，不留给后续真实点击）。
 */
function suppressNextClick(): void {
  const swallow = (ev: MouseEvent) => {
    ev.stopPropagation();
    ev.preventDefault();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  setTimeout(
    () => window.removeEventListener("click", swallow, { capture: true }),
    400,
  );
}

export function useSwipeDrawer(options: SwipeDrawerOptions): void {
  const { enabled, open, onOpenChange, container } = options;
  const { panelSelector, backdropSelector } = options;

  useEffect(() => {
    const root = container.current;
    if (!enabled || !root) return;

    // 一手手势的全部状态：起手点、定性结果、当前侧、跟手位移。
    let side: DrawerSide | null = null;
    let locked: GestureAxis = "none";
    let startX = 0;
    let startY = 0;
    let startT = 0;
    let pull = 0;
    let wasOpen = false;
    let width = 0;
    let hidden = 0;
    let panel: HTMLElement | null = null;
    let backdrop: HTMLElement | null = null;

    /** 收工：清掉跟手期间写的内联样式/类，把位置交回 CSS 与 React（含中途放弃的还原）。 */
    const release = () => {
      if (panel) {
        panel.classList.remove("drawer-dragging");
        panel.style.transform = "";
      }
      if (backdrop) backdrop.style.opacity = "";
      side = null;
      locked = "none";
      panel = null;
      backdrop = null;
      pull = 0;
      wasOpen = false;
    };

    const onStart = (e: TouchEvent) => {
      release();
      // 多指（缩放/双指滚动）不参与。
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      if (!touch) return;
      const candidate = swipeCandidate(touch.clientX, window.innerWidth, open);
      if (!candidate || hasHorizontalScroller(e.target, root)) return;
      side = candidate;
      startX = touch.clientX;
      startY = touch.clientY;
      startT = Date.now();
    };

    const onMove = (e: TouchEvent) => {
      const active = side;
      if (!active || e.touches.length !== 1) return;
      const touch = e.touches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      if (locked === "none") {
        const axis = lockAxis(dx, dy);
        if (axis === "none") return;
        if (axis === "vertical") {
          // 竖向手势：整手作废，交给页面滚动，后半程不再翻案。
          side = null;
          return;
        }
        locked = "horizontal";
        wasOpen = open === active;
        width = drawerWidth(window.innerWidth);
        hidden = width * DRAWER_HIDDEN_RATIO;
        const box = root.querySelector<HTMLElement>(
          panelSelector
            ? panelSelector(active)
            : `.panel-drawer.drawer-${active}`,
        );
        if (!box) {
          side = null;
          return;
        }
        panel = box;
        backdrop =
          backdropSelector === null
            ? null
            : root.querySelector<HTMLElement>(
                backdropSelector ?? ".drawer-backdrop",
              );
        box.classList.add("drawer-dragging");
      }

      const box = panel;
      if (!box) return;
      pull = swipePull(active, dx);
      const offset = followOffset(hidden, wasOpen ? hidden + pull : pull);
      box.style.transform = `translateX(${active === "left" ? offset : -offset}px)`;
      if (backdrop)
        backdrop.style.opacity = String(openProgress(hidden, pull, wasOpen));
      // 定性为横向之后才拦：这一手不会再被当成页面滚动。
      e.preventDefault();
    };

    const onFinish = () => {
      const active = side;
      const dragging =
        locked === "horizontal" && active !== null && panel !== null;
      const total = pull;
      const elapsed = Date.now() - startT;
      const startedOpen = wasOpen;
      // 先算结果再收工：release() 会把这一手的中间状态全清掉。
      const shouldOpen = dragging
        ? swipeShouldOpen({
            wasOpen: startedOpen,
            pull: total,
            width,
            durationMs: elapsed,
          })
        : false;
      release();
      if (!dragging || !active) return;
      if (shouldOpen !== (open === active)) {
        suppressNextClick();
        onOpenChange(shouldOpen ? active : null);
      }
    };

    const onCancel = () => release();

    root.addEventListener("touchstart", onStart, { passive: true });
    root.addEventListener("touchmove", onMove, { passive: false });
    root.addEventListener("touchend", onFinish);
    root.addEventListener("touchcancel", onCancel);
    return () => {
      release();
      root.removeEventListener("touchstart", onStart);
      root.removeEventListener("touchmove", onMove);
      root.removeEventListener("touchend", onFinish);
      root.removeEventListener("touchcancel", onCancel);
    };
  }, [enabled, open, onOpenChange, container, panelSelector, backdropSelector]);
}
