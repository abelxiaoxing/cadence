import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ActivityDiscoveryReader } from "../src/service/activity-discovery.ts";
import {
  ACTIVITY_RETAIN_MS,
  ActivityFiles,
  activityReaderScope,
  type NativeActivity,
} from "../src/service/activity-files.ts";
import {
  decodeActivityDiscovery,
  decodeOwnerActivity,
  managedActivity,
} from "../src/service/contracts/activity.ts";
import { Conversations } from "../src/service/conversations.ts";
import { ServiceCoordination } from "../src/service/coordination.ts";
import { GatewayStore } from "../src/service/gateway-store.ts";
import { selfMark } from "../src/service/liveness.ts";
import { sessionDirectory } from "../src/service/pi-sessions.ts";
import { hash } from "../src/service/private-files.ts";
import { Workbench } from "../src/service/workbench.ts";
import { Workflows } from "../src/service/workflows.ts";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const build = {
  contractHash: hash("contract"),
  assets: {
    contractHash: hash("contract"),
    sourceHash: hash("source"),
    buildId: hash("build"),
  },
};
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "activity-"));
  roots.push(root);
  const project = join(root, "project"),
    stateHome = join(root, "state"),
    agentDir = join(root, "agent");
  mkdirSync(project);
  mkdirSync(stateHome, { mode: 0o700 });
  mkdirSync(agentDir);
  const epoch = randomUUID();
  const files = new ActivityFiles(agentDir, stateHome);
  const record = (overrides: Partial<NativeActivity> = {}): NativeActivity => ({
    schema: "cadence-pi-activity/1",
    instance: randomUUID(),
    activity: randomUUID(),
    scope: files.scope,
    sessionScope: hash(sessionDirectory(project, agentDir)),
    process: selfMark(),
    cwd: project,
    sessionId: randomUUID(),
    leaf: null,
    startedAt: 1000,
    renewedAt: 1000,
    ...overrides,
  });
  let now = 1000;
  const options = {
    stateHome,
    agentDir,
    epoch,
    now: () => now,
    secrets: () => [] as string[],
    readOwner: vi.fn(
      async (_c: ServiceCoordination): Promise<unknown> => ({
        kind: "owner-activity",
        complete: true,
        readerScope: hash("reader"),
        epoch,
        build,
        activities: [],
      }),
    ),
  };
  return {
    root,
    project,
    stateHome,
    agentDir,
    epoch,
    files,
    record,
    options,
    advance: (ms = 4000) => {
      now += ms;
    },
  };
}
it("native publication is private/atomic, single-writer and noncreating on read; withdraw preserves history", () => {
  const f = fixture();
  expect(f.files.scan()).toEqual({ records: [], unavailable: 0 });
  expect(existsSync(f.files.directory)).toBe(false);
  const record = f.record(),
    a = f.files.publish(record);
  expect(statSync(f.files.directory).mode & 0o777).toBe(0o700);
  const path = join(f.files.directory, `${record.instance}.json`);
  expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(readdirSync(f.files.directory)).toEqual([`${record.instance}.json`]);
  const b = f.files.publish({ ...record, renewedAt: 2000 }, a);
  expect(f.files.scan().records[0].renewedAt).toBe(2000);
  expect(() => f.files.withdraw(record.instance, a)).toThrow();
  f.files.withdraw(record.instance, b);
  expect(f.files.scan().records).toEqual([]);
});
it("corrupt, partial, linked and foreign-host records are preserved and make observation partial", async () => {
  const f = fixture(),
    good = f.record();
  f.files.publish(good);
  const broken = join(f.files.directory, `${randomUUID()}.json`);
  writeFileSync(broken, "{torn", { mode: 0o600 });
  symlinkSync(broken, join(f.files.directory, `${randomUUID()}.json`));
  f.files.publish(
    f.record({ process: { ...selfMark(), host: "another-host" } }),
  );
  const reader = new ActivityDiscoveryReader(f.options);
  const value = await reader.read();
  expect(value.completeness).toBe("partial");
  expect(value.projects[0].activities).toHaveLength(1);
  expect(readFileSync(broken, "utf8")).toBe("{torn");
  expect(readdirSync(f.files.directory)).toHaveLength(4);
});
it("never-selected projects and a first-turn session with no JSONL appear without creating owners or Stop associations", async () => {
  const f = fixture();
  f.files.publish(f.record());
  const gateway = new GatewayStore(join(f.root, "server.env"), f.stateHome);
  const value = await new ActivityDiscoveryReader(f.options).read();
  expect(value.projects[0].path).toBe(f.project);
  expect(value.projects[0].activities[0].source).toBe("terminal");
  expect(new ServiceCoordination(f.project, f.stateHome).inspect().status).toBe(
    "absent",
  );
  expect(gateway.projects()).toEqual([]);
  expect(existsSync(join(f.agentDir, "sessions"))).toBe(false);
  expect(f.options.readOwner).not.toHaveBeenCalled();
});
it.each(["dead", "unknown"] as const)(
  "%s process proof is uncertainty, not a successful result; timeout is bounded",
  async (state) => {
    const f = fixture();
    f.files.publish(f.record());
    const reader = new ActivityDiscoveryReader({
      ...f.options,
      probe: () => ({ state, reboot: false }),
    });
    expect((await reader.read()).projects[0].activities[0].freshness).toBe(
      "unknown",
    );
    f.advance(ACTIVITY_RETAIN_MS + 1);
    expect(await reader.read()).toMatchObject({
      projects: [],
      completeness: "partial",
    });
  },
);
it("a live PID with expired renewal is stale, never current or completed", async () => {
  const f = fixture();
  f.files.publish(f.record());
  f.advance(16000);
  expect(
    (await new ActivityDiscoveryReader(f.options).read()).projects[0]
      .activities[0].freshness,
  ).toBe("stale");
});
it("one session in multiple terminal instances preserves sources without mixing fork IDs", async () => {
  const f = fixture(),
    sessionId = randomUUID();
  for (const id of [sessionId, sessionId, randomUUID()])
    f.files.publish(f.record({ sessionId: id }));
  const value = await new ActivityDiscoveryReader(f.options).read();
  expect(value.projects).toHaveLength(1);
  expect(value.projects[0].activities).toHaveLength(3);
  expect(
    new Set(value.projects[0].activities.map((a) => a.sessionId)).size,
  ).toBe(2);
});
it("managed candidates are not independent projects; owner projection retains original context and actual execution location", async () => {
  const f = fixture();
  const candidate = join(f.stateHome, "cadence-worktrees-v1", "candidate");
  mkdirSync(candidate, { recursive: true });
  f.files.publish(f.record({ cwd: candidate }));
  expect(await new ActivityDiscoveryReader(f.options).read()).toMatchObject({
    projects: [],
    completeness: "partial",
  });
  const sessionId = randomUUID(),
    execution = {
      cwd: f.project,
      checkoutRoot: f.project,
      version: {
        conversation: { id: sessionId, cwd: f.project },
        epoch: f.epoch,
        accessGeneration: 1,
        configRev: 1,
        catalogId: randomUUID(),
      },
      model: null,
    };
  const value = managedActivity({
    id: randomUUID(),
    source: "workflow",
    execution,
    root: f.project,
    epoch: f.epoch,
    phase: "recovering",
    now: 1000,
    executionCwd: candidate,
  });
  expect(value).toMatchObject({
    cwd: f.project,
    executionCwd: candidate,
    sessionId,
    phase: "recovering",
  });
  expect(
    managedActivity({
      id: randomUUID(),
      source: "workflow",
      execution: {
        ...execution,
        version: { ...execution.version, conversation: undefined },
      },
      root: f.project,
      epoch: f.epoch,
      phase: "settling",
      now: 1000,
    }).sessionId,
  ).toBeNull();
});
function ownerFixture() {
  const f = fixture();
  const c = new ServiceCoordination(f.project, f.stateHome);
  const lease = c.acquire({
    schema: "cadence-service-owner-config/1",
    endpoint: "http://127.0.0.1:12345",
    policyIdentity: hash("policy"),
  });
  const epoch = lease.registration.epoch;
  let activities = [
    managedActivity({
      id: randomUUID(),
      source: "workflow",
      execution: {
        cwd: f.project,
        checkoutRoot: f.project,
        version: {
          epoch,
          conversation: { id: randomUUID(), cwd: f.project },
          accessGeneration: 1,
          configRev: 1,
          catalogId: randomUUID(),
        },
        model: null,
      },
      root: f.project,
      epoch,
      phase: "queued",
      now: 1000,
    }),
  ];
  f.options.readOwner.mockImplementation(async () => ({
    kind: "owner-activity",
    complete: true,
    readerScope: hash("reader"),
    epoch,
    build,
    activities,
  }));
  return {
    ...f,
    c,
    lease,
    setActivities: (next: typeof activities) => {
      activities = next;
    },
  };
}
it("registry owner work survives terminal departure; success/failure/cancel settle only by authoritative roster removal", async () => {
  const f = ownerFixture(),
    record = f.record();
  const file = f.files.publish(record);
  const reader = new ActivityDiscoveryReader(f.options);
  expect((await reader.read()).projects[0].activities).toHaveLength(2);
  f.files.withdraw(record.instance, file);
  f.advance();
  expect(
    (await reader.read()).projects[0].activities.map((a) => a.source),
  ).toEqual(["workflow"]);
  f.setActivities([]);
  f.advance();
  expect(await reader.read()).toMatchObject({
    projects: [],
    completeness: "complete",
  });
});
it("owner read failure, disappearance and epoch change retain bounded unknown work, never complete empty", async () => {
  const f = ownerFixture(),
    reader = new ActivityDiscoveryReader(f.options);
  await reader.read();
  f.advance();
  f.options.readOwner.mockRejectedValue(new Error("timeout"));
  expect((await reader.read()).projects[0].activities[0].freshness).toBe(
    "unknown",
  );
  f.advance();
  f.options.readOwner.mockResolvedValue({
    kind: "owner-activity",
    complete: true,
    readerScope: hash("reader"),
    epoch: randomUUID(),
    build,
    activities: [],
  });
  expect((await reader.read()).projects[0].activities[0].freshness).toBe(
    "unknown",
  );
  f.advance(ACTIVITY_RETAIN_MS);
  expect(await reader.read()).toMatchObject({
    completeness: "partial",
    projects: [],
  });
});
it("shared in-flight/cache queries do not create one transport per tab; invalidation and close fence late reads", async () => {
  const f = ownerFixture();
  let finish!: (value: unknown) => void;
  f.options.readOwner.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  const reader = new ActivityDiscoveryReader(f.options);
  const a = reader.read(),
    b = reader.read();
  expect(a).toBe(b);
  await Promise.resolve();
  expect(f.options.readOwner).toHaveBeenCalledTimes(1);
  reader.invalidate();
  finish({
    kind: "owner-activity",
    complete: true,
    readerScope: hash("reader"),
    epoch: f.lease.registration.epoch,
    build,
    activities: [],
  });
  await expect(a).rejects.toThrow("unavailable");
  f.options.readOwner.mockResolvedValue({
    kind: "owner-activity",
    complete: true,
    readerScope: hash("reader"),
    epoch: f.lease.registration.epoch,
    build,
    activities: [],
  });
  expect((await reader.read()).completeness).toBe("complete");
  await reader.read();
  expect(f.options.readOwner).toHaveBeenCalledTimes(2);
  reader.close();
  await expect(reader.read()).rejects.toThrow();
});
it("different owner builds remain readable; closed DTOs reject control fields and credentials are not returned", async () => {
  const f = ownerFixture();
  f.options.readOwner.mockResolvedValue({
    kind: "owner-activity",
    complete: true,
    readerScope: hash("reader"),
    epoch: f.lease.registration.epoch,
    build: { ...build, contractHash: hash("older") },
    activities: [],
  });
  const value = await new ActivityDiscoveryReader(f.options).read();
  expect(value).toMatchObject({ completeness: "complete", projects: [] });
  expect(() =>
    decodeActivityDiscovery({ ...value, token: "secret" }),
  ).toThrow();
  expect(() =>
    decodeOwnerActivity({
      kind: "owner-activity",
      complete: true,
      readerScope: hash("reader"),
      epoch: f.epoch,
      build,
      activities: [],
      endpoint: "private",
    }),
  ).toThrow();
  f.files.publish(f.record());
  const redacted = await new ActivityDiscoveryReader({
    ...f.options,
    secrets: () => [f.project],
  }).read();
  expect(JSON.stringify(redacted)).not.toContain(f.project);
});
it("active Web workflow links use admission context without ever scanning copied/forked history", () => {
  const root = "/project",
    epoch = randomUUID(),
    sessionId = randomUUID();
  const run = {
    id: randomUUID(),
    epoch,
    execution: {
      cwd: root,
      checkoutRoot: root,
      version: { epoch, conversation: { id: sessionId, cwd: root } },
    },
  };
  const fixture = {
    o: { owner: { lease: { assert() {} } }, coordination: { store: { root } } },
    workflows: {
      activeRuns: () => ({
        kind: "workflow-active",
        runs: [run, { ...run, id: randomUUID(), execution: undefined }],
      }),
    },
    conversations: {
      records: {
        nativeLinks: () => {
          throw new Error("must not scan history");
        },
      },
    },
  };
  const value = Workbench.prototype.read.call(fixture as any, {
    kind: "workflow-active",
  }) as any;
  expect(value.links).toEqual([{ runId: run.id, conversationId: sessionId }]);
});

