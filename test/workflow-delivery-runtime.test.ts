/** Real adaptive owner + delivery controller; controlled Git/worker/native ports.
 * Resource ownership, Git identity and residue have separate real-Git fixtures. */
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  CheckoutGate,
  type CheckoutPermit,
} from "../src/service/checkout-gate.ts";
import type { ExecutionContext } from "../src/service/contracts/models.ts";
import {
  decodeDeliveryObservation,
  type WorkflowProposal,
  type WorkflowRun,
} from "../src/service/contracts/workflow.ts";
import type { RepositoryCoordination } from "../src/service/repository-coordination.ts";
import {
  deliveryObservation,
  WorkflowDelivery,
} from "../src/service/workflow-delivery.ts";
import { pathIdentity } from "../src/service/workflow-git.ts";
import { Workflows } from "../src/service/workflows.ts";
import { plan } from "./helpers/workflow-plan.ts";

const seam = vi.hoisted(() => ({
  trees: new Map<
    string,
    {
      head: string;
      branch: string;
      files: Map<string, string>;
      dirty: Set<string>;
    }
  >(),
  missing: false,
}));
vi.mock("../src/service/workflow-git.ts", async (original) => ({
  ...(await original<object>()),
  assertWorktree: async () => {},
  assertRepository: () => {},
  assertCommittedScope: async () => {},
  assertWorkflowCommit: async () => [],
  assertWorkflowScope: async (cwd: string, allowed: string[]) => {
    const dirty = [...seam.trees.get(cwd)!.dirty];
    if (dirty.some((p) => !allowed.includes(p)))
      throw new Error("outside scope");
    return dirty;
  },
  changedPaths: async (cwd: string) => [...seam.trees.get(cwd)!.dirty],
  assertCandidate: async (cwd: string, oid: string) => {
    const tree = seam.trees.get(cwd)!;
    if (tree.head !== oid || tree.dirty.size)
      throw new Error("candidate changed");
  },
  assertTarget: async (
    cwd: string,
    expected: { head: string; branch: string },
  ) => {
    const tree = seam.trees.get(cwd)!;
    if (tree.head !== expected.head || tree.branch !== expected.branch)
      throw new Error("Target moved");
  },
  gitHead: async (cwd: string) => {
    if (seam.missing) throw new Error("unreadable");
    return seam.trees.get(cwd)!.head;
  },
  gitText: async (cwd: string, args: string[]) =>
    args[0] === "symbolic-ref" ? seam.trees.get(cwd)!.branch : "a".repeat(40),
  gitRun: async (cwd: string, args: string[]) => ({
    code:
      args[0] === "show-ref" ||
      (args[0] === "diff" && seam.trees.get(cwd)!.dirty.size)
        ? 1
        : 0,
    stdout: "",
  }),
  sourceIdentityAsync: async (cwd: string, scope: string[]) =>
    JSON.stringify(
      scope.map((p) => [p, seam.trees.get(cwd)!.files.get(p) ?? null]),
    ),
  workingSnapshot: async (cwd: string, scope: string[]) => ({
    git: true,
    paths: new Map(
      scope.map((p) => [p, seam.trees.get(cwd)!.files.get(p) ?? null]),
    ),
  }),
  pathIdentity: vi.fn((): string | null => null),
  documentPlacement: async () => "commit",
  committedPaths: async () => ["a.txt"],
  worktreeResidue: async () => [],
  tracked: async () => true,
}));
afterEach(() => {
  vi.restoreAllMocks();
  seam.trees.clear();
  seam.missing = false;
  vi.mocked(pathIdentity).mockReset().mockReturnValue(null);
});

