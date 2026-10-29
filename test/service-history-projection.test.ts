import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { HistoryReadBudget } from "../src/history/files.ts";
import {
  HistoryProjection,
  type ReadEnvironment,
} from "../src/history/projection.ts";
import { HistoryReader } from "../src/history/reader.ts";
import { COMPLETE } from "../src/history/types.ts";
import {
  ContractError,
  canonicalJson,
  type ListRequest,
  type PublicRecordingInput,
  publicError,
} from "../src/service-contract.ts";
import { entityData, historyData } from "./helpers/history-data-read.ts";
import {
  admitFixtureRun,
  failedCompletion,
  historyFixture,
  ownerFact,
  prepareFixtureChild,
  settleFixtureRun,
} from "./helpers/history-fixture.ts";

const nativeReads = vi.hoisted(() => ({ calls: 0, requested: 0 }));
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  const { metadataIO } = await import("./helpers/history-metadata-counters.ts");
  const watched = Object.fromEntries(
    [
      "readSync",
      "readFileSync",
      "writeSync",
      "fsyncSync",
      "openSync",
      "closeSync",
      "lstatSync",
      "fstatSync",
      "readdirSync",
    ].map((name) => [
      name,
      (...args: unknown[]) => {
        const result = Reflect.apply(Reflect.get(fs, name), fs, args);
        metadataIO(name, args, result);
        return result;
      },
    ]),
  );
  return {
    ...fs,
    ...watched,
    readSync: (...args: unknown[]) => {
      nativeReads.calls++;
      nativeReads.requested += Number(args[3]);
      return watched.readSync(...args);
    },
  };
});
function projection(f: ReturnType<typeof historyFixture>) {
  let epoch = f.link.epoch,
    available = true;
  const environment: ReadEnvironment = {
    session: () => ({
      protocol: 1,
      storeId: f.files.format.storeId,
      epoch,
      authority: "local",
      accessGeneration: 1,
      csrf: null,
      capabilities: { actions: false, manualChecks: false, history: true },
    }),
    workspace: () => ({
      rootLabel: "fixture",
      models: [f.context.model],
      context: {
        status: "unavailable",
        workspaceId: f.files.format.workspaceId,
        taskId: null,
        error: publicError("unavailable"),
      },
    }),
    context: (taskId) =>
      available
        ? {
            status: "available",
            version: {
              ...f.context,
              epoch,
              task: { ...f.context.task!, id: taskId },
            },
          }
        : {
            status: "unavailable",
            workspaceId: f.files.format.workspaceId,
            taskId,
            error: publicError("unavailable"),
          },
    checks: () => ({ revision: 0, selections: [] }),
    legacyTasks: () => [],
  };
  const p = new HistoryProjection(HistoryReader.open(f.c)!, environment);
  return {
    p,
    environment,
    setEpoch: (e: string) => {
      epoch = e;
    },
    unavailable: () => {
      available = false;
    },
  };
}
const list = (
  f: ReturnType<typeof historyFixture>,
  reader: ListRequest["reader"],
): ListRequest => ({
  reader,
  storeId: f.files.format.storeId,
  scope:
    reader === "tasks"
      ? { kind: "workspace", id: f.files.format.workspaceId }
      : { kind: "run", id: f.link.runId },
  snapshotSeq: null,
  after: null,
  limit: 50,
});
async function active() {
  const f = historyFixture();
  expect((await f.writer.commit(f.intent)).status).toBe("committed");
  await admitFixtureRun(f);
  return f;
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
  if (lease.status !== "reserved") throw Error("fixture reserve");
  expect((await lease.reservation.commit(input)).status).toBe("committed");
}
const files = (path: string): [string, string][] =>
  readdirSync(path, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? files(join(path, e.name))
      : [
          [
            join(path, e.name),
            readFileSync(join(path, e.name)).toString("hex"),
          ],
        ],
  );
