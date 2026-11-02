import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { acceptingFixture } from "./helpers/accepting-fixture.ts";
import { seedConversations } from "./helpers/retained-conversations.ts";

it("a restarted generated owner continues turn 1001 and admits conversation 206 through the real SDK", async () => {
  const f = await acceptingFixture("generated");
  try {
    await f.client.session();
    const catalog = await f.client.models();
    if (catalog.kind !== "ok") throw Error("catalog");
    const seeded = seedConversations(
      f.c,
      f.root,
      catalog.value.version,
      205,
      1000,
    );
    const { client } = await f.restart();
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
      [seeded.ids[0], seeded.longHead],
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
        const view = await client.workbenchRead({ kind: "conversation", id });
        if (view.kind !== "ok" || view.value.kind !== "conversation")
          throw Error(JSON.stringify(view));
        const status = view.value.summary?.status;
        if (status && !["queued", "running"].includes(status)) {
          expect(status, JSON.stringify(view)).toBe("completed");
          settled = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(settled).toBe(true);
    }
    expect(JSON.stringify(f.observations[0].messages)).toContain(
      "seeded previous context",
    );
    const meta = JSON.parse(
      readFileSync(
        join(
          f.c.directory,
          "conversations-v1",
          "sessions",
          `${seeded.ids[0]}.json`,
        ),
        "utf8",
      ),
    );
    expect(meta.count).toBe(1001);
    expect(meta.turns).toHaveLength(1000);
    expect(f.contacts()).toBe(2);
  } finally {
    await f.close();
  }
}, 30000);
