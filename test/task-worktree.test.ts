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
import { worktreeResidue } from "../src/service/workflow-git.ts";
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
    if (residue)
      expect(readFileSync(join(f.cwd, "ignored", "user-data"), "utf8")).toBe(
        "only copy",
      );
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
