import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  inspectRoutePolicy,
  loadRoutePolicy,
  parseRoutePolicy,
  resolveCustomRoute,
} from "../src/route-policy.ts";
import { RunWorkerBroker } from "../src/worker-broker.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function root(label: string): string {
  const value = mkdtempSync(path.join(tmpdir(), `cadence-policy-${label}-`));
  roots.push(value);
  return value;
}

function completePolicy(): Record<string, unknown> {
  const roles = [
    "design-explorer",
    "implementation-worker",
    "diagnosis-worker",
  ];
  return {
    routes: {
      inherited: {
        kind: "inherited",
        capabilities: {
          roles,
          dialects: ["openai-responses"],
          contextWindow: 256000,
          maxTokens: 128000,
        },
      },
      custom: {
        kind: "custom",
        url: "https://worker.invalid/v1",
        model: "worker-model",
        dialect: "openai-responses",
        apiKeyEnv: "WORKER_TEST_KEY",
        capabilities: {
          roles,
          dialects: ["openai-responses"],
          contextWindow: 256000,
          maxTokens: 128000,
        },
      },
    },
    roles: Object.fromEntries(
      roles.map((role) => [role, ["inherited", "custom"]]),
    ),
  };
}

describe("route policy loading", () => {
  it("uses the inherited parent model when no route policy is configured", () => {
    const cwd = root("missing");
    const home = root("empty-home");
    const resolution = loadRoutePolicy({ cwd, home });
    expect(resolution).toMatchObject({
      ok: true,
      source: { kind: "default" },
      policy: {
        routes: { parent: { kind: "inherited" } },
      },
    });
    expect(inspectRoutePolicy(resolution)).toMatchObject({
      ok: true,
      source: { kind: "default" },
      routes: [{ id: "parent", kind: "inherited" }],
    });
  });

  it("uses the current parent bounds and rejects an incapable default route before launch", async () => {
    const cwd = root("low-capability-parent");
    const home = root("low-capability-home");
    const resolution = loadRoutePolicy({
      cwd,
      home,
      parentModel: { contextWindow: 32_768, maxTokens: 8_192 },
    });
    expect(resolution).toMatchObject({
      ok: true,
      source: { kind: "default" },
      policy: {
        routes: {
          parent: {
            capabilities: { contextWindow: 32_768, maxTokens: 8_192 },
          },
        },
      },
    });
    if (!resolution.ok) throw new Error("default policy fixture must load");

    let launches = 0;
    const broker = new RunWorkerBroker(resolution.policy);
    await expect(
      broker.run({
        runId: "low-capability-run",
        operationId: "low-capability-operation",
        role: "implementation-worker",
        requirements: {
          minContextWindow: 128_000,
          minOutputTokens: 64_000,
        },
        execute: async () => {
          launches += 1;
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      state: "paused",
      code: "endpoint-unavailable",
    });
    expect(launches).toBe(0);
  });

  it("accepts the legacy version-2 wrapper and rejects unknown versions", () => {
    const legacy = { version: 2, ...completePolicy() };
    expect(parseRoutePolicy(legacy)).toMatchObject({ ok: true });
    expect(parseRoutePolicy({ ...legacy, version: 3 })).toMatchObject({
      ok: false,
      diagnostics: [{ code: "policy-version-unsupported", field: "version" }],
    });
  });

  it("constrains explicit inherited capabilities to the active parent model", () => {
    const cwd = root("explicit-parent-bounds-cwd");
    const home = root("explicit-parent-bounds-home");
    const directory = path.join(home, ".pi", "agent", "cadence");
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      path.join(directory, "routes.json"),
      JSON.stringify({ version: 2, ...completePolicy() }),
    );
    expect(
      loadRoutePolicy({
        cwd,
        home,
        parentModel: { contextWindow: 32_768, maxTokens: 8_192 },
      }),
    ).toMatchObject({
      ok: true,
      policy: {
        routes: {
          inherited: {
            capabilities: { contextWindow: 32_768, maxTokens: 8_192 },
          },
        },
      },
    });
  });

  it("uses a user policy only when no project policy exists", () => {
    const cwd = root("cwd");
    const home = root("home");
    const directory = path.join(home, ".pi", "agent", "cadence");
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      path.join(directory, "routes.json"),
      JSON.stringify(completePolicy()),
    );
    expect(loadRoutePolicy({ cwd, home })).toMatchObject({
      ok: true,
      source: { kind: "user" },
    });
  });

  it.each(["project", "user"] as const)(
    "fails closed when the explicit %s policy is a dangling symlink",
    (source) => {
      const cwd = root(`dangling-${source}-cwd`);
      const home = root(`dangling-${source}-home`);
      const routePath =
        source === "project"
          ? path.join(cwd, ".pi", "cadence", "routes.json")
          : path.join(home, ".pi", "agent", "cadence", "routes.json");
      mkdirSync(path.dirname(routePath), { recursive: true });
      symlinkSync(
        path.join(path.dirname(routePath), "missing.json"),
        routePath,
      );

      expect(loadRoutePolicy({ cwd, home })).toMatchObject({
        ok: false,
        source: { kind: source },
        diagnostics: [{ code: "policy-unreadable" }],
      });
    },
  );

  it("resolves a custom credential only at attempt time", () => {
    const parsed = parseRoutePolicy(completePolicy());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("policy fixture must parse");
    const custom = parsed.policy.routes.custom;
    expect(custom.kind).toBe("custom");
    if (custom.kind !== "custom") throw new Error("custom fixture mismatch");
    expect(
      resolveCustomRoute(custom, { WORKER_TEST_KEY: "secret-value" }),
    ).toMatchObject({
      model: "worker-model",
      apiKey: "secret-value",
    });
    expect(
      JSON.stringify(
        inspectRoutePolicy({
          ok: true,
          source: { kind: "project", path: "/private/routes.json" },
          policy: parsed.policy,
        }),
      ),
    ).not.toMatch(/worker\.invalid|WORKER_TEST_KEY|secret-value/u);
  });
});
