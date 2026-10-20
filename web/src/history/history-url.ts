/* Adapted from pi-web-ui session-url.ts. MIT (c) 2026 xing-shuyin.
 * Exact immutable navigation replaces session files / timestamp-prefix guesses. */
import {
  decodeCursor,
  decodeId,
  parseWireJson,
} from "../../../src/service-contract.ts";
import type { ReadCursor } from "../types";
export function historyUrl(taskId: string, cursor?: ReadCursor): string {
  const url = new URL(window.location.origin + window.location.pathname);
  const params = new URLSearchParams({ task: decodeId(taskId) });
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
} | null {
  try {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const taskId = decodeId(params.get("task")),
      detail = params.get("detail");
    if (!detail) return { taskId };
    const cursor = decodeCursor(parseWireJson(detail));
    if (cursor.navigation) return null;
    return { taskId, cursor };
  } catch {
    return null;
  }
}
