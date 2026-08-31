import {
  InMemoryCredentialStore,
  type Model,
  type Provider,
  type StreamOptions,
} from "@earendil-works/pi-ai";
import {
  createProvider,
  stream as subagentStream,
  streamSimple as subagentStreamSimple,
} from "@earendil-works/pi-ai/compat";
import {
  type ExtensionContext,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type { ChildFailure } from "./contracts.ts";
import {
  type ParentPayloadBridge,
  ParentPayloadBridgeError,
  type ParentPayloadCallback,
  type ParentPayloadCapture,
} from "./parent-payload-bridge.ts";
import {
  type CustomRoutePolicy,
  type InheritedRoutePolicy,
  type ResolvedCustomRoute,
  resolveCustomRoute,
} from "./route-policy.ts";

const SUBAGENT_PROVIDER_ID = "abel-subagent";

export interface PhaseTransportObserver {
  onResponse?(): void;
}

function customStreamOptions<T extends StreamOptions>(
  model: Model<string>,
  options?: T,
): T | undefined {
  if (model.api !== "openai-responses") return options;
  const childOnPayload = options?.onPayload;
  return {
    ...options,
    onPayload: async (payload, requestModel) => {
      const transformed = await childOnPayload?.(payload, requestModel);
      const current = transformed === undefined ? payload : transformed;
      if (!current || typeof current !== "object" || Array.isArray(current))
        return current;
      const normalized = { ...current } as Record<string, unknown>;
      delete normalized.max_output_tokens;
      return normalized;
    },
  } as T;
}

function observedStreamOptions<T extends StreamOptions>(
  options?: T,
  observer?: PhaseTransportObserver,
): T | undefined {
  if (!observer?.onResponse) return options;
  const childOnResponse = options?.onResponse;
  return {
    ...options,
    onResponse: async (response, requestModel) => {
      observer.onResponse?.();
      await childOnResponse?.(response, requestModel);
    },
  } as T;
}

// The compat dispatchers resolve the concrete API implementation from
// model.api at call time, so one pair serves all supported dialects.
function subagentStreams(observer?: PhaseTransportObserver) {
  return {
    stream(
      model: Parameters<typeof subagentStream>[0],
      context: Parameters<typeof subagentStream>[1],
      options?: Parameters<typeof subagentStream>[2],
    ) {
      return subagentStream(
        model,
        context,
        observedStreamOptions(
          customStreamOptions(model as Model<string>, options),
          observer,
        ),
      );
    },
    streamSimple(
      model: Parameters<typeof subagentStreamSimple>[0],
      context: Parameters<typeof subagentStreamSimple>[1],
      options?: Parameters<typeof subagentStreamSimple>[2],
    ) {
      return subagentStreamSimple(
        model,
        context,
        observedStreamOptions(
          customStreamOptions(model as Model<string>, options),
          observer,
        ),
      );
    },
  };
}

function customSubagentModel(endpoint: ResolvedCustomRoute): Model<string> {
  return {
    id: endpoint.model,
    name: endpoint.model,
    api: endpoint.dialect,
    provider: SUBAGENT_PROVIDER_ID,
    baseUrl: endpoint.url,
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    contextWindow: endpoint.contextWindow,
    maxTokens: endpoint.maxTokens,
    ...(endpoint.dialect === "openai-completions"
      ? { compat: { supportsDeveloperRole: false } }
      : {}),
  } as Model<string>;
}

function customSubagentProvider(
  endpoint: ResolvedCustomRoute,
  model: Model<string>,
  observer?: PhaseTransportObserver,
): Provider {
  return createProvider({
    id: SUBAGENT_PROVIDER_ID,
    name: "Abel Subagent Endpoint",
    baseUrl: endpoint.url,
    auth: {
      apiKey: {
        name: "Abel subagent endpoint auth",
        resolve: async () =>
          endpoint.apiKey
            ? { auth: { apiKey: endpoint.apiKey }, source: "subagent-endpoint" }
            : {
                auth: {
                  apiKey: "unused",
                  headers: { authorization: null, "x-api-key": null },
                },
                source: "subagent-endpoint-keyless",
              },
      },
    },
    models: [model],
    api: subagentStreams(observer),
  }) as Provider;
}

export async function customPhaseRuntime(
  route: CustomRoutePolicy,
  signal?: AbortSignal,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  observer?: PhaseTransportObserver,
): Promise<PhaseRuntimeResult> {
  if (signal?.aborted) return cancelledPhaseRuntime();
  const endpoint = resolveCustomRoute(route, environment);
  const model = customSubagentModel(endpoint);
  const provider = customSubagentProvider(endpoint, model, observer);
  let modelRuntime: ModelRuntime;
  try {
    modelRuntime = await runtimeForProvider(provider, signal);
  } catch (error) {
    if (isCancellation(error, signal)) return cancelledPhaseRuntime();
    throw error;
  }
  if (signal?.aborted) return cancelledPhaseRuntime();
  return { ok: true, modelRuntime, model };
}

export interface PhasePayloadBridge {
  readonly bridge: ParentPayloadBridge;
  readonly capture: ParentPayloadCapture;
}

type PhaseRuntimeFailure = Extract<
  ChildFailure,
  { kind: "cancelled" | "environment" | "transport" }
>;

export type PhaseRuntimeResult =
  | {
      ok: true;
      modelRuntime: ModelRuntime;
      model: Model<string>;
      failureOverride?: () => PhaseRuntimeFailure | undefined;
    }
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
  diagnostic?: { failure?: PhaseRuntimeFailure },
): ParentPayloadCallback {
  return async (payload, model) => {
    try {
      return await payloadBridge.bridge.composePayload(
        payloadBridge.capture,
        payload,
        model,
        childOnPayload,
        signal,
      );
    } catch (error) {
      if (error instanceof ParentPayloadBridgeError && diagnostic) {
        diagnostic.failure = {
          kind: "environment",
          code: error.code,
          stage: "child-provider-stream",
        };
      }
      throw error;
    }
  };
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
  diagnostic?: { failure?: PhaseRuntimeFailure },
  observer?: PhaseTransportObserver,
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
        diagnostic,
      );
      return parent.stream(model, context, {
        ...observedStreamOptions(options, observer),
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
        diagnostic,
      );
      return parent.streamSimple(model, context, {
        ...observedStreamOptions(options, observer),
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
  observer?: PhaseTransportObserver,
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
    const code =
      payloadBridge.diagnoseCapture(effectiveModelKey, ctx.modelRegistry) ??
      "parent-bridge-capture-not-ready";
    return phaseRuntimeFailure(
      { kind: "environment", code, stage: "phase-runtime" },
      code,
    );
  }
  const captureFailure = () => {
    const currentModel = ctx.model;
    if (
      currentModel === undefined ||
      !sameSelectedModel(currentModel, selectedModelKey)
    ) {
      return "parent-bridge-model-key-mismatch" as const;
    }
    if (
      payloadBridge.capture(effectiveModelKey, ctx.modelRegistry) === capture
    ) {
      return undefined;
    }
    return (
      payloadBridge.diagnoseCapture(effectiveModelKey, ctx.modelRegistry) ??
      "parent-bridge-capture-not-ready"
    );
  };
  const initialCaptureFailure = captureFailure();
  if (initialCaptureFailure) {
    return phaseRuntimeFailure(
      {
        kind: "environment",
        code: initialCaptureFailure,
        stage: "phase-runtime",
      },
      initialCaptureFailure,
    );
  }
  const delegate = capture.delegate;
  if (!delegate) throw new Error("parent Provider is unavailable");
  const diagnostic: { failure?: PhaseRuntimeFailure } = {};
  const provider = phaseProvider(
    delegate,
    resolved,
    {
      bridge: payloadBridge,
      capture,
    },
    diagnostic,
    observer,
  );
  let modelRuntime: ModelRuntime;
  try {
    modelRuntime = await runtimeForProvider(provider, signal);
  } catch (error) {
    if (isCancellation(error, signal)) return cancelledPhaseRuntime();
    throw error;
  }
  if (signal?.aborted) return cancelledPhaseRuntime();
  const finalCaptureFailure = captureFailure();
  if (finalCaptureFailure) {
    return phaseRuntimeFailure(
      {
        kind: "environment",
        code: finalCaptureFailure,
        stage: "phase-runtime",
      },
      finalCaptureFailure,
    );
  }
  return {
    ok: true,
    modelRuntime,
    model,
    failureOverride: () => diagnostic.failure,
  };
}

export async function runtimeForWorkerRoute(
  route: CustomRoutePolicy | InheritedRoutePolicy,
  ctx: Pick<ExtensionContext, "model" | "modelRegistry">,
  payloadBridge: ParentPayloadBridge,
  signal?: AbortSignal,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  observer?: PhaseTransportObserver,
): Promise<PhaseRuntimeResult> {
  return route.kind === "custom"
    ? customPhaseRuntime(route, signal, environment, observer)
    : runtimeFromContext(ctx, payloadBridge, signal, observer);
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
