import type { RunResult } from "../task-types.ts";
import { sanitizeData, sanitizeText } from "../worker-redaction.mjs";
import { ContractError, canonicalJson } from "./contracts/core.ts";

/** Encoded result, not raw stdout bytes. Leaves 16 KiB for the step/native
 * wrappers below the 256 KiB file-text DTO and 384 KiB journal record. Even
 * escaping that entire file text again fits a 512 KiB reply. */
export const WORKFLOW_RESULT_BYTES = 240 * 1024;
const omitted = "\n[truncated: middle omitted]\n";
const stringBytes = (s: string) => Buffer.byteLength(JSON.stringify(s)) - 2;

/** Retain scalar-aligned head and tail within an encoded JSON-string budget.
 * Caller sanitizes the complete field first, never its separated fragments. */
function excerpt(value: string, budget: number): string {
  if (stringBytes(value) <= budget) return value;
  if (stringBytes(omitted) > budget) return "";
  const take = (units: number) => {
    const head = value
      .slice(0, Math.ceil(units / 2))
      .replace(/[\ud800-\udbff]$/u, "");
    const tail = value
      .slice(value.length - Math.floor(units / 2))
      .replace(/^[\udc00-\udfff]/u, "");
    return head + omitted + tail;
  };
  let low = 0,
    high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (stringBytes(take(mid)) <= budget) low = mid;
    else high = mid - 1;
  }
  return take(low);
}

/** Bound already-sanitized fields. Read projection also sanitizes JSON keys,
 * so short configured literals can change their names; never parse a redacted
 * object as the original native DTO or sanitize it a second time. */
function boundedResult(
  value: unknown,
  [textKey, outputKey, truncatedKey]: string[],
  maximum = WORKFLOW_RESULT_BYTES,
) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ContractError("corrupt-selected");
  const original = value as Record<string, unknown>;
  const text = original[textKey],
    output = original[outputKey];
  if (
    typeof text !== "string" ||
    typeof output !== "string" ||
    typeof original[truncatedKey] !== "boolean"
  )
    throw new ContractError("corrupt-selected");
  const result = {
    ...original,
    [textKey]: "",
    [outputKey]: "",
    [truncatedKey]: false,
  };
  const budget = maximum - Buffer.byteLength(JSON.stringify(result));
  if (budget < 0) throw new ContractError("oversize");
  const keptText = excerpt(text, budget);
  const keptOutput = excerpt(output, budget - stringBytes(keptText));
  result[textKey] = keptText;
  result[outputKey] = keptOutput;
  result[truncatedKey] =
    original[truncatedKey] || keptText !== text || keptOutput !== output;
  return result;
}

/** Native outcome/exit/closure stay unchanged; omitted diagnostic bytes are an
 * independent observation. Used before recording original process results. */
export function workflowResult(
  original: RunResult,
  secrets: readonly string[],
): RunResult {
  return boundedResult(
    {
      ...original,
      text: sanitizeText(original.text, secrets),
      output: sanitizeText(original.output, secrets),
    },
    ["text", "output", "truncated"],
  ) as unknown as RunResult;
}

/** Existing bytes stay untouched. Apply current structural sanitation exactly
 * once, then bound its projection so record/reply escaping cannot overflow. */
export function workflowResultDetail(
  value: unknown,
  secrets: readonly string[],
) {
  const record = JSON.parse(sanitizeData(value, secrets));
  const resultKey = sanitizeText("result", secrets);
  const keys = ["text", "output", "truncated"].map((key) =>
    sanitizeText(key, secrets),
  );
  // New check records also carry execution context. Budget the actual wrapper,
  // rather than assuming every record contains only stepId and result.
  const wrapper =
    Buffer.byteLength(JSON.stringify({ ...record, [resultKey]: null })) - 4;
  const result = boundedResult(
    record[resultKey],
    keys,
    Math.min(WORKFLOW_RESULT_BYTES, 256 * 1024 - wrapper),
  );
  record[resultKey] = result;
  return {
    text: canonicalJson(record, 256 * 1024),
    limited: result[keys[2]] === true,
  };
}

export interface StepEvidenceRow {
  stepId: string;
  status: string;
  outcome: string;
  exitCode: number | null;
  closed: boolean;
  truncated: boolean;
  /** Compact serialized execution context prefix (command/cwd/env), already sanitized. */
  context?: string;
  /** Complete retained sanitized text/output for this step. */
  output: string;
}

const FAILURE_ANCHOR =
  /(?:^|\s)(?:FAIL\b|AssertionError|Error:|SyntaxError|TypeError|ReferenceError|RangeError|Expected[:\s]|Received[:\s]|❯|×|✖|error TS\d+|Traceback\b|panic:|npm ERR!|ELIFECYCLE|Command failed)/u;

function clipUtf8(value: string, maximum: number): string {
  if (maximum <= 0) return "";
  if (Buffer.byteLength(value) <= maximum) return value;
  return Buffer.from(value)
    .subarray(0, maximum)
    .toString("utf8")
    .replace(/\uFFFD+$/u, "");
}

function tailUtf8(value: string, maximum: number): string {
  if (maximum <= 0) return "";
  if (Buffer.byteLength(value) <= maximum) return value;
  return Buffer.from(value)
    .subarray(-maximum)
    .toString("utf8")
    .replace(/^\uFFFD+/u, "");
}

/** Extract failure-centered windows (first & last failure anchor + tail summary)
 * within `budget` UTF-8 bytes so mid-output assertion traces are not discarded. */
