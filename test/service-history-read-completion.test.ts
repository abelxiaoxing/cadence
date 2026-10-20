import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, expect, it } from "vitest";
import { HistoryReadBudget } from "../src/history/files.ts";
import { HistoryReadProof } from "../src/history/read-proof.ts";
import { HistoryReader } from "../src/history/reader.ts";
import {
  decodeDetailReadResult,
  LIMITS,
  type ReadCursor,
} from "../src/service-contract.ts";
import { historyFixture } from "./helpers/history-fixture.ts";
import { retainedText, storedTree } from "./helpers/history-read-fixture.ts";

let bundle: string;
beforeAll(() => {
  bundle = join(
    mkdtempSync(join(tmpdir(), "cadence-read-completion-")),
    "read.mjs",
  );
  const built = spawnSync(
    "bun",
    [
      "build",
      fileURLToPath(
        new URL("./helpers/history-read-child.ts", import.meta.url),
      ),
      "--target=node",
      "--packages=external",
      "--outfile",
      bundle,
    ],
    { encoding: "utf8", timeout: 10000 },
  );
  expect(built.status, built.stderr).toBe(0);
});

it.each(["malformed-count", "missing-parts", "malformed-range"])(
  "cold detail advances past a present but unusable %s accelerator",
  async (fault) => {
    const f = historyFixture(),
      text = "abc界\n".repeat(45000),
      { content } = await retainedText(f, text, "plan", 1, 1);
    const indexes = join(f.files.directory, "indexes");
    if (fault === "malformed-count")
      writeFileSync(
        join(indexes, "part-heads", `${content.recordId}.json`),
        '{"count":"invalid"}',
      );
    if (fault === "missing-parts")
      renameSync(
        join(indexes, "parts", content.recordId),
        join(f.dir, "preserved-parts"),
      );
    if (fault === "malformed-range")
      writeFileSync(
        join(indexes, "parts", content.recordId, "0.json"),
        '{"unexpected":true}',
      );
    // The head really exists: the old reader chose acceleration permanently here.
    expect(
      readFileSync(join(indexes, "heads", "latest.json")).length,
    ).toBeGreaterThan(0);
    const before = storedTree(f.files.directory);
    let cursor: ReadCursor = {
      storeId: f.files.format.storeId,
      scope: { kind: "task", id: f.link.taskId },
      snapshotSeq: f.writer.committedSeq,
      recordId: content.recordId,
      recordVersion: content.version,
      field: content.field,
      offset: 0,
      query: null,
    };
    let body = "",
      progress = 0,
      finished = false;
    const input = join(f.dir, "read-input.json");
    for (let n = 0; n < 1000; n++) {
      writeFileSync(
        input,
        JSON.stringify({
          root: f.root,
          state: join(f.dir, "state"),
          cursor,
          mode: "detail",
        }),
      );
      const child = spawnSync(process.execPath, [bundle, input], {
        encoding: "utf8",
        timeout: 15000,
        maxBuffer: LIMITS.pageBytes,
      });
      expect(child.status, child.stderr).toBe(0);
      expect(child.signal).toBeNull();
      expect(child.stderr).toBe("");
      expect(Buffer.byteLength(child.stdout)).toBeLessThanOrEqual(
        LIMITS.pageBytes,
      );
      const page = decodeDetailReadResult(JSON.parse(child.stdout));
      expect(page.cursor).toEqual(cursor);
      if ("kind" in page) {
        progress++;
        expect(Object.keys(page).sort()).toEqual([
          "coverage",
          "cursor",
          "kind",
          "next",
        ]);
        const proof = new HistoryReadProof(f.files);
        const state = proof
          .open(
            { purpose: "detail", request: page.next },
            page.next.navigation!,
            new HistoryReadBudget(),
          )
          .toString();
        if (cursor.navigation)
          expect(state).not.toBe(
            proof
              .open(
                { purpose: "detail", request: cursor },
                cursor.navigation,
                new HistoryReadBudget(),
              )
              .toString(),
          );
      } else {
        expect(page.content).toEqual(content);
        expect(page.range?.start).toBe(Buffer.byteLength(body));
        expect(page.range!.end).toBeGreaterThan(page.range!.start);
        body += page.text;
      }
      if (!page.next) {
        finished = true;
        break;
      }
      cursor = page.next;
    }
    expect(finished).toBe(true);
    expect(progress).toBeGreaterThan(0);
    expect(body).toBe(text);
    expect(storedTree(f.files.directory)).toEqual(before);
  },
  30000,
);

