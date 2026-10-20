import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, expect, it, vi } from "vitest";
import { HistoryReadBudget } from "../src/history/files.ts";
import { HistoryReadProof } from "../src/history/read-proof.ts";
import { HistoryReader } from "../src/history/reader.ts";
import {
  decodeRetainedProgress,
  freshProgress,
} from "../src/history/retained-progress.ts";
import { searchHistory } from "../src/history/search.ts";
import { ResumableSha256 } from "../src/history/sha256-state.ts";
import { ForwardValidator } from "../src/history/validator.ts";
import {
  ContractError,
  canonicalJson,
  encodeExportFrame,
  LIMITS,
  type ReadCursor,
} from "../src/service-contract.ts";
import { historyFixture } from "./helpers/history-fixture.ts";
import {
  readProjection,
  retainedText,
  searchSeed,
  storedTree,
} from "./helpers/history-read-fixture.ts";

let bundle: string;
beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "cadence-validator-native-"));
  bundle = join(dir, "probe.mjs");
  const build = spawnSync(
    "bun",
    [
      "build",
      fileURLToPath(
        new URL("./helpers/history-progress-probe.ts", import.meta.url),
      ),
      "--target=node",
      "--packages=external",
      "--outfile",
      bundle,
    ],
    { encoding: "utf8", timeout: 10000 },
  );
  expect(build.status, build.stderr).toBe(0);
});
it.each(["probe", "probe-twice", "probe-bad-head"])(
  "native cold exact8MiB search/detail and both exports: %s",
  (mode) => {
    const parent = mkdtempSync(join(tmpdir(), "cadence-validator-exact-")),
      dir = join(parent, "fixture");
    const child = spawnSync(process.execPath, [bundle, mode, dir], {
      encoding: "utf8",
      timeout: 90000,
      maxBuffer: 2 * 1024 * 1024,
    });
    expect(child.status, child.stderr).toBe(0);
    expect(child.signal).toBeNull();
    expect(child.stderr).toBe("");
    const receipt = JSON.parse(readFileSync(join(dir, "receipt.json"), "utf8"));
    expect(receipt.featureComplete).toBe(true);
    expect(receipt.predecessorBytes).toBe(8388608);
    if (mode === "probe") expect(receipt.bridgeBytes).toBe(785);
    expect(receipt.readLimit).toBe(8388608);
    expect(receipt.readTimeLimit).toBe(100);
    expect(receipt.entireHistoryTreeUnchanged).toBe(true);
    for (const format of ["ndjson", "markdown"])
      expect(
        JSON.parse(
          readFileSync(join(dir, `export-${format}-receipt.json`), "utf8"),
        ),
      ).toMatchObject({
        format,
        trailer: true,
        sourceUnchanged: true,
        exactTarget: true,
      });
  },
  100000,
);

