import type {
  EntityPage,
  EntityReadRequest,
  EntityReadResult,
  HistoryPage,
  HistoryReadResult,
  ListRequest,
} from "../../src/service-contract.ts";
/** Existing data assertions explicitly consume proof-only steps rather than cast
 * progress into a page. Dedicated cold tests assert every intermediate response. */
export async function historyData(
  read: (request: ListRequest) => Promise<HistoryReadResult>,
  request: ListRequest,
): Promise<HistoryPage> {
  for (let n = 0; n < 10000; n++) {
    const result = await read(request);
    if (!("kind" in result)) return result;
    request = result.next;
  }
  throw Error("history continuation did not finish");
}
export async function entityData(
  read: (request: EntityReadRequest) => Promise<EntityReadResult>,
  request: EntityReadRequest,
): Promise<EntityPage> {
  for (let n = 0; n < 10000; n++) {
    const result = await read(request);
    if (!("kind" in result)) return result;
    request = result.next;
  }
  throw Error("entity continuation did not finish");
}
