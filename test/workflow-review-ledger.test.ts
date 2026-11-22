import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { AttemptFailure } from "../src/service/workflow-controller.ts";
import { reviewReport, reviewVerdict } from "../src/service/workflow-report.ts";
import { ReviewLedger } from "../src/service/workflow-review-ledger.ts";
import { Workflows } from "../src/service/workflows.ts";
import { stagedPlan as plan } from "./helpers/workflow-plan.ts";

const issue = (
  id: string,
  overrides: Partial<{
    source: string;
    family: string;
    familySummary: string;
    evidence: string;
    verify: string;
    writes: string[];
  }> = {},
) => ({
  id,
  evidence: `${id} evidence`,
  verify: `${id} verify`,
  writes: ["src/a.ts"],
  ...overrides,
});

it("ReviewLedger counts once per family per round, resists slug renaming, and requires targeted repair before incrementing", () => {
  const ledger = new ReviewLedger();
  // Round 1: initial finding allocates F01 (unresolvedAfterRepair starts at 0).
  const r1 = ledger.recordReview({
    approved: false,
    blockers: [
      issue("first-slug", {
        source: "AC-3",
        family: "new",
        familySummary: "Modal dismiss breaks background focus",
      }),
    ],
    candidate: "1".repeat(40),
    reviewStep: "review-1",
  });
  expect(r1.createdFamilies).toEqual(["F01"]);
  expect(r1.hitFamilies).toEqual(["F01"]);
  expect(r1.escalateFamilies).toEqual([]);
  expect(ledger.snapshot().families[0].unresolvedAfterRepair).toBe(0);

  // Unrepaired round (e.g. skipped repair / build failed before repair): does NOT increment.
  const rUnrepaired = ledger.recordReview({
    approved: false,
    blockers: [issue("same-slug-no-repair", { source: "AC-3", family: "F01" })],
    candidate: "1".repeat(40),
    reviewStep: "review-1b",
  });
  expect(ledger.snapshot().families[0].unresolvedAfterRepair).toBe(0);
  expect(rUnrepaired.escalateFamilies).toEqual([]);

  // Targeted repair #1 runs, then independent review finds 5 counterexamples
  // with renamed slugs under the SAME family F01 -> counts ONCE (unresolvedAfterRepair = 1).
  ledger.markRepaired(["F01"]);
  const r2 = ledger.recordReview({
    approved: false,
    blockers: [
      issue("renamed-slug-1", { source: "AC-3", family: "F01" }),
      issue("renamed-slug-2", { source: "AC-3", family: "F01" }),
      issue("renamed-slug-3", { source: "AC-3", family: "F01" }),
      issue("renamed-slug-4", { source: "AC-3", family: "F01" }),
      issue("renamed-slug-5", { source: "AC-3", family: "F01" }),
    ],
    candidate: "2".repeat(40),
    reviewStep: "review-2",
  });
  expect(r2.hitFamilies).toEqual(["F01"]);
  expect(r2.escalateFamilies).toEqual([]);
  expect(ledger.snapshot().families[0].unresolvedAfterRepair).toBe(1);

  // Targeted repair #2 runs, then independent review STILL fails F01 under yet
  // another slug -> unresolvedAfterRepair = 2 -> escalates to architectural replan.
  ledger.markRepaired(["F01"]);
  const r3 = ledger.recordReview({
    approved: false,
    blockers: [
      issue("totally-different-slug", { source: "AC-3", family: "F01" }),
    ],
    candidate: "3".repeat(40),
    reviewStep: "review-3",
  });
  expect(ledger.snapshot().families[0].unresolvedAfterRepair).toBe(2);
  expect(r3.escalateFamilies).toEqual(["F01"]);
  expect(r3.exhaustedFamilies).toEqual([]);
});

