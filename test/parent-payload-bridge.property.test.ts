import {
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Context,
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  type Model,
  type Provider,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
  type ParentModelKey,
  ParentPayloadBridge,
  type ParentPayloadCapture,
  type ParentPayloadCallback as PayloadCallback,
  type ParentProviderRegistry as ProviderRegistry,
} from "../src/parent-payload-bridge.ts";

function requireBridge(): typeof ParentPayloadBridge {
  return ParentPayloadBridge;
}

type ParentPayloadBridgeConstructor = typeof ParentPayloadBridge;

interface RequestOptions {
  signal?: AbortSignal;
  onPayload?: PayloadCallback;
  [key: string]: unknown;
}

type ProviderMethod = "stream" | "streamSimple";
type ProviderHandler = (
  method: ProviderMethod,
  model: Model<string>,
  context: Context,
  options: RequestOptions | undefined,
) => AssistantMessageEventStream;

const context: Context = { messages: [] };

function modelFor(
  seed: number,
  api = "faux",
  baseUrl = `https://provider-${seed}.example/v1`,
): Model<string> {
  return {
    id: `model-${seed}`,
    name: `Model ${seed}`,
    api,
    provider: `provider-${seed}`,
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: 16_384,
    maxTokens: 2_048,
  };
}

function modelKey(model: Model<string>): ParentModelKey {
  return {
    provider: model.provider,
    id: model.id,
    api: model.api,
    baseUrl: model.baseUrl,
  };
}

function messageFor(
  model: Model<string>,
  stopReason: "stop" | "error" | "aborted" = "stop",
): AssistantMessage {
  return {
    ...fauxAssistantMessage(`result-${model.id}`, { stopReason }),
    api: model.api,
    provider: model.provider,
    model: model.id,
    stopReason,
  };
}

type StreamOutcome = "done" | "error" | "aborted" | "incomplete";

function terminalStream(
  model: Model<string>,
  outcome: StreamOutcome,
): {
  stream: AssistantMessageEventStream;
  event: AssistantMessageEvent | undefined;
  result: AssistantMessage;
} {
  const stream = createAssistantMessageEventStream();
  const result = messageFor(
    model,
    outcome === "done" || outcome === "incomplete" ? "stop" : outcome,
  );
  const event: AssistantMessageEvent | undefined =
    outcome === "done"
      ? { type: "done", reason: "stop", message: result }
      : outcome === "error" || outcome === "aborted"
        ? { type: "error", reason: outcome, error: result }
        : undefined;
  queueMicrotask(() => {
    if (event) stream.push(event);
    stream.end(event ? result : undefined);
  });
  return { stream, event, result };
}

function providerFor(model: Model<string>, handler: ProviderHandler): Provider {
  return {
    id: model.provider,
    name: `Provider ${model.provider}`,
    baseUrl: model.baseUrl,
    auth: {
      apiKey: {
        name: "Parent payload bridge fixture",
        resolve: async () => ({ auth: {} }),
      },
    },
    getModels: () => [model],
    stream(requestModel, requestContext, options) {
      return handler(
        "stream",
        requestModel as Model<string>,
        requestContext,
        options as RequestOptions | undefined,
      );
    },
    streamSimple(requestModel, requestContext, options) {
      return handler(
        "streamSimple",
        requestModel as Model<string>,
        requestContext,
        options as RequestOptions | undefined,
      );
    },
  } as Provider;
}

function invoke(
  provider: Provider,
  method: ProviderMethod,
  model: Model<string>,
  options?: RequestOptions,
): AssistantMessageEventStream {
  return method === "stream"
    ? provider.stream(model, context, options as never)
    : provider.streamSimple(model, context, options as never);
}

