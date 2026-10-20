/** Reviewed graph -> exact public request. No auth, persistence or SDK side effects. */
import { createHash } from "node:crypto";
import { join } from "node:path";
import { loadAgentDefinitions } from "../agent-registry.ts";
import type { HistoryReader } from "../history/reader.ts";
import { readRunState } from "../history/run-state.ts";
import {
  type Assignment,
  ContractError,
  canonicalJson,
  type DependencyHandoff,
  decodeGraph,
  decodeHandoff,
  decodeWorkerPublicRequest,
  type Graph,
  LIMITS,
  type ModelSelection,
  type ObservationFact,
  type RunIdentity,
  roleForPurpose,
  type WorkerPublicRequest,
} from "../service-contract.ts";
import { readBounded } from "../task-store.ts";
import type { TaskRecord } from "../task-types.ts";

const hash = (text: string | Buffer) =>
  createHash("sha256").update(text).digest("hex");
export class GraphContext {
  readonly roles = loadAgentDefinitions();
  readonly hints: string;
  readonly identity: string;
  constructor(readonly root: string) {
    const bytes = readBounded(join(root, "AGENTS.md"), 32768);
    this.hints = bytes
      ? new TextDecoder("utf-8", { fatal: true }).decode(bytes)
      : "";
    this.identity = hash(
      canonicalJson({
        hints: bytes === undefined ? null : hash(bytes),
        roles: this.roles.map((r) => ({ role: r.role, sha256: r.sha256 })),
      }),
    );
  }
  current(): boolean {
    try {
      return new GraphContext(this.root).identity === this.identity;
    } catch {
      return false;
    }
  }
  validate(graph: Graph, model: ModelSelection): Graph {
    const value = decodeGraph(graph);
    for (const assignment of value.assignments) {
      const selected = this.roles.find(
        (r) => r.role === roleForPurpose(assignment.purpose),
      );
      if (
        !selected ||
        selected.sha256 !== assignment.role.sha256 ||
        canonicalJson(assignment.model) !== canonicalJson(model)
      )
        throw new ContractError("stale");
    }
    return value;
  }
  /** Fixed readonly planner, not the saved execution graph or model-generated authority. */
  planningAssignment(model: ModelSelection): Assignment {
    const role = this.roles.find((r) => r.role === "design-explorer");
    if (!role) throw new ContractError("unavailable");
    return {
      id: "plan",
      purpose: "research",
      role: { role: "design-explorer", sha256: role.sha256 },
      model: structuredClone(model),
      instructions:
        "Research the goal without editing. Propose a readable implementation plan with at most 16 assignments, their purposes, dependencies, expected outputs and checks. Treat the existing plan only as context. Do not execute it. Your output is advisory: a human must explicitly edit/accept and save a plan, then separately Start.",
      expectedOutput:
        "A readable advisory plan, with finite decomposition and remaining uncertainties; not an execution instruction or passing check.",
      dependencies: [],
    };
  }
  planningRequest(
    task: TaskRecord,
    model: ModelSelection,
    runId: string,
    childRunId: string,
  ): WorkerPublicRequest {
    return this.publicRequest(
      task,
      runId,
      childRunId,
      this.planningAssignment(model),
      // The wire requires a positive handoff version even with no inputs. This
      // is not a graph reference: Generate's durable admission graph stays null.
      { graphRevision: 1, inputs: [] },
    );
  }
  request(
    task: TaskRecord,
    graph: Graph,
    runId: string,
    childRunId: string,
    assignment: Assignment,
    handoff: DependencyHandoff,
  ): WorkerPublicRequest {
    this.validate(graph, assignment.model);
    return this.publicRequest(task, runId, childRunId, assignment, handoff);
  }
  private publicRequest(
    task: TaskRecord,
    runId: string,
    childRunId: string,
    assignment: Assignment,
    handoff: DependencyHandoff,
  ): WorkerPublicRequest {
    const role = this.roles.find((r) => r.role === assignment.role.role);
    if (!role) throw new ContractError("stale");
    // Each reviewed body occurs once; the worker renders handoff separately.
    return decodeWorkerPublicRequest({
      protocol: 2,
      taskId: task.id,
      taskKind: task.kind,
      runId,
      childRunId,
      assignmentId: assignment.id,
      purpose: assignment.purpose,
      model: assignment.model,
      role: assignment.role,
      instructions: `${role.content}\nDo not delegate, retry, install, publish or mutate Git. Worker completion is not a parent check.`,
      context: task.plan,
      prompt: canonicalJson(
        {
          goal: task.goal,
          assignment: assignment.instructions,
          expectedOutput: assignment.expectedOutput,
          untrustedProjectConventions: this.hints,
        },
        32768,
      ),
      handoff,
    });
  }
}

