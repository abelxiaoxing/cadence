import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createConnection, createServer } from "node:net";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  type OwnerConfig,
  type OwnerLease,
  ServiceCoordination,
} from "../src/service/coordination.ts";
import {
  type OwnerLifecyclePorts,
  ServiceOwner,
} from "../src/service/owner.ts";
import type { PersistenceResult } from "../src/service/ports.ts";
import {
  inspectRecovery,
  type RecoveryHistoryFacts,
  resolveRecovery,
} from "../src/service/recovery.ts";
import {
  type CheckNativeSettlement,
  decodeCommittedBatch,
  publicError,
} from "../src/service-contract.ts";
import { TaskStore } from "../src/task-store.ts";

let nativeFixture: string;
beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "cadence-owner-native-bundle-"));
  nativeFixture = join(dir, "owner-fixture.mjs");
  const build = spawnSync(
    "bun",
    [
      "build",
      fileURLToPath(
        new URL("./helpers/service-owner-child.mjs", import.meta.url),
      ),
      "--target=node",
      "--packages=external",
      `--outfile=${nativeFixture}`,
    ],
    { encoding: "utf8", timeout: 10000 },
  );
  expect(build.status, build.stderr).toBe(0);
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "cadence-owner-"));
  const root = join(dir, "project");
  mkdirSync(root);
  const state = join(dir, "state");
  return { dir, root, state, c: new ServiceCoordination(root, state) };
}
function config(port = 17423): OwnerConfig {
  return {
    schema: "cadence-service-owner-config/1",
    endpoint: `http://127.0.0.1:${port}`,
    policyIdentity: "a".repeat(64),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const native: CheckNativeSettlement = {
  outcome: "canceled",
  closure: "direct-child-closed",
  exitCode: 0,
  signal: null,
  durationMs: 1,
  stdin: "not-required",
};
// Explicit injected W3 receipt fixture, NOT durable-history evidence. The core
// does not fabricate this default; composition must supply actual W3 ports.
const committed: PersistenceResult = {
  status: "committed",
  batch: decodeCommittedBatch({
    committedSeq: "1",
    details: [],
    ownerDetails: [],
    coverage: {
      observed: "complete",
      source: "complete",
      redacted: false,
      omissions: [],
    },
  }),
};
function ports(events: string[] = []): OwnerLifecyclePorts {
  return {
    quiesce: () => {
      events.push("quiesce");
    },
    flush: async () => {
      events.push("flush");
      return committed;
    },
    closeListener: async () => {
      events.push("close-listener");
    },
  };
}
function held(lease: OwnerLease) {
  expect(existsSync(lease.coordination.store.lockPath)).toBe(true);
  expect(existsSync(lease.coordination.path("owner.lock"))).toBe(true);
}
function registryLock(c: ServiceCoordination) {
  return join(c.registryDirectory, "registry.lock");
}
function bytes(path: string) {
  return readFileSync(path);
}
function seedFixtureCommit(cwd: string) {
  // Inert fabricated Git fixture, no git commit invocation or real checkout mutation.
  const input =
    "blob\nmark :1\ndata 7\nfixture\ncommit refs/heads/fixture\ncommitter Fixture <fixture@example.invalid> 1 +0000\ndata 7\nfixture\nM 100644 :1 file\n\ndone\n";
  const result = spawnSync("git", ["fast-import", "--quiet"], {
    cwd,
    input,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: cwd,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: join(cwd, "absent-config"),
    },
  });
  expect(result.status, result.stderr).toBe(0);
  git(cwd, "symbolic-ref", "HEAD", "refs/heads/fixture");
}
function git(cwd: string, ...args: string[]) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: cwd,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: join(cwd, "absent-config"),
      GIT_AUTHOR_NAME: "Fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "Fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    },
  });
  expect(result.status, result.stderr).toBe(0);
}
interface Running {
  child: ChildProcess;
  closed: Promise<[number | null, NodeJS.Signals | null]>;
  next: () => Promise<any>;
  finish: (crash?: boolean) => Promise<void>;
}
async function childOwner(
  root: string,
  state: string,
  port = 17423,
): Promise<Running> {
  const child = spawn(
    process.execPath,
    [nativeFixture, root, state, String(port)],
    {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      env: { PATH: process.env.PATH, HOME: dirname(root) },
    },
  );
  const closed = once(child, "close") as Promise<
    [number | null, NodeJS.Signals | null]
  >;
  const queue: unknown[] = [];
  let wake: ((v: unknown) => void) | undefined;
  child.on("message", (message) => {
    if (wake) {
      const w = wake;
      wake = undefined;
      w(message);
    } else queue.push(message);
  });
  const next = async () =>
    queue.length
      ? queue.shift()
      : Promise.race([
          new Promise<unknown>((resolve) => {
            wake = resolve;
          }),
          closed.then(([code]) => {
            throw new Error(`fixture closed before message: ${code}`);
          }),
        ]);
  const watchdog = setTimeout(() => {
    child.kill("SIGKILL");
  }, 8000);
  void closed.then(() => {
    clearTimeout(watchdog);
  });
  expect(await next()).toEqual({ type: "boot" });
  return {
    child,
    closed,
    next,
    finish: async (crash = false) => {
      child.send(crash ? "crash" : "release");
      const [code, signal] = await closed;
      expect(code).toBe(crash ? 17 : 0);
      expect(signal).toBeNull();
    },
  };
}

