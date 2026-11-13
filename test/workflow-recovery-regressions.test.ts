/** Owner control-flow regressions; no Git, service or provider subprocesses. */
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { AttemptFailure } from "../src/service/workflow-controller.ts";
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
  owner.saveFinal = vi.fn();
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
