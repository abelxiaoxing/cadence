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
import { HostCapacity } from "../src/service/host-capacity.ts";
import { MergeQueue, type QueueTurn } from "../src/service/merge-queue.ts";
import type { RepositoryCoordination } from "../src/service/repository-coordination.ts";
import {
  deliveryObservation,
  WorkflowDelivery,
} from "../src/service/workflow-delivery.ts";
import { Workflows } from "../src/service/workflows.ts";
import { stagedPlan as plan } from "./helpers/workflow-plan.ts";

const BRANCH = "refs/heads/main";
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
  /** Branches and private refs as Git has them: the target among them. */
  refs: new Map<string, string>(),
  /** The worktree that has the target checked out; null when none does. */
  holder: null as string | null,
  /** Why the target cannot take a landing just now. */
  busy: null as string | null,
  /** The target cannot be read back. */
  missing: false,
  /** What a replay leaves unmerged. */
  unmerged: [] as string[],
  /** Further paths a range between two commits changed. */
  changed: [] as string[],
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
  gitHead: async (cwd: string) => seam.trees.get(cwd)!.head,
  gitText: async (cwd: string, args: string[]) => {
    if (args[0] === "symbolic-ref") return seam.trees.get(cwd)!.branch;
    if (args[0] === "show" && args.includes("--format=%P"))
      return seam.trees.get(cwd)?.parent ?? "1".repeat(40);
    if (args[0] === "show" && args.includes("--format=%B"))
      return seam.trees.get(cwd)?.message ?? "";
    if (args[0] === "diff" && args.includes("--diff-filter=U"))
      return seam.unmerged.join("\0");
    if (args[0] === "diff") return "+ a changed rule\n";
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
    if (args[0] === "rev-parse") {
      const ref = args.at(-1)!.replace("^{commit}", "");
      return seam.refs.has(ref)
        ? { code: 0, stdout: `${seam.refs.get(ref)}\n` }
        : { code: 1, stdout: "" };
    }
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
  committedPaths: async () => ["a.txt", ...seam.changed],
  worktreeResidue: async () => [],
}));
vi.mock("../src/service/workflow-landing.ts", async (original) => ({
  ...(await original<object>()),
  observeTarget: async (_cwd: string, branch: string) => {
    if (seam.missing) throw new Error("unreadable");
    return {
      head: seam.refs.get(branch) ?? null,
      holder: seam.holder,
      busy: seam.busy,
    };
  },
  uncommitted: async (worktree: string) => [...seam.trees.get(worktree)!.dirty],
}));
afterEach(() => {
  vi.restoreAllMocks();
  seam.trees.clear();
  seam.refs.clear();
  seam.holder = null;
  seam.busy = null;
  seam.missing = false;
  seam.unmerged = [];
  seam.changed = [];
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
      policy: "task-branch-v3",
      target: {
        checkoutRoot: root,
        repository: resolve("/controlled-repository"),
        repositoryIdentity: "a".repeat(64),
        branch: BRANCH,
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
  // `target` is retained data from earlier agreements and decides nothing.
  if (mode === "tiers")
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
    delivered: new Set<string>(),
    notes: [] as string[],
    delivery,
    rules: undefined as
      | { from: string; to: string; paths: string[] }
      | undefined,
    barrier: undefined as CheckoutPermit | undefined,
    turn: undefined as QueueTurn | undefined,
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
    reviews = 0;
  const prompts: string[] = [];
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
  // The target branch at the baseline, checked out in the user's checkout.
  seam.trees.set(root, {
    head: base,
    branch: BRANCH,
    files: new Map([["a.txt", "before"]]),
    dirty: new Set(),
  });
  seam.refs.set(BRANCH, base);
  seam.holder = root;
  const put = (cwd: string, path: string, text: string) => {
    seam.trees.get(cwd)!.files.set(path, text);
    seam.trees.get(cwd)!.dirty.add(path);
  };
  const engine = Object.assign(Object.create(Workflows.prototype), {
    cwd: root,
    root: resolve("/controlled-records"),
    active: new Map([[run.id, live]]),
    hostCapacity: new HostCapacity(),
    queue: new MergeQueue(),
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
  engine.pause = async () => {
    events.push("wait");
    seam.busy = null;
  };
  engine.run = async (
    _live: unknown,
    cwd: string,
    operation: { git?: string[]; check?: { name: string } },
  ) => {
    if (operation.check) {
      // Nothing is ever checked in the user's checkout.
      expect(cwd).not.toBe(root);
      candidateChecks++;
      events.push(`check:${operation.check.name}`);
      const failed =
        (mode === "check-repair" && candidateChecks <= 3) ||
        (mode === "baseline-scope" && candidateChecks === 1);
      return {
        ...ok,
        outcome: failed ? "failed" : "completed",
        exitCode: failed ? 1 : 0,
      };
    }
    const args = operation.git!;
    const tree = seam.trees.get(cwd)!;
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
      if (args[1] === "-d") seam.refs.delete(args[2]);
      else if (args[1] === "--no-deref") seam.refs.set(args[2], args[3]);
      else {
        const [, ref, next, expected] = args;
        if (ref === BRANCH) {
          events.push("land:ref");
          // Somebody else's commit reaches the branch first.
          if (mode === "cas-lost" && !events.includes("lost")) {
            events.push("lost");
            seam.refs.set(BRANCH, "e".repeat(40));
          }
        }
        // Compare-and-swap: an all-zero expectation means "must not exist".
        const current = seam.refs.get(ref) ?? "0".repeat(40);
        if (expected !== undefined && current !== expected)
          return { ...ok, exitCode: 128, output: "cannot lock ref" };
        seam.refs.set(ref, next);
        if (ref === BRANCH && mode === "unknown") seam.missing = true;
      }
    } else if (args[0] === "commit") {
      events.push("commit");
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
      tree.parent = args[parentIdx + 1];
      tree.message = msgIdx >= 0 ? args[msgIdx + 1] : "";
      return { ...ok, output: `${sealed}\n` };
    } else if (args[0] === "reset" && args[1] === "--soft") {
      tree.head = args[2];
    } else if (args[0] === "checkout") {
      // The candidate moves onto the branch's head, or back off it.
      events.push(args.includes("--force") ? "restore" : "onto");
      tree.head = args.at(-1)!;
      tree.dirty.clear();
    } else if (args[0] === "cherry-pick") {
      events.push("replay");
      if (seam.unmerged.length) return { ...ok, exitCode: 1 };
      // The candidate's change, staged on the branch's head.
      tree.dirty.add("a.txt");
    } else if (args[0] === "merge") {
      expect(args).toContain("--ff-only");
      expect(cwd).toBe(seam.holder);
      expect(d.acceptance?.candidate).toBe(args.at(-1));
      events.push("land:ff");
      if (tree.dirty.has("blocked.txt"))
        return { ...ok, exitCode: 1, output: "would be overwritten" };
      const candidate = seam.trees.get(d.worktreeRoot)!;
      tree.head = candidate.head;
      tree.message = candidate.message;
      tree.files = new Map(candidate.files);
      seam.refs.set(BRANCH, candidate.head);
      if (mode === "unknown") seam.missing = true;
      if (mode === "cancel-in-landing") live.abort.abort();
    } else if (args[0] === "read-tree") events.push("follow");
    else if (args[0] === "worktree" && args[1] === "remove")
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
    prompts.push(prompt);
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
      text = JSON.stringify({
        action: "continue",
        cause: "controlled observed failure",
        ...(mode === "baseline-scope" ? { scope: ["test/fixture.ts"] } : {}),
        evidence: [failed.id],
        strategy: `Continue from preserved evidence, revision ${(run.revision ?? 0) + 1}`,
        work:
          mode === "partial" || mode === "unparseable"
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
    } else if (kind === "knowledge") {
      events.push("knowledge");
      if (mode !== "zero-edit-learn" && mode !== "tiers") {
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
      // The branch moves while the candidate is being reviewed.
      if (mode === "moved" && reviews === 1)
        seam.refs.set(BRANCH, "f".repeat(40));
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
    prompts,
    root,
    base,
    /** An isolated delivery holds no checkout to start. */
    execute: async () => {
      try {
        return await engine.implement(live, p);
      } finally {
        live.barrier?.release();
        live.turn?.release();
      }
    },
    counts: () => ({ implementations, candidateChecks, reviews }),
  };
}

it("the single-commit flow runs C0 behavior checks before learn(), seals C1 when knowledge changes, writes private reports only, and moves the branch to the exact accepted OID", async () => {
  const f = fixture();
  await f.execute();
  expect(f.workspaces).toEqual([f.d.worktreeRoot]);
  expect(f.d.taskBranch).toContain(f.run.id);
  // Stage 5 C0 check runs BEFORE Stage 6 knowledge curation!
  const firstCheck = f.events.findIndex((e) => e.startsWith("check:"));
  const knowledgeIdx = f.events.indexOf("knowledge");
  expect(firstCheck).toBeGreaterThan(-1);
  expect(firstCheck).toBeLessThan(knowledgeIdx);
  // Knowledge edited knowledge.md -> seals C1 and re-runs checks + review before landing.
  expect(f.counts().candidateChecks).toBe(2);
  expect(f.counts().reviews).toBe(1);
  // The landing is the last thing but the cleanup: nothing is checked after it.
  expect(f.events.slice(-2)).toEqual(["land:ff", "cleanup"]);
  expect(f.d.acceptance?.candidate).toBe(f.run.mergedCommit);
  expect(seam.refs.get(BRANCH)).toBe(f.run.mergedCommit);
  expect(seam.refs.get(f.d.taskBranch)).toBe(f.run.mergedCommit);
  expect(f.d.integration).toMatchObject({
    status: "applied",
    before: f.base,
    after: f.run.mergedCommit,
    sync: { mode: "fast-forward", worktree: f.root },
  });
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
  // The landing left a confirmed record of exactly what it moved.
  expect(
    f.records.get(
      resolve("/controlled-records", "runs", f.run.id, "landing.json"),
    ),
  ).toEqual({
    branch: BRANCH,
    before: f.base,
    after: f.run.mergedCommit,
    worktree: f.root,
    status: "confirmed",
  });
});

it("zero-edit shell-free learn() reuses exact C0 check evidence without re-running checks or creating a second delivery OID", async () => {
  const f = fixture("zero-edit-learn");
  await f.execute();
  // Stage 5 ran checks once on C0; Stage 6 zero-edit learn() reused C0 directly!
  expect(f.counts().candidateChecks).toBe(1);
  expect(f.counts().reviews).toBe(1);
  expect(f.events.filter((e) => e === "seal")).toHaveLength(1);
  expect(f.d.acceptance?.candidate).toBe(f.run.mergedCommit);
  expect(f.events.filter((e) => e.startsWith("land"))).toEqual(["land:ff"]);
});

it("every declared check runs on the candidate, fast before heavy, and none in the user's checkout; a retained target choice decides nothing", async () => {
  const f = fixture("tiers");
  await f.execute();
  // Stage 4 pre-review ran fast unit; Stage 5 C0 ran unit then browser.
  expect(f.events.filter((e) => e.startsWith("check:"))).toEqual([
    "check:unit",
    "check:unit",
    "check:browser",
  ]);
  expect(f.run.steps.some((s) => s.status === "not-run")).toBe(false);
  expect(f.d.integration.status).toBe("applied");
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
  },
);

it("isolated implementations overlap and optimistic Stage 5 runs while holding neither the checkout nor a landing turn", async () => {
  const first = fixture();
  const second = fixture();
  const gate = first.engine.o.gate;
  second.engine.o.gate = gate;
  second.engine.queue = first.engine.queue;
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
    expect(first.engine.queue.busy).toBe(false);
    b = expect(second.execute()).rejects.toThrow("second assignment settled");
    await enteredSecond.promise;
    expect(first.events.some((e) => e.startsWith("land"))).toBe(false);
    finishFirst.resolve();
    await a;
    expect(first.d.integration.status).toBe("applied");
    expect(second.d.integration.status).toBe("pending");
    // Nothing told the second run: the branch itself says where it is now.
    expect(seam.refs.get(BRANCH)).toBe(first.run.mergedCommit);
    expect(await second.engine.targetHead(second.live)).toBe(
      first.run.mergedCommit,
    );
  } finally {
    finishFirst.resolve();
    finishSecond.resolve();
    await Promise.allSettled([a, ...(b ? [b] : [])]);
  }
  gate.assertQuiescent();
  expect(first.engine.queue.busy).toBe(false);
});

it("canceling a run that waits for the checkout leaves its holder intact", async () => {
  const f = fixture();
  const gate = f.engine.o.gate;
  const holder = await gate.acquire(
    f.engine.cwd,
    randomUUID(),
    new AbortController().signal,
  );
  const waiting = expect(f.engine.checkoutAccess(f.live, true)).rejects.toThrow(
    "stale",
  );
  f.live.abort.abort();
  await waiting;
  expect(f.live.barrier).toBeUndefined();
  holder.assertHeld();
  expect(() => gate.assertQuiescent()).toThrow("conflict");
  holder.release();
  gate.assertQuiescent();
});

it("deliveries to one branch land in arrival order; canceling a waiting one leaves the holder's turn intact", async () => {
  const first = fixture();
  const second = fixture();
  const third = fixture();
  second.engine.queue = third.engine.queue = first.engine.queue;
  await first.engine.landingTurn(first.live);
  const order: string[] = [];
  const b = second.engine.landingTurn(second.live).then(() => order.push("b"));
  const c = expect(third.engine.landingTurn(third.live)).rejects.toThrow(
    "stale",
  );
  expect(second.run.notice).toContain("1 delivery ahead");
  expect(third.run.notice).toContain("2 deliveries ahead");
  third.live.abort.abort();
  await c;
  expect(order).toEqual([]);
  expect(third.live.turn).toBeUndefined();
  first.live.turn?.release();
  await b;
  expect(order).toEqual(["b"]);
  second.live.turn?.release();
  expect(first.engine.queue.busy).toBe(false);
});

it("a branch that moved is taken in by replaying the sealed commit onto it, and that exact commit is verified again before it lands", async () => {
  const f = fixture("moved");
  await f.execute();
  const frontier = "f".repeat(40);
  // Verified on the old head; the landing saw the new one and replayed.
  expect(f.events).toContain("onto");
  expect(f.events).toContain("replay");
  expect(f.events.indexOf("replay")).toBeLessThan(f.events.indexOf("land:ff"));
  expect(f.counts().reviews).toBe(2);
  expect(seam.trees.get(f.d.worktreeRoot)!.parent).toBe(frontier);
  expect(f.d.integration).toMatchObject({
    status: "applied",
    before: frontier,
    after: f.run.mergedCommit,
  });
  expect(seam.refs.get(BRANCH)).toBe(f.run.mergedCommit);
  // Evidence taken on the old head was not reused for the new commit.
  expect(f.d.acceptance?.candidate).toBe(f.run.mergedCommit);
  expect(f.live.rules).toBeUndefined();
});

it("rule files the branch changed are put before the review instead of refusing the delivery", async () => {
  const f = fixture("moved");
  seam.changed = ["AGENTS.md", "docs/AGENTS.md", "src/AGENTS.md.bak"];
  await f.execute();
  expect(f.live.rules).toEqual({
    from: f.base,
    to: "f".repeat(40),
    paths: ["AGENTS.md", "docs/AGENTS.md"],
  });
  const review = f.prompts.filter((p) => p.startsWith("Independently inspect"));
  expect(review).toHaveLength(2);
  // Only the review after the branch moved is told, with what changed.
  expect(review[0]).not.toContain("Project rules changed");
  expect(review[1]).toContain(
    "Project rules changed on the target branch while this work ran: AGENTS.md, docs/AGENTS.md.",
  );
  expect(review[1]).toContain("+ a changed rule");
  expect(f.d.integration.status).toBe("applied");
});

it("a replay Git cannot merge retains the candidate exactly as it was verified", async () => {
  const f = fixture("moved");
  seam.unmerged = ["a.txt"];
  await expect(f.execute()).rejects.toMatchObject({
    code: "conflict",
    detail: expect.stringContaining("changed the same lines"),
  });
  expect(f.events.filter((e) => e.startsWith("land"))).toEqual([]);
  expect(f.events.at(-1)).toBe("restore");
  // Back on the sealed commit, on the base it had.
  expect(seam.trees.get(f.d.worktreeRoot)!.head).toBe(f.d.candidate);
  expect(f.live.delivery.candidateBase()).toBe(f.base);
  expect(seam.refs.get(BRANCH)).toBe("f".repeat(40));
  expect(f.run.mergedCommit).toBeNull();
  expect(f.cleanup).not.toHaveBeenCalled();
});

it("a branch nobody has checked out moves by reference alone; no checkout is touched", async () => {
  const f = fixture("zero-edit-learn");
  seam.holder = null;
  await f.execute();
  expect(f.events.filter((e) => e.startsWith("land"))).toEqual(["land:ref"]);
  expect(f.d.integration.sync).toEqual({ mode: "ref", worktree: null });
  expect(seam.refs.get(BRANCH)).toBe(f.run.mergedCommit);
  // The user's checkout is on something else and stays exactly as it was.
  expect(seam.trees.get(f.root)).toMatchObject({ head: f.base });
  expect(seam.trees.get(f.root)!.files.get("a.txt")).toBe("before");
  expect(f.d.cleanup.status).toBe("removed");
});

it("a compare-and-swap that loses to another writer takes the new head in and lands on it", async () => {
  const f = fixture("cas-lost");
  seam.holder = null;
  await f.execute();
  expect(f.events.filter((e) => e.startsWith("land"))).toEqual([
    "land:ref",
    "land:ref",
  ]);
  // The first attempt changed nothing; the second landed on the other commit.
  expect(f.events).toContain("replay");
  expect(f.d.integration).toMatchObject({
    status: "applied",
    before: "e".repeat(40),
  });
  expect(seam.refs.get(BRANCH)).toBe(f.run.mergedCommit);
});

it("uncommitted changes to other files do not stop a fast-forward; changes to the same files retain the candidate", async () => {
  const other = fixture("zero-edit-learn");
  seam.trees.get(other.root)!.dirty.add("notes.txt");
  await other.execute();
  expect(other.d.integration.status).toBe("applied");

  const same = fixture("zero-edit-learn");
  seam.trees.get(same.root)!.dirty.add("a.txt");
  await expect(same.execute()).rejects.toMatchObject({
    code: "conflict",
    detail: expect.stringContaining("uncommitted changes to files"),
  });
  expect(same.events.some((e) => e.startsWith("land"))).toBe(false);
  expect(same.d.integration).toMatchObject({
    status: "blocked",
    reason: expect.stringContaining("a.txt"),
  });
  expect(seam.refs.get(BRANCH)).toBe(same.base);
  // The task branch was not advanced for a landing that did not happen.
  expect(seam.refs.get(same.d.taskBranch)).toBe(same.base);
  expect(same.cleanup).not.toHaveBeenCalled();
});

it("a branch that cannot take a landing just now is waited for, without holding its turn, and then landed", async () => {
  const f = fixture("zero-edit-learn");
  seam.busy = `${BRANCH} is being rebased in ${f.root}`;
  const pause = f.engine.pause;
  let turnWhileWaiting: unknown = "unset";
  f.engine.pause = async (...args: unknown[]) => {
    turnWhileWaiting = f.live.turn;
    expect(f.run.notice).toContain("is being rebased");
    expect(f.run.phase).toBe("integrating");
    await pause(...args);
  };
  await f.execute();
  expect(turnWhileWaiting).toBeUndefined();
  expect(f.events.indexOf("wait")).toBeLessThan(f.events.indexOf("land:ff"));
  expect(f.events.filter((e) => e === "land:ff")).toHaveLength(1);
  expect(f.d.integration.status).toBe("applied");
});

it("a deleted branch is never recreated: the candidate is retained", async () => {
  const f = fixture("zero-edit-learn");
  const learn = f.engine.learn.bind(f.engine);
  vi.spyOn(f.engine, "learn").mockImplementation(async (live, cwd, p) => {
    await learn(live, cwd, p);
    seam.refs.delete(BRANCH);
  });
  await expect(f.execute()).rejects.toMatchObject({
    code: "stale",
    detail: expect.stringContaining("no longer exists"),
  });
  expect(seam.refs.has(BRANCH)).toBe(false);
  expect(f.run.mergedCommit).toBeNull();
  expect(f.cleanup).not.toHaveBeenCalled();
});

it("a fast-forward Git refuses leaves the branch where it was and reports nothing as merged", async () => {
  const f = fixture("zero-edit-learn");
  // Something a path comparison did not catch (Git still refuses it).
  seam.trees.get(f.root)!.dirty.add("blocked.txt");
  await expect(f.execute()).rejects.toThrow();
  expect(seam.refs.get(BRANCH)).toBe(f.base);
  expect(f.run.mergedCommit).toBeNull();
  expect(f.d.integration).toMatchObject({
    status: "blocked",
    after: null,
    // Git's own words say why.
    reason: expect.stringContaining("would be overwritten"),
  });
  expect(f.cleanup).not.toHaveBeenCalled();
});

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
    expect(f.events.filter((e) => e.startsWith("land"))).toHaveLength(1);
    for (const id of f.d.acceptance!.checks)
      expect(f.run.steps.find((s) => s.id === id)?.status).toBe("completed");
    expect(f.d.acceptance?.review).toBe(
      f.run.steps.filter((s) => s.kind === "review").at(-1)?.id,
    );
  },
);

it.each(["review-change", "cancel"])(
  "%s does not land or clean",
  async (mode) => {
    const f = fixture(mode);
    await expect(f.execute()).rejects.toThrow();
    expect(f.events.some((e) => e.startsWith("land"))).toBe(false);
    expect(f.cleanup).not.toHaveBeenCalled();
    expect(f.run.mergedCommit).toBeNull();
    expect(seam.refs.get(BRANCH)).toBe(f.base);
  },
);

it("a branch that cannot be read back after it was moved is never reported as landed and never moved again", async () => {
  const f = fixture("unknown");
  await expect(f.execute()).rejects.toThrow("unknown");
  expect(f.run.mergedCommit).toBeNull();
  expect(f.d.integration.status).toBe("unknown");
  expect(f.events.filter((e) => e.startsWith("land"))).toHaveLength(1);
  expect(f.cleanup).not.toHaveBeenCalled();
  // The intent is all a restart will know: the branch may have moved.
  expect(
    f.records.get(
      resolve("/controlled-records", "runs", f.run.id, "landing.json"),
    ),
  ).toMatchObject({ status: "intent", branch: BRANCH, before: f.base });
});

it("Cancel during the noninterruptible landing keeps the actual commit but starts no later work", async () => {
  const f = fixture("cancel-in-landing");
  await expect(f.execute()).rejects.toThrow("canceled");
  expect(f.run.mergedCommit).toBe(f.d.candidate);
  expect(seam.refs.get(BRANCH)).toBe(f.d.candidate);
  expect(f.d.integration.status).toBe("applied");
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

it("crash recovery settleInterrupted marks unknown, distinguishes confirmed checkpoints from unconfirmed ref intents and says when a landing had started", () => {
  const f = fixture();
  const at = (name: string) =>
    resolve("/controlled-records", "runs", f.run.id, name);
  f.records.set(at("state.json"), f.run);
  f.records.set(at("checkpoints.json"), {
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
  const settled = f.records.get(at("state.json")) as WorkflowRun;
  expect(settled.status).toBe("unknown");
  expect(settled.notice).toContain("Confirmed checkpoints: 1");
  expect(settled.notice).toContain("Unconfirmed private ref intent(s)");
  expect(settled.notice).toContain(
    `refs/cadence/runs/${f.run.id}/checkpoints/2`,
  );
  // A run that was only waiting its turn had moved nothing.
  expect(settled.notice).not.toContain("A landing had started");

  const g = fixture();
  const of = (name: string) =>
    resolve("/controlled-records", "runs", g.run.id, name);
  g.run.phase = "integrating";
  g.records.set(of("state.json"), g.run);
  g.records.set(of("landing.json"), {
    branch: BRANCH,
    before: "1".repeat(40),
    after: "4".repeat(40),
    worktree: null,
    status: "intent",
  });
  g.engine.settleInterrupted(g.run.id);
  expect((g.records.get(of("state.json")) as WorkflowRun).notice).toContain(
    `A landing had started: ${BRANCH} may already be at 444444444444 (it was at 111111111111).`,
  );
});

it("zero-edit learn() STILL reuses exact C0 check evidence when managed knowledge store (live.managed) is enabled", async () => {
  const f = fixture("zero-edit-learn");
  vi.spyOn(f.engine, "storeDeliverable").mockResolvedValue(true);
  await f.execute();
  expect(f.live.managed).toBe(true);
  // Even though scope expanded with KNOWLEDGE_SCOPE in learn(), zero-edit C0
  // reuse succeeds and the review's source identity matches the full scope.
  expect(f.counts().candidateChecks).toBe(1);
  expect(f.counts().reviews).toBe(1);
  expect(f.events.filter((e) => e === "seal")).toHaveLength(1);
  expect(f.d.integration.status).toBe("applied");
});

it("Stage 4 pre-review checkpoint never leaks onto target branch; Stage 5 seals a real delivery commit with the goal message", async () => {
  const f = fixture("tiers");
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

it("a replay clears the review's delta base and the C0 evidence, so neither spans the commits the branch gained", async () => {
  const f = fixture("zero-edit-learn");
  const candidateCwd = f.d.worktreeRoot;
  const sealed = "2".repeat(40);
  seam.trees.set(candidateCwd, {
    head: sealed,
    branch: "",
    detached: true,
    parent: f.base,
    message: `Cadence: ${f.live.proposal.plan.goal}`,
    files: new Map([["a.txt", "mine"]]),
    dirty: new Set(),
  });
  f.d.workspace = { head: sealed, state: "ready", mode: "detached" };
  f.d.candidate = sealed;
  seam.refs.set(`refs/cadence/runs/${f.run.id}/checkpoints/1`, sealed);
  await f.live.delivery.pinCheckpoint(sealed, "delivery", async () => ({}));
  f.live.lastReviewedCandidate = sealed;
  f.live.c0Checks = {
    candidate: sealed,
    tree: "a".repeat(40),
    source: "old-source",
    revision: 0,
    scope: ["a.txt"],
    steps: [],
    waived: new Set(),
  };
  const frontier = "9".repeat(40);
  seam.refs.set(BRANCH, frontier);
  const head = await f.engine.sealCandidate(
    f.live,
    candidateCwd,
    f.live.proposal,
    ["a.txt"],
  );
  expect(head).not.toBe(sealed);
  expect(f.d.candidate).toBe(head);
  expect(f.live.delivery.candidateBase()).toBe(frontier);
  expect(f.live.lastReviewedCandidate).toBeUndefined();
  expect(f.live.c0Checks).toBeUndefined();
  // Sealed once already: the same commit is not sealed a second time.
  expect(f.events).toEqual(["onto", "replay", "commit"]);
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
  expect(f.events.some((e) => e.startsWith("land"))).toBe(false);
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
