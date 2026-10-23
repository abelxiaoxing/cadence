/** Cold exact-anchor detail navigation; one original budget and explicit proof
 * replies, never a zero-length fabricated page or an unbounded point lookup. */
import {
  ContractError,
  canonicalJson,
  type DetailReadResult,
  decodeCursor,
  decodeDetailReadResult,
  LIMITS,
  parseWireJson,
  type ReadCursor,
  readIdentity,
} from "../service-contract.ts";
import { closed, integer } from "../worker-public.mjs";
import { HistoryReadBudget, noProgress, retryStalled } from "./files.ts";
import { HistoryReadProof } from "./read-proof.ts";
import type { HistoryReader } from "./reader.ts";
import { decodeRetainedProgress, freshProgress } from "./retained-progress.ts";
import { RetainedScan, type ScanPoint } from "./search.ts";

function bad(): never {
  throw new ContractError("corrupt-selected");
}
export function decodeScanPoint(value: unknown): ScanPoint {
  const o = closed(value, ["pos", "row", "event", "byte", "snapshot"]),
    p = closed(o.pos, ["segment", "offset"]);
  return {
    pos: {
      segment: integer(p.segment, 1, 999999999999),
      offset: integer(p.offset, 0, LIMITS.segmentBytes),
    },
    row: integer(o.row, 0, LIMITS.segmentRecords),
    event: integer(
      o.event,
      0,
      LIMITS.ownerQueueFrames * (2 * LIMITS.assignments + 2),
    ),
    byte: integer(o.byte, 0, LIMITS.detailBytes),
    snapshot: integer(o.snapshot),
  };
}
/** A completed, unsuccessful accelerator attempt advances to original-source
 * preparation exactly once. No submitted proof or corruption is reset here. */
export function detailPreparation(
  cursor: ReadCursor,
  completion: ReturnType<HistoryReadProof["prepareCompletion"]>,
): DetailReadResult {
  const next = {
    ...readIdentity(cursor),
    navigation: completion.seal(
      { purpose: "detail", request: cursor },
      Buffer.from(
        canonicalJson(
          {
            point: {
              pos: { segment: 1, offset: 0 },
              row: 0,
              event: 0,
              byte: 0,
              snapshot: 0,
            },
            state: freshProgress(),
          },
          6000,
        ),
      ),
    ),
  };
  return decodeDetailReadResult({
    kind: "progress",
    cursor,
    next,
    coverage: freshProgress().coverage,
  });
}

export async function readRetainedDetail(
  reader: HistoryReader,
  input: ReadCursor,
): Promise<DetailReadResult> {
  return retryStalled(() => detailQuantum(reader, input));
}
async function detailQuantum(
  reader: HistoryReader,
  input: ReadCursor,
): Promise<DetailReadResult> {
  const cursor = decodeCursor(input);
  if (cursor.storeId !== reader.storeId || !cursor.recordId) bad();
  const original = new HistoryReadBudget(),
    proof = new HistoryReadProof(reader.files),
    completion = proof.prepareCompletion(original);
  let p: ScanPoint = {
      pos: { segment: 1, offset: 0 },
      row: 0,
      event: 0,
      byte: 0,
      snapshot: 0,
    },
    state = freshProgress();
  if (cursor.navigation) {
    const o = closed(
      parseWireJson(
        new TextDecoder("utf-8", { fatal: true }).decode(
          proof.open(
            { purpose: "detail", request: cursor },
            cursor.navigation,
            original,
          ),
        ),
        6000,
      ),
      ["point", "state"],
    );
    p = decodeScanPoint(o.point);
    state = decodeRetainedProgress(o.state);
  }
  const budget = new HistoryReadBudget();
  budget.reserve = (bytes) => {
    if (original.bytes + bytes > LIMITS.searchBytes - 8192)
      throw new ContractError("receipt-inconclusive");
    original.reserve(bytes);
  };
  const scan = new RetainedScan(reader, cursor, budget, state),
    coordinate = () =>
      canonicalJson({ point: p, state: scan.checkpoint() }, 6000),
    before = coordinate();
  const seal = (next: ReadCursor) => {
    scan.traversal?.assertCurrent();
    next.navigation = completion.seal(
      { purpose: "detail", request: next },
      Buffer.from(coordinate()),
    );
    return next;
  };
  try {
    scan.prepare(p);
    // An inline anchor in the EXACT just-proved snapshot batch needs no second
    // archive traversal. Its public address is only compared with that original
    // witness; arbitrary earlier addresses never inherit the snapshot proof.
    const inline = scan.inline(cursor);
    if (inline?.kind === "text" && inline.inline) {
      const bytes = Buffer.from(inline.text);
      if (
        cursor.offset >= bytes.length ||
        (bytes[cursor.offset] & 0xc0) === 0x80
      )
        bad();
      scan.traversal?.assertCurrent();
      completion.validate();
      return decodeDetailReadResult({
        cursor,
        content: inline.content,
        range: { start: cursor.offset, end: bytes.length },
        text: bytes.subarray(cursor.offset).toString("utf8"),
        next: null,
        coverage: inline.coverage,
      });
    }
    for (;;) {
      const b = scan.next(p);
      if (!b) bad();
      for (; p.row < b.rows.length; p.row++, p.event = 0) {
        const row = b.rows[p.row],
          count = scan.count(row);
        for (; p.event < count; p.event = scan.advance(row, p.event)) {
          budget.reserve(0);
          const item = scan.item(b, row, p.event);
          if (
            item?.kind === "end" &&
            item.detail.content.recordId === cursor.recordId &&
            !item.detail.content.bytes
          ) {
            if (
              cursor.offset ||
              item.detail.content.version !== cursor.recordVersion ||
              item.detail.content.field !== cursor.field
            )
              bad();
            completion.validate();
            return decodeDetailReadResult({
              cursor,
              content: item.detail.content,
              range: null,
              text: "",
              next: null,
              coverage: item.detail.coverage,
            });
          }
          if (
            item?.kind !== "text" ||
            item.content.recordId !== cursor.recordId
          )
            continue;
          if (
            item.content.version !== cursor.recordVersion ||
            item.content.field !== cursor.field ||
            cursor.offset > item.content.bytes
          )
            bad();
          const body = Buffer.from(item.text),
            from = cursor.offset - item.start;
          if (from >= body.length) continue;
          if (from < 0 || (body[from] & 0xc0) === 0x80) bad();
          const end = item.start + body.length;
          p.event = scan.advance(row, p.event);
          const next =
            end < item.content.bytes
              ? seal({ ...readIdentity(cursor), offset: end })
              : null;
          if (!next) {
            scan.traversal?.assertCurrent();
            completion.validate();
          }
          return decodeDetailReadResult({
            cursor,
            content: item.content,
            range: { start: cursor.offset, end },
            text: body.subarray(from).toString("utf8"),
            next,
            coverage: item.coverage,
          });
        }
      }
      if (b.pointer.seq === cursor.snapshotSeq) bad();
      p.pos = b.next;
      p.row = 0;
      p.event = 0;
    }
  } catch (error) {
    if (
      !(error instanceof ContractError) ||
      error.code !== "receipt-inconclusive"
    )
      throw error;
    if (coordinate() === before) noProgress(original);
    return decodeDetailReadResult({
      kind: "progress",
      cursor,
      next: seal({ ...readIdentity(cursor) }),
      coverage: scan.coverage,
    });
  }
}
