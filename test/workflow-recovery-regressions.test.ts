/** Owner control-flow regressions with controlled work; the temporary-environment
 * case also runs one short real shell. No service or provider subprocesses. */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it, vi } from "vitest";
import type { WorkflowRun } from "../src/service/contracts/workflow.ts";
import { RunEnvironment } from "../src/service/run-environment.ts";
import { AttemptFailure } from "../src/service/workflow-controller.ts";
import { deliveryObservation } from "../src/service/workflow-delivery.ts";
import { Workflows } from "../src/service/workflows.ts";
import { plan } from "./helpers/workflow-plan.ts";

vi.mock("../src/service/workflow-git.ts", async (original) => ({
  ...(await original<typeof import("../src/service/workflow-git.ts")>()),
  sourceIdentityAsync: async () => "source",
}));
const success = {
  outcome: "completed",
  closed: true,
  exitCode: 0,
  output: "fixture",
  text: "",
  durationMs: 1,
  truncated: false,
  signal: null,
};
function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), "workflow-recovery-"));
  const proposal = {
    plan: {
      ...plan(),
      delivery: "working-copy",
      tasks: [],
      setup: [],
      baselineChecks: [],
    },
  };
  const live = {
    proposal,
    abort: new AbortController(),
    notes: [] as string[],
    delivered: new Set(),
    run: {
      id: randomUUID(),
      status: "running",
      phase: "implementing",
      steps: [] as { id: string; kind: string; status: string }[],
      mergedCommit: null as string | null,
      verification: { source: "source" },
    },
  };
  const records = new Map<string, unknown>();
  const owner = Object.assign(Object.create(Workflows.prototype), {
    cwd,
    root: join(cwd, "state"),
    active: new Map(),
    o: {
      owner: { state: "idle" },
      secrets: () => [],
      coordination: {
        files: {
          read: (p: string) =>
            records.has(p)
              ? { bytes: Buffer.from(JSON.stringify(records.get(p))) }
              : null,
        },
      },
    },
    save() {},
    assertRunning() {},
    assertStartable: async () => {},
    write: (p: string, v: unknown) => records.set(p, v),
    learn: vi.fn(async () => {}),
    publish: vi.fn(),
    verifyAndRepair: vi.fn(async () => {}),
    check: async (
      _live: unknown,
      _cwd: string,
      _check: unknown,
      title: string,
    ) => {
      const step = owner.step(live, title, "check");
      owner.finishStep(live, step, success);
      return { result: success, step };
    },
    recoverStage: async (
      _live: unknown,
      _cwd: string,
      _proposal: unknown,
      _stage: string,
      action: () => Promise<unknown>,
    ) => action(),
  });
  return { owner, live, proposal };
}
it("setup recovery retries only the failed command, never preceding successful effects", async () => {
  const { owner, live, proposal } = fixture();
  Object.assign(proposal.plan, {
    setup: ["create-private-root", "prepare-environment"].map((name) => ({
      name,
      command: name,
      timeoutMs: 1000,
    })),
  });
  const calls: string[] = [];
  let failure = true;
  owner.check = async (
    _l: unknown,
    _c: string,
    _definition: unknown,
    title: string,
  ) => {
    calls.push(title);
    if (title.endsWith("prepare-environment") && failure) {
      failure = false;
      return { result: { ...success, outcome: "failed", exitCode: 1 } };
    }
    return { result: success };
  };
  owner.recoverStage = async (
    _l: unknown,
    _c: string,
    _p: unknown,
    _s: string,
    action: () => Promise<unknown>,
  ) => {
    try {
      return await action();
    } catch {
      return action();
    }
  };
  await owner.implement(live, proposal);
  expect(calls).toEqual([
    "setup: create-private-root",
    "setup: prepare-environment",
    "setup: prepare-environment",
  ]);
});
it("baseline recovery cites only the failed checks of the current round", async () => {
  const { owner, live, proposal } = fixture();
  Object.assign(proposal.plan, {
    baselineChecks: ["first", "second"].map((name) => ({
      name,
      command: name,
      timeoutMs: 1000,
    })),
  });
  let number = 0;
  const failures: string[][] = [];
  owner.check = async (
    _l: unknown,
    _c: string,
    _definition: unknown,
    title: string,
  ) => {
    const step = owner.step(live, title, "check");
    const result = [0, 3].includes(number++)
      ? { ...success, outcome: "failed", exitCode: 1 }
      : success;
    owner.finishStep(live, step, result);
    return { result, step };
  };
  owner.recoverStage = async (
    _l: unknown,
    _c: string,
    _p: unknown,
    stage: string,
    action: () => Promise<unknown>,
  ) => {
    if (stage !== "baseline") return action();
    for (let round = 0; round < 2; round++) {
      try {
        await action();
      } catch (error) {
        expect(error).toBeInstanceOf(AttemptFailure);
        failures.push((error as AttemptFailure).steps);
      }
    }
    throw new Error("fixture stop");
  };
  await expect(owner.implement(live, proposal)).rejects.toThrow("fixture stop");
  expect(failures).toEqual([[live.run.steps[0].id], [live.run.steps[3].id]]);
});
it("cleanup quarantine cannot be overwritten by a completed workflow status", async () => {
  const { owner, live } = fixture();
  const release = vi.fn();
  owner.o.gate = { acquire: async () => ({ assertHeld() {}, release }) };
  owner.implement = async () => {
    owner.o.owner.state = "quarantined";
  };
  owner.saveSettlement = vi.fn();
  const result = await owner.execute(live, { action: "execute" });
  expect(result.status).toBe("uncertain");
  expect(live.run.status).toBe("unknown");
  expect(release).not.toHaveBeenCalled();
});
it("a stage failure is attributed to the step it settled, not the newest step of the run", async () => {
  const { owner, live } = fixture();
  const cited: string[][] = [];
  // Stand in for the controller: note what recovery would be asked to diagnose.
  owner.controller = () => ({
    complete: async (_stage: string, action: () => Promise<unknown>) => {
      try {
        return await action();
      } catch (error) {
        if (error instanceof AttemptFailure) cited.push(error.steps);
        throw error;
      }
    },
  });
  const failure = { ...success, outcome: "failed", exitCode: 1 };
  // The fixture stubs recoverStage; this exercises the owner's own.
  const recoverStage = (
    Workflows.prototype as unknown as {
      recoverStage(...args: unknown[]): Promise<unknown>;
    }
  ).recoverStage.bind(owner);
  await expect(
    recoverStage(live, owner.cwd, live.proposal, "setup: tool", () => {
      const failed = owner.step(live, "setup: tool", "check");
      owner.finishStep(live, failed, failure);
      // Another assignment records a step before this failure surfaces.
      owner.step(live, "sibling", "implementation");
      owner.success(failure, failed);
    }),
  ).rejects.toBeInstanceOf(AttemptFailure);
  expect(cited).toEqual([[live.run.steps[0].id]]);
  // A failure that settled no step is not turned into a repair.
  await expect(
    recoverStage(live, owner.cwd, live.proposal, "setup: tool", () => {
      owner.success(failure);
    }),
  ).rejects.not.toBeInstanceOf(AttemptFailure);
});

