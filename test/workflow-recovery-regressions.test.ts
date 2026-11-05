/** Owner control-flow regressions; no Git, service or provider subprocesses. */
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { AttemptFailure } from "../src/service/workflow-controller.ts";
import { Workflows } from "../src/service/workflows.ts";
import { plan } from "./helpers/workflow-plan.ts";

const git = vi.hoisted(() => ({
  head: "delivered",
  dirty: false,
  targetChecks: 0,
  refuseTarget: false,
}));
vi.mock("../src/service/workflow-git.ts", async (original) => ({
  ...(await original<typeof import("../src/service/workflow-git.ts")>()),
  assertWorktree: async () => {},
  gitHead: async () => git.head,
  sourceIdentityAsync: async () => "source",
  pathIdentity: () => null,
  documentPlacement: async () => "commit",
  tracked: async () => true,
  committedPaths: async () => ["a.txt"],
  assertWorkflowScope: async () => (git.dirty ? ["a.txt"] : []),
  assertTarget: async () => {
    if (++git.targetChecks > 1 && git.refuseTarget)
      throw new Error("Target moved; preserve the undelivered repair");
  },
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
      return success;
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
      return { ...success, outcome: "failed", exitCode: 1 };
    }
    return success;
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
    return result;
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
it("failed post-merge repair preserves its clean but undelivered candidate commit", async () => {
  Object.assign(git, {
    head: "delivered",
    dirty: false,
    targetChecks: 0,
    refuseTarget: true,
  });
  const { owner, live, proposal } = fixture();
  Object.assign(proposal.plan, { delivery: "local-merge" });
  Object.assign(live, { target: { head: "baseline", branch: "main" } });
  owner.worktreeHome = () => join(owner.cwd, "trees");
  owner.gitStep = vi.fn(async () => {});
  owner.unchangedHead = async () => {};
  owner.commit = async (
    _l: unknown,
    _c: string,
    _scope: unknown,
    _message: string,
    _before: string,
    title: string,
  ) => {
    if (title === "commit-post-integration-repair") {
      git.head = "undelivered-repair";
      git.dirty = false;
    }
    return git.head;
  };
  owner.merge = async (_l: unknown, candidate: string) => {
    live.run.mergedCommit = candidate;
  };
  owner.checks = async (
    _l: unknown,
    cwd: string,
    _p: unknown,
    baseline: boolean,
    observed: unknown[],
  ) => {
    if (baseline) return true;
    expect(cwd).toBe(owner.cwd);
    const step = owner.step(live, "post-merge", "check");
    step.status = "failed";
    observed.push(step);
    return false;
  };
  owner.recoverStage = async (
    _l: unknown,
    _c: string,
    _p: unknown,
    stage: string,
    action: () => Promise<unknown>,
  ) => {
    try {
      return await action();
    } catch (error) {
      if (
        stage !== "post-merge verification" ||
        !(error instanceof AttemptFailure)
      )
        throw error;
      git.dirty = true;
      return action();
    }
  };
  const cleanup = vi.fn();
  owner.removeWorktrees = cleanup;
  await expect(owner.implement(live, proposal)).rejects.toThrow("Target moved");
  expect(live.run.mergedCommit).toBe("delivered");
  const [, entries, home] = cleanup.mock.calls[0];
  expect(entries[0].expected).toBe("delivered");
  delete owner.removeWorktrees;
  owner.run = vi.fn();
  await owner.removeWorktrees(live, entries, home);
  expect(owner.run).not.toHaveBeenCalled();
  expect(live.notes.join(" ")).toContain("HEAD moved");
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
