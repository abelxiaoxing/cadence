// Fixed-seed property tests for per-role subagent endpoint resolution.
// Invariants under test: whole-layer three-tier resolution, whole-file
// project-over-user precedence, empty-is-absent, role key mapping, internal
// bounds defaults, and deterministic/idempotent results.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type ChildFailure,
  ENVIRONMENT_FAILURE_CODES,
  type TaskFailure,
} from "../src/contracts.ts";
import {
  resolveSubagentEndpoint,
  type SubagentEndpoint,
  type SubagentRole,
} from "../src/subagent-endpoint.ts";

const ROLES: SubagentRole[] = [
  "design-explorer",
  "contract-reviewer",
  "implementation-worker",
  "diagnosis-worker",
];
const FIELDS = [
  "API_URL",
  "API_KEY",
  "MODEL",
  "API",
  "CONTEXT_WINDOW",
  "MAX_TOKENS",
] as const;

describe("committed layer wholeness", () => {
  it("never merges missing values from another layer", () => {
    const cwd = makeDir("no-merge");
    const home = makeDir("no-merge-home");
    writeEnv(cwd, [".pi", "cadence"], {
      SUBAGENT_IMPLEMENTATION_WORKER_MODEL: "role-model",
      SUBAGENT_IMPLEMENTATION_WORKER_API_URL: "https://role.example.invalid/v1",
      SUBAGENT_API: "anthropic-messages",
    });
    const endpoint = expectCustom(
      resolveSubagentEndpoint("implementation-worker", { cwd, home }),
    );
    // Missing role dialect falls back to the default, not the global value.
    expect(endpoint.dialect).toBe("openai-completions");
  });
});

