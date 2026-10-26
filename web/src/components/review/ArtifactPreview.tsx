/* Adapted from pi-web-ui FilePreview.tsx raw/Markdown/ToC/line selection/zoom family.
 * MIT (c) 2026 xing-shuyin. Only a retained field page, no host paths/media/editor/scripts. */
import { useLayoutEffect, useRef, useState } from "react";
import { useT } from "../../i18n/locale";
import {
  assignHeadingIds,
  shouldShowToc,
  type TocHeading,
} from "../../review/preview-toc";
import { textLines } from "../../rich/text-lines";
import { CopyButton } from "../rich/CopyButton";
import { Markdown } from "../rich/Markdown";
import { DiffView } from "./DiffView";
export function ArtifactPreview({ text }: { text: string }) {
  const { t } = useT();
  const [view, setView] = useState<"raw" | "markdown" | "diff">("raw"),
    [wrap, setWrap] = useState(true),
    [zoom, setZoom] = useState(1),
    [toc, setToc] = useState<TocHeading[]>([]);
  const [sel, setSel] = useState<{ start: number; end: number } | null>(null),
    anchor = useRef(1),
    markdownRef = useRef<HTMLDivElement>(null);
  const lines = text.split("\n");
  useLayoutEffect(() => {
    if (view !== "markdown") return;
    if (!text) {
      setToc([]);
      return;
    }
    const headings = Array.from(
      markdownRef.current?.querySelectorAll("h1,h2,h3,h4,h5,h6") ?? [],
    );
    const assigned = assignHeadingIds(
      headings.map((h) => ({
        level: Number(h.tagName[1]),
        label: h.textContent ?? "",
      })),
    );
    assigned.forEach((h, i) => {
      headings[i].id = `preview-${h.id}`;
    });
    setToc(assigned);
  }, [text, view]);
  return (
    <div className="fp-preview">
      <div className="fp-head toolbar">
        <label>
          {t("View")}
          <select
            value={view}
            onChange={(e) =>
              setView(
                e.target.value === "markdown"
                  ? "markdown"
                  : e.target.value === "diff"
                    ? "diff"
                    : "raw",
              )
            }
          >
            <option value="raw">{t("Raw text / lines")}</option>
            <option value="markdown">{t("Safe Markdown")}</option>
            <option value="diff">{t("Observed diff")}</option>
          </select>
        </label>
        <button type="button" onClick={() => setWrap((v) => !v)}>
          {wrap ? t("Wrap: on") : t("Wrap: off")}
        </button>
        <button
          type="button"
          onClick={() => setZoom((v) => Math.min(2, v + 0.1))}
        >
          {t("Zoom +")}
        </button>
        <button
          type="button"
          onClick={() => setZoom((v) => Math.max(0.8, v - 0.1))}
        >
          {t("Zoom −")}
        </button>
        <CopyButton
          text={sel ? lines.slice(sel.start - 1, sel.end).join("\n") : text}
        />
      </div>
      <p className="fp-notice">
        {t(
          "Captured page only, not a current filesystem read. Line numbers are page-local. Full retained paging and copy are available above.",
        )}
      </p>
      <div style={{ fontSize: `${zoom}em` }}>
        {view === "markdown" ? (
          <div className="fp-toc-layout">
            {shouldShowToc(toc) && (
              <nav className="fp-toc" aria-label={t("Page headings")}>
                {toc.map((h) => (
                  <button
                    type="button"
                    key={h.id}
                    className={`l${h.level}`}
                    onClick={() =>
                      markdownRef.current
                        ?.querySelector(`#${CSS.escape(`preview-${h.id}`)}`)
                        ?.scrollIntoView({ block: "nearest" })
                    }
                  >
                    {h.label}
                  </button>
                ))}
              </nav>
            )}
            <div className="fp-markdown-zoom" ref={markdownRef}>
              <Markdown text={text} />
            </div>
          </div>
        ) : view === "diff" ? (
          <DiffView text={text} />
        ) : (
          <div className={`fp-code ${wrap ? "" : "no-wrap"}`}>
            {textLines(text).map(({ text: line, number: n, key }) => (
              <div
                key={key}
                className={`fp-line ${sel && n >= sel.start && n <= sel.end ? "sel" : ""}`}
              >
                <button
                  type="button"
                  className="fp-num"
                  aria-label={t("Select page line {line}", { line: n })}
                  onClick={(e) => {
                    if (!e.shiftKey) anchor.current = n;
                    setSel({
                      start: Math.min(anchor.current, n),
                      end: Math.max(anchor.current, n),
                    });
                  }}
                >
                  {n}
                </button>
                <span className="fp-code-text">{line || " "}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {sel && (
        <footer className="fp-foot">
          {t("Selected page lines {start}–{end}", {
            start: sel.start,
            end: sel.end,
          })}
          <button type="button" onClick={() => setSel(null)}>
            {t("Clear selection")}
          </button>
        </footer>
      )}
    </div>
  );
}
