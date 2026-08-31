import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Activation } from "../src/activation.ts";
import type { ChildSessionResult } from "../src/child-session.ts";
import type { PacketEnvelope } from "../src/contracts.ts";
import {
  type PacketActivityEvent,
  type PacketChildRunner,
  type PacketContext,
  PacketRuntime,
} from "../src/packet-runtime.ts";
import { ParentPayloadBridge } from "../src/parent-payload-bridge.ts";
import { parseRoutePolicy } from "../src/route-policy.ts";

const ZERO_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const context = {
  cwd: process.cwd(),
  model: {},
  modelRegistry: {},
} as unknown as PacketContext;

function packet(
  id: string,
  stage: PacketEnvelope["stage"] = "abel-design",
): PacketEnvelope {
  const design = stage === "abel-design";
  return {
    stage,
    ...(design ? { runId: "design-run" } : {}),
    role: design ? "design-explorer" : "diagnosis-worker",
    id,
    phase: design ? "evidence" : "red",
    objective: `inspect ${id}`,
    roots: ["src"],
    context: { agents: "root AGENTS", contract: "approved contract" },
    declared: {
      read: ["src"],
      write: design ? [] : ["src/packet-runtime.ts"],
      conflicts: [],
      resources: [],
    },
    output: design ? "evidence" : "diff",
  };
}

function completed(id: string): ChildSessionResult {
  return {
    ok: true,
    result: {
      id,
      role: "diagnosis-worker",
      kind: "evidence",
      conclusions: ["complete"],
      citations: [],
      constraints: [],
      dependencies: [],
      risks: [],
      blockingQuestions: [],
      hints: { writeSet: [], verification: "none", agentsImpact: "none" },
    },
    toolNames: [],
    submitCount: 1,
    disposeCount: 1,
    usage: structuredClone(ZERO_USAGE),
    classification: {
      finalCategory: "single-submit-only",
      attempts: 1,
      schema: "valid",
      identity: { request: true, role: true, task: true, phase: true },
    },
  };
}

function failed(
  failure:
    | {
        kind: "artifact";
        code: "invalid-structural-result";
        stage: "structural-submit";
      }
    | { kind: "cancelled"; code: "cancelled" }
    | {
        kind: "transport";
        code: "timeout";
        stage: "child-timeout";
      },
): ChildSessionResult {
  return {
    ok: false,
    error:
      failure.kind === "cancelled"
        ? "cancelled"
        : failure.kind === "transport"
          ? "timeout"
          : "invalid result",
    failure,
    failureKind:
      failure.kind === "cancelled"
        ? "cancelled"
        : failure.kind === "transport"
          ? "timed-out"
          : "failed",
    transportFailure: failure.kind === "transport",
    disposeCount: 1,
    usage: structuredClone(ZERO_USAGE),
    classification: {
      finalCategory: "no-final-assistant",
      attempts: 0,
      schema: "invalid",
      identity: { request: false, role: false, task: false, phase: false },
    },
  };
}

