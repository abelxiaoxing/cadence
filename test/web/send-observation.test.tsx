import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { abortScope } from "../../src/abort-scope.ts";
import { ServiceClient } from "../../src/service-client.ts";
import { HttpServiceTransport } from "../../src/service-http-client.ts";
import { WorkspaceObserver } from "../../web/src/client/observer";
import { httpFixture } from "../helpers/service-http-fixture.ts";

const descriptors = Object.getOwnPropertyDescriptors(AbortSignal);
afterEach(() => {
  Object.defineProperties(AbortSignal, descriptors);
});
it.each(["any", "timeout", "both"])(
  "without %s: Send waits for the requested observation generation, not an old same-epoch attachment; waiting itself never connects",
  async (missing) => {
    for (const name of missing === "both" ? ["any", "timeout"] : [missing])
      Object.defineProperty(AbortSignal, name, {
        configurable: true,
        value: undefined,
      });
    const f = await httpFixture();
    const calls: string[] = [];
    f.projection.workspace = async () => ({
      workspaceId: f.workspaceId,
      storeId: f.storeId,
      epoch: f.epoch,
      committedSeq: "1",
      rootLabel: "fixture",
      models: [],
      context: f.snap(f.scope).context,
    });
    const transport = new HttpServiceTransport({
      origin: f.origin,
      fetch: async (url, init) => {
        calls.push(String(url));
        return fetch(url, {
          ...init,
          headers: {
            ...Object.fromEntries(new Headers(init?.headers)),
            Cookie: f.cookie,
            Origin: f.origin,
          },
        });
      },
    });
    const observer = new WorkspaceObserver({
      transport,
      client: new ServiceClient(transport),
    });
    const scope = abortScope([], 5000);
    const { signal } = scope;
    let stop: (() => void) | undefined;
    try {
      const first = observer.whenReady(
        f.epoch,
        signal,
        observer.nextObservation(),
      );
      expect(calls).toEqual([]);
      stop = observer.observe(null, () => {});
      await first;
      let ready = false;
      const next = observer
        .whenReady(f.epoch, signal, observer.nextObservation())
        .then(() => {
          ready = true;
        });
      const count = calls.length;
      observer.refresh();
      await expect.poll(() => calls.length).toBeGreaterThan(count);
      expect(ready).toBe(false);
      stop();
      stop = observer.observe(null, () => {});
      await next;
      expect(ready).toBe(true);
      const abort = new AbortController();
      const waiting = observer.whenReady(randomUUID(), abort.signal);
      const before = calls.length;
      abort.abort();
      await expect(waiting).rejects.toThrow();
      expect(calls.length).toBe(before);
    } finally {
      scope.dispose();
      stop?.();
      await transport.detach().catch(() => {});
      await f.server.close();
    }
  },
);
