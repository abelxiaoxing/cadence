import { compareCanonicalStrings } from "./canonical.ts";
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
