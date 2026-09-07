import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { ArtifactStore } from "../src/artifact-store.ts";
import {
  inspectCandidateArtifact,
  sealCandidateArtifact,
} from "../src/candidate-artifact.ts";
import {
  type BeginCandidateInput,
  TASK_LEDGER_LIMITS,
  TaskLedger,
} from "../src/task-ledger.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function fixture(content = "new") {
  const root = mkdtempSync(path.join(tmpdir(), "cadence-artifact-test-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const artifacts = new ArtifactStore(path.join(root, "artifacts"));
  const options = { root: path.join(root, "ledger"), artifacts };
  const ledgers: TaskLedger[] = [];
  const open = () => {
    const ledger = new TaskLedger(options);
    ledgers.push(ledger);
    return ledger;
  };
  cleanups.push(() => {
    for (const ledger of ledgers) ledger.close();
  });
  const identity: BeginCandidateInput = {
    candidateId: "candidate-test",
    runId: "run-test",
    deliveryRevision: 1,
    taskId: "task-test",
    phase: "green",
    attemptId: "attempt-test",
    approvedPaths: ["src/value.ts"],
    isolatedRevisionId: "a".repeat(64),
    verificationId: "verification-test",
    routeId: "route-test",
    routeFingerprint: "b".repeat(64),
  };
  const bytes = Buffer.from(
    `--- a/src/value.ts\n+++ b/src/value.ts\n@@ -1 +1 @@\n-old\n+${content}\n`,
  );
  const ledger = open();
  const input = {
    ledger,
    identity,
    approvedPaths: identity.approvedPaths,
    proposal: { kind: "candidate" as const, bytes },
  };
  const seal = () => {
    const inspected = inspectCandidateArtifact(input);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) throw new Error("fixture-inspection-failed");
    const sealed = sealCandidateArtifact({ ...input, bytes: inspected.bytes });
    if (!sealed.ok) throw new Error("fixture-sealing-failed");
    return {
      kind: "sealed-candidate" as const,
      candidateId: identity.candidateId,
      artifactHash: sealed.artifactHash,
      bytes: bytes.length,
      paths: inspected.paths,
    };
  };
  return { input, bytes, open, seal };
}

it("retains complete multi-segment bytes across storage reopen", () => {
  const value = fixture("é".repeat(TASK_LEDGER_LIMITS.maxSegmentBytes));
  const proposal = value.seal();
  value.input.ledger.close();
  const inspected = inspectCandidateArtifact({
    ...value.input,
    ledger: value.open(),
    proposal,
  });
  expect(inspected).toEqual({
    ok: true,
    bytes: value.bytes,
    paths: ["src/value.ts"],
  });
  expect(proposal.artifactHash).toBe(
    createHash("sha256").update(value.bytes).digest("hex"),
  );
});

it("checks retained candidates against current authority rather than their old identity", () => {
  const value = fixture();
  const proposal = value.seal();
  expect(
    inspectCandidateArtifact({
      ...value.input,
      proposal,
      approvedPaths: ["src/other.ts"],
    }),
  ).toEqual({
    ok: false,
    code: "write-set-mismatch",
    stage: "candidate-boundary",
  });
});

it("distinguishes a malformed claimed path from sealed-byte corruption", () => {
  const value = fixture();
  const proposal = value.seal();
  expect(
    inspectCandidateArtifact({
      ...value.input,
      proposal: { ...proposal, paths: ["src/other.ts"] },
    }),
  ).toEqual({
    ok: false,
    code: "candidate-diff-invalid",
    stage: "candidate-seal",
  });
  expect(() =>
    inspectCandidateArtifact({
      ...value.input,
      proposal: { ...proposal, artifactHash: "f".repeat(64) },
    }),
  ).toThrow("candidate-seal-integrity-invalid");
});

it("rejects invalid UTF-8 before it can become verification evidence", () => {
  const value = fixture();
  expect(
    inspectCandidateArtifact({
      ...value.input,
      proposal: { kind: "candidate", bytes: Buffer.from([0xff]) },
    }),
  ).toEqual({
    ok: false,
    code: "candidate-diff-invalid",
    stage: "candidate-diff",
  });
});
