/** Ordinary and Cadence conversations, which are the project's Pi sessions:
 * the terminal and the browser read and continue the same session files.
 * Pi (the browser turn's SDK worker, or the rename child) writes the content;
 * this owner keeps only each browser message's admission record and its
 * archive records, and reads the sessions back. One admitted run may be sent
 * further messages while its reply runs; they share its worker and end with
 * it. */
import { randomUUID } from "node:crypto";
import { opendirSync, statfsSync } from "node:fs";
import { dirname, join } from "node:path";
import { conversationContextLine } from "../coordinator-context.ts";
import type { InputImage } from "../image-content.mjs";
import {
  launchConversation,
  type ProcessSpec,
  renameSession,
  type WorkerInput,
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
import { managedActivity } from "./contracts/activity.ts";
import { ContractError, canonicalJson } from "./contracts/core.ts";
import type { ExecutionContext } from "./contracts/models.ts";
import {
  type ChatActivity,
  type ChatItem,
  type ChatStatus,
  type ChatTurn,
  clipText,
  decodeSessionId,
  isLiveChatStatus,
  RUN_INPUTS,
  WAITING_INPUTS,
  type WorkbenchCommand,
  type WorkbenchResult,
} from "./contracts/workbench.ts";
import { ConversationContexts } from "./conversation-contexts.ts";
import {
  ConversationRecords,
  INDEXED_COMMANDS,
  NOT_DELIVERED,
  UNOBSERVED,
  WITHDRAWN,
} from "./conversation-records.ts";
import type { ServiceCoordination } from "./coordination.ts";
import type { OwnerModelChoice } from "./model-choice.ts";
import type { OwnerModelContext } from "./model-context.ts";
import type { AcceptedWorkResult, ServiceOwner } from "./owner.ts";
import { replyStatus, type SessionEntry, summaryTitle } from "./pi-sessions.ts";
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
type Input = Extract<WorkbenchCommand, { kind: "conversation-input" }>;
type InputCancel = Extract<
  WorkbenchCommand,
  { kind: "conversation-input-cancel" }
>;
type Rename = Extract<WorkbenchCommand, { kind: "conversation-rename" }>;
type Archive = Extract<WorkbenchCommand, { kind: "conversation-archive" }>;
interface Options {
  contexts?: ConversationContexts;
  coordination: ServiceCoordination;
  owner: ServiceOwner;
  models: OwnerModelContext;
  choice: OwnerModelChoice;
  agentDir: string;
  cwd: string;
  secrets(): readonly string[];
  /** Where the sessions live; defaults to Pi's own resolution. */
  sessionDir?: string;
}

export { conversationContextLine };
export interface ConversationControl {
  /** Static coordinator policy carried in request.instructions (<= 16KiB). */
  instructions: string;
  /** Dynamic per-turn project and conversation context carried in
   * request.context (<= 32KiB) and mounted into Pi's appendSystemPrompt
   * without writing into the shared session JSONL. */
  context?: (
    execution: Pick<ExecutionContext, "cwd" | "checkoutRoot">,
  ) => string;
  reply?: string;
  accept(): void;
  onTool: NonNullable<ProcessSpec["onCoordinator"]>;
  settle(): Promise<void>;
}
/** A browser message's durable admission: what was sent, where from. A
 * message sent into a running reply names that reply's command, copies its
 * execution context and continues whatever the reply has written by then. */
export interface Accepted {
  execution?: ExecutionContext;
  directory?: string;
  file?: string | null;
  command: Send | Input;
  at: number;
  session: string;
  /** The entry a Send continues (null: a new session or a new root, and
   * always for a message sent into a running reply). */
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
/** A message admitted into a live run, until that run settles. */
export interface LiveInput {
  commandId: string;
  accepted: Accepted & { command: Input };
  state: CommandState;
  stateFile: FileSnapshot;
  /** Handed to the worker; until then only this owner holds it. */
  sent: boolean;
  /** Withdrawn before Pi was given it. */
  withdrawn: boolean;
  /** A withdrawal waiting for the worker to say whether it still held it. */
  withdrawal?: { result: Promise<void>; answer(removed: boolean): void };
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
  /** A Cadence coordinator turn, admitted through the conversation's mode. */
  coordinator: boolean;
  /** Messages admitted into this run, oldest first. */
  inputs: LiveInput[];
  /** Hands the run's worker a message; null without a connected worker. */
  worker: ((message: WorkerInput) => boolean) | null;
  /** The worker listens: nothing is handed over before. */
  ready: boolean;
  /** The reply takes no further message: it has ended or never had a worker. */
  ended: boolean;
}

/** What a browser turn's worker streams that Pi has not written yet: the
 * message being generated and the tool running, as bounded previews. */
export class LiveCapture {
  retry: ChatTurn["retry"];
  notice = "";
  activity: ChatActivity = { kind: "waiting", sequence: 0 };
  private readonly unkept = [{ thinking: false, media: false, other: false }];
  private users = 0;
  private readonly messages = new Map<
    string,
    { blocks: Map<number, ChatItem>; ended: boolean }
  >();
  private readonly order: ({ messageId: string } | { callId: string })[] = [];
  private readonly tools = new Map<
    string,
    { item: ChatItem; resultMessageId?: string }
  >();
  private readonly details = new Map<
    string,
    { descriptor: DetailDescriptor; sanitizer: DetailSanitizer; text: string }
  >();
  private imageUser: string | undefined;
  constructor(
    private readonly secrets: () => readonly string[],
    private readonly inputImages = false,
  ) {}
  get omitted(): ChatTurn["omitted"] {
    return this.unkept[this.unkept.length - 1];
  }
  omittedFor(index: number): ChatTurn["omitted"] {
    return (
      this.unkept[index] ?? { thinking: false, media: false, other: false }
    );
  }
  private bounded(value: string): string {
    return Buffer.byteLength(value) <= PREVIEW_BYTES
      ? value
      : `${Buffer.from(value).subarray(0, PREVIEW_BYTES).toString("utf8").replace(/�$/u, "")}${PREVIEW_MARK}`;
  }
  private block(
    messageId: string,
    index: number,
    role: ChatItem["role"],
  ): ChatItem | undefined {
    const message = this.messages.get(messageId);
    if (!message) return undefined;
    let item = message.blocks.get(index);
    if (!item) {
      item = {
        id: `${messageId}:${index}`,
        renderId: `capture:${messageId}:${index}`,
        role,
        text: "",
        name: "",
        args: "",
        error: false,
        state: role === "tool" ? "pending" : "streaming",
      };
      message.blocks.set(index, item);
    }
    return item;
  }
  private tool(callId: string) {
    let tool = this.tools.get(callId);
    if (!tool) {
      tool = {
        item: {
          id: callId,
          renderId: `call:${callId}`,
          role: "tool",
          name: "",
          args: "",
          text: "",
          error: false,
          state: "pending",
        },
      };
      this.tools.set(callId, tool);
      const stale = [...this.tools.values()].at(-1 - RECENT_PREVIEWS);
      if (stale) stale.item.args = stale.item.text = "";
    }
    return tool;
  }
  accept(frame: CaptureFrame): void {
    const e = frame.event;
    const activity = (kind: ChatActivity["kind"], name?: string) => {
      this.activity = {
        kind,
        sequence: frame.workerSeq,
        ...(name === undefined ? {} : { name }),
      };
    };
    if (e.kind === "message-start" && e.role === "user") {
      if (this.users++)
        this.unkept.push({ thinking: false, media: false, other: false });
      else if (this.inputImages) this.imageUser = e.messageId;
    } else if (e.kind === "message-start" && e.role === "assistant") {
      if (!this.messages.has(e.messageId)) {
        this.messages.set(e.messageId, { blocks: new Map(), ended: false });
        this.order.push({ messageId: e.messageId });
        // Retain bounded recent bodies only; identities survive until the run ends.
        const stale = [...this.messages.values()].at(-1 - RECENT_PREVIEWS);
        if (stale)
          for (const item of stale.blocks.values()) item.text = item.args = "";
      }
    } else if (e.kind === "message-start" && e.role === "tool-result") {
      // The adapter proved this join using private source identities. Consume
      // it even if the result has no readable body; never rejoin display names.
      const tool = e.resultCallId ? this.tools.get(e.resultCallId) : undefined;
      if (tool) tool.resultMessageId = e.messageId;
    } else if (e.kind === "thinking-activity") {
      const item = this.block(e.messageId, e.index, "thinking");
      if (item)
        item.state =
          e.phase === "active"
            ? "streaming"
            : e.phase === "complete"
              ? "completed"
              : "unavailable";
      activity(e.phase === "active" ? "thinking" : "waiting");
    } else if (e.kind === "call-declaration") {
      const tool = this.tool(e.callId);
      const item = this.block(e.declaration.messageId, e.index, "tool");
      if (item && item !== tool.item) {
        const { id, renderId } = item;
        Object.assign(item, tool.item, { id, renderId });
        tool.item = item;
      }
      tool.item.name = clipText(sanitizeText(e.name, this.secrets()), 128);
    } else if (e.kind === "tool-start" || e.kind === "tool-end") {
      const tool = this.tool(e.callId);
      tool.item.name = clipText(sanitizeText(e.name, this.secrets()), 128);
      if (
        !e.declaration &&
        !this.order.some((row) => "callId" in row && row.callId === e.callId)
      )
        this.order.push({ callId: e.callId });
      tool.item.state =
        e.kind === "tool-start"
          ? "running"
          : e.isError
            ? "failed"
            : "completed";
      if (e.kind === "tool-end") tool.item.error = e.isError;
      activity(
        e.kind === "tool-start" ? "tool" : "waiting",
        e.kind === "tool-start" ? tool.item.name : undefined,
      );
    } else if (e.kind === "tool-update") {
      activity("tool", this.tool(e.callId).item.name);
    } else if (e.kind === "detail-begin") {
      const o = e.descriptor.owner;
      // Aggregated final text exists for old transcript consumers, not this timeline.
      if (
        o.kind === "context" ||
        o.kind === "handoff" ||
        o.kind === "message-final"
      )
        return;
      if (this.details.size >= 64) return;
      this.details.set(e.detailId, {
        descriptor: e.descriptor,
        sanitizer: new DetailSanitizer(e.descriptor.encoding, this.secrets()),
        text: "",
      });
      if (o.kind === "message") this.block(o.messageId, o.index, "assistant");
    } else if (e.kind === "detail-chunk" || e.kind === "detail-end") {
      const d = this.details.get(e.detailId);
      if (!d) return;
      const added =
        e.kind === "detail-chunk"
          ? d.sanitizer.write(e.text)
          : d.sanitizer.end();
      if (Buffer.byteLength(d.text) <= PREVIEW_BYTES) d.text += added;
      const o = d.descriptor.owner;
      if (
        o.kind === "message" &&
        (o.stage === "stream" || e.kind === "detail-end")
      ) {
        const item = this.block(o.messageId, o.index, "assistant");
        if (item) {
          item.text = this.bounded(d.text);
          activity("text");
        }
      } else if (o.kind === "tool" && e.kind === "detail-end") {
        const tool = this.tool(o.callId).item;
        if (o.stage === "execution-arguments" || o.stage === "arguments-final")
          tool.args = this.bounded(d.text);
        if (o.stage === "result" || o.stage === "update-snapshot") {
          // Each update is a complete replacement, not another output fragment.
          let text = d.text;
          if (d.descriptor.encoding === "canonical-json") {
            try {
              const value = JSON.parse(d.text);
              text = Array.isArray(value.content)
                ? value.content
                    .filter(
                      (b: { type?: string; text?: unknown }) =>
                        b.type === "text" && typeof b.text === "string",
                    )
                    .map((b: { text: string }) => b.text)
                    .join("\n\n")
                : "";
            } catch {
              /* A clipped snapshot remains an explicitly bounded preview. */
            }
          }
          tool.text = this.bounded(text);
        }
      }
      if (e.kind === "detail-end") this.details.delete(e.detailId);
    } else if (e.kind === "message-end") {
      const message = this.messages.get(e.messageId);
      if (message) {
        message.ended = true;
        for (const [index, item] of message.blocks) {
          if (index >= e.finalBlockCount && item.role !== "thinking") {
            message.blocks.delete(index);
            continue;
          }
          if (item.role === "assistant") {
            item.error = ["error", "aborted", "length"].includes(e.stopReason);
            item.state =
              e.stopReason === "aborted"
                ? "canceled"
                : item.error
                  ? "failed"
                  : "completed";
          } else if (
            item.role === "thinking" &&
            (item.state === "streaming" ||
              ["error", "aborted"].includes(e.stopReason))
          )
            item.state = "unavailable";
          else if (
            item.role === "tool" &&
            item.state === "pending" &&
            ["error", "aborted", "length"].includes(e.stopReason)
          )
            item.state =
              e.stopReason === "aborted" ? "canceled" : "unavailable";
        }
        activity("waiting");
      }
    } else if (e.kind === "model-retry") {
      this.retry = e.progress ?? undefined;
      activity("waiting");
    } else if (e.kind === "worker-failure") {
      this.retry = undefined;
      this.notice = `worker-failure: ${e.code}`;
      for (const message of this.messages.values())
        for (const item of message.blocks.values())
          if (["streaming", "running", "pending"].includes(item.state ?? ""))
            item.state = "unavailable";
      for (const { item } of this.tools.values())
        if (["running", "pending"].includes(item.state ?? ""))
          item.state = "unavailable";
      activity("waiting");
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
    ) {
      this.omitted[OMITTED_FLAG[e.block.reason]] = true;
    }
  }
  /** Only explicit durable identities suppress previews (even invisible messages).
   * The reader withholds the unmarked Pi tail, so durable-before-marker cannot
   * briefly show both copies. Earlier turns are never joined by text or count. */
  extend(
    items: ChatItem[],
    earlier: readonly ChatItem[] = [],
    writtenMessages: readonly string[] = [],
  ): { items: ChatItem[]; stable: number } {
    const out = items.map((item) => ({ ...item }));
    const written = new Set(writtenMessages);
    const previous = new Set(earlier.map((item) => item.renderId));
    const changing = out.findIndex((item) =>
      ["pending", "running", "streaming"].includes(item.state ?? ""),
    );
    let stable = changing < 0 ? out.length : changing;
    for (const tool of this.tools.values()) {
      const matches = out.filter(
        (item) => item.role === "tool" && item.renderId === tool.item.renderId,
      );
      if (matches.length !== 1) continue;
      const item = matches[0];
      if (item.state !== "pending" && item.state !== "running") continue;
      item.text = tool.item.text;
      item.args = tool.item.args || item.args;
      item.state = tool.item.state;
      item.error = tool.item.error;
      stable = Math.min(stable, out.indexOf(item));
    }
    for (const row of this.order) {
      if ("messageId" in row && written.has(row.messageId)) continue;
      if ("callId" in row) {
        const result = this.tools.get(row.callId)?.resultMessageId;
        if (result && written.has(result)) continue;
      }
      const blocks =
        "messageId" in row
          ? [...(this.messages.get(row.messageId)?.blocks.entries() ?? [])]
              .sort(([a], [b]) => a - b)
              .map(([, item]) => item)
          : [this.tool(row.callId).item];
      for (const item of blocks) {
        if (
          previous.has(item.renderId) ||
          out.some((existing) => existing.renderId === item.renderId)
        )
          continue;
        stable = Math.min(stable, out.length);
        out.push({ ...item });
      }
    }
    return { items: out, stable };
  }
}

export class Conversations {
  readonly records: ConversationRecords;
  readonly contexts: ConversationContexts;
  private readonly active = new Map<string, LiveTurn>();
  /** The messages of every live run, by their own command. */
  private readonly inputs = new Map<string, LiveInput>();
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
          : isLiveChatStatus(live.state.status)
            ? live.state.status
            : "settling",
      }),
    );
  }
  constructor(private readonly o: Options) {
    this.records = new ConversationRecords({
      ...o,
      assertCurrent: () => o.owner.lease.assert(),
      active: this.active,
      inputs: this.inputs,
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
  /** Startup refuses while a browser message's native closure is unconfirmed:
   * its worker may still write to the session. A message the previous owner's
   * death interrupted (still starting, queued or running) does not refuse: host
   * startup has already stopped that owner's workers by exact identity, and the
   * reader reports the reply as interrupted. A session's newest command may be
   * a message sent into a reply: that reply's closure counts for it. */
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
  private command<C extends Send | Input>(input: C, reply = false): C {
    return {
      ...input,
      text: reply ? "exit cadence" : sanitizeText(input.text, this.o.secrets()),
    };
  }
  /** A lost reply observes its original acceptance; it never admits again.
   * Any caller-side freshness check must come after this lookup. */
  receipt(input: Send | Input, reply = false): WorkbenchResult | undefined {
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
    afterAccept?: () => void,
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
      coordinator: !!control,
      inputs: [],
      worker: null,
      ready: false,
      // A control reply has no worker to take a message.
      ended: !!control?.reply,
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
        status: control ? "queued" : "starting",
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
      afterAccept?.();
    } catch (error) {
      abort.abort();
      begin();
      throw error;
    }
    begin();
    return { kind: "accepted", commandId: input.commandId };
  }
  /** The live run a command names, for the owner epoch it was observed in. */
  private running(request: Input | InputCancel): LiveTurn {
    const live = this.active.get(request.turnId);
    if (!live)
      throw new ContractError(
        this.records.hasCommand(request.conversationId, request.turnId)
          ? "stale"
          : "invalid",
      );
    if (
      live.accepted.session !== request.conversationId ||
      live.epoch !== request.epoch
    )
      throw new ContractError("stale");
    return live;
  }
  /** Hands the worker every admitted message it has not been given. */
  private dispatch(live: LiveTurn): void {
    if (!live.ready || !live.worker) return;
    for (const input of live.inputs)
      if (!input.sent && !input.withdrawn)
        input.sent = live.worker({
          kind: "input",
          id: input.commandId,
          mode: input.accepted.command.mode,
          text: input.accepted.command.text,
        });
  }
  /** Admits a message into a reply that is running. It is recorded like a
   * Send before the run's worker is told; that worker alone gives it to Pi,
   * and nothing about it outlives the worker, so nothing can be replayed.
   * `coordinator` is whether the conversation is in Cadence mode: a message
   * joins only the kind of run that mode admits. */
  input(
    request: Input,
    coordinator: boolean,
    beforeAccept?: () => void,
  ): WorkbenchResult {
    this.o.owner.lease.assert();
    const command = this.command(request);
    const receipt = this.receipt(request);
    if (receipt) return receipt;
    if (
      this.files.directory(
        dirname(this.records.path(request.commandId, "state.json")),
      )
    )
      throw new ContractError("corrupt-selected");
    if (this.o.owner.state !== "idle") throw new ContractError("quarantine");
    const live = this.running(request);
    // A reply that is being stopped or has ended takes nothing further.
    if (live.abort.signal.aborted || live.ended)
      throw new ContractError("stale");
    if (live.coordinator !== coordinator) throw new ContractError("conflict");
    if (!command.text.trim()) throw new ContractError("invalid");
    const session = this.records.sessions.session(request.conversationId);
    if (
      live.inputs.length >= RUN_INPUTS ||
      live.inputs.filter(
        (input) => !input.withdrawn && !session?.delivered(input.commandId),
      ).length >= WAITING_INPUTS
    )
      throw new ContractError("capacity");
    const space = statfsSync(this.o.coordination.directory);
    if (space.bavail * space.bsize < LIMITS.freeSpaceFloorBytes)
      throw new ContractError("capacity");
    const index = this.records.index(request.conversationId);
    const accepted = {
      execution: live.accepted.execution,
      directory: live.accepted.directory,
      file: live.accepted.file,
      command,
      at: Date.now(),
      session: request.conversationId,
      parent: null,
      offset: session?.read?.size ?? 0,
    };
    const state: CommandState = {
      status: "queued",
      notice: "",
      omitted: { thinking: false, media: false, other: false },
      user: null,
    };
    // Beyond this point even a failed write is uncertain.
    beforeAccept?.();
    this.write(this.records.path(request.commandId, "accepted.json"), accepted);
    const input: LiveInput = {
      commandId: request.commandId,
      accepted,
      state,
      stateFile: this.write(
        this.records.path(request.commandId, "state.json"),
        state,
      ),
      sent: false,
      withdrawn: false,
    };
    this.write(
      this.records.indexPath(request.conversationId),
      {
        schema: "cadence-session-commands/1",
        id: request.conversationId,
        commands: [...index.commands, request.commandId].slice(
          -INDEXED_COMMANDS,
        ),
      },
      META_BYTES,
      index.file,
    );
    // Durably accepted: only now may the worker learn of it.
    live.inputs.push(input);
    this.inputs.set(input.commandId, input);
    this.dispatch(live);
    return { kind: "accepted", commandId: request.commandId };
  }
  /** Records that a message was withdrawn before Pi was given it. */
  private withdraw(input: LiveInput): void {
    const state: CommandState = {
      ...input.state,
      status: "canceled",
      notice: WITHDRAWN,
    };
    input.stateFile = this.write(
      this.records.path(input.commandId, "state.json"),
      state,
      META_BYTES,
      input.stateFile,
    );
    input.state = state;
    input.withdrawn = true;
  }
  /** Withdraws a message Pi has not been given. One the worker already holds
   * is withdrawn only when the worker confirms it was still waiting; one Pi
   * has, or a reply that has ended, refuses without changing anything. */
  cancelInput(
    request: InputCancel,
  ): WorkbenchResult | Promise<WorkbenchResult> {
    this.o.owner.lease.assert();
    if (this.o.owner.state !== "idle") throw new ContractError("quarantine");
    const live = this.running(request);
    const input = live.inputs.find((i) => i.commandId === request.inputId);
    if (!input) throw new ContractError("invalid");
    const accepted: WorkbenchResult = {
      kind: "accepted",
      commandId: request.commandId,
    };
    if (input.withdrawn) return accepted;
    if (!input.sent) {
      this.withdraw(input);
      return accepted;
    }
    // One question to the worker, however many requests wait for its answer.
    let waiting = input.withdrawal;
    if (!waiting) {
      let answer!: (removed: boolean) => void;
      const result = new Promise<void>((resolve, reject) => {
        answer = (removed) => {
          input.withdrawal = undefined;
          try {
            if (!removed) throw new ContractError("conflict");
            this.withdraw(input);
            resolve();
          } catch (error) {
            reject(error);
          }
        };
      });
      // A lost reply leaves this unobserved.
      result.catch(() => {});
      waiting = input.withdrawal = { result, answer };
      if (
        live.ended ||
        !live.worker?.({ kind: "input-cancel", id: input.commandId })
      )
        answer(false);
    }
    return waiting.result.then(() => accepted);
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
  /** Stops a run. It is named by its own command: a message sent into it has
   * no worker of its own to stop. */
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
    const current = () =>
      !abort.signal.aborted &&
      this.o.owner.state === "idle" &&
      this.currentDirectory(live.execution.cwd);
    try {
      this.o.owner.lease.assert();
      if (!current()) throw new ContractError("stale");
      if (control?.reply) {
        state.status = "completed";
        state.notice = control.reply;
        return { status: "settled" };
      }
      const selected = live.execution.model;
      if (!selected) throw new ContractError("stale");
      this.o.models.assertCurrent(selected);
      const instructions = control
        ? control.instructions
        : "Ordinary conversation.";
      const context = control
        ? control.context
          ? control.context(live.execution)
          : conversationContextLine(live.execution)
        : "";
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
        context,
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
      this.save(live);
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
            inputs: {
              open: (send) => {
                live.worker = send;
              },
              withdrawn: (id, removed) =>
                live.inputs
                  .find((input) => input.commandId === id)
                  ?.withdrawal?.answer(removed),
            },
            maySignal: this.maySignal,
            onNative: (value) => {
              native = value;
            },
            onFrame: (frame, secrets) => {
              credentials = secrets;
              capture.accept(frame);
              // The worker listens from its ready frame and takes nothing
              // after its final one.
              if (frame.event.kind === "ready") {
                live.ready = true;
                this.dispatch(live);
              } else if (frame.event.kind === "final") live.ended = true;
            },
          },
        ),
      );
      const tracked = running.then(() => native);
      this.o.owner.trackConversationProcess(tracked, () =>
        abort.abort({ source: "service", reason: "stop", target: commandId }),
      );
      const result = await running;
      live.ended = true;
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
      // No worker is left to take a message or to answer a withdrawal.
      live.ended = true;
      live.worker = null;
      for (const input of live.inputs) input.withdrawal?.answer(false);
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
        }
        this.settle(live, uncertain);
      } catch {
        uncertain = true;
      }
      if (uncertain) this.o.owner.quarantine();
      for (const input of live.inputs) this.inputs.delete(input.commandId);
      this.active.delete(commandId);
    }
    return { status: uncertain ? "uncertain" : "settled" };
  }
  private save(live: LiveTurn): void {
    if (!live.stateFile) throw new ContractError("corrupt-selected");
    live.stateFile = this.write(
      this.records.path(live.commandId, "state.json"),
      live.state,
      META_BYTES,
      live.stateFile,
    );
  }
  /** Records how a run's messages ended, once its worker has. What Pi wrote
   * says which of them it was given: each has its user entry, the newest
   * takes the run's outcome and the earlier ones end as Pi recorded their
   * replies. A message Pi was never given is recorded as not delivered, and
   * an unknown closure leaves every one of them unknown. */
  private settle(live: LiveTurn, uncertain: boolean): void {
    const { accepted, commandId } = live;
    const inputs = live.inputs.filter((input) => !input.withdrawn);
    let parts: { commandId: string; entries: SessionEntry[] }[] | undefined;
    try {
      parts =
        this.records.sessions.session(accepted.session)?.runEntries(
          { commandId, parent: accepted.parent, offset: accepted.offset },
          inputs.map((input) => ({
            commandId: input.commandId,
            offset: input.accepted.offset,
          })),
        ) ?? [];
    } catch {
      // An unreadable session leaves the messages' entries unknown, not lost.
    }
    const outcome = { status: live.state.status, notice: live.state.notice };
    const newest = parts?.at(-1)?.commandId ?? commandId;
    for (const message of [live, ...inputs]) {
      const at =
        parts?.findIndex((part) => part.commandId === message.commandId) ?? -1;
      const part = parts?.[at];
      const ended: Pick<CommandState, "status" | "notice"> = uncertain
        ? { status: "unknown", notice: outcome.notice }
        : message.commandId === newest
          ? outcome
          : part
            ? { status: replyStatus(part.entries), notice: "" }
            : parts
              ? { status: "canceled", notice: NOT_DELIVERED }
              : { status: "failed", notice: UNOBSERVED };
      Object.assign(message.state, ended, {
        user: part?.entries[0]?.id ?? null,
      });
      // The capture numbers its flags as Pi was given the messages.
      const given = message === live ? 0 : at;
      if (live.capture && given >= 0)
        message.state.omitted = { ...live.capture.omittedFor(given) };
    }
    for (const input of inputs)
      input.stateFile = this.write(
        this.records.path(input.commandId, "state.json"),
        input.state,
        META_BYTES,
        input.stateFile,
      );
    this.save(live);
  }
}
