// @module-tag slow
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
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