/** Deliberately injected smaller byte quantum, not a raised production ceiling. */
async function firstProgress(
  f: ReturnType<typeof historyFixture>,
): Promise<ReadCursor> {
  const reserve = HistoryReadBudget.prototype.reserve;
  const guard = vi
    .spyOn(HistoryReadBudget.prototype, "reserve")
    .mockImplementation(function (this: HistoryReadBudget, bytes) {
      if (this.bytes + bytes > 128 * 1024)
        throw new ContractError("receipt-inconclusive");
      reserve.call(this, bytes);
    });
  try {
    const page = await searchHistory(
      HistoryReader.open(f.c)!,
      searchSeed(f, "target"),
    );
    expect(page.next?.navigation).toBeTruthy();
    return page.next!;
  } finally {
    guard.mockRestore();
  }
}
it.each(["predecessor", "same-key", "different-key", "format"])(
  "a genuinely issued checkpoint refuses changed active %s",
  async (change) => {
    const f = historyFixture();
    await retainedText(f, `target${"x".repeat(512 * 1024)}`);
    const cursor = await firstProgress(f);
    const proof = new HistoryReadProof(f.files),
      state = JSON.parse(
        proof
          .open(
            { purpose: "search", request: cursor },
            cursor.navigation!,
            new HistoryReadBudget(),
          )
          .toString(),
      );
    if (change === "predecessor") {
      expect(state.proof.at).toBeGreaterThan(0);
      const path = f.files.segmentPath(state.proof.segment),
        bytes = readFileSync(path);
      bytes[1] ^= 1;
      writeFileSync(path, bytes);
    } else {
      const name = change === "format" ? "format.json" : "read-proof-key.json",
        path = join(f.files.directory, name),
        bytes = readFileSync(path);
      renameSync(path, join(f.dir, `preserved-${name}`));
      if (change === "different-key") {
        const key = JSON.parse(bytes.toString());
        key.key = Buffer.alloc(32, 91).toString("base64url");
        writeFileSync(path, JSON.stringify(key), { mode: 0o600 });
      } else writeFileSync(path, bytes, { mode: 0o600 });
    }
    const before = storedTree(f.files.directory);
    await expect(
      searchHistory(HistoryReader.open(f.c)!, cursor),
    ).rejects.toThrow();
    expect(storedTree(f.files.directory)).toEqual(before);
  },
);
it.each(["phase", "offset", "hash-count", "extra", "overlap"])(
  "authenticated malformed finite state is not trusted: %s",
  async (change) => {
    const f = historyFixture(),
      cursor = searchSeed(f, "target"),
      state = freshProgress();
    const value: Record<string, unknown> = { ...structuredClone(state) };
    if (change === "phase") value.phase = "unknown";
    if (change === "offset") (value.proof as typeof state.proof).line = 10;
    if (change === "hash-count")
      (value.proof as typeof state.proof).raw.bytes = 1;
    if (change === "extra") value.pending = [];
    if (change === "overlap")
      value.work = {
        kind: "overlap",
        target: "a".repeat(64),
        proof: state.proof,
        row: 0,
        event: 0,
        overlap: Buffer.alloc(1024).toString("base64url"),
        offset: 0,
        length: 1023,
      };
    const proof = new HistoryReadProof(f.files);
    cursor.navigation = proof.seal(
      { purpose: "search", request: cursor },
      Buffer.from(JSON.stringify(value)),
      new HistoryReadBudget(),
    );
    const before = storedTree(f.files.directory);
    await expect(
      searchHistory(HistoryReader.open(f.c)!, cursor),
    ).rejects.toThrow();
    expect(storedTree(f.files.directory)).toEqual(before);
  },
);
it("finite original scan agrees with the independent administrative scanner; reachable checkpoints fit", async () => {
  const f = historyFixture();
  await retainedText(f, "界target".repeat(9000));
  const expected = [...f.files.scan(undefined, false)].map(
      (b) => b.marker.last,
    ),
    actual: string[] = [],
    validator = new ForwardValidator(f.files);
  let largest = 0,
    readyState: ReturnType<typeof validator.checkpoint> | undefined;
  for (let n = 0; n < 10000; n++) {
    const budget = new HistoryReadBudget(),
      original = budget.reserve.bind(budget);
    let steps = 0;
    budget.reserve = (bytes) => {
      if (++steps > 40) throw new ContractError("receipt-inconclusive");
      original(bytes);
    };
    try {
      const p = validator.next(budget);
      if (!p) break;
      actual.push(p.seq);
      readyState = validator.checkpoint();
    } catch (error) {
      expect(error).toMatchObject({ code: "receipt-inconclusive" });
    }
    const checkpoint = validator.checkpoint();
    expect(new ForwardValidator(f.files, checkpoint).checkpoint()).toEqual(
      checkpoint,
    );
    if (readyState) {
      const state = freshProgress();
      state.phase = "output";
      state.proof = readyState;
      state.work = {
        kind: "overlap",
        target: "a".repeat(64),
        proof: checkpoint,
        row: 0,
        event: 0,
        offset: LIMITS.detailBytes,
        length: 1023,
        overlap: Buffer.alloc(1023, 0xff).toString("base64url"),
      };
      state.snapshot = {
        pointer: {
          segment: readyState.segment,
          offset: readyState.start,
          bytes: readyState.end - readyState.start,
          seq: String(readyState.committed),
        },
        stamp: readyState.stamp,
        sha256: new ResumableSha256(readyState.raw).digest(),
      };
      state.end = {
        ...state.snapshot,
        row: LIMITS.segmentRecords - 1,
        event: LIMITS.ownerQueueFrames - 1,
      };
      state.admission = { ...state.end };
      // Exercise the FULL admitted stamp-slot ceiling as a codec bound too;
      // these padded tuples are not claimed to be real file incarnations.
      const maximal = structuredClone(state);
      for (const proofState of [maximal.proof, maximal.work!.proof]) {
        if (proofState.stamp) proofState.stamp = "9".repeat(256);
        if (proofState.previous.stamp)
          proofState.previous.stamp = "9".repeat(256);
      }
      for (const witness of [maximal.snapshot, maximal.end, maximal.admission])
        if (witness) witness.stamp = "9".repeat(256);
      const bytes = Buffer.from(
        canonicalJson(decodeRetainedProgress(maximal), 6000),
      );
      largest = Math.max(largest, bytes.length);
      const cursor = searchSeed(f, "target"),
        proof = new HistoryReadProof(f.files),
        token = proof.seal(
          { purpose: "search", request: cursor },
          bytes,
          new HistoryReadBudget(),
        );
      expect(token.length).toBeLessThanOrEqual(8192);
      expect(
        proof.open(
          { purpose: "search", request: cursor },
          token,
          new HistoryReadBudget(),
        ),
      ).toEqual(bytes);
    }
  }
  expect(actual).toEqual(expected);
  expect(largest).toBeGreaterThan(3000);
  expect(largest).toBeLessThanOrEqual(6000);
  const source = readFileSync(
    f.files.segmentPath(validator.state.previous.segment),
  );
  expect(validator.state.previous.sha).toBe(
    createHash("sha256").update(source).digest("hex"),
  );
  expect(validator.state.previous.high).toBe(Number(f.files.inspect().highSeq));
});

