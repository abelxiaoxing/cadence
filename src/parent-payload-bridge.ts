import {
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  createAssistantMessageEventStream,
  type Model,
  type Provider,
} from "@earendil-works/pi-ai";

export type ParentPayloadCallback = (
  payload: unknown,
  model: Model<string>,
) => unknown | undefined | Promise<unknown | undefined>;

export interface ParentModelKey {
  provider: string;
  id: string;
  api: string;
  baseUrl: string;
}

export interface ParentPayloadCapture {
  readonly generation: number;
  readonly sessionId: string;
  readonly modelKey: Readonly<ParentModelKey>;
  readonly delegate: Provider;
  readonly onPayload: ParentPayloadCallback;
}

export interface ParentProviderRegistry {
  getProvider(provider: string): Provider | undefined;
  registerProvider(provider: Provider): void;
}

interface GenerationState {
  readonly generation: number;
  readonly sessionId: string;
  active: boolean;
  readonly ready: Map<string, ParentPayloadCapture>;
  readonly installed: Map<string, Provider>;
  tail: Promise<void>;
}

interface ProvisionalCapture {
  readonly state: GenerationState;
  readonly modelKey: ParentModelKey;
  readonly delegate: Provider;
  readonly onPayload: ParentPayloadCallback;
}

const PROVIDER_WRAPPER = Symbol("cadence-parent-payload-provider");

function streamFailure(model: Model<string>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: "error",
    errorMessage: "parent provider stream failed",
    timestamp: Date.now(),
  };
}

function abortable<T>(
  value: T | PromiseLike<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return Promise.resolve(value);
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => {
      try {
        signal.throwIfAborted();
      } catch (error) {
        finish(() => reject(error));
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    Promise.resolve(value).then(
      (result) => finish(() => resolve(result)),
      (error) => finish(() => reject(error)),
    );
  });
}

function modelKeyFor(model: Model<string>): ParentModelKey {
  return {
    provider: model.provider,
    id: model.id,
    api: model.api,
    baseUrl: model.baseUrl,
  };
}

function modelKeyId(modelKey: Readonly<ParentModelKey>): string {
  return JSON.stringify([
    modelKey.provider,
    modelKey.id,
    modelKey.api,
    modelKey.baseUrl,
  ]);
}

function sameModelKey(
  left: Readonly<ParentModelKey>,
  right: Readonly<ParentModelKey>,
): boolean {
  return (
    left.provider === right.provider &&
    left.id === right.id &&
    left.api === right.api &&
    left.baseUrl === right.baseUrl
  );
}

function requireSafePayload(
  payload: unknown,
): asserts payload is Record<string, unknown> {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new Error("parent payload bridge produced an unsafe payload");
  }
}

export class ParentPayloadBridge {
  private nextGeneration = 0;
  private state: GenerationState | undefined;
  private readonly captureStates = new WeakMap<
    ParentPayloadCapture,
    GenerationState
  >();

  beginSession(sessionId: string): number {
    this.invalidate();
    const state: GenerationState = {
      generation: ++this.nextGeneration,
      sessionId,
      active: true,
      ready: new Map(),
      installed: new Map(),
      tail: Promise.resolve(),
    };
    this.state = state;
    return state.generation;
  }

  clear(): void {
    this.invalidate();
    this.nextGeneration++;
    this.state = undefined;
  }

  install(
    model: Model<string>,
    registry: ParentProviderRegistry,
  ): Provider | undefined {
    const current = registry.getProvider(model.provider);
    if (!current) return undefined;
    const delegate = this.unwrapProvider(current);
    const state = this.state;
    if (state?.active) {
      const key = modelKeyId(modelKeyFor(model));
      state.installed.set(key, delegate);
      const ready = state.ready.get(key);
      if (ready && ready.delegate !== delegate) {
        state.ready.delete(key);
      }
    }
    const wrapped = this.wrapProvider(delegate);
    registry.registerProvider(wrapped);
    return wrapped;
  }

  capture(
    modelKey: ParentModelKey,
    registry?: Pick<ParentProviderRegistry, "getProvider">,
  ): ParentPayloadCapture | undefined {
    const state = this.state;
    if (!state?.active) return undefined;
    const capture = state.ready.get(modelKeyId(modelKey));
    if (!capture || !sameModelKey(capture.modelKey, modelKey)) {
      return undefined;
    }
    if (registry) {
      const current = registry.getProvider(modelKey.provider);
      if (!current || this.unwrapProvider(current) !== capture.delegate) {
        return undefined;
      }
    }
    return capture;
  }

  wrapProvider(delegate: Provider): Provider {
    const original = this.unwrapProvider(delegate);
    const stream = (
      model: Model<string>,
      context: Context,
      options?: unknown,
    ) => this.forwardProvider(original, "stream", model, context, options);
    const streamSimple = (
      model: Model<string>,
      context: Context,
      options?: unknown,
    ) =>
      this.forwardProvider(original, "streamSimple", model, context, options);
    const boundMethods = new Map<
      PropertyKey,
      {
        source: (...args: never[]) => unknown;
        bound: (...args: never[]) => unknown;
      }
    >();

    return new Proxy(original, {
      get(target, property) {
        if (property === PROVIDER_WRAPPER) return original;
        if (property === "stream") return stream;
        if (property === "streamSimple") return streamSimple;
        const value = Reflect.get(target, property, target) as unknown;
        if (typeof value !== "function") return value;
        const current = boundMethods.get(property);
        if (current?.source === value) return current.bound;
        const source = value as (...args: never[]) => unknown;
        const bound = source.bind(target);
        boundMethods.set(property, { source, bound });
        return bound;
      },
      set(target, property, value) {
        return Reflect.set(target, property, value, target);
      },
    });
  }

