/** Full retained export. W1 alone owns authentication, socket backpressure and
 * generation revocation. This reader stops on abort and never stops execution. */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  type CaptureCoverage,
  ContractError,
  canonicalJson,
  decodeExportFrame,
  decodeExportRequest,
  EXPORT_SCHEMA,
  type ExportEvent,
  type ExportFrame,
  type ExportRequest,
  encodeExportFrame,
  type HistoryRecord,
  LIMITS,
} from "../service-contract.ts";
import { HistoryReadBudget, STALL_RETRIES } from "./files.ts";
import type { HistoryProjection } from "./projection.ts";
import { RunState } from "./run-state.ts";
import { type RetainedItem, RetainedScan, type ScanPoint } from "./search.ts";
import { COMPLETE, combineCoverage } from "./types.ts";

// In source execution this hashes the actual exporter module; in the generated
// service it hashes that actual bundle. Never a claimed release/build identity
// copied from a fixture, a timestamp, or the consumer's working directory.
let exporterIdentity: string | undefined;
function buildIdentity(): string {
  exporterIdentity ??= createHash("sha256")
    .update(readFileSync(new URL(import.meta.url)))
    .digest("hex");
  return exporterIdentity;
}
function aborted(signal: AbortSignal): void {
  if (signal.aborted) throw new ContractError("unavailable");
}
const yieldTurn = () => new Promise<void>((resolve) => setImmediate(resolve));
/** UTF-8 scalar-safe bounded Markdown chunks; limits apply to the FULL frame
 * encoding too. Small raw chunks leave worst-case JSON escaping headroom. */
function* textChunks(text: string): Generator<string> {
  const bytes = Buffer.from(text);
  for (let at = 0; at < bytes.length; ) {
    let end = Math.min(bytes.length, at + 32 * 1024);
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    yield bytes.subarray(at, end).toString("utf8");
    at = end;
  }
}
function recordTitle(record: HistoryRecord): string {
  switch (record.kind) {
    case "task":
      return `Task ${record.owner.taskId}`;
    case "run":
      return `Recorded ${record.projection.childRunId ? "child" : "run"} ${record.projection.childRunId ?? record.projection.runId}`;
    case "owner-fact":
      return `Owner observation: ${record.fact.kind}`;
    case "capture-fact":
      return `Captured observation: ${record.capture.event.kind}`;
    default:
      return `Retained ${record.kind}`;
  }
}
function* markdown(
  event: Exclude<ExportEvent, { kind: "manifest" | "trailer" | "markdown" }>,
): Generator<string> {
  if (event.kind === "detail") {
    yield `\n\n### ${event.content.field} — ${event.content.recordId} / v${event.content.version}\n\nEntity: ${event.owner.entity.kind} ${event.owner.entity.id} / v${event.owner.entity.version}. UTF-8 bytes ${event.range?.start ?? 0}–${event.range?.end ?? 0} of ${event.content.bytes}.\n\n`;
    // Indentation makes arbitrary recorded fences inert; chunks are labelled
    // exact retained ranges, not silently concatenated with invented separators.
    yield* textChunks(
      event.text
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n"),
    );
    yield `\n\nCoverage: ${canonicalJson(event.coverage)}\n`;
  } else {
    yield `\n\n## ${event.kind === "graph" ? "Frozen graph and identity" : recordTitle(event.record)}\n\n\`\`\`json\n`;
    yield* textChunks(
      canonicalJson(event.kind === "graph" ? event.graph : event.record),
    );
    yield "\n```\n";
  }
}

