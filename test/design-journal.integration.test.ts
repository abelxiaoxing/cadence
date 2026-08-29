import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DesignEvidenceResult } from "../src/contracts.ts";
import { validatePacketEnvelope } from "../src/contracts.ts";
import { DesignJournal } from "../src/design-journal.ts";
import { RunStore } from "../src/run-store.ts";
import { resolveStateRoot } from "../src/state-root.ts";

const roots: string[] = [];
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture(label: string) {
  const consumerRoot = mkdtempSync(
    path.join(tmpdir(), `abel-design-journal-consumer-${label}-`),
  );
  const stateHome = mkdtempSync(
    path.join(tmpdir(), `abel-design-journal-state-${label}-`),
  );
  roots.push(consumerRoot, stateHome);
  const stateRoot = resolveStateRoot({ consumerRoot, xdgStateHome: stateHome });
  const runs = RunStore.open(stateRoot);
  const run = runs.startRun({
    stage: "abel-design",
    change: "close-design-loop",
    operationId: "start-design",
  });
  return { stateRoot, runs, run };
}

function evidence(
  packetId = "inspect-control-plane",
  secret = "raw child prose must not be stored",
): DesignEvidenceResult {
  return {
    id: packetId,
    role: "design-explorer",
    kind: "evidence",
    packet_id: packetId,
    module_name: "control-plane",
    scope: ["src"],
    files_read: ["src/run-store.ts"],
    evidence: [
      {
        claim: secret,
        path: "src/run-store.ts",
        line_start: 1,
        line_end: 8,
      },
    ],
    existing_structures: [secret],
    existing_conventions: [secret],
    constraints_discovered: [secret],
    open_questions: [],
    dependencies: [],
    write_set_hints: ["src/design-journal.ts"],
    validation_hints: [secret],
    agents_impact_hints: [],
    risks: [secret],
    success_criteria_hints: [secret],
  };
}

function designPacket(runId?: string) {
  return {
    stage: "abel-design",
    role: "design-explorer",
    ...(runId ? { runId } : {}),
    id: "inspect-control-plane",
    phase: "evidence",
    objective: "Inspect the durable Design boundary",
    roots: ["."],
    context: { agents: "root", contract: "read-only evidence" },
    declared: {
      read: ["src/run-store.ts"],
      write: [],
      conflicts: [],
      resources: [],
    },
    output: "evidence",
  };
}

describe("run-bound durable Design evidence", () => {
  it("requires a Design run identity while Diagnose packets remain independent", () => {
    expect(validatePacketEnvelope(designPacket()).ok).toBe(false);
    expect(validatePacketEnvelope(designPacket("run-123")).ok).toBe(true);

    const diagnose = {
      ...designPacket(),
      stage: "abel-diagnose",
      role: "diagnosis-worker",
      id: "diagnose-one",
      phase: "evidence",
    };
    expect(validatePacketEnvelope(diagnose).ok).toBe(true);
  });

  it("survives restart, replays identical evidence, and rejects conflicts", () => {
    const { stateRoot, runs, run } = fixture("restart");
    let journal = DesignJournal.open(stateRoot);
    const accepted = journal.recordEvidence({
      runId: run.runId,
      evidence: evidence(),
    });
    expect(
      journal.recordEvidence({ runId: run.runId, evidence: evidence() }),
    ).toEqual(accepted);
    expect(() =>
      journal.recordEvidence({
        runId: run.runId,
        evidence: evidence("inspect-control-plane", "different claim"),
      }),
    ).toThrow(/design-evidence-conflict/u);
    journal.close();
    runs.close();

    const reopenedRuns = RunStore.open(stateRoot);
    journal = DesignJournal.open(stateRoot);
    expect(journal.status(run.runId)).toMatchObject({
      runId: run.runId,
      change: "close-design-loop",
      evidence: [
        {
          packetId: "inspect-control-plane",
          resultHash: accepted.resultHash,
          recordHash: accepted.recordHash,
          citations: [
            {
              path: "src/run-store.ts",
              lineStart: 1,
              lineEnd: 8,
              claimHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
            },
          ],
        },
      ],
    });
    journal.close();
    reopenedRuns.close();
  });

  it("rejects absent, non-Design, and different-root run identities", () => {
    const local = fixture("local");
    const foreign = fixture("foreign");
    const implement = local.runs.startRun({
      stage: "abel-implement",
      change: "implement-only",
      operationId: "start-implement",
    });
    const journal = DesignJournal.open(local.stateRoot);
    for (const runId of ["missing-run", implement.runId, foreign.run.runId]) {
      expect(() =>
        journal.recordEvidence({ runId, evidence: evidence() }),
      ).toThrow(/design-run-invalid/u);
    }
    journal.close();
    local.runs.close();
    foreign.runs.close();
  });
});

