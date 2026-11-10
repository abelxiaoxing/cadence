/** Ordinary and Cadence conversations, which are the project's Pi sessions:
 * the terminal and the browser read and continue the same session files.
 * Pi (the browser turn's SDK worker, or the rename child) writes the content;
 * this owner keeps only each browser message's admission record and its
 * archive records, and reads the sessions back. */
import { randomUUID } from "node:crypto";
import { opendirSync, statfsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { InputImage } from "../image-content.mjs";
import {
  launchConversation,
  type ProcessSpec,
  renameSession,
} from "../subagent-process.ts";
import { describeWorkerRuntime, type WorkerRuntime } from "../worker-model.mjs";
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
import { managedActivity } from "./contracts/activity.ts";
import { ContractError, canonicalJson } from "./contracts/core.ts";
import type { ExecutionContext } from "./contracts/models.ts";
import {
  type ChatItem,
  type ChatStatus,
  type ChatTurn,
  decodeSessionId,
  type WorkbenchCommand,
  type WorkbenchResult,
} from "./contracts/workbench.ts";
import { ConversationContexts } from "./conversation-contexts.ts";
import {
  ConversationRecords,
  INDEXED_COMMANDS,
} from "./conversation-records.ts";
import type { ServiceCoordination } from "./coordination.ts";
import type { OwnerModelChoice } from "./model-choice.ts";
import type { OwnerModelContext } from "./model-context.ts";
import type { AcceptedWorkResult, ServiceOwner } from "./owner.ts";
import { summaryTitle } from "./pi-sessions.ts";
import { type FileSnapshot, hash } from "./private-files.ts";

const META_BYTES = 64 * 1024;

/** Text one live preview keeps per item; the full item is read from the
 * session once Pi has written it. */
const PREVIEW_BYTES = 64 * 1024;
/** Streamed items a preview keeps text for; earlier ones are in the session. */
const RECENT_PREVIEWS = 8;
const PREVIEW_MARK =
  "\n[Preview truncated; the rest appears once it is written.]";

const OMITTED_FLAG = {
  "hidden-thinking": "thinking",
  binary: "media",
  unsupported: "other",
} as const satisfies Record<string, keyof ChatTurn["omitted"]>;

/** Rename children one owner runs at a time, and the rename commands whose
 * outcome it keeps so that a lost reply observes the original. */
const RENAMES = 4;
const RENAME_RECEIPTS = 64;

type Send = Extract<WorkbenchCommand, { kind: "send" }>;
type Rename = Extract<WorkbenchCommand, { kind: "conversation-rename" }>;
type Archive = Extract<WorkbenchCommand, { kind: "conversation-archive" }>;
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
  /** Where the sessions live; defaults to Pi's own resolution. */
  sessionDir?: string;
}
export interface ConversationControl {
  instructions: string;
  reply?: string;
  accept(): void;
  onTool: NonNullable<ProcessSpec["onCoordinator"]>;
  settle(): Promise<void>;
}
/** A browser message's durable admission: what was sent, where from. */
export interface Accepted {
  execution?: ExecutionContext;
  directory?: string;
  file?: string | null;
  command: Send;
  at: number;
  session: string;
  /** The entry it continues (null: a new session or a new root). */
  parent: string | null;
  /** The session file's size when it was accepted; Pi appends after it. */
  offset: number;
}
/** How the message ended, beside the entries Pi wrote for it. */
export interface CommandState {
  status: ChatStatus;
  notice: string;
  /** What the live capture did not keep. Its `thinking` flag stays in the
   * record but is not shown: the session holds the thinking Pi wrote. */
  omitted: ChatTurn["omitted"];
  /** The user message entry Pi wrote for it, null when none was written. */
  user: string | null;
}
export interface LiveTurn {
  runtime?: WorkerRuntime;
  images?: InputImage[];
  execution: ExecutionContext;
  accepted: Accepted;
  commandId: string;
  epoch: string;
  title: string;
  state: CommandState;
  stateFile: FileSnapshot | null;
  capture: LiveCapture | null;
  abort: AbortController;
  original: Promise<AcceptedWorkResult>;
}

