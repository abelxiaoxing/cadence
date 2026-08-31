import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { ArtifactStore } from "../src/artifact-store.ts";

const RED_IDENTITY = "[CADENCE-V2:T5-worker-artifacts-ledger]";
const roots: string[] = [];
type ModuleRecord = Record<string, unknown>;

interface LedgerApi {
  beginCandidate(input: Record<string, unknown>): Record<string, unknown>;
  appendCandidateSegment(
    input: Record<string, unknown>,
  ): Record<string, unknown>;
  sealCandidate(input: Record<string, unknown>): Record<string, unknown>;
  readSealedCandidate(candidateId: string): Uint8Array;
  openTask(input: Record<string, unknown>): Record<string, unknown>;
  commitVerifiedEvent(input: Record<string, unknown>): Record<string, unknown>;
  commitVerifiedEvents(events: Record<string, unknown>[]): void;
  putDurableFact(factKey: string, fact: unknown): unknown;
  durableFact(factKey: string): unknown | undefined;
  commitTaskCompletion(input: {
    events: Record<string, unknown>[];
    factKey: string;
    fact: unknown;
  }): unknown;
  recordWorkerClaim(input: Record<string, unknown>): Record<string, unknown>;
  projection(input: Record<string, unknown>): Record<string, unknown>;
  close(): void;
}

interface LedgerConstructor {
  new (options: Record<string, unknown>): LedgerApi;
}

let ledgerModule: ModuleRecord | null = null;

