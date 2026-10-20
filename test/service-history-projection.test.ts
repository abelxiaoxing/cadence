import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
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
import { WebSocket } from "ws";
import { HistoryReadBudget } from "../src/history/files.ts";
import { HistoryLive } from "../src/history/live.ts";
import { HistoryNavigation } from "../src/history/navigation.ts";
import {
  HistoryProjection,
  type ReadEnvironment,
} from "../src/history/projection.ts";
import { HistoryReader } from "../src/history/reader.ts";
import { COMPLETE, type JournalRow } from "../src/history/types.ts";
import { AccessMaterial, HttpAuthentication } from "../src/service/auth.ts";
import { ServiceHttpServer } from "../src/service/http.ts";
import type { ProjectionPort } from "../src/service/ports.ts";
import {
  ContractError,
  canonicalJson,
  LIMITS,
  type ListRequest,
  type LiveEvent,
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
import { metadataCost } from "./helpers/history-metadata-cost.ts";
import { request } from "./helpers/service-http-fixture.ts";

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
async function waitFor(fn: () => boolean, attempts = 50) {
  for (let n = 0; n < attempts && !fn(); n++)
    await new Promise((r) => setTimeout(r, 20));
  expect(fn()).toBe(true);
}
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
it("multisegment no-viewer metadata archive advances zero-result pages, restart cursors and bounded native IO", async () => {
  const cost = metadataCost();
  try {
    const f = historyFixture(),
      nav = new HistoryNavigation(f.files);
    let state = f.files.inspect();
    const created = new Map<string, string>();
    // Structural disk fixture: real append/sync/close and derived navigation, not
    // additional SDK launches. 8,200 rows cross original 4096-record segment caps.
    cost.phase("append-index-82x100");
    for (let batch = 0; batch < 82; batch++) {
      const rows: JournalRow[] = Array.from({ length: 100 }, (_, i) => ({
        kind: "record",
        seq: String(BigInt(state.committedSeq) + BigInt(i) + 1n),
        id: randomUUID(),
        value:
          batch * 100 + i >= 4000 && batch * 100 + i < 5200
            ? {
                kind: "capture",
                link: f.link,
                source: {
                  first: batch * 100 + i + 1,
                  last: batch * 100 + i + 1,
                  firstObservedMs: 0,
                  lastObservedMs: 0,
                },
                events: [
                  {
                    kind: "capture",
                    id: randomUUID(),
                    value: {
                      source: {
                        first: batch * 100 + i + 1,
                        last: batch * 100 + i + 1,
                        firstObservedMs: 0,
                        lastObservedMs: 0,
                      },
                      event: {
                        kind: "message-start",
                        messageId: randomUUID(),
                        role: "assistant",
                        source: { disposition: "unavailable", value: null },
                        resultCallId: null,
                      },
                    },
                  },
                ],
              }
            : { kind: "owner-epoch", epoch: f.link.epoch },
      }));
      if (batch < 40 || batch >= 52) {
        const i = created.size,
          row = rows[0];
        const taskId = randomUUID(),
          commandId = randomUUID(),
          operationId = randomUUID(),
          goal = `retained task ${i}`;
        created.set(taskId, goal);
        const identity = {
          kind: "action" as const,
          expected: { ...f.context, task: null, controlRev: i + 1 },
          action: {
            kind: "create" as const,
            taskKind: "research" as const,
            goal,
          },
        };
        // Accepted-create-shaped history only: this is not W1 admission/v1 publication evidence.
        row.value = {
          kind: "admission",
          intent: {
            commandId,
            operationId,
            runId: null,
            createdTaskId: taskId,
            identity,
          },
          record: {
            identity,
            receipt: {
              commandId,
              operationId,
              runId: null,
              admission: "accepted",
              committedSeq: String(BigInt(state.committedSeq) + 100n),
              execution: null,
              settlement: null,
              created: { kind: "task", taskId, state: "reserved" },
              publication: "pending",
            },
          },
        };
      }
      const old = state;
      const prepared = nav.prepare(f.lease, state, rows, [], () => {});
      state = await f.files.append(
        f.lease,
        state,
        rows,
        undefined,
        prepared?.root,
      );
      const offset = state.segment === old.segment ? old.bytes : 0;
      nav.publish(
        f.lease,
        {
          segment: state.segment,
          offset,
          bytes: state.bytes - offset,
          seq: state.committedSeq,
        },
        rows,
        () => {},
        prepared,
      );
    }
    expect(state.segment).toBeGreaterThan(2);
    const lostCommit = join(
      f.files.directory,
      "indexes",
      "commits",
      `${state.committedSeq}.json`,
    );
    renameSync(lostCommit, `${lostCommit}.preserved`);
    let p = projection(f).p,
      req: ListRequest = {
        ...list(f, "events"),
        snapshotSeq: state.committedSeq,
      },
      pages = 0,
      total = 0,
      zero = 0;
    cost.phase("before-tree");
    const before = files(f.files.directory);
    cost.tree(before, f.files.directory);
    cost.phase("events-restart-zero-result");
    // Deterministic early-window exhaustion after one genuinely read/validated
    // nonmatching batch. The old assertion depended on 4,000 tiny epoch rows
    // being slow enough to consume 100ms; a faster decoder legitimately removed
    // that timing prerequisite. This is scheduling injection, not native latency.
    const originalNext = HistoryNavigation.prototype.next;
    let pause:
      | { segment: number; offset: number; budget: HistoryReadBudget }
      | undefined;
    const schedule = vi
      .spyOn(HistoryNavigation.prototype, "next")
      .mockImplementation(function (this: HistoryNavigation, pos, budget) {
        if (
          pause?.budget === budget &&
          pos.segment === pause.segment &&
          pos.offset === pause.offset
        )
          throw new ContractError("receipt-inconclusive");
        const batch = originalNext.call(this, pos, budget);
        if (!pause && pos.segment === 1 && pos.offset === 0 && batch)
          pause = { ...batch.next, budget };
        return batch;
      });
    do {
      nativeReads.calls = nativeReads.requested = 0;
      const page = await p.events(req).finally(() => schedule.mockRestore());
      pages++;
      const bytes = nativeReads.requested;
      expect(bytes).toBeLessThanOrEqual(LIMITS.searchBytes);
      if ("kind" in page) {
        zero++;
        req = page.next;
        continue;
      }
      total += page.records.length;
      if (!page.records.length) zero++;
      if (!page.next) break;
      expect(page.next.after).not.toEqual(req.after);
      if (pages === 1) {
        const again = await historyData(
          projection(f).p.events.bind(projection(f).p),
          page.next,
        );
        expect(again.request).toEqual(page.next);
        await expect(
          p.contents({ ...page.next, reader: "contents" }),
        ).rejects.toThrow();
      }
      req = page.next;
      p = projection(f).p;
      expect(pages).toBeLessThan(100);
    } while (pages < 100);
    expect(pages).toBeGreaterThan(1);
    expect(zero).toBeGreaterThan(0);
    expect(total).toBe(1200);
    cost.phase("messages-1200");
    let count = 0;
    req = { ...list(f, "messages"), snapshotSeq: state.committedSeq };
    for (let n = 0; n < 150; n++) {
      const page = await historyData(p.messages.bind(p), req);
      count += page.records.length;
      if (!page.next) break;
      req = page.next;
    }
    expect(count).toBe(1200);
    cost.phase("tasks-70");
    const seen = new Map<string, string>();
    req = { ...list(f, "tasks"), snapshotSeq: state.committedSeq, limit: 20 };
    for (let n = 0; n < 150; n++) {
      const page = await historyData(p.tasks.bind(p), req);
      for (const record of page.records) {
        if (record.kind !== "task") throw Error("task");
        seen.set(record.owner.taskId, record.goal);
      }
      if (!page.next) break;
      req = page.next;
      p = projection(f).p;
    }
    expect(seen).toEqual(created);
    cost.phase("after-tree");
    const after = files(f.files.directory);
    cost.tree(after, f.files.directory);
    expect(after).toEqual(before);
  } finally {
    cost.close();
  }
}, 45000);
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
it("committed live snapshots retain all sibling rows and isolate throwing/slow viewers", async () => {
  const f = await active(),
    { p } = projection(f),
    live = new HistoryLive(f.writer, p),
    events: LiveEvent[] = [];
  const scope = { kind: "run" as const, id: f.link.runId };
  live.subscribe(scope, (e) => events.push(e));
  live.subscribe(scope, () => {
    throw Error("observer failure");
  });
  await p.snapshot(scope);
  await prepareFixtureChild(f);
  expect(
    (await f.writer.processes.launchIntent(f.link, f.intent.operationId))
      .status,
  ).toBe("committed");
  await waitFor(() =>
    events.some(
      (e) =>
        e.kind === "update" && e.runs.some((r) => r.lifecycle === "running"),
    ),
  );
  expect(
    events.filter((e) => e.kind === "update").every((e) => e.runs.length === 2),
  ).toBe(true);
  const prior = events.at(-1)!.committedSeq;
  expect(
    (
      await f.writer.processes.settlement(
        f.link,
        failedCompletion(f.link.childRunId),
      )
    ).status,
  ).toBe("committed");
  await waitFor(() =>
    events.some(
      (e) => e.kind === "update" && e.runs.some((r) => r.outcome === "failed"),
    ),
  );
  expect(live.watermark(scope).committedSeq).toBe(f.writer.committedSeq);
  expect(live.replay(f.link.runId, prior)).not.toBeNull();
  expect(f.writer.quarantined).toBe(false);
  live.close();
});
it("actual W1 HTTP/WS reads this writer/projection without creating actions or providers", async () => {
  const f = await active(),
    { p } = projection(f),
    live = new HistoryLive(f.writer, p);
  const dir = join(f.files.directory, "http-fixture");
  f.files.files.directory(dir, true);
  AccessMaterial.initialize(f.files.files, dir, {});
  const material = new AccessMaterial(f.files.files, dir, {}),
    local = randomBytes(32).toString("base64url"),
    auth = new HttpAuthentication(
      material,
      f.link.epoch,
      f.files.format.workspaceId,
      local,
    );
  const unavailable = async (): Promise<never> => {
    throw new ContractError("unavailable");
  };
  let release!: () => void,
    entered = false,
    firstSnapshot = true,
    drop = false;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  // Precise absent future surfaces refuse; no fake empty search/export implementation.
  const port: ProjectionPort = {
    ...p,
    snapshot: async (scope) => {
      const snapshot = await p.snapshot(scope);
      if (firstSnapshot) {
        firstSnapshot = false;
        entered = true;
        await gate;
      }
      return snapshot;
    },
    graph: p.graph,
    detail: p.detail,
    search: unavailable,
    export: () => ({ [Symbol.asyncIterator]: () => ({ next: unavailable }) }),
  };
  const server = new ServiceHttpServer({
    policy: {
      schema: "cadence-service-http/1",
      host: "127.0.0.1",
      port: 0,
      proxy: null,
    },
    auth,
    adapters: {
      projection: port,
      live: {
        watermark: live.watermark,
        subscribe: (scope, callback) =>
          live.subscribe(scope, (event) => {
            if (drop) {
              drop = false;
              return;
            }
            callback(event);
          }),
      },
      admission: null,
      receipts: null,
    },
  });
  let ws: WebSocket | undefined;
  try {
    const origin = await server.listen();
    server.admit();
    const token = new URL(material.tokenLink(origin)).searchParams.get(
        "token",
      )!,
      cookie = `${auth.cookieName}=${encodeURIComponent(token)}`;
    const response = await request(origin, "/api/v1/session", {
      headers: { cookie },
    });
    expect(response.status).toBe(200);
    const before = f.writer.committedSeq;
    const messages: unknown[] = [];
    ws = new WebSocket(
      `${origin.replace("http:", "ws:")}/api/v1/events?attachment=${response.headers["x-cadence-attachment"]}`,
      { headers: { cookie, origin } },
    );
    ws.on("message", (b) => messages.push(JSON.parse(String(b))));
    await once(ws, "open");
    ws.send(
      JSON.stringify({
        kind: "subscribe",
        scope: { kind: "run", id: f.link.runId },
      }),
    );
    await waitFor(() => entered);
    expect(f.writer.committedSeq).toBe(before);
    await ownerFact(f, {
      kind: "gate",
      lane: "reader",
      state: "waiting",
      checkoutGeneration: 0,
    });
    // A real commit races the original in-flight snapshot. W1 buffers the update.
    await new Promise((r) => setTimeout(r, 50));
    release();
    await waitFor(() =>
      messages.some(
        (m) =>
          typeof m === "object" &&
          m !== null &&
          "kind" in m &&
          m.kind === "snapshot",
      ),
    );
    await waitFor(() =>
      messages.some(
        (m) =>
          typeof m === "object" &&
          m !== null &&
          "kind" in m &&
          m.kind === "event",
      ),
    );
    expect(f.writer.pendingWrites).toBe(0);
    await ownerFact(f, {
      kind: "gate",
      lane: "reader",
      state: "held",
      checkoutGeneration: 0,
    });
    await ownerFact(f, {
      kind: "gate",
      lane: "reader",
      state: "released",
      checkoutGeneration: 0,
    });
    await new Promise((r) => setTimeout(r, 100));
    drop = true;
    expect((await settleFixtureRun(f, "blocked")).status).toBe("committed");
    // Deliberately lose the final notification. The actual 5-second W1 heartbeat
    // detects its committed watermark and obtains a new retained snapshot.
    await waitFor(
      () =>
        messages.some(
          (m) =>
            typeof m === "object" &&
            m !== null &&
            "kind" in m &&
            m.kind === "resync",
        ),
      350,
    );
    await waitFor(
      () =>
        messages.filter(
          (m) =>
            typeof m === "object" &&
            m !== null &&
            "kind" in m &&
            m.kind === "snapshot",
        ).length >= 2,
    );
  } finally {
    release();
    ws?.terminate();
    live.close();
    await server.close();
  }
}, 10000);
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
it("review: dense single-row message pages advance at source events without rebuilding skipped entities", async () => {
  const f = await active();
  await prepareFixtureChild(f);
  await f.writer.processes.launchIntent(f.link, f.intent.operationId);
  const ids = Array.from({ length: 300 }, () => randomUUID());
  await capture(f, [
    { kind: "ready", requestProtocol: 2 },
    ...ids.map((messageId) => ({
      kind: "message-start" as const,
      messageId,
      role: "assistant" as const,
      source: { disposition: "unavailable" as const, value: null },
      resultCallId: null,
    })),
  ]);
  let query = { ...list(f, "messages"), limit: 20 },
    count = 0;
  const seen: string[] = [];
  for (let i = 0; i < 50; i++) {
    const page = await historyData(
      projection(f).p.messages.bind(projection(f).p),
      query,
    );
    for (const r of page.records) {
      if (r.kind !== "message") throw Error("message");
      seen.push(r.owner.entity.id);
    }
    count++;
    if (!page.next) break;
    query = page.next;
  }
  expect(count).toBeLessThan(50);
  expect(seen).toEqual(ids);
}, 15000);
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
