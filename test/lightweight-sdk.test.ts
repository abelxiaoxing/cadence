import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { zstdDecompressSync } from "node:zlib";
import {
  InMemoryCredentialStore,
  InMemoryModelsStore,
} from "@earendil-works/pi-ai";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { runProcess, safeChildEnv } from "../src/subagent-process.ts";

// Real native SDK integration budget, not a retimed retired certification test.
for (const lane of [
  "key-tool",
  "headers-only-readonly",
  "diagnosis-readonly",
  "planner-readonly",
  "oauth-only-api",
  "resolved-baseurl-null",
  "azure-env",
] as const) {
  it(`actual SDK stdin/native resolver: ${lane}`, async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cadence-lw-sdk-"));
    const key =
      lane === "oauth-only-api"
        ? `e30.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "fixture-account" } })).toString("base64url")}.fixture`
        : "!fabricated-key-$NO_EXPANSION";
    const literal = "!fabricated-header-$NO_EXPANSION";
    const requests: { body: any; headers: any; path: string | undefined }[] =
      [];
    let serverError: unknown;
    const server = createServer(async (req, res) => {
      if (req.method !== "POST") {
        res.writeHead(400);
        res.end();
        return;
      }
      try {
        let bytes = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          bytes += chunk.length;
          chunks.push(chunk);
          if (bytes > 128 * 1024) throw new Error("Fixture request bound");
        }
        const data = Buffer.concat(chunks);
        const body = JSON.parse(
          (req.headers["content-encoding"] === "zstd"
            ? zstdDecompressSync(data)
            : data
          ).toString("utf8"),
        );
        requests.push({ body, headers: req.headers, path: req.url });
        if (requests.length > 2) throw new Error("Unexpected retry");
        res.writeHead(200, {
          "content-type": "text/event-stream",
          connection: "close",
        });
        const send = (event: any) =>
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        if (lane === "oauth-only-api" || lane === "azure-env") {
          const item = {
            id: "message_fixture",
            type: "message",
            role: "assistant",
            content: [
              { type: "output_text", text: "WIRE_OK", annotations: [] },
            ],
            status: "completed",
          };
          send({
            type: "response.created",
            response: {
              id: "response_fixture",
              status: "in_progress",
              output: [],
            },
          });
          send({
            type: "response.output_item.added",
            output_index: 0,
            item: { ...item, content: [] },
          });
          send({
            type: "response.output_text.delta",
            output_index: 0,
            content_index: 0,
            delta: "WIRE_OK",
          });
          send({ type: "response.output_item.done", output_index: 0, item });
          send({
            type: "response.completed",
            response: {
              id: "response_fixture",
              status: "completed",
              output: [item],
              usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
            },
          });
          res.end();
        } else {
          const emit = (delta: any, finish_reason: string | null = null) =>
            send({
              id: "fixture",
              object: "chat.completion.chunk",
              created: 1,
              model: body.model,
              choices: [{ index: 0, delta, finish_reason }],
            });
          if (lane === "key-tool" && requests.length === 1) {
            emit({
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: "write_fixture",
                  type: "function",
                  function: {
                    name: "write",
                    arguments: JSON.stringify({
                      path: "fixture.txt",
                      content: "fixture-only",
                    }),
                  },
                },
              ],
            });
            emit({}, "tool_calls");
          } else {
            emit({ role: "assistant", content: "WIRE_OK" });
            emit({}, "stop");
          }
          res.end("data: [DONE]\n\n");
        }
      } catch (error) {
        serverError = error;
        res.end();
      }
    });
    server.on("upgrade", (_req, socket) => {
      socket.end(
        "HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Server unavailable");
      const baseUrl = `http://127.0.0.1:${address.port}/exact/v1`;
      const provider =
        lane === "oauth-only-api" ? "openai-codex" : "fabricated-local";
      const api =
        lane === "oauth-only-api"
          ? "openai-codex-responses"
          : lane === "azure-env"
            ? "azure-openai-responses"
            : "openai-completions";
      const credentials = new InMemoryCredentialStore();
      if (lane === "oauth-only-api")
        await credentials.modify(provider, async () => ({
          type: "oauth",
          access: key,
          refresh: "fabricated-never-refreshed",
          expires: Date.now() + 3600000,
        }));
      if (lane === "azure-env")
        await credentials.modify(provider, async () => ({
          type: "api_key",
          key,
          env: {
            AZURE_OPENAI_BASE_URL: baseUrl,
            AZURE_OPENAI_API_VERSION: "fixture-version",
          },
        }));
      const runtime = await ModelRuntime.create({
        credentials,
        modelsStore: new InMemoryModelsStore(),
        modelsPath: null,
        refreshOnCreate: false,
        allowModelNetwork: false,
      });
      runtime.registerProvider(provider, {
        baseUrl:
          lane === "azure-env" ? "http://127.0.0.1:1/must-not-use" : baseUrl,
        api,
        headers: {
          "X-Literal": "$!fabricated-header-$$NO_EXPANSION",
          ...(lane === "headers-only-readonly"
            ? { Authorization: "Bearer fabricated-header-only" }
            : {}),
        },
        models: [
          {
            id: "fixture-model",
            name: "Fixture",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 8192,
            maxTokens: 128,
            compat: {
              supportsDeveloperRole: false,
              maxTokensField: "max_tokens",
            },
          },
        ],
      });
      if (
        lane !== "oauth-only-api" &&
        lane !== "headers-only-readonly" &&
        lane !== "azure-env"
      )
        await runtime.setRuntimeApiKey(provider, key);
      const registry = new ModelRegistry(runtime);
      const model = registry.find(provider, "fixture-model");
      if (!model) throw new Error("Model missing");
      const auth = await registry.getApiKeyAndHeaders(model);
      expect(auth.ok).toBe(true);
      if (!auth.ok) throw new Error("Fixture auth unresolved");
      expect(auth.headers?.["X-Literal"]).toBe(literal);
      if (lane !== "headers-only-readonly") expect(auth.apiKey).toBe(key);
      if (lane === "resolved-baseurl-null") {
        // Exercise the literal public envelope contract without config interpolation.
        // Other lanes obtain the envelope entirely from the actual parent registry.
        model.baseUrl = "http://127.0.0.1:1/must-not-use";
        model.headers = { "X-Model-Only": "must-not-transmit" };
        auth.baseUrl = baseUrl;
        auth.headers = { ...auth.headers, Authorization: null };
      }
      if (lane === "azure-env") {
        expect(auth.env?.AZURE_OPENAI_BASE_URL).toBe(baseUrl);
        expect(auth.env?.AZURE_OPENAI_API_VERSION).toBe("fixture-version");
      }
      const wire = JSON.stringify({
        cwd,
        model,
        auth,
        kind:
          lane === "key-tool"
            ? "code"
            : lane === "diagnosis-readonly"
              ? "diagnosis"
              : "research",
        thinkingLevel: "off",
        instructions:
          "Synthetic fixture only. Use write only when requested; no shell or external resources.",
        prompt:
          lane === "key-tool"
            ? "Write fixture.txt containing fixture-only, then answer WIRE_OK."
            : "Answer WIRE_OK. Do not call tools.",
      });
      const result = await runProcess({
        command: process.execPath,
        args: [
          "--import",
          new URL("./helpers/lightweight-sdk-guard.mjs", import.meta.url).href,
          fileURLToPath(new URL("../src/sdk-worker.mjs", import.meta.url)),
        ],
        cwd,
        timeoutMs: 15000,
        signal: new AbortController().signal,
        input: wire,
        protocol: true,
        secrets: [key, literal],
      });
      expect(serverError).toBeUndefined();
      expect(result, JSON.stringify(result)).toMatchObject({
        outcome: "completed",
        closed: true,
        exitCode: 0,
        text: "WIRE_OK",
      });
      expect(result.output).toBe(""); // Successful stderr/protocol remains unchanged.
      expect(result.output).not.toContain(key);
      expect(result.output).not.toContain(literal);
      expect(requests).toHaveLength(lane === "key-tool" ? 2 : 1);
      for (const request of requests) {
        expect(request.body.model).toBe("fixture-model");
        expect(request.headers["x-literal"]).toBe(literal);
        if (lane === "resolved-baseurl-null") {
          expect(request.headers.authorization).toBeUndefined();
          expect(request.headers["x-model-only"]).toBeUndefined();
        }
        if (lane === "azure-env") expect(request.headers["api-key"]).toBe(key);
        else
          expect(request.headers.authorization).toBe(
            lane === "resolved-baseurl-null"
              ? undefined
              : lane === "headers-only-readonly"
                ? "Bearer fabricated-header-only"
                : `Bearer ${key}`,
          );
        expect(request.path).toBe(
          lane === "oauth-only-api"
            ? "/exact/v1/codex/responses"
            : lane === "azure-env"
              ? "/exact/v1/responses?api-version=fixture-version"
              : "/exact/v1/chat/completions",
        );
        const names = request.body.tools.map(
          (tool: any) => tool.function?.name ?? tool.name,
        );
        expect(names).toEqual(
          lane === "key-tool"
            ? ["read", "grep", "find", "ls", "write", "edit", "bash"]
            : ["read", "grep", "find", "ls"],
        );
      }
      if (lane === "key-tool") {
        expect(readFileSync(join(cwd, "fixture.txt"), "utf8")).toBe(
          "fixture-only",
        );
        expect(readdirSync(cwd)).toEqual(["fixture.txt"]);
        expect(
          requests[1].body.messages.some(
            (message: any) => message.role === "tool",
          ),
        ).toBe(true);
      } else expect(readdirSync(cwd)).toEqual([]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }, 20000);
}

