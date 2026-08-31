import type {
  AssistantMessageEventStream,
  Context,
  Model,
  Provider,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { streamSimple as openAIResponsesStreamSimple } from "@earendil-works/pi-ai/api/openai-responses";
import {
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai/providers/faux";
import { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  runtimeForProvider,
  runtimeForWorkerRoute,
} from "../src/parent-provider.ts";
import { parentRoutePolicy } from "../src/route-policy.ts";
import {
  ROUTE_ATTEMPT_BOUNDS,
  RunWorkerBroker,
  WorkerBroker,
} from "../src/worker-broker.ts";
import { PassthroughParentPayloadBridge } from "./helpers/passthrough-parent-payload-bridge.ts";

afterEach(() => {
  vi.useRealTimers();
});

function requestContext(): Context {
  return {
    systemPrompt: "Return one response.",
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: "respond" }],
        timestamp: Date.now(),
      },
    ],
    tools: [],
  };
}

async function consumePhaseStream(
  phase: Extract<
    Awaited<ReturnType<typeof runtimeForWorkerRoute>>,
    { ok: true }
  >,
  attempt: {
    signal: AbortSignal;
    onProgress(): void;
  },
) {
  const stream = phase.modelRuntime.streamSimple(
    phase.model,
    requestContext(),
    { maxRetries: 0, signal: attempt.signal },
  );
  for await (const event of stream) {
    if (
      [
        "text_start",
        "text_delta",
        "thinking_start",
        "thinking_delta",
        "toolcall_start",
        "toolcall_delta",
      ].includes(event.type)
    ) {
      attempt.onProgress();
    }
    if (event.type === "error") throw new Error("provider-stream-failure");
  }
  const result = await stream.result();
  if (result.stopReason === "error" || result.stopReason === "aborted") {
    throw new Error("provider-stream-failure");
  }
  return result;
}

