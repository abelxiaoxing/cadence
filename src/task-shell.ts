import { createHash, randomUUID } from "node:crypto";
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
import { proposePlan } from "./plan-proposal.ts";
import { ProjectionTracker } from "./service-client.ts";
import {
  type Action,
  type Assignment,
  type ContextVersion,
  ContractError,
  type CurrentView,
  canonicalJson,
  decodeAction,
  LIMITS,
  parseWireJson,
  type Receipt,
  roleForPurpose,
  type Scope,
} from "./service-contract.ts";
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

export function registerTaskShell(pi: ExtensionAPI): void {
  const latch = new TerminalEntryLatch(),
    connection = new NativeConnection();
  let epoch = 0,
    modal = false;
  let unsubscribe: (() => void) | undefined, dismiss: (() => void) | undefined;
  let abort = new AbortController();
  let selectedTask: string | undefined;
  const commandIds: string[] = [];
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
    selectedTask = undefined;
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

  pi.registerCommand("cadence", {
    description:
      "Native service client: plan, Start, checks, review and retained history; Return detaches",
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
        const roster = value(await client.activeRuns(signal));
        current();
        if (
          roster.storeId !== session.storeId ||
          roster.epoch !== session.epoch
        )
          throw new ContractError("stale");
        const workspaceReply = await client.workspace(signal);
        current();
        const workspace =
          workspaceReply.kind === "ok" ? workspaceReply.value : roster;
        if (
          workspace.storeId !== session.storeId ||
          workspace.epoch !== session.epoch ||
          workspace.workspaceId !== roster.workspaceId
        )
          throw new ContractError("stale");
        if (workspaceReply.kind === "error")
          ui.notify(
            "Workspace observation unavailable; independent active-run Cancel remains available. No action authority inferred.",
          );
        const history = new NativeHistory(client, session.storeId, ui);
        const readCurrent = async (
          taskId: string | null,
        ): Promise<CurrentView> => {
          const view = value(
            await client.current({ storeId: session.storeId, taskId }, signal),
          );
          current();
          if (
            view.epoch !== session.epoch ||
            view.workspaceId !== workspace.workspaceId
          )
            throw new ContractError("stale");
          return view;
        };
        const authority = (view: CurrentView): ContextVersion => {
          if (!connection.compatible() || view.context.status !== "available")
            throw new ContractError("unavailable");
          return view.context.version;
        };
        const fresh = async (expected: ContextVersion) => {
          const observed = authority(
            await readCurrent(expected.task?.id ?? null),
          );
          if (canonicalJson(observed) !== canonicalJson(expected))
            throw new ContractError("stale");
        };
        const observeReceipt = async (id: string) => {
          const result = await client.receipt(id, signal);
          current();
          await show(
            `Command ${id} • receipt observation only; never replay\n${pretty(result)}`,
          );
          return result.status === "found" ? result.receipt : undefined;
        };
        const remember = (id: string) => {
          commandIds.push(id);
          if (commandIds.length > 64) commandIds.shift();
        };
        let observedRun: { taskId: string; runId: string } | undefined;
        const publication = async (
          initial: Receipt,
          stopping = false,
        ): Promise<Receipt> => {
          if (!stopping && (initial.runId || initial.publication !== "pending"))
            return initial;
          return ctx.ui.custom<Receipt>((tui, _theme, _keys, done) => {
            const readAbort = new AbortController();
            let receipt = initial,
              disposed = false,
              busy = false,
              observations = 0;
            const close = () => done(receipt);
            dismiss = close;
            const poll = async () => {
              if (disposed || busy) return;
              busy = true;
              try {
                current();
                const found = await client.receipt(
                  initial.commandId,
                  AbortSignal.any([signal, readAbort.signal]),
                );
                if (disposed) return;
                current();
                observations++;
                if (found.status === "found") receipt = found.receipt;
                tui.requestRender();
                if (
                  (stopping
                    ? receipt.execution !== null
                    : receipt.publication !== "pending") ||
                  observations >= (stopping ? 3 : 10) ||
                  found.status !== "found"
                )
                  close();
              } catch {
                if (!disposed) close();
              } finally {
                busy = false;
              }
            };
            const timer = setInterval(() => void poll(), 1000);
            const bound = setTimeout(
              close,
              stopping ? LIMITS.unconfirmedStopMs : 10000,
            );
            void poll();
            return {
              render(width) {
                return [
                  truncateToWidth(
                    `Cadence command ${initial.commandId}`,
                    width,
                  ),
                  truncateToWidth(
                    `${stopping ? `Cancel settlement ${receipt.execution ?? "unconfirmed/pending"}` : `Publication ${receipt.publication}`} • Esc/Enter returns; no inferred stop`,
                    width,
                  ),
                ];
              },
              invalidate() {},
              handleInput(data) {
                if (matchesKey(data, Key.enter) || matchesKey(data, Key.escape))
                  close();
              },
              dispose() {
                disposed = true;
                clearInterval(timer);
                clearTimeout(bound);
                readAbort.abort();
                if (dismiss === close) dismiss = undefined;
              },
            };
          });
        };
        const submit = async (
          view: CurrentView,
          action: Action,
        ): Promise<Receipt | undefined> => {
          const expected = authority(view);
          await connection.refresh();
          current();
          if (!connection.session?.capabilities.actions)
            throw new ContractError("unavailable");
          await fresh(expected);
          let changesText = "No task selected yet.";
          if (expected.task) {
            const changes = value(
              await client.currentChanges(
                { storeId: session.storeId, taskId: expected.task.id },
                signal,
              ),
            );
            current();
            if (
              changes.context.status !== "available" ||
              canonicalJson(changes.context.version) !== canonicalJson(expected)
            )
              throw new ContractError("stale");
            changesText = `Coverage ${pretty(changes.coverage)}\n${changes.text}`;
          }
          const prepared = value(await client.preflight(expected, action));
          current();
          const preview = prepared.preview;
          await show(
            `Exact action preview (no effects yet)\nReadable plan\n${preview.readablePlan}\n\nCurrent changes, including pre-existing dirt (not attribution)\n${changesText}\n\nComplete action/graph/identity preview\n${pretty(preview)}\n\nDirect tools, not a sandbox. Check PASS, native execution, coverage and human review are independent.\nReturn/quit detaches accepted work; only explicit Cancel requests stop.`,
          );
          const checkText =
            action.kind === "check"
              ? `\nExact shell command:\n${action.check.command}\nTimeout ${action.check.timeoutMs}ms\nEnvironment ${preview.checkEnvironmentPolicy} • generation ${expected.checkEnvGeneration}`
              : "";
          if (
            !(await ui.confirm(
              `Confirm ${action.kind} now?`,
              `${expected.model.provider}/${expected.model.model} • ${expected.model.api} • thinking ${expected.model.thinking}\ncwd: ${JSON.stringify(preview.cwdLabel)}\nTask ${expected.task?.id ?? "new"} revision ${expected.task?.revision ?? "new"}\nIssues: ${preview.issues.join(", ") || "none in bounded preview"}${checkText}\nExpires ${prepared.expiresAt}\nConfirm the complete preview just displayed. Fresh native consent; no automatic retry or Git/install. Generate is advisory only, never Save/Start.`,
            ))
          )
            return;
          await fresh(expected);
          current();
          const commandId = randomUUID();
          remember(commandId);
          const base = { commandId, expected, grant: prepared.grant };
          // No generic sender, retries or changed IDs after an uncertain reply.
          const reply = await (() => {
            switch (action.kind) {
              case "create":
                return client.create({ ...base, action });
              case "save-plan":
                return client.savePlan({ ...base, action });
              case "generate-plan":
                return client.generatePlan({ ...base, action });
              case "start":
                return client.start({ ...base, action });
              case "check":
                return client.check({ ...base, action });
              case "review":
                return client.review({ ...base, action });
            }
          })();
          current();
          if (reply.kind === "error") {
            ui.notify(
              `Command ${commandId}: ${pretty(reply.error)}. Observe this exact receipt; no automatic replay.`,
            );
            return observeReceipt(commandId);
          }
          ui.notify(
            `Command ${commandId}\n${pretty(reply.value)}\nAccepted work survives Return and Pi quit.`,
          );
          const receipt = await publication(reply.value);
          current();
          if (receipt.runId && expected.task)
            observedRun = { taskId: expected.task.id, runId: receipt.runId };
          return receipt;
        };
        const cancel = async () => {
          if (!connection.compatible(true))
            throw new ContractError("unsupported-context");
          const roster = value(await client.activeRuns(signal));
          current();
          if (roster.status !== "complete")
            throw new ContractError("unavailable");
          if (
            roster.epoch !== session.epoch ||
            roster.storeId !== session.storeId
          )
            throw new ContractError("stale");
          const labels = roster.runs.map(
            (r) =>
              `Cancel ${r.runId} • task ${r.taskId} • ${r.kind} / ${r.stage}`,
          );
          const selected = await ui.select(
            "Explicit Cancel • bounded stop, not Return; all active tasks (independent of history page)",
            [...labels, "Return"],
          );
          if (!selected || !labels.includes(selected)) return;
          const run = roster.runs[labels.indexOf(selected)],
            commandId = randomUUID();
          remember(commandId);
          current();
          const reply = await client.cancel({
            commandId,
            epoch: run.epoch,
            runId: run.runId,
          });
          current();
          const observation =
            reply.kind === "ok" ? await publication(reply.value, true) : reply;
          current();
          await show(
            `Explicit Cancel receipt ${commandId}\n${pretty(observation)}\nUnconfirmed/pending/unknown is not stopped; direct-child closure does not prove escaped descendants stopped. No automatic retry.`,
          );
          if (reply.kind === "error") await observeReceipt(commandId);
        };
        const chooseModel = async () => {
          if (!connection.compatible())
            throw new ContractError("unsupported-context");
          const catalog = value(await client.models(signal));
          current();
          const labels = catalog.entries.map(
            (e) =>
              `${e.provider}/${e.model} • ${e.api ?? "unsupported"} • ${e.eligibility}`,
          );
          const selected = await ui.select(
            `Exact OWNER model (Pi conversation model is independent) • ${catalog.status}\nCurrent ${pretty(catalog.selected)}`,
            [...labels, "Return"],
          );
          if (!selected || !labels.includes(selected)) return;
          const model = catalog.entries[labels.indexOf(selected)];
          if (!model.api || model.eligibility !== "candidate")
            throw new ContractError("unsupported-context");
          const level = await ui.select(
            "Exact thinking level • no clamping/fallback",
            model.thinking.filter((t) => t.selectable).map((t) => t.level),
          );
          if (!level || level === "max") return;
          // Decode via the shared model-choice method; never inspect parent auth.
          const choice = {
            provider: model.provider,
            model: model.model,
            api: model.api,
            thinking: level as ContextVersion["model"]["thinking"],
          };
          if (!(await ui.confirm("Select exact owner model?", pretty(choice))))
            return;
          const reply = await client.chooseModel({
            expected: catalog.version,
            choice,
          });
          current();
          await show(
            `Model choice observation (no task run)\n${pretty(reply)}`,
          );
          await connection.refresh();
          current();
        };
        const observe = async (scope: Scope) => {
          await ctx.ui.custom<void>((tui, _theme, _keys, done) => {
            const tracker = new ProjectionTracker(),
              reading = new AbortController();
            let text = "Reading owner…",
              disposed = false,
              busy = false;
            const close = () => done();
            dismiss = close;
            const poll = async () => {
              if (busy || disposed) return;
              busy = true;
              try {
                current();
                const ticket = tracker.beginSnapshot();
                const readSignal = AbortSignal.any([signal, reading.signal]);
                const active = await client.activeRuns(readSignal);
                const reply = await client.snapshot(scope, readSignal);
                if (disposed) return;
                current();
                if (reply.kind === "ok")
                  tracker.install(reply.value, Date.now(), ticket);
                else
                  text = `Observation ${reply.error.code}; no outcome inferred`;
                tracker.tick(Date.now());
                if (reply.kind === "ok") {
                  const state = tracker.state;
                  text = `Connection ${state?.connection ?? "unavailable"} • committed ${reply.value.committedSeq}\n${reply.value.runs.map((r) => `${r.childRunId ? `Child ${r.assignmentId}` : `Parent ${r.admission.kind}`}: ${r.lifecycle} / ${r.outcome ?? "unsettled"} / ${r.publication}\nOwner ${active.kind === "ok" && active.value.status === "complete" ? (active.value.runs.some((a) => a.runId === r.runId) ? "active/draining" : "drained") : "activity unavailable"} • ID ${r.childRunId ?? r.runId}\ncoverage ${pretty(r.coverage)}`).join("\n")}\nFull fields, native facts and all retained pages: History / search / export. This compact live view is not the archive.`;
                }
                tui.requestRender();
              } catch {
                text = "Observation unavailable; accepted work may continue";
              } finally {
                busy = false;
              }
            };
            const timer = setInterval(() => void poll(), LIMITS.heartbeatMs);
            void poll();
            return {
              render(width) {
                return [
                  truncateToWidth(
                    "Cadence owner observation • Esc/Enter return (work continues)",
                    width,
                  ),
                  ...diagnosticText(text, Number.MAX_SAFE_INTEGER)
                    .split("\n")
                    .flatMap((line) =>
                      wrapTextWithAnsi(line, Math.max(1, width)),
                    )
                    .slice(0, Math.max(1, Math.min(24, tui.terminal.rows - 4))),
                ];
              },
              invalidate() {},
              handleInput(data) {
                if (matchesKey(data, Key.enter) || matchesKey(data, Key.escape))
                  done();
              },
              dispose() {
                disposed = true;
                clearInterval(timer);
                reading.abort();
                if (dismiss === close) dismiss = undefined;
              },
            };
          });
          current();
        };
        let taskId = selectedTask;
        for (;;) {
          const menu = await ui.select(
            "Cadence service • old sessions must be stopped • Return/quit detaches; accepted work continues",
            [
              "New",
              "Open / history",
              ...(taskId ? ["Current task"] : []),
              "Model / thinking",
              "Active runs / Cancel",
              "Command receipts",
              "Service status / guidance",
              "Return",
            ],
          );
          if (!menu || menu === "Return") break;
          if (menu === "Model / thinking") {
            await chooseModel();
            continue;
          }
          if (menu === "Active runs / Cancel") {
            await cancel();
            continue;
          }
          if (menu === "Command receipts") {
            const id = await ui.select("Observe exact command ID (no replay)", [
              ...commandIds,
              "Enter command ID",
              "Return",
            ]);
            if (id === "Enter command ID") {
              const entered = await ui.input("Exact command UUID");
              if (entered) await observeReceipt(entered);
            } else if (id && id !== "Return") await observeReceipt(id);
            continue;
          }
          if (menu === "Service status / guidance") {
            await show(
              `${MANAGEMENT_GUIDANCE}\n${pretty(await connection.refresh())}\n${pretty(value(await client.activeRuns(signal)))}\nRecovery is explicit native-local management; this menu never clears locks.`,
            );
            continue;
          }
          if (menu === "New") {
            const view = await readCurrent(null);
            if (view.context.status !== "available") {
              ui.notify(
                "Choose an exact owner Model / thinking first. No task was created.",
              );
              continue;
            }
            const kind = await ui.select("Task kind", [
              "code",
              "research",
              "diagnosis",
            ]);
            if (kind !== "code" && kind !== "research" && kind !== "diagnosis")
              continue;
            const goal = await ctx.ui.editor(
              "Goal (saving does not start work)",
              args,
            );
            current();
            if (!goal?.trim()) continue;
            const receipt = await submit(view, {
              kind: "create",
              taskKind: kind,
              goal,
            });
            if (
              receipt?.admission !== "accepted" ||
              !receipt.created ||
              receipt.created.state !== "published"
            )
              continue;
            taskId = receipt.created.taskId;
          } else if (menu === "Open / history")
            taskId = await history.pages(
              "tasks",
              { kind: "workspace", id: workspace.workspaceId },
              null,
              true,
            );
          if (!taskId) continue;
          selectedTask = taskId;
          for (;;) {
            let view: CurrentView;
            try {
              view = await readCurrent(taskId);
            } catch {
              current();
              const fallback = await ui.select(
                "Current task unavailable; history is not mutation authority",
                ["Active runs / Cancel", "History / search / export", "Return"],
              );
              if (fallback === "Active runs / Cancel") await cancel();
              else if (fallback === "History / search / export")
                await history.scope({ kind: "task", id: taskId });
              else break;
              continue;
            }
            const kind = view.task?.kind;
            const action = await ui.select(
              `${kind ?? "task"} ${taskId} • current v1 revision ${view.task?.revision ?? "unavailable"} • ${view.context.status}`,
              [
                "Plan / assignments",
                "Generate plan (readonly)",
                "Start / Continue",
                "Observe work",
                "Active runs / Cancel",
                ...(kind === "code" ? ["Checks"] : []),
                "Changes / obligations",
                "Review / Done",
                "History / search / export",
                "Return",
              ],
            );
            if (!action || action === "Return") break;
            if (action === "Active runs / Cancel") {
              await cancel();
              continue;
            }
            if (action === "Observe work") {
              await observe(
                observedRun?.taskId === taskId
                  ? { kind: "run", id: observedRun.runId }
                  : { kind: "task", id: taskId },
              );
              continue;
            }
            if (action === "History / search / export") {
              await history.scope({ kind: "task", id: taskId });
              continue;
            }
            if (action === "Changes / obligations") {
              const changes = value(
                await client.currentChanges(
                  { storeId: session.storeId, taskId },
                  signal,
                ),
              );
              current();
              const checks = value(
                await client.checkObligations(taskId, signal),
              );
              current();
              await show(
                `Current changes (not attribution; bounded coverage)\n${pretty(changes)}\n\nConfigured obligations (not identical to recorded checks)\n${pretty(checks)}`,
              );
              continue;
            }
            if (action === "Plan / assignments") {
              const expected = authority(view);
              if (!view.readablePlan?.editable)
                throw new ContractError("unavailable");
              let assignments: Assignment[];
              if (view.savedGraph.status === "saved") {
                const graph = await history.graph(view.savedGraph.request);
                if (!graph) continue;
                assignments = graph.assignments;
              } else {
                const purpose = kind === "code" ? "edit" : kind;
                if (!purpose) throw new ContractError("unavailable");
                const role = view.roles.find(
                  (r) => r.role === roleForPurpose(purpose),
                );
                if (!role) throw new ContractError("unavailable");
                assignments = [
                  {
                    id: "task",
                    purpose,
                    instructions:
                      "Perform the explicitly reviewed task and readable plan; report observations.",
                    expectedOutput: "Result and remaining uncertainty.",
                    role,
                    model: expected.model,
                    dependencies: [],
                  },
                ];
              }
              const plan = await ctx.ui.editor(
                "Readable plan • exact bytes, separate Save and Start",
                view.readablePlan.text,
              );
              current();
              if (plan === undefined) continue;
              for (;;) {
                const edit = await ui.select(
                  "Finite assignments (1–16), all required • default one explicit assignment",
                  [
                    "Preview assignments",
                    "Edit assignments / dependencies JSON",
                    "Save plan",
                    "Apply current exact model to assignments",
                    "Return",
                  ],
                );
                if (edit === "Preview assignments")
                  await show(pretty(assignments));
                else if (edit === "Edit assignments / dependencies JSON") {
                  await show(
                    'Edit the displayed finite assignments. Keep exact owner role hashes/model. Purpose cannot escalate readonly tasks. Dependencies: {"source":{"kind":"current","assignmentId":"predecessor"},"range":null,"requireCompleteObservation":false}. Historical selections must name actual retained run/child/result versions; ranges are UTF-8 bytes. Shared graph validation rejects cycles/missing/duplicate/oversized values. No generated output dispatches itself.',
                  );
                  const raw = await ctx.ui.editor(
                    "Assignments JSON • reviewed dependencies; no execution",
                    pretty(assignments),
                  );
                  current();
                  if (raw !== undefined) {
                    const parsed = parseWireJson(raw, LIMITS.graphBytes);
                    // proposePlan performs the single shared graph/role/model validation.
                    const proposal = await proposePlan(
                      view,
                      plan,
                      parsed as Assignment[],
                      {
                        uuid: randomUUID,
                        sha256: (bytes) =>
                          createHash("sha256").update(bytes).digest("hex"),
                      },
                    );
                    assignments = proposal.graph.assignments;
                  }
                } else if (
                  edit === "Apply current exact model to assignments"
                ) {
                  await fresh(expected);
                  if (
                    await ui.confirm(
                      "Use the current exact owner model for every assignment?",
                      pretty(expected.model),
                    )
                  )
                    assignments = assignments.map((a) => ({
                      ...a,
                      model: expected.model,
                    }));
                } else if (edit === "Save plan") {
                  await fresh(expected);
                  const proposal = await proposePlan(view, plan, assignments, {
                    uuid: randomUUID,
                    sha256: (bytes) =>
                      createHash("sha256").update(bytes).digest("hex"),
                  });
                  current();
                  await submit(view, proposal);
                  break;
                } else break;
              }
            } else if (
              action === "Start / Continue" ||
              action === "Generate plan (readonly)"
            ) {
              if (
                action === "Start / Continue" &&
                kind === "code" &&
                !view.readablePlan?.text.trim()
              ) {
                ui.notify("Write and review a plan first.");
                continue;
              }
              await submit(view, {
                kind: action === "Start / Continue" ? "start" : "generate-plan",
                taskId,
              });
            } else if (action === "Checks") {
              const obligations = value(
                await client.checkObligations(taskId, signal),
              );
              current();
              // Configured names are data, even when named Return or a paging
              // control. Keep a unique displayed index and map back by index.
              const names = obligations.definitions.map(
                (d, i) => `Configured ${i + 1} • ${d.selection.name}`,
              );
              const selected = await ui.select(
                "Parent checks • model prose/tool exit is not PASS",
                [...names, "Manual command", "Return"],
              );
              if (!selected || selected === "Return") continue;
              let check =
                obligations.definitions[names.indexOf(selected)]?.selection;
              if (selected === "Manual command") {
                await connection.refresh();
                current();
                if (!connection.session?.capabilities.manualChecks)
                  throw new ContractError("forbidden");
                const command = await ui.input(
                  "Exact native-local shell command",
                );
                if (!command) continue;
                const decoded = decodeAction({
                  kind: "check",
                  taskId,
                  check: {
                    kind: "manual",
                    name: "Manual",
                    command,
                    timeoutMs: 120000,
                  },
                });
                if (decoded.kind !== "check")
                  throw new ContractError("invalid");
                check = decoded.check;
              }
              if (check) await submit(view, { kind: "check", taskId, check });
            } else if (action === "Review / Done") {
              const changes = value(
                await client.currentChanges(
                  { storeId: session.storeId, taskId },
                  signal,
                ),
              );
              current();
              const checks = value(
                await client.checkObligations(taskId, signal),
              );
              current();
              const snapshot = value(
                await client.snapshot({ kind: "task", id: taskId }, signal),
              );
              current();
              await show(
                `Current changes\n${pretty(changes)}\nConfigured obligations\n${pretty(checks)}\nNative/child results and prior human review are independent\n${pretty(snapshot)}`,
              );
              const runs = snapshot.runs.filter(
                (r) => !r.childRunId && r.admission.kind !== "check",
              );
              const labels = runs.map(
                (r) =>
                  `${r.runId} • ${r.admission.kind} • ${r.lifecycle}/${r.outcome ?? "unsettled"}`,
              );
              const selected = await ui.select(
                "Select exact run for HUMAN review (never execution success)",
                [...labels, "Return"],
              );
              if (!selected || !labels.includes(selected)) continue;
              const acceptIssues = await ui.confirm(
                "Acknowledge unresolved issues?",
                "Failed, unrun, stale, incomplete checks and child/recording issues remain unresolved after human closure. No means only close if the owner finds no issues.",
              );
              await submit(view, {
                kind: "review",
                taskId,
                runId: runs[labels.indexOf(selected)].runId,
                changesIdentity: changes.observation.identity,
                checksRevision: checks.revision,
                acceptIssues,
              });
            }
          }
        }
      } catch (error) {
        ctx.ui.notify(
          `${error instanceof ContractError ? error.code : "unavailable"}: Cadence refused or observation unavailable. No automatic action replay.\n${attached ? "Reopen /cadence for a fresh observation and confirmation. Accepted work may continue. For quarantined/unavailable ownership use cadence-service diagnose --workspace <path>; no locks were cleared." : `${MANAGEMENT_GUIDANCE}${autostartHint()}`}`,
          "error",
        );
      } finally {
        latch.clear(); // no ownership of accepted work
        abort.abort();
        dismiss?.();
        try {
          await connection.detach();
        } catch {
          ctx.ui.notify(
            "Detach unconfirmed; exact attachment retained. Accepted work may continue. Explicit re-entry/management required.",
            "warning",
          );
        }
        modal = false;
        ctx.ui.notify(
          "Cadence detached locally. Accepted service work continues; only explicit Cancel requests stop.",
          "info",
        );
      }
    },
  });
}
