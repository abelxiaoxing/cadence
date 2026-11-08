// Controlled hook lifetimes and deferred client replies, not a browser or owner.
import type { EffectCallback } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { ModelCatalog, Reply } from "../../src/service-contract.ts";
import { publicError } from "../../src/service-contract.ts";
import {
  type ModelAvailability,
  useModelCatalog,
} from "../../web/src/client/use-model-catalog";

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
    const previous = hooks.cells[index];
    if (!previous || changed(previous.deps, deps))
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
      const previous = hooks.cells[index];
      if (!previous || changed(previous.deps, deps)) {
        hooks.cells[index] = {
          value: undefined,
          deps,
          cleanup: previous?.cleanup,
        };
        hooks.effects.set(index, effect);
      }
    },
  };
});
const ready = (
  epoch = "epoch-a",
  attachmentVersion = 1,
): ModelAvailability => ({ status: "ready", epoch, attachmentVersion });
const catalog = (epoch = "epoch-a", model = "m"): ModelCatalog => ({
  version: { epoch, accessGeneration: 1, configRev: 1, catalogId: "catalog" },
  selected: null,
  remembered: null,
  status: "complete",
  withheld: 0,
  entries: [
    {
      provider: "fixture",
      model,
      api: "openai-completions",
      thinking: [{ level: "off", selectable: true }],
      eligibility: "candidate",
    },
  ],
});
function fixture() {
  const requests: {
    signal?: AbortSignal;
    resolve(reply: Reply<ModelCatalog>): void;
    reject(error: Error): void;
  }[] = [];
  const client = {
    models: vi.fn(
      (signal?: AbortSignal) =>
        new Promise<Reply<ModelCatalog>>((resolve, reject) => {
          requests.push({ signal, resolve, reject });
        }),
    ),
  };
  return { client, requests };
}
function render(
  client: ReturnType<typeof fixture>["client"],
  availability: ModelAvailability,
  refresh = "0",
) {
  hooks.cursor = 0;
  // biome-ignore lint/correctness/useHookAtTopLevel: controlled hook fixture, not a React renderer.
  return useModelCatalog(client, availability, refresh);
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
function unmount() {
  for (const cell of hooks.cells) cell.cleanup?.();
}
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
afterEach(() => {
  unmount();
  hooks.cursor = 0;
  hooks.cells = [];
  hooks.effects.clear();
});

it.each([
  "stopped",
  "not-started",
  "preparing",
  "connecting",
  "unavailable",
  "incompatible",
] as const)(
  "%s neither fetches models nor makes manual refresh activate anything",
  (status) => {
    const { client } = fixture();
    const read = render(client, { status });
    commit();
    read.reread();
    const again = render(client, { status });
    commit();
    expect(client.models).not.toHaveBeenCalled();
    expect(again).toMatchObject({
      catalog: undefined,
      error: undefined,
      loading: false,
    });
    expect(again.isCurrent()).toBe(false);
    expect(again.accept(catalog())).toBe(false);
  },
);
it("stopped to ready reads automatically using the same client, without a picker click or a Send", async () => {
  const { client, requests } = fixture();
  render(client, { status: "stopped" });
  commit();
  expect(client.models).not.toHaveBeenCalled();
  expect(render(client, ready()).loading).toBe(true);
  commit();
  expect(requests).toHaveLength(1);
  requests[0].resolve({ kind: "ok", value: catalog() });
  await settle();
  expect(render(client, ready()).catalog?.entries[0].model).toBe("m");
  commit();
  render(client, ready());
  commit();
  expect(requests).toHaveLength(1);
});
it.each(["owner", "attachment", "context"])(
  "a changed %s invalidates old display and starts one fresh read",
  async (change) => {
    const { client, requests } = fixture();
    render(client, ready());
    commit();
    requests[0].resolve({ kind: "ok", value: catalog() });
    await settle();
    const before = render(client, ready());
    expect(before.catalog).toBeDefined();
    const availability = ready(
      change === "owner" ? "epoch-b" : "epoch-a",
      change === "attachment" ? 2 : 1,
    );
    const refresh = change === "context" ? "context-2" : "0";
    const next = render(client, availability, refresh);
    expect(next).toMatchObject({
      catalog: undefined,
      error: undefined,
      loading: true,
    });
    expect(before.isCurrent()).toBe(false);
    expect(before.accept(catalog())).toBe(false);
    commit();
    expect(requests).toHaveLength(2);
    requests[1].resolve({
      kind: "ok",
      value: catalog(change === "owner" ? "epoch-b" : "epoch-a", "new"),
    });
    await settle();
    expect(
      render(client, availability, refresh).catalog?.entries[0].model,
    ).toBe("new");
  },
);
it.each(["stop", "restart", "client"])(
  "a late reply after %s cannot populate the new view, even before effect cleanup",
  async (change) => {
    const old = fixture(),
      next = fixture();
    render(old.client, ready());
    commit();
    const client = change === "client" ? next.client : old.client;
    const availability =
      change === "stop" ? { status: "stopped" as const } : ready("epoch-b");
    render(client, availability);
    expect(old.requests[0].signal?.aborted).toBe(false);
    old.requests[0].resolve({ kind: "ok", value: catalog() });
    await settle();
    expect(render(client, availability).catalog).toBeUndefined();
    commit();
    expect(old.requests[0].signal?.aborted).toBe(true);
    expect(
      change === "stop"
        ? old.requests.length
        : change === "client"
          ? next.requests.length
          : old.requests.length,
    ).toBe(change === "restart" ? 2 : 1);
  },
);
it("an away-and-back same-epoch observation cannot revive its original pending read", async () => {
  const { client, requests } = fixture();
  render(client, ready());
  commit();
  render(client, { status: "unavailable" });
  commit();
  render(client, ready());
  commit();
  requests[0].resolve({ kind: "ok", value: catalog("epoch-a", "obsolete") });
  await settle();
  expect(render(client, ready()).catalog).toBeUndefined();
  requests[1].resolve({ kind: "ok", value: catalog("epoch-a", "fresh") });
  await settle();
  expect(render(client, ready()).catalog?.entries[0].model).toBe("fresh");
});
it("a live read failure has a scoped retry; stopping removes that error without another request", async () => {
  const { client, requests } = fixture();
  render(client, ready());
  commit();
  requests[0].resolve({ kind: "error", error: publicError("unavailable") });
  await settle();
  const failed = render(client, ready());
  expect(failed.error).toBe("unavailable");
  expect(failed.loading).toBe(false);
  failed.reread();
  expect(failed.isCurrent()).toBe(false);
  expect(failed.accept(catalog())).toBe(false);
  expect(render(client, ready())).toMatchObject({
    error: undefined,
    catalog: undefined,
    loading: true,
  });
  commit();
  requests[1].resolve({ kind: "ok", value: catalog() });
  await settle();
  expect(render(client, ready()).catalog).toBeDefined();
  const stopped = render(client, { status: "stopped" });
  commit();
  stopped.reread();
  expect(stopped).toMatchObject({
    error: undefined,
    catalog: undefined,
    loading: false,
  });
  expect(requests).toHaveLength(2);
});
it("a reply from an unexpected owner epoch is stale rather than selectable", async () => {
  const { client, requests } = fixture();
  render(client, ready());
  commit();
  requests[0].resolve({ kind: "ok", value: catalog("wrong-epoch") });
  await settle();
  expect(render(client, ready())).toMatchObject({
    catalog: undefined,
    error: "stale",
    loading: false,
  });
});
it("unmount cancels its read and rejects both late read results and choice installation", async () => {
  const { client, requests } = fixture();
  const view = render(client, ready());
  commit();
  unmount();
  expect(requests[0].signal?.aborted).toBe(true);
  requests[0].reject(new Error("late transport failure"));
  await settle();
  expect(view.isCurrent()).toBe(false);
  expect(view.accept(catalog())).toBe(false);
});

it("a live transport rejection reports failure, while a late rejection cannot overwrite a recovered catalog", async () => {
  const { client, requests } = fixture();
  render(client, ready());
  commit();
  requests[0].reject(new Error("network"));
  await settle();
  const failed = render(client, ready());
  expect(failed.error).toBe("unavailable");
  failed.reread();
  render(client, ready());
  commit();
  const oldRead = render(client, ready());
  oldRead.reread();
  render(client, ready());
  commit();
  requests[2].resolve({ kind: "ok", value: catalog("epoch-a", "fresh") });
  await settle();
  requests[1].reject(new Error("obsolete failure"));
  await settle();
  const current = render(client, ready());
  expect(current.error).toBeUndefined();
  expect(current.catalog?.entries[0].model).toBe("fresh");
});
