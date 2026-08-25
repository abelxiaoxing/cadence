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

const GENERIC_REQUEST_SCHEMA = {
  type: "object",
  description:
    "Stage-specific request envelope for action=run. The verified Abel prompt refreshes this schema before the stage's first model turn.",
} as const;

const DESIGN_REQUEST_SCHEMA = {
  type: "object",
  description:
    "One bounded read-only design-explorer packet. Send one sibling abel_dispatch tool call per packet; do not wrap multiple packets in requests.",
  properties: {
    stage: {
      type: "string",
      enum: ["abel-design"],
      description: "Exact verified workflow stage.",
    },
    role: {
      type: "string",
      enum: ["design-explorer"],
      description: "Exact package-owned read-only Agent role.",
    },
    id: {
      type: "string",
      description:
        "Unique packet and request identity, at most 128 characters.",
    },
    phase: {
      type: "string",
      enum: ["evidence"],
      description: "Design exploration phase.",
    },
    objective: {
      type: "string",
      description: "Bounded evidence objective for this packet only.",
    },
    roots: {
      type: "array",
      items: { type: "string" },
      description: 'Approved relative workspace roots, normally ["."].',
    },
    context: {
      type: "object",
      properties: {
        agents: {
          type: "string",
          description: "Applicable AGENTS.md instructions for this packet.",
        },
        contract: {
          type: "string",
          description:
            "Packet scope, retrieval, read-only, and structured-output contract.",
        },
      },
      required: ["agents", "contract"],
      additionalProperties: false,
    },
    declared: {
      type: "object",
      properties: {
        read: {
          type: "array",
          items: { type: "string" },
          description:
            "Exact relative files or directories this packet may read.",
        },
        write: {
          type: "array",
          items: { type: "string" },
          description: "Must be empty for design-explorer.",
        },
        conflicts: {
          type: "array",
          items: { type: "string" },
          description:
            "Declared conflict edges; normally empty for read-only packets.",
        },
        resources: {
          type: "array",
          items: { type: "string" },
          description: "Declared exclusive resources; normally empty.",
        },
      },
      required: ["read", "write", "conflicts", "resources"],
      additionalProperties: false,
    },
    output: {
      type: "string",
      enum: ["evidence"],
      description: "Exact structured child-result kind.",
    },
  },
  required: [
    "stage",
    "role",
    "id",
    "phase",
    "objective",
    "roots",
    "context",
    "declared",
    "output",
  ],
  additionalProperties: false,
} as const;

function requestSchemaForStage(name?: EligiblePrompt): object {
  return name === "abel-design"
    ? DESIGN_REQUEST_SCHEMA
    : GENERIC_REQUEST_SCHEMA;
}

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

function splitUsage(result: unknown): { payload: unknown; usage?: unknown } {
  if (typeof result !== "object" || result === null || !("usage" in result)) {
    return { payload: result };
  }
  const { usage, ...payload } = result as Record<string, unknown>;
  return { payload, usage };
}

