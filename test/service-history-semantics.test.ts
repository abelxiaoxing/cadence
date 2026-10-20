import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { emptyScan, HistoryReadBudget } from "../src/history/files.ts";
import { HistoryReader } from "../src/history/reader.ts";
import { readRunState } from "../src/history/run-state.ts";
import { COMPLETE } from "../src/history/types.ts";
import { HistoryWriter } from "../src/history/writer.ts";
import { hash } from "../src/service/private-files.ts";
import {
  canonicalJson,
  type Graph,
  LIMITS,
  type OwnerRecordingInput,
  publicError,
  type RunIdentity,
} from "../src/service-contract.ts";
import {
  admitFixtureRun,
  failedCompletion,
  historyFixture,
  ownerFact,
  prepareFixtureChild,
  settleFixtureRun,
} from "./helpers/history-fixture.ts";
import { graphPage } from "./helpers/history-point-pages.ts";
import { selectLegacy } from "./helpers/history-publication-fixture.ts";

async function active() {
  const f = historyFixture();
  expect((await f.writer.commit(f.intent)).status).toBe("committed");
  const identity = await admitFixtureRun(f);
  return { ...f, identity };
}
async function closedChild(f: ReturnType<typeof historyFixture>) {
  await prepareFixtureChild(f);
  expect(
    (await f.writer.processes.launchIntent(f.link, f.intent.operationId))
      .status,
  ).toBe("committed");
  const completion = failedCompletion(f.link.childRunId);
  const result = await f.writer.processes.settlement(f.link, completion);
  if (result.status !== "committed")
    throw new Error("No native fixture settlement");
  return { completion, seq: result.batch.committedSeq };
}
function allocation(f: ReturnType<typeof historyFixture>): RunIdentity {
  return {
    operationId: f.intent.operationId,
    commandId: f.intent.commandId,
    kind: "generate-plan",
    context: f.context,
    assignments: [{ assignmentId: "one", childRunId: f.link.childRunId }],
    graph: null,
  };
}

it("immutable admission file precedes public acknowledgment but is not committed membership", async () => {
  let release!: () => void, reached!: () => void;
  const gate = new Promise<void>((yes) => {
    release = yes;
  });
  const entered = new Promise<void>((yes) => {
    reached = yes;
  });
  const f = historyFixture({
    observeWrite: async (at) => {
      if (at === "run-admission") {
        reached();
        await gate;
      }
    },
  });
  await f.writer.commit(f.intent);
  const pending = f.writer.admitRun(f.link.runId, allocation(f));
  await entered;
  try {
    expect(existsSync(f.files.admissionPath(f.link.runId))).toBe(true);
    expect(HistoryReader.open(f.c)!.inspect().committedSeq).toBe("1");
    expect(() =>
      HistoryReader.open(f.c)!.admission(f.link.runId, "1"),
    ).toThrow();
    expect(() => f.writer.capture(f.link)).toThrow();
  } finally {
    release();
  }
  expect((await pending).status).toBe("committed");
  expect(
    HistoryReader.open(f.c)!.admission(f.link.runId, f.writer.committedSeq)
      .identity,
  ).toEqual(allocation(f));
  expect(f.writer.currentContext(f.link.taskId)?.controlRev).toBe(2);
});

for (const mismatch of ["command", "operation", "context"] as const)
  it(`run admission rejects ${mismatch} substitution before immutable file creation`, async () => {
    const f = historyFixture();
    await f.writer.commit(f.intent);
    const identity = allocation(f);
    if (mismatch === "command") identity.commandId = randomUUID();
    if (mismatch === "operation") identity.operationId = randomUUID();
    if (mismatch === "context")
      identity.context = { ...identity.context, configRev: 2 };
    expect((await f.writer.admitRun(f.link.runId, identity)).status).toBe(
      "refused",
    );
    expect(existsSync(f.files.admissionPath(f.link.runId))).toBe(false);
    expect(f.writer.committedSeq).toBe("1");
  });

it("accepted but unallocated crash history never supplies current authority or launch permission", async () => {
  const f = historyFixture();
  await f.writer.commit(f.intent);
  const restarted = new HistoryWriter(f.lease);
  expect(restarted.quarantined).toBe(true);
  expect(restarted.currentContext(f.link.taskId)).toBeNull();
  expect(
    (await restarted.processes.launchIntent(f.link, f.intent.operationId))
      .status,
  ).toBe("refused");
  expect((await restarted.lookup(f.intent.commandId)).status).toBe("found");
});

for (const mismatch of ["child", "selection", "epoch"] as const)
  it(`auth preparation binds admitted ${mismatch} without equating auth and parent operation IDs`, async () => {
    const f = await active();
    const intent = {
      operationId: randomUUID(),
      epoch: f.link.epoch,
      runId: f.link.runId,
      childRunId: f.link.childRunId,
      sourceSelectionId: f.context.model.sourceSelectionId,
      validityMs: 1000,
    };
    if (mismatch === "child") intent.childRunId = randomUUID();
    if (mismatch === "selection") intent.sourceSelectionId = randomUUID();
    if (mismatch === "epoch") intent.epoch = randomUUID();
    expect((await f.writer.auth.preparation(intent)).status).toBe("refused");
    expect(f.writer.committedSeq).toBe("2");
  });

