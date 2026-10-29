import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { expect, it } from "vitest";
import { ServiceClient } from "../src/service-client.ts";
import {
  canonicalJson,
  decodeCaptureFrame,
  decodeDetailReadResult,
  decodeEntityReadResult,
  decodeExportFrame,
  decodeGraph,
  decodeGraphPage,
  decodeGraphReadResult,
  decodeHistoryReadResult,
  decodeSearchPage,
  type ExportFrame,
  type ExportRequest,
  type Graph,
  type GraphReadRequest,
  LIMITS,
  type RunIdentity,
} from "../src/service-contract.ts";
import { HttpServiceTransport } from "../src/service-http-client.ts";
import { historyFixture } from "./helpers/history-fixture.ts";
import {
  readProjection,
  retainedText,
  storedTree,
} from "./helpers/history-read-fixture.ts";
import { httpFixture } from "./helpers/service-http-fixture.ts";

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const sha = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const PLAN = 'Retain all sixteen assignments, including escaped \\" text.\n';

async function maximumGraph() {
  const f = historyFixture(),
    { content } = await retainedText(f, PLAN);
  const graph: Graph = {
    schema: "cadence-graph/2",
    taskId: f.link.taskId,
    taskKind: "research",
    taskRevision: 1,
    revision: 1,
    planRevision: 1,
    plan: content,
    assignments: Array.from({ length: 16 }, (_, i) => ({
      id: `a${i}`,
      purpose: "research",
      instructions: "\\".repeat(15000),
      expectedOutput: "x".repeat(2000),
      role: { role: "design-explorer", sha256: "a".repeat(64) },
      model: f.context.model,
      dependencies: [],
    })),
  };
  // Escaping, not overlong instructions, reaches the actual encoded-body cap.
  for (const a of graph.assignments) {
    a.instructions += "\\".repeat(
      Math.min(
        16384 - a.instructions.length,
        Math.floor((524288 - bytes(graph)) / 2),
      ),
    );
  }
  graph.assignments[0].expectedOutput += "x".repeat(524288 - bytes(graph));
  expect(decodeGraph(graph)).toEqual(graph);
  expect(bytes(graph)).toBe(524288);
  for (const a of graph.assignments) {
    expect(Buffer.byteLength(a.instructions)).toBeLessThanOrEqual(16384);
    expect(Buffer.byteLength(a.expectedOutput)).toBeLessThanOrEqual(2048);
  }
  const original = canonicalJson(graph),
    hash = sha(original);
  f.context.task = {
    ...f.context.task!,
    graphRevision: 1,
    graphIdentity: hash,
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
    graph: { recordId: randomUUID(), revision: 1, sha256: hash },
    assignments: graph.assignments.map((a) => ({
      assignmentId: a.id,
      childRunId: randomUUID(),
    })),
  };
  expect((await f.writer.admitRun(f.link.runId, identity, graph)).status).toBe(
    "committed",
  );
  const input: GraphReadRequest = {
    storeId: f.files.format.storeId,
    scope: { kind: "task", id: f.link.taskId },
    snapshotSeq: f.writer.committedSeq,
    graph: identity.graph!,
  };
  return { f, graph, original, hash, identity, input };
}

it("escaped detail paging retains the unchanged 512KiB FULL Reply bound", async () => {
  const f = historyFixture(),
    text = "\\".repeat(262144);
  const { content } = await retainedText(f, text);
  const projection = readProjection(f);
  const { session: _session, ...reads } = projection;
  const http = await httpFixture(undefined, reads);
  const client = new ServiceClient(
    new HttpServiceTransport({
      origin: http.origin,
      localCapability: http.local,
    }),
  );
  let cursor = {
    storeId: f.files.format.storeId,
    scope: { kind: "task" as const, id: f.link.taskId },
    query: null,
    snapshotSeq: f.writer.committedSeq,
    recordId: content.recordId,
    recordVersion: content.version,
    field: content.field,
    offset: 0,
  };
  let retained = "",
    done = false;
  const before = storedTree(f.files.directory);
  try {
    for (let n = 0; n < 30; n++) {
      const page = await client.detail(cursor);
      expect(page.kind).toBe("ok");
      if (page.kind !== "ok") throw Error("Detail refused");
      expect(bytes(page)).toBeLessThanOrEqual(524288);
      if (n === 0) expect(bytes(page)).toBe(524288);
      if (!("kind" in page.value)) retained += page.value.text;
      if (!page.value.next) {
        done = true;
        break;
      }
      cursor = page.value.next as typeof cursor;
    }
    expect(done).toBe(true);
    expect(retained).toBe(text);
    expect(sha(retained)).toBe(content.sha256);
    expect(storedTree(f.files.directory)).toEqual(before);
  } finally {
    await http.server.close();
    f.lease.release();
  }
}, 20000);

