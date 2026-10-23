/** Scripted human decisions, real SDK/native shell/disk; not physical-human/UI evidence. */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { loadAgentDefinitions } from "../src/agent-registry.ts";
import { proposePlanContent } from "../src/history/plans.ts";
import { HistoryProjection } from "../src/history/projection.ts";
import { HistoryReader } from "../src/history/reader.ts";
import { readRunState } from "../src/history/run-state.ts";
import {
  type Action,
  encodeExportFrame,
  type ListRequest,
  type ReadCursor,
} from "../src/service-contract.ts";
import { fixture, natives } from "./helpers/service-check-fixture.ts";

type Fixture = Awaited<ReturnType<typeof fixture>>;
async function start(f: Fixture) {
  const taskId = await f.create(),
    saved = f.h.coordination.store.loadSnapshot(taskId)!;
  const plan = "Inspect and report; human review is separate.",
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
  const receipt = await f.submit({ kind: "start", taskId });
  await f.actions.scheduler.settled(receipt.runId!);
  // The run settling precedes its task publication; wait for the original too.
  await f.actions.settledAll();
  return { taskId, runId: receipt.runId!, receipt };
}
async function checked(f: Fixture, taskId: string) {
  const r = await f.submit({ kind: "check", taskId, check: f.check });
  await f.actions.scheduler.settled(r.runId!);
  return r;
}
async function review(
  f: Fixture,
  taskId: string,
  runId: string,
  acceptIssues: boolean,
) {
  const probe: Extract<Action, { kind: "review" }> = {
    kind: "review",
    taskId,
    runId,
    acceptIssues,
    changesIdentity: "0".repeat(64),
    checksRevision: 0,
  };
  const preview = await f.actions.observe(probe);
  const action = {
    ...probe,
    changesIdentity: preview.version.observation.identity,
    checksRevision: preview.checksRevision,
  };
  return { action, preview: await f.actions.observe(action) };
}
it("real SDK + actual passing check + Review: metadata-only Done preserves execution and cold own-publication graph", async () => {
  const f = await fixture();
  f.configure([f.check]);
  const { taskId, runId, receipt } = await start(f);
  const checkedReceipt = await checked(f, taskId);
  const before = f.h.coordination.store.loadSnapshot(taskId)!;
  expect(f.h.writer.accounting.episodes.count).toBe(0);
  const cold = HistoryReader.open(f.h.coordination)!;
  expect(
    cold.publishedPlan(taskId, f.h.writer.committedSeq, {
      ...before.record,
      identity: before.identity,
    })?.graph.assignments,
  ).toHaveLength(1);
  const selected = await review(f, taskId, runId, false);
  expect(selected.preview.issues).toEqual([]);
  const count = natives.length;
  const done = await f.submit(selected.action);
  expect(done.runId).toBeNull();
  await f.actions.settled(taskId);
  expect(f.h.coordination.store.load(taskId)).toMatchObject({
    phase: "done",
    review: { outcome: "reviewed" },
  });
  expect(natives).toHaveLength(count);
  expect(f.h.writer.accounting.episodes.count).toBe(0);
  expect(await f.h.writer.lookup(done.commandId)).toMatchObject({
    status: "found",
    record: {
      receipt: { execution: null, settlement: null, publication: "published" },
    },
  });
  expect(await f.h.writer.lookup(receipt.commandId)).toMatchObject({
    status: "found",
    record: { receipt: { execution: "completed" } },
  });
  expect(await f.h.writer.lookup(checkedReceipt.commandId)).toMatchObject({
    status: "found",
    record: { receipt: { execution: "completed" } },
  });
  expect(f.h.coordination.store.load(taskId)?.checks[0].status).toBe("passed");
  const current = f.h.coordination.store.loadSnapshot(taskId)!;
  expect(
    HistoryReader.open(f.h.coordination)!.publishedPlan(
      taskId,
      f.h.writer.committedSeq,
      { ...current.record, identity: current.identity },
    )?.publication.identity,
  ).toBe(current.identity);
}, 60000);
it("a concurrent unavailable viewer cannot stale an accepted review of unchanged checks", async () => {
  const f = await fixture();
  f.configure([f.check]);
  const { taskId, runId } = await start(f);
  await checked(f, taskId);
  const selected = await review(f, taskId, runId, false);
  expect(selected.preview.issues).toEqual([]);
  const original = f.h.writer.commit.bind(f.h.writer);
  let viewerObserved = false;
  vi.spyOn(f.h.writer, "commit").mockImplementation(async (intent) => {
    const committed = await original(intent);
    if (
      intent.identity.kind === "action" &&
      intent.identity.action.kind === "review" &&
      committed.status === "committed"
    ) {
      // Actual pending publication makes the normal viewer context unavailable.
      // Inject this read between durable acceptance and its post-commit check,
      // without modifying a task, check, model, original promise or read budget.
      expect(f.actions.context(taskId).status).toBe("unavailable");
      const displayed = f.actions.checkObligations(taskId);
      expect(displayed.definitions[0].status).toBe("stale");
      expect(displayed.revision).toBe(selected.preview.checksRevision);
      viewerObserved = true;
    }
    return committed;
  });
  const done = await f.submit(selected.action);
  await f.actions.settled(taskId);
  expect(viewerObserved).toBe(true);
  expect(f.h.coordination.store.load(taskId)).toMatchObject({
    phase: "done",
    checks: [{ status: "passed" }],
    review: { outcome: "reviewed" },
  });
  expect(await f.h.writer.lookup(done.commandId)).toMatchObject({
    status: "found",
    record: { receipt: { publication: "published" } },
  });
}, 60000);
it("failed SDK + passed check + acknowledged Done stays failed; no-ack refuses without another effect", async () => {
  const f = await fixture();
  f.configure([f.check]);
  f.failProvider();
  const { taskId, runId, receipt } = await start(f);
  await checked(f, taskId);
  const no = await review(f, taskId, runId, false);
  expect(no.preview.issues).toContain("partial-results");
  expect(
    (
      await f.actions.admission.preflight(
        { action: no.action, expected: no.preview.version },
        f.caller,
      )
    ).kind,
  ).toBe("error");
  const yes = await review(f, taskId, runId, true);
  await f.submit(yes.action);
  await f.actions.settled(taskId);
  expect(f.h.coordination.store.load(taskId)).toMatchObject({
    phase: "done",
    review: { outcome: "reviewed-with-issues" },
    checks: [{ status: "passed" }],
  });
  expect(await f.h.writer.lookup(receipt.commandId)).toMatchObject({
    status: "found",
    record: { receipt: { execution: "failed" } },
  });
  expect(readRunState(f.h.reader.files, runId).settlement).toMatchObject({
    outcome: "failed",
  });
}, 60000);
it("raw task and business changes invalidate confirmation without publishing Done", async () => {
  const f = await fixture();
  const { taskId, runId } = await start(f);
  const selected = await review(f, taskId, runId, true);
  const preflight = await f.actions.admission.preflight(
    { action: selected.action, expected: selected.preview.version },
    f.caller,
  );
  expect(preflight.kind).toBe("ok");
  if (preflight.kind !== "ok") return;
  const path = join(f.h.coordination.store.tasks, taskId, "task.json"),
    bytes = readFileSync(path);
  writeFileSync(path, Buffer.concat([bytes, Buffer.from(" ")]));
  writeFileSync(join(f.root, "external.txt"), "external business change");
  const result = await f.actions.admission.submit(
    {
      commandId: randomUUID(),
      action: selected.action,
      expected: selected.preview.version,
      grant: preflight.value.grant,
    },
    f.caller,
  );
  expect(result.kind).toBe("error");
  expect(readFileSync(path)).toEqual(Buffer.concat([bytes, Buffer.from(" ")]));
  expect(f.h.coordination.store.load(taskId)?.phase).not.toBe("done");
}, 60000);

