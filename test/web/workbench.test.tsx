import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { cadenceInput } from "../../web/src/client/use-workbench";
import { ChatWelcome } from "../../web/src/components/workspace/ChatWelcome";
import { ChatTurnView } from "../../web/src/components/workspace/ChatWorkspace";
import { ProjectPicker } from "../../web/src/components/workspace/ProjectPicker";
import { WorkbenchHome } from "../../web/src/components/workspace/WorkbenchHome";
import { WorkingFolderButton } from "../../web/src/components/workspace/WorkingFolderButton";
import { LocaleProvider } from "../../web/src/i18n/locale";

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

it("the project-less entry is a conversation shell with navigation at bottom right, not a project landing page", () => {
  const open = vi.fn();
  const html = renderToStaticMarkup(
    <WorkbenchHome ready onOpenFolder={open} />,
  );
  expect(html).toContain('class="panel panel-left lp-panel"');
  expect(html).toContain("New conversation");
  expect(html).toContain("Conversation history");
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
  expect(picker).toContain("Open this project");
  expect(open).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
});