beforeAll(async () => {
  try {
    ledgerModule = (await import("../src/task-ledger.ts")) as ModuleRecord;
  } catch {
    ledgerModule = null;
  }
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function temporaryRoot(label: string): string {
  const root = mkdtempSync(path.join(tmpdir(), `cadence-ledger-${label}-`));
  roots.push(root);
  return root;
}

function requiredExport<T>(name: string): T {
  expect(
    ledgerModule,
    `${RED_IDENTITY}: task ledger module must exist`,
  ).not.toBeNull();
  expect(
    ledgerModule?.[name],
    `${RED_IDENTITY}: ${name} must be exported`,
  ).toBeTypeOf("function");
  return ledgerModule?.[name] as T;
}

function fixture(label: string) {
  const privateRoot = temporaryRoot(label);
  const artifacts = new ArtifactStore(path.join(privateRoot, "artifacts"));
  const ledgerRoot = path.join(privateRoot, "ledger");
  const TaskLedger = requiredExport<LedgerConstructor>("TaskLedger");
  return {
    privateRoot,
    artifacts,
    ledgerRoot,
    ledger: new TaskLedger({ root: ledgerRoot, artifacts }),
    TaskLedger,
  };
}

function candidateIdentity(candidateId: string) {
  return {
    candidateId,
    runId: "run-t5-ledger",
    deliveryRevision: 1,
    taskId: "T5-worker-artifacts-ledger",
    phase: "red",
    attemptId: "attempt-red-1",
    approvedPaths: ["src/value.ts"],
    isolatedRevisionId: "a".repeat(64),
    verificationId: "T5-worker-artifacts-ledger-red",
    routeId: "implementation-primary",
    routeFingerprint: "f".repeat(64),
  };
}

function append(
  ledger: LedgerApi,
  identity: ReturnType<typeof candidateIdentity>,
  sequence: number,
  bytes: Uint8Array,
) {
  return ledger.appendCandidateSegment({
    ...identity,
    sequence,
    bytes,
    segmentHash: sha256(bytes),
  });
}

const ordinaryDiff = Buffer.from(
  [
    "--- a/src/value.ts",
    "+++ b/src/value.ts",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "",
  ].join("\n"),
);

describe("bounded sealed candidate protocol", () => {
  it("seals ordered exact bytes and survives a new ledger process", () => {
    const value = fixture("seal");
    const identity = candidateIdentity("candidate-sealed");
    value.ledger.beginCandidate(identity);
    const split = 31;
    append(value.ledger, identity, 0, ordinaryDiff.subarray(0, split));
    append(value.ledger, identity, 1, ordinaryDiff.subarray(split));
    expect(() =>
      value.ledger.readSealedCandidate(identity.candidateId),
    ).toThrow(/candidate-not-sealed/u);

    expect(
      value.ledger.sealCandidate({
        ...identity,
        segmentCount: 2,
        totalBytes: ordinaryDiff.byteLength,
        candidateHash: sha256(ordinaryDiff),
      }),
    ).toMatchObject({
      ok: true,
      state: "sealed",
      artifactHash: sha256(ordinaryDiff),
      bytes: ordinaryDiff.byteLength,
      paths: ["src/value.ts"],
    });
    value.ledger.close();

    const restarted = new value.TaskLedger({
      root: value.ledgerRoot,
      artifacts: value.artifacts,
    });
    expect(
      Buffer.from(restarted.readSealedCandidate(identity.candidateId)),
    ).toEqual(ordinaryDiff);
    expect(
      restarted.sealCandidate({
        ...identity,
        segmentCount: 2,
        totalBytes: ordinaryDiff.byteLength,
        candidateHash: sha256(ordinaryDiff),
      }),
    ).toMatchObject({ ok: true, state: "sealed", replayed: true });
    restarted.close();
  });

  it("rejects wrong order, duplicates, identity drift, hash drift, and incomplete seals", () => {
    const { ledger } = fixture("rejections");

    const order = candidateIdentity("candidate-order");
    ledger.beginCandidate(order);
    expect(() => append(ledger, order, 1, Buffer.from("late"))).toThrow(
      /candidate-segment-order-invalid/u,
    );
    append(ledger, order, 0, Buffer.from("first"));
    expect(() => append(ledger, order, 0, Buffer.from("duplicate"))).toThrow(
      /candidate-segment-order-invalid/u,
    );

    const hash = candidateIdentity("candidate-hash");
    ledger.beginCandidate(hash);
    expect(() =>
      ledger.appendCandidateSegment({
        ...hash,
        sequence: 0,
        bytes: Buffer.from("bytes"),
        segmentHash: "0".repeat(64),
      }),
    ).toThrow(/candidate-segment-hash-invalid/u);

    const identity = candidateIdentity("candidate-identity");
    ledger.beginCandidate(identity);
    expect(() =>
      append(
        ledger,
        { ...identity, attemptId: "attempt-red-2" },
        0,
        Buffer.from("bytes"),
      ),
    ).toThrow(/candidate-identity-mismatch/u);

    const incomplete = candidateIdentity("candidate-incomplete");
    ledger.beginCandidate(incomplete);
    append(ledger, incomplete, 0, ordinaryDiff);
    expect(
      ledger.sealCandidate({
        ...incomplete,
        segmentCount: 2,
        totalBytes: ordinaryDiff.byteLength,
        candidateHash: sha256(ordinaryDiff),
      }),
    ).toMatchObject({
      ok: false,
      state: "unsealed",
      code: "candidate-incomplete",
    });
    expect(() => ledger.readSealedCandidate(incomplete.candidateId)).toThrow(
      /candidate-not-sealed/u,
    );
  });

  it("pauses capacity exhaustion as needs-task-split without a partial candidate", () => {
    const { ledger } = fixture("capacity");
    const identity = candidateIdentity("candidate-capacity");
    ledger.beginCandidate(identity);
    const segment = Buffer.alloc(128 * 1024, 0x61);
    for (let sequence = 0; sequence < 64; sequence++) {
      expect(append(ledger, identity, sequence, segment)).toMatchObject({
        ok: true,
        state: "unsealed",
      });
    }
    expect(append(ledger, identity, 64, Buffer.from("x"))).toMatchObject({
      ok: false,
      state: "paused",
      code: "needs-task-split",
      limitBytes: 8 * 1024 * 1024,
    });
    expect(() => ledger.readSealedCandidate(identity.candidateId)).toThrow(
      /candidate-not-sealed/u,
    );
  });
});

describe("restart-safe task evidence", () => {
  it("projects committed Red facts into a fresh Green Worker and ignores claims", () => {
    const value = fixture("projection");
    value.ledger.openTask({
      runId: "run-ledger-projection",
      deliveryRevision: 3,
      taskId: "task-ledger-projection",
      boundaryHash: "b".repeat(64),
      objective: "Implement the approved bounded task",
      contextRefs: [
        { kind: "path", path: "src/value.ts", hash: "c".repeat(64) },
      ],
      initialPhase: "red",
    });
    value.ledger.commitVerifiedEvent({
      runId: "run-ledger-projection",
      taskId: "task-ledger-projection",
      eventId: "red-verified",
      kind: "phase-verified",
      phase: "red",
      commandId: "task-red-command",
      exitCode: 1,
      expectedClassification: "expected-red",
      actualClassification: "expected-red",
      diagnostic: { kind: "assertion", id: "target-defect" },
      artifactHash: "d".repeat(64),
      isolatedRevisionId: "e".repeat(64),
      outputFacts: [],
      routeId: "implementation-primary",
      routeFingerprint: "f".repeat(64),
    });
    expect(
      value.ledger.recordWorkerClaim({
        runId: "run-ledger-projection",
        taskId: "task-ledger-projection",
        phase: "green",
        claim: "verification passed without a control-plane command",
      }),
    ).toEqual({ accepted: false, reason: "worker-claim-untrusted" });
    value.ledger.close();

    const restarted = new value.TaskLedger({
      root: value.ledgerRoot,
      artifacts: value.artifacts,
    });
    expect(
      restarted.projection({
        runId: "run-ledger-projection",
        taskId: "task-ledger-projection",
        nextPhase: "green",
      }),
    ).toMatchObject({
      runId: "run-ledger-projection",
      taskId: "task-ledger-projection",
      deliveryRevision: 3,
      currentPhase: "green",
      objective: "Implement the approved bounded task",
      history: [
        {
          ordinal: 1,
          kind: "phase-verified",
          phase: "red",
          commandId: "task-red-command",
          exitCode: 1,
          expectedClassification: "expected-red",
          actualClassification: "expected-red",
          diagnostic: { kind: "assertion", id: "target-defect" },
          artifactHash: "d".repeat(64),
          isolatedRevisionId: "e".repeat(64),
        },
      ],
    });
    restarted.close();
  });

  it("persists baseline facts and atomically commits repair evidence with task completion", () => {
    const value = fixture("durable-completion");
    const runId = "run-ledger-durable-completion";
    const taskId = "task-ledger-durable-completion";
    value.ledger.openTask({
      runId,
      deliveryRevision: 1,
      taskId,
      boundaryHash: "1".repeat(64),
      objective: "Persist normalized verification and repair facts",
      contextRefs: [],
      initialPhase: "red",
    });
    value.ledger.putDurableFact("verification-baseline", {
      revisionId: "2".repeat(64),
      failures: ["3".repeat(64)],
    });
    expect(value.ledger.durableFact("verification-baseline")).toEqual({
      revisionId: "2".repeat(64),
      failures: ["3".repeat(64)],
    });
    expect(() =>
      value.ledger.putDurableFact("verification-baseline", {
        revisionId: "4".repeat(64),
        failures: [],
      }),
    ).toThrow(/ledger-fact-conflict/u);

    value.ledger.commitVerifiedEvent({
      runId,
      taskId,
      eventId: "red-verified",
      kind: "phase-verified",
      phase: "red",
      commandId: "durable-red",
      exitCode: 1,
      expectedClassification: "expected-red",
      actualClassification: "expected-red",
      diagnostic: { kind: "assertion", id: "durable-red-witness" },
      artifactHash: "5".repeat(64),
      isolatedRevisionId: "6".repeat(64),
      outputFacts: [],
      routeId: "implementation-primary",
      routeFingerprint: "f".repeat(64),
    });
    const green = {
      runId,
      taskId,
      eventId: "green-verified",
      kind: "phase-verified",
      phase: "green",
      commandId: "durable-green",
      exitCode: 0,
      expectedClassification: "expected-green",
      actualClassification: "expected-green",
      diagnostic: { kind: "assertion", id: "durable-green-pass" },
      artifactHash: "7".repeat(64),
      isolatedRevisionId: "8".repeat(64),
      outputFacts: [],
      routeId: "implementation-primary",
      routeFingerprint: "f".repeat(64),
    };
    const repair = {
      runId,
      taskId,
      eventId: "repair-verified",
      kind: "repair-verified",
      phase: "green",
      attempt: 1,
      commandId: "durable-repair",
      exitCode: 0,
      diagnostic: { kind: "assertion", id: "durable-repair-pass" },
      artifactHash: "9".repeat(64),
      isolatedRevisionId: "a".repeat(64),
      outputFacts: [],
      attribution: "introduced",
      failureIdentities: ["b".repeat(64)],
      routeId: "implementation-secondary",
      routeFingerprint: "e".repeat(64),
    };
    expect(() =>
      value.ledger.commitTaskCompletion({
        events: [green, { ...repair, failureIdentities: [] }],
        factKey: "task-final-durable",
        fact: { taskId, isolatedRevisionId: "a".repeat(64) },
      }),
    ).toThrow(/ledger-event-field-invalid/u);
    expect(
      value.ledger.projection({ runId, taskId, nextPhase: "green" }).history,
    ).toHaveLength(1);
    expect(value.ledger.durableFact("task-final-durable")).toBeUndefined();

    value.ledger.commitTaskCompletion({
      events: [green, repair],
      factKey: "task-final-durable",
      fact: {
        taskId,
        phase: "green",
        isolatedRevisionId: "a".repeat(64),
        attribution: "introduced",
        repairAttempts: 1,
      },
    });
    expect(
      value.ledger.projection({ runId, taskId, nextPhase: "green" }).history,
    ).toMatchObject([
      { ordinal: 1, kind: "phase-verified", phase: "red" },
      { ordinal: 2, kind: "phase-verified", phase: "green" },
      {
        ordinal: 3,
        kind: "repair-verified",
        attribution: "introduced",
        failureIdentities: ["b".repeat(64)],
      },
    ]);
    value.ledger.close();

    const restarted = new value.TaskLedger({
      root: value.ledgerRoot,
      artifacts: value.artifacts,
    });
    expect(restarted.durableFact("verification-baseline")).toMatchObject({
      revisionId: "2".repeat(64),
    });
    expect(restarted.durableFact("task-final-durable")).toMatchObject({
      taskId,
      isolatedRevisionId: "a".repeat(64),
      repairAttempts: 1,
    });
    expect(
      restarted.projection({ runId, taskId, nextPhase: "green" }).history,
    ).toHaveLength(3);
    restarted.close();
  });

  it("never persists raw prompts, transcripts, model output, or raw logs", () => {
    const value = fixture("privacy");
    const secret = "SECRET_RAW_CHILD_TRANSCRIPT_9b8f";
    value.ledger.openTask({
      runId: "run-ledger-privacy",
      deliveryRevision: 1,
      taskId: "task-ledger-privacy",
      boundaryHash: "f".repeat(64),
      objective: "Use only approved structural evidence",
      contextRefs: [],
      initialPhase: "red",
    });
    expect(
      value.ledger.recordWorkerClaim({
        runId: "run-ledger-privacy",
        taskId: "task-ledger-privacy",
        phase: "red",
        rawPrompt: secret,
        transcript: secret,
        modelOutput: secret,
      }),
    ).toEqual({ accepted: false, reason: "worker-claim-untrusted" });
    expect(() =>
      value.ledger.commitVerifiedEvent({
        runId: "run-ledger-privacy",
        taskId: "task-ledger-privacy",
        eventId: "unsafe-event",
        kind: "phase-verified",
        phase: "red",
        commandId: "task-red-command",
        exitCode: 1,
        expectedClassification: "expected-red",
        actualClassification: "expected-red",
        diagnostic: { kind: "assertion", id: "safe-id" },
        artifactHash: "1".repeat(64),
        isolatedRevisionId: "2".repeat(64),
        outputFacts: [],
        routeId: "implementation-primary",
        routeFingerprint: "f".repeat(64),
        rawLog: secret,
      }),
    ).toThrow(/ledger-event-field-invalid/u);
    const projection = value.ledger.projection({
      runId: "run-ledger-privacy",
      taskId: "task-ledger-privacy",
      nextPhase: "red",
    });
    expect(Buffer.byteLength(JSON.stringify(projection))).toBeLessThanOrEqual(
      64 * 1024,
    );
    value.ledger.close();

    const persisted = readdirSync(value.ledgerRoot)
      .filter((name) => name.includes("sqlite"))
      .map((name) => readFileSync(path.join(value.ledgerRoot, name)))
      .map((bytes) => bytes.toString("utf8"))
      .join("\n");
    expect(persisted).not.toContain(secret);
    expect(JSON.stringify(projection)).not.toContain(secret);
  });
});