it("target preflight, candidate preparation and detached-child setup have separate placements", async () => {
  const { owner, live, proposal } = fixture();
  const setup = (
    Workflows.prototype as unknown as {
      setup(...args: unknown[]): Promise<void>;
    }
  ).setup.bind(owner);
  Object.assign(proposal.plan, {
    setup: [
      {
        name: "branch",
        command: "git symbolic-ref -q HEAD",
        placement: "target",
      },
      { name: "once", command: "create run resource", placement: "candidate" },
      { name: "deps", command: "link dependencies", placement: "worktree" },
    ],
  });
  const calls: string[] = [];
  owner.check = async (
    _live: unknown,
    cwd: string,
    command: { name: string },
  ) => {
    calls.push(`${cwd}:${command.name}`);
    if (command.name === "branch") expect(cwd).toBe("target");
    return { result: success };
  };
  await setup(live, "target", proposal, "target");
  await setup(live, "candidate", proposal, "candidate");
  await setup(live, "candidate", proposal);
  await setup(live, "detached-a", proposal);
  await setup(live, "detached-b", proposal);
  expect(calls).toEqual([
    "target:branch",
    "candidate:once",
    "candidate:deps",
    "detached-a:deps",
    "detached-b:deps",
  ]);
});
it("failed target preflight never dispatches an editor into the target or replays setup", async () => {
  const { owner, live, proposal } = fixture();
  const setup = (
    Workflows.prototype as unknown as {
      setup(...args: unknown[]): Promise<void>;
    }
  ).setup.bind(owner);
  Object.assign(proposal.plan, {
    setup: [{ name: "target", command: "false", placement: "target" }],
  });
  owner.recoverStage = vi.fn();
  owner.check = vi.fn(async () => ({
    result: { ...success, outcome: "failed", exitCode: 1 },
  }));
  await expect(setup(live, "target", proposal, "target")).rejects.toThrow(
    "Operation failed",
  );
  expect(owner.check).toHaveBeenCalledTimes(1);
  expect(owner.recoverStage).not.toHaveBeenCalled();
});

