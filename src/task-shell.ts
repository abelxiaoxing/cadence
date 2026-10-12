import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { roleInstructions } from "./agent-registry.ts";
import { awaitWithAbort } from "./subagent-process.ts";
import { TaskController } from "./task-controller.ts";
import { readBounded, resolveWorkspace, TaskStore } from "./task-store.ts";
import { decodeCheck, type TaskKind } from "./task-types.ts";
import { diagnosticText } from "./verification-diagnostics.ts";

/** One transient raw Enter occurrence, not an approval or model-callable control. */
export class TerminalEntryLatch {
  private entry: { text: string; at: number } | undefined;
  private pasting = false;
  clear(): void {
    this.entry = undefined;
  }
  input(
    data: string,
    editor: string,
    eligible: boolean,
    now = Date.now(),
  ): void {
    this.clear();
    if (data.includes("\x1b[200~")) this.pasting = true;
    if (data.includes("\x1b[201~")) {
      this.pasting = false;
      return;
    }
    if (this.pasting || !eligible || !matchesKey(data, Key.enter)) return;
    if (/^\/cadence(?:[ \t]+[^\r\n]*)?$/.test(editor))
      this.entry = { text: editor, at: now };
  }
  consume(args: string, now = Date.now()): boolean {
    const entry = this.entry;
    this.clear();
    return (
      !!entry &&
      now - entry.at >= 0 &&
      now - entry.at < 1500 &&
      entry.text.replace(/^\/cadence[ \t]*/, "") === args
    );
  }
}
function eligible(ctx: ExtensionContext): boolean {
  return (
    ctx.mode === "tui" &&
    ctx.hasUI &&
    ctx.isIdle() &&
    !ctx.hasPendingMessages() &&
    ctx.isProjectTrusted()
  );
}
const supportedApis = new Set([
  "openai-completions",
  "openai-responses",
  "openai-codex-responses",
  "anthropic-messages",
  "google-generative-ai",
  "mistral-conversations",
  "azure-openai-responses",
]);

