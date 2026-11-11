/** Reads one conversation (a Pi session) for display: a small head poll, every
 * shown turn of the branch once, and only an unsettled or growing turn again.
 * Earlier turns load on request, a few at a time or back to a named turn. It
 * follows the session's current leaf unless a branch is chosen. */
import { abortScope } from "../../../src/abort-scope.ts";
import type {
  ChatAttempt,
  ChatCache,
  ChatContext,
  ChatImage,
  ChatPending,
  ChatStatus,
  ChatStep,
  ChatSummary,
  ChatTurnHeader,
  WorkbenchRead,
  WorkbenchResult,
} from "../../../src/service/contracts/workbench.ts";
import { STEP_READ } from "../../../src/service/contracts/workbench.ts";
import type { ServiceClient } from "../../../src/service-client.ts";
import { readImage } from "./images";

/** A turn as the transcript renders it. */
export interface TurnSource {
  image?(image: ChatImage, signal: AbortSignal): Promise<Blob>;
  header: ChatTurnHeader;
  steps: readonly ChatStep[];
  /** A step's full recorded item: its arguments, output and whole text. */
  detail(
    step: number,
    parts: number,
    signal: AbortSignal,
  ): Promise<{ text: string; args: string }>;
}
export interface LoadedTurn extends TurnSource {
  ordinal: number;
}
export interface ConversationView {
  /** Undefined until the first observation; null for a conversation not started. */
  summary: ChatSummary | null | undefined;
  /** The branch shown, by its last entry; a message sent now continues it. */
  leaf: string | null;
  /** A branch was chosen instead of following the session's current leaf. */
  pinned: boolean;
  /** Leaves in the session tree: more than one means it has branches. */
  branches: number;
  /** Workflows the terminal started in this session. */
  runs: string[];
  /** A browser message that left nothing in the session, after this branch. */
  attempt: ChatAttempt | null;
  /** Messages sent into the reply in progress that wait for delivery. */
  pending: ChatPending[];
  /** Messages the branch's last reply ended without delivering. */
  undelivered: ChatAttempt[];
  commands: string[];
  /** The branch's context size as of its last completed model response;
   * absent when the head read states none. */
  context?: ChatContext;
  /** The whole session's input tokens by cache use; absent when the head
   * read states none. The same for every branch of the session. */
  cache?: ChatCache;
  /** Turns the branch has. */
  count: number;
  /** Shown turns, oldest first: the most recent ones without gaps. */
  turns: LoadedTurn[];
  /** Older turns exist beyond the shown ones. */
  earlier: boolean;
  loadingEarlier: boolean;
  error: string;
}
export const INITIAL_TURNS = 2;
export const EARLIER_TURNS = 3;
export const LIVE_MS = 1000;
export const IDLE_MS = 10000;
// Reads in flight per conversation: a large turn or output never floods the
// owner or a gateway's request bound.
const READS = 4;

export const unsettled = (status: ChatStatus | undefined) =>
  status === "queued" || status === "running";
class ReadError extends Error {}