it("the owner passes original check context to both diagnosis and repair, without requiring private-record access", async () => {
  const { owner, live, proposal } = fixture();
  Object.assign(live.run, { revision: 0 });
  Object.assign(proposal.plan, { tasks: plan().tasks });
  const failed = owner.step(live, "setup: branch", "check");
  owner.finishStep(
    live,
    failed,
    { ...success, outcome: "failed", exitCode: 1, output: "" },
    undefined,
    undefined,
    {
      command: { name: "branch", command: "git symbolic-ref -q HEAD" },
      cwd: "/child",
      placement: "child",
      environment: { TMPDIR: null, TEMP: null, TMP: null },
    },
  );
  const prompts: string[] = [];
  owner.worker = async (
    _l: unknown,
    _c: string,
    _id: string,
    prompt: string,
  ) => {
    prompts.push(prompt);
    const step = owner.step(live, "diagnose", "diagnosis");
    return {
      step,
      result: {
        ...success,
        text: JSON.stringify({
          action: "continue",
          cause: "wrong placement",
          evidence: [failed.id],
          strategy: "actionable repair",
          work: [
            {
              title: "inspect",
              instructions: "Preserve output",
              writes: ["a.txt"],
            },
          ],
        }),
      },
    };
  };
  owner.editAttempt = async (
    _l: unknown,
    _c: string,
    _p: unknown,
    _id: string,
    prompt: string,
  ) => {
    prompts.push(prompt);
  };
  const controller = owner.controller(live, owner.cwd, proposal);
  let attempt = 0;
  await controller.complete("setup", async () => {
    if (++attempt === 1)
      throw new AttemptFailure("Silent failure", [failed.id], "branch");
  });
  expect(prompts).toHaveLength(2);
  for (const prompt of prompts) {
    expect(prompt).toContain("git symbolic-ref -q HEAD");
    expect(prompt).toContain('"cwd":"/child"');
    expect(prompt).toContain('"TMPDIR":null');
  }
  expect(prompts[1]).toContain("Original failure to resolve");
});

it("check context is captured before launch, contains only named environment values and is sanitized before retention", async () => {
  const { owner, live } = fixture();
  owner.o.checkEnvironment = {
    TMPDIR: "/declared-temp",
    TEMP: "/declared-temp",
    TMP: "/declared-temp",
    API_KEY: "not-for-workers",
  };
  owner.o.secrets = () => ["secret-fixture"];
  let settled = false;
  owner.executionCwd = () => {
    expect(settled).toBe(false);
    return "/candidate/subdir";
  };
  owner.run = async () => {
    settled = true;
    return { ...success, outcome: "failed", exitCode: 1, output: "" };
  };
  const writes: unknown[] = [];
  owner.write = (_p: string, value: unknown) => {
    writes.push(value);
  };
  const check = (
    Workflows.prototype as unknown as {
      check(...args: unknown[]): Promise<unknown>;
    }
  ).check.bind(owner);
  await check(
    live,
    "/candidate",
    { name: "inspect", command: "echo secret-fixture" },
    "inspect",
  );
  const record = writes[0] as {
    operation: {
      command: { command: string };
      cwd: string;
      environment: unknown;
    };
  };
  expect(record.operation.cwd).toBe("/candidate/subdir");
  expect(record.operation.command.command).toContain("[redacted]");
  expect(record.operation.environment).toEqual({
    TMPDIR: "/declared-temp",
    TEMP: "/declared-temp",
    TMP: "/declared-temp",
  });
  expect(JSON.stringify(record)).not.toContain("not-for-workers");
  expect(JSON.stringify(record)).not.toContain("secret-fixture");
});

