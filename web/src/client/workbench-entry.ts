import { decodeWorkbenchEntry } from "../../../src/service/contracts/gateway.ts";
import { ObservationRefusal, observationRead } from "./observation-read";

/** One bounded entry GET. Only the recognized route refusal identifies a
 * direct owner; the mounted workbench owns retry and navigation lifetimes. */
export async function readEntry(signal: AbortSignal) {
  try {
    return await observationRead("/workbench/v1", signal, decodeWorkbenchEntry);
  } catch (error) {
    if (
      error instanceof ObservationRefusal &&
      error.status === 400 &&
      error.message === "invalid"
    )
      return null;
    throw error;
  }
}
