/* Adapted from pi-web-ui session-url.ts. MIT (c) 2026 xing-shuyin.
 * Exact immutable navigation replaces session files / timestamp-prefix guesses. */
import {
  decodeCursor,
  decodeId,
  decodeScope,
  decodeSequence,
  parseWireJson,
} from "../../../src/service-contract.ts";
import type { ReadCursor, Scope } from "../types";
export function historyUrl(
  taskId: string,
  cursor?: ReadCursor,
  conversation?: { scope: Scope; snapshotSeq?: string },
): string {
  const url = new URL(window.location.origin + window.location.pathname);
  const params = new URLSearchParams({ task: decodeId(taskId) });
  if (conversation) {
    params.set("scope", JSON.stringify(decodeScope(conversation.scope)));
    if (conversation.snapshotSeq)
      params.set("snapshot", decodeSequence(conversation.snapshotSeq));
  }
  if (cursor) {
    const { navigation: _proof, ...anchor } = cursor;
    params.set("detail", JSON.stringify(anchor));
  }
  url.hash = params.toString();
  return url.href;
}
export function readHistoryUrl(): {
  taskId: string;
  cursor?: ReadCursor;
  scope?: Scope;
  snapshotSeq?: string;
} | null {
  try {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const taskId = decodeId(params.get("task")),
      detail = params.get("detail");
    const rawScope = params.get("scope"),
      rawSnapshot = params.get("snapshot");
    const scope = rawScope ? decodeScope(parseWireJson(rawScope)) : undefined;
    const snapshotSeq = rawSnapshot ? decodeSequence(rawSnapshot) : undefined;
    if (scope?.kind === "task" && scope.id !== taskId) return null;
    if (snapshotSeq && !scope) return null;
    if (!detail) return { taskId, scope, snapshotSeq };
    const cursor = decodeCursor(parseWireJson(detail));
    if (cursor.navigation) return null;
    return { taskId, cursor, scope, snapshotSeq };
  } catch {
    return null;
  }
}
