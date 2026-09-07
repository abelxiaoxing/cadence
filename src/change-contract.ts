import { changeContractDiagnostics } from "./change-contract-schema.ts";
import {
  type ImplementTaskBoundary,
  isValidRelativePath,
  type StructuredVerificationContract,
  validateVerificationContract,
  verificationInputPaths,
} from "./contracts.ts";
import { DesignPlanValidationError } from "./design-diagnostics.ts";
import { canonicalJson } from "./run-state.ts";

export interface ChangeContract {
  goal: string;
  acceptance: Array<{
    id: string;
    statement: string;
    verification: StructuredVerificationContract;
  }>;
  constraints: Array<{ id: string; statement: string }>;
  policy: {
    writeRoots: string[];
    dependencies: string[];
    verificationModes: Array<"behavior" | "mechanical" | "refactor">;
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: string[]) {
  return (
    canonicalJson(Object.keys(value).sort()) === canonicalJson(expected.sort())
  );
}
function text(value: unknown): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= 8192
  );
}
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;

export function normalizeChangeContract(value: unknown): ChangeContract {
  const diagnostics = changeContractDiagnostics(value);
  if (diagnostics.length)
    throw new DesignPlanValidationError("change-contract-invalid", diagnostics);
  if (
    !record(value) ||
    !keys(value, ["goal", "acceptance", "constraints", "policy"]) ||
    !text(value.goal) ||
    !Array.isArray(value.acceptance) ||
    value.acceptance.length < 1 ||
    value.acceptance.length > 256 ||
    !Array.isArray(value.constraints) ||
    value.constraints.length > 256 ||
    !record(value.policy)
  )
    throw new Error("change-contract-invalid");
  const entries = (values: unknown[], acceptance: boolean) =>
    values
      .map((entry) => {
        if (
          !record(entry) ||
          !keys(
            entry,
            acceptance
              ? ["id", "statement", "verification"]
              : ["id", "statement"],
          ) ||
          typeof entry.id !== "string" ||
          !identifier.test(entry.id) ||
          !text(entry.statement)
        )
          throw new Error("change-contract-invalid");
        const verification = acceptance
          ? validateVerificationContract(entry.verification)
          : undefined;
        if (verification && !verification.ok)
          throw new Error("change-contract-invalid");
        return {
          id: entry.id,
          statement: entry.statement.replace(/\r\n?/gu, "\n").trim(),
          ...(verification?.ok ? { verification: verification.value } : {}),
        };
      })
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const acceptance = entries(value.acceptance, true);
  const constraints = entries(value.constraints, false);
  for (const group of [acceptance, constraints])
    if (new Set(group.map((item) => item.id)).size !== group.length)
      throw new Error("change-contract-invalid");
  const policy = value.policy;
  if (!keys(policy, ["writeRoots", "dependencies", "verificationModes"]))
    throw new Error("change-contract-invalid");
  for (const key of ["writeRoots", "dependencies", "verificationModes"])
    if (
      !Array.isArray(policy[key]) ||
      policy[key].length > 256 ||
      !policy[key].every(text) ||
      new Set(policy[key]).size !== policy[key].length
    )
      throw new Error("change-contract-invalid");
  const roots = policy.writeRoots as string[];
  const modes = policy.verificationModes as string[];
  if (
    !roots.length ||
    !roots.every((root) => root === "." || isValidRelativePath(root)) ||
    !modes.length ||
    !modes.every((mode) =>
      ["behavior", "mechanical", "refactor"].includes(mode),
    )
  )
    throw new Error("change-contract-invalid");
  const result = {
    goal: value.goal.replace(/\r\n?/gu, "\n").trim(),
    acceptance,
    constraints,
    policy: {
      writeRoots: [...roots].sort(),
      dependencies: [...(policy.dependencies as string[])].sort(),
      verificationModes: [...modes].sort(),
    },
  } as ChangeContract;
  if (Buffer.byteLength(canonicalJson(result)) > 64 * 1024)
    throw new Error("change-contract-invalid");
  return result;
}

/** Display identities and fresh input bindings do not change a verification obligation. */
export function verificationObligation(
  value: StructuredVerificationContract,
): string {
  const strip = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(strip)
      : record(item)
        ? Object.fromEntries(
            Object.entries(item)
              .filter(([key]) => !["id", "executionBindings"].includes(key))
              .map(([key, child]) => [key, strip(child)]),
          )
        : item;
  return canonicalJson(strip(value));
}

