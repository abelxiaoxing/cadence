import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, expect, it } from "vitest";
import { HistoryFiles } from "../src/history/files.ts";
import { healHistory } from "../src/history/recovery.ts";
import { HistoryWriter } from "../src/history/writer.ts";
import { ServiceCoordination } from "../src/service/coordination.ts";
import { doctor, healAccount } from "../src/service/doctor.ts";
import { GatewayStore } from "../src/service/gateway-store.ts";
import {
  bootId,
  holderState,
  processStart,
  selfMark,
} from "../src/service/liveness.ts";
import { ProcessLedger } from "../src/service/process-ledger.ts";
import { RecoveryLog } from "../src/service/recovery-log.ts";
import {
  healProject,
  healWorkbench,
  RegistryHealer,
} from "../src/service/self-heal.ts";

let child: string;
beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "self-heal-build-"));
  child = join(dir, "child.mjs");
  const built = spawnSync(
    "bun",
    [
      "build",
      "./test/helpers/self-heal-child.ts",
      "--target=node",
      "--packages=external",
      `--outfile=${child}`,
    ],
    { encoding: "utf8" },
  );
  expect(built.status, built.stderr).toBe(0);
});
const config = {
  schema: "cadence-service-owner-config/1",
  endpoint: "http://127.0.0.1:17423",
  policyIdentity: "a".repeat(64),
} as const;
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "self-heal-"));
  const root = join(dir, "project"),
    state = join(dir, "state");
  mkdirSync(root);
  mkdirSync(state, { mode: 0o700 });
  return { dir, root, state, c: new ServiceCoordination(root, state) };
}
/** Run a real process that leaves its state behind and exits without Stop. */
function crash(mode: string, root: string, state: string) {
  const result = spawnSync(process.execPath, [child, mode, root, state], {
    encoding: "utf8",
    timeout: 15000,
  });
  expect(result.status, result.stderr).toBe(77);
  return result.stdout;
}
const events = (c: ServiceCoordination) => new RecoveryLog(c.files).events();

it("classifies holders by boot identity, PID absence and start identity", () => {
  expect(holderState(selfMark())).toEqual({ state: "live", reboot: false });
  const parent = { pid: process.ppid, host: hostname() };
  expect(
    holderState({
      ...parent,
      boot: bootId(),
      started: processStart(process.ppid),
    }).state,
  ).toBe("live");
  // A PID reused by another process is not the recorded holder.
  if (processStart(process.ppid))
    expect(holderState({ ...parent, started: "ticks:1" }).state).toBe("dead");
  if (bootId())
    expect(
      holderState({
        ...parent,
        boot: "00000000-0000-0000-0000-000000000000",
      }),
    ).toEqual({ state: "dead", reboot: true });
  expect(holderState({ pid: 2147483646, host: hostname() }).state).toBe("dead");
  expect(holderState({ pid: 1, host: `${hostname()}-elsewhere` }).state).toBe(
    "foreign",
  );
});

it("an owner that died without Stop is reclaimed and its project starts again", async () => {
  const { root, state, c } = fixture();
  crash("owner", root, state);
  expect(() => c.acquire(config)).toThrow();
  const healed = await healProject(c);
  expect(healed).toMatchObject({
    status: "healed",
    event: { scope: "project", path: c.store.root, cause: "crash" },
  });
  expect(healed.status === "healed" && healed.event.actions).toContain(
    "released-locks",
  );
  expect(existsSync(join(c.directory, "owner.lock"))).toBe(false);
  expect(existsSync(c.store.lockPath)).toBe(false);
  expect(c.registryView()?.value.entries).toEqual([]);
  // The registration and its history stay; only the dead owner's fences go.
  expect(
    JSON.parse(readFileSync(join(c.directory, "registration.json"), "utf8"))
      .phase,
  ).toBe("stopped");
  const lease = c.acquire(config);
  expect((await healHistory(lease, new RecoveryLog(c.files))).heal).toBe(
    "clean",
  );
  lease.release();
  expect(events(c)).toHaveLength(1);
  // Nothing left over: a second heal changes nothing.
  expect(await healProject(c)).toEqual({ status: "clean" });
});

it("a reservation interrupted before its registration is reclaimed", async () => {
  const { root, state, c } = fixture();
  crash("partial", root, state);
  expect(c.registryView()?.value.entries).toHaveLength(1);
  expect(await healProject(c)).toMatchObject({ status: "healed" });
  expect(c.registryView()?.value.entries).toEqual([]);
  c.acquire(config).release();
});

