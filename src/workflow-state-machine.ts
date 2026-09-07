import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { WorkflowActivityUpdate } from "./activity-contracts.ts";
import {
  assertPlanWithinChangeContract,
  normalizeChangeContract,
  retainedChangeContract,
} from "./change-contract.ts";
import { LIMITS } from "./contracts.ts";
import {
  assertControlCommand,
  type ControlCommand,
  type ControlStage,
} from "./control-contracts.ts";
import {
  compileImplementPlan,
  DeliveryValidationError,
  type ImplementPlan,
  type PlanTaskDraft,
} from "./delivery-compiler.ts";
import { compareDeliveryRevision } from "./delivery-revision.ts";
import { snapshotFiles } from "./file-snapshot.ts";
import type { RoutePolicy } from "./route-policy.ts";
import {
  canonicalJson,
  type RunProjection,
  type RunState,
} from "./run-state.ts";
import { type OperationLease, RunStore } from "./run-store.ts";
import { isSafeRegularFile } from "./safe-path.ts";
import { configureSqlite, ensureSqliteSchema } from "./sqlite-schema.ts";
import type { ResolvedStateRoot } from "./state-root.ts";
import {
  AMENDMENT_SCHEMA,
  ENGINE_ADDITIONS,
  ENGINE_SCHEMA,
  RECOVERY_ADDITIONS,
  RECOVERY_GRANT_SCHEMA,
  RECOVERY_SCHEMA,
  REJECTED_DELIVERY_SCHEMA,
} from "./storage-schema.ts";
import { permitsContextRead } from "./submit-tool.ts";
import {
  type ActiveOperation,
  assertDelivery,
  type BootstrapRow,
  bootstrapAcceptanceHash,
  CHANGE_NAME,
  cancellableRead,
  classifyPersistedContextRequest,
  decideRecoveryAction,
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
  parseJsonRecord,
  parsePlan,
  phases,
  recoveryKey,
  type SafeAttemptDiagnostic,
  SHA256,
  type WorkflowApplication,
  type WorkflowApplicationContext,
  type WorkflowAttemptOutcome,
  type WorkflowAvailableDelivery,
  type WorkflowChangeVerifier,
  type WorkflowContextRequest,
  type WorkflowDelivery,
  type WorkflowDeliverySource,
  type WorkflowEngineOptions,
  type WorkflowRecoveryFact,
  type WorkflowRunLifecycle,
  type WorkflowVerificationStatus,
  type WorkflowWorker,
} from "./workflow-policy.ts";
import {
  assessRecoveryGrant,
  recoveryExhausted,
} from "./workflow-recovery-policy.ts";
import { selectRunnableTasks } from "./workflow-scheduling.ts";
import {
  firstPausedTask,
  projectWorkflowStatus,
  type WorkflowResourceBudget,
} from "./workflow-status.ts";
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
  readonly #workHardLimit: number;
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
  readonly #amendments = new Map<string, Promise<Record<string, unknown>>>();
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
    this.#workHardLimit = options.workHardLimit ?? 512;
    if (!Number.isSafeInteger(this.#workHardLimit) || this.#workHardLimit < 1)
      throw new Error("workflow-work-limit-invalid");
    this.#runStore = RunStore.open(options.stateRoot, { now: this.#now });
    this.#database = new DatabaseSync(options.stateRoot.databasePath);
    try {
      configureSqlite(this.#database);
      ensureSqliteSchema(this.#database, ENGINE_SCHEMA, ENGINE_ADDITIONS);
      ensureSqliteSchema(this.#database, RECOVERY_SCHEMA, RECOVERY_ADDITIONS);
      ensureSqliteSchema(this.#database, RECOVERY_GRANT_SCHEMA);
      ensureSqliteSchema(this.#database, AMENDMENT_SCHEMA);
      ensureSqliteSchema(this.#database, REJECTED_DELIVERY_SCHEMA);
    } catch (error) {
      this.#database.close();
      this.#runStore.close();
      throw error;
    }
    this.#transaction(() => {
      const budgets = this.#database
        .prepare(
          "SELECT run_id FROM workflow_work_budget WHERE recovery_policy = 0",
        )
        .all() as { run_id: string }[];
      for (const { run_id } of budgets) {
        const plans = this.#database
          .prepare(
            "SELECT plan_json FROM workflow_engine_deliveries WHERE run_id = ?",
          )
          .all(run_id) as { plan_json: string }[];
        const high = Math.max(
          0,
          ...plans.map((row) => this.#phaseCount(JSON.parse(row.plan_json))),
        );
        this.#database
          .prepare(
            "UPDATE workflow_work_budget SET phase_high_water = ?, hard_limit = MAX(hard_limit, max_work, used), recovery_policy = 1 WHERE run_id = ?",
          )
          .run(high, run_id);
      }
    });
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

  amend(
    change: string,
    batchId: string,
    request: unknown,
    execute: (assertAuthority: () => void) => Promise<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    this.#assertOpen();
    if (this.#closing) throw new Error("workflow-engine-closed");
    const runId = this.#lookupRun("abel-implement", change);
    if (!runId) throw new Error("run-not-found");
    if (this.#amendments.has(runId)) throw new Error("amendment-busy");
    const operationId = `amend-${hash(batchId, canonicalJson(request)).slice(0, 48)}`;
    const pending = Promise.resolve()
      .then(async () => {
        const replay = this.#beginOperation(runId, operationId, "amend");
        if (replay) return replay;
        const lease = this.#operationLease(runId, operationId);
        const assertAuthority = () => {
          this.#assertOpen();
          if (this.#closing) throw new Error("workflow-engine-closed");
          this.#runStore.assertLease(lease);
          const status = this.#statusByRun(runId);
          if (
            !["approval-needed", "paused"].includes(String(status.state)) ||
            (status.decisionBatch as { id?: string } | undefined)?.id !==
              batchId
          )
            throw new Error("amendment-batch-stale");
        };
        try {
          assertAuthority();
          if (
            !isRecord(request) ||
            !["status", "validate-plan-draft"].includes(
              String(request.operation),
            )
          ) {
            this.#leasedTransaction(lease, () => {
              this.#database
                .prepare(
                  "INSERT INTO workflow_amendment_budget(run_id, used) VALUES (?, 0) ON CONFLICT DO NOTHING",
                )
                .run(runId);
              const reserved = this.#database
                .prepare(
                  "UPDATE workflow_amendment_budget SET used = used + 1 WHERE run_id = ? AND used < 64",
                )
                .run(runId);
              if (reserved.changes !== 1)
                throw new Error("amendment-budget-exhausted");
            });
          }
          this.#assertAmendmentContract(runId, change, request);
          const outcome = await execute(assertAuthority);
          assertAuthority();
          return this.#commitOperation(runId, operationId, outcome);
        } catch (error) {
          this.#interruptOperation(runId, operationId);
          throw error;
        }
      })
      .finally(() => {
        if (this.#amendments.get(runId) === pending)
          this.#amendments.delete(runId);
      });
    this.#amendments.set(runId, pending);
    return pending;
  }

  #assertAmendmentContract(
    runId: string,
    change: string,
    request: unknown,
  ): void {
    if (!isRecord(request)) throw new Error("amendment-contract-invalid");
    if (
      (request.operation === "approve-gate" && request.gate === "gate-a") ||
      (request.operation === "record-decision" &&
        request.category === "behavior")
    )
      throw new Error("amendment-changes-accepted-behavior");
    if (
      ![
        "write-artifact",
        "delete-artifact",
        "compile-plan",
        "validate-plan-draft",
        "finalize-delivery",
      ].includes(String(request.operation))
    )
      return;
    const relative = String(request.path);
    if (relative === "proposal.md" || relative.startsWith("specs/")) {
      const file = `openspec/changes/${change}/${relative}`;
      if (
        request.operation !== "write-artifact" ||
        !isSafeRegularFile(this.#consumerRoot, file) ||
        readFileSync(path.join(this.#consumerRoot, file), "utf8") !==
          request.content
      )
        throw new Error("amendment-changes-accepted-behavior");
    }
    const compile = [
      "compile-plan",
      "validate-plan-draft",
      "finalize-delivery",
    ].includes(String(request.operation));
    if (!compile) return;
    const draftPath = `openspec/changes/${change}/plan-draft.json`;
    if (!isSafeRegularFile(this.#consumerRoot, draftPath)) return;
    const run = this.#engineRun(runId);
    if (run.current_revision === null) return;
    const prior = this.#planForRevision(runId, run.current_revision);
    const contract = retainedChangeContract(prior);
    const draft = JSON.parse(
      readFileSync(path.join(this.#consumerRoot, draftPath), "utf8"),
    );
    if (
      draft.changeContract !== undefined &&
      canonicalJson(normalizeChangeContract(draft.changeContract)) !==
        canonicalJson(contract)
    )
      throw new Error("change-contract-mismatch");
    // Match DesignController's inheritance before validating authorized modes.
    if (draft.changeContract === undefined && prior.changeContract)
      draft.changeContract = contract;
    const next = compileImplementPlan(draft, {
      consumerRoot: this.#consumerRoot,
      bindExecutionInputs: true,
    }).plan;
    assertPlanWithinChangeContract(contract, next.tasks, [
      next.verification.change.fullSuite,
      next.verification.change.postApply,
    ]);
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
    runId: string,
    lease: OperationLease,
    stage: ControlStage,
    change: string,
    deliveryRevision?: number,
    receiptHash?: string,
    signal?: AbortSignal,
  ): Promise<WorkflowDelivery> {
    if (deliveryRevision === undefined && this.#deliverySource.discoverLatest) {
      try {
        const discover = this.#deliverySource.discoverLatest;
        const available = await cancellableRead(
          () => discover.call(this.#deliverySource, { stage, change, signal }),
          signal,
        );
        if (
          available &&
          Number.isSafeInteger(available.deliveryRevision) &&
          available.deliveryRevision > 0 &&
          SHA256.test(available.receiptHash)
        ) {
          deliveryRevision = available.deliveryRevision;
          receiptHash = available.receiptHash;
        }
      } catch {
        // Discovery is optional; authoritative loading still reports diagnostics.
        signal?.throwIfAborted();
      }
    }
    try {
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
    } catch (error) {
      if (
        error instanceof DeliveryValidationError &&
        deliveryRevision !== undefined &&
        receiptHash !== undefined
      ) {
        this.#leasedTransaction(lease, () => {
          this.#database
            .prepare(
              "INSERT INTO workflow_rejected_deliveries(run_id, delivery_revision, receipt_hash) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
            )
            .run(runId, deliveryRevision, receiptHash);
        });
      }
      throw error;
    }
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
    const capturedBudget = this.#database
      .prepare("SELECT hard_limit FROM workflow_work_budget WHERE run_id = ?")
      .get(runId) as { hard_limit: number } | undefined;
    if (
      this.#phaseCount(delivery.plan) >
        (capturedBudget?.hard_limit ?? this.#workHardLimit) &&
      !existing
    )
      throw new DeliveryValidationError([
        "verification-work-budget-insufficient",
      ]);
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
    const comparison = compareDeliveryRevision(
      priorPlan,
      delivery.plan,
      priorRows,
    );
    const { compatible, boundaryExpanded } = comparison;
    let invalidated = comparison.invalidated;
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
              contextReadPaths: this.#contextReads(runId, row.task_id),
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

      if (
        database
          .prepare("SELECT 1 FROM workflow_work_budget WHERE run_id = ?")
          .get(runId)
      )
        this.#growWorkBudget(database, runId, delivery.plan);
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
               ) VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
            )
            .run(
              runId,
              task.taskId,
              taskOrder,
              delivery.revision,
              taskJson,
              phases(task)[0],
            );
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
            "DELETE FROM workflow_context_reads WHERE run_id = ? AND task_id = ?",
          )
          .run(runId, task.taskId);
        database
          .prepare(
            `UPDATE workflow_engine_tasks
             SET task_order = ?, delivery_revision = ?, plan_json = ?,
                 state = 'pending', phase = ?, pause_code = NULL,
                 context_request_json = NULL, attempt_diagnostic_json = NULL,
                 queue_position = NULL
             WHERE run_id = ? AND task_id = ?`,
          )
          .run(
            taskOrder,
            delivery.revision,
            taskJson,
            phases(task)[0],
            runId,
            task.taskId,
          );
      });
      for (const row of priorRows) {
        if (!admitted.has(row.task_id)) {
          database
            .prepare(
              "DELETE FROM workflow_context_reads WHERE run_id = ? AND task_id = ?",
            )
            .run(runId, row.task_id);
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
    if (values.attemptDiagnostic?.recovery && lease) {
      const fact = values.attemptDiagnostic.recovery;
      const prior = this.#recovery(runId, fact.key);
      if (
        !prior ||
        fact.failures > prior.failures ||
        fact.feedback.maxAttempts < prior.feedback.maxAttempts
      )
        this.#recordRecovery(runId, fact, lease);
    }
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
          : JSON.stringify(
              Object.fromEntries(
                Object.entries(values.attemptDiagnostic).filter(
                  ([key]) => key !== "recovery",
                ),
              ),
            ),
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
      row.phase = phase;
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
      const deliveryRevision = current.current_revision;
      const plan = this.#planForRevision(runId, deliveryRevision);
      this.#leasedTransaction(lease, () => {
        for (const ref of requestedContext?.refs ?? []) {
          if (
            ref.kind === "requested-path" &&
            ref.access === "read" &&
            permitsContextRead(ref.path, task.roots) &&
            (current.current_workspace_revision
              ? current.baseline_workspace_revision &&
                this.#worker.isContextReadAvailable?.({
                  runId,
                  deliveryRevision,
                  plan,
                  baselineRevisionId: current.baseline_workspace_revision,
                  currentWorkspaceRevisionId:
                    current.current_workspace_revision,
                  path: ref.path,
                })
              : isSafeRegularFile(this.#consumerRoot, ref.path))
          ) {
            this.#database
              .prepare(
                "INSERT INTO workflow_context_reads(run_id, task_id, path) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
              )
              .run(runId, row.task_id, ref.path);
          }
        }
      });
      const verificationStatus = current.verification_json
        ? normalizeWorkflowVerificationStatus(
            JSON.parse(current.verification_json) as unknown,
          )
        : undefined;
      const priorDiagnostic = this.#safeAttemptDiagnostic(runId, row);
      const priorRecovery = priorDiagnostic?.recovery;
      const activeRecovery =
        priorRecovery?.key === recoveryKey(task, phase, row, current)
          ? priorRecovery
          : undefined;
      const maxRecoveryAttempts = Math.min(
        plan.verification.artifactCorrection.maxAttempts,
        activeRecovery?.feedback.maxAttempts ?? Infinity,
      );
      if (
        activeRecovery &&
        activeRecovery.feedback.maxAttempts !== maxRecoveryAttempts
      ) {
        this.#leasedTransaction(lease, () => {
          this.#database
            .prepare(
              "UPDATE workflow_recovery_incidents SET max_attempts = MIN(max_attempts, ?) WHERE run_id = ? AND incident_key = ?",
            )
            .run(maxRecoveryAttempts, runId, activeRecovery.key);
        });
        activeRecovery.feedback.maxAttempts = maxRecoveryAttempts;
      }
      const granted = this.#hasRecoveryGrant(
        runId,
        operationId,
        recoveryKey(task, phase, row, current),
      );
      const verificationOnly =
        recoveryExhausted(activeRecovery, maxRecoveryAttempts, granted) &&
        (await this.#worker.hasPendingVerification?.({
          runId,
          operationId,
          deliveryRevision: row.delivery_revision,
          taskId: row.task_id,
          phase,
          task,
          plan,
          signal,
          ...(current.baseline_workspace_revision
            ? { baselineRevisionId: current.baseline_workspace_revision }
            : {}),
          ...(current.current_workspace_revision
            ? { currentWorkspaceRevisionId: current.current_workspace_revision }
            : {}),
        })) === true;
      if (
        !verificationOnly &&
        activeRecovery &&
        recoveryExhausted(activeRecovery, maxRecoveryAttempts, granted)
      ) {
        this.#setTask(
          runId,
          row.task_id,
          {
            state: "paused",
            phase,
            pauseCode: activeRecovery.feedback.code,
            attemptDiagnostic: priorDiagnostic ?? null,
            queuePosition: null,
          },
          lease,
        );
        return;
      }
      if (activeRecovery)
        artifactAttempts = Math.max(artifactAttempts, activeRecovery.failures);
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
              maxAttempts: maxRecoveryAttempts,
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
          attemptDiagnostic: priorDiagnostic ?? null,
          queuePosition: null,
        },
        lease,
      );
      if (
        !this.#reserveWork(
          runId,
          plan,
          recoveryKey(task, phase, row, current),
          lease,
          granted ? operationId : undefined,
        )
      ) {
        this.#setTask(
          runId,
          row.task_id,
          {
            state: "paused",
            phase,
            pauseCode: "change-work-budget-exhausted",
            queuePosition: null,
          },
          lease,
        );
        return;
      }
      let initialReservation = true;
      let outcome: WorkflowAttemptOutcome;
      try {
        outcome = await this.#worker.runAttempt({
          runId,
          operationId,
          deliveryRevision: row.delivery_revision,
          taskId: row.task_id,
          phase,
          task: structuredClone(task),
          contextReadPaths: this.#contextReads(runId, row.task_id),
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
          ...(granted ? { additionalAttempt: true } : {}),
          ...(verificationOnly ? { verificationOnly: true } : {}),
          ...(activeRecovery
            ? { recoveryFeedback: activeRecovery.feedback }
            : {}),
          signal,
          recoveryDecision: (request) => {
            signal.throwIfAborted();
            this.#runStore.assertLease(lease);
            return decideRecoveryAction(plan, request, {
              additionalAttempt: granted,
              verificationOnly,
            });
          },
          reserveCandidate: () => {
            signal.throwIfAborted();
            if (verificationOnly) return false;
            if (initialReservation) {
              initialReservation = false;
              return true;
            }
            if (granted) return false;
            return this.#reserveWork(
              runId,
              plan,
              recoveryKey(task, phase, row, current),
              lease,
            );
          },
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
          ...(priorDiagnostic?.recovery
            ? { recovery: priorDiagnostic.recovery }
            : {}),
          fingerprint,
          sameFailureCount,
          ...(sameFailureCount > 1
            ? { action: "rebind-or-revise-delivery" as const }
            : {}),
        };
        this.#setTask(runId, row.task_id, { attemptDiagnostic }, lease);
        row.attempt_diagnostic_json = JSON.stringify(attemptDiagnostic);
      }
      if (
        outcome.kind === "paused" &&
        outcome.code === "repair-attempts-exhausted"
      ) {
        const maxAttempts = plan.verification.repair.maxAttempts;
        const failures = Math.max(
          maxAttempts,
          (activeRecovery?.failures ?? 0) +
            (granted || verificationOnly ? 1 : 0),
        );
        const diagnostic: SafeAttemptDiagnostic = {
          recovery: {
            key: recoveryKey(task, phase, row, this.#engineRun(runId)),
            failures,
            feedback: {
              code: outcome.code,
              attempt: failures + 1,
              maxAttempts,
              strategy: "repair-verification",
            },
          },
        };
        this.#setTask(
          runId,
          row.task_id,
          { attemptDiagnostic: diagnostic },
          lease,
        );
        row.attempt_diagnostic_json = JSON.stringify(diagnostic);
      }
      if (
        outcome.kind === "retryable" &&
        ["artifact", "stale", "verification"].includes(
          outcome.retryPolicy ?? "",
        )
      ) {
        const key = recoveryKey(task, phase, row, this.#engineRun(runId));
        const failures =
          (activeRecovery?.key === key ? activeRecovery.failures : 0) + 1;
        const strategy =
          outcome.code === "needs-task-split" ||
          outcome.code === "task-split-needed"
            ? ("compact-patch" as const)
            : outcome.retryPolicy === "stale"
              ? ("refresh-candidate" as const)
              : outcome.retryPolicy === "verification"
                ? ("repair-verification" as const)
                : ("revise-candidate" as const);
        const diagnostic: SafeAttemptDiagnostic = {
          ...this.#safeAttemptDiagnostic(runId, row),
          recovery: {
            key,
            failures,
            feedback: {
              code: outcome.code,
              attempt: failures + 1,
              maxAttempts: maxRecoveryAttempts,
              strategy,
              ...(outcome.verification?.failureIdentities
                ? { failureIdentities: outcome.verification.failureIdentities }
                : {}),
            },
          },
        };
        this.#setTask(
          runId,
          row.task_id,
          { attemptDiagnostic: diagnostic },
          lease,
        );
        row.attempt_diagnostic_json = JSON.stringify(diagnostic);
        if (outcome.code === "red-artifact-constraint") {
          redArtifactCorrection = true;
          correctionContextRequest = outcome.contextRequest
            ? normalizeWorkflowContextRequest(outcome.contextRequest)
            : correctionContextRequest;
          requestedContext = correctionContextRequest ?? requestedContext;
        }
        artifactAttempts = Math.max(artifactAttempts + 1, failures);
        const maxAttempts = maxRecoveryAttempts;
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
        this.#leasedTransaction(lease, () => {
          const resolvedKey = recoveryKey(task, phase, row, current);
          if (this.#recovery(runId, resolvedKey)) {
            this.#database
              .prepare(`INSERT INTO workflow_recovery_events(run_id, sequence, incident_key, kind)
              SELECT ?, COALESCE(MAX(sequence), 0) + 1, ?, 'resolved' FROM workflow_recovery_events WHERE run_id = ?`)
              .run(runId, resolvedKey, runId);
          }
          this.#database
            .prepare(
              "DELETE FROM workflow_recovery_incidents WHERE run_id = ? AND incident_key = ?",
            )
            .run(runId, recoveryKey(task, phase, row, current));
        });
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
        row.attempt_diagnostic_json = null;
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
    return firstPausedTask(rows);
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
      taskEvidence: this.#tasks(runId).map((row) => ({
        taskId: row.task_id,
        deliveryRevision: row.delivery_revision,
      })),
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
          const repairKey = recoveryKey(
            this.#taskPlan(task),
            task.phase,
            task,
            this.#engineRun(runId),
          );
          const used = (
            this.#database
              .prepare(
                "SELECT COUNT(*) AS count FROM workflow_recovery_events WHERE run_id = ? AND incident_key = ? AND kind = 'repair'",
              )
              .get(runId, repairKey) as { count: number }
          ).count;
          if (used >= plan.verification.repair.maxAttempts) {
            this.#setTask(
              runId,
              task.task_id,
              {
                state: "paused",
                phase: task.phase,
                pauseCode: "repair-attempts-exhausted",
                attemptDiagnostic: {
                  recovery: {
                    key: recoveryKey(
                      this.#taskPlan(task),
                      task.phase,
                      task,
                      this.#engineRun(runId),
                    ),
                    failures: used,
                    feedback: {
                      code: "repair-attempts-exhausted",
                      attempt: used + 1,
                      maxAttempts: plan.verification.repair.maxAttempts,
                      strategy: "repair-verification",
                      failureIdentities:
                        verification.verification.failureIdentities,
                    },
                  },
                },
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
          this.#leasedTransaction(lease, () => {
            this.#database
              .prepare(`INSERT INTO workflow_recovery_events(run_id, sequence, incident_key, kind)
              SELECT ?, COALESCE(MAX(sequence), 0) + 1, ?, 'repair' FROM workflow_recovery_events WHERE run_id = ?`)
              .run(runId, repairKey, runId);
          });
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
          return this.#advance(runId, operationId, signal, lease, onActivity);
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
      contextReadPaths: this.#contextReads(runId),
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
      try {
        application = await this.#application.applyPrepared(applicationInput);
      } catch (error) {
        this.#runStore.assertLease(lease);
        if (this.#runStore.status(runId).state === "applying")
          this.#transition(
            runId,
            "recovering",
            `${operationId}:application-interrupted`,
            "operation-interrupted",
            lease,
          );
        throw error;
      }
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
      contextReadPaths: this.#contextReads(runId),
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
      const selected = selectRunnableTasks({
        rows,
        attempted,
        activeTasks: this.#activeTasks,
        capacity: LIMITS.maxActiveChildSessions,
        nextQueuePosition: this.#engineRun(runId).next_queue_position,
      });
      const runnable = selected.runnable.map((taskId) => {
        const row = rows.find((candidate) => candidate.task_id === taskId);
        if (!row) throw new Error("scheduler-task-unavailable");
        attempted.add(taskId);
        return { row, before: `${row.state}:${row.phase}` };
      });
      for (const update of selected.updates) {
        const row = rows.find(
          (candidate) => candidate.task_id === update.taskId,
        );
        if (!row) throw new Error("scheduler-task-unavailable");
        if (update.kind === "pending")
          this.#setTask(
            runId,
            row.task_id,
            { state: "pending", pauseCode: null, queuePosition: null },
            lease,
          );
        else this.#queueTask(runId, row, lease, update.reason);
      }
      const capacityBlocked = selected.capacityBlocked;
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
      return this.#finishChange(runId, operationId, signal, lease, onActivity);
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

  #contextReads(runId: string, taskId?: string): string[] {
    const rows =
      taskId === undefined
        ? this.#database
            .prepare(
              "SELECT DISTINCT path FROM workflow_context_reads WHERE run_id = ? ORDER BY path",
            )
            .all(runId)
        : this.#database
            .prepare(
              "SELECT path FROM workflow_context_reads WHERE run_id = ? AND task_id = ? ORDER BY path",
            )
            .all(runId, taskId);
    return rows.map((row) => String(row.path));
  }

  #phaseCount(plan: ImplementPlan): number {
    return plan.tasks.reduce((sum, task) => sum + phases(task).length, 0);
  }

  #growWorkBudget(
    database: DatabaseSync,
    runId: string,
    plan: ImplementPlan,
  ): void {
    const count = this.#phaseCount(plan);
    database
      .prepare(`INSERT INTO workflow_work_budget(run_id, used, max_work, phase_high_water, hard_limit, recovery_policy)
      VALUES (?, 0, ?, ?, ?, 1) ON CONFLICT(run_id) DO UPDATE SET
      phase_high_water = MAX(phase_high_water, excluded.phase_high_water),
      max_work = MIN(hard_limit, MAX(max_work, 24 + 3 * MAX(phase_high_water, excluded.phase_high_water)))`)
      .run(
        runId,
        Math.min(this.#workHardLimit, 24 + 3 * count),
        count,
        this.#workHardLimit,
      );
  }

  #hasRecoveryGrant(runId: string, operationId: string, key: string): boolean {
    return Boolean(
      this.#database
        .prepare(
          "SELECT 1 FROM workflow_recovery_grants WHERE run_id = ? AND operation_id = ? AND incident_key = ? AND consumed = 0",
        )
        .get(runId, operationId, key),
    );
  }

  #recoveryConditions(runId: string, key: string) {
    const run = this.#engineRun(runId);
    const task = this.#tasks(runId).find(
      (row) => recoveryKey(this.#taskPlan(row), row.phase, row, run) === key,
    );
    return {
      route: task?.route_fingerprint ?? run.route_fingerprint,
      context: task
        ? hash(
            canonicalJson(
              snapshotFiles(
                this.#consumerRoot,
                this.#contextReads(runId, task.task_id),
              ),
            ),
          )
        : null,
    };
  }

  #failureSequence(runId: string, key: string): number {
    return (
      this.#database
        .prepare(
          "SELECT COALESCE(MAX(sequence), 0) AS sequence FROM workflow_recovery_events WHERE run_id = ? AND incident_key = ?",
        )
        .get(runId, key) as { sequence: number }
    ).sequence;
  }

  #grantRecovery(
    runId: string,
    operationId: string,
    request: NonNullable<
      Extract<ControlCommand, { command: "resume" }>["recovery"]
    >,
    lease: OperationLease,
  ): void {
    this.#leasedTransaction(lease, () => {
      const incident = this.#recovery(runId, request.incidentKey);
      const current = this.#tasks(runId).some(
        (row) =>
          ["paused", "retryable"].includes(row.state) &&
          recoveryKey(
            this.#taskPlan(row),
            row.phase,
            row,
            this.#engineRun(runId),
          ) === request.incidentKey,
      );
      if (
        !current ||
        !incident ||
        incident.failures < incident.feedback.maxAttempts ||
        this.#failureSequence(runId, request.incidentKey) !==
          request.failureSequence
      )
        throw new Error("recovery-request-stale");
      const conditions = this.#database
        .prepare(
          "SELECT conditions_json FROM workflow_recovery_incidents WHERE run_id = ? AND incident_key = ?",
        )
        .get(runId, request.incidentKey) as { conditions_json: string };
      const previous = JSON.parse(conditions.conditions_json);
      const observed = this.#recoveryConditions(runId, request.incidentKey);
      const budget = this.#database
        .prepare(
          "SELECT used, max_work FROM workflow_work_budget WHERE run_id = ?",
        )
        .get(runId) as { used: number; max_work: number };
      const rejected = assessRecoveryGrant({
        current,
        incident,
        failureSequence: this.#failureSequence(runId, request.incidentKey),
        requestedSequence: request.failureSequence,
        reason: request.reason,
        previous,
        observed,
        budget,
      });
      if (rejected) throw new Error(rejected);
      this.#database
        .prepare(
          "INSERT INTO workflow_recovery_grants(run_id, operation_id, incident_key, failure_sequence, reason) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          runId,
          operationId,
          request.incidentKey,
          request.failureSequence,
          request.reason,
        );
    });
  }

  #reserveWork(
    runId: string,
    plan: ImplementPlan,
    key: string,
    lease: OperationLease,
    grantOperationId?: string,
  ): boolean {
    return this.#leasedTransaction(lease, () => {
      this.#growWorkBudget(this.#database, runId, plan);
      const reserved = this.#database
        .prepare(`UPDATE workflow_work_budget SET used = used + 1
        WHERE run_id = ? AND used < max_work`)
        .run(runId);
      if (reserved.changes !== 1) return false;
      if (grantOperationId) {
        const consumed = this.#database
          .prepare(
            "UPDATE workflow_recovery_grants SET consumed = 1 WHERE run_id = ? AND operation_id = ? AND incident_key = ? AND consumed = 0",
          )
          .run(runId, grantOperationId, key);
        if (consumed.changes !== 1) throw new Error("recovery-request-stale");
      }
      this.#database
        .prepare(`INSERT INTO workflow_recovery_events(run_id, sequence, incident_key, kind)
        SELECT ?, COALESCE(MAX(sequence), 0) + 1, ?, 'launch' FROM workflow_recovery_events WHERE run_id = ?`)
        .run(runId, key, runId);
      return true;
    });
  }

  #recovery(runId: string, key: string): WorkflowRecoveryFact | undefined {
    const row = this.#database
      .prepare(
        `SELECT failures, max_attempts, feedback_json FROM workflow_recovery_incidents
       WHERE run_id = ? AND incident_key = ?`,
      )
      .get(runId, key) as
      | { failures: number; max_attempts: number; feedback_json: string }
      | undefined;
    return row
      ? {
          key,
          failures: row.failures,
          feedback: {
            ...JSON.parse(row.feedback_json),
            maxAttempts: row.max_attempts,
          },
        }
      : undefined;
  }

  #recordRecovery(
    runId: string,
    fact: WorkflowRecoveryFact,
    lease: OperationLease,
  ): void {
    this.#leasedTransaction(lease, () => {
      this.#database
        .prepare(
          `INSERT INTO workflow_recovery_incidents(run_id, incident_key, failures, max_attempts, feedback_json, conditions_json)
         VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(run_id, incident_key) DO UPDATE SET
         failures = MAX(failures, excluded.failures), max_attempts = MIN(max_attempts, excluded.max_attempts), feedback_json = excluded.feedback_json, conditions_json = excluded.conditions_json`,
        )
        .run(
          runId,
          fact.key,
          fact.failures,
          fact.feedback.maxAttempts,
          JSON.stringify(fact.feedback),
          JSON.stringify(this.#recoveryConditions(runId, fact.key)),
        );
      this.#database
        .prepare(
          `INSERT INTO workflow_recovery_events(run_id, sequence, incident_key, kind)
         SELECT ?, COALESCE(MAX(sequence), 0) + 1, ?, 'failure' FROM workflow_recovery_events WHERE run_id = ?`,
        )
        .run(runId, fact.key, runId);
    });
  }

  #safeAttemptDiagnostic(
    runId: string,
    row: EngineTaskRow | undefined,
  ): SafeAttemptDiagnostic | undefined {
    if (!row) return undefined;
    const diagnostic: SafeAttemptDiagnostic = row.attempt_diagnostic_json
      ? (JSON.parse(row.attempt_diagnostic_json) as SafeAttemptDiagnostic)
      : {};
    delete diagnostic.recovery;
    const recovery = this.#recovery(
      runId,
      recoveryKey(this.#taskPlan(row), row.phase, row, this.#engineRun(runId)),
    );
    if (recovery) diagnostic.recovery = recovery;
    return Object.keys(diagnostic).length ? diagnostic : undefined;
  }

  #statusByRun(runId: string): Record<string, unknown> {
    const projection = this.#runStore.status(runId);
    const rows = this.#tasks(runId);
    let engineRun: EngineRunRow | undefined;
    try {
      engineRun = this.#engineRun(runId);
    } catch {
      engineRun = undefined;
    }
    const attemptDiagnostics = new Map<string, SafeAttemptDiagnostic>();
    const failureSequences = new Map<string, number>();
    for (const row of rows) {
      const diagnostic = this.#safeAttemptDiagnostic(runId, row);
      if (!diagnostic) continue;
      attemptDiagnostics.set(row.task_id, diagnostic);
      if (diagnostic.recovery) {
        const key = diagnostic.recovery.key;
        failureSequences.set(key, this.#failureSequence(runId, key));
      }
    }
    const amendmentUsed =
      (
        this.#database
          .prepare(
            "SELECT used FROM workflow_amendment_budget WHERE run_id = ?",
          )
          .get(runId) as { used: number } | undefined
      )?.used ?? 0;
    const resourceBudget = this.#database
      .prepare(
        "SELECT used, max_work AS maximum, phase_high_water AS phaseHighWater, hard_limit AS hardLimit FROM workflow_work_budget WHERE run_id = ?",
      )
      .get(runId) as WorkflowResourceBudget | undefined;
    return projectWorkflowStatus({
      projection,
      rows,
      engineRun,
      attemptDiagnostics,
      failureSequences,
      amendmentUsed,
      resourceBudget,
    });
  }

  async #withAvailableDelivery(
    outcome: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (
      outcome.stage !== "abel-implement" ||
      (isRecord(outcome.pause) &&
        outcome.pause.code === "operation-cancelled") ||
      (outcome.state !== "approval-needed" &&
        !(
          outcome.state === "paused" &&
          (isRecord(outcome.decisionBatch) ||
            (isRecord(outcome.recovery) && outcome.recovery.exhausted === true))
        )) ||
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
    if (
      this.#database
        .prepare(
          "SELECT 1 FROM workflow_rejected_deliveries WHERE run_id = ? AND delivery_revision = ? AND receipt_hash = ?",
        )
        .get(
          String(outcome.runId),
          available.deliveryRevision,
          available.receiptHash,
        )
    ) {
      return outcome;
    }
    const conditionalCommands = (
      Array.isArray(outcome.conditionalCommands)
        ? outcome.conditionalCommands
        : [{ command: "resume", stage: outcome.stage, change: outcome.change }]
    ).map((entry) =>
      isRecord(entry) && entry.command === "resume"
        ? {
            ...entry,
            satisfiedBy: {
              deliveryRevision: available.deliveryRevision,
              receiptHash: available.receiptHash,
            },
          }
        : entry,
    );
    return {
      ...outcome,
      legalCommands:
        outcome.state === "approval-needed"
          ? ["status", "resume", "discard"]
          : ["status", "resume", "rebind", "discard"],
      availableDelivery: structuredClone(available),
      continuation:
        (isRecord(outcome.resourceBudget) &&
          outcome.resourceBudget.remaining === 0) ||
        (isRecord(outcome.recovery) &&
          outcome.recovery.code === "change-recovery-budget-exhausted")
          ? undefined
          : {
              owner: "parent",
              automatic: true,
              command: "resume",
              stage: "abel-implement",
              change: outcome.change,
            },
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
        runId,
        lease,
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
      if (
        command.deliveryRevision === undefined &&
        (current.state === "approval-needed" ||
          this.#statusByRun(runId).decisionBatch !== undefined ||
          this.#statusByRun(runId).recovery !== undefined) &&
        this.#deliverySource.discoverLatest
      ) {
        const available = await this.#deliverySource.discoverLatest({
          stage: command.stage,
          change: command.change,
          signal,
        });
        this.#runStore.assertLease(lease);
        if (available && available.deliveryRevision > (engineRevision ?? 0)) {
          command = {
            ...command,
            deliveryRevision: available.deliveryRevision,
            receiptHash: available.receiptHash,
          };
        }
      }
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
          runId,
          lease,
          command.stage,
          command.change,
          requestedRevision,
          command.receiptHash ?? projectedBinding?.receiptHash,
          signal,
        );
        this.#admitDelivery(runId, delivery, lease);
      }
      if (command.recovery)
        this.#grantRecovery(
          runId,
          command.operationId,
          command.recovery,
          lease,
        );
      this.#transition(
        runId,
        "ready",
        `${command.operationId}:resume-ready`,
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
      // A revised delivery may invalidate a grant. Retain its admitted facts,
      // but never leave a rejected resume looking ready or still validating.
      if (
        error instanceof Error &&
        [
          "recovery-request-stale",
          "recovery-evidence-unavailable",
          "change-work-budget-exhausted",
        ].includes(error.message) &&
        this.#runStore.status(runId).state === "validating-delivery"
      ) {
        this.#transition(
          runId,
          "paused",
          `${command.operationId}:recovery-rejected`,
          error.message,
          lease,
        );
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
    const amendment = this.#amendments.get(runId);
    if (amendment) pending.push(amendment);
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
      await Promise.allSettled([...this.#amendments.values()]);
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
