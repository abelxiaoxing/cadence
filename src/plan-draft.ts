import { createHash } from "node:crypto";
import { canonicalJson, compareCanonicalStrings } from "./canonical.ts";
import type { ChangeContract } from "./change-contract.ts";
import {
  type AtomicVerificationContract,
  type ImplementGraphOutput,
  isValidRelativePath,
  type PhaseBoundary,
  type StructuredVerificationContract,
  validateVerificationContract,
  verificationInputPaths,
} from "./contracts.ts";
import {
  type DesignPlanDiagnostic,
  DesignPlanValidationError,
} from "./design-diagnostics.ts";
import type {
  PlanTaskDraft,
  PlanTracking,
  PlanVerification,
} from "./implement-plan.ts";

type DraftCommand<T> = T extends { kind: "package-script" }
  ? Omit<T, "command"> & { command?: string }
  : T;
type DraftRunner<T> = T extends { runner: infer R }
  ? Omit<T, "runner"> & { runner: DraftCommand<R> }
  : DraftCommand<T>;
type Template<T> = T extends AtomicVerificationContract
  ? DraftRunner<
      Omit<T, "id" | "classification" | "expectedFailure" | "executionBindings">
    >
  : never;
export type VerificationDefinition = Template<AtomicVerificationContract>;
export type DraftVerification =
  | StructuredVerificationContract
  | (VerificationDefinition & {
      id?: string;
      classification?: StructuredVerificationContract["classification"];
      expectedFailure?: string;
    })
  | { use: string; expectedFailure?: string };
export type PlanPhaseDraft = Omit<
  PhaseBoundary,
  "verificationInputs" | "read" | "verification"