/** Exact selected committed bytes, not preview/prose. W3 independently rejoins every input. */
export function dependencyHandoff(
  reader: HistoryReader,
  graph: Graph,
  identity: RunIdentity,
  runId: string,
  assignment: Assignment,
  snapshot: string,
  observation: ObservationFact,
  currentAfter: ReadonlyMap<string, ObservationFact>,
): DependencyHandoff {
  let total = 0;
  const inputs = assignment.dependencies.map((edge, dependencyIndex) => {
    const sourceRun =
      edge.source.kind === "current" ? runId : edge.source.runId;
    const childRunId =
      edge.source.kind === "current"
        ? identity.assignments.find(
            (a) =>
              a.assignmentId ===
              (edge.source.kind === "current" ? edge.source.assignmentId : ""),
          )?.childRunId
        : edge.source.childRunId;
    if (!childRunId) throw new ContractError("stale");
    const source = readRunState(reader.files, sourceRun, snapshot);
    const child = source.children.get(childRunId);
    const recording = child?.completion?.recording;
    if (
      !child?.settlementSeq ||
      child.completion?.native.outcome !== "completed" ||
      child.completion.native.closure !== "direct-child-closed" ||
      recording?.status !== "committed"
    )
      throw new ContractError("stale");
    if (edge.source.kind === "current") {
      const after = currentAfter.get(childRunId);
      if (!after || canonicalJson(after) !== canonicalJson(observation))
        throw new ContractError("stale");
    } else if (
      canonicalJson(edge.source.result) !==
      canonicalJson(recording.detail.content)
    )
      throw new ContractError("stale");
    if (edge.requireCompleteObservation && !observation.complete)
      throw new ContractError("stale");
    const result = recording.detail.content;
    const range = edge.range ?? { start: 0, end: result.bytes };
    const size = range.end - range.start;
    if (
      range.end > result.bytes ||
      size > LIMITS.predecessorBytes ||
      total + size > LIMITS.handoffBytes
    )
      throw new ContractError("oversize");
    total += size; // before selected byte copies
    const detail = reader.selected({
      storeId: reader.storeId,
      scope: { kind: "child", id: childRunId },
      snapshotSeq: snapshot,
      recordId: result.recordId,
      recordVersion: result.version,
      field: result.field,
      query: null,
      offset: 0,
    });
    if (canonicalJson(detail.content) !== canonicalJson(result))
      throw new ContractError("corrupt-selected");
    const chunks: Buffer[] = [];
    for (const part of reader.parts(detail, snapshot)) {
      const start = Math.max(0, range.start - part.offset),
        end = Math.min(part.bytes.length, range.end - part.offset);
      if (end > start)
        chunks.push(Buffer.from(part.bytes.subarray(start, end)));
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks),
    );
    if (Buffer.byteLength(text) !== size)
      throw new ContractError("corrupt-selected");
    return {
      assignmentId: assignment.id,
      dependencyIndex,
      runId: sourceRun,
      childRunId,
      result,
      range: edge.range,
      text,
      coverage: detail.coverage,
    };
  });
  return decodeHandoff({ graphRevision: graph.revision, inputs });
}
