// @module-tag slow
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, it, vi } from "vitest";
import type {
  WorkflowProposal,
  WorkflowStep,
} from "../src/service/contracts/workflow.ts";
import { acceptanceRecord } from "../src/service/workflow-delivery.ts";
import { pathIdentity } from "../src/service/workflow-git.ts";
import { Workflows } from "../src/service/workflows.ts";
import { deliveryFixture } from "./helpers/delivery-fixture.ts";
import { plan } from "./helpers/workflow-plan.ts";

const step = (id: string, kind: "check" | "review"): WorkflowStep => ({
  id,
  kind,
  status: "completed",
  exitCode: 0,
  text: "fixture original",
  truncated: false,
});

async function candidate() {
  const f = deliveryFixture();
  const integration = await f.create();
  writeFileSync(join(integration, "a.txt"), "candidate\n");
  f.gitAt(integration, "add", "--", "a.txt");
  f.gitAt(integration, "commit", "-qm", "candidate");
  const original = f.head(integration);
  f.delivery.update(original);
  const digest = "b".repeat(64);
  const approved = plan();
  approved.tasks = [{ ...approved.tasks[0], writes: ["a.txt"] }];
  const proposal = { plan: approved, digest } as WorkflowProposal;
  const live = {
    run: {
      id: f.run,
      steps: [],
      scope: [],
      mergedCommit: null as string | null,
    },
    execution: f.execution,
    delivery: f.delivery,
    target: { head: f.base, branch: "refs/heads/main" },
    guidance: { agents: pathIdentity(f.root, "AGENTS.md") },
  };
  f.view.candidate = original;
  f.view.acceptance = acceptanceRecord(
    original,
    f.gitAt(integration, "rev-parse", `${original}^{tree}`),
    digest,
    f.execution,
    [step("check-1", "check")],
    step("review-1", "review"),
    1,
  );
  const verify = vi.fn(async () => {});
  const engine = Object.assign(Object.create(Workflows.prototype), {
    cwd: f.root,
    active: new Map([[f.run, live]]),
    gitStep: async (
      _live: unknown,
      at: string,
      _title: string,
      body: (run: (args: string[]) => Promise<unknown>) => Promise<void>,
    ) =>
      body(async (args) => {
        f.gitAt(at, ...args);
      }),
    verifyAndRepair: verify,
  });
  const advance = (path: string) => {
    const target = join(f.root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${path} sibling\n`);
    f.git("add", "--", path);
    f.git("commit", "-qm", "verified sibling");
    return f.head(f.root);
  };
  return {
    ...f,
    integration,
    original,
    proposal,
    live,
    engine,
    verify,
    advance,
    refresh: () => engine.refreshCandidate(live, integration, proposal),
  };
}

it("only a successful post-check advances matching pending sibling frontiers", async () => {
  const f = await candidate();
  const matching = {
    delivery: {
      view: { binding: { target: { branch: "refs/heads/main" } } },
      advanceFrontier: vi.fn(),
    },
  };
  const otherBranch = {
    delivery: {
      view: { binding: { target: { branch: "refs/heads/other" } } },
      advanceFrontier: vi.fn(),
    },
  };
  f.engine.active.set("matching", matching);
  f.engine.active.set("other", otherBranch);
  f.live.run.mergedCommit = f.original;
  f.view.integration = {
    status: "applied",
    before: f.base,
    after: f.original,
    reason: "",
  };
  f.view.postChecks = "failed";
  expect(() => f.engine.advanceSiblings(f.live)).toThrow("stale");
  expect(matching.delivery.advanceFrontier).not.toHaveBeenCalled();
  f.view.postChecks = "passed";
  f.engine.advanceSiblings(f.live);
  expect(matching.delivery.advanceFrontier).toHaveBeenCalledWith(
    f.base,
    f.original,
  );
  expect(otherBranch.delivery.advanceFrontier).not.toHaveBeenCalled();
  f.delivery.finish();
});

it("merges a verified sibling into the candidate and re-verifies only the run's own diff", async () => {
  const f = await candidate();
  const sibling = f.advance("b.txt");
  expect(f.delivery.advanceFrontier(f.base, sibling)).toBe(true);
  await f.refresh();
  const merged = f.head(f.integration);
  expect(f.verify).toHaveBeenCalledOnce();
  expect(f.gitAt(f.integration, "rev-parse", "HEAD^1")).toBe(f.original);
  expect(f.gitAt(f.integration, "rev-parse", "HEAD^2")).toBe(sibling);
  expect(f.delivery.candidateBase()).toBe(sibling);
  expect(f.git("rev-parse", "HEAD")).toBe(sibling);
  // The incorporated b.txt is not attributed to this run's approved a.txt.
  f.view.candidate = merged;
  f.view.acceptance = acceptanceRecord(
    merged,
    f.gitAt(f.integration, "rev-parse", `${merged}^{tree}`),
    f.proposal.digest,
    f.execution,
    [step("check-2", "check")],
    step("review-2", "review"),
    1,
  );
  await expect(
    f.delivery.assertAccepted(f.proposal.digest, f.execution, ["a.txt"]),
  ).resolves.toBe(merged);
  f.delivery.finish();
});

it("a failed refreshed verification preserves the merged candidate and sibling target", async () => {
  const f = await candidate();
  const sibling = f.advance("b.txt");
  f.delivery.advanceFrontier(f.base, sibling);
  f.verify.mockRejectedValueOnce(new Error("fresh verification failed"));
  await expect(f.refresh()).rejects.toThrow("fresh verification failed");
  expect(f.head(f.integration)).not.toBe(f.original);
  expect(f.git("rev-parse", "HEAD")).toBe(sibling);
  f.delivery.finish();
});

it("uncommitted guidance drift is refused before candidate integration", async () => {
  const f = await candidate();
  writeFileSync(join(f.root, "AGENTS.md"), "changed instructions");
  await expect(f.refresh()).rejects.toThrow("conflict");
  expect(f.head(f.integration)).toBe(f.original);
  expect(f.verify).not.toHaveBeenCalled();
  f.delivery.finish();
});

it.each(["external", "overlap", "guidance"])(
  "refuses %s changes and preserves the original candidate",
  async (kind) => {
    const f = await candidate();
    const head = f.advance(
      kind === "overlap"
        ? "a.txt"
        : kind === "guidance"
          ? "AGENTS.md"
          : "b.txt",
    );
    if (kind !== "external") f.delivery.advanceFrontier(f.base, head);
    await expect(f.refresh()).rejects.toThrow(
      kind === "external" ? "stale" : "conflict",
    );
    expect(f.verify).not.toHaveBeenCalled();
    expect(f.head(f.integration)).toBe(f.original);
    expect(f.git("rev-parse", "HEAD")).toBe(head);
    f.delivery.finish();
  },
);

it("verified project-knowledge updates may join a non-overlapping candidate", async () => {
  const f = await candidate();
  const sibling = f.advance(".cadence/project.md");
  f.delivery.advanceFrontier(f.base, sibling);
  await f.refresh();
  expect(f.verify).toHaveBeenCalledOnce();
  expect(f.delivery.candidateBase()).toBe(sibling);
  f.delivery.finish();
});
