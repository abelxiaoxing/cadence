// Ordinary SDK child, not Pi CLI startup. No discovery, credential files or fallback executor.
import {
  createProvider,
  InMemoryCredentialStore,
  InMemoryModelsStore,
} from "@earendil-works/pi-ai";
import {
  createAgentSession,
  createExtensionRuntime,
  createLocalBashOperations,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { CaptureEmitter, SdkCapture } from "./worker-capture.mjs";
import {
  closed,
  decodeWorkerPublicRequest,
  LIMITS,
  parseWireJson,
} from "./worker-public.mjs";
import { own } from "./worker-redaction.mjs";
import { captureBash, ToolIngress } from "./worker-tools.mjs";

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
let emitter;
let capture;
let ingress;
let stdoutFailureListener;
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
    if (
      emitter?.state.position.workerSeq &&
      !emitter.state.position.final &&
      !emitter.broken
    ) {
      try {
        void emitter
          .emit({
            kind: "worker-failure",
            code:
              where === "cleanup"
                ? "cleanup"
                : where === "network"
                  ? "network"
                  : "capture",
          })
          .catch(() => {});
      } catch {
        /* A failed capture cannot fabricate a failure receipt. */
      }
    }
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
const emitFailure = () => {
  // Construct from fixed labels/primitives only; never inspect exception text,
  // provider diagnostics, response headers, payloads, usage or tool contents.
  const line = `${JSON.stringify({
    ...failure,
    outcome: "failed",
    sdkEvents: Math.min(sdkEvents, LIMITS.sdkEvents + 1),
    inputBytes: Math.min(inputBytes, 128 * 1024 + 1),
    modelOutputBytes: Math.min(modelOutputBytes, LIMITS.childProtocolBytes + 1),
    protocolBytes: Math.min(
      bytes + (emitter?.state.bytes ?? 0),
      LIMITS.childProtocolBytes + 1,
    ),
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
    if (
      bytes + (emitter?.state.bytes ?? 0) + size <=
      LIMITS.childProtocolBytes
    ) {
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
  const envelope = closed(
    parseWireJson(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
      LIMITS.workerRequestBytes,
    ),
    ["request", "cwd", "model", "auth"],
  );
  const publicRequest = decodeWorkerPublicRequest(envelope.request);
  const request = {
    ...envelope,
    kind:
      publicRequest.purpose === "edit"
        ? "code"
        : publicRequest.purpose === "diagnosis"
          ? "diagnosis"
          : "research",
    prompt: publicRequest.prompt,
    instructions: publicRequest.instructions,
    thinkingLevel: publicRequest.model.thinking,
  };
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
    typeof model.id !== "string" ||
    model.id !== publicRequest.model.model ||
    model.provider !== publicRequest.model.provider ||
    model.api !== publicRequest.model.api
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
  const secrets = [
    auth.apiKey ?? "",
    ...Object.values(auth.headers ?? {}).filter((v) => typeof v === "string"),
    ...Object.values(auth.env ?? {}),
    ...(proxy ? [proxy.httpProxy] : []),
  ];
  const captureFailure = () => {
    fail("events", "event-projection-failed");
    abortForFailure();
  };
  emitter = new CaptureEmitter(
    publicRequest.childRunId,
    process.stdout,
    captureFailure,
    publicRequest,
  );
  capture = new SdkCapture(emitter, secrets);
  ingress = new ToolIngress(secrets, captureFailure, emitter.queue);
  stdoutFailureListener = captureFailure;
  process.stdout.on("error", stdoutFailureListener);
  stage = "session";
  const requestedThinkingLevel = thinkingLevel ?? "off";
  const created = await createAgentSession({
    cwd,
    agentDir: cwd,
    model,
    modelRuntime: runtime,
    thinkingLevel: requestedThinkingLevel,
    tools:
      kind === "code"
        ? ["read", "grep", "find", "ls", "write", "edit", "bash"]
        : ["read", "grep", "find", "ls"],
    customTools:
      kind === "code"
        ? [
            captureBash(
              cwd,
              secrets,
              captureFailure,
              createLocalBashOperations,
              emitter.queue,
            ),
          ]
        : [],
    resourceLoader,
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false },
      cacheWarming: "off",
    }),
  });
  session = created.session;
  let effectiveThinkingLevel;
  try {
    effectiveThinkingLevel = session.thinkingLevel;
  } catch {
    refuse("session", "model-substitution");
  }
  if (
    created.modelFallbackMessage ||
    session.model?.id !== model.id ||
    session.model?.provider !== model.provider ||
    session.model?.api !== model.api ||
    effectiveThinkingLevel !== requestedThinkingLevel
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
  // Public awaited core subscription, not synchronous AgentSession forwarding.
  if (
    typeof session.agent.subscribe !== "function" ||
    !["parallel", "sequential"].includes(session.agent.toolExecution)
  )
    refuse("session", "capture-unsupported");
  session.agent.toolExecution = "sequential";
  if (session.agent.toolExecution !== "sequential")
    refuse("session", "capture-unsupported");
  session.agent.state.tools = ingress.wrap(session.agent.state.tools);
  unsubscribe = session.agent.subscribe(async (event) => {
    try {
      sdkEvents++;
      if (sdkEvents > LIMITS.sdkEvents) refuse("outputbounds", "event-bound");
      if (own(event, "type") === "message_update") {
        const update = own(event, "assistantMessageEvent");
        const type = own(update, "type");
        if (type === "text_delta" || type === "thinking_delta") {
          const delta = own(update, "delta");
          if (typeof delta !== "string") throw new Error("Malformed SDK event");
          modelOutputBytes += Buffer.byteLength(delta);
          if (modelOutputBytes > LIMITS.childProtocolBytes)
            refuse("outputbounds", "model-output-bound");
        }
      }
      if (own(event, "type") === "message_end") {
        const message = own(event, "message");
        if (own(message, "role") === "assistant") {
          const reason = own(message, "stopReason");
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
      if (failure) return;
      await capture.event(event);
    } catch {
      fail("events", "event-projection-failed");
      abortForFailure();
    } finally {
      try {
        ingress.release(event);
      } catch {
        fail("events", "event-projection-failed");
        abortForFailure();
      }
    }
  });
  stage = "ready";
  await emitter.emit({ kind: "ready", requestProtocol: 2 });
  await capture.context(publicRequest, session.systemPrompt);
  stage = "prompt";
  const suppliedPrompt = [
    publicRequest.context,
    ...publicRequest.handoff.inputs.map(
      (input) =>
        `Dependency ${input.assignmentId} (recorded input):\n${input.text}`,
    ),
    prompt,
  ]
    .filter(Boolean)
    .join("\n\n");
  await session.prompt(suppliedPrompt, {
    expandPromptTemplates: false,
    preflightResult: (accepted) => {
      preflight = accepted ? "accepted" : "rejected";
      if (!accepted) fail("preflight", "preflight-rejected");
    },
  });
  stage = "assistant-final";
  if (failure || terminalStopReason !== "stop" || ingress.frames !== 0)
    refuse("assistant-final", "terminal-incomplete");
  await capture.final();
  await emitter.drain();
} catch {
  // The stage is a location, not a complete diagnosis of an SDK/provider cause.
  fail(stage, stage === "parse" ? "parse-failed" : "sdk-failure");
} finally {
  try {
    capture?.dispose();
  } catch {
    fail("cleanup", "cleanup-failure");
  }
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
    emitter?.drain(),
  ]);
  // A final snapshot exists only after the actual cleanup attempts settle.
  if (stdoutFailureListener)
    process.stdout.removeListener("error", stdoutFailureListener);
  cleanupSettled = true;
  // Cleanup failures cannot become success, nor replace the first run failure.
  try {
    if (failure) emitFailure();
  } catch {
    // A failed diagnostic write cannot print an arbitrary exception or repair failure.
    process.exitCode = 1;
  }
}