function latch() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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
  const d = deliveryObservation(
    {
      policy: "task-branch-v1",
      target: {
        checkoutRoot: root,
        repository: resolve("/controlled-repository"),
        repositoryIdentity: "a".repeat(64),
        branch: "refs/heads/main",
        head: base,
      },
    },
    resolve("/controlled-worktrees"),
    id,
    "controlled",
  );
  const definition = plan();
  definition.tasks = [definition.tasks[0]];
  definition.documents = ["knowledge.md"];
  if (mode === "baseline-scope")
    definition.baselineChecks = [{ name: "baseline", command: "verify" }];
  const p: WorkflowProposal = {
    id: randomUUID(),
    epoch,
    cwd: root,
    checkoutRoot: root,
    digest: "d".repeat(64),
    observation: "a".repeat(64),
    model: execution.version,
    plan: definition,
    delivery: d.binding,
  };
  const run: WorkflowRun = {
    id,
    epoch,
    goal: p.plan.goal,
    status: "running",
    phase: "implementing",
    steps: [],
    revision: 0,
    notice: "",
    mergedCommit: null,
    humanReviewed: false,
    execution,
    delivery: d,
  };
  const records = new Map<string, unknown>(),
    events: string[] = [],
    workspaces: string[] = [];
  const resources = {
    mutate: async (
      _repo: string,
      signal: AbortSignal,
      work: () => Promise<unknown>,
    ) => {
      if (signal.aborted) throw new Error("canceled");
      return work();
    },
    reserveWorkspace: () => randomUUID(),
    confirmWorkspace() {},
    assertWorkspace() {},
    release() {},
    finish() {},
  } as unknown as RepositoryCoordination;
  const delivery = new WorkflowDelivery(d, resources, () => {});
  vi.spyOn(delivery, "prepareHome").mockImplementation(() => {});
  const cleanup = vi.spyOn(delivery, "cleanup");
  const owner = { state: "idle" as const, lease: { assert() {} } };
  const gate = new CheckoutGate(owner);
  const live = {
    run,
    execution,
    proposal: p,
    abort: new AbortController(),
    target: { head: base, branch: "refs/heads/main" },
    delivered: new Set<string>(),
    notes: [] as string[],
    delivery,
    guidance: { agents: null },
    barrier: undefined as CheckoutPermit | undefined,
  };
  let serial = 2,
    implementations = 0,
    candidateChecks = 0,
    postChecks = 0,
    reviews = 0;
  const oid = () => (serial++).toString(16).padStart(40, "0");
  const ok = {
    outcome: "completed",
    closed: true,
    exitCode: 0,
    signal: null,
    durationMs: 0,
    text: "",
    output: "controlled native evidence",
    truncated: false,
  };
  seam.trees.set(root, {
    head: base,
    branch: d.binding.target.branch,
    files: new Map([["a.txt", "before"]]),
    dirty: new Set(),
  });
  const put = (cwd: string, path: string, text: string) => {
    seam.trees.get(cwd)!.files.set(path, text);
    seam.trees.get(cwd)!.dirty.add(path);
  };
  const engine = Object.assign(Object.create(Workflows.prototype), {
    cwd: root,
    root: resolve("/controlled-records"),
    active: new Map([[run.id, live]]),
    o: {
      owner,
      gate,
      secrets: () => [],
      coordination: {
        files: {
          read: (path: string) =>
            records.has(path)
              ? { bytes: Buffer.from(JSON.stringify(records.get(path))) }
              : undefined,
        },
      },
    },
    executionCwd: (_live: unknown, cwd: string) => cwd,
    assertRunning: () => {
      if (live.abort.signal.aborted) throw new Error("canceled");
    },
    save: () => {
      expect(decodeDeliveryObservation(d)).toEqual(d);
    },
    write: (path: string, value: unknown) => records.set(path, value),
    publish: (_live: unknown, cwd: string, _plan: unknown, names: string[]) => {
      events.push("documents");
      for (const name of names) put(cwd, name, "owner notes");
    },
  });
  engine.run = async (
    _live: unknown,
    cwd: string,
    operation: { git?: string[]; check?: unknown },
  ) => {
    if (operation.check) {
      const post = cwd === root;
      if (post) postChecks++;
      else candidateChecks++;
      events.push(post ? "post-check" : "check");
      const failed = post
        ? [
            "post-repair",
            "post-blocked",
            "post-target-moved",
            "post-retry",
          ].includes(mode) && postChecks === 1
        : (mode === "check-repair" && candidateChecks <= 3) ||
          (mode === "baseline-scope" && candidateChecks === 1);
      return {
        ...ok,
        outcome: failed ? "failed" : "completed",
        exitCode: failed ? 1 : 0,
      };
    }
    const args = operation.git!;
    if (args[0] === "worktree" && args[1] === "add") {
      expect(args).not.toContain("--detach");
      expect(args[2]).toBe("-b");
      const path = args[4];
      workspaces.push(path);
      events.push("create");
      seam.trees.set(path, {
        head: base,
        branch: `refs/heads/${args[3]}`,
        files: new Map(seam.trees.get(root)!.files),
        dirty: new Set(),
      });
    } else if (args[0] === "commit") {
      events.push("commit");
      seam.trees.get(cwd)!.head = oid();
      seam.trees.get(cwd)!.dirty.clear();
    } else if (args[0] === "merge") {
      events.push("merge");
      expect(d.acceptance?.candidate).toBe(args.at(-1));
      const target = seam.trees.get(root)!,
        candidate = seam.trees.get(d.worktreeRoot)!;
      target.head = candidate.head;
      target.files = new Map(candidate.files);
      if (mode === "unknown") seam.missing = true;
      if (mode === "cancel-in-merge") live.abort.abort();
    } else if (args[0] === "worktree" && args[1] === "remove")
      events.push("cleanup");
    else expect(args[0]).toBe("add");
    return { ...ok };
  };
  engine.worker = async (
    _live: unknown,
    cwd: string,
    name: string,
    prompt: string,
    readonly: boolean,
    _version: unknown,
    _roots: unknown,
    kind?: string,
  ) => {
    expect(cwd).toBe(d.worktreeRoot);
    const step = engine.step(
      live,
      name,
      kind ?? "implementation",
      randomUUID(),
    );
    let text = "",
      report = null;
    if (kind === "diagnosis") {
      events.push("diagnosis");
      const failed = [...run.steps]
        .reverse()
        .find((s) =>
          ["failed", "rejected", "partial", "blocked"].includes(s.status),
        )!;
      const blocked = mode === "post-blocked";
      text = JSON.stringify({
        action: blocked ? "blocked" : "continue",
        // Blocked is only for a named condition outside the repository.
        ...(blocked ? { blocker: "tool" } : {}),
        cause: "controlled observed failure",
        ...(mode === "baseline-scope" ? { scope: ["test/fixture.ts"] } : {}),
        evidence: [failed.id],
        strategy: `Continue from preserved evidence, revision ${(run.revision ?? 0) + 1}`,
        work:
          blocked || mode === "partial" || mode === "unparseable"
            ? []
            : [
                {
                  title: "Fix remaining behavior",
                  instructions: "Use preserved output",
                  writes: [
                    mode === "baseline-scope" ? "test/fixture.ts" : "a.txt",
                  ],
                },
              ],
      });
      if (mode === "post-target-moved")
        seam.trees.get(root)!.head = "f".repeat(40);
    } else if (kind === "knowledge") {
      events.push("knowledge");
      expect(prompt).toContain("controlled native evidence");
      put(cwd, "knowledge.md", "Verified project fact with evidence");
      report = { status: "completed", summary: "Updated approved knowledge" };
    } else if (readonly) {
      events.push("review");
      reviews++;
      expect(d.candidate).toBe(seam.trees.get(cwd)!.head);
      expect(seam.trees.get(cwd)!.dirty.size).toBe(0);
      text =
        mode === "unparseable" && reviews === 1
          ? "not a verdict"
          : JSON.stringify({
              approved: !(mode === "rejected" && reviews === 1),
              summary: "inspected",
              blockingIssues: [],
            });
      if (mode === "target-moved") seam.trees.get(root)!.head = "f".repeat(40);
      if (mode === "review-change")
        put(cwd, "a.txt", "foreign edit during review");
      if (mode === "cancel") live.abort.abort();
    } else if (mode === "baseline-scope" && name.startsWith("repair-")) {
      events.push("baseline-repair");
      put(cwd, "test/fixture.ts", "environment-independent fixture");
      report = {
        status: "completed",
        summary: "Preserved the assertion, fixed its fixture",
      };
    } else {
      events.push("implementation");
      implementations++;
      if (implementations > 1)
        expect(seam.trees.get(cwd)!.files.get("a.txt")).toContain("partial");
      if (mode !== "post-retry" || implementations === 1)
        put(cwd, "a.txt", `partial outputs through attempt ${implementations}`);
      report = {
        status:
          mode === "partial" && implementations <= 3 ? "blocked" : "completed",
        summary: "Partial outputs retained, next work identified",
      };
    }
    if (report) text = JSON.stringify(report);
    const result = { ...ok, text };
    engine.finishStep(
      live,
      step,
      result,
      undefined,
      readonly ? undefined : report,
    );
    return { result, step, report };
  };
  return {
    live,
    run,
    d,
    engine,
    events,
    records,
    workspaces,
    cleanup,
    execute: async () => {
      live.barrier = await engine.o.gate.acquire(
        live.run.id,
        live.abort.signal,
      );
      try {
        return await engine.implement(live, p);
      } finally {
        live.barrier?.release();
      }
    },
    counts: () => ({ implementations, candidateChecks, postChecks, reviews }),
  };
}

