// Actual loopback HTTP/WS with injected readonly state; NOT a W4 execution/browser test.

import { afterEach, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { ServiceClient } from "../../src/service-client.ts";
import { HttpServiceTransport } from "../../src/service-http-client.ts";
import {
  type ViewerState,
  WorkspaceObserver,
} from "../../web/src/client/observer";
import {
  deferred,
  type Fixture,
  httpFixture,
} from "../helpers/service-http-fixture.ts";
import { context, id } from "./fixtures";

const fixtures: Fixture[] = [];
const stops: (() => void)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const stop of stops.splice(0)) stop();
  for (const f of fixtures.splice(0)) await f.server.close();
});
async function setup() {
  const f = await httpFixture();
  fixtures.push(f);
  f.projection.workspace = async () => ({
    workspaceId: f.workspaceId,
    storeId: f.storeId,
    epoch: f.epoch,
    committedSeq: "1",
    rootLabel: "isolated fixture",
    models: [],
    context: f.snap(f.scope).context,
  });
  f.projection.snapshot = async (scope) => ({
    ...f.snap(scope),
    context: {
      status: "unavailable",
      workspaceId: f.workspaceId,
      taskId: scope.kind === "task" ? scope.id : null,
      error: { code: "unavailable", effect: "none", recovery: "operator" },
    },
  });
  let sessions = 0;
  const sessionAttachments: (string | null)[] = [];
  const sockets: WebSocket[] = [];
  const transport = new HttpServiceTransport({
    origin: f.origin,
    fetch: async (url, init) => {
      if (String(url).endsWith("/session")) {
        sessions++;
        sessionAttachments.push(
          new Headers(init?.headers).get("x-cadence-attachment"),
        );
      }
      return fetch(url, {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init?.headers)),
          Cookie: f.cookie,
          Origin: f.origin,
        },
      });
    },
    socket: (url) => {
      const socket = new WebSocket(url, {
        headers: { cookie: f.cookie, origin: f.origin },
      });
      sockets.push(socket);
      return socket;
    },
  });
  const observer = new WorkspaceObserver({
    transport,
    client: new ServiceClient(transport),
  });
  let state: ViewerState | undefined;
  const states: ViewerState[] = [];
  const select = (taskId: string | null) => {
    state = undefined;
    const stop = observer.observe(
      taskId ? { kind: "task", id: taskId } : null,
      (value) => {
        state = value;
        states.push(value);
      },
    );
    stops.push(stop);
    return stop;
  };
  return {
    f,
    transport,
    observer,
    sockets,
    select,
    state: () => state,
    states,
    sessions: () => sessions,
    sessionAttachments,
  };
}
it("polls refresh capabilities on the existing attachment without renewing grants", async () => {
  const s = await setup();
  s.select(id());
  await expect.poll(() => s.state()?.transportStatus).toBe("current");
  const original = s.f.projection.workspace;
  const model = context().model;
  s.f.projection.workspace = async () => ({
    ...(await original()),
    models: [model],
  });
  s.observer.refresh();
  await expect.poll(() => s.state()?.workspace?.models).toEqual([model]);
  expect(s.sessions()).toBe(2);
  expect(s.sessionAttachments[0]).toBeTruthy();
  expect(s.sessionAttachments[1]).toBe(
    new URL(s.sockets[0].url).searchParams.get("attachment"),
  );
  // An unchanged model still checks the same session; this grants no consent.
  const previous = s.state()?.observation;
  s.observer.refresh();
  await expect.poll(() => s.state()?.observation === previous).toBe(false);
  expect(s.sessions()).toBe(3);
  expect(new Set(s.sessionAttachments).size).toBe(1);
});
it("serial task switching and repeated refresh do not exhaust 16 attachments", async () => {
  const s = await setup();
  let stop: (() => void) | undefined;
  for (let n = 0; n < 20; n++) {
    stop?.();
    const task = id();
    stop = s.select(task);
    await expect.poll(() => s.state()?.transportStatus).toBe("current");
    expect(s.state()?.observation?.snapshot.scope.id).toBe(task);
  }
  const count = s.sessions();
  for (let i = 0; i < 25; i++) s.observer.refresh();
  await expect.poll(() => s.state()?.workspace?.storeId).toBe(s.f.storeId);
  expect(s.sessions()).toBe(count + 1); // concurrent refreshes share one poll
  stop?.();
  await expect
    .poll(() =>
      s.sockets.every((socket) => socket.readyState === WebSocket.CLOSED),
    )
    .toBe(true);
  expect(s.f.callbacks.size).toBe(0);
});
it("lost attachment acquires fresh readonly session; rotation stops instead of renewal loop", async () => {
  const s = await setup();
  const stop = s.select(id());
  await expect.poll(() => s.state()?.transportStatus).toBe("current");
  const first = s.sessions();
  s.sockets[0].terminate();
  await expect.poll(() => s.sessions(), { timeout: 2000 }).toBe(first + 1);
  await expect.poll(() => s.state()?.transportStatus).toBe("current");
  s.f.material.rotate();
  s.observer.refresh();
  await expect.poll(() => s.state()?.actions).toBe(false);
  await expect
    .poll(() => s.state()?.error, { timeout: 2000 })
    .toMatch(/re-entry/);
  const count = s.sessions();
  s.observer.refresh();
  expect(s.sessions()).toBe(count);
  stop();
});
it("Return during a pending session awaits and releases its unused attachment, without subscribing", async () => {
  const s = await setup(),
    barrier = deferred();
  const original = s.f.projection.session;
  s.f.projection.session = async () => {
    await barrier.promise;
    return original();
  };
  const stop = s.select(id());
  await expect.poll(() => s.sessions()).toBe(1);
  stop();
  barrier.resolve();
  const task = id();
  s.select(task);
  await expect.poll(() => s.state()?.transportStatus).toBe("current");
  expect(s.sockets).toHaveLength(1);
  expect(s.state()?.observation?.snapshot.scope.id).toBe(task);
  expect(s.sessions()).toBe(2);
});
it("readonly fetch abort is forwarded, never serialized or sent as Cancel", async () => {
  const abort = new AbortController(),
    started = deferred();
  let calls = 0;
  const transport = new HttpServiceTransport({
    origin: "http://127.0.0.1:17423",
    fetch: async (url, init) => {
      calls++;
      expect(String(url)).toContain("/workspace");
      expect(init?.body).toBeUndefined();
      expect(init?.signal).toBe(abort.signal);
      started.resolve();
      await new Promise<void>((_, reject) =>
        init?.signal?.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true },
        ),
      );
      throw new Error("unreachable");
    },
  });
  const promise = new ServiceClient(transport).workspace(abort.signal);
  await started.promise;
  abort.abort();
  expect(await promise).toMatchObject({
    kind: "error",
    error: { effect: "none" },
  });
  expect(calls).toBe(1);
});