for (const mismatch of [
  "child",
  "operation",
  "task",
  "pending-auth",
  "closed-auth",
] as const)
  it(`native launch refuses ${mismatch} before capture authority`, async () => {
    const f = await active();
    const authId = randomUUID();
    expect(
      (
        await f.writer.auth.preparation({
          operationId: authId,
          epoch: f.link.epoch,
          runId: f.link.runId,
          childRunId: f.link.childRunId,
          sourceSelectionId: f.context.model.sourceSelectionId,
          validityMs: 1000,
        })
      ).status,
    ).toBe("committed");
    if (mismatch !== "pending-auth")
      await f.writer.auth.settlement({
        operationId: authId,
        outcome: "resolved",
        admissionClosed: mismatch === "closed-auth",
      });
    const link = { ...f.link };
    if (mismatch === "child") link.childRunId = randomUUID();
    if (mismatch === "task") link.taskId = randomUUID();
    expect(
      (
        await f.writer.processes.launchIntent(
          link,
          mismatch === "operation" ? randomUUID() : f.intent.operationId,
        )
      ).status,
    ).toBe("refused");
    expect(() => f.writer.capture(link)).toThrow();
  });

it("auth operation IDs are independent, single-use and bound to one allocated child", async () => {
  const f = await active();
  const authId = await prepareFixtureChild(f);
  expect(authId).not.toBe(f.intent.operationId);
  expect(
    (await f.writer.processes.launchIntent(f.link, f.intent.operationId))
      .status,
  ).toBe("committed");
  const before = f.writer.committedSeq;
  expect(
    (
      await f.writer.auth.preparation({
        operationId: randomUUID(),
        epoch: f.link.epoch,
        runId: f.link.runId,
        childRunId: f.link.childRunId,
        sourceSelectionId: f.context.model.sourceSelectionId,
        validityMs: 1000,
      })
    ).status,
  ).toBe("refused");
  expect(f.writer.committedSeq).toBe(before);
});

it("exact durable required-set drain releases only the parent reservation and updates restart receipts", async () => {
  const f = await active();
  await closedChild(f);
  expect(f.writer.accounting.episodes.count).toBe(1);
  expect(await f.writer.lookup(f.intent.commandId)).toMatchObject({
    status: "found",
    record: { receipt: { execution: null } },
  });
  const final = await settleFixtureRun(f, "failed");
  expect(final.status).toBe("committed");
  expect(f.writer.accounting.episodes).toEqual({ count: 0, bytes: 0 });
  const receipt = await f.writer.lookup(f.intent.commandId);
  expect(receipt).toMatchObject({
    status: "found",
    record: {
      receipt: { execution: "failed", settlement: { kind: "parent" } },
    },
  });
  const restart = new HistoryWriter(f.lease);
  expect(restart.quarantined).toBe(false);
  expect(await restart.lookup(f.intent.commandId)).toEqual(receipt);
  expect(restart.currentContext(f.link.taskId)).toBeNull();
});

for (const mismatch of [
  "watermark",
  "native",
  "missing-child",
  "unfinished-auth",
] as const)
  it(`parent drain rejects ${mismatch} rather than releasing the episode`, async () => {
    const f = historyFixture();
    await f.writer.commit(f.intent);
    const other = randomUUID();
    const identity = await admitFixtureRun(f, [f.link.childRunId, other]);
    const { completion, seq } = await closedChild(f);
    if (mismatch === "unfinished-auth")
      await f.writer.auth.preparation({
        operationId: randomUUID(),
        epoch: f.link.epoch,
        runId: f.link.runId,
        childRunId: other,
        sourceSelectionId: f.context.model.sourceSelectionId,
        validityMs: 1000,
      });
    const required = identity.assignments.map((a) =>
      a.childRunId === f.link.childRunId
        ? {
            ...a,
            native: { ...completion.native },
            recording: completion.recording,
            settlementSeq: seq,
          }
        : {
            ...a,
            native: null,
            recording: {
              status: "refused" as const,
              selected: null,
              error: publicError("unavailable"),
            },
            settlementSeq: null,
          },
    );
    if (mismatch === "watermark") required[0].settlementSeq = "2";
    if (mismatch === "native") required[0].native!.exitCode = 2;
    if (mismatch === "missing-child") required.pop();
    expect(
      (
        await ownerFact(f, {
          kind: "parent-settled",
          runId: f.link.runId,
          settlement: { kind: "parent", outcome: "failed", required },
        })
      ).status,
    ).toBe("refused");
    expect(f.writer.accounting.episodes.count).toBe(1);
  });

