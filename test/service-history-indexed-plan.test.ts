/** Plan and review reads select a small retained text through its derived
 * indexes but verify original chunks and artifacts; the result must equal the
 * complete validated-prefix scan, which still answers without indexes. */
import { expect, it, vi } from "vitest";
import { loadAgentDefinitions } from "../src/agent-registry.ts";
import { HistoryFiles } from "../src/history/files.ts";
import { HistoryNavigation } from "../src/history/navigation.ts";
import { proposePlanContent } from "../src/history/plans.ts";
import { HistoryReader } from "../src/history/reader.ts";
import { fixture } from "./helpers/service-check-fixture.ts";

it("plan and review texts come from indexes, equal to the full-prefix scan", async () => {
  const f = await fixture();
  f.configure([f.check]);
  const taskId = await f.create(),
    saved = f.h.coordination.store.loadSnapshot(taskId)!;
  const plan = "Inspect and report.",
    role = loadAgentDefinitions().find((r) => r.role === "design-explorer")!;
  await f.submit({
    kind: "save-plan",
    taskId,
    plan,
    graph: {
      schema: "cadence-graph/2",
      taskId,
      taskKind: "code",
      taskRevision: saved.record.revision + 1,
      revision: 1,
      planRevision: 1,
      plan: proposePlanContent(plan, 1, []),
      assignments: [
        {
          id: "inspect",
          purpose: "research",
          instructions: "Inspect",
          expectedOutput: "Actual result",
          role: { role: "design-explorer", sha256: role.sha256 },
          model: f.selection,
          dependencies: [],
        },
      ],
    },
  });
  await f.actions.settled(taskId);
  const started = await f.submit({ kind: "start", taskId });
  await f.actions.scheduler.settled(started.runId!);
  await f.actions.settled(taskId);
  for (let i = 0; i < 2; i++) {
    const c = await f.submit({ kind: "check", taskId, check: f.check });
    await f.actions.scheduler.settled(c.runId!);
    await f.actions.settled(taskId);
  }
  const snapshot = f.h.writer.committedSeq,
    raw = f.h.coordination.store.loadSnapshot(taskId)!,
    current = {
      revision: raw.record.revision,
      identity: raw.identity,
      plan: raw.record.plan,
    };
  const reads = () => {
    const reader = HistoryReader.open(f.h.coordination)!;
    return {
      plan: reader.publishedPlan(taskId, snapshot),
      proven: reader.publishedPlan(taskId, snapshot, current),
      review: reader.reviewSelection(taskId, started.runId!, snapshot),
    };
  };
  const selected = vi.spyOn(HistoryReader.prototype, "selected"),
    scan = vi.spyOn(HistoryFiles.prototype, "scan");
  let indexed: ReturnType<typeof reads>;
  try {
    indexed = reads();
    // No complete-prefix selection or store scan when indexes exist.
    expect(selected).not.toHaveBeenCalled();
    expect(scan).not.toHaveBeenCalled();
  } finally {
    selected.mockRestore();
    scan.mockRestore();
  }
  expect(indexed.review.readablePlan).toBe(plan);
  expect(indexed.proven?.publication.identity).toBe(raw.identity);
  // A host stall far beyond the 100ms quantum inside every snapshot
  // validation: owner-internal reads are bounded by bytes, so nothing refuses.
  const snapshotOf = HistoryNavigation.prototype.snapshot;
  const stalled = vi
    .spyOn(HistoryNavigation.prototype, "snapshot")
    .mockImplementation(function (this: HistoryNavigation, ...args) {
      const until = performance.now() + 150;
      while (performance.now() < until);
      return Reflect.apply(snapshotOf, this, args);
    });
  try {
    const slow = reads();
    expect(slow.plan).toEqual(indexed.plan);
    expect(slow.proven).toEqual(indexed.proven);
    expect(slow.review.readablePlan).toBe(indexed.review.readablePlan);
  } finally {
    stalled.mockRestore();
  }
  // Without a content index (absent, or in-process hints disregarded), the
  // complete validated-prefix scan must answer identically.
  const absent = vi
    .spyOn(HistoryNavigation.prototype, "content")
    .mockReturnValue(undefined);
  const fallback = vi.spyOn(HistoryReader.prototype, "selected");
  try {
    const scanned = reads();
    expect(fallback).toHaveBeenCalled();
    expect(scanned.plan).toEqual(indexed.plan);
    expect(scanned.proven).toEqual(indexed.proven);
    expect(scanned.review.readablePlan).toBe(indexed.review.readablePlan);
    expect(scanned.review.graph).toEqual(indexed.review.graph);
  } finally {
    fallback.mockRestore();
    absent.mockRestore();
  }
}, 120000);