it("latest exact passing check resolves its historical failure without rewriting either record", async () => {
  const f = await fixture("process.exit(9)");
  f.configure([f.check]);
  const { taskId, runId } = await start(f);
  const failed = await checked(f, taskId);
  expect((await review(f, taskId, runId, false)).preview.issues).toContain(
    "failed-checks",
  );
  writeFileSync(
    join(f.dir, "check.cjs"),
    "process.stdout.write('explicit new check')",
  );
  const passed = await checked(f, taskId);
  const chosen = await review(f, taskId, runId, false);
  expect(chosen.preview.issues).toEqual([]);
  await f.submit(chosen.action);
  await f.actions.settled(taskId);
  expect(f.h.coordination.store.load(taskId)).toMatchObject({
    phase: "done",
    checks: [{ status: "failed" }, { status: "passed" }],
  });
  expect(await f.h.writer.lookup(failed.commandId)).toMatchObject({
    status: "found",
    record: { receipt: { execution: "failed" } },
  });
  expect(await f.h.writer.lookup(passed.commandId)).toMatchObject({
    status: "found",
    record: { receipt: { execution: "completed" } },
  });
}, 60000);
it("no/unrun/stale/redefined checks and incomplete actual coverage require acknowledgment", async () => {
  const f = await fixture();
  const { taskId, runId } = await start(f);
  expect((await review(f, taskId, runId, false)).preview.issues).toContain(
    "unrun-checks",
  );
  await checked(f, taskId);
  expect((await review(f, taskId, runId, false)).preview.issues).toContain(
    "unrun-checks",
  );
  writeFileSync(join(f.root, "changed.txt"), "changed since check");
  expect((await review(f, taskId, runId, false)).preview.issues).toContain(
    "stale-checks",
  );
  f.configure([{ ...f.check, command: f.check.command + " " }]);
  const defined = await review(f, taskId, runId, false);
  expect(defined.preview.issues).toContain("unrun-checks");
  symlinkSync(join(f.root, "changed.txt"), join(f.root, "linked.txt"));
  const incomplete = await review(f, taskId, runId, false);
  expect(incomplete.preview.issues).toContain("incomplete-observation");
  expect(
    (
      await f.actions.admission.preflight(
        { action: incomplete.action, expected: incomplete.preview.version },
        f.caller,
      )
    ).kind,
  ).toBe("error");
  const acknowledged = await review(f, taskId, runId, true);
  await f.submit(acknowledged.action);
  await f.actions.settled(taskId);
  expect(f.h.coordination.store.load(taskId)?.review?.outcome).toBe(
    "reviewed-with-issues",
  );
}, 60000);
it("readonly task review has no fake code-check obligation and no extra SDK/check run", async () => {
  const f = await fixture();
  const created = await f.submit({
    kind: "create",
    taskKind: "research",
    goal: "Readonly actual review",
  });
  await f.actions.settled(null);
  const taskId = created.created!.taskId,
    r = await f.submit({ kind: "start", taskId });
  await f.actions.scheduler.settled(r.runId!);
  const selected = await review(f, taskId, r.runId!, false);
  const admitted = f.h.reader.admission(r.runId!, f.h.writer.committedSeq);
  expect(selected.preview.graph).toEqual(admitted.graph);
  // A next-Start proposal is not the retained graph being reviewed.
  const next = await f.actions.observe({ kind: "start", taskId });
  expect(next.graph).not.toEqual(admitted.graph);
  expect((await review(f, taskId, r.runId!, false)).preview.graph).toEqual(
    admitted.graph,
  );
  expect(selected.preview.issues).toEqual([]);
  await f.submit(selected.action);
  await f.actions.settled(taskId);
  expect(f.h.coordination.store.load(taskId)?.phase).toBe("done");
  expect(natives.map((n) => n.kind)).toEqual(["sdk"]);
}, 60000);
it("reopened review associations remain searchable and in finite history and both complete exports", async () => {
  const f = await fixture();
  const { taskId, runId } = await start(f);
  const selected = await review(f, taskId, runId, true);
  const done = await f.submit(selected.action);
  await f.actions.settled(taskId);
  const reader = HistoryReader.open(f.h.coordination)!,
    projection = new HistoryProjection(reader, f.h.projection.environment);
  let request: ListRequest = {
    reader: "reviews",
    storeId: reader.storeId,
    scope: { kind: "run", id: runId },
    snapshotSeq: f.h.writer.committedSeq,
    after: null,
    limit: 50,
  };
  let found = false,
    finished = false;
  for (let i = 0; i < 100 && !finished; i++) {
    const page = await projection.reviews(request);
    if ("kind" in page) {
      request = page.next;
      continue;
    }
    for (const r of page.records)
      if (r.kind === "owner-fact" && r.fact.kind === "review") {
        expect(r.link.runId).toBe(runId);
        found = true;
      }
    if (page.next) request = page.next;
    else finished = true;
  }
  expect(found && finished).toBe(true);
  let cursor: ReadCursor | null = {
    storeId: reader.storeId,
    scope: { kind: "task", id: taskId },
    snapshotSeq: f.h.writer.committedSeq,
    query: "Explicit human acknowledgment",
    recordId: null,
    recordVersion: null,
    field: null,
    offset: 0,
  };
  let hits = 0;
  for (let i = 0; i < 100 && cursor; i++) {
    const page = await projection.search(cursor);
    for (const hit of page.hits) {
      expect(hit.owner.runId).toBe(runId);
      expect(hit.content.field).toBe("review");
      hits++;
    }
    cursor = page.next;
  }
  expect(cursor).toBeNull();
  expect(hits).toBe(1);
  for (const format of ["ndjson", "markdown"] as const) {
    let count = 0,
      bytes = 0,
      complete = false,
      reviewSeen = false;
    const digest = createHash("sha256");
    for await (const frame of projection.export(
      {
        storeId: reader.storeId,
        scope: { kind: "run", id: runId },
        snapshotSeq: f.h.writer.committedSeq,
        format,
      },
      new AbortController().signal,
    )) {
      expect(complete).toBe(false);
      if (frame.event.kind === "trailer") {
        expect(frame.event).toMatchObject({
          complete: true,
          frames: count,
          encodedBytes: bytes,
          sha256: digest.digest("hex"),
        });
        complete = true;
      } else {
        const encoded = encodeExportFrame(frame, format);
        digest.update(encoded);
        bytes += Buffer.byteLength(encoded);
        count++;
        if (
          encoded.includes("human acknowledgment") ||
          encoded.includes('"kind":"review"')
        )
          reviewSeen = true;
      }
    }
    expect(complete && reviewSeen).toBe(true);
  }
  expect(await f.h.writer.lookup(done.commandId)).toMatchObject({
    status: "found",
    record: { receipt: { publication: "published", runId: null } },
  });
}, 60000);
it("after-acceptance business mutation is refused at the real review effect boundary", async () => {
  const f = await fixture();
  const { taskId, runId } = await start(f);
  const selected = await review(f, taskId, runId, true),
    activate = f.actions.activate.bind(f.actions);
  vi.spyOn(f.actions, "activate").mockImplementation((intent, receipt) => {
    writeFileSync(
      join(f.root, "external.txt"),
      "post-commit external mutation",
    );
    activate(intent, receipt);
  });
  const done = await f.submit(selected.action);
  await f.actions.settled(taskId);
  expect(f.h.coordination.store.load(taskId)?.phase).not.toBe("done");
  expect(await f.h.writer.lookup(done.commandId)).toMatchObject({
    status: "found",
    record: { receipt: { publication: "uncertain", execution: null } },
  });
  expect(f.h.owner.state).toBe("quarantined");
}, 60000);
it("Stop during queued review barrier prevents retention/publication; same actual gate is not a native reservation", async () => {
  const f = await fixture();
  const { taskId, runId } = await start(f);
  const selected = await review(f, taskId, runId, true);
  // Explicit fixture holder on the production gate, not an OS process claim.
  const held = await f.actions.scheduler.reviewBarrier(randomUUID());
  const count = natives.length,
    done = await f.submit(selected.action);
  await Promise.resolve();
  expect(f.h.writer.accounting.episodes.count).toBe(0);
  const stopped = await f.h.owner.stop(1000);
  await f.actions.settled(taskId);
  expect(stopped.state).not.toBe("stopped");
  expect(() => held.assertHeld()).toThrow();
  expect(natives).toHaveLength(count);
  expect(f.h.coordination.store.load(taskId)?.phase).not.toBe("done");
  expect(await f.h.writer.lookup(done.commandId)).toMatchObject({
    status: "found",
    record: { receipt: { publication: "uncertain" } },
  });
}, 60000);

