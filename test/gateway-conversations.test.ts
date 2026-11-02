import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { stopService } from "../src/service/cli.ts";
import {
  decodeProjectEntry,
  decodeProjectObservation,
} from "../src/service/contracts/gateway.ts";
import {
  decodeWorkbenchResult,
  type WorkbenchRead,
} from "../src/service/contracts/workbench.ts";
import { ServiceCoordination } from "../src/service/coordination.ts";
import { GatewayConversations } from "../src/service/gateway-conversations.ts";
import { loadWebAssets } from "../src/service-assets.ts";
import { wireUrl } from "../src/service-wire.ts";
import { gatewayFixture } from "./helpers/gateway-fixture.ts";
import { seedConversations } from "./helpers/retained-conversations.ts";

/** Hash fixture bytes and names, not access times. Reads must not publish,
 * repair, migrate or recreate any private state (secrets never enter output). */
function tree(path: string): string {
  const digest = createHash("sha256");
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const name = join(directory, entry.name);
      digest.update(name);
      if (entry.isDirectory()) visit(name);
      else digest.update(readFileSync(name));
    }
  };
  visit(path);
  return digest.digest("hex");
}
it("stopped-owner history and mode use the same readers, retain exact bytes and never acquire execution authority", async () => {
  const g = await gatewayFixture();
  try {
    const entered = await fetch(g.link, { redirect: "manual" });
    const headers = {
      Cookie: entered.headers.get("set-cookie")!.split(";")[0],
      Origin: g.endpoint,
    };
    const state = (await (
      await fetch(`${g.endpoint}/workbench/v1`, { headers })
    ).json()) as { epoch: string; csrf: string };
    const manifest = loadWebAssets().manifest;
    const workspace = join(g.f.dir, "retained-folder");
    mkdirSync(workspace, { mode: 0o700 });
    const requestProject = async (route: string, value: object) => {
      const response = await fetch(`${g.endpoint}/workbench/v1/${route}`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "X-Cadence-CSRF": state.csrf,
          "X-Cadence-Build": JSON.stringify({
            kind: "browser",
            sourceHash: manifest.sourceHash,
            contractHash: manifest.contractHash,
            buildId: manifest.buildId,
          }),
        },
        body: JSON.stringify({ ...value, epoch: state.epoch }),
      });
      const reply = (await response.json()) as { project: unknown };
      expect(response.ok, JSON.stringify(reply)).toBe(true);
      return decodeProjectEntry(reply.project);
    };
    const open = async () => {
      const selected = await requestProject("select", { path: workspace });
      return requestProject("prepare-send", {
        projectId: selected.id,
        commandId: randomUUID(),
      });
    };
    const project = await open();
    const c = new ServiceCoordination(project.path, g.f.c.stateHome);
    const model = {
      epoch: project.epoch!,
      accessGeneration: 1,
      configRev: 1,
      catalogId: randomUUID(),
    };
    const seed = seedConversations(c, project.cwd, model, 12, 2);
    const id = seed.ids[0];
    const turnPath = join(
      c.directory,
      "conversations-v1",
      "turns",
      seed.longHead,
      "turn.json",
    );
    const turn = JSON.parse(readFileSync(turnPath, "utf8"));
    c.files.create(
      join(
        c.directory,
        "conversations-v1",
        "turns",
        seed.longHead,
        "transcript",
        "0.json",
      ),
      JSON.stringify({ turnId: seed.longHead, page: 0, items: turn.items }),
    );
    writeFileSync(
      turnPath,
      JSON.stringify({ ...turn, items: [], transcript: { pages: 1 } }),
    );
    c.files.create(
      join(c.directory, "conversations-v1", "control-links", `${id}.json`),
      JSON.stringify({
        schema: "cadence-conversation-control/1",
        conversationId: id,
      }),
    );
    const controlPath = join(
      c.directory,
      "conversation-workflows-v1",
      id,
      "state.json",
    );
    c.files.create(
      controlPath,
      JSON.stringify({
        schema: "cadence-conversation-workflow/1",
        state: {
          id,
          revision: 1,
          enabled: true,
          head: seed.longHead,
          proposal: null,
          runs: [],
        },
      }),
    );
    const path = (request: WorkbenchRead) =>
      `${g.endpoint}/projects/${project.id}${wireUrl("workbenchRead", request)}`;
    const read = async (request: WorkbenchRead, extra = {}) => {
      const response = await fetch(path(request), {
        headers: { ...headers, ...extra },
      });
      const reply = (await response.json()) as { kind: string; value: unknown };
      expect(response.ok, JSON.stringify(reply)).toBe(true);
      expect(reply.kind).toBe("ok");
      return decodeWorkbenchResult(reply.value);
    };
    const observe = async () =>
      decodeProjectObservation(
        await (
          await fetch(`${g.endpoint}/workbench/v1/projects/${project.id}`, {
            headers,
          })
        ).json(),
      );
    const before = await observe();
    expect(before.status).toBe("running");
    expect((await read({ kind: "conversation", id })).kind).toBe(
      "conversation",
    );
    expect((await stopService(c)).status).toBe("stopped");
    await expect
      .poll(() =>
        existsSync(
          join(c.files.namespace, "process-ledger-v1", `${project.epoch}.json`),
        ),
      )
      .toBe(false);
    const snapshot = tree(c.files.namespace);
    expect(await observe()).toEqual({ ...before, status: "stopped" });
    let scan: string | undefined;
    let listed: string[] = [];
    for (let n = 0; n < 10; n++) {
      const page = await read({
        kind: "conversations",
        ...(scan ? { scan } : {}),
      });
      if (page.kind === "conversations-progress") {
        scan = page.scan;
        continue;
      }
      if (page.kind !== "conversations") throw Error("listing");
      listed = page.entries.map((row) => row.id);
      expect(page.entries.find((row) => row.id === id)?.cadence).toBe(true);
      break;
    }
    expect(listed.sort()).toEqual([...seed.ids].sort());
    expect(
      await read(
        { kind: "conversation", id },
        { "X-Cadence-Attachment": randomUUID() },
      ),
    ).toMatchObject({
      kind: "conversation",
      turns: 2,
      summary: { status: "completed", head: seed.longHead },
    });
    expect(
      await read({ kind: "conversation-turn", id, ordinal: 1, before: null }),
    ).toMatchObject({
      kind: "conversation-turn",
      turn: { id: seed.longHead, status: "completed" },
      steps: [{ text: "Saved reply 0" }],
    });
    expect(
      await read({
        kind: "conversation-step",
        id,
        turnId: seed.longHead,
        step: 0,
        part: 0,
      }),
    ).toMatchObject({
      kind: "conversation-step",
      item: { text: "Saved reply 0" },
    });
    expect(await read({ kind: "cadence-conversation", id })).toMatchObject({
      state: { enabled: true, revision: 1 },
    });
    expect((await fetch(path({ kind: "conversation", id }))).status).toBe(401);
    expect(
      (
        await fetch(path({ kind: "conversation", id }), {
          headers: { ...headers, "X-Cadence-Local": "injected" },
        })
      ).status,
    ).toBe(403);
    const mutation = await fetch(
      `${g.endpoint}/projects/${project.id}/api/v1/workbench/command`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: "{}",
      },
    );
    expect(mutation.ok).toBe(false);
    expect(c.inspect().status).toBe("stopped");
    expect(tree(c.files.namespace)).toBe(snapshot);
    expect(g.f.contacts()).toBe(0);

    // A cold reader must never substitute an empty live map for an uncertain owner.
    const cold = new GatewayConversations(c.stateHome);
    expect(cold.read(project, { kind: "conversation", id })).toMatchObject({
      kind: "conversation",
    });
    const inspect = vi
      .spyOn(ServiceCoordination.prototype, "inspect")
      .mockReturnValue({ status: "unavailable" });
    try {
      expect(cold.read(project, { kind: "conversation", id })).toBeUndefined();
    } finally {
      inspect.mockRestore();
      cold.close();
    }

    // A damaged control is projected as degraded, not ordinary editing, and no
    // read repairs its bytes. Other conversations remain independently readable.
    writeFileSync(controlPath, "{half-written");
    const damaged = tree(c.files.namespace);
    expect(await read({ kind: "cadence-conversation", id })).toMatchObject({
      state: { enabled: true, notice: expect.any(String) },
    });
    expect(await read({ kind: "conversation", id: seed.ids[1] })).toMatchObject(
      { summary: { status: "completed" } },
    );
    expect(tree(c.files.namespace)).toBe(damaged);
    // Restore only this deliberately corrupted fixture before explicit Open.
    writeFileSync(
      controlPath,
      JSON.stringify({
        schema: "cadence-conversation-workflow/1",
        state: {
          id,
          revision: 1,
          enabled: true,
          head: seed.longHead,
          proposal: null,
          runs: [],
        },
      }),
    );
    const reopened = await open();
    expect(reopened.epoch).not.toBe(project.epoch);
    expect((await observe()).status).toBe("running");
    expect(await read({ kind: "conversation", id })).toMatchObject({
      turns: 2,
      summary: { status: "completed" },
    });
    expect(g.f.contacts()).toBe(0);
  } finally {
    await g.close();
  }
}, 30000);
