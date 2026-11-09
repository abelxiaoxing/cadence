import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import {
  createProvider,
  InMemoryCredentialStore,
  InMemoryModelsStore,
} from "@earendil-works/pi-ai";
import * as api from "@earendil-works/pi-ai/api/openai-responses";
import {
  createAgentSession,
  createExtensionRuntime,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { afterEach, expect, it, vi } from "vitest";
import { BROWSER_COMMAND_ENTRY } from "../src/session-entries.mjs";
import { CaptureEmitter, SdkCapture } from "../src/worker-capture.mjs";
import { WORKER_POLICY, WorkerModelState } from "../src/worker-model.mjs";

const model = {
  id: "fixture",
  name: "Fixture",
  provider: "cadence-fixture",
  api: "openai-responses",
  baseUrl: "http://fixture.invalid/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32000,
  maxTokens: 1024,
};
const call = {
  type: "function_call",
  id: "fc_fixture",
  call_id: "call_fixture",
  name: "effect",
  arguments: '{"value":1}',
};
const item = {
  type: "message",
  role: "assistant",
  id: "msg_fixture",
  content: [{ type: "output_text", text: "Done", annotations: [] }],
};
function response(output, complete = true) {
  const events = [
    {
      type: "response.created",
      response: { id: "resp_fixture", status: "in_progress" },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: {
        ...output,
        ...(output.type === "function_call"
          ? { arguments: "" }
          : { content: [] }),
      },
    },
    output.type === "function_call"
      ? {
          type: "response.function_call_arguments.delta",
          output_index: 0,
          delta: complete ? output.arguments : '{"value":',
        }
      : { type: "response.output_text.delta", output_index: 0, delta: "Done" },
    ...(complete
      ? [
          { type: "response.output_item.done", output_index: 0, item: output },
          {
            type: "response.completed",
            response: {
              id: "resp_fixture",
              status: "completed",
              output: [output],
            },
          },
        ]
      : []),
  ];
  return new Response(
    events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
}
async function fixture(reply, options = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "worker-model-"));
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  let authRequests = 0;
  runtime.registerNativeProvider(
    createProvider({
      id: model.provider,
      models: [model],
      api,
      auth: {
        apiKey: {
          name: "Fixture",
          resolve: async () => {
            authRequests++;
            return { auth: { apiKey: "fixture-only" } };
          },
        },
      },
    }),
  );
  const manager = SessionManager.inMemory(cwd);
  const effects = [];
  const { session } = await createAgentSession({
    cwd,
    agentDir: cwd,
    model,
    modelRuntime: runtime,
    thinkingLevel: "off",
    tools: ["effect"],
    customTools: [
      {
        name: "effect",
        label: "effect",
        description: "Fixture effect",
        parameters: Type.Object({ value: Type.Number() }),
        execute: async (_id, args) => {
          effects.push(args.value);
          await options.effect?.(args.value);
          return { content: [{ type: "text", text: "effect completed" }] };
        },
      },
    ],
    settingsManager: SettingsManager.inMemory({
      ...WORKER_POLICY,
      httpIdleTimeoutMs: 0,
      // This fixture explicitly configures six retries; production inherits Pi.
      retry: {
        enabled: true,
        maxRetries: 6,
        baseDelayMs: 5000,
        maxAgentDelayMs: 120000,
        provider: { maxRetries: 0 },
      },
      ...options.settings,
    }),
    sessionManager: manager,
    resourceLoader: {
      getExtensions: () => ({
        extensions: [],
        errors: [],
        runtime: createExtensionRuntime(),
      }),
      getSkills: () => ({ skills: [], diagnostics: [] }),
      getPrompts: () => ({ prompts: [], diagnostics: [] }),
      getThemes: () => ({ themes: [], diagnostics: [] }),
      getAgentsFiles: () => ({ agentsFiles: [] }),
      getSystemPrompt: () => "Fixture",
      getSystemPromptSource: () => undefined,
      getAppendSystemPrompt: () => [],
      getAppendSystemPromptSources: () => [],
      extendResources() {},
      reload: async () => {},
    },
  });
  const frames = [],
    requests = [],
    failures = [];
  const emitter = new CaptureEmitter(
    randomUUID(),
    new Writable({
      write(chunk, _encoding, callback) {
        frames.push(JSON.parse(chunk.toString()));
        callback();
      },
    }),
    () => failures.push("capture"),
  );
  await emitter.emit({ kind: "ready", requestProtocol: 2 });
  const capture = new SdkCapture(emitter, ["fixture-only"]);
  const state = new WorkerModelState(
    (event) => emitter.emit(event),
    () => {
      failures.push("retry");
      void session.abort();
    },
  );
  const unsubscribeRetry = session.subscribe((event) => state.event(event));
  const stream = session.agent.streamFunction;
  session.agent.streamFunction = async (selected, context, options) => {
    await state.beginRequest();
    expect(selected).toMatchObject({
      id: model.id,
      provider: model.provider,
      api: model.api,
    });
    return stream(selected, context, {
      ...options,
      maxRetries: 0,
      fetch: async (_url, init) => {
        requests.push(JSON.parse(init.body));
        return reply(requests.length);
      },
    });
  };
  let user;
  const unsubscribe = session.agent.subscribe(async (event) => {
    if (
      event.type === "message_end" &&
      ["user", "assistant", "toolResult"].includes(event.message.role)
    ) {
      const entry = manager.getLeafEntry();
      expect(entry.type).toBe("message");
      expect(entry.message.role).toBe(event.message.role);
      if (entry.message.role === "user") {
        expect(user).toBeUndefined();
        user = entry.id;
      }
      manager.appendCustomEntry(BROWSER_COMMAND_ENTRY, {
        commandId: "fixture",
        userId: user,
      });
    }
    try {
      await capture.event(event);
    } catch (error) {
      failures.push({
        event: event.type,
        role: event.message?.role,
        error: error.stack,
      });
      throw error;
    }
  });
  // Leave the capture emitter's monotonic clock intact across SDK setup.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  return {
    session,
    manager,
    authRequests: () => authRequests,
    state,
    frames,
    requests,
    effects,
    failures,
    capture,
    start(text) {
      const run = session.prompt(text);
      void run.catch(() => {});
      return run;
    },
    async close() {
      await session.abort();
      unsubscribeRetry();
      await unsubscribe();
      capture.dispose();
      session.dispose();
      await emitter.drain();
    },
  };
}
afterEach(() => vi.useRealTimers());

