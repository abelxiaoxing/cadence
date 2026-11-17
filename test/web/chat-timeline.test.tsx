// Controlled hook lifetimes and deferred reads; not a mounted DOM or browser.
import type { EffectCallback } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { ChatStep } from "../../src/service/contracts/workbench.ts";
import type { TurnSource } from "../../web/src/client/conversation-reader";
import { useConversation } from "../../web/src/client/use-conversation";
import { useWorkbench } from "../../web/src/client/use-workbench";
import {
  recordedTurn,
  useStepDetail,
} from "../../web/src/components/workspace/turn-source";

const hooks = vi.hoisted(() => ({
  cursor: 0,
  cells: [] as {
    value: unknown;
    deps?: readonly unknown[];
    cleanup?: () => void;
  }[],
  effects: new Map<number, EffectCallback>(),
}));
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  const changed = (old?: readonly unknown[], next?: readonly unknown[]) =>
    !old ||
    !next ||
    old.length !== next.length ||
    next.some((v, i) => !Object.is(v, old[i]));
  const memo = (factory: () => unknown, deps?: readonly unknown[]) => {
    const index = hooks.cursor++;
    const prior = hooks.cells[index];
    if (!prior || changed(prior.deps, deps))
      hooks.cells[index] = { value: factory(), deps };
    return hooks.cells[index].value;
  };
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = hooks.cursor++;
      hooks.cells[index] ??= {
        value: typeof initial === "function" ? initial() : initial,
      };
      return [
        hooks.cells[index].value,
        (update: unknown) => {
          hooks.cells[index].value =
            typeof update === "function"
              ? update(hooks.cells[index].value)
              : update;
        },
      ];
    },
    useRef: (initial: unknown) => {
      const index = hooks.cursor++;
      hooks.cells[index] ??= { value: { current: initial } };
      return hooks.cells[index].value;
    },
    useMemo: memo,
    useCallback: (fn: unknown, deps: readonly unknown[]) =>
      memo(() => fn, deps),
    useEffect: (effect: EffectCallback, deps?: readonly unknown[]) => {
      const index = hooks.cursor++;
      const prior = hooks.cells[index];
      if (!prior || changed(prior.deps, deps)) {
        hooks.cells[index] = {
          value: undefined,
          deps,
          cleanup: prior?.cleanup,
        };
        hooks.effects.set(index, effect);
      }
    },
  };
});
function render<T>(hook: () => T): T {
  hooks.cursor = 0;
  return hook();
}
function commit() {
  const effects = [...hooks.effects];
  hooks.effects.clear();
  for (const [index, effect] of effects) {
    hooks.cells[index].cleanup?.();
    const cleanup = effect();
    hooks.cells[index].cleanup =
      typeof cleanup === "function" ? cleanup : undefined;
  }
}
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
afterEach(() => {
  for (const cell of hooks.cells) cell.cleanup?.();
  hooks.cells = [];
  hooks.cursor = 0;
  hooks.effects.clear();
  vi.useRealTimers();
});
function fixture() {
  const requests: {
    signal: AbortSignal;
    resolve(value: { text: string; args: string }): void;
  }[] = [];
  const detail = vi.fn(
    (_index: number, _parts: number, signal: AbortSignal) =>
      new Promise<{ text: string; args: string }>((resolve) => {
        requests.push({ signal, resolve });
      }),
  );
  const step: ChatStep = {
    id: "preview",
    renderId: "capture:m:2",
    version: "v1",
    state: "running",
    role: "tool",
    parts: 1,
    text: "",
    clipped: false,
    error: false,
    name: "bash",
    target: "",
  };
  const turn: TurnSource = {
    renderId: "command:user",
    header: {
      id: "turn",
      status: "running",
      steps: 1,
      stable: 0,
      entry: null,
      at: 0,
      notice: "",
      omitted: { thinking: false, other: false, media: false },
    },
    steps: [step],
    detail,
  };
  return { step, turn, requests, detail };
}

