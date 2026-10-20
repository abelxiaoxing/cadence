import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  canonicalJson,
  decodeCursor,
} from "../../../../src/service-contract.ts";
import { readFullText } from "../../history/readers";
import { copyTextToClipboard } from "../../rich/use-copy-feedback";
import type {
  ByteRange,
  DetailReadResult,
  ReadCursor,
  ServiceClient,
} from "../../types";
import { Markdown } from "../rich/Markdown";
import { Coverage } from "./Coverage";
import { LocalSearchBar } from "./LocalSearchBar";
/** Immutable owner/version/field paging; preview never stands in for the full record. */
export function DetailPane({
  client,
  cursor,
  highlight,
  render,
}: {
  client: ServiceClient;
  cursor: ReadCursor;
  highlight?: ByteRange;
  render?: (text: string) => ReactNode;
}) {
  const cursorKey = canonicalJson(cursor);
  const stableCursor = useMemo(
    () => decodeCursor(JSON.parse(cursorKey)),
    [cursorKey],
  );
  const [request, setRequest] = useState(cursor),
    [page, setPage] = useState<DetailReadResult>();
  const [back, setBack] = useState<ReadCursor[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const [mode, setMode] = useState<"raw" | "markdown">("raw"),
    [copyState, setCopyState] = useState("");
  const copying = useRef<AbortController | null>(null);
  const textContainer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setRequest(stableCursor);
    setBack([]);
    setPage(undefined);
    setError(undefined);
    return () => copying.current?.abort();
  }, [stableCursor]);
  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    setBusy(true);
    setError(undefined);
    void client
      .detail(request, controller.signal)
      .then((reply) => {
        if (!current) return;
        setBusy(false);
        if (reply.kind === "error") setError(reply.error.code);
        else setPage(reply.value);
      })
      .catch(() => {
        if (current) {
          setError("Read unavailable.");
          setBusy(false);
        }
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [client, request]);
  const copy = async () => {
    if (copying.current) return;
    const controller = new AbortController();
    copying.current = controller;
    setCopyState("Reading all retained field pages…");
    try {
      const text = await readFullText(client, cursor, controller.signal);
      if (controller.signal.aborted) return;
      const copied = await copyTextToClipboard(text.text);
      if (controller.signal.aborted) return;
      setCopyState(
        copied
          ? text.recordingComplete
            ? "Copied all retained field bytes (source omissions still apply)."
            : "Copied retained field bytes; recording is incomplete. No complete-source claim."
          : "Clipboard unavailable.",
      );
    } catch {
      if (!controller.signal.aborted)
        setCopyState("Full-field copy refused/incomplete.");
    } finally {
      if (copying.current === controller) copying.current = null;
    }
  };
  const data = page && !("kind" in page) ? page : undefined;
  const marked = () => {
    if (!data || !highlight || !data.range) return data?.text;
    const start =
      Math.max(highlight.start, data.range.start) - data.range.start;
    const end = Math.min(highlight.end, data.range.end) - data.range.start;
    if (end <= start) return data.text;
    const bytes = new TextEncoder().encode(data.text),
      decode = (s: number, e: number) =>
        new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(s, e));
    return (
      <>
        {decode(0, start)}
        <mark>{decode(start, end)}</mark>
        {decode(end, bytes.length)}
      </>
    );
  };
  return (
    <section className="detail-pane" aria-label="Retained field">
      <div className="detail-identity">
        <code>{cursor.recordId}</code> v{cursor.recordVersion} / {cursor.field}{" "}
        / snapshot {cursor.snapshotSeq}
      </div>
      {highlight && (
        <p>
          Exact hit bytes [{highlight.start}, {highlight.end}); only this
          immutable field is highlighted.
        </p>
      )}
      <div className="toolbar">
        <button
          type="button"
          onClick={() => setMode((m) => (m === "raw" ? "markdown" : "raw"))}
        >
          {mode === "raw" ? "Markdown page" : "Raw page"}
        </button>
        <button
          type="button"
          disabled={!!copying.current}
          onClick={() => void copy()}
        >
          Copy full retained field
        </button>
        {!!copying.current && (
          <button
            type="button"
            onClick={() => {
              copying.current?.abort();
              copying.current = null;
              setCopyState("Copy canceled; execution unchanged.");
            }}
          >
            Cancel copy
          </button>
        )}
      </div>
      <p role="status">{copyState}</p>
      {error && <p role="alert">Detail refused: {error}</p>}
      {busy && <p role="status">Reading…</p>}
      {page && <Coverage value={page.coverage} />}
      {page && "kind" in page && (
        <p>Validation in progress. The retained field is not empty.</p>
      )}
      {data && (
        <>
          <p>
            Bytes {data.range?.start ?? 0}–{data.range?.end ?? 0} of{" "}
            {data.content.bytes}.{" "}
            {data.next ? "More retained data available." : "End of field."}
          </p>
          <LocalSearchBar
            container={textContainer}
            version={`${data.content.recordId}:${data.content.version}:${data.range?.start ?? 0}:${mode}`}
          />
          <div ref={textContainer} data-retained-field>
            {render ? (
              render(data.text)
            ) : mode === "markdown" ? (
              <Markdown text={data.text} />
            ) : (
              <pre className="detail-text">{marked()}</pre>
            )}
          </div>
        </>
      )}
      <div className="toolbar">
        <button
          type="button"
          disabled={busy || !back.length}
          onClick={() => {
            setRequest(back[back.length - 1]);
            setBack((p) => p.slice(0, -1));
          }}
        >
          Previous
        </button>
        <button
          type="button"
          disabled={busy || !page?.next}
          onClick={() => {
            if (page?.next) {
              setBack((p) => [...p, request]);
              setRequest(page.next);
            }
          }}
        >
          {page && "kind" in page ? "Continue validation" : "Next field page"}
        </button>
      </div>
    </section>
  );
}
