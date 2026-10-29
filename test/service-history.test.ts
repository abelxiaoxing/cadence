import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { HistoryReader } from "../src/history/reader.ts";
import { COMPLETE, type JournalRow } from "../src/history/types.ts";
import { HistoryWriter } from "../src/history/writer.ts";
import { ServiceCoordination } from "../src/service/coordination.ts";
import {
  canonicalJson,
  LIMITS,
  type OwnerRecordingInput,
  type PublicRecordingInput,
  type ReadCursor,
  type WorkerCompletion,
} from "../src/service-contract.ts";
import {
  admitFixtureRun,
  failedCompletion,
  historyFixture,
  prepareFixtureChild,
} from "./helpers/history-fixture.ts";
import { historyProfile } from "./helpers/history-profile.ts";

let profile: ReturnType<typeof historyProfile> | undefined;
afterEach(() => {
  profile?.finish();
  profile = undefined;
  vi.mocked(open).mockImplementation(nativeOpen);
});

vi.mock("node:child_process", async (original) => {
  const value = await original<typeof import("node:child_process")>();
  return { ...value, spawn: vi.fn(value.spawn) };
});
vi.mock("node:fs/promises", async (original) => {
  const value = await original<typeof import("node:fs/promises")>();
  return { ...value, open: vi.fn(value.open) };
});
const nativeOpen = vi.mocked(open).getMockImplementation()!;
function diskBytes(path: string): [string, string][] {
  return readdirSync(path, { withFileTypes: true }).flatMap(
    (e): [string, string][] =>
      e.isDirectory()
        ? diskBytes(join(path, e.name))
        : [
            [
              join(path, e.name),
              readFileSync(join(path, e.name)).toString("hex"),
            ],
          ],
  );
}
async function capture(
  f: ReturnType<typeof historyFixture>,
  events: PublicRecordingInput["events"][number]["event"][],
) {
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
  const reserved = f.writer.capture(f.link).reserve({
    sourceFrames: events.length,
    retainedBytes: 0,
    outputBytes: Buffer.byteLength(canonicalJson(input)),
    outputChunks: events.length,
    lane: "data",
  });
  if (reserved.status !== "reserved")
    throw new Error("Fixture reservation refused");
  return reserved.reservation.commit(input);
}
async function ownerContent(
  f: ReturnType<typeof historyFixture>,
  body: string,
  grow = false,
) {
  const detailId = randomUUID();
  const input: OwnerRecordingInput = {
    observedMs: 0,
    link: { ...f.link, operationId: f.intent.operationId },
    events: [],
  };
  // OwnerLink deliberately has no child identity.
  input.link = {
    epoch: f.link.epoch,
    taskId: f.link.taskId,
    runId: null,
    operationId: f.intent.operationId,
  };
  input.events.push({
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
  });
  const utf8 = Buffer.from(body);
  for (let at = 0; at < utf8.length; ) {
    let end = Math.min(at + 8192, utf8.length);
    while (end < utf8.length && (utf8[end] & 0xc0) === 0x80) end--;
    input.events.push({
      kind: "content-chunk",
      detailId,
      text: utf8.subarray(at, end).toString("utf8"),
    });
    at = end;
  }
  input.events.push({ kind: "content-end", detailId, coverage: COMPLETE });
  const budget = {
    sourceFrames: 0,
    retainedBytes: 0,
    outputBytes: Buffer.byteLength(canonicalJson(input)),
    outputChunks: input.events.length,
    lane: "data" as const,
  };
  const r = f.writer
    .owner()
    .reserve(
      grow
        ? { ...budget, retainedBytes: 1, outputBytes: 0, outputChunks: 0 }
        : budget,
    );
  if (r.status !== "reserved") throw new Error("Fixture reservation refused");
  if (grow && r.reservation.grow(budget).status !== "reserved")
    throw new Error("Fixture growth refused");
  return r.reservation.commit(input);
}
it("passive absent open neither initializes history nor creates coordination", () => {
  const dir = mkdtempSync(join(tmpdir(), "cadence-w3-absent-")),
    root = join(dir, "project");
  mkdirSync(root);
  const c = new ServiceCoordination(root, join(dir, "state"));
  expect(HistoryReader.open(c)).toBeUndefined();
  expect(existsSync(join(dir, "state"))).toBe(false);
});
it("exclusive command identity and control CAS remain durable across reader restart", async () => {
  const f = historyFixture();
  const results = await Promise.all([
    f.writer.commit(f.intent),
    f.writer.commit(f.intent),
  ]);
  expect(results.map((r) => r.status)).toEqual(["committed", "existing"]);
  expect(
    await f.writer.commit({
      ...f.intent,
      identity: {
        kind: "action",
        expected: f.context,
        action: { kind: "start", taskId: f.link.taskId },
      },
    }),
  ).toMatchObject({ status: "refused", error: { code: "conflict" } });
  expect(
    await f.writer.commit({ ...f.intent, commandId: randomUUID() }),
  ).toMatchObject({ status: "refused", error: { code: "stale" } });
  expect(f.writer.currentContext(f.link.taskId)?.controlRev).toBe(2);
  const restarted = new HistoryWriter(f.lease);
  expect(restarted.currentContext(f.link.taskId)).toBeNull();
  expect(await restarted.lookup(f.intent.commandId)).toEqual(
    await f.writer.lookup(f.intent.commandId),
  );
  expect(restarted.pendingWrites).toBe(0);
});
it("partial exclusive intent is inconclusive, never absent or replayable", async () => {
  const f = historyFixture();
  const dir = join(f.files.directory, "commands", f.intent.commandId);
  f.files.files.directory(dir, true);
  f.files.files.create(join(dir, "intent.json"), "{");
  const before = diskBytes(f.files.directory);
  expect(await f.writer.lookup(f.intent.commandId)).toEqual({
    status: "inconclusive",
  });
  expect(await f.writer.commit(f.intent)).toEqual({ status: "uncertain" });
  expect(diskBytes(f.files.directory)).toEqual(before);
});
it("unmatched auth and launch are independently retained restart fences", async () => {
  for (const kind of ["auth", "launch"] as const) {
    const f = historyFixture();
    await f.writer.commit(f.intent);
    await admitFixtureRun(f);
    if (kind === "auth")
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
      ).toBe("committed");
    else {
      await prepareFixtureChild(f);
      expect(
        (await f.writer.processes.launchIntent(f.link, f.intent.operationId))
          .status,
      ).toBe("committed");
    }
    const before = diskBytes(f.files.directory),
      restart = new HistoryWriter(f.lease);
    expect(restart.quarantined).toBe(true);
    expect(restart.pendingWrites).toBe(0);
    expect(diskBytes(f.files.directory)).toEqual(before);
  }
});
it("owner content has no fictitious child and survives exact UTF-8 detail paging", async () => {
  const f = historyFixture(),
    body = "retained λ\n".repeat(7000);
  const result = await ownerContent(f, body);
  expect(result.status).toBe("committed");
  if (result.status !== "committed") throw new Error("No commit");
  expect(result.batch.details).toEqual([]);
  const d = result.batch.ownerDetails[0];
  expect(d.operationId).toBe(f.intent.operationId);
  const reader = HistoryReader.open(f.c)!;
  const cursor: ReadCursor = {
    storeId: reader.storeId,
    scope: { kind: "task", id: f.link.taskId },
    snapshotSeq: reader.inspect().committedSeq,
    query: null,
    recordId: d.content.recordId,
    recordVersion: 1,
    field: "plan",
    offset: 0,
  };
  const before = diskBytes(f.files.directory);
  expect((await reader.detail(cursor)).text).toBe(body);
  expect(diskBytes(f.files.directory)).toEqual(before);
  expect(await HistoryReader.open(f.c)!.detail(cursor)).toEqual(
    await reader.detail(cursor),
  );
});
it("batched sibling sinks return only their own exact committed detail mappings", async () => {
  const f = historyFixture();
  await f.writer.commit(f.intent);
  const other = { ...f, link: { ...f.link, childRunId: randomUUID() } };
  await admitFixtureRun(f, [f.link.childRunId, other.link.childRunId]);
  await prepareFixtureChild(f);
  await prepareFixtureChild(other);
  await f.writer.processes.launchIntent(f.link, f.intent.operationId);
  await f.writer.processes.launchIntent(other.link, f.intent.operationId);
  const writes = [f, other].map((fixture) => {
    const messageId = randomUUID(),
      detailId = randomUUID();
    return capture(fixture, [
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
      { kind: "stored-chunk", detailId, text: "independently retained" },
      { kind: "stored-end", detailId, coverage: COMPLETE },
      {
        kind: "message-end",
        messageId,
        finalDetailId: detailId,
        finalBlockCount: 1,
        stopReason: "stop",
      },
      { kind: "final", messageId, detailId, stopReason: "stop" },
    ]);
  });
  const results = await Promise.all(writes);
  for (const [index, result] of results.entries()) {
    expect(result.status).toBe("committed");
    if (result.status !== "committed") throw new Error("No commit");
    expect(result.batch.details).toHaveLength(1);
    expect(result.batch.details[0].childRunId).toBe(
      index ? other.link.childRunId : f.link.childRunId,
    );
  }
});
it("warm detail locators retain old snapshots after append, but reject changed artifact bytes", async () => {
  const f = historyFixture();
  const result = await ownerContent(f, "retained body");
  if (result.status !== "committed") throw new Error("No commit");
  const d = result.batch.ownerDetails[0].content,
    reader = HistoryReader.open(f.c)!;
  const cursor: ReadCursor = {
    storeId: reader.storeId,
    scope: { kind: "task", id: f.link.taskId },
    snapshotSeq: result.batch.committedSeq,
    query: null,
    recordId: d.recordId,
    recordVersion: d.version,
    field: d.field,
    offset: 0,
  };
  expect((await reader.detail(cursor)).text).toBe("retained body");
  await ownerContent(f, "later body");
  expect((await reader.detail(cursor)).text).toBe("retained body");
  const file = diskBytes(join(f.files.directory, "runs")).find(
    ([p]) => p.includes(d.recordId) && p.endsWith(".part"),
  )![0];
  writeFileSync(file, "modified body");
  await expect(reader.detail(cursor)).rejects.toThrow();
});
it("detail pages never skip a UTF-8 scalar at the byte ceiling", async () => {
  const f = historyFixture(),
    body = `${"x".repeat(LIMITS.detailPageBytes - 1)}😀tail`;
  const result = await ownerContent(f, body);
  if (result.status !== "committed") throw new Error("No commit");
  const d = result.batch.ownerDetails[0].content,
    reader = HistoryReader.open(f.c)!;
  const cursor: ReadCursor = {
    storeId: reader.storeId,
    scope: { kind: "task", id: f.link.taskId },
    snapshotSeq: result.batch.committedSeq,
    query: null,
    recordId: d.recordId,
    recordVersion: d.version,
    field: d.field,
    offset: 0,
  };
  const first = await reader.detail(cursor);
  expect(first.text).toBe("x".repeat(LIMITS.detailPageBytes - 1));
  expect(first.next?.offset).toBe(LIMITS.detailPageBytes - 1);
  expect((await reader.detail(first.next!)).text).toBe("😀tail");
});
it("idle flush records only a real owner epoch and quota inventory counts orphan bytes", async () => {
  const f = historyFixture();
  const flush = await f.writer.flush();
  expect(flush).toMatchObject({
    status: "committed",
    batch: { committedSeq: "1", details: [], ownerDetails: [] },
  });
  const orphan = join(f.files.directory, "indexes", "orphan");
  f.files.files.create(orphan, "x".repeat(600 * 1024), 1024 * 1024);
  const before = readFileSync(orphan);
  const writer = new HistoryWriter(f.lease, {
    quotaBytes: 1024 * 1024,
    episodeReservationBytes: 1024 * 1024,
  });
  writer.supplyContext(f.context);
  expect(await writer.commit(f.intent)).toEqual({ status: "uncertain" });
  expect(readFileSync(orphan)).toEqual(before);
  expect(writer.files.usage()).toBeGreaterThan(600 * 1024);
});
it("free-space safety floor refuses before native writes without consuming retained history", async () => {
  const f = historyFixture();
  await ownerContent(f, "older");
  const before = diskBytes(f.files.directory);
  const spy = vi
    .spyOn(f.writer.files, "freeBytes")
    .mockReturnValue(LIMITS.freeSpaceFloorBytes - 1);
  expect(await f.writer.commit(f.intent)).toEqual({ status: "uncertain" });
  spy.mockRestore();
  expect(diskBytes(f.files.directory)).toEqual(before);
});
it("torn uncommitted tail preserves exact bytes and only publishes the validated prefix", async () => {
  const f = historyFixture();
  await f.writer.commit(f.intent);
  const path = f.files.segmentPath(1),
    prefix = readFileSync(path);
  writeFileSync(path, Buffer.concat([prefix, Buffer.from('{"kind":"record"')]));
  const before = diskBytes(f.files.directory),
    reader = HistoryReader.open(f.c)!;
  expect(reader.inspect()).toMatchObject({ committedSeq: "1", tail: true });
  expect(reader.coverage("1").observed).toBe("incomplete");
  expect(new HistoryWriter(f.lease).quarantined).toBe(true);
  expect(diskBytes(f.files.directory)).toEqual(before);
});
for (const fault of ["interior", "artifact", "hardlink", "mode"] as const)
  it(`selected ${fault} refuses without repair`, async () => {
    const f = historyFixture();
    await ownerContent(f, "retained");
    const path =
      fault === "interior"
        ? f.files.segmentPath(1)
        : diskBytes(join(f.files.directory, "runs")).find(([p]) =>
            p.endsWith(".part"),
          )![0];
    if (fault === "hardlink") linkSync(path, join(f.dir, "other-link"));
    else if (fault === "mode") {
      if (process.platform === "win32") return;
      chmodSync(path, 0o644);
    } else
      writeFileSync(
        path,
        readFileSync(path)
          .toString()
          .replace(
            fault === "interior" ? '"seq":"1"' : "retained",
            fault === "interior" ? '"seq":"2"' : "altered!",
          ),
      );
    const before = diskBytes(f.files.directory);
    expect(() => HistoryReader.open(f.c)!.inspect()).toThrow();
    expect(diskBytes(f.files.directory)).toEqual(before);
  });