it("submitted detail proof and selected source corruption never restart acceleration", async () => {
  const f = historyFixture(),
    { content } = await retainedText(f, "selected text");
  writeFileSync(
    join(
      f.files.directory,
      "indexes",
      "part-heads",
      `${content.recordId}.json`,
    ),
    '{"count":null}',
  );
  const cursor: ReadCursor = {
    storeId: f.files.format.storeId,
    scope: { kind: "task", id: f.link.taskId },
    snapshotSeq: f.writer.committedSeq,
    recordId: content.recordId,
    recordVersion: 1,
    field: content.field,
    offset: 0,
    query: null,
  };
  const page = await HistoryReader.open(f.c)!.readDetail(cursor);
  expect("kind" in page).toBe(true);
  if (!("kind" in page)) throw Error("expected preparation");
  const token = page.next.navigation!;
  const tampered = `${token.slice(0, 12)}${token[12] === "A" ? "B" : "A"}${token.slice(13)}`;
  await expect(
    HistoryReader.open(f.c)!.readDetail({ ...page.next, navigation: tampered }),
  ).rejects.toMatchObject({ code: "corrupt-selected" });
  // A source byte corruption, unlike an unusable index, is never converted into
  // a successful empty page or a new preparation seed.
  const path = f.files.segmentPath(1),
    bytes = readFileSync(path);
  bytes[1] ^= 1;
  writeFileSync(path, bytes);
  const before = storedTree(f.files.directory);
  await expect(
    HistoryReader.open(f.c)!.readDetail(page.next),
  ).rejects.toMatchObject({ code: "corrupt-selected" });
  expect(storedTree(f.files.directory)).toEqual(before);
});

it("cold graph preparation crosses a legal multi-window no-index archive in fresh native processes", async () => {
  const { retainedGraph } = await import("./helpers/history-graph-fixture.ts");
  const { randomUUID } = await import("node:crypto");
  const { canonicalJson, decodeGraphReadResult } = await import(
    "../src/service-contract.ts"
  );
  const f = await retainedGraph();
  let state = f.files.inspect(),
    total = 0;
  // Fixture-only structural metadata appended through real native flushes.
  // No SDK, command effects, imported history, or index authority is involved.
  while (total < 9 * 1024 * 1024) {
    const rows: import("../src/history/types.ts").JournalRow[] = [];
    for (let i = 0; i < 32; i++) {
      const commandId = randomUUID(),
        operationId = randomUUID(),
        taskId = randomUUID(),
        seq = String(BigInt(state.committedSeq) + BigInt(i) + 1n);
      const identity = {
        kind: "action" as const,
        expected: { ...f.context, task: null },
        action: {
          kind: "create" as const,
          taskKind: "research" as const,
          goal: "z".repeat(7900),
        },
      };
      const row: import("../src/history/types.ts").JournalRow = {
        kind: "record",
        id: randomUUID(),
        seq,
        value: {
          kind: "admission",
          intent: {
            commandId,
            operationId,
            createdTaskId: taskId,
            runId: null,
            identity,
          },
          record: {
            identity,
            receipt: {
              commandId,
              operationId,
              runId: null,
              admission: "accepted",
              committedSeq: seq,
              execution: null,
              settlement: null,
              publication: "pending",
              created: { kind: "task", taskId, state: "reserved" },
            },
          },
        },
      };
      total += Buffer.byteLength(canonicalJson(row));
      rows.push(row);
    }
    state = await f.files.append(f.lease, state, rows);
  }
  renameSync(
    join(f.files.directory, "indexes"),
    join(f.dir, "preserved-indexes"),
  );
  const before = storedTree(f.files.directory);
  let request: import("../src/service-contract.ts").GraphReadRequest = {
    storeId: f.files.format.storeId,
    scope: { kind: "child", id: f.link.childRunId },
    snapshotSeq: state.committedSeq,
    graph: f.identity.graph!,
  };
  const input = join(f.dir, "graph-input.json");
  let complete = false,
    progress = 0,
    priorState = "";
  for (let n = 0; n < 1000; n++) {
    writeFileSync(
      input,
      JSON.stringify({
        root: f.root,
        state: join(f.dir, "state"),
        request,
        mode: "graph",
      }),
    );
    const child = spawnSync(process.execPath, [bundle, input], {
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: LIMITS.pageBytes,
    });
    expect(child.status, child.stderr).toBe(0);
    expect(child.signal).toBeNull();
    expect(child.stderr).toBe("");
    expect(Buffer.byteLength(child.stdout)).toBeLessThanOrEqual(
      LIMITS.pageBytes,
    );
    const page = decodeGraphReadResult(JSON.parse(child.stdout));
    expect(page.request).toEqual(request);
    if (!("kind" in page)) {
      expect(page.graph).toEqual(f.graph);
      complete = true;
      break;
    }
    const plaintext = new HistoryReadProof(f.files)
      .open(
        { purpose: "graph", request: page.next },
        page.next.navigation!,
        new HistoryReadBudget(),
      )
      .toString();
    expect(plaintext).not.toBe(priorState);
    priorState = plaintext;
    request = page.next;
    progress++;
  }
  expect(complete).toBe(true);
  expect(progress).toBeGreaterThan(1);
  // The genuine native-produced graph proof also crosses the existing finite
  // readonly POST route and strict portable client, without an admission adapter.
  const { ServiceClient } = await import("../src/service-client.ts");
  const { HttpServiceTransport } = await import(
    "../src/service-http-client.ts"
  );
  const { httpFixture, request: httpRequest } = await import(
    "./helpers/service-http-fixture.ts"
  );
  const reader = HistoryReader.open(f.c)!;
  const http = await httpFixture(undefined, { graph: (r) => reader.graph(r) });
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
      fetch: async (url, init) => {
        methods.push(init?.method ?? "GET");
        return fetch(url, init);
      },
    }),
  );
  try {
    expect(request.navigation).toBeTruthy();
    expect((await client.session()).kind).toBe("ok");
    let data = false;
    for (let i = 0; i < 1000; i++) {
      const result = await client.graph(request);
      expect(result.kind).toBe("ok");
      expect(methods.at(-1)).toBe("POST");
      if (result.kind !== "ok") throw Error("graph transport refused");
      if (!("kind" in result.value)) {
        expect(result.value.graph).toEqual(f.graph);
        data = true;
        break;
      }
      request = result.value.next;
    }
    expect(data).toBe(true);
    const denied = await httpRequest(http.origin, "/api/v1/graph", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    expect(denied.status).toBe(401);
  } finally {
    await http.server.close();
  }
  expect(storedTree(f.files.directory)).toEqual(before);
}, 45000);