it("ReviewLedger never silently closes omitted open families and escalates immediately on reopen", () => {
  const ledger = new ReviewLedger();
  ledger.recordReview({
    approved: false,
    blockers: [
      issue("a", {
        source: "AC-1",
        family: "new",
        familySummary: "Behavior A",
      }),
      issue("b", {
        source: "AC-2",
        family: "new",
        familySummary: "Behavior B",
      }),
    ],
    candidate: "1".repeat(40),
    reviewStep: "review-1",
  });

  // Reviewer rejects with only F02 and omits F01 (without closedFamilies): F01 stays open!
  ledger.markRepaired(["F01", "F02"]);
  ledger.recordReview({
    approved: false,
    blockers: [issue("b-again", { source: "AC-2", family: "F02" })],
    candidate: "2".repeat(40),
    reviewStep: "review-2",
  });
  const afterOmit = ledger.snapshot().families;
  expect(afterOmit.find((f) => f.id === "F01")?.status).toBe("open");
  expect(afterOmit.find((f) => f.id === "F02")?.status).toBe("open");

  // Explicit closedFamilies transitions F01 to verified.
  ledger.markRepaired(["F02"]);
  ledger.recordReview({
    approved: false,
    blockers: [issue("b-3", { source: "AC-2", family: "F02" })],
    closedFamilies: ["F01"],
    candidate: "3".repeat(40),
    reviewStep: "review-3",
  });
  expect(ledger.snapshot().families.find((f) => f.id === "F01")?.status).toBe(
    "verified",
  );

  // Re-appearance of F01 transitions it to reopened and immediately escalates.
  const reopened = ledger.recordReview({
    approved: false,
    blockers: [issue("a-regressed", { source: "AC-1", family: "F01" })],
    candidate: "4".repeat(40),
    reviewStep: "review-4",
  });
  expect(ledger.snapshot().families.find((f) => f.id === "F01")?.status).toBe(
    "reopened",
  );
  expect(reopened.escalateFamilies).toEqual(["F01"]);
});

it("ReviewLedger flags classification audit under repeated new allocations for one source and marks 2-route replan exhaustion", () => {
  const ledger = new ReviewLedger();
  const r1 = ledger.recordReview({
    approved: false,
    blockers: [
      issue("c1", { source: "AC-4", family: "new", familySummary: "Case 1" }),
      issue("c2", { source: "AC-4", family: "new", familySummary: "Case 2" }),
      issue("c3", { source: "AC-4", family: "new", familySummary: "Case 3" }),
    ],
    candidate: "1".repeat(40),
    reviewStep: "review-1",
  });
  // Never auto-merged or dropped: all 3 remain tracked AND AC-4 triggers audit.
  expect(r1.createdFamilies).toEqual(["F01", "F02", "F03"]);
  expect(r1.auditSources).toEqual(["AC-4"]);
  expect(ledger.briefForReview([])).toContain("Classification audit required");
  expect(ledger.briefForReview([])).toContain("AC-4");

  // Two distinct architectural replan routes on F01 both fail -> exhaustedFamilies.
  ledger.markRepaired(["F01"], true);
  ledger.recordReview({
    approved: false,
    blockers: [issue("c1-r2", { source: "AC-4", family: "F01" })],
    candidate: "2".repeat(40),
    reviewStep: "review-2",
  });
  ledger.markRepaired(["F01"], true);
  const r3 = ledger.recordReview({
    approved: false,
    blockers: [issue("c1-r3", { source: "AC-4", family: "F01" })],
    candidate: "3".repeat(40),
    reviewStep: "review-3",
  });
  expect(r3.exhaustedFamilies).toEqual(["F01"]);
  const replanBrief = ledger.briefForReplan(["F01"], ["src/ui.tsx (4x)"], []);
  expect(replanBrief).toContain(
    "Two genuinely distinct architectural replan routes",
  );
  expect(replanBrief).toContain("src/ui.tsx (4x)");

  // Unrelated acceptance source in a later round is NOT poisoned by AC-4's open audit flag.
  const rUnrelated = ledger.recordReview({
    approved: false,
    blockers: [
      issue("other-ac", {
        source: "AC-9",
        family: "new",
        familySummary: "Unrelated AC-9 issue",
      }),
    ],
    candidate: "4".repeat(40),
    reviewStep: "review-4",
  });
  expect(rUnrelated.auditSources).toEqual([]);

  // Closing all families under AC-4 prunes AC-4 from active auditSources.
  ledger.recordReview({
    approved: false,
    blockers: [issue("other-ac-2", { source: "AC-9", family: "F04" })],
    closedFamilies: ["F01", "F02", "F03"],
    candidate: "5".repeat(40),
    reviewStep: "review-5",
  });
  expect(ledger.snapshot().auditSources).toEqual([]);
});

