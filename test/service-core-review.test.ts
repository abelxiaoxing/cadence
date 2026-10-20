/** Isolated actual disk/codec tests. Authority and journal scheduling barriers are injected. */
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { decodeJournalText, RECORD_BYTES } from "../src/history/types.ts";
import { hash } from "../src/service/private-files.ts";
import { canonicalJson } from "../src/service-contract.ts";
import { historyFixture } from "./helpers/history-fixture.ts";

it("the admission lookup observes one original boundary without chasing later writes", async () => {
  let first!: () => void,
    second!: () => void,
    openFirst!: () => void,
    openSecond!: () => void;
  const atFirst = new Promise<void>((yes) => {
    first = yes;
  });
  const atSecond = new Promise<void>((yes) => {
    second = yes;
  });
  const gateFirst = new Promise<void>((yes) => {
    openFirst = yes;
  });
  const gateSecond = new Promise<void>((yes) => {
    openSecond = yes;
  });
  let ordinal = 0;
  const f = historyFixture({
    observeWrite: async (at) => {
      if (at !== "commit") return;
      if (++ordinal === 1) {
        first();
        await gateFirst;
      } else if (ordinal === 2) {
        second();
        await gateSecond;
      }
    },
  });
  const original = f.writer.commit(f.intent);
  await atFirst;
  let observed = false;
  const lookup = f.writer.lookupForAdmission(randomUUID()).then((r) => {
    observed = true;
    return r;
  });
  const later = f.writer.commit({
    commandId: randomUUID(),
    operationId: randomUUID(),
    runId: f.link.runId,
    createdTaskId: null,
    identity: { kind: "cancel", epoch: f.link.epoch, runId: f.link.runId },
  });
  try {
    openFirst();
    await atSecond;
    await vi.waitFor(() => expect(observed).toBe(true), { timeout: 500 });
    expect(await lookup).toMatchObject({ status: "absent" });
    expect(f.writer.pendingWrites).toBeGreaterThan(0);
  } finally {
    openFirst();
    openSecond();
    await Promise.all([original, later, lookup]);
    await f.writer.settled();
  }
});

it("old canonical duplicated admission rows retain raw checksums and conflicting duplicates refuse", async () => {
  const f = historyFixture();
  expect((await f.writer.commit(f.intent)).status).toBe("committed");
  const path = f.files.segmentPath(1);
  const lines = readFileSync(path, "utf8").trimEnd().split("\n");
  expect(lines[0]).toContain('"admission-compact"');
  const row = decodeJournalText(lines[0]);
  if (row.kind !== "record" || row.value.kind !== "admission")
    throw Error("fixture admission");
  const legacy = `${canonicalJson(row, RECORD_BYTES)}\n`;
  const marker = JSON.parse(lines[1]);
  marker.sha256 = hash(legacy);
  const raw = legacy + canonicalJson(marker, RECORD_BYTES) + "\n";
  writeFileSync(path, raw);
  expect(decodeJournalText(legacy)).toEqual(row);
  expect([...f.files.scan()][0].rows[0]).toEqual(row);
  expect(await f.writer.lookup(f.intent.commandId)).toMatchObject({
    status: "found",
  });
  expect(readFileSync(path, "utf8")).toBe(raw);
  const contradictory = structuredClone(row);
  if (contradictory.value.kind !== "admission") throw Error("type");
  contradictory.value.record.identity = {
    kind: "cancel",
    epoch: f.link.epoch,
    runId: f.link.runId,
  };
  expect(() =>
    decodeJournalText(canonicalJson(contradictory, RECORD_BYTES)),
  ).toThrow();
  // A compact checksum is NOT a checksum of the historical raw duplicated row.
  marker.sha256 = hash(`${lines[0]}\n`);
  writeFileSync(path, legacy + canonicalJson(marker, RECORD_BYTES) + "\n");
  expect(() => [...f.files.scan()]).toThrow();
});
