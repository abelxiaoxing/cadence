import { randomUUID } from "node:crypto";
import type { Bound } from "./file-snapshot.ts";
import { snapshotFiles } from "./file-snapshot.ts";

export interface RetainedResult {
  id: string;
  diff: Buffer;
  writeSet: string[];
  root: string;
  snapshot: Bound;
}

export class ResultStore {
  private readonly results = new Map<string, RetainedResult>();

  retain(input: { diff: string; writeSet: string[]; root: string }): string {
    const id = randomUUID();
    this.results.set(id, {
      id,
      diff: Buffer.from(input.diff, "utf8"),
      writeSet: [...new Set(input.writeSet)],
      root: input.root,
      snapshot: snapshotFiles(input.root, input.writeSet),
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
