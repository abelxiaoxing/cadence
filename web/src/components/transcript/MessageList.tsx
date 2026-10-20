/* Direct adaptation of pi-web-ui MessageList.tsx lazy-window/scroll-follow family.
 * MIT (c) 2026 xing-shuyin. Network paging is independent of DOM windowing.
 * Stable committed entity versions replace stream-ID guesses; orphan results are retained. */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePage } from "../../history/use-page";
import {
  applyPlan,
  getPlaceholderHeight,
  type HeightEntry,
  pickAlways,
  planWindow,
  type WinRect,
} from "../../transcript/lazy-window";
import type { HistoryRecord, ListRequest, ServiceClient } from "../../types";
import { PageControls } from "../history/PageControls";
import { LazyMount } from "./LazyMount";
import { Message } from "./Message";

function WindowedMessages({
  messages,
  client,
  seed,
}: {
  messages: Extract<HistoryRecord, { kind: "message" }>[];
  client: ServiceClient;
  seed: ListRequest;
}) {
  const scrollRef = useRef<HTMLDivElement>(null),
    stickRef = useRef(true);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;
  const heightsRef = useRef(new Map<string, number>()),
    heightMetaRef = useRef(new Map<string, HeightEntry>());
  const elsRef = useRef(new Map<string, HTMLDivElement>()),
    sweepRafRef = useRef(0);
  const rows = useMemo(
    () =>
      messages.map((message) => ({
        id: message.owner.entity.id,
        role: message.role,
        message,
      })),
    [messages],
  );
  const fpRef = useRef(new Map<string, number>());
  fpRef.current = new Map(rows.map((r) => [r.id, r.message.version]));
  const alwaysRef = useRef(new Set<string>());
  alwaysRef.current = pickAlways(rows, heightsRef.current, 1800);
  const recordMeasured = useCallback((id: string, h: number) => {
    const len = fpRef.current.get(id);
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
  }, [recordMeasured]);
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
  }, [scheduleSweep]);
  return (
    <div className="messages-wrap">
      <div
        className="messages"
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          scheduleSweep();
        }}
      >
        {rows.map(({ id, role, message }) => (
          <LazyMount
            key={id}
            id={id}
            show={!hidden.has(id)}
            height={getPlaceholderHeight(
              id,
              message.version,
              heightMetaRef.current,
              role === "user" ? 100 : 280,
            )}
            containerRef={scrollRef}
            onMeasured={recordMeasured}
            lazyRef={(el) => {
              if (el) elsRef.current.set(id, el);
              else elsRef.current.delete(id);
            }}
          >
            <Message message={message} client={client} seed={seed} />
          </LazyMount>
        ))}
      </div>
      <button
        type="button"
        className="follow-button"
        onClick={() => {
          if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            stickRef.current = true;
          }
        }}
      >
        Latest on loaded page
      </button>
    </div>
  );
}
export function MessageList({
  client,
  seed,
}: {
  client: ServiceClient;
  seed: ListRequest;
}) {
  const pager = usePage(client, { ...seed, reader: "messages" }),
    page = pager.page;
  return (
    <section className="transcript">
      <PageControls pager={pager} />
      {page && !("kind" in page) && (
        <>
          {page.records.length === 0 && (
            <p>
              No message records on this page
              {page.next ? "; more history remains." : "."}
            </p>
          )}
          <WindowedMessages
            key={`${page.request.snapshotSeq}:${page.request.after?.recordId ?? "first"}`}
            messages={page.records.filter(
              (r): r is Extract<HistoryRecord, { kind: "message" }> =>
                r.kind === "message",
            )}
            client={client}
            seed={page.request}
          />
        </>
      )}
    </section>
  );
}
