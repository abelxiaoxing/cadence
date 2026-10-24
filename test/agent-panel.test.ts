/** Background-agent panel: Z3 rows, Z1 summary and the Pi widget/bus binding
 * through a fake Pi host. */
import { initTheme } from "@earendil-works/pi-coding-agent";
import {
  Editor,
  stripTerminalSequences,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import agentPanelDemo from "../scripts/agent-panel-demo.ts";
import { registerAgentPanel } from "../src/agent-panel.ts";
import {
  SUBAGENT_EVENTS as E,
  type Paint,
  type PanelFrame,
  panelLines,
  SubagentStore,
  summaryLines,
} from "../src/agent-panel-model.ts";

afterEach(() => {
  vi.useRealTimers();
});
/** Plain text; reverse video shows as [brackets]. */
const paint: Paint = (role, text) => (role === "selected" ? `[${text}]` : text);
const T0 = 1_000_000;

function agents(n: number, at = T0) {
  let now = at;
  const s = new SubagentStore(() => now);
  for (let i = 0; i < n; i++) {
    now = at + i;
    s.apply(E.start, {
      id: `a${i}`,
      label: `Analyze part ${i}`,
      kind: "Explore",
      startedAt: at,
    });
  }
  return {
    s,
    at(t: number) {
      now = t;
    },
  };
}
const frame = (s: SubagentStore, patch: Partial<PanelFrame> = {}) => ({
  agents: s.ordered(),
  focus: "input" as const,
  selected: undefined,
  view: undefined,
  now: T0 + 283_000,
  frame: 0,
  maxRows: 6,
  showEmpty: false,
  ...patch,
});

describe("Z3 rows", () => {
  it("lists main and one aligned row per agent", () => {
    const { s } = agents(2);
    s.apply(E.activity, {
      id: "a0",
      activity: "Inspecting observer.ts polling and sockets",
      tokensIn: 110_900,
    });
    s.apply(E.stats, { id: "a1", tokensIn: 123_400, tokensOut: 2100 });
    expect(panelLines(frame(s), 72, paint)).toEqual([
      "● main",
      "⠋ Explore  Inspecting observer.ts polling and socke…    4m 43s · ↓110.9k",
      `⠋ Explore${" ".repeat(41)}4m 43s · ↓123.4k ↑2.1k`,
    ]);
  });

  it("hides with no agents unless configured, and marks the selection", () => {
    const { s } = agents(0);
    expect(panelLines(frame(s), 40, paint)).toEqual([]);
    expect(panelLines(frame(s, { showEmpty: true }), 40, paint)).toEqual([
      "● main",
    ]);
    const two = agents(2).s;
    const lines = panelLines(
      frame(two, { focus: "panel", selected: "a1" }),
      40,
      paint,
    );
    expect(lines[0]).toBe(" ● main");
    expect(lines[1].startsWith(" ⠋ Explore")).toBe(true);
    // No usage reported: the row ends at its elapsed time, not "↓0".
    expect(lines[2]).toMatch(/^\[▶⠋ Explore +4m 43s\]$/);
    expect(visibleWidth(lines[2])).toBe(42);
  });

  it("shows ended status symbols, final elapsed and the error", () => {
    const { s, at } = agents(3);
    at(T0 + 252_000);
    s.apply(E.end, { id: "a0", status: "done" });
    s.apply(E.end, { id: "a1", status: "error", error: "Rate limited" });
    s.apply(E.end, { id: "a2", status: "cancelled" });
    const lines = panelLines(frame(s, { now: T0 + 999_000 }), 60, paint);
    expect(lines.slice(1).map((l) => l[0])).toEqual(["✔", "✘", "○"]);
    expect(lines[1]).toMatch(/4m 12s$/);
    expect(lines[2]).toContain("Rate limited");
  });

  it("keeps the most recently active rows plus the selection, with +K more", () => {
    const { s, at } = agents(5);
    at(T0 + 100);
    s.apply(E.activity, { id: "a0", activity: "busy" });
    const lines = panelLines(frame(s, { maxRows: 2 }), 50, paint);
    expect(lines[1]).toBe("  +3 more");
    expect(lines.slice(2).map((l) => l.includes("busy"))).toEqual([
      true,
      false,
    ]);
    expect(lines).toHaveLength(4);
    const pinned = panelLines(
      frame(s, { maxRows: 2, focus: "panel", selected: "a2" }),
      50,
      paint,
    );
    expect(pinned).toHaveLength(4);
    expect(pinned[3]).toMatch(/^\[▶/);
  });

  it("never exceeds the width for long text, wide glyphs and any size", () => {
    const { s } = agents(2);
    s.apply(E.start, {
      id: "w",
      label: "宽",
      kind: "探索代理人员非常长的类型名",
    });
    s.apply(E.activity, { id: "w", activity: "读取文件".repeat(40) });
    s.apply(E.stats, { id: "w", tokensIn: 9_999_999, tokensOut: 1_200_000 });
    for (let width = 1; width <= 130; width++)
      for (const f of [frame(s), frame(s, { focus: "panel", selected: "w" })])
        for (const line of [
          ...panelLines(f, width, paint),
          ...summaryLines(s.ordered(), width, paint, 6),
        ])
          expect(visibleWidth(line)).toBeLessThanOrEqual(width + 2);
  });
});

describe("Z1 summary", () => {
  it("shows launched/waiting while running, then the outcome counts", () => {
    const { s, at } = agents(2);
    expect(summaryLines(s.ordered(), 80, paint, 6)).toEqual([
      "● 2 background agents launched (↓ to manage)",
      "  ├ Analyze part 0",
      "  └ Analyze part 1",
      "* Waiting for 2 background agents to finish",
    ]);
    at(T0 + 5000);
    s.apply(E.end, { id: "a0", status: "done" });
    expect(summaryLines(s.ordered(), 80, paint, 6).at(-1)).toBe(
      "* Waiting for 1 background agent to finish",
    );
    s.apply(E.end, { id: "a1", status: "error" });
    expect(summaryLines(s.ordered(), 200, paint, 6)).toEqual([
      "✔ 2 background agents finished (ok=1, failed=1) — select a row below and press Enter to review",
    ]);
    const many = agents(9).s;
    expect(summaryLines(many.ordered(), 80, paint, 6).slice(-2)).toEqual([
      "  └ … +3 more",
      "* Waiting for 9 background agents to finish",
    ]);
    // A new running agent is never hidden behind finished ones.
    const old = agents(8).s;
    for (let i = 0; i < 7; i++)
      old.apply(E.end, { id: `a${i}`, status: "done" });
    const lines = summaryLines(old.ordered(), 80, paint, 6);
    expect(lines[1]).toBe("  ├ Analyze part 7");
    expect(lines.at(-2)).toBe("  └ … +2 more");
  });
});

type Rendered = {
  render(width: number): string[];
  handleInput?(data: string): void;
};
function host(options: { rows?: number } = {}) {
  const bus = new Map<string, Set<(data: unknown) => void>>();
  const handlers = new Map<
    string,
    ((event: unknown, ctx: unknown) => void)[]
  >();
  const widgets = new Map<
    string,
    { component: Rendered; placement?: string }
  >();
  let clock = T0,
    text = "",
    overlay = false,
    listener: ((data: string) => { consume?: boolean } | undefined) | undefined;
  // Pi's input box; instanceof is what the panel checks.
  const editor = Object.create(Editor.prototype) as Rendered;
  const dialog: Rendered = { render: () => ["dialog"] };
  let focused: Rendered | null = editor,
    slot: Rendered = editor,
    beneath: Rendered = editor;
  const tui = {
    terminal: { rows: options.rows ?? 30, columns: 80 },
    requestRender: vi.fn(),
    getFocusedComponent: () => focused,
    hasOverlay: () => overlay,
  };
  const theme = {
    fg: (_color: string, text: string) => text,
    inverse: (text: string) => `[${text}]`,
  };
  const pi = {
    events: {
      on(channel: string, fn: (data: unknown) => void) {
        const set = bus.get(channel) ?? new Set();
        bus.set(channel, set);
        set.add(fn);
        return () => set.delete(fn);
      },
      emit(channel: string, data: unknown) {
        for (const fn of bus.get(channel) ?? []) fn(data);
      },
    },
    on(event: string, fn: (event: unknown, ctx: unknown) => void) {
      handlers.set(event, [...(handlers.get(event) ?? []), fn]);
    },
  };
  const ctx = {
    mode: "tui",
    hasUI: true,
    cwd: "/work",
    ui: {
      setWidget(key: string, factory: any, opts?: { placement?: string }) {
        if (!factory) widgets.delete(key);
        else
          widgets.set(key, {
            component: factory(tui, theme),
            placement: opts?.placement,
          });
      },
      onTerminalInput(fn: typeof listener) {
        listener = fn;
        return () => {
          listener = undefined;
        };
      },
      getEditorText: () => text,
      getToolsExpanded: () => false,
      // Non-overlay custom UI: replaces and refocuses the editor slot, as Pi does.
      custom: vi.fn(
        (factory: any) =>
          new Promise<void>((resolve) => {
            let closed = false;
            const component = factory(tui, theme, {}, () => {
              if (closed) return;
              closed = true;
              slot = editor;
              focused = editor;
              resolve();
            });
            slot = component;
            focused = component;
          }),
      ),
    },
  };
  registerAgentPanel(pi as any, { now: () => clock });
  /** Terminal input: listener first, then the focused component. */
  const key = (data: string) => {
    const result = listener?.(data);
    if (result?.consume) return "consumed";
    if (focused !== editor) focused?.handleInput?.(data);
    return focused === editor ? "editor" : "component";
  };
  return {
    pi,
    tui,
    ctx,
    widgets,
    editor,
    key,
    emit(event: string) {
      for (const fn of handlers.get(event) ?? []) fn({}, ctx);
    },
    at(t: number) {
      clock = t;
    },
    type(value: string) {
      text = value;
    },
    overlay(on: boolean) {
      overlay = on;
    },
    dialog(open: boolean) {
      if (open) [beneath, slot] = [slot, dialog];
      else slot = beneath;
      focused = slot;
    },
    /** Pi put its editor back into the slot (after displacing the view). */
    restoreEditor() {
      slot = editor;
      focused = editor;
    },
    slot: () => slot,
    view: (width = 60) => (slot === editor ? undefined : slot.render(width)),
    panel: (width = 60) =>
      widgets.get("cadence-agents")?.component.render(width),
    summary: (width = 60) =>
      widgets.get("cadence-agents-summary")?.component.render(width),
    flush: () => new Promise((resolve) => setImmediate(resolve)),
  };
}
const DOWN = "\x1b[B",
  UP = "\x1b[A",
  ENTER = "\r",
  ESC = "\x1b",
  CTRL_C = "\x03";
function withTwo() {
  const h = host();
  h.emit("session_start");
  h.pi.events.emit(E.start, { id: "a", label: "Agent A", kind: "Explore" });
  h.pi.events.emit(E.start, { id: "b", label: "Agent B", kind: "Explore" });
  return h;
}

describe("Pi binding", () => {
  it("places the summary above and the panel below the editor, TUI only", () => {
    const h = host();
    h.ctx.mode = "rpc";
    h.emit("session_start");
    expect(h.widgets.size).toBe(0);
    h.ctx.mode = "tui";
    h.emit("session_start");
    // Nothing is mounted until an agent appears.
    expect(h.widgets.size).toBe(0);
    h.pi.events.emit(E.start, { id: "a" });
    expect(h.widgets.get("cadence-agents")?.placement).toBe("belowEditor");
    expect(h.widgets.get("cadence-agents-summary")?.placement).toBe(
      "aboveEditor",
    );
    h.emit("session_shutdown");
    expect(h.widgets.size).toBe(0);
    // A session that starts after agents exist mounts at once.
    h.emit("session_start");
    expect(h.panel()).toHaveLength(2);
  });

  it("shows bus agents at once and animates only while one runs", () => {
    vi.useFakeTimers();
    const h = host();
    h.emit("session_start");
    // Agents started before the session attached are still observed.
    h.pi.events.emit(E.start, { id: "a", label: "A", kind: "Explore" });
    h.pi.events.emit(E.start, { id: "b", label: "B", kind: "Explore" });
    expect(h.panel()).toHaveLength(3);
    expect(h.summary()?.[0]).toContain("2 background agents launched");
    const first = h.panel()![1];
    h.tui.requestRender.mockClear();
    h.at(T0 + 1000);
    vi.advanceTimersByTime(100);
    expect(h.tui.requestRender).toHaveBeenCalledTimes(1);
    expect(h.panel()![1]).not.toBe(first);
    expect(h.panel()![1]).toMatch(/ 1s$/);
    h.pi.events.emit(E.end, { id: "a", status: "done" });
    h.pi.events.emit(E.end, { id: "b", status: "error" });
    h.tui.requestRender.mockClear();
    vi.advanceTimersByTime(1000);
    expect(h.tui.requestRender).not.toHaveBeenCalled();
    expect(h.summary()).toEqual([
      expect.stringContaining("2 background agents finished (ok=1, failed=1)"),
    ]);
  });
});

describe("focus model", () => {
  it("leaves every input-box key to Pi, including Enter, Shift+Tab and Ctrl+J", () => {
    const h = withTwo();
    for (const data of [
      ENTER,
      "\x1b[Z", // shift+tab
      "\t",
      "\n", // ctrl+j: Pi's newline
      "a",
      UP,
      ESC,
      CTRL_C,
      "\x04", // ctrl+d
      "\x0e", // ctrl+n
      "\x10", // ctrl+p
      "\x15", // ctrl+u
      "\x1b[5~", // page up
    ])
      expect(h.key(data)).toBe("editor");
    // ↓ only enters the panel from an empty, focused input box with agents.
    h.type("draft");
    expect(h.key(DOWN)).toBe("editor");
    h.type("");
    h.overlay(true);
    expect(h.key(DOWN)).toBe("editor");
    h.overlay(false);
    h.dialog(true);
    expect(h.key(DOWN)).toBe("component");
    h.dialog(false);
    const empty = host();
    empty.emit("session_start");
    expect(empty.key(DOWN)).toBe("editor");
    expect(h.panel()![1].startsWith("⠋")).toBe(true);
  });

  it("moves the selection in F_panel and returns with Esc or ↑ past main", () => {
    const h = withTwo();
    expect(h.key(DOWN)).toBe("consumed");
    expect(h.panel()![1]).toMatch(/^\[▶⠋ Explore/);
    h.key(DOWN);
    expect(h.panel()![2]).toMatch(/^\[▶/);
    h.key(DOWN);
    expect(h.panel()![2]).toMatch(/^\[▶/);
    h.key("\x10"); // ctrl+p
    h.key(UP);
    expect(h.panel()![0]).toMatch(/^\[▶● main/);
    // Esc is the panel's, never Pi's interrupt.
    expect(h.key(ESC)).toBe("consumed");
    expect(h.panel()![0]).toBe("● main");
    h.key(DOWN);
    h.key(UP);
    expect(h.key(UP)).toBe("consumed");
    expect(h.panel()![0]).toBe("● main");
    expect(h.key("x")).toBe("editor");
  });

  it("in F_panel, Ctrl+D/U cannot exit or edit, and other keys return to the input", () => {
    const h = withTwo();
    h.key(DOWN);
    expect(h.key("\x04")).toBe("consumed");
    expect(h.key("\x15")).toBe("consumed");
    expect(h.key("\x1b[5~")).toBe("editor"); // main transcript scrolls itself
    expect(h.key(CTRL_C)).toBe("editor");
    expect(h.panel()![0]).toBe("● main");
    expect(h.key(DOWN)).toBe("consumed");
    expect(h.key("q")).toBe("editor");
    expect(h.key(DOWN)).toBe("consumed");
    // A dialog that takes focus gets its own keys.
    h.dialog(true);
    expect(h.key(DOWN)).toBe("component");
    h.dialog(false);
    expect(h.key(ENTER)).toBe("editor");
  });

  it("Enter opens the agent view; selection switches it; Esc, Ctrl+C or main return", async () => {
    const h = withTwo();
    h.key(DOWN);
    expect(h.key(ENTER)).toBe("consumed");
    expect(h.ctx.ui.custom).toHaveBeenCalledTimes(1);
    expect(h.view()![0]).toContain("→ viewing: Agent A");
    expect(h.view()!.at(-1)).toContain("Esc back to main");
    expect(h.summary()).toEqual([]);
    expect(h.panel()![1]).toMatch(/^\[▶/);
    h.key(DOWN);
    h.key(ENTER);
    expect(h.view()![0]).toContain("Agent B");
    expect(h.ctx.ui.custom).toHaveBeenCalledTimes(1);
    // Text input is disabled while viewing.
    expect(h.key("z")).toBe("component");
    expect(h.view()![0]).toContain("Agent B");
    h.key(ESC);
    await h.flush();
    expect(h.view()).toBeUndefined();
    expect(h.summary()![0]).toContain("launched");
    // Focus stays in the panel on the viewed row.
    expect(h.panel()![2]).toMatch(/^\[▶/);
    h.key(ENTER);
    expect(h.view()![0]).toContain("Agent B");
    h.key(CTRL_C);
    await h.flush();
    expect(h.view()).toBeUndefined();
    h.key(ENTER);
    h.key(UP);
    h.key(UP);
    h.key(ENTER);
    await h.flush();
    expect(h.view()).toBeUndefined();
    expect(h.panel()![0]).toMatch(/^\[▶● main/);
    h.key(ENTER);
    expect(h.panel()![0]).toBe("● main");
  });

  it("forgets a view Pi displaced, and never takes keys from the restored editor", async () => {
    const h = withTwo();
    h.key(DOWN);
    h.key(ENTER);
    h.dialog(true);
    expect(h.key(ESC)).toBe("component");
    h.restoreEditor();
    expect(h.key("x")).toBe("editor");
    expect(h.summary()![0]).toContain("launched");
    expect(h.panel()![0]).toBe("● main");
  });
});

describe("agent view", () => {
  initTheme("dark");
  const plain = (lines: string[] | undefined) =>
    (lines ?? []).map((l) => stripTerminalSequences(l)).join("\n");
  const say = (h: ReturnType<typeof host>, id: string, text: string) =>
    h.pi.events.emit(E.message, {
      id,
      message: { role: "user", content: text },
    });

  it("shows the agent's history and streams new output live", () => {
    const h = withTwo();
    say(h, "a", "Map the architecture");
    h.key(DOWN);
    h.key(ENTER);
    expect(plain(h.view(70))).toContain("Map the architecture");
    const assistant = (text: string, extra: object[] = []) => ({
      role: "assistant",
      content: [{ type: "text", text }, ...extra],
      stopReason: "toolUse",
    });
    h.pi.events.emit(E.message, {
      id: "a",
      message: assistant("Reading the ent"),
      streaming: true,
    });
    expect(plain(h.view(70))).toContain("Reading the ent");
    h.pi.events.emit(E.message, {
      id: "a",
      message: assistant("Reading the entry point.", [
        {
          type: "toolCall",
          id: "t1",
          name: "read",
          arguments: { path: "src/index.ts" },
        },
      ]),
    });
    h.pi.events.emit(E.message, {
      id: "a",
      message: {
        role: "toolResult",
        toolCallId: "t1",
        toolName: "read",
        content: [{ type: "text", text: "export default function register" }],
        isError: false,
      },
    });
    const text = plain(h.view(70));
    expect(text).not.toContain("Reading the ent\n");
    expect(text.match(/Reading the entry point\./g)).toHaveLength(1);
    expect(text).toContain("src/index.ts");
    for (const line of h.view(70)!)
      expect(visibleWidth(line)).toBeLessThanOrEqual(70);
    // Another agent's history is separate.
    h.key(DOWN);
    h.key(ENTER);
    expect(plain(h.view(70))).toContain("(no messages yet)");
  });

  it("remembers each view's scroll position across switches", async () => {
    const h = withTwo();
    for (let i = 0; i < 80; i++) say(h, "a", `a-line-${i}`);
    for (let i = 0; i < 80; i++) say(h, "b", `b-line-${i}`);
    h.key(DOWN);
    h.key(ENTER);
    // Follows the newest output by default.
    expect(plain(h.view())).toContain("a-line-79");
    h.key("\x1b[5~");
    h.key("\x1b[5~");
    const scrolled = plain(h.view());
    expect(scrolled).not.toContain("a-line-79");
    // New output does not move a scrolled-up view.
    say(h, "a", "a-line-80");
    expect(plain(h.view())).toBe(scrolled);
    h.key(DOWN);
    h.key(ENTER);
    expect(plain(h.view())).toContain("b-line-79");
    h.key("\x15"); // ctrl+u: half page
    const bScrolled = plain(h.view());
    expect(bScrolled).not.toContain("b-line-79");
    h.key(UP);
    h.key(ENTER);
    expect(plain(h.view())).toBe(scrolled);
    h.key(ESC);
    await h.flush();
    h.key(DOWN);
    h.key(ENTER);
    expect(plain(h.view())).toBe(bScrolled);
    // End follows again; Home goes to the top.
    h.key("\x1b[F");
    say(h, "b", "b-line-80");
    expect(plain(h.view())).toContain("b-line-80");
    h.key("\x1b[H");
    expect(plain(h.view())).toMatch(/b-line-0 /);
    expect(h.view()!.join("")).not.toContain("\x1b]133;");
    // Height fits the terminal above Z3 and the footer.
    expect(h.view()).toHaveLength(30 - 3 - 5);
  });

  it("keeps the view when its agent ends and shows the final facts", () => {
    const h = withTwo();
    h.key(DOWN);
    h.key(ENTER);
    h.at(T0 + 252_000);
    h.pi.events.emit(E.stats, { id: "a", tokensIn: 1_234_567 });
    h.pi.events.emit(E.end, { id: "a", status: "done" });
    expect(plain(h.view())).toContain("✔ finished (4m 12s · ↓1.2M)");
    h.pi.events.emit(E.end, { id: "b", status: "error", error: "boom" });
    h.key(DOWN);
    h.key(ENTER);
    expect(plain(h.view())).toContain("✘ failed (4m 12s)");
    expect(h.summary()).toEqual([]);
  });
});

describe("demo command", () => {
  it("plays two fake agents through the bus, one of which fails", async () => {
    vi.useFakeTimers();
    const h = withTwo();
    let demo: any;
    const notify = vi.fn();
    agentPanelDemo({
      events: h.pi.events,
      on: () => {},
      registerCommand: (_name: string, command: unknown) => {
        demo = command;
      },
    } as any);
    await demo.handler("", { ui: { notify } });
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Started 2 fake background agents"),
      "info",
    );
    h.at(T0 + 1000);
    await vi.advanceTimersByTimeAsync(1000);
    const rows = h.panel(100)!;
    expect(rows).toHaveLength(5);
    expect(rows.slice(3).every((row) => row.includes("Explore"))).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    const done = h.panel(100)!.slice(3);
    expect(done[0]).toMatch(/^✔ /);
    expect(done[1]).toMatch(/^✘ .*Provider rate limit/);
    // Each demo agent left a transcript with tool results.
    h.key(DOWN);
    h.key(DOWN);
    h.key(DOWN);
    h.key(ENTER);
    const view = h.view(100)!.join("\n");
    expect(view).toContain("src/native-client.ts");
    expect(view).toContain("composes the shell");
  });
});
