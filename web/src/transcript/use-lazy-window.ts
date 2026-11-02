/* Lazy-window wiring extracted from the pi-web-ui-adapted MessageList
 * (MIT (c) 2026 xing-shuyin): rows far outside the viewport render as
 * placeholders of their last measured height; native scroll anchoring keeps
 * the visible rows still while rows swap. */
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  applyPlan,
  getPlaceholderHeight,
  type HeightEntry,
  pickAlways,
  planWindow,
  type WinRect,
} from "./lazy-window";

export interface WindowRow {
  id: string;
  role: string;
  /** Changes whenever the row's content (and so its height) may change. */
  version: number;
}
/** `rows` must keep its identity while unchanged; it re-plans the window. */
export function useLazyWindow(
  scrollRef: RefObject<HTMLElement | null>,
  rows: readonly WindowRow[],
  tailBudget = 1800,
) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;
  const heightsRef = useRef(new Map<string, number>()),
    heightMetaRef = useRef(new Map<string, HeightEntry>());
  const elsRef = useRef(new Map<string, HTMLDivElement>()),
    sweepRafRef = useRef(0);
  const versionsRef = useRef(new Map<string, number>());
  versionsRef.current = new Map(rows.map((r) => [r.id, r.version]));
  const alwaysRef = useRef(new Set<string>());
  alwaysRef.current = pickAlways(rows, heightsRef.current, tailBudget);
  const recordMeasured = useCallback((id: string, h: number) => {
    const len = versionsRef.current.get(id);
    if (len === undefined) return;
    heightMetaRef.current.set(id, { h, len });
    heightsRef.current.set(id, h);
  }, []);
  const sweep = useCallback(() => {
    const root = scrollRef.current;
    if (!root) return;
    const bounds = root.getBoundingClientRect();
    const items: WinRect[] = [];
    for (const [id, el] of elsRef.current) {
      const b = el.getBoundingClientRect();
      items.push({ id, top: b.top, bottom: b.bottom });
      if (!hiddenRef.current.has(id)) recordMeasured(id, b.height);
    }
    const plan = planWindow(
      items,
      { top: bounds.top - 1200, bottom: bounds.bottom + 1200 },
      alwaysRef.current,
      hiddenRef.current,
      { top: bounds.top - 2400, bottom: bounds.bottom + 2400 },
    );
    for (const id of plan.hide) {
      const el = elsRef.current.get(id);
      if (el) recordMeasured(id, el.offsetHeight);
    }
    setHidden((prev) => applyPlan(prev, plan));
  }, [recordMeasured, scrollRef]);
  const scheduleSweep = useCallback(() => {
    if (sweepRafRef.current) return;
    sweepRafRef.current = requestAnimationFrame(() => {
      sweepRafRef.current = 0;
      sweep();
    });
  }, [sweep]);
  useLayoutEffect(() => {
    if (!rows.length) {
      setHidden(new Set());
      return;
    }
    sweep();
  }, [sweep, rows]);
  useEffect(() => {
    const observer = new ResizeObserver(scheduleSweep);
    if (scrollRef.current) observer.observe(scrollRef.current);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(sweepRafRef.current);
    };
  }, [scheduleSweep, scrollRef]);
  const register = useCallback(
    (id: string) => (el: HTMLDivElement | null) => {
      if (el) elsRef.current.set(id, el);
      else elsRef.current.delete(id);
    },
    [],
  );
  const placeholder = useCallback(
    (id: string, version: number, estimate: number) =>
      getPlaceholderHeight(id, version, heightMetaRef.current, estimate),
    [],
  );
  return { hidden, scheduleSweep, recordMeasured, register, placeholder };
}
