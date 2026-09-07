import {
  type AssistantMessage,
  type Context,
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxToolCall,
  registerSessionResourceCleanup,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChildModelClient } from "../src/child-model.ts";
import { runChildSession } from "../src/child-session.ts";

const model = { id: "test", provider: "test", api: "faux" } as never;
function run(client: ChildModelClient, signal?: AbortSignal, timeoutMs = 1000) {
  return runChildSession({
    cwd: process.cwd(),
    modelRuntime: client,
    model,
    systemPrompt: "investigate",
    requestId: "packet-1",
    role: "design-explorer",
    output: "evidence",
    roots: [process.cwd()],
    timeoutMs,
    signal,
  });
}
function terminal(
  stream: ReturnType<typeof createAssistantMessageEventStream>,
  message: AssistantMessage,
) {
  if (message.stopReason === "aborted" || message.stopReason === "error")
    stream.push({ type: "error", reason: message.stopReason, error: message });
  else stream.push({ type: "done", reason: "stop", message });
  stream.end();
}
afterEach(() => vi.useRealTimers());

const validSubmission = {
  id: "packet-1",
  role: "implementation-worker",
  kind: "diff",
  taskId: "task-1",
  phase: "red",
  summary: "change a.txt",
  diff: "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n",
  expectedVerification: "check a.txt",
  risks: [],
  contractCompliant: true,
};
const rejections = [
  {
    name: "preflight",
    submission: { ...validSubmission, summary: { invalid: true } },
    code: "invalid-structural-result",
    schema: "invalid",
  },
  {
    name: "identity",
    submission: { ...validSubmission, taskId: "wrong-task" },
    code: "structural-identity-mismatch",
    schema: "valid",
  },
];
function runAfterRejection(
  submission: Record<string, unknown>,
  next: ChildModelClient["streamSimple"],
  signal?: AbortSignal,
) {
  let calls = 0;
  const result = runChildSession({
    cwd: process.cwd(),
    modelRuntime: {
      streamSimple(...args) {
        if (++calls > 1) return next(...args);
        const stream = createAssistantMessageEventStream();
        terminal(
          stream,
          fauxAssistantMessage(fauxToolCall("abel_submit_result", submission), {
            stopReason: "toolUse",
          }),
        );
        return stream;
      },
    },
    model,
    systemPrompt: "submit",
    requestId: "packet-1",
    taskId: "task-1",
    role: "implementation-worker",
    phase: "red",
    output: "diff",
    roots: [process.cwd()],
    timeoutMs: 1000,
    signal,
  });
  return { result, calls: () => calls };
}