it("original canceled auth settlement can commit after another child quarantines without clearing its process fence", async () => {
  const f = historyFixture();
  await f.writer.commit(f.intent);
  const other = randomUUID();
  await admitFixtureRun(f, [f.link.childRunId, other]);
  await prepareFixtureChild(f);
  await f.writer.processes.launchIntent(f.link, f.intent.operationId);
  const operationId = randomUUID();
  await f.writer.auth.preparation({
    operationId,
    epoch: f.link.epoch,
    runId: f.link.runId,
    childRunId: other,
    sourceSelectionId: f.context.model.sourceSelectionId,
    validityMs: 1000,
  });
  const completion = failedCompletion(f.link.childRunId);
  completion.native = {
    ...completion.native,
    outcome: "unknown",
    closure: "unconfirmed",
    exitCode: null,
    cleanup: "unconfirmed",
  };
  expect((await f.writer.processes.settlement(f.link, completion)).status).toBe(
    "committed",
  );
  expect(f.writer.quarantined).toBe(true);
  expect(
    (
      await f.writer.auth.settlement({
        operationId,
        outcome: "resolved",
        admissionClosed: true,
      })
    ).status,
  ).toBe("committed");
  const state = readRunState(f.files, f.link.runId);
  expect(state.auth.get(operationId)?.result?.admissionClosed).toBe(true);
  expect(
    state.children.get(f.link.childRunId)?.completion?.native.closure,
  ).toBe("unconfirmed");
  expect(f.writer.quarantined).toBe(true);
  expect(f.writer.accounting.episodes.count).toBe(1);
  expect(new HistoryWriter(f.lease).quarantined).toBe(true);
});

it("fresh control revision cannot admit a second active episode for one task", async () => {
  const f = await active();
  const context = f.writer.currentContext(f.link.taskId)!;
  const intent = {
    ...f.intent,
    commandId: randomUUID(),
    operationId: randomUUID(),
    runId: randomUUID(),
    identity: {
      kind: "action" as const,
      expected: context,
      action: { kind: "generate-plan" as const, taskId: f.link.taskId },
    },
  };
  expect(await f.writer.commit(intent)).toMatchObject({
    status: "refused",
    error: { code: "conflict" },
  });
  expect(f.writer.accounting.episodes.count).toBe(1);
  expect((await settleFixtureRun(f, "blocked")).status).toBe("committed");
  expect((await f.writer.commit(intent)).status).toBe("committed");
  expect(f.writer.accounting.episodes.count).toBe(1);
});

it("held checkout gate prevents reserve release until its committed release fact", async () => {
  const f = await active();
  expect(
    (
      await ownerFact(f, {
        kind: "gate",
        lane: "reader",
        state: "held",
        checkoutGeneration: 0,
      })
    ).status,
  ).toBe("committed");
  await closedChild(f);
  expect((await settleFixtureRun(f, "failed")).status).toBe("committed");
  expect(f.writer.accounting.episodes.count).toBe(1);
  expect(
    (
      await ownerFact(f, {
        kind: "gate",
        lane: "reader",
        state: "released",
        checkoutGeneration: 0,
      })
    ).status,
  ).toBe("committed");
  expect(f.writer.accounting.episodes.count).toBe(0);
});

it("publication receipts require exact recorded intent and retain execution separately", async () => {
  const f = await active();
  await settleFixtureRun(f, "blocked");
  const publicationId = randomUUID();
  expect(
    (
      await ownerFact(f, {
        kind: "publication-intent",
        publicationId,
        expectedRevision: 1,
        expectedIdentity: "a".repeat(64),
        nextRevision: 2,
        nextIdentity: "b".repeat(64),
      })
    ).status,
  ).toBe("committed");
  expect(
    (
      await ownerFact(f, {
        kind: "publication-settled",
        publicationId,
        status: "conflict",
        observed: { revision: 1, identity: "c".repeat(64) },
      })
    ).status,
  ).toBe("committed");
  expect(await f.writer.lookup(f.intent.commandId)).toMatchObject({
    status: "found",
    record: {
      receipt: {
        execution: "blocked",
        publication: "conflict",
        committedSeq: f.writer.committedSeq,
      },
    },
  });
  expect(await new HistoryWriter(f.lease).lookup(f.intent.commandId)).toEqual(
    await f.writer.lookup(f.intent.commandId),
  );
});

it("publication cannot claim a different written identity", async () => {
  const f = await active();
  const publicationId = randomUUID();
  await ownerFact(f, {
    kind: "publication-intent",
    publicationId,
    expectedRevision: 1,
    expectedIdentity: "a".repeat(64),
    nextRevision: 2,
    nextIdentity: "b".repeat(64),
  });
  expect(
    (
      await ownerFact(f, {
        kind: "publication-settled",
        publicationId,
        status: "published",
        observed: { revision: 2, identity: "c".repeat(64) },
      })
    ).status,
  ).toBe("refused");
});

