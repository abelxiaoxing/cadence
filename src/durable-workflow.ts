import {
  ChangeVerification,
  parseVerificationBaseline,
  sha256Bytes,
  verificationBaselineFact,
} from "./change-verification.ts";
import type {
  DurableExecutionResources,
  DurablePhaseFact,
  DurableResourceInput,
  DurableWorkflowEngineOptions,
} from "./durable-contracts.ts";
import { PhaseExecution } from "./phase-execution.ts";

export type {
  DurableChangeVerificationResult,
  DurablePhaseVerificationResult,
  DurableWorkflowEngineOptions,
} from "./durable-contracts.ts";

interface DurableRunResources extends DurableExecutionResources {
  transactions: ApplyTransaction;
  closed: boolean;
}

import { lstatSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ApplyTransaction } from "./apply-transaction.ts";
import { ArtifactStore } from "./artifact-store.ts";
import { compareCanonicalStrings } from "./canonical.ts";
import type { ImplementPlan, PlanTaskDraft } from "./delivery-compiler.ts";
import type { RoutePolicy } from "./route-policy.ts";
import { observeSafePath } from "./safe-path.ts";
import { configureSqlite, ensureSqliteSchema } from "./sqlite-schema.ts";
import { ROUTE_HEALTH_SCHEMA } from "./storage-schema.ts";
import { TaskLedger } from "./task-ledger.ts";
import { type RouteHealthStore, RunWorkerBroker } from "./worker-broker.ts";
import {
  deliveryBoundPaths,
  deliveryTrackingPath,
  hash,
  hasVerificationLifecycle,
  IDENTIFIER,
  implementationRouteRequirements,
  isRecord,
  SHA256,
  type WorkflowApplication,
  type WorkflowApplicationContext,
  type WorkflowChangeVerifier,
  type WorkflowRunLifecycle,
  type WorkflowWorker,
  workspaceEntryEqual,
} from "./workflow-policy.ts";
import { WorkflowEngine } from "./workflow-state-machine.ts";
import { type WorkspaceRevision, WorkspaceStore } from "./workspace-store.ts";

type DurableRouteHealth = Parameters<RouteHealthStore["set"]>[1];

class DurableRouteHealthStore implements RouteHealthStore {
  readonly #databasePath: string;
  #database?: DatabaseSync;
  #closed = false;

  constructor(databasePath: string) {
    this.#databasePath = databasePath;
  }