it("all retained methods have concrete implementations; bootstrap is readonly current context, not old admission", async () => {
  const f = await active(),
    { p, unavailable, setEpoch } = projection(f);
  const before = files(f.files.directory);
  expect((await p.session()).storeId).toBe(f.files.format.storeId);
  expect((await p.workspace()).models).toEqual([f.context.model]);
  const historical = await historyData(p.runs.bind(p), list(f, "runs"));
  expect(historical.records).toHaveLength(2);
  const originalModel = f.context.model;
  f.context = {
    ...f.context,
    configRev: 2,
    model: {
      ...originalModel,
      sourceSelectionId: randomUUID(),
      model: "current-second",
    },
  };
  const current = await p.snapshot({ kind: "run", id: f.link.runId });
  expect(current.context).toMatchObject({
    status: "available",
    version: { model: { model: "current-second" } },
  });
  expect(
    current.runs.every(
      (r) => r.admission.context.model.model === originalModel.model,
    ),
  ).toBe(true);
  expect((await p.workspace()).models[0].model).toBe("current-second");
  unavailable();
  setEpoch(randomUUID());
  const snap = await p.snapshot({ kind: "run", id: f.link.runId });
  expect(snap.context.status).toBe("unavailable");
  expect(snap.runs.map((r) => r.outcome)).toEqual(["unknown", "unknown"]);
  expect(snap.runs.every((r) => r.settlement === null)).toBe(true);
  expect(snap.runs[0].admission.context.epoch).toBe(f.link.epoch);
  for (const method of [
    "tasks",
    "messages",
    "tools",
    "contents",
    "events",
    "checks",
    "changes",
    "reviews",
  ] as const)
    expect((await p[method](list(f, method))).request.reader).toBe(method);
  expect(await p.checkObligations(f.link.taskId)).toEqual({
    taskId: f.link.taskId,
    revision: 0,
    definitions: [],
  });
  expect(files(f.files.directory)).toEqual(before);
});
it("message/entity versions, final content versions, partial declarations and orphan results remain distinct", async () => {
  const f = await active();
  await prepareFixtureChild(f);
  await f.writer.processes.launchIntent(f.link, f.intent.operationId);
  const message = randomUUID(),
    call = randomUUID(),
    block = randomUUID(),
    detail = randomUUID(),
    orphan = randomUUID(),
    source = { disposition: "unavailable" as const, value: null };
  await capture(f, [
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
    { kind: "stored-chunk", detailId: detail, text: "retained 😀" },
    {
      kind: "stored-end",
      detailId: detail,
      coverage: {
        ...COMPLETE,
        source: "limited",
        redacted: true,
        omissions: ["source-limit"],
      },
    },
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
  ]);
  const { p } = projection(f),
    messages = await historyData(p.messages.bind(p), list(f, "messages")),
    tools = await historyData(p.tools.bind(p), list(f, "tools"));
  expect(messages.records).toHaveLength(1);
  const m = messages.records[0];
  if (m.kind !== "message") throw Error("message");
  expect(m.version).toBe(2);
  expect(m.finalText?.version).toBe(1);
  expect(
    (await p.snapshot({ kind: "run", id: f.link.runId })).runs[0].coverage,
  ).toMatchObject({
    source: "limited",
    redacted: true,
    omissions: ["unsupported", "source-limit"],
  });
  const partial = await entityData(p.entity.bind(p), {
    storeId: p.reader.storeId,
    scope: { kind: "run", id: f.link.runId },
    snapshotSeq: f.writer.committedSeq,
    kind: "message",
    id: message,
    version: 1,
  });
  expect(partial.record.kind === "message" && partial.record.state).toBe(
    "partial",
  );
  expect(
    tools.records.map((r) =>
      r.kind === "tool"
        ? [r.declarationStage, r.startObserved, r.result?.association]
        : null,
    ),
  ).toEqual([
    ["final", false, undefined],
    [null, false, "orphan"],
  ]);
  expect(
    (
      await entityData(p.entity.bind(p), {
        ...partial.request,
        kind: "tool",
        id: call,
        version: 1,
      })
    ).record,
  ).toMatchObject({ kind: "tool", declarationStage: "partial", version: 1 });
  const omissions = await historyData(p.contents.bind(p), list(f, "contents"));
  expect(omissions.records.find((r) => r.kind === "omitted")).toMatchObject({
    kind: "omitted",
    owner: { entity: { kind: "tool", id: call, version: 2 } },
    version: 2,
  });
  await expect(p.entity({ ...partial.request, version: 99 })).rejects.toThrow();
  await expect(
    p.entity({ ...partial.request, scope: { kind: "task", id: randomUUID() } }),
  ).rejects.toThrow();
});
it.each(["absent", "corrupt", "stale"])(
  "%s derived indexes do not create false absence or write on reads",
  async (mode) => {
    const f = await active(),
      { p } = projection(f),
      path = join(
        f.files.directory,
        "indexes",
        "commits",
        `${f.writer.committedSeq}.json`,
      );
    if (mode === "absent") renameSync(path, `${path}.preserved`);
    else
      writeFileSync(
        path,
        mode === "corrupt"
          ? "broken"
          : JSON.stringify({
              segment: 99,
              offset: 0,
              bytes: 1,
              seq: f.writer.committedSeq,
            }),
      );
    const before = files(f.files.directory);
    expect(
      (await historyData(p.events.bind(p), list(f, "events"))).records.some(
        (r) => r.kind === "owner-fact",
      ),
    ).toBe(true);
    expect(files(f.files.directory)).toEqual(before);
    await expect(
      p.events({ ...list(f, "events"), snapshotSeq: "999999" }),
    ).rejects.toThrow();
  },
);
it("IO admission refuses before native payload reads", async () => {
  const f = await active(),
    { p } = projection(f);
  nativeReads.calls = nativeReads.requested = 0;
  const gate = vi
    .spyOn(HistoryReadBudget.prototype, "reserve")
    .mockImplementation(() => {
      throw new ContractError("receipt-inconclusive");
    });
  try {
    await expect(p.events(list(f, "events"))).rejects.toThrow();
    expect(nativeReads.calls).toBe(0);
  } finally {
    gate.mockRestore();
  }
});
it("metadata cursors bind scope, reader, snapshot and exact position without rebasing", async () => {
  const f = await active(),
    { p } = projection(f);
  await ownerFact(f, {
    kind: "gate",
    lane: "reader",
    state: "waiting",
    checkoutGeneration: 0,
  });
  const page = await historyData(p.events.bind(p), {
    ...list(f, "events"),
    limit: 1,
  });
  expect(page.next).not.toBeNull();
  const next = page.next!;
  expect(
    (await historyData(projection(f).p.events.bind(projection(f).p), next))
      .records.length,
  ).toBeGreaterThan(0);
  for (const changed of [
    { scope: { kind: "run", id: randomUUID() } },
    { snapshotSeq: "1" },
    { after: { ...next.after!, offset: next.after!.offset + 1 } },
  ])
    await expect(
      p.events({ ...next, ...changed } as ListRequest),
    ).rejects.toThrow();
});
it("configured checks are obligations, never fabricated recorded passes", async () => {
  const f = await active(),
    { p, environment } = projection(f);
  environment.checks = () => ({
    revision: 8,
    selections: [
      { kind: "configured", name: "lint", command: "true", timeoutMs: 1000 },
    ],
  });
  expect(
    (await p.checkObligations(f.link.taskId)).definitions[0],
  ).toMatchObject({ status: "not-run", checkId: null });
});
it("journal-anchored heads ignore stale mutable indexes and fall back across a skipped entity predecessor", async () => {
  const f = await active();
  await prepareFixtureChild(f);
  await f.writer.processes.launchIntent(f.link, f.intent.operationId);
  const messageId = randomUUID(),
    source = { disposition: "unavailable" as const, value: null };
  await capture(f, [
    { kind: "ready", requestProtocol: 2 },
    {
      kind: "message-start",
      messageId,
      role: "assistant",
      source,
      resultCallId: null,
    },
  ]);
  const head = join(
      f.files.directory,
      "indexes",
      "entities",
      `${messageId}.json`,
    ),
    old = JSON.stringify({ seq: f.writer.committedSeq });
  expect(existsSync(head)).toBe(false); // current roots do not need this old hint
  await capture(f, [
    {
      kind: "message-end",
      messageId,
      finalDetailId: null,
      finalBlockCount: 0,
      stopReason: "unknown",
    },
  ]);
  const current = { seq: f.writer.committedSeq };
  mkdirSync(join(f.files.directory, "indexes", "entities"), {
    recursive: true,
  });
  writeFileSync(head, old); // deliberately stale legacy hint; no source rewrite
  const { p } = projection(f),
    query = {
      storeId: p.reader.storeId,
      scope: { kind: "run" as const, id: f.link.runId },
      snapshotSeq: f.writer.committedSeq,
      kind: "message" as const,
      id: messageId,
      version: 2,
    };
  expect((await entityData(p.entity.bind(p), query)).record).toMatchObject({
    kind: "message",
    version: 2,
    state: "final",
  });
  const link = join(
      f.files.directory,
      "indexes",
      "entity-links",
      messageId,
      `${current.seq}.json`,
    ),
    changed = JSON.parse(readFileSync(link, "utf8"));
  changed.previous = null;
  changed.previousHash = null;
  writeFileSync(link, JSON.stringify(changed));
  const before = files(f.files.directory);
  expect(
    (await entityData(projection(f).p.entity.bind(projection(f).p), query))
      .record,
  ).toMatchObject({
    kind: "message",
    version: 2,
    state: "final",
  });
  expect(files(f.files.directory)).toEqual(before);
});
it("stale run locators cannot hide committed launch; corrupt immutable nodes fall back without repair", async () => {
  const f = await active(),
    path = join(
      f.files.directory,
      "indexes",
      "run-locators",
      `${f.link.runId}.json`,
    ),
    old = readFileSync(path);
  await prepareFixtureChild(f);
  await f.writer.processes.launchIntent(f.link, f.intent.operationId);
  writeFileSync(path, old);
  const { p } = projection(f);
  expect(
    (await p.snapshot({ kind: "run", id: f.link.runId })).runs.every(
      (r) => r.lifecycle === "running",
    ),
  ).toBe(true);
  let root: string | null | undefined;
  for (const b of f.files.scan()) root = b.marker.navigationRoot;
  if (!root) throw Error("missing index anchor");
  const node = join(
    f.files.directory,
    "indexes",
    "nodes",
    root.slice(0, 2),
    `${root}.json`,
  );
  writeFileSync(node, '{"kind":"leaf","entries":{}}');
  const before = files(f.files.directory);
  expect(
    (await p.snapshot({ kind: "run", id: f.link.runId })).runs.every(
      (r) => r.lifecycle === "running",
    ),
  ).toBe(true);
  expect(
    (await historyData(p.events.bind(p), list(f, "events"))).records.some(
      (r) => r.kind === "owner-fact",
    ),
  ).toBe(true);
  expect(files(f.files.directory)).toEqual(before);
});
it("committed unknown native closure is quarantine/closing, not renewed preparation or invented settlement", async () => {
  const f = await active();
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
  const snapshot = await projection(f).p.snapshot({
    kind: "run",
    id: f.link.runId,
  });
  expect(snapshot.runs[0]).toMatchObject({
    lifecycle: "closing",
    outcome: null,
    settlement: null,
    reason: "quarantine",
  });
  expect(snapshot.runs[1]).toMatchObject({
    outcome: "unknown",
    reason: "quarantine",
    settlement: {
      kind: "sdk",
      native: { closure: "unconfirmed", exitCode: null },
    },
  });
  expect(f.writer.quarantined).toBe(true);
});

