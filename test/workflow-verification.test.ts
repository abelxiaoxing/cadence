import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { Workflows } from "../src/service/workflows.ts";
import { plan } from "./helpers/workflow-plan.ts";

const observation = vi.hoisted(() => ({
  value: "a".repeat(64),
  snapshotFiles: new Map<string, string | null>(),
}));
vi.mock("../src/service/workflow-git.ts", async (original) => ({
  ...(await original<typeof import("../src/service/workflow-git.ts")>()),
  sourceIdentityAsync: async () => observation.value,
  workingSnapshot: async () => ({
    git: true,
    paths: new Map(observation.snapshotFiles),
  }),
}));
it.each(["stable", "check-failed", "check-change", "review-change"])(
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
      runGate: async (
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
        return scenario !== "check-failed";
      },
      review: vi.fn(async () => {
        live.run.steps.push(review);
        if (scenario === "review-change") observation.value = "c".repeat(64);
        return { verdict: "approved", step: review };
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
      if (scenario === "check-failed")
        await expect(attempt).rejects.toThrow("Acceptance checks failed");
      else if (scenario === "check-change")
        await expect(attempt).rejects.toThrow("Checks changed");
      else
        await expect(attempt).rejects.toMatchObject({
          code: "stale",
          detail: expect.stringContaining("changed during readonly review"),
        });
      expect(live.run.verification).toBeUndefined();
      expect(records).toEqual([]);
      if (scenario !== "review-change")
        expect(owner.review).not.toHaveBeenCalled();
    }
  },
);

it("fail-fast runs fast checks before heavy checks, marks unstarted trailing checks not-run, and still runs waived checks", async () => {
  const ran: string[] = [];
  const p = plan();
  p.checks = [
    { name: "optical", command: "optical", tier: "heavy" },
    { name: "waived-lint", command: "lint", tier: "fast" },
    { name: "unit", command: "unit", tier: "fast" },
  ];
  const live = {
    abort: new AbortController(),
    run: {
      id: randomUUID(),
      epoch: randomUUID(),
      steps: [] as unknown[],
      deviations: [
        {
          revision: 1,
          item: "lint",
          reason: "waived",
          delivered: "alt",
          waives: ["waived-lint"],
        },
      ],
    },
  };
  const owner = Object.assign(Object.create(Workflows.prototype), {
    root: "/fixture",
    o: { secrets: () => [] },
    save() {},
    write() {},
    check: async (_live: unknown, _cwd: string, c: { name: string }) => {
      ran.push(c.name);
      const step = owner.step(live, c.name, "check");
      const failed = c.name === "waived-lint" || c.name === "unit";
      const result = {
        outcome: failed ? "failed" : "completed",
        closed: true,
        exitCode: failed ? 1 : 0,
        signal: null,
        durationMs: 1,
        text: "",
        output: failed ? `${c.name} failed` : "ok",
        truncated: false,
      };
      owner.finishStep(live, step, result);
      return { result, step };
    },
  });
  const observed: { id: string; status: string }[] = [];
  const waived = new Set<string>();
  const passed = await owner.checks(
    live,
    "/candidate",
    p,
    false,
    observed,
    waived,
  );
  expect(passed).toBe(false);
  // Fast tier ran before heavy; waived-lint ran and failed without stopping unit;
  // non-waived unit failure stopped early so heavy optical was marked not-run.
  expect(ran).toEqual(["waived-lint", "unit"]);
  expect(waived.size).toBe(1);
  expect(observed.map((s) => s.status)).toEqual([
    "failed",
    "failed",
    "not-run",
  ]);
});

it("syncBuild accepts edits inside declared outputs and refuses unauthorized edits outside outputs", async () => {
  const p = plan();
  p.build = [
    {
      name: "web",
      command: "bun run build:web",
      outputs: ["web/dist", "provenance/webui-reuse.json"],
    },
  ];
  const makeOwner = (mutatedPath: string) => {
    observation.snapshotFiles = new Map([["web/dist/app.js", "before"]]);
    const live = {
      abort: new AbortController(),
      delivered: new Set<string>(),
      run: { id: randomUUID(), epoch: randomUUID(), steps: [] as unknown[] },
    };
    const owner = Object.assign(Object.create(Workflows.prototype), {
      root: "/fixture",
      o: { secrets: () => [] },
      assertRunning() {},
      save() {},
      write() {},
      check: async (_live: unknown, _cwd: string, c: { name: string }) => {
        const step = owner.step(live, `build: ${c.name}`, "check");
        observation.snapshotFiles.set(mutatedPath, "after");
        const result = {
          outcome: "completed",
          closed: true,
          exitCode: 0,
          signal: null,
          durationMs: 1,
          text: "",
          output: "built",
          truncated: false,
        };
        owner.finishStep(live, step, result);
        return { result, step };
      },
    });
    return { live, owner };
  };
  const okCase = makeOwner("provenance/webui-reuse.json");
  await okCase.owner.syncBuild(okCase.live, "/candidate", { plan: p });
  expect(okCase.live.delivered.has("provenance/webui-reuse.json")).toBe(true);

  const badCase = makeOwner("LICENSE");
  await expect(
    badCase.owner.syncBuild(badCase.live, "/candidate", { plan: p }),
  ).rejects.toThrow(/modified files outside its declared outputs.*LICENSE/u);
});
