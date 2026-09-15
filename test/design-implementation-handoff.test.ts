import { expect, it } from "vitest";
import { planAuthoringSummary } from "../src/plan-draft-summary.ts";
import { verificationFixturePlan } from "./helpers/verification-plan.ts";

it("exposes the accepted recovery envelope before Design hands execution to Implement", () => {
  const { plan } = verificationFixturePlan("handoff");
  plan.changeContract = {
    goal: "Repair the regression",
    acceptance: [
      {
        id: "regression",
        statement: "The regression passes",
        verification: plan.verification.change.fullSuite,
      },
    ],
    constraints: [
      { id: "compatibility", statement: "Preserve the public API" },
    ],
    policy: {
      writeRoots: ["src", "test", "AGENTS.md"],
      dependencies: ["existing-library"],
      verificationModes: ["behavior"],
    },
  };
  const before = structuredClone(plan);
  expect(planAuthoringSummary(plan)).toMatchObject({
    implementation: {
      authority: "review-only",
      decisionOwner: "parent",
      userDecisionStage: "abel-design",
      policySource: "structured-change-contract",
      acceptanceIds: ["regression"],
      constraintIds: ["compatibility"],
      amendmentPolicy: {
        writeRoots: ["src", "test", "AGENTS.md"],
        dependencies: ["existing-library"],
        verificationModes: ["behavior"],
      },
      recovery: {
        strategy: "repair-replan-resume",
        preservesAcceptance: true,
        preservesConsumedBudget: true,
      },
      runtimePrerequisites: "not-assessed",
    },
  });
  expect(plan).toEqual(before);
});

it("does not invent an amendment policy for a historical plan", () => {
  const { plan } = verificationFixturePlan("legacy-handoff");
  const summary = planAuthoringSummary(plan);
  expect(summary).toMatchObject({
    implementation: {
      policySource: "retained-legacy-boundaries",
      amendmentPolicy: null,
      acceptanceIds: [],
      constraintIds: [],
    },
  });
});

it("bounds policy projection while retaining the workspace-root permission", () => {
  const { plan } = verificationFixturePlan("bounded-handoff");
  plan.changeContract = {
    goal: "Repair regressions",
    acceptance: Array.from({ length: 40 }, (_, i) => ({
      id: `acceptance-${i}`,
      statement: "Preserve coverage",
      verification: plan.verification.change.fullSuite,
    })),
    constraints: [],
    policy: {
      writeRoots: [
        ".",
        ...Array.from({ length: 40 }, (_, i) => `src/module-${i}`),
      ],
      dependencies: [],
      verificationModes: ["behavior"],
    },
  };
  const summary = planAuthoringSummary(plan);
  expect(summary.implementation.acceptanceIds).toHaveLength(32);
  expect(summary.implementation.amendmentPolicy?.writeRoots).toHaveLength(32);
  expect(summary.implementation.amendmentPolicy?.writeRoots[0]).toBe(".");
  expect(summary.truncated).toBe(true);
});
