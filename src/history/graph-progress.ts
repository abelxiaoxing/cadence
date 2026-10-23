/** Finite cold graph preparation over the same original-source validator.
 * No graph/admission body is stored in navigation and no read creates an index. */
import {
  ContractError,
  canonicalJson,
  decodeGraphPage,
  decodeGraphReadResult,
  type GraphReadRequest,
  type GraphReadResult,
  LIMITS,
  parseWireJson,
  readIdentity,
} from "../service-contract.ts";
import { closed } from "../worker-public.mjs";
import { decodeScanPoint } from "./detail-progress.ts";
import { HistoryReadBudget, noProgress, retryStalled } from "./files.ts";
import { HistoryReadProof } from "./read-proof.ts";
import type { HistoryReader } from "./reader.ts";
import { decodeRetainedProgress, freshProgress } from "./retained-progress.ts";
import { RetainedTraversal } from "./retained-traversal.ts";
import {
  collectSavedGraph,
  decodeSavedGraphState,
  freshSavedGraph,
  materializeSavedGraph,
} from "./saved-graph-state.ts";
import type { ScanPoint } from "./search.ts";

const initial = (): ScanPoint => ({
  pos: { segment: 1, offset: 0 },
  row: 0,
  event: 0,
  byte: 0,
  snapshot: 0,
});
export function graphPreparation(
  request: GraphReadRequest,
  completion: ReturnType<HistoryReadProof["prepareCompletion"]>,
): GraphReadResult {
  const state = freshProgress(),
    point = initial();
  const next = {
    ...readIdentity(request),
    navigation: completion.seal(
      { purpose: "graph", request },
      Buffer.from(
        canonicalJson({ point, state, saved: freshSavedGraph() }, 6000),
      ),
    ),
  };
  return decodeGraphReadResult({
    kind: "progress",
    request,
    next,
    coverage: state.coverage,
  });
}
export async function readRetainedGraph(
  reader: HistoryReader,
  request: GraphReadRequest,
): Promise<GraphReadResult> {
  return retryStalled(() => graphQuantum(reader, request));
}
async function graphQuantum(
  reader: HistoryReader,
  request: GraphReadRequest,
): Promise<GraphReadResult> {
  if (request.storeId !== reader.storeId)
    throw new ContractError("corrupt-selected");
  const budget = new HistoryReadBudget(),
    proof = new HistoryReadProof(reader.files),
    completion = proof.prepareCompletion(budget);
  let point = initial(),
    state = freshProgress(),
    saved = freshSavedGraph();
  if (request.navigation) {
    const parsed = parseWireJson(
      new TextDecoder("utf-8", { fatal: true }).decode(
        proof.open({ purpose: "graph", request }, request.navigation, budget),
      ),
      6000,
    );
    const o = closed(parsed, [
      "point",
      "state",
      ...(Object.hasOwn(parsed as object, "saved") ? ["saved"] : []),
    ]);
    point = decodeScanPoint(o.point);
    state = decodeRetainedProgress(o.state);
    saved =
      o.saved === undefined
        ? freshSavedGraph()
        : decodeSavedGraphState(o.saved);
  }
  const traversal = new RetainedTraversal(
    reader.files,
    request.snapshotSeq,
    budget,
    state,
  );
  const coordinate = () =>
      canonicalJson({ point, state: traversal.checkpoint(), saved }, 6000),
    before = coordinate();
  try {
    traversal.prepare(point);
    for (;;) {
      const batch = traversal.next(point);
      if (!batch) throw new ContractError("corrupt-selected");
      for (; point.row < batch.rows.length; point.row++, point.event = 0) {
        const value = batch.rows[point.row].value;
        const count = value.kind === "owner" ? value.events.length : 1;
        for (; point.event < count; point.event++) {
          collectSavedGraph(
            saved,
            request,
            batch,
            point.row,
            point.event,
            reader.files,
            budget,
          );
          if (value.kind !== "owner") continue;
          budget.reserve(0);
          const event = value.events[point.event];
          if (
            event.kind !== "owner" ||
            event.value.kind !== "fact" ||
            event.value.fact.kind !== "parent-admitted"
          )
            continue;
          const fact = event.value.fact;
          const fits =
            request.scope.kind === "task"
              ? fact.identity.context.task?.id === request.scope.id
              : request.scope.kind === "run"
                ? fact.runId === request.scope.id
                : fact.identity.assignments.some(
                    (a) => a.childRunId === request.scope.id,
                  );
          if (
            !fits ||
            canonicalJson(fact.identity.graph) !== canonicalJson(request.graph)
          )
            continue;
          const admitted = reader.files.readAdmission(
            fact.runId,
            fact.identity,
            budget,
          );
          if (!admitted.graph) throw new ContractError("corrupt-selected");
          traversal.assertCurrent();
          completion.validate();
          return decodeGraphPage({ request, graph: admitted.graph });
        }
      }
      const graph = materializeSavedGraph(saved, request, reader.files, budget);
      if (graph) {
        traversal.assertCurrent();
        completion.validate();
        return decodeGraphPage({ request, graph });
      }
      if (batch.pointer.seq === request.snapshotSeq)
        throw new ContractError("corrupt-selected");
      point.pos = batch.next;
      point.row = 0;
      point.event = 0;
    }
  } catch (error) {
    if (
      !(error instanceof ContractError) ||
      error.code !== "receipt-inconclusive"
    )
      throw error;
    if (coordinate() === before) noProgress(budget);
    traversal.assertCurrent();
    const next = {
      ...readIdentity(request),
      navigation: completion.seal(
        { purpose: "graph", request },
        Buffer.from(coordinate()),
      ),
    };
    const result = decodeGraphReadResult({
      kind: "progress",
      request,
      next,
      coverage: traversal.state.coverage,
    });
    if (
      Buffer.byteLength(JSON.stringify({ kind: "ok", value: result })) >
      LIMITS.pageBytes
    )
      throw new ContractError("oversize");
    return result;
  }
}
