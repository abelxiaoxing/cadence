/** Real plan/receipt persistence and Git observations; no SDK, listener or worker. */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { canonicalJson } from "../src/service/contracts/core.ts";
import { decodeWorkflowProposal } from "../src/service/contracts/workflow.ts";
import { Workflows } from "../src/service/workflows.ts";
import { deliveryFixture } from "./helpers/delivery-fixture.ts";
import { fixtureRuntime } from "./helpers/worker-runtime.ts";
import { plan } from "./helpers/workflow-plan.ts";

afterEach(() => vi.restoreAllMocks());
function fixture() {
  const f = deliveryFixture();
  // Local identity in this fabricated repository only; no user/global config.
  f.git("config", "user.name", "Fixture");
  f.git("config", "user.email", "fixture@example.invalid");
  const lease = f.c.acquire({
    schema: "cadence-service-owner-config/1",
    endpoint: "http://127.0.0.1:31417",
    policyIdentity: "a".repeat(64),
  });
  const epoch = lease.registration.epoch;
  const version = {
    epoch,
    accessGeneration: 1,
    configRev: 1,
    catalogId: randomUUID(),
  };
  const execution = {
    cwd: f.root,
    checkoutRoot: f.root,
    version,
    model: {
      sourceSelectionId: randomUUID(),
      provider: "fixture",
      model: "fixture",
      api: "openai-completions",
      thinking: "off",
    },
  };
  const originals: Promise<unknown>[] = [];
  const options = {
    cwd: f.root,
    coordination: f.c,
    owner: {
      lease,
      state: "idle",
      trackConversation(p: Promise<unknown>) {
        originals.push(p);
      },
    },
    contexts: { capture: () => execution },
    models: {
      workerSettings: () => fixtureRuntime(),
      assertCurrent() {},
    },
    secrets: () => [],
  } as unknown as ConstructorParameters<typeof Workflows>[0];
  const workflows = new Workflows(options);
  const execute = vi
    .spyOn(
      Workflows.prototype as unknown as {
        execute(): Promise<{ status: "settled" }>;
      },
      "execute",
    )
    .mockResolvedValue({ status: "settled" });
  const definition = plan();
  definition.tasks = [definition.tasks[0]];
  const response = workflows.command(randomUUID(), epoch, {
    action: "propose",
    plan: definition,
    model: version,
  });
  if (response.kind !== "workflow" || response.response.type !== "proposal")
    throw new Error("proposal");
  const proposal = response.response.proposal;
  return {
    ...f,
    workflows,
    proposal,
    lease,
    epoch,
    execute,
    close: async () => {
      await Promise.all(originals);
      lease.release();
    },
  };
}
it("plan and grant create no Git resources, bind the complete target, and repeated execute observes one accepted run", {
  tags: ["slow"],
}, async () => {
  const f = fixture();
  try {
    expect(decodeWorkflowProposal(f.proposal)).toEqual(f.proposal);
    expect(f.proposal.delivery?.target).toMatchObject({
      branch: "refs/heads/main",
      head: f.base,
      repository: f.binding.target.repository,
    });
    expect(f.git("branch", "--list", "cadence/*")).toBe("");
    const prepared = f.workflows.command(randomUUID(), f.epoch, {
      action: "prepare",
      proposalId: f.proposal.id,
      digest: f.proposal.digest,
    });
    if (prepared.kind !== "workflow" || prepared.response.type !== "grant")
      throw new Error("grant");
    expect(
      f.git("worktree", "list", "--porcelain").match(/^worktree /gmu),
    ).toHaveLength(1);
    const id = randomUUID(),
      request = {
        action: "execute" as const,
        proposalId: f.proposal.id,
        digest: f.proposal.digest,
        grant: prepared.response.grant,
      };
    const a = f.workflows.command(id, f.epoch, request),
      b = f.workflows.command(id, f.epoch, request);
    expect(a).toEqual(b);
    if (a.kind !== "workflow" || a.response.type !== "run")
      throw new Error("run");
    expect(a.response.run.delivery?.taskBranch).toContain(id);
    expect(a.response.run.delivery?.binding).toEqual(f.proposal.delivery);
    expect(existsSync(a.response.run.delivery?.worktreeRoot ?? "")).toBe(false);
    await Promise.resolve();
    expect(f.execute).toHaveBeenCalledTimes(1);
  } finally {
    await f.close();
  }
});
it("changing the persisted delivery target cannot retain the old plan approval digest", async () => {
  const f = fixture();
  try {
    const path = join(
      f.c.directory,
      "workflows-v1",
      "proposals",
      `${f.proposal.id}.json`,
    );
    const saved = f.c.files.read(path);
    if (!saved || !f.proposal.delivery) throw new Error("fixture");
    const changed = structuredClone(f.proposal);
    if (!changed.delivery) throw new Error("fixture");
    changed.delivery.target.branch = "refs/heads/other";
    f.c.files.replace(path, saved, canonicalJson(changed));
    expect(() =>
      f.workflows.command(randomUUID(), f.epoch, {
        action: "prepare",
        proposalId: f.proposal.id,
        digest: f.proposal.digest,
      }),
    ).toThrow("stale");
    expect(f.git("branch", "--list", "cadence/*")).toBe("");
    expect(f.execute).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});
it("a retained agreement without named placement stays readable but cannot authorize a new delivery", async () => {
  const f = fixture();
  try {
    const path = join(
      f.c.directory,
      "workflows-v1",
      "proposals",
      `${f.proposal.id}.json`,
    );
    const saved = f.c.files.read(path);
    if (!saved) throw new Error("fixture");
    const old = structuredClone(f.proposal);
    delete old.delivery;
    f.c.files.replace(path, saved, canonicalJson(old));
    expect(f.workflows.proposal(old.id)).toEqual(old);
    expect(() =>
      f.workflows.command(randomUUID(), f.epoch, {
        action: "prepare",
        proposalId: old.id,
        digest: old.digest,
      }),
    ).toThrow("invalid");
    expect(f.git("branch", "--list", "cadence/*")).toBe("");
    expect(f.execute).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});
