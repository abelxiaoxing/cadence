import { Children, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { ChoiceVersion } from "../../src/service/contracts/models.ts";
import type {
  CadenceConversation,
  WorkbenchCommand,
  WorkbenchResult,
} from "../../src/service/contracts/workbench.ts";
import { ServiceClient } from "../../src/service-client.ts";
import { CadenceModeButton } from "../../web/src/components/workspace/CadenceModeButton";
import {
  ChatComposer,
  type ChatComposerProps,
} from "../../web/src/components/workspace/ChatComposer";
import { ChatWorkspace } from "../../web/src/components/workspace/ChatWorkspace";
import {
  FilePreview,
  FilesPanel,
} from "../../web/src/components/workspace/FilesPanel";
import { LocaleProvider } from "../../web/src/i18n/locale";
import { transport } from "./fixtures";

const files = vi.hoisted(() => ({
  value: undefined as WorkbenchResult | undefined,
  error: undefined as string | undefined,
}));
const f = vi.hoisted(() => ({
  state: undefined as CadenceConversation | undefined,
  catalog: undefined as ChoiceVersion | undefined,
  no: () => {},
}));
vi.mock("../../web/src/client/use-workbench", async (load) => ({
  ...(await load<typeof import("../../web/src/client/use-workbench")>()),
  useWorkbench: (_: unknown, r: { kind?: string } | null) => ({
    refresh: f.no,
    error: r?.kind === "files" || r?.kind === "file" ? files.error : undefined,
    value:
      r?.kind === "files" || r?.kind === "file"
        ? files.value
        : r?.kind === "cadence-conversation"
          ? { kind: r.kind, state: f.state }
          : r?.kind === "conversation-context"
            ? {
                kind: r.kind,
                context: {
                  id: "chat",
                  cwd: "/fixture",
                  revision: 0,
                  model: {
                    provider: "fixture",
                    model: "fixture",
                    api: "openai-completions",
                    thinking: "low",
                  },
                },
              }
            : undefined,
  }),
}));
vi.mock("../../web/src/client/use-conversation", () => ({
  useConversation: () => ({
    summary: {
      id: "chat",
      title: "Fixture discussion",
      status: "completed",
      live: undefined,
      origin: "webui",
      leaf: "leaf",
    },
    pinned: false,
    leaf: "leaf",
    turns: [],
    runs: [],
    pending: [],
    choose: f.no,
    undelivered: [],
    commands: [],
    count: 1,
    refresh: f.no,
  }),
}));
vi.mock("../../web/src/client/use-model-catalog", () => ({
  useModelCatalog: () => ({
    catalog: f.catalog && {
      version: f.catalog,
      entries: [],
      status: "complete",
    },
    reread: f.no,
    isCurrent: () => true,
  }),
}));
afterEach(() => {
  files.value = undefined;
  files.error = undefined;
  f.state = undefined;
  f.catalog = undefined;
  vi.unstubAllGlobals();
});

it.each(["en", "zh"] as const)(
  "%s: the mode toggle renders a Cadence pill switch with next-Send tooltips, unknown stays disabled",
  (locale) => {
    const click = vi.fn();
    const render = (active: boolean, armed: boolean, known = true) =>
      renderToStaticMarkup(
        <LocaleProvider initial={locale}>
          <CadenceModeButton
            active={active}
            armed={armed}
            known={known}
            disabled={false}
            onClick={click}
          />
        </LocaleProvider>,
      );
    const chinese = locale === "zh";
    for (const [active, armed, cls, pressed, title] of [
      [
        false,
        false,
        "off",
        "false",
        chinese
          ? "在发送下一条消息时开启 Cadence 模式：先商定计划，再开始实施。"
          : "Turn on Cadence mode on your next message: agree on a plan before implementation.",
      ],
      [
        false,
        true,
        "on armed",
        "true",
        chinese
          ? "发送下一条消息时将开启 Cadence 模式，点击取消。"
          : "Your next message turns on Cadence mode. Click to cancel.",
      ],
      [
        true,
        true,
        "on",
        "true",
        chinese
          ? "Cadence 模式已开启，点击后将在发送下一条消息时退出。"
          : "Cadence mode is on. Click to exit on your next message.",
      ],
      [
        true,
        false,
        "off leaving",
        "false",
        chinese
          ? "发送下一条消息时将退出 Cadence 并按普通对话发送，点击取消。"
          : "Your next message exits Cadence mode and sends normally. Click to stay in Cadence.",
      ],
    ] as const) {
      const html = render(active, armed);
      expect(html).toContain(`class="mode-toggle ${cls}"`);
      expect(html).toContain('aria-label="Cadence"');
      expect(html).toContain(`aria-pressed="${pressed}"`);
      expect(html).toContain(`title="${title}"`);
      expect(html).toContain('class="mode-toggle-icon"');
      expect(html).toContain('<span class="mode-toggle-label">Cadence</span>');
      expect(html).toContain('<span class="mode-switch" aria-hidden="true">');
      expect(html).not.toMatch(/disabled=/);
    }
    const neutral = chinese
      ? "Cadence 状态未确认"
      : "Cadence state unavailable";
    for (const active of [false, true]) {
      const html = render(active, active, false);
      expect(html).toContain('class="mode-toggle unknown"');
      expect(html).toContain('disabled=""');
      expect(html).toContain(`aria-label="${neutral}"`);
      expect(html).toContain(`title="${neutral}"`);
      expect(html).toContain('class="mode-toggle-icon"');
      expect(html).toContain(
        `<span class="mode-toggle-label">${neutral}</span></button>`,
      );
      expect(html).not.toMatch(/aria-pressed=|class="mode-switch"/);
    }
    expect(click).not.toHaveBeenCalled();
  },
);

function composer(tree: ReturnType<typeof ChatWorkspace>) {
  const dock = Children.toArray(tree.props.children).find(
    (el) =>
      isValidElement<{ className?: string }>(el) &&
      el.props.className === "composer-dock",
  );
  if (!isValidElement<{ children: React.ReactNode }>(dock))
    throw Error("missing dock");
  const editor = Children.toArray(dock.props.children).find(
    (el) => isValidElement(el) && el.type === ChatComposer,
  );
  if (!isValidElement<ChatComposerProps>(editor)) throw Error("missing editor");
  return editor.props;
}

function modeToggle(enabled: boolean) {
  const command = vi.fn(async (cmd: WorkbenchCommand) => ({
    kind: "ok",
    value: { kind: "accepted", commandId: cmd.commandId },
  }));
  const client = new ServiceClient(transport({ workbenchCommand: command }));
  const catalog: ChoiceVersion = {
    epoch: crypto.randomUUID(),
    accessGeneration: 1,
    configRev: 1,
    catalogId: crypto.randomUUID(),
    conversation: { id: "chat", cwd: "/fixture" },
  };
  // Entering Cadence is a normal Send, so it needs a chosen model to ride on.
  vi.spyOn(client, "models").mockResolvedValue({
    kind: "ok",
    value: {
      status: "complete",
      withheld: 0,
      remembered: null,
      entries: [],
      version: catalog,
      selected: {
        provider: "fixture",
        model: "fixture",
        api: "openai-completions",
        thinking: "low",
        sourceSelectionId: crypto.randomUUID(),
      },
    },
  });
  f.state = {
    id: "chat",
    revision: 1,
    enabled,
    head: enabled ? "turn-1" : null,
    proposal: null,
    runs: [],
  };
  f.catalog = catalog;
  return { client, command };
}

it.each([false, true])(
  "%s: clicking the mode toggle only changes next-Send intent without sending or preparing",
  async (enabled) => {
    const draft = "my draft";
    const storage = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) =>
        key === "cadence:draft:workspace:chat"
          ? draft
          : (storage.get(key) ?? null),
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    });
    const { client, command } = modeToggle(enabled);
    const prepare = vi.fn(async () => {});
    let click: (() => void) | undefined, editor: ChatComposerProps | undefined;
    function Probe() {
      const tree = ChatWorkspace({
        client,
        id: "chat",
        workspaceId: "workspace",
        initialCwd: "/fixture",
        enabled: true,
        actionsReady: false,
        modelAvailability: {
          status: "stopped",
        },
        prepareForPlan: prepare,
        prepareForSend: prepare,
        onModelChanged: f.no,
        onChanged: f.no,
        onReferenceUsed: f.no,
      });
      editor = composer(tree);
      click = editor.cadence.onClick;
      return tree;
    }
    renderToStaticMarkup(<Probe />);
    if (!click || !editor) throw Error("missing mode toggle");
    expect(editor.draft).toBe(draft);
    // Toggle stays usable even before execution starts.
    expect(editor.cadence.disabled).toBe(false);
    click();
    await Promise.resolve();
    expect(command).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(editor.draft).toBe(draft);
    expect(storage.get("cadence:prompt-history:workspace")).toBeUndefined();
  },
);

