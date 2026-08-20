// Private workflow orchestration extension. Registers the abel_dispatch tool
// on load, then keeps it inactive by default by removing only that name from
// the active set at session start. Eligible-stage activation is wired by the
// workflow routing (abel-design/implement/diagnose provenance) in the prompts
// integration; abel-init and ordinary prompts never activate dispatch.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionAPI,
  ExtensionContext,
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { type Activation, activateTool, deactivateTool } from "./activation.ts";
import { ACTIONS } from "./contracts.ts";
import { ParentPayloadBridge } from "./parent-payload-bridge.ts";
import { Runtime } from "./runtime.ts";
import {
  ACTIVITY_DETAILS_KEY,
  ActivityController,
  renderActivityCall,
  renderActivityResult,
} from "./subagent-activity.ts";

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

function isVerifiedStageInvocation(
  pi: ExtensionAPI,
  activation: Activation,
  name: EligiblePrompt,
  prompt: string,
): boolean {
  return (
    hasPackageProvenance(pi, name) &&
    hasExpandedPromptMarker(prompt, name) &&
    (activation.isActive() || activation.state === "inactive")
  );
}

function activateDispatcher(
  pi: ExtensionAPI,
  activation: Activation,
  name: EligiblePrompt,
  prompt: string,
): void {
  if (!isVerifiedStageInvocation(pi, activation, name, prompt)) return;
  if (!activation.isActive()) {
    activation.request();
    activation.activate();
  }
  const active = pi.getActiveTools();
  if (!active.includes(DISPATCH_TOOL)) {
    pi.setActiveTools(activateTool(active, DISPATCH_TOOL));
  }
}

export default function register(pi: ExtensionAPI): void {
  const parentPayloadBridge = new ParentPayloadBridge();
  const runtime = new Runtime({ parentPayloadBridge });
  const activity = new ActivityController();

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
      toolCallId: string,
      params: { action?: string; request?: unknown; resultId?: string },
      signal: AbortSignal | undefined,
      onUpdate: AgentToolUpdateCallback<unknown> | undefined,
      ctx: ExtensionContext,
    ) {
      const action = typeof params?.action === "string" ? params.action : "";
      const validRun =
        action === "run" && runtime.validateRequest(params.request).ok;
      const tuiRun = ctx.mode === "tui" && validRun;
      const result = tuiRun
        ? await runtime.execute(
            action,
            params,
            ctx,
            signal,
            activity.observe(
              toolCallId,
              onUpdate as ((result: unknown) => void) | undefined,
            ),
          )
        : await runtime.execute(action, params, ctx, signal);
      const display = tuiRun
        ? activity.finalize(toolCallId, result)
        : undefined;
      const details = display
        ? { ...result, [ACTIVITY_DETAILS_KEY]: display }
        : result;
      if (result.ok) {
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details,
          usage: result.usage,
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details,
        isError: true,
      };
    },
    renderCall(args: unknown, theme: Theme, _context: unknown) {
      return renderActivityCall(args, theme);
    },
    renderResult(
      result: AgentToolResult<unknown>,
      options: ToolRenderResultOptions,
      theme: Theme,
      _context: unknown,
    ) {
      return renderActivityResult(result, options, theme);
    },
  } as never);

  let pendingPrompt: EligiblePrompt | undefined;

  pi.on("input", (event) => {
    pendingPrompt = invokedPrompt(event.text);
    return { action: "continue" };
  });

  pi.on("before_agent_start", (event, ctx) => {
    const prompt = pendingPrompt;
    pendingPrompt = undefined;
    if (
      prompt &&
      isVerifiedStageInvocation(pi, runtime.activation, prompt, event.prompt)
    ) {
      const sessionId = ctx.sessionManager?.getSessionId?.();
      if (typeof sessionId === "string") {
        parentPayloadBridge.beginSession(sessionId);
      } else {
        parentPayloadBridge.clear();
      }
    }
    if (ctx.model) {
      parentPayloadBridge.install(ctx.model, ctx.modelRegistry);
    }
    if (prompt)
      activateDispatcher(pi, runtime.activation, prompt, event.prompt);
  });

  pi.on("session_start", (_event, ctx) => {
    const sessionId = ctx.sessionManager?.getSessionId?.();
    if (typeof sessionId === "string") {
      parentPayloadBridge.beginSession(sessionId);
      if (ctx.model) {
        parentPayloadBridge.install(ctx.model, ctx.modelRegistry);
      }
    } else {
      parentPayloadBridge.clear();
    }
    pendingPrompt = undefined;
    activity.detach();
    if (ctx.mode === "tui") activity.attach(ctx.ui);
    // Restore the default: dispatch is inactive unless a verified stage
    // reactivates it through the activation helpers.
    const active = pi.getActiveTools();
    if (active.includes(DISPATCH_TOOL)) {
      pi.setActiveTools(deactivateTool(active, DISPATCH_TOOL));
    }
  });

  pi.on("model_select", (event, ctx) => {
    const sessionId = ctx.sessionManager?.getSessionId?.();
    if (typeof sessionId !== "string") {
      parentPayloadBridge.clear();
      return;
    }
    parentPayloadBridge.beginSession(sessionId);
    const model = event.model ?? ctx.model;
    if (model) {
      parentPayloadBridge.install(model, ctx.modelRegistry);
    }
  });

  pi.on("session_shutdown", async () => {
    activity.detach();
    await runtime.drain();
    activity.clear();
    const active = pi.getActiveTools();
    if (active.includes(DISPATCH_TOOL)) {
      pi.setActiveTools(deactivateTool(active, DISPATCH_TOOL));
    }
  });
}
