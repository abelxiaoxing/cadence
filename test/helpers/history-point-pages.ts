import type {
  GraphPage,
  GraphReadRequest,
  GraphReadResult,
} from "../../src/service-contract.ts";

/** Follow only typed progress, never retry a refusal or change a snapshot. */
export async function graphPage(
  reader: { graph(request: GraphReadRequest): Promise<GraphReadResult> },
  request: GraphReadRequest,
): Promise<GraphPage> {
  for (let n = 0; n < 10000; n++) {
    const result = await reader.graph(request);
    if (!("kind" in result)) return result;
    request = result.next;
  }
  throw Error("fixture graph proof did not finish");
}