it("one named stable worktree combines implementation, verified knowledge and final notes before exact acceptance", async () => {
  const f = fixture();
  await f.execute();
  expect(f.workspaces).toEqual([f.d.worktreeRoot]);
  expect(f.d.taskBranch).toContain(f.run.id);
  expect(f.events.indexOf("knowledge")).toBeGreaterThan(
    f.events.indexOf("review"),
  );
  const notes = f.events.indexOf("documents"),
    merge = f.events.indexOf("merge");
  expect(f.events.slice(notes + 1, merge)).toEqual([
    "commit",
    "check",
    "review",
  ]);
  expect(f.events.slice(-3)).toEqual(["merge", "post-check", "cleanup"]);
  expect(f.d.acceptance?.candidate).toBe(f.run.mergedCommit);
  expect(f.d.postChecks).toBe("passed");
  expect(f.d.cleanup.status).toBe("removed");
  expect(seam.trees.get(f.d.worktreeRoot)!.files.get("knowledge.md")).toContain(
    "Verified",
  );
});
it("isolated implementations overlap and one may deliver while the other is still working", async () => {
  const first = fixture();
  const second = fixture();
  const gate = first.engine.o.gate;
  second.engine.o.gate = gate;
  first.engine.active.set(second.run.id, second.live);
  const enteredFirst = latch();
  const enteredSecond = latch();
  const finishFirst = latch();
  const finishSecond = latch();
  const assignments = first.engine.assignments.bind(first.engine);
  vi.spyOn(first.engine, "assignments").mockImplementation(async () => {
    enteredFirst.resolve();
    await finishFirst.promise;
    await assignments(first.live, first.d.worktreeRoot, first.live.proposal);
  });
  vi.spyOn(second.engine, "assignments").mockImplementation(async () => {
    enteredSecond.resolve();
    await finishSecond.promise;
    throw new Error("second assignment settled unsuccessfully");
  });
  const a = first.execute();
  let b: Promise<unknown> | undefined;
  try {
    await enteredFirst.promise;
    expect(() => gate.assertQuiescent()).not.toThrow();
    b = expect(second.execute()).rejects.toThrow("second assignment settled");
    await enteredSecond.promise;
    expect(first.events).not.toContain("merge");
    expect(second.events).not.toContain("merge");
    finishFirst.resolve();
    await a;
    expect(first.d.postChecks).toBe("passed");
    expect(second.d.integration.status).toBe("pending");
    expect(second.live.delivery.frontierHead()).toBe(first.run.mergedCommit);
  } finally {
    finishFirst.resolve();
    finishSecond.resolve();
    await Promise.allSettled([a, ...(b ? [b] : [])]);
  }
  gate.assertQuiescent();
});

