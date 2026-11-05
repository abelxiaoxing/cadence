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
