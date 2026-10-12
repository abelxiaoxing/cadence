// Ordinary SDK child, not Pi CLI startup. No discovery, credential files or fallback executor.
import {
  createProvider,
  InMemoryCredentialStore,
  InMemoryModelsStore,
} from "@earendil-works/pi-ai";
import {
  createAgentSession,
  createExtensionRuntime,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

const adapters = {
  "openai-completions": () =>
    import("@earendil-works/pi-ai/api/openai-completions"),
  "openai-responses": () =>
    import("@earendil-works/pi-ai/api/openai-responses"),
  "openai-codex-responses": () =>
    import("@earendil-works/pi-ai/api/openai-codex-responses"),
  "anthropic-messages": () =>
    import("@earendil-works/pi-ai/api/anthropic-messages"),
  "google-generative-ai": () =>
    import("@earendil-works/pi-ai/api/google-generative-ai"),
  "mistral-conversations": () =>
    import("@earendil-works/pi-ai/api/mistral-conversations"),
  "azure-openai-responses": () =>
    import("@earendil-works/pi-ai/api/azure-openai-responses"),
};
let session;
let unsubscribe;
let count = 0;
let bytes = 0;
const emit = (value) => {
  const line = `${JSON.stringify(value)}\n`;
  bytes += Buffer.byteLength(line);
  if (++count > 4096 || bytes > 256 * 1024 || Buffer.byteLength(line) > 65536)
    throw new Error("Protocol bound");
  process.stdout.write(line);
};
try {
  if (
    process.env.CADENCE_SUBAGENT_CHILD !== "1" ||
    process.env.PI_OFFLINE !== "1"
  )
    throw new Error("Child guards required");
  let inputBytes = 0;
  const chunks = [];
  for await (const chunk of process.stdin) {
    inputBytes += chunk.length;
    if (inputBytes > 128 * 1024) throw new Error("Input bound");
    chunks.push(chunk);
  }
  const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const { cwd, auth, kind, prompt, instructions, thinkingLevel } = request;
  if (
    !auth?.ok ||
    typeof cwd !== "string" ||
    typeof prompt !== "string" ||
    typeof instructions !== "string" ||
    !["code", "research", "diagnosis"].includes(kind)
  )
    throw new Error("Invalid request");
  if (
    Object.keys(auth.env ?? {}).some((name) =>
      /(?:_FILE|_PATH|_CREDENTIALS)$/.test(name),
    )
  )
    throw new Error("Ambient-file auth is not portable");
  const model = {
    ...request.model,
    baseUrl: auth.baseUrl ?? request.model.baseUrl,
  };
  delete model.headers; // Parent auth already resolved these. Never config-interpolate literal credentials.
  if (
    !Object.hasOwn(adapters, model.api) ||
    typeof model.provider !== "string" ||
    typeof model.id !== "string"
  )
    throw new Error("Unsupported API");
  const api = await adapters[model.api]();
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  runtime.registerNativeProvider(
    createProvider({
      id: model.provider,
      models: [model],
      api,
      auth: {
        apiKey: {
          name: "Resolved parent request",
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
    }),
  );
  const extensionRuntime = createExtensionRuntime();
  const resourceLoader = {
    getExtensions: () => ({
      extensions: [],
      errors: [],
      runtime: extensionRuntime,
    }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => instructions,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {
      throw new Error("Discovery disabled");
    },
  };
  const created = await createAgentSession({
    cwd,
    agentDir: cwd,
    model,
    modelRuntime: runtime,
    thinkingLevel: thinkingLevel ?? "off",
    tools:
      kind === "code"
        ? ["read", "grep", "find", "ls", "write", "edit", "bash"]
        : ["read", "grep", "find", "ls"],
    resourceLoader,
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false },
    }),
  });
  session = created.session;
  if (
    created.modelFallbackMessage ||
    session.model?.id !== model.id ||
    session.model?.provider !== model.provider ||
    session.model?.api !== model.api
  )
    throw new Error("Model substitution refused");
  // Adapter retry defaults are not workflow retries; explicitly disable both.
  const stream = session.agent.streamFunction;
  session.agent.streamFunction = (selected, context, options) =>
    stream(selected, context, { ...options, maxRetries: 0 });
  let protocolFailed = false;
  let sdkEvents = 0;
  let modelOutputBytes = 0;
  unsubscribe = session.subscribe((event) => {
    sdkEvents++;
    if (
      event.type === "message_update" &&
      ["text_delta", "thinking_delta"].includes(
        event.assistantMessageEvent.type,
      )
    )
      modelOutputBytes += Buffer.byteLength(event.assistantMessageEvent.delta);
    if (sdkEvents > 4096 || modelOutputBytes > 256 * 1024) {
      protocolFailed = true;
      void session.abort();
      return;
    }
    if (event.type === "tool_execution_start") {
      try {
        emit({ type: "tool", name: event.toolName });
      } catch {
        protocolFailed = true;
        void session.abort();
      }
    }
  });
  emit({ type: "ready" });
  await session.prompt(prompt, { expandPromptTemplates: false });
  const last = session.messages
    .filter((message) => message.role === "assistant")
    .at(-1);
  const text = session.getLastAssistantText() ?? "";
  if (
    protocolFailed ||
    last?.stopReason !== "stop" ||
    Buffer.byteLength(text) > 16384
  )
    throw new Error("Incomplete worker result");
  emit({ type: "final", text, stopReason: "stop" });
} catch {
  // Provider/tool errors can contain credentials; never print raw errors or stacks.
  process.stderr.write("SDK worker failed or returned an incomplete result.\n");
  process.exitCode = 1;
} finally {
  unsubscribe?.();
  if (session) {
    await session.abort();
    session.dispose();
  }
}
