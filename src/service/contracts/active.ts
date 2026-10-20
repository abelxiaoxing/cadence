/** Bounded current original-work roster, separate from historical run reduction. */
import {
  canonicalJson,
  closed,
  decodeId,
  decodePublicError,
  invalid,
  LIMITS,
  list,
  literal,
  oneOf,
  type PublicError,
} from "./core.ts";
export interface ActiveRunRef {
  taskId: string;
  runId: string;
  operationId: string;
  epoch: string;
  kind: "start" | "generate-plan" | "check";
  stage: "accepted-unallocated" | "active" | "draining";
}
export type ActiveRuns = {
  storeId: string;
  workspaceId: string;
  epoch: string;
} & (
  | { status: "complete"; runs: ActiveRunRef[] }
  | { status: "unavailable"; error: PublicError }
);
export function decodeActiveRuns(v: unknown): ActiveRuns {
  canonicalJson({ kind: "ok", value: v }, LIMITS.pageBytes);
  const complete =
    Object.getOwnPropertyDescriptor(v ?? {}, "status")?.value === "complete";
  const o = closed(v, [
    "storeId",
    "workspaceId",
    "epoch",
    "status",
    complete ? "runs" : "error",
  ]);
  const base = {
    storeId: decodeId(o.storeId),
    workspaceId: decodeId(o.workspaceId),
    epoch: decodeId(o.epoch),
  };
  if (!complete) {
    literal(o.status, "unavailable");
    return { ...base, status: "unavailable", error: noEffect(o.error) };
  }
  const runs = list(o.runs, LIMITS.episodes, (v): ActiveRunRef => {
    const r = closed(v, [
      "taskId",
      "runId",
      "operationId",
      "epoch",
      "kind",
      "stage",
    ]);
    return {
      taskId: decodeId(r.taskId),
      runId: decodeId(r.runId),
      operationId: decodeId(r.operationId),
      epoch: decodeId(r.epoch),
      kind: oneOf(r.kind, ["start", "generate-plan", "check"]),
      stage: oneOf(r.stage, ["accepted-unallocated", "active", "draining"]),
    };
  });
  if (
    runs.some((r) => r.epoch !== base.epoch) ||
    new Set(runs.map((r) => r.runId)).size !== runs.length ||
    new Set(runs.map((r) => r.taskId)).size !== runs.length ||
    new Set(runs.map((r) => r.operationId)).size !== runs.length
  )
    invalid();
  return { ...base, status: "complete", runs };
}

function noEffect(v: unknown): PublicError {
  const error = decodePublicError(v);
  literal(error.effect, "none");
  return error;
}