it("real Responses EOF retries only the failed response, retaining one user and completed tool results", async () => {
  const f = await fixture((n) =>
    n === 1
      ? response(call)
      : n === 2
        ? response(
            { ...call, id: "fc_partial", call_id: "call_partial" },
            false,
          )
        : response(item),
  );
  try {
    const running = f.start("Do the fixture work");
    await vi.advanceTimersByTimeAsync(0);
    expect(f.failures).toEqual([]);
    expect(f.effects).toEqual([1]);
    expect(f.requests).toHaveLength(2);
    expect(f.state.progress).toEqual({
      phase: "waiting",
      attempt: 1,
      maxAttempts: 6,
      delayMs: 5000,
    });
    await vi.advanceTimersByTimeAsync(5000);
    await running;
    await f.capture.final();
    expect(f.failures).toEqual([]);
    expect(f.requests).toHaveLength(3);
    expect(f.effects).toEqual([1]);
    expect(f.frames.filter((f) => f.event.kind === "tool-start")).toHaveLength(
      1,
    );
    expect(
      f.frames
        .filter((f) => f.event.kind === "model-retry")
        .map((f) => f.event.progress?.phase ?? "finished"),
    ).toEqual(["waiting", "requesting", "finished"]);
    const entries = f.manager.getEntries();
    expect(
      entries.filter((e) => e.type === "message" && e.message.role === "user"),
    ).toHaveLength(1);
    expect(
      entries.filter(
        (e) => e.type === "message" && e.message.stopReason === "error",
      ),
    ).toHaveLength(1);
    expect(
      entries.some((e) => e.type === "context_edit" && e.replacement === null),
    ).toBe(true);
    const context = f.manager.buildSessionContext().messages;
    expect(context.some((m) => m.stopReason === "error")).toBe(false);
    expect(context.filter((m) => m.role === "toolResult")).toHaveLength(1);
    expect(JSON.stringify(f.requests[2])).toContain("effect completed");
    expect(JSON.stringify(f.requests[2])).not.toContain("call_partial");
  } finally {
    await f.close();
  }
});