it.each([3, 2])(
  "private iterator exports a9MiB retained field in both formats without a browser key, format%s",
  async (version) => {
    const f = historyFixture(),
      text = "retained界\n".repeat(800000),
      selected = await retainedText(f, text, "plan", 1, 1);
    expect(Buffer.byteLength(text)).toBeGreaterThan(8 * 1024 * 1024);
    const snapshotSeq = f.writer.committedSeq;
    if (version === 2) {
      // Fixture setup only: construct recognized old-format bytes, preserving the
      // original new-format files OUTSIDE history. No product migration is invoked.
      const path = join(f.files.directory, "format.json"),
        format = JSON.parse(readFileSync(path, "utf8"));
      renameSync(path, join(f.dir, "original-format3.json"));
      renameSync(
        join(f.files.directory, "read-proof-key.json"),
        join(f.dir, "original-format3-key.json"),
      );
      writeFileSync(
        path,
        JSON.stringify({ ...format, schema: "cadence-history-store/2" }),
        { mode: 0o600 },
      );
    }
    const before = storedTree(f.files.directory);
    for (const format of ["ndjson", "markdown"] as const) {
      const sum = createHash("sha256"),
        content = createHash("sha256");
      let count = 0,
        encodedBytes = 0,
        contentBytes = 0,
        trailer = false,
        markdownDetail = false;
      for await (const frame of readProjection(f).export(
        {
          storeId: f.files.format.storeId,
          scope: { kind: "task", id: f.link.taskId },
          snapshotSeq,
          format,
        },
        new AbortController().signal,
      )) {
        expect(trailer).toBe(false);
        if (frame.event.kind === "trailer") {
          expect(frame.event).toMatchObject({
            frames: count,
            encodedBytes,
            complete: true,
            sha256: sum.digest("hex"),
          });
          trailer = true;
        } else {
          const bytes = encodeExportFrame(frame, format);
          sum.update(bytes);
          encodedBytes += Buffer.byteLength(bytes);
          count++;
          if (frame.event.kind === "detail") {
            content.update(frame.event.text);
            contentBytes += Buffer.byteLength(frame.event.text);
          }
          if (frame.event.kind === "markdown") {
            if (frame.event.text.startsWith("\n\n### ")) markdownDetail = true;
            else if (frame.event.text.startsWith("\n\nCoverage: "))
              markdownDetail = false;
            else if (markdownDetail) {
              const retained = frame.event.text.replace(/^ {4}/gm, "");
              content.update(retained);
              contentBytes += Buffer.byteLength(retained);
            }
          }
        }
      }
      expect(trailer).toBe(true);
      expect(contentBytes).toBe(Buffer.byteLength(text));
      expect(content.digest("hex")).toBe(selected.content.sha256);
      expect(encodedBytes).toBeGreaterThan(Buffer.byteLength(text));
    }
    expect(storedTree(f.files.directory)).toEqual(before);
  },
  90000,
);
