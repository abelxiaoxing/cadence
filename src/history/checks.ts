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
import { HistoryNavigation, type LocatedBatch } from "./navigation.ts";
import { resumeTaskFold } from "./task-folds.ts";

export interface CurrentChecks {
  checks: CheckObligations;
  recorded: CheckObligations["definitions"];
  recordingIncomplete: boolean;
}
interface CheckStart {
  selection: CheckSelection;
  epoch: string;
  cwdId: string;
  checkEnvGeneration: number;
}
interface CheckSettled extends CheckStart {
  checkId: string;
  status: "passed" | "failed" | "canceled" | "stale";
  after: { identity: string; complete: boolean; checkoutGeneration: number };
  incomplete: boolean;
}
/** Raw check facts of one task's committed prefix, before any configuration or
 * current context: open starts and the latest settlement per exact selection. */
export interface CheckFoldState {
  starts: [string, CheckStart][];
  settled: [string, CheckSettled][];
}
export class CheckFold {
  private readonly starts: Map<string, CheckStart>;
  private readonly settled: Map<string, CheckSettled>;
  constructor(state?: CheckFoldState) {
    this.starts = new Map(state?.starts);
    this.settled = new Map(state?.settled);
  }
  apply(batch: LocatedBatch, taskId: string): void {
    for (const row of batch.rows) {
      const v = row.value;
      if (v.kind !== "owner" || v.link.taskId !== taskId) continue;
      for (const e of v.events) {
        if (e.kind !== "owner" || e.value.kind !== "fact") continue;
        const f = e.value.fact;
        if (f.kind === "check-start")
          this.starts.set(f.checkId, {
            selection: f.selection,
            epoch: v.link.epoch,
            cwdId: f.cwdId,
            checkEnvGeneration: f.checkEnvGeneration,
          });
        if (f.kind === "check-settled") {
          const s = this.starts.get(f.checkId);
          if (!s) throw new ContractError("corrupt-selected");
          // Latest wins; Map keeps each selection's first-settled position.
          this.settled.set(canonicalJson(s.selection), {
            ...s,
            checkId: f.checkId,
            status: f.status,
            after: {
              identity: f.after.identity,
              complete: f.after.complete,
              checkoutGeneration: f.after.checkoutGeneration,
            },
            incomplete:
              f.output === null ||
              f.coverage.observed !== "complete" ||
              f.coverage.source !== "complete" ||
              f.coverage.omissions.length > 0,
          });
          this.starts.delete(f.checkId);
        }
        if (this.starts.size > LIMITS.childReservations)
          throw new ContractError("receipt-inconclusive");
      }
    }
  }
  state(): CheckFoldState {
    return {
      starts: [...this.starts],
      settled: [...this.settled],
    };
  }
  evaluate(
    taskId: string,
    configured: { revision: number; selections: CheckSelection[] },
    current: ControlContext,
  ): CurrentChecks {
    const results = new Map<string, CheckObligations["definitions"][number]>();
    const incomplete = new Map<string, boolean>();
    for (const [key, s] of this.settled) {
      // Removed configured obligations are historical, not permanently unresolved.
      if (
        s.selection.kind !== "manual" &&
        !configured.selections.some((c) => canonicalJson(c) === key)
      )
        continue;
      const fresh =
        current.status === "available" &&
        current.version.epoch === s.epoch &&
        current.version.cwdId === s.cwdId &&
        current.version.checkEnvGeneration === s.checkEnvGeneration &&
        current.version.observation.identity === s.after.identity &&
        current.version.observation.complete === s.after.complete &&
        current.version.checkoutGeneration === s.after.checkoutGeneration;
      incomplete.set(key, s.incomplete);
      results.set(key, {
        selection: s.selection,
        status: s.status === "passed" && !fresh ? "stale" : s.status,
        checkId: s.checkId,
      });
    }
    if (results.size > 32) throw new ContractError("receipt-inconclusive");
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
}
/** The task's check facts through `snapshot`, resumed from its newest valid
 * remembered state when one exists; otherwise the original chain or snapshot scan. */
export function checkFold(
  files: HistoryFiles,
  taskId: string,
  snapshot: string,
  budget: HistoryReadBudget,
  navigation = new HistoryNavigation(files),
): CheckFold {
  navigation.snapshot(snapshot, budget);
  const { base, batches } = resumeTaskFold(
    files,
    navigation,
    taskId,
    snapshot,
    budget,
    (state) => state.checks,
  );
  const fold = new CheckFold(base);
  for (const b of batches) fold.apply(b, taskId);
  return fold;
}
export function currentChecks(
  files: HistoryFiles,
  taskId: string,
  configured: { revision: number; selections: CheckSelection[] },
  current: ControlContext,
  snapshotSeq?: string,
): CurrentChecks {
  const budget = HistoryReadBudget.authority(),
    navigation = new HistoryNavigation(files);
  const snapshot = snapshotSeq ?? navigation.latest(budget);
  return checkFold(files, taskId, snapshot, budget, navigation).evaluate(
    taskId,
    configured,
    current,
  );
}
