import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HistoryFiles } from "../../src/history/files.ts";
import { readRunState } from "../../src/history/run-state.ts";
import { COMPLETE } from "../../src/history/types.ts";
import {
  HistoryWriter,
  type HistoryWriterOptions,
} from "../../src/history/writer.ts";
import { ServiceCoordination } from "../../src/service/coordination.ts";
import type { AdmissionIntent } from "../../src/service/ports.ts";
import type {
  ContextVersion,
  OwnerFact,
  OwnerRecordingInput,
  RecordingLink,
  RunIdentity,
  WorkerCompletion,
} from "../../src/service-contract.ts";
import { canonicalJson, publicError } from "../../src/service-contract.ts";
export function historyFixture(
  options: HistoryWriterOptions = {},
  directory?: string,
) {
  const dir = directory ?? mkdtempSync(join(tmpdir(), "cadence-w3-"));
  const root = join(dir, "project");
  mkdirSync(root, { recursive: true });
  const c = new ServiceCoordination(root, join(dir, "state"));
  const lease = c.acquire({
    schema: "cadence-service-owner-config/1",
    endpoint: "http://127.0.0.1:17423",
    policyIdentity: "a".repeat(64),
  });
  const files = HistoryFiles.initialize(lease);
  const writer = new HistoryWriter(lease, options);
  const taskId = randomUUID(),
    runId = randomUUID(),
    childRunId = randomUUID(),
    operationId = randomUUID();
  const context: ContextVersion = {
    epoch: lease.registration.epoch,
    accessGeneration: 1,
    configRev: 1,
    controlRev: 1,
    workspaceId: files.format.workspaceId,
    cwdId: randomUUID(),
    model: {
      sourceSelectionId: randomUUID(),
      provider: "fixture",
      model: "fixed",
      api: "openai-completions",
      thinking: "off",
    },
    checkEnvGeneration: 1,
    checkoutGeneration: 0,
    observation: { identity: "a".repeat(64), complete: true },
    task: {
      id: taskId,
      kind: "research",
      revision: 1,
      identity: "a".repeat(64),
      graphRevision: null,
      graphIdentity: null,
    },
  };
  writer.supplyContext(context);
  const intent: AdmissionIntent = {
    commandId: randomUUID(),
    operationId,
    runId,
    createdTaskId: null,
    identity: {
      kind: "action",
      expected: context,
      action: { kind: "generate-plan", taskId },
    },
  };
  const link: RecordingLink = {
    epoch: context.epoch,
    taskId,
    runId,
    childRunId,
  };
  return { dir, root, c, lease, files, writer, context, intent, link };
}

/** Fabricated owner/auth facts only; the native C1 case uses real OwnerModelContext instead. */
export async function admitFixtureRun(
  f: ReturnType<typeof historyFixture>,
  children = [f.link.childRunId],
) {
  const identity: RunIdentity = {
    operationId: f.intent.operationId,
    commandId: f.intent.commandId,
    kind: "generate-plan",
    context: f.context,
    graph: null,
    assignments: children.map((childRunId, i) => ({
      assignmentId: i ? `child-${i}` : "one",
      childRunId,
    })),
  };
  const result = await f.writer.admitRun(f.link.runId, identity);
  if (result.status !== "committed")
    throw new Error("Fixture run admission refused");
  return identity;
}
export async function prepareFixtureChild(
  f: ReturnType<typeof historyFixture>,
) {
  const operationId = randomUUID();
  const first = await f.writer.auth.preparation({
    operationId,
    epoch: f.link.epoch,
    runId: f.link.runId,
    childRunId: f.link.childRunId,
    sourceSelectionId: f.context.model.sourceSelectionId,
    validityMs: 1000,
  });
  if (first.status !== "committed")
    throw new Error("Fixture auth intent refused");
  const last = await f.writer.auth.settlement({
    operationId,
    outcome: "resolved",
    admissionClosed: false,
  });
  if (last.status !== "committed")
    throw new Error("Fixture auth settlement refused");
  return operationId;
}
export async function ownerFact(
  f: ReturnType<typeof historyFixture>,
  fact: OwnerFact,
) {
  const input: OwnerRecordingInput = {
    link: {
      epoch: f.link.epoch,
      taskId: f.link.taskId,
      runId: f.link.runId,
      operationId: f.intent.operationId,
    },
    observedMs: 0,
    events: [{ kind: "fact", fact }],
  };
  const lease = f.writer.owner().reserve({
    sourceFrames: 0,
    retainedBytes: 0,
    outputBytes: Buffer.byteLength(canonicalJson(input)),
    outputChunks: 1,
    lane: "control",
  });
  if (lease.status !== "reserved")
    throw new Error("Fixture owner reservation refused");
  return lease.reservation.commit(input);
}
export async function settleFixtureRun(
  f: ReturnType<typeof historyFixture>,
  outcome: "completed" | "failed" | "blocked" | "canceled" = "completed",
) {
  const state = readRunState(f.files, f.link.runId);
  if (!state.admission) throw new Error("Fixture admission absent");
  return ownerFact(f, {
    kind: "parent-settled",
    runId: f.link.runId,
    settlement: {
      kind: "parent",
      outcome,
      required: state.admission.assignments.map((a) => {
        const child = state.children.get(a.childRunId);
        return {
          ...a,
          native: child?.completion?.native ?? null,
          settlementSeq: child?.settlementSeq ?? null,
          recording: child?.completion?.recording ?? {
            status: "refused",
            selected: null,
            error: publicError("unavailable"),
          },
        };
      }),
    },
  });
}

export function failedCompletion(childRunId: string): WorkerCompletion {
  return {
    childRunId,
    native: {
      outcome: "failed",
      closure: "direct-child-closed",
      exitCode: 1,
      signal: null,
      durationMs: 1,
      stdin: "delivered",
      final: "missing",
      cleanup: "settled",
      capture: COMPLETE,
    },
    selected: null,
    recording: {
      status: "refused",
      selected: null,
      error: {
        code: "invalid",
        effect: "none",
        recovery: "fresh-confirmation",
      },
    },
  };
}
