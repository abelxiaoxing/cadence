// Isolated SDK child, not Pi CLI startup. Task discovery stays disabled;
// ordinary conversations explicitly load only context/skills, never extensions.
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  createReadStream,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  writeSync,
} from "node:fs";
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
  VERSION,
} from "@earendil-works/pi-coding-agent";
import { conversationResources } from "./conversation-resources.mjs";
import { decodeImageBase64, validateImageBytes } from "./image-content.mjs";
import {
  BROWSER_COMMAND_ENTRY,
  WEBUI_SESSION_ENTRY,
} from "./session-entries.mjs";
import { CaptureEmitter, SdkCapture } from "./worker-capture.mjs";
import {
  closed,
  decodeWorkerPublicRequest,
  LIMITS,
  parseWireJson,
} from "./worker-public.mjs";
import { own } from "./worker-redaction.mjs";
import { createWorkerToolkit } from "./worker-toolkit.mjs";
import { ToolIngress } from "./worker-tools.mjs";
import { bindWorkerWorkspace } from "./worker-workspace.mjs";

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
let toolkit;
let ownsCoordinatorChannel = false;
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
let cleanupFailures = 0; // Bit flags: unsubscribe=1, abort=2, session/tool dispose=4, owned close=8.
let pendingAbort;
let cleanupSettled = false;
const fail = (where, category) => {
  const first = failure === undefined;
  failure ??= { stage: where, class: category };
  process.exitCode = 1;
  if (first) {
    // Prompt/preflight/terminal failure is distinct from a capture failure.
    // A normal provider error can have a completely retained error message.
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
                  : ["prompt", "preflight", "assistant-final"].includes(where)
                    ? "prompt"
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
/** A torn final line (a writer killed mid-line) would swallow the next entry. */
const terminateLastLine = (file) => {
  const fd = openSync(
    file,
    constants.O_RDWR | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const size = fstatSync(fd).size;
    const last = Buffer.alloc(1);
    if (size > 0 && readSync(fd, last, 0, 1, size - 1) === 1 && last[0] !== 10)
      writeSync(fd, "\n");
  } finally {
    closeSync(fd);
  }
};
/** The project's Pi session a browser turn writes, as the terminal shares it:
 * continued from the entry the browser showed, so a session that moved on
 * meanwhile gains a branch. Pi records the model and thinking level only when
 * a session starts; a continued one records a change so a resume keeps it. */
const openConversation = (target, cwd, model, thinkingLevel) => {
  let manager;
  if (target.file === null) {
    manager = SessionManager.create(cwd, target.dir, { id: target.id });
    manager.appendCustomEntry(WEBUI_SESSION_ENTRY, {});
  } else {
    terminateLastLine(target.file);
    manager = SessionManager.open(target.file, target.dir, cwd);
    if (manager.getSessionId() !== target.id)
      refuse("session", "session-mismatch");
    if (target.head === null) manager.resetLeaf();
    else if (!manager.getEntry(target.head)) refuse("session", "stale-head");
    else manager.branch(target.head);
  }
  const context = manager.buildSessionContext();
  if (context.messages.length) {
    if (
      context.model?.provider !== model.provider ||
      context.model?.modelId !== model.id
    )
      manager.appendModelChange(model.provider, model.id);
    if (
      context.thinkingLevel !== thinkingLevel &&
      manager.getBranch().some((e) => e.type === "thinking_level_change")
    )
      manager.appendThinkingLevelChange(thinkingLevel);
  }
  return manager;
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
  const parsed = parseWireJson(
    new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    LIMITS.workerRequestBytes,
  );
  const envelope = closed(parsed, [
    "request",
    "cwd",
    "model",
    "auth",
    ...(Object.hasOwn(parsed ?? {}, "conversation") ? ["conversation"] : []),
    ...(Object.hasOwn(parsed ?? {}, "investigation") ? ["investigation"] : []),
  ]);
  const conversation =
    envelope.conversation === undefined
      ? null
      : closed(envelope.conversation, [
          "session",
          "agentDir",
          ...(Object.hasOwn(envelope.conversation, "images") ? ["images"] : []),
          ...(Object.hasOwn(envelope.conversation, "coordinator")
            ? ["coordinator"]
            : []),
        ]);
  const target = conversation
    ? closed(conversation.session, ["id", "dir", "file", "head"])
    : null;
  // Stop and timeout signal the process group. A browser turn aborts its Pi
  // session first, so the session records the interrupted reply as Pi does.
  if (conversation)
    process.once("SIGTERM", () => {
      if (!session) process.exit(143);
      abortForFailure();
    });
  if (
    conversation &&
    (typeof conversation.agentDir !== "string" ||
      typeof target.id !== "string" ||
      !target.id ||
      typeof target.dir !== "string" ||
      !target.dir ||
      !(target.file === null || typeof target.file === "string") ||
      !(target.head === null || typeof target.head === "string"))
  )
    refuse("parse", "invalid-conversation");
  const investigation =
    envelope.investigation === undefined
      ? null
      : closed(envelope.investigation, ["roots", "timeoutMs"]);
  if (
    investigation &&
    (!Array.isArray(investigation.roots) ||
      investigation.roots.length < 1 ||
      investigation.roots.length > 8 ||
      investigation.roots.some(
        (p) => typeof p !== "string" || !p || p.length > 4096,
      ) ||
      !Number.isSafeInteger(investigation.timeoutMs) ||
      investigation.timeoutMs < 100 ||
      investigation.timeoutMs > LIMITS.workerMs)
  )
    refuse("parse", "invalid-investigation");
  const publicRequest = decodeWorkerPublicRequest(envelope.request);
  const coordinator = conversation?.coordinator === true;
  if (
    conversation?.coordinator !== undefined &&
    (!coordinator || !process.send || publicRequest.purpose !== "research")
  )
    refuse("parse", "invalid-coordinator");
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
  const workspace = bindWorkerWorkspace(cwd, investigation?.roots ?? [cwd]);
  const manager = conversation
    ? openConversation(target, workspace.cwd, model, requestedThinkingLevel)
    : SessionManager.inMemory(workspace.cwd);
  toolkit = createWorkerToolkit({
    workspace,
    purpose: publicRequest.purpose,
    changes: publicRequest.changes,
    coordinator,
    reporting: !conversation && publicRequest.purpose === "edit",
    secrets,
    fail: captureFailure,
    createLocalBashOperations,
    queue: emitter.queue,
  });
  ownsCoordinatorChannel = coordinator;
  const created = await createAgentSession({
    ...toolkit.sessionOptions,
    agentDir: workspace.cwd,
    model,
    modelRuntime: runtime,
    thinkingLevel: requestedThinkingLevel,
    resourceLoader:
      conversation && !coordinator
        ? conversationResources(
            resourceLoader,
            workspace.cwd,
            conversation.agentDir,
          )
        : resourceLoader,
    sessionManager: manager,
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
  session.agent.state.tools = ingress.wrap(
    toolkit.wrap(session.agent.state.tools),
  );
  const initialLeaf = conversation ? manager.getLeafId() : null;
  let recordedUser = null;
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
        if (
          conversation &&
          ["user", "assistant", "toolResult"].includes(own(message, "role"))
        ) {
          // Public core subscribers are awaited in registration order. The
          // AgentSession's earlier subscriber has persisted this message.
          // Each boundary names this worker's own prefix; a terminal append
          // after it is never claimed by walking arbitrary descendants.
          const entry = manager.getLeafEntry();
          if (
            entry?.type !== "message" ||
            entry.message.role !== own(message, "role") ||
            entry.id === initialLeaf
          )
            refuse("events", "event-projection-failed");
          if (own(message, "role") === "user") {
            if (recordedUser !== null)
              refuse("events", "event-projection-failed");
            recordedUser = entry.id;
          }
          if (recordedUser === null)
            refuse("events", "event-projection-failed");
          manager.appendCustomEntry(BROWSER_COMMAND_ENTRY, {
            commandId: publicRequest.runId,
            userId: recordedUser,
          });
        }
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
  await emitter.emit({
    kind: "ready",
    requestProtocol: 2,
    runtime: {
      sdkVersion: VERSION,
      workerHash: createHash("sha256")
        .update(readFileSync(new URL(import.meta.url)))
        .digest("hex"),
    },
  });
  await capture.context(publicRequest, session.systemPrompt);
  stage = "prompt";
  let images;
  if (Boolean(publicRequest.imageCount) !== Boolean(conversation?.images))
    throw new Error("Missing image channel");
  if (conversation?.images !== undefined) {
    const descriptor = closed(conversation.images, ["bytes", "sha256"]);
    if (
      !Number.isSafeInteger(descriptor.bytes) ||
      descriptor.bytes < 1 ||
      !/^[a-f0-9]{64}$/.test(descriptor.sha256) ||
      !model.input?.includes("image")
    )
      throw new Error("Invalid image context");
    const chunks = [];
    let size = 0;
    for await (const chunk of createReadStream(null, { fd: 3 })) {
      size += chunk.length;
      if (size > descriptor.bytes)
        throw new Error("Image payload exceeds bound");
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (
      size !== descriptor.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== descriptor.sha256
    )
      throw new Error("Incomplete image payload");
    images = JSON.parse(bytes.toString("utf8"));
    if (
      !Array.isArray(images) ||
      !images.length ||
      images.length !== publicRequest.imageCount
    )
      throw new Error("Invalid images");
    for (const image of images) {
      closed(image, ["type", "data", "mimeType"]);
      if (image.type !== "image") throw new Error("Invalid image");
      const decoded = decodeImageBase64(image.data);
      validateImageBytes(decoded, image.mimeType);
    }
  }
  const suppliedPrompt = [
    publicRequest.context,
    ...(!conversation && kind !== "code"
      ? [
          `Investigation roots: ${JSON.stringify(workspace.roots)}. Start at these specific paths, not / or their parents. Observation tools support file/range batches, literal multi-pattern searches and one-use continuation cursors; no shell is available. Read their schemas. Continue a cursor to advance actual I/O, including empty progress pages; do not repeat the initial query to paginate. Close unused cursors. Source-changed/expired cursors require an explicit fresh query, never an assumed continuation. Coverage names omissions and live-filesystem observation, not a snapshot. Search filenames and shallow directories before content; do not silently exclude backup trees. Total worker deadline: ${investigation?.timeoutMs ?? LIMITS.workerMs}ms, including model and tool time; activity never extends it. There is no cumulative tool-call quota or early tool cutoff. Use nextCursor when available; for terminal omissions, narrow the scope as needed. Never claim exhaustive absence from a progress page or incomplete coverage. Report retained evidence and unresolved questions honestly.`,
        ]
      : []),
    ...publicRequest.handoff.inputs.map(
      (input) =>
        `Dependency ${input.assignmentId} (recorded input):\n${input.text}`,
    ),
    prompt,
  ]
    .filter(Boolean)
    .join("\n\n");
  await session.prompt(suppliedPrompt, {
    ...(images ? { images } : {}),
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
  const closingTools = (async () => {
    try {
      await toolkit?.close();
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
    closingTools,
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
  if (ownsCoordinatorChannel && process.connected) process.disconnect();
}
