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

export interface ReviewIssue {
  id: string;
  /** V4 structured review: acceptance item or invariant (e.g. "AC-3"). */
  source?: string;
  /** V4 structured review: owner-assigned family ID (e.g. "F01") or "new". */
  family?: string;
  /** V4 structured review: concise description of a newly reported family. */
  familySummary?: string;
  evidence: string;
  verify: string;
  writes: string[];
}
type Blocker = string | ReviewIssue;
export const issueText = (issue: Blocker): string =>
  typeof issue === "string"
    ? issue
    : `${issue.id}${issue.family || issue.source ? ` [${[issue.source, issue.family].filter(Boolean).join(" / ")}]` : ""}: ${issue.evidence}\nVerify: ${issue.verify}`;

const ISSUE_KEYS = new Set([
  "id",
  "source",
  "family",
  "familySummary",
  "evidence",
  "verify",
  "writes",
]);
const FAMILY_REF = /^(?:new|F[0-9]{2,4})$/u;
const EXISTING_FAMILY_REF = /^F[0-9]{2,4}$/u;

function isBlocker(value: unknown): value is Blocker {
  if (typeof value === "string") return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const issue = value as Partial<ReviewIssue>;
  const keys = Object.keys(issue);
  if (keys.some((k) => !ISSUE_KEYS.has(k))) return false;
  return (
    typeof issue.id === "string" &&
    /^[a-z][a-z0-9-]{0,47}$/.test(issue.id) &&
    typeof issue.evidence === "string" &&
    !!issue.evidence.trim() &&
    typeof issue.verify === "string" &&
    !!issue.verify.trim() &&
    Array.isArray(issue.writes) &&
    issue.writes.every((p) => typeof p === "string") &&
    (issue.source === undefined ||
      (typeof issue.source === "string" &&
        !!issue.source.trim() &&
        Buffer.byteLength(issue.source) <= 128)) &&
    (issue.family === undefined ||
      (typeof issue.family === "string" && FAMILY_REF.test(issue.family))) &&
    (issue.familySummary === undefined ||
      (typeof issue.familySummary === "string" &&
        !!issue.familySummary.trim() &&
        Buffer.byteLength(issue.familySummary) <= 256))
  );
}

