/* A conversation's sidebar row, adapted from pi-web-ui
 * web/src/components/LeftPanel.tsx @ b627452c: the row that becomes a field
 * while it is renamed (RowMain and the rename input). MIT (c) 2026 xing-shuyin.
 * Cadence: rename and archive are owner commands requested once and observed.
 * Nothing is shown as changed until a list read shows it; no context menu,
 * drag ordering, delete or optimistic title. */
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  FiArchive,
  FiArrowLeft,
  FiCheck,
  FiEdit2,
  FiMessageSquare,
  FiRotateCcw,
  FiTerminal,
  FiX,
} from "react-icons/fi";
import {
  type ChatSummary,
  CONVERSATION_NAME_CHARS,
} from "../../../../src/service/contracts/workbench.ts";
import type { ServiceClient } from "../../../../src/service-client.ts";
import {
  archiveCommand,
  type ConversationCommand,
  type ConversationOutcome,
  conversationCommand,
  conversationName,
  renameCommand,
} from "../../client/conversation-admin";
import type { useConversationHistory } from "../../client/use-conversation-history";
import { describeError, type MessageKey, useT } from "../../i18n/locale";
import { dismissToasts, notify } from "../../layout/toasts";
import { rowTime } from "../../navigation/time-groups";

export type RowAction = "rename" | "archive" | "unarchive";
/** What stays with a row: the request in flight, or an outcome that is not
 * known (which no toast may carry away). */
export interface RowState {
  pending?: RowAction;
  unknown?: { action: RowAction; code: string };
}
const PENDING: Readonly<Record<RowAction, MessageKey>> = {
  rename: "Renaming…",
  archive: "Archiving…",
  unarchive: "Unarchiving…",
};
const REFUSED: Readonly<Record<RowAction, MessageKey>> = {
  rename: "The conversation was not renamed ({code}). Its name is unchanged.",
  archive:
    "The conversation was not archived ({code}). It stays in the history.",
  unarchive: "The conversation was not unarchived ({code}). It stays archived.",
};
const UNKNOWN: Readonly<Record<RowAction, MessageKey>> = {
  rename:
    "Rename outcome is unknown ({code}). The list shows the recorded name when it is read again; nothing is retried.",
  archive:
    "Archive outcome is unknown ({code}). The lists show the recorded state when they are read again; nothing is retried.",
  unarchive:
    "Archive outcome is unknown ({code}). The lists show the recorded state when they are read again; nothing is retried.",
};
const toastKey = (id: string) => `conversation-row:${id}`;

/** What a request's outcome leaves behind. A definite refusal changed nothing:
 * it is a toast and no list is read again. An accepted request leaves nothing
 * with the row, and an unknown outcome stays with it; for both the lists are
 * read again, because only they say what is recorded. */
export function settleRow(
  action: RowAction,
  outcome: ConversationOutcome,
): {
  row?: RowState;
  refusal?: { text: MessageKey; code: string };
  reread: boolean;
} {
  if (outcome.kind === "refused")
    return {
      refusal: { text: REFUSED[action], code: outcome.code },
      reread: false,
    };
  return {
    ...(outcome.kind === "unknown"
      ? { row: { unknown: { action, code: outcome.code } } }
      : {}),
    reread: true,
  };
}

/** Rename and archive requests for the listed conversations, one at a time
 * per conversation. `onChanged` asks for the lists to be read again. */
export function useConversationCommands(
  client: Pick<ServiceClient, "workbenchCommand">,
  onChanged: (id: string) => void,
) {
  const { t } = useT();
  const [states, setStates] = useState<ReadonlyMap<string, RowState>>(
    () => new Map(),
  );
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const request = (action: RowAction, command: ConversationCommand) => {
    const id = command.conversationId;
    if (states.get(id)?.pending) return;
    const set = (state?: RowState) =>
      setStates((previous) => {
        const next = new Map(previous);
        if (state) next.set(id, state);
        else next.delete(id);
        return next;
      });
    dismissToasts(toastKey(id));
    set({ pending: action });
    void conversationCommand(client, command).then((outcome) => {
      if (!alive.current) return;
      const { row, refusal, reread } = settleRow(action, outcome);
      set(row);
      if (refusal)
        notify("error", t(refusal.text, { code: refusal.code }), toastKey(id));
      if (reread) onChanged(id);
    });
  };
  return {
    states,
    rename: (id: string, name: string) =>
      request("rename", renameCommand(id, name)),
    archive: (id: string, archived: boolean) =>
      request(archived ? "archive" : "unarchive", archiveCommand(id, archived)),
  };
}

