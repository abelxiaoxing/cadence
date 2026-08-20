// Process-local logical Worker registry for private orchestration. A Worker
// is keyed by stable task identity. Its immutable task contract is separate
// from the current phase request, snapshot, verification, and launch budget.
// No credential, transcript, provider diagnostic, or unbounded retry ledger
// is retained.

import type { RequestEnvelope, VerificationContract } from "./contracts.ts";

export interface WorkerContract {
  stage: string;
  role: string;
  taskId: string;
  objective: string;
  roots: string[];
  agents: string;
  contractText: string;
  read: string[];
  conflicts: string[];
  resources: string[];
  output: string;
  currentPhase: WorkerPhaseContract;
}

export interface WorkerTaskContract {
  stage: string;
  role: string;
  taskId: string;
  objective: string;
  roots: string[];
  agents: string;
  contractText: string;
  read: string[];
  conflicts: string[];
  resources: string[];
  output: string;
}

export interface WorkerPhaseContract {
  requestId: string;
  phase: string;
  readSet: string[];
  writeSet: string[];
  conflicts: string[];
  resources: string[];
  verificationLock?: string;
  snapshot?: unknown;
  verification?: VerificationContract;
  correctionIndex: 0 | 1;
}

export interface LogicalWorker {
  identity: string;
  taskContract: WorkerTaskContract;
  currentPhase: WorkerPhaseContract;
  state: WorkerState;
}

export type WorkerState =
  | { kind: "ready" }
  | { kind: "candidate-pending" }
  | { kind: "phase-applied" }
  | { kind: "artifact-correction-pending"; rejection: string }
  | { kind: "stale-redispatch-pending" }
  | { kind: "blocked"; reason: "artifact" | "mechanical" };

export function contractOf(envelope: RequestEnvelope): WorkerContract {
  return {
    stage: envelope.stage,
    role: envelope.role,
    taskId: envelope.taskId ?? envelope.id,
    objective: envelope.objective,
    roots: [...envelope.roots],
    agents: envelope.context.agents,
    contractText: envelope.context.contract,
    read: [...envelope.declared.read],
    conflicts: [...envelope.declared.conflicts],
    resources: [...envelope.declared.resources],
    output: envelope.output,
    currentPhase: phaseOf(envelope, 0),
  };
}

export function sameContract(
  a: WorkerTaskContract,
  b: WorkerTaskContract,
): boolean {
  if (
    a.stage !== b.stage ||
    a.role !== b.role ||
    a.taskId !== b.taskId ||
    a.objective !== b.objective ||
    a.agents !== b.agents ||
    a.contractText !== b.contractText ||
    a.output !== b.output
  )
    return false;
  return (
    arrayEqual(a.roots, b.roots) &&
    arrayEqual(a.read, b.read) &&
    arrayEqual(a.conflicts, b.conflicts) &&
    arrayEqual(a.resources, b.resources)
  );
}

export function samePhaseContract(
  a: WorkerPhaseContract,
  b: WorkerPhaseContract,
): boolean {
  return (
    a.phase === b.phase &&
    arrayEqual(a.readSet, b.readSet) &&
    arrayEqual(a.writeSet, b.writeSet) &&
    arrayEqual(a.conflicts, b.conflicts) &&
    arrayEqual(a.resources, b.resources) &&
    a.verificationLock === b.verificationLock &&
    JSON.stringify(a.verification) === JSON.stringify(b.verification)
  );
}

function phaseOf(
  envelope: RequestEnvelope,
  correctionIndex: 0 | 1,
): WorkerPhaseContract {
  return {
    requestId: envelope.id,
    phase: envelope.phase,
    readSet: [...envelope.declared.read],
    writeSet: [...envelope.declared.write],
    conflicts: [...envelope.declared.conflicts],
    resources: [...envelope.declared.resources],
    verificationLock: envelope.declared.verificationLock,
    snapshot:
      envelope.snapshot === undefined
        ? undefined
        : structuredClone(envelope.snapshot),
    verification:
      envelope.verification === undefined
        ? undefined
        : {
            ...envelope.verification,
            argv: [...envelope.verification.argv],
          },
    correctionIndex,
  };
}

function arrayEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

// Stable provider/model/API/thinking identity fingerprint for a phase. Each
// child attempt re-derives it while the phase-local auth boundary is called
// anew, so the identity stays pinned across fresh phases.
export function workerIdentity(model: {
  provider?: unknown;
  baseUrl?: unknown;
  id?: unknown;
  name?: unknown;
}): string {
  const parts: string[] = [`p:${String(model.provider ?? "")}`];
  if (model.baseUrl !== undefined) parts.push(`u:${String(model.baseUrl)}`);
  if (typeof model.id === "string") parts.push(`id:${model.id}`);
  if (typeof model.name === "string") parts.push(`n:${model.name}`);
  return parts.join("|");
}

export class WorkerRegistry {
  private readonly workers = new Map<string, LogicalWorker>();

  has(id: string): boolean {
    return this.workers.has(id);
  }

  get(id: string): LogicalWorker | undefined {
    return this.workers.get(id);
  }

  pin(contract: WorkerContract, identity: string): LogicalWorker {
    const currentPhase = clonePhase(contract.currentPhase);
    const worker: LogicalWorker = {
      identity,
      taskContract: cloneTask(contract),
      currentPhase,
      state: { kind: "ready" },
    };
    this.workers.set(contract.taskId, worker);
    return worker;
  }

  setCurrentPhase(
    taskId: string,
    contract: WorkerContract,
    correctionIndex: 0 | 1,
  ): LogicalWorker | undefined {
    const worker = this.workers.get(taskId);
    if (!worker) return undefined;
    const currentPhase = {
      ...clonePhase(contract.currentPhase),
      correctionIndex,
    };
    worker.currentPhase = currentPhase;
    worker.state = { kind: "ready" };
    return worker;
  }

  clear(): void {
    this.workers.clear();
  }
}

function cloneTask(contract: WorkerContract): WorkerTaskContract {
  return {
    stage: contract.stage,
    role: contract.role,
    taskId: contract.taskId,
    objective: contract.objective,
    roots: [...contract.roots],
    agents: contract.agents,
    contractText: contract.contractText,
    read: [...contract.read],
    conflicts: [...contract.conflicts],
    resources: [...contract.resources],
    output: contract.output,
  };
}

function clonePhase(phase: WorkerPhaseContract): WorkerPhaseContract {
  return structuredClone(phase);
}
