import { type RefObject, useEffect } from "react";
import type { DrawerSide } from "./swipe-drawer";
/** Focus containment and restoration supplement the adapted swipe-only reference. */
export function useDrawerFocus(
  container: RefObject<HTMLElement | null>,
  side: DrawerSide | null,
  mobile: boolean,
  close: () => void,
) {
  useEffect(() => {
    if (!mobile || !side) return;
    const panel = container.current?.querySelector<HTMLElement>(
        `.drawer-${side}`,
      ),
      previous = document.activeElement;
    const focusable = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input,textarea,select,a[href],[tabindex="0"]',
        ) ?? [],
      ).filter((el) => el.getClientRects().length > 0);
    // After restart/model absence the inspector can contain only disabled
    // controls. Focus its programmatic target so Escape/Tab still reach this
    // drawer rather than leaving focus behind the inert overlay.
    // Focus while a drawer is still translating must not scroll the layout
    // horizontally to its off-screen starting position.
    (focusable()[0] ?? panel)?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
      if (e.key === "Tab") {
        const nodes = focusable(),
          first = nodes[0],
          last = nodes[nodes.length - 1];
        if (!first) {
          e.preventDefault();
          return;
        }
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus({ preventScroll: true });
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus({ preventScroll: true });
        }
      }
    };
    panel?.addEventListener("keydown", key);
    return () => {
      panel?.removeEventListener("keydown", key);
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, [container, side, mobile, close]);
}
