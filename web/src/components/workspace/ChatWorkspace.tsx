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
  type ChatTurn,
  decodeWorkbenchCommand,
  type WorkbenchCommand,
} from "../../../../src/service/contracts/workbench.ts";
import type { ServiceClient } from "../../../../src/service-client.ts";
import { cadenceInput, useWorkbench } from "../../client/use-workbench";
import { useT } from "../../i18n/locale";
import { Markdown } from "../rich/Markdown";
import { StreamMarkdown } from "../rich/StreamMarkdown";
import { ChatSteps, LEGACY_OMITTED_NOTICE, turnParts } from "./ChatSteps";
import { ChatWelcome } from "./ChatWelcome";

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
  onCadence,
  onModel,
  onChanged,
  reference,
  onReferenceUsed,
  initialMode = "chat",
  taskPending = false,
}: {
  client: ServiceClient;
  id: string;
  workspaceId: string;
  enabled: boolean;
  available?: boolean;
  canInterrupt?: boolean;
  onCadence(goal: string): Promise<boolean>;
  initialMode?: "chat" | "cadence";
  taskPending?: boolean;
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
  const input = cadenceInput(draft, mode);
  const summary = view?.summary;
  const running =
    summary && (summary.status === "queued" || summary.status === "running");
  const blocked = !!summary && summary.status !== "completed" && !running;
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
    if (pending && view?.turns.some((turn) => turn.id === pending)) {
      setPending("");
      setDraft((value) => (value === sentDraft.current ? "" : value));
      onChanged();
    }
    if (stick.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [view, pending, onChanged]);
  const send = async () => {
    if (
      busy ||
      taskPending ||
      taskSending.current ||
      running ||
      pending ||
      !enabled ||
      !view ||
      page.error ||
      !input.text.trim()
    )
      return;
    if (input.mode === "cadence") {
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
    if (blocked || before !== null) return;
    setBusy(true);
    setError("");
    try {
      const catalog = await client.models();
      if (!alive.current) return;
      if (catalog.kind !== "ok" || !catalog.value.selected) {
        onModel();
        return;
      }
      const command: WorkbenchCommand = {
        kind: "send",
        commandId: crypto.randomUUID(),
        conversationId: id,
        head: summary?.head ?? null,
        text: input.text,
        model: catalog.value.version,
      };
      decodeWorkbenchCommand(command); // Refuse invalid/oversize text before any pending-send state.
      sentDraft.current = draft;
      setPending(command.commandId);
      const reply = await client.workbenchCommand(command);
      if (!alive.current) return;
      if (reply.kind === "error") {
        setError(
          `${reply.error.code}. ${t("Observe this send before sending again. No automatic retry.")}`,
        );
        // Even a lost reply can have accepted work. Observe this exact turn ID.
      } else {
        setDraft((value) => (value === sentDraft.current ? "" : value));
        setPending("");
      }
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
    <section className="chat-workspace" aria-label={t("Ordinary conversation")}>
      <header className="conversation-header">
        <div className="conversation-heading">
          <FiMessageSquare aria-hidden="true" />
          <h2>{summary?.title ?? t("New conversation")}</h2>
          <span className="conversation-badge">{t("Ordinary")}</span>
        </div>
        {summary && (
          <span className={`ep-state ${summary.status}`}>
            {tx(summary.status)}
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
        {(error || page.error) && (
          <p role="alert" className="banner-notice">
            {error || page.error}
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
        {blocked && (
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
          disabled={!enabled || busy || taskPending || !!pending}
          aria-label={t("Message")}
          value={draft}
          placeholder={t("Message, or /cadence followed by a task…")}
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
            value={input.mode}
            onChange={(event) => {
              const selected =
                event.target.value === "cadence" ? "cadence" : "chat";
              setMode(selected);
              if (
                selected === "chat" &&
                cadenceInput(draft, "chat").mode === "cadence"
              )
                setDraft(input.text);
            }}
          >
            <option value="chat">{t("Ordinary conversation")}</option>
            <option value="cadence">{t("Cadence task")}</option>
          </select>
          <button type="button" className="ghost" onClick={onModel}>
            <FiCpu />
            {t("Model")}
          </button>
          <span className="composer-hint">
            {input.mode === "cadence"
              ? t(
                  "Send to begin analysis. You will confirm the plan before any edits.",
                )
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
                !enabled ||
                !view ||
                !!page.error ||
                busy ||
                taskPending ||
                !!pending ||
                !input.text.trim() ||
                (input.mode === "chat" && (blocked || before !== null))
              }
            >
              <FiArrowUp />
              {taskPending
                ? t("Analyzing task…")
                : input.mode === "cadence"
                  ? t("Prepare task")
                  : t("Send")}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
export function ChatTurnView({ turn }: { turn: ChatTurn }) {
  const { t, tx } = useT();
  const { steps, answer } = turnParts(turn.items);
  const live = turn.status === "running" && answer.length === 0;
  const grouped =
    steps.length > 0 || live || Object.values(turn.omitted).some(Boolean);
  const notice = turn.notice
    .split("\n")
    .filter((line) => line && line !== LEGACY_OMITTED_NOTICE);
  return (
    <section className="chat-turn" aria-label={t("Conversation turn")}>
      {turn.items
        .filter((item) => item.role === "user")
        .map((item) => (
          <article className="chat-message user" key={item.id}>
            <div className="chat-message-role">{t("You")}</div>
            <Markdown text={item.text} />
          </article>
        ))}
      {(grouped || answer.length > 0) && (
        <article className="chat-message assistant">
          <div className="chat-message-role">Cadence</div>
          {grouped && (
            <ChatSteps
              turn={turn}
              steps={steps}
              live={live}
              answered={answer.length > 0}
            />
          )}
          {answer.map((item) =>
            turn.status === "running" ? (
              <StreamMarkdown key={item.id} text={item.text} />
            ) : (
              <Markdown key={item.id} text={item.text} />
            ),
          )}
        </article>
      )}
      {notice.length > 0 && (
        <p className="inspector-note chat-turn-notice">
          {notice.map((line) => tx(line)).join("\n")}
        </p>
      )}
      {!["completed", "running", "queued"].includes(turn.status) && (
        <p className={`ep-state ${turn.status}`}>{tx(turn.status)}</p>
      )}
    </section>
  );
}
export type { ChatSummary };
