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
import { awaitWithAbort } from "../src/subagent-process.ts";
import { TaskController } from "../src/task-controller.ts";
import { savedRecordIdentity, TaskStore } from "../src/task-store.ts";
import {
  type ChangeView,
  type RunResult,
  TASK_SCHEMA,
  type TaskRecord,
} from "../src/task-types.ts";

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
const view: ChangeView = {
  fingerprint: "one",
  text: "existing dirt",
  complete: true,
  git: false,
};
const result: RunResult = {
  outcome: "completed",
  closed: true,
  exitCode: 0,
  signal: null,
  durationMs: 2,
  text: "Worker completed (not a check)",
  output: "",
  truncated: false,
};

describe("new bounded task store", () => {
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

describe("small foreground controller", () => {
  it("unrun configured checks remain visible after another passes and require review-with-issues", async () => {
    const { root, store } = fixture();
    mkdirSync(join(root, ".cadence", "assistant"), { recursive: true });
    const checks = [
      { name: "Type check", command: "exit 0", timeoutMs: 1000 },
      { name: "Tests", command: "exit 7", timeoutMs: 1000 },
    ];
    writeFileSync(
      join(root, ".cadence", "assistant", "config.json"),
      JSON.stringify({ schema: "cadence-assistant-checks/1", checks }),
    );
    const controller = new TaskController(store, root, {
      capture: () => view,
      worker: async () => result,
      check: async () => result,
    });
    controller.create("code", "Goal");
    await controller.check(controller.choice(), checks[0], () => true);
    expect(controller.checkStatuses(view)).toContain("Type check: passed");
    expect(controller.checkStatuses(view)).toContain("Tests: not-run");
    expect(() => controller.done(controller.choice(), view, false)).toThrow(
      "acknowledgment",
    );
    controller.done(controller.choice(), view, true);
    expect(controller.current?.review?.outcome).toBe("reviewed-with-issues");
    expect(controller.current?.checks[0].status).toBe("passed");
    await controller.check(
      controller.choice(),
      { ...checks[1], command: "different command" },
      () => true,
    );
    expect(controller.checkStatuses(view)).toContain("Tests: not-run");
    await controller.check(controller.choice(), checks[1], () => true);
    expect(controller.checkStatuses(view)).not.toContain("not-run");
    controller.done(controller.choice(), view, false);
    expect(controller.current?.review?.outcome).toBe("reviewed");
  });
  for (const kind of ["research", "diagnosis"] as const) {
    it(`${kind} starts with only a goal, cannot execute parent shell checks, and reviews conclusions`, async () => {
      const { root, store } = fixture();
      const kinds: string[] = [];
      let checks = 0;
      const controller = new TaskController(store, root, {
        capture: () => view,
        worker: async (request) => {
          kinds.push(request.kind);
          return result;
        },
        check: async () => {
          checks++;
          return result;
        },
      });
      controller.create(kind, "Inspect evidence");
      await expect(
        controller.check(
          controller.choice(),
          { name: "shell", command: "exit 0", timeoutMs: 1000 },
          () => true,
        ),
      ).rejects.toThrow("code task");
      expect(checks).toBe(0);
      expect(store.inspectLock()).toBeUndefined();
      await controller.start(
        controller.choice(),
        async (selected) => {
          expect(selected.kind).toBe(kind);
          return { kind: "code" } as any; // Request preparation cannot escalate tool selection.
        },
        () => true,
      );
      expect(kinds).toEqual([kind]);
      expect(controller.current?.plan).toBe("");
      expect(controller.checkStatuses(view)).toContain("not applicable");
      controller.done(controller.choice(), view, false);
      expect(controller.current?.review?.outcome).toBe("reviewed");
      expect(controller.current?.result).toBe(result.text);
      expect(controller.current?.checks).toEqual([]);
    });
  }
  it("same-revision goal/plan changes invalidate Start and preserve external edits", async () => {
    const { root, store } = fixture();
    let workers = 0;
    const controller = new TaskController(store, root, {
      capture: () => view,
      worker: async () => {
        workers++;
        return result;
      },
      check: async () => result,
    });
    controller.create("code", "Goal");
    controller.editPlan(controller.choice(), "Original plan");
    const choice = controller.choice();
    const task = store.load(choice.id)!;
    const path = join(store.tasks, task.id, "task.json");
    const external = JSON.stringify({
      ...task,
      goal: "External goal",
      plan: "External plan",
    });
    writeFileSync(path, external);
    await expect(
      controller.start(
        choice,
        async () => ({}) as any,
        () => true,
      ),
    ).rejects.toThrow("changed");
    expect(workers).toBe(0);
    expect(readFileSync(path, "utf8")).toBe(external);
    controller.open(task.id);
    await controller.start(
      controller.choice(),
      async () => ({}) as any,
      () => true,
    );
    expect(workers).toBe(1);
  });
  for (const when of ["preparation", "worker"] as const) {
    it(`same-revision external edit during ${when} survives final save`, async () => {
      const { root, store } = fixture();
      let external = "";
      let workers = 0;
      let path = "";
      const change = () => {
        external = JSON.stringify({
          ...JSON.parse(readFileSync(path, "utf8")),
          plan: "Manual concurrent edit",
        });
        writeFileSync(path, external);
      };
      const controller = new TaskController(store, root, {
        capture: () => view,
        worker: async () => {
          workers++;
          if (when === "worker") change();
          return result;
        },
        check: async () => result,
      });
      const task = controller.create("code", "Goal");
      controller.editPlan(controller.choice(), "Plan");
      path = join(store.tasks, task.id, "task.json");
      await expect(
        controller.start(
          controller.choice(),
          async () => {
            if (when === "preparation") change();
            return {} as any;
          },
          () => true,
        ),
      ).rejects.toThrow("content changed");
      expect(workers).toBe(when === "worker" ? 1 : 0);
      expect(readFileSync(path, "utf8")).toBe(external);
      expect(controller.busy).toBe(false);
      expect(store.inspectLock()).toBeUndefined();
      expect(() => controller.assertCurrent(controller.choice())).toThrow(
        "changed",
      );
      controller.open(task.id);
      expect(controller.current?.phase).toBe("interrupted");
      controller.editPlan(controller.choice(), "New human plan");
      expect(store.load(task.id)?.plan).toBe("New human plan");
    });
  }
  it("readonly plan generation saves only an advisory draft and needs a separate fresh Start", async () => {
    const { root, store } = fixture();
    const kinds: string[] = [];
    const controller = new TaskController(store, root, {
      capture: () => view,
      worker: async (request) => {
        kinds.push(request.kind);
        return { ...result, text: "Inspect, edit, check" };
      },
      check: async () => result,
    });
    controller.create("code", "Goal");
    const choice = controller.choice();
    await controller.generatePlan(
      choice,
      async (selected) => {
        expect(selected.kind).toBe("research");
        return { kind: "code" } as any;
      },
      () => true,
    );
    expect(kinds).toEqual(["research"]);
    expect(controller.current?.kind).toBe("code");
    expect(controller.current?.phase).toBe("planning");
    expect(controller.current?.plan).toBe("Inspect, edit, check");
    expect(controller.current?.result).toContain("Advisory");
    expect(controller.current?.checks).toEqual([]);
    await expect(
      controller.start(
        choice,
        async () => ({}) as any,
        () => true,
      ),
    ).rejects.toThrow("Stale");
    await controller.start(
      controller.choice(),
      async () => ({}) as any,
      () => true,
    );
    expect(kinds).toEqual(["research", "code"]);
  });
  it("canceling readonly planning preserves the prior plan without launch or continuation", async () => {
    const { root, store } = fixture();
    let workers = 0;
    const controller = new TaskController(store, root, {
      capture: () => view,
      worker: async () => {
        workers++;
        return result;
      },
      check: async () => result,
    });
    controller.create("code", "Goal");
    controller.editPlan(controller.choice(), "Human draft");
    const choice = controller.choice();
    const run = controller.generatePlan(
      choice,
      (_task, signal) => awaitWithAbort(new Promise(() => {}), signal),
      () => true,
    );
    await controller.cancel();
    expect((await run).outcome).toBe("canceled");
    expect(workers).toBe(0);
    expect(controller.current?.plan).toBe("Human draft");
    expect(controller.current?.phase).toBe("interrupted");
    expect(store.inspectLock()).toBeUndefined();
  });
  it("unexpected launched-run rejection is unknown, never fabricated closed success", async () => {
    const { root, store } = fixture();
    const controller = new TaskController(store, root, {
      capture: () => view,
      worker: async () => {
        throw new Error("runner settlement missing");
      },
      check: async () => result,
    });
    controller.create("code", "Goal");
    controller.editPlan(controller.choice(), "Plan");
    const outcome = await controller.start(
      controller.choice(),
      async () => ({}) as any,
      () => true,
    );
    expect(outcome.closed).toBe(false);
    expect(outcome.outcome).toBe("unknown");
    expect(store.inspectLock()).toBeDefined();
    await controller.cancel();
    expect(controller.busy).toBe(false);
  });
  it("lock release failure cannot strand cancellation waiting forever", async () => {
    const { root, store } = fixture();
    const controller = new TaskController(store, root, {
      capture: () => view,
      worker: async () => result,
      check: async () => result,
    });
    controller.create("code", "Goal");
    controller.editPlan(controller.choice(), "Plan");
    store.release = () => {
      throw new Error("release unavailable");
    };
    await expect(
      controller.start(
        controller.choice(),
        async () => ({}) as any,
        () => true,
      ),
    ).rejects.toThrow("release unavailable");
    await controller.cancel();
    expect(controller.busy).toBe(false);
    expect(controller.blocked).toBe(true);
  });

  it("create/open are inert; stale choices and empty plans refuse", async () => {
    const { root, store } = fixture();
    let workers = 0;
    const controller = new TaskController(store, root, {
      capture: () => view,
      worker: async () => {
        workers++;
        return result;
      },
      check: async () => result,
    });
    const task = controller.create("code", "Goal");
    const initial = controller.choice();
    await expect(
      controller.start(
        initial,
        async () => ({}) as any,
        () => true,
      ),
    ).rejects.toThrow("plan");
    controller.editPlan(initial, "Inspect then implement");
    expect(() => controller.editPlan(initial, "late")).toThrow("Stale");
    controller.open(task.id);
    expect(workers).toBe(0);
    await controller.start(
      controller.choice(),
      async () => ({}) as any,
      () => true,
    );
    expect(workers).toBe(1);
    expect(controller.current?.phase).toBe("review");
    expect(controller.checkStatuses(view)).toContain("not-run");
    expect(() => controller.done(controller.choice(), view, false)).toThrow(
      "acknowledgment",
    );
    controller.done(controller.choice(), view, true);
    expect(controller.current?.review?.outcome).toBe("reviewed-with-issues");
  });
  it("cancellation during late auth cannot spawn and waits; next run needs a fresh choice", async () => {
    const { root, store } = fixture();
    let workers = 0;
    let resolveAuth: (value: any) => void = () => {};
    const controller = new TaskController(store, root, {
      capture: () => view,
      worker: async () => {
        workers++;
        return result;
      },
      check: async () => result,
    });
    controller.create("code", "Goal");
    controller.editPlan(controller.choice(), "Plan");
    const choice = controller.choice();
    const pending = new Promise<any>((resolve) => {
      resolveAuth = resolve;
    });
    const running = controller.start(
      choice,
      (_task, signal) => awaitWithAbort(pending, signal),
      () => true,
    );
    await controller.cancel();
    const stopped = await running;
    resolveAuth({});
    await Promise.resolve();
    expect(stopped.outcome).toBe("canceled");
    expect(workers).toBe(0);
    expect(store.inspectLock()).toBeUndefined();
    await expect(
      controller.start(
        choice,
        async () => ({}) as any,
        () => true,
      ),
    ).rejects.toThrow("Stale");
  });
  it("unknown termination retains the new lock and refuses subsequent work", async () => {
    const { root, store } = fixture();
    const controller = new TaskController(store, root, {
      capture: () => view,
      worker: async () => ({ ...result, outcome: "unknown", closed: false }),
      check: async () => result,
    });
    controller.create("code", "Goal");
    controller.editPlan(controller.choice(), "Plan");
    await controller.start(
      controller.choice(),
      async () => ({}) as any,
      () => true,
    );
    expect(controller.current?.phase).toBe("interrupted");
    expect(store.inspectLock()).toBeDefined();
    expect(controller.blocked).toBe(true);
    expect(() => controller.create("code", "Another")).toThrow("unresolved");
    // Exact unknown namespace intentionally retained, no cleanup/recovery.
  });
  it("passing/failing and changed-during-check outcomes stay distinct; later edits invalidate review", async () => {
    const { root, store } = fixture();
    let current = view;
    let next = result;
    const controller = new TaskController(store, root, {
      capture: () => current,
      worker: async () => result,
      check: async () => next,
    });
    controller.create("code", "Goal");
    const check = { name: "test", command: "exit 0", timeoutMs: 1000 };
    await controller.check(controller.choice(), check, () => true);
    expect(controller.current?.checks[0].status).toBe("passed");
    next = { ...result, outcome: "failed", exitCode: 7 };
    await controller.check(controller.choice(), check, () => true);
    expect(controller.current?.checks[0].status).toBe("failed");
    current = { ...view, fingerprint: "two" };
    expect(controller.checkStatuses(current)).toContain("stale");
    expect(() => controller.done(controller.choice(), view, true)).toThrow(
      "changed",
    );
  });
  it("reopening running state exposes interruption without writing or executing", () => {
    const { root, store } = fixture();
    const task = { ...record(root), phase: "running" as const };
    store.save(task, 0);
    const controller = new TaskController(store, root);
    controller.open(task.id);
    expect(controller.current?.phase).toBe("interrupted");
    expect(store.load(task.id)?.phase).toBe("running");
    expect(store.inspectLock()).toBeUndefined();
  });
});
