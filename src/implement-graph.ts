import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical.ts";
import {
  type ImplementationPhase,
  type ImplementGraphBoundary,
  type ImplementGraphOutput,
  type ImplementGraphReadinessCode,
  type ImplementGraphReadinessDiagnostic,
  type ImplementTaskBoundary,
  type VerificationInputBinding,
  validateImplementGraphBoundary,
  verificationInputPaths,
} from "./contracts.ts";
import { isSafeRegularFile } from "./safe-path.ts";
import {
  type VerificationRunnerEnvironment,
  validateVerificationAdapterCapability,
} from "./verification-capability.ts";

export function hashCanonicalValue(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export interface ImplementExecutionFacts {
  completedTasks: readonly string[];
  blockedTasks?: readonly string[];
  appliedPhases?: ReadonlyArray<{
    taskId: string;
    phase: ImplementationPhase;
  }>;
  candidate?: { taskId: string; phase: ImplementationPhase };
  dependencyOwner?: string;
  verificationRunnerEnvironment?: VerificationRunnerEnvironment;
}

export interface ImplementPhaseReadiness {
  taskId: string;
  phase: ImplementationPhase;
  ready: boolean;
  completed?: true;
  diagnostics: ImplementGraphReadinessDiagnostic[];
}

export interface ImplementGraphReadiness {
  closure: {
    executable: boolean;
    diagnostics: ImplementGraphReadinessDiagnostic[];
  };
  phases: ImplementPhaseReadiness[];
  outputs: ImplementOutputReadiness[];
}

export interface ImplementOutputReadiness {
  outputId: string;
  producerTaskId: string;
  producerPhase: ImplementationPhase;
  status: "pending" | "available" | "unavailable";
  diagnostic?: ImplementGraphReadinessDiagnostic;
}

const IMPLEMENT_PHASE_INDEX: Record<ImplementationPhase, number> = {
  red: 0,
  green: 1,
  refactor: 2,
};

function graphDiagnostic(
  code: ImplementGraphReadinessCode,
  details: Omit<
    Extract<ImplementGraphReadinessDiagnostic, { kind: "graph-readiness" }>,
    "kind" | "code"
  > = {},
): ImplementGraphReadinessDiagnostic {
  return { kind: "graph-readiness", code, ...details };
}

function taskPhases(
  task: ImplementTaskBoundary,
): Array<[ImplementationPhase, ImplementTaskBoundary["phases"]["red"]]> {
  return [
    ...(!task.verificationMode || task.verificationMode === "behavior"
      ? [
          ["red", task.phases.red] as [
            ImplementationPhase,
            ImplementTaskBoundary["phases"]["red"],
          ],
        ]
      : []),
    ["green", task.phases.green],
    ...(task.phases.refactor
      ? ([["refactor", task.phases.refactor]] as Array<
          [ImplementationPhase, ImplementTaskBoundary["phases"]["red"]]
        >)
      : []),
  ];
}

function withinTaskRoots(
  task: ImplementTaskBoundary,
  candidate: string,
): boolean {
  return task.roots.some(
    (root) =>
      root === "." || candidate === root || candidate.startsWith(`${root}/`),
  );
}

function dependencyAncestors(
  taskId: string,
  tasks: ReadonlyMap<string, ImplementTaskBoundary>,
): Set<string> {
  const ancestors = new Set<string>();
  const pending = [...(tasks.get(taskId)?.dependsOn ?? [])];
  while (pending.length > 0) {
    const dependency = pending.pop() as string;
    if (ancestors.has(dependency)) continue;
    ancestors.add(dependency);
    pending.push(...(tasks.get(dependency)?.dependsOn ?? []));
  }
  return ancestors;
}

function bindingPath(
  binding: VerificationInputBinding,
  outputs: ReadonlyMap<string, ImplementGraphOutput>,
): string | undefined {
  return binding.kind === "workspace"
    ? binding.path
    : outputs.get(binding.outputId)?.path;
}

function sameStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length && left.every((entry) => right.includes(entry))
  );
}

