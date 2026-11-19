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
        {
          headers: {
            "x-cadence-attachment": new Headers(init.headers).get(
              "x-cadence-attachment",
            )!,
          },
        },
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

it("a late session body cannot reinstall a retired attachment or its CSRF", async () => {
  const epoch = randomUUID(),
    storeId = randomUUID();
  const sessions: string[] = [],
    detaches: [string, string | null][] = [];
  const challenges = [randomUUID(), randomUUID(), randomUUID()];
  let release!: () => void, bodyStarted!: () => void;
  const entered = new Promise<void>((r) => {
    bodyStarted = r;
  });
  const transport = new HttpServiceTransport({
    origin,
    fetch: async (url, init) => {
      const headers = new Headers(init?.headers),
        attachment = headers.get("x-cadence-attachment")!;
      if (String(url).endsWith("/detach")) {
        detaches.push([attachment, headers.get("x-cadence-csrf")]);
        return Response.json({ kind: "ok", value: null });
      }
      expect(String(url)).toBe(`${origin}/api/v1/session`);
      const csrf = challenges[sessions.length];
      sessions.push(attachment);
      const reply = JSON.stringify({
        kind: "ok",
        value: {
          protocol: 1,
          storeId,
          epoch,
          accessGeneration: 1,
          authority: "browser",
          csrf,
          capabilities: { actions: true, manualChecks: false, history: true },
        },
      });
      const body =
        sessions.length === 2
          ? new ReadableStream<Uint8Array>(
              {
                pull(controller) {
                  bodyStarted();
                  release = () => {
                    controller.enqueue(new TextEncoder().encode(reply));
                    controller.close();
                  };
                },
              },
              { highWaterMark: 0 },
            )
          : reply;
      return new Response(body, {
        headers: { "x-cadence-attachment": attachment },
      });
    },
  });
  await transport.session();
  const pending = transport.session();
  await entered;
  await transport.detach();
  await transport.session();
  expect(sessions[1]).toBe(sessions[0]);
  expect(sessions[2]).not.toBe(sessions[0]);
  release();
  await expect(pending).rejects.toThrow("stale");
  await transport.detach();
  expect(detaches).toEqual([
    [sessions[0], challenges[0]],
    [sessions[2], challenges[2]],
  ]);
});
