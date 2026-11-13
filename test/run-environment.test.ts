import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
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
  RunEnvironment,
} from "../src/service/run-environment.ts";

vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, statfsSync: vi.fn(fs.statfsSync) };
});
beforeEach(async () => {
  const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
  vi.mocked(statfsSync).mockImplementation(fs.statfsSync);
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
  f.record.mockImplementationOnce((entries: any) => {
    expect(entries[0].identity).toBeNull();
    expect(existsSync(entries[0].path)).toBe(false); // intent before effects
  });
  const env = f.environment.forWorkspace(f.cwd);
  expect(env).toEqual({
    TMPDIR: env.TMPDIR,
    TEMP: env.TMPDIR,
    TMP: env.TMPDIR,
  });
  expect(dirname(env.TMPDIR)).toBe(f.stateHome);
  expect(env.TMPDIR).not.toBe(consumer);
  expect(Object.isFrozen(env)).toBe(true);
  expect(() => assertTemporaryDirectory(f.cwd, env.TMPDIR)).not.toThrow();
  if (process.platform !== "win32")
    expect(lstatSync(env.TMPDIR).mode & 0o777).toBe(0o700);
  expect(process.env.TMPDIR).toBe(consumer);
  expect(await f.environment.finish(true)).toEqual([]);
  expect(existsSync(env.TMPDIR)).toBe(false);
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
it("an unsuitable state filesystem uses the workspace's parent, never an implicit tmpfs", async () => {
  const f = fixture();
  const original = vi.mocked(statfsSync).getMockImplementation()!;
  vi.mocked(statfsSync).mockImplementation(((path: any, options: any) => ({
    ...original(path, options),
    ...(path === f.stateHome ? { type: 0x01021994 } : {}),
  })) as typeof statfsSync);
  const env = f.environment.forWorkspace(f.cwd);
  expect(dirname(env.TMPDIR)).toBe(f.root);
  expect(() => assertTemporaryDirectory(f.cwd, env.TMPDIR)).not.toThrow();
  await f.environment.finish(true);
});
it("no eligible filesystem is a concrete owner failure, not a model repair or an allocation", () => {
  const f = fixture();
  const original = vi.mocked(statfsSync).getMockImplementation()!;
  vi.mocked(statfsSync).mockImplementation(((path: any, options: any) => ({
    ...original(path, options),
    type: 0x01021994,
  })) as typeof statfsSync);
  expect(() => f.environment.forWorkspace(f.cwd)).toThrow(
    "no writable, same-disk temporary location outside Git",
  );
  expect(f.record).not.toHaveBeenCalled();
});
it("a candidate parent inside another Git working copy is not used", async () => {
  const f = fixture();
  execFileSync("git", ["init", "-q", f.stateHome]);
  const env = f.environment.forWorkspace(f.cwd);
  expect(dirname(env.TMPDIR)).toBe(f.root);
  await f.environment.finish(true);
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
