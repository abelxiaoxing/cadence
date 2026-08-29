import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  inspectRoutePolicy,
  loadRoutePolicy,
  parseRoutePolicy,
  resolveCustomRoute,
} from "../src/route-policy.ts";

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
    "contract-reviewer",
    "implementation-worker",
    "diagnosis-worker",
  ];
  return {
    version: 2,
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
  it("reports a missing policy without inventing an inherited route", () => {
    const cwd = root("missing");
    const home = root("empty-home");
    const resolution = loadRoutePolicy({ cwd, home });
    expect(resolution).toMatchObject({
      ok: false,
      source: { kind: "none" },
      diagnostics: [{ code: "policy-missing" }],
    });
    expect(inspectRoutePolicy(resolution)).toEqual({
      ok: false,
      source: { kind: "none" },
      diagnostics: [{ code: "policy-missing" }],
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