it("six retries exhaust inside the same session and do not become success", async () => {
  const f = await fixture(() => response(item, false));
  try {
    const running = f.start("Fixture");
    await vi.advanceTimersByTimeAsync(0);
    for (const ms of [5000, 10000, 20000, 40000, 80000, 120000])
      await vi.advanceTimersByTimeAsync(ms);
    await running;
    expect(f.requests).toHaveLength(7);
    expect(f.state.retryAttempts).toBe(6);
    expect(f.state.progress).toBeNull();
    expect(
      f.manager
        .getEntries()
        .filter((e) => e.type === "message" && e.message.role === "user"),
    ).toHaveLength(1);
    expect(f.session.messages.at(-1).stopReason).toBe("error");
    await expect(f.capture.final()).rejects.toThrow();
    expect(f.effects).toEqual([]);
  } finally {
    await f.close();
  }
});

it("Stop during backoff settles without another request or renewed work", async () => {
  const f = await fixture(() => response(call, false));
  try {
    const running = f.start("Fixture");
    await vi.advanceTimersByTimeAsync(0);
    expect(f.state.progress?.phase).toBe("waiting");
    await f.session.abort();
    await running;
    await vi.advanceTimersByTimeAsync(300000);
    expect(f.requests).toHaveLength(1);
    expect(f.effects).toEqual([]);
    expect(f.state.progress).toBeNull();
    await expect(f.capture.final()).rejects.toThrow();
  } finally {
    await f.close();
  }
});

it.each([401, 403, 429])(
  "nonretryable auth/quota HTTP %s failures stop immediately",
  async (status) => {
    const f = await fixture(
      () =>
        new Response(
          JSON.stringify({
            error: {
              code: status === 429 ? "insufficient_quota" : "invalid_api_key",
              message:
                status === 429 ? "insufficient_quota" : "Invalid credential",
            },
          }),
          { status, headers: { "content-type": "application/json" } },
        ),
    );
    try {
      const running = f.start("Fixture");
      await vi.advanceTimersByTimeAsync(0);
      await running;
      expect(f.requests).toHaveLength(1);
      expect(f.state.retryAttempts).toBe(0);
      expect(f.session.messages.at(-1).stopReason).toBe("error");
    } finally {
      await f.close();
    }
  },
);

it("request observations reset even when a retry never receives HTTP headers", async () => {
  const events = [],
    fail = vi.fn();
  const state = new WorkerModelState((e) => events.push(e), fail);
  state.event({
    type: "auto_retry_start",
    attempt: 1,
    maxAttempts: 6,
    delayMs: 5000,
    errorMessage: "SECRET",
  });
  state.requestPrepared = true;
  state.actualResponseStatus = 200;
  await state.beginRequest();
  expect(state.requestPrepared).toBe(false);
  expect(state.actualResponseStatus).toBe("UNKNOWN");
  expect(state.progress.phase).toBe("requesting");
  expect(JSON.stringify(events)).not.toContain("SECRET");
  expect(fail).not.toHaveBeenCalled();
});

it.each(["throw", "reject"])(
  "synchronous session progress %s failure is caught and aborts via its owner",
  async (mode) => {
    const fail = vi.fn();
    const state = new WorkerModelState(() => {
      if (mode === "throw") throw new Error("SECRET");
      return Promise.reject(new Error("SECRET"));
    }, fail);
    expect(() =>
      state.event({
        type: "auto_retry_start",
        attempt: 1,
        maxAttempts: 6,
        delayMs: 5000,
      }),
    ).not.toThrow();
    await Promise.resolve();
    expect(fail).toHaveBeenCalledTimes(1);
  },
);

