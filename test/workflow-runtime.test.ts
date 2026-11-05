import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { canonicalJson } from "../src/service/contracts/core.ts";
import type { ChatTurn } from "../src/service/contracts/workbench.ts";
import {
  implementationReport,
  reviewReport,
  reviewVerdict,
  WorkflowTranscript,
} from "../src/service/workflow-report.ts";
import { Workflows } from "../src/service/workflows.ts";
import { runProcess } from "../src/subagent-process.ts";
import type { CaptureFrame } from "../src/worker-public.mjs";

const frame = (event: Record<string, unknown>) => ({ event }) as CaptureFrame;
function message(messageId: string, chunks: string[]): CaptureFrame[] {
  const detailId = randomUUID();
  return [
    frame({ kind: "message-start", messageId, role: "assistant" }),
    frame({
      kind: "detail-begin",
      detailId,
      descriptor: {
        owner: {
          kind: "message",
          messageId,
          blockId: randomUUID(),
          index: 0,
          stage: "stream",
        },
        field: "message",
        encoding: "utf8",
      },
    }),
    ...chunks.map((text) => frame({ kind: "detail-chunk", detailId, text })),
    frame({ kind: "detail-end", detailId }),
    frame({ kind: "message-end", messageId }),
  ];
}
const turn = (): ChatTurn => ({
  id: randomUUID(),
  epoch: randomUUID(),
  status: "running",
  items: [],
  notice: "",
  omitted: { thinking: false, media: false, other: false },
});

it("review verdicts are read alone, fenced or inside prose; unreadable replies stay distinct", () => {
  expect(
    reviewVerdict('{"approved":true,"summary":"ok","blockingIssues":[]}'),
  ).toEqual({ approved: true, summary: "ok", blockingIssues: [] });
  expect(
    reviewVerdict(
      'Here is my verdict:\n```json\n{"approved":false,"summary":"gap {x}","blockingIssues":["missing \\"b\\" test"]}\n```\nThanks.',
    ),
  ).toEqual({
    approved: false,
    summary: "gap {x}",
    blockingIssues: ['missing "b" test'],
  });
  expect(
    reviewVerdict('{"approved":true,"blockingIssues":["one left"]}')?.approved,
  ).toBe(false);
  expect(reviewVerdict("Looks good to me!")).toBeNull();
  // An example next to a contrary answer is ambiguous, never an approval.
  expect(
    reviewVerdict(
      'Expected format {"approved":true,"summary":"","blockingIssues":[]}. Verdict: {"approved":false,"summary":"missing test","blockingIssues":["b.txt untested"]}',
    ),
  ).toBeNull();
  expect(
    reviewVerdict(
      'Draft {"approved":true,"blockingIssues":[]} then final {"approved":true,"summary":"ok","blockingIssues":[]}',
    )?.approved,
  ).toBe(true);
  expect(reviewVerdict('{"approved":true,"summary":"cut')).toBeNull();
});

it.each([
  [
    '{"approved":true,"summary":"ok","blockingIssues":[]}',
    "completed",
    "approved",
  ],
  [
    '{"approved":false,"summary":"missing test","blockingIssues":["b.txt untested"]}',
    "rejected",
    "rejected",
  ],
  ["Not a verdict", "failed", "unparseable"],
])(
  "review keeps verdict status separate from native success: %s",
  async (text, status, verdict) => {
    const result = {
      outcome: "completed",
      closed: true,
      exitCode: 0,
      text,
      output: "",
      signal: null,
      durationMs: 1,
      truncated: false,
    };
    const step = {
      id: "review",
      kind: "review",
      status: "running",
      text: "",
      exitCode: null,
    };
    const saved: string[] = [];
    const retained: unknown[] = [];
    const quarantine = vi.fn();
    const workflow = Object.assign(Object.create(Workflows.prototype), {
      root: "unused",
      o: { secrets: () => [], owner: { quarantine } },
      write: (_path: string, value: unknown) => retained.push(value),
      save: () => saved.push(step.status),
      evidence: () => "",
      worker: async () => {
        workflow.finishStep({ run: { id: randomUUID() } }, step, result);
        return { result, step };
      },
    });
    const review = () =>
      workflow.review(
        { run: {} },
        "unused",
        { plan: { tasks: [] }, model: {} },
        [],
      );
    await expect(review()).resolves.toBe(verdict);
    expect(step).toMatchObject({ status, exitCode: 0 });
    // No intermediate completed snapshot may end the panel's observation early.
    expect(saved).toEqual(["running", status]);
    expect(retained).toEqual([{ stepId: "review", result }]);
    // A plausible verdict cannot override failure, cancellation or uncertainty.
    for (const outcome of ["failed", "canceled", "timeout", "unknown"]) {
      result.outcome = outcome;
      result.closed = outcome !== "unknown";
      step.status = "running";
      await expect(review()).rejects.toThrow(`Operation ${outcome}`);
      expect(step.status).toBe(outcome);
      expect(retained.at(-1)).toEqual({ stepId: "review", result });
    }
    expect(quarantine).toHaveBeenCalledTimes(1);
  },
);

