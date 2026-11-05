/** Readonly bus binding and compact batch summary. Agent browsing is delegated
 * to the adapted upstream session navigator, not a second panel/focus model. */
import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  Editor,
  isKeyRelease,
  matchesKey,
  type TUI,
  type TuiMainScreen,
} from "@earendil-works/pi-tui";
import { SessionNavigator } from "./agent-browser/session-navigator.ts";
import { cadenceBrowserSource } from "./agent-browser/source.ts";
import type { ReadingPosition } from "./agent-browser/transcript-pane.ts";
import {
  type AgentCard,
  CARD_ENTRY,
  cardLines,
  cardOf,
  decodeCard,
  liveLines,
  type Paint,
  SUBAGENT_EVENTS,
  SUBAGENT_VIEW,
  type SubagentState,
  SubagentStore,
} from "./agent-panel-model.ts";

export interface AgentPanelOptions {
  /** Keep a settled summary instead of appending a session card. */
  keep?: boolean;
  now?: () => number;
}
const LIVE = "cadence-agents";
const SPIN_MS = 100;
/** Adjacent workflow steps join the same batch during this settle window. */
export const SETTLE_MS = 1500;
const themePaint =
  (theme: Theme): Paint =>
  (role, text) =>
    role === "selected" ? theme.inverse(text) : theme.fg(role, text);

export function registerAgentPanel(
  pi: ExtensionAPI,
  options: AgentPanelOptions = {},
): void {
  let store: SubagentStore | undefined;
  for (const channel of Object.values(SUBAGENT_EVENTS))
    pi.events.on(channel, (data) => {
      store?.apply(channel, data);
    });
  pi.registerEntryRenderer(CARD_ENTRY, (entry, { expanded }, theme) => {
    const card = decodeCard(entry.data);
    if (!card) return undefined;
    return {
      render: (width) =>
        cardLines(
          card,
          expanded,
          Math.max(1, width - 1),
          themePaint(theme),
        ).map((line) => ` ${line}`),
      invalidate() {},
    };
  });
  let detach: (() => void) | undefined;
  pi.on("session_start", (_event, ctx) => {
    detach?.();
    store = new SubagentStore(options.now);
    detach =
      ctx.mode === "tui" && ctx.hasUI
        ? attachPanel(
            ctx,
            store,
            options,
            (id) => pi.events.emit(SUBAGENT_VIEW, { id }),
            (card) => pi.appendEntry(CARD_ENTRY, card),
          )
        : undefined;
  });
  pi.on("session_shutdown", () => {
    detach?.();
    detach = undefined;
    store = undefined;
  });
}

function attachPanel(
  ctx: ExtensionContext,
  store: SubagentStore,
  options: AgentPanelOptions,
  announce: (id: string | null) => void,
  commit: (card: AgentCard) => void,
): () => void {
  const now = options.now ?? Date.now;
  const keep = options.keep ?? process.env.CADENCE_AGENT_PANEL === "always";
  let tui: TUI | undefined;
  let frame = 0;
  let spinner: ReturnType<typeof setInterval> | undefined;
  let settling: ReturnType<typeof setTimeout> | undefined;
  let mounted = false;
  let detached = false;
  let opening = false;
  let kept: SubagentState[] = [];
  let browser: SessionNavigator | undefined;
  let closeBrowser: (() => void) | undefined;
  const positions = new Map<string, ReadingPosition>();
  const liveAgents = () => (store.batch().length ? store.batch() : kept);
  const stopSpinner = () => {
    clearInterval(spinner);
    spinner = undefined;
  };
  const mount = () => {
    // Keep a handle only for a live batch (or an explicitly kept summary),
    // never just because old agents remain in memory.
    const show = liveAgents().length > 0;
    if (show === mounted) return;
    mounted = show;
    ctx.ui.setWidget(
      LIVE,
      show
        ? (t, theme) => {
            tui = t;
            return {
              render: (width) =>
                browser || opening
                  ? []
                  : liveLines(
                      { agents: liveAgents(), now: now(), frame, hint: true },
                      width,
                      themePaint(theme),
                    ),
              invalidate() {},
            };
          }
        : undefined,
      { placement: "aboveEditor" },
    );
  };
  const closeBatch = () => {
    clearTimeout(settling);
    settling = undefined;
    if (!store.settled()) return;
    const agents = store.closeBatch();
    if (keep) kept = agents;
    else {
      try {
        commit(cardOf(agents));
      } catch {
        /* A replaced runtime cannot append. */
      }
    }
    for (const id of store.prune()) positions.delete(id);
  };
  const changed = () => {
    if (detached) return;
    for (const id of store.prune()) positions.delete(id);
    if (kept.length && store.batch().length) kept = [];
    if (!store.settled()) {
      clearTimeout(settling);
      settling = undefined;
    } else if (!settling) {
      settling = setTimeout(() => {
        closeBatch();
        changed();
      }, SETTLE_MS);
      settling.unref?.();
    }
    if (store.running() === 0) stopSpinner();
    else if (!spinner) {
      spinner = setInterval(() => {
        frame++;
        tui?.requestRender();
      }, SPIN_MS);
      spinner.unref?.();
    }
    mount();
    tui?.requestRender();
  };
  const unsubscribe = store.subscribe(changed);
  const open = () => {
    if (opening || browser || detached || !tui) return;
    opening = true;
    // This is the current renderer's public mode, not a saved setting or a
    // version fallback. Regular mode retains the upstream docked mount to
    // avoid writing overlay pixels into the terminal's scrollback.
    const fullscreen = tui.mode === "fullscreen";
    void ctx.ui
      .custom<void>(
        (t, theme, keys, done) => {
          closeBrowser = () => done();
          browser = new SessionNavigator(
            t,
            theme,
            keys,
            // Transcript caches belong to this interaction, not future batches.
            cadenceBrowserSource(store, announce, now),
            ctx.cwd,
            positions,
            closeBrowser,
          );
          if (detached) done();
          return browser;
        },
        fullscreen
          ? {
              overlay: true,
              overlayOptions: {
                width: "100%",
                maxHeight: "70%",
                anchor: "center",
              },
            }
          : { overlay: false },
      )
      .catch(() => {
        if (!detached)
          ctx.ui.notify("Could not open the agent browser", "error");
      })
      .finally(() => {
        browser?.dispose();
        browser = undefined;
        closeBrowser = undefined;
        opening = false;
        if (!detached) changed();
      });
  };
  const unlisten = ctx.ui.onTerminalInput((data) => {
    if (
      detached ||
      opening ||
      browser ||
      isKeyRelease(data) ||
      !matchesKey(data, "down")
    )
      return;
    if (
      store.running() === 0 ||
      ctx.ui.getEditorText() !== "" ||
      tui?.hasOverlay() ||
      !(
        (tui as TuiMainScreen | undefined)?.getFocusedComponent() instanceof
        Editor
      )
    )
      return;
    open();
    return { consume: true };
  });
  changed();
  return () => {
    detached = true;
    unsubscribe();
    unlisten();
    stopSpinner();
    if (settling) closeBatch();
    clearTimeout(settling);
    browser?.dispose();
    try {
      closeBrowser?.();
      if (mounted) ctx.ui.setWidget(LIVE, undefined);
    } catch {
      /* The old runtime already cleared its UI. */
    }
  };
}
