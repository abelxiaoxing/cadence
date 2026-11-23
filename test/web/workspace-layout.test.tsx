import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import {
  followLatest,
  followsLatest,
} from "../../web/src/components/workspace/ChatWorkspace";
import { FolderSetup } from "../../web/src/components/workspace/FolderSetup";
import { ResizeHandle } from "../../web/src/layout/ResizeHandle";
import { swipeShouldOpen } from "../../web/src/layout/swipe-drawer";
import { mobileViewportMetrics } from "../../web/src/layout/use-mobile-viewport";
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
    <FolderSetup ready onChooseFolder={() => {}} onRefresh={() => {}} />,
  );
  expect(html).toContain("app inspector-hidden");
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
    <FolderSetup ready onChooseFolder={() => {}} onRefresh={() => {}} />,
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

it.each([
  [320, 275.2, 294.4],
  [390, 300, 358.8],
  [900, 300, 380],
])(
  "%ipx gives each compact drawer its own width regardless of docked preferences",
  (width, left, right) => {
    const layout = workspaceLayout(width, {
      ...DEFAULT_LAYOUT,
      left: 560,
      right: 220,
    });
    expect(layout.mobile).toBe(true);
    expect(layout.left).toBeCloseTo(left);
    expect(layout.right).toBeCloseTo(right);
  },
);

it("a 138px slow pull at 390px opens navigation but not the wider inspector", () => {
  const layout = workspaceLayout(390, DEFAULT_LAYOUT);
  const slow = { wasOpen: false, pull: 138, durationMs: 500 };
  expect(swipeShouldOpen({ ...slow, width: layout.left })).toBe(true);
  expect(swipeShouldOpen({ ...slow, width: layout.right })).toBe(false);
});

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

// Geometry fixtures exercise the actual intent/write helpers, not DOM scroll.
it("keeps the 80px follow boundary, pauses on up-scroll, and follows growth only after returning", () => {
  const viewport = { scrollHeight: 2000, clientHeight: 600, scrollTop: 1400 };
  expect(followsLatest(viewport)).toBe(true);
  viewport.scrollTop = 1321;
  expect(followsLatest(viewport)).toBe(true);
  viewport.scrollTop = 1320;
  expect(followsLatest(viewport)).toBe(false);
  viewport.scrollTop = 500;
  let following = followsLatest(viewport);
  for (const growth of [30, 240, 600]) {
    // Text, images and expanded detail can all grow while reading earlier.
    viewport.scrollHeight += growth;
    followLatest(viewport, following);
    expect(viewport.scrollTop).toBe(500);
  }
  viewport.scrollTop = viewport.scrollHeight - viewport.clientHeight;
  following = followsLatest(viewport);
  expect(following).toBe(true);
  viewport.scrollHeight += 200;
  followLatest(viewport, following);
  expect(viewport.scrollTop).toBe(viewport.scrollHeight);
  // Explicit Latest also resumes following, but missing/unmounted views do nothing.
  viewport.scrollTop = 200;
  followLatest(viewport, true);
  expect(viewport.scrollTop).toBe(viewport.scrollHeight);
  expect(() => followLatest(null, true)).not.toThrow();
});

it("mobile shell moves statusbar and folder controls into the topbar detail sheet and tracks soft keyboards", () => {
  expect(mobileViewportMetrics(844, 844, 0)).toEqual({
    height: 844,
    offsetTop: 0,
    keyboardOpen: false,
  });
  expect(mobileViewportMetrics(844, 780, 0)).toEqual({
    height: 780,
    offsetTop: 0,
    keyboardOpen: false,
  });
  expect(mobileViewportMetrics(844, 520, 12)).toEqual({
    height: 520,
    offsetTop: 12,
    keyboardOpen: true,
  });

  vi.stubGlobal("window", { innerWidth: 390 });
  const html = renderToStaticMarkup(
    <FolderSetup ready onChooseFolder={() => {}} onRefresh={() => {}} />,
  );
  expect(html).toContain("is-mobile");
  expect(html).toContain('class="topbar mobile-topbar"');
  expect(html).toContain('class="mobile-title-trigger"');
  expect(html).toContain('class="mobile-details-sheet"');
  expect(html).toContain('class="mobile-details-folder"');
  expect(html).toContain('class="mobile-details-status"');
  expect(html).toContain('aria-label="Switch working folder"');
  expect(html).not.toContain('<footer class="statusbar">');
});
