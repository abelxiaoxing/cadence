/** Readonly Cadence mode/plan records. Missing bound controls never become
 * ordinary editing authority. Shared by the owner and retained-history views. */
import { dirname, join } from "node:path";
import {
  ContractError,
  closed,
  decodeId,
  parseWireJson,
} from "./contracts/core.ts";
import {
  type CadenceConversation,
  decodeCadenceConversation,
} from "./contracts/workbench.ts";
import {
  type ConversationRecords,
  observedFile,
} from "./conversation-records.ts";
import type { FileSnapshot, PrivateFiles } from "./private-files.ts";
export const CONTROL_BYTES = 384 * 1024;
export const CONTROL_SCHEMA = "cadence-conversation-workflow/1";
const CACHE = 512;
const INCOMPLETE =
  "Cadence control state for this conversation is missing, incomplete or unreadable. No mode, plan or run is inferred and nothing was repaired. Start a new conversation; preserve this state for local diagnosis.";
const UNRECORDED =
  "The last Cadence message of this conversation was not durably recorded. Its plan is not approvable and nothing was replayed or repaired. Start a new conversation; preserve this state for local diagnosis.";
const UNAVAILABLE =
  "Cadence control state for this conversation could not be read just now. Nothing is inferred; it is read again on the next request.";
export interface Usable {
  state: CadenceConversation;
  file?: FileSnapshot;
}
export interface Loaded extends Usable {
  /** The record exists but is unusable; reads still project it. */
  problem?: true;
  /** This read failed with an I/O error, not because of the record's content:
   * never cached, and reported as unavailable rather than as a bad record. */
  transient?: true;
}
export function freshCadenceConversation(id: string): CadenceConversation {
  return {
    id,
    revision: 0,
    enabled: false,
    head: null,
    proposal: null,
    runs: [],
  };
}
/** A Node system error (EMFILE, EIO, ...) says nothing about record content. */
function transient(error: unknown): boolean {
  return (
    error instanceof Error &&
    !(error instanceof ContractError) &&
    "code" in error &&
    typeof error.code === "string" &&
    /^E[A-Z0-9]+$/u.test(error.code)
  );
}
function unusable(id: string): Loaded {
  // Fail closed: an unknown mode is never treated as ordinary editing.
  return {
    state: {
      ...freshCadenceConversation(id),
      enabled: true,
      notice: INCOMPLETE,
    },
    problem: true,
  };
}
export class ConversationControls {
  readonly root: string;
  private readonly cache = new Map<
    string,
    { key: string; state: CadenceConversation }
  >();
  constructor(
    private readonly o: {
      directory: string;
      files: Pick<PrivateFiles, "read" | "directory">;
      conversations: ConversationRecords;
      assertCurrent(): void;
    },
  ) {
    this.root = join(o.directory, "conversation-workflows-v1");
  }
  path(id: string) {
    return join(this.root, decodeId(id), "state.json");
  }
  /** Never throws for one record's problems: those degrade only that conversation. */
  read(id: string): Loaded {
    this.o.assertCurrent();
    const path = this.path(id);
    try {
      const bound = this.o.conversations.controlBound(id);
      const file = this.o.files.read(path, CONTROL_BYTES);
      if (!file)
        return bound || this.o.files.directory(dirname(path))
          ? unusable(id)
          : { state: freshCadenceConversation(id) };
      const record = closed(
        parseWireJson(file.bytes.toString("utf8"), CONTROL_BYTES),
        ["schema", "state"],
      );
      const state = decodeCadenceConversation(record.state);
      if (
        record.schema !== CONTROL_SCHEMA ||
        !bound ||
        state.id !== id ||
        state.notice !== undefined
      )
        return unusable(id);
      if (state.head && !this.o.conversations.hasTurn(id, state.head))
        return {
          state: { ...state, proposal: null, notice: UNRECORDED },
          problem: true,
        };
      return { state, file };
    } catch (error) {
      this.o.assertCurrent();
      if (transient(error))
        return {
          state: {
            ...freshCadenceConversation(id),
            enabled: true,
            notice: UNAVAILABLE,
          },
          problem: true,
          transient: true,
        };
      return unusable(id);
    }
  }
  usable(id: string): Usable {
    const loaded = this.read(id);
    if (loaded.transient) throw new ContractError("unavailable");
    if (loaded.problem) throw new ContractError("corrupt-selected");
    return loaded;
  }
  state(id: string): CadenceConversation {
    const loaded = this.read(id);
    if (loaded.transient) throw new ContractError("unavailable");
    return loaded.state;
  }
  /** Cheap list/link projection: a record is re-decoded only when it or its
   * control link changed. Its validity is only lost by a changed record. */
  observe(id: string): CadenceConversation {
    this.o.assertCurrent();
    let key: string;
    try {
      key = `${observedFile(this.path(id))}|${this.o.conversations.controlKey(id)}`;
    } catch {
      return this.read(id).state;
    }
    const hit = this.cache.get(id);
    if (hit?.key === key) return hit.state;
    const loaded = this.read(id);
    // A failed read is never remembered: the next observation reads again.
    if (loaded.transient) {
      this.cache.delete(id);
      return loaded.state;
    }
    if (this.cache.size >= CACHE) this.cache.clear();
    this.cache.set(id, { key, state: loaded.state });
    return loaded.state;
  }
}
