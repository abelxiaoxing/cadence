/** Real flushed private journal fixture with >8MiB between a field's chunks/end.
 * Fabricated Create accounting is not actual task admission or SDK execution. */
import { createHash, randomUUID } from "node:crypto";
import {
  type Artifact,
  COMPLETE,
  type JournalRow,
  type RetainedDetail,
} from "../../src/history/types.ts";
import { LIMITS } from "../../src/service-contract.ts";
import { historyFixture } from "./history-fixture.ts";
export async function longLookahead() {
  const f = historyFixture(),
    taskId = f.link.taskId,
    detailId = randomUUID(),
    artifactId = randomUUID(),
    operationId = randomUUID();
  const query = `Q${"界".repeat(341)}`,
    first = "prefixQ",
    second = `${"界".repeat(341)}abababa`,
    text = first + second;
  const artifact: Artifact = {
    runId: operationId,
    artifactId,
    part: 0,
    bytes: Buffer.byteLength(text),
    sha256: createHash("sha256").update(text).digest("hex"),
  };
  f.files.writeArtifact(f.lease, artifact, text);
  const link = { epoch: f.link.epoch, taskId, runId: null, operationId };
  const owner = {
    taskId,
    runId: null,
    childRunId: null,
    entity: { kind: "task" as const, id: taskId, version: 1 },
  };
  let state = f.files.inspect();
  const append = async (values: JournalRow["value"][]) => {
    const rows = values.map(
      (value, i): JournalRow => ({
        kind: "record",
        id: randomUUID(),
        seq: String(BigInt(state.committedSeq) + BigInt(i) + 1n),
        value,
      }),
    );
    state = await f.files.append(f.lease, state, rows);
  };
  await append([
    {
      kind: "owner",
      link,
      observedMs: 0,
      events: [
        {
          kind: "owner",
          id: randomUUID(),
          value: {
            kind: "content-begin",
            detailId,
            owner,
            field: "plan",
            encoding: "utf8",
          },
        },
        {
          kind: "chunk",
          detailId,
          source: null,
          artifact,
          offset: 0,
          start: 0,
          length: Buffer.byteLength(first),
        },
      ],
    },
  ]);
  const originEnd = state.bytes;
  while (
    (state.segment - 1) * LIMITS.segmentBytes + state.bytes <
    originEnd + LIMITS.searchBytes + 1024
  ) {
    const values: JournalRow["value"][] = [];
    for (let i = 0; i < 32; i++) {
      const commandId = randomUUID(),
        op = randomUUID(),
        createdTaskId = randomUUID();
      const identity = {
        kind: "action" as const,
        expected: { ...f.context, task: null },
        action: {
          kind: "create" as const,
          taskKind: "research" as const,
          goal: `unrelated-${"z".repeat(7900)}`,
        },
      };
      values.push({
        kind: "admission",
        intent: {
          commandId,
          operationId: op,
          runId: null,
          createdTaskId,
          identity,
        },
        record: {
          identity,
          receipt: {
            commandId,
            operationId: op,
            runId: null,
            admission: "accepted",
            committedSeq: String(BigInt(state.committedSeq) + BigInt(i) + 1n),
            execution: null,
            settlement: null,
            created: { kind: "task", taskId: createdTaskId, state: "reserved" },
            publication: "pending",
          },
        },
      });
    }
    await append(values);
  }
  const detail: RetainedDetail = {
    detailId,
    origin: { kind: "owner", id: operationId },
    owner,
    descriptor: null,
    content: {
      recordId: artifactId,
      version: 1,
      field: "plan",
      bytes: artifact.bytes,
      sha256: artifact.sha256,
    },
    coverage: COMPLETE,
  };
  await append([
    {
      kind: "owner",
      link,
      observedMs: 1,
      events: [
        {
          kind: "chunk",
          detailId,
          source: null,
          artifact,
          offset: Buffer.byteLength(first),
          start: Buffer.byteLength(first),
          length: Buffer.byteLength(second),
        },
        { kind: "end", detail, source: null },
      ],
    },
  ]);
  return { f, state, first, second, text, query, detail };
}
