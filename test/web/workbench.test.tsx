import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import type { WorkbenchEntry } from "../../src/service/contracts/gateway.ts";
import {
  type ChatItem,
  type ChatTurn,
  PROJECT_ASSOCIATION_HEADER,
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
import { ObservationAccess } from "../../web/src/client/observer";
import { recordedTurn } from "../../web/src/client/turn-source";
import { cadenceInput } from "../../web/src/client/use-workbench";
import {
  LEGACY_OMITTED_NOTICE,
  toolState,
  turnParts,
} from "../../web/src/components/workspace/ChatSteps";
import { ChatWelcome } from "../../web/src/components/workspace/ChatWelcome";
import {
  ChatTurnView,
  ChatWorkspace,
} from "../../web/src/components/workspace/ChatWorkspace";
import { FolderSetup } from "../../web/src/components/workspace/FolderSetup";
import { messageText } from "../../web/src/components/workspace/MessageActions";
import { ProjectPicker } from "../../web/src/components/workspace/ProjectPicker";
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
it("ordinary messages use rich text and real tool cards, not task success inference", async () => {
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
        state: "completed",
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
  // The recorded tool result is independent of this reply's failure.
  expect(html).toContain('<div class="toolcall ok">');
  expect(html).toContain('aria-label="Tool result recorded"');
  expect(html).toContain(">file.txt</span>");
  // A tool's arguments and output are read only once its card is opened.
  expect(html).toContain('aria-expanded="false"');
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
const sourceOf = (turn: Partial<ChatTurn> & Pick<ChatTurn, "items">) =>
  recordedTurn({
    id: "turn",
    epoch: "epoch",
    status: "completed",
    notice: "",
    omitted: { thinking: false, media: false, other: false },
    ...turn,
  });
const renderTurn = (turn: Partial<ChatTurn> & Pick<ChatTurn, "items">) =>
  renderToStaticMarkup(<ChatTurnView turn={sourceOf(turn)} />);
it("a turn's messages and tool cards keep their recorded order under one speaker label", () => {
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
  const parts = turnParts(sourceOf({ items }).steps);
  expect(parts.user.map(({ step }) => step.id)).toEqual(["user"]);
  // Assistant messages that only carried tool calls have nothing to show.
  expect(parts.replies.map(({ step }) => step.id)).toEqual([
    "t1",
    "m2",
    "t2",
    "t3",
    "t4",
    "t5",
    "m4",
  ]);
  const html = renderTurn({
    notice: LEGACY_OMITTED_NOTICE,
    omitted: { thinking: true, media: false, other: false },
    items,
  });
  expect(html.match(/class="msg-role">Cadence</g)).toHaveLength(1);
  expect(html.match(/<div class="toolcall /g)).toHaveLength(5);
  expect(html.match(/<div class="toolcall err">/g)).toHaveLength(1);
  expect(html).toContain('aria-label="Tool error recorded"');
  // No card is open, and none is folded away behind a summary.
  expect(html).not.toContain('aria-expanded="true"');
  expect(html).not.toContain("<details");
  expect(html).toContain(">$ git log</span>");
  const order = [
    'title="."',
    "Looking at the sources.",
    'title="a.ts"',
    'title="b.ts"',
    'title="git log"',
    "<strong>Final</strong>",
  ].map((mark) => html.indexOf(mark));
  expect(order.every((at) => at >= 0)).toBe(true);
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(html).toContain("Thinking that could not be read is not shown.");
  expect(html).not.toContain("Hidden thinking");
  expect(html).not.toContain("chat-turn-notice");
});
it("a tool card states what was recorded for its call, live or settled", () => {
  const user = chatItem("user", "user", { text: "Analyze" });
  const read = chatItem("t", "tool", {
    name: "read",
    args: '{"path":"src/x.ts"}',
  });
  // Legacy stability says nothing about a tool result. Keep it readable and neutral.
  const running = renderTurn({ status: "running", items: [user, read] });
  expect(running).toContain('<div class="toolcall idle">');
  expect(
    renderTurn({ items: [user, { ...read, state: "completed" }] }),
  ).toContain('<div class="toolcall ok">');
  expect(running).toMatch(/class="msg-working" role="status">.*Working…/);
  expect(renderTurn({ status: "running", items: [user] })).toContain(
    "Working…",
  );
  // Only observed execution, not stable/parts, says a call is in progress.
  const settled = sourceOf({
    status: "running",
    items: [user, { ...read, state: "running" }],
  });
  const live = { ...settled, header: { ...settled.header, stable: 1 } };
  expect(toolState(live, 1)).toBe("run");
  const inFlight = renderToStaticMarkup(<ChatTurnView turn={live} />);
  expect(inFlight).toContain('<div class="toolcall run">');
  expect(inFlight).toContain('aria-label="Tool call in progress"');
  expect(inFlight).not.toContain("msg-working");
  // A turn that ended badly right after a call never claims its result.
  const failed = renderTurn({ status: "failed", items: [user, read] });
  expect(failed).toContain('<div class="toolcall idle">');
  expect(failed).toContain('aria-label="No tool result observed"');
  expect(failed).not.toContain("Tool result recorded");
  const plain = renderTurn({
    items: [user, chatItem("a", "assistant", { text: "Hi" })],
  });
  expect(plain).not.toContain("toolcall");
  expect(plain).not.toContain("msg-text-copy");
  expect(plain.split('class="msg msg-assistant"')[1]).toMatch(
    /class="msg-meta".*aria-label="Copy message".*class="msg-body"/,
  );
  expect(plain.match(/class="msg-role">Cadence</g)).toHaveLength(1);
  expect(toolTarget('{"path":')).toBe("");
  expect(toolTarget('["path"]')).toBe("");
  expect(toolTarget('{"pattern":"TODO","path":"src"}')).toBe("TODO  src");
});
it.each(["en", "zh"] as const)(
  "tool outcomes and unexecuted declarations stay independent of running and terminal replies (%s, SSR)",
  async (locale) => {
    const cases = [
      {
        fields: { state: "completed" as const },
        state: "ok",
        label: locale === "en" ? "Tool result recorded" : "已记录工具结果",
      },
      {
        fields: { state: "failed" as const, error: true },
        state: "err",
        label: locale === "en" ? "Tool error recorded" : "已记录工具错误",
      },
      {
        fields: { state: "running" as const },
        state: "idle",
        label: locale === "en" ? "No tool result observed" : "未观察到工具结果",
      },
      ...(["unavailable", "canceled"] as const).map((state) => ({
        fields: { state, error: false },
        state: "idle",
        label: locale === "en" ? "No tool result observed" : "未观察到工具结果",
      })),
      // A readable legacy body is not evidence of tool-end. A recorded error is.
      {
        fields: {},
        state: "idle",
        label: locale === "en" ? "No tool result observed" : "未观察到工具结果",
      },
      {
        fields: { error: true },
        state: "err",
        label: locale === "en" ? "Tool error recorded" : "已记录工具错误",
      },
    ];
    for (const status of [
      "running",
      "completed",
      "failed",
      "canceled",
      "unknown",
    ] as const) {
      for (const test of cases) {
        const noResult = ["unavailable", "canceled"].includes(
          test.fields.state ?? "",
        );
        const item = chatItem("call", "tool", {
          name: "read",
          args: '{"path":"file.ts","offset":17}',
          text: noResult ? "" : "Retained output is not a completion event",
          ...test.fields,
        });
        const source = sourceOf({ status, items: [item] });
        const detail = vi.fn(source.detail);
        source.detail = detail;
        const active = status === "running" && item.state === "running";
        const state = active ? "run" : test.state;
        const label = active
          ? locale === "en"
            ? "Tool call in progress"
            : "工具调用进行中"
          : test.label;
        expect(source.header.stable).toBe(1);
        expect(source.steps[0].parts).toBe(1);
        expect(source.steps[0].state).toBe(item.state);
        expect(toolState(source, 0)).toBe(state);
        const html = renderToStaticMarkup(
          <LocaleProvider initial={locale}>
            <ChatTurnView turn={source} />
          </LocaleProvider>,
        );
        expect(html).toContain(`<div class="toolcall ${state}">`);
        expect(html).toContain(`aria-label="${label}"`);
        expect(html).toContain('aria-expanded="false"');
        if (item.text) expect(html).not.toContain(item.text);
        expect(html).not.toContain("toolcall-body");
        expect(detail).not.toHaveBeenCalled();
        expect(await source.detail(0, 1, new AbortController().signal)).toEqual(
          { text: item.text, args: item.args },
        );
        expect(detail).toHaveBeenCalledTimes(1);
        if (!active) expect(html).not.toContain('class="toolcall run"');
        if (noResult) {
          expect(html).not.toContain('class="toolcall err"');
          expect(html).not.toContain(
            locale === "en" ? "Tool error recorded" : "已记录工具错误",
          );
        }
        if (status !== "completed" && status !== "running")
          expect(html).toContain(`<p class="ep-state ${status}">`);
      }
    }
  },
);

it("tool cards take model-named tools without reaching the prototype", () => {
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
      tool("e", "ls", '{"path":"src"}'),
      chatItem("z", "assistant", { text: "Done" }),
    ],
  });
  // A name matching no known kind, inherited ones included, is a plain tool.
  expect(html.match(/tc-tone-default/g)).toHaveLength(3);
  expect(html.match(/tc-tone-exec/g)).toHaveLength(1);
  expect(html.match(/tc-tone-read/g)).toHaveLength(1);
  for (const name of ["constructor", "__proto__", "toString"])
    expect(html).toContain(`toolcall-name">${name}</span>`);
  expect(html).toContain(">$ Get-ChildItem</span>");
});
it("each omitted content kind gets its own line, also when nothing else was recorded", () => {
  const user = chatItem("user", "user", { text: "Analyze" });
  const omitted = (thinking: boolean, media: boolean, other: boolean) =>
    renderTurn({ omitted: { thinking, media, other }, items: [user] });
  const all = omitted(true, true, true);
  expect(all.match(/class="msg-omitted"/g)).toHaveLength(3);
  expect(all).toContain("Thinking that could not be read is not shown.");
  expect(all).toContain("Other content is not retained.");
  expect(all.match(/class="msg-role">Cadence</g)).toHaveLength(1);
  const other = omitted(false, false, true);
  expect(other.match(/class="msg-omitted"/g)).toHaveLength(1);
  expect(other).not.toContain("Media is not retained.");
  expect(omitted(false, false, false)).not.toContain("msg-assistant");
});
it("a readable thinking block is a folded card in its recorded place, never the answer and never a tool", async () => {
  const user = chatItem("user", "user", { text: "Analyze" });
  const think = (id: string, text: string) =>
    chatItem(id, "thinking", { text });
  const read = chatItem("t", "tool", { name: "read", args: '{"path":"a.ts"}' });
  const answer = chatItem("a", "assistant", { text: "**Final** answer" });
  const items = [
    user,
    think("k1", "First I should read the file."),
    read,
    think("k2", "  The import moved.\n\nSo the fix is one line.  "),
    answer,
  ];
  const turn = sourceOf({ items });
  // Listed like a tool: no text until its step detail is read.
  expect(turn.steps.map((step) => [step.role, step.text])).toEqual([
    ["user", "Analyze"],
    ["thinking", ""],
    ["tool", ""],
    ["thinking", ""],
    ["assistant", "**Final** answer"],
  ]);
  expect(turnParts(turn.steps).replies.map(({ step }) => step.id)).toEqual([
    "k1",
    "t",
    "k2",
    "a",
  ]);
  expect(await turn.detail(3, 1, new AbortController().signal)).toEqual({
    text: "  The import moved.\n\nSo the fix is one line.  ",
    args: "",
  });
  const html = renderToStaticMarkup(<ChatTurnView turn={turn} />);
  expect(html.match(/<div class="thinking">/g)).toHaveLength(2);
  expect(html.match(/<div class="toolcall /g)).toHaveLength(1);
  // Folded, and its text is not in the page until it is opened.
  expect(html).toMatch(
    /<div class="thinking"><div class="chead thinking-head"><button type="button" class="chead-main" aria-expanded="false" title="Show thinking">/,
  );
  expect(html).not.toContain("First I should read");
  expect(html).not.toContain("thinking-body");
  expect(html).not.toContain("Thinking still being recorded");
  const order = [
    'class="thinking"',
    'title="a.ts"',
    "<strong>Final</strong>",
  ].map((mark) => html.indexOf(mark));
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(html.indexOf('class="thinking"', order[1])).toBeGreaterThan(order[1]);
  // The reply's copy takes the answer text only.
  const answerParts = turnParts(turn.steps).replies.filter(
    ({ step }) => step.role === "assistant",
  );
  expect(messageText(turn, answerParts, new AbortController().signal)).toBe(
    "**Final** answer",
  );
  // The flag is only thinking that could not be read; shown thinking needs none.
  expect(html).not.toContain("could not be read");
  expect(
    renderTurn({
      omitted: { thinking: true, media: false, other: false },
      items,
    }),
  ).toContain("Thinking that could not be read is not shown.");
  expect(
    renderToStaticMarkup(
      <LocaleProvider initial="zh">
        <ChatTurnView turn={turn} />
      </LocaleProvider>,
    ),
  ).toContain('title="展开思考内容"');
  // A thinking block after a call is not the later message that proves the
  // call's result: it may belong to the message that made the call.
  const cut = sourceOf({
    status: "failed",
    items: [user, read, think("k", "…")],
  });
  expect(toolState(cut, 1)).toBe("idle");
  // A live reply that ends in a thinking block is not streaming message text:
  // with everything listed settled, the reply itself is what is in progress.
  const settled = sourceOf({
    status: "running",
    items: [user, think("k", "Working it out")],
  });
  const waiting = renderToStaticMarkup(<ChatTurnView turn={settled} />);
  expect(waiting).toMatch(/class="msg-working" role="status">.*Working…/);
  expect(waiting).toContain('<div class="thinking">');
  // An explicit body-free event says so, without inventing readable details.
  const recording = renderToStaticMarkup(
    <ChatTurnView
      turn={{
        ...settled,
        steps: [
          settled.steps[0],
          {
            ...settled.steps[1],
            renderId: "capture:thinking:0",
            parts: 0,
            state: "streaming",
          },
        ],
      }}
    />,
  );
  expect(recording).toContain("Thinking activity observed");
  expect(recording).not.toContain('title="Show thinking"');
  expect(recording).not.toContain("msg-working");
  expect(recording).not.toContain("Working it out");
});
it("a turn names its speakers, start time and the context fixed at admission", () => {
  const turn = sourceOf({
    items: [
      chatItem("user", "user", { text: "Analyze" }),
      chatItem("a", "assistant", { text: "Done" }),
    ],
  });
  const at = Date.UTC(2026, 0, 2, 3, 4);
  const html = renderToStaticMarkup(
    <ChatTurnView
      turn={{
        ...turn,
        header: {
          ...turn.header,
          at,
          execution: {
            cwd: "/project/sub",
            checkoutRoot: "/project",
            version: {
              epoch: "epoch",
              accessGeneration: 1,
              configRev: 1,
              catalogId: "catalog",
            },
            model: {
              sourceSelectionId: "source",
              provider: "fabricated",
              model: "selected",
              api: "openai-completions",
              thinking: "off",
            },
          },
        },
      }}
    />,
  );
  expect(html).toContain('<article class="msg msg-user">');
  expect(html).toContain(`dateTime="${new Date(at).toISOString()}"`);
  // The model is the admitted one; its folder stays behind the disclosure.
  expect(html).toMatch(
    /class="msg-model" aria-expanded="false" title="Context fixed at admission:">fabricated\/selected</,
  );
  expect(html).not.toContain("/project/sub");
  // A record without a snapshot invents neither a model nor a time.
  const bare = renderToStaticMarkup(<ChatTurnView turn={turn} />);
  expect(bare).not.toContain("msg-model");
  expect(bare).not.toContain("<time");
});
it("each message carries an action bar: copy on both, a branch point only where the turn offers one", async () => {
  const items = [
    chatItem("user", "user", { text: "Analyze" }),
    chatItem("t1", "tool", { name: "ls", args: '{"path":"."}' }),
    chatItem("m1", "assistant", { text: "Looking." }),
    chatItem("bad", "assistant", { text: "half an answer", error: true }),
    chatItem("m2", "assistant", { text: "**Final** answer" }),
  ];
  const turn = sourceOf({ items });
  const plain = renderToStaticMarkup(<ChatTurnView turn={turn} />);
  expect(
    plain.match(
      /class="msg-actions" role="group" aria-label="Message actions"/g,
    ),
  ).toHaveLength(2);
  expect(plain.match(/aria-label="Copy message"/g)).toHaveLength(2);
  // The bubble's own text is copied by its bar, not by a second button in it;
  // each reply text keeps its own.
  expect(plain.match(/class="msg-text-copy"/g)).toHaveLength(3);
  expect(plain).not.toContain("Continue from here");
  expect(plain).not.toContain("Edit and resend");
  expect(plain).not.toContain("msg-versions");
  // Offered: "continue" means after this turn, so it is one named action on
  // the turn's last message, the reply. Rendering it chooses nothing.
  const chosen: string[] = [];
  const settled = { ...turn, header: { ...turn.header, entry: "entry-9" } };
  const offered = renderToStaticMarkup(
    <ChatTurnView turn={settled} onContinue={(id) => chosen.push(id)} />,
  );
  expect(offered.match(/aria-label="Continue from here"/g)).toHaveLength(1);
  expect(offered).toMatch(
    /<article class="msg msg-assistant">.*class="msg-action labelled"[^>]*aria-label="Continue from here"/,
  );
  expect(offered).not.toMatch(
    /<article class="msg msg-user">.*Continue from here.*<article class="msg msg-assistant">/,
  );
  expect(offered).toContain(
    'title="Send the next message from the end of this turn. It starts a new path there; later turns stay on their own path and nothing is deleted."',
  );
  expect(chosen).toEqual([]);
  // A turn that Pi has not ended (no entry) offers no place to continue from.
  expect(
    renderToStaticMarkup(<ChatTurnView turn={turn} onContinue={() => {}} />),
  ).not.toContain("Continue from here");
  // Without a user message the reply's bar still offers it.
  const replyOnly = sourceOf({ items: items.slice(2) });
  const headless = renderToStaticMarkup(
    <ChatTurnView
      turn={{ ...replyOnly, header: { ...replyOnly.header, entry: "e" } }}
      onContinue={() => {}}
    />,
  );
  expect(headless).not.toContain("msg-user");
  expect(headless.match(/aria-label="Continue from here"/g)).toHaveLength(1);
  // Without a reply the user's message is the turn's last and carries it.
  const unanswered = sourceOf({ items: items.slice(0, 1) });
  const alone = renderToStaticMarkup(
    <ChatTurnView
      turn={{ ...unanswered, header: { ...unanswered.header, entry: "e" } }}
      onContinue={() => {}}
    />,
  );
  expect(alone).not.toContain("msg-assistant");
  expect(alone.match(/aria-label="Continue from here"/g)).toHaveLength(1);
  // Edit and resend sits on the user's message, before its copy action.
  const editable = renderToStaticMarkup(
    <ChatTurnView turn={settled} onEdit={(id) => chosen.push(id)} />,
  );
  expect(editable).toMatch(
    /<article class="msg msg-user">.*aria-label="Message actions"><button type="button" class="msg-action" title="Put this message back in the composer\. Sending it starts a new path beside this one; nothing is deleted\." aria-label="Edit and resend">.*aria-label="Copy message".*<\/article><article class="msg msg-assistant">/,
  );
  expect(editable.match(/aria-label="Edit and resend"/g)).toHaveLength(1);
  expect(chosen).toEqual([]);
  // A reply still being written has no bar; its message keeps one.
  const live = renderTurn({ status: "running", items });
  expect(live.match(/class="msg-actions"/g)).toHaveLength(1);
  // Only tool cards: nothing of the reply to copy.
  expect(
    renderTurn({ items: items.slice(0, 2) }).match(/class="msg-actions"/g),
  ).toHaveLength(1);

  // A whole-reply copy is the answer's text in recorded order: no tool card and
  // no failed attempt.
  const signal = new AbortController().signal;
  const { user, replies } = turnParts(turn.steps);
  const answer = replies.filter(
    ({ step }) => step.role === "assistant" && !step.error,
  );
  expect(messageText(turn, user, signal)).toBe("Analyze");
  expect(messageText(turn, answer, signal)).toBe(
    "Looking.\n\n**Final** answer",
  );
  // A clipped part that can no longer change is read whole; one still being
  // written has only its listed preview.
  const reads: number[] = [];
  const clipped = {
    ...turn,
    steps: turn.steps.map((step) =>
      step.id === "m2" ? { ...step, clipped: true, parts: 2 } : step,
    ),
    detail: async (step: number, parts: number) => {
      reads.push(step, parts);
      return { text: "the whole final answer", args: "" };
    },
  };
  const parts = turnParts(clipped.steps).replies.filter(
    ({ step }) => step.role === "assistant" && !step.error,
  );
  await expect(messageText(clipped, parts, signal)).resolves.toBe(
    "Looking.\n\nthe whole final answer",
  );
  expect(reads).toEqual([4, 2]);
  const writing = { ...clipped, header: { ...clipped.header, stable: 4 } };
  expect(messageText(writing, parts, signal)).toBe(
    "Looking.\n\n**Final** answer",
  );
  expect(reads).toEqual([4, 2]);
});

it("a forked message says which version is shown and steps between them; a turn outside the new context says so", () => {
  const items = [
    chatItem("user", "user", { text: "Second attempt" }),
    chatItem("a", "assistant", { text: "Answer" }),
  ];
  const turn = sourceOf({ items });
  const steps: [string, number][] = [];
  const paged = (version: number) =>
    renderToStaticMarkup(
      <ChatTurnView
        turn={turn}
        version={version}
        versions={3}
        onVersion={(id, step) => steps.push([id, step])}
      />,
    );
  const middle = paged(2);
  // Position and count are words for assistive technology and digits on screen.
  expect(middle).toMatch(
    /class="msg-versions" role="group" aria-label="Version 2 of 3">/,
  );
  expect(middle).toContain(
    '<span class="msg-version-count" aria-hidden="true">2/3</span>',
  );
  expect(middle).not.toMatch(/class="msg-version-step"[^>]*disabled/);
  // The ends cannot step past themselves.
  expect(paged(1)).toMatch(
    /aria-label="Previous version" title="Previous version" disabled=""/,
  );
  expect(paged(3)).toMatch(
    /aria-label="Next version" title="Next version" disabled=""/,
  );
  expect(steps).toEqual([]);
  // One version is no pager, whatever position is passed.
  expect(
    renderToStaticMarkup(<ChatTurnView turn={turn} version={1} versions={1} />),
  ).not.toContain("msg-versions");
  // A turn the message being written will not hold says so in its name and
  // class; its content stays.
  const off = renderToStaticMarkup(<ChatTurnView turn={turn} off />);
  expect(off).toMatch(
    /^<section class="chat-turn off-branch" aria-label="Conversation turn, not in the new message&#x27;s context">/,
  );
  expect(off).toContain("Second attempt");
  expect(renderTurn({ items })).toMatch(
    /^<section class="chat-turn" aria-label="Conversation turn">/,
  );
});

it("folder setup uses the conversation shell, keeps input editable and cannot send or start work", () => {
  const open = vi.fn();
  const html = renderToStaticMarkup(
    <FolderSetup ready onChooseFolder={open} onRefresh={open} />,
  );
  expect(html).toContain('class="panel panel-left lp-panel"');
  expect(html).not.toContain("Ambient light");
  expect(html).not.toContain("<canvas");
  // First-use guidance and New conversation open the same folder picker.
  expect(html).toMatch(
    /class="primary welcome-action"[^>]*>.*Choose a folder…/,
  );
  expect(html).toContain("New conversation");
  expect(html).toContain("Conversation history");
  expect(html).toContain(
    "Choose a working folder to see its conversation history.",
  );
  expect(html).not.toContain("No conversations yet.");
  expect(html).toContain("chat-welcome");
  expect(html).not.toContain("What would you like to work on?");
  expect(html).not.toContain("more-menu-build");
  expect(html).toContain('class="panel files-panel"');
  expect(html).toMatch(/<textarea aria-label="Message"/);
  expect(html).not.toMatch(/<textarea[^>]*disabled/);
  expect(html).toMatch(/<button[^>]*class="primary"[^>]*disabled=""/);
  expect(html).toMatch(
    /class="statusbar-right".*aria-label="Switch working folder"/,
  );
  for (const label of [
    "Workbench projects",
    "Your workbench, your projects",
    "Recent folders",
    "Create task",
    "No active runs",
  ])
    expect(html).not.toContain(label);
  expect(open).not.toHaveBeenCalled();
  const chinese = renderToStaticMarkup(
    <LocaleProvider initial="zh">
      <FolderSetup ready onChooseFolder={open} onRefresh={open} />
    </LocaleProvider>,
  );
  expect(chinese).not.toContain("环境光");
  expect(chinese).toContain("选择目录…");
  expect(chinese).toContain("选择工作文件夹即可开始，也可以先在下方写草稿");
  expect(chinese).toContain("发送前请选择文件夹");
  // The welcome and the composer no longer point in different directions.
  expect(chinese).not.toContain("右下角");
  expect(chinese).not.toContain("从左侧");
  expect(chinese).not.toContain("你的工作台，你的项目");
});

it("the shared empty conversation has no central task creation shortcut", () => {
  const html = renderToStaticMarkup(<ChatWelcome hint="Type below." />);
  expect(html).toContain("chat-welcome");
  expect(html).not.toContain("<h2");
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
  expect(picker).toContain('aria-label="Recent folders"');
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

it("restoration and missing-folder guidance stay inside the conversation, without a project list or fallback directory", () => {
  const open = vi.fn();
  const checking = renderToStaticMarkup(
    <FolderSetup
      ready
      pending
      restoring="/work/alpha"
      onChooseFolder={open}
      onRefresh={open}
    />,
  );
  expect(checking).not.toContain("Returning to your last folder /work/alpha…");
  expect(checking).not.toContain("project-item");
  expect(checking).not.toContain("Recent folders");
  const unavailable = renderToStaticMarkup(
    <LocaleProvider initial="zh">
      <FolderSetup ready missing onChooseFolder={open} onRefresh={open} />
    </LocaleProvider>,
  );
  expect(unavailable).toContain("此文件夹不可用，请选择其他文件夹");
  expect(unavailable).toContain("没有移动或重建任何目录");
  expect(unavailable).toContain("历史会话");
  expect(unavailable).not.toContain("工作台");
  expect(unavailable).not.toContain("banner-notice");
  const loading = renderToStaticMarkup(
    <FolderSetup ready={false} onChooseFolder={open} onRefresh={open} />,
  );
  expect(loading).toMatch(/class="primary welcome-action"[^>]*disabled=""/);
  expect(loading).toMatch(/class="status-cwd"[^>]*disabled=""/);
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
  await expect(
    projectReadable(key("a"), new AbortController().signal),
  ).rejects.toThrow("invalid");
  reply = new Error("network");
  await expect(
    projectReadable(key("a"), new AbortController().signal),
  ).rejects.toThrow("network");
  const aborted = new AbortController();
  aborted.abort();
  reply = { kind: "ok", value: { kind: "conversations", entries: [] } };
  await expect(projectReadable(key("a"), aborted.signal)).rejects.toBe(
    aborted.signal.reason,
  );
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
  expect(failedFirstRead).toEqual({
    value: undefined,
    association: "unknown",
    error: "offline",
  });
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
    value: {
      ...running,
      status: "unavailable",
      epoch: null,
      workspaceId: null,
    },
    association: "associated",
  });
  expect(unavailable.association).toBe("unknown");
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
  const restored = projectObservationResult(lost.value, {
    value: running,
    association: "associated",
  });
  expect(projectReadiness(restored.value, restored.error)).toBe("running");
});

async function projectObservationFixture() {
  // Controlled hook callbacks, not a DOM or browser lifecycle test.
  const React = await vi.importActual<typeof import("react")>("react");
  vi.useFakeTimers();
  const cells: unknown[] = [];
  let cursor = 0;
  let deps: readonly unknown[] | undefined;
  let pendingEffect: import("react").EffectCallback | undefined;
  let cleanup: (() => void) | undefined;
  const unmount = () => {
    cleanup?.();
    cleanup = undefined;
  };
  onTestFinished(() => {
    unmount();
    vi.doUnmock("react");
    vi.resetModules();
    vi.useRealTimers();
  });
  const updates = vi.fn();
  vi.doMock("react", () => ({
    ...React,
    useState: ((initial: unknown) => {
      const at = cursor++;
      if (!Object.hasOwn(cells, at)) cells[at] = initial;
      return [
        cells[at],
        (update: unknown) => {
          updates();
          cells[at] = typeof update === "function" ? update(cells[at]) : update;
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
    signal?: AbortSignal | null;
    resolve(response: Response): void;
    reject(error: Error): void;
  }[] = [];
  const fetcher = vi.fn<typeof fetch>(
    (_url, init) =>
      new Promise((resolve, reject) => {
        requests.push({ resolve, reject, signal: init?.signal });
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const access = new ObservationAccess();
  const render = (selectedEpoch: string | null = null, id = key("a")) => {
    cursor = 0;
    return useProjectObservation(id, selectedEpoch, access);
  };
  const flushEffect = () => {
    if (!pendingEffect) return;
    cleanup?.();
    const effect = pendingEffect;
    pendingEffect = undefined;
    const result = effect();
    cleanup = typeof result === "function" ? result : undefined;
  };
  return { access, render, flushEffect, unmount, requests, fetcher, updates };
}

const projectReply = (value: unknown, association?: string) =>
  Response.json(value, {
    headers:
      association === undefined
        ? {}
        : { [PROJECT_ASSOCIATION_HEADER]: association },
  });

it.each(["cold", "same-epoch", "replacement"])(
  "%s: confirmed preparation is current before its GET; older reads cannot undo it",
  async (scenario) => {
    const { render, flushEffect, requests, fetcher } =
      await projectObservationFixture();
    const epoch = crypto.randomUUID();
    const before =
      scenario === "cold"
        ? null
        : scenario === "same-epoch"
          ? epoch
          : crypto.randomUUID();
    const initial = render(before);
    flushEffect();
    expect(requests).toHaveLength(1);
    initial.prepared(epoch);
    // Resolve the old GET before effect cleanup: synchronous invalidation,
    // not abort timing, must prevent this result overwriting confirmation.
    requests[0].resolve(
      projectReply(
        {
          kind: "project-observation",
          status: scenario === "same-epoch" ? "running" : "stopped",
          epoch: before,
          workspaceId: null,
        },
        "unassociated",
      ),
    );
    await vi.advanceTimersByTimeAsync(0);
    const confirmed = render(epoch);
    expect(confirmed.readiness).toBe("running");
    expect(confirmed.association).toBe("associated");
    expect(confirmed.value?.epoch).toBe(epoch);
    expect(confirmed.error).toBeUndefined();
    flushEffect();
    expect(requests).toHaveLength(2);
    requests[1].reject(new Error("offline"));
    await vi.advanceTimersByTimeAsync(0);
    const stale = render(epoch);
    expect(stale.readiness).toBe("stale");
    expect(stale.association).toBe("unknown");
    expect(stale.value?.epoch).toBe(epoch);
    expect(stale.error).toBe("offline");
    stale.refresh();
    stale.prepared(epoch);
    expect(render(epoch)).toMatchObject({
      readiness: "running",
      association: "associated",
    });
    expect(
      fetcher.mock.calls.every(
        ([, init]) => !init?.method || init.method === "GET",
      ),
    ).toBe(true);
  },
);

const runningObservation = () => ({
  kind: "project-observation",
  status: "running",
  epoch: crypto.randomUUID(),
  workspaceId: crypto.randomUUID(),
});

it.each(["missing header", "invalid header", "invalid body"])(
  "%s: a running observation and its association must come from the same validated GET",
  async (scenario) => {
    const { render, flushEffect, requests } = await projectObservationFixture();
    render();
    flushEffect();
    const first = runningObservation();
    requests[0].resolve(projectReply(first, "associated"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(render().association).toBe("associated");
    const next = runningObservation();
    requests[1].resolve(
      scenario === "missing header"
        ? projectReply(next)
        : scenario === "invalid header"
          ? projectReply(next, "invalid")
          : projectReply({ ...next, extra: true }, "associated"),
    );
    await vi.advanceTimersByTimeAsync(0);
    const observed = render();
    expect(observed.association).toBe("unknown");
    if (scenario === "missing header") {
      expect(observed.value).toEqual(next);
      expect(observed.readiness).toBe("running");
      expect(observed.error).toBeUndefined();
    } else {
      expect(observed.value).toEqual(first);
      expect(observed.readiness).toBe("stale");
      expect(observed.error).toBe("invalid");
    }
  },
);

it.each(["headers", "body"])(
  "a project GET stalled at %s retires at one total deadline; polling recovers before its late reply",
  async (stage) => {
    const { render, flushEffect, requests, fetcher } =
      await projectObservationFixture();
    render();
    flushEffect();
    const first = runningObservation();
    requests[0].resolve(projectReply(first, "unassociated"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(render()).toMatchObject({
      readiness: "running",
      association: "unassociated",
    });
    expect(requests).toHaveLength(2);

    // Approach the deadline before returning any headers. The partial body
    // deliberately ignores abort, so neither phase can rely on a rejection.
    await vi.advanceTimersByTimeAsync(9000);
    let late = () => requests[1].resolve(projectReply(first, "associated"));
    if (stage === "body") {
      const bytes = new TextEncoder().encode(JSON.stringify(first));
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.subarray(0, -1));
          late = () => {
            controller.enqueue(bytes.subarray(-1));
            controller.close();
          };
        },
      });
      requests[1].resolve(
        new Response(body, {
          headers: { [PROJECT_ASSOCIATION_HEADER]: "associated" },
        }),
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(body.locked).toBe(true);
      expect(render().association).toBe("unassociated"); // Headers alone cannot admit a viewer.
    }
    await vi.advanceTimersByTimeAsync(999);
    expect(requests[1].signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(requests[1].signal?.aborted).toBe(true);
    expect(render()).toMatchObject({
      readiness: "stale",
      association: "unknown",
      value: first,
      error: "timeout",
    });
    expect(requests).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(5000);
    const recovered = runningObservation();
    expect(requests).toHaveLength(3);
    requests[2].resolve(projectReply(recovered, "unassociated"));
    await vi.advanceTimersByTimeAsync(0);
    const current = render();
    expect(current).toMatchObject({
      readiness: "running",
      association: "unassociated",
      value: recovered,
    });
    expect(current.error).toBeUndefined();
    late();
    await vi.advanceTimersByTimeAsync(0);
    expect(render()).toMatchObject({
      association: "unassociated",
      value: recovered,
    });
    expect(vi.getTimerCount()).toBe(1); // One next poll, no retired deadline or second chain.
    expect(
      fetcher.mock.calls.every(
        ([url, init]) =>
          url === `/workbench/v1/projects/${key("a")}` &&
          (init?.method ?? "GET") === "GET",
      ),
    ).toBe(true);
  },
);

it.each(["project", "epoch", "refresh"])(
  "%s change and unmount retire the project read, without publishing a failure or scheduling another retry",
  async (change) => {
    const { render, flushEffect, unmount, requests, updates } =
      await projectObservationFixture();
    const first = runningObservation();
    render(first.epoch);
    flushEffect();
    requests[0].resolve(projectReply(first, "associated"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(requests).toHaveLength(2);
    if (change === "refresh") render(first.epoch).refresh();
    const project = key(change === "project" ? "b" : "a");
    const epoch = change === "epoch" ? crypto.randomUUID() : first.epoch;
    const pending = render(epoch, project);
    expect(pending.readiness).toBe(change === "project" ? "unknown" : "stale");
    expect(pending.association).toBe("unknown");
    if (change === "project") expect(pending.value).toBeUndefined();
    flushEffect();
    expect(requests[1].signal?.aborted).toBe(true);
    expect(render(epoch, project).error).toBeUndefined();
    expect(requests).toHaveLength(3);
    const next = { ...runningObservation(), epoch };
    requests[2].resolve(Response.json(next));
    await vi.advanceTimersByTimeAsync(0);
    requests[1].reject(new Error("retired"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(render(epoch, project)).toMatchObject({
      readiness: "running",
      value: next,
    });
    expect(requests).toHaveLength(4);
    const count = updates.mock.calls.length;
    unmount();
    expect(requests[3].signal?.aborted).toBe(true);
    requests[3].resolve(Response.json(first));
    await vi.advanceTimersByTimeAsync(20000);
    expect(updates).toHaveBeenCalledTimes(count);
    expect(vi.getTimerCount()).toBe(0);
    expect(requests).toHaveLength(4);
  },
);

it.each(["unauthenticated", "forbidden"])(
  "%s project read keeps its diagnosis and stops automatic retries",
  async (code) => {
    const { render, flushEffect, requests } = await projectObservationFixture();
    render();
    flushEffect();
    requests[0].resolve(
      Response.json(
        { kind: "error", error: { code } },
        { status: code === "unauthenticated" ? 401 : 403 },
      ),
    );
    await vi.advanceTimersByTimeAsync(20000);
    const revoked = render();
    expect(revoked).toMatchObject({
      error: code,
      readiness: "unknown",
      association: "unknown",
    });
    expect(requests).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    revoked.refresh();
    const epoch = crypto.randomUUID();
    expect(() => revoked.prepared(epoch)).toThrow(code);
    expect(render(epoch).error).toBe(code);
    flushEffect();
    await vi.advanceTimersByTimeAsync(30000);
    expect(requests).toHaveLength(1);
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
    expect(html).not.toContain("chat-welcome");
    expect(html).not.toContain("New conversation");
    if (pending) expect(html).toContain("original-command");
    expect(send).not.toHaveBeenCalled();
  },
);

it("folder setup keeps a text draft and model preselection, never a Send intent", () => {
  const previewModels = vi.fn(),
    onChooseFolder = vi.fn(),
    onDraftChange = vi.fn();
  const html = renderToStaticMarkup(
    <FolderSetup
      ready
      previewModels={previewModels}
      onChooseFolder={onChooseFolder}
      onRefresh={() => {}}
      onDraftChange={onDraftChange}
      draft={{
        text: "An unsent first message",
        model: {
          provider: "fixture",
          model: "preselected",
          api: "openai-completions",
          thinking: "high",
        },
      }}
    />,
  );
  expect(html).toContain('aria-label="Model: preselected · High"');
  expect(html).toMatch(/<textarea[^>]*>An unsent first message<\/textarea>/);
  expect(html).not.toContain("<form");
  expect(html).toContain("Choose a folder before sending.");
  expect(html).toMatch(/<button[^>]*class="primary"[^>]*disabled=""/);
  expect(previewModels).not.toHaveBeenCalled();
  expect(onChooseFolder).not.toHaveBeenCalled();
  expect(onDraftChange).not.toHaveBeenCalled();
});

it("presentation keys follow source identities, not read coordinates, equal body text or execution state", () => {
  const text = (id: string) =>
    chatItem(id, "assistant", {
      text: "legitimate repeat",
      renderId: `capture:${id}:0`,
      version: "v1",
      state: "streaming",
    });
  const first = text("first"),
    last = text("last");
  const prior = sourceOf({ status: "running", items: [first, last] });
  const inserted = sourceOf({
    status: "running",
    items: [
      first,
      chatItem("empty", "assistant"),
      chatItem("thinking", "thinking", {
        renderId: "capture:middle:0",
        state: "streaming",
      }),
      chatItem("tool", "tool", {
        renderId: "capture:middle:1",
        state: "running",
      }),
      { ...last, id: "durable:last", state: "completed" },
    ],
  });
  const before = turnParts(prior.steps).replies;
  const after = turnParts(inserted.steps).replies;
  expect(after.map((p) => p.key)).toEqual([
    "capture:first:0",
    "capture:middle:0",
    "capture:middle:1",
    "capture:last:0",
  ]);
  expect(after.at(-1)?.index).not.toBe(before.at(-1)?.index);
  expect(after.at(-1)?.key).toBe(before.at(-1)?.key);
  expect(after.filter((p) => p.step.text === "legitimate repeat")).toHaveLength(
    2,
  );
  const legacy = sourceOf({
    items: [chatItem("old-entry", "assistant", { text: "legitimate repeat" })],
  });
  expect(turnParts(legacy.steps).replies[0].key).toBe("legacy:old-entry");
});

it.each(["en", "zh"] as const)(
  "thinking activity has no fake expandable detail and hands off folded (%s)",
  (locale) => {
    const source = sourceOf({
      status: "running",
      items: [
        chatItem("t", "thinking", {
          renderId: "capture:thinking:0",
          state: "streaming",
        }),
      ],
    });
    source.steps = source.steps.map((step) => ({ ...step, parts: 0 }));
    const activity = renderToStaticMarkup(
      <LocaleProvider initial={locale}>
        <ChatTurnView turn={source} />
      </LocaleProvider>,
    );
    expect(activity).toContain(
      locale === "en" ? "Thinking activity observed" : "已观察到思考活动",
    );
    expect(activity).toContain('class="thinking run"');
    expect(activity).not.toContain("aria-expanded");
    expect(activity).not.toContain("thinking-body");
    const ended = {
      ...source,
      header: { ...source.header, status: "canceled" as const },
      steps: source.steps.map((s) => ({ ...s, state: "canceled" as const })),
    };
    const unavailable = renderToStaticMarkup(
      <LocaleProvider initial={locale}>
        <ChatTurnView turn={ended} />
      </LocaleProvider>,
    );
    expect(unavailable).toContain(
      locale === "en" ? "Thinking content unavailable" : "思考内容不可用",
    );
    expect(unavailable).not.toContain("aria-expanded");
    expect(unavailable).not.toContain('class="thinking run"');
    expect(unavailable).toContain('class="chead-icon thinking-icon"');
    expect(unavailable).toContain('class="chead-title thinking-label"');
    const durable = {
      ...source,
      steps: source.steps.map((s) => ({
        ...s,
        parts: 1,
        state: "completed" as const,
      })),
    };
    const readable = renderToStaticMarkup(
      <LocaleProvider initial={locale}>
        <ChatTurnView turn={durable} />
      </LocaleProvider>,
    );
    expect(readable).toContain('aria-expanded="false"');
    expect(readable).not.toContain("thinking-body");
    expect(turnParts(durable.steps).replies[0].key).toBe(
      turnParts(source.steps).replies[0].key,
    );
  },
);

it("a viewer refusal aborts the selected project attempt; its late 200 and an old preparation callback cannot restore readiness", async () => {
  const { access, render, flushEffect, requests } =
    await projectObservationFixture();
  const original = render();
  flushEffect();
  const first = runningObservation();
  requests[0].resolve(projectReply(first, "associated"));
  await vi.advanceTimersByTimeAsync(5000);
  expect(render().readiness).toBe("running");
  expect(requests).toHaveLength(2);
  access.refuse("viewer", "forbidden");
  expect(requests[1].signal?.aborted).toBe(true);
  const replacement = runningObservation();
  requests[1].resolve(projectReply(replacement, "associated"));
  original.refresh();
  expect(() => original.prepared(replacement.epoch)).toThrow("forbidden");
  const after = render(replacement.epoch);
  flushEffect();
  expect(after.readiness).toBe("unknown");
  expect(after.association).toBe("unknown");
  await vi.advanceTimersByTimeAsync(60000);
  expect(requests).toHaveLength(2);
  expect(vi.getTimerCount()).toBe(0);
});
