/** Real disk / injected owner facts. Not a native SDK or accepting-host scenario. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { HistoryFiles } from "../src/history/files.ts";
import { readRetainedList } from "../src/history/list-progress.ts";
import { readRunState } from "../src/history/run-state.ts";
import { HistoryWriter } from "../src/history/writer.ts";
import {
  encodeExportFrame,
  type ListRequest,
  type OwnerFact,
  type RunProjection,
} from "../src/service-contract.ts";
import {
  admitFixtureRun,
  historyFixture,
  settleFixtureRun,
} from "./helpers/history-fixture.ts";
import { selectLegacy } from "./helpers/history-publication-fixture.ts";
import { readProjection, storedTree } from "./helpers/history-read-fixture.ts";

it("subsequent candidate-less uncertainty survives reopened/finite projections and both complete exports without changing execution", async () => {
  const f = historyFixture();
  selectLegacy(f);
  expect((await f.writer.commit(f.intent)).status).toBe("committed");
  await admitFixtureRun(f);
  const first = await f.writer.publishTask({
    operationId: f.intent.operationId,
  });
  expect(first.status).toBe("published");
  expect((await settleFixtureRun(f, "blocked")).status).toBe("committed");
  const path = join(f.c.store.tasks, f.link.taskId, "task.json");
  const external = Buffer.concat([readFileSync(path), Buffer.from(" \n")]);
  writeFileSync(path, external);
  const second = await f.writer.publishTask({
    operationId: f.intent.operationId,
  });
  expect(second).toMatchObject({
    status: "uncertain",
    publicationId: null,
    observed: null,
  });
  const files = HistoryFiles.open(f.c)!;
  const state = readRunState(files, f.link.runId);
  expect(state.publication).toBe("uncertain");
  expect(state.settlement).toMatchObject({ outcome: "blocked" });
  expect(state.children.size).toBe(0);
  expect(state.drained).toBe(false);
  expect(() => state.publicationExpected()).toThrow();
  const facts: OwnerFact[] = [];
  for (const batch of files.scan())
    for (const row of batch.rows) {
      if (row.value.kind !== "owner") continue;
      for (const event of row.value.events)
        if (event.kind === "owner" && event.value.kind === "fact")
          facts.push(event.value.fact);
    }
  const intents = facts.filter((fact) => fact.kind === "publication-intent");
  const settled = facts.filter((fact) => fact.kind === "publication-settled");
  expect(intents).toHaveLength(1);
  expect(settled).toHaveLength(2);
  expect(settled[1]).toMatchObject({ status: "uncertain", observed: null });
  expect(settled[1].publicationId).not.toBe(first.publicationId);
  const before = storedTree(f.dir);
  const reopened = new HistoryWriter(f.lease);
  expect(reopened.quarantined).toBe(true);
  expect(await reopened.lookup(f.intent.commandId)).toMatchObject({
    status: "found",
    record: { receipt: { execution: "blocked", publication: "uncertain" } },
  });
  const projection = readProjection(f),
    expected = state.projections(f.link.epoch);
  let request: ListRequest = {
    reader: "runs",
    storeId: files.format.storeId,
    scope: { kind: "task", id: f.link.taskId },
    snapshotSeq: f.writer.committedSeq,
    after: null,
    limit: 50,
  };
  const actual: RunProjection[] = [];
  let finished = false;
  for (let count = 0; count < 100 && !finished; count++) {
    const page = await readRetainedList(projection, request);
    if ("kind" in page) {
      request = page.next;
      continue;
    }
    actual.push(
      ...page.records.flatMap((record) =>
        record.kind === "run" ? [record.projection] : [],
      ),
    );
    if (page.next) request = page.next;
    else finished = true;
  }
  expect(finished).toBe(true);
  expect(actual).toEqual(expected);
  for (const format of ["ndjson", "markdown"] as const) {
    const digest = createHash("sha256");
    let bytes = 0,
      count = 0,
      complete = false,
      markdown = "";
    const exported: OwnerFact[] = [];
    for await (const frame of projection.export(
      {
        storeId: files.format.storeId,
        scope: { kind: "task", id: f.link.taskId },
        snapshotSeq: request.snapshotSeq!,
        format,
      },
      new AbortController().signal,
    )) {
      expect(complete).toBe(false); // no frames after the genuine trailer
      if (frame.event.kind === "trailer") {
        expect(frame.event).toMatchObject({
          complete: true,
          frames: count,
          encodedBytes: bytes,
          sha256: digest.digest("hex"),
          committedSeq: request.snapshotSeq,
        });
        complete = true;
      } else {
        const encoded = encodeExportFrame(frame, format);
        digest.update(encoded);
        bytes += Buffer.byteLength(encoded);
        count++;
        if (
          frame.event.kind === "record" &&
          frame.event.record.kind === "owner-fact"
        )
          exported.push(frame.event.record.fact);
        if (frame.event.kind === "markdown") markdown += frame.event.text;
      }
    }
    expect(complete).toBe(true); // original iterator EOF, not just a trailer sighting
    if (format === "ndjson") {
      expect(
        exported.filter((fact) => fact.kind === "publication-settled"),
      ).toEqual(settled);
      expect(
        exported.filter((fact) => fact.kind === "publication-intent"),
      ).toEqual(intents);
    } else {
      expect(markdown).toContain(settled[1].publicationId);
      expect(markdown).toContain('"status":"uncertain"');
      expect(markdown).toContain('"outcome":"blocked"');
    }
  }
  expect(readFileSync(path)).toEqual(external);
  expect(storedTree(f.dir)).toEqual(before);
});

it("accepted but unallocated Stop records uncertain publication, never fabricated execution, after reopen and export", async () => {
  const f = historyFixture();
  selectLegacy(f);
  expect((await f.writer.commit(f.intent)).status).toBe("committed");
  const path = join(f.c.store.tasks, f.link.taskId, "task.json"),
    bytes = readFileSync(path);
  f.writer.quiesce();
  expect((await f.writer.abandonPublication(f.intent.operationId)).status).toBe(
    "committed",
  );
  const state = readRunState(f.files, f.link.runId);
  expect(state.admission).toBeNull();
  expect(state.settlement).toBeNull();
  expect(state.publication).toBe("uncertain");
  expect(state.children.size).toBe(0);
  const reopened = new HistoryWriter(f.lease);
  expect(await reopened.lookup(f.intent.commandId)).toMatchObject({
    status: "found",
    record: {
      receipt: {
        admission: "accepted",
        publication: "uncertain",
        execution: null,
        settlement: null,
      },
    },
  });
  let published = false,
    allocation = false,
    complete = false;
  for await (const frame of readProjection(f).export(
    {
      storeId: f.files.format.storeId,
      scope: { kind: "task", id: f.link.taskId },
      snapshotSeq: f.writer.committedSeq,
      format: "ndjson",
    },
    new AbortController().signal,
  )) {
    if (
      frame.event.kind === "record" &&
      frame.event.record.kind === "owner-fact"
    ) {
      published ||= frame.event.record.fact.kind === "publication-settled";
      allocation ||= frame.event.record.fact.kind === "parent-admitted";
    }
    complete ||= frame.event.kind === "trailer";
  }
  expect(published).toBe(true);
  expect(allocation).toBe(false);
  expect(complete).toBe(true);
  expect(readFileSync(path)).toEqual(bytes);
});
