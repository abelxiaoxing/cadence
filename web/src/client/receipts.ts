import {
  canonicalJson,
  compareSequence,
} from "../../../src/service-contract.ts";
import type { Receipt } from "../types";
import type { CommandObservation } from "./actions";
/** Exact command/operation identity and committed sequence, not HTTP arrival order. */
export function mergeObservation(
  previous: CommandObservation,
  next: CommandObservation,
): CommandObservation {
  if (previous.commandId !== next.commandId) return previous;
  const candidates = [
    previous.receipt,
    previous.lookup?.status === "found" ? previous.lookup.receipt : undefined,
    next.receipt,
    next.lookup?.status === "found" ? next.lookup.receipt : undefined,
  ];
  let receipt: Receipt | undefined;
  let conflict = false;
  for (const candidate of candidates) {
    if (!candidate || candidate.commandId !== previous.commandId) continue;
    if (
      receipt &&
      (receipt.operationId !== candidate.operationId ||
        receipt.runId !== candidate.runId ||
        (receipt.created !== null &&
          receipt.created.taskId !== candidate.created?.taskId))
    ) {
      conflict = true;
      continue;
    }
    if (
      receipt &&
      compareSequence(candidate.committedSeq, receipt.committedSeq) > 0 &&
      ((receipt.created?.state === "published" &&
        candidate.created?.state !== "published") ||
        (receipt.admission === "accepted" &&
          candidate.admission !== "accepted") ||
        (receipt.execution !== null &&
          candidate.execution !== receipt.execution) ||
        (receipt.settlement !== null &&
          canonicalJson(candidate.settlement) !==
            canonicalJson(receipt.settlement)))
    ) {
      conflict = true;
      continue;
    }
    if (
      !receipt ||
      compareSequence(candidate.committedSeq, receipt.committedSeq) > 0
    )
      receipt = candidate;
    // Equal-sequence contradictions never replace an already observed committed fact.
    else if (canonicalJson(receipt) === canonicalJson(candidate))
      receipt = candidate;
  }
  return {
    commandId: previous.commandId,
    receipt,
    lookup: receipt
      ? { status: "found", receipt }
      : (next.lookup ?? previous.lookup),
    error: conflict
      ? "Conflicting receipt observation refused; prior committed facts preserved."
      : receipt
        ? undefined
        : (next.error ?? previous.error),
  };
}