it("implementation reports distinguish blocked work from a complete assignment without interpreting prose", () => {
  expect(
    implementationReport('{"status":"completed","summary":"Built bundles"}'),
  ).toEqual({ status: "completed", summary: "Built bundles" });
  expect(
    implementationReport(
      '```json\n{"status":"blocked","summary":"Dependency missing"}\n```',
    ),
  ).toEqual({ status: "blocked", summary: "Dependency missing" });
  for (const reply of [
    "Stopped without building anything.",
    "Completed everything!",
    '{"status":"completed","summary":""}',
    '{"status":"completed","summary":"ok","extra":true}',
    '{"status":"blocked","status":"completed","summary":"ambiguous"}',
    '{"status":"completed","summary":42}',
    JSON.stringify({ status: "completed", summary: "\u001b[0m" }),
    "null",
    '{"status":"failed","summary":"error"}',
    '{"status":"completed","summary":"cut',
    '{"status":"completed","summary":"draft"}\n{"status":"blocked","summary":"final"}',
  ])
    expect(implementationReport(reply), reply).toBeNull();
});

it("structured reports sanitize decoded fields without damaging delimiters or escaped credentials", () => {
  for (const summary of [
    "Implemented token: string",
    "Updated password=example",
    "Tested Bearer fixture-value",
  ]) {
    const report = implementationReport(
      JSON.stringify({ status: "completed", summary }),
    );
    expect(report?.status).toBe("completed");
    expect(report?.summary).toContain("[redacted]");
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  }
  const secret = 'fixture-"quoted"\\credential';
  const report = implementationReport(
    JSON.stringify({
      status: "completed",
      summary: `Unicode 😀, newline\n${secret}`,
    }),
    [secret],
  );
  expect(report).toEqual({
    status: "completed",
    summary: "Unicode 😀, newline\n[redacted]",
  });
  expect(
    implementationReport(
      JSON.stringify({ status: "completed", summary: "x".repeat(16384) }),
    ),
  ).toBeNull();
});

it("only complete selected reports authorize continuation; diagnostic clipping and native failure remain independent", async () => {
  // Real stderr clipping, then the independently selected complete report as
  // the worker boundary returns it; no model prose substitutes for native facts.
  const result = await runProcess({
    command: process.execPath,
    args: ["-e", 'process.stderr.write("w".repeat(90000))'],
    cwd: mkdtempSync(join(tmpdir(), "report-stderr-")),
    timeoutMs: 15000,
    signal: new AbortController().signal,
  });
  expect(result).toMatchObject({
    outcome: "completed",
    closed: true,
    exitCode: 0,
    truncated: true,
  });
  result.text = '{"status":"completed","summary":"Built file"}';
  let report = implementationReport(result.text);
  const step = { status: "completed", text: "", truncated: true };
  const workflow = Object.assign(Object.create(Workflows.prototype), {
    o: { secrets: () => [] },
    save: () => {},
    worker: async () => ({ result, step, report }),
  });
  await expect(
    workflow.implementation(
      { abort: new AbortController() },
      "unused",
      "build",
      "unused",
      {},
    ),
  ).resolves.toBeUndefined();
  expect(step).toMatchObject({ status: "completed", truncated: true });
  // An unavailable or clipped selected message cannot fall back to the valid
  // looking native preview, regardless of the diagnostic flag.
  report = null;
  result.truncated = false;
  await expect(
    workflow.implementation(
      { abort: new AbortController() },
      "unused",
      "build",
      "unused",
      {},
    ),
  ).rejects.toThrow("structured completion report");
  report = implementationReport(result.text);
  result.outcome = "unknown";
  result.closed = false;
  await expect(
    workflow.implementation(
      { abort: new AbortController() },
      "unused",
      "build",
      "unused",
      {},
    ),
  ).rejects.toThrow("Operation unknown");
});

