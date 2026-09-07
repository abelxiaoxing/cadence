import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxProvider,
  InMemoryCredentialStore,
  InMemoryModelsStore,
  type Model,
  type Provider,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runtimeFromContext } from "../src/parent-provider.ts";
import { runtimeForProvider } from "./helpers/model-runtime.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const faux = fauxProvider({ provider: "snapshot-fixture", api: "faux" });
  const model = faux.getModel();
  const calls: { model: Model<string>; options?: SimpleStreamOptions }[] = [];
  const provider: Provider = {
    ...faux.provider,
    auth: {
      apiKey: {
        name: "snapshot",
        resolve: async ({ credential }) => ({
          auth: {
            apiKey:
              credential?.type === "api_key" ? credential.key : "default-key",
          },
        }),
      },
    },
    streamSimple(requestModel, _context, options) {
      calls.push({ model: requestModel, options });
      const stream = createAssistantMessageEventStream();
      const message = fauxAssistantMessage("provider-owned behavior");
      stream.push({ type: "done", reason: "stop", message });
      stream.end();
      return stream;
    },
  };
  const registry = {
    getProvider: vi.fn(() => provider),
    getApiKeyAndHeaders: vi.fn(async () => ({
      ok: true as const,
      apiKey: "fresh-key",
      headers: { "x-auth": "fresh" },
      baseUrl: model.baseUrl,
      env: { REGION: "local" },
    })),
    registerProvider: vi.fn(),
  };
  const context = { model, modelRegistry: registry };
  return { model, provider, calls, registry, context };
}
async function complete(phase: Awaited<ReturnType<typeof runtimeFromContext>>) {
  if (!phase.ok) throw new Error(phase.error);
  return phase.modelRuntime.completeSimple(
    phase.model,
    { messages: [] },
    { maxRetries: 5 },
  );
}

describe("inherited Provider admission without host callback capture", () => {
  it("rejects Provider replacement during authentication", async () => {
    const f = fixture();
    f.registry.getApiKeyAndHeaders.mockImplementation(async () => {
      f.registry.getProvider.mockReturnValue({ ...f.provider });
      return {
        ok: true,
        apiKey: "fresh-key",
        headers: { "x-auth": "fresh" },
        baseUrl: f.model.baseUrl,
        env: { REGION: "local" },
      };
    });
    expect(await runtimeFromContext(f.context as never)).toMatchObject({
      ok: false,
      failure: { kind: "environment" },
    });
    expect(f.calls).toHaveLength(0);
  });

  it("does not change an admitted attempt when the parent later selects another model", async () => {
    const f = fixture();
    const phase = await runtimeFromContext(f.context as never);
    f.context.model.id = "changed-in-place";
    await complete(phase);
    expect(f.calls[0].model.id).not.toBe("changed-in-place");
  });

  it("works before any parent request, keeps Provider identity intact and uses fresh auth", async () => {
    const f = fixture();
    const phase = await runtimeFromContext(f.context as never);
    expect(phase.ok).toBe(true);
    expect(f.calls).toHaveLength(0);
    expect((await complete(phase)).content).toEqual([
      { type: "text", text: "provider-owned behavior" },
    ]);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].options).toMatchObject({
      apiKey: "fresh-key",
      headers: { "x-auth": "fresh" },
      env: { REGION: "local" },
      maxRetries: 0,
    });
    expect(f.calls[0].options?.onPayload).toBeUndefined();
    expect(f.registry.registerProvider).not.toHaveBeenCalled();
    expect(f.registry.getProvider()).toBe(f.provider);
  });

  it("resolves auth anew for each attempt and does not share request callbacks", async () => {
    const f = fixture();
    let count = 0;
    f.registry.getApiKeyAndHeaders.mockImplementation(async () => ({
      ok: true,
      apiKey: `key-${++count}`,
      headers: { "x-auth": "fresh" },
      baseUrl: f.model.baseUrl,
      env: { REGION: "local" },
    }));
    const a = await runtimeFromContext(f.context as never);
    const b = await runtimeFromContext(f.context as never);
    await Promise.all([complete(a), complete(b)]);
    expect(f.calls.map((call) => call.options?.apiKey).sort()).toEqual([
      "key-1",
      "key-2",
    ]);
    expect(f.registry.registerProvider).not.toHaveBeenCalled();
  });

  it("rejects a model change while authentication is pending", async () => {
    const f = fixture();
    f.registry.getApiKeyAndHeaders.mockImplementation(async () => {
      f.context.model = { ...f.model, id: "changed" };
      return {
        ok: true,
        apiKey: "fresh-key",
        headers: { "x-auth": "fresh" },
        baseUrl: f.model.baseUrl,
        env: { REGION: "local" },
      };
    });
    expect(await runtimeFromContext(f.context as never)).toMatchObject({
      ok: false,
      failure: { kind: "environment" },
    });
    expect(f.calls).toHaveLength(0);
  });

  it("does not require snapshot invalidation after a finished child", async () => {
    const f = fixture();
    await complete(await runtimeFromContext(f.context as never));
    f.context.model = { ...f.model, id: "next-model" };
    await complete(await runtimeFromContext(f.context as never));
    expect(f.calls.map((call) => call.model.id)).toEqual([
      f.model.id,
      "next-model",
    ]);
  });

  it("cancels pending auth without waiting for an uncooperative resolver", async () => {
    const f = fixture();
    const controller = new AbortController();
    f.registry.getApiKeyAndHeaders.mockImplementation(
      () => new Promise(() => {}),
    );
    const pending = runtimeFromContext(f.context as never, controller.signal);
    controller.abort();
    expect(await pending).toMatchObject({
      ok: false,
      failure: { kind: "cancelled" },
    });
    expect(f.calls).toHaveLength(0);
  });

  it("honors effective models.json overlays instead of reaching for native carrier internals", async () => {
    const root = mkdtempSync(join(tmpdir(), "cadence-provider-overlay-"));
    roots.push(root);
    const modelsPath = join(root, "models.json");
    const f = fixture();
    writeFileSync(
      modelsPath,
      JSON.stringify({
        providers: {
          [f.model.provider]: {
            baseUrl: "https://overlay.invalid/v1",
            apiKey: "overlay-key",
          },
        },
      }),
    );
    const runtime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath,
      modelsStore: new InMemoryModelsStore(),
      refreshOnCreate: false,
    });
    runtime.registerNativeProvider(f.provider);
    const selected = runtime.getModel(f.model.provider, f.model.id);
    expect(selected).toBeDefined();
    const registry = new ModelRegistry(runtime);
    const effective = registry.getProvider(f.model.provider);
    const phase = await runtimeFromContext({
      model: selected,
      modelRegistry: registry,
    });
    await complete(phase);
    expect(f.calls[0].model.baseUrl).toBe("https://overlay.invalid/v1");
    expect(
      f.calls[0].options?.apiKey ??
        f.calls[0].options?.headers?.Authorization ??
        f.calls[0].options?.headers?.authorization,
    ).toContain("overlay-key");
    expect(registry.getProvider(f.model.provider)).toBe(effective);
  });

  it("uses a real public runtime without parent registry registrations", async () => {
    const f = fixture();
    const runtime = await runtimeForProvider(f.provider);
    const registry = new ModelRegistry(runtime);
    const register = vi.spyOn(registry, "registerProvider");
    await complete(
      await runtimeFromContext({ model: f.model, modelRegistry: registry }),
    );
    expect(register).not.toHaveBeenCalled();
  });
});
