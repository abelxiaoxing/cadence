// Local storage, SSR and a controlled mount-effect callback, not a browser/owner.
import { randomUUID } from "node:crypto";
import type { DependencyList, EffectCallback } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { ServiceClient } from "../../src/service-client.ts";
import type { ModelSelector } from "../../src/service-contract.ts";
import { draftKey } from "../../web/src/client/conversation-send";
import {
  bindFolderDraft,
  emptyFolderDraft,
  FOLDER_DRAFT_KEY,
  type FolderDraft,
  readFolderDraft,
  rememberFolderDraft,
} from "../../web/src/client/folder-draft";
import { ChatWorkspace } from "../../web/src/components/workspace/ChatWorkspace";
import { transport } from "./fixtures";

const handoff = vi.hoisted(() => ({
  acknowledge: null as (() => void) | null,
  apply: undefined as EffectCallback | undefined,
}));
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  return {
    ...actual,
    useEffect(effect: EffectCallback, deps?: DependencyList) {
      actual.useEffect(effect, deps);
      if (handoff.acknowledge && deps?.[1] === handoff.acknowledge)
        handoff.apply = effect;
    },
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
  handoff.acknowledge = null;
  handoff.apply = undefined;
});
const model: ModelSelector = {
  provider: "fixture",
  model: "draft-model",
  api: "openai-completions",
  thinking: "high",
};
const draft = { text: "A message before choosing a folder", model };
function storage() {
  const values = new Map<string, string>();
  const setItem = vi.fn((key: string, value: string) => values.set(key, value));
  const removeItem = vi.fn((key: string) => values.delete(key));
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem,
    removeItem,
  });
  return { values, setItem, removeItem };
}

it("first-use text/model survive refresh; reading never writes or repairs storage", () => {
  const { values, setItem, removeItem } = storage();
  expect(readFolderDraft()).toEqual(emptyFolderDraft());
  rememberFolderDraft(draft);
  expect(readFolderDraft()).toEqual(draft);
  setItem.mockClear();
  for (const raw of ["{", "null", "[]", '{"text":5}', '{"text":false}']) {
    values.set(FOLDER_DRAFT_KEY, raw);
    expect(readFolderDraft()).toEqual(emptyFolderDraft());
    expect(values.get(FOLDER_DRAFT_KEY)).toBe(raw);
  }
  values.set(
    FOLDER_DRAFT_KEY,
    JSON.stringify({ text: draft.text, model: { invalid: true } }),
  );
  expect(readFolderDraft()).toEqual({ text: draft.text, model: null });
  expect(setItem).not.toHaveBeenCalled();
  expect(removeItem).not.toHaveBeenCalled();
});
it("explicit folder selection binds a fresh draft namespace before history loads, without touching another conversation", () => {
  const { values } = storage();
  const id = randomUUID();
  const existing = draftKey("checkout:/a", randomUUID());
  values.set(existing, "Existing conversation draft");
  rememberFolderDraft(draft);
  expect(bindFolderDraft("/b", id, draft)).toEqual({
    ...draft,
    conversationId: id,
  });
  const target = draftKey("checkout:/b", id);
  expect(values.get(target)).toBe(draft.text);
  expect(JSON.parse(values.get(`${target}:model`) ?? "null")).toEqual(model);
  expect(values.get(existing)).toBe("Existing conversation draft");
  expect(values.has(FOLDER_DRAFT_KEY)).toBe(false);
  expect([...values.keys()]).not.toContain(`${target}:pending`);
  expect([...values.keys()]).not.toContain(`${target}:model-command`);
});
it("partial handoff storage retains its source; blocked storage keeps the in-memory handoff usable", () => {
  const { values } = storage();
  rememberFolderDraft(draft);
  const removeItem = vi.fn();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (key.endsWith(":model")) throw new Error("quota");
      values.set(key, value);
    },
    removeItem,
  });
  const id = randomUUID();
  expect(bindFolderDraft("/b", id, draft)).toEqual({
    ...draft,
    conversationId: id,
  });
  expect(values.get(FOLDER_DRAFT_KEY)).toBe(JSON.stringify(draft));
  expect(removeItem).not.toHaveBeenCalled();
  vi.stubGlobal("sessionStorage", {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  });
  expect(readFolderDraft()).toEqual(emptyFolderDraft());
  expect(() => rememberFolderDraft(draft)).not.toThrow();
  expect(bindFolderDraft("/b", id, draft).text).toBe(draft.text);
});
it("mount acknowledges the handoff once; revisiting without storage cannot resurrect initial text/model", () => {
  vi.stubGlobal("sessionStorage", {
    getItem() {
      throw new Error("blocked");
    },
  });
  let initialDraft: FolderDraft | undefined = draft;
  const applied = vi.fn(() => {
    initialDraft = undefined;
  });
  handoff.acknowledge = applied;
  const send = vi.fn();
  const client = new ServiceClient(transport({ workbenchCommand: send }));
  const id = randomUUID();
  const render = () =>
    renderToStaticMarkup(
      <ChatWorkspace
        client={client}
        id={id}
        workspaceId="checkout:/b"
        initialCwd="/b"
        initialDraft={initialDraft}
        onDraftApplied={applied}
        enabled={false}
        modelAvailability={{ status: "not-started" }}
        onChanged={() => {}}
        onModelChanged={() => {}}
        onReferenceUsed={() => {}}
      />,
    );
  const first = render();
  expect(first).toContain(draft.text);
  expect(first).toContain(model.model);
  expect(applied).not.toHaveBeenCalled(); // Rendering alone cannot consume input.
  expect(handoff.apply).toBeDefined();
  handoff.apply?.(); // The exact target mount effect, not a synthetic Send.
  expect(applied).toHaveBeenCalledTimes(1);
  const reopened = render();
  expect(reopened).not.toContain(draft.text);
  expect(reopened).not.toContain(model.model);
  handoff.apply?.();
  expect(applied).toHaveBeenCalledTimes(1);
  expect(send).not.toHaveBeenCalled();
});
it.each(["memory", "stored-empty", "stored-newer"])(
  "the selected conversation keeps %s input without turning folder selection into Send",
  (kind) => {
    const { values } = storage();
    const id = randomUUID();
    if (kind !== "memory")
      values.set(
        draftKey("checkout:/b", id),
        kind === "stored-empty" ? "" : "Newer input",
      );
    const send = vi.fn();
    const client = new ServiceClient(transport({ workbenchCommand: send }));
    const html = renderToStaticMarkup(
      <ChatWorkspace
        client={client}
        id={id}
        workspaceId="checkout:/b"
        initialCwd="/b"
        initialDraft={draft}
        enabled={false}
        modelAvailability={{ status: "not-started" }}
        onChanged={() => {}}
        onModelChanged={() => {}}
        onReferenceUsed={() => {}}
      />,
    );
    const text =
      kind === "memory"
        ? draft.text
        : kind === "stored-empty"
          ? ""
          : "Newer input";
    expect(html).toContain(`>${text}</textarea>`);
    expect(html).toContain("draft-model");
    expect(send).not.toHaveBeenCalled();
    expect(html).toMatch(/type="submit" class="primary" disabled=""/);
  },
);