it("ledger read budget reserves native payload size before any selected segment read", async () => {
  const f = await active();
  const read = vi.spyOn(f.files.files, "read");
  const budget = new HistoryReadBudget();
  budget.reserve(LIMITS.searchBytes - 1);
  expect(() => [...f.files.scan(emptyScan(), false, budget)]).toThrow();
  expect(
    read.mock.calls.filter(([path]) => path.endsWith(".jsonl")),
  ).toHaveLength(0);
  read.mockRestore();
});

async function graphFixture() {
  const f = historyFixture();
  const detailId = randomUUID();
  const input: OwnerRecordingInput = {
    observedMs: 0,
    link: {
      epoch: f.link.epoch,
      taskId: f.link.taskId,
      runId: null,
      operationId: randomUUID(),
    },
    events: [
      {
        kind: "content-begin",
        detailId,
        field: "plan",
        encoding: "utf8",
        owner: {
          taskId: f.link.taskId,
          runId: null,
          childRunId: null,
          entity: { kind: "task", id: f.link.taskId, version: 1 },
        },
      },
      { kind: "content-chunk", detailId, text: "A readable retained plan" },
      { kind: "content-end", detailId, coverage: COMPLETE },
    ],
  };
  const lease = f.writer.owner().reserve({
    sourceFrames: 0,
    retainedBytes: 0,
    outputBytes: Buffer.byteLength(canonicalJson(input)),
    outputChunks: 3,
    lane: "data",
  });
  if (lease.status !== "reserved") throw new Error("No lease");
  const content = await lease.reservation.commit(input);
  if (content.status !== "committed") throw new Error("No plan");
  const graph: Graph = {
    schema: "cadence-graph/2",
    taskId: f.link.taskId,
    taskKind: "research",
    taskRevision: 1,
    revision: 1,
    planRevision: 1,
    plan: content.batch.ownerDetails[0].content,
    assignments: [
      {
        id: "one",
        purpose: "research",
        instructions: "Inspect only",
        expectedOutput: "Findings",
        role: { role: "design-explorer", sha256: "a".repeat(64) },
        model: f.context.model,
        dependencies: [],
      },
    ],
  };
  f.context.task = {
    ...f.context.task!,
    graphRevision: 1,
    graphIdentity: hash(canonicalJson(graph)),
  };
  f.writer.supplyContext(f.context);
  f.intent.identity = {
    kind: "action",
    expected: f.context,
    action: { kind: "start", taskId: f.link.taskId },
  };
  await f.writer.commit(f.intent);
  const identity: RunIdentity = {
    ...allocation(f),
    kind: "start",
    graph: {
      recordId: randomUUID(),
      revision: 1,
      sha256: hash(canonicalJson(graph)),
    },
  };
  return { ...f, graph, identity };
}

it("frozen graphs and historical model selection survive unavailable current authority without reader writes", async () => {
  const f = await graphFixture();
  expect(
    (await f.writer.admitRun(f.link.runId, f.identity, f.graph)).status,
  ).toBe("committed");
  const request = {
    storeId: f.files.format.storeId,
    scope: { kind: "run" as const, id: f.link.runId },
    snapshotSeq: f.writer.committedSeq,
    graph: f.identity.graph!,
  };
  const before = readFileSync(f.files.admissionPath(f.link.runId));
  const reader = HistoryReader.open(f.c)!;
  const writes = vi.spyOn(f.files.files, "create");
  expect((await graphPage(reader, request)).graph).toEqual(f.graph);
  const restart = new HistoryWriter(f.lease);
  expect(restart.currentContext(f.link.taskId)).toBeNull();
  expect(
    (await graphPage(HistoryReader.open(f.c)!, request)).graph.assignments[0]
      .model,
  ).toEqual(f.context.model);
  expect(writes).not.toHaveBeenCalled();
  writes.mockRestore();
  expect(readFileSync(f.files.admissionPath(f.link.runId))).toEqual(before);
  await expect(
    reader.graph({ ...request, snapshotSeq: "9999" }),
  ).rejects.toThrow();
  await expect(
    reader.graph({ ...request, scope: { kind: "child", id: randomUUID() } }),
  ).rejects.toThrow();
});

it("changed immutable admission bytes refuse selected history without repair", async () => {
  const f = await active();
  const path = f.files.admissionPath(f.link.runId);
  const stored = JSON.parse(readFileSync(path, "utf8"));
  stored.identity.context.model.model = "different";
  writeFileSync(path, JSON.stringify(stored));
  const before = readFileSync(path);
  expect(() => HistoryReader.open(f.c)!.inspect()).toThrow();
  expect(readFileSync(path)).toEqual(before);
});

