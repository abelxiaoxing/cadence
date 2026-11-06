import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { normalizeContext, validateToolArguments } from "@earendil-works/pi-ai";
import { stream } from "@earendil-works/pi-ai/api/openai-responses";
import { expect, it, vi } from "vitest";
import { createResearchTools } from "../src/research-tools.mjs";
import { bindWorkerWorkspace } from "../src/worker-workspace.mjs";

const queries = {
  read: { path: "example.ts" },
  grep: { patterns: ["first", "second"], literal: false },
  find: { pattern: "*.ts" },
  glob: { pattern: "**/*.{ts,js}" },
  ls: {},
};
it("provider object schemas accept initial, continuation and explicit close arguments through the public SDK validator", async () => {
  const kit = createResearchTools(
    bindWorkerWorkspace(resolve("/unused-schema-fixture")),
  );
  try {
    for (const tool of kit.tools) {
      const schema = JSON.parse(JSON.stringify(tool.parameters));
      expect(schema.type, tool.name).toBe("object");
      expect(schema.anyOf, tool.name).toBeUndefined();
      expect(schema.additionalProperties, tool.name).toBe(false);
      for (const args of [
        queries[tool.name],
        { cursor: "opaque" },
        { cursor: "opaque", close: true },
      ]) {
        for (const input of [
          args,
          {
            ...Object.fromEntries(
              Object.keys(schema.properties).map((key) => [key, null]),
            ),
            ...args,
          },
        ]) {
          expect(
            validateToolArguments(tool, {
              type: "toolCall",
              id: "fixture",
              name: tool.name,
              arguments: input,
            }),
          ).toEqual(args);
        }
      }
    }
  } finally {
    await kit.close();
  }
});
it("SDK validation cannot turn a mixed query/cursor request into permission to consume a cursor", async () => {
  const root = await mkdtemp(join(tmpdir(), "research-schema-"));
  await writeFile(join(root, "a"), "first\nsecond");
  const kit = createResearchTools(bindWorkerWorkspace(root));
  const tool = kit.tools.find((entry) => entry.name === "read");
  const call = (args) =>
    tool.execute(
      "fixture",
      validateToolArguments(tool, {
        type: "toolCall",
        id: "fixture",
        name: tool.name,
        arguments: args,
      }),
    );
  try {
    const page = await call({ path: "a", pageSize: 1 });
    const cursor = page.details.nextCursor;
    await expect(call({ cursor, path: "a" })).rejects.toThrow("arguments");
    const next = await call({ cursor });
    expect(
      JSON.parse(next.content[0].text).items.map((item) => item.text),
    ).toEqual(["second"]);
    expect(next.details.state).toBe("done");
  } finally {
    await kit.close();
  }
});
it.each([false, true])(
  "public Responses adapter serializes observation tools as root objects (strict=%s), without network",
  async (strict) => {
    const kit = createResearchTools(
      bindWorkerWorkspace(resolve("/unused-schema-fixture")),
    );
    const tools = kit.tools.map((tool) => ({
      ...tool,
      ...(strict
        ? { constrainedSampling: { type: "json_schema", strict: "require" } }
        : {}),
    }));
    const model = {
      id: "schema-fixture",
      name: "Schema fixture",
      provider: "openai",
      api: "openai-responses",
      baseUrl: "http://127.0.0.1:1/never-contacted",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 8192,
      maxTokens: 128,
      compat: { supportsStrictMode: true },
    };
    const fetch = vi.fn(async () => {
      throw new Error("Network forbidden in schema fixture");
    });
    let payload;
    try {
      const result = await stream(
        model,
        // Pi 1.5 API adapters receive a normalized transcript, not raw Context.
        normalizeContext({ messages: [], tools }),
        {
          apiKey: "fabricated-schema-key",
          fetch,
          maxRetries: 0,
          onPayload(value) {
            payload = value;
            throw new Error("intentional pre-send fixture stop");
          },
        },
      ).result();
      expect(fetch).not.toHaveBeenCalled();
      expect(payload, result.errorMessage).toBeDefined();
      expect(result.errorMessage).toContain(
        "intentional pre-send fixture stop",
      );
      expect(payload.tools).toHaveLength(kit.tools.length);
      for (const tool of payload.tools) {
        expect(tool.parameters.type, tool.name).toBe("object");
        expect(tool.parameters.anyOf, tool.name).toBeUndefined();
        if (strict) expect(tool.strict).toBe(true);
      }
    } finally {
      await kit.close();
    }
  },
);
