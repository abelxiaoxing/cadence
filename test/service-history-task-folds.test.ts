/** The owner-process memory of task fold states is an accelerator: resumed
 * folds must equal the original chain fold, and any miss folds that chain.
 * Folds are owner-internal reads, so they use the bytes-only authority budget
 * like their production callers; only the exhaustion case uses the clock. */
import { expect, it, vi } from "vitest";
import { loadAgentDefinitions } from "../src/agent-registry.ts";
import { CheckFold, checkFold } from "../src/history/checks.ts";
import { HistoryReadBudget } from "../src/history/files.ts";
import { HistoryNavigation } from "../src/history/navigation.ts";
import { proposePlanContent } from "../src/history/plans.ts";
import { latestTaskRun } from "../src/history/reader.ts";
import { taskFoldMemory } from "../src/history/task-folds.ts";
import { type ControlContext, publicError } from "../src/service-contract.ts";
import { fixture } from "./helpers/service-check-fixture.ts";

type Fixture = Awaited<ReturnType<typeof fixture>>;
const unavailable = (f: Fixture, taskId: string): ControlContext => ({
  status: "unavailable",
  workspaceId: f.h.reader.files.format.workspaceId,
  taskId,
  error: publicError("unavailable"),
});
/** The original chain fold, never consulting the memory. */
function original(f: Fixture, taskId: string, snapshot: string): CheckFold {
  const budget = HistoryReadBudget.authority(),
    navigation = new HistoryNavigation(f.h.reader.files);
  navigation.snapshot(snapshot, budget);
  const fold = new CheckFold();
  for (const b of navigation.entityBatches(taskId, snapshot, budget) ?? [])
    fold.apply(b, taskId);
  return fold;
}
function suffix(f: Fixture, taskId: string, snapshot: string) {
  const files = f.h.reader.files,
    budget = HistoryReadBudget.authority(),
    navigation = new HistoryNavigation(files);
  navigation.snapshot(snapshot, budget);
  return navigation.taskSuffix(
    taskId,
    snapshot,
    budget,
    (head) => taskFoldMemory(files).recall(taskId, head)?.checks,
  );
}
/** The task's chain links at `snapshot`, newest first. */
function heads(f: Fixture, taskId: string, snapshot: string) {
  const budget = HistoryReadBudget.authority(),
    navigation = new HistoryNavigation(f.h.reader.files),
    links: { seq: string; hash: string }[] = [];
  navigation.snapshot(snapshot, budget);
  navigation.taskSuffix(taskId, snapshot, budget, (head) => {
    links.push(head);
    return undefined;
  });
  return links;
}
/** Push every remembered state of the task out of its bounded memory. */
function evict(f: Fixture, taskId: string, state: object) {
  const memory = taskFoldMemory(f.h.reader.files);
  for (let i = 0; i < 8; i++)
    memory.remember(
      taskId,
      { seq: String(9_000_000_000 + i), hash: "0".repeat(64) },
      state as never,
    );
}
async function checked(f: Fixture, taskId: string, times: number) {
  const snapshots: string[] = [];
  for (let i = 0; i < times; i++) {
    const r = await f.submit({ kind: "check", taskId, check: f.check });
    await f.actions.scheduler.settled(r.runId!);
    await f.actions.settled(taskId);
    snapshots.push(f.h.writer.committedSeq);
  }
  return snapshots;
}

