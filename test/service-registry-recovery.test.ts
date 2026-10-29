import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, expect, it, vi } from "vitest";
import {
  openProjectDirectory,
  ProjectOpenRefusal,
  serviceStatus,
} from "../src/service/cli.ts";
import { ServiceCoordination } from "../src/service/coordination.ts";
import { encoded } from "../src/service/private-files.ts";
import { storedTree } from "./helpers/history-read-fixture.ts";

let child: string;
beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "registry-recovery-build-"));
  child = join(dir, "child.mjs");
  const built = spawnSync(
    "bun",
    [
      "build",
      "./test/helpers/registry-recovery-child.ts",
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
function run(c: ServiceCoordination, mode: string) {
  return spawnSync(process.execPath, [child, c.store.root, c.stateHome, mode], {
    encoding: "utf8",
    timeout: 15000,
  });
}
function fixture(mode = "lock") {
  const dir = mkdtempSync(join(tmpdir(), "registry-recovery-"));
  const root = join(dir, "project"),
    state = join(dir, "state"),
    other = join(dir, "other");
  mkdirSync(root);
  mkdirSync(other);
  const c = new ServiceCoordination(root, state);
  if (mode !== "partial" && mode !== "empty") c.acquire(config).release();
  const result = run(c, mode);
  expect(result.status, result.stderr).toBe(77);
  return { c, dir, other, lock: join(c.registryDirectory, "registry.lock") };
}
it.each(["lock", "empty", "partial"])(
  "explicit recovery after real %s crash preserves reservations and unblocks independent projects",
  async (mode) => {
    const { c, lock, other } = fixture(mode);
    const original = readFileSync(lock);
    const before = storedTree(c.files.namespace);
    const expected = c.inspectRegistryRecovery();
    expect(expected).toMatchObject({
      scope: "global-registry",
      owner: "absent",
      previousResolver: null,
      reservations: mode === "partial" ? 1 : 0,
    });
    expect(storedTree(c.files.namespace)).toEqual(before);
    expect(() => c.acquire(config)).toThrow("registry-locked");
    expect(await serviceStatus(c, true)).toMatchObject({
      status: "unavailable",
      reason: "registry-locked",
      owner: "absent",
    });
    expect(c.resolveRegistryRecovery(expected, () => {})).toMatchObject({
      status: "resolved",
      scope: "global-registry",
    });
    expect(existsSync(lock)).toBe(false);
    const receipt = JSON.parse(
      readFileSync(
        join(c.registryDirectory, "recovery-v1", expected.epoch, "0.json"),
        "utf8",
      ),
    );
    expect(receipt.lock).toBe(original.toString());
    // Only the global lock changes; no project or registry membership is repaired.
    const after = new Map(storedTree(c.files.namespace));
    for (const [path, value] of before)
      if (!path.endsWith("registry.lock"))
        expect(after.get(path)).toEqual(value);
    const sibling = new ServiceCoordination(other, c.stateHome).acquire({
      ...config,
      endpoint: "http://127.0.0.1:17424",
    });
    if (mode === "partial") expect(() => c.acquire(config)).toThrow("conflict");
    else c.acquire(config).release();
    sibling.release();
  },
);
it("dead registry writer recovery preserves a different live owner and checkout fence", () => {
  const { c, other } = fixture();
  c.resolveRegistryRecovery(c.inspectRegistryRecovery(), () => {});
  const sibling = new ServiceCoordination(other, c.stateHome).acquire({
    ...config,
    endpoint: "http://127.0.0.1:17424",
  });
  expect(run(c, "lock").status).toBe(77);
  const before = storedTree(sibling.coordination.store.privateRoot);
  c.resolveRegistryRecovery(c.inspectRegistryRecovery(), () => {});
  expect(storedTree(sibling.coordination.store.privateRoot)).toEqual(before);
  sibling.assert();
  sibling.release();
});
it.each([
  "live",
  "remote",
  "ambiguous",
  "invalid-pid",
  "malformed",
  "changed-lock",
  "reincarnated",
  "changed-registry",
  "changed-project",
  "authority",
  "partial-release",
  "unsafe-archive",
])("registry recovery refuses %s and preserves every fence", (mode) => {
  const { c, lock } = fixture();
  const expected = c.inspectRegistryRecovery();
  const value = JSON.parse(readFileSync(lock, "utf8"));
  if (mode === "live") value.pid = process.pid;
  if (mode === "remote") value.host = "foreign-registry-host";
  if (mode === "invalid-pid") value.pid = 0;
  if (["live", "remote", "invalid-pid"].includes(mode))
    writeFileSync(lock, encoded(value));
  if (mode === "malformed") writeFileSync(lock, "{");
  if (mode === "changed-lock") appendFileSync(lock, " ");
  if (mode === "reincarnated") {
    renameSync(lock, `${lock}.preserved`);
    writeFileSync(lock, encoded(value), { mode: 0o600 });
  }
  if (mode === "changed-registry")
    appendFileSync(join(c.registryDirectory, "roots.json"), " ");
  if (mode === "changed-project")
    appendFileSync(c.path("registration.json"), " ");
  if (mode === "partial-release")
    writeFileSync(c.path("owner.lock"), "{}", { mode: 0o600 });
  if (mode === "unsafe-archive") {
    mkdirSync(join(c.registryDirectory, "recovery-v1"), { mode: 0o700 });
    writeFileSync(
      join(c.registryDirectory, "recovery-v1", expected.epoch),
      "not a directory",
      { mode: 0o600 },
    );
  }
  if (mode === "ambiguous")
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error(), { code: "EPERM" });
    });
  const before = storedTree(c.files.namespace);
  try {
    const current = ["live", "remote", "ambiguous"].includes(mode)
      ? c.inspectRegistryRecovery()
      : expected;
    expect(() =>
      c.resolveRegistryRecovery(current, () => {
        if (mode === "authority") throw Error("expired");
      }),
    ).toThrow();
  } finally {
    vi.restoreAllMocks();
  }
  expect(storedTree(c.files.namespace)).toEqual(before);
  expect(existsSync(lock)).toBe(true);
});
it("a crashed resolver's flushed evidence is preserved and a new explicit resolver can finish", () => {
  const { c, lock } = fixture();
  const stale = c.inspectRegistryRecovery();
  expect(run(c, "interrupt").status).toBe(77);
  expect(existsSync(lock)).toBe(true);
  expect(() => c.resolveRegistryRecovery(stale, () => {})).toThrow("conflict");
  const expected = c.inspectRegistryRecovery();
  expect(expected.previousResolver).toBe("absent");
  const first = readFileSync(
    join(c.registryDirectory, "recovery-v1", expected.epoch, "0.json"),
  );
  c.resolveRegistryRecovery(expected, () => {});
  expect(
    readFileSync(
      join(c.registryDirectory, "recovery-v1", expected.epoch, "0.json"),
    ),
  ).toEqual(first);
  expect(
    existsSync(
      join(c.registryDirectory, "recovery-v1", expected.epoch, "1.json"),
    ),
  ).toBe(true);
});
it("competing resolvers cannot unlink a successor lock after another resolver won", () => {
  const { c, lock } = fixture();
  const expected = c.inspectRegistryRecovery(),
    create = c.files.create.bind(c.files);
  let raced = false;
  const successor = encoded({
    schema: "cadence-service-registry-lock/1",
    token: randomUUID(),
    pid: process.pid,
    host: hostname(),
  });
  vi.spyOn(c.files, "create").mockImplementation((...args) => {
    if (!raced && args[0].endsWith("0.json")) {
      raced = true;
      c.resolveRegistryRecovery(expected, () => {});
      writeFileSync(lock, successor, { mode: 0o600 });
    }
    return create(...args);
  });
  try {
    expect(() => c.resolveRegistryRecovery(expected, () => {})).toThrow();
  } finally {
    vi.restoreAllMocks();
  }
  expect(readFileSync(lock, "utf8")).toBe(successor);
});
it("browser project refusal is specific and certifies no launch by this request", async () => {
  const { c, other } = fixture();
  const before = storedTree(c.files.namespace);
  await expect(
    openProjectDirectory(
      other,
      c.stateHome,
      "/unused-agent",
      new URL("file:///must-not-launch.mjs"),
    ),
  ).rejects.toMatchObject({ code: "registry-locked", noOwner: true });
  try {
    await openProjectDirectory(
      other,
      c.stateHome,
      "/unused-agent",
      new URL("file:///must-not-launch.mjs"),
    );
  } catch (error) {
    expect(error).toBeInstanceOf(ProjectOpenRefusal);
  }
  expect(storedTree(c.files.namespace)).toEqual(before);
});
it("generated inspect/diagnose identify the lock, while piped resolve never writes", () => {
  const { c, dir } = fixture();
  const before = storedTree(c.files.namespace);
  for (const args of [
    ["recover", "inspect"],
    ["diagnose"],
    ["recover", "resolve"],
  ]) {
    const r = spawnSync(
      process.execPath,
      [
        "src/service-cli.mjs",
        ...args,
        "--workspace",
        c.store.root,
        "--state-home",
        c.stateHome,
      ],
      {
        encoding: "utf8",
        input: "processes\ncredentials\nstorage\nresolve\n",
        timeout: 15000,
        env: { ...process.env, HOME: dir, USERPROFILE: dir },
      },
    );
    expect(r.status, r.stderr).toBe(args[1] === "inspect" ? 0 : 1);
    if (args[1] === "inspect")
      expect(JSON.parse(r.stdout)).toMatchObject({
        scope: "global-registry",
        owner: "absent",
      });
    if (args[0] === "diagnose")
      expect(JSON.parse(r.stdout)).toMatchObject({
        reason: "registry-locked",
        owner: "absent",
      });
  }
  expect(storedTree(c.files.namespace)).toEqual(before);
});
it.skipIf(process.platform === "win32").each(["resolve", "paste", "cancel"])(
  "generated registry recovery requires actual native TTY %s confirmations",
  (mode) => {
    const { c, dir, lock } = fixture();
    const receipt = join(dir, "pty-receipt.json"),
      path = join(dir, "pty.json");
    writeFileSync(
      path,
      JSON.stringify({
        mode,
        epoch: c.inspectRegistryRecovery().epoch,
        receipt,
        cwd: dir,
        env: { ...process.env, HOME: dir, USERPROFILE: dir },
        argv: [
          process.execPath,
          join(process.cwd(), "src/service-cli.mjs"),
          "recover",
          "resolve",
          "--workspace",
          c.store.root,
          "--state-home",
          c.stateHome,
        ],
      }),
      { mode: 0o600 },
    );
    const driver = spawnSync(
      "python3",
      ["test/helpers/recovery-pty.py", path],
      { encoding: "utf8", timeout: 90000 },
    );
    expect(
      driver.status,
      driver.stderr + readFileSync(`${receipt}.terminal`, "utf8"),
    ).toBe(0);
    expect(JSON.parse(readFileSync(receipt, "utf8"))).toEqual({
      waitpidReturned: true,
      exitCode: mode === "resolve" ? 0 : 1,
      forced: false,
      fault: null,
    });
    expect(existsSync(lock)).toBe(mode !== "resolve");
  },
  90000,
);

