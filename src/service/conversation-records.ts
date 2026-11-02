/** Retained conversation records. No SDK, execution owner, recovery or writes.
 * The caller supplies a current-view assertion and, only for a live owner, its
 * original turn observations. A cold view is valid only for a proven stopped
 * owner; absence from another process's memory is never proof of interruption. */

import { lstatSync } from "node:fs";
import { join, resolve } from "node:path";
import { withinWorkspace } from "../workspace.ts";
import {
  ContractError,
  closed,
  decodeId,
  integer,
  list,
  parseWireJson,
  text,
} from "./contracts/core.ts";
import {
  type ChatCursor,
  type ChatItem,
  type ChatSummary,
  type ChatTurn,
  decodeChatItem,
  decodeChatTurn,
  decodeWorkbenchCommand,
  STEP_READ,
  type WorkbenchResult,
} from "./contracts/workbench.ts";
import { ConversationHistory } from "./conversation-history.ts";
import { ConversationSteps } from "./conversation-steps.ts";
import { TRANSCRIPT_PAGE_BYTES } from "./conversation-transcript.ts";
import type { PrivateFiles } from "./private-files.ts";

export const TURN_BYTES = 384 * 1024;
export const META_BYTES = 64 * 1024;
const SUMMARY_CACHE = 256;
export interface SavedConversation {
  id: string;
  title: string;
  /** Inline legacy prefix only. New turns live in immutable ordinal slots. */
  turns: string[];
  head: string;
  count: number;
  checkpoint: string | null;
}
export interface ObservedConversationTurn {
  conversationId: string;
  title: string;
  acceptedAt: number;
  turn: ChatTurn;
}
/** Cheap no-follow identity of a retained file ("absent" when missing). It
 * selects cached projections only; every miss re-reads through PrivateFiles. */