it("target prerequisite failure names preparation, retains the original outcome and never creates a candidate", async () => {
  for (const outcome of ["failed", "timeout", "unknown", "canceled"] as const) {
    const { owner, live, proposal } = fixture();
    proposal.plan.setup = [
      {
        name: "temporary directory",
        command: "check-temp",
        placement: "target",
      },
    ] as never;
    const native = {
      ...success,
      outcome,
      exitCode: 1,
      output: "TMPDIR: required",
    };
    const step = {
      id: "target-check",
      kind: "check",
      text: "original command and output",
    };
    owner.check = vi.fn(async () => ({ result: native, step }));
    owner.recoverStage = vi.fn();
    const create = vi.fn(),
      prepareHome = vi.fn();
    Object.assign(live, {
      target: { head: "base" },
      delivery: { view: { worktreeRoot: "candidate" }, create, prepareHome },
    });
    proposal.plan.delivery = "local-merge";
    await expect(owner.implement(live, proposal)).rejects.toMatchObject({
      outcome,
      step: "target-check",
      message: expect.stringContaining(
        "Implementation has not started; no task worktree was created",
      ),
    });
    expect(owner.recoverStage).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(prepareHome).not.toHaveBeenCalled();
    expect(owner.check).toHaveBeenCalledTimes(1);
    expect(native).toEqual({
      ...success,
      outcome,
      exitCode: 1,
      output: "TMPDIR: required",
    });
  }
});

it("a real check gets a compliant owner temporary environment even when the service inherited none", {
  skip: process.platform === "win32",
}, async () => {
  const { owner, live } = fixture();
  const { RunEnvironment } = await import("../src/service/run-environment.ts");
  const { dirname } = await import("node:path");
  const { existsSync } = await import("node:fs");
  const environment = new RunEnvironment(
    dirname(owner.cwd),
    owner.cwd,
    () => {},
    () => {},
  );
  Object.assign(live, { environment });
  owner.executionCwd = () => owner.cwd;
  owner.o.checkEnvironment = { PATH: process.env.PATH };
  owner.o.owner.lease = { assert() {} };
  const native: Promise<unknown>[] = [];
  owner.o.owner.trackCheck = (p: Promise<unknown>) => native.push(p);
  const check = (
    Workflows.prototype as unknown as {
      check(...args: unknown[]): Promise<{ result: typeof success }>;
    }
  ).check.bind(owner);
  const command = `set -eu\n: "\${TMPDIR:?a compliant TMPDIR is required}"\ntest "$TMPDIR" = "$TEMP"\ntest "$TMPDIR" = "$TMP"\nprintf 'owner-temporary-environment-ready'`;
  const result = await check(
    live,
    owner.cwd,
    { name: "environment", command },
    "environment",
  );
  expect(result.result).toMatchObject({
    outcome: "completed",
    exitCode: 0,
    closed: true,
    output: "owner-temporary-environment-ready",
  });
  await Promise.all(native);
  const directory = environment.forWorkspace(owner.cwd).TMPDIR;
  expect(existsSync(directory)).toBe(true);
  expect(owner.o.checkEnvironment).not.toHaveProperty("TMPDIR");
  expect(await environment.finish(true)).toEqual([]);
});

it.each(["completed", "failed", "canceled", "unknown", "storage"])(
  "run scratch follows original settlement and retains evidence for %s",
  async (outcome) => {
    const { owner, live } = fixture();
    const { dirname } = await import("node:path");
    const { existsSync } = await import("node:fs");
    const released = vi.fn();
    owner.o.gate = {
      acquire: async () => ({ assertHeld() {}, release: released }),
    };
    owner.o.owner.lease = { assert() {} };
    owner.o.owner.quarantine = () => {
      owner.o.owner.state = "quarantined";
    };
    owner.o.coordination.stateHome = dirname(owner.cwd);
    owner.saveSettlement = vi.fn(() => {
      if (outcome === "storage") throw new Error("final record failed");
    });
    let markReady!: () => void, markClosed!: () => void;
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    const closed = new Promise<void>((resolve) => {
      markClosed = resolve;
    });
    let directory = "";
    owner.implement = async (run: any) => {
      directory = run.environment.forWorkspace(owner.cwd).TMPDIR;
      markReady();
      await closed; // Original, not a cancellation observer.
      if (outcome === "unknown") owner.o.owner.quarantine();
      if (outcome === "failed")
        throw new Error("fixture implementation failure");
    };
    const original = owner.execute(live, { action: "execute" });
    await ready;
    expect(existsSync(directory)).toBe(true);
    if (outcome === "canceled") live.abort.abort();
    await Promise.resolve();
    expect(existsSync(directory)).toBe(true);
    expect(released).not.toHaveBeenCalled();
    markClosed();
    await original;
    expect(existsSync(directory)).toBe(outcome !== "completed");
    if (outcome === "unknown" || outcome === "storage")
      expect(released).not.toHaveBeenCalled();
    else expect(released).toHaveBeenCalledTimes(1);
    expect(owner.saveSettlement).toHaveBeenCalled();
  },
);

