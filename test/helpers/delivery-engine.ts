/** The delivery engine against a real repository: several deliveries on one
 * repository, each with a real candidate worktree, a real repository lease
 * and the real landing queue. Every Git command and every declared build or
 * check command really runs; the model workers (implementation, review,
 * diagnosis) are stand-ins a test scripts. */
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckoutGate } from "../../src/service/checkout-gate.ts";
import type { ExecutionContext } from "../../src/service/contracts/models.ts";
import type {
  WorkflowBuild,
  WorkflowCheck,
  WorkflowProposal,
  WorkflowRun,
} from "../../src/service/contracts/workflow.ts";
import { ServiceCoordination } from "../../src/service/coordination.ts";
import { HostCapacity } from "../../src/service/host-capacity.ts";
import { LandingLog, MergeQueue } from "../../src/service/merge-queue.ts";
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
const OK = {
  outcome: "completed" as const,
  closed: true,
  signal: null,
  durationMs: 0,
  text: "",
  truncated: false,
};

export interface DeliveryOptions {
  /** The run's write scope. */
  scope?: string[];
  build?: WorkflowBuild[];
  checks?: WorkflowCheck[];
  /** Optional subdirectory relative to repo root for execution.cwd. */
  executionSubdir?: string;
}

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
      env: { ...process.env, GIT_EDITOR: "true", GIT_SEQUENCE_EDITOR: "true" },
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
    quarantine() {
      throw new Error("the fixture owner was quarantined");
    },
  };
  const gate = new CheckoutGate(owner);
  const queue = new MergeQueue();
  const landings = new LandingLog();
  const hostCapacity = new HostCapacity();
  const active = new Map<string, unknown>();

  /** One delivery of `goal`, admitted now: its baseline is the branch's head. */
  const delivery = (goal: string, options: DeliveryOptions = {}) => {
    const id = randomUUID();
    const execCwd = options.executionSubdir
      ? join(root, options.executionSubdir)
      : root;
    const execution: ExecutionContext = {
      cwd: execCwd,
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
    const definition = {
      ...stagedPlan(),
      goal,
      tasks: [],
      build: options.build ?? [],
      checks: options.checks ?? [{ name: "present", command: "test -f a.txt" }],
    };
    const proposal: WorkflowProposal = {
      id: randomUUID(),
      epoch,
      cwd: execCwd,
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
      scope: options.scope ?? ["a.txt", "b.txt"],
      notice: "",
      mergedCommit: null,
      humanReviewed: false,
      execution,
      delivery: view,
    };
    const records = new Map<string, string>();
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
      landed: landings.mark(
        `${view.binding.target.repositoryIdentity}\0${BRANCH}`,
      ),
      rules: undefined as
        | { from: string; to: string; paths: string[] }
        | undefined,
      merging: undefined as { paths: string[]; discard?: boolean } | undefined,
      accepted: undefined as { candidate: string } | undefined,
      reconciled: undefined as Set<string> | undefined,
      turn: undefined as unknown,
    };
    active.set(id, live);
    /** What the stand-in workers were asked, in order. */
    const asked: { kind: string; prompt: string; writes?: string[] }[] = [];
    /** The commits the review was shown, in order. */
    const reviewed: string[] = [];
    /** Every shell command that really ran, with where. */
    const commands: { cwd: string; command: string }[] = [];
    const hooks: {
      /** Stands in for the worker a recovery decision sends to edit files. */
      repair?: (work: {
        prompt: string;
        writes: string[];
        cwd: string;
      }) => void;
      /** Stands in for the diagnosis: returns a recovery decision. */
      diagnose?: (prompt: string, failed: string) => Record<string, unknown>;
      /** Stands in for the review's verdict. */
      review?: (prompt: string) => boolean;
    } = {};
    const engine = Object.assign(Object.create(Workflows.prototype), {
      cwd: root,
      root: join(state, "records"),
      active,
      hostCapacity,
      queue,
      landings,
      o: {
        owner,
        gate,
        secrets: () => [],
        coordination: {
          stateHome: state,
          files: {
            read: (path: string) =>
              records.has(path)
                ? { bytes: Buffer.from(records.get(path) as string) }
                : undefined,
            create: (path: string, body: string) => {
              records.set(path, body);
              return {};
            },
            replace: (path: string, _expected: unknown, body: string) => {
              records.set(path, body);
              return {};
            },
          },
        },
      },
      save() {},
      assertRunning() {
        if (live.abort.signal.aborted) throw new Error("canceled");
      },
      confirmedLinks: () => [],
      executionCwd: (
        targetLive: { execution: ExecutionContext },
        cwd: string,
        cwdRelative?: string,
      ) => {
        if (cwdRelative !== undefined)
          return cwdRelative ? join(cwd, cwdRelative) : cwd;
        if (targetLive.execution.cwd === root) return cwd;
        return join(cwd, targetLive.execution.cwd.slice(root.length + 1));
      },
      /** Every Git and shell command of the engine, really run. */
      async run(
        targetLive: { abort: AbortController; execution: ExecutionContext },
        cwd: string,
        operation: { git?: string[]; check?: WorkflowCheck },
        runOptions: {
          index?: string;
          uninterruptible?: boolean;
          cwdRelative?: string;
        } = {},
      ) {
        if (!runOptions.uninterruptible && targetLive.abort.signal.aborted)
          throw new Error("canceled");
        const runCwd = operation.check
          ? engine.executionCwd(targetLive, cwd, runOptions.cwdRelative)
          : cwd;
        if (operation.check)
          commands.push({ cwd: runCwd, command: operation.check.command });
        const done = operation.check
          ? spawnSync("/bin/sh", ["-c", operation.check.command], {
              cwd: runCwd,
              encoding: "utf8",
            })
          : spawnSync("git", [...IDENTITY, ...(operation.git ?? [])], {
              cwd,
              encoding: "utf8",
              env: {
                ...process.env,
                ...(runOptions.index
                  ? { GIT_INDEX_FILE: runOptions.index }
                  : {}),
              },
            });
        return {
          ...OK,
          outcome: done.status === 0 ? "completed" : "failed",
          exitCode: done.status,
          output: `${done.stdout}${done.stderr}`.trim(),
        };
      },
      async worker(
        _live: unknown,
        cwd: string,
        name: string,
        prompt: string,
        _readonly: boolean,
        _version: unknown,
        _roots: unknown,
        kind = "implementation",
      ) {
        asked.push({ kind, prompt });
        const step = engine.step(live, name, kind, randomUUID());
        let text: string;
        if (kind === "review") {
          reviewed.push(gitAt(cwd, "rev-parse", "HEAD"));
          text = JSON.stringify({
            approved: hooks.review?.(prompt) ?? true,
            summary: "inspected",
            blockingIssues: [],
          });
        } else if (kind === "diagnosis") {
          const failed = [...run.steps]
            .reverse()
            .find((s) => s.status === "failed");
          if (!hooks.diagnose || !failed)
            throw new Error(`unexpected diagnosis: ${prompt.slice(0, 400)}`);
          text = JSON.stringify(hooks.diagnose(prompt, failed.id));
        } else throw new Error(`unexpected ${kind} worker`);
        const result = { ...OK, exitCode: 0, output: "", text };
        engine.finishStep(live, step, result);
        return { result, step, report: null };
      },
      /** A worker sent to edit files of a worktree other than the candidate. */
      async implementation(
        _live: unknown,
        cwd: string,
        name: string,
        prompt: string,
      ) {
        asked.push({ kind: "implementation", prompt });
        const step = engine.step(live, name, "implementation", randomUUID());
        if (!hooks.repair)
          throw new Error(`unexpected worker: ${prompt.slice(0, 400)}`);
        hooks.repair({ prompt, writes: [], cwd });
        engine.finishStep(live, step, { ...OK, exitCode: 0, output: "" });
        return step;
      },
      /** A recovery decision's work item: the test edits the files. */
      async editAttempt(
        _live: unknown,
        cwd: string,
        _p: unknown,
        _id: string,
        prompt: string,
        writes: string[],
      ) {
        asked.push({ kind: "repair", prompt, writes });
        if (!hooks.repair)
          throw new Error(`unexpected repair: ${prompt.slice(0, 400)}`);
        hooks.repair({ prompt, writes, cwd });
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
      proposal,
      records,
      asked,
      reviewed,
      commands,
      hooks,
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
      /** One gated verification: builds, commit, seal on the branch's head,
       * checks, review; failures go through the real recovery gate. */
      accept: () =>
        engine.verifyAndRepair(live, cwd, proposal, true, []) as Promise<void>,
      land: () => engine.land(live, cwd, proposal) as Promise<void>,
      /** The landing, and what the engine does when nothing can be landed. */
      async deliver(): Promise<void> {
        try {
          await engine.land(live, cwd, proposal);
        } catch (error) {
          if (!(await engine.deliverOnBranch(live, cwd, error))) throw error;
        }
      },
      head: () => gitAt(cwd, "rev-parse", "HEAD"),
    };
  };
  return {
    home,
    root,
    state,
    git,
    gitAt,
    gate,
    queue,
    landings,
    delivery,
    BRANCH,
  };
}
