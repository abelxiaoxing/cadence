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
import { stagedPlan as plan } from "./helpers/workflow-plan.ts";

const seam = vi.hoisted(() => ({
  trees: new Map<
    string,
    {
      head: string;
      branch: string;
      detached?: boolean;
      parent?: string;
      message?: string;
      files: Map<string, string>;
      dirty: Set<string>;
    }
  >(),
  refs: new Map<string, string>(),
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
  assertTargetPosition: async (
    cwd: string,
    expected: { head: string; branch: string },
  ) => {
    const tree = seam.trees.get(cwd)!;
    if (tree.head !== expected.head || tree.branch !== expected.branch)
      throw new Error("stale");
  },
  gitHead: async (cwd: string) => {
    if (seam.missing) throw new Error("unreadable");
    return seam.trees.get(cwd)!.head;
  },
  gitText: async (cwd: string, args: string[]) => {
    if (args[0] === "symbolic-ref") return seam.trees.get(cwd)!.branch;
    if (args[0] === "show" && args.includes("--format=%P"))
      return seam.trees.get(cwd)?.parent ?? "1".repeat(40);
    if (args[0] === "show" && args.includes("--format=%B"))
      return seam.trees.get(cwd)?.message ?? "";
    if (args[0] === "rev-parse" && args.includes("--verify")) {
      const ref = args.at(-1)!;
      if (seam.refs.has(ref)) return seam.refs.get(ref)!;
      return seam.trees.get(cwd)?.head ?? "1".repeat(40);
    }
    return "a".repeat(40);
  },
  gitRun: async (cwd: string, args: string[]) => {
    if (args[0] === "symbolic-ref" && args[1] === "-q")
      return { code: seam.trees.get(cwd)?.detached ? 1 : 0, stdout: "" };
    if (args[0] === "show-ref")
      return { code: seam.refs.has(args.at(-1)!) ? 0 : 1, stdout: "" };
    if (args[0] === "diff")
      return { code: seam.trees.get(cwd)!.dirty.size ? 1 : 0, stdout: "" };
    return { code: 0, stdout: "" };
  },
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
  committedPaths: async () => ["a.txt"],
  worktreeResidue: async () => [],
}));
afterEach(() => {
  vi.restoreAllMocks();
  seam.trees.clear();
  seam.refs.clear();
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
      policy: "task-branch-v2",
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
  if (mode === "target-skip")
    definition.checks = [
      { name: "unit", command: "bun test", tier: "fast", target: "run" },
      {
        name: "browser",
        command: "bun run e2e",
        tier: "heavy",
        target: "skip",
      },
    ];
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
  const delivery = new WorkflowDelivery(d, resources, () => {}, {
    recordCheckpoints: (entries) => {
      records.set(
        resolve("/controlled-records", "runs", id, "checkpoints.json"),
        {
          checkpoints: entries,
        },
      );
    },
  });
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
    knowledgeWrote: false,
    managed: undefined as boolean | undefined,
    lastReviewedCandidate: undefined as string | undefined,
    c0Checks: undefined as
      | {
          candidate: string;
          tree: string;
          source: string;
          revision: number;
          scope: string[];
          steps: unknown[];
          waived: Set<string>;
        }
      | undefined,
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
              : null,
          create: (path: string, body: string) => {
            records.set(path, body.startsWith("{") ? JSON.parse(body) : body);
          },
          replace: (path: string, _expected: unknown, body: string) => {
            records.set(path, body.startsWith("{") ? JSON.parse(body) : body);
          },
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
  });
  engine.run = async (
    _live: unknown,
    cwd: string,
    operation: { git?: string[]; check?: { name: string } },
  ) => {
    if (operation.check) {
      const post = cwd === root;
      if (post) postChecks++;
      else candidateChecks++;
      events.push(
        post
          ? `post-check:${operation.check.name}`
          : `check:${operation.check.name}`,
      );
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
      expect(args).toContain("--detach");
      const path = args[3];
      workspaces.push(path);
      events.push("create");
      seam.trees.set(path, {
        head: base,
        branch: "",
        detached: true,
        parent: base,
        files: new Map(seam.trees.get(root)!.files),
        dirty: new Set(),
      });
    } else if (args[0] === "update-ref") {
      if (args[1] === "-d") {
        seam.refs.delete(args[2]);
      } else if (args[1] === "--no-deref") {
        seam.refs.set(args[2], args[3]);
      } else {
        seam.refs.set(args[1], args[2]);
      }
    } else if (args[0] === "commit") {
      events.push("commit");
      const tree = seam.trees.get(cwd)!;
      tree.parent = tree.head;
      tree.head = oid();
      const msgIdx = args.indexOf("-m");
      tree.message = msgIdx >= 0 ? args[msgIdx + 1] : "";
      tree.dirty.clear();
    } else if (args[0] === "commit-tree") {
      events.push("seal");
      const sealed = oid();
      const parentIdx = args.indexOf("-p");
      const msgIdx = args.indexOf("-m");
      seam.trees.get(cwd)!.parent = args[parentIdx + 1];
      seam.trees.get(cwd)!.message = msgIdx >= 0 ? args[msgIdx + 1] : "";
      return { ...ok, output: `${sealed}\n` };
    } else if (args[0] === "reset" && args[1] === "--soft") {
      seam.trees.get(cwd)!.head = args[2];
    } else if (args[0] === "merge") {
      events.push("merge");
      if (args.includes("--no-ff")) {
        const tree = seam.trees.get(cwd)!;
        tree.parent = `${tree.head} ${args.at(-1)}`;
        tree.head = oid();
        tree.message = "Merge frontier";
      } else {
        expect(d.acceptance?.candidate).toBe(args.at(-1));
        const target = seam.trees.get(root)!,
          candidate = seam.trees.get(d.worktreeRoot)!;
        target.head = candidate.head;
        target.message = candidate.message;
        target.files = new Map(candidate.files);
        if (mode === "unknown") seam.missing = true;
        if (mode === "cancel-in-merge") live.abort.abort();
      }
    } else if (args[0] === "worktree" && args[1] === "remove")
      events.push("cleanup");
    else expect(args[0]).toBe("add");
    return { ...ok };
  };
  engine.worker = async (
    _live: unknown,
    cwd: string,
    name: string,
    _prompt: string,
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
      if (mode !== "zero-edit-learn" && mode !== "target-skip") {
        put(cwd, "knowledge.md", "Verified project fact with evidence");
        live.knowledgeWrote = true;
      }
      report = { status: "completed", summary: "Curated knowledge" };
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

it("V4 single-commit flow runs C0 behavior checks before learn(), seals C1 when knowledge changes, writes private reports only, and fast-forwards exact OID", async () => {
  const f = fixture();
  await f.execute();
  expect(f.workspaces).toEqual([f.d.worktreeRoot]);
  expect(f.d.taskBranch).toContain(f.run.id);
  // Stage 5 C0 check runs BEFORE Stage 6 knowledge curation!
  const firstCheck = f.events.findIndex((e) => e.startsWith("check:"));
  const knowledgeIdx = f.events.indexOf("knowledge");
  expect(firstCheck).toBeGreaterThan(-1);
  expect(firstCheck).toBeLessThan(knowledgeIdx);
  // Knowledge edited knowledge.md -> seals C1 and re-runs checks + review before merge!
  expect(f.counts().candidateChecks).toBe(2);
  expect(f.counts().reviews).toBe(1);
  expect(f.events.slice(-3)).toEqual([
    "merge",
    "post-check:outputs",
    "cleanup",
  ]);
  expect(f.d.acceptance?.candidate).toBe(f.run.mergedCommit);
  expect(f.d.postChecks).toBe("passed");
  expect(f.d.cleanup.status).toBe("removed");
  expect(seam.trees.get(f.d.worktreeRoot)!.files.get("knowledge.md")).toContain(
    "Verified",
  );
  // Private report written inside workflows-v1/runs/<id>/, NEVER in user repo!
  expect([...f.records.keys()].some((k) => k.endsWith("report.json"))).toBe(
    true,
  );
  expect(
    [...seam.trees.get(f.d.worktreeRoot)!.files.keys()].some((p) =>
      p.includes(".cadence/assistant/workflows"),
    ),
  ).toBe(false);
});

it("zero-edit shell-free learn() reuses exact C0 check evidence without re-running checks or creating a second delivery OID", async () => {
  const f = fixture("zero-edit-learn");
  await f.execute();
  // Stage 5 ran checks once on C0; Stage 6 zero-edit learn() reused C0 directly!
  expect(f.counts().candidateChecks).toBe(1);
  expect(f.counts().reviews).toBe(1);
  expect(f.events.filter((e) => e === "seal")).toHaveLength(1);
  expect(f.d.acceptance?.candidate).toBe(f.run.mergedCommit);
  expect(f.d.postChecks).toBe("passed");
});

it("target:skip omits heavy check in target checkout as not-run while running target:run checks and mandatory target/source verification", async () => {
  const f = fixture("target-skip");
  await f.execute();
  // Stage 4 pre-review ran fast unit; Stage 5 C0 ran unit + browser; Stage 7 target ran ONLY unit!
  expect(f.events).toContain("post-check:unit");
  expect(f.events).not.toContain("post-check:browser");
  expect(
    f.run.steps.some(
      (s) =>
        s.kind === "check" &&
        s.id.startsWith("browser-") &&
        s.status === "not-run",
    ),
  ).toBe(true);
  expect(f.d.postChecks).toBe("passed");
  expect(f.d.cleanup.status).toBe("removed");
});

it.each([false, true])(
  "reuses only an unchanged accepted verification in its original revision (revised=%s)",
  async (revised) => {
    const f = fixture();
    const verify = f.engine.verifyAndRepair.bind(f.engine);
    f.engine.verifyAndRepair = async (...args: unknown[]) => {
      await verify(...args);
      const exact = f.run.verification;
      if (revised) f.run.revision = (f.run.revision ?? 0) + 1;
      await verify(...args);
      expect(f.run.verification === exact).toBe(!revised);
    };
    await f.execute();
    expect(f.counts().reviews).toBe(revised ? 2 : 1);
    expect(f.counts().postChecks).toBe(1);
  },
);

it("isolated implementations overlap and optimistic Stage 5 runs without holding exclusive target lock", async () => {
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

it("guidance drift during final review refuses the target merge", async () => {
  const f = fixture();
  const learn = f.engine.learn.bind(f.engine);
  vi.spyOn(f.engine, "learn").mockImplementation(async (live, cwd, p) => {
    await learn(live, cwd, p);
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

it("post-merge failure repairs in the same candidate and merges a new commit on top of this run's confirmed delivery", async () => {
  const f = fixture("post-repair");
  await f.execute();
  expect(f.events.filter((e) => e === "merge")).toHaveLength(2);
  expect(f.workspaces).toHaveLength(1);
  expect(f.d.binding.target.head).toBe("1".repeat(40));
  expect(f.d.integration.before).not.toBe(f.d.binding.target.head);
  expect(f.d.integration.after).toBe(f.d.acceptance?.candidate);
  expect(f.d.postChecks).toBe("passed");
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
  expect(f.events.some((e) => e.startsWith("post-check:"))).toBe(false);
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

it("crash recovery settleInterrupted marks unknown and distinguishes confirmed checkpoints from unconfirmed private ref intents", () => {
  const f = fixture();
  const statePath = resolve(
    "/controlled-records",
    "runs",
    f.run.id,
    "state.json",
  );
  const cpPath = resolve(
    "/controlled-records",
    "runs",
    f.run.id,
    "checkpoints.json",
  );
  f.records.set(statePath, f.run);
  f.records.set(cpPath, {
    checkpoints: [
      {
        seq: 1,
        ref: `refs/cadence/runs/${f.run.id}/checkpoints/1`,
        oid: "2".repeat(40),
        kind: "dev",
        status: "confirmed",
      },
      {
        seq: 2,
        ref: `refs/cadence/runs/${f.run.id}/checkpoints/2`,
        oid: "3".repeat(40),
        kind: "delivery",
        status: "intent",
      },
    ],
  });
  f.engine.settleInterrupted(f.run.id);
  const settled = f.records.get(statePath) as WorkflowRun;
  expect(settled.status).toBe("unknown");
  expect(settled.notice).toContain("Confirmed checkpoints: 1");
  expect(settled.notice).toContain("Unconfirmed private ref intent(s)");
  expect(settled.notice).toContain(
    `refs/cadence/runs/${f.run.id}/checkpoints/2`,
  );
});

it("zero-edit learn() STILL reuses exact C0 check evidence when managed knowledge store (live.managed) is enabled", async () => {
  const f = fixture("zero-edit-learn");
  vi.spyOn(f.engine, "storeDeliverable").mockResolvedValue(true);
  await f.execute();
  expect(f.live.managed).toBe(true);
  // Even though scope expanded with KNOWLEDGE_SCOPE in learn(), zero-edit C0 reuse succeeds
  // and post-review/post-merge source identities match full current scope cleanly.
  expect(f.counts().candidateChecks).toBe(1);
  expect(f.counts().reviews).toBe(1);
  expect(f.events.filter((e) => e === "seal")).toHaveLength(1);
  expect(f.d.postChecks).toBe("passed");
});

it("Stage 4 pre-review checkpoint never leaks onto target branch; Stage 5 seals a real delivery commit with the goal message", async () => {
  const f = fixture("target-skip");
  await f.execute();
  expect(seam.trees.get(f.engine.cwd)?.message).toBe(
    `Cadence: ${f.live.proposal.plan.goal}`,
  );
  expect(seam.trees.get(f.engine.cwd)?.message).not.toContain("pre-review");
  const cpRecord = f.records.get(
    resolve("/controlled-records", "runs", f.run.id, "checkpoints.json"),
  ) as { checkpoints: { kind: string; oid: string; status: string }[] };
  expect(cpRecord.checkpoints).toContainEqual(
    expect.objectContaining({
      kind: "delivery",
      oid: f.run.mergedCommit,
      status: "deleted",
    }),
  );
});

it("boundedPrompt guarantees worker prompts stay within 32 KiB even with huge prefix, evidence and suffix", () => {
  const f = fixture();
  const prefix = `Header\n${"P".repeat(28000)}`;
  const evidence = `Evidence\n${"E".repeat(12000)}`;
  const suffix = `\nSuffix\n${"S".repeat(6000)}`;
  const result = f.engine.boundedPrompt(prefix, evidence, suffix);
  expect(Buffer.byteLength(result)).toBeLessThanOrEqual(32768);
  expect(f.engine.evidenceBudget(32000, 1000)).toBe(0);
});

it("incorporateFrontier clears stale lastReviewedCandidate and c0Checks so follow-up delta review never spans sibling commits", async () => {
  const f = fixture("zero-edit-learn");
  // Non-overlapping scope relative to mock committedPaths() -> ["a.txt"].
  f.live.proposal.plan.tasks[0].writes = ["b.txt"];
  const candidateCwd = f.d.worktreeRoot;
  seam.trees.set(candidateCwd, {
    head: "2".repeat(40),
    branch: "",
    detached: true,
    parent: "1".repeat(40),
    files: new Map([["b.txt", "mine"]]),
    dirty: new Set(),
  });
  f.d.workspace = { head: "2".repeat(40), state: "ready", mode: "detached" };
  f.live.lastReviewedCandidate = "2".repeat(40);
  f.live.c0Checks = {
    candidate: "2".repeat(40),
    tree: "a".repeat(40),
    source: "old-source",
    revision: 0,
    scope: ["b.txt"],
    steps: [],
    waived: new Set(),
  };
  const siblingOid = "9".repeat(40);
  seam.trees.get(f.engine.cwd)!.head = siblingOid;
  expect(f.live.delivery.advanceFrontier("1".repeat(40), siblingOid)).toBe(
    true,
  );
  const incorporated = await f.engine.incorporateFrontier(
    f.live,
    candidateCwd,
    f.live.proposal,
  );
  expect(incorporated).toBe(true);
  expect(f.live.lastReviewedCandidate).toBeUndefined();
  expect(f.live.c0Checks).toBeUndefined();
});

it("verifyAndRepair stops honestly on ReviewLedger exhaustedFamilies after 2 failed architectural replan routes without a 3rd replan", async () => {
  const f = fixture();
  let diagnoses = 0;
  let reviewRound = 0;
  const origWorker = f.engine.worker.bind(f.engine);
  f.engine.worker = async (
    live: unknown,
    cwd: string,
    name: string,
    prompt: string,
    readonly: boolean,
    version: unknown,
    roots: unknown,
    kind?: string,
  ) => {
    if (kind === "diagnosis") {
      diagnoses++;
      const step = f.engine.step(live, name, "diagnosis", randomUUID());
      const failed = [...f.run.steps]
        .reverse()
        .find((s) => ["failed", "rejected"].includes(s.status))!;
      const text = JSON.stringify({
        action: "continue",
        level: "replan",
        cause: `architectural replan ${diagnoses}`,
        evidence: [failed.id],
        strategy: `distinct route ${diagnoses}`,
        work: [
          {
            title: `replan-work-${diagnoses}`,
            instructions: "rewrite architecture",
            writes: ["a.txt"],
          },
        ],
      });
      const result = {
        outcome: "completed",
        closed: true,
        exitCode: 0,
        signal: null,
        durationMs: 0,
        text,
        output: "",
        truncated: false,
      };
      f.engine.finishStep(live, step, result);
      return { result, step, report: null };
    }
    if (kind === "review") {
      reviewRound++;
      const step = f.engine.step(live, name, "review", randomUUID());
      const text = JSON.stringify({
        approved: false,
        summary: `Still broken round ${reviewRound}`,
        blockingIssues: [
          {
            id: `bug-${reviewRound}`,
            source: "AC-1",
            family: reviewRound === 1 ? "new" : "F01",
            ...(reviewRound === 1 ? { familySummary: "Persistent bug" } : {}),
            evidence: `Fails on round ${reviewRound}`,
            verify: "Must pass AC-1",
            writes: ["a.txt"],
          },
        ],
      });
      const result = {
        outcome: "completed",
        closed: true,
        exitCode: 0,
        signal: null,
        durationMs: 0,
        text,
        output: "",
        truncated: false,
      };
      f.engine.finishStep(live, step, result);
      return { result, step, report: null };
    }
    return origWorker(live, cwd, name, prompt, readonly, version, roots, kind);
  };
  await expect(f.execute()).rejects.toThrow(
    /Review convergence exhausted after 2 architectural replan routes for F01/i,
  );
  // Exactly 2 architectural replan diagnoses ran; no 3rd replan was dispatched!
  expect(diagnoses).toBe(2);
  expect(f.events).not.toContain("merge");
  expect(f.cleanup).not.toHaveBeenCalled();
});

it("persist throws on journal write failure instead of silently mutating without intent", () => {
  const f = fixture();
  f.engine.write = () => {
    throw new Error("disk full");
  };
  expect(() =>
    f.engine.persist("/controlled-records/runs/x/checkpoints.json", {
      checkpoints: [],
    }),
  ).toThrow("disk full");
});

it("learn() recovery repairs preserve kind 'knowledge' (shell-free isolation)", async () => {
  const f = fixture("zero-edit-learn");
  const kinds: string[] = [];
  let knowledgeAttempts = 0;
  const origWorker = f.engine.worker.bind(f.engine);
  f.engine.worker = async (
    live: unknown,
    cwd: string,
    name: string,
    prompt: string,
    readonly: boolean,
    version: unknown,
    roots: unknown,
    kind?: string,
  ) => {
    if (name.startsWith("project-knowledge") || name.startsWith("repair-")) {
      kinds.push(`${name}:${kind}`);
      knowledgeAttempts++;
      if (knowledgeAttempts === 1) {
        const step = f.engine.step(
          live,
          name,
          kind ?? "knowledge",
          randomUUID(),
        );
        const report = { status: "blocked" as const, summary: "Need retry" };
        const result = {
          outcome: "completed",
          closed: true,
          exitCode: 0,
          signal: null,
          durationMs: 0,
          text: JSON.stringify(report),
          output: "",
          truncated: false,
        };
        f.engine.finishStep(live, step, result, undefined, report);
        return { result, step, report };
      }
    }
    return origWorker(live, cwd, name, prompt, readonly, version, roots, kind);
  };
  await f.execute();
  const repairEntries = kinds.filter((k) => k.startsWith("repair-"));
  expect(repairEntries.length).toBeGreaterThan(0);
  expect(repairEntries.every((k) => k.endsWith(":knowledge"))).toBe(true);
});
