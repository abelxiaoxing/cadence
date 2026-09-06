import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { LIMITS } from "./contracts.ts";
import {
  assertControlCommand,
  type ControlCommand,
  type ControlStage,
} from "./control-contracts.ts";
import {
  DeliveryValidationError,
  type ImplementPlan,
  type PlanTaskDraft,
} from "./delivery-compiler.ts";
import type { RoutePolicy } from "./route-policy.ts";
import {
  canonicalJson,
  legalControlCommands,
  type RunProjection,
  type RunState,
} from "./run-state.ts";
import { type OperationLease, RunStore } from "./run-store.ts";
import { configureSqlite, ensureSqliteSchema } from "./sqlite-schema.ts";
import type { ResolvedStateRoot } from "./state-root.ts";
import { ENGINE_ADDITIONS, ENGINE_SCHEMA } from "./storage-schema.ts";
import type { WorkflowActivityUpdate } from "./subagent-activity.ts";
import {
  type ActiveOperation,
  approvalRequirement,
  assertDelivery,
  type BootstrapRow,
  bootstrapAcceptanceHash,
  CHANGE_NAME,
  cancellableRead,
  classifyPersistedContextRequest,
  deliveryBoundPaths,
  type EngineOperationRow,
  type EngineRunRow,
  type EngineTaskRow,
  emitWorkflowActivity,
  expectedClassification,
  type HeldOperationLease,
  hash,
  IDENTIFIER,
  isCancellationException,
  isRecord,
  isWorkflowApprovalCode,
  normalizeBootstrapAcceptanceFacts,
  normalizeWorkflowContextRequest,
  normalizeWorkflowVerificationStatus,
  parseDeliveryDiagnostics,
  parseJsonRecord,
  parsePlan,
  phases,
  type SafeAttemptDiagnostic,
  SHA256,
  taskApprovalBoundary,
  taskConflicts,
  type WorkflowApplication,
  type WorkflowApplicationContext,
  type WorkflowAttemptOutcome,
  type WorkflowAvailableDelivery,
  type WorkflowChangeVerifier,
  type WorkflowContextRequest,
  type WorkflowDelivery,
  type WorkflowDeliverySource,
  type WorkflowEngineOptions,
  type WorkflowRunLifecycle,
  type WorkflowVerificationStatus,
  type WorkflowWorker,
} from "./workflow-policy.ts";
export class WorkflowEngine {
  readonly #consumerRoot: string;
  readonly #stateRoot: ResolvedStateRoot;
  readonly #runStore: RunStore;
  readonly #database: DatabaseSync;
  readonly #deliverySource: WorkflowDeliverySource;
  readonly #worker: WorkflowWorker;
  readonly #changeVerifier: WorkflowChangeVerifier;
  readonly #application?: WorkflowApplication;
  readonly #lifecycle?: WorkflowRunLifecycle;
  readonly #now: () => number;
  readonly #leaseTtlMs: number;
  #activeTasks = 0;
  readonly #capacityWaiters = new Set<() => void>();
  readonly #active = new Map<string, ActiveOperation>();
  readonly #operationLeases = new Map<string, HeldOperationLease>();
  #orphanRecoveryTimer?: ReturnType<typeof setTimeout>;
  readonly #commands = new Map<
    AbortController,
    { command: ControlCommand; settled: Promise<Record<string, unknown>> }
  >();
  #closing?: Promise<void>;
  #closed = false;

  private constructor(options: WorkflowEngineOptions) {
    this.#consumerRoot = path.resolve(options.consumerRoot);
    this.#stateRoot = options.stateRoot;
    this.#deliverySource = options.deliverySource;
    this.#worker = options.worker;
    this.#changeVerifier = options.changeVerifier;
    this.#application = options.application;
    this.#lifecycle = options.lifecycle;
    this.#now = options.now ?? Date.now;
    this.#leaseTtlMs = options.leaseTtlMs ?? 60_000;
    this.#runStore = RunStore.open(options.stateRoot, { now: this.#now });
    this.#database = new DatabaseSync(options.stateRoot.databasePath);
    try {
      configureSqlite(this.#database);
      ensureSqliteSchema(this.#database, ENGINE_SCHEMA, ENGINE_ADDITIONS);
    } catch (error) {
      this.#database.close();
      this.#runStore.close();
      throw error;
    }
    this.#recoverInterruptedOperations();
    this.#recoverTerminalCleanup();
  }

  static open(options: WorkflowEngineOptions): WorkflowEngine {
    if (
      path.resolve(options.consumerRoot) !== options.stateRoot.consumerRoot ||
      options.stateRoot.consumerRootHash.length !== 64
    ) {
      throw new Error("workflow-engine-root-mismatch");
    }
    if (
      !options.deliverySource ||
      typeof options.deliverySource.load !== "function" ||
      !options.worker ||
      typeof options.worker.runAttempt !== "function" ||
      typeof options.worker.rebind !== "function" ||
      !options.changeVerifier ||
      typeof options.changeVerifier.verify !== "function" ||
      (options.application !== undefined &&
        (typeof options.application.prepare === "function") !==
          (typeof options.application.applyPrepared === "function"))
    ) {
      throw new Error("workflow-engine-service-invalid");
    }
    if (
      options.leaseTtlMs !== undefined &&
      (!Number.isSafeInteger(options.leaseTtlMs) || options.leaseTtlMs < 1)
    ) {
      throw new Error("workflow-engine-lease-invalid");
    }
    return new WorkflowEngine(options);
  }

  updateRoutePolicy(policy: RoutePolicy): void {
    this.#assertOpen();
    if (!this.#worker.updateRoutePolicy) {
      throw new Error("route-policy-update-unavailable");
    }
    this.#worker.updateRoutePolicy(policy);
  }

  routePolicyStatus(): Record<string, unknown> | undefined {
    this.#assertOpen();
    return this.#worker.routePolicyStatus?.();
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("workflow-engine-closed");
  }

  #transaction<T>(work: () => T): T {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  #operationKey(runId: string, operationId: string): string {
    return `${runId}\0${operationId}`;
  }

  #leaseOperationId(runId: string, _operationId: string): string {
    return `engine-run-${hash(runId).slice(0, 40)}`;
  }

  #holdOperationLease(lease: OperationLease, commandOperationId: string): void {
    const key = this.#operationKey(lease.runId, commandOperationId);
    const existing = this.#operationLeases.get(key);
    if (existing) clearInterval(existing.timer);
    const intervalMs = Math.max(1, Math.floor(this.#leaseTtlMs / 3));
    const held: HeldOperationLease = {
      lease,
      timer: setInterval(() => {
        if (this.#operationLeases.get(key) !== held) return;
        try {
          held.lease = this.#runStore.renewLease(held.lease, this.#leaseTtlMs);
          this.#database
            .prepare(
              `UPDATE workflow_engine_operations
               SET lease_expires_at = ?
               WHERE run_id = ? AND operation_id = ? AND state = 'running'
                 AND lease_token = ?`,
            )
            .run(
              held.lease.expiresAt,
              lease.runId,
              commandOperationId,
              lease.token,
            );
        } catch {
          held.error = new Error("lease-fenced");
          clearInterval(held.timer);
          const active = this.#active.get(lease.runId);
          if (active?.operationId === commandOperationId) {
            active.controller.abort(held.error);
          }
        }
      }, intervalMs),
    };
    held.timer.unref?.();
    this.#operationLeases.set(key, held);
  }

  #operationLease(runId: string, operationId: string): OperationLease {
    const held = this.#operationLeases.get(
      this.#operationKey(runId, operationId),
    );
    if (!held || held.error) throw held?.error ?? new Error("lease-fenced");
    this.#runStore.assertLease(held.lease);
    return held.lease;
  }