it.each(["symlink", "hardlink"])(
  "unsafe %s lock is diagnosed without following or unlinking it",
  (kind) => {
    const { c, lock } = fixture();
    const saved = join(c.stateHome, "saved-lock");
    renameSync(lock, saved);
    if (kind === "symlink") symlinkSync(saved, lock);
    else linkSync(saved, lock);
    expect(c.registryLockDiagnostic()).toEqual({
      reason: "registry-locked",
      owner: "unreadable",
    });
    expect(() => c.inspectRegistryRecovery()).toThrow();
    expect(existsSync(lock)).toBe(true);
    expect(existsSync(saved)).toBe(true);
  },
);
it.each(["registry", "project", "lock", "receipt", "authority"])(
  "post-receipt %s interference cannot release the global lock",
  (kind) => {
    const { c, lock } = fixture();
    const expected = c.inspectRegistryRecovery(),
      create = c.files.create.bind(c.files);
    let fresh = true;
    vi.spyOn(c.files, "create").mockImplementation((...args) => {
      const result = create(...args);
      if (args[0].endsWith("0.json")) {
        if (kind === "authority") fresh = false;
        else
          appendFileSync(
            kind === "registry"
              ? join(c.registryDirectory, "roots.json")
              : kind === "project"
                ? c.path("registration.json")
                : kind === "lock"
                  ? lock
                  : args[0],
            " ",
          );
      }
      return result;
    });
    try {
      expect(() =>
        c.resolveRegistryRecovery(expected, () => {
          if (!fresh) throw Error("expired");
        }),
      ).toThrow();
    } finally {
      vi.restoreAllMocks();
    }
    expect(existsSync(lock)).toBe(true);
  },
);
it("two real resolvers yield exactly one release and no competing receipt", async () => {
  const { c, lock } = fixture();
  const attempt = () =>
    new Promise<number | null>((resolve, reject) => {
      const p = spawn(
        process.execPath,
        [child, c.store.root, c.stateHome, "resolve"],
        { stdio: "ignore" },
      );
      p.on("error", reject);
      p.on("close", resolve);
    });
  const statuses = await Promise.all([attempt(), attempt()]);
  expect(statuses.sort()).toEqual([0, 1]);
  expect(existsSync(lock)).toBe(false);
}, 15000);
it("generated project open names the global blocker without launching or selecting a project", () => {
  const { c, other, dir } = fixture();
  const before = storedTree(c.files.namespace);
  const r = spawnSync(
    process.execPath,
    [
      "src/service-cli.mjs",
      "project",
      "open",
      other,
      "--state-home",
      c.stateHome,
      "--agent-dir",
      join(dir, "unused-agent"),
    ],
    {
      encoding: "utf8",
      timeout: 15000,
      env: {
        PATH: process.env.PATH,
        HOME: dir,
        USERPROFILE: dir,
        TMPDIR: dir,
        TMP: dir,
        TEMP: dir,
        SystemRoot: process.env.SystemRoot,
      },
    },
  );
  expect(r.status, r.stderr).toBe(1);
  expect(JSON.parse(r.stdout)).toMatchObject({
    status: "refused",
    error: "registry-locked",
    stage: "service",
  });
  expect(r.stderr).toContain("cadence recover inspect");
  expect(storedTree(c.files.namespace)).toEqual(before);
});

it("a removed unrelated stopped workspace does not deadlock global recovery or get recreated", () => {
  const { c, other } = fixture();
  c.resolveRegistryRecovery(c.inspectRegistryRecovery(), () => {});
  const stopped = new ServiceCoordination(other, c.stateHome);
  stopped.acquire({ ...config, endpoint: "http://127.0.0.1:17424" }).release();
  const original = storedTree(stopped.store.privateRoot);
  rmdirSync(other); // only this fixture's empty consumer workspace
  expect(run(c, "lock").status).toBe(77);
  c.resolveRegistryRecovery(c.inspectRegistryRecovery(), () => {});
  expect(storedTree(stopped.store.privateRoot)).toEqual(original);
  expect(existsSync(other)).toBe(false);
  c.acquire(config).release();
});
