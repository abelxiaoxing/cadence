import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { Workflows } from "../src/service/workflows.ts";
import { plan } from "./helpers/workflow-plan.ts";

const observation = vi.hoisted(() => ({ value: "a".repeat(64) }));
vi.mock("../src/service/workflow-git.ts", async (original) => ({
  ...(await original<typeof import("../src/service/workflow-git.ts")>()),
  sourceIdentityAsync: async () => observation.value,
}));
it.each(["stable", "check-change", "review-change"])(
  "verification binds actual source and step identities: %s",
  async (scenario) => {
    observation.value = "a".repeat(64);
    const records: unknown[] = [];
    const check = { id: "check-id", kind: "check", status: "completed" };
    const review = { id: "review-id", kind: "review", status: "completed" };
    const live = {
      abort: new AbortController(),
      run: {
        id: randomUUID(),
        epoch: randomUUID(),
        steps: [] as unknown[],
        verification: undefined as unknown,
      },
    };
    const proposal = { digest: "b".repeat(64), plan: plan() };
    const owner = Object.assign(Object.create(Workflows.prototype), {
      root: "/fixture",
      save() {},
      recoverStage: async (
        _live: unknown,
        _cwd: string,
        _p: unknown,
        _stage: string,
        work: () => Promise<void>,
      ) => work(),
      checks: async (
        _live: unknown,
        _cwd: string,
        _plan: unknown,
        _baseline: boolean,
        observed: unknown[],
      ) => {
        live.run.steps.push(check);
        observed.push(check);
        if (scenario === "check-change") observation.value = "c".repeat(64);
        return true;
      },
      review: vi.fn(async () => {
        live.run.steps.push(review);
        if (scenario === "review-change") observation.value = "c".repeat(64);
        return "approved";
      }),
      write: (_path: string, value: unknown) => records.push(value),
    });
    if (scenario === "stable") {
      await owner.verifyAndRepair(live, "/candidate", proposal, false);
      expect(live.run.verification).toMatchObject({
        source: "a".repeat(64),
        steps: [check.id, review.id],
      });
      expect(records[0]).toMatchObject({
        agreement: proposal.digest,
        cwd: "/candidate",
        source: "a".repeat(64),
        steps: [check.id, review.id],
      });
    } else {
      const attempt = owner.verifyAndRepair(
        live,
        "/candidate",
        proposal,
        false,
      );
      if (scenario === "check-change")
        await expect(attempt).rejects.toThrow("Checks changed");
      else
        await expect(attempt).rejects.toMatchObject({
          code: "stale",
          detail: expect.stringContaining("changed during readonly review"),
        });
      expect(live.run.verification).toBeUndefined();
      expect(records).toEqual([]);
      if (scenario === "check-change")
        expect(owner.review).not.toHaveBeenCalled();
    }
  },
);
