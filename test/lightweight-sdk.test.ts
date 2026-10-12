import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
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
import { expect, it } from "vitest";
import { runProcess } from "../src/subagent-process.ts";

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
          fileURLToPath(
            new URL("./helpers/lightweight-sdk-guard.mjs", import.meta.url),
          ),
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
