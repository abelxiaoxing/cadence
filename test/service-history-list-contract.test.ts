import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { HistoryReadBudget } from "../src/history/files.ts";
import {
  entityPreparation,
  listPreparation,
} from "../src/history/list-progress.ts";
import { HistoryReadProof } from "../src/history/read-proof.ts";
import { COMPLETE } from "../src/history/types.ts";
import { ServiceClient } from "../src/service-client.ts";
import {
  decodeEntityReadRequest,
  decodeEntityReadResult,
  decodeHistoryReadResult,
  type EntityReadRequest,
  type ListRequest,
} from "../src/service-contract.ts";
import { HttpServiceTransport } from "../src/service-http-client.ts";
import { wireRequest } from "../src/service-wire.ts";
import { historyFixture } from "./helpers/history-fixture.ts";
import { readProjection, storedTree } from "./helpers/history-read-fixture.ts";
import {
  httpFixture,
  request as httpRequest,
} from "./helpers/service-http-fixture.ts";

async function fixture() {
  const f = historyFixture(),
    taskId = randomUUID();
  const identity = {
    kind: "action" as const,
    expected: { ...f.context, task: null },
    action: {
      kind: "create" as const,
      taskKind: "research" as const,
      goal: "retained task",
    },
  };
  f.writer.supplyContext(identity.expected);
  const committed = await f.writer.commit({
    ...f.intent,
    runId: null,
    createdTaskId: taskId,
    identity,
  });
  if (committed.status !== "committed") throw Error("fixture create");
  const projection = readProjection(f);
  const list: ListRequest = {
    reader: "tasks",
    storeId: f.files.format.storeId,
    scope: { kind: "workspace", id: f.files.format.workspaceId },
    snapshotSeq: f.writer.committedSeq,
    after: null,
    limit: 2,
  };
  const entity: EntityReadRequest = {
    storeId: list.storeId,
    scope: { kind: "task", id: taskId },
    snapshotSeq: f.writer.committedSeq,
    kind: "task",
    id: taskId,
    version: 1,
  };
  return { f, projection, list, entity };
}
it("snapshot transition and entity progress are closed and selector-correlated", () => {
  const request: ListRequest = {
      reader: "tasks",
      storeId: randomUUID(),
      scope: { kind: "workspace", id: randomUUID() },
      snapshotSeq: null,
      after: null,
      limit: 1,
    },
    next = { ...request, snapshotSeq: "27", navigation: "structural-only" };
  const transition = decodeHistoryReadResult({
    kind: "snapshot",
    request,
    next,
    coverage: COMPLETE,
  });
  expect("kind" in transition && transition.kind).toBe("snapshot");
  for (const n of [
    { ...next, limit: 2 },
    { ...next, scope: { ...next.scope, id: randomUUID() } },
    { ...next, snapshotSeq: null },
  ])
    expect(() =>
      decodeHistoryReadResult({
        kind: "snapshot",
        request,
        next: n,
        coverage: COMPLETE,
      }),
    ).toThrow();
  expect(() =>
    decodeHistoryReadResult({
      kind: "snapshot",
      request: { ...request, snapshotSeq: "1" },
      next,
      coverage: COMPLETE,
    }),
  ).toThrow();
  const entity: EntityReadRequest = {
      storeId: request.storeId,
      scope: { kind: "task", id: randomUUID() },
      snapshotSeq: "1",
      kind: "message",
      id: randomUUID(),
      version: 2,
    },
    continuation = { ...entity, navigation: "structural-only" };
  expect(wireRequest("entity", continuation).method).toBe("POST");
  expect(wireRequest("entity", entity).method).toBe("GET");
  for (const n of [
    { ...continuation, version: 3 },
    { ...continuation, kind: "tool" },
    { ...continuation, snapshotSeq: "2" },
  ])
    expect(() =>
      decodeEntityReadResult({
        kind: "progress",
        request: entity,
        next: n,
        coverage: COMPLETE,
      }),
    ).toThrow();
  expect(() =>
    decodeEntityReadRequest({ ...continuation, navigation: "x".repeat(8193) }),
  ).toThrow();
});
it("genuine list and entity progress cross W1 readonly POST and ServiceClient without effects", async () => {
  const { f, projection, list, entity } = await fixture(),
    before = storedTree(f.files.directory);
  const listStep = listPreparation(
    { ...list, snapshotSeq: null },
    new HistoryReadProof(f.files).prepareCompletion(new HistoryReadBudget()),
  );
  const entityStep = entityPreparation(
    entity,
    new HistoryReadProof(f.files).prepareCompletion(new HistoryReadBudget()),
  );
  if (!("kind" in listStep) || !("kind" in entityStep))
    throw Error("progress expected");
  const http = await httpFixture(undefined, {
    tasks: projection.tasks,
    entity: projection.entity,
  });
  const session = http.projection.session;
  http.projection.session = async () => ({
    ...(await session()),
    storeId: f.files.format.storeId,
  });
  const methods: string[] = [];
  const client = new ServiceClient(
    new HttpServiceTransport({
      origin: http.origin,
      localCapability: http.local,
      fetch: (url, init) => {
        methods.push(init?.method ?? "GET");
        return fetch(url, init);
      },
    }),
  );
  try {
    expect((await client.session()).kind).toBe("ok");
    let request = listStep.next,
      transition = false,
      complete = false;
    for (let n = 0; n < 100; n++) {
      const reply = await client.tasks(request);
      expect(reply.kind).toBe("ok");
      expect(methods.at(-1)).toBe("POST");
      if (reply.kind !== "ok") throw Error("list refused");
      expect(reply.value.request).toEqual(request);
      if ("kind" in reply.value) {
        transition ||= reply.value.kind === "snapshot";
        request = reply.value.next;
        continue;
      }
      expect(reply.value.records).toMatchObject([
        { kind: "task", goal: "retained task" },
      ]);
      complete = true;
      break;
    }
    expect(transition && complete).toBe(true);
    let point = entityStep.next,
      found = false;
    for (let n = 0; n < 100; n++) {
      const reply = await client.task(point);
      expect(reply.kind).toBe("ok");
      expect(methods.at(-1)).toBe("POST");
      if (reply.kind !== "ok") throw Error("entity refused");
      if ("kind" in reply.value) {
        point = reply.value.next;
        continue;
      }
      expect(reply.value.record).toMatchObject({
        kind: "task",
        goal: "retained task",
        version: 1,
      });
      found = true;
      break;
    }
    expect(found).toBe(true);
    for (const [path, body] of [
      ["/api/v1/tasks", request],
      ["/api/v1/entity", point],
    ] as const)
      expect(
        (
          await httpRequest(http.origin, path, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          })
        ).status,
      ).toBe(401);
  } finally {
    await http.server.close();
  }
  expect(storedTree(f.files.directory)).toEqual(before);
});
it("wrong-kind/scope/limit/version/snapshot and tampered proofs never reset; key and source changes refuse", async () => {
  const { f, projection, list, entity } = await fixture();
  const a = listPreparation(
      list,
      new HistoryReadProof(f.files).prepareCompletion(new HistoryReadBudget()),
    ),
    b = entityPreparation(
      entity,
      new HistoryReadProof(f.files).prepareCompletion(new HistoryReadBudget()),
    );
  if (!("kind" in a) || !("kind" in b)) throw Error("progress expected");
  const before = storedTree(f.files.directory);
  for (const changed of [
    { ...a.next, limit: 1 },
    { ...a.next, scope: { ...a.next.scope, id: randomUUID() } },
    { ...a.next, snapshotSeq: "0" },
    { ...a.next, navigation: `${a.next.navigation}A` },
  ])
    await expect(projection.tasks(changed)).rejects.toMatchObject({
      code: "corrupt-selected",
    });
  for (const changed of [
    { ...b.next, kind: "tool" as const },
    { ...b.next, version: 2 },
    { ...b.next, snapshotSeq: "0" },
    { ...b.next, navigation: a.next.navigation },
  ])
    await expect(projection.entity(changed)).rejects.toMatchObject({
      code: "corrupt-selected",
    });
  expect(storedTree(f.files.directory)).toEqual(before);
  const path = f.files.segmentPath(1),
    bytes = readFileSync(path);
  bytes[1] ^= 1;
  writeFileSync(path, bytes);
  await expect(projection.entity(b.next)).rejects.toMatchObject({
    code: "corrupt-selected",
  });
  const keyPath = join(f.files.directory, "read-proof-key.json"),
    key = JSON.parse(readFileSync(keyPath, "utf8"));
  key.key = randomBytes(32).toString("base64url");
  writeFileSync(keyPath, JSON.stringify(key));
  await expect(projection.tasks(a.next)).rejects.toMatchObject({
    code: "corrupt-selected",
  });
});

