import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Model } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import { expect, it } from "vitest";
import { disposeChildTransport, requestChildTurn } from "../src/child-model.ts";
import { parentRoutePolicy } from "../src/route-policy.ts";
import { WorkerBroker } from "../src/worker-broker.ts";

it("accepts real HTTP headers or body delayed eleven seconds through the public Provider adapter", async () => {
  async function probe(headersDelay: number, bodyDelay: number) {
    const started = Date.now();
    const received: number[] = [];
    const headers: number[] = [];
    const server = createServer((request, response) => {
      received.push(Date.now() - started);
      request.resume();
      const timer = setTimeout(() => {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.flushHeaders();
        const body = setTimeout(() => {
          response.write(
            `data: ${JSON.stringify({ id: "local", object: "chat.completion.chunk", created: 1, model: "local", choices: [{ index: 0, delta: { role: "assistant", content: "ready" }, finish_reason: null }] })}\n\n`,
          );
          response.write(
            `data: ${JSON.stringify({ id: "local", object: "chat.completion.chunk", created: 1, model: "local", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`,
          );
          response.end("data: [DONE]\n\n");
        }, bodyDelay);
        response.on("close", () => clearTimeout(body));
      }, headersDelay);
      response.on("close", () => clearTimeout(timer));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const model: Model<"openai-completions"> = {
      id: "local",
      name: "Local contract",
      api: "openai-completions",
      provider: "local-contract",
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 1024,
    };
    const sessionId = `http-${headersDelay}-${bodyDelay}`;
    try {
      const result = await new WorkerBroker(parentRoutePolicy()).run({
        operationId: sessionId,
        role: "design-explorer",
        execute: (attempt) =>
          requestChildTurn({
            client: {
              streamSimple: (_model, context, options) =>
                streamSimple(model, context, {
                  ...options,
                  apiKey: "local-contract",
                }),
            },
            model,
            context: {
              messages: [{ role: "user", content: "ready", timestamp: 1 }],
            },
            signal: attempt.signal,
            sessionId,
            onStart: attempt.onRequestStart,
            onHeaders: () => {
              headers.push(Date.now() - started);
              attempt.onHeaders();
            },
            onProgress: attempt.onProgress,
            onMessage() {},
          }),
      });
      expect(result).toMatchObject({
        ok: true,
        value: {
          stopReason: "stop",
          content: [{ type: "text", text: "ready" }],
        },
      });
      expect(received).toHaveLength(1);
      expect(headers).toHaveLength(1);
      expect(headers[0]! - received[0]!).toBeGreaterThanOrEqual(
        headersDelay - 50,
      );
    } finally {
      disposeChildTransport(sessionId);
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
  await Promise.all([probe(11000, 0), probe(0, 11000)]);
}, 25000);
