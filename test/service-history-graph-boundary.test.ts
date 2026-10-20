import { createHash, randomUUID } from "node:crypto";
import { lstatSync, writeFileSync } from "node:fs";
import { createServer, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import { HistoryReadBudget } from "../src/history/files.ts";
import { graphPreparation } from "../src/history/graph-progress.ts";
import { HistoryReadProof } from "../src/history/read-proof.ts";
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
  type GraphPage,
  type GraphReadRequest,
  LIMITS,
  type RunIdentity,
} from "../src/service-contract.ts";
import { HttpServiceTransport } from "../src/service-http-client.ts";
import { wireUrl } from "../src/service-wire.ts";
import { historyFixture } from "./helpers/history-fixture.ts";
import {
  readProjection,
  retainedText,
  storedTree,
} from "./helpers/history-read-fixture.ts";
import { httpFixture, request } from "./helpers/service-http-fixture.ts";

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

/** Independent export wire accounting: deliberately not encodeExportFrame or
 * ExportTracker. The real server/client still execute their own validators. */
function exportBytes(frame: ExportFrame, format: ExportRequest["format"]) {
  if (format === "ndjson") return `${canonicalJson(frame)}\n`;
  if (frame.event.kind === "markdown") return frame.event.text;
  return `\n\n\`\`\`json\n${canonicalJson(frame)}\n\`\`\`\n`;
}
function verifyFrames(frames: ExportFrame[], input: ExportRequest) {
  expect(frames.length).toBeGreaterThan(2);
  const head = frames[0],
    last = frames.at(-1)!;
  expect(head.event.kind).toBe("manifest");
  if (head.event.kind !== "manifest" || last.event.kind !== "trailer")
    throw Error("Missing actual manifest/trailer");
  expect(head.event.request).toEqual(input);
  expect(head.event.coverage.observed).toBe("complete");
  for (const [i, frame] of frames.entries()) {
    expect(frame.exportId).toBe(head.exportId);
    expect(frame.ordinal).toBe(i + 1);
    expect(bytes(frame)).toBeLessThanOrEqual(1048576);
    expect(bytes(frame) + 1).toBeLessThanOrEqual(1048576); // /export NDJSON framing
    expect(decodeExportFrame(frame)).toEqual(frame);
    if (i < frames.length - 1) expect(frame.event.kind).not.toBe("trailer");
  }
  const prefix = frames
    .slice(0, -1)
    .map((frame) => exportBytes(frame, input.format))
    .join("");
  expect(last.event.frames).toBe(frames.length - 1);
  expect(last.event.encodedBytes).toBe(Buffer.byteLength(prefix));
  expect(last.event.sha256).toBe(sha(prefix));
  expect(last.event.committedSeq).toBe(input.snapshotSeq);
  expect(last.event.complete).toBe(true);
  expect(last.event.coverage).toEqual(head.event.coverage);
  return prefix + exportBytes(last, input.format);
}

