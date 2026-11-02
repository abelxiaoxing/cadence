import { createHash } from "node:crypto";
import {
  linkSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  conversationMessages,
  readConversationContext,
} from "../src/conversation-context.mjs";
import { canonicalJson } from "../src/service/contracts/core.ts";
import { ConversationMigration } from "../src/service/conversation-migration.ts";
import type { ServiceCoordination } from "../src/service/coordination.ts";
import type { ServiceOwner } from "../src/service/owner.ts";
import { PiSessions } from "../src/service/pi-sessions.ts";
import { PrivateFiles } from "../src/service/private-files.ts";
import { WEBUI_SESSION_ENTRY } from "../src/session-entries.mjs";
import { seedLegacyConversations } from "./helpers/retained-conversations.ts";

const owner = {
  lease: { assert() {} },
  state: "idle",
} as unknown as ServiceOwner;
const assistant = (text: string) => ({
  role: "assistant",
  timestamp: 2,
  content: [{ type: "text", text }],
  api: "openai-completions",
  provider: "fixture",
  model: "fixed",
  usage: {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "stop",
});

it("an explicit migration copies old browser conversations into Pi sessions with the same id and leaves the old store", () => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "migrate-project-")));
  const state = mkdtempSync(join(tmpdir(), "migrate-state-"));
  const files = new PrivateFiles(state);
  const coordination = {
    directory: state,
    files,
  } as unknown as ServiceCoordination;
  const sessions = new PiSessions(join(state, "pi-sessions"), cwd);
  const [kept, empty, other, broken] = seedLegacyConversations(
    { directory: state, files },
    cwd,
    [
      {
        messages: [
          { role: "user", timestamp: 1, content: "Old question" },
          assistant("Old answer"),
        ],
      },
      { messages: null },
      {
        messages: [{ role: "user", timestamp: 1, content: "x" }],
        cwd: "/other",
      },
      { messages: [{ role: "user", timestamp: 1, content: "y" }] },
    ],
  );
  writeFileSync(
    join(
      state,
      "conversations-v1",
      "turns",
      readdirSync(join(state, "conversations-v1", "turns")).find((turn) =>
        readFileSync(
          join(state, "conversations-v1", "sessions", `${broken}.json`),
          "utf8",
        ).includes(turn),
      ) as string,
      "context.json",
    ),
    "{torn",
    { mode: 0o600 },
  );
  const migration = new ConversationMigration({
    coordination,
    owner,
    cwd,
    sessions,
  });
  expect(migration.pending()).toBe(2);
  expect(migration.migrate()).toEqual({ migrated: 1, skipped: 1 });
  // Idempotent: an existing session of that id is never replaced.
  expect(migration.pending()).toBe(1);
  expect(migration.migrate()).toEqual({ migrated: 0, skipped: 1 });
  const listed = sessions.list();
  expect(listed.map((l) => l.summary.id)).toEqual([kept]);
  expect(listed[0].summary).toMatchObject({
    webui: true,
    firstUser: "Old question",
  });
  const lines = readFileSync(listed[0].path, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(lines[0]).toMatchObject({
    type: "session",
    version: 3,
    id: kept,
    cwd,
  });
  expect(lines.slice(1).map((l) => l.type)).toEqual([
    "custom",
    "model_change",
    "message",
    "message",
  ]);
  expect(lines[1].customType).toBe(WEBUI_SESSION_ENTRY);
  for (let i = 2; i < lines.length; i++)
    expect(lines[i].parentId).toBe(lines[i - 1].id);
  const turns = sessions.session(kept);
  expect(turns?.branch(turns.current()).map((e) => e.type)).toHaveLength(4);
  // The old records stay where they were.
  for (const id of [kept, empty, other, broken])
    expect(readdirSync(join(state, "conversations-v1", "sessions"))).toContain(
      `${id}.json`,
    );
});

it("old checkpoints are read only through their verified record chain", {
  tags: ["slow"],
}, () => {
  const root = mkdtempSync(join(tmpdir(), "chat-context-")),
    files = new PrivateFiles(root);
  const messages = Array.from({ length: 300 }, (_, timestamp) => ({
    role: "user",
    timestamp,
    content: "abc ".repeat(2000),
  }));
  let head: string | null = null;
  messages.forEach((message, index) => {
    const body = canonicalJson({
      schema: "cadence-conversation-message/1",
      index,
      previous: head,
      message: conversationMessages([message])[0],
    });
    files.create(join(root, `context-${index}.json`), body, 32 * 1024 * 1024);
    head = createHash("sha256").update(body).digest("hex");
  });
  const path = join(root, "context.json");
  files.create(
    path,
    canonicalJson({
      schema: "cadence-conversation-context/2",
      messages: messages.length,
      head,
    }),
  );
  expect(readConversationContext(path)).toHaveLength(messages.length);
  const changed = join(root, "context-12.json");
  writeFileSync(changed, readFileSync(changed, "utf8").replace("abc", "xyz"));
  expect(() => readConversationContext(path)).toThrow("Invalid context chain");
  writeFileSync(changed, readFileSync(changed, "utf8").replace("xyz", "abc"));
  const last = join(root, "context-299.json");
  const lastBytes = readFileSync(last);
  unlinkSync(last);
  expect(() => readConversationContext(path)).toThrow();
  writeFileSync(last, lastBytes, { mode: 0o600 });
  linkSync(last, join(root, "alias.json"));
  expect(() => readConversationContext(path)).toThrow("Invalid context file");
});
