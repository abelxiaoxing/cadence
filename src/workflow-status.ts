import {
  canonicalJson,
  legalControlCommands,
  type RunProjection,
} from "./run-state.ts";
import {
  approvalRequirement,
  type EngineRunRow,
  type EngineTaskRow,
  hash,
  normalizeWorkflowContextRequest,
  normalizeWorkflowVerificationStatus,
  parseDeliveryDiagnostics,
  permitsPlanAmendment,
  type SafeAttemptDiagnostic,
} from "./workflow-policy.ts";

export interface WorkflowResourceBudget {
  used: number;
  maximum: number;
  phaseHighWater: number;
  hardLimit: number;
}

export interface WorkflowStatusFacts {
  projection: RunProjection;
  rows: readonly EngineTaskRow[];
  engineRun?: EngineRunRow;
  attemptDiagnostics: ReadonlyMap<string, SafeAttemptDiagnostic>;
  failureSequences: ReadonlyMap<string, number>;
  amendmentUsed: number;
  resourceBudget?: WorkflowResourceBudget;
}

export function firstPausedTask(
  rows: readonly EngineTaskRow[],
): EngineTaskRow | undefined {
  return (
    rows.find((row) => row.state === "approval-needed") ??
    rows.find((row) => ["paused", "retryable"].includes(row.state))
  );
}