it("quota saturation includes orphans and injected ENOSPC retains fences and old readable bytes", async () => {
  const f = historyFixture({ quotaBytes: 2 * 1024 * 1024 });
  expect(await f.writer.commit(f.intent)).toEqual({ status: "uncertain" });
  expect(f.writer.quarantined).toBe(true);
  const g = historyFixture();
  await ownerContent(g, "older content");
  const before = readFileSync(g.files.segmentPath(1));
  const spy = vi.spyOn(g.files.files, "create").mockImplementationOnce(() => {
    throw Object.assign(new Error("injected"), { code: "ENOSPC" });
  });
  expect((await ownerContent(g, "new content")).status).toBe("refused");
  spy.mockRestore();
  expect(g.writer.quarantined).toBe(true);
  expect(readFileSync(g.files.segmentPath(1))).toEqual(before);
  expect(HistoryReader.open(g.c)!.inspect().tail).toBe(false);
});

let crashFixture: string;
let coldDetailFixture: string;
beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "cadence-w3-native-"));
  crashFixture = join(dir, "crash.mjs");
  const built = spawnSync(
    "bun",
    [
      "build",
      fileURLToPath(new URL("./helpers/history-crash.ts", import.meta.url)),
      "--target=node",
      "--packages=external",
      `--outfile=${crashFixture}`,
    ],
    { encoding: "utf8", timeout: 10000 },
  );
  expect(built.status, built.stderr).toBe(0);
  coldDetailFixture = join(dir, "cold-detail.mjs");
  const cold = spawnSync(
    "bun",
    [
      "build",
      fileURLToPath(
        new URL("./helpers/history-cold-detail.ts", import.meta.url),
      ),
      "--target=node",
      "--packages=external",
      `--outfile=${coldDetailFixture}`,
    ],
    { encoding: "utf8", timeout: 10000 },
  );
  expect(cold.status, cold.stderr).toBe(0);
});
for (const boundary of [
  "intent",
  "journal",
  "commit",
  "auth",
  "launch",
  "checkpoint",
  "run-admission",
] as const)
  it(`original subprocess crash after ${boundary} never replays or repairs`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "cadence-w3-crash-"));
    const native = spawnSync(process.execPath, [crashFixture, dir, boundary], {
      encoding: "utf8",
      timeout: 10000,
    });
    expect(native.status, native.stderr).toBe(77);
    expect(native.signal).toBeNull();
    const c = new ServiceCoordination(join(dir, "project"), join(dir, "state"));
    const reader = HistoryReader.open(c)!;
    const before = diskBytes(reader.files.directory),
      state = reader.inspect();
    expect(state.committedSeq).toBe(
      boundary === "intent" || boundary === "journal"
        ? "0"
        : boundary === "auth"
          ? "3"
          : boundary === "launch"
            ? "5"
            : "1",
    );
    expect(existsSync(c.store.lockPath)).toBe(true);
    expect(() =>
      c.acquire({
        schema: "cadence-service-owner-config/1",
        endpoint: "http://127.0.0.1:17423",
        policyIdentity: "a".repeat(64),
      }),
    ).toThrow();
    expect(diskBytes(reader.files.directory)).toEqual(before);
  });

