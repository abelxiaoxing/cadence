import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { savedRecordIdentity, TaskStore } from "../src/task-store.ts";
import { TASK_SCHEMA, type TaskRecord } from "../src/task-types.ts";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "cadence-lw-store-"));
  const root = join(dir, "project");
  mkdirSync(root);
  return { dir, root, store: new TaskStore(root, join(dir, "state")) };
}
function record(cwd: string): TaskRecord {
  return {
    schema: TASK_SCHEMA,
    id: randomUUID(),
    revision: 1,
    kind: "code",
    goal: "A useful task",
    plan: "Inspect and edit one file",
    cwd,
    phase: "planning",
    result: "",
    baseline: "",
    checks: [],
    activity: [],
  };
}
describe("retained task store and shared checkout locks", () => {
  it("native second process cannot acquire a live supported writer lock", async () => {
    const { root, store, dir } = fixture();
    const url = new URL("../src/task-store.ts", import.meta.url).href;
    const code = `const {TaskStore}=await import(${JSON.stringify(url)}); const store=new TaskStore(process.argv[1],process.argv[2]); const lock=store.acquire(); process.stdout.write('locked'); for await(const _ of process.stdin) {} store.release(lock);`;
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", code, root, join(dir, "state")],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const closed = once(child, "close");
    let errors = "";
    child.stderr.on("data", (chunk) => {
      errors += chunk;
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    try {
      const data = await Promise.race([
        once(child.stdout, "data"),
        closed.then(() => {
          throw new Error(`Child refused: ${errors}`);
        }),
      ]);
      expect(data[0].toString()).toBe("locked");
      expect(() => store.acquire()).toThrow("busy");
      expect(() => store.release(store.inspectLock()!)).toThrow(
        "owning process",
      );
    } finally {
      child.stdin.end();
      await closed;
      clearTimeout(timer);
    }
    expect(store.inspectLock()).toBeUndefined();
  }, 10000);

  it("missing list/load/config/lock stay absent; old consumer bytes untouched", () => {
    const { root, store, dir } = fixture();
    writeFileSync(join(root, "legacy.sqlite"), "legacy bytes");
    expect(store.list()).toEqual([]);
    expect(store.load(randomUUID())).toBeUndefined();
    expect(store.checks()).toEqual([]);
    expect(store.inspectLock()).toBeUndefined();
    expect(existsSync(join(root, ".cadence"))).toBe(false);
    expect(existsSync(join(dir, "state"))).toBe(false);
    expect(readFileSync(join(root, "legacy.sqlite"), "utf8")).toBe(
      "legacy bytes",
    );
  });
  it("atomic record revisions and exclusive checkout lock include metadata writers", () => {
    const { root, store } = fixture();
    const task = record(root);
    store.save(task, 0);
    expect(store.load(task.id)).toEqual(task);
    expect(() => store.save({ ...task, revision: 2 }, 0)).toThrow("Revision");
    const lock = store.acquire();
    expect(() => store.acquire()).toThrow("busy");
    expect(() => store.save({ ...task, revision: 2 }, 1)).toThrow("busy");
    store.save(
      { ...task, revision: 2, plan: "Changed" },
      1,
      lock,
      savedRecordIdentity(task),
    );
    store.release(lock);
    expect(store.load(task.id)?.plan).toBe("Changed");
  });
  it("linked/oversized/corrupt/unknown records refuse without reset", () => {
    for (const content of [
      "{bad",
      JSON.stringify({ schema: "legacy" }),
      "x".repeat(131073),
    ]) {
      const { root, store } = fixture();
      const task = record(root);
      store.save(task, 0);
      const path = join(store.tasks, task.id, "task.json");
      writeFileSync(path, content);
      expect(() => store.load(task.id)).toThrow();
      expect(readFileSync(path, "utf8")).toBe(content);
    }
    const { root, store, dir } = fixture();
    mkdirSync(join(root, ".cadence"));
    symlinkSync(dir, join(root, ".cadence", "assistant"), "dir");
    expect(() => store.list()).toThrow("Unsafe");
    expect(() => store.load("../escape")).toThrow("Invalid");
  });
  it("only informed exact unchanged dead local new locks recover", () => {
    const { store } = fixture();
    const lock = store.acquire();
    expect(() => store.recover(lock, true)).toThrow("live");
    expect(() => store.recover(lock, false)).toThrow("confirmation");
    const dead = { ...lock, pid: 2147483647, host: hostname() };
    writeFileSync(store.lockPath, JSON.stringify(dead));
    expect(() => store.recover(lock, true)).toThrow("changed");
    store.recover(dead, true);
    expect(store.inspectLock()).toBeUndefined();
  });
  it("unrelated historical logs never gate coordination; selected unsafe logs still refuse", () => {
    const { store, dir } = fixture();
    const lock = store.acquire();
    for (let i = 0; i < 1002; i++)
      writeFileSync(join(store.privateRoot, `${randomUUID()}.log`), "old", {
        mode: 0o644,
      });
    // Unknown unrelated material is preserved, not audited or cleaned on the hot path.
    symlinkSync(dir, join(store.privateRoot, "unrelated-alias"), "dir");
    expect(store.inspectLock()).toEqual(lock);
    const name = store.writeLog(lock, "selected output");
    expect(store.readLog(name)).toBe("selected output");
    const linked = `${randomUUID()}.log`;
    symlinkSync(join(store.privateRoot, name), join(store.privateRoot, linked));
    expect(() => store.readLog(linked)).toThrow("Unsafe");
    writeFileSync(join(store.privateRoot, name), "x".repeat(65537));
    expect(() => store.readLog(name)).toThrow("Unsafe");
    if (process.platform !== "win32") {
      writeFileSync(join(store.privateRoot, name), "private");
      chmodSync(join(store.privateRoot, name), 0o644);
      expect(() => store.readLog(name)).toThrow("Unsafe");
    }
    store.release(lock);
    store.release(store.acquire());
    expect(existsSync(join(store.privateRoot, "unrelated-alias"))).toBe(true);
  });
  it("canonicalizes ambient ancestor aliases without creating absent state, but refuses owned links", () => {
    const { root, dir } = fixture();
    const alias = join(dir, "ambient-alias");
    symlinkSync(dir, alias, "dir");
    const store = new TaskStore(
      join(alias, "project"),
      join(alias, "missing", "state"),
    );
    expect(store.root).toBe(realpathSync(root));
    expect(
      store.privateRoot.startsWith(join(realpathSync(dir), "missing", "state")),
    ).toBe(true);
    expect(store.inspectLock()).toBeUndefined();
    expect(store.list()).toEqual([]);
    expect(existsSync(join(dir, "missing"))).toBe(false);
    store.release(store.acquire());
    const other = new TaskStore(root, join(alias, "other-state"));
    mkdirSync(join(dir, "other-state"));
    symlinkSync(dir, join(dir, "other-state", "cadence-assistant-v1"), "dir");
    expect(() => other.inspectLock()).toThrow("Unsafe");
  });
  it("same-revision record content is required for save, including formatting changes", () => {
    const { root, store } = fixture();
    const task = record(root);
    store.save(task, 0);
    const identity = store.loadSnapshot(task.id)!.identity;
    const path = join(store.tasks, task.id, "task.json");
    const external = JSON.stringify(task);
    writeFileSync(path, external);
    expect(() =>
      store.save({ ...task, revision: 2 }, 1, undefined, identity),
    ).toThrow("content changed");
    expect(() => store.save({ ...task, revision: 2 }, 1)).toThrow(
      "content changed",
    );
    expect(readFileSync(path, "utf8")).toBe(external);
    store.save(
      { ...task, revision: 2 },
      1,
      undefined,
      store.loadSnapshot(task.id)!.identity,
    );
    expect(store.load(task.id)?.revision).toBe(2);
  });
  it("duplicate and reserved configuration names refuse rather than hide an unrun check", () => {
    const { root, store } = fixture();
    mkdirSync(join(root, ".cadence", "assistant"), { recursive: true });
    const file = join(root, ".cadence", "assistant", "config.json");
    const check = { name: "Tests", command: "exit 0", timeoutMs: 1000 };
    for (const checks of [
      [check, { ...check, command: "exit 7" }],
      [{ ...check, name: "Manual command" }],
    ]) {
      const text = JSON.stringify({
        schema: "cadence-assistant-checks/1",
        checks,
      });
      writeFileSync(file, text);
      expect(() => store.checks()).toThrow("check name");
      expect(readFileSync(file, "utf8")).toBe(text);
    }
  });
  it("configuration is optional, versioned and bounded", () => {
    const { store, root } = fixture();
    mkdirSync(join(root, ".cadence", "assistant"), { recursive: true });
    const path = join(root, ".cadence", "assistant", "config.json");
    writeFileSync(
      path,
      JSON.stringify({
        schema: "cadence-assistant-checks/1",
        checks: [{ name: "test", command: "exit 0", timeoutMs: 1000 }],
      }),
    );
    expect(store.checks()).toHaveLength(1);
    writeFileSync(path, "{}");
    expect(() => store.checks()).toThrow();
  });
});
