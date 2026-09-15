import { expect, it } from "vitest";
import type {
  EngineTaskRow,
  SafeAttemptDiagnostic,
  WorkflowVerificationPrerequisite,
} from "../src/workflow-policy.ts";
import {
  projectWorkflowStatus,
  type WorkflowStatusFacts,
} from "../src/workflow-status.ts";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

function task(
  pauseCode: string,
  overrides: Partial<EngineTaskRow> = {},
): EngineTaskRow {
  return {
    task_id: "T1",
    task_order: 1,
    delivery_revision: 1,
    plan_json: "private-plan",
    state: "paused",
    phase: "green",
    pause_code: pauseCode,
    context_request_json: null,
    attempt_diagnostic_json: null,
    route_id: null,
    route_fingerprint: null,
    queue_position: null,
    ...overrides,
  };
}

function facts(
  row: EngineTaskRow,
  diagnostic?: SafeAttemptDiagnostic,
): WorkflowStatusFacts {
  return {
    projection: {
      runId: "run-recovery",
      rootHash: HASH_A,
      stage: "abel-implement",
      change: "recovery-continuation",
      state: "paused",
      sequence: 1,
      eventHash: HASH_B,
      deliveryRevision: 1,
      deliveryBindings: [],
    },
    rows: [row],
    attemptDiagnostics: new Map(diagnostic ? [[row.task_id, diagnostic]] : []),
    failureSequences: new Map(
      diagnostic?.recovery ? [[diagnostic.recovery.key, 7]] : [],
    ),
    amendmentUsed: 0,
    resourceBudget: {
      used: 2,
      maximum: 30,
      phaseHighWater: 2,
      hardLimit: 512,
    },
  };
}

it("projects an inspect-first continuation and exact conditional resume after correction exhaustion", () => {
  const recovery = {
    key: HASH_C,
    failures: 2,
    feedback: {
      code: "candidate-diff-invalid",
      attempt: 3,
      maxAttempts: 2,
      strategy: "revise-candidate" as const,
      failureIdentities: [HASH_A],
    },
  };
  const status = projectWorkflowStatus(
    facts(task("candidate-diff-invalid"), { recovery }),
  );
  const grant = {
    incidentKey: HASH_C,
    failureSequence: 7,
    reason: "parent-directed-retry",
  };

  expect(status).toMatchObject({
    continuation: {
      owner: "parent",
      automatic: true,
      kind: "inspect-recovery",
      reason: "candidate-diff-invalid",
      stage: "abel-implement",
      change: "recovery-continuation",
      metadata: {
        taskId: "T1",
        phase: "green",
        diagnostic: {
          code: "candidate-diff-invalid",
          attempts: 2,
          maxAttempts: 2,
          strategy: "revise-candidate",
          failureIdentities: [HASH_A],
        },
        recommendation: {
          kind: "bounded-additional-attempt",
          resume: { recovery: grant },
        },
      },
    },
    conditionalCommands: [
      {
        command: "resume",
        stage: "abel-implement",
        change: "recovery-continuation",
        requires: { recovery: grant },
      },
    ],
    decisionBatch: {
      resolution: {
        owner: "parent",
        strategy: "recommended",
        requiresUserInput: false,
      },
      requiredGates: ["gate-b"],
    },
  });
  expect(status.legalCommands).not.toContain("resume");
  expect(status.continuation).not.toHaveProperty("action");
  expect(status.continuation).not.toHaveProperty("command");
});

