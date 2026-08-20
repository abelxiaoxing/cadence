import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
import { afterEach, describe, expect, it } from "vitest";
import register from "../src/index";

type PayloadCallback = NonNullable<SimpleStreamOptions["onPayload"]>;

interface ProviderCall {
  child: boolean;
  context: Context;
  method: "stream" | "streamSimple";
  options: SimpleStreamOptions | undefined;
}

interface LocalProvider {
  provider: Provider;
  calls: ProviderCall[];
  childSends: unknown[];
  parentSends: unknown[];
}

interface DispatchResult {
  ok: boolean;
  error?: string;
}

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

class TestRegistry {
  readonly registrations: Provider[] = [];
  authCalls = 0;
  authBaseUrl: string | undefined;
  private readonly providers = new Map<string, Provider>();

  add(provider: Provider): void {
    this.providers.set(provider.id, provider);
  }

  replace(provider: Provider): void {
    this.providers.set(provider.id, provider);
  }

  getProvider(id: string): Provider | undefined {
    return this.providers.get(id);
  }

  registerProvider(provider: Provider): void {
    this.registrations.push(provider);
    this.providers.set(provider.id, provider);
  }

  async getApiKeyAndHeaders(_model: Model<string>) {
    this.authCalls++;
    return {
      ok: true as const,
      apiKey: `fresh-child-key-${this.authCalls}`,
      headers: { "x-fresh-auth": `${this.authCalls}` },
      env: { CADENCE_PHASE: `${this.authCalls}` },
      ...(this.authBaseUrl ? { baseUrl: this.authBaseUrl } : {}),
    };
  }
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
        name: "abel-implement",
        source: "prompt",
        sourceInfo: {
          origin: "package",
          baseDir: root,
          path: join(root, "prompts", "abel-implement.md"),
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

interface HarnessContext {
  cwd: string;
  mode: "rpc";
  model: Model<string>;
  modelRegistry: TestRegistry;
  sessionManager: { getSessionId(): string };
}

interface Harness {
  cwd: string;
  pi: FakePi;
  registry: TestRegistry;
  context: HarnessContext;
  original: LocalProvider;
  setSessionId(id: string): void;
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function modelFor(
  provider: string,
  id = `${provider}-model`,
  baseUrl = `https://${provider}.local.invalid/v1`,
): Model<string> {
  return {
    id,
    name: id,
    api: "openai-responses",
    provider,
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: 16_384,
    maxTokens: 2_048,
  };
}

function evidence(id: string) {
  return {
    id,
    role: "design-explorer",
    kind: "evidence",
    conclusions: ["bounded child completed"],
    citations: [{ path: "sentinel.txt", lines: "1" }],
    constraints: [],
    dependencies: [],
    risks: [],
    blockingQuestions: [],
    hints: {
      writeSet: [],
      verification: "none",
      agentsImpact: "none",
    },
  };
}

function assistantMessage(
  model: Model<string>,
  content: Parameters<typeof fauxAssistantMessage>[0],
  stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
  return {
    ...fauxAssistantMessage(content, { stopReason }),
    api: model.api,
    provider: model.provider,
    model: model.id,
    stopReason,
  };
}

function localProvider(
  model: Model<string>,
  submittedId: () => string,
): LocalProvider {
  const calls: ProviderCall[] = [];
  const childSends: unknown[] = [];
  const parentSends: unknown[] = [];

  const invoke = (
    method: ProviderCall["method"],
    requestModel: Model<string>,
    context: Context,
    options: SimpleStreamOptions | undefined,
  ): AssistantMessageEventStream => {
    const output = createAssistantMessageEventStream();
    const child = (context.tools?.length ?? 0) > 0;
    calls.push({ child, context, method, options });
    queueMicrotask(async () => {
      try {
        let payload: unknown = child
          ? {
              kind: "child",
              input: [{ role: "user", content: submittedId() }],
              max_output_tokens: 2_048,
            }
          : { kind: "parent", input: [] };
        const transformed = await options?.onPayload?.(payload, requestModel);
        if (transformed !== undefined) payload = transformed;
        if (child) childSends.push(payload);
        else parentSends.push(payload);
        const message = child
          ? assistantMessage(
              requestModel,
              fauxToolCall("abel_submit_result", evidence(submittedId()), {
                id: `submit-${submittedId()}`,
              }),
              "toolUse",
            )
          : assistantMessage(requestModel, "parent completed");
        output.push({ type: "done", reason: "stop", message });
        output.end(message);
      } catch (error) {
        const message = {
          ...assistantMessage(requestModel, "", "error"),
          errorMessage: error instanceof Error ? error.message : String(error),
        };
        output.push({ type: "error", reason: "error", error: message });
        output.end(message);
      }
    });
    return output;
  };

  const provider = {
    id: model.provider,
    name: `Local ${model.provider}`,
    baseUrl: model.baseUrl,
    auth: {
      apiKey: {
        name: "Local lifecycle auth",
        resolve: async () => ({ auth: { apiKey: "provider-default-key" } }),
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

  return { provider, calls, childSends, parentSends };
}

function makeHarness(tag: string): Harness {
  const cwd = mkdtempSync(join(tmpdir(), `cadence-payload-${tag}-`));
  roots.push(cwd);
  writeFileSync(join(cwd, "sentinel.txt"), "unchanged\n");
  const pi = new FakePi();
  const registry = new TestRegistry();
  let submittedId = "unset";
  const model = modelFor(`cadence-${tag}`);
  const original = localProvider(model, () => submittedId);
  registry.add(original.provider);
  let sessionId = `session-${tag}-1`;
  const context: HarnessContext = {
    cwd,
    mode: "rpc",
    model,
    modelRegistry: registry,
    sessionManager: { getSessionId: () => sessionId },
  };
  register(pi as never);
  Object.defineProperty(context, "submittedId", {
    set(value: string) {
      submittedId = value;
    },
  });
  return {
    cwd,
    pi,
    registry,
    context,
    original,
    setSessionId(id: string) {
      sessionId = id;
    },
  };
}

async function start(
  harness: Harness,
  reason: "startup" | "reload" | "new" = "startup",
): Promise<void> {
  await harness.pi.emit(
    "session_start",
    { type: "session_start", reason },
    harness.context,
  );
}

const expandedPrompt = [
  "<abel-request>exercise the approved lifecycle</abel-request>",
  "<!-- ABEL:PROMPT:abel-implement -->",
].join("\n");

async function beforeAgent(harness: Harness): Promise<void> {
  await harness.pi.emit(
    "before_agent_start",
    {
      type: "before_agent_start",
      prompt: expandedPrompt,
      systemPrompt: "system",
      systemPromptOptions: {},
    },
    harness.context,
  );
}

async function activate(harness: Harness): Promise<void> {
  await harness.pi.emit(
    "input",
    { type: "input", text: "/abel-implement lifecycle" },
    harness.context,
  );
  await beforeAgent(harness);
}

async function arm(
  harness: Harness,
  callback: PayloadCallback,
  method: "stream" | "streamSimple" = "streamSimple",
  requestModel: Model<string> = harness.context.model,
): Promise<void> {
  const provider = harness.registry.getProvider(harness.context.model.provider);
  expect(provider).toBeDefined();
  const stream =
    method === "stream"
      ? provider!.stream(requestModel, { messages: [] }, {
          apiKey: "old-parent-key",
          onPayload: callback,
        } as never)
      : provider!.streamSimple(
          requestModel,
          { messages: [] },
          {
            apiKey: "old-parent-key",
            onPayload: callback,
          },
        );
  for await (const _event of stream) {
    // Successful exhaustion is the public capture commit boundary.
  }
  const result = await stream.result();
  expect(result.stopReason).toBe("stop");
  await Promise.resolve();
  await Promise.resolve();
}

function request(id: string) {
  return {
    stage: "abel-design",
    role: "design-explorer",
    id,
    phase: "evidence",
    objective: `Return request-specific evidence for ${id}`,
    roots: ["."],
    context: { agents: "package-only", contract: `approved-${id}` },
    declared: {
      read: ["sentinel.txt"],
      write: [],
      conflicts: [],
      resources: [],
    },
    output: "evidence",
  };
}

function dispatchTool(harness: Harness): RegisteredTool {
  const tool = harness.pi.tools.find((item) => item.name === "abel_dispatch");
  expect(tool).toBeDefined();
  return tool!;
}

async function dispatch(harness: Harness, id: string): Promise<DispatchResult> {
  Reflect.set(harness.context, "submittedId", id);
  const result = await dispatchTool(harness).execute(
    `call-${id}`,
    { action: "run", request: request(id) },
    undefined,
    undefined,
    harness.context,
  );
  return result.details as DispatchResult;
}

async function finish(harness: Harness): Promise<DispatchResult> {
  const result = await dispatchTool(harness).execute(
    "call-finish",
    { action: "finish" },
    undefined,
    undefined,
    harness.context,
  );
  return result.details as DispatchResult;
}

function isChildPayload(payload: unknown): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    !Array.isArray(payload) &&
    Reflect.get(payload, "kind") === "child"
  );
}

describe("public parent payload lifecycle", () => {
  it("begins a generation, installs idempotently, and invalidates on model_select", async () => {
    const harness = makeHarness("install");
    await start(harness);
    expect(harness.registry.registrations).toHaveLength(1);

    await activate(harness);
    await beforeAgent(harness);
    expect(harness.registry.registrations).toHaveLength(3);

    await arm(harness, () => undefined, "stream");
    expect(harness.original.calls.filter((call) => !call.child)).toHaveLength(
      1,
    );

    const nextModel = modelFor("cadence-install-next");
    let nextId = "model-select-child";
    const next = localProvider(nextModel, () => nextId);
    harness.registry.add(next.provider);
    const previousModel = harness.context.model;
    harness.context.model = nextModel;
    await harness.pi.emit(
      "model_select",
      {
        type: "model_select",
        model: nextModel,
        previousModel,
        source: "set",
      },
      harness.context,
    );
    expect(harness.registry.registrations).toHaveLength(4);
    expect(harness.registry.registrations.at(-1)?.id).toBe(nextModel.provider);

    nextId = "model-select-missing-capture";
    const sent = next.childSends.length;
    const result = await dispatch(harness, nextId);
    expect(result.ok).toBe(false);
    expect(next.childSends).toHaveLength(sent);
  });

  it.each(["missing", "stale", "model-mismatch"] as const)(
    "rejects a %s capture before a child send",
    async (scenario) => {
      const harness = makeHarness(`reject-${scenario}`);
      await start(harness);
      await activate(harness);
      if (scenario !== "missing") {
        await arm(harness, () => undefined);
      }
      if (scenario === "stale") {
        harness.setSessionId("replacement-session");
        await start(harness, "reload");
        await activate(harness);
      } else if (scenario === "model-mismatch") {
        harness.context.model = {
          ...harness.context.model,
          baseUrl: `${harness.context.model.baseUrl}/changed`,
        };
      }
      const sent = harness.original.childSends.length;
      const result = await dispatch(harness, `capture-${scenario}`);
      expect(result.ok).toBe(false);
      expect(harness.original.childSends).toHaveLength(sent);
    },
  );

  it("arms successfully, preserves one original delegate, fresh auth, five tools, zero resources, and no persistence", async () => {
    const harness = makeHarness("success");
    const beforeFiles = readdirSync(harness.cwd).sort();
    await start(harness);
    await activate(harness);
    const callbackKinds: string[] = [];
    await arm(harness, (payload) => {
      const kind = isChildPayload(payload) ? "child" : "parent";
      callbackKinds.push(kind);
      if (kind === "child") {
        return {
          ...(payload as Record<string, unknown>),
          instructions: "compat-instructions:success",
          input: [{ request: "success-specific" }],
          max_output_tokens: 999,
        };
      }
      return undefined;
    });

    const result = await dispatch(harness, "success");
    expect(result.ok).toBe(true);
    expect(callbackKinds).toEqual(["parent", "child"]);
    const childCalls = harness.original.calls.filter((call) => call.child);
    expect(childCalls).toHaveLength(1);
    expect(childCalls[0]?.method).toBe("streamSimple");
    expect(childCalls[0]?.options?.apiKey).toBe("fresh-child-key-1");
    expect(childCalls[0]?.options?.maxRetries).toBe(0);
    expect(childCalls[0]?.context.tools?.map((tool) => tool.name)).toEqual([
      "read",
      "grep",
      "find",
      "ls",
      "abel_submit_result",
    ]);
    expect("resources" in childCalls[0]!.context).toBe(false);
    expect(harness.original.childSends).toHaveLength(1);
    expect(harness.original.childSends[0]).toMatchObject({
      instructions: "compat-instructions:success",
      input: [{ request: "success-specific" }],
    });
    expect(
      Reflect.has(
        harness.original.childSends[0] as Record<string, unknown>,
        "max_output_tokens",
      ),
    ).toBe(false);
    expect(readdirSync(harness.cwd).sort()).toEqual(beforeFiles);
  });

  it("matches capture and child payload composition to the fresh-auth base URL", async () => {
    const harness = makeHarness("auth-base-url");
    const effectiveBaseUrl = "https://oauth-gateway.local.invalid/v1";
    harness.registry.authBaseUrl = effectiveBaseUrl;
    await start(harness);
    await activate(harness);
    await arm(
      harness,
      (payload) =>
        isChildPayload(payload)
          ? {
              ...(payload as Record<string, unknown>),
              instructions: "effective-base-url-capture",
            }
          : undefined,
      "streamSimple",
      { ...harness.context.model, baseUrl: effectiveBaseUrl },
    );

    const result = await dispatch(harness, "auth-base-url");

    expect(result.ok).toBe(true);
    expect(harness.registry.authCalls).toBe(1);
    expect(harness.original.childSends).toHaveLength(1);
    expect(harness.original.childSends[0]).toMatchObject({
      instructions: "effective-base-url-capture",
    });
  });

  it("recaptures a replacement Provider instead of reusing or wrapping the old delegate", async () => {
    const harness = makeHarness("recapture");
    await start(harness);
    await activate(harness);
    await arm(harness, (payload) =>
      isChildPayload(payload)
        ? {
            ...(payload as Record<string, unknown>),
            instructions: "old-capture",
          }
        : undefined,
    );

    let replacementId = "replacement-child";
    const replacement = localProvider(
      harness.context.model,
      () => replacementId,
    );
    harness.registry.replace(replacement.provider);
    await beforeAgent(harness);
    await arm(harness, (payload) =>
      isChildPayload(payload)
        ? {
            ...(payload as Record<string, unknown>),
            instructions: "replacement-capture",
          }
        : undefined,
    );

    replacementId = "replacement-child";
    const result = await dispatch(harness, replacementId);
    expect(result.ok).toBe(true);
    expect(harness.original.calls.filter((call) => call.child)).toHaveLength(0);
    expect(replacement.calls.filter((call) => call.child)).toHaveLength(1);
    expect(replacement.childSends[0]).toMatchObject({
      instructions: "replacement-capture",
    });
  });

  it.each(["rejected", "unsafe"] as const)(
    "performs zero sends when the captured callback is %s",
    async (scenario) => {
      const harness = makeHarness(`callback-${scenario}`);
      await start(harness);
      await activate(harness);
      await arm(harness, async (payload) => {
        if (!isChildPayload(payload)) return undefined;
        if (scenario === "rejected") {
          throw new Error("compat callback rejected");
        }
        return ["unsafe"];
      });
      const sent = harness.original.childSends.length;
      const result = await dispatch(harness, `callback-${scenario}`);
      expect(result.ok).toBe(false);
      expect(harness.original.childSends).toHaveLength(sent);
    },
  );

  it("[PAYLOAD-LIFECYCLE:stage-reactivation] rebuilds the bridge generation after finish", async () => {
    const harness = makeHarness("stage-reactivation");
    await start(harness);
    await activate(harness);
    await arm(harness, () => undefined);
    expect((await finish(harness)).ok).toBe(true);

    await activate(harness);
    await arm(harness, (payload) =>
      isChildPayload(payload)
        ? {
            ...(payload as Record<string, unknown>),
            instructions: "recaptured-after-finish",
          }
        : undefined,
    );

    const result = await dispatch(harness, "stage-reactivation");
    expect(result.ok).toBe(true);
    expect(harness.original.childSends.at(-1)).toMatchObject({
      instructions: "recaptured-after-finish",
    });
  });

  it.each(["finish", "reload", "replacement", "shutdown"] as const)(
    "clears the process-local capture on %s",
    async (boundary) => {
      const harness = makeHarness(`clear-${boundary}`);
      await start(harness);
      await activate(harness);
      await arm(harness, (payload) =>
        isChildPayload(payload)
          ? {
              ...(payload as Record<string, unknown>),
              instructions: `must-not-survive-${boundary}`,
            }
          : undefined,
      );

      if (boundary === "finish") {
        expect((await finish(harness)).ok).toBe(true);
      } else if (boundary === "shutdown") {
        await harness.pi.emit(
          "session_shutdown",
          { type: "session_shutdown", reason: "quit" },
          harness.context,
        );
      } else {
        harness.setSessionId(`session-after-${boundary}`);
        await start(harness, boundary === "reload" ? "reload" : "new");
      }

      await activate(harness);
      const sent = harness.original.childSends.length;
      const result = await dispatch(harness, `after-${boundary}`);
      expect(result.ok).toBe(false);
      expect(harness.original.childSends).toHaveLength(sent);
    },
  );
});
