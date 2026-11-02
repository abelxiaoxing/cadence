// @module-tag slow
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { canonicalJson } from "../src/service/contracts/core.ts";
import type {
  WorkbenchRead,
  WorkbenchResult,
} from "../src/service/contracts/workbench.ts";
import { acceptingFixture } from "./helpers/accepting-fixture.ts";

it("a browser conversation is a Pi session: a large reply pages losslessly cold, continues, and a send from an earlier entry branches", async () => {
  const f = await acceptingFixture("generated");
  try {
    let client = f.client;
    expect((await client.session()).kind).toBe("ok");
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
    const id = randomUUID();
    async function settled(): Promise<
      Extract<WorkbenchResult, { kind: "conversation" }>
    > {
      for (let attempt = 0; attempt < 750; attempt++) {
        const view = await read({
          kind: "conversation",
          id,
          leaf: null,
          known: null,
        });
        if (view.kind !== "conversation") throw Error("conversation");
        if (view.summary && !view.summary.live) return view;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw Error("original turn did not settle");
    }
    const full = `BEGIN-LARGE ${"large retained evidence 文😀 ".repeat(80000)} END-LARGE`;
    expect(Buffer.byteLength(full)).toBeGreaterThan(2 * 1024 * 1024);
    f.reply(full);
    const accepted = await client.workbenchCommand({
      kind: "send",
      commandId: randomUUID(),
      conversationId: id,
      head: null,
      text: "Return the large fixture result",
      model: await choose(),
    });
    expect(accepted.kind).toBe("ok");
    const view = await settled();
    expect(view.summary).toMatchObject({
      status: "completed",
      origin: "webui",
    });
    expect(view.turns).toBe(1);
    // The session is Pi's own file, under the agent directory, named by its id.
    const sessions = join(f.dir, "agent", "sessions");
    const [dir] = readdirSync(sessions);
    const [name] = readdirSync(join(sessions, dir));
    expect(name.endsWith(`_${id}.jsonl`)).toBe(true);
    const lines = readFileSync(join(sessions, dir, name), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines[0]).toMatchObject({ type: "session", id, version: 3 });
    expect(lines.some((l) => l.type === "model_change")).toBe(true);
    expect(
      lines.filter((l) => l.type === "message").map((l) => l.message.role),
    ).toEqual(["user", "assistant"]);
    client = (await f.restart()).client;
    // A cold owner reads the turn from the session; the answer's parts restore it.
    const first = await read({
      kind: "conversation",
      id,
      leaf: null,
      known: null,
    });
    if (first.kind !== "conversation") throw Error("conversation");
    const listed = await read({
      kind: "conversation-turn",
      id,
      leaf: first.leaf,
      ordinal: 0,
      before: null,
    });
    if (listed.kind !== "conversation-turn") throw Error("turn");
    expect(listed.turn.status).toBe("completed");
    expect(listed.turn.stable).toBe(listed.turn.steps);
    const index = listed.steps.findIndex((step) => step.role === "assistant");
    const answer = listed.steps[index];
    expect(answer.clipped).toBe(true);
    expect(answer.parts).toBeGreaterThan(1);
    let restored = "";
    for (let part = 0; part < answer.parts; part++) {
      const result = await read({
        kind: "conversation-step",
        id,
        leaf: first.leaf,
        turnId: listed.turn.id,
        step: listed.start + index,
        part,
      });
      if (result.kind !== "conversation-step") throw Error("step");
      restored += result.item.text;
    }
    expect(restored).toBe(full);
    const outside = await client.workbenchRead({
      kind: "conversation-step",
      id: randomUUID(),
      leaf: null,
      turnId: listed.turn.id,
      step: 0,
      part: 0,
    });
    expect(outside.kind).toBe("error");
    f.reply("The explicit continuation completed.");
    const follow = await client.workbenchCommand({
      kind: "send",
      commandId: randomUUID(),
      conversationId: id,
      head: first.leaf,
      text: "Continue the session",
      model: await choose(),
    });
    expect(follow.kind).toBe("ok");
    const continued = await settled();
    expect(continued.summary?.status).toBe("completed");
    expect(continued.turns).toBe(2);
    expect(continued.branches).toBe(1);
    expect(JSON.stringify(f.observations.at(-1)?.messages)).toContain(
      "END-LARGE",
    );
    // Sending from the first reply again forks the session; both branches stay.
    f.reply("A second branch.");
    const fork = await client.workbenchCommand({
      kind: "send",
      commandId: randomUUID(),
      conversationId: id,
      head: first.leaf,
      text: "Try another way",
      model: await choose(),
    });
    expect(fork.kind).toBe("ok");
    const forked = await settled();
    expect(forked.turns).toBe(2);
    expect(forked.branches).toBe(2);
    const tree = await read({ kind: "conversation-tree", id, leaf: null });
    if (tree.kind !== "conversation-tree") throw Error("tree");
    expect(tree.nodes.map((n) => n.text)).toEqual([
      "Return the large fixture result",
      "Continue the session",
      "Try another way",
    ]);
    expect(tree.nodes.map((n) => n.current)).toEqual([true, false, true]);
    const older = await read({
      kind: "conversation",
      id,
      leaf: tree.nodes[1].leaf,
      known: forked.leaf,
    });
    expect(older).toMatchObject({ turns: 2, continues: false });
  } finally {
    await f.close();
  }
}, 60000);
