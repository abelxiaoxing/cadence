/** Bounded readonly ID-order selection over an unbounded retained directory.
 * Scans hold only one page + lookahead, never all run IDs or record bodies.
 * Ephemeral one-use continuations are navigation, not auth or execution consent. */
import { randomUUID } from "node:crypto";
import { type Dir, lstatSync, opendirSync } from "node:fs";
import { ContractError, decodeId } from "./contracts/core.ts";
import { WORKFLOW_LIMITS } from "./contracts/workflow.ts";

interface Scan {
  dir: Dir;
  incarnation: string;
  after: string | null;
  ids: string[];
  timer?: ReturnType<typeof setTimeout>;
}
export type WorkflowHistorySelection =
  | { kind: "ids"; ids: string[]; next: string | null }
  | { kind: "workflow-history-progress"; after: string | null; scan: string };

export class WorkflowHistoryScanner {
  private readonly scans = new Map<string, Scan>();
  private closed = false;
  constructor(
    private readonly path: string,
    /** Checks the current owner lease and private-directory safety on EVERY call. */
    private readonly directory: () => boolean,
  ) {}
  private incarnation(): string {
    const st = lstatSync(this.path, { bigint: true });
    if (!st.isDirectory() || st.isSymbolicLink())
      throw new ContractError("corrupt-selected");
    // Additions need not invalidate a non-snapshot listing; replacement must.
    return `${st.dev}:${st.ino}`;
  }
  read(after: string | null, cursor?: string): WorkflowHistorySelection {
    if (after !== null) decodeId(after);
    if (cursor !== undefined) decodeId(cursor);
    if (this.closed) throw new ContractError("unavailable");
    let state: Scan;
    if (cursor !== undefined) {
      const selected = this.scans.get(cursor);
      if (!selected || selected.after !== after)
        throw new ContractError("stale");
      // A lost reply cannot replay this directory read. Explicit refresh starts a
      // new observation at the same exclusive ID boundary, not a task mutation.
      this.scans.delete(cursor);
      clearTimeout(selected.timer);
      state = selected;
    } else {
      if (!this.directory()) return { kind: "ids", ids: [], next: null };
      if (this.scans.size >= WORKFLOW_LIMITS.historyScans)
        throw new ContractError("capacity");
      const incarnation = this.incarnation();
      state = { dir: opendirSync(this.path), incarnation, after, ids: [] };
    }
    let suspended = false;
    try {
      if (!this.directory() || this.incarnation() !== state.incarnation)
        throw new ContractError("stale");
      for (let n = 0; n < WORKFLOW_LIMITS.historyScanEntries; n++) {
        const entry = state.dir.readSync();
        if (!entry) {
          const ids = state.ids.slice(0, WORKFLOW_LIMITS.historyPage);
          return {
            kind: "ids",
            ids,
            next: state.ids.length > ids.length ? (ids.at(-1) ?? null) : null,
          };
        }
        if (!entry.isDirectory()) throw new ContractError("corrupt-selected");
        const id = decodeId(entry.name);
        if ((after !== null && id <= after) || state.ids.includes(id)) continue;
        state.ids.push(id);
        state.ids.sort();
        if (state.ids.length > WORKFLOW_LIMITS.historyPage + 1) state.ids.pop();
      }
      const scan = randomUUID();
      state.timer = setTimeout(() => {
        this.scans.delete(scan);
        try {
          state.dir.closeSync();
        } catch {
          this.closed = true;
        }
      }, WORKFLOW_LIMITS.historyIdleMs);
      state.timer.unref();
      this.scans.set(scan, state);
      suspended = true;
      return { kind: "workflow-history-progress", after, scan };
    } finally {
      if (!suspended) state.dir.closeSync();
    }
  }
  /** Owner teardown closes only its own readonly handles, never retained data. */
  close(): void {
    this.closed = true;
    let failed = false;
    for (const state of this.scans.values()) {
      clearTimeout(state.timer);
      try {
        state.dir.closeSync();
      } catch {
        failed = true;
      }
    }
    this.scans.clear();
    if (failed) throw new ContractError("unavailable");
  }
}
