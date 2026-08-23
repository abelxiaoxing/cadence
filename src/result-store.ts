import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type {
  BaselineEntry,
  VerificationContract,
} from "./candidate-preflight.ts";
import type { ImplementationPhase } from "./contracts.ts";
import type { Bound, DirBound, FileBound } from "./file-snapshot.ts";
import { snapshotFiles } from "./file-snapshot.ts";

export interface RetainedCandidateIdentity {
  stage: "abel-implement";
  canonicalRoot: string;
  root: string;
  changeId: string;
  taskId: string;
  originRequestId: string;
  phase: ImplementationPhase;
  launchIndex: 0 | 1;
}

export interface RetainedCandidateFacts extends RetainedCandidateIdentity {
  writeSet: string[];
  approvedDependencies: string[];
  snapshot: Bound;
}

export interface RetainedResult {
  id: string;
  diff: Buffer;
  stage?: RetainedCandidateIdentity["stage"];
  canonicalRoot?: string;
  changeId?: string;
  taskId?: string;
  originRequestId?: string;
  phase?: ImplementationPhase;
  launchIndex?: 0 | 1;
  writeSet: string[];
  approvedDependencies: string[];
  root: string;
  snapshot: Bound;
  baseline: BaselineEntry[];
  verification?: VerificationContract;
  packageManifest?: FileBound;
  lockfile?: FileBound;
  dependencyTarget?: FileBound | DirBound;
}

export type BoundRetainedResult = RetainedResult & RetainedCandidateIdentity;

interface RetainCandidateData {
  diff: string;
  writeSet: string[];
  approvedDependencies?: string[];
  root: string;
  snapshot?: Bound;
  baseline?: BaselineEntry[];
  verification?: VerificationContract;
  packageManifest?: FileBound;
  lockfile?: FileBound;
  dependencyTarget?: FileBound | DirBound;
}

type RetainInput = RetainCandidateData & Partial<RetainedCandidateIdentity>;

const IDENTITY_KEYS = [
  "stage",
  "canonicalRoot",
  "changeId",
  "taskId",
  "originRequestId",
  "phase",
  "launchIndex",
] as const;

function hasCompleteIdentity(
  value: RetainedResult | RetainInput,
): value is (RetainedResult | RetainInput) & RetainedCandidateIdentity {
  return IDENTITY_KEYS.every((key) => value[key] !== undefined);
}

function hasAnyIdentity(value: RetainedResult | RetainInput): boolean {
  return IDENTITY_KEYS.some((key) => value[key] !== undefined);
}

function cloneIdentity(identity: RetainedCandidateIdentity) {
  return {
    stage: identity.stage,
    canonicalRoot: identity.canonicalRoot,
    changeId: identity.changeId,
    taskId: identity.taskId,
    originRequestId: identity.originRequestId,
    phase: identity.phase,
    launchIndex: identity.launchIndex,
  };
}

function cloneRetained(retained: RetainedResult): RetainedResult {
  const clone: RetainedResult = {
    ...retained,
    diff: Buffer.from(retained.diff),
    writeSet: [...retained.writeSet],
    approvedDependencies: [...retained.approvedDependencies],
    snapshot: structuredClone(retained.snapshot),
    baseline: retained.baseline.map((entry) => ({ ...entry })),
  };
  if (retained.verification) {
    clone.verification = {
      ...retained.verification,
      argv: [...retained.verification.argv],
    };
  }
  if (retained.packageManifest) {
    clone.packageManifest = { ...retained.packageManifest };
  }
  if (retained.lockfile) clone.lockfile = { ...retained.lockfile };
  if (retained.dependencyTarget) {
    clone.dependencyTarget = { ...retained.dependencyTarget };
  }
  return clone;
}

export class ResultStore {
  private readonly results = new Map<string, RetainedResult>();
  private readonly sealedResults = new Map<string, RetainedResult>();
  private readonly sealedCandidateFacts = new Map<
    string,
    RetainedCandidateFacts
  >();

  retain(input: RetainInput): string {
    if (hasAnyIdentity(input) && !hasCompleteIdentity(input)) {
      throw new Error("retained candidate identity is incomplete");
    }
    const id = randomUUID();
    const retained: RetainedResult = {
      id,
      diff: Buffer.from(input.diff, "utf8"),
      ...(hasCompleteIdentity(input) ? cloneIdentity(input) : {}),
      writeSet: [...input.writeSet],
      approvedDependencies: [...(input.approvedDependencies ?? [])],
      root: input.root,
      snapshot: structuredClone(
        input.snapshot ?? snapshotFiles(input.root, input.writeSet),
      ),
      baseline: (input.baseline ?? []).map((entry) => ({ ...entry })),
      ...(input.verification === undefined
        ? {}
        : {
            verification: {
              ...input.verification,
              argv: [...input.verification.argv],
            },
          }),
      ...(input.packageManifest === undefined
        ? {}
        : { packageManifest: { ...input.packageManifest } }),
      ...(input.lockfile === undefined
        ? {}
        : { lockfile: { ...input.lockfile } }),
      ...(input.dependencyTarget === undefined
        ? {}
        : { dependencyTarget: { ...input.dependencyTarget } }),
    };
    this.results.set(id, retained);
    this.sealedResults.set(id, cloneRetained(retained));
    if (hasCompleteIdentity(retained)) {
      this.sealedCandidateFacts.set(id, this.cloneFacts(retained));
    }
    return id;
  }

