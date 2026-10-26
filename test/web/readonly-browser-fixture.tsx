// Decoded injected readonly records: DOM/read-transport evidence, NOT durable owner execution.
import { createHash, randomUUID } from "node:crypto";
import {
  decodeHistoryRecord,
  type HistoryRecord,
  type ListRequest,
  type ReadCursor,
} from "../../src/service-contract.ts";
import type { Fixture } from "../helpers/service-http-fixture.ts";
import { context, coverage, hash } from "./fixtures";
export function readonlyWorkspace(f: Fixture) {
  const taskId = randomUUID(),
    runId = randomUUID(),
    childRunId = randomUUID(),
    messageId = randomUUID();
  const text =
    "# Retained heading\n\n$x^2$\n\n![omitted](https://evil.invalid/image)\n\n<script>window.untrusted=true</script>\n\n[bad](javascript:alert(1))\n\n```js\nconst text = '<hostile>';\n```\n\n" +
    "Long retained text. ".repeat(16000) +
    "é🚀END";
  const bytes = Buffer.from(text),
    hitStart = bytes.indexOf(Buffer.from("🚀"));
  const content = {
    recordId: randomUUID(),
    version: 1,
    field: "final-text" as const,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  const owner = {
    taskId,
    runId,
    childRunId,
    entity: { kind: "message" as const, id: messageId, version: 1 },
  };
  const task = decodeHistoryRecord({
    kind: "task",
    owner: {
      taskId,
      runId: null,
      childRunId: null,
      entity: { kind: "task", id: taskId, version: 1 },
    },
    version: 1,
    goal: "Readonly Unicode fixture é🚀",
    plan: null,
  });
  const message = decodeHistoryRecord({
    kind: "message",
    owner,
    version: 1,
    role: "assistant",
    source: { disposition: "unavailable", value: null },
    resultCallId: null,
    state: "final",
    finalBlockCount: 1,
    finalText: content,
  });
  if (task.kind !== "task" || message.kind !== "message")
    throw new Error("fixture-kind");
  const admitted = context();
  if (!admitted.task) throw new Error("fixture-task");
  admitted.task.id = taskId;
  admitted.workspaceId = f.workspaceId;
  admitted.epoch = f.epoch;
  const parent = decodeHistoryRecord({
    kind: "run",
    projection: {
      runId,
      taskId,
      childRunId: null,
      assignmentId: null,
      admission: {
        operationId: randomUUID(),
        commandId: randomUUID(),
        kind: "start",
        context: admitted,
        assignments: [{ assignmentId: "inspect-history", childRunId }],
        graph: { recordId: randomUUID(), revision: 1, sha256: hash },
      },
      lifecycle: "settled",
      outcome: "unknown",
      settlement: null,
      reason: null,
      publication: "uncertain",
      coverage,
      result: null,
    },
  });
  if (parent.kind !== "run") throw new Error("fixture-parent");
  const child = decodeHistoryRecord({
    kind: "run",
    projection: {
      ...parent.projection,
      childRunId,
      assignmentId: "inspect-history",
    },
  });
  const events = [1, 2, 3].map((n) =>
    decodeHistoryRecord({
      kind: "capture-fact",
      recordId: randomUUID(),
      committedSeq: String(n),
      link: { epoch: f.epoch, taskId, runId, childRunId },
      capture: {
        source: {
          first: n,
          last: n,
          firstObservedMs: n * 100,
          lastObservedMs: n * 100,
        },
        event: { kind: "ready", requestProtocol: 2 },
      },
    }),
  );
  const page = (request: ListRequest, records: HistoryRecord[]) => ({
    request: { ...request, snapshotSeq: request.snapshotSeq ?? "10" },
    records,
    next: null,
    coverage,
  });
  const limited = {
    ...coverage,
    source: "limited" as const,
    redacted: true,
    omissions: ["source-limit" as const],
  };
  let detailCalls = 0;
  f.setSeq("10");
  f.projection.snapshot = async (scope) => ({
    ...f.snap(scope),
    context: {
      status: "unavailable",
      workspaceId: f.workspaceId,
      taskId: scope.kind === "task" ? scope.id : null,
      error: { code: "unavailable", effect: "none", recovery: "operator" },
    },
  });
  f.projection.workspace = async () => ({
    workspaceId: f.workspaceId,
    storeId: f.storeId,
    epoch: f.epoch,
    committedSeq: "10",
    rootLabel: "Readonly injected workspace",
    models: [],
    context: f.snap(f.scope).context,
  });
  f.projection.tasks = async (request) => page(request, [task]);
  f.projection.runs = async (request) => page(request, [parent, child]);
  f.projection.messages = async (request) => page(request, [message]);
  f.projection.events = async (request) => page(request, events);
  for (const reader of [
    "tools",
    "contents",
    "checks",
    "changes",
    "reviews",
  ] as const)
    f.projection[reader] = async (request) => page(request, []);
  f.projection.entity = async (request) => ({
    request,
    record: request.kind === "task" ? task : message,
  });
  f.projection.detail = async (cursor: ReadCursor) => {
    detailCalls++;
    if (!cursor.navigation)
      return {
        kind: "progress",
        cursor,
        next: { ...cursor, navigation: "fixture-detail-proof" },
        coverage: limited,
      };
    let end = Math.min(cursor.offset + 16384, bytes.length);
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    return {
      cursor,
      content,
      text: bytes.subarray(cursor.offset, end).toString("utf8"),
      range: { start: cursor.offset, end },
      next: end < bytes.length ? { ...cursor, offset: end } : null,
      coverage: limited,
    };
  };
  f.projection.search = async (cursor) => {
    if (!cursor.navigation)
      return {
        cursor,
        hits: [],
        next: { ...cursor, navigation: "fixture-search-proof" },
        coverage: limited,
      };
    const { navigation: _navigation, ...anchor } = cursor;
    return {
      cursor,
      hits:
        cursor.query === "🚀"
          ? [
              {
                owner,
                content,
                range: { start: hitStart, end: hitStart + 4 },
                preview: "é🚀END",
                cursor: {
                  ...anchor,
                  recordId: content.recordId,
                  recordVersion: 1,
                  field: content.field,
                  offset: hitStart,
                },
              },
            ]
          : [],
      next: null,
      coverage: limited,
    };
  };
  return {
    taskId,
    childRunId,
    runId,
    text,
    content,
    hitStart,
    detailCalls: () => detailCalls,
  };
}
