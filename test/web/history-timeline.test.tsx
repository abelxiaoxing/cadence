// Pure timeline/read projection and SSR. No DOM/CSP/focus or native outcome evidence.
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type {
  HistoryRecord,
  RunProjection,
} from "../../src/service-contract.ts";
import { RunSummary } from "../../web/src/components/workspace/RunSummary";
import { emptySearchWindow } from "../../web/src/history/search-summary";
import { timelineBridge } from "../../web/src/timeline/timeline-adapter";
import type { TimelineData } from "../../web/src/timeline/timeline-client.mjs";
import { context, coverage, cursor, hash, id } from "./fixtures";

it("a zero-hit window with continuation is never search completion", () => {
  const seed = { ...cursor(), query: "needle" };
  expect(
    emptySearchWindow({
      cursor: seed,
      hits: [],
      next: { ...seed, offset: 4 },
      coverage,
    }),
  ).toContain("not finished");
  expect(
    emptySearchWindow({ cursor: seed, hits: [], next: null, coverage }),
  ).toContain("final retained window");
});
it("whole timeline bridge retains real worker-local clock domains without inventing overlap/duration", () => {
  const taskId = id(),
    runId = id(),
    epoch = id();
  const records: HistoryRecord[] = [9, 9000].map((ms, n) => ({
    kind: "capture-fact",
    recordId: id(),
    committedSeq: String(n + 1),
    link: { epoch, taskId, runId, childRunId: id() },
    capture: {
      source: { first: 1, last: 1, firstObservedMs: ms, lastObservedMs: ms },
      event: { kind: "ready", requestProtocol: 2 },
    },
  }));
  const received: TimelineData[] = [];
  let opened = 0,
    searches = 0;
  const bridge = timelineBridge(
    taskId,
    records,
    () => {
      opened++;
    },
    () => {
      searches++;
    },
  );
  const off = bridge.onData((value) => received.push(value));
  bridge.readState();
  bridge.readSegments(taskId);
  const value = received.find((data) => data.kind === "segs");
  if (value?.kind !== "segs") throw new Error("missing-segments");
  expect(value.segs.map((s) => s.t)).toEqual([0, 1000]);
  expect(value.segs.map((s) => s.dur)).toEqual([undefined, undefined]);
  expect(value.segs[0].clock).toContain("9–9 ms");
  expect(value.segs[1].clock).toContain("9000–9000 ms");
  expect(value.segs.every((s) => s.clock.includes("not aligned"))).toBe(true);
  bridge.readSegment(taskId, value.segs[0].key);
  bridge.openDetail(taskId, value.segs[1].key);
  bridge.searchHistory();
  expect(received.at(-1)).toMatchObject({ kind: "seg_detail" });
  expect(opened).toBe(1);
  expect(searches).toBe(1);
  const count = received.length;
  off();
  bridge.readState();
  expect(received).toHaveLength(count);
});
it("ported timeline has no dormant wall-clock/idle analysis or inline stylesheet", () => {
  const source = readFileSync("web/src/timeline/timeline-client.mjs", "utf8");
  expect(source).not.toMatch(
    /Date\.now|activeWindow|flowTick|flowLive|convToolMs|totalMs|<style>/,
  );
  expect(source).toContain("Local timeline vendor unavailable");
  for (const tab of ["overview", "preview", "raw", "source"])
    expect(source).toContain(`"${tab}"`);
  expect(source).toContain("stopPlay()");
  expect(source).toContain("off()");
});
it("unknown native outcomes stay unknown even in historical summaries", () => {
  const c = context();
  if (!c.task) throw new Error("fixture");
  const run: RunProjection = {
    taskId: c.task.id,
    runId: id(),
    childRunId: null,
    assignmentId: null,
    admission: {
      operationId: id(),
      commandId: id(),
      kind: "start",
      context: c,
      assignments: [{ assignmentId: "inspect", childRunId: id() }],
      graph: { recordId: id(), revision: 1, sha256: hash },
    },
    lifecycle: "settled",
    outcome: "unknown",
    settlement: null,
    reason: null,
    publication: "uncertain",
    coverage,
    result: null,
  };
  const html = renderToStaticMarkup(<RunSummary run={run} historical />);
  expect(html).toContain("unknown");
  expect(html).toContain("No settlement recorded");
  expect(html).toContain("historical projection");
  expect(html).not.toContain("completed");
});
