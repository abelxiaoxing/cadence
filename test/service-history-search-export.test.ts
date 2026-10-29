import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { HistoryFiles, HistoryReadBudget } from "../src/history/files.ts";
import { searchHistory } from "../src/history/search.ts";
import {
  type ExportFrame,
  type ExportRequest,
  ExportTracker,
  encodeExportFrame,
  LIMITS,
  type ReadCursor,
} from "../src/service-contract.ts";
import { historyFixture } from "./helpers/history-fixture.ts";
import {
  detailPage,
  readProjection,
  retainedText,
  searchSeed,
  storedTree,
} from "./helpers/history-read-fixture.ts";

function nativeRead(
  f: ReturnType<typeof historyFixture>,
  cursor: ReadCursor,
  mode: "search" | "detail",
) {
  const bundle = join(f.dir, "history-read-child.mjs"),
    input = join(f.dir, "history-read-input.json");
  const built = spawnSync(
    "bun",
    [
      "build",
      fileURLToPath(
        new URL("./helpers/history-read-child.ts", import.meta.url),
      ),
      "--target=node",
      "--format=esm",
      "--packages=external",
      "--outfile",
      bundle,
    ],
    { encoding: "utf8", timeout: 10000 },
  );
  expect(built.status).toBe(0);
  for (let quantum = 0; quantum < 1000; quantum++) {
    writeFileSync(
      input,
      JSON.stringify({
        root: f.root,
        state: join(f.dir, "state"),
        cursor,
        mode,
      }),
    );
    const child = spawnSync(process.execPath, [bundle, input], {
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 512 * 1024,
    });
    expect(child.status, child.stderr).toBe(0);
    expect(child.signal).toBeNull();
    expect(child.stderr).toBe("");
    const reply = JSON.parse(child.stdout);
    if (mode !== "detail" || reply.kind !== "progress") return reply;
    expect(reply.next).not.toEqual(cursor);
    cursor = reply.next;
  }
  throw Error("Cold detail proof did not complete");
}
async function allHits(
  f: ReturnType<typeof historyFixture>,
  cursor: ReadCursor,
  limit = 50,
) {
  const hits = [],
    pages = [];
  for (let n = 0; n < 2000; n++) {
    const page = await searchHistory(readProjection(f).reader, cursor, limit);
    pages.push(page);
    hits.push(...page.hits);
    if (!page.next) return { hits, pages };
    expect(page.next).not.toEqual(cursor);
    cursor = page.next;
  }
  throw Error("nonterminating search");
}
function exportRequest(
  f: ReturnType<typeof historyFixture>,
  format: ExportRequest["format"],
): ExportRequest {
  return {
    storeId: f.files.format.storeId,
    scope: { kind: "task", id: f.link.taskId },
    snapshotSeq: f.writer.committedSeq,
    format,
  };
}
async function verifiedExport(
  f: ReturnType<typeof historyFixture>,
  format: ExportRequest["format"],
) {
  const input = exportRequest(f, format),
    tracker = new ExportTracker(input),
    digest = createHash("sha256"),
    frames: ExportFrame[] = [];
  let bytes = 0;
  for await (const raw of readProjection(f).export(
    input,
    new AbortController().signal,
  )) {
    const frame = tracker.receive(raw);
    frames.push(frame);
    if (frame.event.kind === "trailer") {
      expect(frame.event.sha256).toBe(digest.digest("hex"));
      expect(frame.event.frames).toBe(frames.length - 1);
      expect(frame.event.encodedBytes).toBe(bytes);
    } else {
      const encoded = encodeExportFrame(frame, format);
      digest.update(encoded);
      bytes += Buffer.byteLength(encoded);
    }
  }
  expect(frames.at(-1)?.event.kind).toBe("trailer");
  expect(tracker.completion).toBe("complete-unverified-digest");
  return frames;
}
it("literal UTF8 overlaps span source chunks/parts, never unrelated fields; exact owner and content versions navigate", async () => {
  const f = historyFixture();
  const text = `${"x".repeat(8191)}😀needle${"x".repeat(256 * 1024 - 8191 - 10)}跨界needle`,
    a = await retainedText(f, text, "plan", 7);
  await retainedText(f, "NOTjoined");
  await retainedText(f, "AcrossFields");
  const before = storedTree(f.files.directory),
    result = await allHits(f, searchSeed(f, "😀needle"));
  expect(result.hits).toHaveLength(1);
  expect(result.hits[0].range).toEqual({ start: 8191, end: 8201 });
  expect(result.hits[0].owner.entity.version).toBe(7);
  expect(result.hits[0].content.version).toBe(1);
  const page = await detailPage(readProjection(f), result.hits[0].cursor);
  expect(page.text.startsWith("😀needle")).toBe(true);
  expect(page.content).toEqual(a.content);
  expect((await allHits(f, searchSeed(f, "joinedAcross"))).hits).toEqual([]);
  expect((await allHits(f, searchSeed(f, "Needle"))).hits).toEqual([]);
  expect((await allHits(f, searchSeed(f, "跨界needle"))).hits).toHaveLength(1);
  expect(storedTree(f.files.directory)).toEqual(before);
}, 20000);
it.each([1, 50, 200])(
  "%i-hit pages resume mid-chunk with overlapping matches and restart, no duplicates/skips",
  async (limit) => {
    const f = historyFixture();
    await retainedText(f, "a".repeat(1003));
    const { hits } = await allHits(f, searchSeed(f, "aaa"), limit);
    expect(hits.map((h) => h.range.start)).toEqual(
      Array.from({ length: 1001 }, (_, i) => i),
    );
  },
  20000,
);
it("all owner field kinds remain searchable and snapshots do not acquire later text", async () => {
  const f = historyFixture();
  await Promise.all(
    (["plan", "check", "changes", "review"] as const).map((field) =>
      retainedText(f, `find-${field}`, field),
    ),
  );
  const old = searchSeed(f, "later");
  await retainedText(f, "later");
  expect((await allHits(f, old)).hits).toEqual([]);
  // One scan finds each field kind exactly once (four separate scans of the
  // same store overran the default test time on a loaded runner).
  expect(
    (await allHits(f, searchSeed(f, "find-"))).hits
      .map((h) => h.content.field)
      .sort(),
  ).toEqual(["changes", "check", "plan", "review"]);
});
it("missing all indexes retains advancing zero-hit continuation, exact search and readonly bytes", async () => {
  const f = historyFixture();
  await retainedText(f, `${"z".repeat(2 * 1024 * 1024)}beyond-ring`);
  renameSync(
    join(f.files.directory, "indexes"),
    join(f.files.directory, "indexes-preserved"),
  );
  const before = storedTree(f.files.directory),
    reserve = HistoryReadBudget.prototype.reserve;
  // Inject a smaller per-window scheduling budget; actual file reads still use
  // original native pre-admission. Not a wall-clock or native disk stall claim.
  const spy = vi
    .spyOn(HistoryReadBudget.prototype, "reserve")
    .mockImplementation(function (this: HistoryReadBudget, n) {
      reserve.call(this, n);
      if (this.bytes > 1536 * 1024)
        throw new ContractError("receipt-inconclusive");
    });
  try {
    const { hits, pages } = await allHits(f, searchSeed(f, "beyond-ring"));
    expect(hits).toHaveLength(1);
    expect(hits[0].range.start).toBe(2 * 1024 * 1024);
    expect(pages.some((p) => p.hits.length === 0 && p.next !== null)).toBe(
      true,
    );
    expect(storedTree(f.files.directory)).toEqual(before);
  } finally {
    spy.mockRestore();
  }
}, 20000);

