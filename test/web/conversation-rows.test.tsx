// A conversation's rename and archive: the two owner commands, what their
// outcomes leave with a row, and the sidebar markup. Pure and SSR only: no
// pointer, focus or real owner is exercised here.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type {
  ChatSummary,
  WorkbenchCommand,
} from "../../src/service/contracts/workbench.ts";
import { ServiceClient } from "../../src/service-client.ts";
import { publicError } from "../../src/service-contract.ts";
import {
  archiveCommand,
  conversationCommand,
  conversationName,
  renameCommand,
} from "../../web/src/client/conversation-admin";
import type { useConversationHistory } from "../../web/src/client/use-conversation-history";
import {
  ArchivedList,
  ConversationRow,
  settleRow,
} from "../../web/src/components/workspace/ConversationRow";
import { TaskSidebar } from "../../web/src/components/workspace/TaskSidebar";
import { LocaleProvider } from "../../web/src/i18n/locale";
import { id, transport } from "./fixtures";

afterEach(() => vi.useRealTimers());
const chat = (title: string, more: Partial<ChatSummary> = {}): ChatSummary => ({
  id: id(),
  title,
  leaf: "leaf",
  status: "completed",
  updatedAt: new Date(2026, 10, 10, 9, 5).getTime(),
  origin: "webui",
  ...more,
});

it("a typed name is one trimmed line of at most 100 characters; an empty one clears the name", () => {
  expect(conversationName("  Fix the login page \n")).toBe(
    "Fix the login page",
  );
  // A pasted tab or line break is a space, never a second line.
  expect(conversationName("a\tb\r\nc")).toBe("a b c");
  expect(conversationName("   ")).toBe("");
  // Code points, not UTF-16 units: a hundred emoji fit, one more does not.
  expect(conversationName("😀".repeat(100))).toBe("😀".repeat(100));
  expect(conversationName("😀".repeat(101))).toBeNull();
  expect(conversationName("训".repeat(101))).toBeNull();
});
it("each request is one command; only an answer with no effect is a refusal", async () => {
  const sent: WorkbenchCommand[] = [];
  const answer = (reply: (command: WorkbenchCommand) => unknown) =>
    new ServiceClient({
      ...transport(),
      workbenchCommand: async (command: WorkbenchCommand) => {
        sent.push(command);
        return reply(command);
      },
    });
  const session = id();
  const accepted = answer((command) => ({
    kind: "ok",
    value: { kind: "accepted", commandId: command.commandId },
  }));
  expect(
    await conversationCommand(accepted, renameCommand(session, "New name")),
  ).toEqual({ kind: "accepted" });
  expect(
    await conversationCommand(accepted, archiveCommand(session, true)),
  ).toEqual({ kind: "accepted" });
  expect(sent).toMatchObject([
    { kind: "conversation-rename", conversationId: session, name: "New name" },
    { kind: "conversation-archive", conversationId: session, archived: true },
  ]);
  expect(new Set(sent.map((command) => command.commandId)).size).toBe(2);
  const refusal = (effect: "none" | "uncertain") =>
    answer(() => ({ kind: "error", error: publicError("conflict", effect) }));
  expect(
    await conversationCommand(refusal("none"), renameCommand(session, "x")),
  ).toEqual({ kind: "refused", code: "conflict" });
  // An uncertain effect, a lost reply or an answer for another command may
  // have taken effect: never reported as refused, never sent again.
  expect(
    await conversationCommand(
      refusal("uncertain"),
      renameCommand(session, "x"),
    ),
  ).toEqual({ kind: "unknown", code: "conflict" });
  const before = sent.length;
  expect(
    await conversationCommand(
      answer(() => {
        throw new Error("offline");
      }),
      archiveCommand(session, false),
    ),
  ).toEqual({ kind: "unknown", code: "unavailable" });
  expect(sent.length).toBe(before + 1);
  // A shape the client itself refuses reaches no owner.
  const untouched = sent.length;
  expect(
    await conversationCommand(accepted, renameCommand(session, "two\nlines")),
  ).toEqual({ kind: "refused", code: "invalid" });
  expect(sent.length).toBe(untouched);
});
it("a refusal is a toast and reads nothing; an unknown outcome stays with its row until the lists are read again", () => {
  expect(settleRow("rename", { kind: "accepted" })).toEqual({ reread: true });
  expect(settleRow("archive", { kind: "refused", code: "stale" })).toEqual({
    refusal: {
      text: "The conversation was not archived ({code}). It stays in the history.",
      code: "stale",
    },
    reread: false,
  });
  expect(
    settleRow("unarchive", { kind: "unknown", code: "unavailable" }),
  ).toEqual({
    row: { unknown: { action: "unarchive", code: "unavailable" } },
    reread: true,
  });
});
const row = (
  props: Partial<Parameters<typeof ConversationRow>[0]> & {
    chat: ChatSummary;
  },
  locale: "en" | "zh" = "en",
) =>
  renderToStaticMarkup(
    <LocaleProvider initial={locale}>
      <ConversationRow
        selected={false}
        onOpen={() => {}}
        onRename={() => {}}
        onArchive={() => {}}
        {...props}
      />
    </LocaleProvider>,
  );
