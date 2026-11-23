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
import { pngBytes } from "../helpers/images.ts";
import { transport } from "./fixtures";

const f = vi.hoisted(() => ({
  cursor: -1,
  cells: [] as { value: unknown }[],
  composer: undefined as ChatComposerProps | undefined,
  keyDown: undefined as ((event: unknown) => void) | undefined,
  summary: null as ChatSummary | null | undefined,
  contextLoaded: true,
  modeLoaded: true,
  modeError: "",
  cadence: false,
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
    error:
      r?.kind === "cadence-conversation" && f.modeError
        ? f.modeError
        : undefined,
    value:
      r?.kind === "conversation-context"
        ? f.contextLoaded
          ? {
              kind: r.kind,
              context: {
                id: "chat",
                cwd: "/fixture",
                revision: 0,
                model: null,
              },
            }
          : undefined
        : f.modeLoaded && !f.modeError
          ? {
              kind: "cadence-conversation",
              state: {
                id: "chat",
                enabled: f.cadence,
                revision: 0,
                head: null,
                runs: [],
                proposal: null,
              },
            }
          : undefined,
  }),
}));
afterEach(() => {
  f.cursor = -1;
  f.cells = [];
  f.summary = null;
  f.contextLoaded = true;
  f.modeLoaded = true;
  f.modeError = "";
  f.cadence = false;
  f.error = "";
});

const choice = {
  provider: "fixture",
  model: "fixed",
  api: "openai-completions",
  thinking: "low",
} as const;
const preview = {
  status: "complete" as const,
  entries: [
    {
      ...choice,
      images: true,
      eligibility: "candidate" as const,
      thinking: [{ level: choice.thinking, selectable: true }],
    },
  ],
  remembered: null,
  withheld: 0,
};

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
      selected: { ...choice, sourceSelectionId: "source" },
      ...preview,
    },
  });
  function Probe({
    actionsReady,
    freshNew,
    mobile = false,
  }: {
    actionsReady: boolean;
    freshNew: boolean;
    mobile?: boolean;
  }) {
    f.cursor = 0;
    try {
      return ChatWorkspace({
        client,
        id: "chat",
        workspaceId: "workspace",
        initialCwd: "/fixture",
        freshNew,
        mobile,
        workingFolder: "/fixture/cadence",
        onOpenFolder: f.no,
        enabled: true,
        actionsReady,
        viewer: {
          epoch,
          attached: (value) => epoch === value,
          current: () => true,
        },
        modelAvailability: { status: "ready", epoch, attachmentVersion: 1 },
        previewModels: async () => preview,
        onModelChanged: f.no,
        onChanged: f.no,
        onReferenceUsed: f.no,
      });
    } finally {
      f.cursor = -1;
    }
  }
  const draw = (
    actionsReady = true,
    locale: "en" | "zh" = "en",
    freshNew = false,
    mobile = false,
  ) => {
    const html = renderToStaticMarkup(
      <LocaleProvider initial={locale}>
        <Probe
          actionsReady={actionsReady}
          freshNew={freshNew}
          mobile={mobile}
        />
      </LocaleProvider>,
    );
    if (!f.composer) throw Error("composer missing");
    return { html, input: f.composer };
  };
  return { draw, command, epoch };
}