function appendDistinct(
  diagnostics: ImplementGraphReadinessDiagnostic[],
  diagnostic: ImplementGraphReadinessDiagnostic,
): void {
  if (
    !diagnostics.some(
      (candidate) => JSON.stringify(candidate) === JSON.stringify(diagnostic),
    )
  ) {
    diagnostics.push(diagnostic);
  }
}

export function assessImplementGraphReadiness(
  root: string,
  value: unknown,
  facts: ImplementExecutionFacts,
): ImplementGraphReadiness {
  const validation = validateImplementGraphBoundary(value);
  if (!validation.ok) {
    const diagnostic = graphDiagnostic(validation.diagnostic.code, {
      ...(validation.diagnostic.code === "invalid-output-path" &&
      validation.diagnostic.outputId
        ? { outputId: validation.diagnostic.outputId }
        : {}),
    });
    return {
      closure: { executable: false, diagnostics: [diagnostic] },
      phases: [],
      outputs: [],
    };
  }

  const graph: ImplementGraphBoundary = validation.value;
  const diagnostics: ImplementGraphReadinessDiagnostic[] = [];
  const tasks = new Map<string, ImplementTaskBoundary>();
  for (const task of graph.tasks) {
    if (tasks.has(task.taskId)) {
      diagnostics.push(
        graphDiagnostic("duplicate-task-id", { taskId: task.taskId }),
      );
    } else {
      tasks.set(task.taskId, task);
    }
  }

  for (const task of graph.tasks) {
    for (const dependencyTaskId of task.dependsOn) {
      if (!tasks.has(dependencyTaskId) || dependencyTaskId === task.taskId) {
        diagnostics.push(
          graphDiagnostic("unknown-dependency", {
            taskId: task.taskId,
            dependencyTaskId,
          }),
        );
      }
    }
    if (dependencyAncestors(task.taskId, tasks).has(task.taskId)) {
      diagnostics.push(
        graphDiagnostic("dependency-cycle", { taskId: task.taskId }),
      );
    }
  }

  const outputs = new Map<string, ImplementGraphOutput>();
  const outputPaths = new Map<string, ImplementGraphOutput>();
  for (const output of graph.outputs) {
    if (outputs.has(output.id)) {
      diagnostics.push(
        graphDiagnostic("duplicate-output-id", { outputId: output.id }),
      );
    } else {
      outputs.set(output.id, output);
    }
    const prior = outputPaths.get(output.path);
    if (prior) {
      diagnostics.push(
        graphDiagnostic("multiple-output-producers", {
          outputId: output.id,
          path: output.path,
          producerTaskId: output.producer.taskId,
          producerPhase: output.producer.phase,
        }),
      );
    } else {
      outputPaths.set(output.path, output);
    }

    const producer = tasks.get(output.producer.taskId);
    const producerPhase = producer?.phases[output.producer.phase];
    if (
      !producer ||
      !producerPhase ||
      !withinTaskRoots(producer, output.path)
    ) {
      diagnostics.push(
        graphDiagnostic("output-producer-invalid", {
          outputId: output.id,
          producerTaskId: output.producer.taskId,
          producerPhase: output.producer.phase,
        }),
      );
    } else if (!producerPhase.write.includes(output.path)) {
      diagnostics.push(
        graphDiagnostic("output-write-not-approved", {
          outputId: output.id,
          producerTaskId: output.producer.taskId,
          producerPhase: output.producer.phase,
        }),
      );
    }
  }

  const phaseStaticDiagnostics = new Map<
    string,
    ImplementGraphReadinessDiagnostic[]
  >();
  for (const task of graph.tasks) {
    const ancestors = dependencyAncestors(task.taskId, tasks);
    for (const [phase, boundary] of taskPhases(task)) {
      const key = `${task.taskId}\0${phase}`;
      const current: ImplementGraphReadinessDiagnostic[] = [];
      phaseStaticDiagnostics.set(key, current);
      const verificationId = boundary.verification.id;
      const requiredPaths = verificationInputPaths(boundary.verification);
      const boundPaths = boundary.verificationInputs
        .map((binding) => bindingPath(binding, outputs))
        .filter((entry): entry is string => entry !== undefined);

      for (const binding of boundary.verificationInputs) {
        if (binding.kind === "workspace") {
          const graphOutput = outputPaths.get(binding.path);
          if (graphOutput) {
            appendDistinct(
              current,
              graphDiagnostic("workspace-input-has-producer", {
                taskId: task.taskId,
                phase,
                verificationId,
                outputId: graphOutput.id,
                path: binding.path,
              }),
            );
          }
          if (!isSafeRegularFile(root, binding.path)) {
            appendDistinct(
              current,
              graphDiagnostic("workspace-input-unavailable", {
                taskId: task.taskId,
                phase,
                verificationId,
                path: binding.path,
              }),
            );
          }
          continue;
        }

        const output = outputs.get(binding.outputId);
        if (!output) {
          appendDistinct(
            current,
            graphDiagnostic("output-not-declared", {
              taskId: task.taskId,
              phase,
              verificationId,
              outputId: binding.outputId,
            }),
          );
          continue;
        }
        if (output.producer.taskId === task.taskId) {
          if (
            IMPLEMENT_PHASE_INDEX[output.producer.phase] >
            IMPLEMENT_PHASE_INDEX[phase]
          ) {
            appendDistinct(
              current,
              graphDiagnostic("producer-phase-after-consumer", {
                taskId: task.taskId,
                phase,
                verificationId,
                outputId: output.id,
                producerTaskId: output.producer.taskId,
                producerPhase: output.producer.phase,
              }),
            );
          }
        } else if (!ancestors.has(output.producer.taskId)) {
          appendDistinct(
            current,
            graphDiagnostic("producer-not-dependency", {
              taskId: task.taskId,
              phase,
              verificationId,
              outputId: output.id,
              producerTaskId: output.producer.taskId,
              producerPhase: output.producer.phase,
            }),
          );
        }
      }

      if (!sameStringSet(requiredPaths, boundPaths)) {
        appendDistinct(
          current,
          graphDiagnostic("verification-input-binding-mismatch", {
            taskId: task.taskId,
            phase,
            verificationId,
            field: `phases.${phase}.verificationInputs`,
            expectedPaths: [...requiredPaths].sort(),
            actualPaths: [...boundPaths].sort(),
          }),
        );
      }

      const capability = validateVerificationAdapterCapability(
        root,
        boundary.verification,
        {
          dependencyOwner: facts.dependencyOwner ?? root,
          runnerEnvironment: facts.verificationRunnerEnvironment,
        },
      );
      if (!capability.ok) {
        const { message: _message, ...diagnostic } = capability.diagnostic;
        appendDistinct(current, {
          ...diagnostic,
          taskId: task.taskId,
          phase,
        });
      }
      diagnostics.push(...current);
    }
  }

  const closure = {
    executable: diagnostics.length === 0,
    diagnostics,
  };
  const completedTasks = new Set(facts.completedTasks);
  const blockedTasks = new Set(facts.blockedTasks ?? []);
  const appliedPhases = new Set(
    (facts.appliedPhases ?? []).map(
      (entry) => `${entry.taskId}\0${entry.phase}`,
    ),
  );
  const outputReadiness: ImplementOutputReadiness[] = graph.outputs.map(
    (output) => {
      const observed =
        completedTasks.has(output.producer.taskId) ||
        appliedPhases.has(
          `${output.producer.taskId}\0${output.producer.phase}`,
        ) ||
        (facts.candidate?.taskId === output.producer.taskId &&
          facts.candidate.phase === output.producer.phase);
      if (!observed) {
        return {
          outputId: output.id,
          producerTaskId: output.producer.taskId,
          producerPhase: output.producer.phase,
          status: "pending" as const,
        };
      }
      if (isSafeRegularFile(root, output.path)) {
        return {
          outputId: output.id,
          producerTaskId: output.producer.taskId,
          producerPhase: output.producer.phase,
          status: "available" as const,
        };
      }
      return {
        outputId: output.id,
        producerTaskId: output.producer.taskId,
        producerPhase: output.producer.phase,
        status: "unavailable" as const,
        diagnostic: graphDiagnostic("producer-output-unavailable", {
          outputId: output.id,
          producerTaskId: output.producer.taskId,
          producerPhase: output.producer.phase,
        }),
      };
    },
  );
  const outputStatus = new Map(
    outputReadiness.map((entry) => [entry.outputId, entry]),
  );
  const phases: ImplementPhaseReadiness[] = [];

  for (const task of graph.tasks) {
    for (const [phase, boundary] of taskPhases(task)) {
      const staticDiagnostics = phaseStaticDiagnostics.get(
        `${task.taskId}\0${phase}`,
      ) as ImplementGraphReadinessDiagnostic[];
      if (!closure.executable) {
        phases.push({
          taskId: task.taskId,
          phase,
          ready: false,
          diagnostics:
            staticDiagnostics.length > 0 ? staticDiagnostics : diagnostics,
        });
        continue;
      }
      if (completedTasks.has(task.taskId)) {
        phases.push({
          taskId: task.taskId,
          phase,
          ready: false,
          completed: true,
          diagnostics: [],
        });
        continue;
      }

      const current: ImplementGraphReadinessDiagnostic[] = [];
      if (blockedTasks.has(task.taskId)) {
        current.push(
          graphDiagnostic("dependency-blocked", {
            taskId: task.taskId,
            phase,
            dependencyTaskId: task.taskId,
          }),
        );
      }
      for (const dependencyTaskId of task.dependsOn) {
        if (!completedTasks.has(dependencyTaskId)) {
          appendDistinct(
            current,
            graphDiagnostic("dependency-blocked", {
              taskId: task.taskId,
              phase,
              dependencyTaskId,
            }),
          );
        }
      }

      const earlierPhases = taskPhases(task)
        .map(([candidate]) => candidate)
        .filter(
          (candidate) =>
            IMPLEMENT_PHASE_INDEX[candidate] < IMPLEMENT_PHASE_INDEX[phase],
        );
      if (
        earlierPhases.some(
          (candidate) => !appliedPhases.has(`${task.taskId}\0${candidate}`),
        )
      ) {
        appendDistinct(
          current,
          graphDiagnostic("phase-blocked", { taskId: task.taskId, phase }),
        );
      }

      if (current.length === 0) {
        for (const binding of boundary.verificationInputs) {
          if (binding.kind !== "output") continue;
          const output = outputs.get(binding.outputId);
          if (!output) continue;
          const sameTask = output.producer.taskId === task.taskId;
          const samePhase = sameTask && output.producer.phase === phase;
          const readiness = outputStatus.get(output.id);
          const published =
            !sameTask && completedTasks.has(output.producer.taskId);
          if (readiness?.status === "unavailable") {
            appendDistinct(
              current,
              graphDiagnostic("producer-output-unavailable", {
                taskId: task.taskId,
                phase,
                outputId: output.id,
                producerTaskId: output.producer.taskId,
                producerPhase: output.producer.phase,
              }),
            );
          } else if (
            (!sameTask && !published) ||
            (sameTask && !samePhase && readiness?.status !== "available")
          ) {
            appendDistinct(
              current,
              sameTask
                ? graphDiagnostic("phase-blocked", {
                    taskId: task.taskId,
                    phase,
                  })
                : graphDiagnostic("dependency-blocked", {
                    taskId: task.taskId,
                    phase,
                    dependencyTaskId: output.producer.taskId,
                  }),
            );
          }
        }

        if (
          facts.candidate?.taskId === task.taskId &&
          facts.candidate.phase === phase
        ) {
          for (const output of graph.outputs.filter(
            (entry) =>
              entry.producer.taskId === task.taskId &&
              entry.producer.phase === phase,
          )) {
            if (outputStatus.get(output.id)?.status !== "available") {
              appendDistinct(
                current,
                graphDiagnostic("producer-output-unavailable", {
                  taskId: task.taskId,
                  phase,
                  outputId: output.id,
                  producerTaskId: output.producer.taskId,
                  producerPhase: output.producer.phase,
                }),
              );
            }
          }
        }
      }

      phases.push({
        taskId: task.taskId,
        phase,
        ready: current.length === 0,
        diagnostics: current,
      });
    }
  }

  return { closure, phases, outputs: outputReadiness };
}

export { canonicalJson } from "./canonical.ts";
