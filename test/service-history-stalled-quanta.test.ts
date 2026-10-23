/** A host stall (GC, scheduling, scanning) longer than one read quantum must not
 * refuse a read that would otherwise progress; a read that never progresses
 * still refuses, and byte exhaustion is never repeated. */
import { expect, it, vi } from "vitest";
import {
  HistoryReadBudget,
  noProgress,
  retryStalled,
  STALL_RETRIES,
  StalledQuantum,
} from "../src/history/files.ts";
import { RetainedScan } from "../src/history/search.ts";
import {
  ContractError,
  type ExportRequest,
  LIMITS,
  type ReadCursor,
} from "../src/service-contract.ts";
import { historyFixture } from "./helpers/history-fixture.ts";
import {
  detailPage,
  readProjection,
  retainedText,
  searchSeed,
} from "./helpers/history-read-fixture.ts";

type Fixture = ReturnType<typeof historyFixture>;
/** One synchronous pause longer than a whole quantum. */
function stall(): void {
  const until = performance.now() + LIMITS.searchMs + 10;
  while (performance.now() < until);
}
/** Stall right after each selected `prepare`, before any progress is made. */
function stallAfterPrepare(stalled: (call: number) => boolean) {
  const original = RetainedScan.prototype.prepare;
  let call = 0;
  return vi
    .spyOn(RetainedScan.prototype, "prepare")
    .mockImplementation(function (this: RetainedScan, ...args) {
      const result = Reflect.apply(original, this, args);
      if (stalled(++call)) stall();
      return result;
    });
}
async function exported(f: Fixture) {
  const input: ExportRequest = {
    storeId: f.files.format.storeId,
    scope: { kind: "task", id: f.link.taskId },
    snapshotSeq: f.writer.committedSeq,
    format: "ndjson",
  };
  const events: string[] = [];
  // Each export has its own stream digest; everything else must match.
  for await (const raw of readProjection(f).export(
    input,
    new AbortController().signal,
  ))
    events.push(JSON.stringify({ ...raw.event, sha256: undefined }));
  return events;
}

it("only a pure time stall is repeatable, at most STALL_RETRIES times", async () => {
  const budget = new HistoryReadBudget();
  const thrown = (fn: () => void) => {
    try {
      fn();
    } catch (error) {
      return error;
    }
  };
  // Within its time: an ordinary, final refusal.
  const final = thrown(() => noProgress(budget));
  expect(final).toBeInstanceOf(ContractError);
  expect(final).not.toBeInstanceOf(StalledQuantum);
  const now = performance.now(),
    clock = vi.spyOn(performance, "now").mockReturnValue(now + 60_000);
  try {
    const stalled = thrown(() => noProgress(budget));
    expect(stalled).toBeInstanceOf(StalledQuantum);
    expect((stalled as ContractError).code).toBe("receipt-inconclusive");
  } finally {
    clock.mockRestore();
  }
  let calls = 0;
  await expect(
    retryStalled(async () => {
      calls++;
      throw new StalledQuantum();
    }),
  ).rejects.toThrow("receipt-inconclusive");
  expect(calls).toBe(STALL_RETRIES + 1);
  calls = 0;
  await expect(
    retryStalled(async () => {
      calls++;
      throw new ContractError("receipt-inconclusive");
    }),
  ).rejects.toThrow("receipt-inconclusive");
  expect(calls).toBe(1);
  calls = 0;
  expect(
    await retryStalled(async () => {
      if (++calls === 1) throw new StalledQuantum();
      return "page";
    }),
  ).toBe("page");
  expect(calls).toBe(2);
});

it("one stalled quantum no longer refuses an export or a detail page", async () => {
  const f = historyFixture(),
    saved = await retainedText(f, "x".repeat(400000));
  const expected = await exported(f);
  const cursor: ReadCursor = {
    ...searchSeed(f, "x"),
    query: null,
    recordId: saved.content.recordId,
    recordVersion: 1,
    field: "plan",
  };
  const page = await detailPage(readProjection(f), cursor);
  // Call 1 proves the snapshot; call 2 opens the export's first scan quantum.
  const once = stallAfterPrepare((call) => call === 2);
  try {
    expect(await exported(f)).toEqual(expected);
  } finally {
    once.mockRestore();
  }
  const again = stallAfterPrepare((call) => call === 1);
  try {
    expect(await detailPage(readProjection(f), cursor)).toEqual(page);
  } finally {
    again.mockRestore();
  }
}, 30000);

it("a read that never progresses still refuses after bounded fresh quanta", async () => {
  const f = historyFixture();
  await retainedText(f, "x".repeat(400000));
  const always = stallAfterPrepare(() => true);
  try {
    await expect(exported(f)).rejects.toThrow("receipt-inconclusive");
    // The initial quantum plus at most STALL_RETRIES repeats per stalled step.
    expect(always.mock.calls.length).toBeLessThanOrEqual(
      2 * (STALL_RETRIES + 1),
    );
  } finally {
    always.mockRestore();
  }
}, 30000);

it("owner-internal authority reads are bounded by bytes, never by a stalled clock", () => {
  const cooperative = new HistoryReadBudget(),
    authority = HistoryReadBudget.authority();
  const now = performance.now(),
    clock = vi.spyOn(performance, "now").mockReturnValue(now + 60_000);
  try {
    expect(cooperative.elapsed).toBe(true);
    expect(() => cooperative.reserve(0)).toThrow("receipt-inconclusive");
    expect(authority.elapsed).toBe(false);
    expect(() => authority.reserve(1024)).not.toThrow();
    // Bytes remain a deterministic bound.
    expect(() => authority.reserve(LIMITS.searchBytes)).toThrow(
      "receipt-inconclusive",
    );
  } finally {
    clock.mockRestore();
  }
});
