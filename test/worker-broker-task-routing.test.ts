import { describe, expect, it } from "vitest";
import { parentRoutePolicy, parseRoutePolicy } from "../src/route-policy.ts";
import {
  type RouteHealthStore,
  RunWorkerBroker,
} from "../src/worker-broker.ts";

function policy() {
  const roles = [
    "design-explorer",
    "implementation-worker",
    "diagnosis-worker",
  ];
  const capabilities = {
    roles,
    dialects: ["openai-responses"],
    contextWindow: 32768,
    maxTokens: 2048,
  };
  const parsed = parseRoutePolicy({
    routes: {
      primary: {
        kind: "custom",
        url: "https://primary.invalid/v1",
        model: "worker",
        dialect: "openai-responses",
        capabilities,
      },
      fallback: { kind: "inherited", capabilities },
    },
    roles: Object.fromEntries(
      roles.map((role) => [role, ["primary", "fallback"]]),
    ),
  });
  if (!parsed.ok) throw new Error("invalid fixture policy");
  return parsed.policy;
}

describe("task route binding isolation", () => {
  it("keeps both successful task bindings after one sibling fails over", async () => {
    const routes = policy();
    const broker = new RunWorkerBroker(routes);
    const common = {
      runId: "parallel-run",
      role: "implementation-worker" as const,
    };
    const [first, second] = await Promise.all([
      broker.run({
        ...common,
        taskId: "T1",
        operationId: "T1-red",
        execute: async () => "success",
      }),
      broker.run({
        ...common,
        taskId: "T2",
        operationId: "T2-red",
        execute: async ({ route }) => {
          if (route.id === "primary") throw new Error("transient failure");
          return "success";
        },
      }),
    ]);
    expect(first).toMatchObject({ ok: true, routeId: "primary" });
    expect(second).toMatchObject({ ok: true, routeId: "fallback" });
    for (const [taskId, routeId] of [
      ["T1", "primary"],
      ["T2", "fallback"],
    ]) {
      expect(
        broker.resumeBinding({
          ...common,
          taskId,
          routeId,
          expectedFingerprint: routes.routes[routeId].fingerprint,
        }),
      ).toMatchObject({ ok: true });
    }
  });

  it("restores task bindings independently after restart and still fences changed fingerprints", () => {
    const routes = policy();
    const broker = new RunWorkerBroker(routes);
    const common = {
      runId: "restored-run",
      role: "implementation-worker" as const,
    };
    for (const [taskId, routeId] of [
      ["T1", "primary"],
      ["T2", "fallback"],
      ["T1", "primary"],
    ]) {
      expect(
        broker.resumeBinding({
          ...common,
          taskId,
          routeId,
          expectedFingerprint: routes.routes[routeId].fingerprint,
        }),
      ).toMatchObject({ ok: true });
    }
    expect(
      broker.resumeBinding({
        ...common,
        taskId: "T1",
        routeId: "primary",
        expectedFingerprint: "0".repeat(64),
      }),
    ).toEqual({ ok: false, code: "route-rebind-required" });
    expect(
      broker.rebind({ ...common, taskId: "T1", routeId: "fallback" }),
    ).toMatchObject({ ok: true });
    expect(broker.binding(common.runId, common.role, "T2")).toBe("fallback");
  });
});

describe("shared route health", () => {
  it.each([false, true])(
    "projects bound-route failures and respects their cooldown (shared=%s)",
    async (injected) => {
      const values = new Map<string, ReturnType<RouteHealthStore["get"]>>();
      const healthStore: RouteHealthStore = {
        get: (key) => values.get(key),
        set: (key, value) => {
          values.set(key, value);
        },
      };
      const broker = new RunWorkerBroker(
        parentRoutePolicy({ contextWindow: 32768, maxTokens: 2048 }),
        injected ? { healthStore } : {},
      );
      const common = {
        runId: "health-run",
        taskId: "T1",
        role: "implementation-worker" as const,
      };
      await broker.run({
        ...common,
        operationId: "red",
        execute: async () => "success",
      });
      const failed = await broker.run({
        ...common,
        operationId: "green",
        execute: async () => {
          throw new Error("unavailable");
        },
      });
      expect(failed).toMatchObject({ ok: false, code: "transport-failure" });
      expect(broker.status()).toMatchObject({
        routes: [expect.objectContaining({ id: "parent", health: "open" })],
      });
      let launches = 0;
      const sibling = await broker.run({
        ...common,
        runId: "other-run",
        operationId: "sibling",
        execute: async () => {
          launches++;
          return "success";
        },
      });
      expect(launches).toBe(0);
      expect(sibling).toMatchObject({
        ok: false,
        code: "endpoint-unavailable",
      });
    },
  );
});
