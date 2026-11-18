/* Adapted from pi-web-ui web/src/components/Markdown.tsx (e8bab487af208bc9a1ab60a821652323f598127f).
 * Copyright (c) 2026 xing-shuyin. MIT; see licenses/pi-web-ui-MIT.txt.
 * Cadence removes plugin fences, file-path access and automatic external resources. */
import { type JSX, memo, type ReactNode, useState } from "react";
import { flushSync } from "react-dom";
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
import { useT } from "../../i18n/locale";
import "./reading.css";
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
      remarkRehypeOptions={{
        footnoteLabelProperties: {
          className: ["sr-only"],
          dataFieldChrome: "",
        },
      }}
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
            <span data-field-chrome="">[Image omitted: </span>
            {alt || <span data-field-chrome="">external/media content</span>}
            <span data-field-chrome="">]</span>
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
function MdLink({ href, children, ...props }: JSX.IntrinsicElements["a"]) {
  const target = href && safeLink(href);
  return target ? (
    <a
      data-field-chrome={
        "data-footnote-ref" in props || "data-footnote-backref" in props
          ? ""
          : undefined
      }
      href={target}
      target={target.startsWith("#") ? undefined : "_blank"}
      rel="noreferrer noopener"
      referrerPolicy="no-referrer"
    >
      {children}
    </a>
  ) : (
    <span>
      {children}
      <span data-field-chrome=""> [link unavailable]</span>
    </span>
  );
}
// Only mounted, folded disclosures register an opener. Commit the one reveal
// before the history reader measures its Range; no deferred jump can outlive
// a new query, field page, or reader.
const folded = new WeakMap<HTMLPreElement, () => void>();
export function revealCodeMatch(range: Range) {
  const pre = range.startContainer.parentElement?.closest("pre");
  const open = pre && folded.get(pre);
  if (open) flushSync(open);
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
  const language =
    children && typeof children === "object" && "props" in children
      ? String(
          (children.props as { className?: string }).className ?? "",
        ).match(/(?:^|\s)language-([^\s]+)/)?.[1]
      : undefined;
  const { locale } = useT();
  const [expanded, setExpanded] = useState(true);
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
      <div data-field-chrome="" className="code-caption">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
          {language || (locale === "zh" ? "代码" : "Code")}
        </button>
        <CopyButton text={codeText(children)} className="output-copy" />
      </div>
      <pre
        {...props}
        hidden={!expanded}
        ref={
          expanded
            ? undefined
            : (pre) => {
                if (!pre) return;
                folded.set(pre, () => setExpanded(true));
                return () => {
                  folded.delete(pre);
                };
              }
        }
      >
        {lines.map(({ nodes, key }, i) => (
          <div className="code-line" key={key}>
            {multi && (
              <span
                data-field-chrome=""
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