// Review controls use fabricated port inputs and actual private files, not extra SDK runs.
async function retainedCompletion(
  f: ReturnType<typeof historyFixture>,
  coverage = COMPLETE,
) {
  await f.writer.commit(f.intent);
  await admitFixtureRun(f);
  await prepareFixtureChild(f);
  await f.writer.processes.launchIntent(f.link, f.intent.operationId);
  const messageId = randomUUID(),
    detailId = randomUUID();
  const result = await capture(f, [
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
    { kind: "stored-chunk", detailId, text: "retained final" },
    { kind: "stored-end", detailId, coverage },
    {
      kind: "message-end",
      messageId,
      finalDetailId: detailId,
      finalBlockCount: 1,
      stopReason: "stop",
    },
    { kind: "final", messageId, detailId, stopReason: "stop" },
  ]);
  if (result.status !== "committed") throw new Error("Fixture commit failed");
  const completion: WorkerCompletion = {
    childRunId: f.link.childRunId,
    native: {
      ...failedCompletion(f.link.childRunId).native,
      outcome: "completed",
      exitCode: 0,
      final: "valid",
    },
    selected: { messageId, detailId },
    recording: {
      status: "committed",
      selected: { messageId, detailId },
      detail: result.batch.details[0],
    },
  };
  return completion;
}
it("foundation review: concurrent distinct commands cannot both consume one context", async () => {
  const f = historyFixture();
  const results = await Promise.all([
    f.writer.commit(f.intent),
    f.writer.commit({
      ...f.intent,
      commandId: randomUUID(),
      operationId: randomUUID(),
      runId: randomUUID(),
    }),
  ]);
  expect(results.map((r) => r.status)).toEqual(["committed", "refused"]);
  expect(
    [...HistoryReader.open(f.c)!.rows(f.writer.committedSeq)].filter(
      (r) => r.value.kind === "admission",
    ),
  ).toHaveLength(1);
});
it("foundation review: settled auth operation cannot authorize a second preparation", async () => {
  const f = historyFixture();
  await f.writer.commit(f.intent);
  await admitFixtureRun(f);
  const intent = {
    operationId: randomUUID(),
    epoch: f.link.epoch,
    runId: f.link.runId,
    childRunId: f.link.childRunId,
    sourceSelectionId: f.context.model.sourceSelectionId,
    validityMs: 1000,
  };
  expect((await f.writer.auth.preparation(intent)).status).toBe("committed");
  expect(
    (
      await f.writer.auth.settlement({
        operationId: intent.operationId,
        outcome: "resolved",
        admissionClosed: false,
      })
    ).status,
  ).toBe("committed");
  expect((await f.writer.auth.preparation(intent)).status).toBe("refused");
});
it("foundation review: settled child identity cannot authorize a second launch", async () => {
  const f = historyFixture();
  await f.writer.commit(f.intent);
  await admitFixtureRun(f);
  await prepareFixtureChild(f);
  await f.writer.processes.launchIntent(f.link, f.intent.operationId);
  expect(
    (
      await f.writer.processes.settlement(
        f.link,
        failedCompletion(f.link.childRunId),
      )
    ).status,
  ).toBe("committed");
  expect(
    (await f.writer.processes.launchIntent(f.link, f.intent.operationId))
      .status,
  ).toBe("refused");
});
it("foundation review: live unknown closure fences just as restart does", async () => {
  const f = historyFixture();
  await f.writer.commit(f.intent);
  await admitFixtureRun(f);
  await prepareFixtureChild(f);
  await f.writer.processes.launchIntent(f.link, f.intent.operationId);
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
  expect(new HistoryWriter(f.lease).quarantined).toBe(true);
  expect(
    (
      await f.writer.processes.launchIntent(
        { ...f.link, childRunId: randomUUID() },
        randomUUID(),
      )
    ).status,
  ).toBe("refused");
});
for (const fault of ["watermark", "reference", "artifact"] as const)
  it(`foundation review: final settlement rejects altered ${fault}`, async () => {
    const f = historyFixture();
    const completion = await retainedCompletion(f);
    if (completion.recording.status !== "committed")
      throw new Error("Fixture result absent");
    if (fault === "watermark") completion.recording.detail.committedSeq = "1";
    if (fault === "reference")
      completion.recording.detail.content.sha256 = "b".repeat(64);
    if (fault === "artifact") {
      const part = diskBytes(join(f.files.directory, "runs")).find(([p]) =>
        p.endsWith(".part"),
      )![0];
      writeFileSync(part, "altered final!");
    }
    const before = readFileSync(f.files.segmentPath(1));
    expect(
      (await f.writer.processes.settlement(f.link, completion)).status,
    ).toBe("refused");
    expect(readFileSync(f.files.segmentPath(1))).toEqual(before);
  });