it("reads only opened details, refreshes equal-part revisions and every reply terminal transition", async () => {
  const { turn, step, requests, detail } = fixture();
  render(() => useStepDetail(turn, 0, step, false));
  commit();
  expect(detail).not.toHaveBeenCalled();
  render(() => useStepDetail(turn, 0, step, true));
  commit();
  requests[0].resolve({ text: "first", args: "{}" });
  await settle();
  expect(render(() => useStepDetail(turn, 0, step, true)).value?.text).toBe(
    "first",
  );
  const changed = { ...step, version: "v2" };
  // Pending update keeps the text already displayed, not a blank loading card.
  expect(render(() => useStepDetail(turn, 0, changed, true)).value?.text).toBe(
    "first",
  );
  commit();
  expect(detail).toHaveBeenCalledTimes(2);
  requests[1].resolve({ text: "changed, still one part", args: "{}" });
  await settle();
  expect(render(() => useStepDetail(turn, 0, changed, true)).value?.text).toBe(
    "changed, still one part",
  );
  let calls = 2;
  for (const status of [
    "completed",
    "failed",
    "canceled",
    "unknown",
  ] as const) {
    const final = { ...turn, header: { ...turn.header, status } };
    render(() => useStepDetail(final, 0, changed, true));
    commit();
    expect(detail).toHaveBeenCalledTimes(++calls);
    requests[calls - 1].resolve({ text: status, args: "{}" });
    await settle();
    expect(
      render(() => useStepDetail(final, 0, changed, true)).value?.text,
    ).toBe(status);
  }
  render(() => useStepDetail(turn, 0, changed, false));
  commit();
  expect(requests[calls - 1].signal.aborted).toBe(true);
  expect(detail).toHaveBeenCalledTimes(calls);
});

it("ignores late success before effect cleanup, after closing, on a newer revision and after navigation", async () => {
  const { turn, step, requests } = fixture();
  render(() => useStepDetail(turn, 0, step, true));
  commit();
  const next = { ...step, version: "v2" };
  render(() => useStepDetail(turn, 0, next, true));
  requests[0].resolve({ text: "obsolete revision", args: "" });
  await settle();
  expect(
    render(() => useStepDetail(turn, 0, next, true)).value,
  ).toBeUndefined();
  commit();
  render(() => useStepDetail(turn, 0, next, false));
  requests[1].resolve({ text: "closed reply", args: "" });
  await settle();
  expect(
    render(() => useStepDetail(turn, 0, next, false)).value,
  ).toBeUndefined();
  commit();
  render(() => useStepDetail(turn, 0, next, true));
  commit();
  const other = {
    ...turn,
    renderId: "another-session-user",
    header: { ...turn.header, id: "other" },
  };
  render(() => useStepDetail(other, 0, next, true));
  requests[2].resolve({ text: "wrong session", args: "" });
  await settle();
  expect(
    render(() => useStepDetail(other, 0, next, true)).value,
  ).toBeUndefined();
  commit();
  requests[3].resolve({ text: "current", args: "" });
  await settle();
  expect(render(() => useStepDetail(other, 0, next, true)).value?.text).toBe(
    "current",
  );
});

it("keeps a readable detail through coordinate/preview handoff and legacy history remains lazy", async () => {
  const { turn, step, requests } = fixture();
  render(() => useStepDetail(turn, 0, step, true));
  commit();
  requests[0].resolve({ text: "visible", args: "" });
  await settle();
  const durable = { ...turn, header: { ...turn.header, id: "pi-user" } };
  const moved = { ...step, id: "pi-entry:2" };
  expect(render(() => useStepDetail(durable, 3, moved, true)).value?.text).toBe(
    "visible",
  );
  commit();
  expect(requests).toHaveLength(2);
  const legacy = {
    ...moved,
    renderId: undefined,
    version: undefined,
    state: undefined,
  };
  expect(
    render(() => useStepDetail(durable, 3, legacy, false)).value,
  ).toBeUndefined();
  commit();
  expect(requests).toHaveLength(2);
});