it("canceling final-access admission leaves other original holders intact", async () => {
  const f = fixture();
  const gate = f.engine.o.gate;
  const reader = await gate.acquire(
    randomUUID(),
    new AbortController().signal,
    "shared",
  );
  const waiting = expect(
    f.engine.checkoutAccess(f.live, "exclusive"),
  ).rejects.toThrow("stale");
  f.live.abort.abort();
  await waiting;
  expect(f.live.barrier).toBeUndefined();
  reader.assertHeld();
  expect(() => gate.assertQuiescent()).toThrow("conflict");
  reader.release();
  gate.assertQuiescent();
});

it("refreshes sibling knowledge before this run maintains shared project knowledge", async () => {
  const f = fixture();
  const refresh = vi.spyOn(f.engine, "refreshCandidate");
  const learn = vi.spyOn(f.engine, "learn");
  await f.execute();
  expect(refresh).toHaveBeenCalledOnce();
  expect(learn).toHaveBeenCalledOnce();
  expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(
    learn.mock.invocationCallOrder[0],
  );
});

it("guidance drift during the final review refuses the target merge", async () => {
  const f = fixture();
  const publish = f.engine.publish.bind(f.engine);
  vi.spyOn(f.engine, "publish").mockImplementation(() => {
    publish(f.live, f.d.worktreeRoot, f.live.proposal.plan, [], []);
    vi.mocked(pathIdentity).mockReturnValue("changed guidance");
  });
  await expect(f.execute()).rejects.toThrow("conflict");
  expect(f.events).not.toContain("merge");
  expect(f.run.mergedCommit).toBeNull();
  expect(f.d.integration.status).toBe("blocked");
  expect(f.cleanup).not.toHaveBeenCalled();
});