// Kept as an ordinary imported error; no injected filesystem or provider implementation.
import { ContractError } from "../src/service-contract.ts";

it("future/tampered query/scope cursors and corrupt selected parts refuse without repair", async () => {
  const f = historyFixture(),
    text = await retainedText(f, "aaa".repeat(100));
  const p = readProjection(f),
    seed = searchSeed(f, "aaa"),
    first = await p.search(seed);
  expect(first.next).not.toBeNull();
  for (const changed of [
    { query: "bbb" },
    { scope: { kind: "task" as const, id: randomUUID() } },
    { snapshotSeq: "999999" },
    { offset: 1 },
  ])
    await expect(p.search({ ...first.next!, ...changed })).rejects.toThrow();
  await expect(p.search({ ...seed, snapshotSeq: "999999" })).rejects.toThrow();
  const detail = p.reader.selected({
    ...seed,
    recordId: text.content.recordId,
    recordVersion: 1,
    field: "plan",
  });
  let path = "";
  for (const b of f.files.scan())
    for (const row of b.rows)
      if (row.value.kind === "owner")
        for (const e of row.value.events)
          if (e.kind === "chunk" && e.detailId === detail.detailId)
            path = f.files.artifactPath(e.artifact);
  writeFileSync(path, "bad");
  const before = storedTree(f.files.directory);
  await expect(p.search(seed)).rejects.toThrow();
  expect(storedTree(f.files.directory)).toEqual(before);
});
it.each(["ndjson", "markdown"] as const)(
  "complete %s export exceeds rings/old limits with exact common framing/digest and EOF",
  async (format) => {
    const f = historyFixture(),
      text = `${"line 😀\n".repeat(300000)}tail-beyond-ring`,
      saved = await retainedText(f, text);
    const before = storedTree(f.files.directory),
      frames = await verifiedExport(f, format);
    const manifest = frames[0].event;
    expect(manifest.kind).toBe("manifest");
    if (manifest.kind === "manifest")
      expect(manifest.provenance.exporterBuildSha256).toBe(
        createHash("sha256")
          .update(
            readFileSync(new URL("../src/history/export.ts", import.meta.url)),
          )
          .digest("hex"),
      );
    if (format === "ndjson") {
      const details = frames.flatMap((f) =>
        f.event.kind === "detail" ? [f.event] : [],
      );
      expect(
        details.every((d) => d.content.recordId === saved.content.recordId),
      ).toBe(true);
      expect(details.map((d) => d.text).join("")).toBe(text);
      expect(details.at(-1)?.range?.end).toBe(Buffer.byteLength(text));
    } else {
      const body = frames.map((f) => encodeExportFrame(f, format)).join("");
      expect(body).toContain("tail-beyond-ring");
      expect(Buffer.byteLength(body)).toBeGreaterThan(2 * 1024 * 1024);
    }
    expect(storedTree(f.files.directory)).toEqual(before);
  },
  30000,
);
it("escaped-text detail pages and both export frames respect actual encoded bounds", async () => {
  const f = historyFixture(),
    saved = await retainedText(f, "\t\n".repeat(200000));
  let cursor: ReadCursor | null = {
      ...searchSeed(f, "x"),
      query: null,
      recordId: saved.content.recordId,
      recordVersion: 1,
      field: "plan",
    },
    text = "";
  while (cursor) {
    const page = await detailPage(readProjection(f), cursor);
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(
      LIMITS.pageBytes,
    );
    text += page.text;
    cursor = page.next;
  }
  expect(text).toBe("\t\n".repeat(200000));
  for (const format of ["ndjson", "markdown"] as const)
    for (const frame of await verifiedExport(f, format))
      expect(Buffer.byteLength(JSON.stringify(frame))).toBeLessThanOrEqual(
        LIMITS.controlBytes,
      );
}, 15000);
it("abort after an original yielded chunk stops further reads and produces no trailer", async () => {
  const f = historyFixture();
  await retainedText(f, "x".repeat(400000));
  const controller = new AbortController(),
    iterator = readProjection(f)
      .export(exportRequest(f, "ndjson"), controller.signal)
      [Symbol.asyncIterator]();
  expect((await iterator.next()).value?.event.kind).toBe("manifest");
  const reads = vi.spyOn(HistoryFiles.prototype, "readArtifact");
  controller.abort();
  await expect(iterator.next()).rejects.toThrow();
  expect(reads).not.toHaveBeenCalled();
  reads.mockRestore();
});
it("corruption cannot manufacture a trailer; source-limited coverage is separate from complete traversal", async () => {
  const f = historyFixture();
  await retainedText(f, "retained");
  const iterator = readProjection(f)
    .export(exportRequest(f, "ndjson"), new AbortController().signal)
    [Symbol.asyncIterator]();
  await iterator.next();
  const read = vi
    .spyOn(HistoryFiles.prototype, "readArtifact")
    .mockImplementation(() => {
      throw new ContractError("corrupt-selected");
    });
  const events = [];
  try {
    for (;;) {
      const r = await iterator.next();
      if (r.done) break;
      events.push(r.value.event.kind);
    }
    throw Error("accepted corruption");
  } catch (error) {
    expect(error).toBeInstanceOf(ContractError);
    expect(events).not.toContain("trailer");
  } finally {
    read.mockRestore();
  }
});
it("a preserved torn suffix produces explicitly incomplete search/export coverage, never a complete trailer", async () => {
  const f = historyFixture();
  await retainedText(f, "visible-prefix");
  const state = f.files.inspect(),
    path = f.files.segmentPath(state.segment);
  writeFileSync(
    path,
    Buffer.concat([readFileSync(path), Buffer.from('{"kind":')]),
  );
  const before = storedTree(f.files.directory),
    p = readProjection(f),
    page = await p.search(searchSeed(f, "visible-prefix"));
  expect(page.hits).toHaveLength(1);
  expect(page.coverage.observed).toBe("incomplete");
  const frames = [];
  for await (const frame of p.export(
    exportRequest(f, "ndjson"),
    new AbortController().signal,
  ))
    frames.push(frame);
  expect(frames.at(-1)?.event).toMatchObject({
    kind: "trailer",
    complete: false,
    coverage: { observed: "incomplete", omissions: ["gap"] },
  });
  expect(storedTree(f.files.directory)).toEqual(before);
});
it("actual committed part bytes cannot satisfy an altered aggregate content hash even with a recomputed journal checksum", async () => {
  const f = historyFixture(),
    saved = await retainedText(f, "a".repeat(300000));
  const { canonicalJson } = await import("../src/service-contract.ts");
  for (let segment = 1; segment <= f.files.inspect().segment; segment++) {
    const path = f.files.segmentPath(segment),
      lines = readFileSync(path, "utf8").trimEnd().split("\n"),
      out: string[] = [],
      batch: string[] = [];
    let changed = false;
    for (const line of lines) {
      const value = JSON.parse(line);
      if (value.kind === "record") {
        if (value.value.kind === "owner")
          for (const event of value.value.events)
            if (
              event.kind === "end" &&
              event.detail.content.recordId === saved.content.recordId
            ) {
              event.detail.content.sha256 = "0".repeat(64);
              changed = true;
            }
        const next = `${canonicalJson(value)}\n`;
        batch.push(next);
        out.push(next);
      } else {
        value.sha256 = createHash("sha256")
          .update(batch.join(""))
          .digest("hex");
        out.push(`${canonicalJson(value)}\n`);
        batch.length = 0;
      }
    }
    if (changed) writeFileSync(path, out.join(""));
  }
  const before = storedTree(f.files.directory),
    seen: ExportFrame[] = [];
  await expect(
    (async () => {
      for await (const frame of readProjection(f).export(
        exportRequest(f, "ndjson"),
        new AbortController().signal,
      ))
        seen.push(frame);
    })(),
  ).rejects.toThrow();
  expect(
    seen.some(
      (f) =>
        f.event.kind === "detail" && f.event.content.sha256 === "0".repeat(64),
    ),
  ).toBe(true);
  expect(seen.some((f) => f.event.kind === "trailer")).toBe(false);
  expect(storedTree(f.files.directory)).toEqual(before);
});

it("an ordinary fresh Node process resumes a no-index mid-chunk cursor at its original snapshot", async () => {
  const f = historyFixture();
  await retainedText(f, "a".repeat(200));
  const first = await readProjection(f).search(searchSeed(f, "aaa"));
  expect(first.hits).toHaveLength(50);
  await retainedText(f, "aaa newly committed after snapshot");
  renameSync(
    join(f.files.directory, "indexes"),
    join(f.files.directory, "indexes-preserved"),
  );
  const before = storedTree(f.files.directory),
    starts: number[] = [];
  // A loaded host may end a page at the search time budget; follow its cursor.
  for (let next = first.next; starts.length < 50; ) {
    const page = nativeRead(f, next!, "search");
    expect(page.cursor.snapshotSeq).toBe(first.cursor.snapshotSeq);
    starts.push(
      ...page.hits.map((h: { range: { start: number } }) => h.range.start),
    );
    expect(page.next ?? starts.length >= 50).toBeTruthy();
    next = page.next;
  }
  expect(starts.slice(0, 50)).toEqual(
    Array.from({ length: 50 }, (_, i) => i + 50),
  );
  expect(storedTree(f.files.directory)).toEqual(before);
}, 20000);
