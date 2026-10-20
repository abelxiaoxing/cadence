/** One current-obligation policy for projections and human review. Native results
 * remain immutable; only the latest exact selection is tested for freshness. */
import {
  type CheckObligations,
  type CheckSelection,
  ContractError,
  type ControlContext,
  canonicalJson,
  decodeCheckObligations,
  LIMITS,
} from "../service-contract.ts";
import type { HistoryFiles } from "./files.ts";
import { HistoryReadBudget } from "./files.ts";
import { HistoryNavigation } from "./navigation.ts";

export interface CurrentChecks {
  checks: CheckObligations;
  recorded: CheckObligations["definitions"];
  recordingIncomplete: boolean;
}
export function currentChecks(
  files: HistoryFiles,
  taskId: string,
  configured: { revision: number; selections: CheckSelection[] },
  current: ControlContext,
  snapshotSeq?: string,
): CurrentChecks {
  const budget = new HistoryReadBudget(),
    navigation = new HistoryNavigation(files);
  const snapshot = snapshotSeq ?? navigation.latest(budget);
  navigation.snapshot(snapshot, budget);
  const starts = new Map<
    string,
    {
      selection: CheckSelection;
      epoch: string;
      cwdId: string;
      checkEnvGeneration: number;
    }
  >();
  const results = new Map<string, CheckObligations["definitions"][number]>();
  const incomplete = new Map<string, boolean>();
  const batches =
    navigation.entityBatches(taskId, snapshot, budget) ??
    navigation.scanSnapshot(snapshot, budget);
  for (const b of batches)
    for (const row of b.rows) {
      const v = row.value;
      if (v.kind !== "owner" || v.link.taskId !== taskId) continue;
      for (const e of v.events) {
        if (e.kind !== "owner" || e.value.kind !== "fact") continue;
        const f = e.value.fact;
        if (f.kind === "check-start")
          starts.set(f.checkId, {
            selection: f.selection,
            epoch: v.link.epoch,
            cwdId: f.cwdId,
            checkEnvGeneration: f.checkEnvGeneration,
          });
        if (f.kind === "check-settled") {
          const s = starts.get(f.checkId);
          if (!s) throw new ContractError("corrupt-selected");
          // Removed configured obligations are historical, not permanently unresolved.
          if (
            s.selection.kind === "manual" ||
            configured.selections.some(
              (c) => canonicalJson(c) === canonicalJson(s.selection),
            )
          ) {
            const fresh =
              current.status === "available" &&
              current.version.epoch === s.epoch &&
              current.version.cwdId === s.cwdId &&
              current.version.checkEnvGeneration === s.checkEnvGeneration &&
              current.version.observation.identity === f.after.identity &&
              current.version.observation.complete === f.after.complete &&
              current.version.checkoutGeneration === f.after.checkoutGeneration;
            incomplete.set(
              canonicalJson(s.selection),
              f.output === null ||
                f.coverage.observed !== "complete" ||
                f.coverage.source !== "complete" ||
                f.coverage.omissions.length > 0,
            );
            results.set(canonicalJson(s.selection), {
              selection: s.selection,
              status: f.status === "passed" && !fresh ? "stale" : f.status,
              checkId: f.checkId,
            });
          }
          starts.delete(f.checkId);
        }
        if (starts.size > LIMITS.childReservations || results.size > 32)
          throw new ContractError("receipt-inconclusive");
      }
    }
  return {
    checks: decodeCheckObligations({
      taskId,
      revision: configured.revision,
      definitions: configured.selections.map(
        (selection) =>
          results.get(canonicalJson(selection)) ?? {
            selection,
            status: "not-run",
            checkId: null,
          },
      ),
    }),
    recorded: [...results.values()],
    recordingIncomplete: [...incomplete.values()].some(Boolean),
  };
}
