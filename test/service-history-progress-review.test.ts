import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { HistoryReadBudget } from "../src/history/files.ts";
import { readRetainedList } from "../src/history/list-progress.ts";
import { HistoryReadProof } from "../src/history/read-proof.ts";
import { RetainedTraversal } from "../src/history/retained-traversal.ts";
import type { JournalRow, SavedEvent } from "../src/history/types.ts";
import {
  ForwardValidator,
  type ValidatorState,
} from "../src/history/validator.ts";
import {
  ContractError,
  canonicalJson,
  LIMITS,
  type ListRequest,
} from "../src/service-contract.ts";
import { historyFixture } from "./helpers/history-fixture.ts";
import {
  readProjection,
  retainedText,
  searchSeed,
  storedTree,
} from "./helpers/history-read-fixture.ts";

it("review: list resumes a suspended final tail proof before reporting completion", async () => {
  const f = historyFixture();
  await retainedText(f, "retained");
  appendFileSync(f.files.segmentPath(1), "x".repeat(200000));
  const before = storedTree(f.files.directory);
  const projection = readProjection(f);
  let request: ListRequest = {
    reader: "contents",
    storeId: f.files.format.storeId,
    scope: { kind: "task", id: f.link.taskId },
    snapshotSeq: f.writer.committedSeq,
    after: null,
    limit: 50,
  };
  const finish = RetainedTraversal.prototype.finish;
  let suspended = false,
    finishes = 0;
  const spy = vi
    .spyOn(RetainedTraversal.prototype, "finish")
    .mockImplementation(function (this: RetainedTraversal) {
      finishes++;
      if (suspended) return finish.call(this);
      suspended = true;
      const reserve = this.budget.reserve.bind(this.budget);
      let steps = 0;
      this.budget.reserve = (bytes) => {
        if (++steps > 10) throw new ContractError("receipt-inconclusive");
        reserve(bytes);
      };
      try {
        return finish.call(this);
      } finally {
        this.budget.reserve = reserve;
      }
    });
  try {
    let records = 0;
    for (let n = 0; n < 100; n++) {
      const page = await readRetainedList(projection, request);
      if ("kind" in page) {
        request = page.next;
        continue;
      }
      records += page.records.length;
      if (page.next) {
        request = page.next;
        continue;
      }
      expect(suspended).toBe(true);
      expect(finishes).toBeGreaterThan(1);
      expect(page.coverage.observed).toBe("incomplete");
      expect(page.coverage.omissions).toContain("gap");
      // Owner plan bodies have no worker content descriptor in this list.
      expect(records).toBe(0);
      expect(storedTree(f.files.directory)).toEqual(before);
      return;
    }
    throw Error("review fixture failed to complete");
  } finally {
    spy.mockRestore();
  }
});

it("review: maximum ordered reference membership resumes cold without serialized rows or references", async () => {
  const f = historyFixture();
  const events: SavedEvent[] = Array.from(
    { length: LIMITS.ownerQueueFrames },
    () => ({
      kind: "chunk",
      detailId: randomUUID(),
      source: null,
      artifact: {
        runId: randomUUID(),
        artifactId: randomUUID(),
        part: Number.MAX_SAFE_INTEGER,
        bytes: LIMITS.artifactPartBytes,
        sha256: "a".repeat(64),
      },
      offset: LIMITS.detailBytes - LIMITS.chunkBytes,
      start: LIMITS.artifactPartBytes - LIMITS.chunkBytes,
      length: LIMITS.chunkBytes,
    }),
  );
  const rows: JournalRow[] = [0, 1].map((i) => ({
    kind: "record",
    seq: String(i + 1),
    id: randomUUID(),
    value: {
      kind: "owner",
      link: {
        epoch: f.link.epoch,
        taskId: f.link.taskId,
        runId: null,
        operationId: randomUUID(),
      },
      observedMs: 0,
      events,
    },
  }));
  // Structural retained-file fixture: original membership, not artifact body or
  // SDK capture evidence. Repeated references must preserve first occurrence order.
  await f.files.append(f.lease, f.files.inspect(), rows);
  const expected = [...f.files.scan(undefined, false)].map(
    (b) => b.marker.last,
  );
  const actual: string[] = [],
    seen = new Set<string>();
  let state: ValidatorState | undefined,
    done = false;
  for (let n = 0; n < 100; n++) {
    const budget = new HistoryReadBudget(),
      proof = new HistoryReadProof(f.files);
    const completion = proof.prepareCompletion(budget);
    const v = new ForwardValidator(f.files, state);
    try {
      const pointer = v.next(budget);
      if (pointer) actual.push(pointer.seq);
      else done = true;
    } catch (error) {
      expect(error).toMatchObject({ code: "receipt-inconclusive" });
    }
    state = v.checkpoint();
    const bytes = canonicalJson(state, 6000);
    expect(seen.has(bytes)).toBe(false);
    seen.add(bytes);
    const request = searchSeed(f, "reference-proof");
    const token = completion.seal(
      { purpose: "search", request },
      Buffer.from(bytes),
    );
    expect(token.length).toBeLessThanOrEqual(8192);
    expect(budget.bytes).toBeLessThanOrEqual(LIMITS.searchBytes);
    // Discard native/parser caches at EVERY boundary, not just after EOF.
    state = JSON.parse(
      proof
        .open({ purpose: "search", request }, token, new HistoryReadBudget())
        .toString(),
    );
    if (done) break;
  }
  expect(done).toBe(true);
  expect(actual).toEqual(expected);
  expect(state!.previous.sha).toBe(
    createHash("sha256")
      .update(readFileSync(f.files.segmentPath(1)))
      .digest("hex"),
  );
});