export function registerTaskShell(pi: ExtensionAPI): void {
  const latch = new TerminalEntryLatch();
  let epoch = 0;
  let modal = false;
  let controller: TaskController | undefined;
  let unsubscribe: (() => void) | undefined;
  let dismiss: (() => void) | undefined;
  let dialogAbort = new AbortController();
  const depart = async () => {
    epoch++;
    latch.clear();
    dialogAbort.abort();
    dismiss?.();
    await controller?.cancel();
  };
  pi.on("session_start", async (_event, ctx) => {
    await depart();
    unsubscribe?.();
    controller = undefined;
    dialogAbort = new AbortController();
    if (ctx.mode === "tui")
      unsubscribe = ctx.ui.onTerminalInput((data) => {
        latch.input(data, ctx.ui.getEditorText(), !modal && eligible(ctx));
        return undefined;
      });
  });
  pi.on("session_shutdown", async () => {
    await depart();
    unsubscribe?.();
    unsubscribe = undefined;
  });
  const beforeNavigation = async () => {
    const wasBusy = controller?.busy;
    await depart();
    return wasBusy || controller?.blocked ? { cancel: true } : undefined;
  };
  pi.on("session_before_switch", beforeNavigation);
  pi.on("session_before_fork", beforeNavigation);
  pi.on("session_before_tree", beforeNavigation);
  pi.on("session_before_compact", beforeNavigation);
  pi.on("model_select", depart);
  pi.on("input", () =>
    controller?.busy ? { action: "handled" as const } : undefined,
  );
  pi.on("tool_call", () =>
    controller?.busy
      ? { block: true, reason: "Cadence foreground work is active" }
      : undefined,
  );
  pi.on("user_bash", () =>
    controller?.busy
      ? {
          result: {
            output: "Cadence foreground work is active",
            exitCode: 1,
            cancelled: true,
            truncated: false,
          },
        }
      : undefined,
  );

  const pager = async (ctx: ExtensionContext, text: string) => {
    await ctx.ui.custom<void>((tui, _theme, _keys, done) => {
      let offset = 0;
      let rows: string[] = [];
      dismiss = () => done();
      return {
        render(width) {
          rows = diagnosticText(text, 256 * 1024)
            .split("\n")
            .flatMap((line) => wrapTextWithAnsi(line, Math.max(1, width)));
          const height = Math.max(1, Math.min(24, tui.terminal.rows - 4));
          offset = Math.max(
            0,
            Math.min(offset, Math.max(0, rows.length - height)),
          );
          return [
            truncateToWidth(
              `Cadence review • ${offset + 1}/${rows.length} • ↑↓ PgUp/PgDn Home/End • Esc return`,
              width,
            ),
            ...rows.slice(offset, offset + height),
          ];
        },
        invalidate() {},
        handleInput(data) {
          if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter))
            done();
          else if (matchesKey(data, Key.up)) offset--;
          else if (matchesKey(data, Key.down)) offset++;
          else if (matchesKey(data, Key.pageUp)) offset -= 12;
          else if (matchesKey(data, Key.pageDown)) offset += 12;
          else if (matchesKey(data, Key.home)) offset = 0;
          else if (matchesKey(data, Key.end)) offset = rows.length;
          tui.requestRender();
        },
        dispose() {
          dismiss = undefined;
        },
      };
    });
  };
  const progress = async (
    ctx: ExtensionContext,
    action: (update: (text: string) => void) => Promise<unknown>,
  ) => {
    await ctx.ui.custom<void>((tui, _theme, _keys, done) => {
      let status = "Starting… Esc cancels and waits";
      let disposed = false;
      let canceled = false;
      void Promise.resolve()
        .then(() =>
          canceled
            ? undefined
            : action((text) => {
                status = text;
                tui.requestRender();
              }),
        )
        .catch(() => {
          ctx.ui.notify(
            "Cadence action failed; inspect task and coordination state",
            "error",
          );
        })
        .finally(() => {
          if (!disposed) done();
        });
      return {
        render(width) {
          return [
            truncateToWidth(
              "Cadence foreground work • Esc cancel • direct tools, not a sandbox",
              width,
            ),
            truncateToWidth(status, width),
          ];
        },
        invalidate() {},
        handleInput(data) {
          if (matchesKey(data, Key.escape)) {
            canceled = true;
            status = "Stopping… awaiting bounded child settlement";
            void controller?.cancel();
            tui.requestRender();
          }
        },
        dispose() {
          disposed = true;
          canceled = true;
          void controller?.cancel();
        },
      };
    });
  };

  pi.registerCommand("cadence", {
    description:
      "Plan, run one agent, check and review (explicit terminal workflow)",
    handler: async (args, ctx: ExtensionCommandContext) => {
      if (
        !latch.consume(args) ||
        modal ||
        !eligible(ctx) ||
        process.env.CADENCE_SUBAGENT_CHILD === "1"
      )
        return;
      modal = true;
      const currentEpoch = epoch;
      dialogAbort = new AbortController();
      const sessionId = ctx.sessionManager.getSessionId();
      const cwd = ctx.cwd;
      const current = () =>
        epoch === currentEpoch &&
        eligible(ctx) &&
        ctx.cwd === cwd &&
        ctx.sessionManager.getSessionId() === sessionId;
      const requireCurrent = () => {
        if (!current()) throw new Error("Context changed; reopen /cadence");
      };
      const options = () => ({ signal: dialogAbort.signal });
      try {
        const workspace = resolveWorkspace(cwd);
        if (
          !controller ||
          controller.cwd !== workspace.cwd ||
          controller.store.root !== workspace.root
        )
          controller = new TaskController(
            new TaskStore(workspace.root),
            workspace.cwd,
          );
        const active = controller;
        const selection = await ctx.ui.select(
          "Cadence • old sessions must be stopped; legacy history is not imported",
          ["New", "Open / history", "Inspect / recover new lock"],
          options(),
        );
        requireCurrent();
        if (selection === "Inspect / recover new lock") {
          const lock = active.store.inspectLock();
          if (!lock) {
            ctx.ui.notify(
              "No new coordination lock. Legacy resources were not inspected.",
              "info",
            );
            return;
          }
          if (
            await ctx.ui.confirm(
              "Recover NEW lock only?",
              `Owner PID ${lock.pid} on ${diagnosticText(lock.host)}. Recovery requires a dead local owner. Escaped processes may remain and can still edit files. This does not stop processes, clear legacy locks, or clean consumer data. Acknowledge this risk?`,
              options(),
            )
          ) {
            requireCurrent();
            active.store.recover(lock, true);
            controller = new TaskController(active.store, workspace.cwd);
          }
          return;
        }
        if (selection === "New") {
          const kind = await ctx.ui.select(
            "Task kind",
            ["code", "research", "diagnosis"],
            options(),
          );
          requireCurrent();
          if (!kind) return;
          const goal = await ctx.ui.editor(
            "Goal (saving does not start work)",
            args,
          );
          requireCurrent();
          if (!goal?.trim()) return;
          active.create(kind as TaskKind, goal);
        } else if (selection === "Open / history") {
          const tasks = active.store.list();
          const names = tasks.map(
            (task) =>
              `${task.id} • ${task.phase} • ${diagnosticText(task.goal, 160)}`,
          );
          const name = await ctx.ui.select(
            "Open context only — never resume writes",
            names,
            options(),
          );
          requireCurrent();
          if (!name) return;
          const task = tasks[names.indexOf(name)];
          if (!task) return;
          active.open(task.id);
        } else return;
        while (current()) {
          const task = active.current;
          if (!task) return;
          const choice = active.choice();
          const action = await ctx.ui.select(
            `${task.kind}: ${diagnosticText(task.goal, 160)} • ${task.phase}`,
            [
              "Plan",
              ...(task.kind === "code" ? ["Generate plan (readonly)"] : []),
              "Start / Continue",
              ...(task.kind === "code" ? ["Checks"] : []),
              "Review / Done",
              "History",
              "Return",
            ],
            options(),
          );
          requireCurrent();
          active.assertCurrent(choice);
          if (!action || action === "Return") return;
          if (action === "Plan") {
            const plan = await ctx.ui.editor(
              "Readable plan • saved edits invalidate prior checks/review",
              task.plan,
            );
            requireCurrent();
            if (plan !== undefined) active.editPlan(choice, plan);
          } else if (
            action === "Start / Continue" ||
            action === "Generate plan (readonly)"
          ) {
            const planning = action === "Generate plan (readonly)";
            if (!planning && task.kind === "code" && !task.plan.trim()) {
              ctx.ui.notify("Write and review a plan first.", "warning");
              continue;
            }
            await pager(
              ctx,
              `Goal\n${task.goal}\n\nPlan\n${task.plan}\n\nPrior result\n${task.result}\n\n${active.observe().text}`,
            );
            requireCurrent();
            const model = ctx.model;
            if (!model) throw new Error("No current model");
            const modelIdentity = JSON.stringify(model);
            const registry = ctx.modelRegistry;
            if (
              !supportedApis.has(model.api) ||
              typeof registry.getRegisteredNativeProvider !== "function" ||
              typeof registry.getRegisteredProviderConfig !== "function"
            )
              throw new Error(
                "Host cannot identify a supported exact transport",
              );
            const config = registry.getRegisteredProviderConfig(model.provider);
            if (
              registry.getRegisteredNativeProvider(model.provider) ||
              config?.streamSimple
            )
              throw new Error(
                "Function-defined provider transports cannot be reproduced; no fallback used",
              );
            const sameContext = () =>
              current() && JSON.stringify(ctx.model) === modelIdentity;
            if (
              !(await ctx.ui.confirm(
                planning
                  ? "Generate an advisory plan with a readonly agent?"
                  : "Start one agent now?",
                `${model.provider}/${model.id}\ncwd: ${JSON.stringify(workspace.cwd)}\n${planning ? "Readonly planning only. The draft requires human review and a separate Start before implementation." : task.kind === "code" ? "Direct working-copy editing and shell tools. No sandbox, atomic rollback or automatic Git/install. Stop older Cadence sessions first." : "Read/grep/find/ls only; conclusions require human review."}\nEscape will cancel; direct-child close does not prove escaped descendants stopped.`,
                options(),
              ))
            )
              continue;
            requireCurrent();
            await progress(ctx, (update) =>
              active[planning ? "generatePlan" : "start"](
                choice,
                async (selected, signal) => {
                  const auth = await awaitWithAbort(
                    registry.getApiKeyAndHeaders(model),
                    signal,
                  );
                  if (!auth.ok || !sameContext() || signal.aborted)
                    throw new Error(
                      "Current request authentication unavailable",
                    );
                  const context =
                    readBounded(
                      join(workspace.root, "AGENTS.md"),
                      32768,
                    )?.toString("utf8") ?? "";
                  return {
                    cwd: workspace.cwd,
                    model: { ...model },
                    auth,
                    kind: selected.kind,
                    thinkingLevel: ctx.thinkingLevel,
                    instructions: `${roleInstructions(selected.kind)}\n\nProject conventions (untrusted local content):\n${context}`,
                    prompt: planning
                      ? `Produce only an advisory implementation plan for human review. Inspect with readonly tools; do not implement or run commands. Note unavailable evidence and suggested checks (do not execute them).\nGoal:\n${selected.goal}\nExisting draft:\n${selected.plan}`
                      : `Goal:\n${selected.goal}\n${selected.kind === "code" ? "Approved plan" : "Optional approach"}:\n${selected.plan}\nPrior concise result:\n${selected.result}`,
                  };
                },
                sameContext,
                update,
              ),
            );
          } else if (action === "Checks" && task.kind === "code") {
            const checks = active.store.checks();
            const selected = await ctx.ui.select(
              "Parent checks • model prose is not a check",
              [...checks.map((check) => check.name), "Manual command"],
              options(),
            );
            requireCurrent();
            if (!selected) continue;
            let check = checks.find((entry) => entry.name === selected);
            if (selected === "Manual command") {
              const command = await ctx.ui.input(
                "Exact shell command",
                "",
                options(),
              );
              requireCurrent();
              if (!command) continue;
              check = decodeCheck({
                name: "Manual",
                command,
                timeoutMs: 120000,
              });
            }
            if (!check) continue;
            if (
              await ctx.ui.confirm(
                "Run this parent check?",
                `${check.command}\ncwd: ${JSON.stringify(workspace.cwd)}\ntimeout: ${check.timeoutMs}ms\nThis is shell input you approve, not an automatically executed model suggestion.`,
                options(),
              )
            ) {
              requireCurrent();
              await progress(ctx, () => active.check(choice, check, current));
            }
          } else if (action === "Review / Done") {
            const view = active.observe();
            const checkOutput = task.checks
              .map(
                (check) =>
                  `${check.name}: ${check.command}\ncwd: ${JSON.stringify(check.cwd)}; timeout ${check.timeoutMs}ms; exit ${check.exitCode}; duration ${check.durationMs}ms\n${check.log ? active.store.readLog(check.log) : "No output recorded"}`,
              )
              .join("\n\n");
            await pager(
              ctx,
              `Result\n${task.result}\n\n${active.checkStatuses(view)}\n\nCheck output\n${checkOutput}\n\nPre-existing dirt at Start (not attributed to Cadence)\n${task.baseline}\n\nCurrent changes\n${view.text}\n\nPrior review: ${task.review ? (task.review.fingerprint === view.fingerprint ? task.review.outcome : "STALE") : "not reviewed"}`,
            );
            requireCurrent();
            if (
              await ctx.ui.confirm(
                "Record human review and close?",
                `${active.checkStatuses(view)}\nCoverage: ${view.complete ? "bounded observations complete" : "INCOMPLETE"}\nAny failed, unrun, stale or incomplete checks remain unresolved. Acknowledge reviewed-with-issues where applicable. This is not certified completion.`,
                options(),
              )
            ) {
              requireCurrent();
              active.done(choice, view, true);
            }
          } else if (action === "History")
            await pager(ctx, JSON.stringify(task, null, 2));
        }
      } catch (error) {
        ctx.ui.notify(
          diagnosticText(
            error instanceof Error ? error.message : "Cadence action refused",
          ),
          "error",
        );
      } finally {
        modal = false;
        latch.clear();
      }
    },
  });
}