it("successful delivery does not release its checkout permit before temporary cleanup settles", async () => {
  const { owner, live } = fixture();
  const { RunEnvironment } = await import("../src/service/run-environment.ts");
  const { dirname } = await import("node:path");
  const release = vi.fn();
  owner.o.gate = { acquire: async () => ({ assertHeld() {}, release }) };
  owner.o.owner.lease = { assert() {} };
  owner.o.owner.quarantine = () => {
    owner.o.owner.state = "quarantined";
  };
  owner.o.coordination.stateHome = dirname(owner.cwd);
  owner.saveSettlement = vi.fn();
  owner.implement = async (run: any) => {
    run.environment.forWorkspace(owner.cwd);
  };
  let entered!: () => void, close!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    close = resolve;
  });
  const finish = RunEnvironment.prototype.finish;
  const spy = vi
    .spyOn(RunEnvironment.prototype, "finish")
    .mockImplementation(async function (
      this: InstanceType<typeof RunEnvironment>,
      remove,
    ) {
      expect(owner.saveSettlement).toHaveBeenCalled();
      expect(remove).toBe(true);
      entered();
      await wait;
      return finish.call(this, remove);
    });
  try {
    const original = owner.execute(live, { action: "execute" });
    await ready;
    expect(release).not.toHaveBeenCalled();
    close();
    await original;
    expect(release).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

/** Real finalization and restart projection, with controlled work/recording. */
function settlementFixture() {
  const f = fixture();
  const run: WorkflowRun = {
    id: f.live.run.id,
    epoch: randomUUID(),
    goal: "Fixture delivery",
    status: "running",
    phase: "implementing",
    steps: [],
    notice: "",
    mergedCommit: null,
    humanReviewed: false,
  };
  Object.assign(f.live, { run });
  const snapshots: WorkflowRun[] = [];
  const release = vi.fn();
  f.owner.o.gate = { acquire: async () => ({ assertHeld() {}, release }) };
  f.owner.o.owner.lease = { assert() {} };
  f.owner.o.owner.quarantine = () => {
    f.owner.o.owner.state = "quarantined";
  };
  f.owner.o.coordination.stateHome = dirname(f.owner.cwd);
  f.owner.save = (live: { run: WorkflowRun }) => {
    snapshots.push(structuredClone(live.run));
  };
  return { ...f, run, snapshots, release };
}

it("cleanup stays nonterminal in memory and on disk, so a crash during it is recovered as interrupted", async () => {
  const f = settlementFixture();
  f.owner.implement = async (live: any) => {
    live.environment.forWorkspace(f.owner.cwd);
  };
  let entered!: () => void, close!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    close = resolve;
  });
  const finish = RunEnvironment.prototype.finish;
  const spy = vi
    .spyOn(RunEnvironment.prototype, "finish")
    .mockImplementation(async function (this: RunEnvironment, remove) {
      entered();
      await wait;
      return finish.call(this, remove);
    });
  const original = f.owner.execute(f.live, { action: "execute" });
  try {
    await ready;
    const checkpoint = f.snapshots.at(-1)!;
    expect(f.run.status).toBe("running");
    expect(checkpoint.status).toBe("running");
    expect(checkpoint.phase).not.toBe("finished");
    expect(f.release).not.toHaveBeenCalled();
    let recovered: WorkflowRun | undefined;
    const successor = Object.assign(Object.create(Workflows.prototype), {
      root: f.owner.root,
      retained: () => ({ bytes: Buffer.from(JSON.stringify(checkpoint)) }),
      write: (_path: string, value: WorkflowRun) => {
        recovered = value;
      },
    });
    successor.settleInterrupted(checkpoint.id);
    expect(recovered).toMatchObject({ status: "unknown", phase: "finished" });
    expect(recovered?.notice).toContain("Interrupted");
  } finally {
    close();
    await original;
    spy.mockRestore();
  }
  expect(f.run.status).toBe("completed");
});

