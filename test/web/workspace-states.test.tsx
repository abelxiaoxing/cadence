import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { WorkbenchResult } from "../../src/service/contracts/workbench.ts";
import { ServiceClient } from "../../src/service-client.ts";
import { CadenceModeButton } from "../../web/src/components/workspace/CadenceModeButton";
import { FilesPanel } from "../../web/src/components/workspace/FilesPanel";
import { LocaleProvider } from "../../web/src/i18n/locale";
import { transport } from "./fixtures";

const files = vi.hoisted(() => ({
  value: undefined as WorkbenchResult | undefined,
  error: undefined as string | undefined,
}));
vi.mock("../../web/src/client/use-workbench", () => ({
  useWorkbench: () => ({ ...files, refresh() {} }),
}));
afterEach(() => {
  files.value = undefined;
  files.error = undefined;
});

it.each(["en", "zh"] as const)(
  "%s: mode off, armed, confirmed and unobserved are distinct without implying approval",
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
    expect(render(false, false)).toContain(
      locale === "zh" ? "Cadence 已关闭" : "Cadence off",
    );
    const armed = render(false, true);
    expect(armed).toContain('class="mode-toggle armed"');
    expect(armed).toContain(
      locale === "zh" ? "下次发送开启 Cadence" : "Cadence on next Send",
    );
    expect(armed).not.toContain('class="mode-toggle on"');
    expect(armed).not.toContain('aria-pressed="true"');
    expect(render(true, true)).toContain(
      locale === "zh" ? "Cadence 已开启" : "Cadence on",
    );
    expect(render(false, false, false)).toContain(
      locale === "zh" ? "Cadence 状态未确认" : "Cadence state unavailable",
    );
    expect(click).not.toHaveBeenCalled();
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
  expect(absent).not.toMatch(/>\/<|No visible files/);
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
