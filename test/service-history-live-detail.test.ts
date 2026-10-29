import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { HistoryFiles } from "../src/history/files.ts";
import { HistoryLive, scopedSnapshot } from "../src/history/live.ts";
import { HistoryNavigation } from "../src/history/navigation.ts";
import {
  HistoryProjection,
  type ReadEnvironment,
} from "../src/history/projection.ts";
import { HistoryReader } from "../src/history/reader.ts";
import { COMPLETE } from "../src/history/types.ts";
import {
  HistoryWriter,
  type HistoryWriterOptions,
} from "../src/history/writer.ts";
import {
  ContractError,
  canonicalJson,
  type ListRequest,
  type LiveEvent,
  type OwnerRecordingInput,
  publicError,
  type ReadCursor,
} from "../src/service-contract.ts";
import type { TaskRecord } from "../src/task-types.ts";
import { entityData, historyData } from "./helpers/history-data-read.ts";
import {
  admitFixtureRun,
  historyFixture,
  ownerFact,
  settleFixtureRun,
} from "./helpers/history-fixture.ts";
import { historyPhaseMetrics } from "./helpers/history-phase-metrics.ts";
import { detailPage, searchPages } from "./helpers/history-read-fixture.ts";

function environment(f: ReturnType<typeof historyFixture>): ReadEnvironment {
  return {
    session: () => ({
      protocol: 1,
      storeId: f.files.format.storeId,
      epoch: f.link.epoch,
      authority: "local",
      accessGeneration: 1,
      csrf: null,
      capabilities: { actions: false, manualChecks: false, history: true },
    }),
    workspace: () => ({
      rootLabel: "fixture",
      models: [],
      context: {
        status: "unavailable",
        workspaceId: f.files.format.workspaceId,
        taskId: null,
        error: publicError("unavailable"),
      },
    }),
    context: (taskId) => ({
      status: "available",
      version: { ...f.context, task: { ...f.context.task!, id: taskId } },
    }),
    checks: () => ({ revision: 1, selections: [] }),
    legacyTasks: () => [],
  };
}
const project = (f: ReturnType<typeof historyFixture>, env = environment(f)) =>
  new HistoryProjection(HistoryReader.open(f.c)!, env);
