import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { ServiceClient } from "../src/service-client.ts";
import { publicError } from "../src/service-contract.ts";
import { HttpServiceTransport } from "../src/service-http-client.ts";

const descriptors = Object.getOwnPropertyDescriptors(AbortSignal);
afterEach(() => {
  Object.defineProperties(AbortSignal, descriptors);
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const refusal = { kind: "error", error: publicError("unavailable") };
const origin = "http://127.0.0.1:43123";

it.each([["any"], ["timeout"], ["any", "timeout"]])(
  "finite replies work without %j and release timers/listeners after decoding",
  async (...missing) => {
    vi.useFakeTimers();
    for (const name of missing)
      Object.defineProperty(AbortSignal, name, {
        configurable: true,
        value: undefined,
      });
    const source = new AbortController();
    const remove = vi.spyOn(source.signal, "removeEventListener");
    let signal: AbortSignal | undefined;
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      signal = init?.signal ?? undefined;
      return Response.json(refusal, { status: 503 });
    });
    const transport = new HttpServiceTransport({
      origin,
      fetch: fetcher,
      requestTimeoutMs: 20,
    });
    expect(await transport.models(source.signal)).toEqual(refusal);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    source.abort();
    expect(signal?.aborted).toBe(false);
  },
);
it("pre-aborted finite reads never dispatch fetch", async () => {
  const source = new AbortController();
  source.abort(new Error("left"));
  const fetcher = vi.fn<typeof fetch>();
  const transport = new HttpServiceTransport({
    origin,
    fetch: fetcher,
    requestTimeoutMs: 20,
  });
  await expect(transport.models(source.signal)).rejects.toThrow("left");
  expect(fetcher).not.toHaveBeenCalled();
});
it.each(["fetch", "body", "json", "decode"])(
  "%s failure disposes without retrying",
  async (failure) => {
    vi.useFakeTimers();
    const source = new AbortController();
    const remove = vi.spyOn(source.signal, "removeEventListener");
    const fetcher = vi.fn<typeof fetch>(async () => {
      if (failure === "fetch") throw new Error("fetch failed");
      if (failure === "body")
        return new Response(
          new ReadableStream({
            start(c) {
              c.error(new Error("body failed"));
            },
          }),
        );
      return new Response(failure === "json" ? "{" : "{}");
    });
    const transport = new HttpServiceTransport({
      origin,
      fetch: fetcher,
      requestTimeoutMs: 20,
    });
    await expect(transport.models(source.signal)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(source.signal.aborted).toBe(false);
  },
);
it("the deadline covers the entire body, not just response headers", async () => {
  vi.useFakeTimers();
  const source = new AbortController();
  const remove = vi.spyOn(source.signal, "removeEventListener");
  let bodySignal: AbortSignal | undefined;
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    bodySignal = init?.signal ?? undefined;
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"kind":'));
          bodySignal?.addEventListener(
            "abort",
            () => controller.error(bodySignal?.reason),
            { once: true },
          );
        },
      }),
    );
  });
  const transport = new HttpServiceTransport({
    origin,
    fetch: fetcher,
    requestTimeoutMs: 20,
  });
  const result = expect(transport.models(source.signal)).rejects.toMatchObject({
    name: "TimeoutError",
  });
  await vi.advanceTimersByTimeAsync(19);
  expect(bodySignal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await result;
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  expect(source.signal.aborted).toBe(false);
});
it("lost final command body remains unknown with one POST; disposal sends no Cancel or replay", async () => {
  vi.useFakeTimers();
  const epoch = randomUUID();
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    if (init?.method === "GET")
      return Response.json(
        {
          kind: "ok",
          value: {
            protocol: 1,
            storeId: randomUUID(),
            epoch,
            accessGeneration: 1,
            authority: "browser",
            csrf: randomUUID(),
            capabilities: { actions: true, manualChecks: false, history: true },
          },
        },
        { headers: { "x-cadence-attachment": randomUUID() } },
      );
    const signal = init?.signal;
    return new Response(
      new ReadableStream({
        start(c) {
          signal?.addEventListener("abort", () => c.error(signal.reason), {
            once: true,
          });
        },
      }),
    );
  });
  const transport = new HttpServiceTransport({
    origin,
    fetch: fetcher,
    requestTimeoutMs: 20,
  });
  const client = new ServiceClient(transport);
  expect((await client.session()).kind).toBe("ok");
  const command = {
    kind: "cadence-exit" as const,
    commandId: randomUUID(),
    conversationId: randomUUID(),
    head: null,
    revision: 0,
  };
  const result = client.workbenchCommand(command);
  await vi.advanceTimersByTimeAsync(20);
  expect(await result).toMatchObject({
    kind: "error",
    error: { effect: "uncertain" },
  });
  const posts = fetcher.mock.calls.filter(
    ([, init]) => init?.method === "POST",
  );
  expect(posts).toHaveLength(1);
  expect(JSON.parse(String(posts[0][1]?.body))).toEqual(command);
  expect(vi.getTimerCount()).toBe(0);
});
