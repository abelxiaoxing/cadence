/* Direct adaptation of pi-web-ui GlobalSearchModal.tsx search/request-correlation,
 * keyboard navigation and result-section family. MIT (c) 2026 xing-shuyin.
 * Cadence replaces session restoration/files/plugins with exact durable hit anchors. */
import { useCallback, useEffect, useRef, useState } from "react";
import { FiSearch } from "react-icons/fi";
import { searchRequest } from "../../history/search-request";
import { emptySearchWindow } from "../../history/search-summary";
import { useT } from "../../i18n/locale";
import type {
  ReadCursor,
  SearchHit,
  SearchPage,
  ServiceClient,
} from "../../types";
import { ActionDialog } from "../actions/ActionDialog";
import { Coverage } from "./Coverage";
export function GlobalSearchModal({
  client,
  seed,
  onClose,
  onHit,
}: {
  client: ServiceClient;
  seed: ReadCursor;
  onClose: () => void;
  onHit: (hit: SearchHit) => void;
}) {
  const { t, tx } = useT();
  const [frozenSeed] = useState(seed);
  const inputRef = useRef<HTMLInputElement>(null),
    lastReqRef = useRef(0);
  const [query, setQuery] = useState(""),
    [active, setActive] = useState(0);
  const [page, setPage] = useState<SearchPage>(),
    [pending, setPending] = useState(false),
    [error, setError] = useState<string>();
  const controller = useRef<AbortController | null>(null);
  const search = useCallback(
    async (cursor: ReadCursor, reqId: number) => {
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      setPending(true);
      setError(undefined);
      try {
        const reply = await client.search(cursor, abort.signal);
        if (lastReqRef.current !== reqId || abort.signal.aborted) return;
        if (reply.kind === "error") setError(reply.error.code);
        else {
          setPage(reply.value);
          setActive(0);
        }
      } catch {
        if (lastReqRef.current === reqId && !abort.signal.aborted)
          setError("Search unavailable or invalid; no automatic retry.");
      } finally {
        if (lastReqRef.current === reqId && !abort.signal.aborted)
          setPending(false);
      }
    },
    [client],
  );
  useEffect(() => {
    inputRef.current?.focus();
    return () => {
      lastReqRef.current++;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    const reqId = ++lastReqRef.current;
    controller.current?.abort();
    setPending(false);
    setPage(undefined);
    setActive(0);
    setError(undefined);
    if (!query) return;
    let cursor: ReadCursor;
    try {
      cursor = searchRequest(frozenSeed, query);
    } catch {
      setError("Query must be 1–1024 UTF-8 bytes; it was not clipped.");
      return;
    }
    const timer = setTimeout(() => void search(cursor, reqId), 300);
    return () => {
      clearTimeout(timer);
      lastReqRef.current++;
      controller.current?.abort();
    };
  }, [query, frozenSeed, search]);
  return (
    <ActionDialog title={t("Search retained history")} onClose={onClose}>
      <div className="gs-modal">
        <div className="gs-input-row">
          <FiSearch />
          <input
            ref={inputRef}
            aria-label={t("Case-sensitive literal query")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) =>
                  Math.max(0, Math.min(a + 1, (page?.hits.length ?? 0) - 1)),
                );
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              }
              if (e.key === "Enter" && page?.hits[active]) {
                e.preventDefault();
                onHit(page.hits[active]);
                onClose();
              }
            }}
          />
        </div>
        <p>
          {t(
            "Case-sensitive literal UTF-8 search. Scope {kind} {id}; snapshot {seq}. No regex, provider request or history repair.",
            {
              kind: tx(frozenSeed.scope.kind),
              id: frozenSeed.scope.id,
              seq: frozenSeed.snapshotSeq,
            },
          )}
        </p>
        <div className="gs-results">
          {pending && (
            <p role="status">{t("Searching bounded retained range…")}</p>
          )}
          {error && (
            <p role="alert">
              {t("Search refused: {error}", { error: tx(error) })}
            </p>
          )}
          {!query && <p>{t("Enter a query to search this selected scope.")}</p>}
          {page && (
            <>
              <Coverage value={page.coverage} />
              <div className="gs-section">
                <div className="gs-section-head">
                  {t("Matches on this page: {count}", {
                    count: page.hits.length,
                  })}
                </div>
                {page.hits.map((hit, i) => (
                  <button
                    type="button"
                    key={`${hit.content.recordId}:${hit.content.version}:${hit.range.start}`}
                    className={`gs-item ${active === i ? "active" : ""}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => {
                      onHit(hit);
                      onClose();
                    }}
                  >
                    <span className="gs-item-title">
                      {tx(hit.owner.entity.kind)} · {tx(hit.content.field)} · v
                      {hit.content.version}
                    </span>
                    <span className="gs-item-sub">{hit.preview}</span>
                    <code>
                      {hit.owner.childRunId ??
                        hit.owner.runId ??
                        hit.owner.taskId}{" "}
                      / {hit.content.recordId} /{" "}
                      {t("bytes {start}–{end}", {
                        start: hit.range.start,
                        end: hit.range.end,
                      })}
                    </code>
                  </button>
                ))}
                {page.hits.length === 0 && <p>{tx(emptySearchWindow(page))}</p>}
              </div>
              <button
                type="button"
                disabled={pending || !page.next}
                onClick={() => {
                  if (page.next) void search(page.next, ++lastReqRef.current);
                }}
              >
                {t("Continue same snapshot search")}
              </button>
            </>
          )}
        </div>
        <footer className="gs-foot">
          {t(
            "↑↓ Navigate · Enter Open exact hit · Escape Close. Reopening never resumes execution.",
          )}
        </footer>
      </div>
    </ActionDialog>
  );
}
