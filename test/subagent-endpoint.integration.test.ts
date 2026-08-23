// E2E: the custom phase runtime streams a real child session against a
// local HTTP endpoint. Verifies request routing, credentials, dialect,
// bounds shaping, keyless dispatch, retry-disablement, bridge bypass, and
// key privacy.

import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runChildSession } from "../src/child-session.ts";
import { customPhaseRuntime } from "../src/parent-provider.ts";
import type { SubagentEndpoint } from "../src/subagent-endpoint.ts";

const TIMEOUT_MS = 20000;

interface RecordedRequest {
  url: string;
  authorization: string | undefined;
  xApiKey: string | undefined;
  body: Record<string, unknown>;
}

interface FakeEndpoint {
  url: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

async function startEndpoint(
  respond: (req: RecordedRequest) => { status: number; body?: string },
): Promise<FakeEndpoint> {
  const requests: RecordedRequest[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const recorded: RecordedRequest = {
        url: req.url ?? "",
        authorization:
          req.headers.authorization === undefined
            ? undefined
            : String(req.headers.authorization),
        xApiKey:
          req.headers["x-api-key"] === undefined
            ? undefined
            : String(req.headers["x-api-key"]),
        body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
      };
      requests.push(recorded);
      const outcome = respond(recorded);
      res.writeHead(outcome.status, { "content-type": "text/event-stream" });
      res.end(outcome.body ?? "");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("server has no address");
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function completionsSSE(model: string, args: string): string {
  const chunk = (payload: Record<string, unknown>) =>
    `data: ${JSON.stringify(payload)}\n\n`;
  const base = {
    id: "chatcmpl-1",
    object: "chat.completion.chunk",
    created: 1,
    model,
  };
  return (
    chunk({
      ...base,
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content: "" },
          finish_reason: null,
        },
      ],
    }) +
    chunk({
      ...base,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call-1",
                type: "function",
                function: { name: "abel_submit_result", arguments: args },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    }) +
    chunk({
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 4, completion_tokens: 8, total_tokens: 12 },
    }) +
    "data: [DONE]\n\n"
  );
}

function evidenceArgs(requestId: string, role: string): string {
  return JSON.stringify({
    id: requestId,
    role,
    kind: "evidence",
    conclusions: ["endpoint reachable"],
    citations: [],
    constraints: [],
    dependencies: [],
    risks: [],
    blockingQuestions: [],
    hints: {
      writeSet: [],
      verification: "bun run check",
      agentsImpact: "none",
    },
  });
}

function endpoint(
  url: string,
  overrides: Partial<Omit<SubagentEndpoint, "url">> = {},
): SubagentEndpoint {
  return {
    url,
    model: "subagent-endpoint-model",
    dialect: "openai-completions",
    // Large context window so the output cap is the configured maxTokens,
    // not the remaining-context budget.
    contextWindow: 100000,
    maxTokens: 4096,
    ...overrides,
  };
}

// The configured max output tokens may surface as max_tokens or
// max_completion_tokens depending on endpoint compatibility detection.
function outputTokenCap(body: Record<string, unknown>): unknown {
  return body.max_tokens ?? body.max_completion_tokens;
}

const roots: string[] = [];
const endpoints: FakeEndpoint[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
  for (const fake of endpoints.splice(0)) await fake.close();
});

async function runChild(ep: SubagentEndpoint): Promise<{
  child: Awaited<ReturnType<typeof runChildSession>>;
  model: { contextWindow: number; maxTokens: number; reasoning: boolean };
}> {
  const phase = await customPhaseRuntime(ep);
  if (!phase.ok) throw new Error(`custom phase runtime failed: ${phase.error}`);
  const cwd = mkdtempSync(join(tmpdir(), "abel-endpoint-child-"));
  roots.push(cwd);
  const child = await runChildSession({
    cwd,
    modelRuntime: phase.modelRuntime,
    model: phase.model,
    systemPrompt: "Return endpoint evidence.",
    requestId: "endpoint-evidence-1",
    role: "design-explorer",
    output: "evidence",
    roots: [cwd],
    timeoutMs: 15000,
  });
  return { child, model: phase.model as never };
}