it("workflow polling reads a final snapshot when the interval stops and retires a pending live read", async () => {
  vi.useFakeTimers();
  const requests: { signal?: AbortSignal; resolve(value: unknown): void }[] =
    [];
  const client = {
    workbenchRead: vi.fn(
      (_request: unknown, signal?: AbortSignal) =>
        new Promise((resolve) => {
          requests.push({ signal, resolve });
        }),
    ),
  } as unknown as Parameters<typeof useWorkbench>[0];
  const request = {
    kind: "workflow-detail" as const,
    id: crypto.randomUUID(),
    stepId: "step",
  };
  render(() => useWorkbench(client, null, 0));
  commit();
  expect(requests).toHaveLength(0);
  render(() => useWorkbench(client, request, 1000));
  commit();
  requests[0].resolve({ kind: "ok", value: { kind: "file", text: "partial" } });
  await settle();
  await vi.advanceTimersByTimeAsync(1000);
  expect(requests).toHaveLength(2);
  render(() => useWorkbench(client, request, 0));
  commit();
  expect(requests[1].signal?.aborted).toBe(true);
  expect(requests).toHaveLength(3);
  requests[2].resolve({ kind: "ok", value: { kind: "file", text: "final" } });
  await settle();
  requests[1].resolve({
    kind: "ok",
    value: { kind: "file", text: "obsolete" },
  });
  await settle();
  expect(render(() => useWorkbench(client, request, 0)).value).toMatchObject({
    text: "final",
  });
  await vi.advanceTimersByTimeAsync(10000);
  expect(requests).toHaveLength(3);
});

it("conversation navigation hides the previous observation and its actions before effects run", async () => {
  vi.useFakeTimers();
  const client: Parameters<typeof useConversation>[0] = {
    workbenchRead: async () => ({
      kind: "ok",
      value: {
        kind: "conversation",
        summary: null,
        leaf: null,
        continues: true,
        turns: 0,
        branches: 0,
        runs: [],
        attempt: null,
      },
    }),
  };
  render(() => useConversation(client, "first", true));
  commit();
  render(() => useConversation(client, "first", true));
  commit();
  await vi.advanceTimersByTimeAsync(0);
  expect(
    render(() => useConversation(client, "first", true)).summary,
  ).toBeNull();
  const next = render(() => useConversation(client, "next", true));
  expect(next.summary).toBeUndefined();
  expect(next.turns).toEqual([]);
  next.choose("old-branch"); // No retired reader is exposed before initialization.
  commit();
  expect(render(() => useConversation(client, "next", true)).pinned).toBe(
    false,
  );
});

it("workflow retained tool text refreshes with the same parts and without new presentation metadata", async () => {
  const snapshot = (text: string, status: "running" | "failed") =>
    recordedTurn({
      id: "child",
      epoch: "epoch",
      status,
      notice: "",
      omitted: { thinking: false, media: false, other: false },
      items: [
        {
          id: "call",
          role: "tool",
          name: "bash",
          args: "{}",
          text,
          error: false,
        },
      ],
    });
  const first = snapshot("first output", "running");
  render(() => useStepDetail(first, 0, first.steps[0], true));
  commit();
  await settle();
  expect(
    render(() => useStepDetail(first, 0, first.steps[0], true)).value?.text,
  ).toBe("first output");
  const next = snapshot("later output", "running");
  expect(next.steps[0].parts).toBe(first.steps[0].parts);
  render(() => useStepDetail(next, 0, next.steps[0], true));
  commit();
  await settle();
  expect(
    render(() => useStepDetail(next, 0, next.steps[0], true)).value?.text,
  ).toBe("later output");
  const final = snapshot("final output despite failed reply", "failed");
  render(() => useStepDetail(final, 0, final.steps[0], true));
  commit();
  await settle();
  expect(
    render(() => useStepDetail(final, 0, final.steps[0], true)).value?.text,
  ).toBe("final output despite failed reply");
});
