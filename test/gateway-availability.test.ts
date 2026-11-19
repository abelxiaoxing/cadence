// In-process gateway and a controlled HTTP owner. No SDK, worker or real service manager.
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { HistoryFiles, HistoryReadBudget } from "../src/history/files.ts";
import { listPreparation } from "../src/history/list-progress.ts";
import { HistoryReadProof } from "../src/history/read-proof.ts";
import { HistoryWriter } from "../src/history/writer.ts";
import { AccessMaterial, HttpAuthentication } from "../src/service/auth.ts";
import {
  decodeProjectEntry,
  decodeProjectObservation,
} from "../src/service/contracts/gateway.ts";
import {
  decodeProjectAssociation,
  PROJECT_ASSOCIATION_HEADER,
} from "../src/service/contracts/workbench.ts";
import { ServiceCoordination } from "../src/service/coordination.ts";
import { createGateway } from "../src/service/gateway.ts";
import { ServiceHttpServer } from "../src/service/http.ts";
import { hash } from "../src/service/private-files.ts";
import { ServiceClient } from "../src/service-client.ts";
import {
  decodeListRequest,
  decodeReply,
  decodeSessionBootstrap,
  type ListRequest,
  publicError,
} from "../src/service-contract.ts";
import { HttpServiceTransport } from "../src/service-http-client.ts";
import { HISTORY_CSRF_HEADER } from "../src/service-wire.ts";
import { historyFixtureContext } from "./helpers/history-fixture.ts";
import { readProjection } from "./helpers/history-read-fixture.ts";
import { coverage, deferred, request } from "./helpers/service-http-fixture.ts";
import { sourceBuild } from "./helpers/source-build.ts";

// This gateway is not supervised, even when the test runner itself is. No
// cgroup inspection or service-manager lookup is part of the HTTP fixture.
vi.mock("../src/service/maintenance.ts", async (original) => ({
  ...(await original<typeof import("../src/service/maintenance.ts")>()),
  supervisingUnit: () => undefined,
}));

