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
