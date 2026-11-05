/** Agent selection → readonly transcript navigation, adapted from
 * gotgenes/pi-packages @ 52854c12d590142e61a4f6a6947be9084035300d,
 * packages/pi-subagents/src/ui/session-navigator.ts (MIT).
 * See provenance/agent-browser-reuse.json and licenses/pi-subagents-MIT.txt.
 *
 * Cadence supplies entries rather than the upstream manager/file readers.
 * The upstream TranscriptPane and TranscriptContent own the reading experience;
 * Pi's SelectList replaces ui.select so a live list retains selection by id and
 * Esc returns to that same list without starting another modal interaction. */
import {
  getMarkdownTheme,
  type KeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  isKeyRelease,
  SelectList,
  type TUI,
  type TuiMouseEvent,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { labeledRule } from "./labeled-rule.ts";
import type { BrowserSource, NavigationEntry } from "./source.ts";
import {
  type ReadingPosition,
  TranscriptPane,
  VIEWPORT_HEIGHT_PCT,
} from "./transcript-pane.ts";

export class SessionNavigator implements Component {
  readonly capturesViewportInput = true;
  selected: string | undefined;
  viewing: string | undefined;
  private list: SelectList | undefined;
  private pane: TranscriptPane | undefined;
  private entries: NavigationEntry[] = [];
  private signature = "";
  private disposed = false;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly keys: Pick<KeybindingsManager, "matches" | "getKeys">,
    private readonly source: BrowserSource,
    private readonly cwd: string,
    private readonly positions: Map<string, ReadingPosition>,
    private readonly done: () => void,
  ) {
    this.unsubscribe = source.subscribe(() => {
      if (!this.disposed) this.tui.requestRender();
    });
    this.refresh();
  }

  private refresh(): void {
    const entries = this.source.entries();
    const maxRows = Math.max(
      1,
      Math.min(
        10,
        Math.floor((this.tui.terminal.rows * VIEWPORT_HEIGHT_PCT) / 100) - 3,
      ),
    );
    const signature = JSON.stringify([
      maxRows,
      entries.map(({ id, label }) => [id, label]),
    ]);
    if (this.signature === signature) return;
    this.signature = signature;
    this.entries = entries;
    const index = Math.max(
      0,
      entries.findIndex((entry) => entry.id === this.selected),
    );
    this.selected = entries[index]?.id;
    this.list = new SelectList(
      entries.map(({ id, label }) => ({ value: id, label })),
      maxRows,
      {
        selectedPrefix: (text) => this.theme.fg("accent", text),
        selectedText: (text) => this.theme.inverse(text),
        description: (text) => this.theme.fg("muted", text),
        scrollInfo: (text) => this.theme.fg("dim", text),
        noMatch: (text) => this.theme.fg("dim", text),
      },
    );
    this.list.setSelectedIndex(index);
    this.list.onSelectionChange = (item) => {
      this.selected = item.value;
    };
    this.list.onSelect = (item) => this.open(item.value);
    this.list.onCancel = this.done;
  }

  private open(id: string): void {
    const entry = this.entries.find((candidate) => candidate.id === id);
    if (!entry) return;
    this.viewing = id;
    let position = this.positions.get(id);
    if (!position) {
      position = { offset: 0, follow: true };
      this.positions.set(id, position);
    }
    this.pane = new TranscriptPane({
      tui: this.tui,
      theme: this.theme,
      keys: this.keys,
      source: entry.source,
      heading: entry.heading,
      cwd: this.cwd,
      position,
      markdownTheme: getMarkdownTheme(),
      done: () => {
        this.pane?.dispose();
        this.pane = undefined;
        this.viewing = undefined;
        this.source.view(null);
        this.refresh();
        this.tui.requestRender();
      },
    });
    this.source.view(id);
  }

  render(width: number): string[] {
    this.refresh();
    if (this.pane) {
      try {
        return this.pane.render(width);
      } catch {
        return [
          truncateToWidth(
            "Transcript could not be rendered · Esc returns to agents",
            width,
          ),
        ];
      }
    }
    if (width < 6) return [truncateToWidth("Agents", width)];
    const at = this.entries.findIndex((entry) => entry.id === this.selected);
    return [
      labeledRule(
        width,
        (text) => this.theme.fg("border", text),
        ["Agents"],
        [`${at + 1} / ${this.entries.length}`],
      ),
      ...(this.list?.render(width) ?? []),
      truncateToWidth(
        this.theme.fg("dim", "↑↓ select · Enter view · Esc return to input"),
        width,
      ),
    ];
  }

  handleInput(data: string): void {
    if (isKeyRelease(data)) return;
    if (this.pane) this.pane.handleInput(data);
    else this.list?.handleInput(data);
    this.tui.requestRender();
  }

  handleMouse(event: TuiMouseEvent) {
    if (this.pane) return this.pane.handleMouse(event);
    return this.list?.handleMouse({
      ...event,
      y: event.y - 1,
      height: Math.max(0, event.height - 2),
    });
  }

  invalidate(): void {
    this.signature = "";
    this.list?.invalidate();
    this.pane?.invalidate();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.pane?.dispose();
    this.source.view(null);
  }
}
