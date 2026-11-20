// Controlled workspace renders and the real Send handler. No DOM, owner,
// browser storage, installation or approval. Geometry belongs to the browser.
import { Children, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { ChatSummary } from "../../src/service/contracts/workbench.ts";
import { ServiceClient } from "../../src/service-client.ts";
import { publicError } from "../../src/service-contract.ts";
import type { ChatComposerProps } from "../../web/src/components/workspace/ChatComposer";
import { ChatWorkspace } from "../../web/src/components/workspace/ChatWorkspace";
import { LocaleProvider } from "../../web/src/i18n/locale";
import { currentToasts } from "../../web/src/layout/toasts";
import { transport } from "./fixtures";

const f = vi.hoisted(() => ({
  cursor: -1,
  cells: [] as { value: unknown }[],
  composer: undefined as ChatComposerProps | undefined,
  keyDown: undefined as ((event: unknown) => void) | undefined,
  start: undefined as ((text: string) => void) | undefined,
  summary: null as ChatSummary | null | undefined,
  error: "",
  no: () => {},
}));
// Retain the parent state/ref cells between SSR passes, not DOM or effects.
vi.mock("react", async (load) => {
  const actual = await load<typeof import("react")>();
  const cell = (init: () => unknown) =>
    (f.cells[f.cursor++] ??= { value: init() });
  return {
    ...actual,
    useState(initial: unknown) {
      const state = actual.useState(f.cursor < 0 ? initial : undefined);
      if (f.cursor < 0) return state;
      const c = cell(() =>
        typeof initial === "function" ? initial() : initial,
      );
      return [
        c.value,
        (next: unknown) => {
          c.value = typeof next === "function" ? next(c.value) : next;
        },
      ];
    },
    useRef(initial: unknown) {
      const ref = actual.useRef(initial);
      return f.cursor < 0 ? ref : cell(() => ({ current: initial })).value;
    },
  };
});
vi.mock("../../web/src/components/workspace/ChatComposer", async (load) => {
  const actual =
    await load<
      typeof import("../../web/src/components/workspace/ChatComposer")
    >();
  return {
    ...actual,
    ChatComposer(props: ChatComposerProps) {
      f.composer = props;
      const form = actual.ChatComposer(props);
      const field = Children.toArray(form.props.children).find(
        (el) => isValidElement(el) && el.type === "textarea",
      );
      if (!isValidElement<{ onKeyDown(event: unknown): void }>(field))
        throw Error("missing textarea");
      f.keyDown = field.props.onKeyDown;
      return form;
    },
  };
});
vi.mock("../../web/src/components/workspace/ChatWelcome", async (load) => {
  const actual =
    await load<
      typeof import("../../web/src/components/workspace/ChatWelcome")
    >();
  return {
    ...actual,
    ChatWelcome(props: Parameters<typeof actual.ChatWelcome>[0]) {
      f.start = props.onStart;
      return <actual.ChatWelcome {...props} />;
    },
  };
});
vi.mock("../../web/src/client/use-conversation", () => ({
  useConversation: () => ({
    summary: f.summary,
    leaf: null,
    turns: [],
    commands: [],
    pending: [],
    undelivered: [],
    runs: [],
    count: 0,
    error: f.error,
    refresh: f.no,
    choose: f.no,
  }),
}));
vi.mock("../../web/src/client/use-workbench", async (load) => ({
  ...(await load<typeof import("../../web/src/client/use-workbench")>()),
  useWorkbench: (_: unknown, r: { kind: string } | null) => ({
    refresh: f.no,
    value:
      r?.kind === "conversation-context"
        ? {
            kind: r.kind,
            context: { id: "chat", cwd: "/fixture", revision: 0, model: null },
          }
        : {
            kind: "cadence-conversation",
            state: {
              id: "chat",
              enabled: false,
              revision: 0,
              head: null,
              runs: [],
              proposal: null,
            },
          },
  }),
}));
afterEach(() => {
  f.cursor = -1;
  f.cells = [];
  f.summary = null;
  f.error = "";
});

function workspace(wire = transport()) {
  const client = new ServiceClient(wire);
  const command = vi.spyOn(client, "workbenchCommand");
  const epoch = crypto.randomUUID();
  vi.spyOn(client, "models").mockResolvedValue({
    kind: "ok",
    value: {
      version: {
        epoch,
        accessGeneration: 1,
        configRev: 1,
        catalogId: crypto.randomUUID(),
        conversation: { id: "chat", cwd: "/fixture" },
      },
      selected: {
        provider: "fixture",
        model: "fixed",
        api: "openai-completions",
        thinking: "low",
        sourceSelectionId: "source",
      },
      remembered: null,
      status: "complete",
      entries: [],
      withheld: 0,
    },
  });
  function Probe({ actionsReady }: { actionsReady: boolean }) {
    f.cursor = 0;
    try {
      return ChatWorkspace({
        client,
        id: "chat",
        workspaceId: "workspace",
        initialCwd: "/fixture",
        enabled: true,
        actionsReady,
        viewer: {
          epoch,
          attached: (value) => epoch === value,
          current: () => true,
        },
        modelAvailability: { status: "ready", epoch, attachmentVersion: 1 },
        onModelChanged: f.no,
        onChanged: f.no,
        onReferenceUsed: f.no,
      });
    } finally {
      f.cursor = -1;
    }
  }
  const draw = (actionsReady = true, locale: "en" | "zh" = "en") => {
    f.start = undefined;
    const html = renderToStaticMarkup(
      <LocaleProvider initial={locale}>
        <Probe actionsReady={actionsReady} />
      </LocaleProvider>,
    );
    if (!f.composer) throw Error("composer missing");
    return { html, input: f.composer };
  };
  return { draw, command, epoch };
}

it("only an observed new session offers local starters; they never replace text or attachments", () => {
  const w = workspace();
  f.summary = undefined;
  expect(w.draw().html).not.toContain("entry-starters");
  f.summary = null;
  f.error = "unavailable";
  expect(w.draw().html).not.toContain("entry-starters");
  f.error = "";
  const { html, input } = w.draw();
  expect(html).toContain('data-entry="new"');
  expect(html.match(/<textarea\b/g)).toHaveLength(1);
  expect(html).toContain("Explain this project");
  if (!f.start) throw Error("starter missing");
  const start = f.start;
  start("Explain this project");
  expect(w.draw().input.draft).toBe("Explain this project");
  input.onDraft(" ");
  start("Must not overwrite whitespace");
  expect(w.draw().input.draft).toBe(" ");
  expect(f.start).toBeUndefined();
  input.onDraft("");
  const photo = new File(["image"], "draft.png", { type: "image/png" });
  input.onAddImages([photo]);
  const withPhoto = w.draw();
  expect(withPhoto.input.images).toEqual([photo]);
  expect(withPhoto.html).not.toContain("entry-starters");
  expect(w.command).not.toHaveBeenCalled();
});
it.each(["accepted", "refused", "uncertain"] as const)(
  "%s first Send: pending is not admission; only confirmation moves the composer",
  async (outcome) => {
    const w = workspace();
    let resolve!: () => void;
    w.command.mockImplementation(
      (cmd) =>
        new Promise((done) => {
          resolve = () =>
            done(
              outcome === "accepted"
                ? {
                    kind: "ok",
                    value: { kind: "accepted", commandId: cmd.commandId },
                  }
                : {
                    kind: "error",
                    error: publicError(
                      "stale",
                      outcome === "refused" ? "none" : "uncertain",
                    ),
                  },
            );
        }),
    );
    w.draw().input.onDraft("first draft");
    const before = w.draw().input;
    before.onSend();
    before.onSend();
    await vi.waitFor(() => expect(w.command).toHaveBeenCalledTimes(1));
    const during = w.draw();
    expect(during.input).toMatchObject({ draft: "first draft", locked: true });
    expect(during.html).toContain('data-entry="new"');
    resolve();
    await vi.waitFor(() => {
      const next = w.draw();
      expect(next.html).toContain(
        outcome === "accepted" ? 'data-entry="received"' : 'data-entry="new"',
      );
      expect(next.input.draft).toBe(
        outcome === "accepted" ? "" : "first draft",
      );
      expect(next.input.locked).toBe(outcome === "uncertain");
      expect(next.input.inputRef).toBe(before.inputRef);
      if (outcome === "uncertain")
        expect(next.html).toContain("Send outcome is unknown");
    });
    expect(w.command).toHaveBeenCalledTimes(1);
  },
);

it("explains the running reply's image lock and refuses pasted files without changing or sending the draft", () => {
  const w = workspace();
  f.summary = {
    id: "chat",
    title: "First reply",
    origin: "webui",
    leaf: null,
    updatedAt: 1,
    status: "running",
  };
  const photo = new File(["fixture"], "sample.png", { type: "image/png" });
  const { input, html } = w.draw();
  const reason = "Wait for the current reply to finish before adding images.";
  expect(html).toContain(
    `disabled="" aria-label="Add images" title="${reason}" aria-description="${reason}"`,
  );
  input.onAddImages([photo]);
  expect(currentToasts().at(-1)?.text).toBe(reason);
  expect(w.draw().input).toMatchObject({ draft: "", images: [] });
  f.summary.status = "completed";
  const settled = w.draw();
  expect(settled.html).not.toContain(reason);
  settled.input.onAddImages([photo]);
  expect(w.draw().input.images).toEqual([photo]);
  expect(w.command).not.toHaveBeenCalled();
});

it.each(["steer", "queue"])(
  "%s needs a fresh key after action context returns, even though Stop stayed available",
  async (mode) => {
    const w = workspace(
      transport({
        workbenchCommand: async (cmd) => ({
          kind: "ok",
          value: { kind: "accepted", commandId: cmd.commandId },
        }),
      }),
    );
    const live = { epoch: w.epoch, commandId: crypto.randomUUID() };
    f.summary = {
      id: "chat",
      title: "Live reply",
      origin: "webui",
      leaf: null,
      updatedAt: 1,
      status: "running",
      live,
    };
    const text = "some more context";
    const blocked = () => w.draw(false, "zh");
    const enter = (altKey: boolean) => {
      if (!f.keyDown) throw Error("missing Enter handler");
      const preventDefault = vi.fn();
      f.keyDown({ key: "Enter", altKey, nativeEvent: {}, preventDefault });
      expect(preventDefault).toHaveBeenCalledOnce();
    };
    const empty = blocked();
    expect(empty.input.status).toBeUndefined();
    empty.input.onDraft(text);
    const reason = "暂时无法插队或排队：当前操作上下文不可用；请重新观察。";
    for (const alt of [false, true]) {
      const { input, html } = blocked();
      expect(input.canStop).toBe(true);
      expect(input.input?.enabled).toBe(false);
      expect(input.draft).toBe(text);
      expect(html).toContain(
        `class="composer-status" role="status">${reason}</p>`,
      );
      expect(html.match(/<textarea\b[^>]*>/)?.[0]).toContain(
        `aria-description="${reason}"`,
      );
      expect(html).not.toContain("composer-split");
      enter(alt);
      expect(w.command).not.toHaveBeenCalled();
    }
    const restored = w.draw(true, "zh");
    expect(restored.input.draft).toBe(text);
    expect(restored.input.canStop).toBe(true);
    expect(restored.html).toContain("composer-split");
    expect(restored.html).not.toContain(reason);
    expect(w.command).not.toHaveBeenCalled();
    enter(mode === "queue");
    await vi.waitFor(() => expect(w.draw().input.draft).toBe(""));
    expect(w.command.mock.calls.map(([c]) => c)).toEqual([
      {
        kind: "conversation-input",
        commandId: expect.any(String),
        conversationId: "chat",
        turnId: live.commandId,
        epoch: w.epoch,
        mode,
        text,
      },
    ]);
  },
);
