// File manager unit & SSR tests: ContextMenu layout, 3-target file menu,
// smart rename selection, free breadcrumbs, recursive search tree, and preview.
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import {
  breadcrumbsFor,
  buildSearchTree,
  hostPath,
  renameSelectionRange,
} from "../../web/src/client/user-files";
import {
  clampMenuPosition,
  contextMenuRows,
  nextEnabledIndex,
} from "../../web/src/components/ui/ContextMenu";
import {
  buildFileMenuItems,
  type FileMenuActions,
  FilePreview,
  FilesPanel,
} from "../../web/src/components/workspace/FilesPanel";
import { LocaleProvider, translate } from "../../web/src/i18n/locale";

function noopActions(): FileMenuActions {
  return {
    onPreview: vi.fn(),
    onOpenDir: vi.fn(),
    onDownload: vi.fn(),
    onReference: vi.fn(),
    onCreate: vi.fn(),
    onUpload: vi.fn(),
    onPaste: vi.fn(),
    onRename: vi.fn(),
    onDuplicate: vi.fn(),
    onCut: vi.fn(),
    onCopy: vi.fn(),
    onCopyName: vi.fn(),
    onCopyFullPath: vi.fn(),
    onCopyRelativePath: vi.fn(),
    onDelete: vi.fn(),
    onRefresh: vi.fn(),
  };
}

it("clamps floating context menu positions and computes auto separators and keyboard navigation", () => {
  expect(clampMenuPosition(900, 700, 200, 300, 1000, 800)).toEqual({
    x: 792,
    y: 492,
  });
  expect(clampMenuPosition(-20, 0, 200, 300, 1000, 800)).toEqual({
    x: 8,
    y: 8,
  });

  const items = [
    { id: "a", label: "A", group: "open", onSelect: () => {} },
    { id: "b", label: "B", group: "open", disabled: true, onSelect: () => {} },
    { id: "c", label: "C", group: "edit", onSelect: () => {} },
    { id: "d", label: "D", group: "danger", danger: true, onSelect: () => {} },
  ];
  const rows = contextMenuRows(items);
  expect(rows.map((r) => (r.kind === "sep" ? "---" : r.item.id))).toEqual([
    "a",
    "b",
    "---",
    "c",
    "---",
    "d",
  ]);
  expect(nextEnabledIndex(items, -1, 1)).toBe(0);
  expect(nextEnabledIndex(items, 0, 1)).toBe(2); // skips disabled index 1
  expect(nextEnabledIndex(items, 0, -1)).toBe(3); // wraps backward
});

it("builds distinct grouped menus for file, folder and blank list targets, and targets subfolder on dir create", () => {
  const t = (key: Parameters<typeof translate>[1]) => translate("en", key);
  const actions = noopActions();

  const fileItems = buildFileMenuItems(
    {
      kind: "file",
      entry: { name: "index.ts", path: "src/index.ts", directory: false },
    },
    { currentPath: "src", hasClipboard: true, t, actions },
  );
  expect(fileItems.map((i) => i.id)).toEqual([
    "open",
    "download",
    "reference",
    "rename",
    "duplicate",
    "cut",
    "copy",
    "copy-name",
    "copy-path",
    "copy-rel",
    "delete",
  ]);
  expect(fileItems.find((i) => i.id === "rename")?.shortcut).toBe("F2");
  expect(fileItems.at(-1)).toMatchObject({ id: "delete", danger: true });

  const dirItems = buildFileMenuItems(
    {
      kind: "dir",
      entry: { name: "utils", path: "src/utils", directory: true },
    },
    { currentPath: "src", hasClipboard: true, t, actions },
  );
  expect(dirItems.map((i) => i.id)).toContain("new-file");
  expect(dirItems.map((i) => i.id)).toContain("new-dir");
  expect(dirItems.map((i) => i.id)).toContain("paste");
  expect(dirItems.map((i) => i.id)).not.toContain("download");
  // Right-clicking a folder creates inside that folder without leaving currentPath
  dirItems.find((i) => i.id === "new-file")?.onSelect();
  expect(actions.onCreate).toHaveBeenCalledWith("src/utils", "utils", "file");

  const listItems = buildFileMenuItems(
    { kind: "list", dir: "src", label: "src" },
    { currentPath: "src", hasClipboard: false, t, actions },
  );
  expect(listItems.map((i) => i.id)).toEqual([
    "new-file",
    "new-dir",
    "upload",
    "refresh",
  ]);

  // Protected root omits destructive and rename actions, and absolute path omits copy-rel
  const rootItems = buildFileMenuItems(
    { kind: "dir", entry: { name: "/", path: "/", directory: true } },
    { currentPath: "@root", hasClipboard: false, t, actions },
  );
  expect(rootItems.map((i) => i.id)).not.toContain("delete");
  expect(rootItems.map((i) => i.id)).not.toContain("rename");
  expect(rootItems.map((i) => i.id)).not.toContain("copy-rel");
});