async function collect(
  stream: AssistantMessageEventStream,
): Promise<AssistantMessageEvent[]> {
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

async function settleCapture(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let index = 0; index < 50; index++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  expect.fail(`fixture did not reach ${label}`);
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

async function armCapture(
  bridge: ParentPayloadBridge,
  provider: Provider,
  model: Model<string>,
  onPayload: PayloadCallback,
  method: ProviderMethod = "stream",
): Promise<{
  capture: ParentPayloadCapture;
  output: AssistantMessageEventStream;
  events: AssistantMessageEvent[];
  result: AssistantMessage;
}> {
  const wrapped = bridge.wrapProvider(provider);
  const output = invoke(wrapped, method, model, { onPayload });
  const events = await collect(output);
  const result = await output.result();
  await settleCapture();
  const capture = bridge.capture(modelKey(model));
  expect(capture).toBeDefined();
  return { capture: capture!, output, events, result };
}

async function readyFixture(
  Bridge: ParentPayloadBridgeConstructor,
  seed: number,
  parentOnPayload: PayloadCallback,
  api = "faux",
): Promise<{
  bridge: ParentPayloadBridge;
  model: Model<string>;
  provider: Provider;
  capture: ParentPayloadCapture;
  delegateCalls: number;
}> {
  const bridge = new Bridge();
  const model = modelFor(seed, api);
  let delegateCalls = 0;
  const provider = providerFor(model, (_method, requestModel) => {
    delegateCalls++;
    return terminalStream(requestModel, "done").stream;
  });
  bridge.beginSession(`session-${seed}`);
  const armed = await armCapture(bridge, provider, model, parentOnPayload);
  return {
    bridge,
    model,
    provider,
    capture: armed.capture,
    get delegateCalls() {
      return delegateCalls;
    },
  };
}

describe("parent payload bridge properties", () => {
  it("binds readiness to the exact generation, session, and model tuple [seed=0x21]", async () => {
    const Bridge = requireBridge();
    const bridge = new Bridge();
    const model = modelFor(0x21);
    const calls: Array<{
      method: ProviderMethod;
      options: RequestOptions | undefined;
    }> = [];
    let originalTerminal: ReturnType<typeof terminalStream> | undefined;
    const delegate = providerFor(
      model,
      (method, requestModel, _requestContext, options) => {
        calls.push({ method, options });
        originalTerminal = terminalStream(requestModel, "done");
        return originalTerminal.stream;
      },
    );
    let callbackCalls = 0;
    const parentCallback: PayloadCallback = async () => {
      callbackCalls++;
      return undefined;
    };

    bridge.beginSession("session-exact");
    const wrapped = bridge.wrapProvider(delegate);
    const options = {
      onPayload: parentCallback,
      requestMarker: "forward-unchanged",
    };
    expect(bridge.capture(modelKey(model))).toBeUndefined();

    const output = invoke(wrapped, "stream", model, options);
    expect(bridge.capture(modelKey(model))).toBeUndefined();
    const events = await collect(output);
    const result = await output.result();
    await settleCapture();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ method: "stream", options });
    expect(callbackCalls).toBe(0);
    expect(events).toHaveLength(1);
    expect(events[0]).toBe(originalTerminal?.event);
    expect(result).toBe(originalTerminal?.result);

    const capture = bridge.capture(modelKey(model));
    expect(capture).toBeDefined();
    expect(capture).toMatchObject({
      sessionId: "session-exact",
      modelKey: modelKey(model),
      delegate,
      onPayload: parentCallback,
    });
    expect(Object.isFrozen(capture)).toBe(true);

    const mismatches: ParentModelKey[] = [
      { ...modelKey(model), provider: `${model.provider}-other` },
      { ...modelKey(model), id: `${model.id}-other` },
      { ...modelKey(model), api: `${model.api}-other` },
      { ...modelKey(model), baseUrl: `${model.baseUrl}/other` },
    ];
    for (const mismatch of mismatches) {
      expect(bridge.capture(mismatch)).toBeUndefined();
    }

    const firstGeneration = capture!.generation;
    bridge.beginSession("session-exact");
    expect(bridge.capture(modelKey(model))).toBeUndefined();
    const secondCallback: PayloadCallback = () => undefined;
    const second = await armCapture(
      bridge,
      bridge.wrapProvider(delegate),
      model,
      secondCallback,
      "streamSimple",
    );
    expect(second.capture.generation).toBeGreaterThan(firstGeneration);
    expect(second.capture.sessionId).toBe("session-exact");
    expect(second.capture.onPayload).toBe(secondCallback);

    bridge.clear();
    expect(bridge.capture(modelKey(model))).toBeUndefined();
  });

  it("recursively unwraps package wrappers but never a foreign wrapper [seed=0x2b]", async () => {
    const Bridge = requireBridge();
    const model = modelFor(0x2b);
    let baseCalls = 0;
    const base = providerFor(model, (_method, requestModel) => {
      baseCalls++;
      return terminalStream(requestModel, "done").stream;
    }) as Provider & { futureCapability: unknown };
    const firstCapability = { version: 1 };
    const currentCapability = { version: 2 };
    base.futureCapability = firstCapability;

    const packageBridge = new Bridge();
    packageBridge.beginSession("session-package-recursion");
    let current: Provider = base;
    const registrations: Provider[] = [];
    const registry: ProviderRegistry = {
      getProvider: (id) => (id === model.provider ? current : undefined),
      registerProvider: (provider) => {
        current = provider;
        registrations.push(provider);
      },
    };

    packageBridge.install(model, registry);
    const firstWrapper = current;
    packageBridge.install(model, registry);
    const secondWrapper = current;
    base.futureCapability = currentCapability;

    expect(registrations).toHaveLength(2);
    expect(registrations.map((provider) => provider.id)).toEqual([
      base.id,
      base.id,
    ]);
    expect(firstWrapper).not.toBe(base);
    expect(secondWrapper).not.toBe(firstWrapper);
    expect(
      (secondWrapper as Provider & { futureCapability: unknown })
        .futureCapability,
    ).toBe(currentCapability);

    const packageCallback: PayloadCallback = () => undefined;
    await collect(
      invoke(secondWrapper, "stream", model, {
        onPayload: packageCallback,
      }),
    );
    await settleCapture();
    expect(baseCalls).toBe(1);
    expect(packageBridge.capture(modelKey(model))?.delegate).toBe(base);

    let foreignCalls = 0;
    const foreign = providerFor(
      model,
      (method, requestModel, requestContext, options) => {
        foreignCalls++;
        return method === "stream"
          ? base.stream(requestModel, requestContext, options as never)
          : base.streamSimple(requestModel, requestContext, options as never);
      },
    );
    const foreignBridge = new Bridge();
    foreignBridge.beginSession("session-foreign-wrapper");
    let foreignCurrent = foreign;
    const foreignRegistry: ProviderRegistry = {
      getProvider: () => foreignCurrent,
      registerProvider: (provider) => {
        foreignCurrent = provider;
      },
    };
    foreignBridge.install(model, foreignRegistry);
    await collect(
      invoke(foreignCurrent, "streamSimple", model, {
        onPayload: () => undefined,
      }),
    );
    await settleCapture();

    expect(foreignCalls).toBe(1);
    expect(baseCalls).toBe(2);
    expect(foreignBridge.capture(modelKey(model))?.delegate).toBe(foreign);
  });

  it("preserves private-field receivers for class Provider capabilities", () => {
    const Bridge = requireBridge();
    const model = modelFor(0x30);
    class PrivateProvider {
      readonly name = "Private field Provider";
      #capability = "preserved";
      #model: Model<string>;

      constructor(value: Model<string>) {
        this.#model = value;
      }

      get id(): string {
        return this.#model.provider;
      }

      get baseUrl(): string {
        return this.#model.baseUrl;
      }

      getModels(): Model<string>[] {
        return [this.#model];
      }

      privateCapability(): string {
        return this.#capability;
      }
    }
    const delegate = new PrivateProvider(model) as unknown as Provider;
    const wrapped = new Bridge().wrapProvider(delegate);
    const capability = (wrapped as unknown as { privateCapability(): string })
      .privateCapability;

    expect(wrapped.id).toBe(model.provider);
    expect(wrapped.baseUrl).toBe(model.baseUrl);
    expect(wrapped.getModels()).toEqual([model]);
    expect(capability()).toBe("preserved");
    expect(wrapped.getModels).toBe(wrapped.getModels);
  });

  it("captures only successful completion and delegates only to the matching method once [table=0x31]", async () => {
    const Bridge = requireBridge();
    const methods: ProviderMethod[] = ["stream", "streamSimple"];
    const outcomes: Array<StreamOutcome | "throw"> = [
      "done",
      "error",
      "aborted",
      "incomplete",
      "throw",
    ];

    for (const [methodIndex, method] of methods.entries()) {
      for (const [outcomeIndex, outcome] of outcomes.entries()) {
        const seed = 0x31 + methodIndex * 16 + outcomeIndex;
        const bridge = new Bridge();
        const model = modelFor(seed);
        const calls: ProviderMethod[] = [];
        let terminal: ReturnType<typeof terminalStream> | undefined;
        const delegate = providerFor(model, (called, requestModel) => {
          calls.push(called);
          if (outcome === "throw") {
            throw new Error(`delegate-${method}-${outcome}`);
          }
          terminal = terminalStream(requestModel, outcome);
          return terminal.stream;
        });
        let callbackCalls = 0;
        const parentCallback: PayloadCallback = () => {
          callbackCalls++;
          return undefined;
        };
        bridge.beginSession(`session-${seed}`);
        const wrapped = bridge.wrapProvider(delegate);

        if (outcome === "throw") {
          expect(() =>
            invoke(wrapped, method, model, { onPayload: parentCallback }),
          ).toThrow(`delegate-${method}-${outcome}`);
          expect(calls).toEqual([method]);
          expect(bridge.capture(modelKey(model))).toBeUndefined();
          continue;
        }

        const output = invoke(wrapped, method, model, {
          onPayload: parentCallback,
        });
        if (outcome === "incomplete") {
          await settleCapture();
        } else {
          const forwarded = await collect(output);
          const result = await output.result();
          expect(forwarded).toEqual([terminal?.event]);
          expect(result).toBe(terminal?.result);
        }
        await settleCapture();

        expect(calls).toEqual([method]);
        expect(callbackCalls).toBe(0);
        if (outcome === "done") {
          expect(bridge.capture(modelKey(model))).toMatchObject({
            delegate,
            onPayload: parentCallback,
          });
        } else {
          expect(bridge.capture(modelKey(model))).toBeUndefined();
        }
      }
    }
  });

  it("terminates with a sanitized error when provider iteration rejects", async () => {
    const Bridge = requireBridge();
    for (const [index, method] of (
      ["stream", "streamSimple"] as const
    ).entries()) {
      const bridge = new Bridge();
      const model = modelFor(0x3d + index);
      const delegate = providerFor(model, () => {
        const source = createAssistantMessageEventStream();
        source[Symbol.asyncIterator] = () => ({
          async next() {
            await Promise.resolve();
            throw new Error("sensitive-provider-stream-detail");
          },
        });
        return source;
      });
      bridge.beginSession(`session-async-rejection-${index}`);
      const output = invoke(bridge.wrapProvider(delegate), method, model, {
        onPayload: () => undefined,
      });

      const settled = await Promise.race([
        Promise.all([collect(output), output.result()]).then(
          ([events, result]) => ({
            status: "settled" as const,
            events,
            result,
          }),
        ),
        new Promise<{ status: "pending" }>((resolve) =>
          setTimeout(() => resolve({ status: "pending" }), 50),
        ),
      ]);

      expect(settled.status).toBe("settled");
      if (settled.status !== "settled") continue;
      expect(settled.events).toHaveLength(1);
      expect(settled.events[0]).toMatchObject({
        type: "error",
        reason: "error",
        error: {
          api: model.api,
          provider: model.provider,
          model: model.id,
          stopReason: "error",
          errorMessage: "parent provider stream failed",
        },
      });
      expect(settled.result).toBe(
        (settled.events[0] as Extract<AssistantMessageEvent, { type: "error" }>)
          .error,
      );
      expect(JSON.stringify(settled)).not.toContain(
        "sensitive-provider-stream-detail",
      );
      expect(bridge.capture(modelKey(model))).toBeUndefined();
    }
  });

  it("runs child then parent then safe-object checks then Responses deletion without mutation [seed=0x47]", async () => {
    const Bridge = requireBridge();
    const trace: string[] = [];
    const nested = Object.freeze({ stable: true });
    let parentInput: Record<string, unknown> | undefined;
    let parentOutput: Readonly<Record<string, unknown>> | undefined;
    const parentCallback: PayloadCallback = (payload, requestModel) => {
      trace.push(`parent:${requestModel.id}`);
      parentInput = payload as Record<string, unknown>;
      parentOutput = Object.freeze({
        ...parentInput,
        parent: true,
        max_output_tokens: 8_192,
      });
      return parentOutput;
    };
    const fixture = await readyFixture(
      Bridge,
      0x47,
      parentCallback,
      "openai-responses",
    );
    const input = Object.freeze({
      seed: 0x47,
      nested,
      max_output_tokens: 2_048,
    });
    let childOutput: Readonly<Record<string, unknown>> | undefined;
    const childCallback: PayloadCallback = (payload, requestModel) => {
      trace.push(`child:${requestModel.id}`);
      childOutput = Object.freeze({
        ...(payload as Record<string, unknown>),
        child: true,
        max_output_tokens: 4_096,
      });
      return childOutput;
    };

    const final = await fixture.bridge.composePayload(
      fixture.capture,
      input,
      fixture.model,
      childCallback,
    );

    expect(trace).toEqual([
      `child:${fixture.model.id}`,
      `parent:${fixture.model.id}`,
    ]);
    expect(parentInput).toBe(childOutput);
    expect(final).toEqual({
      seed: 0x47,
      nested,
      child: true,
      parent: true,
    });
    expect(final).not.toBe(parentOutput);
    expect(input.max_output_tokens).toBe(2_048);
    expect(childOutput?.max_output_tokens).toBe(4_096);
    expect(parentOutput?.max_output_tokens).toBe(8_192);
    expect(final.nested).toBe(nested);
    expect(fixture.delegateCalls).toBe(1);
  });

  it("treats undefined callback results as identity without cloning non-Responses payloads [table=0x53]", async () => {
    const Bridge = requireBridge();
    const cases = [
      { child: "identity", parent: "identity" },
      { child: "replace", parent: "identity" },
      { child: "identity", parent: "replace" },
      { child: "replace", parent: "replace" },
    ] as const;

    for (const [index, scenario] of cases.entries()) {
      const seed = 0x53 + index;
      const input = { seed, source: "input" };
      const childReplacement = { seed, source: "child" };
      const parentReplacement = { seed, source: "parent" };
      let parentSeen: unknown;
      let childCalls = 0;
      let parentCalls = 0;
      const fixture = await readyFixture(Bridge, seed, (payload) => {
        parentCalls++;
        parentSeen = payload;
        return scenario.parent === "identity" ? undefined : parentReplacement;
      });
      const child: PayloadCallback = () => {
        childCalls++;
        return scenario.child === "identity" ? undefined : childReplacement;
      };

      const final = await fixture.bridge.composePayload(
        fixture.capture,
        input,
        fixture.model,
        child,
      );
      const afterChild =
        scenario.child === "identity" ? input : childReplacement;
      const expected =
        scenario.parent === "identity" ? afterChild : parentReplacement;

      expect(final, JSON.stringify(scenario)).toBe(expected);
      expect(parentSeen, JSON.stringify(scenario)).toBe(afterChild);
      expect(childCalls).toBe(1);
      expect(parentCalls).toBe(1);
      expect(input).toEqual({ seed, source: "input" });
    }
  });

  it("fails closed for missing, mismatched, stale, rejected, and unsafe payload paths [table=0x61]", async () => {
    const Bridge = requireBridge();
    const scenarios: Array<{
      label: string;
      missing?: boolean;
      stale?: boolean;
      wrongModel?: boolean;
      payload?: unknown;
      child: () => unknown | Promise<unknown>;
      parent: () => unknown | Promise<unknown>;
      childCalls: number;
      parentCalls: number;
    }> = [
      {
        label: "missing capture",
        missing: true,
        child: () => undefined,
        parent: () => undefined,
        childCalls: 0,
        parentCalls: 0,
      },
      {
        label: "stale generation",
        stale: true,
        child: () => undefined,
        parent: () => undefined,
        childCalls: 0,
        parentCalls: 0,
      },
      {
        label: "mismatched model",
        wrongModel: true,
        child: () => undefined,
        parent: () => undefined,
        childCalls: 0,
        parentCalls: 0,
      },
      {
        label: "child rejection",
        child: async () => {
          throw new Error("child rejected");
        },
        parent: () => undefined,
        childCalls: 1,
        parentCalls: 0,
      },
      {
        label: "unsafe original",
        payload: null,
        child: () => undefined,
        parent: () => undefined,
        childCalls: 1,
        parentCalls: 0,
      },
      {
        label: "unsafe child null",
        child: () => null,
        parent: () => undefined,
        childCalls: 1,
        parentCalls: 0,
      },
      {
        label: "unsafe child array",
        child: () => [],
        parent: () => undefined,
        childCalls: 1,
        parentCalls: 0,
      },
      {
        label: "unsafe child primitive",
        child: () => "unsafe",
        parent: () => undefined,
        childCalls: 1,
        parentCalls: 0,
      },
      {
        label: "parent rejection",
        child: () => undefined,
        parent: async () => {
          throw new Error("parent rejected");
        },
        childCalls: 1,
        parentCalls: 1,
      },
      {
        label: "unsafe parent array",
        child: () => undefined,
        parent: () => [1, 2, 3],
        childCalls: 1,
        parentCalls: 1,
      },
      {
        label: "unsafe parent primitive",
        child: () => undefined,
        parent: () => 42,
        childCalls: 1,
        parentCalls: 1,
      },
    ];

    for (const [index, scenario] of scenarios.entries()) {
      const seed = 0x61 + index;
      let childCalls = 0;
      let parentCalls = 0;
      const parentCallback: PayloadCallback = async () => {
        parentCalls++;
        return scenario.parent();
      };
      let bridge: ParentPayloadBridge;
      let model: Model<string>;
      let capture: ParentPayloadCapture | undefined;

      if (scenario.missing) {
        bridge = new Bridge();
        model = modelFor(seed);
        bridge.beginSession(`session-${seed}`);
        capture = undefined;
      } else {
        const fixture = await readyFixture(Bridge, seed, parentCallback);
        bridge = fixture.bridge;
        model = fixture.model;
        capture = fixture.capture;
      }
      if (scenario.stale) bridge.beginSession(`replacement-${seed}`);
      if (scenario.wrongModel) {
        model = { ...model, id: `${model.id}-replacement` };
      }
      const childCallback: PayloadCallback = async () => {
        childCalls++;
        return scenario.child();
      };
      let sends = 0;
      const payload =
        "payload" in scenario ? scenario.payload : { seed, safe: true };
      const attempt = async () => {
        const transformed = await bridge.composePayload(
          capture,
          payload,
          model,
          childCallback,
        );
        sends++;
        return transformed;
      };

      await expect(attempt(), scenario.label).rejects.toBeDefined();
      expect(sends, scenario.label).toBe(0);
      expect(childCalls, scenario.label).toBe(scenario.childCalls);
      expect(parentCalls, scenario.label).toBe(scenario.parentCalls);
    }
  });

  it("preserves optional output caps for every non-Responses API [table=0x79]", async () => {
    const Bridge = requireBridge();
    const apis = [
      "openai-completions",
      "azure-openai-responses",
      "anthropic-messages",
      "faux",
    ];

    for (const [index, api] of apis.entries()) {
      const seed = 0x79 + index;
      const parentOutput = {
        seed,
        api,
        max_output_tokens: 9_000 + index,
        providerField: true,
      };
      const fixture = await readyFixture(Bridge, seed, () => parentOutput, api);

      const final = await fixture.bridge.composePayload(
        fixture.capture,
        { seed, max_output_tokens: 1_000 },
        fixture.model,
        () => undefined,
      );

      expect(final).toBe(parentOutput);
      expect(final.max_output_tokens).toBe(9_000 + index);
      expect(final.providerField).toBe(true);
    }
  });

  it("serializes concurrent parent callback entry through one generation-local FIFO [seed=0x83]", async () => {
    const Bridge = requireBridge();
    const gate = deferred();
    const entered: number[] = [];
    const finished: number[] = [];
    const childOrder: number[] = [];
    let active = 0;
    let maximumActive = 0;
    const fixture = await readyFixture(Bridge, 0x83, async (payload) => {
      const id = (payload as { id: number }).id;
      entered.push(id);
      active++;
      maximumActive = Math.max(maximumActive, active);
      try {
        if (id === 1) await gate.promise;
        await Promise.resolve();
        return { ...(payload as Record<string, unknown>), inherited: id };
      } finally {
        active--;
        finished.push(id);
      }
    });
    const child: PayloadCallback = (payload) => {
      const id = (payload as { id: number }).id;
      childOrder.push(id);
      return { ...(payload as Record<string, unknown>), child: id };
    };

    const first = fixture.bridge.composePayload(
      fixture.capture,
      { id: 1 },
      fixture.model,
      child,
    );
    await waitFor(() => entered.length === 1, "first FIFO entry");
    const second = fixture.bridge.composePayload(
      fixture.capture,
      { id: 2 },
      fixture.model,
      child,
    );
    const third = fixture.bridge.composePayload(
      fixture.capture,
      { id: 3 },
      fixture.model,
      child,
    );
    await waitFor(() => childOrder.length === 3, "three child callbacks");

    expect(childOrder).toEqual([1, 2, 3]);
    expect(entered).toEqual([1]);
    expect(maximumActive).toBe(1);
    gate.resolve();
    const results = await Promise.all([first, second, third]);

    expect(entered).toEqual([1, 2, 3]);
    expect(finished).toEqual([1, 2, 3]);
    expect(maximumActive).toBe(1);
    expect(results.map((result) => result.inherited)).toEqual([1, 2, 3]);
  });

  it("checks cancellation before child entry, while queued, and again before send [table=0x97]", async () => {
    const Bridge = requireBridge();

    let earlyChildCalls = 0;
    let earlyParentCalls = 0;
    const early = await readyFixture(Bridge, 0x97, () => {
      earlyParentCalls++;
      return undefined;
    });
    const earlyController = new AbortController();
    const earlyReason = new Error("cancelled before entry");
    earlyController.abort(earlyReason);
    await expect(
      early.bridge.composePayload(
        early.capture,
        { id: "early" },
        early.model,
        () => {
          earlyChildCalls++;
          return undefined;
        },
        earlyController.signal,
      ),
    ).rejects.toBe(earlyReason);
    expect(earlyChildCalls).toBe(0);
    expect(earlyParentCalls).toBe(0);

    const queueGate = deferred();
    const queuedParentIds: number[] = [];
    let queuedChildCalls = 0;
    const queued = await readyFixture(Bridge, 0x98, async (payload) => {
      const id = (payload as { id: number }).id;
      queuedParentIds.push(id);
      if (id === 1) await queueGate.promise;
      return payload;
    });
    const first = queued.bridge.composePayload(
      queued.capture,
      { id: 1 },
      queued.model,
    );
    await waitFor(
      () => queuedParentIds.length === 1,
      "blocking parent callback",
    );
    const queuedController = new AbortController();
    const queuedReason = new Error("cancelled while queued");
    const second = queued.bridge.composePayload(
      queued.capture,
      { id: 2 },
      queued.model,
      (payload) => {
        queuedChildCalls++;
        return payload;
      },
      queuedController.signal,
    );
    const secondObserved = second.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    await waitFor(() => queuedChildCalls === 1, "queued child callback");
    queuedController.abort(queuedReason);
    queueGate.resolve();
    await first;
    const queuedResult = await secondObserved;

    expect(queuedResult).toEqual({ ok: false, error: queuedReason });
    expect(queuedParentIds).toEqual([1]);

    const beforeSendController = new AbortController();
    const beforeSendReason = new Error("cancelled before send");
    let beforeSendParentCalls = 0;
    const beforeSend = await readyFixture(Bridge, 0x99, (payload) => {
      beforeSendParentCalls++;
      beforeSendController.abort(beforeSendReason);
      return payload;
    });
    await expect(
      beforeSend.bridge.composePayload(
        beforeSend.capture,
        { id: "before-send" },
        beforeSend.model,
        undefined,
        beforeSendController.signal,
      ),
    ).rejects.toBe(beforeSendReason);
    expect(beforeSendParentCalls).toBe(1);
  });

  it("settles cancellation without waiting for queued, child, or parent callbacks", async () => {
    const Bridge = requireBridge();
    const promptly = async (promise: Promise<unknown>) =>
      Promise.race([
        promise.then(
          () => ({ status: "fulfilled" as const }),
          (reason: unknown) => ({ status: "rejected" as const, reason }),
        ),
        new Promise<{ status: "pending" }>((resolve) =>
          setTimeout(() => resolve({ status: "pending" }), 50),
        ),
      ]);

    const childGate = deferred();
    const childFixture = await readyFixture(Bridge, 0x9a, () => undefined);
    const childController = new AbortController();
    const childReason = new Error("cancel hanging child callback");
    const child = childFixture.bridge.composePayload(
      childFixture.capture,
      { id: "child" },
      childFixture.model,
      async () => {
        await childGate.promise;
        return undefined;
      },
      childController.signal,
    );
    childController.abort(childReason);
    expect(await promptly(child)).toEqual({
      status: "rejected",
      reason: childReason,
    });
    childGate.resolve();

    const queueGate = deferred();
    const queueEntries: number[] = [];
    const queueFixture = await readyFixture(Bridge, 0x9b, async (payload) => {
      const id = (payload as { id: number }).id;
      queueEntries.push(id);
      if (id === 1) await queueGate.promise;
      return payload;
    });
    const active = queueFixture.bridge.composePayload(
      queueFixture.capture,
      { id: 1 },
      queueFixture.model,
    );
    await waitFor(() => queueEntries.length === 1, "active queue callback");
    const queueController = new AbortController();
    const queueReason = new Error("cancel behind hanging predecessor");
    const queued = queueFixture.bridge.composePayload(
      queueFixture.capture,
      { id: 2 },
      queueFixture.model,
      undefined,
      queueController.signal,
    );
    queueController.abort(queueReason);
    expect(await promptly(queued)).toEqual({
      status: "rejected",
      reason: queueReason,
    });
    expect(queueEntries).toEqual([1]);
    queueGate.resolve();
    await active;

    const parentGate = deferred();
    let parentEntered = false;
    const parentFixture = await readyFixture(Bridge, 0x9c, async () => {
      parentEntered = true;
      await parentGate.promise;
      return undefined;
    });
    const parentController = new AbortController();
    const parentReason = new Error("cancel hanging parent callback");
    const parent = parentFixture.bridge.composePayload(
      parentFixture.capture,
      { id: "parent" },
      parentFixture.model,
      undefined,
      parentController.signal,
    );
    await waitFor(() => parentEntered, "hanging parent callback");
    parentController.abort(parentReason);
    expect(await promptly(parent)).toEqual({
      status: "rejected",
      reason: parentReason,
    });
    parentGate.resolve();
  });

  it("keeps the FIFO occupied until a cancelled parent callback actually settles", async () => {
    const Bridge = requireBridge();
    const firstGate = deferred();
    const entered: number[] = [];
    let active = 0;
    let maximumActive = 0;
    const fixture = await readyFixture(Bridge, 0x9d, async (payload) => {
      const id = (payload as { id: number }).id;
      entered.push(id);
      active++;
      maximumActive = Math.max(maximumActive, active);
      try {
        if (id === 1) await firstGate.promise;
        return payload;
      } finally {
        active--;
      }
    });
    const controller = new AbortController();
    const reason = new Error("cancel active parent callback");
    const first = fixture.bridge.composePayload(
      fixture.capture,
      { id: 1 },
      fixture.model,
      undefined,
      controller.signal,
    );
    await waitFor(() => entered.length === 1, "first parent callback");
    controller.abort(reason);
    await expect(first).rejects.toBe(reason);

    const second = fixture.bridge.composePayload(
      fixture.capture,
      { id: 2 },
      fixture.model,
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(entered).toEqual([1]);
    expect(maximumActive).toBe(1);

    firstGate.resolve();
    await second;
    expect(entered).toEqual([1, 2]);
    expect(maximumActive).toBe(1);
  });

  it("invalidates active and queued work when its generation changes [seed=0xa1]", async () => {
    const Bridge = requireBridge();
    const gate = deferred();
    const parentEntries: number[] = [];
    const fixture = await readyFixture(Bridge, 0xa1, async (payload) => {
      const id = (payload as { id: number }).id;
      parentEntries.push(id);
      if (id === 1) await gate.promise;
      return payload;
    });

    const active = fixture.bridge.composePayload(
      fixture.capture,
      { id: 1 },
      fixture.model,
    );
    await waitFor(() => parentEntries.length === 1, "active callback");
    const queued = fixture.bridge.composePayload(
      fixture.capture,
      { id: 2 },
      fixture.model,
    );
    const observed = Promise.allSettled([active, queued]);
    fixture.bridge.beginSession("session-replacement-a1");
    gate.resolve();
    const results = await observed;

    expect(results.map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    expect(parentEntries).toEqual([1]);
    expect(fixture.bridge.capture(modelKey(fixture.model))).toBeUndefined();
  });

  it("preserves the effective result when Pi hides an individual handler error [seed=0xb3]", async () => {
    const Bridge = requireBridge();
    let effectiveCalls = 0;
    let hiddenErrors = 0;
    const effectiveParentCallback: PayloadCallback = async (
      initial,
      requestModel,
    ) => {
      effectiveCalls++;
      let current = initial;
      const handlers: PayloadCallback[] = [
        (payload) => ({
          ...(payload as Record<string, unknown>),
          beforeHiddenError: requestModel.id,
        }),
        () => {
          throw new Error("Pi-internal handler failure");
        },
        (payload) => ({
          ...(payload as Record<string, unknown>),
          afterHiddenError: true,
        }),
      ];
      for (const handler of handlers) {
        try {
          const next = await handler(current, requestModel);
          if (next !== undefined) current = next;
        } catch {
          hiddenErrors++;
        }
      }
      return current;
    };
    const fixture = await readyFixture(
      Bridge,
      0xb3,
      effectiveParentCallback,
      "anthropic-messages",
    );
    const input = { seed: 0xb3, inherited: true };

    const final = await fixture.bridge.composePayload(
      fixture.capture,
      input,
      fixture.model,
      () => undefined,
    );

    expect(effectiveCalls).toBe(1);
    expect(hiddenErrors).toBe(1);
    expect(final).toEqual({
      seed: 0xb3,
      inherited: true,
      beforeHiddenError: fixture.model.id,
      afterHiddenError: true,
    });
  });
});