/** Project already-read facts; no storage access, callbacks or workflow transitions. */
export function projectWorkflowStatus({
  projection,
  rows,
  engineRun,
  attemptDiagnostics,
  failureSequences,
  amendmentUsed,
  resourceBudget,
}: WorkflowStatusFacts): Record<string, unknown> {
  const runId = projection.runId;
  const queued = rows
    .filter((row) => row.state === "queued")
    .sort(
      (left, right) =>
        (left.queue_position ?? Number.MAX_SAFE_INTEGER) -
          (right.queue_position ?? Number.MAX_SAFE_INTEGER) ||
        left.task_order - right.task_order,
    );
  const firstPaused = firstPausedTask(rows);
  const contextRequest = firstPaused?.context_request_json
    ? normalizeWorkflowContextRequest(
        JSON.parse(firstPaused.context_request_json) as unknown,
      )
    : undefined;
  const pauseCode =
    projection.state === "approval-needed" &&
    firstPaused?.state === "approval-needed"
      ? (firstPaused.pause_code ?? projection.pauseCode ?? "task-paused")
      : (projection.pauseCode ?? firstPaused?.pause_code ?? "task-paused");
  const approval =
    projection.state === "approval-needed"
      ? approvalRequirement(pauseCode, contextRequest)
      : undefined;
  const attemptDiagnostic = firstPaused
    ? attemptDiagnostics.get(firstPaused.task_id)
    : undefined;
  const recovery =
    rows
      .map((row) => attemptDiagnostics.get(row.task_id)?.recovery)
      .find((fact) => fact && fact.failures >= fact.feedback.maxAttempts) ??
    attemptDiagnostic?.recovery;
  const recoveryExhausted =
    recovery && recovery.failures >= recovery.feedback.maxAttempts;
  const blockers = rows
    .filter((row) =>
      ["approval-needed", "paused", "retryable"].includes(row.state),
    )
    .map((row) => {
      const context = row.context_request_json
        ? normalizeWorkflowContextRequest(JSON.parse(row.context_request_json))
        : undefined;
      const code = row.pause_code ?? "task-paused";
      const requirement =
        row.state === "approval-needed"
          ? approvalRequirement(code, context)
          : undefined;
      return {
        id: hash(runId, row.task_id, code, canonicalJson(context ?? {})),
        taskId: row.task_id,
        phase: row.phase,
        code,
        kind: requirement ? "decision" : "execution",
        ...(requirement ?? {}),
        ...(context ? { contextRequest: context } : {}),
      };
    });
  if (
    projection.state === "approval-needed" &&
    !blockers.some((item) => item.kind === "decision") &&
    approval
  ) {
    blockers.push({
      id: hash(runId, pauseCode),
      taskId: "change",
      phase: "green",
      code: pauseCode,
      kind: "decision",
      ...approval,
    });
  }
  const decisions = blockers.filter((item) => item.kind === "decision");
  const amendments = blockers.filter(
    (item) => item.kind === "decision" || permitsPlanAmendment(item.code),
  );
  if (
    projection.state === "paused" &&
    permitsPlanAmendment(pauseCode) &&
    !amendments.some((item) => item.code === pauseCode)
  ) {
    const item = {
      id: hash(runId, pauseCode, engineRun?.delivery_diagnostics_json ?? ""),
      taskId: "change",
      phase: "red" as const,
      code: pauseCode,
      kind: "execution",
    };
    blockers.push(item);
    amendments.push(item);
  }
  const amendmentBudget = {
    used: amendmentUsed,
    maximum: 64,
    remaining: 64 - amendmentUsed,
    exhausted: amendmentUsed >= 64,
  };
  const decisionBatch =
    amendments.length &&
    pauseCode !== "operation-cancelled" &&
    ["approval-needed", "paused"].includes(projection.state)
      ? {
          id: hash(
            runId,
            String(projection.deliveryRevision ?? 0),
            canonicalJson(amendments),
          ),
          continuation: {
            action: "amend",
            change: projection.change,
            batchId: hash(
              runId,
              String(projection.deliveryRevision ?? 0),
              canonicalJson(amendments),
            ),
          },
          resolution: {
            owner: "parent",
            strategy: "recommended",
            requiresUserInput: false,
          },
          items: amendments,
          requiredGates: [
            ...new Set(
              amendments.flatMap((item) => item.requiredGates ?? ["gate-b"]),
            ),
          ].sort(),
        }
      : undefined;
  const budgetCode = rows.find(
    (row) =>
      row.pause_code === "change-work-budget-exhausted" ||
      row.pause_code === "change-recovery-budget-exhausted",
  )?.pause_code;
  const budgetExhausted = budgetCode !== undefined;
  const currentRevision = projection.deliveryRevision ?? 0;
  return {
    runId: projection.runId,
    stage: projection.stage,
    ...(projection.change ? { change: projection.change } : {}),
    state: projection.state,
    ...(projection.deliveryRevision === undefined
      ? {}
      : { deliveryRevision: projection.deliveryRevision }),
    ...(projection.deliveryBindings.length > 0
      ? { deliveryBindings: structuredClone(projection.deliveryBindings) }
      : {}),
    completed: projection.state === "completed",
    blockers,
    ...(resourceBudget
      ? {
          resourceBudget: {
            ...resourceBudget,
            remaining: resourceBudget.maximum - resourceBudget.used,
          },
        }
      : {}),
    ...(budgetExhausted
      ? {
          recovery: {
            automatic: false,
            exhausted: true,
            code: budgetCode,
          },
        }
      : {}),
    ...(decisionBatch
      ? {
          decisionBatch,
          amendmentBudget,
          ...(!amendmentBudget.exhausted &&
          !budgetExhausted &&
          (!resourceBudget || resourceBudget.used < resourceBudget.maximum)
            ? {
                continuation: {
                  owner: "parent",
                  automatic: true,
                  ...decisionBatch.continuation,
                },
              }
            : {}),
        }
      : {}),
    ...(recoveryExhausted
      ? {
          recovery: {
            automatic: false,
            exhausted: true,
            code: recovery.feedback.code,
            attempts: recovery.failures,
            maxAttempts: recovery.feedback.maxAttempts,
            automaticRetryExhausted: true,
            ...(!budgetExhausted &&
            resourceBudget &&
            resourceBudget.used < resourceBudget.maximum
              ? {
                  additionalAttempt: {
                    incidentKey: recovery.key,
                    failureSequence: failureSequences.get(recovery.key) ?? 0,
                    reason: "parent-directed-retry",
                  },
                }
              : {}),
          },
        }
      : {}),
    ...(projection.terminal ? { terminal: projection.terminal } : {}),
    ...(projection.pauseCode || firstPaused?.pause_code
      ? {
          pause: {
            code: pauseCode,
            ...(attemptDiagnostic ? { diagnostic: attemptDiagnostic } : {}),
          },
        }
      : {}),
    legalCommands:
      projection.state === "approval-needed"
        ? ["status", "discard"]
        : legalControlCommands(projection.state).filter(
            (command) =>
              (command !== "rebind" || firstPaused !== undefined) &&
              (command !== "resume" ||
                (!recoveryExhausted && !budgetExhausted)),
          ),
    ...(approval && projection.change
      ? {
          approval: {
            category: approval.category,
            requiredGates:
              decisionBatch?.requiredGates ?? approval.requiredGates,
            categories: [
              ...new Set(
                decisions.flatMap((item) =>
                  item.category ? [item.category] : [],
                ),
              ),
            ],
            refs: [...new Set(decisions.flatMap((item) => item.refs ?? []))],
            continuation: decisionBatch?.continuation,
            retainedRun: {
              runId: projection.runId,
              deliveryRevision: currentRevision,
            },
            receiptPrecondition: {
              deliveryRevision: { greaterThan: currentRevision },
              receiptHash: "matching-ready-receipt",
            },
          },
          conditionalCommands: [
            {
              command: "resume",
              stage: "abel-implement",
              change: projection.change,
              requires: {
                deliveryRevision: { greaterThan: currentRevision },
                receiptHash: "matching-ready-receipt",
              },
            },
          ],
        }
      : {}),
    tasks: rows.map((row) => ({
      taskId: row.task_id,
      state: row.state,
      ...(row.state === "verified" ? {} : { phase: row.phase }),
      ...(row.context_request_json
        ? {
            contextRequest: normalizeWorkflowContextRequest(
              JSON.parse(row.context_request_json) as unknown,
            ),
          }
        : {}),
    })),
    queue: queued.map((row, index) => ({
      taskId: row.task_id,
      position: index + 1,
      reason: row.pause_code === "worker-capacity" ? "capacity" : "conflict",
    })),
    ...(engineRun?.verification_json
      ? {
          verification: normalizeWorkflowVerificationStatus(
            JSON.parse(engineRun.verification_json) as unknown,
          ),
        }
      : {}),
    ...(engineRun?.delivery_diagnostics_json
      ? {
          delivery: {
            code: "delivery-invalid",
            diagnostics: parseDeliveryDiagnostics(
              engineRun.delivery_diagnostics_json,
            ),
          },
        }
      : {}),
    ...(engineRun?.route_id
      ? {
          routeBinding: {
            routeId: engineRun.route_id,
            ...(engineRun.route_fingerprint
              ? { routeFingerprint: engineRun.route_fingerprint }
              : {}),
          },
        }
      : {}),
    ...(engineRun?.cleanup_state === "retained"
      ? {
          privateData: {
            retained: true,
            cleanup: "retained",
            ...(engineRun.baseline_workspace_revision
              ? {
                  baselineRevisionId: engineRun.baseline_workspace_revision,
                }
              : {}),
            ...(engineRun.current_workspace_revision
              ? {
                  currentRevisionId: engineRun.current_workspace_revision,
                }
              : {}),
          },
        }
      : engineRun?.cleanup_state === "complete"
        ? {
            privateData: {
              retained: false,
              cleanup: "complete",
            },
          }
        : {}),
  };
}