/** What a browser turn's worker streams that Pi has not written yet: the
 * message being generated and the tool running, as bounded previews. */
export class LiveCapture {
  retry: ChatTurn["retry"];
  readonly omitted = { thinking: false, media: false, other: false };
  notice = "";
  private readonly assistants: { id: string; text: string; error: boolean }[] =
    [];
  private readonly tools: {
    id: string;
    name: string;
    args: string;
    text: string;
    error: boolean;
  }[] = [];
  private readonly details = new Map<
    string,
    { descriptor: DetailDescriptor; sanitizer: DetailSanitizer; text: string }
  >();
  private readonly blocks = new Map<
    string,
    { messageId: string; text: string }
  >();
  private imageUser: string | undefined;
  constructor(
    private readonly secrets: () => readonly string[],
    private readonly inputImages = false,
  ) {}
  private bounded(value: string): string {
    return Buffer.byteLength(value) <= PREVIEW_BYTES
      ? value
      : `${Buffer.from(value).subarray(0, PREVIEW_BYTES).toString("utf8").replace(/�$/u, "")}${PREVIEW_MARK}`;
  }
  private tool(callId: string) {
    let tool = this.tools.find((t) => t.id === callId);
    if (!tool) {
      tool = { id: callId, name: "", args: "", text: "", error: false };
      this.tools.push(tool);
      // Pi writes each result as it ends: older previews are only counted.
      const stale = this.tools[this.tools.length - 1 - RECENT_PREVIEWS];
      if (stale) stale.args = stale.text = "";
    }
    return tool;
  }
  accept(frame: CaptureFrame): void {
    const e = frame.event;
    if (e.kind === "message-start" && e.role === "user" && this.inputImages) {
      this.imageUser = e.messageId;
    } else if (e.kind === "message-start" && e.role === "assistant") {
      if (!this.assistants.some((a) => a.id === e.messageId)) {
        this.assistants.push({ id: e.messageId, text: "", error: false });
        const stale =
          this.assistants[this.assistants.length - 1 - RECENT_PREVIEWS];
        if (stale) stale.text = "";
      }
    } else if (e.kind === "tool-start" || e.kind === "tool-end") {
      const tool = this.tool(e.callId);
      tool.name = sanitizeText(e.name, this.secrets()).slice(0, 128);
      if (e.kind === "tool-end") tool.error = e.isError;
    } else if (e.kind === "detail-begin") {
      const kind = e.descriptor.owner.kind;
      if (kind === "context" || kind === "handoff") return;
      if (this.details.size >= 64) return;
      this.details.set(e.detailId, {
        descriptor: e.descriptor,
        sanitizer: new DetailSanitizer(e.descriptor.encoding, this.secrets()),
        text: "",
      });
    } else if (e.kind === "detail-chunk" || e.kind === "detail-end") {
      const d = this.details.get(e.detailId);
      if (!d) return;
      const added =
        e.kind === "detail-chunk"
          ? d.sanitizer.write(e.text)
          : d.sanitizer.end();
      if (Buffer.byteLength(d.text) <= PREVIEW_BYTES) d.text += added;
      const o = d.descriptor.owner;
      if (o.kind === "message" && o.stage === "stream") {
        this.blocks.set(o.blockId, { messageId: o.messageId, text: d.text });
        const message = this.assistants.find((a) => a.id === o.messageId);
        if (message)
          message.text = this.bounded(
            [...this.blocks.values()]
              .filter((b) => b.messageId === o.messageId)
              .map((b) => b.text)
              .join(""),
          );
      } else if (o.kind === "message-final") {
        const message = this.assistants.find((a) => a.id === o.messageId);
        if (message) message.text = this.bounded(d.text);
      } else if (o.kind === "tool") {
        const tool = this.tool(o.callId);
        if (o.stage === "execution-arguments" || o.stage === "arguments-final")
          tool.args = this.bounded(d.text);
        if (o.stage === "result" || o.stage === "update-snapshot")
          tool.text = this.bounded(d.text);
      }
      if (e.kind === "detail-end") this.details.delete(e.detailId);
    } else if (e.kind === "message-end") {
      const message = this.assistants.find((a) => a.id === e.messageId);
      if (message)
        message.error = ["error", "aborted", "length"].includes(e.stopReason);
      for (const [id, block] of this.blocks)
        if (block.messageId === e.messageId) this.blocks.delete(id);
    } else if (e.kind === "model-retry") {
      this.retry = e.progress ?? undefined;
    } else if (e.kind === "worker-failure") {
      this.retry = undefined;
      this.notice = `worker-failure: ${e.code}`;
    } else if (
      e.kind === "omitted-block" &&
      e.block.owner.kind !== "context" &&
      e.block.owner.kind !== "handoff" &&
      !(
        this.inputImages &&
        e.block.sourceType === "image" &&
        e.block.owner.kind === "message" &&
        e.block.owner.messageId === this.imageUser
      )
    )
      // A flag, not a notice line: it must never displace a failure reason.
      this.omitted[OMITTED_FLAG[e.block.reason]] = true;
  }
  /** The written items extended by what Pi has not written yet. Pi writes each
   * message when it ends, in the order the worker streamed them, so the
   * written assistant messages and tool results are counted, not matched.
   * Thinking is not streamed here: a block that splits one message's text
   * leaves that text counted once. */
  extend(items: ChatItem[]): { items: ChatItem[]; stable: number } {
    const out = items.map((item) => ({ ...item }));
    let written = 0,
      counted: string | undefined;
    for (const item of out) {
      if (item.role === "assistant") {
        // A written assistant item is `<entry id>:<index>`.
        const at = item.id.lastIndexOf(":");
        const message = at < 0 ? item.id : item.id.slice(0, at);
        if (message !== counted) written++;
        counted = message;
      } else if (item.role !== "thinking") counted = undefined;
    }
    const calls = out.filter((i) => i.role === "tool");
    const results = calls.filter((i) => i.text || i.error).length;
    let stable = out.length;
    this.tools.forEach((tool, index) => {
      if (index < results) return;
      const item =
        index < calls.length
          ? calls[index]
          : (() => {
              const added: ChatItem = {
                id: tool.id,
                role: "tool",
                name: tool.name,
                args: tool.args,
                text: "",
                error: false,
              };
              out.push(added);
              return added;
            })();
      item.text = tool.text;
      item.error = tool.error;
      stable = Math.min(stable, out.indexOf(item));
    });
    this.assistants.slice(written).forEach((message) => {
      stable = Math.min(stable, out.length);
      out.push({
        id: message.id,
        role: "assistant",
        text: message.text,
        name: "",
        args: "",
        error: message.error,
      });
    });
    return { items: out, stable };
  }
}