it("uncommitted preserved immutable admission cannot be adopted as an acknowledged run", async () => {
  const f = historyFixture({
    observeWrite: (at) => {
      if (at === "run-admission") throw new Error("injected crash window");
    },
  });
  await f.writer.commit(f.intent);
  expect((await f.writer.admitRun(f.link.runId, allocation(f))).status).toBe(
    "refused",
  );
  expect(existsSync(f.files.admissionPath(f.link.runId))).toBe(true);
  expect(HistoryReader.open(f.c)!.inspect().committedSeq).toBe("1");
  expect(() => HistoryReader.open(f.c)!.admission(f.link.runId, "1")).toThrow();
});

it("graph hash and exact allocation order cannot be substituted", async () => {
  const f = await graphFixture();
  expect(() =>
    f.writer.admitRun(f.link.runId, f.identity, { ...f.graph, revision: 2 }),
  ).toThrow();
  expect(() =>
    f.writer.admitRun(
      f.link.runId,
      {
        ...f.identity,
        assignments: [
          { assignmentId: "different", childRunId: f.link.childRunId },
        ],
      },
      f.graph,
    ),
  ).toThrow();
  expect(
    existsSync(join(f.files.directory, "runs", f.link.runId, "admission.json")),
  ).toBe(false);
});

it("checks retain their own native settlement, exact confirmed selection and no SDK fiction", async () => {
  const f = historyFixture();
  f.context.task!.kind = "code";
  f.writer.supplyContext(f.context);
  const check = {
    kind: "configured" as const,
    name: "Unit",
    command: "true",
    timeoutMs: 1000,
  };
  f.intent.identity = {
    kind: "action",
    expected: f.context,
    action: { kind: "check", taskId: f.link.taskId, check },
  };
  await f.writer.commit(f.intent);
  const identity: RunIdentity = {
    ...allocation(f),
    kind: "check",
    assignments: [],
  };
  expect((await f.writer.admitRun(f.link.runId, identity)).status).toBe(
    "committed",
  );
  const checkId = randomUUID(),
    before = {
      identity: f.context.observation.identity,
      complete: true,
      checkoutGeneration: 0,
    };
  expect(
    (
      await ownerFact(f, {
        kind: "check-start",
        checkId,
        selection: check,
        cwdId: f.context.cwdId,
        cwdLabel: f.root,
        checkEnvGeneration: 1,
        before,
      })
    ).status,
  ).toBe("committed");
  expect(
    (
      await ownerFact(f, {
        kind: "check-settled",
        checkId,
        before,
        after: before,
        output: null,
        coverage: COMPLETE,
        status: "passed",
        native: {
          outcome: "completed",
          closure: "direct-child-closed",
          exitCode: 0,
          signal: null,
          durationMs: 1,
          stdin: "not-required",
        },
      })
    ).status,
  ).toBe("committed");
  expect(f.writer.accounting.episodes.count).toBe(0);
  expect(await f.writer.lookup(f.intent.commandId)).toMatchObject({
    status: "found",
    record: {
      receipt: {
        execution: "completed",
        settlement: {
          kind: "check",
          native: { stdin: "not-required" },
          settlementSeq: f.writer.committedSeq,
        },
      },
    },
  });
  expect(new HistoryWriter(f.lease).quarantined).toBe(false);
});

it("check-start cannot substitute another command for the confirmed check", async () => {
  const f = historyFixture();
  f.context.task!.kind = "code";
  f.writer.supplyContext(f.context);
  const check = {
    kind: "configured" as const,
    name: "Unit",
    command: "true",
    timeoutMs: 1000,
  };
  f.intent.identity = {
    kind: "action",
    expected: f.context,
    action: { kind: "check", taskId: f.link.taskId, check },
  };
  await f.writer.commit(f.intent);
  await f.writer.admitRun(f.link.runId, {
    ...allocation(f),
    kind: "check",
    assignments: [],
  });
  expect(
    (
      await ownerFact(f, {
        kind: "check-start",
        checkId: randomUUID(),
        selection: { ...check, command: "false" },
        cwdId: f.context.cwdId,
        cwdLabel: f.root,
        checkEnvGeneration: 1,
        before: {
          identity: f.context.observation.identity,
          complete: true,
          checkoutGeneration: 0,
        },
      })
    ).status,
  ).toBe("refused");
});

it("sequential summary publication identities advance independently of execution", async () => {
  const f = historyFixture();
  selectLegacy(f);
  await f.writer.commit(f.intent);
  await admitFixtureRun(f);
  for (let revision = 1; revision <= 2; revision++) {
    const result = await f.writer.publishTask({
      operationId: f.intent.operationId,
    });
    expect(result.status).toBe("published");
    expect(result.observed).toEqual({
      revision: revision + 1,
      identity: f.c.store.loadSnapshot(f.link.taskId)!.identity,
    });
  }
  expect(await f.writer.lookup(f.intent.commandId)).toMatchObject({
    status: "found",
    record: { receipt: { execution: null, publication: "published" } },
  });
  await settleFixtureRun(f, "blocked");
  expect(await f.writer.lookup(f.intent.commandId)).toMatchObject({
    status: "found",
    record: {
      receipt: {
        execution: "blocked",
        publication: "published",
        committedSeq: f.writer.committedSeq,
      },
    },
  });
});

