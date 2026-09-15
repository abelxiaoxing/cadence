import { expect, it } from "vitest";
import type { EngineTaskRow } from "../src/workflow-policy.ts";
import {
  projectWorkflowStatus,
  type WorkflowStatusFacts,
} from "../src/workflow-status.ts";

function task(
  taskId: string,
  order: number,
  overrides: Partial<EngineTaskRow> = {},
): EngineTaskRow {
  return Object.freeze({
    task_id: taskId,
    task_order: order,
    delivery_revision: 1,
    plan_json: "private-plan-not-for-status",
    state: "paused",
    phase: "green",
    pause_code: "needs-task-split",
    context_request_json: null,
    attempt_diagnostic_json: "untrusted-stored-diagnostic",
    route_id: null,
    route_fingerprint: null,
    queue_position: null,
    ...overrides,
  });
}

function facts(): WorkflowStatusFacts {
  return {
    projection: Object.freeze({
      runId: "run-status",
      rootHash: "a".repeat(64),
      stage: "abel-implement",
      change: "status-test",
      state: "paused",
      sequence: 1,
      eventHash: "b".repeat(64),
      deliveryRevision: 1,
      deliveryBindings: [],
    }),
    rows: Object.freeze([task("one", 1), task("two", 2)]),
    attemptDiagnostics: new Map(),
    failureSequences: new Map(),
    amendmentUsed: 0,
    resourceBudget: Object.freeze({
      used: 1,
      maximum: 30,
      phaseHighWater: 2,
      hardLimit: 512,
    }),
  };
}

it("projects repeatable complete batches without mutating facts or exposing raw storage", () => {
  const input = facts();
  const before = structuredClone(input);
  const first = projectWorkflowStatus(input);
  expect(projectWorkflowStatus(input)).toEqual(first);
  expect(input).toEqual(before);
  expect(first).toMatchObject({
    completed: false,
    blockers: [{ taskId: "one" }, { taskId: "two" }],
    decisionBatch: { items: [{ taskId: "one" }, { taskId: "two" }] },
    continuation: { automatic: true, owner: "parent", action: "amend" },
  });
  expect(JSON.stringify(first)).not.toMatch(/private-plan|untrusted-stored/);
});

it.each([
  "delivery-gate-a-hash-mismatch",
  "delivery-plan-binding-invalid",
  "delivery-finalization-proof-invalid",
  "delivery-verification-closure-invalid",
])(
  "does not turn an unproven or integrity-invalid delivery into amendment authority: %s",
  (diagnostic) => {
    const input = facts();
    const status = projectWorkflowStatus({
      ...input,
      projection: { ...input.projection, pauseCode: "delivery-invalid" },
      rows: [],
      engineRun: {
        current_revision: 1,
        baseline_workspace_revision: null,
        current_workspace_revision: null,
        cleanup_state: "retained",
        route_id: null,
        route_fingerprint: null,
        transaction_id: null,
        verification_json: null,
        delivery_diagnostics_json: JSON.stringify([diagnostic]),
        next_queue_position: 1,
      },
    });
    expect(status).not.toHaveProperty("continuation");
    expect(status).not.toHaveProperty("decisionBatch");
  },
);

it("preserves the decision identity while exhausted budgets remove automatic continuation", () => {
  const input = facts();
  const before = projectWorkflowStatus(input);
  const exhausted = projectWorkflowStatus({ ...input, amendmentUsed: 64 });
  expect(exhausted.decisionBatch).toEqual(before.decisionBatch);
  expect(exhausted).toMatchObject({
    completed: false,
    amendmentBudget: { exhausted: true, remaining: 0 },
  });
  expect(exhausted).not.toHaveProperty("continuation");
  const cancelled = projectWorkflowStatus({
    ...input,
    projection: { ...input.projection, pauseCode: "operation-cancelled" },
  });
  expect(cancelled).not.toHaveProperty("continuation");
  expect(cancelled).not.toHaveProperty("decisionBatch");
});

it("orders queue positions without reordering task facts", () => {
  const input = {
    ...facts(),
    rows: Object.freeze([
      task("later", 1, { state: "queued", queue_position: 4 }),
      task("first", 2, {
        state: "queued",
        queue_position: 2,
        pause_code: "worker-capacity",
      }),
    ]),
  };
  expect(projectWorkflowStatus(input)).toMatchObject({
    tasks: [{ taskId: "later" }, { taskId: "first" }],
    queue: [
      { taskId: "first", position: 1, reason: "capacity" },
      { taskId: "later", position: 2, reason: "conflict" },
    ],
  });
  expect(input.rows.map((row) => row.task_id)).toEqual(["later", "first"]);
});