/** Accepts the requested JSON verdict alone, fenced, or embedded in prose. */
export function reviewVerdict(reply: string): {
  approved: boolean;
  summary: string;
  blockingIssues: Blocker[];
  closedFamilies?: string[];
  pendingBrowser?: string[];
} | null {
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
    if (!Array.isArray(issues) || !issues.every(isBlocker)) {
      malformed = true;
      return null;
    }
    let closedFamilies: string[] | undefined;
    if (o.closedFamilies !== undefined) {
      if (
        !Array.isArray(o.closedFamilies) ||
        o.closedFamilies.length > 64 ||
        !o.closedFamilies.every(
          (id) => typeof id === "string" && EXISTING_FAMILY_REF.test(id),
        )
      ) {
        malformed = true;
        return null;
      }
      closedFamilies = [...new Set(o.closedFamilies)];
    }
    let pendingBrowser: string[] | undefined;
    if (o.pendingBrowser !== undefined) {
      if (
        !Array.isArray(o.pendingBrowser) ||
        o.pendingBrowser.length > 32 ||
        !o.pendingBrowser.every(
          (item) =>
            typeof item === "string" &&
            !!item.trim() &&
            Buffer.byteLength(item) <= 256,
        )
      ) {
        malformed = true;
        return null;
      }
      pendingBrowser = [...o.pendingBrowser];
    }
    return {
      approved: o.approved && issues.length === 0,
      summary: typeof o.summary === "string" ? o.summary : "",
      blockingIssues: issues,
      ...(closedFamilies ? { closedFamilies } : {}),
      ...(pendingBrowser ? { pendingBrowser } : {}),
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
  const cleanIssues = verdict.blockingIssues.map((issue) => {
    const clean = (s: string) => sanitizeText(s, secrets);
    if (typeof issue === "string") return clean(issue);
    // Never turn a redacted selector into an editing destination or family ID.
    if (
      clean(issue.id) !== issue.id ||
      (issue.family !== undefined && clean(issue.family) !== issue.family) ||
      issue.writes.some((p) => clean(p) !== p)
    )
      return clean(issueText(issue));
    const cleanSource =
      issue.source !== undefined ? clean(issue.source) : undefined;
    const cleanFamilySummary =
      issue.familySummary !== undefined
        ? clean(issue.familySummary)
        : undefined;
    return {
      ...issue,
      ...(cleanSource !== undefined
        ? { source: diagnosticText(cleanSource, 128) }
        : {}),
      ...(cleanFamilySummary !== undefined
        ? { familySummary: diagnosticText(cleanFamilySummary, 256) }
        : {}),
      evidence: clean(issue.evidence),
      verify: clean(issue.verify),
    };
  });
  const cleanClosed = verdict.closedFamilies?.filter(
    (id) => sanitizeText(id, secrets) === id,
  );
  const cleanPending = verdict.pendingBrowser?.map((item) =>
    diagnosticText(sanitizeText(item, secrets), 256),
  );
  const complete = {
    approved: verdict.approved,
    summary: cleanSummary,
    blockingIssues: cleanIssues,
    ...(cleanClosed?.length ? { closedFamilies: cleanClosed } : {}),
    ...(cleanPending?.length ? { pendingBrowser: cleanPending } : {}),
  };
  if (Buffer.byteLength(JSON.stringify(complete)) <= 16384)
    return { text: canonicalJson(complete, 16384), truncated: false };
  // Oversize results retain their verdict and readable evidence, never a partially retained repair instruction.
  return {
    // At most 6KiB of fields; even JSON escaping fits the 16KiB reply allowance.
    text: canonicalJson(
      {
        approved: verdict.approved,
        summary: diagnosticText(cleanSummary, 2048),
        blockingIssues: cleanIssues
          .slice(0, 16)
          .map((issue) => diagnosticText(issueText(issue), 256)),
        ...(cleanClosed?.length ? { closedFamilies: cleanClosed } : {}),
        ...(cleanPending?.length
          ? {
              pendingBrowser: cleanPending
                .slice(0, 16)
                .map((item) => diagnosticText(item, 128)),
            }
          : {}),
      },
      16384,
    ),
    truncated: true,
  };
}

/** A task report is separate from native worker closure and from verification.
 * Accept one complete JSON object (optionally fenced), never infer completion
 * from prose, a partial reply, or a zero process exit. */
export function implementationReport(
  reply: string,
  secrets: readonly string[] = [],
): {
  status: "completed" | "partial" | "blocked";
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
    if (
      o.status !== "completed" &&
      o.status !== "partial" &&
      o.status !== "blocked"
    )
      return null;
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
/** The tools through which a worker submits a structured result; its final
 * prose then carries none. One is active per worker; the latest call wins. */
export const SUBMISSION_TOOLS = [
  "cadence_report",
  "cadence_route",
  "cadence_recovery",
] as const;
/** The retained result wraps the tool's serialized submission in a JSON
 * envelope: escaping quotes and backslashes can double its bytes, and the
 * largest submission is the route plan's 64KiB. The consumers re-bound the
 * extracted submission itself; this bound only covers the envelope. */
const SUBMISSION_ENVELOPE_BYTES = 2 * 65536 + 256;
/** Workflow worker transcript. Its bound limits what is retained, never the
 * worker: past the bound a labelled prefix is kept and the worker continues.
 * The latest assistant message is tracked separately so the final result is
 * selected from sanitized complete text, never a raw clipped preview. */
export class WorkflowTranscript {
  overflowed = false;
  /** True if any non-readonly tool (other than read/grep/find/ls/changes and the submission tools) started. */
  hasWriteToolCall = false;
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
  private reportTool: string | undefined;
  /** A submission tool's result is retained independently of transcript preview
   * limits; undefined unless the latest submission came from `tool`. Current
   * tools carry the structured payload in `details` so capture sanitizes each
   * string field before JSON encoding (never corrupting JSON delimiters); older
   * retained envelopes carrying JSON inside `content[0].text` still decode. */
  submission(tool: string): string | undefined {
    if (this.reportTool !== tool || this.reportText === undefined) return;
    try {
      const raw = parseWireJson(this.reportText, SUBMISSION_ENVELOPE_BYTES);
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
      if (Object.hasOwn(raw, "details")) {
        const value = closed(raw, ["content", "details"]);
        if (
          !value.details ||
          typeof value.details !== "object" ||
          Array.isArray(value.details)
        )
          return;
        return canonicalJson(value.details, SUBMISSION_ENVELOPE_BYTES);
      }
      const value = closed(raw, ["content"]);
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
      // Inspection cannot change the submitted candidate. Unknown tools, shell,
      // writes and a replacement submission still invalidate it before admission.
      if (["read", "grep", "find", "ls", "changes"].includes(e.name)) return;
      if (!(SUBMISSION_TOOLS as readonly string[]).includes(e.name))
        this.hasWriteToolCall = true;
      this.reportText = undefined;
      this.reportTool = undefined;
      this.reportDetails.clear();
      this.reportCapture = undefined;
      this.reportTurn = undefined;
      this.reportId = undefined;
      if ((SUBMISSION_TOOLS as readonly string[]).includes(e.name)) {
        this.reportTool = e.name;
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
      this.reportTool = undefined;
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