it("obsolete cleanup cannot detach the replacement task or clear its refresh hook", async () => {
  const s = await setup(),
    old = s.select(id());
  await expect.poll(() => s.state()?.transportStatus).toBe("current");
  const task = id();
  s.select(task);
  await expect.poll(() => s.state()?.transportStatus).toBe("current");
  old();
  old();
  const count = s.sessions();
  s.observer.refresh();
  await expect.poll(() => s.state()?.observation?.snapshot.scope.id).toBe(task);
  expect(s.sessions()).toBe(count + 1);
  expect(s.sockets[1].readyState).toBe(WebSocket.OPEN);
});
it("failed original session allocations release their actual 16-slot reservations", async () => {
  const s = await setup(),
    original = s.f.projection.session;
  s.f.projection.session = async () => {
    throw new Error("fixture failure");
  };
  for (let n = 0; n < 20; n++) {
    const stop = s.select(id());
    await expect.poll(() => s.state()?.error).toBe("unavailable");
    stop();
  }
  s.f.projection.session = original;
  s.select(id());
  await expect.poll(() => s.state()?.transportStatus).toBe("current");
});
it("lost detach reply retains its exact attachment and Refresh recovers without explicit re-entry", async () => {
  const s = await setup();
  s.select(id());
  await expect.poll(() => s.state()?.transportStatus).toBe("current");
  const original = s.transport.detach.bind(s.transport);
  let fail = true;
  s.transport.detach = async () => {
    if (fail) throw new Error("injected unavailable detach");
    return original();
  };
  const count = s.sessions();
  s.select(id());
  await expect.poll(() => s.state()?.error).toMatch(/unavailable detach/);
  expect(s.state()?.workspace).toBeUndefined();
  expect(s.sessions()).toBe(count);
  s.observer.refresh();
  expect(s.sessions()).toBe(count);
  fail = false;
  s.observer.refresh(); // reconnect observation only, never a command or grant
  await expect.poll(() => s.state()?.transportStatus).toBe("current");
  expect(s.sessions()).toBe(count + 1);
});
it("transport preserves attachment through a lost detach reply instead of leaking a fresh slot", async () => {
  const f = await httpFixture();
  fixtures.push(f);
  let lost = true;
  const attachments: (string | null)[] = [];
  const t = new HttpServiceTransport({
    origin: f.origin,
    localCapability: f.local,
    fetch: async (url, init) => {
      if (String(url).endsWith("/detach")) {
        attachments.push(
          new Headers(init?.headers).get("x-cadence-attachment"),
        );
        if (lost) throw new Error("injected transport loss before delivery");
      }
      return fetch(url, init);
    },
  });
  expect((await new ServiceClient(t).session()).kind).toBe("ok");
  await expect(t.detach()).rejects.toThrow();
  lost = false;
  await t.detach();
  expect(attachments).toHaveLength(2);
  expect(attachments[0]).toBeTruthy();
  expect(attachments[1]).toBe(attachments[0]);
  await t.detach();
  expect(attachments).toHaveLength(2);
});
it("cookie revocation without a selected task/socket clears private state and stops polling", async () => {
  const s = await setup();
  let state: ViewerState | undefined;
  const stop = s.observer.observe(null, (value) => {
    state = value;
  });
  stops.push(stop);
  await expect.poll(() => state?.workspace?.storeId).toBe(s.f.storeId);
  expect(s.sockets).toHaveLength(0);
  s.f.material.rotate();
  s.observer.refresh();
  await expect.poll(() => state?.error).toMatch(/Access revoked/);
  expect(state?.workspace).toBeUndefined();
  expect(state?.actions).toBe(false);
  const count = s.sessions();
  s.observer.refresh();
  expect(s.sessions()).toBe(count);
});
it.each(["body", "headers"])(
  "a lost session %s recovers automatically using the same allocation, without replay",
  async (loss) => {
    const f = await httpFixture();
    fixtures.push(f);
    f.projection.workspace = async () => ({
      workspaceId: f.workspaceId,
      storeId: f.storeId,
      epoch: f.epoch,
      committedSeq: "1",
      rootLabel: "fixture",
      models: [],
      context: f.snap(f.scope).context,
    });
    const allocations: (string | null)[] = [];
    const commands: string[] = [];
    let state: ViewerState | undefined;
    const t = new HttpServiceTransport({
      origin: f.origin,
      fetch: async (url, init) => {
        const response = await fetch(url, {
          ...init,
          headers: {
            ...Object.fromEntries(new Headers(init?.headers)),
            Cookie: f.cookie,
            Origin: f.origin,
          },
        });
        expect(
          (f.server as unknown as { attachments: Map<string, unknown> })
            .attachments.size,
        ).toBeLessThanOrEqual(1);
        if (String(url).endsWith("/session")) {
          allocations.push(
            new Headers(init?.headers).get("x-cadence-attachment"),
          );
          if (allocations.length === 1) {
            await response.arrayBuffer(); // original settled; lose only its delivered reply
            if (loss === "headers") throw new Error("response lost");
            return new Response("{", {
              status: response.status,
              headers: response.headers,
            });
          }
        }
        if (init?.method === "POST") commands.push(String(url));
        return response;
      },
    });
    const observer = new WorkspaceObserver({
      transport: t,
      client: new ServiceClient(t),
    });
    stops.push(
      observer.observe(null, (v) => {
        state = v;
      }),
    );
    await expect.poll(() => state?.error).toBe("unavailable");
    await expect
      .poll(() => state?.workspace?.storeId, { timeout: 2000 })
      .toBe(f.storeId);
    expect(state?.attached).toBe(true);
    expect(allocations).toHaveLength(3); // recover CSRF, retire exact old viewer, attach
    expect(allocations[0]).toBeTruthy();
    expect(allocations[1]).toBe(allocations[0]);
    expect(allocations[2]).not.toBe(allocations[0]);
    expect(commands).toEqual([`${f.origin}/api/v1/detach`]);
  },
);
it("ordinary polling renews its existing attachment even with no socket or model change", async () => {
  const s = await setup();
  s.select(null);
  await expect.poll(() => s.state()?.workspace?.storeId).toBe(s.f.storeId);
  const original = s.sessions();
  s.observer.refresh();
  await expect.poll(() => s.sessions()).toBe(original + 1);
  expect(new Set(s.sessionAttachments).size).toBe(1);
  expect(s.sockets).toHaveLength(0);
});
it.each(["poll", "reconnect"])(
  "%s follows a replacement owner without mixed-epoch readiness or command replay",
  async (route) => {
    const s = await setup();
    const stop = s.select(null);
    await expect.poll(() => s.state()?.workspace?.storeId).toBe(s.f.storeId);
    const successor = await httpFixture();
    fixtures.push(successor);
    successor.projection.workspace = async () => ({
      workspaceId: successor.workspaceId,
      storeId: successor.storeId,
      epoch: successor.epoch,
      committedSeq: "1",
      rootLabel: "successor",
      models: [],
      context: successor.snap(successor.scope).context,
    });
    const actual = globalThis.fetch;
    const writes: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const path = new URL(String(url));
      if (init?.method === "POST") writes.push(path.pathname);
      const headers = new Headers(init?.headers);
      headers.set("Cookie", successor.cookie);
      headers.set("Origin", successor.origin);
      return actual(`${successor.origin}${path.pathname}${path.search}`, {
        ...init,
        headers,
      });
    });
    if (route === "poll") s.observer.refresh();
    else {
      stop();
      s.select(null);
    }
    await expect
      .poll(() => s.state()?.epoch, { timeout: 2000 })
      .toBe(successor.epoch);
    await expect.poll(() => s.state()?.workspace?.epoch).toBe(successor.epoch);
    expect(s.state()?.error).toBeUndefined();
    expect(s.state()?.attached).toBe(true);
    for (const state of s.states)
      if (
        state.attached &&
        !state.error &&
        state.transportStatus === "current" &&
        state.workspace
      )
        expect(state.workspace.epoch).toBe(state.epoch);
    expect(writes.every((path) => path === "/api/v1/detach")).toBe(true);
    expect(s.sockets).toHaveLength(0);
  },
);
it.each(["browser", "local"])(
  "%s: an already-completed detach acknowledges retries without repeating its effect",
  async (authority) => {
    const f = await httpFixture();
    fixtures.push(f);
    const detached = vi.fn();
    f.adapters.attachments = { detach: detached, revokeGrants() {} };
    let lose = true;
    const transport = new HttpServiceTransport({
      origin: f.origin,
      ...(authority === "local" ? { localCapability: f.local } : {}),
      fetch: async (url, init) => {
        const headers = new Headers(init?.headers);
        if (authority === "browser") {
          headers.set("Cookie", f.cookie);
          headers.set("Origin", f.origin);
        }
        const response = await fetch(url, { ...init, headers });
        if (String(url).endsWith("/detach") && lose) {
          lose = false;
          await response.arrayBuffer();
          throw new Error("detach response lost after settlement");
        }
        return response;
      },
    });
    await transport.session();
    await expect(transport.detach()).rejects.toThrow("response lost");
    expect(detached).toHaveBeenCalledTimes(1);
    await expect(transport.detach()).resolves.toEqual({
      kind: "ok",
      value: null,
    });
    expect(detached).toHaveBeenCalledTimes(1);
  },
);
it.each(["activeRuns", "snapshot"] as const)(
  "a replacement epoch in %s never becomes mixed-epoch readiness",
  async (operation) => {
    const s = await setup();
    const task = id();
    s.select(operation === "snapshot" ? task : null);
    await expect.poll(() => s.state()?.transportStatus).toBe("current");
    const originalVersion = s.state()?.attachmentVersion ?? 0;
    expect(originalVersion).toBeGreaterThan(0);
    vi.spyOn(s.transport, operation).mockResolvedValueOnce({
      kind: "ok",
      value:
        operation === "snapshot"
          ? {
              ...(await s.f.projection.snapshot({ kind: "task", id: task })),
              epoch: id(),
            }
          : {
              storeId: s.f.storeId,
              workspaceId: s.f.workspaceId,
              epoch: id(),
              status: "complete",
              runs: [],
            },
    });
    s.observer.refresh();
    await expect
      .poll(() => s.state()?.attachmentVersion)
      .toBeGreaterThan(originalVersion);
    await expect.poll(() => s.state()?.error).toBeUndefined();
    for (const state of s.states) {
      if (!state.attached || state.error || state.transportStatus !== "current")
        continue;
      if (state.activeRuns) expect(state.activeRuns.epoch).toBe(state.epoch);
      if (state.observation)
        expect(state.observation.snapshot.epoch).toBe(state.epoch);
    }
  },
);
it("default browser fetch retains its native global receiver (public API mock)", async () => {
  const receivers: unknown[] = [];
  vi.stubGlobal("fetch", async function (this: unknown) {
    receivers.push(this);
    return new Response(
      JSON.stringify({
        kind: "error",
        error: { code: "unavailable", effect: "none", recovery: "operator" },
      }),
    );
  });
  await new HttpServiceTransport({
    origin: "http://127.0.0.1:17423",
  }).workspace();
  expect(receivers).toEqual([globalThis]);
});