it("Stop joins injected original review retention; readonly other-task preview creates no native reservation", async () => {
  const f = await fixture();
  const { taskId, runId } = await start(f),
    other = await f.create();
  const selected = await review(f, taskId, runId, true);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((yes) => {
      release = yes;
    }),
    reached = new Promise<void>((yes) => {
      entered = yes;
    });
  const append = f.h.writer.files.append.bind(f.h.writer.files);
  let blocked = false;
  vi.spyOn(f.h.writer.files, "append").mockImplementation(async (...args) => {
    if (
      !blocked &&
      args[2].some(
        (r) =>
          r.value.kind === "owner" &&
          r.value.events.some(
            (e) =>
              e.kind === "owner" &&
              e.value.kind === "content-begin" &&
              e.value.field === "changes",
          ),
      )
    ) {
      blocked = true;
      entered();
      await gate;
    }
    return append(...args);
  });
  const count = natives.length;
  const done = await f.submit(selected.action);
  await reached;
  // Real readonly observations remain possible while original retention is held.
  expect(f.h.coordination.store.load(taskId)?.phase).not.toBe("done");
  // A normal check cannot get past its serialized receipt admission until the
  // current original settles, nor can it acquire the held checkout lane.
  const preview = await f.actions.observe({
    kind: "check",
    taskId: other,
    check: f.check,
  });
  expect(preview.activeRunId).toBeNull();
  const stopping = f.h.owner.stop(25);
  try {
    expect((await stopping).state).toBe("quarantined");
    expect(f.h.writer.pendingWrites).toBeGreaterThan(0);
    expect(natives).toHaveLength(count);
  } finally {
    release();
  }
  await f.actions.settled(taskId);
  await f.h.writer.settled();
  expect(f.h.coordination.store.load(taskId)?.phase).not.toBe("done");
  expect(natives).toHaveLength(count);
  expect(await f.h.writer.lookup(done.commandId)).toMatchObject({
    status: "found",
    record: { receipt: { publication: "uncertain" } },
  });
}, 60000);
it("actual post-save business interference preserves applied bytes but publishes uncertainty, never review success", async () => {
  const f = await fixture();
  const { taskId, runId, receipt } = await start(f);
  const selected = await review(f, taskId, runId, true),
    save = f.h.coordination.store.save.bind(f.h.coordination.store);
  vi.spyOn(f.h.coordination.store, "save").mockImplementation((...args) => {
    const result = save(...args);
    if (args[0].phase === "done")
      writeFileSync(join(f.root, "foreign-after-save.txt"), "foreign effect");
    return result;
  });
  const done = await f.submit(selected.action);
  await f.actions.settled(taskId);
  expect(f.h.coordination.store.load(taskId)?.phase).toBe("done"); // actual effect, not rolled back
  expect(await f.h.writer.lookup(done.commandId)).toMatchObject({
    status: "found",
    record: { receipt: { publication: "uncertain", execution: null } },
  });
  expect(await f.h.writer.lookup(receipt.commandId)).toMatchObject({
    status: "found",
    record: { receipt: { execution: "completed" } },
  });
  expect(f.h.owner.state).toBe("quarantined");
}, 60000);
it("pending later Save cannot revive cold old graph and old review target cannot select a newer execution", async () => {
  const f = await fixture();
  const { taskId, runId } = await start(f);
  const prior = f.actions.savedGraph(taskId)!,
    task = f.h.coordination.store.loadSnapshot(taskId)!;
  const plan = "Explicit revised readable plan";
  const action: Action = {
    kind: "save-plan",
    taskId,
    plan,
    graph: {
      ...prior.graph,
      taskRevision: task.record.revision + 1,
      revision: 2,
      planRevision: 2,
      plan: proposePlanContent(plan, 2, []),
    },
  };
  // Hold before accepted metadata retention: real commit, injected activation delay.
  const activate = f.actions.activate.bind(f.actions);
  let resume!: () => void;
  vi.spyOn(f.actions, "activate").mockImplementation((intent, receipt) => {
    resume = () => activate(intent, receipt);
  });
  await f.submit(action);
  expect(() => f.actions.savedGraph(taskId)).toThrow();
  resume();
  await f.actions.settled(taskId);
  vi.restoreAllMocks();
  const later = await f.submit({ kind: "start", taskId });
  await f.actions.scheduler.settled(later.runId!);
  await expect(review(f, taskId, runId, true)).rejects.toThrow();
  expect(
    (await review(f, taskId, later.runId!, true)).preview.reviewRunId,
  ).toBe(later.runId);
}, 60000);

