import assert from "node:assert/strict";
import { it } from "vitest";
import {
  AttemptFailure,
  DeliveryController,
  decodeRecoveryDecision,
  InvalidDecision,
} from "../src/service/workflow-controller.ts";

const step = "implementation-fixture-1234";
const bounds = { scope: ["src"], evidence: [step], floor: "repair", checks: [] };
const decision = (evidence) =>
  JSON.stringify({
    action: "continue",
    cause: "A settled capture failure left partial work",
    evidence,
    strategy: "Preserve existing output and finish missing behavior",
    work: [
      {
        title: "Finish",
        instructions: "Edit only missing behavior",
        writes: ["src"],
      },
    ],
  });
const message = /evidence.*exact failed step IDs.*cause.*strategy/u;

it("invalid evidence names the field instead of misreporting valid JSON as malformed", () => {
  for (const evidence of [
    [`${step}: ${"诊断说明".repeat(80)}`],
    [`${step}: failed`],
    ["other-step"],
    [],
    null,
    step,
    [null],
    Array(33).fill(step),
  ]) {
    assert.throws(
      () => decodeRecoveryDecision(decision(evidence), bounds),
      (error) => {
        assert.ok(error instanceof InvalidDecision);
        assert.match(error.message, message);
        assert.ok(!error.message.includes("诊断说明"));
        return true;
      },
    );
  }
  assert.deepEqual(decodeRecoveryDecision(decision([step]), bounds).evidence, [
    step,
  ]);
});

it("the controller sends an actionable objection before admitting only the corrected decision", async () => {
  const objections = [];
  const records = [];
  const writes = [];
  let diagnoses = 0,
    attempts = 0;
  const controller = new DeliveryController({
    assertRunning() {},
    observe: async () => "source",
    diagnose: async (_failure, _previous, _floor, objection) => {
      objections.push(objection);
      return decodeRecoveryDecision(
        decision(
          ++diagnoses === 1 ? [`${step}: ${"detail ".repeat(40)}`] : [step],
        ),
        bounds,
      );
    },
    record: (record) => records.push(record),
    execute: async (work) => writes.push(work),
  });
  await controller.complete("implementation", async () => {
    if (++attempts === 1) throw new AttemptFailure("capture failure", [step]);
  });
  assert.equal(diagnoses, 2);
  assert.equal(objections[0], undefined);
  assert.match(objections[1], message);
  assert.equal(records.length, 1);
  assert.deepEqual(records[0].decision.evidence, [step]);
  assert.equal(writes.length, 1);
});
