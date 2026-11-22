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
/** `rows` must keep its identity while unchanged; it re-plans the window.
 * `pinned` names a row that stays mounted wherever it is: a jump target has
 * its real height before the view scrolls to it. */
export function useLazyWindow(
  scrollRef: RefObject<HTMLElement | null>,
  rows: readonly WindowRow[],
  pinned: string | null = null,
  tailBudget = 1800,
  onContentResize?: () => void,
) {
  const onResize = useRef(onContentResize);
  onResize.current = onContentResize;
  const observerRef = useRef<ResizeObserver | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;
  const heightsRef = useRef(new Map<string, number>()),
    heightMetaRef = useRef(new Map<string, HeightEntry>());
  const elsRef = useRef(new Map<string, HTMLDivElement>()),
    callbacksRef = useRef(
      new Map<string, (el: HTMLDivElement | null) => void>(),
    ),
    sweepRafRef = useRef(0);
  const versionsRef = useRef(new Map<string, number>());
  versionsRef.current = new Map(rows.map((r) => [r.id, r.version]));
  const alwaysRef = useRef(new Set<string>());
  alwaysRef.current = pickAlways(rows, heightsRef.current, tailBudget);
  if (pinned !== null) alwaysRef.current.add(pinned);
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
    void pinned; // A newly pinned row is planned at once, not on the next scroll.
    if (!rows.length) {
      setHidden((prev) => (prev.size ? new Set() : prev));
      return;
    }
    sweep();
  }, [sweep, rows, pinned]);
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      scheduleSweep();
      onResize.current?.();
    });
    observerRef.current = observer;
    if (scrollRef.current) observer.observe(scrollRef.current);
    for (const el of elsRef.current.values()) observer.observe(el);
    return () => {
      observerRef.current = null;
      observer.disconnect();
      cancelAnimationFrame(sweepRafRef.current);
      sweepRafRef.current = 0;
    };
  }, [scheduleSweep, scrollRef]);
  const register = useCallback((id: string) => {
    let cb = callbacksRef.current.get(id);
    if (!cb) {
      cb = (el: HTMLDivElement | null) => {
        const prior = elsRef.current.get(id);
        if (prior && prior !== el) observerRef.current?.unobserve(prior);
        if (el) {
          elsRef.current.set(id, el);
          observerRef.current?.observe(el);
        } else {
          elsRef.current.delete(id);
          callbacksRef.current.delete(id);
        }
      };
      callbacksRef.current.set(id, cb);
    }
    return cb;
  }, []);
  const placeholder = useCallback(
    (id: string, version: number, estimate: number) =>
      getPlaceholderHeight(id, version, heightMetaRef.current, estimate),
    [],
  );
  return { hidden, scheduleSweep, recordMeasured, register, placeholder };
}

/** Height changes are not user intent. Only a previously following reader may
 * move to the end; neither image loading nor opening details re-enables it. */
export function followResize(
  root: Pick<HTMLElement, "scrollHeight" | "scrollTop"> | null,
  following: boolean,
): void {
  if (root && following) root.scrollTop = root.scrollHeight;
}

/** A non-windowed transcript (the subagent view) observes its whole body. */
export function useFollowResize(
  scroll: RefObject<HTMLElement | null>,
  body: RefObject<HTMLElement | null>,
  following: RefObject<boolean>,
) {
  useEffect(() => {
    const observer = new ResizeObserver(() =>
      followResize(scroll.current, following.current),
    );
    if (body.current) observer.observe(body.current);
    return () => observer.disconnect();
  }, [scroll, body, following]);
}
