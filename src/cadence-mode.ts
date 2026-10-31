/** Persistent, branch-aware conversation mode. No execution owner lives in Pi. */
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
  getMarkdownTheme,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Key,
  Markdown,
  matchesKey,
  Text,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { CADENCE_INSTRUCTIONS as INSTRUCTIONS } from "./cadence-instructions.ts";
import { CadencePreferences } from "./cadence-preferences.ts";
import {
  departure,
  NativeConnection,
  projectStopCommand,
} from "./native-client.ts";
import type { ChatTurn } from "./service/contracts/workbench.ts";
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
  type ErrorCode,
  type ModelSelector,
  type PublicError,
  type Reply,
} from "./service-contract.ts";
import { effectiveWorkspace } from "./task-store.ts";
import { diagnosticText } from "./verification-diagnostics.ts";

export const CADENCE_MODE_ENTRY = "cadence-conversation-mode/1";
const CONTEXT = "cadence-mode-context";
const READY = "cadence-mode-ready";
const TOOLS = [
  "cadence_research",
  "cadence_plan",
  "cadence_start",
  "cadence_status",
  "cadence_cancel",
  "cadence_model",
];
const EXIT_HINT =
  "type `退出 Cadence` or `exit cadence`, or run `/cadence exit`";
/** Native additions to the shared conversation policy. */
const NATIVE =
  "PI TERMINAL: The user leaves Cadence mode by typing 退出 Cadence or exit cadence, or by running /cadence exit; you cannot exit for them, so tell them exactly this when they ask. Approval is the user's own typed 按计划实施 or the Start dialog. Workflow subagents appear in Pi's agent panel; cadence_status with a stepId (and transcript: true) reads one step's retained result or transcript.";
/** An Enter that closes a model-opened dialog must arrive after it settled. */
export const DIALOG_SETTLE_MS = 250;
/** Each Pi process tells the user once per project about an owner it started. */
const announcedOwners = new Set<string>();

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
/** Raw terminal evidence is ephemeral, never supplied by model/tool text or
 * paste. Pi trims what it submits, so comparisons use the trimmed text. */
export class CadenceUserInput {
  private value: { text: string; at: number } | undefined;
  private pasting = false;
  private dialog: { opened: number; fresh: boolean } | undefined;
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
    if (this.pasting || !matchesKey(data, Key.enter)) return;
    if (this.dialog) {
      // Only a typed Enter after the dialog settled may confirm it; a
      // type-ahead Enter meant for the editor never does.
      if (at - this.dialog.opened >= DIALOG_SETTLE_MS) this.dialog.fresh = true;
      return;
    }
    if (eligible) this.value = { text, at };
  }
  openDialog(at = Date.now()) {
    this.clear();
    this.dialog = { opened: at, fresh: false };
  }
  /** True only when a fresh typed Enter was seen while the dialog was open. */
  closeDialog(): boolean {
    const fresh = this.dialog?.fresh === true;
    this.dialog = undefined;
    return fresh;
  }
  consumeCommand(args: string, at = Date.now()) {
    const typed = this.value?.text.trim();
    if (
      !typed ||
      !/^\/cadence(?:[ \t]+[^\r\n]*)?$/u.test(typed) ||
      typed.replace(/^\/cadence[ \t]*/u, "") !== args.trim()
    ) {
      this.clear();
      return false;
    }
    return this.consume(typed, at);
  }
  consume(text: string, at = Date.now()) {
    const v = this.value;
    this.clear();
    return (
      !!v && v.text.trim() === text.trim() && at >= v.at && at - v.at < 1500
    );
  }
}
const approved = (s: string) =>
  /^(?:按(?:这个|本)?计划(?:开始)?(?:执行|实施)|确认(?:计划并)?(?:执行|实施)|approve and execute)[。.!！]?$/iu.test(
    s.trim(),
  );
export const exiting = (s: string) =>
  /^(?:(?:退出|关闭)\s*cadence(?:\s*模式)?|exit\s+cadence(?:\s+mode)?)[。.!！]?$/iu.test(
    s.trim(),
  );
