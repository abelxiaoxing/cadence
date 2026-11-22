// Fast unit tests for gateway preparation concurrency (4B), failure eviction (C1),
// and live-holder registry backoff. Controlled openProjectDirectory; no spawned hosts.
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HistoryFiles } from "../src/history/files.ts";
import { decodeProjectEntry } from "../src/service/contracts/gateway.ts";
import {
  ServiceCoordination,
  waitForRegistry,
} from "../src/service/coordination.ts";
import { createGateway } from "../src/service/gateway.ts";
import { selfMark } from "../src/service/liveness.ts";
import { encoded, hash } from "../src/service/private-files.ts";
import { ContractError } from "../src/service-contract.ts";
import { deferred, request } from "./helpers/service-http-fixture.ts";
import { sourceBuild } from "./helpers/source-build.ts";

type OpenProjectHandler = (
  workspace: string,
  stateHome: string,
  agentDir: string,
  hostUrl: URL,
) => Promise<{ path: string; link: string }>;

const openProjectMock = vi.hoisted(() => ({
  fn: undefined as OpenProjectHandler | undefined,
}));

vi.mock("../src/service/maintenance.ts", async (original) => ({
  ...(await original<typeof import("../src/service/maintenance.ts")>()),
  supervisingUnit: () => undefined,
}));

vi.mock("../src/service/cli.ts", async (original) => {
  const actual = await original<typeof import("../src/service/cli.ts")>();
  return {
    ...actual,
    openProjectDirectory: (
      workspace: string,
      stateHome: string,
      agentDir: string,
      hostUrl: URL,
    ) => {
      if (!openProjectMock.fn)
        return actual.openProjectDirectory(
          workspace,
          stateHome,
          agentDir,
          hostUrl,
        );
      return openProjectMock.fn(workspace, stateHome, agentDir, hostUrl);
    },
  };
});

afterEach(() => {
  openProjectMock.fn = undefined;
});

interface FakeOwner {
  c: ServiceCoordination;
  lease: ReturnType<ServiceCoordination["acquire"]>;
  server: Server;
  endpoint: string;
  epoch: string;
  close(): Promise<void>;
}

