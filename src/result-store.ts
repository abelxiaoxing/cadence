import { randomUUID } from "node:crypto";
import type {
  BaselineEntry,
  VerificationContract,
} from "./candidate-preflight.ts";
import type { Bound, DirBound, FileBound } from "./file-snapshot.ts";
import { snapshotFiles } from "./file-snapshot.ts";

export interface RetainedResult {
  id: string;
  diff: Buffer;
  writeSet: string[];
  root: string;
  snapshot: Bound;
  baseline: BaselineEntry[];
  verification?: VerificationContract;
  packageManifest?: FileBound;
  lockfile?: FileBound;
  dependencyTarget?: FileBound | DirBound;
}

export class ResultStore {
  private readonly results = new Map<string, RetainedResult>();

  retain(input: {
    diff: string;
    writeSet: string[];
    root: string;
    snapshot?: Bound;
    baseline?: BaselineEntry[];
    verification?: VerificationContract;
    packageManifest?: FileBound;
    lockfile?: FileBound;
    dependencyTarget?: FileBound | DirBound;
  }): string {
    const id = randomUUID();
    this.results.set(id, {
      id,
      diff: Buffer.from(input.diff, "utf8"),
      writeSet: [...new Set(input.writeSet)],
      root: input.root,
      snapshot: input.snapshot ?? snapshotFiles(input.root, input.writeSet),
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
    });
    return id;
  }

  get(id: string): RetainedResult | undefined {
    return this.results.get(id);
  }
  discard(id: string): boolean {
    return this.results.delete(id);
  }
  clear(): void {
    this.results.clear();
  }
  get size(): number {
    return this.results.size;
  }
}