it("portable graph progress is closed, selector-correlated and readonly POST, not source authority", async () => {
  const { randomUUID } = await import("node:crypto");
  const { decodeGraphReadResult, decodeGraphReadRequest } = await import(
    "../src/service-contract.ts"
  );
  const { wireRequest } = await import("../src/service-wire.ts");
  const { ServiceClient } = await import("../src/service-client.ts");
  const { COMPLETE } = await import("../src/history/types.ts");
  const request = {
    storeId: randomUUID(),
    scope: { kind: "run" as const, id: randomUUID() },
    snapshotSeq: "1",
    graph: { recordId: randomUUID(), revision: 1, sha256: "a".repeat(64) },
  };
  const next = { ...request, navigation: "opaque-structural-fixture" };
  const page = { kind: "progress", request, next, coverage: COMPLETE };
  expect(decodeGraphReadResult(page)).toEqual(page);
  expect(wireRequest("graph", next).method).toBe("POST");
  expect(wireRequest("graph", request).method).toBe("GET");
  expect(() =>
    decodeGraphReadRequest({ ...next, navigation: "x".repeat(8193) }),
  ).toThrow();
  expect(() => decodeGraphReadResult({ ...page, graph: {} })).toThrow();
  for (const changed of [
    { ...next, storeId: randomUUID() },
    { ...next, snapshotSeq: "2" },
    { ...next, scope: { ...next.scope, id: randomUUID() } },
    { ...next, graph: { ...next.graph, sha256: "b".repeat(64) } },
  ])
    expect(() => decodeGraphReadResult({ ...page, next: changed })).toThrow();
  const other = {
    ...request,
    graph: { ...request.graph, recordId: randomUUID() },
  };
  // Injected transport correlation negative, separate from the real HTTP case.
  const transport = {
    graph: async () => ({
      kind: "ok",
      value: {
        ...page,
        request: other,
        next: { ...other, navigation: next.navigation },
      },
    }),
  } as unknown as import("../src/service-client.ts").ServiceTransport;
  expect((await new ServiceClient(transport).graph(request)).kind).toBe(
    "error",
  );
});