const request = (
  f: ReturnType<typeof historyFixture>,
  reader: ListRequest["reader"],
): ListRequest => ({
  reader,
  storeId: f.files.format.storeId,
  scope:
    reader === "tasks"
      ? { kind: "workspace", id: f.files.format.workspaceId }
      : { kind: "task", id: f.link.taskId },
  snapshotSeq: null,
  after: null,
  limit: 50,
});
async function record(
  f: ReturnType<typeof historyFixture>,
  input: OwnerRecordingInput,
) {
  const lease = f.writer.owner().reserve({
    sourceFrames: 0,
    retainedBytes: 0,
    outputBytes: Buffer.byteLength(canonicalJson(input)),
    outputChunks: input.events.length,
    lane: "data",
  });
  if (lease.status !== "reserved") throw Error("reserve");
  const result = await lease.reservation.commit(input);
  if (result.status !== "committed") throw Error("commit");
  return result.batch;
}
async function draft(f: ReturnType<typeof historyFixture>, text: string) {
  const detailId = randomUUID(),
    link = {
      epoch: f.link.epoch,
      operationId: randomUUID(),
      taskId: f.link.taskId,
      runId: null,
    };
  await record(f, {
    link,
    observedMs: 0,
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
    ],
  });
  const bytes = Buffer.from(text),
    pending = [];
  for (let at = 0; at < bytes.length; ) {
    const events: OwnerRecordingInput["events"] = [];
    for (let n = 0; n < 8 && at < bytes.length; n++) {
      let end = Math.min(at + 8192, bytes.length);
      while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
      events.push({
        kind: "content-chunk",
        detailId,
        text: bytes.subarray(at, end).toString("utf8"),
      });
      at = end;
    }
    pending.push(record(f, { link, observedMs: 0, events }));
  }
  await Promise.all(pending);
  return (
    await record(f, {
      link,
      observedMs: 0,
      events: [{ kind: "content-end", detailId, coverage: COMPLETE }],
    })
  ).ownerDetails[0].content;
}
it("indexed UTF-8 pages revalidate selected bytes without opening unrelated artifact bodies", async () => {
  const f = historyFixture(),
    text = "😀".repeat(260000),
    content = await draft(f, text),
    other = await draft(f, "unrelated body");
  const reader = HistoryReader.open(f.c)!,
    otherDetail = reader.selected({
      storeId: reader.storeId,
      scope: { kind: "task", id: f.link.taskId },
      snapshotSeq: f.writer.committedSeq,
      query: null,
      recordId: other.recordId,
      recordVersion: 1,
      field: "plan",
      offset: 0,
    });
  let path = "";
  for (const batch of f.files.scan())
    for (const row of batch.rows)
      if (row.value.kind === "owner")
        for (const e of row.value.events)
          if (
            e.kind === "chunk" &&
            e.artifact.artifactId === otherDetail.content.recordId
          )
            path = f.files.artifactPath(e.artifact);
  writeFileSync(path, "corrupt unrelated retained bytes");
  const preserved = readFileSync(path);
  const reads = vi.spyOn(HistoryFiles.prototype, "readArtifact");
  const batches = vi.spyOn(HistoryNavigation.prototype, "batch");
  try {
    let cursor: ReadCursor = {
        storeId: reader.storeId,
        scope: { kind: "task", id: f.link.taskId },
        snapshotSeq: f.writer.committedSeq,
        query: null,
        recordId: content.recordId,
        recordVersion: 1,
        field: "plan",
        offset: 0,
      },
      body = "",
      pages = 0;
    for (;;) {
      const page = await reader.detail(cursor);
      body += page.text;
      pages++;
      if (pages === 1) expect(batches.mock.calls.length).toBeLessThanOrEqual(4);
      if (!page.next) break;
      expect(page.next.offset).toBeGreaterThan(cursor.offset);
      cursor = page.next;
    }
    expect(pages).toBeGreaterThan(3);
    expect(body).toBe(text);
    expect(
      reads.mock.calls.every(([ref]) => ref.artifactId === content.recordId),
    ).toBe(true);
    await expect(reader.detail({ ...cursor, offset: 1 })).rejects.toThrow();
    await expect(
      reader.detail({ ...cursor, recordVersion: 2 }),
    ).rejects.toThrow();
    expect(readFileSync(path)).toEqual(preserved);
  } finally {
    reads.mockRestore();
    batches.mockRestore();
  }
}, 15000);
it("legacy task context pages are readonly, byte/version drift invalidates continuations", async () => {
  const f = historyFixture();
  await f.writer.flush();
  const env = environment(f);
  let tasks = [1, 2, 3].map(
    (i) =>
      ({
        schema: "cadence-workflow-assistant/1",
        id: randomUUID(),
        revision: 1,
        kind: "research",
        goal: `legacy ${i}`,
        plan: "old plan",
        cwd: f.root,
        phase: "planning",
        result: "",
        baseline: "",
        checks: [],
        activity: [],
      }) as TaskRecord,
  );
  env.legacyTasks = () => tasks;
  const p = project(f, env),
    first = await historyData(p.tasks.bind(p), {
      ...request(f, "tasks"),
      limit: 1,
    });
  expect(first.records).toHaveLength(1);
  expect(first.coverage.observed).toBe("incomplete");
  expect(first.next).not.toBeNull();
  const next = first.next!;
  expect(
    (await historyData(project(f, env).tasks.bind(project(f, env)), next))
      .records,
  ).toHaveLength(1);
  const chosen = first.records[0];
  if (chosen.kind !== "task") throw Error("task");
  expect(
    (
      await entityData(p.entity.bind(p), {
        storeId: p.reader.storeId,
        scope: { kind: "task", id: chosen.owner.taskId },
        snapshotSeq: f.writer.committedSeq,
        kind: "task",
        id: chosen.owner.taskId,
        version: 1,
      })
    ).record,
  ).toEqual(chosen);
  tasks = tasks.map((t) => ({ ...t, goal: `${t.goal} changed same revision` }));
  await expect(p.tasks(next)).rejects.toThrow();
});
it("accepted Create metadata produces a historical entity without inventing v1 publication", async () => {
  const f = historyFixture(),
    context = { ...f.context, task: null },
    taskId = randomUUID();
  f.writer.supplyContext(context);
  const result = await f.writer.commit({
    commandId: randomUUID(),
    operationId: randomUUID(),
    runId: null,
    createdTaskId: taskId,
    identity: {
      kind: "action",
      expected: context,
      action: { kind: "create", taskKind: "research", goal: "confirmed goal" },
    },
  });
  expect(result.status).toBe("committed");
  const p = project(f),
    page = await historyData(p.tasks.bind(p), request(f, "tasks"));
  expect(page.records).toHaveLength(1);
  expect(
    (
      await entityData(p.entity.bind(p), {
        storeId: p.reader.storeId,
        scope: { kind: "task", id: taskId },
        snapshotSeq: f.writer.committedSeq,
        kind: "task",
        id: taskId,
        version: 1,
      })
    ).record,
  ).toMatchObject({ kind: "task", goal: "confirmed goal", plan: null });
  if (result.status === "committed")
    expect(result.record.receipt.publication).toBe("pending");
});
it("check native exit and historical pass stay distinct from stale current obligations", async () => {
  const metrics = historyPhaseMetrics("check-obligations");
  try {
    const f = historyFixture(),
      check = {
        kind: "configured" as const,
        name: "unit",
        command: "true",
        timeoutMs: 1000,
      };
    f.context.task!.kind = "code";
    f.writer.supplyContext(f.context);
    f.intent.identity = {
      kind: "action",
      expected: f.context,
      action: { kind: "check", taskId: f.link.taskId, check },
    };
    metrics.phase("commit");
    await f.writer.commit(f.intent);
    metrics.phase("admit-run");
    await f.writer.admitRun(f.link.runId, {
      operationId: f.intent.operationId,
      commandId: f.intent.commandId,
      kind: "check",
      context: f.context,
      graph: null,
      assignments: [],
    });
    const checkId = randomUUID(),
      before = { ...f.context.observation, checkoutGeneration: 0 };
    metrics.phase("check-start");
    await ownerFact(f, {
      kind: "check-start",
      checkId,
      selection: check,
      cwdId: f.context.cwdId,
      cwdLabel: f.root,
      checkEnvGeneration: 1,
      before,
    });
    metrics.phase("check-settled");
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
    });
    metrics.phase("reads");
    const env = environment(f);
    env.checks = () => ({ revision: 2, selections: [check] });
    const p = project(f, env);
    expect(
      (await p.checkObligations(f.link.taskId)).definitions[0].status,
    ).toBe("passed");
    f.context = { ...f.context, checkoutGeneration: 1 };
    expect(
      (await p.checkObligations(f.link.taskId)).definitions[0].status,
    ).toBe("stale");
    const page = await historyData(p.checks.bind(p), request(f, "checks"));
    expect(page.records).toHaveLength(2);
    expect(page.records[1]).toMatchObject({
      kind: "owner-fact",
      fact: {
        kind: "check-settled",
        status: "passed",
        native: { exitCode: 0 },
      },
    });
    env.checks = () => ({
      revision: 3,
      selections: [{ ...check, command: "different" }],
    });
    expect(
      (await p.checkObligations(f.link.taskId)).definitions[0].status,
    ).toBe("not-run");
  } finally {
    metrics.finish();
  }
});
it("a pending asynchronous observer never holds original commit settlement, and capacity is finite", async () => {
  const metrics = historyPhaseMetrics("pending-observer");
  let live: HistoryLive | undefined, release: (() => void) | undefined;
  let pendingWrites = -1;
  const stops: (() => void)[] = [];
  try {
    const f = historyFixture();
    metrics.phase("commit");
    await f.writer.commit(f.intent);
    metrics.phase("admit-run");
    await admitFixtureRun(f);
    const p = project(f),
      scope = { kind: "run" as const, id: f.link.runId };
    live = new HistoryLive(f.writer, p);
    let entered = false;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    live.subscribe(scope, async () => {
      entered = true;
      await gate;
    });
    const active = live;
    stops.push(
      ...Array.from({ length: 15 }, () => active.subscribe(scope, () => {})),
    );
    expect(() => active.subscribe(scope, () => {})).toThrow();
    metrics.phase("snapshot");
    await p.snapshot(scope);
    metrics.phase("waiting-commit");
    await ownerFact(f, {
      kind: "gate",
      lane: "reader",
      state: "waiting",
      checkoutGeneration: 0,
    });
    metrics.phase("observer-notification");
    for (let n = 0; n < 50 && !entered; n++)
      await new Promise((r) => setTimeout(r, 10));
    expect(entered).toBe(true);
    metrics.phase("held-commit");
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
    pendingWrites = f.writer.pendingWrites;
    expect(pendingWrites).toBe(0);
  } finally {
    metrics.phase("teardown");
    release?.();
    for (const stop of stops) stop();
    live?.close();
    metrics.finish({ pendingWrites });
  }
});
it("one notification round observes a task once for its task/run/child viewers, without caching the next round", async () => {
  const f = historyFixture();
  await f.writer.commit(f.intent);
  await admitFixtureRun(f);
  const env = environment(f),
    context = vi.fn(env.context);
  env.context = context;
  const p = project(f, env),
    live = new HistoryLive(f.writer, p);
  const task = { kind: "task" as const, id: f.link.taskId },
    run = { kind: "run" as const, id: f.link.runId },
    child = { kind: "child" as const, id: f.link.childRunId };
  const received: LiveEvent[] = [];
  const stops = [task, run, child].map((scope) =>
    live.subscribe(scope, (event) => {
      received.push(event);
    }),
  );
  const snapshot = vi.spyOn(p, "snapshot");
  try {
    for (const scope of [task, run, child]) await p.snapshot(scope);
    context.mockClear();
    snapshot.mockClear();
    await ownerFact(f, {
      kind: "gate",
      lane: "reader",
      state: "waiting",
      checkoutGeneration: 0,
    });
    await expect
      .poll(() => received.filter((e) => e.kind === "update").length)
      .toBe(3);
    expect(snapshot.mock.calls.map(([scope]) => scope)).toEqual([task]);
    expect(context).toHaveBeenCalledTimes(1);
    const updates = received.filter((e) => e.kind === "update");
    expect(new Set(updates.map((e) => e.committedSeq)).size).toBe(1);
    expect(updates.find((e) => e.scope.kind === "run")?.runs).toHaveLength(2);
    expect(updates.find((e) => e.scope.kind === "child")?.runs).toMatchObject([
      { childRunId: child.id },
    ]);
    const first = updates[0].context;
    f.context = { ...f.context, controlRev: f.context.controlRev + 1 };
    received.length = 0;
    context.mockClear();
    snapshot.mockClear();
    await ownerFact(f, {
      kind: "gate",
      lane: "reader",
      state: "held",
      checkoutGeneration: 0,
    });
    await expect
      .poll(() => received.filter((e) => e.kind === "update").length)
      .toBe(3);
    expect(snapshot.mock.calls.map(([scope]) => scope)).toEqual([task]);
    expect(context).toHaveBeenCalledTimes(1);
    expect(received.find((e) => e.kind === "update")?.context).not.toEqual(
      first,
    );
    // Standalone observation is still fresh, not a read of the prior ring.
    f.context = { ...f.context, controlRev: f.context.controlRev + 1 };
    const fresh = await p.snapshot(run);
    expect(fresh.context).toMatchObject({
      status: "available",
      version: { controlRev: f.context.controlRev },
    });
    expect(context).toHaveBeenCalledTimes(2);
  } finally {
    snapshot.mockRestore();
    for (const stop of stops) stop();
    live.close();
  }
});
it("narrowed snapshots retain exact context/watermark/horizon and never invent a missing historical run", async () => {
  const f = historyFixture();
  await f.writer.commit(f.intent);
  await admitFixtureRun(f);
  const p = project(f),
    task = await p.snapshot({ kind: "task", id: f.link.taskId });
  const runScope = { kind: "run" as const, id: f.link.runId },
    childScope = { kind: "child" as const, id: f.link.childRunId };
  const run = scopedSnapshot(task, runScope),
    child = scopedSnapshot(task, childScope);
  for (const [selected, scope] of [
    [run, runScope],
    [child, childScope],
  ] as const) {
    expect(selected).toBeDefined();
    expect(selected?.scope).toEqual(scope);
    expect(selected?.horizon.historicalRuns.scope).toEqual(scope);
    expect(selected?.horizon.historicalRuns.snapshotSeq).toBe(
      task.committedSeq,
    );
    expect(selected?.context).toEqual(task.context);
    expect(selected?.committedSeq).toBe(task.committedSeq);
  }
  expect(run?.runs).toHaveLength(2);
  expect(child?.runs).toHaveLength(1);
  expect(
    scopedSnapshot(task, { kind: "run", id: randomUUID() }),
  ).toBeUndefined();
  expect(
    scopedSnapshot(task, { kind: "child", id: randomUUID() }),
  ).toBeUndefined();
  expect(scopedSnapshot({ ...task, runs: [] }, runScope)).toBeUndefined();
  expect(scopedSnapshot(child!, runScope)).toBeUndefined();
  expect(scopedSnapshot(run!, task.scope)).toBeUndefined();
});
it("metadata publication cannot borrow another operation's intent", async () => {
  const f = historyFixture();
  const input: OwnerRecordingInput = {
    link: {
      epoch: f.link.epoch,
      operationId: randomUUID(),
      taskId: f.link.taskId,
      runId: null,
    },
    observedMs: 0,
    events: [
      {
        kind: "fact",
        fact: {
          kind: "publication-intent",
          publicationId: randomUUID(),
          expectedRevision: 1,
          expectedIdentity: f.context.task!.identity,
          nextRevision: 2,
          nextIdentity: "b".repeat(64),
        },
      },
    ],
  };
  const r = f.writer.owner().reserve({
    sourceFrames: 0,
    retainedBytes: 0,
    outputBytes: Buffer.byteLength(canonicalJson(input)),
    outputChunks: 1,
    lane: "control",
  });
  if (r.status !== "reserved") throw Error("reserve");
  expect((await r.reservation.commit(input)).status).toBe("refused");
  expect(f.writer.committedSeq).toBe("0");
});
it.each([
  "current",
  "restarted",
  "batched-duplicate",
  "borrowed-content",
] as const)(
  "separately admitted human review (%s) binds current obligations without changing blocked execution",
  async (mode) => {
    const observation = {
      identity: "a".repeat(64),
      complete: true,
      checkoutGeneration: 0,
    };
    let taskId = "";
    const options: HistoryWriterOptions = {
      reviewContext: () => ({
        observation,
        recordingIncomplete: false, // injected obligation fixture; no executed check output
        checks: {
          taskId,
          revision: 7,
          definitions: [
            {
              selection: {
                kind: "configured",
                name: "required",
                command: "true",
                timeoutMs: 1000,
              },
              status: "not-run",
              checkId: null,
            },
          ],
        },
      }),
    };
    const f = historyFixture(options);
    taskId = f.link.taskId;
    await f.writer.commit(f.intent);
    await admitFixtureRun(f);
    await settleFixtureRun(f, "blocked");
    if (mode === "restarted") {
      f.lease.release();
      f.lease = f.c.acquire({
        schema: "cadence-service-owner-config/1",
        endpoint: "http://127.0.0.1:17423",
        policyIdentity: "a".repeat(64),
      });
      f.link = { ...f.link, epoch: f.lease.registration.epoch };
      f.context = { ...f.context, epoch: f.link.epoch, controlRev: 2 };
      f.writer = new HistoryWriter(f.lease, options);
      f.writer.supplyContext(f.context);
    }

    const parentOperationId = f.intent.operationId;
    const observationId = randomUUID(),
      reviewId = randomUUID();
    async function content(kind: "changes" | "review", id: string) {
      const detailId = randomUUID();
      const batch = await record(f, {
        link: {
          epoch: f.link.epoch,
          taskId,
          runId: f.link.runId,
          operationId:
            kind === "review" && mode === "borrowed-content"
              ? parentOperationId
              : f.intent.operationId,
        },
        observedMs: 0,
        events: [
          {
            kind: "content-begin",
            detailId,
            owner: {
              taskId,
              runId: f.link.runId,
              childRunId: null,
              entity: { kind, id, version: 1 },
            },
            field: kind,
            encoding: "utf8",
          },
          { kind: "content-chunk", detailId, text: `actual fixture ${kind}` },
          { kind: "content-end", detailId, coverage: COMPLETE },
        ],
      });
      return batch.ownerDetails[0].content;
    }
    const changes = await content("changes", observationId);
    expect(
      (
        await ownerFact(f, {
          kind: "changes",
          observationId,
          stage: "review",
          observation,
          content: changes,
        })
      ).status,
    ).toBe("committed");
    const context = f.writer.currentContext(taskId)!;
    f.intent = {
      commandId: randomUUID(),
      operationId: randomUUID(),
      runId: null,
      createdTaskId: null,
      identity: {
        kind: "action",
        expected: context,
        action: {
          kind: "review",
          taskId,
          runId: f.link.runId,
          changesIdentity: observation.identity,
          checksRevision: 7,
          acceptIssues: true,
        },
      },
    };
    expect((await f.writer.commit(f.intent)).status).toBe("committed");
    const review = await content("review", reviewId),
      fact = {
        kind: "review" as const,
        reviewId,
        runId: f.link.runId,
        checksRevision: 7,
        changesIdentity: observation.identity,
        acceptIssues: true,
        outcome: "reviewed-with-issues" as const,
        content: review,
      };
    if (mode === "batched-duplicate") {
      const input: OwnerRecordingInput = {
        link: {
          epoch: f.link.epoch,
          taskId,
          runId: f.link.runId,
          operationId: f.intent.operationId,
        },
        observedMs: 0,
        events: [
          { kind: "fact", fact },
          { kind: "fact", fact },
        ],
      };
      const lease = f.writer.owner().reserve({
        sourceFrames: 0,
        retainedBytes: 0,
        outputBytes: Buffer.byteLength(canonicalJson(input)),
        outputChunks: 2,
        lane: "control",
      });
      if (lease.status !== "reserved") throw Error("reserve");
      const seq = f.writer.committedSeq;
      expect((await lease.reservation.commit(input)).status).toBe("refused");
      expect(f.writer.committedSeq).toBe(seq);
      return;
    }
    if (mode === "borrowed-content") {
      expect((await ownerFact(f, fact)).status).toBe("refused");
      return;
    }
    expect((await ownerFact(f, fact)).status).toBe("committed");
    const p = project(f),
      reviews = await historyData(p.reviews.bind(p), request(f, "reviews")),
      changePage = await historyData(p.changes.bind(p), request(f, "changes"));
    expect(reviews.records).toHaveLength(1);
    expect(changePage.records).toHaveLength(1);
    expect(
      (await p.snapshot({ kind: "run", id: f.link.runId })).runs.every(
        (r) => r.outcome === "blocked",
      ),
    ).toBe(true);
    expect((await ownerFact(f, fact)).status).toBe("refused");
  },
);
it.each(["text", "range", "version"])(
  "handoff binds genuine committed source/range/text and refuses changed %s",
  async (change) => {
    const f = historyFixture(),
      plan = await draft(f, "Inspect one, then use its exact selected result"),
      second = randomUUID(),
      messageId = randomUUID(),
      detailId = randomUUID();
    const graph: import("../src/service-contract.ts").Graph = {
      schema: "cadence-graph/2",
      taskId: f.link.taskId,
      taskKind: "research",
      taskRevision: 1,
      revision: 1,
      planRevision: 1,
      plan,
      assignments: [
        {
          id: "one",
          purpose: "research",
          instructions: "Inspect",
          expectedOutput: "Text",
          role: { role: "design-explorer", sha256: "a".repeat(64) },
          model: f.context.model,
          dependencies: [],
        },
        {
          id: "two",
          purpose: "research",
          instructions: "Use selected source",
          expectedOutput: "Findings",
          role: { role: "design-explorer", sha256: "a".repeat(64) },
          model: f.context.model,
          dependencies: [
            {
              source: { kind: "current", assignmentId: "one" },
              range: { start: 6, end: 10 },
              requireCompleteObservation: true,
            },
          ],
        },
      ],
    };
    const sha = (await import("../src/service/private-files.ts")).hash(
      canonicalJson(graph),
    );
    f.context.task = {
      ...f.context.task!,
      graphRevision: 1,
      graphIdentity: sha,
    };
    f.writer.supplyContext(f.context);
    f.intent.identity = {
      kind: "action",
      expected: f.context,
      action: { kind: "start", taskId: f.link.taskId },
    };
    await f.writer.commit(f.intent);
    await f.writer.admitRun(
      f.link.runId,
      {
        operationId: f.intent.operationId,
        commandId: f.intent.commandId,
        kind: "start",
        context: f.context,
        graph: { recordId: randomUUID(), revision: 1, sha256: sha },
        assignments: [
          { assignmentId: "one", childRunId: f.link.childRunId },
          { assignmentId: "two", childRunId: second },
        ],
      },
      graph,
    );
    const auth = randomUUID();
    await f.writer.auth.preparation({
      operationId: auth,
      epoch: f.link.epoch,
      runId: f.link.runId,
      childRunId: f.link.childRunId,
      sourceSelectionId: f.context.model.sourceSelectionId,
      validityMs: 1000,
    });
    await f.writer.auth.settlement({
      operationId: auth,
      outcome: "resolved",
      admissionClosed: false,
    });
    await f.writer.processes.launchIntent(f.link, f.intent.operationId);
    // Fabricated public events/native facts; real W3 artifacts and settlement joins.
    // The separate C1 case retains genuine W1 + W2 + SDK/native execution evidence.
    const events: import("../src/service-contract.ts").PublicRecordingInput["events"][number]["event"][] =
      [
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
        { kind: "stored-chunk", detailId, text: "first 😀 exact line" },
        { kind: "stored-end", detailId, coverage: COMPLETE },
        {
          kind: "message-end",
          messageId,
          finalDetailId: detailId,
          finalBlockCount: 1,
          stopReason: "stop",
        },
        { kind: "final", messageId, detailId, stopReason: "stop" },
      ];
    const source = {
        first: 1,
        last: events.length,
        firstObservedMs: 0,
        lastObservedMs: 0,
      },
      input = {
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
    if (lease.status !== "reserved") throw Error("capture");
    const result = await lease.reservation.commit(input);
    if (result.status !== "committed") throw Error("commit");
    const selected = { messageId, detailId };
    expect(
      (
        await f.writer.processes.settlement(f.link, {
          childRunId: f.link.childRunId,
          native: {
            outcome: "completed",
            closure: "direct-child-closed",
            exitCode: 0,
            signal: null,
            durationMs: 1,
            stdin: "delivered",
            final: "valid",
            cleanup: "settled",
            capture: COMPLETE,
          },
          selected,
          recording: {
            status: "committed",
            selected,
            detail: result.batch.details[0],
          },
        })
      ).status,
    ).toBe("committed");
    const fact: Extract<
      import("../src/service-contract.ts").OwnerFact,
      { kind: "handoff" }
    > = {
      kind: "handoff",
      childRunId: second,
      observation: { ...f.context.observation, checkoutGeneration: 0 },
      handoff: {
        graphRevision: 1,
        inputs: [
          {
            assignmentId: "two",
            dependencyIndex: 0,
            runId: f.link.runId,
            childRunId: f.link.childRunId,
            result: result.batch.details[0].content,
            range: { start: 6, end: 10 },
            text: "😀",
            coverage: COMPLETE,
          },
        ],
      },
    };
    expect((await ownerFact(f, fact)).status).toBe("committed");
    // The retained handoff belongs to the destination even though its source
    // result belongs to a sibling. Search/detail/export select supplied bytes,
    // not that sibling's full transcript or a fabricated source entity version.
    const projection = project(f),
      scope = { kind: "child" as const, id: second };
    const search = await searchPages(projection, {
      storeId: f.files.format.storeId,
      scope,
      snapshotSeq: f.writer.committedSeq,
      query: "😀",
      recordId: null,
      recordVersion: null,
      field: null,
      offset: 0,
    });
    expect(search.hits).toHaveLength(1);
    expect(search.hits[0].owner.entity).toEqual({
      kind: "child",
      id: second,
      version: 1,
    });
    expect((await detailPage(projection, search.hits[0].cursor)).text).toBe(
      "😀",
    );
    const exported: import("../src/service-contract.ts").ExportFrame[] = [];
    for await (const frame of projection.export(
      {
        storeId: f.files.format.storeId,
        scope,
        snapshotSeq: f.writer.committedSeq,
        format: "ndjson",
      },
      new AbortController().signal,
    ))
      exported.push(frame);
    expect(
      exported.some((f) => f.event.kind === "detail" && f.event.text === "😀"),
    ).toBe(true);
    expect(
      exported.some(
        (f) =>
          f.event.kind === "record" &&
          f.event.record.kind === "content" &&
          f.event.record.descriptor.owner.kind === "handoff" &&
          f.event.record.descriptor.owner.source.recordId ===
            fact.handoff.inputs[0].result.recordId,
      ),
    ).toBe(true);
    const bad = structuredClone(fact);
    if (change === "text") bad.handoff.inputs[0].text = "nope";
    if (change === "range") {
      bad.handoff.inputs[0].range = { start: 0, end: 4 };
      bad.handoff.inputs[0].text = "firs";
    }
    if (change === "version") bad.handoff.inputs[0].result.version = 2;
    expect((await ownerFact(f, bad)).status).toBe("refused");
    expect(() => f.writer.capture({ ...f.link, childRunId: second })).toThrow();
    const page = await historyData(
      project(f).events.bind(project(f)),
      request(f, "events"),
    );
    expect(
      page.records.some(
        (r) =>
          r.kind === "owner-fact" &&
          r.fact.kind === "handoff" &&
          r.fact.handoff.inputs[0].text === "😀",
      ),
    ).toBe(true);
  },
);
it("detail IO exhaustion returns the verified prefix with an advancing continuation, never a false EOF", async () => {
  const f = historyFixture(),
    text = "z".repeat(700000),
    content = await draft(f, text),
    p = project(f);
  const original = HistoryFiles.prototype.readArtifact;
  let reads = 0;
  const spy = vi
    .spyOn(HistoryFiles.prototype, "readArtifact")
    .mockImplementation(function (this: HistoryFiles, ref, budget) {
      if (++reads === 2) throw new ContractError("receipt-inconclusive");
      return original.call(this, ref, budget);
    });
  const cursor: ReadCursor = {
    storeId: p.reader.storeId,
    scope: { kind: "task", id: f.link.taskId },
    snapshotSeq: f.writer.committedSeq,
    recordId: content.recordId,
    recordVersion: 1,
    field: "plan",
    query: null,
    offset: 0,
  };
  let first: Awaited<ReturnType<typeof p.detail>>;
  try {
    first = await detailPage(p, cursor);
    expect(reads).toBe(2);
    expect(first.text.length).toBeGreaterThan(0);
    expect(first.text.length).toBeLessThan(256 * 1024);
    expect(first.next?.offset).toBe(first.text.length);
  } finally {
    spy.mockRestore();
  }
  let body = first.text,
    next = first.next;
  while (next) {
    const page = await detailPage(p, next);
    body += page.text;
    next = page.next;
  }
  expect(body).toBe(text);
  expect(await p.validateCursor(cursor)).toEqual({ status: "progress-needed" });
  expect(await p.validateCursor({ ...cursor, recordVersion: 2 })).toEqual({
    status: "progress-needed",
  });
  await expect(p.detail({ ...cursor, recordVersion: 2 })).rejects.toMatchObject(
    { code: "corrupt-selected" },
  );
});
it("decoded metadata caching cannot publish an alias mutation or hide changed native journal bytes", async () => {
  const f = historyFixture();
  await f.writer.commit(f.intent);
  const first = [...f.files.scan()][0].rows[0];
  if (first.value.kind !== "admission") throw Error("admission");
  first.value.record.receipt.publication = "published";
  const again = [...f.files.scan()][0].rows[0];
  if (again.value.kind !== "admission") throw Error("admission");
  expect(again.value.record.receipt.publication).toBe("pending");
  const path = f.files.segmentPath(1);
  writeFileSync(
    path,
    readFileSync(path, "utf8").replace(
      '"admission":"accepted"',
      '"admission":"refused"',
    ),
  );
  const before = readFileSync(path);
  expect(() => [...f.files.scan()]).toThrow();
  expect(readFileSync(path)).toEqual(before);
});
it("quota inventory counts preserved orphan bytes through guarded metadata, not full payload rereads", () => {
  const f = historyFixture(),
    before = f.files.usage(),
    path = join(f.files.directory, "orphan.bin");
  f.files.files.create(path, "x".repeat(4096));
  const reads = vi.spyOn(f.files.files, "read");
  try {
    expect(f.files.usage()).toBe(before + 4096);
    expect(reads).not.toHaveBeenCalled();
  } finally {
    reads.mockRestore();
  }
  expect(readFileSync(path).length).toBe(4096);
});
it("review: missing detail accelerator reads only the selected page artifacts, not the entire body", async () => {
  const f = historyFixture(),
    text = "a".repeat(700000),
    content = await draft(f, text);
  const { renameSync } = await import("node:fs");
  const path = join(
    f.files.directory,
    "indexes",
    "contents",
    `${content.recordId}.json`,
  );
  renameSync(path, `${path}.preserved`);
  const spy = vi.spyOn(HistoryFiles.prototype, "readArtifact");
  try {
    const page = await detailPage(project(f), {
      storeId: f.files.format.storeId,
      scope: { kind: "task", id: f.link.taskId },
      snapshotSeq: f.writer.committedSeq,
      query: null,
      recordId: content.recordId,
      recordVersion: 1,
      field: "plan",
      offset: 0,
    });
    expect(page.text).toBe(text.slice(0, 256 * 1024));
    expect(page.next?.offset).toBe(256 * 1024);
    expect(
      spy.mock.calls.reduce((n, [ref]) => n + ref.bytes, 0),
    ).toBeLessThanOrEqual(512 * 1024);
  } finally {
    spy.mockRestore();
  }
});
