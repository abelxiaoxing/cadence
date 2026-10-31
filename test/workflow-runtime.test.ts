import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { ChatTurn } from "../src/service/contracts/workbench.ts";
import { reviewVerdict, WorkflowTranscript } from "../src/service/workflows.ts";
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
      { id: 3, name: "cadence_status", args: {} },
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
      [3, true],
    ],
  );
  expect(seen.map((s) => s.name)).toEqual(["cadence_plan", "cadence_status"]);
  expect(seen[0].args).toEqual({
    design: "Add a token: [redacted] field; [redacted]",
  });
});

it("an uninterruptible process is never signalled by timeout, cancellation or output bounds", async () => {
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
