import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { WorkbenchHome } from "../../web/src/components/workspace/WorkbenchHome";
import { ResizeHandle } from "../../web/src/layout/ResizeHandle";
import {
  CHAT_MIN,
  DEFAULT_LAYOUT,
  LAYOUT_STORAGE_KEY,
  panelWidth,
  readPanelPreferences,
  workspaceLayout,
} from "../../web/src/layout/workspace-layout";

afterEach(() => vi.unstubAllGlobals());

it("defaults to conversation navigation without a permanent empty inspector", () => {
  expect(readPanelPreferences(null)).toEqual(DEFAULT_LAYOUT);
  expect(DEFAULT_LAYOUT.inspector).toBe(false);
  const write = vi.fn();
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: write });
  const html = renderToStaticMarkup(
    <WorkbenchHome ready onOpenFolder={() => {}} />,
  );
  expect(html).toContain("workbench-entry inspector-hidden");
  expect(html).toContain(
    'aria-label="Toggle conversation navigation" aria-expanded="true"',
  );
  expect(html).toContain(
    'aria-label="Toggle workspace panels" aria-expanded="false"',
  );
  expect(write).not.toHaveBeenCalled();
});

it("validates display-only preferences, without repairing malformed storage", () => {
  for (const value of [null, "{", "null", "[]", "false"])
    expect(readPanelPreferences(value)).toEqual(DEFAULT_LAYOUT);
  expect(
    readPanelPreferences(
      '{"left":9999,"right":1,"inspector":true,"navigation":"false"}',
    ),
  ).toEqual({
    left: 600,
    right: 220,
    inspector: true,
    navigation: true,
  });
  expect(readPanelPreferences('{"left":"300","right":null}')).toEqual(
    DEFAULT_LAYOUT,
  );
  const read = vi.fn(() => '{"navigation":false,"inspector":true}');
  vi.stubGlobal("localStorage", { getItem: read });
  const html = renderToStaticMarkup(
    <WorkbenchHome ready onOpenFolder={() => {}} />,
  );
  expect(read).toHaveBeenCalledWith(LAYOUT_STORAGE_KEY);
  expect(html).toContain("navigation-hidden");
});

it.each([901, 1000, 1050, 1180, 1280, 1440])(
  "%ipx keeps a readable center and overlays an inspector that cannot fit",
  (width) => {
    const preference = { ...DEFAULT_LAYOUT, inspector: true };
    const layout = workspaceLayout(width, preference);
    const center =
      width - layout.left - (layout.rightOverlay ? 0 : layout.right);
    expect(center).toBeGreaterThanOrEqual(CHAT_MIN);
    expect(layout.rightOverlay).toBe(width < 1180);
    expect(preference).toEqual({ ...DEFAULT_LAYOUT, inspector: true });
  },
);

it("resize constraints include the other docked pane for pointer and keyboard changes", () => {
  const layout = workspaceLayout(1280, { ...DEFAULT_LAYOUT, inspector: true });
  expect(layout.rightOverlay).toBe(false);
  expect(panelWidth(9999, layout.leftMaximum)).toBe(
    1280 - CHAT_MIN - layout.right,
  );
  expect(panelWidth(9999, layout.rightMaximum)).toBe(
    1280 - CHAT_MIN - layout.left,
  );
  const html = renderToStaticMarkup(
    <ResizeHandle
      side="left"
      width={layout.left}
      maximum={layout.leftMaximum}
      onResize={() => {}}
    />,
  );
  expect(html).toContain(`max="${layout.leftMaximum}"`);
  expect(html).toContain(`aria-valuemax="${layout.leftMaximum}"`);
  expect(html).toContain('aria-orientation="horizontal"');
});

it("narrow windows clamp effective navigation without overwriting wide-window preferences", () => {
  const preference = {
    ...DEFAULT_LAYOUT,
    left: 600,
    right: 600,
    inspector: true,
  };
  const narrow = workspaceLayout(901, preference);
  expect(narrow.left).toBe(901 - CHAT_MIN);
  expect(narrow.rightOverlay).toBe(true);
  expect(workspaceLayout(1920, preference).left).toBe(600);
  expect(workspaceLayout(1920, preference).rightOverlay).toBe(false);
  expect(preference.left).toBe(600);
  expect(workspaceLayout(390, preference).mobile).toBe(true);
  expect(workspaceLayout(900, preference).mobile).toBe(true);
  expect(workspaceLayout(901, preference).mobile).toBe(false);
  expect(
    workspaceLayout(1050, {
      ...DEFAULT_LAYOUT,
      navigation: false,
      inspector: true,
    }).rightOverlay,
  ).toBe(false);
});
