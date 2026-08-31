import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const RED_IDENTITY = "[CADENCE-V2:T2-route-policy-broker]";
const roots: string[] = [];

type ModuleRecord = Record<string, unknown>;
let policyModule: ModuleRecord | null = null;
let brokerModule: ModuleRecord | null = null;

beforeAll(async () => {
  [policyModule, brokerModule] = await Promise.all(
    ["../src/route-policy.ts", "../src/worker-broker.ts"].map(
      async (specifier) => {
        try {
          return (await import(specifier)) as ModuleRecord;
        } catch {
          return null;
        }
      },
    ),
  );
});

afterEach(() => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function temporaryRoot(label: string): string {
  const root = mkdtempSync(path.join(tmpdir(), `cadence-route-${label}-`));
  roots.push(root);
  return root;
}

function requiredFunction<T extends (...args: never[]) => unknown>(
  module: ModuleRecord | null,
  exportName: string,
): T {
  expect(
    module,
    `${RED_IDENTITY}: ${exportName} module must exist`,
  ).not.toBeNull();
  expect(
    module?.[exportName],
    `${RED_IDENTITY}: ${exportName} must be exported`,
  ).toBeTypeOf("function");
  return module?.[exportName] as T;
}

function policy(
  implementationRoutes = ["custom-primary", "parent-fallback"],
): Record<string, unknown> {
  const allRoles = [
    "design-explorer",
    "implementation-worker",
    "diagnosis-worker",
  ];
  return {
    routes: {
      "custom-primary": {
        kind: "custom",
        url: "https://primary.invalid/v1",
        model: "worker-primary",
        dialect: "openai-responses",
        apiKeyEnv: "CADENCE_TEST_WORKER_KEY",
        capabilities: {
          roles: allRoles,
          dialects: ["openai-responses"],
          contextWindow: 256000,
          maxTokens: 128000,
        },
      },
      "parent-fallback": {
        kind: "inherited",
        capabilities: {
          roles: allRoles,
          dialects: ["openai-responses", "anthropic-messages"],
          contextWindow: 256000,
          maxTokens: 128000,
        },
      },
    },
    roles: {
      "design-explorer": ["parent-fallback"],
      "implementation-worker": implementationRoutes,
      "diagnosis-worker": ["parent-fallback"],
    },
  };
}

function writePolicy(root: string, value: unknown, user = false): string {
  const directory = user
    ? path.join(root, ".pi", "agent", "cadence")
    : path.join(root, ".pi", "cadence");
  mkdirSync(directory, { recursive: true });
  const target = path.join(directory, "routes.json");
  writeFileSync(target, `${JSON.stringify(value)}\n`);
  return target;
}

describe("whole-file route policy", () => {
  it("uses only the project policy and exposes no URL or credential value", () => {
    const load = requiredFunction<
      (options: Record<string, unknown>) => Record<string, unknown>
    >(policyModule, "loadRoutePolicy");
    const inspect = requiredFunction<
      (resolution: Record<string, unknown>) => Record<string, unknown>
    >(policyModule, "inspectRoutePolicy");
    const cwd = temporaryRoot("project");
    const home = temporaryRoot("home");
    writePolicy(home, policy(["parent-fallback"]), true);
    const projectPath = writePolicy(cwd, policy());

    const resolution = load({ cwd, home });
    expect(resolution).toMatchObject({
      ok: true,
      source: { kind: "project", path: projectPath },
    });
    const visible = JSON.stringify(inspect(resolution));
    expect(visible).toContain("custom-primary");
    expect(visible).not.toContain("primary.invalid");
    expect(visible).not.toContain("CADENCE_TEST_WORKER_KEY");
  });

  it("fails the selected project file as a whole and never fills from user policy", () => {
    const load = requiredFunction<
      (options: Record<string, unknown>) => Record<string, unknown>
    >(policyModule, "loadRoutePolicy");
    const cwd = temporaryRoot("invalid-project");
    const home = temporaryRoot("valid-user");
    writePolicy(home, policy(), true);
    writePolicy(cwd, {
      routes: { partial: { kind: "custom", model: "missing-url" } },
      roles: policy().roles,
    });

    expect(load({ cwd, home })).toMatchObject({
      ok: false,
      source: { kind: "project" },
      diagnostics: [expect.objectContaining({ code: "route-invalid" })],
    });
  });
});

describe("capability and health aware Worker broker", () => {
  it("skips an open route, uses only declared fallback, and half-opens after cooldown", () => {
    const parse = requiredFunction<(value: unknown) => Record<string, unknown>>(
      policyModule,
      "parseRoutePolicy",
    );
    const brokerClass = brokerModule?.WorkerBroker as new (
      policy: Record<string, unknown>,
      options?: Record<string, unknown>,
    ) => {
      markFailure(routeId: string, code: string): void;
      select(input: Record<string, unknown>): Record<string, unknown>;
      status(): Record<string, unknown>;
    };
    expect(
      brokerClass,
      `${RED_IDENTITY}: WorkerBroker must be exported`,
    ).toBeTypeOf("function");
    let now = 1_000;
    const parsed = parse(policy());
    expect(parsed).toMatchObject({ ok: true });
    const broker = new brokerClass(parsed.policy as Record<string, unknown>, {
      now: () => now,
    });
    broker.markFailure("custom-primary", "transport-failure");
    expect(
      broker.select({
        role: "implementation-worker",
        dialects: ["openai-responses"],
        minContextWindow: 128000,
        minOutputTokens: 64000,
      }),
    ).toMatchObject({ ok: true, route: { id: "parent-fallback" } });
    expect(JSON.stringify(broker.status())).not.toContain("primary.invalid");

    now += 30_001;
    expect(
      broker.select({
        role: "implementation-worker",
        dialects: ["openai-responses"],
      }),
    ).toMatchObject({
      ok: true,
      route: { id: "custom-primary" },
      health: "half-open",
    });
  });

  it("enforces independent first-response timeout without hidden retry", async () => {
    vi.useFakeTimers();
    const parse = requiredFunction<(value: unknown) => Record<string, unknown>>(
      policyModule,
      "parseRoutePolicy",
    );
    const brokerClass = brokerModule?.WorkerBroker as new (
      policy: Record<string, unknown>,
    ) => {
      run(input: Record<string, unknown>): Promise<Record<string, unknown>>;
    };
    expect(
      brokerClass,
      `${RED_IDENTITY}: WorkerBroker must be exported`,
    ).toBeTypeOf("function");
    const parsed = parse(policy(["custom-primary"]));
    const broker = new brokerClass(parsed.policy as Record<string, unknown>);
    let attempts = 0;
    const pending = broker.run({
      operationId: "attempt-without-first-delta",
      role: "implementation-worker",
      requirements: { dialects: ["openai-responses"] },
      execute: async (attempt: { signal: AbortSignal; onHeaders(): void }) => {
        attempts += 1;
        attempt.onHeaders();
        await new Promise((_resolve, reject) => {
          attempt.signal.addEventListener(
            "abort",
            () => reject(attempt.signal.reason),
            {
              once: true,
            },
          );
        });
      },
    });
    await vi.advanceTimersByTimeAsync(30_001);
    await expect(pending).resolves.toMatchObject({
      ok: false,
      state: "paused",
      code: "first-response-timeout",
      attempts: [{ routeId: "custom-primary", code: "first-response-timeout" }],
    });
    expect(attempts).toBe(1);
  });

  it("settles a timeout even when the executor ignores cancellation", async () => {
    vi.useFakeTimers();
    const parse = requiredFunction<(value: unknown) => Record<string, unknown>>(
      policyModule,
      "parseRoutePolicy",
    );
    const brokerClass = brokerModule?.WorkerBroker as new (
      policy: Record<string, unknown>,
    ) => {
      run(input: Record<string, unknown>): Promise<Record<string, unknown>>;
    };
    const parsed = parse(policy(["custom-primary"]));
    const broker = new brokerClass(parsed.policy as Record<string, unknown>);
    const pending = broker.run({
      operationId: "executor-ignores-abort",
      role: "implementation-worker",
      execute: async (attempt: { onHeaders(): void }) => {
        attempt.onHeaders();
        return new Promise<never>(() => {});
      },
    });

    await vi.advanceTimersByTimeAsync(30_001);
    await expect(pending).resolves.toMatchObject({
      ok: false,
      code: "first-response-timeout",
      attempts: [{ routeId: "custom-primary", code: "first-response-timeout" }],
    });
  });

  it("projects bounded transport activity without exposing route identity", async () => {
    const parse = requiredFunction<(value: unknown) => Record<string, unknown>>(
      policyModule,
      "parseRoutePolicy",
    );
    const brokerClass = brokerModule?.WorkerBroker as new (
      policy: Record<string, unknown>,
    ) => {
      run(input: Record<string, unknown>): Promise<Record<string, unknown>>;
    };
    const parsed = parse(policy());
    const broker = new brokerClass(parsed.policy as Record<string, unknown>);
    const activity: Record<string, unknown>[] = [];
    let attempts = 0;
    const result = await broker.run({
      operationId: "activity-retry-operation",
      role: "implementation-worker",
      requirements: { dialects: ["openai-responses"] },
      onActivity(update: Record<string, unknown>) {
        activity.push(structuredClone(update));
        if (update.state === "waiting-first-response") {
          throw new Error("renderer-unavailable");
        }
      },
      execute: async (attempt: { onHeaders(): void; onProgress(): void }) => {
        attempts += 1;
        attempt.onHeaders();
        attempt.onProgress();
        if (attempts === 1) throw new Error("private transport detail");
        return { kind: "candidate" };
      },
    });

    expect(result).toMatchObject({ ok: true, value: { kind: "candidate" } });
    expect(activity.map((event) => event.state)).toEqual([
      "connecting",
      "waiting-first-response",
      "running",
      "retrying",
      "connecting",
      "waiting-first-response",
      "running",
    ]);
    expect(activity).toContainEqual({
      state: "retrying",
      attempt: 1,
      maxAttempts: 2,
      code: "transport-failure",
      wait: "bounded-policy",
    });
    const visible = JSON.stringify(activity);
    expect(visible).not.toMatch(
      /custom-primary|parent-fallback|primary\.invalid|private transport detail/i,
    );
  });

  it("allows typed compatible rebind but rejects route and authority widening", () => {
    const parse = requiredFunction<(value: unknown) => Record<string, unknown>>(
      policyModule,
      "parseRoutePolicy",
    );
    const brokerClass = brokerModule?.WorkerBroker as new (
      policy: Record<string, unknown>,
    ) => {
      rebind(input: Record<string, unknown>): Record<string, unknown>;
    };
    expect(
      brokerClass,
      `${RED_IDENTITY}: WorkerBroker must be exported`,
    ).toBeTypeOf("function");
    const parsed = parse(policy());
    const broker = new brokerClass(parsed.policy as Record<string, unknown>);
    expect(
      broker.rebind({
        runId: "stable-run",
        role: "implementation-worker",
        routeId: "parent-fallback",
        requirements: { dialects: ["openai-responses"] },
      }),
    ).toMatchObject({ ok: true, route: { id: "parent-fallback" } });
    expect(
      broker.rebind({
        runId: "stable-run",
        role: "implementation-worker",
        routeId: "undeclared",
        requirements: { dialects: ["openai-responses"] },
      }),
    ).toMatchObject({ ok: false, code: "route-not-declared" });
    expect(
      broker.rebind({
        runId: "stable-run",
        role: "implementation-worker",
        routeId: "parent-fallback",
        requirements: { dialects: ["openai-responses"] },
        write: ["unapproved.ts"],
      }),
    ).toMatchObject({ ok: false, code: "approval-boundary" });
  });

  it("does not consume a half-open probe during rebind validation", () => {
    const parse = requiredFunction<(value: unknown) => Record<string, unknown>>(
      policyModule,
      "parseRoutePolicy",
    );
    const brokerClass = brokerModule?.WorkerBroker as new (
      policy: Record<string, unknown>,
      options: Record<string, unknown>,
    ) => {
      markFailure(routeId: string, code: string): void;
      rebind(input: Record<string, unknown>): Record<string, unknown>;
      select(input: Record<string, unknown>): Record<string, unknown>;
    };
    let now = 1_000;
    const parsed = parse(policy(["custom-primary"]));
    const broker = new brokerClass(parsed.policy as Record<string, unknown>, {
      now: () => now,
    });
    broker.markFailure("custom-primary", "transport-failure");
    now += 30_001;

    expect(
      broker.rebind({
        runId: "half-open-rebind",
        role: "implementation-worker",
        routeId: "custom-primary",
      }),
    ).toMatchObject({ ok: true });
    expect(broker.select({ role: "implementation-worker" })).toMatchObject({
      ok: true,
      route: { id: "custom-primary" },
      health: "half-open",
    });
  });

  it("loads durable route health before any in-process attempt", () => {
    const parse = requiredFunction<(value: unknown) => Record<string, unknown>>(
      policyModule,
      "parseRoutePolicy",
    );
    const brokerClass = brokerModule?.WorkerBroker as new (
      policy: Record<string, unknown>,
      options: Record<string, unknown>,
    ) => { status(): Record<string, unknown> };
    const parsed = parse(policy());
    const route = (parsed.policy as any).routes["custom-primary"];
    const broker = new brokerClass(parsed.policy as Record<string, unknown>, {
      healthStore: {
        get(fingerprint: string) {
          return fingerprint === route.fingerprint
            ? { state: "open", retryAt: 42_000, lastCode: "transport-failure" }
            : undefined;
        },
        set() {},
      },
    });
    expect((broker.status() as any).routes).toContainEqual(
      expect.objectContaining({
        id: "custom-primary",
        health: "open",
        retryAt: 42_000,
      }),
    );
  });

  it("expires a persisted half-open probe claim after its bounded lease", async () => {
    const parse = requiredFunction<(value: unknown) => Record<string, unknown>>(
      policyModule,
      "parseRoutePolicy",
    );
    const brokerClass = brokerModule?.WorkerBroker as new (
      policy: Record<string, unknown>,
      options: Record<string, unknown>,
    ) => {
      markFailure(routeId: string, code: string): void;
      run(input: Record<string, unknown>): Promise<Record<string, unknown>>;
      select(input: Record<string, unknown>): Record<string, unknown>;
    };
    const bounds = brokerModule?.ROUTE_ATTEMPT_BOUNDS as {
      cooldownMs: number;
      totalMs: number;
    };
    const parsed = parse(policy(["custom-primary"]));
    const persisted = new Map<string, Record<string, unknown>>();
    const healthStore = {
      get(fingerprint: string) {
        const value = persisted.get(fingerprint);
        return value ? structuredClone(value) : undefined;
      },
      set(fingerprint: string, health: Record<string, unknown>) {
        persisted.set(fingerprint, structuredClone(health));
      },
    };
    let now = 1_000;
    const first = new brokerClass(parsed.policy as Record<string, unknown>, {
      now: () => now,
      healthStore,
    });
    first.markFailure("custom-primary", "transport-failure");
    now += bounds.cooldownMs + 1;
    const controller = new AbortController();
    let started!: () => void;
    const executing = new Promise<void>((resolve) => {
      started = resolve;
    });
    const running = first.run({
      operationId: "persisted-half-open-probe",
      role: "implementation-worker",
      signal: controller.signal,
      execute: async (attempt: { signal: AbortSignal }) => {
        started();
        return new Promise<never>((_resolve, reject) => {
          attempt.signal.addEventListener(
            "abort",
            () => reject(attempt.signal.reason),
            { once: true },
          );
        });
      },
    });
    await executing;

    const replacement = new brokerClass(
      parsed.policy as Record<string, unknown>,
      { now: () => now, healthStore },
    );
    expect(replacement.select({ role: "implementation-worker" })).toMatchObject(
      { ok: false, code: "endpoint-unavailable" },
    );

    now += bounds.totalMs + 1;
    expect(replacement.select({ role: "implementation-worker" })).toMatchObject(
      {
        ok: true,
        route: { id: "custom-primary" },
        health: "half-open",
      },
    );

    controller.abort(new Error("cancel abandoned probe fixture"));
    await expect(running).resolves.toMatchObject({
      ok: false,
      state: "cancelled",
      code: "cancelled",
    });
  });

  it("requires an explicit rebind when a bound route identity changes", () => {
    const parse = requiredFunction<(value: unknown) => Record<string, unknown>>(
      policyModule,
      "parseRoutePolicy",
    );
    const brokerClass = brokerModule?.RunWorkerBroker as new (
      policy: Record<string, unknown>,
    ) => {
      rebind(input: Record<string, unknown>): Record<string, unknown>;
      resumeBinding(input: Record<string, unknown>): Record<string, unknown>;
      updatePolicy(policy: Record<string, unknown>): void;
    };
    const original = parse(policy(["custom-primary"]));
    const broker = new brokerClass(original.policy as Record<string, unknown>);
    expect(
      broker.rebind({
        runId: "identity-refresh",
        role: "implementation-worker",
        routeId: "custom-primary",
      }),
    ).toMatchObject({ ok: true });

    const changedPolicy = policy(["custom-primary"]) as any;
    changedPolicy.routes["custom-primary"].model = "replacement-model";
    const changed = parse(changedPolicy);
    broker.updatePolicy(changed.policy as Record<string, unknown>);
    expect(
      broker.resumeBinding({
        runId: "identity-refresh",
        role: "implementation-worker",
        routeId: "custom-primary",
      }),
    ).toEqual({ ok: false, code: "route-rebind-required" });
    expect(
      broker.rebind({
        runId: "identity-refresh",
        role: "implementation-worker",
        routeId: "custom-primary",
      }),
    ).toMatchObject({ ok: true });
  });
});
