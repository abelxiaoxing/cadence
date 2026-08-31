import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxToolCall,
  type Model,
  type Provider,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { streamSimple as openAIResponsesStreamSimple } from "@earendil-works/pi-ai/api/openai-responses";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { registerWorkflowControl as register } from "../src/index";
import { runtimeForProvider } from "../src/parent-provider";
import { serializeTaskLedgerProjection } from "../src/task-ledger.ts";

type PayloadCallback = NonNullable<SimpleStreamOptions["onPayload"]>;

it("rejects private ledger fields before an openai-responses child request", () => {
  expect(() =>
    serializeTaskLedgerProjection({
      runId: "responses-private-ledger",
      taskId: "responses-private-task",
      rawTranscript: "must never reach the Provider",
    }),
  ).toThrow(/ledger-projection-private-field/u);
});

interface RegisteredTool {
  name: string;
  execute(
    toolCallId: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    context: unknown,
  ): Promise<{ details?: unknown }>;
}

class FakePi {
  readonly tools: RegisteredTool[] = [];
  readonly handlers = new Map<
    string,
    Array<(event: unknown, context: unknown) => unknown>
  >();
  active: string[] = [];

  registerTool(definition: unknown): void {
    this.tools.push(definition as RegisteredTool);
  }

  on(
    event: string,
    handler: (event: unknown, context: unknown) => unknown,
  ): void {
    const handlers = this.handlers.get(event) ?? [];
    handlers.push(handler);
    this.handlers.set(event, handlers);
  }

  async emit(event: string, value: unknown, context: unknown): Promise<void> {
    for (const handler of this.handlers.get(event) ?? []) {
      await handler(value, context);
    }
  }

  getCommands() {
    const root = resolve(".");
    return [
      {
        name: "abel-design",
        source: "prompt",
        sourceInfo: {
          origin: "package",
          baseDir: root,
          path: join(root, "prompts", "abel-design.md"),
        },
      },
    ];
  }

  getActiveTools(): string[] {
    return [...this.active];
  }

  setActiveTools(names: string[]): void {
    this.active = [...names];
  }
}

class TestRegistry {
  readonly registrations: Provider[] = [];
  authCalls = 0;
  private provider: Provider;

  constructor(provider: Provider) {
    this.provider = provider;
  }

  getProvider(id: string): Provider | undefined {
    return id === this.provider.id ? this.provider : undefined;
  }

  registerProvider(provider: Provider): void {
    this.registrations.push(provider);
    this.provider = provider;
  }

  async getApiKeyAndHeaders(_model: Model<string>) {
    this.authCalls++;
    return {
      ok: true as const,
      apiKey: "fresh-child-responses-key",
      headers: {
        "x-fresh-auth": "child",
        "x-compat-test": "local-only",
      },
      env: { RESPONSES_CHILD_TEST: "local" },
    };
  }
}

interface DelegateCall {
  child: boolean;
  context: Context;
  method: "stream" | "streamSimple";
  options: SimpleStreamOptions | undefined;
}