it("multiple investigation rounds can exceed 20 minutes in one SDK session and still summarize", async () => {
  const releases = [];
  const f = await fixture(
    (n) =>
      n <= 2
        ? response({
            ...call,
            id: `fc_${n}`,
            call_id: `call_${n}`,
            arguments: JSON.stringify({ value: n }),
          })
        : response(item),
    { effect: () => new Promise((resolve) => releases.push(resolve)) },
  );
  try {
    const running = f.start("Investigate two rounds then summarize");
    await vi.advanceTimersByTimeAsync(0);
    expect(f.effects).toEqual([1]);
    await vi.advanceTimersByTimeAsync(900_000);
    releases.shift()();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.effects).toEqual([1, 2]);
    await vi.advanceTimersByTimeAsync(900_000);
    expect(f.requests).toHaveLength(2);
    releases.shift()();
    await vi.advanceTimersByTimeAsync(0);
    await running;
    await f.capture.final();
    expect(f.failures).toEqual([]);
    expect(f.requests).toHaveLength(3);
    expect(f.session.getLastAssistantText()).toBe("Done");
    expect(f.authRequests()).toBeGreaterThanOrEqual(f.requests.length);
    expect(
      f.manager
        .getEntries()
        .filter((e) => e.type === "message" && e.message.role === "user"),
    ).toHaveLength(1);
  } finally {
    await f.close();
  }
});
it("SDK automatic compaction preserves history and capture selects the actual final response", async () => {
  const f = await fixture((n) => (n === 1 ? response(call) : response(item)), {
    settings: {
      compaction: { enabled: true, reserveTokens: 31000, keepRecentTokens: 0 },
    },
  });
  try {
    const running = f.start("context ".repeat(1200));
    await vi.advanceTimersByTimeAsync(0);
    await running;
    await f.capture.final();
    expect(f.failures).toEqual([]);
    expect(f.manager.getEntries().some((e) => e.type === "compaction")).toBe(
      true,
    );
    expect(
      f.manager
        .getEntries()
        .filter((e) => e.type === "message" && e.message.role === "user"),
    ).toHaveLength(1);
    expect(f.effects).toEqual([1]);
    expect(f.frames.at(-1).event.kind).toBe("final");
    expect(f.session.getLastAssistantText()).toBe("Done");
    expect(f.authRequests()).toBeGreaterThanOrEqual(f.requests.length);
  } finally {
    await f.close();
  }
});
it("the installed SDK accepts disabled HTTP idle timing and native compaction defaults", () => {
  const settings = SettingsManager.inMemory({
    ...WORKER_POLICY,
    httpIdleTimeoutMs: 0,
  });
  expect(settings.getHttpIdleTimeoutMs()).toBe(0);
  expect(settings.getCompactionEnabled()).toBe(true);
  expect(settings.getProviderRetrySettings().maxRetries).toBe(0);
});

it("inherited retry settings beyond six remain one SDK request loop with completed tools retained", async () => {
  const f = await fixture(
    (n) =>
      n === 1 ? response(call) : n < 9 ? response(item, false) : response(item),
    {
      settings: {
        retry: {
          enabled: true,
          maxRetries: 8,
          baseDelayMs: 1,
          maxAgentDelayMs: 1,
          provider: { maxRetries: 0 },
        },
      },
    },
  );
  try {
    const running = f.start("One effect, then finish the response");
    await vi.advanceTimersByTimeAsync(50);
    await running;
    await f.capture.final();
    expect(f.requests).toHaveLength(9);
    expect(f.effects).toEqual([1]);
    expect(f.failures).toEqual([]);
    expect(
      f.frames.some(
        (frame) =>
          frame.event.kind === "model-retry" &&
          frame.event.progress?.attempt === 7 &&
          frame.event.progress.maxAttempts === 8,
      ),
    ).toBe(true);
    expect(
      f.manager
        .getEntries()
        .filter(
          (entry) => entry.type === "message" && entry.message.role === "user",
        ),
    ).toHaveLength(1);
  } finally {
    await f.close();
  }
});
