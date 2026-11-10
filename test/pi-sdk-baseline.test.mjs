import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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

it("Pi names an opened session with one appended session_info entry, and an empty name clears it", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cadence-sdk-name-"));
  const id = "01a18b9d-bbbb-72ad-9486-b15306897929";
  const file = path.join(dir, `2026-11-02T00-00-00-000Z_${id}.jsonl`);
  const at = new Date(0).toISOString();
  // No assistant reply yet: an opened file is appended to all the same.
  const before = `${JSON.stringify({ type: "session", version: 3, id, timestamp: at, cwd: dir })}\n${JSON.stringify(
    {
      type: "message",
      id: "aaaaaaaa",
      parentId: null,
      timestamp: at,
      message: {
        role: "user",
        content: [{ type: "text", text: "hi" }],
        timestamp: 0,
      },
    },
  )}\n`;
  writeFileSync(file, before);
  const manager = SessionManager.open(file, dir, dir);
  expect(manager.getSessionId()).toBe(id);
  const entry = manager.appendSessionInfo("  Named\nhere ");
  const after = readFileSync(file, "utf8");
  expect(after.startsWith(before)).toBe(true);
  expect(after.endsWith("\n")).toBe(true);
  expect(JSON.parse(after.slice(before.length))).toEqual({
    type: "session_info",
    id: entry,
    parentId: "aaaaaaaa",
    timestamp: expect.any(String),
    name: "Named here",
  });
  expect(manager.getSessionName()).toBe("Named here");
  manager.appendSessionInfo("");
  expect(manager.getSessionName()).toBeUndefined();
  expect(readFileSync(file, "utf8").trimEnd().split("\n")).toHaveLength(4);
  expect(readdirSync(dir)).toHaveLength(1);
});