it("actual other-task shell waits behind short review barrier, then runs after metadata settlement", async () => {
  const f = await fixture();
  const { taskId, runId } = await start(f),
    other = await f.create();
  const selected = await review(f, taskId, runId, true);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((yes) => {
      release = yes;
    }),
    reached = new Promise<void>((yes) => {
      entered = yes;
    });
  const output = f.h.writer.reviewOutput.bind(f.h.writer);
  let delayed = false;
  vi.spyOn(f.h.writer, "reviewOutput").mockImplementation((id) => {
    const port = output(id);
    return {
      reserve: (budget) => {
        const reserved = port.reserve(budget);
        if (reserved.status !== "reserved") return reserved;
        return {
          ...reserved,
          reservation: {
            ...reserved.reservation,
            commit: async (input) => {
              const committed = await reserved.reservation.commit(input);
              if (!delayed) {
                delayed = true;
                entered();
                await gate;
              } // reporting continuation only; original disk already settled
              return committed;
            },
          },
        };
      },
    };
  });
  const done = await f.submit(selected.action);
  await reached;
  const count = natives.length;
  let checkRun: string;
  try {
    const checking = await f.submit({
      kind: "check",
      taskId: other,
      check: f.check,
    });
    checkRun = checking.runId!;
    expect(f.actions.scheduler.accounting.reservations).toBe(0);
    expect(natives).toHaveLength(count);
    expect(f.actions.scheduler.activeTask(other)).toBe(checkRun);
  } finally {
    release();
  }
  await f.actions.settled(taskId);
  await f.actions.scheduler.settled(checkRun!);
  expect(f.h.coordination.store.load(taskId)?.phase).toBe("done");
  expect(natives.slice(count).map((n) => n.kind)).toEqual(["check"]);
  expect(f.h.coordination.store.load(other)?.checks[0].status).toBe("passed");
  expect(await f.h.writer.lookup(done.commandId)).toMatchObject({
    status: "found",
    record: { receipt: { publication: "published" } },
  });
}, 60000);

