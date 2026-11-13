import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  statfsSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  assertTemporaryDirectory,
  RUN_TEMP_DIRECTORY,
  RunEnvironment,
} from "../src/service/run-environment.ts";

vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return {
    ...fs,
    statfsSync: vi.fn(fs.statfsSync),
    lstatSync: vi.fn(fs.lstatSync),
  };
});
beforeEach(async () => {
  const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
  vi.mocked(statfsSync).mockImplementation(fs.statfsSync);
  vi.mocked(lstatSync).mockImplementation(fs.lstatSync);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "run-environment-"));
  const cwd = join(root, "project"),
    stateHome = join(root, "state");
  mkdirSync(cwd);
  mkdirSync(stateHome);
  const records: unknown[] = [];
  const record = vi.fn((entries: unknown) => {
    records.push(structuredClone(entries));
  });
  const current = vi.fn();
  const environment = new RunEnvironment(stateHome, cwd, record, current);
  return { root, cwd, stateHome, records, record, current, environment };
}
it("construction is inert; a command gets a fresh compliant environment without adopting inherited variables", async () => {
  const f = fixture();
  const consumer = join(f.root, "consumer");
  mkdirSync(consumer);
  writeFileSync(join(consumer, "keep"), "consumer data");
  for (const name of ["TMPDIR", "TEMP", "TMP"]) vi.stubEnv(name, consumer);
  expect(f.records).toEqual([]);
  expect(readdirSync(f.stateHome)).toEqual([]);
  f.record.mockImplementationOnce((entries: any) => {
    expect(entries[0].identity).toBeNull();
    expect(existsSync(entries[0].path)).toBe(false); // intent before effects
    expect(existsSync(join(f.stateHome, RUN_TEMP_DIRECTORY))).toBe(false);
  });
  const env = f.environment.forWorkspace(f.cwd);
  expect(env).toEqual({
    TMPDIR: env.TMPDIR,
    TEMP: env.TMPDIR,
    TMP: env.TMPDIR,
  });
  expect(dirname(env.TMPDIR)).toBe(join(f.stateHome, RUN_TEMP_DIRECTORY));
  expect(readdirSync(f.stateHome)).toEqual([RUN_TEMP_DIRECTORY]);
  expect(readdirSync(f.root).sort()).toEqual(["consumer", "project", "state"]);
  expect(env.TMPDIR).not.toBe(consumer);
  expect(Object.isFrozen(env)).toBe(true);
  expect(() => assertTemporaryDirectory(f.cwd, env.TMPDIR)).not.toThrow();
  if (process.platform !== "win32")
    expect(lstatSync(env.TMPDIR).mode & 0o777).toBe(0o700);
  expect(process.env.TMPDIR).toBe(consumer);
  expect(await f.environment.finish(true)).toEqual([]);
  expect(existsSync(env.TMPDIR)).toBe(false);
  expect(readdirSync(dirname(env.TMPDIR))).toEqual([]); // Keep the designated pool.
  expect(readFileSync(join(consumer, "keep"), "utf8")).toBe("consumer data");
});
it("workspaces and runs are isolated; sequential commands and recovery keep the same directory and evidence", async () => {
  const f = fixture();
  const child = join(f.root, "child");
  mkdirSync(child);
  const first = f.environment.forWorkspace(f.cwd);
  writeFileSync(join(first.TMPDIR, "report"), "first failed check");
  expect(f.environment.forWorkspace(f.cwd)).toEqual(first);
  expect(readFileSync(join(first.TMPDIR, "report"), "utf8")).toBe(
    "first failed check",
  );
  const parallel = f.environment.forWorkspace(child);
  const other = new RunEnvironment(
    f.stateHome,
    f.cwd,
    () => {},
    () => {},
  );
  const separate = other.forWorkspace(f.cwd);
  expect(new Set([first.TMPDIR, parallel.TMPDIR, separate.TMPDIR]).size).toBe(
    3,
  );
  for (const env of [first, parallel, separate])
    expect(() => assertTemporaryDirectory(f.cwd, env.TMPDIR)).not.toThrow();
  expect(await f.environment.finish(false)).toEqual([
    first.TMPDIR,
    parallel.TMPDIR,
  ]);
  expect(existsSync(first.TMPDIR)).toBe(true);
  await other.finish(true);
});
it.each(["tmpfs", "other-disk"])(
  "an unsuitable state filesystem (%s) refuses without scattering a fallback beside the workspace",
  (kind) => {
    const f = fixture();
    if (kind === "tmpfs") {
      const original = vi.mocked(statfsSync).getMockImplementation()!;
      vi.mocked(statfsSync).mockImplementation(((path: any, options: any) => ({
        ...original(path, options),
        ...(path === f.stateHome ? { type: 0x01021994 } : {}),
      })) as typeof statfsSync);
    } else {
      const original = vi.mocked(lstatSync).getMockImplementation()!;
      vi.mocked(lstatSync).mockImplementation(((path: any, options: any) => {
        const stat = original(path, options);
        if (path === f.stateHome && stat) stat.dev = Number(stat.dev) + 1;
        return stat;
      }) as typeof lstatSync);
    }
    expect(() => f.environment.forWorkspace(f.cwd)).toThrow(
      "no fallback location was created",
    );
    expect(f.record).not.toHaveBeenCalled();
    expect(readdirSync(f.stateHome)).toEqual([]);
    expect(readdirSync(f.root).sort()).toEqual(["project", "state"]);
  },
);
it("no eligible filesystem is a concrete owner failure, not a model repair or an allocation", () => {
  const f = fixture();
  const original = vi.mocked(statfsSync).getMockImplementation()!;
  vi.mocked(statfsSync).mockImplementation(((path: any, options: any) => ({
    ...original(path, options),
    type: 0x01021994,
  })) as typeof statfsSync);
  expect(() => f.environment.forWorkspace(f.cwd)).toThrow(
    "centralized temporary directory",
  );
  expect(f.record).not.toHaveBeenCalled();
});
it("state home inside Git is refused without a workspace-parent fallback", () => {
  const f = fixture();
  execFileSync("git", ["init", "-q", f.stateHome]);
  expect(() => f.environment.forWorkspace(f.cwd)).toThrow(
    "no fallback location was created",
  );
  expect(f.record).not.toHaveBeenCalled();
  expect(readdirSync(f.stateHome)).toEqual([".git"]);
  expect(readdirSync(f.root).sort()).toEqual(["project", "state"]);
});
it("a failed creation journal creates nothing; a failed ready journal retains its actual directory", async () => {
  const f = fixture();
  let intended = "";
  f.record.mockImplementationOnce((entries: any) => {
    intended = entries[0].path;
    throw new Error("record failed");
  });
  expect(() => f.environment.forWorkspace(f.cwd)).toThrow("record failed");
  expect(existsSync(intended)).toBe(false);
  expect(readdirSync(f.stateHome)).toEqual([]); // No pool before durable intent.
  const other = new RunEnvironment(
    f.stateHome,
    f.cwd,
    (entries) => {
      intended = entries[0].path;
      if (entries[0].identity) throw new Error("ready record failed");
    },
    () => {},
  );
  expect(() => other.forWorkspace(f.cwd)).toThrow("ready record failed");
  expect(await other.finish(false)).toEqual([intended]);
  expect(existsSync(intended)).toBe(true);
});
it("a replaced root is never adopted or deleted, and failure preserves the original evidence", async () => {
  const f = fixture();
  const env = f.environment.forWorkspace(f.cwd);
  const saved = `${env.TMPDIR}-saved`;
  renameSync(env.TMPDIR, saved);
  mkdirSync(env.TMPDIR, { mode: 0o700 });
  writeFileSync(join(env.TMPDIR, "keep"), "not our directory");
  expect(() => f.environment.forWorkspace(f.cwd)).toThrow("changed");
  expect(await f.environment.finish(true)).toEqual([env.TMPDIR]);
  expect(existsSync(saved)).toBe(true);
  expect(readFileSync(join(env.TMPDIR, "keep"), "utf8")).toBe(
    "not our directory",
  );
});
it("cleanup removes owned scratch, not a symlink target or an old run; lost authority retains it", async () => {
  const f = fixture();
  const env = f.environment.forWorkspace(f.cwd);
  const outside = join(f.root, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "keep"), "untouched");
  symlinkSync(
    outside,
    join(env.TMPDIR, "link"),
    process.platform === "win32" ? "junction" : "dir",
  );
  f.current.mockImplementation(() => {
    throw new Error("owner changed");
  });
  expect(await f.environment.finish(true)).toEqual([env.TMPDIR]);
  expect(existsSync(env.TMPDIR)).toBe(true);
  f.current.mockImplementation(() => {});
  expect(await f.environment.finish(true)).toEqual([]);
  expect(existsSync(env.TMPDIR)).toBe(false);
  expect(readFileSync(join(outside, "keep"), "utf8")).toBe("untouched");
});