async function startGateway(dir: string, stateHome: string, agentDir: string) {
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
  return createGateway(
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
}
async function selectProject(
  gateway: Awaited<ReturnType<typeof createGateway>>,
  project: string,
) {
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
  const selected = decodeProjectEntry(JSON.parse(select.text).project);
  return { selected, headers, entry };
}

it("separates owner liveness from session association and recovers a failed same-epoch binding without preparing work", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gateway-availability-"));
  const stateHome = join(dir, "state"),
    agentDir = join(dir, "agent"),
    project = join(dir, "project");
  for (const path of [stateHome, agentDir, project])
    mkdirSync(path, { mode: 0o700 });
  const c = new ServiceCoordination(project, stateHome);
  let capability = "",
    epoch = "",
    statusAvailable = true,
    bootstraps = 0;
  const allocations = new Set<string>();
  const taskId = randomUUID();
  const forwarded: string[] = [];
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
      return statusAvailable
        ? reply({ kind: "ok", value: { status: "alive", epoch } })
        : reply({ kind: "error" }, 503);
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
    const target = new URL(req.url ?? "/", endpoint);
    forwarded.push(`${req.method} ${target.pathname}`);
    if (target.pathname === "/api/v1/workspace") {
      expect(req.headers["x-cadence-attachment"]).toBeUndefined();
      return reply({
        kind: "ok",
        value: {
          storeId,
          workspaceId,
          epoch,
          rootLabel: project,
          models: [],
          committedSeq: "12",
          context: {
            status: "unavailable",
            workspaceId,
            taskId: null,
            error: publicError("unavailable"),
          },
        },
      });
    }
    if (target.pathname === "/api/v1/tasks") {
      const request = decodeListRequest(
        JSON.parse(target.searchParams.get("request") ?? "null"),
      );
      expect(request).toMatchObject({
        reader: "tasks",
        storeId,
        scope: { kind: "workspace", id: workspaceId },
        snapshotSeq: "12",
      });
      expect(req.headers["x-cadence-attachment"]).toBeUndefined();
      return reply({
        kind: "ok",
        value: {
          request,
          coverage,
          next: null,
          records: [
            {
              kind: "task",
              version: 1,
              owner: {
                taskId,
                runId: null,
                childRunId: null,
                entity: { kind: "task", id: taskId, version: 1 },
              },
              goal: "Independent owner retained task",
              plan: null,
            },
          ],
        },
      });
    }
    if (req.url === "/api/v1/session") {
      const id = String(req.headers["x-cadence-attachment"]);
      allocations.add(id);
      res.setHeader("X-Cadence-Attachment", id);
      return reply({
        kind: "ok",
        value: {
          protocol: 1,
          storeId,
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
  const upgrade = vi.fn((_req, socket) => socket.destroy());
  owner.on("upgrade", upgrade);
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
  const { workspaceId, storeId } = HistoryFiles.initialize(lease).format;
  ({ capability, epoch } = c.localAccess());
  let gateway: Awaited<ReturnType<typeof createGateway>> | undefined;
  try {
    gateway = await startGateway(dir, stateHome, agentDir);
    const { selected, headers, entry } = await selectProject(gateway, project);
    expect(selected.epoch).toBeNull();
    expect(gateway.store.associatedProjects()).toEqual([]);
    const projectPath = `/workbench/v1/projects/${selected.id}`;
    const observe = async () => {
      const response = await request(gateway!.endpoint, projectPath, {
        headers,
      });
      expect(response.status).toBe(200);
      return {
        ...decodeProjectObservation(JSON.parse(response.text)),
        association: decodeProjectAssociation(
          response.headers[PROJECT_ASSOCIATION_HEADER],
        ),
      };
    };
    const denied = await request(gateway.endpoint, projectPath);
    expect(denied.status).toBe(401);
    expect(denied.headers[PROJECT_ASSOCIATION_HEADER]).toBeUndefined();
    const attachment = randomUUID();
    const session = () =>
      request(gateway!.endpoint, `/projects/${selected.id}/api/v1/session`, {
        headers: { ...headers, "X-Cadence-Attachment": attachment },
      });
    expect(await observe()).toMatchObject({
      status: "running",
      epoch,
      workspaceId,
      association: "unassociated",
    });
    const refused = await session();
    expect(refused.status).not.toBe(200);
    expect(JSON.parse(refused.text)).toMatchObject({
      kind: "error",
      error: { code: "unavailable", effect: "none" },
    });
    expect(allocations.size).toBe(0);
    expect(bootstraps).toBe(0);
    const readPath = `/projects/${selected.id}/api/v1/workbench/read?request=${encodeURIComponent(JSON.stringify({ kind: "conversations" }))}`;
    expect(
      (await request(gateway.endpoint, readPath, { headers })).status,
    ).not.toBe(200);
    // Same owner and epoch: the rejected bootstrap must not poison future reads.
    const history = await request(gateway.endpoint, readPath, { headers });
    expect(history.status).toBe(200);
    expect(JSON.parse(history.text)).toMatchObject({
      kind: "ok",
      value: { kind: "conversations" },
    });
    expect(bootstraps).toBe(2);
    // Real authenticated gateway routing and protocol decoders; the owner above
    // serves an injected page, not a claim about a production journal.
    const reads: string[] = [];
    const client = new ServiceClient(
      new HttpServiceTransport({
        origin: gateway.endpoint,
        project: selected.id,
        fetch(url, init) {
          reads.push(`${init?.method} ${new URL(String(url)).pathname}`);
          return fetch(url, {
            ...init,
            headers: { ...init?.headers, ...headers },
          });
        },
      }),
    );
    const workspace = await client.workspace();
    if (workspace.kind !== "ok") throw new Error(workspace.error.code);
    expect(workspace.value).toMatchObject({
      workspaceId,
      storeId,
      epoch,
      committedSeq: "12",
    });
    const page = await client.tasks({
      storeId: workspace.value.storeId,
      scope: { kind: "workspace", id: workspace.value.workspaceId },
      snapshotSeq: workspace.value.committedSeq,
      after: null,
      limit: 50,
    });
    expect(page).toMatchObject({
      kind: "ok",
      value: {
        records: [
          {
            kind: "task",
            owner: { taskId },
            goal: "Independent owner retained task",
          },
        ],
      },
    });
    expect(reads).toEqual(
      ["workspace", "tasks"].map(
        (p) => `GET /projects/${selected.id}/api/v1/${p}`,
      ),
    );
    expect(forwarded).toEqual([
      "GET /api/v1/workbench/read",
      "GET /api/v1/workspace",
      "GET /api/v1/tasks",
    ]);
    expect(upgrade).not.toHaveBeenCalled();
    expect(allocations.size).toBe(0);
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
    statusAvailable = false;
    expect(await observe()).toMatchObject({
      status: "unavailable",
      epoch: null,
      association: "associated",
    });
    statusAvailable = true;
    expect(await observe()).toMatchObject({
      status: "running",
      epoch,
      association: "associated",
    });
    expect(allocations.size).toBe(0);
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
    for (let n = 0; n < 3; n++) {
      const allocated = await session();
      expect(allocated.status).toBe(200);
      expect(allocated.headers["x-cadence-attachment"]).toBe(attachment);
      expect(
        decodeReply(JSON.parse(allocated.text), decodeSessionBootstrap),
      ).toMatchObject({
        kind: "ok",
        value: { authority: "browser", epoch, storeId },
      });
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

it("continues an unassociated owner's original history proofs, then retires only the project cookie actually refused", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gateway-history-"));
  const stateHome = join(dir, "state"),
    agentDir = join(dir, "agent"),
    project = join(dir, "project");
  for (const path of [stateHome, agentDir, project])
    mkdirSync(path, { mode: 0o700 });
  const owner = new ServiceHttpServer({
    policy: {
      schema: "cadence-service-http/1",
      host: "127.0.0.1",
      port: 0,
      proxy: null,
    },
  });
  const endpoint = await owner.listen();
  const c = new ServiceCoordination(project, stateHome);
  const lease = c.acquire(
    {
      schema: "cadence-service-owner-config/1",
      endpoint,
      policyIdentity: hash("fixture"),
    },
    endpoint,
    () => AccessMaterial.initialize(c.files, c.directory),
  );
  const files = HistoryFiles.initialize(lease),
    writer = new HistoryWriter(lease);
  const f = historyFixtureContext({
    dir,
    root: project,
    c,
    lease,
    files,
    writer,
  });
  const material = new AccessMaterial(c.files, c.directory);
  const { epoch, capability } = c.localAccess();
  const { storeId, workspaceId } = files.format;
  const auth = new HttpAuthentication(material, epoch, workspaceId, capability);
  const management = vi.fn((operation: string) => {
    if (operation === "token-link")
      return { link: material.tokenLink(endpoint) };
    throw Error(`unexpected management ${operation}`);
  });
  let gateway: Awaited<ReturnType<typeof createGateway>> | undefined;
  const held = deferred();
  try {
    // Fixture journal records, not service commands or a model launch.
    let controlRev = f.context.controlRev;
    for (const goal of ["first archived task", "second archived task"]) {
      const expected = { ...f.context, task: null, controlRev: controlRev++ };
      writer.supplyContext(expected);
      expect(
        (
          await writer.commit({
            ...f.intent,
            commandId: randomUUID(),
            operationId: randomUUID(),
            runId: null,
            createdTaskId: randomUUID(),
            identity: {
              kind: "action",
              expected,
              action: { kind: "create", taskKind: "research", goal },
            },
          })
        ).status,
      ).toBe("committed");
    }
    const projection = readProjection(f);
    const original = projection.tasks;
    // Deterministically enter the original bounded reader's proof-only branch;
    // every continuation is opened and read by the production projection.
    projection.tasks = (r) =>
      r.navigation
        ? original(r)
        : Promise.resolve(
            listPreparation(
              r,
              new HistoryReadProof(files).prepareCompletion(
                new HistoryReadBudget(),
              ),
            ),
          );
    projection.environment.session = () => ({
      protocol: 1,
      epoch,
      storeId,
      accessGeneration: material.generation,
      authority: "local",
      csrf: null,
      capabilities: { actions: true, history: true, manualChecks: false },
    });
    owner.configure({
      auth,
      adapters: { projection, receipts: null, live: null },
      management: { invoke: management },
    });
    owner.admit();
    gateway = await startGateway(dir, stateHome, agentDir);
    const { selected, headers } = await selectProject(gateway, project);
    const origin = gateway.endpoint,
      prefix = `/projects/${selected.id}`;
    const requests: string[] = [];
    let browserChallenge: string | null = null;
    const enter = () =>
      new ServiceClient(
        new HttpServiceTransport({
          origin,
          project: selected.id,
          retainedHistory: true,
          fetch: async (url, init) => {
            requests.push(`${init?.method} ${new URL(String(url)).pathname}`);
            expect(String(url)).not.toContain("navigation");
            const h = new Headers(init?.headers);
            expect(
              h.has("x-cadence-local") ||
                h.has("x-cadence-attachment") ||
                h.has("x-cadence-csrf"),
            ).toBe(false);
            if (init?.method === "POST") {
              expect(h.get(HISTORY_CSRF_HEADER)).toBe(browserChallenge);
              expect(JSON.parse(String(init.body)).navigation).toBeTruthy();
              h.set("Origin", origin); // Browser supplies this; this fixture is Node HTTP.
            }
            h.set("Cookie", headers.Cookie);
            const response = await fetch(url, { ...init, headers: h });
            if (response.ok && String(url).endsWith("/workspace"))
              browserChallenge = response.headers.get(HISTORY_CSRF_HEADER);
            return response;
          },
        }),
      );
    const client = enter();
    const workspace = await client.workspace();
    if (workspace.kind !== "ok") throw Error(workspace.error.code);
    expect(browserChallenge).toBeTruthy();
    const seed: ListRequest = {
      reader: "tasks",
      storeId,
      scope: { kind: "workspace", id: workspaceId },
      snapshotSeq: workspace.value.committedSeq,
      after: null,
      limit: 1,
    };
    const progress = await client.tasks(seed);
    if (
      progress.kind !== "ok" ||
      !("kind" in progress.value) ||
      progress.value.kind !== "progress"
    )
      throw Error("expected original proof-only navigation");
    expect(progress.value).not.toHaveProperty("records");
    const continuation = progress.value.next;
    for (const changed of [
      { ...continuation, scope: { ...seed.scope, id: randomUUID() } },
      { ...continuation, navigation: `${continuation.navigation}A` },
      { ...continuation, limit: 2 },
      { ...continuation, snapshotSeq: "0" },
    ])
      expect(await client.tasks(changed)).toMatchObject({
        kind: "error",
        error: { code: "corrupt-selected", effect: "none" },
      });
    expect(
      await client.tasks({ ...continuation, storeId: randomUUID() }),
    ).toMatchObject({
      kind: "error",
      error: { code: "stale", effect: "none" },
    });
    const goals: string[] = [];
    let next: ListRequest | null = continuation;
    for (let n = 0; next && n < 50; n++) {
      const reply = await client.tasks(next);
      if (reply.kind !== "ok") throw Error(reply.error.code);
      expect(reply.value.request).toEqual(next);
      if (!("kind" in reply.value)) {
        for (const r of reply.value.records)
          if (r.kind === "task") goals.push(r.goal);
        if (goals.length === 1)
          expect(reply.value.next?.navigation).toBeTruthy();
      }
      next = reply.value.next;
    }
    expect(next).toBeNull();
    expect(goals.sort()).toEqual([
      "first archived task",
      "second archived task",
    ]);
    expect(new Set(requests)).toEqual(
      new Set([
        `GET ${prefix}/api/v1/workspace`,
        `GET ${prefix}/api/v1/tasks`,
        `POST ${prefix}/api/v1/tasks`,
      ]),
    );
    expect(gateway.store.associatedProjects()).toEqual([]);
    const post = (path: string, extra: Record<string, string>, body = "null") =>
      request(origin, `${prefix}/api/v1/${path}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json", ...extra },
        body,
      });
    const challenge = { [HISTORY_CSRF_HEADER]: browserChallenge! };
    for (const [path, h] of [
      ["tasks", challenge],
      ["tasks", { ...challenge, Origin: "https://wrong.invalid" }],
      ["tasks", { [HISTORY_CSRF_HEADER]: randomUUID(), Origin: origin }],
      ["commands", { ...challenge, Origin: origin }],
      ["snapshot", { ...challenge, Origin: origin }],
    ] as const)
      expect((await post(path, h)).status).toBe(403);
    expect(management.mock.calls).toEqual([["token-link"]]);

    // Pre-existing association for the rotation case, never created by a read.
    gateway.store.saveProject({ ...selected, epoch });
    const session = await request(origin, `${prefix}/api/v1/session`, {
      headers,
    });
    expect(session.status).toBe(200);
    const allocation = String(session.headers["x-cadence-attachment"]);
    // The gateway admits this viewer, but its owner refuses the wrong CSRF.
    // A permission failure (unlike explicit cookie expiry) must not refresh credentials.
    expect(
      (
        await post(
          "snapshot",
          {
            "X-Cadence-Attachment": allocation,
            "X-Cadence-CSRF": randomUUID(),
            Origin: origin,
          },
          JSON.stringify({ kind: "task", id: randomUUID() }),
        )
      ).status,
    ).toBe(403);
    const admitted = deferred();
    const read = projection.workspace;
    projection.workspace = async () => {
      const result = await read();
      projection.workspace = read;
      admitted.resolve();
      await held.promise;
      return result;
    };
    const late = request(origin, `${prefix}/api/v1/workspace`, { headers });
    await admitted.promise;
    material.rotate(); // Exact same owner epoch, actual durable access generation change.
    const refused = await client.tasks(continuation);
    expect(refused).toMatchObject({
      kind: "error",
      error: { code: "unauthenticated" },
    });
    expect(management.mock.calls).toEqual([["token-link"]]); // No automatic credential refresh or replay.
    const oldHeaders = {
      "X-Cadence-Attachment": allocation,
      "X-Cadence-CSRF": JSON.parse(session.text).value.csrf,
      Origin: origin,
    };
    expect((await post("commands", oldHeaders)).status).toBe(401);
    expect(management.mock.calls).toHaveLength(1);
    const fresh = enter(); // Explicit new page; same valid gateway login.
    expect((await fresh.workspace()).kind).toBe("ok");
    expect(browserChallenge).not.toBe(challenge[HISTORY_CSRF_HEADER]);
    expect(
      (
        await post(
          "tasks",
          { ...challenge, Origin: origin },
          JSON.stringify(continuation),
        )
      ).status,
    ).toBe(403);
    expect((await post("commands", oldHeaders)).status).toBe(401);
    held.resolve();
    expect((await late).status).toBe(401);
    expect((await fresh.tasks(continuation)).kind).toBe("ok");
    expect(management.mock.calls).toEqual([["token-link"], ["token-link"]]);
  } finally {
    held.resolve();
    await owner.close();
    c.release(lease);
    if (gateway) {
      gateway.stop();
      await vi.waitFor(() =>
        expect(gateway!.store.inspect().status).toBe("stopped"),
      );
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
