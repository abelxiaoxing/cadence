/* Adapted from pi-web-ui ChatInput/MessageList: bottom composer, streaming
 * transcript, folded tools and per-conversation drafts. MIT (c) 2026 xing-shuyin.
 * No upstream prompt, dispatch tool, queue, plugin or subagent runtime. */
import { useEffect, useRef, useState } from "react";
import {
  FiArrowDown,
  FiArrowUp,
  FiCpu,
  FiMessageSquare,
  FiSquare,
} from "react-icons/fi";
import {
  type ChatSummary,
  decodeWorkbenchCommand,
  type WorkbenchCommand,
} from "../../../../src/service/contracts/workbench.ts";
import type { ServiceClient } from "../../../../src/service-client.ts";
import { cadenceInput, useWorkbench } from "../../client/use-workbench";
import {
  approveWorkflow,
  cadenceApproval,
  cadenceExit,
} from "../../client/workflow-entry";
import { useT } from "../../i18n/locale";
import { ChatTurnView } from "./ChatTurnView";
import { ChatWelcome } from "./ChatWelcome";
import { WorkflowPanel } from "./WorkflowPanel";

function stored(key: string) {
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
export function ChatWorkspace({
  client,
  id,
  workspaceId,
  enabled,
  available = enabled,
  canInterrupt = enabled,
  cadenceEnabled = enabled,
  onCadence,
  onModel,
  onChanged,
  reference,
  onReferenceUsed,
  initialMode = "chat",
  taskPending = false,
  legacyTask = false,
  onModeChanged,
}: {
  client: ServiceClient;
  id: string;
  workspaceId: string;
  enabled: boolean;
  available?: boolean;
  canInterrupt?: boolean;
  cadenceEnabled?: boolean;
  onCadence(goal: string): Promise<boolean>;
  initialMode?: "chat" | "cadence";
  taskPending?: boolean;
  legacyTask?: boolean;
  onModeChanged?(): void;
  onModel(): void;
  onChanged(): void;
  reference?: string;
  onReferenceUsed(): void;
}) {
  const { t, tx } = useT();
  const draftKey = `cadence:draft:${workspaceId}:${id}`;
  const [draft, setDraft] = useState(() => stored(draftKey));
  const [mode, setMode] = useState<"chat" | "cadence">(() =>
    stored(`${draftKey}:mode`) === "cadence" ? "cadence" : initialMode,
  );
  const [before, setBefore] = useState<string | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [pending, setPending] = useState(() => stored(`${draftKey}:pending`));
  const page = useWorkbench(
    client,
    available ? { kind: "conversation", id, before } : null,
    1000,
  );
  const view = page.value?.kind === "conversation" ? page.value : undefined;
  const workflow = useWorkbench(
    client,
    available ? { kind: "cadence-conversation", id } : null,
    1000,
  );
  const state =
    workflow.value?.kind === "cadence-conversation"
      ? workflow.value.state
      : undefined;
  const cadence = state?.enabled === true;
  const latestState = useRef(state);
  latestState.current = state;
  const [approvalPending, setApprovalPending] = useState(() =>
    stored(`${draftKey}:approval`),
  );
  const input = cadenceInput(draft, cadence || legacyTask ? "cadence" : mode);
  const legacy =
    legacyTask && !cadence && cadenceInput(draft, "chat").mode !== "cadence";
  const canSend =
    enabled &&
    !!view &&
    !page.error &&
    !!state &&
    !workflow.error &&
    !busy &&
    !taskPending &&
    !pending &&
    (legacy ? cadenceEnabled : true);
  const summary = view?.summary;
  const running =
    summary && (summary.status === "queued" || summary.status === "running");
  const blocked = !!summary && summary.status !== "completed" && !running;
  const canExit =
    canInterrupt &&
    !!view &&
    !!state &&
    !page.error &&
    !workflow.error &&
    !busy &&
    !taskPending &&
    !pending &&
    !running;
  const textarea = useRef<HTMLTextAreaElement>(null),
    scroll = useRef<HTMLDivElement>(null);
  const stick = useRef(true),
    [away, setAway] = useState(false);
  const alive = useRef(true);
  const taskSending = useRef(false);
  const observedHead = useRef("");
  const sentDraft = useRef(draft);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(`${draftKey}:mode`, mode);
    } catch {
      /* local preference only */
    }
  }, [draftKey, mode]);
  useEffect(() => {
    try {
      sessionStorage.setItem(draftKey, draft);
    } catch {
      /* draft still usable in memory */
    }
  }, [draft, draftKey]);
  useEffect(() => {
    try {
      if (pending) sessionStorage.setItem(`${draftKey}:pending`, pending);
      else sessionStorage.removeItem(`${draftKey}:pending`);
    } catch {
      /* no automatic replay */
    }
  }, [draftKey, pending]);
  useEffect(() => {
    if (reference) {
      setDraft((previous) => `${previous}${previous ? "\n" : ""}@${reference}`);
      onReferenceUsed();
      textarea.current?.focus();
    }
  }, [reference, onReferenceUsed]);
  useEffect(() => {
    const signature = view?.summary
      ? `${view.summary.head}:${view.summary.status}`
      : "";
    if (signature && observedHead.current !== signature) {
      observedHead.current = signature;
      onChanged();
    }
    if (approvalPending && state?.runs.includes(approvalPending))
      setApprovalPending("");
    if (pending && view?.turns.some((turn) => turn.id === pending)) {
      setPending("");
      setDraft((value) => (value === sentDraft.current ? "" : value));
      onChanged();
    }
    if (stick.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [view, pending, onChanged, approvalPending, state]);
  useEffect(() => {
    try {
      if (approvalPending)
        sessionStorage.setItem(`${draftKey}:approval`, approvalPending);
      else sessionStorage.removeItem(`${draftKey}:approval`);
    } catch {
      /* retained server identity is authoritative */
    }
  }, [approvalPending, draftKey]);
  const approve = async () => {
    if (!state?.proposal || !canSend || running || approvalPending) return;
    const observed = state;
    setBusy(true);
    setError("");
    try {
      const reply = await approveWorkflow({
        client,
        state: observed,
        current: () =>
          alive.current &&
          latestState.current?.revision === observed.revision &&
          latestState.current?.enabled === true,
        submitting: (commandId) => {
          setApprovalPending(commandId);
          try {
            sessionStorage.setItem(`${draftKey}:approval`, commandId);
          } catch {
            /* never replay */
          }
        },
      });
      if (!alive.current) return;
      if (reply.kind === "error") {
        setError(reply.error.code);
        if (reply.error.effect === "none") setApprovalPending("");
      } else setDraft((value) => (cadenceApproval(value) ? "" : value));
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "unavailable");
    } finally {
      if (alive.current) {
        setBusy(false);
        workflow.refresh();
        page.refresh();
        onChanged();
      }
    }
  };
  const send = async (override?: string) => {
    const message = override ?? draft;
    const exiting = cadence && cadenceExit(message);
    if (
      !(exiting ? canExit : canSend) ||
      running ||
      taskSending.current ||
      !message.trim() ||
      before !== null
    )
      return;
    if (!override && cadence && cadenceApproval(message)) {
      await approve();
      return;
    }
    if (legacy && !override) {
      taskSending.current = true;
      setBusy(true);
      try {
        if (await onCadence(input.text.trim())) {
          try {
            sessionStorage.removeItem(draftKey);
          } catch {
            // Storage availability cannot change an accepted task's outcome.
          }
          if (alive.current) setDraft("");
        }
      } catch {
        if (alive.current)
          setError(
            t(
              "Task preparation unavailable. Observe the original receipt before sending again.",
            ),
          );
      } finally {
        taskSending.current = false;
        if (alive.current) setBusy(false);
      }
      return;
    }
    if (blocked && (!cadence || summary?.status === "unknown")) return;
    setBusy(true);
    setError("");
    try {
      if (cadence && cadenceExit(message) && state) {
        const commandId = crypto.randomUUID();
        sentDraft.current = message;
        setPending(commandId);
        const reply = await client.workbenchCommand({
          kind: "cadence-exit",
          commandId,
          conversationId: id,
          head: summary?.head ?? null,
          revision: state.revision,
        });
        if (!alive.current) return;
        if (reply.kind === "error") {
          setError(reply.error.code);
          if (reply.error.effect === "none") setPending("");
        } else {
          setPending("");
          setMode("chat");
          onModeChanged?.();
          setDraft((value) => (value === message ? "" : value));
        }
        workflow.refresh();
        page.refresh();
        onChanged();
        return;
      }
      let catalog = await client.models();
      if (!alive.current) return;
      if (catalog.kind === "ok" && !catalog.value.selected) {
        const restored = await client.workbenchCommand({
          kind: "restore-model",
          commandId: crypto.randomUUID(),
          epoch: catalog.value.version.epoch,
        });
        if (!alive.current) return;
        if (restored.kind === "error") {
          setError(restored.error.code);
          onModel();
          return;
        }
        catalog = await client.models();
      }
      if (catalog.kind !== "ok" || !catalog.value.selected || !state) {
        onModel();
        return;
      }
      const selecting = cadenceInput(message, mode).mode === "cadence";
      const common = {
        commandId: crypto.randomUUID(),
        conversationId: id,
        head: summary?.head ?? null,
        text: message,
        model: catalog.value.version,
      };
      const command: WorkbenchCommand =
        cadence || selecting
          ? {
              kind: "cadence-send",
              ...common,
              revision: state.revision,
              intent: cadenceExit(message)
                ? "exit"
                : cadence
                  ? "message"
                  : "enter",
            }
          : { kind: "send", ...common };
      decodeWorkbenchCommand(command); // Refuse invalid/oversize text before any pending-send state.
      sentDraft.current = message;
      setPending(command.commandId);
      const reply = await client.workbenchCommand(command);
      if (!alive.current) return;
      if (reply.kind === "error") {
        setError(
          `${reply.error.code}. ${t("Observe this send before sending again. No automatic retry.")}`,
        );
        if (reply.error.effect === "none") setPending("");
        // Even a lost reply can have accepted work. Observe this exact turn ID.
      } else {
        setDraft((value) => (value === sentDraft.current ? "" : value));
        setPending("");
        if (command.kind === "cadence-send") {
          setMode("chat");
          onModeChanged?.();
        }
      }
      workflow.refresh();
      page.refresh();
      onChanged();
    } catch {
      if (alive.current)
        setError(
          t(
            "Send unavailable. Check the message limit (16 KiB); observe any pending command before sending again.",
          ),
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const interrupt = async () => {
    const turn = view?.turns.find((row) => row.id === summary?.head);
    if (!turn || busy) return;
    setBusy(true);
    const result = await client.workbenchCommand({
      kind: "interrupt",
      commandId: crypto.randomUUID(),
      conversationId: id,
      turnId: turn.id,
      epoch: turn.epoch,
    });
    if (!alive.current) return;
    if (result.kind === "error") setError(result.error.code);
    setBusy(false);
    page.refresh();
  };
  return (
    <section
      className="chat-workspace"
      aria-label={
        cadence ? t("Cadence conversation") : t("Ordinary conversation")
      }
    >
      <header className="conversation-header">
        <div className="conversation-heading">
          <FiMessageSquare aria-hidden="true" />
          <h2>{summary?.title ?? t("New conversation")}</h2>
          <span className="conversation-badge">
            {cadence
              ? t("Cadence on")
              : legacy
                ? t("Legacy task")
                : t("Ordinary")}
          </span>
          {cadence && (
            <button
              type="button"
              className="ghost"
              disabled={!canExit}
              onClick={() => void send("exit cadence")}
            >
              {t("Exit Cadence")}
            </button>
          )}
        </div>
        {summary && (
          <span className={`ep-state ${summary.status}`}>
            {cadence
              ? running
                ? t("Discussing")
                : state?.proposal
                  ? t("Awaiting plan approval")
                  : t("Ready for conversation")
              : tx(summary.status)}
          </span>
        )}
      </header>
      <div
        className="chat-messages"
        ref={scroll}
        onScroll={() => {
          const el = scroll.current;
          if (el) {
            stick.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            setAway(!stick.current);
          }
        }}
      >
        {!summary && <ChatWelcome />}
        {view?.before && (
          <button
            type="button"
            className="ghost"
            onClick={() => {
              stick.current = false;
              setBefore(view.before);
            }}
          >
            {t("Earlier messages")}
          </button>
        )}
        {before && (
          <button
            type="button"
            className="ghost"
            onClick={() => {
              stick.current = true;
              setBefore(null);
            }}
          >
            {t("Latest messages")}
          </button>
        )}
        {view?.turns.map((turn) => (
          <ChatTurnView key={turn.id} turn={turn} />
        ))}
        {state && (
          <WorkflowPanel
            client={client}
            state={state}
            pending={approvalPending}
            canApprove={
              canSend && !running && !approvalPending && before === null
            }
            onApprove={() => void approve()}
            onChanged={() => {
              workflow.refresh();
              onChanged();
            }}
          />
        )}
        {(error || page.error || workflow.error) && (
          <p role="alert" className="banner-notice">
            {error || page.error || workflow.error}
          </p>
        )}
        {pending && (
          <p className="inspector-note">
            {t("Send outcome not yet observed:")} <code>{pending}</code>{" "}
            <button type="button" onClick={page.refresh}>
              {t("Observe current state")}
            </button>
          </p>
        )}
        {blocked && !cadence && (
          <p className="inspector-note">
            {t(
              "This turn has no complete continuation context. Start a new conversation; retained messages are preserved.",
            )}
          </p>
        )}
      </div>
      {away && (
        <button
          type="button"
          className="chat-scroll-bottom"
          aria-label={t("Latest messages")}
          onClick={() => {
            if (scroll.current)
              scroll.current.scrollTop = scroll.current.scrollHeight;
            stick.current = true;
          }}
        >
          <FiArrowDown />
        </button>
      )}
      <form
        className="chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <textarea
          ref={textarea}
          disabled={
            (!enabled && !(cadence && canInterrupt)) ||
            !view ||
            !state ||
            !!page.error ||
            !!workflow.error ||
            busy ||
            taskPending ||
            !!pending
          }
          aria-label={t("Message")}
          value={draft}
          placeholder={t(
            "Message, or /cadence to enter continuous Cadence mode…",
          )}
          rows={3}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <div className="composer-toolbar">
          <select
            aria-label={t("Conversation mode")}
            value={cadence ? "cadence" : input.mode}
            disabled={cadence || running || busy}
            onChange={(event) => {
              const selected =
                event.target.value === "cadence" ? "cadence" : "chat";
              setMode(selected);
              if (selected === "chat") onModeChanged?.();
              if (
                selected === "chat" &&
                cadenceInput(draft, "chat").mode === "cadence"
              )
                setDraft(input.text);
            }}
          >
            <option value="chat">{t("Ordinary conversation")}</option>
            <option value="cadence">
              {legacy ? t("Legacy task") : t("Cadence on Send")}
            </option>
          </select>
          <button type="button" className="ghost" onClick={onModel}>
            <FiCpu />
            {t("Model")}
          </button>
          <span className="composer-hint">
            {input.mode === "cadence"
              ? t("Cadence stays on. Confirm one plan before implementation.")
              : t("Direct host tools · no Cadence task")}
          </span>
          {running ? (
            <button
              type="button"
              className="danger"
              disabled={busy || !canInterrupt}
              onClick={() => void interrupt()}
            >
              <FiSquare />
              {t("Stop response")}
            </button>
          ) : (
            <button
              type="submit"
              className="primary"
              disabled={
                !(cadence && cadenceExit(draft) ? canExit : canSend) ||
                !draft.trim() ||
                (blocked && (!cadence || summary?.status === "unknown")) ||
                before !== null
              }
            >
              <FiArrowUp />
              {taskPending
                ? t("Analyzing task…")
                : legacy
                  ? t("Prepare task")
                  : t("Send")}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
export { ChatTurnView } from "./ChatTurnView";
export type { ChatSummary };