  get(id: string): RetainedResult | undefined {
    const retained = this.results.get(id);
    return retained ? cloneRetained(retained) : undefined;
  }

  hasCandidateIdentity(id: string): boolean {
    const retained = this.results.get(id);
    if (!retained) return false;
    this.assertIntegrity(id, retained);
    return hasAnyIdentity(retained);
  }

  bindIdentity(
    id: string,
    identity: RetainedCandidateIdentity,
  ): BoundRetainedResult {
    const retained = this.results.get(id);
    if (!retained) throw new Error("retained result not found");
    this.assertIntegrity(id, retained);
    if (hasAnyIdentity(retained)) {
      if (
        !hasCompleteIdentity(retained) ||
        !this.matchesIdentity(retained, identity)
      ) {
        throw new Error("retained candidate identity mismatch");
      }
      return cloneRetained(retained) as BoundRetainedResult;
    }
    if (retained.root !== identity.root) {
      throw new Error("retained candidate identity mismatch");
    }
    Object.assign(retained, cloneIdentity(identity));
    this.sealedResults.set(id, cloneRetained(retained));
    return cloneRetained(retained) as BoundRetainedResult;
  }

  resolveIdentity(
    id: string,
    expected: RetainedCandidateFacts,
  ): BoundRetainedResult {
    const retained = this.results.get(id);
    if (!retained) throw new Error("retained result not found");
    this.assertIntegrity(id, retained);
    if (
      !hasCompleteIdentity(retained) ||
      !this.matchesIdentity(retained, expected) ||
      !isDeepStrictEqual(retained.writeSet, expected.writeSet) ||
      !isDeepStrictEqual(
        retained.approvedDependencies,
        expected.approvedDependencies,
      )
    ) {
      throw new Error("retained candidate identity mismatch");
    }
    const sealed = this.sealedCandidateFacts.get(id);
    if (sealed) {
      if (
        !this.matchesIdentity(retained, sealed) ||
        !isDeepStrictEqual(retained.writeSet, sealed.writeSet) ||
        !isDeepStrictEqual(
          retained.approvedDependencies,
          sealed.approvedDependencies,
        ) ||
        !isDeepStrictEqual(retained.snapshot, sealed.snapshot)
      ) {
        throw new Error("retained candidate identity mismatch");
      }
    } else {
      if (!isDeepStrictEqual(retained.snapshot, expected.snapshot)) {
        throw new Error("retained candidate identity mismatch");
      }
      this.sealedCandidateFacts.set(id, this.cloneFacts(retained));
    }
    return cloneRetained(retained) as BoundRetainedResult;
  }

  resolveForApply(id: string): RetainedResult {
    const retained = this.results.get(id);
    if (!retained) throw new Error("retained result not found");
    this.assertIntegrity(id, retained);
    return cloneRetained(retained);
  }

  private assertIntegrity(id: string, retained: RetainedResult): void {
    const sealed = this.sealedResults.get(id);
    if (sealed && isDeepStrictEqual(retained, sealed)) return;
    const identityChanged =
      sealed !== undefined &&
      (IDENTITY_KEYS.some((key) => retained[key] !== sealed[key]) ||
        retained.root !== sealed.root ||
        !isDeepStrictEqual(retained.writeSet, sealed.writeSet) ||
        !isDeepStrictEqual(
          retained.approvedDependencies,
          sealed.approvedDependencies,
        ) ||
        !isDeepStrictEqual(retained.snapshot, sealed.snapshot));
    throw new Error(
      identityChanged
        ? "retained candidate identity mismatch"
        : "retained candidate integrity mismatch",
    );
  }

  private cloneFacts(retained: BoundRetainedResult): RetainedCandidateFacts {
    return {
      ...cloneIdentity(retained),
      root: retained.root,
      writeSet: [...retained.writeSet],
      approvedDependencies: [...retained.approvedDependencies],
      snapshot: structuredClone(retained.snapshot),
    };
  }

  private matchesIdentity(
    retained: BoundRetainedResult,
    expected: RetainedCandidateIdentity,
  ): boolean {
    return (
      retained.stage === expected.stage &&
      retained.canonicalRoot === expected.canonicalRoot &&
      retained.root === expected.root &&
      retained.changeId === expected.changeId &&
      retained.taskId === expected.taskId &&
      retained.originRequestId === expected.originRequestId &&
      retained.phase === expected.phase &&
      retained.launchIndex === expected.launchIndex
    );
  }

  discard(id: string): boolean {
    this.sealedResults.delete(id);
    this.sealedCandidateFacts.delete(id);
    return this.results.delete(id);
  }
  clear(): void {
    this.results.clear();
    this.sealedResults.clear();
    this.sealedCandidateFacts.clear();
  }
  get size(): number {
    return this.results.size;
  }
}