it("returned command objects cannot mutate the writer's admitted command authority", async () => {
  const f = historyFixture();
  const result = await f.writer.commit(f.intent);
  if (result.status !== "committed") throw new Error("No command");
  if (result.record.identity.kind !== "action") throw new Error("No action");
  result.record.identity.expected.model.model = "caller-mutated";
  expect((await f.writer.admitRun(f.link.runId, allocation(f))).status).toBe(
    "committed",
  );
  expect(
    HistoryReader.open(f.c)!.admission(f.link.runId, f.writer.committedSeq)
      .identity.context.model.model,
  ).toBe("fixed");
});

it("allocated child IDs cannot be reused by a later admitted episode", async () => {
  const f = await active();
  await settleFixtureRun(f, "blocked");
  const context = f.writer.currentContext(f.link.taskId)!;
  const intent = {
    ...f.intent,
    commandId: randomUUID(),
    operationId: randomUUID(),
    runId: randomUUID(),
    identity: {
      kind: "action" as const,
      expected: context,
      action: { kind: "generate-plan" as const, taskId: f.link.taskId },
    },
  };
  expect((await f.writer.commit(intent)).status).toBe("committed");
  expect(
    (
      await f.writer.admitRun(intent.runId!, {
        ...f.identity,
        context,
        commandId: intent.commandId,
        operationId: intent.operationId,
      })
    ).status,
  ).toBe("refused");
  expect(existsSync(f.files.admissionPath(intent.runId!))).toBe(false);
});

it("child preparation slots are reserved before auth effects and are not just capture-pool limits", async () => {
  const f = historyFixture();
  await f.writer.commit(f.intent);
  const children = [f.link.childRunId, randomUUID(), randomUUID()];
  await admitFixtureRun(f, children);
  for (let i = 0; i < children.length; i++) {
    const result = await f.writer.auth.preparation({
      operationId: randomUUID(),
      epoch: f.link.epoch,
      runId: f.link.runId,
      childRunId: children[i],
      sourceSelectionId: f.context.model.sourceSelectionId,
      validityMs: 1000,
    });
    expect(result.status).toBe(
      i < LIMITS.childReservations ? "committed" : "refused",
    );
  }
});

it("data cannot consume episode control headroom; original failed native settlement can still be recorded", async () => {
  const f = historyFixture({
    episodeReservationBytes: LIMITS.episodeControlBytes + 16 * 1024,
  });
  await f.writer.commit(f.intent);
  await admitFixtureRun(f);
  await prepareFixtureChild(f);
  await f.writer.processes.launchIntent(f.link, f.intent.operationId);
  const messageId = randomUUID(),
    detailId = randomUUID();
  const events = [
    { kind: "ready", requestProtocol: 2 },
    {
      kind: "message-start",
      messageId,
      role: "assistant",
      source: { disposition: "unavailable", value: null },
      resultCallId: null,
    },
    {
      kind: "detail-begin",
      detailId,
      descriptor: {
        owner: { kind: "message-final", messageId },
        field: "final-text",
        encoding: "utf8",
      },
    },
    ...Array.from({ length: 3 }, () => ({
      kind: "stored-chunk",
      detailId,
      text: "x".repeat(8192),
    })),
  ];
  const source = {
    first: 1,
    last: events.length,
    firstObservedMs: 0,
    lastObservedMs: 0,
  };
  const input = {
    link: f.link,
    source,
    events: events.map((event) => ({ source, event })),
  };
  const lease = f.writer.capture(f.link).reserve({
    sourceFrames: events.length,
    retainedBytes: 0,
    outputBytes: Buffer.byteLength(canonicalJson(input)),
    outputChunks: events.length,
    lane: "data",
  });
  if (lease.status !== "reserved") throw new Error("No lease");
  // Decode through the same public boundary, not an accepting fixture recorder.
  const { decodeRecordingInput } = await import("../src/service-contract.ts");
  expect(
    (await lease.reservation.commit(decodeRecordingInput(input))).status,
  ).toBe("refused");
  expect(f.writer.quarantined).toBe(true);
  const completion = failedCompletion(f.link.childRunId);
  const settled = await f.writer.processes.settlement(f.link, completion);
  expect(settled.status).toBe("committed");
  expect((await settleFixtureRun(f, "failed")).status).toBe("committed");
  expect(f.writer.quarantined).toBe(true);
  expect(f.writer.accounting.episodes.count).toBe(0);
  expect(await f.writer.lookup(f.intent.commandId)).toMatchObject({
    status: "found",
    record: { receipt: { execution: "failed" } },
  });
});