describe("fail-closed configuration errors", () => {
  function expectInvalid(
    entries: Record<string, string>,
    options?: { role?: SubagentRole },
  ): string[] {
    const cwd = makeDir(`invalid-${Object.keys(entries).join("_")}`);
    const home = makeDir(`invalid-home-${Math.random()}`);
    writeEnv(cwd, [".pi", "cadence"], entries);
    const first = resolveSubagentEndpoint(options?.role ?? "design-explorer", {
      cwd,
      home,
    });
    if (first.kind !== "invalid") {
      throw new Error(
        `expected invalid resolution, got ${first.kind}: ${JSON.stringify(first)}`,
      );
    }
    // Deterministic: identical configuration state yields identical result.
    const second = resolveSubagentEndpoint(options?.role ?? "design-explorer", {
      cwd,
      home,
    });
    expect(second).toEqual(first);
    // Privacy: no configured value may leak into the resolution.
    for (const value of Object.values(entries)) {
      if (value !== "") expect(first.keys.join(" ")).not.toContain(value);
    }
    return first.keys;
  }

  it("classifies committed layers missing MODEL or API_URL as invalid", () => {
    const random = prng(90210);
    for (let index = 0; index < 60; index += 1) {
      const entries: Record<string, string> = {};
      // Always commit via API_KEY; vary which of MODEL/API_URL is missing.
      entries[globalKey("API_KEY")] = `sk-${index}`;
      const roll = random();
      const missingUrl = roll >= 0.35;
      const missingModel = roll < 0.35 || roll >= 0.7;
      if (!missingModel) entries[globalKey("MODEL")] = `model-${index}`;
      if (!missingUrl)
        entries[globalKey("API_URL")] = `https://partial-${index}.invalid/v1`;
      const expected: string[] = [];
      if (missingUrl) expected.push(globalKey("API_URL"));
      if (missingModel) expected.push(globalKey("MODEL"));
      const keys = expectInvalid(entries);
      expect([...keys].sort()).toEqual([...expected].sort());
    }
  });

  it("classifies non-http(s) or unparseable URLs as invalid", () => {
    for (const url of [
      "ftp://files.example.invalid",
      "not-a-url",
      "http://",
      "file:///etc/passwd",
      "example.invalid/v1",
    ]) {
      const keys = expectInvalid({
        [globalKey("MODEL")]: "url-model",
        [globalKey("API_URL")]: url,
      });
      expect(keys).toEqual([globalKey("API_URL")]);
    }
  });

  it("classifies unknown dialect values as invalid", () => {
    for (const dialect of [
      "openai",
      "graphql",
      "OpenAI-Completions",
      "anthropic",
    ]) {
      const keys = expectInvalid({
        [globalKey("MODEL")]: "dialect-model",
        [globalKey("API_URL")]: "https://dialect.example.invalid/v1",
        [globalKey("API")]: dialect,
      });
      expect(keys).toEqual([globalKey("API")]);
    }
    // All three supported dialects are valid.
    const cwd = makeDir("dialect-valid");
    const home = makeDir("dialect-valid-home");
    for (const dialect of [
      "openai-completions",
      "openai-responses",
      "anthropic-messages",
    ]) {
      writeEnv(cwd, [".pi", "cadence"], {
        [globalKey("MODEL")]: "m",
        [globalKey("API_URL")]: "https://valid.example.invalid/v1",
        [globalKey("API")]: dialect,
      });
      expect(
        resolveSubagentEndpoint("design-explorer", { cwd, home }).kind,
      ).toBe("custom");
    }
  });

  it("classifies zero, negative, and non-integer bounds as invalid", () => {
    for (const bound of ["CONTEXT_WINDOW", "MAX_TOKENS"] as const) {
      const cwd = makeDir(`safe-bound-${bound}`);
      const home = makeDir(`safe-bound-home-${bound}`);
      writeEnv(cwd, [".pi", "cadence"], {
        [globalKey("MODEL")]: "safe-bound-model",
        [globalKey("API_URL")]: "https://safe-bound.example.invalid/v1",
        [globalKey(bound)]: String(Number.MAX_SAFE_INTEGER),
      });
      const valid = expectCustom(
        resolveSubagentEndpoint("design-explorer", { cwd, home }),
      );
      expect(
        valid[bound === "CONTEXT_WINDOW" ? "contextWindow" : "maxTokens"],
      ).toBe(Number.MAX_SAFE_INTEGER);
      for (const value of [
        "0",
        "-1",
        "1.5",
        "many",
        "+100",
        "1e6",
        String(Number.MAX_SAFE_INTEGER + 1),
        "9".repeat(400),
      ]) {
        const keys = expectInvalid({
          [globalKey("MODEL")]: "bound-model",
          [globalKey("API_URL")]: "https://bounds.example.invalid/v1",
          [globalKey(bound)]: value,
        });
        expect(keys).toEqual([globalKey(bound)]);
      }
    }
  });

  it("fails closed on malformed configuration files without leaking values", () => {
    const cwd = makeDir("parse-error");
    const home = makeDir("parse-error-home");
    mkdirSync(join(cwd, ".pi", "cadence"), { recursive: true });
    const content =
      "SUBAGENT_MODEL=secret-model-value\nBROKEN LINE WITHOUT EQUALS\n";
    writeFileSync(join(cwd, ".pi", "cadence", ".env"), content);
    const resolution = resolveSubagentEndpoint("design-explorer", {
      cwd,
      home,
    });
    if (resolution.kind !== "invalid") {
      throw new Error(`expected invalid resolution, got ${resolution.kind}`);
    }
    expect(resolution.file).toContain(`${cwd}/.pi/cadence/.env`);
    expect(JSON.stringify(resolution)).not.toContain("secret-model-value");
    // Deterministic.
    expect(resolveSubagentEndpoint("design-explorer", { cwd, home })).toEqual(
      resolution,
    );
  });

  it("reports role-layer offenses under their prefixed key names", () => {
    const keys = expectInvalid(
      { [roleKey("diagnosis-worker", "MODEL")]: "partial-role-model" },
      { role: "diagnosis-worker" },
    );
    expect(keys).toEqual([roleKey("diagnosis-worker", "API_URL")]);
  });
});

describe("typed configuration failure code", () => {
  it("is a member of the closed environment code set with terminal mapping", () => {
    expect(ENVIRONMENT_FAILURE_CODES).toContain("invalid-subagent-endpoint");
    const failure: ChildFailure = {
      kind: "environment",
      code: "invalid-subagent-endpoint",
    };
    // The environment kind already maps to a terminal, non-retryable
    // TaskFailure; no new ChildFailure kind is introduced.
    const taskFailure: TaskFailure = failure;
    expect(taskFailure).toEqual(failure);
    expect(failure.kind).toBe("environment");
  });
});

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function makeDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `abel-endpoint-${tag}-`));
  roots.push(dir);
  return dir;
}

