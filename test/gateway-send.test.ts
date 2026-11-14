// @module-tag slow
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  decodeProjectEntry,
  decodeProjectObservation,
} from "../src/service/contracts/gateway.ts";
import type { WorkbenchRead } from "../src/service/contracts/workbench.ts";
import { ServiceCoordination } from "../src/service/coordination.ts";
import { sessionDirectory } from "../src/service/pi-sessions.ts";
import { loadWebAssets } from "../src/service-assets.ts";
import { wireUrl } from "../src/service-wire.ts";
import { gatewayFixture } from "./helpers/gateway-fixture.ts";
import { seedPiSessions } from "./helpers/retained-conversations.ts";

it("selection stays inert; one explicit Send preparation acquires an owner but never a message, model or execution grant", async () => {
  const g = await gatewayFixture();
  try {
    const entered = await fetch(g.link, { redirect: "manual" });
    const cookie = entered.headers.get("set-cookie")!.split(";")[0];
    const state = (await (
      await fetch(`${g.endpoint}/workbench/v1`, { headers: { Cookie: cookie } })
    ).json()) as { epoch: string; csrf: string };
    const m = loadWebAssets().manifest;
    const headers = {
      Cookie: cookie,
      Origin: g.endpoint,
      "Content-Type": "application/json",
      "X-Cadence-CSRF": state.csrf,
      "X-Cadence-Build": JSON.stringify({
        kind: "browser",
        sourceHash: m.sourceHash,
        contractHash: m.contractHash,
        buildId: m.buildId,
      }),
    };
    const post = async (route: string, value: object, override = {}) => {
      const response = await fetch(`${g.endpoint}/workbench/v1/${route}`, {
        method: "POST",
        headers: { ...headers, ...override },
        body: JSON.stringify({ epoch: state.epoch, ...value }),
      });
      return { status: response.status, body: (await response.json()) as any };
    };
    const workspace = join(g.f.dir, "lazy-directory");
    mkdirSync(workspace);
    const selected = await post("select", { path: workspace });
    expect(selected.status).toBe(200);
    const project = decodeProjectEntry(selected.body.project);
    const c = new ServiceCoordination(project.path, g.f.c.stateHome);
    expect(project.epoch).toBeNull();
    expect(c.inspect().status).toBe("absent");
    expect(existsSync(c.directory)).toBe(false);
    expect(g.store.associatedProjects()).toEqual([]);
    const read = async (request: WorkbenchRead) =>
      (
        await fetch(
          `${g.endpoint}/projects/${project.id}${wireUrl("workbenchRead", request)}`,
          { headers: { Cookie: cookie } },
        )
      ).json();
    expect(
      await read({
        kind: "conversation",
        leaf: null,
        known: null,
        id: randomUUID(),
      }),
    ).toMatchObject({ kind: "ok", value: { summary: null, turns: 0 } });
    expect(
      await read({ kind: "cadence-conversation", id: randomUUID() }),
    ).toMatchObject({
      kind: "ok",
      value: { state: { enabled: false, revision: 0 } },
    });
    const observation = decodeProjectObservation(
      await (
        await fetch(`${g.endpoint}/workbench/v1/projects/${project.id}`, {
          headers: { Cookie: cookie },
        })
      ).json(),
    );
    expect(observation).toMatchObject({
      status: "not-started",
      epoch: null,
      workspaceId: null,
    });
    expect(existsSync(c.directory)).toBe(false);
    // Existing terminal history is readable even before this directory has an
    // owner registration. Reading neither starts an owner nor imports a copy.
    const native = seedPiSessions(
      sessionDirectory(workspace, join(g.f.dir, "agent")),
      workspace,
      1,
    );
    expect(
      await read({
        kind: "conversation",
        id: native.ids[0],
        leaf: null,
        known: null,
      }),
    ).toMatchObject({
      kind: "ok",
      value: { turns: 1, summary: { id: native.ids[0], origin: "terminal" } },
    });
    expect(existsSync(c.directory)).toBe(false);
    const prepare = { projectId: project.id, commandId: randomUUID() };
    for (const result of [
      await post("prepare-send", { ...prepare, text: "not a Send route" }),
      await post("prepare-send", { ...prepare, epoch: randomUUID() }),
      await post("prepare-send", prepare, { "X-Cadence-CSRF": randomUUID() }),
      await post("prepare-send", prepare, { "X-Cadence-Local": "injected" }),
    ])
      expect(result.status).not.toBe(200);
    expect(existsSync(c.directory)).toBe(false);
    expect(g.f.contacts()).toBe(0);
    const [first, concurrent] = await Promise.all([
      post("prepare-send", prepare, { "X-Cadence-Build": "null" }),
      post("prepare-send", prepare, { "X-Cadence-Build": "older-build" }),
    ]);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(concurrent).toEqual(first);
    const ready = decodeProjectEntry(first.body.project);
    expect(ready.epoch).toBe(c.localAccess().epoch);
    expect(g.store.associatedProjects()).toEqual([ready]);
    expect(await post("prepare-send", prepare)).toEqual(first);
    const receipts = readdirSync(g.store.path("commands"));
    expect(
      (await post("prepare-send", { ...prepare, commandId: randomUUID() }))
        .body,
    ).toEqual(first.body);
    expect(readdirSync(g.store.path("commands"))).toEqual(receipts); // warm Send is not a lifetime receipt quota
    expect(existsSync(join(c.directory, "conversations-v1", "sessions"))).toBe(
      false,
    );
    expect(g.f.contacts()).toBe(0);
    // Selecting an independently running owner never adopts its Stop lifetime.
    const unrelated = await post("select", { path: g.f.root });
    const other = decodeProjectEntry(unrelated.body.project);
    expect(other.epoch).toBeNull();
    const response = await fetch(
      `${g.endpoint}/projects/${other.id}${wireUrl("workbenchRead", { kind: "conversations" })}`,
      { headers: { Cookie: cookie } },
    );
    expect(response.ok).toBe(true);
    expect(g.store.projects().find((p) => p.id === other.id)?.epoch).toBeNull();
    expect(g.store.associatedProjects()).toEqual([ready]);
    expect(
      (await post("prepare-send", { ...prepare, projectId: other.id })).body
        .error.code,
    ).toBe("conflict");
  } finally {
    await g.close();
  }
}, 30000);
