/* Adapted from pi-web-ui tests/unit/stream-markdown.test.ts @ e8bab487af208bc9a1ab60a821652323f598127f.
 * MIT (c) 2026 xing-shuyin. Pure tests, not browser/device evidence. */

import { renderToStaticMarkup } from "react-dom/server";
import rehypeRaw from "rehype-raw";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import { MarkdownBody } from "../../web/src/components/rich/Markdown";
import { StreamMarkdown as WorkflowStreamMarkdown } from "../../web/src/components/rich/StreamMarkdown";
import { StreamMarkdown } from "../../web/src/components/StreamMarkdown";
import {
  segmentStream,
  stepSmoothStream,
} from "../../web/src/rich/stream-markdown.ts";

describe("segmentStream", () => {
  it("空文本 → 无 frozen、无 active", () => {
    const s = segmentStream("");
    expect(s.frozen).toEqual([]);
    expect(s.active).toBe("");
    expect(s.inFence).toBe(false);
  });

  it("单个未完结段落全部留在 active", () => {
    const s = segmentStream("这是第一行\n第二行还在写");
    expect(s.frozen).toEqual([]);
    expect(s.active).toBe("这是第一行\n第二行还在写");
  });

  it("空行分隔的完整段落冻结，尾部留 active", () => {
    const text = "第一段。\n\n第二段完整了。\n\n第三段写到一半";
    const s = segmentStream(text);
    expect(s.frozen).toEqual(["第一段。\n\n", "第二段完整了。\n\n"]);
    expect(s.active).toBe("第三段写到一半");
  });

  it("frozen 段落在追加后保持不变（append-only 稳定性）", () => {
    const before = segmentStream("段落一。\n\n段落二。");
    const after = segmentStream("段落一。\n\n段落二。\n\n段落三。");
    expect(after.frozen.slice(0, before.frozen.length)).toEqual(before.frozen);
    expect(before.active).toBe("段落二。");
    expect(after.frozen).toContain(`${before.active}\n\n`);
  });

  it("未闭合代码围栏：围栏及之后内容留在 active 且 inFence=true", () => {
    const text = "看这个：\n\n```python\ndef foo():\n    return 1";
    const s = segmentStream(text);
    expect(s.frozen).toEqual(["看这个：\n\n"]);
    expect(s.active).toBe("```python\ndef foo():\n    return 1");
    expect(s.inFence).toBe(true);
  });

  it("闭合代码围栏正常冻结（含代码块整体）", () => {
    const text = "说明。\n\n```js\nconsole.log(1);\n```\n\n下一段";
    const s = segmentStream(text);
    expect(s.frozen).toEqual(["说明。\n\n", "```js\nconsole.log(1);\n```\n\n"]);
    expect(s.active).toBe("下一段");
    expect(s.inFence).toBe(false);
  });

  it("波浪线围栏同样识别；短闭合线不结束长开线", () => {
    let s = segmentStream("~~~js\nx = `~~`;\n~");
    expect(s.inFence).toBe(true);
    s = segmentStream("~~~js\nx = 1;\n~~~\n\n后文");
    expect(s.inFence).toBe(false);
    expect(s.frozen[0]).toContain("x = 1;");
  });

  it("空行 + 列表标记不切分（loose list 保持编号连续）", () => {
    const text = "1. 第一项\n\n2. 第二项\n\n3. 第三项";
    const s = segmentStream(text);
    expect(s.frozen).toEqual([]);
    expect(s.active).toBe(text);
  });

  it("无序列表同理不切分", () => {
    const text = "- a\n\n- b";
    const s = segmentStream(text);
    expect(s.frozen).toEqual([]);
    expect(s.active).toBe(text);
  });

  it("列表结束后继续普通段落可正常冻结", () => {
    const text = "1. a\n\n2. b\n\n总结：完了。\n\n新的开头";
    const s = segmentStream(text);
    // 整个 loose list 是一个 frozen 段；后续普通段各自冻结
    expect(s.frozen).toEqual(["1. a\n\n2. b\n\n", "总结：完了。\n\n"]);
    expect(s.active).toBe("新的开头");
  });

  it("围栏内出现类似 ``` 的内容不会误判为边界", () => {
    const text = '```bash\necho "```"\nmore\n```\n\n后文';
    const s = segmentStream(text);
    // 围栏内的 ``` 出现在行中间（非围栏标记位置），不影响结构
    expect(s.frozen[0]).toContain('echo "```"');
    expect(s.inFence).toBe(false);
  });

  it.each(["\n", "\r\n", "\r"])(
    "preserves real source offsets, blank separators and indentation (%j)",
    (newline) => {
      const text = [
        "",
        "  Heading 🚀",
        "",
        "",
        "    code",
        "",
        "    more code",
        "",
        "  - item",
        "",
        "    continuation",
        "",
        "last",
        "",
      ].join(newline);
      const { segments, frozen, active } = segmentStream(text);
      expect(segments.map((part) => part.start)).toEqual([
        0,
        text.indexOf("    code"),
        text.indexOf("  - item"),
        text.indexOf("last"),
      ]);
      expect(segments.map((part) => part.text).join("")).toBe(text);
      expect([...frozen, active].join("")).toBe(text);
      let offset = 0;
      for (const part of segments) {
        expect(part.start).toBe(offset);
        expect(part.text).toBe(text.slice(offset, offset + part.text.length));
        offset += part.text.length;
      }
    },
  );

  it("retains whole containers and only marks a standalone open fence for the workflow preview", () => {
    for (const text of [
      "    ```literal\n\n    still indented code",
      "> ```js\n> code\n>\n> still code",
      "- item\n\n  ```js\n  code",
      "```invalid`info\n\nnot code",
    ])
      expect(segmentStream(text).inFence).toBe(false);
    for (const closer of ["``` junk", "``", "~~~", "    ```"])
      expect(
        segmentStream(`\n\n\`\`\`js\nx\n${closer}\n\nstill code`).inFence,
      ).toBe(true);
    expect(segmentStream("```js\nx\n````\t\r\n").inFence).toBe(false);
  });
});

