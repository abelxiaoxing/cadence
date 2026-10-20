import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createTCPServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, zstdDecompressSync } from "node:zlib";
import {
  InMemoryCredentialStore,
  InMemoryModelsStore,
} from "@earendil-works/pi-ai";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  legacyWorkerEnvelope,
  runProcess,
  runWorker,
  safeChildEnv,
  type WorkerRequest,
} from "../src/subagent-process.ts";
import { LIMITS } from "../src/worker-public.mjs";
import { captureSummary } from "./helpers/worker-v2.ts";

// A native observer, not an executable/SDK substitution. Existing lanes still delegate unchanged.
vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return { ...original, spawn: vi.fn(original.spawn) };
});
const originalNativeSpawn = vi
  .mocked(spawn)
  .getMockImplementation() as typeof spawn;
const selectedNetworkKeys = [
  "http_proxy",
  "https_proxy",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "all_proxy",
  "NO_PROXY",
  "no_proxy",
  "NODE_USE_ENV_PROXY",
  "NODE_OPTIONS",
] as const;
let savedNetwork: (PropertyDescriptor | undefined)[];
beforeEach(() => {
  savedNetwork = selectedNetworkKeys.map((key) =>
    Object.getOwnPropertyDescriptor(process.env, key),
  );
  for (const key of selectedNetworkKeys) delete process.env[key];
});
afterEach(() => {
  selectedNetworkKeys.forEach((key, index) => {
    delete process.env[key];
    const descriptor = savedNetwork[index];
    if (descriptor) Object.defineProperty(process.env, key, descriptor);
  });
});