it("Review displays the actual selected run plan, not a later saved next-Start graph", async () => {
  const f = await fixture();
  const { taskId, runId } = await start(f);
  const original = f.actions.savedGraph(taskId)!;
  const selected = f.h.coordination.store.loadSnapshot(taskId)!;
  const plan = "A later explicit plan that has NOT run";
  await f.submit({
    kind: "save-plan",
    taskId,
    plan,
    graph: {
      ...original.graph,
      taskRevision: selected.record.revision + 1,
      revision: 2,
      planRevision: 2,
      plan: proposePlanContent(plan, 2, []),
    },
  });
  await f.actions.settled(taskId);
  const chosen = await review(f, taskId, runId, true);
  expect(chosen.preview.version.task?.graphRevision).toBe(2); // current raw selection
  expect(chosen.preview.graph).toEqual(original.graph); // actual reviewed execution
  expect(chosen.preview.readablePlan).toBe(
    "Inspect and report; human review is separate.",
  );
  await f.submit(chosen.action);
  await f.actions.settled(taskId);
  expect(f.h.coordination.store.load(taskId)?.plan).toBe(plan);
  expect(f.h.coordination.store.load(taskId)?.phase).toBe("done");
}, 60000);

it("injected limited check-source coverage requires acknowledgment without rewriting native PASS", async () => {
  const f = await fixture();
  f.configure([f.check]);
  const { taskId, runId } = await start(f);
  // Native SDK, shell and disk are real. Only the admitted check's source-coverage
  // fact is injected, using the existing legal complete-as-observed representation.
  const owner = f.h.writer.owner.bind(f.h.writer);
  vi.spyOn(f.h.writer, "owner").mockImplementation(() => {
    const port = owner();
    return {
      reserve: (budget) => {
        const reserved = port.reserve(budget);
        if (reserved.status !== "reserved") return reserved;
        return {
          ...reserved,
          reservation: {
            ...reserved.reservation,
            commit: (input) =>
              reserved.reservation.commit({
                ...input,
                events: input.events.map((e) =>
                  e.kind === "fact" && e.fact.kind === "check-settled"
                    ? {
                        ...e,
                        fact: {
                          ...e.fact,
                          coverage: {
                            ...e.fact.coverage,
                            source: "limited",
                            omissions: ["source-limit"],
                          },
                        },
                      }
                    : e,
                ),
              }),
          },
        };
      },
    };
  });
  const checkedReceipt = await checked(f, taskId);
  const chosen = await review(f, taskId, runId, false);
  expect(chosen.preview.issues).toContain("recording-incomplete");
  expect(
    (
      await f.actions.admission.preflight(
        { action: chosen.action, expected: chosen.preview.version },
        f.caller,
      )
    ).kind,
  ).toBe("error");
  const yes = await review(f, taskId, runId, true);
  await f.submit(yes.action);
  await f.actions.settled(taskId);
  expect(f.h.coordination.store.load(taskId)).toMatchObject({
    phase: "done",
    review: { outcome: "reviewed-with-issues" },
    checks: [{ status: "passed", exitCode: 0 }],
  });
  expect(
    f
      .facts(checkedReceipt.runId!)
      .find((fact) => fact.kind === "check-settled"),
  ).toMatchObject({
    status: "passed",
    coverage: { source: "limited" },
    native: { exitCode: 0 },
  });
}, 60000);

