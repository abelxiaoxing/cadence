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
let ownedAgent;
let unsubscribe;
let count = 0;
let bytes = 0;
let inputBytes = 0;
let sdkEvents = 0;
let modelOutputBytes = 0;
let stage = "guards";
let failure;
let terminalStopReason = "UNKNOWN";
let requestPrepared = false;
let actualResponseStatus = "UNKNOWN";
let preflight = "UNKNOWN";
let cleanupFailures = 0; // Bit flags: unsubscribe=1, abort=2, dispose=4, owned close=8.
let pendingAbort;
let cleanupSettled = false;
const fail = (where, category) => {
  const first = failure === undefined;
  failure ??= { stage: where, class: category };
  process.exitCode = 1;
  if (first) {
    // A cleanup promise can remain unsettled after all native handles close.
    // Preserve the observed failure before awaiting it, without claiming cleanup.
    try {
      emitFailure();
    } catch {
      // Diagnostic I/O must not expose an exception or repair failed work.
    }
  }
};
const refuse = (where, category) => {
  fail(where, category);
  throw new Error("Worker refused");
};
const abortForFailure = () => {
  // Attach a rejection handler immediately, including synchronous SDK throws.
  // Do not let fire-and-forget abort print a secret-bearing unhandled rejection.
  pendingAbort ??= (async () => {
    try {
      await session.abort();
    } catch {
      cleanupFailures |= 2;
      fail("cleanup", "cleanup-failure");
    }
  })();
};
const emit = (value) => {
  const line = `${JSON.stringify(value)}\n`;
  bytes += Buffer.byteLength(line);
  if (++count > 4096 || bytes > 256 * 1024 || Buffer.byteLength(line) > 65536)
    refuse("outputbounds", "protocol-bound");
  process.stdout.write(line);
};
const emitFailure = () => {
  // Construct from fixed labels/primitives only; never inspect exception text,
  // provider diagnostics, response headers, payloads, usage or tool contents.
  const line = `${JSON.stringify({
    ...failure,
    outcome: "failed",
    sdkEvents: Math.min(sdkEvents, 4097),
    inputBytes: Math.min(inputBytes, 128 * 1024 + 1),
    modelOutputBytes: Math.min(modelOutputBytes, 256 * 1024 + 1),
    protocolBytes: Math.min(bytes, 256 * 1024 + 1),
    terminalStopReason,
    preflight,
    requestPrepared,
    actualResponseStatus,
    cleanupFailures,
    cleanupSettled,
  })}\n`;
  // Diagnostic output shares the existing aggregate cap, not a new allowance.
  const write = (text) => {
    const size = Buffer.byteLength(text);
    if (bytes + size <= 256 * 1024) {
      bytes += size;
      process.stderr.write(text);
    }
  };
  if (Buffer.byteLength(line) <= 512) write(line);
  if (cleanupSettled)
    write("SDK worker failed or returned an incomplete result.\n");
};
try {
  if (
    process.env.CADENCE_SUBAGENT_CHILD !== "1" ||
    process.env.PI_OFFLINE !== "1"
  )
    refuse("guards", "guards-required");
  // Only the parent's validated uppercase projection is input here. Capture in
  // RAM before asynchronous setup; literal auth.env is never process routing.
  let proxy;
  try {
    const httpProxy = process.env.HTTP_PROXY;
    const httpsProxy = process.env.HTTPS_PROXY;
    const optIn = process.env.NODE_USE_ENV_PROXY;
    if (
      httpProxy !== undefined ||
      httpsProxy !== undefined ||
      optIn !== undefined
    ) {
      if (
        typeof httpProxy !== "string" ||
        !httpProxy ||
        httpProxy !== httpsProxy ||
        optIn !== "1"
      )
        refuse("network", "unsupported-network");
      proxy = { httpProxy, httpsProxy, noProxy: "" };
    }
  } catch {
    refuse("network", "unsupported-network");
  }
  stage = "parse";
  const chunks = [];
  for await (const chunk of process.stdin) {
    inputBytes += chunk.length;
    if (inputBytes > 128 * 1024) refuse("parse", "input-bound");
    chunks.push(chunk);
  }
  const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  stage = "auth-model";
  const { cwd, auth, kind, prompt, instructions, thinkingLevel } = request;
  if (
    !auth?.ok ||
    typeof cwd !== "string" ||
    typeof prompt !== "string" ||
    typeof instructions !== "string" ||
    !["code", "research", "diagnosis"].includes(kind)
  )
    refuse("auth-model", "invalid-request");
  if (
    Object.keys(auth.env ?? {}).some((name) =>
      /(?:_FILE|_PATH|_CREDENTIALS)$/.test(name),
    )
  )
    refuse("auth-model", "unsupported-auth");
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
    refuse("auth-model", "unsupported-model");
  stage = "setup";
  const api = await adapters[model.api]();
  if (proxy) {
    stage = "network";
    try {
      // SDK/adapter imports can reset native startup routing. Configure only
      // this disposable child, using our declared public peer after imports.
      const { EnvHttpProxyAgent, setGlobalDispatcher, getGlobalDispatcher } =
        await import("undici");
      if (
        typeof EnvHttpProxyAgent !== "function" ||
        typeof setGlobalDispatcher !== "function" ||
        typeof getGlobalDispatcher !== "function"
      )
        refuse("network", "unsupported-network");
      ownedAgent = new EnvHttpProxyAgent(proxy);
      // Retain ownership even when installation or its identity check fails.
      setGlobalDispatcher(ownedAgent);
      if (getGlobalDispatcher() !== ownedAgent)
        refuse("network", "unsupported-network");
    } catch {
      refuse("network", "unsupported-network");
    }
  }
  stage = "setup";
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
  stage = "session";
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
    refuse("session", "model-substitution");
  // Adapter retry defaults are not workflow retries; explicitly disable both.
  const stream = session.agent.streamFunction;
  session.agent.streamFunction = (selected, context, options) => {
    const snapshot = { ...options, maxRetries: 0 };
    const { onPayload, onResponse } = snapshot;
    snapshot.onPayload = function (...args) {
      // Preparation is not proof of sending, an HTTP response or inference.
      requestPrepared = true;
      return onPayload == null
        ? undefined
        : Reflect.apply(onPayload, this, args);
    };
    snapshot.onResponse = function (...args) {
      // Observation must not bypass the original callback, even for a bad peer.
      // Public HTTP hook only; WS transports may never report a status here.
      actualResponseStatus = "UNKNOWN";
      try {
        const status = args[0]?.status;
        if (Number.isInteger(status) && status >= 100 && status <= 599)
          actualResponseStatus = status;
      } catch {
        // Do not inspect/coerce the response or exception.
      }
      return onResponse == null
        ? undefined
        : Reflect.apply(onResponse, this, args);
    };
    return stream(selected, context, snapshot);
  };
  let protocolFailed = false;
  unsubscribe = session.subscribe((event) => {
    // Protect the whole local projection, not just the awaited prompt chain.
    // Independently dispatched SDK callbacks must never leak a raw exception.
    try {
      sdkEvents++;
      if (!event || typeof event !== "object")
        throw new Error("Malformed SDK event");
      const type = event.type;
      if (typeof type !== "string") throw new Error("Malformed SDK event");
      if (type === "message_end") {
        const message = event.message;
        const role = message?.role;
        if (typeof role !== "string") throw new Error("Malformed SDK event");
        if (role === "assistant") {
          const reason = message.stopReason;
          if (typeof reason !== "string")
            throw new Error("Malformed SDK event");
          terminalStopReason = [
            "pending",
            "stop",
            "length",
            "toolUse",
            "error",
            "aborted",
            "deferred",
          ].includes(reason)
            ? reason
            : "UNKNOWN";
        }
      }
      if (type === "message_update") {
        const update = event.assistantMessageEvent;
        const updateType = update?.type;
        if (typeof updateType !== "string")
          throw new Error("Malformed SDK event");
        if (["text_delta", "thinking_delta"].includes(updateType)) {
          const delta = update.delta;
          if (typeof delta !== "string") throw new Error("Malformed SDK event");
          modelOutputBytes += Buffer.byteLength(delta);
        }
      }
      if (sdkEvents > 4096 || modelOutputBytes > 256 * 1024) {
        protocolFailed = true;
        fail(
          "outputbounds",
          sdkEvents > 4096 ? "event-bound" : "model-output-bound",
        );
        abortForFailure();
        return;
      }
      if (type === "tool_execution_start") {
        const name = event.toolName;
        if (typeof name !== "string") throw new Error("Malformed SDK event");
        try {
          emit({ type: "tool", name });
        } catch {
          protocolFailed = true;
          fail("outputbounds", "protocol-bound");
          abortForFailure();
        }
      }
    } catch {
      protocolFailed = true;
      fail("events", "event-projection-failed");
      abortForFailure();
    }
  });
  stage = "ready";
  emit({ type: "ready" });
  stage = "prompt";
  await session.prompt(prompt, {
    expandPromptTemplates: false,
    preflightResult: (accepted) => {
      preflight = accepted ? "accepted" : "rejected";
      if (!accepted) fail("preflight", "preflight-rejected");
    },
  });
  stage = "assistant-final";
  const last = session.messages
    .filter((message) => message.role === "assistant")
    .at(-1);
  const text = session.getLastAssistantText() ?? "";
  if (failure || protocolFailed || last?.stopReason !== "stop")
    refuse("assistant-final", "terminal-incomplete");
  if (Buffer.byteLength(text) > 16384)
    refuse("outputbounds", "final-text-bound");
  emit({ type: "final", text, stopReason: "stop" });
} catch {
  // The stage is a location, not a complete diagnosis of an SDK/provider cause.
  fail(stage, stage === "parse" ? "parse-failed" : "sdk-failure");
} finally {
  // Start and rejection-handle owned close BEFORE any potentially pending SDK
  // cleanup. Never restore or close the previous, unowned global dispatcher.
  const closing = (async () => {
    if (!ownedAgent) return;
    try {
      await ownedAgent.close();
    } catch {
      cleanupFailures |= 8;
      fail("cleanup", "cleanup-failure");
    }
  })();
  const unsubscribing = (async () => {
    try {
      await unsubscribe?.();
    } catch {
      cleanupFailures |= 1;
      fail("cleanup", "cleanup-failure");
    }
  })();
  const aborting = (async () => {
    if (!session) return;
    try {
      await session.abort();
    } catch {
      cleanupFailures |= 2;
      fail("cleanup", "cleanup-failure");
    }
  })();
  const disposing = (async () => {
    if (!session) return;
    try {
      await session.dispose();
    } catch {
      cleanupFailures |= 4;
      fail("cleanup", "cleanup-failure");
    }
  })();
  await Promise.all([
    closing,
    unsubscribing,
    pendingAbort,
    aborting,
    disposing,
  ]);
  // A final snapshot exists only after the actual cleanup attempts settle.
  cleanupSettled = true;
  // Cleanup failures cannot become success, nor replace the first run failure.
  try {
    if (failure) emitFailure();
  } catch {
    // A failed diagnostic write cannot print an arbitrary exception or repair failure.
    process.exitCode = 1;
  }
}
