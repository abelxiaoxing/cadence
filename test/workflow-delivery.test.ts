import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  decodeDeliveryObservation,
  type WorkflowStep,
} from "../src/service/contracts/workflow.ts";
import {
  acceptanceRecord,
  taskBranch,
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
  f.delivery.update(cwd, oid);
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
  await expect(
    f.delivery.create("@candidate", f.base, async () => {}),
  ).rejects.toThrow("conflict");
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
    if (residue) {
      mkdirSync(join(f.cwd, "ignored"));
      writeFileSync(join(f.cwd, "ignored", "user-data"), "only copy");
    }
    expect((await worktreeResidue(f.cwd)).length > 0).toBe(residue);
    await f.delivery.cleanup(async (artifact, check) => {
      await f.resources.mutate(
        f.binding.target.repository,
        new AbortController().signal,
        async () => {
          await check();
          f.git("worktree", "remove", artifact.path);
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
  f.delivery.update(f.cwd, actual);
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
it("cleanup follows recorded cherry-pick mapping even after the candidate worktree was removed", async () => {
  const f = deliveryFixture(),
    cwd = await f.create();
  const child = await f.resources.mutate(
    f.binding.target.repository,
    new AbortController().signal,
    () => f.delivery.create("a", f.base, async (args) => f.git(...args)),
    () => true,
  );
  await expect(f.delivery.assertBinding(child)).resolves.toBeUndefined();
  writeFileSync(join(child, "a.txt"), "task output");
  f.gitAt(child, "add", "a.txt");
  f.gitAt(child, "commit", "-qm", "task");
  const task = f.head(child);
  f.delivery.update(child, task);
  writeFileSync(join(cwd, "b.txt"), "predecessor output");
  f.gitAt(cwd, "add", "b.txt");
  f.gitAt(cwd, "commit", "-qm", "predecessor");
  f.gitAt(cwd, "cherry-pick", "--no-edit", task);
  const applied = f.head(cwd);
  expect(applied).not.toBe(task);
  f.delivery.applied("a", applied);
  f.delivery.update(cwd, applied);
  f.view.candidate = applied;
  f.git("merge", "--ff-only", applied);
  f.view.integration = {
    status: "applied",
    before: f.base,
    after: applied,
    reason: "",
  };
  await f.delivery.cleanup(async (artifact, check) => {
    await check();
    f.git("worktree", "remove", artifact.path);
  });
  expect(f.view.cleanup.status, f.view.cleanup.reason).toBe("removed");
  expect(existsSync(child)).toBe(false);
  expect(existsSync(cwd)).toBe(false);
  expect(f.git("rev-parse", f.view.taskBranch)).toBe(applied);
  f.delivery.finish();
});