it("unchanged encoded category limits reject oversize before shape decoding (no larger page or worker allowance)", () => {
  expect([
    LIMITS.graphBytes,
    LIMITS.controlBytes,
    LIMITS.pageBytes,
    LIMITS.detailPageBytes,
    LIMITS.frameBytes,
  ]).toEqual([524288, 1048576, 524288, 262144, 65536]);
  const over = (maximum: number, fields: object = {}) => {
    const value = { ...fields, padding: "" };
    value.padding = "x".repeat(maximum + 1 - bytes(value));
    expect(bytes(value)).toBe(maximum + 1);
    return value;
  };
  // Size-first negative vectors, deliberately not claimed to be valid DTOs.
  for (const decode of [decodeGraphPage, decodeExportFrame])
    expect(() => decode(over(1048576))).toThrow(
      expect.objectContaining({ code: "oversize" }),
    );
  for (const decode of [
    decodeDetailReadResult,
    decodeEntityReadResult,
    decodeHistoryReadResult,
    decodeSearchPage,
  ])
    expect(() => decode(over(524288))).toThrow(
      expect.objectContaining({ code: "oversize" }),
    );
  for (const decode of [
    decodeGraphReadResult,
    decodeDetailReadResult,
    decodeEntityReadResult,
    decodeHistoryReadResult,
  ])
    expect(() => decode(over(524288, { kind: "progress" }))).toThrow(
      expect.objectContaining({ code: "oversize" }),
    );
  expect(() => decodeCaptureFrame(over(65536))).toThrow(
    expect.objectContaining({ code: "oversize" }),
  );
});

it("real HTTP client bounds the full graph Reply including wire whitespace at 1MiB, not only its valid graph body", async () => {
  const { f, graph, input } = await maximumGraph();
  const body = JSON.stringify({ kind: "ok", value: { request: input, graph } });
  const frame: ExportFrame = {
    exportId: randomUUID(),
    ordinal: 1,
    event: { kind: "graph", graph: { request: input, graph } },
  };
  let size = 1048576;
  // Raw-wire fault fixture: not the production W1 JSON encoder. Both responses
  // parse to the exact SAME legal maximum graph; only encoded envelope differs.
  const server = createServer((req, res) => {
    const exporting = req.url?.includes("/export");
    const value = exporting ? JSON.stringify(frame) : body;
    res.setHeader(
      "content-type",
      exporting ? "application/x-ndjson" : "application/json",
    );
    res.end(
      value +
        " ".repeat(size - Buffer.byteLength(value)) +
        (exporting ? "\n" : ""),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No native address");
  const transport = new HttpServiceTransport({
    origin: `http://127.0.0.1:${address.port}`,
  });
  try {
    expect(await transport.graph(input)).toEqual({
      kind: "ok",
      value: { request: input, graph },
    });
    size++;
    await expect(transport.graph(input)).rejects.toThrow(
      expect.objectContaining({ code: "oversize" }),
    );
    expect((await new ServiceClient(transport).graph(input)).kind).toBe(
      "error",
    );
    const selected: ExportRequest = {
      storeId: input.storeId,
      scope: input.scope,
      snapshotSeq: input.snapshotSeq,
      format: "ndjson",
    };
    const readFrame = async () => {
      const frames = [];
      for await (const item of transport.export(
        selected,
        new AbortController().signal,
      ))
        frames.push(item);
      return frames;
    };
    // Individual wire-frame bound only, NOT a complete export fixture. Complete
    // manifest/count/digest/trailer/EOF is tested above through the real owner.
    size = 1048576;
    expect(await readFrame()).toEqual([frame]);
    size++;
    await expect(readFrame()).rejects.toThrow(
      expect.objectContaining({ code: "oversize" }),
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    f.lease.release();
  }
}, 20000);
