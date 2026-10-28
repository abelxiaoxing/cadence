import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { nativeCall, stopService } from "../src/service/cli.ts";
import { closed as objectFields } from "../src/service/contracts/core.ts";
import {
  decodeProjectEntry,
  decodeWorkbenchEntry,
} from "../src/service/contracts/gateway.ts";
import { loadWebAssets } from "../src/service-assets.ts";
import { ServiceClient } from "../src/service-client.ts";
import { HttpServiceTransport } from "../src/service-http-client.ts";
import { gatewayFixture } from "./helpers/gateway-fixture.ts";

it("one generated workbench opens two independent projects on one origin without a default workspace, native authority or replay", async () => {
  const g = await gatewayFixture();
  const { f, store, home, closed } = g;
  const transports: HttpServiceTransport[] = [];
  try {
    expect(existsSync(join(home, "cadence"))).toBe(false);
    expect(store.projects()).toEqual([]);
    const endpoint = store.localAccess().endpoint;
    const link = (await nativeCall(store, "token-link", true)) as {
      link: string;
    };
    const bootstrap = await fetch(link.link, { redirect: "manual" });
    const cookie = bootstrap.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw Error("bootstrap missing");
    const headers: Record<string, string> = {
      Cookie: cookie,
      Origin: endpoint,
    };
    const entry = decodeWorkbenchEntry(
      await (await fetch(`${endpoint}/workbench/v1`, { headers })).json(),
    );
    expect(entry.projects).toEqual([]);
    const manifest = loadWebAssets().manifest;
    const build = {
      kind: "browser" as const,
      sourceHash: manifest.sourceHash,
      contractHash: manifest.contractHash,
      buildId: manifest.buildId,
    };
    const mutationHeaders: Record<string, string> = {
      ...headers,
      "Content-Type": "application/json",
      "X-Cadence-CSRF": entry.csrf,
      "X-Cadence-Build": JSON.stringify(build),
    };
    const paths = [join(f.dir, "project-b"), join(f.dir, "project-c")];
    for (const path of paths) mkdirSync(path, { mode: 0o700 });
    const command = {
      commandId: randomUUID(),
      path: paths[0],
      epoch: entry.epoch,
    };
    const post = (value: unknown, h = mutationHeaders) =>
      fetch(`${endpoint}/workbench/v1/open`, {
        method: "POST",
        headers: h,
        body: JSON.stringify(value),
      });
    expect(
      (
        await post(command, {
          ...mutationHeaders,
          Origin: "http://evil.invalid",
        })
      ).status,
    ).toBe(403);
    expect(
      (await post(command, { ...mutationHeaders, "X-Cadence-CSRF": "wrong" }))
        .status,
    ).toBe(403);
    expect(store.projects()).toEqual([]);
    expect(f.contacts()).toBe(0);
    const projectReply = (value: unknown) => {
      const o = objectFields(value, ["kind", "project"]);
      return { kind: o.kind, project: decodeProjectEntry(o.project) };
    };
    const first = projectReply(await (await post(command)).json());
    expect(first.kind, JSON.stringify(first)).toBe("project");
    expect(await (await post(command)).json()).toEqual(first);
    const second = projectReply(
      await (
        await post({ ...command, commandId: randomUUID(), path: paths[1] })
      ).json(),
    );
    expect(second.kind, JSON.stringify(second)).toBe("project");
    expect(store.projects()).toHaveLength(2);
    expect(first.project.id).not.toBe(second.project.id);
    expect(f.contacts()).toBe(0);
    const make = (project: string) => {
      const transport = new HttpServiceTransport({
        origin: endpoint,
        project,
        build,
        fetch: (url, options) =>
          fetch(url, {
            ...options,
            headers: { ...options?.headers, ...headers },
          }),
      });
      const client = new ServiceClient(transport);
      transports.push(transport);
      return client;
    };
    const a = make(first.project.id),
      b = make(second.project.id);
    const session = await a.session();
    expect(session.kind).toBe("ok");
    if (session.kind === "ok") expect(session.value.authority).toBe("browser");
    expect((await b.session()).kind).toBe("ok");
    // Only the workbench's own Open route may associate owners. Relaying the
    // legacy navigation command would expose a backend token and let new owners
    // escape whole-workbench Stop accounting.
    expect(
      await a.workbenchCommand({
        kind: "open-project",
        commandId: randomUUID(),
        epoch: first.project.epoch,
        path: paths[1],
      }),
    ).toMatchObject({
      kind: "error",
      error: { code: "forbidden", effect: "none" },
    });
    expect(store.projects()).toHaveLength(2);
    const catalog = await a.models();
    if (catalog.kind !== "ok") throw Error(JSON.stringify(catalog));
    const selected = await a.chooseModel({
      expected: catalog.value.version,
      choice: {
        provider: "fixture",
        model: "fixed",
        api: "openai-completions",
        thinking: "off",
      },
    });
    if (selected.kind !== "ok") throw Error(JSON.stringify(selected));
    f.mode("pending");
    const send = {
      kind: "send" as const,
      commandId: randomUUID(),
      conversationId: randomUUID(),
      head: null,
      text: "Keep running in B while C is observed",
      model: selected.value.version,
    };
    expect((await a.workbenchCommand(send)).kind).toBe("ok");
    await expect.poll(f.contacts, { timeout: 15000, interval: 50 }).toBe(1);
    expect(await b.workbenchRead({ kind: "conversations" })).toMatchObject({
      kind: "ok",
      value: { entries: [] },
    });
    expect(
      await a.workbenchRead({
        kind: "conversation",
        id: send.conversationId,
        before: null,
      }),
    ).toMatchObject({ kind: "ok", value: { summary: { status: "running" } } });
    expect(
      (
        await fetch(
          `${endpoint}/projects/${first.project.id}/local/v1/admin/stop`,
          { method: "POST", headers: mutationHeaders, body: "{}" },
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(`${endpoint}/projects/${first.project.id}/api/v1/session`, {
          headers: {
            ...headers,
            "X-Cadence-Local": store.localAccess().capability,
          },
        })
      ).status,
    ).toBe(403);
    await nativeCall(store, "token-rotate");
    expect((await fetch(`${endpoint}/workbench/v1`, { headers })).status).toBe(
      401,
    );
    const rotated = (await nativeCall(store, "token-link", true)) as {
      link: string;
    };
    const entered = await fetch(rotated.link, { redirect: "manual" });
    headers.Cookie = entered.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(await a.session()).toMatchObject({
      kind: "error",
      error: { code: "stale" },
    });
    const fresh = make(first.project.id);
    expect((await fresh.session()).kind).toBe("ok");
    expect(
      await fresh.workbenchRead({
        kind: "conversation",
        id: send.conversationId,
        before: null,
      }),
    ).toMatchObject({ kind: "ok", value: { summary: { status: "running" } } });
    expect(f.contacts()).toBe(1);
    for (const transport of transports) await transport.detach();
    expect((await stopService(store)).status).toBe("stopped");
    expect(await closed).toEqual([0, null]);
    expect(existsSync(join(home, "cadence"))).toBe(false);
    // Whole-workbench Stop joined the original child, not an empty UI roster.
    const records = store.projects();
    expect(records).toHaveLength(2);
    expect(
      readFileSync(
        join(f.dir, "project-b", "..", "project", "existing.txt"),
        "utf8",
      ),
    ).toContain("preserved");
  } finally {
    await g.close();
  }
}, 60000);