  async composePayload(
    capture: ParentPayloadCapture | undefined,
    payload: unknown,
    model: Model<string>,
    childOnPayload?: ParentPayloadCallback,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (!capture) throw new Error("parent payload bridge is unavailable");
    const requestedKey = modelKeyFor(model);
    const state = this.requireCurrentCapture(capture, requestedKey);
    signal?.throwIfAborted();

    let current = payload;
    if (childOnPayload) {
      const childResult = await abortable(
        childOnPayload(current, model),
        signal,
      );
      if (childResult !== undefined) current = childResult;
    }
    requireSafePayload(current);
    signal?.throwIfAborted();
    this.requireCurrentCapture(capture, requestedKey);

    const predecessor = state.tail;
    let release = () => {};
    const completed = new Promise<void>((resolve) => {
      release = () => resolve();
    });
    state.tail = predecessor.then(
      () => completed,
      () => completed,
    );
    let parentSettlement: Promise<void> | undefined;

    try {
      await abortable(predecessor, signal);
      signal?.throwIfAborted();
      this.requireCurrentCapture(capture, requestedKey);

      const parentCall = Promise.resolve(capture.onPayload(current, model));
      parentSettlement = parentCall.then(
        () => undefined,
        () => undefined,
      );
      const parentResult = await abortable(parentCall, signal);
      if (parentResult !== undefined) current = parentResult;
      requireSafePayload(current);

      let finalPayload: Record<string, unknown> = current;
      if (model.api === "openai-responses") {
        finalPayload = { ...current };
        delete finalPayload.max_output_tokens;
      }

      signal?.throwIfAborted();
      this.requireCurrentCapture(capture, requestedKey);
      return finalPayload;
    } finally {
      if (parentSettlement) void parentSettlement.then(release);
      else release();
    }
  }

  private forwardProvider(
    delegate: Provider,
    method: "stream" | "streamSimple",
    model: Model<string>,
    context: Context,
    options?: unknown,
  ): AssistantMessageEventStream {
    const state = this.state;
    const candidate = (options as { onPayload?: unknown } | null | undefined)
      ?.onPayload;
    const onPayload =
      typeof candidate === "function"
        ? (candidate as ParentPayloadCallback)
        : undefined;
    const provisional: ProvisionalCapture | undefined =
      state?.active && onPayload
        ? {
            state,
            modelKey: modelKeyFor(model),
            delegate,
            onPayload,
          }
        : undefined;
    const source =
      method === "stream"
        ? delegate.stream(model, context, options as never)
        : delegate.streamSimple(model, context, options as never);
    const output = createAssistantMessageEventStream();
    void this.mirrorStream(source, output, model, provisional);
    return output;
  }

  private async mirrorStream(
    source: AssistantMessageEventStream,
    output: AssistantMessageEventStream,
    model: Model<string>,
    provisional: ProvisionalCapture | undefined,
  ): Promise<void> {
    let successful = false;
    try {
      for await (const event of source) {
        if (event.type === "done") successful = true;
        output.push(event);
      }
      if (successful && provisional) this.commitCapture(provisional);
    } catch {
      const error = streamFailure(model);
      output.push({ type: "error", reason: "error", error });
    } finally {
      output.end();
    }
  }

  private commitCapture(provisional: ProvisionalCapture): void {
    const { state } = provisional;
    if (!state.active || this.state !== state) return;
    const key = modelKeyId(provisional.modelKey);
    if (
      state.installed.has(key) &&
      state.installed.get(key) !== provisional.delegate
    ) {
      return;
    }
    const capture: ParentPayloadCapture = Object.freeze({
      generation: state.generation,
      sessionId: state.sessionId,
      modelKey: Object.freeze({ ...provisional.modelKey }),
      delegate: provisional.delegate,
      onPayload: provisional.onPayload,
    });
    state.ready.set(key, capture);
    this.captureStates.set(capture, state);
  }

  private requireCurrentCapture(
    capture: ParentPayloadCapture | undefined,
    modelKey: ParentModelKey,
  ): GenerationState {
    const state = this.state;
    if (
      !capture ||
      !state?.active ||
      this.captureStates.get(capture) !== state ||
      capture.generation !== state.generation ||
      capture.sessionId !== state.sessionId ||
      !sameModelKey(capture.modelKey, modelKey) ||
      state.ready.get(modelKeyId(modelKey)) !== capture
    ) {
      throw new Error("parent payload bridge is unavailable");
    }
    return state;
  }

  private unwrapProvider(provider: Provider): Provider {
    let current = provider;
    const seen = new Set<Provider>();
    while (!seen.has(current)) {
      seen.add(current);
      const candidate = Reflect.get(current, PROVIDER_WRAPPER) as unknown;
      if (
        typeof candidate !== "object" ||
        candidate === null ||
        seen.has(candidate as Provider)
      ) {
        return current;
      }
      current = candidate as Provider;
    }
    return current;
  }

  private invalidate(): void {
    if (!this.state) return;
    this.state.active = false;
    this.state.ready.clear();
    this.state.installed.clear();
  }
}