/** One conversation: its title and last-modified time, a state line only when
 * there is something to say, and its actions. `unavailable` names why the
 * actions cannot be requested now; they are then shown disabled. */
export function ConversationRow({
  chat,
  selected,
  state = "",
  tone = "",
  onOpen,
  row,
  unavailable = "",
  onRename,
  onArchive,
}: {
  chat: ChatSummary;
  selected: boolean;
  /** A live workflow's phase or a reply that is not simply completed. */
  state?: string;
  tone?: string;
  onOpen(): void;
  row?: RowState;
  unavailable?: string;
  /** Absent where the row offers no rename (an archived conversation). */
  onRename?(name: string): void;
  /** Absent where the row offers no actions at all (running work). */
  onArchive?(archived: boolean): void;
}) {
  const { t, locale } = useT();
  const tag = locale === "zh" ? "zh-CN" : "en-GB";
  // Null while the row is not being renamed.
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;
  const field = useRef<HTMLInputElement>(null);
  const renameButton = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    const input = field.current;
    if (!editing || !input) {
      // A rename ended from the keyboard returns focus to where it began.
      if (refocus.current) renameButton.current?.focus({ preventScroll: true });
      refocus.current = false;
      return;
    }
    input.focus({ preventScroll: true });
    input.select();
    // Escape ends only this rename: it must not also reach a phone drawer's
    // own Escape, which listens on an ancestor of this field.
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      refocus.current = true;
      setDraft(null);
    };
    input.addEventListener("keydown", key);
    return () => input.removeEventListener("keydown", key);
  }, [editing]);
  const origin =
    chat.origin === "terminal"
      ? t("Started in the terminal")
      : t("Started in the WebUI");
  const icon = (
    <span
      className="session-icon"
      role="img"
      aria-label={origin}
      title={origin}
    >
      {chat.origin === "terminal" ? (
        <FiTerminal aria-hidden="true" />
      ) : (
        <FiMessageSquare aria-hidden="true" />
      )}
    </span>
  );
  const commit = () => {
    if (draft === null) return;
    const name = conversationName(draft);
    if (name === null) {
      // The browser itself refuses this; the field stays open for a fix.
      notify(
        "error",
        t("A name can have at most {count} characters.", {
          count: CONVERSATION_NAME_CHARS,
        }),
        toastKey(chat.id),
      );
      return;
    }
    refocus.current = true;
    setDraft(null);
    if (name !== chat.title) onRename?.(name);
  };
  const disabled = !!unavailable || !!row?.pending;
  const note = row?.pending
    ? t(PENDING[row.pending])
    : row?.unknown
      ? t(UNKNOWN[row.unknown.action], { code: row.unknown.code })
      : "";
  if (editing)
    return (
      // A form: Enter in the field submits it, never while an IME composes.
      <form
        className="conversation-row renaming"
        onSubmit={(event) => {
          event.preventDefault();
          commit();
        }}
        onBlur={(event) => {
          // Leaving the row keeps the recorded name; only Enter or Save asks.
          if (!event.currentTarget.contains(event.relatedTarget))
            setDraft(null);
        }}
      >
        <div className={`session-item renaming${selected ? " active" : ""}`}>
          {icon}
          <input
            ref={field}
            className="session-rename-input"
            value={draft}
            aria-label={t("Conversation name")}
            placeholder={t("Empty: titled by its first message")}
            onChange={(event) => setDraft(event.target.value)}
          />
        </div>
        <span className="session-actions">
          <button
            type="submit"
            className="session-action"
            title={t("Save name")}
            aria-label={t("Save name")}
          >
            <FiCheck aria-hidden="true" />
          </button>
          <button
            type="button"
            className="session-action"
            title={t("Keep the current name")}
            aria-label={t("Keep the current name")}
            onClick={() => {
              refocus.current = true;
              setDraft(null);
            }}
          >
            <FiX aria-hidden="true" />
          </button>
        </span>
      </form>
    );
  return (
    <div className={`conversation-row${onArchive ? " has-actions" : ""}`}>
      <button
        type="button"
        className={`session-item${selected ? " active" : ""}`}
        aria-current={selected ? "true" : undefined}
        onClick={onOpen}
        title={chat.title}
      >
        {icon}
        <span className="session-info">
          <span className="session-title">{chat.title}</span>
          {state && (
            <span className={`session-sub session-state ${tone}`}>{state}</span>
          )}
        </span>
        {chat.updatedAt > 0 && (
          <time
            className="session-time"
            dateTime={new Date(chat.updatedAt).toISOString()}
            title={new Date(chat.updatedAt).toLocaleString(tag)}
          >
            {rowTime(chat.updatedAt, tag)}
          </time>
        )}
      </button>
      {onArchive && (
        <span className="session-actions">
          {onRename && (
            <button
              ref={renameButton}
              type="button"
              className="session-action"
              disabled={disabled}
              title={unavailable || t("Rename")}
              aria-label={t("Rename {title}", { title: chat.title })}
              onClick={() => setDraft(chat.title)}
            >
              <FiEdit2 aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className="session-action"
            disabled={disabled}
            title={unavailable || t(chat.archived ? "Unarchive" : "Archive")}
            aria-label={t(
              chat.archived ? "Unarchive {title}" : "Archive {title}",
              { title: chat.title },
            )}
            onClick={() => onArchive(!chat.archived)}
          >
            {chat.archived ? (
              <FiRotateCcw aria-hidden="true" />
            ) : (
              <FiArchive aria-hidden="true" />
            )}
          </button>
        </span>
      )}
      {note && (
        <p className="session-note" role={row?.pending ? "status" : "alert"}>
          {note}
        </p>
      )}
    </div>
  );
}

/** The conversations the history leaves out, read only while this is shown.
 * A failed read says so and never reads as an empty list; rows read before it
 * stay in place. */
export function ArchivedList({
  list,
  unavailable,
  onBack,
  row,
}: {
  list: ReturnType<typeof useConversationHistory>;
  /** Why Unarchive cannot be requested now; empty when it can. */
  unavailable: string;
  onBack(): void;
  row(chat: ChatSummary): ReactNode;
}) {
  const { t } = useT();
  const rows = list.value?.entries ?? [];
  return (
    <nav aria-label={t("Archived conversations")} className="task-list">
      <button type="button" className="ghost lp-back" onClick={onBack}>
        <FiArrowLeft aria-hidden="true" />
        {t("Back to history")}
      </button>
      <p className="panel-hint">
        {t(
          "Archiving only leaves a conversation out of the history. Its session file is not moved or deleted.",
        )}
      </p>
      {unavailable && rows.length > 0 && (
        <p className="panel-hint lp-actions-hint">{unavailable}</p>
      )}
      {list.error && (
        <p role="alert" className="panel-hint">
          {t(
            "Archived conversations could not be read. This is not an empty list.",
          )}{" "}
          {describeError(t, list.error)}
        </p>
      )}
      {list.loading && (
        <p className="panel-hint" role="status">
          {t("Reading archived conversations…")}
        </p>
      )}
      {rows.map(row)}
      {list.value && !list.error && rows.length === 0 && (
        <p className="panel-hint">{t("No archived conversations.")}</p>
      )}
      {list.canPrevious && (
        <button type="button" onClick={list.previous}>
          {t("Newer conversations")}
        </button>
      )}
      {list.value?.next && (
        <button type="button" onClick={list.next}>
          {t("Older conversations")}
        </button>
      )}
      {list.error && (
        <button type="button" onClick={list.refresh}>
          {t("Observe current state")}
        </button>
      )}
    </nav>
  );
}
