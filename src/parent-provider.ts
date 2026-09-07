import {
  createModels,
  createProvider,
  InMemoryCredentialStore,
  lazyApi,
  type Model,
  type Models,
  type Provider,
  type StreamOptions,
} from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ChildFailure } from "./contracts.ts";
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

// Public API modules, selected explicitly by the closed route dialect. No
// global compat registry or provider-specific payload rewriting is involved.
const routeApis = {
  "openai-completions": lazyApi(
    () => import("@earendil-works/pi-ai/api/openai-completions"),
  ),
  "openai-responses": lazyApi(
    () => import("@earendil-works/pi-ai/api/openai-responses"),
  ),
  "anthropic-messages": lazyApi(
    () => import("@earendil-works/pi-ai/api/anthropic-messages"),
  ),
};

function subagentStreams(
  dialect: ResolvedCustomRoute["dialect"],
  observer?: PhaseTransportObserver,
) {
  const api = routeApis[dialect];
  return {
    stream: ((model, context, options) =>
      api.stream(
        model,
        context,
        observedStreamOptions({ ...options, maxRetries: 0 }, observer),
      )) as Provider["stream"],
    streamSimple: ((model, context, options) =>
      api.streamSimple(
        model,
        context,
        observedStreamOptions({ ...options, maxRetries: 0 }, observer),
      )) as Provider["streamSimple"],
  };
}

function modelsForProvider(provider: Provider, signal?: AbortSignal): Models {
  signal?.throwIfAborted();
  const models = createModels({ credentials: new InMemoryCredentialStore() });
  models.setProvider(provider);
  return models;
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
    api: subagentStreams(endpoint.dialect, observer),
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
  let modelRuntime: Models;
  try {
    modelRuntime = modelsForProvider(provider, signal);
  } catch (error) {
    if (isCancellation(error, signal)) return cancelledPhaseRuntime();
    throw error;
  }
  if (signal?.aborted) return cancelledPhaseRuntime();
  return { ok: true, modelRuntime, model };
}

type PhaseRuntimeFailure = Extract<
  ChildFailure,
  { kind: "cancelled" | "environment" | "transport" }
>;

export type PhaseRuntimeResult =
  | {
      ok: true;
      modelRuntime: Models;
      model: Model<string>;
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

export function phaseProvider(
  parent: Provider,
  auth: {
    apiKey?: string;
    headers?: Record<string, string | null>;
    baseUrl?: string;
    env?: Record<string, string>;
  },
  observer?: PhaseTransportObserver,
): Provider {
  auth = structuredClone(auth);
  return {
    id: parent.id,
    name: parent.name,
    getModels: () => parent.getModels(),
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
      return parent.stream(model, context, {
        ...observedStreamOptions(options, observer),
        apiKey: auth.apiKey,
        headers: { ...options?.headers, ...auth.headers },
        env: { ...options?.env, ...auth.env },
        maxRetries: 0,
      } as never);
    },
    streamSimple(model, context, options) {
      return parent.streamSimple(model, context, {
        ...observedStreamOptions(options, observer),
        apiKey: auth.apiKey,
        headers: { ...options?.headers, ...auth.headers },
        env: { ...options?.env, ...auth.env },
        maxRetries: 0,
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
  const selectedModel = structuredClone(ctx.model);
  const selectedModelKey = modelKeyFor(selectedModel);
  const admittedProvider = ctx.modelRegistry.getProvider(
    selectedModel.provider,
  );
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
  const delegate = ctx.modelRegistry.getProvider(model.provider);
  if (delegate !== admittedProvider)
    return phaseRuntimeFailure(
      {
        kind: "environment",
        code: "sandbox-runtime-unavailable",
        stage: "phase-runtime",
      },
      "parent Provider changed during authentication",
    );
  if (!delegate)
    return phaseRuntimeFailure(
      {
        kind: "environment",
        code: "sandbox-runtime-unavailable",
        stage: "phase-runtime",
      },
      "parent Provider is unavailable",
    );
  if (!ctx.model || !sameSelectedModel(ctx.model, selectedModelKey))
    return phaseRuntimeFailure(
      {
        kind: "environment",
        code: "sandbox-runtime-unavailable",
        stage: "phase-runtime",
      },
      "parent model changed during authentication",
    );
  // Snapshot effective Provider behavior and auth, never mutate its registry or
  // capture host-session callbacks. Explicit provider implementations still run.
  const provider = phaseProvider(delegate, resolved, observer);
  let modelRuntime: Models;
  try {
    modelRuntime = modelsForProvider(provider, signal);
  } catch (error) {
    if (isCancellation(error, signal)) return cancelledPhaseRuntime();
    throw error;
  }
  if (signal?.aborted) return cancelledPhaseRuntime();
  if (
    !ctx.model ||
    !sameSelectedModel(ctx.model, selectedModelKey) ||
    ctx.modelRegistry.getProvider(model.provider) !== delegate
  ) {
    return phaseRuntimeFailure(
      {
        kind: "environment",
        code: "sandbox-runtime-unavailable",
        stage: "phase-runtime",
      },
      "parent model or Provider changed during admission",
    );
  }
  return { ok: true, modelRuntime, model };
}

export async function runtimeForWorkerRoute(
  route: CustomRoutePolicy | InheritedRoutePolicy,
  ctx: Pick<ExtensionContext, "model" | "modelRegistry">,
  signal?: AbortSignal,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  observer?: PhaseTransportObserver,
): Promise<PhaseRuntimeResult> {
  return route.kind === "custom"
    ? customPhaseRuntime(route, signal, environment, observer)
    : runtimeFromContext(ctx, signal, observer);
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