// Real native SDK integration budget, not a retimed retired certification test.
for (const lane of [
  "key-tool",
  "xhigh-key-tool",
  "headers-only-readonly",
  "diagnosis-readonly",
  "planner-readonly",
  "oauth-only-api",
  "resolved-baseurl-null",
  "azure-env",
] as const) {
  it(`actual SDK stdin/native resolver: ${lane}`, async () => {
    const toolLane = lane === "key-tool" || lane === "xhigh-key-tool";
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
          if (toolLane && requests.length === 1) {
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
            reasoning: lane === "xhigh-key-tool",
            ...(lane === "xhigh-key-tool"
              ? { thinkingLevelMap: { xhigh: "xhigh" } }
              : {}),
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
      const wire = JSON.stringify(
        legacyWorkerEnvelope({
          cwd,
          model: { ...model },
          auth,
          kind: toolLane
            ? "code"
            : lane === "diagnosis-readonly"
              ? "diagnosis"
              : "research",
          thinkingLevel: lane === "xhigh-key-tool" ? "xhigh" : "off",
          instructions:
            "Synthetic fixture only. Use write only when requested; no shell or external resources.",
          prompt: toolLane
            ? "Write fixture.txt containing fixture-only, then answer WIRE_OK."
            : "Answer WIRE_OK. Do not call tools.",
        }),
      );
      const raw =
        lane === "xhigh-key-tool" ? await nativeWorker(cwd, wire) : undefined;
      const result = raw
        ? undefined
        : await runProcess({
            command: process.execPath,
            args: [
              "--import",
              new URL("./helpers/lightweight-sdk-guard.mjs", import.meta.url)
                .href,
              fileURLToPath(new URL("../src/sdk-worker.mjs", import.meta.url)),
            ],
            cwd,
            timeoutMs: 15000,
            signal: new AbortController().signal,
            input: wire,
            protocol: true,
            secrets: [key, literal],
          });
      if (raw) {
        expect(raw.exitCode).toBe(0);
        expect(raw.stderr).toBe("");
        expect(captureSummary(raw.stdout)).toBe(
          '{"type":"ready"}\n{"type":"tool","name":"write"}\n{"type":"final","text":"WIRE_OK","stopReason":"stop"}\n',
        );
        for (const canary of [key, literal])
          expect(raw.stdout + raw.stderr).not.toContain(canary);
      }
      expect(serverError).toBeUndefined();
      if (result) {
        expect(result, JSON.stringify(result)).toMatchObject({
          outcome: "completed",
          closed: true,
          exitCode: 0,
          text: "WIRE_OK",
        });
        expect(result.output).toBe(""); // Successful stderr/protocol remains unchanged.
        expect(result.output).not.toContain(key);
        expect(result.output).not.toContain(literal);
      }
      expect(requests).toHaveLength(toolLane ? 2 : 1);
      for (const request of requests) {
        expect(request.body.model).toBe("fixture-model");
        if (lane === "xhigh-key-tool")
          expect(request.body.reasoning_effort).toBe("xhigh");
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
          toolLane
            ? ["read", "grep", "find", "ls", "write", "edit", "bash"]
            : ["read", "grep", "find", "ls"],
        );
      }
      if (toolLane) {
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
      if (raw && process.env.CADENCE_SDK_TEST_EVIDENCE)
        writeFileSync(
          join(
            process.env.CADENCE_SDK_TEST_EVIDENCE,
            "thinking-xhigh-positive.json",
          ),
          `${JSON.stringify({
            boundary: "stock-sdk-loopback-mapped-xhigh-tool-result",
            pid: raw.pid,
            waits: raw.waits,
            inputDelivered: raw.inputDelivered,
            stdoutEOF: raw.stdoutEOF,
            stderrEOF: raw.stderrEOF,
            forced: raw.forced,
            stderrBytes: raw.stderrBytes,
            requests: requests.length,
            exactWireEffortXhigh: requests.every(
              (request) => request.body.reasoning_effort === "xhigh",
            ),
            toolResultObserved: requests[1].body.messages.some(
              (message: any) => message.role === "tool",
            ),
            literalAuthAssertionsPassed: true,
            onlyExpectedFixtureWrite: true,
            paidProvider: false,
          })}\n`,
          { flag: "wx", mode: 0o600 },
        );
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
  "cleanupSettled",
];
const diagnostic = (stderr: string) => {
  const lines = stderr.split("\n");
  expect(lines.at(-1)).toBe("");
  lines.pop();
  const hasGeneric = lines.at(-1) === genericFailure.trimEnd();
  if (hasGeneric) lines.pop();
  expect(lines.length).toBeGreaterThanOrEqual(1);
  expect(lines.length, stderr).toBeLessThanOrEqual(2);
  const values = lines.map((line) => {
    expect(Buffer.byteLength(`${line}\n`)).toBeLessThanOrEqual(512);
    const snapshot = JSON.parse(line);
    expect(Object.keys(snapshot)).toEqual(diagnosticKeys);
    expect(typeof snapshot.cleanupSettled).toBe("boolean");
    return snapshot;
  });
  expect(values[0].cleanupSettled).toBe(false);
  if (values.length === 2) {
    expect(values[1].cleanupSettled).toBe(true);
    expect(values[1].stage).toBe(values[0].stage);
    expect(values[1].class).toBe(values[0].class);
  }
  const value = values.at(-1)!;
  expect(hasGeneric).toBe(value.cleanupSettled);
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
  expect(value.sdkEvents).toBeLessThanOrEqual(1_000_001);
  expect(value.inputBytes).toBeLessThanOrEqual(128 * 1024 + 1);
  expect(value.modelOutputBytes).toBeLessThanOrEqual(128 * 1024 * 1024 + 1);
  expect(value.protocolBytes).toBeLessThanOrEqual(128 * 1024 * 1024 + 1);
  expect(value.cleanupFailures).toBeLessThanOrEqual(15);
  expect(
    value.actualResponseStatus === "UNKNOWN" ||
      (Number.isInteger(value.actualResponseStatus) &&
        value.actualResponseStatus >= 100 &&
        value.actualResponseStatus <= 599),
  ).toBe(true);
  return value;
};
// Public Undici 6.x emits this fixed code/message through Node's normal warning
// formatter. Node runtimes without that startup warning leave stderr unchanged.
// Only the VALIDATED_PROXY native failure case opts in, using its original PID.
const proxyWarningHeader = (pid: number) =>
  `(node:${pid}) [UNDICI-EHPA] Warning: EnvHttpProxyAgent is experimental, expect them to change at any time.\n`;
const proxyWarningGuidance =
  "(Use `node --trace-warnings ...` to show where the warning was created)\n";
const proxyStartupStderr = (stderr: string, nativePID: number) => {
  expect(Number.isSafeInteger(nativePID) && nativePID > 0).toBe(true);
  const header = proxyWarningHeader(nativePID);
  let prefix = "";
  if (stderr.startsWith(header)) {
    prefix = header;
    if (stderr.slice(header.length).startsWith(proxyWarningGuidance))
      prefix += proxyWarningGuidance;
  }
  // Recognize at most one ordered prefix. All other bytes still reach the
  // unchanged strict snapshot parser; no arbitrary warning/stack/secret filter.
  return {
    workerStderr: stderr.slice(prefix.length),
    runtimeWarning: prefix
      ? {
          domain: "native-node-startup-warning",
          pid: nativePID,
          type: "Warning",
          code: "UNDICI-EHPA",
          label: "EnvHttpProxyAgent",
          bytes: Buffer.byteLength(prefix),
          lines: prefix === header ? 1 : 2,
        }
      : null,
  };
};

// MEMORY codec controls only: fixed public warning text plus synthetic snapshots.
// These do not execute Node22, an SDK/provider, or certify CI's original stderr.
const memoryDiagnostic = {
  stage: "assistant-final",
  class: "terminal-incomplete",
  outcome: "failed",
  sdkEvents: 3,
  inputBytes: 900,
  modelOutputBytes: 0,
  protocolBytes: 17,
  terminalStopReason: "error",
  preflight: "accepted",
  requestPrepared: true,
  actualResponseStatus: "UNKNOWN",
  cleanupFailures: 0,
  cleanupSettled: false,
};
const memoryFirstSnapshot = `${JSON.stringify(memoryDiagnostic)}\n`;
const memoryFinalSnapshot = `${JSON.stringify({ ...memoryDiagnostic, cleanupSettled: true })}\n`;
const memoryWorkerStderr =
  memoryFirstSnapshot + memoryFinalSnapshot + genericFailure;
const memoryPID = 12345;
const memoryWarning = proxyWarningHeader(memoryPID);
for (const prefix of [
  "",
  memoryWarning,
  memoryWarning + proxyWarningGuidance,
]) {
  it(`MEMORY proxy startup warning codec accepts exact prefix lines=${prefix.split("\n").length - 1}`, () => {
    const raw = prefix + memoryWorkerStderr;
    const parsed = proxyStartupStderr(raw, memoryPID);
    expect(parsed.workerStderr).toBe(memoryWorkerStderr);
    expect(diagnostic(parsed.workerStderr)).toEqual({
      ...memoryDiagnostic,
      cleanupSettled: true,
    });
    expect(parsed.runtimeWarning).toEqual(
      prefix
        ? {
            domain: "native-node-startup-warning",
            pid: memoryPID,
            type: "Warning",
            code: "UNDICI-EHPA",
            label: "EnvHttpProxyAgent",
            bytes: Buffer.byteLength(prefix),
            lines: prefix === memoryWarning ? 1 : 2,
          }
        : null,
    );
    expect(Buffer.byteLength(raw)).toBe(
      Buffer.byteLength(parsed.workerStderr) +
        (parsed.runtimeWarning?.bytes ?? 0),
    );
    if (prefix) expect(() => diagnostic(raw)).toThrow(); // No general opt-in.
  });
}
it.each([
  ["wrong-pid", proxyWarningHeader(memoryPID + 1) + memoryWorkerStderr],
  [
    "wrong-code",
    memoryWarning.replace("UNDICI-EHPA", "UNKNOWN") + memoryWorkerStderr,
  ],
  [
    "wrong-type",
    memoryWarning.replace("Warning:", "ExperimentalWarning:") +
      memoryWorkerStderr,
  ],
  [
    "altered-message",
    memoryWarning.replace("at any time.", "later.") + memoryWorkerStderr,
  ],
  ["duplicate-warning", memoryWarning + memoryWarning + memoryWorkerStderr],
  ["guidance-alone", proxyWarningGuidance + memoryWorkerStderr],
  ["guidance-first", proxyWarningGuidance + memoryWarning + memoryWorkerStderr],
  [
    "duplicate-guidance",
    memoryWarning +
      proxyWarningGuidance +
      proxyWarningGuidance +
      memoryWorkerStderr,
  ],
  [
    "altered-guidance",
    memoryWarning +
      proxyWarningGuidance.replace("node --trace", "node.exe --trace") +
      memoryWorkerStderr,
  ],
  [
    "warning-after-snapshot",
    memoryFirstSnapshot + memoryWarning + memoryFinalSnapshot + genericFailure,
  ],
  ["unterminated-warning", memoryWarning.trimEnd() + memoryWorkerStderr],
  ["crlf-warning", memoryWarning.replace("\n", "\r\n") + memoryWorkerStderr],
  [
    "unknown-warning",
    `(node:${memoryPID}) [UNKNOWN] Warning: unknown\n${memoryWorkerStderr}`,
  ],
  [
    "extra-line",
    `${memoryWarning}unexpected runtime output\n${memoryWorkerStderr}`,
  ],
  [
    "trailing-line",
    `${memoryWarning}${memoryWorkerStderr}unexpected trailing output\n`,
  ],
  [
    "context-secret",
    `${memoryWarning}Authorization: Bearer FABRICATED_CONTEXT_SECRET\n${memoryWorkerStderr}`,
  ],
  [
    "auth-url",
    `${memoryWarning}http://user:FABRICATED_SECRET@127.0.0.1:1/\n${memoryWorkerStderr}`,
  ],
  [
    "fabricated-stack",
    `${memoryWarning}    at fake (file:///FABRICATED_STACK:1:1)\n${memoryWorkerStderr}`,
  ],
  ["third-snapshot", memoryWarning + memoryFirstSnapshot + memoryWorkerStderr],
  [
    "missing-generic",
    memoryWarning + memoryFirstSnapshot + memoryFinalSnapshot,
  ],
])("MEMORY proxy startup warning codec refuses %s", (_name, raw) => {
  expect(() =>
    diagnostic(proxyStartupStderr(raw, memoryPID).workerStderr),
  ).toThrow();
});

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
  try {
    const old = JSON.parse(wire);
    if (!old.request) wire = JSON.stringify(legacyWorkerEnvelope(old));
  } catch {
    /* Explicit malformed/oversized input controls remain malformed. */
  }
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
  let forced = false;
  let stdoutEOF = false;
  let stderrEOF = false;
  let inputDelivered = false;
  const waits: {
    event: string;
    exitCode: number | null;
    signal: string | null;
  }[] = [];
  let bytes = 0;
  const timer = setTimeout(() => {
    deadlineExpired = true;
    forced = true;
    child.kill("SIGKILL");
  }, 15000);
  const collect = (chunk: Buffer, out: boolean) => {
    bytes += chunk.length;
    if (bytes > LIMITS.childProtocolBytes) {
      forced = true;
      child.kill("SIGKILL");
    } else if (out) stdout += chunk.toString("utf8");
    else stderr += chunk.toString("utf8");
  };
  child.stdout.on("data", (chunk: Buffer) => collect(chunk, true));
  child.stderr.on("data", (chunk: Buffer) => collect(chunk, false));
  child.stdout.once("end", () => {
    stdoutEOF = true;
  });
  child.stderr.once("end", () => {
    stderrEOF = true;
  });
  child.stdin.once("finish", () => {
    inputDelivered = true;
  });
  child.once("exit", (exitCode, signal) =>
    waits.push({ event: "exit", exitCode, signal }),
  );
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
    child.once("close", (exitCode, signal) => {
      waits.push({ event: "close", exitCode, signal });
      resolve({ exitCode, signal });
    });
  });
  child.stdin.end(wire);
  const settled = await closed;
  clearTimeout(timer);
  const receipt = {
    pid: child.pid,
    closed: true,
    ...settled,
    deadlineExpired,
    forced,
    inputDelivered,
    stdoutEOF,
    stderrEOF,
    waits,
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
    forced: false,
    inputDelivered: true,
    stdoutEOF: true,
    stderrEOF: true,
    waits: [
      { event: "exit", ...settled },
      { event: "close", ...settled },
    ],
    inputFailed: false,
    processFailed: false,
  });
  expect(child.pid).toBeGreaterThan(0);
  return { ...receipt, stdout, stderr };
};