it("owner operation metadata has a finite lifetime bound even when each begin lease has settled", async () => {
  const f = historyFixture();
  for (let i = 0; i <= LIMITS.admissionCount; i++) {
    const input: OwnerRecordingInput = {
      link: {
        epoch: f.link.epoch,
        taskId: f.link.taskId,
        runId: null,
        operationId: randomUUID(),
      },
      observedMs: 0,
      events: [
        {
          kind: "content-begin",
          detailId: randomUUID(),
          field: "plan",
          encoding: "utf8",
          owner: {
            taskId: f.link.taskId,
            runId: null,
            childRunId: null,
            entity: { kind: "task", id: f.link.taskId, version: 1 },
          },
        },
      ],
    };
    const r = f.writer.owner().reserve({
      sourceFrames: 0,
      retainedBytes: 0,
      outputBytes: Buffer.byteLength(canonicalJson(input)),
      outputChunks: 1,
      lane: "data",
    });
    if (r.status !== "reserved") throw new Error("No lease");
    expect((await r.reservation.commit(input)).status).toBe(
      i < LIMITS.admissionCount ? "committed" : "refused",
    );
  }
  expect(f.writer.accounting.owner.bytes).toBe(0);
});

it.each(["action", "cancel"] as const)(
  "review: command operation identity cannot be reused by another accepted %s command",
  async (kind) => {
    const f = await active();
    await settleFixtureRun(f, "blocked");
    const context = f.writer.currentContext(f.link.taskId)!;
    const next: import("../src/service/ports.ts").AdmissionIntent = {
      ...f.intent,
      commandId: randomUUID(),
      runId: kind === "cancel" ? f.link.runId : randomUUID(),
      identity:
        kind === "cancel"
          ? { kind: "cancel", epoch: f.link.epoch, runId: f.link.runId }
          : {
              kind: "action" as const,
              expected: context,
              action: { kind: "generate-plan" as const, taskId: f.link.taskId },
            },
    };
    expect(await f.writer.commit(next)).toMatchObject({
      status: "refused",
      error: { code: "conflict" },
    });
  },
);
it("review: check capture gaps survive run projections independently of native zero exit", async () => {
  const f = historyFixture();
  f.context.task!.kind = "code";
  f.writer.supplyContext(f.context);
  const check = {
    kind: "configured" as const,
    name: "Unit",
    command: "true",
    timeoutMs: 1000,
  };
  f.intent.identity = {
    kind: "action",
    expected: f.context,
    action: { kind: "check", taskId: f.link.taskId, check },
  };
  await f.writer.commit(f.intent);
  await f.writer.admitRun(f.link.runId, {
    ...allocation(f),
    kind: "check",
    assignments: [],
  });
  const checkId = randomUUID(),
    before = { ...f.context.observation, checkoutGeneration: 0 };
  await ownerFact(f, {
    kind: "check-start",
    checkId,
    selection: check,
    cwdId: f.context.cwdId,
    cwdLabel: f.root,
    checkEnvGeneration: 1,
    before,
  });
  await ownerFact(f, {
    kind: "check-settled",
    checkId,
    before,
    after: before,
    output: null,
    native: {
      outcome: "completed",
      closure: "direct-child-closed",
      exitCode: 0,
      signal: null,
      durationMs: 1,
      stdin: "not-required",
    },
    status: "failed",
    coverage: { ...COMPLETE, observed: "incomplete", omissions: ["gap"] },
  });
  expect(
    readRunState(f.files, f.link.runId).projections(f.link.epoch)[0],
  ).toMatchObject({
    outcome: "failed",
    coverage: { observed: "incomplete", omissions: ["gap"] },
    settlement: { native: { exitCode: 0 } },
  });
});
it.each(["published", "conflict", "uncertain"] as const)(
  "review: metadata %s publication is observable in its own command receipt",
  async (status) => {
    const f = historyFixture(),
      taskId = randomUUID(),
      context = { ...f.context, task: null },
      operationId = randomUUID(),
      commandId = randomUUID();
    f.writer.supplyContext(context);
    expect(
      (
        await f.writer.commit({
          commandId,
          operationId,
          runId: null,
          createdTaskId: taskId,
          identity: {
            kind: "action",
            expected: context,
            action: { kind: "create", taskKind: "research", goal: "new task" },
          },
        })
      ).status,
    ).toBe("committed");
    const link = { epoch: f.link.epoch, taskId, operationId, runId: null },
      publicationId = randomUUID();
    async function fact(fact: import("../src/service-contract.ts").OwnerFact) {
      const input = {
        link,
        observedMs: 0,
        events: [{ kind: "fact" as const, fact }],
      };
      const lease = f.writer.owner().reserve({
        sourceFrames: 0,
        retainedBytes: 0,
        outputBytes: Buffer.byteLength(canonicalJson(input)),
        outputChunks: 1,
        lane: "control",
      });
      if (lease.status !== "reserved") throw Error("reserve");
      return lease.reservation.commit(input);
    }
    if (status === "published") {
      expect(
        (await f.writer.publishTask({ operationId, cwd: f.root })).status,
      ).toBe("published");
    } else {
      expect(
        (
          await fact({
            kind: "publication-intent",
            publicationId,
            expectedRevision: 0,
            expectedIdentity: null,
            nextRevision: 1,
            nextIdentity: "b".repeat(64),
          })
        ).status,
      ).toBe("committed");
      expect(
        (
          await fact({
            kind: "publication-settled",
            publicationId,
            status,
            observed: null,
          })
        ).status,
      ).toBe("committed");
    }
    expect(await f.writer.lookup(commandId)).toMatchObject({
      status: "found",
      record: {
        receipt: {
          publication: status,
          committedSeq: f.writer.committedSeq,
          created: { state: status === "published" ? "published" : "reserved" },
        },
      },
    });
    expect(f.writer.quarantined).toBe(status !== "published");
  },
);
it("review: owner content chunks cannot change their original task/run linkage", async () => {
  const f = historyFixture(),
    detailId = randomUUID(),
    operationId = randomUUID();
  const link = {
    epoch: f.link.epoch,
    taskId: f.link.taskId,
    runId: null,
    operationId,
  };
  async function put(input: OwnerRecordingInput) {
    const r = f.writer.owner().reserve({
      sourceFrames: 0,
      retainedBytes: 0,
      outputBytes: Buffer.byteLength(canonicalJson(input)),
      outputChunks: input.events.length,
      lane: "data",
    });
    if (r.status !== "reserved") throw Error("reserve");
    return r.reservation.commit(input);
  }
  expect(
    (
      await put({
        link,
        observedMs: 0,
        events: [
          {
            kind: "content-begin",
            detailId,
            owner: {
              taskId: link.taskId,
              runId: null,
              childRunId: null,
              entity: { kind: "task", id: link.taskId, version: 1 },
            },
            field: "plan",
            encoding: "utf8",
          },
        ],
      })
    ).status,
  ).toBe("committed");
  const seq = f.writer.committedSeq;
  expect(
    (
      await put({
        link: { ...link, taskId: randomUUID() },
        observedMs: 0,
        events: [
          { kind: "content-chunk", detailId, text: "wrong owner" },
          { kind: "content-end", detailId, coverage: COMPLETE },
        ],
      })
    ).status,
  ).toBe("refused");
  expect(f.writer.committedSeq).toBe(seq);
});
it("review: verifying scan accounts artifact payload IO before reading it", async () => {
  const f = historyFixture(),
    detailId = randomUUID();
  const input: OwnerRecordingInput = {
    observedMs: 0,
    link: {
      epoch: f.link.epoch,
      taskId: f.link.taskId,
      runId: null,
      operationId: randomUUID(),
    },
    events: [
      {
        kind: "content-begin",
        detailId,
        owner: {
          taskId: f.link.taskId,
          runId: null,
          childRunId: null,
          entity: { kind: "task", id: f.link.taskId, version: 1 },
        },
        field: "plan",
        encoding: "utf8",
      },
      { kind: "content-chunk", detailId, text: "x".repeat(8192) },
      { kind: "content-end", detailId, coverage: COMPLETE },
    ],
  };
  const lease = f.writer.owner().reserve({
    sourceFrames: 0,
    retainedBytes: 0,
    outputBytes: Buffer.byteLength(canonicalJson(input)),
    outputChunks: 3,
    lane: "data",
  });
  if (lease.status !== "reserved") throw Error("reserve");
  await lease.reservation.commit(input);
  const budget = new HistoryReadBudget();
  const size =
    readFileSync(f.files.segmentPath(1)).length +
    readFileSync(join(f.files.directory, "format.json")).length;
  budget.reserve(LIMITS.searchBytes - size - 100);
  const reads = vi.spyOn(f.files.files, "read");
  try {
    expect(() => [...f.files.scan(emptyScan(), true, budget)]).toThrow();
    expect(reads.mock.calls.some(([path]) => path.endsWith(".part"))).toBe(
      false,
    );
  } finally {
    reads.mockRestore();
  }
});
it("review: unknown checkout gate fences immediately without inventing process settlement", async () => {
  const f = await active();
  expect(
    (
      await ownerFact(f, {
        kind: "gate",
        lane: "reader",
        state: "unknown",
        checkoutGeneration: 0,
      })
    ).status,
  ).toBe("committed");
  expect(f.writer.quarantined).toBe(true);
  expect(f.writer.accounting.episodes.count).toBe(1);
  expect(
    readRunState(f.files, f.link.runId).projections(f.link.epoch)[0],
  ).toMatchObject({ reason: "quarantine", settlement: null });
});
it("review: auth preparation cannot alias its accepted parent command operation", async () => {
  const f = await active();
  expect(
    (
      await f.writer.auth.preparation({
        operationId: f.intent.operationId,
        epoch: f.link.epoch,
        runId: f.link.runId,
        childRunId: f.link.childRunId,
        sourceSelectionId: f.context.model.sourceSelectionId,
        validityMs: 1000,
      })
    ).status,
  ).toBe("refused");
});
