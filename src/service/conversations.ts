/** Ordinary and Cadence conversations, which are the project's Pi sessions:
 * the terminal and the browser read and continue the same session files.
 * Pi (the browser turn's SDK worker) writes the content; this owner keeps only
 * each browser message's admission record and reads the sessions back. */
import { randomUUID } from "node:crypto";
import { lstatSync, opendirSync, realpathSync, statfsSync } from "node:fs";
import { dirname, join } from "node:path";
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
  oneOf,
  parseWireJson,
  text,
} from "./contracts/core.ts";
import {
  type ChatAttempt,
  type ChatCursor,
  type ChatItem,
  type ChatStatus,
  type ChatSummary,
  type ChatTurn,
  decodeEntryId,
  decodeSessionId,
  decodeWorkbenchCommand,
  STEP_READ,
  type WorkbenchCommand,
  type WorkbenchResult,
} from "./contracts/workbench.ts";
import type { ServiceCoordination } from "./coordination.ts";
import type { OwnerModelChoice } from "./model-choice.ts";
import type { OwnerModelContext } from "./model-context.ts";
import type { AcceptedWorkResult, ServiceOwner } from "./owner.ts";
import {
  type BuiltTurn,
  listTurn,
  type ParsedSession,
  PiSessions,
  type SessionEntry,
  sessionDirectory,
  summaryTitle,
  turnItems,
  turnSpans,
} from "./pi-sessions.ts";
import { type FileSnapshot, hash } from "./private-files.ts";

const META_BYTES = 64 * 1024;
const PAGE = 50;
/** Browser messages a session's index names: enough to find the latest attempt
 * and the statuses Pi's file cannot record; older ones read from the file. */
const INDEXED_COMMANDS = 64;
const COMMAND_STATES = 512; // Read cache only.
/** Text one live preview keeps per item; the full item is read from the
 * session once Pi has written it. */
const PREVIEW_BYTES = 64 * 1024;
/** Streamed items a preview keeps text for; earlier ones are in the session. */
const RECENT_PREVIEWS = 8;
const PREVIEW_MARK =
  "\n[Preview truncated; the rest appears once it is written.]";
const INTERRUPTED =
  "Interrupted: Cadence stopped before this reply finished. Nothing was replayed; send the message again to retry.";
const OMITTED_FLAG = {
  "hidden-thinking": "thinking",
  binary: "media",
  unsupported: "other",
} as const satisfies Record<string, keyof ChatTurn["omitted"]>;
const LIVE: ChatStatus[] = ["queued", "running"];

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

/** A browser message's durable admission: what was sent, where from. */
interface Accepted {
  command: Send;
  at: number;
  session: string;
  /** The entry it continues (null: a new session or a new root). */
  parent: string | null;
  /** The session file's size when it was accepted; Pi appends after it. */
  offset: number;
}
/** How the message ended, beside the entries Pi wrote for it. */
interface CommandState {
  status: ChatStatus;
  notice: string;
  omitted: ChatTurn["omitted"];
  /** The user message entry Pi wrote for it, null when none was written. */
  user: string | null;
}
interface LiveTurn {
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
  readonly omitted = { thinking: false, media: false, other: false };
  notice = "";
  private readonly assistants: { id: string; text: string }[] = [];
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
  constructor(private readonly secrets: () => readonly string[]) {}
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
    if (e.kind === "message-start" && e.role === "assistant") {
      if (!this.assistants.some((a) => a.id === e.messageId)) {
        this.assistants.push({ id: e.messageId, text: "" });
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
      for (const [id, block] of this.blocks)
        if (block.messageId === e.messageId) this.blocks.delete(id);
    } else if (e.kind === "worker-failure")
      this.notice = `worker-failure: ${e.code}`;
    else if (
      e.kind === "omitted-block" &&
      e.block.owner.kind !== "context" &&
      e.block.owner.kind !== "handoff"
    )
      // A flag, not a notice line: it must never displace a failure reason.
      this.omitted[OMITTED_FLAG[e.block.reason]] = true;
  }
  /** The written items extended by what Pi has not written yet. Pi writes each
   * message when it ends, in the order the worker streamed them, so the
   * written assistant messages and tool results are counted, not matched. */
  extend(items: ChatItem[]): { items: ChatItem[]; stable: number } {
    const out = items.map((item) => ({ ...item }));
    const written = out.filter((i) => i.role === "assistant").length;
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
        error: false,
      });
    });
    return { items: out, stable };
  }
}

