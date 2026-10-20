/* Adapted from pi-web-ui SearchBar.tsx; MIT (c) 2026 xing-shuyin. */
import { type RefObject, useEffect, useId, useRef, useState } from "react";
import {
  collectRanges,
  scrollRangeIntoView,
  setHighlight,
} from "../../history/search-page";
export function LocalSearchBar({
  container,
  version,
}: {
  container: RefObject<HTMLDivElement | null>;
  version: string;
}) {
  const [query, setQuery] = useState(""),
    [active, setActive] = useState(0),
    [count, setCount] = useState(0),
    ranges = useRef<Range[]>([]);
  const id = `cadence-page-${useId().replace(/[^a-z0-9]/gi, "")}`;
  useEffect(() => {
    if (!version) return;
    const root = container.current;
    const values = root && query ? collectRanges(root, query) : [];
    ranges.current = values;
    setCount(values.length);
    setActive(0);
    setHighlight(id, values);
    return () => setHighlight(id, []);
  }, [query, container, version, id]);
  const move = (delta: number) => {
    const n = count ? (active + delta + count) % count : 0;
    setActive(n);
    if (container.current && ranges.current[n]) {
      scrollRangeIntoView(container.current, ranges.current[n]);
      setHighlight(`${id}-active`, [ranges.current[n]]);
    }
  };
  useEffect(() => () => setHighlight(`${id}-active`, []), [id]);
  return (
    <div className="search-bar toolbar">
      <label>
        Find on displayed field page
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
        {count >= 1000 ? " (first 1000 visual highlights)" : ""}; not
        whole-history search
      </span>
      <button type="button" disabled={!count} onClick={() => move(-1)}>
        Previous match
      </button>
      <button type="button" disabled={!count} onClick={() => move(1)}>
        Next match
      </button>
    </div>
  );
}