it("a resumed check fold equals the original chain fold at every snapshot, reading only newer batches", async () => {
  const f = await fixture();
  f.configure([f.check]);
  const taskId = await f.create();
  const snapshots = await checked(f, taskId, 3);
  expect(taskFoldMemory(f.h.reader.files).has(taskId)).toBe(true);
  const configured = { revision: 1, selections: [f.check] };
  for (const snapshot of snapshots) {
    const resumed = checkFold(
      f.h.reader.files,
      taskId,
      snapshot,
      HistoryReadBudget.authority(),
    );
    const full = original(f, taskId, snapshot);
    expect(resumed.state()).toEqual(full.state());
    expect(
      resumed.evaluate(taskId, configured, unavailable(f, taskId)),
    ).toEqual(full.evaluate(taskId, configured, unavailable(f, taskId)));
  }
  const last = snapshots.at(-1)!;
  const tail = suffix(f, taskId, last);
  expect(tail?.base).toBeDefined();
  const budget = HistoryReadBudget.authority(),
    navigation = new HistoryNavigation(f.h.reader.files);
  navigation.snapshot(last, budget);
  const chain = navigation.entityBatches(taskId, last, budget) ?? [];
  // Only batches after the newest remembered state, not the whole history.
  expect(tail!.batches.length).toBeLessThan(chain.length / 2);
  expect(tail!.batches.map((b) => b.pointer.seq)).toEqual(
    chain.slice(chain.length - tail!.batches.length).map((b) => b.pointer.seq),
  );
}, 120000);

it("a remembered state is used only under its exact chain link; a miss folds the original chain", async () => {
  const f = await fixture();
  f.configure([f.check]);
  const taskId = await f.create();
  const [, , last] = await checked(f, taskId, 3);
  const expected = original(f, taskId, last).state();
  const resumed = () =>
    checkFold(
      f.h.reader.files,
      taskId,
      last,
      HistoryReadBudget.authority(),
    ).state();
  expect(resumed()).toEqual(expected);
  const memory = taskFoldMemory(f.h.reader.files),
    [head] = heads(f, taskId, last),
    real = memory.recall(taskId, head)!;
  expect(real).toBeDefined();
  const wrong = { ...real, checks: { starts: [], settled: [] } };
  // Same seq, another chain hash (a diverged chain): ignored.
  memory.remember(taskId, { seq: head.seq, hash: "f".repeat(64) }, wrong);
  expect(resumed()).toEqual(expected);
  // Positive control: under its exact link the memory really is consulted,
  // which is why only the owner's own writer remembers states.
  memory.remember(taskId, head, wrong);
  expect(resumed()).not.toEqual(expected);
  memory.remember(taskId, head, real);
  expect(resumed()).toEqual(expected);
  // Evicted past its bound: the original chain answers.
  evict(f, taskId, real);
  expect(suffix(f, taskId, last)).toBeUndefined();
  expect(resumed()).toEqual(expected);
}, 120000);

it("an older snapshot resumes from an older remembered state, never a newer one", async () => {
  const f = await fixture();
  f.configure([f.check]);
  const taskId = await f.create();
  const [first, , last] = await checked(f, taskId, 3);
  expect(BigInt(first)).toBeLessThan(BigInt(last));
  const tail = suffix(f, taskId, first);
  for (const b of tail?.batches ?? [])
    expect(BigInt(b.pointer.seq)).toBeLessThanOrEqual(BigInt(first));
  expect(
    checkFold(
      f.h.reader.files,
      taskId,
      first,
      HistoryReadBudget.authority(),
    ).state(),
  ).toEqual(original(f, taskId, first).state());
}, 120000);

it("exhaustion while resuming stays inconclusive, never a silent fold", async () => {
  const f = await fixture();
  f.configure([f.check]);
  const taskId = await f.create();
  const [last] = await checked(f, taskId, 1);
  const budget = new HistoryReadBudget(),
    now = performance.now();
  const clock = vi.spyOn(performance, "now").mockReturnValue(now + 60_000);
  try {
    expect(() => checkFold(f.h.reader.files, taskId, last, budget)).toThrow(
      "receipt-inconclusive",
    );
  } finally {
    clock.mockRestore();
  }
}, 120000);