it("foundation review: pending launch does not expose tentative capture authority", async () => {
  let hold = false,
    reached!: () => void,
    release!: () => void;
  const entered = new Promise<void>((yes) => {
    reached = yes;
  });
  const gate = new Promise<void>((yes) => {
    release = yes;
  });
  const f = historyFixture({
    observeWrite: async (at) => {
      if (hold && at === "journal") {
        reached();
        await gate;
      }
    },
  });
  await f.writer.commit(f.intent);
  await admitFixtureRun(f);
  await prepareFixtureChild(f);
  hold = true;
  const pending = f.writer.processes.launchIntent(f.link, f.intent.operationId);
  await entered;
  try {
    expect(() => f.writer.capture(f.link)).toThrow();
  } finally {
    release();
    await pending;
  }
  expect(() => f.writer.capture(f.link)).not.toThrow();
});
it("foundation review: readers and receipt lookup cannot publish an unflushed marker", async () => {
  const f = historyFixture();
  let reached!: () => void, release!: () => void;
  const entered = new Promise<void>((yes) => {
    reached = yes;
  });
  const gate = new Promise<void>((yes) => {
    release = yes;
  });
  vi.mocked(open).mockImplementationOnce(async (...args) => {
    const fd = await nativeOpen(...args),
      sync = fd.sync.bind(fd);
    vi.spyOn(fd, "sync").mockImplementationOnce(async () => {
      reached();
      await gate;
      await sync();
    });
    return fd;
  });
  const pending = f.writer.commit(f.intent);
  await entered;
  try {
    expect(readFileSync(f.files.segmentPath(1), "utf8")).toContain(
      '"kind":"commit"',
    );
    expect(HistoryReader.open(f.c)!.inspect().committedSeq).toBe("0");
    expect(await f.writer.lookup(f.intent.commandId)).toEqual({
      status: "inconclusive",
    });
    let observed = false;
    const admissionRead = f.writer
      .lookupForAdmission(f.intent.commandId)
      .then((result) => {
        observed = true;
        return result;
      });
    await Promise.resolve();
    expect(observed).toBe(false);
    release();
    await pending;
    expect((await admissionRead).status).toBe("found");
  } finally {
    release();
    await pending;
  }
  expect(HistoryReader.open(f.c)!.inspect().committedSeq).toBe("1");
});
for (const damaged of ["snapshot", "interior"] as const)
  it(`foundation review: warm detail revalidates ${damaged} in a later segment`, async () => {
    profile = historyProfile(`cold-${damaged}`);
    const f = historyFixture(),
      result = await ownerContent(f, "old content");
    if (result.status !== "committed") throw new Error("Fixture commit failed");
    const rows: JournalRow[] = Array.from(
      { length: LIMITS.segmentRecords - 1 },
      (_, i) => ({
        kind: "record",
        seq: String(i + 2),
        id: randomUUID(),
        value: { kind: "owner-epoch", epoch: f.link.epoch },
      }),
    );
    let state = await f.files.append(f.lease, f.files.inspect(), rows);
    expect(state.segment).toBe(2);
    if (damaged === "interior")
      state = await f.files.append(f.lease, state, [
        {
          kind: "record",
          seq: String(BigInt(state.committedSeq) + 1n),
          id: randomUUID(),
          value: { kind: "owner-epoch", epoch: f.link.epoch },
        },
      ]);
    const d = result.batch.ownerDetails[0].content,
      reader = HistoryReader.open(f.c)!;
    const cursor: ReadCursor = {
      storeId: reader.storeId,
      scope: { kind: "task", id: f.link.taskId },
      snapshotSeq: state.committedSeq,
      query: null,
      recordId: d.recordId,
      recordVersion: 1,
      field: d.field,
      offset: 0,
    };
    writeFileSync(join(f.dir, "cold-cursor.json"), JSON.stringify(cursor), {
      mode: 0o600,
    });
    const cold = spawnSync(process.execPath, [coldDetailFixture, f.dir], {
      encoding: "utf8",
      timeout: 2000,
    });
    expect(cold.status, cold.stdout + cold.stderr).toBe(0);
    expect(cold.signal).toBeNull();
    expect(cold.stderr).toBe("");
    if (process.env.CADENCE_HISTORY_PROFILE)
      writeFileSync(
        join(
          process.env.CADENCE_HISTORY_PROFILE,
          `cold-native-${damaged}.json`,
        ),
        cold.stdout,
        { mode: 0o600 },
      );
    expect(JSON.parse(cold.stdout)).toMatchObject({
      status: "read",
      bytes: 11,
      sha256: createHash("sha256").update("old content").digest("hex"),
    });
    expect((await reader.detail(cursor)).text).toBe("old content");
    const path = f.files.segmentPath(2);
    writeFileSync(
      path,
      readFileSync(path, "utf8").replace('"seq":"2"', '"seq":"0"'),
    );
    const before = diskBytes(f.files.directory);
    await expect(reader.detail(cursor)).rejects.toThrow();
    expect(diskBytes(f.files.directory)).toEqual(before);
  });