it("reviewVerdict and reviewReport support V4 structured fields, keep legacy 4-field issues, and refuse invalid or secret-tainted selectors", () => {
  const v4 = reviewVerdict(
    JSON.stringify({
      approved: false,
      summary: "Needs focus fix",
      blockingIssues: [
        issue("focus-trap", {
          source: "AC-2",
          family: "new",
          familySummary: "Dialog loses focus on Escape",
          writes: ["src/untouched.ts"],
        }),
      ],
      closedFamilies: ["F01"],
      pendingBrowser: ["Confirm modal focus ring in Chromium"],
    }),
  );
  expect(v4).toMatchObject({
    approved: false,
    closedFamilies: ["F01"],
    pendingBrowser: ["Confirm modal focus ring in Chromium"],
  });
  expect(
    (v4?.blockingIssues[0] as { family?: string } | undefined)?.family,
  ).toBe("new");

  // Legacy 4-field issue remains valid.
  const legacy = reviewVerdict(
    JSON.stringify({
      approved: false,
      summary: "Legacy",
      blockingIssues: [issue("legacy-id")],
    }),
  );
  expect(legacy?.approved).toBe(false);
  expect(legacy?.blockingIssues).toHaveLength(1);

  // Unknown key, invalid family ref, and "new" inside closedFamilies are rejected.
  expect(
    reviewVerdict(
      JSON.stringify({
        approved: false,
        summary: "bad",
        blockingIssues: [{ ...issue("x"), extra: 1 }],
      }),
    ),
  ).toBeNull();
  expect(
    reviewVerdict(
      JSON.stringify({
        approved: false,
        summary: "bad",
        blockingIssues: [issue("x", { family: "bad-ref" })],
      }),
    ),
  ).toBeNull();
  expect(
    reviewVerdict(
      JSON.stringify({
        approved: false,
        summary: "bad",
        blockingIssues: [],
        closedFamilies: ["new"],
      }),
    ),
  ).toBeNull();

  // Secret inside writes demotes structured issue to sanitized text (never an editing target).
  const secret = "sk-secret-token-value";
  const sanitized = reviewReport(
    JSON.stringify({
      approved: false,
      summary: `Saw ${secret}`,
      blockingIssues: [
        issue("leak-check", {
          family: "F01",
          writes: [`src/${secret}.ts`],
          evidence: `Failed with ${secret}`,
        }),
      ],
    }),
    [secret],
  );
  expect(sanitized.text).not.toContain(secret);
  const parsed = JSON.parse(sanitized.text);
  expect(typeof parsed.blockingIssues[0]).toBe("string");
});

