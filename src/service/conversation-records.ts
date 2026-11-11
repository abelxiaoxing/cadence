/** Shared readonly Pi session and browser-command records. No SDK, execution owner or writes. */
import { lstatSync, opendirSync } from "node:fs";
import { join } from "node:path";
import { sanitizeText } from "../worker-redaction.mjs";
import {
  ContractError,
  closed,
  decodeId,
  integer,
  list,
  oneOf,
  parseWireJson,
  text,
} from "./contracts/core.ts";
import type { ExecutionContext } from "./contracts/models.ts";
import { decodeExecutionContext } from "./contracts/models.ts";
import type { WorkbenchRead } from "./contracts/workbench.ts";
import {
  type ChatAttempt,
  type ChatContext,
  type ChatCursor,
  type ChatPending,
  type ChatStatus,
  type ChatSummary,
  CONVERSATION_NAME_CHARS,
  clipText,
  decodeEntryId,
  decodeSessionId,
  decodeWorkbenchCommand,
  PENDING_TEXT_BYTES,
  STEP_READ,
  UNDELIVERED_TEXT_BYTES,
  WAITING_INPUTS,
  type WorkbenchResult,
} from "./contracts/workbench.ts";
import type {
  Accepted,
  CommandState,
  LiveInput,
  LiveTurn,
} from "./conversations.ts";
import type { ServiceCoordination } from "./coordination.ts";
import {
  type BuiltTurn,
  checkoutSessions,
  imagePart,
  listTurn,
  type ParsedSession,
  type PiSessions,
  type SessionEntry,
  sessionImage,
  summaryTitle,
  turnItems,
  turnSpans,
} from "./pi-sessions.ts";
import type { FileSnapshot } from "./private-files.ts";

const META_BYTES = 64 * 1024;
const PAGE = 50;
/** Recent browser command overlays, not a session lifetime admission limit. */
export const INDEXED_COMMANDS = 64;
const COMMAND_STATES = 512;
const INTERRUPTED =
  "Interrupted: Cadence stopped before this reply finished. Nothing was replayed; send the message again to retry.";
/** How a message sent into a running reply is recorded when that reply's
 * worker ended without giving it to Pi. */
export const NOT_DELIVERED =
  "Not delivered: the reply ended before this message reached the model. Nothing was replayed; send it again.";
/** The same when the session could not be read as the reply ended. */
export const UNOBSERVED =
  "Not observed: the session could not be read when the reply ended, so whether this message was delivered was not recorded. Nothing was replayed.";
/** A message its sender withdrew before Pi was given it; it is not reported
 * as undelivered. */
export const WITHDRAWN = "Withdrawn before it was delivered.";
const LIVE: ChatStatus[] = ["queued", "running"];
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

/** Old Cadence transcript identities are not Pi sessions. Presence is enough
 * to refuse reuse; no old decoder, import, repair or deletion is performed. */
export function retiredConversation(
  c: ServiceCoordination,
  id: string,
): boolean {
  decodeSessionId(id);
  return ["identities", "sessions"].some((kind) => {
    const directory = join(c.directory, "conversations-v1", kind);
    return (
      c.files.directory(directory) &&
      observedFile(join(directory, `${id}.json`)) !== "absent"
    );
  });
}
export function assertSupportedConversation(
  c: ServiceCoordination,
  id: string,
): void {
  if (retiredConversation(c, id))
    throw new ContractError("retired-conversation");
}