it("guides bounded parent inspection for trusted capability and route pauses", () => {
  const prerequisite: WorkflowVerificationPrerequisite = {
    kind: "verification-prerequisite",
    scope: "baseline-task-affected",
    cause: "capability",
    verificationId: "baseline-test",
    contractIdentity: HASH_A,
    originalRevisionId: HASH_B,
    environmentIdentity: HASH_C,
    taskId: "T1",
  };
  const capability = projectWorkflowStatus(
    facts(task("runner-missing"), { prerequisite }),
  );
  expect(capability).toMatchObject({
    continuation: {
      owner: "parent",
      automatic: true,
      kind: "inspect-recovery",
      reason: "runner-missing",
      metadata: {
        taskId: "T1",
        diagnostic: {
          code: "runner-missing",
          strategy: "restore-verification-capability",
          prerequisite,
        },
      },
    },
  });
  expect(capability).not.toHaveProperty("decisionBatch");

  const route = projectWorkflowStatus(
    facts(
      task("endpoint-unavailable", {
        route_id: "worker-primary",
        route_fingerprint: HASH_A,
      }),
    ),
  );
  expect(route).toMatchObject({
    continuation: {
      kind: "inspect-recovery",
      reason: "endpoint-unavailable",
      metadata: {
        diagnostic: {
          code: "endpoint-unavailable",
          strategy: "inspect-route-availability",
          route: { routeId: "worker-primary", routeFingerprint: HASH_A },
        },
      },
    },
  });
  expect(route.continuation).not.toHaveProperty("action");
  expect(route.continuation).not.toHaveProperty("command");
});

it("guides inspection of a change-level environment barrier after tasks verify", () => {
  const input = facts(
    task("completed", {
      state: "verified",
      pause_code: null,
    }),
    {
      recovery: {
        key: HASH_C,
        failures: 2,
        feedback: {
          code: "candidate-diff-invalid",
          attempt: 3,
          maxAttempts: 2,
          strategy: "revise-candidate",
        },
      },
    },
  );
  const status = projectWorkflowStatus({
    ...input,
    projection: {
      ...input.projection,
      pauseCode: "verification-environment-unavailable",
    },
  });
  expect(status).toMatchObject({
    blockers: [],
    tasks: [{ taskId: "T1", state: "verified" }],
    continuation: {
      owner: "parent",
      automatic: true,
      kind: "inspect-recovery",
      reason: "verification-environment-unavailable",
      metadata: {
        diagnostic: {
          code: "verification-environment-unavailable",
          strategy: "restore-runtime-environment",
        },
      },
    },
  });
  expect(status).not.toHaveProperty("decisionBatch");
  expect(status).not.toHaveProperty("recovery.additionalAttempt");
  expect(status).not.toHaveProperty("continuation.metadata.recommendation");
});

it.each([
  ["input-unsafe", undefined],
  ["unclassified-failure", undefined],
  ["operation-cancelled", undefined],
  [
    "runner-missing",
    {
      prerequisite: {
        kind: "verification-prerequisite",
        scope: "baseline-task-affected",
        cause: "unknown",
        verificationId: "baseline-test",
        contractIdentity: HASH_A,
        originalRevisionId: HASH_B,
        environmentIdentity: HASH_C,
      } satisfies WorkflowVerificationPrerequisite,
    },
  ],
] as const)(
  "does not derive recovery authority from %s",
  (code, diagnostic) => {
    const status = projectWorkflowStatus(
      facts(task(code), diagnostic as SafeAttemptDiagnostic | undefined),
    );
    expect(status).not.toHaveProperty("continuation");
    expect(status).not.toHaveProperty("decisionBatch");
  },
);

it("does not turn stale currentness or exhausted work capacity into amendment authority", () => {
  const recovery = {
    key: HASH_C,
    failures: 2,
    feedback: {
      code: "workspace-revision-stale",
      attempt: 3,
      maxAttempts: 2,
      strategy: "refresh-candidate" as const,
    },
  };
  const stale = projectWorkflowStatus(
    facts(task("workspace-revision-stale"), { recovery }),
  );
  expect(stale).toHaveProperty("continuation.kind", "inspect-recovery");
  expect(stale).not.toHaveProperty("decisionBatch");

  const exhausted = projectWorkflowStatus({
    ...facts(task("candidate-diff-invalid"), {
      recovery: {
        ...recovery,
        feedback: {
          ...recovery.feedback,
          code: "candidate-diff-invalid",
          strategy: "revise-candidate",
        },
      },
    }),
    resourceBudget: {
      used: 30,
      maximum: 30,
      phaseHighWater: 2,
      hardLimit: 512,
    },
  });
  expect(exhausted).not.toHaveProperty("continuation");
  expect(exhausted).not.toHaveProperty("conditionalCommands");
});

