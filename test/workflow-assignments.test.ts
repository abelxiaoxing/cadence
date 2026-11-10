/** How the owner runs an agreement's assignments: which run side by side in
 * their own worktrees, which wait, and what happens when one fails. Scheduling
 * only; workers, Git and the delivery owner are controlled stand-ins. */
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { WorkflowTask } from "../src/service/contracts/workflow.ts";
import { Workflows } from "../src/service/workflows.ts";
import { plan } from "./helpers/workflow-plan.ts";

vi.mock("../src/service/workflow-git.ts", async (original) => ({
  ...(await original<typeof import("../src/service/workflow-git.ts")>()),
  assertWorkflowScope: async () => [],
  assertWorkflowCommit: async () => [],
  gitHead: async () => "c".repeat(40),
}));

const CANDIDATE = "/controlled/run/integration";
const task = (
  id: string,
  writes: string[],
  after: string[] = [],
): WorkflowTask => ({
  id,
  title: id.toUpperCase(),
  instructions: `Do ${id}`,
  writes,
  after,
  reads: [],
});
function fixture(
  tasks: WorkflowTask[],
  options: { parallel?: number; delivery?: boolean; fail?: string[] } = {},
) {
  const definition = { ...plan(), tasks };
  const proposal = { plan: definition, model: {} };
  const events: string[] = [];
  /** A test holds an assignment open by putting a gate here before it starts. */
  const gates = new Map<string, Promise<void>>();
  const attempts: {
    id: string;
    cwd: string;
    writes: string[];
    prompt: string;
  }[] = [];
  let active = 0,
    peak = 0;
  const live = {
    proposal,
    abort: new AbortController(),
    delivered: new Set<string>(),
    owned: undefined as Map<string, string[]> | undefined,
    delivery:
      options.delivery === false
        ? undefined
        : {
            view: { worktreeRoot: CANDIDATE },
            childPath: (id: string) => `/controlled/run/tasks/${id}`,
            createChild: async (
              id: string,
              git: (args: string[]) => Promise<unknown>,
            ) => {
              const path = `/controlled/run/tasks/${id}`;
              await git(["worktree", "add", "--detach", path]);
              return path;
            },
            assertTip: async () => "1".repeat(40),
            update: () => {},
            applied: (path: string) => events.push(`applied ${path}`),
            removeChild: async (
              path: string,
              remove: (p: string, check: () => Promise<void>) => Promise<void>,
            ) => remove(path, async () => {}),
          },
    run: {
      id: randomUUID(),
      status: "running",
      phase: "implementing",
      steps: [],
      tasks: undefined as { id: string; state: string }[] | undefined,
    },
  };
  const owner = Object.assign(Object.create(Workflows.prototype), {
    cwd: "/controlled/checkout",
    o: {
      parallel: options.parallel,
      owner: { state: "idle" },
      secrets: () => [],
    },
    save() {},
    assertRunning() {
      if (live.abort.signal.aborted) throw new Error("canceled");
    },
    recoverStage: (
      _live: unknown,
      _cwd: string,
      _p: unknown,
      _stage: string,
      action: () => Promise<unknown>,
    ) => action(),
    setup: async (_live: unknown, cwd: string) => {
      events.push(`setup ${cwd}`);
    },
    editAttempt: async (
      _live: unknown,
      cwd: string,
      _p: unknown,
      id: string,
      prompt: string,
      writes: string[],
    ) => {
      attempts.push({ id, cwd, writes: [...writes], prompt });
      events.push(`start ${id}`);
      peak = Math.max(peak, ++active);
      try {
        await (gates.get(id) ?? new Promise((r) => setImmediate(r)));
        if (options.fail?.includes(id)) throw new Error(`terminal ${id}`);
      } finally {
        active--;
        events.push(`end ${id}`);
      }
    },
    commit: async (
      _live: unknown,
      cwd: string,
      _allowed: string[],
      _message: string,
      _before: string,
      title: string,
    ) => {
      events.push(`${title} in ${cwd}`);
      return title === "commit-assignments" ? null : "d".repeat(40);
    },
    gitStep: async (
      _live: unknown,
      _cwd: string,
      title: string,
      body: (git: (args: string[]) => Promise<unknown>) => Promise<unknown>,
    ) =>
      body(async (args) => {
        events.push(`${title}: git ${args.slice(0, 2).join(" ")}`);
      }),
  });
  const run = () => owner.assignments(live, CANDIDATE, proposal);
  const states = () =>
    Object.fromEntries((live.run.tasks ?? []).map((t) => [t.id, t.state]));
  return {
    owner,
    live,
    events,
    gates,
    attempts,
    run,
    states,
    peak: () => peak,
  };
}
/** A gate the test opens itself. */
function gate() {
  let open!: () => void;
  const closed = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { closed, open };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

it("independent assignments run side by side in their own worktrees; a dependent one waits for both and then runs in the candidate", async () => {
  const f = fixture(
    [
      task("a", ["src/a.ts"]),
      task("b", ["src/b.ts"]),
      task("c", ["src/index.ts"], ["a", "b"]),
    ],
    { parallel: 4 },
  );
  await f.run();
  expect(f.peak()).toBe(2);
  expect(f.states()).toEqual({
    a: "completed",
    b: "completed",
    c: "completed",
  });
  const at = (text: string) => f.events.indexOf(text);
  // What was in the candidate is committed before anything forks from it.
  expect(at(`commit-assignments in ${CANDIDATE}`)).toBe(0);
  for (const id of ["a", "b"]) {
    const child = `/controlled/run/tasks/${id}`;
    const order = [
      `worktree-${id}: git worktree add`,
      `setup ${child}`,
      `start ${id}`,
      `end ${id}`,
      `commit-${id} in ${child}`,
      `integrate-${id}: git cherry-pick --no-edit`,
      `applied ${child}`,
      `worktree-remove-${id}: git worktree remove`,
    ].map(at);
    expect(order).toEqual([...order].sort((x, y) => x - y));
    expect(order.every((index) => index >= 0)).toBe(true);
  }
  // Both ran together, and c started only after both were integrated.
  expect(at("start b")).toBeLessThan(at("end a"));
  expect(at("start c")).toBeGreaterThan(at("applied /controlled/run/tasks/a"));
  expect(at("start c")).toBeGreaterThan(at("applied /controlled/run/tasks/b"));
  const c = f.attempts.find((a) => a.id === "c");
  expect(c?.cwd).toBe(CANDIDATE);
  expect(c?.prompt).toContain(
    "Predecessor assignments already applied here: a, b",
  );
  expect(f.attempts.find((a) => a.id === "a")?.writes).toEqual(["src/a.ts"]);
  expect(f.live.owned).toBeUndefined();
});

it("a plan with no two assignments able to start together runs exactly as before: one at a time in the candidate", async () => {
  const f = fixture(
    [
      task("a", ["a.txt"]),
      task("b", ["b.txt"], ["a"]),
      task("c", ["c.txt"], ["b"]),
    ],
    { parallel: 8 },
  );
  await f.run();
  expect(f.peak()).toBe(1);
  expect(f.attempts.map((a) => [a.id, a.cwd])).toEqual([
    ["a", CANDIDATE],
    ["b", CANDIDATE],
    ["c", CANDIDATE],
  ]);
  expect(f.events.some((e) => e.includes("worktree"))).toBe(false);
  expect(f.events.some((e) => e.includes("cherry-pick"))).toBe(false);
});

it("the execution limit bounds how many run at once, and the rest wait their turn", async () => {
  const tasks = ["a", "b", "c", "d", "e"].map((id) => task(id, [`${id}.txt`]));
  const two = fixture(tasks, { parallel: 2 });
  await two.run();
  expect(two.peak()).toBe(2);
  expect(Object.values(two.states())).toEqual(Array(5).fill("completed"));
  // A limit of one, or a delivery without worktrees, never runs two together.
  for (const options of [{ parallel: 1 }, { parallel: 4, delivery: false }]) {
    const serial = fixture(tasks, options);
    await serial.run();
    expect(serial.peak()).toBe(1);
    expect(serial.events.some((e) => e.includes("worktree"))).toBe(false);
  }
});

it("assignments that would write the same path never run together, whichever names the wider path", async () => {
  const f = fixture(
    [
      task("wide", ["src"]),
      task("narrow", ["src/x.ts"]),
      task("other", ["docs"]),
    ],
    { parallel: 4 },
  );
  const hold = gate();
  f.gates.set("wide", hold.closed);
  const running = f.run();
  await settle();
  await settle();
  // `other` runs beside `wide`; `narrow` waits because `wide` owns its path.
  expect(f.states()).toMatchObject({
    wide: "running",
    other: "completed",
    narrow: "queued",
  });
  hold.open();
  await running;
  expect(f.states().narrow).toBe("completed");
  const at = (text: string) => f.events.indexOf(text);
  expect(at("start narrow")).toBeGreaterThan(
    at("applied /controlled/run/tasks/wide"),
  );
});

it("when one assignment fails, the others already running are joined, nothing more is integrated or started, and their work stays in their worktrees", async () => {
  const f = fixture(
    [
      task("a", ["a.txt"]),
      task("b", ["b.txt"]),
      task("c", ["c.txt"]),
      task("d", ["d.txt"], ["b"]),
    ],
    { parallel: 3, fail: ["a"] },
  );
  const hold = gate();
  f.gates.set("b", hold.closed);
  const running = f.run();
  let settled = false;
  void running
    .catch(() => {})
    .then(() => {
      settled = true;
    });
  await settle();
  await settle();
  await settle();
  // a failed and c finished, but the stage has not ended: b is still running.
  expect(f.states()).toMatchObject({ a: "failed", b: "running" });
  expect(settled).toBe(false);
  hold.open();
  await expect(running).rejects.toThrow("terminal a");
  expect(f.events).toContain("end b");
  // b finished after the failure: not integrated, and d never started.
  expect(f.events.some((e) => e.startsWith("integrate-b"))).toBe(false);
  expect(f.events).not.toContain("start d");
  expect(f.states()).toMatchObject({ a: "failed", b: "queued", d: "queued" });
});

it("a failure in the candidate lane ends the stage at once, marked on that assignment", async () => {
  const f = fixture([task("a", ["a.txt"]), task("b", ["b.txt"], ["a"])], {
    fail: ["a"],
  });
  await expect(f.run()).rejects.toThrow("terminal a");
  expect(f.states()).toEqual({ a: "failed", b: "queued" });
  expect(f.attempts.map((a) => a.id)).toEqual(["a"]);
});