for (const kind of ["file", "symlink", "permissions"]) {
  it.skipIf(kind === "permissions" && process.platform === "win32")(
    `an unsafe existing pool (${kind}) is not repaired or used, and creates no fallback`,
    () => {
      const f = fixture();
      const pool = join(f.stateHome, RUN_TEMP_DIRECTORY);
      const other = join(f.root, "unrelated");
      mkdirSync(other, { mode: 0o700 });
      writeFileSync(join(other, "keep"), "unrelated data");
      if (kind === "file") writeFileSync(pool, "not a pool");
      else if (kind === "symlink")
        symlinkSync(
          other,
          pool,
          process.platform === "win32" ? "junction" : "dir",
        );
      else {
        mkdirSync(pool, { mode: 0o700 });
        chmodSync(pool, 0o755);
      }
      expect(() => f.environment.forWorkspace(f.cwd)).toThrow(
        "Execution environment unavailable",
      );
      expect(readdirSync(f.stateHome)).toEqual([RUN_TEMP_DIRECTORY]);
      expect(readdirSync(f.root).sort()).toEqual([
        "project",
        "state",
        "unrelated",
      ]);
      expect(readdirSync(other)).toEqual(["keep"]);
      expect(readFileSync(join(other, "keep"), "utf8")).toBe("unrelated data");
      if (kind === "file")
        expect(readFileSync(pool, "utf8")).toBe("not a pool");
      if (kind === "symlink")
        expect(lstatSync(pool).isSymbolicLink()).toBe(true);
      if (kind === "permissions")
        expect(lstatSync(pool).mode & 0o777).toBe(0o755);
    },
  );
}

