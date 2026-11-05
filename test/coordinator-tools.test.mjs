import { afterEach, expect, it, vi } from "vitest";
import { coordinatorTools } from "../src/coordinator-tools.mjs";

// Explicit IPC seam: no SDK, owner or real process channel.
afterEach(() => vi.restoreAllMocks());
function fixture() {
  const listeners = new Map();
  vi.spyOn(process, "on").mockImplementation((event, listener) => {
    listeners.set(event, listener);
    return process;
  });
  const send = vi.fn((_request, callback) => callback());
  vi.stubGlobal("process", { ...process, send });
  const tool = coordinatorTools().find((t) => t.name === "cadence_status");
  return {
    send,
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
