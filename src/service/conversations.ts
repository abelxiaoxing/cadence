/** Ordinary conversations owned by the persistent service, not Cadence tasks. */
import { randomUUID } from "node:crypto";
import { lstatSync, opendirSync, realpathSync, statfsSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  CONTEXT_BYTES,
  CONTEXT_RECORD_BYTES,
} from "../conversation-context.mjs";
import { launchConversation, type ProcessSpec } from "../subagent-process.ts";
import {
  type CaptureFrame,
  type DetailDescriptor,
  decodeWorkerPublicRequest,
  LIMITS,
  type NativeSettlement,
} from "../worker-public.mjs";
import { DetailSanitizer, sanitizeText } from "../worker-redaction.mjs";
import { resolveWorkspace } from "../workspace.ts";
import type { CheckoutGate, CheckoutPermit } from "./checkout-gate.ts";
import {
  ContractError,
  canonicalJson,
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
  type WorkbenchCommand,
  type WorkbenchResult,
} from "./contracts/workbench.ts";
import { ConversationHistory } from "./conversation-history.ts";
import { ConversationSteps } from "./conversation-steps.ts";
import {
  ConversationTranscript,
  type FieldUpdate,
  previewHead,
  TRANSCRIPT_PAGE_BYTES,
} from "./conversation-transcript.ts";
import type { ServiceCoordination } from "./coordination.ts";
import type { OwnerModelChoice } from "./model-choice.ts";
import type { OwnerModelContext } from "./model-context.ts";
import type { AcceptedWorkResult, ServiceOwner } from "./owner.ts";
import { type FileSnapshot, hash } from "./private-files.ts";

