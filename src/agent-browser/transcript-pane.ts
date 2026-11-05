/** Adapted from gotgenes/pi-packages @ 52854c12d590142e61a4f6a6947be9084035300d.
 * MIT; see licenses/pi-subagents-MIT.txt and provenance/agent-browser-reuse.json. */
import type {
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  type Keybinding,
  type KeyId,
  type MarkdownTheme,
  matchesKey,
  type TUI,
  type TuiMouseEvent,
  type TuiMouseEventResult,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { labeledRule } from "./labeled-rule.ts";
import type {
  EntryHeading,
  ModelIdentity,
  TranscriptSource,
} from "./source.ts";
import { TranscriptContent } from "./transcript-content.ts";

const CHROME_LINES = 2;
export const VIEWPORT_HEIGHT_PCT = 70;
interface ScrollOptions {
  follow?: boolean;
}
export interface ReadingPosition {
  offset: number;
  follow: boolean;
}
export interface TranscriptPaneOptions {
  tui: TUI;
  theme: Theme;
  keys: Pick<KeybindingsManager, "matches" | "getKeys">;
  source: TranscriptSource;
  heading: EntryHeading;
  done: (result: undefined) => void;
  cwd: string;
  markdownTheme: MarkdownTheme;
  position: ReadingPosition;
}
const formatModel = (model: ModelIdentity) => `${model.provider}/${model.id}`;
export class TranscriptPane implements Component {
  readonly capturesViewportInput = true;
  private readonly position: ReadingPosition;
  private get scrollOffset() {
    return this.position.offset;
  }
  private set scrollOffset(value: number) {
    this.position.offset = value;
  }
  private get autoScroll() {
    return this.position.follow;
  }
  private set autoScroll(value: boolean) {
    this.position.follow = value;
  }
  private unsubscribe: (() => void) | undefined;
  private closed = false;

  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly keys: Pick<KeybindingsManager, "matches" | "getKeys">;
  private readonly source: TranscriptSource;
  private readonly heading: EntryHeading;
  private readonly done: (result: undefined) => void;
  private readonly content: TranscriptContent;
  /** Width the host last rendered at; input must use the same layout. */
  private renderedWidth: number | undefined;

  constructor({
    tui,
    theme,
    keys,
    source,
    heading,
    done,
    cwd,
    markdownTheme,
    position,
  }: TranscriptPaneOptions) {
    this.position = position;
    this.tui = tui;
    this.theme = theme;
    this.keys = keys;
    this.source = source;
    this.heading = heading;
    this.done = done;
    this.content = new TranscriptContent({ tui, cwd, markdownTheme, source });
    this.unsubscribe = source.subscribe(() => {
      if (this.closed) return;
      this.content.apply();
      this.tui.requestRender();
    });
  }

  handleInput(data: string): void {
    if (
      matchesKey(data, "escape") ||
      matchesKey(data, "q") ||
      matchesKey(data, "ctrl+c")
    ) {
      this.closed = true;
      this.done(undefined);
      return;
    }

    const { viewportHeight } = this.scrollBounds(this.inputWidth());

    if (matchesKey(data, "up") || matchesKey(data, "k")) {
      this.scrollBy(-1);
    } else if (matchesKey(data, "down") || matchesKey(data, "j")) {
      this.scrollBy(1);
    } else if (
      this.keys.matches(data, "tui.altScreen.pageUp") ||
      matchesKey(data, "shift+up")
    ) {
      this.scrollBy(-viewportHeight, { follow: false });
    } else if (
      this.keys.matches(data, "tui.altScreen.pageDown") ||
      matchesKey(data, "shift+down")
    ) {
      this.scrollBy(viewportHeight);
    } else if (
      this.keys.matches(data, "tui.altScreen.top") ||
      matchesKey(data, "home")
    ) {
      this.scrollTo(0, { follow: false });
    } else if (
      this.keys.matches(data, "tui.altScreen.bottom") ||
      matchesKey(data, "end")
    ) {
      this.scrollTo(Number.POSITIVE_INFINITY);
    } else if (this.keys.matches(data, "app.tools.expand")) {
      this.content.toggleExpanded();
    }
    this.tui.requestRender();
  }

  /** The wheel scrolls the transcript; every other mouse event is left to the host. */
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type !== "wheel") return undefined;
    this.scrollBy(event.wheelDelta ?? 0);
    this.tui.requestRender();
    return { handled: true };
  }

  render(width: number): string[] {
    if (width < 6) return [];
    const th = this.theme;
    this.renderedWidth = width;
    const lines: string[] = [];

    // Rows span at most the width the host supplied: pi-tui rejects a wider one.
    const fitLine = (content: string): string =>
      truncateToWidth(content, width);
    const { model, thinkingLevel } = this.source.sessionModel();
    const paint = th.getThinkingBorderColor(thinkingLevel ?? "off");

    lines.push(
      labeledRule(width, paint, this.headerLabels(model, thinkingLevel)),
    );

    const { totalLines, viewportHeight, maxScroll } = this.scrollBounds(width);
    if (this.autoScroll) this.scrollOffset = maxScroll;
    const visibleStart = Math.min(this.scrollOffset, maxScroll);
    this.scrollOffset = visibleStart;
    const visible = this.content.slice(width, visibleStart, viewportHeight);
    for (let i = 0; i < viewportHeight; i++)
      lines.push(fitLine(visible[i] ?? ""));

    const scrollPct =
      totalLines <= viewportHeight
        ? "100%"
        : `${Math.round(((visibleStart + viewportHeight) / totalLines) * 100)}%`;
    const position = th.fg(
      "dim",
      `${totalLines} lines · ${scrollPct} · ${this.autoScroll ? "following" : "paused"}`,
    );
    const hints = th.fg("dim", this.footerHint());
    lines.push(labeledRule(width, paint, [position], [hints]));

    return lines;
  }

  // fallow-ignore-next-line unused-class-member
  invalidate(): void {
    this.content.invalidate();
  }

  dispose(): void {
    this.closed = true;
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
  }

  // ---- Private ----

  /**
   * The key hints the footer rule carries on its right, naming the keys the
   * operator actually bound: the first key of each binding, and no segment
   * for a pair left wholly unbound.
   */
  private footerHint(): string {
    const page = this.keyPair("tui.altScreen.pageUp", "tui.altScreen.pageDown");
    const ends = this.keyPair("tui.altScreen.top", "tui.altScreen.bottom");
    return ["↑↓ scroll", page, ends, "Esc list"]
      .filter((segment) => segment !== "")
      .join(" · ");
  }

  /** `PageUp/PageDown` for a pair of bindings; the bound side alone when the other is unbound. */
  private keyPair(first: Keybinding, second: Keybinding): string {
    return [first, second]
      .flatMap((keybinding) => this.keys.getKeys(keybinding).slice(0, 1))
      .map(displayKey)
      .join("/");
  }

  /**
   * Header labels, most to least informative: the rule drops the task first,
   * then the model and thinking level, before it truncates the agent's name.
   */
  private headerLabels(
    model: ModelIdentity | undefined,
    thinkingLevel: string | undefined,
  ): string[] {
    const th = this.theme;
    const { name, modeLabel, description } = this.heading;
    const identity =
      th.bold(name) + (modeLabel ? ` ${th.fg("muted", `(${modeLabel})`)}` : "");
    const runtime = describeRuntime(model, thinkingLevel);
    const runtimeTag = runtime ? th.fg("muted", ` · ${runtime}`) : "";
    return [
      `${identity}  ${th.fg("muted", description)}${runtimeTag}`,
      identity + runtimeTag,
      identity,
    ];
  }

  private scrollBy(delta: number, options?: ScrollOptions): void {
    this.scrollTo(this.scrollOffset + delta, options);
  }

  /**
   * Move to `offset`, clamped to the transcript. The pane follows new output
   * when it lands on the bottom, unless the move says otherwise: paging up or
   * jumping to the top stops following even on a transcript that fits.
   */
  private scrollTo(offset: number, { follow }: ScrollOptions = {}): void {
    const { maxScroll } = this.scrollBounds(this.inputWidth());
    this.scrollOffset = Math.min(maxScroll, Math.max(0, offset));
    this.autoScroll = follow ?? this.scrollOffset >= maxScroll;
  }

  /**
   * Scroll geometry at a given layout width.
   *
   * The single place a width becomes a viewport height, so `render` and
   * `handleInput` cannot disagree about how far the transcript scrolls.
   */
  private scrollBounds(width: number): {
    totalLines: number;
    viewportHeight: number;
    maxScroll: number;
  } {
    const totalLines = this.content.lineCount(width);
    const viewportHeight = this.viewportHeight(totalLines);
    return {
      totalLines,
      viewportHeight,
      maxScroll: Math.max(0, totalLines - viewportHeight),
    };
  }

  /**
   * The width `handleInput` must lay out at: the one the host actually supplied,
   * so scroll bounds match the layout on screen. Before the first paint there is
   * none, so fall back to the full terminal width.
   */
  private inputWidth(): number {
    return this.renderedWidth ?? this.tui.terminal.columns;
  }

  /**
   * Rows the transcript gets: what it needs, capped at the pane's share of the
   * terminal so a long or live transcript cannot crowd out the conversation, and
   * floored so a short one still reads as a pane.
   */
  private viewportHeight(totalLines: number): number {
    const cap =
      Math.floor((this.tui.terminal.rows * VIEWPORT_HEIGHT_PCT) / 100) -
      CHROME_LINES;
    return Math.max(0, Math.min(Math.max(1, totalLines), cap));
  }
}

/** A key id in Pi's display style: `ctrl+b` → `Ctrl+B`, `pageUp` → `PageUp`. */
function displayKey(key: KeyId): string {
  return key
    .split("+")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("+");
}

/**
 * `anthropic/claude-sonnet-5 • high`, in Pi's footer wording: `thinking off` rather
 * than a bare `off`, and `thinking <level>` when no model is named to attach it to.
 */
function describeRuntime(
  model: ModelIdentity | undefined,
  thinkingLevel: string | undefined,
): string {
  if (!model) return thinkingLevel ? `thinking ${thinkingLevel}` : "";
  if (!thinkingLevel) return formatModel(model);
  const level = thinkingLevel === "off" ? "thinking off" : thinkingLevel;
  return `${formatModel(model)} • ${level}`;
}
