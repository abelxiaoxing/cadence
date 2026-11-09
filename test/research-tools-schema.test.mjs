import { resolve } from "node:path";
import { normalizeContext, validateToolArguments } from "@earendil-works/pi-ai";
import { stream } from "@earendil-works/pi-ai/api/openai-responses";
import {
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { createWorkerToolkit } from "../src/worker-toolkit.mjs";
import { bindWorkerWorkspace } from "../src/worker-workspace.mjs";
import { fixtureRuntime } from "./helpers/worker-runtime.ts";

const queries = {
  read: { path: "example.ts" },
  grep: { pattern: "first|second" },
  find: { pattern: "*.ts" },
  ls: {},
};
const validate = (tool, args) =>
  validateToolArguments(tool, {
    type: "toolCall",
    id: "fixture",
    name: tool.name,
    arguments: args,
  });
function toolkit() {
  const workspace = bindWorkerWorkspace(resolve("/unused-schema-fixture"));
  return createWorkerToolkit({
    runtime: fixtureRuntime(),
    purpose: "review",
    workspace,
    changes: {
      root: workspace.cwd,
      base: "a".repeat(40),
      candidate: "b".repeat(40),
    },
  });
}
it("ordinary observation uses the installed Pi definitions without a second parameter protocol", async () => {
  const kit = toolkit();
  const stock = [
    createReadToolDefinition,
    createGrepToolDefinition,
    createFindToolDefinition,
    createLsToolDefinition,
  ].map((create) => create(resolve("/unused-schema-fixture")));
  try {
    for (const original of stock) {
      const tool = kit.sessionOptions.customTools.find(
        (entry) => entry.name === original.name,
      );
      expect(tool.parameters).toEqual(original.parameters);
      expect(tool.description).toBe(original.description);
      expect(tool.constrainedSampling).toEqual(original.constrainedSampling);
      for (const retired of [
        "files",
        "ranges",
        "patterns",
        "pageSize",
        "cursor",
        "close",
      ])
        expect(tool.parameters.properties).not.toHaveProperty(retired);
      const args = queries[tool.name];
      expect(validate(tool, args)).toEqual(args);
      expect(
        validate(tool, {
          ...Object.fromEntries(
            Object.keys(tool.parameters.properties).map((key) => [key, null]),
          ),
          ...args,
        }),
      ).toEqual(args);
    }
    const read = kit.sessionOptions.customTools.find(
      (tool) => tool.name === "read",
    );
    expect(() => validate(read, { cursor: "invented", close: true })).toThrow();
    expect(kit.sessionOptions.tools).not.toContain("glob");
  } finally {
    await kit.close();
  }
});
it.each([undefined, false, true])(
  "public Responses serialization preserves Pi's ordinary tool shapes (strict capability=%s)",
  async (supportsStrictMode) => {
    const kit = toolkit();
    const tools = kit.wrap(kit.sessionOptions.customTools);
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
      ...(supportsStrictMode === undefined
        ? {}
        : { compat: { supportsStrictMode } }),
    };
    const fetch = vi.fn(async () => {
      throw new Error("Network forbidden");
    });
    let payload;
    try {
      const result = await stream(
        model,
        normalizeContext({ messages: [], tools }),
        {
          apiKey: "fabricated-schema-key",
          fetch,
          maxRetries: 0,
          onPayload(value) {
            payload = value;
            throw new Error("intentional pre-send stop");
          },
        },
      ).result();
      expect(fetch).not.toHaveBeenCalled();
      expect(payload, result.errorMessage).toBeDefined();
      expect(payload.tools).toHaveLength(5);
      for (const wire of payload.tools) {
        expect(wire.parameters.type).toBe("object");
        expect(wire.parameters.anyOf).toBeUndefined();
        if (wire.name === "changes") {
          // The specialized fixed-Git tool alone retains a cursor. Its inactive
          // fields stay nullable, even without strict conversion by the SDK.
          const parameters = {
            ...wire.parameters,
            required: Object.keys(wire.parameters.properties),
          };
          const args = {
            mode: null,
            path: null,
            cursor: "returned",
            close: true,
          };
          expect(validate({ ...wire, parameters }, args)).toEqual(args);
        } else {
          expect(wire.parameters.properties).not.toHaveProperty("cursor");
          expect(wire.parameters.properties).not.toHaveProperty("close");
          const input = wire.strict
            ? {
                ...Object.fromEntries(
                  Object.keys(wire.parameters.properties).map((key) => [
                    key,
                    null,
                  ]),
                ),
                ...queries[wire.name],
              }
            : queries[wire.name];
          expect(() => validate(wire, input)).not.toThrow();
        }
      }
    } finally {
      await kit.close();
    }
  },
);
