import { readFileSync } from "node:fs";
import { Value } from "typebox/value";
import { expect, it } from "vitest";
import { VERIFICATION_SCHEMA } from "../src/change-contract-schema.ts";
import { validateVerificationContract } from "../src/contracts.ts";
import { validateDesignControlRequest } from "../src/design-control.ts";

it.each([
  [0, false],
  [1, true],
  [8, true],
  [9, false],
  [32, false],
])("aligns schema and runtime for %i verification steps", (count, accepted) => {
  const verification = {
    kind: "steps",
    id: "suite",
    classification: "expected-green",
    steps: Array.from({ length: count }, (_, index) => ({
      kind: "static-check",
      id: `check-${index}`,
      classification: "expected-green",
      runner: { kind: "node", script: "test/check.mjs" },
      args: [],
    })),
  };
  expect(Value.Check(VERIFICATION_SCHEMA, verification)).toBe(accepted);
  expect(validateVerificationContract(verification).ok).toBe(accepted);
});

it.each([
  { count: 0, duplicate: false, accepted: false },
  { count: 1, duplicate: false, accepted: true },
  { count: 64, duplicate: false, accepted: true },
  { count: 65, duplicate: false, accepted: false },
  { count: 2, duplicate: true, accepted: false },
])(
  "aligns schema and runtime for Vitest file boundaries: $count files, duplicate=$duplicate",
  ({ count, duplicate, accepted }) => {
    const verification = {
      kind: "vitest",
      id: "suite",
      classification: "expected-green",
      runner: { kind: "local-binary", executable: "vitest" },
      testFiles: Array.from(
        { length: count },
        (_, index) => `test/check-${duplicate ? 0 : index}.test.ts`,
      ),
      args: [],
      minTests: 1,
    };
    expect(Value.Check(VERIFICATION_SCHEMA, verification)).toBe(accepted);
    expect(validateVerificationContract(verification).ok).toBe(accepted);
  },
);

it("points a Gate A value failure to its contract field without echoing rejected values", () => {
  const { changeContract } = JSON.parse(
    readFileSync(
      new URL("../config/plan-draft.example.json", import.meta.url),
      "utf8",
    ),
  );
  const request = {
    operation: "approve-gate",
    runId: "design-1",
    operationId: "gate-1",
    gate: "gate-a",
    contract: changeContract,
  };
  changeContract.policy.verificationModes = ["PRIVATE invalid value"];
  const failed = validateDesignControlRequest(request);
  expect(failed).toMatchObject({
    ok: false,
    code: "invalid-design-control-request",
    diagnostics: expect.arrayContaining([
      expect.objectContaining({ field: "contract.policy.verificationModes.0" }),
    ]),
  });
  expect(JSON.stringify(failed)).not.toContain("PRIVATE");
  changeContract.policy.verificationModes = ["behavior"];
  expect(validateDesignControlRequest(request)).toMatchObject({ ok: true });
  changeContract.acceptance[0].verification.runner.script = "../escape.mjs";
  expect(validateDesignControlRequest(request)).toMatchObject({
    ok: false,
    diagnostics: expect.arrayContaining([
      expect.objectContaining({ field: "contract.acceptance.0.verification" }),
    ]),
  });
});

it("never echoes dynamic verification binding keys through diagnostic field paths", () => {
  const { changeContract } = JSON.parse(
    readFileSync(
      new URL("../config/plan-draft.example.json", import.meta.url),
      "utf8",
    ),
  );
  changeContract.acceptance[0].verification.executionBindings = {
    "PRIVATE/a~1b": { invalid: true },
  };
  const result = validateDesignControlRequest({
    operation: "approve-gate",
    runId: "design-1",
    operationId: "gate-1",
    gate: "gate-a",
    contract: changeContract,
  });
  expect(result).toMatchObject({ ok: false });
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
});
