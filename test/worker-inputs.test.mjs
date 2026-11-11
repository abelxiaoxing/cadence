// Messages sent into a running conversation turn, against the installed SDK's
// real AgentSession with a controlled provider reply. The IPC channel is an
// in-process stand-in, and the boundary bookkeeping below is the worker's own
// few lines repeated; the real child and owner are `service-conversation-inputs`.
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import {
  createProvider,
  InMemoryCredentialStore,
  InMemoryModelsStore,
} from "@earendil-works/pi-ai";
import * as api from "@earendil-works/pi-ai/api/openai-responses";
import {
  createAgentSession,
  createExtensionRuntime,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { expect, it } from "vitest";
import { BROWSER_COMMAND_ENTRY } from "../src/session-entries.mjs";
import {
  CaptureEmitter,
  CaptureState,
  SdkCapture,
} from "../src/worker-capture.mjs";
import { conversationInputs } from "../src/worker-inputs.mjs";
import { WORKER_POLICY } from "../src/worker-model.mjs";

const model = {
  id: "fixture",
  name: "Fixture",
  provider: "cadence-fixture",
  api: "openai-responses",
  baseUrl: "http://fixture.invalid/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32000,
  maxTokens: 1024,
};
const call = {
  type: "function_call",
  id: "fc_fixture",
  call_id: "call_fixture",
  name: "effect",
  arguments: '{"value":1}',
};
const said = (text) => ({
  type: "message",
  role: "assistant",
  id: `msg_${randomUUID()}`,
  content: [{ type: "output_text", text, annotations: [] }],
});
function response(output) {
  const events = [
    {
      type: "response.created",
      response: { id: "resp_fixture", status: "in_progress" },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: {
        ...output,
        ...(output.type === "function_call"
          ? { arguments: "" }
          : { content: [] }),
      },
    },
    output.type === "function_call"
      ? {
          type: "response.function_call_arguments.delta",
          output_index: 0,
          delta: output.arguments,
        }
      : {
          type: "response.output_text.delta",
          output_index: 0,
          delta: output.content[0].text,
        },
    { type: "response.output_item.done", output_index: 0, item: output },
    {
      type: "response.completed",
      response: { id: "resp_fixture", status: "completed", output: [output] },
    },
  ];
  return new Response(
    events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
}
const refused = () =>
  new Response('{"error":{"message":"fabricated failure"}}', { status: 400 });
/** A promise a test settles when the reply or tool it holds may proceed. */
function gate() {
  let open;
  const held = new Promise((resolve) => {
    open = resolve;
  });
  return { held, open };
}
const until = async (condition) => {
  for (let n = 0; n < 2000 && !condition(); n++)
    await new Promise((resolve) => setImmediate(resolve));
  expect(condition()).toBe(true);
};

async function fixture(reply, effect = async () => {}, observe = () => {}) {
  const cwd = mkdtempSync(join(tmpdir(), "worker-inputs-"));
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
          name: "Fixture",
          resolve: async () => ({ auth: { apiKey: "fixture-only" } }),
        },
      },
    }),
  );
  const manager = SessionManager.inMemory(cwd);
  const { session } = await createAgentSession({
    cwd,
    agentDir: cwd,
    model,
    modelRuntime: runtime,
    thinkingLevel: "off",
    tools: ["effect"],
    customTools: [
      {
        name: "effect",
        label: "effect",
        description: "Fixture effect",
        parameters: Type.Object({ value: Type.Number() }),
        execute: async () => {
          await effect();
          return { content: [{ type: "text", text: "effect completed" }] };
        },
      },
    ],
    settingsManager: SettingsManager.inMemory({
      ...WORKER_POLICY,
      retry: { enabled: false, provider: { maxRetries: 0 } },
      compaction: { enabled: false },
    }),
    sessionManager: manager,
    resourceLoader: {
      getExtensions: () => ({
        extensions: [],
        errors: [],
        runtime: createExtensionRuntime(),
      }),
      getSkills: () => ({ skills: [], diagnostics: [] }),
      getPrompts: () => ({ prompts: [], diagnostics: [] }),
      getThemes: () => ({ themes: [], diagnostics: [] }),
      getAgentsFiles: () => ({ agentsFiles: [] }),
      getSystemPrompt: () => "Fixture",
      getSystemPromptSource: () => undefined,
      getAppendSystemPrompt: () => [],
      getAppendSystemPromptSources: () => [],
      extendResources() {},
      reload: async () => {},
    },
  });
  const requests = [];
  const stream = session.agent.streamFunction;
  session.agent.streamFunction = (selected, context, options) =>
    stream(selected, context, {
      ...options,
      maxRetries: 0,
      fetch: async (_url, init) => {
        requests.push(JSON.parse(init.body));
        return reply(requests.length);
      },
    });
  // The owner's side of the channel: what the worker answers.
  const channel = Object.assign(new EventEmitter(), {
    answers: [],
    send(message, done) {
      channel.answers.push(message);
      done?.();
    },
  });
  const failures = [];
  const inputs = conversationInputs(channel, session, (category) =>
    failures.push(category),
  );
  session.subscribe((event) => inputs.event(event));
  const childRunId = randomUUID(),
    frames = [];
  const emitter = new CaptureEmitter(
    childRunId,
    new Writable({
      write(chunk, _encoding, done) {
        frames.push(JSON.parse(chunk.toString()));
        done();
      },
    }),
    () => failures.push("capture"),
  );
  await emitter.emit({ kind: "ready", requestProtocol: 2 });
  const capture = new SdkCapture(emitter, ["fixture-only"]);
  // The worker's boundary bookkeeping (src/sdk-worker.mjs).
  const run = randomUUID();
  let command = run,
    recordedUser = null;
  session.agent.subscribe(async (event) => {
    observe(event);
    if (
      event.type === "message_end" &&
      ["user", "assistant", "toolResult"].includes(event.message.role)
    ) {
      const entry = manager.getLeafEntry();
      if (event.message.role === "user") {
        if (recordedUser !== null) {
          const steered = inputs.delivered();
          if (!steered) failures.push("unexpected-user");
          else command = steered.id;
        }
        recordedUser = entry.id;
      }
      manager.appendCustomEntry(BROWSER_COMMAND_ENTRY, {
        commandId: command,
        userId: recordedUser,
        ...(command === run ? {} : { run }),
      });
    }
    await capture.event(event);
  });
  const send = (mode, text, id = randomUUID()) => {
    channel.emit("message", { kind: "input", id, mode, text });
    return id;
  };
  return {
    session,
    channel,
    inputs,
    failures,
    requests,
    run,
    send,
    prompt: (text) => session.prompt(text, { expandPromptTemplates: false }),
    /** The worker's own next prompt, for a message that waited. */
    async next() {
      const input = inputs.next();
      if (!input) return undefined;
      command = input.id;
      recordedUser = null;
      await session.prompt(input.text, { expandPromptTemplates: false });
      return input.id;
    },
    /** Each user message Pi wrote, with the command its boundaries name. */
    written() {
      const entries = manager.getEntries();
      return entries
        .filter((e) => e.type === "message" && e.message.role === "user")
        .map((user) => ({
          text: user.message.content.map((part) => part.text).join(""),
          commands: [
            ...new Set(
              entries
                .filter(
                  (e) =>
                    e.type === "custom" &&
                    e.customType === BROWSER_COMMAND_ENTRY &&
                    e.data.userId === user.id,
                )
                .map((e) => e.data.commandId),
            ),
          ],
        }));
    },
    /** One final frame after every prompt, as the owner's decoder accepts it. */
    async final() {
      await capture.final();
      await emitter.drain();
      const state = new CaptureState(childRunId);
      for (const frame of frames) state.accept(frame);
      return state;
    },
    async close() {
      inputs.close();
      await session.abort();
      capture.dispose();
      session.dispose();
    },
  };
}