it("workflow process results retain diagnostic tails beyond the legacy preview and label actual clipping", async () => {
  const secret = "PRIVATE-FIXTURE-LITERAL";
  const spec = {
    command: process.execPath,
    args: [
      "-e",
      `process.stdout.write("BEGIN ${secret}\\n" + "漢".repeat(30000) + "\\nFAILURE_TAIL ${secret}\\n")`,
    ],
    cwd: mkdtempSync(join(tmpdir(), "workflow-output-")),
    timeoutMs: 15000,
    signal: new AbortController().signal,
    secrets: [secret],
  };
  const retained = await runProcess({ ...spec, retainOutput: true });
  expect(retained).toMatchObject({
    outcome: "completed",
    exitCode: 0,
    closed: true,
    truncated: false,
  });
  expect(retained.output).toContain("FAILURE_TAIL [redacted]");
  expect(retained.output).not.toContain(secret);
  expect(retained.output).not.toContain("�");
  expect(Buffer.byteLength(retained.output)).toBeGreaterThan(65536);
  const preview = await runProcess(spec);
  expect(preview).toMatchObject({
    outcome: "completed",
    exitCode: 0,
    truncated: true,
  });
  expect(Buffer.byteLength(preview.output)).toBeLessThanOrEqual(65536);
  expect(preview.output).toContain("[truncated]");
  const expanded = await runProcess({
    ...spec,
    retainOutput: true,
    secrets: ["x"],
    args: ["-e", 'process.stdout.write("x".repeat(40000))'],
  });
  expect(expanded).toMatchObject({
    outcome: "completed",
    exitCode: 0,
    truncated: true,
  });
  expect(Buffer.byteLength(expanded.output)).toBeLessThanOrEqual(256 * 1024);
});

it("transcript overflow keeps a labelled prefix and still selects the sanitized final message", () => {
  const retained = turn();
  const recorder = new WorkflowTranscript(retained, () => ["SECRET-LITERAL"]);
  const saves: number[] = [];
  const accept = (f: CaptureFrame) => {
    if (recorder.accept(f)) saves.push(retained.items.length);
  };
  for (const f of message(randomUUID(), ["Starting."])) accept(f);
  const callId = randomUUID(),
    detailId = randomUUID();
  accept(frame({ kind: "tool-start", callId, name: "read" }));
  accept(
    frame({
      kind: "detail-begin",
      detailId,
      descriptor: {
        owner: {
          kind: "tool",
          callId,
          blockId: randomUUID(),
          index: 0,
          stage: "result",
        },
        field: "tool-result",
        encoding: "utf8",
      },
    }),
  );
  for (let i = 0; i < 40; i++)
    expect(() =>
      accept(frame({ kind: "detail-chunk", detailId, text: "z".repeat(8192) })),
    ).not.toThrow();
  accept(frame({ kind: "detail-end", detailId }));
  accept(frame({ kind: "tool-end", callId, name: "read", isError: false }));
  expect(recorder.overflowed).toBe(true);
  expect(retained.items.length).toBeLessThanOrEqual(256);
  expect(retained.omitted.other).toBe(true);
  expect(retained.notice).toContain("not retained");
  const finalId = randomUUID();
  for (const f of message(finalId, ["Final answer SECRET-", "LITERAL done."]))
    accept(f);
  expect(recorder.selected(finalId)).toBe("Final answer [redacted] done.");
  expect(retained.items.some((i) => i.id === finalId)).toBe(false);
  expect(recorder.complete).toBe(false);
  expect(saves.length).toBeGreaterThan(0);
});