// POSIX permission modes and UIDs: Windows ACLs are not modes, and private
// files deliberately skip mode checks there (task-store/private-files).
const posix = process.platform !== "win32";
const posixModes = posix ? (["mode"] as const) : [];
describe("service coordination: actual isolated filesystem", () => {
  it("readonly discovery/diagnosis preserves absence, old logs and consumer bytes", async () => {
    const { c, dir, root } = fixture();
    writeFileSync(join(root, "legacy.sqlite"), "unchanged");
    expect(c.inspect()).toEqual({ status: "absent" });
    await expect(inspectRecovery(c)).rejects.toThrow();
    expect(existsSync(join(dir, "state"))).toBe(false);
    expect(existsSync(join(root, ".cadence"))).toBe(false);
    expect(readFileSync(join(root, "legacy.sqlite"), "utf8")).toBe("unchanged");
  });
  it("explicit initialize creates no task/owner/access and preserves exact config", () => {
    const { c, root } = fixture();
    c.initialize(config());
    const first = bytes(c.path("config.json"));
    c.initialize(config());
    expect(bytes(c.path("config.json"))).toEqual(first);
    expect(c.inspect().status).toBe("stopped");
    expect(existsSync(c.path("local-capability.json"))).toBe(false);
    expect(existsSync(c.store.lockPath)).toBe(false);
    expect(existsSync(join(root, ".cadence"))).toBe(false);
    expect(() => c.initialize(config(17424))).toThrow("conflict");
    expect(bytes(c.path("config.json"))).toEqual(first);
  });
  it("holds unchanged v1 lock throughout idle; exact aliases cannot create another owner", () => {
    const { c, dir, root, state } = fixture();
    const lease = c.acquire(config());
    const original = bytes(c.store.lockPath);
    const legacy = new TaskStore(root, state);
    expect(() => legacy.acquire()).toThrow("busy");
    symlinkSync(root, join(dir, "alias"), "dir");
    symlinkSync(state, join(dir, "state-alias"), "dir");
    const alias = new ServiceCoordination(
      join(dir, "alias"),
      join(dir, "state-alias"),
    );
    expect(alias.store.privateRoot).toBe(c.store.privateRoot);
    expect(() => alias.acquire(config())).toThrow();
    expect(bytes(c.store.lockPath)).toEqual(original);
    // Unrelated private logs and links are not selected or scanned.
    writeFileSync(join(c.store.privateRoot, "old.log"), "preserved", {
      mode: 0o644,
    });
    symlinkSync(root, join(c.store.privateRoot, "old-link"), "dir");
    lease.release();
    legacy.release(legacy.acquire());
    expect(readFileSync(join(c.store.privateRoot, "old.log"), "utf8")).toBe(
      "preserved",
    );
  });
  it("a supported legacy owner excludes service start without adopting its lock", () => {
    const { c } = fixture();
    const lock = c.store.acquire();
    const before = bytes(c.store.lockPath);
    expect(() => c.acquire(config())).toThrow("conflict");
    expect(bytes(c.store.lockPath)).toEqual(before);
    expect(existsSync(c.directory)).toBe(false);
    c.store.release(lock);
  });
  it("clean release permits a new epoch with no implicit queue or task replay", () => {
    const { c, root, state } = fixture();
    const a = c.acquire(config());
    const epoch = a.registration.epoch;
    a.release();
    expect(c.inspect()).toEqual({ status: "stopped", epoch });
    const again = new ServiceCoordination(root, state);
    expect(again.inspect().status).toBe("stopped");
    const b = again.acquire(config());
    expect(b.registration.epoch).not.toBe(epoch);
    expect(existsSync(join(root, ".cadence"))).toBe(false);
    b.release();
  });
  it.each(["nested-git", "submodule", "non-git", "mixed"] as const)(
    "all-root overlap in BOTH orders: %s",
    (kind) => {
      for (const reverse of [false, true]) {
        const { root, dir, state } = fixture();
        const nested = join(root, "nested");
        mkdirSync(nested);
        if (kind === "nested-git" || kind === "submodule")
          git(root, "init", "-q");
        if (kind !== "non-git") git(nested, "init", "-q");
        if (kind === "submodule") {
          // Real submodule-shaped Git worktree: separate gitdir + .git gitfile,
          // with actual superproject gitlink index entry, only in owned fixture.
          writeFileSync(join(nested, "file"), "fixture");
          seedFixtureCommit(nested);
          const commit = spawnSync("git", ["rev-parse", "HEAD"], {
            cwd: nested,
            encoding: "utf8",
          }).stdout.trim();
          const moved = join(root, ".git", "modules", "nested");
          mkdirSync(dirname(moved), { recursive: true });
          renameSync(join(nested, ".git"), moved);
          writeFileSync(
            join(nested, ".git"),
            "gitdir: ../.git/modules/nested\n",
          );
          git(
            root,
            "update-index",
            "--add",
            "--cacheinfo",
            `160000,${commit},nested`,
          );
        }
        const parent = new ServiceCoordination(root, state),
          child = new ServiceCoordination(nested, state);
        expect(child.store.root).toBe(nested);
        const [first, second] = reverse ? [child, parent] : [parent, child];
        const lease = first.acquire(config());
        expect(() => second.acquire(config(17424))).toThrow("conflict");
        expect(existsSync(second.directory)).toBe(false);
        held(lease);
        lease.release();
        expect(existsSync(join(dir, "unrelated"))).toBe(false);
      }
    },
  );
  it("disjoint linked worktrees may own independently despite shared Git metadata", () => {
    const { root, dir, c, state } = fixture();
    git(root, "init", "-q");
    writeFileSync(join(root, "file"), "fixture");
    seedFixtureCommit(root);
    const other = join(dir, "other");
    git(root, "worktree", "add", "-q", "-b", "other", other);
    const d = new ServiceCoordination(other, state);
    const a = c.acquire(config());
    const b = d.acquire(config(17424));
    held(a);
    held(b);
    a.release();
    held(b);
    b.release();
  });
  it("disjoint roots still reject a conflicting selected endpoint", () => {
    const { c, dir, state } = fixture();
    const other = join(dir, "other");
    mkdirSync(other);
    const a = c.acquire(config());
    const d = new ServiceCoordination(other, state);
    expect(() => d.acquire(config())).toThrow("conflict");
    a.release();
  });
  it("literal whitespace path bytes survive workspace/state aliases and release", () => {
    const { dir } = fixture();
    // Windows forbids tabs and trailing spaces in names; keep the legal bytes.
    const root = join(dir, posix ? " project \t" : " pro ject");
    const state = join(dir, posix ? " state " : " st ate");
    mkdirSync(root);
    git(root, "init", "-q");
    const c = new ServiceCoordination(root, state);
    const lease = c.acquire(config());
    expect(lease.registration.root).toBe(root);
    expect(lease.registration.stateHome).toBe(state);
    lease.release();
  });
  for (const name of [
    "format.json",
    "config.json",
    "registration.json",
    "owner.lock",
    "local-capability.json",
  ] as const) {
    it.each([
      "corrupt",
      "schema",
      "oversize",
      "symlink",
      "hardlink",
      ...posixModes,
    ])(`${name}: selected %s bytes are refused/preserved`, (kind) => {
      const { c, dir } = fixture();
      const lease = c.acquire(config());
      const path = c.path(name);
      if (kind === "corrupt") writeFileSync(path, "{bad");
      if (kind === "schema") writeFileSync(path, '{"schema":"future/99"}');
      if (kind === "oversize") writeFileSync(path, "x".repeat(16385));
      if (kind === "symlink") {
        renameSync(path, join(dir, "saved"));
        symlinkSync(join(dir, "saved"), path);
      }
      if (kind === "hardlink") linkSync(path, join(dir, "linked"));
      if (kind === "mode") chmodSync(path, 0o644);
      const original = bytes(path);
      expect(c.inspect().status).toBe("unavailable");
      expect(() => lease.release()).toThrow();
      expect(() => c.acquire(config())).toThrow();
      expect(bytes(path)).toEqual(original);
      held(lease);
    });
  }
  it.skipIf(!posix)(
    "private directory link/mode and injected foreign UID refuse without repair",
    () => {
      const { c, dir } = fixture();
      const lease = c.acquire(config());
      chmodSync(c.directory, 0o755);
      expect(c.inspect().status).toBe("unavailable");
      expect(() => lease.release()).toThrow();
      chmodSync(c.directory, 0o700);
      const uid = process.getuid!();
      const getuid = vi.spyOn(process, "getuid").mockReturnValue(uid + 1);
      try {
        expect(c.inspect().status).toBe("unavailable");
        expect(() => lease.release()).toThrow();
      } finally {
        getuid.mockRestore();
      }
      renameSync(c.directory, join(dir, "saved-service"));
      symlinkSync(join(dir, "saved-service"), c.directory, "dir");
      expect(c.inspect().status).toBe("unavailable");
      expect(() => lease.release()).toThrow();
    },
  );
  it.each(["registration.json", "owner.lock", "checkout.lock"])(
    "whitespace-only external %s modification prevents every release",
    (name) => {
      const { c } = fixture();
      const lease = c.acquire(config());
      const path =
        name === "checkout.lock" ? c.store.lockPath : join(c.directory, name);
      writeFileSync(path, `${bytes(path).toString()} `);
      const original = bytes(path);
      expect(() => lease.release()).toThrow("conflict");
      held(lease);
      expect(bytes(path)).toEqual(original);
    },
  );
  it.each([
    "corrupt",
    "missing-roots",
    "oversize",
    "duplicate",
    "wrong-root",
    ...posixModes,
    "hardlink",
    "symlink",
    "lock",
  ])("registry %s uncertainty fences and preserves", (kind) => {
    const { c, dir } = fixture();
    const lease = c.acquire(config());
    const path = join(c.registryDirectory, "roots.json");
    if (kind === "corrupt") writeFileSync(path, "bad");
    if (kind === "missing-roots") renameSync(path, join(dir, "saved-roots"));
    if (kind === "oversize") writeFileSync(path, "x".repeat(1024 * 1024 + 1));
    if (kind === "duplicate" || kind === "wrong-root") {
      const v = JSON.parse(bytes(path).toString());
      if (kind === "duplicate") v.entries.push(v.entries[0]);
      else v.entries[0].root = join(dir, "missing");
      writeFileSync(path, JSON.stringify(v));
    }
    if (kind === "mode") chmodSync(path, 0o644);
    if (kind === "hardlink") linkSync(path, join(dir, "linked"));
    if (kind === "symlink") {
      renameSync(path, join(dir, "saved"));
      symlinkSync(join(dir, "saved"), path);
    }
    if (kind === "lock")
      writeFileSync(registryLock(c), "uncertain", { mode: 0o600 });
    const original = existsSync(path) ? bytes(path) : null;
    expect(c.inspect().status).toBe("unavailable");
    expect(() => lease.release()).toThrow();
    held(lease);
    expect(() => c.acquire(config())).toThrow();
    if (original) expect(bytes(path)).toEqual(original);
    if (kind === "lock")
      expect(readFileSync(registryLock(c), "utf8")).toBe("uncertain");
  });
  // chmod 0o500 does not deny writes on Windows.
  it.skipIf(!posix)(
    "actual denied persistence retains original owner/v1 bytes and reservation",
    async () => {
      const { c } = fixture();
      const lease = c.acquire(config());
      const before = bytes(c.store.lockPath);
      chmodSync(c.directory, 0o500);
      const owner = new ServiceOwner(lease, ports());
      expect((await owner.stop(100)).state).toBe("quarantined");
      expect(bytes(c.store.lockPath)).toEqual(before);
      held(lease);
      expect(() => c.acquire(config())).toThrow();
      chmodSync(c.directory, 0o700); // Restore only this fixture's mode; no fence cleanup.
    },
  );
  it("partial initialization and pending temporaries are never adopted or removed", () => {
    const { c } = fixture();
    c.files.directory(c.directory, true);
    writeFileSync(c.path("config.json"), "partial", { mode: 0o600 });
    expect(() => c.initialize(config())).toThrow();
    expect(c.inspect().status).toBe("unavailable");
    expect(readFileSync(c.path("config.json"), "utf8")).toBe("partial");
    const f = fixture();
    const lease = f.c.acquire(config());
    writeFileSync(
      join(f.c.directory, `pending-${randomUUID()}.json`),
      "partial",
      { mode: 0o600 },
    );
    expect(f.c.inspect().status).toBe("unavailable");
    // A lease must also notice newly appeared unknown namespace entries.
    expect(() => f.c.acquire(config())).toThrow();
    expect(() => lease.release()).toThrow();
    held(lease);
  });
});

