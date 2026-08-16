import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((accept) => {
    resolve = accept;
  });
  return {
    createAgentSession: vi.fn(() => promise),
    resolve,
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
    fixture.resolve({ session: { dispose } });
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));
  });
});