export function observedFile(path: string): string {
  try {
    const s = lstatSync(path);
    return [s.dev, s.ino, s.size, s.mode, s.nlink, s.ctimeMs, s.mtimeMs].join(
      ":",
    );
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    )
      return "absent";
    throw error;
  }
}
export class ConversationRecords {
  readonly root: string;
  private readonly history: ConversationHistory;
  private readonly active: ReadonlyMap<string, ObservedConversationTurn>;
  private readonly summaries = new Map<
    string,
    { key: string; summary: ChatSummary; count: number }
  >();
  private readonly steps = new ConversationSteps((turnId, page) =>
    this.page(turnId, page),
  );
  constructor(
    private readonly o: {
      directory: string;
      files: Pick<PrivateFiles, "read" | "directory">;
      cwd: string;
      assertCurrent(): void;
      active?: ReadonlyMap<string, ObservedConversationTurn>;
    },
  ) {
    this.root = join(o.directory, "conversations-v1");
    this.active = o.active ?? new Map();
    const sessions = join(this.root, "sessions");
    this.history = new ConversationHistory(
      sessions,
      () => {
        o.assertCurrent();
        return this.files.directory(sessions);
      },
      (id) => this.retainedSummary(id),
    );
  }
  private get files() {
    return this.o.files;
  }
  path(id: string, name: string) {
    return join(this.root, "turns", decodeId(id), name);
  }
  identityPath(id: string) {
    return join(this.root, "identities", `${decodeId(id)}.json`);
  }
  metadataPath(id: string) {
    return join(this.root, "sessions", `${decodeId(id)}.json`);
  }
  read(path: string, max: number): unknown | undefined {
    const value = this.files.read(path, max);
    return value ? parseWireJson(value.bytes.toString("utf8"), max) : undefined;
  }
  /** Retained cwd is identity data; reading never resolves a removed directory. */
  cwd(id: string): string {
    const identity = closed(this.read(this.identityPath(id), META_BYTES), [
      "schema",
      "id",
      "cwd",
    ]);
    if (
      identity.schema !== "cadence-conversation/1" ||
      identity.id !== id ||
      typeof identity.cwd !== "string" ||
      resolve(identity.cwd) !== identity.cwd ||
      !withinWorkspace(this.o.cwd, identity.cwd)
    )
      throw new ContractError("corrupt-selected");
    return identity.cwd as string;
  }
  metadata(id: string): SavedConversation | null {
    const value = this.read(this.metadataPath(id), META_BYTES);
    if (value === undefined) return null;
    this.cwd(id);
    const indexed =
      value !== null &&
      typeof value === "object" &&
      Object.hasOwn(value, "count");
    const m = closed(value, [
      "id",
      "title",
      "turns",
      "checkpoint",
      ...(indexed ? ["head", "count"] : []),
    ]);
    // This bound reads only the immutable prefix written by older releases.
    const turns = list(m.turns, 1000, decodeId);
    const count = indexed
      ? integer(m.count, Math.max(1, turns.length))
      : turns.length;
    const head = indexed ? decodeId(m.head) : turns.at(-1);
    if (!head || !count || new Set(turns).size !== turns.length || m.id !== id)
      throw new ContractError("corrupt-selected");
    const meta: SavedConversation = {
      id,
      title: text(m.title, 512, true),
      turns,
      head,
      count,
      checkpoint: m.checkpoint === null ? null : decodeId(m.checkpoint),
    };
    if (
      this.turnAt(meta, count - 1) !== head ||
      (indexed && this.position(meta, head) !== count - 1) ||
      (meta.checkpoint && !this.contains(meta, meta.checkpoint))
    )
      throw new ContractError("corrupt-selected");
    return meta;
  }
  slotPath(id: string, ordinal: number): string {
    return join(
      this.root,
      "indices",
      decodeId(id),
      `${integer(ordinal, 0)}.json`,
    );
  }
  private turnAt(meta: SavedConversation, ordinal: number): string {
    if (ordinal < 0 || ordinal >= meta.count) throw new ContractError("stale");
    if (ordinal < meta.turns.length) return meta.turns[ordinal];
    const row = closed(this.read(this.slotPath(meta.id, ordinal), META_BYTES), [
      "conversationId",
      "ordinal",
      "turnId",
    ]);
    if (row.conversationId !== meta.id || row.ordinal !== ordinal)
      throw new ContractError("corrupt-selected");
    return decodeId(row.turnId);
  }
  private position(meta: SavedConversation, turnId: string): number {
    const legacy = meta.turns.indexOf(turnId);
    if (legacy >= 0) return legacy;
    const value = this.read(this.path(turnId, "position.json"), META_BYTES);
    if (value === undefined) return -1;
    const row = closed(value, ["conversationId", "ordinal", "turnId"]);
    if (row.turnId !== turnId) throw new ContractError("corrupt-selected");
    const ordinal = integer(row.ordinal, 0);
    if (row.conversationId !== meta.id || ordinal >= meta.count) return -1;
    return this.turnAt(meta, ordinal) === turnId ? ordinal : -1;
  }
  contains(meta: SavedConversation, turnId: string): boolean {
    return this.position(meta, turnId) >= 0;
  }
  turn(id: string): ChatTurn {
    const live = this.active.get(id);
    const turn =
      live?.turn ??
      decodeChatTurn(this.read(this.path(id, "turn.json"), TURN_BYTES));
    if (turn.id !== id) throw new ContractError("corrupt-selected");
    // Interrupted original work is not silently resumed or reported completed.
    return !live && ["queued", "running"].includes(turn.status)
      ? {
          ...turn,
          status: "unknown",
          notice:
            "Interrupted: Cadence stopped before this reply finished. Nothing was replayed; send the message again to retry.",
        }
      : turn;
  }
  controlBound(id: string): boolean {
    const path = join(this.root, "control-links", `${decodeId(id)}.json`);
    const value = this.read(path, META_BYTES);
    if (value === undefined) return false;
    const record = closed(value, ["schema", "conversationId"]);
    if (
      record.schema !== "cadence-conversation-control/1" ||
      record.conversationId !== id
    )
      throw new ContractError("corrupt-selected");
    return true;
  }
  /** Cheap observation key for a control link; not a validation. */
  controlKey(id: string): string {
    return observedFile(
      join(this.root, "control-links", `${decodeId(id)}.json`),
    );
  }
  hasTurn(id: string, turnId: string): boolean {
    const meta = this.metadata(id);
    return !!meta && this.contains(meta, turnId);
  }
  private summary(meta: SavedConversation): ChatSummary {
    const head = meta.head,
      turn = this.turn(head);
    const accepted = closed(
      this.read(this.path(head, "accepted.json"), META_BYTES),
      ["command", "at"],
    );
    const command = decodeWorkbenchCommand(accepted.command);
    if (
      command.kind !== "send" ||
      command.commandId !== head ||
      command.conversationId !== meta.id ||
      command.model.epoch !== turn.epoch
    )
      throw new ContractError("corrupt-selected");
    return {
      id: meta.id,
      title: meta.title,
      head,
      status: turn.status,
      updatedAt: integer(accepted.at, 0),
    };
  }
  private headKey(head: string, id: string, count: number): string {
    return [
      this.path(head, "turn.json"),
      this.path(head, "accepted.json"),
      this.path(head, "position.json"),
      this.slotPath(id, count - 1),
    ]
      .map(observedFile)
      .join("|");
  }
  retainedSummary(id: string): ChatSummary {
    return this.retained(id).summary;
  }
  /** A settled summary is re-read only when one of its files changed: polls
   * otherwise parse every head turn (up to 384 KiB each). Keys are taken
   * before each read, so a concurrent change can only cause a later re-read. */
  private retained(id: string): { summary: ChatSummary; count: number } {
    const base = [this.metadataPath(id), this.identityPath(id)]
      .map(observedFile)
      .join("|");
    const hit = this.summaries.get(id);
    if (
      hit &&
      !this.active.has(hit.summary.head) &&
      hit.key === `${base}|${this.headKey(hit.summary.head, id, hit.count)}`
    )
      return { summary: { ...hit.summary }, count: hit.count };
    const meta = this.metadata(id);
    if (!meta) throw new ContractError("corrupt-selected");
    const head = meta.head;
    const key = `${base}|${this.headKey(head, id, meta.count)}`;
    const summary = this.summary(meta);
    this.summaries.delete(id);
    if (
      !this.active.has(head) &&
      !["queued", "running"].includes(summary.status)
    ) {
      if (this.summaries.size >= SUMMARY_CACHE)
        this.summaries.delete(this.summaries.keys().next().value as string);
      this.summaries.set(id, {
        key,
        summary: { ...summary },
        count: meta.count,
      });
    }
    return { summary, count: meta.count };
  }
  private liveSummary(live: ObservedConversationTurn): ChatSummary {
    return {
      id: live.conversationId,
      title: live.title,
      head: live.turn.id,
      status: live.turn.status,
      updatedAt: live.acceptedAt,
    };
  }
  list(after: ChatCursor | null = null, scan?: string): WorkbenchResult {
    this.o.assertCurrent();
    return this.history.read(after, scan);
  }
  activeConversations(): WorkbenchResult & { kind: "conversation-active" } {
    this.o.assertCurrent();
    return {
      kind: "conversation-active",
      entries: [...this.active.values()].map((live) => this.liveSummary(live)),
    };
  }
  closeReads(): void {
    this.history.close();
  }
  /** The conversation's summary and turn count: what a viewer polls. */
  conversation(id: string): WorkbenchResult {
    this.o.assertCurrent();
    if (observedFile(this.metadataPath(id)) === "absent") {
      const live = [...this.active.values()].find(
        (turn) => turn.conversationId === id,
      );
      return {
        kind: "conversation",
        summary: live ? this.liveSummary(live) : null,
        turns: 0,
      };
    }
    const { summary, count } = this.retained(id);
    return { kind: "conversation", summary, turns: count };
  }
  /** One turn by position, with the steps that end at `before` (else the latest). */
  turnSteps(
    id: string,
    ordinal: number,
    before: number | null,
  ): WorkbenchResult {
    this.o.assertCurrent();
    const meta = this.metadata(id);
    if (!meta) throw new ContractError("stale");
    const turn = this.turn(this.turnAt(meta, ordinal));
    const { steps, stable } = this.steps.list(turn);
    const end = before ?? steps.length;
    if (end > steps.length) throw new ContractError("stale");
    const start = Math.max(0, end - STEP_READ);
    return {
      kind: "conversation-turn",
      conversationId: id,
      ordinal,
      turn: {
        ...(turn.execution ? { execution: turn.execution } : {}),
        id: turn.id,
        epoch: turn.epoch,
        status: turn.status,
        notice: turn.notice,
        omitted: { ...turn.omitted },
        steps: steps.length,
        stable,
      },
      start,
      steps: steps.slice(start, end).map((row) => row.step),
    };
  }
  /** One stored part of a step's full item: arguments, output or whole text. */
  step(
    id: string,
    turnId: string,
    step: number,
    part: number,
  ): WorkbenchResult {
    this.o.assertCurrent();
    if (!this.hasTurn(id, turnId)) throw new ContractError("invalid");
    return {
      kind: "conversation-step",
      conversationId: id,
      turnId,
      step,
      part,
      item: { ...this.steps.detail(this.turn(turnId), step, part) },
    };
  }
  private page(turnId: string, page: number): ChatItem {
    const value = this.read(
      this.path(turnId, `transcript/${integer(page, 0)}.json`),
      TRANSCRIPT_PAGE_BYTES,
    );
    if (value === undefined) throw new ContractError("corrupt-selected");
    const record = closed(value, ["turnId", "page", "items"]);
    const items = list(record.items, 1, decodeChatItem);
    if (record.turnId !== turnId || record.page !== page || !items.length)
      throw new ContractError("corrupt-selected");
    return items[0];
  }
  origin(taskId: string): WorkbenchResult & { kind: "task-origin" } {
    this.o.assertCurrent();
    const value = this.read(
      join(this.root, "task-links", `${decodeId(taskId)}.json`),
      META_BYTES,
    );
    if (value === undefined)
      return { kind: "task-origin", taskId, conversationId: null };
    const row = closed(value, ["conversationId"]);
    return {
      kind: "task-origin",
      taskId,
      conversationId: decodeId(row.conversationId),
    };
  }
}