it("a final message beyond every bound is reported unavailable, never a raw preview", () => {
  const recorder = new WorkflowTranscript(turn(), () => []);
  const finalId = randomUUID();
  for (const f of message(
    finalId,
    Array.from({ length: 40 }, () => "y".repeat(8192)),
  ))
    expect(() => recorder.accept(f)).not.toThrow();
  expect(recorder.selected(finalId)).toBeUndefined();
  expect(recorder.complete).toBe(false);
});

it("coordinator bridge refuses one call without stopping the coordinator and redacts forwarded arguments", async () => {
  const seen: { name: string; args: unknown }[] = [];
  const script = `
    const calls = [
      { id: 1, name: "cadence_plan", args: { design: "Add a token: string field; SECRET-LITERAL" } },
      { id: 2, name: "cadence_plan", args: { design: "x".repeat(70000) } },
      ...Array.from({ length: 22 }, (_, i) => ({ id: i + 3, name: "cadence_status", args: {} })),
    ];
    const replies = [];
    process.on("message", (reply) => {
      replies.push(reply);
      const next = calls[replies.length];
      if (next) process.send(next);
      else {
        process.stdout.write(JSON.stringify(replies));
        process.disconnect();
      }
    });
    process.send(calls[0]);`;
  const result = await runProcess({
    command: process.execPath,
    args: ["-e", script],
    cwd: mkdtempSync(join(tmpdir(), "bridge-")),
    timeoutMs: 15000,
    signal: new AbortController().signal,
    secrets: ["SECRET-LITERAL"],
    onCoordinator: async (name, args) => {
      seen.push({ name, args });
      return { observed: name };
    },
  });
  expect(result.outcome, JSON.stringify(result)).toBe("completed");
  const replies = JSON.parse(result.output);
  expect(replies.map((r: { id: number; ok: boolean }) => [r.id, r.ok])).toEqual(
    [
      [1, true],
      [2, false],
      ...Array.from({ length: 22 }, (_, i) => [i + 3, true]),
    ],
  );
  expect(seen.map((s) => s.name)).toEqual([
    "cadence_plan",
    ...Array(22).fill("cadence_status"),
  ]);
  expect(seen[0].args).toEqual({
    design: "Add a token: [redacted] field; [redacted]",
  });
});

it("both coordinator bridge ends permit more than sixteen calls and preserve cancellation", {
  tags: ["slow"],
}, async () => {
  const script = `
    import { createCoordinatorTools } from ${JSON.stringify(new URL("../src/coordinator-tools.mjs", import.meta.url).href)};
    const tool = createCoordinatorTools().tools.find(t => t.name === "cadence_status");
    const abort = new AbortController();
    abort.abort();
    try { await tool.execute("canceled", {}, abort.signal); }
    catch (error) { process.stdout.write(error.message + "\\n"); }
    for (let i = 0; i < 24; i++) {
      const result = await tool.execute(String(i), {});
      if (!result.content[0].text.includes("observed")) throw new Error("Missing reply");
    }
    process.stdout.write("completed 24 calls\\n");
    const queuedAbort = new AbortController();
    const first = tool.execute("first", {});
    const queued = tool.execute("queued", {}, queuedAbort.signal);
    const observed = queued.then(() => "unexpected send", error => error.message);
    queuedAbort.abort();
    await first;
    process.stdout.write("queued: " + await observed);
    process.disconnect();`;
  let calls = 0;
  const result = await runProcess({
    command: process.execPath,
    args: ["--input-type=module", "-e", script],
    cwd: mkdtempSync(join(tmpdir(), "bridge-quota-")),
    timeoutMs: 15000,
    signal: new AbortController().signal,
    onCoordinator: async () => ({ observed: ++calls }),
  });
  expect(result.outcome, JSON.stringify(result)).toBe("completed");
  expect(calls).toBe(25);
  expect(result.output).toContain("Coordinator canceled");
  expect(result.output).toContain("completed 24 calls");
  expect(result.output).toContain("queued: Coordinator canceled");
});