function activeRuntime(
  childRunner: PacketChildRunner,
  options: { concurrency?: number; bridge?: ParentPayloadBridge } = {},
): PacketRuntime {
  const activation = new Activation();
  activation.request();
  activation.activate();
  return new PacketRuntime({
    activation,
    parentPayloadBridge: options.bridge ?? new ParentPayloadBridge(),
    childRunner,
    ...(options.concurrency ? { concurrency: options.concurrency } : {}),
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("condition was not reached");
}

describe("PacketRuntime", () => {
  it("fails over when inherited route setup is unavailable", async () => {
    const roles = [
      "design-explorer",
      "implementation-worker",
      "diagnosis-worker",
    ];
    const parsed = parseRoutePolicy({
      routes: {
        inherited: {
          kind: "inherited",
          capabilities: {
            roles,
            dialects: ["openai-responses"],
            contextWindow: 256_000,
            maxTokens: 128_000,
          },
        },
        fallback: {
          kind: "custom",
          url: "http://127.0.0.1:1/v1",
          model: "packet-fallback",
          dialect: "openai-responses",
          apiKeyEnv: "MISSING_PACKET_FALLBACK_KEY",
          capabilities: {
            roles,
            dialects: ["openai-responses"],
            contextWindow: 256_000,
            maxTokens: 128_000,
          },
        },
      },
      roles: Object.fromEntries(
        roles.map((role) => [role, ["inherited", "fallback"]]),
      ),
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const activation = new Activation();
    activation.request();
    activation.activate();
    const runtime = new PacketRuntime({
      activation,
      parentPayloadBridge: new ParentPayloadBridge(),
      routePolicy: parsed.policy,
      environment: {},
    });
    const events: PacketActivityEvent[] = [];
    const unavailableParent = {
      cwd: process.cwd(),
      model: undefined,
      modelRegistry: {},
    } as unknown as PacketContext;

    await expect(
      runtime.execute(
        "run",
        { request: packet("inherited-setup-failover") },
        unavailableParent,
        undefined,
        (event) => {
          events.push(event);
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: { kind: "transport", code: "transport-failure" },
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        state: "retrying",
        attempt: 1,
        maxAttempts: 2,
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        state: "connecting",
        attempt: 2,
        maxAttempts: 2,
      }),
    );
  });

  it("uses the inherited parent route when no packet policy is declared", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "cadence-packet-no-route-"));
    const home = mkdtempSync(path.join(tmpdir(), "cadence-packet-no-home-"));
    try {
      const activation = new Activation();
      activation.request();
      activation.activate();
      const runtime = new PacketRuntime({
        activation,
        parentPayloadBridge: new ParentPayloadBridge(),
        routePolicyHome: home,
      });
      await expect(
        runtime.execute(
          "run",
          { request: packet("missing-route") },
          { ...context, cwd },
        ),
      ).resolves.toMatchObject({ ok: false, error: "transport-failure" });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("reloads a corrected file-backed route policy for the next packet", async () => {
    const cwd = mkdtempSync(
      path.join(tmpdir(), "cadence-packet-route-reload-"),
    );
    const home = mkdtempSync(path.join(tmpdir(), "cadence-packet-route-home-"));
    try {
      const activation = new Activation();
      activation.request();
      activation.activate();
      const runtime = new PacketRuntime({
        activation,
        parentPayloadBridge: new ParentPayloadBridge(),
        routePolicyHome: home,
        environment: { PACKET_TEST_KEY: "fixture-secret" },
      });
      await expect(
        runtime.execute(
          "run",
          { request: packet("route-missing") },
          { ...context, cwd },
        ),
      ).resolves.toMatchObject({ ok: false, error: "transport-failure" });

      const routeDirectory = path.join(cwd, ".pi", "cadence");
      mkdirSync(routeDirectory, { recursive: true });
      const roles = [
        "design-explorer",
        "implementation-worker",
        "diagnosis-worker",
      ];
      writeFileSync(
        path.join(routeDirectory, "routes.json"),
        `${JSON.stringify({
          routes: {
            corrected: {
              kind: "custom",
              url: "http://127.0.0.1:1/v1",
              model: "packet-test-model",
              dialect: "openai-responses",
              apiKeyEnv: "PACKET_TEST_KEY",
              capabilities: {
                roles,
                dialects: ["openai-responses"],
                contextWindow: 256_000,
                maxTokens: 128_000,
              },
            },
          },
          roles: Object.fromEntries(roles.map((role) => [role, ["corrected"]])),
        })}\n`,
      );
      const corrected = await runtime.execute(
        "run",
        { request: packet("route-corrected") },
        { ...context, cwd },
      );
      expect(corrected).toMatchObject({ ok: false });
      expect(corrected.ok ? "" : corrected.error).not.toBe(
        "endpoint-unavailable",
      );
      await runtime.drain();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("accepts only strict Design and Diagnose packet envelopes", () => {
    const runtime = activeRuntime(async ({ packet: request }) =>
      completed(request.id),
    );
    expect(runtime.validateRequest(packet("design"))).toMatchObject({
      ok: true,
    });
    expect(
      runtime.validateRequest(packet("diagnose", "abel-diagnose")),
    ).toMatchObject({
      ok: true,
    });
    expect(
      runtime.validateRequest({ ...packet("extra"), internalState: {} }),
    ).toMatchObject({ ok: false });
    expect(
      runtime.validateRequest({
        ...packet("wrong-stage"),
        stage: "abel-implement",
      }),
    ).toMatchObject({ ok: false });
    expect(
      runtime.validateRequest({
        ...packet("design-write"),
        declared: { ...packet("design-write").declared, write: ["src/x.ts"] },
      }),
    ).toMatchObject({ ok: false });
  });

  it("admits packets in FIFO order up to the configured concurrency", async () => {
    const gates = new Map<
      string,
      ReturnType<typeof deferred<ChildSessionResult>>
    >();
    const launched: string[] = [];
    let active = 0;
    let maximumActive = 0;
    const runtime = activeRuntime(
      async ({ packet: request }) => {
        launched.push(request.id);
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        const gate = deferred<ChildSessionResult>();
        gates.set(request.id, gate);
        try {
          return await gate.promise;
        } finally {
          active -= 1;
        }
      },
      { concurrency: 2 },
    );

    const runs = ["one", "two", "three"].map((id) =>
      runtime.execute("run", { request: packet(id) }, context),
    );
    await waitFor(() => launched.length === 2);
    expect(launched).toEqual(["one", "two"]);
    gates.get("one")?.resolve(completed("one"));
    await waitFor(() => launched.length === 3);
    expect(launched).toEqual(["one", "two", "three"]);
    gates.get("two")?.resolve(completed("two"));
    gates.get("three")?.resolve(completed("three"));

    const outcomes = await Promise.all(runs);
    expect(outcomes).toHaveLength(3);
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    expect(maximumActive).toBe(2);
  });

  it("cancels both active and queued packets without reporting success", async () => {
    const events: PacketActivityEvent[] = [];
    let launches = 0;
    const runtime = activeRuntime(
      ({ signal }) => {
        launches += 1;
        return new Promise<ChildSessionResult>((resolve) => {
          const cancel = () =>
            resolve(failed({ kind: "cancelled", code: "cancelled" }));
          if (signal.aborted) cancel();
          else signal.addEventListener("abort", cancel, { once: true });
        });
      },
      { concurrency: 1 },
    );
    const observe = (event: PacketActivityEvent) => {
      events.push(event);
    };
    const active = runtime.execute(
      "run",
      { request: packet("active") },
      context,
      undefined,
      observe,
    );
    const queued = runtime.execute(
      "run",
      { request: packet("queued") },
      context,
      undefined,
      observe,
    );
    await waitFor(() => launches === 1);
    await runtime.cancel();

    await expect(Promise.all([active, queued])).resolves.toEqual([
      expect.objectContaining({
        ok: false,
        failure: expect.objectContaining({ kind: "cancelled" }),
      }),
      expect.objectContaining({
        ok: false,
        failure: expect.objectContaining({ kind: "cancelled" }),
      }),
    ]);
    expect(events.filter((event) => event.state === "cancelled")).toHaveLength(
      2,
    );
  });

  it("reports a child phase timeout as timed-out activity", async () => {
    const events: PacketActivityEvent[] = [];
    const runtime = activeRuntime(async () =>
      failed({
        kind: "transport",
        code: "timeout",
        stage: "child-timeout",
      }),
    );

    await expect(
      runtime.execute(
        "run",
        { request: packet("timed-out") },
        context,
        undefined,
        (event) => {
          events.push(event);
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: { kind: "transport", code: "timeout" },
    });
    expect(events.at(-1)).toMatchObject({
      state: "timed-out",
      failureReason: "phase timed out",
    });
  });

  it("does not restart a malformed Design or Diagnose packet", async () => {
    let designCalls = 0;
    const design = activeRuntime(async () => {
      designCalls += 1;
      return failed({
        kind: "artifact",
        code: "invalid-structural-result",
        stage: "structural-submit",
      });
    });
    await expect(
      design.execute("run", { request: packet("design") }, context),
    ).resolves.toMatchObject({ ok: false, failure: { kind: "artifact" } });
    expect(designCalls).toBe(1);

    let diagnoseCalls = 0;
    const diagnose = activeRuntime(async () => {
      diagnoseCalls += 1;
      return failed({
        kind: "artifact",
        code: "invalid-structural-result",
        stage: "structural-submit",
      });
    });
    await expect(
      diagnose.execute(
        "run",
        { request: packet("diagnose", "abel-diagnose") },
        context,
      ),
    ).resolves.toMatchObject({ ok: false, failure: { kind: "artifact" } });
    expect(diagnoseCalls).toBe(1);
  });

  it("drains activation and parent payload state on finish", async () => {
    const bridge = new ParentPayloadBridge();
    const clear = vi.spyOn(bridge, "clear");
    const runtime = activeRuntime(
      async ({ packet: request }) => completed(request.id),
      { bridge },
    );

    await expect(runtime.execute("finish", {})).resolves.toEqual({
      ok: true,
      action: "finish",
    });
    expect(runtime.state).toBe("inactive");
    expect(clear).toHaveBeenCalledOnce();
  });
});
