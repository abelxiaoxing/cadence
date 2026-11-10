/** Complete structured worker reports and bounded capture projection, independent of orchestration. */

import { diagnosticText } from "../verification-diagnostics.ts";
import type { CaptureFrame } from "../worker-public.mjs";
import { sanitizeText } from "../worker-redaction.mjs";
import { canonicalJson, closed, parseWireJson } from "./contracts/core.ts";
import type { ChatTurn } from "./contracts/workbench.ts";
import { TurnCapture } from "./turn-capture.ts";

const RECORD_BYTES = 384 * 1024;
const TRANSCRIPT_LIMIT =
  "Transcript bound reached: later worker activity was not retained here. The worker continued; its outcome and final result are recorded separately.";

/** Accepts the requested JSON verdict alone, fenced, or embedded in prose. */
export function reviewVerdict(
  reply: string,
): { approved: boolean; summary: string; blockingIssues: string[] } | null {
  let malformed = false;
  const decode = (raw: string) => {
    let v: unknown;
    try {
      v = parseWireJson(raw, RECORD_BYTES);
    } catch {
      // JSON.parse's last-key-wins projection may identify an invalid verdict,
      // but must never supply one: duplicate approved/issues keys are ambiguous.
      try {
        const value = JSON.parse(raw);
        if (
          value &&
          typeof value === "object" &&
          Object.hasOwn(value, "approved")
        )
          malformed = true;
      } catch {
        /* Prose surrounding a verdict is not itself JSON. */
      }
      return null;
    }
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const o = v as Record<string, unknown>;
    if (typeof o.approved !== "boolean") return null;
    const issues = o.blockingIssues === undefined ? [] : o.blockingIssues;
    if (
      !Array.isArray(issues) ||
      issues.some((issue) => typeof issue !== "string")
    )
      return null;
    return {
      approved: o.approved && issues.length === 0,
      summary: typeof o.summary === "string" ? o.summary : "",
      blockingIssues: issues as string[],
    };
  };
  const body = reply.trim();
  const direct = decode(body);
  if (direct) return direct;
  if (malformed) return null;
  // Every parseable verdict object in the reply must agree; an example and a
  // contrary answer side by side is ambiguous, never an approval.
  const found: NonNullable<ReturnType<typeof decode>>[] = [];
  let starts = 0,
    start = body.indexOf("{");
  for (
    ;
    start >= 0 && starts < 64;
    start = body.indexOf("{", start + 1), starts++
  ) {
    let depth = 0,
      quoted = false,
      escaped = false;
    for (let i = start; i < body.length; i++) {
      const c = body[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        const verdict = decode(body.slice(start, i + 1));
        if (verdict) found.push(verdict);
        break;
      }
    }
  }
  if (
    malformed ||
    start >= 0 ||
    !found.length ||
    found.some((v) => v.approved !== found[0].approved)
  )
    return null;
  return found[0];
}
/** Parse the complete selected review before making any display projection.
 * Bounded field excerpts keep JSON valid and preserve the verdict derived from
 * ALL issues; the raw selected message remains in the retained transcript. */
export function reviewReport(
  reply: string,
  secrets: readonly string[],
): { text: string; truncated: boolean } {
  const verdict = reviewVerdict(reply);
  if (!verdict)
    return {
      text: "Agent review did not return one unambiguous complete verdict.",
      truncated: false,
    };
  const cleanSummary = sanitizeText(verdict.summary, secrets);
  const cleanIssues = verdict.blockingIssues.map((issue) =>
    sanitizeText(issue, secrets),
  );
  return {
    // At most 6KiB of fields; even JSON escaping fits the 16KiB reply allowance.
    text: canonicalJson(
      {
        approved: verdict.approved,
        summary: diagnosticText(cleanSummary, 2048),
        blockingIssues: cleanIssues
          .slice(0, 16)
          .map((issue) => diagnosticText(issue, 256)),
      },
      16384,
    ),
    truncated:
      Buffer.byteLength(cleanSummary) > 2048 ||
      cleanIssues.length > 16 ||
      cleanIssues.some((issue) => Buffer.byteLength(issue) > 256),
  };
}

/** A task report is separate from native worker closure and from verification.
 * Accept one complete JSON object (optionally fenced), never infer completion
 * from prose, a partial reply, or a zero process exit. */
export function implementationReport(
  reply: string,
  secrets: readonly string[] = [],
): {
  status: "completed" | "blocked";
  summary: string;
  /** What the worker proposes as worth knowing next time; unverified. */
  lessons?: string[];
} | null {
  try {
    const body = reply
      .trim()
      .replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/u, "$1");
    const raw = parseWireJson(body, 16384);
    const o = closed(raw, [
      "status",
      "summary",
      ...(Object.hasOwn((raw ?? {}) as object, "lessons") ? ["lessons"] : []),
    ]);
    if (o.status !== "completed" && o.status !== "blocked") return null;
    if (typeof o.summary !== "string" || !o.summary.trim()) return null;
    if (
      o.lessons !== undefined &&
      (!Array.isArray(o.lessons) ||
        o.lessons.length > 5 ||
        o.lessons.some(
          (lesson) =>
            typeof lesson !== "string" || !lesson.trim() || lesson.length > 400,
        ))
    )
      return null;
    // Decode structure before sanitizing field values: display regexes must
    // never eat JSON delimiters, and escaped literals need decoding first.
    const summary = sanitizeText(o.summary, secrets);
    const lessons = ((o.lessons as string[] | undefined) ?? [])
      .map((lesson) => sanitizeText(lesson, secrets).trim())
      .filter(Boolean);
    return summary.trim()
      ? { status: o.status, summary, ...(lessons.length ? { lessons } : {}) }
      : null;
  } catch {
    return null;
  }
}
/** Workflow worker transcript. Its bound limits what is retained, never the
 * worker: past the bound a labelled prefix is kept and the worker continues.
 * The latest assistant message is tracked separately so the final result is
 * selected from sanitized complete text, never a raw clipped preview. */
