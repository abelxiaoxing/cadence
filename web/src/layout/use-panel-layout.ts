import { useCallback, useEffect, useState } from "react";
import type { DrawerSide } from "./swipe-drawer";
import {
  LAYOUT_STORAGE_KEY,
  type PanelPreferences,
  readPanelPreferences,
  workspaceLayout,
} from "./workspace-layout";

/** Shared by the no-project shell and project view. Only explicit desktop
 * choices persist; resize and phone drawers never write preferences. */
export function usePanelLayout() {
  const [preference, setPreference] = useState(() => {
    try {
      return readPanelPreferences(localStorage.getItem(LAYOUT_STORAGE_KEY));
    } catch {
      return readPanelPreferences(null);
    }
  });
  const [width, setWidth] = useState(() =>
    typeof window === "undefined" ? 1440 : (window.innerWidth ?? 1440),
  );
  const [drawer, setDrawer] = useState<DrawerSide | null>(null);
  useEffect(() => {
    const resize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const geometry = workspaceLayout(width, preference);
  const change = useCallback(
    (patch: Partial<PanelPreferences>) => {
      const next = { ...preference, ...patch };
      setPreference(next);
      try {
        localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Display choices remain usable when storage is unavailable.
      }
    },
    [preference],
  );
  const overlay = geometry.mobile
    ? drawer
    : geometry.rightOverlay && preference.inspector
      ? "right"
      : null;
  const closeDrawer = useCallback(() => {
    setDrawer(null);
    // Closing an overlay while navigating should not erase a docked preference.
    if (!geometry.mobile && geometry.rightOverlay) change({ inspector: false });
  }, [geometry.mobile, geometry.rightOverlay, change]);
  return {
    ...geometry,
    overlay,
    closeDrawer,
    setDrawer,
    navigation: preference.navigation,
    inspector: preference.inspector,
    className: `${preference.navigation ? "" : " navigation-hidden"}${preference.inspector ? "" : " inspector-hidden"}${geometry.rightOverlay ? " inspector-overlay" : ""}`,
    toggle(side: DrawerSide) {
      if (geometry.mobile) setDrawer((value) => (value === side ? null : side));
      else if (side === "left") change({ navigation: !preference.navigation });
      else change({ inspector: !preference.inspector });
    },
    resize(side: "left" | "right", value: number) {
      change({ [side]: value });
    },
  };
}
