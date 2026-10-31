import os from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAgentPanel } from "./agent-panel.ts";
import { registerCadenceAgentFeed } from "./agent-panel-cadence.ts";
import { registerCadenceMode } from "./cadence-mode.ts";
import { registerHistoryShell } from "./history-shell.ts";
import { autostartNotice } from "./native-client.ts";
import { CONFIG_MISSING, startupCardLines } from "./startup-card.ts";

/** Sole production composition. Discovery registers inert capabilities only;
 * actual host binding belongs to the readonly history shell’s session_start. */
export default function register(pi: ExtensionAPI): void {
  if (process.env.CADENCE_SUBAGENT_CHILD === "1") return;
  registerHistoryShell(pi);
  registerCadenceMode(pi);
  // Observes `subagent:*` bus events only; renders nothing until one arrives.
  registerAgentPanel(pi);
  // Publishes a running owner's child runs there; readonly, never starts one.
  registerCadenceAgentFeed(pi);
  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI || (ctx.mode !== "tui" && ctx.mode !== "rpc")) return;
    // Preserve independent, nonactivating configuration presentation. This
    // creates nothing and cannot discharge resources or override shell refusal.
    try {
      const lines = startupCardLines({
        cwd: ctx.cwd,
        home: os.homedir(),
        projectTrusted: ctx.isProjectTrusted(),
      });
      // An existing file's path is noise; a missing one says where to create it.
      const shown =
        lines.length > 1 && !lines[0].endsWith(CONFIG_MISSING)
          ? lines.slice(1)
          : lines;
      ctx.ui.notify(shown.join("\n"), "info");
      // A later info status replaces this card in Pi's TUI; a warning stays.
      const autostart = autostartNotice();
      if (autostart) ctx.ui.notify(autostart, "warning");
    } catch {
      // Presentation only; shell lifecycle still runs.
    }
  });
}
