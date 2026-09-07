import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, expect, it, vi } from "vitest";
import { requestChildTurn } from "../src/child-model.ts";
import { runChildSession } from "../src/child-session.ts";
import { parentRoutePolicy } from "../src/route-policy.ts";
import { WorkerBroker } from "../src/worker-broker.ts";

const model = { id: "test", provider: "test", api: "faux" } as never;
const context = { messages: [], tools: [] };
const done = (stream: ReturnType<typeof createAssistantMessageEventStream>) => {
  stream.push({
    type: "done",
    reason: "stop",
    message: fauxAssistantMessage("ready"),
  });
  stream.end();
};
afterEach(() => vi.useRealTimers());

it("allows an already-serving endpoint to delay headers beyond ten seconds", async () => {
  vi.useFakeTimers();
  const broker = new WorkerBroker(parentRoutePolicy());
  let requests = 0;
  const pending = broker.run({
    operationId: "slow-headers",
    role: "design-explorer",
    execute: (attempt) => {
      requests++;
      return requestChildTurn({
        client: {
          streamSimple(_model, _context, options) {
            const stream = createAssistantMessageEventStream();
            setTimeout(() => {
              void options?.onResponse?.({ status: 200, headers: {} }, model);
              done(stream);
            }, 11000);
            return stream;
          },
        },
        model,
        context,
        signal: attempt.signal,
        sessionId: "headers",
        onMessage() {},
      });
    },
  });
  await vi.advanceTimersByTimeAsync(22250);
  expect(await pending).toMatchObject({ ok: true });
  expect(requests).toBe(1);
});

it.each([false, true])(
  "bounds first progress independently of headers (%s)",
  async (headers) => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let failure: unknown;
    const pending = requestChildTurn({
      client: {
        streamSimple(_model, _context, options) {
          const stream = createAssistantMessageEventStream();
          if (headers)
            setTimeout(() => {
              void options?.onResponse?.({ status: 200, headers: {} }, model);
            }, 80000);
          return stream;
        },
      },
      model,
      context,
      signal: controller.signal,
      sessionId: "no-progress",
      onMessage() {},
    }).catch((error) => {
      failure = error;
    });
    await vi.advanceTimersByTimeAsync(90250);
    expect(failure).toMatchObject({
      code: "first-progress-timeout",
      scope: "request",
    });
    expect(controller.signal.aborted).toBe(false);
    await pending;
  },
);

it("counts only nonempty deltas as progress and stops idle timing at terminal", async () => {
  vi.useFakeTimers();
  const stream = createAssistantMessageEventStream();
  let failure: unknown;
  const pending = requestChildTurn({
    client: { streamSimple: () => stream },
    model,
    context,
    signal: new AbortController().signal,
    sessionId: "idle",
    onMessage() {},
  }).catch((error) => {
    failure = error;
  });
  const partial = fauxAssistantMessage("x");
  stream.push({ type: "text_delta", contentIndex: 0, delta: "x", partial });
  await vi.advanceTimersByTimeAsync(170000);
  stream.push({ type: "text_delta", contentIndex: 0, delta: "", partial });
  await vi.advanceTimersByTimeAsync(10250);
  expect(failure).toMatchObject({ code: "stream-idle-timeout" });
  await pending;
  expect(vi.getTimerCount()).toBe(0);
});

it("clears a completed request before a long local-tool gap and budgets the next request", async () => {
  vi.useFakeTimers();
  const input = {
    model,
    context,
    signal: new AbortController().signal,
    sessionId: "multi",
    onMessage() {},
  };
  await requestChildTurn({
    ...input,
    client: {
      streamSimple() {
        const stream = createAssistantMessageEventStream();
        done(stream);
        return stream;
      },
    },
  });
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(200000);
  let failure: unknown;
  const pending = requestChildTurn({
    ...input,
    client: { streamSimple: () => createAssistantMessageEventStream() },
  }).catch((error) => {
    failure = error;
  });
  await vi.advanceTimersByTimeAsync(90250);
  expect(failure).toMatchObject({ code: "first-progress-timeout" });
  await pending;
});

