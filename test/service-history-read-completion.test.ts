import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, expect, it } from "vitest";
import { HistoryReader } from "../src/history/reader.ts";
import type { ReadCursor } from "../src/service-contract.ts";
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
