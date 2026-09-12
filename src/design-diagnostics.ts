import { canonicalJson, compareCanonicalStrings } from "./canonical.ts";
import { isValidRelativePath } from "./contracts.ts";

export type SafeDesignDiagnostic = Record<string, string | boolean | string[]>;
const CODE = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/iu;
const IDENTITIES = new Set([
  "code",
  "taskId",
  "phase",
  "field",
  "category",
  "owner",
  "verificationId",
  "acceptanceId",
  "outputId",
  "dependencyTaskId",
  "producerTaskId",
  "producerPhase",
  "command",
  "reason",
  "systemCode",
  "exitCode",
]);
const HINTS = new Map<string, string>(
  Object.entries({
    "duplicate-path":
      "Remove the repeated path at the indicated index; keep the existing declaration and do not widen phase permissions.",
    enum: "Use one of allowedValues at the indicated field. For public impact, choose the actual changed surface; do not substitute none to bypass closure checks.",
    "related-test-missing":
      "Add this affected-suite test to relatedTests with evidence and its actual owner. Do not remove public impact or widen writes to satisfy ownership.",
    "change-contract-acceptance-missing":
      "Read the current approved ChangeContract from Design status and include each accepted verification obligation in the plan's phase, affected, full-suite or post-apply verification. Command, arguments, inputs and classification must match; copying only its ID is insufficient. Keep accepted IDs, statements and scope unchanged.",
    "script-command-mismatch":
      "command must equal the literal package.json scripts[script] value, not an invocation such as npm run test. In PlanDraft, omit command to bind it from the manifest. Explicit commands, including approved Gate acceptance verifiers, remain exact and must be corrected rather than silently replaced.",
    "design-traceability-input-unavailable":
      "Write tasks.md with author task checkboxes and exact owned Scenario references, plus the referenced spec artifacts, before compilation and finalization.",
    "traceability-managed-region-invalid":
      "Repair the paired ABEL:VERIFICATION-BINDINGS markers in tasks.md without removing author evidence, then compile again. Code replaces only one complete managed region.",
    "traceability-managed-region-stale":
      "Compile the current draft again to regenerate phase verification bindings; do not copy verifier identities by hand.",
    "traceability-task-unmapped":
      "Put each planned task ID in backticks on its author checkbox outside the generated bindings region.",
    "traceability-verification-unmapped":
      "Compile after writing tasks.md so code installs phase verification bindings while preserving the author evidence.",
    "traceability-reference-empty":
      "Add exact backticked specs/<capability>/spec.md#Requirement title/Scenario title references under the owning author tasks. Code does not infer Scenario ownership.",
    "change-contract-field-invalid":
      "Correct the indicated ChangeContract field using the tool schema. Keep accepted scope and evidence unchanged.",
    "design-control-field-invalid":
      "Use the exact operation envelope and returned runId; inspect the indicated field in the tool schema.",
    "verification-reference-unavailable":
      "Use a declared verificationDefinitions name or an explicit verification contract.",
    "verification-reference-invalid":
      "A verification reference contains only use and optional Red expectedFailure. Put executable fields in its definition.",
    "verification-definition-invalid":
      "Define one existing atomic verifier without id, classification, executionBindings or references.",
    "current-task-outside-write-set":
      "Omit disposition to derive the test owner from task writes. Keep path and evidence; do not widen writes to satisfy this label.",
    "related-test-owner-ambiguous":
      "Several other tasks edit this test. Choose the intended regression-task owner explicitly, or resolve overlapping task ownership.",
    "verification-input-binding-mismatch":
      "Omit verificationInputs to derive exact bindings from the verification contract and declared outputs. Keep supporting source files in read, not in verificationInputs.",
    "workspace-input-has-producer":
      "Omit verificationInputs or bind this path to its declared outputId instead of workspace.",
    "multiple-output-producers":
      "Declare one producer per output path before deriving input bindings. Do not choose a producer by list order.",
    "producer-not-dependency":
      "The producing task must be an explicit dependency of this task. Input inference does not add dependency authority.",
    "producer-phase-after-consumer":
      "This verification needs an output from a later phase. Correct the producer or phase order; input inference cannot make that output available earlier.",
    "verification-input-not-declared":
      "The verification contract requires a path outside this phase's read/write declarations. Correct the contract or explicitly declare the approved input path.",
    "workspace-input-unavailable":
      "The required workspace input is missing or not a safe regular file. Correct its path or declare its planned producer.",
  }),
);
function safePath(value: unknown): value is string {
  return isValidRelativePath(value) && !/[\p{Cc}\p{Cf}]/u.test(value);
}

/** One bounded projection for tool feedback and TUI; guidance is code-owned. */
export function projectDesignDiagnostic(
  value: unknown,
): SafeDesignDiagnostic | undefined {
  if (typeof value === "string") value = { code: value.split(":", 1)[0] };
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.code !== "string" || !CODE.test(record.code))
    return undefined;
  const result: SafeDesignDiagnostic = {};
  for (const [key, entry] of Object.entries(record)) {
    if (IDENTITIES.has(key) && typeof entry === "string" && CODE.test(entry))
      result[key] = entry;
    else if (
      (key === "retryable" || key === "pathsTruncated") &&
      typeof entry === "boolean"
    )
      result[key] =
        key === "pathsTruncated"
          ? result.pathsTruncated === true || entry
          : entry;
    else if (key === "path" && safePath(entry)) result.path = entry;
    else if (
      (key === "allowedValues" || key === "mismatchedFields") &&
      Array.isArray(entry)
    ) {
      result[key] = [
        ...new Set(
          entry.filter(
            (item): item is string =>
              typeof item === "string" && CODE.test(item),
          ),
        ),
      ].slice(0, 32);
    } else if (
      (key === "expectedPaths" || key === "actualPaths") &&
      Array.isArray(entry)
    ) {
      const paths = [...new Set(entry.filter(safePath))].sort(
        compareCanonicalStrings,
      );
      result[key] = paths.slice(0, 32);
      if (entry.some((path) => !safePath(path)) || paths.length > 32)
        result.pathsTruncated = true;
    }
  }
  const hint = HINTS.get(String(result.category)) ?? HINTS.get(record.code);
  if (hint) result.hint = hint;
  return result;
}

export interface DesignPlanDiagnostic {
  code: string;
  taskId?: string;
  phase?: string;
  field?: string;
  category?: string;
  owner?: string;
  verificationId?: string;
  acceptanceId?: string;
  allowedValues?: string[];
  mismatchedFields?: string[];
  outputId?: string;
  dependencyTaskId?: string;
  producerTaskId?: string;
  producerPhase?: string;
  path?: string;
  expectedPaths?: string[];
  actualPaths?: string[];
}

export class DesignPlanValidationError extends Error {
  readonly diagnostics: readonly DesignPlanDiagnostic[];

  constructor(message: string, diagnostics: readonly DesignPlanDiagnostic[]) {
    const normalized = [
      ...new Map(
        diagnostics
          .map((diagnostic) => structuredClone(diagnostic))
          .sort((left, right) =>
            compareCanonicalStrings(canonicalJson(left), canonicalJson(right)),
          )
          .map((diagnostic) => [canonicalJson(diagnostic), diagnostic]),
      ).values(),
    ];
    super(message);
    this.name = "DesignPlanValidationError";
    this.diagnostics = Object.freeze(normalized);
  }
}
