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
): Promise<ModelRuntime> {
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false,
  });
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
): Promise<{ modelRuntime: ModelRuntime; model: Model<string> }> {
  if (!ctx.model) throw new Error("parent model is unavailable");
  const parent = ctx.modelRegistry.getProvider(ctx.model.provider);
  if (!parent) throw new Error("parent Provider is unavailable");
  const resolved = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
  if (!resolved.ok) throw new Error(resolved.error);
  const provider = phaseProvider(parent, resolved);
  const modelRuntime = await runtimeForProvider(provider);
  const model = {
    ...ctx.model,
    baseUrl: resolved.baseUrl ?? ctx.model.baseUrl,
  } as Model<string>;
  return { modelRuntime, model };
}
