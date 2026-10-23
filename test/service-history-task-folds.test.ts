/** Writer-issued task fold checkpoints are an accelerator: resumed folds must
 * equal the original chain fold, and any untrusted checkpoint is ignored. */
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { loadAgentDefinitions } from "../src/agent-registry.ts";
import {
  CheckFold,
  checkFold,
  decodeCheckFoldState,
} from "../src/history/checks.ts";
import { HistoryReadBudget } from "../src/history/files.ts";
import { HistoryNavigation } from "../src/history/navigation.ts";
import { proposePlanContent } from "../src/history/plans.ts";
import { latestTaskRun } from "../src/history/reader.ts";
import { openTaskFold } from "../src/history/task-folds.ts";
import { type ControlContext, publicError } from "../src/service-contract.ts";
import { fixture } from "./helpers/service-check-fixture.ts";

type Fixture = Awaited<ReturnType<typeof fixture>>;
const unavailable = (f: Fixture, taskId: string): ControlContext => ({
  status: "unavailable",
  workspaceId: f.h.reader.files.format.workspaceId,
  taskId,
  error: publicError("unavailable"),
});
/** The original chain fold, never consulting a checkpoint. */
function original(f: Fixture, taskId: string, snapshot: string): CheckFold {
  const budget = new HistoryReadBudget(),
    navigation = new HistoryNavigation(f.h.reader.files);
  navigation.snapshot(snapshot, budget);
  const fold = new CheckFold();
  for (const b of navigation.entityBatches(taskId, snapshot, budget) ?? [])
    fold.apply(b, taskId);
  return fold;
}
function suffix(f: Fixture, taskId: string, snapshot: string) {
  const files = f.h.reader.files,
    budget = new HistoryReadBudget(),
    navigation = new HistoryNavigation(files);
  navigation.snapshot(snapshot, budget);
  return navigation.taskSuffix(taskId, snapshot, budget, (value, head) => {
    const body = openTaskFold(files, value, taskId, head, budget);
    return body && decodeCheckFoldState(body.checks);
  });
}
const folds = (f: Fixture, taskId: string) =>
  join(f.h.reader.files.directory, "indexes", "task-folds", taskId);
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
  expect(readdirSync(folds(f, taskId)).length).toBeGreaterThan(0);
  const configured = { revision: 1, selections: [f.check] };
  for (const snapshot of snapshots) {
    const resumed = checkFold(
      f.h.reader.files,
      taskId,
      snapshot,
      new HistoryReadBudget(),
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
  const budget = new HistoryReadBudget(),
    navigation = new HistoryNavigation(f.h.reader.files);
  navigation.snapshot(last, budget);
  const chain = navigation.entityBatches(taskId, last, budget) ?? [];
  // Only batches after the newest checkpoint, not the task's whole history.
  expect(tail!.batches.length).toBeLessThan(chain.length / 2);
  expect(tail!.batches.map((b) => b.pointer.seq)).toEqual(
    chain.slice(chain.length - tail!.batches.length).map((b) => b.pointer.seq),
  );
}, 120000);

