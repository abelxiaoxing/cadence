import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import {
  decodeDeliveryObservation,
  type WorkflowStep,
} from "../src/service/contracts/workflow.ts";
import { RepositoryCoordination } from "../src/service/repository-coordination.ts";
import {
  acceptanceRecord,
  deliveryObservation,
  taskBranch,
  WorkflowDelivery,
} from "../src/service/workflow-delivery.ts";
import {
  WorkflowRefusal,
  worktreeResidue,
} from "../src/service/workflow-git.ts";
import { decodeWorkerPublicRequest } from "../src/worker-public.mjs";
import { deliveryFixture } from "./helpers/delivery-fixture.ts";

const step = (
  id: string,
  kind: "check" | "review",
  status: WorkflowStep["status"] = "completed",
): WorkflowStep => ({
  id,
  kind,
  status,
  exitCode: 0,
  text: "fixture original",
  truncated: false,
});
const digest = "b".repeat(64);
async function candidate() {
  const f = deliveryFixture(),
    cwd = await f.create();
  writeFileSync(join(cwd, "a.txt"), "candidate\n");
  f.gitAt(cwd, "add", "--", "a.txt");
  f.gitAt(cwd, "commit", "-qm", "candidate");
  const oid = f.head(cwd);
  f.delivery.update(oid);
  f.view.candidate = oid;
  f.view.acceptance = acceptanceRecord(
    oid,
    f.gitAt(cwd, "rev-parse", `${oid}^{tree}`),
    digest,
    f.execution,
    [step("check-1", "check")],
    step("review-1", "review"),
    1,
  );
  return { ...f, cwd, oid };
}
it("planning observation does not create Git resources; explicit preparation creates one named worktree without moving main", async () => {
  const f = deliveryFixture();
  expect(f.git("branch", "--list", "cadence/*")).toBe("");
  expect(existsSync(f.view.worktreeRoot)).toBe(false);
  await f.create();
  expect(f.gitAt(f.view.worktreeRoot, "symbolic-ref", "HEAD")).toBe(
    f.view.taskBranch,
  );
  expect(f.git("symbolic-ref", "HEAD")).toBe("refs/heads/main");
  expect(f.git("rev-parse", "HEAD")).toBe(f.base);
  expect(decodeDeliveryObservation(f.view)).toEqual(f.view);
  await expect(f.delivery.create(async () => {})).rejects.toThrow("conflict");
  f.delivery.finish();
});
it("an unrecorded candidate commit names the changed HEAD and preserves both worktrees", async () => {
  const f = deliveryFixture(),
    cwd = await f.create();
  writeFileSync(join(cwd, "a.txt"), "worker committed outside the owner\n");
  f.gitAt(cwd, "commit", "-qam", "unrecorded worker commit");
  const observed = f.head(cwd);
  const refusal = await f.delivery.assertTip().catch((error) => error);
  expect(refusal).toBeInstanceOf(WorkflowRefusal);
  expect(refusal.code).toBe("stale");
  expect(refusal.detail).toContain("Worktree HEAD changed outside");
  expect(refusal.detail).toContain(cwd);
  expect(refusal.detail).toContain(`expected ${f.base}`);
  expect(refusal.detail).toContain(`observed ${observed}`);
  expect(refusal.detail).toContain("retained");
  expect(f.view.workspace?.head).toBe(f.base);
  expect(f.head(cwd)).toBe(observed);
  expect(f.git("rev-parse", "HEAD")).toBe(f.base);
  expect(readFileSync(join(cwd, "a.txt"), "utf8")).toBe(
    "worker committed outside the owner\n",
  );
  f.delivery.finish();
});
it("exact acceptance refuses hidden staged edits and a substituted context or candidate", async () => {
  const f = await candidate();
  await expect(
    f.delivery.assertAccepted(digest, f.execution, ["a.txt"]),
  ).resolves.toBe(f.oid);
  await expect(
    f.delivery.assertAccepted("c".repeat(64), f.execution, ["a.txt"]),
  ).rejects.toThrow("stale");
  await expect(
    f.delivery.assertAccepted(
      digest,
      { ...f.execution, cwd: join(f.root, "other") },
      ["a.txt"],
    ),
  ).rejects.toThrow("stale");
  writeFileSync(join(f.cwd, "a.txt"), "concealed staged mutation\n");
  f.gitAt(f.cwd, "add", "a.txt");
  writeFileSync(join(f.cwd, "a.txt"), "candidate\n");
  const index = f.gitAt(f.cwd, "diff", "--cached");
  await expect(
    f.delivery.assertAccepted(digest, f.execution, ["a.txt"]),
  ).rejects.toThrow("forbidden");
  expect(f.gitAt(f.cwd, "diff", "--cached")).toBe(index);
  f.delivery.finish();
});
it.each(["advance", "switch", "dirty"])(
  "%s target blocks delivery while retaining candidate and user bytes",
  async (change) => {
    const f = await candidate();
    if (change === "advance") {
      writeFileSync(join(f.root, "outside"), "user\n");
      f.git("add", "outside");
      f.git("commit", "-qm", "advance");
    }
    if (change === "switch") f.git("switch", "-qc", "user-branch");
    if (change === "dirty")
      writeFileSync(join(f.root, "a.txt"), "user dirty\n");
    await expect(
      f.delivery.assertAccepted(digest, f.execution, ["a.txt"]),
    ).rejects.toThrow(/stale|conflict/u);
    expect(f.head(f.cwd)).toBe(f.oid);
    expect(f.git("rev-parse", f.view.taskBranch)).toBe(f.oid);
    expect(readFileSync(join(f.cwd, "a.txt"), "utf8")).toBe("candidate\n");
    f.delivery.finish();
  },
);
it.each([false, true])(
  "cleanup never deletes a task branch; ignored residue anywhere is retained (residue=%s)",
  async (residue) => {
    const f = await candidate();
    f.git("merge", "--ff-only", f.oid);
    f.view.integration = {
      status: "applied",
      before: f.base,
      after: f.oid,
      reason: "",
    };
    f.view.postChecks = "passed";
    if (residue) {
      mkdirSync(join(f.cwd, "ignored"));
      writeFileSync(join(f.cwd, "ignored", "user-data"), "only copy");
    }
    expect((await worktreeResidue(f.cwd)).length > 0).toBe(residue);
    await f.delivery.cleanup(async (path, check) => {
      await f.resources.mutate(
        f.binding.target.repository,
        new AbortController().signal,
        async () => {
          await check();
          f.git("worktree", "remove", path);
        },
        () => true,
      );
    });
    expect(f.git("rev-parse", f.view.taskBranch)).toBe(f.oid);
    expect(existsSync(f.cwd)).toBe(residue);
    expect(f.view.cleanup.status).toBe(residue ? "retained" : "removed");
    if (residue) {
      expect(f.view.cleanup.reason).toContain("ignored/user-data");
      expect(readFileSync(join(f.cwd, "ignored", "user-data"), "utf8")).toBe(
        "only copy",
      );
    }
    f.delivery.finish();
  },
);
it("acceptance requires every current check and an approved review, not a zero exit alone", () => {
  const f = deliveryFixture(),
    oid = f.base;
  for (const [checks, review, count] of [
    [[step("c", "check", "failed")], step("r", "review"), 1],
    [[step("c", "check")], step("r", "review", "failed"), 1],
    [[step("c", "check")], step("r", "review"), 2],
  ] as const)
    expect(() =>
      acceptanceRecord(
        oid,
        oid,
        digest,
        f.execution,
        [...checks],
        review,
        count,
      ),
    ).toThrow("stale");
  expect(taskBranch("../中文 🔒 -- unsafe title", f.run)).toBe(
    `refs/heads/cadence/unsafe-title-${f.run}`,
  );
  const invalid = structuredClone(f.view);
  invalid.binding.target.branch = "refs/heads/../wrong";
  expect(() => decodeDeliveryObservation(invalid)).toThrow();
});

