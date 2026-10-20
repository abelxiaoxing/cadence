/** Injected scheduler facts over real disk, NOT native process evidence. */
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { readRetainedList } from "../src/history/list-progress.ts";
import { readRunState } from "../src/history/run-state.ts";
import {
  decodeOwnerFact,
  type ListRequest,
  type RunProjection,
} from "../src/service-contract.ts";
import {
  admitFixtureRun,
  historyFixture,
  ownerFact,
} from "./helpers/history-fixture.ts";
import { readProjection } from "./helpers/history-read-fixture.ts";

it("per-reservation gates and unstarted reasons survive the shared finite historical projection", async () => {
  const f = historyFixture(),
    second = randomUUID();
  expect((await f.writer.commit(f.intent)).status).toBe("committed");
  await admitFixtureRun(f, [f.link.childRunId, second]);
  for (const id of [f.link.childRunId, second]) {
    expect(
      (
        await ownerFact(f, {
          kind: "assignment-state",
          childRunId: id,
          state: "waiting",
          reason: "writer",
        })
      ).status,
    ).toBe("committed");
    expect(
      (
        await ownerFact(f, {
          kind: "gate",
          reservationId: id,
          lane: "reader",
          state: "held",
          checkoutGeneration: 0,
        })
      ).status,
    ).toBe("committed");
  }
  expect(
    (await ownerFact(f, { kind: "admission-closed", reason: "wait-expired" }))
      .status,
  ).toBe("committed");
  for (const id of [f.link.childRunId, second]) {
    expect(
      (
        await ownerFact(f, {
          kind: "assignment-state",
          childRunId: id,
          state: "unstarted",
          reason: "wait-expired",
        })
      ).status,
    ).toBe("committed");
    expect(
      (
        await ownerFact(f, {
          kind: "gate",
          reservationId: id,
          lane: "reader",
          state: "released",
          checkoutGeneration: 0,
        })
      ).status,
    ).toBe("committed");
  }
  const state = readRunState(f.files, f.link.runId),
    projection = readProjection(f);
  expect(state.children.size).toBe(0);
  expect(state.gates.size).toBe(2);
  const expected = state.projections(f.link.epoch);
  expect(expected[0]).toMatchObject({
    lifecycle: "closing",
    outcome: null,
    reason: "wait-expired",
  });
  expect(expected[1]).toMatchObject({
    settlement: null,
    outcome: null,
    reason: "wait-expired",
  });
  let request: ListRequest = {
    reader: "runs",
    storeId: f.files.format.storeId,
    scope: { kind: "task", id: f.link.taskId },
    snapshotSeq: f.writer.committedSeq,
    after: null,
    limit: 50,
  };
  const actual: RunProjection[] = [];
  for (let i = 0; i < 100; i++) {
    const page = await readRetainedList(projection, request);
    if ("kind" in page) {
      request = page.next;
      continue;
    }
    actual.push(
      ...page.records.flatMap((r) => (r.kind === "run" ? [r.projection] : [])),
    );
    if (!page.next) break;
    request = page.next;
  }
  expect(actual).toEqual(expected);
});

it("unknown holder membership and illegal scheduler success vocabulary refuse", async () => {
  expect(() =>
    decodeOwnerFact({
      kind: "assignment-state",
      childRunId: randomUUID(),
      state: "completed",
      reason: null,
    }),
  ).toThrow();
  const f = historyFixture();
  await f.writer.commit(f.intent);
  await admitFixtureRun(f);
  expect(
    (
      await ownerFact(f, {
        kind: "gate",
        reservationId: randomUUID(),
        lane: "reader",
        state: "held",
        checkoutGeneration: 0,
      })
    ).status,
  ).toBe("refused");
  expect(f.writer.quarantined).toBe(true);
  expect(readRunState(f.files, f.link.runId).children.size).toBe(0);
});

it.each(["legacy-first", "reservation-first"])(
  "rejects mixed legacy/per-assignment gate modes (%s)",
  async (order) => {
    const f = historyFixture();
    await f.writer.commit(f.intent);
    await admitFixtureRun(f);
    const gate = {
      kind: "gate" as const,
      lane: "reader" as const,
      state: "held" as const,
      checkoutGeneration: 0,
    };
    const scoped = { ...gate, reservationId: f.link.childRunId };
    expect(
      (await ownerFact(f, order === "legacy-first" ? gate : scoped)).status,
    ).toBe("committed");
    expect(
      (await ownerFact(f, order === "legacy-first" ? scoped : gate)).status,
    ).toBe("refused");
    expect(f.writer.quarantined).toBe(true);
  },
);

it("a per-child gate cannot release while its original auth preparation is unsettled", async () => {
  const f = historyFixture();
  await f.writer.commit(f.intent);
  await admitFixtureRun(f);
  const gate = {
    kind: "gate" as const,
    reservationId: f.link.childRunId,
    lane: "reader" as const,
    checkoutGeneration: 0,
  };
  expect((await ownerFact(f, { ...gate, state: "held" })).status).toBe(
    "committed",
  );
  expect(
    (
      await f.writer.auth.preparation({
        operationId: randomUUID(),
        epoch: f.link.epoch,
        runId: f.link.runId,
        childRunId: f.link.childRunId,
        sourceSelectionId: f.context.model.sourceSelectionId,
        validityMs: 1000,
      })
    ).status,
  ).toBe("committed");
  expect((await ownerFact(f, { ...gate, state: "released" })).status).toBe(
    "refused",
  );
  expect(f.writer.quarantined).toBe(true);
});