describe("native second-process owners (original close handles)", () => {
  it("concurrent starts admit exactly one; a second-process legacy writer is blocked while idle", async () => {
    const { root, state, c } = fixture();
    const a = await childOwner(root, state),
      b = await childOwner(root, state);
    try {
      a.child.send("legacy");
      expect(await a.next()).toEqual({ type: "legacy-acquired" });
      a.child.send("start");
      b.child.send("start");
      const messages = await Promise.all([a.next(), b.next()]);
      expect(messages.map((m) => m.type).sort()).toEqual([
        "acquired",
        "refused",
      ]);
      b.child.send("legacy");
      expect(await b.next()).toEqual({ type: "legacy-refused" });
      expect(c.inspect().status).toBe("unavailable");
    } finally {
      await Promise.all([a.finish(), b.finish()]);
    }
    expect(c.inspect().status).toBe("stopped");
  }, 15000);
  it.each([false, true])(
    "native nested repository reservation conflict reverse=%s",
    async (reverse) => {
      const { root, state, c } = fixture();
      git(root, "init", "-q");
      const nested = join(root, "nested");
      mkdirSync(nested);
      git(nested, "init", "-q");
      const a = await childOwner(reverse ? nested : root, state);
      try {
        a.child.send("start");
        expect((await a.next()).type).toBe("acquired");
        const other = reverse ? c : new ServiceCoordination(nested, state);
        expect(() => other.acquire(config(17424))).toThrow("conflict");
      } finally {
        await a.finish();
      }
    },
    15000,
  );
  it("simultaneous distinct nested roots reserve atomically, not only exact-root races", async () => {
    const { root, state } = fixture();
    git(root, "init", "-q");
    const nested = join(root, "nested");
    mkdirSync(nested);
    git(nested, "init", "-q");
    const a = await childOwner(root, state, 17423);
    const b = await childOwner(nested, state, 17424);
    try {
      a.child.send("start");
      b.child.send("start");
      const messages = await Promise.all([a.next(), b.next()]);
      expect(messages.map((m) => m.type).sort()).toEqual([
        "acquired",
        "refused",
      ]);
    } finally {
      await Promise.all([a.finish(), b.finish()]);
    }
  }, 15000);
  it("a valid-looking old short registry lock is not reclaimed from age or a known dead PID", async () => {
    const { c, root, state } = fixture();
    const child = await childOwner(root, state);
    child.child.send("start");
    expect((await child.next()).type).toBe("acquired");
    const pid = child.child.pid;
    await child.finish(); // Original native close proves this fixture PID exited.
    const path = registryLock(c);
    writeFileSync(
      path,
      JSON.stringify({
        schema: "cadence-service-registry-lock/1",
        token: randomUUID(),
        pid,
        host: hostname(),
      }),
      { mode: 0o600 },
    );
    utimesSync(path, new Date(0), new Date(0));
    const before = bytes(path);
    expect(c.inspect().status).toBe("unavailable");
    expect(() => c.acquire(config())).toThrow();
    await expect(inspectRecovery(c)).rejects.toThrow("quarantine");
    expect(bytes(path)).toEqual(before);
    expect(existsSync(c.store.lockPath)).toBe(false);
  }, 15000);
  it("abrupt original exit never replays/reclaims; recovery facts are independent and exact", async () => {
    const { root, state, c } = fixture();
    const child = await childOwner(root, state);
    child.child.send("start");
    const acquired = await child.next();
    expect(acquired.type).toBe("acquired");
    const live = await inspectRecovery(c);
    expect(live.owner).toBe("live");
    // A body boolean is deliberately not local interactive authority.
    await expect(
      resolveRecovery(
        c,
        {
          informedLocalConfirmation: true,
          acknowledgeEscapedProcesses: true,
          expected: live,
        } as any,
        undefined as any,
      ),
    ).rejects.toThrow("forbidden");
    await child.finish(true);
    const before = bytes(c.store.lockPath);
    const restarted = new ServiceCoordination(root, state);
    expect(() => restarted.acquire(config())).toThrow("conflict");
    const facts: RecoveryHistoryFacts = {
      digest: "b".repeat(64),
      processes: "unknown",
      credentials: "unknown",
      storage: "unknown",
    };
    const history = { inspect: async () => ({ ...facts }) };
    const observed = await inspectRecovery(restarted, history);
    expect(observed.owner).toBe("absent");
    for (const settled of [false, true]) {
      if (settled) {
        facts.processes = "externally-resolved";
        facts.credentials = "independently-resolved";
        facts.storage = "independently-resolved";
      }
      const expected = await inspectRecovery(restarted, history);
      await expect(
        resolveRecovery(
          restarted,
          {
            informedLocalConfirmation: true,
            acknowledgeEscapedProcesses: true,
            expected,
          } as any,
          history as any,
        ),
      ).rejects.toThrow("forbidden");
    }
    const fresh = await inspectRecovery(restarted, history);
    writeFileSync(
      c.path("registration.json"),
      `${bytes(c.path("registration.json")).toString()} `,
    );
    expect(
      (await inspectRecovery(restarted, history)).coordinationDigest,
    ).not.toBe(fresh.coordinationDigest);
    expect(bytes(c.store.lockPath)).toEqual(before);
    expect(existsSync(join(root, ".cadence"))).toBe(false);
  }, 15000);
});

