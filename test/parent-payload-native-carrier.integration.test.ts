import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AssistantMessage,
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  InMemoryCredentialStore,
  InMemoryModelsStore,
  type Model,
  type Provider,
} from "@earendil-works/pi-ai";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import {
  type ParentModelKey,
  ParentPayloadBridge,
} from "../src/parent-payload-bridge.ts";

const roots: string[] = [];
const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function modelKey(model: Model<string>): ParentModelKey {
  return {
    provider: model.provider,
    id: model.id,
    api: model.api,
    baseUrl: model.baseUrl,
  };
}

function terminal(model: Model<string>) {
  const stream = createAssistantMessageEventStream();
  const message: AssistantMessage = {
    ...fauxAssistantMessage("overlay-native-done"),
    api: model.api,
    provider: model.provider,
    model: model.id,
  };
  queueMicrotask(() => {
    stream.push({ type: "done", reason: "stop", message });
    stream.end(message);
  });
  return stream;
}

async function overlayRuntime(): Promise<{
  registry: ModelRegistry;
  runtime: ModelRuntime;
  selected: Model<string>;
  native: Provider;
  nativeCalls: { count: number };
  apiCalls: () => number;
}> {
  const root = mkdtempSync(join(tmpdir(), "cadence-native-carrier-"));
  roots.push(root);
  const modelsPath = join(root, "models.json");
  const providerId = "cadence-overlay";
  const faux = registerFauxProvider({ api: "cadence-overlay-api" });
  faux.setResponses([fauxAssistantMessage("overlay-api-done")]);
  cleanups.push(faux.unregister);
  writeFileSync(
    modelsPath,
    JSON.stringify({
      providers: {
        [providerId]: {
          baseUrl: "https://overlay.invalid/v1",
          api: faux.api,
          apiKey: "overlay-key",
          models: [{ id: "overlay-model", name: "Overlay Model" }],
        },
      },
    }),
  );

  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath,
    modelsStore: new InMemoryModelsStore(),
    refreshOnCreate: false,
    allowModelNetwork: false,
  });
  const nativeModel: Model<string> = {
    id: "native-model",
    name: "Native Model",
    api: "openai-completions",
    provider: providerId,
    baseUrl: "https://native.invalid/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 16_384,
    maxTokens: 2_048,
  };
  const nativeCalls = { count: 0 };
  const native = {
    id: providerId,
    name: "Native Overlay",
    baseUrl: nativeModel.baseUrl,
    auth: {
      apiKey: {
        name: "native overlay",
        resolve: async () => ({ auth: { apiKey: "native-key" } }),
      },
    },
    getModels: () => [nativeModel],
    stream(model: Model<string>) {
      nativeCalls.count++;
      return terminal(model);
    },
    streamSimple(model: Model<string>) {
      nativeCalls.count++;
      return terminal(model);
    },
  } as Provider;
  runtime.registerNativeProvider(native);
  const selected = runtime.getModel(providerId, "overlay-model");
  if (!selected) throw new Error("overlay model missing");
  return {
    registry: new ModelRegistry(runtime),
    runtime,
    selected,
    native,
    nativeCalls,
    apiCalls: () => faux.state.callCount,
  };
}

async function collectDone(provider: Provider, model: Model<string>) {
  const stream = provider.streamSimple(
    model,
    { messages: [] },
    {
      onPayload: () => undefined,
    },
  );
  for await (const _event of stream) {
    // Successful completion is the public capture commit boundary.
  }
  expect((await stream.result()).stopReason).toBe("stop");
  await Promise.resolve();
  await Promise.resolve();
}

describe("parent payload native carrier under models.json overlay", () => {
  it("recognizes the registered native wrapper after Pi recomposes the effective provider", async () => {
    const { registry, selected, native, nativeCalls, apiCalls } =
      await overlayRuntime();
    const effective = registry.getProvider(selected.provider);
    expect(effective).toBeDefined();
    expect(effective).not.toBe(native);
    expect(registry.getRegisteredNativeProvider(selected.provider)).toBe(
      native,
    );

    const bridge = new ParentPayloadBridge();
    expect(bridge.diagnoseCapture(modelKey(selected), registry)).toBe(
      "parent-bridge-session-unavailable",
    );
    bridge.beginSession("overlay-session");
    expect(bridge.diagnoseCapture(modelKey(selected), registry)).toBe(
      "parent-bridge-provider-not-installed",
    );

    const first = bridge.install(selected, registry);
    expect(first).toBeDefined();
    expect(registry.getRegisteredNativeProvider(selected.provider)).toBe(first);
    expect(registry.getProvider(selected.provider)).not.toBe(first);
    expect(bridge.diagnoseCapture(modelKey(selected), registry)).toBe(
      "parent-bridge-capture-not-ready",
    );
    expect(bridge.capture(modelKey(selected), registry)).toBeUndefined();

    const second = bridge.install(selected, registry);
    expect(second).toBe(first);
    expect(registry.getRegisteredNativeProvider(selected.provider)).toBe(first);

    await collectDone(registry.getProvider(selected.provider)!, selected);
    expect(nativeCalls.count).toBe(0);
    expect(apiCalls()).toBe(1);
    expect(
      bridge.diagnoseCapture(modelKey(selected), registry),
    ).toBeUndefined();
    const capture = bridge.capture(modelKey(selected), registry);
    expect(capture?.delegate).toBe(effective);
    expect(capture?.modelKey).toEqual(modelKey(selected));
    expect(
      bridge.diagnoseCapture(
        { ...modelKey(selected), baseUrl: `${selected.baseUrl}/other` },
        registry,
      ),
    ).toBe("parent-bridge-model-key-mismatch");
  });
});
