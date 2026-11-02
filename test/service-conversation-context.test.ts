import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { CadencePreferences } from "../src/cadence-preferences.ts";
import type {
  ConversationLocation,
  ModelCatalog,
} from "../src/service/contracts/models.ts";
import type { ServiceClient } from "../src/service-client.ts";
import { acceptingFixture } from "./helpers/accepting-fixture.ts";

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
    const a = { id: randomUUID(), cwd: join(f.root, "a") },
      b = { id: randomUUID(), cwd: join(f.root, "b") };
    for (const scope of [a, b]) {
      mkdirSync(scope.cwd);
      mkdirSync(join(scope.cwd, ".pi"));
      writeFileSync(
        join(scope.cwd, ".pi", "APPEND_SYSTEM.md"),
        `Scoped resource: ${scope.cwd}`,
      );
    }
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
      kind: "ok",
      value: { context: { ...legacy, revision: 0, model: null } },
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
        head: null,
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
        head: null,
        text: "Queued in B",
        model: cb.version,
      }),
    ).toMatchObject({ kind: "ok" });
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
    const turnA = JSON.parse(
      readFileSync(
        join(f.c.directory, "conversations-v1", "turns", ra, "turn.json"),
        "utf8",
      ),
    );
    const turnB = JSON.parse(
      readFileSync(
        join(f.c.directory, "conversations-v1", "turns", rb, "turn.json"),
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
      head: ra,
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
    expect(f.contacts()).toBe(2);
  } finally {
    await f.close();
  }
}, 30000);