it("cleanup keeps the pool, older run directories and unrelated entries, including after a pool is replaced", async () => {
  const f = fixture();
  const pool = join(f.stateHome, RUN_TEMP_DIRECTORY);
  mkdirSync(pool, { mode: 0o700 });
  const old = join(pool, "cadence-run-older");
  mkdirSync(old);
  writeFileSync(join(old, "keep"), "retained failure");
  writeFileSync(join(pool, "unrelated"), "unrelated data");
  const first = f.environment.forWorkspace(f.cwd);
  expect(await f.environment.finish(true)).toEqual([]);
  expect(readdirSync(pool).sort()).toEqual(["cadence-run-older", "unrelated"]);
  expect(existsSync(first.TMPDIR)).toBe(false);
  const next = new RunEnvironment(
    f.stateHome,
    f.cwd,
    () => {},
    () => {},
  );
  const second = next.forWorkspace(f.cwd);
  const moved = `${pool}-moved`;
  renameSync(pool, moved);
  mkdirSync(pool, { mode: 0o700 });
  mkdirSync(second.TMPDIR, { mode: 0o700 });
  writeFileSync(join(second.TMPDIR, "keep"), "replacement");
  expect(await next.finish(true)).toEqual([second.TMPDIR]);
  expect(readFileSync(join(second.TMPDIR, "keep"), "utf8")).toBe("replacement");
  expect(readFileSync(join(moved, "cadence-run-older", "keep"), "utf8")).toBe(
    "retained failure",
  );
  expect(readFileSync(join(moved, "unrelated"), "utf8")).toBe("unrelated data");
});
