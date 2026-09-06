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
  isAgentsPath,
  isValidRelativePath,
  LIMITS,
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
        ]),
        refs: Type.Array(
          Type.Union([
            Type.String(),
            Type.Object(
              {
                kind: Type.Literal("requested-path"),
                path: Type.String(),
                access: Type.Union([
                  Type.Literal("read"),
                  Type.Literal("write"),
                ]),
              },
              { additionalProperties: false },
            ),
            Type.Object(
              {
                kind: Type.Literal("source-citation"),
                path: Type.String(),
                line: Type.Integer({ minimum: 1 }),
              },
              { additionalProperties: false },
            ),
            Type.Object(
              {
                kind: Type.Literal("contract-diagnostic"),
                ref: Type.String(),
              },
              { additionalProperties: false },
            ),
          ]),
          { minItems: 1, maxItems: 32 },
        ),
      },
      { additionalProperties: false },
    ),
  ]);
}

export type CandidateContextRequestCode =
  | "approved-context-needed"
  | "task-split-needed"
  | "boundary-review-needed";

export type CandidateContextRef =
  | { kind: "requested-path"; path: string; access: "read" | "write" }
  | { kind: "source-citation"; path: string; line: number }
  | { kind: "contract-diagnostic"; ref: string };

export type CandidateContextRefInput = string | CandidateContextRef;

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
      code: CandidateContextRequestCode;
      refs: CandidateContextRef[];
    };

export type CandidateContextRequest = Extract<
  CandidateArtifactSubmissionResult,
  { kind: "context-request" }
>;

export interface CandidateContextBoundary {
  phase: "red" | "green" | "refactor";
  readPaths: readonly string[];
  writePaths: readonly string[];
  deletePaths?: readonly string[];
  taskPaths: readonly string[];
  contextReadRoots?: readonly string[];
  redWritePaths: readonly string[];
  agents: {
    impact: "none" | "update-existing" | "create-index" | "remove-index";
    target?: string;
  };
}

export interface ClassifiedCandidateContextRequest {
  kind: "paused" | "retryable" | "approval-needed";
  code:
    | "approved-context-needed"
    | "task-split-needed"
    | "boundary-review-needed"
    | "red-artifact-constraint"
    | "agents-context-needed"
    | "agents-write-parent-owned"
    | "agents-contract-insufficient";
  contextRequest: {
    code: CandidateContextRequestCode;
    refs: CandidateContextRef[];
  };
}

const LEGACY_CITATION = /^(.*):(\d+)$/u;
const LEGACY_DIAGNOSTIC =
  /^(?:phase-contract|task-contract|sealed-contract|workflow-contract)\.[a-z0-9._-]+$/iu;

function validDiagnosticRef(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    value.trim() === value &&
    !/[\r\n\0]/u.test(value)
  );
}

function normalizeCandidateContextRef(
  input: CandidateContextRefInput,
): CandidateContextRef {
  if (typeof input === "string") {
    const citation = LEGACY_CITATION.exec(input);
    if (citation && isValidRelativePath(citation[1])) {
      const line = Number(citation[2]);
      if (Number.isSafeInteger(line) && line >= 1) {
        return { kind: "source-citation", path: citation[1], line };
      }
    }
    if (LEGACY_DIAGNOSTIC.test(input)) {
      return { kind: "contract-diagnostic", ref: input };
    }
    if (!isValidRelativePath(input)) {
      throw new Error("context request refs are invalid");
    }
    return { kind: "requested-path", path: input, access: "read" };
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("context request refs are invalid");
  }
  if (
    input.kind === "requested-path" &&
    Object.keys(input).length === 3 &&
    isValidRelativePath(input.path) &&
    (input.access === "read" || input.access === "write")
  ) {
    return { ...input };
  }
  if (
    input.kind === "source-citation" &&
    Object.keys(input).length === 3 &&
    isValidRelativePath(input.path) &&
    Number.isSafeInteger(input.line) &&
    input.line >= 1
  ) {
    return { ...input };
  }
  if (
    input.kind === "contract-diagnostic" &&
    Object.keys(input).length === 2 &&
    validDiagnosticRef(input.ref)
  ) {
    return { ...input };
  }
  throw new Error("context request refs are invalid");
}

export function normalizeCandidateContextRefs(
  value: unknown,
): CandidateContextRef[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
    throw new Error("context request refs are invalid");
  }
  const refs = value.map((entry) =>
    normalizeCandidateContextRef(entry as CandidateContextRefInput),
  );
  const identities = refs.map((ref) => JSON.stringify(ref));
  if (new Set(identities).size !== refs.length) {
    throw new Error("context request refs are invalid");
  }
  return refs;
}