function decodeAccepted(value: unknown): Accepted {
  const o = closed(value, ["command", "at", "session", "parent", "offset"]);
  const command = decodeWorkbenchCommand(o.command);
  if (command.kind !== "send") throw new ContractError("corrupt-selected");
  return {
    command,
    at: integer(o.at, 0),
    session: decodeSessionId(o.session),
    parent: o.parent === null ? null : decodeEntryId(o.parent),
    offset: integer(o.offset, 0),
  };
}
const statuses: ChatStatus[] = [
  "queued",
  "running",
  "completed",
  "failed",
  "canceled",
  "timeout",
  "unknown",
];
function decodeState(value: unknown): CommandState {
  const o = closed(value, ["status", "notice", "omitted", "user"]);
  const omitted = closed(o.omitted, ["thinking", "media", "other"]);
  return {
    status: oneOf(o.status, statuses),
    notice: text(o.notice, 4096),
    omitted: {
      thinking: omitted.thinking === true,
      media: omitted.media === true,
      other: omitted.other === true,
    },
    user: o.user === null ? null : decodeEntryId(o.user),
  };
}

export class Conversations {
  private readonly root: string;
  private readonly legacy: string;
  readonly cwd: string;
  readonly sessions: PiSessions;
  private readonly active = new Map<string, LiveTurn>();
  private knownSecrets: readonly string[] | undefined;
  private readonly states = new Map<
    string,
    { key: string; state: CommandState }
  >();
  constructor(private readonly o: Options) {
    this.root = join(o.coordination.directory, "conversation-commands-v1");
    this.legacy = join(o.coordination.directory, "conversations-v1");
    this.cwd = realpathSync(o.cwd);
    this.sessions = new PiSessions(
      o.sessionDir ?? sessionDirectory(this.cwd, o.agentDir),
      this.cwd,
    );
  }
  /** Redaction literals for what this owner returns from the sessions: the
   * current set, else the last one observed while the model configuration is
   * being reloaded or edited. Without any, nothing is returned unredacted. */
  private readSecrets(): readonly string[] {
    try {
      this.knownSecrets = this.o.secrets();
    } catch (error) {
      if (!this.knownSecrets)
        throw error instanceof ContractError
          ? error
          : new ContractError("unavailable");
    }
    return this.knownSecrets;
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
  private path(commandId: string, name: string) {
    return join(this.root, "commands", decodeId(commandId), name);
  }
  private indexPath(id: string) {
    return join(this.root, "sessions", `${decodeSessionId(id)}.json`);
  }
  private read(path: string, max = META_BYTES): unknown | undefined {
    const value = this.files.read(path, max);
    return value ? parseWireJson(value.bytes.toString("utf8"), max) : undefined;
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
  /** The browser messages recorded for a session, oldest first. */
  private index(id: string): { file?: FileSnapshot; commands: string[] } {
    const file = this.files.read(this.indexPath(id), META_BYTES);
    if (!file) return { commands: [] };
    const o = closed(parseWireJson(file.bytes.toString("utf8"), META_BYTES), [
      "schema",
      "id",
      "commands",
    ]);
    if (o.schema !== "cadence-session-commands/1" || o.id !== id)
      throw new ContractError("corrupt-selected");
    return { file, commands: list(o.commands, INDEXED_COMMANDS, decodeId) };
  }
  private accepted(commandId: string): Accepted | undefined {
    const value = this.read(this.path(commandId, "accepted.json"));
    return value === undefined ? undefined : decodeAccepted(value);
  }
  private state(commandId: string): CommandState {
    const live = this.active.get(commandId);
    if (live) return live.state;
    const path = this.path(commandId, "state.json");
    const key = observedFile(path);
    const hit = this.states.get(commandId);
    if (hit?.key === key) return hit.state;
    const value = this.read(path);
    if (value === undefined) throw new ContractError("corrupt-selected");
    const decoded = decodeState(value);
    // Work that was queued or running when the owner stopped did not finish
    // here; it is never resumed or reported complete.
    const state = LIVE.includes(decoded.status)
      ? { ...decoded, status: "unknown" as const, notice: INTERRUPTED }
      : decoded;
    if (this.states.size >= COMMAND_STATES) this.states.clear();
    this.states.set(commandId, { key, state });
    return state;
  }
  private liveFor(id: string): LiveTurn | undefined {
    for (const live of this.active.values())
      if (live.accepted.session === id) return live;
    return undefined;
  }
  controlBound(id: string): boolean {
    const value = this.read(this.controlPath(id));
    if (value === undefined) return false;
    const record = closed(value, ["schema", "conversationId"]);
    if (
      record.schema !== "cadence-conversation-control/1" ||
      record.conversationId !== id
    )
      throw new ContractError("corrupt-selected");
    return true;
  }
  private controlPath(id: string) {
    return join(this.legacy, "control-links", `${decodeSessionId(id)}.json`);
  }
  /** Cheap observation key for a control link; not a validation. */
  controlKey(id: string): string {
    return observedFile(this.controlPath(id));
  }
  bindControl(id: string): void {
    if (!this.controlBound(id))
      this.write(this.controlPath(id), {
        schema: "cadence-conversation-control/1",
        conversationId: id,
      });
  }
  /** Whether this browser message was accepted for this session. */
  hasCommand(id: string, commandId: string): boolean {
    return this.accepted(commandId)?.session === id;
  }
  /** The browser's last message to this session and how it stands. */
  latestCommand(id: string): { commandId: string; status: ChatStatus } | null {
    this.o.owner.lease.assert();
    const commandId = this.index(id).commands.at(-1);
    return commandId
      ? { commandId, status: this.state(commandId).status }
      : null;
  }
  /** Sessions the terminal started these workflows in, from its mode records. */
  nativeLinks(
    runIds: readonly string[],
  ): { runId: string; conversationId: string }[] {
    if (!runIds.length) return [];
    const recorded = this.sessions.nativeRuns();
    return runIds.flatMap((runId) => {
      const conversationId = recorded.get(runId);
      return conversationId ? [{ runId, conversationId }] : [];
    });
  }
  private summary(id: string, live: LiveTurn | undefined): ChatSummary | null {
    const listed = this.sessions.find(id);
    const secrets = this.readSecrets();
    if (!listed) {
      if (!live) return null;
      return {
        id,
        title: live.title,
        leaf: null,
        status: live.state.status,
        updatedAt: live.accepted.at,
        origin: "webui",
        live: { commandId: live.commandId, epoch: live.epoch },
      };
    }
    const s = listed.summary;
    return {
      id,
      title: text(
        [...sanitizeText(summaryTitle(s), secrets)].slice(0, 100).join("") ||
          "Conversation",
        512,
        true,
      ),
      leaf: s.leaf,
      status: live?.state.status ?? s.stop?.status ?? "completed",
      updatedAt: Math.max(Math.trunc(listed.mtimeMs), live?.accepted.at ?? 0),
      origin: s.webui ? "webui" : "terminal",
      ...(live
        ? { live: { commandId: live.commandId, epoch: live.epoch } }
        : {}),
    };
  }
  list(after: ChatCursor | null = null): WorkbenchResult {
    this.o.owner.lease.assert();
    const listed = this.sessions.list();
    let start = 0;
    if (after) {
      start = listed.findIndex(
        (l) =>
          Math.trunc(l.mtimeMs) < after.updatedAt ||
          (Math.trunc(l.mtimeMs) === after.updatedAt &&
            l.summary.id > after.id),
      );
      if (start < 0) start = listed.length;
    }
    const page = listed.slice(start, start + PAGE);
    const entries = page.flatMap((l) => {
      const summary = this.summary(l.summary.id, this.liveFor(l.summary.id));
      return summary ? [summary] : [];
    });
    const last = page.at(-1);
    return {
      kind: "conversations",
      entries,
      next:
        last && start + PAGE < listed.length
          ? { id: last.summary.id, updatedAt: Math.trunc(last.mtimeMs) }
          : null,
    };
  }
  activeConversations(): WorkbenchResult & { kind: "conversation-active" } {
    this.o.owner.lease.assert();
    return {
      kind: "conversation-active",
      entries: [...this.active.values()].flatMap((live) => {
        const summary = this.summary(live.accepted.session, live);
        return summary ? [summary] : [];
      }),
    };
  }
  /** Startup refuses while a browser message's closure is unknown: its worker
   * may still write to the session. Interrupted ones are reported as such. */
  assertSettled(): void {
    this.o.owner.lease.assert();
    const sessions = join(this.root, "sessions");
    if (!this.files.directory(sessions)) return;
    const dir = opendirSync(sessions);
    try {
      for (let e = dir.readSync(); e; e = dir.readSync()) {
        if (!e.isFile() || !e.name.endsWith(".json"))
          throw new ContractError("corrupt-selected");
        const latest = this.index(
          decodeSessionId(e.name.slice(0, -5)),
        ).commands.at(-1);
        if (latest && this.state(latest).status === "unknown")
          throw new ContractError("quarantine");
      }
    } finally {
      dir.closeSync();
    }
  }
  /** The branch a read shows and whether the live browser turn ends it. */
  private branch(
    id: string,
    leaf: string | null,
    exact: boolean,
  ): {
    session: ParsedSession | undefined;
    leaf: string | null;
    turns: SessionEntry[][];
    live: LiveTurn | undefined;
  } {
    const session = this.sessions.session(id);
    const running = this.liveFor(id);
    let view: string | null;
    if (exact || leaf !== null) {
      if (leaf !== null && !session?.byId.has(leaf))
        throw new ContractError("stale");
      view = leaf;
    } else
      view = running ? running.accepted.parent : (session?.current() ?? null);
    const turns = session ? turnSpans(session.branch(view)) : [];
    const live =
      running && running.accepted.parent === view ? running : undefined;
    return { session, leaf: view, turns, live };
  }
  /** The latest settled browser message that left nothing in the session and
   * was sent from this branch's end. */
  private attempt(id: string, leaf: string | null): ChatAttempt | null {
    const commandId = this.index(id).commands.at(-1);
    if (!commandId || this.active.has(commandId)) return null;
    const accepted = this.accepted(commandId);
    const state = this.state(commandId);
    if (!accepted || state.user !== null || accepted.parent !== leaf)
      return null;
    if (state.status === "unknown") {
      // An interrupted message may still have reached the session.
      const session = this.sessions.session(id);
      if (
        session?.chain(accepted.parent, accepted.offset, accepted.command.text)
          .length
      )
        return null;
    }
    return {
      commandId,
      text: accepted.command.text,
      status: state.status,
      notice: state.notice,
    };
  }
  /** The conversation's summary and the branch a viewer polls. */
  conversation(
    id: string,
    leaf: string | null,
    known: string | null,
  ): WorkbenchResult {
    this.o.owner.lease.assert();
    const view = this.branch(id, leaf, false);
    const summary = this.summary(id, view.live ?? this.liveFor(id));
    const listed = this.sessions.find(id);
    return {
      kind: "conversation",
      summary,
      leaf: view.leaf,
      continues:
        known === null ||
        known === view.leaf ||
        !!view.session?.contains(view.leaf, known),
      turns: summary ? view.turns.length + (view.live ? 1 : 0) : 0,
      branches: view.session?.leaves() ?? 0,
      runs: listed?.summary.runs ?? [],
      attempt: view.live ? null : this.attempt(id, view.leaf),
    };
  }
  /** User messages of the whole session tree, for choosing a branch. */
  tree(id: string, leaf: string | null): WorkbenchResult {
    this.o.owner.lease.assert();
    const view = this.branch(id, leaf, false);
    return {
      kind: "conversation-tree",
      conversationId: id,
      ...(view.session?.tree(view.leaf, this.readSecrets()) ?? {
        nodes: [],
        truncated: false,
      }),
    };
  }
  /** Statuses Pi cannot record for the browser's own messages, by user entry. */
  private overlay(id: string, session: ParsedSession | undefined) {
    const out = new Map<string, CommandState>();
    for (const commandId of this.index(id).commands) {
      if (this.active.has(commandId)) continue;
      const state = this.state(commandId);
      if (state.status === "completed" && !state.notice) continue;
      let user = state.user;
      if (user === null && state.status === "unknown" && session) {
        const accepted = this.accepted(commandId);
        user = accepted
          ? (session.chain(
              accepted.parent,
              accepted.offset,
              accepted.command.text,
            )[0]?.id ?? null)
          : null;
      }
      if (user !== null) out.set(user, state);
    }
    return out;
  }
  private built(
    id: string,
    leaf: string | null,
    ordinal: number,
  ): { turn: BuiltTurn; stable: number } {
    const view = this.branch(id, leaf, true);
    const secrets = this.readSecrets();
    if (ordinal < view.turns.length && view.session) {
      const turn = this.sessions.turn(
        view.session,
        view.turns[ordinal],
        secrets,
      );
      const recorded = this.overlay(id, view.session).get(turn.id);
      return {
        turn: recorded
          ? {
              ...turn,
              status:
                turn.status === "completed" ? recorded.status : turn.status,
              notice: turn.notice || recorded.notice,
              omitted: {
                thinking: turn.omitted.thinking || recorded.omitted.thinking,
                media: turn.omitted.media || recorded.omitted.media,
                other: turn.omitted.other || recorded.omitted.other,
              },
            }
          : turn,
        stable: turn.steps.length,
      };
    }
    const live = view.live;
    if (!live || ordinal !== view.turns.length)
      throw new ContractError("stale");
    const chain = view.session
      ? view.session.chain(
          live.accepted.parent,
          live.accepted.offset,
          live.accepted.command.text,
        )
      : [];
    const written = turnItems(chain, secrets);
    const items = chain.length
      ? written.items
      : [
          {
            id: "user",
            role: "user" as const,
            text: live.accepted.command.text,
            name: "",
            args: "",
            error: false,
          },
        ];
    const extended = live.capture?.extend(items) ?? {
      items,
      stable: items.length,
    };
    const omitted = live.capture?.omitted;
    const turn = listTurn({
      id: chain[0]?.id ?? live.commandId,
      entry: null,
      at: live.accepted.at,
      status: live.state.status,
      notice: live.capture?.notice ?? "",
      omitted: {
        thinking: written.omitted.thinking || !!omitted?.thinking,
        media: written.omitted.media || !!omitted?.media,
        other: written.omitted.other || !!omitted?.other,
      },
      items: extended.items,
    });
    return { turn, stable: extended.stable };
  }
  /** One turn by position on a branch, with the steps that end at `before`. */
  turnSteps(
    id: string,
    leaf: string | null,
    ordinal: number,
    before: number | null,
  ): WorkbenchResult {
    this.o.owner.lease.assert();
    const { turn, stable } = this.built(id, leaf, ordinal);
    const end = before ?? turn.steps.length;
    if (end > turn.steps.length) throw new ContractError("stale");
    const start = Math.max(0, end - STEP_READ);
    return {
      kind: "conversation-turn",
      conversationId: id,
      leaf,
      ordinal,
      turn: {
        id: turn.id,
        status: turn.status,
        notice: turn.notice,
        omitted: { ...turn.omitted },
        steps: turn.steps.length,
        stable,
        entry: turn.entry,
        at: turn.at,
      },
      start,
      steps: turn.steps.slice(start, end),
    };
  }
  /** One part of a step's full item. */
  step(
    id: string,
    leaf: string | null,
    turnId: string,
    step: number,
    part: number,
  ): WorkbenchResult {
    this.o.owner.lease.assert();
    const view = this.branch(id, leaf, true);
    const ordinal = view.turns.findIndex((turn) => turn[0]?.id === turnId);
    const { turn } = this.built(
      id,
      leaf,
      ordinal >= 0 ? ordinal : view.turns.length,
    );
    if (turn.id !== turnId) throw new ContractError("stale");
    const item = turn.parts[step]?.[part];
    if (!item || part >= turn.steps[step].parts)
      throw new ContractError("stale");
    return {
      kind: "conversation-step",
      conversationId: id,
      leaf,
      turnId,
      step,
      part,
      item,
    };
  }
  origin(taskId: string): WorkbenchResult & { kind: "task-origin" } {
    this.o.owner.lease.assert();
    const value = this.read(
      join(this.legacy, "task-links", `${decodeId(taskId)}.json`),
    );
    if (value === undefined)
      return { kind: "task-origin", taskId, conversationId: null };
    const row = closed(value, ["conversationId"]);
    return {
      kind: "task-origin",
      taskId,
      conversationId: decodeSessionId(row.conversationId),
    };
  }
  attempted(conversationId: string, commandId: string): boolean {
    this.o.owner.lease.assert();
    return (
      this.active.has(commandId) ||
      this.files.directory(dirname(this.path(commandId, "accepted.json"))) ||
      this.index(conversationId).commands.includes(commandId)
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
    const prior = this.accepted(input.commandId);
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
  ): WorkbenchResult {
    this.o.owner.lease.assert();
    const command = this.command(input, !!control?.reply);
    const receipt = this.receipt(input, !!control?.reply);
    if (receipt) return receipt;
    if (this.files.directory(dirname(this.path(input.commandId, "state.json"))))
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
    // One browser message at a time per session; the terminal may still write.
    if (this.liveFor(input.conversationId)) throw new ContractError("conflict");
    const index = this.index(input.conversationId);
    const session = this.sessions.session(input.conversationId);
    if (input.head !== null && !session?.byId.has(input.head))
      throw new ContractError("stale");
    if (this.active.size >= 8) throw new ContractError("capacity");
    if (!input.text.trim()) throw new ContractError("invalid");
    const space = statfsSync(this.o.coordination.directory);
    if (space.bavail * space.bsize < LIMITS.freeSpaceFloorBytes)
      throw new ContractError("capacity");
    const listed = session
      ? this.sessions.find(input.conversationId)
      : undefined;
    const accepted: Accepted = {
      command,
      at: Date.now(),
      session: input.conversationId,
      parent: input.head,
      offset: session?.read?.size ?? 0,
    };
    const abort = new AbortController();
    // Register original work before the first durable acceptance or asynchronous effect.
    let begin!: () => void;
    const ready = new Promise<void>((resolve) => {
      begin = resolve;
    });
    const live: LiveTurn = {
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
    this.o.owner.trackConversation(live.original, () => abort.abort());
    try {
      this.write(this.path(input.commandId, "accepted.json"), accepted);
      live.stateFile = this.write(
        this.path(input.commandId, "state.json"),
        live.state,
      );
      this.write(
        this.indexPath(input.conversationId),
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
  interrupt(id: string, turnId: string, epoch: string): void {
    this.o.owner.lease.assert();
    const live = this.active.get(turnId);
    if (live) {
      if (live.accepted.session !== id || live.epoch !== epoch)
        throw new ContractError("stale");
      live.abort.abort();
      return;
    }
    if (!this.hasCommand(id, turnId)) throw new ContractError("invalid");
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
        this.path(commandId, "state.json"),
        state,
        META_BYTES,
        live.stateFile,
      );
    };
    const current = () =>
      !abort.signal.aborted &&
      this.o.owner.state === "idle" &&
      this.currentDirectory();
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
      const choice = this.o.choice.snapshot(),
        selected = choice.selected;
      // Access rotation revokes viewers, not already admitted work. The exact
      // selected model/epoch remains pinned while this original is queued.
      if (
        !selected ||
        accepted.command.model.epoch !== choice.version.epoch ||
        accepted.command.model.configRev !== choice.version.configRev ||
        accepted.command.model.catalogId !== choice.version.catalogId
      )
        throw new ContractError("stale");
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
          sha256: hash(control?.instructions ?? "Ordinary conversation."),
        },
        context: "",
        instructions: control?.instructions ?? "Ordinary conversation.",
        prompt: accepted.command.text,
        handoff: { graphRevision: 1, inputs: [] },
      });
      const auth = this.o.models.prepareTracked({
        request,
        operationId: randomUUID(),
        epoch: live.epoch,
        timeoutMs: this.o.timeoutMs ?? LIMITS.workerMs,
        signal: abort.signal,
        current,
        journal: {
          preparation: (value) =>
            this.write(this.path(commandId, "auth-intent.json"), value),
          settlement: (value) =>
            this.write(this.path(commandId, "auth-settled.json"), value),
        },
      });
      authSettled = auth.settled;
      const prepared = await auth.result;
      if (prepared.status !== "prepared" || !current())
        throw new ContractError("auth-unavailable");
      state.status = "running";
      save();
      this.write(this.path(commandId, "launch.json"), {
        epoch: live.epoch,
        childRunId: request.childRunId,
      });
      let credentials: readonly string[] = [];
      const capture = new LiveCapture(() => [
        ...this.readSecrets(),
        ...credentials,
      ]);
      live.capture = capture;
      const existing = this.sessions.find(accepted.session);
      const running = Promise.resolve().then(() =>
        launchConversation(
          prepared.prepared,
          {
            session: {
              id: accepted.session,
              dir: this.sessions.directory,
              file: existing?.path ?? null,
              head: accepted.parent,
            },
            agentDir: this.o.agentDir,
            ...(control ? { coordinator: true as const } : {}),
          },
          abort.signal,
          {
            timeoutMs: this.o.timeoutMs ?? LIMITS.workerMs,
            ownerSecrets: this.o.secrets,
            onCoordinator: control?.onTool,
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
      state.status = result.outcome;
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
      try {
        // Preserve actual process closure even if the final state write fails.
        this.write(this.path(commandId, "native.json"), native);
        if (live.capture) {
          if (state.status !== "completed")
            state.notice ||= live.capture.notice;
          state.omitted = { ...live.capture.omitted };
        }
        try {
          state.user =
            this.sessions
              .session(accepted.session)
              ?.chain(
                accepted.parent,
                accepted.offset,
                accepted.command.text,
              )[0]?.id ?? null;
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