it("a resumed latest-run fold equals the original chain at every snapshot across Starts and checks", async () => {
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
  const snapshots: string[] = [f.h.writer.committedSeq];
  const runs: string[] = [];
  for (let i = 0; i < 2; i++) {
    const started = await f.submit({ kind: "start", taskId });
    await f.actions.scheduler.settled(started.runId!);
    await f.actions.settled(taskId);
    runs.push(started.runId!);
    snapshots.push(f.h.writer.committedSeq);
    snapshots.push(...(await checked(f, taskId, 1)));
  }
  const originalLatest = (snapshot: string) => {
    const budget = HistoryReadBudget.authority(),
      navigation = new HistoryNavigation(f.h.reader.files);
    navigation.snapshot(snapshot, budget);
    let latest: string | null = null;
    for (const b of navigation.entityBatches(taskId, snapshot, budget) ?? [])
      for (const row of b.rows) {
        const v = row.value;
        if (
          v.kind === "admission" &&
          v.intent.identity.kind === "action" &&
          v.intent.identity.expected.task?.id === taskId &&
          (v.intent.identity.action.kind === "start" ||
            v.intent.identity.action.kind === "generate-plan")
        )
          latest = v.intent.runId;
      }
    return latest;
  };
  for (const snapshot of snapshots)
    expect(
      latestTaskRun(
        f.h.reader.files,
        taskId,
        snapshot,
        HistoryReadBudget.authority(),
      ),
    ).toBe(originalLatest(snapshot));
  expect(
    latestTaskRun(
      f.h.reader.files,
      taskId,
      snapshots.at(-1)!,
      HistoryReadBudget.authority(),
    ),
  ).toBe(runs.at(-1));
  // The newest remembered state carries the run part, so the suffix stays short.
  const tail = suffix(f, taskId, snapshots.at(-1)!);
  expect(tail?.base).toBeDefined();
}, 180000);

it("a resumed plan fold proves the same published plan as the original chain, with and without a current plan", async () => {
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
  const points: { snapshot: string; current: ReturnType<typeof current> }[] =
    [];
  function current() {
    const s = f.h.coordination.store.loadSnapshot(taskId)!;
    return {
      revision: s.record.revision,
      identity: s.identity,
      plan: s.record.plan,
    };
  }
  points.push({ snapshot: f.h.writer.committedSeq, current: current() });
  for (let i = 0; i < 2; i++) {
    const started = await f.submit({ kind: "start", taskId });
    await f.actions.scheduler.settled(started.runId!);
    await f.actions.settled(taskId);
    points.push({ snapshot: f.h.writer.committedSeq, current: current() });
    await checked(f, taskId, 1);
    points.push({ snapshot: f.h.writer.committedSeq, current: current() });
  }
  const outcome = (snapshot: string, proof?: ReturnType<typeof current>) => {
    try {
      return { value: f.h.reader.publishedPlan(taskId, snapshot, proof) };
    } catch (error) {
      return { error: (error as { code?: string }).code ?? String(error) };
    }
  };
  const resumed = points.map((p) => [
    outcome(p.snapshot),
    outcome(p.snapshot, p.current),
  ]);
  expect(resumed.at(-1)?.[1]).toHaveProperty("value.publication");
  const tail = suffix(f, taskId, points.at(-1)!.snapshot);
  expect(tail?.base).toBeDefined();
  const last = points.at(-1)!;
  const reads = () => {
    const batch = vi.spyOn(HistoryNavigation.prototype, "batch");
    try {
      outcome(last.snapshot, last.current);
      return batch.mock.calls.length;
    } finally {
      batch.mockRestore();
    }
  };
  const resumedReads = reads();
  // Evict every remembered state: the original chain fold must agree exactly.
  const memory = taskFoldMemory(f.h.reader.files);
  evict(f, taskId, memory.recall(taskId, heads(f, taskId, last.snapshot)[0])!);
  expect(
    points.map((p) => [outcome(p.snapshot), outcome(p.snapshot, p.current)]),
  ).toEqual(resumed);
  // The remembered proof really resumed: far fewer original batch reads.
  expect(resumedReads * 2).toBeLessThan(reads());
}, 180000);