it("only an observed new session renders the minimal welcome without redundant headings or starters", () => {
  const w = workspace();
  f.summary = undefined;
  expect(w.draw().html).not.toContain("chat-welcome");
  f.summary = null;
  f.error = "unavailable";
  expect(w.draw().html).not.toContain("chat-welcome");
  f.error = "";
  const { html } = w.draw();
  expect(html).toContain('data-entry="new"');
  expect(html).toContain("chat-welcome");
  expect(html.match(/<textarea\b/g)).toHaveLength(1);
  expect(html).not.toContain("entry-starters");
  expect(html).not.toContain("What would you like to work on?");
  expect(w.command).not.toHaveBeenCalled();
});
it.each([
  "accepted",
  "refused",
  "uncertain",
  "wrong ID",
  "wrong kind",
] as const)(
  "%s first Send: pending is not admission; only confirmation moves the composer",
  async (outcome) => {
    let settle!: (value: unknown) => void;
    const w = workspace(
      transport({
        workbenchCommand: async (cmd) =>
          cmd.kind === "image-upload"
            ? {
                kind: "ok",
                value: {
                  kind: cmd.kind,
                  commandId: cmd.commandId,
                  imageId: cmd.imageId,
                  offset: cmd.data.length,
                },
              }
            : new Promise((resolve) => {
                settle = resolve;
              }),
      }),
    );
    const image = new File([pngBytes()], "draft.png", { type: "image/png" });
    const initial = w.draw().input;
    initial.onDraft("first draft");
    initial.onAddImages([image]);
    initial.model.onPreviewChoice?.(choice);
    const before = w.draw().input;
    expect(before.model.draftModel).toEqual(choice);
    before.onSend();
    before.onSend();
    await vi.waitFor(() =>
      expect(w.command.mock.calls.map(([cmd]) => cmd.kind)).toEqual([
        "image-upload",
        "send",
      ]),
    );
    const { commandId } = w.command.mock.calls[1][0];
    const during = w.draw();
    expect(during.input).toMatchObject({
      draft: "first draft",
      images: [image],
      locked: true,
    });
    expect(during.html).toContain('data-entry="new"');
    settle(
      outcome === "wrong kind"
        ? {
            kind: "ok",
            value: {
              kind: "image-upload",
              commandId,
              imageId: crypto.randomUUID(),
              offset: 4,
            },
          }
        : outcome === "accepted" || outcome === "wrong ID"
          ? {
              kind: "ok",
              value: {
                kind: "accepted",
                commandId:
                  outcome === "accepted" ? commandId : crypto.randomUUID(),
              },
            }
          : {
              kind: "error",
              error: publicError(
                "stale",
                outcome === "refused" ? "none" : "uncertain",
              ),
            },
    );
    const accepted = outcome === "accepted",
      waiting = !accepted && outcome !== "refused";
    await vi.waitFor(() => {
      const next = w.draw();
      expect(next.html).toContain(
        accepted ? 'data-entry="received"' : 'data-entry="new"',
      );
      expect(next.input.draft).toBe(accepted ? "" : "first draft");
      expect(next.input.images).toEqual(accepted ? [] : [image]);
      expect(next.input.model.draftModel).toEqual(accepted ? null : choice);
      expect(next.input.locked).toBe(waiting);
      expect(next.input.inputRef).toBe(before.inputRef);
      if (waiting) {
        expect(next.html).toContain("Send outcome is unknown");
        expect(next.html).toContain(`<code>${commandId}</code>`);
      }
    });
    if (waiting)
      f.keyDown?.({ key: "Enter", nativeEvent: {}, preventDefault: f.no });
    expect(w.command).toHaveBeenCalledTimes(2);
  },
);

it("a matched exit receipt consumes the mode control, not a first message", async () => {
  f.cadence = true;
  const w = workspace(
    transport({
      workbenchCommand: async (cmd) => ({
        kind: "ok",
        value: { kind: "accepted", commandId: cmd.commandId },
      }),
    }),
  );
  w.draw().input.onDraft("exit cadence");
  const before = w.draw();
  expect(before.html).toContain('data-entry="new"');
  before.input.onSend();
  await vi.waitFor(() => expect(w.draw().input.draft).toBe(""));
  expect(w.command.mock.calls.map(([cmd]) => cmd.kind)).toEqual([
    "cadence-exit",
  ]);
  expect(w.draw().html).toContain('data-entry="new"');
});

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

