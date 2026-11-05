import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createProvider,
  InMemoryCredentialStore,
  InMemoryModelsStore,
} from "@earendil-works/pi-ai";
import * as api from "@earendil-works/pi-ai/api/openai-completions";
import {
  createAgentSession,
  createExtensionRuntime,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  VERSION,
} from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";

it("pins one current Pi release for the host contract, development and standalone SDK", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const version = pkg.optionalDependencies["@earendil-works/pi-coding-agent"];
  expect(version).toBe("1.5.0");
  expect(VERSION).toBe(version);
  for (const name of ["pi-coding-agent", "pi-ai", "pi-tui"]) {
    expect(
      JSON.parse(
        readFileSync(
          path.join(root, "node_modules/@earendil-works", name, "package.json"),
          "utf8",
        ),
      ).version,
    ).toBe(version);
    expect(pkg.peerDependencies[`@earendil-works/${name}`]).toBe(`^${version}`);
  }
  expect(pkg.optionalDependencies["@earendil-works/pi-ai"]).toBe(version);
  expect(pkg.devDependencies["@earendil-works/pi-tui"]).toBe(version);
});

it("uses the current public SDK with literal parent auth and no resource discovery or provider request", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "cadence-sdk-baseline-"));
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const model = {
    id: "fixture",
    name: "Fixture",
    provider: "cadence-fixture",
    api: "openai-completions",
    baseUrl: "http://127.0.0.1:1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32000,
    maxTokens: 1024,
  };
  runtime.registerNativeProvider(
    createProvider({
      id: model.provider,
      models: [model],
      api,
      auth: {
        apiKey: {
          name: "Fixture only",
          resolve: async () => ({
            auth: {
              apiKey: "!literal-$NO_INTERPOLATION",
              headers: { "x-fixture": "$LITERAL" },
            },
          }),
        },
      },
    }),
  );
  expect(runtime.getModel(model.provider, model.id)?.id).toBe(model.id);
  expect((await runtime.getAuth(model)).auth).toMatchObject({
    apiKey: "!literal-$NO_INTERPOLATION",
    headers: { "x-fixture": "$LITERAL" },
  });
  const extensions = {
    extensions: [],
    errors: [],
    runtime: createExtensionRuntime(),
  };
  const { session, modelFallbackMessage } = await createAgentSession({
    cwd,
    agentDir: cwd,
    model,
    modelRuntime: runtime,
    thinkingLevel: "off",
    tools: ["read"],
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false },
      cacheWarming: "off",
    }),
    resourceLoader: {
      getExtensions: () => extensions,
      getSkills: () => ({ skills: [], diagnostics: [] }),
      getPrompts: () => ({ prompts: [], diagnostics: [] }),
      getThemes: () => ({ themes: [], diagnostics: [] }),
      getAgentsFiles: () => ({ agentsFiles: [] }),
      getSystemPrompt: () => "Fixture",
      getSystemPromptSource: () => undefined,
      getAppendSystemPrompt: () => [],
      getAppendSystemPromptSources: () => [],
      extendResources() {},
      async reload() {
        throw new Error("Discovery forbidden");
      },
    },
  });
  try {
    expect(modelFallbackMessage).toBeUndefined();
    expect(session.model).toMatchObject({
      id: model.id,
      provider: model.provider,
      api: model.api,
    });
    expect(session.thinkingLevel).toBe("off");
    expect(session.getActiveToolNames()).toEqual(["read"]);
    expect(readdirSync(cwd)).toEqual([]);
  } finally {
    await session.abort();
    session.dispose();
  }
});
