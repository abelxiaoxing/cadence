import { expect, it } from "vitest";
import { ImplementContinuationDriver } from "../src/implement-continuation.ts";
import type { SafeAttemptDiagnostic } from "../src/workflow-policy.ts";
import {
  projectWorkflowStatus,
  type WorkflowStatusFacts,
} from "../src/workflow-status.ts";

const cwd = "/workspace/retry-progress";
const change = "retry-progress";

function failureStatus(failures: number, identity = "a".repeat(64)) {
  const recovery: NonNullable<SafeAttemptDiagnostic["recovery"]> = {
    key: "c".repeat(64),
    failures,
    feedback: {
      code: "candidate-diff-invalid",
      attempt: failures + 1,
      maxAttempts: 2,
      strategy: "revise-candidate",
      failureIdentities: [identity],
    },
  };
  const facts: WorkflowStatusFacts = {
    projection: {
      runId: "retained-run",
      rootHash: "a".repeat(64),
      stage: "abel-implement",
      change,
      state: "paused",
      pauseCode: "candidate-diff-invalid",
      sequence: failures,
      eventHash: "b".repeat(64),
      deliveryRevision: 1,
      deliveryBindings: [],
    },
    rows: [
      {
        task_id: "T1",
        task_order: 1,
        delivery_revision: 1,
        plan_json: "private-plan",
        state: "paused",
        phase: "green",
        pause_code: "candidate-diff-invalid",
        context_request_json: null,
        attempt_diagnostic_json: null,
        route_id: null,
        route_fingerprint: null,
        queue_position: null,
      },
    ],
    attemptDiagnostics: new Map([["T1", { recovery }]]),
    failureSequences: new Map([[recovery.key, failures * 2]]),
    amendmentUsed: failures,
    resourceBudget: {
      used: failures,
      maximum: 30,
      phaseHighWater: 2,
      hardLimit: 512,
    },
  };
  return projectWorkflowStatus(facts);
}

function driverFixture() {
  const driver = new ImplementContinuationDriver();
  driver.activate({ cwd, change });
  return {
    driver,
    settle(value: Record<string, unknown>) {
      const probe = driver.prepareSettlement({
        cwd,
        messages: [{ role: "assistant", stopReason: "stop" }],
      });
      return driver.finishSettlement(probe!, value);
    },
  };
}

it.each([false, true])(
  "ignores real projected retry bookkeeping, including control results: %s",
  (withResults) => {
    const { driver, settle } = driverFixture();
    const before = failureStatus(2);
    const after = failureStatus(3);
    expect(before.decisionBatch).not.toEqual(after.decisionBatch);
    expect(before.recovery).not.toEqual(after.recovery);
    const unchanged = structuredClone(before);
    const initial = settle(before);
    expect(initial?.kind).toBe("continue");
    expect(before).toEqual(unchanged);
    for (let failures = 3; failures <= 6; failures++) {
      const next = failureStatus(failures);
      if (withResults) {
        driver.noteToolResult({
          input: {
            command: "resume",
            stage: "abel-implement",
            change,
            operationId: `retry-${failures}`,
            recovery: (next.recovery as { additionalAttempt: unknown })
              .additionalAttempt,
          },
          details: next,
          isError: false,
        });
      }
      const result = settle(next);
      expect(result?.kind).toBe(failures === 3 ? "stalled" : undefined);
      if (result?.kind === "stalled" && initial?.kind === "continue")
        expect(result.statusFingerprint).toBe(initial.statusFingerprint);
    }
  },
);

it("preserves changed failure evidence, route observations, and delivery identity as progress", () => {
  const { settle } = driverFixture();
  expect(settle(failureStatus(2))?.kind).toBe("continue");
  expect(settle(failureStatus(3))?.kind).toBe("stalled");
  const changed = failureStatus(4, "d".repeat(64));
  expect(settle(changed)?.kind).toBe("continue");
  const rebound = {
    ...changed,
    routeBinding: { routeId: "fallback", routeFingerprint: "e".repeat(64) },
  };
  expect(settle(rebound)?.kind).toBe("continue");
  expect(settle({ ...rebound, deliveryRevision: 2 })?.kind).toBe("continue");
});

it("does not count identical successful artifact writes under refreshed recovery batches", () => {
  const { driver, settle } = driverFixture();
  const write = (failures: number, content: string) => {
    const current = failureStatus(failures);
    driver.noteToolResult({
      input: {
        action: "amend",
        change,
        batchId: (current.decisionBatch as { id: string }).id,
        request: {
          operation: "write-artifact",
          runId: "amendment-run",
          operationId: `write-${failures}`,
          path: "plan-draft.json",
          content,
        },
      },
      details: { scope: "amendment", state: "draft" },
      isError: false,
    });
    return settle(current);
  };
  expect(write(2, "original bytes")?.kind).toBe("continue");
  expect(write(3, "original bytes")?.kind).toBe("stalled");
  expect(write(4, "corrected bytes")?.kind).toBe("continue");
});