it("Stage 4 runs fast checks and code pre-review before heavy checks and passes pendingBrowser forward", async () => {
  const order: string[] = [];
  const p = plan();
  p.delivery = "working-copy";
  p.checks = [
    { name: "unit", command: "bun test", tier: "fast" },
    { name: "browser", command: "bun run e2e", tier: "heavy" },
  ];
  const live = {
    abort: new AbortController(),
    delivered: new Set<string>(),
    notes: [] as string[],
    run: {
      id: randomUUID(),
      epoch: randomUUID(),
      steps: [] as unknown[],
      phase: "starting",
    },
  };
  const proposal = { digest: "b".repeat(64), plan: p };
  const owner = Object.assign(Object.create(Workflows.prototype), {
    cwd: "/fixture",
    save() {},
    setup: async () => {},
    runGate: async (
      _live: unknown,
      _cwd: string,
      _p: unknown,
      stage: string,
      work: () => Promise<void>,
    ) => {
      order.push(`gate:${stage}`);
      await work();
    },
    checks: async () => true,
    assignments: async () => {
      order.push("assignments");
    },
    learn: async () => {
      order.push("learn");
    },
    writePrivateReport: () => {
      order.push("private-report");
    },
    verifyAndRepair: async (
      _live: unknown,
      _cwd: string,
      _p: unknown,
      _git: boolean,
      _docs: string[],
      opts?: { tiers?: readonly string[]; preReview?: boolean },
    ) => {
      order.push(
        opts?.preReview
          ? `pre-review:${(opts.tiers ?? []).join(",")}`
          : "final-verify:all",
      );
    },
  });
  await owner.implement(live, proposal);
  expect(order).toEqual([
    "gate:baseline",
    "assignments",
    "pre-review:fast",
    "learn",
    "final-verify:all",
    "private-report",
  ]);
});

it("settleAttempt allows check timeout recovery ONLY when POSIX process group is confirmed settled", async () => {
  const runId = randomUUID();
  const makeStep = (id: string) => ({
    id,
    kind: "check",
    status: "timeout",
    exitCode: null,
    text: "timed out",
  });
  const makeOwner = (stepId: string, settled: boolean) => {
    const step = makeStep(stepId);
    const live = {
      abort: new AbortController(),
      groupSettled: new Map([[stepId, settled]]),
      run: { id: runId, steps: [step] },
    };
    const owner = Object.assign(Object.create(Workflows.prototype), {
      o: {
        owner: { state: "idle" },
        coordination: { files: { read: () => null } },
        secrets: () => [],
      },
      path: (_id: string, rel: string) => `/tmp/${rel}`,
      findStep: (_run: unknown, id: string) =>
        id === stepId ? step : undefined,
    });
    return { owner, live, step };
  };

  // Unsettled process group -> timeout propagates directly (no AttemptFailure / no retry).
  const unsettled = makeOwner("check-unsettled", false);
  const timeoutErr = Object.assign(new Error("Operation timeout"), {
    outcome: "timeout",
    step: "check-unsettled",
  });
  // Trigger real WorkflowFailure by calling owner.success with timeout RunResult.
  const settledCase = makeOwner("check-settled", true);
  await expect(
    unsettled.owner.settleAttempt(unsettled.live, "verification", async () => {
      unsettled.owner.o.secrets = () => [];
      unsettled.owner.success(
        {
          outcome: "timeout",
          closed: true,
          exitCode: null,
          signal: "SIGKILL",
          durationMs: 1000,
          text: "timeout",
          output: "hung",
          truncated: false,
        },
        unsettled.step,
      );
    }),
  ).rejects.toMatchObject({ outcome: "timeout" });

  // Confirmed ESRCH settled process group -> translates to AttemptFailure with floor "replan".
  let caught: unknown;
  try {
    settledCase.owner.o.secrets = () => [];
    await settledCase.owner.settleAttempt(
      settledCase.live,
      "verification",
      async () => {
        settledCase.owner.success(
          {
            outcome: "timeout",
            closed: true,
            exitCode: null,
            signal: "SIGKILL",
            durationMs: 1000,
            text: "timeout",
            output: "hung",
            truncated: false,
          },
          settledCase.step,
        );
      },
    );
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(AttemptFailure);
  expect((caught as AttemptFailure).escalateTo).toBe("replan");
  expect(timeoutErr).toBeDefined();
});
