// An edit or write call's recorded arguments as a change, and its card. Pure
// and SSR only: nothing here reads a file.
// Adapted from pi-web-ui tests/unit/file-diff.test.ts @ b627452c;
// MIT (c) 2026 xing-shuyin.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DIFF_LINE_LIMIT,
  FileChangeCard,
} from "../../web/src/components/workspace/FileChangeCard";
import {
  buildHunksFromEdits,
  computeWordDiff,
  detectLanguage,
  parseFileMutationArgs,
} from "../../web/src/rich/file-diff";

describe("file-diff parser and model", () => {
  it("names a bundled highlight language for common file extensions", () => {
    expect(detectLanguage("src/app.tsx")).toBe("typescript");
    expect(detectLanguage("src/server.ts")).toBe("typescript");
    expect(detectLanguage("main.py")).toBe("python");
    expect(detectLanguage("package.json")).toBe("json");
    expect(detectLanguage("C:\\work\\page.HTML")).toBe("xml");
    expect(detectLanguage("build/Makefile")).toBe("makefile");
    expect(detectLanguage("unknown")).toBe("plaintext");
    expect(detectLanguage("dir.py/README")).toBe("plaintext");
    // File names are recorded data: an inherited key is not a language.
    expect(detectLanguage("a.constructor")).toBe("plaintext");
    expect(detectLanguage()).toBe("plaintext");
  });

  it("computeWordDiff produces tokenized word-level diffs", () => {
    const res = computeWordDiff(
      "const timeout = 3000;",
      "const timeout = 6000;",
    );
    expect(res.oldTokens).toContainEqual({ type: "del", text: "3000" });
    expect(res.newTokens).toContainEqual({ type: "add", text: "6000" });
    expect(
      res.oldTokens.some((t) => t.type === "same" && t.text.includes("const")),
    ).toBe(true);
    // Lines with little in common, or too long to table, stay whole.
    expect(computeWordDiff("alpha beta", "x y z w")).toEqual({
      oldTokens: [{ type: "del", text: "alpha beta" }],
      newTokens: [{ type: "add", text: "x y z w" }],
    });
    const long = "a ".repeat(500);
    expect(computeWordDiff(long, `${long}b`).oldTokens).toHaveLength(1);
  });

  it("buildHunksFromEdits builds one hunk per replacement", () => {
    const { hunks, additions, deletions } = buildHunksFromEdits([
      { oldText: "foo = 1;\nbar = 2;", newText: "foo = 10;\nbar = 20;\n" },
      { oldText: "x", newText: "" },
    ]);
    expect(hunks).toHaveLength(2);
    expect(deletions).toBe(3);
    // A final line break ends the last line; it is not an empty added line.
    expect(additions).toBe(2);
    expect(hunks[0]).toMatchObject({ removed: 2, added: 2 });
    expect(hunks[0].lines.map((line) => line.type)).toEqual([
      "del",
      "del",
      "add",
      "add",
    ]);
    expect(hunks[1].lines).toEqual([{ type: "del", content: "x" }]);
  });

  it("reads an edit's current and older argument shapes", () => {
    const current = parseFileMutationArgs(
      "edit",
      JSON.stringify({
        path: "src/utils.ts",
        edits: [
          { oldText: "hello", newText: "world" },
          { oldText: "a\nb", newText: "c" },
        ],
      }),
    );
    expect(current).toMatchObject({
      filePath: "src/utils.ts",
      isWrite: false,
      language: "typescript",
      additions: 2,
      deletions: 3,
    });
    expect(current?.hunks).toHaveLength(2);
    // One replaced line carries its word-level tokens.
    expect(current?.hunks[0].lines[0].tokens).toEqual([
      { type: "del", text: "hello" },
    ]);
    const legacy = parseFileMutationArgs(
      "edit",
      JSON.stringify({ path: "a.py", oldText: "x = 1", newText: "x = 2" }),
    );
    expect(legacy).toMatchObject({ additions: 1, deletions: 1 });
    expect(legacy?.hunks).toHaveLength(1);
    expect(
      parseFileMutationArgs(
        "edit",
        JSON.stringify({ file_path: "b.md", oldText: "", newText: "new" }),
      ),
    ).toMatchObject({ filePath: "b.md", language: "markdown", deletions: 0 });
  });

  it("reads a write's content as additions", () => {
    const content = "line1\nline2\nline3\n";
    const data = parseFileMutationArgs(
      "write",
      JSON.stringify({ path: "README.md", content }),
    );
    expect(data).toMatchObject({
      filePath: "README.md",
      isWrite: true,
      additions: 3,
      deletions: 0,
    });
    expect(data?.hunks[0].lines).toEqual([
      { type: "add", content: "line1" },
      { type: "add", content: "line2" },
      { type: "add", content: "line3" },
    ]);
    expect(
      parseFileMutationArgs("write", '{"path":"empty.txt","content":""}'),
    ).toMatchObject({ additions: 0, hunks: [{ lines: [] }] });
  });

  it("leaves anything else to be shown as recorded", () => {
    for (const [name, args] of [
      ["bash", '{"command":"ls"}'],
      ["edit", '{"path":"a.ts","edits":['],
      ["edit", '{"path":"a.ts"}'],
      ["edit", '{"path":"a.ts","edits":[]}'],
      ["edit", "[]"],
      ["write", '{"path":"a.ts"}'],
      ["write", "null"],
      ["constructor", "{}"],
    ])
      expect(parseFileMutationArgs(name, args), `${name} ${args}`).toBeNull();
  });
});