it("an uninterruptible process is never signalled by timeout, cancellation or output bounds", {
  tags: ["slow"],
}, async () => {
  const late = new AbortController();
  const running = runProcess({
    command: process.execPath,
    args: [
      "-e",
      'process.stdout.write("x".repeat(400000)); setTimeout(() => process.exit(0), 300)',
    ],
    cwd: mkdtempSync(join(tmpdir(), "uninterruptible-")),
    timeoutMs: 20,
    signal: late.signal,
    uninterruptible: true,
  });
  late.abort();
  const result = await running;
  expect(result).toMatchObject({
    outcome: "completed",
    closed: true,
    exitCode: 0,
    truncated: true,
  });
  expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(256 * 1024);
  // The ordinary runner still honours its bound.
  const bounded = await runProcess({
    command: process.execPath,
    args: ["-e", "setTimeout(() => {}, 5000)"],
    cwd: mkdtempSync(join(tmpdir(), "bounded-")),
    timeoutMs: 50,
    signal: new AbortController().signal,
  });
  expect(bounded.outcome).toBe("timeout");
});
it("structured assignment reports survive transcript overflow and are invalidated by later tools", () => {
  const retained = turn();
  retained.items = Array.from({ length: 256 }, () => ({
    id: randomUUID(),
    role: "assistant" as const,
    name: "",
    args: "",
    text: "retained prefix",
    error: false,
  }));
  const recorder = new WorkflowTranscript(retained, () => []);
  recorder.accept(
    frame({
      kind: "message-start",
      messageId: randomUUID(),
      role: "assistant",
    }),
  );
  expect(recorder.overflowed).toBe(true);
  const callId = randomUUID(),
    detailId = randomUUID();
  const report = { status: "completed", summary: "Implemented actual work" };
  for (const event of [
    { kind: "tool-start", callId, name: "cadence_report" },
    {
      kind: "detail-begin",
      detailId,
      descriptor: {
        owner: { kind: "tool", callId, stage: "result" },
        field: "tool-result",
        encoding: "canonical-json",
      },
    },
    {
      kind: "detail-chunk",
      detailId,
      text: canonicalJson({
        content: [{ type: "text", text: JSON.stringify(report) }],
      }),
    },
    { kind: "detail-end", detailId },
    { kind: "tool-end", callId, name: "cadence_report", isError: false },
  ])
    recorder.accept(frame(event));
  expect(implementationReport(recorder.assignmentReport()!)).toEqual(report);
  recorder.accept(
    frame({ kind: "tool-start", callId: randomUUID(), name: "edit" }),
  );
  expect(recorder.assignmentReport()).toBeUndefined();
});

it("review never approves contradictory duplicate keys or an uninspected suffix", () => {
  expect(
    reviewVerdict('{"approved":false,"approved":true,"blockingIssues":[]}'),
  ).toBeNull();
  expect(
    reviewVerdict(
      'Verdict {"approved":false,"approved":true,"example":{"approved":true}}',
    ),
  ).toBeNull();
  const positive = '{"approved":true,"blockingIssues":[]}';
  const negative =
    '{"approved":false,"blockingIssues":["missing requirement"]}';
  const full = `${positive}\n${"context ".repeat(3000)}\n${negative}`;
  const result = reviewReport(full, []);
  expect(reviewVerdict(result.text)).toBeNull();
  expect(
    reviewVerdict(`${Array(64).fill(positive).join("\n")}\n${negative}`),
  ).toBeNull();
});
it("large review fields are projected as valid JSON without changing their complete verdict", () => {
  const issues = Array.from({ length: 40 }, () =>
    "Concrete missing behavior. ".repeat(40),
  );
  const result = reviewReport(
    JSON.stringify({
      approved: true,
      summary: "Details ".repeat(8000),
      blockingIssues: issues,
    }),
    [],
  );
  expect(result.truncated).toBe(true);
  expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(16384);
  expect(reviewVerdict(result.text)?.approved).toBe(false);
  const approved = reviewReport(
    JSON.stringify({
      approved: true,
      summary: "Inspected ".repeat(8000),
      blockingIssues: [],
    }),
    [],
  );
  expect(approved.truncated).toBe(true);
  expect(reviewVerdict(approved.text)?.approved).toBe(true);
});