it("review: tool paging uses the committed batch watermark, not an interior row sequence", async () => {
  const f = await active();
  await prepareFixtureChild(f);
  await f.writer.processes.launchIntent(f.link, f.intent.operationId);
  const callId = randomUUID();
  await Promise.all([
    capture(f, [
      { kind: "ready", requestProtocol: 2 },
      {
        kind: "tool-start",
        callId,
        declaration: null,
        source: { disposition: "unavailable", value: null },
        name: "read",
        argsDetailId: randomUUID(),
      },
    ]),
    capture(f, [{ kind: "capture-status", coverage: COMPLETE }]),
  ]);
  const { p } = projection(f);
  expect(
    (await historyData(p.tools.bind(p), list(f, "tools"))).records,
  ).toMatchObject([
    { kind: "tool", owner: { entity: { id: callId } }, startObserved: true },
  ]);
});
it("review: child-scoped run pages include the allocated child without sibling leakage", async () => {
  const f = await active(),
    { p } = projection(f);
  const page = await historyData(p.runs.bind(p), {
    ...list(f, "runs"),
    scope: { kind: "child", id: f.link.childRunId },
  });
  expect(page.records).toHaveLength(1);
  expect(page.records[0]).toMatchObject({
    kind: "run",
    projection: { childRunId: f.link.childRunId },
  });
});
it("review: a durably blocked unstarted child stays blocked under a later owner epoch", async () => {
  const f = await active();
  await settleFixtureRun(f, "blocked");
  const { p, setEpoch } = projection(f);
  setEpoch(randomUUID());
  const snapshot = await p.snapshot({ kind: "run", id: f.link.runId });
  expect(snapshot.runs.map((r) => r.outcome)).toEqual(["blocked", "blocked"]);
  expect(snapshot.runs[1].reason).toBe("parent-stopped");
});
it("review: missing immutable navigation nodes fall back to committed entity bytes without repair", async () => {
  const f = await active();
  await prepareFixtureChild(f);
  await f.writer.processes.launchIntent(f.link, f.intent.operationId);
  const messageId = randomUUID();
  await capture(f, [
    { kind: "ready", requestProtocol: 2 },
    {
      kind: "message-start",
      messageId,
      role: "assistant",
      source: { disposition: "unavailable", value: null },
      resultCallId: null,
    },
  ]);
  const root = [...f.files.scan()].at(-1)?.marker.navigationRoot;
  if (!root) throw Error("root");
  const path = join(
    f.files.directory,
    "indexes",
    "nodes",
    root.slice(0, 2),
    `${root}.json`,
  );
  renameSync(path, `${path}.preserved`);
  const before = files(f.files.directory),
    { p } = projection(f);
  expect(
    (
      await entityData(p.entity.bind(p), {
        storeId: p.reader.storeId,
        scope: { kind: "run", id: f.link.runId },
        snapshotSeq: f.writer.committedSeq,
        kind: "message",
        id: messageId,
        version: 1,
      })
    ).record,
  ).toMatchObject({ kind: "message", version: 1 });
  expect(files(f.files.directory)).toEqual(before);
});
it("review: a checksum-valid marker cannot advertise a watermark outside its actual row range", async () => {
  const f = await active(),
    path = f.files.segmentPath(1);
  const lines = readFileSync(path, "utf8").trimEnd().split("\n");
  const marker = JSON.parse(lines.at(-1)!);
  marker.last = "999";
  lines[lines.length - 1] = canonicalJson(marker);
  writeFileSync(path, `${lines.join("\n")}\n`);
  // Lost accelerators must not make an invalid original marker acceptable.
  const indexes = join(f.files.directory, "indexes");
  renameSync(indexes, `${indexes}.preserved`);
  await expect(projection(f).p.workspace()).rejects.toThrow();
});
it("review: committed owner-redacted coverage remains on the child after native settlement", async () => {
  const f = await active();
  await prepareFixtureChild(f);
  await f.writer.processes.launchIntent(f.link, f.intent.operationId);
  await capture(f, [
    { kind: "ready", requestProtocol: 2 },
    {
      kind: "capture-status",
      coverage: {
        ...COMPLETE,
        source: "limited",
        redacted: true,
        omissions: ["source-limit"],
      },
    },
  ]);
  await f.writer.processes.settlement(
    f.link,
    failedCompletion(f.link.childRunId),
  );
  const snapshot = await projection(f).p.snapshot({
    kind: "run",
    id: f.link.runId,
  });
  expect(snapshot.runs[1].coverage).toMatchObject({
    source: "limited",
    redacted: true,
    omissions: ["source-limit"],
  });
});
it("review: retained pages expose a torn uncommitted tail without publishing or repairing it", async () => {
  const f = await active(),
    path = f.files.segmentPath(1);
  const bytes = Buffer.concat([
    readFileSync(path),
    Buffer.from('{"kind":"record"'),
  ]);
  writeFileSync(path, bytes);
  const page = await historyData(
    projection(f).p.events.bind(projection(f).p),
    list(f, "events"),
  );
  expect(page.records).toHaveLength(1);
  expect(page.coverage).toMatchObject({
    observed: "incomplete",
    omissions: ["gap"],
  });
  expect(readFileSync(path)).toEqual(bytes);
});
it.each(["session", "context"] as const)(
  "review: empty snapshots reject mismatched current %s store/workspace identity",
  async (kind) => {
    const f = historyFixture();
    await f.writer.flush();
    const { p, environment } = projection(f);
    if (kind === "session") {
      const session = environment.session();
      environment.session = () => ({ ...session, storeId: randomUUID() });
    } else
      environment.context = (taskId) => ({
        status: "unavailable",
        workspaceId: randomUUID(),
        taskId,
        error: publicError("unavailable"),
      });
    await expect(
      p.snapshot({ kind: "task", id: f.link.taskId }),
    ).rejects.toThrow();
  },
);
