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
import {
  LandingLog,
  laneKey,
  MergeQueue,
  type QueueTurn,
} from "../src/service/merge-queue.ts";
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
  /** What a replay leaves unmerged: both sides changed these files. */
  unmerged: [] as string[],
  /** The lines Git marked in a file it wrote both versions into. */
  marked: new Map<string, string>(),
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
    if (args[0] === "ls-files" && args.includes("--unmerged"))
      return seam.unmerged
        .flatMap((path) =>
          [1, 2, 3].map(
            (stage) => `100644 ${"c".repeat(40)} ${stage}\t${path}`,
          ),
        )
        .join("\0");
    if (args[0] === "log") return "abc1234 what the branch gained\n";
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
    // Asked of the objects: this one goes onto the other without a conflict.
    if (args[0] === "merge-tree")
      return { code: 0, stdout: `${"a".repeat(40)}\0` };
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
  seam.marked.clear();
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
          expected: number;
          waived: Set<string>;
        }
      | undefined,
    merging: undefined as
      | { sealed: string; frontier: string; discard?: boolean }
      | undefined,
    accepted: undefined as { candidate: string } | undefined,
    landed: 0,
  };
  let serial = 2,
    implementations = 0,
    candidateChecks = 0,
    reviews = 0,
    reconciles = 0;
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
    landings: new LandingLog(),
    // What Git wrote into a conflicting file, as the seam says it did.
    conflictText: (_cwd: string, path: string) => seam.marked.get(path) ?? "",
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
      // The candidate moves onto the branch's head; forced, an unfinished
      // merge there is given up.
      events.push(args.includes("--force") ? "discard" : "onto");
      tree.head = args.at(-1)!;
      tree.dirty.clear();
      if (args.includes("--force")) {
        seam.unmerged = [];
        seam.marked.clear();
      }
    } else if (args[0] === "cherry-pick") {
      events.push("replay");
      // The candidate's change, staged on the branch's head.
      tree.dirty.add("a.txt");
      if (mode.startsWith("conflict")) {
        seam.unmerged = ["a.txt"];
        seam.marked.set(
          "a.txt",
          "<<<<<<< HEAD\nthe branch's line\n||||||| parent of 1234567 (sources)\nthe old line\n=======\nthis delivery's line\n>>>>>>> 1234567 (sources)\n",
        );
        return { ...ok, exitCode: 1, output: "CONFLICT (content): a.txt" };
      }
    } else if (args[0] === "add" && args[1] === "-A") {
      events.push("stage");
      seam.unmerged = [];
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
        action: mode === "conflict-stuck" ? "blocked" : "continue",
        ...(mode === "conflict-stuck" ? { blocker: "tool" } : {}),
        ...(mode === "conflict-replan" ? { level: "replan" } : {}),
        cause: "controlled observed failure",
        ...(mode === "baseline-scope" ? { scope: ["test/fixture.ts"] } : {}),
        evidence: [failed.id],
        strategy: `Continue from preserved evidence, revision ${(run.revision ?? 0) + 1}`,
        work:
          mode === "partial" ||
          mode === "unparseable" ||
          mode === "conflict-stuck"
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
      if ((mode === "moved" || mode.startsWith("conflict")) && reviews === 1)
        seam.refs.set(BRANCH, "f".repeat(40));
      if (mode === "review-change")
        put(cwd, "a.txt", "foreign edit during review");
      if (mode === "cancel") live.abort.abort();
    } else if (seam.marked.size && name.startsWith("repair-")) {
      events.push("reconcile");
      // Only the worker that is told what both sides did takes the marks out.
      if (mode === "conflict" || reconciles++ > 0) seam.marked.clear();
      put(cwd, "a.txt", "what both sides changed");
      report = { status: "completed", summary: "Reconciled both versions" };
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
      if (implementations > 1 && !mode.startsWith("conflict"))
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
    expect(await second.engine.branchHead(second.live)).toBe(
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

it("lines Git cannot merge go to a worker without a diagnosis; what it reconciled is staged, verified again and landed", async () => {
  const f = fixture("conflict");
  await f.execute();
  const at = (event: string) => f.events.lastIndexOf(event);
  // Replayed, reconciled, staged, sealed on the branch's head, then landed.
  expect(at("replay")).toBeLessThan(at("reconcile"));
  expect(at("reconcile")).toBeLessThan(at("stage"));
  expect(at("stage")).toBeLessThan(at("seal"));
  expect(at("seal")).toBeLessThan(at("land:ff"));
  expect(f.events).not.toContain("diagnosis");
  expect(f.events).not.toContain("discard");
  // The worker is told which files, what each side is, and what the branch gained.
  const brief = f.prompts.find((p) =>
    p.startsWith("Reconcile merge conflicts"),
  );
  expect(brief).toContain("could not merge these files: a.txt");
  expect(brief).toContain("what BOTH sides changed it to do");
  expect(brief).toContain("abc1234 what the branch gained");
  expect(brief).toContain("Write only: a.txt");
  // Recorded as a plan revision of its own, at the least level.
  expect(f.run.revision).toBe(1);
  expect(f.run.steps.some((s) => s.id.startsWith("merge-conflicts-"))).toBe(
    true,
  );
  // The review of the merged commit is pointed at what was done by hand.
  const review = f.prompts.filter((p) => p.startsWith("Independently inspect"));
  expect(review.at(-1)).toContain(`${BRANCH} moved while this delivery worked`);
  expect(review.at(-1)).toContain(
    "Git could not merge a.txt; a worker reconciled them by hand.",
  );
  expect(review.at(-1)).toContain('scope:"frontier"');
  expect(f.live.merging).toBeUndefined();
  expect(seam.trees.get(f.d.worktreeRoot)!.parent).toBe("f".repeat(40));
  expect(f.d.integration).toMatchObject({
    status: "applied",
    before: "f".repeat(40),
    after: f.run.mergedCommit,
  });
});

it("a marked line left behind is not a reconciled file: recovery is asked, and its repair works on the same merge", async () => {
  const f = fixture("conflict-left");
  await f.execute();
  expect(f.events.filter((e) => e === "reconcile")).toHaveLength(2);
  expect(f.events.filter((e) => e === "diagnosis")).toHaveLength(1);
  // Nothing was staged while a marked line was still there.
  expect(f.events.indexOf("stage")).toBeGreaterThan(
    f.events.lastIndexOf("reconcile"),
  );
  expect(f.events).not.toContain("discard");
  const diagnosis = f.prompts.find((p) => p.includes("Stage failure:"));
  expect(diagnosis).toContain(
    "Lines Git marked as conflicting are still in: a.txt.",
  );
  // Whoever decides is told what each level does to the unfinished merge.
  expect(diagnosis).toContain(
    'Level "replan" or "deviate" gives this merge up',
  );
  expect(f.d.integration.status).toBe("applied");
});

it("a replan gives the unfinished merge up and does the work again on the branch's head", async () => {
  const f = fixture("conflict-replan");
  await f.execute();
  const at = (event: string) => f.events.lastIndexOf(event);
  // The merge was discarded before the replanned work started.
  expect(at("diagnosis")).toBeLessThan(at("discard"));
  expect(at("discard")).toBeLessThan(at("implementation"));
  expect(f.events).not.toContain("stage");
  expect(f.live.merging).toBeUndefined();
  expect(f.live.notes.join("\n")).toContain(
    "was not reconciled; the work was done again on the branch's head",
  );
  expect(seam.trees.get(f.d.worktreeRoot)!.parent).toBe("f".repeat(40));
  expect(f.d.integration.status).toBe("applied");
});

it("when nothing that merges can be verified, the last accepted candidate is delivered on the task branch and the run completes", async () => {
  const f = fixture("conflict-stuck");
  await f.execute();
  const accepted = f.live.accepted?.candidate;
  expect(accepted).toBeTruthy();
  // The target branch is where its own history left it.
  expect(seam.refs.get(BRANCH)).toBe("f".repeat(40));
  expect(f.events.filter((e) => e.startsWith("land"))).toEqual([]);
  expect(f.run.mergedCommit).toBeNull();
  expect(seam.refs.get(f.d.taskBranch)).toBe(accepted);
  expect(f.d.candidate).toBe(accepted);
  expect(f.d.acceptance?.candidate).toBe(accepted);
  expect(f.d.integration).toMatchObject({
    status: "branch",
    after: null,
    reason: expect.stringMatching(
      /^Completed, not merged into main: Delivery blocked \(tool\)/u,
    ),
  });
  expect(f.d.integration.reason).toContain(
    `The verified result is commit ${accepted} on ${f.d.taskBranch.replace("refs/heads/", "")}; to merge it yourself: git merge cadence/`,
  );
  // The worktree, with the unfinished merge in it, is kept.
  expect(f.cleanup).not.toHaveBeenCalled();
  expect(f.d.cleanup.status).toBe("retained");
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

it("uncommitted changes to other files do not stop a fast-forward; changes to the same files are carried over, with a worker asked in between where text has to be reconciled", async () => {
  const other = fixture("zero-edit-learn");
  seam.trees.get(other.root)!.dirty.add("notes.txt");
  await other.execute();
  expect(other.d.integration.status).toBe("applied");

  const same = fixture("zero-edit-learn");
  seam.trees.get(same.root)!.dirty.add("a.txt");
  const attempts: [string[], string | undefined][] = [];
  const during: unknown[] = [];
  // The mechanics against a real checkout are in merge-queue-delivery.test.ts.
  same.engine.carryOver = async (
    _live: unknown,
    _p: unknown,
    candidate: string,
    landing: { worktree: string; paths: string[] },
    changed: string[],
    _hidden: unknown,
    reconciled?: { key: string },
  ) => {
    attempts.push([landing.paths, reconciled?.key]);
    // Text both changed: asked for first, then stale once, then used.
    if (!reconciled || attempts.length === 2)
      return {
        kind: "reconcile",
        request: {
          key: `state-${attempts.length}`,
          worktree: landing.worktree,
          wip: "w".repeat(40),
          candidate,
          paths: landing.paths,
        },
      };
    return {
      kind: await same.engine.move(
        same.live,
        candidate,
        same.base,
        { kind: "fast-forward", worktree: landing.worktree },
        changed,
      ),
    };
  };
  same.engine.reconcileUncommitted = async (
    _live: unknown,
    _p: unknown,
    request: { key: string },
  ) => {
    // The branch is kept still while the worker works.
    during.push(same.live.turn);
    return { key: request.key, files: new Map() };
  };
  await same.execute();
  expect(attempts).toEqual([
    [["a.txt"], undefined],
    // The state had changed by the time the worker was done: waited, redone.
    [["a.txt"], "state-1"],
    [["a.txt"], undefined],
    [["a.txt"], "state-3"],
  ]);
  expect(during).toHaveLength(2);
  expect(during.every(Boolean)).toBe(true);
  expect(same.events.filter((e) => e === "wait")).toHaveLength(1);
  expect(same.events.filter((e) => e === "land:ff")).toHaveLength(1);
  expect(same.d.integration.status).toBe("applied");
  expect(seam.refs.get(BRANCH)).toBe(same.run.mergedCommit);
});

it("a delivery waiting behind another that is ready too is landed with it: one commit each, one verification, and each run's own record", async () => {
  const first = fixture("zero-edit-learn"),
    second = fixture("zero-edit-learn");
  // One owner: one landing order and one record of what landed.
  second.engine.queue = first.engine.queue;
  second.engine.landings = first.engine.landings;
  const queue = first.engine.queue;
  // Both arrive while somebody else has the turn.
  const ahead = await queue.enter(
    laneKey("a".repeat(64), BRANCH),
    randomUUID(),
    queue.ticket(),
    new AbortController().signal,
  );
  const a = first.execute();
  await vi.waitFor(() => expect(ahead.waiting()).toBe(1));
  const b = second.execute();
  await vi.waitFor(() => expect(ahead.waiting()).toBe(2));
  const before = { first: first.counts(), second: second.counts() };
  ahead.release();
  await Promise.all([a, b]);
  const own = first.run.mergedCommit,
    tip = second.run.mergedCommit;
  expect(own).not.toBe(tip);
  expect(seam.refs.get(BRANCH)).toBe(tip);
  // The first in line replayed the other onto its own commit, verified the
  // last of the two once, and moved the branch once.
  expect(first.events.filter((e) => e === "replay")).toHaveLength(1);
  expect(first.events.filter((e) => e.startsWith("land"))).toEqual(["land:ff"]);
  expect(first.counts().reviews - before.first.reviews).toBe(1);
  expect(first.counts().candidateChecks - before.first.candidateChecks).toBe(1);
  // The one that was taken along verified nothing again and moved nothing.
  expect(second.counts()).toEqual(before.second);
  expect(second.events.filter((e) => e.startsWith("land"))).toEqual([]);
  const review = first.prompts.filter((p) =>
    p.startsWith("Independently inspect"),
  );
  expect(review.at(-1)).toContain(
    "This candidate is 2 deliveries landing together, one commit each, in this order.",
  );
  // Each run's record is about its own commit, accepted as part of the group.
  for (const [f, commit] of [
    [first, own],
    [second, tip],
  ] as const) {
    expect(f.d.candidate).toBe(commit);
    expect(f.d.acceptance).toMatchObject({
      candidate: commit,
      group: { run: first.run.id, tip },
    });
    expect(f.d.integration).toMatchObject({ status: "applied", after: commit });
    expect(seam.refs.get(f.d.taskBranch)).toBe(commit);
    expect(seam.trees.get(f.d.worktreeRoot)!.head).toBe(commit);
    expect(f.d.cleanup.status).toBe("removed");
  }
  expect(queue.busy).toBe(false);
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

it("a deleted branch is never recreated: the verified result is delivered on the task branch", async () => {
  const f = fixture("zero-edit-learn");
  const learn = f.engine.learn.bind(f.engine);
  vi.spyOn(f.engine, "learn").mockImplementation(async (live, cwd, p) => {
    await learn(live, cwd, p);
    seam.refs.delete(BRANCH);
  });
  await f.execute();
  expect(seam.refs.has(BRANCH)).toBe(false);
  expect(f.run.mergedCommit).toBeNull();
  // Verification went on without a branch to compare against.
  expect(f.counts().reviews).toBe(1);
  expect(f.d.integration).toMatchObject({
    status: "branch",
    reason: expect.stringMatching(
      /^Completed, not merged into main: refs\/heads\/main no longer exists\. The verified result is commit /u,
    ),
  });
  expect(seam.refs.get(f.d.taskBranch)).toBe(f.d.candidate);
  expect(f.cleanup).not.toHaveBeenCalled();
});

it("a fast-forward Git refuses is waited on with Git's own words, and tried again once the checkout lets it through", async () => {
  const f = fixture("zero-edit-learn");
  // Something saved after the checkout was looked at: Git refuses over it.
  seam.trees.get(f.root)!.dirty.add("blocked.txt");
  const waits: string[] = [];
  f.engine.pause = async () => {
    waits.push(f.run.notice);
    // Nothing moved, and nothing is reported as merged meanwhile.
    expect(seam.refs.get(BRANCH)).toBe(f.base);
    expect(f.run.mergedCommit).toBeNull();
    expect(f.d.integration.status).toBe("pending");
    expect(
      f.records.get(
        resolve("/controlled-records", "runs", f.run.id, "landing.json"),
      ),
    ).toMatchObject({ status: "abandoned" });
    seam.trees.get(f.root)!.dirty.delete("blocked.txt");
  };
  await f.execute();
  expect(waits).toHaveLength(1);
  expect(waits[0]).toContain(
    `Waiting to land on ${BRANCH}: Git did not fast-forward ${f.root} (would be overwritten)`,
  );
  expect(f.events.filter((e) => e === "land:ff")).toHaveLength(2);
  expect(seam.refs.get(BRANCH)).toBe(f.run.mergedCommit);
  expect(f.d.integration.status).toBe("applied");
  expect(f.d.cleanup.status).toBe("removed");
});

it("a cancellation or an unknown outcome is reported as what it is, never as a delivery on the task branch", async () => {
  const unknown = fixture("unknown");
  await expect(unknown.execute()).rejects.toThrow("could not be read back");
  expect(unknown.d.integration.status).toBe("unknown");
  expect(seam.refs.get(unknown.d.taskBranch)).not.toBe(unknown.base);

  seam.missing = false;
  const canceled = fixture("zero-edit-learn");
  seam.trees.get(canceled.root)!.dirty.add("a.txt");
  const integrate = canceled.engine.integrate.bind(canceled.engine);
  vi.spyOn(canceled.engine, "integrate").mockImplementation(
    async (...args: unknown[]) => {
      canceled.live.abort.abort();
      return integrate(...args);
    },
  );
  await expect(canceled.execute()).rejects.toThrow();
  expect(canceled.d.integration.status).not.toBe("branch");
  expect(seam.refs.get(canceled.d.taskBranch)).toBe(canceled.base);
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
  expect(settled.notice).not.toContain("landing");

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

  // The branch had moved and uncommitted changes were being carried over:
  // where they are as they were is the first thing the user has to know.
  const c = fixture();
  const in_ = (name: string) =>
    resolve("/controlled-records", "runs", c.run.id, name);
  const backup = `refs/cadence/wip-backup/${c.run.id}`;
  c.records.set(in_("state.json"), c.run);
  c.records.set(in_("landing.json"), {
    branch: BRANCH,
    before: "1".repeat(40),
    after: "4".repeat(40),
    worktree: c.root,
    backup: { ref: backup, oid: "5".repeat(40) },
    status: "carrying",
  });
  c.engine.settleInterrupted(c.run.id);
  expect((c.records.get(in_("state.json")) as WorkflowRun).notice).toContain(
    `${BRANCH} was moved to 444444444444, and the uncommitted changes in ${c.root} to files that landing changed were being carried over when Cadence stopped: a file that was not written back yet shows the delivered version. As they were before: ${backup}`,
  );

  // A journal that cannot be read says so instead of implying nothing moved.
  const h = fixture();
  const on = (name: string) =>
    resolve("/controlled-records", "runs", h.run.id, name);
  h.records.set(on("state.json"), h.run);
  h.records.set(on("landing.json"), { status: "intent", branch: BRANCH });
  h.engine.settleInterrupted(h.run.id);
  expect((h.records.get(on("state.json")) as WorkflowRun).notice).toContain(
    `The record of this run's landing could not be read: ${BRANCH} may or may not have been moved.`,
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
    expected: 1,
    waived: new Set(),
  };
  const frontier = "9".repeat(40);
  seam.refs.set(BRANCH, frontier);
  const head = await f.engine.candidate(f.live, candidateCwd, f.live.proposal, [
    "a.txt",
  ]);
  expect(head).not.toBe(sealed);
  expect(f.d.candidate).toBe(head);
  expect(f.live.delivery.candidateBase()).toBe(frontier);
  expect(f.live.lastReviewedCandidate).toBeUndefined();
  expect(f.live.c0Checks).toBeUndefined();
  // What the replay staged on the branch's head is committed and sealed
  // there like any other candidate.
  expect(f.events).toEqual(["onto", "replay", "commit", "seal"]);
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

it("a held follower canceled during the leader's landing still records its carried commit and group acceptance consistently", async () => {
  const f = fixture("zero-edit-learn");
  const commit = "c".repeat(40);
  const parent = f.base;
  const acceptance = {
    candidate: commit,
    tree: "b".repeat(40),
    planDigest: f.live.proposal.digest,
    contextDigest: "a".repeat(64),
    checks: ["c1"],
    review: "r1",
    group: { run: randomUUID(), tip: commit },
  };
  await f.engine.gitStep(
    f.live,
    f.root,
    "worktree-integration",
    (run: (args: string[]) => Promise<unknown>) => f.live.delivery.create(run),
  );
  f.live.abort.abort({ source: "user", reason: "late-cancel" });
  await f.engine.adoptLanding(f.live, f.d.worktreeRoot, {
    commit,
    parent,
    acceptance,
    size: 2,
  });
  expect(f.run.mergedCommit).toBe(commit);
  expect(f.d.candidate).toBe(commit);
  expect(f.d.acceptance).toEqual(acceptance);
  expect(f.live.notes.join("\n")).toContain("Landed together with 1 other");
});

it("Workflows.run honors uninterruptible:true even when live.abort already fired, while normal runs still refuse", async () => {
  const f = fixture("zero-edit-learn");
  let currentChecks = 0;
  let runningChecks = 0;
  f.engine.current = () => {
    currentChecks++;
  };
  f.engine.assertRunning = () => {
    runningChecks++;
    throw new Error("aborted");
  };
  const runMethod = (
    Workflows.prototype as unknown as {
      run: (...args: unknown[]) => Promise<unknown>;
    }
  ).run;
  f.live.abort.abort();
  await expect(
    runMethod.call(f.engine, f.live, f.root, { git: ["--version"] }),
  ).rejects.toThrow("aborted");
  expect(runningChecks).toBe(1);
  expect(currentChecks).toBe(0);
  // With uninterruptible:true, run() calls current() instead of assertRunning();
  // verify it passes the guard (fails later only because the mock lacks owner.trackCheck).
  await expect(
    runMethod.call(
      f.engine,
      f.live,
      f.root,
      { git: ["--version"] },
      { uninterruptible: true },
    ),
  ).rejects.not.toThrow("aborted");
  expect(currentChecks).toBe(1);
  expect(runningChecks).toBe(1);
});

it("recordGitStep attempt() and move() accept real runProcess nonzero exit (outcome:'failed', closed:true, exitCode:N) as settled answers while rejecting timeout/unknown", async () => {
  const f = fixture("zero-edit-learn");
  await f.engine.gitStep(
    f.live,
    f.root,
    "worktree-integration",
    (run: (args: string[]) => Promise<unknown>) => f.live.delivery.create(run),
  );
  // 1. recordGitStep attempt() must accept outcome:"failed", closed:true, exitCode:1 (e.g. git cherry-pick conflict)
  f.engine.run = async () => ({
    outcome: "failed",
    closed: true,
    exitCode: 1,
    signal: null,
    durationMs: 1,
    text: "conflict",
    output: "CONFLICT (content): Merge conflict in a.txt",
    truncated: false,
  });
  const got = await f.engine.gitStep(
    f.live,
    f.d.worktreeRoot,
    "conflict-attempt",
    async (
      _git: unknown,
      attempt: (args: string[]) => Promise<{ exitCode: number | null }>,
    ) => {
      const picked = await attempt(["cherry-pick", "--no-commit", "HEAD"]);
      return picked.exitCode;
    },
  );
  expect(got).toBe(1);
  expect(f.run.steps.at(-1)?.status).toBe("completed");

  // 2. recordGitStep attempt() must still reject non-settled outcomes like timeout
  f.engine.run = async () => ({
    outcome: "timeout",
    closed: true,
    exitCode: null,
    signal: "SIGTERM",
    durationMs: 1,
    text: "timed out",
    output: "",
    truncated: false,
  });
  await expect(
    f.engine.gitStep(
      f.live,
      f.d.worktreeRoot,
      "timeout-attempt",
      async (_git: unknown, attempt: (args: string[]) => Promise<unknown>) =>
        attempt(["cherry-pick", "--no-commit", "HEAD"]),
    ),
  ).rejects.toThrow(/timeout/i);

  // 3. move() must return { refused } when git merge --ff-only exits nonzero with outcome:"failed"
  const head = f.base;
  const candidate = "c".repeat(40);
  f.engine.branchHead = async () => head;
  f.engine.run = async () => ({
    outcome: "failed",
    closed: true,
    exitCode: 128,
    signal: null,
    durationMs: 1,
    text: "failed",
    output:
      "error: Your local changes to the following files would be overwritten by merge",
    truncated: false,
  });
  const moved = await f.engine.move(
    f.live,
    candidate,
    head,
    { kind: "fast-forward", worktree: f.root },
    ["a.txt"],
  );
  expect(moved).toEqual({
    refused:
      "error: Your local changes to the following files would be overwritten by merge",
  });
});
