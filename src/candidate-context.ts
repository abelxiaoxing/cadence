import { isAgentsPath, isValidRelativePath } from "./contracts.ts";
import type { BeginCandidateInput, TaskLedger } from "./task-ledger.ts";
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
