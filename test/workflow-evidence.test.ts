import { createHash, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { WorkflowStep } from "../src/service/contracts/workflow.ts";
import { Workflows } from "../src/service/workflows.ts";
import type { RunResult } from "../src/task-types.ts";

// Unit boundary only: retained-record reads, not fabricated process success.
function fixture() {
  const records = new Map<
    string,
    { stepId: string; result: RunResult; operation?: unknown }
  >();
  const reads: string[] = [];
  const secret = "fixture-private-literal";
  const live = { run: { id: randomUUID() } };
  const workflow = Object.assign(Object.create(Workflows.prototype), {
    root: "unused",
    o: {
      secrets: () => [secret],
      coordination: {
        files: {
          read(path: string) {
            reads.push(path);
            const key = path.split(/[\\/]/).at(-1) ?? "";
            const record = records.get(key);
            return record
              ? { bytes: Buffer.from(JSON.stringify(record)) }
              : undefined;
          },
        },
      },
    },
  }) as {
    evidence(
      context: typeof live,
      steps: WorkflowStep[],
      operations?: boolean,
    ): string;
  };
  const step = (overrides: Partial<WorkflowStep> = {}): WorkflowStep => ({
    id: `check-${randomUUID()}`,
    kind: "check",
    status: "failed",
    text: "Generic status preview, not the actual diagnostic",
    exitCode: 1,
    truncated: false,
    ...overrides,
  });
  const record = (
    s: WorkflowStep,
    value: Partial<RunResult> = {},
    operation?: unknown,
  ) => {
    const body = {
      stepId: s.id,
      ...(operation ? { operation } : {}),
      result: {
        outcome: "failed",
        exitCode: 1,
        closed: true,
        signal: null,
        durationMs: 1,
        truncated: false,
        text: "generic summary",
        output: "actual check diagnostic",
        ...value,
      } satisfies RunResult,
    };
    records.set(
      `${createHash("sha256").update(s.id).digest("hex")}.json`,
      body,
    );
    return body;
  };
  return {
    evidence: (steps: WorkflowStep[], operations = false) =>
      workflow.evidence(live, steps, operations),
    reads,
    secret,
    step,
    record,
  };
}
it("passes native outcomes and bounded redacted head/tail diagnostics, not generic previews", () => {
  const f = fixture();
  const step = f.step({ id: `check-${f.secret}-${randomUUID()}` });
  f.record(step, {
    output: `DIAGNOSTIC_START ${f.secret}\n${"漢字".repeat(10000)}\nDIAGNOSTIC_END ${f.secret}`,
  });
  const text = f.evidence([step]);
  expect(text).toContain('"exitCode":1');
  expect(text).toContain('"closed":true');
  expect(text).toContain("DIAGNOSTIC_START");
  expect(text).toContain("DIAGNOSTIC_END");
  expect(text).toContain("[excerpt: middle omitted]");
  expect(text).toContain("[redacted]");
  expect(text).not.toContain(f.secret);
  expect(text).not.toContain(step.text);
  expect(text).not.toContain("�");
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(8192);
});
it("reads only the requested round and keeps review rejection distinct from native zero", () => {
  const f = fixture();
  const old = f.step(),
    current = f.step(),
    review = f.step({ kind: "review", exitCode: 0 });
  f.record(old, { output: "OLD_FAILURE" });
  f.record(current, { output: "CURRENT_FAILURE", truncated: true });
  f.record(review, {
    outcome: "completed",
    exitCode: 0,
    text: '{"approved":false,"blockingIssues":["REVIEW_REASON"]}',
    output: "not the selected review verdict",
  });
  const text = f.evidence([current, review]);
  expect(f.reads).toHaveLength(2);
  expect(text).not.toContain("OLD_FAILURE");
  expect(text).toContain("CURRENT_FAILURE");
  expect(text).toContain('"truncated":true');
  expect(text).toContain("REVIEW_REASON");
  expect(text).not.toContain("not the selected review verdict");
  expect(text).toContain('"outcome":"completed"');
  expect(text).toContain('"status":"failed"');
  expect(text).toContain('"exitCode":0');
});
it("keeps every check identity within the prompt budget and refuses missing or mismatched evidence", () => {
  const f = fixture();
  const steps = Array.from({ length: 17 }, () =>
    f.step({ id: `${"驗".repeat(80)}-${randomUUID()}` }),
  );
  for (const step of steps) f.record(step, { output: "x".repeat(20000) });
  const text = f.evidence(steps);
  for (const step of steps) expect(text).toContain(step.id);
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(8192);
  const missing = f.step();
  expect(() => f.evidence([missing])).toThrow("unavailable");
  f.record(missing).stepId = randomUUID();
  expect(() => f.evidence([missing])).toThrow("corrupt-selected");
});

it("silent setup failure carries its exact command, cwd and unset environment into diagnosis and repair", () => {
  const f = fixture(),
    step = f.step();
  f.record(
    step,
    { output: "" },
    {
      command: {
        name: "branch",
        command: `git symbolic-ref -q HEAD; echo ${f.secret}`,
      },
      cwd: "/owned/child/subdir",
      checkoutRoot: "/owned/child",
      placement: "child",
      target: { checkoutRoot: "/target", branch: "refs/heads/main" },
      environment: { TMPDIR: null, TEMP: null, TMP: null },
    },
  );
  const evidence = f.evidence([step], true);
  expect(evidence).toContain("git symbolic-ref -q HEAD");
  expect(evidence).toContain("/owned/child/subdir");
  expect(evidence).toContain('"placement":"child"');
  expect(evidence).toContain('"TMPDIR":null');
  expect(evidence).toContain('"branch":"refs/heads/main"');
  expect(evidence).not.toContain(f.secret);
  expect(evidence).toContain("[redacted]");
  expect(Buffer.byteLength(evidence)).toBeLessThanOrEqual(8192);
  expect(f.evidence([step])).not.toContain("Recorded execution context");
});
it("retained results without context explicitly report it unrecorded instead of inventing a resource", () => {
  const f = fixture(),
    step = f.step();
  f.record(step);
  expect(f.evidence([step], true)).toContain(
    "No permission to inspect private records or invent missing prerequisites",
  );
});
