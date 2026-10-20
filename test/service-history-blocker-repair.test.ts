import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { HistoryReadBudget } from "../src/history/files.ts";
import { HistoryNavigation } from "../src/history/navigation.ts";
import {
  decodeJournalLine,
  decodeJournalText,
  encodeJournalText,
  type JournalRow,
} from "../src/history/types.ts";
import { canonicalJson } from "../src/service-contract.ts";
import {
  admitFixtureRun,
  historyFixture,
  prepareFixtureChild,
} from "./helpers/history-fixture.ts";

it("repair: one validated journal encoding per original append, charged before its write", async () => {
  const f = historyFixture();
  const encode = vi.spyOn(f.writer.files, "encodeBatch");
  const result = await f.writer.commit(f.intent);
  expect(result.status).toBe("committed");
  expect(encode).toHaveBeenCalledTimes(1);
  const encoded = encode.mock.results[0].value;
  expect(encoded.rowBytes.reduce((a: number, b: number) => a + b, 0)).toBe(
    Buffer.byteLength(encoded.body),
  );
  expect(readFileSync(f.files.segmentPath(1), "utf8")).toBe(
    encoded.body + encoded.trailer,
  );
});

it("repair: unchanged active membership does not rewrite its derived file per watermark", async () => {
  const f = historyFixture();
  await f.writer.commit(f.intent);
  await admitFixtureRun(f);
  const nav = new HistoryNavigation(f.files);
  const before = readFileSync(nav.indexPath("heads", "active"));
  await prepareFixtureChild(f);
  expect(readFileSync(nav.indexPath("heads", "active"))).toEqual(before);
  const scan = vi.spyOn(nav, "scanSnapshot");
  expect(nav.active(f.writer.committedSeq, new HistoryReadBudget())).toEqual([
    { runId: f.link.runId, taskId: f.link.taskId },
  ]);
  expect(scan).not.toHaveBeenCalled();
});

it("repair: fixed epoch decoding preserves the original closed canonical codec", () => {
  const row: JournalRow = {
    kind: "record",
    id: randomUUID(),
    seq: "123",
    value: { kind: "owner-epoch", epoch: randomUUID() },
  };
  const body = encodeJournalText(row);
  expect(decodeJournalText(body)).toEqual(decodeJournalLine(JSON.parse(body)));
  for (const invalid of [
    body.replace('"123"', '"0123"'),
    body.replace(row.id, "0".repeat(36)),
    body.replace('"value":', '"extra":0,"value":'),
    body.replace('"kind":"record"', '"kind":"record","kind":"record"'),
    body.replace('{"id"', '{ "id"'),
    body.replace('"owner-epoch"', '"unknown"'),
  ])
    expect(() => decodeJournalText(invalid)).toThrow();
  const first = decodeJournalText(body);
  if (first.kind !== "record") throw new Error("expected record");
  first.seq = "999";
  expect(decodeJournalText(body)).toEqual(row);
  expect(`${canonicalJson(row)}\n`).toBe(body);
});
