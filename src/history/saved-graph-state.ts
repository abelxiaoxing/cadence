/** One selected saved graph; finite authenticated locators, not a graph in a cursor. */
import { hash } from "../service/private-files.ts";
import {
  ContractError,
  canonicalJson,
  type GraphReadRequest,
} from "../service-contract.ts";
import { bool, closed, decodeId, integer } from "../worker-public.mjs";
import { sourceAt } from "./entity-state.ts";
import type { HistoryFiles, HistoryReadBudget } from "./files.ts";
import type { LocatedBatch } from "./navigation.ts";
import { OperationState } from "./run-state.ts";
import {
  decodeSourceEvent,
  type SourceEvent,
  SourceRows,
} from "./source-row.ts";

export interface SavedGraphState {
  accepted: SourceEvent | null;
  publication: SourceEvent | null;
  settled: SourceEvent | null;
  detailId: string | null;
  bytes: number;
  ended: boolean;
}
export const freshSavedGraph = (): SavedGraphState => ({
  accepted: null,
  publication: null,
  settled: null,
  detailId: null,
  bytes: 0,
  ended: false,
});
export function decodeSavedGraphState(value: unknown): SavedGraphState {
  const o = closed(value, Object.keys(freshSavedGraph()));
  const at = (v: unknown) => (v === null ? null : decodeSourceEvent(v));
  return {
    accepted: at(o.accepted),
    publication: at(o.publication),
    settled: at(o.settled),
    detailId: o.detailId === null ? null : decodeId(o.detailId),
    bytes: integer(o.bytes, 0, 32768),
    ended: bool(o.ended),
  };
}
function bad(): never {
  throw new ContractError("corrupt-selected");
}
function accepted(state: SavedGraphState, sources: SourceRows) {
  if (!state.accepted) return null;
  const row = sources.read(state.accepted),
    v = row.value;
  if (
    v.kind !== "admission" ||
    v.intent.identity.kind !== "action" ||
    v.intent.identity.action.kind !== "save-plan" ||
    v.intent.runId !== null
  )
    bad();
  return { row, intent: v.intent, action: v.intent.identity.action };
}
export function collectSavedGraph(
  state: SavedGraphState,
  request: GraphReadRequest,
  batch: LocatedBatch,
  rowIndex: number,
  index: number,
  files: HistoryFiles,
  budget: HistoryReadBudget,
): void {
  if (request.scope.kind !== "task") return;
  const v = batch.rows[rowIndex].value;
  if (
    index === 0 &&
    v.kind === "admission" &&
    v.intent.operationId === request.graph.recordId
  ) {
    if (
      state.accepted ||
      v.intent.identity.kind !== "action" ||
      v.intent.identity.action.kind !== "save-plan"
    )
      bad();
    const a = v.intent.identity.action;
    if (
      a.taskId !== request.scope.id ||
      a.graph.revision !== request.graph.revision ||
      hash(canonicalJson(a.graph)) !== request.graph.sha256
    )
      bad();
    state.accepted = sourceAt(batch, rowIndex);
    return;
  }
  if (
    !state.accepted ||
    v.kind !== "owner" ||
    v.link.operationId !== request.graph.recordId
  )
    return;
  if (v.link.runId !== null || v.link.taskId !== request.scope.id) bad();
  const sources = new SourceRows(files, budget),
    a = accepted(state, sources);
  if (!a) bad();
  if (
    v.link.epoch !==
    (a.intent.identity.kind === "action"
      ? a.intent.identity.expected.epoch
      : "")
  )
    bad();
  const e = v.events[index];
  if (!e) return;
  if (
    e.kind === "owner" &&
    e.value.kind === "content-begin" &&
    e.value.field === "plan"
  ) {
    if (
      state.detailId ||
      e.value.owner.entity.kind !== "task" ||
      e.value.owner.entity.id !== request.scope.id ||
      e.value.owner.entity.version !== a.action.graph.planRevision
    )
      bad();
    state.detailId = e.value.detailId;
  }
  if (e.kind === "chunk" && e.detailId === state.detailId) {
    if (
      state.ended ||
      e.offset !== state.bytes ||
      state.bytes + e.length > Buffer.byteLength(a.action.plan)
    )
      bad();
    const bytes = files
      .readArtifact(e.artifact, budget)
      .subarray(e.start, e.start + e.length);
    if (
      !bytes.equals(
        Buffer.from(a.action.plan).subarray(
          state.bytes,
          state.bytes + e.length,
        ),
      )
    )
      bad();
    state.bytes += e.length;
  }
  if (e.kind === "end" && e.detail.detailId === state.detailId) {
    if (
      state.ended ||
      state.bytes !== Buffer.byteLength(a.action.plan) ||
      e.detail.origin.kind !== "owner" ||
      e.detail.origin.id !== request.graph.recordId ||
      canonicalJson(e.detail.content) !== canonicalJson(a.action.graph.plan)
    )
      bad();
    state.ended = true;
  }
  if (e.kind === "owner" && e.value.kind === "fact") {
    if (e.value.fact.kind === "publication-intent") {
      if (state.publication) bad();
      state.publication = sourceAt(batch, rowIndex, index);
    }
    if (e.value.fact.kind === "publication-settled") {
      if (state.settled) bad();
      state.settled = sourceAt(batch, rowIndex, index);
    }
  }
  sources.assertCurrent();
}
export function materializeSavedGraph(
  state: SavedGraphState,
  request: GraphReadRequest,
  files: HistoryFiles,
  budget: HistoryReadBudget,
) {
  if (!state.accepted || !state.publication || !state.settled || !state.ended)
    return null;
  const sources = new SourceRows(files, budget),
    a = accepted(state, sources);
  if (!a) bad();
  const operation = new OperationState(request.graph.recordId);
  operation.apply(a.row, state.accepted.seq);
  operation.apply(sources.read(state.publication), state.publication.seq);
  if (state.settled.sha256 !== state.publication.sha256)
    operation.apply(sources.read(state.settled), state.settled.seq);
  if (operation.receipt()?.receipt.publication !== "published") bad();
  sources.assertCurrent();
  return a.action.graph;
}