it("selects file stems excluding extensions on rename, builds free breadcrumbs and recursive search trees", () => {
  expect(renameSelectionRange("FilesPanel.tsx", false)).toEqual([0, 10]);
  expect(renameSelectionRange("archive.tar.gz", false)).toEqual([0, 11]);
  expect(renameSelectionRange(".env", false)).toEqual([0, 4]);
  expect(renameSelectionRange("README", false)).toEqual([0, 6]);
  expect(renameSelectionRange("src.v2", true)).toEqual([0, 6]);

  expect(breadcrumbsFor("/home/u/app", "", "Root")).toEqual([
    { label: "app", path: "" },
  ]);
  expect(breadcrumbsFor("/home/u/app", "src/service", "Root")).toEqual([
    { label: "app", path: "" },
    { label: "src", path: "src" },
    { label: "service", path: "src/service" },
  ]);
  expect(breadcrumbsFor("/home/u/app", "/home/u", "Root")).toEqual([
    { label: "/", path: "/" },
    { label: "home", path: "/home" },
    { label: "u", path: "/home/u" },
  ]);
  expect(hostPath("/home/u/app", "/etc/hosts")).toBe("/etc/hosts");
  expect(hostPath("/home/u/app", "src/a.ts")).toBe("/home/u/app/src/a.ts");

  const tree = buildSearchTree(
    [
      {
        name: "b.ts",
        path: "src/sub/b.ts",
        relPath: "sub/b.ts",
        directory: false,
      },
      { name: "a.ts", path: "src/a.ts", relPath: "a.ts", directory: false },
    ],
    "src",
  );
  expect(tree.map((n) => n.name)).toEqual(["sub", "a.ts"]);
  expect(tree[0].children[0]).toMatchObject({
    name: "b.ts",
    path: "src/sub/b.ts",
    matched: true,
  });

  // Ancestor-scope search mixes relative wire paths (inside cwd) and absolute wire paths (outside cwd)
  const ancestorTree = buildSearchTree(
    [
      {
        name: "match.ts",
        path: "src/match.ts",
        relPath: "app/src/match.ts",
        directory: false,
      },
      {
        name: "sibling.txt",
        path: "/outer/sibling.txt",
        relPath: "sibling.txt",
        directory: false,
      },
      {
        name: "win.ini",
        path: "C:/Windows/win.ini",
        relPath: "C:/Windows/win.ini",
        directory: false,
      },
    ],
    "/outer",
  );
  expect(ancestorTree.map((n) => n.name)).toEqual(["app", "C:", "sibling.txt"]);
  expect(ancestorTree[0]).toMatchObject({
    name: "app",
    path: "/outer/app",
    directory: true,
  });
  expect(ancestorTree[0].children[0].children[0]).toMatchObject({
    name: "match.ts",
    path: "src/match.ts",
    matched: true,
  });
  expect(ancestorTree[1]).toMatchObject({
    name: "C:",
    path: "C:",
    directory: true,
  });
});

it("hides dotfiles by default in FilesPanel and renders image, binary, and editable text previews", () => {
  const html = renderToStaticMarkup(
    <LocaleProvider initial="zh">
      <FilesPanel
        cwd="/project"
        home="/home/u"
        initialListing={{
          path: "",
          absPath: "/project",
          parent: "/",
          entries: [
            { name: ".env", path: ".env", directory: false },
            { name: "README.md", path: "README.md", directory: false },
          ],
          limited: false,
        }}
        onReference={() => {}}
      />
    </LocaleProvider>,
  );
  expect(html).toContain("README.md");
  expect(html).not.toContain(".env");
  expect(html).toContain('aria-label="新建文件"');
  expect(html).toContain('aria-label="新建文件夹"');
  expect(html).toContain('aria-label="显示隐藏文件"');

  const imgHtml = renderToStaticMarkup(
    <FilePreview
      path="logo.png"
      loading={false}
      file={{
        kind: "image",
        path: "logo.png",
        absPath: "/project/logo.png",
        name: "logo.png",
        size: 2048,
        mimeType: "image/png",
      }}
      rawUrl="/workbench/v1/files/raw?cwd=%2Fproject&path=logo.png"
      onClose={() => {}}
    />,
  );
  expect(imgHtml).toContain("<img");
  expect(imgHtml).toContain("2.0 KiB");

  const binHtml = renderToStaticMarkup(
    <FilePreview
      path="app.wasm"
      loading={false}
      file={{
        kind: "binary",
        path: "app.wasm",
        absPath: "/project/app.wasm",
        name: "app.wasm",
        size: 4096,
        mimeType: "application/octet-stream",
      }}
      downloadUrl="/workbench/v1/files/raw?cwd=%2Fproject&path=app.wasm&download=1"
      onClose={() => {}}
    />,
  );
  expect(binHtml).toContain("Binary file (4.0 KiB)");
  expect(binHtml).toContain("Download");

  const editableHtml = renderToStaticMarkup(
    <FilePreview
      path="a.ts"
      loading={false}
      file={{
        kind: "text",
        path: "a.ts",
        absPath: "/project/a.ts",
        name: "a.ts",
        text: "const a = 1;",
        size: 12,
        limited: false,
        editable: true,
      }}
      pendingSwitch="b.ts"
      onSave={async () => {}}
      onClose={() => {}}
    />,
  );
  expect(editableHtml).toContain('aria-label="Edit file"');
  expect(editableHtml).toContain("Discard unsaved changes?");
});
