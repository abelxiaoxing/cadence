// Actual installed public SDK + numeric-loopback provider. Controlled listener/tool
// gates measure capabilities; this is NOT the v2 capture producer or a disk sink.
import assert from "node:assert/strict";
import { setImmediate as checkpoint } from "node:timers/promises";
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
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const mode = process.argv[2];
assert.ok(["sequential", "parallel", "capture-overflow"].includes(mode));
// Narrow failure injection after genuine SDK capability observations, not a mock run.
const cleanupFault = process.argv[4] ?? "none";
assert.ok(["none", "unsubscribe", "abort", "dispose"].includes(cleanupFault));
const baseUrl = process.argv[3];
assert.match(baseUrl, /^http:\/\/127\.0\.0\.1:\d+\/v1$/);
const toolExecution = mode === "parallel" ? "parallel" : "sequential";
const overflow = mode === "capture-overflow";
const assistant = deferred(),
  allowAssistant = deferred();
const updates = deferred(),
  allowUpdates = deferred();
const first = deferred(),
  second = deferred(),
  allowSecond = deferred();
const ending = deferred(),
  allowEnd = deferred();
let session;
let unsubscribe, unsubscribeSecond;
let phase = "setup";
const facts = {
  mode,
  cleanupFault,
  cleanupAttempted: 0,
  cleanupSettled: 0,
  cleanupFailures: 0,
  toolExecution,
  preflight: false,
  listenerSignal: false,
  assistantBlocked: false,
  endBlocked: false,
  secondListenerEnd: false,
  updateCalls: 0,
  updateCallbacks: 0,
  immediateCallbacks: null,
  retained: 0,
  highWater: 0,
  refused: 0,
  copies: 0,
  abortRequested: false,
  activeTools: 0,
  maxActiveTools: 0,
  starts: [],
  executions: [],
  ends: [],
  order: [],
  resultMessages: [],
  finalStop: null,
  finalText: null,
};
try {
  const model = {
    id: "capture-fixture",
    name: "Capture fixture",
    provider: "fabricated-capture",
    api: "openai-completions",
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8192,
    maxTokens: 128,
    compat: { supportsDeveloperRole: false, maxTokensField: "max_tokens" },
  };
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
          name: "Fabricated fixture",
          resolve: async () => ({
            auth: { apiKey: "FABRICATED_CAPTURE_CANARY_872019" },
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
    getSystemPrompt: () => "Fabricated capability fixture only.",
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {
      throw new Error("no discovery");
    },
  };
  const created = await createAgentSession({
    cwd: process.cwd(),
    agentDir: process.cwd(),
    model,
    modelRuntime: runtime,
    thinkingLevel: "off",
    tools: ["capture_probe"],
    resourceLoader,
    customTools: [
      {
        name: "capture_probe",
        label: "Capture probe",
        description: "Controlled fixture tool",
        parameters: Type.Object({
          ordinal: Type.Integer({ minimum: 1, maximum: 2 }),
        }),
        async execute(_id, params, signal, onUpdate) {
          const ordinal = params.ordinal;
          facts.executions.push(ordinal);
          facts.activeTools++;
          facts.maxActiveTools = Math.max(
            facts.maxActiveTools,
            facts.activeTools,
          );
          if (ordinal === 1) {
            for (let n = 1; n <= 3; n++) {
              facts.updateCalls++;
              assert.equal(
                onUpdate({
                  content: [{ type: "text", text: `snapshot-${n}` }],
                  details: { n },
                }),
                undefined,
              );
            }
            // Session's earlier internal listener can yield before ours is called.
            // A subscriber is NOT a synchronous source ingress bound.
            facts.immediateCallbacks = facts.updateCallbacks;
            await first.promise;
          } else {
            second.resolve();
            await allowSecond.promise;
          }
          facts.activeTools--;
          assert.equal(signal.aborted, overflow);
          return {
            content: [{ type: "text", text: `result-${ordinal}` }],
            details: { ordinal },
          };
        },
      },
    ],
    sessionManager: SessionManager.inMemory(process.cwd()),
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false },
      cacheWarming: "off",
    }),
  });
  session = created.session;
  assert.equal(created.modelFallbackMessage, undefined);
  assert.equal(session.model.id, model.id);
  assert.equal(session.thinkingLevel, "off");
  assert.deepEqual(session.getActiveToolNames(), ["capture_probe"]);
  const stream = session.agent.streamFunction;
  session.agent.streamFunction = (selected, context, options) =>
    stream(selected, context, { ...options, maxRetries: 0 });
  session.agent.toolExecution = toolExecution;
  assert.equal(session.agent.toolExecution, toolExecution);
  unsubscribe = session.agent.subscribe((event, signal) => {
    facts.listenerSignal = signal === session.agent.signal;
    assert.equal(facts.listenerSignal, true);
    if (event.type === "message_end" && event.message.role === "assistant") {
      facts.finalStop = event.message.stopReason;
      if (event.message.stopReason === "toolUse") {
        assistant.resolve();
        return allowAssistant.promise;
      }
      facts.finalText = event.message.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
    }
    if (event.type === "tool_execution_start") {
      facts.starts.push(event.toolCallId);
      facts.order.push(`start:${event.toolCallId}`);
    }
    if (event.type === "tool_execution_update") {
      // Controlled three fixed-size values: reserve BEFORE copying/awaiting.
      // This probes listener ingress only, not arbitrary SDK object projection.
      facts.updateCallbacks++;
      if (facts.retained === (overflow ? 2 : 3)) {
        facts.refused++;
        facts.abortRequested = true;
        session.agent.abort(); // void request; never await current listener's own run.
      } else {
        facts.retained++;
        facts.highWater = Math.max(facts.highWater, facts.retained);
        const copy = structuredClone(event.partialResult);
        facts.copies++;
        assert.equal(copy.content[0].text, `snapshot-${facts.updateCallbacks}`);
        if (facts.updateCallbacks === 3) updates.resolve();
        return allowUpdates.promise.then(() => {
          facts.retained--;
        });
      }
      if (facts.updateCallbacks === 3) updates.resolve();
    }
    if (event.type === "tool_execution_end") {
      facts.ends.push({ id: event.toolCallId, isError: event.isError });
      facts.order.push(`end:${event.toolCallId}`);
      assert.equal(facts.retained, 0);
    }
    if (event.type === "message_end" && event.message.role === "toolResult")
      facts.resultMessages.push(event.message.toolCallId);
    if (event.type === "agent_end") {
      ending.resolve();
      return allowEnd.promise;
    }
  });
  unsubscribeSecond = session.agent.subscribe((event) => {
    if (event.type === "agent_end") facts.secondListenerEnd = true;
  });
  phase = "prompt";
  let promptSettled = false,
    idleSettled = false;
  const prompt = session.prompt("Exercise the two controlled tools.", {
    expandPromptTemplates: false,
    preflightResult: (accepted) => {
      facts.preflight = accepted;
    },
  });
  // Immediately handle the original promise, without substituting its settlement.
  const handled = prompt.then(
    () => {
      promptSettled = true;
    },
    () => {
      promptSettled = true;
      throw new Error("prompt failed");
    },
  );
  handled.catch(() => {});
  await assistant.promise;
  await checkpoint();
  assert.deepEqual(facts.starts, []);
  assert.equal(promptSettled, false);
  facts.assistantBlocked = true;
  allowAssistant.resolve();
  phase = "updates";
  await updates.promise;
  if (toolExecution === "parallel") await second.promise;
  await checkpoint();
  assert.equal(facts.retained, overflow ? 2 : 3);
  assert.equal(facts.copies, overflow ? 2 : 3);
  assert.equal(facts.refused, overflow ? 1 : 0);
  assert.deepEqual(facts.ends, []);
  assert.equal(facts.maxActiveTools, toolExecution === "parallel" ? 2 : 1);
  assert.equal(facts.starts.length, toolExecution === "parallel" ? 2 : 1);
  assert.equal(promptSettled, false);
  allowUpdates.resolve();
  first.resolve();
  allowSecond.resolve();
  phase = "agent-end";
  await ending.promise;
  const idle = session.agent.waitForIdle().then(() => {
    idleSettled = true;
  });
  await checkpoint();
  assert.equal(promptSettled, false);
  assert.equal(idleSettled, false);
  assert.equal(session.agent.state.isStreaming, true);
  assert.equal(facts.secondListenerEnd, false);
  facts.endBlocked = true;
  allowEnd.resolve();
  await handled;
  await idle;
  assert.equal(session.agent.state.isStreaming, false);
  assert.equal(facts.secondListenerEnd, true);
  assert.equal(facts.retained, 0);
  assert.equal(facts.preflight, true);
  assert.deepEqual(facts.executions, overflow ? [1] : [1, 2]);
  if (!overflow) {
    assert.equal(facts.finalStop, "stop");
    assert.equal(facts.finalText, "CAPABILITY_OK");
    assert.deepEqual(facts.resultMessages, ["capture_1", "capture_2"]);
    assert.deepEqual(
      facts.ends.map((e) => e.isError),
      [false, false],
    );
    if (toolExecution === "sequential")
      assert.deepEqual(facts.order, [
        "start:capture_1",
        "end:capture_1",
        "start:capture_2",
        "end:capture_2",
      ]);
  } else assert.notEqual(facts.finalStop, "stop");
  phase = "cleanup";
} catch {
  process.exitCode = 1;
  process.stderr.write(`capability-fixture-failed:${phase}\n`);
} finally {
  allowAssistant.resolve();
  allowUpdates.resolve();
  first.resolve();
  allowSecond.resolve();
  allowEnd.resolve();
  // Start and immediately handle each independent attempt. A throwing/rejecting
  // earlier cleanup must neither skip another attempt nor print an opaque error.
  const attempt = (bit, name, run) => {
    facts.cleanupAttempted |= bit;
    const failed = () => {
      facts.cleanupFailures |= bit;
      facts.cleanupSettled |= bit;
    };
    try {
      const result = run();
      if (cleanupFault === name) {
        const opaque = new Error("FABRICATED_CAPTURE_CANARY_872019");
        if (name === "unsubscribe") throw opaque;
        return Promise.resolve(result)
          .then(() => {
            throw opaque;
          })
          .then(undefined, failed);
      }
      return Promise.resolve(result).then(() => {
        facts.cleanupSettled |= bit;
      }, failed);
    } catch {
      failed();
    }
  };
  await Promise.all([
    attempt(1, "unsubscribe", () => unsubscribe?.()),
    attempt(2, "second-unsubscribe", () => unsubscribeSecond?.()),
    attempt(4, "abort", () => session?.abort()),
    attempt(8, "dispose", () => session?.dispose()),
  ]);
  if (facts.cleanupFailures) {
    process.exitCode = 1;
    process.stderr.write("capability-fixture-failed:cleanup\n");
  }
}
// This fixture observation is not a worker final/success frame. Native nonzero
// remains failure even when all controlled observations and cleanups are recorded.
process.stdout.write(`${JSON.stringify(facts)}\n`);
