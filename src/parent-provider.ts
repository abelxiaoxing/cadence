import {
  InMemoryCredentialStore,
  type Model,
  type Provider,
} from "@earendil-works/pi-ai";
import {
  type ExtensionContext,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type { ChildFailure } from "./contracts.ts";
import type {
  ParentPayloadBridge,
  ParentPayloadCallback,
  ParentPayloadCapture,
} from "./parent-payload-bridge.ts";

export interface PhasePayloadBridge {
  readonly bridge: ParentPayloadBridge;
  readonly capture: ParentPayloadCapture;
}

type PhaseRuntimeFailure = Extract<
  ChildFailure,
  { kind: "cancelled" | "environment" | "transport" }
>;

export type PhaseRuntimeResult =
  | { ok: true; modelRuntime: ModelRuntime; model: Model<string> }
  | { ok: false; error: string; failure: PhaseRuntimeFailure };

function phaseRuntimeFailure(
  failure: PhaseRuntimeFailure,
  error: string,
): Extract<PhaseRuntimeResult, { ok: false }> {
  return { ok: false, error, failure };
}

function cancelledPhaseRuntime(): Extract<PhaseRuntimeResult, { ok: false }> {
  return phaseRuntimeFailure(
    { kind: "cancelled", code: "cancelled" },
    "child phase cancelled",
  );
}

function isCancellation(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true && error === signal.reason;
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
): Promise<PhaseRuntimeResult> {
  if (signal?.aborted) return cancelledPhaseRuntime();
  if (!ctx.model) {
    return phaseRuntimeFailure(
      { kind: "environment", code: "sandbox-runtime-unavailable" },
      "parent model is unavailable",
    );
  }
  const selectedModel = ctx.model;
  const selectedModelKey = modelKeyFor(selectedModel);
  let resolved: Awaited<
    ReturnType<typeof ctx.modelRegistry.getApiKeyAndHeaders>
  >;
  try {
    resolved = await abortable(
      ctx.modelRegistry.getApiKeyAndHeaders(selectedModel),
      signal,
    );
  } catch (error) {
    if (isCancellation(error, signal)) return cancelledPhaseRuntime();
    throw error;
  }
  if (!resolved.ok) {
    return phaseRuntimeFailure(
      { kind: "environment", code: "sandbox-runtime-unavailable" },
      "phase authentication is unavailable",
    );
  }
  if (signal?.aborted) return cancelledPhaseRuntime();
  const model = {
    ...selectedModel,
    baseUrl: resolved.baseUrl ?? selectedModel.baseUrl,
  } as Model<string>;
  const effectiveModelKey = modelKeyFor(model);
  const capture = payloadBridge.capture(effectiveModelKey, ctx.modelRegistry);
  if (!capture) {
    return phaseRuntimeFailure(
      { kind: "transport", code: "transport-failure" },
      "parent payload bridge is unavailable",
    );
  }
  const captureIsReady = () => {
    const currentModel = ctx.model;
    return (
      currentModel !== undefined &&
      sameSelectedModel(currentModel, selectedModelKey) &&
      payloadBridge.capture(effectiveModelKey, ctx.modelRegistry) === capture
    );
  };
  if (!captureIsReady()) {
    return phaseRuntimeFailure(
      { kind: "transport", code: "transport-failure" },
      "parent payload bridge is unavailable",
    );
  }
  const delegate = capture.delegate;
  if (!delegate) throw new Error("parent Provider is unavailable");
  const provider = phaseProvider(delegate, resolved, {
    bridge: payloadBridge,
    capture,
  });
  let modelRuntime: ModelRuntime;
  try {
    modelRuntime = await runtimeForProvider(provider, signal);
  } catch (error) {
    if (isCancellation(error, signal)) return cancelledPhaseRuntime();
    throw error;
  }
  if (signal?.aborted) return cancelledPhaseRuntime();
  if (!captureIsReady()) {
    return phaseRuntimeFailure(
      { kind: "transport", code: "transport-failure" },
      "parent payload bridge is unavailable",
    );
  }
  return { ok: true, modelRuntime, model };
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
