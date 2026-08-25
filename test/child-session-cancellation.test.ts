import { afterEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => {
  type Factory = (options: Record<string, unknown>) => Promise<unknown>;
  let resolveCreation!: (value: unknown) => void;
  let creation!: Promise<unknown>;
  let factory!: Factory;
  const reset = () => {
    creation = new Promise<unknown>((accept) => {
      resolveCreation = accept;
    });
    factory = () => creation;
  };
  reset();
  return {
    createAgentSession: vi.fn((options: Record<string, unknown>) =>
      factory(options),
    ),
    resolveCreation: (value: unknown) => resolveCreation(value),
    setFactory: (next: Factory) => {
      factory = next;
    },
    reset,
  };
});

vi.mock(
  "@earendil-works/pi-coding-agent",
  async (importOriginal): Promise<Record<string, unknown>> => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual, createAgentSession: fixture.createAgentSession };
  },
);

import { runChildSession } from "../src/child-session";

afterEach(() => {
  fixture.reset();
  fixture.createAgentSession.mockClear();
});

function within<T>(promise: Promise<T>, timeoutMs = 500): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("child cancellation did not settle")),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

describe("child session creation cancellation", () => {
  it("returns a terminal safe code when child session creation fails", async () => {
    fixture.setFactory(async () => {
      throw new Error("provider headers=private payload=must-not-leak");
    });

    const outcome = await runChildSession({
      cwd: process.cwd(),
      modelRuntime: {} as never,
      model: {} as never,
      systemPrompt: "submit",
      requestId: "create-failed",
      role: "design-explorer",
      output: "evidence",
      roots: [process.cwd()],
      timeoutMs: 5_000,
    });

    expect(outcome).toMatchObject({
      ok: false,
      failure: {
        kind: "environment",
        code: "child-session-create-failed",
        stage: "child-session-create",
      },
    });
    expect(JSON.stringify(outcome)).not.toMatch(/headers|private|payload/i);
  });

  it("distinguishes a completed prompt with no final assistant", async () => {
    const dispose = vi.fn();
    fixture.setFactory(async () => ({
      session: {
        messages: [],
        subscribe() {
          return () => {};
        },
        async prompt() {},
        abort: vi.fn(),
        dispose,
      },
    }));

    const outcome = await runChildSession({
      cwd: process.cwd(),
      modelRuntime: {} as never,
      model: {} as never,
      systemPrompt: "submit",
      requestId: "no-final-assistant",
      role: "design-explorer",
      output: "evidence",
      roots: [process.cwd()],
      timeoutMs: 5_000,
    });

    expect(outcome).toMatchObject({
      ok: false,
      failure: {
        kind: "transport",
        code: "child-no-final-assistant",
        stage: "child-finalization",
      },
    });
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("settles immediately and disposes a session that is created late", async () => {
    const controller = new AbortController();
    const dispose = vi.fn();
    const run = runChildSession({
      cwd: process.cwd(),
      modelRuntime: {} as never,
      model: {} as never,
      systemPrompt: "submit",
      requestId: "cancel-creation",
      role: "design-explorer",
      output: "evidence",
      roots: [process.cwd()],
      timeoutMs: 5_000,
      signal: controller.signal,
    });
    await vi.waitFor(() =>
      expect(fixture.createAgentSession).toHaveBeenCalledTimes(1),
    );

    controller.abort(new Error("cancelled during session creation"));
    const outcome = await within(run);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toMatch(/cancelled during session creation/i);
    }
    fixture.resolveCreation({ session: { dispose } });
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));
  });

  it("retains usage emitted while an active child settles cancellation", async () => {
    const listeners = new Set<(event: Record<string, unknown>) => void>();
    const messages: Record<string, unknown>[] = [];
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const dispose = vi.fn();
    const abort = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      const message = assistantMessage(9, "aborted");
      messages.push(message);
      for (const listener of listeners)
        listener({ type: "message_end", message });
    });
    fixture.setFactory(async () => ({
      session: {
        messages,
        subscribe(listener: (event: Record<string, unknown>) => void) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        prompt() {
          markStarted();
          return new Promise<void>(() => {});
        },
        abort,
        dispose,
      },
    }));
    const controller = new AbortController();
    const run = runChildSession({
      cwd: process.cwd(),
      modelRuntime: {} as never,
      model: {} as never,
      systemPrompt: "submit",
      requestId: "cancel-active",
      role: "design-explorer",
      output: "evidence",
      roots: [process.cwd()],
      timeoutMs: 5_000,
      signal: controller.signal,
    });
    await started;

    controller.abort(new Error("cancelled during active stream"));
    const outcome = await within(run);

    expect(outcome).toMatchObject({
      ok: false,
      failureKind: "cancelled",
      usage: { totalTokens: 9 },
    });
    expect(abort).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("bounds cancellation cleanup when a child never becomes idle", async () => {
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const abort = vi.fn(() => new Promise<void>(() => {}));
    const dispose = vi.fn();
    fixture.setFactory(async () => ({
      session: {
        messages: [],
        subscribe() {
          return () => {};
        },
        prompt() {
          markStarted();
          return new Promise<void>(() => {});
        },
        abort,
        dispose,
      },
    }));
    const controller = new AbortController();
    const run = runChildSession({
      cwd: process.cwd(),
      modelRuntime: {} as never,
      model: {} as never,
      systemPrompt: "submit",
      requestId: "cancel-nonresponsive",
      role: "design-explorer",
      output: "evidence",
      roots: [process.cwd()],
      timeoutMs: 5_000,
      signal: controller.signal,
    });
    await started;

    controller.abort(new Error("cancelled nonresponsive child"));
    const outcome = await within(run);

    expect(outcome).toMatchObject({ ok: false, failureKind: "cancelled" });
    expect(abort).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("counts distinct assistant turns even when their timestamps collide", async () => {
    const listeners = new Set<(event: Record<string, unknown>) => void>();
    const messages: Record<string, unknown>[] = [];
    const dispose = vi.fn();
    fixture.setFactory(async () => ({
      session: {
        messages,
        subscribe(listener: (event: Record<string, unknown>) => void) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        async prompt() {
          for (const tokens of [5, 7]) {
            const message = assistantMessage(tokens, "stop", 1);
            messages.push(message);
            for (const listener of listeners)
              listener({ type: "message_end", message });
          }
        },
        abort: vi.fn(),
        dispose,
      },
    }));

    const outcome = await runChildSession({
      cwd: process.cwd(),
      modelRuntime: {} as never,
      model: {} as never,
      systemPrompt: "submit",
      requestId: "same-timestamp",
      role: "design-explorer",
      output: "evidence",
      roots: [process.cwd()],
      timeoutMs: 5_000,
    });

    expect(outcome).toMatchObject({
      ok: false,
      usage: { totalTokens: 12 },
    });
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

function assistantMessage(
  totalTokens: number,
  stopReason: "stop" | "aborted",
  timestamp = 1,
) {
  return {
    role: "assistant",
    content: [{ type: "text", text: "done" }],
    provider: "test-provider",
    model: "test-model",
    timestamp,
    stopReason,
    usage: {
      input: totalTokens,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}
