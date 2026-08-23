// Process-local task registry for the private Implement runtime.

import type {
  CandidateFailure,
  ImplementationPhase,
  PhaseAttempt,
  TaskBoundary,
  TaskFailure,
} from "./contracts.ts";
import type { ConflictDeclaration } from "./scheduler.ts";
import type { SubagentEndpoint } from "./subagent-endpoint.ts";

export type TaskState =
  | {
      kind: "ready";
      phase: ImplementationPhase;
      launchIndex: 0 | 1;
      correction?: CandidateFailure;
    }
  | {
      kind: "candidate-pending";
      phase: ImplementationPhase;
      launchIndex: 0 | 1;
      originRequestId: string;
      resultId: string;
    }
  | {
      kind: "agents-checkpoint-pending";
      finalPhase: "green" | "refactor";
      attemptIndex: 0 | 1;
    }
  | { kind: "blocked"; phase: ImplementationPhase; failure: TaskFailure }
  | { kind: "completed"; finalPhase: "green" | "refactor" };

export interface TaskRecord {
  key: string;
  workspaceRoot: string;
  workerIdentity: string;
  subagentEndpoint: Readonly<SubagentEndpoint> | null;
  boundary: TaskBoundary;
  conflict: ConflictDeclaration;
  state: TaskState;
}

export function taskRecordKey(
  workspaceRoot: string,
  changeId: string,
  taskId: string,
): string {
  return `${workspaceRoot}\0${changeId}\0${taskId}`;
}

export function taskConflictOf(boundary: TaskBoundary): ConflictDeclaration {
  const phases = [
    boundary.phases.red,
    boundary.phases.green,
    ...(boundary.phases.refactor ? [boundary.phases.refactor] : []),
  ];
  const write = new Set(phases.flatMap((phase) => phase.write));
  if (boundary.agents.impact !== "none" && boundary.agents.target) {
    write.add(boundary.agents.target);
  }
  return {
    taskId: boundary.taskId,
    read: [...new Set(phases.flatMap((phase) => phase.read))],
    write: [...write],
    conflicts: [...boundary.scheduling.conflicts],
    resources: [...boundary.scheduling.resources],
    verificationLocks: [
      ...new Set(
        phases.flatMap((phase) =>
          phase.verificationLock ? [phase.verificationLock] : [],
        ),
      ),
    ],
  };
}

// Stable provider/model/API identity fingerprint. Fresh auth may be acquired
// for each phase, while the selected execution identity remains pinned.
export function workerIdentity(model: {
  provider?: unknown;
  api?: unknown;
  baseUrl?: unknown;
  id?: unknown;
  name?: unknown;
}): string {
  const parts: string[] = [
    `p:${String(model.provider ?? "")}`,
    `a:${String(model.api ?? "")}`,
  ];
  if (model.baseUrl !== undefined) parts.push(`u:${String(model.baseUrl)}`);
  if (typeof model.id === "string") parts.push(`id:${model.id}`);
  if (typeof model.name === "string") parts.push(`n:${model.name}`);
  return parts.join("|");
}

export class WorkerRegistry {
  private readonly tasks = new Map<string, TaskRecord>();

  has(key: string): boolean {
    return this.tasks.has(key);
  }

  get(key: string): TaskRecord | undefined {
    return this.tasks.get(key);
  }

  find(workspaceRoot: string, taskId: string): TaskRecord | undefined {
    const matches = [...this.tasks.values()].filter(
      (record) =>
        record.workspaceRoot === workspaceRoot &&
        record.boundary.taskId === taskId,
    );
    return matches.length === 1 ? matches[0] : undefined;
  }

  open(
    boundary: TaskBoundary,
    identity: string,
    workspaceRoot: string,
    attempt: PhaseAttempt,
    subagentEndpoint: Readonly<SubagentEndpoint> | null = null,
  ): TaskRecord {
    const key = taskRecordKey(
      workspaceRoot,
      boundary.changeId,
      boundary.taskId,
    );
    if (this.tasks.has(key)) throw new Error("duplicate task open");
    const storedBoundary = structuredClone(boundary);
    const record: TaskRecord = {
      key,
      workspaceRoot,
      workerIdentity: identity,
      subagentEndpoint:
        subagentEndpoint === null
          ? null
          : Object.freeze({ ...subagentEndpoint }),
      boundary: storedBoundary,
      conflict: taskConflictOf(storedBoundary),
      state: { kind: "ready", phase: attempt.phase, launchIndex: 0 },
    };
    this.tasks.set(key, record);
    return record;
  }

  values(): TaskRecord[] {
    return [...this.tasks.values()];
  }

  clear(): void {
    this.tasks.clear();
  }
}
