import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { AGENTS_IMPACTS, RELATIVE_PATH_PATTERN } from "./contracts.ts";

// The authoring boundary is smaller than the sealed EvidenceResult. Only
// code-owned identity and explicitly advisory fields may be omitted.
const advisoryStrings = () => Type.Optional(Type.Array(Type.String()));
const relativePath = () =>
  Type.String({
    pattern: RELATIVE_PATH_PATTERN,
    minLength: 1,
    maxLength: 512,
    description:
      "Canonical workspace-relative path or module slug; no absolute paths, ./, .., backslashes, or trailing slash.",
  });
const pathSet = (minItems = 0) =>
  Type.Array(relativePath(), { uniqueItems: true, minItems });

export function evidenceDraftSchema(requestId: string, role: string) {
  const identity = {
    id: Type.Optional(
      Type.Literal(requestId, {
        description:
          "Omit: bound by the parent result adapter. If supplied, must match this request.",
      }),
    ),
    role: Type.Optional(Type.Literal(role)),
    kind: Type.Optional(Type.Literal("evidence")),
  };
  return role === "design-explorer"
    ? Type.Object(
        {
          ...identity,
          packet_id: Type.Optional(Type.Literal(requestId)),
          module_name: relativePath(),
          scope: pathSet(1),
          files_read: pathSet(),
          evidence: Type.Array(
            Type.Object(
              {
                claim: Type.String({ minLength: 1 }),
                path: relativePath(),
                line_start: Type.Integer({ minimum: 1 }),
                line_end: Type.Integer({
                  minimum: 1,
                  description:
                    "Inclusive end line, greater than or equal to line_start.",
                }),
              },
              { additionalProperties: false },
            ),
          ),
          existing_structures: advisoryStrings(),
          existing_conventions: advisoryStrings(),
          constraints_discovered: Type.Array(Type.String()),
          open_questions: Type.Array(Type.String()),
          dependencies: advisoryStrings(),
          write_set_hints: Type.Optional(pathSet()),
          validation_hints: advisoryStrings(),
          agents_impact_hints: advisoryStrings(),
          risks: Type.Array(Type.String()),
          success_criteria_hints: advisoryStrings(),
        },
        { additionalProperties: false },
      )
    : Type.Object(
        {
          ...identity,
          conclusions: Type.Array(Type.String()),
          citations: Type.Array(
            Type.Object(
              { path: relativePath(), lines: Type.String() },
              { additionalProperties: false },
            ),
          ),
          constraints: Type.Array(Type.String()),
          dependencies: advisoryStrings(),
          risks: Type.Array(Type.String()),
          blockingQuestions: Type.Array(Type.String()),
          hints: Type.Optional(
            Type.Object(
              {
                writeSet: pathSet(),
                verification: Type.String(),
                agentsImpact: StringEnum(AGENTS_IMPACTS),
              },
              { additionalProperties: false },
            ),
          ),
        },
        { additionalProperties: false },
      );
}

export function completeEvidenceDraft(
  value: unknown,
  requestId: string,
  role: string,
): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const draft = value as Record<string, unknown>;
  const defaults: Record<string, unknown> = {
    id: requestId,
    role,
    kind: "evidence",
    dependencies: [],
    ...(role === "design-explorer"
      ? {
          packet_id: requestId,
          existing_structures: [],
          existing_conventions: [],
          write_set_hints: [],
          validation_hints: [],
          agents_impact_hints: [],
          success_criteria_hints: [],
        }
      : { hints: { writeSet: [], verification: "", agentsImpact: "none" } }),
  };
  // Defaults mean "no advisory information supplied", never verified facts or
  // authority. Explicit wrong values (including null/undefined) survive validation.
  return { ...defaults, ...draft };
}