function renderFiles(
  cwd?: string,
  opts?: {
    initialListing?: {
      path: string;
      absPath: string;
      parent: string | null;
      entries: { name: string; path: string; directory: boolean }[];
      limited: boolean;
    };
    initialError?: string;
  },
) {
  return renderToStaticMarkup(
    <FilesPanel
      cwd={cwd}
      initialListing={opts?.initialListing}
      initialError={opts?.initialError}
      onReference={() => {}}
    />,
  );
}
it("files stay operable directly on disk whenever a folder is selected, and empty state is distinct from errors", () => {
  const absent = renderFiles(undefined);
  expect(absent).toContain("No folder selected.");
  expect(absent).toMatch(/aria-label="Refresh files" disabled=""/);
  expect(absent).not.toMatch(/No visible files|Reading files|file-preview/);
  const selected = renderFiles("/project/subdir");
  expect(selected).toContain("Project folder:");
  expect(selected).toContain("/project/subdir");
  expect(selected).toContain("Reading files…");
  expect(selected).not.toContain('aria-label="New file" disabled=""');
});
it("only a successful empty file observation says there are no visible files", () => {
  expect(
    renderFiles("/project", {
      initialListing: {
        path: "",
        absPath: "/project",
        parent: "/",
        entries: [],
        limited: false,
      },
    }),
  ).toContain("No visible files");
  const html = renderFiles("/project", {
    initialError: "Directory not readable",
  });
  expect(html).not.toContain("No visible files");
  expect(html).toContain("Directory not readable");
});
it.each(["en", "zh"] as const)(
  "%s: each row offers quick chat reference and a more-actions menu trigger",
  (locale) => {
    const html = renderToStaticMarkup(
      <LocaleProvider initial={locale}>
        <FilesPanel
          cwd="/project"
          initialListing={{
            path: "",
            absPath: "/project",
            parent: "/",
            entries: [
              { name: "src", path: "src", directory: true },
              { name: "notes.md", path: "notes.md", directory: false },
            ],
            limited: false,
          }}
          onReference={() => {}}
        />
      </LocaleProvider>,
    );
    const actions = (name: string) =>
      [...html.matchAll(/class="file-attach[^"]*"[^>]*aria-label="([^"]+)"/g)]
        .map((match) => match[1])
        .filter((label) => label.includes(name));
    expect(actions("notes.md")).toEqual(
      locale === "zh"
        ? ["仅引用路径 notes.md（AI 按需读取）", "notes.md 的更多操作"]
        : [
            "Reference path only: notes.md (the agent reads it on demand)",
            "More actions for notes.md",
          ],
    );
    expect(actions("src")).toEqual(
      locale === "zh"
        ? ["链接文件夹路径 src 到对话", "src 的更多操作"]
        : ["Link folder path src to the chat", "More actions for src"],
    );
  },
);

it.each(["en", "zh"] as const)(
  "%s: preview reports an actual read, supports refresh with retained text, edit, image and binary states",
  (locale) => {
    const path = "notes.txt";
    const file = {
      kind: "text" as const,
      path,
      absPath: "/project/notes.txt",
      name: "notes.txt",
      text: "retained specimen",
      size: 17,
      limited: true,
      editable: false,
    };
    const render = (
      loading: boolean,
      value?: typeof file,
      error?: string,
      selected: string | null = path,
    ) =>
      renderToStaticMarkup(
        <LocaleProvider initial={locale}>
          <FilePreview
            path={selected}
            loading={loading}
            file={value}
            error={error}
            onClose={() => {}}
          />
        </LocaleProvider>,
      );
    const reading = locale === "en" ? "Reading…" : "读取中…";
    const pending = render(true);
    expect(pending).toContain(`<p role="status">${reading}</p>`);
    expect(pending).toContain('title="notes.txt"');
    expect(pending).toContain(
      `aria-label="${locale === "en" ? "Close preview" : "关闭预览"}"`,
    );
    expect(pending).not.toContain('class="codeblock"');
    const refreshing = render(true, file);
    expect(refreshing).toContain(reading);
    expect(refreshing).toContain(file.text);
    const done = render(false, file);
    expect(done).toContain(file.text);
    expect(done).toContain('class="inspector-note"');
    expect(done).not.toContain(reading);
    const empty = render(false, {
      ...file,
      text: "",
      size: 0,
      limited: false,
      editable: true,
    });
    expect(empty).toContain('class="codeblock"');
    expect(empty).not.toMatch(/role="status"|role="alert"|inspector-note/);
    const failed = render(false, undefined, "stale");
    expect(failed).toContain('role="alert"');
    expect(failed).not.toContain(reading);
    const changed = render(true, file, undefined, "next.txt");
    expect(changed).toContain('title="next.txt"');
    expect(changed).toContain(reading);
    expect(changed).not.toContain(file.text);
    expect(render(false, file, undefined, null)).toBe("");
  },
);
