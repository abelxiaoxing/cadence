import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { CheckoutGate } from "../src/service/checkout-gate.ts";
import { assertTarget } from "../src/service/workflow-git.ts";
import { Workflows } from "../src/service/workflows.ts";
import { plan } from "./helpers/workflow-plan.ts";

vi.mock("../src/service/workflow-git.ts", async (original) => ({
  ...(await original<typeof import("../src/service/workflow-git.ts")>()),
  assertWorktree: async () => {},
  assertWorkflowScope: async () => [],
  assertTarget: vi.fn(async () => {}),
  gitHead: async () => "candidate",
  committedPaths: async () => ["a.txt"],
}));

// Orchestrator ordering only: no SDK, Git execution or check success is inferred.
it.each(["passed", "failed", "canceled", "guidance-changed", "branch-changed"])(
  "integration holds exclusive access and advances siblings only after passed post-merge checks: %s",
  async (outcome) => {
    vi.mocked(assertTarget).mockReset();
    vi.mocked(assertTarget).mockImplementation(async (_cwd, expected) => {
      if (outcome === "branch-changed" && expected.head === "candidate")
        throw Error("branch changed");
    });
    const owner = { state: "idle" as const, lease: { assert() {} } };
    const gate = new CheckoutGate(owner);
    const approved = plan();
    approved.tasks = [approved.tasks[0]];
    const target = { head: "base", branch: "refs/heads/main" };
    const live = {
      run: { id: randomUUID(), steps: [], phase: "implementing" },
      abort: new AbortController(),
      target,
      frontier: "base",
      delivered: new Set<string>(),
      notes: [],
      barrier: undefined,
    };
    const siblings = [
      { target, frontier: "base" },
      { target, frontier: "external" },
      { target: { ...target, branch: "refs/heads/other" }, frontier: "base" },
    ];
    const checkpoints: string[] = [];
    const workflows = Object.assign(Object.create(Workflows.prototype), {
      cwd: "/checkout",
      o: { owner, gate, secrets: () => [] },
      active: new Map([
        [live.run.id, live],
        ...siblings.map((s) => [randomUUID(), s] as const),
      ]),
      assertRunning() {
        if (live.abort.signal.aborted) throw Error("canceled");
      },
      save() {},
      assertGuidance() {
        if (outcome === "guidance-changed") throw Error("guidance changed");
      },
      worktreeHome: () => "/isolated",
      setup: async () => {},
      unchangedHead: async () => {},
      commit: async () => null,
      gitStep: async () => {},
      documents: () => [],
      publish() {},
      implementation: async () => {
        gate.assertQuiescent();
        checkpoints.push("isolated implementation");
      },
      verifyAndRepair: async () => {
        gate.assertQuiescent();
        checkpoints.push("isolated verification");
      },
      refreshCandidate: async () => {
        expect(() => gate.assertQuiescent()).toThrow("conflict");
        checkpoints.push("exclusive refresh");
      },
      checks: async (_live: unknown, cwd: string) => {
        if (cwd !== "/checkout") return true;
        expect(() => gate.assertQuiescent()).toThrow("conflict");
        checkpoints.push("exclusive post-merge checks");
        if (outcome === "canceled") live.abort.abort();
        return outcome !== "failed";
      },
      merge: async () => {
        expect(() => gate.assertQuiescent()).toThrow("conflict");
        checkpoints.push("exclusive merge");
      },
      removeWorktrees: async () => {
        expect(() => gate.assertQuiescent()).toThrow("conflict");
      },
    });
    const result = workflows.implement(live, { plan: approved, model: {} });
    if (outcome === "passed") await result;
    else
      await expect(result).rejects.toThrow(
        outcome === "failed"
          ? "post-merge checks failed"
          : outcome === "guidance-changed"
            ? "guidance changed"
            : outcome === "branch-changed"
              ? "branch changed"
              : "canceled",
      );
    expect(checkpoints).toEqual([
      "isolated implementation",
      "isolated verification",
      "exclusive refresh",
      ...(outcome === "guidance-changed"
        ? []
        : ["exclusive merge", "exclusive post-merge checks"]),
    ]);
    expect(siblings.map((s) => s.frontier)).toEqual([
      outcome === "passed" ? "candidate" : "base",
      "external",
      "base",
    ]);
    // implement never releases on a reporting result; execute owns final settlement.
    expect(() => gate.assertQuiescent()).toThrow("conflict");
    (live.barrier as unknown as { release(): void }).release();
    gate.assertQuiescent();
  },
);