describe("owner lifecycle with explicitly injected accounting/listener boundaries", () => {
  it("reentrant stop from quiesce shares one original drain and release", async () => {
    const { c } = fixture();
    const lease = c.acquire(config());
    const p = ports();
    const flush = vi.fn(p.flush);
    const close = vi.fn(p.closeListener);
    p.flush = flush;
    p.closeListener = close;
    const owner = new ServiceOwner(lease, p);
    let nested: ReturnType<ServiceOwner["stop"]> | undefined;
    p.quiesce = () => {
      nested = owner.stop(1000);
    };
    const first = owner.stop(1000);
    const reports = await Promise.all([first, nested!]);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(reports.map((r) => r.state)).toEqual(["stopped", "stopped"]);
    expect(owner.state).toBe("stopped");
    expect(c.inspect().status).toBe("stopped");
  });
  it("a late successful listener close is retained across a NEW explicit stop", async () => {
    const { c } = fixture();
    const lease = c.acquire(config());
    const gate = deferred<void>();
    const p = ports();
    const close = vi.fn(() => {
      if (close.mock.calls.length > 1)
        throw new Error("listener already closed");
      return gate.promise;
    });
    p.closeListener = close;
    const owner = new ServiceOwner(lease, p);
    expect((await owner.stop(10)).state).toBe("quarantined");
    gate.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    held(lease); // Original close settlement is not automatic release authority.
    const report = await owner.stop(1000);
    expect(close).toHaveBeenCalledTimes(1);
    expect(report.state).toBe("stopped");
  });
  it("native listener close settles once after the reporting bound (no HTTP composition)", async () => {
    const { c } = fixture();
    const lease = c.acquire(config());
    const server = createServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("fixture endpoint");
    const accepted = once(server, "connection");
    const client = createConnection({ host: "127.0.0.1", port: address.port });
    const connected = once(client, "connect");
    const [socket] = await accepted;
    await connected;
    const p = ports();
    let closes = 0;
    p.closeListener = () => {
      closes++;
      return new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    };
    const owner = new ServiceOwner(lease, p);
    try {
      const closed = once(server, "close");
      expect((await owner.stop(10)).state).toBe("quarantined");
      held(lease);
      socket.destroy();
      client.destroy();
      await closed;
      await new Promise((resolve) => setImmediate(resolve));
      held(lease);
      const report = await owner.stop(1000);
      expect(report.state).toBe("stopped");
      expect(closes).toBe(1);
    } finally {
      socket.destroy();
      client.destroy();
      if (server.listening)
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("lease loss during original drain prevents a new flush", async () => {
    const { c } = fixture();
    const lease = c.acquire(config());
    const p = ports();
    const flush = vi.fn(p.flush);
    p.flush = flush;
    const owner = new ServiceOwner(lease, p);
    const gate = deferred<CheckNativeSettlement>();
    owner.trackCheck(gate.promise, () => {});
    const stopping = owner.stop(1000);
    writeFileSync(c.store.lockPath, `${bytes(c.store.lockPath).toString()} `);
    gate.resolve(native);
    expect((await stopping).state).toBe("quarantined");
    expect(flush).not.toHaveBeenCalled();
    held(lease);
  });
  it("each stop callback rechecks ownership after a previous callback loses it", async () => {
    const { c } = fixture();
    const lease = c.acquire(config());
    const owner = new ServiceOwner(lease, ports());
    const a = deferred<CheckNativeSettlement>(),
      b = deferred<CheckNativeSettlement>();
    const laterStop = vi.fn();
    owner.trackCheck(a.promise, () => {
      writeFileSync(c.store.lockPath, `${bytes(c.store.lockPath).toString()} `);
    });
    owner.trackCheck(b.promise, laterStop);
    const stopping = owner.stop(1000);
    a.resolve(native);
    b.resolve(native);
    expect((await stopping).state).toBe("quarantined");
    expect(laterStop).not.toHaveBeenCalled();
    held(lease);
  });
  it.each([
    "config.json",
    "registration.json",
    "registry.lock",
    "roots.json",
    "registry-format",
  ] as const)(
    "release preserves remaining fences when %s changes after the first removal",
    async (name) => {
      const { c, root, state } = fixture();
      const lease = c.acquire(config());
      const path =
        name === "registry.lock" ||
        name === "roots.json" ||
        name === "registry-format"
          ? join(
              c.registryDirectory,
              name === "registry-format" ? "format.json" : name,
            )
          : c.path(name);
      let changed: Buffer | undefined;
      const remove = c.files.remove.bind(c.files);
      const spy = vi
        .spyOn(c.files, "remove")
        .mockImplementation((target, expected, max) => {
          remove(target, expected, max);
          if (target === c.path("local-capability.json")) {
            writeFileSync(path, `${bytes(path).toString()} `);
            changed = bytes(path);
          }
        });
      try {
        const owner = new ServiceOwner(lease, ports());
        const report = await owner.stop(1000);
        // Actual filesystem exclusion, with mutation injected at a selected
        // release boundary; NOT a claim of hostile-writer atomicity.
        const legacy = await childOwner(root, state);
        try {
          legacy.child.send("legacy");
          expect(await legacy.next()).toEqual({ type: "legacy-refused" });
        } finally {
          await legacy.finish();
        }
        expect(report.state).toBe("quarantined");
        held(lease);
        expect(bytes(path)).toEqual(changed);
        expect(existsSync(registryLock(c))).toBe(true);
      } finally {
        spy.mockRestore();
      }
    },
  );
  it("a change after owner-lock removal still retains the last v1 fence", async () => {
    const { c } = fixture();
    const lease = c.acquire(config());
    const remove = c.files.remove.bind(c.files);
    const spy = vi
      .spyOn(c.files, "remove")
      .mockImplementation((path, expected, max) => {
        remove(path, expected, max);
        if (path === c.path("owner.lock")) {
          writeFileSync(
            c.path("config.json"),
            `${bytes(c.path("config.json")).toString()} `,
          );
        }
      });
    try {
      expect((await new ServiceOwner(lease, ports()).stop()).state).toBe(
        "quarantined",
      );
      expect(existsSync(c.path("owner.lock"))).toBe(false); // No rollback/recreation.
      expect(existsSync(c.store.lockPath)).toBe(true);
      expect(existsSync(registryLock(c))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
  it("refused late originals remain separately visible as pending auth and storage", async () => {
    const { c } = fixture();
    const lease = c.acquire(config());
    const owner = new ServiceOwner(lease, ports());
    const processGate = deferred<CheckNativeSettlement>();
    const auth = deferred<unknown>(),
      recorded = deferred<PersistenceResult>();
    owner.trackCheck(processGate.promise, () => {});
    const stopping = owner.stop(10);
    expect(() => owner.trackAuth(auth.promise, recorded.promise)).toThrow(
      "quarantine",
    );
    const report = await stopping;
    expect(report.pending).toEqual({
      process: 1,
      auth: 1,
      storage: 1,
      work: 0,
    });
    processGate.resolve(native);
    auth.resolve("fabricated");
    await new Promise((resolve) => setImmediate(resolve));
    expect((await owner.stop(10)).pending).toEqual({
      process: 0,
      auth: 0,
      storage: 1,
      work: 0,
    });
    recorded.resolve(committed);
    await new Promise((resolve) => setImmediate(resolve));
    expect((await owner.stop()).state).toBe("quarantined");
    held(lease);
  });
  it("non-accepting by construction; detach preserves idle locks", async () => {
    const { c } = fixture();
    const lease = c.acquire(config());
    const owner = new ServiceOwner(lease, ports());
    expect(() => owner.execution()).toThrow("unavailable");
    owner.detach();
    held(lease);
    expect((await owner.stop()).state).toBe("stopped");
    expect(existsSync(c.store.lockPath)).toBe(false);
  });
  it("stop closes admission first and requests all process stops before any original settles", async () => {
    const { c } = fixture();
    const lease = c.acquire(config());
    const events: string[] = [];
    const owner = new ServiceOwner(lease, ports(events));
    const a = deferred<CheckNativeSettlement>(),
      b = deferred<CheckNativeSettlement>();
    owner.trackCheck(a.promise, () => {
      events.push("stop-a");
    });
    owner.trackCheck(b.promise, () => {
      events.push("stop-b");
    });
    const stopped = owner.stop(1000);
    expect(events).toEqual(["quiesce", "stop-a", "stop-b"]);
    expect(() => owner.execution()).toThrow("unavailable");
    a.resolve(native);
    await Promise.resolve();
    held(lease);
    expect(events).not.toContain("flush");
    b.resolve(native);
    expect((await stopped).state).toBe("stopped");
    expect(events.slice(-2)).toEqual(["flush", "close-listener"]);
  });
  it.each(["process", "auth", "storage"] as const)(
    "pending ORIGINAL %s retains fences after reporting bound and late settlement",
    async (kind) => {
      const { c } = fixture();
      const lease = c.acquire(config());
      const events: string[] = [];
      const owner = new ServiceOwner(lease, ports(events));
      const gate = deferred<any>();
      if (kind === "process") owner.trackCheck(gate.promise, () => {});
      if (kind === "auth")
        owner.trackAuth(gate.promise, Promise.resolve(committed));
      if (kind === "storage") owner.trackPersistence(gate.promise);
      const report = await owner.stop(10);
      expect(report.state).toBe("quarantined");
      expect(report.pending[kind]).toBe(1);
      held(lease);
      expect(events).not.toContain("close-listener");
      gate.resolve(kind === "process" ? native : committed);
      await new Promise((resolve) => setImmediate(resolve));
      held(lease);
      expect(owner.state).toBe("quarantined");
      expect(events).not.toContain("close-listener");
      // A NEW explicit stop, not late resolution, permits known-clean release.
      expect((await owner.stop()).state).toBe("stopped");
    },
  );
  it("concurrent stop reporting bounds cannot turn late drain into automatic release", async () => {
    const { c } = fixture();
    const lease = c.acquire(config());
    const p = ports();
    const flush = vi.fn(p.flush);
    p.flush = flush;
    const owner = new ServiceOwner(lease, p);
    const gate = deferred<CheckNativeSettlement>();
    const stop = vi.fn();
    owner.trackCheck(gate.promise, stop);
    const short = owner.stop(10),
      long = owner.stop(1000);
    expect((await short).state).toBe("quarantined");
    gate.resolve(native);
    expect((await long).state).toBe("quarantined");
    expect(stop).toHaveBeenCalledTimes(1);
    expect(flush).not.toHaveBeenCalled();
    held(lease);
    expect((await owner.stop()).state).toBe("stopped");
  });
  it("auth settlement write remains independently pending after original auth resolved", async () => {
    const { c } = fixture();
    const lease = c.acquire(config());
    const owner = new ServiceOwner(lease, ports());
    const recorded = deferred<PersistenceResult>();
    owner.trackAuth(
      Promise.resolve("fabricated-not-retained"),
      recorded.promise,
    );
    const report = await owner.stop(10);
    expect(report.pending).toEqual({
      process: 0,
      auth: 0,
      storage: 1,
      work: 0,
    });
    held(lease);
    recorded.resolve({
      status: "refused",
      error: publicError("recording-exhausted", "uncertain"),
      durability: "uncertain",
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect((await owner.stop()).state).toBe("quarantined");
    held(lease);
  });
  it.each([
    "unknown-process",
    "auth-reject",
    "storage-refuse",
    "stop-reject",
    "listener-reject",
  ])("%s never becomes clean from promise settlement", async (kind) => {
    const { c } = fixture();
    const lease = c.acquire(config());
    const p = ports();
    const owner = new ServiceOwner(lease, p);
    if (kind === "unknown-process")
      owner.trackCheck(
        Promise.resolve({
          ...native,
          outcome: "unknown",
          closure: "unconfirmed",
        }),
        () => {},
      );
    if (kind === "auth-reject")
      owner.trackAuth(
        Promise.reject(new Error("opaque")),
        Promise.resolve(committed),
      );
    if (kind === "storage-refuse")
      owner.trackPersistence(
        Promise.resolve({
          status: "refused",
          error: publicError("recording-exhausted"),
          durability: "uncertain",
        }),
      );
    if (kind === "stop-reject")
      owner.trackCheck(Promise.resolve(native), async () => {
        throw new Error("opaque");
      });
    if (kind === "listener-reject")
      p.closeListener = async () => {
        throw new Error("opaque");
      };
    expect((await owner.stop()).state).toBe("quarantined");
    held(lease);
    expect((await owner.stop()).state).toBe("quarantined");
    held(lease);
  });
  it("worker durability uncertainty fences despite genuine known-close DTO (injected worker port)", async () => {
    const { c } = fixture();
    const lease = c.acquire(config());
    const owner = new ServiceOwner(lease, ports());
    owner.trackWorker(
      Promise.resolve({
        childRunId: randomUUID(),
        selected: null,
        recording: { status: "uncertain", selected: null },
        native: {
          ...native,
          stdin: "delivered",
          final: "missing",
          cleanup: "settled",
          capture: {
            observed: "complete",
            source: "complete",
            redacted: false,
            omissions: [],
          },
        },
      }),
      () => {},
    );
    expect((await owner.stop()).state).toBe("quarantined");
    held(lease);
  });
  it("late original registration is refused AND fences, not silently lost accounting", async () => {
    const { c } = fixture();
    const lease = c.acquire(config());
    const owner = new ServiceOwner(lease, ports());
    const a = deferred<CheckNativeSettlement>();
    owner.trackCheck(a.promise, () => {});
    const stopped = owner.stop(1000);
    expect(() =>
      owner.trackAuth(
        Promise.resolve("fabricated"),
        Promise.resolve(committed),
      ),
    ).toThrow("quarantine");
    a.resolve(native);
    expect((await stopped).state).toBe("quarantined");
    held(lease);
  });
  it("ownership loss does not signal an old PID or release modified fences", async () => {
    const { c } = fixture();
    const lease = c.acquire(config());
    const owner = new ServiceOwner(lease, ports());
    const a = deferred<CheckNativeSettlement>();
    const stop = vi.fn();
    owner.trackCheck(a.promise, stop);
    writeFileSync(c.store.lockPath, `${bytes(c.store.lockPath).toString()} `);
    const stopping = owner.stop(1000);
    expect(stop).not.toHaveBeenCalled();
    a.resolve(native);
    expect((await stopping).state).toBe("quarantined");
    held(lease);
  });
  it("original pending flush or listener close cannot be replaced by reporting timeout", async () => {
    for (const kind of ["flush", "listener"]) {
      const { c } = fixture();
      const lease = c.acquire(config());
      const gate = deferred<any>();
      const p = ports();
      if (kind === "flush") p.flush = () => gate.promise;
      else p.closeListener = () => gate.promise;
      const owner = new ServiceOwner(lease, p);
      expect((await owner.stop(10)).state).toBe("quarantined");
      held(lease);
      gate.resolve(committed);
      await new Promise((resolve) => setImmediate(resolve));
      held(lease);
    }
  });
  it.each([
    ["flush", false],
    ["listener", false],
    ["flush", true],
    ["listener", true],
  ] as const)(
    "retains history originals registered during %s (rejected=%s) before any release",
    async (boundary, rejected) => {
      const { c } = fixture();
      const lease = c.acquire(config());
      const write = deferred<PersistenceResult>();
      const entered = deferred<void>();
      const p = ports();
      const owner = new ServiceOwner(lease, p);
      const register = () => {
        owner.trackHistory(write.promise, true);
        entered.resolve();
        if (rejected) throw new Error("fixture uncertain lifecycle boundary");
      };
      if (boundary === "flush")
        p.flush = async () => {
          register();
          return committed;
        };
      else
        p.closeListener = async () => {
          register();
        };
      const stop = owner.stop(10);
      await entered.promise;
      const report = await stop;
      expect(report.state).toBe("quarantined");
      expect(report.pending.storage).toBe(1);
      held(lease);
      write.resolve(committed);
      await new Promise((resolve) => setImmediate(resolve));
      held(lease); // late settlement never repairs the expired reporting bound
      expect((await owner.stop(1000)).state).toBe(
        rejected ? "quarantined" : "stopped",
      );
      if (rejected) held(lease);
    },
  );
  it("unknown failed release keeps remaining v1 and registry fence; no rollback/reset", async () => {
    const { c } = fixture();
    const lease = c.acquire(config());
    const fail = vi.spyOn(c.store, "release").mockImplementation(() => {
      throw new Error("injected release failure");
    });
    try {
      const owner = new ServiceOwner(lease, ports());
      expect((await owner.stop()).state).toBe("quarantined");
      expect(existsSync(c.store.lockPath)).toBe(true);
      expect(existsSync(registryLock(c))).toBe(true);
      expect(() => c.acquire(config())).toThrow();
    } finally {
      fail.mockRestore();
    }
  });
  it("real process activity waits the original child close, not a requested stop or client detach", async () => {
    const { c } = fixture();
    const lease = c.acquire(config());
    const owner = new ServiceOwner(lease, ports());
    const child = spawn(
      process.execPath,
      [
        "-e",
        "process.stdout.write('ready');process.stdin.resume();process.stdin.on('end',()=>process.exit(0))",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const closed = once(child, "close");
    const watchdog = setTimeout(() => child.kill("SIGKILL"), 5000);
    try {
      await once(child.stdout, "data");
      owner.trackCheck(
        closed.then(([exitCode, signal]) => ({ ...native, exitCode, signal })),
        () => {},
      );
      owner.detach();
      const report = await owner.stop(10);
      expect(report.pending.process).toBe(1);
      held(lease);
      child.stdin.end();
      const [code, signal] = await closed;
      expect(code).toBe(0);
      expect(signal).toBeNull();
      await new Promise((resolve) => setImmediate(resolve));
      held(lease);
      expect((await owner.stop()).state).toBe("stopped");
    } finally {
      child.stdin.end();
      await closed;
      clearTimeout(watchdog);
    }
  }, 10000);
});

describe("requested port-zero policy versus actual registration endpoint", () => {
  it("keeps requested policy bytes while explicit starts register distinct native bound ports", async () => {
    const f = fixture(),
      policy = config(0);
    f.c.initialize(policy);
    const original = readFileSync(f.c.path("config.json"));
    for (let i = 0; i < 2; i++) {
      const server = createServer();
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("fixture address");
      const endpoint = `http://127.0.0.1:${address.port}`;
      const lease = f.c.acquire(policy, endpoint);
      expect(lease.registration.endpoint).toBe(endpoint);
      expect(readFileSync(f.c.path("config.json"))).toEqual(original);
      expect(f.c.inspect().status).toBe("unavailable"); // file state is NOT HTTP readiness
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
      lease.release();
      expect(f.c.inspect().status).toBe("stopped");
    }
  });
  it("refuses unresolved port0 and substituted resolved host/positive port before reservation", () => {
    const f = fixture();
    expect(() => f.c.acquire(config(0))).toThrow();
    expect(() => f.c.acquire(config(0), "http://[::1]:12345")).toThrow();
    expect(() =>
      f.c.acquire(config(12345), "http://127.0.0.1:12346"),
    ).toThrow();
    expect(f.c.inspect().status).toBe("absent");
    expect(existsSync(f.c.registryDirectory)).toBe(false);
  });
  it("recognizes access/config files without adopting their content or weakening lease assertions", () => {
    const f = fixture(),
      lease = f.c.acquire(config());
    f.c.files.create(
      f.c.path("access.json"),
      '{"selected":"auth-owner-validates"}\n',
    );
    f.c.files.create(
      f.c.path("access-config.json"),
      '{"selected":"auth-owner-validates"}\n',
    );
    lease.assert();
    lease.release();
    expect(readFileSync(f.c.path("access.json"), "utf8")).toContain(
      "auth-owner-validates",
    );
  });
});

describe("accepted control-flow lifetime (injected dispositions, real lease)", () => {
  it.each(["uncertain", "reject"] as const)(
    "%s cannot turn a completed work promise into clean release",
    async (outcome) => {
      const { c } = fixture(),
        lease = c.acquire(config());
      const events: string[] = [],
        owner = new ServiceOwner(lease, ports(events));
      const work =
        deferred<import("../src/service/owner.ts").AcceptedWorkResult>();
      owner.trackAccepted(work.promise);
      const stopped = owner.stop(1000);
      expect(owner.acceptedPending).toBe(1);
      expect(events).toEqual(["quiesce"]);
      if (outcome === "reject") work.reject(new Error("opaque"));
      else work.resolve({ status: "uncertain" });
      expect((await stopped).state).toBe("quarantined");
      expect(events).not.toContain("flush");
      held(lease);
    },
  );
  it("single action quiesce is synchronous/reentrant and joins safety originals registered by the whole-work tail", async () => {
    const { c } = fixture(),
      lease = c.acquire(config());
    const events: string[] = [],
      owner = new ServiceOwner(lease, ports(events));
    const work =
      deferred<import("../src/service/owner.ts").AcceptedWorkResult>();
    const safety = deferred<PersistenceResult>();
    let nested: ReturnType<ServiceOwner["stop"]> | undefined;
    owner.registerActions(() => {
      events.push("actions");
      nested = owner.stop(1000);
    });
    expect(() => owner.registerActions(() => {})).toThrow("conflict");
    const original = work.promise.then((result) => {
      owner.trackHistory(safety.promise, true);
      return result;
    });
    owner.trackAccepted(original);
    const stopped = owner.stop(1000);
    expect(events).toEqual(["actions", "quiesce"]);
    work.resolve({ status: "settled" });
    await original;
    await Promise.resolve();
    expect(events).not.toContain("flush");
    held(lease);
    safety.resolve(committed);
    expect((await stopped).state).toBe("stopped");
    expect((await nested)?.state).toBe("stopped");
    expect(events.filter((s) => s === "flush")).toHaveLength(1);
  });
});
