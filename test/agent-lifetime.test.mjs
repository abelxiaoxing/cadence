import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { CaptureBudgetPool } from "../src/service/contracts/budget.ts";
import { ConversationWorkflow } from "../src/service/conversation-workflow.ts";
import {
  CaptureEmitter,
  CaptureQueue,
  SdkCapture,
} from "../src/worker-capture.mjs";
import { ownerAuth } from "../src/worker-model.mjs";
import { LIMITS } from "../src/worker-public.mjs";
import { WorkerRecording } from "../src/worker-recording.ts";
import { captureShell } from "../src/worker-tools.mjs";

afterEach(() => vi.useRealTimers());

it("bridge loss only detaches; accepted investigations retain their original settlement and results", async () => {
  vi.useFakeTimers();
  const command = vi.fn();
  let finish;
  const original = new Promise((resolve) => {
    finish = resolve;
  });
  const run = { id: "retained", status: "completed" };
  // Exercise the real admission/join method at its owner port, without a live
  // server or UI. The old implementation consumed the fifth abort argument.
  const coordinator = Object.create(ConversationWorkflow.prototype);
  Object.assign(coordinator, {
    o: {
      workflows: {
        activeRuns: () => ({ runs: [] }),
        command,
        join: () => original,
      },
    },
    save: vi.fn(),
    run: () => run,
    answers: (value) => value,
  });
  const bridge = new AbortController();
  const pending = Reflect.apply(
    Reflect.get(ConversationWorkflow.prototype, "research"),
    coordinator,
    [
      { state: { id: randomUUID(), revision: 0, runs: [] } },
      { goal: "Investigate", questions: ["Evidence?"] },
      randomUUID(),
      {},
      bridge.signal,
    ],
  );
  let settled = false;
  void pending.then(() => {
    settled = true;
  });
  bridge.abort(new Error("coordinator disconnected"));
  await vi.advanceTimersByTimeAsync(1_800_000);
  expect(command.mock.calls.map((call) => call[2].action)).toEqual([
    "research",
  ]);
  expect(settled).toBe(false);
  finish();
  expect(await pending).toBe(run);
});

it("slow recording is backpressure, not a five-second failure or release", async () => {
  vi.useFakeTimers();
  let callback;
  const fail = vi.fn();
  const emitter = new CaptureEmitter(
    randomUUID(),
    {
      write(_line, done) {
        callback = done;
      },
    },
    fail,
  );
  let settled = false;
  const write = emitter.emit({ kind: "ready", requestProtocol: 2 }).then(() => {
    settled = true;
  });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(settled).toBe(false);
  expect(fail).not.toHaveBeenCalled();
  expect(emitter.queue.bytes).toBeGreaterThan(0);
  callback();
  await write;
  await emitter.drain();
  expect(emitter.queue.bytes).toBe(0);
});

it("a real recording error still fails and never fabricates completion", async () => {
  const fail = vi.fn();
  const emitter = new CaptureEmitter(
    randomUUID(),
    {
      write(_line, done) {
        done(new Error("disk failure"));
      },
    },
    fail,
  );
  await expect(
    emitter.emit({ kind: "ready", requestProtocol: 2 }),
  ).rejects.toThrow();
  await emitter.drain();
  expect(fail).toHaveBeenCalledOnce();
  expect(emitter.broken).toBe(true);
  expect(emitter.state.selected).toBeNull();
});