export function failureFocusedExcerpt(
  output: string,
  budget: number,
  reference: string,
): string {
  if (budget <= 0) return "";
  if (Buffer.byteLength(output) <= budget) return output;
  const note = `\n[excerpt: middle omitted] (full redacted result retained under ${reference})\n`;
  const noteBytes = Buffer.byteLength(note);
  if (budget <= noteBytes + 32) return clipUtf8(output, budget);
  const lines = output.split("\n");
  const hits: number[] = [];
  for (let i = 0; i < lines.length; i++)
    if (FAILURE_ANCHOR.test(lines[i])) hits.push(i);
  if (!hits.length) {
    // No explicit anchor: bias toward tail where build/test summaries land.
    const usable = budget - noteBytes;
    const head = Math.floor(usable * 0.3);
    const tail = usable - head;
    return `${clipUtf8(output, head)}${note}${tailUtf8(output, tail)}`;
  }
  const first = hits[0],
    last = hits[hits.length - 1];
  const windowAround = (center: number, blockBudget: number) => {
    const beforeBudget = Math.min(256, Math.floor(blockBudget * 0.2));
    const beforeLines = lines.slice(Math.max(0, center - 3), center).join("\n");
    const prefix = beforeLines
      ? `${tailUtf8(beforeLines, beforeBudget)}\n`
      : "";
    const rest = lines
      .slice(center, Math.min(lines.length, center + 18))
      .join("\n");
    const bodyBudget = Math.max(64, blockBudget - Buffer.byteLength(prefix));
    return `${prefix}${clipUtf8(rest, bodyBudget)}`;
  };
  const usable = budget - noteBytes * 2;
  const tailBudget = Math.min(Math.floor(budget * 0.25), 768);
  const tailText = tailUtf8(output, tailBudget);
  const anchorBudget = Math.max(128, usable - Buffer.byteLength(tailText));
  if (last - first <= 20) {
    const kept = windowAround(first, anchorBudget + noteBytes);
    if (output.endsWith(kept)) return kept;
    return `${kept}${note}${tailText}`;
  }
  const firstBudget = Math.floor(anchorBudget * 0.55);
  const lastBudget = anchorBudget - firstBudget;
  const firstBlock = windowAround(first, firstBudget);
  const lastBlock = windowAround(last, lastBudget);
  return `${firstBlock}${note}${lastBlock}${note}${tailText}`;
}

/** Allocate evidence from the remaining prompt budget: passing and not-run steps
 * take compact summaries so failing/rejected/partial steps keep rich failure traces. */
export function formatStepEvidence(
  runId: string,
  rows: readonly StepEvidenceRow[],
  maxBytes: number,
): string {
  if (!rows.length || maxBytes <= 0) return "";
  const isNotRun = (r: StepEvidenceRow) => r.status === "not-run";
  const isPassing = (r: StepEvidenceRow) =>
    r.status === "completed" && r.outcome === "completed" && r.exitCode === 0;
  const headerOf = (r: StepEvidenceRow) =>
    canonicalJson({
      stepId: r.stepId,
      status: r.status,
      outcome: r.outcome,
      exitCode: r.exitCode,
      closed: r.closed,
      truncated: r.truncated,
    });
  const passingCount = rows.filter(isPassing).length;
  const failingIndices = rows
    .map((r, i) => (!isNotRun(r) && !isPassing(r) ? i : -1))
    .filter((i) => i >= 0);

  // Reserve concise budgets for non-failing steps first; give everything else to failures.
  const entries: string[] = new Array(rows.length);
  let used = Math.max(0, rows.length - 1) * 2; // "\n\n" separators
  const passSummaryBudget = failingIndices.length
    ? Math.min(256, Math.floor((maxBytes * 0.2) / Math.max(1, passingCount)))
    : Math.floor(maxBytes / Math.max(1, rows.length));

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (isNotRun(r)) {
      const line = `${headerOf(r)}\nNot run: ${clipUtf8(r.output || "stopped early after a gating failure", 200)}`;
      entries[i] = line;
      used += Buffer.byteLength(line);
    } else if (isPassing(r)) {
      const header = headerOf(r);
      const prefix = r.context
        ? `${header}\n${clipUtf8(r.context, 256)}`
        : header;
      const bodyBudget = Math.max(
        0,
        passSummaryBudget - Buffer.byteLength(prefix) - 32,
      );
      const summary =
        bodyBudget >= 48 && r.output
          ? `\nSummary: ${tailUtf8(r.output, bodyBudget)}`
          : "";
      const block = `${prefix}${summary}`;
      entries[i] = block;
      used += Buffer.byteLength(block);
    }
  }

  if (failingIndices.length) {
    const remaining = Math.max(0, maxBytes - used);
    const perFailure = Math.floor(remaining / failingIndices.length);
    for (const i of failingIndices) {
      const r = rows[i];
      const header = headerOf(r);
      const contextLine = r.context
        ? `${clipUtf8(r.context, Math.min(1024, Math.floor(perFailure * 0.35)))}\n`
        : "";
      const label = "Retained failure excerpt:\n";
      const fixedBytes =
        Buffer.byteLength(header) +
        1 +
        Buffer.byteLength(contextLine) +
        Buffer.byteLength(label);
      const outBudget = Math.max(64, perFailure - fixedBytes);
      const excerpted = failureFocusedExcerpt(
        r.output,
        outBudget,
        `run ${runId} step ${r.stepId}`,
      );
      entries[i] = `${header}\n${contextLine}${label}${excerpted}`;
    }
  }

  const joined = entries.join("\n\n");
  return Buffer.byteLength(joined) <= maxBytes
    ? joined
    : clipUtf8(joined, maxBytes);
}