it("only the public review purpose can carry fixed Git observation binding", () => {
  const f = deliveryFixture();
  const request = {
    protocol: 2,
    taskId: randomUUID(),
    taskKind: "research",
    runId: randomUUID(),
    childRunId: randomUUID(),
    assignmentId: "review",
    purpose: "review",
    model: {
      sourceSelectionId: randomUUID(),
      provider: "fixture",
      model: "fixed",
      api: "openai-completions",
      thinking: "off",
    },
    role: { role: "design-explorer", sha256: "a".repeat(64) },
    context: "fixture",
    instructions: "Readonly",
    prompt: "Review",
    handoff: { graphRevision: 1, inputs: [] },
    changes: { root: f.root, base: f.base, candidate: f.base },
  };
  expect(decodeWorkerPublicRequest(request).changes).toEqual(request.changes);
  expect(() =>
    decodeWorkerPublicRequest({ ...request, purpose: "research" }),
  ).toThrow();
  expect(() =>
    decodeWorkerPublicRequest({
      ...request,
      changes: { ...request.changes, candidate: "HEAD" },
    }),
  ).toThrow();
  expect(() =>
    decodeWorkerPublicRequest({
      ...request,
      changes: { ...request.changes, root: "relative" },
    }),
  ).toThrow();
});

