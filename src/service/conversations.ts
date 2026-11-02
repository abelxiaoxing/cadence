/** Ordinary conversations owned by the persistent service, not Cadence tasks. */
import { randomUUID } from "node:crypto";
import { opendirSync, statfsSync } from "node:fs";
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
} from "./contracts/core.ts";
import type { ExecutionContext } from "./contracts/models.ts";
import type {
  ChatItem,
  ChatTurn,
  WorkbenchCommand,
  WorkbenchResult,
} from "./contracts/workbench.ts";
import { ConversationContexts } from "./conversation-contexts.ts";
import {
  ConversationRecords,
  META_BYTES,
  type SavedConversation,
  TURN_BYTES,
} from "./conversation-records.ts";
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

const OMITTED_FLAG = {
  "hidden-thinking": "thinking",
  binary: "media",
  unsupported: "other",
} as const satisfies Record<string, keyof ChatTurn["omitted"]>;
type Send = Extract<WorkbenchCommand, { kind: "send" }>;
interface Options {
  contexts?: ConversationContexts;
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
  readonly records: ConversationRecords;
  private readonly contexts: ConversationContexts;
  private readonly active = new Map<string, LiveTurn>();
  constructor(private readonly o: Options) {
    this.contexts = o.contexts ?? new ConversationContexts(o);
    this.records = new ConversationRecords({
      directory: o.coordination.directory,
      files: o.coordination.files,
      cwd: o.coordination.store.root,
      assertCurrent: () => o.owner.lease.assert(),
      active: this.active,
    });
  }
  private currentDirectory(cwd: string): boolean {
    const current = resolveWorkspace(cwd);
    return (
      current.root === this.o.coordination.store.root && current.cwd === cwd
    );
  }
  private get files() {
    return this.o.coordination.files;
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
  bindControl(id: string): void {
    if (!this.records.controlBound(id))
      this.write(
        join(this.records.root, "control-links", `${decodeId(id)}.json`),
        { schema: "cadence-conversation-control/1", conversationId: id },
        META_BYTES,
      );
  }
  /** Startup checks every retained head without a lifetime-count ceiling.
   * Admission thereafter relies on the owner's original-work fence, not a
   * full-history scan on each Send. No record is repaired or reconstructed. */
  assertSettled(): void {
    this.o.owner.lease.assert();
    const path = join(this.records.root, "sessions");
    if (!this.files.directory(path)) return;
    const dir = opendirSync(path);
    try {
      for (let e = dir.readSync(); e; e = dir.readSync()) {
        if (!e.isFile() || !e.name.endsWith(".json"))
          throw new ContractError("corrupt-selected");
        if (
          this.records.retainedSummary(decodeId(e.name.slice(0, -5))).status ===
          "unknown"
        )
          throw new ContractError("quarantine");
      }
    } finally {
      dir.closeSync();
    }
  }
  attempted(conversationId: string, commandId: string): boolean {
    this.o.owner.lease.assert();
    const meta = this.records.metadata(conversationId);
    return (
      this.active.has(commandId) ||
      this.files.directory(
        dirname(this.records.path(commandId, "accepted.json")),
      ) ||
      (!!meta && this.records.contains(meta, commandId)) ||
      (!meta &&
        !!this.files.read(
          this.records.identityPath(conversationId),
          META_BYTES,
        ))
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
    const prior = this.records.read(
      this.records.path(input.commandId, "accepted.json"),
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
      this.files.directory(
        dirname(this.records.path(input.commandId, "accepted.json")),
      )
    )
      throw new ContractError("corrupt-selected");
    if (this.o.owner.state !== "idle") throw new ContractError("quarantine");
    if (
      !input.model.conversation &&
      this.files.read(
        this.contexts.records.path(input.conversationId),
        META_BYTES,
      )
    )
      throw new ContractError("stale");
    if (
      input.model.conversation &&
      input.model.conversation.id !== input.conversationId
    )
      throw new ContractError("stale");
    const execution = this.contexts.capture(input.model, !!control?.reply);
    const existingIdentity = this.files.read(
      this.records.identityPath(input.conversationId),
      META_BYTES,
    );
    if (
      existingIdentity &&
      this.records.cwd(input.conversationId) !== execution.cwd
    )
      throw new ContractError("stale");
    const beforeMeta = this.files.read(
      this.records.metadataPath(input.conversationId),
      META_BYTES,
    );
    const meta = this.records.metadata(input.conversationId);
    this.files.assert(
      this.records.metadataPath(input.conversationId),
      beforeMeta,
      META_BYTES,
    );
    if (
      !meta &&
      this.files.read(
        this.records.identityPath(input.conversationId),
        META_BYTES,
      )
    )
      throw new ContractError("corrupt-selected");
    if ((meta?.head ?? null) !== input.head) throw new ContractError("stale");
    if (
      meta &&
      this.records.turn(input.head as string).status !== "completed" &&
      (!control ||
        ["queued", "running", "unknown"].includes(
          this.records.turn(input.head as string).status,
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
      execution,
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
      ? this.records.path(next.checkpoint, "context.json")
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
      this.run(
        command,
        turn,
        previous,
        previousFile,
        next,
        abort,
        execution,
        control,
      ),
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
          this.records.identityPath(next.id),
          { schema: "cadence-conversation/1", id: next.id, cwd: execution.cwd },
          META_BYTES,
        );
      this.write(
        this.records.path(turn.id, "accepted.json"),
        { command, at: live.acceptedAt },
        META_BYTES,
      );
      live.turnFile = this.write(
        this.records.path(turn.id, "turn.json"),
        turn,
        TURN_BYTES,
      );
      const position = {
        conversationId: next.id,
        ordinal: next.count,
        turnId: turn.id,
      };
      this.write(
        this.records.slotPath(next.id, next.count),
        position,
        META_BYTES,
      );
      this.write(
        this.records.path(turn.id, "position.json"),
        position,
        META_BYTES,
      );
      next.head = turn.id;
      next.count++;
      live.metaFile = this.write(
        this.records.metadataPath(next.id),
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
  interrupt(id: string, turnId: string, epoch: string): void {
    this.o.owner.lease.assert();
    const live = this.active.get(turnId);
    if (live) {
      if (live.conversationId !== id || live.turn.epoch !== epoch)
        throw new ContractError("stale");
      live.abort.abort();
      return;
    }
    const meta = this.records.metadata(id);
    if (!meta || !this.records.contains(meta, turnId))
      throw new ContractError("invalid");
    if (this.records.turn(turnId).epoch !== epoch)
      throw new ContractError("stale");
    this.active.get(turnId)?.abort.abort();
  }
  private async run(
    command: Send,
    turn: ChatTurn,
    previous: string | null,
    previousFile: FileSnapshot | undefined,
    meta: SavedConversation,
    abort: AbortController,
    execution: ExecutionContext,
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
        this.records.path(turn.id, "turn.json"),
        turn,
        TURN_BYTES,
        live.turnFile,
      );
    };
    const current = () => {
      if (
        abort.signal.aborted ||
        this.o.owner.state !== "idle" ||
        !this.currentDirectory(execution.cwd)
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
      // The admitted original owns its exact model/cwd, not a future picker
      // choice. Access rotation and another conversation's choice cannot rebase it.
      const selected = execution.model;
      if (!selected) throw new ContractError("stale");
      this.o.models.assertCurrent(selected);
      const instructions = control
        ? `${control.instructions}\nCONVERSATION CONTEXT (data): cwd ${execution.cwd}; checkout root ${execution.checkoutRoot}. Workflow declared write paths are checkout-root-relative, not cwd-relative. Tools, relative investigation roots and check commands use this conversation cwd.`
        : "Ordinary conversation.";
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
          sha256: hash(instructions),
        },
        context: "",
        instructions,
        prompt: command.text,
        handoff: { graphRevision: 1, inputs: [] },
      });
      const auth = this.o.models.prepareTracked({
        request,
        cwd: execution.cwd,
        operationId: randomUUID(),
        epoch: turn.epoch,
        timeoutMs: this.o.timeoutMs ?? LIMITS.workerMs,
        signal: abort.signal,
        current,
        journal: {
          preparation: (value) =>
            this.write(
              this.records.path(turn.id, "auth-intent.json"),
              value,
              META_BYTES,
            ),
          settlement: (value) =>
            this.write(
              this.records.path(turn.id, "auth-settled.json"),
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
        this.records.path(turn.id, "launch.json"),
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
          this.records.path(turn.id, `transcript/${page.page}.json`),
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
                this.records.path(turn.id, `context-${contextCount}.json`),
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
          this.records.path(turn.id, "context.json"),
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
          this.records.metadataPath(meta.id),
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
        this.write(
          this.records.path(turn.id, "native.json"),
          native,
          META_BYTES,
        );
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
