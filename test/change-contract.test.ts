import { expect, it } from "vitest";
import {
  assertPlanWithinChangeContract,
  normalizeChangeContract,
  verificationObligation,
} from "../src/change-contract.ts";
import { decideRecoveryAction } from "../src/workflow-policy.ts";

const check = {
  kind: "static-check" as const,
  id: "accepted",
  runner: { kind: "node" as const, script: "scripts/check.mjs" },
  args: [],
  classification: "expected-green" as const,
};
const approved = () =>
  normalizeChangeContract({
    goal: "Preserve public behavior",
    acceptance: [
      {
        id: "A1",
        statement: "Existing contract stays green",
        verification: check,
      },
    ],
    constraints: [{ id: "C1", statement: "No runtime dependency" }],
    policy: {
      writeRoots: ["src", "test"],
      dependencies: [],
      verificationModes: ["behavior", "mechanical", "refactor"],
    },
  });
const task = () =>
  ({
    phases: {
      green: { write: ["src/helper.ts"], delete: [], verification: check },
    },
    approvedDependencies: [],
    affectedVerification: check,
    repairVerification: check,
  }) as unknown as Parameters<typeof assertPlanWithinChangeContract>[1][number];

it("allows task decomposition and verifier display renaming without changing accepted evidence", () => {
  const renamed = { ...check, id: "renamed" };
  expect(verificationObligation(check)).toBe(verificationObligation(renamed));
  expect(() =>
    assertPlanWithinChangeContract(approved(), [task(), task()], [renamed]),
  ).not.toThrow();
});

it("rejects path expansion, new dependencies and missing acceptance despite a technical label", () => {
  const outside = task();
  outside.phases.green.write = ["secrets/value"];
  expect(() =>
    assertPlanWithinChangeContract(approved(), [outside], [check]),
  ).toThrow("write-outside-policy");
  const dependency = task();
  dependency.approvedDependencies = ["new-runtime"];
  expect(() =>
    assertPlanWithinChangeContract(approved(), [dependency], [check]),
  ).toThrow("dependency-outside-policy");
  const agents = {
    ...task(),
    agents: {
      impact: "update-existing" as const,
      target: "AGENTS.md",
      managedOnly: true as const,
    },
  };
  expect(() =>
    assertPlanWithinChangeContract(approved(), [agents], [check]),
  ).toThrow("agents-outside-policy");
  const withAgents = approved();
  withAgents.policy.writeRoots.push("AGENTS.md");
  expect(() =>
    assertPlanWithinChangeContract(withAgents, [agents], [check]),
  ).not.toThrow();
  expect(() =>
    assertPlanWithinChangeContract(
      approved(),
      [],
      [{ ...check, args: ["--skip"] }],
    ),
  ).toThrow("acceptance-missing");
});

it("rejects duplicated acceptance IDs and escaping policy roots", () => {
  const contract = approved();
  contract.acceptance.push(contract.acceptance[0]);
  expect(() => normalizeChangeContract(contract)).toThrow(
    "change-contract-invalid",
  );
  const escaping = approved();
  escaping.policy.writeRoots = ["../host"];
  expect(() => normalizeChangeContract(escaping)).toThrow(
    "change-contract-invalid",
  );
});

it("does not use nonbehavioral modes to bypass behavior or verifier protections", () => {
  const mechanical = { ...task(), verificationMode: "mechanical" as const };
  expect(() =>
    assertPlanWithinChangeContract(approved(), [mechanical], [check]),
  ).toThrow("mechanical-path");
  const refactor = { ...task(), verificationMode: "refactor" as const };
  refactor.phases.green.write = ["scripts/check.mjs"];
  expect(() =>
    assertPlanWithinChangeContract(approved(), [refactor], [check]),
  ).toThrow("refactor-verification-mutation");
});

it("uses one recovery decision policy for nested repairs and explicit one-attempt grants", () => {
  const plan = {
    verification: {
      repair: { maxAttempts: 2 },
      artifactCorrection: { maxAttempts: 3 },
    },
  } as Parameters<typeof decideRecoveryAction>[0];
  for (const kind of [
    "affected-repair",
    "cumulative-repair",
    "red-correction",
  ] as const) {
    expect(
      decideRecoveryAction(
        plan,
        { kind, attempt: 1 },
        { additionalAttempt: true },
      ),
    ).toEqual({ allowed: true });
    expect(
      decideRecoveryAction(
        plan,
        { kind, attempt: 2 },
        { additionalAttempt: true },
      ),
    ).toMatchObject({ allowed: false });
    expect(decideRecoveryAction(plan, { kind, attempt: 0 })).toMatchObject({
      allowed: false,
    });
  }
});