it("a history row offers rename and archive by name, and shows them disabled with their reason when no owner can take them", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 10, 12));
  const listed = chat("Train the model");
  const html = row({ chat: listed });
  expect(html).toContain('<div class="conversation-row has-actions">');
  expect(html).toMatch(
    /<button type="button" class="session-action" title="Rename" aria-label="Rename Train the model">/,
  );
  expect(html).toMatch(
    /<button type="button" class="session-action" title="Archive" aria-label="Archive Train the model">/,
  );
  expect(html).not.toContain("disabled");
  expect(html).not.toContain("session-note");
  // The row itself is still the button that opens the conversation.
  expect(html).toMatch(
    /<button type="button" class="session-item" title="Train the model">/,
  );
  const reason =
    "Rename and archive need the execution service; it starts with your next Send.";
  const stopped = row({ chat: listed, unavailable: reason });
  expect(stopped.match(/class="session-action" disabled=""/g)).toHaveLength(2);
  expect(stopped.match(new RegExp(`title="${reason}"`, "g"))).toHaveLength(2);
  // A request in flight locks the row's actions and says what it is doing.
  const renaming = row({ chat: listed, row: { pending: "rename" } });
  expect(renaming.match(/class="session-action" disabled=""/g)).toHaveLength(2);
  expect(renaming).toContain(
    '<p class="session-note" role="status">Renaming…</p>',
  );
  // An unknown outcome stays with the row and promises no retry.
  const unknown = row({
    chat: listed,
    row: { unknown: { action: "archive", code: "unavailable" } },
  });
  expect(unknown).toContain(
    '<p class="session-note" role="alert">Archive outcome is unknown (unavailable).',
  );
  expect(unknown).toContain("nothing is retried");
  expect(unknown).not.toContain("disabled");
  // An archived conversation offers only its way back; a live one nothing.
  const archived = row({
    chat: { ...listed, archived: true },
    onRename: undefined,
  });
  expect(archived).toContain('aria-label="Unarchive Train the model"');
  expect(archived).not.toContain("Rename");
  const live = row({
    chat: { ...listed, status: "running" },
    onRename: undefined,
    onArchive: undefined,
  });
  expect(live).toContain('<div class="conversation-row">');
  expect(live).not.toContain("session-action");
  const zh = row({ chat: listed, row: { pending: "archive" } }, "zh");
  expect(zh).toContain('aria-label="重命名“Train the model”"');
  expect(zh).toContain("正在归档…");
});
it("the sidebar gives history rows their actions, Running work none, and states the reason once", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 10, 12));
  const chats = [
    chat("Live reply", { status: "running" }),
    chat("Done today"),
    chat("Broke yesterday", {
      status: "failed",
      updatedAt: new Date(2026, 10, 9, 22).getTime(),
    }),
  ];
  const sidebar = (actionsUnavailable?: string) =>
    renderToStaticMarkup(
      <TaskSidebar
        client={new ServiceClient(transport())}
        taskId={null}
        scope={null}
        runs={[]}
        cancelCompatible={false}
        canceling={new Set()}
        onCancel={() => {}}
        onTask={() => {}}
        onScope={() => {}}
        chats={chats}
        conversationId={chats[1].id}
        actionsUnavailable={actionsUnavailable}
      />,
    );
  const [running, history] = sidebar().split("Conversation history");
  expect(running).not.toContain("session-action");
  expect(history.match(/aria-label="Rename /g)).toHaveLength(2);
  expect(history.match(/aria-label="Archive /g)).toHaveLength(2);
  expect(history).not.toContain("lp-actions-hint");
  // The archived view is one press away and reads nothing until opened.
  expect(history).toContain(
    '<button type="button" class="lp-section-action" aria-pressed="false" title="Show archived" aria-label="Show archived">',
  );
  expect(history).not.toContain("Back to history");
  const reason =
    "Rename and archive are unavailable until the execution service is observed.";
  const unready = sidebar(reason).split("Conversation history")[1];
  expect(unready.match(/<p class="panel-hint lp-actions-hint">/g)).toHaveLength(
    1,
  );
  expect(unready).toContain(`<p class="panel-hint lp-actions-hint">${reason}`);
  expect(unready.match(/class="session-action" disabled=""/g)).toHaveLength(4);
});
it("the archived view lists what was read, and a failed read is never an empty list", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 10, 12));
  type List = ReturnType<typeof useConversationHistory>;
  const list = (over: Partial<List>): List => ({
    value: undefined,
    error: undefined,
    loading: false,
    refresh: () => {},
    canPrevious: false,
    first: () => {},
    previous: () => {},
    next: () => {},
    ...over,
  });
  const view = (over: Partial<List>, unavailable = "") =>
    renderToStaticMarkup(
      <ArchivedList
        list={list(over)}
        unavailable={unavailable}
        onBack={() => {}}
        row={(entry) => (
          <ConversationRow
            key={entry.id}
            chat={entry}
            selected={false}
            onOpen={() => {}}
            unavailable={unavailable}
            onArchive={() => {}}
          />
        )}
      />,
    );
  const page = (entries: ChatSummary[]) => ({
    kind: "conversations" as const,
    entries,
    next: null,
  });
  const old = chat("Old migration notes", { archived: true });
  const read = view({ value: page([old]) });
  expect(read).toContain("Back to history");
  expect(read).toContain("Its session file is not moved or deleted.");
  expect(read).toContain('aria-label="Unarchive Old migration notes"');
  expect(read).not.toContain("Rename");
  expect(read).not.toContain("No archived conversations.");
  expect(view({ value: page([]) })).toContain("No archived conversations.");
  expect(view({ loading: true })).toContain("Reading archived conversations…");
  expect(view({ loading: true })).not.toContain("No archived conversations.");
  // Unreadable: said so, with the code's sentence, and never shown as empty.
  const failed = view({ error: "unavailable" });
  expect(failed).toContain(
    "Archived conversations could not be read. This is not an empty list.",
  );
  expect(failed).toContain("The service is unavailable right now");
  expect(failed).not.toContain("No archived conversations.");
  expect(failed).toContain("Observe current state");
  // Rows read before a failed re-read stay, beside the statement.
  const stale = view({ value: page([old]), error: "unavailable" });
  expect(stale).toContain("Old migration notes");
  expect(stale).toContain("This is not an empty list.");
  // Stopped: Unarchive is shown disabled, its reason above the rows.
  const reason =
    "Rename and archive need the execution service; it starts with your next Send.";
  const stopped = view({ value: page([old]) }, reason);
  expect(stopped).toContain(`<p class="panel-hint lp-actions-hint">${reason}`);
  expect(stopped).toContain('class="session-action" disabled=""');
});
