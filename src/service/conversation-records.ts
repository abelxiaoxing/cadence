/** Shared readonly Pi session and browser-command records. No SDK, execution owner or writes. */
import { lstatSync } from "node:fs";
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
  type ChatStatus,
  type ChatSummary,
  clipText,
  decodeEntryId,
  decodeSessionId,
  decodeWorkbenchCommand,
  STEP_READ,
  type WorkbenchResult,
} from "./contracts/workbench.ts";
import type { Accepted, CommandState, LiveTurn } from "./conversations.ts";
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
  if (command.kind !== "send") throw new ContractError("corrupt-selected");
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

export class ConversationRecords {
  readonly root: string;
  private readonly bindings: string;
  readonly sessions: PiSessions;
  private readonly active: ReadonlyMap<string, LiveTurn>;
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
    },
  ) {
    this.root = join(o.coordination.directory, "conversation-commands-v1");
    this.bindings = join(o.coordination.directory, "conversations-v1");
    this.active = o.active ?? new Map();
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
  hasCommand(id: string, commandId: string): boolean {
    return this.accepted(commandId)?.session === id;
  }
  /** A grant binds the current Pi branch, including external terminal appends.
   * A later browser command without a written user entry still binds its exact parent. */
  approvalHead(id: string, commandId: string): string | null {
    this.o.assertCurrent();
    const accepted = this.accepted(commandId);
    if (!accepted || accepted.session !== id) throw new ContractError("stale");
    const state = this.state(commandId);
    const session = this.sessions.session(id);
    const head = session?.current() ?? null;
    if (
      state.user === null
        ? head !== accepted.parent
        : turnSpans(session?.branch(head) ?? []).at(-1)?.[0]?.id !== state.user
    )
      throw new ContractError("stale");
    return head;
  }
  latestCommand(id: string): { commandId: string; status: ChatStatus } | null {
    this.o.assertCurrent();
    const commandId = this.index(id).commands.at(-1);
    return commandId
      ? { commandId, status: this.state(commandId).status }
      : null;
  }
  summary(id: string, live: LiveTurn | undefined): ChatSummary | null {
    this.assertSupported(id);
    const listed = this.sessions.find(id);
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
        [...sanitizeText(summaryTitle(s), secrets)].slice(0, 100).join("") ||
          "Conversation",
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
    };
  }
  list(after: ChatCursor | null = null): WorkbenchResult {
    this.o.assertCurrent();
    const listed = this.sessions
      .list()
      .filter(
        (row) => !retiredConversation(this.o.coordination, row.summary.id),
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
    this.o.assertCurrent();
    return {
      kind: "conversation-active",
      entries: [...this.active.values()].flatMap((live) => {
        const summary = this.summary(live.accepted.session, live);
        return summary ? [summary] : [];
      }),
    };
  }
  branch(
    id: string,
    leaf: string | null,
    exact: boolean,
  ): {
    session: ParsedSession | undefined;
    leaf: string | null;
    turns: SessionEntry[][];
    live: LiveTurn | undefined;
  } {
    this.assertSupported(id);
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
  attempt(id: string, leaf: string | null): ChatAttempt | null {
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
    let leaf = view.leaf;
    if (view.live) {
      const { accepted, commandId } = view.live;
      try {
        leaf =
          view.session
            .commandEntries(commandId, accepted.parent, accepted.offset)
            .at(-1)?.id ?? leaf;
      } catch (error) {
        // The turn read reports an unusable command chain; the head stays
        // readable and claims no figure for it.
        if (error instanceof ContractError) return undefined;
        throw error;
      }
    }
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
    const summary = this.summary(id, view.live ?? this.liveFor(id));
    const listed = this.sessions.find(id);
    const context = this.context(view);
    return {
      kind: "conversation",
      commands: this.index(id).commands,
      ...(context ? { context } : {}),
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
      // A running turn is shown after its parent leaf. Only its worker-recorded
      // command prefix, never an arbitrary descendant, extends that read view.
      const accepted = view.live.accepted;
      const chain = view.session.commandEntries(
        view.live.commandId,
        accepted.parent,
        accepted.offset,
      );
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
      if (this.active.has(commandId)) continue;
      const state = this.state(commandId);

      let user = state.user;
      if (user === null && state.status === "unknown" && session) {
        const accepted = this.accepted(commandId);
        user = accepted
          ? (session.commandEntries(
              commandId,
              accepted.parent,
              accepted.offset,
            )[0]?.id ?? null)
          : null;
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
          : turn,
        stable: turn.steps.length,
      };
    }
    const live = view.live;
    if (!live || ordinal !== view.turns.length)
      throw new ContractError("stale");
    const chain = view.session
      ? view.session.commandEntries(
          live.commandId,
          live.accepted.parent,
          live.accepted.offset,
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
    const extended = live.capture?.extend(items) ?? {
      items,
      stable: items.length,
    };
    const omitted = live.capture?.omitted;
    const turn = listTurn({
      id: chain[0]?.id ?? live.commandId,
      entry: null,
      // Pi may record a model change between the admitted head and the message.
      parent: chain.length ? chain[0].parentId : live.accepted.parent,
      at: live.accepted.at,
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
