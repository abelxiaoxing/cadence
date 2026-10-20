import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HistoryProjection,
  type ReadEnvironment,
} from "../../src/history/projection.ts";
import { HistoryReader } from "../../src/history/reader.ts";
import { COMPLETE } from "../../src/history/types.ts";
import {
  canonicalJson,
  type OwnerRecordingInput,
  publicError,
  type ReadCursor,
} from "../../src/service-contract.ts";
import type { historyFixture } from "./history-fixture.ts";
export type Fixture = ReturnType<typeof historyFixture>;
export function readEnvironment(f: Fixture): ReadEnvironment {
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
      status: "unavailable",
      workspaceId: f.files.format.workspaceId,
      taskId,
      error: publicError("unavailable"),
    }),
    checks: () => ({ revision: 1, selections: [] }),
    legacyTasks: () => [],
  };
}
export function readProjection(f: Fixture) {
  const reader = HistoryReader.open(f.c);
  if (!reader) throw Error("fixture reader absent");
  return new HistoryProjection(reader, readEnvironment(f));
}
export const searchSeed = (f: Fixture, query: string): ReadCursor => ({
  storeId: f.files.format.storeId,
  scope: { kind: "task", id: f.link.taskId },
  query,
  snapshotSeq: f.writer.committedSeq,
  recordId: null,
  recordVersion: null,
  field: null,
  offset: 0,
});
export async function recordOwner(f: Fixture, input: OwnerRecordingInput) {
  const lease = f.writer.owner().reserve({
    sourceFrames: 0,
    retainedBytes: 0,
    outputBytes: Buffer.byteLength(canonicalJson(input)),
    outputChunks: input.events.length,
    lane: "data",
  });
  if (lease.status !== "reserved") throw Error("fixture reserve");
  const result = await lease.reservation.commit(input);
  if (result.status !== "committed")
    throw Error(`fixture commit ${JSON.stringify(result)}`);
  return result.batch;
}
export async function retainedText(
  f: Fixture,
  text: string,
  field: "plan" | "check" | "changes" | "review" = "plan",
  entityVersion = 1,
  pendingLimit = 8,
) {
  const detailId = randomUUID(),
    link = {
      epoch: f.link.epoch,
      taskId: f.link.taskId,
      runId: null,
      operationId: randomUUID(),
    };
  const owner = {
    taskId: f.link.taskId,
    runId: null,
    childRunId: null,
    entity: {
      kind: field === "plan" ? ("task" as const) : field,
      id: field === "plan" ? f.link.taskId : randomUUID(),
      version: entityVersion,
    },
  };
  await recordOwner(f, {
    link,
    observedMs: 0,
    events: [
      { kind: "content-begin", detailId, owner, field, encoding: "utf8" },
    ],
  });
  const bytes = Buffer.from(text),
    pending = [];
  for (let at = 0; at < bytes.length; ) {
    const events: OwnerRecordingInput["events"] = [];
    for (let n = 0; n < 16 && at < bytes.length; n++) {
      let end = Math.min(at + 8192, bytes.length);
      while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
      events.push({
        kind: "content-chunk",
        detailId,
        text: bytes.subarray(at, end).toString("utf8"),
      });
      at = end;
    }
    pending.push(recordOwner(f, { link, observedMs: 0, events }));
    if (pending.length === pendingLimit) {
      await Promise.all(pending);
      pending.length = 0;
    }
  }
  await Promise.all(pending);
  const batch = await recordOwner(f, {
    link,
    observedMs: 0,
    events: [{ kind: "content-end", detailId, coverage: COMPLETE }],
  });
  return { content: batch.ownerDetails[0].content, owner, detailId };
}
export function storedTree(path: string): [string, string][] {
  return readdirSync(path, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? storedTree(join(path, e.name))
        : ([
            [
              join(path, e.name),
              createHash("sha256")
                .update(readFileSync(join(path, e.name)))
                .digest("hex"),
            ],
          ] as [string, string][]),
    )
    .sort(([a], [b]) => a.localeCompare(b));
}

/** Follow explicit proof-only replies in tests; each call still has its original
 * production budget. This helper neither retries errors nor changes snapshots. */
export async function detailPage(
  projection: {
    detail: (
      cursor: ReadCursor,
    ) => Promise<import("../../src/service-contract.ts").DetailReadResult>;
  },
  cursor: ReadCursor,
): Promise<import("../../src/service-contract.ts").DetailPage> {
  for (let n = 0; n < 10000; n++) {
    const reply = await projection.detail(cursor);
    if (!("kind" in reply)) return reply;
    if (canonicalJson(cursor) === canonicalJson(reply.next))
      throw Error("No proof progress");
    cursor = reply.next;
  }
  throw Error("Fixture proof did not finish");
}

export async function searchPages(
  projection: {
    search: (
      cursor: ReadCursor,
    ) => Promise<import("../../src/service-contract.ts").SearchPage>;
  },
  cursor: ReadCursor,
) {
  const hits: import("../../src/service-contract.ts").SearchHit[] = [];
  for (let n = 0; n < 10000; n++) {
    const page = await projection.search(cursor);
    hits.push(...page.hits);
    if (!page.next) return { hits, coverage: page.coverage };
    if (canonicalJson(page.next) === canonicalJson(cursor))
      throw Error("No progress");
    cursor = page.next;
  }
  throw Error("Fixture search did not finish");
}
