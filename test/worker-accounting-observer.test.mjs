// Fixture instrumentation contract only; no SDK/provider or production authority.
import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { expect, it, vi } from "vitest";
import {
  CaptureEmitter,
  CaptureQueue,
  SdkCapture,
} from "../src/worker-capture.mjs";
import { LIMITS } from "../src/worker-public.mjs";
import { ToolIngress } from "../src/worker-tools.mjs";
import { observeAccounting } from "./helpers/worker-accounting-observer.mjs";

it("fixture accounting preserves original promises, leases, tool returns and thrown identities", async () => {
  const emit = vi.spyOn(CaptureEmitter.prototype, "emit");
  const detail = vi.spyOn(SdkCapture.prototype, "detail");
  const event = vi.spyOn(SdkCapture.prototype, "event");
  const reserve = vi.spyOn(CaptureQueue.prototype, "reserve");
  const observation = observeAccounting();
  const emitter = new CaptureEmitter(
    randomUUID(),
    new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    }),
    () => {},
  );
  const capture = new SdkCapture(emitter);
  try {
    const ready = emitter.emit({ kind: "ready", requestProtocol: 2 });
    expect(ready).toBe(emit.mock.results.at(-1)?.value);
    await ready;
    const context = capture.detail(
      {
        owner: { kind: "context", component: "request-context" },
        field: "context",
        encoding: "utf8",
      },
      "value",
    );
    expect(context).toBe(detail.mock.results.at(-1)?.value);
    await context;
    const original = capture.event({ type: "agent_start" });
    expect(original).toBe(event.mock.results.at(-1)?.value);
    await original;
    const lease = emitter.queue.reserve(1);
    expect(lease).toBe(reserve.mock.results.at(-1)?.value);
    lease.release();
    const result = Promise.resolve({ content: [], details: {} });
    const ingress = new ToolIngress([], () => {}, emitter.queue);
    const [tool] = ingress.wrap([{ execute: () => result }]);
    expect(tool.execute("id", {}, undefined, undefined)).toBe(result);
    let reads = 0;
    const bad = Object.defineProperty({}, "type", {
      get() {
        reads++;
        throw new Error("opaque");
      },
    });
    const rejection = capture.event(bad);
    expect(rejection).toBe(event.mock.results.at(-1)?.value);
    await expect(rejection).rejects.toThrow();
    expect(reads).toBe(0);
    let thrown = null;
    try {
      emitter.queue.reserve(LIMITS.workerQueueBytes + 1);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(reserve.mock.results.at(-1)?.value);
    await emitter.drain();
    expect(emitter.queue.bytes).toBe(0);
  } finally {
    observation.restore();
    for (const spy of [emit, detail, event, reserve]) spy.mockRestore();
  }
});
