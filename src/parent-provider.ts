import {
  InMemoryCredentialStore,
  type Model,
  type Provider,
} from "@earendil-works/pi-ai";
import {
  type ExtensionContext,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type {
  ParentPayloadBridge,
  ParentPayloadCallback,
  ParentPayloadCapture,
} from "./parent-payload-bridge.ts";

export interface PhasePayloadBridge {
  readonly bridge: ParentPayloadBridge;
  readonly capture: ParentPayloadCapture;
}

function phasePayloadCallback(
  payloadBridge: PhasePayloadBridge,
  childOnPayload: ParentPayloadCallback | undefined,
  signal: AbortSignal | undefined,
): ParentPayloadCallback {
  return (payload, model) =>
    payloadBridge.bridge.composePayload(
      payloadBridge.capture,
      payload,
      model,
      childOnPayload,
      signal,
    );
}

export async function runtimeForProvider(
  provider: Provider,
  signal?: AbortSignal,
): Promise<ModelRuntime> {
  signal?.throwIfAborted();
  const runtime = await abortable(
    ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false,
      signal,
    }),
    signal,
  );
  signal?.throwIfAborted();
  runtime.registerNativeProvider(provider);
  return runtime;
}

export function phaseProvider(
  parent: Provider,
  auth: {
    apiKey?: string;
    headers?: Record<string, string | null>;
    baseUrl?: string;
    env?: Record<string, string>;
  },
  payloadBridge: PhasePayloadBridge,
): Provider {
  return {
    ...parent,
    baseUrl: auth.baseUrl ?? parent.baseUrl,
    headers: { ...parent.headers, ...auth.headers },
    auth: {
      apiKey: {
        name: "Abel phase-local parent auth",
        resolve: async () => ({
          auth: {
            apiKey: auth.apiKey,
            headers: auth.headers,
            baseUrl: auth.baseUrl,
          },
          env: auth.env,
        }),
      },
    },
    stream(model, context, options) {
      const onPayload = phasePayloadCallback(
        payloadBridge,
        options?.onPayload as ParentPayloadCallback | undefined,
        options?.signal,
      );
      return parent.stream(model, context, {
        ...options,
        apiKey: auth.apiKey,
        headers: { ...options?.headers, ...auth.headers },
        env: { ...options?.env, ...auth.env },
        maxRetries: 0,
        onPayload,
      } as never);
    },
    streamSimple(model, context, options) {
      const onPayload = phasePayloadCallback(
        payloadBridge,
        options?.onPayload as ParentPayloadCallback | undefined,
        options?.signal,
      );
      return parent.streamSimple(model, context, {
        ...options,
        apiKey: auth.apiKey,
        headers: { ...options?.headers, ...auth.headers },
        env: { ...options?.env, ...auth.env },
        maxRetries: 0,
        onPayload,
      });
    },
  };
}

function modelKeyFor(model: Model<string>) {
  return {
    provider: model.provider,
    id: model.id,
    api: model.api,
    baseUrl: model.baseUrl,
  };
}

function sameSelectedModel(
  left: Model<string>,
  right: ReturnType<typeof modelKeyFor>,
): boolean {
  return (
    left.provider === right.provider &&
    left.id === right.id &&
    left.api === right.api &&
    left.baseUrl === right.baseUrl
  );
}

export async function runtimeFromContext(
  ctx: Pick<ExtensionContext, "model" | "modelRegistry">,
  payloadBridge: ParentPayloadBridge,
  signal?: AbortSignal,
): Promise<{ modelRuntime: ModelRuntime; model: Model<string> }> {
  signal?.throwIfAborted();
  if (!ctx.model) throw new Error("parent model is unavailable");
  const selectedModel = ctx.model;
  const selectedModelKey = modelKeyFor(selectedModel);
  const resolved = await abortable(
    ctx.modelRegistry.getApiKeyAndHeaders(selectedModel),
    signal,
  );
  if (!resolved.ok) throw new Error(resolved.error);
  signal?.throwIfAborted();
  const model = {
    ...selectedModel,
    baseUrl: resolved.baseUrl ?? selectedModel.baseUrl,
  } as Model<string>;
  const effectiveModelKey = modelKeyFor(model);
  const capture = payloadBridge.capture(effectiveModelKey, ctx.modelRegistry);
  if (!capture) throw new Error("parent payload bridge is unavailable");
  const requireReadyCapture = () => {
    if (
      !ctx.model ||
      !sameSelectedModel(ctx.model, selectedModelKey) ||
      payloadBridge.capture(effectiveModelKey, ctx.modelRegistry) !== capture
    ) {
      throw new Error("parent payload bridge is unavailable");
    }
  };
  requireReadyCapture();
  const delegate = capture.delegate;
  if (!delegate) throw new Error("parent Provider is unavailable");
  const provider = phaseProvider(delegate, resolved, {
    bridge: payloadBridge,
    capture,
  });
  const modelRuntime = await runtimeForProvider(provider, signal);
  signal?.throwIfAborted();
  requireReadyCapture();
  return { modelRuntime, model };
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}