describe("stepSmoothStream — 自适应平滑流式步进（大段接收、逐字细腻丝滑渲染）", () => {
  it("中小积压（backlog <= 32）时每步严格推进 1 个字符（逐字打字机感）", () => {
    const target = "你好世界，这是一段测试文本，用来验证单字细腻吐出区间";
    expect(stepSmoothStream(target, 5)).toBe(6);
    expect(stepSmoothStream(target, 12)).toBe(13);
  });

  it("大段脉冲到达（如一次收到 140 字符）时拆分为细腻多步平滑推进，绝不一次性蹦出整段", () => {
    const target = "A".repeat(140);
    const next = stepSmoothStream(target, 0);
    expect(next).toBe(5); // ceil(140 / 28) = 5
    let cur = 0;
    let frames = 0;
    while (cur < target.length) {
      cur = stepSmoothStream(target, cur);
      frames++;
    }
    expect(cur).toBe(140);
    expect(frames).toBeGreaterThan(45); // 先柔顺流淌、后单字细腻收尾
  });

  it("UTF-16 代理对（Emoji）边界安全：绝不把双码元字符劈成两半", () => {
    // "Hi🚀!" 中 '🚀' 位于索引 2..3（2 是高位代理 0xD83D，3 是低位代理 0xDE80）
    const target = "Hi🚀!后续文字";
    // 从 2 推进 1 个字符原本会落在 3（刚好切在 🚀 中间），应当自动进位到 4
    expect(stepSmoothStream(target, 2)).toBe(4);
    expect(target.slice(0, stepSmoothStream(target, 2))).toBe("Hi🚀");
  });
});

// Ordinary chat deliberately does NOT use the legacy character pacer above.
// SSR proves the received snapshot is rendered immediately, not DOM continuity.

it("ordinary live snapshots render all observed characters on the first render and after handoff", () => {
  for (const text of [
    "Already visible 🚀",
    "Already visible 🚀\n\nNew observed content",
    "A".repeat(1800),
  ]) {
    for (const streaming of [true, false]) {
      const html = renderToStaticMarkup(
        <StreamMarkdown text={text} streaming={streaming} />,
      );
      for (const part of text.split("\n\n")) expect(html).toContain(part);
    }
  }
});