describe("custom phase runtime", () => {
  it(
    "sends the child request to the configured URL with model and bearer key",
    async () => {
      const fake = await startEndpoint((req) => ({
        status: 200,
        body: completionsSSE(
          req.body.model as string,
          evidenceArgs("endpoint-evidence-1", "design-explorer"),
        ),
      }));
      endpoints.push(fake);
      const { child, model } = await runChild(
        endpoint(fake.url, { apiKey: "sk-endpoint-secret" }),
      );
      expect(child.ok).toBe(true);
      expect(fake.requests).toHaveLength(1);
      const request = fake.requests[0];
      expect(request.url).toBe("/v1/chat/completions");
      expect(request.authorization).toBe("Bearer sk-endpoint-secret");
      expect(request.body.model).toBe("subagent-endpoint-model");
      expect(outputTokenCap(request.body)).toBe(4096);
      expect(request.body.stream).toBe(true);
      // Configured bounds shape the child model identity.
      expect(model).toMatchObject({
        contextWindow: 100000,
        maxTokens: 4096,
        reasoning: true,
      });
    },
    TIMEOUT_MS,
  );

  it(
    "sends no API-key credential for a keyless endpoint",
    async () => {
      const fake = await startEndpoint((req) => ({
        status: 200,
        body: completionsSSE(
          req.body.model as string,
          evidenceArgs("endpoint-evidence-1", "design-explorer"),
        ),
      }));
      endpoints.push(fake);
      const { child } = await runChild(endpoint(fake.url));
      expect(child.ok).toBe(true);
      expect(fake.requests).toHaveLength(1);
      const request = fake.requests[0];
      expect(request.authorization).toBeUndefined();
      expect(request.xApiKey).toBeUndefined();
      expect(JSON.stringify(fake.requests)).not.toContain("sk-");
    },
    TIMEOUT_MS,
  );

  it(
    "omits auth credentials and output cap for keyless OpenAI Responses",
    async () => {
      const fake = await startEndpoint(() => ({
        status: 500,
        body: JSON.stringify({ error: { message: "probe complete" } }),
      }));
      endpoints.push(fake);
      const { child } = await runChild(
        endpoint(fake.url, { dialect: "openai-responses" }),
      );
      expect(child.ok).toBe(false);
      expect(fake.requests).toHaveLength(1);
      const request = fake.requests[0];
      expect(request.url).toBe("/v1/responses");
      expect(request.authorization).toBeUndefined();
      expect(request.xApiKey).toBeUndefined();
      expect(request.body).not.toHaveProperty("max_output_tokens");
    },
    TIMEOUT_MS,
  );

  it(
    "omits auth credentials for a keyless Anthropic endpoint",
    async () => {
      const fake = await startEndpoint(() => ({
        status: 500,
        body: JSON.stringify({ error: { message: "probe complete" } }),
      }));
      endpoints.push(fake);
      const { child } = await runChild(
        endpoint(fake.url, { dialect: "anthropic-messages" }),
      );
      expect(child.ok).toBe(false);
      expect(fake.requests).toHaveLength(1);
      const request = fake.requests[0];
      expect(request.authorization).toBeUndefined();
      expect(request.xApiKey).toBeUndefined();
      expect(JSON.stringify(fake.requests)).not.toContain("unused");
    },
    TIMEOUT_MS,
  );

  it(
    "keeps the key out of every observable output",
    async () => {
      const key = "sk-privacy-secret";
      const fake = await startEndpoint((req) => ({
        status: 200,
        body: completionsSSE(
          req.body.model as string,
          evidenceArgs("endpoint-evidence-1", "design-explorer"),
        ),
      }));
      endpoints.push(fake);
      const { child, model } = await runChild(
        endpoint(fake.url, { apiKey: key }),
      );
      // Cadence-observable outputs: the dispatch result and the child model
      // identity. The wire Authorization header carries the key by design and
      // is not a Cadence-observable output.
      const observable = JSON.stringify({ child, model });
      expect(observable).not.toContain(key);
    },
    TIMEOUT_MS,
  );

  it(
    "dispatches without a parent payload bridge",
    async () => {
      const fake = await startEndpoint((req) => ({
        status: 200,
        body: completionsSSE(
          req.body.model as string,
          evidenceArgs("endpoint-evidence-1", "design-explorer"),
        ),
      }));
      endpoints.push(fake);
      // No bridge is supplied to the custom path; the dispatch must complete
      // regardless of parent payload bridge availability.
      const { child } = await runChild(
        endpoint(fake.url, { apiKey: "sk-bridgeless" }),
      );
      expect(child.ok).toBe(true);
      expect(fake.requests).toHaveLength(1);
    },
    TIMEOUT_MS,
  );

  it(
    "performs no provider retry on transport failure",
    async () => {
      const fake = await startEndpoint(() => ({
        status: 500,
        body: JSON.stringify({ error: { message: "endpoint unavailable" } }),
      }));
      endpoints.push(fake);
      const phase = await customPhaseRuntime(endpoint(fake.url));
      if (!phase.ok)
        throw new Error(`custom phase runtime failed: ${phase.error}`);
      const cwd = mkdtempSync(join(tmpdir(), "abel-endpoint-retry-"));
      roots.push(cwd);
      const child = await runChildSession({
        cwd,
        modelRuntime: phase.modelRuntime,
        model: phase.model,
        systemPrompt: "Return endpoint evidence.",
        requestId: "endpoint-retry-1",
        role: "design-explorer",
        output: "evidence",
        roots: [cwd],
        timeoutMs: 15000,
      });
      expect(child.ok).toBe(false);
      if (child.ok) throw new Error("unreachable");
      expect(child.failure).toEqual({
        kind: "transport",
        code: "transport-failure",
      });
      // Provider retry disabled: a single network attempt, no retry.
      expect(fake.requests).toHaveLength(1);
    },
    TIMEOUT_MS,
  );
});
