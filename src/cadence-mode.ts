/** Persistent, branch-aware conversation mode. No execution owner lives in Pi. */
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Key, matchesKey } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { CADENCE_INSTRUCTIONS as INSTRUCTIONS } from "./cadence-instructions.ts";
import { CadencePreferences } from "./cadence-preferences.ts";
import { departure, NativeConnection } from "./native-client.ts";
import {
  decodeWorkflowPlan,
  readableWorkflowPlan,
  type WorkflowProposal,
  type WorkflowRequest,
  type WorkflowResponse,
  type WorkflowRun,
} from "./service/contracts/workflow.ts";
import { ServiceCoordination } from "./service/coordination.ts";
import {
  ContractError,
  canonicalJson,
  decodeModelSelector,
  type ModelSelector,
  type Reply,
} from "./service-contract.ts";
import { effectiveWorkspace } from "./task-store.ts";

export const CADENCE_MODE_ENTRY = "cadence-conversation-mode/1";
const TOOLS = [
  "cadence_research",
  "cadence_plan",
  "cadence_start",
  "cadence_status",
  "cadence_cancel",
  "cadence_model",
];
export interface CadenceModeState {
  enabled: boolean;
  cwd: string;
  runId: string | null;
  proposal: WorkflowProposal | null;
  previousTools: string[];
}
const idle = (): CadenceModeState => ({
  enabled: false,
  cwd: "",
  runId: null,
  proposal: null,
  previousTools: [],
});
/** Session restoration restores mode/context, NEVER a grant, pending command or action replay. */
export function restoreCadenceMode(
  entries: readonly { type: string; customType?: string; data?: unknown }[],
  cwd: string,
): CadenceModeState {
  let state = idle();
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== CADENCE_MODE_ENTRY)
      continue;
    const v = entry.data as Partial<CadenceModeState> | null;
    if (
      !v ||
      typeof v.enabled !== "boolean" ||
      v.cwd !== cwd ||
      !Array.isArray(v.previousTools) ||
      !v.previousTools.every((s) => typeof s === "string") ||
      !(v.runId === null || typeof v.runId === "string")
    ) {
      state = idle();
      continue;
    }
    state = {
      enabled: v.enabled,
      cwd,
      runId: v.runId,
      proposal: null,
      previousTools: v.previousTools.filter((n) => !TOOLS.includes(n)),
    };
  }
  return state;
}
/** Raw terminal evidence is ephemeral, never supplied by model/tool text or paste. */
export class CadenceUserInput {
  private value: { text: string; at: number } | undefined;
  private pasting = false;
  clear() {
    this.value = undefined;
  }
  input(data: string, text: string, eligible: boolean, at = Date.now()) {
    this.clear();
    if (data.includes("\x1b[200~")) this.pasting = true;
    if (data.includes("\x1b[201~")) {
      this.pasting = false;
      return;
    }
    if (!this.pasting && eligible && matchesKey(data, Key.enter))
      this.value = { text, at };
  }
  consumeCommand(args: string, at = Date.now()) {
    const v = this.value;
    if (
      !v ||
      !/^\/cadence(?:[ \t]+[^\r\n]*)?$/u.test(v.text) ||
      v.text.replace(/^\/cadence[ \t]*/u, "") !== args
    ) {
      this.clear();
      return false;
    }
    return this.consume(v.text, at);
  }
  consume(text: string, at = Date.now()) {
    const v = this.value;
    this.clear();
    return !!v && v.text === text && at >= v.at && at - v.at < 1500;
  }
}
const approved = (s: string) =>
  /^(?:按(?:这个|本)?计划(?:开始)?(?:执行|实施)|确认(?:计划并)?(?:执行|实施)|approve and execute)[。.!！]?$/iu.test(
    s.trim(),
  );
const exiting = (s: string) =>
  /^(?:退出\s*cadence|关闭\s*cadence(?:模式)?|exit cadence)$/iu.test(s.trim());
const result = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: undefined,
});
const value = <T>(reply: Reply<T>): T => {
  if (reply.kind !== "ok") throw new ContractError(reply.error.code);
  return reply.value;
};
const guard = (ctx: ExtensionContext) =>
  ctx.mode === "tui" &&
  ctx.hasUI &&
  ctx.isProjectTrusted() &&
  process.env.CADENCE_SUBAGENT_CHILD !== "1";