it("a live owner is never reclaimed", async () => {
  const { c } = fixture();
  const lease = c.acquire(config);
  expect(await healProject(c, { responsive: async () => true })).toEqual({
    status: "live",
  });
  // Running but silent, and not asked to stop it: the user decides.
  expect(await healProject(c, { responsive: async () => false })).toMatchObject(
    { status: "blocked", reason: "owner-unresponsive", pid: process.pid },
  );
  expect(existsSync(join(c.directory, "owner.lock"))).toBe(true);
  lease.release();
});

it("a dead short registry lock is released and a damaged registry rebuilt", async () => {
  const { root, state, c } = fixture();
  crash("registry-lock", root, state);
  expect(() => c.acquire(config)).toThrow("registry-locked");
  expect(await new RegistryHealer(c).heal()).toMatchObject({
    status: "healed",
    event: { scope: "registry", actions: ["released-locks"] },
  });
  const live = c.acquire(config);
  // Damaged bytes: the live owner's reservation is rebuilt from its own files.
  writeFileSync(join(c.registryDirectory, "roots.json"), "{", { mode: 0o600 });
  const rebuilt = await new RegistryHealer(c).heal();
  expect(rebuilt).toMatchObject({ status: "healed" });
  expect(rebuilt.status === "healed" && rebuilt.event.actions).toContain(
    "rebuilt-registry",
  );
  expect(c.registryView()?.value.entries.map((r) => r.epoch)).toEqual([
    live.registration.epoch,
  ]);
  const archive = rebuilt.status === "healed" ? rebuilt.event.archive : null;
  expect(archive).toBeTruthy();
  expect(
    readdirSync(
      join(c.files.namespace, "recovery-archive-v1", archive as string),
    ),
  ).toContain("service-registry-v1--roots.json");
  live.release();
});

it("leftover workers of a dead owner are stopped by exact identity", async () => {
  const { root, state, c } = fixture();
  const out = crash("owner-worker", root, state);
  const worker = JSON.parse(out.trim()).worker as number;
  const alive = () => {
    try {
      process.kill(worker, 0);
      return true;
    } catch {
      return false;
    }
  };
  expect(alive()).toBe(true);
  const inspected = await healProject(c, { inspect: true });
  expect(inspected).toMatchObject({ status: "reclaimable", workers: 1 });
  expect(alive()).toBe(true);
  const healed = await healProject(c);
  expect(healed).toMatchObject({
    status: "healed",
    event: { workers: 1 },
  });
  expect(healed.status === "healed" && healed.event.actions).toContain(
    "stopped-workers",
  );
  expect(alive()).toBe(false);
  expect(
    new ProcessLedger(c.files).read(
      JSON.parse(readFileSync(join(c.directory, "registration.json"), "utf8"))
        .epoch,
    ),
  ).toEqual([]);
});

it("a torn history tail is continued by an automatic bridge", async () => {
  const { root, state, c } = fixture();
  crash("tail", root, state);
  await healProject(c);
  const lease = c.acquire(config);
  expect(new HistoryWriter(lease).quarantined).toBe(true);
  const result = await healHistory(lease, new RecoveryLog(c.files));
  expect(result.heal).toBe("continued-history");
  expect(new HistoryWriter(lease).quarantined).toBe(false);
  // The torn bytes stay where they were; the bridge starts a new segment.
  expect(readFileSync(HistoryFiles.open(c)!.segmentPath(1), "utf8")).toBe(
    '{"torn":',
  );
  lease.release();
});

it("unreadable history is archived and started afresh", async () => {
  const { c } = fixture();
  const lease = c.acquire(config);
  const files = HistoryFiles.initialize(lease);
  writeFileSync(files.segmentPath(1), "not json\n", { mode: 0o600 });
  appendFileSync(files.segmentPath(1), "still not json\n");
  const result = await healHistory(lease, new RecoveryLog(c.files));
  expect(result.heal).toBe("archived-history");
  expect(result.archive).toBeTruthy();
  expect(new HistoryWriter(lease).quarantined).toBe(false);
  expect(
    readdirSync(
      join(c.files.namespace, "recovery-archive-v1", result.archive as string),
    ),
  ).toEqual(["history-v2"]);
  lease.release();
});