it("a steer reaches the model after the running tool call and before the next request, owned by its own command", async () => {
  const tool = gate();
  const f = await fixture(
    (n) => (n === 1 ? response(call) : response(said(`reply ${n}`))),
    () => tool.held,
  );
  try {
    // Before any reply runs there is nothing to steer: the message waits.
    const early = f.send("steer", "Before the reply");
    const running = f.prompt("Start");
    await until(() => f.requests.length === 1 && f.session.isStreaming);
    // Two steers with the same text as the prompt: identity is their order.
    const first = f.send("steer", "Start"),
      second = f.send("steer", "Start");
    expect(f.requests).toHaveLength(1);
    tool.open();
    await running;
    expect(f.failures).toEqual([]);
    // Pi's own steering mode decides whether both arrive before one request
    // or one per request; either way they follow the tool result, in order.
    const afterTool = JSON.stringify(f.requests[1].input);
    expect(afterTool.indexOf("effect completed")).toBeGreaterThan(-1);
    expect(afterTool.lastIndexOf("Start")).toBeGreaterThan(
      afterTool.indexOf("effect completed"),
    );
    expect(f.written()).toEqual([
      { text: "Start", commands: [f.run] },
      { text: "Start", commands: [first] },
      { text: "Start", commands: [second] },
    ]);
    // The reply ended normally: the early message is the next prompt.
    expect(await f.next()).toBe(early);
    expect(await f.next()).toBeUndefined();
    expect(f.written().at(-1)).toEqual({
      text: "Before the reply",
      commands: [early],
    });
    // A message arriving after the last look is never taken.
    f.send("queue", "Too late");
    expect(f.inputs.next()).toBeUndefined();
    // Several prompts, one final frame: the owner's decoder accepts it.
    expect((await f.final()).selected).toBeTruthy();
    expect(f.failures).toEqual([]);
  } finally {
    await f.close();
  }
});

