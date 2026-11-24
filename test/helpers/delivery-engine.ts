/** The delivery engine's own Git steps against a real repository: several
 * deliveries on one repository, each with a real candidate worktree, a real
 * repository lease and the real landing queue. Workers, checks and the review
 * are stand-ins; every Git command is real. */
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckoutGate } from "../../src/service/checkout-gate.ts";
import type { ExecutionContext } from "../../src/service/contracts/models.ts";
import type {
  WorkflowProposal,
  WorkflowRun,
  WorkflowStep,
} from "../../src/service/contracts/workflow.ts";
import { ServiceCoordination } from "../../src/service/coordination.ts";
import { HostCapacity } from "../../src/service/host-capacity.ts";
import { MergeQueue } from "../../src/service/merge-queue.ts";
import { RepositoryCoordination } from "../../src/service/repository-coordination.ts";
import {
  deliveryObservation,
  WorkflowDelivery,
} from "../../src/service/workflow-delivery.ts";
import { deliveryTarget } from "../../src/service/workflow-git.ts";
import { Workflows } from "../../src/service/workflows.ts";
import { stagedPlan } from "./workflow-plan.ts";

const IDENTITY = [
  "-c",
  "user.name=Delivery fixture",
  "-c",
  "user.email=fixture@example.invalid",
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "merge.conflictStyle=zdiff3",
];
const BRANCH = "refs/heads/main";

export function repository() {
  const home = mkdtempSync(join(tmpdir(), "delivery-engine-"));
  const root = join(home, "repo"),
    state = join(home, "state");
  mkdirSync(root);
  mkdirSync(state, { mode: 0o700 });
  const gitAt = (cwd: string, ...args: string[]) =>
    execFileSync("git", [...IDENTITY, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const git = (...args: string[]) => gitAt(root, ...args);
  git("init", "-q", "-b", "main");
  writeFileSync(join(root, "a.txt"), "one\ntwo\nthree\nfour\nfive\n");
  writeFileSync(join(root, "b.txt"), "b\n");
  writeFileSync(join(root, ".gitignore"), "ignored/\n");
  git("add", "-A");
  git("commit", "-qm", "baseline");
  const coordination = new ServiceCoordination(root, state),
    epoch = randomUUID();
  const owner = {
    state: "idle" as const,
    lease: { assert() {}, registration: { epoch } },
  };
  const gate = new CheckoutGate(owner);
  const queue = new MergeQueue();
  const hostCapacity = new HostCapacity();

  /** One delivery of `goal`, admitted now: its baseline is the branch's head. */
  const delivery = (goal: string, scope: string[] = ["a.txt", "b.txt"]) => {
    const id = randomUUID();
    const execution: ExecutionContext = {
      cwd: root,
      checkoutRoot: root,
      model: null,
      version: {
        epoch,
        accessGeneration: 1,
        configRev: 1,
        catalogId: randomUUID(),
      },
    };
    const base = git("rev-parse", BRANCH);
    const view = deliveryObservation(
      {
        policy: "task-branch-v3",
        target: deliveryTarget(root, { head: base, branch: BRANCH }),
      },
      join(state, "cadence-worktrees-v1", "fixture"),
      id,
      goal,
    );
    const definition = { ...stagedPlan(), goal };
    const proposal: WorkflowProposal = {
      id: randomUUID(),
      epoch,
      cwd: root,
      checkoutRoot: root,
      digest: "d".repeat(64),
      observation: "a".repeat(64),
      model: execution.version,
      plan: definition,
    };
    const run: WorkflowRun = {
      id,
      epoch,
      goal,
      status: "running",
      phase: "implementing",
      steps: [],
      revision: 0,
      scope,
      notice: "",
      mergedCommit: null,
      humanReviewed: false,
      execution,
      delivery: view,
    };
    const records = new Map<string, unknown>();
    const resources = new RepositoryCoordination(
      coordination,
      root,
      epoch,
      id,
      () => {},
      () => {},
    );
    const workflow = new WorkflowDelivery(view, resources, () => {});
    const live = {
      run,
      execution,
      proposal,
      abort: new AbortController(),
      delivered: new Set<string>(),
      notes: [] as string[],
      delivery: workflow,
      rules: undefined as
        | { from: string; to: string; paths: string[] }
        | undefined,
      turn: undefined as unknown,
    };
    const reviewed: string[] = [];
    const step = (
      name: string,
      kind: WorkflowStep["kind"],
      status: WorkflowStep["status"] = "running",
    ): WorkflowStep => {
      const made: WorkflowStep = {
        id: `${name}-${randomUUID()}`,
        kind,
        status,
        text: "",
        exitCode: status === "completed" ? 0 : null,
        truncated: false,
      };
      run.steps.push(made);
      return made;
    };
    const engine = Object.assign(Object.create(Workflows.prototype), {
      cwd: root,
      root: join(state, "records"),
      active: new Map([[id, live]]),
      hostCapacity,
      queue,
      o: { owner, gate, secrets: () => [] },
      save() {},
      write: (path: string, value: unknown) => records.set(path, value),
      persist: (path: string, value: unknown) => records.set(path, value),
      keep: () => true,
      assertRunning() {
        if (live.abort.signal.aborted) throw new Error("canceled");
      },
      confirmedLinks: () => [],
      step: (_live: unknown, name: string, kind: WorkflowStep["kind"]) =>
        step(name, kind),
      finishStep(
        _live: unknown,
        made: WorkflowStep,
        result: { outcome: WorkflowStep["status"]; exitCode: number | null },
        preview?: string,
      ) {
        made.status = result.outcome;
        made.exitCode = result.exitCode;
        made.text = preview ?? "";
      },
      closeStep(_live: unknown, made: WorkflowStep) {
        if (made.status === "running") made.status = "failed";
      },
      /** Every real Git command of the engine, with the fixture's identity. */
      async run(_live: unknown, cwd: string, operation: { git: string[] }) {
        const done = spawnSync("git", [...IDENTITY, ...operation.git], {
          cwd,
          encoding: "utf8",
        });
        return {
          outcome: "completed" as const,
          closed: true,
          exitCode: done.status,
          signal: null,
          durationMs: 0,
          text: "",
          output: `${done.stdout}${done.stderr}`.trim(),
          truncated: false,
        };
      },
      async checks(
        _live: unknown,
        _cwd: string,
        _plan: unknown,
        _baseline: boolean,
        observed: WorkflowStep[],
      ) {
        observed.push(step("outputs", "check", "completed"));
        return true;
      },
      async review(_live: unknown, cwd: string) {
        reviewed.push(gitAt(cwd, "rev-parse", "HEAD"));
        return {
          verdict: "approved" as const,
          step: step("review", "review", "completed"),
        };
      },
    });
    const cwd = view.worktreeRoot;
    return {
      id,
      live,
      engine,
      view,
      cwd,
      base,
      records,
      /** The commits the review was shown, in order. */
      reviewed,
      async create() {
        workflow.prepareHome();
        await engine.gitStep(
          live,
          root,
          "worktree-integration",
          (run: (args: string[]) => Promise<unknown>) => workflow.create(run),
        );
        return cwd;
      },
      /** One verification round: commit, seal on the branch's head, check, review. */
      accept: () =>
        engine.verificationRound(
          live,
          cwd,
          proposal,
          true,
          [],
          {},
          {
            previous: "",
          },
        ) as Promise<void>,
      land: () => engine.land(live, cwd, proposal) as Promise<void>,
      head: () => gitAt(cwd, "rev-parse", "HEAD"),
    };
  };
  return { home, root, state, git, gitAt, gate, queue, delivery, BRANCH };
}
