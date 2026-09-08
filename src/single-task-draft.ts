import { DesignPlanValidationError } from "./design-diagnostics.ts";
import type {
  DraftVerification,
  PlanDraft,
  PlanTaskInput,
} from "./plan-draft.ts";

/** Small author input. Evidence, scope and the complete suite remain explicit. */
export interface SingleTaskDraft {
  changeId: string;
  changeContract?: PlanDraft["changeContract"];
  singleTask: {
    taskId: string;
    objective: string;
    context: PlanTaskInput["context"];
    roots: string[];
    read: string[];
    greenWrite: string[];
    redWrite?: string[];
    expectedFailure?: string;
    verificationMode?: "behavior" | "mechanical" | "refactor";
    verification: DraftVerification;
    fullSuite: DraftVerification;
    impactClosure: PlanTaskInput["impactClosure"];
    agents: PlanTaskInput["agents"];
    recovery?: { artifactAttempts: number; repairAttempts: number };
  };
}

function invalid(code: string, field = "singleTask"): never {
  throw new DesignPlanValidationError(code, [{ code, field }]);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Mechanical expansion only; the ordinary compiler validates all resulting fields. */
export function expandSingleTaskDraft(value: unknown): unknown {
  if (!record(value) || !Object.hasOwn(value, "singleTask")) return value;
  if (
    Object.keys(value).some(
      (key) => !["changeId", "changeContract", "singleTask"].includes(key),
    ) ||
    !record(value.singleTask)
  )
    invalid("single-task-draft-invalid");
  const input = value.singleTask;
  const required = [
    "taskId",
    "objective",
    "context",
    "roots",
    "read",
    "greenWrite",
    "verification",
    "fullSuite",
    "impactClosure",
    "agents",
  ];
  const optional = [
    "redWrite",
    "expectedFailure",
    "verificationMode",
    "recovery",
  ];
  if (
    required.some((key) => !Object.hasOwn(input, key)) ||
    Object.keys(input).some((key) => ![...required, ...optional].includes(key))
  )
    invalid("single-task-draft-invalid");
  const task = structuredClone(
    input,
  ) as unknown as SingleTaskDraft["singleTask"];
  const mode = task.verificationMode ?? "behavior";
  if (mode === "behavior" && (!task.redWrite?.length || !task.expectedFailure))
    invalid("single-task-red-required");
  if (
    mode !== "behavior" &&
    (task.redWrite !== undefined || task.expectedFailure !== undefined)
  )
    invalid("single-task-red-unexpected");
  if (
    Object.hasOwn(input, "recovery") &&
    (!record(task.recovery) ||
      !Object.hasOwn(task.recovery, "artifactAttempts") ||
      !Object.hasOwn(task.recovery, "repairAttempts") ||
      Object.keys(task.recovery).some(
        (key) => !["artifactAttempts", "repairAttempts"].includes(key),
      ))
  )
    invalid("single-task-recovery-invalid");
  return {
    changeId: value.changeId,
    ...(value.changeContract === undefined
      ? {}
      : { changeContract: value.changeContract }),
    tasks: [
      {
        taskId: task.taskId,
        objective: task.objective,
        context: task.context,
        roots: task.roots,
        read: task.read,
        dependsOn: [],
        verificationMode: mode,
        phases: {
          ...(mode === "behavior"
            ? {
                red: {
                  write: task.redWrite,
                  delete: [],
                  verification: {
                    ...task.verification,
                    expectedFailure: task.expectedFailure,
                  },
                },
              }
            : {}),
          green: {
            write: task.greenWrite,
            delete: [],
            verification: task.verification,
          },
        },
        affectedVerification: task.fullSuite,
        repairVerification: task.fullSuite,
        scheduling: { conflicts: [], resources: [] },
        agents: task.agents,
        approvedDependencies: [],
        impactClosure: task.impactClosure,
      },
    ],
    outputs: [],
    verification: {
      baseline: { fullSuite: task.fullSuite },
      change: { fullSuite: task.fullSuite, postApply: task.fullSuite },
      artifactCorrection: { maxAttempts: task.recovery?.artifactAttempts ?? 2 },
      repair: { maxAttempts: task.recovery?.repairAttempts ?? 1 },
    },
  };
}