it("foundation review: context changed during original IO cannot be overwritten into acceptance", async () => {
  let reached!: () => void, release!: () => void;
  const entered = new Promise<void>((yes) => {
    reached = yes;
  });
  const gate = new Promise<void>((yes) => {
    release = yes;
  });
  const f = historyFixture({
    observeWrite: async (at) => {
      if (at === "commit") {
        reached();
        await gate;
      }
    },
  });
  const pending = f.writer.commit(f.intent);
  await entered;
  const changed = { ...f.context, configRev: 2 };
  f.writer.supplyContext(changed);
  release();
  expect(await pending).toEqual({ status: "uncertain" });
  expect(f.writer.currentContext(f.link.taskId)).toEqual(changed);
  expect(f.writer.quarantined).toBe(true);
});
it("foundation review: grown ingress budgets still bound real progress batches", async () => {
  const f = historyFixture();
  const results = await Promise.all(
    Array.from({ length: 40 }, () => ownerContent(f, "x".repeat(8192), true)),
  );
  expect(results.every((r) => r.status === "committed")).toBe(true);
  for (const batch of f.files.scan())
    expect(
      batch.marker.artifacts.reduce((n, a) => n + a.bytes, 0),
    ).toBeLessThanOrEqual(LIMITS.progressBatchBytes);
  expect(HistoryReader.open(f.c)!.inspect().tail).toBe(false);
  expect(f.writer.accounting.owner.bytes).toBe(0);
  expect(f.writer.quarantined).toBe(false);
});