export class ConversationReader {
  private summary: ChatSummary | null | undefined = undefined;
  private leaf: string | null = null;
  private pinned: string | null = null;
  private branches = 0;
  private runs: string[] = [];
  private attempt: ChatAttempt | null = null;
  private pending: ChatPending[] = [];
  private undelivered: ChatAttempt[] = [];
  private commands: string[] = [];
  private context: ChatContext | undefined;
  private cache: ChatCache | undefined;
  private count = 0;
  private first: number | null = null;
  /** The oldest turn a chosen branch opens at, until its head is read. */
  private opening: number | null = null;
  private readonly turns = new Map<number, LoadedTurn>();
  private readonly imageReaders = new Map<
    string,
    NonNullable<TurnSource["image"]>
  >();
  private readonly details = new Map<string, TurnSource["detail"]>();
  private error = "";
  private loadingEarlier = false;
  private running = false;
  private again = false;
  private closed = false;
  private active = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private abort = new AbortController();
  private reads = 0;
  private readonly queue: (() => void)[] = [];
  private snapshot: ConversationView;
  constructor(
    private readonly client: Pick<ServiceClient, "workbenchRead">,
    private readonly id: string,
    private readonly notify: () => void,
  ) {
    this.snapshot = this.compose();
  }
  view(): ConversationView {
    return this.snapshot;
  }
  /** Observation runs only while active; shown data stays while paused. */
  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (active) void this.tick();
    else clearTimeout(this.timer);
  }
  close(): void {
    this.closed = true;
    this.abort.abort();
    clearTimeout(this.timer);
  }
  /** Observe now, e.g. after a send. Readonly; it never replays a command. */
  refresh = (): void => {
    void this.tick();
  };
  /** Show the branch that ends at `leaf`; null follows the current leaf again.
   * `first` names the oldest turn to show at once, for a branch chosen at one
   * of its messages rather than at its end. */
  choose = (leaf: string | null, first?: number): void => {
    if (this.closed) return;
    if (this.pinned === leaf) {
      if (first !== undefined) this.showFrom(first);
      return;
    }
    // Navigation retires reads, never an admitted Send or owner operation.
    // A retained summary is not a fresh observation of the selected branch.
    this.abort.abort();
    this.abort = new AbortController();
    this.pinned = leaf;
    this.summary = undefined;
    this.context = undefined;
    this.pending = [];
    this.undelivered = [];
    this.error = "";
    this.forget();
    this.opening = first === undefined ? null : Math.max(0, first);
    this.publish();
    void this.tick();
  };
  private forget(): void {
    this.turns.clear();
    this.details.clear();
    this.imageReaders.clear();
    this.first = null;
    this.count = 0;
  }
  loadEarlier = (): void => {
    if (this.closed || this.loadingEarlier || !this.first) return;
    this.first = Math.max(0, this.first - EARLIER_TURNS);
    this.loadingEarlier = true;
    this.publish();
    void this.tick();
  };
  /** Show every turn from `ordinal` on: a jump to a turn not loaded yet. The
   * shown turns stay gap-free, so each turn in between is read too. */
  showFrom = (ordinal: number): void => {
    if (this.closed) return;
    if (this.first === null) {
      // Nothing is shown yet: the head read under way opens there.
      this.opening = Math.max(0, ordinal);
      return;
    }
    if (ordinal >= this.first) return;
    this.first = Math.max(0, ordinal);
    this.loadingEarlier = true;
    this.publish();
    void this.tick();
  };
  private publish(): void {
    if (this.closed) return;
    this.snapshot = this.compose();
    this.notify();
  }
  private compose(): ConversationView {
    // The newest loaded turns without a gap: a turn still loading (a new one,
    // or an earlier one) never hides those already shown.
    const turns: LoadedTurn[] = [];
    let o = this.count - 1;
    while (o >= 0 && !this.turns.has(o)) o--;
    for (; o >= (this.first ?? this.count); o--) {
      const turn = this.turns.get(o);
      if (!turn) break;
      turns.unshift(turn);
    }
    return {
      summary: this.summary,
      leaf: this.leaf,
      pinned: this.pinned !== null,
      branches: this.branches,
      runs: this.runs,
      attempt: this.attempt,
      pending: this.pending,
      undelivered: this.undelivered,
      commands: this.commands,
      ...(this.context ? { context: this.context } : {}),
      ...(this.cache ? { cache: this.cache } : {}),
      count: this.count,
      turns,
      earlier: (turns[0]?.ordinal ?? this.count) > 0,
      loadingEarlier: this.loadingEarlier,
      error: this.error,
    };
  }
  private async tick(): Promise<void> {
    if (this.closed || !this.active) return;
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    clearTimeout(this.timer);
    const earlier = this.loadingEarlier;
    const selection = this.abort;
    try {
      await this.sync(selection.signal);
      if (selection === this.abort) this.error = "";
    } catch (error) {
      if (this.closed) return;
      if (selection === this.abort)
        this.error = error instanceof ReadError ? error.message : "unavailable";
    } finally {
      this.running = false;
    }
    // A request made meanwhile is served by the pass that follows.
    if (earlier && !this.again) this.loadingEarlier = false;
    this.publish();
    if (this.again) {
      this.again = false;
      void this.tick();
      return;
    }
    if (!this.active) return;
    const live =
      unsettled(this.summary?.status) ||
      [...this.turns.values()].some((turn) => unsettled(turn.header.status));
    this.timer = setTimeout(() => void this.tick(), live ? LIVE_MS : IDLE_MS);
  }
  private async sync(signal: AbortSignal): Promise<void> {
    const pinned = this.pinned;
    const head = await this.read(
      {
        kind: "conversation",
        id: this.id,
        leaf: pinned,
        known: this.leaf,
      },
      signal,
    );
    if (signal.aborted) return;
    if (head.kind !== "conversation") throw new ReadError("invalid");
    // Another branch, or never a shorter record of this one: observe it afresh.
    if (!head.continues || head.turns < this.count) this.forget();
    // A branch that moved on extends its last shown turn.
    const grown = head.leaf !== this.leaf ? this.count - 1 : this.count;
    this.leaf = head.leaf;
    this.branches = head.branches;
    this.runs = head.runs;
    this.attempt = head.attempt;
    this.pending = head.pending ?? [];
    this.undelivered = head.undelivered ?? [];
    this.commands = head.commands ?? [];
    this.context = head.context;
    this.cache = head.cache;
    this.summary = head.summary;
    this.count = head.turns;
    // Never fewer than the newest turns, however late the named one is.
    const newest = Math.max(0, head.turns - INITIAL_TURNS);
    this.first = Math.min(this.first ?? this.opening ?? newest, newest);
    this.opening = null;
    this.publish();
    const wanted: number[] = [];
    for (let o = this.first; o < this.count; o++) {
      const turn = this.turns.get(o);
      if (
        !turn ||
        o >= grown ||
        turn.header.stable < turn.header.steps ||
        unsettled(turn.header.status)
      )
        wanted.push(o);
    }
    await Promise.all(
      wanted.map((ordinal) => this.load(ordinal, head.leaf, signal)),
    );
  }
  private async load(
    ordinal: number,
    leaf: string | null,
    signal: AbortSignal,
  ): Promise<void> {
    const prior = this.turns.get(ordinal);
    const latest = await this.turnRead(ordinal, null, leaf, signal);
    const header = latest.turn;
    const steps: (ChatStep | undefined)[] = Array.from({
      length: header.steps,
    });
    // Leading stable steps never change; an unsettled turn re-reads the rest.
    const kept =
      prior?.header.id === header.id
        ? Math.min(prior.header.stable, latest.start)
        : 0;
    for (let i = 0; i < kept; i++) steps[i] = prior?.steps[i];
    latest.steps.forEach((step, i) => {
      steps[latest.start + i] = step;
    });
    const ends: number[] = [];
    for (let end = latest.start; end > kept; end -= STEP_READ) ends.push(end);
    for (const range of await Promise.all(
      ends.map((end) => this.turnRead(ordinal, end, leaf, signal)),
    ))
      range.steps.forEach((step, i) => {
        const at = range.start + i;
        if (at >= kept && at < latest.start) steps[at] = step;
      });
    if (signal.aborted) return;
    if (steps.some((step) => !step)) throw new ReadError("stale");
    this.turns.set(ordinal, {
      ordinal,
      header,
      steps: steps as ChatStep[],
      detail: this.detail(leaf, header.id, signal),
      image: this.imageReader(leaf, signal),
    });
  }
  private async turnRead(
    ordinal: number,
    before: number | null,
    leaf: string | null,
    signal: AbortSignal,
  ) {
    const value = await this.read(
      {
        kind: "conversation-turn",
        id: this.id,
        leaf,
        ordinal,
        before,
      },
      signal,
    );
    if (
      value.kind !== "conversation-turn" ||
      value.ordinal !== ordinal ||
      value.leaf !== leaf
    )
      throw new ReadError("invalid");
    return value;
  }
  private imageReader(
    leaf: string | null,
    selection: AbortSignal,
  ): NonNullable<TurnSource["image"]> {
    const key = leaf ?? "";
    let reader = this.imageReaders.get(key);
    if (!reader) {
      reader = async (image, signal) => {
        const scope = abortScope([selection, signal]);
        try {
          return await readImage(image, (offset) =>
            this.read(
              {
                kind: "conversation-image",
                id: this.id,
                leaf,
                ...(image.live ? { live: true } : {}),
                entry: image.entry,
                index: image.index,
                offset,
              },
              scope.signal,
            ),
          );
        } finally {
          scope.dispose();
        }
      };
      this.imageReaders.set(key, reader);
    }
    return reader;
  }
  private detail(
    leaf: string | null,
    turnId: string,
    selection: AbortSignal,
  ): TurnSource["detail"] {
    const key = `${leaf ?? ""}:${turnId}`;
    let detail = this.details.get(key);
    if (!detail) {
      detail = async (step, parts, signal) => {
        const items = await Promise.all(
          Array.from({ length: parts }, async (_, part) => {
            // Each parallel read keeps its own lifetime: Promise.all may
            // reject while siblings are still waiting or reading their body.
            const scope = abortScope([selection, signal]);
            try {
              const value = await this.read(
                {
                  kind: "conversation-step",
                  id: this.id,
                  leaf,
                  turnId,
                  step,
                  part,
                },
                scope.signal,
              );
              if (value.kind !== "conversation-step" || value.part !== part)
                throw new ReadError("invalid");
              return value.item;
            } finally {
              scope.dispose();
            }
          }),
        );
        return {
          text: items.map((item) => item.text).join(""),
          args: items.map((item) => item.args).join(""),
        };
      };
      this.details.set(key, detail);
    }
    return detail;
  }
  private async read(
    request: WorkbenchRead,
    signal: AbortSignal = this.abort.signal,
  ): Promise<WorkbenchResult> {
    if (this.reads >= READS)
      await new Promise<void>((resolve) => this.queue.push(resolve));
    this.reads++;
    try {
      if (this.closed || signal.aborted) throw new ReadError("stale");
      const reply = await this.client.workbenchRead(request, signal);
      if (reply.kind === "error") throw new ReadError(reply.error.code);
      return reply.value;
    } finally {
      this.reads--;
      this.queue.shift()?.();
    }
  }
}
