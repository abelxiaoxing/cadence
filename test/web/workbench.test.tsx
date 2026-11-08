import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { WorkbenchEntry } from "../../src/service/contracts/gateway.ts";
import {
  type ChatItem,
  type ChatTurn,
  toolTarget,
} from "../../src/service/contracts/workbench.ts";
import { ServiceClient } from "../../src/service-client.ts";
import {
  LAST_PROJECT_STORAGE_KEY,
  projectReadable,
  rememberedProject,
  rememberProject,
  restorableProject,
} from "../../web/src/client/last-project";
import { recordedTurn } from "../../web/src/client/turn-source";
import { cadenceInput } from "../../web/src/client/use-workbench";
import {
  LEGACY_OMITTED_NOTICE,
  turnParts,
} from "../../web/src/components/workspace/ChatSteps";
import { ChatWelcome } from "../../web/src/components/workspace/ChatWelcome";
import {
  ChatTurnView,
  ChatWorkspace,
} from "../../web/src/components/workspace/ChatWorkspace";
import { ProjectPicker } from "../../web/src/components/workspace/ProjectPicker";
import { WorkbenchHome } from "../../web/src/components/workspace/WorkbenchHome";
import { WorkingFolderButton } from "../../web/src/components/workspace/WorkingFolderButton";
import { LocaleProvider } from "../../web/src/i18n/locale";
import { transport } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());

