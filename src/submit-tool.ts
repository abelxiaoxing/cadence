import { createHash } from "node:crypto";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  type CandidatePatchOperation,
  compileCandidatePatch,
} from "./candidate-patch.ts";
import {
  type CandidateFailure,
  type DiffResult,
  type EvidenceResult,
  isValidRelativePath,
  type SubmitFinalCategory,
  type SubmitSchemaState,
  validateDiffResult,
  validateEvidenceResult,
} from "./contracts.ts";
import {
  type BeginCandidateInput,
  TASK_LEDGER_LIMITS,
  type TaskLedger,
} from "./task-ledger.ts";

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

function candidateArtifactSchema(candidateId: string) {
  return Type.Union([
    Type.Object(
      {
        kind: Type.Literal("candidate-patch"),
        candidateId: Type.Literal(candidateId),
        operations: Type.Array(
          Type.Union([
            Type.Object(
              {
                kind: Type.Literal("replace"),
                path: Type.String(),
                oldText: Type.String({ minLength: 1 }),
                newText: Type.String(),
              },
              { additionalProperties: false },
            ),
            Type.Object(
              {
                kind: Type.Literal("rewrite"),
                path: Type.String(),
                content: Type.String(),
              },
              { additionalProperties: false },
            ),
            Type.Object(
              {
                kind: Type.Literal("create"),
                path: Type.String(),
                content: Type.String({ minLength: 1 }),
                mode: Type.Union([
                  Type.Literal("regular"),
                  Type.Literal("executable"),
                ]),
              },
              { additionalProperties: false },
            ),
            Type.Object(
              {
                kind: Type.Literal("delete"),
                path: Type.String(),
              },
              { additionalProperties: false },
            ),
          ]),
          { minItems: 1, maxItems: 128 },
        ),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        kind: Type.Literal("context-request"),
        candidateId: Type.Literal(candidateId),
        code: Type.Union([
          Type.Literal("approved-context-needed"),
          Type.Literal("task-split-needed"),
          Type.Literal("boundary-review-needed"),
        ]),
        refs: Type.Array(Type.String(), { maxItems: 32 }),
      },
      { additionalProperties: false },
    ),
  ]);
}

export type CandidateArtifactSubmissionResult =
  | {
      kind: "sealed-candidate";
      candidateId: string;
      state: "sealed";
      artifactHash: string;
      bytes: number;
      paths: string[];
      replayed?: true;
    }
  | {
      kind: "context-request";
      candidateId: string;
      code:
        | "approved-context-needed"
        | "task-split-needed"
        | "boundary-review-needed";
      refs: string[];
    };

export type CandidateContextRequest = Extract<
  CandidateArtifactSubmissionResult,
  { kind: "context-request" }
>;

export interface ClassifiedCandidateContextRequest {
  kind: "paused" | "approval-needed";
  code:
    | "approved-context-needed"
    | "task-split-needed"
    | "boundary-review-needed";
  contextRequest: {
    code: CandidateContextRequest["code"];
    refs: string[];
  };
}

function contextRefWithinBoundary(relative: string, approved: string): boolean {
  return (
    approved === "." ||
    relative === approved ||
    relative.startsWith(`${approved}/`)
  );
}

export function classifyCandidateContextRequest(
  request: CandidateContextRequest,
  approvedPaths: readonly string[],
): ClassifiedCandidateContextRequest {
  const refs = [...request.refs];
  const inBoundary =
    refs.length > 0 &&
    refs.every((relative) =>
      approvedPaths.some((approved) =>
        contextRefWithinBoundary(relative, approved),
      ),
    );
  const approvalNeeded =
    !inBoundary || request.code === "boundary-review-needed";
  return {
    kind: approvalNeeded ? "approval-needed" : "paused",
    code: inBoundary ? request.code : "boundary-review-needed",
    contextRequest: {
      code: request.code,
      refs,
    },
  };
}

export interface CandidateArtifactSubmission {
  ledger: Pick<
    TaskLedger,
    "beginCandidate" | "appendCandidateSegment" | "sealCandidate"
  >;
  identity: BeginCandidateInput;
  workspaceRoot: string;
  writePaths: readonly string[];
  deletePaths: readonly string[];
}