it.each(["cancel", "stop", "quarantine"])(
  "%s during cleanup retains later roots and updates the final outcome without erasing delivery",
  async (action) => {
    const f = settlementFixture();
    const child = join(dirname(f.owner.cwd), `child-${randomUUID()}`);
    mkdirSync(child);
    let paths: string[] = [];
    f.owner.implement = async (live: any) => {
      paths = [
        live.environment.forWorkspace(f.owner.cwd).TMPDIR,
        live.environment.forWorkspace(child).TMPDIR,
      ];
      f.run.mergedCommit = "a".repeat(40);
      f.live.delivered.add("delivered.txt");
    };
    const write = f.owner.write;
    f.owner.write = (
      path: string,
      value: { directories?: { removed: boolean }[] },
      ...args: unknown[]
    ) => {
      const result = write(path, value, ...args);
      if (path.endsWith("environment.json") && value.directories?.[0].removed) {
        if (action === "quarantine") f.owner.o.owner.quarantine();
        else {
          if (action === "stop") f.owner.o.owner.state = "stopping";
          f.live.abort.abort({
            source: action === "stop" ? "service" : "user",
            reason: action,
            target: f.run.id,
          });
        }
      }
      return result;
    };
    await f.owner.execute(f.live, { action: "execute" });
    expect(paths).toHaveLength(2);
    expect(existsSync(paths[0])).toBe(false); // A completed removal is not rolled back.
    expect(existsSync(paths[1])).toBe(true);
    const expected = action === "quarantine" ? "unknown" : "canceled";
    expect(f.run.status).toBe(expected);
    expect(f.snapshots.at(-1)?.status).toBe(expected);
    expect(f.run.mergedCommit).toBe("a".repeat(40));
    expect(f.run.notice).toContain("delivered.txt");
    if (action !== "quarantine")
      expect(f.run.notice).toContain(
        `${action === "stop" ? "service" : "user"}: ${action}`,
      );
    else expect(f.release).not.toHaveBeenCalled();
  },
);

it("the final successful notice leads with actual reviewed deviations instead of overwriting them", async () => {
  const f = settlementFixture();
  f.owner.implement = async () => {
    f.run.deviations = [
      {
        revision: 1,
        item: "original acceptance",
        reason: "recorded evidence",
        delivered: "reviewed alternative",
        waives: [],
      },
    ];
    f.live.delivered.add("delivered.txt");
  };
  await f.owner.execute(f.live, { action: "execute" });
  expect(f.run.status).toBe("completed");
  expect(f.run.notice).toMatch(/^Delivered with 1 recorded deviation/);
  expect(f.run.notice).toContain("original acceptance → reviewed alternative");
  expect(f.run.notice).toContain("delivered.txt");
  expect(f.snapshots.at(-1)?.notice).toBe(f.run.notice);
});

it.each(["removed", "pending", "retained"] as const)(
  "restart keeps actual worktree cleanup evidence (%s) while interrupting unfinished finalization",
  (cleanup) => {
    const f = settlementFixture();
    const head = "a".repeat(40);
    const delivery = deliveryObservation(
      {
        policy: "task-branch-v1",
        target: {
          checkoutRoot: f.owner.cwd,
          repository: join(f.owner.cwd, ".git"),
          repositoryIdentity: "b".repeat(64),
          branch: "refs/heads/main",
          head,
        },
      },
      f.owner.cwd,
      f.run.id,
      "goal",
    );
    Object.assign(delivery, {
      preparation: "ready",
      workspace: { head, state: cleanup === "removed" ? "removed" : "ready" },
      candidate: head,
      integration: { status: "applied", before: head, after: head, reason: "" },
      postChecks: "passed",
      cleanup: {
        status: cleanup,
        reason: cleanup === "removed" ? "Confirmed worktree removal" : "",
      },
    });
    Object.assign(f.run, {
      delivery,
      mergedCommit: head,
      phase: "integrating",
    });
    const path = join(f.owner.root, "runs", f.run.id, "state.json");
    f.owner.write(path, f.run);
    f.owner.settleInterrupted(f.run.id);
    const restored = JSON.parse(
      f.owner.o.coordination.files.read(path).bytes.toString("utf8"),
    );
    expect(restored).toMatchObject({
      status: "unknown",
      mergedCommit: head,
      delivery: {
        integration: { status: "applied", after: head },
        cleanup: { status: cleanup === "removed" ? "removed" : "retained" },
        workspace: { state: cleanup === "removed" ? "removed" : "retained" },
      },
    });
    if (cleanup === "removed")
      expect(restored.delivery.cleanup.reason).toBe(
        "Confirmed worktree removal",
      );
  },
);