it("cumulative protocol/events are diagnostics; settled message/tool state is reclaimed", async () => {
  const fail = vi.fn();
  const emitter = new CaptureEmitter(
    randomUUID(),
    {
      write(_line, done) {
        done();
      },
    },
    fail,
  );
  const capture = new SdkCapture(emitter);
  // Arithmetic injection tests the former lifetime boundaries, not native I/O.
  emitter.state.bytes = 128 * 1024 * 1024;
  emitter.state.position.workerSeq = 100_016;
  capture.events = 1_000_000;
  for (let n = 0; n < 12; n++) {
    const block = {
      type: "toolCall",
      id: `call-${n}`,
      name: "read",
      arguments: { path: "source" },
    };
    await capture.event({
      type: "message_start",
      message: { role: "assistant" },
    });
    await capture.event({
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_start",
        contentIndex: 0,
        partial: { content: [block] },
      },
    });
    await capture.event({
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_delta",
        contentIndex: 0,
        partial: { content: [block] },
        delta: '{"path":"source"}',
      },
    });
    await capture.event({
      type: "message_end",
      message: { role: "assistant", content: [block], stopReason: "toolUse" },
    });
    await capture.event({
      type: "tool_execution_start",
      toolCallId: block.id,
      toolName: "read",
      args: block.arguments,
    });
    const content = [{ type: "text", text: "evidence" }];
    await capture.event({
      type: "tool_execution_update",
      toolCallId: block.id,
      toolName: "read",
      partialResult: { content },
    });
    await capture.event({
      type: "tool_execution_end",
      toolCallId: block.id,
      toolName: "read",
      result: { content },
      isError: false,
    });
    const result = {
      role: "toolResult",
      toolCallId: block.id,
      toolName: "read",
      content,
    };
    await capture.event({ type: "message_start", message: result });
    await capture.event({ type: "message_end", message: result });
    expect(capture.calls).toHaveLength(0);
    expect(emitter.state.calls.size).toBe(0);
    expect(emitter.state.messages.size).toBeLessThanOrEqual(1);
    expect(emitter.state.details.size).toBeLessThanOrEqual(1);
    expect(emitter.state.blocks.size).toBe(0);
  }
  await capture.event({
    type: "message_start",
    message: { role: "assistant" },
  });
  await capture.event({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Final evidence" }],
      stopReason: "stop",
    },
  });
  await capture.final();
  expect(emitter.state.preview).toBe("Final evidence");
  expect(fail).not.toHaveBeenCalled();
  capture.dispose();
});

it("chatty shell output retains a redacted labelled tail without aborting the command", async () => {
  const queue = new CaptureQueue();
  const fail = vi.fn();
  const tool = captureShell(
    "/fixture",
    ["secret-canary"],
    fail,
    () => ({
      async exec(_command, _cwd, { onData, signal }) {
        const chunk = Buffer.from("x".repeat(8192));
        for (let n = 0; n < 80; n++) onData(chunk);
        onData(Buffer.from("secret-"));
        onData(Buffer.from("canary\nlast-line"));
        expect(signal.aborted).toBe(false);
        return { exitCode: 0 };
      },
    }),
    queue,
    createBashToolDefinition("/fixture"),
  );
  const result = await tool.execute(
    "shell",
    { command: "fixture" },
    new AbortController().signal,
  );
  expect(result.content[0].text).toContain("Output truncated");
  expect(result.content[0].text).toContain("[redacted]\nlast-line");
  expect(result.content[0].text).not.toContain("secret-canary");
  expect(Buffer.byteLength(result.content[0].text)).toBeLessThan(66000);
  expect(fail).not.toHaveBeenCalled();
  expect(queue.bytes).toBe(0);
});

it("request-bound auth serializes SDK compaction requests and never replays a refused refresh", async () => {
  let sentSecond;
  const nextSend = new Promise((resolve) => {
    sentSecond = resolve;
  });
  const channel = Object.assign(new EventEmitter(), {
    connected: true,
    send: vi.fn((message, callback) => {
      callback();
      if (message.id === 2) sentSecond();
    }),
  });
  const retained = vi.fn();
  const auth = ownerAuth(channel, retained);
  const first = auth.resolve();
  const second = auth.resolve();
  await Promise.resolve();
  expect(channel.send).toHaveBeenCalledTimes(1);
  const id = channel.send.mock.calls[0][0].id;
  channel.emit("message", {
    kind: "auth",
    id,
    ok: true,
    auth: { ok: true, apiKey: "renewed" },
  });
  expect(await first).toEqual({ ok: true, apiKey: "renewed" });
  await nextSend;
  expect(channel.send).toHaveBeenCalledTimes(2);
  const refused = expect(second).rejects.toThrow(
    "Owner authentication refused",
  );
  channel.emit("message", {
    kind: "auth",
    id: channel.send.mock.calls[1][0].id,
    ok: false,
  });
  await refused;
  expect(retained).toHaveBeenCalledTimes(1);
  expect(channel.send).toHaveBeenCalledTimes(2);
  auth.close();
  expect(channel.listenerCount("message")).toBe(0);
});