it("mode toggle defers entering and exiting Cadence until explicit Send, and /cadence syncs the button", async () => {
  const w = workspace(
    transport({
      workbenchCommand: async (cmd) =>
        cmd.kind === "image-upload"
          ? {
              kind: "ok",
              value: {
                kind: cmd.kind,
                commandId: cmd.commandId,
                imageId: cmd.imageId,
                offset: cmd.data.length,
              },
            }
          : {
              kind: "ok",
              value: { kind: "accepted", commandId: cmd.commandId },
            },
    }),
  );
  // 1. Ordinary mode: clicking toggle only arms next Send (no command).
  const initial = w.draw(true, "zh");
  expect(initial.html).toContain('class="mode-toggle off"');
  expect(initial.html).toContain('aria-pressed="false"');
  expect(initial.html).toContain(
    '<span class="mode-toggle-label">Cadence</span>',
  );
  expect(initial.html).toContain(
    '<span class="mode-switch" aria-hidden="true">',
  );
  expect(initial.html).not.toContain("mode-pending");
  initial.input.cadence.onClick();
  const armed = w.draw(true, "zh");
  expect(w.command).not.toHaveBeenCalled();
  expect(armed.html).toContain('class="mode-toggle on armed"');
  expect(armed.html).toContain('aria-pressed="true"');
  expect(armed.html).toContain('<span class="composer-hint"></span>');
  expect(armed.html).not.toContain("mode-pending");
  // Clicking again cancels cleanly without sending.
  armed.input.cadence.onClick();
  expect(w.draw(true, "zh").html).toContain('class="mode-toggle off"');
  expect(w.command).not.toHaveBeenCalled();
  // Arm again, type message, and send -> cadence-send (intent: "enter").
  w.draw(true, "zh").input.cadence.onClick();
  w.draw(true, "zh").input.onDraft("规划登录重构");
  w.draw(true, "zh").input.onSend();
  await vi.waitFor(() => expect(w.command).toHaveBeenCalledTimes(1));
  expect(w.command.mock.calls[0][0]).toMatchObject({
    kind: "cadence-send",
    intent: "enter",
    text: "规划登录重构",
    revision: 0,
  });

  // 2. Manual /cadence prefix updates button to ON, keeps draft intact on click, and enters on Send.
  w.command.mockClear();
  f.cadence = false;
  w.draw(true, "zh").input.onDraft("/cadence 手动进入目标");
  const prefixed = w.draw(true, "zh");
  expect(prefixed.html).toContain('class="mode-toggle on armed"');
  expect(prefixed.html).toContain('<span class="composer-hint"></span>');
  prefixed.input.cadence.onClick();
  expect(w.draw(true, "zh").input.draft).toBe("/cadence 手动进入目标");
  expect(currentToasts().at(-1)?.text).toContain("/cadence");
  expect(w.command).not.toHaveBeenCalled();
  w.draw(true, "zh").input.onSend();
  await vi.waitFor(() => expect(w.command).toHaveBeenCalledTimes(1));
  expect(w.command.mock.calls[0][0]).toMatchObject({
    kind: "cadence-send",
    intent: "enter",
    text: "/cadence 手动进入目标",
  });

  // 3. Cadence active: clicking toggle sets pending exit (no command); Send exits atomically with ordinary message + image.
  w.command.mockClear();
  f.cadence = true;
  const active = w.draw(true, "zh");
  expect(active.html).toContain('class="mode-toggle on"');
  active.input.cadence.onClick();
  const leaving = w.draw(true, "zh");
  expect(w.command).not.toHaveBeenCalled();
  expect(leaving.html).toContain('class="mode-toggle off leaving"');
  expect(leaving.html).toContain('<span class="composer-hint"></span>');
  // Typing /cadence while pending exit overrides back to ON.
  leaving.input.onDraft("/cadence 继续保持");
  expect(w.draw(true, "zh").html).toContain('class="mode-toggle on"');
  // Replacing with ordinary text + image restores leaving state and sends atomic exitRevision send.
  const photo = new File([pngBytes()], "note.png", { type: "image/png" });
  w.draw(true, "zh").input.onDraft("普通消息直接修改");
  w.draw(true, "zh").input.onAddImages([photo]);
  expect(w.draw(true, "zh").html).toContain('class="mode-toggle off leaving"');
  w.draw(true, "zh").input.onSend();
  await vi.waitFor(() => expect(w.command).toHaveBeenCalledTimes(2));
  expect(w.command.mock.calls.map(([c]) => c.kind)).toEqual([
    "image-upload",
    "send",
  ]);
  expect(w.command.mock.calls[1][0]).toMatchObject({
    kind: "send",
    text: "普通消息直接修改",
    exitRevision: 0,
  });

  // 4. Typing explicit exit cadence while Cadence is on (even with toggle off) sends cadence-exit without calling model.
  w.command.mockClear();
  w.draw(true, "zh").input.onDraft("退出 Cadence");
  const phraseLeaving = w.draw(true, "zh");
  expect(phraseLeaving.html).toContain('class="mode-toggle off leaving"');
  expect(phraseLeaving.html).toContain('<span class="composer-hint"></span>');
  phraseLeaving.input.onSend();
  await vi.waitFor(() => expect(w.command).toHaveBeenCalledTimes(1));
  expect(w.command.mock.calls[0][0]).toMatchObject({
    kind: "cadence-exit",
    revision: 0,
  });
});