for (const lane of [
  "nonreasoning-high",
  "nonreasoning-xhigh",
  "reasoning-xhigh-missing-map",
] as const) {
  it(`actual stock SDK effective-thinking refusal before ready: ${lane}`, async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cadence-sdk-thinking-refusal-"));
    let modelContacts = 0;
    let requests = 0;
    const server = createServer((_req, res) => {
      requests++;
      res.writeHead(500);
      res.end("FABRICATED_THINKING_RESPONSE_CANARY");
    });
    server.on("connection", () => {
      modelContacts++;
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Fixture unavailable");
      const request = {
        ...fixtureRequest(cwd, {
          ...fixtureModel(`http://127.0.0.1:${address.port}/v1`),
          reasoning: lane === "reasoning-xhigh-missing-map",
        }),
        thinkingLevel: lane === "nonreasoning-high" ? "high" : "xhigh",
      };
      const wire = JSON.stringify(request);
      const result = await nativeWorker(cwd, wire);
      expect(JSON.stringify(request)).toBe(wire);
      expect(result.exitCode).toBe(1);
      expect(captureSummary(result.stdout), result.stderr).toBe("");
      expect(diagnostic(result.stderr)).toMatchObject({
        stage: "session",
        class: "model-substitution",
        sdkEvents: 0,
        preflight: "UNKNOWN",
        requestPrepared: false,
        actualResponseStatus: "UNKNOWN",
        terminalStopReason: "UNKNOWN",
        cleanupFailures: 0,
        cleanupSettled: true,
      });
      for (const canary of [
        request.auth.apiKey,
        request.auth.headers["X-Literal"],
        request.auth.env.FIXTURE_SECRET,
        request.model.baseUrl,
        "FABRICATED_THINKING_RESPONSE_CANARY",
      ])
        expect(result.stdout + result.stderr).not.toContain(canary);
      expect({ modelContacts, requests }).toEqual({
        modelContacts: 0,
        requests: 0,
      });
      expect(readdirSync(cwd)).toEqual([]);
      if (process.env.CADENCE_SDK_TEST_EVIDENCE)
        writeFileSync(
          join(process.env.CADENCE_SDK_TEST_EVIDENCE, `thinking-${lane}.json`),
          `${JSON.stringify({ boundary: "stock-sdk-loopback-thinking-refusal", lane, pid: result.pid, waits: result.waits, inputDelivered: result.inputDelivered, stdoutEOF: result.stdoutEOF, stderrEOF: result.stderrEOF, forced: result.forced, modelContacts, requests, fileWrites: 0, paidProvider: false })}\n`,
          { flag: "wx", mode: 0o600 },
        );
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }, 20000);
}

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
    expect(captureSummary(result.stdout), result.stderr).toBe("");
    expect(diagnostic(result.stderr)).toMatchObject({
      stage:
        lane === "guards"
          ? "guards"
          : ["parse", "invalid-request", "unsupported-model"].includes(lane)
            ? "parse"
            : "auth-model",
      class:
        lane === "guards"
          ? "guards-required"
          : ["parse", "invalid-request", "unsupported-model"].includes(lane)
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
                ? "x".repeat(2 * 1024 * 1024 + 8192)
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
      if (["final-bound", "model-bound"].includes(lane)) {
        // Intentional v2 replacement: old 16KiB/256KiB ceilings are no longer
        // refusal thresholds. Preserve complete native delivery/close coverage,
        // and assert the retained final byte count, not the bounded preview.
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        const frames = result.stdout
          .trimEnd()
          .split("\n")
          .map((line) => JSON.parse(line));
        captureSummary(result.stdout); // validates every original sequence/hash/link
        const final = frames.at(-1).event;
        expect(final.kind).toBe("final");
        expect(
          frames.find(
            (frame) =>
              frame.event.kind === "detail-end" &&
              frame.event.detailId === final.detailId,
          ).event.bytes,
        ).toBe(lane === "final-bound" ? 16385 : 2 * 1024 * 1024 + 8192);
        expect(calls).toBe(1);
        expect(readdirSync(cwd)).toEqual([]);
        return;
      }
      expect(result.exitCode).toBe(1);
      expect(captureSummary(result.stdout), result.stderr).toBe(
        '{"type":"ready"}\n',
      );
      expect(calls).toBe(lane === "codex-local-error" ? 0 : 1);
      const d = diagnostic(result.stderr);
      expect(d).toMatchObject({
        stage: ["final-bound", "model-bound"].includes(lane)
          ? "events"
          : "assistant-final",
        class:
          lane === "final-bound"
            ? "event-projection-failed"
            : lane === "model-bound"
              ? "event-projection-failed"
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
      if (lane === "final-bound") expect(d.terminalStopReason).toBe("UNKNOWN");
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
    content: [
      {
        type: "text",
        text:
          scenario === "final-bound"
            ? "x".repeat(LIMITS.detailBytes + 1)
            : "WIRE_OK",
      },
    ],
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
  let sessionThinkingLevel: unknown;
  const session: any = {
    get thinkingLevel() {
      return sessionThinkingLevel;
    },
    model: request.model,
    systemPrompt: request.instructions,
    messages:
      scenario === "missing-assistant"
        ? []
        : scenario === "validation-mismatch"
          ? [{ ...message, stopReason: "length" }]
          : [message],
    getLastAssistantText: () =>
      scenario === "final-bound"
        ? "x".repeat(LIMITS.detailBytes + 1)
        : "WIRE_OK",
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
      state: { tools: [] },
      toolExecution:
        scenario === "unsupported-tool-mode" ? undefined : "parallel",
      subscribe(callback: typeof listener) {
        return session.subscribe(callback);
      },
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
        for (let n = 0; n < LIMITS.sdkEvents + 1; n++)
          await listener({ type: "agent_start" });
      if (scenario === "model-bound")
        await listener({
          type: "message_update",
          assistantMessageEvent: {
            type: "thinking_delta",
            delta: "x".repeat(LIMITS.childProtocolBytes + 1),
          },
        });
      if (scenario === "line-bound")
        await listener({
          type: "tool_execution_start",
          toolName: "x".repeat(65536),
        });
      if (scenario === "frame-bound")
        for (let n = 0; n < 4096; n++)
          await listener({ type: "tool_execution_start", toolName: "read" });
      if (scenario === "aggregate-bound")
        for (let n = 0; n < 4; n++)
          await listener({
            type: "tool_execution_start",
            toolName: "x".repeat(65500),
          });
      if (scenario === "no-diagnostic-room") {
        // Exactly 256KiB minus 51 bytes emitted; generic52/JSON cannot fit.
        for (let n = 0; n < 3; n++)
          await listener({
            type: "tool_execution_start",
            toolName: "x".repeat(65500),
          });
        await listener({
          type: "tool_execution_start",
          toolName: "x".repeat(65472),
        });
        throw secretFault;
      }
      await listener({
        type: "message_start",
        message: {
          role: scenario === "missing-assistant" ? "user" : "assistant",
        },
      });
      await listener({
        type: "message_end",
        message:
          scenario === "missing-assistant"
            ? { role: "user", content: [] }
            : scenario === "validation-mismatch"
              ? { ...message, stopReason: "length" }
              : message,
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
    createLocalBashOperations: () => {
      throw new Error("Fixture must not execute bash");
    },
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
          cacheWarming: "off",
        });
        return {};
      },
    },
    createAgentSession: async (options: any) => {
      sessionThinkingLevel = options.thinkingLevel;
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
        scenario === "input-bound"
          ? "x".repeat(128 * 1024 + 1)
          : JSON.stringify(legacyWorkerEnvelope(request as WorkerRequest)),
      );
    },
  );
  vi.spyOn(process.stdout, "write").mockImplementation(((
    text: string,
    callback?: () => void,
  ) => {
    if (scenario === "ready-throw" && JSON.parse(text).event.kind === "ready")
      throw secretFault;
    stdout += text;
    callback?.();
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
    if (scenario === "no-diagnostic-room") {
      // v2's larger aggregate and strict metadata no longer allow the old
      // malformed tool-name flood. Exercise the unchanged live diagnostic writer
      // at its new remaining-capacity boundary (injected accounting, not native).
      const source = readFileSync(
        new URL("../src/sdk-worker.mjs", import.meta.url),
        "utf8",
      );
      const body = source.slice(
        source.indexOf("const emitFailure ="),
        source.indexOf("\ntry {"),
      );
      const output = new Function(
        "LIMITS",
        `let bytes=LIMITS.childProtocolBytes-51; const emitter=undefined; const failure={stage:"prompt",class:"sdk-failure"}; const sdkEvents=0,inputBytes=0,modelOutputBytes=0,terminalStopReason="UNKNOWN",preflight="UNKNOWN",requestPrepared=false,actualResponseStatus="UNKNOWN",cleanupFailures=0,cleanupSettled=true; let output=""; const process={stderr:{write(text){output+=text;}}}; ${body}; emitFailure(); return output;`,
      )(LIMITS);
      expect(output).toBe("");
      return;
    }
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
    expect(captureSummary(result.stdout), result.stderr).toBe(
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
    if (scenario === "no-diagnostic-room") {
      // v2's larger aggregate and strict metadata no longer allow the old
      // malformed tool-name flood. Exercise the unchanged live diagnostic writer
      // at its new remaining-capacity boundary (injected accounting, not native).
      const source = readFileSync(
        new URL("../src/sdk-worker.mjs", import.meta.url),
        "utf8",
      );
      const body = source.slice(
        source.indexOf("const emitFailure ="),
        source.indexOf("\ntry {"),
      );
      const output = new Function(
        "LIMITS",
        `let bytes=LIMITS.childProtocolBytes-51; const emitter=undefined; const failure={stage:"prompt",class:"sdk-failure"}; const sdkEvents=0,inputBytes=0,modelOutputBytes=0,terminalStopReason="UNKNOWN",preflight="UNKNOWN",requestPrepared=false,actualResponseStatus="UNKNOWN",cleanupFailures=0,cleanupSettled=true; let output=""; const process={stderr:{write(text){output+=text;}}}; ${body}; emitFailure(); return output;`,
      )(LIMITS);
      expect(output).toBe("");
      return;
    }
    const result = await mockedWorker(scenario);
    if (scenario === "session") {
      // Public capability absence must not be repaired by assigning a new JS
      // property that an older agent loop would silently ignore.
      const unsupported = await mockedWorker("unsupported-tool-mode");
      expect(unsupported).toMatchObject({
        exitCode: 1,
        stdout: "",
        requests: 0,
        disposed: true,
      });
      expect(diagnostic(unsupported.stderr)).toMatchObject({
        stage: "session",
        class: "capture-unsupported",
        preflight: "UNKNOWN",
      });
    }
    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toContain("fabricated");
    expect(result.stderr).not.toContain("secret");
    expect(result.stdout).not.toContain("fabricated");
    if (scenario === "diagnostic-write-throw") {
      expect(result.stderr).toBe("");
      expect(captureSummary(result.stdout), result.stderr).toBe(
        '{"type":"ready"}\n',
      );
      expect(result.disposed).toBe(true);
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
        stage: "events",
        class: "event-projection-failed",
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
        expect(captureSummary(result.stdout)).toContain('"type":"final"'); // Final does not erase nonzero cleanup.
        expect(d.cleanupFailures).toBe(
          scenario.startsWith("abort")
            ? 2
            : scenario.startsWith("dispose")
              ? 4
              : 1,
        );
      }
    } else if (
      ["line-bound", "frame-bound", "aggregate-bound", "final-bound"].includes(
        scenario,
      )
    ) {
      expect(d).toMatchObject({
        stage: "events",
        class: "event-projection-failed",
      });
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
            ? "length"
            : scenario,
      });
    if (beforeReady)
      expect(captureSummary(result.stdout), result.stderr).toBe("");
    else if (!/^(abort|dispose|unsubscribe)-/.test(scenario))
      expect(captureSummary(result.stdout)).not.toContain('"type":"final"');
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
  const end = source.indexOf("  // Public awaited core subscription", start);
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
const captureFixtureImports = `    import { LIMITS, closed, decodeWorkerPublicRequest, parseWireJson } from ${JSON.stringify(new URL("../src/worker-public.mjs", import.meta.url).href)};
    import { CaptureEmitter, SdkCapture } from ${JSON.stringify(new URL("../src/worker-capture.mjs", import.meta.url).href)};
    import { own } from ${JSON.stringify(new URL("../src/worker-redaction.mjs", import.meta.url).href)};
    import { captureBash, ToolIngress } from ${JSON.stringify(new URL("../src/worker-tools.mjs", import.meta.url).href)};
    const createLocalBashOperations = () => { throw new Error("Fixture bash forbidden"); };
`;
const mockBootstrap = (
  lane: string,
  delivery = "awaited",
  requestedThinkingLevel: unknown = "off",
) => {
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
      get code() { exceptionReads++; throw fault; },
      get cause() { exceptionReads++; throw fault; },
      get headers() { exceptionReads++; throw fault; },
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
    let sessionThinkingLevel;
    let thinkingReads = 0;
    let modelReads = 0;
    let selectedModel;
    const counts = {subscribes:0,prompts:0,streamReads:0,requests:0};
    const thinkingLane = lane.startsWith("thinking-");
    const message = {role:"assistant",stopReason:"stop",content:[{type:"text",text:"WIRE_OK"}]};
    const fixtureSession = {
      get thinkingLevel() {
        thinkingReads++;
        if (lane === "thinking-throw") throw opaqueFault;
        if (lane === "thinking-missing") return undefined;
        if (lane === "thinking-null") return null;
        if (lane === "thinking-number") return 1;
        if (lane === "thinking-object") return badValue;
        if (lane === "thinking-mismatch") return "off";
        return sessionThinkingLevel;
      },
      get model() { modelReads++; return selectedModel; },
      messages:[message], systemPrompt:"fixture", getLastAssistantText:()=>"WIRE_OK",
      agent:{state:{tools:[]},toolExecution:"parallel", subscribe(callback) { return fixtureSession.subscribe(callback); }, get streamFunction() { counts.streamReads++; return ()=>{ counts.requests++; }; },
        set streamFunction(value) { this.wrapped = value; }},
      subscribe(callback) {
        counts.subscribes++;
        listener = callback;
        return () => { if (lane === "unsubscribe-opaque") throw opaqueFault; };
      },
      abort() {
        aborts++;
        if (lane === "cleanup-unsettled") return new Promise(() => {});
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
        counts.prompts++;
        if (thinkingLane) await this.agent.wrapped(this.model,{},{});
        if (lane === "preflight-resolve") {
          options.preflightResult(false);
          await listener({type:"message_start",message:{role:"assistant"}}); await listener({type:"message_end",message});
          return; // Negative peer: reject callback, but valid stop and resolve.
        }
        options.preflightResult(true);
        if (lane === "prompt-opaque" || lane === "cleanup-unsettled") throw opaqueFault;
        if (lane === "event-abort-reject" || lane.startsWith("event-") ||
            /^(message|role|stop|update|delta|tool)-/.test(lane)) {
          const event = lane === "event-abort-reject" ? getter({type:"message_end"},"message") : badEvent();
          const dispatch = async () => {
            deliveries++;
            await listener(event);
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
        await listener({type:"message_start",message:{role:"assistant"}}); await listener({type:"message_end",message});
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
    const SettingsManager = {inMemory:settings=>{
      assert.deepEqual(settings,{compaction:{enabled:false},retry:{enabled:false},cacheWarming:"off"});
      return {};
    }};
    const createAgentSession = async options => {
      assert.equal(options.thinkingLevel,${JSON.stringify(requestedThinkingLevel ?? "off")});
      selectedModel = options.model;
      sessionThinkingLevel = options.thinkingLevel;
      if (lane === "thinking-absent") delete fixtureSession.thinkingLevel;
      return {session:fixtureSession};
    };

    ${captureFixtureImports}
    ${source.slice(start)}
    assert.equal(thinkingReads,lane === "thinking-absent" ? 0 : 1);
    if (thinkingLane) {
      const success = lane === "thinking-match";
      assert.deepEqual(counts,{subscribes:success?1:0,prompts:success?1:0,streamReads:success?1:0,requests:success?1:0});
      // Mismatch is rejected even after all three public identity reads match.
      if (!success && lane !== "thinking-throw") assert.equal(modelReads,3);
    }
    assert.equal(exceptionReads,0);
    assert.equal(disposed,true);
    assert.equal(aborts,deliveries ? 2 : 1); // Coalesced request plus independent cleanup.
    assert.equal(deliveries,${eventFaults.includes(lane as any) || lane === "event-abort-reject" ? 3 : 0});
  `;
};
for (const thinkingLevel of [
  undefined,
  null,
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]) {
  it(`PUBLIC BOUNDARY MOCK exact effective-thinking match: ${thinkingLevel}`, async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cadence-sdk-thinking-mock-"));
    const result = await nativeWorker(
      cwd,
      JSON.stringify({ ...fixtureRequest(cwd), thinkingLevel }),
      true,
      thinkingLevel === "max"
        ? undefined
        : mockBootstrap("thinking-match", "awaited", thinkingLevel),
    );
    if (thinkingLevel === "max") {
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(diagnostic(result.stderr)).toMatchObject({
        stage: "parse",
        class: "parse-failed",
      });
      return;
    }
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(captureSummary(result.stdout), result.stderr).toBe(
      '{"type":"ready"}\n{"type":"final","text":"WIRE_OK","stopReason":"stop"}\n',
    );
    expect(readdirSync(cwd)).toEqual([]);
  }, 20000);
}
for (const lane of [
  "mismatch",
  "absent",
  "missing",
  "null",
  "number",
  "object",
  "throw",
]) {
  it(`PUBLIC BOUNDARY MOCK effective-thinking refusal/no getter coercion: ${lane}`, async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cadence-sdk-thinking-mock-"));
    const result = await nativeWorker(
      cwd,
      JSON.stringify({ ...fixtureRequest(cwd), thinkingLevel: "high" }),
      true,
      mockBootstrap(`thinking-${lane}`, "awaited", "high"),
    );
    expect(result.exitCode).toBe(1);
    expect(captureSummary(result.stdout), result.stderr).toBe("");
    expect(result.stderr).not.toContain(rawCanary);
    expect(result.stderr).not.toMatch(
      /Error:|UnhandledPromiseRejection|\bat file:|\bat async/,
    );
    expect(diagnostic(result.stderr)).toMatchObject({
      stage: "session",
      class: "model-substitution",
      sdkEvents: 0,
      preflight: "UNKNOWN",
      requestPrepared: false,
      actualResponseStatus: "UNKNOWN",
      terminalStopReason: "UNKNOWN",
      cleanupFailures: 0,
      cleanupSettled: true,
    });
    expect(readdirSync(cwd)).toEqual([]);
  }, 20000);
}

it("raw native mock preserves first failure before unsettled cleanup", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "cadence-sdk-unsettled-"));
  const result = await nativeWorker(
    cwd,
    JSON.stringify(fixtureRequest(cwd)),
    true,
    mockBootstrap("cleanup-unsettled"),
  );
  expect(result.exitCode).toBe(1);
  expect(captureSummary(result.stdout), result.stderr).toBe(
    '{"type":"ready"}\n',
  );
  expect(result.stderr).not.toContain(rawCanary);
  expect(result.stderr).not.toMatch(
    /Error:|UnhandledPromiseRejection|\bat file:|\bat async/,
  );
  expect(result.stderr).not.toContain(genericFailure);
  expect(diagnostic(result.stderr)).toMatchObject({
    stage: "prompt",
    class: "sdk-failure",
    cleanupSettled: false,
    cleanupFailures: 0,
    preflight: "accepted",
    terminalStopReason: "UNKNOWN",
    requestPrepared: false,
    actualResponseStatus: "UNKNOWN",
  });
  expect(readdirSync(cwd)).toEqual([]);
}, 20000);

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
      expect(captureSummary(result.stdout), result.stderr).toBe(
        '{"type":"ready"}\n',
      );
      expect(result.stderr).not.toContain(rawCanary);
      expect(result.stderr).not.toMatch(
        /Error:|UnhandledPromiseRejection|\bat file:|\bat async/,
      );
      expect(diagnostic(result.stderr)).toMatchObject({
        stage: "events",
        class: "event-projection-failed",
        sdkEvents: 5,
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
    expect(captureSummary(result.stdout), result.stderr).toBe(
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

// Offline routing controls through production runWorker + byte-identical SDK worker.
// An expected SDK transport failure is never model inference or workflow qualification.
for (const mode of ["DIRECT", "VALIDATED_PROXY"] as const) {
  it(`actual runWorker/public pinned Codex native routing: ${mode}`, async () => {
    const feature =
      !!process.versions.node &&
      !process.versions.bun &&
      process.allowedNodeEnvironmentFlags.has("--use-env-proxy");
    const cwd = mkdtempSync(join(tmpdir(), "cadence-sdk-routing-"));
    const sockets = new Set<Socket>();
    let sinkContacts = 0;
    let proxyContacts = 0;
    let exactConnects = 0;
    let unexpected = false;
    let target = "";
    const track = (socket: Socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => {
        unexpected = true;
      });
      socket.setTimeout(5000, () => {
        unexpected = true;
        socket.destroy();
      });
    };
    const sink = createTCPServer((socket) => {
      sinkContacts++;
      track(socket);
      if (sinkContacts > 8) unexpected = true;
      socket.end(); // Fake HTTPS endpoint: no TLS override, inference or forwarding.
    });
    const proxy = createServer({ maxHeaderSize: 8192 }, (_req, res) => {
      unexpected = true;
      res.writeHead(502);
      res.end("FABRICATED_PROXY_BODY_CANARY");
    });
    proxy.on("connection", (socket) => {
      proxyContacts++;
      track(socket);
      if (proxyContacts > 8) unexpected = true;
    });
    proxy.on("connect", (req, socket) => {
      if (
        req.method !== "CONNECT" ||
        req.url !== target ||
        Buffer.byteLength(req.rawHeaders.join("\r\n")) > 8192
      )
        unexpected = true;
      else exactConnects++;
      // Never retain headers, tunnel, resolve DNS or contact the target from the proxy.
      const body = "FABRICATED_PROXY_BODY_CANARY";
      socket.end(
        `HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
      );
    });
    proxy.on("clientError", (_error, socket) => {
      unexpected = true;
      socket.destroy();
    });
    await new Promise<void>((resolve) => sink.listen(0, "127.0.0.1", resolve));
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    try {
      const sinkAddress = sink.address();
      const proxyAddress = proxy.address();
      if (
        !sinkAddress ||
        typeof sinkAddress === "string" ||
        !proxyAddress ||
        typeof proxyAddress === "string"
      )
        throw new Error("Synthetic routing fixture unavailable");
      target = `127.0.0.1:${sinkAddress.port}`;
      const route = `http://127.0.0.1:${proxyAddress.port}`;
      if (mode === "VALIDATED_PROXY") {
        process.env.http_proxy = route;
        process.env.https_proxy = route;
      }
      const key = `e30.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "fixture-account" } })).toString("base64url")}.fixture`;
      const literal = "!fabricated-header-$NO_EXPANSION";
      const request = {
        cwd,
        model: {
          ...fixtureModel(`https://${target}/exact/v1`),
          provider: "openai-codex",
          api: "openai-codex-responses",
        },
        auth: {
          ok: true as const,
          apiKey: key,
          headers: { "X-Literal": literal },
        },
        kind: "research" as const,
        thinkingLevel: "off",
        instructions:
          "Public synthetic routing fixture only. Never call tools.",
        prompt: "Answer WIRE_OK without tools.",
      };
      expect(
        JSON.parse(
          readFileSync(
            new URL(
              "../node_modules/@earendil-works/pi-ai/package.json",
              import.meta.url,
            ),
            "utf8",
          ),
        ).version,
      ).toBe("0.84.3");
      const workerSha256 = createHash("sha256")
        .update(readFileSync(new URL("../src/sdk-worker.mjs", import.meta.url)))
        .digest("hex");
      expect(workerSha256).toBe(
        "55016e65b7b10bbf3d360ae4828fb47395972fcc062afba3018c6a2250512544",
      );
      let productionObserved = false;
      let pid: number | undefined;
      let stdout = "";
      let stderr = "";
      let bytes = 0;
      let stdoutEOF = false;
      let stderrEOF = false;
      let inputDelivered = false;
      let inputError = false;
      let processError = false;
      let forced = false;
      const waits: {
        event: string;
        exitCode: number | null;
        signal: string | null;
      }[] = [];
      const calls = vi.mocked(spawn).mock.calls.length;
      // Observe genuine production options first, then add only the existing test guard.
      if (mode === "DIRECT" || feature)
        vi.mocked(spawn).mockImplementationOnce((command, args, options) => {
          productionObserved = true;
          expect(command).toBe(process.execPath);
          expect(args).toEqual([
            fileURLToPath(new URL("../src/sdk-worker.mjs", import.meta.url)),
          ]);
          expect(options?.stdio).toEqual(["pipe", "pipe", "pipe"]);
          expect(options?.env).toEqual(
            mode === "DIRECT"
              ? safeChildEnv()
              : {
                  ...safeChildEnv(),
                  HTTP_PROXY: route,
                  HTTPS_PROXY: route,
                  NODE_USE_ENV_PROXY: "1",
                },
          );
          expect(options?.windowsVerbatimArguments).toBeUndefined();
          const child = originalNativeSpawn(
            command,
            [
              "--import",
              new URL("./helpers/lightweight-sdk-guard.mjs", import.meta.url)
                .href,
              ...args!,
            ],
            options,
          );
          pid = child.pid;
          const collect = (chunk: Buffer, out: boolean) => {
            bytes += chunk.length;
            if (bytes > 256 * 1024) {
              forced = true;
              child.kill("SIGKILL");
            } else if (out) stdout += chunk.toString("utf8");
            else stderr += chunk.toString("utf8");
          };
          child.stdout?.on("data", (chunk: Buffer) => collect(chunk, true));
          child.stderr?.on("data", (chunk: Buffer) => collect(chunk, false));
          child.stdout?.once("end", () => {
            stdoutEOF = true;
          });
          child.stderr?.once("end", () => {
            stderrEOF = true;
          });
          child.stdin?.once("finish", () => {
            inputDelivered = true;
          });
          child.stdin?.on("error", () => {
            inputError = true;
          });
          child.on("error", () => {
            processError = true;
          });
          child.on("exit", (exitCode, signal) =>
            waits.push({ event: "exit", exitCode, signal }),
          );
          child.on("close", (exitCode, signal) =>
            waits.push({ event: "close", exitCode, signal }),
          );
          return child;
        });
      const result = await runWorker(
        request,
        new AbortController().signal,
        undefined,
        15000,
      );
      const startup =
        mode === "VALIDATED_PROXY" && feature
          ? proxyStartupStderr(stderr, pid!)
          : { workerStderr: stderr, runtimeWarning: null };
      const receipt = {
        boundary: "production-runWorker-stock-public-Codex-loopback",
        nativeAggregateBytes: bytes, // Includes the original runtime warning bytes.
        nodeRuntimeWarning: startup.runtimeWarning,
        mode,
        nativeProxyFeature: feature,
        node: process.versions.node,
        bun: !!process.versions.bun,
        executable: process.execPath,
        platform: process.platform,
        arch: process.arch,
        publicSDKVersion: "0.84.3",
        routingQualified:
          !unexpected &&
          (mode === "DIRECT"
            ? sinkContacts > 0 && proxyContacts === 0 && exactConnects === 0
            : feature &&
              sinkContacts === 0 &&
              proxyContacts > 0 &&
              exactConnects >= 1),
        pid: pid ?? null,
        productionObserved,
        waits,
        stdoutEOF,
        stderrEOF,
        inputDelivered,
        inputError,
        processError,
        forced,
        sinkContacts,
        proxyContacts,
        exactConnects,
        unexpected,
        workerSha256,
        result,
        paidProvider: false,
        workflowQualified: false,
      };
      if (process.env.CADENCE_SDK_TEST_EVIDENCE) {
        const root = process.env.CADENCE_SDK_TEST_EVIDENCE;
        for (const [name, text] of [
          ["stdout", stdout],
          ["stderr", stderr],
        ])
          writeFileSync(join(root, `routing-${mode}.${name}.log`), text, {
            flag: "wx",
            mode: 0o600,
          });
        writeFileSync(
          join(root, `routing-${mode}.json`),
          `${JSON.stringify(receipt)}\n`,
          { flag: "wx", mode: 0o600 },
        );
      }
      if (mode === "VALIDATED_PROXY" && !feature) {
        expect(productionObserved).toBe(false);
        expect(vi.mocked(spawn).mock.calls).toHaveLength(calls);
        expect(result).toMatchObject({
          outcome: "failed",
          closed: true,
          exitCode: null,
          signal: null,
          text: "unsupportedNetwork: SDK proxy configuration or runtime capability is unsupported; no worker launched.",
        });
        expect(sinkContacts + proxyContacts + exactConnects).toBe(0);
        return; // Admission/refusal PASS only; routingQualified:false, not a routed pass or skip.
      }
      expect(vi.mocked(spawn).mock.calls).toHaveLength(calls + 1);
      expect(pid).toBeGreaterThan(0);
      expect(productionObserved).toBe(true);
      expect(waits).toEqual([
        { event: "exit", exitCode: 1, signal: null },
        { event: "close", exitCode: 1, signal: null },
      ]);
      expect({
        stdoutEOF,
        stderrEOF,
        inputDelivered,
        inputError,
        processError,
        forced,
      }).toEqual({
        stdoutEOF: true,
        stderrEOF: true,
        inputDelivered: true,
        inputError: false,
        processError: false,
        forced: false,
      });
      expect(result).toMatchObject({
        outcome: "failed",
        closed: true,
        exitCode: 1,
        signal: null,
        truncated: false,
      });
      expect(result.durationMs).toBeLessThan(15000);
      expect(captureSummary(stdout)).toBe('{"type":"ready"}\n');
      for (const canary of [
        key,
        literal,
        route,
        target,
        "FABRICATED_PROXY_BODY_CANARY",
      ])
        expect(stdout + stderr).not.toContain(canary); // Original raw bytes, not the parsed or parent-redacted projection.
      expect(diagnostic(startup.workerStderr)).toMatchObject({
        stage: "assistant-final",
        class: "terminal-incomplete",
        preflight: "accepted",
        requestPrepared: true,
        terminalStopReason: "error",
        cleanupFailures: 0,
        cleanupSettled: true,
      });
      expect(unexpected).toBe(false);
      if (mode === "DIRECT") {
        expect(sinkContacts).toBeGreaterThan(0);
        expect(proxyContacts).toBe(0);
        expect(exactConnects).toBe(0);
      } else {
        expect(sinkContacts).toBe(0);
        expect(proxyContacts).toBeGreaterThan(0);
        expect(exactConnects).toBeGreaterThanOrEqual(1);
      }
      expect(readdirSync(cwd)).toEqual([]);
    } finally {
      for (const socket of sockets) socket.destroy();
      await Promise.all(
        [sink, proxy].map(
          (server) =>
            new Promise<void>((resolve, reject) =>
              server.close((error) => (error ? reject(error) : resolve())),
            ),
        ),
      );
    }
  }, 20000);
}

// PUBLIC RESOURCE BOUNDARY MOCKS ONLY. No native Undici API or SDK routing is
// replaced in the real routing controls above. These raw Node children execute
// the worker body with labelled SDK imports and a dynamic Undici import fixture.
const networkResourceBootstrap = (lane: string, mask = 0) => {
  const source = readFileSync(
    new URL("../src/sdk-worker.mjs", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("let session;");
  expect(start).toBeGreaterThan(0);
  const body = source.slice(start);
  expect(body.split('await import("undici")')).toHaveLength(2);
  return `
    import assert from "node:assert/strict";
    const lane = ${JSON.stringify(lane)};
    const mask = ${mask};
    const canary = ${JSON.stringify(rawCanary)};
    let exceptionReads = 0;
    const fault = {
      get message() { exceptionReads++; throw new Error(canary); },
      get stack() { exceptionReads++; throw new Error(canary); },
      get code() { exceptionReads++; throw new Error(canary); },
      toString() { exceptionReads++; throw new Error(canary); },
      [Symbol.toPrimitive]() { exceptionReads++; throw new Error(canary); },
    };
    const route = "http://127.0.0.1:12345";
    if (lane !== "direct") {
      process.env.HTTP_PROXY = route;
      process.env.HTTPS_PROXY = route;
      process.env.NODE_USE_ENV_PROXY = "1";
    }
    if (lane === "partial") delete process.env.HTTPS_PROXY;
    if (lane === "mismatch") process.env.HTTPS_PROXY = route + "/";
    if (lane === "bad-optin") process.env.NODE_USE_ENV_PROXY = "0";
    if (lane === "empty") process.env.HTTP_PROXY = process.env.HTTPS_PROXY = "";
    const order = ["sdk-import"];
    const counts = {imports:0, constructors:0, sets:0, gets:0, closes:0,
      prompts:0, requests:0, unsubscribes:0, aborts:0, disposes:0};
    let installed;
    let instance;
    const pending = lane.startsWith("pending-");
    let sessionThinkingLevel;
    const fixtureSession = {
      get thinkingLevel() { return sessionThinkingLevel; },
      model: undefined,
      systemPrompt:"fixture", messages:[{role:"assistant",stopReason:"stop",content:[{type:"text",text:"WIRE_OK"}]}],
      getLastAssistantText:()=>"WIRE_OK",
      agent:{state:{tools:[]},toolExecution:"parallel", subscribe(callback) { return session.subscribe(callback); },streamFunction:()=>{ counts.requests++; }},
      subscribe(listener) {
        this.listener = listener;
        return () => {
          order.push("unsubscribe"); counts.unsubscribes++;
          if (mask & 1) return Promise.reject(fault);
        };
      },
      abort() {
        order.push("abort"); counts.aborts++;
        if (lane === "pending-abort" || lane === "pending-abort-close-reject")
          return new Promise(()=>{});
        if (mask & 2) throw fault;
        return Promise.resolve();
      },
      dispose() {
        order.push("dispose"); counts.disposes++;
        if (mask & 4) return Promise.reject(fault);
      },
      async prompt(_prompt, options) {
        order.push("prompt"); counts.prompts++;
        options.preflightResult(true);
        if (lane === "prompt-fault" || lane === "pending-close") throw fault;
        if (lane === "pending-abort" || lane === "pending-abort-close-reject")
          await this.listener(null); // Starts the coalesced pending SDK abort.
        else await this.agent.streamFunction(this.model, {}, {});
        await this.listener({type:"message_start",message:{role:"assistant"}}); await this.listener({type:"message_end",message:this.messages[0]});
      },
    };
    const importUndiciFixture = async () => {
      order.push("undici-import"); counts.imports++;
      if (lane === "import-reject") throw fault;
      const api = {
        EnvHttpProxyAgent: class {
          constructor(options) {
            order.push("construct"); counts.constructors++;
            assert.deepEqual(options,{httpProxy:route,httpsProxy:route,noProxy:""});
            if (lane === "constructor-throw") throw fault;
            instance = this;
            if (lane === "close-getter") Object.defineProperty(this,"close",{get(){
              order.push("close"); counts.closes++; throw fault;
            }});
          }
          close() {
            assert.equal(this,instance);
            order.push("close"); counts.closes++;
            if (lane === "pending-close") return new Promise(()=>{});
            if (lane === "close-throw") throw fault;
            if ((mask & 8) || lane === "close-reject" ||
                lane === "setter-fault-close-reject" || lane === "pending-abort-close-reject")
              return Promise.reject(fault);
            return Promise.resolve();
          }
        },
        setGlobalDispatcher(agent) {
          order.push("set"); counts.sets++;
          assert.equal(agent,instance);
          if (lane === "setter-throw" || lane === "setter-fault-close-reject") throw fault;
          installed = agent;
        },
        getGlobalDispatcher() {
          order.push("get"); counts.gets++;
          if (lane === "getter-throw") throw fault;
          return lane === "getter-mismatch" ? {} : installed;
        },
      };
      for (const name of ["EnvHttpProxyAgent","setGlobalDispatcher","getGlobalDispatcher"]) {
        if (lane === "missing-" + name) delete api[name];
        if (lane === "bad-" + name) api[name] = 42;
        if (lane === "throwing-" + name)
          Object.defineProperty(api,name,{get(){throw fault;}});
      }
      return api;
    };
    const adapters = {"openai-completions":async()=>{
      order.push("adapter-import");
      if (lane === "captured") {
        process.env.HTTP_PROXY = process.env.HTTPS_PROXY = "http://127.0.0.1:54321";
        process.env.NO_PROXY = "*";
      }
      return {};
    }};
    class InMemoryCredentialStore {}
    class InMemoryModelsStore {}
    const ModelRuntime = {async create(options) {
      order.push("runtime");
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
      order.push("session");
      assert.deepEqual(options.resourceLoader.getSkills(),{skills:[],diagnostics:[]});
      assert.deepEqual(options.resourceLoader.getAgentsFiles(),{agentsFiles:[]});
      fixtureSession.model = options.model;
      sessionThinkingLevel = options.thinkingLevel;
      return {session:fixtureSession};
    };
    const verify = () => {
      assert.equal(exceptionReads,0);
      assert.ok(counts.imports <= 1 && counts.constructors <= 1 && counts.sets <= 1 && counts.closes <= 1);
      if (counts.closes) {
        const close = order.indexOf("close");
        for (const label of ["unsubscribe","dispose"])
          if (order.includes(label)) assert.ok(close < order.indexOf(label));
        // A coalesced abort is allowed before finally; its independent final
        // abort must still be attempted after close, even if either is pending.
        if (order.includes("abort")) assert.ok(close < order.lastIndexOf("abort"));
      }
      if (counts.prompts) {
        assert.equal(counts.unsubscribes,1);
        assert.equal(counts.disposes,1);
        assert.equal(counts.aborts,lane.startsWith("pending-abort") ? 2 : 1);
        if (lane !== "direct")
          assert.deepEqual(order.slice(0,8),["sdk-import","adapter-import","undici-import","construct","set","get","runtime","session"]);
      } else {
        assert.equal(counts.requests,0);
        assert.equal(counts.unsubscribes+counts.aborts+counts.disposes,0);
      }
      if (lane === "direct") {
        assert.equal(counts.imports+counts.constructors+counts.sets+counts.gets+counts.closes,0);
        assert.equal(counts.prompts,1);
      } else if (["success","captured","close-throw","close-reject","close-getter","cleanup-mask"].includes(lane)) {
        assert.equal(counts.prompts,1);
        assert.equal(counts.closes,1);
      } else if (!pending && lane !== "prompt-fault") {
        assert.equal(counts.prompts,0);
        const allocated = ["setter-throw","setter-fault-close-reject","getter-throw","getter-mismatch"].includes(lane);
        assert.equal(counts.closes,allocated ? 1 : 0);
        assert.equal(counts.constructors,allocated || lane === "constructor-throw" ? 1 : 0);
        assert.equal(counts.sets,allocated ? 1 : 0);
        assert.equal(counts.gets,lane.startsWith("getter-") ? 1 : 0);
      }
      if (pending) {
        assert.equal(cleanupSettled,false);
        assert.equal(counts.closes,1);
        assert.equal(process.exitCode,1);
        assert.equal(cleanupFailures,lane === "pending-abort-close-reject" ? 8 : 0);
      }
    };
    if (pending) process.once("beforeExit",verify);
    ${captureFixtureImports}
    ${body.replace('await import("undici")', "await importUndiciFixture()")}
    verify();
    assert.equal(cleanupSettled,true);
  `;
};

for (const lane of [
  "direct",
  "success",
  "captured",
  "partial",
  "mismatch",
  "bad-optin",
  "empty",
  "import-reject",
  ...[
    "EnvHttpProxyAgent",
    "setGlobalDispatcher",
    "getGlobalDispatcher",
  ].flatMap((name) =>
    ["missing-", "bad-", "throwing-"].map((prefix) => prefix + name),
  ),
  "constructor-throw",
  "setter-throw",
  "setter-fault-close-reject",
  "getter-throw",
  "getter-mismatch",
  "close-throw",
  "close-reject",
  "close-getter",
  "prompt-fault",
  "pending-close",
  "pending-abort",
  "pending-abort-close-reject",
]) {
  it(`PUBLIC RESOURCE MOCK bootstrap/ownership/raw cleanup: ${lane}`, async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cadence-network-resource-mock-"));
    const request = fixtureRequest(cwd);
    // Literal scoped routes never become process routing, even in DIRECT.
    request.auth.env = {
      ...request.auth.env,
      HTTP_PROXY: "http://127.0.0.1:12345",
      HTTPS_PROXY: "http://127.0.0.1:12345",
      NODE_USE_ENV_PROXY: "1",
    } as any;
    const result = await nativeWorker(
      cwd,
      JSON.stringify(request),
      true,
      networkResourceBootstrap(lane, lane === "prompt-fault" ? 15 : 0),
    );
    const success = ["direct", "success", "captured"].includes(lane);
    const cleanup = lane.startsWith("close-");
    const pending = lane.startsWith("pending-");
    const promptFault = lane === "prompt-fault" || lane === "pending-close";
    expect(result.exitCode).toBe(success ? 0 : 1);
    expect(captureSummary(result.stdout), result.stderr).toBe(
      success || cleanup
        ? '{"type":"ready"}\n{"type":"final","text":"WIRE_OK","stopReason":"stop"}\n'
        : pending || promptFault
          ? '{"type":"ready"}\n'
          : "",
    );
    expect(result.stderr).not.toContain(rawCanary);
    expect(result.stderr).not.toMatch(
      /Error:|UnhandledPromiseRejection|\bat file:|\bat async|127\.0\.0\.1|fabricated/i,
    );
    if (success) expect(result.stderr).toBe("");
    else
      expect(diagnostic(result.stderr)).toMatchObject({
        stage: cleanup
          ? "cleanup"
          : promptFault
            ? "prompt"
            : pending
              ? "events"
              : "network",
        class: cleanup
          ? "cleanup-failure"
          : promptFault
            ? "sdk-failure"
            : pending
              ? "event-projection-failed"
              : "unsupported-network",
        cleanupFailures: pending
          ? 0
          : lane === "prompt-fault"
            ? 15
            : cleanup || lane === "setter-fault-close-reject"
              ? 8
              : 0,
        cleanupSettled: !pending,
        requestPrepared: false,
      });
    expect(readdirSync(cwd)).toEqual([]);
  }, 20000);
}
for (let mask = 8; mask <= 15; mask++) {
  it(`PUBLIC RESOURCE MOCK valid final cannot repair native nonzero cleanup bits=${mask}`, async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cadence-network-cleanup-mock-"));
    const result = await nativeWorker(
      cwd,
      JSON.stringify(fixtureRequest(cwd)),
      true,
      networkResourceBootstrap("cleanup-mask", mask),
    );
    expect(result.exitCode).toBe(1);
    expect(captureSummary(result.stdout), result.stderr).toBe(
      '{"type":"ready"}\n{"type":"final","text":"WIRE_OK","stopReason":"stop"}\n',
    );
    expect(diagnostic(result.stderr)).toMatchObject({
      stage: "cleanup",
      class: "cleanup-failure",
      cleanupFailures: mask,
      cleanupSettled: true,
      terminalStopReason: "stop",
    });
    expect(result.stderr).not.toContain(rawCanary);
    expect(readdirSync(cwd)).toEqual([]);
  }, 20000);
}

// NATIVE public SDK + public Undici, loopback fake completions only. The proxy
// returns a fixed response itself: no forwarding, TLS override or fetch patch.
for (const encoding of ["identity", "gzip"] as const) {
  it(`actual runWorker/public HTTP proxy successful synthetic response: ${encoding}`, async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cadence-sdk-proxy-response-"));
    let sinkContacts = 0;
    let requests = 0;
    let unexpected = false;
    let endpoint = "";
    const sockets = new Set<Socket>();
    const sink = createServer((_req, res) => {
      sinkContacts++;
      res.writeHead(500);
      res.end();
    });
    const proxy = createServer({ maxHeaderSize: 8192 }, async (req, res) => {
      try {
        requests++;
        if (req.method !== "POST" || req.url !== endpoint || requests !== 1)
          throw new Error("Fixture request mismatch");
        let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 128 * 1024) throw new Error("Fixture request bound");
        }
        const event = (delta: any, finish_reason: string | null = null) =>
          `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture-model", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
        const plain = Buffer.from(
          event({ role: "assistant", content: "WIRE_OK" }) +
            event({}, "stop") +
            "data: [DONE]\n\n",
        );
        const body = encoding === "gzip" ? gzipSync(plain) : plain;
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "content-encoding": encoding,
          "content-length": body.length,
          connection: "close",
        });
        res.end(body);
      } catch {
        unexpected = true;
        res.writeHead(500);
        res.end();
      }
    });
    proxy.on("connect", (_req, socket) => {
      unexpected = true; // This HTTP fixture requires the public absolute form.
      socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
    });
    for (const server of [sink, proxy])
      server.on("connection", (socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
        socket.on("error", () => {
          unexpected = true;
        });
      });
    await new Promise<void>((resolve) => sink.listen(0, "127.0.0.1", resolve));
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    try {
      const target = sink.address();
      const address = proxy.address();
      if (
        !target ||
        typeof target === "string" ||
        !address ||
        typeof address === "string"
      )
        throw new Error("Fixture unavailable");
      const baseUrl = `http://127.0.0.1:${target.port}/v1`;
      endpoint = `${baseUrl}/chat/completions`;
      const route = `http://127.0.0.1:${address.port}`;
      process.env.HTTP_PROXY = process.env.HTTPS_PROXY = route;
      const request = fixtureRequest(cwd, fixtureModel(baseUrl));
      const feature =
        !!process.versions.node &&
        !process.versions.bun &&
        process.allowedNodeEnvironmentFlags.has("--use-env-proxy");
      let childPID: number | undefined;
      let stdout = "";
      let stderr = "";
      let bytes = 0;
      let forced = false;
      let stdoutEOF = false;
      let stderrEOF = false;
      let inputDelivered = false;
      let inputError = false;
      let processError = false;
      const waits: {
        event: string;
        exitCode: number | null;
        signal: string | null;
      }[] = [];
      const calls = vi.mocked(spawn).mock.calls.length;
      if (feature)
        vi.mocked(spawn).mockImplementationOnce((command, args, options) => {
          expect(command).toBe(process.execPath);
          expect(args).toEqual([
            fileURLToPath(new URL("../src/sdk-worker.mjs", import.meta.url)),
          ]);
          expect(options?.env).toEqual({
            ...safeChildEnv(),
            HTTP_PROXY: route,
            HTTPS_PROXY: route,
            NODE_USE_ENV_PROXY: "1",
          });
          const child = originalNativeSpawn(
            command,
            [
              "--import",
              new URL("./helpers/lightweight-sdk-guard.mjs", import.meta.url)
                .href,
              ...args!,
            ],
            options,
          );
          childPID = child.pid;
          const collect = (chunk: Buffer, out: boolean) => {
            bytes += chunk.length;
            if (bytes > 256 * 1024) {
              forced = true;
              child.kill("SIGKILL");
            } else if (out) stdout += chunk.toString("utf8");
            else stderr += chunk.toString("utf8");
          };
          child.stdout?.on("data", (chunk: Buffer) => collect(chunk, true));
          child.stderr?.on("data", (chunk: Buffer) => collect(chunk, false));
          child.stdout?.once("end", () => {
            stdoutEOF = true;
          });
          child.stderr?.once("end", () => {
            stderrEOF = true;
          });
          child.stdin?.once("finish", () => {
            inputDelivered = true;
          });
          child.stdin?.on("error", () => {
            inputError = true;
          });
          child.on("error", () => {
            processError = true;
          });
          child.on("exit", (exitCode, signal) =>
            waits.push({ event: "exit", exitCode, signal }),
          );
          child.on("close", (exitCode, signal) =>
            waits.push({ event: "close", exitCode, signal }),
          );
          return child;
        });
      const result = await runWorker(
        request as any,
        new AbortController().signal,
        undefined,
        15000,
      );
      const startup = feature
        ? proxyStartupStderr(stderr, childPID!)
        : { workerStderr: stderr, runtimeWarning: null };
      const receipt = {
        boundary: "native-public-proxy-fixed-completions",
        encoding,
        node: process.versions.node,
        executable: process.execPath,
        pid: childPID ?? null,
        feature,
        result,
        waits,
        inputDelivered,
        inputError,
        processError,
        stdoutEOF,
        stderrEOF,
        forced,
        nativeAggregateBytes: bytes,
        nodeRuntimeWarning: startup.runtimeWarning,
        sinkContacts,
        requests,
        unexpected,
        paidProvider: false,
      };
      if (process.env.CADENCE_SDK_TEST_EVIDENCE) {
        const root = process.env.CADENCE_SDK_TEST_EVIDENCE;
        for (const [name, text] of [
          ["stdout", stdout],
          ["stderr", stderr],
          ["json", `${JSON.stringify(receipt)}\n`],
        ])
          writeFileSync(
            join(root, `proxy-response-${encoding}.${name}`),
            text,
            { flag: "wx", mode: 0o600 },
          );
      }
      if (!feature) {
        expect(vi.mocked(spawn).mock.calls).toHaveLength(calls);
        expect(result).toMatchObject({
          outcome: "failed",
          closed: true,
          exitCode: null,
          signal: null,
          text: "unsupportedNetwork: SDK proxy configuration or runtime capability is unsupported; no worker launched.",
        });
        expect(sinkContacts + requests).toBe(0);
        return; // Unqualified network admission refusal, not successful routing.
      }
      expect(vi.mocked(spawn).mock.calls).toHaveLength(calls + 1);
      expect(childPID).toBeGreaterThan(0);
      expect(waits).toEqual([
        { event: "exit", exitCode: 0, signal: null },
        { event: "close", exitCode: 0, signal: null },
      ]);
      expect({
        inputDelivered,
        inputError,
        processError,
        stdoutEOF,
        stderrEOF,
        forced,
      }).toEqual({
        inputDelivered: true,
        inputError: false,
        processError: false,
        stdoutEOF: true,
        stderrEOF: true,
        forced: false,
      });
      expect(result).toMatchObject({
        outcome: "completed",
        closed: true,
        exitCode: 0,
        signal: null,
        text: "WIRE_OK",
        truncated: false,
      });
      expect(captureSummary(stdout)).toBe(
        '{"type":"ready"}\n{"type":"final","text":"WIRE_OK","stopReason":"stop"}\n',
      );
      expect(startup.workerStderr).toBe("");
      for (const canary of [
        request.auth.apiKey,
        request.auth.headers["X-Literal"],
        route,
        baseUrl,
      ])
        expect(stdout + stderr).not.toContain(canary);
      expect({ sinkContacts, requests, unexpected }).toEqual({
        sinkContacts: 0,
        requests: 1,
        unexpected: false,
      });
      expect(readdirSync(cwd)).toEqual([]);
    } finally {
      for (const socket of sockets) socket.destroy();
      await Promise.all(
        [sink, proxy].map(
          (server) =>
            new Promise<void>((resolve, reject) =>
              server.close((error) => (error ? reject(error) : resolve())),
            ),
        ),
      );
    }
  }, 20000);
}
