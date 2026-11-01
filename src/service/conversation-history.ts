/** Recent-first conversation pages with bounded scanning, not a retained-count cap. */
import { randomUUID } from "node:crypto";
import { type Dir, lstatSync, opendirSync } from "node:fs";
import { ContractError, decodeId, LIMITS } from "./contracts/core.ts";
import type {
  ChatCursor,
  ChatSummary,
  WorkbenchResult,
} from "./contracts/workbench.ts";

export const CONVERSATION_PAGE = 50;
const SCAN_ENTRIES = 8; // Even legacy 384KiB heads + metadata fit an 8MiB quantum.
const SCANS = 16;
const IDLE_MS = 120000;
export const compareChats = (a: ChatCursor, b: ChatCursor) =>
  b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
interface Scan {
  dir: Dir;
  incarnation: string;
  after: ChatCursor | null;
  entries: ChatSummary[];
  timer?: ReturnType<typeof setTimeout>;
}
export class ConversationHistory {
  private readonly scans = new Map<string, Scan>();
  private closed = false;
  constructor(
    private readonly path: string,
    private readonly directory: () => boolean,
    private readonly summary: (id: string) => ChatSummary,
  ) {}
  private incarnation() {
    const st = lstatSync(this.path, { bigint: true });
    if (!st.isDirectory() || st.isSymbolicLink())
      throw new ContractError("corrupt-selected");
    return `${st.dev}:${st.ino}`;
  }
  read(after: ChatCursor | null, cursor?: string): WorkbenchResult {
    if (this.closed) throw new ContractError("unavailable");
    let state: Scan;
    if (cursor) {
      const selected = this.scans.get(cursor);
      if (
        !selected ||
        selected.after?.id !== after?.id ||
        selected.after?.updatedAt !== after?.updatedAt
      )
        throw new ContractError("stale");
      this.scans.delete(cursor);
      clearTimeout(selected.timer);
      state = selected;
    } else {
      if (!this.directory())
        return { kind: "conversations", entries: [], next: null };
      if (this.scans.size >= SCANS) throw new ContractError("capacity");
      const incarnation = this.incarnation();
      state = {
        dir: opendirSync(this.path),
        incarnation,
        after,
        entries: [],
      };
    }
    let suspended = false;
    try {
      if (!this.directory() || this.incarnation() !== state.incarnation)
        throw new ContractError("stale");
      const started = performance.now();
      for (let n = 0; n < SCAN_ENTRIES; n++) {
        if (n && performance.now() - started >= LIMITS.searchMs) break;
        const e = state.dir.readSync();
        if (!e) {
          const entries = state.entries.slice(0, CONVERSATION_PAGE);
          const last = entries.at(-1);
          return {
            kind: "conversations",
            entries,
            next:
              state.entries.length > entries.length && last
                ? { id: last.id, updatedAt: last.updatedAt }
                : null,
          };
        }
        if (!e.isFile() || !e.name.endsWith(".json"))
          throw new ContractError("corrupt-selected");
        const summary = this.summary(decodeId(e.name.slice(0, -5)));
        if (after && compareChats(summary, after) <= 0) continue;
        if (state.entries.some((row) => row.id === summary.id)) continue;
        state.entries.push(summary);
        state.entries.sort(compareChats);
        if (state.entries.length > CONVERSATION_PAGE + 1) state.entries.pop();
      }
      const scan = randomUUID();
      state.timer = setTimeout(() => {
        this.scans.delete(scan);
        try {
          state.dir.closeSync();
        } catch {
          this.closed = true;
        }
      }, IDLE_MS);
      state.timer.unref();
      this.scans.set(scan, state);
      suspended = true;
      return { kind: "conversations-progress", after, scan };
    } finally {
      if (!suspended) state.dir.closeSync();
    }
  }
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
