/** Readonly diagnostics. No task creation, plan approval, model choice or execution. */
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import {
  autostartHint,
  departure,
  MANAGEMENT_GUIDANCE,
  NativeConnection,
} from "./native-client.ts";
import {
  NativeHistory,
  type NativeViews,
  pretty,
  value,
} from "./native-history.ts";
import { workflowDetails, workflowHistory } from "./native-workflow-history.ts";
import { ContractError } from "./service-contract.ts";
import { diagnosticText } from "./verification-diagnostics.ts";

/** One transient raw Enter occurrence, not an approval or model-callable control. */
export class TerminalEntryLatch {
  constructor(private readonly command = "cadence") {}
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
    if (new RegExp(`^/${this.command}(?:[ \\t]+[^\\r\\n]*)?$`).test(editor))
      this.entry = { text: editor, at: now };
  }
  consume(args: string, now = Date.now()): boolean {
    const entry = this.entry;
    this.clear();
    return (
      !!entry &&
      now - entry.at >= 0 &&
      now - entry.at < 1500 &&
      entry.text.replace(new RegExp(`^/${this.command}[ \\t]*`), "") === args
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

export function registerHistoryShell(pi: ExtensionAPI): void {
  const latch = new TerminalEntryLatch("cadence-history"),
    connection = new NativeConnection();
  let epoch = 0,
    modal = false;
  let unsubscribe: (() => void) | undefined, dismiss: (() => void) | undefined;
  let abort = new AbortController();
  const depart = () => {
    epoch++;
    latch.clear();
    abort.abort();
    dismiss?.();
    // Detach original attachment, not service jobs/provider/auth. Shutdown does
    // not wait for their lifetime. Retained transport blocks uncertain reuse.
    return connection.detach().catch(() => {});
  };
  pi.on("session_start", (_event, ctx) => {
    void depart();
    unsubscribe?.();
    unsubscribe = undefined;
    if (ctx.mode === "tui")
      unsubscribe = ctx.ui.onTerminalInput((data) => {
        latch.input(data, ctx.ui.getEditorText(), !modal && eligible(ctx));
        return undefined;
      });
  });
  pi.on("session_shutdown", () => {
    const leaving = depart();
    unsubscribe?.();
    unsubscribe = undefined;
    return departure(leaving);
  });
  const leave = () => void depart();
  pi.on("session_before_switch", leave);
  pi.on("session_before_fork", leave);
  pi.on("session_before_tree", leave);
  pi.on("session_before_compact", leave);
  pi.on("model_select", leave);
  // Only local dialog input is owned. Detached service work never owns Pi's
  // conversation/tool lifetime or silently cancels it.
  pi.on("input", () => (modal ? { action: "handled" as const } : undefined));
  pi.on("tool_call", () =>
    modal
      ? {
          block: true,
          reason:
            "Cadence native dialog is active; Return detaches accepted work",
        }
      : undefined,
  );
  pi.on("user_bash", () =>
    modal
      ? {
          result: {
            output: "Cadence native dialog is active",
            exitCode: 1,
            cancelled: true,
            truncated: false,
          },
        }
      : undefined,
  );

  pi.registerCommand("cadence-history", {
    description:
      "Readonly run details and retained history/search/export; never starts a service or work",
    handler: async (args, ctx) => {
      if (
        !latch.consume(args) ||
        modal ||
        !eligible(ctx) ||
        process.env.CADENCE_SUBAGENT_CHILD === "1"
      )
        return;
      modal = true;
      const generation = epoch,
        sessionId = ctx.sessionManager.getSessionId(),
        cwd = ctx.cwd;
      const hostModel = JSON.stringify(ctx.model),
        thinking = ctx.thinkingLevel;
      abort = new AbortController();
      const signal = abort.signal;
      const current = () => {
        if (
          epoch !== generation ||
          signal.aborted ||
          !eligible(ctx) ||
          ctx.cwd !== cwd ||
          ctx.sessionManager.getSessionId() !== sessionId ||
          JSON.stringify(ctx.model) !== hostModel ||
          ctx.thinkingLevel !== thinking
        )
          throw new ContractError("stale");
      };
      const show = async (text: string) => {
        current();
        // Server data already has bounded pages. Sanitize, but never clip a
        // retained page/graph into a purported full view (old 256KiB cap removed).
        const clean = diagnosticText(text, Number.MAX_SAFE_INTEGER);
        await ctx.ui.custom<void>((tui, _theme, _keys, done) => {
          let offset = 0,
            rows: string[] = [],
            wrapped: number | undefined;
          const close = () => done();
          dismiss = close;
          return {
            render(width) {
              // Wrap the whole text once per width; paging only moves the window.
              const columns = Math.max(1, width);
              if (columns !== wrapped) {
                rows = clean
                  .split("\n")
                  .flatMap((line) => wrapTextWithAnsi(line, columns));
                wrapped = columns;
              }
              const height = Math.max(1, Math.min(24, tui.terminal.rows - 4));
              offset = Math.max(
                0,
                Math.min(offset, Math.max(0, rows.length - height)),
              );
              return [
                truncateToWidth(
                  `Cadence history • ${offset + 1}/${rows.length} • ↑↓ PgUp/PgDn Home/End • Esc return`,
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
              if (dismiss === close) dismiss = undefined;
            },
          };
        });
        current();
      };
      const ui: NativeViews = {
        signal,
        current,
        show,
        async select(title, choices) {
          let page = 0;
          for (;;) {
            current();
            const paged = choices.length > 16;
            const available = paged
              ? choices.slice(page * 10, page * 10 + 10)
              : choices;
            let labels = available.map((c) =>
              diagnosticText(c, Number.MAX_SAFE_INTEGER),
            );
            // Sanitization is presentation, not identity. Distinct choices can
            // redact to identical text; never select the first by accident.
            if (
              new Set(labels).size !== labels.length ||
              labels.some((label) =>
                ["Next options page", "Previous options page"].includes(label),
              )
            )
              labels = labels.map(
                (label, i) => `${page * 10 + i + 1}. ${label}`,
              );
            const next = paged && (page + 1) * 10 < choices.length;
            const r = await ctx.ui.select(
              diagnosticText(
                `${title}${paged ? ` • options page ${page + 1}` : ""}`,
                Number.MAX_SAFE_INTEGER,
              ),
              [
                ...labels,
                ...(next ? ["Next options page"] : []),
                ...(page ? ["Previous options page"] : []),
              ],
              { signal },
            );
            current();
            if (r === "Next options page") {
              page++;
              continue;
            }
            if (r === "Previous options page") {
              page--;
              continue;
            }
            return r === undefined ? undefined : available[labels.indexOf(r)];
          }
        },
        async input(title, prefill) {
          current();
          const r = await ctx.ui.input(title, prefill, { signal });
          current();
          return r;
        },
        async confirm(title, text) {
          current();
          const r = await ctx.ui.confirm(
            title,
            diagnosticText(text, Number.MAX_SAFE_INTEGER),
            { signal },
          );
          current();
          return r;
        },
        notify(text) {
          ctx.ui.notify(diagnosticText(text, Number.MAX_SAFE_INTEGER), "info");
        },
      };
      let attached = false;
      try {
        const client = await connection.attach(cwd);
        current();
        attached = true;
        const session = connection.session;
        if (!session) throw new ContractError("unavailable");
        if (!connection.compatible()) ui.notify(MANAGEMENT_GUIDANCE);
        const workspace = value(await client.workspace(signal));
        current();
        if (
          workspace.storeId !== session.storeId ||
          workspace.epoch !== session.epoch
        )
          throw new ContractError("stale");
        const history = new NativeHistory(client, session.storeId, ui);
        if (args.trim()) await workflowDetails(client, ui, args.trim());
        else
          for (;;) {
            const menu = await ui.select(
              "Cadence history • readonly; Return detaches, never cancels",
              [
                "Workflow runs",
                "Retained task history",
                "Enter workflow ID",
                "Command receipt",
                "Service status / guidance",
                "Return",
              ],
            );
            if (!menu || menu === "Return") break;
            if (menu === "Workflow runs") await workflowHistory(client, ui);
            else if (menu === "Retained task history") {
              const id = await history.pages(
                "tasks",
                { kind: "workspace", id: workspace.workspaceId },
                null,
                true,
              );
              if (id) await history.scope({ kind: "task", id });
            } else if (menu === "Enter workflow ID") {
              const id = await ui.input("Exact workflow UUID");
              if (id) await workflowDetails(client, ui, id);
            } else if (menu === "Command receipt") {
              const id = await ui.input(
                "Exact command UUID (observation only; never replay)",
              );
              if (id) await show(pretty(await client.receipt(id, signal)));
            } else if (menu === "Service status / guidance") {
              await show(
                `${MANAGEMENT_GUIDANCE}\n${pretty(await connection.refresh())}\n${pretty(await client.activeRuns(signal))}\nRecovery is explicit native-local management; no locks are cleared here.`,
              );
            }
          }
      } catch (error) {
        ctx.ui.notify(
          `${error instanceof ContractError ? error.code : "unavailable"}: History observation unavailable. Nothing was started, retried or repaired.\n${attached ? "Reopen /cadence-history for a fresh observation. Accepted work may continue." : `${MANAGEMENT_GUIDANCE}${autostartHint()}`}`,
          "error",
        );
      } finally {
        latch.clear();
        abort.abort();
        dismiss?.();
        try {
          await connection.detach();
        } catch {
          ctx.ui.notify(
            "Detach unconfirmed; exact attachment retained. Accepted work may continue.",
            "warning",
          );
        }
        modal = false;
        ctx.ui.notify(
          "History detached. Accepted work continues; no Cancel was requested.",
          "info",
        );
      }
    },
  });
}