it("only an explicit leading command selects Cadence; mentions, quoted commands and code remain ordinary", () => {
  expect(cadenceInput("/cadence fix auth", "chat")).toEqual({
    mode: "cadence",
    text: "fix auth",
  });
  expect(cadenceInput("  /cadence\nresearch", "chat")).toEqual({
    mode: "cadence",
    text: "research",
  });
  expect(cadenceInput("/cadence", "chat")).toEqual({
    mode: "cadence",
    text: "",
  });
  for (const value of [
    "cadence",
    "cadence is a mode",
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
it("ordinary messages use rich text and folded real tool results, not task success inference", async () => {
  const turn = recordedTurn({
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
  });
  const html = renderToStaticMarkup(<ChatTurnView turn={turn} />);
  expect(html).toContain("<strong>Visible</strong>");
  expect(html).toContain('<details class="chat-tool">');
  expect(html).toContain(">file.txt</span>");
  // A tool's arguments and output are read only once its step is opened.
  expect(html).not.toContain("actual output");
  expect(await turn.detail(1, 1, new AbortController().signal)).toEqual({
    text: "actual output",
    args: '{"path":"file.txt"}',
  });
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
      turn={recordedTurn({
        id: "turn",
        epoch: "epoch",
        status: "completed",
        notice: "",
        omitted: { thinking: false, media: false, other: false },
        ...turn,
      })}
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
  const parts = turnParts(
    recordedTurn({
      id: "turn",
      epoch: "epoch",
      status: "completed",
      notice: "",
      omitted: { thinking: false, media: false, other: false },
      items,
    }).steps,
  );
  expect(parts.steps.map(({ step }) => step.id)).toEqual([
    "t1",
    "m2",
    "t2",
    "t3",
    "t4",
    "t5",
  ]);
  expect(parts.answer.map(({ step }) => step.id)).toEqual(["m4"]);
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
      tool("g", "ls", '{"path":"src"}'),
      chatItem("z", "assistant", { text: "Done" }),
    ],
  });
  // A listing without a path is the working directory and counts once.
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

it("the project-less entry is a conversation shell with one central Open action and navigation at bottom right, not a project landing page", () => {
  const open = vi.fn();
  const html = renderToStaticMarkup(
    <WorkbenchHome ready onOpenFolder={open} />,
  );
  expect(html).toContain('class="panel panel-left lp-panel"');
  // One central action opens the folder picker; no duplicate sidebar entry.
  expect(html).toMatch(
    /class="primary welcome-action"[^>]*>.*Choose a folder…/,
  );
  expect(html).not.toContain("New conversation");
  expect(html).toContain("Conversation history");
  expect(html).toContain(
    "Choose a working folder to see its conversation history.",
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
  expect(chinese).toContain("选择目录…");
  expect(chinese).toContain("选择工作目录后即可开始对话");
  // The welcome and the composer no longer point in different directions.
  expect(chinese).not.toContain("右下角");
  expect(chinese).not.toContain("从左侧");
  expect(chinese).not.toContain("你的工作台，你的项目");
});

it("the shared empty conversation has no central task creation shortcut", () => {
  const html = renderToStaticMarkup(<ChatWelcome hint="Type below." />);
  expect(html).toContain("What would you like to work on?");
  expect(html).toContain("Type below.");
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

it("the entry sidebar explains per-project history and lists recent projects without opening one on render", () => {
  const open = vi.fn();
  const projects = ["/work/alpha", "/work/beta & co"];
  const html = renderToStaticMarkup(
    <WorkbenchHome ready projects={projects} onOpenFolder={open} />,
  );
  expect(html).toContain(
    "Conversations stay with their folder. Select one to read its history; Send prepares execution.",
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
        restore={{ status: "unavailable", path: "/work/alpha" }}
        onOpenFolder={open}
      />
    </LocaleProvider>,
  );
  expect(stopped).toContain("无法读取 alpha 的历史会话");
  expect(stopped).toContain("历史会话");
  const loading = renderToStaticMarkup(
    <WorkbenchHome ready={false} projects={projects} onOpenFolder={open} />,
  );
  expect(loading).toMatch(
    /<button type="button" class="session-item project-item"[^>]*disabled=""/,
  );
  // While one recent project opens, every entry waits and that one says so.
  const opening = renderToStaticMarkup(
    <WorkbenchHome
      ready
      projects={projects}
      opening="/work/alpha"
      onOpenFolder={open}
      onOpenProject={open}
    />,
  );
  expect(opening).toContain("Selecting folder…");
  expect(opening).toMatch(/aria-busy="true"/);
  expect(opening.match(/project-item"[^>]*disabled=""/g)?.length).toBe(2);
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

it("restoring observes retained identity even for a stopped owner, without a scan or Open", async () => {
  vi.stubGlobal("window", {
    location: new URL("http://127.0.0.1:17423/app"),
  });
  const requests: { url: string; method?: string }[] = [];
  let reply: unknown = {
    kind: "project-observation",
    status: "stopped",
    epoch: "11111111-1111-4111-8111-111111111111",
    workspaceId: "22222222-2222-4222-8222-222222222222",
  };
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    requests.push({ url, method: init?.method });
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply));
  });
  expect(await projectReadable(key("a"), new AbortController().signal)).toBe(
    true,
  );
  expect(requests).toHaveLength(1);
  expect(requests[0].method).toBeUndefined();
  expect(requests[0].url).toMatch(
    new RegExp(`^/workbench/v1/projects/${key("a")}$`),
  );
  expect(requests[0].url).not.toContain("open");
  reply = {
    kind: "error",
    error: { code: "unavailable", effect: "none", recovery: "operator" },
  };
  expect(await projectReadable(key("a"), new AbortController().signal)).toBe(
    false,
  );
  reply = new Error("network");
  expect(await projectReadable(key("a"), new AbortController().signal)).toBe(
    false,
  );
  const aborted = new AbortController();
  aborted.abort();
  reply = { kind: "ok", value: { kind: "conversations", entries: [] } };
  expect(await projectReadable(key("a"), aborted.signal)).toBe(false);
  expect(requests.every((request) => !request.method)).toBe(true);
});

it("a failed project observation retains identity but not readiness; unavailable and refresh-pending are not stopped", async () => {
  const { projectObservationResult, projectReadiness } = await import(
    "../../web/src/client/use-project-observation"
  );
  expect(projectReadiness()).toBe("unknown");
  const failedFirstRead = projectObservationResult(
    undefined,
    undefined,
    "offline",
  );
  expect(failedFirstRead).toEqual({ value: undefined, error: "offline" });
  expect(projectReadiness(failedFirstRead.value, failedFirstRead.error)).toBe(
    "unknown",
  );
  const running = {
    kind: "project-observation" as const,
    status: "running" as const,
    epoch: "epoch",
    workspaceId: "history",
  };
  const lost = projectObservationResult(running, undefined, "offline");
  expect(lost.value).toBe(running);
  expect(projectReadiness(lost.value, lost.error)).toBe("stale");
  const unavailable = projectObservationResult(running, {
    ...running,
    status: "unavailable",
    epoch: null,
    workspaceId: null,
  });
  expect(unavailable.value).toBe(running);
  expect(projectReadiness(unavailable.value, unavailable.error)).toBe("stale");
  expect(projectReadiness(undefined, "offline")).toBe("unknown");
  expect(projectReadiness({ ...running, status: "unavailable" })).toBe(
    "unknown",
  );
  expect(projectReadiness(running, undefined, false)).toBe("stale");
  expect(projectReadiness({ ...running, status: "stopped" }, "offline")).toBe(
    "stale",
  );
  const restored = projectObservationResult(lost.value, running);
  expect(projectReadiness(restored.value, restored.error)).toBe("running");
});

it.each(["cold", "same-epoch", "replacement"])(
  "%s: confirmed preparation is current before its GET; older reads cannot undo it",
  async (scenario) => {
    // Controlled hook callbacks, not a DOM or browser lifecycle test.
    const React = await vi.importActual<typeof import("react")>("react");
    vi.useFakeTimers();
    const cells: unknown[] = [];
    let cursor = 0;
    let deps: readonly unknown[] | undefined;
    let pendingEffect: import("react").EffectCallback | undefined;
    let cleanup: (() => void) | undefined;
    vi.doMock("react", () => ({
      ...React,
      useState: ((initial: unknown) => {
        const at = cursor++;
        if (!Object.hasOwn(cells, at)) cells[at] = initial;
        return [
          cells[at],
          (update: unknown) => {
            cells[at] =
              typeof update === "function" ? update(cells[at]) : update;
          },
        ];
      }) as typeof React.useState,
      useRef: ((initial: unknown) => {
        const at = cursor++;
        if (!Object.hasOwn(cells, at)) cells[at] = { current: initial };
        return cells[at];
      }) as typeof React.useRef,
      useCallback: ((fn) => fn) as typeof React.useCallback,
      useEffect: ((effect, next) => {
        if (!deps || next?.some((value, i) => !Object.is(value, deps?.[i]))) {
          deps = next;
          pendingEffect = effect;
        }
      }) as typeof React.useEffect,
    }));
    vi.resetModules();
    const { useProjectObservation } = await import(
      "../../web/src/client/use-project-observation"
    );
    const requests: {
      resolve(response: Response): void;
      reject(error: Error): void;
    }[] = [];
    const fetcher = vi.fn<typeof fetch>(
      () =>
        new Promise((resolve, reject) => {
          requests.push({ resolve, reject });
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const epoch = crypto.randomUUID();
    const before =
      scenario === "cold"
        ? null
        : scenario === "same-epoch"
          ? epoch
          : crypto.randomUUID();
    const render = (selectedEpoch: string | null) => {
      cursor = 0;
      // biome-ignore lint/correctness/useHookAtTopLevel: controlled hook harness, not a React render.
      return useProjectObservation("a".repeat(64), selectedEpoch);
    };
    const flushEffect = () => {
      if (!pendingEffect) return;
      cleanup?.();
      const effect = pendingEffect;
      pendingEffect = undefined;
      const result = effect();
      cleanup = typeof result === "function" ? result : undefined;
    };
    try {
      const initial = render(before);
      flushEffect();
      expect(requests).toHaveLength(1);
      initial.prepared(epoch);
      // Resolve the old GET before effect cleanup: synchronous invalidation,
      // not abort timing, must prevent this result overwriting confirmation.
      requests[0].resolve(
        Response.json({
          kind: "project-observation",
          status: "stopped",
          epoch: null,
          workspaceId: null,
        }),
      );
      await vi.advanceTimersByTimeAsync(0);
      const confirmed = render(epoch);
      expect(confirmed.readiness).toBe("running");
      expect(confirmed.value?.epoch).toBe(epoch);
      expect(confirmed.error).toBeUndefined();
      flushEffect();
      expect(requests).toHaveLength(2);
      requests[1].reject(new Error("offline"));
      await vi.advanceTimersByTimeAsync(0);
      const stale = render(epoch);
      expect(stale.readiness).toBe("stale");
      expect(stale.value?.epoch).toBe(epoch);
      expect(stale.error).toBe("offline");
      stale.refresh();
      stale.prepared(epoch);
      expect(render(epoch).readiness).toBe("running");
      expect(
        fetcher.mock.calls.every(
          ([, init]) => !init?.method || init.method === "GET",
        ),
      ).toBe(true);
    } finally {
      cleanup?.();
      vi.doUnmock("react");
      vi.resetModules();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  },
);

it("the minimal composer keeps the image action without a permanent image-help paragraph", () => {
  for (const locale of ["en", "zh"] as const) {
    const html = renderToStaticMarkup(
      <LocaleProvider initial={locale}>
        <ChatWorkspace
          modelAvailability={{ status: "unavailable" }}
          client={new ServiceClient(transport())}
          id="conversation"
          workspaceId="workspace"
          enabled={false}
          onModelChanged={() => {}}
          onChanged={() => {}}
          onReferenceUsed={() => {}}
        />
      </LocaleProvider>,
    );
    expect(html).toContain(
      locale === "zh" ? 'aria-label="添加图片"' : 'aria-label="Add images"',
    );
    expect(html).not.toContain("composer-image-help");
    expect(html).not.toContain("MiB");
    expect(html).not.toContain("Unsent images");
    expect(html).not.toContain("未发送图片");
  }
});

it.each([false, true])(
  "unavailable context keeps draft editing, but an uncertain Send (%s) keeps its original input locked",
  (pending) => {
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) =>
        key.endsWith(":pending")
          ? pending
            ? "original-command"
            : null
          : key.endsWith(":mode")
            ? "chat"
            : "Kept draft",
    });
    const send = vi.fn();
    const client = new ServiceClient(transport({ workbenchCommand: send }));
    const html = renderToStaticMarkup(
      <ChatWorkspace
        modelAvailability={{ status: "unavailable" }}
        client={client}
        id="session"
        workspaceId="checkout"
        enabled={false}
        onChanged={() => {}}
        onModelChanged={() => {}}
        onReferenceUsed={() => {}}
      />,
    );
    expect(html).toContain("Kept draft");
    const input = html.match(/<textarea[^>]*>/)?.[0];
    expect(input).toBeDefined();
    expect(input?.includes('disabled=""')).toBe(pending);
    expect(html).toMatch(/type="submit" class="primary" disabled=""/);
    expect(html).not.toContain("What would you like to work on?");
    expect(html).not.toContain("New conversation");
    if (pending) expect(html).toContain("original-command");
    expect(send).not.toHaveBeenCalled();
  },
);
