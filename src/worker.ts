// Process-local logical Worker registry for private orchestration. A Worker
// is pinned by the first accepted phase: logical ID, stage, role, the
// provider/model/API/thinking identity, and the approved non-snapshot
// contract. Later accepted Red/Green/optional Refactor phases receive fresh
// snapshots and fresh phase-local auth for the SAME pinned identity. A failed
// phase may be mechanically redispatched exactly once when its canonical
// request is identical apart from refreshed snapshot hashes; a second failure
// blocks that branch. No credential, transcript, or retry ledger is retained.

import type { RequestEnvelope } from "./contracts.ts";

export interface WorkerContract {
  stage: string;
  role: string;
  id: string;
  objective: string;
  roots: string[];
  agents: string;
  contractText: string;
  read: string[];
  write: string[];
  conflicts: string[];
  resources: string[];
  verificationLock?: string;
  output: string;
}

export interface LogicalWorker {
  identity: string;
  contract: WorkerContract;
  redispatchUsed: boolean;
}

// Pins the semantic scope of a logical Worker, excluding the phase label so a
// later Red/Green/Refactor phase is recognized as the same Worker.
export function contractOf(envelope: RequestEnvelope): WorkerContract {
  return {
    stage: envelope.stage,
    role: envelope.role,
    id: envelope.id,
    objective: envelope.objective,
    roots: [...envelope.roots],
    agents: envelope.context.agents,
    contractText: envelope.context.contract,
    read: [...envelope.declared.read],
    write: [...envelope.declared.write],
    conflicts: [...envelope.declared.conflicts],
    resources: [...envelope.declared.resources],
    verificationLock: envelope.declared.verificationLock,
    output: envelope.output,
  };
}

export function sameContract(a: WorkerContract, b: WorkerContract): boolean {
  if (
    a.stage !== b.stage ||
    a.role !== b.role ||
    a.id !== b.id ||
    a.objective !== b.objective ||
    a.agents !== b.agents ||
    a.contractText !== b.contractText ||
    a.output !== b.output ||
    a.verificationLock !== b.verificationLock
  )
    return false;
  return (
    arrayEqual(a.roots, b.roots) &&
    arrayEqual(a.read, b.read) &&
    arrayEqual(a.write, b.write) &&
    arrayEqual(a.conflicts, b.conflicts) &&
    arrayEqual(a.resources, b.resources)
  );
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
    const worker: LogicalWorker = {
      identity,
      contract,
      redispatchUsed: false,
    };
    this.workers.set(contract.id, worker);
    return worker;
  }

  clear(): void {
    this.workers.clear();
  }
}