it("a changed, unauthenticated, moved or foreign checkpoint is ignored and the original fold answers", async () => {
  const f = await fixture();
  f.configure([f.check]);
  const taskId = await f.create(),
    other = await f.create();
  const [, , last] = await checked(f, taskId, 3);
  const dir = folds(f, taskId);
  const names = readdirSync(dir).sort((a, b) =>
    Number(BigInt(a.slice(0, -5)) - BigInt(b.slice(0, -5))),
  );
  const newest = join(dir, names.at(-1)!),
    bytes = readFileSync(newest);
  const expected = original(f, taskId, last).state();
  const resumedEquals = () =>
    expect(
      checkFold(
        f.h.reader.files,
        taskId,
        last,
        new HistoryReadBudget(),
      ).state(),
    ).toEqual(expected);
  const record = JSON.parse(bytes.toString("utf8"));
  const tamper = (change: (r: typeof record) => void) => {
    const copy = structuredClone(record);
    change(copy);
    writeFileSync(newest, `${JSON.stringify(copy)}\n`);
  };
  // Changed state under the original MAC.
  tamper((r) => {
    r.body.checks.settled[0][1].status = "failed";
  });
  resumedEquals();
  // The walk passed the rejected checkpoint's own batch.
  const past = suffix(f, taskId, last);
  expect(
    past === undefined ||
      past.batches.some((b) => b.pointer.seq === record.seq),
  ).toBe(true);
  // An unauthenticated MAC.
  tamper((r) => {
    r.mac = Buffer.alloc(32, 1).toString("base64url");
  });
  resumedEquals();
  writeFileSync(newest, bytes);
  resumedEquals();
  const seqs = (id: string, snapshot: string) => {
    const budget = new HistoryReadBudget(),
      navigation = new HistoryNavigation(f.h.reader.files);
    navigation.snapshot(snapshot, budget);
    return (navigation.entityBatches(id, snapshot, budget) ?? []).map(
      (b) => b.pointer.seq,
    );
  };
  // Moved within the task: placed at an older checkpoint-free seq, read there.
  const have = new Set(names.map((n) => n.slice(0, -5)));
  const older = seqs(taskId, last)
    .reverse()
    .find((s) => !have.has(s) && BigInt(s) < BigInt(record.seq));
  expect(older).toBeDefined();
  writeFileSync(join(dir, `${older}.json`), bytes, { mode: 0o600, flag: "wx" });
  expect(
    checkFold(
      f.h.reader.files,
      taskId,
      older!,
      new HistoryReadBudget(),
    ).state(),
  ).toEqual(original(f, taskId, older!).state());
  const moved = suffix(f, taskId, older!);
  expect(
    moved === undefined || moved.batches.some((b) => b.pointer.seq === older),
  ).toBe(true);
  // Copied to another task at that task's own head: foreign, so ignored there.
  const head = seqs(other, last).at(-1)!;
  mkdirSync(folds(f, other), { recursive: true, mode: 0o700 });
  writeFileSync(join(folds(f, other), `${head}.json`), bytes, {
    mode: 0o600,
  });
  expect(
    checkFold(f.h.reader.files, other, last, new HistoryReadBudget()).state(),
  ).toEqual(original(f, other, last).state());
  const foreign = suffix(f, other, last);
  expect(
    foreign === undefined ||
      foreign.batches.some((b) => b.pointer.seq === head),
  ).toBe(true);
}, 120000);

it("an older snapshot resumes from an older checkpoint, never a newer one", async () => {
  const f = await fixture();
  f.configure([f.check]);
  const taskId = await f.create();
  const [first, , last] = await checked(f, taskId, 3);
  expect(BigInt(first)).toBeLessThan(BigInt(last));
  const tail = suffix(f, taskId, first);
  for (const b of tail?.batches ?? [])
    expect(BigInt(b.pointer.seq)).toBeLessThanOrEqual(BigInt(first));
  expect(
    checkFold(f.h.reader.files, taskId, first, new HistoryReadBudget()).state(),
  ).toEqual(original(f, taskId, first).state());
}, 120000);

it("exhaustion while reading a checkpoint stays inconclusive, never a silent fold", async () => {
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
    const budget = new HistoryReadBudget(),
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
        new HistoryReadBudget(),
      ),
    ).toBe(originalLatest(snapshot));
  expect(
    latestTaskRun(
      f.h.reader.files,
      taskId,
      snapshots.at(-1)!,
      new HistoryReadBudget(),
    ),
  ).toBe(runs.at(-1));
  // The newest checkpoint carries the run part, so the suffix stays short.
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
  // Hide every checkpoint: the original chain fold must agree exactly.
  const dir = folds(f, taskId);
  renameSync(dir, `${dir}.hidden`);
  try {
    expect(
      points.map((p) => [outcome(p.snapshot), outcome(p.snapshot, p.current)]),
    ).toEqual(resumed);
    // The checkpointed proof really resumed: far fewer original batch reads.
    expect(resumedReads * 2).toBeLessThan(reads());
  } finally {
    renameSync(`${dir}.hidden`, dir);
  }
}, 180000);
