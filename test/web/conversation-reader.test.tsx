import { afterEach, expect, it, vi } from "vitest";
import { IMAGE_LIMITS } from "../../src/image-content.mjs";
import {
  type ChatStatus,
  type ChatStep,
  decodeWorkbenchResult,
  STEP_READ,
  type WorkbenchRead,
  type WorkbenchResult,
} from "../../src/service/contracts/workbench.ts";
import {
  ConversationReader,
  IDLE_MS,
  LIVE_MS,
} from "../../web/src/client/conversation-reader";
import { PNG } from "../helpers/images.ts";
import {
  independentFixtureIds,
  independentRead,
  independentResults,
  independentScenarios,
  independentTimeline,
} from "../helpers/runtime-timeline.ts";

const descriptors = Object.getOwnPropertyDescriptors(AbortSignal);
afterEach(() => {
  Object.defineProperties(AbortSignal, descriptors);
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const id = crypto.randomUUID();
const step = (n: number): ChatStep => ({
  id: `s${n}`,
  role: n ? "tool" : "user",
  text: n ? "" : "Hello",
  clipped: false,
  name: n ? "read" : "",
  target: n ? `f${n}` : "",
  error: false,
  parts: n ? 1 : 0,
});
interface Turn {
  id: string;
  status: ChatStatus;
  steps: ChatStep[];
  stable: number;
}
function owner(turns: Turn[]) {
  const reads: WorkbenchRead[] = [];
  /** Optional head fields a test sets: what an older service never states. */
  const extra: Partial<Extract<WorkbenchResult, { kind: "conversation" }>> = {};
  let hold: Promise<void> | undefined;
  const value = async (request: WorkbenchRead): Promise<WorkbenchResult> => {
    if (request.kind === "conversation") {
      const head = turns.at(-1);
      return {
        kind: "conversation",
        summary: head
          ? {
              id,
              title: "t",
              leaf: head.id,
              status: head.status,
              updatedAt: 0,
              origin: "webui",
            }
          : null,
        leaf: head?.id ?? null,
        continues: true,
        turns: turns.length,
        branches: turns.length ? 1 : 0,
        runs: [],
        attempt: null,
        ...extra,
      };
    }
    if (request.kind === "conversation-turn") {
      await hold;
      const turn = turns[request.ordinal];
      const end = request.before ?? turn.steps.length;
      const start = Math.max(0, end - STEP_READ);
      return {
        kind: "conversation-turn",
        conversationId: id,
        leaf: request.leaf,
        ordinal: request.ordinal,
        turn: {
          id: turn.id,
          entry: turn.id,
          at: 0,
          status: turn.status,
          notice: "",
          omitted: { thinking: false, media: false, other: false },
          steps: turn.steps.length,
          stable: turn.stable,
        },
        start,
        steps: turn.steps.slice(start, end),
      };
    }
    if (request.kind === "conversation-step")
      return {
        kind: "conversation-step",
        conversationId: id,
        leaf: request.leaf,
        turnId: request.turnId,
        step: request.step,
        part: request.part,
        item: {
          id: "x",
          role: "tool",
          text: `out${request.part}`,
          name: "read",
          args: request.part ? "" : "{}",
          error: false,
        },
      };
    throw Error(request.kind);
  };
  return {
    reads,
    extra,
    hold(until: Promise<void> | undefined) {
      hold = until;
    },
    client: {
      workbenchRead: async (request: WorkbenchRead) => {
        reads.push(request);
        return { kind: "ok" as const, value: await value(request) };
      },
    },
  };
}
const settled = (steps = 2): Turn => ({
  id: crypto.randomUUID(),
  status: "completed",
  steps: Array.from({ length: steps }, (_, i) => step(i)),
  stable: steps,
});
const kinds = (reads: WorkbenchRead[]) =>
  reads.map((r) =>
    r.kind === "conversation-turn" ? `turn ${r.ordinal}/${r.before}` : r.kind,
  );

it("shows the newest turns first, reads a settled turn once and loads earlier ones on request", async () => {
  vi.useFakeTimers();
  const turns = Array.from({ length: 5 }, () => settled());
  const o = owner(turns);
  const reader = new ConversationReader(o.client, id, () => {});
  reader.setActive(true);
  await vi.advanceTimersByTimeAsync(0);
  const first = reader.view();
  expect(first.turns.map((t) => t.ordinal)).toEqual([3, 4]);
  expect(first).toMatchObject({ count: 5, earlier: true, error: "" });
  expect(kinds(o.reads)).toEqual([
    "conversation",
    "turn 3/null",
    "turn 4/null",
  ]);
  // Idle: only the small head is observed again, and not every second.
  o.reads.length = 0;
  await vi.advanceTimersByTimeAsync(LIVE_MS);
  expect(o.reads).toEqual([]);
  await vi.advanceTimersByTimeAsync(IDLE_MS);
  expect(kinds(o.reads)).toEqual(["conversation"]);
  o.reads.length = 0;
  reader.loadEarlier();
  expect(reader.view().loadingEarlier).toBe(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(reader.view().turns.map((t) => t.ordinal)).toEqual([0, 1, 2, 3, 4]);
  expect(reader.view()).toMatchObject({
    earlier: false,
    loadingEarlier: false,
  });
  expect(kinds(o.reads).sort()).toEqual([
    "conversation",
    "turn 0/null",
    "turn 1/null",
    "turn 2/null",
  ]);
  reader.close();
});

it("a long turn assembles from ranges; an unsettled one re-reads only what may change", async () => {
  vi.useFakeTimers();
  const live: Turn = {
    id: crypto.randomUUID(),
    status: "running",
    steps: Array.from({ length: 60 }, (_, i) => step(i)),
    stable: 50,
  };
  const o = owner([live]);
  const reader = new ConversationReader(o.client, id, () => {});
  reader.setActive(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(reader.view().turns[0].steps.map((s) => s.id)).toEqual(
    live.steps.map((s) => s.id),
  );
  expect(kinds(o.reads)).toEqual([
    "conversation",
    "turn 0/null",
    "turn 0/36",
    "turn 0/12",
  ]);
  o.reads.length = 0;
  live.steps.push(step(60));
  await vi.advanceTimersByTimeAsync(LIVE_MS);
  expect(kinds(o.reads)).toEqual(["conversation", "turn 0/null"]);
  expect(reader.view().turns[0].steps).toHaveLength(61);
  live.status = "completed";
  live.stable = 61;
  o.reads.length = 0;
  await vi.advanceTimersByTimeAsync(LIVE_MS);
  expect(kinds(o.reads)).toEqual(["conversation", "turn 0/null"]);
  o.reads.length = 0;
  await vi.advanceTimersByTimeAsync(IDLE_MS);
  expect(kinds(o.reads)).toEqual(["conversation"]);
  // A step's parts join into its full item.
  const detail = await reader
    .view()
    .turns[0].detail(5, 3, new AbortController().signal);
  expect(detail).toEqual({ text: "out0out1out2", args: "{}" });
  reader.close();
});

it("a new turn loading never hides the turns already shown", async () => {
  vi.useFakeTimers();
  const turns = [settled(), settled()];
  const o = owner(turns);
  const reader = new ConversationReader(o.client, id, () => {});
  reader.setActive(true);
  await vi.advanceTimersByTimeAsync(0);
  let release!: () => void;
  o.hold(new Promise<void>((resolve) => (release = resolve)));
  turns.push({ ...settled(), status: "running", stable: 0 });
  reader.refresh();
  await vi.advanceTimersByTimeAsync(0);
  // Head and body publish together; a new count cannot describe an old body.
  expect(reader.view().count).toBe(2);
  expect(reader.view().turns.map((t) => t.ordinal)).toEqual([0, 1]);
  release();
  await vi.advanceTimersByTimeAsync(0);
  expect(reader.view().turns.map((t) => t.ordinal)).toEqual([0, 1, 2]);
  reader.close();
});

it("follows the session's leaf: a moved leaf re-reads the last turn, another branch starts afresh, a chosen one is read as asked", async () => {
  vi.useFakeTimers();
  const turns = [settled(), settled()];
  const o = owner(turns);
  // The session's current leaf and whether it still continues the one shown.
  let leaf = turns[1].id,
    continues = true;
  const read = o.client.workbenchRead;
  o.client.workbenchRead = async (request: WorkbenchRead) => {
    const reply = await read(request);
    if (request.kind !== "conversation" || reply.value.kind !== "conversation")
      return reply;
    return {
      ...reply,
      value: { ...reply.value, continues, leaf: request.leaf ?? leaf },
    };
  };
  const reader = new ConversationReader(o.client, id, () => {});
  reader.setActive(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(reader.view()).toMatchObject({ leaf: turns[1].id, pinned: false });
  // The branch grew inside its last turn: only that turn is read again.
  turns[1] = { ...turns[1], steps: [...turns[1].steps, step(2)], stable: 3 };
  leaf = "grown";
  o.reads.length = 0;
  reader.refresh();
  await vi.advanceTimersByTimeAsync(0);
  expect(kinds(o.reads)).toEqual(["conversation", "turn 1/null"]);
  expect(reader.view().turns.at(-1)?.steps).toHaveLength(3);
  // The session moved to another branch: nothing shown is kept.
  continues = false;
  leaf = "elsewhere";
  o.reads.length = 0;
  reader.refresh();
  await vi.advanceTimersByTimeAsync(0);
  expect(kinds(o.reads)).toEqual([
    "conversation",
    "turn 0/null",
    "turn 1/null",
  ]);
  // A chosen branch is read by its leaf, and following resumes on request.
  continues = true;
  o.reads.length = 0;
  reader.choose(turns[0].id);
  expect(reader.view()).toMatchObject({ pinned: true, count: 0 });
  await vi.advanceTimersByTimeAsync(0);
  expect(o.reads[0]).toMatchObject({ kind: "conversation", leaf: turns[0].id });
  for (const r of o.reads)
    if (r.kind === "conversation-turn") expect(r.leaf).toBe(turns[0].id);
  reader.choose(null);
  expect(reader.view().pinned).toBe(false);
  reader.close();
});

it("branch navigation retires pending readonly reads and cannot reuse the old observation, including an ABA selection", async () => {
  vi.useFakeTimers();
  const turns = [settled(), settled()],
    o = owner(turns);
  let release!: () => void;
  o.hold(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  const signals: AbortSignal[] = [];
  const client = {
    workbenchRead: (request: WorkbenchRead, signal?: AbortSignal) => {
      if (signal) signals.push(signal);
      return o.client.workbenchRead(request);
    },
  };
  const reader = new ConversationReader(client, id, () => {});
  reader.setActive(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(reader.view().summary).toBeUndefined();
  reader.choose(turns[0].id);
  reader.choose(null);
  expect(reader.view().summary).toBeUndefined();
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  o.hold(undefined);
  release();
  await vi.advanceTimersByTimeAsync(0);
  expect(reader.view()).toMatchObject({ pinned: false, error: "", count: 2 });
  expect(reader.view().turns).toHaveLength(2);
  reader.close();
});

it.each(["any", "timeout", "both"])(
  "detail and image reads work without %s and release their listeners on success",
  async (missing) => {
    vi.useFakeTimers();
    for (const name of missing === "both" ? ["any", "timeout"] : [missing])
      Object.defineProperty(AbortSignal, name, {
        configurable: true,
        value: undefined,
      });
    const o = owner([settled()]);
    const client = {
      workbenchRead: async (request: WorkbenchRead) =>
        request.kind === "conversation-image"
          ? {
              kind: "ok" as const,
              value: {
                kind: "conversation-image" as const,
                data: PNG,
                next: null,
                mimeType: "image/png",
              },
            }
          : o.client.workbenchRead(request),
    };
    const reader = new ConversationReader(client, id, () => {});
    try {
      reader.setActive(true);
      await vi.advanceTimersByTimeAsync(0);
      const turn = reader.view().turns[0];
      const abort = new AbortController();
      const remove = vi.spyOn(abort.signal, "removeEventListener");
      expect(await turn.detail(1, 2, abort.signal)).toEqual({
        text: "out0out1",
        args: "{}",
      });
      if (!turn.image) throw new Error("missing image reader");
      const image = await turn.image(
        { entry: "user", index: 0, mimeType: "image/png" },
        abort.signal,
      );
      expect(image.type).toBe("image/png");
      expect(remove).toHaveBeenCalledTimes(3);
      expect(abort.signal.aborted).toBe(false);
    } finally {
      reader.close();
    }
  },
);
it("a rejected detail part does not disconnect the remaining parallel read from branch cancellation", async () => {
  vi.useFakeTimers();
  const o = owner([settled()]);
  const signals: AbortSignal[] = [];
  const reader = new ConversationReader(
    {
      workbenchRead: async (request, signal) => {
        if (request.kind !== "conversation-step")
          return o.client.workbenchRead(request);
        if (!signal) throw new Error("missing read signal");
        signals.push(signal);
        if (request.part === 0) throw new Error("one part failed");
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          }),
        );
        throw new Error("must abort");
      },
    },
    id,
    () => {},
  );
  try {
    reader.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    const abort = new AbortController();
    const remove = vi.spyOn(abort.signal, "removeEventListener");
    await expect(
      reader.view().turns[0].detail(1, 2, abort.signal),
    ).rejects.toThrow("one part failed");
    expect(remove).toHaveBeenCalledTimes(1);
    expect(signals[1].aborted).toBe(false);
    reader.choose("other-branch");
    await vi.advanceTimersByTimeAsync(0);
    expect(signals[1].aborted).toBe(true);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(abort.signal.aborted).toBe(false);
  } finally {
    reader.close();
  }
});
it("one image scope spans every page and closes on cancellation of a later page", async () => {
  vi.useFakeTimers();
  const o = owner([settled()]);
  const signals: AbortSignal[] = [];
  const reader = new ConversationReader(
    {
      workbenchRead: async (request, signal) => {
        if (request.kind !== "conversation-image")
          return o.client.workbenchRead(request);
        if (!signal) throw new Error("missing read signal");
        signals.push(signal);
        if (request.offset === 0)
          return {
            kind: "ok",
            value: {
              kind: "conversation-image",
              mimeType: "image/png",
              data: "A".repeat(IMAGE_LIMITS.chunkChars),
              next: IMAGE_LIMITS.chunkChars,
            },
          };
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          }),
        );
        throw new Error("must abort");
      },
    },
    id,
    () => {},
  );
  try {
    reader.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    const abort = new AbortController();
    const add = vi.spyOn(abort.signal, "addEventListener"),
      remove = vi.spyOn(abort.signal, "removeEventListener");
    const image = reader.view().turns[0].image;
    if (!image) throw new Error("missing image reader");
    const result = expect(
      image({ entry: "user", index: 0, mimeType: "image/png" }, abort.signal),
    ).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    expect(signals).toHaveLength(2);
    expect(signals[0]).toBe(signals[1]);
    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
    abort.abort();
    await result;
    expect(remove).toHaveBeenCalledTimes(1);
  } finally {
    reader.close();
  }
});
it("failed re-observation preserves the last server status and history, never a fabricated stopped state", async () => {
  vi.useFakeTimers();
  const o = owner([{ ...settled(), status: "running" }]);
  let fail = false;
  const reader = new ConversationReader(
    {
      workbenchRead: async (request) => {
        if (fail) throw new Error("offline");
        return o.client.workbenchRead(request);
      },
    },
    id,
    () => {},
  );
  try {
    reader.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    const turns = reader.view().turns;
    fail = true;
    reader.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(reader.view()).toMatchObject({
      error: "unavailable",
      summary: { status: "running" },
      turns,
    });
    fail = false;
    reader.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(reader.view().error).toBe("");
    expect(
      o.reads.every(
        (r) => r.kind === "conversation" || r.kind === "conversation-turn",
      ),
    ).toBe(true);
  } finally {
    reader.close();
  }
});

it("a jump reads back to the named turn without a gap; a later or shown turn reads nothing", async () => {
  vi.useFakeTimers();
  const turns = Array.from({ length: 9 }, () => settled());
  const o = owner(turns);
  const reader = new ConversationReader(o.client, id, () => {});
  reader.setActive(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(reader.view().turns.map((t) => t.ordinal)).toEqual([7, 8]);
  o.reads.length = 0;
  reader.showFrom(8);
  reader.showFrom(7);
  expect(reader.view().loadingEarlier).toBe(false);
  expect(o.reads).toEqual([]);
  reader.showFrom(3);
  expect(reader.view().loadingEarlier).toBe(true);
  // What is shown stays until every turn in between is read.
  expect(reader.view().turns.map((t) => t.ordinal)).toEqual([7, 8]);
  await vi.advanceTimersByTimeAsync(0);
  expect(reader.view().turns.map((t) => t.ordinal)).toEqual([3, 4, 5, 6, 7, 8]);
  expect(reader.view()).toMatchObject({ earlier: true, loadingEarlier: false });
  expect(kinds(o.reads).sort()).toEqual([
    "conversation",
    "turn 3/null",
    "turn 4/null",
    "turn 5/null",
    "turn 6/null",
  ]);
  // A second jump asked for while the first is read is served after it.
  let release!: () => void;
  o.hold(new Promise<void>((resolve) => (release = resolve)));
  reader.showFrom(2);
  await vi.advanceTimersByTimeAsync(0);
  reader.showFrom(0);
  expect(reader.view().loadingEarlier).toBe(true);
  o.hold(undefined);
  release();
  await vi.advanceTimersByTimeAsync(0);
  expect(reader.view().turns.map((t) => t.ordinal)).toEqual([
    0, 1, 2, 3, 4, 5, 6, 7, 8,
  ]);
  expect(reader.view()).toMatchObject({
    earlier: false,
    loadingEarlier: false,
  });
  reader.close();
});

it("a branch chosen at one of its messages opens there, never with fewer than the newest turns", async () => {
  vi.useFakeTimers();
  const turns = Array.from({ length: 6 }, () => settled());
  const o = owner(turns);
  // Another branch: the owner says it does not continue the one shown.
  const read = o.client.workbenchRead;
  o.client.workbenchRead = async (request: WorkbenchRead) => {
    const reply = await read(request);
    if (request.kind !== "conversation" || reply.value.kind !== "conversation")
      return reply;
    const leaf = request.leaf ?? reply.value.leaf;
    return {
      ...reply,
      value: {
        ...reply.value,
        leaf,
        continues: request.known === null || request.known === leaf,
      },
    };
  };
  const reader = new ConversationReader(o.client, id, () => {});
  reader.setActive(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(reader.view().turns.map((t) => t.ordinal)).toEqual([4, 5]);
  // A sibling version of the third message: its branch is shown from there.
  reader.choose("version-b", 2);
  expect(reader.view()).toMatchObject({ pinned: true, count: 0 });
  await vi.advanceTimersByTimeAsync(0);
  expect(reader.view().turns.map((t) => t.ordinal)).toEqual([2, 3, 4, 5]);
  // The same branch named again only reads further back.
  o.reads.length = 0;
  reader.choose("version-b", 1);
  await vi.advanceTimersByTimeAsync(0);
  expect(reader.view().turns.map((t) => t.ordinal)).toEqual([1, 2, 3, 4, 5]);
  expect(kinds(o.reads).sort()).toEqual(["conversation", "turn 1/null"]);
  // Chosen at its last message: the newest turns are shown as usual.
  reader.choose("version-c", 5);
  await vi.advanceTimersByTimeAsync(0);
  expect(reader.view().turns.map((t) => t.ordinal)).toEqual([4, 5]);
  // Following the latest again starts at its end.
  reader.choose(null);
  await vi.advanceTimersByTimeAsync(0);
  expect(reader.view()).toMatchObject({ pinned: false });
  expect(reader.view().turns.map((t) => t.ordinal)).toEqual([4, 5]);
  reader.close();
});

it("messages waiting for the running reply and ones it ended without delivering are carried as the head states them", async () => {
  vi.useFakeTimers();
  const o = owner([settled()]);
  const reader = new ConversationReader(o.client, id, () => {});
  reader.setActive(true);
  await vi.advanceTimersByTimeAsync(0);
  // A head that states neither has none: nothing is invented.
  expect(reader.view()).toMatchObject({ pending: [], undelivered: [] });
  const pending = [
    { commandId: crypto.randomUUID(), mode: "steer" as const, text: "first" },
    { commandId: crypto.randomUUID(), mode: "queue" as const, text: "then" },
  ];
  const undelivered = [
    {
      commandId: crypto.randomUUID(),
      text: "left behind",
      status: "failed" as const,
      notice: "not delivered",
    },
  ];
  Object.assign(o.extra, { pending, undelivered });
  reader.refresh();
  await vi.advanceTimersByTimeAsync(0);
  expect(reader.view()).toMatchObject({ pending, undelivered });
  // Delivered or withdrawn: the next head no longer lists them.
  delete o.extra.pending;
  delete o.extra.undelivered;
  reader.refresh();
  await vi.advanceTimersByTimeAsync(0);
  expect(reader.view()).toMatchObject({ pending: [], undelivered: [] });
  // Another branch is observed afresh, never with this one's waiting rows.
  Object.assign(o.extra, { pending });
  reader.refresh();
  await vi.advanceTimersByTimeAsync(0);
  expect(reader.view().pending).toHaveLength(2);
  delete o.extra.pending;
  reader.choose("another-leaf");
  expect(reader.view()).toMatchObject({ pending: [], undelivered: [] });
  reader.close();
});

it("publishes a terminal head only with its final body", async () => {
  vi.useFakeTimers();
  const live = { ...settled(), status: "running" as ChatStatus, stable: 1 };
  const o = owner([live]);
  const reader = new ConversationReader(o.client, id, () => {});
  reader.setActive(true);
  await vi.advanceTimersByTimeAsync(0);
  const before = reader.view();
  let release!: () => void;
  o.hold(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  live.status = "completed";
  live.stable = 3;
  live.steps.push({ ...step(2), role: "assistant", text: "final text" });
  reader.refresh();
  await vi.advanceTimersByTimeAsync(0);
  expect(reader.view()).toBe(before);
  release();
  await vi.advanceTimersByTimeAsync(0);
  expect(reader.view().summary?.status).toBe("completed");
  expect(reader.view().turns[0].steps.at(-1)?.text).toBe("final text");
  reader.close();
});

it("retains capture identities through invisible messages, durable handoff, repeated text and earlier pages", async () => {
  vi.useFakeTimers();
  const text = (
    message: string,
    block: number,
    body = "same answer",
  ): ChatStep => ({
    ...step(1),
    id: `preview:${message}:${block}`,
    renderId: `capture:${message}:${block}`,
    version: "v1",
    state: "completed",
    role: "assistant",
    text: body,
  });
  const first = text("a", 0),
    last = text("c", 3);
  const think: ChatStep = {
    ...text("c", 1),
    role: "thinking",
    text: "",
    parts: 0,
    state: "streaming",
  };
  const tool: ChatStep = {
    ...text("c", 2),
    role: "tool",
    text: "",
    state: "running",
  };
  const live: Turn = {
    id: "command",
    status: "running",
    stable: 0,
    steps: [
      { ...step(0), renderId: "command:command:user" },
      first,
      // Empty assistant is not a displayed text row, but is still a source step.
      { ...text("empty", 0, "") },
      think,
      tool,
      last,
    ],
  };
  const turns = [settled(), settled(), live];
  const o = owner(turns);
  const reader = new ConversationReader(o.client, id, () => {});
  reader.setActive(true);
  await vi.advanceTimersByTimeAsync(0);
  const prior = reader.view().turns[1];
  live.id = "pi-user";
  live.steps = live.steps.map((s) => ({ ...s, id: `pi:${s.id}` }));
  live.steps[3] = { ...live.steps[3], state: "completed", parts: 1 };
  live.steps[4] = {
    ...live.steps[4],
    state: "completed",
    version: "output-changed-same-parts",
  };
  live.status = "completed";
  live.stable = live.steps.length;
  reader.refresh();
  await vi.advanceTimersByTimeAsync(0);
  const durable = reader.view().turns[1];
  expect(durable.renderId).toBe(prior.renderId);
  expect(durable.header.id).not.toBe(prior.header.id);
  expect(durable.steps.map((s) => s.renderId)).toEqual(
    prior.steps.map((s) => s.renderId),
  );
  expect(
    durable.steps
      .filter((s) => s.role === "assistant" && s.text)
      .map((s) => s.text),
  ).toEqual(["same answer", "same answer"]);
  reader.loadEarlier();
  await vi.advanceTimersByTimeAsync(0);
  expect(reader.view().turns.map((t) => t.ordinal)).toEqual([0, 1, 2]);
  expect(reader.view().turns.at(-1)).toBe(durable);
  reader.setActive(false);
  reader.setActive(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(reader.view().turns.at(-1)).toBe(durable);
  reader.close();
});

it("rejects a changing paged snapshot instead of publishing a partial or mixed timeline", async () => {
  vi.useFakeTimers();
  const live = {
    ...settled(STEP_READ + 2),
    status: "running" as ChatStatus,
    stable: 0,
  };
  const o = owner([live]);
  let race = false;
  const reader = new ConversationReader(
    {
      workbenchRead: async (request) => {
        const reply = await o.client.workbenchRead(request);
        if (
          race &&
          request.kind === "conversation-turn" &&
          request.before !== null &&
          reply.value.kind === "conversation-turn"
        )
          reply.value.turn.steps++;
        return reply;
      },
    },
    id,
    () => {},
  );
  reader.setActive(true);
  await vi.advanceTimersByTimeAsync(0);
  const prior = reader.view().turns[0];
  race = true;
  reader.refresh();
  await vi.advanceTimersByTimeAsync(0);
  expect(reader.view().error).toBe("stale");
  expect(reader.view().turns[0]).toBe(prior);
  race = false;
  reader.refresh();
  await vi.advanceTimersByTimeAsync(0);
  expect(reader.view().error).toBe("");
  expect(reader.view().turns[0]).toBe(prior);
  reader.close();
});

it("fences detail replies by full-content version even with equal parts, and after cancellation", async () => {
  vi.useFakeTimers();
  const live = settled();
  live.steps[1] = {
    ...live.steps[1],
    renderId: "capture:tool:0",
    version: "v1",
    state: "running",
  };
  const o = owner([live]);
  let version = "v1";
  let release: (() => void) | undefined;
  let hold = false;
  const reader = new ConversationReader(
    {
      workbenchRead: async (request) => {
        const reply = await o.client.workbenchRead(request);
        if (reply.value.kind === "conversation-step") {
          reply.value.item.renderId = "capture:tool:0";
          reply.value.item.version = version;
          if (hold)
            await new Promise<void>((resolve) => {
              release = resolve;
            });
        }
        return reply;
      },
    },
    id,
    () => {},
  );
  reader.setActive(true);
  await vi.advanceTimersByTimeAsync(0);
  const turn = reader.view().turns[0];
  expect(await turn.detail(1, 1, new AbortController().signal)).toEqual({
    text: "out0",
    args: "{}",
  });
  version = "v2";
  await expect(turn.detail(1, 1, new AbortController().signal)).rejects.toThrow(
    "stale",
  );
  version = "v1";
  hold = true;
  const abort = new AbortController();
  const pending = expect(turn.detail(1, 1, abort.signal)).rejects.toThrow(
    "stale",
  );
  await vi.advanceTimersByTimeAsync(0);
  abort.abort();
  release?.();
  await pending;
  reader.close();
});

it("closing an in-flight observation cannot publish or recreate a poll timer", async () => {
  vi.useFakeTimers();
  const o = owner([settled()]);
  let release!: () => void;
  o.hold(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  const notify = vi.fn();
  const reader = new ConversationReader(o.client, id, notify);
  reader.setActive(true);
  await vi.advanceTimersByTimeAsync(0);
  reader.close();
  release();
  await vi.advanceTimersByTimeAsync(0);
  expect(notify).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(independentScenarios)(
  "$kind/$order/$terminal: reads the backend-constrained independent execution timeline without merging results, including earlier history and a cold reconnect",
  async ({ kind, order, terminal }) => {
    vi.useFakeTimers();
    const ids = independentFixtureIds();
    const points = independentTimeline(order, terminal);
    let snapshot = independentResults(ids, kind, points[0]);
    const reads: WorkbenchRead[] = [];
    const client = {
      workbenchRead: async (request: WorkbenchRead) => {
        reads.push(request);
        return {
          kind: "ok" as const,
          value: decodeWorkbenchResult(independentRead(snapshot, request)),
        };
      },
    };
    let reader = new ConversationReader(client, ids.conversation, () => {});
    reader.setActive(true);
    try {
      for (const point of points) {
        snapshot = independentResults(ids, kind, point);
        if (point.action === "reconnect") {
          reader.close();
          reader = new ConversationReader(client, ids.conversation, () => {});
          reader.setActive(true);
        } else reader.refresh();
        await vi.advanceTimersByTimeAsync(0);
        const view = reader.view(),
          turn = view.turns.at(-1);
        if (!turn) throw Error("missing timeline turn");
        expect(view.error, point.action).toBe("");
        expect(turn.renderId).toBe(`command:${ids.command}:user`);
        expect(turn.steps, point.action).toEqual(snapshot.turn.steps);
        expect(new Set(turn.steps.map((s) => s.renderId)).size).toBe(
          turn.steps.length,
        );
        if (point.executed) {
          const execution = turn.steps.filter(
            (s) => s.renderId === `call:${ids.execution}`,
          );
          expect(execution).toHaveLength(1);
          expect(execution[0].parts).toBe(1);
          expect(execution[0].id).toBe(
            point.durable ? ids.call : ids.execution,
          );
        }
        if (point.repeated) {
          expect(
            turn.steps
              .filter((s) => s.renderId?.startsWith("call:"))
              .map((s) => s.renderId),
          ).toEqual([`call:${ids.execution}`, `call:${ids.repeatExecution}`]);
        }
        if (point.action === "result-mark" || point.action === "reconnect") {
          expect(view.turns.map((t) => t.ordinal)).toEqual([2, 3]);
          reader.loadEarlier();
          await vi.advanceTimersByTimeAsync(0);
          expect(reader.view().turns.map((t) => t.ordinal)).toEqual([
            0, 1, 2, 3,
          ]);
          expect(reader.view().turns.at(-1)).toBe(turn);
          expect(
            reader
              .view()
              .turns.slice(0, -1)
              .map((t) => t.steps),
          ).toEqual(snapshot.history.map((t) => t.steps));
        }
      }
      // Listing observations and pagination never read unopened tool details.
      expect(reads.filter((r) => r.kind === "conversation-step")).toEqual([]);
    } finally {
      reader.close();
    }
  },
);

it("independent detail reads reject same-part stale versions, equal-body wrong identities and replies from a retired conversation", async () => {
  vi.useFakeTimers();
  const ids = independentFixtureIds(),
    points = independentTimeline("final-first");
  const at = (action: (typeof points)[number]["action"]) => {
    const point = points.find((p) => p.action === action);
    if (!point) throw Error("missing timeline checkpoint");
    return independentResults(ids, "ambiguous", point);
  };
  let snapshot = at("tool-first"),
    hold = false;
  let pending: { signal?: AbortSignal; release(): void } | undefined;
  let substituteEqualResult = false;
  const client = {
    workbenchRead: async (request: WorkbenchRead, signal?: AbortSignal) => {
      let value = decodeWorkbenchResult(independentRead(snapshot, request));
      if (request.kind === "conversation-step") {
        if (substituteEqualResult && value.kind === "conversation-step") {
          const other = snapshot.tools.at(-1);
          if (!other) throw Error("missing repeated execution");
          value = { ...value, item: other.item };
        }
        if (hold)
          await new Promise<void>((resolve) => {
            pending = { signal, release: resolve };
          });
      }
      return { kind: "ok" as const, value };
    },
  };
  const reader = new ConversationReader(client, ids.conversation, () => {});
  reader.setActive(true);
  try {
    await vi.advanceTimersByTimeAsync(0);
    const first = reader.view().turns.at(-1);
    if (!first) throw Error("missing first observation");
    const index = first.steps.findIndex(
      (s) => s.renderId === `call:${ids.execution}`,
    );
    expect(await first.detail(index, 1, new AbortController().signal)).toEqual({
      text: "first output",
      args: "{}",
    });
    snapshot = at("tool-later");
    await expect(
      first.detail(index, 1, new AbortController().signal),
    ).rejects.toThrow("stale");
    snapshot = at("repeat-result");
    reader.refresh();
    await vi.advanceTimersByTimeAsync(0);
    const repeated = reader.view().turns.at(-1);
    if (!repeated) throw Error("missing repeated observation");
    const actual = snapshot.tools.slice(-2);
    expect(actual[0].item.text).toBe(actual[1].item.text);
    expect(actual[0].item.version).toBe(actual[1].item.version);
    substituteEqualResult = true;
    await expect(
      repeated.detail(index, 1, new AbortController().signal),
    ).rejects.toThrow("stale");
    substituteEqualResult = false;
    hold = true;
    const stale = expect(
      repeated.detail(index, 1, new AbortController().signal),
    ).rejects.toThrow("stale");
    await vi.advanceTimersByTimeAsync(0);
    reader.close();
    expect(pending?.signal?.aborted).toBe(true);
    if (!pending) throw Error("missing pending detail");
    pending.release();
    await stale;
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    reader.close();
  }
});