describe("file change card", () => {
  const parsed = (name: string, args: unknown) => {
    const data = parseFileMutationArgs(name, JSON.stringify(args));
    if (!data) throw new Error("fixture arguments must parse");
    return data;
  };
  it("states the requested change in words, signs and counts", () => {
    const html = renderToStaticMarkup(
      <FileChangeCard
        data={parsed("edit", {
          path: "src/<app>.ts",
          edits: [
            { oldText: "const a = 1;", newText: "const a = 2;" },
            { oldText: "x\ny", newText: "z" },
          ],
        })}
      />,
    );
    expect(html).toContain('<div class="file-diff-card">');
    expect(html).toContain('title="src/&lt;app&gt;.ts">src/&lt;app&gt;.ts<');
    expect(html).toContain('class="file-diff-lang">typescript<');
    expect(html).toContain('<span class="add">+2</span>');
    expect(html).toContain('<span class="del">-3</span>');
    expect(html).toContain('title="2 lines added, 3 removed"');
    expect(html).toContain("Requested change");
    expect(html).toContain("It is not compared with the file");
    expect(html.match(/class="diff-hunk-header"/g)).toHaveLength(2);
    expect(html).toContain("Replacement 2 of 2: 2 lines for 1");
    // Each line names its side with a sign, not only a colour.
    expect(html.match(/class="diff-gutter-sym">-</g)).toHaveLength(3);
    expect(html.match(/class="diff-gutter-sym">\+</g)).toHaveLength(2);
    expect(html).toContain('<span class="char-del">1</span>');
    expect(html).toContain('<span class="char-add">2</span>');
  });
  it("shows a write as content, an errored call as not applied", () => {
    const write = renderToStaticMarkup(
      <FileChangeCard
        data={parsed("write", { path: "a.yaml", content: "a: 1\n" })}
      />,
    );
    expect(write).toContain("Requested content");
    expect(write).toContain('<span class="add">+1</span>');
    expect(write).not.toContain('class="del"');
    expect(write).not.toContain("diff-hunk-header");
    const failed = renderToStaticMarkup(
      <FileChangeCard
        data={parsed("edit", { path: "a.py", oldText: "x", newText: "y" })}
        failed
      />,
    );
    expect(failed).toContain('<div class="file-diff-card is-err">');
    expect(failed).toContain("Error recorded: requested, not applied");
    expect(failed).not.toContain("Requested change<");
    expect(
      renderToStaticMarkup(
        <FileChangeCard data={parsed("write", { path: "", content: "" })} />,
      ),
    ).toMatch(/No path recorded.*No lines recorded\./);
  });
  it("renders a bounded number of lines until all are asked for", () => {
    const content = Array.from(
      { length: DIFF_LINE_LIMIT + 25 },
      (_, index) => `row ${index}`,
    ).join("\n");
    const html = renderToStaticMarkup(
      <FileChangeCard data={parsed("write", { path: "big.txt", content })} />,
    );
    expect(html.match(/class="diff-line-row add"/g)).toHaveLength(
      DIFF_LINE_LIMIT,
    );
    expect(html).toContain(
      `Showing the first ${DIFF_LINE_LIMIT} of ${DIFF_LINE_LIMIT + 25} lines.`,
    );
    expect(html).toContain("Show all lines</button>");
    expect(html).toContain(`+${DIFF_LINE_LIMIT + 25}<`);
  });
});