it("exact 512KiB escaped graph survives real commit/admission, ordinary/proof HTTP and complete client/download exports", async () => {
  const { f, graph, original, hash, identity, input } = await maximumGraph(),
    projection = readProjection(f),
    before = storedTree(f.files.directory);
  // Actual disk admission and retained plan, not a generated reference fixture.
  expect(f.files.readAdmission(f.link.runId, identity).graph).toEqual(graph);
  expect(graph.plan.sha256).toBe(sha(PLAN));
  const ordinary = await projection.graph(input);
  expect("kind" in ordinary).toBe(false);
  if ("kind" in ordinary) throw Error("Expected ordinary graph data");
  expect(ordinary.graph).toEqual(graph);
  expect(ordinary.request).toEqual(input);
  const { session: _session, ...reads } = projection;
  const http = await httpFixture(undefined, reads);
  const bootstrap = http.projection.session;
  http.projection.session = async () => ({
    ...(await bootstrap()),
    storeId: input.storeId,
  });
  const methods: string[] = [],
    responseBytes: number[] = [],
    writeSizes: number[] = [];
  const transport = new HttpServiceTransport({
    origin: http.origin,
    localCapability: http.local,
    fetch: async (url, init) => {
      methods.push(init?.method ?? "GET");
      const response = await fetch(url, init);
      if (String(url).includes("/graph"))
        responseBytes.push((await response.clone().arrayBuffer()).byteLength);
      return response;
    },
  });
  const client = new ServiceClient(transport);
  const nativeWrite = ServerResponse.prototype.write;
  const writes = vi
    .spyOn(ServerResponse.prototype, "write")
    .mockImplementation(function (
      this: ServerResponse,
      ...args: Parameters<ServerResponse["write"]>
    ) {
      if (
        this.hasHeader("content-disposition") ||
        String(this.getHeader("content-type")).includes("ndjson")
      )
        writeSizes.push(Buffer.byteLength(args[0]));
      return Reflect.apply(nativeWrite, this, args);
    });
  // Observe ORIGINAL iterator exhaustion and frame boundaries, without producing
  // replacement frames or relying on a trailer alone as proof of EOF.
  let exported: ExportFrame[] = [],
    originalEof = false;
  http.projection.export = async function* (selected, signal) {
    exported = [];
    originalEof = false;
    for await (const frame of projection.export(selected, signal)) {
      exported.push(frame);
      yield frame;
    }
    originalEof = true;
  };
  const exportMetrics: unknown[] = [];
  let proofReplyBytes = 0,
    proofCalls = 0,
    progressBytes = 0;
  try {
    expect((await client.session()).kind).toBe("ok");
    const normal = await client.graph(input);
    expect(normal).toEqual({ kind: "ok", value: ordinary });
    expect(methods.at(-1)).toBe("GET");
    expect(responseBytes.at(-1)).toBe(bytes(normal));
    expect(bytes(normal)).toBeGreaterThan(524288);
    expect(bytes(normal)).toBeLessThanOrEqual(1048576);

    // Select the real finite-preparation issuer explicitly, as in the old probe.
    // This is a labelled initial-selection injection, NOT a simulated timeout.
    const initial = graphPreparation(
      input,
      new HistoryReadProof(f.files).prepareCompletion(new HistoryReadBudget()),
    );
    if (!("kind" in initial)) throw Error("Expected proof preparation");
    const graphRead = http.projection.graph;
    http.projection.graph = async () => initial;
    const progress = await client.graph(input);
    expect(progress).toEqual({ kind: "ok", value: initial });
    progressBytes = bytes(progress);
    expect(progressBytes).toBeLessThanOrEqual(524288);
    http.projection.graph = graphRead;
    let next = initial.next,
      done = false;
    for (let n = 0; n < 30; n++) {
      const page = await client.graph(next);
      proofCalls++;
      expect(methods.at(-1)).toBe("POST");
      expect(page.kind).toBe("ok");
      if (page.kind !== "ok") throw Error("Finite graph refused");
      expect(page.value.request).toEqual(next); // includes the exact navigation echo
      expect(page.value.request.navigation).toBe(next.navigation);
      if ("kind" in page.value) {
        expect(bytes(page)).toBeLessThanOrEqual(524288);
        next = page.value.next;
        continue;
      }
      expect(page.value.graph).toEqual(graph);
      expect(sha(canonicalJson(page.value.graph))).toBe(hash);
      proofReplyBytes = bytes(page);
      expect(responseBytes.at(-1)).toBe(proofReplyBytes);
      expect(proofReplyBytes).toBeGreaterThan(524288);
      expect(proofReplyBytes).toBeLessThanOrEqual(1048576);
      done = true;
      break;
    }
    expect(done).toBe(true);
    // Correlation is not waived to fit the document; a missing echo is refused.
    const echoed = next;
    http.projection.graph = async () => ordinary;
    expect((await client.graph(echoed)).kind).toBe("error");
    http.projection.graph = graphRead;

    for (const format of ["ndjson", "markdown"] as const) {
      const selected: ExportRequest = {
        storeId: input.storeId,
        scope: input.scope,
        snapshotSeq: input.snapshotSeq,
        format,
      };
      const seen: ExportFrame[] = [];
      for await (const frame of client.export(
        selected,
        new AbortController().signal,
      )) {
        if (frame.event.kind === "trailer") expect(originalEof).toBe(true);
        seen.push(frame);
      }
      expect(originalEof).toBe(true);
      expect(seen).toEqual(exported);
      const body = verifyFrames(seen, selected);
      const verifyGraph = (body: string) => {
        // Exact independently retained graph bytes, not only a preview/hash/ref.
        expect(body).toContain(`"graph":${original}`);
        if (format === "ndjson") {
          const parsed: ExportFrame[] = body
            .trimEnd()
            .split("\n")
            .map((line) => JSON.parse(line));
          const graphs = parsed.filter((frame) => frame.event.kind === "graph");
          expect(graphs).toHaveLength(1);
          const event = graphs[0].event;
          if (event.kind !== "graph") throw Error("Graph absent");
          expect(event.graph).toEqual(ordinary);
          const detail = parsed
            .flatMap((frame) =>
              frame.event.kind === "detail" ? [frame.event.text] : [],
            )
            .join("");
          expect(detail).toBe(PLAN);
        } else {
          const marker = "## Frozen graph and identity\n\n```json\n";
          const start = body.indexOf(marker) + marker.length;
          expect(start).toBeGreaterThan(marker.length);
          const page: GraphPage = JSON.parse(
            body.slice(start, body.indexOf("\n```", start)),
          );
          expect(page).toEqual(ordinary);
          expect(sha(canonicalJson(page.graph))).toBe(hash);
          expect(body).toContain(PLAN);
        }
      };
      verifyGraph(body);
      const downloaded = await request(
        http.origin,
        wireUrl("download", selected),
        { headers: { cookie: http.cookie } },
      );
      expect(downloaded.status).toBe(200);
      expect(downloaded.headers["content-type"]).toContain(
        format === "ndjson" ? "application/x-ndjson" : "text/markdown",
      );
      expect(downloaded.headers["content-disposition"]).toContain("attachment");
      expect(originalEof).toBe(true);
      expect(downloaded.text).toBe(verifyFrames(exported, selected));
      verifyGraph(downloaded.text);
      exportMetrics.push({
        format,
        clientFrames: seen.length,
        downloadFrames: exported.length,
        largestFrame: Math.max(...seen.map(bytes)),
        clientBytes: Buffer.byteLength(body),
        downloadBytes: Buffer.byteLength(downloaded.text),
        clientTrailer: seen.at(-1)!.event,
        downloadTrailer: exported.at(-1)!.event,
      });
    }
    expect(writeSizes.length).toBeGreaterThan(4);
    expect(Math.max(...writeSizes)).toBeLessThanOrEqual(262144);
    expect(writeSizes).toContain(262144); // large graph really crossed split writes
    // Adapter-fault injections at the real W1 edge. The retained graph stays
    // valid; oversized surrounding read/frame objects must not reach a client.
    const overPage = {
      ...ordinary,
      request: { ...input, navigation: "x".repeat(1048576) },
    };
    http.projection.graph = async () => overPage;
    const refused = await client.graph(input);
    expect(refused).toEqual({
      kind: "error",
      error: expect.objectContaining({ code: "oversize", effect: "none" }),
    });
    http.projection.graph = graphRead;
    const originalExport = http.projection.export;
    http.projection.export = async function* (selected, signal) {
      for await (const frame of projection.export(selected, signal))
        yield frame.event.kind === "graph"
          ? { ...frame, event: { kind: "graph", graph: overPage } }
          : frame;
    };
    const rejectedKinds: string[] = [];
    await expect(
      (async () => {
        for await (const frame of client.export(
          {
            storeId: input.storeId,
            scope: input.scope,
            snapshotSeq: input.snapshotSeq,
            format: "ndjson",
          },
          new AbortController().signal,
        ))
          rejectedKinds.push(frame.event.kind);
      })(),
    ).rejects.toThrow();
    expect(rejectedKinds).toContain("manifest");
    expect(rejectedKinds).not.toContain("graph");
    expect(rejectedKinds).not.toContain("trailer");
    http.projection.export = originalExport;
    expect(http.adapters.admission).toBeNull();
    expect(storedTree(f.files.directory)).toEqual(before);
    // Body + 1 refuses before admission/filesystem effects, not after truncation.
    const oversized = structuredClone(graph);
    oversized.assignments[15].expectedOutput += "x";
    expect(bytes(oversized)).toBe(524289);
    expect(() => decodeGraph(oversized)).toThrow(
      expect.objectContaining({ code: "oversize" }),
    );
    expect(() => f.writer.admitRun(f.link.runId, identity, oversized)).toThrow(
      expect.objectContaining({ code: "oversize" }),
    );
    expect(storedTree(f.files.directory)).toEqual(before);
    const receipt = process.env.CADENCE_GRAPH_BOUNDARY_RECEIPT;
    if (receipt)
      writeFileSync(
        receipt,
        `${JSON.stringify(
          {
            graphBytes: bytes(graph),
            graphSha256: hash,
            planBytes: Buffer.byteLength(PLAN),
            planSha256: sha(PLAN),
            ordinaryReplyBytes: bytes(normal),
            progressReplyBytes: progressBytes,
            proofReplyBytes,
            proofCalls,
            maximumHttpWriteBytes: Math.max(...writeSizes),
            exports: exportMetrics,
            tmpMode: (lstatSync(tmpdir()).mode & 0o777).toString(8),
            unchangedHistory: true,
            sdkOrWorkerLaunched: false,
          },
          null,
          2,
        )}\n`,
        { flag: "wx", mode: 0o600 },
      );
  } finally {
    writes.mockRestore();
    await http.server.close();
    f.lease.release();
  }
}, 20000);

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