it("stops a repeated read-only child loop without accepting prose or blaming a route", async () => {
  let calls = 0;
  const controller = new AbortController();
  const result = await runChildSession({
    cwd: process.cwd(),
    model,
    modelRuntime: {
      streamSimple() {
        if (++calls > 70) controller.abort();
        const stream = createAssistantMessageEventStream();
        stream.push({
          type: "done",
          reason: "toolUse",
          message: fauxAssistantMessage(fauxToolCall("ls", { path: "." }), {
            stopReason: "toolUse",
          }),
        });
        stream.end();
        return stream;
      },
    },
    signal: controller.signal,
    systemPrompt: "investigate",
    requestId: "loop",
    role: "design-explorer",
    output: "evidence",
    roots: [process.cwd()],
    timeoutMs: 20000,
  });
  expect(result).toMatchObject({
    ok: false,
    failure: { kind: "execution-limit", code: "child-turn-limit" },
    transportFailure: false,
  });
  expect(calls).toBe(64);
});

it("rejects an oversized initial context before contacting a Provider", async () => {
  const streamSimple = vi.fn(() => {
    const stream = createAssistantMessageEventStream();
    done(stream);
    return stream;
  });
  const result = await runChildSession({
    cwd: process.cwd(),
    model,
    modelRuntime: { streamSimple },
    systemPrompt: "x".repeat(4 * 1024 * 1024),
    requestId: "large",
    role: "design-explorer",
    output: "evidence",
    roots: [process.cwd()],
    timeoutMs: 1000,
  });
  expect(result).toMatchObject({
    ok: false,
    failure: { kind: "execution-limit", code: "child-context-limit" },
  });
  expect(streamSimple).not.toHaveBeenCalled();
});

it("ignores headers and terminal output arriving after a request has settled", async () => {
  let headers: (() => void) | undefined;
  const observed = vi.fn();
  await requestChildTurn({
    client: {
      streamSimple(_model, _context, options) {
        headers = () => {
          void options?.onResponse?.({ status: 200, headers: {} }, model);
        };
        const stream = createAssistantMessageEventStream();
        headers();
        done(stream);
        return stream;
      },
    },
    model,
    context,
    signal: new AbortController().signal,
    sessionId: "late-headers",
    onHeaders: observed,
    onMessage() {},
  });
  headers?.();
  expect(observed).toHaveBeenCalledTimes(1);
});

it("does not launch an executor after parent cancellation", async () => {
  const controller = new AbortController();
  controller.abort();
  const execute = vi.fn(async () => "unexpected");
  const result = await new WorkerBroker(parentRoutePolicy()).run({
    operationId: "already-cancelled",
    role: "design-explorer",
    signal: controller.signal,
    execute,
  });
  expect(result).toMatchObject({ ok: false, state: "cancelled" });
  expect(execute).not.toHaveBeenCalled();
});

it("rejects an oversized completed turn before executing its submission tool", async () => {
  const result = await runChildSession({
    cwd: process.cwd(),
    model,
    modelRuntime: {
      streamSimple() {
        const stream = createAssistantMessageEventStream();
        stream.push({
          type: "done",
          reason: "toolUse",
          message: fauxAssistantMessage(
            [
              { type: "text", text: "x".repeat(4 * 1024 * 1024) },
              fauxToolCall("abel_submit_result", {}),
            ],
            { stopReason: "toolUse" },
          ),
        });
        stream.end();
        return stream;
      },
    },
    systemPrompt: "investigate",
    requestId: "oversized-turn",
    role: "design-explorer",
    output: "evidence",
    roots: [process.cwd()],
    timeoutMs: 1000,
  });
  expect(result).toMatchObject({
    ok: false,
    failure: { kind: "execution-limit", code: "child-context-limit" },
    transportFailure: false,
    classification: { attempts: 0 },
  });
});