it("queued messages run one by one after the reply ends, a withdrawn one never, and only a waiting one can be withdrawn", async () => {
  const reply = gate();
  const f = await fixture(async (n) => {
    if (n === 1) await reply.held;
    return response(said(`reply ${n}`));
  });
  try {
    const running = f.prompt("Start");
    await until(() => f.requests.length === 1 && f.session.isStreaming);
    const kept = f.send("queue", "Queued one"),
      dropped = f.send("queue", "Queued two"),
      last = f.send("queue", "Queued three"),
      steered = f.send("steer", "Steered");
    const withdraw = (id) =>
      f.channel.emit("message", { kind: "input-cancel", id });
    withdraw(dropped);
    // Pi already holds the steer, and an unknown message was never waiting.
    withdraw(steered);
    withdraw(randomUUID());
    expect(f.channel.answers.map((answer) => answer.removed)).toEqual([
      true,
      false,
      false,
    ]);
    expect(f.channel.answers[0]).toEqual({
      kind: "input-cancel",
      id: dropped,
      removed: true,
    });
    reply.open();
    await running;
    // The steer was delivered inside the reply; the queued ones were not.
    expect(f.written().map((user) => user.text)).toEqual(["Start", "Steered"]);
    expect(await f.next()).toBe(kept);
    expect(await f.next()).toBe(last);
    expect(await f.next()).toBeUndefined();
    expect(f.written()).toEqual([
      { text: "Start", commands: [f.run] },
      { text: "Steered", commands: [steered] },
      { text: "Queued one", commands: [kept] },
      { text: "Queued three", commands: [last] },
    ]);
    expect(JSON.stringify(f.requests)).not.toContain("Queued two");
    expect((await f.final()).selected).toBeTruthy();
    expect(f.failures).toEqual([]);
  } finally {
    await f.close();
  }
});

