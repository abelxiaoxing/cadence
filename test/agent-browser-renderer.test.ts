/** Real Pi 1.5 input routing, with an in-memory terminal (no PTY or owner). */
import { initTheme } from "@earendil-works/pi-coding-agent";
import {
  KeybindingsManager,
  ScrollView,
  Text,
  TUI_KEYBINDINGS,
  TuiAltScreen,
  VStack,
} from "@earendil-works/pi-tui";
import { expect, it, vi } from "vitest";
import { SessionNavigator } from "../src/agent-browser/session-navigator.ts";
import { cadenceBrowserSource } from "../src/agent-browser/source.ts";
import {
  SUBAGENT_EVENTS as E,
  SubagentStore,
} from "../src/agent-panel-model.ts";

initTheme("dark");
it("delivers paging and wheel to the reused browser, not the small parent viewport", () => {
  let input: (data: string) => void = () => {};
  const noop = () => {};
  const terminal = {
    columns: 80,
    rows: 30,
    kittyProtocolActive: false,
    start: (fn: (data: string) => void) => {
      input = fn;
    },
    stop: noop,
    drainInput: async () => {},
    write: noop,
    moveBy: noop,
    hideCursor: noop,
    showCursor: noop,
    clearLine: noop,
    clearFromCursor: noop,
    clearScreen: noop,
    setTitle: noop,
    setProgress: noop,
    setProgramStatus: noop,
  };
  const tui = new TuiAltScreen(terminal);
  const parent = new ScrollView(
    new Text(
      Array.from({ length: 100 }, (_, i) => `parent ${i}`).join("\n"),
      0,
      0,
    ),
    { follow: "end", primary: true },
  );
  tui.setLayoutRoot(
    new VStack([
      { component: parent, grow: 1, basis: 0 },
      { component: new Text("editor", 0, 0), basis: "auto" },
    ]),
  );
  const store = new SubagentStore();
  for (let i = 0; i < 16; i++)
    store.apply(E.start, { id: String(i), label: `Agent ${i}` });
  store.apply(E.message, {
    id: "0",
    message: {
      role: "user",
      content: Array.from({ length: 100 }, (_, i) => `child ${i}`).join("\n"),
    },
  });
  const view = vi.fn();
  const positions = new Map();
  const theme = {
    fg: (_role: string, text: string) => text,
    bold: (text: string) => text,
    inverse: (text: string) => text,
    getThinkingBorderColor: () => (text: string) => text,
  };
  const browser = new SessionNavigator(
    tui,
    theme as any,
    new KeybindingsManager(TUI_KEYBINDINGS),
    cadenceBrowserSource(store, view, Date.now),
    "/fixture",
    positions,
    noop,
  );
  try {
    tui.start();
    tui.renderNow();
    const handle = tui.showOverlay(browser, {
      width: "100%",
      maxHeight: "70%",
    });
    tui.renderNow();
    const before = parent.scrollTop;
    input("\r");
    tui.renderNow();
    expect(view).toHaveBeenLastCalledWith("0");
    const bottom = positions.get("0").offset;
    input("\x1b[5~");
    tui.renderNow();
    expect(positions.get("0").offset).toBeLessThan(bottom);
    expect(parent.scrollTop).toBe(before);
    const paged = positions.get("0").offset;
    input("\x1b[<64;10;15M");
    tui.renderNow();
    expect(positions.get("0").offset).toBeLessThan(paged);
    expect(parent.scrollTop).toBe(before);
    input("\x1b");
    tui.renderNow();
    expect(view).toHaveBeenLastCalledWith(null);
    input("\x1b[6~");
    tui.renderNow();
    expect(Number(browser.selected)).toBeGreaterThan(0);
    expect(parent.scrollTop).toBe(before);
    handle.hide();
  } finally {
    browser.dispose();
    tui.stop();
  }
});