it("freshNew opens directly in the centered new-conversation layout without flashing reading notices, while keeping Send strictly gated and failing honestly on error", () => {
  const w = workspace();
  f.summary = undefined;
  f.contextLoaded = false;
  f.modeLoaded = false;
  // Non-fresh unobserved view stays unobserved without an immediate reading flash.
  const unobserved = w.draw(true, "zh", false);
  expect(unobserved.html).toContain('data-entry="unobserved"');
  expect(unobserved.html).not.toContain("chat-welcome");
  expect(unobserved.html).not.toContain("正在读取对话…");
  expect(unobserved.html).not.toContain("读取当前上下文后才能发送");
  expect(unobserved.input.canSend).toBe(false);
  // Explicit New conversation click (freshNew) enters the centered welcome view
  // immediately without flashing reading notices, an unavailable mode toggle,
  // or a redundant "New conversation" / "Ordinary" header bar.
  const fresh = w.draw(true, "zh", true);
  expect(fresh.html).toContain('data-entry="new"');
  expect(fresh.html).not.toContain('class="conversation-header"');
  expect(fresh.html).not.toContain("新对话");
  expect(fresh.html).not.toContain("普通对话");
  expect(fresh.html).toContain("chat-welcome");
  expect(fresh.html).not.toContain("entry-starters");
  expect(fresh.html).toContain('class="mode-toggle off"');
  expect(fresh.html).not.toContain("正在读取对话…");
  expect(fresh.html).not.toContain("读取当前上下文后才能发送");
  expect(fresh.input.canSend).toBe(false);
  fresh.input.onDraft("Too early");
  fresh.input.onSend();
  expect(w.command).not.toHaveBeenCalled();
  // Real read error retires freshNew immediately and surfaces the honest status.
  f.error = "unavailable";
  const failed = w.draw(true, "zh", true);
  expect(failed.html).not.toContain('data-entry="new"');
  expect(failed.html).not.toContain("chat-welcome");
  expect(failed.html).toContain("读取当前上下文后才能发送");
});

