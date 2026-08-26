import type {
  ImplementGraphBoundary,
  ImplementRunRequest,
  PhaseAttempt,
  TaskBoundary,
} from "../../src/contracts.ts";
import { hashImplementGraphBoundary } from "../../src/implement-graph.ts";
import type { DispatchResult, Runtime } from "../../src/runtime.ts";

export interface ImplementTaskFixture {
  boundary: TaskBoundary;
  attempt: PhaseAttempt;
}

export function assertCandidateOutcome(
  outcome: DispatchResult,
): asserts outcome is Extract<DispatchResult, { kind: "candidate" }> {
  if (!("kind" in outcome) || outcome.kind !== "candidate") {
    throw new Error("run did not return an Implement candidate");
  }
}

export function graphFor(
  fixtures: readonly ImplementTaskFixture[],
): ImplementGraphBoundary {
  const changeId = fixtures[0]?.boundary.changeId;
  if (
    !changeId ||
    fixtures.some((entry) => entry.boundary.changeId !== changeId)
  ) {
    throw new Error("fixtures must share one change");
  }
  return {
    changeId,
    tasks: fixtures.map(({ boundary }) => {
      const { changeId: _changeId, ...task } = structuredClone(boundary);
      return task;
    }),
    outputs: [],
  };
}

export function graphAdmissionFor(
  fixtures: readonly ImplementTaskFixture[],
  state: { completedTasks?: string[]; blockedTasks?: string[] } = {},
): Extract<ImplementRunRequest, { kind: "admit-graph" }> {
  const graph = graphFor(fixtures);
  return {
    stage: "abel-implement",
    kind: "admit-graph",
    graph,
    graphHash: hashImplementGraphBoundary(graph),
    state: {
      completedTasks: state.completedTasks ?? [],
      blockedTasks: state.blockedTasks ?? [],
    },
  };
}

export function taskAttemptFor(
  fixture: ImplementTaskFixture,
): Extract<ImplementRunRequest, { kind: "task-attempt" }> {
  return {
    stage: "abel-implement",
    kind: "task-attempt",
    attempt: structuredClone(fixture.attempt),
  };
}

export async function admitGraph(
  runtime: Runtime,
  fixtures: readonly ImplementTaskFixture[],
  context: Parameters<Runtime["execute"]>[2],
) {
  return runtime.execute(
    "run",
    { request: graphAdmissionFor(fixtures) },
    context,
  );
}
