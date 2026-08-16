import {
  InMemoryCredentialStore,
  type Model,
  type Provider,
} from "@earendil-works/pi-ai";
import {
  type ExtensionContext,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";

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
      return parent.stream(model, context, {
        ...options,
        apiKey: auth.apiKey,
        headers: { ...auth.headers, ...options?.headers },
        env: { ...auth.env, ...options?.env },
        maxRetries: 0,
      } as never);
    },
    streamSimple(model, context, options) {
      return parent.streamSimple(model, context, {
        ...options,
        apiKey: auth.apiKey,
        headers: { ...auth.headers, ...options?.headers },
        env: { ...auth.env, ...options?.env },
        maxRetries: 0,
      });
    },
  };
}

export async function runtimeFromContext(
  ctx: Pick<ExtensionContext, "model" | "modelRegistry">,
  signal?: AbortSignal,
): Promise<{ modelRuntime: ModelRuntime; model: Model<string> }> {
  signal?.throwIfAborted();
  if (!ctx.model) throw new Error("parent model is unavailable");
  const parent = ctx.modelRegistry.getProvider(ctx.model.provider);
  if (!parent) throw new Error("parent Provider is unavailable");
  const resolved = await abortable(
    ctx.modelRegistry.getApiKeyAndHeaders(ctx.model),
    signal,
  );
  if (!resolved.ok) throw new Error(resolved.error);
  signal?.throwIfAborted();
  const provider = phaseProvider(parent, resolved);
  const modelRuntime = await runtimeForProvider(provider, signal);
  signal?.throwIfAborted();
  const model = {
    ...ctx.model,
    baseUrl: resolved.baseUrl ?? ctx.model.baseUrl,
  } as Model<string>;
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