it.each(["review", "publication-intent"] as const)(
  "Stop at injected original %s boundary prevents late Done and retains fences",
  async (kind) => {
    const f = await fixture();
    const { taskId, runId } = await start(f);
    const chosen = await review(f, taskId, runId, true);
    let release!: () => void, reached!: () => void;
    const gate = new Promise<void>((yes) => {
      release = yes;
    });
    const entered = new Promise<void>((yes) => {
      reached = yes;
    });
    const append = f.h.writer.files.append.bind(f.h.writer.files);
    let blocked = false;
    vi.spyOn(f.h.writer.files, "append").mockImplementation(async (...args) => {
      if (
        !blocked &&
        args[2].some(
          (r) =>
            r.value.kind === "owner" &&
            r.value.events.some(
              (e) =>
                e.kind === "owner" &&
                e.value.kind === "fact" &&
                e.value.fact.kind === kind,
            ),
        )
      ) {
        blocked = true;
        reached();
        await gate;
      }
      return append(...args);
    });
    const count = natives.length;
    const done = await f.submit(chosen.action);
    await entered;
    try {
      expect((await f.h.owner.stop(25)).state).toBe("quarantined");
      expect(f.h.writer.pendingWrites).toBeGreaterThan(0);
    } finally {
      release();
    }
    await f.actions.settled(taskId);
    await f.h.writer.settled();
    expect(f.h.coordination.store.load(taskId)?.phase).not.toBe("done");
    expect(natives).toHaveLength(count);
    expect(await f.h.writer.lookup(done.commandId)).toMatchObject({
      status: "found",
      record: { receipt: { publication: "uncertain", execution: null } },
    });
    expect(f.h.owner.state).toBe("quarantined");
  },
  60000,
);

