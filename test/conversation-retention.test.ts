import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { canonicalJson } from "../src/service/contracts/core.ts";
import {
  type ChatCursor,
  type ChatTurn,
  decodeWorkbenchResult,
} from "../src/service/contracts/workbench.ts";
import { ConversationHistory } from "../src/service/conversation-history.ts";
import {
  type ConversationControl,
  Conversations,
} from "../src/service/conversations.ts";
import { ServiceCoordination } from "../src/service/coordination.ts";

function fixture() {
  const base = mkdtempSync(join(tmpdir(), "retained-chat-")),
    cwd = join(base, "project");
  mkdirSync(cwd, { mode: 0o700 });
  const coordination = new ServiceCoordination(cwd, join(base, "state"));
  const model = {
    epoch: randomUUID(),
    configRev: 1,
    accessGeneration: 1,
    catalogId: randomUUID(),
  };
  const original: Promise<unknown>[] = [];
  const owner = {
    state: "idle",
    lease: { assert() {} },
    quarantine() {
      owner.state = "quarantined";
    },
    trackConversation(p: Promise<unknown>) {
      original.push(p);
    },
  };
  const o = {
    coordination,
    cwd,
    owner,
    choice: { snapshot: () => ({ version: model, selected: null }) },
    secrets: () => [],
  } as unknown as ConstructorParameters<typeof Conversations>[0];
  const conversations = new Conversations(o);
  const root = join(coordination.directory, "conversations-v1");
  const put = (path: string, value: unknown) =>
    coordination.files.create(
      join(root, path),
      canonicalJson(value, 384 * 1024),
      384 * 1024,
    );
  const record = (id: string): ChatTurn => ({
    id,
    epoch: model.epoch,
    status: "completed",
    items: [],
    notice: "",
    omitted: { thinking: false, media: false, other: false },
  });
  const command = (
    id: string,
    head: string | null,
    commandId: string = randomUUID(),
  ) => ({
    kind: "send" as const,
    conversationId: id,
    commandId,
    head,
    text: "exit cadence",
    model,
  });
  const control: ConversationControl = {
    reply: "Cadence is off.",
    instructions: "",
    accept() {},
    onTool: async () => {},
    settle: async () => {},
  };
  const seed = (id: string, ids: string[]) => {
    put(`identities/${id}.json`, { schema: "cadence-conversation/1", id, cwd });
    put(`sessions/${id}.json`, {
      id,
      title: "legacy",
      turns: ids,
      checkpoint: null,
    });
    for (const [index, turnId] of ids.entries()) {
      put(`turns/${turnId}/turn.json`, record(turnId));
      put(`turns/${turnId}/accepted.json`, {
        command: command(id, ids[index - 1] ?? null, turnId),
        at: index,
      });
    }
  };
  return {
    ...o,
    coordination,
    conversations,
    root,
    original,
    command,
    control,
    seed,
    put,
    record,
    owner,
    model,
    reopen: () => new Conversations(o),
  };
}
it("a legacy 1000-turn conversation continues into constant-size indexed metadata without losing its prefix", async () => {
  const f = fixture(),
    id = randomUUID(),
    prefix = Array.from({ length: 1000 }, () => randomUUID());
  f.seed(id, prefix);
  f.conversations.assertSettled();
  let head = prefix.at(-1) as string;
  for (let n = 0; n < 3; n++) {
    const input = f.command(id, head);
    expect(f.conversations.send(input, f.control)).toMatchObject({
      kind: "accepted",
    });
    await f.original.at(-1);
    head = input.commandId;
  }
  const meta = JSON.parse(
    readFileSync(join(f.root, "sessions", `${id}.json`), "utf8"),
  );
  expect(meta).toMatchObject({ count: 1003, head, turns: prefix });
  const cold = f.reopen();
  cold.assertSettled();
  expect(cold.records.hasTurn(id, prefix[0])).toBe(true);
  expect(cold.records.hasTurn(id, head)).toBe(true);
  expect(cold.records.conversation(id)).toMatchObject({
    kind: "conversation",
    turns: 1003,
    summary: { head },
  });
  // Any turn reads by position, the legacy prefix included.
  for (const [ordinal, turnId] of [
    [0, prefix[0]],
    [999, prefix.at(-1)],
    [1002, head],
  ] as const)
    expect(cold.records.turnSteps(id, ordinal, null)).toMatchObject({
      kind: "conversation-turn",
      ordinal,
      turn: { id: turnId },
    });
  expect(() => cold.records.turnSteps(id, 1003, null)).toThrow();
  // A position alone does not admit a turn: its ordinal must also be committed
  // by this conversation's head/count and immutable slot.
  const orphan = randomUUID();
  f.put(`turns/${orphan}/position.json`, {
    conversationId: id,
    ordinal: 1003,
    turnId: orphan,
  });
  expect(cold.records.hasTurn(id, orphan)).toBe(false);
  const slot = join(f.root, "indices", id, "1002.json");
  writeFileSync(
    slot,
    canonicalJson({ conversationId: id, ordinal: 1002, turnId: randomUUID() }),
  );
  expect(() => cold.records.turnSteps(id, 1002, null)).toThrow();
  f.conversations.records.closeReads();
  cold.records.closeReads();
});
it("new conversations have no 200-record cap and list in finite recent-first pages", async () => {
  const f = fixture();
  for (let n = 0; n < 205; n++) f.seed(randomUUID(), [randomUUID()]);
  const id = randomUUID();
  const input = f.command(id, null);
  f.conversations.send(input, f.control);
  await f.original.at(-1);
  const cold = f.reopen();
  cold.assertSettled();
  let after: ChatCursor | null = null,
    scan: string | undefined;
  const seen = new Set<string>();
  let first = true,
    progress = 0;
  for (let reads = 0; reads < 1000; reads++) {
    const result = cold.records.list(after, scan);
    decodeWorkbenchResult(result);
    if (result.kind === "conversations-progress") {
      progress++;
      scan = result.scan;
      continue;
    }
    if (result.kind !== "conversations") throw Error("list");
    expect(result.entries.length).toBeLessThanOrEqual(50);
    if (first) {
      expect(result.entries[0].id).toBe(id);
      first = false;
    }
    for (const row of result.entries) {
      expect(seen.has(row.id)).toBe(false);
      seen.add(row.id);
    }
    if (!result.next) break;
    after = result.next;
    scan = undefined;
  }
  expect(progress).toBeGreaterThan(0);
  expect(seen.size).toBe(206);
  const meta = JSON.parse(
    readFileSync(join(f.root, "sessions", `${id}.json`), "utf8"),
  );
  expect(meta.turns).toEqual([]);
  expect(meta.count).toBe(1);
  f.conversations.records.closeReads();
  cold.records.closeReads();
});
it("history cursors are one-use, boundary-bound and closed on owner departure", () => {
  const root = mkdtempSync(join(tmpdir(), "chat-scan-"));
  for (let n = 0; n < 20; n++)
    writeFileSync(join(root, `${randomUUID()}.json`), "{}");
  const reader = new ConversationHistory(
    root,
    () => true,
    (id) => ({ id, title: "t", head: id, status: "completed", updatedAt: 1 }),
  );
  const page = reader.read(null);
  if (page.kind !== "conversations-progress") throw Error("progress");
  expect(() =>
    reader.read({ id: randomUUID(), updatedAt: 1 }, page.scan),
  ).toThrow("stale");
  reader.read(null, page.scan);
  expect(() => reader.read(null, page.scan)).toThrow("stale");
  reader.close();
  expect(() => reader.read(null)).toThrow("unavailable");
});