function writeEnv(
  base: string,
  segments: string[],
  entries: Record<string, string>,
): void {
  const dir = join(base, ...segments);
  mkdirSync(dir, { recursive: true });
  const content = `${Object.keys(entries)
    .map((key) => `${key}=${entries[key]}`)
    .join("\n")}\n`;
  writeFileSync(join(dir, ".env"), content);
}

function roleKey(role: SubagentRole, field: string): string {
  return `SUBAGENT_${role.toUpperCase().replaceAll("-", "_")}_${field}`;
}

function globalKey(field: string): string {
  return `SUBAGENT_${field}`;
}

// mulberry32 fixed-seed PRNG for reproducible case generation.
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface LayerCase {
  values: Record<string, string>;
  committedKeys: number;
}

function generateLayer(
  random: () => number,
  prefixFor: (field: string) => string,
): LayerCase {
  const values: Record<string, string> = {};
  let committedKeys = 0;
  for (const field of FIELDS) {
    const roll = random();
    if (roll < 0.4) continue; // absent
    if (roll < 0.5) {
      values[prefixFor(field)] = ""; // empty value is absent
      continue;
    }
    committedKeys += 1;
    switch (field) {
      case "API_URL":
        values[prefixFor(field)] =
          `https://endpoint-${Math.floor(random() * 1e6)}.invalid/v1`;
        break;
      case "API_KEY":
        values[prefixFor(field)] = `sk-${Math.floor(random() * 1e9)}`;
        break;
      case "MODEL":
        values[prefixFor(field)] = `model-${Math.floor(random() * 1e6)}`;
        break;
      case "API":
        values[prefixFor(field)] = [
          "openai-completions",
          "openai-responses",
          "anthropic-messages",
        ][Math.floor(random() * 3)];
        break;
      case "CONTEXT_WINDOW":
        values[prefixFor(field)] = String(1000 + Math.floor(random() * 900000));
        break;
      case "MAX_TOKENS":
        values[prefixFor(field)] = String(100 + Math.floor(random() * 120000));
        break;
    }
  }
  return { values, committedKeys };
}

function expectCustom(
  resolution: ReturnType<typeof resolveSubagentEndpoint>,
): SubagentEndpoint {
  expect(resolution.kind).toBe("custom");
  if (resolution.kind !== "custom") throw new Error("unreachable");
  return resolution.endpoint;
}

