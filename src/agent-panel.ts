/** Background-agent panel for Pi's TUI. Observation only: it subscribes to
 * the `subagent:*` events on Pi's shared extension bus and renders them; it
 * never starts, cancels or keeps an agent or the Pi process alive. */
import {
  AssistantMessageComponent,
  type ExtensionAPI,
  type ExtensionContext,
  getMarkdownTheme,
  type Theme,
  ToolExecutionComponent,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Container,
  Editor,
  isKeyRelease,
  Key,
  type KeyId,
  matchesKey,
  Spacer,
  Text,
  type TUI,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import {
  factsText,
  type Paint,
  type PanelAction,
  PanelFocus,
  type PanelKey,
  panelLines,
  SUBAGENT_EVENTS,
  SUBAGENT_VIEW,
  type SubagentState,
  SubagentStore,
  statusSymbol,
  summaryLines,
} from "./agent-panel-model.ts";

export interface AgentPanelOptions {
  /** Agent rows shown at once; more collapse into `+K more`. */
  maxRows?: number;
  /** Keep `● main` visible with no agents (CADENCE_AGENT_PANEL=always). */
  showEmpty?: boolean;
  now?: () => number;
}
const PANEL = "cadence-agents",
  SUMMARY = "cadence-agents-summary",
  SPIN_MS = 100;

/** Rows kept for Pi's footer/status lines while an agent view is shown. */
const RESERVED = 5;
const KEYS: [KeyId, PanelKey][] = [
  [Key.down, "down"],
  [Key.up, "up"],
  [Key.ctrl("n"), "next"],
  [Key.ctrl("p"), "previous"],
  [Key.enter, "enter"],
  [Key.escape, "escape"],
  [Key.ctrl("c"), "interrupt"],
  [Key.pageUp, "pageUp"],
  [Key.pageDown, "pageDown"],
  [Key.ctrl("u"), "halfUp"],
  [Key.ctrl("d"), "halfDown"],
  [Key.home, "home"],
  [Key.end, "end"],
];
/** Key releases (Kitty protocol) stay Pi's. */
export function panelKey(data: string): PanelKey | undefined {
  if (isKeyRelease(data)) return undefined;
  return KEYS.find(([id]) => matchesKey(data, id))?.[1] ?? "other";
}

const themePaint =
  (theme: Theme): Paint =>
  (role, text) =>
    role === "selected" ? theme.inverse(text) : theme.fg(role, text);

export function registerAgentPanel(
  pi: ExtensionAPI,
  options: AgentPanelOptions = {},
): void {
  const store = new SubagentStore(options.now);
  for (const channel of Object.values(SUBAGENT_EVENTS))
    pi.events.on(channel, (data) => {
      store.apply(channel, data);
    });
  let detach: (() => void) | undefined;
  pi.on("session_start", (_event, ctx) => {
    detach?.();
    detach =
      ctx.mode === "tui" && ctx.hasUI
        ? attachPanel(ctx, store, options, (id) =>
            pi.events.emit(SUBAGENT_VIEW, { id }),
          )
        : undefined;
  });
  pi.on("session_shutdown", () => {
    detach?.();
    detach = undefined;
  });
}

function attachPanel(
  ctx: ExtensionContext,
  store: SubagentStore,
  options: AgentPanelOptions,
  announce: (id: string | null) => void,
): () => void {
  const now = options.now ?? Date.now;
  const maxRows = Math.max(1, options.maxRows ?? 6);
  const showEmpty =
    options.showEmpty ?? process.env.CADENCE_AGENT_PANEL === "always";
  const focus = new PanelFocus(store);
  let tui: TUI | undefined,
    paint: Paint = (_role, text) => text,
    frame = 0,
    spinner: ReturnType<typeof setInterval> | undefined,
    view: { component: Component; done: () => void } | undefined,
    // Widgets mount with the first agent, so ordinary sessions show nothing.
    mounted = false,
    // The agent last announced on `subagent:view`, so producers load only it.
    announced: string | undefined;
  const announceView = () => {
    if (focus.view === announced) return;
    announced = focus.view;
    announce(announced ?? null);
  };
  const transcripts = new Map<string, Transcript>();
  const stopSpinner = () => {
    clearInterval(spinner);
    spinner = undefined;
  };
  // One redraw per spinner frame while anything runs; Pi's differential
  // renderer rewrites only the changed rows.
  const changed = () => {
    if (!mounted && (store.size > 0 || showEmpty)) mount();
    if (store.running() === 0) stopSpinner();
    else if (!spinner) {
      spinner = setInterval(() => {
        frame++;
        changed();
      }, SPIN_MS);
      spinner.unref?.();
    }
    tui?.requestRender();
  };
  const unsubscribe = store.subscribe(changed);
  const focused = () =>
    (
      tui as { getFocusedComponent?(): Component | null } | undefined
    )?.getFocusedComponent?.();
  /** Pi's own input box has focus: no dialog, selector or overlay is up. */
  const editorFocused = () => focused() instanceof Editor && !tui?.hasOverlay();
  const act = (action: PanelAction) => {
    if (action === "open") openView();
    else if (action === "close") view?.done();
    announceView();
    tui?.requestRender();
    return action === "pass" ? undefined : { consume: true };
  };
  const unlisten = ctx.ui.onTerminalInput((data) => {
    if (focus.view !== undefined) {
      // The view handles its own keys. Pi may have put its editor back in the
      // view's slot (another dialog came and went); then the view is gone.
      if (!(focused() instanceof Editor)) return undefined;
      focus.abandon();
      view = undefined;
      announceView();
    }
    if (focus.focus === "panel" && !editorFocused()) {
      // A dialog took focus: its keys are not the panel's.
      focus.focus = "input";
      tui?.requestRender();
      return undefined;
    }
    const key = panelKey(data);
    if (!key) return undefined;
    const idle = ctx.ui.getEditorText() === "" && editorFocused();
    return act(focus.key(key, idle));
  });

  const openView = () => {
    void ctx.ui
      .custom<void>((_tui, _theme, _keybindings, done) => {
        const component: Component = {
          render: (width) => viewLines(width),
          handleInput(data) {
            const key = panelKey(data);
            if (key) act(focus.key(key, false));
          },
          invalidate() {},
        };
        view = { component, done: () => done() };
        return component;
      })
      .finally(() => {
        view = undefined;
        tui?.requestRender();
      });
  };
  const panelFrame = () => ({
    agents: store.ordered(),
    focus: focus.focus,
    selected: focus.selected,
    view: focus.view,
    now: now(),
    frame,
    maxRows,
    showEmpty,
  });
  const viewLines = (width: number): string[] => {
    const agent = focus.view === undefined ? undefined : store.get(focus.view);
    if (!agent) return [];
    const panelHeight = panelLines(panelFrame(), width, paint).length;
    const height = Math.max(
      3,
      (tui?.terminal.rows ?? 24) - panelHeight - RESERVED,
    );
    let transcript = transcripts.get(agent.id);
    if (!transcript && tui) {
      transcript = new Transcript(tui, ctx.cwd, ctx.ui.getToolsExpanded());
      transcripts.set(agent.id, transcript);
    }
    const body = transcript?.render(agent, width, paint) ?? [];
    const top = focus.settle(agent.id, body.length, height - 2);
    const rows = body.slice(top, top + height - 2);
    while (rows.length < height - 2) rows.push("");
    return [
      truncateToWidth(banner(agent), width, "…"),
      ...rows,
      truncateToWidth(
        paint(
          "dim",
          "↑↓ select · Enter open · PgUp/PgDn scroll · Esc back to main",
        ),
        width,
        "…",
      ),
    ];
  };
  const banner = (agent: SubagentState): string => {
    if (agent.status === "running")
      return paint(
        "dim",
        `→ viewing: ${agent.label}   (Esc to return to main)`,
      );
    const [symbol, role] = statusSymbol(agent, frame);
    const word = { done: "finished", error: "failed", cancelled: "cancelled" }[
      agent.status
    ];
    const facts = factsText(agent, now());
    return `${paint(role, `${symbol} ${word}`)}${paint(
      "dim",
      ` (${facts}) · ${agent.label}   (Esc to return to main)`,
    )}`;
  };

  const mount = () => {
    mounted = true;
    ctx.ui.setWidget(
      SUMMARY,
      (t, theme) => {
        tui = t;
        paint = themePaint(theme);
        return {
          // The agent view takes Z1's place; its summary would sit above it.
          render: (width) =>
            view ? [] : summaryLines(store.ordered(), width, paint, maxRows),
          invalidate() {},
        };
      },
      { placement: "aboveEditor" },
    );
    ctx.ui.setWidget(
      PANEL,
      (t, theme) => {
        tui = t;
        paint = themePaint(theme);
        return {
          render: (width) => panelLines(panelFrame(), width, paint),
          invalidate() {},
        };
      },
      { placement: "belowEditor" },
    );
  };
  changed();
  return () => {
    unsubscribe();
    unlisten();
    stopSpinner();
    if (announced !== undefined) announce(null);
    try {
      view?.done();
      if (mounted) {
        ctx.ui.setWidget(SUMMARY, undefined);
        ctx.ui.setWidget(PANEL, undefined);
      }
    } catch {
      // A replaced runtime already cleared its UI.
    }
  };
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: match OSC 133 terminal marks
const OSC_133 = /\x1b\]133;[^\x07\x1b]*(?:\x07|\x1b\\)/g;
type Message = Record<string, unknown> & { content?: unknown };
const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .map((block) =>
            block?.type === "text"
              ? String(block.text ?? "")
              : block?.type === "image"
                ? "[image]"
                : "",
          )
          .filter(Boolean)
          .join("\n")
      : "";

/** One agent's messages as Pi's own transcript components, the way Pi renders
 * a resumed session. Only the tail is rebuilt: new messages, a replaced
 * streaming snapshot, or everything once older messages were dropped. */
class Transcript {
  private readonly root = new Container();
  private parts: Component[][] = [];
  private tail: object | undefined;
  private tailStreaming = false;
  private omitted = 0;
  private revision = -1;
  private readonly tools = new Map<string, ToolExecutionComponent>();
  constructor(
    private readonly tui: TUI,
    private readonly cwd: string,
    private readonly expanded: boolean,
  ) {}

  render(agent: SubagentState, width: number, paint: Paint): string[] {
    this.sync(agent);
    // Pi marks its own prompts for terminal shell integration; a sliced view
    // of another agent's prompts must not open unmatched marks.
    let lines: string[];
    try {
      lines = this.root.render(width).map((line) => line.replace(OSC_133, ""));
    } catch {
      // Producer data must never break Pi's own render loop.
      lines = [paint("error", " (this transcript could not be rendered)")];
    }
    if (agent.omitted)
      lines.unshift(
        paint("dim", `… ${agent.omitted} earlier messages not retained`),
      );
    if (!agent.messages.length) lines.push(paint("dim", " (no messages yet)"));
    return lines;
  }
  private sync(agent: SubagentState): void {
    if (agent.revision === this.revision) return;
    this.revision = agent.revision;
    const { messages } = agent;
    if (agent.omitted !== this.omitted) {
      this.root.clear();
      this.parts = [];
      this.tools.clear();
      this.omitted = agent.omitted;
    }
    let from = this.parts.length;
    // A streaming snapshot may be replaced or mutated in place.
    if (from > 0 && (this.tailStreaming || messages[from - 1] !== this.tail))
      from--;
    for (const part of this.parts.splice(from))
      for (const component of part) this.root.removeChild(component);
    for (let i = from; i < messages.length; i++) {
      const last = i === messages.length - 1;
      const part = this.build(messages[i] as Message, last && agent.streaming);
      for (const component of part) this.root.addChild(component);
      this.parts.push(part);
    }
    this.tail = messages.at(-1);
    this.tailStreaming = agent.streaming;
  }
  private build(message: Message, streaming: boolean): Component[] {
    switch (message.role) {
      case "user": {
        const text = textOf(message.content);
        return text
          ? [new Spacer(1), new UserMessageComponent(text, getMarkdownTheme())]
          : [];
      }
      case "assistant": {
        // Pi's component assumes well-formed blocks; keep only those.
        const content = (
          Array.isArray(message.content) ? message.content : []
        ).filter(
          (b) =>
            (b?.type === "text" && typeof b.text === "string") ||
            (b?.type === "thinking" && typeof b.thinking === "string") ||
            b?.type === "toolCall",
        );
        const parts: Component[] = [
          new AssistantMessageComponent(
            { ...message, content } as never,
            false,
            getMarkdownTheme(),
          ),
        ];
        const failed =
          message.stopReason === "aborted" || message.stopReason === "error";
        for (const block of content) {
          if (block.type !== "toolCall") continue;
          const tool = this.tool(
            String(block.name ?? "tool"),
            String(block.id ?? ""),
            block.arguments ?? {},
          );
          // Pi's edit renderer previews complete arguments against the file
          // as it is now, where an applied edit no longer matches and would
          // read as a failure; a transcript edit shows its call and result only.
          if (!streaming && block.name !== "edit") tool.setArgsComplete();
          if (failed)
            tool.updateResult({
              content: [
                {
                  type: "text",
                  text: String(message.errorMessage ?? "Operation aborted"),
                },
              ],
              isError: true,
            });
          parts.push(tool);
        }
        return parts;
      }
      case "toolResult": {
        const result = {
          content: Array.isArray(message.content) ? message.content : [],
          details: message.details,
          isError: message.isError === true,
        };
        const id = String(message.toolCallId ?? "");
        const pending = this.tools.get(id);
        if (pending) {
          pending.updateResult(result, streaming);
          return [];
        }
        const orphan = this.tool(String(message.toolName ?? "tool"), id, {});
        orphan.updateResult(result, streaming);
        return [orphan];
      }
      default: {
        const text = textOf(message.content);
        return text ? [new Spacer(1), new Text(text, 1, 0)] : [];
      }
    }
  }
  private tool(name: string, id: string, args: unknown) {
    const tool = new ToolExecutionComponent(
      name,
      id,
      args,
      {},
      undefined,
      this.tui,
      this.cwd,
    );
    tool.setExpanded(this.expanded);
    this.tools.set(id, tool);
    return tool;
  }
}