describe("Worker transport lifecycle", () => {
  it("observes inherited Provider response headers before assistant protocol events", async () => {
    const faux = fauxProvider({
      provider: "transport-lifecycle-parent",
      api: "faux",
    });
    faux.setResponses([fauxAssistantMessage("ready")]);
    const parentRuntime = await runtimeForProvider(faux.provider);
    const route = parentRoutePolicy({
      contextWindow: faux.getModel().contextWindow,
      maxTokens: faux.getModel().maxTokens,
    }).routes.parent;
    if (!route) throw new Error("inherited route fixture is unavailable");

    const lifecycle: string[] = [];
    const phase = await runtimeForWorkerRoute(
      route,
      {
        model: faux.getModel(),
        modelRegistry: new ModelRegistry(parentRuntime),
      },
      new PassthroughParentPayloadBridge(),
      undefined,
      process.env,
      { onResponse: () => lifecycle.push("headers") },
    );
    if (!phase.ok) throw new Error(phase.error);

    const stream = phase.modelRuntime.streamSimple(
      phase.model,
      requestContext(),
      { maxRetries: 0 },
    );
    for await (const event of stream) {
      lifecycle.push(`assistant:${event.type}`);
    }
    await stream.result();

    expect(lifecycle[0]).toBe("headers");
    expect(lifecycle).toContain("assistant:start");
  });

  it("classifies two parallel inherited attempts with headers but no first delta as first-response-timeout", async () => {
    vi.useFakeTimers();
    const faux = fauxProvider({
      provider: "parallel-stalled-parent",
      api: "faux",
    });
    const totalAttempts = ROUTE_ATTEMPT_BOUNDS.attemptsPerRoute * 2;
    faux.setResponses(
      Array.from(
        { length: totalAttempts },
        () => async () => new Promise<never>(() => {}),
      ),
    );
    const parentRuntime = await runtimeForProvider(faux.provider);
    const context = {
      model: faux.getModel(),
      modelRegistry: new ModelRegistry(parentRuntime),
    };
    const broker = new RunWorkerBroker(
      parentRoutePolicy({
        contextWindow: faux.getModel().contextWindow,
        maxTokens: faux.getModel().maxTokens,
      }),
    );
    const activity = new Map<string, string[]>();
    const run = (taskId: string) =>
      broker.run({
        runId: "parallel-inherited-timeout",
        operationId: `parallel-inherited-timeout:${taskId}:red`,
        role: "implementation-worker",
        onActivity: (event) => {
          const events = activity.get(taskId) ?? [];
          events.push(event.state);
          activity.set(taskId, events);
        },
        execute: async (attempt) => {
          const phase = await runtimeForWorkerRoute(
            attempt.route,
            context,
            new PassthroughParentPayloadBridge(),
            attempt.signal,
            process.env,
            { onResponse: attempt.onHeaders },
          );
          if (!phase.ok) throw new Error(phase.error);
          return consumePhaseStream(phase, attempt);
        },
      });

    const pending = [run("T1"), run("T7")];
    for (let flush = 0; flush < 20 && faux.state.callCount < 2; flush += 1) {
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(faux.state.callCount).toBe(2);
    expect(activity.get("T1")).toContain("waiting-first-response");
    expect(activity.get("T7")).toContain("waiting-first-response");

    for (
      let attempt = 0;
      attempt < ROUTE_ATTEMPT_BOUNDS.attemptsPerRoute;
      attempt += 1
    ) {
      await vi.advanceTimersByTimeAsync(
        ROUTE_ATTEMPT_BOUNDS.firstResponseMs + 1,
      );
    }
    const results = await Promise.all(pending);
    for (const result of results) {
      expect(result).toMatchObject({
        ok: false,
        state: "paused",
        code: "first-response-timeout",
      });
      expect(result.attempts).toHaveLength(
        ROUTE_ATTEMPT_BOUNDS.attemptsPerRoute,
      );
      expect(
        result.attempts.every(
          (attempt) => attempt.code === "first-response-timeout",
        ),
      ).toBe(true);
    }
  });

  it("clears connection and first-response timers after inherited stream progress", async () => {
    vi.useFakeTimers();
    const faux = fauxProvider({
      provider: "timer-cleanup-parent",
      api: "faux",
      tokensPerSecond: 0.02,
      tokenSize: { min: 1, max: 1 },
    });
    faux.setResponses([fauxAssistantMessage("ready")]);
    const parentRuntime = await runtimeForProvider(faux.provider);
    const context = {
      model: faux.getModel(),
      modelRegistry: new ModelRegistry(parentRuntime),
    };
    const broker = new RunWorkerBroker(
      parentRoutePolicy({
        contextWindow: faux.getModel().contextWindow,
        maxTokens: faux.getModel().maxTokens,
      }),
    );
    const activity: string[] = [];
    let settled = false;
    const pending = broker
      .run({
        runId: "inherited-timer-cleanup",
        operationId: "inherited-timer-cleanup:T1:red",
        role: "implementation-worker",
        onActivity: (event) => activity.push(event.state),
        execute: async (attempt) => {
          const phase = await runtimeForWorkerRoute(
            attempt.route,
            context,
            new PassthroughParentPayloadBridge(),
            attempt.signal,
            process.env,
            { onResponse: attempt.onHeaders },
          );
          if (!phase.ok) throw new Error(phase.error);
          return consumePhaseStream(phase, attempt);
        },
      })
      .finally(() => {
        settled = true;
      });

    for (
      let flush = 0;
      flush < 20 && !activity.includes("running");
      flush += 1
    ) {
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(activity).toContain("waiting-first-response");
    expect(activity).toContain("running");

    await vi.advanceTimersByTimeAsync(ROUTE_ATTEMPT_BOUNDS.firstResponseMs + 1);
    expect(settled).toBe(false);
    expect(activity).not.toContain("retrying");

    await vi.advanceTimersByTimeAsync(60_000);
    const result = await pending;

    expect(result.ok).toBe(true);
    expect(activity.slice(0, 2)).toEqual([
      "connecting",
      "waiting-first-response",
    ]);
    expect(activity.slice(2).every((state) => state === "running")).toBe(true);
    const settledActivity = [...activity];
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(
      ROUTE_ATTEMPT_BOUNDS.totalMs + ROUTE_ATTEMPT_BOUNDS.idleMs,
    );
    expect(activity).toEqual(settledActivity);
    expect(broker.status()).toMatchObject({
      routes: [expect.objectContaining({ id: "parent", health: "healthy" })],
    });
  });

  it.each([401, 429, 503])(
    "classifies an immediate HTTP %i as transport-failure, not connect-timeout",
    async (status) => {
      const model: Model<"openai-responses"> = {
        id: `status-${status}`,
        name: `Status ${status}`,
        api: "openai-responses",
        provider: `status-provider-${status}`,
        baseUrl: "https://status.invalid/v1",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 32_768,
        maxTokens: 2_048,
      };
      const respond = (
        requestModel: Model<string>,
        context: Context,
        options?: SimpleStreamOptions,
      ): AssistantMessageEventStream =>
        openAIResponsesStreamSimple(
          requestModel as Model<"openai-responses">,
          context,
          {
            ...options,
            maxRetries: 0,
            fetch: async () =>
              new Response(
                JSON.stringify({
                  error: { message: "request rejected", type: "test_error" },
                }),
                {
                  status,
                  headers: { "content-type": "application/json" },
                },
              ),
          } as never,
        );
      const provider = {
        id: model.provider,
        name: `Status Provider ${status}`,
        baseUrl: model.baseUrl,
        auth: {
          apiKey: {
            name: "Status fixture auth",
            resolve: async () => ({ auth: { apiKey: "test-only-key" } }),
          },
        },
        getModels: () => [model],
        stream: respond,
        streamSimple: respond,
      } as unknown as Provider;
      const parentRuntime = await runtimeForProvider(provider);
      const context = {
        model,
        modelRegistry: new ModelRegistry(parentRuntime),
      };
      const broker = new RunWorkerBroker(
        parentRoutePolicy({
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
        }),
      );
      const result = await broker.run({
        runId: `http-status-${status}`,
        operationId: `http-status-${status}:T1:red`,
        role: "implementation-worker",
        execute: async (attempt) => {
          const phase = await runtimeForWorkerRoute(
            attempt.route,
            context,
            new PassthroughParentPayloadBridge(),
            attempt.signal,
            process.env,
            { onResponse: attempt.onHeaders },
          );
          if (!phase.ok) throw new Error(phase.error);
          return consumePhaseStream(phase, attempt);
        },
      });

      expect(result).toMatchObject({
        ok: false,
        state: "paused",
        code: "transport-failure",
      });
      expect(
        result.attempts.every(
          (attempt) => attempt.code === "transport-failure",
        ),
      ).toBe(true);
    },
  );

  it("opens once, derives retryAt in milliseconds, and closes after a successful half-open probe", async () => {
    let now = 1_788_164_412_173;
    const policy = parentRoutePolicy({
      contextWindow: 274_000,
      maxTokens: 128_000,
    });
    const broker = new WorkerBroker(policy, { now: () => now });
    broker.markFailure("parent", "connect-timeout");
    expect(broker.status()).toMatchObject({
      routes: [
        expect.objectContaining({
          id: "parent",
          health: "open",
          retryAt: now + ROUTE_ATTEMPT_BOUNDS.cooldownMs,
        }),
      ],
    });
    expect(broker.select({ role: "implementation-worker" })).toEqual({
      ok: false,
      code: "endpoint-unavailable",
    });

    now += ROUTE_ATTEMPT_BOUNDS.cooldownMs;
    expect(broker.select({ role: "implementation-worker" })).toMatchObject({
      ok: true,
      route: { id: "parent" },
      health: "half-open",
    });
    await expect(
      broker.run({
        operationId: "successful-half-open-probe",
        role: "implementation-worker",
        execute: async (attempt) => {
          attempt.onHeaders();
          attempt.onProgress();
          return { kind: "candidate" };
        },
      }),
    ).resolves.toMatchObject({ ok: true, routeId: "parent" });
    expect(broker.status()).toMatchObject({
      routes: [expect.objectContaining({ id: "parent", health: "healthy" })],
    });
    expect(JSON.stringify(broker.status())).not.toContain("retryAt");
  });
});