export default function register(pi: ExtensionAPI): void {
  const parentPayloadBridge = new ParentPayloadBridge();
  const runtime = new Runtime({ parentPayloadBridge });
  const activity = new ActivityController();

  const registerDispatchTool = (stage?: EligiblePrompt) => {
    pi.registerTool({
      name: DISPATCH_TOOL,
      label: "Abel Dispatch",
      description:
        stage === "abel-design"
          ? "Run exactly one bounded read-only design-explorer packet. When parallel packets are required, emit every sibling abel_dispatch call together in one assistant response before waiting for any result."
          : "Private Abel workflow delegation: run bounded read-only evidence or Worker phase requests, apply or discard retained results, apply a parent-only stable AGENTS checkpoint, cancel work, or finish the stage. Inactive unless an eligible Abel stage verified its invocation.",
      executionMode: "parallel",
      renderShell: "self",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: [...ACTIONS] },
          request: requestSchemaForStage(stage),
          resultId: {
            type: "string",
            description: "Retained result id for apply/discard",
          },
          requestId: {
            type: "string",
            description: "Current Implement apply/discard operation identity",
          },
          rejection: {
            type: "object",
            description: "Typed parent rejection for Implement discard",
          },
          agentsCheckpoint: {
            type: "object",
            description:
              "Parent-owned approved managed-block checkpoint for action=apply (mutually exclusive with resultId)",
          },
        },
        required: ["action"],
      },
      async execute(
        toolCallId: string,
        params: {
          action?: string;
          request?: unknown;
          resultId?: string;
          requestId?: string;
          rejection?: unknown;
          agentsCheckpoint?: unknown;
        },
        signal: AbortSignal | undefined,
        onUpdate: AgentToolUpdateCallback<unknown> | undefined,
        ctx: ExtensionContext,
      ) {
        const action = typeof params?.action === "string" ? params.action : "";
        const validRun =
          action === "run" && runtime.validateRequest(params.request).ok;
        const tuiRun = ctx.mode === "tui" && validRun;
        const { action: _action, ...operation } = params;
        const result = tuiRun
          ? await runtime.execute(
              action,
              operation,
              ctx,
              signal,
              activity.observe(
                toolCallId,
                onUpdate as ((result: unknown) => void) | undefined,
              ),
            )
          : await runtime.execute(action, operation, ctx, signal);
        const display = tuiRun
          ? activity.finalize(toolCallId, result)
          : undefined;
        const { payload, usage } = splitUsage(result);
        const details = display
          ? {
              ...(payload as Record<string, unknown>),
              [ACTIVITY_DETAILS_KEY]: display,
            }
          : payload;
        return {
          content: [{ type: "text", text: JSON.stringify(payload) }],
          details,
          ...(usage === undefined ? {} : { usage }),
        };
      },
      renderCall(args: unknown, theme: Theme, context: unknown) {
        return renderActivityCall(
          args,
          theme,
          context as Parameters<typeof renderActivityCall>[2],
        );
      },
      renderResult(
        result: AgentToolResult<unknown>,
        options: ToolRenderResultOptions,
        theme: Theme,
        context: unknown,
      ) {
        return renderActivityResult(
          result,
          options,
          theme,
          context as Parameters<typeof renderActivityResult>[3],
        );
      },
    } as never);
  };

  registerDispatchTool();

  let pendingPrompt: EligiblePrompt | undefined;
  let activePrompt: EligiblePrompt | undefined;

  pi.on("input", (event) => {
    pendingPrompt = invokedPrompt(event.text);
    return { action: "continue" };
  });

  pi.on("before_agent_start", (event, ctx) => {
    const prompt = pendingPrompt;
    pendingPrompt = undefined;
    const verified =
      prompt &&
      isVerifiedStageInvocation(pi, runtime.activation, prompt, event.prompt);
    if (verified) {
      activePrompt = prompt;
      registerDispatchTool(prompt);
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

  pi.on("before_provider_request", (event, ctx) => {
    if (
      activePrompt !== "abel-design" ||
      ctx.model?.api !== "openai-responses" ||
      event.payload === null ||
      typeof event.payload !== "object" ||
      Array.isArray(event.payload)
    ) {
      return;
    }
    return { ...event.payload, parallel_tool_calls: true };
  });

  pi.on("session_start", async (_event, ctx) => {
    pendingPrompt = undefined;
    activePrompt = undefined;
    activity.detach();
    const active = pi.getActiveTools();
    if (active.includes(DISPATCH_TOOL)) {
      pi.setActiveTools(deactivateTool(active, DISPATCH_TOOL));
    }
    await runtime.drain();
    activity.clear();
    const sessionId = ctx.sessionManager?.getSessionId?.();
    if (typeof sessionId === "string") {
      parentPayloadBridge.beginSession(sessionId);
      if (ctx.model) {
        parentPayloadBridge.install(ctx.model, ctx.modelRegistry);
      }
    } else {
      parentPayloadBridge.clear();
    }
    if (ctx.mode === "tui") activity.attach(ctx.ui);
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
    activePrompt = undefined;
    activity.detach();
    await runtime.drain();
    activity.clear();
    const active = pi.getActiveTools();
    if (active.includes(DISPATCH_TOOL)) {
      pi.setActiveTools(deactivateTool(active, DISPATCH_TOOL));
    }
  });
}