function decodeAccepted(value: unknown): Accepted {
  const o = closed(value, [
    "command",
    "at",
    "session",
    "parent",
    "offset",
    ...(Object.hasOwn(value ?? {}, "execution")
      ? ["execution", "directory", "file"]
      : []),
  ]);
  const command = decodeWorkbenchCommand(o.command);
  if (command.kind !== "send" && command.kind !== "conversation-input")
    throw new ContractError("corrupt-selected");
  return {
    command,
    ...(o.execution === undefined
      ? {}
      : {
          execution: decodeExecutionContext(o.execution),
          directory: text(o.directory, 4096, true),
          file: o.file === null ? null : text(o.file, 4096, true),
        }),
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

/** A live run's entries, one part for each message Pi was given. */
type Parts = ReturnType<ParsedSession["runEntries"]>;

export class ConversationRecords {
  readonly root: string;
  private readonly bindings: string;
  readonly sessions: PiSessions;
  private readonly active: ReadonlyMap<string, LiveTurn>;
  /** The messages sent into the live runs, by their own command. */
  private readonly inputs: ReadonlyMap<string, LiveInput>;
  private knownSecrets: readonly string[] | undefined;
  private readonly states = new Map<
    string,
    { key: string; state: CommandState }
  >();
  constructor(
    private readonly o: {
      coordination: ServiceCoordination;
      cwd: string;
      agentDir: string;
      sessionDir?: string;
      secrets(): readonly string[];
      assertCurrent(): void;
      active?: ReadonlyMap<string, LiveTurn>;
      inputs?: ReadonlyMap<string, LiveInput>;
    },
  ) {
    this.root = join(o.coordination.directory, "conversation-commands-v1");
    this.bindings = join(o.coordination.directory, "conversations-v1");
    this.active = o.active ?? new Map();
    this.inputs = o.inputs ?? new Map();
    this.sessions = checkoutSessions(
      o.coordination.store.root,
      o.cwd,
      o.agentDir,
      o.sessionDir,
    );
  }
  private get files() {
    return this.o.coordination.files;
  }
  readSecrets(): readonly string[] {
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
  path(commandId: string, name: string) {
    return join(this.root, "commands", decodeId(commandId), name);
  }
  assertSupported(id: string): void {
    assertSupportedConversation(this.o.coordination, id);
  }
  indexPath(id: string) {
    this.assertSupported(id);
    return join(this.root, "sessions", `${decodeSessionId(id)}.json`);
  }
  read(path: string, max = META_BYTES): unknown | undefined {
    const value = this.files.read(path, max);
    return value ? parseWireJson(value.bytes.toString("utf8"), max) : undefined;
  }
  index(id: string): { file?: FileSnapshot; commands: string[] } {
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
  accepted(commandId: string): Accepted | undefined {
    const value = this.read(this.path(commandId, "accepted.json"));
    return value === undefined ? undefined : decodeAccepted(value);
  }
  state(commandId: string): CommandState {
    const live = this.active.get(commandId) ?? this.inputs.get(commandId);
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
  /** Whether the owner that ran this command recorded that it could not
   * establish its worker's closure. A command merely left queued or running was
   * cut short by that owner's death; startup healing has stopped its workers
   * before any reader exists, so that one is interrupted, not unknown. A
   * message sent into a reply shares that reply's worker, so its closure is
   * the reply's as well as its own. */
  closureUnknown(commandId: string): boolean {
    const recorded = (id: string) => {
      const value = this.read(this.path(id, "state.json"));
      if (value === undefined) throw new ContractError("corrupt-selected");
      return decodeState(value).status === "unknown";
    };
    if (recorded(commandId)) return true;
    const command = this.accepted(commandId)?.command;
    return command?.kind === "conversation-input" && recorded(command.turnId);
  }
  liveFor(id: string): LiveTurn | undefined {
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
  controlPath(id: string) {
    this.assertSupported(id);
    return join(this.bindings, "control-links", `${decodeSessionId(id)}.json`);
  }
  controlKey(id: string): string {
    return observedFile(this.controlPath(id));
  }
  /** The owner's record that the history list leaves a session out. Its
   * presence is the whole fact; Pi's session file is not involved. */
  archivePath(id: string) {
    this.assertSupported(id);
    return join(this.bindings, "archive", `${decodeSessionId(id)}.json`);
  }
  archived(id: string): boolean {
    const path = this.archivePath(id);
    return (
      this.files.directory(join(this.bindings, "archive")) &&
      observedFile(path) !== "absent"
    );
  }
  /** Every archived session, from one directory read rather than a stat each. */
  private archivedSessions(): Set<string> {
    const directory = join(this.bindings, "archive"),
      ids = new Set<string>();
    if (!this.files.directory(directory)) return ids;
    const dir = opendirSync(directory);
    try {
      for (let e = dir.readSync(); e; e = dir.readSync()) {
        if (!e.isFile() || !e.name.endsWith(".json"))
          throw new ContractError("corrupt-selected");
        try {
          ids.add(decodeSessionId(e.name.slice(0, -5)));
        } catch {
          throw new ContractError("corrupt-selected");
        }
      }
    } finally {
      dir.closeSync();
    }
    return ids;
  }
  /** Whether a conversation has this run, live or settled. A message sent
   * into a reply is not one: it has no worker or turn of its own to name. */
  hasCommand(id: string, commandId: string): boolean {
    const accepted = this.accepted(commandId);
    return accepted?.session === id && accepted.command.kind === "send";
  }
  /** The run a command belongs to: its own, or that of the reply it was sent
   * into. */
  private runOf(
    commandId: string,
  ): { commandId: string; accepted: Accepted } | undefined {
    const accepted = this.accepted(commandId);
    if (accepted?.command.kind !== "conversation-input")
      return accepted && { commandId, accepted };
    const run = this.accepted(accepted.command.turnId);
    if (run?.command.kind !== "send" || run.session !== accepted.session)
      throw new ContractError("corrupt-selected");
    return { commandId: accepted.command.turnId, accepted: run };
  }
  /** The newest run a conversation records, with the messages sent into it,
   * oldest first. Nothing else is admitted to a session while a run lives, so
   * every command its index names after the run's own is one of them. */
  private recordedRun(id: string) {
    const commands = this.index(id).commands;
    const latest = commands.at(-1);
    const run = latest === undefined ? undefined : this.runOf(latest);
    if (!run) return undefined;
    const at = commands.lastIndexOf(run.commandId);
    const inputs = (at < 0 ? [] : commands.slice(at + 1)).map((commandId) => {
      const accepted = this.accepted(commandId);
      if (
        accepted?.command.kind !== "conversation-input" ||
        accepted.command.turnId !== run.commandId
      )
        throw new ContractError("corrupt-selected");
      return { commandId, accepted };
    });
    return { ...run, inputs };
  }
  /** What Pi wrote for a run: a part for each of its messages Pi was given. */
  private written(
    session: ParsedSession,
    run: {
      commandId: string;
      accepted: Accepted;
      inputs: readonly { commandId: string; accepted: Accepted }[];
    },
  ): Parts {
    return session.runEntries(
      {
        commandId: run.commandId,
        parent: run.accepted.parent,
        offset: run.accepted.offset,
      },
      run.inputs.map((input) => ({
        commandId: input.commandId,
        offset: input.accepted.offset,
      })),
    );
  }
  /** A grant binds the current Pi branch, including external terminal appends:
   * it must end in the turn of the newest message Pi was given in the run. A
   * run that wrote no user entry still binds the exact entry it was sent from. */
  approvalHead(id: string, commandId: string): string | null {
    this.o.assertCurrent();
    const run = this.recordedRun(id);
    if (!run || run.commandId !== commandId || run.accepted.session !== id)
      throw new ContractError("stale");
    const session = this.sessions.session(id);
    const head = session?.current() ?? null;
    // Each user entry was recorded at settlement; Pi wrote the newest last.
    let newest: SessionEntry | undefined;
    for (const message of [run, ...run.inputs]) {
      const user = this.state(message.commandId).user;
      if (user === null) continue;
      const entry = session?.byId.get(user);
      if (!entry) throw new ContractError("stale");
      if (!newest || entry.pos > newest.pos) newest = entry;
    }
    if (
      newest
        ? turnSpans(session?.branch(head) ?? []).at(-1)?.[0]?.id !== newest.id
        : head !== run.accepted.parent
    )
      throw new ContractError("stale");
    return head;
  }
  /** The newest run a conversation records. It is settled once its own
   * message and every message sent into it has ended with a known closure. */
  latestRun(id: string): { commandId: string; settled: boolean } | null {
    this.o.assertCurrent();
    const run = this.recordedRun(id);
    return run
      ? {
          commandId: run.commandId,
          settled: ![run, ...run.inputs].some((message) =>
            ["queued", "running", "unknown"].includes(
              this.state(message.commandId).status,
            ),
          ),
        }
      : null;
  }
  summary(
    id: string,
    live: LiveTurn | undefined,
    archived = this.archived(id),
  ): ChatSummary | null {
    this.assertSupported(id);
    const listed = this.sessions.find(id);
    const hidden = archived ? { archived: true as const } : {};
    if (!listed) {
      if (!live) return null;
      return {
        id,
        title: sanitizeText(live.title, this.readSecrets()) || "Conversation",
        leaf: null,
        status: live.state.status,
        updatedAt: live.accepted.at,
        origin: "webui",
        live: { commandId: live.commandId, epoch: live.epoch },
        ...hidden,
      };
    }
    const s = listed.summary;
    const secrets = this.readSecrets();
    let status: ChatStatus =
      live?.state.status ?? s.stop?.status ?? "completed";
    // Pi's stop reason is model evidence, not the owner's native/auth/storage
    // settlement. Match only the displayed branch's user, never another branch.
    if (!live && this.index(id).commands.length) {
      const session = this.sessions.session(id);
      const user = session && turnSpans(session.branch(s.leaf)).at(-1)?.[0]?.id;
      const recorded = user ? this.overlay(id, session).get(user) : undefined;
      status = this.attempt(id, s.leaf)?.status ?? recorded?.status ?? status;
    }
    return {
      id,
      title: text(
        [...sanitizeText(summaryTitle(s), secrets)]
          .slice(0, CONVERSATION_NAME_CHARS)
          .join("") || "Conversation",
        512,
        true,
      ),
      leaf: s.leaf,
      status,
      updatedAt: Math.max(Math.trunc(listed.mtimeMs), live?.accepted.at ?? 0),
      origin: s.webui ? "webui" : "terminal",
      ...(live
        ? { live: { commandId: live.commandId, epoch: live.epoch } }
        : {}),
      ...hidden,
    };
  }
  /** The history, without archived sessions; `archived` lists only those. */
  list(after: ChatCursor | null = null, archived = false): WorkbenchResult {
    this.o.assertCurrent();
    const hidden = this.archivedSessions();
    const listed = this.sessions
      .list()
      .filter(
        (row) =>
          hidden.has(row.summary.id) === archived &&
          !retiredConversation(this.o.coordination, row.summary.id),
      );
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
      const summary = this.summary(
        l.summary.id,
        this.liveFor(l.summary.id),
        archived,
      );
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
    this.o.assertCurrent();
    return {
      kind: "conversation-active",
      entries: [...this.active.values()].flatMap((live) => {
        const summary = this.summary(live.accepted.session, live);
        return summary ? [summary] : [];
      }),
    };
  }
  /** A branch as read. A live run sent from it follows as one more turn, its
   * newest message's: `parts` holds what the run has written, and each of
   * its earlier messages is by then an ordinary turn of the branch, which
   * ends at the entry the newest one continues. A read that names an earlier
   * end of the live run follows the run there, unless it is `exact`. */
  branch(
    id: string,
    leaf: string | null,
    exact: boolean,
  ): {
    session: ParsedSession | undefined;
    leaf: string | null;
    turns: SessionEntry[][];
    live: LiveTurn | undefined;
    /** Undefined without a live run, or while the session's record of it is
     * unusable: the head stays readable and reading the run's turn says why. */
    parts: Parts | undefined;
  } {
    this.assertSupported(id);
    const session = this.sessions.session(id);
    const running = this.liveFor(id);
    let parts: Parts | undefined;
    try {
      parts = running && this.liveParts(session, running);
    } catch (error) {
      if (!(error instanceof ContractError)) throw error;
    }
    // Where the live run's branch has ended so far: the entry the run was
    // sent from, then the one each message delivered into it continued.
    const ends = running
      ? [
          running.accepted.parent,
          ...(parts ?? []).slice(1).map((part) => part.entries[0].parentId),
        ]
      : [];
    const end = ends.at(-1) ?? null;
    if (leaf !== null && !session?.byId.has(leaf))
      throw new ContractError("stale");
    const view = exact
      ? leaf
      : leaf === null
        ? running
          ? end
          : (session?.current() ?? null)
        : ends.includes(leaf)
          ? end
          : leaf;
    const turns = session ? turnSpans(session.branch(view)) : [];
    const live = running && end === view ? running : undefined;
    return { session, leaf: view, turns, live, parts: live && parts };
  }
  /** What a live run has written, a part for each message Pi was given. */
  private liveParts(session: ParsedSession | undefined, live: LiveTurn): Parts {
    return session ? this.written(session, live) : [];
  }
  /** The user entry Pi wrote for a command whose record names none. */
  private userEntry(
    session: ParsedSession,
    commandId: string,
    accepted: Accepted,
  ): string | null {
    if (accepted.command.kind !== "conversation-input")
      return (
        session.commandEntries(commandId, accepted.parent, accepted.offset)[0]
          ?.id ?? null
      );
    const run = this.runOf(commandId);
    return (
      (run &&
        this.written(session, {
          ...run,
          inputs: [{ commandId, accepted }],
        }).find((part) => part.commandId === commandId)?.entries[0].id) ??
      null
    );
  }
  /** The messages sent into a live run that Pi has not been seen to write. */
  private pending(
    live: LiveTurn,
    session: ParsedSession | undefined,
  ): ChatPending[] {
    const secrets = this.readSecrets();
    return live.inputs
      .filter(
        (input) => !input.withdrawn && !session?.delivered(input.commandId),
      )
      .slice(0, WAITING_INPUTS)
      .map((input) => ({
        commandId: input.commandId,
        mode: input.accepted.command.mode,
        text: clipText(
          sanitizeText(input.accepted.command.text, secrets),
          PENDING_TEXT_BYTES,
        ),
      }));
  }
  /** The messages sent into the newest run that it ended without giving to
   * Pi, while the branch read still ends in that run. */
  private undelivered(
    id: string,
    view: ReturnType<ConversationRecords["branch"]>,
  ): ChatAttempt[] {
    const run = this.recordedRun(id);
    if (!run?.inputs.length || this.active.has(run.commandId)) return [];
    let parts: Parts;
    try {
      parts = view.session ? this.written(view.session, run) : [];
    } catch (error) {
      // An unusable record of the run claims nothing about its messages.
      if (error instanceof ContractError) return [];
      throw error;
    }
    const newest = parts.at(-1)?.entries[0].id;
    if (
      newest === undefined
        ? view.leaf !== run.accepted.parent
        : view.turns.at(-1)?.[0]?.id !== newest
    )
      return [];
    const secrets = this.readSecrets();
    return run.inputs
      .flatMap(({ commandId, accepted }) => {
        const state = this.state(commandId);
        return state.user !== null ||
          state.notice === WITHDRAWN ||
          parts.some((part) => part.commandId === commandId)
          ? []
          : [
              {
                commandId,
                text: clipText(
                  sanitizeText(accepted.command.text, secrets),
                  UNDELIVERED_TEXT_BYTES,
                ),
                status: state.status,
                notice: sanitizeText(state.notice, secrets),
              },
            ];
      })
      .slice(0, WAITING_INPUTS);
  }
  /** The newest run's own message when it left nothing in the session. A
   * message sent into that run is reported as undelivered instead. */
  attempt(id: string, leaf: string | null): ChatAttempt | null {
    const latest = this.index(id).commands.at(-1);
    const run = latest === undefined ? undefined : this.runOf(latest);
    if (!run || this.active.has(run.commandId)) return null;
    const { commandId, accepted } = run;
    const state = this.state(commandId);
    if (state.user !== null || accepted.parent !== leaf) return null;
    if (state.status === "unknown") {
      // An interrupted message may still have reached the session.
      const session = this.sessions.session(id);
      if (
        session?.commandEntries(commandId, accepted.parent, accepted.offset)
          .length
      )
        return null;
    }
    return {
      commandId,
      text: sanitizeText(accepted.command.text, this.readSecrets()),
      status: state.status,
      notice: sanitizeText(state.notice, this.readSecrets()),
    };
  }
  /** The branch's context size; a live turn counts what Pi wrote for it so
   * far, so the figure follows each model response. */
  private context(
    view: ReturnType<ConversationRecords["branch"]>,
  ): ChatContext | undefined {
    if (!view.session) return undefined;
    // The turn read reports an unusable record of a live run; the head
    // claims no figure for it.
    if (view.live && !view.parts) return undefined;
    const leaf = view.parts?.at(-1)?.entries.at(-1)?.id ?? view.leaf;
    const usage = view.session.usage(leaf);
    if (!usage) return undefined;
    const secrets = this.readSecrets();
    return {
      tokens: usage.tokens,
      provider: clipText(sanitizeText(usage.provider, secrets), 128),
      model: clipText(sanitizeText(usage.model, secrets), 256),
    };
  }
  conversation(
    id: string,
    leaf: string | null,
    known: string | null,
  ): WorkbenchResult {
    this.o.assertCurrent();
    const view = this.branch(id, leaf, false);
    const running = view.live ?? this.liveFor(id);
    const summary = this.summary(id, running);
    const listed = this.sessions.find(id);
    const context = this.context(view);
    const cache = view.session?.cache;
    const pending = running ? this.pending(running, view.session) : [];
    const undelivered = running ? [] : this.undelivered(id, view);
    return {
      kind: "conversation",
      commands: this.index(id).commands,
      ...(context ? { context } : {}),
      ...(cache && cache.input + cache.read + cache.write > 0
        ? { cache: { ...cache } }
        : {}),
      ...(pending.length ? { pending } : {}),
      ...(undelivered.length ? { undelivered } : {}),
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
  image(
    request: Extract<WorkbenchRead, { kind: "conversation-image" }>,
  ): WorkbenchResult {
    this.o.assertCurrent();
    this.readSecrets();
    const view = this.branch(request.id, request.leaf, true);
    if (request.live) {
      if (view.live?.commandId !== request.entry)
        throw new ContractError("stale");
      // Pi can buffer a new session until its first assistant message. The
      // admitted turn, not a second durable store, owns that input meanwhile.
      const image = view.live.images?.[request.index];
      if (!image) throw new ContractError("stale");
      return imagePart(image.data, image.mimeType, request.offset);
    }
    if (!view.session) throw new ContractError("stale");
    let imageLeaf = view.leaf;
    if (view.live && !view.session.contains(imageLeaf, request.entry)) {
      // A running turn is shown after the branch end. Only its worker-recorded
      // command prefix, never an arbitrary descendant, extends that read view.
      const chain =
        (view.parts ?? this.liveParts(view.session, view.live)).at(-1)
          ?.entries ?? [];
      if (!chain.some((entry) => entry.id === request.entry))
        throw new ContractError("stale");
      imageLeaf = chain.at(-1)?.id ?? imageLeaf;
    }
    const result = sessionImage(
      view.session,
      imageLeaf,
      request.entry,
      request.index,
      request.offset,
    );
    this.o.assertCurrent();
    return result;
  }
  tree(id: string, leaf: string | null): WorkbenchResult {
    this.o.assertCurrent();
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
  overlay(id: string, session: ParsedSession | undefined) {
    const out = new Map<
      string,
      CommandState & { execution?: ExecutionContext }
    >();
    for (const commandId of this.index(id).commands) {
      if (this.active.has(commandId) || this.inputs.has(commandId)) continue;
      const state = this.state(commandId);

      let user = state.user;
      if (user === null && state.status === "unknown" && session) {
        const accepted = this.accepted(commandId);
        user = accepted ? this.userEntry(session, commandId, accepted) : null;
      }
      if (user !== null)
        out.set(user, {
          ...state,
          execution: this.accepted(commandId)?.execution,
        });
    }
    return out;
  }
  built(
    id: string,
    leaf: string | null,
    ordinal: number,
  ): { turn: BuiltTurn & { execution?: ExecutionContext }; stable: number } {
    const view = this.branch(id, leaf, true);
    const secrets = this.readSecrets();
    if (ordinal < view.turns.length && view.session) {
      const turn = this.sessions.turn(
        view.session,
        view.turns[ordinal],
        secrets,
      );
      const recorded = this.overlay(id, view.session).get(turn.id);
      // An earlier message of the live run: its reply has ended as Pi wrote
      // it, and its record waits for the run to settle.
      const running = view.parts
        ?.slice(0, -1)
        .some((part) => part.entries[0].id === turn.id);
      return {
        turn: recorded
          ? {
              ...turn,
              ...(recorded.execution ? { execution: recorded.execution } : {}),
              status: recorded.status,
              notice: turn.notice || sanitizeText(recorded.notice, secrets),
              // The recorded thinking flag says the live capture kept none; the
              // session holds it, so only what Pi stored unreadable is omitted.
              omitted: {
                thinking: turn.omitted.thinking,
                media: turn.omitted.media || recorded.omitted.media,
                other: turn.omitted.other || recorded.omitted.other,
              },
            }
          : running && view.live
            ? { ...turn, execution: view.live.execution }
            : turn,
        stable: turn.steps.length,
      };
    }
    const live = view.live;
    if (!live || ordinal !== view.turns.length)
      throw new ContractError("stale");
    // An unusable record of the run is reported here, by its turn.
    const parts = view.parts ?? this.liveParts(view.session, live);
    const chain = parts.at(-1)?.entries ?? [];
    // The capture counts the whole run, so its earlier turns' items are too.
    const session = view.session;
    const earlier = session
      ? parts
          .slice(0, -1)
          .flatMap(
            (part) => this.sessions.turn(session, part.entries, secrets).items,
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
            ...(live.images?.length
              ? {
                  images: live.images.map((image, index) => ({
                    live: true as const,
                    entry: live.commandId,
                    index,
                    mimeType: image.mimeType,
                  })),
                }
              : {}),
            name: "",
            args: "",
            error: false,
          },
        ];
    const extended = live.capture?.extend(items, earlier) ?? {
      items,
      stable: items.length,
    };
    const omitted = live.capture?.omitted;
    const turn = listTurn({
      id: chain[0]?.id ?? live.commandId,
      entry: null,
      // Pi may record a model change between the admitted head and the message.
      parent: chain.length ? chain[0].parentId : live.accepted.parent,
      // A message sent into the run began when Pi wrote it.
      at: parts.length > 1 ? written.at : live.accepted.at,
      status: live.state.status,
      notice: sanitizeText(live.capture?.notice ?? "", secrets),
      ...(live.capture?.retry ? { retry: live.capture.retry } : {}),
      omitted: {
        thinking: written.omitted.thinking,
        media: written.omitted.media || !!omitted?.media,
        other: written.omitted.other || !!omitted?.other,
      },
      items: extended.items.map((item) => ({
        ...item,
        text: sanitizeText(item.text, secrets),
        name: sanitizeText(item.name, secrets),
        args: sanitizeText(item.args, secrets),
      })),
    });
    return {
      turn: { ...turn, execution: live.execution },
      stable: extended.stable,
    };
  }
  turnSteps(
    id: string,
    leaf: string | null,
    ordinal: number,
    before: number | null,
  ): WorkbenchResult {
    this.o.assertCurrent();
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
        ...(turn.execution ? { execution: turn.execution } : {}),
        ...(turn.retry ? { retry: turn.retry } : {}),
        id: turn.id,
        status: turn.status,
        notice: turn.notice,
        omitted: { ...turn.omitted },
        steps: turn.steps.length,
        stable,
        entry: turn.entry,
        parent: turn.parent,
        at: turn.at,
      },
      start,
      steps: turn.steps.slice(start, end),
    };
  }
  step(
    id: string,
    leaf: string | null,
    turnId: string,
    step: number,
    part: number,
  ): WorkbenchResult {
    this.o.assertCurrent();
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
  closeReads(): void {
    this.sessions.close();
    this.states.clear();
  }
}
