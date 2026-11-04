import { afterEach, expect, it, vi } from "vitest";
import { IMAGE_LIMITS } from "../../src/image-content.mjs";
import {
  type ChatStatus,
  type ChatStep,
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
  expect(reader.view().count).toBe(3);
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
  expect(reader.view().summary).toBeDefined();
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