it("half-written selection metadata is archived so the project starts afresh", async () => {
  const { root, state, c } = fixture();
  crash("owner", root, state);
  writeFileSync(join(c.directory, "config.json"), "{", { mode: 0o600 });
  const healed = await healProject(c);
  expect(healed.status === "healed" && healed.event.actions).toContain(
    "archived-state",
  );
  expect(existsSync(c.directory)).toBe(false);
  c.acquire(config).release();
});

it("interrupted temporaries are set aside", async () => {
  const { c } = fixture();
  c.acquire(config).release();
  const stray = join(c.directory, `pending-${randomUUID()}.json`);
  writeFileSync(stray, "{}", { mode: 0o600 });
  const healed = await healProject(c);
  expect(healed.status === "healed" && healed.event).toMatchObject({
    cause: "storage",
    actions: ["removed-temporaries"],
  });
  expect(existsSync(stray)).toBe(false);
  c.acquire(config).release();
});

it("a project whose directory was deleted no longer blocks the account", async () => {
  const { root, state, c } = fixture();
  crash("owner", root, state);
  const stored = c.store.root;
  rmSync(root, { recursive: true });
  const account = new ServiceCoordination(null, state);
  const result = await healAccount(account);
  expect(result.projects).toMatchObject([
    { status: "healed", event: { path: stored } },
  ]);
  expect(account.registryView()?.value.entries).toEqual([]);
});

it("a workbench that died without Stop is reclaimed", async () => {
  const { dir, state } = fixture();
  crash("workbench", dir, state);
  const store = new GatewayStore(join(dir, "server.env"), state);
  expect(store.inspect().status).toBe("quarantined");
  expect(await healWorkbench(store)).toMatchObject({
    status: "healed",
    event: { scope: "workbench", actions: ["released-locks"] },
  });
  expect(store.inspect().status).toBe("stopped");
  expect(existsSync(store.path("gateway.lock"))).toBe(false);
});

it("doctor reports readonly and --fix heals", async () => {
  const { root, state, c } = fixture();
  crash("owner", root, state);
  const before = readFileSync(join(c.directory, "registration.json"));
  const agentDir = join(state, "..", "agent");
  mkdirSync(agentDir);
  writeFileSync(join(agentDir, "auth.json"), "{}");
  const options = {
    stateHome: state,
    serverConfig: join(state, "none.env"),
    agentDir,
    probeProject: async () => false,
    probeWorkbench: async () => false,
    yes: false,
  };
  const write = process.stderr.write;
  process.stderr.write = () => true;
  try {
    const inspected = (await doctor({ ...options, fix: false })) as {
      checks: { status: string }[];
    };
    expect(inspected.checks.map((c) => c.status)).toEqual([
      "clean",
      "reclaimable",
    ]);
    expect(readFileSync(join(c.directory, "registration.json"))).toEqual(
      before,
    );
    const fixed = (await doctor({ ...options, fix: true })) as {
      status: string;
      checks: { status: string }[];
    };
    expect(fixed.status).toBe("ok");
    expect(fixed.checks.map((c) => c.status)).toEqual(["clean", "healed"]);
    // The project's Pi sources pass the same checks its owner runs to start.
    expect((fixed as { pi?: unknown }).pi).toEqual([
      {
        agentDir,
        targets: [`project ${c.store.root}`, "new projects"],
        status: "ok",
      },
    ]);
  } finally {
    process.stderr.write = write;
    process.exitCode = 0;
  }
});

it("the recovery log merges one recovery's steps and expires old archives", () => {
  const { c } = fixture();
  const log = new RecoveryLog(c.files);
  log.record({
    scope: "project",
    path: "/p",
    cause: "reboot",
    actions: ["released-locks"],
    workers: 0,
    archive: null,
  });
  log.record({
    scope: "project",
    path: "/p",
    cause: "storage",
    actions: ["continued-history"],
    workers: 0,
    archive: null,
  });
  expect(log.events()).toMatchObject([
    { cause: "reboot", actions: ["released-locks", "continued-history"] },
  ]);
  const old = join(
    log.archiveDirectory,
    `${Date.now() - 40 * 24 * 60 * 60 * 1000}-${randomUUID()}`,
  );
  mkdirSync(old, { recursive: true, mode: 0o700 });
  log.prune();
  expect(existsSync(old)).toBe(false);
});
