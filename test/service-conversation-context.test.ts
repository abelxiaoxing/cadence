// @module-tag slow
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { CadencePreferences } from "../src/cadence-preferences.ts";
import type {
  ConversationLocation,
  ModelCatalog,
} from "../src/service/contracts/models.ts";
import { sessionDirectory } from "../src/service/pi-sessions.ts";
import type { ServiceClient } from "../src/service-client.ts";
import { BROWSER_COMMAND_ENTRY } from "../src/session-entries.mjs";
import { acceptingFixture } from "./helpers/accepting-fixture.ts";
import { seedPiSessions } from "./helpers/retained-conversations.ts";

const chosen = (model: string) => ({
  provider: "fixture",
  model,
  api: "openai-completions" as const,
  thinking: "off" as const,
});
async function catalog(
  client: ServiceClient,
  location: ConversationLocation,
): Promise<ModelCatalog> {
  const r = await client.models(undefined, location);
  expect(r.kind, JSON.stringify(r)).toBe("ok");
  if (r.kind !== "ok") throw Error("catalog unavailable");
  return r.value;
}
async function choose(
  client: ServiceClient,
  location: ConversationLocation,
  model: string,
) {
  const c = await catalog(client, location);
  const r = await client.chooseModel(
    { expected: c.version, choice: chosen(model) },
    location,
  );
  expect(r.kind, JSON.stringify(r)).toBe("ok");
  return catalog(client, location);
}
it("one checkout, two conversation directories/models: queued work keeps its snapshot and restart restores only its own preference", async () => {
  const f = await acceptingFixture("generated", undefined, null, {
    models: ["fixed", "alternate"],
  });
  try {
    expect((await f.client.session()).kind).toBe("ok");
    execFileSync("git", ["init", "-q"], { cwd: f.root });
    const a: ConversationLocation = {
        id: randomUUID(),
        cwd: join(f.root, "a"),
      },
      b: ConversationLocation = { id: randomUUID(), cwd: join(f.root, "b") };
    for (const scope of [a, b]) {
      mkdirSync(scope.cwd);
      mkdirSync(join(scope.cwd, ".pi"));
      writeFileSync(
        join(scope.cwd, ".pi", "APPEND_SYSTEM.md"),
        `Scoped resource: ${scope.cwd}`,
      );
    }
    // Existing terminal histories in two subdirectories are the browser's
    // same sessions, not imported copies or the owner's saved default cwd.
    const terminalA = seedPiSessions(
      sessionDirectory(a.cwd, join(f.dir, "agent")),
      a.cwd,
      1,
    );
    const terminalB = seedPiSessions(
      sessionDirectory(b.cwd, join(f.dir, "agent")),
      b.cwd,
      1,
    );
    a.id = terminalA.ids[0];
    b.id = terminalB.ids[0];
    const listed = await f.client.workbenchRead({ kind: "conversations" });
    expect(listed).toMatchObject({
      kind: "ok",
      value: {
        entries: expect.arrayContaining([
          {
            id: a.id,
            origin: "terminal",
            title: expect.any(String),
            leaf: terminalA.longLeaf,
            status: "completed",
            updatedAt: expect.any(Number),
            cadence: false,
          },
          {
            id: b.id,
            origin: "terminal",
            title: expect.any(String),
            leaf: terminalB.longLeaf,
            status: "completed",
            updatedAt: expect.any(Number),
            cadence: false,
          },
        ]),
      },
    });
    const contextPath = (location: ConversationLocation) =>
      join(
        f.c.directory,
        "conversations-v1",
        "contexts",
        `${location.id}.json`,
      );
    const before = await f.client.workbenchRead({
      kind: "conversation-context",
      location: a,
    });
    expect(before).toMatchObject({
      kind: "ok",
      value: { context: { ...a, model: null, revision: 0 } },
    });
    await catalog(f.client, a);
    expect(existsSync(contextPath(a))).toBe(false);
    const legacy = { id: randomUUID(), cwd: a.cwd };
    const identity = join(
      f.c.directory,
      "conversations-v1",
      "identities",
      `${legacy.id}.json`,
    );
    const bytes = JSON.stringify({
      schema: "cadence-conversation/1",
      ...legacy,
    });
    f.c.files.create(identity, bytes);
    expect(
      await f.client.workbenchRead({
        kind: "conversation-context",
        location: { id: legacy.id, cwd: b.cwd },
      }),
    ).toMatchObject({
      kind: "error",
      error: { code: "retired-conversation" },
    });
    expect(readFileSync(identity, "utf8")).toBe(bytes);
    expect(existsSync(contextPath(legacy))).toBe(false);
    const ca = await choose(f.client, a, "fixed");
    const cb = await choose(f.client, b, "alternate");
    expect((await catalog(f.client, a)).selected?.model).toBe("fixed");
    const sameDirectory = { id: randomUUID(), cwd: a.cwd };
    await choose(f.client, sameDirectory, "alternate");
    expect((await catalog(f.client, a)).version).toEqual(ca.version);
    expect(ca.version.conversation).toEqual(a);
    expect(cb.version.conversation).toEqual(b);
    const ra = randomUUID(),
      rb = randomUUID();
    f.mode("pending");
    expect(
      await f.client.workbenchCommand({
        kind: "send",
        commandId: ra,
        conversationId: a.id,
        head: terminalA.longLeaf,
        text: "Hold this original",
        model: ca.version,
      }),
    ).toMatchObject({ kind: "ok" });
    await expect.poll(() => f.held(), { timeout: 10000 }).toBe(1);
    expect(
      await f.client.workbenchCommand({
        kind: "send",
        commandId: rb,
        conversationId: b.id,
        head: terminalB.longLeaf,
        text: "continue",
        model: cb.version,
      }),
    ).toMatchObject({ kind: "ok" });
    // A holds the gate, so B has not opened its SDK manager yet. A terminal
    // sends the exact same text from B's captured parent first.
    const bDirectory = sessionDirectory(b.cwd, join(f.dir, "agent"), {});
    const bFile = join(bDirectory, readdirSync(bDirectory)[0]);
    const oldEntries = readFileSync(bFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const terminalUser = randomUUID().slice(0, 8),
      terminalReply = randomUUID().slice(0, 8),
      now = new Date().toISOString();
    appendFileSync(
      bFile,
      [
        {
          type: "message",
          id: terminalUser,
          parentId: terminalB.longLeaf,
          timestamp: now,
          message: {
            role: "user",
            content: [{ type: "text", text: "continue" }],
            timestamp: Date.now(),
          },
        },
        {
          type: "message",
          id: terminalReply,
          parentId: terminalUser,
          timestamp: now,
          message: {
            ...oldEntries.at(-1).message,
            content: [{ type: "text", text: "Terminal duplicate reply" }],
          },
        },
      ]
        .map((line) => `${JSON.stringify(line)}\n`)
        .join(""),
    );
    // No global quiescence requirement. This changes future B sends, not rb.
    await choose(f.client, b, "fixed");
    expect((await catalog(f.client, a)).version).toEqual(ca.version);
    f.mode("single");
    f.fail();
    await expect
      .poll(
        async () => {
          const r = await f.client.workbenchRead({
            kind: "conversation",
            leaf: null,
            known: null,
            id: b.id,
          });
          return r.kind === "ok" && r.value.kind === "conversation"
            ? r.value.summary?.status
            : null;
        },
        { timeout: 15000 },
      )
      .toBe("completed");
    expect(f.modelRequests).toEqual(["fixed", "alternate"]);
    const bState = JSON.parse(
      readFileSync(
        join(
          f.c.directory,
          "conversation-commands-v1",
          "commands",
          rb,
          "state.json",
        ),
        "utf8",
      ),
    );
    const entries = readFileSync(bFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const marker = entries.find(
      (entry) =>
        entry.type === "custom" &&
        entry.customType === BROWSER_COMMAND_ENTRY &&
        entry.data.commandId === rb,
    );
    expect(marker).toBeDefined();
    expect(bState.user).toBe(marker.data.userId);
    expect(bState.user).not.toBe(terminalUser);
    const terminalTurn = await f.client.workbenchRead({
      kind: "conversation-turn",
      id: b.id,
      leaf: terminalReply,
      ordinal: 1,
      before: null,
    });
    if (
      terminalTurn.kind !== "ok" ||
      terminalTurn.value.kind !== "conversation-turn"
    )
      throw Error("terminal turn");
    expect(terminalTurn.value.turn.id).toBe(terminalUser);
    expect(terminalTurn.value.turn.execution).toBeUndefined();

    expect(
      entries.filter(
        (entry) =>
          entry.type === "message" &&
          entry.message.role === "user" &&
          entry.message.content[0]?.text === "continue",
      ),
    ).toHaveLength(2);

    const turnA = JSON.parse(
      readFileSync(
        join(
          f.c.directory,
          "conversation-commands-v1",
          "commands",
          ra,
          "accepted.json",
        ),
        "utf8",
      ),
    );
    const turnB = JSON.parse(
      readFileSync(
        join(
          f.c.directory,
          "conversation-commands-v1",
          "commands",
          rb,
          "accepted.json",
        ),
        "utf8",
      ),
    );
    expect(turnA.execution).toMatchObject({
      cwd: a.cwd,
      checkoutRoot: f.root,
      model: chosen("fixed"),
    });
    expect(turnB.execution).toMatchObject({
      cwd: b.cwd,
      checkoutRoot: f.root,
      model: chosen("alternate"),
    });
    expect(JSON.stringify(f.observations[0].messages)).toContain(a.cwd);
    expect(JSON.stringify(f.observations[1].messages)).toContain(b.cwd);
    expect(JSON.stringify(f.observations[1].messages)).not.toContain(
      `Scoped resource: ${a.cwd}`,
    );
    const spoof = await f.client.workbenchCommand({
      kind: "send",
      commandId: randomUUID(),
      conversationId: a.id,
      head: null,
      text: "Wrong scope",
      model: cb.version,
    });
    expect(spoof).toMatchObject({
      kind: "error",
      error: { code: "stale", effect: "none" },
    });
    const wrongDirectory = await f.client.chooseModel(
      {
        expected: (await catalog(f.client, b)).version,
        choice: chosen("alternate"),
      },
      { id: b.id, cwd: a.cwd },
    );
    expect(wrongDirectory.kind).toBe("error");
    expect(JSON.stringify(f.observations[1].messages)).toContain(
      "Terminal question 000.0",
    );
    const firstBranch = await f.client.workbenchRead({
      kind: "conversation",
      id: b.id,
      leaf: null,
      known: null,
    });
    if (firstBranch.kind !== "ok" || firstBranch.value.kind !== "conversation")
      throw Error("branch read");
    const leaf = firstBranch.value.leaf;
    f.reply("New branch, same Pi session and scoped cwd");
    const branched = randomUUID();
    expect(
      await f.client.workbenchCommand({
        kind: "send",
        commandId: branched,
        conversationId: b.id,
        head: terminalB.longLeaf,
        text: "Alternative from the terminal turn",
        model: (await catalog(f.client, b)).version,
      }),
    ).toMatchObject({ kind: "ok" });
    await expect
      .poll(
        async () => {
          const r = await f.client.workbenchRead({
            kind: "conversation",
            id: b.id,
            leaf: null,
            known: null,
          });
          return r.kind === "ok" && r.value.kind === "conversation"
            ? r.value.summary?.status
            : null;
        },
        { timeout: 15000 },
      )
      .toBe("completed");
    expect(
      await f.client.workbenchRead({
        kind: "conversation",
        id: b.id,
        leaf: null,
        known: null,
      }),
    ).toMatchObject({
      kind: "ok",
      value: {
        branches: 3, // terminal duplicate plus the two browser branches
        turns: 2,
        commands: expect.arrayContaining([rb, branched]),
      },
    });
    expect(
      await f.client.workbenchRead({
        kind: "conversation",
        id: b.id,
        leaf,
        known: null,
      }),
    ).toMatchObject({ kind: "ok", value: { leaf, turns: 2 } });
    expect(f.modelRequests).toEqual(["fixed", "alternate", "fixed"]);
    // Deliberately choose B again as the default for NEW conversations.
    await choose(f.client, b, "alternate");
    const kept = readFileSync(contextPath(a), "utf8");
    const restarted = await f.restart();
    const coldA = await catalog(restarted.client, a);
    expect(coldA.selected).toBeNull();
    expect(coldA.remembered).toEqual(chosen("fixed"));
    expect(readFileSync(contextPath(a), "utf8")).toBe(kept);
    expect(
      await restarted.client.workbenchCommand({
        kind: "restore-model",
        commandId: randomUUID(),
        epoch: restarted.epoch,
        location: a,
        expected: coldA.version,
        choice: chosen("fixed"),
      }),
    ).toMatchObject({ kind: "ok" });
    expect((await catalog(restarted.client, a)).selected?.model).toBe("fixed");
    const prefs = new CadencePreferences(join(f.dir, "agent"));
    expect(prefs.read()?.model).toBe("alternate"); // restoring A did not reset the global default
    expect((await catalog(restarted.client, b)).remembered).toEqual(
      chosen("alternate"),
    );
    const inactiveB = await catalog(restarted.client, b);
    const restoredB = await choose(restarted.client, b, "alternate");
    expect(restoredB.version.configRev).toBe(inactiveB.version.configRev);
    expect(restoredB.version.catalogId).not.toBe(inactiveB.version.catalogId);
    expect(f.contacts()).toBe(3);
  } finally {
    await f.close();
  }
}, 30000);
