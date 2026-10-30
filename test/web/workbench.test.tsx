import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { WorkbenchEntry } from "../../src/service/contracts/gateway.ts";
import type {
  ChatItem,
  ChatTurn,
} from "../../src/service/contracts/workbench.ts";
import {
  LAST_PROJECT_STORAGE_KEY,
  projectRunning,
  rememberedProject,
  rememberProject,
  restorableProject,
} from "../../web/src/client/last-project";
import { cadenceInput } from "../../web/src/client/use-workbench";
import {
  LEGACY_OMITTED_NOTICE,
  toolTarget,
  turnParts,
} from "../../web/src/components/workspace/ChatSteps";
import { ChatWelcome } from "../../web/src/components/workspace/ChatWelcome";
import { ChatTurnView } from "../../web/src/components/workspace/ChatWorkspace";
import { ProjectPicker } from "../../web/src/components/workspace/ProjectPicker";
import { WorkbenchHome } from "../../web/src/components/workspace/WorkbenchHome";
import { WorkingFolderButton } from "../../web/src/components/workspace/WorkingFolderButton";
import { LocaleProvider } from "../../web/src/i18n/locale";

afterEach(() => vi.unstubAllGlobals());

it("only an explicit leading command selects Cadence; mentions, quoted commands and code remain ordinary", () => {
  expect(cadenceInput("/cadence fix auth", "chat")).toEqual({
    mode: "cadence",
    text: "fix auth",
  });
  expect(cadenceInput("  cadence\nresearch", "chat")).toEqual({
    mode: "cadence",
    text: "research",
  });
  expect(cadenceInput("cadence", "chat")).toEqual({
    mode: "cadence",
    text: "",
  });
  for (const value of [
    "What is cadence?",
    "cadences are useful",
    "`/cadence fix`",
    "```\n/cadence fix\n```",
    '"cadence fix"',
  ])
    expect(cadenceInput(value, "chat")).toEqual({ mode: "chat", text: value });
  expect(cadenceInput("explicit mode", "cadence")).toEqual({
    mode: "cadence",
    text: "explicit mode",
  });
});
it("ordinary messages use rich text and folded real tool results, not task success inference", () => {
  const html = renderToStaticMarkup(
    <ChatTurnView
      turn={{
        id: "turn",
        epoch: "epoch",
        status: "failed",
        notice: "worker-failure: prompt",
        omitted: { thinking: false, media: false, other: false },
        items: [
          {
            id: "u",
            role: "user",
            text: "Hello",
            name: "",
            args: "",
            error: false,
          },
          {
            id: "t",
            role: "tool",
            text: "actual output",
            name: "read",
            args: '{"path":"file.txt"}',
            error: false,
          },
          {
            id: "a",
            role: "assistant",
            text: "**Visible** response",
            name: "",
            args: "",
            error: false,
          },
        ],
      }}
    />,
  );
  expect(html).toContain("<strong>Visible</strong>");
  expect(html).toContain('<details class="chat-tool">');
  expect(html).toContain("actual output");
  expect(html).toContain("worker-failure: prompt");
  expect(html).toContain("ep-state failed");
  expect(html).not.toContain("PASS");
});
const chatItem = (
  id: string,
  role: ChatItem["role"],
  fields: Partial<ChatItem> = {},
): ChatItem => ({
  id,
  role,
  text: "",
  name: "",
  args: "",
  error: false,
  ...fields,
});
const renderTurn = (turn: Partial<ChatTurn> & Pick<ChatTurn, "items">) =>
  renderToStaticMarkup(
    <ChatTurnView
      turn={{
        id: "turn",
        epoch: "epoch",
        status: "completed",
        notice: "",
        omitted: { thinking: false, media: false, other: false },
        ...turn,
      }}
    />,
  );
