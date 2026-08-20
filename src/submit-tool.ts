import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  type DiffResult,
  type EvidenceResult,
  validateDiffResult,
  validateEvidenceResult,
} from "./contracts.ts";

const evidenceSchema = Type.Object({
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
  nextStep: Type.String(),
  contractCompliant: Type.Literal(true),
});

export type FinalCategory =
  | "no-final-assistant"
  | "text-only"
  | "mixed"
  | "multiple-submit"
  | "single-submit-only";

export interface IdentityOutcome {
  request: boolean;
  role: boolean;
  task: boolean;
  phase: boolean;
}

export interface SubmitClassification {
  finalCategory: FinalCategory;
  attempts: number;
  schema: "valid" | "invalid";
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
  let attempts = 0;
  let schema: "valid" | "invalid" = "invalid";
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
    parameters: input.output === "evidence" ? evidenceSchema : diffSchema,
    async execute(_toolCallId, params) {
      attempts++;
      const value = params as unknown as Record<string, unknown>;
      if (value === null || typeof value !== "object") {
        identity.request = false;
        identity.role = false;
        identity.task = false;
        identity.phase = false;
        schema = "invalid";
        throw new Error("submitted result is not an object");
      }
      if (value.id !== input.requestId) identity.request = false;
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
        throw new Error(
          validation.reason ?? "submitted result identity does not match",
        );
      }
      if (submitted) throw new Error("duplicate structural submission");
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
  };
}
