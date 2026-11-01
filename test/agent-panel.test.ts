/** Background-agent panel: the live batch above the input, its card in the
 * transcript, the on-demand list below the input and the Pi widget/bus/entry
 * binding through a fake Pi host. */
import { initTheme } from "@earendil-works/pi-coding-agent";
import {
  Editor,
  stripTerminalSequences,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import agentPanelDemo from "../scripts/agent-panel-demo.ts";
import { registerAgentPanel, SETTLE_MS } from "../src/agent-panel.ts";
import {
  CARD_ENTRY,
  cardLines,
  cardOf,
  decodeCard,
  SUBAGENT_EVENTS as E,
  type LiveFrame,
  liveLines,
  MAX_ENDED,
  type Paint,
  type PanelFrame,
  panelLines,
  SubagentStore,
} from "../src/agent-panel-model.ts";

afterEach(() => {
  vi.useRealTimers();
});
/** Plain text; reverse video shows as [brackets]. */
const paint: Paint = (role, text) => (role === "selected" ? `[${text}]` : text);
const T0 = 1_000_000;
/** A row whose facts sit at the right edge of `width`. */
const row = (left: string, right: string, width: number) =>
  left + " ".repeat(width - visibleWidth(left) - visibleWidth(right)) + right;

function agents(n: number, at = T0, kind = "Explore") {
  let now = at;
  const s = new SubagentStore(() => now);
  for (let i = 0; i < n; i++) {
    now = at + i;
    s.apply(E.start, {
      id: `a${i}`,
      label: `Analyze part ${i}`,
      kind,
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
const live = (s: SubagentStore, patch: Partial<LiveFrame> = {}) => ({
  agents: s.batch(),
  now: T0 + 283_000,
  frame: 0,
  maxRows: 6,
  hint: true,
  ...patch,
});
const list = (s: SubagentStore, patch: Partial<PanelFrame> = {}) => ({
  agents: s.ordered(),
  focus: "panel" as const,
  selected: undefined,
  view: undefined,
  now: T0 + 283_000,
  frame: 0,
  maxRows: 6,
  ...patch,
});

describe("live batch", () => {
  it("names a shared kind once and lists running then failed members", () => {
    const { s, at } = agents(4);
    s.apply(E.activity, {
      id: "a0",
      activity: "Inspecting observer.ts polling and sockets",
      tokensIn: 110_900,
    });
    at(T0 + 252_000);
    s.apply(E.end, { id: "a1", status: "done" });
    s.apply(E.end, { id: "a2", status: "error", error: "Rate limited" });
    s.apply(E.activity, { id: "a3", activity: "Analyze part 3 · Reading" });
    expect(liveLines(live(s), 76, paint)).toEqual([
      "⠋ 2 Explore agents running · 1 done · 1 failed (↓ to manage)",
      row(
        "  ├ ⠋ Analyze part 0 · Inspecting observer.ts polling a…",
        "4m 43s · ↓110.9k",
        76,
      ),
      row("  ├ ⠋ Analyze part 3 · Reading", "4m 43s", 76),
      row("  └ ✘ Analyze part 2 · Rate limited", "4m 12s", 76),
    ]);
    // The hint is only for the input box; a cleanly finished member is counted.
    expect(liveLines(live(s, { hint: false }), 76, paint)[0]).toBe(
      "⠋ 2 Explore agents running · 1 done · 1 failed",
    );
  });

  it("shows a kind column for mixed kinds and folds rows past maxRows", () => {
    const { s } = agents(3);
    s.apply(E.start, { id: "r", label: "Review", kind: "Review" });
    const lines = liveLines(live(s, { maxRows: 2 }), 60, paint);
    expect(lines[0]).toBe("⠋ 4 agents running (↓ to manage)");
    expect(lines[1]).toMatch(/^ {2}├ ⠋ Explore {2}Analyze part 0 +4m 43s$/);
    expect(lines.slice(2)).toEqual([
      expect.stringMatching(/^ {2}├ ⠋ Explore {2}Analyze part 1/),
      "  └ … +2 more",
    ]);
  });

  it("shows the card it will become once every member ended", () => {
    const { s, at } = agents(2);
    at(T0 + 134_000);
    s.apply(E.end, { id: "a0", status: "done" });
    s.apply(E.end, { id: "a1", status: "done" });
    const settled = liveLines(live(s), 80, paint);
    expect(settled).toEqual(["✔ 2 Explore agents finished · 2m 14s"]);
    expect(cardLines(cardOf(s.batch()), false, 80, paint, false)).toEqual(
      settled,
    );
    expect(liveLines(live(new SubagentStore()), 80, paint)).toEqual([]);
  });
});

describe("card", () => {
  const finished = () => {
    const { s, at } = agents(3);
    s.apply(E.activity, { id: "a0", activity: "Reading README.md" });
    at(T0 + 31_000);
    s.apply(E.end, { id: "a0", status: "done" });
    at(T0 + 48_000);
    s.apply(E.end, { id: "a1", status: "error", error: "Rate limited" });
    at(T0 + 62_000);
    s.apply(E.end, { id: "a2", status: "cancelled" });
    return cardOf(s.batch());
  };

  it("is one line when every member finished cleanly, all members when expanded", () => {
    const { s, at } = agents(2);
    at(T0 + 62_000);
    s.apply(E.end, { id: "a0", status: "done" });
    s.apply(E.end, { id: "a1", status: "done" });
    const card = cardOf(s.batch());
    expect(cardLines(card, false, 80, paint)).toEqual([
      "✔ 2 Explore agents finished · 1m 2s (ctrl+o to expand)",
    ]);
    expect(cardLines(card, true, 60, paint)).toEqual([
      "✔ 2 Explore agents finished · 1m 2s",
      row("  ├ ✔ Analyze part 0", "1m 2s", 60),
      row("  └ ✔ Analyze part 1", "1m 2s", 60),
    ]);
  });

  it("lists failed and cancelled members collapsed, with outcome counts", () => {
    const card = finished();
    expect(card.agents.map((a) => a.text)).toEqual([
      "Analyze part 0 · Reading README.md",
      "Analyze part 1 · Rate limited",
      "Analyze part 2",
    ]);
    expect(cardLines(card, false, 80, paint)).toEqual([
      // The expand hint gives way when it does not fit.
      "✘ 3 Explore agents finished · 1 done · 1 failed · 1 cancelled · 1m 2s",
      row("  ├ ✘ Analyze part 1 · Rate limited", "48s", 80),
      row("  └ ○ Analyze part 2", "1m 2s", 80),
    ]);
    expect(cardLines(card, true, 80, paint)).toHaveLength(4);
    const cancelled = { ...card, agents: [card.agents[0], card.agents[2]] };
    expect(cardLines(cancelled, false, 80, paint)[0]).toMatch(
      /^○ 2 Explore agents finished · 1 done · 1 cancelled/,
    );
    expect(
      cardLines({ ...card, omitted: 2 }, true, 80, paint).slice(-1),
    ).toEqual(["  └ … +2 more"]);
  });

  it("round-trips through the session and renders nothing for malformed data", () => {
    const card = finished();
    expect(decodeCard(JSON.parse(JSON.stringify(card)))).toEqual(card);
    for (const bad of [
      null,
      [],
      {},
      { ...card, agents: "x" },
      { ...card, omitted: -1 },
      { ...card, elapsed: "1s" },
      { ...card, agents: [], omitted: 0 },
      { ...card, agents: [{ ...card.agents[0], status: "running" }] },
      { ...card, agents: [{ ...card.agents[0], kind: "" }] },
      {
        ...card,
        agents: [{ ...card.agents[0], elapsed: Number.POSITIVE_INFINITY }],
      },
    ])
      expect(decodeCard(bad)).toBeUndefined();
    // Terminal controls from an edited file are flattened, not rendered.
    expect(
      decodeCard({
        ...card,
        agents: [{ ...card.agents[0], text: "\x1b[2Jx\ny" }],
      })?.agents[0].text,
    ).toBe("[2Jx y");
  });
});

describe("list below the input", () => {
  it("shows only while used, marks the selection and folds old rows", () => {
    const { s, at } = agents(5);
    expect(panelLines(list(s, { focus: "input" }), 50, paint)).toEqual([]);
    at(T0 + 100);
    s.apply(E.activity, { id: "a0", activity: "busy" });
    const lines = panelLines(
      list(s, { maxRows: 2, selected: "a3" }),
      50,
      paint,
    );
    expect(lines[0]).toBe("  +3 more");
    expect(lines[1]).toMatch(/^ ⠋ Explore {2}Analyze part 0 · busy/);
    expect(lines[2]).toMatch(/^\[▶⠋ Explore {2}Analyze part 3 +4m 43s\]$/);
    expect(visibleWidth(lines[2])).toBe(52);
    expect(lines[3]).toBe(" ↑↓ select · Enter open · Esc back to input");
    // While an agent view is open the rows stay, without the key hint.
    expect(
      panelLines(
        list(s, { maxRows: 2, view: "a3", selected: "a3" }),
        50,
        paint,
      ),
    ).toHaveLength(3);
  });

  it("never exceeds the width for long text, wide glyphs and any size", () => {
    const { s, at } = agents(2);
    s.apply(E.start, {
      id: "w",
      label: "宽",
      kind: "探索代理人员非常长的类型名",
    });
    s.apply(E.activity, { id: "w", activity: "读取文件".repeat(40) });
    s.apply(E.stats, { id: "w", tokensIn: 9_999_999, tokensOut: 1_200_000 });
    const running = liveLines(live(s), 80, paint);
    at(T0 + 9_000);
    s.apply(E.end, { id: "a0", status: "error", error: "失败".repeat(50) });
    s.apply(E.end, { id: "a1", status: "done" });
    s.apply(E.end, { id: "w", status: "cancelled" });
    const card = cardOf(s.batch());
    expect(running.length).toBe(4);
    for (let width = 1; width <= 130; width++)
      // The test paint shows reverse video as two brackets.
      for (const line of [
        ...liveLines(live(s), width, paint),
        ...cardLines(card, true, width, paint),
        ...cardLines(card, false, width, paint),
        ...panelLines(list(s), width, paint),
        ...panelLines(list(s, { selected: "w" }), width, paint),
      ])
        expect(visibleWidth(line)).toBeLessThanOrEqual(
          width + (line.startsWith("[") ? 2 : 0),
        );
  });
});

type Rendered = {
  render(width: number): string[];
  handleInput?(data: string): void;
};
type Renderer = (
  entry: { customType: string; data: unknown },
  options: { expanded: boolean },
  theme: unknown,
) => Rendered | undefined;
function host(options: { rows?: number; keep?: boolean } = {}) {
  const bus = new Map<string, Set<(data: unknown) => void>>();
  const handlers = new Map<
    string,
    ((event: unknown, ctx: unknown) => void)[]
  >();
  const widgets = new Map<
    string,
    { component: Rendered; placement?: string }
  >();
  const renderers = new Map<string, Renderer>();
  const entries: { customType: string; data: unknown }[] = [];
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
    registerEntryRenderer(customType: string, renderer: Renderer) {
      renderers.set(customType, renderer);
    },
    appendEntry: vi.fn((customType: string, data: unknown) => {
      // Pi stores entries as JSON.
      entries.push({ customType, data: JSON.parse(JSON.stringify(data)) });
    }),
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
  registerAgentPanel(pi as any, { now: () => clock, keep: options.keep });
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
    entries,
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
    live: (width = 60) =>
      widgets.get("cadence-agents")?.component.render(width),
    list: (width = 60) =>
      widgets.get("cadence-agents-list")?.component.render(width),
    /** The `n`th card as Pi would render it in the transcript. */
    card(n: number, expanded = false, width = 80) {
      const entry = entries[n];
      return renderers
        .get(entry.customType)?.(entry, { expanded }, theme)
        ?.render(width);
    },
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
  it("shows a batch above the input only while it runs, then leaves its card in the transcript", () => {
    vi.useFakeTimers();
    const h = host();
    h.ctx.mode = "rpc";
    h.emit("session_start");
    h.pi.events.emit(E.start, { id: "x", startedAt: T0 });
    expect(h.widgets.size).toBe(0);
    h.pi.events.emit(E.end, { id: "x", status: "done", endedAt: T0 });
    vi.advanceTimersByTime(SETTLE_MS);
    h.ctx.mode = "tui";
    h.emit("session_start");
    // Nothing is mounted until an agent runs.
    expect(h.widgets.size).toBe(0);
    h.pi.events.emit(E.start, { id: "a", label: "A", kind: "Explore" });
    h.pi.events.emit(E.start, { id: "b", label: "B", kind: "Explore" });
    expect(h.widgets.get("cadence-agents")?.placement).toBe("aboveEditor");
    expect(h.live()).toEqual([
      "⠋ 2 Explore agents running (↓ to manage)",
      row("  ├ ⠋ A", "0s", 60),
      row("  └ ⠋ B", "0s", 60),
    ]);
    // The list below the input takes no row until it is used.
    expect(h.list()).toEqual([]);
    // The spinner animates while one runs.
    const first = h.live()![0];
    h.tui.requestRender.mockClear();
    h.at(T0 + 1000);
    vi.advanceTimersByTime(100);
    expect(h.tui.requestRender).toHaveBeenCalledTimes(1);
    expect(h.live()![0]).not.toBe(first);
    h.at(T0 + 64_000);
    h.pi.events.emit(E.end, { id: "a", status: "done" });
    h.pi.events.emit(E.end, { id: "b", status: "error", error: "boom" });
    // Settled: the text it will keep, briefly, then the card replaces it.
    expect(h.live()).toEqual([
      "✘ 2 Explore agents finished · 1 done · 1 failed · 1m 4s",
      row("  └ ✘ B · boom", "1m 4s", 60),
    ]);
    h.tui.requestRender.mockClear();
    vi.advanceTimersByTime(SETTLE_MS - 1);
    expect(h.tui.requestRender).not.toHaveBeenCalled();
    expect(h.entries).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(h.live()).toBeUndefined();
    expect(h.list()).toEqual([]);
    expect(h.entries.map((e) => e.customType)).toEqual([CARD_ENTRY]);
    expect(h.card(0)).toEqual([
      " ✘ 2 Explore agents finished · 1 done · 1 failed · 1m 4s (ctrl+o to expand)",
      ` ${row("  └ ✘ B · boom", "1m 4s", 79)}`,
    ]);
    expect(h.card(0, true)).toHaveLength(3);
    // Nothing keeps rendering once the batch collapsed.
    h.tui.requestRender.mockClear();
    vi.advanceTimersByTime(10_000);
    expect(h.tui.requestRender).not.toHaveBeenCalled();
    h.emit("session_shutdown");
    expect(h.widgets.size).toBe(0);
  });

  it("joins a start during the settle time to the batch; a later start opens a new one", () => {
    vi.useFakeTimers();
    const h = host();
    h.emit("session_start");
    h.pi.events.emit(E.start, { id: "a", label: "A", kind: "Research" });
    h.pi.events.emit(E.end, { id: "a", status: "done" });
    vi.advanceTimersByTime(SETTLE_MS - 100);
    h.pi.events.emit(E.start, { id: "b", label: "B", kind: "Review" });
    vi.advanceTimersByTime(SETTLE_MS * 3);
    expect(h.entries).toEqual([]);
    expect(h.live()![0]).toMatch(
      /^. 1 agent running · 1 done \(↓ to manage\)$/,
    );
    h.pi.events.emit(E.end, { id: "b", status: "done" });
    vi.advanceTimersByTime(SETTLE_MS);
    h.pi.events.emit(E.start, { id: "c", label: "C", kind: "Review" });
    h.pi.events.emit(E.end, { id: "c", status: "done" });
    vi.advanceTimersByTime(SETTLE_MS);
    expect(h.entries.map((e) => (e.data as any).agents.length)).toEqual([2, 1]);
    expect(h.card(1)![0]).toMatch(/^ ✔ 1 Review agent finished · 0s/);
  });

  it("puts agents first seen settled in no batch and no card, but lists them", () => {
    vi.useFakeTimers();
    const h = host();
    h.emit("session_start");
    h.pi.events.emit(E.start, { id: "old", label: "Old", startedAt: null });
    h.pi.events.emit(E.end, { id: "old", status: "done" });
    vi.advanceTimersByTime(SETTLE_MS * 2);
    expect(h.live()).toBeUndefined();
    expect(h.entries).toEqual([]);
    expect(h.key(DOWN)).toBe("consumed");
    expect(h.list()![0]).toMatch(/^\[▶✔ agent {4}Old +— *\]$/);
  });

  it("writes a settled batch's card before leaving its session; running agents carry over", () => {
    vi.useFakeTimers();
    const h = host();
    h.emit("session_start");
    h.pi.events.emit(E.start, { id: "a", label: "A", kind: "Explore" });
    h.pi.events.emit(E.start, { id: "b", label: "B", kind: "Explore" });
    h.pi.events.emit(E.end, { id: "a", status: "done" });
    h.emit("session_shutdown");
    expect(h.entries).toEqual([]);
    expect(h.widgets.size).toBe(0);
    // The next session shows the batch that still runs, with its ended member.
    h.emit("session_start");
    expect(h.live()![0]).toBe(
      "⠋ 1 Explore agent running · 1 done (↓ to manage)",
    );
    h.pi.events.emit(E.end, { id: "b", status: "done" });
    h.emit("session_shutdown");
    expect(h.entries.map((e) => (e.data as any).agents.length)).toEqual([2]);
    // Ended agents belong to the session they ran in.
    h.emit("session_start");
    expect(h.key(DOWN)).toBe("editor");
    vi.advanceTimersByTime(SETTLE_MS);
    expect(h.entries).toHaveLength(1);
  });

  it("keeps at most MAX_ENDED ended agents for review", () => {
    vi.useFakeTimers();
    const h = host();
    h.emit("session_start");
    for (let i = 0; i < MAX_ENDED + 6; i++) {
      h.pi.events.emit(E.start, { id: `a${i}`, label: `A${i}` });
      h.pi.events.emit(E.end, { id: `a${i}`, status: "done" });
    }
    vi.advanceTimersByTime(SETTLE_MS);
    expect((h.entries[0].data as any).agents).toHaveLength(MAX_ENDED + 6);
    h.key(DOWN);
    expect(h.list()![0]).toBe(`  +${MAX_ENDED - 6} more`);
  });

  it("keeps a finished batch live instead of writing a card with CADENCE_AGENT_PANEL=always", () => {
    vi.useFakeTimers();
    const h = host({ keep: true });
    h.emit("session_start");
    h.pi.events.emit(E.start, { id: "a", label: "A", kind: "Explore" });
    h.pi.events.emit(E.end, { id: "a", status: "done" });
    vi.advanceTimersByTime(SETTLE_MS * 2);
    expect(h.entries).toEqual([]);
    expect(h.live()).toEqual(["✔ 1 Explore agent finished · 0s"]);
    h.pi.events.emit(E.start, { id: "b", label: "B", kind: "Review" });
    expect(h.live()![0]).toBe("⠋ 1 Review agent running (↓ to manage)");
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
    // ↓ only moves down from an empty, focused input box with agents.
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
    expect(h.list()).toEqual([]);
  });

  it("↓ opens the list below the input; ↑ past the first row or Esc closes it", () => {
    const h = withTwo();
    expect(h.key(DOWN)).toBe("consumed");
    expect(h.widgets.get("cadence-agents-list")?.placement).toBe("belowEditor");
    expect(h.list()![0]).toMatch(/^\[▶⠋ Explore {2}Agent A/);
    // The live hint is for the input box only.
    expect(h.live()![0]).toBe("⠋ 2 Explore agents running");
    h.key(DOWN);
    expect(h.list()![1]).toMatch(/^\[▶/);
    h.key(DOWN);
    expect(h.list()![1]).toMatch(/^\[▶/);
    h.key("\x10"); // ctrl+p
    expect(h.list()![0]).toMatch(/^\[▶/);
    expect(h.key(UP)).toBe("consumed");
    expect(h.list()).toEqual([]);
    expect(h.live()![0]).toContain("(↓ to manage)");
    h.key(DOWN);
    // Esc is the list's, never Pi's interrupt.
    expect(h.key(ESC)).toBe("consumed");
    expect(h.list()).toEqual([]);
    expect(h.key("x")).toBe("editor");
  });

  it("in the list, Ctrl+D/U cannot exit or edit, and other keys return to the input", () => {
    const h = withTwo();
    h.key(DOWN);
    expect(h.key("\x04")).toBe("consumed");
    expect(h.key("\x15")).toBe("consumed");
    expect(h.key("\x1b[5~")).toBe("editor"); // main transcript scrolls itself
    expect(h.key(CTRL_C)).toBe("editor");
    expect(h.list()).toEqual([]);
    expect(h.key(DOWN)).toBe("consumed");
    expect(h.key("q")).toBe("editor");
    expect(h.key(DOWN)).toBe("consumed");
    // A dialog that takes focus gets its own keys.
    h.dialog(true);
    expect(h.key(DOWN)).toBe("component");
    expect(h.list()).toEqual([]);
    h.dialog(false);
    expect(h.key(ENTER)).toBe("editor");
  });

  it("Enter opens the agent view; selection switches it; Esc or Ctrl+C return", async () => {
    const h = withTwo();
    h.key(DOWN);
    expect(h.key(ENTER)).toBe("consumed");
    expect(h.ctx.ui.custom).toHaveBeenCalledTimes(1);
    expect(h.view()![0]).toContain("→ viewing: Agent A");
    expect(h.view()!.at(-1)).toContain("Esc back to main");
    expect(h.live()).toEqual([]);
    expect(h.list()).toHaveLength(2);
    expect(h.list()![0]).toMatch(/^\[▶/);
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
    expect(h.live()![0]).toContain("running");
    // Focus stays in the list on the viewed row.
    expect(h.list()![1]).toMatch(/^\[▶/);
    h.key(ENTER);
    expect(h.view()![0]).toContain("Agent B");
    h.key(CTRL_C);
    await h.flush();
    expect(h.view()).toBeUndefined();
    h.key(ESC);
    expect(h.list()).toEqual([]);
  });

  it("forgets a view Pi displaced, and never takes keys from the restored editor", async () => {
    const h = withTwo();
    h.key(DOWN);
    h.key(ENTER);
    h.dialog(true);
    expect(h.key(ESC)).toBe("component");
    h.restoreEditor();
    expect(h.key("x")).toBe("editor");
    expect(h.live()![0]).toContain("running");
    expect(h.list()).toEqual([]);
  });

  it("writes the card of a batch that settles while viewed, keeping the view until Esc", async () => {
    vi.useFakeTimers();
    const h = withTwo();
    h.key(DOWN);
    h.key(ENTER);
    h.pi.events.emit(E.end, { id: "a", status: "done" });
    h.pi.events.emit(E.end, { id: "b", status: "done" });
    vi.advanceTimersByTime(SETTLE_MS);
    expect(h.entries).toHaveLength(1);
    expect(h.view()![0]).toContain("✔ finished");
    expect(h.list()).toHaveLength(2);
    h.key(ESC);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.list()).toHaveLength(3);
    h.key(ESC);
    expect(h.live()).toBeUndefined();
    expect(h.list()).toEqual([]);
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
    // Height fits the terminal above the list and the footer.
    expect(h.view()).toHaveLength(30 - 2 - 5);
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
    expect(h.live()).toEqual([]);
  });
});

describe("demo command", () => {
  it("plays a batch with one failure, then a review agent with its own card", async () => {
    vi.useFakeTimers();
    const h = host();
    h.emit("session_start");
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
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.live(100)).toHaveLength(3);
    // Each demo agent leaves a transcript with tool results.
    h.key(DOWN);
    h.key(ENTER);
    await vi.advanceTimersByTimeAsync(60_000);
    const view = h.view(100)!.join("\n");
    expect(view).toContain("src/native-client.ts");
    expect(view).toContain("composes the shell");
    h.key(ESC);
    h.key(ESC);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.entries).toHaveLength(2);
    expect(h.card(0, false, 100)).toEqual([
      expect.stringMatching(
        /^ ✘ 2 Explore agents finished · 1 done · 1 failed · \d+s \(ctrl\+o to expand\)$/,
      ),
      expect.stringMatching(/Provider rate limit \(demo failure\)/),
    ]);
    expect(h.card(1, false, 100)![0]).toMatch(/^ ✔ 1 Review agent finished/);
    expect(h.live()).toBeUndefined();
  });
});