it("omits the header on an empty new conversation while keeping feedback mounted, and drops redundant mode/origin notes on existing conversations", () => {
  const w = workspace();
  // Observed empty new conversation: no header bar, no "New conversation"/"Ordinary"
  // text, but ConversationFeedback stays mounted inside chat-messages-wrap.
  const emptyZh = w.draw(true, "zh");
  expect(emptyZh.html).toContain('data-entry="new"');
  expect(emptyZh.html).not.toContain('class="conversation-header"');
  expect(emptyZh.html).not.toContain("新对话");
  expect(emptyZh.html).toContain('class="conversation-feedback"');
  expect(emptyZh.html).toContain('aria-label="普通对话"');
  expect(emptyZh.html).not.toContain(">普通对话<");

  // Existing WebUI and terminal conversations (ordinary and Cadence) keep only
  // the real title and functional controls, never mode/origin meta lines.
  for (const origin of ["webui", "terminal"] as const) {
    for (const cadence of [false, true]) {
      f.cadence = cadence;
      f.summary = {
        id: "chat",
        title: `Topic ${origin} ${cadence ? "cadence" : "ordinary"}`,
        origin,
        leaf: null,
        updatedAt: 1,
        status: "completed",
      };
      const zh = w.draw(true, "zh").html;
      expect(zh).toContain('class="conversation-header"');
      expect(zh).toContain(`<h2>${f.summary.title}</h2>`);
      expect(zh).not.toContain('class="conversation-branch"');
      expect(zh).not.toContain('class="conversation-meta"');
      expect(zh).not.toContain("Cadence 已开启");
      expect(zh).not.toContain("在 WebUI 中开始");
      expect(zh).not.toContain("在终端中开始");
      expect(zh).not.toContain(">普通对话<");
    }
  }

  // Genuine mode read failure still surfaces the abnormal unavailable notice.
  f.modeError = "unavailable";
  const degraded = w.draw(true, "zh").html;
  expect(degraded).toContain('class="conversation-branch"');
  expect(degraded).toContain(
    '<span class="conversation-meta">Cadence 状态未确认</span>',
  );
});

it("lingering pending mode reconciles with server state and can be cancelled during a running reply to unlock steer/queue", () => {
  const w = workspace();
  // Arm Cadence while idle, then observe a live reply started elsewhere.
  w.draw(true, "zh").input.cadence.onClick();
  expect(w.draw(true, "zh").html).toContain('class="mode-toggle on armed"');

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
  w.draw(true, "zh").input.onDraft("follow up");
  const blocked = w.draw(true, "zh");
  // Steer/queue stays blocked by the pending mode change, but the toggle stays clickable to cancel it.
  expect(blocked.input.input?.enabled).toBe(false);
  expect(blocked.input.cadence.disabled).toBe(false);
  expect(blocked.html).toContain('class="mode-toggle on armed"');

  // Clicking cancels pendingMode, immediately unlocks steer/queue, and disables new mode changes while running.
  blocked.input.cadence.onClick();
  const unlocked = w.draw(true, "zh");
  expect(unlocked.input.input?.enabled).toBe(true);
  expect(unlocked.input.cadence.disabled).toBe(true);
  expect(unlocked.html).toContain('class="mode-toggle off"');
  // Clicking again while running cannot arm a new mode change.
  unlocked.input.cadence.onClick();
  expect(w.draw(true, "zh").html).toContain('class="mode-toggle off"');

  // When server mode already catches up to pendingMode, it reconciles cleanly to steady state.
  f.summary = null;
  f.cadence = false;
  w.draw(true, "zh").input.cadence.onClick();
  expect(w.draw(true, "zh").html).toContain('class="mode-toggle on armed"');
  f.cadence = true;
  expect(w.draw(true, "zh").html).toContain('class="mode-toggle on"');
});

it("mobile new conversation surfaces a centered working-folder pill while desktop omits it", () => {
  const w = workspace();
  const desktop = w.draw(true, "zh", false, false).html;
  expect(desktop).not.toContain("mobile-welcome-folder");
  const mobile = w.draw(true, "zh", false, true).html;
  expect(mobile).toContain('class="mobile-welcome-folder"');
  expect(mobile).toContain("新会话将在这个目录中运行");
  expect(mobile).toContain("<span>cadence</span>");
});
