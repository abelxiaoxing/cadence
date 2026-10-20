/** Fixed original-source locators, never serialized public rows. Only a validated
 * batch can issue these; AEAD authenticates their previous committed membership.
 * Every materialization rereads and hashes the original selected row. */
import { hash } from "../service/private-files.ts";
import { ContractError, decodeSequence, LIMITS } from "../service-contract.ts";
import { closed, decodeHash, integer } from "../worker-public.mjs";
import type { HistoryFiles, HistoryReadBudget } from "./files.ts";
import { assertIncarnation, incarnation, readRange } from "./read-io.ts";
import { decodeJournalText, type JournalRow, RECORD_BYTES } from "./types.ts";
export interface SourceRow {
  segment: number;
  offset: number;
  bytes: number;
  sha256: string;
  seq: string;
}
export interface SourceEvent extends SourceRow {
  event: number;
}
export function decodeSourceRow(value: unknown): SourceRow {
  const o = closed(value, ["segment", "offset", "bytes", "sha256", "seq"]);
  const r = {
    segment: integer(o.segment, 1, 999999999999),
    offset: integer(o.offset, 0, LIMITS.segmentBytes),
    bytes: integer(o.bytes, 1, RECORD_BYTES),
    sha256: decodeHash(o.sha256),
    seq: decodeSequence(o.seq),
  };
  if (r.offset + r.bytes > LIMITS.segmentBytes)
    throw new ContractError("corrupt-selected");
  return r;
}
export function decodeSourceEvent(value: unknown): SourceEvent {
  const o = closed(value, [
    "segment",
    "offset",
    "bytes",
    "sha256",
    "seq",
    "event",
  ]);
  const { event, ...row } = o;
  return {
    ...decodeSourceRow(row),
    event: integer(event, 0, LIMITS.ownerQueueFrames - 1),
  };
}
export class SourceRows {
  private readonly selected = new Map<
    string,
    { row: JournalRow; stamp: string }
  >();
  private readonly delegated = new Map<string, SourceRow>();
  constructor(
    readonly files: HistoryFiles,
    readonly budget: HistoryReadBudget,
    private readonly verified?: (source: SourceRow) => JournalRow,
  ) {}
  read(source: SourceRow): JournalRow {
    if (this.verified) {
      this.delegated.set(`${source.segment}/${source.offset}`, source);
      return this.verified(source);
    }
    const key = `${source.segment}/${source.offset}/${source.bytes}/${source.sha256}`,
      path = this.files.segmentPath(source.segment),
      old = this.selected.get(key);
    if (old) {
      assertIncarnation(this.files, path, old.stamp);
      return old.row;
    }
    const { stamp } = incarnation(this.files, path, LIMITS.segmentBytes),
      bytes = readRange(
        this.files,
        path,
        source.offset,
        source.bytes,
        this.budget,
      );
    if (hash(bytes) !== source.sha256)
      throw new ContractError("corrupt-selected");
    const row = decodeJournalText(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (row.kind !== "record" || BigInt(row.seq) > BigInt(source.seq))
      throw new ContractError("corrupt-selected");
    assertIncarnation(this.files, path, stamp);
    this.selected.set(key, { row, stamp });
    return row;
  }
  event(source: SourceEvent) {
    const row = this.read(source),
      v = row.value;
    if (v.kind !== "owner" && v.kind !== "capture")
      throw new ContractError("corrupt-selected");
    const event = v.events[source.event];
    if (!event) throw new ContractError("corrupt-selected");
    return { row, value: v, event };
  }
  assertCurrent(): void {
    if (this.verified)
      for (const source of this.delegated.values()) this.verified(source);
    for (const [key, value] of this.selected)
      assertIncarnation(
        this.files,
        this.files.segmentPath(Number(key.split("/")[0])),
        value.stamp,
      );
  }
}

export function sourceLocator(
  bytes: Buffer,
  p: { segment: number; offset: number; seq: string },
  index: number,
  count: number,
): SourceRow {
  if (!Number.isInteger(index) || index < 0 || index >= count)
    throw new ContractError("corrupt-selected");
  let start = 0;
  for (let i = 0; i < index; i++) start = bytes.indexOf(10, start) + 1;
  const end = bytes.indexOf(10, start) + 1;
  if (end <= start) throw new ContractError("corrupt-selected");
  return {
    segment: p.segment,
    offset: p.offset + start,
    bytes: end - start,
    sha256: hash(bytes.subarray(start, end)),
    seq: p.seq,
  };
}