interface FetchRecord {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

const roots: string[] = [];

function declareInheritedRoute(cwd: string): void {
  const directory = join(cwd, ".pi", "cadence");
  mkdirSync(directory, { recursive: true });
  const roles = [
    "design-explorer",
    "implementation-worker",
    "diagnosis-worker",
  ];
  writeFileSync(
    join(directory, "routes.json"),
    `${JSON.stringify({
      routes: {
        inherited: {
          kind: "inherited",
          capabilities: {
            roles,
            dialects: ["openai-responses"],
            contextWindow: 256_000,
            maxTokens: 128_000,
          },
        },
      },
      roles: Object.fromEntries(roles.map((role) => [role, ["inherited"]])),
    })}\n`,
  );
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function modelFor(provider: string): Model<string> {
  return {
    id: "responses-child-model",
    name: "Responses Child Model",
    api: "openai-responses",
    provider,
    baseUrl: "https://local-responses.invalid/v1",
    reasoning: false,
    input: ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: 32_768,
    maxTokens: 2_048,
  };
}

function evidence(id: string) {
  return {
    id,
    role: "design-explorer",
    kind: "evidence",
    packet_id: id,
    module_name: "responses-child",
    scope: ["sentinel.txt"],
    files_read: ["sentinel.txt"],
    evidence: [
      {
        claim: "installed Responses child route completed",
        path: "sentinel.txt",
        line_start: 1,
        line_end: 1,
      },
    ],
    existing_structures: ["Responses child route"],
    existing_conventions: [],
    constraints_discovered: [],
    open_questions: [],
    dependencies: [],
    write_set_hints: [],
    validation_hints: ["local fetch recorder"],
    agents_impact_hints: ["none"],
    risks: [],
    success_criteria_hints: ["one structural submission"],
  };
}

function terminalParentStream(
  model: Model<string>,
  options: SimpleStreamOptions | undefined,
  callbackPayloads: unknown[],
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(async () => {
    try {
      let payload: unknown = { kind: "parent" };
      const transformed = await options?.onPayload?.(payload, model);
      if (transformed !== undefined) payload = transformed;
      callbackPayloads.push(payload);
      const message: AssistantMessage = {
        ...fauxAssistantMessage("parent request completed"),
        api: model.api,
        provider: model.provider,
        model: model.id,
      };
      stream.push({ type: "done", reason: "stop", message });
      stream.end(message);
    } catch (error) {
      const message: AssistantMessage = {
        ...fauxAssistantMessage("", {
          stopReason: "error",
          errorMessage: error instanceof Error ? error.message : String(error),
        }),
        api: model.api,
        provider: model.provider,
        model: model.id,
      };
      stream.push({ type: "error", reason: "error", error: message });
      stream.end(message);
    }
  });
  return stream;
}

function responseEvents(argumentsJson: string): string {
  const item = {
    id: "fc_cadence_submit",
    type: "function_call",
    status: "completed",
    arguments: argumentsJson,
    call_id: "call_cadence_submit",
    name: "abel_submit_result",
  };
  const events = [
    {
      type: "response.created",
      response: {
        id: "resp_cadence_local",
        object: "response",
        status: "in_progress",
        output: [],
      },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { ...item, status: "in_progress", arguments: "" },
    },
    {
      type: "response.output_item.done",
      output_index: 0,
      item,
    },
    {
      type: "response.completed",
      response: {
        id: "resp_cadence_local",
        object: "response",
        status: "completed",
        output: [item],
        usage: {
          input_tokens: 10,
          output_tokens: 4,
          total_tokens: 14,
          input_tokens_details: {
            cached_tokens: 0,
            cache_write_tokens: 0,
          },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      },
    },
  ];
  return `${events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("")}data: [DONE]\n\n`;
}

function request(id: string, runId: string) {
  return {
    stage: "abel-design",
    runId,
    role: "design-explorer",
    id,
    phase: "evidence",
    objective: `Exercise the installed Responses route for ${id}`,
    roots: ["."],
    context: {
      agents: "package-owned only",
      contract: `request-specific-contract-${id}`,
    },
    declared: {
      read: ["sentinel.txt"],
      write: [],
      conflicts: [],
      resources: [],
    },
    output: "evidence",
  };
}

function designRunIdFromContext(context: Context): string {
  const messages = Array.isArray(context.messages) ? context.messages : [];
  for (const message of [...messages].reverse()) {
    const record = message as unknown as Record<string, unknown>;
    if (
      record.role !== "toolResult" ||
      record.toolName !== "abel_dispatch" ||
      !Array.isArray(record.content)
    ) {
      continue;
    }
    for (const part of record.content) {
      if (
        !part ||
        typeof part !== "object" ||
        Array.isArray(part) ||
        Reflect.get(part, "type") !== "text" ||
        typeof Reflect.get(part, "text") !== "string"
      ) {
        continue;
      }
      try {
        const outcome = JSON.parse(Reflect.get(part, "text")) as Record<
          string,
          unknown
        >;
        if (typeof outcome.runId === "string") return outcome.runId;
      } catch {
        // A non-control text result cannot bind the Design packet.
      }
    }
  }
  throw new Error("Design start result is unavailable");
}

describe("installed openai-responses child route", () => {
  it("[RESPONSES-FIRST-DISPATCH:capture-ready] serves the first legal Design packet in the Pi lifecycle", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cadence-responses-design-"));
    roots.push(cwd);
    writeFileSync(join(cwd, "sentinel.txt"), "unchanged\n");
    declareInheritedRoute(cwd);
    const requestId = "responses-first-design-packet";
    const model = modelFor("cadence-lifecycle-responses");
    const calls: Array<{
      child: boolean;
      options: SimpleStreamOptions | undefined;
    }> = [];
    let parentTurn = 0;

    const respond = (
      requestModel: Model<string>,
      context: Context,
      options: SimpleStreamOptions | undefined,
    ): AssistantMessageEventStream => {
      const output = createAssistantMessageEventStream();
      const child =
        context.tools?.some((tool) => tool.name === "abel_submit_result") ??
        false;
      calls.push({ child, options });
      queueMicrotask(async () => {
        try {
          const payload = child
            ? { input: [{ role: "user", content: "bounded child" }] }
            : { instructions: "bounded parent", input: [] };
          await options?.onPayload?.(payload, requestModel);
          let content: Parameters<typeof fauxAssistantMessage>[0];
          if (child) {
            content = fauxToolCall("abel_submit_result", evidence(requestId), {
              id: "submit-first-design-packet",
            });
          } else if (parentTurn === 0) {
            parentTurn += 1;
            content = fauxToolCall(
              "abel_dispatch",
              {
                action: "design",
                request: {
                  operation: "start",
                  requirement: "Exercise the first inherited Design dispatch",
                  operationId: "start-responses-first-design",
                },
              },
              { id: "start-first-design" },
            );
          } else if (parentTurn === 1) {
            parentTurn += 1;
            content = fauxToolCall(
              "abel_dispatch",
              {
                action: "run",
                request: request(requestId, designRunIdFromContext(context)),
              },
              { id: "dispatch-first-design-packet" },
            );
          } else {
            content = "parent completed";
          }
          const stopReason = typeof content === "string" ? "stop" : "toolUse";
          const message: AssistantMessage = {
            ...fauxAssistantMessage(content, {
              stopReason,
            }),
            api: requestModel.api,
            provider: requestModel.provider,
            model: requestModel.id,
          };
          output.push({ type: "done", reason: stopReason, message });
          output.end(message);
        } catch (error) {
          const message: AssistantMessage = {
            ...fauxAssistantMessage("", {
              stopReason: "error",
              errorMessage:
                error instanceof Error ? error.message : String(error),
            }),
            api: requestModel.api,
            provider: requestModel.provider,
            model: requestModel.id,
          };
          output.push({ type: "error", reason: "error", error: message });
          output.end(message);
        }
      });
      return output;
    };

    const delegate = {
      id: model.provider,
      name: "Lifecycle Responses Provider",
      baseUrl: model.baseUrl,
      auth: {
        apiKey: {
          name: "Lifecycle Responses auth",
          resolve: async () => ({ auth: { apiKey: "test-only-key" } }),
        },
      },
      getModels: () => [model],
      stream: respond,
      streamSimple: respond,
    } as unknown as Provider;
    const modelRuntime = await runtimeForProvider(delegate);
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false, provider: { maxRetries: 0 } },
    });
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir: join(cwd, "agent"),
      settingsManager,
      additionalExtensionPaths: [join(import.meta.dirname, "..")],
      noThemes: true,
      noContextFiles: true,
    });
    await resourceLoader.reload();
    const { session } = await createAgentSession({
      cwd,
      modelRuntime,
      model,
      resourceLoader,
      sessionManager: SessionManager.inMemory(cwd),
      settingsManager,
    });
    const ui = { setWidget() {}, setStatus() {} };

