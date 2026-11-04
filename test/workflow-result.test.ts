import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { decodeWorkbenchResult } from "../src/service/contracts/workbench.ts";
import { Workflows } from "../src/service/workflows.ts";
import type { RunResult } from "../src/task-types.ts";
import { canonicalJson, LIMITS } from "../src/worker-public.mjs";

// Encoding/read projection only; these unit values are not native execution evidence.
const result = (output: string): RunResult => ({
  outcome: "completed",
  closed: true,
  exitCode: 0,
  signal: null,
  durationMs: 1,
  text: "completed",
  output,
  truncated: false,
});
function fixture(secrets: string[] = [], retained?: string) {
  const id = randomUUID(),
    stepId = `check-${randomUUID()}`;
  const w = Object.assign(Object.create(Workflows.prototype), {
    root: "unused",
    o: {
      secrets: () => secrets,
      coordination: {
        files: {
          read: () => (retained ? { bytes: Buffer.from(retained) } : null),
        },
      },
    },
    view: () => ({
      kind: "workflow",
      response: { type: "run", run: { steps: [{ id: stepId }] } },
    }),
  });
  return { id, stepId, w };
}
it.each(['"', "\\", "\n", "漢😀", '"😀'])(
  "bounded results account for JSON encoding of %j, preserving native facts and head/tail",
  (unit) => {
    const { w, stepId } = fixture();
    const original = result(
      `HEAD\n${unit.repeat(250000 / Buffer.byteLength(unit))}\nTAIL`,
    );
    const bounded = w.sanitizeResult(original) as RunResult;
    expect(bounded).toMatchObject({
      outcome: "completed",
      closed: true,
      exitCode: 0,
    });
    expect(bounded.output).toContain("HEAD");
    expect(bounded.output).toContain("TAIL");
    expect(bounded.output).not.toContain("�");
    expect(bounded.truncated).toBe(true);
    expect(bounded.output).toContain("[truncated: middle omitted]");
    const bytes = canonicalJson({ stepId, result: bounded }, 384 * 1024);
    const detail = {
      kind: "file",
      path: `workflow/fixture/${stepId}`,
      text: bytes,
      limited: bounded.truncated,
    };
    expect(() => decodeWorkbenchResult(detail)).not.toThrow();
    expect(() =>
      canonicalJson({ kind: "ok", value: detail }, LIMITS.pageBytes),
    ).not.toThrow();
    expect(original.truncated).toBe(false);
  },
);
it("retention budgets include final text and redaction expansion, not just raw output bytes", () => {
  const { w, stepId } = fixture(["x"]);
  const original = {
    ...result(`HEAD${"x".repeat(50000)}TAIL`),
    text: "x".repeat(16000),
  };
  const bounded = w.sanitizeResult(original) as RunResult;
  expect(bounded.truncated).toBe(true);
  expect(bounded.output).toContain("HEAD");
  expect(bounded.output).toContain("TAIL");
  expect(bounded.text).toContain("[redacted]");
  expect(bounded.output).toContain("[redacted]");
  const encoded = canonicalJson({ stepId, result: bounded }, 384 * 1024);
  expect(() =>
    decodeWorkbenchResult({
      kind: "file",
      path: "fixture",
      text: encoded,
      limited: true,
    }),
  ).not.toThrow();
});
it.each([
  ['"'.repeat(150000), []],
  [`HEAD${"x".repeat(30000)}TAIL`, ["x"]],
] as const)(
  "readonly detail bounds existing records and newly known redaction without rewriting them (%#)",
  (output, secrets) => {
    const bytes = canonicalJson(
      { stepId: "retained", result: result(output) },
      384 * 1024,
    );
    const { w, id, stepId } = fixture([...secrets], bytes);
    const detail = w.detail(id, stepId);
    expect(() => decodeWorkbenchResult(detail)).not.toThrow();
    expect(detail.limited).toBe(true);
    expect(JSON.parse(detail.text).result.truncated).toBe(true);
    expect(bytes).not.toContain("[truncated]");
  },
);
