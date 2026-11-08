/** Presentation preferences only: no project, conversation or execution state. */
export const LAYOUT_STORAGE_KEY = "cadence-panel-layout-v1";
export const PANEL_MIN = 220;
export const PANEL_MAX = 600;
export const CHAT_MIN = 560;
export const DRAWER_BREAKPOINT = 900;
export const DEFAULT_LAYOUT = {
  left: 260,
  right: 360,
  navigation: true,
  inspector: false,
};
export type PanelPreferences = typeof DEFAULT_LAYOUT;

export function panelWidth(value: number, maximum = PANEL_MAX): number {
  return Math.max(PANEL_MIN, Math.min(maximum, value));
}

export function readPanelPreferences(raw: string | null): PanelPreferences {
  const defaults = { ...DEFAULT_LAYOUT };
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object" || Array.isArray(value))
      return defaults;
    for (const side of ["left", "right"] as const) {
      const width = (value as Record<string, unknown>)[side];
      if (typeof width === "number" && Number.isFinite(width))
        defaults[side] = panelWidth(width);
    }
    for (const name of ["navigation", "inspector"] as const) {
      const open = (value as Record<string, unknown>)[name];
      if (typeof open === "boolean") defaults[name] = open;
    }
  } catch {
    // A damaged display preference is ignored, never repaired on a read.
  }
  return defaults;
}

/** Narrow windows overlay the inspector rather than squeezing the transcript.
 * Effective widths do not overwrite the user's wider-window preferences. */
export function workspaceLayout(width: number, preference: PanelPreferences) {
  const mobile = width <= DRAWER_BREAKPOINT;
  const left = panelWidth(preference.left, width - CHAT_MIN);
  const right = panelWidth(preference.right);
  const leftSpace = preference.navigation ? left : 0;
  const rightOverlay = !mobile && width - leftSpace - right < CHAT_MIN;
  const rightSpace = preference.inspector && !rightOverlay ? right : 0;
  return {
    mobile,
    left,
    right,
    rightOverlay,
    leftMaximum: panelWidth(width - CHAT_MIN - rightSpace),
    rightMaximum: panelWidth(width - CHAT_MIN - leftSpace),
  };
}