    try {
      await session.bindExtensions({ mode: "tui", uiContext: ui as never });
      await session.prompt("/abel-design first inherited dispatch");

      const toolResult = session.state.messages.findLast(
        (message) =>
          message.role === "toolResult" && message.toolName === "abel_dispatch",
      );
      expect(toolResult?.role).toBe("toolResult");
      if (toolResult?.role !== "toolResult") {
        throw new Error("first Implement dispatch did not execute");
      }
      const text = toolResult.content.find((part) => part.type === "text");
      expect(text?.type).toBe("text");
      const outcome = JSON.parse(text?.type === "text" ? text.text : "null");
      expect(outcome).toMatchObject({
        ok: true,
        action: "run",
        result: evidence(requestId),
      });
      expect(calls.filter((call) => call.child)).toHaveLength(1);
      expect(calls.find((call) => call.child)?.options?.maxRetries).toBe(0);
    } finally {
      session.dispose();
    }
  });

  it("uses the captured original delegate once with fresh auth, five tools, transformed request data, and no resources or output cap", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cadence-responses-child-"));
    roots.push(cwd);
    writeFileSync(join(cwd, "sentinel.txt"), "unchanged\n");
    declareInheritedRoute(cwd);
    const beforeFiles = readdirSync(cwd).sort();
    const requestId = "responses-child-request";
    const model = modelFor("cadence-local-responses");
    const fetchRecords: FetchRecord[] = [];
    const delegateCalls: DelegateCall[] = [];
    const parentPayloads: unknown[] = [];
    const parentCallbackKinds: string[] = [];
    const capturedContextKeys: string[][] = [];

    const fetchRecorder: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      const text = await request.clone().text();
      fetchRecords.push({
        url: request.url,
        headers: new Headers(request.headers),
        body: JSON.parse(text) as Record<string, unknown>,
      });
      return new Response(responseEvents(JSON.stringify(evidence(requestId))), {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "x-request-id": "local-request",
        },
      });
    };

    const invoke = (
      method: DelegateCall["method"],
      requestModel: Model<string>,
      context: Context,
      options: SimpleStreamOptions | undefined,
    ): AssistantMessageEventStream => {
      const child = (context.tools?.length ?? 0) > 0;
      delegateCalls.push({ child, context, method, options });
      if (!child) {
        return terminalParentStream(requestModel, options, parentPayloads);
      }
      capturedContextKeys.push(Object.keys(context).sort());
      return openAIResponsesStreamSimple(
        requestModel as Model<"openai-responses">,
        context,
        { ...options, fetch: fetchRecorder } as never,
      );
    };

    const delegate = {
      id: model.provider,
      name: "Local installed Responses delegate",
      baseUrl: model.baseUrl,
      auth: {
        apiKey: {
          name: "Responses integration auth",
          resolve: async () => ({
            auth: { apiKey: "provider-default-key" },
          }),
        },
      },
      getModels: () => [model],
      stream(
        requestModel: Model<string>,
        context: Context,
        options?: SimpleStreamOptions,
      ) {
        return invoke("stream", requestModel, context, options);
      },
      streamSimple(
        requestModel: Model<string>,
        context: Context,
        options?: SimpleStreamOptions,
      ) {
        return invoke("streamSimple", requestModel, context, options);
      },
    } as unknown as Provider;

    const registry = new TestRegistry(delegate);
    const pi = new FakePi();
    const context = {
      cwd,
      mode: "rpc",
      model,
      modelRegistry: registry,
      sessionManager: { getSessionId: () => "responses-parent-session" },
    };
    register(pi as never);

    await pi.emit(
      "session_start",
      { type: "session_start", reason: "startup" },
      context,
    );
    await pi.emit(
      "input",
      { type: "input", text: "/abel-design responses" },
      context,
    );
    await pi.emit(
      "before_agent_start",
      {
        type: "before_agent_start",
        prompt: [
          "<abel-request>responses child</abel-request>",
          "<!-- ABEL:PROMPT:abel-design -->",
        ].join("\n"),
        systemPrompt: "parent system",
        systemPromptOptions: {},
      },
      context,
    );

    const parentCallback: PayloadCallback = (payload) => {
      const object =
        typeof payload === "object" &&
        payload !== null &&
        !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : {};
      if (!Array.isArray(object.input)) {
        parentCallbackKinds.push("parent");
        return undefined;
      }
      parentCallbackKinds.push("child");
      return {
        ...object,
        instructions: `compat-instructions:${requestId}`,
        input: [
          {
            role: "developer",
            content: `compat-input:${requestId}`,
          },
          ...object.input,
        ],
        max_output_tokens: 777,
      };
    };

    const installed = registry.getProvider(model.provider);
    expect(installed).toBeDefined();
    const parentStream = installed!.stream(model, { messages: [] }, {
      apiKey: "stale-parent-key",
      onPayload: parentCallback,
    } as never);
    for await (const _event of parentStream) {
      // Successful completion arms the exact model capture.
    }
    expect((await parentStream.result()).stopReason).toBe("stop");
    await Promise.resolve();
    await Promise.resolve();

    const tool = pi.tools.find(
      (candidate) => candidate.name === "abel_dispatch",
    );
    expect(tool).toBeDefined();
    const started = await tool!.execute(
      "responses-design-start",
      {
        action: "design",
        request: {
          operation: "start",
          change: "responses-child",
          operationId: "start-responses-child",
        },
      },
      undefined,
      undefined,
      context,
    );
    const runId = Reflect.get(
      (started.details ?? {}) as Record<string, unknown>,
      "runId",
    );
    expect(runId).toEqual(expect.any(String));
    if (typeof runId !== "string") throw new Error("Design run did not start");
    const rendered = await tool!.execute(
      "responses-dispatch",
      { action: "run", request: request(requestId, runId) },
      undefined,
      undefined,
      context,
    );
    const result = rendered.details as { ok: boolean; result?: unknown };
    expect(result.ok).toBe(true);
    expect(result.result).toEqual(evidence(requestId));

    expect(registry.registrations).toHaveLength(1);
    expect(parentPayloads).toHaveLength(1);
    expect(parentCallbackKinds).toEqual(["parent", "child"]);
    expect(registry.authCalls).toBe(1);

    const childCalls = delegateCalls.filter((call) => call.child);
    expect(childCalls).toHaveLength(1);
    expect(childCalls[0]?.method).toBe("streamSimple");
    expect(childCalls[0]?.options?.apiKey).toBe("fresh-child-responses-key");
    expect(childCalls[0]?.options?.maxRetries).toBe(0);
    expect(childCalls[0]?.context.tools?.map((tool) => tool.name)).toEqual([
      "read",
      "grep",
      "find",
      "ls",
      "abel_submit_result",
    ]);
    expect(capturedContextKeys).toEqual([
      ["messages", "systemPrompt", "tools"],
    ]);
    expect("resources" in childCalls[0]!.context).toBe(false);

    expect(fetchRecords).toHaveLength(1);
    const sent = fetchRecords[0]!;
    expect(sent.url).toBe("https://local-responses.invalid/v1/responses");
    expect(sent.headers.get("authorization")).toBe(
      "Bearer fresh-child-responses-key",
    );
    expect(sent.headers.get("x-fresh-auth")).toBe("child");
    expect(sent.body.instructions).toBe(`compat-instructions:${requestId}`);
    expect((sent.body.input as unknown[])[0]).toEqual({
      role: "developer",
      content: `compat-input:${requestId}`,
    });
    expect(sent.body).not.toHaveProperty("max_output_tokens");
    expect(sent.body).not.toHaveProperty("resources");
    expect(
      (sent.body.tools as Array<{ name: string }>).map((tool) => tool.name),
    ).toEqual(["read", "grep", "find", "ls", "abel_submit_result"]);

    await pi.emit(
      "session_shutdown",
      { type: "session_shutdown", reason: "quit" },
      context,
    );
    expect(readdirSync(cwd).sort()).toEqual(beforeFiles);
  });
});