const genericFailure = "SDK worker failed or returned an incomplete result.\n";
const diagnosticKeys = [
  "stage",
  "class",
  "outcome",
  "sdkEvents",
  "inputBytes",
  "modelOutputBytes",
  "protocolBytes",
  "terminalStopReason",
  "preflight",
  "requestPrepared",
  "actualResponseStatus",
  "cleanupFailures",
];
const diagnostic = (stderr: string) => {
  const lines = stderr.split("\n");
  expect(lines).toHaveLength(3);
  expect(`${lines[1]}\n`).toBe(genericFailure);
  expect(Buffer.byteLength(`${lines[0]}\n`)).toBeLessThanOrEqual(512);
  const value = JSON.parse(lines[0]);
  expect(Object.keys(value)).toEqual(diagnosticKeys);
  expect(value.outcome).toBe("failed");
  for (const key of [
    "sdkEvents",
    "inputBytes",
    "modelOutputBytes",
    "protocolBytes",
    "cleanupFailures",
  ]) {
    expect(Number.isSafeInteger(value[key])).toBe(true);
    expect(value[key]).toBeGreaterThanOrEqual(0);
  }
  expect(value.sdkEvents).toBeLessThanOrEqual(4097);
  expect(value.inputBytes).toBeLessThanOrEqual(128 * 1024 + 1);
  expect(value.modelOutputBytes).toBeLessThanOrEqual(256 * 1024 + 1);
  expect(value.protocolBytes).toBeLessThanOrEqual(256 * 1024 + 1);
  expect(value.cleanupFailures).toBeLessThanOrEqual(7);
  expect(
    value.actualResponseStatus === "UNKNOWN" ||
      (Number.isInteger(value.actualResponseStatus) &&
        value.actualResponseStatus >= 100 &&
        value.actualResponseStatus <= 599),
  ).toBe(true);
  return value;
};
const fixtureModel = (baseUrl = "http://127.0.0.1:1/unused") => ({
  id: "fixture-model",
  provider: "fabricated-local",
  api: "openai-completions",
  name: "Fixture",
  baseUrl,
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8192,
  maxTokens: 128,
  compat: { supportsDeveloperRole: false, maxTokensField: "max_tokens" },
});
const fixtureRequest = (cwd: string, model = fixtureModel()) => ({
  cwd,
  model,
  auth: {
    ok: true,
    apiKey: "!fabricated-secret-$NO_EXPANSION",
    headers: { "X-Literal": "!fabricated-header-$NO_EXPANSION" },
    env: { FIXTURE_SECRET: "fabricated-env-secret" },
  },
  kind: "code",
  instructions: "Public synthetic fixture only.",
  prompt: "Answer WIRE_OK, without tools.",
});