export class Conversations {
  readonly records: ConversationRecords;
  readonly contexts: ConversationContexts;
  private readonly active = new Map<string, LiveTurn>();
  /** Sessions a rename child is appending to: no second rename, no Send. */
  private readonly renaming = new Set<string>();
  private readonly renames = new Map<
    string,
    { identity: string; pending: boolean; result: Promise<WorkbenchResult> }
  >();
  /** Every signal to a child is the lease holder's. */
  private readonly maySignal = () => {
    try {
      this.o.owner.lease.assert();
      return true;
    } catch {
      return false;
    }
  };
  activity() {
    return [...this.active.values()].map((live) =>
      managedActivity({
        id: live.commandId,
        source: "turn",
        execution: live.execution,
        root: this.o.coordination.store.root,
        epoch: live.epoch,
        now: Date.now(),
        leaf: live.accepted.parent,
        phase: live.abort.signal.aborted
          ? "stopping"
          : live.state.status === "queued"
            ? "queued"
            : live.state.status === "running"
              ? "running"
              : "settling",
      }),
    );
  }
  constructor(private readonly o: Options) {
    this.records = new ConversationRecords({
      ...o,
      assertCurrent: () => o.owner.lease.assert(),
      active: this.active,
    });
    this.contexts =
      o.contexts ??
      new ConversationContexts({ ...o, sessions: this.records.sessions });
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
    max = META_BYTES,
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
      this.write(this.records.controlPath(id), {
        schema: "cadence-conversation-control/1",
        conversationId: id,
      });
  }
  /** Startup refuses while a browser message's closure was recorded as unknown:
   * its worker may still write to the session. A message the previous owner's
   * death interrupted (still recorded queued or running) does not refuse: host
   * startup has already stopped that owner's workers by exact identity, and the
   * reader reports the reply as interrupted. */
  assertSettled(): void {
    this.o.owner.lease.assert();
    const sessions = join(this.records.root, "sessions");
    if (!this.files.directory(sessions)) return;
    const dir = opendirSync(sessions);
    try {
      for (let e = dir.readSync(); e; e = dir.readSync()) {
        if (!e.isFile() || !e.name.endsWith(".json"))
          throw new ContractError("corrupt-selected");
        const latest = this.records
          .index(decodeSessionId(e.name.slice(0, -5)))
          .commands.at(-1);
        if (latest && this.records.closureUnknown(latest))
          throw new ContractError("quarantine");
      }
    } finally {
      dir.closeSync();
    }
  }
  attempted(conversationId: string, commandId: string): boolean {
    this.o.owner.lease.assert();
    return (
      this.active.has(commandId) ||
      this.files.directory(
        dirname(this.records.path(commandId, "accepted.json")),
      ) ||
      this.records.index(conversationId).commands.includes(commandId)
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
    const prior = this.records.accepted(input.commandId);
    if (!prior) return undefined;
    if (
      canonicalJson(prior.command) !== canonicalJson(this.command(input, reply))
    )
      throw new ContractError("conflict");
    return { kind: "accepted", commandId: input.commandId };
  }
  send(
    input: Send,
    control?: ConversationControl,
    beforeAccept?: () => void,
    claimImages?: () => InputImage[],
  ): WorkbenchResult {
    this.o.owner.lease.assert();
    const command = this.command(input, !!control?.reply);
    const receipt = this.receipt(input, !!control?.reply);
    if (receipt) return receipt;
    if (
      this.files.directory(
        dirname(this.records.path(input.commandId, "state.json")),
      )
    )
      throw new ContractError("corrupt-selected");
    if (this.o.owner.state !== "idle") throw new ContractError("quarantine");
    if (
      input.model.conversation &&
      input.model.conversation.id !== input.conversationId
    )
      throw new ContractError("stale");
    // A rename child is appending to this session; a turn would branch beside it.
    if (this.renaming.has(input.conversationId))
      throw new ContractError("conflict");
    const execution = this.contexts.capture(input.model, !!control?.reply);
    const context = this.contexts.records.read({
      id: input.conversationId,
      cwd: execution.cwd,
    }).context;
    if (
      context.cwd !== execution.cwd ||
      (!input.model.conversation && context.model)
    )
      throw new ContractError("stale");
    this.records.sessions.directoryFor(execution.cwd);
    // One browser message at a time per session; the terminal may still write.
    if (this.records.liveFor(input.conversationId))
      throw new ContractError("conflict");
    const index = this.records.index(input.conversationId);
    const session = this.records.sessions.session(input.conversationId);
    if (input.head !== null && !session?.byId.has(input.head))
      throw new ContractError("stale");
    if (this.active.size >= 8) throw new ContractError("capacity");
    if (!input.text.trim() && !input.images?.length)
      throw new ContractError("invalid");
    if (input.images?.length && (!claimImages || control?.reply))
      throw new ContractError("invalid");
    if (
      input.images?.length &&
      !this.o.models
        .catalog()
        .entries.some(
          (m) =>
            m.provider === execution.model?.provider &&
            m.model === execution.model?.model &&
            m.images,
        )
    )
      throw new ContractError("unsupported-context");
    const space = statfsSync(this.o.coordination.directory);
    if (space.bavail * space.bsize < LIMITS.freeSpaceFloorBytes)
      throw new ContractError("capacity");
    const listed = session
      ? this.records.sessions.find(input.conversationId)
      : undefined;
    const accepted: Accepted = {
      execution,
      directory: this.records.sessions.directoryFor(execution.cwd),
      file: listed?.path ?? null,
      command,
      at: Date.now(),
      session: input.conversationId,
      parent: input.head,
      offset: session?.read?.size ?? 0,
    };
    const runtime =
      control?.reply || !execution.model
        ? undefined
        : this.o.models.workerSettings(execution.cwd, execution.model);
    const abort = new AbortController();
    // Register original work before the first durable acceptance or asynchronous effect.
    let begin!: () => void;
    const ready = new Promise<void>((resolve) => {
      begin = resolve;
    });
    const live: LiveTurn = {
      runtime,
      images: claimImages?.() ?? [],
      execution,
      accepted,
      commandId: input.commandId,
      epoch: input.model.epoch,
      title: listed
        ? summaryTitle(listed.summary)
        : [...command.text.trim()].slice(0, 100).join("") || "Conversation",
      state: {
        status: "queued",
        notice: "",
        omitted: { thinking: false, media: false, other: false },
        user: null,
      },
      stateFile: null,
      capture: null,
      abort,
      original: ready.then(() => this.run(live, control)),
    };
    // Beyond this point even a failed registration/control write is uncertain.
    beforeAccept?.();
    this.active.set(input.commandId, live);
    this.o.owner.trackConversation(live.original, () =>
      abort.abort({
        source: "service",
        reason: "stop",
        target: input.commandId,
      }),
    );
    try {
      this.write(this.records.path(input.commandId, "accepted.json"), accepted);
      live.stateFile = this.write(
        this.records.path(input.commandId, "state.json"),
        live.state,
      );
      this.write(
        this.records.indexPath(input.conversationId),
        {
          schema: "cadence-session-commands/1",
          id: input.conversationId,
          commands: [...index.commands, input.commandId].slice(
            -INDEXED_COMMANDS,
          ),
        },
        META_BYTES,
        index.file,
      );
      // Control state commits last: it never names a message that is not durably
      // recorded. A failure here leaves an older, still-valid control record.
      control?.accept();
    } catch (error) {
      abort.abort();
      begin();
      throw error;
    }
    begin();
    return { kind: "accepted", commandId: input.commandId };
  }
  /** Records a session's name as the terminal's `/name` does: a child lets
   * Pi append one `session_info` entry, and the command is acknowledged only
   * once the session shows that name. This owner writes no session file. */
  rename(request: Rename): Promise<WorkbenchResult> {
    this.o.owner.lease.assert();
    const identity = canonicalJson(request),
      id = request.conversationId;
    const prior = this.renames.get(request.commandId);
    if (prior) {
      if (prior.identity !== identity) throw new ContractError("conflict");
      return prior.result;
    }
    if (this.o.owner.state !== "idle") throw new ContractError("quarantine");
    this.records.assertSupported(id);
    // A name that reads redact could not be confirmed by reading it back.
    if (sanitizeText(request.name, this.o.secrets()) !== request.name)
      throw new ContractError("forbidden");
    const listed = this.records.sessions.find(id);
    if (!listed) throw new ContractError("stale");
    // A live turn's worker holds its own copy of the session: an entry appended
    // beside it would become a side branch.
    if (this.records.liveFor(id) || this.renaming.has(id))
      throw new ContractError("conflict");
    if (this.renaming.size >= RENAMES) throw new ContractError("capacity");
    const abort = new AbortController();
    // The launch waits one turn, so a refused registration below starts nothing.
    const closed = Promise.resolve()
      .then(() =>
        renameSession(
          {
            id,
            dir: dirname(listed.path),
            file: listed.path,
            cwd: listed.summary.cwd,
            name: request.name,
          },
          abort.signal,
          this.maySignal,
        ),
      )
      // A launch that throws started no child.
      .catch(() => undefined);
    const receipt = {
      identity,
      pending: true,
      result: closed.then((run): WorkbenchResult => {
        this.renaming.delete(id);
        receipt.pending = false;
        if (run?.outcome !== "completed")
          throw new ContractError("unavailable");
        // Exit zero is not the evidence: another writer may have named the
        // session since, or Pi may have kept the entry in memory.
        if (
          this.records.sessions.find(id)?.summary.name !==
          (request.name || null)
        )
          throw new ContractError("receipt-inconclusive");
        return { kind: "accepted", commandId: request.commandId };
      }),
    };
    // A lost reply leaves this unobserved until the same command asks again.
    receipt.result.catch(() => {});
    try {
      // Accepted work that Stop ends: settled once the child's closure is
      // known. The child has no capture protocol, so its closure is the fact.
      this.o.owner.trackConversation(
        closed.then((run) => ({
          status: run && !run.closed ? "uncertain" : "settled",
        })),
        () =>
          abort.abort({
            source: "service",
            reason: "stop",
            target: request.commandId,
          }),
      );
    } catch (error) {
      abort.abort();
      throw error;
    }
    this.renaming.add(id);
    this.renames.set(request.commandId, receipt);
    // Oldest outcomes go first; one still running is never forgotten.
    for (const [commandId, kept] of this.renames) {
      if (this.renames.size <= RENAME_RECEIPTS) break;
      if (!kept.pending) this.renames.delete(commandId);
    }
    return receipt.result;
  }
  /** Leaves a session out of the history list, or lists it again. The record
   * is this owner's own; Pi's session file is not moved, rewritten or deleted. */
  archive(request: Archive): WorkbenchResult {
    this.o.owner.lease.assert();
    if (this.o.owner.state !== "idle") throw new ContractError("quarantine");
    const id = request.conversationId,
      path = this.records.archivePath(id);
    const current = this.files.read(path);
    if (request.archived && !current) {
      if (!this.records.sessions.find(id)) throw new ContractError("stale");
      this.write(path, {
        schema: "cadence-conversation-archive/1",
        id,
        at: Date.now(),
      });
    } else if (!request.archived && current) {
      try {
        this.files.remove(path, current);
      } catch (error) {
        this.o.owner.quarantine();
        throw error;
      }
    }
    return { kind: "accepted", commandId: request.commandId };
  }
  interrupt(id: string, turnId: string, epoch: string): void {
    this.o.owner.lease.assert();
    const live = this.active.get(turnId);
    if (live) {
      if (live.accepted.session !== id || live.epoch !== epoch)
        throw new ContractError("stale");
      live.abort.abort({ source: "user", reason: "cancel", target: turnId });
      return;
    }
    if (!this.records.hasCommand(id, turnId))
      throw new ContractError("invalid");
  }
  private async run(
    live: LiveTurn,
    control?: ConversationControl,
  ): Promise<AcceptedWorkResult> {
    const { accepted, abort, state } = live;
    const commandId = live.commandId;
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
    const save = () => {
      if (!live.stateFile) throw new ContractError("corrupt-selected");
      live.stateFile = this.write(
        this.records.path(commandId, "state.json"),
        state,
        META_BYTES,
        live.stateFile,
      );
    };
    const current = () =>
      !abort.signal.aborted &&
      this.o.owner.state === "idle" &&
      this.currentDirectory(live.execution.cwd);
    try {
      if (!current()) throw new ContractError("stale");
      if (control?.reply) {
        state.status = "completed";
        state.notice = control.reply;
        return { status: "settled" };
      }
      if (!control) {
        barrier = await this.o.gate.acquire(commandId, abort.signal);
        barrier.assertHeld();
      }
      if (!current()) throw new ContractError("stale");
      const selected = live.execution.model;
      if (!selected) throw new ContractError("stale");
      this.o.models.assertCurrent(selected);
      const instructions = control
        ? `${control.instructions}\nCONVERSATION CONTEXT (data): cwd ${live.execution.cwd}; checkout root ${live.execution.checkoutRoot}. Workflow writes are checkout-root-relative; tools, investigation roots and checks use this conversation cwd.`
        : "Ordinary conversation.";
      const request = decodeWorkerPublicRequest({
        protocol: 2,
        taskId: randomUUID(),
        taskKind: control ? "research" : "code",
        runId: commandId,
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
        prompt: accepted.command.text,
        ...(live.images?.length ? { imageCount: live.images.length } : {}),
        handoff: { graphRevision: 1, inputs: [] },
      });
      const auth = this.o.models.prepareTracked({
        runtime: live.runtime,
        request,
        cwd: live.execution.cwd,
        operationId: randomUUID(),
        epoch: live.epoch,

        signal: abort.signal,
        current,
        journal: {
          preparation: (value) =>
            this.write(
              this.records.path(
                commandId,
                `auth/${value.operationId}-intent.json`,
              ),
              value,
            ),
          settlement: (value) =>
            this.write(
              this.records.path(
                commandId,
                `auth/${value.operationId}-settled.json`,
              ),
              value,
            ),
        },
      });
      authSettled = auth.settled;
      const prepared = await auth.result;
      if (prepared.status !== "prepared" || !current())
        throw new ContractError("auth-unavailable");
      state.status = "running";
      save();
      this.write(this.records.path(commandId, "launch.json"), {
        epoch: live.epoch,
        childRunId: request.childRunId,
        runtime: live.runtime ? describeWorkerRuntime(live.runtime) : null,
      });
      let credentials: readonly string[] = [];
      const capture = new LiveCapture(
        () => [...this.records.readSecrets(), ...credentials],
        !!live.images?.length,
      );
      live.capture = capture;
      const existing = this.records.sessions.find(accepted.session);
      if ((existing?.path ?? null) !== accepted.file)
        throw new ContractError("stale");
      const running = Promise.resolve().then(() =>
        launchConversation(
          prepared.prepared,
          {
            session: {
              id: accepted.session,
              dir: accepted.directory as string,
              file: existing?.path ?? null,
              head: accepted.parent,
            },
            agentDir: this.o.agentDir,
            ...(control ? { coordinator: true as const } : {}),
          },
          abort.signal,
          {
            images: live.images,
            ownerSecrets: this.o.secrets,
            onCoordinator: control?.onTool,
            maySignal: this.maySignal,
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
      this.o.owner.trackConversationProcess(tracked, () =>
        abort.abort({ source: "service", reason: "stop", target: commandId }),
      );
      const result = await running;
      capture.retry = undefined;
      uncertain = !result.closed;
      state.status = result.outcome;
      if (result.stop)
        state.notice = `${result.stop.source}: ${result.stop.reason} (${result.stop.target})`;
    } catch (error) {
      uncertain ||= this.o.owner.state === "quarantined";
      state.status = uncertain
        ? "unknown"
        : abort.signal.aborted
          ? "canceled"
          : "failed";
      state.notice ||=
        error instanceof ContractError ? error.code : "Conversation failed.";
    } finally {
      await control?.settle();
      await authSettled;
      uncertain ||= this.o.owner.state === "quarantined";
      if (uncertain) state.status = "unknown";
      if (abort.signal.aborted && abort.signal.reason?.source)
        state.notice = `${abort.signal.reason.source}: ${abort.signal.reason.reason} (${commandId})${state.notice ? `; ${state.notice}` : ""}`;
      try {
        // Preserve actual process closure even if the final state write fails.
        this.write(this.records.path(commandId, "native.json"), native);
        if (live.capture) {
          live.capture.retry = undefined;
          if (state.status !== "completed")
            state.notice ||= live.capture.notice;
          state.omitted = { ...live.capture.omitted };
        }
        try {
          state.user =
            this.records.sessions
              .session(accepted.session)
              ?.commandEntries(commandId, accepted.parent, accepted.offset)[0]
              ?.id ?? null;
        } catch {
          // An unreadable session leaves the message's entry unknown, not lost.
          state.user = null;
        }
        save();
      } catch {
        uncertain = true;
      }
      if (uncertain) this.o.owner.quarantine();
      else if (this.o.owner.state === "idle") barrier?.release();
      this.active.delete(commandId);
    }
    return { status: uncertain ? "uncertain" : "settled" };
  }
}