it("renewal expiry alone never archives a live publisher; proven PID reuse archives metadata, not project data", () => {
  const f = fixture();
  const live = f.record(),
    dead = f.record({
      process: { ...selfMark(), started: "different-start-identity" },
    });
  f.files.publish(live);
  f.files.publish(dead);
  writeFileSync(join(f.project, "consumer.txt"), "keep");
  f.files.retireDead(1000 + ACTIVITY_RETAIN_MS + 1);
  expect(f.files.scan().records.map((r) => r.instance)).toEqual([
    live.instance,
  ]);
  const archive = join(f.files.files.namespace, "recovery-archive-v1");
  const kept = join(archive, readdirSync(archive)[0], "pi-activity.json");
  expect(JSON.parse(readFileSync(kept, "utf8")).instance).toBe(dead.instance);
  expect(readFileSync(join(f.project, "consumer.txt"), "utf8")).toBe("keep");
});
it("owner transport concurrency is bounded and excess candidates are explicit partial observations", async () => {
  const f = fixture(),
    candidates = Array.from({ length: 20 }, (_, i) => {
      const root = join(f.root, `project-${i}`);
      mkdirSync(root);
      return { root, epoch: f.epoch, host: hostname() };
    });
  vi.spyOn(ServiceCoordination.prototype, "localAccess").mockReturnValue({
    endpoint: "http://127.0.0.1:12345",
    epoch: f.epoch,
    capability: "fabricated",
  });
  let pending = 0,
    maximum = 0;
  const readOwner = vi.fn(async () => {
    pending++;
    maximum = Math.max(maximum, pending);
    await Promise.resolve();
    pending--;
    return {
      kind: "owner-activity",
      complete: true,
      readerScope: hash("reader"),
      epoch: f.epoch,
      build,
      activities: [],
    };
  });
  const reader = new ActivityDiscoveryReader({
    ...f.options,
    readOwner,
    candidates: () => candidates,
  });
  expect(await reader.read()).toMatchObject({
    projects: [],
    completeness: "partial",
  });
  expect(maximum).toBe(4);
  expect(readOwner).toHaveBeenCalledTimes(16);
  const first = readOwner.mock.calls.map((args: any[]) => args[0].store.root);
  f.advance();
  await reader.read();
  const all = readOwner.mock.calls.map((args: any[]) => args[0].store.root);
  expect(new Set(first).size).toBe(16);
  expect(new Set(all).size).toBe(20);
});
it("native scan failure cannot produce a complete empty discovery", async () => {
  const f = fixture();
  expect(
    await new ActivityDiscoveryReader({
      ...f.options,
      native: () => {
        throw new Error("unreadable");
      },
    }).read(),
  ).toMatchObject({ projects: [], completeness: "partial" });
});
it("native workspace observations are asynchronous, concurrency-bounded and capacity is explicit", async () => {
  const f = fixture();
  const records = Array.from({ length: 20 }, () => f.record());
  let pending = 0,
    maximum = 0;
  const resolve = vi.fn(async (cwd: string) => {
    pending++;
    maximum = Math.max(pending, maximum);
    await Promise.resolve();
    pending--;
    return { cwd, root: cwd };
  });
  const reader = new ActivityDiscoveryReader({
    ...f.options,
    resolve,
    native: () => ({ records, unavailable: 0 }),
  });
  expect((await reader.read()).completeness).toBe("partial");
  expect(resolve).toHaveBeenCalledTimes(16);
  expect(maximum).toBe(4);
  f.advance();
  await reader.read();
  expect(resolve).toHaveBeenCalledTimes(32);
});
it("R2: failed/partial native scans keep prior work unknown, while a complete withdrawal removes it", async () => {
  const f = fixture();
  const native = vi.fn(() => ({ records: [f.record()], unavailable: 0 }));
  const reader = new ActivityDiscoveryReader({ ...f.options, native });
  const first = await reader.read();
  native.mockImplementation(() => {
    throw new Error("unreadable");
  });
  f.advance();
  const failed = await reader.read();
  expect(failed.projects[0].activities[0]).toMatchObject({
    id: first.projects[0].activities[0].id,
    freshness: "unknown",
  });
  native.mockReturnValue({ records: [], unavailable: 1 });
  f.advance();
  expect((await reader.read()).projects[0].activities).toHaveLength(1);
  native.mockReturnValue({ records: [], unavailable: 0 });
  f.advance();
  expect(await reader.read()).toMatchObject({
    completeness: "complete",
    projects: [],
  });
});
it("R5: invalidation aborts current transports and admits no later queued observations", async () => {
  const f = fixture(),
    candidates = Array.from({ length: 8 }, (_, i) => {
      const root = join(f.root, `owner-${i}`);
      mkdirSync(root);
      return { root, epoch: f.epoch, host: hostname() };
    });
  vi.spyOn(ServiceCoordination.prototype, "localAccess").mockReturnValue({
    endpoint: "http://127.0.0.1:12345",
    epoch: f.epoch,
    capability: "fabricated",
  });
  const signals: AbortSignal[] = [];
  const readOwner = vi.fn(
    (_c: ServiceCoordination, signal: AbortSignal) =>
      new Promise((_, reject) => {
        signals.push(signal);
        signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      }),
  );
  const reader = new ActivityDiscoveryReader({
    ...f.options,
    candidates: () => candidates,
    readOwner,
  });
  const pending = reader.read();
  const result = expect(pending).rejects.toThrow("unavailable");
  await Promise.resolve();
  expect(readOwner).toHaveBeenCalledTimes(4);
  reader.invalidate();
  await result;
  expect(signals.every((s) => s.aborted)).toBe(true);
  expect(readOwner).toHaveBeenCalledTimes(4);
});

