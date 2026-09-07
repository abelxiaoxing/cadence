import {
  InMemoryCredentialStore,
  InMemoryModelsStore,
  type Provider,
} from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

/** Host SDK fixture only. Production child execution never creates ModelRuntime. */
export async function runtimeForProvider(
  provider: Provider,
  signal?: AbortSignal,
): Promise<ModelRuntime> {
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
    modelsPath: null,
    refreshOnCreate: false,
    signal,
  });
  runtime.registerNativeProvider(provider);
  return runtime;
}