it("an older waiting actual check precedes Review; its generation change invalidates the accepted review", async () => {
  const f = await fixture();
  const { taskId, runId } = await start(f),
    other = await f.create();
  // Fixture-only holder creates an explicit queue; real check and metadata share it.
  const held = await f.actions.scheduler.reviewBarrier(randomUUID());
  const count = natives.length;
  const checking = await f.submit({
    kind: "check",
    taskId: other,
    check: f.check,
  });
  // Establish the older check's actual allocation/publication and let its original
  // initialization continuation join the gate, rather than equating acceptance
  // alone with a ready gate waiter.
  await vi.waitFor(() =>
    expect(f.h.coordination.store.load(other)?.phase).toBe("running"),
  );
  await f.h.writer.settled();
  await new Promise<void>((resolve) => setImmediate(resolve));
  const chosen = await review(f, taskId, runId, true);
  const done = await f.submit(chosen.action);
  expect(natives).toHaveLength(count);
  expect(f.actions.scheduler.accounting.reservations).toBe(0);
  await f.h.writer.settled();
  held.release();
  await f.actions.scheduler.settled(checking.runId!);
  await f.actions.settled(taskId);
  expect(natives.slice(count).map((n) => n.kind)).toEqual(["check"]);
  // Review's stale rejection may quiesce the later v1 summary. Preserve the
  // already committed native/check result rather than require a late publication.
  expect(
    f.facts(checking.runId!).find((fact) => fact.kind === "check-settled"),
  ).toMatchObject({
    status: "passed",
    native: { exitCode: 0, closure: "direct-child-closed" },
  });
  expect(f.h.coordination.store.load(taskId)?.phase).not.toBe("done");
  expect(await f.h.writer.lookup(done.commandId)).toMatchObject({
    status: "found",
    record: { receipt: { publication: "uncertain" } },
  });
}, 60000);

