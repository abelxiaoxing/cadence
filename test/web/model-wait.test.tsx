// Controlled composer transitions, not a DOM/browser or a real owner.
import { type EffectCallback, isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  ModelCatalog,
  ModelSelector,
} from "../../src/service-contract.ts";
import type { ModelAvailability } from "../../web/src/client/use-model-catalog";
import {
  ChatComposer,
  type ChatComposerProps,
} from "../../web/src/components/workspace/ChatComposer";
import { ChatWorkspace } from "../../web/src/components/workspace/ChatWorkspace";

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
    useLayoutEffect: () => {
      hooks.cursor++;
    },
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
const facts = vi.hoisted(() => ({
  enabled: false,
  commands: [] as string[],
  no: () => {},
  t: (key: string) => key,
}));
vi.mock("../../web/src/i18n/locale", async (original) => ({
  ...(await original<typeof import("../../web/src/i18n/locale")>()),
  useT: () => ({ t: facts.t, tx: facts.t }),
}));
vi.mock("../../web/src/client/use-workbench", async (original) => ({
  ...(await original<typeof import("../../web/src/client/use-workbench")>()),
  useWorkbench: (_client: unknown, request: { kind: string } | null) => ({
    refresh: facts.no,
    value:
      request?.kind === "conversation-context"
        ? {
            kind: request.kind,
            context: { id: "chat", cwd: "/project", revision: 0, model: null },
          }
        : {
            kind: "cadence-conversation",
            state: {
              id: "chat",
              revision: 0,
              enabled: facts.enabled,
              runs: [],
              proposal: null,
              head: null,
            },
          },
  }),
}));
vi.mock("../../web/src/client/use-conversation", () => ({
  useConversation: () => ({
    summary: null,
    leaf: null,
    turns: [],
    commands: facts.commands,
    pending: [],
    undelivered: [],
    runs: [],
    count: 0,
    branches: 1,
    pinned: false,
    earlier: false,
    refresh: facts.no,
    choose: facts.no,
  }),
}));
vi.mock("../../web/src/client/use-model-catalog", () => ({
  useModelCatalog: () => ({
    loading: false,
    isCurrent: () => true,
    reread: facts.no,
    accept: () => false,
  }),
}));
vi.mock("../../web/src/transcript/use-lazy-window", () => ({
  useLazyWindow: () => ({ hidden: new Set() }),
}));
vi.mock("../../web/src/components/workspace/AgentDock", () => ({
  useWorkflowRuns: () => ({ runs: new Map(), unreadable: new Set() }),
}));
vi.mock("../../web/src/components/workspace/ChatImages", () => ({
  DraftImage: () => null,
  useImageDraft: () => ({
    files: [],
    remove: facts.no,
    add: facts.no,
    replace: facts.no,
    key: facts.no,
  }),
}));
const choice: ModelSelector = {
  provider: "fixture",
  model: "chosen",
  api: "openai-completions",
  thinking: "high",
};
const ready: ModelAvailability = {
  status: "ready",
  epoch: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  attachmentVersion: 1,
};
function find(
  node: ReactNode,
  type: unknown,
): Record<string, unknown> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, type);
      if (found) return found;
    }
  } else if (isValidElement<{ children?: ReactNode }>(node)) {
    if (node.type === type) return node.props;
    return find(node.props.children, type);
  }
}
function effects() {
  const pending = [...hooks.effects];
  hooks.effects.clear();
  for (const [index, effect] of pending) {
    hooks.cells[index].cleanup?.();
    const cleanup = effect();
    hooks.cells[index].cleanup =
      typeof cleanup === "function" ? cleanup : undefined;
  }
}
const settle = async () => {
  for (let i = 0; i < 12; ++i) await Promise.resolve();
};
let storage: Map<string, string>;
beforeEach(() => {
  facts.enabled = false;
  facts.commands = [];
  storage = new Map([["cadence:draft:workspace:chat", "original message"]]);
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
afterEach(() => {
  for (const cell of hooks.cells) cell?.cleanup?.();
  hooks.cursor = 0;
  hooks.cells = [];
  hooks.effects.clear();
  vi.unstubAllGlobals();
});
function fixture() {
  let selected: ModelCatalog["selected"] = null;
  const catalog = (): ModelCatalog => ({
    version: {
      epoch: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      catalogId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      configRev: 1,
      accessGeneration: 1,
      conversation: { id: "chat", cwd: "/project" },
    },
    selected,
    remembered: null,
    status: "complete",
    withheld: 0,
    entries: [
      {
        provider: choice.provider,
        model: choice.model,
        api: choice.api,
        eligibility: "candidate",
        thinking: [{ level: "high", selectable: true }],
      },
    ],
  });
  const client = {
    models: vi.fn(async () => ({ kind: "ok" as const, value: catalog() })),
    chooseModel: vi.fn(async () => {
      selected = { ...choice, sourceSelectionId: "source" };
      return {
        kind: "ok" as const,
        value: { version: catalog().version, selected },
      };
    }),
    workbenchCommand: vi.fn(async (_request: unknown) => ({
      kind: "ok",
      value: {},
    })),
  };
  const prepareForSend = vi.fn(async () => {});
  const render = (availability: ModelAvailability = ready) => {
    hooks.cursor = 0;
    const tree = ChatWorkspace({
      client: client as never,
      id: "chat",
      workspaceId: "workspace",
      initialCwd: "/project",
      enabled: true,
      modelAvailability: availability,
      previewModels: async () => ({
        status: "complete",
        entries: [],
        withheld: 0,
        remembered: null,
      }),
      prepareForSend,
      onModelChanged: facts.no,
      onChanged: facts.no,
      onReferenceUsed: facts.no,
    });
    // The composer is its own component: the conversation hands it the model
    // picker's props and the one Send, which is all these transitions drive.
    const composer = find(tree, ChatComposer) as unknown as ChatComposerProps;
    effects();
    return { tree, picker: composer.model, submit: composer.onSend };
  };
  return { client, render, prepareForSend };
}
it("a preview choice while Send waits resumes that exact intent once the same owner is ready, without preparing again", async () => {
  const f = fixture();
  f.render().submit();
  await settle();
  expect(f.client.models).toHaveBeenCalledTimes(1);
  expect(f.render().picker.awaitingSend).toBe(true);
  const preview = f.render({ status: "connecting" }).picker;
  preview.onPreviewChoice?.(choice);
  preview.onOpenChange(false, "chosen");
  f.render({ status: "connecting" });
  await settle();
  expect(f.client.workbenchCommand).not.toHaveBeenCalled();
  f.render();
  await settle();
  f.render();
  expect(f.prepareForSend).toHaveBeenCalledTimes(1);
  expect(f.client.chooseModel).toHaveBeenCalledTimes(1);
  expect(f.client.workbenchCommand).toHaveBeenCalledTimes(1);
  expect(f.client.workbenchCommand.mock.calls[0][0]).toMatchObject({
    kind: "send",
    text: "original message",
    conversationId: "chat",
    head: null,
  });
});
it("a rewritten message is sent from its anchor, which the accepted Send uses up, giving the earlier draft back", async () => {
  const anchorKey = "cadence:draft:workspace:chat:anchor";
  storage.set(
    anchorKey,
    JSON.stringify({
      kind: "edit",
      entry: "abcdef12",
      turnId: "turn",
      from: 0,
      label: "original message",
      media: false,
      stash: "an earlier draft",
    }),
  );
  const f = fixture();
  // The anchor is part of what Send captures before any wait: the model
  // choice that follows completes that same intent.
  f.render().submit();
  await settle();
  const preview = f.render({ status: "connecting" }).picker;
  preview.onPreviewChoice?.(choice);
  preview.onOpenChange(false, "chosen");
  f.render({ status: "connecting" });
  await settle();
  // Waiting has sent nothing and keeps the anchor.
  expect(f.client.workbenchCommand).not.toHaveBeenCalled();
  expect(storage.has(anchorKey)).toBe(true);
  f.render();
  await settle();
  f.render();
  f.render();
  expect(f.client.workbenchCommand).toHaveBeenCalledTimes(1);
  expect(f.client.workbenchCommand.mock.calls[0][0]).toMatchObject({
    kind: "send",
    text: "original message",
    conversationId: "chat",
    head: "abcdef12",
  });
  expect(storage.has(anchorKey)).toBe(false);
  expect(storage.get("cadence:draft:workspace:chat")).toBe("an earlier draft");
});
it.each(["stopped", "replacement", "dismissed"])(
  "%s retires the unsent model wait without a surprise restart or send",
  async (why) => {
    const f = fixture();
    f.render().submit();
    await settle();
    const waiting = f.render().picker;
    expect(waiting.awaitingSend).toBe(true);
    if (why === "dismissed") waiting.onOpenChange(false);
    else
      f.render(
        why === "stopped"
          ? { status: "stopped" }
          : { ...ready, epoch: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
      );
    const picker = f.render({ status: "connecting" }).picker;
    picker.onPreviewChoice?.(choice);
    picker.onOpenChange(false, "chosen");
    f.render();
    await settle();
    f.render();
    expect(f.prepareForSend).toHaveBeenCalledTimes(1);
    expect(f.client.workbenchCommand).not.toHaveBeenCalled();
    expect(f.client.chooseModel).not.toHaveBeenCalled();
    expect(storage.get("cadence:draft:workspace:chat:model")).toBe(
      JSON.stringify(choice),
    );
  },
);
it.each(["direct", "observed"])(
  "Cadence exit preserves the pending model on %s confirmation",
  async (route) => {
    facts.enabled = true;
    storage.set("cadence:draft:workspace:chat", "exit cadence");
    storage.set("cadence:draft:workspace:chat:model", JSON.stringify(choice));
    const f = fixture();
    if (route === "observed")
      f.client.workbenchCommand.mockResolvedValueOnce({
        kind: "error",
        error: { code: "unavailable", effect: "uncertain" },
      } as never);
    f.render().submit();
    await settle();
    f.render();
    const command = f.client.workbenchCommand.mock.calls[0][0] as {
      commandId: string;
      kind: string;
    };
    expect(command.kind).toBe("cadence-exit");
    if (route === "observed") {
      facts.commands = [command.commandId];
      f.render();
      f.render();
    }
    expect(storage.get("cadence:draft:workspace:chat:model")).toBe(
      JSON.stringify(choice),
    );
    expect(f.client.chooseModel).not.toHaveBeenCalled();
  },
);
it.each([false, true])(
  "a restored uncertain command clears a model only with its own consumption marker (%s)",
  (consumed) => {
    storage.set("cadence:draft:workspace:chat:pending", "pending-command");
    storage.set("cadence:draft:workspace:chat:model", JSON.stringify(choice));
    if (consumed)
      storage.set(
        "cadence:draft:workspace:chat:model-command",
        "pending-command",
      );
    facts.commands = ["pending-command"];
    const f = fixture();
    f.render();
    f.render();
    expect(storage.has("cadence:draft:workspace:chat:model")).toBe(!consumed);
    expect(f.client.workbenchCommand).not.toHaveBeenCalled();
  },
);
