import { createHash, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { COMPLETE } from "../src/history/types.ts";
import {
  canonicalJson,
  type DetailDescriptor,
  type ExportRequest,
  ExportTracker,
  type Graph,
  type PublicRecordingInput,
  type ReadCursor,
  type RunIdentity,
} from "../src/service-contract.ts";
import {
  admitFixtureRun,
  historyFixture,
  prepareFixtureChild,
} from "./helpers/history-fixture.ts";
import {
  detailPage,
  type Fixture,
  readProjection,
  retainedText,
  searchSeed,
  storedTree,
} from "./helpers/history-read-fixture.ts";

async function capture(
  f: Fixture,
  events: PublicRecordingInput["events"][number]["event"][],
) {
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
  if (lease.status !== "reserved") throw Error("reserve");
  const result = await lease.reservation.commit(input);
  if (result.status !== "committed") throw Error("capture");
  return result.batch;
}
async function all(f: Fixture, cursor: ReadCursor) {
  const hits = [];
  for (let i = 0; i < 100; i++) {
    const p = await readProjection(f).search(cursor);
    hits.push(...p.hits);
    if (!p.next) return hits;
    cursor = p.next;
  }
  throw Error("loop");
}
it("run/child include only their frozen shared task-plan version and exact entity ownership, with both format exports", async () => {
  const f = historyFixture(),
    plan = await retainedText(f, "selected-plan-text", "plan", 1);
  await retainedText(f, "unselected-draft-plan", "plan", 8);
  const workspace = { ...f.context, task: null };
  f.writer.supplyContext(workspace);
  expect(
    (
      await f.writer.commit({
        commandId: randomUUID(),
        operationId: randomUUID(),
        runId: null,
        createdTaskId: f.link.taskId,
        identity: {
          kind: "action",
          expected: workspace,
          action: {
            kind: "create",
            taskKind: "research",
            goal: "frozen-task-goal",
          },
        },
      })
    ).status,
  ).toBe("committed");
  const graph: Graph = {
    schema: "cadence-graph/2",
    taskId: f.link.taskId,
    taskKind: "research",
    taskRevision: 1,
    revision: 1,
    planRevision: 1,
    plan: plan.content,
    assignments: [
      {
        id: "one",
        purpose: "research",
        instructions: "inspect",
        expectedOutput: "findings",
        role: { role: "design-explorer", sha256: "a".repeat(64) },
        model: f.context.model,
        dependencies: [],
      },
    ],
  };
  f.context.task = {
    ...f.context.task!,
    graphRevision: 1,
    graphIdentity: createHash("sha256")
      .update(canonicalJson(graph))
      .digest("hex"),
  };
  f.writer.supplyContext(f.context);
  f.intent.identity = {
    kind: "action",
    expected: f.context,
    action: { kind: "start", taskId: f.link.taskId },
  };
  expect((await f.writer.commit(f.intent)).status).toBe("committed");
  const identity: RunIdentity = {
    operationId: f.intent.operationId,
    commandId: f.intent.commandId,
    kind: "start",
    context: f.context,
    graph: {
      recordId: randomUUID(),
      revision: 1,
      sha256: f.context.task.graphIdentity!,
    },
    assignments: [{ assignmentId: "one", childRunId: f.link.childRunId }],
  };
  expect((await f.writer.admitRun(f.link.runId, identity, graph)).status).toBe(
    "committed",
  );
  const before = storedTree(f.files.directory);
  for (const scope of [
    { kind: "run" as const, id: f.link.runId },
    { kind: "child" as const, id: f.link.childRunId },
  ]) {
    const goalHits = await all(f, {
      ...searchSeed(f, "frozen-task-goal"),
      scope,
    });
    expect(goalHits).toHaveLength(1);
    expect((await detailPage(readProjection(f), goalHits[0].cursor)).text).toBe(
      "frozen-task-goal",
    );
    const hits = await all(f, {
      ...searchSeed(f, "selected-plan-text"),
      scope,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].content).toEqual(plan.content);
    expect(hits[0].owner.entity).toEqual({
      kind: scope.kind,
      id: scope.id,
      version: 1,
    });
    expect(hits[0].owner.runId).toBe(f.link.runId);
    expect((await detailPage(readProjection(f), hits[0].cursor)).text).toBe(
      "selected-plan-text",
    );
    expect(
      await all(f, { ...searchSeed(f, "unselected-draft-plan"), scope }),
    ).toEqual([]);
    for (const format of ["ndjson", "markdown"] as const) {
      const input: ExportRequest = {
          storeId: f.files.format.storeId,
          scope,
          snapshotSeq: f.writer.committedSeq,
          format,
        },
        tracker = new ExportTracker(input);
      let text = "",
        graphs = 0;
      for await (const frame of readProjection(f).export(
        input,
        new AbortController().signal,
      )) {
        tracker.receive(frame);
        text += JSON.stringify(frame);
        if (frame.event.kind === "graph") graphs++;
      }
      expect(text).toContain("selected-plan-text");
      expect(text).toContain("frozen-task-goal");
      expect(text).not.toContain("unselected-draft-plan");
      if (format === "ndjson") expect(graphs).toBe(1);
      expect(tracker.completion).toBe("complete-unverified-digest");
    }
  }
  expect(storedTree(f.files.directory)).toEqual(before);
});
it("actual writer capture covers every worker field, source provenance and limited/redacted coverage without sibling transcript leakage", async () => {
  const f = historyFixture(),
    sibling = randomUUID();
  await f.writer.commit(f.intent);
  await admitFixtureRun(f, [f.link.childRunId, sibling]);
  const original = f.link.childRunId;
  for (const child of [original, sibling]) {
    f.link = { ...f.link, childRunId: child };
    await prepareFixtureChild(f);
    await f.writer.processes.launchIntent(f.link, f.intent.operationId);
    const message = randomUUID(),
      call = randomUUID(),
      source = { disposition: "unavailable" as const, value: null };
    const events: PublicRecordingInput["events"][number]["event"][] = [
      { kind: "ready", requestProtocol: 2 },
      {
        kind: "message-start",
        messageId: message,
        role: "assistant",
        source,
        resultCallId: null,
      },
      {
        kind: "tool-start",
        callId: call,
        declaration: null,
        source,
        name: "read",
        argsDetailId: null,
      },
    ];
    const descriptors: DetailDescriptor[] = [
      {
        owner: { kind: "context", component: "request-prompt" },
        field: "context",
        encoding: "utf8",
      },
      {
        owner: {
          kind: "message",
          messageId: message,
          blockId: randomUUID(),
          index: 0,
          stage: "stream",
        },
        field: "message",
        encoding: "utf8",
      },
      {
        owner: { kind: "message-final", messageId: message },
        field: "final-text",
        encoding: "utf8",
      },
      ...(["tool-args", "tool-update", "tool-result"] as const).map(
        (field) => ({
          owner: {
            kind: "tool" as const,
            callId: call,
            blockId: randomUUID(),
            index: 0,
            stage:
              field === "tool-args"
                ? ("execution-arguments" as const)
                : field === "tool-update"
                  ? ("update-snapshot" as const)
                  : ("result" as const),
          },
          field,
          encoding: "canonical-json" as const,
        }),
      ),
    ];
    for (const descriptor of descriptors) {
      const detailId = randomUUID(),
        text =
          descriptor.encoding === "canonical-json"
            ? canonicalJson({
                value: `${child === original ? "selected" : "sibling"}-${descriptor.field}`,
              })
            : `${child === original ? "selected" : "sibling"}-${descriptor.field}`;
      events.push(
        { kind: "detail-begin", detailId, descriptor },
        { kind: "stored-chunk", detailId, text },
        {
          kind: "stored-end",
          detailId,
          coverage: {
            ...COMPLETE,
            source: "limited",
            redacted: true,
            omissions: ["source-limit"],
          },
        },
      );
    }
    await capture(f, events);
  }
  f.link = { ...f.link, childRunId: original };
  const scope = { kind: "child" as const, id: original },
    hits = await all(f, { ...searchSeed(f, "selected-"), scope });
  expect(hits.map((h) => h.content.field).sort()).toEqual(
    [
      "context",
      "message",
      "final-text",
      "tool-args",
      "tool-update",
      "tool-result",
    ].sort(),
  );
  expect(await all(f, { ...searchSeed(f, "sibling-"), scope })).toEqual([]);
  for (const hit of hits)
    expect((await detailPage(readProjection(f), hit.cursor)).text).toContain(
      "selected-",
    );
  const input: ExportRequest = {
      storeId: f.files.format.storeId,
      scope,
      snapshotSeq: f.writer.committedSeq,
      format: "ndjson",
    },
    tracker = new ExportTracker(input);
  let text = "";
  for await (const frame of readProjection(f).export(
    input,
    new AbortController().signal,
  )) {
    tracker.receive(frame);
    text += JSON.stringify(frame);
    if (frame.event.kind === "trailer")
      expect(frame.event).toMatchObject({
        complete: true,
        coverage: {
          observed: "complete",
          source: "limited",
          redacted: true,
          omissions: ["source-limit"],
        },
      });
  }
  expect(text).not.toContain("sibling-");
  expect(text).toContain("source-limit");
  expect(text).toContain("request-prompt");
});
