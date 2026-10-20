import {
  decodeCursor,
  LIMITS,
  utf8Bytes,
} from "../../../src/service-contract.ts";
import type { ReadCursor } from "../types";
export function searchRequest(seed: ReadCursor, query: string): ReadCursor {
  if (!query || utf8Bytes(query) > LIMITS.queryBytes)
    throw new Error(
      `Query must be 1–${LIMITS.queryBytes} UTF-8 bytes; it was not clipped.`,
    );
  const { navigation: _navigation, ...identity } = seed;
  return decodeCursor({
    ...identity,
    query,
    recordId: null,
    recordVersion: null,
    field: null,
    offset: 0,
  });
}
