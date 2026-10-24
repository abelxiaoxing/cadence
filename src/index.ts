import os from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAgentPanel } from "./agent-panel.ts";
import { registerCadenceAgentFeed } from "./agent-panel-cadence.ts";
import { autostartNotice } from "./native-client.ts";
import { startupCardLines } from "./startup-card.ts";
import { registerTaskShell } from "./task-shell.ts";

/** Sole production composition. Discovery registers inert capabilities only;
 * actual host binding belongs to the lightweight shell’s session_start. */
export default function register(pi: ExtensionAPI): void {
  if (process.env.CADENCE_SUBAGENT_CHILD === "1") return;
  registerTaskShell(pi);
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
      const shown = lines.length > 1 ? lines.slice(1) : lines;
      // npm hides the install hook's guidance; boot-start gaps surface here.
      const autostart = autostartNotice();
      if (autostart) shown.push(autostart);
      ctx.ui.notify(shown.join("\n"), "info");
    } catch {
      // Presentation only; shell lifecycle still runs.
    }
  });
}
