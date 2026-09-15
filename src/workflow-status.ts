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
  normalizeVerificationPrerequisite,
  normalizeWorkflowContextRequest,
  normalizeWorkflowVerificationStatus,
  parentRecoveryStrategy,
  parseDeliveryDiagnostics,
  permitsPlanAmendment,
  permitsPrerequisiteAmendment,
  permitsRecoveryAmendment,
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
  const activeRows = rows.filter((row) =>
    ["approval-needed", "paused", "retryable"].includes(row.state),
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
  const taskPauseSuperseded =
    projection.state === "paused" &&
    projection.pauseCode !== undefined &&
    !activeRows.some((row) => row.pause_code === projection.pauseCode);
  const approval =
    projection.state === "approval-needed"
      ? approvalRequirement(pauseCode, contextRequest)
      : undefined;
  const attemptDiagnostic = firstPaused
    ? attemptDiagnostics.get(firstPaused.task_id)
    : undefined;
  const recovery = taskPauseSuperseded
    ? undefined
    : attemptDiagnostic?.recovery;
  const recoveryExhausted =
    recovery && recovery.failures >= recovery.feedback.maxAttempts;
  const selectedPrerequisite = normalizeVerificationPrerequisite(
    taskPauseSuperseded ? undefined : attemptDiagnostic?.prerequisite,
  );
  const selectedRecoveryStrategy = parentRecoveryStrategy(
    pauseCode,
    taskPauseSuperseded ? undefined : attemptDiagnostic,
  );
  const selectedPauseActionable =
    (projection.state === "approval-needed" && approval !== undefined) ||
    (projection.state === "paused" &&
      (permitsPlanAmendment(pauseCode) ||
        selectedRecoveryStrategy !== undefined ||
        permitsPrerequisiteAmendment(selectedPrerequisite)));
  const blockers = activeRows.map((row) => {
    const context = row.context_request_json
      ? normalizeWorkflowContextRequest(JSON.parse(row.context_request_json))
      : undefined;
    const code = row.pause_code ?? "task-paused";
    const diagnostic = attemptDiagnostics.get(row.task_id);
    const prerequisite = normalizeVerificationPrerequisite(
      diagnostic?.prerequisite,
    );
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
      ...(prerequisite
        ? {
            prerequisite,
            scope:
              prerequisite.scope === "baseline-full-suite" ? "change" : "task",
            minimumRecovery: permitsPrerequisiteAmendment(prerequisite)
              ? "Revise the baseline contract to read safe inputs from the retained original revision, then recompile within the existing authority."
              : prerequisite.cause === "capability"
                ? "Restore the required runner or external capability; a changed environment identity permits a bounded check."
                : "Restore trusted verification prerequisites; the retained failure does not authorize plan changes.",
          }
        : {}),
      ...(diagnostic?.recovery
        ? {
            recovery: {
              code: diagnostic.recovery.feedback.code,
              attempts: diagnostic.recovery.failures,
              maxAttempts: diagnostic.recovery.feedback.maxAttempts,
              strategy: diagnostic.recovery.feedback.strategy,
              ...(diagnostic.recovery.feedback.failureIdentities
                ? {
                    failureIdentities:
                      diagnostic.recovery.feedback.failureIdentities,
                  }
                : {}),
            },
          }
        : {}),
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
  const amendments = !selectedPauseActionable
    ? []
    : blockers.filter(
        (item) =>
          item.kind === "decision" ||
          permitsPlanAmendment(item.code) ||
          permitsRecoveryAmendment(
            item.code,
            attemptDiagnostics.get(item.taskId),
          ) ||
          ("prerequisite" in item &&
            permitsPrerequisiteAmendment(item.prerequisite)),
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
  const budgetCode = [
    "change-work-budget-exhausted",
    "change-recovery-budget-exhausted",
  ].includes(pauseCode)
    ? pauseCode
    : undefined;
  const budgetExhausted = budgetCode !== undefined;
  const hasWorkCapacity =
    !budgetExhausted &&
    (!resourceBudget || resourceBudget.used < resourceBudget.maximum);
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
  const guidanceRow = taskPauseSuperseded ? undefined : firstPaused;
  const guidanceDiagnostic = taskPauseSuperseded
    ? undefined
    : attemptDiagnostic;
  const guidanceCode = pauseCode;
  const guidanceStrategy = selectedRecoveryStrategy;
  const failureSequence = recovery
    ? failureSequences.get(recovery.key)
    : undefined;
  const recoveryGrant =
    recoveryExhausted &&
    guidanceStrategy !== undefined &&
    projection.state === "paused" &&
    hasWorkCapacity &&
    resourceBudget &&
    failureSequence !== undefined &&
    Number.isSafeInteger(failureSequence) &&
    failureSequence > 0
      ? {
          incidentKey: recovery.key,
          failureSequence,
          reason: "parent-directed-retry" as const,
        }
      : undefined;
  const recoveryContinuation =
    projection.state === "paused" &&
    hasWorkCapacity &&
    guidanceStrategy &&
    (!recoveryExhausted || recoveryGrant)
      ? {
          owner: "parent" as const,
          automatic: true,
          kind: "inspect-recovery" as const,
          reason: guidanceCode,
          stage: projection.stage,
          change: projection.change,
          metadata: {
            ...(guidanceRow
              ? { taskId: guidanceRow.task_id, phase: guidanceRow.phase }
              : {}),
            diagnostic: {
              code: guidanceCode,
              strategy:
                guidanceDiagnostic?.recovery?.feedback.strategy ??
                guidanceStrategy,
              ...(guidanceDiagnostic?.recovery
                ? {
                    inspection: guidanceStrategy,
                    attempts: guidanceDiagnostic.recovery.failures,
                    maxAttempts:
                      guidanceDiagnostic.recovery.feedback.maxAttempts,
                    ...(guidanceDiagnostic.recovery.feedback.failureIdentities
                      ? {
                          failureIdentities:
                            guidanceDiagnostic.recovery.feedback
                              .failureIdentities,
                        }
                      : {}),
                  }
                : {}),
              ...(guidanceDiagnostic?.prerequisite
                ? {
                    prerequisite: normalizeVerificationPrerequisite(
                      guidanceDiagnostic.prerequisite,
                    ),
                  }
                : {}),
              ...(guidanceRow?.route_id || engineRun?.route_id
                ? {
                    route: {
                      routeId:
                        guidanceRow?.route_id ?? engineRun?.route_id ?? "",
                      ...((guidanceRow?.route_fingerprint ??
                      engineRun?.route_fingerprint)
                        ? {
                            routeFingerprint:
                              guidanceRow?.route_fingerprint ??
                              engineRun?.route_fingerprint,
                          }
                        : {}),
                    },
                  }
                : {}),
            },
            ...(recoveryGrant
              ? {
                  recommendation: {
                    kind: "bounded-additional-attempt" as const,
                    resume: { recovery: recoveryGrant },
                  },
                }
              : {}),
          },
        }
      : undefined;
  const amendmentContinuation =
    decisionBatch && !amendmentBudget.exhausted && hasWorkCapacity
      ? {
          owner: "parent" as const,
          automatic: true,
          ...decisionBatch.continuation,
        }
      : undefined;
  const interruptedContinuation =
    projection.stage === "abel-implement" &&
    projection.change &&
    projection.pauseCode === "operation-interrupted" &&
    legalControlCommands(projection.state).includes("resume") &&
    (projection.state === "recovering" ||
      (projection.state === "paused" && hasWorkCapacity))
      ? {
          owner: "parent" as const,
          automatic: true,
          command: "resume" as const,
          kind:
            projection.state === "recovering"
              ? ("settle-apply-recovery" as const)
              : ("resume-interrupted-operation" as const),
          reason: "operation-interrupted" as const,
          stage: projection.stage,
          change: projection.change,
          ...(guidanceRow?.pause_code === "operation-interrupted"
            ? {
                metadata: {
                  taskId: guidanceRow.task_id,
                  phase: guidanceRow.phase,
                },
              }
            : {}),
        }
      : undefined;
  const continuation =
    interruptedContinuation ?? recoveryContinuation ?? amendmentContinuation;
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
            ...(recoveryGrant ? { additionalAttempt: recoveryGrant } : {}),
          },
        }
      : {}),
    ...(continuation ? { continuation } : {}),
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
        }
      : {}),
    ...(approval && projection.change
      ? {
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
      : recoveryGrant && projection.change
        ? {
            conditionalCommands: [
              {
                command: "resume",
                stage: "abel-implement",
                change: projection.change,
                requires: { recovery: recoveryGrant },
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
