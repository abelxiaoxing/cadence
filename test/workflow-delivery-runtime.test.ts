/** Controlled owner/worker/native seam, not a running SDK/service/provider.
 * Real Git identity, scope and cleanup behavior has separate fast fixtures. */
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { ExecutionContext } from "../src/service/contracts/models.ts";
import type {
  WorkflowProposal,
  WorkflowRun,
  WorkflowStep,
} from "../src/service/contracts/workflow.ts";
import { deliveryObservation } from "../src/service/workflow-delivery.ts";
import { Workflows } from "../src/service/workflows.ts";
import { plan } from "./helpers/workflow-plan.ts";

const seam = vi.hoisted(() => ({
  heads: new Map<string, string>(),
  branch: "refs/heads/main",
  dirty: false,
  missing: false,
}));
vi.mock("../src/service/workflow-git.ts", async (original) => ({
  ...(await original<object>()),
  assertWorktree: async () => {},
  assertWorkflowScope: async () => [],
  assertWorkflowCommit: async () => [],
  assertCommittedScope: async () => {},
  assertRepository: () => {},
  assertCandidate: async (cwd: string, oid: string) => {
    if (seam.heads.get(cwd) !== oid || seam.dirty)
      throw new Error("candidate changed");
  },
  gitHead: async (cwd: string) => {
    if (seam.missing) throw new Error("unreadable");
    return seam.heads.get(cwd);
  },
  gitText: async (_cwd: string, args: string[]) =>
    args[0] === "symbolic-ref" ? seam.branch : "a".repeat(40),
  documentPlacement: async () => "commit",
  pathIdentity: () => null,
  committedPaths: async () => ["a.txt"],
  tracked: async () => true,
}));
afterEach(() => {
  vi.restoreAllMocks();
  seam.heads.clear();
  seam.branch = "refs/heads/main";
  seam.dirty = false;
  seam.missing = false;
});
function fixture(mode = "pass") {
  const root = resolve("/controlled-delivery-fixture"),
    base = "1".repeat(40),
    id = randomUUID(),
    epoch = randomUUID();
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
  const binding = {
    policy: "task-branch-v1" as const,
    target: {
      checkoutRoot: root,
      repository: resolve("/controlled-repository"),
      repositoryIdentity: "a".repeat(64),
      branch: "refs/heads/main",
      head: base,
    },
  };
  const d = deliveryObservation(
    binding,
    resolve("/controlled-worktrees"),
    id,
    "controlled",
  );
  const p: WorkflowProposal = {
    id: randomUUID(),
    epoch,
    cwd: root,
    checkoutRoot: root,
    digest: "d".repeat(64),
    observation: "a".repeat(64),
    model: execution.version,
    plan: plan(),
    delivery: binding,
  };
  p.plan.tasks = [p.plan.tasks[0]];
  p.plan.projectContext = "";
  p.plan.repairAttempts = mode === "repair" ? 1 : 0;
  const run: WorkflowRun = {
    id,
    epoch,
    goal: p.plan.goal,
    status: "running",
    phase: "implementing",
    steps: [],
    notice: "",
    mergedCommit: null,
    humanReviewed: false,
    execution,
    delivery: d,
  };
  const live = {
    run,
    execution,
    proposal: p,
    abort: new AbortController(),
    target: { head: base, branch: "refs/heads/main" },
    delivered: new Set<string>(),
    notes: [] as string[],
    delivery: undefined as unknown,
  };
  const events: string[] = [];
  let n = 2,
    rounds = 0;
  const commit = () => (n++).toString(16).padStart(40, "0");
  const ok = {
    outcome: "completed",
    closed: true,
    exitCode: 0,
    signal: null,
    durationMs: 0,
    text: "",
    output: "",
    truncated: false,
  };
  seam.heads.set(root, base);
  // Explicitly controlled private seam: no approval, owner or native result is fabricated in production.
  const engine = Object.create(Workflows.prototype);
  engine.o = {
    owner: { state: "idle", lease: { assert() {} } },
    secrets: () => [],
  };
  engine.cwd = root;
  engine.save = () => {};
  engine.assertRunning = () => {
    if (live.abort.signal.aborted) throw new Error("canceled");
  };
  engine.step = (
    _live: unknown,
    name: string,
    kind: WorkflowStep["kind"],
  ): WorkflowStep => {
    const step = {
      id: `${name}-${randomUUID()}`,
      kind,
      status: "running" as const,
      exitCode: null,
      text: "",
      truncated: false,
    };
    run.steps.push(step);
    return step;
  };
  engine.finishStep = (
    _live: unknown,
    step: WorkflowStep,
    result: typeof ok,
  ) => {
    step.status = result.outcome === "completed" ? "completed" : "failed";
    step.exitCode = result.exitCode;
  };
  engine.closeStep = () => {};
  engine.setup = async () => {
    events.push("setup");
  };
  engine.gitStep = async (
    _live: unknown,
    cwd: string,
    title: string,
    body: (git: (args: string[]) => Promise<unknown>) => Promise<unknown>,
  ) => {
    events.push(title);
    return body(async (args) => {
      if (args[0] === "cherry-pick") seam.heads.set(cwd, commit());
      return ok;
    });
  };
  engine.commit = async (
    _live: unknown,
    cwd: string,
    _allowed: string[],
    _message: string,
    _before: string,
    title: string,
  ) => {
    events.push(title);
    const oid = commit();
    seam.heads.set(cwd, oid);
    return oid;
  };
  engine.implementation = async (
    _live: unknown,
    _cwd: string,
    task: string,
  ) => {
    events.push(task.startsWith("repair-") ? "repair" : "implementation");
  };
  engine.evidence = (_live: unknown, steps: WorkflowStep[]) =>
    steps.map((step) => `${step.id}: ${step.status}`).join("\n");
  engine.publish = () => {
    events.push("documents");
  };
  engine.checks = async (
    _live: unknown,
    cwd: string,
    _plan: unknown,
    baseline = false,
  ) => {
    if (baseline) return true;
    const post = cwd === root;
    if (!post) rounds++;
    const pass = post
      ? mode !== "post-failure"
      : mode !== "check-failure" && !(mode === "repair" && rounds === 1);
    events.push(post ? "post-check" : "check");
    run.steps.push({
      id: `check-${run.steps.length}`,
      kind: "check",
      status: pass ? "completed" : "failed",
      exitCode: pass ? 0 : 1,
      text: "controlled",
      truncated: false,
    });
    if (mode === "dirty" && !post) seam.dirty = true;
    return pass;
  };
  engine.review = async () => {
    events.push("review");
    const verdict =
      mode === "review-failure"
        ? "rejected"
        : mode === "unparseable"
          ? "unparseable"
          : "approved";
    run.steps.push({
      id: `review-${run.steps.length}`,
      kind: "review",
      status:
        verdict === "approved"
          ? "completed"
          : verdict === "rejected"
            ? "rejected"
            : "failed",
      exitCode: 0,
      text: verdict,
      truncated: false,
    });
    if (mode === "target-moved") seam.heads.set(root, "f".repeat(40));
    if (mode === "cancel") live.abort.abort();
    return verdict;
  };
  engine.run = async (
    _live: unknown,
    cwd: string,
    operation: { git: string[] },
  ) => {
    expect(operation.git[0]).toBe("merge");
    events.push("merge");
    expect(d.acceptance?.candidate).toBe(d.candidate);
    const selected = operation.git.at(-1);
    if (!selected) throw new Error("Missing candidate");
    seam.heads.set(cwd, selected);
    if (mode === "unknown") seam.missing = true;
    if (mode === "cancel-in-merge") live.abort.abort();
    return ok;
  };
  const cleanup = vi.fn(async () => {
    events.push("cleanup");
    d.cleanup.status = "removed";
  });
  live.delivery = {
    view: d,
    home: resolve("/controlled-worktrees", id),
    prepareHome() {},
    resources: {
      mutate: async (
        _repo: string,
        _signal: AbortSignal,
        fn: () => Promise<unknown>,
      ) => fn(),
    },
    create: async (task: string, oid: string) => {
      const path =
        task === "@candidate"
          ? d.worktreeRoot
          : resolve("/controlled-worktrees", id, "tasks", task);
      seam.heads.set(path, oid);
      return path;
    },
    assertWorkspace() {},
    assertBinding: async () => {},
    assertHead: async (cwd: string) => {
      const head = seam.heads.get(cwd);
      if (!head) throw new Error("missing head");
      return head;
    },
    update() {},
    applied() {},
    cleanup,
    assertAccepted: async () => {
      if (seam.heads.get(root) !== base) throw new Error("target moved");
      if (
        !d.acceptance ||
        d.acceptance.candidate !== seam.heads.get(d.worktreeRoot)
      )
        throw new Error("stale acceptance");
      return d.acceptance.candidate;
    },
  };
  return {
    live,
    run,
    d,
    events,
    engine,
    cleanup,
    execute: () => engine.implement(live, p),
    rounds: () => rounds,
  };
}
it("one pipeline publishes and commits docs BEFORE exact-candidate checks/review, then merges that OID and cleans", async () => {
  const f = fixture();
  await f.execute();
  expect(f.events.indexOf("commit-delivery-notes")).toBeLessThan(
    f.events.indexOf("check"),
  );
  expect(f.events.indexOf("check")).toBeLessThan(f.events.indexOf("review"));
  expect(f.events.indexOf("review")).toBeLessThan(f.events.indexOf("merge"));
  expect(f.events.slice(-3)).toEqual(["merge", "post-check", "cleanup"]);
  expect(f.d.acceptance?.candidate).toBe(f.run.mergedCommit);
  expect(f.d.integration.status).toBe("applied");
  expect(f.d.postChecks).toBe("passed");
});
it.each([
  "check-failure",
  "review-failure",
  "unparseable",
  "dirty",
  "target-moved",
  "cancel",
])("%s never reaches target mutation or cleanup", async (mode) => {
  const f = fixture(mode);
  await expect(f.execute()).rejects.toThrow();
  expect(f.events).not.toContain("merge");
  expect(f.cleanup).not.toHaveBeenCalled();
  expect(f.run.mergedCommit).toBeNull();
});
it("a bounded repair replaces the candidate and acceptance references only the new round", async () => {
  const f = fixture("repair");
  await f.execute();
  expect(f.rounds()).toBe(2);
  expect(f.events.filter((e) => e === "repair")).toHaveLength(1);
  const checks = f.run.steps.filter((s) => s.kind === "check");
  expect(f.d.acceptance?.checks).toEqual([checks[1].id]);
  expect(checks[0].status).toBe("failed");
});
it("post-merge failure retains the applied commit, failed check and worktrees without rollback", async () => {
  const f = fixture("post-failure");
  await expect(f.execute()).rejects.toThrow("post-merge checks failed");
  expect(f.run.mergedCommit).toBe(f.d.candidate);
  expect(f.d.integration.status).toBe("applied");
  expect(f.d.postChecks).toBe("failed");
  expect(f.cleanup).not.toHaveBeenCalled();
});
it("unreadable post-merge identity remains unknown and never invents a merged commit", async () => {
  const f = fixture("unknown");
  await expect(f.execute()).rejects.toThrow("unknown");
  expect(f.run.mergedCommit).toBeNull();
  expect(f.d.integration.status).toBe("unknown");
  expect(f.cleanup).not.toHaveBeenCalled();
});

it("Cancel during the noninterruptible merge keeps the applied commit but starts no later publication/check/cleanup", async () => {
  const f = fixture("cancel-in-merge");
  await expect(f.execute()).rejects.toThrow("canceled");
  expect(f.run.mergedCommit).toBe(f.d.candidate);
  expect(f.d.integration.status).toBe("applied");
  expect(f.d.postChecks).toBe("not-run");
  expect(f.events).not.toContain("post-check");
  expect(f.cleanup).not.toHaveBeenCalled();
});

it("delivery read projections redact newly known literals without rewriting retained binding/evidence", () => {
  const f = fixture();
  const secret = "newly-known-private-literal";
  f.d.integration.reason = `Retained diagnostic ${secret}`;
  f.engine.o.secrets = () => [secret];
  const projected = f.engine.projectDelivery(f.run);
  expect(projected.delivery.integration.reason).toContain("[redacted]");
  expect(JSON.stringify(projected)).not.toContain(secret);
  expect(f.d.integration.reason).toContain(secret);
});
