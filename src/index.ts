// Private workflow orchestration extension. Registers the abel_dispatch tool
// on load, then keeps it inactive by default by removing only that name from
// the active set at session start. Eligible-stage activation is wired by the
// workflow routing (abel-design/implement/diagnose provenance) in the prompts
// integration; abel-init and ordinary prompts never activate dispatch.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { deactivateTool } from "./activation.ts";
import { ACTIONS } from "./contracts.ts";
import { Runtime } from "./runtime.ts";

export const DISPATCH_TOOL = "abel_dispatch";

export default function register(pi: ExtensionAPI): void {
  const runtime = new Runtime();

  pi.registerTool({
    name: DISPATCH_TOOL,
    label: "Abel Dispatch",
    description:
      "Private Abel workflow delegation: run bounded read-only evidence or Worker phase requests, apply or discard retained results, cancel work, or finish the stage. Inactive unless an eligible Abel stage verified its invocation.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: [...ACTIONS] },
        request: {
          type: "object",
          description: "Request envelope for action=run",
        },
        resultId: {
          type: "string",
          description: "Retained result id for apply/discard",
        },
      },
      required: ["action"],
    },
    async execute(
      _toolCallId: string,
      params: { action?: string; request?: unknown; resultId?: string },
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: import("@earendil-works/pi-coding-agent").ExtensionContext,
    ) {
      const action = typeof params?.action === "string" ? params.action : "";
      const result = await runtime.execute(action, params, ctx);
      if (result.ok) {
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result,
          usage: result.usage,
        };
      }
      return {
        content: [{ type: "text", text: result.error }],
        details: result,
        isError: true,
      };
    },
  } as never);

  pi.on("session_start", () => {
    // Restore the default: dispatch is inactive unless a verified stage
    // reactivates it through the activation helpers.
    const active = pi.getActiveTools();
    if (active.includes(DISPATCH_TOOL)) {
      pi.setActiveTools(deactivateTool(active, DISPATCH_TOOL));
    }
  });

  pi.on("session_shutdown", () => {
    runtime.drain();
    const active = pi.getActiveTools();
    if (active.includes(DISPATCH_TOOL)) {
      pi.setActiveTools(deactivateTool(active, DISPATCH_TOOL));
    }
  });
}
