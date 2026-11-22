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
  "%s: the mode toggle shows two-state off/on styling with next-Send tooltips, unknown stays disabled",
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
    for (const [active, armed, cls, text, title] of [
      [
        false,
        false,
        "off",
        chinese ? "开启 Cadence" : "Turn on Cadence",
        chinese
          ? "在发送下一条消息时开启 Cadence 模式：先商定计划，再开始实施。"
          : "Turn on Cadence mode on your next message: agree on a plan before implementation.",
      ],
      [
        false,
        true,
        "on armed",
        chinese ? "关闭 Cadence" : "Turn off Cadence",
        chinese
          ? "发送下一条消息时将开启 Cadence 模式，点击取消。"
          : "Your next message turns on Cadence mode. Click to cancel.",
      ],
      [
        true,
        true,
        "on",
        chinese ? "关闭 Cadence" : "Turn off Cadence",
        chinese
          ? "Cadence 模式已开启，点击后将在发送下一条消息时退出。"
          : "Cadence mode is on. Click to exit on your next message.",
      ],
      [
        true,
        false,
        "off leaving",
        chinese ? "开启 Cadence" : "Turn on Cadence",
        chinese
          ? "发送下一条消息时将退出 Cadence 并按普通对话发送，点击取消。"
          : "Your next message exits Cadence mode and sends normally. Click to stay in Cadence.",
      ],
    ] as const) {
      const html = render(active, armed);
      expect(html).toContain(`class="mode-toggle ${cls}"`);
      expect(html).toContain(`aria-label="${text}"`);
      expect(html).toContain(`title="${title}"`);
      expect(html).toContain('class="mode-toggle-icon"');
      expect(html).toContain(`</span>${text}</button>`);
      expect(html).not.toMatch(/disabled=|aria-pressed="true"/);
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
      expect(html).toContain(`</span>${neutral}</button>`);
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

function renderFiles(enabled: boolean, location?: { id: string; cwd: string }) {
  return renderToStaticMarkup(
    <FilesPanel
      client={new ServiceClient(transport())}
      enabled={enabled}
      location={location}
      onReference={() => {}}
    />,
  );
}
it("files name the conversation directory rather than claiming the host root, and unavailable is not empty", () => {
  const absent = renderFiles(false);
  expect(absent).toContain("The conversation folder has not been observed.");
  expect(absent).toMatch(/aria-label="Refresh files" disabled=""/);
  expect(absent).not.toMatch(/>\/<|No visible files|Reading|file-preview/);
  const stopped = renderFiles(false, { id: "chat", cwd: "/project/subdir" });
  expect(stopped).toContain("Conversation folder:");
  expect(stopped).toContain("/project/subdir");
  // Execution state is not the reason: a stopped owner's folder is readable.
  expect(stopped).toContain("Files appear once this folder has been observed.");
  expect(stopped).not.toContain("execution state");
  expect(stopped).not.toContain("No visible files");
  expect(renderFiles(true)).toContain("Reading files…");
});
it("only a successful empty file observation says there are no visible files", () => {
  files.value = {
    kind: "files",
    path: "",
    entries: [],
    parent: null,
    limited: false,
  };
  expect(renderFiles(true)).toContain("No visible files");
  files.error = "stale";
  const html = renderFiles(true);
  expect(html).not.toContain("No visible files");
  expect(html).toContain("The context changed (stale)");
  expect(html).not.toContain("has been read again");
});
it.each(["en", "zh"] as const)(
  "%s: a file row offers download, path-only reference, copy name and copy path; a folder row has no download",
  (locale) => {
    files.value = {
      kind: "files",
      path: "",
      entries: [
        { name: "src", path: "src", directory: true },
        { name: "notes.md", path: "notes.md", directory: false },
      ],
      parent: null,
      limited: false,
    };
    const html = renderToStaticMarkup(
      <LocaleProvider initial={locale}>
        <FilesPanel
          client={new ServiceClient(transport())}
          enabled
          location={{ id: "chat", cwd: "/project" }}
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
        ? [
            "下载文件 notes.md",
            "仅引用路径 notes.md（AI 按需读取）",
            "复制名称 notes.md",
            "复制路径 notes.md",
          ]
        : [
            "Download file notes.md",
            "Reference path only: notes.md (the agent reads it on demand)",
            "Copy name notes.md",
            "Copy path notes.md",
          ],
    );
    expect(actions("src")).toEqual(
      locale === "zh"
        ? ["链接文件夹路径 src 到对话", "复制名称 src", "复制路径 src"]
        : [
            "Link folder path src to the chat",
            "Copy name src",
            "Copy path src",
          ],
    );
  },
);

// The browser fixture exercises pending responses through the real row click.
it.each(["en", "zh"] as const)(
  "%s: preview reports an actual read, including refresh with retained text",
  (locale) => {
    const path = "notes.txt";
    const file = {
      kind: "file" as const,
      path,
      text: "retained specimen",
      limited: true,
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
            preview={{ loading, value, error }}
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
    const empty = render(false, { ...file, text: "", limited: false });
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