it("finite check lists retain native facts while current obligations stay stale/not-run", async () => {
  const { ownerFact } = await import("./helpers/history-fixture.ts");
  const f = historyFixture(),
    check = {
      kind: "configured" as const,
      name: "unit",
      command: "true",
      timeoutMs: 1000,
    };
  if (!f.context.task) throw Error("task absent");
  f.context.task.kind = "code";
  f.writer.supplyContext(f.context);
  f.intent.identity = {
    kind: "action",
    expected: f.context,
    action: { kind: "check", taskId: f.link.taskId, check },
  };
  expect((await f.writer.commit(f.intent)).status).toBe("committed");
  expect(
    (
      await f.writer.admitRun(f.link.runId, {
        operationId: f.intent.operationId,
        commandId: f.intent.commandId,
        kind: "check",
        context: f.context,
        graph: null,
        assignments: [],
      })
    ).status,
  ).toBe("committed");
  const checkId = randomUUID(),
    observation = { ...f.context.observation, checkoutGeneration: 0 };
  expect(
    (
      await ownerFact(f, {
        kind: "check-start",
        checkId,
        selection: check,
        cwdId: f.context.cwdId,
        cwdLabel: "fixture",
        checkEnvGeneration: 1,
        before: observation,
      })
    ).status,
  ).toBe("committed");
  expect(
    (
      await ownerFact(f, {
        kind: "check-settled",
        checkId,
        before: observation,
        after: observation,
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
  const p = readProjection(f);
  p.environment.checks = () => ({
    revision: 7,
    selections: [check, { ...check, name: "unrun", command: "false" }],
  });
  const before = storedTree(f.files.directory),
    expected = await p.checkObligations(f.link.taskId);
  expect(expected.definitions.map((d) => d.status)).toEqual([
    "stale",
    "not-run",
  ]);
  const request: ListRequest = {
    reader: "checks",
    storeId: f.files.format.storeId,
    scope: { kind: "task", id: f.link.taskId },
    snapshotSeq: f.writer.committedSeq,
    after: null,
    limit: 1,
  };
  const seed = listPreparation(
    request,
    new HistoryReadProof(f.files).prepareCompletion(new HistoryReadBudget()),
  );
  if (!("kind" in seed)) throw Error("proof expected");
  let next: ListRequest | null = seed.next;
  const records: import("../src/service-contract.ts").HistoryRecord[] = [];
  while (next) {
    const result = await p.checks(next);
    if (!("kind" in result)) records.push(...result.records);
    next = result.next;
  }
  expect(records).toMatchObject([
    { kind: "owner-fact", fact: { kind: "check-start", checkId } },
    {
      kind: "owner-fact",
      fact: {
        kind: "check-settled",
        checkId,
        status: "passed",
        native: { exitCode: 0, closure: "direct-child-closed" },
      },
    },
  ]);
  expect(await p.checkObligations(f.link.taskId)).toEqual(expected);
  expect(storedTree(f.files.directory)).toEqual(before);
});