describe.each(rejections)(
  "retained $name submission rejection",
  (rejection) => {
    it.each(["error", "aborted", "throw", "iterator-throw", "empty", "length"])(
      "survives a subsequent Provider %s",
      async (mode) => {
        const pending = runAfterRejection(rejection.submission, () => {
          if (mode === "throw") throw new Error("SECRET provider failure");
          const stream = createAssistantMessageEventStream();
          if (mode === "iterator-throw") {
            stream[Symbol.asyncIterator] = () => ({
              async next() {
                throw new Error("SECRET stream failure");
              },
            });
          } else if (mode === "empty") stream.end();
          else
            terminal(
              stream,
              fauxAssistantMessage([], {
                stopReason: mode as "error" | "aborted" | "length",
                errorMessage: "SECRET provider failure",
              }),
            );
          return stream;
        });
        const result = await pending.result;
        expect(result).toMatchObject({
          ok: false,
          failure: {
            kind: "artifact",
            code: rejection.code,
            stage: "structural-submit",
            details: { submitAttempts: 1, schema: rejection.schema },
          },
          transportFailure: false,
          disposeCount: 1,
          classification: { attempts: 1, schema: rejection.schema },
        });
        if (rejection.name === "identity")
          expect(result).toMatchObject({
            failure: { details: { identityMismatch: ["task"] } },
          });
        expect(pending.calls()).toBe(2);
        expect(JSON.stringify(result)).not.toContain("SECRET");
      },
    );

    it("clears the rejection after a valid correction", async () => {
      const pending = runAfterRejection(rejection.submission, () => {
        const stream = createAssistantMessageEventStream();
        terminal(
          stream,
          fauxAssistantMessage(
            fauxToolCall("abel_submit_result", validSubmission),
            {
              stopReason: "toolUse",
            },
          ),
        );
        return stream;
      });
      expect(await pending.result).toMatchObject({
        ok: true,
        result: validSubmission,
        submitCount: 2,
        classification: {
          attempts: 2,
          schema: "valid",
          identity: { task: true },
        },
      });
      expect(pending.calls()).toBe(2);
    });

    it.each(["cancel", "deadline"])("yields to %s", async (mode) => {
      vi.useFakeTimers();
      const controller = new AbortController();
      const pending = runAfterRejection(
        rejection.submission,
        (_model, _context, options) => {
          const stream = createAssistantMessageEventStream();
          options?.signal?.addEventListener("abort", () =>
            terminal(
              stream,
              fauxAssistantMessage([], { stopReason: "aborted" }),
            ),
          );
          return stream;
        },
        controller.signal,
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(pending.calls()).toBe(2);
      if (mode === "cancel") controller.abort();
      else await vi.advanceTimersByTimeAsync(1000);
      expect(await pending.result).toMatchObject({
        ok: false,
        failure:
          mode === "cancel"
            ? { kind: "cancelled", code: "cancelled" }
            : { kind: "transport", code: "child-timeout" },
        failureKind: mode === "cancel" ? "cancelled" : "timed-out",
        disposeCount: 1,
      });
    });
  },
);

describe("child transport and private conversation cancellation", () => {
  it("cleans only the child's unique provider session resources once", async () => {
    const cleaned: Array<string | undefined> = [];
    let childId: string | undefined;
    const unregister = registerSessionResourceCleanup((id) => cleaned.push(id));
    try {
      await run({
        streamSimple(_model, _context, options) {
          childId = options?.sessionId;
          const stream = createAssistantMessageEventStream();
          terminal(stream, fauxAssistantMessage("done"));
          return stream;
        },
      });
      expect(childId).toEqual(expect.any(String));
      expect(cleaned).toEqual([childId]);
    } finally {
      unregister();
    }
  });

  it("reports cleanup failure without exposing private errors or throwing from finalization", async () => {
    const unregister = registerSessionResourceCleanup(() => {
      throw new Error("SECRET cleanup");
    });
    try {
      const result = await run({
        streamSimple() {
          const stream = createAssistantMessageEventStream();
          terminal(stream, fauxAssistantMessage("done"));
          return stream;
        },
      });
      expect(result.ok).toBe(false);
      expect(result.disposeCount).toBe(1);
      expect(JSON.stringify(result)).not.toContain("SECRET");
    } finally {
      unregister();
    }
  });

  it.each(["cancel", "deadline"])(
    "preserves %s and the original deadline during reminder",
    async (mode) => {
      vi.useFakeTimers();
      const controller = new AbortController();
      const requests: { context: Context; options?: SimpleStreamOptions }[] =
        [];
      const client: ChildModelClient = {
        streamSimple(_model, context, options) {
          requests.push({ context: structuredClone(context), options });
          const stream = createAssistantMessageEventStream();
          if (requests.length === 1)
            setTimeout(
              () => terminal(stream, fauxAssistantMessage("done")),
              600,
            );
          options?.signal?.addEventListener(
            "abort",
            () =>
              terminal(
                stream,
                fauxAssistantMessage([], { stopReason: "aborted" }),
              ),
            { once: true },
          );
          return stream;
        },
      };
      const resultPromise = run(client, controller.signal);
      await vi.advanceTimersByTimeAsync(600);
      expect(requests).toHaveLength(2);
      expect(JSON.stringify(requests[1].context.messages)).toContain(
        "original deadline",
      );
      expect(requests[0].options?.sessionId).toBe(
        requests[1].options?.sessionId,
      );
      expect(requests[0].options?.signal).not.toBe(requests[1].options?.signal);
      if (mode === "cancel") controller.abort(new Error("cancelled reminder"));
      else await vi.advanceTimersByTimeAsync(400);
      const result = await resultPromise;
      expect(requests[1].options?.signal?.aborted).toBe(true);
      expect(result).toMatchObject({
        ok: false,
        disposeCount: 1,
        failureKind: mode === "cancel" ? "cancelled" : "timed-out",
      });
      expect(requests).toHaveLength(2);
    },
  );

  it("does not call a Provider when already cancelled", async () => {
    const streamSimple = vi.fn();
    const controller = new AbortController();
    controller.abort();
    expect(await run({ streamSimple }, controller.signal)).toMatchObject({
      ok: false,
      failureKind: "cancelled",
    });
    expect(streamSimple).not.toHaveBeenCalled();
  });

  it("bounds cleanup for a Provider which ignores cancellation and rejects late output", async () => {
    vi.useFakeTimers();
    const stream = createAssistantMessageEventStream();
    const controller = new AbortController();
    const resultPromise = run(
      { streamSimple: () => stream },
      controller.signal,
    );
    controller.abort();
    await vi.advanceTimersByTimeAsync(250);
    const result = await resultPromise;
    expect(result).toMatchObject({
      ok: false,
      failureKind: "cancelled",
      disposeCount: 1,
    });
    const before = structuredClone(result);
    terminal(stream, fauxAssistantMessage("late private output"));
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toEqual(before);
  });

  it("retains usage emitted while cooperative cancellation settles", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const client: ChildModelClient = {
      streamSimple(_model, _context, options) {
        const stream = createAssistantMessageEventStream();
        options?.signal?.addEventListener("abort", () =>
          setTimeout(() => {
            const message = fauxAssistantMessage([], { stopReason: "aborted" });
            message.usage.totalTokens = 9;
            terminal(stream, message);
          }, 10),
        );
        return stream;
      },
    };
    const pending = run(client, controller.signal);
    controller.abort();
    await vi.advanceTimersByTimeAsync(10);
    expect(await pending).toMatchObject({
      ok: false,
      failureKind: "cancelled",
      usage: { totalTokens: 9 },
    });
  });

  it("distinguishes a stream ending without a terminal message", async () => {
    const result = await run({
      streamSimple() {
        const stream = createAssistantMessageEventStream();
        stream.end();
        return stream;
      },
    });
    expect(result).toMatchObject({
      ok: false,
      failure: { kind: "transport", code: "child-no-final-assistant" },
    });
  });

  it("classifies synchronous Provider failures without exposing raw text", async () => {
    const result = await run({
      streamSimple() {
        throw new Error("SECRET credential payload");
      },
    });
    expect(result).toMatchObject({
      ok: false,
      failure: { kind: "transport", code: "child-provider-stream-error" },
    });
    expect(JSON.stringify(result)).not.toMatch(/SECRET|credential|payload/);
  });

  it("counts distinct terminal messages even when timestamps collide", async () => {
    let count = 0;
    const result = await run({
      streamSimple() {
        const stream = createAssistantMessageEventStream();
        const message = fauxAssistantMessage("done");
        message.timestamp = 1;
        message.usage.totalTokens = ++count === 1 ? 5 : 7;
        terminal(stream, message);
        return stream;
      },
    });
    expect(result).toMatchObject({
      ok: false,
      usage: { totalTokens: 12 },
      disposeCount: 1,
    });
    expect(count).toBe(2);
  });
});
