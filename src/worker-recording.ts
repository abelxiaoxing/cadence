import type { CaptureReservation, CaptureSink } from "./service/ports.ts";
import { chunks, controlEvent } from "./worker-capture.mjs";
import {
  type CaptureFrame,
  ContractError,
  canonicalJson,
  type DetailCommit,
  decodeCommittedBatch,
  decodeRecordingInput,
  type FinalRecording,
  type FinalSelection,
  LIMITS,
  publicError,
  type RecordingLink,
  type SanitizedCaptureEvent,
  type SourceRange,
  utf8Bytes,
} from "./worker-public.mjs";
import { DetailSanitizer, sanitizeText } from "./worker-redaction.mjs";

/** Owner-only second projection. No memory/durable fallback and no browser token
 * crosses stdin. Original write promises retain their sink charges after stall. */
export class WorkerRecording {
  private details = new Map<
    string,
    {
      sanitizer: DetailSanitizer;
      prefix: CaptureReservation;
      prefixBytes: number;
      source: SourceRange | null;
    }
  >();
  private commits = new Map<string, DetailCommit>();
  private pending = new Set<Promise<void>>();
  private failure: "pending" | "uncertain" | "refused" | null = null;
  private pendingBytes = 0;
  private pendingSlots = 0;
  private parser: CaptureReservation;
  private rawSizes = new WeakMap<CaptureReservation, number>();
  constructor(
    readonly link: RecordingLink,
    private sink: CaptureSink,
    private secrets: readonly string[],
    private stop: () => void,
  ) {
    if (!sink || typeof sink.reserve !== "function")
      throw new ContractError("unavailable");
    // Preallocated BEFORE spawn/decode: covers the bounded pending UTF-8 frame,
    // original line and own-data codec copies, including control at data saturation.
    const parser = sink.reserve({
      sourceFrames: 0,
      retainedBytes: LIMITS.frameBytes * 8,
      outputBytes: 0,
      outputChunks: 0,
      lane: "control",
    });
    if (parser.status !== "reserved") throw new ContractError("capacity");
    this.parser = parser.reservation;
  }
  reserveRaw(bytes: number): CaptureReservation {
    const result = this.sink.reserve({
      sourceFrames: 0,
      retainedBytes: bytes * 3,
      outputBytes: 0,
      outputChunks: 0,
      lane: "control",
    });
    if (result.status !== "reserved") {
      this.failure = "refused";
      this.stop();
      throw new ContractError("recording-exhausted");
    }
    this.rawSizes.set(result.reservation, bytes);
    return result.reservation;
  }
  accept(frame: CaptureFrame, lease: CaptureReservation): void {
    let consumed = false;
    try {
      const source: SourceRange = {
        first: frame.workerSeq,
        last: frame.workerSeq,
        firstObservedMs: frame.observedMs,
        lastObservedMs: frame.observedMs,
      };
      const e = frame.event;
      const rawBytes = this.rawSizes.get(lease) ?? LIMITS.frameBytes;
      const lane = controlEvent(e.kind) ? "control" : "data";
      const transferred = this.sink.reserve({
        sourceFrames: 1,
        retainedBytes: rawBytes * 3,
        outputBytes: 0,
        outputChunks: 0,
        lane,
      });
      if (transferred.status !== "reserved")
        throw new ContractError("capacity");
      this.rawSizes.delete(lease);
      lease.release();
      lease = transferred.reservation;
      // Acquire worst-case output/escaped expansion before creating it. Source
      // control lane has separate headroom in W3; data cannot impersonate it.
      const retained =
        e.kind === "detail-chunk" || e.kind === "detail-end"
          ? (this.details.get(e.detailId)?.sanitizer.retainedBytes ?? 0)
          : 0;
      const allowance = (rawBytes + retained) * 12 + 2048;
      this.rawSizes.delete(lease);
      if (
        lease.grow({
          sourceFrames: 0,
          retainedBytes: 0,
          outputBytes: allowance,
          outputChunks: Math.ceil(allowance / 2048) + 2,
          lane,
        }).status !== "reserved"
      )
        throw new ContractError("capacity");
      let events: SanitizedCaptureEvent[];
      let range = source;
      if (e.kind === "detail-begin") {
        const prefixBytes =
          this.secrets.reduce((n, s) => Math.max(n, utf8Bytes(s)), 0) * 4 +
          65536 +
          (e.descriptor.encoding === "canonical-json" ? 1024 * 1024 : 0);
        const reserved = this.sink.reserve({
          sourceFrames: 0,
          retainedBytes: prefixBytes,
          outputBytes: 0,
          outputChunks: 0,
          lane: "data",
        });
        if (reserved.status !== "reserved") throw new ContractError("capacity");
        const partial =
          e.descriptor.owner.kind === "tool" &&
          e.descriptor.owner.stage === "arguments-partial";
        this.details.set(e.detailId, {
          sanitizer: new DetailSanitizer(
            partial ? "canonical-json" : e.descriptor.encoding,
            this.secrets,
            partial,
          ),
          prefix: reserved.reservation,
          prefixBytes,
          source: null,
        });
        events = [e];
      } else if (e.kind === "detail-chunk" || e.kind === "detail-end") {
        const detail = this.details.get(e.detailId);
        if (!detail) throw new ContractError();
        const first = detail.source ?? source;
        range = {
          ...first,
          last: source.last,
          lastObservedMs: source.lastObservedMs,
        };
        const output =
          e.kind === "detail-chunk"
            ? detail.sanitizer.write(e.text)
            : detail.sanitizer.end();
        const extra = detail.sanitizer.retainedBytes - detail.prefixBytes;
        if (extra > 0) {
          if (
            detail.prefix.grow({
              sourceFrames: 0,
              retainedBytes: extra,
              outputBytes: 0,
              outputChunks: 0,
              lane: "data",
            }).status !== "reserved"
          )
            throw new ContractError("capacity");
          detail.prefixBytes += extra;
        }
        events = [...chunks(output)].map((text) => ({
          kind: "stored-chunk",
          detailId: e.detailId,
          text,
        }));
        // Keep provenance of held prefixes, even if some output was emitted.
        detail.source = detail.sanitizer.retainedBytes ? range : null;
        if (e.kind === "detail-end") {
          events.push({
            kind: "stored-end",
            detailId: e.detailId,
            coverage: {
              ...e.coverage,
              redacted: e.coverage.redacted || detail.sanitizer.redacted,
              source: detail.sanitizer.limited ? "limited" : e.coverage.source,
              omissions: detail.sanitizer.limited
                ? [
                    ...new Set([
                      ...e.coverage.omissions,
                      "unsupported" as const,
                    ]),
                  ]
                : e.coverage.omissions,
            },
          });
          // Destination expansion is already charged before transferring prefix.
          detail.prefix.release();
          this.details.delete(e.detailId);
        }
      } else if (
        e.kind === "tool-start" ||
        e.kind === "tool-end" ||
        e.kind === "call-declaration"
      ) {
        const value = e.source.value;
        events = [
          {
            ...e,
            name: sanitizeText(e.name, this.secrets),
            source:
              value !== null && sanitizeText(value, this.secrets) !== value
                ? { disposition: "redacted", value: null }
                : e.source,
          },
        ];
      } else if (e.kind === "message-start") {
        const value = e.source.value;
        events = [
          {
            ...e,
            source:
              value !== null && sanitizeText(value, this.secrets) !== value
                ? { disposition: "redacted", value: null }
                : e.source,
          },
        ];
      } else if (e.kind === "omitted-block") {
        // sourceType/reason are closed code-owned enums, MIME is source text.
        const mimeType = e.block.mimeType;
        const redacted =
          mimeType !== null &&
          sanitizeText(mimeType, this.secrets) !== mimeType;
        events = [
          { ...e, block: { ...e.block, mimeType: redacted ? null : mimeType } },
        ];
        if (redacted)
          events.push({
            kind: "capture-status",
            coverage: {
              observed: "complete",
              source: "limited",
              redacted: true,
              omissions: [e.block.reason],
            },
          });
      } else events = [e];
      const input = decodeRecordingInput({
        link: this.link,
        source: range,
        events: events.map((event) => ({ source: range, event })),
      });
      if (utf8Bytes(canonicalJson(input)) > allowance)
        throw new ContractError("capacity");
      consumed = true;
      // Invoke in source order, without serializing acknowledgments: W3 owns
      // the ONE serialized writer and must be able to batch concurrent inputs.
      // The native reader waits at the bounded window below before more copying.
      const charge = rawBytes * 3 + allowance;
      const slots = 1 + Math.ceil(allowance / 2048) + 2;
      this.pendingBytes += charge;
      this.pendingSlots += slots;
      const original = (async () => {
        const result = await lease.commit(input);
        if (result.status !== "committed") {
          this.failure =
            result.durability === "uncertain" ? "uncertain" : "refused";
          this.stop();
          return;
        }
        const batch = decodeCommittedBatch(result.batch);
        for (const detail of batch.details) {
          if (detail.childRunId !== this.link.childRunId)
            throw new ContractError();
          this.commits.set(detail.detailId, detail);
        }
      })();
      const handled = original.catch(() => {
        this.failure = "uncertain";
        this.stop();
      });
      this.pending.add(handled);
      const timer = setTimeout(() => {
        this.failure = "uncertain";
        this.stop();
      }, LIMITS.recordingStallMs);
      void handled.then(() => {
        clearTimeout(timer);
        this.pending.delete(handled);
        this.pendingBytes -= charge;
        this.pendingSlots -= slots;
      });
    } catch {
      this.failure = "refused";
      try {
        if (!consumed) lease.release();
      } catch {
        this.failure = "uncertain";
      }
      this.stop();
    }
  }
  async writable(signal: AbortSignal): Promise<void> {
    // Admission window, not new limits. Leave room for the next maximum frame,
    // its expansion and retained field prefixes/control within the shared pool.
    while (
      !this.failure &&
      !signal.aborted &&
      (this.pendingBytes >= LIMITS.ownerQueueBytes / 2 ||
        this.pendingSlots >= LIMITS.ownerQueueFrames / 2)
    ) {
      let abort: () => void = () => {};
      try {
        await Promise.race([
          ...this.pending,
          new Promise<void>((resolve) => {
            abort = resolve;
            signal.addEventListener("abort", abort, { once: true });
            if (signal.aborted) resolve();
          }),
        ]);
      } finally {
        signal.removeEventListener("abort", abort);
      }
    }
  }
  closeIngress(): void {
    // Each unused lease is independent; an opaque release error cannot hide
    // native facts, escape to the client, or prevent the other cleanup attempts.
    for (const lease of [
      this.parser,
      ...[...this.details.values()].map((d) => d.prefix),
    ]) {
      try {
        lease.release();
      } catch {
        this.failure = "uncertain";
        this.stop();
      }
    }
    this.details.clear();
  }
  async drain(): Promise<void> {
    if (!this.pending.size) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all([...this.pending]),
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          this.failure = "uncertain";
          this.stop();
          resolve();
        }, LIMITS.recordingStallMs);
      }),
    ]);
    clearTimeout(timer);
  }
  result(selected: FinalSelection | null): FinalRecording {
    if (this.failure === "refused")
      return {
        status: "refused",
        selected,
        error: publicError("recording-exhausted", "uncertain"),
      };
    if (this.failure || this.pending.size)
      return { status: "uncertain", selected };
    const detail = selected && this.commits.get(selected.detailId);
    if (!selected || !detail) return { status: "pending", selected };
    if (detail.content.field !== "final-text")
      return { status: "uncertain", selected };
    return { status: "committed", selected, detail };
  }
  get incomplete(): boolean {
    return this.failure !== null;
  }
}