it.each(["noncanonical-path", "script-unsafe", "verification-config-unsafe"])(
  "does not continue or amend from unsafe/integrity evidence: %s",
  (code) => {
    const status = projectWorkflowStatus(
      facts(task(code), {
        recovery: {
          key: HASH_C,
          failures: 2,
          feedback: {
            code,
            attempt: 3,
            maxAttempts: 2,
            strategy: "revise-candidate",
          },
        },
      }),
    );
    expect(status).not.toHaveProperty("continuation");
    expect(status).not.toHaveProperty("conditionalCommands");
    expect(status).not.toHaveProperty("decisionBatch");
    expect(status).not.toHaveProperty("recovery.additionalAttempt");
  },
);

it.each(["delivery-invalid", "operation-cancelled", "unclassified-failure"])(
  "lets a global %s pause override stale task recovery evidence",
  (pauseCode) => {
    const input = facts(task("candidate-diff-invalid"), {
      recovery: {
        key: HASH_C,
        failures: 2,
        feedback: {
          code: "candidate-diff-invalid",
          attempt: 3,
          maxAttempts: 2,
          strategy: "revise-candidate",
        },
      },
    });
    const status = projectWorkflowStatus({
      ...input,
      projection: { ...input.projection, pauseCode },
    });
    expect(status).not.toHaveProperty("continuation");
    expect(status).not.toHaveProperty("conditionalCommands");
    expect(status).not.toHaveProperty("decisionBatch");
    expect(status).not.toHaveProperty("recovery.additionalAttempt");
  },
);

it("keeps multi-task recovery guidance bound to the first paused owner", () => {
  const first = task("endpoint-unavailable", {
    task_id: "T1-route",
    task_order: 1,
    route_id: "route-a",
    route_fingerprint: HASH_A,
  });
  const exhausted = task("candidate-diff-invalid", {
    task_id: "T2-candidate",
    task_order: 2,
  });
  const recovery: SafeAttemptDiagnostic = {
    recovery: {
      key: HASH_C,
      failures: 2,
      feedback: {
        code: "candidate-diff-invalid",
        attempt: 3,
        maxAttempts: 2,
        strategy: "revise-candidate",
      },
    },
  };
  const input = facts(first);
  const status = projectWorkflowStatus({
    ...input,
    projection: { ...input.projection, pauseCode: "endpoint-unavailable" },
    rows: [first, exhausted],
    attemptDiagnostics: new Map([[exhausted.task_id, recovery]]),
    failureSequences: new Map([[HASH_C, 7]]),
  });

  expect(status).toMatchObject({
    continuation: {
      kind: "inspect-recovery",
      reason: "endpoint-unavailable",
      metadata: {
        taskId: "T1-route",
        diagnostic: {
          code: "endpoint-unavailable",
          strategy: "inspect-route-availability",
          route: { routeId: "route-a", routeFingerprint: HASH_A },
        },
      },
    },
    decisionBatch: {
      items: [{ taskId: "T2-candidate", code: "candidate-diff-invalid" }],
    },
  });
  expect(status).not.toHaveProperty("continuation.metadata.recommendation");
  expect(status).not.toHaveProperty("conditionalCommands");
  expect(status).not.toHaveProperty("recovery.additionalAttempt");
});

