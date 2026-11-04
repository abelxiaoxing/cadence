import { afterEach, expect, it, vi } from "vitest";
import { abortScope } from "../src/abort-scope.ts";

const descriptors = Object.getOwnPropertyDescriptors(AbortSignal);
afterEach(() => {
  Object.defineProperties(AbortSignal, descriptors);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it.each([["any"], ["timeout"], ["any", "timeout"]])(
  "works without static APIs: %j, including first reason and cleanup",
  (...missing) => {
    vi.useFakeTimers();
    for (const name of missing)
      Object.defineProperty(AbortSignal, name, {
        configurable: true,
        value: undefined,
      });
    const first = new AbortController(),
      second = new AbortController();
    const removeFirst = vi.spyOn(first.signal, "removeEventListener");
    const removeSecond = vi.spyOn(second.signal, "removeEventListener");
    const scope = abortScope([first.signal, second.signal, first.signal], 20);
    const reason = new Error("left viewer");
    second.abort(reason);
    first.abort(new Error("later"));
    expect(scope.signal.reason).toBe(reason);
    expect(removeFirst).toHaveBeenCalledTimes(1);
    expect(removeSecond).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    scope.dispose();
    expect(removeFirst).toHaveBeenCalledTimes(1);
  },
);
it("pre-aborted sources win in source order without a timer or lingering listeners", () => {
  vi.useFakeTimers();
  const live = new AbortController(),
    first = new AbortController(),
    second = new AbortController();
  first.abort("first");
  second.abort("second");
  const remove = vi.spyOn(live.signal, "removeEventListener");
  const scope = abortScope([live.signal, first.signal, second.signal], 0);
  expect(scope.signal.reason).toBe("first");
  expect(remove).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it("timeout aborts only the local wait and releases all resources", () => {
  vi.useFakeTimers();
  const source = new AbortController();
  const remove = vi.spyOn(source.signal, "removeEventListener");
  const scope = abortScope([source.signal], 20);
  vi.advanceTimersByTime(19);
  expect(scope.signal.aborted).toBe(false);
  vi.advanceTimersByTime(1);
  expect(scope.signal.reason.name).toBe("TimeoutError");
  expect(source.signal.aborted).toBe(false);
  expect(remove).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  source.abort("too late");
  expect(scope.signal.reason.name).toBe("TimeoutError");
});
it.each([false, true])(
  "normal/exceptional completion disposes without aborting: throws=%s",
  async (fails) => {
    vi.useFakeTimers();
    const source = new AbortController();
    const remove = vi.spyOn(source.signal, "removeEventListener");
    const scope = abortScope([source.signal], 20);
    const operation = async () => {
      try {
        if (fails) throw new Error("body failure");
        return "complete";
      } finally {
        scope.dispose();
        scope.dispose();
      }
    };
    if (fails) await expect(operation()).rejects.toThrow("body failure");
    else expect(await operation()).toBe("complete");
    expect(remove).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    source.abort();
    expect(scope.signal.aborted).toBe(false);
  },
);