  #releaseOperationLease(runId: string, operationId: string): void {
    const key = this.#operationKey(runId, operationId);
    const held = this.#operationLeases.get(key);
    if (!held) return;
    clearInterval(held.timer);
    this.#operationLeases.delete(key);
  }

  #assertLeaseInTransaction(lease: OperationLease): void {
    const row = this.#database
      .prepare(
        `SELECT state, lease_token, lease_expires_at
         FROM operations WHERE run_id = ? AND operation_id = ?`,
      )
      .get(lease.runId, lease.operationId) as
      | {
          state: string;
          lease_token: string | null;
          lease_expires_at: number | null;
        }
      | undefined;
    if (
      row?.state !== "running" ||
      row.lease_token !== lease.token ||
      row.lease_expires_at === null ||
      row.lease_expires_at < this.#now()
    ) {
      throw new Error("lease-fenced");
    }
  }

  #leasedTransaction<T>(lease: OperationLease, work: () => T): T {
    return this.#transaction(() => {
      this.#assertLeaseInTransaction(lease);
      return work();
    });
  }

  #lookupRun(stage: ControlStage, change: string): string | undefined {
    return (
      this.#database
        .prepare(
          `SELECT run_id FROM runs
           WHERE root_hash = ? AND stage = ? AND lookup_key = ?`,
        )
        .get(this.#stateRoot.consumerRootHash, stage, `change:${change}`) as
        | { run_id: string }
        | undefined
    )?.run_id;
  }

  #ensureEngineRun(runId: string): void {
    this.#database
      .prepare(
        `INSERT INTO workflow_engine_runs(
           run_id, current_revision, baseline_workspace_revision,
           current_workspace_revision, cleanup_state, next_queue_position
         ) VALUES (?, NULL, NULL, NULL, 'none', 1)
         ON CONFLICT(run_id) DO NOTHING`,
      )
      .run(runId);
  }

  #engineRun(runId: string): EngineRunRow {
    const row = this.#database
      .prepare(
        `SELECT current_revision, baseline_workspace_revision,
                current_workspace_revision, cleanup_state, route_id,
                route_fingerprint,
                transaction_id, verification_json, delivery_diagnostics_json,
                next_queue_position
         FROM workflow_engine_runs WHERE run_id = ?`,
      )
      .get(runId) as EngineRunRow | undefined;
    if (!row) throw new Error("workflow-engine-run-unavailable");
    return row;
  }

  #operation(
    runId: string,
    operationId: string,
  ): EngineOperationRow | undefined {
    return this.#database
      .prepare(
        `SELECT command, state, outcome_json FROM workflow_engine_operations
         WHERE run_id = ? AND operation_id = ?`,
      )
      .get(runId, operationId) as EngineOperationRow | undefined;
  }

  #operationReplay(
    runId: string,
    operationId: string,
    command: string,
  ): Record<string, unknown> | undefined {
    const row = this.#operation(runId, operationId);
    if (row && row.command !== command) {
      throw new Error("operation-command-mismatch");
    }
    return row?.state === "committed" && row.outcome_json
      ? parseJsonRecord(row.outcome_json)
      : undefined;
  }

  #beginOperation(
    runId: string,
    operationId: string,
    command: string,
  ): Record<string, unknown> | undefined {
    if (!IDENTIFIER.test(operationId)) throw new Error("invalid-operation-id");
    const replay = this.#operationReplay(runId, operationId, command);
    if (replay) return replay;
    const existing = this.#operation(runId, operationId);
    if (existing?.state === "running") {
      const leaseStatus = this.#runStore.inspectOperation(
        runId,
        this.#leaseOperationId(runId, operationId),
      );
      if (leaseStatus?.state === "committed" && leaseStatus.outcome) {
        this.#database
          .prepare(
            `UPDATE workflow_engine_operations
             SET state = 'committed', lease_token = NULL,
                 lease_expires_at = NULL, outcome_json = ?
             WHERE run_id = ? AND operation_id = ?`,
          )
          .run(JSON.stringify(leaseStatus.outcome), runId, operationId);
        return structuredClone(leaseStatus.outcome);
      }
      if (leaseStatus?.state === "running") {
        throw new Error("operation-already-running");
      }
      this.#database
        .prepare(
          `UPDATE workflow_engine_operations
           SET state = 'interrupted', lease_token = NULL,
               lease_expires_at = NULL
           WHERE run_id = ? AND operation_id = ? AND state = 'running'`,
        )
        .run(runId, operationId);
    }
    const leaseOperationId = this.#leaseOperationId(runId, operationId);
    const priorLease = this.#runStore.inspectOperation(runId, leaseOperationId);
    const preempt = command === "cancel" || command === "discard";
    if (priorLease?.state === "running" && !preempt) {
      throw new Error("operation-already-running");
    }
    const lease = this.#runStore.acquireLease({
      runId,
      operationId: leaseOperationId,
      ttlMs: this.#leaseTtlMs,
      exclusive: true,
      ...(preempt ? { preempt: true } : {}),
    });
    if (preempt) {
      this.#database
        .prepare(
          `UPDATE workflow_engine_operations
           SET state = 'interrupted', lease_token = NULL,
               lease_expires_at = NULL
           WHERE run_id = ? AND operation_id <> ? AND state = 'running'`,
        )
        .run(runId, operationId);
    }
    this.#database
      .prepare(
        `INSERT INTO workflow_engine_operations(
           run_id, operation_id, command, state, lease_token,
           lease_expires_at, outcome_json
         ) VALUES (?, ?, ?, 'running', ?, ?, NULL)
         ON CONFLICT(run_id, operation_id) DO UPDATE SET
           command = excluded.command, state = 'running',
           lease_token = excluded.lease_token,
           lease_expires_at = excluded.lease_expires_at,
           outcome_json = NULL`,
      )
      .run(runId, operationId, command, lease.token, lease.expiresAt);
    this.#holdOperationLease(lease, operationId);
    return undefined;
  }

  #commitOperation(
    runId: string,
    operationId: string,
    outcome: Record<string, unknown>,
  ): Record<string, unknown> {
    const lease = this.#operationLease(runId, operationId);
    try {
      const committed = this.#runStore.commitLease(lease, outcome);
      const result = this.#database
        .prepare(
          `UPDATE workflow_engine_operations
           SET state = 'committed', lease_token = NULL,
               lease_expires_at = NULL, outcome_json = ?
           WHERE run_id = ? AND operation_id = ? AND state = 'running'
             AND lease_token = ?`,
        )
        .run(JSON.stringify(committed), runId, operationId, lease.token);
      if (Number(result.changes) !== 1) {
        throw new Error("operation-journal-fenced");
      }
      return structuredClone(committed);
    } finally {
      this.#releaseOperationLease(runId, operationId);
    }
  }

  #interruptOperation(runId: string, operationId: string): void {
    let lease: OperationLease;
    try {
      lease = this.#operationLease(runId, operationId);
      this.#runStore.interruptLease(lease);
      this.#database
        .prepare(
          `UPDATE workflow_engine_operations
           SET state = 'interrupted', lease_token = NULL,
               lease_expires_at = NULL
           WHERE run_id = ? AND operation_id = ? AND state = 'running'
             AND lease_token = ?`,
        )
        .run(runId, operationId, lease.token);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "lease-fenced") {
        throw error;
      }
    } finally {
      this.#releaseOperationLease(runId, operationId);
    }
  }

  #transition(
    runId: string,
    to: RunState,
    identity: string,
    code?: string,
    lease?: OperationLease,
  ): RunProjection {
    if (lease) this.#runStore.assertLease(lease);
    const current = this.#runStore.status(runId);
    if (
      current.state === to &&
      (to !== "paused" || code === undefined || current.pauseCode === code)
    ) {
      return current;
    }
    return this.#runStore.transition({
      runId,
      to,
      operationId: `eng-${hash(runId, identity, String(current.sequence), to).slice(0, 40)}`,
      ...(code ? { code } : {}),
      ...(lease ? { lease } : {}),
    });
  }

  #recoverInterruptedOperations(): void {
    if (this.#orphanRecoveryTimer) {
      clearTimeout(this.#orphanRecoveryTimer);
      this.#orphanRecoveryTimer = undefined;
    }
    let nextExpiry: number | undefined;
    const interrupted = this.#database
      .prepare(
        `SELECT run_id, operation_id FROM workflow_engine_operations
         WHERE state = 'running'`,
      )
      .all() as unknown as Array<{ run_id: string; operation_id: string }>;
    for (const row of interrupted) {
      const leaseStatus = this.#runStore.inspectOperation(
        row.run_id,
        this.#leaseOperationId(row.run_id, row.operation_id),
      );
      if (leaseStatus?.state === "committed" && leaseStatus.outcome) {
        this.#database
          .prepare(
            `UPDATE workflow_engine_operations
             SET state = 'committed', lease_token = NULL,
                 lease_expires_at = NULL, outcome_json = ?
             WHERE run_id = ? AND operation_id = ? AND state = 'running'`,
          )
          .run(
            JSON.stringify(leaseStatus.outcome),
            row.run_id,
            row.operation_id,
          );
        continue;
      }
      if (leaseStatus?.state === "running") {
        if (leaseStatus.expiresAt !== undefined) {
          nextExpiry = Math.min(nextExpiry ?? Infinity, leaseStatus.expiresAt);
        }
        continue;
      }
      this.#database
        .prepare(
          `UPDATE workflow_engine_operations
           SET state = 'interrupted', lease_token = NULL,
               lease_expires_at = NULL
           WHERE run_id = ? AND operation_id = ? AND state = 'running'`,
        )
        .run(row.run_id, row.operation_id);
      const projection = this.#runStore.status(row.run_id);
      if (["completed", "discarded", "rejected"].includes(projection.state)) {
        continue;
      }
      this.#database
        .prepare(
          `UPDATE workflow_engine_tasks
           SET state = 'paused',
               pause_code = CASE
                 WHEN pause_code = 'red-artifact-constraint'
                   THEN pause_code
                 ELSE 'operation-interrupted'
               END,
               context_request_json = CASE
                 WHEN pause_code = 'red-artifact-constraint'
                   THEN context_request_json
                 ELSE NULL
               END,
               queue_position = NULL
           WHERE run_id = ? AND state IN ('phase-running', 'validating')`,
        )
        .run(row.run_id);
      if (projection.state === "applying") {
        this.#transition(
          row.run_id,
          "recovering",
          "restart-apply-recovery",
          "operation-interrupted",
        );
      } else if (
        [
          "created",
          "validating-delivery",
          "ready",
          "queued",
          "connecting",
          "running",
          "validating",
          "verifying",
          "retryable",
          "approval-needed",
          "change-verifying",
          "ready-to-apply",
        ].includes(projection.state)
      ) {
        this.#transition(
          row.run_id,
          "paused",
          "restart-operation-interrupted",
          "operation-interrupted",
        );
      }
    }
    if (nextExpiry !== undefined && !this.#closed) {
      const delay = Math.max(1, nextExpiry - this.#now() + 1);
      this.#orphanRecoveryTimer = setTimeout(() => {
        this.#orphanRecoveryTimer = undefined;
        if (this.#closed) return;
        try {
          this.#recoverInterruptedOperations();
        } catch {
          // A later status/restart will surface durable journal corruption.
        }
      }, delay);
      this.#orphanRecoveryTimer.unref?.();
    }
  }

  #recoverTerminalCleanup(): void {
    const rows = this.#database
      .prepare(
        `SELECT workflow_engine_runs.run_id
         FROM workflow_engine_runs
         JOIN runs ON runs.run_id = workflow_engine_runs.run_id
         WHERE runs.state IN ('completed', 'discarded')
           AND workflow_engine_runs.cleanup_state = 'retained'`,
      )
      .all() as unknown as Array<{ run_id: string }>;
    for (const row of rows) {
      try {
        this.#cleanupTerminal(row.run_id, "restart-cleanup");
      } catch {
        // Terminal status remains truthful and a later reload retries cleanup.
      }
    }
  }

  #tasks(runId: string): EngineTaskRow[] {
    return this.#database
      .prepare(
        `SELECT task_id, task_order, delivery_revision, plan_json, state,
                phase, pause_code, context_request_json, attempt_diagnostic_json,
                route_id, route_fingerprint, queue_position
         FROM workflow_engine_tasks WHERE run_id = ? ORDER BY task_order`,
      )
      .all(runId) as unknown as EngineTaskRow[];
  }

  #taskPlan(row: EngineTaskRow): PlanTaskDraft {
    return JSON.parse(row.plan_json) as PlanTaskDraft;
  }

  #currentPlan(runId: string): ImplementPlan {
    const revision = this.#engineRun(runId).current_revision;
    if (revision === null) throw new Error("delivery-not-bound");
    return this.#planForRevision(runId, revision);
  }

  #planForRevision(runId: string, revision: number): ImplementPlan {
    const row = this.#database
      .prepare(
        `SELECT plan_json FROM workflow_engine_deliveries
         WHERE run_id = ? AND revision = ?`,
      )
      .get(runId, revision) as { plan_json: string } | undefined;
    if (!row) throw new Error("delivery-not-bound");
    return parsePlan(row.plan_json);
  }

  async #loadDelivery(
    stage: ControlStage,
    change: string,
    deliveryRevision?: number,
    receiptHash?: string,
    signal?: AbortSignal,
  ): Promise<WorkflowDelivery> {
    const delivery = await cancellableRead(
      () =>
        this.#deliverySource.load({
          stage,
          change,
          ...(deliveryRevision === undefined ? {} : { deliveryRevision }),
          ...(receiptHash === undefined ? {} : { receiptHash }),
          ...(signal ? { signal } : {}),
        }),
      signal,
    );
    signal?.throwIfAborted();
    assertDelivery(delivery, stage, change, deliveryRevision, receiptHash);
    return structuredClone(delivery);
  }

  #admitDelivery(
    runId: string,
    delivery: WorkflowDelivery,
    lease: OperationLease,
  ): void {
    this.#runStore.assertLease(lease);
    const existing = this.#database
      .prepare(
        `SELECT receipt_hash, plan_json FROM workflow_engine_deliveries
         WHERE run_id = ? AND revision = ?`,
      )
      .get(runId, delivery.revision) as
      | { receipt_hash: string; plan_json: string }
      | undefined;
    const serializedPlan = JSON.stringify(delivery.plan);
    if (
      existing &&
      (existing.receipt_hash !== delivery.receiptHash ||
        existing.plan_json !== serializedPlan)
    ) {
      throw new Error("delivery-revision-conflict");
    }
    const engineRun = this.#engineRun(runId);
    if (
      engineRun.current_revision !== null &&
      delivery.revision < engineRun.current_revision
    ) {
      throw new Error("delivery-revision-stale");
    }
    const priorRows = this.#tasks(runId);
    const priorById = new Map(priorRows.map((row) => [row.task_id, row]));
    const priorPlan =
      engineRun.current_revision === null
        ? undefined
        : this.#planForRevision(runId, engineRun.current_revision);
    const priorTasks = new Map(
      (priorPlan?.tasks ?? []).map((task) => [task.taskId, task]),
    );
    const nextTasks = new Map(
      delivery.plan.tasks.map((task) => [task.taskId, task]),
    );
    const priorBoundPaths = new Set(
      priorPlan ? deliveryBoundPaths(priorPlan) : [],
    );
    const boundaryExpanded = deliveryBoundPaths(delivery.plan).some(
      (relative) => !priorBoundPaths.has(relative),
    );
    const compatible = new Set<string>();
    if (priorPlan) {
      for (const [taskId, priorTask] of priorTasks) {
        const nextTask = nextTasks.get(taskId);
        if (
          nextTask &&
          taskApprovalBoundary(priorPlan, priorTask) ===
            taskApprovalBoundary(delivery.plan, nextTask)
        ) {
          compatible.add(taskId);
        }
      }
    }
    let invalidated = new Set(
      priorRows
        .filter((row) => !compatible.has(row.task_id))
        .map((row) => row.task_id),
    );
    let revalidatedWorkspace:
      | {
          baselineRevisionId: string;
          currentWorkspaceRevisionId: string;
        }
      | undefined;
    if (
      priorPlan &&
      (invalidated.size > 0 || boundaryExpanded) &&
      engineRun.baseline_workspace_revision &&
      engineRun.current_workspace_revision
    ) {
      if (!this.#worker.revalidateDelivery) {
        if (boundaryExpanded) {
          throw new Error("workflow-delivery-revalidation-unavailable");
        }
        if (
          engineRun.current_workspace_revision !==
          engineRun.baseline_workspace_revision
        ) {
          throw new Error("workflow-delivery-revalidation-unavailable");
        }
      } else {
        const result = this.#worker.revalidateDelivery({
          runId,
          deliveryRevision: delivery.revision,
          plan: structuredClone(delivery.plan),
          tasks: priorRows
            .filter((row) => compatible.has(row.task_id))
            .map((row) => ({
              taskId: row.task_id,
              deliveryRevision: row.delivery_revision,
              state: row.state,
              phase: row.phase,
            })),
          invalidatedTaskIds: [...invalidated].sort(),
          baselineRevisionId: engineRun.baseline_workspace_revision,
          currentWorkspaceRevisionId: engineRun.current_workspace_revision,
        });
        const resultIds = new Set(result.invalidatedTaskIds);
        if (
          !Array.isArray(result.invalidatedTaskIds) ||
          resultIds.size !== result.invalidatedTaskIds.length ||
          [...invalidated].some((taskId) => !resultIds.has(taskId)) ||
          [...resultIds].some((taskId) => !priorById.has(taskId)) ||
          !SHA256.test(result.baselineRevisionId) ||
          !SHA256.test(result.currentWorkspaceRevisionId)
        ) {
          throw new Error("workflow-delivery-revalidation-invalid");
        }
        invalidated = resultIds;
        revalidatedWorkspace = {
          baselineRevisionId: result.baselineRevisionId,
          currentWorkspaceRevisionId: result.currentWorkspaceRevisionId,
        };
      }
    }
    const deliveryBindings = delivery.approvalProofs
      ? ([
          {
            runId,
            gate: "gate-a" as const,
            revision: delivery.revision,
            receiptHash: delivery.receiptHash,
            approvalProof: structuredClone(delivery.approvalProofs.gateA),
            operationId: `bind-a-${hash(
              runId,
              String(delivery.revision),
              delivery.approvalProofs.gateA.recordHash,
            ).slice(0, 40)}`,
            lease,
          },
          {
            runId,
            gate: "gate-b" as const,
            revision: delivery.revision,
            receiptHash: delivery.receiptHash,
            approvalProof: structuredClone(delivery.approvalProofs.gateB),
            operationId: `bind-b-${hash(
              runId,
              String(delivery.revision),
              delivery.approvalProofs.gateB.recordHash,
            ).slice(0, 40)}`,
            lease,
          },
        ] as const)
      : ([
          {
            runId,
            gate: delivery.gate,
            revision: delivery.revision,
            receiptHash: delivery.receiptHash,
            operationId: `bind-${hash(
              runId,
              String(delivery.revision),
              delivery.receiptHash,
            ).slice(0, 40)}`,
            lease,
          },
        ] as const);
    this.#runStore.bindDeliveriesAtomically(deliveryBindings, (database) => {
      const engineLease = database
        .prepare(
          `SELECT state, lease_expires_at
             FROM workflow_engine_operations
             WHERE run_id = ? AND lease_token = ?`,
        )
        .get(runId, lease.token) as
        | { state: string; lease_expires_at: number | null }
        | undefined;
      if (
        engineLease?.state !== "running" ||
        engineLease.lease_expires_at === null ||
        engineLease.lease_expires_at < this.#now()
      ) {
        throw new Error("lease-fenced");
      }
      database
        .prepare(
          `INSERT INTO workflow_engine_runs(
             run_id, current_revision, delivery_diagnostics_json,
             next_queue_position
           ) VALUES (?, ?, NULL, 1)
           ON CONFLICT(run_id) DO UPDATE SET
             current_revision = excluded.current_revision,
             verification_json = NULL,
             delivery_diagnostics_json = NULL`,
        )
        .run(runId, delivery.revision);
      if (revalidatedWorkspace) {
        database
          .prepare(
            `UPDATE workflow_engine_runs
             SET baseline_workspace_revision = ?,
                 current_workspace_revision = ?, cleanup_state = 'retained'
             WHERE run_id = ?`,
          )
          .run(
            revalidatedWorkspace.baselineRevisionId,
            revalidatedWorkspace.currentWorkspaceRevisionId,
            runId,
          );
      }
      database
        .prepare(
          `INSERT INTO workflow_engine_deliveries(
             run_id, revision, gate, receipt_hash, plan_json
           ) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(run_id, revision) DO NOTHING`,
        )
        .run(
          runId,
          delivery.revision,
          delivery.gate,
          delivery.receiptHash,
          serializedPlan,
        );

      const admitted = new Set<string>();
      delivery.plan.tasks.forEach((task, taskOrder) => {
        admitted.add(task.taskId);
        const taskJson = JSON.stringify(task);
        const prior = priorById.get(task.taskId);
        if (!prior) {
          database
            .prepare(
              `INSERT INTO workflow_engine_tasks(
                 run_id, task_id, task_order, delivery_revision, plan_json,
                 state, phase
               ) VALUES (?, ?, ?, ?, ?, 'pending', 'red')`,
            )
            .run(runId, task.taskId, taskOrder, delivery.revision, taskJson);
          return;
        }
        if (compatible.has(task.taskId) && !invalidated.has(task.taskId)) {
          database
            .prepare(
              `UPDATE workflow_engine_tasks
               SET task_order = ?, plan_json = ?
               WHERE run_id = ? AND task_id = ?`,
            )
            .run(taskOrder, taskJson, runId, task.taskId);
          return;
        }
        database
          .prepare(
            `UPDATE workflow_engine_tasks
             SET task_order = ?, delivery_revision = ?, plan_json = ?,
                 state = 'pending', phase = 'red', pause_code = NULL,
                 context_request_json = NULL, attempt_diagnostic_json = NULL,
                 queue_position = NULL
             WHERE run_id = ? AND task_id = ?`,
          )
          .run(taskOrder, delivery.revision, taskJson, runId, task.taskId);
      });
      for (const row of priorRows) {
        if (!admitted.has(row.task_id)) {
          database
            .prepare(
              `DELETE FROM workflow_engine_tasks
               WHERE run_id = ? AND task_id = ?`,
            )
            .run(runId, row.task_id);
        }
      }
    });
  }

  #cancelledDelivery(
    runId: string,
    operationId: string,
    error: unknown,
    signal: AbortSignal | undefined,
    lease: OperationLease,
  ): Record<string, unknown> | undefined {
    if (!signal || !isCancellationException(error, signal)) return undefined;
    try {
      this.#runStore.assertLease(lease);
      if (
        ["validating-delivery", "ready"].includes(
          this.#runStore.status(runId).state,
        )
      ) {
        this.#transition(
          runId,
          "paused",
          `${operationId}:delivery-cancelled`,
          "operation-cancelled",
          lease,
        );
      }
    } catch (failure) {
      if (!(failure instanceof Error) || failure.message !== "lease-fenced")
        throw failure;
    } finally {
      this.#interruptOperation(runId, operationId);
    }
    return this.#statusByRun(runId);
  }

  #deliveryFailure(
    runId: string,
    operationId: string,
    error: unknown,
    lease: OperationLease,
  ): Record<string, unknown> | undefined {
    if (!(error instanceof DeliveryValidationError)) return undefined;
    this.#leasedTransaction(lease, () => {
      this.#database
        .prepare(
          `UPDATE workflow_engine_runs
           SET delivery_diagnostics_json = ? WHERE run_id = ?`,
        )
        .run(JSON.stringify(error.diagnostics), runId);
    });
    this.#transition(
      runId,
      "paused",
      `${operationId}:delivery-invalid`,
      "delivery-invalid",
      lease,
    );
    return {
      ...this.#statusByRun(runId),
      delivery: {
        code: "delivery-invalid",
        diagnostics: [...error.diagnostics],
      },
    };
  }

  #setTask(
    runId: string,
    taskId: string,
    values: {
      state?: string;
      phase?: "red" | "green" | "refactor";
      pauseCode?: string | null;
      contextRequest?: WorkflowContextRequest | null;
      attemptDiagnostic?: SafeAttemptDiagnostic | null;
      routeId?: string | null;
      routeFingerprint?: string | null;
      queuePosition?: number | null;
    },
    lease?: OperationLease,
  ): void {
    const assignments: string[] = [];
    const parameters: Array<string | number | null> = [];
    if (values.state !== undefined) {
      assignments.push("state = ?");
      parameters.push(values.state);
    }
    if (values.phase !== undefined) {
      assignments.push("phase = ?");
      parameters.push(values.phase);
    }
    if (values.pauseCode !== undefined) {
      assignments.push("pause_code = ?");
      parameters.push(values.pauseCode);
    }
    if (values.contextRequest !== undefined) {
      assignments.push("context_request_json = ?");
      parameters.push(
        values.contextRequest === null
          ? null
          : JSON.stringify(
              normalizeWorkflowContextRequest(values.contextRequest),
            ),
      );
    }
    if (values.attemptDiagnostic !== undefined) {
      assignments.push("attempt_diagnostic_json = ?");
      parameters.push(
        values.attemptDiagnostic === null
          ? null
          : JSON.stringify(values.attemptDiagnostic),
      );
    }
    if (values.routeId !== undefined) {
      assignments.push("route_id = ?");
      parameters.push(values.routeId);
    }
    if (values.routeFingerprint !== undefined) {
      assignments.push("route_fingerprint = ?");
      parameters.push(values.routeFingerprint);
    }
    if (values.queuePosition !== undefined) {
      assignments.push("queue_position = ?");
      parameters.push(values.queuePosition);
    }
    if (assignments.length === 0) return;
    const write = () => {
      this.#database
        .prepare(
          `UPDATE workflow_engine_tasks SET ${assignments.join(", ")}
           WHERE run_id = ? AND task_id = ?`,
        )
        .run(...parameters, runId, taskId);
    };
    if (lease) this.#leasedTransaction(lease, write);
    else write();
  }

  #setVerificationStatus(
    runId: string,
    status: WorkflowVerificationStatus | null,
    lease: OperationLease,
  ): void {
    const serialized =
      status === null
        ? null
        : JSON.stringify(normalizeWorkflowVerificationStatus(status));
    this.#leasedTransaction(lease, () => {
      this.#database
        .prepare(
          `UPDATE workflow_engine_runs SET verification_json = ?
           WHERE run_id = ?`,
        )
        .run(serialized, runId);
    });
  }

  #queueTask(
    runId: string,
    row: EngineTaskRow,
    lease: OperationLease,
    reason: "conflict" | "capacity" = "conflict",
  ): void {
    const pauseCode = reason === "capacity" ? "worker-capacity" : null;
    if (row.state === "queued" && row.queue_position !== null) {
      if (row.pause_code !== pauseCode)
        this.#setTask(runId, row.task_id, { pauseCode }, lease);
      return;
    }
    const engineRun = this.#engineRun(runId);
    this.#leasedTransaction(lease, () => {
      this.#setTask(runId, row.task_id, {
        state: "queued",
        pauseCode,
        queuePosition: engineRun.next_queue_position,
      });
      this.#database
        .prepare(
          `UPDATE workflow_engine_runs
           SET next_queue_position = next_queue_position + 1
           WHERE run_id = ?`,
        )
        .run(runId);
    });
  }

  #hasConflict(
    row: EngineTaskRow,
    rows: EngineTaskRow[],
    selectedTaskIds: ReadonlySet<string>,
  ): boolean {
    const candidate = this.#taskPlan(row);
    return rows.some((other) => {
      if (other.task_id === row.task_id || other.state === "verified") {
        return false;
      }
      if (other.state === "queued") {
        if (row.state !== "queued") return false;
        const candidatePosition = row.queue_position ?? Number.MAX_SAFE_INTEGER;
        const otherPosition = other.queue_position ?? Number.MAX_SAFE_INTEGER;
        if (
          otherPosition > candidatePosition ||
          (otherPosition === candidatePosition &&
            other.task_order > row.task_order)
        ) {
          return false;
        }
      }
      if (other.task_order > row.task_order && other.state === "pending") {
        return false;
      }
      if (
        other.state === "pending" &&
        !this.#dependenciesVerified(other, rows)
      ) {
        return false;
      }
      const conflict = taskConflicts(candidate, this.#taskPlan(other));
      return (
        conflict.taskLifetime ||
        (conflict.verification &&
          ([
            "pending",
            "phase-ready",
            "phase-running",
            "validating",
            "queued",
          ].includes(other.state) ||
            selectedTaskIds.has(other.task_id)))
      );
    });
  }

  #dependenciesVerified(row: EngineTaskRow, rows: EngineTaskRow[]): boolean {
    const byId = new Map(
      rows.map((candidate) => [candidate.task_id, candidate]),
    );
    return this.#taskPlan(row).dependsOn.every(
      (dependency) => byId.get(dependency)?.state === "verified",
    );
  }

  #recordWorkspaceFacts(
    runId: string,
    outcome: WorkflowAttemptOutcome,
    lease: OperationLease,
  ): void {
    const baselineRevisionId = outcome.baselineRevisionId;
    const currentWorkspaceRevisionId =
      outcome.kind === "phase-committed"
        ? outcome.isolatedRevisionId
        : outcome.currentWorkspaceRevisionId;
    if (
      (baselineRevisionId !== undefined && !SHA256.test(baselineRevisionId)) ||
      (currentWorkspaceRevisionId !== undefined &&
        !SHA256.test(currentWorkspaceRevisionId)) ||
      (outcome.kind !== "phase-committed" &&
        (baselineRevisionId === undefined) !==
          (currentWorkspaceRevisionId === undefined))
    ) {
      throw new Error("workflow-attempt-workspace-fact-invalid");
    }
    if (currentWorkspaceRevisionId === undefined) return;
    this.#leasedTransaction(lease, () => {
      this.#database
        .prepare(
          `UPDATE workflow_engine_runs
           SET baseline_workspace_revision = COALESCE(
                 baseline_workspace_revision, ?
               ),
               current_workspace_revision = ?,
               cleanup_state = CASE
                 WHEN ? IS NULL THEN cleanup_state ELSE 'retained'
               END
           WHERE run_id = ?`,
        )
        .run(
          baselineRevisionId ?? null,
          currentWorkspaceRevisionId,
          baselineRevisionId ?? null,
          runId,
        );
    });
  }

  #recordRouteFacts(
    runId: string,
    taskId: string,
    outcome: WorkflowAttemptOutcome,
    lease: OperationLease,
  ): void {
    if (
      (outcome.routeId === undefined) !==
        (outcome.routeFingerprint === undefined) ||
      (outcome.routeId !== undefined && !IDENTIFIER.test(outcome.routeId)) ||
      (outcome.routeFingerprint !== undefined &&
        !SHA256.test(outcome.routeFingerprint))
    ) {
      throw new Error("workflow-attempt-route-fact-invalid");
    }
    if (!outcome.routeId || !outcome.routeFingerprint) return;
    const routeId = outcome.routeId;
    const routeFingerprint = outcome.routeFingerprint;
    this.#leasedTransaction(lease, () => {
      this.#setTask(runId, taskId, {
        routeId,
        routeFingerprint,
      });
      this.#database
        .prepare(
          `UPDATE workflow_engine_runs
           SET route_id = ?, route_fingerprint = ? WHERE run_id = ?`,
        )
        .run(routeId, routeFingerprint, runId);
    });
  }

  async #runTask(
    runId: string,
    row: EngineTaskRow,
    operationId: string,
    signal: AbortSignal,
    lease: OperationLease,
    onActivity?: (event: WorkflowActivityUpdate) => void,
  ): Promise<void> {
    const task = this.#taskPlan(row);
    const orderedPhases = phases(task);
    let phaseIndex = orderedPhases.indexOf(row.phase);
    let artifactAttempts = 0;
    const persistedContextRequest = row.context_request_json
      ? normalizeWorkflowContextRequest(
          JSON.parse(row.context_request_json) as unknown,
        )
      : undefined;
    const persistedRedArtifactCorrection =
      row.phase === "green" &&
      persistedContextRequest !== undefined &&
      classifyPersistedContextRequest(persistedContextRequest, task, "green")
        .code === "red-artifact-constraint";
    let redArtifactCorrection =
      row.phase === "green" &&
      (row.pause_code === "red-artifact-constraint" ||
        persistedRedArtifactCorrection);
    let requestedContext = persistedContextRequest;
    let correctionContextRequest = redArtifactCorrection
      ? persistedContextRequest
      : undefined;
    if (phaseIndex < 0) throw new Error("workflow-task-phase-invalid");
    while (phaseIndex < orderedPhases.length) {
      const phase = orderedPhases[phaseIndex];
      if (signal.aborted) {
        this.#setTask(
          runId,
          row.task_id,
          {
            state: "paused",
            phase,
            pauseCode: "operation-cancelled",
            contextRequest: null,
            queuePosition: null,
          },
          lease,
        );
        return;
      }
      const current = this.#engineRun(runId);
      if (current.current_revision === null)
        throw new Error("delivery-not-bound");
      const verificationStatus = current.verification_json
        ? normalizeWorkflowVerificationStatus(
            JSON.parse(current.verification_json) as unknown,
          )
        : undefined;
      const plan = this.#planForRevision(runId, row.delivery_revision);
      const repair =
        verificationStatus?.scope === "change-task-affected" &&
        verificationStatus.attribution === "introduced" &&
        verificationStatus.taskId === row.task_id &&
        verificationStatus.failureIdentities &&
        verificationStatus.failureIdentities.length > 0
          ? {
              attribution: "introduced" as const,
              failureIdentities: [...verificationStatus.failureIdentities],
            }
          : undefined;
      const artifactCorrection =
        redArtifactCorrection && phase === "green"
          ? {
              code: "red-artifact-constraint" as const,
              attempt: artifactAttempts + 1,
              maxAttempts: plan.verification.artifactCorrection.maxAttempts,
              ...(correctionContextRequest
                ? {
                    contextRequest: structuredClone(correctionContextRequest),
                  }
                : {}),
            }
          : undefined;
      this.#setTask(
        runId,
        row.task_id,
        {
          state: "phase-running",
          phase,
          pauseCode: artifactCorrection?.code ?? null,
          contextRequest: requestedContext ?? null,
          attemptDiagnostic: null,
          queuePosition: null,
        },
        lease,
      );
      let outcome: WorkflowAttemptOutcome;
      try {
        outcome = await this.#worker.runAttempt({
          runId,
          operationId,
          deliveryRevision: row.delivery_revision,
          taskId: row.task_id,
          phase,
          task: structuredClone(task),
          plan: structuredClone(plan),
          ...(current.baseline_workspace_revision
            ? { baselineRevisionId: current.baseline_workspace_revision }
            : {}),
          ...(current.current_workspace_revision
            ? {
                currentWorkspaceRevisionId: current.current_workspace_revision,
              }
            : {}),
          ...(row.route_id || current.route_id
            ? { routeId: row.route_id ?? current.route_id ?? undefined }
            : {}),
          ...(row.route_fingerprint || current.route_fingerprint
            ? {
                routeFingerprint:
                  row.route_fingerprint ??
                  current.route_fingerprint ??
                  undefined,
              }
            : {}),
          ...(repair ? { repair } : {}),
          ...(artifactCorrection ? { artifactCorrection } : {}),
          ...(requestedContext ? { contextRequest: requestedContext } : {}),
          signal,
          onActivity: (event) => {
            const projection = this.#runStore.status(runId);
            emitWorkflowActivity(onActivity, {
              ...event,
              stage: projection.stage,
              runId,
              ...(projection.change ? { change: projection.change } : {}),
              taskId: row.task_id,
              phase,
              objective: task.objective,
              legalCommands: ["status", "cancel", "discard"],
            });
          },
        });
      } catch (error) {
        if (isCancellationException(error, signal)) {
          outcome = { kind: "operation-cancelled", code: "cancelled" };
        } else {
          throw error;
        }
      }
      if (!isRecord(outcome) || typeof outcome.kind !== "string") {
        throw new Error("workflow-attempt-outcome-invalid");
      }
      this.#recordWorkspaceFacts(runId, outcome, lease);
      this.#recordRouteFacts(runId, row.task_id, outcome, lease);
      if (outcome.routeId && outcome.routeFingerprint) {
        row.route_id = outcome.routeId;
        row.route_fingerprint = outcome.routeFingerprint;
      }
      if (
        outcome.kind !== "phase-committed" &&
        outcome.kind !== "operation-cancelled" &&
        outcome.verification
      ) {
        this.#setVerificationStatus(runId, outcome.verification, lease);
      }
      if (
        outcome.kind !== "phase-committed" &&
        outcome.kind !== "operation-cancelled" &&
        outcome.contextRequest
      ) {
        requestedContext = normalizeWorkflowContextRequest(
          outcome.contextRequest,
        );
      }
      if (
        outcome.kind !== "phase-committed" &&
        outcome.kind !== "operation-cancelled" &&
        outcome.attemptDiagnostic
      ) {
        const previous = row.attempt_diagnostic_json
          ? (JSON.parse(row.attempt_diagnostic_json) as SafeAttemptDiagnostic)
          : undefined;
        const fingerprint = hash(
          outcome.code,
          outcome.attemptDiagnostic.finalCategory ?? "unknown",
          outcome.attemptDiagnostic.schema ?? "unknown",
          JSON.stringify(outcome.attemptDiagnostic.identityMismatch ?? []),
        ).slice(0, 16);
        const sameFailure = previous?.fingerprint === fingerprint;
        const sameFailureCount = sameFailure
          ? (previous?.sameFailureCount ?? 1) + 1
          : 1;
        const attemptDiagnostic = {
          ...outcome.attemptDiagnostic,
          fingerprint,
          sameFailureCount,
          ...(sameFailureCount > 1
            ? { action: "rebind-or-revise-delivery" as const }
            : {}),
        };
        this.#setTask(runId, row.task_id, { attemptDiagnostic }, lease);
        row.attempt_diagnostic_json = JSON.stringify(attemptDiagnostic);
      }
      if (outcome.kind === "retryable" && outcome.retryPolicy === "artifact") {
        if (outcome.code === "red-artifact-constraint") {
          redArtifactCorrection = true;
          correctionContextRequest = outcome.contextRequest
            ? normalizeWorkflowContextRequest(outcome.contextRequest)
            : correctionContextRequest;
          requestedContext = correctionContextRequest ?? requestedContext;
        }
        artifactAttempts += 1;
        const maxAttempts = plan.verification.artifactCorrection.maxAttempts;
        if (artifactAttempts < maxAttempts) {
          this.#setTask(
            runId,
            row.task_id,
            {
              state: "retryable",
              phase,
              pauseCode: redArtifactCorrection
                ? "red-artifact-constraint"
                : outcome.code,
              contextRequest: requestedContext ?? null,
              queuePosition: null,
            },
            lease,
          );
          emitWorkflowActivity(onActivity, {
            state: "retrying",
            stage: this.#runStore.status(runId).stage,
            runId,
            taskId: row.task_id,
            phase,
            objective: task.objective,
            legalCommands: ["status", "cancel", "discard"],
            code: outcome.code,
            attempt: artifactAttempts,
            maxAttempts,
            wait: "artifact-correction",
          });
          continue;
        }
      }
      if (outcome.kind === "phase-committed") {
        if (
          !SHA256.test(outcome.artifactHash) ||
          !SHA256.test(outcome.isolatedRevisionId) ||
          (outcome.baselineRevisionId !== undefined &&
            !SHA256.test(outcome.baselineRevisionId)) ||
          outcome.classification !== expectedClassification(phase)
        ) {
          throw new Error("workflow-attempt-fact-invalid");
        }
        if (repair) {
          this.#setVerificationStatus(runId, null, lease);
          this.#setTask(
            runId,
            row.task_id,
            {
              state: "verified",
              phase,
              pauseCode: null,
              contextRequest: null,
              attemptDiagnostic: null,
              queuePosition: null,
            },
            lease,
          );
          return;
        }
        artifactAttempts = 0;
        redArtifactCorrection = false;
        requestedContext = undefined;
        correctionContextRequest = undefined;
        phaseIndex += 1;
        if (phaseIndex >= orderedPhases.length) {
          this.#setTask(
            runId,
            row.task_id,
            {
              state: "verified",
              phase,
              pauseCode: null,
              contextRequest: null,
              attemptDiagnostic: null,
              queuePosition: null,
            },
            lease,
          );
          return;
        }
        this.#setTask(
          runId,
          row.task_id,
          {
            state: "phase-ready",
            phase: orderedPhases[phaseIndex],
            pauseCode: null,
            contextRequest: null,
            attemptDiagnostic: null,
            queuePosition: null,
          },
          lease,
        );
        continue;
      }
      if (outcome.kind === "operation-cancelled") {
        this.#setTask(
          runId,
          row.task_id,
          {
            state: "paused",
            phase,
            pauseCode: "operation-cancelled",
            contextRequest: null,
            queuePosition: null,
          },
          lease,
        );
        return;
      }
      if (
        outcome.kind === "paused" ||
        outcome.kind === "retryable" ||
        outcome.kind === "approval-needed"
      ) {
        if (typeof outcome.code !== "string" || outcome.code.length === 0) {
          throw new Error("workflow-attempt-outcome-invalid");
        }
        const approvalCodeInvalid =
          outcome.kind === "approval-needed" &&
          !isWorkflowApprovalCode(outcome.code);
        this.#setTask(
          runId,
          row.task_id,
          {
            state: approvalCodeInvalid ? "paused" : outcome.kind,
            phase,
            pauseCode: approvalCodeInvalid
              ? "approval-code-invalid"
              : outcome.code,
            contextRequest: approvalCodeInvalid
              ? null
              : (requestedContext ?? null),
            queuePosition: null,
          },
          lease,
        );
        return;
      }
      throw new Error("workflow-attempt-outcome-invalid");
    }
  }

  #firstPaused(rows: EngineTaskRow[]): EngineTaskRow | undefined {
    return (
      rows.find((row) => row.state === "approval-needed") ??
      rows.find((row) => ["paused", "retryable"].includes(row.state))
    );
  }

  #recoverLegacyContextApproval(runId: string): boolean {
    const projection = this.#runStore.status(runId);
    if (!["approval-needed", "paused"].includes(projection.state)) return false;
    const rows = this.#tasks(runId);
    const approvalRows = rows.filter((row) => row.state === "approval-needed");
    if (approvalRows.length === 0) return false;
    const reclassified = rows.flatMap((row) => {
      if (
        row.state !== "approval-needed" ||
        row.pause_code !== "boundary-review-needed" ||
        row.context_request_json === null
      ) {
        return [];
      }
      try {
        const request = normalizeWorkflowContextRequest(
          JSON.parse(row.context_request_json) as unknown,
        );
        const classified = classifyPersistedContextRequest(
          request,
          this.#taskPlan(row),
          row.phase,
        );
        if (classified.kind === "approval-needed") return [];
        return [
          {
            row,
            state: classified.kind === "retryable" ? "retryable" : "paused",
            code: classified.code,
            contextRequest: JSON.stringify(
              normalizeWorkflowContextRequest(classified.contextRequest),
            ),
          },
        ];
      } catch {
        return [];
      }
    });
    const reclassifiedTaskIds = new Set(
      reclassified.map((entry) => entry.row.task_id),
    );
    const retainedApprovals = approvalRows.filter(
      (row) => !reclassifiedTaskIds.has(row.task_id),
    );
    const updateTasks = (database: DatabaseSync) => {
      for (const entry of reclassified) {
        const updated = database
          .prepare(
            `UPDATE workflow_engine_tasks
             SET state = ?, phase = ?, pause_code = ?, context_request_json = ?,
                 queue_position = NULL
             WHERE run_id = ? AND task_id = ?
               AND state = 'approval-needed'
               AND pause_code = 'boundary-review-needed'`,
          )
          .run(
            entry.state,
            entry.row.phase,
            entry.code,
            entry.contextRequest,
            runId,
            entry.row.task_id,
          );
        if (Number(updated.changes) !== 1) {
          throw new Error("workflow-legacy-context-race");
        }
      }
    };
    const transitionWithUpdates = (
      to: "paused" | "approval-needed",
      code: string,
    ) =>
      this.#runStore.transitionAtomically(
        {
          runId,
          to,
          operationId: `legacy-context-${hash(
            runId,
            String(projection.sequence),
            to,
            code,
            JSON.stringify(
              reclassified.map((entry) => [entry.row.task_id, entry.code]),
            ),
          ).slice(0, 40)}`,
          code,
        },
        updateTasks,
      );
    if (retainedApprovals.length > 0) {
      if (projection.state === "approval-needed") {
        if (reclassified.length === 0) return false;
        this.#transaction(() => updateTasks(this.#database));
      } else {
        transitionWithUpdates(
          "approval-needed",
          retainedApprovals[0].pause_code ?? "approval-code-invalid",
        );
      }
      return true;
    }
    const first = reclassified[0];
    if (!first) return false;
    transitionWithUpdates("paused", first.code);
    return true;
  }

  async #finishChange(
    runId: string,
    operationId: string,
    signal: AbortSignal,
    lease: OperationLease,
    repairCycles: Map<string, number>,
    onActivity?: (event: WorkflowActivityUpdate) => void,
  ): Promise<Record<string, unknown>> {
    const plan = this.#currentPlan(runId);
    let engineRun = this.#engineRun(runId);
    if (engineRun.current_revision === null)
      throw new Error("delivery-not-bound");
    const deliveryRevision = engineRun.current_revision;
    this.#transition(
      runId,
      "change-verifying",
      `${operationId}:change-verifying`,
      undefined,
      lease,
    );
    const projection = this.#runStore.status(runId);
    emitWorkflowActivity(onActivity, {
      state: "verifying",
      stage: projection.stage,
      runId,
      ...(projection.change ? { change: projection.change } : {}),
      objective: projection.change
        ? `verify change ${projection.change}`
        : "verify workflow change",
      legalCommands: ["status", "cancel", "discard"],
    });
    const verification = await this.#changeVerifier.verify({
      runId,
      deliveryRevision,
      plan: structuredClone(plan),
      ...(engineRun.baseline_workspace_revision
        ? { baselineRevisionId: engineRun.baseline_workspace_revision }
        : {}),
      ...(engineRun.current_workspace_revision
        ? {
            currentWorkspaceRevisionId: engineRun.current_workspace_revision,
          }
        : {}),
      signal,
    });
    this.#runStore.assertLease(lease);
    if (verification.kind !== "verified") {
      if (verification.verification) {
        this.#setVerificationStatus(runId, verification.verification, lease);
      }
      if (
        verification.code === "verification-repair-required" &&
        verification.verification?.scope === "change-task-affected" &&
        verification.verification.attribution === "introduced" &&
        verification.verification.taskId
      ) {
        const task = this.#tasks(runId).find(
          (candidate) =>
            candidate.task_id === verification.verification?.taskId,
        );
        if (task) {
          const used = repairCycles.get(task.task_id) ?? 0;
          if (used >= plan.verification.repair.maxAttempts) {
            this.#setTask(
              runId,
              task.task_id,
              {
                state: "paused",
                phase: task.phase,
                pauseCode: "repair-attempts-exhausted",
                queuePosition: null,
              },
              lease,
            );
            this.#transition(
              runId,
              "paused",
              `${operationId}:repair-attempts-exhausted:${task.task_id}`,
              "repair-attempts-exhausted",
              lease,
            );
            return this.#statusByRun(runId);
          }
          repairCycles.set(task.task_id, used + 1);
          const taskPlan = this.#taskPlan(task);
          this.#setTask(
            runId,
            task.task_id,
            {
              state: "repairable",
              phase: taskPlan.phases.refactor ? "refactor" : "green",
              pauseCode: verification.code,
              queuePosition: null,
            },
            lease,
          );
          this.#transition(
            runId,
            "running",
            `${operationId}:repairable:${task.task_id}`,
            undefined,
            lease,
          );
          return this.#advance(
            runId,
            operationId,
            signal,
            lease,
            repairCycles,
            onActivity,
          );
        }
      }
      const approvalCodeInvalid =
        verification.kind === "approval-needed" &&
        !isWorkflowApprovalCode(verification.code);
      const state =
        verification.kind === "approval-needed" && !approvalCodeInvalid
          ? "approval-needed"
          : "paused";
      const code = approvalCodeInvalid
        ? "approval-code-invalid"
        : verification.code;
      this.#transition(
        runId,
        state,
        `${operationId}:change-verification-${state}`,
        code,
        lease,
      );
      return this.#statusByRun(runId);
    }
    if (verification.currentWorkspaceRevisionId !== undefined) {
      const currentWorkspaceRevisionId =
        verification.currentWorkspaceRevisionId;
      if (!SHA256.test(currentWorkspaceRevisionId)) {
        throw new Error("workflow-verification-workspace-fact-invalid");
      }
      this.#leasedTransaction(lease, () => {
        this.#database
          .prepare(
            `UPDATE workflow_engine_runs
             SET current_workspace_revision = ?, cleanup_state = 'retained'
             WHERE run_id = ?`,
          )
          .run(currentWorkspaceRevisionId, runId);
      });
      engineRun = this.#engineRun(runId);
    }
    this.#transition(
      runId,
      "ready-to-apply",
      `${operationId}:ready-to-apply`,
      undefined,
      lease,
    );
    if (!this.#application) {
      this.#transition(
        runId,
        "paused",
        `${operationId}:application-unavailable`,
        "application-unavailable",
        lease,
      );
      return this.#statusByRun(runId);
    }
    const transactionId = `apply-${hash(
      runId,
      String(deliveryRevision),
      operationId,
    ).slice(0, 40)}`;
    this.#leasedTransaction(lease, () => {
      this.#database
        .prepare(
          `UPDATE workflow_engine_runs SET transaction_id = ? WHERE run_id = ?`,
        )
        .run(transactionId, runId);
    });
    const applicationInput = {
      transactionId,
      runId,
      consumerRoot: this.#consumerRoot,
      deliveryRevision,
      plan: structuredClone(plan),
      ...(engineRun.baseline_workspace_revision
        ? { baselineRevisionId: engineRun.baseline_workspace_revision }
        : {}),
      ...(engineRun.current_workspace_revision
        ? {
            currentWorkspaceRevisionId: engineRun.current_workspace_revision,
          }
        : {}),
      signal,
    };
    let application: Record<string, unknown>;
    if (this.#application.prepare && this.#application.applyPrepared) {
      const prepared = await this.#application.prepare(applicationInput);
      this.#runStore.assertLease(lease);
      if (prepared.state !== "prepared") {
        return this.#settleApplication(
          runId,
          operationId,
          prepared,
          lease,
          onActivity,
        );
      }
      this.#transition(
        runId,
        "applying",
        `${operationId}:applying`,
        undefined,
        lease,
      );
      emitWorkflowActivity(onActivity, {
        state: "applying",
        stage: projection.stage,
        runId,
        ...(projection.change ? { change: projection.change } : {}),
        objective: projection.change
          ? `apply change ${projection.change}`
          : "apply workflow change",
        legalCommands: ["status", "cancel", "discard"],
      });
      const active = this.#active.get(runId);
      if (active) active.kind = "applying";
      application = await this.#application.applyPrepared(applicationInput);
    } else {
      this.#transition(
        runId,
        "applying",
        `${operationId}:applying`,
        undefined,
        lease,
      );
      emitWorkflowActivity(onActivity, {
        state: "applying",
        stage: projection.stage,
        runId,
        ...(projection.change ? { change: projection.change } : {}),
        objective: projection.change
          ? `apply change ${projection.change}`
          : "apply workflow change",
        legalCommands: ["status", "cancel", "discard"],
      });
      const active = this.#active.get(runId);
      if (active) active.kind = "applying";
      application = await this.#application.begin(applicationInput);
    }
    this.#runStore.assertLease(lease);
    return this.#settleApplication(
      runId,
      operationId,
      application,
      lease,
      onActivity,
    );
  }

  #settleApplication(
    runId: string,
    operationId: string,
    outcome: Record<string, unknown>,
    lease: OperationLease,
    onActivity?: (event: WorkflowActivityUpdate) => void,
  ): Record<string, unknown> {
    const state = outcome.state;
    if (state === "completed") {
      const current = this.#runStore.status(runId);
      if (current.state === "recovering") {
        this.#transition(
          runId,
          "completed",
          `${operationId}:recovered-complete`,
          undefined,
          lease,
        );
      } else if (
        current.state === "applying" ||
        current.state === "ready-to-apply"
      ) {
        this.#transition(
          runId,
          "completed",
          `${operationId}:apply-complete`,
          undefined,
          lease,
        );
      }
      this.#cleanupTerminal(runId, operationId, lease);
    } else if (state === "paused") {
      if (this.#runStore.status(runId).state === "applying") {
        this.#transition(
          runId,
          "recovering",
          `${operationId}:apply-recovering`,
          typeof outcome.code === "string" ? outcome.code : "recovery-required",
          lease,
        );
        const recovering = this.#runStore.status(runId);
        emitWorkflowActivity(onActivity, {
          state: "recovering",
          stage: recovering.stage,
          runId,
          ...(recovering.change ? { change: recovering.change } : {}),
          objective: recovering.change
            ? `recover change ${recovering.change}`
            : "recover workflow application",
          code:
            typeof outcome.code === "string"
              ? outcome.code
              : "recovery-required",
          legalCommands: ["status", "cancel", "discard"],
        });
      }
      this.#transition(
        runId,
        "paused",
        `${operationId}:apply-paused`,
        typeof outcome.code === "string" ? outcome.code : "recovery-required",
        lease,
      );
    } else if (state === "discarded") {
      if (this.#runStore.status(runId).state === "applying") {
        this.#transition(
          runId,
          "recovering",
          `${operationId}:discard-recovering`,
          "run-discarded",
          lease,
        );
        const recovering = this.#runStore.status(runId);
        emitWorkflowActivity(onActivity, {
          state: "recovering",
          stage: recovering.stage,
          runId,
          ...(recovering.change ? { change: recovering.change } : {}),
          objective: recovering.change
            ? `recover change ${recovering.change}`
            : "recover workflow application",
          code: "run-discarded",
          legalCommands: ["status"],
        });
      }
      this.#transition(
        runId,
        "discarded",
        `${operationId}:apply-discarded`,
        undefined,
        lease,
      );
      this.#cleanupTerminal(runId, operationId, lease);
    } else if (state === "recovering") {
      this.#transition(
        runId,
        "recovering",
        `${operationId}:application-recovering`,
        typeof outcome.code === "string" ? outcome.code : "recovery-required",
        lease,
      );
      const recovering = this.#runStore.status(runId);
      emitWorkflowActivity(onActivity, {
        state: "recovering",
        stage: recovering.stage,
        runId,
        ...(recovering.change ? { change: recovering.change } : {}),
        objective: recovering.change
          ? `recover change ${recovering.change}`
          : "recover workflow application",
        code:
          typeof outcome.code === "string" ? outcome.code : "recovery-required",
        legalCommands: ["status", "cancel", "discard"],
      });
    } else {
      throw new Error("workflow-application-outcome-invalid");
    }
    return this.#statusByRun(runId);
  }

  #applicationContext(runId: string): WorkflowApplicationContext {
    const current = this.#engineRun(runId);
    if (current.current_revision === null)
      throw new Error("delivery-not-bound");
    return {
      runId,
      deliveryRevision: current.current_revision,
      plan: structuredClone(this.#currentPlan(runId)),
      ...(current.baseline_workspace_revision
        ? { baselineRevisionId: current.baseline_workspace_revision }
        : {}),
      ...(current.current_workspace_revision
        ? { currentWorkspaceRevisionId: current.current_workspace_revision }
        : {}),
    };
  }

  #cleanupTerminal(
    runId: string,
    _currentOperationId: string,
    lease?: OperationLease,
  ): void {
    if (lease) this.#runStore.assertLease(lease);
    this.#lifecycle?.cleanup(runId);
    const cleanup = () => {
      this.#database
        .prepare("DELETE FROM workflow_engine_tasks WHERE run_id = ?")
        .run(runId);
      this.#database
        .prepare("DELETE FROM workflow_engine_deliveries WHERE run_id = ?")
        .run(runId);
      this.#database
        .prepare(`DELETE FROM workspace_revisions WHERE owner_run_id = ?`)
        .run(runId);
      this.#database
        .prepare(`DELETE FROM apply_transactions WHERE owner_run_id = ?`)
        .run(runId);
      this.#database
        .prepare(
          `UPDATE workflow_engine_runs
           SET baseline_workspace_revision = NULL,
               current_workspace_revision = NULL,
               transaction_id = NULL, verification_json = NULL,
               cleanup_state = 'complete'
           WHERE run_id = ?`,
        )
        .run(runId);
    };
    if (lease) this.#leasedTransaction(lease, cleanup);
    else this.#transaction(cleanup);
  }

  #waitForCapacity(signal: AbortSignal): Promise<void> {
    if (signal.aborted || this.#activeTasks < LIMITS.maxActiveChildSessions)
      return Promise.resolve();
    return new Promise((resolve) => {
      const wake = () => {
        this.#capacityWaiters.delete(wake);
        signal.removeEventListener("abort", wake);
        resolve();
      };
      this.#capacityWaiters.add(wake);
      signal.addEventListener("abort", wake, { once: true });
    });
  }

  async #advance(
    runId: string,
    operationId: string,
    signal: AbortSignal,
    lease: OperationLease,
    repairCycles: Map<string, number> = new Map(),
    onActivity?: (event: WorkflowActivityUpdate) => void,
  ): Promise<Record<string, unknown>> {
    this.#transition(
      runId,
      "running",
      `${operationId}:running`,
      undefined,
      lease,
    );
    const run = this.#runStore.status(runId);
    emitWorkflowActivity(onActivity, {
      state: "running",
      stage: run.stage,
      runId,
      ...(run.change ? { change: run.change } : {}),
      objective: run.change ? `change ${run.change}` : "workflow run",
      legalCommands: ["status", "cancel", "discard"],
    });
    const existingVerification = this.#engineRun(runId).verification_json;
    const repairStatus = existingVerification
      ? normalizeWorkflowVerificationStatus(
          JSON.parse(existingVerification) as unknown,
        )
      : undefined;
    const retainsRepairContext =
      repairStatus?.scope === "change-task-affected" &&
      repairStatus.attribution === "introduced" &&
      repairStatus.taskId !== undefined &&
      this.#tasks(runId).some(
        (task) =>
          task.task_id === repairStatus.taskId && task.state !== "verified",
      );
    if (!retainsRepairContext) {
      this.#setVerificationStatus(runId, null, lease);
    }
    const attempted = new Set<string>();
    let madeProgress = true;
    while (madeProgress && !signal.aborted) {
      madeProgress = false;
      const rows = this.#tasks(runId);
      const runnable: Array<{
        row: EngineTaskRow;
        before: string;
      }> = [];
      const selectedTaskIds = new Set<string>();
      let capacityBlocked = false;
      for (const row of rows) {
        if (row.state === "verified" || attempted.has(row.task_id)) continue;
        if (!this.#dependenciesVerified(row, rows)) {
          if (row.state !== "pending") {
            this.#setTask(
              runId,
              row.task_id,
              {
                state: "pending",
                pauseCode: null,
                queuePosition: null,
              },
              lease,
            );
          }
          continue;
        }
        if (this.#hasConflict(row, this.#tasks(runId), selectedTaskIds)) {
          this.#queueTask(runId, row, lease);
          continue;
        }
        if (
          this.#activeTasks + runnable.length >=
          LIMITS.maxActiveChildSessions
        ) {
          this.#queueTask(runId, row, lease, "capacity");
          capacityBlocked = true;
          continue;
        }
        const before = `${row.state}:${row.phase}`;
        attempted.add(row.task_id);
        selectedTaskIds.add(row.task_id);
        runnable.push({ row, before });
      }
      if (runnable.length === 0 && capacityBlocked) {
        await this.#waitForCapacity(signal);
        madeProgress = true;
        continue;
      }
      this.#activeTasks += runnable.length;
      const settled = await Promise.allSettled(
        runnable.map(({ row }) =>
          this.#runTask(
            runId,
            row,
            operationId,
            signal,
            lease,
            onActivity,
          ).finally(() => {
            this.#activeTasks--;
            for (const wake of this.#capacityWaiters) wake();
          }),
        ),
      );
      const rejected = settled.find(
        (outcome): outcome is PromiseRejectedResult =>
          outcome.status === "rejected",
      );
      if (rejected) throw rejected.reason;
      for (const { row, before } of runnable) {
        const after = this.#tasks(runId).find(
          (candidate) => candidate.task_id === row.task_id,
        );
        if (after && `${after.state}:${after.phase}` !== before) {
          madeProgress = true;
        }
      }
    }

    if (signal.aborted) {
      const current = this.#runStore.status(runId);
      if (!["paused", "discarded", "completed"].includes(current.state)) {
        this.#transition(
          runId,
          "paused",
          `${operationId}:cancelled`,
          "operation-cancelled",
          lease,
        );
      }
      return this.#statusByRun(runId);
    }
    const rows = this.#tasks(runId);
    const paused = this.#firstPaused(rows);
    if (paused) {
      this.#transition(
        runId,
        paused.state === "approval-needed" ? "approval-needed" : "paused",
        `${operationId}:task-paused:${paused.task_id}`,
        paused.pause_code ?? "task-paused",
        lease,
      );
      return this.#statusByRun(runId);
    }
    if (rows.every((row) => row.state === "verified")) {
      return this.#finishChange(
        runId,
        operationId,
        signal,
        lease,
        repairCycles,
        onActivity,
      );
    }
    this.#transition(
      runId,
      "paused",
      `${operationId}:scheduler-stalled`,
      "scheduler-integrity-paused",
      lease,
    );
    return this.#statusByRun(runId);
  }

  #safeAttemptDiagnostic(
    _runId: string,
    row: EngineTaskRow | undefined,
  ): SafeAttemptDiagnostic | undefined {
    if (!row) return undefined;
    if (row.attempt_diagnostic_json) {
      try {
        return JSON.parse(row.attempt_diagnostic_json) as SafeAttemptDiagnostic;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  #statusByRun(runId: string): Record<string, unknown> {
    const projection = this.#runStore.status(runId);
    const rows = this.#tasks(runId);
    const queued = rows
      .filter((row) => row.state === "queued")
      .sort(
        (left, right) =>
          (left.queue_position ?? Number.MAX_SAFE_INTEGER) -
            (right.queue_position ?? Number.MAX_SAFE_INTEGER) ||
          left.task_order - right.task_order,
      );
    const firstPaused = this.#firstPaused(rows);
    let engineRun: EngineRunRow | undefined;
    try {
      engineRun = this.#engineRun(runId);
    } catch {
      engineRun = undefined;
    }
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
    const attemptDiagnostic = this.#safeAttemptDiagnostic(runId, firstPaused);
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
              (command) => command !== "rebind" || firstPaused !== undefined,
            ),
      ...(approval && projection.change
        ? {
            approval: {
              category: approval.category,
              requiredGates: approval.requiredGates,
              refs: approval.refs,
              designRequest: `/abel-design --change ${projection.change}`,
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

  async #withAvailableDelivery(
    outcome: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (
      outcome.stage !== "abel-implement" ||
      outcome.state !== "approval-needed" ||
      typeof outcome.change !== "string" ||
      !this.#deliverySource.discoverLatest
    ) {
      return outcome;
    }
    let available: WorkflowAvailableDelivery | undefined;
    try {
      const discover = this.#deliverySource.discoverLatest;
      const change = outcome.change;
      available = await cancellableRead(
        () =>
          discover.call(this.#deliverySource, {
            stage: "abel-implement",
            change,
            ...(signal ? { signal } : {}),
          }),
        signal,
      );
    } catch {
      return outcome;
    }
    const currentRevision =
      typeof outcome.deliveryRevision === "number"
        ? outcome.deliveryRevision
        : 0;
    if (
      !available ||
      !Number.isSafeInteger(available.deliveryRevision) ||
      available.deliveryRevision <= currentRevision ||
      !SHA256.test(available.receiptHash)
    ) {
      return outcome;
    }
    const conditionalCommands = Array.isArray(outcome.conditionalCommands)
      ? outcome.conditionalCommands.map((entry) =>
          isRecord(entry) && entry.command === "resume"
            ? {
                ...entry,
                satisfiedBy: {
                  deliveryRevision: available.deliveryRevision,
                  receiptHash: available.receiptHash,
                },
              }
            : entry,
        )
      : outcome.conditionalCommands;
    return {
      ...outcome,
      legalCommands: ["status", "resume", "discard"],
      availableDelivery: structuredClone(available),
      ...(conditionalCommands === undefined ? {} : { conditionalCommands }),
    };
  }

  #launchAdvance(
    runId: string,
    operationId: string,
    externalSignal?: AbortSignal,
    onActivity?: (event: WorkflowActivityUpdate) => void,
  ): Promise<Record<string, unknown>> {
    const lease = this.#operationLease(runId, operationId);
    const controller = new AbortController();
    const abortFromExternal = () => {
      controller.abort(
        externalSignal?.reason ?? new Error("operation-cancelled"),
      );
    };
    if (externalSignal?.aborted) abortFromExternal();
    else
      externalSignal?.addEventListener("abort", abortFromExternal, {
        once: true,
      });
    const active: ActiveOperation = {
      operationId,
      kind: "work",
      controller,
      settled: Promise.resolve({}),
    };
    this.#active.set(runId, active);
    const settled = (async () => {
      try {
        const outcome = await this.#advance(
          runId,
          operationId,
          controller.signal,
          lease,
          new Map(),
          onActivity,
        );
        return this.#commitOperation(runId, operationId, outcome);
      } catch (error) {
        this.#interruptOperation(runId, operationId);
        const controlSettled =
          controller.signal.aborted &&
          controller.signal.reason instanceof Error &&
          ["operation-cancelled", "run-discarded"].includes(
            controller.signal.reason.message,
          ) &&
          (isCancellationException(error, controller.signal) ||
            (error instanceof Error &&
              ["lease-fenced", "operation-journal-fenced"].includes(
                error.message,
              )));
        if (controlSettled) return this.#statusByRun(runId);
        throw error;
      } finally {
        externalSignal?.removeEventListener("abort", abortFromExternal);
        if (this.#active.get(runId) === active) this.#active.delete(runId);
      }
    })();
    active.settled = settled;
    return settled;
  }

  async #start(
    command: Extract<ControlCommand, { command: "start" }>,
    signal?: AbortSignal,
    onActivity?: (event: WorkflowActivityUpdate) => void,
  ) {
    const existingRun = this.#lookupRun(command.stage, command.change);
    if (existingRun) {
      this.#ensureEngineRun(existingRun);
      const replay = this.#operationReplay(
        existingRun,
        command.operationId,
        command.command,
      );
      if (replay) return replay;
      const restarted = this.#runStore.startRun({
        stage: command.stage,
        change: command.change,
        operationId: command.operationId,
      });
      if (restarted.state !== "created") {
        const begun = this.#beginOperation(
          existingRun,
          command.operationId,
          command.command,
        );
        if (begun) return begun;
        return this.#commitOperation(
          existingRun,
          command.operationId,
          this.#statusByRun(existingRun),
        );
      }
    }

    const runId =
      existingRun ??
      this.#runStore.startRun({
        stage: command.stage,
        change: command.change,
        operationId: command.operationId,
      }).runId;
    this.#ensureEngineRun(runId);
    const begun = this.#beginOperation(
      runId,
      command.operationId,
      command.command,
    );
    if (begun) return begun;
    const lease = this.#operationLease(runId, command.operationId);
    this.#transition(
      runId,
      "validating-delivery",
      `${command.operationId}:validating-delivery`,
      undefined,
      lease,
    );
    emitWorkflowActivity(onActivity, {
      state: "validating",
      stage: command.stage,
      runId,
      change: command.change,
      objective: `validate delivery ${command.change}`,
      legalCommands: ["status", "cancel", "discard"],
    });
    try {
      const delivery = await this.#loadDelivery(
        command.stage,
        command.change,
        undefined,
        undefined,
        signal,
      );
      this.#admitDelivery(runId, delivery, lease);
      this.#transition(
        runId,
        "ready",
        `${command.operationId}:delivery-ready`,
        undefined,
        lease,
      );
      return this.#launchAdvance(
        runId,
        command.operationId,
        signal,
        onActivity,
      );
    } catch (error) {
      const cancelled = this.#cancelledDelivery(
        runId,
        command.operationId,
        error,
        signal,
        lease,
      );
      if (cancelled) return cancelled;
      const failure = this.#deliveryFailure(
        runId,
        command.operationId,
        error,
        lease,
      );
      if (failure) {
        return this.#commitOperation(runId, command.operationId, failure);
      }
      this.#interruptOperation(runId, command.operationId);
      throw error;
    }
  }

  async #resume(
    command: Extract<ControlCommand, { command: "resume" }>,
    signal?: AbortSignal,
    onActivity?: (event: WorkflowActivityUpdate) => void,
  ) {
    const runId = this.#lookupRun(command.stage, command.change);
    if (!runId) throw new Error("run-not-found");
    this.#recoverLegacyContextApproval(runId);
    const replay = this.#beginOperation(
      runId,
      command.operationId,
      command.command,
    );
    if (replay) return replay;
    const lease = this.#operationLease(runId, command.operationId);
    const current = this.#runStore.status(runId);
    if (current.state === "recovering") {
      emitWorkflowActivity(onActivity, {
        state: "recovering",
        stage: current.stage,
        runId,
        ...(current.change ? { change: current.change } : {}),
        objective: current.change
          ? `recover change ${current.change}`
          : "recover workflow application",
        legalCommands: ["status", "cancel", "discard"],
      });
      const transactionId = this.#engineRun(runId).transaction_id;
      if (!transactionId || !this.#application) {
        this.#interruptOperation(runId, command.operationId);
        throw new Error("apply-recovery-unavailable");
      }
      const recovered = await this.#application.recover(
        transactionId,
        this.#applicationContext(runId),
      );
      this.#runStore.assertLease(lease);
      const outcome = this.#settleApplication(
        runId,
        command.operationId,
        recovered,
        lease,
        onActivity,
      );
      return this.#commitOperation(runId, command.operationId, outcome);
    }
    if (
      !["paused", "retryable", "approval-needed", "ready"].includes(
        current.state,
      )
    ) {
      this.#interruptOperation(runId, command.operationId);
      throw new Error("resume-not-allowed");
    }
    try {
      const engineRevision = this.#engineRun(runId).current_revision;
      const projectedRevision = current.deliveryRevision;
      const deliveryOutOfSync =
        projectedRevision !== undefined && projectedRevision !== engineRevision;
      if (
        current.state === "approval-needed" &&
        (command.deliveryRevision === undefined ||
          command.receiptHash === undefined ||
          command.deliveryRevision <=
            (engineRevision ?? projectedRevision ?? 0))
      ) {
        this.#interruptOperation(runId, command.operationId);
        throw new Error("approval-receipt-required");
      }
      if (
        command.deliveryRevision !== undefined ||
        engineRevision === null ||
        deliveryOutOfSync
      ) {
        this.#transition(
          runId,
          "validating-delivery",
          `${command.operationId}:validating-delivery`,
          undefined,
          lease,
        );
        emitWorkflowActivity(onActivity, {
          state: "validating",
          stage: command.stage,
          runId,
          change: command.change,
          objective: `validate delivery ${command.change}`,
          legalCommands: ["status", "cancel", "discard"],
        });
        const requestedRevision =
          command.deliveryRevision ??
          (deliveryOutOfSync ? projectedRevision : undefined);
        const projectedBinding = current.deliveryBindings.find(
          (binding) =>
            binding.gate === "gate-b" && binding.revision === requestedRevision,
        );
        const delivery = await this.#loadDelivery(
          command.stage,
          command.change,
          requestedRevision,
          command.receiptHash ?? projectedBinding?.receiptHash,
          signal,
        );
        this.#admitDelivery(runId, delivery, lease);
        this.#transition(
          runId,
          "ready",
          `${command.operationId}:delivery-ready`,
          undefined,
          lease,
        );
      } else if (current.state !== "ready") {
        this.#transition(
          runId,
          "ready",
          `${command.operationId}:resume-ready`,
          undefined,
          lease,
        );
      }
      return this.#launchAdvance(
        runId,
        command.operationId,
        signal,
        onActivity,
      );
    } catch (error) {
      const cancelled = this.#cancelledDelivery(
        runId,
        command.operationId,
        error,
        signal,
        lease,
      );
      if (cancelled) return cancelled;
      const failure = this.#deliveryFailure(
        runId,
        command.operationId,
        error,
        lease,
      );
      if (failure) {
        return this.#commitOperation(runId, command.operationId, failure);
      }
      this.#interruptOperation(runId, command.operationId);
      throw error;
    }
  }

  #rebind(command: Extract<ControlCommand, { command: "rebind" }>) {
    const runId = this.#lookupRun(command.stage, command.change);
    if (!runId) throw new Error("run-not-found");
    const replay = this.#beginOperation(
      runId,
      command.operationId,
      command.command,
    );
    if (replay) return replay;
    const lease = this.#operationLease(runId, command.operationId);
    const state = this.#runStore.status(runId).state;
    if (!["paused", "retryable"].includes(state)) {
      this.#interruptOperation(runId, command.operationId);
      throw new Error("rebind-not-allowed");
    }
    const task = this.#tasks(runId).find((row) =>
      ["paused", "retryable"].includes(row.state),
    );
    if (!task) {
      this.#interruptOperation(runId, command.operationId);
      throw new Error("rebind-task-unavailable");
    }
    const rebound = this.#worker.rebind({
      runId,
      taskId: task.task_id,
      task: structuredClone(this.#taskPlan(task)),
      role: "implementation-worker",
      routeId: command.routeId,
    });
    if (!rebound.ok) {
      this.#interruptOperation(runId, command.operationId);
      throw new Error(rebound.code);
    }
    const routeId = rebound.routeId ?? rebound.route?.id ?? command.routeId;
    const routeFingerprint =
      rebound.routeFingerprint ?? rebound.route?.fingerprint;
    if (
      !IDENTIFIER.test(routeId) ||
      (routeFingerprint !== undefined && !SHA256.test(routeFingerprint))
    ) {
      this.#interruptOperation(runId, command.operationId);
      throw new Error("route-rebind-result-invalid");
    }
    const priorRouteId = task.route_id ?? this.#engineRun(runId).route_id;
    const priorRouteFingerprint =
      task.route_fingerprint ?? this.#engineRun(runId).route_fingerprint;
    this.#leasedTransaction(lease, () => {
      this.#setTask(runId, task.task_id, {
        routeId,
        routeFingerprint: routeFingerprint ?? null,
      });
      this.#database
        .prepare(
          `UPDATE workflow_engine_runs
           SET route_id = ?, route_fingerprint = ? WHERE run_id = ?`,
        )
        .run(routeId, routeFingerprint ?? null, runId);
    });
    const outcome = {
      ...this.#statusByRun(runId),
      routeBinding: {
        routeId,
        ...(routeFingerprint ? { routeFingerprint } : {}),
      },
      operation: {
        kind: "route-rebound",
        ...(priorRouteId ? { priorRouteId } : {}),
        ...(priorRouteFingerprint ? { priorRouteFingerprint } : {}),
        routeId,
        ...(routeFingerprint ? { routeFingerprint } : {}),
      },
    };
    return this.#commitOperation(runId, command.operationId, outcome);
  }

  async #controlApply(
    runId: string,
    operationId: string,
    intent: "cancel" | "discard",
    lease: OperationLease,
    onActivity?: (event: WorkflowActivityUpdate) => void,
  ): Promise<Record<string, unknown>> {
    const transactionId = this.#engineRun(runId).transaction_id;
    if (!transactionId || !this.#application) {
      throw new Error("apply-recovery-unavailable");
    }
    const context = this.#applicationContext(runId);
    this.#application.requestControl(transactionId, intent, context);
    const active = this.#active.get(runId);
    if (active && active.operationId !== operationId) {
      active.controller.abort(
        new Error(
          intent === "cancel" ? "operation-cancelled" : "run-discarded",
        ),
      );
    }
    if (this.#runStore.status(runId).state === "applying") {
      this.#transition(
        runId,
        "recovering",
        `${operationId}:${intent}-recovering`,
        intent === "cancel" ? "operation-cancelled" : "run-discarded",
        lease,
      );
      const recovering = this.#runStore.status(runId);
      emitWorkflowActivity(onActivity, {
        state: "recovering",
        stage: recovering.stage,
        runId,
        ...(recovering.change ? { change: recovering.change } : {}),
        objective: recovering.change
          ? `recover change ${recovering.change}`
          : "recover workflow application",
        code: intent === "cancel" ? "operation-cancelled" : "run-discarded",
        legalCommands: ["status"],
      });
    }
    const recovered = await this.#application.recover(transactionId, context);
    this.#runStore.assertLease(lease);
    return this.#settleApplication(
      runId,
      operationId,
      recovered,
      lease,
      onActivity,
    );
  }

  async #abortActiveOperation(runId: string, reason: Error): Promise<void> {
    const pending: Promise<unknown>[] = [];
    for (const [controller, entry] of this.#commands) {
      if (
        !["start", "resume"].includes(entry.command.command) ||
        this.#lookupRun(entry.command.stage, entry.command.change) !== runId
      )
        continue;
      controller.abort(reason);
      pending.push(entry.settled);
    }
    const active = this.#active.get(runId);
    if (active) {
      active.controller.abort(reason);
      pending.push(active.settled);
    }
    const results = await Promise.allSettled(pending);
    for (const result of results) {
      if (result.status !== "rejected") continue;
      const error = result.reason;
      if (
        error !== reason &&
        !(
          error instanceof Error &&
          ["lease-fenced", "operation-journal-fenced"].includes(error.message)
        )
      )
        throw error;
    }
  }

  async #cancel(
    command: Extract<ControlCommand, { command: "cancel" }>,
    onActivity?: (event: WorkflowActivityUpdate) => void,
  ) {
    const runId = this.#lookupRun(command.stage, command.change);
    if (!runId) throw new Error("run-not-found");
    const replay = this.#beginOperation(
      runId,
      command.operationId,
      command.command,
    );
    if (replay) return replay;
    const lease = this.#operationLease(runId, command.operationId);
    const state = this.#runStore.status(runId).state;
    let outcome: Record<string, unknown>;
    if (state === "applying" || state === "recovering") {
      outcome = await this.#controlApply(
        runId,
        command.operationId,
        "cancel",
        lease,
        onActivity,
      );
    } else {
      const activeSettlement = this.#abortActiveOperation(
        runId,
        new Error("operation-cancelled"),
      );
      const current = this.#runStore.status(runId);
      if (
        !["paused", "discarded", "completed", "rejected"].includes(
          current.state,
        )
      ) {
        this.#transition(
          runId,
          "paused",
          `${command.operationId}:cancelled`,
          "operation-cancelled",
          lease,
        );
      }
      outcome = this.#statusByRun(runId);
      await activeSettlement;
    }
    outcome = {
      ...outcome,
      operation: { kind: "operation-cancelled" },
    };
    return this.#commitOperation(runId, command.operationId, outcome);
  }

  async #discard(
    command: Extract<ControlCommand, { command: "discard" }>,
    onActivity?: (event: WorkflowActivityUpdate) => void,
  ) {
    const runId = this.#lookupRun(command.stage, command.change);
    if (!runId) throw new Error("run-not-found");
    const replay = this.#beginOperation(
      runId,
      command.operationId,
      command.command,
    );
    if (replay) return replay;
    const lease = this.#operationLease(runId, command.operationId);
    const state = this.#runStore.status(runId).state;
    let outcome: Record<string, unknown>;
    if (state === "applying" || state === "recovering") {
      outcome = await this.#controlApply(
        runId,
        command.operationId,
        "discard",
        lease,
        onActivity,
      );
    } else {
      const activeSettlement = this.#abortActiveOperation(
        runId,
        new Error("run-discarded"),
      );
      const current = this.#runStore.status(runId);
      if (current.state !== "discarded") {
        if (["completed", "rejected"].includes(current.state)) {
          this.#interruptOperation(runId, command.operationId);
          throw new Error("discard-not-allowed");
        }
        this.#transition(
          runId,
          "discarded",
          `${command.operationId}:discarded`,
          undefined,
          lease,
        );
        await activeSettlement;
        this.#cleanupTerminal(runId, command.operationId, lease);
      } else {
        await activeSettlement;
      }
      outcome = this.#statusByRun(runId);
    }
    return this.#commitOperation(runId, command.operationId, outcome);
  }

  execute(
    value: unknown,
    signal?: AbortSignal,
    onActivity?: (event: WorkflowActivityUpdate) => void,
  ): Promise<Record<string, unknown>> {
    let command: ControlCommand;
    try {
      this.#assertOpen();
      if (this.#closing) throw new Error("workflow-engine-closed");
      command = assertControlCommand(value);
    } catch (error) {
      return Promise.reject(error);
    }
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
    // Register before execution can yield or invoke external callbacks.
    const settled = Promise.resolve()
      .then(() => this.#executeCommand(command, controller.signal, onActivity))
      .finally(() => {
        signal?.removeEventListener("abort", onAbort);
        this.#commands.delete(controller);
      });
    this.#commands.set(controller, { command, settled });
    return settled;
  }

  async #executeCommand(
    command: ControlCommand,
    signal?: AbortSignal,
    onActivity?: (event: WorkflowActivityUpdate) => void,
  ): Promise<Record<string, unknown>> {
    switch (command.command) {
      case "start":
        return this.#withAvailableDelivery(
          await this.#start(command, signal, onActivity),
          signal,
        );
      case "status": {
        const runId = this.#lookupRun(command.stage, command.change);
        if (!runId) {
          return {
            stage: command.stage,
            change: command.change,
            state: "not-started",
            durable: true,
            completed: false,
            legalCommands: ["start"],
            tasks: [],
            queue: [],
          };
        }
        this.#recoverLegacyContextApproval(runId);
        return this.#withAvailableDelivery(this.#statusByRun(runId), signal);
      }
      case "resume":
        return this.#withAvailableDelivery(
          await this.#resume(command, signal, onActivity),
          signal,
        );
      case "rebind":
        return this.#rebind(command);
      case "cancel":
        return this.#cancel(command, onActivity);
      case "discard":
        return this.#discard(command, onActivity);
    }
  }

  prepareBootstrapHandoff(
    input: Record<string, unknown>,
  ): Record<string, unknown> {
    this.#assertOpen();
    const acceptanceFacts = normalizeBootstrapAcceptanceFacts(
      input.acceptanceFacts,
    );
    const workspaceManifestHash =
      typeof input.workspaceManifestHash === "string" &&
      SHA256.test(input.workspaceManifestHash)
        ? input.workspaceManifestHash
        : undefined;
    if (
      typeof input.operationId !== "string" ||
      !IDENTIFIER.test(input.operationId) ||
      typeof input.runId !== "string" ||
      typeof input.change !== "string" ||
      !CHANGE_NAME.test(input.change) ||
      typeof input.receiptHash !== "string" ||
      !SHA256.test(input.receiptHash) ||
      typeof input.graphHash !== "string" ||
      !SHA256.test(input.graphHash) ||
      typeof input.acceptanceHash !== "string" ||
      !SHA256.test(input.acceptanceHash) ||
      (acceptanceFacts !== undefined) !==
        (workspaceManifestHash !== undefined) ||
      (acceptanceFacts !== undefined &&
        workspaceManifestHash !== undefined &&
        bootstrapAcceptanceHash(acceptanceFacts, workspaceManifestHash) !==
          input.acceptanceHash)
    ) {
      throw new Error("bootstrap-handoff-invalid");
    }
    this.#runStore.status(input.runId);
    const existing = this.#database
      .prepare(
        `SELECT handoff_id, owner_run_id, receipt_hash, state, facts_json
         FROM bootstrap_handoffs WHERE receipt_hash = ?`,
      )
      .get(input.receiptHash) as BootstrapRow | undefined;
    if (existing) {
      const outcome = parseJsonRecord(existing.facts_json);
      const existingAcceptanceFacts = normalizeBootstrapAcceptanceFacts(
        outcome.acceptanceFacts,
      );
      const storedBindingValid =
        outcome.handoffId === existing.handoff_id &&
        outcome.runId === existing.owner_run_id &&
        outcome.receiptHash === existing.receipt_hash &&
        outcome.selectorBeforeCutover === "bootstrap" &&
        existing.state === "prepared" &&
        outcome.state === "prepared" &&
        outcome.selectorCasPending === true;
      if (!storedBindingValid) throw new Error("bootstrap-handoff-invalid");
      const stableBindingMatches =
        existing.owner_run_id === input.runId &&
        outcome.change === input.change &&
        outcome.graphHash === input.graphHash;
      if (!stableBindingMatches) {
        throw new Error("bootstrap-handoff-conflict");
      }
      const acceptanceMatches =
        outcome.acceptanceHash === input.acceptanceHash &&
        canonicalJson(existingAcceptanceFacts ?? null) ===
          canonicalJson(acceptanceFacts ?? null) &&
        outcome.workspaceManifestHash === workspaceManifestHash;
      if (acceptanceMatches) return structuredClone(outcome);
      if (
        existing.state !== "prepared" ||
        outcome.state !== "prepared" ||
        outcome.selectorBeforeCutover !== "bootstrap" ||
        outcome.selectorCasPending !== true ||
        acceptanceFacts === undefined ||
        workspaceManifestHash === undefined
      ) {
        throw new Error("bootstrap-handoff-conflict");
      }
      const refreshedHandoffId = `handoff-${hash(
        input.runId,
        input.receiptHash,
        input.graphHash,
        input.acceptanceHash,
        workspaceManifestHash,
      ).slice(0, 40)}`;
      const refreshed = {
        ...outcome,
        handoffId: refreshedHandoffId,
        acceptanceHash: input.acceptanceHash,
        acceptanceFacts,
        workspaceManifestHash,
      };
      this.#transaction(() => {
        const result = this.#database
          .prepare(
            `UPDATE bootstrap_handoffs
             SET handoff_id = ?, facts_json = ?
             WHERE handoff_id = ? AND state = 'prepared' AND facts_json = ?`,
          )
          .run(
            refreshedHandoffId,
            JSON.stringify(refreshed),
            existing.handoff_id,
            existing.facts_json,
          );
        if (Number(result.changes) !== 1) {
          throw new Error("bootstrap-handoff-conflict");
        }
      });
      return structuredClone(refreshed);
    }
    const handoffId = `handoff-${hash(
      input.runId,
      input.receiptHash,
      input.graphHash,
      input.acceptanceHash,
      workspaceManifestHash ?? "acceptance-pending",
    ).slice(0, 40)}`;
    const outcome = {
      handoffId,
      state: "prepared",
      runId: input.runId,
      change: input.change,
      receiptHash: input.receiptHash,
      graphHash: input.graphHash,
      acceptanceHash: input.acceptanceHash,
      ...(acceptanceFacts ? { acceptanceFacts } : {}),
      ...(workspaceManifestHash ? { workspaceManifestHash } : {}),
      selectorBeforeCutover: "bootstrap",
      selectorCasPending: true,
    };
    const preparedRows = this.#database
      .prepare(
        `SELECT handoff_id, owner_run_id, receipt_hash, state, facts_json
         FROM bootstrap_handoffs WHERE state = 'prepared'
         ORDER BY handoff_id`,
      )
      .all() as unknown as BootstrapRow[];
    if (preparedRows.length > 0) throw new Error("bootstrap-handoff-conflict");
    this.#transaction(() => {
      this.#database
        .prepare(
          `INSERT INTO bootstrap_handoffs(
             handoff_id, owner_run_id, receipt_hash, state, facts_json
           ) VALUES (?, ?, ?, 'prepared', ?)`,
        )
        .run(
          handoffId,
          String(input.runId),
          String(input.receiptHash),
          JSON.stringify(outcome),
        );
    });
    return structuredClone(outcome);
  }

  inspectBootstrapHandoff(receiptHash: string): Record<string, unknown> {
    this.#assertOpen();
    if (!SHA256.test(receiptHash)) throw new Error("bootstrap-handoff-invalid");
    const row = this.#database
      .prepare(
        `SELECT facts_json FROM bootstrap_handoffs WHERE receipt_hash = ?`,
      )
      .get(receiptHash) as { facts_json: string } | undefined;
    if (!row) throw new Error("bootstrap-handoff-not-found");
    return parseJsonRecord(row.facts_json);
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    if (this.#closed) return Promise.resolve();
    this.#closing = Promise.resolve().then(async () => {
      if (this.#orphanRecoveryTimer) {
        clearTimeout(this.#orphanRecoveryTimer);
        this.#orphanRecoveryTimer = undefined;
      }
      const reason = new Error("workflow-engine-closed");
      const commands = [...this.#commands];
      for (const [controller] of commands) controller.abort(reason);
      const active = [...this.#active.values()];
      for (const operation of active) operation.controller.abort(reason);
      await Promise.allSettled(commands.map(([, entry]) => entry.settled));
      await Promise.allSettled(active.map((operation) => operation.settled));
      for (const held of this.#operationLeases.values())
        clearInterval(held.timer);
      this.#operationLeases.clear();
      this.#lifecycle?.close?.();
      this.#database.close();
      this.#runStore.close();
      this.#closed = true;
    });
    return this.#closing;
  }
}