describe("subagent endpoint resolution", () => {
  it("commits exactly one layer and never merges across layers", () => {
    const random = prng(20260207);
    for (let index = 0; index < 120; index += 1) {
      const cwd = makeDir(`layer-${index}`);
      const home = makeDir(`layer-home-${index}`);
      const role = ROLES[Math.floor(random() * ROLES.length)];
      const others = ROLES.filter((item) => item !== role);
      const otherRole = others[Math.floor(random() * others.length)];
      const roleLayer = generateLayer(random, (field) => roleKey(role, field));
      const globalLayer = generateLayer(random, (field) => globalKey(field));
      const noiseLayer = generateLayer(random, (field) =>
        roleKey(otherRole, field),
      );
      writeEnv(cwd, [".pi", "cadence"], {
        ...noiseLayer.values,
        ...globalLayer.values,
        ...roleLayer.values,
      });
      const resolution = resolveSubagentEndpoint(role, { cwd, home });
      // The generator only emits valid dialects/bounds; completeness is MODEL+URL.
      const roleComplete =
        !!roleLayer.values[roleKey(role, "MODEL")] &&
        !!roleLayer.values[roleKey(role, "API_URL")];
      const globalComplete =
        !!globalLayer.values[globalKey("MODEL")] &&
        !!globalLayer.values[globalKey("API_URL")];
      if (roleLayer.committedKeys > 0) {
        if (!roleComplete) {
          expect(resolution.kind).toBe("invalid");
        } else {
          const endpoint = expectCustom(resolution);
          // Committed-layer wholeness: values come only from this layer.
          expect(endpoint.model).toBe(roleLayer.values[roleKey(role, "MODEL")]);
          expect(endpoint.url).toBe(roleLayer.values[roleKey(role, "API_URL")]);
          if (roleLayer.values[roleKey(role, "API_KEY")])
            expect(endpoint.apiKey).toBe(
              roleLayer.values[roleKey(role, "API_KEY")],
            );
          if (roleLayer.values[roleKey(role, "CONTEXT_WINDOW")])
            expect(endpoint.contextWindow).toBe(
              Number(roleLayer.values[roleKey(role, "CONTEXT_WINDOW")]),
            );
          if (roleLayer.values[roleKey(role, "MAX_TOKENS")])
            expect(endpoint.maxTokens).toBe(
              Number(roleLayer.values[roleKey(role, "MAX_TOKENS")]),
            );
        }
      } else if (globalLayer.committedKeys > 0) {
        if (!globalComplete) {
          expect(resolution.kind).toBe("invalid");
        } else {
          const endpoint = expectCustom(resolution);
          expect(endpoint.model).toBe(globalLayer.values[globalKey("MODEL")]);
          expect(endpoint.url).toBe(globalLayer.values[globalKey("API_URL")]);
        }
      } else {
        expect(resolution.kind).toBe("inherited");
      }
      // Idempotence: identical inputs produce identical results.
      expect(resolveSubagentEndpoint(role, { cwd, home })).toEqual(resolution);
    }
  });

  it("prefers the project file as a whole over the user file", () => {
    const random = prng(773311);
    for (let index = 0; index < 40; index += 1) {
      const cwd = makeDir(`project-${index}`);
      const home = makeDir(`project-home-${index}`);
      const role = ROLES[index % ROLES.length];
      writeEnv(home, [".pi", "agent", "cadence"], {
        [globalKey("MODEL")]: "user-model-only",
        [globalKey("API_URL")]: "https://user.example.invalid/v1",
      });
      const projectLayer = generateLayer(random, (field) => globalKey(field));
      writeEnv(cwd, [".pi", "cadence"], projectLayer.values);
      const resolution = resolveSubagentEndpoint(role, { cwd, home });
      if (projectLayer.committedKeys === 0) {
        // Whole-file precedence: no substitution from the user file.
        expect(resolution.kind).toBe("inherited");
      } else {
        expect(JSON.stringify(resolution)).not.toContain("user-model-only");
        expect(JSON.stringify(resolution)).not.toContain(
          "user.example.invalid",
        );
        const complete =
          !!projectLayer.values[globalKey("MODEL")] &&
          !!projectLayer.values[globalKey("API_URL")];
        if (complete) {
          const endpoint = expectCustom(resolution);
          expect(endpoint.model).toBe(projectLayer.values[globalKey("MODEL")]);
        } else {
          expect(resolution.kind).toBe("invalid");
        }
      }
    }
  });

  it("maps role keys by converting hyphens to underscores per role only", () => {
    const cwd = makeDir("role-mapping");
    const home = makeDir("role-mapping-home");
    writeEnv(cwd, [".pi", "cadence"], {
      SUBAGENT_IMPLEMENTATION_WORKER_MODEL: "worker-model",
      SUBAGENT_IMPLEMENTATION_WORKER_API_URL:
        "https://worker.example.invalid/v1",
    });
    const worker = resolveSubagentEndpoint("implementation-worker", {
      cwd,
      home,
    });
    expect(expectCustom(worker)).toMatchObject({
      model: "worker-model",
      url: "https://worker.example.invalid/v1",
    });
    for (const role of ROLES.filter(
      (item) => item !== "implementation-worker",
    )) {
      expect(resolveSubagentEndpoint(role, { cwd, home }).kind).toBe(
        "inherited",
      );
    }
  });

  it("uses internal defaults when bounds keys are absent", () => {
    const cwd = makeDir("bounds-defaults");
    const home = makeDir("bounds-defaults-home");
    writeEnv(cwd, [".pi", "cadence"], {
      SUBAGENT_MODEL: "defaulted-model",
      SUBAGENT_API_URL: "https://default.example.invalid/v1",
    });
    for (const role of ROLES) {
      const endpoint = expectCustom(
        resolveSubagentEndpoint(role, { cwd, home }),
      );
      expect(endpoint.contextWindow).toBe(256000);
      expect(endpoint.maxTokens).toBe(128000);
      expect(endpoint.dialect).toBe("openai-completions");
    }
  });

  it("resolves inherited when no configuration exists at all", () => {
    const cwd = makeDir("no-config");
    const home = makeDir("no-config-home");
    for (const role of ROLES) {
      expect(resolveSubagentEndpoint(role, { cwd, home }).kind).toBe(
        "inherited",
      );
    }
  });
});
