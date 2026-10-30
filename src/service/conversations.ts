/** Ordinary conversations owned by the persistent service, not Cadence tasks. */
import { randomUUID } from "node:crypto";
import { lstatSync, opendirSync, realpathSync, statfsSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONTEXT_BYTES } from "../conversation-context.mjs";
import { launchConversation } from "../subagent-process.ts";
import { resolveWorkspace } from "../task-store.ts";
import {
  type CaptureFrame,
  type DetailDescriptor,
  decodeWorkerPublicRequest,
  LIMITS,
  type NativeSettlement,
} from "../worker-public.mjs";
import { DetailSanitizer, sanitizeText } from "../worker-redaction.mjs";
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
  type ChatItem,
  type ChatSummary,
  type ChatTurn,
  decodeChatTurn,
  decodeWorkbenchCommand,
  type WorkbenchCommand,
  type WorkbenchResult,
} from "./contracts/workbench.ts";
import type { ServiceCoordination } from "./coordination.ts";
import type { OwnerModelChoice } from "./model-choice.ts";
import type { OwnerModelContext } from "./model-context.ts";
import type { AcceptedWorkResult, ServiceOwner } from "./owner.ts";
import { type FileSnapshot, hash } from "./private-files.ts";
import type { ReviewBarrier } from "./scheduler.ts";
import type { TaskActions } from "./task-actions.ts";

const TURN_BYTES = 384 * 1024;
const META_BYTES = 64 * 1024;
const SESSION_LIMIT = 200;
const OMITTED_FLAG = {
  "hidden-thinking": "thinking",
  binary: "media",
  unsupported: "other",
} as const satisfies Record<string, keyof ChatTurn["omitted"]>;
interface SavedConversation {
  id: string;
  title: string;
  turns: string[];
  checkpoint: string | null;
}
type Send = Extract<WorkbenchCommand, { kind: "send" }>;
interface Options {
  coordination: ServiceCoordination;
  owner: ServiceOwner;
  models: OwnerModelContext;
  choice: OwnerModelChoice;
  actions: TaskActions;
  agentDir: string;
  cwd: string;
  secrets(): readonly string[];
  timeoutMs?: number;
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
  private readonly details = new Map<
    string,
    { descriptor: DetailDescriptor; sanitizer: DetailSanitizer; text: string }
  >();
  private readonly messageText = new Map<
    string,
    { messageId: string; text: string }
  >();
  constructor(
    private readonly turn: ChatTurn,
    private readonly save: () => void,
    private readonly secrets: () => readonly string[],
  ) {}
  private item(id: string, role: ChatItem["role"]): ChatItem {
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
  ): void {
    const before = item[field];
    try {
      if (Buffer.byteLength(value) > maximum)
        throw new ContractError("capacity");
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
      });
    } else if (e.kind === "detail-chunk" || e.kind === "detail-end") {
      const d = this.details.get(e.detailId);
      if (!d) return;
      d.text +=
        e.kind === "detail-chunk"
          ? d.sanitizer.write(e.text)
          : d.sanitizer.end();
      if (Buffer.byteLength(d.text) > 256 * 1024)
        throw new ContractError("capacity");
      const o = d.descriptor.owner;
      if (o.kind === "message") {
        const role = this.turn.items.find((i) => i.id === o.messageId)?.role;
        if (role === "assistant" && o.stage === "stream") {
          this.messageText.set(o.blockId, {
            messageId: o.messageId,
            text: d.text,
          });
          this.update(
            this.item(o.messageId, "assistant"),
            "text",
            [...this.messageText.values()]
              .filter((block) => block.messageId === o.messageId)
              .map((block) => block.text)
              .join(""),
            256 * 1024,
          );
        }
      } else if (o.kind === "message-final") {
        const item = this.turn.items.find((i) => i.id === o.messageId);
        if (item?.role === "assistant")
          this.update(item, "text", d.text, 256 * 1024);
      } else if (o.kind === "tool") {
        const item = this.item(o.callId, "tool");
        if (o.stage === "execution-arguments" || o.stage === "arguments-final")
          this.update(item, "args", d.text, 64 * 1024);
        if (o.stage === "result" || o.stage === "update-snapshot")
          this.update(item, "text", d.text, 256 * 1024);
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
        (size, detail) =>
          size +
          Buffer.byteLength(detail.text) +
          detail.sanitizer.retainedBytes,
        0,
      ) > TURN_BYTES
    )
      throw new ContractError("capacity");
    canonicalJson(this.turn, TURN_BYTES);
    if (e.kind === "message-end")
      for (const [id, block] of this.messageText)
        if (block.messageId === e.messageId) this.messageText.delete(id);
    if (e.kind === "message-end" || e.kind === "tool-end") this.save();
  }
}