export async function* exportHistory(
  projection: HistoryProjection,
  input: ExportRequest,
  signal: AbortSignal,
): AsyncGenerator<ExportFrame> {
  const request = decodeExportRequest(input),
    exportId = randomUUID(),
    digest = createHash("sha256");
  let ordinal = 0,
    encodedBytes = 0,
    coverage: CaptureCoverage = { ...COMPLETE, omissions: [] };
  const frame = (event: ExportEvent): ExportFrame => {
    aborted(signal);
    const f = decodeExportFrame({ exportId, ordinal: ++ordinal, event });
    if (event.kind !== "trailer") {
      const encoded = encodeExportFrame(f, request.format);
      digest.update(encoded);
      encodedBytes += Buffer.byteLength(encoded);
      if (!Number.isSafeInteger(encodedBytes))
        throw new ContractError("capacity");
    }
    return f;
  };
  const emit = function* (
    event: Exclude<ExportEvent, { kind: "manifest" | "trailer" | "markdown" }>,
  ) {
    if (request.format === "ndjson") yield frame(event);
    else
      for (const text of markdown(event))
        yield frame({ kind: "markdown", text });
  };
  const point: ScanPoint = {
    pos: { segment: 1, offset: 0 },
    row: 0,
    event: 0,
    byte: 0,
    snapshot: 0,
  };
  const scan = new RetainedScan(
    projection.reader,
    request,
    new HistoryReadBudget(),
    true,
  );
  // Snapshot proof can exceed one window with no indexes. Yield to cancellation
  // between windows; never label a future/missing snapshot a complete archive.
  for (let stalls = 0; ; ) {
    aborted(signal);
    const before = canonicalJson({ point, state: scan.checkpoint() });
    scan.renew(new HistoryReadBudget());
    try {
      scan.prepare(point);
      break;
    } catch (error) {
      if (
        !(error instanceof ContractError) ||
        error.code !== "receipt-inconclusive"
      )
        throw error;
      // No progress refuses, except a bounded number of pure time stalls.
      if (before === canonicalJson({ point, state: scan.checkpoint() })) {
        if (!scan.budget.elapsed || ++stalls > STALL_RETRIES) throw error;
      } else stalls = 0;
      await yieldTurn();
    }
  }
  yield frame({
    kind: "manifest",
    schema: EXPORT_SCHEMA,
    request,
    coverage,
    serviceProtocol: 1,
    workerProtocol: 2,
    provenance: {
      exporterBuildSha256: buildIdentity(),
      capturePolicy: "public-text-tools/2",
    },
  });

  // Reuse the reviewed semantic reducer during the same retained scan. At most
  // the admitted active episode set is retained; drained states are emitted and
  // discarded. Later publication/review facts remain their own observations.
  const runs = new Map<string, RunState>();
  let appliedRow: string | undefined;
  const open = new Map<
    string,
    { bytes: number; content: string; hash: ReturnType<typeof createHash> }
  >();
  type DataEvent = Exclude<
    ExportEvent,
    { kind: "manifest" | "trailer" | "markdown" }
  >;
  const consume = (item: RetainedItem): DataEvent[] => {
    if (item.kind === "record" || item.kind === "graph") return [item];
    if (item.kind === "end") {
      const { detail, owner } = item,
        original = open.get(detail.content.recordId);
      if (
        detail.content.bytes
          ? !original ||
            original.bytes !== detail.content.bytes ||
            original.content !== canonicalJson(detail.content)
          : original !== undefined
      )
        throw new ContractError("corrupt-selected");
      if (
        (original?.hash ?? createHash("sha256")).digest("hex") !==
        detail.content.sha256
      )
        throw new ContractError("corrupt-selected");
      open.delete(detail.content.recordId);
      const events: DataEvent[] = [];
      if (!detail.content.bytes)
        events.push({
          kind: "detail",
          owner,
          content: detail.content,
          range: null,
          text: "",
          coverage: detail.coverage,
        });
      if (detail.descriptor)
        events.push({
          kind: "record",
          record: {
            kind: "content",
            owner,
            version: detail.content.version,
            detailId: detail.detailId,
            descriptor: detail.descriptor,
            content: detail.content,
            coverage: detail.coverage,
          },
        });
      return events;
    }
    coverage = combineCoverage(coverage, item.coverage);
    const length = Buffer.byteLength(item.text);
    if (item.inline) {
      if (
        item.start !== 0 ||
        length !== item.content.bytes ||
        createHash("sha256").update(item.text).digest("hex") !==
          item.content.sha256
      )
        throw new ContractError("corrupt-selected");
    } else {
      let original = open.get(item.content.recordId);
      if (!original) {
        if (item.start !== 0 || open.size >= LIMITS.ownerQueueFrames)
          throw new ContractError("corrupt-selected");
        original = {
          bytes: 0,
          content: canonicalJson(item.content),
          hash: createHash("sha256"),
        };
        open.set(item.content.recordId, original);
      }
      if (
        original.bytes !== item.start ||
        original.content !== canonicalJson(item.content)
      )
        throw new ContractError("corrupt-selected");
      original.hash.update(item.text);
      original.bytes += length;
      // Keep the original hash/account until its real committed end, not merely
      // until a chunk's claimed byte count happens to equal the content length.
    }
    return [
      {
        kind: "detail",
        owner: item.owner,
        content: item.content,
        range: item.content.bytes
          ? { start: item.start, end: item.start + length }
          : null,
        text: item.text,
        coverage: item.coverage,
      },
    ];
  };
  let finished = false,
    stalls = 0;
  while (!finished) {
    aborted(signal);
    const before = canonicalJson({ point, state: scan.checkpoint() });
    scan.renew(new HistoryReadBudget());
    try {
      scan.prepare(point);
      for (;;) {
        const batch = scan.next(point);
        if (!batch) {
          finished = true;
          break;
        }
        for (; point.row < batch.rows.length; point.row++, point.event = 0) {
          const row = batch.rows[point.row],
            count = scan.count(row);
          if (appliedRow !== row.id) {
            const v = row.value;
            if (
              v.kind === "admission" &&
              v.intent.runId &&
              v.intent.identity.kind === "action"
            ) {
              if (runs.size >= LIMITS.episodes || runs.has(v.intent.runId))
                throw new ContractError("corrupt-selected");
              runs.set(v.intent.runId, new RunState(v.intent.runId));
            }
            for (const state of runs.values())
              state.apply(row, batch.pointer.seq);
            appliedRow = row.id;
            for (const [id, state] of runs)
              if (state.drained || v.kind === "recovery") {
                runs.delete(id);
                for (const projectionRecord of projection.projectRun(
                  state,
                  request.scope,
                )) {
                  coverage = combineCoverage(
                    coverage,
                    projectionRecord.coverage,
                  );
                  yield* emit({
                    kind: "record",
                    record: { kind: "run", projection: projectionRecord },
                  });
                }
              }
          }
          for (; point.event < count; ) {
            aborted(signal);
            scan.budget.reserve(0);
            const item = scan.item(batch, row, point.event);
            // Advance BEFORE yielding: returning/aborting cannot reissue a read.
            point.event = scan.advance(row, point.event);
            if (item) {
              for (const event of consume(item)) yield* emit(event);
            }
          }
        }
        if (batch.pointer.seq === request.snapshotSeq) {
          finished = true;
          break;
        }
        point.pos = batch.next;
        point.row = 0;
        point.event = 0;
      }
      if (finished) scan.finish();
    } catch (error) {
      if (
        !(error instanceof ContractError) ||
        error.code !== "receipt-inconclusive"
      )
        throw error;
      // No progress refuses, except a bounded number of pure time stalls.
      if (before === canonicalJson({ point, state: scan.checkpoint() })) {
        if (!scan.budget.elapsed || ++stalls > STALL_RETRIES) throw error;
      } else stalls = 0;
      finished = false;
    }
    coverage = combineCoverage(coverage, scan.coverage);
    if (!finished) await yieldTurn();
  }
  aborted(signal);
  if (open.size) throw new ContractError("corrupt-selected");
  for (const state of runs.values())
    for (const projectionRecord of projection.projectRun(
      state,
      request.scope,
    )) {
      coverage = combineCoverage(coverage, projectionRecord.coverage);
      yield* emit({
        kind: "record",
        record: { kind: "run", projection: projectionRecord },
      });
    }
  yield frame({
    kind: "trailer",
    complete: coverage.observed === "complete",
    frames: ordinal,
    encodedBytes,
    sha256: digest.digest("hex"),
    committedSeq: request.snapshotSeq,
    coverage,
  });
  // Exactly original generator EOF after the one original trailer.
}