export function createCandidateArtifactTool(
  input: CandidateArtifactSubmission,
) {
  input.ledger.beginCandidate(input.identity);
  const parameters = candidateArtifactSchema(input.identity.candidateId);
  let result: CandidateArtifactSubmissionResult | undefined;
  let failure: CandidateFailure | undefined;
  let attempts = 0;
  let schema: SubmitSchemaState = "not-submitted";
  let identity: IdentityOutcome = {
    request: true,
    role: true,
    task: true,
    phase: true,
  };
  const tool = defineTool<typeof parameters, unknown>({
    name: "abel_submit_result",
    label: "Submit Abel Candidate Artifact",
    description:
      "Submit one complete structured candidate patch or request bounded approved context. Diff generation, chunking, encoding, hashes, and atomic sealing are owned by this trusted tool.",
    executionMode: "sequential",
    parameters,
    async execute(_toolCallId, params) {
      if (result !== undefined) {
        throw new Error("candidate terminal result already submitted");
      }
      attempts++;
      if (attempts > 2) {
        schema = "invalid";
        failure = {
          kind: "artifact",
          code: "invalid-structural-result",
          stage: "structural-submit",
        };
        throw new Error("structural submission correction limit exceeded");
      }
      identity = {
        request: true,
        role: true,
        task: true,
        phase: true,
      };
      failure = undefined;
      const value = params as unknown as Record<string, unknown>;
      if (value.candidateId !== input.identity.candidateId) {
        identity.request = false;
        schema = "invalid";
        failure = {
          kind: "artifact",
          code: "structural-identity-mismatch",
          stage: "structural-submit",
        };
        throw new Error("candidate identity mismatch");
      }
      schema = "valid";
      if (value.kind === "candidate-patch") {
        let diff: string;
        try {
          diff = compileCandidatePatch({
            root: input.workspaceRoot,
            writePaths: input.writePaths,
            deletePaths: input.deletePaths,
            operations: value.operations as CandidatePatchOperation[],
            maxBytes: TASK_LEDGER_LIMITS.maxCandidateBytes,
          });
        } catch (error) {
          schema = "invalid";
          failure = {
            kind: "artifact",
            code: "invalid-diff",
            stage: "candidate-diff",
          };
          throw error;
        }
        const bytes = Buffer.from(diff, "utf8");
        const candidateHash = createHash("sha256").update(bytes).digest("hex");
        let sequence = 0;
        for (
          let offset = 0;
          offset < bytes.length;
          offset += TASK_LEDGER_LIMITS.maxSegmentBytes
        ) {
          const segment = bytes.subarray(
            offset,
            Math.min(offset + TASK_LEDGER_LIMITS.maxSegmentBytes, bytes.length),
          );
          let accepted: ReturnType<
            CandidateArtifactSubmission["ledger"]["appendCandidateSegment"]
          >;
          try {
            accepted = input.ledger.appendCandidateSegment({
              ...input.identity,
              sequence,
              bytes: segment,
              segmentHash: createHash("sha256").update(segment).digest("hex"),
            });
          } catch (error) {
            schema = "invalid";
            failure = {
              kind: "artifact",
              code: "invalid-diff",
              stage: "candidate-diff",
            };
            throw error;
          }
          if (!accepted.ok) {
            failure = {
              kind: "result-limit",
              limitBytes: accepted.limitBytes,
            };
            return {
              content: [],
              details: accepted,
              terminate: true,
            };
          }
          sequence = accepted.nextSequence;
        }
        let sealed: ReturnType<
          CandidateArtifactSubmission["ledger"]["sealCandidate"]
        >;
        try {
          sealed = input.ledger.sealCandidate({
            ...input.identity,
            segmentCount: sequence,
            totalBytes: bytes.length,
            candidateHash,
          });
        } catch (error) {
          schema = "invalid";
          const mismatch =
            error instanceof Error &&
            error.message === "candidate-write-set-mismatch";
          failure = {
            kind: "artifact",
            code: mismatch ? "write-set-mismatch" : "invalid-diff",
            stage: "candidate-diff",
          };
          throw error;
        }
        if (!sealed.ok) return { content: [], details: sealed };
        result = {
          kind: "sealed-candidate",
          candidateId: input.identity.candidateId,
          state: "sealed",
          artifactHash: sealed.artifactHash,
          bytes: sealed.bytes,
          paths: [...sealed.paths],
          ...(sealed.replayed ? { replayed: true } : {}),
        };
        return {
          content: [
            { type: "text" as const, text: "Candidate artifact sealed." },
          ],
          details: sealed,
          terminate: true,
        };
      }
      const refs = value.refs as string[];
      if (
        refs.some((relative) => !isValidRelativePath(relative)) ||
        new Set(refs).size !== refs.length
      ) {
        schema = "invalid";
        failure = {
          kind: "artifact",
          code: "invalid-structural-result",
          stage: "structural-submit",
        };
        throw new Error("context request refs are invalid");
      }
      result = {
        kind: "context-request",
        candidateId: input.identity.candidateId,
        code: value.code as Extract<
          CandidateArtifactSubmissionResult,
          { kind: "context-request" }
        >["code"],
        refs: [...refs],
      };
      return {
        content: [
          { type: "text" as const, text: "Bounded context request accepted." },
        ],
        details: result,
        terminate: true,
      };
    },
  });
  return {
    tool,
    getResult: () =>
      result === undefined ? undefined : structuredClone(result),
    getAttempts: () => attempts,
    getSchema: () => schema,
    getIdentity: () => ({ ...identity }),
    getFailure: () =>
      failure === undefined ? undefined : structuredClone(failure),
  };
}

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
  let identity: IdentityOutcome = {
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
      if (attempts > 2) {
        schema = "invalid";
        failure = {
          kind: "artifact",
          code: "invalid-structural-result",
          stage: "structural-submit",
        };
        throw new Error("structural submission correction limit exceeded");
      }
      identity = {
        request: true,
        role: true,
        task: true,
        phase: true,
      };
      failure = undefined;
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
