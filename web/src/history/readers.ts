import { appendDetailPage, type RetainedText } from "../client/message-delta";
import type {
  ContentRef,
  HistoryReadResult,
  ListRequest,
  ReadCursor,
  Reply,
  Scope,
  ServiceClient,
} from "../types";
export function readPage(
  client: ServiceClient,
  request: ListRequest,
  signal?: AbortSignal,
): Promise<Reply<HistoryReadResult>> {
  switch (request.reader) {
    case "tasks":
      return client.tasks(request, signal);
    case "runs":
      return client.runs(request, signal);
    case "messages":
      return client.messages(request, signal);
    case "tools":
      return client.tools(request, signal);
    case "contents":
      return client.contents(request, signal);
    case "events":
      return client.events(request, signal);
    case "checks":
      return client.checks(request, signal);
    case "changes":
      return client.changes(request, signal);
    case "reviews":
      return client.reviews(request, signal);
  }
}
export function contentCursor(
  storeId: string,
  scope: Scope,
  snapshotSeq: string,
  content: ContentRef,
): ReadCursor {
  return {
    storeId,
    scope,
    snapshotSeq,
    query: null,
    recordId: content.recordId,
    recordVersion: content.version,
    field: content.field,
    offset: 0,
  };
}
/** One field, not an archive. Clipboard necessarily materializes text; caller can cancel.
 * Each original read is bounded and yielded. No partial JSON is ever parsed here. */
export async function readFullText(
  client: ServiceClient,
  seed: ReadCursor,
  signal: AbortSignal,
): Promise<{ text: string; recordingComplete: boolean }> {
  let next: ReadCursor | null = { ...seed, offset: 0 };
  delete next.navigation;
  let retained: RetainedText | null = null;
  let recordingComplete = true;
  while (next) {
    if (signal.aborted) throw new Error("canceled");
    const reply = await client.detail(next, signal);
    if (signal.aborted) throw new Error("canceled");
    if (reply.kind === "error") throw new Error(reply.error.code);
    const page = reply.value;
    next = page.next;
    if (!("kind" in page)) {
      recordingComplete =
        recordingComplete && page.coverage.observed === "complete";
      retained = appendDetailPage(retained, page);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (!retained || retained.offset !== retained.content.bytes)
    throw new Error("incomplete-content");
  return { text: retained.chunks.join(""), recordingComplete };
}