it("ordinary markdown keeps its prefix and open-code renderer unchanged on settlement", () => {
  const text = "Frozen paragraph\n\n```js\nconst n = 1";
  const live = renderToStaticMarkup(<StreamMarkdown text={text} streaming />);
  expect(live).toContain("<p>Frozen paragraph</p>");
  expect(live).toContain("hljs");
  expect(live).not.toContain("<code>```js");
  const ended = renderToStaticMarkup(<StreamMarkdown text={text} />);
  expect(ended).toBe(live);
  // The other caller still has its no-highlight workflow preview policy.
  expect(segmentStream(text).inFence).toBe(true);
});

it("retains document-wide Markdown references without a terminal-state renderer swap", () => {
  const text =
    "See [reference][r].\n\nAnother paragraph.\n\n[r]: https://example.com/";
  const live = renderToStaticMarkup(<StreamMarkdown text={text} streaming />);
  const done = renderToStaticMarkup(<StreamMarkdown text={text} />);
  expect(live).toContain('href="https://example.com/"');
  expect(done).toBe(live);
});

// Parse the emitted HTML with the already-declared rehype parser. Compare the
// complete element/attribute/text tree, ignoring only source locations and the
// insignificant newlines BETWEEN document roots that ReactMarkdown emits.
// Whitespace inside lists, code, math, links and footnotes remains significant.
const htmlParser = unified().use(rehypeRaw);
function semanticHtml(html: string): unknown {
  const tree = htmlParser.runSync({
    type: "root",
    children: [{ type: "raw", value: html }],
  });
  return JSON.parse(
    JSON.stringify(
      tree.children.filter(
        (node) => node.type !== "text" || node.value.trim() !== "",
      ),
      (key, value) => (key === "position" ? undefined : value),
    ),
  );
}
function ordinaryHtml(text: string, streaming: boolean): string {
  return renderToStaticMarkup(
    <StreamMarkdown text={text} streaming={streaming} />,
  ).slice('<div class="md">'.length, -"</div>".length);
}

const semanticCases = [
  {
    name: "loose list item continuation, nested list, quote and code",
    text: "Intro\n\n1. first\n\n   continuation *inside* the first item\n\n   - nested\n\n     nested continuation\n\n   > quoted\n   >\n   > continuation\n\n       literal <tag>\n\n2. second\n\nAfter",
  },
  {
    name: "blockquote container and its loose list",
    text: "Intro\n\n> first\n>\n> - item\n>\n>   continuation\n>\n> last\n\nAfter",
  },
  {
    name: "indented code across blank lines, including tab indentation",
    text: "Intro\n\n    const a = 1;\n\n    <script>literal()</script>\n\n\tlast line\n\nAfter",
  },
  {
    name: "dollar display math across blank lines",
    text: "Intro\n\n$$\na^2\n\nb^2 = c^2\n$$\n\nAfter",
  },
  {
    name: "backslash display math across blank lines",
    text: String.raw`Intro

\[
a^2

b^2 = c^2
\]

After`,
  },
  {
    name: "nested backslash and dollar math in list/quote containers",
    text: String.raw`Intro

- formula

  \[
  x

  + y
  \]

> $$
> a
>
> + b
> $$

After`,
  },
  {
    name: "document references whose definitions are inside containers",
    text: 'Intro\n\n[link][r] and ![image][r].\n\nMiddle\n\n> [r]: https://example.com/ "title"\n\nAfter',
  },
  {
    name: "multiline, escaped and duplicate reference definitions",
    text: 'Intro\n\n[one][a\\]b] and [shortcut].\n\n[a\\]b]:\n  https://example.com/first\n  "First title"\n\n[shortcut]: https://example.com/short\n\n[a\\]b]: javascript:alert(1)\n\nAfter',
  },
  {
    name: "footnotes share numbering, repeated references and one final footer",
    text: "Intro\n\nFirst[^b], then[^a].\n\nAgain[^b].\n\n[^a]: Alpha\n\n    second paragraph\n\n[^b]: Beta with [link][r]\n\n[r]: https://example.com/\n\nAfter",
  },
  {
    name: "footnotes with definitions inside containers",
    text: "Intro\n\nNote[^n].\n\n> [^n]: quoted note\n>\n>     continuation\n\nAfter",
  },
  {
    name: "long fences, short false closers, and trailing junk on false closers",
    text: "Intro\n\n````js\nconst a = 1;\n```\n\n```` not a closer\n\nstill code\n````\n\nAfter",
  },
  {
    name: "tilde fences, invalid backtick info and adjacent top-level blocks",
    text: "Intro\n\n~~~txt\nliteral\n\n~~~\n# Heading\n\n```bad`info\nnot fenced\n\nAfter",
  },
  {
    name: "GFM table, tasks, strikethrough, autolinks and setext heading",
    text: "Title\n=====\n\n| A | B |\n| - | - |\n| ~~old~~ | https://example.com |\n\n- [x] done\n\n  continuation\n\nAfter",
  },
  {
    name: "safe output for raw HTML, images, links and literal code",
    text: "Intro\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1)) ![remote](https://example.com/image)\n\n    <img src=x onerror=alert(1)>\n\n    & literal\n\n[secret][s]\n\n> [s]: https://example.com/?token=secret\n\nAfter",
  },
];