const CHECK = Type.Object({
  name: Type.String(),
  command: Type.String(),
  timeoutMs: Type.Integer({ minimum: 100, maximum: 1200000 }),
});
const PLAN = Type.Object({
  goal: Type.String(),
  design: Type.String(),
  decisions: Type.String(),
  acceptance: Type.String(),
  projectContext: Type.String(),
  tasks: Type.Array(
    Type.Object({
      id: Type.String(),
      title: Type.String(),
      instructions: Type.String(),
      writes: Type.Array(Type.String()),
      after: Type.Array(Type.String()),
    }),
    { minItems: 1, maxItems: 16 },
  ),
  checks: Type.Array(CHECK, { minItems: 1, maxItems: 16 }),
  setup: Type.Array(CHECK, { maxItems: 4 }),
  baselineChecks: Type.Array(CHECK, { maxItems: 16 }),
  repairAttempts: Type.Integer({ minimum: 0, maximum: 2 }),
  delivery: Type.Union([
    Type.Literal("local-merge"),
    Type.Literal("working-copy"),
  ]),
});

export function registerCadenceMode(pi: ExtensionAPI): void {
  let state = idle(),
    context: ExtensionContext | undefined,
    generation = 0;
  let permission: { id: string; digest: string; at: number } | undefined;
  let allowStart = false,
    connecting: Promise<void> | undefined;
  let unsubscribe: (() => void) | undefined,
    poll: ReturnType<typeof setInterval> | undefined;
  let polling = false;
  // Host action methods are unavailable during extension discovery/loading.
  let normalTools: string[] = [];
  const raw = new CadenceUserInput(),
    connection = new NativeConnection();
  const client = () => {
    if (!connection.client) throw new ContractError("unavailable");
    return connection.client;
  };
  const persist = () => pi.appendEntry(CADENCE_MODE_ENTRY, state);
  const status = (text = "ready") =>
    context?.ui.setStatus(
      "cadence",
      state.enabled ? `Cadence • ${text}` : undefined,
    );
  const stopPolling = () => {
    clearInterval(poll);
    poll = undefined;
  };
  const active = (ctx: ExtensionContext) => {
    if (!state.enabled || !guard(ctx) || ctx.cwd !== state.cwd)
      throw new ContractError("forbidden");
    context = ctx;
  };
  const summarize = (run: WorkflowRun) =>
    `Cadence ${run.status} • ${run.goal}\n${run.steps.map((s) => `${s.kind} ${s.id}: ${s.status}${s.exitCode === null ? "" : ` (exit ${s.exitCode})`}\n${s.text}${s.truncated ? "\n[Preview truncated; full result retained by owner.]" : ""}`).join("\n")}\n${run.notice}${run.mergedCommit ? `\nLocal merge: ${run.mergedCommit}` : ""}\nAutomatic review is not human review. Cadence mode remains enabled.`;
  const agentDir = () =>
    process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  const connect = async (ctx: ExtensionContext, selectModel = true) => {
    active(ctx);
    if (connecting) return connecting;
    const expected = generation;
    const check = () => {
      active(ctx);
      if (generation !== expected) throw new ContractError("stale");
    };
    const operation = async () => {
      if (!connection.client) {
        const coordination = new ServiceCoordination(
          effectiveWorkspace(ctx.cwd).workspace,
        );
        const observed = coordination.inspect();
        if (
          (observed.status === "absent" || observed.status === "stopped") &&
          allowStart
        ) {
          if (process.env.CADENCE_AUTOSTART === "0")
            throw new Error(
              "On-demand owner startup is disabled by CADENCE_AUTOSTART=0. Start the project explicitly or change that preference.",
            );
          // Explicit mode entry/current user Send only. No install or boot registration.
          const launched = await pi.exec(
            process.execPath,
            [
              fileURLToPath(new URL("./service-cli.mjs", import.meta.url)),
              "project",
              "open",
              ctx.cwd,
              "--agent-dir",
              agentDir(),
            ],
            { timeout: 20000 },
          );
          check();
          if (launched.code !== 0)
            throw new Error(
              "Cadence project owner could not start. No install, fallback or uncertain-lock cleanup was attempted. Use cadence-service diagnose for details.",
            );
        }
        await connection.attach(ctx.cwd);
        check();
      }
      if (!connection.client || !connection.compatible())
        throw new ContractError("unsupported-context");
      if (!selectModel) return;
      const catalog = value(await connection.client.models());
      check();
      const preferences = new CadencePreferences(agentDir());
      const saved = preferences.read();
      const selected =
        saved ??
        (ctx.model
          ? decodeModelSelector({
              provider: ctx.model.provider,
              model: ctx.model.id,
              api: ctx.model.api,
              thinking: ctx.thinkingLevel,
            })
          : null);
      if (!selected)
        throw new Error("Choose a Pi model before entering Cadence.");
      const same =
        catalog.selected &&
        canonicalJson({
          provider: catalog.selected.provider,
          model: catalog.selected.model,
          api: catalog.selected.api,
          thinking: catalog.selected.thinking,
        }) === canonicalJson(selected);
      if (!same) {
        value(
          await connection.client.chooseModel({
            expected: catalog.version,
            choice: selected,
          }),
        );
        check();
      }
      if (!saved) preferences.save(selected);
    };
    connecting = operation();
    try {
      await connecting;
    } finally {
      connecting = undefined;
    }
  };
  const request = async (
    ctx: ExtensionContext,
    input: WorkflowRequest,
    commandId = randomUUID(),
  ): Promise<WorkflowResponse> => {
    await connect(
      ctx,
      input.action === "research" || input.action === "propose",
    );
    if (!connection.client || !connection.session)
      throw new ContractError("unavailable");
    const r = value(
      await connection.client.workbenchCommand({
        kind: "workflow",
        commandId,
        epoch: connection.session.epoch,
        request: input,
      }),
    );
    if (r.kind !== "workflow") throw new ContractError("invalid");
    const response = r.response;
    if (
      ((input.action === "execute" || input.action === "research") &&
        (response.type !== "run" || response.run.id !== commandId)) ||
      (input.action === "cancel" &&
        (response.type !== "run" || response.run.id !== input.runId)) ||
      (input.action === "propose" &&
        (response.type !== "proposal" ||
          response.proposal.id !== commandId ||
          canonicalJson(response.proposal.plan) !==
            canonicalJson(input.plan))) ||
      (input.action === "prepare" &&
        (response.type !== "grant" ||
          response.proposal.id !== input.proposalId ||
          response.proposal.digest !== input.digest))
    )
      throw new ContractError("unavailable");
    return response;
  };
  const observe = async (
    ctx: ExtensionContext,
    id: string,
  ): Promise<WorkflowRun> => {
    await connect(ctx, false);
    if (!connection.client) throw new ContractError("unavailable");
    const r = value(
      await connection.client.workbenchRead({ kind: "workflow", id }),
    );
    if (
      r.kind !== "workflow" ||
      r.response.type !== "run" ||
      r.response.run.id !== id
    )
      throw new ContractError("invalid");
    return r.response.run;
  };
  const requireSettledRun = async (ctx: ExtensionContext) => {
    if (!state.runId) return;
    const previous = await observe(ctx, state.runId);
    if (["running", "queued", "unknown"].includes(previous.status))
      throw new Error(
        "The current workflow is still active or uncertain. Keep discussing or use cadence_status/cadence_cancel; do not replace its identity with another goal.",
      );
  };
  const watch = (ctx: ExtensionContext, id: string) => {
    stopPolling();
    const expected = generation;
    poll = setInterval(() => {
      if (polling || generation !== expected || !state.enabled) return;
      polling = true;
      void observe(ctx, id)
        .then((run) => {
          if (generation !== expected || state.runId !== id) return;
          status(
            run.status === "running" || run.status === "queued"
              ? run.phase
              : "ready",
          );
          if (!["running", "queued"].includes(run.status)) {
            stopPolling();
            pi.sendMessage(
              {
                customType: "cadence-workflow-result",
                content: summarize(run),
                display: true,
              },
              { triggerTurn: false },
            );
          }
        })
        .catch(() => {
          stopPolling();
          status("observation unavailable; work may continue");
        })
        .finally(() => {
          polling = false;
        });
    }, 2000);
    poll.unref?.();
  };
  const leave = async () => {
    ++generation;
    raw.clear();
    permission = undefined;
    allowStart = false;
    stopPolling();
    if (state.enabled) pi.setActiveTools(state.previousTools);
    return connection.detach();
  };
  pi.on("session_start", (_event, ctx) => {
    void leave().catch(() => {});
    unsubscribe?.();
    context = ctx;
    state = restoreCadenceMode(ctx.sessionManager.getBranch(), ctx.cwd);
    const normal = pi.getActiveTools().filter((n) => !TOOLS.includes(n));
    normalTools = normal;
    if (!state.previousTools.length) state.previousTools = normal;
    pi.setActiveTools(state.enabled ? TOOLS : normal);
    status(state.runId ? "retained work; ask for status" : "ready");
    if (ctx.mode === "tui")
      unsubscribe = ctx.ui.onTerminalInput((data) => {
        raw.input(
          data,
          ctx.ui.getEditorText(),
          guard(ctx) && ctx.isIdle() && !ctx.hasPendingMessages(),
        );
        return undefined;
      });
  });
  pi.on("session_shutdown", () => {
    unsubscribe?.();
    unsubscribe = undefined;
    return departure(leave());
  });
  pi.on("session_before_switch", () => {
    void leave().catch(() => {});
  });
  pi.on("session_before_fork", () => {
    void leave().catch(() => {});
  });
  pi.on("session_before_tree", () => {
    void leave().catch(() => {});
  });
  pi.on("session_tree", (_event, ctx) => {
    state = restoreCadenceMode(ctx.sessionManager.getBranch(), ctx.cwd);
    context = ctx;
    pi.setActiveTools(
      state.enabled
        ? TOOLS
        : state.previousTools.length
          ? state.previousTools
          : normalTools,
    );
    status();
  });
  pi.on("input", (event, ctx) => {
    if (!state.enabled) return;
    context = ctx;
    permission = undefined;
    const human = event.source === "interactive" && raw.consume(event.text);
    if (human) allowStart = true;
    if (human && exiting(event.text)) {
      const previous = state.previousTools;
      state = { ...state, enabled: false, proposal: null };
      persist();
      pi.setActiveTools(previous);
      status();
      void leave().catch(() => {});
      ctx.ui.notify(
        "Cadence mode disabled. Accepted work, if any, continues; exit is not Cancel.",
        "info",
      );
      return { action: "handled" as const };
    }
    if (human && approved(event.text) && state.proposal)
      permission = {
        id: state.proposal.id,
        digest: state.proposal.digest,
        at: Date.now(),
      };
    return undefined;
  });
  pi.on("before_agent_start", () =>
    state.enabled
      ? {
          message: {
            customType: "cadence-mode-context",
            content: `${INSTRUCTIONS}\nCurrent retained run: ${state.runId ?? "none"}. Current proposal: ${state.proposal?.id ?? "none; restore does not restore approval"}.`,
            display: false,
          },
        }
      : undefined,
  );
  pi.on("tool_call", (event) =>
    state.enabled && !TOOLS.includes(event.toolName)
      ? {
          block: true,
          reason:
            "Cadence uses coordinated readonly investigation and approved service execution. Use cadence_research/plan/status; exit Cadence explicitly to use uncoordinated host tools.",
        }
      : undefined,
  );
  pi.registerCommand("cadence", {
    description:
      "Enable Cadence for this entire conversation: /cadence [goal]. Continue in normal conversation; explicit exit only.",
    handler: async (args, ctx) => {
      if (
        !guard(ctx) ||
        !ctx.isIdle() ||
        ctx.hasPendingMessages() ||
        !raw.consumeCommand(args)
      )
        return;
      context = ctx;
      permission = undefined;
      allowStart = true;
      if (!state.enabled) {
        state = {
          ...idle(),
          enabled: true,
          cwd: ctx.cwd,
          previousTools: pi.getActiveTools().filter((n) => !TOOLS.includes(n)),
        };
        persist();
      }
      pi.setActiveTools(TOOLS);
      status();
      pi.sendMessage(
        {
          customType: "cadence-mode",
          content:
            "Cadence mode is ON for this conversation, until you explicitly exit. I will investigate and clarify first; implementation requires approval of the final plan. No task-manager menu or repeated /cadence is needed.",
          display: true,
        },
        { triggerTurn: false },
      );
      if (args.trim())
        pi.sendUserMessage(args, { expandPromptTemplates: false });
      else
        pi.sendMessage(
          {
            customType: "cadence-mode-ready",
            content:
              "Cadence mode is enabled. Continue the current goal if clear; otherwise ask what the user wants to accomplish. Do not create or execute a plan merely because mode was enabled.",
            display: false,
          },
          { triggerTurn: true },
        );
    },
  });
  pi.registerTool({
    name: "cadence_research",
    label: "Investigate project",
    description:
      "Delegate one or two focused readonly investigations. Cite project evidence and consolidate questions in the main conversation. No code editing or task UI.",
    parameters: Type.Object({
      goal: Type.String(),
      questions: Type.Array(Type.String(), { minItems: 1, maxItems: 2 }),
    }),
    async execute(_id, input, signal, update, ctx) {
      active(ctx);
      await connect(ctx);
      await requireSettledRun(ctx);
      const model = value(await client().models()).version;
      const commandId = randomUUID();
      state.runId = commandId;
      persist();
      const response = await request(
        ctx,
        { action: "research", ...input, model },
        commandId,
      );
      if (response.type !== "run") throw new ContractError("invalid");
      state.runId = response.run.id;
      persist();
      status("research");
      let run = response.run;
      while (["queued", "running"].includes(run.status) && !signal?.aborted) {
        update?.(
          result(
            `Investigating: ${run.goal}\n${run.steps.map((s) => `${s.id}: ${s.status}`).join("\n")}`,
          ),
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
        run = await observe(ctx, run.id);
      }
      status("ready");
      if (signal?.aborted) watch(ctx, run.id);
      return result(summarize(run));
    },
  });
  pi.registerTool({
    name: "cadence_plan",
    label: "Propose implementation plan",
    description:
      "After interactive clarification, publish the exact readable plan, dependency graph, checks, setup commands, repair budget and delivery policy for user approval. Does not execute.",
    parameters: PLAN,
    async execute(_id, input, _signal, _update, ctx) {
      active(ctx);
      await connect(ctx);
      permission = undefined;
      await requireSettledRun(ctx);
      const plan = decodeWorkflowPlan(input);
      const response = await request(ctx, {
        action: "propose",
        plan,
        model: value(await client().models()).version,
      });
      if (response.type !== "proposal") throw new ContractError("invalid");
      state.proposal = response.proposal;
      persist();
      status("awaiting plan approval");
      pi.sendMessage(
        {
          customType: "cadence-proposed-plan",
          content: readableWorkflowPlan(plan),
          display: true,
        },
        { triggerTurn: false },
      );
      return result(
        `${readableWorkflowPlan(plan)}\nPlan identity: ${response.proposal.digest}\nPlease show this plan to the user. They can type 按计划实施 to approve these exact bytes; vague agreement is not execution consent. Existing unrelated working-copy changes are not imported into isolated candidates.`,
      );
    },
  });
  pi.registerTool({
    name: "cadence_start",
    label: "Execute approved plan",
    description:
      "Start the current exact plan after fresh user approval. The service automatically implements, reviews, verifies, performs bounded repairs and delivers; client departure only detaches.",
    parameters: Type.Object({}),
    async execute(_id, _input, signal, _update, ctx) {
      active(ctx);
      const proposal = state.proposal;
      if (!proposal)
        throw new Error("No current plan. Clarify and propose it first.");
      const expected = generation;
      const prepared = await request(ctx, {
        action: "prepare",
        proposalId: proposal.id,
        digest: proposal.digest,
      });
      if (prepared.type !== "grant") throw new ContractError("invalid");
      const fromInput =
        permission?.id === proposal.id &&
        permission.digest === proposal.digest &&
        Date.now() >= permission.at &&
        Date.now() - permission.at < 120000;
      permission = undefined;
      if (
        !fromInput &&
        !(await ctx.ui.confirm(
          "Implement this plan automatically?",
          `${readableWorkflowPlan(prepared.proposal.plan)}\nProject: ${prepared.proposal.cwd}\nNo push or deployment. Canceling this dialog changes nothing.`,
        ))
      )
        return result(
          "Not started. Cadence remains enabled for further discussion.",
        );
      if (
        signal?.aborted ||
        expected !== generation ||
        state.proposal?.digest !== proposal.digest
      )
        throw new ContractError("stale");
      const commandId = randomUUID();
      // Retain the exact attempted identity before transport; a lost reply is
      // observed, never replaced with another Start or a revived approval.
      state.runId = commandId;
      state.proposal = null;
      persist();
      const started = await request(
        ctx,
        {
          action: "execute",
          proposalId: proposal.id,
          digest: proposal.digest,
          grant: prepared.grant,
        },
        commandId,
      );
      if (started.type !== "run") throw new ContractError("invalid");
      state.runId = started.run.id;
      state.proposal = null;
      persist();
      status("executing");
      watch(ctx, started.run.id);
      return result(
        `Accepted. Implementation, verification and agreed delivery now run under the persistent owner. No further routine approval is needed. ${started.run.id}\nCadence remains enabled. Closing/switching the conversation does not cancel this work.`,
      );
    },
  });
  pi.registerTool({
    name: "cadence_status",
    label: "Observe workflow",
    description:
      "Read the current retained workflow outcome without replaying any action.",
    parameters: Type.Object({ stepId: Type.Optional(Type.String()) }),
    async execute(_id, input, _signal, _update, ctx) {
      active(ctx);
      if (!state.runId)
        return result(
          "Cadence is enabled; no run yet. Continue clarifying the goal.",
        );
      if (input.stepId) {
        await connect(ctx, false);
        const detail = value(
          await client().workbenchRead({
            kind: "workflow-detail",
            id: state.runId,
            stepId: input.stepId,
          }),
        );
        if (
          detail.kind !== "file" ||
          detail.path !== `workflow/${state.runId}/${input.stepId}`
        )
          throw new ContractError("invalid");
        return result(detail.text);
      }
      const run = await observe(ctx, state.runId);
      if (["running", "queued"].includes(run.status)) watch(ctx, run.id);
      return result(summarize(run));
    },
  });
  pi.registerTool({
    name: "cadence_cancel",
    label: "Cancel workflow",
    description:
      "Only on an explicit user request, request cancellation of the current workflow. No rollback, cleanup or inferred closure.",
    parameters: Type.Object({}),
    async execute(_id, _input, _signal, _update, ctx) {
      active(ctx);
      if (!state.runId) return result("No active workflow.");
      if (
        !(await ctx.ui.confirm(
          "Cancel current workflow?",
          "Request Stop and retain actual files/results. This does not reset or undo edits. Cadence mode remains enabled.",
        ))
      )
        return result("Cancellation not requested.");
      const r = await request(ctx, { action: "cancel", runId: state.runId });
      if (r.type !== "run") throw new ContractError("invalid");
      watch(ctx, r.run.id);
      return result(
        `Cancellation requested; closure is not yet implied.\n${summarize(r.run)}`,
      );
    },
  });
  pi.registerTool({
    name: "cadence_model",
    label: "Remember Cadence model",
    description:
      "Change the global Cadence model preference through a real user selection. Ordinary usage reuses the remembered model.",
    parameters: Type.Object({}),
    async execute(_id, _input, _signal, _update, ctx) {
      active(ctx);
      // Preference selection must never block observation/cancellation or the picker.
      await connect(ctx, false);
      const catalog = value(await client().models());
      const models = catalog.entries.filter(
        (m) => m.eligibility === "candidate" && m.api,
      );
      const labels = models.map((m) => `${m.provider}/${m.model} (${m.api})`);
      const selected = await ctx.ui.select(
        "Cadence model (remembered across projects)",
        labels,
      );
      if (!selected) return result("Model unchanged.");
      const model = models[labels.indexOf(selected)];
      const thinking = await ctx.ui.select(
        "Thinking",
        model.thinking.filter((t) => t.selectable).map((t) => t.level),
      );
      if (!thinking) return result("Model unchanged.");
      const choice: ModelSelector = decodeModelSelector({
        provider: model.provider,
        model: model.model,
        api: model.api,
        thinking,
      });
      value(
        await client().chooseModel({
          expected: catalog.version,
          choice,
        }),
      );
      new CadencePreferences(agentDir()).save(choice);
      state.proposal = null;
      permission = undefined;
      persist();
      return result(
        "Cadence model preference saved. It does not copy credentials or change an already accepted run.",
      );
    },
  });
}