it("R6: session-directory overrides stay visible without reading or navigating a different same-id transcript", async () => {
  const f = fixture();
  f.files.publish(f.record({ sessionScope: hash("other-session-directory") }));
  const value = await new ActivityDiscoveryReader(f.options).read();
  expect(value.projects[0].activities[0]).toMatchObject({
    source: "terminal",
    history: "unavailable",
  });
  expect(JSON.stringify(value)).not.toContain("other-session-directory");
  expect(existsSync(join(f.agentDir, "sessions"))).toBe(false);
});

it("owner original maps distinguish queue, execution, recovery, Stop and settlement without rewriting history results", () => {
  const root = "/project",
    epoch = randomUUID();
  const execution = {
    cwd: root,
    checkoutRoot: root,
    version: { epoch, conversation: { id: randomUUID(), cwd: root } },
  };
  const statuses = [
    "queued",
    "running",
    "completed",
    "failed",
    "canceled",
    "unknown",
  ];
  const original = new Map(
    statuses.map((status) => [
      status,
      {
        execution,
        epoch,
        commandId: randomUUID(),
        accepted: { parent: null },
        state: { status },
        abort: new AbortController(),
      },
    ]),
  );
  const before = [...original.values()].map((live) => live.state.status);
  const turns = Conversations.prototype.activity.call({
    active: original,
    o: { coordination: { store: { root } } },
  } as any);
  expect(turns.map((a) => a.phase)).toEqual([
    "queued",
    "running",
    "settling",
    "settling",
    "settling",
    "settling",
  ]);
  expect([...original.values()].map((live) => live.state.status)).toEqual(
    before,
  );
  const live = {
    execution,
    run: { id: randomUUID(), epoch, phase: "recovering", status: "running" },
    abort: new AbortController(),
  };
  const flows = {
    active: new Map([[live.run.id, live]]),
    o: { coordination: { store: { root } } },
  };
  expect(Workflows.prototype.activity.call(flows as any)[0].phase).toBe(
    "recovering",
  );
  live.abort.abort();
  expect(Workflows.prototype.activity.call(flows as any)[0].phase).toBe(
    "stopping",
  );
  flows.active.clear();
  expect(Workflows.prototype.activity.call(flows as any)).toEqual([]);
});

