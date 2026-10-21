import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, expect, it, vi } from "vitest";
import { HistoryFiles } from "../src/history/files.ts";
import { HistoryRecovery } from "../src/history/recovery.ts";
import { HistoryWriter } from "../src/history/writer.ts";
import { ServiceCoordination } from "../src/service/coordination.ts";
import {
  inspectRecovery,
  type LocalRecoveryConfirmation,
  resolveRecovery,
} from "../src/service/recovery.ts";
import { storedTree } from "./helpers/history-read-fixture.ts";

let child: string;
beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "recovery-build-"));
  child = join(dir, "crash.mjs");
  const built = spawnSync(
    "bun",
    [
      "build",
      "./test/helpers/history-publication-child.ts",
      "--target=node",
      "--packages=external",
      `--outfile=${child}`,
    ],
    { encoding: "utf8" },
  );
  expect(built.status, built.stderr).toBe(0);
});
function crash(mode = "tail") {
  const dir = mkdtempSync(join(tmpdir(), "recovery-native-"));
  const home = join(dir, "home");
  mkdirSync(home, { mode: 0o700 });
  const env = {
    HOME: home,
    USERPROFILE: home,
    PATH: process.env.PATH,
    TMPDIR: dir,
    TEMP: dir,
    TMP: dir,
  };
  const original = spawnSync(process.execPath, [child, dir, mode], {
    env,
    encoding: "utf8",
    timeout: 15000,
  });
  expect(original.error).toBeUndefined();
  expect([original.status, original.signal], original.stderr).toEqual([
    77,
    null,
  ]);
  const c = new ServiceCoordination(join(dir, "project"), join(dir, "state"));
  return {
    dir,
    env,
    c,
    history: new HistoryRecovery(c),
    files: HistoryFiles.open(c)!,
  };
}
async function confirmation(
  f: ReturnType<typeof crash>,
): Promise<LocalRecoveryConfirmation> {
  const expected = await inspectRecovery(f.c, f.history);
  return {
    expected,
    acknowledgeEscapedProcesses: true,
    processes: "externally-resolved",
    credentials: "independently-resolved",
    storage: "independently-resolved",
    // Unit integration authority INJECTION; actual TTY cases below use no callback injection.
    assertLocalAuthority: (value) => expect(value).toEqual(expected),
  };
}
it.each(["tail", "auth", "launch"])(
  "real original crash + durable %s bridge precedes exact release; unrelated workspace preserved; no replay",
  async (mode) => {
    const f = crash(mode),
      choice = await confirmation(f);
    const before = readFileSync(f.files.segmentPath(1));
    const other = join(f.dir, "other");
    mkdirSync(other);
    // Registry changes stale the observation: select the final exact resource set AFTER this reservation.
    const sibling = new ServiceCoordination(other, f.c.stateHome);
    const lease = sibling.acquire({
      schema: "cadence-service-owner-config/1",
      endpoint: "http://127.0.0.1:17424",
      policyIdentity: "a".repeat(64),
    });
    await expect(resolveRecovery(f.c, choice, f.history)).rejects.toThrow(
      "conflict",
    );
    const selected = await confirmation(f);
    if (mode === "auth")
      expect(selected.expected.history?.credentials).toBe("unknown");
    if (mode === "launch")
      expect(selected.expected.history?.processes).toBe("unknown");
    const result = await resolveRecovery(f.c, selected, f.history);
    expect(result.status).toBe("resolved");
    expect(readFileSync(f.files.segmentPath(1))).toEqual(before);
    expect(f.c.inspect()).toEqual({
      status: "stopped",
      epoch: selected.expected.epoch,
    });
    expect(existsSync(f.c.store.lockPath)).toBe(false);
    lease.assert();
    const replacement = f.c.acquire(f.c.configuration()!);
    expect(replacement.registration.epoch).not.toBe(selected.expected.epoch);
    const writer = new HistoryWriter(replacement);
    expect(writer.quarantined).toBe(false);
    expect(writer.pendingWrites).toBe(0);
    expect(readFileSync(f.files.segmentPath(1))).toEqual(before);
    replacement.release();
    lease.release();
  },
);
it.each([
  "processes",
  "credentials",
  "storage",
  "authority",
  "changed-history",
  "changed-lock",
  "changed-capability",
  "live",
  "remote",
  "format2",
])("local recovery refuses %s without removing a fence", async (mode) => {
  const f = crash("auth"),
    selected = await confirmation(f);
  if (["processes", "credentials", "storage"].includes(mode))
    Object.assign(selected, { [mode]: "unknown" });
  if (mode === "authority") selected.assertLocalAuthority = undefined as any;
  if (mode === "changed-history")
    appendFileSync(f.files.segmentPath(1), "changed");
  if (mode === "changed-lock") appendFileSync(f.c.path("owner.lock"), " ");
  if (mode === "changed-capability") {
    const path = f.c.path("local-capability.json");
    const value = JSON.parse(readFileSync(path, "utf8"));
    value.capability = "A".repeat(43);
    writeFileSync(path, JSON.stringify(value));
  }
  if (mode === "live") vi.spyOn(process, "kill").mockImplementation(() => true);
  if (mode === "remote") {
    // Exact foreign owner facts are injected consistently, never inferred from PID absence.
    for (const path of [
      f.c.path("registration.json"),
      f.c.path("owner.lock"),
      f.c.store.lockPath,
      join(f.c.registryDirectory, "roots.json"),
    ]) {
      const v = JSON.parse(readFileSync(path, "utf8"));
      if (v.entries) v.entries[0].host = "foreign-fixture-host";
      else v.host = "foreign-fixture-host";
      writeFileSync(path, JSON.stringify(v));
    }
  }
  if (mode === "live" || mode === "remote") {
    Object.assign(selected, await confirmation(f));
    expect(selected.expected.owner).toBe(
      mode === "live" ? "live" : "ambiguous",
    );
  }
  if (mode === "format2") {
    const path = join(f.files.directory, "format.json"),
      v = JSON.parse(readFileSync(path, "utf8"));
    v.schema = "cadence-history-store/2";
    writeFileSync(path, JSON.stringify(v));
  }
  const before = storedTree(f.dir);
  try {
    await expect(resolveRecovery(f.c, selected, f.history)).rejects.toThrow();
  } finally {
    vi.restoreAllMocks();
  }
  expect(storedTree(f.dir)).toEqual(before);
  expect(existsSync(f.c.store.lockPath)).toBe(true);
});
it("duplicate epoch reservation cannot widen recovery into another workspace", async () => {
  const f = crash();
  const path = join(f.c.registryDirectory, "roots.json");
  const registry = JSON.parse(readFileSync(path, "utf8"));
  const other = join(f.dir, "other");
  mkdirSync(other);
  registry.entries.push({
    ...registry.entries[0],
    root: other,
    endpoint: "http://127.0.0.1:17424",
  });
  writeFileSync(path, JSON.stringify(registry));
  const before = storedTree(f.dir);
  await expect(inspectRecovery(f.c, f.history)).rejects.toThrow();
  expect(storedTree(f.dir)).toEqual(before);
  expect(existsSync(f.c.store.lockPath)).toBe(true);
});
it.each(["registry-format", "history-segment"])(
  "recovery refuses same-byte %s reincarnation after inspection",
  async (target) => {
    const f = crash(),
      choice = await confirmation(f);
    const path =
      target === "registry-format"
        ? join(f.c.registryDirectory, "format.json")
        : f.files.segmentPath(1);
    const bytes = readFileSync(path);
    renameSync(path, join(f.dir, `preserved-${target}`));
    writeFileSync(path, bytes, { mode: 0o600 });
    const before = storedTree(f.dir);
    await expect(resolveRecovery(f.c, choice, f.history)).rejects.toThrow();
    expect(storedTree(f.dir)).toEqual(before);
    expect(existsSync(f.c.store.lockPath)).toBe(true);
  },
);
it.each(["orphan", "bridge"])(
  "recovery never adopts changed %s bytes after original append",
  async (target) => {
    const f = crash();
    const orphan = join(f.files.directory, "indexes", "orphan");
    writeFileSync(orphan, "preserved orphan", { mode: 0o600 });
    const choice = await confirmation(f);
    const append = f.history.append.bind(f.history);
    vi.spyOn(f.history, "append").mockImplementation(async (...args) => {
      const fact = await append(...args); // actual original fsync/close, then explicit timing injection
      if (target === "orphan") appendFileSync(orphan, " changed");
      else {
        const path = f.files.segmentPath(2);
        const [row, marker] = readFileSync(path, "utf8")
          .trimEnd()
          .split("\n")
          .map((line) => JSON.parse(line));
        row.value.recoveryId = randomUUID();
        const body = `${JSON.stringify(row)}\n`;
        marker.sha256 = createHash("sha256").update(body).digest("hex");
        writeFileSync(path, `${body}${JSON.stringify(marker)}\n`);
      }
      return fact;
    });
    try {
      await expect(resolveRecovery(f.c, choice, f.history)).rejects.toThrow();
    } finally {
      vi.restoreAllMocks();
    }
    expect(existsSync(f.files.segmentPath(2))).toBe(true);
    expect(existsSync(f.c.store.lockPath)).toBe(true);
    expect(f.c.inspect().status).toBe("unavailable");
  },
);
it("recovery rejects replacement of the original bridge at its commit boundary", async () => {
  const f = crash(),
    choice = await confirmation(f);
  await expect(
    f.history.append(choice, (boundary) => {
      if (boundary !== "commit") return;
      const path = f.files.segmentPath(2),
        bytes = readFileSync(path);
      renameSync(path, join(f.dir, "preserved-original-bridge"));
      writeFileSync(path, bytes, { mode: 0o600 });
    }),
  ).rejects.toThrow();
  expect(existsSync(f.c.store.lockPath)).toBe(true);
});
it.each(["journal", "commit", "release"])(
  "fresh local authority expires at %s without releasing fences",
  async (boundary) => {
    const f = crash(),
      choice = await confirmation(f);
    let fresh = true;
    choice.assertLocalAuthority = () => {
      if (!fresh) throw Error("expired fixture authority");
    };
    const append = f.history.append.bind(f.history);
    vi.spyOn(f.history, "append").mockImplementation(async (selected) => {
      const result = await append(selected, (at) => {
        if (at === boundary) fresh = false;
      });
      if (boundary === "release") fresh = false;
      return result;
    });
    try {
      await expect(resolveRecovery(f.c, choice, f.history)).rejects.toThrow();
    } finally {
      vi.restoreAllMocks();
    }
    expect(existsSync(f.files.segmentPath(2))).toBe(true);
    expect(existsSync(f.c.store.lockPath)).toBe(true);
    expect(existsSync(f.c.path("owner.lock"))).toBe(true);
  },
);
it.each(["registration", "capability", "owner"])(
  "release interference after %s retains partial fences and never rolls back history",
  async (boundary) => {
    const f = crash(),
      selected = await confirmation(f);
    const original = readFileSync(f.files.segmentPath(1));
    const remove = f.c.files.remove.bind(f.c.files),
      replace = f.c.files.replace.bind(f.c.files);
    const change = () =>
      appendFileSync(f.files.segmentPath(1), "external-after-bridge");
    vi.spyOn(f.c.files, "replace").mockImplementation((...args) => {
      const result = replace(...args);
      if (
        boundary === "registration" &&
        args[0] === f.c.path("registration.json")
      )
        change();
      return result;
    });
    vi.spyOn(f.c.files, "remove").mockImplementation((...args) => {
      remove(...args);
      if (
        args[0] ===
        f.c.path(
          boundary === "capability" ? "local-capability.json" : "owner.lock",
        )
      )
        change();
    });
    try {
      await expect(resolveRecovery(f.c, selected, f.history)).rejects.toThrow();
    } finally {
      vi.restoreAllMocks();
    }
    expect(
      readFileSync(f.files.segmentPath(1)).subarray(0, original.length),
    ).toEqual(original);
    expect(existsSync(f.files.segmentPath(2))).toBe(true);
    expect(existsSync(f.c.store.lockPath)).toBe(true);
    expect(existsSync(join(f.c.registryDirectory, "registry.lock"))).toBe(true);
    expect(f.c.inspect().status).toBe("unavailable");
  },
);
// Driven through a POSIX pty (recovery-pty.py); Windows has no pty module and
// no ConPTY recovery driver yet, so Windows recovery TTY is unqualified here.
it.skipIf(process.platform === "win32").each(["resolve", "paste", "cancel"])(
  "generated management actual native TTY %s with exact fresh confirmations",
  (mode) => {
    const f = crash("auth");
    const epoch = f.c.recoverySnapshot().registration.epoch;
    const before = readFileSync(f.files.segmentPath(1));
    const receipt = join(f.dir, "pty-receipt.json"),
      config = join(f.dir, "pty.json");
    writeFileSync(
      config,
      JSON.stringify({
        mode,
        epoch,
        receipt,
        cwd: f.dir,
        env: f.env,
        argv: [
          process.execPath,
          join(process.cwd(), "src/service-cli.mjs"),
          "recover",
          "resolve",
          "--workspace",
          f.c.store.root,
          "--state-home",
          f.c.stateHome,
        ],
      }),
      { mode: 0o600 },
    );
    const driver = spawnSync(
      "python3",
      ["test/helpers/recovery-pty.py", config],
      { env: f.env, encoding: "utf8", timeout: 90000 },
    );
    expect(driver.error).toBeUndefined();
    expect(driver.status, driver.stderr).toBe(0);
    const facts = JSON.parse(readFileSync(receipt, "utf8"));
    expect(facts).toEqual({
      waitpidReturned: true,
      exitCode: mode === "resolve" ? 0 : 1,
      forced: false,
      fault: null,
    });
    expect(readFileSync(f.files.segmentPath(1))).toEqual(before);
    expect(existsSync(f.c.store.lockPath)).toBe(mode !== "resolve");
    if (mode === "resolve") expect(f.c.inspect().status).toBe("stopped");
  },
  90000,
);
it("nonTTY and synthetic flags cannot authorize; inspect remains readonly", () => {
  const f = crash(),
    before = storedTree(f.dir);
  for (const op of ["inspect", "resolve"]) {
    const r = spawnSync(
      process.execPath,
      [
        "src/service-cli.mjs",
        "recover",
        op,
        "--workspace",
        f.c.store.root,
        "--state-home",
        f.c.stateHome,
      ],
      {
        env: f.env,
        encoding: "utf8",
        input: "processes\ncredentials\nstorage\nresolve\n",
        timeout: 15000,
      },
    );
    expect(r.status).toBe(op === "inspect" ? 0 : 1);
    if (op === "inspect")
      expect(JSON.parse(r.stdout)).toMatchObject({
        owner: "absent",
        resolution: "local-interactive-only",
      });
  }
  expect(storedTree(f.dir)).toEqual(before);
});