it("foundation review: warm readers refuse replaced store identity", async () => {
  const f = historyFixture(),
    result = await ownerContent(f, "retained content");
  if (result.status !== "committed") throw new Error("Fixture commit failed");
  const d = result.batch.ownerDetails[0].content,
    reader = HistoryReader.open(f.c)!;
  const cursor: ReadCursor = {
    storeId: reader.storeId,
    scope: { kind: "task", id: f.link.taskId },
    snapshotSeq: result.batch.committedSeq,
    query: null,
    recordId: d.recordId,
    recordVersion: 1,
    field: d.field,
    offset: 0,
  };
  await reader.detail(cursor);
  const path = join(f.files.directory, "format.json");
  writeFileSync(
    path,
    JSON.stringify({ ...f.files.format, storeId: randomUUID() }),
  );
  const before = diskBytes(f.files.directory);
  await expect(reader.detail(cursor)).rejects.toThrow();
  expect(diskBytes(f.files.directory)).toEqual(before);
});

it("foundation review: control flush drains progress without firing its batching timer", async () => {
  const f = historyFixture();
  vi.useFakeTimers();
  try {
    const progress = ownerContent(f, "queued progress");
    const control = f.writer.flush();
    expect((await control).status).toBe("committed");
    expect((await progress).status).toBe("committed");
    expect(HistoryReader.open(f.c)!.inspect().committedSeq).toBe("1");
    expect(f.writer.pendingWrites).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("review: native zero cannot satisfy committed final recording with an incomplete retained detail", async () => {
  const f = historyFixture();
  const completion = await retainedCompletion(f, {
    ...COMPLETE,
    observed: "incomplete",
    omissions: ["gap"],
  });
  const seq = f.writer.committedSeq;
  expect((await f.writer.processes.settlement(f.link, completion)).status).toBe(
    "refused",
  );
  expect(f.writer.committedSeq).toBe(seq);
  expect(completion.native).toMatchObject({
    outcome: "completed",
    exitCode: 0,
    closure: "direct-child-closed",
  });
});
