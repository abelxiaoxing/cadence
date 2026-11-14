// In-process gateway and a controlled HTTP owner. No SDK, worker or real service manager.
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { ServiceCoordination } from "../src/service/coordination.ts";
import { createGateway } from "../src/service/gateway.ts";
import { hash } from "../src/service/private-files.ts";
import { request } from "./helpers/service-http-fixture.ts";
import { sourceBuild } from "./helpers/source-build.ts";

it("token-authenticated gateway ignores builds and recovers a failed same-epoch binding without preparing work", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gateway-availability-"));
  const stateHome = join(dir, "state"),
    agentDir = join(dir, "agent"),
    project = join(dir, "project");
  for (const path of [stateHome, agentDir, project])
    mkdirSync(path, { mode: 0o700 });
  const c = new ServiceCoordination(project, stateHome);
  let capability = "",
    epoch = "",
    bootstraps = 0;
  const allocations = new Set<string>();
  const owner = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    const reply = (value: unknown, status = 200) => {
      res.statusCode = status;
      res.end(JSON.stringify(value));
    };
    if (req.url === "/local/v1/admin/token-link") {
      expect(req.headers["x-cadence-local"]).toBe(capability);
      bootstraps++;
      return bootstraps === 1
        ? reply({ kind: "error" }, 503)
        : reply({ kind: "ok", value: { link: `${endpoint}/?token=fixture` } });
    }
    if (req.url === "/?token=fixture") {
      res.setHeader("Set-Cookie", "fixture-owner=authenticated; HttpOnly");
      return reply({}, 303);
    }
    if (req.url === "/local/v1/admin/status") {
      expect(req.headers["x-cadence-local"]).toBe(capability);
      return reply({ kind: "ok", value: { status: "alive", epoch } });
    }
    if (req.url === "/local/v1/admin/activity") {
      expect(req.headers["x-cadence-local"]).toBe(capability);
      return reply({
        kind: "ok",
        value: {
          kind: "owner-activity",
          complete: true,
          readerScope: hash("reader"),
          epoch,
          build: { ...sourceBuild, contractHash: "0".repeat(64) },
          activities: [],
        },
      });
    }
    expect(req.headers.cookie).toBe("fixture-owner=authenticated");
    expect(req.headers["x-cadence-local"]).toBeUndefined();
    if (req.url === "/api/v1/session") {
      const id = String(req.headers["x-cadence-attachment"]);
      allocations.add(id);
      res.setHeader("X-Cadence-Attachment", id);
      return reply({
        kind: "ok",
        value: {
          protocol: 1,
          storeId: randomUUID(),
          epoch,
          accessGeneration: 1,
          authority: "browser",
          csrf: randomUUID(),
          capabilities: { actions: true, history: true, manualChecks: false },
        },
      });
    }
    return reply({
      kind: "ok",
      value: { kind: "conversations", entries: [], next: null },
    });
  });
  owner.listen(0, "127.0.0.1");
  await once(owner, "listening");
  const address = owner.address();
  if (!address || typeof address === "string") throw Error("fixture address");
  const endpoint = `http://127.0.0.1:${address.port}`;
  const lease = c.acquire({
    schema: "cadence-service-owner-config/1",
    endpoint,
    policyIdentity: hash("fixture"),
  });
  ({ capability, epoch } = c.localAccess());
  // Reserve a gateway port only; no external service or CLI is launched.
  const reserve = createServer();
  reserve.listen(0, "127.0.0.1");
  await once(reserve, "listening");
  const gatewayAddress = reserve.address();
  if (!gatewayAddress || typeof gatewayAddress === "string")
    throw Error("fixture address");
  const port = gatewayAddress.port;
  await new Promise<void>((resolve) => reserve.close(() => resolve()));
  const serverConfig = join(dir, "server.env");
  writeFileSync(
    serverConfig,
    `CADENCE_PORT=${port}\nCADENCE_TOKEN=fixture-gateway-token\n`,
    { mode: 0o600 },
  );
  let gateway: Awaited<ReturnType<typeof createGateway>> | undefined;
  try {
    gateway = await createGateway(
      {
        kind: "workbench",
        serverConfig,
        stateHome,
        agentDir,
        policy: {
          schema: "cadence-service-http/1",
          host: "127.0.0.1",
          port,
          proxy: null,
        },
      },
      new URL("../src/service-host.mjs", import.meta.url),
      { contractHash: sourceBuild.contractHash },
    );
    const entered = await request(
      gateway.endpoint,
      "/?token=fixture-gateway-token",
    );
    const cookie = String(entered.headers["set-cookie"]?.[0]).split(";")[0];
    const headers = { Cookie: cookie };
    const entry = JSON.parse(
      (await request(gateway.endpoint, "/workbench/v1", { headers })).text,
    );
    const select = await request(gateway.endpoint, "/workbench/v1/select", {
      method: "POST",
      headers: {
        ...headers,
        Origin: gateway.endpoint,
        "Content-Type": "application/json",
        "X-Cadence-CSRF": entry.csrf,
      },
      body: JSON.stringify({ path: project, epoch: entry.epoch }),
    });
    expect(select.status).toBe(200);
    const selected = JSON.parse(select.text).project;
    expect(selected.epoch).toBeNull();
    expect(gateway.store.associatedProjects()).toEqual([]);
    const readPath = `/projects/${selected.id}/api/v1/workbench/read?request=${encodeURIComponent(JSON.stringify({ kind: "conversations" }))}`;
    expect(
      (await request(gateway.endpoint, readPath, { headers })).status,
    ).not.toBe(200);
    // Same owner and epoch: the rejected bootstrap must not poison future reads.
    expect(
      (await request(gateway.endpoint, readPath, { headers })).status,
    ).toBe(200);
    expect(bootstraps).toBe(2);
    const builds: Record<string, string>[] = [
      {},
      { "X-Cadence-Build": "outdated-or-unbuilt" },
    ];
    for (const extra of builds) {
      const active = await request(gateway.endpoint, "/workbench/v1/activity", {
        headers: { ...headers, ...extra },
      });
      expect(active.status).toBe(200);
      expect(JSON.parse(active.text).completeness).toBe("complete");
    }
    expect(
      (await request(gateway.endpoint, "/workbench/v1/activity")).status,
    ).toBe(401);
    expect(gateway.store.associatedProjects()).toEqual([]);
    // Fixture association only: simulate a previously prepared owner, no Send.
    gateway.store.saveProject({ ...selected, epoch });
    const prepare = async (route: string, location?: object, extra = {}) =>
      request(gateway!.endpoint, `/workbench/v1/${route}`, {
        method: "POST",
        headers: {
          ...headers,
          Origin: gateway!.endpoint,
          "Content-Type": "application/json",
          "X-Cadence-CSRF": entry.csrf,
        },
        body: JSON.stringify({
          location,
          ...extra,
          projectId: selected.id,
          commandId: randomUUID(),
          epoch: entry.epoch,
        }),
      });
    // Named preparation routes: warm validation reuses the exact owner,
    // without a model, message, approval or native execution capability.
    const prepared = await prepare("prepare-plan", {
      id: randomUUID(),
      cwd: project,
    });
    expect(prepared.status, prepared.text).toBe(200);
    expect(JSON.parse(prepared.text).project).toEqual({ ...selected, epoch });
    expect(
      (await prepare("approve", { id: randomUUID(), cwd: project })).status,
    ).toBe(400);
    expect((await prepare("prepare-plan")).status).toBe(400);
    expect(
      (
        await prepare(
          "prepare-plan",
          { id: randomUUID(), cwd: project },
          { grant: randomUUID() },
        )
      ).status,
    ).toBe(400);
    const attachment = randomUUID();
    const sessionPath = `/projects/${selected.id}/api/v1/session`;
    for (let n = 0; n < 3; n++) {
      expect(
        (
          await request(gateway.endpoint, sessionPath, {
            headers: { ...headers, "X-Cadence-Attachment": attachment },
          })
        ).status,
      ).toBe(200);
    }
    expect([...allocations]).toEqual([attachment]);
    expect(bootstraps).toBe(3); // explicit preparation retires the prior routing binding
  } finally {
    c.release(lease);
    if (gateway) {
      gateway.stop();
      await vi.waitFor(() =>
        expect(gateway!.store.inspect().status).toBe("stopped"),
      );
    }
    await new Promise<void>((resolve) => owner.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