async function startFakeOwner(
  projectPath: string,
  stateHome: string,
): Promise<FakeOwner> {
  const c = new ServiceCoordination(projectPath, stateHome);
  let capability = "";
  let epoch = "";
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (
      req.url === "/local/v1/admin/status" &&
      req.headers["x-cadence-local"] === capability
    ) {
      res.end(
        JSON.stringify({ kind: "ok", value: { status: "alive", epoch } }),
      );
      return;
    }
    if (
      req.url === "/local/v1/admin/stop" &&
      req.headers["x-cadence-local"] === capability
    ) {
      res.end(
        JSON.stringify({ kind: "ok", value: { status: "accepted", epoch } }),
      );
      setImmediate(() => {
        try {
          c.release(lease);
        } catch {
          /* already released */
        }
      });
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("owner address");
  const endpoint = `http://127.0.0.1:${address.port}`;
  const lease = c.acquire({
    schema: "cadence-service-owner-config/1",
    endpoint,
    policyIdentity: hash(`fake-owner-${projectPath}`),
  });
  HistoryFiles.initialize(lease);
  ({ capability, epoch } = c.localAccess());
  return {
    c,
    lease,
    server,
    endpoint,
    epoch,
    async close() {
      try {
        c.release(lease);
      } catch {
        /* already released */
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function startGateway(dir: string, stateHome: string, agentDir: string) {
  const reserve = createServer();
  reserve.listen(0, "127.0.0.1");
  await once(reserve, "listening");
  const address = reserve.address();
  if (!address || typeof address === "string") throw Error("gateway address");
  const port = address.port;
  await new Promise<void>((resolve) => reserve.close(() => resolve()));
  const serverConfig = join(dir, "server.env");
  writeFileSync(
    serverConfig,
    `CADENCE_PORT=${port}\nCADENCE_TOKEN=fixture-gateway-token\n`,
    { mode: 0o600 },
  );
  const gateway = await createGateway(
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
  ) as { epoch: string; csrf: string };
  const post = (route: string, body: object) =>
    request(gateway.endpoint, `/workbench/v1/${route}`, {
      method: "POST",
      headers: {
        ...headers,
        Origin: gateway.endpoint,
        "Content-Type": "application/json",
        "X-Cadence-CSRF": entry.csrf,
      },
      body: JSON.stringify({ epoch: entry.epoch, ...body }),
    });
  const select = async (path: string) => {
    const res = await post("select", { path });
    expect(res.status, res.text).toBe(200);
    return decodeProjectEntry(JSON.parse(res.text).project);
  };
  return { gateway, entry, post, select };
}

it("waitForRegistry backs off while a live holder owns registry.lock, never breaks a live lock, and fails fast on a dead lock", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wait-registry-"));
  const root = join(dir, "project"),
    state = join(dir, "state");
  mkdirSync(root);
  mkdirSync(state, { mode: 0o700 });
  const c = new ServiceCoordination(root, state);
  const lockPath = join(c.registryDirectory, "registry.lock");
  c.files.directory(c.registryDirectory, true);
  try {
    // 1. Live holder releases after 40ms -> succeeds cleanly.
    const liveMark = selfMark();
    const liveLock = c.files.create(
      lockPath,
      encoded({
        schema: "cadence-service-registry-lock/1",
        token: randomUUID(),
        pid: process.pid,
        host: hostname(),
        boot: liveMark.boot,
        started: liveMark.started,
      }),
    );
    let attempts = 0;
    setTimeout(() => c.files.remove(lockPath, liveLock), 40);
    const result = await waitForRegistry(
      c,
      () => {
        attempts++;
        return c.acquire({
          schema: "cadence-service-owner-config/1",
          endpoint: "http://127.0.0.1:17499",
          policyIdentity: "a".repeat(64),
        });
      },
      { timeoutMs: 1000, intervalMs: 10 },
    );
    expect(attempts).toBeGreaterThan(1);
    result.release();

    // 2. Persistent live lock times out without removing registry.lock.
    const stuckLock = c.files.create(
      lockPath,
      encoded({
        schema: "cadence-service-registry-lock/1",
        token: randomUUID(),
        pid: process.pid,
        host: hostname(),
        boot: liveMark.boot,
        started: liveMark.started,
      }),
    );
    await expect(
      waitForRegistry(
        c,
        () => {
          throw new ContractError("registry-locked");
        },
        { timeoutMs: 60, intervalMs: 10 },
      ),
    ).rejects.toMatchObject({ code: "registry-locked" });
    expect(existsSync(lockPath)).toBe(true);
    c.files.remove(lockPath, stuckLock);

    // 3. Dead PID lock fails fast without waiting the timeout.
    const deadLock = c.files.create(
      lockPath,
      encoded({
        schema: "cadence-service-registry-lock/1",
        token: randomUUID(),
        pid: 2147483646,
        host: hostname(),
        boot: liveMark.boot,
        started: "ticks:1",
      }),
    );
    let deadAttempts = 0;
    const startedAt = performance.now();
    await expect(
      waitForRegistry(
        c,
        () => {
          deadAttempts++;
          throw new ContractError("registry-locked");
        },
        { timeoutMs: 1000, intervalMs: 25 },
      ),
    ).rejects.toMatchObject({ code: "registry-locked" });
    expect(deadAttempts).toBe(1);
    expect(performance.now() - startedAt).toBeLessThan(200);
    c.files.remove(lockPath, deadLock);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("C1: evicts settled preparation failures past the 64-entry FIFO cap without capacity DoS and never replays failed commandIds", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gateway-c1-"));
  const stateHome = join(dir, "state"),
    agentDir = join(dir, "agent"),
    projectDir = join(dir, "project");
  for (const p of [stateHome, agentDir, projectDir])
    mkdirSync(p, { mode: 0o700 });
  const owners: FakeOwner[] = [];
  let calls = 0;
  let shouldFail = true;
  openProjectMock.fn = async (workspace, sh) => {
    calls++;
    if (shouldFail) throw new ContractError("unavailable");
    const owner = await startFakeOwner(workspace, sh);
    owners.push(owner);
    return { path: owner.c.store.root, link: `${owner.endpoint}/?token=ok` };
  };
  const { gateway, post, select } = await startGateway(
    dir,
    stateHome,
    agentDir,
  );
  try {
    const project = await select(projectDir);
    const failedIds: string[] = [];
    // Exceed the 64-entry settled-failure FIFO cap by 2 so indices 0..1 evict
    // while indices 2..65 remain bounded in memory and inFlight stays clear.
    for (let i = 0; i < 66; i++) {
      const commandId = randomUUID();
      failedIds.push(commandId);
      const res = await post("prepare-send", {
        projectId: project.id,
        commandId,
      });
      expect(res.status).toBe(400);
      expect(JSON.parse(res.text)).toMatchObject({
        kind: "error",
        error: { code: "unavailable", effect: "uncertain" },
      });
    }
    expect(calls).toBe(66);

    // Retrying retained entries (oldest surviving index 2 and newest index 65)
    // returns the recorded failure without replay.
    for (const keptId of [failedIds[2], failedIds[65]]) {
      const keptRetry = await post("prepare-send", {
        projectId: project.id,
        commandId: keptId,
      });
      expect(keptRetry.status).toBe(400);
      expect(JSON.parse(keptRetry.text)).toMatchObject({
        kind: "error",
        error: { code: "unavailable", effect: "uncertain" },
      });
    }
    expect(calls).toBe(66);

    // Retrying evicted older entries (0 and 1) hits the disk intent receipt and
    // fails closed with receipt-inconclusive without replay.
    for (const evictedId of [failedIds[0], failedIds[1]]) {
      const evictedRetry = await post("prepare-send", {
        projectId: project.id,
        commandId: evictedId,
      });
      expect(evictedRetry.status).toBe(400);
      expect(JSON.parse(evictedRetry.text)).toMatchObject({
        kind: "error",
        error: { code: "receipt-inconclusive", effect: "uncertain" },
      });
    }
    expect(calls).toBe(66);

    // Subsequent valid preparation succeeds cleanly (no permanent capacity DoS).
    shouldFail = false;
    const ok = await post("prepare-send", {
      projectId: project.id,
      commandId: randomUUID(),
    });
    expect(ok.status, ok.text).toBe(200);
    expect(calls).toBe(67);
    expect(decodeProjectEntry(JSON.parse(ok.text).project).epoch).toBe(
      owners[0].epoch,
    );
  } finally {
    gateway.stop();
    await vi.waitFor(() =>
      expect(gateway.store.inspect().status).toBe("stopped"),
    );
    for (const o of owners) await o.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("4B: prepares distinct projects concurrently up to 4 without cross-project blocking, and coalesces same-project concurrency onto the warm fast path", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gateway-4b-"));
  const stateHome = join(dir, "state"),
    agentDir = join(dir, "agent");
  mkdirSync(stateHome, { mode: 0o700 });
  mkdirSync(agentDir, { mode: 0o700 });
  const projectDirs = Array.from({ length: 5 }, (_, i) => {
    const p = join(dir, `proj-${i}`);
    mkdirSync(p, { mode: 0o700 });
    return p;
  });
  const owners: FakeOwner[] = [];
  const gates = new Map<string, ReturnType<typeof deferred<void>>>();
  const started: string[] = [];
  const callsByProject = new Map<string, number>();

  openProjectMock.fn = async (workspace, sh) => {
    const root = new ServiceCoordination(workspace, sh).store.root;
    started.push(root);
    callsByProject.set(root, (callsByProject.get(root) ?? 0) + 1);
    const gate = gates.get(root);
    if (gate) await gate.promise;
    const owner = await startFakeOwner(workspace, sh);
    owners.push(owner);
    return { path: owner.c.store.root, link: `${owner.endpoint}/?token=ok` };
  };

  const { gateway, post, select } = await startGateway(
    dir,
    stateHome,
    agentDir,
  );
  try {
    const projects = await Promise.all(projectDirs.map((p) => select(p)));
    // Hold project 0 in-flight.
    const gate0 = deferred();
    gates.set(projects[0].path, gate0);

    const req0 = post("prepare-send", {
      projectId: projects[0].id,
      commandId: randomUUID(),
    });
    await vi.waitFor(() => expect(started).toContain(projects[0].path));

    // While project 0 is blocked, project 1 prepares and completes immediately.
    const req1 = await post("prepare-send", {
      projectId: projects[1].id,
      commandId: randomUUID(),
    });
    expect(req1.status, req1.text).toBe(200);
    expect(
      decodeProjectEntry(JSON.parse(req1.text).project).epoch,
    ).toBeTruthy();

    // Two concurrent tabs on the SAME cold project 0: tab2 waits pre-admission,
    // then hits the warm fast path once tab1 finishes (zero extra openProjectDirectory,
    // zero extra commands/*.json file).
    const beforeFiles = new Set(readdirSync(gateway.store.path("commands")));
    const tab2Id = randomUUID();
    const tab2 = post("prepare-send", {
      projectId: projects[0].id,
      commandId: tab2Id,
    });

    // Hold projects 2, 3, 4 simultaneously -> total 4 in-flight (0, 2, 3, 4).
    const gate2 = deferred(),
      gate3 = deferred(),
      gate4 = deferred();
    gates.set(projects[2].path, gate2);
    gates.set(projects[3].path, gate3);
    gates.set(projects[4].path, gate4);
    const req2 = post("prepare-send", {
      projectId: projects[2].id,
      commandId: randomUUID(),
    });
    const req3 = post("prepare-send", {
      projectId: projects[3].id,
      commandId: randomUUID(),
    });
    const req4 = post("prepare-send", {
      projectId: projects[4].id,
      commandId: randomUUID(),
    });
    await vi.waitFor(() =>
      expect(
        [projects[0], projects[2], projects[3], projects[4]].every((p) =>
          started.includes(p.path),
        ),
      ).toBe(true),
    );

    // A 5th distinct cold project exceeds MAX_CONCURRENT_PREPARATIONS (4) with effect: "none".
    const proj5Dir = join(dir, "proj-5");
    mkdirSync(proj5Dir, { mode: 0o700 });
    const proj5 = await select(proj5Dir);
    const overflowId = randomUUID();
    const overflow = await post("prepare-send", {
      projectId: proj5.id,
      commandId: overflowId,
    });
    expect(overflow.status).toBe(400);
    expect(JSON.parse(overflow.text)).toMatchObject({
      kind: "error",
      error: { code: "capacity", effect: "none" },
    });
    expect(existsSync(gateway.store.path(`commands/${overflowId}.json`))).toBe(
      false,
    );

    // Release all held preparations.
    gate0.resolve();
    gate2.resolve();
    gate3.resolve();
    gate4.resolve();
    const [res0, resTab2, res2, res3, res4] = await Promise.all([
      req0,
      tab2,
      req2,
      req3,
      req4,
    ]);
    for (const r of [res0, resTab2, res2, res3, res4])
      expect(r.status, r.text).toBe(200);
    // Tab 2 received the exact same project & epoch as tab 1 without launching again
    // and without writing an intent file for tab2Id.
    expect(JSON.parse(resTab2.text)).toEqual(JSON.parse(res0.text));
    expect(callsByProject.get(projects[0].path)).toBe(1);
    expect(existsSync(gateway.store.path(`commands/${tab2Id}.json`))).toBe(
      false,
    );
    expect(beforeFiles.size).toBeGreaterThan(0);
  } finally {
    gateway.stop();
    await vi.waitFor(() =>
      expect(gateway.store.inspect().status).toBe("stopped"),
    );
    for (const o of owners) await o.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("4B: gateway stop rejects queued same-project waiters pre-admission with effect: none while settling in-flight work", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gateway-stop-queue-"));
  const stateHome = join(dir, "state"),
    agentDir = join(dir, "agent"),
    projectDir = join(dir, "project");
  for (const p of [stateHome, agentDir, projectDir])
    mkdirSync(p, { mode: 0o700 });
  const owners: FakeOwner[] = [];
  const gate = deferred();
  const started = deferred();
  openProjectMock.fn = async (workspace, sh) => {
    started.resolve();
    await gate.promise;
    const owner = await startFakeOwner(workspace, sh);
    owners.push(owner);
    return { path: owner.c.store.root, link: `${owner.endpoint}/?token=ok` };
  };
  const { gateway, post, select } = await startGateway(
    dir,
    stateHome,
    agentDir,
  );
  try {
    const project = await select(projectDir);
    const first = post("prepare-send", {
      projectId: project.id,
      commandId: randomUUID(),
    });
    await started.promise;

    const queuedId = randomUUID();
    const queued = post("prepare-send", {
      projectId: project.id,
      commandId: queuedId,
    });
    // Give the queued request a tick to enter the per-project queue.
    await new Promise((r) => setTimeout(r, 30));

    // Stop gateway while first is in-flight and queued is waiting.
    gateway.stop();
    const queuedRes = await queued;
    expect(queuedRes.status).toBe(400);
    expect(JSON.parse(queuedRes.text)).toMatchObject({
      kind: "error",
      error: { code: "quarantine", effect: "none" },
    });
    expect(existsSync(gateway.store.path(`commands/${queuedId}.json`))).toBe(
      false,
    );

    // In-flight preparation still settles cleanly before stop finishes.
    gate.resolve();
    await first;
    await vi.waitFor(() =>
      expect(gateway.store.inspect().status).toBe("stopped"),
    );
  } finally {
    gate.resolve();
    for (const o of owners) await o.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