export class Conversations {
  private readonly root: string;
  private readonly cwd: string;
  private readonly active = new Map<string, LiveTurn>();
  constructor(private readonly o: Options) {
    this.root = join(o.coordination.directory, "conversations-v1");
    this.cwd = realpathSync(o.cwd);
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
    const m = closed(value, ["id", "title", "turns", "checkpoint"]);
    const turns = list(m.turns, 1000, decodeId);
    if (
      !turns.length ||
      new Set(turns).size !== turns.length ||
      m.id !== id ||
      (m.checkpoint !== null && !turns.includes(decodeId(m.checkpoint)))
    )
      throw new ContractError("corrupt-selected");
    return {
      id,
      title: text(m.title, 512, true),
      turns,
      checkpoint: m.checkpoint === null ? null : decodeId(m.checkpoint),
    };
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
          notice: "Original work is not observed. No automatic replay.",
        }
      : turn;
  }
  private summary(meta: SavedConversation): ChatSummary {
    const head = meta.turns.at(-1) as string,
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
  private liveSummary(live: LiveTurn): ChatSummary {
    return {
      id: live.conversationId,
      title: live.title,
      head: live.turn.id,
      status: live.turn.status,
      updatedAt: live.acceptedAt,
    };
  }
  list(): WorkbenchResult & { kind: "conversations" } {
    this.o.owner.lease.assert();
    const dir = join(this.root, "sessions");
    if (!this.files.directory(dir))
      return {
        kind: "conversations",
        entries: [...this.active.values()].map((live) =>
          this.liveSummary(live),
        ),
      };
    const entries: ChatSummary[] = [],
      opened = opendirSync(dir);
    try {
      for (let e = opened.readSync(); e; e = opened.readSync()) {
        if (
          !e.isFile() ||
          !e.name.endsWith(".json") ||
          entries.length >= SESSION_LIMIT
        )
          throw new ContractError("capacity");
        const meta = this.metadata(decodeId(e.name.slice(0, -5)));
        if (!meta) throw new ContractError("corrupt-selected");
        entries.push(this.summary(meta));
      }
    } finally {
      opened.closeSync();
    }
    for (const live of this.active.values()) {
      const at = entries.findIndex((entry) => entry.id === live.conversationId);
      if (at < 0) entries.push(this.liveSummary(live));
      else entries[at] = this.liveSummary(live);
    }
    return {
      kind: "conversations",
      entries: entries.sort((a, b) => b.updatedAt - a.updatedAt),
    };
  }
  view(id: string, before: string | null): WorkbenchResult {
    this.o.owner.lease.assert();
    const meta = this.metadata(id);
    if (!meta) {
      const live =
        before === null
          ? [...this.active.values()].find((turn) => turn.conversationId === id)
          : undefined;
      return {
        kind: "conversation",
        summary: live ? this.liveSummary(live) : null,
        turns: live
          ? [
              {
                ...structuredClone(live.turn),
                notice: [
                  "Current metadata unavailable; showing the active turn only. No state was reconstructed.",
                  live.turn.notice,
                ]
                  .filter(Boolean)
                  .join("\n"),
              },
            ]
          : [],
        before: null,
      };
    }
    let end = before === null ? meta.turns.length : meta.turns.indexOf(before);
    if (end < 0) throw new ContractError("stale");
    const turns: ChatTurn[] = [];
    let bytes = 0;
    while (end > 0 && turns.length < 20) {
      const turn = this.turn(meta.turns[end - 1]),
        size = Buffer.byteLength(canonicalJson(turn, TURN_BYTES));
      if (bytes + size > 400 * 1024) break;
      bytes += size;
      turns.unshift(structuredClone(turn));
      --end;
    }
    return {
      kind: "conversation",
      summary: this.summary(meta),
      turns,
      before: end > 0 ? turns[0].id : null,
    };
  }
  private capacity(): void {
    let bytes = 0,
      count = 0;
    const visit = (directory: string, depth: number) => {
      if (depth > 4 || !this.files.directory(directory)) return;
      const dir = opendirSync(directory);
      try {
        for (let entry = dir.readSync(); entry; entry = dir.readSync()) {
          if (++count > 10000) throw new ContractError("capacity");
          const path = join(directory, entry.name);
          if (entry.isDirectory()) visit(path, depth + 1);
          else if (entry.isFile()) bytes += lstatSync(path).size;
          else throw new ContractError("corrupt-selected");
          if (
            bytes +
              (this.active.size + 1) *
                (CONTEXT_BYTES + TURN_BYTES + 128 * 1024) >
            512 * 1024 * 1024
          )
            throw new ContractError("capacity");
        }
      } finally {
        dir.closeSync();
      }
    };
    visit(this.root, 0);
  }
  send(input: Send): WorkbenchResult {
    this.o.owner.lease.assert();
    const command = {
      ...input,
      text: sanitizeText(input.text, this.o.secrets()),
    };
    const prior = this.read(
      this.path(input.commandId, "accepted.json"),
      META_BYTES,
    );
    if (prior !== undefined) {
      const saved = closed(prior, ["command", "at"]);
      if (canonicalJson(saved.command) !== canonicalJson(command))
        throw new ContractError("conflict");
      return { kind: "accepted", commandId: input.commandId };
    }
    if (
      this.files.directory(dirname(this.path(input.commandId, "accepted.json")))
    )
      throw new ContractError("corrupt-selected");
    if (this.o.owner.state !== "idle") throw new ContractError("quarantine");
    const choice = this.o.choice.snapshot();
    if (
      !choice.selected ||
      canonicalJson(choice.version) !== canonicalJson(input.model)
    )
      throw new ContractError("stale");
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
    if ((meta?.turns.at(-1) ?? null) !== input.head)
      throw new ContractError("stale");
    if (meta && this.turn(input.head as string).status !== "completed")
      throw new ContractError("conflict");
    if (
      this.active.size >= 8 ||
      (meta?.turns.length ?? 0) >= 1000 ||
      (!meta && this.list().entries.length >= SESSION_LIMIT)
    )
      throw new ContractError("capacity");
    if (!input.text.trim()) throw new ContractError("invalid");
    if (this.list().entries.some((entry) => entry.status === "unknown"))
      throw new ContractError("quarantine");
    this.capacity();
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
      this.run(command, turn, previous, previousFile, next, abort),
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
      next.turns.push(turn.id);
      live.metaFile = this.write(
        this.metadataPath(next.id),
        next,
        META_BYTES,
        beforeMeta,
      );
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
  link(taskId: string, conversationId: string, epoch: string): void {
    this.o.owner.lease.assert();
    if (
      epoch !== this.o.owner.lease.registration.epoch ||
      this.o.owner.state !== "idle"
    )
      throw new ContractError("stale");
    if (
      !this.metadata(conversationId) ||
      !this.o.coordination.store.load(taskId)
    )
      throw new ContractError("unavailable");
    const existing = this.origin(taskId).conversationId;
    if (existing !== null && existing !== conversationId)
      throw new ContractError("conflict");
    if (existing === null)
      this.write(
        join(this.root, "task-links", `${decodeId(taskId)}.json`),
        { conversationId },
        META_BYTES,
      );
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
    if (!meta?.turns.includes(turnId)) throw new ContractError("invalid");
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
  ): Promise<AcceptedWorkResult> {
    let barrier: ReviewBarrier | undefined;
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
      barrier = await this.o.actions.scheduler.conversationBarrier(
        turn.id,
        abort.signal,
      );
      barrier.assertHeld();
      this.o.actions.conversationBoundary(barrier);
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
        taskKind: "code",
        runId: turn.id,
        childRunId: randomUUID(),
        assignmentId: "conversation",
        purpose: "edit",
        model: selected,
        role: {
          role: "implementation-worker",
          sha256: hash("Ordinary conversation."),
        },
        context: "",
        instructions: "Ordinary conversation.",
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
      let checkpoint: unknown[] | undefined;
      const capture = new ConversationCapture(turn, save, () => [
        ...this.o.secrets(),
        ...credentials,
      ]);
      const running = Promise.resolve().then(() =>
        launchConversation(
          prepared.prepared,
          {
            previous,
            agentDir: this.o.agentDir,
          },
          abort.signal,
          {
            timeoutMs: this.o.timeoutMs ?? LIMITS.workerMs,
            ownerSecrets: this.o.secrets,
            onContext: (messages) => {
              checkpoint = messages;
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
          { schema: "cadence-conversation-context/1", messages: checkpoint },
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
      await authSettled;
      uncertain ||= this.o.owner.state === "quarantined";
      if (uncertain) turn.status = "unknown";
      try {
        this.write(this.path(turn.id, "native.json"), native, META_BYTES);
        if (barrier && !uncertain && this.o.owner.state === "idle")
          this.o.actions.conversationBoundary(barrier);
        if (turn.status !== "completed")
          turn.notice = [
            turn.notice,
            "Start a new conversation; incomplete context is not replayed.",
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