describe("durable Design finalization ownership", () => {
  it("fences an active owner and permits recovery only after expiry", () => {
    const { stateRoot, runs, run } = fixture("finalization-lease");
    let now = 1_000;
    const journal = DesignJournal.open(stateRoot, {
      now: () => now,
      finalizationLeaseMs: 100,
    });
    const owner = journal.acquireFinalizationLease({
      runId: run.runId,
      operationId: "finalize-owner",
    });
    expect(() =>
      journal.acquireFinalizationLease({
        runId: run.runId,
        operationId: "finalize-competitor",
      }),
    ).toThrow(/design-finalization-busy/u);
    expect(() => journal.assertFinalizationLease(owner)).not.toThrow();

    now = owner.expiresAt + 1;
    const recovered = journal.acquireFinalizationLease({
      runId: run.runId,
      operationId: "finalize-recovered",
    });
    expect(recovered.token).not.toBe(owner.token);
    expect(() => journal.assertFinalizationLease(owner)).toThrow(
      /design-finalization-lease-fenced/u,
    );
    expect(() => journal.assertFinalizationLease(recovered)).not.toThrow();
    journal.releaseFinalizationLease(recovered);
    journal.close();
    runs.close();
  });
});

describe("durable Design decisions and Gate currentness", () => {
  it("invalidates both Gates for behavior and only Gate B for technical changes", () => {
    const { stateRoot, runs, run } = fixture("currentness");
    const journal = DesignJournal.open(stateRoot);
    journal.recordDecision({
      runId: run.runId,
      operationId: "behavior-v1",
      decisionId: "observable-contract",
      category: "behavior",
      contractHash: HASH_A,
      refs: ["specs/example/spec.md#Behavior/First"],
    });
    const gateA = journal.approveGate({
      runId: run.runId,
      operationId: "approve-a-v1",
      gate: "gate-a",
      contractHash: HASH_A,
    });
    const planBytes = Buffer.from('{"plan":"one"}\n');
    journal.recordCompiledPlan({
      runId: run.runId,
      operationId: "compile-v1",
      bytes: planBytes,
      rawSha256: createHash("sha256").update(planBytes).digest("hex"),
      canonicalHash: HASH_B,
    });
    const gateB = journal.approveGate({
      runId: run.runId,
      operationId: "approve-b-v1",
      gate: "gate-b",
      contractHash: HASH_B,
    });
    expect(journal.status(run.runId).gates).toMatchObject({
      gateA: { current: true, proof: gateA.proof },
      gateB: { current: true, proof: gateB.proof },
    });

    journal.recordDecision({
      runId: run.runId,
      operationId: "technical-v2",
      decisionId: "storage-contract",
      category: "technical",
      contractHash: HASH_C,
      refs: ["design.md#Decisions"],
    });
    expect(journal.status(run.runId).gates).toMatchObject({
      gateA: { current: true },
      gateB: { current: false, staleReason: "technical-decision-changed" },
    });

    journal.approveGate({
      runId: run.runId,
      operationId: "approve-b-v2",
      gate: "gate-b",
      contractHash: HASH_B,
    });
    journal.recordDecision({
      runId: run.runId,
      operationId: "behavior-v2",
      decisionId: "observable-contract",
      category: "behavior",
      contractHash: HASH_C,
      refs: ["specs/example/spec.md#Behavior/Second"],
    });
    expect(journal.status(run.runId).gates).toMatchObject({
      gateA: { current: false, staleReason: "behavior-decision-changed" },
      gateB: { current: false, staleReason: "behavior-decision-changed" },
    });
    journal.close();
    runs.close();
  });

  it("replays approval operations and rejects a conflicting operation body", () => {
    const { stateRoot, runs, run } = fixture("operation-replay");
    const journal = DesignJournal.open(stateRoot);
    const input = {
      runId: run.runId,
      operationId: "approve-a-once",
      gate: "gate-a" as const,
      contractHash: HASH_A,
    };
    const first = journal.approveGate(input);
    expect(journal.approveGate(input)).toEqual(first);
    expect(journal.status(run.runId).gates.gateA.proof?.revision).toBe(1);
    expect(() =>
      journal.approveGate({ ...input, contractHash: HASH_B }),
    ).toThrow(/design-operation-conflict/u);
    journal.close();
    runs.close();
  });

  it("projects bounded state without persisting unfiltered child output", () => {
    const { stateRoot, runs, run } = fixture("privacy");
    const journal = DesignJournal.open(stateRoot);
    const forbidden = "credential=do-not-persist";
    journal.recordEvidence({
      runId: run.runId,
      evidence: evidence("private-evidence", forbidden),
    });
    journal.recordDecision({
      runId: run.runId,
      operationId: "bounded-decision",
      decisionId: "behavior-contract",
      category: "behavior",
      contractHash: HASH_A,
      refs: ["proposal.md#What Changes"],
    });
    const status = journal.status(run.runId);
    expect(status).toMatchObject({
      decisions: [
        {
          decisionId: "behavior-contract",
          category: "behavior",
          revision: 1,
          contractHash: HASH_A,
        },
      ],
      plan: null,
    });
    expect(JSON.stringify(status)).not.toContain(forbidden);
    journal.close();
    runs.close();
  });
});
