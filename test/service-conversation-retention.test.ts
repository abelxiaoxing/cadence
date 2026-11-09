// @module-tag slow
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  ftruncateSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import type {
  ChatCursor,
  WorkbenchRead,
} from "../src/service/contracts/workbench.ts";
import { sessionDirectory } from "../src/service/pi-sessions.ts";
import { acceptingFixture } from "./helpers/accepting-fixture.ts";
import { seedPiSessions } from "./helpers/retained-conversations.ts";

it("the browser lists 205 terminal sessions, continues a 1000-turn one in its own file and starts session 206", async () => {
  const f = await acceptingFixture("generated");
  try {
    await f.client.session();
    const directory = sessionDirectory(f.root, join(f.dir, "agent"), {});
    const seeded = seedPiSessions(directory, f.root, 205, 1000);
    const { client } = await f.restart();
    const read = async (request: WorkbenchRead) => {
      const reply = await client.workbenchRead(request);
      if (reply.kind !== "ok") throw Error(JSON.stringify(reply));
      return reply.value;
    };
    // Recent first, in pages; every session exactly once.
    const listed: string[] = [];
    let after: ChatCursor | null = null;
    for (let page = 0; page < 10; page++) {
      const value = await read({ kind: "conversations", after });
      if (value.kind !== "conversations") throw Error("conversations");
      expect(value.entries.length).toBeLessThanOrEqual(50);
      listed.push(...value.entries.map((entry) => entry.id));
      if (!value.next) break;
      after = value.next;
    }
    expect(listed).toEqual([...seeded.ids].reverse());
    const fresh = await client.models();
    if (fresh.kind !== "ok") throw Error("catalog");
    const selected = await client.chooseModel({
      expected: fresh.value.version,
      choice: {
        provider: "fixture",
        model: "fixed",
        api: "openai-completions",
        thinking: "off",
      },
    });
    if (selected.kind !== "ok") throw Error("choice");
    f.reply("A new explicit turn completed.");
    for (const [id, head] of [
      [seeded.ids[0], seeded.longLeaf],
      [randomUUID(), null],
    ] as const) {
      const sent = await client.workbenchCommand({
        kind: "send",
        commandId: randomUUID(),
        conversationId: id,
        head,
        text: "Continue explicitly",
        model: selected.value.version,
      });
      expect(sent.kind).toBe("ok");
      let settled = false;
      for (let n = 0; n < 750; n++) {
        const view = await read({
          kind: "conversation",
          id,
          leaf: null,
          known: null,
        });
        if (view.kind !== "conversation") throw Error(JSON.stringify(view));
        if (view.summary && !view.summary.live) {
          expect(view.summary.status, JSON.stringify(view)).toBe("completed");
          if (head) expect(view.turns).toBe(1001);
          settled = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(settled).toBe(true);
    }
    // The terminal's own context reached the model, and its file holds the reply.
    expect(JSON.stringify(f.observations[0].messages)).toContain(
      "Terminal question 000.999",
    );
    const sessions = await read({ kind: "conversations", after: null });
    if (sessions.kind !== "conversations") throw Error("conversations");
    expect(sessions.entries[0].origin).toBe("webui");
    expect(sessions.entries[1]).toMatchObject({
      id: seeded.ids[0],
      origin: "terminal",
    });
    const file = readFileSync(
      join(
        directory,
        `${new Date(0).toISOString().replace(/[:.]/g, "-")}_${seeded.ids[0]}.jsonl`,
      ),
      "utf8",
    );
    expect(file).toContain("A new explicit turn completed.");
    expect(f.contacts()).toBe(2);
  } finally {
    await f.close();
  }
}, 60000);

it("a retained Pi session past 64MiB continues in place without replacing its original prefix", async () => {
  const f = await acceptingFixture("generated");
  try {
    await f.client.session();
    const directory = sessionDirectory(f.root, join(f.dir, "agent"), {});
    const seed = seedPiSessions(directory, f.root, 1);
    const names = readdirSync(directory);
    expect(names).toHaveLength(1);
    const path = join(directory, names[0]),
      prefix = readFileSync(path);
    const fd = openSync(path, "r+");
    try {
      ftruncateSync(fd, 64 * 1024 * 1024 + 1);
      writeSync(fd, "\n", 64 * 1024 * 1024);
    } finally {
      closeSync(fd);
    }
    const catalog = await f.client.models();
    if (catalog.kind !== "ok") throw Error("catalog");
    const selected = await f.client.chooseModel({
      expected: catalog.value.version,
      choice: {
        provider: "fixture",
        model: "fixed",
        api: "openai-completions",
        thinking: "off",
      },
    });
    if (selected.kind !== "ok") throw Error("choice");
    expect(
      await f.client.workbenchRead({ kind: "conversations" }),
    ).toMatchObject({
      kind: "ok",
      value: { entries: [{ id: seed.ids[0], status: "completed" }] },
    });
    expect(
      await f.client.workbenchRead({
        kind: "conversation",
        id: seed.ids[0],
        leaf: null,
        known: null,
      }),
    ).toMatchObject({ kind: "ok" });
    const commandId = randomUUID();
    f.reply("Continued large history.");
    expect(
      await f.client.workbenchCommand({
        kind: "send",
        commandId,
        conversationId: seed.ids[0],
        head: null,
        text: "Continue the existing history",
        model: selected.value.version,
      }),
    ).toMatchObject({
      kind: "ok",
      value: { kind: "accepted", commandId },
    });
    for (let n = 0; n < 750; n++) {
      const view = await f.client.workbenchRead({
        kind: "conversation",
        id: seed.ids[0],
        leaf: null,
        known: null,
      });
      if (
        view.kind === "ok" &&
        view.value.kind === "conversation" &&
        !view.value.summary?.live
      ) {
        expect(view.value.summary?.status).toBe("completed");
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(f.contacts()).toBeGreaterThan(0);
    expect(readdirSync(directory)).toEqual(names);
    expect(statSync(path).size).toBeGreaterThan(64 * 1024 * 1024 + 1);
    const after = openSync(path, "r");
    try {
      const bytes = Buffer.alloc(prefix.length);
      readSync(after, bytes);
      expect(bytes).toEqual(prefix);
    } finally {
      closeSync(after);
    }
    expect(
      existsSync(
        join(f.c.directory, "conversation-commands-v1", "commands", commandId),
      ),
    ).toBe(true);
  } finally {
    await f.close();
  }
});