it("cold own-publication proof survives more than sixteen other task selections, but not external same-revision bytes", async () => {
  const f = await fixture();
  const { taskId, runId } = await start(f);
  const initial = f.actions.savedGraph(taskId)!;
  for (let i = 0; i < 17; i++) await f.create();
  const chosen = await review(f, taskId, runId, true);
  await f.submit(chosen.action);
  await f.actions.settled(taskId);
  const selected = f.h.coordination.store.loadSnapshot(taskId)!;
  const cold = HistoryReader.open(f.h.coordination)!;
  const proven = cold.publishedPlan(taskId, f.h.writer.committedSeq, {
    revision: selected.record.revision,
    identity: selected.identity,
    plan: selected.record.plan,
  });
  expect(proven?.graph).toEqual(initial.graph);
  expect(proven?.graph.assignments[0].model).toEqual(f.selection);
  const path = join(f.h.coordination.store.tasks, taskId, "task.json");
  const external = Buffer.concat([readFileSync(path), Buffer.from(" ")]);
  writeFileSync(path, external);
  const changed = f.h.coordination.store.loadSnapshot(taskId)!;
  expect(() =>
    HistoryReader.open(f.h.coordination)!.publishedPlan(
      taskId,
      f.h.writer.committedSeq,
      {
        revision: changed.record.revision,
        identity: changed.identity,
        plan: changed.record.plan,
      },
    ),
  ).toThrow();
  expect(readFileSync(path)).toEqual(external);
}, 60000);
it("one accepted review folds its immutable snapshot once, across every validation", async () => {
  const f = await fixture();
  f.configure([f.check]);
  const { taskId, runId } = await start(f);
  await checked(f, taskId);
  const selected = await review(f, taskId, runId, false);
  expect(selected.preview.issues).toEqual([]);
  const plans = vi.spyOn(HistoryReader.prototype, "publishedPlan"),
    selections = vi.spyOn(HistoryReader.prototype, "reviewSelection");
  try {
    const done = await f.submit(selected.action);
    await f.actions.settled(taskId);
    expect(f.h.coordination.store.load(taskId)).toMatchObject({
      phase: "done",
      review: { outcome: "reviewed" },
    });
    expect(await f.h.writer.lookup(done.commandId)).toMatchObject({
      status: "found",
      record: { receipt: { publication: "published" } },
    });
    // Before, every validation of this one review re-folded the same snapshot
    // (70 plan and 69 selection folds here). Previews, current views and
    // admission still fold in their own operations.
    expect(plans.mock.calls.length).toBeLessThanOrEqual(8);
    expect(selections.mock.calls.length).toBeLessThanOrEqual(8);
  } finally {
    plans.mockRestore();
    selections.mockRestore();
  }
}, 60000);
