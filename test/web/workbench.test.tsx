import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { cadenceInput } from "../../web/src/client/use-workbench";
import { ChatTurnView } from "../../web/src/components/workspace/ChatWorkspace";

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
