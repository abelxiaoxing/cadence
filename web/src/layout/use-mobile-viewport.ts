import { useEffect } from "react";

/** Keyboard height threshold (CSS px) distinguishing a soft keyboard from
 * minor browser toolbar animations. */
const KEYBOARD_MIN_INSET = 120;

export interface MobileViewportMetrics {
  height: number;
  offsetTop: number;
  keyboardOpen: boolean;
}

/** Pure viewport calculation from window and visualViewport metrics. */
export function mobileViewportMetrics(
  windowHeight: number,
  visualHeight: number,
  visualOffsetTop = 0,
): MobileViewportMetrics {
  const safeWindow =
    Number.isFinite(windowHeight) && windowHeight > 0
      ? Math.round(windowHeight)
      : 0;
  const safeVisual =
    Number.isFinite(visualHeight) && visualHeight > 0
      ? Math.round(visualHeight)
      : safeWindow;
  const offsetTop =
    Number.isFinite(visualOffsetTop) && visualOffsetTop > 0
      ? Math.round(visualOffsetTop)
      : 0;
  const keyboardOpen =
    safeWindow > 0 &&
    safeVisual > 0 &&
    safeWindow - safeVisual >= KEYBOARD_MIN_INSET;
  return {
    height: safeVisual,
    offsetTop,
    keyboardOpen,
  };
}

/** Keeps the mobile shell aligned with `window.visualViewport` on iOS Safari
 * and standalone PWAs where the software keyboard overlays `100dvh`. */
export function useMobileViewport(enabled: boolean): void {
  useEffect(() => {
    if (
      !enabled ||
      typeof window === "undefined" ||
      typeof document === "undefined"
    )
      return;
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const apply = () => {
      const metrics = mobileViewportMetrics(
        window.innerHeight,
        vv.height,
        vv.offsetTop,
      );
      if (metrics.height > 0)
        root.style.setProperty("--app-height", `${metrics.height}px`);
      root.style.setProperty("--app-offset-top", `${metrics.offsetTop}px`);
      if (metrics.keyboardOpen) root.dataset.keyboardOpen = "true";
      else delete root.dataset.keyboardOpen;
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    window.addEventListener("resize", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      window.removeEventListener("resize", apply);
      root.style.removeProperty("--app-height");
      root.style.removeProperty("--app-offset-top");
      delete root.dataset.keyboardOpen;
    };
  }, [enabled]);
}