const TURN_BYTES = 384 * 1024;
const META_BYTES = 64 * 1024;
const SUMMARY_CACHE = 256; // Read cache only; never a retained conversation limit.
const OMITTED_FLAG = {
  "hidden-thinking": "thinking",
  binary: "media",
  unsupported: "other",
} as const satisfies Record<string, keyof ChatTurn["omitted"]>;
interface SavedConversation {
  id: string;
  title: string;
  /** Inline legacy prefix only. New turns live in immutable ordinal slots. */
  turns: string[];
  head: string;
  count: number;
  checkpoint: string | null;
}
type Send = Extract<WorkbenchCommand, { kind: "send" }>;
interface Options {
  coordination: ServiceCoordination;
  owner: ServiceOwner;
  models: OwnerModelContext;
  choice: OwnerModelChoice;
  gate: CheckoutGate;
  agentDir: string;
  cwd: string;
  secrets(): readonly string[];
  timeoutMs?: number;
}
export interface ConversationControl {
  instructions: string;
  reply?: string;
  accept(): void;
  onTool: NonNullable<ProcessSpec["onCoordinator"]>;
  settle(): Promise<void>;
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
interface LiveTurn {
  conversationId: string;
  title: string;
  acceptedAt: number;
  turnFile: FileSnapshot | null;
  metaFile: FileSnapshot | null;
  turn: ChatTurn;
  abort: AbortController;
  original: Promise<AcceptedWorkResult>;
}

/** Bounded stdout projection, with the same split-secret sanitizer as task capture. */
export class ConversationCapture {
  // Encoded sizes are kept beside each growing text: rescanning a long stream
  // on every chunk made capture quadratic and stalled the owner's reads.
  private readonly details = new Map<
    string,
    {
      descriptor: DetailDescriptor;
      sanitizer: DetailSanitizer;
      text: string;
      bytes: number;
      head: string;
    }
  >();
  private readonly messageText = new Map<
    string,
    { messageId: string; text: string; bytes: number; head: string }
  >();
  constructor(
    private readonly turn: ChatTurn,
    private readonly save: () => void,
    private readonly secrets: () => readonly string[],
    private readonly transcript?: ConversationTranscript,
  ) {}
  private item(id: string, role: ChatItem["role"]): ChatItem {
    if (this.transcript) return this.transcript.item(id, role);
    let item = this.turn.items.find((i) => i.id === id);
    if (!item) {
      if (this.turn.items.length >= 256) throw new ContractError("capacity");
      item = { id, role, text: "", name: "", args: "", error: false };
      this.turn.items.push(item);
      try {
        canonicalJson(this.turn, TURN_BYTES - 2048);
      } catch (error) {
        this.turn.items.pop();
        this.turn.notice = "Conversation capture limit exceeded.";
        throw error;
      }
    }
    return item;
  }
  private update(
    item: ChatItem,
    field: "text" | "name" | "args",
    value: string,
    maximum: number,
    known: FieldUpdate = { bytes: Buffer.byteLength(value), head: value },
  ): void {
    const bytes = known.bytes;
    if (this.transcript) {
      if (bytes > LIMITS.detailBytes) throw new ContractError("capacity");
      item[field] = value;
      this.transcript.preview(item, { [field]: known });
      return;
    }
    const before = item[field];
    try {
      if (bytes > maximum) throw new ContractError("capacity");
      item[field] = value;
      canonicalJson(this.turn, TURN_BYTES - 2048);
    } catch (error) {
      item[field] = before;
      this.turn.notice = "Conversation capture limit exceeded.";
      throw error;
    }
  }
  accept(frame: CaptureFrame): void {
    const e = frame.event;
    if (e.kind === "detail-begin") {
      if (
        e.descriptor.owner.kind === "context" ||
        e.descriptor.owner.kind === "handoff"
      )
        return;
      if (this.details.size >= 64) throw new ContractError("capacity");
      this.details.set(e.detailId, {
        descriptor: e.descriptor,
        sanitizer: new DetailSanitizer(e.descriptor.encoding, this.secrets()),
        text: "",
        bytes: 0,
        head: "",
      });
    } else if (e.kind === "detail-chunk" || e.kind === "detail-end") {
      const d = this.details.get(e.detailId);
      if (!d) return;
      const added =
        e.kind === "detail-chunk"
          ? d.sanitizer.write(e.text)
          : d.sanitizer.end();
      d.text += added;
      d.bytes += Buffer.byteLength(added);
      d.head = previewHead(d.head, added);
      if (d.bytes > (this.transcript ? LIMITS.detailBytes : 256 * 1024))
        throw new ContractError("capacity");
      const o = d.descriptor.owner;
      if (o.kind === "message") {
        const role = (
          this.transcript?.find(o.messageId) ??
          this.turn.items.find((i) => i.id === o.messageId)
        )?.role;
        if (role === "assistant" && o.stage === "stream") {
          this.messageText.set(o.blockId, {
            messageId: o.messageId,
            text: d.text,
            bytes: d.bytes,
            head: d.head,
          });
          const blocks = [...this.messageText.values()].filter(
            (block) => block.messageId === o.messageId,
          );
          this.update(
            this.item(o.messageId, "assistant"),
            "text",
            blocks.length === 1
              ? blocks[0].text
              : blocks.map((block) => block.text).join(""),
            256 * 1024,
            {
              bytes: blocks.reduce((size, block) => size + block.bytes, 0),
              head: blocks.reduce(
                (head, block) => previewHead(head, block.head),
                "",
              ),
            },
          );
        }
      } else if (o.kind === "message-final") {
        const item =
          this.transcript?.find(o.messageId) ??
          this.turn.items.find((i) => i.id === o.messageId);
        if (item?.role === "assistant")
          this.update(item, "text", d.text, 256 * 1024, d);
      } else if (o.kind === "tool") {
        const item = this.item(o.callId, "tool");
        if (o.stage === "execution-arguments" || o.stage === "arguments-final")
          this.update(item, "args", d.text, 64 * 1024, d);
        if (o.stage === "result" || o.stage === "update-snapshot")
          this.update(item, "text", d.text, 256 * 1024, d);
      }
      if (e.kind === "detail-end") this.details.delete(e.detailId);
    } else if (e.kind === "message-start" && e.role === "assistant") {
      this.item(e.messageId, "assistant");
    } else if (e.kind === "tool-start" || e.kind === "tool-end") {
      const item = this.item(e.callId, "tool");
      this.update(item, "name", sanitizeText(e.name, this.secrets()), 128);
      if (e.kind === "tool-end") item.error = e.isError;
    } else if (e.kind === "worker-failure")
      this.turn.notice = `worker-failure: ${e.code}`;
    else if (
      e.kind === "omitted-block" &&
      e.block.owner.kind !== "context" &&
      e.block.owner.kind !== "handoff"
    )
      // A flag, not a notice line: it must never displace a failure reason.
      this.turn.omitted[OMITTED_FLAG[e.block.reason]] = true;
    if (
      [...this.details.values()].reduce(
        (size, detail) => size + detail.bytes + detail.sanitizer.retainedBytes,
        0,
      ) > (this.transcript ? 2 * LIMITS.detailBytes : TURN_BYTES)
    )
      throw new ContractError("capacity");
    if (!this.transcript) canonicalJson(this.turn, TURN_BYTES);
    if (e.kind === "message-end")
      for (const [id, block] of this.messageText)
        if (block.messageId === e.messageId) this.messageText.delete(id);
    if (e.kind === "message-end" || e.kind === "tool-end") {
      this.transcript?.complete(
        e.kind === "message-end" ? e.messageId : e.callId,
      );
      this.save();
    }
  }
}

export class Conversations {
  private readonly root: string;
  private readonly history: ConversationHistory;
  private readonly cwd: string;
  private readonly active = new Map<string, LiveTurn>();
  private readonly summaries = new Map<
    string,
    { key: string; summary: ChatSummary; count: number }
  >();
  private readonly steps = new ConversationSteps((turnId, page) =>
    this.page(turnId, page),
  );
  constructor(private readonly o: Options) {
    this.root = join(o.coordination.directory, "conversations-v1");
    this.cwd = realpathSync(o.cwd);
    const sessions = join(this.root, "sessions");
    this.history = new ConversationHistory(
      sessions,
      () => {
        this.o.owner.lease.assert();
        return this.files.directory(sessions);
      },
      (id) => this.retainedSummary(id),
    );
  }
  private currentDirectory(): boolean {
    const current = resolveWorkspace(this.o.cwd);
    return (
      current.root === this.o.coordination.store.root &&
      current.cwd === this.cwd
    );
  }
  private get files() {
    return this.o.coordination.files;
  }
  private path(id: string, name: string) {
    return join(this.root, "turns", decodeId(id), name);
  }
  private identityPath(id: string) {
    return join(this.root, "identities", `${decodeId(id)}.json`);
  }
  private metadataPath(id: string) {
    return join(this.root, "sessions", `${decodeId(id)}.json`);
  }
  private read(path: string, max: number): unknown | undefined {
    const value = this.files.read(path, max);
    return value ? parseWireJson(value.bytes.toString("utf8"), max) : undefined;
  }
  private write(
    path: string,
    value: unknown,
    max: number,
    expected?: FileSnapshot,
  ): FileSnapshot {
    this.o.owner.lease.assert();
    const source = canonicalJson(value, max);
    try {
      return expected
        ? this.files.replace(path, expected, source, max)
        : this.files.create(path, source, max);
    } catch (error) {
      this.o.owner.quarantine();
      throw error;
    }
  }
  private metadata(id: string): SavedConversation | null {
    const value = this.read(this.metadataPath(id), META_BYTES);
    if (value === undefined) return null;
    const identity = closed(this.read(this.identityPath(id), META_BYTES), [
      "schema",
      "id",
      "cwd",
    ]);
    if (
      identity.schema !== "cadence-conversation/1" ||
      identity.id !== id ||
      identity.cwd !== this.cwd
    )
      throw new ContractError("corrupt-selected");
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
  private slotPath(id: string, ordinal: number): string {
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
  private contains(meta: SavedConversation, turnId: string): boolean {
    return this.position(meta, turnId) >= 0;
  }
  private turn(id: string): ChatTurn {
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
  bindControl(id: string): void {
    if (!this.controlBound(id))
      this.write(
        join(this.root, "control-links", `${decodeId(id)}.json`),
        { schema: "cadence-conversation-control/1", conversationId: id },
        META_BYTES,
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
  private retainedSummary(id: string): ChatSummary {
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
  private liveSummary(live: LiveTurn): ChatSummary {
    return {
      id: live.conversationId,
      title: live.title,
      head: live.turn.id,
      status: live.turn.status,
      updatedAt: live.acceptedAt,
    };
  }
  list(after: ChatCursor | null = null, scan?: string): WorkbenchResult {
    this.o.owner.lease.assert();
    return this.history.read(after, scan);
  }
  activeConversations(): WorkbenchResult & { kind: "conversation-active" } {
    this.o.owner.lease.assert();
    return {
      kind: "conversation-active",
      entries: [...this.active.values()].map((live) => this.liveSummary(live)),
    };
  }
  closeReads(): void {
    this.history.close();
  }
  /** Startup checks every retained head without a lifetime-count ceiling.
   * Admission thereafter relies on the owner's original-work fence, not a
   * full-history scan on each Send. No record is repaired or reconstructed. */
  assertSettled(): void {
    this.o.owner.lease.assert();
    const path = join(this.root, "sessions");
    if (!this.files.directory(path)) return;
    const dir = opendirSync(path);
    try {
      for (let e = dir.readSync(); e; e = dir.readSync()) {
        if (!e.isFile() || !e.name.endsWith(".json"))
          throw new ContractError("corrupt-selected");
        if (
          this.retainedSummary(decodeId(e.name.slice(0, -5))).status ===
          "unknown"
        )
          throw new ContractError("quarantine");
      }
    } finally {
      dir.closeSync();
    }
  }
  /** The conversation's summary and turn count: what a viewer polls. */
  conversation(id: string): WorkbenchResult {
    this.o.owner.lease.assert();
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
    this.o.owner.lease.assert();
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
    this.o.owner.lease.assert();
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
  attempted(conversationId: string, commandId: string): boolean {
    this.o.owner.lease.assert();
    const meta = this.metadata(conversationId);
    return (
      this.active.has(commandId) ||
      this.files.directory(dirname(this.path(commandId, "accepted.json"))) ||
      (!!meta && this.contains(meta, commandId)) ||
      (!meta &&
        !!this.files.read(this.identityPath(conversationId), META_BYTES))
    );
  }
  private command(input: Send, reply: boolean): Send {
    return {
      ...input,
      text: reply ? "exit cadence" : sanitizeText(input.text, this.o.secrets()),
    };
  }
  /** A lost reply observes its original acceptance; it never admits again.
   * Any caller-side freshness check must come after this lookup. */
  receipt(input: Send, reply = false): WorkbenchResult | undefined {
    this.o.owner.lease.assert();
    const prior = this.read(
      this.path(input.commandId, "accepted.json"),
      META_BYTES,
    );
    if (prior === undefined) return undefined;
    const saved = closed(prior, ["command", "at"]);
    if (
      canonicalJson(saved.command) !== canonicalJson(this.command(input, reply))
    )
      throw new ContractError("conflict");
    return { kind: "accepted", commandId: input.commandId };
  }
  send(
    input: Send,
    control?: ConversationControl,
    beforeAccept?: () => void,
  ): WorkbenchResult {
    this.o.owner.lease.assert();
    const command = this.command(input, !!control?.reply);
    const receipt = this.receipt(input, !!control?.reply);
    if (receipt) return receipt;
    if (
      this.files.directory(dirname(this.path(input.commandId, "accepted.json")))
    )
      throw new ContractError("corrupt-selected");
    if (this.o.owner.state !== "idle") throw new ContractError("quarantine");
    const choice = this.o.choice.snapshot();
    if (
      (!choice.selected && !control?.reply) ||
      canonicalJson(choice.version) !== canonicalJson(input.model)
    )
      throw new ContractError("stale");
    if (choice.selected && !control?.reply)
      this.o.models.assertCurrent(choice.selected);
    if (!this.currentDirectory()) throw new ContractError("stale");
    const beforeMeta = this.files.read(
      this.metadataPath(input.conversationId),
      META_BYTES,
    );
    const meta = this.metadata(input.conversationId);
    this.files.assert(
      this.metadataPath(input.conversationId),
      beforeMeta,
      META_BYTES,
    );
    if (
      !meta &&
      this.files.read(this.identityPath(input.conversationId), META_BYTES)
    )
      throw new ContractError("corrupt-selected");
    if ((meta?.head ?? null) !== input.head) throw new ContractError("stale");
    if (
      meta &&
      this.turn(input.head as string).status !== "completed" &&
      (!control ||
        ["queued", "running", "unknown"].includes(
          this.turn(input.head as string).status,
        ))
    )
      throw new ContractError("conflict");
    if (
      this.active.size >= 8 ||
      (meta && !Number.isSafeInteger(meta.count + 1))
    )
      throw new ContractError("capacity");
    if (!input.text.trim()) throw new ContractError("invalid");
    const space = statfsSync(this.o.coordination.directory);
    if (space.bavail * space.bsize < LIMITS.freeSpaceFloorBytes)
      throw new ContractError("capacity");
    const turn: ChatTurn = {
      id: input.commandId,
      epoch: input.model.epoch,
      status: "queued",
      notice: "",
      omitted: { thinking: false, media: false, other: false },
      items: [
        {
          id: "user",
          role: "user",
          text: command.text,
          name: "",
          args: "",
          error: false,
        },
      ],
    };
    const next: SavedConversation = meta ?? {
      id: input.conversationId,
      title: [...command.text.trim()].slice(0, 100).join("") || "Conversation",
      turns: [],
      head: turn.id,
      count: 0,
      checkpoint: null,
    };
    const previous = next.checkpoint
      ? this.path(next.checkpoint, "context.json")
      : null;
    const previousFile = previous
      ? this.files.read(previous, CONTEXT_BYTES)
      : undefined;
    if (previous && !previousFile) throw new ContractError("corrupt-selected");
    const abort = new AbortController();
    // Register original work before the first durable acceptance or asynchronous effect.
    let begin!: () => void;
    const ready = new Promise<void>((resolve) => {
      begin = resolve;
    });
    const original = ready.then(() =>
      this.run(command, turn, previous, previousFile, next, abort, control),
    );
    const live: LiveTurn = {
      turn,
      abort,
      original,
      conversationId: next.id,
      title: next.title,
      acceptedAt: Date.now(),
      turnFile: null,
      metaFile: null,
    };
    // Beyond this point even a failed registration/control write is uncertain.
    beforeAccept?.();
    this.active.set(turn.id, live);
    this.o.owner.trackConversation(original, () => abort.abort());
    try {
      if (!meta)
        this.write(
          this.identityPath(next.id),
          { schema: "cadence-conversation/1", id: next.id, cwd: this.cwd },
          META_BYTES,
        );
      this.write(
        this.path(turn.id, "accepted.json"),
        { command, at: live.acceptedAt },
        META_BYTES,
      );
      live.turnFile = this.write(
        this.path(turn.id, "turn.json"),
        turn,
        TURN_BYTES,
      );
      const position = {
        conversationId: next.id,
        ordinal: next.count,
        turnId: turn.id,
      };
      this.write(this.slotPath(next.id, next.count), position, META_BYTES);
      this.write(this.path(turn.id, "position.json"), position, META_BYTES);
      next.head = turn.id;
      next.count++;
      live.metaFile = this.write(
        this.metadataPath(next.id),
        next,
        META_BYTES,
        beforeMeta,
      );
      // Control state commits last: it never names a turn that is not durably
      // recorded. A failure here leaves an older, still-valid control record.
      control?.accept();
    } catch (error) {
      abort.abort();
      begin();
      throw error;
    }
    begin();
    return { kind: "accepted", commandId: turn.id };
  }
  origin(taskId: string): WorkbenchResult & { kind: "task-origin" } {
    this.o.owner.lease.assert();
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
  interrupt(id: string, turnId: string, epoch: string): void {
    this.o.owner.lease.assert();
    const live = this.active.get(turnId);
    if (live) {
      if (live.conversationId !== id || live.turn.epoch !== epoch)
        throw new ContractError("stale");
      live.abort.abort();
      return;
    }
    const meta = this.metadata(id);
    if (!meta || !this.contains(meta, turnId))
      throw new ContractError("invalid");
    if (this.turn(turnId).epoch !== epoch) throw new ContractError("stale");
    this.active.get(turnId)?.abort.abort();
  }
  private async run(
    command: Send,
    turn: ChatTurn,
    previous: string | null,
    previousFile: FileSnapshot | undefined,
    meta: SavedConversation,
    abort: AbortController,
    control?: ConversationControl,
  ): Promise<AcceptedWorkResult> {
    let transcript: ConversationTranscript | undefined;
    let barrier: CheckoutPermit | undefined;
    let authSettled: Promise<void> | undefined;
    let uncertain = false;
    let native: NativeSettlement = {
      outcome: "failed",
      closure: "not-launched",
      exitCode: null,
      signal: null,
      durationMs: 0,
      stdin: "not-required",
      final: "missing",
      cleanup: "settled",
      capture: {
        observed: "incomplete",
        source: "unavailable",
        redacted: false,
        omissions: ["gap"],
      },
    };
    const live = this.active.get(turn.id);
    const save = () => {
      if (!live?.turnFile) throw new ContractError("corrupt-selected");
      live.turnFile = this.write(
        this.path(turn.id, "turn.json"),
        turn,
        TURN_BYTES,
        live.turnFile,
      );
    };
    const current = () => {
      if (
        abort.signal.aborted ||
        this.o.owner.state !== "idle" ||
        !this.currentDirectory()
      )
        return false;
      if (previous) this.files.assert(previous, previousFile, CONTEXT_BYTES);
      return true;
    };
    try {
      if (!current()) throw new ContractError("stale");
      if (control?.reply) {
        turn.status = "completed";
        turn.notice = control.reply;
        return { status: "settled" };
      }
      if (!control) {
        barrier = await this.o.gate.acquire(turn.id, abort.signal);
        barrier.assertHeld();
      }
      if (!current()) throw new ContractError("stale");
      const choice = this.o.choice.snapshot(),
        selected = choice.selected;
      // Access rotation revokes viewers, not already admitted work. The exact
      // selected model/epoch remains pinned while this original is queued.
      if (
        !selected ||
        command.model.epoch !== choice.version.epoch ||
        command.model.configRev !== choice.version.configRev ||
        command.model.catalogId !== choice.version.catalogId
      )
        throw new ContractError("stale");
      const request = decodeWorkerPublicRequest({
        protocol: 2,
        taskId: meta.id,
        taskKind: control ? "research" : "code",
        runId: turn.id,
        childRunId: randomUUID(),
        assignmentId: "conversation",
        purpose: control ? "research" : "edit",
        model: selected,
        role: {
          role: control ? "design-explorer" : "implementation-worker",
          sha256: hash(control?.instructions ?? "Ordinary conversation."),
        },
        context: "",
        instructions: control?.instructions ?? "Ordinary conversation.",
        prompt: command.text,
        handoff: { graphRevision: 1, inputs: [] },
      });
      const auth = this.o.models.prepareTracked({
        request,
        operationId: randomUUID(),
        epoch: turn.epoch,
        timeoutMs: this.o.timeoutMs ?? LIMITS.workerMs,
        signal: abort.signal,
        current,
        journal: {
          preparation: (value) =>
            this.write(
              this.path(turn.id, "auth-intent.json"),
              value,
              META_BYTES,
            ),
          settlement: (value) =>
            this.write(
              this.path(turn.id, "auth-settled.json"),
              value,
              META_BYTES,
            ),
        },
      });
      authSettled = auth.settled;
      const prepared = await auth.result;
      if (prepared.status !== "prepared" || !current())
        throw new ContractError("auth-unavailable");
      turn.status = "running";
      save();
      this.write(
        this.path(turn.id, "launch.json"),
        { epoch: turn.epoch, childRunId: request.childRunId },
        META_BYTES,
      );
      let credentials: readonly string[] = [];
      let checkpoint = false,
        contextCount = 0;
      let contextHead: string | null = null;
      transcript = new ConversationTranscript(turn, (page) => {
        const space = statfsSync(this.o.coordination.directory);
        if (
          space.bavail * space.bsize - TRANSCRIPT_PAGE_BYTES <
          LIMITS.freeSpaceFloorBytes
        )
          throw new ContractError("capacity");
        this.write(
          this.path(turn.id, `transcript/${page.page}.json`),
          page,
          TRANSCRIPT_PAGE_BYTES,
        );
      });
      const capture = new ConversationCapture(
        turn,
        save,
        () => [...this.o.secrets(), ...credentials],
        transcript,
      );
      const running = Promise.resolve().then(() =>
        launchConversation(
          prepared.prepared,
          {
            previous,
            agentDir: this.o.agentDir,
            ...(control ? { coordinator: true as const } : {}),
          },
          abort.signal,
          {
            timeoutMs: this.o.timeoutMs ?? LIMITS.workerMs,
            ownerSecrets: this.o.secrets,
            onCoordinator: control?.onTool,
            onContext: (message) => {
              const space = statfsSync(this.o.coordination.directory);
              if (
                space.bavail * space.bsize - CONTEXT_RECORD_BYTES <
                LIMITS.freeSpaceFloorBytes
              )
                throw new ContractError("capacity");
              const file = this.write(
                this.path(turn.id, `context-${contextCount}.json`),
                {
                  schema: "cadence-conversation-message/1",
                  index: contextCount,
                  previous: contextHead,
                  message,
                },
                CONTEXT_RECORD_BYTES,
              );
              contextHead = file.identity;
              contextCount++;
            },
            onContextEnd: () => {
              checkpoint = true;
            },
            maySignal: () => {
              try {
                this.o.owner.lease.assert();
                return true;
              } catch {
                return false;
              }
            },
            onNative: (value) => {
              native = value;
            },
            onFrame: (frame, secrets) => {
              credentials = secrets;
              capture.accept(frame);
            },
          },
        ),
      );
      const tracked = running.then(() => native);
      this.o.owner.trackConversationProcess(tracked, () => abort.abort());
      const result = await running;
      uncertain = !result.closed;
      turn.status = result.outcome;
      if (result.outcome === "completed") {
        if (!checkpoint) throw new ContractError("corrupt-selected");
        this.write(
          this.path(turn.id, "context.json"),
          {
            schema: "cadence-conversation-context/2",
            messages: contextCount,
            head: contextHead,
          },
          CONTEXT_BYTES,
        );
        meta.checkpoint = turn.id;
        if (!live?.metaFile) throw new ContractError("corrupt-selected");
        live.metaFile = this.write(
          this.metadataPath(meta.id),
          meta,
          META_BYTES,
          live.metaFile,
        );
      }
    } catch (error) {
      uncertain ||= this.o.owner.state === "quarantined";
      turn.status = uncertain
        ? "unknown"
        : abort.signal.aborted
          ? "canceled"
          : "failed";
      turn.notice ||=
        error instanceof ContractError ? error.code : "Conversation failed.";
    } finally {
      await control?.settle();
      await authSettled;
      uncertain ||= this.o.owner.state === "quarantined";
      if (uncertain) turn.status = "unknown";
      try {
        // Preserve actual process closure even if final transcript publication fails.
        this.write(this.path(turn.id, "native.json"), native, META_BYTES);
        transcript?.finish();
        if (turn.status !== "completed")
          turn.notice = [
            turn.notice,
            control
              ? "Incomplete work is not replayed. A new explicit message may continue from the last complete checkpoint."
              : "Start a new conversation; incomplete context is not replayed.",
          ]
            .filter(Boolean)
            .join("\n");
        save();
      } catch {
        uncertain = true;
      }
      if (uncertain) this.o.owner.quarantine();
      else if (this.o.owner.state === "idle") barrier?.release();
      this.active.delete(turn.id);
    }
    return { status: uncertain ? "uncertain" : "settled" };
  }
}
