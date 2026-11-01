import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { canonicalJson } from "../src/service/contracts/core.ts";
import type { WorkbenchRead } from "../src/service/contracts/workbench.ts";
import { acceptingFixture } from "./helpers/accepting-fixture.ts";

it("a real SDK reply beyond both former caps completes, cold-pages losslessly and continues after restart", async () => {
  const f = await acceptingFixture("generated");
  try {
    let client = f.client;
    const bootstrap = await client.session();
    expect(bootstrap.kind).toBe("ok");
    async function choose() {
      const catalog = await client.models();
      if (catalog.kind !== "ok") throw Error(JSON.stringify(catalog));
      const chosen = await client.chooseModel({
        expected: catalog.value.version,
        choice: {
          provider: "fixture",
          model: "fixed",
          api: "openai-completions",
          thinking: "off",
        },
      });
      if (chosen.kind !== "ok") throw Error(JSON.stringify(chosen));
      return chosen.value.version;
    }
    const read = async (request: WorkbenchRead) => {
      const reply = await client.workbenchRead(request);
      if (reply.kind !== "ok") throw Error(JSON.stringify(reply));
      canonicalJson(reply.value, 512 * 1024);
      return reply.value;
    };
    const id = randomUUID(),
      first = randomUUID();
    const full = `BEGIN-LARGE ${"large retained evidence 文😀 ".repeat(80000)} END-LARGE`;
    expect(Buffer.byteLength(full)).toBeGreaterThan(2 * 1024 * 1024);
    f.reply(full);
    const accepted = await client.workbenchCommand({
      kind: "send",
      commandId: first,
      conversationId: id,
      head: null,
      text: "Return the large fixture result",
      model: await choose(),
    });
    expect(accepted.kind).toBe("ok");
    async function settled() {
      for (let attempt = 0; attempt < 750; attempt++) {
        const view = await read({ kind: "conversation", id, before: null });
        if (view.kind !== "conversation") throw Error("conversation");
        if (!["running", "queued"].includes(view.summary?.status ?? "queued"))
          return view;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw Error("original turn did not settle");
    }
    const view = await settled();
    expect(view.summary?.status, JSON.stringify(view)).toBe("completed");
    expect(view.turns[0].transcript?.pages).toBeGreaterThan(1);
    const count = view.turns[0].transcript?.pages ?? 0;
    client = (await f.restart()).client;
    let restored = "";
    for (let page = 0; page < count; page++) {
      const result = await read({
        kind: "conversation-transcript",
        id,
        turnId: first,
        page,
      });
      if (result.kind !== "conversation-transcript") throw Error("transcript");
      restored += result.turn.items
        .filter((item) => item.role === "assistant")
        .map((item) => item.text)
        .join("");
    }
    expect(restored).toBe(full);
    const outside = await client.workbenchRead({
      kind: "conversation-transcript",
      id: randomUUID(),
      turnId: first,
      page: 0,
    });
    expect(outside.kind).toBe("error");
    f.reply("The explicit continuation completed.");
    const follow = await client.workbenchCommand({
      kind: "send",
      commandId: randomUUID(),
      conversationId: id,
      head: first,
      text: "Continue from the complete checkpoint",
      model: await choose(),
    });
    expect(follow.kind).toBe("ok");
    const continued = await settled();
    expect(continued.summary?.status, JSON.stringify(continued)).toBe(
      "completed",
    );
    expect(JSON.stringify(f.observations.at(-1)?.messages)).toContain(
      "END-LARGE",
    );
    expect(JSON.stringify(f.observations.at(-1)?.messages)).toContain(
      "BEGIN-LARGE",
    );
  } finally {
    await f.close();
  }
}, 40000);