function contextRefWithinBoundary(relative: string, approved: string): boolean {
  return (
    approved === "." ||
    relative === approved ||
    relative.startsWith(`${approved}/`)
  );
}

function normalizedBoundary(
  boundary: readonly string[] | CandidateContextBoundary,
): CandidateContextBoundary {
  if (!Array.isArray(boundary)) return boundary as CandidateContextBoundary;
  return {
    phase: "green",
    readPaths: boundary,
    writePaths: [],
    deletePaths: [],
    taskPaths: boundary,
    redWritePaths: [],
    agents: { impact: "none" },
  };
}

function pathWithinAny(relative: string, approved: readonly string[]): boolean {
  return approved.some((path) => contextRefWithinBoundary(relative, path));
}

export function permitsContextRead(
  relative: string,
  roots: readonly string[],
): boolean {
  // Dynamic discovery never grants hidden credentials or a directory tree.
  return (
    isValidRelativePath(relative) &&
    relative.split("/").every((part) => !part.startsWith(".")) &&
    !/\.(?:pem|key|p12|pfx)$/iu.test(relative) &&
    pathWithinAny(relative, roots)
  );
}

export function classifyCandidateContextRequest(
  request: {
    kind: "context-request";
    candidateId: string;
    code: CandidateContextRequestCode;
    refs: readonly CandidateContextRefInput[];
  },
  inputBoundary: readonly string[] | CandidateContextBoundary,
): ClassifiedCandidateContextRequest {
  const refs = normalizeCandidateContextRefs(request.refs);
  const boundary = normalizedBoundary(inputBoundary);
  const phasePaths = [
    ...boundary.readPaths,
    ...boundary.writePaths,
    ...(boundary.deletePaths ?? []),
  ];
  const requested = refs.filter(
    (ref): ref is Extract<CandidateContextRef, { kind: "requested-path" }> =>
      ref.kind === "requested-path",
  );
  const ordinaryRequested = requested.filter((ref) => !isAgentsPath(ref.path));
  const outsideOrdinary = ordinaryRequested.filter(
    (ref) =>
      !(
        ref.access === "read" &&
        permitsContextRead(ref.path, boundary.contextReadRoots ?? [])
      ) &&
      !pathWithinAny(
        ref.path,
        ref.access === "write"
          ? [...boundary.writePaths, ...(boundary.deletePaths ?? [])]
          : [...phasePaths, ...boundary.taskPaths],
      ),
  );
  const agentsRequested = requested.filter((ref) => isAgentsPath(ref.path));
  const agentsWrites = agentsRequested.filter((ref) => ref.access === "write");
  const citedRedArtifacts = refs.filter(
    (ref): ref is Extract<CandidateContextRef, { kind: "source-citation" }> =>
      ref.kind === "source-citation" &&
      pathWithinAny(ref.path, boundary.redWritePaths) &&
      !pathWithinAny(ref.path, [
        ...boundary.writePaths,
        ...(boundary.deletePaths ?? []),
      ]),
  );
  const requestedRedArtifacts = outsideOrdinary.filter(
    (ref) =>
      pathWithinAny(ref.path, boundary.redWritePaths) &&
      pathWithinAny(ref.path, boundary.taskPaths),
  );
  const redArtifactConstraint =
    boundary.phase === "green" &&
    (citedRedArtifacts.length > 0 || requestedRedArtifacts.length > 0) &&
    outsideOrdinary.every((ref) => requestedRedArtifacts.includes(ref)) &&
    agentsRequested.every((ref) => ref.access === "read");

  let classification: Pick<ClassifiedCandidateContextRequest, "kind" | "code">;
  if (outsideOrdinary.length > 0 && !redArtifactConstraint) {
    classification = {
      kind: "approval-needed",
      code: "boundary-review-needed",
    };
  } else if (agentsWrites.length > 0) {
    const targetMismatch = agentsWrites.some(
      (ref) =>
        boundary.agents.impact === "none" ||
        boundary.agents.target === undefined ||
        ref.path !== boundary.agents.target,
    );
    classification = targetMismatch
      ? { kind: "approval-needed", code: "agents-contract-insufficient" }
      : { kind: "paused", code: "agents-write-parent-owned" };
  } else if (redArtifactConstraint) {
    classification = { kind: "retryable", code: "red-artifact-constraint" };
  } else if (agentsRequested.length > 0) {
    classification = { kind: "paused", code: "agents-context-needed" };
  } else {
    classification = {
      kind: "retryable",
      code:
        request.code === "task-split-needed"
          ? "task-split-needed"
          : "approved-context-needed",
    };
  }
  return {
    ...classification,
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
      attempts++;
      if (result !== undefined) {
        schema = "invalid";
        failure = {
          kind: "artifact",
          code: "invalid-structural-result",
          stage: "structural-submit",
        };
        throw new Error("candidate terminal result already submitted");
      }
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
      let refs: CandidateContextRef[];
      try {
        refs = normalizeCandidateContextRefs(value.refs);
      } catch (error) {
        schema = "invalid";
        failure = {
          kind: "artifact",
          code: "invalid-structural-result",
          stage: "structural-submit",
        };
        throw error;
      }
      result = {
        kind: "context-request",
        candidateId: input.identity.candidateId,
        code: value.code as Extract<
          CandidateArtifactSubmissionResult,
          { kind: "context-request" }
        >["code"],
        refs,
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

export function createStructuredPatchTool(input: {
  requestId: string;
  taskId?: string;
  role: string;
  phase: string;
  workspaceRoot: string;
  writePaths: string[];
  deletePaths: string[];
}) {
  let submitted: DiffResult | CandidateContextRequest | undefined;
  let failure: CandidateFailure | undefined;
  let attempts = 0;
  let schema: SubmitSchemaState = "not-submitted";
  let identity: IdentityOutcome = {
    request: true,
    role: true,
    task: true,
    phase: true,
  };
  const candidateId = input.requestId;
  const tool = defineTool({
    name: "abel_submit_result",
    label: "Submit Abel Structured Patch",
    description:
      "Submit one complete structured patch. Unified-diff headers and hunks are generated by the trusted control plane.",
    executionMode: "sequential",
    parameters: candidateArtifactSchema(candidateId),
    async execute(_toolCallId, params) {
      attempts += 1;
      if (submitted !== undefined) {
        schema = "invalid";
        failure = {
          kind: "artifact",
          code: "invalid-structural-result",
          stage: "structural-submit",
        };
        throw new Error("structured patch terminal result already submitted");
      }
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
      if (value.candidateId !== candidateId) {
        identity.request = false;
        schema = "invalid";
        failure = {
          kind: "artifact",
          code: "structural-identity-mismatch",
          stage: "structural-submit",
        };
        throw new Error("diagnosis candidate identity mismatch");
      }
      if (value.kind === "context-request") {
        let refs: CandidateContextRef[];
        try {
          refs = normalizeCandidateContextRefs(value.refs);
        } catch (error) {
          schema = "invalid";
          failure = {
            kind: "artifact",
            code: "invalid-structural-result",
            stage: "structural-submit",
          };
          throw error;
        }
        submitted = {
          kind: "context-request",
          candidateId,
          code: value.code as CandidateContextRequest["code"],
          refs,
        };
        schema = "valid";
        return {
          content: [
            { type: "text" as const, text: "Context request accepted." },
          ],
          details: { accepted: true },
          terminate: true,
        };
      }
      if (value.kind !== "candidate-patch") {
        schema = "invalid";
        failure = {
          kind: "artifact",
          code: "invalid-structural-result",
          stage: "structural-submit",
        };
        throw new Error("diagnosis result must be a patch or context request");
      }
      let compiled: ReturnType<typeof compileCandidatePatch>;
      try {
        compiled = compileCandidatePatch({
          root: input.workspaceRoot,
          operations: value.operations as CandidatePatchOperation[],
          writePaths: input.writePaths,
          deletePaths: input.deletePaths,
          maxBytes: LIMITS.maxCompleteResultBytes,
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
      const result: DiffResult = {
        id: input.requestId,
        role: input.role,
        kind: "diff",
        taskId: input.taskId ?? input.requestId,
        phase: input.phase,
        summary:
          "Trusted control plane generated this diff from structured operations.",
        diff: compiled,
        expectedVerification: "parent-owned verification contract",
        risks: [],
        contractCompliant: true,
      };
      const validation = validateDiffResult(result);
      if (!validation.ok) {
        schema = "invalid";
        failure = validation.failure ?? {
          kind: "artifact",
          code: "invalid-structural-result",
          stage: "structural-submit",
        };
        throw new Error(validation.reason ?? "structured patch is invalid");
      }
      submitted = result;
      schema = "valid";
      return {
        content: [{ type: "text" as const, text: "Abel patch accepted." }],
        details: { accepted: true },
        terminate: true,
      };
    },
  });
  return {
    tool,
    getResult: () =>
      submitted === undefined ? undefined : structuredClone(submitted),
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
      if (submitted !== undefined) {
        schema = "invalid";
        failure = {
          kind: "artifact",
          code: "invalid-structural-result",
          stage: "structural-submit",
        };
        throw new Error("duplicate structural submission");
      }
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
