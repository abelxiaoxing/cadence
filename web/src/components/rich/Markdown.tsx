/* Adapted from pi-web-ui web/src/components/Markdown.tsx (e8bab487af208bc9a1ab60a821652323f598127f).
 * Copyright (c) 2026 xing-shuyin. MIT; see licenses/pi-web-ui-MIT.txt.
 * Cadence removes plugin fences, file-path access and automatic external resources. */
import { type JSX, memo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { PluggableList } from "unified";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.css";
import { splitCodeLines } from "../../rich/code-lines";
import remarkBackslashMath from "../../rich/remark-backslash-math";
import { CopyButton } from "./CopyButton";

const remarkPlugins = [remarkGfm, remarkMath, remarkBackslashMath];
const remarkPluginsHardBreaks = [
  remarkGfm,
  remarkBreaks,
  remarkMath,
  remarkBackslashMath,
];
const rehypePlugins: PluggableList = [
  [
    rehypeKatex,
    { strict: false, throwOnError: false, trust: false, maxExpand: 1000 },
  ],
  [rehypeHighlight, { detect: false, ignoreMissing: true }],
];
/** Even explicit raw HTML is sanitized before math/highlighting. No resource loading. */
export function safeLink(href: string): string | undefined {
  if (href.startsWith("#") && ![...href].some((c) => c.charCodeAt(0) <= 32))
    return href;
  try {
    const url = new URL(href);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.searchParams.has("token")
    )
      return undefined;
    return href;
  } catch {
    return undefined;
  }
}
export function MarkdownBody({
  text,
  rawHtml = false,
  hardBreaks = false,
}: {
  text: string;
  rawHtml?: boolean;
  hardBreaks?: boolean;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={hardBreaks ? remarkPluginsHardBreaks : remarkPlugins}
      rehypePlugins={
        rawHtml ? [rehypeRaw, rehypeSanitize, ...rehypePlugins] : rehypePlugins
      }
      skipHtml={!rawHtml}
      disallowedElements={[
        "iframe",
        "object",
        "embed",
        "script",
        "style",
        "video",
        "audio",
        "source",
        "form",
        "input",
      ]}
      components={{
        pre: PlainCodeBlock,
        a: MdLink,
        img: ({ alt }) => (
          <span className="omission">
            [Image omitted: {alt || "external/media content"}]
          </span>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
export const Markdown = memo(function Markdown(props: {
  text: string;
  rawHtml?: boolean;
  hardBreaks?: boolean;
}) {
  return (
    <div className="md">
      <MarkdownBody {...props} />
    </div>
  );
});
function MdLink({ href, children }: JSX.IntrinsicElements["a"]) {
  const target = href && safeLink(href);
  return target ? (
    <a
      href={target}
      target={target.startsWith("#") ? undefined : "_blank"}
      rel="noreferrer noopener"
      referrerPolicy="no-referrer"
    >
      {children}
    </a>
  ) : (
    <span>{children} [link unavailable]</span>
  );
}
function PlainCodeBlock({
  children,
  node: _node,
  ...props
}: JSX.IntrinsicElements["pre"] & { node?: unknown }) {
  // react-markdown 传进来的是 <pre><code …>…</code></pre> 里的 code 元素；
  // 按逻辑行切分的是它内部的 span/文本 children，而不是 code 元素本身
  // （否则每行会嵌套一个克隆的 <code>，且尾随空行无法被丢弃）。
  const inner =
    children && typeof children === "object" && "props" in children
      ? (children as { props?: { children?: ReactNode } }).props?.children
      : children;
  let offset = 0;
  const lines = splitCodeLines(inner).map((nodes) => {
    const key = `code-offset:${offset}`;
    offset += codeText(nodes).length + 1;
    return { key, nodes };
  });
  const multi = lines.length > 1;
  const numWidth = multi ? `${String(lines.length).length + 1}ch` : undefined;
  return (
    <div className="codeblock">
      <CopyButton text={codeText(children)} />
      <pre {...props}>
        {lines.map(({ nodes, key }, i) => (
          <div className="code-line" key={key}>
            {multi && (
              <span
                className="code-num"
                style={numWidth ? { width: numWidth } : undefined}
              >
                {i + 1}
              </span>
            )}
            <code className="code-line-body hljs">{nodes}</code>
          </div>
        ))}
      </pre>
    </div>
  );
}

function codeText(children: unknown): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(codeText).join("");
  if (children && typeof children === "object" && "props" in children) {
    const props = (children as { props?: { children?: unknown } }).props;
    return codeText(props?.children);
  }
  return "";
}