> & {
  read?: string[];
  verification: DraftVerification;
  verificationInputs?: PhaseBoundary["verificationInputs"];
};
export interface PlanTaskInput
  extends Omit<
    PlanTaskDraft,
    | "phases"
    | "impactClosure"
    | "baselineVerification"
    | "affectedVerification"
    | "repairVerification"
    | "agents"
  > {
  read?: string[];
  phases: {
    red?: PlanPhaseDraft;
    green: PlanPhaseDraft;
    refactor?: PlanPhaseDraft;
  };
  affectedVerification: DraftVerification;
  baselineVerification?: DraftVerification;
  repairVerification: DraftVerification;
  agents: Omit<PlanTaskDraft["agents"], "managedOnly"> & { managedOnly?: true };
  impactClosure: Omit<PlanTaskDraft["impactClosure"], "relatedTests"> & {
    relatedTests: Array<
      Omit<
        PlanTaskDraft["impactClosure"]["relatedTests"][number],
        "disposition"
      > & {
        disposition?: PlanTaskDraft["impactClosure"]["relatedTests"][number]["disposition"];
      }
    >;
  };
}
export interface PlanVerificationInput {
  baseline: Partial<Omit<PlanVerification["baseline"], "fullSuite">> & {
    fullSuite: DraftVerification;
  };
  change: Partial<Pick<PlanVerification["change"], "affected">> & {
    fullSuite: DraftVerification;
    postApply: DraftVerification;
  };
  artifactCorrection: PlanVerification["artifactCorrection"];
  repair: Pick<PlanVerification["repair"], "maxAttempts"> &
    Partial<Omit<PlanVerification["repair"], "maxAttempts">>;
  agentsCheckpoint?: Omit<
    PlanVerification["agentsCheckpoint"],
    "verification"
  > & { verification: DraftVerification | null };
}
/** Authoring only. The sealed plan does not inherit this interface. */
export interface PlanDraft {
  changeContract?: ChangeContract;
  changeId: string;
  tasks: PlanTaskInput[];
  outputs: ImplementGraphOutput[];
  verification: PlanVerificationInput;
  tracking?: PlanTracking;
  verificationDefinitions?: Record<string, VerificationDefinition>;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;

/** Expand finite, local syntax only. All authority and executable validation stays strict. */
export function expandPlanDraft(value: unknown): unknown {
  if (
    !isRecord(value) ||
    !Array.isArray(value.tasks) ||
    value.tasks.length > 128
  )
    return value;
  const draft = structuredClone(value);
  const diagnostics: DesignPlanDiagnostic[] = [];
  const definitions = new Map<string, Record<string, unknown>>();
  const source = draft.verificationDefinitions;
  if (source !== undefined) {
    if (!isRecord(source) || Object.keys(source).length > 512) {
      throw new DesignPlanValidationError("verification-definition-invalid", [
        {
          code: "verification-definition-invalid",
          field: "verificationDefinitions",
        },
      ]);
    }
    for (const [name, definition] of Object.entries(source)) {
      const validated =
        isRecord(definition) &&
        ID.test(name) &&
        ![
          "id",
          "classification",
          "expectedFailure",
          "executionBindings",
          "use",
          "steps",
        ].some((key) => Object.hasOwn(definition, key)) &&
        validateVerificationContract({
          ...definition,
          id: "definition",
          classification: "expected-green",
        }).ok;
      if (!validated)
        diagnostics.push({
          code: "verification-definition-invalid",
          field: "verificationDefinitions",
        });
      else definitions.set(name, definition as Record<string, unknown>);
    }
    delete draft.verificationDefinitions;
  }
  const generated = new Set<string>();
  const authored = new Set<string>();
  const collect = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(collect);
    else if (isRecord(node)) {
      if (
        ["vitest", "static-check", "package-script", "steps"].includes(
          String(node.kind),
        ) &&
        typeof node.id === "string"
      )
        authored.add(node.id);
      Object.entries(node)
        .filter(([key]) => key !== "changeContract")
        .forEach(([, item]) => {
          collect(item);
        });
    }
  };
  collect(draft);
  const expand = (
    node: unknown,
    field: string,
    classification: "expected-red" | "expected-green" | "expected-refactor",
    taskId?: string,
  ): unknown => {
    if (!isRecord(node)) return node;
    if (!Object.hasOwn(node, "use")) {
      if (
        !["vitest", "package-script", "static-check"].includes(
          String(node.kind),
        )
      )
        return node;
      if (Object.hasOwn(node, "id") && Object.hasOwn(node, "classification"))
        return node;
      const command = structuredClone(node);
      delete command.id;
      delete command.classification;
      delete command.executionBindings;
      if (command.kind === "vitest" && Array.isArray(command.testFiles))
        command.testFiles = [...command.testFiles].sort(
          compareCanonicalStrings,
        );
      const id = `verify-${createHash("sha256")
        .update(
          canonicalJson([
            "cadence-verifier-v1",
            draft.changeId,
            taskId ?? null,
            field,
            command,
            classification,
          ]),
        )
        .digest("hex")}`;
      if (!Object.hasOwn(node, "id")) {
        if (generated.has(id) || authored.has(id))
          diagnostics.push({
            code: "verification-identity-collision",
            field,
            taskId,
          });
        generated.add(id);
      }
      return { id, classification, ...node };
    }
    if (
      Object.keys(node).some(
        (key) => !["use", "expectedFailure"].includes(key),
      ) ||
      typeof node.use !== "string" ||
      !ID.test(node.use)
    ) {
      diagnostics.push({
        code: "verification-reference-invalid",
        field,
        taskId,
      });
      return node;
    }
    const definition = definitions.get(node.use);
    if (!definition) {
      diagnostics.push({
        code: "verification-reference-unavailable",
        field,
        taskId,
      });
      return node;
    }
    const command = structuredClone(definition);
    if (command.kind === "vitest" && Array.isArray(command.testFiles))
      command.testFiles = [...command.testFiles].sort(compareCanonicalStrings);
    if (Object.hasOwn(node, "expectedFailure"))
      command.expectedFailure = node.expectedFailure;
    const id = `verify-${createHash("sha256")
      .update(
        canonicalJson([
          "cadence-verifier-v1",
          draft.changeId,
          taskId ?? null,
          field,
          command,
          classification,
        ]),
      )
      .digest("hex")}`;
    if (generated.has(id) || authored.has(id))
      diagnostics.push({
        code: "verification-identity-collision",
        field,
        taskId,
      });
    generated.add(id);
    return {
      ...command,
      id,
      classification,
      ...(Object.hasOwn(node, "expectedFailure")
        ? { expectedFailure: node.expectedFailure }
        : {}),
    };
  };
  const defaults = (node: unknown, fields: Record<string, unknown>) => {
    if (isRecord(node))
      for (const [key, value] of Object.entries(fields))
        if (!Object.hasOwn(node, key)) node[key] = value;
  };
  const tasks = draft.tasks as unknown[];
  for (const task of tasks) {
    if (!isRecord(task)) continue;
    const taskId = typeof task.taskId === "string" ? task.taskId : undefined;
    const common = task.read;
    if (Object.hasOwn(task, "read")) {
      if (!Array.isArray(common) || !common.every(isValidRelativePath))
        diagnostics.push({
          code: "draft-common-read-invalid",
          field: "read",
          taskId,
        });
      delete task.read;
    }
    defaults(task.agents, { managedOnly: true });
    if (isRecord(task.phases))
      for (const [name, phase] of Object.entries(task.phases)) {
        if (!isRecord(phase)) continue;
        if (Array.isArray(common) && common.every(isValidRelativePath)) {
          if (phase.read === undefined) phase.read = [...common];
          else if (Array.isArray(phase.read))
            phase.read = [...new Set([...common, ...phase.read])];
        }
        const classification =
          name === "refactor"
            ? "expected-refactor"
            : name === "red" &&
                !["mechanical", "refactor"].includes(
                  String(task.verificationMode),
                )
              ? "expected-red"
              : "expected-green";
        phase.verification = expand(
          phase.verification,
          `phases.${name}.verification`,
          classification,
          taskId,
        );
      }
    for (const field of ["affectedVerification", "repairVerification"])
      task[field] = expand(task[field], field, "expected-green", taskId);
    if (task.baselineVerification !== undefined)
      task.baselineVerification = expand(
        task.baselineVerification,
        "baselineVerification",
        "expected-green",
        taskId,
      );
  }
  if (isRecord(draft.verification)) {
    const verification = draft.verification;
    defaults(verification.baseline, {
      target: "task-red-contracts",
      affected: "task-affected-contracts",
      failureIdentity: "normalized",
    });
    defaults(verification.change, { affected: "task-affected-contracts" });
    defaults(verification.repair, {
      inBoundaryOnly: true,
      approvalOnBoundaryExpansion: true,
      attribution: ["pre-existing", "introduced", "unresolved", "environment"],
    });
    if (
      !Object.hasOwn(verification, "agentsCheckpoint") &&
      tasks.every(
        (task) =>
          isRecord(task) &&
          isRecord(task.agents) &&
          task.agents.impact === "none",
      )
    ) {
      verification.agentsCheckpoint = {
        required: false,
        verification: null,
        operations: [],
      };
    }
    for (const [group, fields] of [
      ["baseline", ["fullSuite"]],
      ["change", ["fullSuite", "postApply"]],
      ["agentsCheckpoint", ["verification"]],
    ] as const) {
      const block = verification[group];
      if (isRecord(block))
        for (const field of fields)
          block[field] = expand(
            block[field],
            `verification.${group}.${field}`,
            "expected-green",
          );
    }
  }
  if (diagnostics.length)
    throw new DesignPlanValidationError(
      "design-plan-expansion-invalid",
      diagnostics,
    );
  return JSON.stringify(draft) === JSON.stringify(value) ? value : draft;
}
/** Derive only omitted fields; the strict normalizer and graph still own admission. */
export function preparePlanDraft(value: unknown): unknown {
  if (
    !isRecord(value) ||
    !Array.isArray(value.tasks) ||
    value.tasks.length > 128 ||
    !Array.isArray(value.outputs) ||
    value.outputs.length > 512
  )
    return value;
  const draft = structuredClone(value);
  let changed = false;
  const tasks = (draft.tasks as unknown[]).filter(isRecord);
  const outputs = (draft.outputs as unknown[]).filter(isRecord);
  const diagnostics: DesignPlanDiagnostic[] = [];
  const writes = (task: Record<string, unknown>): Set<string> => {
    const paths = new Set<string>();
    if (!isRecord(task.phases)) return paths;
    for (const [phase, boundary] of Object.entries(task.phases)) {
      if (!isRecord(boundary)) continue;
      if (
        phase === "red" &&
        ["mechanical", "refactor"].includes(String(task.verificationMode))
      )
        continue;
      for (const candidates of [boundary.write, boundary.delete]) {
        if (!Array.isArray(candidates)) continue;
        for (const file of candidates)
          if (isValidRelativePath(file)) paths.add(file);
      }
    }
    return paths;
  };
  const owners = new Map<string, Record<string, unknown>[]>();
  for (const task of tasks)
    for (const file of writes(task))
      owners.set(file, [...(owners.get(file) ?? []), task]);
  if (!Object.hasOwn(draft, "tracking")) {
    changed = true;
    draft.tracking = {
      path: "tasks.md",
      format: "markdown-checkbox",
      taskIds: (draft.tasks as unknown[]).map((task) =>
        isRecord(task) ? task.taskId : undefined,
      ),
      completionOwner: "parent",
    };
  }
  for (const task of tasks) {
    const taskId = typeof task.taskId === "string" ? task.taskId : undefined;
    if (isRecord(task.phases))
      for (const [phase, boundary] of Object.entries(task.phases)) {
        if (
          !isRecord(boundary) ||
          Object.hasOwn(boundary, "verificationInputs")
        )
          continue;
        const verification = validateVerificationContract(
          boundary.verification,
        );
        // Invalid commands get their normal structural diagnostic; never infer from invalid paths.
        if (!verification.ok) continue;
        changed = true;
        boundary.verificationInputs = verificationInputPaths(
          verification.value,
        ).map((file) => {
          const producers = outputs.filter((output) => output.path === file);
          if (producers.length > 1)
            diagnostics.push({
              code: "multiple-output-producers",
              taskId,
              phase,
              field: "outputs",
              path: file,
            });
          return producers.length === 1
            ? { kind: "output", outputId: producers[0]?.id }
            : { kind: "workspace", path: file };
        });
      }
    if (
      !isRecord(task.impactClosure) ||
      !Array.isArray(task.impactClosure.relatedTests)
    )
      continue;
    for (const test of task.impactClosure.relatedTests) {
      if (
        !isRecord(test) ||
        Object.hasOwn(test, "disposition") ||
        !isValidRelativePath(test.path)
      )
        continue;
      changed = true;
      const writers = owners.get(test.path) ?? [];
      if (writers.includes(task)) test.disposition = "current-task";
      else if (writers.length === 0) test.disposition = "unaffected";
      else if (writers.length === 1) {
        test.disposition = "regression-task";
        if (!Object.hasOwn(test, "regressionTaskId"))
          test.regressionTaskId = writers[0]?.taskId;
      } else
        diagnostics.push({
          code: "related-test-owner-ambiguous",
          taskId,
          field: "impactClosure.relatedTests",
          path: test.path,
        });
    }
  }
  if (diagnostics.length)
    throw new DesignPlanValidationError(
      "delivery-plan-inference-ambiguous",
      diagnostics,
    );
  return changed ? draft : value;
}
