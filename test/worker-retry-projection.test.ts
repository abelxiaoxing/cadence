import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { expect, it, vi } from "vitest";
import {
  type ChatTurn,
  decodeChatTurn,
} from "../src/service/contracts/workbench.ts";
import { LiveCapture } from "../src/service/conversations.ts";
import { turnItems } from "../src/service/pi-sessions.ts";
import { TurnCapture } from "../src/service/turn-capture.ts";
import { WorkflowTranscript } from "../src/service/workflow-report.ts";
import { CaptureEmitter, SdkCapture } from "../src/worker-capture.mjs";
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
/** Genuine, state-checked frames; no provider, worker or service is started. */
async function captureFixture(accept: (frame: CaptureFrame) => void) {
  const emitter = new CaptureEmitter(
    randomUUID(),
    new Writable({
      write(chunk, _encoding, done) {
        accept(JSON.parse(String(chunk)) as CaptureFrame);
        done();
      },
    }),
    () => {
      throw new Error("capture failed");
    },
  );
  await emitter.emit({ kind: "ready", requestProtocol: 2 });
  return new SdkCapture(emitter);
}

it("failed response text remains explicitly incomplete in live and retained projections", async () => {
  const value = turn(),
    live = new LiveCapture(() => []);
  const capture = new TurnCapture(
    value,
    () => {},
    () => [],
  );
  const sdk = await captureFixture((frame) => {
    capture.accept(frame);
    live.accept(frame);
  });
  await sdk.event({
    type: "message_start",
    message: { role: "assistant" },
  });
  const id = sdk.messageId!;
  await sdk.event({
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      contentIndex: 0,
      delta: "Partial",
    },
  });
  // Closes the real stream detail and emits finalBlockCount: 1, not an
  // empty assistant message that has no body to mark incomplete.
  await sdk.event({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Partial" }],
      stopReason: "error",
    },
  });
  expect(value.items).toHaveLength(1);
  expect(value.items[0].text).toBe("Partial");
  expect(value.items[0].error).toBe(true);
  const preview = live.extend([]).items;
  expect(preview).toHaveLength(1);
  expect(preview[0].error).toBe(true);
  expect(preview[0]).toMatchObject({
    renderId: `capture:${id}:0`,
    text: "Partial",
    state: "failed",
  });
  expect(sdk.selected).toBeNull();
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
  expect(built.items.map((i) => i.text)).toEqual(["Partial", "Complete"]);
  expect(built.items.map((i) => i.state)).toEqual(["failed", "completed"]);
  expect(built.status).toBe("completed");
});

it("an empty assistant adds no body and preserves adjacent legitimate repeated text", async () => {
  const live = new LiveCapture(() => []);
  const sdk = await captureFixture((frame) => live.accept(frame));
  const entries = [
    [{ type: "text", text: "Repeated" }],
    [],
    [{ type: "text", text: "Repeated" }],
  ].map((content, i) => ({
    type: "message",
    id: `entry${i}`,
    parentId: i ? `entry${i - 1}` : null,
    timestamp: new Date(0).toISOString(),
    pos: i,
    raw: { message: { role: "assistant", content, stopReason: "stop" } },
  }));
  const expected: { renderId: string; text: string }[] = [];
  const preview = () =>
    live.extend([]).items.map(({ renderId, text }) => ({ renderId, text }));
  for (const entry of entries) {
    await sdk.event({
      type: "message_start",
      message: { role: "assistant" },
    });
    const id = sdk.messageId!;
    expect(preview()).toEqual(expected);
    await sdk.event({ type: "message_end", message: entry.raw.message });
    if (entry.raw.message.content.length)
      expected.push({ renderId: `capture:${id}:0`, text: "Repeated" });
    // Assert at every boundary, including the empty message, not only after
    // the second identical body has arrived.
    expect(preview()).toEqual(expected);
  }
  expect(expected).toHaveLength(2);
  expect(expected[0].renderId).not.toBe(expected[1].renderId);
  expect(live.extend([]).items.map((i) => i.state)).toEqual([
    "completed",
    "completed",
  ]);
  const built = turnItems(entries, []);
  expect(built.items.map((i) => i.id)).toEqual(["entry0:0", "entry2:0"]);
  expect(built.items.map((i) => i.text)).toEqual(["Repeated", "Repeated"]);
  expect(built.items.map((i) => i.error)).toEqual([false, false]);
  expect(turnItems([entries[1]], []).items).toEqual([]);
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
