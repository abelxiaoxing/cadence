/** Native parent-check output, not SDK frames. One bounded owner detail. */
import { randomUUID } from "node:crypto";
import {
  type CaptureCoverage,
  type ContentRef,
  ContractError,
  LIMITS,
  type OwnerLink,
  type OwnerRecordingEvent,
} from "../service-contract.ts";
import { TextSanitizer } from "../worker-redaction.mjs";
import type { OwnerJournalPort } from "./ports.ts";

export const CHECK_RAW_BYTES = 16 * 1024 * 1024;
export type CheckStream = "stdout" | "stderr";
/** Private owner callbacks, never serialized or supplied to the command. */
export interface CheckLiteralSource {
  current(): readonly string[];
  onChange(listener: () => void): () => void;
}
export class CheckRecording {
  private readonly detailId = randomUUID();
  private raw = 0;
  private bytes = 0;
  private failed = false;
  private ended = false;
  private content: ContentRef | null = null;
  private readonly tails: Record<CheckStream, Promise<void>> = {
    stdout: Promise.resolve(),
    stderr: Promise.resolve(),
  };
  private readonly streams;
  private readonly prefix;
  private unsubscribe?: () => void;
  private refreshing = false;
  constructor(
    private readonly port: OwnerJournalPort,
    private readonly link: OwnerLink,
    private readonly checkId: string,
    secrets: readonly string[],
    private readonly source?: CheckLiteralSource,
  ) {
    // Two bounded literal sets + pending literal prefixes, heuristic/ANSI states
    // and incremental UTF-8 tails. Charge before construction or literal updates.
    this.prefix = this.reserve(
      2 * (4 * LIMITS.workerRequestBytes + 2 * 8192 + 4),
      0,
      0,
    );
    try {
      this.streams = {
        stdout: {
          decoder: new TextDecoder("utf-8", { fatal: true }),
          sanitizer: new TextSanitizer(secrets),
        },
        stderr: {
          decoder: new TextDecoder("utf-8", { fatal: true }),
          sanitizer: new TextSanitizer(secrets),
        },
      };
      this.refresh();
      this.unsubscribe = source?.onChange(() => {
        // Access assertion itself can revoke on uncertainty. Never recurse or
        // throw into rotation; fail this recorder without canceling healthy work.
        if (this.refreshing || this.failed || this.ended) return;
        try {
          this.refresh();
        } catch {
          this.failed = true;
        }
      });
    } catch (error) {
      this.prefix.release();
      throw error;
    }
  }
  private refresh(): void {
    if (this.failed) throw new ContractError("unavailable");
    if (!this.source) return;
    this.refreshing = true;
    try {
      const literals = this.source.current();
      this.streams.stdout.sanitizer.addSecrets(literals);
      this.streams.stderr.sanitizer.addSecrets(literals);
    } catch (error) {
      this.failed = true;
      throw error;
    } finally {
      this.refreshing = false;
    }
  }
  private reserve(
    retainedBytes: number,
    outputBytes: number,
    outputChunks: number,
  ) {
    const reserved = this.port.reserve({
      sourceFrames: 0,
      retainedBytes,
      outputBytes,
      outputChunks,
      lane: "data",
    });
    if (reserved.status !== "reserved") throw new ContractError("capacity");
    return reserved.reservation;
  }
  private async commit(
    events: OwnerRecordingEvent[],
    reservation = this.reserve(0, 64 * 1024, events.length),
  ) {
    const result = await reservation.commit({
      link: this.link,
      observedMs: Math.floor(performance.now()),
      events,
    });
    if (result.status !== "committed")
      throw new ContractError("recording-exhausted");
    return result.batch;
  }
  async begin(): Promise<void> {
    try {
      this.refresh();
      await this.commit([
        {
          kind: "content-begin",
          detailId: this.detailId,
          owner: {
            taskId: this.link.taskId,
            runId: this.link.runId,
            childRunId: null,
            entity: { kind: "check", id: this.checkId, version: 1 },
          },
          field: "check",
          encoding: "utf8",
        },
      ]);
      await this.text(
        "Native check output: independently sanitized stdout/stderr chunks in owner observation order; not a reconstructed OS write order.\n",
      );
    } catch (error) {
      this.failed = true;
      this.unsubscribe?.();
      this.prefix.release();
      throw error;
    }
  }
  private async text(text: string): Promise<void> {
    // A caller holds the raw/transform reservation before allocating this text.
    this.bytes += Buffer.byteLength(text);
    if (this.bytes > LIMITS.detailBytes) throw new ContractError("oversize");
    const count = Math.ceil(text.length / 2047) + 1;
    const reserved = this.reserve(
      Buffer.byteLength(text) * 2,
      Buffer.byteLength(text) * 6 + count * 1024,
      count,
    );
    const events: OwnerRecordingEvent[] = [];
    for (let at = 0; at < text.length; ) {
      let end = Math.min(at + 2048, text.length); // <=8192 UTF-8 bytes
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
      events.push({
        kind: "content-chunk",
        detailId: this.detailId,
        text: text.slice(at, end),
      });
      at = end;
    }
    await this.commit(events, reserved);
  }
  /** Called synchronously on ingress, before retaining any asynchronous work. */
  receive(chunk: Buffer, stream: CheckStream): Promise<void> {
    if (this.failed || this.ended)
      return Promise.reject(new ContractError("unavailable"));
    this.refresh();
    this.raw += chunk.length;
    if (chunk.length > 64 * 1024 || this.raw > CHECK_RAW_BYTES) {
      this.failed = true;
      return Promise.reject(new ContractError("oversize"));
    }
    // Node may resume a paused stdio stream on child exit (flushStdio). Charge
    // that real ingress BEFORE queuing it; serialize each stream's decoder and
    // retain every original continuation, rather than overwriting the last job.
    const raw = this.reserve(chunk.length + 1024, 0, 0);
    const original = this.tails[stream]
      .then(async () => {
        if (this.failed) throw new ContractError("unavailable");
        const state = this.streams[stream];
        // Literal replacement is at most ten bytes per source byte. Include
        // held prefixes and the decoder tail before creating transformed text.
        const transform = this.reserve(
          (chunk.length + state.sanitizer.retainedBytes + 4) * 12 + 64,
          0,
          0,
        );
        try {
          this.refresh();
          const text = state.sanitizer.write(
            state.decoder.decode(chunk, { stream: true }),
          );
          if (text) await this.text(`\n[${stream}]\n${text}`);
        } finally {
          transform.release();
        }
      })
      .catch((error) => {
        this.failed = true;
        throw error;
      })
      .finally(() => raw.release());
    this.tails[stream] = original;
    return original;
  }
  async end(complete: boolean): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    try {
      // Stop can cause later native callbacks to be discarded; the last runner
      // callback is then not the last original recorder job. Join both tails.
      await Promise.allSettled(Object.values(this.tails));
      if (!complete || this.failed) {
        this.failed = true;
        return;
      }
      this.refresh();
      for (const stream of ["stdout", "stderr"] as const) {
        const state = this.streams[stream];
        const transform = this.reserve(
          (state.sanitizer.retainedBytes + 4) * 12 + 64,
          0,
          0,
        );
        try {
          const text = state.sanitizer.write(state.decoder.decode(), true);
          if (text) await this.text(`\n[${stream}]\n${text}`);
        } finally {
          transform.release();
        }
      }
      const batch = await this.commit([
        {
          kind: "content-end",
          detailId: this.detailId,
          coverage: this.coverage,
        },
      ]);
      if (batch.ownerDetails.length !== 1) throw new ContractError("conflict");
      this.content = batch.ownerDetails[0].content;
    } catch (error) {
      this.failed = true;
      throw error;
    } finally {
      this.unsubscribe?.();
      this.prefix.release();
    }
  }
  get coverage(): CaptureCoverage {
    return {
      observed: this.failed ? "incomplete" : "complete",
      source: this.failed ? "limited" : "complete",
      redacted:
        this.streams.stdout.sanitizer.redacted ||
        this.streams.stderr.sanitizer.redacted,
      omissions: this.failed ? ["capture-limit"] : [],
    };
  }
  result(): { output: ContentRef | null; coverage: CaptureCoverage } {
    if (!this.ended || !this.content) this.failed = true;
    return { output: this.content, coverage: this.coverage };
  }
}
