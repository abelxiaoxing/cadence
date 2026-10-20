/** Fixture-only sparse exact-8MiB original journal. Real original producer exit,
 * native flushed bytes and later recovery; fabricated observations, no SDK/tool effects. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { COMPLETE, type JournalRow } from "../../src/history/types.ts";
import {
  canonicalJson,
  LIMITS,
  type PublicRecordingInput,
} from "../../src/service-contract.ts";
import { historyData } from "./history-data-read.ts";
import {
  admitFixtureRun,
  failedCompletion,
  historyFixture,
  prepareFixtureChild,
  settleFixtureRun,
} from "./history-fixture.ts";
import { readProjection } from "./history-read-fixture.ts";

const directory = process.argv[2],
  f = historyFixture({}, directory);
assert.equal((await f.writer.commit(f.intent)).status, "committed");
await admitFixtureRun(f);
await prepareFixtureChild(f);
await f.writer.processes.launchIntent(f.link, f.intent.operationId);
const message = randomUUID(),
  call = randomUUID(),
  orphan = randomUUID(),
  block = randomUUID(),
  detail = randomUUID(),
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
    kind: "call-declaration",
    callId: call,
    declaration: { messageId: message, blockId: block },
    index: 0,
    source,
    name: "read",
    argsDetailId: null,
    stage: "partial",
  },
  {
    kind: "call-declaration",
    callId: call,
    declaration: { messageId: message, blockId: block },
    index: 0,
    source,
    name: "read",
    argsDetailId: null,
    stage: "final",
  },
  {
    kind: "omitted-block",
    block: {
      owner: {
        kind: "tool",
        callId: call,
        blockId: block,
        index: 0,
        stage: "arguments-final",
      },
      sourceType: "unsupported",
      mimeType: null,
      reason: "unsupported",
    },
  },
  {
    kind: "detail-begin",
    detailId: detail,
    descriptor: {
      owner: { kind: "message-final", messageId: message },
      field: "final-text",
      encoding: "utf8",
    },
  },
  { kind: "stored-chunk", detailId: detail, text: "retained 😀 original" },
  { kind: "stored-end", detailId: detail, coverage: COMPLETE },
  {
    kind: "message-end",
    messageId: message,
    finalDetailId: detail,
    finalBlockCount: 1,
    stopReason: "stop",
  },
  {
    kind: "tool-end",
    callId: orphan,
    declaration: null,
    source,
    name: "read",
    resultDetailId: randomUUID(),
    isError: true,
    association: "orphan",
    startObserved: false,
  },
];
const range = {
    first: 1,
    last: events.length,
    firstObservedMs: 0,
    lastObservedMs: 0,
  },
  input = {
    link: f.link,
    source: range,
    events: events.map((event) => ({ source: range, event })),
  };
const lease = f.writer.capture(f.link).reserve({
  sourceFrames: events.length,
  retainedBytes: 0,
  outputBytes: Buffer.byteLength(canonicalJson(input)),
  outputChunks: events.length,
  lane: "data",
});
assert.equal(lease.status, "reserved");
if (lease.status !== "reserved") throw Error("reserve");
assert.equal((await lease.reservation.commit(input)).status, "committed");
await f.writer.processes.settlement(
  f.link,
  failedCompletion(f.link.childRunId),
);
await settleFixtureRun(f, "failed");
const p = readProjection(f),
  expected: Record<string, unknown> = {};
// Baseline public output is captured at the known pre-padding snapshot for the
// worker categories. Tasks are independently asserted against the exact Create.
for (const reader of [
  "runs",
  "messages",
  "tools",
  "contents",
  "events",
  "checks",
  "changes",
  "reviews",
] as const) {
  expected[reader] = (
    await historyData(p[reader].bind(p), {
      reader,
      storeId: f.files.format.storeId,
      scope: { kind: "run", id: f.link.runId },
      snapshotSeq: f.writer.committedSeq,
      after: null,
      limit: 50,
    })
  ).records;
}
// One retained Create near the end; every other list has its genuine original
// occurrence rather than thousands of unrelated filler rows to publish.
let state = f.files.inspect();
const taskId = randomUUID(),
  commandId = randomUUID(),
  operationId = randomUUID(),
  seq = String(BigInt(state.committedSeq) + 1n),
  identity = {
    kind: "action" as const,
    expected: { ...f.context, task: null },
    action: {
      kind: "create" as const,
      taskKind: "research" as const,
      goal: "late task retained",
    },
  };
const create: JournalRow = {
  kind: "record",
  id: randomUUID(),
  seq,
  value: {
    kind: "admission",
    intent: {
      commandId,
      operationId,
      createdTaskId: taskId,
      runId: null,
      identity,
    },
    record: {
      identity,
      receipt: {
        commandId,
        operationId,
        runId: null,
        admission: "accepted",
        committedSeq: seq,
        execution: null,
        settlement: null,
        publication: "pending",
        created: { kind: "task", taskId, state: "reserved" },
      },
    },
  },
};
// Canonical, unrelated synthetic check observations occupy the original journal.
// These are explicitly injected facts, not performed shell checks. No selected
// run reducer joins them to a real parent, and no fake index supplies membership.
const foreign = {
  epoch: f.link.epoch,
  taskId: randomUUID(),
  runId: randomUUID(),
  operationId: randomUUID(),
};
while (state.bytes < LIMITS.segmentBytes - 1024 * 1024) {
  const row: JournalRow = {
    kind: "record",
    id: randomUUID(),
    seq: String(BigInt(state.committedSeq) + 1n),
    value: {
      kind: "owner",
      link: foreign,
      observedMs: 0,
      events: Array.from({ length: 64 }, () => ({
        kind: "owner",
        id: randomUUID(),
        value: {
          kind: "fact",
          fact: {
            kind: "check-start",
            checkId: randomUUID(),
            selection: {
              kind: "configured",
              name: "unrelated injected",
              command: "z".repeat(4096),
              timeoutMs: 1000,
            },
            cwdId: randomUUID(),
            cwdLabel: "fixture",
            checkEnvGeneration: 1,
            before: {
              identity: "a".repeat(64),
              complete: true,
              checkoutGeneration: 0,
            },
          },
        },
      })),
    },
  };
  state = await f.files.append(f.lease, state, [row]);
}
create.seq = String(BigInt(state.committedSeq) + 1n);
if (create.value.kind !== "admission") throw Error("create");
create.value.record.receipt.committedSeq = create.seq;
state = await f.files.append(f.lease, state, [create]);
const path = f.files.segmentPath(state.segment),
  fd = openSync(path, "a");
try {
  writeSync(
    fd,
    `{"torn":"${"x".repeat(LIMITS.segmentBytes - state.bytes - 9)}`,
  );
  fsyncSync(fd);
} finally {
  closeSync(fd);
}
assert.equal(readFileSync(path).length, LIMITS.segmentBytes);
writeFileSync(
  join(directory, "selected.json"),
  JSON.stringify({
    root: f.root,
    state: join(directory, "state"),
    epoch: f.link.epoch,
    taskId,
    runTaskId: f.link.taskId,
    runId: f.link.runId,
    message,
    call,
    orphan,
    expected,
  }),
);
process.exit(77);
