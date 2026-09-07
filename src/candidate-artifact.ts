import { createHash } from "node:crypto";
import { diffWritePaths } from "./contracts.ts";
import {
  type BeginCandidateInput,
  TASK_LEDGER_LIMITS,
  type TaskLedger,
} from "./task-ledger.ts";
import type { DurableCandidateProposal } from "./workflow-policy.ts";

type ArtifactProposal = Extract<
  DurableCandidateProposal,
  { kind: "candidate" | "sealed-candidate" }
>;
interface CandidateArtifactInput {
  ledger: TaskLedger;
  identity: BeginCandidateInput;
  proposal: ArtifactProposal;
}

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/** Inspect the same sealed bytes for normal phases and repairs. Callers own recovery policy. */
export function inspectCandidateArtifact({
  ledger,
  identity,
  proposal,
  approvedPaths,
}: CandidateArtifactInput & { approvedPaths: readonly string[] }):
  | { ok: true; bytes: Buffer; paths: string[] }
  | {
      ok: false;
      code: "candidate-diff-invalid" | "write-set-mismatch";
      stage: string;
    } {
  const invalid = (stage: string) => ({
    ok: false as const,
    code: "candidate-diff-invalid" as const,
    stage,
  });
  ledger.beginCandidate(identity);
  let bytes: Buffer;
  if (proposal.kind === "sealed-candidate") {
    if (
      proposal.candidateId !== identity.candidateId ||
      !/^[a-f0-9]{64}$/u.test(proposal.artifactHash) ||
      !Number.isSafeInteger(proposal.bytes) ||
      proposal.bytes < 1 ||
      !Array.isArray(proposal.paths)
    )
      return invalid("candidate-seal");
    bytes = Buffer.from(ledger.readSealedCandidate(identity.candidateId));
    if (
      bytes.length !== proposal.bytes ||
      sha256(bytes) !== proposal.artifactHash
    ) {
      throw new Error("candidate-seal-integrity-invalid");
    }
  } else {
    if (
      !(proposal.bytes instanceof Uint8Array) ||
      proposal.bytes.length === 0
    ) {
      return invalid("candidate-submit");
    }
    bytes = Buffer.from(proposal.bytes);
  }
  let paths: string[];
  try {
    paths = diffWritePaths(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ).paths;
  } catch {
    return invalid("candidate-diff");
  }
  if (paths.some((relative) => !approvedPaths.includes(relative))) {
    return {
      ok: false,
      code: "write-set-mismatch",
      stage: "candidate-boundary",
    };
  }
  if (
    proposal.kind === "sealed-candidate" &&
    JSON.stringify([...proposal.paths].sort()) !==
      JSON.stringify([...paths].sort())
  ) {
    return invalid("candidate-seal");
  }
  return { ok: true, bytes, paths };
}

/** Seal after isolated patch/dependency checks, before any phase verification. */
export function sealCandidateArtifact({
  ledger,
  identity,
  proposal,
  bytes,
}: CandidateArtifactInput & { bytes: Buffer }):
  | { ok: true; artifactHash: string }
  | { ok: false; kind: "paused" | "retryable"; code: string; stage: string } {
  if (proposal.kind === "sealed-candidate")
    return { ok: true, artifactHash: proposal.artifactHash };
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
    const accepted = ledger.appendCandidateSegment({
      ...identity,
      sequence,
      bytes: segment,
      segmentHash: sha256(segment),
    });
    if (!accepted.ok)
      return {
        ok: false,
        kind: "paused",
        code: accepted.code,
        stage: "candidate-segment",
      };
    sequence++;
  }
  const sealed = ledger.sealCandidate({
    ...identity,
    segmentCount: sequence,
    totalBytes: bytes.length,
    candidateHash: sha256(bytes),
  });
  return sealed.ok
    ? { ok: true, artifactHash: sealed.artifactHash }
    : {
        ok: false,
        kind: "retryable",
        code: sealed.code,
        stage: "candidate-seal",
      };
}
