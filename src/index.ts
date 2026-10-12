import os from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { startupCardLines } from "./startup-card.ts";
import { registerTaskShell } from "./task-shell.ts";

/** Sole production composition. Discovery registers inert capabilities only;
 * actual host binding belongs to the lightweight shell’s session_start. */
export default function register(pi: ExtensionAPI): void {
  if (process.env.CADENCE_SUBAGENT_CHILD === "1") return;
  registerTaskShell(pi);
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
      ctx.ui.notify(
        (lines.length > 1 ? lines.slice(1) : lines).join("\n"),
        "info",
      );
    } catch {
      // Presentation only; shell lifecycle still runs.
    }
  });
}