describe("semantic segmentation matches the authoritative MarkdownBody", () => {
  it.each(semanticCases)("$name", ({ text }) => {
    const whole = semanticHtml(
      renderToStaticMarkup(<MarkdownBody text={text} />),
    );
    for (const streaming of [true, false]) {
      const html = ordinaryHtml(text, streaming);
      expect(semanticHtml(html)).toEqual(whole);
      expect(html).not.toMatch(/<(?:script|iframe|img)\b/);
      expect(html).not.toMatch(/href="(?:javascript:|[^"\s]*\?token=)/);
    }
    // The workflow renderer consumes these same strings. Its existing pacer
    // and plain-fence preview are not replaced by the ordinary-chat renderer.
    const { frozen, active } = segmentStream(text);
    const segmented = [...frozen, active]
      .map((part) => renderToStaticMarkup(<MarkdownBody text={part} />))
      .join("");
    expect(semanticHtml(segmented)).toEqual(whole);
  });

  it("revises only syntax affected by arriving math closers or definitions, never by terminal status", () => {
    const snapshots = [
      "Unrelated prefix\n\n\\[\na",
      "Unrelated prefix\n\n\\[\na\n\nb",
      "Unrelated prefix\n\n\\[\na\n\nb\n\\]\n\nTail",
      "Unrelated prefix\n\n[ref]\n\nTail",
      "Unrelated prefix\n\n[ref]\n\nTail\n\n> [ref]: https://example.com/",
      "Unrelated prefix\n\n```js\nconst n = 1",
    ];
    for (const text of snapshots) {
      const expected = semanticHtml(
        renderToStaticMarkup(<MarkdownBody text={text} />),
      );
      const live = ordinaryHtml(text, true);
      expect(semanticHtml(live)).toEqual(expected);
      expect(ordinaryHtml(text, false)).toBe(live);
    }
  });
});

it("the shared workflow renderer retains its existing pacer and consumes semantic segments without changing final content", () => {
  // A short active workflow snapshot still starts at zero; ordinary chat above
  // does not. A long re-observed workflow snapshot already bypasses that pacer.
  expect(renderToStaticMarkup(<WorkflowStreamMarkdown text="short" />)).toBe(
    '<div class="md"></div>',
  );
  const text = `${"Existing workflow history. ".repeat(70)}\n\n${semanticCases[0].text}`;
  const html = renderToStaticMarkup(
    <WorkflowStreamMarkdown text={text} />,
  ).slice('<div class="md">'.length, -"</div>".length);
  expect(semanticHtml(html)).toEqual(
    semanticHtml(renderToStaticMarkup(<MarkdownBody text={text} />)),
  );
});