// Raw native stdout/stderr: do not let runProcess's redactor hide a worker leak.
// Default: guarded loopback SDK. Optional eval: explicit boundary mocks only.
// Neither route is authenticated service evidence.
const nativeWorker = async (
  cwd: string,
  wire: string,
  guards = true,
  mockBootstrap?: string,
) => {
  const child = spawn(
    process.execPath,
    mockBootstrap === undefined
      ? [
          "--import",
          new URL("./helpers/lightweight-sdk-guard.mjs", import.meta.url).href,
          fileURLToPath(new URL("../src/sdk-worker.mjs", import.meta.url)),
        ]
      : ["--input-type=module", "--eval", mockBootstrap],
    {
      cwd,
      env: { ...safeChildEnv(), CADENCE_SUBAGENT_CHILD: guards ? "1" : "0" },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  let inputFailed = false;
  let processFailed = false;
  let deadlineExpired = false;
  let bytes = 0;
  const timer = setTimeout(() => {
    deadlineExpired = true;
    child.kill("SIGKILL");
  }, 15000);
  const collect = (chunk: Buffer, out: boolean) => {
    bytes += chunk.length;
    if (bytes > 256 * 1024) child.kill("SIGKILL");
    else if (out) stdout += chunk.toString("utf8");
    else stderr += chunk.toString("utf8");
  };
  child.stdout.on("data", (chunk: Buffer) => collect(chunk, true));
  child.stderr.on("data", (chunk: Buffer) => collect(chunk, false));
  child.stdin.on("error", () => {
    inputFailed = true;
  });
  child.on("error", () => {
    processFailed = true;
  });
  const closed = new Promise<{
    exitCode: number | null;
    signal: string | null;
  }>((resolve) => {
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
  });
  child.stdin.end(wire);
  const settled = await closed;
  clearTimeout(timer);
  const receipt = {
    pid: child.pid,
    closed: true,
    ...settled,
    deadlineExpired,
    inputFailed,
    processFailed,
    stdoutBytes: Buffer.byteLength(stdout),
    stderrBytes: Buffer.byteLength(stderr),
    workerSha256: createHash("sha256")
      .update(readFileSync(new URL("../src/sdk-worker.mjs", import.meta.url)))
      .digest("hex"),
    boundary: mockBootstrap === undefined ? "guarded-sdk" : "explicit-sdk-mock",
    mockBootstrapSha256:
      mockBootstrap === undefined
        ? undefined
        : createHash("sha256").update(mockBootstrap).digest("hex"),
    stdoutSha256: createHash("sha256").update(stdout).digest("hex"),
    stderrSha256: createHash("sha256").update(stderr).digest("hex"),
  };
  // Optional test-owned evidence root; never an SDK envelope or product setting.
  if (process.env.CADENCE_SDK_TEST_EVIDENCE) {
    for (const [stream, text] of [
      ["stdout", stdout],
      ["stderr", stderr],
    ])
      writeFileSync(
        join(
          process.env.CADENCE_SDK_TEST_EVIDENCE,
          `worker-${child.pid}.${stream}.log`,
        ),
        text,
        { flag: "wx", mode: 0o600 },
      );
    writeFileSync(
      join(process.env.CADENCE_SDK_TEST_EVIDENCE, `worker-${child.pid}.json`),
      `${JSON.stringify(receipt)}\n`,
      { flag: "wx", mode: 0o600 },
    );
  }
  expect(receipt).toMatchObject({
    closed: true,
    signal: null,
    deadlineExpired: false,
    inputFailed: false,
    processFailed: false,
  });
  expect(child.pid).toBeGreaterThan(0);
  return { ...receipt, stdout, stderr };
};

for (const lane of [
  "guards",
  "parse",
  "invalid-request",
  "unsupported-auth",
  "unsupported-model",
] as const) {
  it(`raw native worker diagnostic before SDK request: ${lane}`, async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cadence-sdk-diagnostic-"));
    const request = fixtureRequest(cwd);
    if (lane === "invalid-request") request.kind = "refused";
    if (lane === "unsupported-auth")
      request.auth.env = { SECRET_FILE: "fabricated-env-secret" } as any;
    if (lane === "unsupported-model")
      request.model.api = "fabricated-secret-unsupported";
    const wire =
      lane === "parse"
        ? '{"secret":"fabricated-parser-secret"'
        : JSON.stringify(request);
    const result = await nativeWorker(cwd, wire, lane !== "guards");
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(diagnostic(result.stderr)).toMatchObject({
      stage:
        lane === "guards"
          ? "guards"
          : lane === "parse"
            ? "parse"
            : "auth-model",
      class:
        lane === "guards"
          ? "guards-required"
          : lane === "parse"
            ? "parse-failed"
            : lane,
      sdkEvents: 0,
      requestPrepared: false,
      actualResponseStatus: "UNKNOWN",
      terminalStopReason: "UNKNOWN",
      preflight: "UNKNOWN",
      cleanupFailures: 0,
    });
    expect(result.stderr).not.toContain("fabricated");
    expect(readdirSync(cwd)).toEqual([]);
  }, 20000);
}

for (const lane of [
  "length",
  "refusal",
  "final-bound",
  "model-bound",
  "codex-http-error",
  "codex-local-error",
] as const) {
  it(`raw native SDK diagnostic/strict final: ${lane}`, async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cadence-sdk-diagnostic-"));
    let calls = 0;
    const server = createServer(async (req, res) => {
      for await (const _chunk of req) {
        /* Drain the fixture-only request. */
      }
      calls++;
      if (lane === "codex-http-error") {
        res.writeHead(401, {
          "content-type": "application/json",
          "X-Secret": "fabricated-response-header",
        });
        res.end(
          JSON.stringify({
            error: {
              message: "fabricated-upstream-secret",
              code: "fabricated-code",
            },
          }),
        );
        return;
      }
      res.writeHead(200, {
        "content-type": "text/event-stream",
        connection: "close",
      });
      const send = (delta: any, finish_reason: string | null = null) =>
        res.write(
          `data: ${JSON.stringify({
            id: "fixture",
            object: "chat.completion.chunk",
            created: 1,
            model: "fixture-model",
            choices: [{ index: 0, delta, finish_reason }],
          })}\n\n`,
        );
      if (lane === "refusal")
        send({ role: "assistant", refusal: "fabricated-refusal-secret" });
      else
        send({
          role: "assistant",
          content:
            lane === "final-bound"
              ? "x".repeat(16385)
              : lane === "model-bound"
                ? "x".repeat(256 * 1024 + 1)
                : "WIRE_OK",
        });
      send(
        {},
        lane === "length"
          ? "length"
          : lane === "refusal"
            ? "content_filter"
            : "stop",
      );
      res.end("data: [DONE]\n\n");
    });
    server.on("upgrade", (_req, socket) =>
      socket.end(
        "HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
      ),
    );
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Fixture server missing");
      const request = fixtureRequest(
        cwd,
        fixtureModel(`http://127.0.0.1:${address.port}/v1`),
      );
      if (lane.startsWith("codex-")) {
        request.model.api = "openai-codex-responses";
        request.model.provider = "openai-codex";
        if (lane === "codex-http-error")
          request.auth.apiKey = `e30.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "fixture-account" } })).toString("base64url")}.fixture`;
      }
      const result = await nativeWorker(cwd, JSON.stringify(request));
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe('{"type":"ready"}\n');
      expect(calls).toBe(lane === "codex-local-error" ? 0 : 1);
      const d = diagnostic(result.stderr);
      expect(d).toMatchObject({
        stage: ["final-bound", "model-bound"].includes(lane)
          ? "outputbounds"
          : "assistant-final",
        class:
          lane === "final-bound"
            ? "final-text-bound"
            : lane === "model-bound"
              ? "model-output-bound"
              : "terminal-incomplete",
        preflight: "accepted",
        requestPrepared: lane !== "codex-local-error",
        actualResponseStatus:
          lane === "codex-http-error"
            ? 401
            : lane === "codex-local-error"
              ? "UNKNOWN"
              : 200,
        cleanupFailures: 0,
      });
      if (lane === "length") expect(d.terminalStopReason).toBe("length");
      if (lane.startsWith("codex-") || lane === "refusal")
        expect(d.terminalStopReason).toBe("error");
      if (lane === "final-bound") expect(d.terminalStopReason).toBe("stop");
      expect(d.sdkEvents).toBeGreaterThan(0);
      expect(result.stderr).not.toContain("fabricated");
      expect(result.stderr).not.toContain(request.auth.apiKey);
      expect(readdirSync(cwd)).toEqual([]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }, 20000);
}

// Explicit public-boundary unit mocks. These are NOT native SDK/provider proofs.
// Exercise the maintained worker body without a private SDK API or provider-event filter.
const mockedWorker = async (scenario: string) => {
  vi.resetModules();
  const savedExitCode = process.exitCode;
  const request = fixtureRequest("/public-fixture");
  const originalWire = JSON.stringify(request);
  const secretFault = Object.assign(
    new Error("fabricated-secret-error-message"),
    {
      code: "fabricated-secret-code",
      stack: "fabricated-secret-stack",
      headers: request.auth.headers,
      cause: { token: request.auth.apiKey },
    },
  );
  let stdout = "";
  let stderr = "";
  let listener: (event: any) => void = () => {};
  const stops = [
    "stop",
    "length",
    "error",
    "aborted",
    "toolUse",
    "pending",
    "secret-stop",
  ];
  const stop = stops.includes(scenario) ? scenario : "stop";
  const message = {
    role: "assistant",
    stopReason: stop,
    errorMessage: secretFault.message,
    usage: { secret: "fabricated-usage-secret" },
    diagnostics: [secretFault],
  };
  let disposed = false;
  let aborts = 0;
  let requests = 0;
  let payloadCalls = 0;
  let responseCalls = 0;
  const payload = { private: "fabricated-payload-secret" };
  const replacement = { private: "fabricated-replacement-secret" };
  const response = {
    status: scenario === "invalid-status" ? 999 : 201,
    headers: { secret: "fabricated-response-secret" },
  };
  const hookPromise = Promise.resolve(replacement);
  const responsePromise = Promise.resolve();
  const context = { secret: "fabricated-context-secret" };
  const selected = request.model;
  let effectiveOptions: unknown;
  const hooks = {
    maxRetries: 7,
    signal: new AbortController().signal,
    onPayload: vi.fn(function (this: unknown, got: unknown, model: unknown) {
      payloadCalls++;
      expect(this).toBe(effectiveOptions);
      expect(this).not.toBe(hooks);
      expect((this as any).maxRetries).toBe(0);
      expect(got).toBe(payload);
      expect(model).toBe(selected);
      if (scenario === "payload-throw") throw secretFault;
      if (scenario === "payload-reject") return Promise.reject(secretFault);
      return scenario === "payload-promise"
        ? hookPromise
        : scenario === "payload-replace"
          ? replacement
          : undefined;
    }),
    onResponse: vi.fn(function (this: unknown, got: unknown, model: unknown) {
      responseCalls++;
      expect(this).toBe(effectiveOptions);
      expect(this).not.toBe(hooks);
      expect((this as any).maxRetries).toBe(0);
      expect(got).toBe(response);
      expect(model).toBe(selected);
      if (scenario === "response-throw") throw secretFault;
      if (scenario === "response-reject") return Promise.reject(secretFault);
      return scenario === "response-promise" ? responsePromise : undefined;
    }),
  };
  const session: any = {
    model: request.model,
    messages:
      scenario === "missing-assistant"
        ? []
        : scenario === "validation-mismatch"
          ? [{ ...message, stopReason: "length" }]
          : [message],
    getLastAssistantText: () =>
      scenario === "final-bound" ? "x".repeat(16385) : "WIRE_OK",
    subscribe: (callback: typeof listener) => {
      listener = callback;
      return () => {
        if (scenario === "unsubscribe-throw") throw secretFault;
      };
    },
    abort: () => {
      aborts++;
      if (scenario === "abort-throw") throw secretFault;
      if (
        ["abort-reject", "bound-cleanup", "prompt-cleanup"].includes(scenario)
      )
        return Promise.reject(secretFault);
      return Promise.resolve();
    },
    dispose: () => {
      disposed = true;
      if (scenario === "dispose-throw") throw secretFault;
      if (["dispose-reject", "prompt-cleanup"].includes(scenario))
        return Promise.reject(secretFault);
    },
    agent: {
      streamFunction: (_model: unknown, _context: unknown, options: any) => {
        requests++;
        expect(_model).toBe(selected);
        expect(_context).toBe(context);
        expect(options.signal).toBe(hooks.signal);
        expect(options.maxRetries).toBe(0);
        // ModelRuntime/Models and native adapters copy effective request options.
        const effective = { ...{ ...options }, adapterFact: true };
        effectiveOptions = effective;
        const p = effective.onPayload(payload, selected);
        if (scenario === "payload-promise") expect(p).toBe(hookPromise);
        if (scenario === "payload-replace") expect(p).toBe(replacement);
        return Promise.resolve(p).then(() => {
          const r = effective.onResponse(response, selected);
          if (scenario === "response-promise") expect(r).toBe(responsePromise);
          return r;
        });
      },
    },
    prompt: async (_prompt: string, options: any) => {
      expect(_prompt).toBe(request.prompt);
      expect(options.expandPromptTemplates).toBe(false);
      if (scenario === "preflight") {
        options.preflightResult(false);
        throw secretFault;
      }
      options.preflightResult(true);
      if (
        ["prompt-throw", "prompt-cleanup", "diagnostic-write-throw"].includes(
          scenario,
        )
      )
        throw secretFault;
      try {
        await session.agent.streamFunction(selected, context, hooks);
      } catch (error) {
        expect(error).toBe(secretFault);
        throw error;
      }
      expect(payload).toEqual({ private: "fabricated-payload-secret" });
      if (["event-bound", "bound-cleanup"].includes(scenario))
        for (let n = 0; n < 4097; n++) listener({ type: "agent_start" });
      if (scenario === "model-bound")
        listener({
          type: "message_update",
          assistantMessageEvent: {
            type: "thinking_delta",
            delta: "x".repeat(256 * 1024 + 1),
          },
        });
      if (scenario === "line-bound")
        listener({ type: "tool_execution_start", toolName: "x".repeat(65536) });
      if (scenario === "frame-bound")
        for (let n = 0; n < 4096; n++)
          listener({ type: "tool_execution_start", toolName: "read" });
      if (scenario === "aggregate-bound")
        for (let n = 0; n < 4; n++)
          listener({
            type: "tool_execution_start",
            toolName: "x".repeat(65500),
          });
      if (scenario === "no-diagnostic-room") {
        // Exactly 256KiB minus 51 bytes emitted; generic52/JSON cannot fit.
        for (let n = 0; n < 3; n++)
          listener({
            type: "tool_execution_start",
            toolName: "x".repeat(65500),
          });
        listener({ type: "tool_execution_start", toolName: "x".repeat(65472) });
        throw secretFault;
      }
      listener({
        type: "message_end",
        message: scenario === "missing-assistant" ? { role: "user" } : message,
      });
      if (["error-after-stop", "invalid-status"].includes(scenario))
        throw secretFault;
    },
  };
  vi.doMock("@earendil-works/pi-ai", () => ({
    InMemoryCredentialStore: class {},
    InMemoryModelsStore: class {},
    createProvider: (config: any) => {
      expect(config.id).toBe(request.model.provider);
      expect(config.models).toEqual([request.model]);
      void config.auth.apiKey.resolve().then((snapshot: any) => {
        expect(snapshot).toEqual({
          auth: {
            apiKey: request.auth.apiKey,
            headers: request.auth.headers,
            baseUrl: undefined,
          },
          env: request.auth.env,
        });
      });
      return config;
    },
  }));
  vi.doMock("@earendil-works/pi-ai/api/openai-completions", () => ({}));
  vi.doMock("@earendil-works/pi-coding-agent", () => ({
    ModelRuntime: {
      create: async (options: any) => {
        expect(options).toMatchObject({
          modelsPath: null,
          allowModelNetwork: false,
          refreshOnCreate: false,
        });
        if (scenario === "setup") throw secretFault;
        return { registerNativeProvider: () => {} };
      },
    },
    createExtensionRuntime: () => ({}),
    SessionManager: {
      inMemory: (cwd: string) => {
        expect(cwd).toBe(request.cwd);
        return {};
      },
    },
    SettingsManager: {
      inMemory: (settings: any) => {
        expect(settings).toEqual({
          compaction: { enabled: false },
          retry: { enabled: false },
        });
        return {};
      },
    },
    createAgentSession: async (options: any) => {
      expect(options.tools).toEqual([
        "read",
        "grep",
        "find",
        "ls",
        "write",
        "edit",
        "bash",
      ]);
      if (scenario === "session") throw secretFault;
      return {
        session,
        modelFallbackMessage:
          scenario === "model-substitution"
            ? "fabricated-secret-fallback"
            : undefined,
      };
    },
  }));
  vi.stubEnv("CADENCE_SUBAGENT_CHILD", "1");
  vi.stubEnv("PI_OFFLINE", "1");
  vi.spyOn(process.stdin, Symbol.asyncIterator).mockImplementation(
    async function* () {
      yield Buffer.from(
        scenario === "input-bound" ? "x".repeat(128 * 1024 + 1) : originalWire,
      );
    },
  );
  vi.spyOn(process.stdout, "write").mockImplementation(((text: string) => {
    if (scenario === "ready-throw" && text === '{"type":"ready"}\n')
      throw secretFault;
    stdout += text;
    return true;
  }) as any);
  vi.spyOn(process.stderr, "write").mockImplementation(((text: string) => {
    if (scenario === "diagnostic-write-throw") throw secretFault;
    stderr += text;
    return true;
  }) as any);
  try {
    await import("../src/sdk-worker.mjs" as string);
    // Allow handled bound-abort promises to settle; raw rejection must not escape.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(JSON.stringify(request)).toBe(originalWire);
    return {
      stdout,
      stderr,
      exitCode: process.exitCode ?? 0,
      disposed,
      aborts,
      requests,
      payloadCalls,
      responseCalls,
    };
  } finally {
    process.exitCode = savedExitCode;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.doUnmock("@earendil-works/pi-ai");
    vi.doUnmock("@earendil-works/pi-ai/api/openai-completions");
    vi.doUnmock("@earendil-works/pi-coding-agent");
    vi.resetModules();
  }
};

for (const scenario of [
  "payload-undefined",
  "payload-replace",
  "payload-promise",
  "response-promise",
]) {
  it(`public hook unit chain preserves original returns/identity: ${scenario}`, async () => {
    const result = await mockedWorker(scenario);
    expect(result).toMatchObject({
      exitCode: 0,
      stderr: "",
      disposed: true,
      aborts: 1,
      requests: 1,
      payloadCalls: 1,
      responseCalls: 1,
    });
    expect(result.stdout).toBe(
      '{"type":"ready"}\n{"type":"final","text":"WIRE_OK","stopReason":"stop"}\n',
    );
  });
}
for (const scenario of [
  "input-bound",
  "setup",
  "session",
  "model-substitution",
  "ready-throw",
  "preflight",
  "prompt-throw",
  "payload-throw",
  "payload-reject",
  "response-throw",
  "response-reject",
  "length",
  "error",
  "aborted",
  "toolUse",
  "pending",
  "secret-stop",
  "missing-assistant",
  "validation-mismatch",
  "invalid-status",
  "error-after-stop",
  "event-bound",
  "model-bound",
  "final-bound",
  "line-bound",
  "frame-bound",
  "aggregate-bound",
  "abort-throw",
  "abort-reject",
  "dispose-throw",
  "dispose-reject",
  "unsubscribe-throw",
  "bound-cleanup",
  "prompt-cleanup",
  "no-diagnostic-room",
  "diagnostic-write-throw",
]) {
  it(`fixed diagnostic unit fault/cleanup/privacy: ${scenario}`, async () => {
    const result = await mockedWorker(scenario);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toContain("fabricated");
    expect(result.stderr).not.toContain("secret");
    expect(result.stdout).not.toContain("fabricated");
    if (scenario === "diagnostic-write-throw") {
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe('{"type":"ready"}\n');
      expect(result.disposed).toBe(true);
      return;
    }
    if (["no-diagnostic-room", "aggregate-bound"].includes(scenario)) {
      expect(result.stderr).toBe("");
      expect(Buffer.byteLength(result.stdout)).toBe(
        256 * 1024 - (scenario === "no-diagnostic-room" ? 51 : 23),
      );
      return;
    }
    const d = diagnostic(result.stderr);
    const beforeReady = [
      "input-bound",
      "setup",
      "session",
      "model-substitution",
      "ready-throw",
    ].includes(scenario);
    expect(d).toMatchObject({
      preflight: beforeReady
        ? "UNKNOWN"
        : scenario === "preflight"
          ? "rejected"
          : "accepted",
      requestPrepared:
        !beforeReady &&
        !["preflight", "prompt-throw", "prompt-cleanup"].includes(scenario),
      actualResponseStatus:
        beforeReady ||
        [
          "preflight",
          "prompt-throw",
          "prompt-cleanup",
          "payload-throw",
          "payload-reject",
          "invalid-status",
        ].includes(scenario)
          ? "UNKNOWN"
          : 201,
    });
    if (scenario === "input-bound")
      expect(d).toMatchObject({
        stage: "parse",
        class: "input-bound",
        inputBytes: 128 * 1024 + 1,
        sdkEvents: 0,
      });
    else if (["setup", "session"].includes(scenario))
      expect(d).toMatchObject({ stage: scenario, class: "sdk-failure" });
    else if (scenario === "model-substitution")
      expect(d).toMatchObject({
        stage: "session",
        class: "model-substitution",
      });
    else if (scenario === "ready-throw")
      expect(d).toMatchObject({
        stage: "ready",
        class: "sdk-failure",
        sdkEvents: 0,
      });
    else if (scenario === "preflight")
      expect(d).toMatchObject({
        stage: "preflight",
        class: "preflight-rejected",
        sdkEvents: 0,
      });
    else if (scenario === "prompt-cleanup")
      expect(d).toMatchObject({
        stage: "prompt",
        class: "sdk-failure",
        cleanupFailures: 6,
      });
    else if (scenario === "bound-cleanup")
      expect(d).toMatchObject({
        stage: "outputbounds",
        class: "event-bound",
        cleanupFailures: 2,
      });
    else if (scenario.endsWith("-throw") || scenario.endsWith("-reject")) {
      const cleanup = /^(abort|dispose|unsubscribe)-/.test(scenario);
      expect(d).toMatchObject({
        stage: cleanup ? "cleanup" : "prompt",
        class: cleanup ? "cleanup-failure" : "sdk-failure",
      });
      if (cleanup) {
        expect(result.disposed).toBe(true);
        expect(d.terminalStopReason).toBe("stop");
        expect(result.stdout).toContain('"type":"final"'); // Final does not erase nonzero cleanup.
        expect(d.cleanupFailures).toBe(
          scenario.startsWith("abort")
            ? 2
            : scenario.startsWith("dispose")
              ? 4
              : 1,
        );
      }
    } else if (scenario.endsWith("-bound")) {
      expect(d).toMatchObject({
        stage: "outputbounds",
        class: ["line-bound", "frame-bound", "aggregate-bound"].includes(
          scenario,
        )
          ? "protocol-bound"
          : scenario === "model-bound"
            ? "model-output-bound"
            : scenario === "final-bound"
              ? "final-text-bound"
              : scenario,
      });
    } else if (["error-after-stop", "invalid-status"].includes(scenario))
      expect(d).toMatchObject({
        stage: "prompt",
        class: "sdk-failure",
        terminalStopReason: "stop",
      });
    else
      expect(d).toMatchObject({
        stage: "assistant-final",
        class: "terminal-incomplete",
        terminalStopReason: ["secret-stop", "missing-assistant"].includes(
          scenario,
        )
          ? "UNKNOWN"
          : scenario === "validation-mismatch"
            ? "stop"
            : scenario,
      });
    if (beforeReady) expect(result.stdout).toBe("");
    else if (!/^(abort|dispose|unsubscribe)-/.test(scenario))
      expect(result.stdout).not.toContain('"type":"final"');
  });
}

// Differential oracle for the old spread-only worker wrapper, not the faulty
// receiver assertion in the original diagnostic handoff. Execute the exact
// maintained wrapper against public-boundary option copies, without a provider.
const observedHooks = (stream: (...args: any[]) => any) => {
  const source = readFileSync(
    new URL("../src/sdk-worker.mjs", import.meta.url),
    "utf8",
  );
  const start = source.indexOf(
    "  const stream = session.agent.streamFunction;",
  );
  const end = source.indexOf("  let protocolFailed = false;", start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return new Function(
    "session",
    `
    "use strict";
    let requestPrepared = false;
    let actualResponseStatus = "UNKNOWN";
    ${source.slice(start, end)}
    return {
      stream: session.agent.streamFunction,
      facts: () => ({requestPrepared, actualResponseStatus}),
    };
  `,
  )({ agent: { streamFunction: stream } });
};

for (const hook of ["onPayload", "onResponse"] as const) {
  for (const mode of [
    "undefined",
    "replacement",
    "promise",
    "throw",
    "reject",
    "absent",
    "null",
  ] as const) {
    it(`old/new effective-option hook oracle: ${hook}/${mode}`, async () => {
      const input =
        hook === "onPayload"
          ? { private: "fabricated-payload" }
          : { status: 201 };
      const selected = fixtureModel();
      const context = {};
      const extra = {};
      const replacement = {};
      const fault = new Error("fabricated-callback-canary");
      const promise =
        mode === "reject"
          ? Promise.reject(fault)
          : Promise.resolve(replacement);
      // The test immediately handles its own rejected promise; the wrapper must
      // still return this exact promise, not an async adoption or repaired value.
      void promise.catch(() => {});
      const observations: any[] = [];
      for (const variant of ["old", "current"] as const) {
        let payloadReads = 0;
        let responseReads = 0;
        let calls = 0;
        let effective: any;
        const callback = function (this: unknown, ...args: unknown[]) {
          calls++;
          expect(this).toBe(effective);
          expect(this).not.toBe(incoming);
          expect((this as any).maxRetries).toBe(0);
          expect(args).toEqual([input, selected, extra]);
          expect(args[0]).toBe(input);
          expect(args[1]).toBe(selected);
          expect(args[2]).toBe(extra);
          if (mode === "throw") throw fault;
          return mode === "promise" || mode === "reject"
            ? promise
            : mode === "replacement"
              ? replacement
              : undefined;
        };
        const incoming: any = {
          maxRetries: 7,
          signal: new AbortController().signal,
        };
        Object.defineProperties(incoming, {
          onPayload: {
            enumerable: true,
            configurable: true,
            get() {
              payloadReads++;
              return hook === "onPayload"
                ? mode === "absent"
                  ? undefined
                  : mode === "null"
                    ? null
                    : callback
                : undefined;
            },
          },
          onResponse: {
            enumerable: true,
            configurable: true,
            get() {
              responseReads++;
              return hook === "onResponse"
                ? mode === "absent"
                  ? undefined
                  : mode === "null"
                    ? null
                    : callback
                : undefined;
            },
          },
        });
        let result: unknown;
        let caught: unknown;
        const streamResult = {};
        const adapter = (
          model: unknown,
          gotContext: unknown,
          snapshot: any,
        ) => {
          expect(model).toBe(selected);
          expect(gotContext).toBe(context);
          // Public SDK/model request preparation and adapter-style copies.
          effective = { ...{ ...snapshot }, adapterFact: true };
          expect(effective.signal).toBe(incoming.signal);
          expect(effective.maxRetries).toBe(0);
          Object.defineProperties(incoming, {
            onPayload: {
              value: () => {
                throw new Error("Snapshot was reread");
              },
            },
            onResponse: {
              value: () => {
                throw new Error("Snapshot was reread");
              },
            },
          });
          try {
            result = effective[hook]?.(input, selected, extra);
          } catch (error) {
            caught = error;
          }
          return streamResult;
        };
        const observed = observedHooks(adapter);
        const wrapper =
          variant === "old"
            ? (model: unknown, ctx: unknown, options: any) =>
                adapter(model, ctx, { ...options, maxRetries: 0 })
            : observed.stream;
        expect(wrapper(selected, context, incoming)).toBe(streamResult);
        expect(payloadReads).toBe(1);
        expect(responseReads).toBe(1);
        expect(incoming.maxRetries).toBe(7);
        expect(calls).toBe(mode === "absent" || mode === "null" ? 0 : 1);
        if (mode === "throw") expect(caught).toBe(fault);
        else {
          expect(caught).toBeUndefined();
          expect(result).toBe(
            mode === "promise" || mode === "reject"
              ? promise
              : mode === "replacement"
                ? replacement
                : undefined,
          );
          if (mode === "reject") await expect(result).rejects.toBe(fault);
          else if (mode === "promise")
            await expect(result).resolves.toBe(replacement);
        }
        if (variant === "current")
          expect(observed.facts()).toEqual({
            requestPrepared: hook === "onPayload",
            actualResponseStatus: hook === "onResponse" ? 201 : "UNKNOWN",
          });
        observations.push({
          payloadReads,
          responseReads,
          calls,
          result,
          caught,
        });
      }
      expect(observations[1]).toEqual(observations[0]);
    });
  }
}

for (const lane of [
  "absent",
  "null",
  "missing",
  "getter",
  "string",
  "object",
  "boolean",
  "infinity",
  "nan",
  "fraction",
  "low",
  "high",
  "100",
  "599",
] as const) {
  for (const callback of [false, true]) {
    it(`nonthrowing response observation/forwarding: ${lane}/callback=${callback}`, () => {
      const secretFault = new Error("fabricated-response-canary");
      let statusReads = 0;
      const response =
        lane === "absent"
          ? undefined
          : lane === "null"
            ? null
            : lane === "missing"
              ? {}
              : lane === "getter"
                ? {
                    get status() {
                      statusReads++;
                      throw secretFault;
                    },
                  }
                : {
                    status:
                      lane === "string"
                        ? "201"
                        : lane === "object"
                          ? {
                              [Symbol.toPrimitive]() {
                                throw secretFault;
                              },
                            }
                          : lane === "boolean"
                            ? true
                            : lane === "infinity"
                              ? Infinity
                              : lane === "nan"
                                ? NaN
                                : lane === "fraction"
                                  ? 201.5
                                  : lane === "low"
                                    ? 99
                                    : lane === "high"
                                      ? 600
                                      : Number(lane),
                  };
      const selected = fixtureModel();
      const returned = {};
      const extra = {};
      let effective: any;
      const original = vi.fn(function (this: unknown, ...args: unknown[]) {
        expect(this).toBe(effective);
        expect(args).toEqual([response, selected, extra]);
        return returned;
      });
      const observed = observedHooks(
        (_model: unknown, _ctx: unknown, snapshot: any) => {
          effective = { ...snapshot };
          // A later bad/unavailable observation must reset a previously valid fact.
          effective.onResponse({ status: 202 }, selected, extra);
          const result = effective.onResponse(response, selected, extra);
          expect(result).toBe(callback ? returned : undefined);
        },
      );
      // The first valid response is observed without calling the test callback.
      // Install the captured callback only on a second stream invocation below.
      if (callback) {
        const withCallback = observedHooks(
          (_model: unknown, _ctx: unknown, snapshot: any) => {
            effective = { ...snapshot };
            expect(effective.onResponse(response, selected, extra)).toBe(
              returned,
            );
          },
        );
        withCallback.stream(selected, {}, { onResponse: original });
        expect(original).toHaveBeenCalledTimes(1);
        expect(withCallback.facts().actualResponseStatus).toBe(
          lane === "100" ? 100 : lane === "599" ? 599 : "UNKNOWN",
        );
      } else {
        observed.stream(selected, {}, {});
        expect(original).not.toHaveBeenCalled();
        expect(observed.facts().actualResponseStatus).toBe(
          lane === "100" ? 100 : lane === "599" ? 599 : "UNKNOWN",
        );
      }
      expect(statusReads).toBe(lane === "getter" ? 1 : 0);
    });
  }
}

// Native Node adversarial dispatch, explicit in-memory SDK mocks only. The
// entire unchanged worker body from `let session` onward is evaluated; only its
// imports/adapter factory are replaced in memory, never source or installed A.
const eventFaults = [
  "event-null",
  "event-missing-type",
  "event-type-getter",
  "message-missing",
  "message-null",
  "message-getter",
  "role-getter",
  "stop-missing",
  "stop-null",
  "stop-getter",
  "update-missing",
  "update-null",
  "update-type-getter",
  "delta-missing",
  "delta-null",
  "delta-object",
  "delta-getter",
  "tool-missing",
  "tool-null",
  "tool-getter",
] as const;
const rawCanary = "FABRICATED_RAW_NODE_LEAK_CANARY";
const mockBootstrap = (lane: string, delivery = "awaited") => {
  const source = readFileSync(
    new URL("../src/sdk-worker.mjs", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("let session;");
  expect(start).toBeGreaterThan(0);
  return `
    import assert from "node:assert/strict";
    const lane = ${JSON.stringify(lane)};
    const delivery = ${JSON.stringify(delivery)};
    const canary = ${JSON.stringify(rawCanary)};
    const fault = new Error(canary);
    let exceptionReads = 0;
    const opaqueFault = {
      get message() { exceptionReads++; throw fault; },
      get stack() { exceptionReads++; throw fault; },
      toString() { exceptionReads++; throw fault; },
      [Symbol.toPrimitive]() { exceptionReads++; throw fault; },
    };
    const badGetter = () => { throw fault; };
    const badValue = { toString() { throw fault; }, [Symbol.toPrimitive]() { throw fault; } };
    const getter = (object, key) => Object.defineProperty(object, key, { get: badGetter });
    const badEvent = () => {
      switch (lane) {
        case "event-null": return null;
        case "event-missing-type": return {};
        case "event-type-getter": return getter({}, "type");
        case "message-missing": return {type:"message_end"};
        case "message-null": return {type:"message_end",message:null};
        case "message-getter": return getter({type:"message_end"}, "message");
        case "role-getter": return {type:"message_end",message:getter({}, "role")};
        case "stop-missing": return {type:"message_end",message:{role:"assistant"}};
        case "stop-null": return {type:"message_end",message:{role:"assistant",stopReason:null}};
        case "stop-getter": return {type:"message_end",message:getter({role:"assistant"}, "stopReason")};
        case "update-missing": return {type:"message_update"};
        case "update-null": return {type:"message_update",assistantMessageEvent:null};
        case "update-type-getter": return {type:"message_update",assistantMessageEvent:getter({}, "type")};
        case "delta-missing": return {type:"message_update",assistantMessageEvent:{type:"text_delta"}};
        case "delta-null": return {type:"message_update",assistantMessageEvent:{type:"text_delta",delta:null}};
        case "delta-object": return {type:"message_update",assistantMessageEvent:{type:"text_delta",delta:badValue}};
        case "delta-getter": return {type:"message_update",assistantMessageEvent:getter({type:"thinking_delta"}, "delta")};
        case "tool-missing": return {type:"tool_execution_start"};
        case "tool-null": return {type:"tool_execution_start",toolName:null};
        case "tool-getter": return getter({type:"tool_execution_start"}, "toolName");
      }
      throw new Error("Unknown fixture lane");
    };
    let listener;
    let aborts = 0;
    let disposed = false;
    let deliveries = 0;
    const message = {role:"assistant",stopReason:"stop"};
    const fixtureSession = {
      model: undefined, messages:[message], getLastAssistantText:()=>"WIRE_OK",
      agent:{streamFunction:()=>{}},
      subscribe(callback) {
        listener = callback;
        return () => { if (lane === "unsubscribe-opaque") throw opaqueFault; };
      },
      abort() {
        aborts++;
        if (lane === "abort-opaque") throw opaqueFault;
        if (lane === "abort-reject-opaque" || lane === "event-abort-reject") return Promise.reject(opaqueFault);
        return Promise.resolve();
      },
      dispose() {
        disposed = true;
        if (lane === "dispose-opaque") throw opaqueFault;
        if (lane === "dispose-reject-opaque") return Promise.reject(opaqueFault);
      },
      async prompt(_prompt, options) {
        if (lane === "preflight-resolve") {
          options.preflightResult(false);
          assert.equal(listener({type:"message_end",message}), undefined);
          return; // Negative peer: reject callback, but valid stop and resolve.
        }
        options.preflightResult(true);
        if (lane === "prompt-opaque") throw opaqueFault;
        if (lane === "event-abort-reject" || lane.startsWith("event-") ||
            /^(message|role|stop|update|delta|tool)-/.test(lane)) {
          const event = lane === "event-abort-reject" ? getter({type:"message_end"},"message") : badEvent();
          const dispatch = () => {
            deliveries++;
            assert.equal(listener(event), undefined);
          };
          if (delivery === "independent") {
            // Deliberately NOT chained to/awaited by prompt and NO rejection
            // handler. A leaky callback prints the fabricated raw Node canary.
            for (let n=0;n<3;n++) void Promise.resolve().then(dispatch);
            await new Promise(resolve => setImmediate(resolve));
          } else {
            for (let n=0;n<3;n++) await Promise.resolve().then(dispatch);
          }
        }
        assert.equal(listener({type:"message_end",message}), undefined);
      },
    };
    const adapters = {"openai-completions":async()=>({})};
    class InMemoryCredentialStore {}
    class InMemoryModelsStore {}
    const ModelRuntime = {async create(options) {
      assert.ok(options.credentials instanceof InMemoryCredentialStore);
      assert.ok(options.modelsStore instanceof InMemoryModelsStore);
      assert.equal(options.modelsPath,null);
      assert.equal(options.refreshOnCreate,false);
      assert.equal(options.allowModelNetwork,false);
      return {registerNativeProvider(){}};
    }};
    const createProvider = config => config;
    const createExtensionRuntime = () => ({});
    const SessionManager = {inMemory:()=>({})};
    const SettingsManager = {inMemory:()=>({})};
    const createAgentSession = async options => {
      fixtureSession.model = options.model;
      return {session:fixtureSession};
    };
    ${source.slice(start)}
    assert.equal(exceptionReads,0);
    assert.equal(disposed,true);
    assert.equal(aborts,deliveries ? 2 : 1); // Coalesced request plus independent cleanup.
    assert.equal(deliveries,${eventFaults.includes(lane as any) || lane === "event-abort-reject" ? 3 : 0});
  `;
};
for (const delivery of ["awaited", "independent"] as const) {
  for (const lane of [...eventFaults, "event-abort-reject"]) {
    it(`raw native mock event boundary/no final: ${delivery}/${lane}`, async () => {
      const cwd = mkdtempSync(join(tmpdir(), "cadence-sdk-mock-"));
      const result = await nativeWorker(
        cwd,
        JSON.stringify(fixtureRequest(cwd)),
        true,
        mockBootstrap(lane, delivery),
      );
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe('{"type":"ready"}\n');
      expect(result.stderr).not.toContain(rawCanary);
      expect(result.stderr).not.toMatch(
        /Error:|UnhandledPromiseRejection|\bat file:|\bat async/,
      );
      expect(diagnostic(result.stderr)).toMatchObject({
        stage: "events",
        class: "event-projection-failed",
        sdkEvents: 4,
        terminalStopReason: "stop",
        preflight: "accepted",
        requestPrepared: false,
        actualResponseStatus: "UNKNOWN",
        cleanupFailures: lane === "event-abort-reject" ? 2 : 0,
      });
      expect(readdirSync(cwd)).toEqual([]);
    }, 20000);
  }
}
for (const lane of [
  "preflight-resolve",
  "prompt-opaque",
  "unsubscribe-opaque",
  "abort-opaque",
  "abort-reject-opaque",
  "dispose-opaque",
  "dispose-reject-opaque",
]) {
  it(`raw native mock first-fault/opaque exception/late cleanup: ${lane}`, async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cadence-sdk-mock-"));
    const result = await nativeWorker(
      cwd,
      JSON.stringify(fixtureRequest(cwd)),
      true,
      mockBootstrap(lane),
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toContain(rawCanary);
    expect(result.stderr).not.toMatch(
      /Error:|UnhandledPromiseRejection|\bat file:|\bat async/,
    );
    const cleanup = !["preflight-resolve", "prompt-opaque"].includes(lane);
    expect(result.stdout).toBe(
      cleanup
        ? '{"type":"ready"}\n{"type":"final","text":"WIRE_OK","stopReason":"stop"}\n'
        : '{"type":"ready"}\n',
    );
    expect(diagnostic(result.stderr)).toMatchObject({
      stage: cleanup
        ? "cleanup"
        : lane === "preflight-resolve"
          ? "preflight"
          : "prompt",
      class: cleanup
        ? "cleanup-failure"
        : lane === "preflight-resolve"
          ? "preflight-rejected"
          : "sdk-failure",
      cleanupFailures: cleanup
        ? lane.startsWith("unsubscribe")
          ? 1
          : lane.startsWith("abort")
            ? 2
            : 4
        : 0,
      terminalStopReason: lane === "prompt-opaque" ? "UNKNOWN" : "stop",
      preflight: lane === "preflight-resolve" ? "rejected" : "accepted",
    });
    expect(readdirSync(cwd)).toEqual([]);
  }, 20000);
}

for (const mode of ["throw", "reject", "promise"] as const) {
  it(`bad response observation still preserves callback-owned ${mode} identity`, async () => {
    const observationFault = new Error("fabricated-observation-canary");
    const ownFault = new Error("fabricated-original-callback-canary");
    let reads = 0;
    let calls = 0;
    const response = {
      get status() {
        reads++;
        throw observationFault;
      },
    };
    const promise =
      mode === "reject" ? Promise.reject(ownFault) : Promise.resolve(response);
    void promise.catch(() => {});
    let effective: any;
    const original = function (this: unknown, ...args: unknown[]) {
      calls++;
      expect(this).toBe(effective);
      expect(args[0]).toBe(response);
      if (mode === "throw") throw ownFault;
      return promise;
    };
    const observed = observedHooks(
      (_model: unknown, _ctx: unknown, snapshot: any) => {
        effective = { ...snapshot };
        if (mode === "throw") {
          let caught: unknown;
          try {
            effective.onResponse(response);
          } catch (error) {
            caught = error;
          }
          expect(caught).toBe(ownFault);
        } else expect(effective.onResponse(response)).toBe(promise);
      },
    );
    observed.stream(fixtureModel(), {}, { onResponse: original });
    expect(calls).toBe(1);
    expect(reads).toBe(1);
    expect(observed.facts().actualResponseStatus).toBe("UNKNOWN");
    if (mode === "reject") await expect(promise).rejects.toBe(ownFault);
    else if (mode === "promise") await expect(promise).resolves.toBe(response);
  });
}