it("a reply that fails for good delivers nothing further: Pi's queue is emptied before its post-run look", async () => {
  const reply = gate();
  const f = await fixture(async () => {
    await reply.held;
    return refused();
  });
  try {
    const running = f.prompt("Start");
    await until(() => f.requests.length === 1 && f.session.isStreaming);
    f.send("steer", "Steered");
    f.send("queue", "Queued");
    reply.open();
    await running;
    // Without the recall Pi continues the failed reply into the steer
    // (pi-sdk-baseline pins that); with it there is no second request.
    expect(f.requests).toHaveLength(1);
    expect(f.written().map((user) => user.text)).toEqual(["Start"]);
    expect(f.session.pendingMessageCount).toBe(0);
    // The worker ends the turn here; nothing it held is delivered.
    f.inputs.stop();
    expect(f.inputs.next()).toBeUndefined();
    f.send("queue", "After the failure");
    expect(f.inputs.next()).toBeUndefined();
    expect(f.failures).toEqual([]);
  } finally {
    await f.close();
  }
});

it("a steer Pi had already taken when the turn is stopped is still marked as its own, and nothing follows it", async () => {
  const tool = gate();
  let stop = () => {};
  const f = await fixture(
    (n) => (n === 1 ? response(call) : response(said("never used"))),
    () => tool.held,
    (event) => {
      // The stop lands after Pi took the steer from its queue and before
      // its message is written.
      if (event.type === "message_start" && event.message.role === "user")
        stop();
    },
  );
  try {
    const running = f.prompt("Start");
    await until(() => f.requests.length === 1 && f.session.isStreaming);
    const taken = f.send("steer", "Taken"),
      held = f.send("steer", "Held");
    f.send("queue", "Queued");
    stop = () => {
      stop = () => {};
      f.inputs.stop();
      void f.session.abort();
    };
    tool.open();
    await running;
    expect(f.failures).toEqual([]);
    expect(f.written()).toEqual([
      { text: "Start", commands: [f.run] },
      { text: "Taken", commands: [taken] },
    ]);
    expect(JSON.stringify(f.written())).not.toContain(held);
    expect(f.inputs.next()).toBeUndefined();
    expect(f.session.pendingMessageCount).toBe(0);
  } finally {
    await f.close();
  }
});

it("a stopped reply delivers nothing further, and a malformed or repeated message is a failure", async () => {
  const reply = gate();
  const f = await fixture(async () => {
    await reply.held;
    return response(said("never used"));
  });
  try {
    const running = f.prompt("Start");
    await until(() => f.requests.length === 1 && f.session.isStreaming);
    const steered = f.send("steer", "Steered");
    f.send("queue", "Queued");
    // The worker's stop: nothing further, then the session's own abort.
    f.inputs.stop();
    const aborted = f.session.abort();
    reply.open();
    await aborted;
    await running;
    expect(f.requests).toHaveLength(1);
    expect(f.written().map((user) => user.text)).toEqual(["Start"]);
    expect(f.inputs.next()).toBeUndefined();
    expect(f.failures).toEqual([]);
    // Other traffic on the channel is not this module's.
    f.channel.emit("message", { kind: "auth", id: 1, ok: true });
    f.channel.emit("message", { id: 1, ok: true, text: "tool reply" });
    f.channel.emit("message", "not an object");
    expect(f.failures).toEqual([]);
    for (const broken of [
      { kind: "input", id: steered, mode: "steer", text: "again" },
      { kind: "input", id: randomUUID(), mode: "later", text: "x" },
      { kind: "input", id: randomUUID(), mode: "queue", text: "  " },
      { kind: "input", id: "not-an-id", mode: "queue", text: "x" },
      { kind: "input", id: randomUUID(), mode: "queue", text: "x", extra: 1 },
      { kind: "input-cancel", id: randomUUID(), removed: true },
    ])
      f.channel.emit("message", broken);
    expect(f.failures).toEqual(Array(6).fill("invalid-input"));
  } finally {
    await f.close();
  }
});
