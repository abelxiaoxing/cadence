/* Adapted from pi-web-ui SearchBar.tsx; MIT (c) 2026 xing-shuyin. */
import {
  type RefObject,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  collectRanges,
  scrollRangeIntoView,
  setHighlight,
} from "../../history/search-page";
import { useT } from "../../i18n/locale";
import { revealCodeMatch } from "../rich/Markdown";

export function LocalSearchBar({
  container,
  version,
}: {
  container: RefObject<HTMLDivElement | null>;
  version: string;
}) {
  const { t } = useT();
  const [query, setQuery] = useState(""),
    [active, setActive] = useState(0),
    [count, setCount] = useState(0),
    ranges = useRef<Range[]>([]);
  const id = `cadence-page-${useId().replace(/[^a-z0-9]/gi, "")}`;
  useLayoutEffect(() => {
    if (!version) return;
    const root = container.current;
    const values = root && query ? collectRanges(root, query) : [];
    ranges.current = values;
    setCount(values.length);
    setActive(0);
    setHighlight(id, values);
    return () => {
      ranges.current = [];
      setHighlight(id, []);
      setHighlight(`${id}-active`, []);
    };
  }, [query, container, version, id]);
  const move = (delta: number) => {
    const n = count ? (active + delta + count) % count : 0;
    const field = container.current;
    const range = ranges.current[n];
    if (!field || !range || !field.contains(range.commonAncestorContainer))
      return;
    revealCodeMatch(range);
    if (
      container.current !== field ||
      !field.isConnected ||
      ranges.current[n] !== range ||
      !field.contains(range.commonAncestorContainer) ||
      range.toString() !== query
    )
      return;
    const { width, height } = range.getBoundingClientRect();
    if (!width || !height) return;
    // The field bounds the search, not the scroll. Its tab/inspector can
    // itself be scrolled out of view beyond the code's horizontal viewport.
    scrollRangeIntoView(document.documentElement, range);
    setActive(n);
    setHighlight(`${id}-active`, [range]);
  };
  return (
    <div className="search-bar toolbar">
      <label>
        {t("Find on displayed field page")}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              move(e.shiftKey ? -1 : 1);
            }
          }}
        />
      </label>
      <span>
        {count ? active + 1 : 0}/{count}
        {count >= 1000 ? t(" (first 1000 visual highlights)") : ""}
        {t("; not whole-history search")}
      </span>
      <button type="button" disabled={!count} onClick={() => move(-1)}>
        {t("Previous match")}
      </button>
      <button type="button" disabled={!count} onClick={() => move(1)}>
        {t("Next match")}
      </button>
    </div>
  );
}
