import { afterEach, expect, it, vi } from "vitest";
import { createCoordinatorTools } from "../src/coordinator-tools.mjs";

// Explicit IPC seam: no SDK, owner or real process channel.
afterEach(() => vi.restoreAllMocks());
function fixture() {
  const listeners = new Map();
  vi.spyOn(process, "on").mockImplementation((event, listener) => {
    listeners.set(event, listener);
    return process;
  });
  const send = vi.fn((_request, callback) => callback());
  const removeListener = vi.fn((event, listener) => {
    expect(listeners.get(event)).toBe(listener);
    listeners.delete(event);
  });
  vi.stubGlobal("process", { ...process, send, removeListener });
  const kit = createCoordinatorTools();
  const tool = kit.tools.find((t) => t.name === "cadence_status");
  return {
    send,
    removeListener,
    close: () => kit.close(),
    call: (signal) => tool.execute("id", {}, signal),
    reply: (
      value = { id: send.mock.calls.at(-1)[0].id, ok: true, text: "observed" },
    ) => listeners.get("message")(value),
    disconnect: () => listeners.get("disconnect")(),
  };
}
afterEach(() => vi.unstubAllGlobals());

it("serialized calls have no cumulative quota", async () => {
  const f = fixture();
  for (let i = 0; i < 24; i++) {
    const result = f.call();
    await Promise.resolve();
    f.reply();
    expect((await result).content[0].text).toBe("observed");
  }
  expect(f.send).toHaveBeenCalledTimes(24);
});

it("queued cancellation refuses dispatch without abandoning an already sent call", async () => {
  const f = fixture();
  const abort = new AbortController();
  const first = f.call(abort.signal);
  await Promise.resolve();
  const queued = f.call(abort.signal);
  const refused = expect(queued).rejects.toThrow("Coordinator canceled");
  let settled = false;
  first.finally(() => {
    settled = true;
  });
  abort.abort();
  await Promise.resolve();
  expect(settled).toBe(false);
  f.reply();
  await first;
  await refused;
  expect(f.send).toHaveBeenCalledTimes(1);
  await expect(f.call(abort.signal)).rejects.toThrow("Coordinator canceled");
});

it("owned close joins sent work, refuses queued sends and then releases listeners", async () => {
  const f = fixture();
  const first = f.call();
  await Promise.resolve();
  const queued = f.call();
  const refused = expect(queued).rejects.toThrow("Coordinator closed");
  let settled = false;
  const closing = f.close().then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  await expect(f.call()).rejects.toThrow("Coordinator closed");
  f.reply();
  await first;
  await refused;
  await closing;
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(f.removeListener).toHaveBeenCalledTimes(2);
});

it.each(["throw", "callback"])(
  "%s send failures release that request and expose only the fixed transport error",
  async (cause) => {
    const f = fixture();
    const fault = new Error("synthetic private transport diagnostic");
    f.send.mockImplementationOnce((_request, callback) => {
      if (cause === "throw") throw fault;
      callback(fault);
    });
    await expect(f.call()).rejects.toThrow("Coordinator request unavailable");
    const next = f.call();
    await Promise.resolve();
    f.reply();
    expect((await next).content[0].text).toBe("observed");
    await f.close();
    expect(f.send).toHaveBeenCalledTimes(2);
    expect(f.removeListener).toHaveBeenCalledTimes(2);
  },
);

it.each(["disconnect", "malformed reply"])(
  "%s closes pending and queued calls without further sends",
  async (cause) => {
    const f = fixture();
    const first = f.call();
    await Promise.resolve();
    const queued = f.call();
    const refused = [first, queued].map((call) =>
      expect(call).rejects.toThrow("Coordinator disconnected"),
    );
    if (cause === "disconnect") f.disconnect();
    else f.reply(null);
    await Promise.all(refused);
    await expect(f.call()).rejects.toThrow("Coordinator disconnected");
    expect(f.send).toHaveBeenCalledTimes(1);
  },
);

it("private auth replies can never satisfy or leak into a coordinator tool with the same ID", async () => {
  const f = fixture();
  const pending = f.call();
  let settled = false;
  void pending.then(() => {
    settled = true;
  });
  await Promise.resolve();
  f.reply({
    kind: "auth",
    id: f.send.mock.calls[0][0].id,
    ok: true,
    auth: { ok: true, apiKey: "private-canary" },
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  f.reply();
  expect((await pending).content[0].text).toBe("observed");
  await f.close();
});