export function assertPlanWithinChangeContract(
  contract: ChangeContract,
  tasks: readonly (ImplementTaskBoundary & {
    verificationMode?: string;
    affectedVerification: StructuredVerificationContract;
    repairVerification: StructuredVerificationContract;
  })[],
  verifications: readonly StructuredVerificationContract[],
): void {
  const available = new Set(
    [
      ...verifications,
      ...tasks.flatMap((task) => [
        task.affectedVerification,
        ...Object.entries(task.phases)
          .filter(
            ([phase]) =>
              phase !== "red" ||
              !task.verificationMode ||
              task.verificationMode === "behavior",
          )
          .map(([, phase]) => phase.verification),
      ]),
    ].map(verificationObligation),
  );
  for (const accepted of contract.acceptance)
    if (!available.has(verificationObligation(accepted.verification)))
      throw new Error("change-contract-acceptance-missing");
  for (const task of tasks) {
    if (
      !contract.policy.verificationModes.includes(
        (task.verificationMode ?? "behavior") as "behavior",
      )
    )
      throw new Error("change-contract-verification-mode");
    if (
      task.approvedDependencies.some(
        (name) => !contract.policy.dependencies.includes(name),
      )
    )
      throw new Error("change-contract-dependency-outside-policy");
    if (
      task.agents &&
      task.agents.impact !== "none" &&
      !contract.policy.writeRoots.includes(task.agents.target ?? "")
    )
      throw new Error("change-contract-agents-outside-policy");
    const mode = task.verificationMode ?? "behavior";
    const writes = Object.entries(task.phases)
      .filter(([phase]) => phase !== "red" || mode === "behavior")
      .flatMap(([, phase]) => [...phase.write, ...phase.delete]);
    if (
      mode !== "behavior" &&
      task.impactClosure?.changedSurfaces.some((surface) => surface !== "none")
    )
      throw new Error("change-contract-behavior-requires-red");
    if (
      mode === "mechanical" &&
      writes.some((file) => !/\.(?:md|txt|json|ya?ml|toml|lock)$/iu.test(file))
    )
      throw new Error("change-contract-mechanical-path");
    if (
      mode === "refactor" &&
      contract.acceptance.some((accepted) =>
        verificationInputPaths(accepted.verification).some((file) =>
          writes.includes(file),
        ),
      )
    )
      throw new Error("change-contract-refactor-verification-mutation");
    for (const phase of Object.values(task.phases))
      for (const file of [...phase.write, ...phase.delete])
        if (
          !contract.policy.writeRoots.some(
            (root) =>
              root === "." || file === root || file.startsWith(`${root}/`),
          )
        )
          throw new Error("change-contract-write-outside-policy");
  }
}

export function retainedChangeContract(plan: {
  changeContract?: ChangeContract;
  changeId: string;
  tasks: readonly (ImplementTaskBoundary & {
    affectedVerification: StructuredVerificationContract;
  })[];
  verification: {
    change: {
      fullSuite: StructuredVerificationContract;
      postApply: StructuredVerificationContract;
    };
  };
}): ChangeContract {
  if (plan.changeContract) return normalizeChangeContract(plan.changeContract);
  return normalizeChangeContract({
    goal: plan.changeId,
    acceptance: [
      plan.verification.change.fullSuite,
      plan.verification.change.postApply,
      ...plan.tasks.map((task) => task.affectedVerification),
    ].map((verification, index) => ({
      id: `legacy-${index}`,
      statement: "Retained verification obligation",
      verification,
    })),
    constraints: [],
    policy: {
      writeRoots: [
        ...new Set(
          plan.tasks.flatMap((task) => [
            ...(task.agents.impact !== "none" && task.agents.target
              ? [task.agents.target]
              : []),
            ...Object.values(task.phases).flatMap((phase) => [
              ...phase.write,
              ...phase.delete,
            ]),
          ]),
        ),
      ],
      dependencies: [
        ...new Set(plan.tasks.flatMap((task) => task.approvedDependencies)),
      ],
      verificationModes: ["behavior"],
    },
  });
}
