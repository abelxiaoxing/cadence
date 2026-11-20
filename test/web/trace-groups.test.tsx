import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { ChatStep } from "../../src/service/contracts/workbench";
import type { TurnSource } from "../../web/src/client/conversation-reader";
import { ChatTurnView } from "../../web/src/components/workspace/ChatTurnView";
import { LocaleProvider } from "../../web/src/i18n/locale";

function step(id: string, fields: Partial<ChatStep> = {}): ChatStep {
  return {
    id,
    name: "read",
    role: "tool",
    state: "completed",
    target: id,
    text: "",
    error: false,
    clipped: false,
    parts: 1,
    ...fields,
  };
}
function source(
  steps: ChatStep[],
  status: TurnSource["header"]["status"] = "completed",
  id = "turn",
): TurnSource {
  return {
    header: {
      id,
      status,
      at: 0,
      entry: null,
      steps: steps.length,
      stable: steps.length,
      omitted: { other: false, media: false, thinking: false },
      notice: "",
    },
    steps,
    detail: async () => {
      throw new Error("not requested");
    },
  };
}
const tools = (n: number, prefix = "path") =>
  Array.from({ length: n }, (_, i) => step(`${prefix}-${i}`));
const prose = (text: string) => step(text, { role: "assistant", text });
const render = (steps: ChatStep[], status?: TurnSource["header"]["status"]) =>
  renderToStaticMarkup(
    <LocaleProvider initial="zh">
      <ChatTurnView turn={source(steps, status)} />
    </LocaleProvider>,
  );

it.each([1, 2, 3, 15])(
  "before prose: %i recorded results, no extra layer for a short run",
  (n) => {
    const html = render(tools(n), "running");
    expect(html.match(/class="trace-summary"/g) ?? []).toHaveLength(
      n >= 3 ? 1 : 0,
    );
    expect(html.match(/class="toolcall ok"/g) ?? []).toHaveLength(
      n < 3 ? n : 0,
    );
    if (n >= 3)
      expect(html).toMatch(
        new RegExp(
          `<button type="button"[^>]*aria-expanded="false"[^>]*>.*已完成 ${n} 步 · 展开过程`,
        ),
      );
  },
);

it("restores only the group containing a chosen render identity, not an old read id or ordinal", () => {
  const steps = [
    ...tools(3, "unselected"),
    prose("Separate the groups"),
    ...tools(3, "new-read-id").map((s, i) => ({
      ...s,
      renderId: `capture:${i}`,
    })),
  ];
  const html = renderToStaticMarkup(
    <ChatTurnView
      turn={source(steps)}
      expandedSteps={new Set(["capture:1"])}
    />,
  );
  expect(html.match(/class="trace-summary"/g)).toHaveLength(2);
  expect(html).not.toContain('title="unselected-');
  for (const i of [0, 1, 2]) expect(html).toContain(`title="new-read-id-${i}"`);
  expect(html).not.toContain('class="toolcall-body"');
});

it("prose starts the two-step threshold but always breaks the run; a new turn starts fresh", () => {
  const html = render([
    ...tools(2),
    prose("First paragraph"),
    ...tools(1, "single"),
    prose("Second paragraph"),
    ...tools(2, "pair"),
    prose("Third paragraph"),
    ...tools(3, "trio"),
  ]);
  const positions = [
    'title="path-0"',
    'title="path-1"',
    "First paragraph",
    'title="single-0"',
    "Second paragraph",
    "已完成 2 步 · 展开过程",
    "Third paragraph",
    "已完成 3 步 · 展开过程",
  ].map((text) => html.indexOf(text));
  expect(positions.every((p) => p >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
  expect(html).not.toMatch(/title="(?:pair|trio)-/);
  const separate = renderToStaticMarkup(
    <>
      <ChatTurnView turn={source([prose("answer"), ...tools(1)])} />
      <ChatTurnView turn={source(tools(2), "completed", "another")} />
    </>,
  );
  expect(separate).not.toContain("trace-summary");
  expect(
    render([
      prose("Answer"),
      step("first"),
      step("user", { role: "user", text: "Another question" }),
      ...tools(2),
    ]),
  ).not.toContain("trace-summary");
});

it.each(["running", "completed", "failed", "unknown"] as const)(
  "%s turn: later text, stability and parent settlement do not prove tool results",
  (status) => {
    const exceptions = [
      step("unfinished", { state: "running" }),
      step("queued", { state: "pending" }),
      step("failed", { state: "failed" }),
      step("legacy", { state: undefined }),
      step("canceled", { state: "canceled" }),
      step("unknown", { state: "unavailable" }),
      step("error", { state: "completed", error: true }),
    ];
    const html = render(
      [
        ...tools(3),
        ...exceptions.flatMap((exception, i) => [
          exception,
          step(`isolated-${i}`),
        ]),
        prose("Final text"),
      ],
      status,
    );
    expect(html.match(/class="trace-summary"/g)).toHaveLength(1);
    expect(html).toContain("已完成 3 步");
    for (const [i, exception] of exceptions.entries()) {
      expect(html).toContain(`title="${exception.id}"`);
      expect(html).toContain(`title="isolated-${i}"`);
    }
  },
);

it("only readable completed thinking counts; an inactive body-free observation travels with its neighbours without becoming a result", () => {
  const empty = step("body-free", {
    role: "thinking",
    parts: 0,
    state: "unavailable",
  });
  const readable = step("readable", { role: "thinking" });
  const qualified = render([step("one"), empty, step("two"), readable]);
  expect(qualified).toContain("已完成 3 步");
  expect(qualified).not.toContain('class="thinking"');
  const short = render([step("one"), empty, step("two")]);
  expect(short).not.toContain("trace-summary");
  expect(short).toContain("思考内容不可用");
  expect(render([empty])).not.toMatch(/aria-expanded|<button/);
  const live = render(
    [step("one"), { ...empty, state: "streaming" }, step("two"), readable],
    "running",
  );
  expect(live).toContain("已观察到思考活动");
  expect(live).not.toContain("trace-summary");
  const unknown = render([
    step("one"),
    { ...readable, state: undefined },
    step("two"),
  ]);
  expect(unknown).not.toContain("trace-summary");
});
