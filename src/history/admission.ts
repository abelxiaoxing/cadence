/** Immutable, secret-free allocation. This is history, never current authority. */
import { hash } from "../service/private-files.ts";
import {
  ContractError,
  canonicalJson,
  decodeGraph,
  decodeRunIdentity,
  type Graph,
  type RunIdentity,
} from "../service-contract.ts";
import { closed, decodeId, literal, nullable } from "../worker-public.mjs";

export interface RunAdmission {
  schema: "cadence-run-admission/2";
  runId: string;
  identity: RunIdentity;
  graph: Graph | null;
}
export function decodeRunAdmission(value: unknown): RunAdmission {
  const o = closed(value, ["schema", "runId", "identity", "graph"]);
  const result: RunAdmission = {
    schema: literal(o.schema, "cadence-run-admission/2"),
    runId: decodeId(o.runId),
    identity: decodeRunIdentity(o.identity),
    graph: nullable(o.graph, decodeGraph),
  };
  const { identity, graph } = result;
  if ((identity.kind === "start") !== (graph !== null))
    throw new ContractError("invalid");
  if (
    graph &&
    (graph.taskId !== identity.context.task?.id ||
      graph.taskKind !== identity.context.task.kind ||
      // Frozen saved plan may precede its own subsequent summary publications.
      // Current authority/lineage is checked by admission, never this historical decoder.
      graph.taskRevision > identity.context.task.revision ||
      graph.revision !== identity.graph?.revision ||
      hash(canonicalJson(graph)) !== identity.graph.sha256 ||
      canonicalJson(graph.assignments.map((a) => a.id)) !==
        canonicalJson(identity.assignments.map((a) => a.assignmentId)) ||
      graph.assignments.some(
        (a) => canonicalJson(a.model) !== canonicalJson(identity.context.model),
      ))
  )
    throw new ContractError("conflict");
  return result;
}
