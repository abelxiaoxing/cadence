/** Fabricated legacy-format evidence, never a task execution producer or SDK test. */
import { randomUUID } from "node:crypto";
import { COMPLETE } from "../../src/history/types.ts";
import type { ServiceHost } from "../../src/service/host.ts";
import {
  canonicalJson,
  type PublicRecordingInput,
} from "../../src/service-contract.ts";
import {
  admitFixtureRun,
  failedCompletion,
  historyFixtureContext,
  prepareFixtureChild,
  settleFixtureRun,
} from "./history-fixture.ts";
import { selectLegacy } from "./history-publication-fixture.ts";

export async function archivedRun(host: ServiceHost, text: string) {
  const f = historyFixtureContext({
    dir: host.coordination.store.root,
    root: host.coordination.store.root,
    c: host.coordination,
    lease: host.owner.lease,
    files: host.reader.files,
    writer: host.writer,
  });
  selectLegacy(f, { goal: "Fabricated retained investigation" });
  if ((await f.writer.commit(f.intent)).status !== "committed")
    throw Error("fixture admission record");
  await admitFixtureRun(f);
  await prepareFixtureChild(f);
  if (
    (await f.writer.processes.launchIntent(f.link, f.intent.operationId))
      .status !== "committed"
  )
    throw Error("fixture launch record");
  const messageId = randomUUID(),
    detailId = randomUUID();
  const events: PublicRecordingInput["events"][number]["event"][] = [
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
  ];
  const bytes = Buffer.from(text);
  for (let at = 0; at < bytes.length; ) {
    let end = Math.min(at + 8192, bytes.length);
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    events.push({
      kind: "stored-chunk",
      detailId,
      text: bytes.subarray(at, end).toString("utf8"),
    });
    at = end;
  }
  events.push(
    { kind: "stored-end", detailId, coverage: COMPLETE },
    {
      kind: "message-end",
      messageId,
      finalDetailId: detailId,
      finalBlockCount: 1,
      stopReason: "stop",
    },
    { kind: "final", messageId, detailId, stopReason: "stop" },
  );
  const source = {
    first: 1,
    last: events.length,
    firstObservedMs: 0,
    lastObservedMs: 0,
  };
  const input: PublicRecordingInput = {
    link: f.link,
    source,
    events: events.map((event) => ({ source, event })),
  };
  const reservation = f.writer.capture(f.link).reserve({
    sourceFrames: events.length,
    retainedBytes: 0,
    outputBytes: Buffer.byteLength(canonicalJson(input)),
    outputChunks: events.length,
    lane: "data",
  });
  if (reservation.status !== "reserved") throw Error("fixture capture reserve");
  const result = await reservation.reservation.commit(input);
  if (result.status !== "committed") throw Error("fixture capture record");
  const completion = {
    childRunId: f.link.childRunId,
    native: {
      ...failedCompletion(f.link.childRunId).native,
      outcome: "completed" as const,
      exitCode: 0,
      final: "valid" as const,
    },
    selected: { messageId, detailId },
    recording: {
      status: "committed" as const,
      selected: { messageId, detailId },
      detail: result.batch.details[0],
    },
  };
  if (
    (await f.writer.processes.settlement(f.link, completion)).status !==
    "committed"
  )
    throw Error("fixture native record");
  await settleFixtureRun(f);
  if (
    (await f.writer.publishTask({ operationId: f.intent.operationId }))
      .status !== "published"
  )
    throw Error("fixture summary record");
  return f.link;
}
