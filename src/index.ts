// Private workflow orchestration extension. Registers the abel_dispatch tool
// on load, then keeps it inactive by default by removing only that name from
// the active set at session start. Eligible-stage activation is wired by the
// workflow routing (abel-design/implement/diagnose provenance) in the prompts
// integration; abel-init and ordinary prompts never activate dispatch.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Activation, activateTool, deactivateTool } from "./activation.ts";
import { ACTIONS } from "./contracts.ts";
import { Runtime } from "./runtime.ts";

export const DISPATCH_TOOL = "abel_dispatch";

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ELIGIBLE_PROMPTS = [
  "abel-design",
  "abel-implement",
  "abel-diagnose",
] as const;
type EligiblePrompt = (typeof ELIGIBLE_PROMPTS)[number];

function invokedPrompt(text: string): EligiblePrompt | undefined {
  const name = text.match(/^\/([^\s]+)(?:\s|$)/)?.[1];
  return ELIGIBLE_PROMPTS.find((candidate) => candidate === name);
}

function promptMarker(name: EligiblePrompt): string {
  return `<!-- ABEL:PROMPT:${name} -->`;
}

function hasPackageProvenance(pi: ExtensionAPI, name: EligiblePrompt): boolean {
  const commands = pi
    .getCommands()
    .filter((candidate) => candidate.name === name);
  return (
    commands.length === 1 &&
    commands[0]?.source === "prompt" &&
    commands[0].sourceInfo.origin === "package" &&
    commands[0].sourceInfo.baseDir === PACKAGE_ROOT &&
    commands[0].sourceInfo.path === join(PACKAGE_ROOT, "prompts", `${name}.md`)
  );
}

function hasExpandedPromptMarker(
  prompt: string,
  name: EligiblePrompt,
): boolean {
  const requestEnd = prompt.lastIndexOf("</abel-request>");
  if (requestEnd < 0) return false;
  const body = prompt.slice(requestEnd + "</abel-request>".length);
  const marker = promptMarker(name);
  return (
    body.includes(marker) && body.indexOf(marker) === body.lastIndexOf(marker)
  );
}

function activateDispatcher(
  pi: ExtensionAPI,
  activation: Activation,
  name: EligiblePrompt,
  prompt: string,
): void {
  if (
    !hasPackageProvenance(pi, name) ||
    !hasExpandedPromptMarker(prompt, name)
  ) {
    return;
  }
  if (!activation.isActive()) {
    if (activation.state !== "inactive") return;
    activation.request();
    activation.activate();
  }
  const active = pi.getActiveTools();
  if (!active.includes(DISPATCH_TOOL)) {
    pi.setActiveTools(activateTool(active, DISPATCH_TOOL));
  }
}

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
      signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: import("@earendil-works/pi-coding-agent").ExtensionContext,
    ) {
      const action = typeof params?.action === "string" ? params.action : "";
      const result = await runtime.execute(action, params, ctx, signal);
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

  let pendingPrompt: EligiblePrompt | undefined;

  pi.on("input", (event) => {
    pendingPrompt = invokedPrompt(event.text);
    return { action: "continue" };
  });

  pi.on("before_agent_start", (event) => {
    const prompt = pendingPrompt;
    pendingPrompt = undefined;
    if (prompt)
      activateDispatcher(pi, runtime.activation, prompt, event.prompt);
  });

  pi.on("session_start", () => {
    pendingPrompt = undefined;
    // Restore the default: dispatch is inactive unless a verified stage
    // reactivates it through the activation helpers.
    const active = pi.getActiveTools();
    if (active.includes(DISPATCH_TOOL)) {
      pi.setActiveTools(deactivateTool(active, DISPATCH_TOOL));
    }
  });

  pi.on("session_shutdown", async () => {
    await runtime.drain();
    const active = pi.getActiveTools();
    if (active.includes(DISPATCH_TOOL)) {
      pi.setActiveTools(deactivateTool(active, DISPATCH_TOOL));
    }
  });
}
