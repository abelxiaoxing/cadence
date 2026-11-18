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

it("carries the observed tool name into the shared list, legend and lane palette", () => {
  const ids = { taskId: id(), runId: id(), childRunId: id(), epoch: id() };
  const facts: HistoryRecord[] = ["read", "write", "read"].map((name, n) => ({
    kind: "capture-fact",
    recordId: id(),
    committedSeq: String(n + 1),
    link: ids,
    capture: {
      source: {
        first: n + 1,
        last: n + 1,
        firstObservedMs: n,
        lastObservedMs: n,
      },
      event: {
        kind: "tool-start",
        name,
        callId: id(),
        argsDetailId: null,
        source: { disposition: "unavailable", value: null },
        declaration: null,
      },
    },
  }));
  const bridge = timelineBridge(
    ids.taskId,
    facts,
    () => {},
    () => {},
  );
  const messages: TimelineData[] = [];
  bridge.onData((data) => messages.push(data));
  bridge.readSegments(ids.taskId);
  const message = messages[0];
  expect(
    message.kind === "segs" && message.segs.map((s) => s.meta?.tool),
  ).toEqual(["read", "write", "read"]);
});

it("attributes updates only to a unique named endpoint on this page for the same epoch, run, worker and call", () => {
  type Capture = Extract<HistoryRecord, { kind: "capture-fact" }>;
  const link = { taskId: id(), runId: id(), childRunId: id(), epoch: id() };
  const other = { ...link, childRunId: id() };
  const shared = id(),
    noName = id(),
    conflict = id();
  const facts: Capture[] = [];
  const fact = (event: Capture["capture"]["event"], scope = link) => {
    const n = facts.length + 1;
    facts.push({
      kind: "capture-fact",
      committedSeq: String(n),
      recordId: id(),
      link: scope,
      capture: {
        event,
        source: { first: n, last: n, firstObservedMs: n, lastObservedMs: n },
      },
    });
  };
  const source = { disposition: "unavailable" as const, value: null };
  const start = (callId: string, name: string) => ({
    kind: "tool-start" as const,
    callId,
    name,
    argsDetailId: null,
    declaration: null,
    source,
  });
  const end = (callId: string, name: string) => ({
    kind: "tool-end" as const,
    callId,
    name,
    resultDetailId: id(),
    declaration: null,
    source,
    isError: false,
    association: "execution-only" as const,
    startObserved: true,
  });
  const update = (callId: string) => ({
    kind: "tool-update" as const,
    callId,
    semantics: "snapshot" as const,
    detailId: id(),
  });
  fact(start(shared, "read"));
  fact(update(shared));
  fact(end(shared, "read"));
  fact(update(shared), other); // Only the later end is loaded.
  fact(end(shared, "write"), other);
  fact(update(shared), { ...link, epoch: id() });
  fact(update(shared), { ...link, runId: id() });
  fact(update(noName));
  fact(start(conflict, "read"));
  fact(update(conflict));
  fact(end(conflict, "write"));
  const original = structuredClone(facts);
  const bridge = timelineBridge(
    link.taskId,
    facts,
    () => {},
    () => {},
  );
  const messages: TimelineData[] = [];
  bridge.onData((data) => messages.push(data));
  bridge.readSegments(link.taskId);
  const message = messages[0];
  if (message.kind !== "segs") throw Error("missing-segments");
  expect(message.segs.map((s) => s.meta?.tool)).toEqual([
    "read",
    "read",
    "read",
    "write",
    "write",
    undefined,
    undefined,
    undefined,
    "read",
    undefined,
    "write",
  ]);
  expect(message.segs.map((s) => s.key)).toEqual(
    original.map((f) => f.recordId),
  );
  expect(facts).toEqual(original);
});