const EXIT_ARGS = new Set(["exit", "off", "quit", "退出", "关闭"]);
const result = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: undefined,
});
/** A refused reply keeps its proven effect: only `none` restores state. */
class CadenceRefusal extends ContractError {
  constructor(
    code: ErrorCode,
    readonly effect: PublicError["effect"],
  ) {
    super(code);
  }
}
const definite = (error: unknown) =>
  error instanceof CadenceRefusal && error.effect === "none";
/** Codes after which the attachment itself may be dead or superseded. A
 * restarted owner on the same port answers the old capability with
 * `forbidden`/`unauthenticated`; the registry check decides whether to drop it. */
const DETACHED = new Set([
  "unavailable",
  "stale",
  "unsupported-context",
  "forbidden",
  "unauthenticated",
]);
const guard = (ctx: ExtensionContext) =>
  ctx.mode === "tui" &&
  ctx.hasUI &&
  ctx.isProjectTrusted() &&
  process.env.CADENCE_SUBAGENT_CHILD !== "1";
const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}\n… (truncated)` : text;
/** One retained step transcript as bounded readable text for the model. */
export function transcriptText(turn: ChatTurn | null): string {
  if (!turn) return "No retained transcript for this step.";
  const lines = [`Transcript (${turn.status})`];
  for (const item of turn.items)
    lines.push(
      item.role === "tool"
        ? `tool ${item.name}${item.error ? " (error)" : ""} ${clip(item.args, 512)}\n→ ${clip(item.text, 4096)}`
        : `${item.role}: ${clip(item.text, 8192)}`,
    );
  if (turn.notice) lines.push(turn.notice);
  return clip(lines.join("\n\n"), 48 * 1024);
}
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
/** The exact plan text, shown in full whether or not tool output is expanded.
 * Markdown needs Pi's initialized theme; plain text is the fallback. */
function planComponent(text: string): Component {
  const clean = diagnosticText(text, Number.MAX_SAFE_INTEGER);
  const plain = new Text(clean, 0, 0);
  let markdown: Markdown | undefined;
  try {
    markdown = new Markdown(clean, 0, 0, getMarkdownTheme());
  } catch {
    markdown = undefined;
  }
  return {
    render(width) {
      try {
        if (markdown) return markdown.render(width);
      } catch {
        markdown = undefined;
      }
      return plain.render(width);
    },
    invalidate() {
      markdown?.invalidate();
      plain.invalidate();
    },
  };
}

export function registerCadenceMode(pi: ExtensionAPI): void {
  let state = idle(),
    context: ExtensionContext | undefined,
    generation = 0;
  let permission: { id: string; digest: string; at: number } | undefined;
  let allowStart = false,
    reattach = false;
  let attaching: Promise<void> | undefined,
    selecting: Promise<void> | undefined;
  let unsubscribe: (() => void) | undefined,
    poll: ReturnType<typeof setInterval> | undefined;
  let polling = false,
    warnedPreferences = false;
  /** Tools to restore while this session shows only Cadence tools. */
  let applied: string[] | undefined;
  /** A run whose unknown outcome the user explicitly observed. */
  let acknowledgedUnknown: string | undefined;
  /** Workflow results that finished while Pi was busy, appended once idle. */
  let pending: { generation: number; content: string }[] = [];
  const raw = new CadenceUserInput(),
    connection = new NativeConnection();
  const client = () => {
    if (!connection.client) throw new ContractError("unavailable");
    return connection.client;
  };
  const value = <T>(reply: Reply<T>): T => {
    if (reply.kind === "ok") return reply.value;
    if (DETACHED.has(reply.error.code)) reattach = true;
    throw new CadenceRefusal(reply.error.code, reply.error.effect);
  };
  // Proposal bodies stay in tool results; the entry restores mode only.
  const persist = () =>
    pi.appendEntry(CADENCE_MODE_ENTRY, { ...state, proposal: null });
  /** Mode is engaged only in the trusted interactive terminal it belongs to;
   * elsewhere (print/RPC/untrusted) a saved mode is inert, never a lock. */
  const engaged = (ctx: ExtensionContext) =>
    state.enabled && guard(ctx) && ctx.cwd === state.cwd;
  const status = (text = "ready") =>
    context?.ui.setStatus(
      "cadence",
      !state.enabled
        ? undefined
        : context && engaged(context)
          ? `Cadence • ${text}`
          : "Cadence • inactive here",
    );
  const hide = () => {
    const current = pi.getActiveTools();
    if (current.some((n) => TOOLS.includes(n)))
      pi.setActiveTools(current.filter((n) => !TOOLS.includes(n)));
  };
  const release = () => {
    if (!applied) return;
    const previous = applied;
    applied = undefined;
    pi.setActiveTools(previous);
  };
  const engage = () => {
    if (!applied) {
      const current = pi.getActiveTools().filter((n) => !TOOLS.includes(n));
      applied = state.previousTools.length ? state.previousTools : current;
    }
    pi.setActiveTools(TOOLS);
  };
  const stopPolling = () => {
    clearInterval(poll);
    poll = undefined;
  };
  const active = (ctx: ExtensionContext) => {
    if (!state.enabled)
      throw new Error(
        "Cadence mode is off in this conversation. Accepted work, if any, continues in the project owner.",
      );
    if (!engaged(ctx)) throw new ContractError("forbidden");
    context = ctx;
  };
  const summarize = (run: WorkflowRun) =>
    `Cadence ${run.status} • ${run.goal}\n${run.steps.map((s) => `${s.kind} ${s.id}: ${s.status}${s.exitCode === null ? "" : ` (exit ${s.exitCode})`}\n${s.text}${s.truncated ? "\n[Preview truncated; full result retained by owner.]" : ""}`).join("\n")}\n${run.notice}${run.mergedCommit ? `\nLocal merge: ${run.mergedCommit}` : ""}${run.status === "unknown" ? "\nOutcome unknown: neither completed nor failed. Its actual effects are not inferred, and the owner keeps any fences." : ""}\nAutomatic review is not human review. Cadence mode remains enabled.`;
  const agentDir = () => getAgentDir();
  const launchOwner = async (ctx: ExtensionContext) => {
    if (process.env.CADENCE_AUTOSTART === "0")
      throw new Error(
        "On-demand owner startup is disabled by CADENCE_AUTOSTART=0. Start the project explicitly or change that preference.",
      );
    // service-cli needs Node; a compiled or Bun-run Pi has no Node execPath.
    const bun = !!process.versions.bun;
    // Explicit mode entry/current user Send only. No install or boot registration.
    const launched = await pi.exec(
      bun ? "node" : process.execPath,
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
    // A signal (including the timeout) reports code 0 from Pi's exec.
    if (launched.killed || launched.code !== 0)
      throw new Error(
        `Cadence project owner could not start${launched.killed ? " before its startup deadline" : ""}.${bun ? " Pi runs on Bun here; on-demand startup needs Node.js 22.19+ on PATH." : ""} No install, fallback or uncertain-lock cleanup was attempted. Use cadence-service diagnose --workspace <path> for details.`,
      );
    let workspace = effectiveWorkspace(ctx.cwd).workspace;
    try {
      const report = JSON.parse(
        launched.stdout.trim().split("\n").at(-1) ?? "",
      );
      if (typeof report?.workspace === "string") workspace = report.workspace;
    } catch {
      // The command succeeded; only the optional path detail is missing.
    }
    if (!announcedOwners.has(workspace)) {
      announcedOwners.add(workspace);
      ctx.ui.notify(
        `Cadence started a background project owner for ${workspace}. It keeps running after Pi exits so accepted work can finish; it is not a boot service. Stop it explicitly with: ${projectStopCommand(workspace)}`,
        "info",
      );
    }
  };
  /** Attach once; a dead, superseded or half-made attachment is replaced on
   * the next call. A live owner and its configuration are never replaced. */
  const ensureAttached = (ctx: ExtensionContext) => {
    if (attaching) return attaching;
    const expected = generation;
    const check = () => {
      active(ctx);
      if (generation !== expected) throw new ContractError("stale");
    };
    const operation = (async () => {
      const broken =
        !!connection.client &&
        (reattach || !connection.session || !connection.compatible());
      if (connection.client && !broken) return;
      reattach = false;
      if (broken) connection.forgetSuperseded(ctx.cwd);
      const observed = new ServiceCoordination(
        effectiveWorkspace(ctx.cwd).workspace,
      ).inspect();
      if (
        (observed.status === "absent" || observed.status === "stopped") &&
        allowStart
      ) {
        await launchOwner(ctx);
        check();
      }
      try {
        await connection.attach(ctx.cwd);
      } catch (error) {
        reattach = true;
        throw error;
      }
      check();
    })();
    attaching = operation;
    return operation.finally(() => {
      if (attaching === operation) attaching = undefined;
    });
  };
  /** The remembered (or current Pi) model on the owner, shared in flight, so
   * a model-selecting caller never inherits an attach-only connection. */
  const ensureModel = (ctx: ExtensionContext) => {
    if (selecting) return selecting;
    const expected = generation;
    const operation = (async () => {
      const catalog = value(await client().models());
      if (generation !== expected) throw new ContractError("stale");
      const preferences = new CadencePreferences(agentDir());
      let saved: ModelSelector | null = null,
        unreadable = false;
      try {
        saved = preferences.read();
      } catch {
        unreadable = true;
        if (!warnedPreferences) {
          warnedPreferences = true;
          ctx.ui.notify(
            `Cadence model preference ${preferences.path} is unreadable; using the current Pi model. Ask Cadence to change its model to rewrite that file.`,
            "warning",
          );
        }
      }
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
          await client().chooseModel({
            expected: catalog.version,
            choice: selected,
          }),
        );
        if (generation !== expected) throw new ContractError("stale");
      }
      if (!saved && !unreadable)
        try {
          preferences.save(selected);
        } catch {
          // Remembering is optional; the owner already uses this model.
        }
    })();
    selecting = operation;
    return operation.finally(() => {
      if (selecting === operation) selecting = undefined;
    });
  };
  const connect = async (ctx: ExtensionContext, selectModel = true) => {
    active(ctx);
    await ensureAttached(ctx);
    if (!connection.client || !connection.compatible()) {
      reattach = true;
      let stop = "its explicit stop command";
      try {
        stop = projectStopCommand(effectiveWorkspace(ctx.cwd).workspace);
      } catch {
        // The guidance keeps its generic wording.
      }
      throw new Error(
        `unsupported-context: the running Cadence project owner does not match this Cadence build or its WebUI assets. Nothing was started or replaced. When no accepted work is running, stop it with ${stop}; the next Cadence use starts the matching version.`,
      );
    }
    if (selectModel) await ensureModel(ctx);
  };
  const request = async (
    ctx: ExtensionContext,
    input: WorkflowRequest,
    commandId = randomUUID(),
    sending?: () => void,
  ): Promise<WorkflowResponse> => {
    await connect(
      ctx,
      input.action === "research" || input.action === "propose",
    );
    if (!connection.client || !connection.session)
      throw new ContractError("unavailable");
    const command = {
      kind: "workflow" as const,
      commandId,
      epoch: connection.session.epoch,
      request: input,
    };
    // Everything before this point had no owner effect.
    sending?.();
    const r = value(await connection.client.workbenchCommand(command));
    if (r.kind !== "workflow") throw new ContractError("invalid");
    const response = r.response;
    if (
      ((input.action === "execute" || input.action === "research") &&
        (response.type !== "run" || response.run.id !== commandId)) ||
      (input.action === "cancel" &&
        (response.type !== "run" || response.run.id !== input.runId)) ||
      // The owner may redact credential-like text; its proposal is the exact
      // plan that would run and is what the user sees and approves.
      (input.action === "propose" &&
        (response.type !== "proposal" || response.proposal.id !== commandId)) ||
      (input.action === "prepare" &&
        (response.type !== "grant" ||
          response.proposal.id !== input.proposalId ||
          response.proposal.digest !== input.digest))
    )
      throw new ContractError("unavailable");
    return response;
  };
  /** A run, or proof that the owner never accepted it: a reachable owner that
   * has no record of the ID and does not list it as active. */
  const observe = async (
    ctx: ExtensionContext,
    id: string,
  ): Promise<{ run: WorkflowRun } | { absent: true }> => {
    await connect(ctx, false);
    const reply = await client().workbenchRead({ kind: "workflow", id });
    if (reply.kind === "error" && reply.error.code === "unavailable") {
      const roster = await client().workbenchRead({ kind: "workflow-active" });
      if (
        roster.kind === "ok" &&
        roster.value.kind === "workflow-active" &&
        !roster.value.runs.some((run) => run.id === id)
      )
        return { absent: true };
    }
    const r = value(reply);
    if (
      r.kind !== "workflow" ||
      r.response.type !== "run" ||
      r.response.run.id !== id
    )
      throw new ContractError("invalid");
    return { run: r.response.run };
  };
  const forget = (id: string) => {
    if (state.runId !== id) return "";
    state.runId = null;
    persist();
    return `Attempted run ${id} is not known to the owner and is not active, so it was never accepted. Cadence forgot it; nothing was replayed.\n`;
  };
  /** Returns a notice when an attempted run was proven absent and forgotten. */
  const requireSettledRun = async (ctx: ExtensionContext) => {
    if (!state.runId) return "";
    const seen = await observe(ctx, state.runId);
    if ("absent" in seen) return forget(state.runId);
    const previous = seen.run;
    if (["running", "queued"].includes(previous.status))
      throw new Error(
        "The current workflow is still active. Keep discussing or use cadence_status/cadence_cancel; do not replace its identity with another goal.",
      );
    if (previous.status === "unknown" && acknowledgedUnknown !== previous.id)
      throw new Error(
        `Workflow ${previous.id} has an unknown outcome (for example, its owner stopped while it ran); it is neither completed nor failed. Call cadence_status to observe it explicitly; after that research or a new plan may continue.`,
      );
    return "";
  };
  const deliver = (ctx: ExtensionContext, run: WorkflowRun) => {
    ctx.ui.notify(
      `Cadence workflow ${run.status}: ${run.goal.slice(0, 160)}`,
      run.status === "completed" ? "info" : "warning",
    );
    // A message appended mid-turn would split a tool call from its result.
    if (ctx.isIdle())
      pi.sendMessage(
        {
          customType: "cadence-workflow-result",
          content: summarize(run),
          display: true,
        },
        { triggerTurn: false },
      );
    else pending.push({ generation, content: summarize(run) });
  };
  const flush = (ctx: ExtensionContext) => {
    if (!pending.length || !ctx.isIdle()) return;
    const ready = pending.filter((p) => p.generation === generation);
    pending = [];
    for (const p of ready)
      pi.sendMessage(
        {
          customType: "cadence-workflow-result",
          content: p.content,
          display: true,
        },
        { triggerTurn: false },
      );
  };
  const watch = (ctx: ExtensionContext, id: string) => {
    stopPolling();
    const expected = generation;
    poll = setInterval(() => {
      if (polling || generation !== expected || !state.enabled) return;
      polling = true;
      void observe(ctx, id)
        .then((seen) => {
          if (generation !== expected || state.runId !== id) return;
          if ("absent" in seen) {
            stopPolling();
            status("ready");
            return;
          }
          const run = seen.run;
          status(
            run.status === "running" || run.status === "queued"
              ? run.phase
              : "ready",
          );
          if (!["running", "queued"].includes(run.status)) {
            stopPolling();
            deliver(ctx, run);
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
  /** A guarded dialog: the safe choice comes first (a stray Enter picks it),
   * and the other needs a typed, non-paste Enter after the dialog settled. */
  /** A model-opened selection counts only with a typed, non-paste Enter
   * after the dialog settled; anything else reads as no selection. */
  const pick = async (
    ctx: ExtensionContext,
    title: string,
    options: string[],
  ) => {
    raw.openDialog();
    let choice: string | undefined;
    try {
      choice = await ctx.ui.select(title, options);
    } finally {
      if (!raw.closeDialog()) choice = undefined;
    }
    return choice;
  };
  const confirm = async (
    ctx: ExtensionContext,
    title: string,
    message: string,
    safe: string,
    act: string,
  ) => (await pick(ctx, `${title}\n${message}`, [safe, act])) === act;
  const leave = async () => {
    ++generation;
    raw.clear();
    permission = undefined;
    allowStart = false;
    pending = [];
    stopPolling();
    return connection.detach();
  };
  const exit = (ctx: ExtensionContext) => {
    context = ctx;
    if (!state.enabled) {
      ctx.ui.notify(
        "Cadence mode is not enabled in this conversation.",
        "info",
      );
      return;
    }
    release();
    hide();
    state = { ...state, enabled: false, proposal: null };
    persist();
    status();
    void leave().catch(() => {});
    ctx.ui.notify(
      "Cadence mode disabled. Accepted work, if any, continues; exit is not Cancel.",
      "info",
    );
  };
  const rebind = (ctx: ExtensionContext) => {
    context = ctx;
    state = restoreCadenceMode(ctx.sessionManager.getBranch(), ctx.cwd);
    acknowledgedUnknown = undefined;
    if (engaged(ctx)) engage();
    else {
      // Only a session that showed Cadence tools changes the active set.
      release();
      hide();
    }
  };
  pi.on("session_start", (_event, ctx) => {
    void leave().catch(() => {});
    unsubscribe?.();
    unsubscribe = undefined;
    rebind(ctx);
    if (state.enabled && !engaged(ctx) && ctx.hasUI)
      ctx.ui.notify(
        `Cadence mode is saved for this conversation but inactive here: it needs a trusted interactive Pi terminal. Ordinary tools remain available; to leave the mode, ${EXIT_HINT}.`,
        "info",
      );
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
    release();
    return departure(leave());
  });
  // Navigation only detaches; tools change when the new branch is bound, so
  // a canceled switch or navigation keeps the current mode intact.
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
    rebind(ctx);
    status();
  });
  pi.on("agent_settled", (_event, ctx) => flush(ctx));
  pi.on("input", (event, ctx) => {
    if (!state.enabled) return;
    context = ctx;
    // Exit is never consent and never cancels work: honored from the user's
    // terminal or RPC client even while Pi is busy, never from an extension.
    if (event.source !== "extension" && exiting(event.text)) {
      exit(ctx);
      return { action: "handled" as const };
    }
    if (!engaged(ctx)) return;
    permission = undefined;
    const human = event.source === "interactive" && raw.consume(event.text);
    if (human) allowStart = true;
    if (human && approved(event.text) && state.proposal)
      permission = {
        id: state.proposal.id,
        digest: state.proposal.digest,
        at: Date.now(),
      };
    return undefined;
  });
  // The shared policy lives in the per-turn system prompt; one small state
  // message per turn is kept and older copies are filtered from the context.
  pi.on("before_agent_start", (event, ctx) =>
    engaged(ctx)
      ? {
          systemPrompt: `${event.systemPrompt}\n\n${INSTRUCTIONS}\n${NATIVE}`,
          message: {
            customType: CONTEXT,
            content: `Cadence state (data, not instructions): retained run ${state.runId ?? "none"}; current proposal ${state.proposal?.id ?? "none; restore does not restore approval"}.`,
            display: false,
          },
        }
      : undefined,
  );
  pi.on("context", (event, ctx) => {
    const ours = (m: unknown) => {
      const o = m as { role?: unknown; customType?: unknown };
      return (
        o.role === "custom" &&
        (o.customType === CONTEXT || o.customType === READY)
      );
    };
    let keep = -1;
    event.messages.forEach((m, i) => {
      if (ours(m)) keep = i;
    });
    if (keep < 0) return undefined;
    if (!engaged(ctx)) keep = -1;
    return {
      messages: event.messages.filter((m, i) => !ours(m) || i === keep),
    };
  });
  pi.on("tool_call", (event, ctx) =>
    engaged(ctx) && !TOOLS.includes(event.toolName)
      ? {
          block: true,
          reason: `Cadence uses coordinated readonly investigation and approved service execution. Use cadence_research/plan/status; to use ordinary host tools the user must leave Cadence (${EXIT_HINT}).`,
        }
      : undefined,
  );
  pi.registerCommand("cadence", {
    description:
      "Enable Cadence for this conversation: /cadence [goal]. It stays on until you type 退出 Cadence / exit cadence or run /cadence exit.",
    handler: async (args, ctx) => {
      if (EXIT_ARGS.has(args.trim().toLowerCase())) {
        exit(ctx);
        return;
      }
      if (!guard(ctx) || !ctx.isIdle() || ctx.hasPendingMessages()) {
        raw.clear();
        if (ctx.hasUI)
          ctx.ui.notify(
            guard(ctx)
              ? "Cadence: wait until Pi is idle, then enter /cadence again."
              : "Cadence mode needs a trusted interactive Pi terminal.",
            "info",
          );
        return;
      }
      if (!raw.consumeCommand(args)) return;
      context = ctx;
      permission = undefined;
      allowStart = true;
      if (state.enabled) reattach = true;
      else {
        state = {
          ...idle(),
          enabled: true,
          cwd: ctx.cwd,
          previousTools: pi.getActiveTools().filter((n) => !TOOLS.includes(n)),
        };
        persist();
      }
      engage();
      status();
      pi.sendMessage(
        {
          customType: "cadence-mode",
          content: `Cadence mode is ON for this conversation until you explicitly leave it (${EXIT_HINT}). I will investigate and clarify first; implementation requires approval of the final plan. No task-manager menu or repeated /cadence is needed.`,
          display: true,
        },
        { triggerTurn: false },
      );
      if (args.trim())
        pi.sendUserMessage(args.trim(), { expandPromptTemplates: false });
      // This turn starts without a prompt, so it carries the policy itself.
      else
        pi.sendMessage(
          {
            customType: READY,
            content: `${INSTRUCTIONS}\n${NATIVE}\nCadence mode is enabled. Continue the current goal if clear; otherwise ask what the user wants to accomplish. Do not create or execute a plan merely because mode was enabled.`,
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
      const notice = await requireSettledRun(ctx);
      const model = value(await client().models()).version;
      const commandId = randomUUID(),
        before = state.runId;
      let sent = false,
        response: WorkflowResponse;
      try {
        response = await request(
          ctx,
          { action: "research", ...input, model },
          commandId,
          () => {
            // Retain the attempted identity before transport: a lost reply is
            // observed, never replaced with another research request.
            state.runId = commandId;
            persist();
            sent = true;
          },
        );
      } catch (error) {
        if ((!sent || definite(error)) && state.runId === commandId) {
          state.runId = before;
          persist();
        }
        throw error;
      }
      if (response.type !== "run") throw new ContractError("invalid");
      status("research");
      let run = response.run;
      while (["queued", "running"].includes(run.status) && !signal?.aborted) {
        update?.(
          result(
            `Investigating: ${run.goal}\n${run.steps.map((s) => `${s.kind} ${s.id}: ${s.status}`).join("\n")}\nSubagents are listed in Pi's agent panel.`,
          ),
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const seen = await observe(ctx, run.id);
        if ("absent" in seen) throw new ContractError("unavailable");
        run = seen.run;
      }
      status("ready");
      if (signal?.aborted) watch(ctx, run.id);
      return result(`${notice}${summarize(run)}`);
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
      const notice = await requireSettledRun(ctx);
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
      const shown = readableWorkflowPlan(response.proposal.plan);
      const redacted =
        canonicalJson(response.proposal.plan) !== canonicalJson(plan);
      // The plan is displayed by this tool's own result: a message sent now
      // would land between this tool call and its result.
      return {
        content: [
          {
            type: "text" as const,
            text: `${notice}${shown}\nPlan identity: ${response.proposal.digest}\n${redacted ? "The owner redacted credential-like text; the plan above is exactly what would run.\n" : ""}The user sees this complete plan. They can type 按计划实施 to approve these exact bytes; vague agreement is not execution consent. Existing unrelated working-copy changes are not imported into isolated candidates.`,
          },
        ],
        details: {
          plan: shown,
          digest: response.proposal.digest,
          redacted,
        },
      };
    },
    renderResult(output) {
      const d = output.details as
        | { plan?: unknown; digest?: unknown; redacted?: unknown }
        | undefined;
      if (typeof d?.plan === "string" && typeof d.digest === "string")
        return planComponent(
          `${d.plan}\nPlan identity: ${d.digest}\n${d.redacted === true ? "Credential-like text was redacted by the owner; this is exactly what would run.\n" : ""}Type 按计划实施 to approve these exact bytes, or keep discussing.`,
        );
      return new Text(
        diagnosticText(
          output.content
            .map((c) => (c.type === "text" ? c.text : ""))
            .join("\n"),
          Number.MAX_SAFE_INTEGER,
        ),
        0,
        0,
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
      const fromInput =
        permission?.id === proposal.id &&
        permission.digest === proposal.digest &&
        Date.now() >= permission.at &&
        Date.now() - permission.at < 120000;
      permission = undefined;
      if (
        !fromInput &&
        !(await confirm(
          ctx,
          "Implement this plan automatically?",
          `${readableWorkflowPlan(proposal.plan)}\nProject: ${proposal.cwd}\nNo push or deployment. Keeping the discussion changes nothing.`,
          "Keep discussing (do not start)",
          "Start this exact plan",
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
      // The grant is fresh after consent, so reading the plan never expires it.
      const prepared = await request(ctx, {
        action: "prepare",
        proposalId: proposal.id,
        digest: proposal.digest,
      });
      if (
        prepared.type !== "grant" ||
        canonicalJson(prepared.proposal.plan) !==
          canonicalJson(proposal.plan) ||
        prepared.proposal.cwd !== proposal.cwd
      )
        throw new ContractError("stale");
      const commandId = randomUUID(),
        before = { runId: state.runId, proposal };
      let sent = false,
        started: WorkflowResponse;
      try {
        started = await request(
          ctx,
          {
            action: "execute",
            proposalId: proposal.id,
            digest: proposal.digest,
            grant: prepared.grant,
          },
          commandId,
          () => {
            // Retain the exact attempted identity before transport; a lost
            // reply is observed, never replaced with another Start or a
            // revived approval.
            state.runId = commandId;
            state.proposal = null;
            persist();
            sent = true;
          },
        );
      } catch (error) {
        // A proven refusal had no effect: keep the plan for a fresh approval.
        if ((!sent || definite(error)) && state.runId === commandId) {
          state.runId = before.runId;
          state.proposal = before.proposal;
          persist();
        }
        throw error;
      }
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
      "Read the current retained workflow outcome without replaying any action. With stepId, read that step's retained result, or its subagent transcript with transcript: true.",
    parameters: Type.Object({
      stepId: Type.Optional(Type.String()),
      transcript: Type.Optional(Type.Boolean()),
    }),
    async execute(_id, input, _signal, _update, ctx) {
      active(ctx);
      if (!state.runId)
        return result(
          "Cadence is enabled; no run yet. Continue clarifying the goal.",
        );
      const id = state.runId;
      if (input.stepId) {
        await connect(ctx, false);
        if (input.transcript) {
          const t = value(
            await client().workbenchRead({
              kind: "workflow-transcript",
              id,
              stepId: input.stepId,
            }),
          );
          if (
            t.kind !== "workflow-transcript" ||
            t.runId !== id ||
            t.stepId !== input.stepId
          )
            throw new ContractError("invalid");
          return result(transcriptText(t.turn));
        }
        const detail = value(
          await client().workbenchRead({
            kind: "workflow-detail",
            id,
            stepId: input.stepId,
          }),
        );
        if (
          detail.kind !== "file" ||
          detail.path !== `workflow/${id}/${input.stepId}`
        )
          throw new ContractError("invalid");
        return result(detail.text);
      }
      const seen = await observe(ctx, id);
      if ("absent" in seen) {
        status("ready");
        return result(`${forget(id)}Continue normally.`);
      }
      const run = seen.run;
      if (["running", "queued"].includes(run.status)) watch(ctx, run.id);
      if (run.status === "unknown") acknowledgedUnknown = run.id;
      return result(
        `${summarize(run)}${run.status === "unknown" ? "\nThis explicit observation is recorded: research or a new plan may now continue. A new plan observes the current files; nothing about this run is assumed." : ""}`,
      );
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
        !(await confirm(
          ctx,
          "Cancel current workflow?",
          "Request Stop and retain actual files/results. This does not reset or undo edits. Cadence mode remains enabled.",
          "Keep running",
          "Request cancellation",
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
      const selected = await pick(
        ctx,
        "Cadence model (remembered across projects)",
        labels,
      );
      if (!selected) return result("Model unchanged.");
      const model = models[labels.indexOf(selected)];
      const thinking = await pick(
        ctx,
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
      // An explicit selection may atomically rewrite a corrupt preference.
      new CadencePreferences(agentDir()).choose(choice);
      warnedPreferences = false;
      state.proposal = null;
      permission = undefined;
      persist();
      return result(
        "Cadence model preference saved. It does not copy credentials or change an already accepted run.",
      );
    },
  });
}
