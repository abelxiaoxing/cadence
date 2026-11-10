// The file preview's highlighted code block and the image lightbox. Pure and
// SSR only: no browser lays these out, decodes an image or opens a dialog.
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { FilePreviewText } from "../../web/src/components/workspace/FilesPanel";
import {
  ImageLightbox,
  ZOOM_MAX,
  ZOOM_MIN,
  zoomStep,
} from "../../web/src/components/workspace/ImageLightbox";
import { LocaleProvider } from "../../web/src/i18n/locale";
import { fencedCode } from "../../web/src/rich/code-fence";

it("fences a text with more backticks than it contains, and only names a real language", () => {
  expect(fencedCode("a = 1\n", "python")).toBe("```python\na = 1\n```");
  // No final line break in the text: the closing fence still gets its own line.
  expect(fencedCode("plain")).toBe("```\nplain\n```");
  expect(fencedCode("x", "plaintext")).toBe("```\nx\n```");
  const markdown = "see:\n```sh\nls\n```\nand ````four````\n";
  expect(fencedCode(markdown, "markdown")).toBe(
    `\`\`\`\`\`markdown\n${markdown}\`\`\`\`\``,
  );
  // A language is a plain word; anything else could end the info string.
  expect(fencedCode("x", "py`thon\nevil")).toBe("```\nx\n```");
  expect(fencedCode("")).toBe("```\n\n```");
});

it("previews a file through the bundled highlighter, line by line and verbatim", () => {
  const source = [
    "import os",
    "",
    "def main():",
    '    return "```not a fence```"  # <b>kept as text</b>',
    "",
  ].join("\n");
  const html = renderToStaticMarkup(
    <FilePreviewText path="scripts/train.py" text={source} />,
  );
  expect(html).toContain('<div class="codeblock">');
  expect(html.match(/class="code-line"/g)).toHaveLength(4);
  expect(html).toContain('<span class="hljs-keyword">import</span>');
  expect(html).toContain('<span class="hljs-keyword">def</span>');
  // Backticks and markup inside the file are code, not Markdown or HTML.
  expect(html).toContain("```not a fence```");
  expect(html).toContain("&lt;b&gt;kept as text&lt;/b&gt;");
  expect(html).not.toContain("<b>");
  // An unknown extension is shown as it is, without invented highlighting.
  const plain = renderToStaticMarkup(
    <FilePreviewText
      path="notes.unknown"
      text={"# not a heading\n- [x] row"}
    />,
  );
  expect(plain.match(/class="code-line"/g)).toHaveLength(2);
  expect(plain).not.toContain("hljs-");
  expect(plain).not.toContain("<h1");
  expect(plain).toContain("# not a heading");
});

it("steps the lightbox zoom within its bounds", () => {
  expect(zoomStep(1, 1.25)).toBe(1.25);
  expect(zoomStep(1, 1 / 1.25)).toBe(0.8);
  expect(zoomStep(ZOOM_MAX, 1.25)).toBe(ZOOM_MAX);
  expect(zoomStep(ZOOM_MIN, 0.5)).toBe(ZOOM_MIN);
});

it.each([
  ["en", "Zoom in", "Fit to window", "Close"],
  ["zh", "放大", "适应窗口", "关闭"],
] as const)(
  "%s: the lightbox is a labelled dialog whose every control has a name",
  (locale, zoomIn, fit, close) => {
    const html = renderToStaticMarkup(
      <LocaleProvider initial={locale}>
        <ImageLightbox
          blob={new Blob(["png"])}
          label="Attached image"
          onClose={() => {}}
        />
      </LocaleProvider>,
    );
    expect(html).toMatch(
      /^<dialog class="img-lightbox" aria-label="Attached image">/,
    );
    for (const name of [zoomIn, fit, close])
      expect(html).toContain(`aria-label="${name}"`);
    // Nothing is loaded on the server: a placeholder, no image, no size claim.
    expect(html).toContain('data-pending="true"');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("img-lightbox-dims");
    expect(html.match(/<button/g)).toHaveLength(5);
  },
);