it("R6: a live owner with a different Pi reader configuration cannot redirect terminal history", async () => {
  const f = ownerFixture();
  f.files.publish(f.record());
  const reader = new ActivityDiscoveryReader(f.options);
  const first = await reader.read();
  expect(
    first.projects[0].activities.find((a) => a.source === "terminal")?.history,
  ).toBe("unavailable");
  f.options.readOwner.mockResolvedValue({
    kind: "owner-activity",
    complete: true,
    epoch: f.lease.registration.epoch,
    readerScope: activityReaderScope(f.agentDir),
    build,
    activities: [],
  });
  f.advance();
  expect(
    (await reader.read()).projects[0].activities.find(
      (a) => a.source === "terminal",
    )?.history,
  ).toBe("shared");
});

it("R7: an incomplete owner roster is never settlement evidence for a missing original", async () => {
  const f = ownerFixture(),
    reader = new ActivityDiscoveryReader(f.options);
  const first = await reader.read();
  f.advance();
  f.options.readOwner.mockResolvedValue({
    kind: "owner-activity",
    epoch: f.lease.registration.epoch,
    complete: false,
    readerScope: activityReaderScope(f.agentDir),
    build,
    activities: [],
  });
  const result = await reader.read();
  expect(result.completeness).toBe("partial");
  expect(result.projects[0].activities[0]).toMatchObject({
    id: first.projects[0].activities[0].id,
    freshness: "unknown",
  });
});