it("a clean substituted candidate cannot smuggle committed changes outside approved paths", async () => {
  const f = await candidate();
  writeFileSync(join(f.cwd, "outside.txt"), "not approved");
  f.gitAt(f.cwd, "add", "outside.txt");
  f.gitAt(f.cwd, "commit", "-qm", "foreign commit");
  const actual = f.head(f.cwd);
  f.delivery.update(actual);
  f.view.candidate = actual;
  f.view.acceptance = acceptanceRecord(
    actual,
    f.gitAt(f.cwd, "rev-parse", `${actual}^{tree}`),
    digest,
    f.execution,
    [step("c", "check")],
    step("r", "review"),
    1,
  );
  await expect(
    f.delivery.assertAccepted(digest, f.execution, ["a.txt"]),
  ).rejects.toThrow("forbidden");
  expect(readFileSync(join(f.cwd, "outside.txt"), "utf8")).toBe("not approved");
  f.delivery.finish();
});
it("switching a managed worktree to another branch at the same OID invalidates placement before owner effects", async () => {
  const f = await candidate();
  f.gitAt(f.cwd, "switch", "-qc", "substituted");
  expect(f.head(f.cwd)).toBe(f.oid);
  await expect(f.delivery.assertBinding(f.cwd)).rejects.toThrow("stale");
  f.delivery.finish();
});
it("failed post-checks and an unconfirmed removal never authorize cleanup", async () => {
  const f = await candidate();
  f.git("merge", "--ff-only", f.oid);
  f.view.integration = {
    status: "applied",
    before: f.base,
    after: f.oid,
    reason: "",
  };
  f.view.postChecks = "failed";
  const removed: string[] = [];
  await f.delivery.cleanup(async (path, check) => {
    await check();
    removed.push(path);
  });
  expect(removed).toEqual([]);
  expect(existsSync(f.cwd)).toBe(true);
  expect(f.view.cleanup.status).toBe("retained");
  f.delivery.finish();
});
it("an exit-zero removal callback cannot erase an existing workspace from recorded outcomes", async () => {
  const f = await candidate();
  f.git("merge", "--ff-only", f.oid);
  f.view.integration = {
    status: "applied",
    before: f.base,
    after: f.oid,
    reason: "",
  };
  f.view.postChecks = "passed";
  await f.delivery.cleanup(async (_path, check) => {
    await check();
  });
  expect(existsSync(f.cwd)).toBe(true);
  expect(f.view.cleanup).toMatchObject({
    status: "retained",
    reason: "Worktree removal was not confirmed",
  });
  expect(f.git("rev-parse", f.view.taskBranch)).toBe(f.oid);
  f.delivery.finish();
});
it("a later delivery creates its own branch without adopting the previous retained worktree", async () => {
  const f = deliveryFixture();
  await f.create();
  f.delivery.finish();
  const nextId = randomUUID();
  const next = new WorkflowDelivery(
    deliveryObservation(
      f.binding,
      dirname(dirname(f.view.worktreeRoot)),
      nextId,
      "another goal",
    ),
    new RepositoryCoordination(
      f.c,
      f.root,
      f.epoch,
      nextId,
      () => {},
      () => {},
    ),
    () => {},
  );
  expect(f.git("branch", "--list", "cadence/*").split("\n")).toHaveLength(1);
  next.prepareHome();
  await next.resources.mutate(
    f.binding.target.repository,
    new AbortController().signal,
    () => next.create(async (args) => f.git(...args)),
    () => true,
  );
  expect(next.view.taskBranch).not.toBe(f.view.taskBranch);
  expect(next.view.worktreeRoot).not.toBe(f.view.worktreeRoot);
  expect(f.git("branch", "--list", "cadence/*").split("\n")).toHaveLength(2);
  expect(existsSync(f.view.worktreeRoot)).toBe(true);
  expect(f.git("symbolic-ref", "HEAD")).toBe(f.binding.target.branch);
  next.finish();
});
it("an assignment's own worktree starts at the candidate's commit, its commit is picked onto the candidate, and only a spotless one is removed", async () => {
  const f = deliveryFixture(),
    cwd = await f.create();
  // What an earlier assignment left is committed in the candidate first.
  writeFileSync(join(cwd, "a.txt"), "earlier assignment\n");
  f.gitAt(cwd, "commit", "-qam", "assignments so far");
  f.delivery.update(f.head(cwd));
  const mutate = <T>(body: () => Promise<T>) =>
    f.resources.mutate(
      f.binding.target.repository,
      new AbortController().signal,
      body,
      () => true,
    );
  const child = await mutate(() =>
    f.delivery.createChild("docs", async (args) => f.git(...args)),
  );
  expect(child).toBe(f.delivery.childPath("docs"));
  expect(child.startsWith(dirname(cwd))).toBe(true);
  // It sees the earlier work and never owns or moves a branch.
  expect(readFileSync(join(child, "a.txt"), "utf8")).toBe(
    "earlier assignment\n",
  );
  expect(() => f.gitAt(child, "symbolic-ref", "-q", "HEAD")).toThrow();
  expect(await f.delivery.assertTip(child)).toBe(f.head(cwd));
  expect(f.view.artifacts).toMatchObject([
    { id: "docs", path: child, state: "ready", applied: null },
  ]);
  expect(decodeDeliveryObservation(f.view)).toEqual(f.view);
  // The same assignment cannot get a second worktree in this run.
  await expect(
    mutate(() => f.delivery.createChild("docs", async (a) => f.git(...a))),
  ).rejects.toThrow();

  writeFileSync(join(child, "guide.md"), "# Guide\n");
  f.gitAt(child, "add", "--", "guide.md");
  f.gitAt(child, "commit", "-qm", "assignment docs");
  // A commit the owner did not record is not the tip it will integrate.
  await expect(f.delivery.assertTip(child)).rejects.toMatchObject({
    code: "stale",
    detail: expect.stringContaining(child),
  });
  const commit = f.head(child);
  f.delivery.update(commit, child);
  expect(await f.delivery.assertTip(child)).toBe(commit);
  // The candidate's own record is untouched by a child's commit.
  expect(await f.delivery.assertTip()).toBe(f.head(cwd));

  const before = f.head(cwd);
  f.gitAt(cwd, "cherry-pick", "--no-edit", commit);
  const picked = f.head(cwd);
  expect(f.gitAt(cwd, "show", "-s", "--format=%P", picked)).toBe(before);
  f.delivery.update(picked);
  f.delivery.applied(child, picked);
  expect(readFileSync(join(cwd, "guide.md"), "utf8")).toBe("# Guide\n");

  // Ignored residue retains the worktree with concrete paths; nothing is forced.
  mkdirSync(join(child, "ignored"));
  for (let i = 0; i < 10; i++)
    writeFileSync(join(child, "ignored", `cache-${i}.bin`), "x");
  let childReason = "";
  const remove = async (path: string, check: () => Promise<void>) => {
    try {
      await check();
    } catch (error) {
      childReason = error instanceof Error ? error.message : String(error);
      throw error;
    }
    f.git("worktree", "remove", path);
  };
  await f.delivery.removeChild(child, remove, {
    secrets: () => ["cache-0"],
  });
  expect(childReason).toContain("ignored/[redacted].bin");
  expect(childReason).toContain("ignored/cache-1.bin");
  expect(childReason).toContain("and 2 more");
  expect(childReason).not.toContain("cache-0");
  expect(existsSync(child)).toBe(true);
  expect(f.view.artifacts?.[0]).toMatchObject({
    state: "retained",
    applied: picked,
  });
  // A retained worktree takes no further work.
  await expect(f.delivery.assertTip(child)).rejects.toThrow();

  const tidy = await mutate(() =>
    f.delivery.createChild("tests", async (args) => f.git(...args)),
  );
  f.delivery.applied(tidy, picked);
  await f.delivery.removeChild(tidy, remove);
  expect(existsSync(tidy)).toBe(false);
  expect(f.view.artifacts?.[1]).toMatchObject({
    id: "tests",
    state: "removed",
  });
  // The candidate and its named branch are as they were.
  expect(f.gitAt(cwd, "symbolic-ref", "HEAD")).toBe(f.view.taskBranch);
  expect(await f.delivery.assertTip()).toBe(picked);
});