it.each([false, true])(
  "owner recording joins slow original commits; disk error=%s",
  async (diskError) => {
    vi.useFakeTimers();
    const pool = new CaptureBudgetPool();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const stop = vi.fn();
    const sink = {
      reserve(budget) {
        const lease = pool.reserve(budget);
        return {
          status: "reserved",
          reservation: {
            grow(extra) {
              lease.grow(extra);
              return { status: "reserved" };
            },
            release() {
              lease.release();
            },
            async commit(input) {
              lease.beginWorker(input);
              try {
                await gate;
                if (diskError) throw Error("disk failure");
                return {
                  status: "committed",
                  batch: {
                    committedSeq: "1",
                    details: [],
                    ownerDetails: [],
                    coverage: {
                      observed: "complete",
                      source: "complete",
                      redacted: false,
                      omissions: [],
                    },
                  },
                };
              } finally {
                lease.settled();
              }
            },
          },
        };
      },
    };
    const link = {
      epoch: randomUUID(),
      taskId: randomUUID(),
      runId: randomUUID(),
      childRunId: randomUUID(),
    };
    const recorder = new WorkerRecording(link, sink, [], stop);
    const frame = {
      protocol: 2,
      childRunId: link.childRunId,
      workerSeq: 1,
      observedMs: 0,
      event: { kind: "ready", requestProtocol: 2 },
    };
    recorder.accept(
      frame,
      recorder.reserveRaw(Buffer.byteLength(JSON.stringify(frame))),
    );
    let drained = false;
    const pending = recorder.drain().then(() => {
      drained = true;
    });
    const charged = pool.accounting;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(drained).toBe(false);
    expect(pool.accounting).toEqual(charged);
    expect(stop).not.toHaveBeenCalled();
    release();
    await pending;
    expect(recorder.incomplete).toBe(diskError);
    expect(stop).toHaveBeenCalledTimes(diskError ? 1 : 0);
    recorder.closeIngress();
    expect(pool.accounting.bytes).toBe(0);
  },
);

it("the unresolved protocol window is finite even though cumulative traffic is not", () => {
  const emitter = new CaptureEmitter(
    randomUUID(),
    {
      write(_line, done) {
        done();
      },
    },
    vi.fn(),
  );
  expect(LIMITS.captureEntries).toBe(4096);
  for (let n = 0; n <= LIMITS.captureEntries; n++)
    emitter.state.details.set(String(n), {});
  expect(() => emitter.emit({ kind: "ready", requestProtocol: 2 })).toThrow(
    "capacity",
  );
  expect(emitter.queue.bytes).toBe(0);
});

it("disconnect rejects all queued auth observers without sending or replaying their requests", async () => {
  const channel = Object.assign(new EventEmitter(), {
    connected: true,
    send: vi.fn((_message, done) => done()),
  });
  const failed = vi.fn();
  const auth = ownerAuth(channel, vi.fn(), failed);
  const observers = Array.from({ length: 5 }, () => auth.resolve());
  const settled = Promise.allSettled(observers);
  await Promise.resolve();
  expect(channel.send).toHaveBeenCalledTimes(1);
  auth.close();
  expect((await settled).every((result) => result.status === "rejected")).toBe(
    true,
  );
  expect(channel.send).toHaveBeenCalledTimes(1);
  expect(failed).toHaveBeenCalledOnce();
  expect(channel.listenerCount("message")).toBe(0);
  expect(channel.listenerCount("disconnect")).toBe(0);
});