it("a turn's steps fold under one summary line and its answer keeps the only speaker label", () => {
  const items = [
    chatItem("user", "user", { text: "Analyze" }),
    chatItem("m1", "assistant"),
    chatItem("t1", "tool", { name: "ls", args: '{"path":"."}' }),
    chatItem("m2", "assistant", { text: "Looking at the sources." }),
    chatItem("t2", "tool", { name: "read", args: '{"path":"a.ts"}' }),
    chatItem("t3", "tool", {
      name: "read",
      args: '{"offset":40,"path":"a.ts"}',
    }),
    chatItem("t4", "tool", {
      name: "read",
      args: '{"path":"b.ts"}',
      error: true,
    }),
    chatItem("t5", "tool", {
      name: "bash",
      args: '{"command":"git log\\n--oneline"}',
    }),
    chatItem("m3", "assistant"),
    chatItem("m4", "assistant", { text: "**Final** answer" }),
  ];
  const parts = turnParts(items);
  expect(parts.steps.map((item) => item.id)).toEqual([
    "t1",
    "m2",
    "t2",
    "t3",
    "t4",
    "t5",
  ]);
  expect(parts.answer.map((item) => item.id)).toEqual(["m4"]);
  const html = renderTurn({
    notice: LEGACY_OMITTED_NOTICE,
    omitted: { thinking: true, media: false, other: false },
    items,
  });
  expect(html.match(/chat-message-role">Cadence</g)).toHaveLength(1);
  expect(html).toContain("Listed 1 directory · Read 2 files · Ran 1 command");
  expect(html).toContain("1 failed");
  expect(html).not.toMatch(/<details class="chat-steps"[^>]*\sopen/);
  expect(html).toContain(">git log</span>");
  expect(html).toContain("Looking at the sources.");
  expect(html).toContain("Thinking is not retained.");
  expect(html).not.toContain("Hidden thinking");
  expect(html).not.toContain("chat-turn-notice");
  expect(html).toContain("<strong>Final</strong>");
});
it("a running turn shows its latest step live and a turn ending without an answer opens its steps", () => {
  const user = chatItem("user", "user", { text: "Analyze" });
  const read = chatItem("t", "tool", {
    name: "read",
    args: '{"path":"src/x.ts"}',
  });
  const running = renderTurn({ status: "running", items: [user, read] });
  expect(running).toContain("chat-steps-live");
  expect(running).toContain("Working… read src/x.ts");
  expect(renderTurn({ status: "running", items: [user] })).toContain(
    "Working…",
  );
  expect(renderTurn({ status: "failed", items: [user, read] })).toMatch(
    /<details class="chat-steps"[^>]*\sopen=""/,
  );
  const plain = renderTurn({
    items: [user, chatItem("a", "assistant", { text: "Hi" })],
  });
  expect(plain).not.toContain("chat-steps");
  expect(plain.match(/chat-message-role">Cadence</g)).toHaveLength(1);
  expect(toolTarget('{"path":')).toBe("");
  expect(toolTarget('["path"]')).toBe("");
  expect(toolTarget('{"pattern":"TODO","path":"src"}')).toBe("TODO  src");
});
it("step summaries count model-named tools without reaching the prototype", () => {
  const user = chatItem("user", "user", { text: "Analyze" });
  const tool = (id: string, name: string, args = "{}") =>
    chatItem(id, "tool", { name, args });
  const html = renderTurn({
    items: [
      user,
      tool("a", "constructor"),
      tool("b", "__proto__"),
      tool("c", "toString"),
      tool("d", "powershell", '{"command":"Get-ChildItem"}'),
      tool("e", "ls"),
      tool("f", "ls", '{"limit":5}'),
      tool("g", "ls", '{"path":'),
      chatItem("z", "assistant", { text: "Done" }),
    ],
  });
  // The working directory counts once; partial arguments name nothing.
  expect(html).toContain("Used 3 tools · Ran 1 command · Listed 2 directories");
});
it("each omitted content kind gets its own line and a title when no tool ran", () => {
  const user = chatItem("user", "user", { text: "Analyze" });
  const omitted = (thinking: boolean, media: boolean, other: boolean) =>
    renderTurn({ omitted: { thinking, media, other }, items: [user] });
  const all = omitted(true, true, true);
  expect(all.match(/class="chat-steps-omitted"/g)).toHaveLength(3);
  expect(all).toContain("Other content is not retained.");
  expect(all).toContain('chat-steps-title">Thought<');
  expect(omitted(false, true, false)).toContain(
    'chat-steps-title">Media not retained<',
  );
  const other = omitted(false, false, true);
  expect(other).toContain('chat-steps-title">Content not retained<');
  expect(other).not.toContain("Media is not retained.");
});

it("the project-less entry is a conversation shell with navigation at bottom right, not a project landing page", () => {
  const open = vi.fn();
  const html = renderToStaticMarkup(
    <WorkbenchHome ready onOpenFolder={open} />,
  );
  expect(html).toContain('class="panel panel-left lp-panel"');
  expect(html).toContain("New conversation");
  expect(html).toContain("Conversation history");
  expect(html).toContain(
    "Conversations are kept with each project. Open a working folder to see its history.",
  );
  expect(html).not.toContain("No conversations yet.");
  expect(html).toContain("What would you like to work on?");
  expect(html).toContain('class="panel files-panel"');
  expect(html).toMatch(/<textarea disabled="" aria-label="Message"/);
  expect(html).toMatch(
    /class="statusbar-right".*aria-label="Switch working folder"/,
  );
  for (const label of [
    "Your workbench, your projects",
    "Recent projects",
    "Create task",
    "No active runs",
  ])
    expect(html).not.toContain(label);
  expect(open).not.toHaveBeenCalled();
  const chinese = renderToStaticMarkup(
    <LocaleProvider initial="zh">
      <WorkbenchHome ready onOpenFolder={open} />
    </LocaleProvider>,
  );
  expect(chinese).toContain("新对话");
  expect(chinese).toContain("在右下角选择工作文件夹");
  expect(chinese).not.toContain("你的工作台，你的项目");
});

it("the shared empty conversation has no central task creation shortcut", () => {
  const html = renderToStaticMarkup(<ChatWelcome />);
  expect(html).toContain("What would you like to work on?");
  expect(html).not.toContain("<button");
});

it("folder navigation keeps the full current path and recent choices in the picker without opening on render", () => {
  const read = vi.fn(),
    open = vi.fn();
  const button = renderToStaticMarkup(
    <WorkingFolderButton path="/projects/a & b" onClick={open} />,
  );
  expect(button).toContain('title="/projects/a &amp; b"');
  expect(button).toContain("Switch working folder");
  const picker = renderToStaticMarkup(
    <ProjectPicker
      client={{ workbenchRead: read }}
      current="/projects/a"
      epoch="epoch"
      projects={[
        { path: "/projects/a", current: true },
        { path: "/projects/b", current: false },
      ]}
      onClose={() => {}}
      onOpen={open}
    />,
  );
  expect(picker).toContain('aria-label="Recent projects"');
  expect(picker).toContain('aria-current="true"');
  expect(picker).toContain("/projects/b");
  expect(picker).toContain('title="Open /projects/b"');
  // Before the first observation settles nothing is named or openable, and
  // there is no separate Browse step.
  expect(picker).toContain("Reading folder…");
  expect(picker).toMatch(/<button[^>]*class="primary"[^>]*disabled=""/);
  expect(picker).toContain("Open this folder");
  expect(picker).not.toContain(">Browse<");
  expect(open).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
  const chinese = renderToStaticMarkup(
    <LocaleProvider initial="zh">
      <ProjectPicker
        client={{ workbenchRead: read }}
        current="/projects/a"
        epoch="epoch"
        onClose={() => {}}
      />
    </LocaleProvider>,
  );
  expect(chinese).toContain("打开此文件夹");
  expect(chinese).not.toContain("浏览");
});

it("the entry sidebar explains per-project history and lists recent projects without opening one", () => {
  const open = vi.fn();
  const projects = ["/work/alpha", "/work/beta & co"];
  const html = renderToStaticMarkup(
    <WorkbenchHome ready projects={projects} onOpenFolder={open} />,
  );
  expect(html).toContain(
    "Conversations are kept with each project. Choose a project below and open it to see its history.",
  );
  expect(html).toMatch(
    /class="session-item project-item" title="\/work\/alpha".*>alpha<.*\/work\/alpha</,
  );
  expect(html).toContain("beta &amp; co");
  expect(html).not.toContain("Recent projects");
  expect(open).not.toHaveBeenCalled();
  const checking = renderToStaticMarkup(
    <WorkbenchHome
      ready
      projects={projects}
      restore={{ status: "checking", path: "/work/alpha" }}
      onOpenFolder={open}
    />,
  );
  expect(checking).toContain("Returning to your last project alpha…");
  const stopped = renderToStaticMarkup(
    <LocaleProvider initial="zh">
      <WorkbenchHome
        ready
        projects={projects}
        restore={{ status: "stopped", path: "/work/alpha" }}
        onOpenFolder={open}
      />
    </LocaleProvider>,
  );
  expect(stopped).toContain("上次的项目 alpha 当前未运行");
  expect(stopped).toContain("历史对话");
  const loading = renderToStaticMarkup(
    <WorkbenchHome ready={false} projects={projects} onOpenFolder={open} />,
  );
  expect(loading).toMatch(
    /<button type="button" class="session-item project-item"[^>]*disabled=""/,
  );
  expect(open).not.toHaveBeenCalled();
});

const key = (c: string) => c.repeat(64);
function entry(...ids: string[]): WorkbenchEntry {
  return {
    projects: ids.map((id) => ({
      id,
      path: `/state/${id}`,
      cwd: `/work/${id.slice(0, 1)}`,
      epoch: "epoch",
    })),
  } as unknown as WorkbenchEntry;
}
function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const setItem = vi.fn((name: string, value: string) => {
    values.set(name, value);
  });
  vi.stubGlobal("localStorage", {
    getItem: (name: string) => values.get(name) ?? null,
    setItem,
  });
  return { values, setItem };
}

it("the remembered project is an opaque associated key; unavailable storage never fails", () => {
  expect(rememberedProject()).toBeNull();
  expect(() => rememberProject(key("a"))).not.toThrow();
  const { values, setItem } = storage();
  rememberProject(key("a"));
  rememberProject(key("a"));
  expect(setItem).toHaveBeenCalledTimes(1);
  expect(values.get(LAST_PROJECT_STORAGE_KEY)).toBe(key("a"));
  expect(restorableProject(entry(key("b"), key("a")))?.cwd).toBe("/work/a");
  expect(restorableProject(entry(key("b")))).toBeUndefined();
  for (const saved of ["/work/a", key("A"), `${key("a")}0`, ""]) {
    storage({ [LAST_PROJECT_STORAGE_KEY]: saved });
    expect(rememberedProject()).toBeNull();
    expect(restorableProject(entry(key("a")))).toBeUndefined();
  }
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  });
  expect(rememberedProject()).toBeNull();
  expect(() => rememberProject(key("a"))).not.toThrow();
});

it("restoring checks a running owner with one readonly project listing, never Open", async () => {
  vi.stubGlobal("window", {
    location: new URL("http://127.0.0.1:17423/app"),
  });
  const requests: { url: string; method?: string }[] = [];
  let reply: unknown = {
    kind: "ok",
    value: { kind: "conversations", entries: [] },
  };
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    requests.push({ url, method: init?.method });
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply));
  });
  expect(await projectRunning(key("a"), new AbortController().signal)).toBe(
    true,
  );
  expect(requests).toHaveLength(1);
  expect(requests[0].method).toBe("GET");
  expect(requests[0].url).toMatch(
    new RegExp(`^http://127\\.0\\.0\\.1:17423/projects/${key("a")}/`),
  );
  expect(requests[0].url).not.toContain("open");
  reply = {
    kind: "error",
    error: { code: "unavailable", effect: "none", recovery: "operator" },
  };
  expect(await projectRunning(key("a"), new AbortController().signal)).toBe(
    false,
  );
  reply = new Error("network");
  expect(await projectRunning(key("a"), new AbortController().signal)).toBe(
    false,
  );
  const aborted = new AbortController();
  aborted.abort();
  reply = { kind: "ok", value: { kind: "conversations", entries: [] } };
  expect(await projectRunning(key("a"), aborted.signal)).toBe(false);
  expect(requests.every((request) => request.method === "GET")).toBe(true);
});
