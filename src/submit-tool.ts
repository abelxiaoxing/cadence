import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  type CandidateFailure,
  type DiffResult,
  type EvidenceResult,
  type SubmitFinalCategory,
  type SubmitSchemaState,
  validateDiffResult,
  validateEvidenceResult,
} from "./contracts.ts";

const compactEvidenceSchema = Type.Object({
  id: Type.String(),
  role: Type.String(),
  kind: Type.Literal("evidence"),
  conclusions: Type.Array(Type.String()),
  citations: Type.Array(
    Type.Object({ path: Type.String(), lines: Type.String() }),
  ),
  constraints: Type.Array(Type.String()),
  dependencies: Type.Array(Type.String()),
  risks: Type.Array(Type.String()),
  blockingQuestions: Type.Array(Type.String()),
  hints: Type.Object({
    writeSet: Type.Array(Type.String()),
    verification: Type.String(),
    agentsImpact: Type.String(),
  }),
});

const designEvidenceSchema = Type.Object(
  {
    id: Type.String(),
    role: Type.Literal("design-explorer"),
    kind: Type.Literal("evidence"),
    packet_id: Type.String(),
    module_name: Type.String(),
    scope: Type.Array(Type.String()),
    files_read: Type.Array(Type.String()),
    evidence: Type.Array(
      Type.Object(
        {
          claim: Type.String(),
          path: Type.String(),
          line_start: Type.Integer({ minimum: 1 }),
          line_end: Type.Integer({ minimum: 1 }),
        },
        { additionalProperties: false },
      ),
    ),
    existing_structures: Type.Array(Type.String()),
    existing_conventions: Type.Array(Type.String()),
    constraints_discovered: Type.Array(Type.String()),
    open_questions: Type.Array(Type.String()),
    dependencies: Type.Array(Type.String()),
    write_set_hints: Type.Array(Type.String()),
    validation_hints: Type.Array(Type.String()),
    agents_impact_hints: Type.Array(Type.String()),
    risks: Type.Array(Type.String()),
    success_criteria_hints: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);

const diffSchema = Type.Object({
  id: Type.String(),
  role: Type.String(),
  kind: Type.Literal("diff"),
  taskId: Type.String(),
  phase: Type.String(),
  summary: Type.String(),
  diff: Type.String(),
  expectedVerification: Type.String(),
  risks: Type.Array(Type.String()),
  contractCompliant: Type.Literal(true),
});

export type FinalCategory = SubmitFinalCategory;

export interface IdentityOutcome {
  request: boolean;
  role: boolean;
  task: boolean;
  phase: boolean;
}

export interface SubmitClassification {
  finalCategory: FinalCategory;
  attempts: number;
  schema: SubmitSchemaState;
  identity: IdentityOutcome;
}

export function createSubmitTool(input: {
  requestId: string;
  taskId?: string;
  role: string;
  phase: string;
  output: "evidence" | "diff";
}) {
  let submitted: EvidenceResult | DiffResult | undefined;
  let failure: CandidateFailure | undefined;
  let attempts = 0;
  let schema: SubmitSchemaState = "not-submitted";
  const identity: IdentityOutcome = {
    request: true,
    role: true,
    task: true,
    phase: true,
  };

  const tool = defineTool({
    name: "abel_submit_result",
    label: "Submit Abel Result",
    description:
      "Submit the one final structured Abel evidence or complete unified-diff result.",
    executionMode: "sequential",
    parameters:
      input.output === "evidence"
        ? input.role === "design-explorer"
          ? designEvidenceSchema
          : compactEvidenceSchema
        : diffSchema,
    async execute(_toolCallId, params) {
      attempts++;
      const value = params as unknown as Record<string, unknown>;
      if (value === null || typeof value !== "object") {
        identity.request = false;
        identity.role = false;
        identity.task = false;
        identity.phase = false;
        schema = "invalid";
        failure = {
          kind: "artifact",
          code: "invalid-structural-result",
          stage: "structural-submit",
        };
        throw new Error("submitted result is not an object");
      }
      if (value.id !== input.requestId) identity.request = false;
      if (
        input.role === "design-explorer" &&
        value.packet_id !== input.requestId
      ) {
        identity.request = false;
      }
      if (value.role !== input.role) identity.role = false;
      if (input.output === "diff") {
        if (value.taskId !== (input.taskId ?? input.requestId))
          identity.task = false;
        if (value.phase !== input.phase) identity.phase = false;
      }
      const validation =
        input.output === "evidence"
          ? validateEvidenceResult(value)
          : validateDiffResult(value);
      schema = validation.ok ? "valid" : "invalid";
      const matches =
        identity.request && identity.role && identity.task && identity.phase;
      if (!validation.ok || !matches) {
        failure = validation.ok
          ? {
              kind: "artifact",
              code: "structural-identity-mismatch",
              stage: "structural-submit",
            }
          : (validation.failure ?? {
              kind: "artifact",
              code: "invalid-structural-result",
              stage: "structural-submit",
            });
        throw new Error(
          validation.reason ?? "submitted result identity does not match",
        );
      }
      if (submitted) {
        failure = {
          kind: "artifact",
          code: "invalid-structural-result",
          stage: "structural-submit",
        };
        throw new Error("duplicate structural submission");
      }
      submitted = structuredClone(value) as unknown as
        | EvidenceResult
        | DiffResult;
      return {
        content: [{ type: "text" as const, text: "Abel result accepted." }],
        details: { accepted: true },
        terminate: true,
      };
    },
  });

  return {
    tool,
    getResult: () => submitted,
    getAttempts: () => attempts,
    getSchema: () => schema,
    getIdentity: () => ({ ...identity }),
    getFailure: () =>
      failure === undefined ? undefined : structuredClone(failure),
  };
}