  #open(): DatabaseSync {
    if (this.#closed) throw new Error("route-health-store-closed");
    if (this.#database) return this.#database;
    const database = new DatabaseSync(this.#databasePath);
    try {
      configureSqlite(database);
      ensureSqliteSchema(database, ROUTE_HEALTH_SCHEMA);
    } catch (error) {
      database.close();
      throw error;
    }

    this.#database = database;
    return database;
  }

  get(fingerprint: string): DurableRouteHealth | undefined {
    if (!SHA256.test(fingerprint)) return undefined;
    const row = this.#open()
      .prepare(
        `SELECT state, next_half_open_at, projection_json
         FROM route_health WHERE route_fingerprint = ?`,
      )
      .get(fingerprint) as
      | {
          state: string;
          next_half_open_at: number | null;
          projection_json: string;
        }
      | undefined;
    if (!row || !["healthy", "open", "half-open"].includes(row.state)) {
      return undefined;
    }
    let projection: unknown;
    try {
      projection = JSON.parse(row.projection_json);
    } catch {
      return undefined;
    }
    if (!isRecord(projection) || projection.state !== row.state) {
      return undefined;
    }
    const retryAt = row.next_half_open_at ?? undefined;
    const lastCode =
      typeof projection.lastCode === "string" &&
      projection.lastCode.length > 0 &&
      projection.lastCode.length <= 128
        ? projection.lastCode
        : undefined;
    const probeExpiresAt =
      Number.isSafeInteger(projection.probeExpiresAt) &&
      (projection.probeExpiresAt as number) >= 0
        ? (projection.probeExpiresAt as number)
        : undefined;
    return {
      state: row.state as DurableRouteHealth["state"],
      ...(retryAt === undefined ? {} : { retryAt }),
      ...(projection.probeInFlight === true ? { probeInFlight: true } : {}),
      ...(probeExpiresAt === undefined ? {} : { probeExpiresAt }),
      ...(lastCode === undefined ? {} : { lastCode }),
    };
  }

  set(fingerprint: string, health: DurableRouteHealth): void {
    if (
      !SHA256.test(fingerprint) ||
      !["healthy", "open", "half-open"].includes(health.state) ||
      (health.retryAt !== undefined &&
        (!Number.isSafeInteger(health.retryAt) || health.retryAt < 0)) ||
      (health.probeExpiresAt !== undefined &&
        (!Number.isSafeInteger(health.probeExpiresAt) ||
          health.probeExpiresAt < 0))
    ) {
      throw new Error("route-health-fact-invalid");
    }
    const projection = {
      state: health.state,
      ...(health.probeInFlight ? { probeInFlight: true } : {}),
      ...(health.probeExpiresAt === undefined
        ? {}
        : { probeExpiresAt: health.probeExpiresAt }),
      ...(health.lastCode ? { lastCode: health.lastCode.slice(0, 128) } : {}),
    };
    this.#open()
      .prepare(
        `INSERT INTO route_health(
           route_fingerprint, state, next_half_open_at, projection_json
         ) VALUES (?, ?, ?, ?)
         ON CONFLICT(route_fingerprint) DO UPDATE SET
           state = excluded.state,
           next_half_open_at = excluded.next_half_open_at,
           projection_json = excluded.projection_json`,
      )
      .run(
        fingerprint,
        health.state,
        health.retryAt ?? null,
        JSON.stringify(projection),
      );
  }

  close(): void {
    if (this.#closed) return;
    this.#database?.close();
    this.#closed = true;
  }
}

function ensurePrivateRunDirectory(directory: string): void {
  const existing = lstatSync(directory, { throwIfNoEntry: false });
  if (existing) {
    if (existing.isSymbolicLink() || !existing.isDirectory()) {
      throw new Error("workflow-run-data-unsafe");
    }
    return;
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const created = lstatSync(directory);
  if (created.isSymbolicLink() || !created.isDirectory()) {
    throw new Error("workflow-run-data-unsafe");
  }
}

class DurableWorkflowComposition
  implements
    WorkflowWorker,
    WorkflowChangeVerifier,
    WorkflowApplication,
    WorkflowRunLifecycle
{
  readonly #phase: PhaseExecution;
  readonly #verification: ChangeVerification;
  readonly #options: DurableWorkflowEngineOptions;
  readonly #routeHealth: DurableRouteHealthStore;
  #broker: RunWorkerBroker;
  readonly #runs = new Map<string, DurableRunResources>();

  constructor(options: DurableWorkflowEngineOptions) {
    this.#options = options;
    this.#routeHealth = new DurableRouteHealthStore(
      options.stateRoot.databasePath,
    );
    this.#broker = new RunWorkerBroker(options.routePolicy, {
      ...(options.now ? { now: options.now } : {}),
      healthStore: this.#routeHealth,
    });
    this.#verification = new ChangeVerification(options, {
      prepareResources: (input, signal) =>
        this.#prepareResources(input, signal),
      ledger: (resources, revision) => this.#ledger(resources, revision),
      run: (runId) => this.#runs.get(runId),
      revalidatePhasePolicy: (...args) =>
        this.#phase.revalidatePhasePolicy(...args),
    });
    this.#phase = new PhaseExecution(options, this.#broker, {
      prepareResources: (input, signal) =>
        this.#prepareResources(input, signal),
      ledger: (resources, revision) => this.#ledger(resources, revision),
      ensureVerificationBaseline: (input) =>
        this.#verification.ensureVerificationBaseline(input),
      verifyTaskAffected: (input) =>
        this.#verification.verifyTaskAffected(input),
      verifyPhase: (input) => this.#verification.verifyPhase(input),
    });
  }

  updateRoutePolicy(policy: RoutePolicy): void {
    this.#broker.updatePolicy(policy);
  }

  routePolicyStatus(): Record<string, unknown> {
    return this.#broker.status();
  }

  #runRoot(runId: string): string {
    if (!IDENTIFIER.test(runId)) throw new Error("workflow-run-id-invalid");
    const dataRoot = path.join(this.#options.stateRoot.rootDir, "run-data");
    const root = path.join(dataRoot, runId);
    const relative = path.relative(dataRoot, root);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("workflow-run-data-unsafe");
    }
    return root;
  }

  #captureBaseline(
    workspaces: WorkspaceStore,
    plan: ImplementPlan,
    signal: AbortSignal,
  ) {
    const candidates = new Set<string>();
    const absent = new Set<string>();
    for (const relative of deliveryBoundPaths(plan)) {
      const observation = observeSafePath(this.#options.consumerRoot, relative);
      if (observation.kind === "file") candidates.add(relative);
      else if (observation.kind === "absent") absent.add(relative);
      else throw new Error("workflow-baseline-path-unsafe");
    }
    return workspaces.captureBaselineAsync(
      {
        consumerRoot: this.#options.consumerRoot,
        approvedUntracked: [...candidates].sort(),
        absent: [...absent].sort(),
      },
      signal,
    );
  }

  readonly #initializing = new Map<string, Promise<DurableRunResources>>();

  async #prepareResources(
    input: DurableResourceInput,
    signal: AbortSignal,
  ): Promise<DurableRunResources> {
    signal.throwIfAborted();
    const pending = this.#initializing.get(input.runId);
    if (pending) return pending;
    if (
      this.#runs.has(input.runId) ||
      (input.baselineRevisionId && input.currentWorkspaceRevisionId)
    )
      return this.#resources(input);
    const initialize = async () => {
      if (
        !input.plan ||
        input.baselineRevisionId ||
        input.currentWorkspaceRevisionId
      )
        throw new Error("workflow-workspace-revision-unavailable");
      const root = this.#runRoot(input.runId);
      ensurePrivateRunDirectory(root);
      const artifacts = new ArtifactStore(path.join(root, "artifacts"));
      const workspaces = new WorkspaceStore(
        path.join(root, "workspaces"),
        artifacts,
      );
      const baseline = await this.#captureBaseline(
        workspaces,
        input.plan,
        signal,
      );
      signal.throwIfAborted();
      return this.#resources({
        ...input,
        baselineRevisionId: baseline.revisionId,
        currentWorkspaceRevisionId: baseline.revisionId,
      });
    };
    const promise = initialize();
    this.#initializing.set(input.runId, promise);
    try {
      return await promise;
    } finally {
      this.#initializing.delete(input.runId);
    }
  }

  #resources(input: {
    runId: string;
    deliveryRevision: number;
    plan?: ImplementPlan;
    baselineRevisionId?: string;
    currentWorkspaceRevisionId?: string;
  }): DurableRunResources {
    const existing = this.#runs.get(input.runId);
    if (existing) {
      if (
        input.baselineRevisionId &&
        existing.baselineRevisionId !== input.baselineRevisionId
      ) {
        throw new Error("workflow-baseline-revision-conflict");
      }
      if (input.plan) {
        existing.plan = structuredClone(input.plan);
        existing.deliveryRevision = input.deliveryRevision;
      }
      return existing;
    }
    if (!input.plan) {
      throw new Error("workflow-plan-unavailable");
    }
    const root = this.#runRoot(input.runId);
    ensurePrivateRunDirectory(root);
    const artifacts = new ArtifactStore(path.join(root, "artifacts"));
    const workspaces = new WorkspaceStore(
      path.join(root, "workspaces"),
      artifacts,
    );
    const baselineRevisionId = input.baselineRevisionId;
    const currentRevisionId = input.currentWorkspaceRevisionId;
    if (!baselineRevisionId || !currentRevisionId)
      throw new Error("workflow-workspace-revision-unavailable");
    workspaces.getRevision(baselineRevisionId);
    workspaces.getRevision(currentRevisionId);
    let resources!: DurableRunResources;
    const transactions = new ApplyTransaction({
      root: path.join(root, "transactions"),
      artifacts,
      workspaces,
      hooks: {
        postApply: ({ transactionId, root: verificationRoot, signal }) =>
          this.#verification.verifyPostApply(
            resources,
            verificationRoot,
            signal,
            transactionId,
          ),
      },
    });
    resources = {
      runId: input.runId,
      root,
      plan: structuredClone(input.plan),
      deliveryRevision: input.deliveryRevision,
      artifacts,
      workspaces,
      ledgers: new Map(),
      transactions,
      baselineRevisionId,
      currentRevisionId,
      mergeTail: Promise.resolve(),
      baselinePromises: new Map(),
      closed: false,
    };
    this.#runs.set(input.runId, resources);
    return resources;
  }

  #closeResources(resources: DurableRunResources): void {
    if (resources.closed) return;
    for (const ledger of resources.ledgers.values()) ledger.close();
    resources.ledgers.clear();
    resources.transactions.close();
    resources.closed = true;
  }

  #ledger(
    resources: DurableExecutionResources,
    deliveryRevision: number,
  ): TaskLedger {
    const existing = resources.ledgers.get(deliveryRevision);
    if (existing) return existing;
    const ledger = new TaskLedger({
      root: path.join(
        resources.root,
        "ledgers",
        `revision-${deliveryRevision}`,
      ),
      artifacts: resources.artifacts,
    });
    resources.ledgers.set(deliveryRevision, ledger);
    return ledger;
  }

  #expandedBaseline(
    resources: DurableRunResources,
    plan: ImplementPlan,
  ): WorkspaceRevision {
    const baseline = resources.workspaces.getRevision(
      resources.baselineRevisionId,
    );
    const candidates = new Map<string, boolean>(
      deliveryBoundPaths(plan).map((relative) => [relative, false]),
    );
    for (const task of plan.tasks) {
      for (const phase of Object.values(task.phases)) {
        for (const relative of phase.read) candidates.set(relative, false);
        for (const relative of [...phase.write, ...phase.delete]) {
          candidates.set(relative, true);
        }
      }
    }
    for (const output of plan.outputs) candidates.set(output.path, true);
    for (const task of plan.tasks) {
      if (task.agents.impact === "none" || !task.agents.target) continue;
      candidates.set(task.agents.target, task.agents.impact === "create-index");
    }
    const trackingPath = deliveryTrackingPath(plan);
    if (
      trackingPath &&
      (Object.hasOwn(baseline.entries, trackingPath) ||
        observeSafePath(this.#options.consumerRoot, trackingPath).kind ===
          "file")
    ) {
      candidates.set(trackingPath, false);
    }
    const changes: Record<
      string,
      { kind: "absent" } | { kind: "file"; bytes: Uint8Array; mode: number }
    > = {};
    for (const [relative, mayBeAbsent] of [...candidates].sort(
      ([left], [right]) => compareCanonicalStrings(left, right),
    )) {
      if (relative === ".") continue;
      const observation = observeSafePath(this.#options.consumerRoot, relative);
      if (observation.kind === "absent") {
        if (baseline.entries[relative]?.kind === "absent") continue;
        if (!mayBeAbsent)
          throw new Error("workflow-baseline-input-unavailable");
        changes[relative] = { kind: "absent" };
        continue;
      }
      if (observation.kind !== "file") {
        throw new Error("workflow-baseline-path-unsafe");
      }
      const target = path.join(
        this.#options.consumerRoot,
        ...relative.split("/"),
      );
      const stat = lstatSync(target);
      const bytes = readFileSync(target);
      const mode = stat.mode & 0o777;
      const prior = baseline.entries[relative];
      if (
        prior?.kind === "file" &&
        prior.hash === sha256Bytes(bytes) &&
        prior.bytes === bytes.byteLength &&
        prior.mode === mode
      ) {
        continue;
      }
      changes[relative] = {
        kind: "file",
        bytes,
        mode,
      };
    }
    return Object.keys(changes).length === 0
      ? baseline
      : resources.workspaces.createRevision({
          parentRevisionId: baseline.revisionId,
          changes,
        });
  }

  #orderedTasks(plan: ImplementPlan): PlanTaskDraft[] {
    const remaining = new Map(plan.tasks.map((task) => [task.taskId, task]));
    const ordered: PlanTaskDraft[] = [];
    const admitted = new Set<string>();
    while (remaining.size > 0) {
      let progressed = false;
      for (const task of plan.tasks) {
        if (
          !remaining.has(task.taskId) ||
          task.dependsOn.some((dependency) => !admitted.has(dependency))
        ) {
          continue;
        }
        remaining.delete(task.taskId);
        admitted.add(task.taskId);
        ordered.push(task);
        progressed = true;
      }
      if (!progressed) throw new Error("workflow-plan-dependency-cycle");
    }
    return ordered;
  }

  #phaseFacts(
    resources: DurableRunResources,
    task: {
      taskId: string;
      deliveryRevision: number;
      phase: "red" | "green" | "refactor";
    },
  ): DurablePhaseFact[] {
    let projection: unknown;
    try {
      projection = this.#ledger(resources, task.deliveryRevision).projection({
        runId: resources.runId,
        taskId: task.taskId,
        nextPhase: task.phase,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "ledger-task-unavailable"
      ) {
        return [];
      }
      throw error;
    }
    if (!isRecord(projection) || !Array.isArray(projection.history)) {
      throw new Error("workflow-ledger-projection-invalid");
    }
    return projection.history.flatMap((event): DurablePhaseFact[] => {
      if (
        !isRecord(event) ||
        (event.kind !== "phase-verified" && event.kind !== "repair-verified")
      ) {
        return [];
      }
      if (
        !["red", "green", "refactor"].includes(String(event.phase)) ||
        typeof event.isolatedRevisionId !== "string" ||
        !SHA256.test(event.isolatedRevisionId) ||
        !Array.isArray(event.outputFacts)
      ) {
        throw new Error("workflow-ledger-phase-invalid");
      }
      const outputFacts = event.outputFacts.map((fact) => {
        if (
          !isRecord(fact) ||
          typeof fact.path !== "string" ||
          (fact.kind !== "absent" && fact.kind !== "file")
        ) {
          throw new Error("workflow-ledger-phase-invalid");
        }
        if (fact.kind === "absent") {
          return { path: fact.path, kind: "absent" as const };
        }
        if (
          typeof fact.hash !== "string" ||
          !SHA256.test(fact.hash) ||
          !Number.isSafeInteger(fact.bytes) ||
          (fact.bytes as number) < 0
        ) {
          throw new Error("workflow-ledger-phase-invalid");
        }
        return {
          path: fact.path,
          kind: "file" as const,
          hash: fact.hash,
          bytes: fact.bytes as number,
        };
      });
      return [
        {
          kind: event.kind,
          phase: event.phase as DurablePhaseFact["phase"],
          isolatedRevisionId: event.isolatedRevisionId,
          outputFacts,
        },
      ];
    });
  }

  revalidateDelivery(
    input: Parameters<NonNullable<WorkflowWorker["revalidateDelivery"]>>[0],
  ): ReturnType<NonNullable<WorkflowWorker["revalidateDelivery"]>> {
    const resources = this.#resources({
      runId: input.runId,
      deliveryRevision: input.deliveryRevision,
      plan: input.plan,
      baselineRevisionId: input.baselineRevisionId,
      currentWorkspaceRevisionId: input.currentWorkspaceRevisionId,
    });
    const expandedBaseline = this.#expandedBaseline(resources, input.plan);
    const rows = new Map(input.tasks.map((task) => [task.taskId, task]));
    const facts = new Map(
      input.tasks.map((task) => [
        task.taskId,
        this.#phaseFacts(resources, task),
      ]),
    );
    const invalidated = new Set(input.invalidatedTaskIds);
    const ordered = this.#orderedTasks(input.plan);
    let rebuilt = expandedBaseline;
    for (;;) {
      let grew = false;
      rebuilt = expandedBaseline;
      for (const task of ordered) {
        const row = rows.get(task.taskId);
        if (!row || invalidated.has(task.taskId)) continue;
        if (task.dependsOn.some((dependency) => invalidated.has(dependency))) {
          invalidated.add(task.taskId);
          grew = true;
          continue;
        }
        for (const fact of facts.get(task.taskId) ?? []) {
          const phase = task.phases[fact.phase];
          if (!phase) {
            invalidated.add(task.taskId);
            grew = true;
            break;
          }
          const original = resources.workspaces.getRevision(
            fact.isolatedRevisionId,
          );
          if (!original.parentRevisionId) {
            throw new Error("workflow-ledger-revision-base-invalid");
          }
          const originalBase = resources.workspaces.getRevision(
            original.parentRevisionId,
          );
          const current = resources.workspaces.getRevision(rebuilt.revisionId);
          const boundaries =
            fact.kind === "repair-verified"
              ? Object.values(task.phases)
              : [phase];
          const boundPaths = [
            ...new Set(
              boundaries.flatMap((boundary) => [
                ...(row.contextReadPaths ?? []),
                ...boundary.read,
                ...boundary.write,
                ...boundary.delete,
                ...boundary.verificationInputs.flatMap((binding) =>
                  binding.kind === "workspace" ? [binding.path] : [],
                ),
              ]),
            ),
          ];
          if (
            boundPaths.some(
              (relative) =>
                !workspaceEntryEqual(
                  originalBase.entries[relative],
                  current.entries[relative],
                ),
            )
          ) {
            invalidated.add(task.taskId);
            grew = true;
            break;
          }
          const changes: Record<
            string,
            | { kind: "absent" }
            | { kind: "file"; bytes: Uint8Array; mode: number }
          > = {};
          for (const output of fact.outputFacts) {
            const entry = original.entries[output.path];
            if (
              output.kind === "absent"
                ? entry?.kind !== "absent"
                : entry?.kind !== "file" ||
                  entry.hash !== output.hash ||
                  entry.bytes !== output.bytes
            ) {
              throw new Error("workflow-ledger-output-integrity-invalid");
            }
            changes[output.path] =
              entry.kind === "absent"
                ? { kind: "absent" }
                : {
                    kind: "file",
                    bytes: resources.artifacts.read(entry.hash),
                    mode: entry.mode,
                  };
          }
          rebuilt = resources.workspaces.createRevision({
            parentRevisionId: rebuilt.revisionId,
            changes,
          });
        }
      }
      for (const output of input.plan.outputs) {
        if (invalidated.has(output.producer.taskId)) continue;
        const produced = (facts.get(output.producer.taskId) ?? []).some(
          (fact) => fact.phase === output.producer.phase,
        );
        if (
          produced &&
          rebuilt.entries[output.path]?.kind !== "file" &&
          !invalidated.has(output.producer.taskId)
        ) {
          invalidated.add(output.producer.taskId);
          grew = true;
        }
      }
      if (!grew) break;
    }
    if (hasVerificationLifecycle(input.plan)) {
      const retainedRevisions = new Set(
        input.tasks
          .filter((task) => !invalidated.has(task.taskId))
          .map((task) => task.deliveryRevision),
      );
      for (const deliveryRevision of retainedRevisions) {
        const ledger = this.#ledger(resources, deliveryRevision);
        const stored = ledger.durableFact(
          this.#verification.baselineFactKey(resources),
        );
        resources.baselinePromises.delete(deliveryRevision);
        if (stored === undefined) continue;
        const baseline = parseVerificationBaseline(stored, resources.artifacts);
        if (baseline.revisionId === expandedBaseline.revisionId) continue;
        if (baseline.revisionId !== input.baselineRevisionId) {
          throw new Error("workflow-verification-baseline-conflict");
        }
        ledger.replaceDurableFact(
          this.#verification.baselineFactKey(resources),
          stored,
          verificationBaselineFact(
            {
              ...baseline,
              revisionId: expandedBaseline.revisionId,
            },
            resources.artifacts,
          ),
        );
      }
    }
    resources.baselineRevisionId = expandedBaseline.revisionId;
    resources.currentRevisionId = rebuilt.revisionId;
    if (hasVerificationLifecycle(input.plan)) {
      for (const task of input.tasks) {
        if (task.state === "verified" && !invalidated.has(task.taskId)) {
          this.#phase.completeTracking(resources, task.taskId);
        }
      }
    }
    return {
      invalidatedTaskIds: [...invalidated].sort(),
      baselineRevisionId: resources.baselineRevisionId,
      currentWorkspaceRevisionId: resources.currentRevisionId,
    };
  }

  isContextReadAvailable(
    input: Parameters<NonNullable<WorkflowWorker["isContextReadAvailable"]>>[0],
  ): boolean {
    const resources = this.#resources(input);
    const revision = resources.workspaces.getRevision(
      input.currentWorkspaceRevisionId,
    );
    return revision.entries[input.path]?.kind === "file";
  }

  rebind(input: Parameters<WorkflowWorker["rebind"]>[0]) {
    const rebound = this.#broker.rebind({
      runId: input.runId,
      taskId: input.taskId,
      role: input.role,
      routeId: input.routeId,
      requirements: implementationRouteRequirements({ task: input.task }),
    });
    return rebound.ok
      ? {
          ok: true as const,
          routeId: rebound.route.id,
          routeFingerprint: rebound.route.fingerprint,
        }
      : { ok: false as const, code: rebound.code };
  }

  async prepare(
    input: Parameters<WorkflowApplication["begin"]>[0],
  ): Promise<Record<string, unknown>> {
    if (!input.baselineRevisionId || !input.currentWorkspaceRevisionId) {
      return { state: "paused", code: "workspace-revision-unavailable" };
    }
    const resources = await this.#prepareResources(
      {
        runId: input.runId,
        deliveryRevision: input.deliveryRevision,
        plan: input.plan,
        baselineRevisionId: input.baselineRevisionId,
        currentWorkspaceRevisionId: input.currentWorkspaceRevisionId,
      },
      input.signal,
    );
    if (!resources.verificationFact) {
      return { state: "paused", code: "verification-fact-unavailable" };
    }
    if (this.#options.verificationEnvironment) {
      if (!resources.environmentIdentity)
        return {
          state: "paused",
          code: "verification-environment-unavailable",
        };
      this.#ledger(resources, resources.deliveryRevision).putDurableFact(
        `apply-environment-${hash(input.transactionId).slice(0, 40)}`,
        { identity: resources.environmentIdentity },
      );
    }
    const prepared = await resources.transactions.prepare({
      transactionId: input.transactionId,
      consumerRoot: input.consumerRoot,
      baselineRevisionId: resources.baselineRevisionId,
      finalRevisionId: resources.currentRevisionId,
      boundPaths: [
        ...new Set([
          ...deliveryBoundPaths(input.plan),
          ...(input.contextReadPaths ?? []),
        ]),
      ].sort(),
      verificationFact: resources.verificationFact,
    });
    return prepared;
  }

  async applyPrepared(
    input: Parameters<WorkflowApplication["begin"]>[0],
  ): Promise<Record<string, unknown>> {
    const resources = await this.#prepareResources(
      {
        runId: input.runId,
        deliveryRevision: input.deliveryRevision,
        plan: input.plan,
        ...(input.baselineRevisionId
          ? { baselineRevisionId: input.baselineRevisionId }
          : {}),
        ...(input.currentWorkspaceRevisionId
          ? { currentWorkspaceRevisionId: input.currentWorkspaceRevisionId }
          : {}),
      },
      input.signal,
    );
    return resources.transactions.apply(input.transactionId, input.signal);
  }

  async begin(
    input: Parameters<WorkflowApplication["begin"]>[0],
  ): Promise<Record<string, unknown>> {
    const prepared = await this.prepare(input);
    return prepared.state === "prepared" ? this.applyPrepared(input) : prepared;
  }

  #resourcesForApplication(
    context: WorkflowApplicationContext | undefined,
  ): DurableRunResources {
    if (!context) throw new Error("workflow-application-context-unavailable");
    return this.#resources({
      runId: context.runId,
      deliveryRevision: context.deliveryRevision,
      plan: context.plan,
      ...(context.baselineRevisionId
        ? { baselineRevisionId: context.baselineRevisionId }
        : {}),
      ...(context.currentWorkspaceRevisionId
        ? { currentWorkspaceRevisionId: context.currentWorkspaceRevisionId }
        : {}),
    });
  }

  requestControl(
    transactionId: string,
    intent: "cancel" | "discard",
    context?: WorkflowApplicationContext,
  ): Record<string, unknown> {
    return this.#resourcesForApplication(context).transactions.requestControl(
      transactionId,
      intent,
    );
  }

  recover(
    transactionId: string,
    context?: WorkflowApplicationContext,
  ): Promise<Record<string, unknown>> {
    return this.#resourcesForApplication(context).transactions.recover(
      transactionId,
    );
  }

  cleanup(runId: string): void {
    const resources = this.#runs.get(runId);
    if (resources) {
      this.#closeResources(resources);
      this.#runs.delete(runId);
    }
    rmSync(this.#runRoot(runId), { recursive: true, force: true });
  }

  close(): void {
    for (const resources of this.#runs.values()) {
      this.#closeResources(resources);
    }
    this.#runs.clear();
    this.#routeHealth.close();
  }
  runAttempt(input: Parameters<WorkflowWorker["runAttempt"]>[0]) {
    return this.#phase.runAttempt(input);
  }
  hasPendingVerification(input: Parameters<WorkflowWorker["runAttempt"]>[0]) {
    return this.#phase.hasPendingVerification(input);
  }
  verify(input: Parameters<WorkflowChangeVerifier["verify"]>[0]) {
    return this.#verification.verify(input);
  }
}

export function openDurableWorkflowEngine(
  options: DurableWorkflowEngineOptions,
): WorkflowEngine {
  const composition = new DurableWorkflowComposition(options);
  return WorkflowEngine.open({
    consumerRoot: options.consumerRoot,
    stateRoot: options.stateRoot,
    deliverySource: options.deliverySource,
    worker: composition,
    ...(options.workHardLimit !== undefined
      ? { workHardLimit: options.workHardLimit }
      : {}),
    changeVerifier: composition,
    application: composition,
    lifecycle: composition,
    ...(options.now ? { now: options.now } : {}),
    ...(options.leaseTtlMs !== undefined
      ? { leaseTtlMs: options.leaseTtlMs }
      : {}),
  });
}