it("task-branch-v2 keeps detached dev checkpoints pinned under private refs, seals one single-parent delivery commit, advances taskBranch only at merge, and cleans checkpoint refs after worktree removal", async () => {
  const f = deliveryFixture("task-branch-v2");
  const cwd = await f.create();
  // Candidate worktree is detached; taskBranch is reserved at base; main did not move.
  expect(() => f.gitAt(cwd, "symbolic-ref", "-q", "HEAD")).toThrow();
  expect(f.git("rev-parse", f.view.taskBranch)).toBe(f.base);
  expect(f.git("rev-parse", "HEAD")).toBe(f.base);
  expect(f.view.workspace).toMatchObject({ mode: "detached", state: "ready" });
  expect(decodeDeliveryObservation(f.view)).toEqual(f.view);

  // Two noisy development checkpoints on detached HEAD, each pinned under private refs.
  writeFileSync(join(cwd, "a.txt"), "wip 1\n");
  f.gitAt(cwd, "commit", "-qam", "dev checkpoint 1");
  const cp1 = f.head(cwd);
  f.delivery.update(cp1);
  const pinned1 = await f.delivery.pinCheckpoint(
    cp1,
    "dev",
    async (args) => f.gitAt(cwd, ...args),
    cwd,
  );
  expect(pinned1?.ref).toBe(`refs/cadence/runs/${f.run}/checkpoints/1`);
  expect(f.git("rev-parse", pinned1!.ref)).toBe(cp1);

  writeFileSync(join(cwd, "a.txt"), "final clean result\n");
  f.gitAt(cwd, "commit", "-qam", "dev checkpoint 2");
  const cp2 = f.head(cwd);
  f.delivery.update(cp2);
  const pinned2 = await f.delivery.pinCheckpoint(
    cp2,
    "dev",
    async (args) => f.gitAt(cwd, ...args),
    cwd,
  );
  expect(f.view.lastCheckpoint).toBe(cp2);
  expect(f.view.checkpointCount).toBe(2);
  // taskBranch STILL sits at base during development!
  expect(f.git("rev-parse", f.view.taskBranch)).toBe(f.base);

  // Simulate a verified non-overlapping sibling advancing main to frontier.
  writeFileSync(join(f.root, "sibling.txt"), "sibling delivered\n");
  f.git("add", "--", "sibling.txt");
  f.git("commit", "-qm", "sibling delivery");
  const frontier = f.head(f.root);
  expect(f.delivery.advanceFrontier(f.base, frontier)).toBe(true);
  expect(f.delivery.needsRefresh()).toBe(true);

  // Incorporate sibling frontier via detached --no-ff merge, pinned to private ref.
  f.gitAt(cwd, "merge", "--no-ff", "--no-edit", frontier);
  const merged = f.head(cwd);
  await f.delivery.pinCheckpoint(
    merged,
    "merge",
    async (args) => f.gitAt(cwd, ...args),
    cwd,
  );
  f.delivery.refreshed(merged);
  expect(f.delivery.needsRefresh()).toBe(false);

  // Seal single-parent delivery commit C0 directly on top of sibling frontier!
  const c0 = await f.delivery.sealDeliveryCommit(
    frontier,
    ["a.txt"],
    "Cadence: clean single-commit delivery",
    async (args) => ({ output: f.gitAt(cwd, ...args) }),
  );
  expect(f.head(cwd)).toBe(c0);
  expect(f.gitAt(cwd, "show", "-s", "--format=%P", c0)).toBe(frontier);
  expect(f.gitAt(cwd, "diff", "--name-only", frontier, c0)).toBe("a.txt");
  expect(readFileSync(join(cwd, "a.txt"), "utf8")).toBe("final clean result\n");
  expect(readFileSync(join(cwd, "sibling.txt"), "utf8")).toBe(
    "sibling delivered\n",
  );
  // taskBranch is STILL at base until final sign-off!
  expect(f.git("rev-parse", f.view.taskBranch)).toBe(f.base);

  // Sign off C0, advance taskBranch, fast-forward main, and verify cleanup removes
  // private checkpoint refs while keeping taskBranch.
  f.view.acceptance = acceptanceRecord(
    c0,
    f.gitAt(cwd, "rev-parse", `${c0}^{tree}`),
    digest,
    f.execution,
    [step("check-1", "check")],
    step("review-1", "review"),
    1,
  );
  await expect(
    f.delivery.assertAccepted(digest, f.execution, ["a.txt"]),
  ).resolves.toBe(c0);
  await f.delivery.advanceTaskBranch(c0, async (args) => f.git(...args));
  expect(f.git("rev-parse", f.view.taskBranch)).toBe(c0);

  f.git("merge", "--ff-only", c0);
  expect(f.head(f.root)).toBe(c0);
  expect(f.git("rev-list", "--count", `${frontier}..HEAD`)).toBe("1");
  f.view.integration = {
    status: "applied",
    before: frontier,
    after: c0,
    reason: "",
  };
  f.view.postChecks = "passed";

  const deletedRefs: string[] = [];
  await f.delivery.cleanup(
    async (path, check) => {
      await check();
      f.git("worktree", "remove", path);
    },
    {
      deleteCheckpointRefs: async (refs) => {
        for (const r of refs) {
          f.git("update-ref", "-d", r.ref, r.oid);
          deletedRefs.push(r.ref);
        }
        return deletedRefs;
      },
    },
  );
  expect(f.view.cleanup.status).toBe("removed");
  expect(existsSync(cwd)).toBe(false);
  expect(deletedRefs).toHaveLength(4); // cp1, cp2, merge, c0
  expect(f.git("rev-parse", f.view.taskBranch)).toBe(c0);
  for (const ref of deletedRefs) {
    expect(() => f.git("show-ref", "--verify", ref)).toThrow();
  }
  expect(pinned2?.status).toBe("deleted");
  f.delivery.finish();
});

it("task-branch-v2 refuses branch switch in detached candidate and keeps checkpoint refs when worktree is retained", async () => {
  const f = deliveryFixture("task-branch-v2");
  const cwd = await f.create();
  writeFileSync(join(cwd, "a.txt"), "work\n");
  f.gitAt(cwd, "commit", "-qam", "dev");
  const cp = f.head(cwd);
  f.delivery.update(cp);
  const entry = await f.delivery.pinCheckpoint(
    cp,
    "dev",
    async (args) => f.gitAt(cwd, ...args),
    cwd,
  );
  // Switching detached candidate onto a branch invalidates binding.
  f.gitAt(cwd, "switch", "-qc", "unexpected-branch");
  await expect(f.delivery.assertBinding(cwd)).rejects.toThrow("stale");
  // Private checkpoint ref stays intact on retained/aborted work.
  expect(f.git("rev-parse", entry!.ref)).toBe(cp);
  f.delivery.finish();
});