it.each(["head", "branch"] as const)(
  "post-check %s drift never advances a sibling",
  async (field) => {
    const f = fixture();
    const advance = vi.spyOn(f.engine, "advanceSiblings");
    const checks = f.engine.checks.bind(f.engine);
    vi.spyOn(f.engine, "checks").mockImplementation(
      async (_live, cwd, ...rest) => {
        const result = await checks(_live, cwd, ...rest);
        if (cwd === f.engine.cwd)
          seam.trees.get(f.engine.cwd)![field] =
            field === "head" ? "f".repeat(40) : "refs/heads/other";
        return result;
      },
    );
    await expect(f.execute()).rejects.toThrow("stale");
    expect(f.run.mergedCommit).not.toBeNull();
    expect(f.d.postChecks).toBe("unknown");
    expect(advance).not.toHaveBeenCalled();
    expect(f.cleanup).not.toHaveBeenCalled();
  },
);

it("baseline repair can expand the original scope and deliver without another approval", async () => {
  const f = fixture("baseline-scope");
  await f.execute();
  expect(f.run.scope).toContain("test/fixture.ts");
  const revisions = [...f.records.entries()]
    .filter(([path]) => path.includes("revisions/"))
    .map(([, value]) => value);
  expect(revisions).toEqual([
    expect.objectContaining({
      stage: "baseline",
      decision: expect.objectContaining({
        level: "replan",
        scope: ["test/fixture.ts"],
      }),
    }),
  ]);
  expect(f.events.indexOf("baseline-repair")).toBeLessThan(
    f.events.indexOf("implementation"),
  );
  expect(f.events.filter((event) => event === "diagnosis")).toHaveLength(1);
  expect(f.workspaces).toHaveLength(1);
  expect(
    f.run.steps.some(
      (step) => step.kind === "check" && step.status === "failed",
    ),
  ).toBe(true);
  expect(f.d.acceptance?.candidate).toBe(f.run.mergedCommit);
  expect(f.d.postChecks).toBe("passed");
  expect(
    seam.trees
      .get(f.d.binding.target.checkoutRoot)!
      .files.get("test/fixture.ts"),
  ).toBe("environment-independent fixture");
});
it.each(["partial", "check-repair", "unparseable", "rejected"])(
  "adaptive %s recovery preserves one branch, with no fixed repair quota or new approval",
  async (mode) => {
    const f = fixture(mode);
    await f.execute();
    expect(f.run.revision).toBeGreaterThanOrEqual(
      ["partial", "check-repair"].includes(mode) ? 3 : 1,
    );
    expect(f.workspaces).toHaveLength(1);
    expect(f.events.filter((e) => e === "merge")).toHaveLength(1);
    for (const id of f.d.acceptance!.checks)
      expect(f.run.steps.find((s) => s.id === id)?.status).toBe("completed");
    expect(f.d.acceptance?.review).toBe(
      f.run.steps.filter((s) => s.kind === "review").at(-1)?.id,
    );
  },
);
it("post-merge failure repairs in the same candidate and merges again only over this run's confirmed delivery", async () => {
  const f = fixture("post-repair");
  await f.execute();
  expect(f.events.filter((e) => e === "merge")).toHaveLength(2);
  expect(f.workspaces).toHaveLength(1);
  expect(f.d.binding.target.head).toBe("1".repeat(40));
  expect(f.d.integration.before).not.toBe(f.d.binding.target.head);
  expect(f.d.integration.after).toBe(f.d.acceptance?.candidate);
  expect(f.d.postChecks).toBe("passed");
  expect(
    f.run.steps.some(
      (s) =>
        s.kind === "check" &&
        ["failed", "partial", "blocked"].includes(s.status),
    ),
  ).toBe(true);
});
it("a no-change post-merge recovery revalidates acceptance without replaying the merge", async () => {
  const f = fixture("post-retry");
  await f.execute();
  expect(f.run.revision).toBe(1);
  expect(f.events.filter((e) => e === "merge")).toHaveLength(1);
  expect(f.counts().postChecks).toBe(2);
  expect(f.d.acceptance?.review).toBe(
    f.run.steps.filter((s) => s.kind === "review").at(-1)?.id,
  );
  expect(f.d.postChecks).toBe("passed");
});
it("a moved target retains the clean undelivered repair and the earlier actual merge without cleanup", async () => {
  const f = fixture("post-target-moved");
  await expect(f.execute()).rejects.toThrow("Target moved");
  expect(f.events.filter((e) => e === "merge")).toHaveLength(1);
  expect(f.run.mergedCommit).not.toBeNull();
  expect(f.run.mergedCommit).not.toBe(f.d.candidate);
  expect(f.cleanup).not.toHaveBeenCalled();
  expect(seam.trees.get(f.d.worktreeRoot)!.dirty.size).toBe(0);
});
it.each(["target-moved", "review-change", "cancel"])(
  "%s does not merge or clean",
  async (mode) => {
    const f = fixture(mode);
    await expect(f.execute()).rejects.toThrow();
    expect(f.events).not.toContain("merge");
    expect(f.cleanup).not.toHaveBeenCalled();
    expect(f.run.mergedCommit).toBeNull();
  },
);
it("a concrete post-merge blocker preserves the actual merge, failed checks and worktree", async () => {
  const f = fixture("post-blocked");
  await expect(f.execute()).rejects.toThrow("Delivery blocked");
  expect(f.run.mergedCommit).toBe(f.d.candidate);
  expect(f.d.postChecks).toBe("failed");
  expect(f.cleanup).not.toHaveBeenCalled();
});
it("unknown post-merge identity never fabricates completion or replays the merge", async () => {
  const f = fixture("unknown");
  await expect(f.execute()).rejects.toThrow("unknown");
  expect(f.run.mergedCommit).toBeNull();
  expect(f.d.integration.status).toBe("unknown");
  expect(f.events.filter((e) => e === "merge")).toHaveLength(1);
  expect(f.cleanup).not.toHaveBeenCalled();
});
it("Cancel during the noninterruptible merge keeps the actual commit but starts no later work", async () => {
  const f = fixture("cancel-in-merge");
  await expect(f.execute()).rejects.toThrow("canceled");
  expect(f.run.mergedCommit).toBe(f.d.candidate);
  expect(f.d.postChecks).toBe("not-run");
  expect(f.events).not.toContain("post-check");
  expect(f.cleanup).not.toHaveBeenCalled();
});
it("delivery read projections redact current secrets without rewriting retained evidence", () => {
  const f = fixture(),
    secret = "newly-known-private-literal";
  f.d.integration.reason = `Retained diagnostic ${secret}`;
  f.engine.o.secrets = () => [secret];
  const projected = f.engine.projectDelivery(f.run);
  expect(projected.delivery.integration.reason).toContain("[redacted]");
  expect(JSON.stringify(projected)).not.toContain(secret);
  expect(f.d.integration.reason).toContain(secret);
});