export class WorkflowTranscript {
  overflowed = false;
  private pending = false;
  private readonly capture: TurnCapture;
  /** Null while the current assistant message exceeds the tracker's bound. */
  private final: TurnCapture | null = null;
  private latest: ChatTurn;
  private readonly messageDetails = new Set<string>();
  private reportCapture: TurnCapture | undefined;
  private reportTurn: ChatTurn | undefined;
  private reportId: string | undefined;
  private readonly reportDetails = new Set<string>();
  private reportText: string | undefined;
  /** Report tool results are retained independently of transcript preview limits. */
  assignmentReport(): string | undefined {
    if (this.reportText === undefined) return;
    try {
      const value = closed(parseWireJson(this.reportText, 65536), ["content"]);
      if (!Array.isArray(value.content) || value.content.length !== 1) return;
      const item = closed(value.content[0], ["type", "text"]);
      return item.type === "text" && typeof item.text === "string"
        ? item.text
        : undefined;
    } catch {
      return;
    }
  }
  private trackReport(frame: CaptureFrame): void {
    const e = frame.event;
    if (e.kind === "tool-start") {
      this.reportText = undefined;
      this.reportDetails.clear();
      this.reportCapture = undefined;
      this.reportTurn = undefined;
      this.reportId = undefined;
      if (e.name === "cadence_report") {
        this.reportId = e.callId;
        this.reportTurn = { ...structuredClone(this.turn), items: [] };
        this.reportCapture = new TurnCapture(
          this.reportTurn,
          () => {},
          this.secrets,
        );
        this.reportCapture.accept(frame);
      }
      return;
    }
    if (!this.reportCapture || !this.reportId) return;
    if (
      e.kind === "detail-begin" &&
      e.descriptor.owner.kind === "tool" &&
      e.descriptor.owner.callId === this.reportId
    ) {
      this.reportDetails.add(e.detailId);
      this.reportCapture.accept(frame);
    } else if (
      (e.kind === "detail-chunk" || e.kind === "detail-end") &&
      this.reportDetails.has(e.detailId)
    ) {
      this.reportCapture.accept(frame);
      if (e.kind === "detail-end") this.reportDetails.delete(e.detailId);
    } else if (e.kind === "tool-end" && e.callId === this.reportId) {
      this.reportCapture.accept(frame);
      if (!e.isError && !this.reportDetails.size)
        this.reportText = this.reportTurn?.items.find(
          (i) => i.id === this.reportId,
        )?.text;
      this.reportCapture = undefined;
    }
  }
  constructor(
    readonly turn: ChatTurn,
    private readonly secrets: () => readonly string[],
  ) {
    this.capture = new TurnCapture(
      turn,
      () => {
        this.pending = true;
      },
      secrets,
    );
    this.latest = { ...structuredClone(turn), items: [] };
  }
  /** True when the retained transcript should be persisted now. */
  accept(frame: CaptureFrame): boolean {
    try {
      this.trackReport(frame);
    } catch {
      this.reportText = undefined;
      this.reportCapture = undefined;
    }
    this.track(frame);
    if (this.overflowed) {
      // Progress is bounded metadata, independent of retained transcript text.
      if (frame.event.kind === "model-retry") {
        if (frame.event.progress) this.turn.retry = frame.event.progress;
        else delete this.turn.retry;
        return true;
      }
      if (frame.event.kind === "worker-failure") {
        delete this.turn.retry;
        return true;
      }
      return false;
    }
    try {
      this.capture.accept(frame);
    } catch {
      this.overflowed = true;
      this.turn.notice = TRANSCRIPT_LIMIT;
      this.turn.omitted.other = true;
      this.trimToBound();
      return true;
    }
    const save = this.pending;
    this.pending = false;
    return save;
  }
  private trimToBound(): void {
    for (;;) {
      try {
        canonicalJson(this.turn, RECORD_BYTES - 4096);
        return;
      } catch {
        if (!this.turn.items.length) return;
        this.turn.items.pop();
      }
    }
  }
  private track(frame: CaptureFrame): void {
    const e = frame.event;
    let relevant = false;
    if (e.kind === "message-start") {
      if (e.role === "assistant") {
        // Each assistant message starts a fresh bounded tracker.
        this.latest = { ...structuredClone(this.latest), items: [] };
        this.final = new TurnCapture(this.latest, () => {}, this.secrets);
      }
      relevant = true;
    } else if (e.kind === "message-end") relevant = true;
    else if (e.kind === "detail-begin") {
      const owner = e.descriptor.owner.kind;
      if (owner === "message" || owner === "message-final") {
        this.messageDetails.add(e.detailId);
        relevant = true;
      }
    } else if (e.kind === "detail-chunk" || e.kind === "detail-end") {
      relevant = this.messageDetails.has(e.detailId);
      if (e.kind === "detail-end") this.messageDetails.delete(e.detailId);
    }
    if (!relevant || !this.final) return;
    try {
      this.final.accept(frame);
    } catch {
      this.final = null;
    }
  }
  /** Sanitized complete text of the selected final message, if retained. A
   * partially retained message is never returned as the final result. */
  selected(messageId: string | undefined): string | undefined {
    const find = (turn: ChatTurn) =>
      turn.items.find((i) => i.id === messageId && i.role === "assistant")
        ?.text;
    return (
      (this.final ? find(this.latest) : undefined) ??
      (this.overflowed ? undefined : find(this.turn))
    );
  }
  get complete(): boolean {
    return !this.overflowed && !!this.final;
  }
}
