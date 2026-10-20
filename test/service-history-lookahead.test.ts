import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { HistoryReadBudget } from "../src/history/files.ts";
import { HistoryReadProof } from "../src/history/read-proof.ts";
import { ForwardValidator } from "../src/history/validator.ts";
import {
  decodeSearchPage,
  encodeExportFrame,
  type ReadCursor,
} from "../src/service-contract.ts";
import { longLookahead } from "./helpers/history-long-lookahead.ts";
import {
  detailPage,
  readProjection,
  storedTree,
} from "./helpers/history-read-fixture.ts";

it("cold end and1023-byte same-field overlap resume across >8MiB of interleaved original metadata; both exports finish", async () => {
  const { f, state, text, query, first, second, detail } =
    await longLookahead();
  const bundle = join(f.dir, "read.mjs"),
    input = join(f.dir, "read.json");
  const build = spawnSync(
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
  expect(build.status, build.stderr).toBe(0);
  const seed: ReadCursor = {
    storeId: f.files.format.storeId,
    scope: { kind: "task", id: f.link.taskId },
    snapshotSeq: state.committedSeq,
    query,
    recordId: null,
    recordVersion: null,
    field: null,
    offset: 0,
  };
  const before = storedTree(f.files.directory),
    hits = [],
    phases = new Set<string>();
  let cursor: ReadCursor | null = seed;
  for (let n = 0; n < 1000 && cursor; n++) {
    writeFileSync(
      input,
      JSON.stringify({
        root: f.root,
        state: join(f.dir, "state"),
        cursor,
        mode: "search",
      }),
    );
    const child = spawnSync(process.execPath, [bundle, input], {
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: 512 * 1024,
    });
    expect(child.status, child.stderr).toBe(0);
    expect(child.signal).toBeNull();
    expect(child.stderr).toBe("");
    const page = decodeSearchPage(JSON.parse(child.stdout));
    hits.push(...page.hits);
    cursor = page.next;
    if (cursor?.navigation) {
      const checkpoint = JSON.parse(
        new HistoryReadProof(f.files)
          .open(
            { purpose: "search", request: cursor },
            cursor.navigation,
            new HistoryReadBudget(),
          )
          .toString(),
      );
      if (checkpoint.work) phases.add(checkpoint.work.kind);
    }
  }
  expect(cursor).toBeNull();
  expect(hits).toHaveLength(1);
  expect([...phases].sort()).toEqual(["end", "overlap"]);
  expect(hits[0].content).toEqual(detail.content);
  expect(hits[0].range).toEqual({ start: 6, end: 1030 });
  expect(hits[0].cursor.navigation).toBeUndefined();
  // Actual data/progress API, without the searcher's RAM or a copied proof.
  let selected: ReadCursor | null = hits[0].cursor,
    selectedText = "";
  while (selected) {
    const page = await detailPage(readProjection(f), selected);
    selectedText += page.text;
    selected = page.next;
  }
  expect(selectedText).toBe(text.slice(6));
  for (const format of ["ndjson", "markdown"] as const) {
    const hash = createHash("sha256");
    let bytes = 0,
      frames = 0,
      emitted = "",
      trailer = false;
    for await (const frame of readProjection(f).export(
      {
        storeId: seed.storeId,
        scope: seed.scope,
        snapshotSeq: seed.snapshotSeq,
        format,
      },
      new AbortController().signal,
    )) {
      expect(trailer).toBe(false);
      if (frame.event.kind === "trailer") {
        expect(frame.event.sha256).toBe(hash.digest("hex"));
        expect(frame.event.encodedBytes).toBe(bytes);
        expect(frame.event.frames).toBe(frames);
        expect(frame.event.complete).toBe(true);
        trailer = true;
      } else {
        const body = encodeExportFrame(frame, format);
        hash.update(body);
        bytes += Buffer.byteLength(body);
        frames++;
        if (frame.event.kind === "detail") emitted += frame.event.text;
        if (frame.event.kind === "markdown") emitted += frame.event.text;
      }
    }
    expect(trailer).toBe(true);
    if (format === "ndjson") expect(emitted).toBe(text);
    else {
      expect(emitted).toContain(first);
      expect(emitted).toContain(second);
    }
  }
  const abort = new AbortController(),
    originalNext = ForwardValidator.prototype.next;
  let scheduled = false,
    readsAfterAbort = 0,
    emittedFrames = 0;
  const next = vi
    .spyOn(ForwardValidator.prototype, "next")
    .mockImplementation(function (this: ForwardValidator, budget) {
      if (abort.signal.aborted) readsAfterAbort++;
      if (!scheduled) {
        scheduled = true;
        setImmediate(() => abort.abort());
      }
      return originalNext.call(this, budget);
    });
  try {
    await expect(
      (async () => {
        for await (const _frame of readProjection(f).export(
          {
            storeId: seed.storeId,
            scope: seed.scope,
            snapshotSeq: seed.snapshotSeq,
            format: "ndjson",
          },
          abort.signal,
        ))
          emittedFrames++;
      })(),
    ).rejects.toThrow();
    expect(scheduled).toBe(true);
    expect(emittedFrames).toBe(0);
    expect(readsAfterAbort).toBe(0);
  } finally {
    next.mockRestore();
  }
  expect(storedTree(f.files.directory)).toEqual(before);
  expect(readFileSync(f.files.segmentPath(1)).length).toBeGreaterThan(
    7 * 1024 * 1024,
  );
}, 120000);
