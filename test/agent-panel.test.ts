/** Readonly panel binding and the reused upstream agent session browser. */
import { getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Editor,
  KeybindingsManager,
  stripTerminalSequences,
  type TUI,
  TUI_KEYBINDINGS,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import agentPanelDemo from "../scripts/agent-panel-demo.ts";
import { cadenceBrowserSource } from "../src/agent-browser/source.ts";
import { TranscriptPane } from "../src/agent-browser/transcript-pane.ts";
import { registerAgentPanel, SETTLE_MS } from "../src/agent-panel.ts";
import {
  CARD_ENTRY,
  cardLines,
  cardOf,
  decodeCard,
  SUBAGENT_EVENTS as E,
  liveLines,
  type Paint,
  SubagentStore,
} from "../src/agent-panel-model.ts";

initTheme("dark");
afterEach(() => vi.useRealTimers());
const DOWN = "\x1b[B",
  UP = "\x1b[A",
  ENTER = "\r",
  ESC = "\x1b",
  PAGEUP = "\x1b[5~";
const plain = (lines: string[]) => lines.map(stripTerminalSequences).join("\n");
const paint: Paint = (_role, text) => text;
const keys = () =>
  new KeybindingsManager({
    ...TUI_KEYBINDINGS,
    "app.tools.expand": { defaultKeys: "ctrl+o", description: "Expand" },
  });
const theme = {
  fg: (_role: string, text: string) => text,
  bold: (text: string) => text,
  inverse: (text: string) => `[${text}]`,
  getThinkingBorderColor: () => (text: string) => text,
};

function host(
  options: {
    rows?: number;
    mode?: "fullscreen" | "regular";
    keep?: boolean;
  } = {},
) {
  const bus = new Map<string, ((data: any) => void)[]>();
  const handlers = new Map<string, ((event: unknown, ctx: any) => void)[]>();
  const entries: { customType: string; data: any }[] = [];
  const widgets = new Map<string, Component>();
  const renderers = new Map<string, any>();
  const editor = Object.create(Editor.prototype);
  let focused: any = editor,
    overlay = false,
    text = "",
    time = 1000;
  let listener:
    | ((data: string) => { consume?: boolean } | undefined)
    | undefined;
  let component: (Component & { dispose?(): void }) | undefined;
  const tui = {
    mode: options.mode ?? "fullscreen",
    terminal: { rows: options.rows ?? 30, columns: 80 },
    requestRender: vi.fn(),
    getFocusedComponent: () => focused,
    hasOverlay: () => overlay,
  };
  const pi = {
    events: {
      on: (event: string, fn: (data: any) => void) =>
        bus.set(event, [...(bus.get(event) ?? []), fn]),
      emit: (event: string, data: any) => {
        for (const fn of bus.get(event) ?? []) fn(data);
      },
    },
    on: (event: string, fn: (event: unknown, ctx: any) => void) =>
      handlers.set(event, [...(handlers.get(event) ?? []), fn]),
    registerEntryRenderer: (type: string, renderer: any) =>
      renderers.set(type, renderer),
    appendEntry: (customType: string, data: any) =>
      entries.push({ customType, data }),
  };
  const ctx = {
    mode: "tui",
    hasUI: true,
    cwd: "/fixture",
    ui: {
      notify: vi.fn(),
      getEditorText: () => text,
      onTerminalInput: (fn: typeof listener) => {
        listener = fn;
        return () => {
          listener = undefined;
        };
      },
      setWidget: (id: string, factory: any) => {
        if (factory) widgets.set(id, factory(tui, theme));
        else widgets.delete(id);
      },
      custom: vi.fn(
        (factory: any, opts: any) =>
          new Promise<void>((resolve) => {
            let closed = false;
            const done = () => {
              if (closed) return;
              closed = true;
              component?.dispose?.();
              component = undefined;
              focused = editor;
              overlay = false;
              resolve();
            };
            component = factory(tui, theme, keys(), done);
            focused = component;
            overlay = opts?.overlay === true;
          }),
      ),
    },
  };
  registerAgentPanel(pi as any, { now: () => time, keep: options.keep });
  const emit = (event: string) => {
    for (const fn of handlers.get(event) ?? []) fn({}, ctx);
  };
  return {
    pi,
    ctx,
    tui,
    entries,
    widgets,
    emit,
    start: (id: string, extra = {}) =>
      pi.events.emit(E.start, {
        id,
        label: `Agent ${id}`,
        kind: "Research",
        ...extra,
      }),
    end: (id: string, status = "done") => pi.events.emit(E.end, { id, status }),
    say: (id: string, content: string) =>
      pi.events.emit(E.message, { id, message: { role: "user", content } }),
    key(data: string) {
      if (listener?.(data)?.consume) return "consumed";
      if (focused === editor) return "editor";
      focused?.handleInput?.(data);
      return "component";
    },
    setText: (value: string) => {
      text = value;
    },
    focusDialog: () => {
      focused = { render: () => [] };
    },
    overlay: (value: boolean) => {
      overlay = value;
    },
    at: (value: number) => {
      time = value;
    },
    live: (width = 80) => widgets.get("cadence-agents")?.render(width) ?? [],
    view: (width = 80) => component?.render(width) ?? [],
    component: () => component,
    card: (index: number, expanded = false) =>
      renderers
        .get(CARD_ENTRY)(entries[index], { expanded }, theme)
        ?.render(80),
    flush: async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

function withAgents(n = 2, options: Parameters<typeof host>[0] = {}) {
  const h = host(options);
  h.emit("session_start");
  for (let i = 0; i < n; i++) h.start(String(i));
  return h;
}

describe("compact panel and durable cards", () => {
  it("shows only one live summary, then preserves the settled card", () => {
    vi.useFakeTimers();
    const h = withAgents();
    expect(h.live()).toHaveLength(1);
    expect(h.live()[0]).toContain("2 Research agents running");
    expect(h.live()[0]).toContain("↓ to view");
    const first = h.live()[0];
    vi.advanceTimersByTime(100);
    expect(h.live()[0]).not.toBe(first);
    h.at(65000);
    h.end("0");
    h.end("1", "error");
    expect(h.live()).toHaveLength(1);
    expect(h.live()[0]).toContain("1 failed");
    vi.advanceTimersByTime(SETTLE_MS);
    expect(h.live()).toEqual([]);
    expect(h.entries).toHaveLength(1);
    expect(h.card(0).join("\n")).toContain("1 failed");
    expect(h.card(0, true)).toHaveLength(3);
    h.tui.requestRender.mockClear();
    vi.advanceTimersByTime(1000);
    expect(h.tui.requestRender).not.toHaveBeenCalled();
    h.emit("session_shutdown");
    expect(h.widgets.size).toBe(0);
  });
  it("counts rejected reviews separately in the one-line summary and retained cards", () => {
    vi.useFakeTimers();
    const h = withAgents();
    h.end("0", "rejected");
    expect(h.live()).toHaveLength(1);
    expect(h.live()[0]).toContain("1 rejected");
    expect(h.live()[0]).not.toContain("failed");
    h.end("1");
    expect(h.live()[0]).toContain("⊘");
    expect(h.live()[0]).toContain("1 done · 1 rejected");
    vi.advanceTimersByTime(SETTLE_MS);
    expect(h.live()).toEqual([]);
    expect(h.entries).toHaveLength(1);
    const card = h.entries[0].data;
    expect(decodeCard(JSON.parse(JSON.stringify(card)))).toEqual(card);
    expect(card.agents.map((a: { status: string }) => a.status)).toEqual([
      "rejected",
      "done",
    ]);
    expect(h.card(0)).toHaveLength(2);
    expect(h.card(0).join("\n")).toContain("1 done · 1 rejected");
    expect(h.card(0).join("\n")).not.toContain("failed");
    expect(h.card(0, true)).toHaveLength(3);
    h.emit("session_shutdown");
  });
  it("keeps failures and cancellations distinct beside a rejected review", () => {
    vi.useFakeTimers();
    const h = withAgents(4);
    h.end("0", "rejected");
    h.end("1", "error");
    h.end("2", "cancelled");
    expect(h.live()[0]).toContain("1 failed · 1 rejected · 1 cancelled");
    h.end("3");
    vi.advanceTimersByTime(SETTLE_MS);
    expect(h.card(0)[0]).toContain("✘");
    expect(h.card(0)[0]).toContain(
      "1 done · 1 failed · 1 rejected · 1 cancelled",
    );
    expect(h.card(0)).toHaveLength(4);
    expect(decodeCard(h.entries[0].data)?.agents.map((a) => a.status)).toEqual([
      "rejected",
      "error",
      "cancelled",
      "done",
    ]);
    h.emit("session_shutdown");
  });
  it("joins a new start during settlement but cards a later batch separately", () => {
    vi.useFakeTimers();
    const h = withAgents(1);
    h.end("0");
    vi.advanceTimersByTime(SETTLE_MS - 1);
    h.start("1");
    vi.advanceTimersByTime(SETTLE_MS);
    expect(h.entries).toHaveLength(0);
    h.end("1");
    vi.advanceTimersByTime(SETTLE_MS);
    h.start("2");
    h.end("2");
    vi.advanceTimersByTime(SETTLE_MS);
    expect(h.entries.map((entry) => entry.data.agents.length)).toEqual([2, 1]);
  });
  it("keeps only a summary with keep, without a session card", () => {
    vi.useFakeTimers();
    const h = withAgents(1, { keep: true });
    h.end("0");
    vi.advanceTimersByTime(SETTLE_MS);
    expect(h.entries).toEqual([]);
    expect(h.live()).toHaveLength(1);
    expect(h.live()[0]).toContain("finished");
    expect(h.key(DOWN)).toBe("editor");
  });
  it("does not activate outside TUI or repeat a card for a first-seen settled child", () => {
    vi.useFakeTimers();
    const h = host();
    h.ctx.mode = "rpc";
    h.emit("session_start");
    h.start("old", { startedAt: null });
    h.end("old");
    expect(h.widgets.size).toBe(0);
    h.ctx.mode = "tui";
    h.emit("session_start");
    h.start("retained", { startedAt: null });
    h.end("retained");
    vi.advanceTimersByTime(SETTLE_MS);
    expect(h.live()).toEqual([]);
    expect(h.entries).toEqual([]);
    expect(h.key(DOWN)).toBe("editor");
    expect(h.ctx.ui.custom).not.toHaveBeenCalled();
    h.emit("session_shutdown");
  });
  it("cards a settled batch on departure, but never carries live agents to a new session", () => {
    vi.useFakeTimers();
    const h = withAgents();
    h.end("0");
    h.emit("session_shutdown");
    expect(h.entries).toEqual([]);
    h.emit("session_start");
    expect(h.live()).toEqual([]);
    expect(h.key(DOWN)).toBe("editor");
    h.end("1");
    expect(h.entries).toEqual([]);
    h.start("new");
    h.end("new");
    h.emit("session_shutdown");
    expect(h.entries).toHaveLength(1);
    expect(h.entries[0].data.agents).toHaveLength(1);
  });
  it("keeps an open transcript as a snapshot, not an ended list or producer subscription", async () => {
    vi.useFakeTimers();
    const h = withAgents(30);
    const views: any[] = [];
    h.pi.events.on("subagent:view", (event) => views.push(event.id));
    h.key(DOWN);
    h.key(ENTER);
    h.say("0", "final output");
    for (let i = 0; i < 30; i++) h.end(String(i));
    vi.advanceTimersByTime(SETTLE_MS);
    expect(h.entries).toHaveLength(1);
    expect(plain(h.view())).toContain("final output");
    expect(views.at(-1)).toBe(null);
    h.key(ESC);
    expect(plain(h.view())).toContain("0 / 0");
    expect(plain(h.view())).toContain("No agents running in this session");
    expect(plain(h.view())).not.toContain("Agent 0");
    h.key(ESC);
    await h.flush();
    expect(h.key(DOWN)).toBe("editor");
    h.emit("session_shutdown");
  });
  it("removes completed rows immediately and keeps the nearest live selection", () => {
    const h = withAgents(3);
    h.key(DOWN);
    h.key(DOWN);
    h.end("1");
    expect(plain(h.view())).toContain("2 / 2");
    expect(plain(h.view())).not.toContain("Agent 1");
    h.key(ENTER);
    expect(plain(h.view())).toContain("Agent 2");
    h.emit("session_shutdown");
  });
  it("does not open a stale row when it ends between rendering and Enter", () => {
    const h = withAgents(1);
    const views: any[] = [];
    h.pi.events.on("subagent:view", (event) => views.push(event.id));
    h.key(DOWN);
    h.view();
    h.end("0");
    h.key(ENTER);
    expect(views).not.toContain("0");
    expect(plain(h.view())).toContain("No agents running in this session");
    h.emit("session_shutdown");
  });
  it("does not open a stale row when it ends between mouse press and click", () => {
    const h = withAgents(2);
    const views: any[] = [];
    h.pi.events.on("subagent:view", (event) => views.push(event.id));
    h.key(DOWN);
    h.view();
    const event = { button: "left", x: 3, y: 1, width: 80, height: 4 };
    h.component()?.handleMouse?.({ ...event, type: "press" } as any);
    h.end("0");
    // No render has happened yet: this click still names the old first row.
    h.component()?.handleMouse?.({ ...event, type: "click" } as any);
    expect(views).not.toContain("0");
    expect(views).not.toContain("1");
    expect(plain(h.view())).not.toContain("Agent 0");
    h.emit("session_shutdown");
  });
  it("validates retained cards and fits Unicode rows to terminal width", () => {
    const s = new SubagentStore(() => 1000);
    s.apply(E.start, { id: "a", label: "读取文件".repeat(40) });
    s.apply(E.end, { id: "a", status: "error", error: "失败".repeat(50) });
    const card = cardOf(s.batch());
    expect(decodeCard(JSON.parse(JSON.stringify(card)))).toEqual(card);
    for (const bad of [
      null,
      {},
      { ...card, agents: [] },
      { ...card, omitted: -1 },
      { ...card, agents: [{ ...card.agents[0], status: "running" }] },
    ])
      expect(decodeCard(bad)).toBeUndefined();
    for (let width = 1; width < 100; width++)
      for (const line of cardLines(card, true, width, paint))
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    expect(
      liveLines({ agents: [], now: 0, frame: 0, hint: true }, 80, paint),
    ).toEqual([]);
  });
});

describe("upstream agent browser integration", () => {
  it("leaves editor, dialog, overlay and key-release input alone", () => {
    const h = withAgents();
    for (const key of [
      ENTER,
      UP,
      ESC,
      "\x03",
      "\x04",
      "\x0e",
      "\x10",
      "\x1b[Z",
      "\n",
      "x",
      PAGEUP,
      "\x1b[1;1:3B",
    ])
      expect(h.key(key)).toBe("editor");
    h.setText("draft");
    expect(h.key(DOWN)).toBe("editor");
    h.setText("");
    h.overlay(true);
    expect(h.key(DOWN)).toBe("editor");
    h.overlay(false);
    h.focusDialog();
    expect(h.key(DOWN)).toBe("component");
    expect(h.ctx.ui.custom).not.toHaveBeenCalled();
    h.emit("session_shutdown");
  });
  it("mounts fullscreen browsing as one overlay; Esc returns to the same list", async () => {
    const h = withAgents();
    expect(h.key(DOWN)).toBe("consumed");
    expect(h.ctx.ui.custom.mock.calls[0][1]).toMatchObject({ overlay: true });
    h.key(DOWN);
    h.key(ENTER);
    expect(plain(h.view())).toContain("Agent 1");
    expect(h.live()).toEqual([]);
    h.key(ESC);
    expect(plain(h.view())).toContain("2 / 2");
    expect(h.ctx.ui.custom).toHaveBeenCalledTimes(1);
    h.key(ESC);
    await h.flush();
    expect(h.view()).toEqual([]);
    expect(h.live()).toHaveLength(1);
    h.emit("session_shutdown");
  });
  it("retains rejection in the open transcript and card, not the live list", () => {
    vi.useFakeTimers();
    const h = withAgents(1);
    h.say("0", "Review found a missing acceptance test.");
    h.key(DOWN);
    h.key(ENTER);
    expect(plain(h.view())).toContain("running");
    h.end("0", "rejected");
    expect(plain(h.view())).toContain("rejected");
    expect(plain(h.view())).toContain(
      "Review found a missing acceptance test.",
    );
    expect(plain(h.view())).not.toContain("error");
    h.key(ESC);
    expect(plain(h.view())).toContain("No agents running in this session");
    vi.advanceTimersByTime(SETTLE_MS);
    expect(plain(h.card(0))).toContain("rejected");
    expect(plain(h.card(0))).not.toContain("failed");
    h.emit("session_shutdown");
  });
  it("uses the upstream docked mount in regular mode, without changing the browser", () => {
    const h = withAgents(2, { mode: "regular" });
    h.key(DOWN);
    expect(h.ctx.ui.custom.mock.calls[0][1]).toEqual({ overlay: false });
    h.emit("session_shutdown");
  });
  it("scrolls a continuous list and preserves selection while other agents update", () => {
    const h = withAgents(18);
    h.key(DOWN);
    for (let i = 0; i < 12; i++) h.key(DOWN);
    const before = plain(h.view());
    expect(before).toContain("13 / 18");
    const ids = [...before.matchAll(/Agent (\d+)/g)].map((m) => Number(m[1]));
    expect(ids.length).toBeGreaterThan(3);
    expect(ids).toEqual(
      Array.from({ length: ids.length }, (_, i) => ids[0] + i),
    );
    h.pi.events.emit(E.activity, { id: "0", activity: "New activity" });
    h.start("18");
    expect(plain(h.view())).toContain("13 / 19");
    h.key(ENTER);
    expect(plain(h.view())[0]).toBeDefined();
    expect(plain(h.view())).toContain("Agent 12");
    h.emit("session_shutdown");
  });
  it("arrows scroll the transcript; new output does not move paused reading; each agent remembers its position", () => {
    const h = withAgents();
    for (let i = 0; i < 80; i++) {
      h.say("0", `a-line-${i}`);
      h.say("1", `b-line-${i}`);
    }
    h.key(DOWN);
    h.key(ENTER);
    expect(plain(h.view())).toContain("a-line-79");
    h.key(UP);
    expect(plain(h.view())).toContain("paused");
    h.key(PAGEUP);
    const content = h.view().slice(1, -1);
    h.say("0", "a-line-80");
    expect(h.view().slice(1, -1)).toEqual(content);
    h.key(ESC);
    h.key(DOWN);
    h.key(ENTER);
    expect(plain(h.view())).toContain("b-line-79");
    h.key(ESC);
    h.key(UP);
    h.key(ENTER);
    expect(h.view().slice(1, -1)).toEqual(content);
    h.key("\x1b[F");
    expect(plain(h.view())).toContain("a-line-80");
    h.key("\x1b[H");
    expect(plain(h.view())).toContain("a-line-0");
    h.emit("session_shutdown");
  });
  it("renders streamed messages and retained tool results without unmatched prompt marks", () => {
    const h = withAgents(1);
    h.key(DOWN);
    h.key(ENTER);
    const assistant = (text: string) => ({
      role: "assistant",
      content: [{ type: "text", text }],
    });
    h.pi.events.emit(E.message, {
      id: "0",
      message: assistant("partial"),
      streaming: true,
    });
    expect(plain(h.view())).toContain("partial");
    h.pi.events.emit(E.message, {
      id: "0",
      message: assistant("finished text"),
    });
    expect(plain(h.view())).not.toContain("partial");
    h.pi.events.emit(E.message, {
      id: "0",
      message: {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "read1",
            name: "read",
            arguments: { path: "file.ts" },
          },
        ],
      },
    });
    h.pi.events.emit(E.message, {
      id: "0",
      message: {
        role: "toolResult",
        toolCallId: "read1",
        toolName: "read",
        content: [{ type: "text", text: "retained result" }],
      },
    });
    expect(plain(h.view())).toContain("file.ts");
    h.key("\x0f");
    expect(plain(h.view())).toContain("retained result");
    h.say("0", "user");
    expect(h.view().join("")).not.toContain("\x1b]133;");
    h.emit("session_shutdown");
  });
  it("keeps short transcripts compact and fits narrow/short terminals", () => {
    const h = withAgents(1);
    h.say("0", "short");
    h.key(DOWN);
    h.key(ENTER);
    expect(h.view().length).toBeLessThan(10);
    for (const rows of [6, 12, 24, 40])
      for (const width of [6, 20, 80]) {
        h.tui.terminal.rows = rows;
        const rendered = h.view(width);
        expect(rendered.length).toBeLessThanOrEqual(rows);
        for (const line of rendered)
          expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    h.emit("session_shutdown");
  });
  it("only announces the viewed child and detaches on shutdown without control commands", () => {
    const h = withAgents();
    const views: any[] = [];
    h.pi.events.on("subagent:view", (event) => views.push(event.id));
    h.key(DOWN);
    expect(views).toEqual([]);
    h.key(ENTER);
    expect(views).toEqual(["0"]);
    h.key(ESC);
    expect(views.at(-1)).toBe(null);
    h.key(DOWN);
    h.key(ENTER);
    expect(views.at(-1)).toBe("1");
    h.emit("session_shutdown");
    expect(views.at(-1)).toBe(null);
    expect(h.view()).toEqual([]);
    expect(h.widgets.size).toBe(0);
  });
});

describe("adapted upstream transcript pane", () => {
  it("honours remapped paging and consumes wheel only", () => {
    const store = new SubagentStore();
    store.apply(E.start, { id: "a" });
    store.apply(E.message, {
      id: "a",
      message: {
        role: "user",
        content: Array.from({ length: 100 }, (_, i) => `r${i}`).join("\n"),
      },
    });
    const entry = cadenceBrowserSource(store, () => {}, Date.now).entries()[0];
    const tui = { terminal: { rows: 24, columns: 80 }, requestRender: vi.fn() };
    const pane = new TranscriptPane({
      tui: tui as unknown as TUI,
      theme: theme as any,
      keys: new KeybindingsManager(TUI_KEYBINDINGS, {
        "tui.altScreen.pageUp": "ctrl+b",
      }),
      source: entry.source,
      heading: entry.heading,
      cwd: "/fixture",
      done: () => {},
      markdownTheme: getMarkdownTheme(),
      position: { offset: 0, follow: true },
    });
    const before = pane.render(80);
    pane.handleInput(PAGEUP);
    expect(pane.render(80)).toEqual(before);
    pane.handleInput("\x02");
    expect(pane.render(80)).not.toEqual(before);
    const at = pane.render(80);
    expect(pane.handleMouse({ type: "wheel", wheelDelta: -3 } as any)).toEqual({
      handled: true,
    });
    expect(pane.render(80)).not.toEqual(at);
    expect(pane.handleMouse({ type: "click" } as any)).toBeUndefined();
    pane.dispose();
  });
});

it("keeps the fake-agent demo's two settled cards without executing work", async () => {
  vi.useFakeTimers();
  const h = host();
  h.emit("session_start");
  let demo: any;
  agentPanelDemo({
    ...h.pi,
    registerCommand: (_name: string, command: unknown) => {
      demo = command;
    },
  } as any);
  await demo.handler("", { ui: { notify: vi.fn() } });
  await vi.advanceTimersByTimeAsync(1000);
  h.key(DOWN);
  h.key(ENTER);
  await vi.advanceTimersByTimeAsync(60000);
  expect(plain(h.view(100))).toContain("src/native-client.ts");
  h.key(ESC);
  h.key(ESC);
  await h.flush();
  await vi.advanceTimersByTimeAsync(60000);
  expect(h.entries).toHaveLength(2);
  expect(h.card(0).join("\n")).toContain("1 failed");
  expect(h.card(1).join("\n")).toContain("Review agent");
  expect(h.live()).toEqual([]);
  h.emit("session_shutdown");
});
