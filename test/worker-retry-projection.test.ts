import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import {
  type ChatTurn,
  decodeChatTurn,
} from "../src/service/contracts/workbench.ts";
import { LiveCapture } from "../src/service/conversations.ts";
import { turnItems } from "../src/service/pi-sessions.ts";
import { TurnCapture } from "../src/service/turn-capture.ts";
import { WorkflowTranscript } from "../src/service/workflow-report.ts";
import {
  type CaptureFrame,
  decodeCaptureEvent,
  decodeModelRetry,
} from "../src/worker-public.mjs";

const progress = {
  phase: "waiting" as const,
  attempt: 2,
  maxAttempts: 6,
  delayMs: 10000,
};
const frame = (event: CaptureFrame["event"]): CaptureFrame => ({
  protocol: 2,
  childRunId: randomUUID(),
  workerSeq: 1,
  observedMs: 0,
  event,
});
function turn(): ChatTurn {
  return {
    id: randomUUID(),
    epoch: randomUUID(),
    status: "running",
    items: [],
    notice: "",
    omitted: { thinking: false, media: false, other: false },
  };
}
it("retry progress is closed and typed; its only provider text is a bounded reason, and it carries no control authority", () => {
  expect(decodeCaptureEvent({ kind: "model-retry", progress })).toEqual({
    kind: "model-retry",
    progress,
  });
  expect(decodeCaptureEvent({ kind: "model-retry", progress: null })).toEqual({
    kind: "model-retry",
    progress: null,
  });
  // The worker redacts and bounds the provider's words before they get here.
  const explained = { ...progress, reason: "429 Too Many Requests" };
  expect(decodeModelRetry(explained)).toEqual(explained);
  expect(decodeChatTurn({ ...turn(), retry: explained }).retry).toEqual(
    explained,
  );
  for (const invalid of [
    { ...progress, reason: "" },
    { ...progress, reason: 429 },
    { ...progress, reason: "x".repeat(257) },
    { ...progress, errorMessage: "secret" },
    { ...progress, headers: {} },
    { ...progress, attempt: 7 },
    { ...progress, attempt: 0 },
    { ...progress, delayMs: -1 },
    { ...progress, phase: "requesting" },
    { ...progress, phase: "completed" },
  ])
    expect(() => decodeModelRetry(invalid)).toThrow();
  expect(decodeChatTurn({ ...turn(), retry: progress }).retry).toEqual(
    progress,
  );
});
it("live recovery is separate from failure notices and clears without declaring task success", () => {
  const live = new LiveCapture(() => []);
  live.notice = "retained warning";
  live.accept(frame({ kind: "model-retry", progress }));
  expect(live.retry).toEqual(progress);
  expect(live.notice).toBe("retained warning");
  live.accept(frame({ kind: "model-retry", progress: null }));
  expect(live.retry).toBeUndefined();
  expect(live.notice).toBe("retained warning");
  live.accept(frame({ kind: "model-retry", progress }));
  live.accept(frame({ kind: "worker-failure", code: "capture" }));
  expect(live.retry).toBeUndefined();
  expect(live.notice).toBe("worker-failure: capture");
});
it("workflow recovery progress persists even without a new message or tool event", () => {
  const value = turn(),
    save = vi.fn();
  const capture = new TurnCapture(value, save, () => []);
  capture.accept(frame({ kind: "model-retry", progress }));
  expect(save).toHaveBeenCalledTimes(1);
  expect(decodeChatTurn(value).retry).toEqual(progress);
  capture.accept(frame({ kind: "model-retry", progress: null }));
  expect(save).toHaveBeenCalledTimes(2);
  expect(value.retry).toBeUndefined();
  expect(value.status).toBe("running");
});
it("failed response text remains explicitly incomplete in live and retained projections", () => {
  const id = randomUUID(),
    value = turn(),
    live = new LiveCapture(() => []);
  const capture = new TurnCapture(
    value,
    () => {},
    () => [],
  );
  for (const event of [
    {
      kind: "message-start",
      messageId: id,
      role: "assistant",
      source: { disposition: "unavailable", value: null },
      resultCallId: null,
    },
    {
      kind: "message-end",
      messageId: id,
      finalDetailId: null,
      finalBlockCount: 0,
      stopReason: "error",
    },
  ] satisfies CaptureFrame["event"][]) {
    capture.accept(frame(event));
    live.accept(frame(event));
  }
  expect(value.items[0].error).toBe(true);
  expect(live.extend([]).items[0].error).toBe(true);
  const built = turnItems(
    ["error", "stop"].map((stopReason, i) => ({
      type: "message",
      id: `entry${i}`,
      parentId: null,
      timestamp: new Date(0).toISOString(),
      pos: i,
      raw: {
        message: {
          role: "assistant",
          content: [{ type: "text", text: i ? "Complete" : "Partial" }],
          stopReason,
        },
      },
    })),
    [],
  );
  expect(built.items.map((i) => i.error)).toEqual([true, false]);
  expect(built.status).toBe("completed");
});

it("transcript overflow does not hide active recovery or displace the truncation warning", () => {
  const value = turn();
  value.notice = "retained truncated prefix";
  const recorder = new WorkflowTranscript(value, () => []);
  recorder.overflowed = true;
  expect(recorder.accept(frame({ kind: "model-retry", progress }))).toBe(true);
  expect(value.retry).toEqual(progress);
  expect(value.notice).toBe("retained truncated prefix");
  expect(
    recorder.accept(frame({ kind: "worker-failure", code: "prompt" })),
  ).toBe(true);
  expect(value.retry).toBeUndefined();
});
