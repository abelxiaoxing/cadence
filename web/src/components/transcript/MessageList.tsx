/* Direct adaptation of pi-web-ui MessageList.tsx lazy-window/scroll-follow family.
 * MIT (c) 2026 xing-shuyin. Network paging is independent of DOM windowing.
 * Stable committed entity versions replace stream-ID guesses; orphan results are retained. */
import { useMemo, useRef } from "react";
import { FiArrowDown } from "react-icons/fi";
import { usePage } from "../../history/use-page";
import { useT } from "../../i18n/locale";
import { useLazyWindow } from "../../transcript/use-lazy-window";
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
  const { t } = useT();
  const scrollRef = useRef<HTMLDivElement>(null),
    stickRef = useRef(true);
  const rows = useMemo(
    () =>
      messages.map((message) => ({
        id: message.owner.entity.id,
        role: message.role,
        version: message.version,
        message,
      })),
    [messages],
  );
  const lazy = useLazyWindow(scrollRef, rows);
  return (
    <div className="messages-wrap">
      <div
        className="messages"
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          lazy.scheduleSweep();
        }}
      >
        {rows.map(({ id, role, message }) => (
          <LazyMount
            key={id}
            id={id}
            show={!lazy.hidden.has(id)}
            height={lazy.placeholder(
              id,
              message.version,
              role === "user" ? 100 : 280,
            )}
            containerRef={scrollRef}
            onMeasured={lazy.recordMeasured}
            lazyRef={lazy.register(id)}
          >
            <Message message={message} client={client} seed={seed} />
          </LazyMount>
        ))}
      </div>
      <button
        type="button"
        className="scroll-bottom"
        onClick={() => {
          if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            stickRef.current = true;
          }
        }}
      >
        <FiArrowDown aria-hidden="true" />
        {t("Latest on loaded page")}
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
  const { t } = useT();
  const pager = usePage(client, { ...seed, reader: "messages" }),
    page = pager.page;
  return (
    <section className="transcript">
      <PageControls pager={pager} compact />
      {page &&
        !("kind" in page) &&
        seed.snapshotSeq !== null &&
        page.request.snapshotSeq !== seed.snapshotSeq && (
          <button
            type="button"
            className="conversation-update"
            disabled={pager.busy}
            onClick={pager.refresh}
          >
            {t("New activity — update conversation")}
          </button>
        )}
      {page && !("kind" in page) && (
        <>
          {page.records.length === 0 && (
            <p className="empty-note panel-empty">
              {page.next
                ? t("No message records on this page; more history remains.")
                : t("No message records on this page.")}
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
