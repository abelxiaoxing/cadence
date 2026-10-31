/** Real directory reads with fabricated run IDs; no execution or data migration. */
import { randomUUID } from "node:crypto";
import {
  Dir,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  decodeWorkbenchRead,
  decodeWorkbenchResult,
} from "../src/service/contracts/workbench.ts";
import { WORKFLOW_LIMITS } from "../src/service/contracts/workflow.ts";
import {
  WorkflowHistoryScanner,
  type WorkflowHistorySelection,
} from "../src/service/workflow-history.ts";

const scanners: WorkflowHistoryScanner[] = [];
afterEach(() => {
  for (const scanner of scanners.splice(0)) scanner.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function fixture(count: number) {
  const path = join(mkdtempSync(join(tmpdir(), "workflow-list-")), "runs");
  mkdirSync(path, { mode: 0o700 });
  const ids = Array.from(
    { length: count },
    (_, n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  );
  for (const id of [...ids].reverse())
    mkdirSync(join(path, id), { mode: 0o700 });
  const scanner = new WorkflowHistoryScanner(path, () => existsSync(path));
  scanners.push(scanner);
  return { scanner, ids, path };
}
function page(
  scanner: WorkflowHistoryScanner,
  after: string | null,
  count: number,
) {
  let value: WorkflowHistorySelection = scanner.read(after),
    progress = 0;
  while (value.kind === "workflow-history-progress") {
    expect(value.after).toBe(after);
    expect(++progress).toBeLessThanOrEqual(
      Math.floor(count / WORKFLOW_LIMITS.historyScanEntries),
    );
    value = scanner.read(after, value.scan);
  }
  return value;
}
it.each([200, 201, 501])(
  "lists all %i IDs in bounded sorted pages without a lifetime record cap",
  (count) => {
    const { scanner, ids, path } = fixture(count);
    const result: string[] = [];
    let after: string | null = null;
    do {
      const p = page(scanner, after, count);
      expect(p.ids.length).toBeLessThanOrEqual(WORKFLOW_LIMITS.historyPage);
      result.push(...p.ids);
      after = p.next;
    } while (after !== null);
    expect(result).toEqual(ids);
    expect(readdirSync(path).sort()).toEqual(ids);
  },
);
it("limits each read quantum and consumes continuations without accepting an altered ID boundary", () => {
  const { scanner } = fixture(501);
  const reads = vi.spyOn(Dir.prototype, "readSync");
  const first = scanner.read(null);
  expect(reads).toHaveBeenCalledTimes(WORKFLOW_LIMITS.historyScanEntries);
  if (first.kind !== "workflow-history-progress")
    throw Error("expected progress");
  expect(() => scanner.read(randomUUID(), first.scan)).toThrow("stale");
  const second = scanner.read(null, first.scan);
  expect(reads).toHaveBeenCalledTimes(2 * WORKFLOW_LIMITS.historyScanEntries);
  expect(second.kind).toBe("workflow-history-progress");
  expect(() => scanner.read(null, first.scan)).toThrow("stale");
  expect(() => scanner.read(null, randomUUID())).toThrow("stale");
});
it("bounds open scans, expires only its readonly handles, and refuses expired cursors", () => {
  vi.useFakeTimers();
  const { scanner, ids, path } = fixture(201);
  const close = vi.spyOn(Dir.prototype, "closeSync");
  const pending = Array.from({ length: WORKFLOW_LIMITS.historyScans }, () =>
    scanner.read(null),
  );
  expect(() => scanner.read(null)).toThrow("capacity");
  vi.advanceTimersByTime(WORKFLOW_LIMITS.historyIdleMs);
  expect(close).toHaveBeenCalledTimes(WORKFLOW_LIMITS.historyScans);
  for (const p of pending) {
    if (p.kind !== "workflow-history-progress")
      throw Error("expected progress");
    expect(() => scanner.read(null, p.scan)).toThrow("stale");
  }
  expect(scanner.read(null).kind).toBe("workflow-history-progress");
  expect(readdirSync(path).sort()).toEqual(ids);
  scanner.close();
  expect(close).toHaveBeenCalledTimes(WORKFLOW_LIMITS.historyScans + 1);
  expect(() => scanner.read(null)).toThrow("unavailable");
});
it("directory replacement refuses continuation and closes the original handle without touching either directory", () => {
  const { scanner, ids, path } = fixture(201);
  const first = scanner.read(null);
  if (first.kind !== "workflow-history-progress")
    throw Error("expected progress");
  renameSync(path, `${path}-original`);
  mkdirSync(path, { mode: 0o700 });
  const close = vi.spyOn(Dir.prototype, "closeSync");
  expect(() => scanner.read(null, first.scan)).toThrow("stale");
  expect(close).toHaveBeenCalledTimes(1);
  expect(readdirSync(`${path}-original`).sort()).toEqual(ids);
  expect(readdirSync(path)).toEqual([]);
});
it("unsafe entries refuse, never become an empty page or get removed", () => {
  const { scanner, path } = fixture(1);
  writeFileSync(join(path, "unexpected"), "preserve", { mode: 0o600 });
  expect(() => scanner.read(null)).toThrow("corrupt-selected");
  expect(readdirSync(path)).toContain("unexpected");
});
it("the closed codec distinguishes progress from a complete page and never invokes cursor getters", () => {
  const scan = randomUUID();
  expect(
    decodeWorkbenchRead({ kind: "workflow-history", after: null, scan }),
  ).toEqual({ kind: "workflow-history", after: null, scan });
  expect(
    decodeWorkbenchResult({
      kind: "workflow-history-progress",
      after: null,
      scan,
    }),
  ).toEqual({ kind: "workflow-history-progress", after: null, scan });
  for (const input of [
    { kind: "workflow-history-progress", after: null, scan, entries: [] },
    { kind: "workflow-history-progress", after: null, scan: null },
  ])
    expect(() => decodeWorkbenchResult(input)).toThrow();
  const getter = vi.fn(() => scan);
  expect(() =>
    decodeWorkbenchRead({
      kind: "workflow-history",
      after: null,
      get scan() {
        return getter();
      },
    }),
  ).toThrow();
  expect(getter).not.toHaveBeenCalled();
});