it("resumes the selected interrupted task without inheriting sibling recovery", () => {
  const interrupted = task("operation-interrupted", {
    task_id: "T1-interrupted",
    task_order: 1,
  });
  const exhausted = task("candidate-diff-invalid", {
    task_id: "T2-candidate",
    task_order: 2,
  });
  const input = facts(interrupted);
  const status = projectWorkflowStatus({
    ...input,
    projection: { ...input.projection, pauseCode: "operation-interrupted" },
    rows: [interrupted, exhausted],
    attemptDiagnostics: new Map([
      [
        exhausted.task_id,
        {
          recovery: {
            key: HASH_C,
            failures: 2,
            feedback: {
              code: "candidate-diff-invalid",
              attempt: 3,
              maxAttempts: 2,
              strategy: "revise-candidate",
            },
          },
        },
      ],
    ]),
    failureSequences: new Map([[HASH_C, 7]]),
  });

  expect(status).toMatchObject({
    continuation: {
      owner: "parent",
      automatic: true,
      command: "resume",
      kind: "resume-interrupted-operation",
      reason: "operation-interrupted",
      stage: "abel-implement",
      change: "recovery-continuation",
      metadata: { taskId: "T1-interrupted", phase: "green" },
    },
  });
  expect(status).not.toHaveProperty("conditionalCommands");
  expect(status).not.toHaveProperty("decisionBatch");
  expect(status).not.toHaveProperty("recovery.additionalAttempt");
});

it("continues mandatory interrupted apply settlement after Worker budget exhaustion", () => {
  const input = facts(
    task("completed", { state: "verified", pause_code: null }),
  );
  const status = projectWorkflowStatus({
    ...input,
    projection: {
      ...input.projection,
      state: "recovering",
      pauseCode: "operation-interrupted",
    },
    resourceBudget: {
      used: 30,
      maximum: 30,
      phaseHighWater: 2,
      hardLimit: 512,
    },
  });

  expect(status).toMatchObject({
    legalCommands: ["status", "resume", "discard"],
    continuation: {
      owner: "parent",
      automatic: true,
      command: "resume",
      kind: "settle-apply-recovery",
      reason: "operation-interrupted",
      stage: "abel-implement",
      change: "recovery-continuation",
    },
  });
  expect(status).not.toHaveProperty("decisionBatch");
});

it("does not auto-resume interrupted task work after Worker budget exhaustion", () => {
  const input = facts(task("operation-interrupted"));
  const status = projectWorkflowStatus({
    ...input,
    projection: { ...input.projection, pauseCode: "operation-interrupted" },
    resourceBudget: {
      used: 30,
      maximum: 30,
      phaseHighWater: 2,
      hardLimit: 512,
    },
  });
  expect(status).not.toHaveProperty("continuation");
});

it.each(["completed", "discarded", "rejected"] as const)(
  "withholds recovery actions from terminal state %s",
  (state) => {
    const routeInput = facts(task("endpoint-unavailable"));
    const route = projectWorkflowStatus({
      ...routeInput,
      projection: {
        ...routeInput.projection,
        state,
        terminal: state,
        pauseCode: undefined,
      },
    });
    expect(route).toMatchObject({ legalCommands: ["status"] });
    expect(route).not.toHaveProperty("continuation");
    expect(route).not.toHaveProperty("conditionalCommands");
    expect(route).not.toHaveProperty("decisionBatch");

    const exhaustedInput = facts(task("candidate-diff-invalid"), {
      recovery: {
        key: HASH_C,
        failures: 2,
        feedback: {
          code: "candidate-diff-invalid",
          attempt: 3,
          maxAttempts: 2,
          strategy: "revise-candidate",
        },
      },
    });
    const exhausted = projectWorkflowStatus({
      ...exhaustedInput,
      projection: {
        ...exhaustedInput.projection,
        state,
        terminal: state,
        pauseCode: undefined,
      },
    });
    expect(exhausted).not.toHaveProperty("continuation");
    expect(exhausted).not.toHaveProperty("conditionalCommands");
    expect(exhausted).not.toHaveProperty("recovery.additionalAttempt");
  },
);
